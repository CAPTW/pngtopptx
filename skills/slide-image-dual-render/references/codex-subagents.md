# Codex Desktop Sub-Agent Orchestration

This skill works best when each source slide image is reconstructed in a fresh model context. A
slide image is dense visual evidence: layout measurements, style classification, crop decisions,
and text transcription compete for attention. Putting many slides in one context makes the model
average styles, reuse the wrong geometry, and miss local details. The reliable unit of work is:

```text
one source slide image -> one fresh Codex sub-agent context -> one isolated work/slideXX/ folder
```

Cross-slide consistency still comes from shared code and shared frozen style profiles, not from one
agent remembering every slide. Every worker imports the same `styles/*.json` library and follows the
same kit contract; the integrator is the only step that combines their output.

## Agent Topology

Use these roles when fanning out a deck in Codex Desktop.

`slide_profile_mapper`
: Reads one `src/slideN.png`, studies `styles/_schema.md` and `scripts/classify.md`, then writes the
  style decision and measured tokens to `work/slideXX/profile_override.json`. It may also write
  `work/slideXX/measurements.json` for panel boxes, title bands, column centers, crop boxes, and
  important color samples. It must not edit `styles/*.json`, `lib/slides.js`, or renderer files.

`slide_reconstruct_worker`
: Reads one source image plus that slide's measurements/profile notes, then writes the editable
  reconstruction fragment to `work/slideXX/sN.fragment.js`. It also writes
  `work/slideXX/crop_plan.json`, `work/slideXX/reconstruction_notes.md`, and
  `work/slideXX/editability_inventory.md`. It must keep all coordinates in source pixels and must
  use crop regions only for photoreal, continuous-tone, 3D, photograph, or dense baked-label areas
  that cannot reasonably be rebuilt as editable objects.

`slide_render_integrator`
: Runs after workers finish. This is the only parallel-stage role that may update shared renderer
  inputs. It merges `work/slideXX/sN.fragment.js` files into `lib/slides.js`, merges
  `work/slideXX/crop_plan.json` files into `work/crop_plan.integrated.json`, and records an
  integration report. Then it runs crop generation and the normal renderer.

`slide_qa_gate`
: Gates one slide at a time. It compares `src/slideN.png` against the rendered PPTX/HTML raster for
  the same slide, writes `work/slideXX/qa_report.md`, and returns targeted fixes. Fixes should point
  to the owning fragment or crop plan, for example "slide03 title box is 18 px too narrow" or
  "crop s3_hero includes a caption that is recreated natively; trim bottom 24 px." The gate does not
  make broad style changes by memory; it uses the source-vs-render difference.

## Write Boundaries

Parallel workers must only write inside their own slide folder:

```text
work/slide01/
work/slide02/
work/slide03/
```

They must not directly edit shared files such as:

```text
lib/slides.js
make_crops.py
build.js
styles/*.json
assets/manifest.json
```

Only the main thread or `slide_render_integrator` may update shared files. The normal shared update
is generated, not hand-edited:

```bash
node scripts/validate_agent_work.js --work work
node scripts/merge_fragments.js --work work --out lib/slides.js --backup
CROP_PLAN_DIR=work python make_crops.py
TARGET=both PPTX_OUT=out/deck.pptx HTML_OUT=out/deck.html node build.js
```

Existing single-thread usage remains valid. If you are reconstructing a small deck in one context,
you may still edit `lib/slides.js` and the `CROPS` table directly. The sub-agent path is an additive
workflow for parallel Codex Desktop runs.

## Expected Project Structure

```text
deck/
  src/
    slide1.png
    slide2.png
  assets/
  out/
  work/
    slide01/
      measurements.json
      profile_override.json
      crop_plan.json
      reconstruction_notes.md
      s1.fragment.js
      editability_inventory.md
      qa_report.md
    slide02/
      ...
  lib/
    slides.js
  styles/
  build.js
  integrate_subagent_work.js
  make_bg.py
  make_icons.js
  make_crops.py
```

## Worker Artifact Contracts

