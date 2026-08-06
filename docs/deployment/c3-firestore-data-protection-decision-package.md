---
artifact_type: deployment
gate: C3 — Firestore data protection / recovery · PRODUCTION DECISION PACKAGE
status: P1 AUTHORIZED AND EXECUTED 2026-08-06 (delete protection ENABLED). P2-P4 remain unauthorized pending cost evidence.
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: 42cd3ee
evidence: docs/audits/eao-readonly-evidence-20260806/
scope: Design + evidence only. No PITR, backup, delete-protection, IAM, or any project change executed.
---

# C3 — Firestore Data Protection & Recovery: Production Decision Package

The production database of the flagship deployment has **no recovery capability beyond one hour**. This package specifies the target posture, the exact protected changes required, and the verification that would make recovery *proven* rather than merely *enabled*.

**Nothing here is executed.** Every change below requires explicit Owner authorization and is performed by the human operator.

---

## 1. Current state (measured, not assumed)

From `gcloud firestore databases describe`, 2026-08-06 — evidence: [`../audits/eao-readonly-evidence-20260806/u3-database.txt`](../audits/eao-readonly-evidence-20260806/u3-database.txt):

| Property | Value |
|---|---|
| `pointInTimeRecoveryEnablement` | **`POINT_IN_TIME_RECOVERY_DISABLED`** |
| `deleteProtectionState` | **`DELETE_PROTECTION_DISABLED`** |
| `versionRetentionPeriod` | **`3600s`** (1 hour) |
| `earliestVersionTime` | 2026-08-06T20:07:31Z (≈1 hour before capture) |
| Backups | **0** |
| Backup schedules | **0** |
| Location / edition / type | `us-central1` · `STANDARD` · `FIRESTORE_NATIVE` |
| Concurrency | `PESSIMISTIC` |

**Derived exposure:**

- **RPO ≈ 1 hour** for events discovered within the hour — and **unbounded (total, permanent data loss)** for anything discovered later. Most real data-loss events — a bad migration, a faulty trigger, a mistaken bulk delete — are discovered *hours or days* later. This posture protects against approximately none of them.
- **RTO: undefined.** There is no restore source, so there is no restore time. This is not a slow recovery; it is **no recovery**.
- **A `gcloud firestore databases delete` would succeed**, because delete protection is off.

The one-hour window is Firestore's default read-version retention, not a backup. It is not a recovery capability and must not be described as one.

## 2. Provider capabilities (authoritative, current)

