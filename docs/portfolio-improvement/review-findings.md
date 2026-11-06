# Review findings and disposition

The first independent review round covered `ba1ae85..7ea6ad1`. Three reviewers inspected all thirteen valid screenshots and the diff. Each performed additional browser checks. All identified the same focus regression and recommended retaining the overall direction after repairs.

| Finding IDs   | Decision                      | Resolution and evidence                                                                                                                                                                                                                                                                                                                      |
| ------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR-01, R1, F1 | Accepted, blocking            | Replace text-colored focus outlines with ink on light surfaces. Preserve paper outlines on toast and gallery controls through the base CSS layer. Browser check asserts both contexts.                                                                                                                                                       |
| CR-02, R2, F9 | Accepted                      | Assert the skip fragment, sticky-header clearance, and next focused element inside main on all four shell routes. Assert navigation URL. Record stylesheet hashes with the browser results.                                                                                                                                                  |
| R3, F3        | Accepted                      | Add main scroll margin and the missing target to the unlisted iterations route. No experimental route is added to public navigation.                                                                                                                                                                                                         |
| F2            | Accepted                      | Remove the custom selection rule and retain browser selection behavior on both surfaces.                                                                                                                                                                                                                                                     |
| CR-03, R5, F4 | Accepted as design refinement | Increase desktop portrait width. Below 640px omit the portrait so the introduction leads directly into the photographs. Retain the personal portrait on home and tablet/desktop photography.                                                                                                                                                 |
| R4, F7        | Accepted                      | Use a text underline with an explicit offset while retaining the 44px contact target.                                                                                                                                                                                                                                                        |
| R6, F6        | Accepted                      | Use an auto-width date/logo column at tablet widths so the company follows it.                                                                                                                                                                                                                                                               |
| R8, F5        | Accepted                      | Restore the visible photography eyebrow.                                                                                                                                                                                                                                                                                                     |
| R7, F8        | Accepted evidence correction  | The initial log is a reconstructed narrative. Its first eight timestamps are unreliable and explicitly superseded by an appended correction. Remove process/session details from the report and place the measurement script with other scripts. Keep the historical measurements and report because documentation was explicitly requested. |

No added code comments or suppressions required removal. The existing Base UI constraint comment predates this change.

The first round had no disagreement on a blocking defect. Portrait size and tablet alignment were judgments, not accessibility failures. Keeping a committed evidence report is authorized by the request to document the work; it needs no additional approval.

## Verification boundaries

The browser check uses Chromium. Document overflow does not prove that no ancestor clips content. Reduced-motion coverage checks scroll behavior, not every animation. Gallery checks cover controls and counters; they are not exhaustive image/network failure tests. Safari, screen readers, real mobile hardware, and deployed image transformations remain unverified.

The invalid experience baseline and missing mobile collection baseline must not appear as before/after comparisons. Final screenshot attachments belong in the PR; PNGs stay outside git.

## Focused recheck

The focused second round reviewed `57bf765`, reran the browser script, matched served stylesheet hashes and emitted byte counts, and verified the corrected audit trail. It confirmed the original repairs but found one additional error-state regression.

| Finding | Decision           | Resolution                                                                                                                                                                          |
| ------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR-01   | Accepted, blocking | Add a paper focus outline to the gallery retry button. Force image failure in the browser check, assert the retry outline, restore requests, and verify that retry loads the image. |
| RR-O1   | Accepted tradeoff  | Tablet company names can differ by about 4px because each date/logo column fits its content. Keep the simpler per-record grid.                                                      |
| RR-O2   | Deferred           | The hidden mobile camera portrait may still load. This pass makes no image-transfer or speed claim.                                                                                 |
| RR-O3   | Clarified          | Focus-color checks cover sampled light-surface actions; header links and every thumbnail are not exhaustively asserted.                                                             |
| RR-O4   | Accepted           | Identify reconstructed timestamp rows 6–8 explicitly.                                                                                                                               |

The lead verified the one-line retry repair and recovery assertion after rebuilding. No additional full review was needed. Final screenshots include the retry error state. The audit review found no remaining evidence-integrity issue after the timestamp correction.
