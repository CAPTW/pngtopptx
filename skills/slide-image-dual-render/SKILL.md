---
name: slide-image-dual-render
description: >-
  Reconstruct slide images into both editable PPTX and standalone HTML from one
  backend-agnostic renderer. Use when slide screenshots or exported PNGs need
  faithful native-object reconstruction, crop metadata, visual QA, and package
  validation.
---

# Slide Image Dual Render

This module turns slide images into faithful editable reconstructions in two
formats from one source of truth:

- a `.pptx` where titles, panels, text, icons, tables, lines, and callouts are
  native objects where practical; and
- a standalone `.html` rendering that uses the same slide authoring code.

The renderer uses source-pixel coordinates and a backend-agnostic drawing layer.
Each slide is described once, then replayed onto PPTX and HTML surfaces.

## Style Profiles

Profiles in `styles/` keep conversions consistent across decks:

- `styles/clinical-dark.json`
- `styles/corporate-light.json`
- `styles/_schema.md`

Set `DECK_PROFILE` to the selected profile before rendering. Use
`scripts/preview.js` to inspect a profile specimen.

## Setup

Create a deck project outside the installed toolkit directory:

```bash
mkdir -p deck/src deck/assets deck/work deck/out deck/lib
cd deck
npm i pptxgenjs sharp react react-dom react-icons
pip install pillow numpy
```

Copy source images into `src/` as `slide1.png`, `slide2.png`, and so on.

## Production Entry Point

Use `scripts/slide_pipeline.js` for validator-backed runs:

```powershell
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"

node scripts\slide_pipeline.js --project . --slides 1,2,3 --target both --crop-plan work\crop_plan.json --node-path .\node_modules --pptx-out out\deck.pptx --html-out out\deck.html
```

Run the final gate before delivery:

```powershell
node scripts\final_gate.js --project . --target both --pptx out\deck.pptx --html out\deck.html
```

When using an installed toolkit layout, call the same scripts from:

```text
%USERPROFILE%\.pngtopptx\skills\slide-image-dual-render\scripts
```

## Workflow

1. Study each source image and measure key coordinates.
2. Choose or tune a style profile.
3. Generate assets and crop manifests.
4. Author slide functions in `lib/slides.js` using the kit helpers.
5. Render PPTX/HTML through `slide_pipeline.js`.
6. Run raster/HTML comparison and `final_gate.js`.
7. Disclose crop-heavy regions in delivery notes.

## Quality Modes

- `canary`: one-slide setup smoke test.
- `preservation`: visible fidelity may rely on disclosed crop regions.
- `reconstruction`: native reconstruction, QA evidence, native object counts,
  crop budgets, and strict final gates are required.

## Important Rules

- Draw once, render twice. Backend-specific concessions belong in surface atoms.
- Use source-pixel coordinates throughout.
- Keep one resolved font policy for both PPTX and HTML.
- Do not use hidden browser scaling for visual QA.
- Preserve continuous-tone regions as crops instead of pretending they are
  editable vectors.

## Reference Files

- `references/workflow.md`
- `references/kit-api.md`
- `references/pptxgenjs-gotchas.md`
- `references/qa-and-rendering.md`
