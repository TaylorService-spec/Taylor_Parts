---
artifact_type: specification
gate: Owner decision — DESIGN ONLY, not authorized for implementation
status: Proposed
date: 2026-08-30
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/reorder-purchase-order-lineage-reconciliation.md]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Reorder — narrow trusted command authority (design)

Workstream 2B. **No code written.** This is the twelve-item return the ruling asked for before any
implementation. It is a **Tier-2 authority change**, not an inert metadata addition.

The governing constraint from the ruling: *do not widen the Firestore allowlist to add `warehouseId`
/ `operatingCompanyId` / supplier identity* — that would extend a client-authoritative purchasing
path at the moment Ownership v1 is moving responsibility the other way. Introduce a narrow trusted
boundary instead, and **move only the authority necessary to own the new governed facts.**

## 1 — Every current client write touching `reorder_requests`

All in `field-ops-app-vite/src/domain/inventoryReorderRequests.js`, all via client
`runTransaction`. There is no Cloud Function in this path today.

| # | Client function | Transition | Authors a governed company fact? |
|---|---|---|---|
| 1 | `createReorderRequest` | — → `PENDING_REVIEW` / `READY_FOR_PARTS_MANAGER` | **YES** — this is where `warehouseId` and the derived company must originate |
| 2 | `requestReorderForRecommendation` | wraps #1 | **YES** (same path) |
| 3 | `reviewReorderRequest` | `PENDING_REVIEW` → `READY_FOR_PARTS_MANAGER` / `REJECTED` | no |
| 4 | `assignReorderRequest` | `READY_FOR_PARTS_MANAGER` → `ASSIGNED_TO_PARTS_ASSOCIATE` | no |
| 5 | `startPurchasing` | `ASSIGNED_TO_PARTS_ASSOCIATE` → `PURCHASING_IN_PROGRESS` | no |
| 6 | `updatePurchasingProgress` | status unchanged | no |
| 7 | `receiveReorderRequest` | `ORDERED` → `RECEIVED` | no |
| 8 | `cancelReorderRequest` | 3 open states → `CANCELLED` | no |

## 2 — Every current client write touching `reorder_purchase_orders`

`field-ops-app-vite/src/domain/reorderPurchaseOrders.js`.

| # | Client function | Writes | Authors a governed company fact? |
|---|---|---|---|
| 9 | `recordPurchaseOrder` | creates the PO **and** flips the request to `ORDERED`, one client transaction | **YES** — the PO must carry the request's company |
| 10 | `voidPurchaseOrder` | creates `reorder_purchase_order_voids/{id}`, updates the request to `VOIDED`; **reads** the PO but cannot write it (immutable) | no |

## 3 — Rules transitions relied on

`firestore.rules`, `match /reorder_requests/{requestId}`: one `allow create` (canonical-key shape,
branching on `recommendationStatus`) and **eight OR'd `allow update` branches** — Approve/Reject,
Assign, Start Purchasing, Post Purchasing Update, Record PO, Mark Received, Cancel, Void.

`match /reorder_purchase_orders/{requestId}`: `allow create` only; `allow update, delete: if false`.

The **Record PO** branch and the PO `allow create` are mutually cross-pinned with
`existsAfter`/`getAfter`, so the PO create and the request's `ORDERED` transition must land in the
same commit. **Any redesign must preserve that atomicity or it weakens a live invariant.**

Authorization today is `isAdminOrDispatcher()` plus, on four branches, `isActiveOperationalRole(...)`
for `PARTS_MANAGER` / `PARTS_ASSOCIATE`.

## 4 — Which writes MUST move behind Functions

**Two, and only two.** They are exactly the writes that author a governed company fact:

- **`createReorderRequest`** — must validate the warehouse exists, derive `operatingCompanyId` from
  it, and persist both. Client-supplied company is never accepted as authority.
- **`recordPurchaseOrder`** — must copy the request's `operatingCompanyId` onto the PO. 1:1, so
  there is no company choice and no grouping question (Decision A).

## 5 — Which can safely remain client-direct

**Six: #3–#8 and #10.** None authors a company fact. They move a state machine that already works,
under Rules that already constrain them, and moving them would be rebuilding the reorder workflow
rather than moving the authority that the new facts require — which the ruling explicitly warned
against.

## 6 — Proposed callables

Two. Narrow, and shaped like the existing commercial commands.

```
createReorderRequest(
  partId, warehouseId, requestedQty, quantitySource,
  recommendationStatus, recommendedQty?, urgency?, workOrderId?, idempotencyKey
) -> { reorderRequestId, operatingCompanyId }
```
- refuses an absent/unknown warehouse; refuses a warehouse whose `operatingCompanyId` is not
  governed; **ignores any client-supplied `operatingCompanyId`**;
- persists `warehouseId` + `operatingCompanyId` as historical facts;
- `requestedBy` = the authenticated actor, recorded separately from ownership;
- preserves the existing initial-status semantics exactly.

