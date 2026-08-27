# The live Scheduling Functional Gate — first run, and what it found

Status: **First run 29/32, 2026-08-27 — two backend defects, recorded as ND-24. Owner ratified the
correction the same day; the fix is in this commit. The sandbox redeploy and the gate rerun happen
AFTER this merges**, in that order, and this line is updated with the result rather than in advance
of it. What follows is the original finding, kept intact — the record of what a live gate caught that
three green test lanes did not is worth more than a tidy summary of it.

Tool: [`scripts/schedulingFunctionalGate.mjs`](../../scripts/schedulingFunctionalGate.mjs).
Preconditions verified before the run: the eight Scheduling callables are `ACTIVE` on `nodejs22` in
`eos-platform-sandbox` (`scripts/verifySandboxFunctions.mjs`).

## Why a live gate had to exist before the North Star composition

The Dispatch & Scheduler handoff made passing this gate a precondition of the Dispatch North Star
build, on the grounds that **deployed is not certified**. That distinction turned out to be
load-bearing rather than procedural.

Three separate things were already true and none of them was this:

| Already true | What it proves | What it does not |
|---|---|---|
| `schedulingCommandsEmulator.test.mjs` (19) + `schedulingAvailabilityEmulator.test.mjs` (15) | the commands are correct against a local Firestore | nothing about the deployed estate |
| `verifySandboxFunctions.mjs` | the callables exist, are ACTIVE, run nodejs22 | nothing about what they do |
| `technicianAvailabilityRules.test.js` (77) | the Rules *source* is correct | nothing about the Rules that are *live* |

What none of them asks is the only question a dispatcher cares about: **when a real dispatcher's ID
token asks the deployed system to place a job, does it place it, and does it refuse what it should?**

The gate asks exactly that, and the answer is: mostly yes, with a hole.

## What passed — 29 checks

- **The trusted read path works, and it is honest about what it does not know.** 24 technicians
  returned; the 20 with no recorded working schedule came back `workingAvailability: null` and
  `availableMinutes: null`, not `0`. The single most consequential rule in this domain survives the
  trip through deployment.
