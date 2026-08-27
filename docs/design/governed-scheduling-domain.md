# The governed Scheduling domain

Status: **Implemented, DEPLOYED to the sandbox, and CERTIFIED.** The eight callables are `ACTIVE` on
`nodejs22` in `eos-platform-sandbox`, both Rules blocks are live (a client ID token gets `403` on
either collection), and the live Scheduling Functional Gate passes **32/32** — see
[`scheduling-functional-gate-findings.md`](./scheduling-functional-gate-findings.md).

**ND-24 is closed.** The gate found the collision policy enforced by the *change* paths and not by
the initial `Schedule` path. Both placement entry points now run the same policy, out of the same
module — [`placementPolicy.ts`](../../functions/src/scheduling/placementPolicy.ts). Built from the
Dispatch & Scheduler handoff
(2026-08-27) and the six decisions it produced (ND-18 – ND-23, recorded in
[`north-star-open-product-decisions.md`](./north-star-open-product-decisions.md)). The
reconnaissance that preceded it is
[`dispatch-scheduling-authority-map.md`](./dispatch-scheduling-authority-map.md).

## What this adds, and what it deliberately does not

The handoff's premise was that EOS could not truthfully schedule. Reconnaissance found that it
largely could: `Schedule` was deployed and governed, overlap detection already refused inside the
transaction behind a per-technician lock, and reassignment already required a reason and wrote its
own Audit Event. What was actually missing divided into two halves — a way to **change** a placement,
and any notion of when a technician is **available** at all.

So this adds:

| Missing | Added as |
|---|---|
| Re-time a scheduled job | `rescheduleWorkOrder` — a trusted callable, status unchanged (ND-19) |
| Move a scheduled job to another technician | `reassignScheduledWorkOrder` — same, window taken from the record |
| Return a scheduled job to the queue | `Unschedule` — a lifecycle **transition** (ND-18) |
| Recurring technician working hours | `technician_working_availability` (ND-22) |
| Dated absences | `technician_blocked_time` (ND-22) |
| A planning estimate | `estimatedDurationMinutes` (ND-21) |
| A way for the board to see any of it | `readTechnicianAvailability` — trusted read projection |

And deliberately does not add: a second Work Order state machine, a second audit system, a second
conflict rule, an eligibility engine, a route optimizer, or any notification pipeline.

## The one structural decision worth reading twice

**Re-timing is not a transition. Un-scheduling is.**

`transitionEngine.ts` already said as much before this work began: `scheduledStart`, `scheduledEnd`
and `scheduledTechId` are *Planning (mutable)* fields, explicitly excluded from
`ACTION_TIMESTAMP_FIELD` because they hold a dispatcher's chosen future window rather than the
instant something happened. Moving a job from Tuesday to Wednesday changes the plan; nothing has
happened to the job. So reschedule and reassign sit **beside** the state machine and never touch its
table.

Un-scheduling is different, and the Owner's reasoning is the load-bearing part: returning a job to
the Ready queue genuinely changes its **operational readiness**. That belongs in the lifecycle. So
`SCHEDULED → READY_TO_DISPATCH` was added to `TRANSITIONS` — the first reverse edge in ADR-002 — and
it exists at exactly that one place.

### The defect that decision nearly created

`MarkReady` also targets `READY_TO_DISPATCH`. `getAllowedActions` filtered on the transition edge
alone, so admitting `SCHEDULED → READY_TO_DISPATCH` would have silently made **MarkReady legal from
SCHEDULED** — a second way to un-schedule a job, with no reason and no Audit Event, created as a side
effect of allowing the first one.

That is why a third table exists. `ACTION_ALLOWED_FROM` says `MarkReady: ["CREATED"]` and
`Unschedule: ["SCHEDULED"]`, and both the server and the client mirror consult it. It is part of the
contract now, and `workOrderWorkflowMirrorContract.test.mjs` parses it out of the server source and
enforces the mirror, the same way it already did for the other two tables.

## Availability

Two collections, because they are two different things (ND-22).

