# Quickstart

Get the four-Skill `pngtopptx` toolkit installed, verified, and ready for a separate deck project.

## 1. Get the repository

Clone it:

```powershell
git clone https://github.com/CAPTW/pngtopptx.git
cd pngtopptx
```

Or download the repository ZIP from GitHub, extract it, and open PowerShell in the extracted folder.

## 2. Choose one Skill root

### Default portable install

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -BackupExisting -Force
powershell -ExecutionPolicy Bypass -File .\verify_install.ps1
```

Default location:

```text
%USERPROFILE%\.pngtopptx\skills
```

### Codex-native or another custom Skill root

```powershell
$skillRoot = Join-Path $env:USERPROFILE ".codex\skills"

powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -TargetRoot $skillRoot `
  -BackupExisting `
  -Force

powershell -ExecutionPolicy Bypass -File .\verify_install.ps1 `
  -TargetRoot $skillRoot
```

Use the same `-TargetRoot` for installation, verification, and later script commands. The toolkit never switches roots implicitly.

## 3. Create a separate deck project

Do not create real conversion outputs inside the repository or installed Skill directory.

```powershell
mkdir deck
cd deck
mkdir src, assets, work, out, lib
npm i pptxgenjs sharp react react-dom react-icons
```

Copy source slide images into `src/` as `slide1.png`, `slide2.png`, and so on.

## 4. Start with the orchestrator

Use [`slide-editable-deck-orchestrator`](skills/slide-editable-deck-orchestrator/SKILL.md) for an end-to-end conversion. It coordinates optional text-layer cleanup, dual PPTX/HTML reconstruction, visual QA, repair waves, and final delivery gates.

For direct renderer commands, quality modes, font decisions, crop plans, and `--qa-only`, continue with the [README](README.md) and [`slide-image-dual-render`](skills/slide-image-dual-render/SKILL.md).
