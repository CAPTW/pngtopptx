# Install

This guide installs the local `pngtopptx` slide reconstruction toolkit.

## Standard Install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force
```

Default install location:

```text
%USERPROFILE%\.pngtopptx\skills
```

Use `-TargetRoot` for another local directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TargetRoot "D:\tools\pngtopptx\skills" -BackupExisting -Force
```

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

For a repository-local dry run:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 -DryRun
```

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

## Troubleshooting

- If verification reports missing modules, rerun `install.ps1` with
  `-BackupExisting -Force`.
- If Node or Python checks fail, install the dependencies listed in
  [DEPENDENCIES.md](DEPENDENCIES.md).
- Keep real conversion jobs in a separate deck project rather than inside the
  installed toolkit directory.
