param(
  [string]$TargetRoot = "",
  [switch]$UseAgentsSkillsPath,
  [switch]$InstallAgents,
  [switch]$DryRun,
  [switch]$Force,
  [switch]$BackupExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PackageRoot = $PSScriptRoot
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
  Write-Host "[install] $Message"
}

function Backup-Path($Path) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = "$Path.backup-$stamp"
  if ($DryRun) {
    Write-Step "Would back up $Path -> $backup"
  } else {
    Move-Item -LiteralPath $Path -Destination $backup
    Write-Step "Backed up $Path -> $backup"
  }
}

function Install-Directory($Source, $Destination) {
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing package source: $Source"
  }

  if (Test-Path -LiteralPath $Destination) {
    if ($BackupExisting) {
      Backup-Path $Destination
    } elseif (-not $Force) {
      throw "Target already exists: $Destination. Use -Force or -BackupExisting."
    } else {
      if ($DryRun) {
        Write-Step "Would remove existing $Destination"
      } else {
        Remove-Item -LiteralPath $Destination -Recurse -Force
      }
    }
  }

  if ($DryRun) {
    Write-Step "Would copy $Source -> $Destination"
  } else {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse
    Write-Step "Installed $Destination"
  }
}

Write-Step "Package root: $PackageRoot"
Write-Step "Target Skill root: $TargetRoot"

foreach ($name in $SkillNames) {
  Install-Directory -Source (Join-Path $PackageRoot "skills\$name") -Destination (Join-Path $TargetRoot $name)
}

if ($InstallAgents) {
  $agentSource = Join-Path $PackageRoot "agents\codex-agents"
  $agentTarget = Join-Path $env:USERPROFILE ".codex\agents"
  if (Test-Path -LiteralPath $agentSource) {
    if (-not $DryRun) {
      New-Item -ItemType Directory -Path $agentTarget -Force | Out-Null
    }
    Get-ChildItem -LiteralPath $agentSource -Filter "*.toml" -File | ForEach-Object {
      $dest = Join-Path $agentTarget $_.Name
      if ((Test-Path -LiteralPath $dest) -and -not $Force) {
        Write-Step "Skipping existing agent template $dest; use -Force to overwrite"
      } elseif ($DryRun) {
        Write-Step "Would copy agent $($_.FullName) -> $dest"
      } else {
        Copy-Item -LiteralPath $_.FullName -Destination $dest -Force:$Force
        Write-Step "Installed agent template $dest"
      }
    }
  }
}

Write-Step "Install complete."
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Restart Codex Desktop/App."
Write-Host "2. Verify with: powershell -ExecutionPolicy Bypass -File .\verify_install.ps1"
Write-Host "3. Invoke with: Use `$slide-editable-deck-orchestrator."

