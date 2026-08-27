# Dispatch North Star P1 — composition map

The reconciliation between the design artifact
([`docs/north-star/dispatch-board/North Star - Dispatch Board P1.dc.html`](../north-star/dispatch-board/North%20Star%20-%20Dispatch%20Board%20P1.dc.html)),
the Dispatch surface as it stands, and the now-certified Scheduling authority. Produced before any
UI code changed, per the North Star execution rule.

## The one thing to read first

**The artifact was drawn ~14 hours before the authority it was waiting for existed.**

`Dispatch and Schedule North Star P1v1.zip` is timestamped `2026-08-27 04:54`. PR #1549 — the
governed Scheduling domain — merged at `18:45` the same day, and the placement policy was certified
(32/32) later still. So the artifact's own README describes two of its central features as
**PRODUCT BUILD**, not yet governed, and specifies interim renderings for them.

Those interim renderings are now obsolete. The artifact says so itself, in its own words:

> **one composition, lit in stages**

and

> This is the North Star: the full scheduling board. The composition stands whole; what current
> authority cannot yet feed renders an honest interim in the same slots.

We are at the later stage. The Owner ratified this reading on 2026-08-27: implement the **fully lit**
composition, and do not implement an interim merely because the README describes one. Nothing about
the *design* changes — only which of its slots have data behind them.

The preserved artifact is **not** edited to record this. Reconciliation lives here.

---

## HISTORICAL DESIGN ASSUMPTIONS NOW SUPERSEDED

Four, each recorded with what it said, what is true now, and what ships.

### DB-D1 — Scheduling windows · was `PRODUCT BUILD`

**Artifact:** hour lanes, drag-to-slot scheduling, week drop-to-day, shift display and every booked
percentage "need governed shift records and a schedule-window write from a board drop." Interim:
lanes list jobs in order with durations, no clock geometry, no hour header, shift line reads *"Shift
not recorded"*, `% booked` and the header's fleet number **absent**.

**Now:** governed and certified. `technician_working_availability` (ND-22) is the shift record;
`rescheduleWorkOrderCallable` is the schedule-window write; `readTechnicianAvailabilityCallable` is
the trusted read that carries both, plus `availableMinutes` computed by the same pure functions the
server validates against.

**Ships:** the full hour-header lane grid with real clock geometry from `scheduledStart` /
`scheduledEnd`; the shift line from the governed record; `% booked` derived from the read model's own
`availableMinutes` denominator. The *"Scheduling windows aren't recorded yet"* messaging is **not**
implemented.

**What does not change:** unknown stays unknown. A technician with no availability record returns
`workingAvailability: null` and `availableMinutes: null`, and the lane renders *"Shift not recorded"*
with **no** percentage — never `0%`. That interim sentence survives, because for that technician it
is still the truth. The obsolete thing was applying it to *everyone*.

### DB-D2 — Blocked time · was `PRODUCT BUILD`

**Artifact:** lunch / training / PTO / truck service as hatched, drop-refusing records. Interim:
nothing hatched renders; blocked figures absent.

**Now:** governed and certified. `technician_blocked_time` (ND-22), surfaced through the same trusted
read, and refused by the placement policy on **both** placement paths since ND-24.

**Ships:** hatched chips positioned by real `startMillis` / `endMillis`, labelled by governed `kind`,
and drops onto them refused by the server with the refusal rendered in words. Read **only** through
`readTechnicianAvailabilityCallable` — the collection denies client reads and the board must never
try.

### Drop gesture — Dispatch vs Schedule

**Artifact:** "A drop proposes the governed transition through the existing engine"; 1d lists the
live core as `transitionWorkOrder "Dispatch"`. That was correct: when the artifact was drawn, the
only governed board action was `Dispatch`, and `getAllowedActions` offered it from `SCHEDULED` only.

**Now:** scheduling is a distinct governed operation. A queue Work Order is `READY_TO_DISPATCH` and
has no window at all — dispatching it was never the gesture the picture describes. The design draws
a chip being dropped onto a *time slot in a technician's day*, which is a **Schedule**.

**Ships:** the drop gesture composes the **current** governed action for the chip's state:

| chip origin → target | governed command |
|---|---|
| Ready queue → lane slot | `transitionWorkOrder` action `Schedule` (`READY_TO_DISPATCH → SCHEDULED`) |
| lane slot → different time, same technician | `rescheduleWorkOrderCallable` (status unchanged) |
| lane slot → different technician | `reassignScheduledWorkOrderCallable` (window from the record) |
| lane slot → ready queue | `transitionWorkOrder` action `Unschedule` (`SCHEDULED → READY_TO_DISPATCH`) |

