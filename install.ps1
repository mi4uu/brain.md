# brain.md installer for Windows.
#
# Usage:
#   powershell -c "irm https://raw.githubusercontent.com/mi4uu/brain.md/main/install.ps1 | iex"
#
# Env knobs:
#   $env:BRAIN_INSTALL   target directory (default: $HOME\.brain.md\bin)
#   $env:BRAIN_VERSION   release tag to install (default: latest)

$ErrorActionPreference = "Stop"

$Repo       = "mi4uu/brain.md"
$BinName    = "brainmd.exe"
$InstallDir = if ($env:BRAIN_INSTALL) { $env:BRAIN_INSTALL } else { Join-Path $HOME ".brain.md\bin" }
$Version    = if ($env:BRAIN_VERSION) { $env:BRAIN_VERSION } else { "latest" }

# ---------- detect arch ----------
switch ($env:PROCESSOR_ARCHITECTURE) {
  "AMD64" { $Arch = "x64" }
  "ARM64" {
    # Today's release matrix only ships an x64 Windows binary.
    # Windows on ARM64 runs x64 binaries via emulation, so this still works.
    $Arch = "x64"
    Write-Warning "Windows ARM64 detected — installing x64 binary (runs via emulation)."
  }
  default { throw "unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
}

$Asset = "brain-md-windows-$Arch.exe"
$Url = if ($Version -eq "latest") {
  "https://github.com/$Repo/releases/latest/download/$Asset"
} else {
  "https://github.com/$Repo/releases/download/$Version/$Asset"
}

# ---------- download ----------
if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir | Out-Null
}
$Target = Join-Path $InstallDir $BinName
$Tmp    = "$Target.tmp"

Write-Host "→ downloading $Asset ($Version)" -ForegroundColor White
Write-Host "  url: $Url"
try {
  Invoke-WebRequest -Uri $Url -OutFile $Tmp -UseBasicParsing
} catch {
  throw "download failed. Check that release '$Version' exists at https://github.com/$Repo/releases"
}

if (Test-Path $Target) { Remove-Item $Target -Force }
Move-Item $Tmp $Target

# ---------- verify ----------
Write-Host "→ verifying" -ForegroundColor White
$versionLine = & $Target --version 2>$null | Select-Object -First 1
if (-not $versionLine) { throw "the binary was downloaded to $Target but failed to run." }

# ---------- summary ----------
Write-Host ""
Write-Host "✔ installed: $versionLine" -ForegroundColor Green
Write-Host "  location: $Target"
Write-Host ""

# ---------- PATH check ----------
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$onPath   = ($UserPath -split ';' | ForEach-Object { $_.TrimEnd('\') }) -contains $InstallDir.TrimEnd('\')
if (-not $onPath) {
  Write-Warning "$InstallDir is not on your PATH."
  Write-Host "  Add it permanently for the current user:" -ForegroundColor Yellow
  Write-Host "    [Environment]::SetEnvironmentVariable('Path', `"$UserPath;$InstallDir`", 'User')" -ForegroundColor Yellow
  Write-Host "  Or for this session only:" -ForegroundColor Yellow
  Write-Host "    `$env:Path += `";$InstallDir`"" -ForegroundColor Yellow
  Write-Host ""
}

Write-Host "Get started:" -ForegroundColor White
Write-Host "  brainmd --help                       # see all flags"
Write-Host "  brainmd                              # serve on :3000"
Write-Host "  brainmd --vault-dir `"$HOME\my-notes`"  # custom vault"
Write-Host ""
Write-Host "Then open: http://localhost:3000" -ForegroundColor Blue
