# Install the Visual Studio 2022 C++ workload (MSVC compiler + Windows SDK), unattended.
#
# Root cause we hit on this machine:
#   - The VS 2022 instance is a "minimal" install. Its product graph does NOT contain
#     `Microsoft.VisualStudio.Workload.VCTools` (a 2017/2019-era workload ID), so `modify --add`
#     silently warns "Cannot find package ... in product graph" and exits 0 without installing.
#   - The VS Installer also had to self-update once (4.3.2029 -> 4.11.24) before anything worked.
#
# The correct workload ID for VS 2022 C++ desktop development is:
#   Microsoft.VisualStudio.Workload.NativeDesktop     ("Desktop development with C++")
# plus explicit components so no ambiguity:
#   Microsoft.VisualStudio.Component.VC.Tools.x86.x64 (MSVC compiler + link.exe)
#   Microsoft.VisualStudio.Component.Windows11SDK.26100 (Windows SDK)
#
# Prerequisite: `setup.exe --passive` refuses to run unelevated (exit 5007). This script launches it
# elevated (accept the UAC prompt). Idempotent: exits immediately when MSVC is present.
#
# Usage (normal PowerShell is fine):
#   powershell -ExecutionPolicy Bypass -File docs\install-msvc-workload.ps1
# Options:
#   -TimeoutMinutes 90   how long to wait for the download+install

param(
    [int]$TimeoutMinutes = 90
)

$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$vsInstaller = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
$vsPath      = "C:\Program Files\Microsoft Visual Studio\2022\Community"
$msvcDir     = "$vsPath\VC\Tools\MSVC"
$sdkLibDir   = "${env:ProgramFiles(x86)}\Windows Kits\10\Lib"

function Report-Result {
    $msvc = Get-ChildItem $msvcDir -ErrorAction SilentlyContinue | Select-Object -First 1
    $sdk  = Get-ChildItem $sdkLibDir -ErrorAction SilentlyContinue | Select-Object -First 1
    Write-Host ""
    Write-Host "===== Result =====" -ForegroundColor Cyan
    Write-Host ("MSVC:        " + $(if ($msvc) { $msvc.Name } else { "MISSING" }))
    Write-Host ("Windows SDK: " + $(if ($sdk) { $sdk.Name } else { "MISSING" }))
    if ($msvc -and $sdk) {
        Write-Host ""
        Write-Host "Next: open a NEW terminal, then:  cd app; npm run tauri dev" -ForegroundColor Green
        return $true
    }
    return $false
}

if (Test-Path $msvcDir) {
    Write-Host "MSVC already installed." -ForegroundColor Green
    Report-Result | Out-Null
    exit 0
}

if (-not (Test-Path "$vsInstaller\setup.exe")) { throw "VS Installer not found: $vsInstaller\setup.exe" }

$responsePath = Join-Path $env:TEMP "vs-modify-vc-desktop.json"
$response = @{
    installPath = $vsPath
    add = @(
        "Microsoft.VisualStudio.Workload.NativeDesktop",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "Microsoft.VisualStudio.Component.Windows11SDK.26100"
    )
    includeRecommended = $true
} | ConvertTo-Json
[IO.File]::WriteAllText($responsePath, $response, (New-Object Text.UTF8Encoding($false)))

Write-Host "Launching elevated VS Installer (accept UAC). Download ~2-4 GB, can take 10-30 min." -ForegroundColor Cyan
Write-Host "Response file: $responsePath"
$p = Start-Process -FilePath "$vsInstaller\setup.exe" `
    -ArgumentList @('modify', '--in', "`"$responsePath`"", '--passive', '--norestart') `
    -PassThru -Verb RunAs

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$lastReport = Get-Date
while ((Get-Date) -lt $deadline) {
    if (Test-Path $msvcDir) {
        Write-Host "MSVC appeared: $((Get-ChildItem $msvcDir | Select-Object -First 1).Name)" -ForegroundColor Green
        break
    }
    Start-Sleep -Seconds 10
    if (((Get-Date) - $lastReport).TotalMinutes -ge 1) {
        $lastReport = Get-Date
        $alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
        Write-Host ("  [{0:HH:mm:ss}] {1}, MSVC still missing" -f (Get-Date), $(if ($alive) { "installer running" } else { "installer exited" }))
        if (-not $alive) { break }
    }
}

if (-not (Report-Result)) {
    Write-Host ""
    Write-Host "Did not finish automatically. Check the latest log:" -ForegroundColor Yellow
    Write-Host "  Get-ChildItem `$env:TEMP -Filter 'dd_installer*.log' | Sort LastWriteTime -Desc | Select -First 1"
    Write-Host "Then either re-run this script, or do it by hand:" -ForegroundColor Yellow
    Write-Host "  Visual Studio Installer -> Modify -> check 'Desktop development with C++' -> Modify"
    exit 1
}
