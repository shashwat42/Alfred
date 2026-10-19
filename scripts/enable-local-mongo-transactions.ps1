# Run from an elevated PowerShell. Converts the existing local service in place;
# does not drop, move or recreate any database. Keeps MongoDB bound to loopback.
$ErrorActionPreference = 'Stop'
$mongoConfig = 'C:\Program Files\MongoDB\Server\9.0\bin\mongod.cfg'
$mongoShell = Join-Path $env:LOCALAPPDATA 'Programs\mongosh\mongosh.exe'
$logDirectory = Join-Path $PSScriptRoot '..\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$repairLog = Join-Path $logDirectory 'mongo-repair-result.txt'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator rights are required to edit the MongoDB service configuration.' }
    $original = Get-Content -Raw -LiteralPath $mongoConfig
    if ($original -notmatch '(?m)^\s*bindIp:\s*127\.0\.0\.1\s*$') { throw 'Expected a loopback-only local MongoDB. Inspect configuration manually.' }
    if ($original -notmatch '(?m)^replication:') {
        $backup = "$mongoConfig.alfred-before-replication.bak"
        if (Test-Path -LiteralPath $backup) { throw 'A prior configuration backup exists. Inspect it before retrying.' }
        Copy-Item -LiteralPath $mongoConfig -Destination $backup
        Set-Content -LiteralPath $mongoConfig -Value ($original + "`r`nreplication:`r`n  replSetName: alfred-local`r`n")
        try { Restart-Service -Name MongoDB } catch {
            Copy-Item -LiteralPath $backup -Destination $mongoConfig -Force
            Start-Service -Name MongoDB
            throw
        }
    } elseif ($original -notmatch 'replSetName:\s*alfred-local') { throw 'Another replica set is configured. No change made.' }
    # A file avoids PowerShell's native-command quote rewriting of JavaScript.
    $initializationScript = Join-Path $env:TEMP 'alfred-local-replica-init.js'
    'try { rs.status() } catch(e) { if(e.code === 94) { rs.initiate({_id:"alfred-local",members:[{_id:0,host:"localhost:27017"}]}) } else { throw e } }' | Set-Content -LiteralPath $initializationScript
    & $mongoShell 'mongodb://127.0.0.1:27017/?directConnection=true' --quiet --file $initializationScript
    if ($LASTEXITCODE -ne 0) { throw 'Replica set initialization failed; inspect MongoDB logs. Existing data was retained.' }
    'Replica set configured. Wait for PRIMARY election, then restart Alfred backend.' | Set-Content -LiteralPath $repairLog
} catch { $_.Exception.Message | Set-Content -LiteralPath $repairLog; exit 1 }
