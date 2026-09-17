$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    $petopsResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:3310/api/state' -UseBasicParsing -TimeoutSec 2
    if ($petopsResponse.StatusCode -eq 200) {
        Start-Process 'http://127.0.0.1:3310'
        exit
    }
} catch {}
$petopsPython = (Get-Command python -ErrorAction Stop).Source
Start-Process -FilePath $petopsPython -ArgumentList 'server.py' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server-error.log')
Start-Sleep -Seconds 2
Start-Process 'http://127.0.0.1:3310'
