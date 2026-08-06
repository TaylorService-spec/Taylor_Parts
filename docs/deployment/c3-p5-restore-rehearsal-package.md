---
artifact_type: deployment
gate: C3 P5 — restore rehearsal · PROTECTED ACTION PACKAGE
status: P5-A EXECUTED AND PASSED 2026-08-06 (RTO-CLONE 9.31 min). P5-B still required after V2.
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: ab55c50
depends_on: docs/deployment/c3-firestore-data-protection-decision-package.md (P1-P4 executed)
scope: Design only. No restore, clone, database creation, or deletion performed.
---

# C3 P5 — Restore Rehearsal: Protected Action Package

**Backups exist ≠ recovery proven.** P1–P4 gave the platform a *configured* recovery capability. P5 is what makes it a *demonstrated* one, and converts the RTO target (≤4h) into a measurement.

**Nothing in this package has been executed.** It requires Owner authorization, including one authorization P1–P4 explicitly withheld: **database creation and deletion**.

---

## 1. The constraint that shapes the design

A Firestore restore **always creates a new database** and can never write into an existing one. That is normally the awkward part of recovery — here it is the safety property that makes rehearsal safe: **it is structurally impossible for a rehearsal to overwrite `(default)`.** The destination must be a database ID *not already in use*, so production cannot be the target even by mistake.

The rehearsal therefore never touches production data. Its risks are confined to cost, quota, and operator error in the *cleanup* step.

## 2. Two rehearsal paths — and P5 is NOT blocked on V2

| Path | Mechanism | Source | Available |
|---|---|---|---|
| **P5-A · PITR clone** | `gcloud firestore databases clone --snapshot-time=…` | the live PITR window | **NOW** — needs no backup |
| **P5-B · Backup restore** | `gcloud firestore databases restore --source-backup=…` | a scheduled backup | **After V2** — first backup not yet materialized |

This corrects an assumption worth stating: P5 appeared to be blocked behind V2 (first backup). It is not. `databases clone` recovers from the **PITR window**, which is already live, so **P5-A can be rehearsed immediately** while P5-B waits for a real backup to exist.

**Both paths must eventually be rehearsed** — they exercise different recovery mechanisms with different failure modes, and §4 of the decision package designates the PITR surgical path as the one most incidents would actually use.

## 3. What each path proves

| | P5-A (PITR clone) | P5-B (backup restore) |
|---|---|---|
| Proves the PITR window is real and readable | ✅ | — |
| Proves scheduled backups are restorable | — | ✅ |
| Measures real RTO for a full recovery | ✅ | ✅ |
| Exercises the surgical (stale-read) path | partly | — |
| Validates data integrity post-recovery | ✅ | ✅ |

## 4. Preconditions

| # | Precondition | Status |
|---|---|---|
| C1 | PITR enabled, window populated | ✅ live; window fully populated from **2026-08-13** |
| C2 | Delete protection on `(default)` enabled | ✅ (and irrelevant to the rehearsal — the target is a *new* database) |
| C3 | A backup exists (**P5-B only**) | ❌ **outstanding — V2** |
| C4 | Owner authorization for database **creation** | ❌ **required — not yet granted** |
| C5 | Owner authorization for database **deletion** (cleanup) | ❌ **required — not yet granted** |
| C6 | Operator holds `roles/datastore.restoreAdmin` | unverified — check before execution |

## 5. Exact commands

**Destination naming.** Use a date-stamped, unmistakably disposable ID. It must be 4–63 characters and must not already exist. **Never `(default)`.**

```
DEST=rehearsal-20260813
```

### P5-A — PITR clone (available now)

```bash
# 1. Determine a valid whole-minute snapshot within the PITR window.
gcloud firestore databases describe --database="(default)" --project=taylor-parts
#    -> read earliestVersionTime; choose a whole-minute timestamp AFTER it and in the past.

# 2. Clone to a NEW database. Does not touch (default).
gcloud firestore databases clone \
    --source-database="projects/taylor-parts/databases/(default)" \
    --snapshot-time="<WHOLE_MINUTE_RFC3339>" \
    --destination-database="$DEST" \
    --project=taylor-parts
```

### P5-B — backup restore (after V2)

```bash
gcloud firestore backups list --location=us-central1 --project=taylor-parts   # get BACKUP_ID
gcloud firestore databases restore \
    --source-backup="projects/taylor-parts/locations/us-central1/backups/<BACKUP_ID>" \
    --destination-database="$DEST" \
    --project=taylor-parts
```

### Verification (read-only, on the rehearsal database only)

```bash
gcloud firestore databases describe --database="$DEST" --project=taylor-parts
gcloud firestore indexes composite list --database="$DEST" --project=taylor-parts
```

Integrity check: compare the rehearsal database's storage size against the measured production size (1,649,196 bytes at 2026-08-06) via `firestore.googleapis.com/storage/data_and_index_storage_bytes` filtered on `database_id="$DEST"`. **Do not read document contents** — size, index presence, and successful describe are sufficient to prove the restore produced a usable database.

