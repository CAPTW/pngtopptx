# slide-image-dual-render Hard-Locked Workflow

For slide-image-dual-render work, the only valid production conversion path is:

Skill-installed layout, run from the deck project root:

```powershell
$env:SLIDE_PIPELINE_STRICT="1"
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\slide_pipeline.js" --target both --pptx-out out\deck.pptx --html-out out\deck.html
```

Deck-local copied layout:

```bash
export SLIDE_PIPELINE_STRICT=1
node scripts/slide_pipeline.js --target both --pptx-out out/deck.pptx --html-out out/deck.html
```

Rules:

- Do not generate PPTX directly.
- Do not use python-pptx.
- Do not turn each slide into a full-slide raster image.
- Do not bypass `lib/slides.js`.
- Do not edit shared renderer files during conversion unless the task explicitly says Skill development.
- Do not use HTML/PDF-to-PPTX conversion as a creation path.
- Use LibreOffice only for QA rasterization/export checks, never to create the deliverable PPTX.

Before final delivery, run:

Skill-installed layout:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-image-dual-render\scripts\final_gate.js" --target both --pptx out\deck.pptx --html out\deck.html
```

Deck-local copied layout:

```bash
node scripts/final_gate.js --target both --pptx out/deck.pptx --html out/deck.html
```

If the gate fails, the output is not deliverable. Fix the slide fragments, crop plan, or renderer contract and rerun `slide_pipeline.js`.

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
