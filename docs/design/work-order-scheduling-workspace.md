# Work Order Scheduling Workspace (V1)

Status: Implemented (repo-only) — Owner-ratified next Product lever after the Governed Supplier
Selection capability closed.

## Problem

The governed Work Order lifecycle (ADR-002 / `functions/src/transitionEngine.ts`) mandates
`CREATED → READY_TO_DISPATCH → SCHEDULED → DISPATCHED → …`. `READY_TO_DISPATCH` can **only**
transition to `SCHEDULED` (via the `Schedule` action) or `CANCELLED`. The `Schedule` transition is
already deployed and requires `scheduledStart`, `scheduledEnd`, and `scheduledTechId`
(`transitionWorkOrder.ts:57`), admin/dispatcher only.

But **no screen collected those fields**. Control Tower's one live "Schedule" button fired
`transitionWorkOrder("Schedule")` with an empty payload, which the backend rejected with
`invalid-argument`. As a result a Work Order created in-app could not be advanced past the
`SCHEDULED` gate from any real surface, and there was no place to see the week's planned work. The
`Service > Scheduling` nav item was a `PlaceholderPage`.

## What this delivers

A real **weekly dispatcher scheduling workspace** at `Service > Scheduling`, plus a reusable
governed Schedule collector, plus the Control Tower defect fix — all **repo-only**.

- **`domain/schedulingWorkspace.js`** (pure, unit-tested): the correctness spine. Turns the governed
  `fieldops_wos` read + the technician entity into a technician×weekday view model, a
  ready-to-schedule queue, per-technician weekly workload, overlap detection, and a needs-attention
  list; plus `buildScheduleInput` (validates date/start/end/tech → the exact three Schedule fields).
- **`shared/scheduling/ScheduleWorkOrderForm.jsx`**: the one governed "Schedule this Work Order"
  collector (date + start + end + governed technician select → the deployed `transitionWorkOrder`
  "Schedule" call). Reused by the workspace's ready queue **and** by Control Tower's
  `WorkOrderActions` (replacing the empty-payload call).
- **`modules/scheduling/SchedulingWorkspace.jsx`**: the weekly board — technician rows × 7 day
  columns (Mon–Sun), `‹ Previous / This week / Next ›` navigation, a Week/Day toggle, a summary
  (scheduled this week / ready to schedule / technicians / needs attention), the Ready-to-Schedule
  queue, per-technician weekly workload, overlap + past-due flags, an "open Work Order" drill-down,
  and a phone-friendly Day agenda.

## Authority alignment (no new semantics)

- The only write is the **already-deployed** `transitionWorkOrder("Schedule", …)` Cloud Function.
  Nothing writes `fieldops_wos` directly (Rules deny direct client writes). The server re-authorizes
  (Schedule = admin/dispatcher) and re-validates the payload; the client checks are defense-in-depth.
- `SCHEDULABLE_STATUS = "READY_TO_DISPATCH"` **mirrors** `transitionEngine.TRANSITIONS` — it does not
  re-implement the state machine. If ADR-002's table changes, this constant must change with it.
- Nav visibility (`Service > Scheduling` → admin/dispatcher via `PLACEHOLDER_DEFAULT_ROLES`) is a
  preview, never the security boundary.

## Deliberate boundaries

- **No re-scheduling of an already-`SCHEDULED` Work Order.** The deployed backend has no transition to
  change a `SCHEDULED` job's time (`SCHEDULED → {DISPATCHED, CANCELLED}` only). This workspace therefore
  **schedules `READY_TO_DISPATCH` work only** and never fabricates a reschedule. A scheduled job can be
  **opened** (drill-down) and, in Service, dispatched or cancelled. True re-timing is a recorded
  governed follow-on (needs a new `Reschedule` transition + its own deploy).
- **No optimizer semantics** (explicitly out of scope per the ratifying direction): no drag/drop
  rescheduling, automatic technician assignment, route optimization, drive-time, capacity, overtime,
  skill matching, or geographic optimization. The board is structured so those can augment it later
  without a second scheduling architecture (technician rows, per-day cells, a workload column, and an
  overlap signal are the seams).
- **Repo-only.** No Rules deploy, no Functions deploy, no capability/role grant, no readiness-flag
  flip, no production data mutation, no Hosting/Pages promotion.

## Responsive strategy

WEEK is the primary planning horizon on desktop/large tablet. On narrow screens the 7-day board is
**not squeezed** — it scrolls horizontally (min-width day columns), and the **Day** drill-down gives a
per-technician agenda for a single day. Week and date navigation remain available in every view.

We render all 7 days (Mon–Sun), not only Mon–Fri: a job scheduled on a weekend must never be silently
hidden (that would be a correctness bug). Weekends are visually de-emphasized.

## Tests

- `test/schedulingWorkspace.test.mjs` (10) — timestamp normalization, Monday week model + prev/this/next,
  7-day build, duration, overlap detection, the full view model (bucketing, weekly totals, ready queue,
  CANCELLED/out-of-week exclusion, unknown-tech surfacing, overlap + past-due flags), and
  `buildScheduleInput` (valid + every honest failure).
- `test/schedulingWorkspace.test.jsx` (7) — the governed Schedule collector (calls
  `transitionWorkOrder` with the validated payload; honest failures never call it) and the workspace
  honest states + week navigation + Ready-to-Schedule flow.

## Follow-ons (recorded, not built)

1. **Reschedule** an already-`SCHEDULED` job — needs a governed `Reschedule` transition (backend +
   deploy), then this workspace can offer in-place re-timing.
2. **Parts planning** (`plannedParts`) — the adjacent Service↔Inventory gap: work is scheduled but no
   parts are planned onto it, so field parts-usage stays inert. Separate program.
3. The optimizer capabilities listed under "Deliberate boundaries", each a governed follow-on.
