# EOS Work Continuity Watchdog

This tool gives `EOS-RUNTIME-RUDY-PC` a durable, local 20-minute silence
watchdog without occupying the GitHub Actions runner between checks. It does
not start Claude or approve work. It records submissions, accepts explicit EOS
status updates, and writes an alert when work needs review/input, fails, or has
no status by its deadline.

## State model

- `waiting` — EOS owns the work and the deadline is active.
- `needs_review` — results are ready for review.
- `needs_input` — EOS asked a question or needs an owner decision.
- `completed` — work completed and no immediate review is required.
- `failed` — EOS reported an error or blocker.
- `timed_out` — the monitor found no EOS status before the deadline.

Every status other than `waiting` ends that submission's silence timer. Start a
new record for the next submission; timed-out records cannot be silently reused.

## Commands

Run these from the repository root in Windows PowerShell.

Register work immediately after handing it to EOS:

```powershell
$item = .\tools\eos-watchdog\EosWatchdog.ps1 -Action Register `
  -Title 'Implement approved inventory task' `
  -Reference 'https://github.com/TaylorService-spec/Taylor_Parts/issues/123'
$item
```

EOS records its first actionable result using the returned `id`:

```powershell
.\tools\eos-watchdog\EosWatchdog.ps1 -Action Update `
  -Id '<submission-id>' -Status needs_review `
  -Message 'Draft PR is ready for review.'
```

Other valid EOS updates are `needs_input`, `completed`, and `failed`.

Inspect outstanding or historical work:

```powershell
.\tools\eos-watchdog\EosWatchdog.ps1 -Action List
.\tools\eos-watchdog\EosWatchdog.ps1 -Action List -IncludeTerminal
.\tools\eos-watchdog\EosWatchdog.ps1 -Action Get -Id '<submission-id>'
```

By default, state is stored at
`C:\ProgramData\TaylorParts\EosWatchdog\state.json`; alert JSON files are
written under its `alerts` directory. For this default production location,
`Notify-EosWatchdog.ps1` also sends a Windows toast to the EOS user. Use
`-StatePath` and `-AlertDirectory` for a different location.

## Install the recurring check

From a PowerShell session running as the same Windows user that operates EOS:

```powershell
.\tools\eos-watchdog\Install-EosWatchdogTask.ps1
```

The task runs a short check once per minute and exits. It does not reserve the
GitHub runner. The default least-privilege registration runs while the EOS user
is signed in. For a truly unattended timer, open PowerShell as Administrator
and add `-RunWhetherLoggedOff`; Windows requires elevated task-registration
rights for that logon mode.

```powershell
.\tools\eos-watchdog\Install-EosWatchdogTask.ps1 -RunWhetherLoggedOff
```

Preview registration without changing Task Scheduler:

```powershell
.\tools\eos-watchdog\Install-EosWatchdogTask.ps1 -WhatIf
```

To forward alerts elsewhere, provide a PowerShell notification script to both
the installer and manual checks. The watchdog invokes it as:

```powershell
& <notification-script> -AlertPath <absolute-alert-json-path>
```

Keep credentials out of the repository. The notification script may use the
runner user's existing authenticated tooling, but it should be independently
tested and should never modify watchdog state.

## Operations and recovery

- Run `Test-EosWatchdog.ps1` before installation or after changes.
- The named mutex prevents overlapping checks from corrupting state.
- State writes use a temporary file followed by an atomic same-volume move.
- Re-running `Check` does not alert twice for an already-terminal record.
- If Task Scheduler was offline at the deadline, `StartWhenAvailable` runs the
  check when the host returns; that is detection-after-recovery, not a strict
  guarantee of a notification at exactly 20 minutes.
- Remove the scheduled task with:

```powershell
Unregister-ScheduledTask -TaskName 'Taylor Parts EOS Work Continuity Watchdog' -Confirm
```
