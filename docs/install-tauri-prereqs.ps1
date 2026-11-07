# Install Tauri 2 build prerequisites on Windows. Run in an ADMIN PowerShell.
# Usage:
#   powershell -ExecutionPolicy Bypass -File docs\install-tauri-prereqs.ps1
#
# NOTE: this file is pure ASCII on purpose -- Windows PowerShell 5.1 reads BOM-less scripts as ANSI and mangles non-ASCII text.
# Rust is not installed, WebView2 runtime is present.

$ErrorActionPreference = "Stop"

$vsInstaller = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
$vsPath = "C:\Program Files\Microsoft Visual Studio\2022\Community"

# ---------- 1) Visual Studio C++ workload (MSVC + Windows SDK) ----------
$hasMsvc = Test-Path "$vsPath\VC\Tools\MSVC"
if (-not $hasMsvc) {
    if (-not (Test-Path "$vsInstaller\setup.exe")) {
        throw "VS Installer not found at $vsInstaller\setup.exe. Install VS 2022 Community first: https://visualstudio.microsoft.com/vs/community/"
    }
    Write-Host "Installing MSVC workload (2-4 GB, may take 10-30 min)..." -ForegroundColor Cyan
    & "$vsInstaller\setup.exe" modify --installPath $vsPath --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart
    $code = $LASTEXITCODE
    if ($code -ne 0 -and $code -ne 3010) {
        Write-Host "VS installer returned $code (3010 = reboot needed, normal). Re-run this script after it finishes to verify." -ForegroundColor Yellow
    }
} else {
    Write-Host "MSVC already present, skipping." -ForegroundColor Green
}

# ---------- 2) Rust (rustup, MSVC toolchain) ----------
if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Rust (rustup-init -y)..." -ForegroundColor Cyan
    $rustup = Join-Path $env:TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustup -UseBasicParsing
    & $rustup -y --default-toolchain stable --profile default
    if ($LASTEXITCODE -ne 0) { throw "rustup install failed with exit code $LASTEXITCODE" }
    $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
} else {
    Write-Host ("Rust already present: " + (rustc --version)) -ForegroundColor Green
}

# ---------- 3) WebView2 runtime ----------
$wv2 = $null
$keys = @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients")
foreach ($root in $keys) {
    if (Test-Path $root) {
        $wv2 = Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.name -like "*WebView2*" } | Select-Object -First 1
    }
    if ($wv2) { break }
}
if ($wv2) {
    Write-Host ("WebView2 installed: " + $wv2.pv) -ForegroundColor Green
} else {
    Write-Host "WebView2 not found. On Win10 install the Evergreen runtime: https://go.microsoft.com/fwlink/p/?LinkId=2124703" -ForegroundColor Yellow
}

# ---------- Self check ----------
Write-Host ""
Write-Host "===== Environment check =====" -ForegroundColor Cyan
$msvcDir = Get-ChildItem "$vsPath\VC\Tools\MSVC" -ErrorAction SilentlyContinue | Select-Object -First 1
$sdkDir = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\Lib" -ErrorAction SilentlyContinue | Select-Object -First 1
$rustCmd = Get-Command rustc -ErrorAction SilentlyContinue
$msvcText = if ($msvcDir) { $msvcDir.Name } else { "MISSING" }
$sdkText = if ($sdkDir) { $sdkDir.Name } else { "MISSING" }
$rustText = if ($rustCmd) { & rustc --version } else { "MISSING (open a new terminal, PATH takes effect there)" }
Write-Host ("MSVC:        " + $msvcText)
Write-Host ("Windows SDK: " + $sdkText)
Write-Host ("rustc:       " + $rustText)
Write-Host ""
Write-Host "When everything is ready, run:" -ForegroundColor Cyan
Write-Host "  cd C:\Users\Yunnai\Documents\deepseek-harness\history-timeline-workspace\app"
Write-Host "  npm run tauri dev"
