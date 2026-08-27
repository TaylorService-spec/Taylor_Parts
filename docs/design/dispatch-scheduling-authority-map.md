# Dispatch & Scheduler — current authority map

Status: **RECONNAISSANCE COMPLETE. No code written.** Produced as the required first output of the
Dispatch & Scheduler governed product build (handoff, 2026-08-27), per its own instruction to map
existing authority before creating any.

The headline: **EOS already has more scheduling authority than the handoff assumed, and less
availability authority than the North Star board needs.** Several of the sixteen success conditions
are already met by shipped, deployed code. The rest divide cleanly into work that is
straightforwardly additive and work that cannot start until a named product decision is answered.

---

## Existing

### The Work Order state machine — `functions/src/transitionEngine.ts` (ADR-002)

A pure table lookup. `TRANSITIONS` is strictly forward, plus a `CANCELLED` edge from every
non-terminal status. `COMPLETED → CLOSED` only. There is **no backward edge and no self-edge
anywhere in the table.** Actions — never raw statuses — are the client vocabulary; the server alone
resolves action → status via `ACTION_TO_STATUS`. Mirrored client-side at
`src/domain/workOrderWorkflow.js` for defense-in-depth button gating.

### `Schedule` — already deployed, already governed

`transitionWorkOrder.ts` accepts `Schedule` with `scheduledStart`, `scheduledEnd`, `scheduledTechId`
(all three required, `invalid-argument` otherwise), admin/dispatcher only. Deliberately excluded
from `ACTION_TIMESTAMP_FIELD` because the scheduled window is a *planning* value, not "the instant
the action ran".

### Scheduling conflict detection — already exists

`functions/src/workOrderAvailability.ts`:

- `findScheduleConflict(techId, woId, start, end, others)` — genuine time-window overlap
  (`start < otherEnd && otherStart < end`) against every Work Order carrying the same
  `scheduledTechId` in a schedule-blocking status.
- `findDoubleBookingConflict(techId, woId, others)` — the same technician actively occupied by
  another Work Order in `DISPATCHED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS`.

Both run **inside the transaction**, behind a per-technician lock document (`techLockRef`) taken
before any read, so two concurrent dispatchers cannot both pass the guard.

### Governed reassignment — already exists, riding on `Dispatch`

The H20 fix. When a `Dispatch` call names an `assignedTechId` differing from the Work Order's
`scheduledTechId`, the command **requires a non-empty `reassignReason`**, writes the denormalized
snapshot (`reassignedFromTechId`, `reassignedAt`, `reassignedReason`, `reassignedByUid`), realigns
`scheduledTechId` to the new technician so the board's overlap query stops reserving the original
technician's slot, and stages a dedicated `reassignWorkOrderTechnician` Audit Event **in the same
transaction** as the Work Order write. The handoff's historical-integrity requirement — Bob → Jane,
with Bob retained, the actor, the time, and the reason — is already satisfied for this one path.

### Audit — one authority, already extended for Work Orders

`functions/src/access/auditEventWriter.ts` — `stageAuditEvent` / `stageAuditEventWithId` onto a
caller-supplied transaction, so the business mutation and its audit commit together or not at all.
`AuditAction` already carries `reassignWorkOrderTechnician`. Deterministic audit ids come from
`workOrderTransitionMath.transitionWorkOrderAuditId`.

### Rules — the browser is already not the scheduling authority

