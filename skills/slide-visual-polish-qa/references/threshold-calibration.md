# Threshold Calibration

Calibration run date: 2026-06-20

Project: `C:\Users\USER\Downloads`

Parity hardening note: calibration bands assume PPTX and HTML artifacts are captured in a shared
source-pixel coordinate space. HTML screenshots with hidden browser-fit transforms, mismatched
deviceScaleFactor, or a different webfont than PPTX are invalid calibration inputs. Fix capture scale
and font parity first; do not widen thresholds to absorb those defects.

Deck outputs:

- `out\deck-editable.pptx`
- `out\deck-editable.html`

Selected calibration slides:

- Known-good: slide 1
- Known-bad: slide 12
- Borderline: slide 5

Machine-readable profile:

- `assets/calibration/default-visual-qa-profile.json`

The calibrated `qa-polish` gate distinguishes known-good editable
reconstruction drift, borderline polish-needed slides, and true blocking
failures. Do not use these observations to make slide 12 pass; slide 12 remains
a known-bad sample.

## Metrics

| Slide | Class | Comparison | Pixel diff | MAE | Edge diff | SSIM | Palette drift |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | known-good | PPTX vs source | 0.2049 | 0.0991 | 0.1127 | 0.6116 | 0.1232 |
| 1 | known-good | HTML vs source | 0.1888 | 0.0925 | 0.0944 | 0.6363 | 0.1346 |
| 1 | known-good | PPTX vs HTML | 0.1033 | 0.0506 | 0.0843 | 0.8005 | 0.0482 |
| 5 | borderline | PPTX vs source | 0.2335 | 0.1279 | 0.1303 | 0.4507 | 0.1981 |
| 5 | borderline | HTML vs source | 0.2167 | 0.1265 | 0.1314 | 0.4635 | 0.2236 |
| 5 | borderline | PPTX vs HTML | 0.1267 | 0.0628 | 0.0806 | 0.7496 | 0.0608 |
| 12 | known-bad | PPTX vs source | 0.2647 | 0.1310 | 0.1478 | 0.3764 | 0.3102 |
| 12 | known-bad | HTML vs source | 0.2444 | 0.1295 | 0.1499 | 0.3980 | 0.3417 |
| 12 | known-bad | PPTX vs HTML | 0.1437 | 0.0681 | 0.0936 | 0.7036 | 0.0804 |

## Recommended Profiles

These recommendations are encoded in
`assets/calibration/default-visual-qa-profile.json`.

| Mode | Source/render blocking guard | PPTX/HTML material guard | Expected classification |
| --- | --- | --- | --- |
| `qa-draft` | pixel > 0.32, MAE > 0.16, edge > 0.17, SSIM < 0.35, palette > 0.34 | pixel > 0.17, MAE > 0.08, edge > 0.12, SSIM < 0.65 | report all issues; fail only catastrophic drift |
| `qa-polish` | pixel > 0.25, MAE > 0.14, edge > 0.145, SSIM < 0.42, palette > 0.28; at least two known-bad signals required for blocking | pixel > 0.13, MAE > 0.065, edge > 0.095, SSIM < 0.72; blocking only with key-content/clipping/layout/readability/source-render blocking context | slide 1 minor/acceptable, slide 5 noticeable, slide 12 blocking |
| `qa-strict` | pixel > 0.18, MAE > 0.08, edge > 0.09, SSIM < 0.70, palette > 0.12 | pixel > 0.08, MAE > 0.04, edge > 0.07, SSIM < 0.82 | block even small visual drift |

## Interpretation

- Slide 1 is the best calibration sample in this deck wave. It still exceeds
  current automated source/render thresholds, but manual inspection shows the
  main layout, crops, and content are preserved closely enough to be treated as
  acceptable editable-reconstruction drift.
- Slide 5 is borderline. The structure is recognizable, but spacing, color
  emphasis, and PPTX/HTML agreement need polish before broad acceptance.
- Slide 12 is known-bad. It has broad source/render divergence, high palette
  drift, low SSIM, and a material PPTX/HTML disagreement. It must not be made to
  pass by threshold relaxation.

## Wave 1 Fix-Planning Refinement

Completed Wave 1 polish showed that slides can move from blocking to
`needs_polish` through different reconstruction strategies while thresholds
remain unchanged:

- STOP/source technical decoration: recommend native halo, rule, icon,
  connector, and color-emphasis density before any crop discussion.
- Manifold/routing and pump/HPU/power schematic detail: recommend native
  line/node/connector density first, then small metadata-rich non-text
  technical crops when native approximation is visibly worse.
- Line-up board material drift: recommend native board/table/status structure
  plus small non-text decorative texture crops when the material surface drives
  palette drift.
- Noticeable PPTX/HTML mismatch: recommend helper/layout parity fixes, not
  threshold relaxation.

This refinement changes issue taxonomy and fix-plan specificity only. The
known-good, borderline, and known-bad metric bands above are unchanged.

## Classification Fields

Per-slide `visual_metrics.json` and `visual_polish_fixes.json` include:

- `overallStatus`: `pass`, `needs_polish`, or `fail`
- `severity`: `pass`, `minor`, `noticeable`, or `blocking`
- `metricSignals`: per-comparison known-good, borderline, and known-bad evidence
- `issueSignals`: explicit critical signals such as missing artifacts, clipping,
  content loss, layout break, or full-slide shortcut
- `pptxHtmlConsistency`: calibrated PPTX/HTML agreement classification
- `sourceRenderSimilarity`: calibrated source/render classification
- `slideContext`: text/native-object evidence used to identify technical,
  schematic, STOP/flow, or board-specific repair strategies
- `editableReconstructionToleranceApplied`: whether qa-draft/qa-polish
  tolerated acceptable editable reconstruction drift
- `confidence` and `rationale`

## Mode Behavior

- `qa-draft`: fails only missing required artifacts or explicit critical
  blocking signals; `needs_polish` is allowed.
- `qa-polish`: fails blocking issues; allows `needs_polish` when fix plans exist.
- `qa-strict`: fails blocking, noticeable, and material PPTX/HTML mismatch.

## Capture And Font Preconditions

- HTML capture should request generated renderer QA/static mode (`?qa=1`) and record
  `qaStaticModeUsed`, `appliedScale`, slide bounding box, viewport, deviceScaleFactor, and exact PNG
  dimensions.
- The HTML PNG must match the source dimensions exactly, such as `1672x941` for this deck.
- PPTX and HTML should resolve the same local font family. If the requested profile font is not
  available to PPTX rasterization, use a documented fallback for both outputs or fail with setup
  instructions.
- Thresholds must remain unchanged when a render/capture bug is found.

## Known Limitations

- Source-vs-render SSIM and pixel metrics penalize intentional editable
  reconstruction differences such as native redraws replacing dense imagery.
- Pixel metrics overweight antialiasing, font fallback, raster DPI, and crop
  smoothing.
- PPTX rasterization at 1920x1080 is resized to the 1672x941 source coordinate
  space for comparison, which can add interpolation noise. HTML screenshots should not need this
  correction when QA/static mode is working.
- PPTX/HTML agreement is often more useful than source similarity for detecting
  renderer divergence, but it does not prove the reconstruction matches the
  source.
- Metrics are evidence. Blocking classification still requires visual review of
  missing content, wrong layout, full-slide shortcuts, and key diagram/table
  fidelity.
