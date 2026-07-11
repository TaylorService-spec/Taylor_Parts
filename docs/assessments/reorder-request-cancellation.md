---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release: Release 2.1 -- Inventory to Procurement workflow chain
---

# Assessment Report: Governed Cancel/Void for Reorder Request and Reorder Purchase Order

**Business Request:** Rudy identified this as the next priority after the assignment-picker and post-assignment-display corrections (PR #105, PR #107): "Erroneous order cancellation/voiding remains a separate workflow gap." No further requirements were specified beyond naming the gap -- this assessment is the first attempt to characterize it precisely enough for a Specification.

## Scope of this assessment

Covers `reorder_requests` and `reorder_purchase_orders` only -- the two collections this session's work (Sprints 2.1.2-2.1.11, the Zero-history reorder behavior sprint) has been operating on. Explicitly does **not** cover:
- Work Order cancellation (`fieldops_wos`, `workOrderWorkflow.js`'s existing `CANCELLED` state) -- already implemented, unrelated object, out of scope by the Owner's own standing instruction to keep this initiative separate from other work.
- The legacy `purchase_orders` collection (Epic 5, Admin-SDK-only, unbuilt execution) -- a different, unrelated Purchase Order concept from `reorder_purchase_orders`; do not conflate them (see `docs/BusinessEntityModel.md` Section 4b's explicit warning about this exact confusion).
- Any UI/UX design for a cancel/void action -- this assessment identifies what's missing and what it would touch, not how the button should look.

## Current repository state

**No cancel or void concept exists anywhere on this object today.** Verified directly:

- `REORDER_REQUEST_STATUS` (`field-ops-app-vite/src/domain/constants.js:98-107`) has exactly seven values: `PENDING_REVIEW`, `APPROVED` (a `reviewDecision` value, not a `status` value in practice -- see `docs/BusinessEntityModel.md` Section 4), `REJECTED`, `READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`, `PURCHASING_IN_PROGRESS`, `ORDERED`, `RECEIVED`. No `CANCELLED`/`VOIDED`/`VOID` member.
- The only terminal exit before `RECEIVED` is `REJECTED`, and it's reachable **only** from `PENDING_REVIEW` (`firestore.rules` lines ~346-354, `reviewReorderRequest()` in `domain/inventoryReorderRequests.js`). Once a request is approved, there is no path back to a terminal, non-`RECEIVED` state -- a request that becomes unnecessary after approval (part no longer needed, duplicate request, wrong part, changed priority) has no way to be closed out. It either proceeds through the full lifecycle to `RECEIVED`, or sits open indefinitely.
- `reorder_purchase_orders.status` (`docs/BusinessEntityModel.md` Section 4b, line 109) is documented as "always `ORDERED` -- this object has no further workflow this sprint." `firestore.rules`' `reorder_purchase_orders` match block (`allow update, delete: if false`) makes this literal: **the document is immutable and undeletable once created**, by anyone, including admin. A Purchase Order recorded with a wrong supplier, wrong quantity, or against a since-cancelled Reorder Request cannot be corrected or voided today; it stands permanently as written.
- `field-ops-app-vite/src/analytics/operationsIntelligenceService.ts` (lines 108-121) already references a `CANCELLED` status value when computing `openProcurementCount`, but this reads from `fetchPurchaseOrders()` -- the **legacy `purchase_orders` collection** (Epic 5), a different, unrelated object. This is not reusable precedent for `reorder_purchase_orders`; it's flagged here only so a future reader doesn't mistake it for one.
- A real precedent for a governed cancellation state machine **does** exist elsewhere in this repo: `field-ops-app-vite/src/domain/workOrderWorkflow.js` defines an explicit, per-status allowlist of which Work Order states may transition to `CANCELLED` (e.g. `CREATED: ["READY_TO_DISPATCH", "CANCELLED"]`), and `workOrderLifecycle.js` maps `CANCELLED` into the UI's lifecycle-state model with an explicit `isCancelled` flag rather than overloading an existing status. This is a genuinely relevant design precedent for the Specification stage, even though the object itself is out of scope here.

## Affected files

| File | Current role | Why it's affected |
|---|---|---|
| `firestore.rules` (both copies) | Enforces the `reorder_requests` update-path state machine and the `reorder_purchase_orders` immutable-after-create rule | A new terminal transition (or transitions, if cancellation is reachable from more than one status) needs its own rule branch; `reorder_purchase_orders`' unconditional `allow update, delete: if false` may need to admit exactly one new case (void), or may deliberately stay immutable if voiding is modeled as a Reorder Request-side fact instead (see Implementation options) |
| `field-ops-app-vite/src/domain/constants.js` | `REORDER_REQUEST_STATUS` enum | Needs a new terminal value if cancellation is modeled as a status (not the only option -- see below) |
| `field-ops-app-vite/src/domain/inventoryReorderRequests.js` | Sole write path for every Reorder Request transition | Needs a new exported function (mirrors `reviewReorderRequest()`/`receiveReorderRequest()`'s shape) |
| `field-ops-app-vite/src/domain/reorderPurchaseOrders.js` | Sole write path for `reorder_purchase_orders` (currently create-only) | Needs a new exported function if voiding a Purchase Order is in scope, or stays untouched if voiding only ever happens Reorder-Request-side (before a PO exists) |
| `field-ops-app-vite/src/modules/inventory/PartDetail.jsx` | Renders every lifecycle-stage card | Needs a new action (who can cancel/void, from which stage) and, if cancellation is reachable from multiple stages, either a shared control or several per-stage additions |
| `field-ops-app-vite/src/modules/inventory/PartsList.jsx` / `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx` | Active-work queues (Parts Manager Queue, Parts Associate Waiting/In Progress) | A cancelled/voided request must stop appearing as active work -- same "no extra removal logic needed" pattern every prior status-scoped query already gets, provided the new state is excluded from each query's status filter |
| `field-ops-app-vite/src/shared/ui/NotificationPanel.jsx` | Renders realtime notification sections keyed to specific statuses | Needs to decide whether a cancellation itself is notification-worthy (a new section) or silent (matches this sprint's "no new Notification Panel section" precedent from Sprint 2.1.11) |
| `functions/test/reorderRequestsRules.test.js` | The only Rules-emulator test for this collection | Needs new assertions for whatever authorization/state-machine shape the Specification approves |
| `docs/BusinessEntityModel.md` Section 4 / 4b | Authoritative schema reference | Needs the new status value(s)/fields documented, same as every prior sprint in this chain |

## Dependencies

- **Zero-history reorder behavior sprint (complete, all 4 PRs live)**: cancellation would be the object's first new status/transition since that sprint closed. No open dependency, but the Specification should explicit confirm it isn't reopening anything from that sprint's now-closed scope.
- **Sprint 2.1.11 (Receiving, PR #98/#103, live)**: `RECEIVED` is the current terminal state. A cancellation reachable late in the lifecycle (e.g. after `ORDERED`, before `RECEIVED`) needs to be reasoned about alongside Receiving's existing terminal transition, not independently.
- **PR #107 (post-assignment display names, open as of this writing)**: any new "who cancelled/voided" actor field should reuse `hooks/useEmployeeDirectory.js`'s `resolveActorDisplayName()` from the start, not repeat the raw-uid-display mistake PR #107 just fixed.
- **No dependency on Firebase Blaze / Cloud Functions.** Every write path this object has ever used is client-direct-write-with-rules; nothing here requires a trusted server write, based on the pattern established by every prior sprint on this object.
- **No dependency on the Parts and Purchase Order Assignment Adoption initiative** (still unscoped, per `docs/CLAUDE_CONTEXT.md`) -- unrelated concern (who gets assigned, not whether a request can be un-done).

## Risks

- **Data integrity on `reorder_purchase_orders`.** Its immutability (`allow update, delete: if false`) is currently a deliberate, documented guarantee ("no duplicate Purchase Order per Reorder Request," Section 4b). Any change here needs to preserve *that* guarantee while adding a narrow void path -- an unconditional loosening of the update rule would be a real regression, not just an addition.
- **Reachability surface.** If cancellation is reachable from every non-terminal status (`READY_FOR_PARTS_MANAGER` through `PURCHASING_IN_PROGRESS`, and possibly `ORDERED`), that's a much larger `firestore.rules` diff than any single prior sprint's PR -- likely multiple new branches, not "the smallest possible diff" the way PR 4's Rules tightening was. The Specification should decide whether cancellation needs to be reachable from every stage, or only early ones (e.g. before `ORDERED`, after which "cancel" and "void the Purchase Order" become two different, harder operations).
- **Who is authorized to cancel.** Every existing transition on this object is either admin/dispatcher-generally or the specific `assignedToUserId` (assignee-only). Cancellation likely needs its own authorization answer -- e.g., can Inventory (the original requester) cancel a request they created but that's now assigned to someone else? Can the assignee cancel their own in-flight work? This is a real design decision, not an implementation detail.
- **Interaction with the inventory ledger / `inventory_actions`.** Confirmed nothing in `inventory_actions` or `inventory_transactions` currently reacts to Reorder Request status at all (they're deliberately separate, per `docs/BusinessEntityModel.md` Section 4a). A cancellation should not create pressure to start coupling them -- worth stating explicitly in the Specification so it doesn't creep in in that PR.
- **"Cancel" vs. "Void" may not be one concept.** The Owner's own phrasing ("cancellation/voiding") suggests they may be two different operations: cancelling a Reorder Request before a Purchase Order exists, versus voiding an already-recorded Purchase Order. Conflating them into one status value risks under-specifying one of the two real cases. This needs an explicit decision at the Specification stage, not an assumption made here.

## Implementation options

1. **Single new terminal `CANCELLED` status on `reorder_requests`, reachable from every pre-`RECEIVED` status.** Mirrors `REJECTED`'s shape (a `reviewDecision`-style reason field, a terminal `status`) but generalized to fire from any stage, not just `PENDING_REVIEW`. If the request already has a linked `reorder_purchase_orders` document (i.e. `status` was `ORDERED`), this option needs a decision on what happens to that now-orphaned Purchase Order record -- option 2 addresses this directly.
2. **Two separate concepts: `CANCELLED` on `reorder_requests` (reachable only before `ORDERED`) plus a narrow `VOIDED` transition on `reorder_purchase_orders` (reachable only from `ORDERED`, mirroring how `RECEIVED` already works).** Closer to the Work Order precedent's spirit (a status transition, not a retroactive edit) and keeps `reorder_purchase_orders`' immutability guarantee intact for every field except a new terminal `status`. Larger scope (two objects' rules, not one) but more precisely matches the Owner's "cancellation/voiding" wording as two things.
3. **A single, object-spanning `CANCELLED`/`VOIDED` concept modeled as a new field rather than overloading `status`** (e.g. `cancelledAt`/`cancelledBy`/`cancellationReason`, with `status` unchanged) -- avoids ever needing to ask "does a consumer need to handle status == CANCELLED everywhere status is already checked," at the cost of every status-based query/filter needing an additional exclusion clause instead of a single value change. Not clearly better or worse than options 1/2; a real trade-off for the Specification to resolve.

No recommendation is made here between these three -- that decision belongs to Architecture Review, per this document's own stated boundary.

## Estimated PR count

Likely 2 PRs, one architectural concern each, following this initiative's own established pattern (one PR per concern, e.g. the Zero-history sprint's 4-PR decomposition):
1. Schema/constants/write-path/Rules for the chosen model (per whichever Implementation option is approved).
2. UI (cancel/void action placement, queue-removal, and — if approved — display resolution reusing PR #107's `resolveActorDisplayName()`).

If option 2 (two separate concepts) is approved, this could reasonably split into 3 PRs (one per object, plus UI) instead of 2 -- the Specification/Implementation Plan stage should make the final call once the model is chosen.

## Open questions for Architecture Review

1. Is "cancel" (Reorder Request, pre-Purchase-Order) and "void" (Reorder Purchase Order, post-`ORDERED`) one concept or two? This assessment could not resolve it from the Owner's one-line framing alone.
2. From which statuses should cancellation be reachable? Every non-terminal status, or a bounded subset (e.g. not once `PURCHASING_IN_PROGRESS`, on the theory that active purchasing should complete or be voided at the PO stage, not cancelled mid-flight)?
3. Who is authorized to cancel/void — admin/dispatcher generally (matching most transitions), the specific assignee only (matching the per-user-restricted transitions), the original requester, or some combination depending on stage?
4. Does cancelling/voiding require a reason (mirroring `REJECTED`'s required `reviewNotes`), and if so, is that requirement stage-dependent?
5. Should a cancelled/voided request generate a new Notification Panel section, or stay silent (matching Sprint 2.1.11's precedent of no new section for a terminal-but-routine transition)?
6. Does `reorder_purchase_orders`' `allow update, delete: if false` rule need to admit an update-in-place for a `status: VOIDED` field, or should voiding instead create a new, separate audit-style record (mirroring how `inventory_actions` is a new collection rather than a mutation of `inventory_transactions`) — keeping the existing document permanently immutable and voiding by association instead?
