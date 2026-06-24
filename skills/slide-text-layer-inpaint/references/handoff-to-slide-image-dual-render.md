# Handoff To slide-image-dual-render

This skill hands off artifacts; it does not merge workflows.

## Producer

`slide-text-layer-inpaint` writes only per-slide preprocessing artifacts:

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

`text_regions.json` must identify the exact source image that produced the artifacts:

- `schemaVersion`: supported schema id, currently `slide-text-layer-inpaint.text_regions.v1`.
- `sourceImageHash`: SHA-256 of the source slide image.
- `coordinateSpace.width`: source image width in pixels.
- `coordinateSpace.height`: source image height in pixels.
- `coordinateSpace.units`: `source_px`.

It must not edit:

- `lib/slides.js`
- `build.js`
- PPTX or HTML renderer surfaces
- `slide_pipeline.js`
- `final_gate.js`
- `enforce_contract.js`
- `enforce_reconstruction.js`
- `enforce_qa.js`
- hardlock hook or gate files

## Consumer

`slide-image-dual-render` may consume the artifacts as input evidence:

- Read `text_regions.json` to place `semantic_text` as corrected native text.
- Use `text_mask.png` to avoid duplicate baked text when placing native text.
- Use `pseudo_text_mask.png` to identify regions that must not become inaccurate native text.
- Use `background_regions.json` and `inpainting_report.json` to understand whether text
  cleanup used redraw, inpainting, native reconstruction, or manual review.
- Use `residual_text_report.json` and `residual_text_overlay.png` to check for leftover
  text ghosts before relying on a cleaned background asset.
- Use `clean_background.png` only as a background cleanup asset or visual reference.
- Use reports and overlays during QA.

## Non-Goals

This handoff does not allow:

- HTML-to-PPTX conversion.
- A renderer path outside the approved backend-agnostic renderer.
- Replacing native object reconstruction with one cleaned screenshot.
- Skipping reconstruction completeness evidence.
- Skipping PPTX openability or final delivery gates.
- Treating residual text cleanup as permission to omit native semantic text.
- Converting pseudo text into invented native text.

## Recommended Project Layout

For a deck project:

```text
src/slide01.png
work/slide01/text_regions.json
work/slide01/text_mask.png
work/slide01/pseudo_text_mask.png
work/slide01/inpaint_mask.png
work/slide01/mask_overlay.png
work/slide01/mask_expanded_overlay.png
work/slide01/mask_delta_overlay.png
work/slide01/background_regions.json
work/slide01/clean_background.png
work/slide01/inpainting_report.json
work/slide01/inpainting_report.md
work/slide01/residual_text_report.json
work/slide01/residual_text_overlay.png
```

The downstream integrator should keep `work/slideXX/` immutable after preprocessing except for
explicit QA notes. If the source image changes, regenerate the full text-layer artifact set.

## Acceptance Rule

The strict handoff is valid only when:

```powershell
node scripts\enforce_text_layer.js --slide work\slide01 --image src\slide01.png --strict
```

passes, and the downstream reconstruction still passes its own hardlocked gates.
For production handoff, also require residual QA:

```powershell
node scripts\enforce_text_layer.js --slide work\slide01 --image src\slide01.png --strict --require-residual-check --max-residual-risk medium
```

Legacy validation without `--strict` may be used only to inspect older artifacts that lack
top-level integrity metadata. It is not sufficient for a new production handoff, and it does
not prove that artifacts match the current source image.
