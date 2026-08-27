# Handoff: Dispatch Board — North Star design source
## VERSION: Dispatch Board North Star P1 — DESIGN AUTHORITY for the dispatcher board surface. THE NORTH STAR IS THE FULL SCHEDULING BOARD (the Proposed - Dispatch Board composition elevated): day lanes, blocked time, week/two-week balancing, map view. Missing authority keeps its structural slot and renders an honest interim state — never dropped, never faked. Presentation only; no authority changes.

## Visual authority
`North Star - Dispatch Board P1.dc.html`: 1a desktop 1440 day board (canonical), 1e week + two-week balancing views, 1b guarded moves, 1c honest states (incl. the schedule-data-absent interim), 1d implementation-reality matrix (one composition, lit in stages).

## Behavioral authority
TaylorService-spec/Taylor_Parts @ main: modules/dispatcherBoard/DispatcherBoard.jsx, WorkOrderQueue.jsx, TechnicianBoard.jsx, WorkOrderPreview.jsx (picker path), DispatcherActivityFeed.jsx; domain/workOrderWorkflow.js (getAllowedActions — Dispatch only from SCHEDULED), technicianRecommendationEngine.js (recommendTechniciansBatch), workOrderStatus.js, workOrderPriority.js, technicianStatusTone.js, actorDisplayName.js; hooks/useWorkOrders (onSnapshot — this surface IS live), useAccountNames, useSessionActivityFeed; services/workOrderService.transitionWorkOrder.

## Composition (1a)
Context line → rule pair → serif title + workload sentence (unassigned / past due / fleet booked — fleet % renders only once DB-D1 exists) → view switcher (Day · Week · 2 weeks · Map) + technician picker → hour-header lane grid (170px identity + 7a–4p), one lane per technician: WO chips (reference + type / customer), hatched blocked-time chips (DB-D2), shift + %-booked line (DB-D1) → "Ready to schedule" queue below (priority words + reference + duration/type + resolved customer + attention note + top recommendation with score + "Dispatch to…" picker path) → board rules + session feed.

### Interim renderings (until DB-D1/DB-D2 light up)
Lanes list each technician's jobs in order with durations — no clock geometry, no hour header; shift line reads "Shift not recorded"; % booked, blocked figures, hatched chips and the fleet number are ABSENT; Week/2-week/Map tabs render and state "Scheduling windows aren't recorded yet" in one sentence. The dispatch core (queue → technician drop, reason gate, refusals, session feed, liveness) is LIVE day one.

## Interaction rules
- Drop = the governed Dispatch transition; nothing writes optimistically; the subscription is the refresh.
- Only SCHEDULED work orders present drop targets; ineligible statuses render no invitation and refusals arrive in words (never raw codes).
- Reassignment (scheduledTech ≠ target) blocks on a typed reason (Owner ruling H20); Confirm disabled until text exists; one gate serves both drag and picker paths; the server enforces regardless.
- Double-drop guarded: a work order mid-dispatch ignores further drops.
- No undo affordance — no reverse command exists (ND-3); the board confirms before acting instead.
- Rankings are visible scores that never hide or reorder technicians away (informational ranking, per the grammar's AI contract).
- Keyboard: ↑↓ selection, Esc clears; the picker path is the accessible equivalent of drag-drop.

## States (1c)
Loading (skeletons) · WO read failed (fail-visibly — never a false-empty board) · technician read failed (its own sentence) · queue clear (good news, distinct) · schedule-data-absent interim (stated once above the lanes) · denied (nothing leaks) · dispatch in progress.

## Named decisions
- **DB-D1 — Scheduling windows · PRODUCT BUILD.** Hour lanes, drag-to-slot scheduling, week drop-to-day, shift display and every booked % need governed shift records and a schedule-window write from a board drop. The composition holds their slots; the interim renderings above ship meanwhile.
- **DB-D2 — Blocked time · PRODUCT BUILD.** Lunch/training/PTO/truck-service as drop-refusing hatched records needs a blocked-time record type the board only renders.
- **Carried:** ND-3/B1 (dispatched chips are facts, not drag handles), ND-6 (44px primitive), recommendation reasons = VERIFY AUTHORITY (score only until the engine's factors are confirmed projectable as words).

## Do-not-invent list
No fabricated shifts, booked percentages, blocked time, ETAs, travel times, or route math ahead of DB-D1/DB-D2 — the slots render their honest interims instead; no recommendation reason sentences beyond what the engine projects; no undo; no drag affordance on non-SCHEDULED work; no optimistic row patching; no audit-feed claims beyond the session; document ids never render.

## Acceptance checklist
- [ ] Whole-composition side-by-side vs 1a/1e (the full board is the target; interims verified against 1c/1d, not treated as scope cuts)
- [ ] Drop targets appear only for SCHEDULED work; refusal wording matches 1b; reassignment gate blocks until a reason is typed
- [ ] Both read-failure states render their own sentences; empty ≠ failed; interim lane state states itself once
- [ ] Scores visible for every technician; none hidden or reordered away
- [ ] Picker path reaches every dispatch a drag can; targets ≥44px where touch applies
- [ ] Nothing from DB-D1/DB-D2 renders as data before its authority exists
