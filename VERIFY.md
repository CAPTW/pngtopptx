# Verify

Use fresh checks after installing, upgrading, editing, or packaging the toolkit.

## Verify an installed copy

Default portable root:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

Custom root:

```powershell
$skillRoot = Join-Path $env:USERPROFILE ".codex\skills" # or another selected root
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -TargetRoot $skillRoot
```

## Verify the repository package

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -DryRun
node .\tests\verify_skillset_layout.js
python .\tests\verify_python_scripts.py
```

## Verify rendered deck outputs

Run these from the deck project root. Set `$skillRoot` to the same directory used during installation.

```powershell
$skillRoot = Join-Path $env:USERPROFILE ".pngtopptx\skills" # or your custom -TargetRoot

node (Join-Path $skillRoot "slide-image-dual-render\scripts\final_gate.js") `
  --project . `
  --target both `
  --pptx out\deck.pptx `
  --html out\deck.html

python (Join-Path $skillRoot "slide-image-dual-render\scripts\validate_pptx_package.py") `
  --project . `
  --pptx out\deck.pptx `
  --out out\pptx_package_validation `
  --strict
```

A file that merely opens is not the completion criterion. Delivery evidence should also account for route integrity, native-object reconstruction, declared crop coverage, font resolution, and visual QA at the selected quality level.
