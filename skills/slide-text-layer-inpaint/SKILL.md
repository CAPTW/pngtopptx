---
name: slide-text-layer-inpaint
description: >-
  Preprocess slide source images by mapping semantic text, pseudo text, micro text,
  decorative glyph-like text, and unresolved text-like regions; generate text and
  inpainting masks; and create clean background assets for downstream faithful slide
  reconstruction. Use before slide-image-dual-render when source screenshots need a
  separated text layer and controlled background cleanup. This skill never edits PPTX/HTML
  renderer files and never weakens slide-image-dual-render hardlock gates.
---

# Slide Text Layer Inpaint

## Purpose

This companion skill prepares slide screenshots for faithful reconstruction. It separates
the visual text layer from the background, records corrected semantic text, prevents pseudo
text from becoming wrong native text, and produces controlled inpainted background assets.

It is a preprocessing skill only. It does not render PPTX or HTML, does not modify renderer
files, and does not replace the hardlocked reconstruction workflow in `slide-image-dual-render`.

## Required Per-Slide Artifacts

Each slide must write the following files under `work/slideXX/`:

```text
work/slideXX/text_regions.json
work/slideXX/text_mask.png
work/slideXX/pseudo_text_mask.png
work/slideXX/inpaint_mask.png
work/slideXX/mask_overlay.png
work/slideXX/mask_expanded_overlay.png
work/slideXX/mask_delta_overlay.png
work/slideXX/background_regions.json
work/slideXX/clean_background.png
work/slideXX/inpainting_report.json
work/slideXX/inpainting_report.md
work/slideXX/residual_text_report.json
work/slideXX/residual_text_overlay.png
```

`text_regions.json` is the authoritative source. OCR and CV outputs are evidence only, never
truth. The masks and clean background must be regenerated from the resolved region file.

`text_regions.json` must also bind the artifact set to the exact source image:

- `schemaVersion`
- `sourceImageHash`
- `coordinateSpace.width`
- `coordinateSpace.height`
- `coordinateSpace.units = source_px`

Strict validation fails if this metadata is missing, unsupported, or does not match the
provided source image. Legacy validation without `--strict` may be used only to inspect old
artifacts that predate this metadata.

## Hard Rules

- Do not treat OCR output as truth. OCR text belongs in evidence fields unless it is corrected.
- Classify each text-like region as `semantic_text`, `pseudo_text`, `micro_text`,
  `decorative_glyph`, or `unknown_text`.
- `semantic_text` requires non-empty `correctedText`.
- `pseudo_text` must not be converted into incorrect native text.
- `unknown_text` fails validation unless resolved or exception-approved with a reason.
- Inpainting is background cleanup only.
- Inpainting is not always the right cleanup method; flat panels, cards, table cells,
  labels, and rule-backed text should prefer deterministic redraw or native shape
  reconstruction.
- Inpainting must not be used as a substitute for native reconstruction.
- Do not modify PPTX or HTML renderer files.
- Do not modify `slide-image-dual-render` hardlock gates.
- If integration is needed, use the artifact handoff contract in
  `references/handoff-to-slide-image-dual-render.md`.

## Workflow

Process one slide at a time. Keep each slide isolated in its own `work/slideXX/` directory.

1. Generate candidate regions:

```powershell
python "$env:USERPROFILE\.codex\skills\slide-text-layer-inpaint\scripts\detect_text_regions.py" `
  --image src\slide01.png `
  --slide-id slide01 `
  --out work\slide01\text_regions.json
```

2. Resolve `text_regions.json` manually or with a mapper agent:

- Correct every semantic text string in `correctedText`.
- Keep OCR text in `evidence.ocrText`.
- Mark unresolved text-like regions as `unknown_text` only while drafting.
- Do not add native text fields to `pseudo_text` or `decorative_glyph`.

3. Generate expanded masks and QA overlays. Defaults intentionally cover anti-aliased
   text edges and modest shadow/glow residue without expanding into neighboring content:

```powershell
python "$env:USERPROFILE\.codex\skills\slide-text-layer-inpaint\scripts\make_text_masks.py" `
  --image src\slide01.png `
  --regions work\slide01\text_regions.json `
  --out-dir work\slide01 `
  --dilate-px 3 `
  --pseudo-dilate-px 2 `
  --shadow-dilate-px 5 `
  --feather-px 1 `
  --min-region-pad 2 `
  --debug-overlays
```

