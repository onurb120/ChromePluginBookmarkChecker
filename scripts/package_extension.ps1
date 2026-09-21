# PowerShell Script to Package the Chrome Extension for Chrome Web Store Upload
# Since this is a Vite project, it simply zips the contents of the 'dist' folder.

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$DistDir = Join-Path $ProjectRoot "dist"
$ZipName = "chrome-bookmark-checker.zip"
$ZipPath = Join-Path $DistDir $ZipName
$TempZip = Join-Path $env:TEMP $ZipName

Write-Host "==> Preparing Chrome Extension package..." -ForegroundColor Cyan

# Verify dist exists
if (-not (Test-Path $DistDir)) {
    Write-Error "Missing required folder: dist/. Have you run 'npm run build'?"
}

# Clean up existing zip files
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}
if (Test-Path $TempZip) {
    Remove-Item $TempZip -Force
}

# Clean up legacy bookmark-lens zip files if present
$LegacyZip1 = Join-Path $DistDir "bookmark-lens-production.zip"
$LegacyZip2 = Join-Path $ProjectRoot "bookmark-lens-production.zip"
if (Test-Path $LegacyZip1) { Remove-Item $LegacyZip1 -Force }
if (Test-Path $LegacyZip2) { Remove-Item $LegacyZip2 -Force }

try {
    # Compress dist contents directly via TEMP so manifest.json is at archive root
    Compress-Archive -Path "$DistDir\*" -DestinationPath $TempZip -CompressionLevel Optimal
    Move-Item -Path $TempZip -Destination $ZipPath -Force

    Write-Host "==> Package successfully created at:" -ForegroundColor Green
    Write-Host "    $ZipPath" -ForegroundColor Yellow

    $zipItem = Get-Item $ZipPath
    Write-Host "    Size: $([math]::Round($zipItem.Length / 1KB, 2)) KB" -ForegroundColor Gray
    Write-Host "`nReady for upload to the Chrome Web Store Developer Dashboard!" -ForegroundColor Green
}
catch {
    Write-Error "Failed to compress extension: $_"
}
