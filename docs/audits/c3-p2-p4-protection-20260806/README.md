# C3 P2–P4 — PITR + backup schedules ENABLED (production execution record)

**Change:** enable Point-in-Time Recovery and create the daily and weekly backup schedules on `projects/taylor-parts/databases/(default)` (`us-central1`, `FIRESTORE_NATIVE`, `STANDARD`).
**Authorization:** Owner, 2026-08-06, scoped to **P2, P3, P4**, on the basis of the measured cost evidence in `docs/audits/c3-p2-p4-sizing-20260806/` (DECISIONS #80).
**Executed by:** AI agent session under that authorization, using the Owner's already-active `gcloud` session.
**Package:** [`../../deployment/c3-firestore-data-protection-decision-package.md`](../../deployment/c3-firestore-data-protection-decision-package.md) §7.

---

## Pre-execution gate — all PASS (fail-closed)

| Check | Expected | Actual |
|---|---|---|
| Database name | `projects/taylor-parts/databases/(default)` | match |
| `locationId` | `us-central1` | match |
| `type` | `FIRESTORE_NATIVE` | match |
| `databaseEdition` | `STANDARD` | match |
| Delete protection **retained** | `DELETE_PROTECTION_ENABLED` | match |
| PITR currently off | `POINT_IN_TIME_RECOVERY_DISABLED` | match |
| No pre-existing schedules | `Listed 0 items.` | match |

## Retention semantics — verified representable, not approximated

Before creating anything, the requested policy was checked against the provider's actual capability. `gcloud firestore backups schedules create` accepts `--retention` with week units, and **both daily and weekly schedules support up to 14 weeks** — so *daily / 4 weeks* and *weekly / 14 weeks* are expressible **exactly**. No substitution, approximation, or alternative policy was required, and none was made.

## Commands executed

```bash
# P2
gcloud firestore databases update --database="(default)" --enable-pitr --project=taylor-parts

# P3
gcloud firestore backups schedules create --database="(default)" \
    --retention=4w --recurrence=daily --project=taylor-parts

# P4
gcloud firestore backups schedules create --database="(default)" \
    --retention=14w --recurrence=weekly --day-of-week=SUN --project=taylor-parts
```

All three exit code 0. `--enable-pitr` was the only state-changing flag on P2; `--delete-protection` was available on the same command and was **not** passed (it was already enabled and needed no change).

## Results

**P2** — operation `…/operations/BhAqjtAQBtPUjuIICgoOGg`, `done: true`

```
pointInTimeRecoveryEnablement:  POINT_IN_TIME_RECOVERY_DISABLED -> POINT_IN_TIME_RECOVERY_ENABLED
versionRetentionPeriod:         3600s -> 604800s          (1 hour -> 7 days)
earliestVersionTime:            2026-08-06T21:15:00Z
```

**P3 — daily** · `backupSchedules/14e34b99-bcd4-4313-8aa1-06acf81b4f36` · `dailyRecurrence: {}` · `retention: 2419200s` = **28 days = 4 weeks** ✅ as approved

**P4 — weekly** · `backupSchedules/b3963171-0577-4129-b823-83fad1ec7e44` · `weeklyRecurrence: day: SUNDAY` · `retention: 8467200s` = **98 days = 14 weeks** ✅ as approved

## Post-proof

| Proof | Result |
|---|---|
| PITR enabled | ✅ `POINT_IN_TIME_RECOVERY_ENABLED` |
| Delete protection **retained** | ✅ `DELETE_PROTECTION_ENABLED` |
| Recovery window | ✅ `604800s` (7 days) |
| Daily schedule exists, correct retention | ✅ 2,419,200s = 4 weeks |
| Weekly schedule exists, correct retention | ✅ 8,467,200s = 14 weeks |

## Scope verification — no unintended change

Complete `describe` diff, pre vs post:

| Field | Change | Classification |
|---|---|---|
| `pointInTimeRecoveryEnablement` | DISABLED → ENABLED | **intended (P2)** |
| `versionRetentionPeriod` | 3600s → 604800s | **intended consequence of P2** |
| `backupConfig.backupSchedulesEnabled` | *(absent)* → `true` | **intended consequence of P3/P4** — a derived field that appears once schedules exist |
| `earliestVersionTime`, `etag`, `updateTime` | varied | naturally varying |

**Nothing else changed. 0 unintended configuration changes.**

Confirmed unchanged: `deleteProtectionState`, `locationId`, `type`, `databaseEdition`, `concurrencyMode`, `appEngineIntegrationMode`, `uid`, `createTime`.

**Not performed:** no restore, no destructive recovery testing, no data modification, no Rules change, no index change, no IAM change, no Functions change, no Hosting/Pages change, no database creation or deletion, no application cutover, no Auth change.

## Resulting recovery posture

| | Before P1–P4 | After P1–P4 |
|---|---|---|
| Accidental DB deletion | possible | **blocked** (P1) |
| RPO — within 7 days | 1 hour | **≤ 1 minute** (PITR, minute granularity) |
| RPO — within 4 weeks | none | **≤ 24 hours** (daily backups) |
| RPO — within 14 weeks | none | **≤ 7 days** (weekly backups) |
| Restore source | **none** | PITR window + scheduled backups |
| RTO | undefined | **target ≤ 4 hours — NOT YET PROVEN** |

## What is still NOT true

**Backups exist ≠ recovery proven.**

1. **No backup has been produced yet.** `backups list` returns `Listed 0 items.` — correct, the first daily backup is not yet due. The schedules are configured, not yet exercised. Verification **V2** (first backup exists) is outstanding.
2. **No restore has ever been performed.** RTO remains a *target*, not a measurement. Verification **V3/V4** (restore and PITR rehearsal) are outstanding, and **P5 is a separate Owner-authorized action**.
3. **PITR's 7-day window is not yet full.** `earliestVersionTime` advances from enablement; genuine 7-day coverage exists from 2026-08-13.
4. **Firebase Auth remains uncovered** by any of this — an open, separate gap.

The database is now protected and **recoverable in principle**. It will be *proven* recoverable only after P5.
