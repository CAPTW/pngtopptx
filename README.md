# pngtopptx: Editable PPTX Codex SkillSet

`pngtopptx` is an unofficial, personal local Codex SkillSet for reconstructing
slide screenshots or exported slide PNGs into editable PowerPoint decks.

The SkillSet is designed for dense technical or educational infographic slides:
tables, labels, panels, callouts, icons, decision boxes, tank maps, and module
footers are rebuilt as native PPTX objects where practical. Photographs,
document facsimiles, complex 3D renders, and other continuous-tone regions are
kept as explicit crop images with metadata, so the final deck remains honest
about what is editable and what is preserved as raster content.

This repository is not an official OpenAI or Codex project.

## What It Does

- Converts source slide images into editable PPTX output.
- Can render matching standalone HTML from the same slide reconstruction code.
- Uses a shared backend-agnostic renderer so PPTX and HTML follow one source of truth.
- Supports dark technical and light corporate style profiles.
- Separates crop-heavy preservation from native object reconstruction.
- Records objective evidence such as native object manifests and crop coverage summaries.
- Provides validation gates for route integrity, crop metadata, visual QA, and PPTX package openability.

## Public Success Case

A public dense-slide conversion example is included in
[examples/generated-cooling-loop](examples/generated-cooling-loop/).

It contains the synthetic source image, editable PPTX output, comparison contact
sheet, reconstruction code, prompt, and QA summary. The example is intentionally
documented as a success case with limitations: package validation and editability
pass, while strict pixel visual QA reports the expected differences caused by
AI microtext, ornamental density, font/rasterization differences, and native
redrawing instead of screenshot embedding.

## Included Skills

The package installs four local Codex skills:

1. `slide-text-layer-inpaint`
   - Detects semantic text, pseudo text, micro text, and decorative glyph-like text.
   - Builds text masks, pseudo-text masks, clean backgrounds, and residual-text checks.

2. `slide-image-dual-render`
   - Reconstructs editable PPTX and matching HTML from slide images.
   - Uses source-pixel coordinates, native shapes/text, registered crops, and hardlocked validation.

3. `slide-visual-polish-qa`
   - Captures PPTX rasters and HTML screenshots.
   - Compares source/PPTX/HTML outputs and produces visual QA summaries and fix plans.

4. `slide-editable-deck-orchestrator`
   - Coordinates the three companion skills.
   - Plans conversion waves, repair loops, quality levels, and final delivery checks.

Use the orchestrator first for most end-to-end deck jobs:

```text
Use $slide-editable-deck-orchestrator.
```

Use the renderer directly for a focused single-slide or small-batch reconstruction:

```text
Use $slide-image-dual-render to convert these slide images into editable PPTX and matching HTML.
```

## Install

Install into the legacy Codex local skill path:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Install while backing up an existing local skill with the same name:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force
```

Install agent templates as well:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force -InstallAgents
```

Verify the install:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

Restart Codex after installation so the local skill registry reloads.

## Typical Deck Project Flow

Create a separate deck project. Do not work from the installed skill directory.

```powershell
mkdir deck
cd deck
mkdir src, assets, work, out, lib
copy C:\path\to\slide1.png src\slide1.png
npm i pptxgenjs sharp react react-dom react-icons
```

Then run the hardlocked renderer from the deck project root:

```powershell
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$env:USERPROFILE\.codex\skills\slide-image-dual-render\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"

node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" `
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
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" `
  --project . `
  --target both `
  --quality preservation `
  --pptx out\deck.pptx `
  --html out\deck.html
```

## Quality Modes

- `canary`: one-slide smoke test. Useful for checking setup. Not production.
- `preservation`: visible fidelity is allowed to rely on crop regions, but those crops are disclosed.
- `reconstruction`: production native reconstruction mode. Requires worker artifacts, QA evidence, native object counts, crop budgets, and stricter final gates.

The SkillSet intentionally distinguishes between preservation and reconstruction. A PPTX that mostly embeds a screenshot is not treated as a valid editable reconstruction.

## Editability Model

Usually editable:

- titles and subtitles
- panel frames
- section labels
- body text
- tables
- numbered badges
- rules and connector lines
- icons as movable image objects
- callouts, decision boxes, and simple diagrams

Usually preserved as crop images:

- photographs
- rendered vessels, machinery, 3D objects, and photoreal scenes
- official-document examples with seals, signatures, paper texture, or microtext
- dense label art that cannot be faithfully reconstructed within a practical pass

Every crop should have metadata explaining why it is not reconstructed and what editable replacement, if any, exists around it.

## Repository Hygiene

This repository intentionally does not include:

- private input decks
- private source slide images
- ad hoc generated PPTX/HTML outputs
- `node_modules`
- local work directories
- font files
- rasterized QA images

Curated public validation cases under `examples/` are the only exception. They
may include small source images, PPTX outputs, contact sheets, and QA summaries
when those files are part of the public reproducibility story.

Keep real conversion work in a separate deck project and commit only reusable skill code, scripts, references, tests, and examples.

## Dependencies

See [DEPENDENCIES.md](DEPENDENCIES.md).

Short version:

- Windows
- Codex Desktop/App or CLI with local skill support
- Node.js
- Python 3.10+
- PowerShell
- Recommended: PowerPoint, Chrome/Edge, LibreOffice, Pillow, NumPy, OpenCV, scikit-image

## Validation

After edits to the SkillSet, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -DryRun
node .\tests\verify_skillset_layout.js
python .\tests\verify_python_scripts.py
```

For a rendered deck, also run:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --target both --pptx out\deck.pptx --html out\deck.html
python "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\validate_pptx_package.py" --project . --pptx out\deck.pptx --out out\pptx_package_validation --strict
```

## License

No open-source license is declared in this repository yet. Treat the contents as a personal SkillSet unless the owner adds a license.
