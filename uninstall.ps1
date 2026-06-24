param(
  [string]$TargetRoot = "",
  [switch]$UseAgentsSkillsPath,
  [switch]$DryRun,
  [switch]$BackupBeforeRemove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SkillNames = @(
  "slide-text-layer-inpaint",
  "slide-image-dual-render",
  "slide-visual-polish-qa",
  "slide-editable-deck-orchestrator"
)

if (-not $TargetRoot) {
  if ($UseAgentsSkillsPath) {
    $TargetRoot = Join-Path $env:USERPROFILE ".agents\skills"
  } else {
    $TargetRoot = Join-Path $env:USERPROFILE ".codex\skills"
  }
}

function Write-Step($Message) {
  Write-Host "[uninstall] $Message"
}

Write-Step "Target Skill root: $TargetRoot"

foreach ($name in $SkillNames) {
  $path = Join-Path $TargetRoot $name
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Step "Not installed: $path"
    continue
  }

  if ($BackupBeforeRemove) {
    $backup = "$path.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if ($DryRun) {
      Write-Step "Would move $path -> $backup"
    } else {
      Move-Item -LiteralPath $path -Destination $backup
      Write-Step "Backed up $path -> $backup"
    }
  } elseif ($DryRun) {
    Write-Step "Would remove $path"
  } else {
    Remove-Item -LiteralPath $path -Recurse -Force
    Write-Step "Removed $path"
  }
}

Write-Step "Done. No unrelated Skill folders were touched."

