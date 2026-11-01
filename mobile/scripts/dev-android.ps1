$ErrorActionPreference = 'Stop'

$sdkPath = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\Android\Sdk' }
$adbPath = Join-Path $sdkPath 'platform-tools\adb.exe'
if (-not (Test-Path $adbPath)) {
  throw "adb not found at $adbPath. Set ANDROID_HOME to the Android SDK path."
}

$env:ANDROID_HOME = $sdkPath
$env:ANDROID_SDK_ROOT = $sdkPath
$platformTools = Join-Path $sdkPath 'platform-tools'
$env:PATH = "$platformTools;$env:PATH"

$deviceList = @(& $adbPath devices)
$offlineDevices = $deviceList | Where-Object { $_ -match '\soffline$' }
foreach ($row in $offlineDevices) {
  $serial = ($row -split '\s+')[0]
  & $adbPath disconnect $serial | Out-Null
}

$deviceRows = @(& $adbPath devices | Select-String '\sdevice$')
if ($deviceRows.Count -eq 0) {
  throw 'No authorized Android device found. Connect a phone and allow USB debugging.'
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
  & npx.cmd expo start --dev-client --android --host lan
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Pop-Location
}
