# Isolated Restore Test Procedure — Taylor Customer 1

Gate: `C1-RECOVERY-01` (Backup and restore proof). Authority: Verenward.
Status of this document: **procedure defined; no restore has been executed. This
document is not evidence of a tested recovery path — the completed evidence
record in §7 is.**

Companion to [`BACKUP_POLICY.md`](./BACKUP_POLICY.md), which defines what is
backed up. This document defines how a backup is proven to be restorable, and
what counts as proof.

Nothing here authorizes running anything against a live Firebase project. Every
command is written down so a named human operator with production authorization
can run it deliberately. The Customer 1 automation harness does not run them and
must not.

**A restore is never performed against a project that holds live Taylor data.**
The only permitted target is the isolated target defined in §2. There is no
step in this document that writes to production.

---

## 1. What this test proves, and what "proof" means

The claim under test is not "the restore command exited zero." A Firestore
import can complete successfully and still leave you with a database that is
missing a collection, is a week older than you thought, or contains documents
whose owning user accounts no longer exist.

The claim under test is:

> From the backup artifacts alone, a working copy of Taylor's operational data
> can be stood up in a known amount of time, and the data in it can be read and
> shown to match what was in production at the moment the backup was taken.

Proof is therefore three things, all recorded in §7:

1. **Completion** — the import finished (necessary, not sufficient).
2. **Integrity** — the checks in §5 were run against the *restored* data and
   passed, with actual counts and values written down, not ticked off.
3. **Duration** — how long the whole path took, measured, because a recovery
   time objective cannot be agreed to before anyone knows what is achievable.

An unchecked box in §7 makes the whole record void. A partially completed
evidence record is a failed test, not a partial pass.

---

## 2. The isolated target

The restore target is a **separate Firebase project created for restore testing
and used for nothing else.**

Required properties, all of which are checked in §4 before any import runs:

| # | Property | Why |
|---|----------|-----|
| 1 | A distinct project id from production and from sandbox | The isolation is the project boundary. Nothing weaker is isolation. |
| 2 | Its Firestore database is empty, or holds only the previous restore test | A restore into a database with existing documents merges rather than replaces, and every count in §5 becomes meaningless. |
| 3 | No Cloud Functions deployed, no Hosting site serving | A restored copy of the operational record must not be able to send email, charge anything, or call an external system. |
| 4 | No Taylor personnel and no real customer identity has access | It contains real Taylor operational data. It is production-sensitive even though it is not production. |
| 5 | Read access limited to the named operator running the test | Same reason. |
| 6 | Not the project any `.firebaserc` alias in this repository points to | Prevents an ordinary `firebase deploy` in a normal working session from touching it, in either direction. |

The concrete project id is a production-identity decision recorded in the
Customer 1 establishment record when made. It is `PENDING-OWNER-TARGET` here and
is not invented by this document. See §8.

Property 3 deserves the emphasis: the most damaging outcome of a restore test is
not a failed restore. It is a *successful* restore into an environment that then
acts on the data it was given — reprocesses a work order, re-sends a
notification, re-runs a scheduled function against a month-old snapshot.

---

## 3. Inputs

Before starting, the operator has, and records in §7:

- The Firestore export prefix under test: `gs://<BACKUP_BUCKET>/firestore/<TIMESTAMP>`.
- The matching Firebase Auth export file taken alongside it. A Firestore restore
  tested without its paired Auth export proves less than it appears to: the
  documents come back, but nothing proves a user can log in and see them.
- The source commit of the application at the time of the backup, so the
  restored data is read by the code that wrote it.
- **Expected values captured from production before the test begins** — see §5.1.
  These cannot be derived after the fact from the restored copy; comparing a
  restore only against itself proves nothing.

---

## 4. Procedure

Placeholders in `ANGLE_BRACKETS` come from the establishment record. Each step
is either a check or an action; a failed check stops the test.

**Step 1 — Confirm the target is the isolated target.** Read back the project id
and confirm it against §2 property 1 and property 6. Confirm aloud, to a second
person or in the evidence record, that this project id is not production.

**Step 2 — Confirm the target database is empty.** Read the collection list of
the target. If it is non-empty and holds anything other than a prior restore
test, stop: clear it deliberately as a separate authorized action, or use a
fresh project. Do not import over it.

**Step 3 — Capture expected values from production.** Run the §5.1 read-only
production queries and write the results into §7 *before* the import. Read-only.
No production write occurs at any point in this procedure.

**Step 4 — Start the clock.** Record the wall-clock start time. Duration
measurement begins here, not at the import command, because a recovery time
objective must include the operator's preparation.

**Step 5 — Import Firestore.**

    gcloud firestore import gs://<BACKUP_BUCKET>/firestore/<TIMESTAMP> --project=<RESTORE_TARGET_PROJECT>

**Step 6 — Import Firebase Auth.**

    firebase auth:import <TIMESTAMP>-auth.json --hash-algo=<HASH_ALGO> --project=<RESTORE_TARGET_PROJECT>

The hash algorithm and its parameters come from the header of the Auth export
file itself. Importing accounts without them produces accounts that exist but
cannot authenticate — an import that completes and a login that fails.

**Step 7 — Stop the clock.** Record the wall-clock end time. The difference is
the measured restore duration.

**Step 8 — Run the integrity checks in §5** against the restored copy. Record
every actual value, not a pass mark.

**Step 9 — Record the outcome in §7** and file it as restore-test evidence per
`BACKUP_POLICY.md` §3.

