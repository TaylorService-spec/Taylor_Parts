# Customer 1 — Cutover Runbook

Status: **DRAFT PROCEDURE. Not an authorization, not a schedule, not a
commitment to a date.** Nothing in this file authorizes a production action.
The only thing that authorizes cutover is the Owner closing `C1-OWNER-01`
(`automaticTransitionAllowed: false`).

Gate: `C1-CUTOVER-01` — Cutover rehearsal and authorization package.
Prerequisite state: `docs/customer-1/cutover/PREREQUISITE_MATRIX.md`
(generated from `docs/customer-1/CUSTOMER_1_LEDGER.json`).

Structural check: `node docs/customer-1/cutover/runbook-check.mjs`

## How to read a step

Every step names four things, and a step is not runnable until all four are
real:

- **Owner** — the single named human accountable for the step. A role marked
  `UNDESIGNATED` is a blocker, not a placeholder to fill in on the day.
- **Precondition** — what must be true before the step begins.
- **Verification** — the observable that proves the step succeeded. "It ran
  without error" is never a verification.
- **Rollback** — what is done if verification fails.

Roles referenced:

| Role | Party | Designated? |
| --- | --- | --- |
| Verenward release engineer | Verenward | yes (Verenward staffing) |
| Owner | Verenward | yes |
| Taylor cutover lead | Taylor | **UNDESIGNATED** |
| Taylor inventory authority | Taylor | **UNDESIGNATED** |
| Taylor administrator (EOS) | Taylor | **UNDESIGNATED** |
| Taylor source-system owner | Taylor | **UNDESIGNATED** |

Undesignated Taylor roles are recorded as a `BLOCKED_TAYLOR` blocker by this
lane. This lane does not name individuals and does not invent a Taylor
org chart.

---

## Phase 0 — Authorization

### G-STEP-01 — Confirm launch-critical readiness from the ledger

- **Owner:** Verenward release engineer
- **Precondition:** `CUSTOMER_1_LEDGER.json` reconciled within the current week.
- **Verification:** `node docs/customer-1/cutover/prerequisite-matrix.mjs`
  exits 0 and the regenerated matrix reports `Not yet READY: 0`.
- **Rollback:** None required — this step changes nothing. A non-zero count
  ends the cutover attempt here.

### G-STEP-02 — Owner go/no-go

- **Owner:** Owner (sole authority; no delegate, no standing approval)
- **Precondition:** G-STEP-01 shows every launch-critical gate READY, and the
  authorization package index has been read.
- **Verification:** `C1-OWNER-01` is transitioned in the ledger by the Owner,
  with the reviewed release SHA recorded in its evidence.
- **Rollback:** No-go ends the attempt. Nothing downstream has run yet, so
  there is nothing to undo. This is the cheapest place to stop and the
  intended one.

**No step below may begin before G-STEP-02 has closed `C1-OWNER-01`.**

---

## Phase 1 — Freeze and final export

### G-STEP-03 — Freeze the source systems

- **Owner:** Taylor source-system owner (**UNDESIGNATED**)
- **Precondition:** `C1-OWNER-01` closed; Taylor staff notified that source
  systems are read-only from this moment; freeze start time recorded.
- **Verification:** A named Taylor witness confirms no writes are possible in
  each source system, recorded per system with a timestamp.
- **Rollback:** Lift the freeze and return to normal source-system operation.
  This is fully reversible and remains so until G-STEP-06.

### G-STEP-04 — Take the final exports

- **Owner:** Taylor source-system owner (**UNDESIGNATED**), assisted by the
  Verenward release engineer
- **Precondition:** Freeze confirmed in G-STEP-03; export procedure is the
  same one exercised in rehearsal.
- **Verification:** Every source system in the accepted `C1-DATA-01` inventory
  produced an export; control totals (record counts and any monetary or
  quantity sums defined in the migration mapping) are captured and stored with
  the export.
- **Rollback:** Discard the export set and re-export. Exports are reads; a bad
  export costs time, not data.

### G-STEP-05 — Verify export integrity before loading anything

- **Owner:** Verenward release engineer
- **Precondition:** Export set complete with control totals from G-STEP-04.
- **Verification:** Each export's control totals match the source system's own
  reported totals, and the export parses cleanly against the accepted
  migration mapping. Mismatches are itemized, not summarized.
- **Rollback:** Return to G-STEP-04. Do not proceed with a partially verified
  export set — a mismatch found here is cheap, and the same mismatch found
  after G-STEP-06 is not.

---

## Phase 2 — Migration

### G-STEP-06 — Load migrated data into production

- **Owner:** Verenward release engineer
- **Precondition:** G-STEP-05 clean; production backup taken and its restore
  verified under `C1-RECOVERY-01`; the restore point is recorded by identifier,
  not by description.
- **Verification:** The load reports per-tier record counts that match the
  export control totals from G-STEP-04, with every rejected record itemized.
- **Rollback:** Restore production from the pre-load restore point recorded in
  the precondition. **This is the first step of the cutover that is not
  free to undo:** rollback here costs a restore and re-runs Phase 1.

### G-STEP-07 — Reconcile migrated data

- **Owner:** Verenward release engineer, with the Taylor cutover lead
  (**UNDESIGNATED**) accepting
- **Precondition:** G-STEP-06 load complete.
- **Verification:** Reconciliation report shows, per migration tier, source
  total, loaded total, difference, and a named disposition for every
  difference. Zero unexplained differences.
