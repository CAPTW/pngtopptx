---
name: slide-editable-deck-orchestrator
description: Coordinate the slide-text-layer-inpaint, slide-image-dual-render, and slide-visual-polish-qa Skills to convert source slide images into a final editable PPTX and HTML with hardlocked validation, visual QA, repair-wave planning, and final delivery packaging. Use when the user asks to run or plan an end-to-end editable deck conversion, automate repair waves, close fail/blocking slides, summarize visual QA backlog, or package final slide reconstruction artifacts.
---

# Slide Editable Deck Orchestrator

## Purpose

Use this meta Skill to coordinate the existing slide reconstruction Skills without merging or weakening them:

1. `slide-text-layer-inpaint` for optional text-layer preprocessing, masks, clean backgrounds, pseudo-text policy, and residual checks.
2. `slide-image-dual-render` for editable PPTX/HTML reconstruction, route hardlock, reconstruction hardlock, crop policy, and PPTX openability.
3. `slide-visual-polish-qa` for source/PPTX/HTML visual QA, calibrated status classification, and fix plans.

This Skill does not replace those Skills. It plans and audits the handoffs between them.

## Core Workflow

1. Prepare `src/slideN.png` source images and project folders.
2. Run text-layer preprocessing only when useful: dense text layers, pseudo text risk, inpainting need, or prior text failures.
3. Run editable reconstruction through `slide-image-dual-render` hardlocked pipeline.
4. Run full-deck visual QA through `slide-visual-polish-qa`.
5. Identify `fail` / blocking slides from `visual_qa_summary*.json`.
6. Group blocking slides into waves of at most 5.
7. Choose a repair strategy by issue type.
8. Generate a Codex-ready repair prompt for `slide-image-dual-render`.
9. Rebuild the wave and rerun visual QA with `--source-slides`.
10. Repeat until no slide remains `fail` / blocking or max iterations is reached.
11. Run final full-deck hardlocked build, full-deck visual QA, and delivery packaging.

For the full procedure, read [orchestrator-workflow.md](references/orchestrator-workflow.md).

## Quality Levels

- `canary`: one-slide smoke test; approximate output allowed; not production.
- `blocking-zero`: production default; route hardlock, reconstruction hardlock, PPTX openability, and 0 fail/blocking slides required; `needs_polish` is allowed and reported.
- `polish`: same as `blocking-zero`, plus one or more passes to reduce `needs_polish`.
- `strict`: attempts to move all slides to pass/minor; not default and may require many iterations.

Read [quality-levels.md](references/quality-levels.md) when deciding acceptance criteria.

## Script Quick Start

Run these from a deck project root:

```powershell
node "$env:USERPROFILE\.codex\skills\slide-editable-deck-orchestrator\scripts\plan_deck_workflow.js" --project . --quality-level blocking-zero
node "$env:USERPROFILE\.codex\skills\slide-editable-deck-orchestrator\scripts\summarize_visual_backlog.js" --summary out\visual_qa_summary.json
node "$env:USERPROFILE\.codex\skills\slide-editable-deck-orchestrator\scripts\make_repair_wave_plan.js" --summary out\visual_qa_summary.json --quality-level blocking-zero --out work\repair_wave_plan.json
node "$env:USERPROFILE\.codex\skills\slide-editable-deck-orchestrator\scripts\generate_repair_prompt.js" --project . --quality-level blocking-zero --wave-plan work\repair_wave_plan.json --wave-index 0
node "$env:USERPROFILE\.codex\skills\slide-editable-deck-orchestrator\scripts\enforce_orchestration_state.js" --state work\orchestration_state.json --summary out\visual_qa_summary.json --quality-level blocking-zero
```

All scripts use Node built-ins only. `--quality-level` is the canonical orchestrator option; `--quality` is accepted only as a backward-compatible alias.

## Reference Routing

- Read [repair-playbook.md](references/repair-playbook.md) when translating visual issue types into slide repair strategy.
- Read [handoff-contracts.md](references/handoff-contracts.md) when checking artifacts between the three companion Skills.
- Read [failure-policy.md](references/failure-policy.md) when any gate fails, a Skill bug appears, or the iteration cap is reached.

## Guardrails

- Do not modify `slide-image-dual-render`, `slide-text-layer-inpaint`, or `slide-visual-polish-qa` during deck conversion.
- Stop and report if a clear Skill bug appears.
- Do not weaken hardlocks, crop gates, PPTX openability checks, or visual QA thresholds.
- Do not accept full-slide screenshot shortcuts as editable reconstruction.
- Use source-slide mapping for selected-wave QA outputs.
