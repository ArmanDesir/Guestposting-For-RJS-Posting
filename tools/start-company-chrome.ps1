param(
    [switch]$ForceClose
)

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$userDataDir = "C:\Users\Admin-PC\AppData\Local\Google\Chrome\User Data"
$profileName = "Profile 1"
$debugPort = "9222"

if (-not (Test-Path -LiteralPath $chromePath)) {
    Write-Error "Chrome was not found at $chromePath"
    exit 1
}

$runningChrome = Get-Process chrome -ErrorAction SilentlyContinue
if ($runningChrome -and -not $ForceClose) {
    Write-Host "Chrome is already running."
    Write-Host "Close all Chrome windows first, then run this script again."
    Write-Host "Or run with -ForceClose if you want the script to close Chrome for you."
    exit 1
}

if ($runningChrome -and $ForceClose) {
    $runningChrome | Stop-Process -Force
    Start-Sleep -Seconds 2
}

$chromeArgs = @(
    "--remote-debugging-port=$debugPort",
    "--profile-directory=`"$profileName`"",
    "--user-data-dir=`"$userDataDir`""
) -join " "

Start-Process -FilePath $chromePath -ArgumentList $chromeArgs

Write-Host "Opened company Chrome profile with remote debugging on port $debugPort."
Write-Host "Now use the UI Medium draft button again."
