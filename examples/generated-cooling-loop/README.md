# Generated Cooling Loop Success Case

This example demonstrates a dense synthetic 16:9 slide converted into an
editable PowerPoint deck with the `pngtopptx` SkillSet.

The source image is intentionally busy: it contains a title, four major zones,
a cooling-loop schematic, a rack heatmap, KPI chips, a risk table, a response
playbook, and a footer. The conversion is treated as a success case because the
output is structurally editable and package-valid, not because it is a
pixel-perfect benchmark.

## Files

- `source.png` - synthetic 1672x941 source slide image.
- `editable-reconstruction.pptx` - editable PowerPoint reconstruction.
- `comparison-contact-sheet.png` - source, PPTX raster, HTML render, and diff
  panels in one image.
- `visual-qa-summary.md` - visual QA report from the companion QA Skill.
- `reconstruction-slides.js` - deck-local slide reconstruction code used for
  the example.
- `prompt.txt` - prompt used to create the synthetic source slide.
- `object-summary.json` - compact evidence summary.

## What Passed

- `slide_pipeline.js` completed successfully in `preservation` quality mode.
- `final_gate.js` passed.
- Strict PPTX package validation passed with 0 errors and 0 warnings.
- Crop coverage was 0. The output does not rely on a full-slide source-image
  crop.
- The native object manifest recorded 659 editable/placed objects:
  - text: 242
  - panels: 226
  - rules: 92
  - shapes: 84
  - icons: 14
  - generated background image: 1

## Important Limitations

The visual QA report intentionally remains in the repository. It marked the
slide as `fail` under strict pixel metrics:

- `pptx_vs_source` pixel diff: `0.2583`
- `pptx_vs_source` SSIM: `0.4304`
- `pptx_vs_source` edge diff: `0.1742`

This does not mean the PPTX is unusable. It means this example should not be
read as a pixel-identical reconstruction benchmark.

The differences are expected for this case:

- The synthetic source contains distorted AI microtext and tiny label texture
  that should not be copied blindly into editable text boxes.
- The reconstruction normalizes many small labels, tables, and diagram details
  into clean native PowerPoint objects.
- The source image has more ornamental edge density than the native redraw.
- PPTX and HTML rendering differ slightly because PowerPoint, browser layout,
  and font rasterization are different engines.

This is a good example for checking editability, package validity, and the
honest QA/reporting contract. For a strict visual-fidelity benchmark, use a
less dense source slide or run a dedicated repair/polish pass after the first
editable reconstruction.