**Explicitly not authorized by this:** reinterpreting `Schedule` as the old `Dispatch` transition,
renaming a backend transition to match visual vocabulary, or touching the state machine.
`Dispatch` keeps its existing meaning and its existing surfaces everywhere EOS still uses it.

### ND-3 — "no undo affordance"

**Artifact (1b and board rules):** *"Dispatch is a forward transition with no reverse command
(ND-3). The board confirms before acting rather than pretending a drop can be taken back."* And 1d:
moving a `DISPATCHED` chip is `BLOCKED BY ND-3 / B1`.

**Now:** ND-18 admitted `SCHEDULED → READY_TO_DISPATCH`, the first reverse edge in ADR-002. The
statement was accurate when written and is no longer applicable to a **scheduled** Work Order.

**Ships:** return-to-queue via `transitionWorkOrder` action `Unschedule`, from `SCHEDULED` only, with
a required reason.

**What survives unchanged:** ND-3 still holds from `DISPATCHED` onward. A dispatched chip is a fact,
not a drag handle — there is still no reverse command past that point, and the board must not offer
one. The artifact's rule is narrowed, not repealed.

---

## ALREADY PRESENT

Wiring that exists, is governed, and is reused rather than rebuilt.

| Design element | Current component / module |
|---|---|
| Live Work Order subscription | `hooks/useWorkOrders` (`onSnapshot` — this surface *is* live) |
| Technician roster | `useFirestoreCollection(TECHNICIANS_COLLECTION)` |
| Session feed ("This session") | `hooks/useSessionActivityFeed` + `DispatcherActivityFeed.jsx` |
| Recommendation scores (★ + %) | `domain/technicianRecommendationEngine.recommendTechniciansBatch` |
| Allowed-action gate | `domain/workOrderWorkflow.getAllowedActions` + `ACTION_ALLOWED_FROM` mirror |
| Reassignment reason gate (1b) | `DispatcherBoard.jsx` `pendingReassignment` / `reassignReasonInput` |
| Accessible picker path | `WorkOrderPreview.jsx` "Dispatch to…" — same callback as drag |
| Customer name resolution | `hooks/useAccountNames` |
| Technician display names | `domain/actorDisplayName.resolveTechnicianIdentity` |
| Status / priority vocabulary | `domain/workOrderStatus`, `workOrderPriority`, `technicianStatusTone` |
| Refusal wording | `domain/workflowActionError.workflowActionErrorMessage` |
| Read-failure sentences | `domain/loadErrorMessage` |
| Serif title + crumb + rule pair + summary line | `shared/ui/WorkspaceIdentity.jsx` (the ratified collection header) |
| Honest states | `shared/ui/HonestState.jsx` (`LOADING` / `EMPTY` / `DENIED` / `UNAVAILABLE` / `DEGRADED`) |
| Button hierarchy, 44px floor | `shared/ui/primitives/Button.jsx` |

## NEWLY AVAILABLE FROM SCHEDULING AUTHORITY

Certified backend that has **no client consumer at all** today. This is the substance of the build.

| Governed fact / action | Callable | Lights up |
|---|---|---|
| Technician working hours + blocked time + `availableMinutes` | `readTechnicianAvailabilityCallable` | shift line, hatched chips, `% booked`, fleet booked |
| Re-time a placement | `rescheduleWorkOrderCallable` | drag within a lane; week drop-to-day |
| Move to another technician | `reassignScheduledWorkOrderCallable` | drag between lanes |
| Return to queue | `transitionWorkOrder` / `Unschedule` | drag back to the queue |
| Placement warnings on success | both placement paths, since ND-24 | outside-hours warning surfaced on a committed Schedule |
| Planning estimate | `setWorkOrderEstimatedDurationCallable` | queue card duration where none is recorded |

**No client wrapper exists for any of these.** `services/` has no scheduling client; `domain/` has no
board geometry. Both are new.

## UX-ONLY COMPOSITION CHANGES

Presentation moves with no authority change.

- Master-detail pane (queue left / technician columns right) → **hour-lane day board with the queue
  below it**, per 1a. This is the composition change; the current board is not the North Star.