`measurements.json`
: Source-pixel measurements used by the worker. Recommended keys are `canvas`, `bands`, `panels`,
  `tables`, `crops`, and `colors`. Keep numeric coordinates in the source image coordinate system.

`profile_override.json`
: The mapper's per-slide extraction on top of the chosen frozen profile. Include `profileId`,
  `confidence`, `overrides`, and `exceptions`. This file is an audit trail unless the integrator
  deliberately promotes it into a profile or a deck-level override.

`crop_plan.json`
: Crop requests for this slide. Supported shapes are either an object with a `crops` array or a
  mapping by crop name. Each crop needs `name`, `slide`, `x`, `y`, `w`, `h`, and optional
  `feather_edges` (any of `LRTB`).

Example:

```json
{
  "crops": [
    {
      "name": "s3_hero",
      "slide": 3,
      "x": 1024,
      "y": 96,
      "w": 520,
      "h": 280,
      "feather_edges": "LB",
      "reason": "photoreal equipment render"
    }
  ]
}
```

`sN.fragment.js`
: A slide fragment containing `function sN(s) { ... }` for exactly one slide. Use the same kit
  helpers as `lib/slides.js` (`bg`, `head`, `panel`, `T`, `icon`, `crop`, etc.). Do not include
  backend checks. Keep top-level helpers unique or define helpers inside the slide function.

Example:

```js
function s3(s) {
  bg(s);
  head(s, 'Slide title', 'Subtitle');
  panel(s, 32, 210, 760, 420);
  T(s, 'Editable native text', 60, 240, 700, 40, { sz: 18, b: true, color: C.white });
  crop(s, 's3_hero');
}
```

`editability_inventory.md`
: List what is editable native output and what is baked into raster crops. This becomes delivery
  summary material.

`qa_report.md`
: The QA gate's per-slide verdict. Use clear fix bullets tied to `sN.fragment.js` or
  `crop_plan.json`, not broad advice. A useful report has `status`, `source`, `render`, `major
  deviations`, `targeted fixes`, and `accepted limitations`.

## Integrator Duties

The integrator must:

1. Confirm each requested slide has exactly one matching `sN.fragment.js`.
2. Generate `lib/slides.js` from fragments without changing the renderer atoms or kit helpers.
3. Validate `work/slideXX/` artifacts with `scripts/validate_agent_work.js`.
4. Generate `lib/slides.js` with `scripts/merge_fragments.js`.
5. Feed reviewed crop plans to `make_crops.py` with `CROP_PLAN_DIR=work` or a documented
   integrated crop manifest.
6. Render with the existing command surface: `SLIDES`, `TARGET`, `PPTX_OUT`, `HTML_OUT`,
   `DECK_PROFILE`, `DECK_ASSETS`, `DECK_PXW`, and `DECK_PXH` keep their existing meaning.
7. Hand each slide to `slide_qa_gate`; re-run only the changed slide after each targeted fix.

The integrator should not weaken the style-aware architecture. If workers disagree on style, choose
the closest existing deck-level `DECK_PROFILE`, apply local specifics through slide code, or promote a
new profile deliberately. Do not silently invent a new design system inside a worker fragment.

## Installing Project Agents

From a deck workspace that has this skill's `scripts/` and `assets/` copied in:

```bash
node scripts/install_codex_subagents.js --project .
```

If you use the older setup style where `scripts/*` are copied into the deck root, run:

```bash
node install_codex_subagents.js --project .
```

Then add this snippet manually to the project `.codex/config.toml` if the project does not already
set agent limits:

```toml
[agents]
max_threads = 4
max_depth = 1
```

The installer copies templates only. It does not modify `.codex/config.toml`.

## Copy-Paste Prompt

Use this prompt when converting a real slide batch:

