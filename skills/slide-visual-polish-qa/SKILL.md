---
name: slide-visual-polish-qa
description: Companion visual QA for editable slide reconstruction workflows. Use after slide-image-dual-render has produced PPTX/HTML slide outputs and work artifacts to compare source slide images against rendered PPTX rasters and HTML screenshots, compute perceptual/pixel/edge differences, classify visual fidelity issues, and generate actionable polish fix plans without generating, repairing, or directly editing PPTX/HTML.
---

# Slide Visual Polish QA

## Purpose

Use this Skill as the third companion in the slide reconstruction workflow:

1. `slide-text-layer-inpaint` handles text separation, masks, clean backgrounds, and residual text checks.
2. `slide-image-dual-render` handles editable reconstruction, PPTX/HTML generation, hardlock gates, and PPTX openability.
3. `slide-visual-polish-qa` evaluates visual fidelity after those outputs exist.

This Skill compares source slide images against rendered PPTX and HTML outputs, creates raster diff artifacts, computes metrics, and writes actionable polish reports/fix plans. It does not generate final PPTX/HTML, does not repair PPTX, does not save files through PowerPoint or LibreOffice, does not weaken any hardlock gate, and does not modify Skill files.

## Expected Inputs

Run this Skill after reconstruction outputs exist, typically:

- `out/deck.pptx` or `out/deck-editable.pptx`
- `out/deck.html` or `out/deck-editable.html`
- `out/native_object_manifest.json`
- `out/crop_coverage_summary.json`
- `src/slideN.png`
- `work/slideXX/` reconstruction artifacts

Use this Skill in waves:

- One slide when debugging a specific visual mismatch.
- A 3-5 slide wave when checking a reconstruction batch.
- Full deck summary when preparing a deck-level QA report.

## Delivery Modes

- `qa-draft`: report issues only; do not fail on moderate visual differences.
- `qa-strict`: fail on blocking visual differences.
- `qa-polish`: generate prioritized fix plans for slide reconstruction workers.

## Artifact Contract

Per slide:

```text
work/slideXX/visual_qa/
  source.png
  pptx_raster.png
  html_screenshot.png
  pptx_diff.png
  html_diff.png
  pptx_edge_diff.png
  html_edge_diff.png
  visual_metrics.json
  visual_polish_report.md
  visual_polish_fixes.json
```

Deck-level outputs:

```text
out/visual_qa_summary.json
out/visual_qa_summary.md
out/qa/contact_sheet.png
```

## Workflow

1. Rasterize PPTX slides diagnostically with `scripts/rasterize_pptx.py`.
2. Capture HTML slide screenshots diagnostically with `scripts/capture_html_screenshot.py`.
3. Compare source, PPTX raster, and HTML screenshot with `scripts/compare_slide_images.py`.
4. Summarize per-slide results with `scripts/generate_visual_qa_summary.js`.
5. Enforce the selected QA mode with `scripts/enforce_visual_qa.js`.

Load these references when needed:

- `references/screenshot-raster-policy.md` for diagnostic-only rendering rules.
- `references/metric-policy.md` for metric interpretation and severity policy.
- `references/polish-fix-plan-schema.md` for `visual_polish_fixes.json`.
- `references/visual-qa-workflow.md` for one-slide, wave, and deck workflows.
- `references/handoff-to-slide-image-dual-render.md` for passing fix plans back to reconstruction.

HTML capture must use natural source-pixel coordinates. For `slide-image-dual-render` outputs, the
capture script requests `?qa=1`, records viewport/deviceScaleFactor/slide bounding box/applied scale,
and fails if `html_screenshot.png` is not exactly the requested `--width × --height`.

For full-deck QA, `--slides` is legacy physical-output slide numbering and works when physical slide
numbers match source slide IDs. For selected wave outputs, use `--source-slides` so the original
source IDs are saved under the right `work/slideXX/visual_qa/` folders while the wave PPTX/HTML is
read sequentially from physical/rendered slides 1..N. If needed, provide `--physical-slides`,
`--slide-map`, or `--trace` for explicit mappings.

## One-Slide Example

```powershell
cd C:\path\to\deck

python "$env:USERPROFILE\.pngtopptx\skills\slide-visual-polish-qa\scripts\rasterize_pptx.py" --project . --pptx out\deck-editable.pptx --slides 12 --out-dir work

python "$env:USERPROFILE\.pngtopptx\skills\slide-visual-polish-qa\scripts\capture_html_screenshot.py" --project . --html out\deck-editable.html --slides 12 --out-dir work --width 1672 --height 941

python "$env:USERPROFILE\.pngtopptx\skills\slide-visual-polish-qa\scripts\compare_slide_images.py" --project . --slides 12 --mode qa-polish --source-dir src --qa-dir work --out-summary out\visual_qa_summary.json

node "$env:USERPROFILE\.pngtopptx\skills\slide-visual-polish-qa\scripts\generate_visual_qa_summary.js" --project . --slides 12 --out-json out\visual_qa_summary.json --out-md out\visual_qa_summary.md

node "$env:USERPROFILE\.pngtopptx\skills\slide-visual-polish-qa\scripts\enforce_visual_qa.js" --project . --slides 12 --mode qa-polish --summary out\visual_qa_summary.json --require-pptx --require-html
```

## Wave Output Example

Use `--source-slides` when the PPTX/HTML contains only selected source slides:

```powershell
python "$env:USERPROFILE\.pngtopptx\skills\slide-visual-polish-qa\scripts\rasterize_pptx.py" --project . --pptx out\deck-wave-polish-8-13.pptx --source-slides 8,10,11,12,13 --out-dir work

python "$env:USERPROFILE\.pngtopptx\skills\slide-visual-polish-qa\scripts\capture_html_screenshot.py" --project . --html out\deck-wave-polish-8-13.html --source-slides 8,10,11,12,13 --out-dir work --width 1672 --height 941

python "$env:USERPROFILE\.pngtopptx\skills\slide-visual-polish-qa\scripts\compare_slide_images.py" --project . --slides 8,10,11,12,13 --mode qa-polish --source-dir src --qa-dir work --out-summary out\visual_qa_summary_wave1.json
```

This maps source slide 8 to physical/rendered slide 1, source slide 10 to physical/rendered slide 2,
and so on, while writing outputs to `work/slide08`, `work/slide10`, etc.

## Guardrails

- Do not treat a screenshot or PPTX raster as a replacement for editable reconstruction.
- Do not recommend full-slide crops as fixes.
- Do not recommend weakening final gates, hardlocks, openability checks, or crop coverage gates.
- Do not recommend direct PPTX editing or saving through PowerPoint/LibreOffice.
- Prefer per-slide fragment fixes first, for example `work/slide12/s12.fragment.js`.
- Leave shared files such as `lib/slides.js`, renderer code, and hardlock files to the main reconstruction workflow integrator.
