# Portfolio refinement evidence

The goal is a more polished personal portfolio, with a stable implementation for independent design review. This report does not assign an objective design score. The parent review owns further findings and the final pull request.

## Scope and design decisions

The baseline is `ba1ae85`. Only the portfolio and its verification material changed. Production content, record order, CMS schema, private tools, and `.codex/config.toml` are unchanged. The existing warm paper, charcoal, red punctuation, personal portraits, and animated face remain the visual identity.

Initial inspection found that the photography portrait and oversized introduction delayed the actual collection, especially on mobile. The career history presented four equal boxed panels, with repeated gradients and grain competing with the text. Navigation text was small and the shared shell lacked a skip link. The gallery's image `sizes` breakpoint also disagreed with its two-column layout breakpoint.

The first implementation uses ruled chronological rows for career records, reduces hero grain, slightly relaxes display tracking, enlarges navigation labels, adds visible focus outlines and a skip link, and gives the photography introduction a smaller supporting portrait. It preserves the existing collection and modal. Image sizes now describe the actual portrait and gallery widths. The personal experimental page receives only the skip-link target because it shares the shell. No experimental page is linked from public navigation.

The second iteration follows inspection of the production screenshots. It makes the collection link the primary photography action and increases the mobile camera portrait from 96 to 144 CSS pixels. This retains a personal touch without returning to the original full-width portrait. It also adds rerunnable browser verification.

The data shapes remain the existing validated profile, experience array, and photograph array. No new state model, dependency, or component abstraction is needed. Work proceeded serially in this shared checkout; build and static checks could run independently. The critical dependency was capturing the unchanged UI before any source edit.

## Captures

All PNG files are outside git under `/tmp/portfolio-improvement-c028a893/`.

- `before-home-desktop.png`, `before-home-mobile.png`
- `before-photography-desktop.png`, `before-photography-mobile.png`
- `before-collection-desktop.png`
- `after-home-desktop.png`, `after-home-mobile.png`
- `after-photography-desktop.png`, `after-photography-mobile.png`
- `after-experience-desktop.png`, `after-experience-mobile.png`
- `after-collection-desktop.png`, `after-collection-mobile.png`

The unchanged screenshots were captured using T3 preview before editing. The requested viewports were 1440 × 900 and 390 × 844 CSS pixels. T3 exported desktop images scaled to 1280 × 800 and mobile images at 780 × 1688. The after captures use Playwright at the same CSS viewports, with device scale factor 1. Compare composition, not raw image pixels. T3 snapshot repeatedly failed with `Preview automation snapshot timed out after 15000ms` after the first build; this is why the capture tool changed. Both use Chromium and the local production preview.

An early file named `before-experience-desktop.png` captured a stale frame during smooth scrolling. It is **not valid experience baseline evidence**. The baseline collection screenshot was recaptured after scrolling settled. There is no valid before mobile collection or before experience screenshot. Do not present those as covered. All listed final after images were inspected; the invalid baseline remains outside git for audit transparency.

## Reproduction

From repository root:

```sh
pnpm build
pnpm --filter @mdoultremont/portfolio preview --port 4183
node docs/portfolio-improvement/measure.mjs apps/web/dist/client/assets
node apps/web/scripts/verify-portfolio.mjs http://localhost:4183
node apps/web/scripts/capture-portfolio.mjs /tmp/portfolio-improvement-c028a893
pnpm check
```

The capture script uses port 4183. The browser script takes a base URL. Playwright and Chromium were already installed. No dependencies were added. The first preview attempt started before the baseline build finished and failed because the generated Wrangler config did not yet exist. Restarting after the build succeeded.

Environment is macOS, Node v22.23.2, pnpm 11.22.0, 12 logical cores. Initial load averages were 4.40, 5.06, 4.76. Measurements use the production Vite output, not dev server responses. The baseline and final asset inventories include raw and gzip byte counts for each emitted client JS and CSS file. Gzip is computed locally with Node zlib. This is not a deployed transfer measurement.

## Verification and limits

The browser harness checks both public routes at widths 320, 390, 768, 1024, and 1440. It asserts HTTP 200, a single h1, no document overflow, and valid local fragment links. It also tests keyboard skip navigation, actual clipboard contents after copying email, navigation between pages, desktop gallery ArrowRight and Escape, narrow gallery next and close controls, and reduced-motion scroll behavior. It records browser exceptions. These are focused functional checks, not a full accessibility certification.

The design detector returned an empty findings array. It is not evidence of a visual quality score. Root check and build outcomes, emitted asset totals, and final raw artifacts are recorded below at handoff. No Lighthouse score, loading speedup, or timing improvement is claimed. No repeated timing trials were run because this pass makes no timing decision. Emitted bytes are deterministic artifact counts and need no timing statistics.

Text contrast uses the existing palette. The paper/ink and paper/muted pairs are unchanged; the red dot is decorative. The new focus outline inherits each control's foreground color. A screen-reader audit, all modal failure states, external LinkedIn availability, Safari, and real mobile hardware remain unverified. Image transformation and network behavior on Cloudflare can differ from the local Worker. The local server returns original image assets when transformation is unavailable.

## Review brief

Review from the baseline through HEAD. Inspect photography at the top and at the collection, professional history at desktop and mobile, and the footer contact interaction. Challenge whether the smaller camera portrait feels intentional, whether the chronological rows improve scanning, and whether the page preserves Matthieu's identity. Review functional regressions separately from aesthetic preferences. Re-run the browser harness against the production server. Check the committed decision log against the artifacts above. The original startup configuration fix must remain intact.

## Final results

- `pnpm check` passed at root, including formatting, lint, typechecks, and workspace tests. Log: `/tmp/portfolio-improvement-c028a893/final-check.log`.
- `pnpm build` passed at root. Log: `/tmp/portfolio-improvement-c028a893/final-build.log`. The unchanged root build also passed; its log is `before-build.log` in the same directory.
- `node apps/web/scripts/verify-portfolio.mjs` passed against the final production preview. All ten route/width combinations passed. No browser exceptions were recorded. The committed `browser-checks.json` contains the raw results and browser version.
- `node apps/web/scripts/capture-portfolio.mjs /tmp/portfolio-improvement-c028a893` completed successfully after the final build.
- `git diff --check` passed. The design detector returned `[]` before the final action-order and portrait-size refinement. It was not rerun for a cosmetic-only change.
- All emitted client JavaScript totals 566,500 bytes before and 566,675 bytes after. CSS totals 49,661 bytes before and 50,259 bytes after. These totals include chunks for experimental routes, not just initial public-route requests. They demonstrate the size of the change, not a performance improvement. File-by-file raw and gzip inventories are committed as `before-assets.json` and `after-assets.json`.
- The production preview remains at `http://localhost:4183`, listening process PID 97969, terminal session 76524. T3 tabs opened by this implementation pass were closed.

The first signed implementation commit is `f5652bf`. The second commit contains the visual refinement, browser scripts, and final evidence. Both commits contain SSH signatures; local signature verification lacks an allowed-signers file. No signing fallback was needed. No push or pull request was made.
