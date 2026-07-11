---
artifact_type: specification
gate: Sprint Specification
status: Approved
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/reorder-request-cancellation.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 108
target_release: Release 2.1 -- Inventory to Procurement workflow chain
---

# Sprint Specification: Governed Cancel/Void for Reorder Request and Reorder Purchase Order

**Architecture Review:** `docs/assessments/reorder-request-cancellation.md`'s "Architecture Decision" section -- Approved 2026-07-11 (Option 4, the append-only void-record model). **Revised following ChatGPT Specification Review (REQUEST CHANGES) and re-reviewed -- APPROVED to advance to the Implementation Plan gate, 2026-07-11.** All nine corrections from the REQUEST CHANGES round (authorization contract, cross-document audit binding, Purchase-Order-existence proof, reason validation, schema deployment sequence, legacy-document behavior, test coverage, rollback language, rebase) confirmed addressed by ChatGPT's re-review. No code has been written; this Specification is approved, the Implementation Plan (`docs/implementation-plans/reorder-request-cancellation.md`) is authorized to begin, but Owner Merge Authorization and Owner Deployment Authorization remain separately ungranted.

## Executive summary

Closes the last open gap in the Reorder Request lifecycle this project has repeatedly flagged: today, once a request is approved, there is no way to stop it short of letting it run to `RECEIVED`. This sprint adds two distinct, narrowly-scoped actions -- **Cancel Reorder Request** (before a Purchase Order exists) and **Void Purchase Order** (after one exists) -- governed by a permanent repository rule that neither Reorder Requests nor Purchase Orders are ever deleted. Cancelling is an ordinary terminal status transition, the same shape every prior stage on this object already uses. Voiding never touches the existing, immutable `reorder_purchase_orders` document; it creates a new, separate, append-only audit record instead, mirroring the `inventory_actions`-vs-`inventory_transactions` precedent already established elsewhere in this codebase.

## Sprint objective

A user with the right authorization can stop an erroneous Reorder Request before it's ordered, or void an erroneous Purchase Order after it's ordered, in both cases leaving a permanent, reason-bearing audit trail and never deleting anything. Both actions require an explicit, genuinely non-blank reason and an explicit confirmation naming the audit guarantee.

## Scope

- New terminal `CANCELLED` status on `reorder_requests`, reachable from `READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`, `PURCHASING_IN_PROGRESS`.
- New terminal `VOIDED` status on `reorder_requests`, reachable only from `ORDERED`.
- New collection `reorder_purchase_order_voids` -- the sole record of a void event, created atomically alongside the `VOIDED` transition, never mutating the original `reorder_purchase_orders` document.
- `firestore.rules` (both copies): new `reorder_requests` update branches for `CANCELLED` and `VOIDED`; new `reorder_purchase_order_voids` match block; **`reorder_purchase_orders`' existing `allow update, delete: if false` is explicitly unchanged**.
- A **transitional, then tightened**, expand/contract change to `hasCanonicalReorderRequestKeys()`/`hasCanonicalReorderRequestCreationBaseline()` to add the six new `reorder_requests` fields -- see "Schema deployment sequence" below. This is its own multi-step rollout, not a single Rules edit.
- New write functions in `domain/inventoryReorderRequests.js` (`cancelReorderRequest()`) and `domain/reorderPurchaseOrders.js` (`voidPurchaseOrder()`).
- `PartDetail.jsx`: two new actions (Cancel, Void), each gated to the correct stage and authorized actor, each requiring a genuinely non-blank reason and an explicit confirmation step with the exact copy specified below; two new terminal read-only cards (`ReorderRequestCancelled`, `ReorderRequestVoided`).
- `docs/BusinessEntityModel.md` Section 4/4b: new status values, fields, and the new collection documented.
- Rules-emulator test coverage for every new transition, the atomic cross-document invariant, the deployment-sequence's transitional/tightened Rules states, and legacy-document behavior.

## Explicitly out of scope

- **No "Delete" action anywhere, for either object, under any name.** This is not a scope boundary subject to later revision within this sprint -- it is the permanent repository rule this sprint exists to enforce.
- Editing a Purchase Order's recorded details (supplier, quantity, dates) -- voiding and, if genuinely needed, recording a fresh corrected Purchase Order against a new Reorder Request is the only supported correction path. In-place PO editing is not this sprint's problem to solve and would conflict with the immutability guarantee.
- Re-opening a cancelled or voided request. Both are terminal; a genuinely still-needed part after cancellation means creating a new Reorder Request, not resurrecting the old one.
- Any change to `inventory_actions`/`inventory_transactions` -- this sprint does not touch stock counts, same posture as every prior sprint on this object.
- A new Notification Panel section for Cancel/Void events (matches Sprint 2.1.11's Receiving precedent -- a terminal, routine event doesn't need a broadcast).
- Cancelling/voiding more than one request at a time (bulk actions) -- single-document actions only, matching every existing action on this object.
- The Parts and Purchase Order Assignment Adoption initiative, and the Zero-history reorder behavior sprint's own closed scope -- both remain untouched and unrelated.
- **An admin override for Void.** Void remains restricted to `isAdminOrDispatcher() AND` the current assignee (see Authorization, corrected below) -- there is no path for an admin who is not the assignee to void a Purchase Order in this sprint. A known, accepted gap, not an oversight.
- **The `ROLES.TECHNICIAN`-has-no-`isAdminOrDispatcher()` limitation.** A technician-security-role assignee could never Void even though they're `resource.data.assignedToUserId`, because `isAdminOrDispatcher()` is required unconditionally by the outer `allow update` gate this branch lives inside (see Authorization below). This is a pre-existing, repository-wide limitation on this object (every transition on `reorder_requests`, including the ones already live, requires `isAdminOrDispatcher()` first) -- not something this sprint introduces, changes, or is responsible for fixing.

