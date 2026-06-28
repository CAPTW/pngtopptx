param(
  [string]$SourceSkillsRoot = "",
  [string]$PackageRoot = "",
  [string]$ZipPath = "",
  [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SkillNames = @(
  "slide-text-layer-inpaint",
  "slide-image-dual-render",
  "slide-visual-polish-qa",
  "slide-editable-deck-orchestrator"
)

$Version = "0.1.0"
if (-not $SourceSkillsRoot) { $SourceSkillsRoot = Join-Path $env:USERPROFILE ".pngtopptx\skills" }
if (-not $PackageRoot) { $PackageRoot = $PSScriptRoot }
$SourceSkillsRoot = (Resolve-Path -LiteralPath $SourceSkillsRoot).Path
$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
if (-not $ZipPath) { $ZipPath = Join-Path (Split-Path -Parent $PackageRoot) "pngtopptx-toolkit-v$Version.zip" }
else { $ZipPath = [System.IO.Path]::GetFullPath($ZipPath) }

$ExcludedDirNames = @("node_modules", ".git", "__pycache__", "out", "work", "src")
$ExcludedExtensions = @(".pyc", ".ttf", ".otf", ".woff", ".woff2", ".eot")

function Write-Step($Message) {
  Write-Host "[package] $Message"
}

function Should-SkipFile($FileInfo) {
  return $ExcludedExtensions -contains $FileInfo.Extension.ToLowerInvariant()
}

function Should-SkipManifestFile($Root, $FileInfo) {
  if (Should-SkipFile $FileInfo) {
    return $true
  }
  $relative = Get-RelativePath -BasePath $Root -Path $FileInfo.FullName
  $parts = $relative -split "\\"
  foreach ($part in $parts) {
    if ($ExcludedDirNames -contains $part) {
      return $true
    }
  }
  return $false
}

function Copy-FilteredDirectory($Source, $Destination) {
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing source directory: $Source"
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($_.PSIsContainer) {
      if ($ExcludedDirNames -contains $_.Name) {
        return
      }
      Copy-FilteredDirectory -Source $_.FullName -Destination (Join-Path $Destination $_.Name)
    } else {
      if (Should-SkipFile $_) {
        return
      }
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name)
    }
  }
}

function Get-RelativePath($BasePath, $Path) {
  $baseUri = [Uri]((Resolve-Path -LiteralPath $BasePath).Path.TrimEnd('\') + '\')
  $pathUri = [Uri]((Resolve-Path -LiteralPath $Path).Path)
  return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace('/', '\')
}

function New-Manifest($Root) {
  $files = Get-ChildItem -LiteralPath $Root -Recurse -File |
    Where-Object {
      $_.Name -ne "MANIFEST.json" -and
      $_.FullName -ne (Resolve-Path -LiteralPath $ZipPath -ErrorAction SilentlyContinue) -and
      -not (Should-SkipManifestFile -Root $Root -FileInfo $_)
    } |
    Sort-Object FullName |
    ForEach-Object {
      $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName
      [ordered]@{
        path = Get-RelativePath -BasePath $Root -Path $_.FullName
        sha256 = $hash.Hash.ToLowerInvariant()
        bytes = $_.Length
      }
    }

  [ordered]@{
    name = "pngtopptx-toolkit"
    version = $Version
    description = "Local slide reconstruction toolkit for converting slide images into editable PPTX/HTML with text-layer preprocessing, validation, visual QA, and orchestration."
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    skills = @(
      [ordered]@{ name = "slide-text-layer-inpaint"; path = "skills/slide-text-layer-inpaint"; role = "text layer separation, pseudo text handling, masks, inpainting, residual cleanup" }
      [ordered]@{ name = "slide-image-dual-render"; path = "skills/slide-image-dual-render"; role = "editable PPTX/HTML rendering, hardlock, reconstruction, PPTX openability" }
      [ordered]@{ name = "slide-visual-polish-qa"; path = "skills/slide-visual-polish-qa"; role = "visual QA, screenshot/raster comparison, fix plans" }
      [ordered]@{ name = "slide-editable-deck-orchestrator"; path = "skills/slide-editable-deck-orchestrator"; role = "meta orchestration, repair waves, blocking-zero delivery" }
    )
    supportedPlatforms = @("Windows")
    testedPaths = [ordered]@{
      defaultUserSkills = "%USERPROFILE%\.pngtopptx\skills"
    }
    doesNotBundle = @(
      "font files",
      "node_modules",
      "private input decks",
      "ad hoc generated outputs outside curated public examples"
    )
    fileChecksums = $files
  }
}

Write-Step "Source Skills root: $SourceSkillsRoot"
Write-Step "Package root: $PackageRoot"

if ($Clean) {
  Write-Step "Cleaning package skill payload folders"
  foreach ($name in $SkillNames) {
    $target = Join-Path $PackageRoot "skills\$name"
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  }
}

New-Item -ItemType Directory -Path (Join-Path $PackageRoot "skills") -Force | Out-Null

foreach ($name in $SkillNames) {
  $source = Join-Path $SourceSkillsRoot $name
  $dest = Join-Path $PackageRoot "skills\$name"
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  Copy-FilteredDirectory -Source $source -Destination $dest
  Write-Step "Copied $name"
}

$manifest = New-Manifest -Root $PackageRoot
$manifestPath = Join-Path $PackageRoot "MANIFEST.json"
$manifestJson = $manifest | ConvertTo-Json -Depth 8
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $manifestJson + [Environment]::NewLine, $utf8NoBom)
Write-Step "Wrote MANIFEST.json"

if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
Compress-Archive -Path (Join-Path $PackageRoot "*") -DestinationPath $ZipPath -Force
$zipItem = Get-Item -LiteralPath $ZipPath
Write-Step "Created zip: $ZipPath"
Write-Step ("Zip size: {0:N0} bytes" -f $zipItem.Length)