4. Classify the background under each text region:

```powershell
python "$env:USERPROFILE\.codex\skills\slide-text-layer-inpaint\scripts\classify_background_regions.py" `
  --image src\slide01.png `
  --regions work\slide01\text_regions.json `
  --out work\slide01\background_regions.json
```

5. Repair text backgrounds. This redraws flat/panel/table-cell regions deterministically
   and reserves inpainting for gradient or photo/texture regions:

```powershell
python "$env:USERPROFILE\.codex\skills\slide-text-layer-inpaint\scripts\repair_text_backgrounds.py" `
  --image src\slide01.png `
  --regions work\slide01\text_regions.json `
  --background-regions work\slide01\background_regions.json `
  --mask work\slide01\inpaint_mask.png `
  --out work\slide01\clean_background.png `
  --report-json work\slide01\inpainting_report.json `
  --report-md work\slide01\inpainting_report.md
```

The older generic inpainting command remains available for controlled texture/gradient-only
cases, but it is not the preferred production cleanup path:

```powershell
python "$env:USERPROFILE\.codex\skills\slide-text-layer-inpaint\scripts\inpaint_text_regions.py" `
  --image src\slide01.png `
  --regions work\slide01\text_regions.json `
  --mask work\slide01\inpaint_mask.png `
  --out work\slide01\clean_background.png `
  --report-json work\slide01\inpainting_report.json `
  --report-md work\slide01\inpainting_report.md
```

6. Detect residual text ghosts:

```powershell
python "$env:USERPROFILE\.codex\skills\slide-text-layer-inpaint\scripts\detect_residual_text.py" `
  --before src\slide01.png `
  --after work\slide01\clean_background.png `
  --regions work\slide01\text_regions.json `
  --mask work\slide01\inpaint_mask.png `
  --out-json work\slide01\residual_text_report.json `
  --out-overlay work\slide01\residual_text_overlay.png
```

7. Run final strict enforcement:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-text-layer-inpaint\scripts\enforce_text_layer.js" `
  --slide work\slide01 `
  --image src\slide01.png `
  --strict `
  --require-residual-check `
  --max-residual-risk medium
```

## Handoff To slide-image-dual-render

The downstream reconstruction skill may read:

- `text_regions.json` to verify source-image integrity and place corrected semantic text as
  native editable objects.
- `text_mask.png` to verify that native text does not duplicate baked text.
- `pseudo_text_mask.png` to identify pseudo/decorative regions that should not become wrong text.
- `clean_background.png` as a background cleanup asset or reference image.
- `background_regions.json`, `mask_overlay.png`, expanded/delta overlays, and residual
  reports for QA.

The downstream skill must still reconstruct the slide with its approved backend-agnostic renderer,
native object manifests, QA gates, and final delivery gates. This companion skill does not authorize
crop-heavy preservation or renderer bypasses.

Strict handoff validation should use:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-text-layer-inpaint\scripts\enforce_text_layer.js" `
  --slide work\slide01 `
  --image src\slide01.png `
  --strict `
  --require-residual-check `
  --max-residual-risk medium
```

## Dependencies

Required for the Python scripts:

```bash
pip install pillow numpy opencv-python
```

Optional OCR evidence:

```bash
pip install pytesseract
```

If using pytesseract, the Tesseract binary and language data must also be installed on the system.
OCR remains evidence only.

Required for enforcement:

```bash
node scripts/enforce_text_layer.js --help
```

No npm package dependencies are required for `enforce_text_layer.js`.

## Reference Files

- `references/text-region-schema.md` - authoritative JSON contract.
- `references/pseudo-text-policy.md` - how to handle text-like marks that must not become native text.
- `references/inpainting-policy.md` - allowed and forbidden inpainting use.
- `references/handoff-to-slide-image-dual-render.md` - clean artifact handoff contract.