- **The Rules are live, not merely authored.** A dispatcher's own ID token gets `403
  PERMISSION_DENIED` reading `technician_working_availability` and `technician_blocked_time`
  directly. Both collections are closed to clients in the running estate, which is what makes the
  trusted read path the only way a board can see availability.
- **Authorization holds on both sides.** A technician persona is refused the availability read and
  refused `rescheduleWorkOrder`.
- **The full placement cycle commits and is visible afterward.** Schedule → Reschedule → Reassign →
  Unschedule, each read back from the committed document rather than from the command's own response.
- **Refusals refuse, and refusals are inert.** Overlap on the same technician refuses; a reschedule
  into blocked time refuses; and the refused reschedule left the *prior* window committed — the
  property the board depends on to render committed truth after a refusal.
- **The working-hours warning is a warning.** A 02:00 local placement **succeeded** and returned
  `OUTSIDE_WORKING_HOURS`. It was not silently upgraded to a refusal, which is what would make the
  system refuse real emergency work.
- **`Unschedule` is narrow and it is a delete.** `SCHEDULED → READY_TO_DISPATCH` commits; the
  scheduling fields are **absent** afterward rather than blanked (the H20-defect-in-a-different-costume
  guard); a second `Unschedule` refuses; and `MarkReady` is refused from `SCHEDULED` — `ACTION_ALLOWED_FROM`
  is doing its job in the deployed build.
- **Eligibility is real.** Reassigning onto a technician with no governed status refused
  `TECHNICIAN_INELIGIBLE`.

## What failed — the two defects

Both have one root cause, and it is worth stating before the symptoms.

> **The Scheduling domain has two placement entry points, and only one of them enforces the
> collision policy.**

`transitionWorkOrder` action `Schedule` is the *initial* placement path. It shipped before this
domain existed and it validates exactly one condition: overlap, via `findScheduleConflict`.

`rescheduleWorkOrder` / `reassignScheduledWorkOrder` are the *change* paths added by PR #1549. They
validate through `checkPlacement`, which is the full ND-20 table: past start, eligibility, blocked
time, overlap, and the working-hours warning.

ND-20's collision table is written as a property of **the domain**, not of one entry point. So the
policy currently depends on which button a dispatcher pressed.

### SCHED-D1 — a Work Order can be Scheduled to start in the past

| Path | `now − 3h` window | Governed outcome |
|---|---|---|
| `rescheduleWorkOrderCallable` | refuses `START_IN_PAST` | ✅ matches ND-20 |
| `transitionWorkOrder` / `Schedule` | **HTTP 200, committed** | ❌ |

Gate checks `E1`, and `E2` as its consequence — `E2` asserts that a refused placement leaves the
Work Order untouched, and it fails only because `E1` was not refused at all.

### SCHED-D2 — a Work Order can be Scheduled into a technician's blocked time

| Path | window inside a `TRAINING` block | Governed outcome |
|---|---|---|
| `rescheduleWorkOrderCallable` | refuses `BLOCKED_TIME_CONFLICT` | ✅ matches ND-20 |
| `transitionWorkOrder` / `Schedule` | **HTTP 200, committed** | ❌ |

Gate check `H4b`. The blocked time was created through
`createTechnicianBlockedTimeCallable` and confirmed visible through the trusted read
(`H2`) in the same run, so the record the check placed work into demonstrably existed.

By the same reading, `TECHNICIAN_INELIGIBLE` is also unenforced on the Schedule path. The gate
proves eligibility refuses on reassignment (`J4`) and does not currently probe it on Schedule; it is
listed here because it falls out of the same root cause and should be closed by the same fix rather
than discovered separately later.

### This is not a judgement call about product policy

It would be reasonable to ask whether narrowing `Schedule` changes what the business may do, and
therefore whether this is a named product decision rather than a defect. Two things settle it:

1. **ND-20 already ruled on the question**, on 2026-08-27, for the Scheduling domain. The defect is
   that the ruling was implemented on one path and not the other — completing a decision is not
   making a new one.
2. **The code already asserts the symmetry that is missing.** `checkPlacement`'s own comment reads:
   *"The SAME query and the SAME pure overlap function Schedule uses, so a window this command
   accepts is one Schedule would have accepted and vice versa."* That claim is true for overlap and
   **false in the reverse direction** for past start, blocked time and eligibility. The gate did not
   discover a disagreement about policy; it discovered an invariant the source states and does not hold.

What *is* a decision — and why ND-24 exists rather than a merged fix — is the blast radius. Closing
this changes the behavior of `transitionWorkOrder`, the most sensitive transaction in the platform,
and requires a Functions deploy. That is an Owner boundary, not an implementation detail.

## How it was closed

The Owner ratified the correction on 2026-08-27, and directed its shape as well as its direction:
**do not implement a second copy of the validation table inside `transitionWorkOrder` — find the
shared validation and make the existing path consume it.**

That instruction turned out to name the actual defect rather than merely a preference for tidiness.
Nobody had written a disagreeing policy. `checkPlacement` was a *private function inside*
`schedulingCommands.ts`, which made it reachable only by the callers that happened to live in that
module — and the Schedule transition did not. The policy and the path that needed it were each
correct and were never introduced to each other.

So the policy moved into its own module, `functions/src/scheduling/placementPolicy.ts`, and both
placement paths import and call it. The sanitized error table moved to
`scheduling/errorMapping.ts` for the same reason: `transitionWorkOrder` now raises those refusals and
must not import a module whose top level defines seven `onCall` handlers to reach an error table.

Two guards keep it closed. `test/e2e/schedulingPlacementSymmetryEmulator.test.mjs` (12) puts each
condition to **both** paths and compares their outcomes *to each other* rather than to a hardcoded
expectation — the shape the defect actually had. `test/schedulingPlacementAuthorityContract.test.mjs`
(10) reads the source and fails if a second definition of the policy appears, if a placement path
stops calling it, if one starts raising a refusal the policy owns, or if `Schedule` computes the
ND-20 warnings and discards them. That last check earned its place immediately: it caught a silent
no-op in the fix itself, where the warnings were computed and never returned.

**What the fix narrowed, stated plainly.** Placement now requires a governed `fieldops_technicians`
record. Two pre-existing emulator suites began failing because their fixtures seeded a technician
*persona* without one and then scheduled onto it; `testKit.mjs`'s own comment had described that
asymmetry as deliberate, and it was not — it was this defect, documented as a feature. Fixtures
corrected, comment rewritten.

**Rerun: pending the sandbox redeploy of `transitionWorkOrder`.** `E1`, `E2` and `H4b` are the three
checks that must flip, and 32/32 is the bar. Recorded here when it is run, not before.

## Consequence for the Dispatch North Star

**The composition remains stopped — now on ND-23 alone.** The Scheduling authority is certified; the
*Dispatch and Schedule North Star P1v1* artifact has still not been transferred into the repository.

The original two reasons, for the record:

1. ~~**This gate has not passed.**~~ **Closed.** The reason it blocked was not
   procedural: a board that draws blocked time as unschedulable, while the Schedule button places
   work into it anyway, is a board that lies to a dispatcher about the system behind it. Building
   that composition before the fix would bake the inconsistency into the UI's own vocabulary.
2. **ND-23 stands open — and still does.** The *Dispatch and Schedule North Star P1v1* artifact is not in this
   repository and was not locatable. See the [open decisions](./north-star-open-product-decisions.md).

## Reproducing

```bash
node scripts/verifySandboxFunctions.mjs --project eos-platform-sandbox \
  rescheduleWorkOrderCallable reassignScheduledWorkOrderCallable readTechnicianAvailabilityCallable \
  setWorkOrderEstimatedDurationCallable setTechnicianWorkingAvailabilityCallable \
  createTechnicianBlockedTimeCallable deleteTechnicianBlockedTimeCallable transitionWorkOrder
```

```bash
node scripts/schedulingFunctionalGate.mjs --confirm-project eos-platform-sandbox --json gate.json
```

The gate mutates sandbox data through governed commands only and restores what it borrows: the Work
Order it schedules is returned to the queue by the `Unschedule` it is testing, and the blocked time
it creates is removed by the `delete` it is testing. Restoration is part of the evidence. A run was
verified afterward to leave no placement inside its own working window and no blocked-time record.

Its pure helpers are covered by `scripts/schedulingFunctionalGate.test.mjs` (11) in the
`Dispatch Scheduling Domain Tests` workflow. The gate itself cannot run in CI — it needs persona
credentials and a live estate — and that limit is recorded rather than worked around.
