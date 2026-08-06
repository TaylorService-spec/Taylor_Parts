# C3 P1 — Firestore delete protection ENABLED (production execution record)

**Change:** enable delete protection on `projects/taylor-parts/databases/(default)`.
**Authorization:** Owner, 2026-08-06, explicitly scoped to **P1 only** (Decision A).
**Executed by:** AI agent session under that explicit authorization, using the Owner's already-active `gcloud` session.
**Package:** [`../../deployment/c3-firestore-data-protection-decision-package.md`](../../deployment/c3-firestore-data-protection-decision-package.md) §7 P1.

## Command

```
gcloud firestore databases update --database="(default)" --delete-protection --project=taylor-parts
```

Syntax verified against `gcloud firestore databases update --help` on the installed SDK (577.0.0) before execution. **`--delete-protection` was the only state-changing flag passed.** `--enable-pitr` was available on the same command and was deliberately **not** used.

## Pre-execution gate (all PASS — fail-closed)

| Check | Expected | Actual |
|---|---|---|
| `deleteProtectionState` | `DELETE_PROTECTION_DISABLED` | `DELETE_PROTECTION_DISABLED` |
| `name` | `projects/taylor-parts/databases/(default)` | match |
| `type` | `FIRESTORE_NATIVE` | match |
| `locationId` | `us-central1` | match |

## Result — PASS

```
deleteProtectionState:  DELETE_PROTECTION_DISABLED  ->  DELETE_PROTECTION_ENABLED
```

Operation `projects/taylor-parts/databases/(default)/operations/BhACr-eawBAG09SDiwgMChAa`, `done: true`, exit code 0, `updateTime: 2026-08-06T21:50:03.637128Z`.

## Scope verification — no unintended change

A field-by-field comparison of `pre-describe.txt` and `post-describe.txt`, ignoring only `deleteProtectionState` (the intended change) and the naturally-varying `etag` / `updateTime` / `earliestVersionTime`, found **0 unintended changes**.

Explicitly still unchanged, confirming P2–P4 were **not** executed:

| Property | Value |
|---|---|
| `pointInTimeRecoveryEnablement` | `POINT_IN_TIME_RECOVERY_DISABLED` |
| `versionRetentionPeriod` | `3600s` |
| Backups (`backups list`) | `Listed 0 items.` |
| Backup schedules (`backups schedules list`) | `Listed 0 items.` |

No IAM change, no restore, no data mutation, no Rules or index change.

## What this does and does not achieve

**Does:** removes the catastrophic single-command failure mode — `gcloud firestore databases delete` on `(default)` now fails until protection is explicitly disabled.

**Does not:** create any recovery capability. **RPO and RTO are unchanged.** Recoverable history remains **one hour**, and there is still no restore source. P1 prevents one specific accident; it does not make the database recoverable. That requires P2–P4, which remain unauthorized pending cost evidence.

## Rollback

`gcloud firestore databases update --database="(default)" --no-delete-protection --project=taylor-parts` — reversible at any time. Reversal re-arms the deletion path and should not be done casually.
