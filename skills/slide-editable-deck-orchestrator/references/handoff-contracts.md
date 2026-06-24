# Handoff Contracts

## From `slide-text-layer-inpaint`

Per slide:

```text
work/slideXX/text_regions.json
work/slideXX/text_mask.png
work/slideXX/pseudo_text_mask.png
work/slideXX/inpaint_mask.png
work/slideXX/mask_overlay.png
work/slideXX/clean_background.png
work/slideXX/inpainting_report.json
work/slideXX/inpainting_report.md
```

Use these artifacts as evidence:

- Semantic text must remain native editable text in reconstruction.
- Pseudo text must not become incorrect semantic text.
- Decorative glyphs must not become semantic text.
- Clean backgrounds are local cleanup evidence, not full-slide shortcuts.

## From `slide-image-dual-render`

Inputs:

- `src/slideN.png`
- `styles/*.json`
- `assets/`
- `lib/slides.js`
- `work/crop_plan.json`
- per-slide worker artifacts under `work/slideXX/`

Outputs:

```text
out/deck*.pptx
out/deck*.html
out/render_trace.json
out/native_object_manifest.json
out/crop_coverage_summary.json
out/qa_evidence_summary.json
out/pptx_openability_debug/pptx_package_validation.json
```

Required gates:

- Route hardlock.
- Reconstruction hardlock.
- Crop metadata policy.
- PPTX openability.

## From `slide-visual-polish-qa`

Per slide:

```text
work/slideXX/visual_qa/source.png
work/slideXX/visual_qa/pptx_raster.png
work/slideXX/visual_qa/html_screenshot.png
work/slideXX/visual_qa/pptx_diff.png
work/slideXX/visual_qa/html_diff.png
work/slideXX/visual_qa/pptx_edge_diff.png
work/slideXX/visual_qa/html_edge_diff.png
work/slideXX/visual_qa/visual_metrics.json
work/slideXX/visual_qa/visual_polish_report.md
work/slideXX/visual_qa/visual_polish_fixes.json
```

Deck-level:

```text
out/visual_qa_summary*.json
out/visual_qa_summary*.md
out/qa/contact_sheet.png
```

## Source-Slide Mapping

For full-deck outputs, source slides usually match physical slides. Still prefer `--source-slides` for consistency.

For wave outputs:

```text
source slide 8 -> physical/html slide 1
source slide 10 -> physical/html slide 2
```

Always write QA artifacts under source folders, for example:

```text
work/slide08/visual_qa/pptx_raster.png
```

## Final Delivery Artifacts

Required final package:

```text
out/deck-final-editable.pptx
out/deck-final-editable.html
out/render_trace.json
out/native_object_manifest.json
out/crop_coverage_summary.json
out/editability_inventory.md
out/baked_crop_regions.json
out/visual_qa_summary_final.json
out/visual_qa_summary_final.md
out/qa/contact_sheet.png
```