**`technician_working_availability/{technicianId}`** — the document id *is* the technician id, so a
technician cannot have two schedules that disagree. Hours are stored as **local wall-clock strings**
(`"07:00"`–`"16:00"`) plus an IANA `timeZone`, and resolved through `Intl` rather than a stored UTC
offset. A stored offset is correct for half the year: it would shift every technician's working day
by an hour each March and November without anyone editing a record.

A weekday may carry several intervals. That is how an unpaid lunch is expressed —
`07:00–12:00` and `13:00–16:00` leaves a real gap at noon — without inventing a second record type.

**`technician_blocked_time/{blockId}`** — a single dated absolute window with a closed `kind`
vocabulary (`PTO`, `LUNCH`, `TRAINING`, `MEETING`, `TRUCK_SERVICE`, `UNAVAILABLE`,
`COMPANY_CLOSURE`). No recurrence rule, on purpose: a recurring absence is a gap in `weeklyHours`,
and everything else genuinely happens once. An open string field here would become seven spellings of
"vacation" within a month.

### Absent is not empty

The single most consequential rule in this domain. A technician with **no** availability record has an
**unrecorded** schedule, not a zero-hour one. Collapsing the two would make every technician look
permanently off-shift on the day these collections ship and nobody has filled them in yet.

So `assessWorkingHours(null, …)` returns `NO_WORKING_AVAILABILITY_RECORDED` (a warning), never
`OUTSIDE_WORKING_HOURS`. And `availableMinutesInWindow(null, …)` returns **null**, not 0 — percent
booked over an unknown denominator is unanswerable, and a board rendering it as 0% would be reporting
a fact about our data entry as though it were a fact about the business.

## Collision policy (ND-20)

| Condition | Outcome |
|---|---|
| Same technician, overlapping window | **REFUSE** |
| Blocked time | **REFUSE** |
| Start in the past (60s clock-skew tolerance) | **REFUSE** |
| Ineligible technician | **REFUSE** |
| Outside recorded working hours | **WARN** — returned on a successful response |
| No working hours recorded | **WARN** |

Working hours warn rather than refuse because field service legitimately schedules emergency work at
02:00. A system that refused would be refusing real business.

**This table has no per-path column, and that is the point (ND-24).** It briefly had one. ND-20
decided the policy for the *domain*, but it shipped implemented as a private function inside
`schedulingCommands.ts` — reachable only by the callers that happened to live in that module. The
initial `Schedule` transition did not, and went on validating overlap alone. The live gate found the
result: a dispatcher could Schedule into the past or into a technician's PTO and be refused for the
identical window on Reschedule.

The policy now lives in its own module, `scheduling/placementPolicy.ts`, and **every placement path
imports it**. Not a shared copy of the table — the function itself, so the paths cannot drift.
`test/schedulingPlacementAuthorityContract.test.mjs` reads the source and fails if a second
definition appears, if a path stops calling it, or if a path starts raising a refusal the policy
owns; `test/e2e/schedulingPlacementSymmetryEmulator.test.mjs` puts each condition to both paths and
compares their outcomes to each other rather than to a hardcoded expectation.

Nobody wrote a disagreeing policy. The policy and the path that needed it were each correct and were
never introduced to each other — which is why the fix is structural and not a patch.

**"Ineligible" means what this repository can actually see.** There is no skill, certification or
territory model here, so eligibility is: a governed technician record exists and carries a recognised
`TECH_STATUS`. Inventing more would be inventing business policy. When a real eligibility authority
exists it belongs on that one line in `checkPlacement` and nowhere else — and since ND-24 that is
literally one line, reached by every placement path, rather than one per entry point.

Blocked time is **not** checked against existing scheduled work when it is recorded. Someone going on
PTO must never be refused because a job was already placed there — the absence is the fact and the
placement is the problem. The board surfaces the collision; a person decides.

## Historical integrity

The handoff's rule was: current state may change, history may not. Each command carries the **prior**
facts into its Audit Event, staged in the same transaction as the write, because after the write the
document no longer knows them.

- `rescheduleWorkOrder` / `reassignScheduledWorkOrder` record the prior technician and window.
- `Unschedule` records them too — and it must, because it *deletes* them from the document.

