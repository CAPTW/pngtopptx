# Hard-Locked Workflow Mode

Prompt-only enforcement is not enough for real slide conversion work. A model can still take shortcuts: direct PPTX generation, full-slide screenshots, HTML-to-PPTX conversion, or alternate scripts that bypass the backend-agnostic renderer. Hard-Locked Workflow Mode adds code-level gates so those shortcuts fail validation.

## Approved files

Production conversion must flow through these files:

- `scripts/slide_pipeline.js` as the central entrypoint.
- `scripts/enforce_contract.js` for preflight, postbuild, and final contract validation.
- `scripts/build.js` as the only top-level render orchestrator.
- `scripts/lib/atoms_pptx.js` as the only PPTX backend surface.
- `scripts/lib/atoms_html.js` as the only HTML backend surface.
- `scripts/lib/kit.js` and `lib/slides.js` for backend-agnostic authoring.
- `scripts/make_bg.py`, `scripts/make_icons.js`, and `scripts/make_crops.py` for approved assets.

## Protected files

During conversion work, workers should not edit:

- `scripts/build.js`
- `scripts/lib/atoms_pptx.js`
- `scripts/lib/atoms_html.js`
- `scripts/lib/kit.js`
- `scripts/lib/profile.js`
- `styles/*.json`

Only explicit Skill development tasks should modify those files.

## Allowed commands

Use the pipeline:

Skill-installed layout, run from the deck project root:

```powershell
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --slides 1,2,3 --target both --pptx-out out\deck.pptx --html-out out\deck.html
```

Deck-local copied layout:

```bash
DECK_PROFILE="$PWD/styles/clinical-dark.json" DECK_ASSETS="$PWD/assets" DECK_PXW=1672 DECK_PXH=941 \
  node scripts/slide_pipeline.js --slides 1,2,3 --target both --pptx-out out/deck.pptx --html-out out/deck.html
```

Validate before delivery:

Skill-installed layout:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --target both --pptx out\deck.pptx --html out\deck.html
```

Deck-local copied layout:

```bash
node scripts/final_gate.js --target both --pptx out/deck.pptx --html out/deck.html
```

LibreOffice is allowed for QA export checks such as PPTX to PDF to PNG. It is not allowed as a creation path for the deliverable PPTX.

## Forbidden shortcuts

- Direct `pptxgenjs` or `python-pptx` generation outside the approved backend.
- HTML-to-PPTX or PDF-to-PPTX conversion.
- Placing `src/slideN.png` as a full-slide image.
- Creating a PPTX from screenshots.
- Adding new renderer backends in slide code.
- Branching in `lib/slides.js` on `TARGET`, `document`, `window`, PPTX APIs, or HTML APIs.

## Validator behavior

`enforce_contract.js` checks:

- `lib/slides.js` exists, imports the kit, defines and exports `s1`, `s2`, etc.
- Selected slide functions exist.
- Slide code does not reference PPTX/HTML backends directly.
- Source slide images are not used as full-slide backgrounds.
- Alternate JS/Python scripts do not directly create PPTX files.
- Crop manifest entries include `name`, `slide`, `x`, `y`, `w`, `h`, and `file`.
- Crop policy metadata from `work/crop_plan.json` / `--crop-plan` is authoritative and must be
  preserved into `assets/manifest.json`; legacy defaults are only for old crop plans that omit
  metadata and remain visible to reconstruction validation.
- Large crops fail unless explicitly justified with `allow_large_crop: true` and a reason.
- Final outputs exist and were created after the pipeline start time.
- `out/render_trace.json` says validation passed.

## Render parity hardening

Hard-Locked output remains one backend-agnostic slide program replayed through PPTX and HTML. Shared
renderer bugs must be fixed in the approved Skill backend, not hidden by per-slide branches or visual
QA threshold changes.

Current parity requirements:

- Generated HTML exposes `?qa=1` / `#qa` static mode for visual QA. In that mode the slide element is
  exactly `DECK_PXW × DECK_PXH`, has no transform scale, and records `appliedScale = 1`.
- The visual QA capture path must fail if the PNG is not exactly the expected source-pixel dimensions
  unless a caller has explicitly recorded a diagnostic-only justification.
- The build resolves one local font family for both PPTX and HTML. Remote HTML webfonts are disabled
  for parity QA because PPTX rasterization cannot use them unless the same font is installed locally.
- Helper-level geometry must stay backend-consistent: zero/negative line dimensions are normalized,
  source-pixel line widths are converted to PPTX points, and HTML line widths remain source pixels.

Do not make a blocking slide pass by relaxing visual QA bands. Fix capture scale, font parity, shared
helpers, or deck reconstruction defects at the appropriate layer.

## Hook behavior

The optional Codex hooks in `assets/codex-hardlock/hooks/` are guardrails, not the enforcement
source of truth. They block obvious mistakes early and warn after suspicious tool use, but hooks can
miss commands, vary by Codex version, or be absent in a workspace.

The real production gate is:

- `scripts/enforce_contract.js`
- `out/render_trace.json`
- `scripts/final_gate.js`

Validators must fail final delivery if hooks miss something.

Install hook templates with:

Skill-installed layout:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\install_hardlock.js" --project .
```

Deck-local copied layout:

```bash
node scripts/install_hardlock.js --project .
```

Then review `.codex/config.toml.example`, merge it into `.codex/config.toml`, and restart Codex.

## Permission profile guidance

A conversion workspace should make renderer and style files read-only while allowing writes to:

- `work/`
- `assets/`
- `out/`
- `lib/slides.js`

Exact permission syntax changes across Codex versions. Treat `assets/codex-hardlock/config.toml.example` as a template, not a guaranteed drop-in config.

## Final delivery gate

A PPTX/HTML delivery is invalid unless this passes:

Skill-installed layout:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --target both --pptx out\deck.pptx --html out\deck.html
```

Deck-local copied layout:

```bash
node scripts/final_gate.js --target both --pptx out/deck.pptx --html out/deck.html
```

The gate checks the trace, outputs, approved pipeline identity, and final contract validation.

## Troubleshooting blocked work

- If `build.js` is blocked in strict mode, run `node scripts/slide_pipeline.js` instead of `node build.js`.
- If a crop is too large, rebuild more of the slide as native objects or add `allow_large_crop: true` with a concrete reason only when the crop is genuinely unrecreatable.
- If a protected file needs edits, stop and make the task explicit as Skill development, not conversion.
- If hooks block QA conversion, ensure the command exports PPTX to PDF/PNG only and does not create a PPTX.
- If final gate fails, inspect `out/render_trace.json`, fix the reported contract issue, rerun the pipeline, then rerun the final gate.

<!-- HARDLOCK_PATH_CONTRACT_BEGIN -->

## Skill-installed and deck-local path contract

Hard-Locked Workflow Mode separates the renderer installation from the deck project. The scripts may live in `~/.codex/skills/slide-image-dual-render/scripts/`, but the deck project root is still the current working directory or `--project`.

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

The trace records both `skillRoot` and `projectRoot`. `final_gate.js` revalidates the current files against the exact paths and hashes recorded in `out/render_trace.json`.

Hooks are guardrails, not the only enforcement layer. The production gate is `enforce_contract.js`, `out/render_trace.json`, and `final_gate.js`. Hooks block obvious mistakes early, but validators must fail final delivery if hooks miss a shortcut.

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