```text
Use $slide-image-dual-render.

I have source slide images in `src/slide1.png ... src/slideN.png`.
Run the Codex Sub-Agent workflow.

Steps:
1. Spawn one `slide_profile_mapper` per source image.
2. Each mapper must write only to `work/slideXX/`.
3. After mapping, spawn one `slide_reconstruct_worker` per slide.
4. Each reconstruction worker must write only `work/slideXX/sN.fragment.js` and related notes.
5. Do not allow any parallel worker to edit `lib/slides.js`, `make_crops.py`, or shared files.
6. After all workers complete, use `slide_render_integrator` or the main thread to:
   - validate work artifacts
   - merge fragments
   - update crop extraction
   - generate assets
   - render `TARGET=both`
7. Spawn one `slide_qa_gate` per slide.
8. Apply fixes centrally and re-render only failed slides.
9. Deliver PPTX first, then HTML.
```

## Driver Loop, No Subagents

When Codex subagents are unavailable, run the same one-slide unit serially:

1. For each `src/slideN.png`, start a fresh context or scripted pass.
2. Write the same artifacts to `work/slideXX/`.
3. After all slides are done, run the same validator and merger:

```bash
node scripts/validate_agent_work.js --work work
node scripts/merge_fragments.js --work work --out lib/slides.js --backup
CROP_PLAN_DIR=work python make_crops.py
TARGET=both node build.js
```

The driver loop is slower than fan-out but preserves the same isolation boundary and final renderer
contract.

## Safety Rules For Write Conflicts

- Parallel workers write only under their assigned `work/slideXX/` directory.
- Workers never edit `lib/slides.js`, `make_crops.py`, `build.js`, `styles/*.json`, or
  `assets/manifest.json`.
- The integrator creates a backup before overwriting `lib/slides.js` when using `--backup`.
- If a human edited a shared file after worker output was generated, inspect the diff before merging.
- Crop names must be unique across all slides; prefix names with the slide number, for example
  `s07_engine_render`.
- Generated shared files should say they are generated and point back to `work/slideXX/`.

## QA Gates And Re-Render Loop

Run QA per slide, not per deck:

1. Render a selected slide: `SLIDES=N TARGET=both node build.js`.
2. Rasterize the PPTX and capture/screenshot HTML using `qa-and-rendering.md`.
3. Run `slide_qa_gate` against exactly one source/render pair.
4. Apply fixes centrally to the owning fragment or crop plan.
5. Re-run `validate_agent_work.js` for that slide.
6. Re-run `merge_fragments.js --slides N --backup` only if the shared output needs to be refreshed
   from the changed fragment, or re-run full merge for a full deck.
7. Re-render only failed slides until every slide has an accepted `qa_report.md`.

## Common Failure Modes

`crop includes text that is also recreated natively`
: Trim the crop or shrink its box. Do not accept duplicate captions or labels.

`worker edits shared files`
: Reject the worker output and restore shared files from the integrator/main-thread version. Workers
  must only write to `work/slideXX/`.

`style profile is forced despite low confidence`
: Use fallback/open extraction/crop-heavy mode and flag the missing idiom. Do not force the nearest
  frozen profile when the match is weak.

`text wrapping differs between PPTX and HTML`
: Adjust the text box width/height, enable shrink where appropriate, reduce font size, or split the
  line deliberately. Verify both PPTX raster and browser HTML.

`missing icons`
: Check `make_icons.js` `MAP` and the generated `assets/icons/` files before authoring. Missing icon
  concepts render as blanks.

`fragment uses backend-specific logic`
: Reject fragments containing PPTX/HTML branching. Backend-specific concessions belong in surface
  atoms, not slide code.

`QA is done only at batch level instead of per slide`
: Reject the batch. A contact sheet is useful for a final scan, but every slide needs its own source
  comparison and `qa_report.md`.

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

If a deck has no unrecreatable raster regions, pass `--skip-crops`; otherwise create `work/crop_plan.json` or pass `--crop-plan <path>`. The pipeline records `cropPlanPath`, `cropPlanHash`, `cropManifestPath`, `cropManifestHash`, `nodePathUsed`, and `dependencyResolutionMode` in `out/render_trace.json`; `final_gate.js` revalidates them before delivery.

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
