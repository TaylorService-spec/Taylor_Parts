# C3 P2–P4 — Firestore sizing and cost evidence (2026-08-06)

**Purpose:** answer "at Taylor Parts' current scale, what is the realistic monthly cost of P2 PITR + P3 daily backups + P4 weekly backups?"

**Run type:** READ-ONLY. Cloud Monitoring metric read + Cloud Billing Catalog read. No mutation, no configuration change, **no document content read**. Access token used transiently in request headers, never persisted.

**Answer: the cost is MEASURED, not estimated, and it is immaterial — approximately $0.002/month.**

---

## 1. Correcting the earlier direction

The prior decision package told the Owner to read database size from the Firebase console Usage tab. **That was wrong** — the console surfaces Cloud Storage bytes and Hosting storage, neither of which is Firestore database size, and exposes Firestore usage as operation quotas rather than a stored-bytes figure. The Owner correctly rejected both numbers.

The earlier "not machine-retrievable" conclusion was also wrong: it came from guessing metric names (`storage/stored_bytes`, `storage/stored_byte_count`, `document/count` — all 404) instead of **enumerating what actually exists**. Listing `metricDescriptors` filtered to `firestore.googleapis.com/` returns 31 metrics, including the correct one.

## 2. Measured size — `firestore.googleapis.com/storage/data_and_index_storage_bytes`

Resource: `database_id: (default)`, `location: us-central1`. 9,744 minute-resolution points over 7 days.

| | |
|---|---|
| **Current size (data + indexes)** | **1,649,196 bytes = 1.5728 MiB = 0.0015359 GiB** |
| Peak over the 7-day window | 1,649,196 bytes (same — flat) |
| 7 days earlier | 1,631,949 bytes |
| **Measured growth** | **+2,464 bytes/day ≈ 0.86 MiB/year** |

This is a **measured** value, not a bound or an estimate. The metric includes indexes.

## 3. Authoritative pricing — Cloud Billing Catalog API, service `EE2C-7FAC-5E08` (Cloud Firestore)

Region **us-central1 (Iowa)**. The database is `databaseEdition: STANDARD`, so the standard (non-"Enterprise") SKUs apply.

| SKU | Price |
|---|---|
| Cloud Firestore Storage Iowa | **$0.15** / GiB-month (free tier: first 1 GiB) |
| Cloud Firestore Point-in-time Recovery Storage Iowa | **$0.15** / GiB-month (**no free tier**) |
| Cloud Firestore Zonal Backup Storage Iowa | **$0.03** / GiB-month |
| Cloud Firestore Backup Restore Operation Iowa | **$0.20** / GiB restored |

These are retrieved unit prices, not quoted from documentation prose.

## 4. Cost model

Conservative assumptions, each biased *upward*: PITR storage billed as a **full copy** of the database (in reality it stores per-minute deltas, so this over-states); every scheduled backup billed as a **full independent copy**; daily 4-week retention = **28** concurrent backups; weekly 14-week retention = **14** concurrent backups.

| Scenario | Size | P2 PITR | P3 daily (28) | P4 weekly (14) | **Total / month** |
|---|---|---|---|---|---|
| **MEASURED (today)** | 0.00154 GiB | $0.0002 | $0.0013 | $0.0006 | **$0.0022** |
| 10× current | 0.0154 GiB | $0.0023 | $0.0129 | $0.0065 | **$0.0217** |
| 100× current | 0.154 GiB | $0.0230 | $0.1290 | $0.0645 | **$0.2166** |
| **Upper bound 1 GiB** (~650×) | 1.0 GiB | $0.1500 | $0.8400 | $0.4200 | **$1.41** |
| **Upper bound 10 GiB** (~6,500×) | 10.0 GiB | $1.5000 | $8.4000 | $4.2000 | **$14.10** |

A full restore of the database today costs **$0.0003**.

**Time to reach the 1 GiB bound at measured growth: ~1,192 years.** At **100×** the measured growth rate: ~12 years.

## 5. Classification (as requested)

| Class | Item |
|---|---|
| **MEASURED** | Database size (1,649,196 bytes), growth rate (+2,464 B/day), all four unit prices |
| **BOUNDED ESTIMATE** | Monthly cost — bounded above by the conservative full-copy model; real cost is **lower** because PITR stores deltas and backups may share storage |
| **UNKNOWN** | Nothing material to this decision |

Nothing here rests on an unavailable metric.

## 6. Recommendation

**Authorize P2, P3 and P4.**

The cost question is settled with a wide margin. At measured scale the full protection posture costs **about a fifth of one cent per month**, and it stays under **$1.50/month even if the database grows 650×**. The decision is not a cost trade-off; the cost is a rounding error against any plausible value of the operating company's operational record.

The relevant comparison remains: **~$0.002/month versus the current posture, in which any data loss discovered more than one hour after it occurs is permanent and unrecoverable.**

Two notes carried forward: PITR has **no free tier** and bills a minimum of one day even if disabled within 24 hours (immaterial here); and per the decision package, **enabling protection is not the same as proving recovery** — P5 restore rehearsal remains required before the posture can be called verified.
