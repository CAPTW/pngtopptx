# Install

`pngtopptx` installs four local slide-reconstruction Skills. Pick one target directory and keep that path consistent across install, verification, runtime commands, upgrades, and uninstall.

## Canonical path model

| Layout | Target root | When to use it |
|---|---|---|
| Default portable | `%USERPROFILE%\.pngtopptx\skills` | Standalone local installation and the repository's default commands |
| Codex-native | `%USERPROFILE%\.codex\skills` | When these Skills should appear directly in the user's Codex Skill directory |
| Custom | Any local directory | Managed tool directories or isolated test installations |

The scripts support all three. No layout is inferred after installation: later commands must point to the root you selected.

## Default portable install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

Installed Skills:

```text
%USERPROFILE%\.pngtopptx\skills\slide-text-layer-inpaint
%USERPROFILE%\.pngtopptx\skills\slide-image-dual-render
%USERPROFILE%\.pngtopptx\skills\slide-visual-polish-qa
%USERPROFILE%\.pngtopptx\skils\slide-editable-deck-orchestrator
```

## Codex-native install

```powershell
$skillRoot = Join-Path $env:USERPROFILE ".codex\skills"

powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -TargetRoot $skillRoot `
  -BackupExisting `
  -Force

powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 `
  -TargetRoot $skillRoot
```

## Another custom directory

```powershell
$skillRoot = "D:\tools\pngtopptx\skills"

powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -TargetRoot $skillRoot `
  -BackupExisting `
  -Force

powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 `
  -TargetRoot $skillRoot
```

## Upgrade safely

Run the installer again with `-BackupExisting -Force`. Each existing Skill directory is moved to a timestamped backup before the new copy is installed.

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

For a custom root, repeat the same `-TargetRoot` value on both commands.

## Repository-local verification

Validate the checked-out package without touching an installed copy:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -DryRun
node .\tests\verify_skillset_layout.js
python .\tests\verify_python_scripts.py
```

## Uninstall

Default root:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Custom root:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 `
  -TargetRoot $skillRoot
```

Add `-BackupBeforeRemove` to retain timestamped copies instead of deleting the four installed Skill directories.

## Troubleshooting

- If verification reports missing modules, rerun `install.ps1` with `-BackupExisting -Force`.
- If Node or Python checks fail, install the dependencies listed in [DEPENDENCIES.md](DEPENDENCIES.md).
- If a command cannot find a Skill script, compare its root with the exact `-TargetRoot` used during installation.
- Keep real deck projects outside both the repository and installed Skill directory.
