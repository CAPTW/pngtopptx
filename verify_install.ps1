param(
  [string]$TargetRoot = "",
  [switch]$UseAgentsSkillsPath,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$PackageRoot = $PSScriptRoot
$SkillNames = @(
  "slide-text-layer-inpaint",
  "slide-image-dual-render",
  "slide-visual-polish-qa",
  "slide-editable-deck-orchestrator"
)

if ($DryRun) {
  $TargetRoot = Join-Path $PackageRoot "skills"
} elseif (-not $TargetRoot) {
  if ($UseAgentsSkillsPath) {
    $TargetRoot = Join-Path $env:USERPROFILE ".agents\skills"
  } else {
    $TargetRoot = Join-Path $env:USERPROFILE ".codex\skills"
  }
}

$Failures = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]

function Pass($Message) { Write-Host "[PASS] $Message" }
function Warn($Message) { $script:Warnings.Add($Message); Write-Host "[WARN] $Message" }
function Fail($Message) { $script:Failures.Add($Message); Write-Host "[FAIL] $Message" }

function Check-Path($Path, $Label) {
  if (Test-Path -LiteralPath $Path) { Pass $Label } else { Fail "$Label missing: $Path" }
}

function Has-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Find-Executable($CommandNames, $KnownPaths) {
  foreach ($name in $CommandNames) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) {
      return [ordered]@{ Found = $true; Source = $cmd.Source; Mode = "PATH" }
    }
  }
  foreach ($candidate in $KnownPaths) {
    if (Test-Path -LiteralPath $candidate) {
      return [ordered]@{ Found = $true; Source = $candidate; Mode = "known path" }
    }
  }
  return [ordered]@{ Found = $false; Source = ""; Mode = "" }
}

function Check-OptionalExecutable($Label, $CommandNames, $KnownPaths) {
  $result = Find-Executable -CommandNames $CommandNames -KnownPaths $KnownPaths
  if ($result.Found) {
    Pass "$Label available via $($result.Mode): $($result.Source)"
  } else {
    Warn "$Label not found (optional)"
  }
}

Write-Host "Verifying editable-pptx-skillset"
Write-Host "Target root: $TargetRoot"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"

foreach ($name in $SkillNames) {
  $root = Join-Path $TargetRoot $name
  Check-Path $root "$name folder"
  Check-Path (Join-Path $root "SKILL.md") "$name SKILL.md"
}

$ImportantScripts = @(
  "slide-text-layer-inpaint\scripts\detect_text_regions.py",
  "slide-text-layer-inpaint\scripts\make_text_masks.py",
  "slide-text-layer-inpaint\scripts\inpaint_text_regions.py",
  "slide-text-layer-inpaint\scripts\enforce_text_layer.js",
  "slide-image-dual-render\scripts\slide_pipeline.js",
  "slide-image-dual-render\scripts\final_gate.js",
  "slide-image-dual-render\scripts\validate_pptx_package.py",
  "slide-visual-polish-qa\scripts\compare_slide_images.py",
  "slide-visual-polish-qa\scripts\capture_html_screenshot.py",
  "slide-visual-polish-qa\scripts\enforce_visual_qa.js",
  "slide-editable-deck-orchestrator\scripts\plan_deck_workflow.js",
  "slide-editable-deck-orchestrator\scripts\enforce_orchestration_state.js"
)
foreach ($rel in $ImportantScripts) {
  Check-Path (Join-Path $TargetRoot $rel) "script $rel"
}

$nodeAvailable = Has-Command "node"
$pythonAvailable = Has-Command "python"
if ($nodeAvailable) { Pass "Node.js available" } else { Fail "Node.js not found on PATH" }
if ($pythonAvailable) { Pass "Python available" } else { Fail "Python not found on PATH" }

if ($pythonAvailable) {
  $imports = @(
    @{ Module = "PIL"; Package = "Pillow" },
    @{ Module = "numpy"; Package = "numpy" },
    @{ Module = "cv2"; Package = "opencv-python" },
    @{ Module = "skimage"; Package = "scikit-image" },
    @{ Module = "pytesseract"; Package = "pytesseract optional" }
  )
  foreach ($item in $imports) {
    & python -c "import $($item.Module)" 2>$null
    if ($LASTEXITCODE -eq 0) { Pass "Python package available: $($item.Package)" } else { Warn "Python package missing: $($item.Package)" }
  }
}

Check-OptionalExecutable "Tesseract binary" @("tesseract") @(
  "C:\Program Files\Tesseract-OCR\tesseract.exe",
  "C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"
)
Check-OptionalExecutable "Chrome or Edge" @("chrome", "msedge") @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)
Check-OptionalExecutable "PowerPoint" @("POWERPNT.EXE") @(
  "C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE",
  "C:\Program Files (x86)\Microsoft Office\root\Office16\POWERPNT.EXE"
)
Check-OptionalExecutable "LibreOffice" @("soffice") @(
  "C:\Program Files\LibreOffice\program\soffice.exe",
  "C:\Program Files (x86)\LibreOffice\program\soffice.exe"
)

if ($nodeAvailable) {
  Get-ChildItem -LiteralPath $TargetRoot -Recurse -File -Filter "*.js" |
    Where-Object { $_.FullName -match "\\scripts\\" } |
    ForEach-Object {
      & node --check $_.FullName 2>$null
      if ($LASTEXITCODE -eq 0) { Pass "node --check $($_.FullName)" } else { Fail "node --check failed: $($_.FullName)" }
    }
}

if ($pythonAvailable) {
  Get-ChildItem -LiteralPath $TargetRoot -Recurse -File -Filter "*.py" |
    Where-Object { $_.FullName -match "\\scripts\\" } |
    ForEach-Object {
      $compileCode = "import os, py_compile, sys, tempfile; fd, cfile = tempfile.mkstemp(suffix='.pyc'); os.close(fd); py_compile.compile(sys.argv[1], cfile=cfile, doraise=True); os.remove(cfile)"
      & python -c $compileCode $_.FullName 2>$null
      if ($LASTEXITCODE -eq 0) { Pass "py_compile $($_.FullName)" } else { Fail "py_compile failed: $($_.FullName)" }
    }
}

Write-Host ""
Write-Host "Summary:"
Write-Host "  Failures: $($Failures.Count)"
Write-Host "  Warnings: $($Warnings.Count)"
if ($Failures.Count -gt 0) {
  exit 1
}
exit 0
