# EOS netwatch telemetry — durable logger + supervisor (Phase 5)

Keeps EOS network telemetry alive across the logger's ~12h self-exit **without spending any Claude tokens**.
Machine-local; raw telemetry never enters git (see [`../network-telemetry.md`](../network-telemetry.md) §13).

## Files (repo copies = version-controlled source)

- `netwatch.ps1` — the **existing** logger, reused **unchanged** (reference copy; the running copy lives in the
  durable home). Contract: `ts,gw_ms,wan1_ms,wan2_ms,dns,tcp_conns`, 5s interval, ~12h run.
- `netwatch-supervisor.ps1` — a machine-local checker: detects the real logger process (never a duplicate),
  relaunches **only when the logger is not running**, and writes a small sanitized `netwatch-health.json`. It
  is designed to be invoked periodically by the OS scheduler — not by Claude.

## Durable home

`%LOCALAPPDATA%\EOS\netwatch\` holds the running `netwatch.ps1` + `netwatch-supervisor.ps1` +
`netwatch-standalone.csv` (raw, gitignored) + `netwatch.pid` + `netwatch-health.json` (sanitized).

## One-time install — **Owner-run** (registers standing machine configuration)

Registering a Scheduled Task is persistent per-user configuration, so **you** run it once (Claude does not
create standing OS configuration on your behalf). In a normal (non-elevated) PowerShell:

```powershell
$root  = Join-Path $env:LOCALAPPDATA 'EOS\netwatch'
$super = Join-Path $root 'netwatch-supervisor.ps1'
$pwsh  = (Get-Command pwsh).Source
$action  = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$super`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings= New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'EOS-Netwatch-Supervisor' -Action $action -Trigger $trigger -Settings $settings -Force
```

After that, the OS runs the supervisor every 10 minutes: it relaunches `netwatch.ps1` whenever the ~12h logger
has exited, so telemetry never silently disappears — at **zero token cost**. To stop:
`Unregister-ScheduledTask -TaskName 'EOS-Netwatch-Supervisor' -Confirm:$false`.

## Logger health → adapter

The supervisor's `netwatch-health.json` is read by the Network Health Adapter
([`../lib/networkHealthLoader.mjs`](../lib/networkHealthLoader.mjs) `loadLoggerHealth()`), so the Owner Roadmap
can show whether the logger is actively supervised in addition to the derived network state.

## Boundaries

Reuses the logger unchanged · no second network monitor · no duplicate logger processes · raw telemetry stays
machine-local · the supervisor spends no Claude tokens. It does **not** modify the logger, deploy anything, or
cross a production/protected boundary.
