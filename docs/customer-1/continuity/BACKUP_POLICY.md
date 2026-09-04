# EOS Backup Policy — Taylor Customer 1

Gate: `C1-RECOVERY-01` (Backup and restore proof). Authority: Verenward.
Status of this document: **policy defined; two values pending Owner decision; no
backup has been executed or verified from this document.**

This document defines *what is backed up, how often, kept how long, where, and
who is accountable*. It does not define how a restore is tested — that is the
isolated restore test procedure, a separate document in this lane.

Nothing in this document authorizes running anything against a live Firebase
project. Every command shown here is written down so a human operator can run
it deliberately. The automation harness does not run them and must not.

---

## 1. Scope — what is backed up

The scope is derived from `firebase.json` and `firestore.rules` in this
repository, not from an assumption about the production project.

| # | Data store | In scope | Mechanism | Notes |
|---|------------|----------|-----------|-------|
| 1 | Cloud Firestore, database `(default)`, location `us-central1` | **Yes** | Managed export to a Cloud Storage bucket, plus Point-in-Time Recovery | The operational record: every collection, whole-database. See §1.1. |
| 2 | Firebase Authentication (user accounts, password hashes, UIDs) | **Yes** | `firebase auth:export` | Not covered by a Firestore export. A Firestore restore without this leaves documents pointing at UIDs that no longer resolve. |
| 3 | Application source, Firestore Rules, indexes, Cloud Functions source | **Yes** | The git repository and its remote | Already backed up by virtue of being version-controlled and pushed. Recovery is a redeploy from a known commit, not a data restore. |
| 4 | Cloud Storage for Firebase (user-uploaded files) | **Not applicable** | — | No `storage` entry in `firebase.json` and no `storage.rules` in this repository. If a Storage bucket is ever configured, this policy must be reopened before launch. |
| 5 | Deployed Cloud Functions runtime state | **No** | — | Stateless. Recovered by redeploying from the source commit (row 3). |
| 6 | Firebase Hosting releases | **No** | — | Recovered by redeploying the build from the source commit (row 3). Hosting also retains prior releases and can roll back independently. |

### 1.1 Firestore scope is the whole database, deliberately

The policy is a **whole-database export with no per-collection selection.**

`firestore.rules` currently governs 50+ top-level collections, and that number
changes with almost every feature. A policy that enumerates collections is a
policy that silently stops covering the newest one. Whole-database export costs
the same to operate and cannot drift.

The corollary is that a *partial* restore — one collection, one document — is
an extraction problem solved at restore time from a whole-database export, not
a backup-time selection problem.

### 1.2 Two mechanisms, not one

Firestore managed exports and Point-in-Time Recovery (PITR) fail differently
and are both required:

- **Managed export** is durable and long-lived, and survives the project itself
  being damaged, because the export lands in a bucket you control. It is a
  *snapshot*: it captures the database as of the export time and loses
  everything written after it.
- **PITR** covers the gap between snapshots — it can read the database as of any
  microsecond in its retention window — but it lives inside the same project. It
  does not protect against project deletion or billing loss.

Neither alone is a backup. Both together are.

---

## 2. Frequency

| Mechanism | Frequency | Status |
|-----------|-----------|--------|
| Firestore managed export | **PENDING-OWNER-RPO** — see §6 | Cannot be set without a stated recovery point objective. |
| Firestore PITR retention | Fixed by the platform's retention window; enable it, do not tune it | Engineering decision. Enable before launch. |
| Firebase Auth export | On the same schedule as the Firestore export, plus immediately before any change to identity configuration | Engineering decision. |
| Source repository | Continuous, on every push | Already in force. |

Export frequency is not an engineering preference. It is the mathematical
statement of how much of Taylor's work Taylor has agreed it can afford to
re-enter by hand after a failure. That is a customer commitment. See §6.

---

## 3. Retention