The `rescheduledFrom*` fields on the Work Order are a **denormalized snapshot for board display**,
exactly like the existing `reassigned*` block. A second reschedule overwrites them. They are the
latest change, never the history, and any surface reading them has to say so. The append-only record
is `auditEvents`.

`Unschedule` deletes the scheduling fields rather than blanking them. A lingering empty-string
`scheduledTechId` would keep the Work Order inside `findScheduleConflict`'s equality query and
silently reserve a technician's time for a job that is no longer placed — the H20 defect in a
different costume.

## What the emulator suite found

Two defects, both in the seam between the commands and their callers, and neither visible to the pure
tests because neither is arithmetic.

**Contention was being reported as a fault.** These commands funnel every schedule-touching write for
one technician through a single sentinel document — they contend *by design*. When a transaction lost
that race, Firestore raised gRPC `10 ABORTED` and `mapError` collapsed it, along with everything else
it did not recognise, into `internal`. That is a 500: it tells a dispatcher the system is broken when
the truthful answer is "somebody else was moving this, try again". One of those is a bug report and
the other is a button press. Contention codes (`4`, `10`, `14`) now map to `aborted` and reuse the
`STALE_WORK_ORDER` code, because from the caller's side a lost race and a stale board are the same
situation with the same remedy. Genuinely unrecognised errors still collapse to `internal` — the
sanitization posture is unchanged, only the classification is corrected.

**A sanitized failure left no trace of itself.** The same collapse meant the original symptom was an
unexplainable "The request could not be completed." with nothing logged anywhere. The callables now
log the raw error server-side *before* sanitizing. The client still learns nothing it should not; the
server log keeps what an operator needs. Recognised refusals are not logged — they are ordinary
outcomes, not faults.

Alongside those, `maxAttempts` was raised from Firestore's default of 5 to 10 for the scheduling
transactions. Part of that is an emulator artifact and it is worth saying so: the emulator's lock
manager is coarser than production Firestore, which locks the documents a transactional query returns
rather than a broader range. But the underlying fact holds in both places — a design that deliberately
serializes on one document per technician should retry more than one that does not.

## What is not covered yet, stated plainly

- ~~The transactional commands have no automated tests.~~ **Closed.** They are exercised end to end
  against a real Firestore emulator through the existing harness (`functions/test/e2e/`):
  `schedulingCommandsEmulator.test.mjs` (19) and `schedulingAvailabilityEmulator.test.mjs` (15),
  alongside the pure suites `schedulingAvailabilityModel.test.mjs` (30) and the ND-18 block in
  `transitionEngine.test.mjs` (6). The client-direct Rules boundary is
  `functions/test/technicianAvailabilityRules.test.js` (77) in the Rules regression lane — deliberately
  separate, because the callables run on the Admin SDK and the Admin SDK bypasses Rules by design, so
  a "a client cannot read this" assertion made through the callable harness would prove nothing.
- ~~**Nothing is deployed.**~~ **Closed.** All eight callables are ACTIVE on nodejs22 in `eos-platform-sandbox`, verified read-only through `scripts/verifySandboxFunctions.mjs`.
- ~~**The Rules blocks are authored, not live.**~~ **Closed for the sandbox.** A dispatcher ID token now gets `403 PERMISSION_DENIED` reading either collection directly, proved live by gate check `B1`. Production is unchanged and still carries the caveat below.
- **(Original caveat, retained for production.)** `firestore.rules` has no CI deploy in this repository.
  Until `firebase deploy --only firestore:rules` is run, the two new collections are protected only
  by Firestore's undeclared-collection default — which is fail-closed, but is the absence of a
  decision rather than the decision.
- **No North Star composition.** The Dispatch design package is still not in this repository — it was
  searched for again on 2026-08-27, across the delivery folders the Opportunity and Sales Agreement
  packages arrived through and the published-artifact gallery, and was not found (ND-23). The board
  has not been rewired onto any of this, and composition is now blocked by ND-24 as well: a board
  that draws blocked time as unschedulable while the Schedule button places work into it anyway would
  be lying to a dispatcher about the system behind it.
