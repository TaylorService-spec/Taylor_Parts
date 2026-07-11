---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/reorder-request-cancellation.md]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release: Release 2.1 -- Inventory to Procurement workflow chain
---

# Sprint Specification: Governed Cancel/Void for Reorder Request and Reorder Purchase Order

**Architecture Review:** `docs/assessments/reorder-request-cancellation.md`'s "Architecture Decision" section -- Approved 2026-07-11 (Option 4, the append-only void-record model).

## Executive summary

Closes the last open gap in the Reorder Request lifecycle this project has repeatedly flagged: today, once a request is approved, there is no way to stop it short of letting it run to `RECEIVED`. This sprint adds two distinct, narrowly-scoped actions -- **Cancel Reorder Request** (before a Purchase Order exists) and **Void Purchase Order** (after one exists) -- governed by a permanent repository rule that neither Reorder Requests nor Purchase Orders are ever deleted. Cancelling is an ordinary terminal status transition, the same shape every prior stage on this object already uses. Voiding never touches the existing, immutable `reorder_purchase_orders` document; it creates a new, separate, append-only audit record instead, mirroring the `inventory_actions`-vs-`inventory_transactions` precedent already established elsewhere in this codebase.

## Sprint objective

A user with the right authorization can stop an erroneous Reorder Request before it's ordered, or void an erroneous Purchase Order after it's ordered, in both cases leaving a permanent, reason-bearing audit trail and never deleting anything. Both actions require an explicit reason and an explicit confirmation naming the audit guarantee.

## Scope

- New terminal `CANCELLED` status on `reorder_requests`, reachable from `READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`, `PURCHASING_IN_PROGRESS`.
- New terminal `VOIDED` status on `reorder_requests`, reachable only from `ORDERED`.
- New collection `reorder_purchase_order_voids` -- the sole record of a void event, created atomically alongside the `VOIDED` transition, never mutating the original `reorder_purchase_orders` document.
- `firestore.rules` (both copies): new `reorder_requests` update branches for `CANCELLED` and `VOIDED`; new `reorder_purchase_order_voids` match block; **`reorder_purchase_orders`' existing `allow update, delete: if false` is explicitly unchanged**.
- New write functions in `domain/inventoryReorderRequests.js` (`cancelReorderRequest()`) and `domain/reorderPurchaseOrders.js` (`voidPurchaseOrder()`).
- `PartDetail.jsx`: two new actions (Cancel, Void), each gated to the correct stage and authorized actor, each requiring a nonblank reason and an explicit confirmation step with the exact copy specified below; two new terminal read-only cards (`ReorderRequestCancelled`, `ReorderRequestVoided`).
- `docs/BusinessEntityModel.md` Section 4/4b: new status values, fields, and the new collection documented.
- Rules-emulator test coverage for every new transition and the atomic cross-document invariant.

## Explicitly out of scope

- **No "Delete" action anywhere, for either object, under any name.** This is not a scope boundary subject to later revision within this sprint -- it is the permanent repository rule this sprint exists to enforce.
- Editing a Purchase Order's recorded details (supplier, quantity, dates) -- voiding and, if genuinely needed, recording a fresh corrected Purchase Order against a new Reorder Request is the only supported correction path. In-place PO editing is not this sprint's problem to solve and would conflict with the immutability guarantee.
- Re-opening a cancelled or voided request. Both are terminal; a genuinely still-needed part after cancellation means creating a new Reorder Request, not resurrecting the old one.
- Any change to `inventory_actions`/`inventory_transactions` -- this sprint does not touch stock counts, same posture as every prior sprint on this object.
- A new Notification Panel section for Cancel/Void events (matches Sprint 2.1.11's Receiving precedent -- a terminal, routine event doesn't need a broadcast).
- Cancelling/voiding more than one request at a time (bulk actions) -- single-document actions only, matching every existing action on this object.
- The Parts and Purchase Order Assignment Adoption initiative, and the Zero-history reorder behavior sprint's own closed scope -- both remain untouched and unrelated.

## Technical design

### `reorder_requests` schema additions

