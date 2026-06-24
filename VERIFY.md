# Verify

From the package root:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -DryRun
```

After installation:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

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

Orchestrator smoke test prompt:

```text
Use $slide-editable-deck-orchestrator.

Run a non-destructive orchestrator smoke test on an existing completed deck project.
Do not rerun full deck conversion.
Do not rerun visual QA unless an existing required summary is missing.
```

