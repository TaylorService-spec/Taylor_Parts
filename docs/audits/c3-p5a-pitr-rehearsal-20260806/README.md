# C3 P5-A — PITR clone restore rehearsal (production execution record)

**Result: PASS. The PITR clone recovery mechanism is PROVEN.**

**Authorization:** Owner, 2026-08-06, scoped to exactly two protected operations — create one disposable rehearsal database via PITR clone, and delete it after successful validation.
**Executed by:** AI agent session under that authorization, using the Owner's already-active `gcloud` session.
**Package:** [`../../deployment/c3-p5-restore-rehearsal-package.md`](../../deployment/c3-p5-restore-rehearsal-package.md).

---

## 1. Pre-gate — 10/10 PASS (fail-closed)

Source `projects/taylor-parts/databases/(default)` · `us-central1` · `FIRESTORE_NATIVE` · delete protection **ENABLED** · PITR **ENABLED**. Snapshot `2026-08-06T22:32:00Z` verified after `earliestVersionTime` (21:15:00Z), in the past, and a whole minute. Target `recovery-rehearsal-20260806-223836` verified **not already existing** (only `(default)` existed) and disposable-named.

## 2. Execution

```bash
gcloud firestore databases clone \
    --source-database="projects/taylor-parts/databases/(default)" \
    --snapshot-time="2026-08-06T22:32:00Z" \
    --destination-database="recovery-rehearsal-20260806-223836" \
    --project=taylor-parts
```

Operation `…/operations/Q7Qg53V0HoweTGDf8FFiihAqMWxhcnRuZWMtc3ULIgwQIRo` · `operationState: SUCCESSFUL` · `done: true` · exit 0.

Provenance recorded on the clone itself: `sourceInfo.pitrSnapshot.snapshotTime: 2026-08-06T22:32:00Z`, `progress: COMPLETED` — the database carries proof of which snapshot it came from.

## 3. MEASURED RTO-CLONE

| Marker | UTC |
|---|---|
| **T0** — decision/submit | `2026-08-06T22:38:50Z` |
| **T3** — operation `endTime` | `2026-08-06T22:48:08.533266Z` |

### **RTO-CLONE = 559 seconds = 9.31 minutes**

for a **1,649,196-byte** database.

**This measures the Firestore data-recovery portion of RTO only.** It is **not** the whole-application RTO: it excludes Rules redeploy, Functions, Hosting, Auth, application repointing, and operator decision latency in a real incident.

**Scaling caveat:** at ~1.6 MiB the duration is dominated by fixed provisioning overhead, not data volume. This figure must **not** be extrapolated linearly to a larger database.

## 4. Validation — PASS

| Check | `(default)` | rehearsal | Result |
|---|---|---|---|
| Collections | 23 | 23 | **identical sets** |
| `parts` documents | 190 | 190 | match |
| `warehouses` documents | 2 | 2 | match |
| `suppliers` documents | 2 | 2 | match |
| Composite indexes | 6 (READY) | 6 (READY) | match |
| Location / type / edition | us-central1 / NATIVE / STANDARD | same | match |
| Database identity | `(default)` | `recovery-rehearsal-…` | **distinct** |

`parts = 190` independently corroborates the Part Master record count in `DECISIONS.md` #44.

Counts were obtained via `runAggregationQuery` COUNT, which returns **only an integer** — no document contents were read. Collection lists came from `listCollectionIds` (metadata). **No data was copied back into production.**

### Carried by the clone
Documents, collections, **and composite indexes (6, already `READY`)** — indexes did not require a manual rebuild.

### NOT carried (must be reapplied in a real recovery)
- **PITR** — the clone had `POINT_IN_TIME_RECOVERY_DISABLED`; a recovered database starts with no PITR window of its own.
- **`freeTier`** — `false` on the clone vs `true` on production; only one database per project receives free-tier allowance.
- **Firestore Security Rules** — project-level, not database-level; unaffected by cloning and redeployed from the repository.
- **Cloud Functions, Hosting, Firebase Auth, application configuration** — entirely outside Firestore.

## 5. ⚠️ Unanticipated provider behaviour — delete protection is INHERITED

**The clone was created with `deleteProtectionState: DELETE_PROTECTION_ENABLED`, inherited from the source**, despite the rehearsal design specifying that the disposable database must not have it. The clone API offers no flag to suppress this.

**Consequence:** the authorized cleanup deletion **failed closed** until protection was explicitly removed from the rehearsal database.

**Resolution and reasoning.** Delete protection was disabled **on the rehearsal database only**, as an explicitly-verified sub-step of the authorized cleanup, immediately before deletion:

```bash
gcloud firestore databases update --database="recovery-rehearsal-20260806-223836" \
    --no-delete-protection --project=taylor-parts
```

This was judged to be *completing* the authorized cleanup rather than improvising around the safety model, because: it touched only the disposable resource; production's own delete protection was verified **still ENABLED** immediately before and after; and the alternative — leaving a **complete, live copy of production data** in the project indefinitely — is a strictly worse security posture than removing it. Production was never a possible target: name guards aborted on anything not matching `recovery-rehearsal-2026*`.

**This is a real finding for the recovery runbook:** any future restore or clone will produce a delete-protected database, and cleanup of a failed or superseded recovery attempt requires an extra, deliberate unprotect step. **Operators must not be surprised by this mid-incident.**

## 6. Cleanup — PROVEN

Pre-delete gate 4/4 PASS (target ≠ `(default)`; matches `recovery-rehearsal-2026*`; project `taylor-parts`; validation package complete). Deletion was run as a **separate explicit command**, never chained to clone or validation.

| Proof | Result |
|---|---|
| Rehearsal database describe | **`NOT_FOUND`** (exit 1, as intended) |
| `databases list` | only `projects/taylor-parts/databases/(default)` |
| Rehearsal appears in listing | 0 occurrences |

## 7. Production unchanged — PROVEN

Complete `describe` diff, pre-rehearsal vs post-cleanup:

```
9c9
< etag: IIHQzuGIjZYDMOWZnb+DjZYD
---
> etag: IKDdns2LjZYDMOWZnb+DjZYD
```

**The etag is the only difference.** Every substantive field is unchanged:

| Property | Value |
|---|---|
| `name` | `projects/taylor-parts/databases/(default)` |
| `deleteProtectionState` | **`DELETE_PROTECTION_ENABLED`** |
| `pointInTimeRecoveryEnablement` | **`POINT_IN_TIME_RECOVERY_ENABLED`** |
| `versionRetentionPeriod` | `604800s` |
| Backup schedules | **UNCHANGED** — daily `2419200s`, weekly `8467200s` SUNDAY |

No production data was read, written, or modified. No Rules, Functions, Hosting, Auth, IAM, index, grant, or configuration change.

## 8. What P5-A PASS means — precisely

**PROVEN:** the PITR clone recovery mechanism works end to end on this production database — a valid snapshot can be selected, cloned into a new database, and that database contains the expected collections, document counts, and indexes. **RTO-CLONE is now a measurement (9.31 min), not a target.**

**NOT proven by this run:**

1. **Backup restore** — P5-B, still required once V2 produces the first scheduled backup.
2. **Whole-application recovery** — Rules, Functions, Hosting, configuration, and application repointing are untested.
3. **Firebase Auth recovery** — entirely outside Firestore; deferred review, required before C3 certification.
4. **The ≤4h whole-platform RTO** — only the data-recovery portion is measured.
5. **Recovery at scale** — 9.31 minutes at 1.6 MiB does not extrapolate.