| Artifact | Retention | Status |
|----------|-----------|--------|
| Firestore managed exports | **PENDING-OWNER-RETENTION** — see §6 | Driven by how far back Taylor must be able to reach, and by any records-retention obligation. Not an engineering choice. |
| Firebase Auth exports | Same as the Firestore export they were taken alongside | The two are only useful as a matched pair. |
| Restore-test evidence (see the restore test procedure) | Kept for the life of the engagement | Engineering decision. This is the audit trail that the recovery path was proven. |

Retention is enforced by a **Cloud Storage lifecycle rule on the backup bucket**,
not by a person remembering to delete things.

---

## 4. Location — where backups live

Requirements, in order of importance:

1. **A dedicated Cloud Storage bucket** whose only purpose is backups. Not a
   bucket the application also writes to.
2. **A separate project from production**, or at minimum a bucket whose
   deletion is independently protected. A backup that a compromised or
   mistakenly-deleted production project can take with it is not a backup.
3. **Object versioning and a retention/lock policy enabled**, so that a
   mistaken deletion of a backup object is itself recoverable.
4. **Access restricted to a named human operator and the export service
   account.** No application identity, and no automation in this harness, holds
   write or delete access to the backup bucket.
5. **Same region as the database (`us-central1`)** for the export, because
   Firestore managed export requires the bucket be co-located. Cross-region
   copies, if wanted, are a second step from the primary bucket.

The concrete bucket name and project are a production-identity decision and are
recorded in the Customer 1 establishment record when made, not invented here.

---

## 5. Accountability

| Responsibility | Accountable party |
|----------------|-------------------|
| That a backup policy exists, is correct, and is tested | Verenward |
| Executing backup and restore operations against live Firebase projects | A named human operator with production authorization. Never the automation harness. |
| Setting the recovery point and recovery time objectives | Taylor, as a business decision, recorded by the Owner |
| Noticing that a scheduled backup stopped running | **PENDING** — an unmonitored backup schedule is indistinguishable from a working one until the day you need it. Assigning this is part of closing `C1-RECOVERY-01`. |
| Retaining and reviewing restore-test evidence | Verenward |

The monitoring row is the one that most often turns a documented backup policy
into a fictional one. It is listed as pending rather than quietly omitted.

---

## 6. Pending decisions

These are recorded here rather than guessed. Each blocks part of
`C1-RECOVERY-01`.

| Key | Decision needed | Authority | What it blocks |
|-----|-----------------|-----------|----------------|
| `PENDING-OWNER-RPO` | Recovery point objective: how much recent work may be lost in a disaster, stated in time (e.g. "no more than one hour of writes"). | Owner, on Taylor's behalf | §2 export frequency; the PITR-vs-export split in §1.2 |
| `PENDING-OWNER-RETENTION` | How long backups are kept, and whether any records-retention obligation applies to Taylor's data. | Owner, on Taylor's behalf | §3 retention and the bucket lifecycle rule |

A recovery *time* objective (how long a restore may take) is also a customer
commitment, but unlike the two above it cannot be answered before the isolated
restore test measures how long a restore actually takes. It is raised there.

---

## 7. Operator commands (reference only — do not run from automation)

Recorded so the restore test procedure and the operator are working from the
same commands. Placeholders in `ANGLE_BRACKETS` are filled from the
establishment record.

Firestore export:

    gcloud firestore export gs://<BACKUP_BUCKET>/firestore/<TIMESTAMP> --project=<PROD_PROJECT>

Firebase Auth export:

    firebase auth:export <TIMESTAMP>-auth.json --format=json --project=<PROD_PROJECT>

Note the asymmetry deliberately: there is **no restore command in this
document.** Restore is destructive, is only ever performed against an isolated
target, and belongs to the restore test procedure where the isolation of that
target is established first.

---

## 8. What this document does not establish

`C1-RECOVERY-01` closes when the policy is defined **and** a documented restore
procedure has been tested with integrity verification. This document is the
first half. It is not evidence that:

- a backup has ever been taken,
- an export schedule exists in the production project,
- PITR is enabled,
- any restore has ever succeeded, or
- restored data has ever been read and verified intact.

A backup that has never been restored is a hypothesis.
