# Self-managed image transforms inside Cloudflare Workers

Research date: 2026-09-08. Scope: this records the earlier investigation of
application-managed image bytes and excludes Cloudflare Images’ managed
transformation engine and the `cf.image`/Images binding.

## Finding

Local workerd tests confirm self-managed, on-demand resizing is feasible. Use Photon for decoding/resizing and jSquash for quality-controlled WebP encoding. The initial decoding/resizing candidate is `@cf-wasm/photon/workerd`: it publishes an explicit Cloudflare Workers entry point, is Rust/Wasm, and documents resize plus WebP output. It fits a TanStack Start server entry because Start exposes the standard `fetch(Request): Response | Promise<Response>` contract and the Cloudflare Vite/Wrangler deployment path.

There is a quality/compression caveat in the package API. The documented Photon WebP call is `get_bytes_webp()` with no quality argument, whereas JPEG output exposes a quality parameter. In the local reproduction, Photon’s 640px WebP output was much larger than Sharp quality 80 for the same fixtures (photo: 804,636 B vs 84,176 B; transparent portrait: 315,964 B vs 44,028 B). The combined Photon + jSquash reproduction below resolves this compression concern for WebP. Photon alone remains a poor compression baseline.

Photon is a focused baseline rather than a Sharp/IPX replacement. Its upstream supported formats are PNG, JPEG, BMP, ICO, TIFF, and WebP; AVIF is absent from that list, and the upstream project has an open “Decode avif” issue. Treat AVIF input/output as unsupported by Photon unless a local test against the exact package version proves otherwise.

## Why native Sharp/IPX is not the Worker baseline

IPX is explicitly “powered by sharp and svgo” and its modifiers map to Sharp/libvips. That is a strong Node/server runtime design, but it is not a Worker-native image runtime. Sharp’s installation documentation describes platform-specific native binaries and Node-API prerequisites; its Wasm option is the separate `@img/sharp-wasm32` package, which requires a runtime providing multi-threaded Wasm and says single-threaded environments are unsupported. Cloudflare Workers documents that Worker threading is unavailable, and Workers does not allow customer-uploaded native binaries (only JavaScript and Wasm). Therefore ordinary `sharp`/IPX should be treated as incompatible with a deployed Worker; `@img/sharp-wasm32` is also not an evidence-backed choice for Workers because its published requirement conflicts with the Workers runtime model.

IPX’s URL/API semantics are still useful as an application-level model: width/height/fit/format and bounded output dimensions. If reproducing IPX-like URLs, enforce a strict maximum output dimension and input byte/pixel limits before decoding. IPX itself documents that unconstrained enlargement can allocate gigabytes from a small source.

## Candidate matrix