## Technical design

### `reorder_requests` schema additions

| Field | Type | Set on | Notes |
|---|---|---|---|
| `cancelledBy` | `string \| null` | `CANCELLED` transition | The acting admin/dispatcher's own `uid`, server-enforced (`== request.auth.uid`) |
| `cancelledAt` | `number \| null` | `CANCELLED` transition | Client-stamped `Date.now()`, same convention as every other timestamp on this object |
| `cancellationReason` | `string \| null` | `CANCELLED` transition | Required genuinely non-blank (see "Reason validation" below) -- this is the sole reason field for cancellation, distinct from `reviewNotes` (review-stage only) |
| `voidedBy` | `string \| null` | `VOIDED` transition | The acting assignee's own `uid`, server-enforced (`== request.auth.uid == resource.data.assignedToUserId`, in addition to `isAdminOrDispatcher()` -- see Authorization) |
| `voidedAt` | `number \| null` | `VOIDED` transition | Client-stamped `Date.now()`. **Exactly one timestamp is generated for a void event** -- `voidPurchaseOrder()` calls `Date.now()` once and writes that same value as both `reorder_requests.voidedAt` and `reorder_purchase_order_voids.createdAt`. There is no separate "auto-stamped" value; `createdAt == voidedAt` is a hard equality Rules requirement, not two independently-generated timestamps that happen to usually match. This is the identical pattern already established for `orderedAt`/`reorder_purchase_orders.createdAt` (see that Rules comment: "`orderedAt` is required to equal this document's own `createdAt`, since `recordPurchaseOrder()` intentionally stamps both fields with the same `now` value") -- Void reuses it exactly, not a new convention. |
| `voidReason` | `string \| null` | `VOIDED` transition | Required genuinely non-blank. **Must equal `reorder_purchase_order_voids.reason` for the same void event** (see the "Firestore Rules impact" section's reason-binding check below) -- these are the same fact, stored on both sides for read convenience, not two independent reason fields that happen to usually agree. |

All six fields are reserved as `null` at creation **once the schema deployment sequence below reaches its tightened state** -- see "Schema deployment sequence" for why this cannot be a single-step Rules edit, and "Legacy document behavior" for how a `reorder_requests` document created before this sprint (which has none of these six keys at all, not even as `null`) is still eligible to Cancel/Void.

**Cancel/Void branches never read any of these six fields from `resource.data`** -- they only ever appear in `request.resource.data` (the value being written). This is deliberate: a document that predates this sprint entirely, and so lacks these keys altogether, would raise a Rules evaluation error if a branch tried to read `resource.data.cancelledBy` (Firestore Rules do not silently default a genuinely absent map key to `null`). Because no branch does this, a legacy document transitions through Cancel/Void exactly the same way a fresh-schema document does, with no special-casing required.

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

Exactly six fields -- **`voidedAt` does not appear on this document.** The Reorder Request's `voidedAt` and this document's `createdAt` are Rules-enforced to be equal (see below), so there is exactly one generated timestamp value per void event, referenced from each side under that side's own field name -- not two independently-stamped values that happen to usually agree, which is the ambiguity ChatGPT's review flagged in an earlier draft of this table.

| Field | Type | Notes |
|---|---|---|
| `reorderPurchaseOrderId` | `string` | Equal to this document's own ID, which is also the linked `reorder_purchase_orders` document's own ID -- Rules verify this against a `get()` of that document (see the "Firestore Rules impact" section's Purchase-Order-existence proof below), not merely a self-referential string match |
| `reorderRequestId` | `string` | Equal to the above (they share an ID scheme) -- explicit because the Reorder Request is the object most UI code already keys off of |
| `partId` | `string` | Copied from the linked Reorder Request at void time, **and required to also equal the linked `reorder_purchase_orders` document's own `partId`** (three-way agreement: Reorder Request, Purchase Order, void record) |
| `voidedBy` | `string` | Must equal `request.auth.uid` |
| `reason` | `string` | Required genuinely non-blank. **Must equal `reorder_requests.voidReason` for the same void event** -- Rules enforce this via `getAfter()` on the Reorder Request side (see below), not merely convention. |
| `createdAt` | `number` | This record's own creation fact -- immutable, append-only, never updated once written. **Must equal `reorder_requests.voidedAt` for the same void event** (see the schema table above) -- the two are the same generated value, not independently-stamped. |

**No update or delete path exists for this collection either** -- a void record, once written, is as permanent as the Purchase Order it describes. Correcting a mistaken void (e.g. wrong reason text) is not supported; the void itself, like everything else in this model, is not editable after the fact.

### Domain write functions

`domain/inventoryReorderRequests.js`:
```js
// Cancel Reorder Request -- the only writer of a cancellation.
// Reachable from READY_FOR_PARTS_MANAGER, ASSIGNED_TO_PARTS_ASSOCIATE,
// or PURCHASING_IN_PROGRESS. Requires a genuinely non-blank reason,
// trimmed client-side before the write (Rules independently reject a
// whitespace-only value server-side too -- see "Reason validation"),
// same posture as reviewReorderRequest()'s REJECTED-requires-reviewNotes
// check.
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
// document is read (to confirm it exists, confirm its status is
// ORDERED, and copy partId) but never written. Stamps Date.now() into
// a local `now` variable exactly once and writes that same value as
// both reorder_requests.voidedAt and reorder_purchase_order_voids.createdAt
// -- never two separate Date.now() calls for one void event.
export function voidPurchaseOrder(reorderRequestId, { reason }) { ... }
```

### Authorization

- **Cancel: `isAdminOrDispatcher()`, unrestricted to any specific individual** -- matches the existing authorization level of every hand-off-type action on this object (review, assign). Rationale: cancellation is an oversight/correction action, not personal work in progress; restricting it to whichever individual currently happens to be the assignee would block the more common real case (Inventory or a manager realizing a request should never have proceeded, independent of who it's currently assigned to).
- **Void: `isAdminOrDispatcher() AND request.auth.uid == resource.data.assignedToUserId` -- both conditions, not "assignee-only" in isolation.** **Corrected in this revision.** The live `reorder_requests` `allow update` rule (`firestore.rules`) is structured as one outer gate wrapping every transition branch: `allow update: if isAdminOrDispatcher() && (<branch 1> || <branch 2> || ...)`. Every existing transition this object has, including the ones already live and already described elsewhere as "assignee-only" (`startPurchasing()`, `updatePurchasingProgress()`, `recordPurchaseOrder()`, `receiveReorderRequest()`), is in fact gated by `isAdminOrDispatcher()` **first**, and the assignee check second, inside that same outer gate -- there has never been a branch on this object reachable by assignee identity alone. Void's Rules branch is a new `||` arm inside that same outer `isAdminOrDispatcher() && (...)` expression, so it inherits the same double requirement structurally; this Specification's Authorization/UI-gating/test-plan/acceptance-criteria/known-limitation language is corrected throughout to state both conditions explicitly, rather than describing Void as "assignee-only" the way an earlier draft did, which contradicted the Rules pseudocode it also included.
  - **Consequence, stated explicitly per the review's instruction:** a signed-in `technician`-security-role user who happens to be `resource.data.assignedToUserId` is **not** eligible to Void, because `isAdminOrDispatcher()` fails for that security role regardless of assignee identity. This is not a gap this sprint introduces or is responsible for closing -- it is the same pre-existing, repository-wide property already true of every other transition on this object (a technician assignee already cannot `startPurchasing()`, record a Purchase Order, or receive one, for the identical reason). Out of scope here; tracked as a standing, separate limitation, not a defect in this Specification.
  - An admin override for Void (i.e., an admin/dispatcher who is *not* the assignee succeeding) is explicitly not included in this sprint -- if a real operational need for one emerges, it's a future, separately-authorized addition, not assumed here.

## Schema deployment sequence

**New in this revision.** `hasCanonicalReorderRequestKeys()`/`hasCanonicalReorderRequestCreationBaseline()` (`firestore.rules`) currently enforce an **exact** key set on every `reorder_requests` create (`.hasOnly([...]) && .hasAll([...])` -- not "at least these keys," precisely these keys, no more, no fewer). Adding six new keys to that exact set cannot be a single-step Rules change: deploying the stricter Rules first would reject `createReorderRequest()`'s current, still-live writes (which don't send the six new keys); deploying an updated writer first would be rejected by the current, still-live Rules (which don't accept six extra keys under `.hasOnly()`). This is the identical hazard the Zero-history reorder behavior sprint (PR #91/#92/#98/#103) already solved once on this exact object, using an explicit expand/contract sequence -- this sprint reuses that sequence, not a new technique:

**A. Transitional Rules** (its own PR, Rules-only). `hasCanonicalReorderRequestKeys()`/`...CreationBaseline()` are changed to accept **either**:
  - the current canonical creation shape, with **none** of the six new keys present at all (`.hasOnly()` on the existing 24-key list, unchanged), **or**
  - the new canonical creation shape, with **all six** new keys present and explicitly `null` (`.hasOnly()` on the existing list **plus** the six new keys, and `.hasAll()` requiring every one of the six to be present as `null` in the creation baseline).

  Partial presence (e.g. three of the six new keys, or the six present but not all `null`) is rejected under both branches -- this is an explicit `||` between two mutually-exclusive exact-shape checks, not a loosened "at least the required keys" rule. No application code changes in this PR; `createReorderRequest()` is untouched and continues sending the old shape, which the transitional Rules still accept.

**B. Writer deployment** (its own PR, frontend-only, no Rules change). `createReorderRequest()` is updated to always include all six new fields as explicit `null` on every new create. Auto-deploys at merge, same as every prior frontend-only PR in this initiative (e.g. PR #105). The transitional Rules from step A already accept this shape, so this PR carries zero Rules risk.

**C. Live confirmation** (no PR -- an operational verification step, recorded in `docs/DECISIONS.md`, same as this session's own PR #109/#111 index-deployment records). After step B is live, confirm: (i) the deployed frontend is serving the updated `createReorderRequest()` (matches the merge commit, same verification method already used for prior frontend-only deploys this session); (ii) a sample of newly-created `reorder_requests` documents (post-step-B) all carry the six new fields as `null` -- i.e., no post-deployment create landed in the old, six-fields-absent shape. This confirmation must complete, and be recorded, before step D's Rules PR is drafted.

**D. Tightened Rules** (its own PR, Rules-only, drafted only after C is confirmed). The transitional "old shape, no new keys" branch from step A is removed entirely; `hasCanonicalReorderRequestKeys()`/`...CreationBaseline()` require the six new keys unconditionally on every new create, same as every other canonical field.

**E. Final deployment and verification** (operational step, recorded in `docs/DECISIONS.md`). Deploy step D's Rules; confirm live (a test create attempt in the old, six-fields-absent shape is now rejected -- the mirror-image confirmation of step C).

**The Cancel/Void `update`-path Rules (new `CANCELLED`/`VOIDED` branches, the `reorder_purchase_order_voids` match block) are additive `||` arms, not changes to an existing exact-key gate, and do not carry this same expand/contract hazard.** They may deploy in a single step, but only **after** step E -- they read/write the same six fields step E's tightened Rules guarantee are present as `null` on every document created from that point forward. Any `reorder_requests` document created **before** step A (this sprint's true legacy documents, entirely missing the six keys) is handled separately -- see "Legacy document behavior" below, which does not depend on this deployment sequence at all, precisely because Cancel/Void never reads the six fields from `resource.data`.

**Revised PR breakdown** (supersedes the Assessment's earlier 3-PR estimate, which did not account for this sequence): at minimum five PRs for the schema/data path (A, B, the C confirmation is not a PR, D, E is a deployment action not a new PR) plus the Cancel/Void feature PRs (Cancel write-path/Rules, Void write-path/Rules/`reorder_purchase_order_voids` collection, UI) -- **at least 3 Rules-relevant PRs total (A, D, and the Cancel/Void update-path Rules), each requiring its own independent Rules-focused Final Review and separate Owner Deployment Authorization**, distinct from and in addition to the code-only PRs. Exact final count remains the Implementation Plan's call, not fixed here -- this is a planning estimate, corrected to actually reflect the sequence above rather than assuming a single Rules PR could carry both the schema expansion and the new transitions at once.

## Firestore Rules impact

Both `firestore.rules` copies (verified byte-identical to each other in this repository as of this revision). **`reorder_purchase_orders`' existing `allow update, delete: if false` block is untouched -- zero characters changed there.**

New `reorder_requests` update branches (added as new `||` arms **inside the existing outer `allow update: if isAdminOrDispatcher() && (...)` expression** -- shown below with that outer gate explicit, not implied, per the review's correction):

```
allow update: if isAdminOrDispatcher()
  && (
    // ...existing five transition branches, unchanged...

    // Cancel Reorder Request -- terminal. Reachable from any of the
    // three pre-order active statuses. Authorization is
    // isAdminOrDispatcher() alone (the outer gate above) -- no
    // additional per-user restriction, matching every other hand-off-
    // type transition on this object. All earlier-stage fields pinned
    // immutable, same discipline as every prior branch. This branch
    // never reads cancelledBy/cancelledAt/cancellationReason from
    // resource.data -- see "Legacy document behavior."
    || ((resource.data.status == "READY_FOR_PARTS_MANAGER"
          || resource.data.status == "ASSIGNED_TO_PARTS_ASSOCIATE"
          || resource.data.status == "PURCHASING_IN_PROGRESS")
       && request.resource.data.status == "CANCELLED"
       && request.resource.data.cancelledBy == request.auth.uid
       && request.resource.data.cancelledAt is number
       && request.resource.data.cancellationReason is string
       && request.resource.data.cancellationReason.matches('.*\\S.*')
       && <every earlier-stage field pinned == resource.data.*>
       && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(["status", "cancelledBy", "cancelledAt", "cancellationReason"]))

    // Void Purchase Order -- terminal. Reachable only from ORDERED.
    // Authorization is isAdminOrDispatcher() (the outer gate above)
    // AND request.auth.uid == resource.data.assignedToUserId -- BOTH
    // conditions, not assignee identity alone (see Authorization
    // above for the corrected framing and the technician-assignee
    // limitation this implies). Three checks beyond the existing
    // ORDERED->RECEIVED branch's shape:
    //   (1) Purchase-Order-existence proof -- the linked
    //       reorder_purchase_orders document must actually exist,
    //       must agree on reorderRequestId and partId, and must
    //       itself be status ORDERED. Read via a plain get() (the
    //       document already exists BEFORE this transaction and is
    //       never written by it -- existsAfter()/getAfter() are for
    //       documents this SAME transaction creates, which is not the
    //       case here; reorder_purchase_orders was created in a prior,
    //       already-committed transaction back when the request first
    //       reached ORDERED).
    //   (2) Cross-document invariant on the NEW reorder_purchase_order_voids
    //       record -- mirrors PR #91/#98's getAfter()/existsAfter()
    //       pattern for a document this transaction DOES create.
    //   (3) Reason binding -- this branch's voidReason must equal the
    //       void record's own reason (getAfter()), not merely be
    //       independently non-blank.
    || (resource.data.status == "ORDERED"
       && request.resource.data.status == "VOIDED"
       && request.auth.uid == resource.data.assignedToUserId
       && request.resource.data.voidedBy == request.auth.uid
       && request.resource.data.voidedAt is number
       && request.resource.data.voidReason is string
       && request.resource.data.voidReason.matches('.*\\S.*')
       && <every earlier-stage field pinned == resource.data.*>
       && request.resource.data.diff(resource.data).affectedKeys()
            .hasOnly(["status", "voidedBy", "voidedAt", "voidReason"])
       // (1) Purchase-Order-existence proof. resource.data.purchaseOrderId
       // == requestId is already guaranteed by the pinned-earlier-stage-
       // fields check above (purchaseOrderId was set, and has been
       // pinned unchanged, since the PURCHASING_IN_PROGRESS -> ORDERED
       // transition) -- restated here explicitly, not merely relied on
       // implicitly, per the review's requirement.
       && resource.data.purchaseOrderId == requestId
       && exists(/databases/$(database)/documents/reorder_purchase_orders/$(requestId))
       && get(/databases/$(database)/documents/reorder_purchase_orders/$(requestId)).data.reorderRequestId == requestId
       && get(/databases/$(database)/documents/reorder_purchase_orders/$(requestId)).data.partId == resource.data.partId
       && get(/databases/$(database)/documents/reorder_purchase_orders/$(requestId)).data.status == "ORDERED"
       // (2) Cross-document invariant -- the void record.
       && existsAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId))
       && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.voidedBy == request.auth.uid
       && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.createdAt == request.resource.data.voidedAt
       && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.reorderRequestId == requestId
       && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.reorderPurchaseOrderId == requestId
       && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.partId == resource.data.partId
       // (3) Reason binding.
       && getAfter(/databases/$(database)/documents/reorder_purchase_order_voids/$(requestId)).data.reason == request.resource.data.voidReason)
  );
```

New `reorder_purchase_order_voids` match block:

```
match /reorder_purchase_order_voids/{reorderPurchaseOrderId} {
  allow read: if isAdminOrDispatcher();
  allow create: if isAdminOrDispatcher()
    && request.auth.uid == get(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.assignedToUserId
    && get(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.status == "ORDERED"
    // Purchase-Order-existence proof, same three checks as the
    // reorder_requests-side branch above, defense-in-depth (this
    // codebase's established style -- e.g. reorder_purchase_orders'
    // own create rule already double-checks the linked Reorder
    // Request's pre-transaction status directly rather than relying
    // solely on the other side's invariant).
    && exists(/databases/$(database)/documents/reorder_purchase_orders/$(reorderPurchaseOrderId))
    && get(/databases/$(database)/documents/reorder_purchase_orders/$(reorderPurchaseOrderId)).data.reorderRequestId == reorderPurchaseOrderId
    && get(/databases/$(database)/documents/reorder_purchase_orders/$(reorderPurchaseOrderId)).data.status == "ORDERED"
    && request.resource.data.keys().hasOnly([
         "reorderPurchaseOrderId", "reorderRequestId", "partId",
         "voidedBy", "reason", "createdAt"
       ])
    && request.resource.data.reorderPurchaseOrderId == reorderPurchaseOrderId
    && request.resource.data.reorderRequestId == reorderPurchaseOrderId
    && request.resource.data.partId == get(/databases/$(database)/documents/reorder_purchase_orders/$(reorderPurchaseOrderId)).data.partId
    && request.resource.data.voidedBy == request.auth.uid
    && request.resource.data.reason is string && request.resource.data.reason.matches('.*\\S.*')
    && request.resource.data.createdAt is number
    && existsAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId))
    && getAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.status == "VOIDED"
    && getAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.voidedBy == request.auth.uid
    && getAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.voidedAt == request.resource.data.createdAt
    && getAfter(/databases/$(database)/documents/reorder_requests/$(reorderPurchaseOrderId)).data.voidReason == request.resource.data.reason;
  allow update, delete: if false;
}
```

**Reason validation, corrected in this revision.** `.size() > 0` alone accepts a whitespace-only string (e.g. `"   "`), which contradicts "non-blank." Every reason field (`cancellationReason`, `voidReason`, `reorder_purchase_order_voids.reason`) instead uses `.matches('.*\\S.*')` -- a Rules-compatible RE2 regex requiring at least one non-whitespace character, rejecting both the empty string and a whitespace-only one. `domain/inventoryReorderRequests.js`'s `cancelReorderRequest()` and `domain/reorderPurchaseOrders.js`'s `voidPurchaseOrder()` additionally `.trim()` the operator-supplied reason before writing it (client-side normalization, for a clean stored value), but the Rules-side regex check does not trust that trimming happened -- it independently rejects whitespace-only input regardless of what the client sent.

This is the same two-sided cross-document invariant shape Sprint 2.1.10 established for `ORDERED` (each side's rule checks the other side's post-transaction state) -- the void record cannot be created without the Reorder Request transitioning in the same commit, and vice versa, now additionally bound on `reason`/`createdAt`-`voidedAt` agreement and the Purchase-Order-existence proof, neither of which the pre-revision draft enforced.

**`reorder_purchase_orders` itself: no rule change of any kind.** Its `create` rule, `allow update, delete: if false`, and every existing field validation are exactly as they are today.

## Legacy document behavior

**New section in this revision.** `reorder_requests` documents created before this sprint's schema deployment sequence (step A) entirely lack the six new keys -- not `null`, genuinely absent from the document. This is a distinct, older category from the "transitional-window" documents step A/B produce (which have the six keys, explicitly `null`).

- An eligible legacy document (one at `READY_FOR_PARTS_MANAGER`/`ASSIGNED_TO_PARTS_ASSOCIATE`/`PURCHASING_IN_PROGRESS`, or `ORDERED`) may still transition to `CANCELLED` or `VOIDED` by adding only the three fields relevant to that specific transition (`cancelledBy`/`cancelledAt`/`cancellationReason`, or `voidedBy`/`voidedAt`/`voidReason`) -- the existing `diff(resource.data).affectedKeys().hasOnly([...])` restriction on each branch already limits the write to exactly those fields regardless of what the document previously contained, so this requires no special-casing beyond what's already in the branch.
- **Unrelated new fields are never backfilled** during these transitions -- cancelling a legacy document never adds `voidedBy`/`voidedAt`/`voidReason` (they remain genuinely absent, not `null`), and voiding never adds `cancelledBy`/`cancelledAt`/`cancellationReason`. Only the three fields for the transition that actually happened are written.
- **Every pre-existing lifecycle field remains pinned**, exactly as it does for a fresh-schema document -- the "every earlier-stage field pinned == `resource.data`.*" checks already in each branch apply identically; none of those fields are new in this sprint, so none of them are ever absent on an eligible document regardless of its age.
- **Terminal legacy documents remain readable** -- the collection's `allow read: if isAdminOrDispatcher()` rule is unconditional and has no dependency on which keys a given document happens to contain.
- **No bulk migration is required or performed.** Because Cancel/Void never reads the six new fields from `resource.data` (see "Schema deployment sequence" above), and because the write only ever adds the three fields relevant to the transition that occurred, a legacy document does not need to be touched, backfilled, or migrated before it becomes eligible for Cancel/Void -- eligibility depends only on `resource.data.status`, a field every `reorder_requests` document has always had.

## UI impact

- `PartDetail.jsx`: a "Cancel Reorder Request" action appears on whichever active card is currently shown (`ReorderRequestAssignment`, `ReorderRequestStartPurchasing`, `ReorderRequestPurchasingUpdate`) for `isAdminOrDispatcher()` readers -- not a new card, an addition to the three existing ones, since it's available at all three of their statuses. Clicking it opens a required-reason field (rejecting a whitespace-only entry client-side, matching the Rules-side check) and a confirmation step; the confirmation step's copy is **"This action does not delete history. The record will remain visible for audit purposes."** verbatim. No action proceeds without both a genuinely non-blank reason and explicit confirmation.
- `ReorderRequestOrdered` (the `ORDERED`-stage card) gains a "Void Purchase Order" action, gated to a reader who is **both `isAdminOrDispatcher()` AND the current assignee** (corrected in this revision -- not "assignee-only" in isolation; mirrors the existing gating already on that stage's other actions, which are subject to the identical double condition). A signed-in technician who happens to be the assignee does not see this action, for the same reason they don't see `startPurchasing()`/`recordPurchaseOrder()` today -- a pre-existing, unrelated limitation, not new here. Same required-reason-plus-confirmation shape and the same confirmation copy as Cancel.
- Two new terminal, read-only cards: `ReorderRequestCancelled` (shows `cancelledBy` resolved via `resolveActorDisplayName()` from PR #107, `cancelledAt`, `cancellationReason`) and `ReorderRequestVoided` (shows `voidedBy` resolved the same way, `voidedAt`, `voidReason`, and -- read via `hooks/useReorderPurchaseOrderVoids.js`, a new realtime hook mirroring `usePurchaseOrderForReorderRequest()` -- the void record's own fields for completeness). **Dependency resolved (this revision):** PR #107 merged (`field-ops-app-vite/src/hooks/useEmployeeDirectory.js`'s `resolveActorDisplayName()`, merge commit `5911fd9`) -- these two cards can consume it directly, no fallback/follow-up needed.
- Neither new action is ever labeled "Delete," "Remove," "Discard," or any synonym, in code, UI copy, or comments -- "Cancel Reorder Request" and "Void Purchase Order" are the only two labels, ever, per the standing repository rule.
- Parts Manager Queue / Parts Associate Waiting / Parts Associate In Progress: no code change required. Each queue's `useReorderRequestsByStatus()`/`useReorderRequestsAssignedTo()` call is already scoped to one specific active status; `CANCELLED`/`VOIDED` requests simply never match those queries, the same "no extra removal logic needed" pattern every prior terminal transition on this object has already relied on.

## Testing strategy

New file `functions/test/reorderRequestCancellationRules.test.js`, same zero-new-dependency posture (`firebase-admin` + Node's built-in `fetch` against the emulator REST APIs) as the existing two Rules-emulator test files. Coverage below is corrected/expanded per the review; new cases are marked **(new)**.

**Cancel:**
- Happy path from each of the three reachable statuses (`READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`, `PURCHASING_IN_PROGRESS`), admin and dispatcher both.
- Rejected from every non-reachable status: `PENDING_REVIEW`, `ORDERED`, `RECEIVED`, and (once created) `CANCELLED`/`VOIDED` themselves -- a cancelled or voided request cannot be cancelled again.
- Rejected without a `cancellationReason`, with an empty string, and **(new)** with a whitespace-only string (e.g. `"   "`).
- Rejected for a signed-in technician (non-admin/dispatcher).
- Earlier-stage fields (`assignedToUserId`, `purchasingStartedAt`, etc., whichever apply at each source status) confirmed pinned/unchanged after cancellation.
- **(new)** A legacy fixture document (eligible status, entirely missing the six new keys) can still Cancel -- adds only `status`/`cancelledBy`/`cancelledAt`/`cancellationReason`; `voidedBy`/`voidedAt`/`voidReason` remain genuinely absent afterward, not backfilled as `null`.

**Void:**
- Happy path from `ORDERED`, matching admin/dispatcher assignee, with the matching `reorder_purchase_order_voids` record created in the same call and its fields verified (including `reason`/`createdAt` equal to the Reorder Request's `voidReason`/`voidedAt`).
- Rejected from every other status, including `RECEIVED` (a received request cannot retroactively be voided).
- **(new, corrected)** Rejected for the current assignee who is **not** admin/dispatcher (technician security role) -- confirms `isAdminOrDispatcher()` is required even when assignee identity matches.
- **(new)** Rejected for an admin/dispatcher who is **not** the current assignee -- confirms assignee identity is required even when `isAdminOrDispatcher()` passes. Together with the case above, proves Void requires both conditions, neither alone.
- **(new, restated as its own case)** Accepted for a matching admin/dispatcher assignee -- the actual happy-path authorization case, named explicitly rather than folded into the general happy path above.
- Rejected without a `voidReason`, with an empty string, and **(new)** with a whitespace-only string.
- **(new)** Rejected when `reorder_purchase_orders/{requestId}` is missing entirely -- a fixture `ORDERED` Reorder Request with no linked Purchase Order document (simulating a data-integrity anomaly the Purchase-Order-existence proof is meant to catch) is rejected before any void write succeeds.
- **(new)** Rejected when the Reorder Request's own `purchaseOrderId`, or the linked Purchase Order's `reorderRequestId`, or `partId`, mismatches the Reorder Request/void record -- separate fixtures for each of the three mismatch dimensions.
- **(new)** Rejected when the Reorder Request's `voidReason` and the void record's `reason` are written as different strings in the same attempted transaction.
- **(new)** Rejected when the Reorder Request's `voidedAt` and the void record's `createdAt` are written as different values in the same attempted transaction.
- **Cross-document invariant, rules-independent write attempt**: an attempt to transition `reorder_requests` to `VOIDED` in isolation, without a matching `reorder_purchase_order_voids` document landing in the same commit, is rejected -- mirrors the exact test shape PR #77/#98 already established for `ORDERED`/`RECEIVED`.
- **Double-void rejected**: a second `create` attempt against the same `reorder_purchase_order_voids/{id}` (simulating a retry or a race) is evaluated as an `update` and denied.
- **Original document confirmed untouched**: after a successful void, a direct read of the original `reorder_purchase_orders/{id}` document is byte-identical to its pre-void state -- proves the immutability guarantee actually held, not just that the rule text looks right.
- **(new)** A legacy fixture document (`ORDERED`, entirely missing the six new keys, with a correctly-linked `reorder_purchase_orders` document) can still Void -- adds only `status`/`voidedBy`/`voidedAt`/`voidReason`; `cancelledBy`/`cancelledAt`/`cancellationReason` remain genuinely absent afterward.

**Schema deployment sequence (new):**
- Transitional Rules (step A) accept a create in the old shape (no new keys) and reject a create with only some of the six new keys present (partial presence).
- Transitional Rules (step A) accept a create in the new shape (all six new keys present, all `null`) and reject one where any of the six is present but non-`null`.
- Tightened Rules (step D) reject the old, six-fields-absent creation shape -- the mirror-image case confirming the contract tightened as intended.
- Tightened Rules (step D) still accept the new shape (all six `null`) -- confirms tightening didn't also break the shape step B's writer produces.

**Manual/live verification** (this repo's `run-field-ops-app-vite` skill, once implementation exists): walk one request to `ORDERED`, void it, confirm the confirmation copy renders exactly as specified, confirm the original Purchase Order's details are still visible and unchanged on read, confirm the request disappears from every active queue.

## Rollback strategy

**Corrected in this revision** -- the prior draft's "deployed Rules branches can simply be removed" language did not account for the schema deployment sequence; once a newer writer or newer Rules state is live, removing the wrong thing can break production writes or strand a workflow state. Rollback is described per phase:

- **Before any deployment in this sprint** (PRs merged but not deployed, or not yet merged): revert normally, no live impact -- merge and deploy are separate, explicit steps, matching every prior sprint's own posture.
- **After step A (transitional Rules) deployed, before step B (writer) deployed:** the transitional Rules accept the old shape unconditionally, so `createReorderRequest()` (still on the old writer) is completely unaffected. Rolling back step A's deploy to the pre-transitional Rules is safe -- nothing has yet been created in the new shape.
- **After step B (writer) deployed, before step D (tightening):** documents now exist in the new shape (six fields, `null`) alongside older documents in the old shape; the transitional Rules from step A accept both, so neither is at risk from a Rules perspective. The writer itself (step B) can be safely rolled back to the old shape at this point -- the transitional Rules still accept it. **Do not** roll the Rules back further than the transitional state (step A) while the new writer might still be live anywhere (a browser tab that hasn't refreshed, a delayed rollout) -- doing so would reject that writer's in-flight creates.
- **After step D/E (tightened Rules) deployed:** every new create must include the six fields; rolling the writer back to the old shape would now be rejected by the tightened Rules. If a genuine defect requires reverting the writer, the tightened Rules must be reverted to the transitional state (step A) first, in their own deploy, before the writer rollback -- restoring the exact order dependency this sequence was designed around, just run in reverse.
- **After terminal `CANCELLED`/`VOIDED` documents or `reorder_purchase_order_voids` records exist:** the Cancel/Void `update`-path Rules branches and the `reorder_purchase_order_voids` match block are additive `||` arms; removing them in a follow-up deploy prevents *future* Cancel/Void writes but does not and must not affect documents/records already created -- reads remain unconditional (`isAdminOrDispatcher()`, no schema dependency) regardless of whether the writing branches are later removed. Removing the UI/domain-function code that calls these transitions is independently safe at any point and does not require a corresponding Rules change.
- **Permanent, at every phase, with no exception:** no `reorder_requests`, `reorder_purchase_orders`, or `reorder_purchase_order_voids` document already written is ever deleted or rewritten by any rollback action described above. This sprint's entire premise is that nothing it creates is ever undone by a later code or Rules change -- a rollback undoes the *capability* to write new instances, never existing data.

## Acceptance criteria

- [ ] `REORDER_REQUEST_STATUS` includes `CANCELLED` and `VOIDED`.
- [ ] `reorder_requests` gains `cancelledBy`/`cancelledAt`/`cancellationReason`/`voidedBy`/`voidedAt`/`voidReason`, reserved `null` at creation **only once the schema deployment sequence's step D/E has completed and been verified live** -- not assumed true the moment the Cancel/Void Rules branches themselves are drafted.
- [ ] Schema deployment sequence steps A through E each completed, in order, with step C's and E's live confirmations recorded in `docs/DECISIONS.md` before the next step's PR is drafted.
- [ ] New `reorder_purchase_order_voids` collection exists, `create`-only, document ID equals the linked Purchase Order's own ID, exactly six fields (`reorderPurchaseOrderId`, `reorderRequestId`, `partId`, `voidedBy`, `reason`, `createdAt` -- no separate `voidedAt`).
- [ ] `firestore.rules` (both copies, byte-identical): new `CANCELLED` branch (3 reachable source statuses, `isAdminOrDispatcher()`, genuinely non-blank reason required); new `VOIDED` branch (`isAdminOrDispatcher()` AND current assignee, `ORDERED` only, Purchase-Order-existence proof, cross-document invariant against `reorder_purchase_order_voids` including `reason`/timestamp binding); `reorder_purchase_orders`' existing rule block unchanged, verified via diff.
- [ ] `cancelReorderRequest()` and `voidPurchaseOrder()` are the sole writers of their respective transitions; no component calls Firestore directly; both trim the operator-supplied reason before writing.
- [ ] `PartDetail.jsx`: Cancel available from all three pre-order active stages (`isAdminOrDispatcher()`); Void available at `ORDERED` (`isAdminOrDispatcher()` AND current assignee, both required); both require a genuinely non-blank reason and an explicit confirmation with the exact specified copy; neither is ever labeled "Delete" anywhere.
- [ ] Two new terminal read-only cards, both resolving actor display names via PR #107's `resolveActorDisplayName()` (merged, `5911fd9` -- dependency satisfied), never a raw uid.
- [ ] Every active queue automatically excludes `CANCELLED`/`VOIDED` requests, verified live, no new filtering code required.
- [ ] `docs/BusinessEntityModel.md` Section 4/4b updated with the new statuses, fields, and collection.
- [ ] `npm run build && npm run lint` / `npx tsc --noEmit` clean.
- [ ] Rules-emulator test suite: every case in Testing strategy passing (including the corrected authorization-combination cases, the Purchase-Order-existence-proof negative cases, the reason/timestamp cross-document binding cases, the whitespace-only-reason cases, the deployment-sequence transitional/tightened cases, and the legacy-document cases), run against a fresh emulator.
- [ ] Live production verification per `docs/DelegationCharter.md` Section 6 before any PR in this sprint is marked complete.

## Risks

- **Rules diff size, revised.** The schema deployment sequence alone is now 2-3 Rules-relevant PRs (transitional, tightened, and the additive Cancel/Void branches), not one -- the Assessment's original 3-PR estimate is superseded by this revision's explicit sequence; see "Schema deployment sequence" for the corrected breakdown.
- **Confirmation-copy drift.** The exact required confirmation string is a hard requirement, not a suggestion -- a future edit to that copy (rewording "for clarity") would silently violate the Owner's standing requirement unless reviewers know to check the literal text, not just that a confirmation step exists.
- **No admin override for Void, and the technician-assignee limitation.** If the current assignee is unavailable (left the company, account issue) or holds a `technician` security role, there is currently no path to Void -- both are known, accepted gaps (the first per the Architecture Decision, the second a pre-existing repository-wide property of this object, not introduced here), not oversights, but worth surfacing here so neither is rediscovered as a "bug" later without this context.
- **Deployment-sequence ordering discipline.** Steps A-E must run in order, with C's and E's live confirmations actually completed and recorded before the next Rules PR is drafted -- skipping or reordering a step reintroduces the exact single-step hazard this sequence exists to avoid. This is a process risk, not a technical one; the Implementation Plan should call this out explicitly as a sequencing dependency between PRs, not just a list of independent PRs.

## Open questions

None remaining that block implementation -- the Architecture Decision resolved every item the Assessment raised, and this revision resolves every correction ChatGPT's Specification Review raised. Any question that surfaces during implementation (e.g. exact card placement, exact button copy beyond the mandated confirmation string) is an implementation detail, not an open architectural question, per this Specification's own Technical design/UI impact sections above.

## Approval

**APPROVED by ChatGPT Architecture Review, 2026-07-11**, to advance to the Implementation Plan gate -- all nine REQUEST CHANGES corrections confirmed addressed. See `docs/implementation-plans/reorder-request-cancellation.md` for the PR breakdown and sequencing. **Owner Merge Authorization and Owner Deployment Authorization are separate, not-yet-granted gates** -- this approval authorizes drafting the Implementation Plan and, per `docs/ai/workflow.md`, subsequent Claude Code Implementation; it does not authorize merging or deploying any PR in this sprint. **No code has been written for this sprint.**
