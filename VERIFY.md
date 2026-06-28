# Verify

Use these checks after installing or editing the toolkit.

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -DryRun
node .\tests\verify_skillset_layout.js
python .\tests\verify_python_scripts.py
```

For rendered deck outputs, run the final gate and strict PPTX package validator:

```powershell
node "$env:USERPROFILE\.pngtopptx\skills\slide-image-dual-render\scripts\final_gate.js" --project . --target both --pptx out\deck.pptx --html out\deck.html
python "$env:USERPROFILE\.pngtopptx\skills\slide-image-dual-render\scripts\validate_pptx_package.py" --project . --pptx out\deck.pptx --out out\pptx_package_validation --strict
```
