# Failure Policy

## Stop Conditions

Stop and report before patching if:

- A clear bug is found in `slide-image-dual-render`, `slide-text-layer-inpaint`, or `slide-visual-polish-qa`.
- PPTX openability fails because of a renderer/package issue.
- Source-slide mapping fails in a way that indicates QA tool behavior is wrong.
- A hardlock rejects output that appears valid and the cause is in Skill code.

## Do Not Weaken Gates

Never:

- Loosen visual QA thresholds to pass a bad slide.
- Disable route hardlock.
- Disable reconstruction hardlock.
- Disable PPTX openability.
- Accept scaled HTML screenshots.
- Replace native reconstruction with full-slide image backgrounds.
- Promote pseudo text into incorrect native semantic text.

## Iteration Limit

If max iterations are reached:

1. Mark the orchestration status incomplete.
2. Report exact blocking slides.
3. Report issue types and recommended next repair wave.
4. Preserve all generated artifacts.
5. Do not claim final delivery is production-complete.

## Incomplete Delivery Language

Use concrete status:

- `complete`: hardlocks pass and no fail/blocking visual QA slides remain.
- `incomplete`: hardlock or visual QA blocking issues remain.
- `blocked`: a Skill bug, missing dependency, unavailable source, or repeated validation failure prevents meaningful progress.