`fieldops_wos`: `allow create, update, delete: if false` — unconditional, with an explicit comment
that no admin-UI exception will ever be added. `fieldops_technicians`: admin/dispatcher may update
only a valid `status` enum; technicians hold no write at all (Decision #39).

### The technician model

`fieldops_technicians` carries a **live** `status` of `available | on_job | off_shift`
(`src/domain/constants.js`'s `TECH_STATUS`). That is the entire time model. There are no shift
start/end times, no calendar, no exceptions.

### The UX that already exists

| Surface | Path |
|---|---|
| Dispatcher board (queue + technician board + preview + capacity card + activity feed) | `src/modules/dispatcherBoard/` |
| Day board — technician rows x time axis, drag-and-drop | `src/modules/dispatch/DispatchSchedulingWorkspace.jsx` |
| Weekly board | `src/modules/scheduling/SchedulingWorkspace.jsx` |
| Day-board domain (timeline geometry, drop snapping, priority grouping) | `src/domain/dispatchSchedulingBoard.js` |
| Weekly domain + `buildScheduleInput` | `src/domain/schedulingWorkspace.js` |
| Technician recommendation / scoring | `src/domain/technicianRecommendationEngine.ts`, `dispatchScoring.js` |

**Drag-to-time-slot already ships.** `DispatchSchedulingWorkspace` snaps a drop to 15 minutes,
positions it on a 06:00–19:00 visible window, and routes it through the *existing*
`transitionWorkOrder("Schedule", …)` call on explicit confirmation. The handoff's instruction "do not
start by implementing drag-and-drop" is moot — it was built correctly, against the command that
already existed, and it is scoped to `READY_TO_DISPATCH` work only because nothing else is honest.

---

## Reusable without change

- `transitionWorkOrder("Schedule", …)` as the schedule-write path.
- `findScheduleConflict` / `findDoubleBookingConflict` — the overlap engine a `Reschedule` command
  needs is already written and unit-tested; it takes a window and a technician, so it does not care
  which command calls it.
- `techLockRef` concurrency serialization.
- `stageAuditEvent` and the `AuditAction` union (extend, never fork).
- `buildScheduleInput` — the one client-side validator turning date + start + end + technician into
  the exact three governed fields.
- `technicianRecommendationEngine` / `dispatchScoring`.
- Every `fieldops_wos` and `fieldops_technicians` Rules block.

---

## Missing

1. **`Reschedule`** — no way to change a `SCHEDULED` job's time. `SCHEDULED → {DISPATCHED, CANCELLED}`
   is the whole outgoing set, and `canTransition` is a pure table lookup, so a self-edge is
   structurally impossible today. Already named in the record as package **B1** (ND-3).
2. **`Unschedule`** — no way to return a scheduled job to the ready queue. Would be the **first
   backward edge in ADR-002's table.**
3. **Standalone `Reassign`** — the technician on a `SCHEDULED` job cannot be changed without
   dispatching it. Reassignment exists only as a rider on `Dispatch`.
4. **Technician working availability** — recurring weekly hours. Nothing, anywhere. Independently
   audited and recorded in `dispatchSchedulingBoard.js:22`.
5. **Blocked time / exceptions** — PTO, lunch, training, meeting, truck service, company closure.
   Nothing.
6. **Availability validation in the schedule path** — necessarily absent, since 4 and 5 are absent.
7. **Work Order estimated duration.** No such field exists on either the server or client type.
   `durationMinutes` is derived from `scheduledEnd − scheduledStart` and is therefore a fact about an
   *already-placed* job, never an estimate. A dispatcher dragging from the queue must still state an
   end time; the board cannot infer one.
8. **Capacity / booked %** — arithmetically impossible without 4 as the denominator.
9. **Scheduling-specific audit actions.** `Schedule` today produces only the generic transition
   event. There is no `scheduleWorkOrder` / `rescheduleWorkOrder` / `unscheduleWorkOrder` action, and
   no prior-window (`from` start/end) capture anywhere — only prior *technician*.

---

## Must remain unchanged

- `fieldops_wos` client Rules: read-only, unconditional, no admin exception.
- The forward lifecycle `CREATED → … → CLOSED` and the `CANCELLED` edges.
- `Dispatch`'s H20 reassignment semantics, including the `scheduledTechId` realignment that closed
  the board-disagreement defect.
- `woNumbering`, the transaction boundary, the post-commit inventory effects, and the Sales Order
  fulfillment write-back.
- `auditEvents` as the single audit authority.
- `transitionEngine.ts` ↔ `workOrderWorkflow.js` mirror parity, and the server/client `workOrder.ts`
  type mirror.

---

## Additive schema required

On the Work Order (projection only, never client-writable — `fieldops_wos` already denies all client
writes, so this needs no Rules change):

- prior-window capture equivalent to the existing `reassigned*` snapshot, for the most recent
  reschedule.

New collections (**each one is a `firestore.rules` change and therefore always Tier 2**):

- a recurring technician working-schedule authority;
- a blocked-time / exception authority.

Both should follow the established Admin-SDK-only posture (`opportunities`, `sales_orders`,
`cycle_counts`): deny-all client writes, trusted commands as the sole writer.

---

## New trusted commands required

`rescheduleWorkOrder`, `unscheduleWorkOrder`, `reassignScheduledWorkOrder`, and the two
availability/blocked-time write commands. Whether the first three are new `transitionWorkOrder`
actions or separate callables is **ND-19 below** — it is not an implementation detail, because one
answer edits ADR-002's table and the other does not.

---

## Capabilities required

The existing `Schedule` gate is role-based (`admin`/`dispatcher`) in `ACTION_PERMISSIONS`, not
capability-based. Any new command must decide whether to match that convention or register in
`permissionCatalog.ts`. Registering new capabilities is a Tier-2 grant.

---

## Rules / index changes required

Two new deny-all client blocks for the availability collections. No new composite index is required
for the conflict queries — `findScheduleConflict` queries a single equality field
(`scheduledTechId`), which Firestore indexes automatically.

---

## Migration / backfill required

None for the Work Order. Availability is genuinely new data: without seeded working hours, every
technician reads as having no availability, so the board must render "no working schedule recorded"
rather than "0% booked" — an unrecorded schedule is not an empty one.

---

## Risks

1. **The backward-edge precedent.** `Unschedule` (and B1's `DISPATCHED → SCHEDULED`) would be the
   first time ADR-002's table admits a reverse transition. Once one exists, "why not this one" is a
   much cheaper argument for the next.
2. **Availability that only draws.** If the same records that shade a technician's row do not also
   refuse an invalid schedule server-side, the board tells a truth the system does not enforce —
   exactly the failure the handoff names.
3. **The absent design artifact.** *Dispatch and Schedule North Star P1v1* is **not in this
   repository** (`docs/north-star/` holds only `lists`, `opportunity`, `sales-agreement`). Backend
   authority can proceed without it; step 14 onward cannot.
4. **`reassignedReason` is a single denormalized slot.** A second reassignment overwrites the first
   on the document. History survives in `auditEvents`, correctly — but any UI reading the projection
   is seeing only the latest, and must say so.

---

## Named product decisions

Opened per `north-star-open-product-decisions.md`'s bar: each would change *what the business can
do*, and none can be answered by reading the code.

**ND-18 — May a scheduled Work Order return to the queue?**
`Unschedule` would be the first backward edge in ADR-002. The alternative is that scheduling is a
commitment reversed only by `Cancel` plus a new Work Order. Blocks the Ready-queue return interaction.

**ND-19 — Is `Reschedule` a lifecycle transition or a governed field command?**
As a `SCHEDULED → SCHEDULED` self-transition it edits ADR-002's table and the client mirror; as a
separate callable that rewrites planning fields under an unchanged status it does not touch the state
machine at all. Both are defensible. The second is materially smaller.

**ND-20 — Which scheduling conditions refuse, which warn, and which allow with a reason?**
The handoff forbids inventing this. Overlapping the same technician already **refuses** (shipped
behavior — the precedent exists). Undecided: outside working hours, during blocked time, in the past,
and against an ineligible technician. Field service legitimately schedules emergency work at 02:00,
so a blanket refusal on working hours is a real operating change, not a safety default.

**ND-21 — Does a Work Order carry an estimated duration?**
Without one, dragging from the queue can never propose an end time, and "percent booked" has a
numerator that only exists after the fact. Adding one is an additive schema change with a real
data-entry cost at Work Order creation.

**ND-22 — Are recurring working hours and one-off exceptions one authority or two?**
The handoff says not to conflate them unless the architecture clearly favours it. Nothing in the
repository favours either, because neither exists.

**ND-23 — The Dispatch North Star design package is not in the repository.**
Recorded so the gap is visible rather than rediscovered at composition time.
