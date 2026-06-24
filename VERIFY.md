# Verify

Verification answers two questions:

1. Is the SkillSet package laid out correctly?
2. Does this computer have the tools needed for installation and conversion?

## For Most Users

After installation, run this from the extracted repository folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

You want the summary to say:

```text
Failures: 0
```

Warnings may be acceptable when they describe optional conversion tools. For
example, a basic install can succeed even if a later visual QA workflow needs
LibreOffice or Chrome.

## Check Before Installing

From the package root:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -DryRun
```

`-DryRun` checks the package files without requiring that they have already been
installed into your Codex Skills folder.

## Developer Checks

Run package layout tests:

```powershell
node tests\verify_skillset_layout.js
python tests\verify_python_scripts.py
```

Expected result:

- all four Skill folders are present
- each Skill has `SKILL.md`
- important scripts are present
- major JavaScript files pass `node --check`
- major Python files pass `python -m py_compile`
- missing optional dependencies are reported as warnings, not installed automatically

## Quick Codex Smoke Test

After restarting Codex, try:

```text
Use $slide-editable-deck-orchestrator.
Check that the pngtopptx editable PPTX SkillSet is available.
Do not run a deck conversion.
```

For an existing completed deck project, use:

```text
Use $slide-editable-deck-orchestrator.

Run a non-destructive orchestrator smoke test on an existing completed deck project.
Do not rerun full deck conversion.
Do not rerun visual QA unless an existing required summary is missing.
```

## What The Verifier Checks

The verifier checks:

- all four Skill folders are present;
- each Skill has `SKILL.md`;
- important scripts are present;
- major JavaScript files pass `node --check`;
- major Python files compile;
- common local tools are available when possible.

It does not automatically install missing tools.
