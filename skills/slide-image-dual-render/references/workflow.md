# Workflow — detail

The five phases from SKILL.md, expanded with the decisions that matter.

## Working directory layout
```
deck/
├── src/        slide1.png … slideN.png   (renamed copies of the source images)
├── assets/     bg.png, icons/, <crop>.png, manifest.json   (generated; = DECK_ASSETS)
├── work/       slideXX/ worker artifacts for Codex Desktop sub-agent fan-out
├── lib/        kit.js, atoms_pptx.js, atoms_html.js, slides.js
├── build.js, make_bg.py, make_icons.js, make_crops.py
└── out/        deck.pptx, deck.html
```

## Hard-Locked production path

For real conversions, use the central pipeline instead of hand-running each phase:

Skill-installed layout, run from the deck project root:

```powershell
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --target both --pptx-out out\deck.pptx --html-out out\deck.html
```

Deck-local copied layout:

```bash
DECK_PROFILE="$PWD/styles/clinical-dark.json" DECK_ASSETS="$PWD/assets" DECK_PXW=1672 DECK_PXH=941 \
  node scripts/slide_pipeline.js --target both --pptx-out out/deck.pptx --html-out out/deck.html
```

The pipeline runs preflight validation, background/icon/crop generation, `build.js`, postbuild
validation, and writes `out/render_trace.json`. Legacy direct commands remain available as
advanced/manual mode, but production delivery must pass:

```bash
node scripts/final_gate.js --target both --pptx out/deck.pptx --html out/deck.html
```