### Cleanup — the step that carries the real risk

```bash
gcloud firestore databases delete --database="$DEST" --project=taylor-parts
```

**This is the single most dangerous command in the rehearsal.** Mitigations, all mandatory:

1. `$DEST` is echoed and confirmed to be **exactly** the rehearsal ID immediately before deletion.
2. `(default)` carries delete protection, so a mistyped deletion of production **fails closed**.
3. **Never enable delete protection on the rehearsal database** — that would block its own cleanup.
4. Cleanup is a distinct, separately-confirmed step, never chained to the verification command.

## 6. RTO measurement — the actual deliverable

Record UTC wall-clock at each boundary:

| Marker | Meaning |
|---|---|
| T0 | Recovery decision made (rehearsal start) |
| T1 | Restore/clone command issued |
| T2 | Operation reports `done: true` |
| T3 | Verification complete, database confirmed usable |
| T4 | *(measured, not performed)* estimated application cutover effort |

**Measured RTO = T3 − T0.** The decision package's ≤4h target becomes a measurement at T3. T4 is *estimated and documented*, not executed — cutover would repoint the application, which is out of scope.

Also measured: restore duration vs database size, which is what makes the RTO figure extrapolable as the database grows.

## 7. Cost

Restore is **$0.20/GiB**; at the measured 0.0015359 GiB that is **$0.0003**. The rehearsal database then bills storage at $0.15/GiB-month for its lifetime — under a cent for a rehearsal deleted the same day. **Cost is not a factor.**

## 8. Rollback

There is nothing to roll back. The rehearsal creates a new database and never modifies `(default)`. If it fails, the failure *is* the finding — it means the recovery capability does not work, which is precisely what P5 exists to discover before a real incident. "Rollback" is simply deleting the rehearsal database.

**If P5 fails, the correct response is to stop and report, not to retry until it passes.**

## 9. What P5 does NOT prove

Stated so the result is not over-read:

1. **Not application recovery.** A restored database is not a working system. Rules, indexes, Functions, Hosting and configuration are all separate — see the decision package §5 and §9.
2. **Not identity recovery.** Firebase Auth is entirely outside Firestore backup. See the deferred Identity/Auth review recorded in the decision package.
3. **Not the surgical path end-to-end.** Writing recovered documents back through governed write paths is deliberately excluded — that is a production data modification.
4. **Not a guarantee at scale.** RTO measured at ~1.6 MiB does not extrapolate linearly to a much larger database.

## 10. What requires Owner authorization

| Item | Type |
|---|---|
| Database **creation** (the rehearsal target) | Protected — explicitly withheld from the P2–P4 authorization |
| Database **deletion** (cleanup) | Protected — destructive, though scoped to the disposable database |
| PITR clone / backup restore execution | Protected production operation |
| `roles/datastore.restoreAdmin` for the operator, if absent | Access-administration action |

**Recommended: authorize P5-A now, P5-B after V2.** P5-A needs no backup, exercises the recovery path most incidents would use, and converts the RTO target into a measurement today rather than after the first backup materializes.

## 11. Status

**P5-A EXECUTED 2026-08-06 — PASS.** The PITR clone recovery mechanism is **proven**. Evidence: [`../audits/c3-p5a-pitr-rehearsal-20260806/`](../audits/c3-p5a-pitr-rehearsal-20260806/).

- **MEASURED RTO-CLONE = 559 s = 9.31 minutes** for a 1,649,196-byte database (T0 22:38:50Z -> T3 22:48:08Z). This is the **Firestore data-recovery portion only**, and is dominated by fixed provisioning overhead at this size - **do not extrapolate linearly**.
- **Validation PASS:** 23/23 identical collections; parts 190/190; warehouses 2/2; suppliers 2/2; **composite indexes 6/6 READY** (indexes are carried by the clone and did not need rebuilding).
- **Cleanup PROVEN:** rehearsal database describe returns `NOT_FOUND`; only `(default)` remains.
- **Production unchanged PROVEN:** the complete pre/post describe diff is the **etag alone**. Delete protection still ENABLED, PITR still ENABLED, `versionRetentionPeriod` 604800s, both backup schedules unchanged.

**Finding for the recovery runbook - delete protection is INHERITED by a clone.** The rehearsal database was created with `DELETE_PROTECTION_ENABLED` despite this package specifying otherwise; the clone API offers no flag to suppress it, and cleanup **failed closed** until protection was explicitly removed from the rehearsal database. Any future restore or clone will behave the same way, so cleanup of a failed or superseded recovery attempt needs a deliberate unprotect step. Operators must not meet this for the first time mid-incident.

**Still outstanding:** **P5-B** backup restore (blocked on V2 - no scheduled backup has materialized yet); whole-application recovery; **Firebase Auth recovery** (deferred, required before C3 certification); the <=4h whole-platform RTO; and recovery behaviour at scale.
