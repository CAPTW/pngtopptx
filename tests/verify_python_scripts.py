#!/usr/bin/env python
import os
import py_compile
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
skills_root = ROOT / "skills"
errors = []
compiled = 0

for script in sorted(skills_root.rglob("*.py")):
    parts = set(script.relative_to(ROOT).parts)
    if {"__pycache__", "node_modules", ".git", "out", "work"} & parts:
        continue
    try:
        fd, cfile = tempfile.mkstemp(suffix=".pyc")
        os.close(fd)
        try:
            py_compile.compile(str(script), cfile=cfile, doraise=True)
        finally:
            if os.path.exists(cfile):
                os.remove(cfile)
        compiled += 1
    except Exception as exc:  # noqa: BLE001 - verifier should report all compile failures.
        errors.append(f"{script}: {exc}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)

print({"status": "ok", "compiledPythonScripts": compiled})
