# pngtopptx: Editable PPTX Slide Reconstruction Toolkit

`pngtopptx` is a local toolkit for reconstructing slide screenshots or exported
slide PNGs into editable PowerPoint decks, with matching standalone HTML output
available from the same reconstruction code.

The toolkit is designed for dense technical or educational infographic slides:
tables, labels, panels, callouts, icons, decision boxes, tank maps, and module
footers are rebuilt as native PPTX objects where practical. Photographs,
document facsimiles, complex 3D renders, and other continuous-tone regions are
kept as explicit crop images with metadata, so the final deck remains honest
about what is editable and what is preserved as raster content.

This repository is a personal toolkit project and is not affiliated with any
platform vendor.

## Quick Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

By default, the installer copies the toolkit modules to:

```text
%USERPROFILE%\.pngtopptx\skills
```

Pass `-TargetRoot` if you want a different local install directory.

## What It Does

- Converts source slide images into editable PPTX output.
- Can render matching standalone HTML from the same slide reconstruction code.
- Uses a shared backend-agnostic renderer so PPTX and HTML follow one source of truth.
- Supports dark technical and light corporate style profiles.
- Separates crop-heavy preservation from native object reconstruction.
- Records evidence such as native object manifests and crop coverage summaries.
- Provides validation gates for route integrity, crop metadata, visual QA, and PPTX package openability.

## Public Success Case

A dense-slide conversion example is included in
[examples/generated-cooling-loop](examples/generated-cooling-loop/). It contains
the synthetic source image, editable PPTX output, comparison contact sheet,
browser-viewable HTML page, reconstruction code, prompt, and QA summary.

If GitHub Pages is enabled for this repository, the example can be viewed at:

```text
https://captw.github.io/pngtopptx/examples/generated-cooling-loop/
```

## Included Modules

The package contains four local reconstruction modules:

1. `slide-text-layer-inpaint`: detects semantic text, pseudo text, micro text,
   and decorative glyph-like text; builds masks and clean backgrounds.
2. `slide-image-dual-render`: reconstructs editable PPTX and matching HTML from
   slide images using source-pixel coordinates, native shapes/text, registered
   crops, and validation gates.
3. `slide-visual-polish-qa`: captures PPTX rasters and HTML screenshots,
   compares source/PPTX/HTML outputs, and produces visual QA summaries.
4. `slide-editable-deck-orchestrator`: coordinates conversion waves, repair
   loops, quality levels, and final delivery checks.

## Typical Deck Project Flow

Create a separate deck project. Do not work from the installed toolkit directory.

```powershell
mkdir deck
cd deck
mkdir src, assets, work, out, lib
copy C:\path\to\slide1.png src\slide1.png
npm i pptxgenjs sharp react react-dom react-icons
```

Run the renderer from the deck project root:

```powershell
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$env:USERPROFILE\.pngtopptx\skills\slide-image-dual-render\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"

node "$env:USERPROFILE\.pngtopptx\skills\slide-image-dual-render\scripts\slide_pipeline.js" `
  --project . `
  --slides 1 `
  --quality preservation `
  --target both `
  --crop-plan work\crop_plan.json `
  --node-path .\node_modules `
  --pptx-out out\deck.pptx `
  --html-out out\deck.html
```

Run the final gate before delivery:

```powershell
node "$env:USERPROFILE\.pngtopptx\skills\slide-image-dual-render\scripts\final_gate.js" `
  --project . `
  --target both `
  --quality preservation `
  --pptx out\deck.pptx `
  --html out\deck.html
```

## Quality Modes

- `canary`: one-slide smoke test. Useful for checking setup. Not production.
- `preservation`: visible fidelity may rely on disclosed crop regions.
- `reconstruction`: production native reconstruction mode with stricter evidence,
  QA, native-object, crop-budget, and final-gate requirements.

## Repository Hygiene

This repository intentionally does not include private decks, private source
slides, ad hoc generated outputs, `node_modules`, local work directories, fonts,
or rasterized QA images. Curated public validation cases under `examples/` are
the only exception.

## Validation

After edits to the toolkit, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -DryRun
node .\tests\verify_skillset_layout.js
python .\tests\verify_python_scripts.py
```

For a rendered deck, also run:

```powershell
node "$env:USERPROFILE\.pngtopptx\skills\slide-image-dual-render\scripts\final_gate.js" --project . --target both --pptx out\deck.pptx --html out\deck.html
python "$env:USERPROFILE\.pngtopptx\skills\slide-image-dual-render\scripts\validate_pptx_package.py" --project . --pptx out\deck.pptx --out out\pptx_package_validation --strict
```

## License

No open-source license is declared in this repository yet. Treat the contents as
a personal toolkit unless the owner adds a license.
