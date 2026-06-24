# Inpainting Policy

Inpainting is allowed only for background cleanup after text-like regions have been
identified and resolved. It is not a reconstruction shortcut.

Text ghosting usually comes from tight OCR boxes, anti-aliased edges, shadows/glows outside
the text box, and using generic inpainting where the background is actually a flat panel,
card, table cell, label, or rule-backed shape. The repair workflow must first decide whether
the correct operation is redraw, inpaint, native reconstruction, or manual review.

## Allowed Uses

- Remove semantic text from a background asset so downstream reconstruction can place
  corrected native text without duplication.
- Remove pseudo text or decorative glyphs when they sit on otherwise reconstructable
  background.
- Clean tiny text remnants from cropped background panels after native reconstruction has
  a separate plan.
- Produce an analysis asset for QA and measurement.

## Forbidden Uses

- Replacing native reconstruction with a flattened cleaned image.
- Removing meaningful charts, icons, photos, diagrams, or product UI elements.
- Covering uncertainty about text classification.
- Inpainting `unknown_text` without exception approval.
- Using a high-coverage mask to preserve an entire slide as a background image.
- Treating inpainted output as proof that semantic content was reconstructed.
- Running generic inpainting over flat panels, cards, table cells, or labels when
  deterministic redraw is cleaner and safer.
- Inpainting over chart, icon, or complex unknown regions without review.

## Mask Expansion Policy

Masks must cover the visible text plus anti-aliased edges. The mask generator exposes:

- `--dilate-px` for semantic text; default `3`.
- `--pseudo-dilate-px` for pseudo/decorative text; default `2`.
- `--shadow-dilate-px` for shadow/glow/low-confidence regions; default `5`.
- `--feather-px` for soft mask edge QA; default `1`.
- `--min-region-pad` as a minimum per-region pad; default `2`.

Bold titles, headers, low-confidence regions, and regions whose metadata mentions shadow,
glow, halo, or blur should expand more than micro text. Expansion must stay in source-pixel
coordinate space and must not cross into neighboring meaningful objects.

QA overlays:

- `mask_overlay.png` shows source text boxes.
- `mask_expanded_overlay.png` shows the final expanded cleanup mask.
- `mask_delta_overlay.png` shows expansion beyond the base box/pad.

## Background-Type-Specific Repair

`classify_background_regions.py` writes `background_regions.json` and assigns each text
region one of:

- `flat_color`
- `gradient`
- `panel`
- `table_cell`
- `rule_line`
- `icon_area`
- `chart_area`
- `photo_texture`
- `complex_unknown`

Repair routing:

- `flat_color`, `panel`, and `table_cell`: prefer deterministic redraw by sampling the
  surrounding background and filling only masked text pixels.
- `rule_line`: prefer native rule/shape reconstruction; do not erase the rule to hide text.
- `gradient` and `photo_texture`: inpainting is allowed when the mask does not destroy
  meaning.
- `icon_area`, `chart_area`, and `complex_unknown`: require manual review or native
  reconstruction. Do not hallucinate cleaned structure.

## Controlled Inpainting Requirements

- The input mask must be `work/slideXX/inpaint_mask.png`.
- The mask must be generated from resolved `text_regions.json`.
- The cleanup script must record methods used, artifact risk, residual text risk, per-region
  repair methods, source hash, mask hash, and policy status in `inpainting_report.json`.
- High mask coverage must fail unless explicitly allowed for a documented exception.
- `clean_background.png` must be described as a background cleanup asset, not a final slide.

## Residual Text QA

Run `detect_residual_text.py` after repair. It compares source and clean background only
around removed text regions, flags high-contrast glyph-like remnants, writes
`residual_text_report.json`, and writes `residual_text_overlay.png`.

Strict enforcement fails high residual risk. Medium residual risk requires manual review.
Low residual risk passes.

## Coverage Guidance

Default maximum mask coverage is 25 percent of the slide. This is intentionally conservative.
Large text-heavy title slides may need an exception, but the exception should say why the
semantic content will still be reconstructed natively downstream.
