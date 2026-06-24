# Orchestrator Workflow

## Scope

Coordinate a deck image-to-editable reconstruction workflow across:

- `slide-text-layer-inpaint`
- `slide-image-dual-render`
- `slide-visual-polish-qa`

The orchestrator owns planning, state, repair-wave generation, iteration control, and delivery checks. It does not patch stable companion Skills during conversion.

## Inputs

Expected deck project layout:

```text
project/
  src/slide1.png ... src/slideN.png
  styles/clinical-dark.json
  assets/
  work/
  out/
  lib/slides.js
```

Set the standard reconstruction environment before builds:

```powershell
$env:SLIDE_PIPELINE_STRICT="1"
$env:DECK_PROFILE="$PWD\styles\clinical-dark.json"
$env:DECK_ASSETS="$PWD\assets"
$env:DECK_PXW="1672"
$env:DECK_PXH="941"
```

## State

The orchestrator writes `work/orchestration_state.json`:

```json
{
  "schemaVersion": "0.1.0",
  "projectRoot": "",
  "qualityLevel": "blocking-zero",
  "slides": [1, 2, 3],
  "waves": [],
  "iterations": [],
  "currentStatus": {
    "pass": [],
    "needs_polish": [],
    "fail": []
  },
  "artifacts": {
    "pptx": "",
    "html": "",
    "visualQaSummary": "",
    "renderTrace": ""
  }
}
```

## Workflow

1. Run `plan_deck_workflow.js`.
   - Discover `src/slideN.png`.
   - Choose `qualityLevel`.
   - Create `work/orchestration_state.json`.
   - Use `--quality-level blocking-zero` as the canonical CLI option. `--quality blocking-zero` is supported only as a backward-compatible alias.

2. Decide text-layer preprocessing.
   - Run `slide-text-layer-inpaint` when the deck has dense semantic text, pseudo text, inpainting needs, or previous OCR/text reconstruction risk.
   - Skip for simple canaries or decks where native reconstruction already has reviewed semantic text.
   - Treat text-layer artifacts as evidence, never as a replacement for editable reconstruction.

3. Run initial reconstruction with `slide-image-dual-render`.
   - Use `slide_pipeline.js`.
   - Require route hardlock, reconstruction hardlock, crop metadata, and PPTX openability.

4. Run visual QA with `slide-visual-polish-qa`.
   - For full-deck outputs where source IDs match physical slide numbers, `--source-slides 1,2,...` is still acceptable.
   - For wave outputs, always use `--source-slides`.

5. Summarize backlog.
   - Use `summarize_visual_backlog.js`.
   - Any `fail` slide or any slide with blocking issues is a blocking slide.

6. Make repair waves.
   - Use `make_repair_wave_plan.js`.
   - Pass `--quality-level blocking-zero` for production blocking repair planning.
   - Group at most 5 slides per wave.
   - Prioritize fail/blocking before `needs_polish`.

7. Generate repair prompts.
   - Use `generate_repair_prompt.js`.
   - Prompts must tell the repair agent not to modify Skill files or loosen thresholds.

8. Execute repair waves with `slide-image-dual-render`.
   - Apply deck reconstruction fixes only.
   - Rebuild the wave with `slide_pipeline.js`.
   - Run `final_gate.js`.
   - Rerun visual QA with `--source-slides`.

9. Iterate.
   - `blocking-zero`: stop once there are 0 fail/blocking slides.
   - `polish`: optionally continue through `needs_polish` repair waves.
   - `strict`: continue until all slides pass/minor or max iteration is reached.

10. Final delivery.
    - Build all slides with `--allow-large-batch`.
    - Run final gate.
    - Run full-deck visual QA.
    - Package the final artifacts listed in `handoff-contracts.md`.

## Do Not

- Do not directly edit or repair generated PPTX files.
- Do not save through PowerPoint or LibreOffice as a repair.
- Do not use full-slide screenshot backgrounds.
- Do not convert pseudo text into incorrect semantic text.
- Do not relax visual QA thresholds.
