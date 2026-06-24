# Quality Levels

Use `--quality-level <level>` when invoking orchestrator scripts. `--quality <level>` is accepted as a backward-compatible alias, but examples should use `--quality-level blocking-zero`.

## `canary`

Purpose:

- One-slide smoke test.
- Validate scripts, source dimensions, basic pipeline, and PPTX openability.

Acceptance:

- Approximate output allowed.
- Not production.
- Should still use approved commands when possible.

## `blocking-zero`

Purpose:

- Production default.
- Deliver an editable PPTX/HTML package with no fail/blocking slides.

Required:

- Route hardlock passes.
- Reconstruction hardlock passes.
- PPTX openability passes.
- Visual QA has 0 fail/blocking slides.
- `needs_polish` slides are allowed and reported.

Stop condition:

- All selected slides are `pass` or `needs_polish`.

## `polish`

Purpose:

- Production plus one or more optional repair passes to reduce `needs_polish`.

Required:

- Everything in `blocking-zero`.
- Continue repair waves while the user has budget/time and the issue plan is actionable.

Stop condition:

- No blocking slides, and either the requested polish iterations are complete or remaining issues are acceptable editable-reconstruction drift.

## `strict`

Purpose:

- Attempt pass/minor on all slides.

Required:

- Everything in `blocking-zero`.
- Treat `needs_polish` as unresolved.

Stop condition:

- All slides pass/minor, or max iteration is reached.

Risk:

- May require many iterations.
- May expose acceptable editable-reconstruction drift that should not be forced into crop-heavy shortcuts.
