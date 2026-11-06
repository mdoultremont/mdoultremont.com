# Portfolio refinement evidence

This pass improves the portfolio's hierarchy, responsive composition, and keyboard navigation while preserving its content and personal identity. It includes four implementation iterations and independent review. Visual quality is a design judgment, not an objective score.

## Scope and iterations

Baseline `ba1ae85` includes the startup configuration fix. That fix, production JSON, CMS configuration, and private tools are unchanged. The warm paper, charcoal, red punctuation, personal portraits, and animated face remain.

1. `f5652bf` replaces equal career cards with chronological rows, reduces hero grain, relaxes display tracking, enlarges navigation labels, and adds skip navigation.
2. `7ea6ad1` prioritizes the photography collection, compacts its introduction, corrects responsive image sizes, and adds browser verification.
3. Independent review found an invisible focus ring on primary buttons. The final revision fixes light/dark focus contrast, adds the missing experimental-page skip target and sticky-header clearance, strengthens verification, and removes the custom text-selection rule. It restores the photography eyebrow, enlarges the desktop portrait, removes its separate mobile row, corrects the contact underline, and tightens tablet career alignment.

4. The focused recheck found one remaining dark-surface control, the gallery retry button. It now uses a paper outline. A forced image failure verifies that focus ring and recovery after retry.
5. After comparing five prototyped orderings, the owner chose a sidebar layout: the heading and introduction sit beside the career history on desktop. Each entry reads logo and company, then date, then summary. Separators run to the right frame border and extend 40px into the gap on the left. Below 1024px the heading stacks above the history and separators run between both frame borders.

The existing profile, experience array, and photograph array remain the data shapes. No dependency, abstraction, or new state model was added.

[Review findings](review-findings.md) records every finding and disposition. [Decisions](decisions.tsv) preserves the ordered trail. **The first eight log timestamps were reconstructed and are unreliable.** An appended correction supersedes them; do not treat them as measured event times. Rows 6–8 even postdate their containing commit. Commit history is the reliable chronology.

## Before and after

| Measurement                                                   |      Baseline | Final revision |
| ------------------------------------------------------------- | ------------: | -------------: |
| Complete collection photographs in initial 390 × 844 viewport |             0 |              1 |
| Navigation font size                                          |          12px |           14px |
| All emitted client JavaScript                                 | 566,500 bytes |  566,785 bytes |
| All emitted CSS                                               |  49,661 bytes |   49,986 bytes |

The image count is observed in the matching photography captures. Font size is the rendered CSS rule. Asset counts come from production output and include experimental-route chunks, not just the initial page request. The increases are 285 JS bytes and 325 CSS bytes. [Before](before-assets.json) and [after](after-assets.json) contain individual raw/gzip file counts. There is no loading-speed or Lighthouse claim.

Measurements use macOS, Node 22.23.2 and pnpm 11.22.0. Byte counts are deterministic file lengths; timing trials would not establish anything about them. Local Worker image transformation can fall back to original assets, so local network timings would not represent production.

## Screenshots

The PR attaches the durable visual evidence. Capture names below identify the source artifacts; PNGs are deliberately outside git.

| State                            | Before                                    | After                                          |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| Home desktop/mobile              | `before-home-{desktop,mobile}.png`        | `after-home-{desktop,mobile}.png`              |
| Photography desktop/mobile       | `before-photography-{desktop,mobile}.png` | `after-photography-{desktop,mobile}.png`       |
| Collection desktop               | `before-collection-desktop.png`           | `after-collection-desktop.png`                 |
| Experience desktop/mobile/tablet | No valid baseline                         | `after-experience-{desktop,mobile,tablet}.png` |
| Collection mobile                | Not captured                              | `after-collection-mobile.png`                  |
| Focus on collection/gallery      | Review identified the original defect     | `after-focus-{collection,gallery}.png`         |

Capture viewports are 1440 × 900 and 390 × 844 CSS pixels, with final tablet checks at 768 × 1024. T3 captured the unchanged baseline, exporting desktop at 1280 × 800 and mobile at 780 × 1688. After two repeated `Preview automation snapshot timed out after 15000ms` failures, Playwright captured the final Chromium pages at the same CSS viewports and DPR 1. Compare composition, not raster pixels.

The early `before-experience-desktop.png` is invalid because it caught an unsettled scroll frame. It is excluded from comparisons. There is no before mobile collection image. Original and intermediate captures are retained locally for audit; only valid evidence belongs in the PR.

## Reproduce

From repository root, build before starting the production preview. Restart the preview after rebuilding, since a running Worker can retain stale asset references.

```sh
pnpm build
pnpm --filter @mdoultremont/portfolio preview --port 4183
node apps/web/scripts/measure-portfolio.mjs apps/web/dist/client/assets
node apps/web/scripts/verify-portfolio.mjs http://localhost:4183
node apps/web/scripts/capture-portfolio.mjs /tmp/portfolio-captures http://localhost:4183
pnpm check
```

The browser check covers both public routes at 320, 390, 768, 1024, and 1440px. It checks HTTP 200, one h1, document overflow, local fragments, real clipboard contents, navigation URL, desktop gallery keyboard controls, 320px gallery controls, and reduced-motion scrolling.

The revised check asserts skip destinations, header clearance, and keyboard continuation on all four shell routes. It checks ink focus outlines on sampled light-surface actions and paper outlines on toast/gallery controls. A forced image failure checks the retry focus ring and successful recovery. Assertions wait for CSS color transitions to settle. [Browser results](browser-checks.json) record the browser version, timestamp and served stylesheet hashes so the artifact can be matched to the measured build.

## Verification and limits

Root `pnpm check` and `pnpm build` passed for the final revision. The revised browser script also passed all ten public route/width combinations and the additional interaction checks. Reviewers independently reproduced the original focus defect and confirmed existing clipboard, gallery and skip behavior.

A first revision check encountered stale preview asset references after rebuilding. Restarting the preview corrected the environment. An immediate outline-color assertion then sampled a CSS transition; waiting for its settled color corrected the check. These failed attempts are not counted as successful verification.

These are focused functional checks, not an accessibility certification. Document width cannot rule out clipping inside an ancestor. Reduced-motion coverage verifies scrolling, not every animation. The first gallery image is checked for successful loading; controls/counters do not cover all image/network failures. Safari, screen readers, real mobile hardware, LinkedIn availability, and deployed Cloudflare image transformations remain unverified. No deployment or merge is included. A final local rebuild initially ran out of disk space; only generated build output was removed, then the build and checks passed after space was available.