For Skill-installed layout, run the gate as:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --target both --pptx out\deck.pptx --html out\deck.html
```

If you use the root-copied setup from older versions (`cp -r scripts/* deck/`), drop the `scripts/`
prefix for deck-local hardlock commands.

Do not bypass the renderer. A PPTX made directly with `pptxgenjs`, `python-pptx`, LibreOffice
HTML/PDF-to-PPTX conversion, or full-slide screenshots is invalid even if it looks correct.

## Codex Desktop sub-agent mode
For parallel reconstruction, read `references/codex-subagents.md` before dispatching workers. The
unit of parallel work is one source slide image in one fresh context. Workers write only to their own
`work/slideXX/` folders; they do not edit `lib/slides.js`, `make_crops.py`, `build.js`, or
`styles/*.json`.

The expected worker outputs are:
- `measurements.json` — source-pixel boxes, bands, colors, and table/grid measurements.
- `profile_override.json` — the classified profile, confidence, specific extracted tokens, and
  exception regions.
- `crop_plan.json` — only unrecreatable crop regions for that slide.
- `sN.fragment.js` — exactly one slide function, using the same kit helpers and source-pixel coords.
- `reconstruction_notes.md` and `editability_inventory.md` — implementation notes and what remains
  raster-baked.

After workers finish, the main thread or `slide_render_integrator` runs:

```bash
node scripts/validate_agent_work.js --work work
node scripts/merge_fragments.js --work work --out lib/slides.js --backup
CROP_PLAN_DIR=work python make_crops.py
TARGET=both PPTX_OUT=out/deck.pptx HTML_OUT=out/deck.html node build.js
```

This path is additive. For a single-thread job, you may still edit `lib/slides.js` and the `CROPS`
table directly.

If you followed the original setup that copies `scripts/*` into the deck root, use the same commands
without the `scripts/` prefix:

```bash
node validate_agent_work.js --work work
node merge_fragments.js --work work --out lib/slides.js --backup
TARGET=both SLIDES=1,2,3 node build.js
```

## Phase 0 — Study + measure the source
- `view` each source image at full size. Note the global frame first: the eyebrow line,
  the part-tag pill, the title + subtitle, and the bottom bands (banner / roadmap / footer).
- For each content block, get **exact pixel boxes**. Don't eyeball — measure. The Python
  recipes for detecting panel borders, column centers, and colored bands are in
  `qa-and-rendering.md`. Record per slide: panel rectangles, table column centers + divider
  x's, and the y-bands of banner/roadmap/footer.
- Decide the canvas resolution = the image resolution; export `DECK_PXW`/`DECK_PXH` if not
  1672×941.

## Phase 0.5 — Classify the style & pin a profile  *(per image, own context)*
The step that keeps quality from fluctuating across idioms. Follow `scripts/classify.md`:

1. **Characterize** every dimension in `styles/_schema.md` from the image (background, geometry, icon
   style, header style, step style, palette roles…). Keep to the allowed vocabulary; flag anything new.
2. **Match** to a library profile **with a confidence**:
   - high (background + geometry + header + stepStyle agree) → use that profile as the base;
   - partial → use the closest profile and **override** the diverging dimensions from your read;
   - **no confident match → fallback** (open extraction / crop-heavy / flag). Never force the nearest
     profile — a wrong design system applied confidently is worse than an honest open extraction.
3. **Extract specifics**: read the input's *actual* title KR/EN colors, accent hexes, corner radius,
   panel fill, and write them as a per-slide override on top of the profile (grammar vs specifics).
4. **Verify**: `node preview.js styles/<id>.json out/<id>.html`, rasterize, eyeball. Then
   `export DECK_PROFILE="$PWD/styles/<id>.json"` for the rest of the pipeline.

In sub-agent mode, write the profile decision and extracted specifics to
`work/slideXX/profile_override.json`. Do not change shared `styles/*.json` from a worker. Promotion
to a new shared profile is an integrator/main-thread decision.

Real slides blend idioms (a light deck with one dark hero panel). Classify a **primary** style, then
mark exception regions and apply `components.alt` / a per-region override — don't force one whole-slide
label.

## Phase 1 — Asset prep

### Background
`DECK_PROFILE=… python make_bg.py` writes `assets/bg.png` from the profile's `background` tokens —
a gradient-dark `from/to` or a `light` base. With **no** `DECK_PROFILE` it is the original dark-navy
gradient, unchanged. (You can still edit the script for a fully bespoke backdrop.) (Gradients can't be drawn in PPTX, so they must be
baked into this image — see `pptxgenjs-gotchas.md`.)

### Icons
`DECK_PROFILE=… node make_icons.js` renders every concept in its `MAP` × 7 palette colors to
`assets/icons/<concept>_<color>.png` (Tabler line-icons via react-icons → SVG → sharp PNG). The seven
color **names** (`white lblue cyan red green gold blue`) stay fixed; their hex VALUES follow the active
`DECK_PROFILE` (no profile = original colors).
Add concepts by extending `MAP`. **Confirm a concept exists before authoring with it**; a
missing name prints `!! missing icon <name> <color>` and is silently skipped in the render,
leaving a blank — so grep the generated `icons/` dir or check `MAP` first.

### Crops — the key judgment call
**Rebuild everything you can as editable vector objects.** Only extract a region as a raster
crop when it genuinely cannot be reconstructed:
- photoreal / metallic / textured renders,
- 3D wireframes and isometric diagrams,
- photographs,
- dense label art baked into a render (where re-typing every label would be hopeless).

Edit the `CROPS` table in `make_crops.py`: `name → (slide, x, y, w, h, feather_edges)`.
`feather_edges` (any of `LRTB`) fade those edges to transparent so a crop floating on the
backdrop blends in (use `LRTB` for free-floating renders; use e.g. `LB` for a photo anchored
to a corner). Running it writes each `assets/<name>.png` plus `assets/manifest.json`
(box coords) so `crop(s,'name')` can place it exactly.

In sub-agent mode, workers write crop requests to `work/slideXX/crop_plan.json` instead of editing
`make_crops.py`. The integrator merges them into `work/crop_plan.integrated.json`, then crop
generation uses:

```bash
CROP_PLAN=work/crop_plan.integrated.json python make_crops.py
```

`make_crops.py` also accepts `CROP_PLAN_DIR=work` for directly reading `work/slideXX/crop_plan.json`
files.

For production `CROP_PLAN` / `work/crop_plan.json` is the authoritative source of crop policy
metadata. `assets/manifest.json` must preserve supplied metadata such as `content_type`,
`reconstruction_reason`, `editable_replacement`, `allow_large_crop`, `reason`, and other safe
non-geometry policy fields while regenerating only placement/file fields. Legacy defaults are only
for old crop plans that omit metadata; in reconstruction mode those defaults remain visible so gates
can fail incomplete metadata honestly.

Be honest about what's baked in. After cropping, **inventory each crop**: which labels/captions
live *inside* the picture? Those are NOT editable text — note them for the delivery summary.

### Trimming a crop that overlaps native text
A common defect: a crop's box includes a caption (e.g. a callout banner at its bottom) that
you also re-create as a native object → the text appears twice. Fix by trimming the offending
strip from the crop:
```python
from PIL import Image
im = Image.open('assets/sys.png'); w,h = im.size
im.crop((0, 14, w, h-26)).save('assets/sys_t.png')   # drop top 14px + bottom 26px
```
Then place the trimmed `sys_t.png` and keep your native callout. Re-QA to confirm the
duplication is gone.

## Phase 2 — Authoring
- Copy `lib/slides.template.js` → `lib/slides.js`. Replace bodies; keep the `s1..sN` export
  contract. There is **no slide-count cap** — `build.js` discovers whatever you export.
- In sub-agent mode, each worker writes `work/slideXX/sN.fragment.js` and never writes
  `lib/slides.js`. The fragment should define exactly one `function sN(s) { ... }`, rely on the
  shared kit prelude added by `integrate_subagent_work.js`, and avoid backend checks.
- The integrator merges fragments with `node integrate_subagent_work.js`. It writes
  `lib/slides.js`, `work/crop_plan.integrated.json`, and `work/integration_report.md`.
- The preferred explicit path is:
  `node scripts/validate_agent_work.js --work work`,
  `node scripts/merge_fragments.js --work work --out lib/slides.js --backup`, then
  `CROP_PLAN_DIR=work python make_crops.py`. `integrate_subagent_work.js` remains a compatibility
  shortcut for older instructions.
- Transcribe **1:1**. Match the source's wording, ordering, and structure exactly
  ("보이는 그대로"). Faithful reproduction **overrides** generic "keep slides minimal / don't
  draw busy bordered boxes" guidance — if the source is a dense bordered infographic,
  reproduce it as one.
- Use the kit helpers (`kit-api.md`) and source-pixel coords. For repeated structures
  (quadrants, table rows, card grids), write a small local helper and loop — don't hand-place
  every cell.
- **Layout conventions for a uniform deck.** Real source decks drift a few px between slides;
  pick fixed bands and apply them everywhere so the set looks consistent: e.g. panels start at
  `y≈200`; a gold `banner(...)` at `y≈710`; `chevronBar(...)` at `y≈786`; `footer(...)` at
  `y≈898`. Slides without a gold banner can put an extra full-width feature row where the
  banner would sit. Keep the same roadmap style across the deck (e.g. a chapter chevron with a
  lead pill), varying only the active index.
- **Header**: set eyebrow / tag / prefix once via env (`DECK_EYEBROW`/`DECK_TAG`/`DECK_PREFIX`)
  so every `head()` inherits them; override per slide only when a slide differs.
- **Long titles/subtitles**: `head()` already shrinks them to one line. If a title is so long
  it would collide with a top-right crop, that's expected — it shrinks to fit its box.

## Phase 3 — Render
Recommended production path:

```bash
node scripts/slide_pipeline.js --slides 1,2 --target both --pptx-out out/sample.pptx --html-out out/sample.html
node scripts/slide_pipeline.js --target both --pptx-out out/deck.pptx --html-out out/deck.html
```

Legacy/manual path remains available for advanced debugging:

```bash
TARGET=both PPTX_OUT=out/deck.pptx HTML_OUT=out/deck.html node build.js
```

In Hard-Locked Workflow Mode, direct `node build.js` is not a deliverable path. `TARGET=both` still
writes PPTX and HTML in one pass from the same slide code; `slide_pipeline.js` simply surrounds that
render with validation, asset generation, crop generation, and traceability.

## Phase 4 — QA loop
Rasterize and **view every slide**; this is where fidelity is won. Commands and hazards are
in `qa-and-rendering.md`. Typical fixes you'll make: a label wrapping to 2 lines (widen its
box / add `shrink` / reduce `sz`), a callout text clipped (enlarge box or shrink font), two
elements overlapping (re-measure and reposition), a crop duplicating a native caption (trim
the crop), a subtitle grazing the panels (raise it a few px). Re-render only the changed
slides, re-view, repeat until clean. Build a small contact-sheet (montage of all slides) for
a final holistic pass.

In sub-agent mode, `slide_qa_gate` writes the verdict to `work/slideXX/qa_report.md`. The report
must point to concrete edits in `sN.fragment.js` or `crop_plan.json`; broad restyling belongs in the
integrator only when the source-vs-render comparison proves it.

## Phase 5 — Deliver
- Copy both finals to `/mnt/user-data/outputs/`.
- Run `node scripts/final_gate.js --target both --pptx out/deck.pptx --html out/deck.html` first.
  If it fails, the output is not deliverable.
- `present_files` with the **PPTX first**, then the HTML.
- In the summary, list which diagram regions are **baked-into-image crops** (label art is part
  of the picture, not editable text) versus what is **fully editable native** (titles, panels,
  body text, tables, icons, chevron roadmaps, matrix symbols, decision boxes, callouts).
- If the HTML uses the Pretendard webfont, note that it loads from a CDN in a real browser
  (matching the PPTX) and falls back to a system Korean font offline.

<!-- HARDLOCK_PATH_CONTRACT_BEGIN -->

## Hard-Locked Workflow Mode path contract

Hard-Locked Workflow Mode supports two valid layouts. In both cases, `--project` is the deck project root and all deck-relative paths (`src/`, `lib/slides.js`, `styles/`, `assets/`, `work/`, `out/`) resolve from that project root.

Skill-installed layout:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\install_hardlock.js" --project .
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --project . --target both --pptx-out out\deck.pptx --html-out out\deck.html
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --target both --pptx out\deck.pptx --html out\deck.html
```

Deck-local copied layout:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
node scripts\install_hardlock.js --project .
node scripts\slide_pipeline.js --project . --target both --pptx-out out\deck.pptx --html-out out\deck.html
node scripts\final_gate.js --project . --target both --pptx out\deck.pptx --html out\deck.html
```

The production path fails closed if `projectRoot` is the installed Skill directory, if outputs resolve outside the deck project, if `lib/slides.js` is missing from the deck project, or if the final gate sees file hashes that differ from `out/render_trace.json`.

<!-- HARDLOCK_PATH_CONTRACT_END -->

<!-- PRODUCTION_DEPENDENCY_CROP_CONTRACT_BEGIN -->

## Production dependency and crop-plan contract

Hard-Locked production runs must make crop plans and Node dependencies explicit. Do not rely on an old deck workspace through a hidden `NODE_PATH`, and do not rely on an env-only crop plan when a CLI argument can name it.

Dependency resolution order:
1. `--node-path <path>`
2. existing `NODE_PATH`
3. project-local `node_modules`
4. Skill-local `node_modules`
5. fail closed with install instructions

Install dependencies in the deck project for Skill-installed layout:

```powershell
cd C:\path\to\deck
npm i pptxgenjs sharp react react-dom react-icons
```

Recommended Skill-installed production command:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"

node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --project . --slides 1,2,3 --target both --crop-plan work\crop_plan.json --node-path .\node_modules --pptx-out out\deck.pptx --html-out out\deck.html
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --target both --pptx out\deck.pptx --html out\deck.html
```

Recommended deck-local copied production command:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"

node scripts\slide_pipeline.js --project . --slides 1,2,3 --target both --crop-plan work\crop_plan.json --node-path .\node_modules --pptx-out out\deck.pptx --html-out out\deck.html
node scripts\final_gate.js --project . --target both --pptx out\deck.pptx --html out\deck.html
```

If a deck has no unrecreatable raster regions, pass `--skip-crops`; otherwise create `work/crop_plan.json` or pass `--crop-plan <path>`. Crop policy metadata in that plan is authoritative and must round-trip into `assets/manifest.json`; legacy defaults are only for old plans with missing metadata. The pipeline records `cropPlanPath`, `cropPlanHash`, `cropManifestPath`, `cropManifestHash`, `nodePathUsed`, and `dependencyResolutionMode` in `out/render_trace.json`; `final_gate.js` revalidates them before delivery.

<!-- PRODUCTION_DEPENDENCY_CROP_CONTRACT_END -->

## Reconstruction-Completeness Hardlock

Hard-Locked Workflow Mode has two independent gates:

1. Route hardlock: verifies that output came from `slide_pipeline.js -> build.js -> final_gate.js` and the approved backend-agnostic renderer.
2. Reconstruction hardlock: verifies that each selected slide was actually reconstructed with native editable objects, per-slide worker artifacts, crop budget metadata, and QA.

Passing route hardlock does not imply passing reconstruction hardlock. A deck where slides are mostly preserved as baked crop regions, including slides 6-20 in the failed production test pattern, is not a valid reconstruction delivery.

Delivery modes:

1. `canary`: one-slide smoke test. Approximate output is allowed and must be treated as draft, not production.
2. `preservation`: visible preservation is allowed and crop-heavy output is allowed, but baked regions must be disclosed. This is not editable reconstruction.
3. `reconstruction`: production mode. Native reconstruction, per-slide worker receipts, reconstruction scores, crop budgets, and QA are required. Final delivery fails if any selected slide lacks reconstruction artifacts or is crop-heavy beyond policy.

Production reconstruction command, Skill-installed layout:

```powershell
cd C:\path\to\deck
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --project . --slides 1,2,3,4,5 --quality reconstruction --require-qa --require-reconstruction --crop-plan work\crop_plan.json --node-path .\node_modules --target both --pptx-out out\deck-wave1.pptx --html-out out\deck-wave1.html
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --slides 1,2,3,4,5 --quality reconstruction --require-qa --require-reconstruction --target both --pptx out\deck-wave1.pptx --html out\deck-wave1.html
```

Repeat waves for `6,7,8,9,10`, `11,12,13,14,15`, and `16,17,18,19,20`. Only after all waves pass, build the combined deck with `--allow-large-batch` and run `final_gate.js` again.

New validators:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\enforce_reconstruction.js" --project . --slides 1,2,3,4,5 --quality reconstruction --trace out\render_trace.json
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\enforce_qa.js" --project . --slides 1,2,3,4,5
```

## Objective Evidence Reconstruction Hardlock

Reconstruction hardlock does not trust worker self-report files by themselves. The following files are required as objective evidence for production reconstruction delivery:

- `out/native_object_manifest.json`: generated from actual render surface calls in the approved build path. It records text, panel, rule, icon, image, shape, and line objects with coordinates and editability flags.
- `out/crop_coverage_summary.json`: generated from `work/crop_plan.json` and `assets/manifest.json`, with per-slide crop area ratios and crop metadata classification.
- `out/qa_evidence_summary.json`: generated from per-slide QA evidence files.
- `work/slideXX/qa_evidence.json`: records source/raster/screenshot hashes or explicit manual evidence notes.

Worker-authored files such as `reconstruction_score.json`, `qa_result.json`, `worker_receipt.json`, and `editability_inventory.md` are still required, but final delivery cannot pass based only on those claims. `final_gate.js` re-runs both `enforce_qa.js --require-evidence` and `enforce_reconstruction.js`, and fails if objective evidence contradicts worker-reported status.

In `--quality reconstruction` mode:

- `qa_result.json` must reference `qa_evidence.json`.
- QA pass is invalid if `qa_evidence.json` is missing, has mismatched hashes, lacks source evidence, or claims pass without raster/screenshot evidence unless it is explicitly manual with evidence notes.
- Native object counts in `reconstruction_score.json` are compared against `out/native_object_manifest.json`.
- Crop budgets are enforced from `out/crop_coverage_summary.json`, not from worker-reported crop coverage alone.
- Body content that is mostly baked crop regions is not a valid reconstruction delivery, even if the approved renderer route was used.

Production still requires both gates:

1. route hardlock pass
2. reconstruction completeness plus objective evidence pass

## PPTX Openability Gate

Production PPTX delivery is invalid if Microsoft PowerPoint would require repair when opening the file. Route hardlock and reconstruction hardlock are necessary but not sufficient for PPTX delivery.

For reconstruction-mode outputs where the target includes PPTX, `final_gate.js` requires strict PPTX package validation by default. You can also request it explicitly:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --project . --slides 6 --quality reconstruction --require-qa --require-reconstruction --require-pptx-openable --target both --pptx out\deck-slide6.pptx --html out\deck-slide6.html
```

The gate runs `scripts/validate_pptx_package.py --strict`, checks ZIP/package structure, XML well-formedness, relationships, content types, numeric slide geometry, and referenced media. A PowerPoint "repair required" result means the deliverable fails and must be fixed at source, then re-rendered through `slide_pipeline.js -> build.js -> final_gate.js`.