```
recordReorderPurchaseOrder(
  reorderRequestId, supplierName, externalPoNumber,
  orderedQuantity, orderedDate, expectedArrivalDate?, idempotencyKey
) -> { purchaseOrderId, operatingCompanyId }
```
- one transaction: create the PO **and** flip the request to `ORDERED`, preserving today's atomicity;
- copies `operatingCompanyId` from the request. No client company input;
- `supplierName` stays free text — **the supplier-identity decision is separate** (ruling), and this
  command must not be the vehicle that quietly settles it.

Both stage an Audit Event through the existing writer, matching every other trusted command.

## 7 — Capability / role authority already available

**Fifteen reorder capabilities are already registered in `functions/src/access/permissionCatalog.ts`**
and are **active** (no `active: false`, and absent means active):

`reorder.request.read.queue` · `read.own` · `create.manual` · `create.system` · `assign` ·
`startPurchasing` · `postPurchasingUpdate` · `recordPurchaseOrder` · `markReceived` · `approve` ·
`reject` · `cancel` · `reorder.purchaseOrder.read` · `.create` · `.void`

They map one-for-one onto the operations above. What does **not** exist is any code resolving them:
enforcement today is the Rules' operational-role check. The vocabulary is declared and unused.

## 8 — Are new capabilities required?

**No.** `reorder.request.create.manual` / `.create.system` and `reorder.request.recordPurchaseOrder`
already name exactly the two moments moving behind Functions. The work is to **resolve** them
through `resolveEffectiveAccess`, not to register anything new.

One question for the Owner: the callables should resolve these capabilities, but the *remaining*
client-direct writes would still authorize via operational roles in Rules. That is two authorization
models over one workflow. It is acceptable as a transitional state and should be named as one rather
than discovered later.

## 9 — Rules delta required to close the direct-write path

Narrow, and it is the Tier-2 core of this change:

- `reorder_requests` — **remove the `allow create`** (the trusted command becomes the only creator,
  via Admin SDK). Add `warehouseId` + `operatingCompanyId` to `hasCanonicalReorderRequestKeys` for
  *read/update shape validity*, since existing update branches assert the canonical key set.
- `reorder_requests` — **remove the Record PO update branch** (that transition moves into the
  callable).
- `reorder_purchase_orders` — **remove `allow create`**. `allow update, delete: if false` stays.
- Everything else — the other seven update branches and all read branches — **unchanged**.

Two consequences to state plainly:
- the cross-pinned `existsAfter`/`getAfter` invariant is **retired from Rules and re-established
  inside the callable's transaction**. Equivalent strength, different enforcement point, and it must
  be tested as such rather than assumed.
- `firestore.rules` is **hash-anchored to the live deploy**, so this needs a governed deploy and a
  `GOVERNED_RULES_SHA256` update in the same authorized action.

## 10 — Compatibility plan for existing UI

- `createReorderRequest` and `recordPurchaseOrder` keep their **exported names and call sites**; only
  their bodies change from `runTransaction` to `httpsCallable`. No component changes.
- `createReorderRequest` gains a **required** `warehouseId`. Its callers must supply one, which means
  a warehouse selector in the request UI — the one genuine UX addition, and the ruling's own point
  that this is a domain correction rather than ownership plumbing.
- Existing records without `warehouseId` **remain readable**: reads are untouched, and no
  parser/schema change may make the six existing rows invalid.
- Ordering: ship the callables and switch the client in the same change as the Rules retirement, or
  the UI writes into a path Rules no longer permits.

## 11 — Focused tests required

- warehouse missing / unknown / not governed → REFUSE, three distinct cases
- warehouse Taylor → request Taylor; warehouse Ventana → request Ventana
- client-supplied `operatingCompanyId` is **ignored**, never trusted
- requester ≠ owner; `requestedBy` recorded separately
- notes/free text cannot influence warehouse or company
- a historical request with no `warehouseId` stays readable
- PO inherits the request's company; **no** client company input is accepted
- PO create + request `ORDERED` are **atomic** — neither lands alone (the invariant migrating out of
  Rules)
- idempotent replay on both callables
- the seven untouched Rules branches still behave identically (regression)

## 12 — Deployables that would change

This is the first part of Workstream 2 that is **not** inert:

| Deployable | Change |
|---|---|
| **Cloud Functions** | two new callables exported → **Functions deploy required** |
| **`firestore.rules`** | two `allow create` removals + one update-branch removal → **Rules deploy required, Tier 2, hash re-anchor** |
| **Hosting (client bundle)** | two domain functions call callables; request UI gains a warehouse selector → **Hosting deploy required** |
| `firestore.indexes.json` | no change expected |

**All three deploys are outside anything authorized so far**, and they must land together: Rules
retiring the direct path without the callables deployed would break reorder creation outright.

## Open question for the Owner

The 1:1 identity means `reorder_purchase_orders` documents are **named after their request**. If the
request's creation moves behind a callable that mints the id, that id is still the PO's future id.
Nothing changes — but it is worth stating, because the identity is load-bearing and it is now created
by a different actor.

**Nothing here is implemented. Stopping for the authority decision.**