| Capability | Facts | Source |
|---|---|---|
| **PITR** | 7-day retention window; minute-level granularity; one version per document per minute. `earliestVersionTime` becomes meaningful 7 days after enablement. **No free tier — billing must be enabled.** Recovery = stale reads at a past timestamp (surgical) or clone/export-import at a whole-minute timestamp (full). Both **preserve the original database**. | [PITR overview](https://firebase.google.com/docs/firestore/pitr) |
| **Scheduled backups** | Up to **one daily** and **one weekly** schedule per database. Maximum retention **14 weeks** (`14w` / `8467200s`). Exact backup time cannot be specified. | [Backups](https://docs.cloud.google.com/firestore/native/docs/backups) |
| **Restore** | **Creates a NEW database.** You must supply a `DATABASE_ID` not already in use. It is **never in-place**. | [Backups](https://docs.cloud.google.com/firestore/native/docs/backups) |
| **Restore excludes** | Database **TTL policies**, **Firebase Security Rules**, and App Engine search/blob data. Index *configurations* are included in the backup. | [Backups](https://docs.cloud.google.com/firestore/native/docs/backups) |
| **Delete protection** | A database-level flag preventing deletion until explicitly disabled. | `databases describe`/`update` surface |
| **IAM** | `roles/datastore.backupsAdmin`, `roles/datastore.backupSchedulesAdmin`, `roles/datastore.restoreAdmin`. | [Backups](https://docs.cloud.google.com/firestore/native/docs/backups) |

**The restore-creates-a-new-database fact is the single most important design constraint**, and §5 is built around it.

## 3. Cost

Billing is already enabled (Blaze active, `DECISIONS.md` #35/#36/#47), so no plan change is required. Charged components:

| Component | Basis |
|---|---|
| PITR storage | per GiB-month, averaged from daily samples. **No free tier.** Minimum one day charged even if disabled within 24h. |
| Backup storage | per GiB-month, by retention duration |
| Restore | per GiB restored |
| Recovery reads | standard read pricing for documents read during stale reads/exports |

### RESOLVED 2026-08-06 — measured, not estimated

Full evidence: [`../audits/c3-p2-p4-sizing-20260806/`](../audits/c3-p2-p4-sizing-20260806/).

> **Correction.** This section previously directed the Owner to the Firebase console Usage tab. That was wrong — the console shows Cloud Storage and Hosting bytes, neither of which is Firestore database size. The earlier "not machine-retrievable" conclusion was also wrong: it came from guessing metric names instead of enumerating them. `firestore.googleapis.com/storage/data_and_index_storage_bytes` is the correct metric and is readable.

**Measured size: 1,649,196 bytes = 1.5728 MiB = 0.0015359 GiB** (data + indexes, `(default)`/`us-central1`, 9,744 points over 7 days). **Measured growth: +2,464 bytes/day ≈ 0.86 MiB/year.**

**Authoritative unit prices** (Cloud Billing Catalog API, service `EE2C-7FAC-5E08`, Iowa/us-central1, STANDARD edition): storage **$0.15**/GiB-mo (first 1 GiB free) · PITR **$0.15**/GiB-mo (**no free tier**) · backup storage **$0.03**/GiB-mo · restore **$0.20**/GiB.

| Scenario | Size | P2+P3+P4 total/month |
|---|---|---|
| **MEASURED today** | 0.00154 GiB | **$0.0022** |
| 100× current | 0.154 GiB | $0.2166 |
| Upper bound 1 GiB (~650×) | 1 GiB | $1.41 |
| Upper bound 10 GiB (~6,500×) | 10 GiB | $14.10 |

Model is conservative in every direction (PITR billed as a full copy though it stores deltas; every backup billed as an independent full copy; 28 daily + 14 weekly concurrent copies). **Time to reach 1 GiB at measured growth: ~1,192 years** (~12 years at 100× the growth rate). A full restore today costs **$0.0003**.

**The cost question is settled: P2–P4 are immaterial.** The comparison is ~$0.002/month against a posture in which any data loss discovered more than one hour after it occurs is permanent and unrecoverable.

## 4. Recommended target posture

### 4a. Flagship production (Taylor Parts) — minimum

| # | Control | Setting | Rationale |
|---|---|---|---|
| **P1** | **Delete protection** | ✅ **ENABLED — EXECUTED 2026-08-06** | Zero cost, zero operational impact, prevents catastrophic single-command loss. Evidence: [`../audits/c3-p1-delete-protection-20260806/`](../audits/c3-p1-delete-protection-20260806/). |
| **P2** | **PITR** | **ENABLED** (7-day window) | Moves RPO from 1 hour to 7 days at minute granularity. The single largest risk reduction available. |
| **P3** | **Daily backup schedule** | **ENABLED**, retention **4 weeks** | Covers the beyond-7-days case PITR cannot. 4w balances cost against realistic discovery lag. |
| **P4** | **Weekly backup schedule** | **ENABLED**, retention **14 weeks** | Long-horizon protection against slow-onset corruption. Cheap at this data scale. |
| **P5** | **Restore rehearsal** | **Quarterly + before any migration** | §6. Without this, P2–P4 are untested assumptions. |
| **P6** | **Recovery runbook** | Published, owned | §5. |

Resulting objectives: **RPO ≤ 1 minute** within 7 days; **≤ 24 hours** within 4 weeks; **≤ 7 days** within 14 weeks. **RTO target: ≤ 4 hours** for a full restore (dominated by the new-database + cutover work in §5, not by the restore itself).

### 4b. Future SaaS / customer production

Same controls as the floor, plus: per-tenant restore granularity becomes a **requirement** (a single customer's bad import must not require a whole-database restore — this is an input to the **Tenancy ADR**, which should not be designed without it); retention driven by contractual commitments; documented RPO/RTO becoming customer-facing commitments — **which must not be published before P5 rehearsals substantiate them** (see `PlatformOperatingModel.md` and the deferred C2); and backup-failure alerting as a monitored control.

## 5. Restore mechanics and the cutover problem

**A restore creates a new database. It does not repair the existing one.** The application points at `(default)`. Therefore recovery is not "restore and resume" — it is:

1. Restore backup → **new** database (e.g. `recovery-20260806`).
2. Validate the restored data.
3. **Redirect the application**, or copy corrected data back into `(default)`.

Step 3 is the hard part and the reason RTO is hours, not minutes. Two strategies:

| Strategy | Mechanism | Fits |
|---|---|---|
| **Surgical (preferred)** | PITR stale read at a pre-incident timestamp → write only affected documents back into `(default)` through **governed write paths**, never raw | Bad migration, faulty trigger, bounded bad write — the realistic majority |
| **Full cutover** | Restore to a new database, then repoint the app (`firebase.js` `databaseId`, Functions config, Rules deploy, index rebuild) | Catastrophic corruption or deletion only |

**What a restore does NOT bring back — must be reapplied:** Firestore **Security Rules** (deploy from the repo), **TTL policies**, and anything outside Firestore entirely — **Cloud Functions**, **Hosting**, **Auth users**, and application configuration. A recovery plan that only restores documents restores a system that does not work.

**Firebase Auth is not covered by any of this.** Firestore backups do not include Auth. Identity loss is a separate, currently-unmitigated exposure and is flagged here as a **follow-on gap**, not resolved by this package.

## 6. Verification plan — "backup enabled" ≠ "recovery proven"

The posture is not accepted until a restore has actually been performed.

**V1 · Enablement evidence** — re-run `databases describe` + `backups schedules list`; confirm PITR enabled, delete protection enabled, schedules present with the intended retention. Capture per `governance/audit-artifact-standard.md`.

**V2 · First-backup existence** — after one schedule interval, `backups list` returns ≥1 backup. *An enabled schedule that has never produced a backup is not evidence.*

**V3 · Restore rehearsal (the actual test)** — restore a real backup into a **new, disposable** database ID; verify document counts and spot-check integrity on non-sensitive collections; **measure wall-clock duration → this is the empirical RTO**; then delete the rehearsal database. Never restore over `(default)`.

**V4 · Surgical PITR rehearsal** — perform a stale read at a past whole-minute timestamp and confirm it returns prior state. Read-only; no write-back during rehearsal.

**V5 · Recovery-runbook walkthrough** — a person other than the author follows the runbook end to end against the rehearsal.

**Cadence:** V1/V2 once at enablement; **V3/V4 quarterly and before any data migration**; V5 on any material change.

## 7. Exact protected changes required

Each is Owner-authorized and human-operator-executed. Ordered by risk-reduction-per-unit-risk.

```bash
# P1 — delete protection (do this first: zero cost, zero impact, highest catastrophic-loss reduction)
gcloud firestore databases update --database="(default)" \
    --delete-protection --project=taylor-parts

# P2 — point-in-time recovery (7-day window)
gcloud firestore databases update --database="(default)" \
    --enable-pitr --project=taylor-parts

# P3 — daily backup schedule, 4-week retention
gcloud firestore backups schedules create --database="(default)" \
    --recurrence=daily --retention=4w --project=taylor-parts

# P4 — weekly backup schedule, 14-week retention (max)
gcloud firestore backups schedules create --database="(default)" \
    --recurrence=weekly --retention=14w --day-of-week=SUN --project=taylor-parts
```

**Verify flag names against `gcloud firestore databases update --help` at execution time** — this package was authored from documentation, and the operator's CLI is authoritative for exact syntax.

**Operator IAM required:** `roles/datastore.backupSchedulesAdmin` (P3/P4), `roles/datastore.restoreAdmin` (rehearsals only), plus database-update permission (P1/P2). Grant to the operator identity, not to the application service account.

## 8. Rollback implications

| Change | Reversible? | Notes |
|---|---|---|
| P1 delete protection | Yes | `--no-delete-protection`. **Reversal re-arms the catastrophic path** — never disable casually. |
| P2 PITR | Yes | `--disable-pitr`. Disabling **discards the accumulated PITR window immediately**; minimum one day billed. |
| P3/P4 schedules | Yes | Deleting a schedule does not delete existing backups; backups age out on their own retention. |
| Restore | N/A | Creates a new database; never mutates `(default)`. Rollback = delete the new database. |

**None of these changes affects application behaviour.** No Rules, Functions, indexes, client code, or write path is touched. The risk profile of enabling them is materially lower than that of the current posture.

## 9. Interaction with other surfaces

- **Rules** — excluded from backup/restore; reapplied by deploying from the repo. Note the live-vs-repo comment encoding drift recorded in this program's evidence set.
- **Functions / Hosting / Auth** — entirely outside Firestore backup. Functions are redeployable from source; **Auth is not covered and remains an open gap** (§5).
- **Indexes** — index configuration is included in backups; a restored database still rebuilds them, which contributes to RTO.
- **Delete protection vs. emulator/CI** — applies only to the production database; no effect on emulator or CI.
- **Receiving / ledger idempotency** — the append-only ledger and idempotency keys make a surgical PITR replay materially safer than in a mutable-state system. This is an existing architectural strength worth preserving in the Tenancy and Configuration ADRs.

## 10. What requires Owner authorization

| Item | Type |
|---|---|
| P1 delete protection | Production configuration change |
| P2 PITR enablement | Production configuration change **+ ongoing spend** |
| P3/P4 backup schedules | Production configuration change **+ ongoing spend** |
| Operator IAM grants | Access-administration action |
| V3 restore rehearsal | Creates a (disposable) database — production-adjacent |
| Publishing RPO/RTO as commitments | Commercial (C2, deferred) |

**Recommended authorization order: P1 alone first.** It is free, instantaneous, reversible, has no operational impact, and removes the worst single-command outcome. It should not wait on the spend decision for P2–P4.

## 11. Status

**P1 EXECUTED 2026-08-06** under Owner Decision A, scoped to delete protection only. `deleteProtectionState: DELETE_PROTECTION_DISABLED → DELETE_PROTECTION_ENABLED`; field-by-field comparison found **0 unintended changes**; PITR still disabled, backups still 0, schedules still 0. Evidence (7 files, hashed): [`../audits/c3-p1-delete-protection-20260806/`](../audits/c3-p1-delete-protection-20260806/).

**P1 changes the blast radius, not the recovery posture.** RPO and RTO are unchanged — recoverable history is still one hour and there is still no restore source. The database is now protected from accidental deletion and remains **unrecoverable** from data loss.

**P2–P4 remain unauthorized, but the cost evidence they were waiting on is now complete** (§3, measured): total **$0.0022/month** at current scale, **≤$1.41/month even at 650× growth**. Recommendation: **authorize P2, P3 and P4.** No IAM change requested. No restore rehearsal performed.

**Sources:** [PITR overview](https://firebase.google.com/docs/firestore/pitr) · [Backups & restore](https://docs.cloud.google.com/firestore/native/docs/backups) · [Firestore pricing](https://firebase.google.com/docs/firestore/pricing)
