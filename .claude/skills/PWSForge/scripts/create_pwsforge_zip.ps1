$ErrorActionPreference = 'Stop'

$Source = 'C:\Users\lg\AppData\Local\hermes\skills\software-development\pwsforge'
$Desktop = 'C:\Users\lg\Desktop'
$Zip = Join-Path $Desktop 'PWSForge.zip'
$StageRoot = Join-Path $env:TEMP 'PWSForge_zip_stage'
$Stage = Join-Path $StageRoot 'PWSForge'

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
  throw "Source skill directory not found: $Source"
}
if (-not (Test-Path -LiteralPath (Join-Path $Source 'SKILL.md') -PathType Leaf)) {
  throw "Required source file missing: $(Join-Path $Source 'SKILL.md')"
}
if (-not (Test-Path -LiteralPath (Join-Path $Source 'references\pwsforge-design.md') -PathType Leaf)) {
  throw "Required source file missing: $(Join-Path $Source 'references\pwsforge-design.md')"
}
if (-not (Test-Path -LiteralPath $Desktop -PathType Container)) {
  New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
}

if (Test-Path -LiteralPath $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

# Copy source contents into portable root PWSForge/.
Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $Stage -Recurse -Force
}

$stagedFiles = @(Get-ChildItem -LiteralPath $Stage -Recurse -File -Force)
if ($stagedFiles.Count -eq 0) {
  throw "Staging failed: no files copied into $Stage"
}

if (Test-Path -LiteralPath $Zip) {
  Remove-Item -LiteralPath $Zip -Force
}

# Load both assemblies. Some Windows PowerShell versions need System.IO.Compression
# explicitly before ZipArchiveMode/CompressionLevel types exist.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Zip the STAGE ROOT, not the skill dir. This produces entries like:
# PWSForge/SKILL.md and PWSForge/references/pwsforge-design.md
[System.IO.Compression.ZipFile]::CreateFromDirectory($StageRoot, $Zip)

if (-not (Test-Path -LiteralPath $Zip -PathType Leaf)) {
  throw "ZIP creation failed: $Zip was not created"
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($Zip)
try {
  $names = @($archive.Entries | ForEach-Object { ($_.FullName -replace '\\','/').TrimStart('/') })
  $required = @('PWSForge/SKILL.md', 'PWSForge/references/pwsforge-design.md')
  $missing = @($required | Where-Object { $names -notcontains $_ })
  if ($missing.Count -gt 0) {
    Write-Host 'Archive entries:'
    $names | Sort-Object | Select-Object -First 120 | ForEach-Object { Write-Host "  $_" }
    throw "ZIP verification failed. Missing: $($missing -join ', ')"
  }
  $size = (Get-Item -LiteralPath $Zip).Length
  Write-Host "Created: $Zip"
  Write-Host "Size bytes: $size"
  Write-Host "File count: $($archive.Entries.Count)"
  Write-Host 'Verified required files.'
}
finally {
  $archive.Dispose()
  if (Test-Path -LiteralPath $StageRoot) {
    Remove-Item -LiteralPath $StageRoot -Recurse -Force
  }
}