| Field | Type | Set on | Notes |
|---|---|---|---|
| `cancelledBy` | `string \| null` | `CANCELLED` transition | The acting admin/dispatcher's own `uid`, server-enforced (`== request.auth.uid`) |
| `cancelledAt` | `number \| null` | `CANCELLED` transition | Client-stamped `Date.now()`, same convention as every other timestamp on this object |
| `cancellationReason` | `string \| null` | `CANCELLED` transition | Required non-empty; this is the sole reason field for cancellation, distinct from `reviewNotes` (review-stage only) |
| `voidedBy` | `string \| null` | `VOIDED` transition | The acting assignee's own `uid`, server-enforced (`== request.auth.uid == resource.data.assignedToUserId`) |
| `voidedAt` | `number \| null` | `VOIDED` transition | Client-stamped `Date.now()`, must equal the linked void record's own `createdAt` (same "stamped once, referenced twice" pattern PR #92/Sprint 2.1.10's `orderedAt` already uses) |
| `voidReason` | `string \| null` | `VOIDED` transition | Required non-empty |

All six fields are reserved as `null` at creation (added to `hasCanonicalReorderRequestKeys()`/`hasCanonicalReorderRequestCreationBaseline()`, same posture as every prior sprint's new fields on this object).

### `REORDER_REQUEST_STATUS` additions

```js
export const REORDER_REQUEST_STATUS = {
  // ...existing eight values, unchanged...
  CANCELLED: "CANCELLED", // Terminal. Pre-order only.
  VOIDED: "VOIDED",       // Terminal. Post-order only, paired with a reorder_purchase_order_voids record.
};
```

### New collection: `reorder_purchase_order_voids`

One document per void event. **Document ID is the linked `reorder_purchase_orders` document's own ID** (which is itself the originating Reorder Request's ID) -- the same "ID equals the thing it's about" scheme `reorder_purchase_orders` already uses, which is what makes a second void attempt for the same Purchase Order structurally impossible: Firestore evaluates a second `create` at that ID as an `update`, denied unconditionally, exactly mirroring how `reorder_purchase_orders` itself prevents a duplicate Purchase Order per Reorder Request.

| Field | Type | Notes |
|---|---|---|
| `reorderPurchaseOrderId` | `string` | Equal to this document's own ID; explicit for readability/querying, not load-bearing for the invariant |
| `reorderRequestId` | `string` | Equal to the above (they share an ID scheme) -- explicit because the Reorder Request is the object most UI code already keys off of |
| `partId` | `string` | Copied from the linked Reorder Request at void time, for read convenience (avoids a second lookup to label a void record) |
| `voidedBy` | `string` | Must equal `request.auth.uid` |
| `voidedAt` | `number` | Must equal `reorder_requests`' own `voidedAt` for this transaction (see above) |
| `reason` | `string` | Required non-empty |
| `createdAt` | `number` | Auto-stamped, this record's own creation fact -- immutable, append-only, never updated once written |

**No update or delete path exists for this collection either** -- a void record, once written, is as permanent as the Purchase Order it describes. Correcting a mistaken void (e.g. wrong reason text) is not supported; the void itself, like everything else in this model, is not editable after the fact.

### Domain write functions

`domain/inventoryReorderRequests.js`:
```js
// Cancel Reorder Request -- the only writer of a cancellation.
// Reachable from READY_FOR_PARTS_MANAGER, ASSIGNED_TO_PARTS_ASSOCIATE,
// or PURCHASING_IN_PROGRESS. Requires a non-empty reason, validated
// here (not just in the UI), same posture as reviewReorderRequest()'s
// REJECTED-requires-reviewNotes check.
export function cancelReorderRequest(requestId, { reason }) { ... }
```

`domain/reorderPurchaseOrders.js`:
```js
// Void Purchase Order -- the only writer of a
// reorder_purchase_order_voids record. Atomically creates the void
// record AND transitions the linked Reorder Request to VOIDED, in a
// single Firestore client-side transaction (runTransaction()) --
// same atomicity pattern recordPurchaseOrder() already established
// for the ORDERED transition. The original reorder_purchase_orders
// document is read (to confirm it exists and to copy partId) but
// never written.
export function voidPurchaseOrder(reorderRequestId, { reason }) { ... }
```

### Authorization

