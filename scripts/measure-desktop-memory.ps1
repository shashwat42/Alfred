param([string]$OutputPath, [string]$AppIdentifier = 'com.alfred.app')
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance Win32_Process)
$browsers = @($processes | Where-Object {
    $_.Name -eq 'msedgewebview2.exe' -and
    $_.CommandLine -match '--webview-exe-name=app\.exe' -and
    $_.CommandLine -match [regex]::Escape($AppIdentifier)
})
$roots = @($browsers | Where-Object { $_.CommandLine -notmatch '--type=' })
$ids = @($roots.ParentProcessId) + @($browsers.ProcessId)
$rows = @($processes | Where-Object { $_.ProcessId -in $ids } | ForEach-Object {
    $processInfo = $_
    $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    if ($process) {
        $kind = if ($_.Name -ne 'msedgewebview2.exe') { 'native' }
            elseif ($_.CommandLine -match '--type=([^ ]+)') { $Matches[1] }
            else { 'browser' }
        [pscustomobject]@{
            Id = $processInfo.ProcessId
            Kind = $kind
            WorkingSetMiB = [math]::Round($process.WorkingSet64 / 1MB, 2)
            PrivateMiB = [math]::Round($process.PrivateMemorySize64 / 1MB, 2)
            CpuSeconds = [math]::Round($process.TotalProcessorTime.TotalSeconds, 2)
        }
    }
})
$result = [pscustomobject]@{
    TimestampUtc = [DateTime]::UtcNow.ToString('o')
    Processes = $rows
    RendererCount = @($rows | Where-Object Kind -eq 'renderer').Count
    TotalWorkingSetMiB = [math]::Round(($rows | Measure-Object WorkingSetMiB -Sum).Sum, 2)
    TotalPrivateMiB = [math]::Round(($rows | Measure-Object PrivateMiB -Sum).Sum, 2)
}
$json = $result | ConvertTo-Json -Depth 4
if ($OutputPath) { $json | Set-Content -LiteralPath $OutputPath }
$json