| Candidate                               | Worker fit                                                                                         | JPEG/PNG resize → WebP                                                                               | AVIF                                                | Notes                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cf-wasm/photon/workerd`               | Supported path documented by the package                                                           | Supported by its Worker example and `get_bytes_webp()` API; no documented WebP quality argument      | Not listed by upstream; open AVIF decode issue      | Best local workerd correctness baseline; local size results make it a poor compression baseline until quality control is found                 |
| `@jsquash/*` codecs + `@jsquash/resize` | Plausible Wasm path; project documents Cloudflare Worker examples and strict-runtime compatibility | Possible by composing JPEG/PNG decode, resize, and WebP encode; WebP encoder exposes `EncodeOptions` | `@jsquash/avif` uses libavif Wasm for encode/decode | More moving parts and raw pixel buffers; manually include/import Wasm. Lossy WebP encoding verified locally with Photon; AVIF remains untested |
| `sharp` / IPX                           | Not supported as a native Worker deployment                                                        | Yes in Node                                                                                          | Yes in native Sharp                                 | Do not select for Workers; requires native/Node runtime assumptions                                                                            |
| Cloudflare Images transform APIs        | Managed Cloudflare service                                                                         | Yes                                                                                                  | Yes                                                 | Out of scope for self-managed transforms                                                                                                       |

## Required behaviour and caveats

- **Resize and WebP:** Photon’s documented Worker example fetches image bytes, constructs a `PhotonImage`, resizes it, and calls `get_bytes_webp()`. The handler can return those bytes with `Content-Type: image/webp`.
- **Compression quality:** Do not infer “WebP” means small output. Photon’s documented WebP method does not expose a quality parameter. For production-sized photo output, prototype a jSquash `@jsquash/webp` encode step after Photon resize (or replace Photon’s encode step), passing explicit `EncodeOptions`; this requires raw pixel transfer and Wasm module wiring. jSquash’s own repository documents Cloudflare Worker examples, but its JPEG/WebP Emscripten modules have open bundler/import issues, so this path needs a real workerd fixture before adoption.
- **Transparency:** WebP supports alpha, but preserve it only when the decoder and WebP encoder path retain an alpha channel. Add PNG fixtures with semi-transparent edges and fully transparent pixels; do not flatten to a background colour unless the API explicitly requests it. Sharp’s docs are a useful behavioural reference: its WebP encoder has separate alpha quality and an `exact` option for colour data in transparent pixels, but those options do not prove Photon parity.
- **Orientation:** EXIF orientation must be handled deliberately. Sharp auto-orients from EXIF and removes the tag; Photon’s listed API does not establish equivalent EXIF auto-orientation. For JPEG uploads from phones, either implement/verify orientation handling before resize or document that orientation is not corrected. Test all eight EXIF orientations.
- **Colour:** Set a defined policy and test it. Sharp’s default is conversion to device-independent sRGB while stripping metadata; Photon’s package documentation does not promise equivalent ICC/profile handling. For a predictable web output, prefer sRGB input/output and avoid claiming colour-profile preservation until fixtures confirm it.
- **AVIF:** Cloudflare’s managed image service supports AVIF, but that does not imply a self-managed Wasm library does. For self-managed AVIF, jSquash’s `@jsquash/avif` is a documented libavif Wasm encoder/decoder; its Cloudflare usage requires explicit Wasm inclusion/initialisation. This should be a separate experimental path, not silently enabled by a generic `format=auto` implementation.
- **Limits:** Cloudflare documents 128 MB memory per isolate, including Wasm allocations; Workers Paid CPU is 30 seconds by default and configurable up to 5 minutes, while Free is 10 ms per HTTP request. Image processing must reject large compressed inputs and, more importantly, bound decoded pixel dimensions before allocating raw RGBA buffers. Keep one image in memory at a time and cache transformed responses where appropriate. Wasm binaries also count toward the 64 MiB uncompressed Worker size limit, and Wasm increases startup cost.
- **Threading:** Workers supports Wasm SIMD but not Wasm threading. Use single-threaded codec builds; do not rely on SharedArrayBuffer, Web Worker pools, or `@img/sharp-wasm32`’s multi-thread requirement.

## Recommended local reproduction

Build a tiny Worker route around `@cf-wasm/photon/workerd`, import only the Worker entry, and run it through `wrangler dev`/workerd. Cloudflare documents that local Wrangler development uses Miniflare with the workerd runtime, giving the relevant Web API/Wasm execution model. The route should:

1. Fetch or read a bounded source image (`jpeg`/`png` first).
2. Reject by byte size and by decoded width × height before resize.
3. Apply resize with an explicit fit policy.
4. Encode WebP and return `Content-Type`, `Content-Length` when known, and a cache key based on source plus transform parameters.
5. Run fixtures for alpha, all EXIF orientations, sRGB/ICC inputs, large dimensions, malformed bytes, and WebP output validity.

Do not use `format=auto` until Accept-header negotiation and AVIF availability have been tested independently. A safe initial contract is JPEG/PNG input and WebP output, with transparent PNGs preserved and orientation behaviour explicitly verified.

## Sources

- Cloudflare Workers Wasm runtime: <https://developers.cloudflare.com/workers/runtime-apis/webassembly/> (precompiled Wasm, SIMD support, no threading, Wasm/WASI notes).
- Cloudflare Workers Wasm in JavaScript: <https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/> (Wasm module bundling/import model).
- Cloudflare security model: <https://developers.cloudflare.com/workers/reference/security-model/> (Workers customer code is JavaScript/Wasm; native binaries are not uploaded to the network).
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/> (128 MB isolate memory, CPU limits, Worker bundle size, response/request constraints).
- Cloudflare local development: <https://developers.cloudflare.com/workers/local-development/> (Wrangler, Miniflare, workerd execution).
- TanStack Start server entry point: <https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point> (Fetch handler contract and Cloudflare compatibility).
- TanStack Start Cloudflare hosting: <https://tanstack.com/start/latest/docs/framework/react/guide/hosting> (Cloudflare Vite plugin and Wrangler setup).
- IPX source/README: <https://github.com/unjs/ipx> (IPX powered by Sharp/SVGO, URL modifiers, output-dimension safety guidance).
- Sharp installation: <https://sharp.pixelplumbing.com/install/> (native platform binaries, Node-API prerequisite, `@img/sharp-wasm32`, multi-threaded Wasm requirement, single-threaded limitation).
- Sharp output: <https://sharp.pixelplumbing.com/api-output/> and input/operation docs <https://sharp.pixelplumbing.com/api-input/> / <https://sharp.pixelplumbing.com/api-operation/> (WebP/AVIF support, alpha, metadata, colour-space defaults, EXIF auto-orientation reference behaviour).
- `@cf-wasm/photon` package README: <https://www.npmjs.com/package/%40cf-wasm/photon> (Worker entry point, resize/WebP example, memory warning).
- Photon upstream README: <https://github.com/silvia-odwyer/photon> (supported input formats and image operations).
- Photon AVIF issue: <https://github.com/silvia-odwyer/photon/issues/208> (open AVIF decode request).
- jSquash upstream README: <https://github.com/jamsinclair/jSquash> (Cloudflare Worker examples, strict-runtime design, codec packages including AVIF/WebP/resize).
- jSquash AVIF package: <https://www.npmjs.com/package/%40jsquash/avif> (libavif Wasm encode/decode and explicit Cloudflare Wasm initialisation note).

## Executed reproduction

These are local workerd results, not measurements from a deployed Worker or a completed TanStack integration. Dependencies were installed in an isolated temporary directory; the website dependencies and application code were unchanged.

- Config: compatibility date `2026-08-27`, `nodejs_compat`, matching the app.
- IPX `4.0.0-beta.1` with Wrangler `4.127.0`: failed startup at `createRequire` with an undefined path.
- Direct Sharp `0.35.4` with Wrangler `4.127.0`: failed startup at `createRequire`.
- IPX `3.1.1` with Wrangler `4.129.1`: started, but the first real transformation failed: `Could not load the "sharp" module using the linuxnull-x64 runtime`; dynamic require of native `.node` modules was unsupported. This isolates a transformation-engine failure independently of the v4 startup problem.
- Photon `0.4.0` + jSquash WebP `1.5.0` with Wrangler `4.129.1`: returned valid resized WebP images from real repository originals.
- Combined probe dry-run upload: 2,036.44 KiB uncompressed / 769.21 KiB gzip. This is the isolated probe, not the total website bundle.

| Source                | Original bytes | Photon WebP bytes | Photon + jSquash q80 bytes | Output dimensions |
| --------------------- | -------------: | ----------------: | -------------------------: | ----------------- |
| `DSCF7232.jpg`        |      1,210,375 |           804,636 |                     84,308 | 640 × 800         |
| `matthieu-camera.png` |      2,018,832 |           315,964 |                     43,154 | 640 × 483         |

Local handler elapsed times for the combined pipeline were 418 ms and 141 ms respectively. These are single observations, not benchmarks, production latency estimates, or Worker CPU measurements. Production CPU/memory limits and concurrency need separate validation; caching does not eliminate cold transformations.

The output portrait retained alpha values spanning 0–255. A synthetic half-transparent PNG retained alpha 128 exactly after processing. A synthetic JPEG with EXIF orientation 6 exposed a real gap: the pipeline returned 80 × 40 rather than the correctly oriented 40 × 80. Orientation must be applied explicitly before resize. ICC colour conversion and visual fidelity are not validated by these tests. The sample photograph has an ICC profile; the generated output has none.

### Reproduce the successful pipeline

In a disposable directory, install pinned versions:

```sh
npm install --save-exact @cf-wasm/photon@0.4.0 @jsquash/webp@1.5.0 wrangler@4.129.1
```

Use a Wrangler config with `main: "worker.js"`, compatibility date `2026-08-27`, and `compatibility_flags: ["nodejs_compat"]`. Save this as `worker.js`:

```js
import encode, { init } from "@jsquash/webp/encode.js"
import wasm from "@jsquash/webp/codec/enc/webp_enc_simd.wasm"
let ready
import { PhotonImage, SamplingFilter, resize } from "@cf-wasm/photon/workerd"
export default {
  async fetch(request) {
    let input, output
    try {
      await (ready ||= init(wasm))
      const bytes = new Uint8Array(await request.arrayBuffer())
      const start = Date.now()
      input = PhotonImage.new_from_byteslice(bytes)
      const width = Math.min(640, input.get_width())
      output = resize(
        input,
        width,
        Math.round((input.get_height() * width) / input.get_width()),
        SamplingFilter.Lanczos3
      )
      return new Response(
        await encode(
          {
            data: output.get_raw_pixels(),
            width: output.get_width(),
            height: output.get_height(),
          },
          { quality: 80 }
        ),
        {
          headers: {
            "content-type": "image/webp",
            "x-process-ms": String(Date.now() - start),
          },
        }
      )
    } catch (e) {
      return new Response(String(e), { status: 500 })
    } finally {
      output?.free()
      input?.free()
    }
  },
}
```

Run `npx wrangler dev --port 8791`, then POST an original image as bytes using `curl --data-binary @photo.jpg http://localhost:8791 -o result.webp`. This probe is deliberately local-only: it has no production input limits, origin policy, orientation correction, or caching. Do not deploy it as the feature endpoint.

## Selected implementation (2026-09-11)

The newer implementation selects the Cloudflare Images `IMAGES` binding for
Worker-native transforms. The shared image feature in
`apps/web/src/features/images/` contains the build-time metadata generator,
responsive image component, and width policy. A TanStack Start server route
(`apps/web/src/routes/images.$.ts`) owns the app's versioned `/images/...`
endpoint, validates generated metadata and width candidates, reads originals
through the current deployment's `ASSETS` binding, and returns explicit WebP.
The endpoint caches only transformed image variants and falls back to the
original with an uncached response when a transform fails. The older Wasm
recommendation above remains historical.

The existing Cloudflare Workers/TanStack Start deployment and CMS source paths
remain in place. AVIF negotiation is intentionally outside this first binding
contract; the endpoint uses WebP for current browser support and predictable
local/preview behaviour.

This implementation supersedes the earlier self-managed Wasm proposal. The historical findings above remain useful if a self-managed engine is reconsidered. See [Cloudflare’s Images binding documentation](https://developers.cloudflare.com/images/optimization/binding/) for the selected runtime.
