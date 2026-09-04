# Customer 1 — Cutover Rehearsal Plan

Status: **DRAFT PROCEDURE. Not an authorization.** Nothing here authorizes a
production action. Rehearsal is deliberately non-destructive: no step in this
plan writes to production, activates a production identity, or freezes a Taylor
source system for real.

Gate: `C1-CUTOVER-01`. Companion documents:
`docs/customer-1/cutover/RUNBOOK.md` (the sequence being rehearsed) and
`docs/customer-1/cutover/PREREQUISITE_MATRIX.md` (generated gate state).

Structural check: `node docs/customer-1/cutover/rehearsal-check.mjs`

## The honest premise

A cutover rehearsal cannot prove the cutover. Some steps only exist in
production, and rehearsing them elsewhere proves the procedure is writable, not
that it works. This plan therefore classifies every runbook step into one of
three buckets and refuses to blur them:

- **REHEARSABLE** — can be exercised end to end outside production, and passing
  the rehearsal is real evidence about the step.
- **PARTIAL** — the mechanism can be exercised outside production, but the
  production-specific part (real data volume, real identities, real source
  systems) cannot. Passing proves the mechanism, not the outcome.
- **NOT_REHEARSABLE** — happens only in production or only by a human authority
  decision. Rehearsal can prepare for it and cannot substitute for it.

A step marked PARTIAL that is reported as "rehearsed" is exactly the drift this
classification exists to prevent.

## Rehearsal environment

Rehearsal runs against the sandbox project and a rehearsal export set, never
against Taylor production and never against a service-account key held by this
lane. Where a step needs Taylor source data, rehearsal uses the accepted
`C1-DATA-01` rehearsal extract, not a live pull.

The rehearsal produces a dated rehearsal record naming: the release SHA
rehearsed, the environment, the export set identifier, each step's bucket, and
each step's observed result. A rehearsal without that record did not happen.

## Step classification

| Step | Runbook title | Bucket | What rehearsal actually proves | What it cannot prove |
| --- | --- | --- | --- | --- |
| G-STEP-01 | Confirm launch-critical readiness from the ledger | REHEARSABLE | The matrix generator runs and reports the real not-yet-READY count. | Nothing outstanding — this step is identical in rehearsal and cutover. |
| G-STEP-02 | Owner go/no-go | NOT_REHEARSABLE | — | The Owner's decision. It is an authority act, not a procedure, and is never simulated. |
| G-STEP-03 | Freeze the source systems | PARTIAL | That a freeze procedure exists per source system and a witness step is defined. | That Taylor's real source systems can be frozen, and how long the freeze window actually is. |
| G-STEP-04 | Take the final exports | PARTIAL | The export procedure runs and produces control totals in the expected shape. | Real final-export volume, duration, and the totals that will exist on the day. |
| G-STEP-05 | Verify export integrity before loading anything | REHEARSABLE | The integrity comparison detects a mismatch — rehearsal must include one deliberately corrupted export and observe the check fail. | Nothing outstanding, provided the negative case is exercised. |
| G-STEP-06 | Load migrated data into production | PARTIAL | The load runs against sandbox, reports per-tier counts, and itemizes rejects. | The production load. Also unproven unless separately exercised: that the pre-load restore point restores (that belongs to `C1-RECOVERY-01`, not to this rehearsal). |
| G-STEP-07 | Reconcile migrated data | PARTIAL | The reconciliation report renders source, loaded, difference, and disposition per tier. | That production differences are zero, and Taylor's acceptance of the dispositions. |
| G-STEP-08 | Accept opening inventory | NOT_REHEARSABLE | — | Taylor's acceptance. Verenward cannot accept inventory on Taylor's behalf in rehearsal any more than on the day. |
| G-STEP-09 | Activate production identities | PARTIAL | That activation resolves each sandbox principal to exactly its recorded role set, queried from the authority resolver. | Production identity behavior. Production currently carries almost no governed role data (`C1-SECURITY-01` evidence), so sandbox parity here is weak evidence. |
| G-STEP-10 | Confirm Taylor administrative self-service | PARTIAL | That each accepted `C1-ADMIN-01` category is performable in sandbox without engineering. | That a designated Taylor administrator — currently UNDESIGNATED — can do it in production. |
| G-STEP-11 | First-hour smoke tests | PARTIAL | That every smoke test in the plan is executable and passes in sandbox. | Production behavior, real users, and real load. Requires the smoke-test plan, which does not yet exist. |
| G-STEP-12 | Support and escalation live | PARTIAL | That a test ticket traverses official intake and is acknowledged. | Contracted response expectations, which depend on `C1-SUPPORT-01`. |
| G-STEP-13 | Fallback decision point | NOT_REHEARSABLE | — | The decision. Rehearsal may exercise the *inputs* — a dry-run severity triage over the rehearsal's own failures — but the decision itself is the Owner's. |
| G-STEP-14 | Taylor operational signoff | NOT_REHEARSABLE | — | Taylor's acceptance. |
| G-STEP-15 | Close the cutover record | REHEARSABLE | That the rehearsal record itself is assembled by identifier and the matrix regenerates. | Nothing outstanding. |

## Exit criteria for a rehearsal

A rehearsal is complete when, and only when:

1. Every REHEARSABLE step passed, including the deliberate G-STEP-05 negative
   case.
2. Every PARTIAL step ran its mechanism and its unproven remainder is restated
   in the rehearsal record — not dropped because the mechanism worked.
3. Every NOT_REHEARSABLE step is listed as outstanding with its named authority.
4. The rehearsal was repeated at least once end to end from a clean start, since
   `C1-DATA-01` requires a *repeatable* rehearsal and a single successful pass
   does not establish repeatability.

Rehearsal completion is not cutover readiness. It is one of the four artifacts
`C1-CUTOVER-01` needs; the smoke-test plan, the fallback plan, and the
authorization package index remain outstanding.

## Known blockers this plan surfaces

- Four Taylor roles referenced by rehearsed steps are UNDESIGNATED
  (`RUNBOOK.md` role table). Steps G-STEP-03, G-STEP-08, G-STEP-10, and
  G-STEP-14 cannot be rehearsed with their real owner until designation.
- G-STEP-11 cannot be rehearsed at all until the smoke-test plan exists.
- G-STEP-06's rollback depends on a tested restore, which is `C1-RECOVERY-01`
  and is currently OPEN. Rehearsing the load without a proven restore rehearses
  the half of the step that is cheap to undo.