- Technician *columns* → technician **lanes**, 170px identity + proportional time grid.
- `TechnicianCapacityCard`'s status-bucket counts → the governed shift + `% booked` line.
- Ad-hoc header → `WorkspaceIdentity` (crumb, rule pair, 34px serif title, workload summary line).
- Status-filter dropdown → **view switcher** (Day · Week · 2 weeks · Map) + technician picker.
- Queue rows → the artifact's queue **cards** (priority word + reference + duration/type + resolved
  customer + attention note + top recommendation with score + picker link).
- Board rules + "This session" as the two-column footer band.
- Refusals rendered as sentences, never raw codes (1b), and read failures given their own sentences
  distinct from empty (1c).

## STILL FUTURE / OUT OF SCOPE

- **Map view.** No routing, travel-time, GPS or optimization authority exists, and none is being
  built. The tab renders and states truthfully that location-based dispatch is not available. It does
  not block Day / Week / 2 Week.
- **Recommendation reason sentences.** 1d classifies these `VERIFY AUTHORITY`; the engine projects a
  score, not words. Score only — no fabricated explanations.
- **Moving a `DISPATCHED` chip.** ND-3 still holds past `SCHEDULED`.
- **Availability management UX** (`setTechnicianWorkingAvailability`, `create/deleteTechnicianBlockedTime`).
  The commands exist; the P1 design does not draw them, and Dispatch consumes availability rather than
  becoming a workforce-management screen.
- **Fleet-wide `% booked`** renders only when every technician in view has a recorded schedule; a
  fleet number averaged over unknown denominators would be a fabrication.

## FILES TO CHANGE

**New**
- `services/schedulingCommandClient.js` — transport for the four scheduling callables + the read.
- `hooks/useTechnicianAvailability.js` — trusted availability read, windowed to the visible range.
- `domain/dispatchBoardGeometry.js` — pure: lane placement, day/week/fortnight bucketing, capacity.
- `domain/schedulingRefusal.js` — governed refusal code → sentence.
- `modules/dispatcherBoard/DispatchLaneGrid.jsx`, `DispatchLane.jsx`, `ReadyToScheduleQueue.jsx`,
  `DispatchViewSwitcher.jsx`, `DispatchWeekView.jsx`, `DispatchTwoWeekLoad.jsx`, `DispatchMapView.jsx`,
  `PlacementDialog.jsx` (reason gate + accessible picker, one gate for both paths).

**Modified**
- `modules/dispatcherBoard/DispatcherBoard.jsx` — recomposed to 1a; keeps its governed wiring.
- `modules/dispatcherBoard/WorkOrderPreview.jsx` — picker path extended to the placement commands.
- `index.css` — the lane grid, chips, hatch, queue cards.

## FILES THAT MUST NOT CHANGE

Authority freeze. A change here is a defect report, not a composition step.

- `functions/src/**` in its entirety — `transitionWorkOrder.ts`, `transitionEngine.ts`,
  `scheduling/placementPolicy.ts`, `scheduling/*`, every callable.
- `firestore.rules`, `firestore.indexes.json`.
- `domain/workOrderWorkflow.js` — the client mirror of the three transition tables.
- `domain/technicianRecommendationEngine.js` — ranking is informational and unchanged.
- The preserved artifact under `docs/north-star/dispatch-board/`.

## TESTS TO ADD / UPDATE

Pure domain, then component, then the sandbox Quick Gate.

- **Geometry** — placement percentage from real windows; day/week/fortnight bucketing; the same Work
  Order resolves identically in all three views; windows crossing a day boundary; timezone via the
  repo's existing conventions.
- **Capacity** — `availableMinutes: null` renders "Shift not recorded" and **no** percentage;
  recorded hours render a percentage; fleet number absent when any denominator is unknown.
- **Availability** — blocked time drawn from the trusted read; `kind` labelled from the governed
  vocabulary.
- **Commands** — queue→lane calls `Schedule`; within-lane calls `reschedule`; cross-lane calls
  `reassign`; queue-drop calls `Unschedule`; each with its reason gate where required.
- **Warnings** — a committed Schedule carrying `OUTSIDE_WORKING_HOURS` shows the warning and the
  placement.
- **Refusals** — overlap / blocked / past-start / ineligible each render a sentence, the chip returns,
  and the prior committed placement is still drawn.
- **Accessibility** — the picker path reaches every placement drag reaches, and calls the identical
  commands.
- **Invariants** — no direct read or write of `technician_working_availability` /
  `technician_blocked_time`; `MarkReady` is never an unschedule path; reschedule leaves status
  `SCHEDULED`; no client-side placement policy.
