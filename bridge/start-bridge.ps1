# Start the Squeezebox PWA bridge in production
#
# Usage:
#   .\bridge\start-bridge.ps1
#
# Reads environment from bridge\.env if present.

$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
    Write-Host "Loaded environment from $envFile"
}

$bridgePort = $env:BRIDGE_PORT
if ([string]::IsNullOrWhiteSpace($bridgePort)) {
    $bridgePort = '5174'
}

Write-Host "Starting bridge on port $bridgePort..."
$serverJs = Join-Path $PSScriptRoot "server.js"
$serverTs = Join-Path $PSScriptRoot "server.ts"

if (Test-Path $serverJs) {
    node $serverJs
}
elseif (Test-Path $serverTs) {
    node --experimental-strip-types $serverTs
}
else {
    Write-Error "Could not find bridge entrypoint. Expected server.js or server.ts in $PSScriptRoot"
    exit 1
}