- **Cancel: `isAdminOrDispatcher()`, unrestricted to any specific individual** -- matches the existing authorization level of every hand-off-type action on this object (review, assign). Rationale: cancellation is an oversight/correction action, not personal work in progress; restricting it to whichever individual currently happens to be the assignee would block the more common real case (Inventory or a manager realizing a request should never have proceeded, independent of who it's currently assigned to).
- **Void: `request.auth.uid == resource.data.assignedToUserId`, assignee-only** -- matches every other write this object permits once a specific Parts Associate owns active purchasing execution (`startPurchasing()`, `updatePurchasingProgress()`, `recordPurchaseOrder()`, `receiveReorderRequest()`). The person who recorded the Purchase Order is the one positioned to know it was wrong and correct the workflow. An admin override for Void is explicitly not included in this sprint -- if a real operational need for one emerges, it's a future, separately-authorized addition, not assumed here.

## Firestore Rules impact

Both `firestore.rules` copies. **`reorder_purchase_orders`' existing `allow update, delete: if false` block is untouched -- zero characters changed there.**

New `reorder_requests` update branches (added alongside the existing five transition branches, same file, same `allow update` block):

```
// Cancel Reorder Request -- terminal, admin/dispatcher, from any of
// the three pre-order active statuses. All earlier-stage fields
// pinned immutable, same discipline as every prior branch.
|| ((resource.data.status == "READY_FOR_PARTS_MANAGER"
      || resource.data.status == "ASSIGNED_TO_PARTS_ASSOCIATE"
      || resource.data.status == "PURCHASING_IN_PROGRESS")
   && request.resource.data.status == "CANCELLED"
   && request.resource.data.cancelledBy == request.auth.uid
   && request.resource.data.cancelledAt is number
   && request.resource.data.cancellationReason is string
   && request.resource.data.cancellationReason.size() > 0
   && <every earlier-stage field pinned == resource.data.*>
   && request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(["status", "cancelledBy", "cancelledAt", "cancellationReason"]))

// Void Purchase Order -- terminal, assignee-only, ORDERED only.
// Cross-document invariant: a matching reorder_purchase_order_voids
// record must exist in the SAME commit (mirrors PR #91/#98's
// getAfter()/existsAfter() pattern) -- a rules-independent write of
// this transition alone, without the void record landing atomically,
// is rejected.
|| (resource.data.status == "ORDERED"
   && request.resource.data.status == "VOIDED"
   && request.auth.uid == resource.data.assignedToUserId
   && request.resource.data.voidedBy == request.auth.uid
   && request.resource.data.voidedAt is number
   && request.resource.data.voidReason is string
   && request.resource.data.voidReason.size() > 0
   && <every earlier-stage field pinned == resource.data.*>
   && request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(["status", "voidedBy", "voidedAt", "voidReason"])
   && existsAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId))
   && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.voidedBy == request.auth.uid
   && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.voidedAt == request.resource.data.voidedAt
   && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.reorderRequestId == requestId)
```

New `reorder_purchase_order_voids` match block:

```
match /reorder_purchase_order_voids/{reorderPurchaseOrderId} {
  allow read: if isAdminOrDispatcher();
  allow create: if isAdminOrDispatcher()
    && request.auth.uid == get(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.assignedToUserId
    && get(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.status == "ORDERED"
    && request.resource.data.keys().hasOnly([
         "reorderPurchaseOrderId", "reorderRequestId", "partId",
         "voidedBy", "voidedAt", "reason", "createdAt"
       ])
    && request.resource.data.reorderPurchaseOrderId == reorderPurchaseOrderId
    && request.resource.data.reorderRequestId == reorderPurchaseOrderId
    && request.resource.data.partId == get(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.partId
    && request.resource.data.voidedBy == request.auth.uid
    && request.resource.data.voidedAt is number
    && request.resource.data.reason is string && request.resource.data.reason.size() > 0
    && request.resource.data.createdAt is number
    && existsAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId))
    && getAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.status == "VOIDED"
    && getAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.voidedBy == request.auth.uid
    && getAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.voidedAt == request.resource.data.voidedAt;
  allow update, delete: if false;
}
```

This is the same two-sided cross-document invariant shape Sprint 2.1.10 established for `ORDERED` (each side's rule checks the other side's post-transaction state) -- the void record cannot be created without the Reorder Request transitioning in the same commit, and vice versa.

**`reorder_purchase_orders` itself: no rule change of any kind.** Its `create` rule, `allow update, delete: if false`, and every existing field validation are exactly as they are today.

## UI impact

- `PartDetail.jsx`: a "Cancel Reorder Request" action appears on whichever active card is currently shown (`ReorderRequestAssignment`, `ReorderRequestStartPurchasing`, `ReorderRequestPurchasingUpdate`) for `isAdminOrDispatcher()` readers -- not a new card, an addition to the three existing ones, since it's available at all three of their statuses. Clicking it opens a required-reason field and a confirmation step; the confirmation step's copy is **"This action does not delete history. The record will remain visible for audit purposes."** verbatim. No action proceeds without both a non-empty reason and explicit confirmation.
- `ReorderRequestOrdered` (the `ORDERED`-stage card) gains a "Void Purchase Order" action, assignee-only (mirrors the existing assignee-only gating already on that stage's other actions), with the same required-reason-plus-confirmation shape and the same confirmation copy.
- Two new terminal, read-only cards: `ReorderRequestCancelled` (shows `cancelledBy` resolved via `resolveActorDisplayName()` from PR #107, `cancelledAt`, `cancellationReason`) and `ReorderRequestVoided` (shows `voidedBy` resolved the same way, `voidedAt`, `voidReason`, and -- read via `hooks/useReorderPurchaseOrderVoids.js`, a new realtime hook mirroring `usePurchaseOrderForReorderRequest()` -- the void record's own fields for completeness).
- Neither new action is ever labeled "Delete," "Remove," "Discard," or any synonym, in code, UI copy, or comments -- "Cancel Reorder Request" and "Void Purchase Order" are the only two labels, ever, per the standing repository rule.
- Parts Manager Queue / Parts Associate Waiting / Parts Associate In Progress: no code change required. Each queue's `useReorderRequestsByStatus()`/`useReorderRequestsAssignedTo()` call is already scoped to one specific active status; `CANCELLED`/`VOIDED` requests simply never match those queries, the same "no extra removal logic needed" pattern every prior terminal transition on this object has already relied on.

## Testing strategy

New file `functions/test/reorderRequestCancellationRules.test.js`, same zero-new-dependency posture (`firebase-admin` + Node's built-in `fetch` against the emulator REST APIs) as the existing two Rules-emulator test files.

**Cancel:**
- Happy path from each of the three reachable statuses (`READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`, `PURCHASING_IN_PROGRESS`), admin and dispatcher both.
- Rejected from every non-reachable status: `PENDING_REVIEW`, `ORDERED`, `RECEIVED`, and (once created) `CANCELLED`/`VOIDED` themselves -- a cancelled or voided request cannot be cancelled again.
- Rejected without a `cancellationReason`, and with an empty-string one.
- Rejected for a signed-in technician (non-admin/dispatcher).
- Earlier-stage fields (`assignedToUserId`, `purchasingStartedAt`, etc., whichever apply at each source status) confirmed pinned/unchanged after cancellation.

**Void:**
- Happy path from `ORDERED`, assignee only, with the matching `reorder_purchase_order_voids` record created in the same call and its fields verified.
- Rejected from every other status, including `RECEIVED` (a received request cannot retroactively be voided).
- Rejected for a non-assignee admin/dispatcher user (confirms this stays assignee-only, not admin-overridable, per the Architecture Decision).
- Rejected without a `voidReason`, and with an empty-string one.
- **Cross-document invariant, rules-independent write attempt**: an attempt to transition `reorder_requests` to `VOIDED` in isolation, without a matching `reorder_purchase_order_voids` document landing in the same commit, is rejected -- mirrors the exact test shape PR #77/#98 already established for `ORDERED`/`RECEIVED`.
- **Double-void rejected**: a second `create` attempt against the same `reorder_purchase_order_voids/{id}` (simulating a retry or a race) is evaluated as an `update` and denied.
- **Original document confirmed untouched**: after a successful void, a direct read of the original `reorder_purchase_orders/{id}` document is byte-identical to its pre-void state -- proves the immutability guarantee actually held, not just that the rule text looks right.

**Manual/live verification** (this repo's `run-field-ops-app-vite` skill, once implementation exists): walk one request to `ORDERED`, void it, confirm the confirmation copy renders exactly as specified, confirm the original Purchase Order's details are still visible and unchanged on read, confirm the request disappears from every active queue.

## Rollback strategy

Every write in this sprint is additive -- new statuses, new fields (all nullable/reserved), a new collection, new Rules branches alongside existing ones. Nothing existing is modified or removed. If a defect is found post-merge:
- **Not yet deployed**: revert the PR(s) normally, no live impact (matches every prior sprint's own posture -- merge and deploy are separate, explicit steps).
- **Already deployed**: the new Rules branches can be removed in a follow-up deploy without affecting any other transition -- they're additive `||` branches, not modifications to existing ones. Any `CANCELLED`/`VOIDED` documents or `reorder_purchase_order_voids` records already created by the time of rollback remain exactly as they are (this sprint's entire premise is that nothing it creates is ever deleted -- rolling back the code doesn't and must not delete data it already wrote). No step in this sprint is irreversible at the *code* level; the *data* it creates is permanent by design, which is the point, not a rollback hazard.

## Acceptance criteria

- [ ] `REORDER_REQUEST_STATUS` includes `CANCELLED` and `VOIDED`.
- [ ] `reorder_requests` gains `cancelledBy`/`cancelledAt`/`cancellationReason`/`voidedBy`/`voidedAt`/`voidReason`, reserved `null` at creation.
- [ ] New `reorder_purchase_order_voids` collection exists, `create`-only, document ID equals the linked Purchase Order's own ID.
- [ ] `firestore.rules` (both copies, byte-identical): new `CANCELLED` branch (3 reachable source statuses, admin/dispatcher, reason required); new `VOIDED` branch (assignee-only, `ORDERED` only, cross-document invariant against `reorder_purchase_order_voids`); `reorder_purchase_orders`' existing rule block unchanged, verified via diff.
- [ ] `cancelReorderRequest()` and `voidPurchaseOrder()` are the sole writers of their respective transitions; no component calls Firestore directly.
- [ ] `PartDetail.jsx`: Cancel available from all three pre-order active stages (admin/dispatcher); Void available at `ORDERED` (assignee only); both require a nonblank reason and an explicit confirmation with the exact specified copy; neither is ever labeled "Delete" anywhere.
- [ ] Two new terminal read-only cards, both resolving actor display names via PR #107's `resolveActorDisplayName()`, never a raw uid.
- [ ] Every active queue automatically excludes `CANCELLED`/`VOIDED` requests, verified live, no new filtering code required.
- [ ] `docs/BusinessEntityModel.md` Section 4/4b updated with the new statuses, fields, and collection.
- [ ] `npm run build && npm run lint` / `npx tsc --noEmit` clean.
- [ ] Rules-emulator test suite: every case in Testing strategy passing, including the cross-document invariant and double-void rejection cases, run against a fresh emulator.
- [ ] Live production verification per `docs/DelegationCharter.md` Section 6 before any PR in this sprint is marked complete.

## Risks

- **Rules diff size.** Two new branches plus a new collection's match block is a larger single-PR diff than most prior sprints on this object if implemented as one PR -- the Assessment's revised Estimated PR count (3 PRs) exists specifically to keep each PR's diff reviewable, matching this initiative's established one-concern-per-PR discipline.
- **Confirmation-copy drift.** The exact required confirmation string is a hard requirement, not a suggestion -- a future edit to that copy (rewording "for clarity") would silently violate the Owner's standing requirement unless reviewers know to check the literal text, not just that a confirmation step exists.
- **No admin override for Void.** If an assignee is unavailable (left the company, account issue) and a Purchase Order genuinely needs voiding, there is currently no path -- this is a known, accepted gap per the Architecture Decision, not an oversight, but worth surfacing here so it isn't rediscovered as a "bug" later without this context.

## Open questions

None remaining that block implementation -- the Architecture Decision resolved every item the Assessment raised. Any question that surfaces during implementation (e.g. exact card placement, exact button copy beyond the mandated confirmation string) is an implementation detail, not an open architectural question, per this Specification's own Technical design/UI impact sections above.

## Approval

Awaiting ChatGPT Final Review of this Specification before an Implementation Plan is drafted. **No code has been written for this sprint.**
