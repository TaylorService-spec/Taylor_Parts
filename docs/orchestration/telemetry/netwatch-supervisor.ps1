# EOS netwatch supervisor (Phase 5) -- machine-local, token-free.
#
# The netwatch logger (netwatch.ps1) self-exits after ~12h. This supervisor keeps
# EOS network telemetry alive across that window WITHOUT any Claude/token cost: it is
# intended to be run periodically by a per-user Windows Scheduled Task (see
# install-netwatch-supervisor.ps1). It NEVER modifies the logger, NEVER starts a
# second monitor, and NEVER launches a duplicate logger -- it detects an existing
# logger process first and (re)launches ONLY when the logger is not running.
#
# Raw telemetry stays machine-local. The only thing written here besides a relaunch
# is a small sanitized health file the Network Health Adapter can read.
$ErrorActionPreference = 'SilentlyContinue'

$root      = Join-Path $env:LOCALAPPDATA 'EOS\netwatch'   # durable machine-local home (not $HOME -- reserved)
$logger    = Join-Path $root 'netwatch.ps1'
$csv       = Join-Path $root 'netwatch-standalone.csv'
$pidFile   = Join-Path $root 'netwatch.pid'
$healthFile= Join-Path $root 'netwatch-health.json'
$staleSec  = 60

# Detect the REAL logger process (launched with -File ...netwatch.ps1), never this
# supervisor or an inspection command.
function Get-LoggerProc {
  Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match '-File' -and $_.CommandLine -match 'netwatch\.ps1' -and $_.CommandLine -notmatch 'supervisor' }
}

# Telemetry freshness from the last CSV row (first field is 'yyyy-MM-dd HH:mm:ss').
function Get-SampleAgeSec {
  if (-not (Test-Path $csv)) { return $null }
  $last = Get-Content $csv -Tail 1
  if (-not $last -or $last -like 'ts,*') { return $null }
  $ts = ($last -split ',')[0]
  try { return [int]((Get-Date) - [datetime]$ts).TotalSeconds } catch { return $null }
}

$proc      = Get-LoggerProc
$running   = [bool]$proc
$ageSec    = Get-SampleAgeSec
$relaunched= $false

# Relaunch ONLY when the logger is not running. (A running-but-stale logger is left
# alone and flagged in health, to avoid killing a healthy logger on a transient.)
if (-not $running -and (Test-Path $logger)) {
  $p = Start-Process pwsh -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$logger
  if ($p) { $p.Id | Out-File $pidFile -Encoding ascii -NoNewline; $relaunched = $true }
  Start-Sleep -Seconds 2
  $proc = Get-LoggerProc
}

$loggerPid = ($proc | Select-Object -First 1 -ExpandProperty ProcessId)
$health = [ordered]@{
  loggerRunning     = [bool]$proc
  loggerPid         = $loggerPid
  lastSampleAgeSec  = $ageSec
  telemetryStale    = ($null -eq $ageSec) -or ($ageSec -gt $staleSec)
  relaunchedThisRun = $relaunched
  checkedAt         = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  home              = $root
}
($health | ConvertTo-Json -Compress) | Out-File $healthFile -Encoding utf8

Write-Output ("supervisor: running={0} pid={1} ageSec={2} relaunched={3}" -f $health.loggerRunning, $loggerPid, $ageSec, $relaunched)