- **Rollback:** Restore to the G-STEP-06 restore point; correct the mapping;
  re-run from G-STEP-04.

### G-STEP-08 — Accept opening inventory

- **Owner:** Taylor inventory authority (**UNDESIGNATED**)
- **Precondition:** G-STEP-07 reconciled; `C1-INV-01` baseline is the one
  Taylor accepted, not one derived during cutover.
- **Verification:** Taylor records acceptance of opening warehouse, bin, truck,
  and serialized inventory against that baseline. Verenward does not accept
  inventory on Taylor's behalf.
- **Rollback:** Non-acceptance returns to G-STEP-07 reconciliation, or invokes
  the fallback decision at G-STEP-13.

---

## Phase 3 — Activation

### G-STEP-09 — Activate production identities

- **Owner:** Verenward release engineer, with the Taylor administrator
  (**UNDESIGNATED**) confirming the roster
- **Precondition:** `C1-IDENTITY-01` roster reconciled; each Day-1 persona's
  intended least-privilege role recorded before activation, not after.
- **Verification:** Every activated principal resolves to exactly its recorded
  role set, and no principal resolves to a role outside it. Verified by
  querying the authority resolver, never by reading role source files.
- **Rollback:** Deactivate the affected principals. Identity activation is
  reversible; over-granted authority observed in production is a stop, not a
  finding to note and continue past.

### G-STEP-10 — Confirm Taylor administrative self-service

- **Owner:** Taylor administrator (**UNDESIGNATED**)
- **Precondition:** G-STEP-09 complete; `C1-ADMIN-01` scope of ordinary Day-1
  administration accepted.
- **Verification:** The Taylor administrator performs one ordinary
  administrative action from each accepted `C1-ADMIN-01` category without
  Verenward engineering, CLI access, or direct database edits.
- **Rollback:** None needed for the check itself. Failure here means Taylor
  cannot run its own system on Day 1 and feeds the G-STEP-13 decision.

---

## Phase 4 — Verification in production

### G-STEP-11 — First-hour smoke tests

- **Owner:** Verenward release engineer, with Taylor operators executing the
  business steps
- **Precondition:** Phase 3 complete; the smoke-test plan (separate document,
  not yet written — see "What this runbook does not yet cover") is the one
  rehearsed, not improvised.
- **Verification:** Every smoke test in the plan passes, with the failing ones
  named individually. A partial pass is a failure.
- **Rollback:** Failures are triaged against the fallback plan's severity
  definitions and feed the G-STEP-13 decision.

### G-STEP-12 — Support and escalation live

- **Owner:** Verenward release engineer, with the Taylor cutover lead
  (**UNDESIGNATED**)
- **Precondition:** `C1-SUPPORT-01` intake, severity definitions, and hours are
  operational and, where required, contracted.
- **Verification:** A test ticket is raised through official intake and
  acknowledged within the contracted response expectation for its severity.
- **Rollback:** Support not reachable means Taylor is operating without a
  route to help; treat as a G-STEP-13 input.

---

## Phase 5 — Decision and signoff

### G-STEP-13 — Fallback decision point

- **Owner:** Owner, on the recommendation of the Verenward release engineer and
  the Taylor cutover lead (**UNDESIGNATED**)
- **Precondition:** Phases 1–4 executed, with every failure from G-STEP-06
  onward itemized.
- **Verification:** An explicit recorded decision — CONTINUE, HOLD, or FALL
  BACK — with the reason and the evidence it rests on. Absence of a decision is
  not CONTINUE.
- **Rollback:** FALL BACK invokes the fallback plan: production restored to the
  G-STEP-06 restore point, source-system freeze lifted, Taylor returned to
  pre-cutover operation under `C1-CONTINUITY-01` procedures.

### G-STEP-14 — Taylor operational signoff

- **Owner:** Taylor cutover lead (**UNDESIGNATED**)
- **Precondition:** G-STEP-13 decision is CONTINUE.
- **Verification:** Taylor records acceptance that EOS is its system of record
  for the Day-1 scope defined in `C1-SCOPE-01`. Verenward does not record this
  on Taylor's behalf, and readiness evidence is not a substitute for it.
- **Rollback:** Withheld signoff returns to G-STEP-13. After this point,
  reversal is a business decision under `C1-CONTINUITY-01`, not a runbook step.

### G-STEP-15 — Close the cutover record

- **Owner:** Verenward release engineer
- **Precondition:** G-STEP-14 signoff recorded.
- **Verification:** `C1-CUTOVER-01` evidence carries the executed runbook, the
  reconciliation report, the smoke-test results, the G-STEP-13 decision, and
  the signoff, each by identifier. The ledger is reconciled and the matrix
  regenerated.
- **Rollback:** None — this step records what happened. It does not change
  production.

---

## What this runbook does not yet cover

These are named here so their absence is visible rather than assumed:

1. **Smoke-test plan** — the concrete first-hour test list referenced by
   G-STEP-11.
2. **Fallback plan** — the severity definitions and the restore procedure
   referenced by G-STEP-13.
3. **Authorization package index** — the document the Owner reads at G-STEP-02.

The rehearsal plan now exists at
`docs/customer-1/cutover/REHEARSAL_PLAN.md`; it classifies every step above as
rehearsable, partially rehearsable, or not rehearsable at all.

Until those exist, `C1-CUTOVER-01` is not closable: its `closeWhen` requires
rehearsal, smoke tests, and fallback to be rehearsed and packaged, not merely
sequenced.