**Step 10 — Tear down.** The restored copy holds real Taylor operational data.
Either delete the target project's data, or leave it only until the next test
and treat it as production-sensitive in the meantime. Record which was done.

---

## 5. Integrity checks — what makes the restore proven

Each check compares the restored copy against a value captured from production
in Step 3. A check with no pre-captured expected value is not a check.

### 5.1 Values captured from production before the import

| Key | Value to capture | Why this one |
|-----|------------------|--------------|
| `COLLECTIONS` | The list of top-level collection names | A restore missing an entire collection is the failure mode a spot-check misses. Comparing the list catches it in one look. |
| `COUNTS` | Document count per top-level collection | Catches a truncated or partially-written export. |
| `ANCHORS` | Three specific documents, copied in full: the most recently written work order, one customer, one part | Counts prove volume. Only reading a document's fields proves content survived. |
| `NEWEST` | The most recent write timestamp visible anywhere in the data | Establishes what the backup's actual recency is, which is the measured input to the recovery point objective. |
| `AUTH_COUNT` | Number of accounts in the Auth export, and one specific account's UID | Ties the two artifacts together. |

### 5.2 Checks against the restored copy

| # | Check | Passes when |
|---|-------|-------------|
| 1 | Collection list | The restored top-level collection list equals `COLLECTIONS` exactly. A missing collection fails. An unexpected extra collection fails just as hard — it means the target was not empty. |
| 2 | Counts | Each per-collection count equals `COUNTS`. Any difference fails; investigate before re-running. |
| 3 | Anchor documents | Each of the three `ANCHORS` documents is present and every field matches the copy captured in Step 3, field by field. |
| 4 | Referential integrity across the pair | The user id on the anchor work order resolves to an account present in the restored Auth data. This is the check that a Firestore-only restore silently fails. |
| 5 | Recency | The newest write timestamp in the restored copy equals `NEWEST`. The gap between `NEWEST` and the disaster is the work Taylor re-enters by hand. |
| 6 | Readability by the application | The application, at the source commit from §3, is pointed at the restored copy in a local run and a work order list renders with real rows. Data that no code can read is not recovered data. |

Check 6 is deliberately last and deliberately hands-on. Checks 1–5 prove the
bytes came back. Check 6 is the only one that proves the *system* came back.

### 5.3 A note on what is not checked

This procedure does not attempt to verify every document in the database. It
verifies structure exhaustively (checks 1, 2, 5) and content by sampling (checks
3, 4, 6). A full document-by-document comparison of a production-sized database
is a different and much larger exercise, and it is not what makes the difference
between a tested and an untested recovery path.

---

## 6. Frequency and when this must be re-run

A restore test is valid only for the shape of the data and the tooling at the
time it was run. It must be re-run:

- before launch, as the evidence that closes `C1-RECOVERY-01`;
- after any change to the backup mechanism, bucket, or export schedule;
- after a Firestore data model change large enough to add or remove a top-level
  collection;
- on a recurring cadence thereafter — `PENDING-OWNER-CADENCE`, because how often
  Taylor pays to re-prove recovery is a commitment, not an engineering
  preference.

An untested backup decays into a hypothesis at a rate nobody notices.

---

## 7. Evidence record template

Copy this block, complete every field, and file it. Fields left blank void the
record.

    RESTORE TEST EVIDENCE
    Date:
    Operator (named human, production-authorized):
    Restore target project id:
    Confirmed target is not production (how):
    Backup artifact under test (export prefix):
    Paired Auth export file:
    Application source commit:

    Captured from production before import:
      COLLECTIONS (list):
      COUNTS (per collection):
      ANCHORS (3 documents, attached):
      NEWEST (timestamp):
      AUTH_COUNT (and one UID):

    Timing:
      Start (Step 4):
      End (Step 7):
      Measured restore duration:

    Integrity checks (actual values, not marks):
      1 Collection list:
      2 Counts:
      3 Anchor documents:
      4 Referential integrity across Firestore + Auth:
      5 Recency:
      6 Application read at source commit:

    Outcome (PASSED / FAILED):
    If failed, what failed and what was done:
    Teardown performed (Step 10):

---

## 8. Pending decisions

| Key | Decision needed | Authority | What it blocks |
|-----|-----------------|-----------|----------------|
| `PENDING-OWNER-TARGET` | The concrete isolated restore-target project id, and authorization to create it. | Owner (production identity) | §2, and therefore executing this procedure at all |
| `PENDING-OWNER-CADENCE` | How often the restore test is re-run after launch. | Owner, on Taylor's behalf | §6 recurring cadence |
| `PENDING-OWNER-RTO` | The recovery time objective — how long a restore may take before it costs Taylor more than it saves. | Owner, on Taylor's behalf, informed by the measured duration in §7 | Closing the recovery objectives in `BACKUP_POLICY.md` §6 |

`PENDING-OWNER-RTO` is listed here rather than in the backup policy on purpose:
it is the one recovery objective that cannot honestly be set before this
procedure has been run once and produced a real number.

---

## 9. Executing this is an Owner-authorized action

This document is complete as a procedure. Running it requires all of:

- an Owner decision on `PENDING-OWNER-TARGET`;
- a named human operator with production authorization;
- explicit Owner authorization for the read-only production queries in Step 3.

The Customer 1 automation harness holds none of these and cannot grant itself
any of them. `C1-RECOVERY-01` stays open until a completed §7 evidence record
with outcome PASSED exists.
