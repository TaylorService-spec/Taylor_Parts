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

## 13 — Cutover and rollback

Owner ruling: the conditions below must all hold before the trusted reorder authority is live, and the
order is not to be improvised at release time. This is that order, with what breaks if it is not
followed, and how each step is undone.

**None of this is authorized to run.** It is the runbook the authorization would govern.

### The activation conditions

| # | Condition | Why it is a condition |
|---|---|---|
| 1 | Every governed Warehouse a reorder can be raised against holds an `operatingCompanyId` | The callable DERIVES the request's company from the warehouse. A warehouse without one makes the command refuse — correctly, and unhelpfully. |
| 2 | `createReorderRequest` + `recordReorderPurchaseOrder` deployed | Nothing can create a request once Rules retire the direct path. |
| 3 | `listReorderWarehouseOptions` deployed alongside them (R-17) | The selector has no other read authority. Without it the picker is empty and no reorder can be raised at all. |
| 4 | Hosting serving the client that calls them | The old bundle writes directly and would start failing the moment Rules land. |
| 5 | `firestore.rules` deployed with the three retirements | Until this lands, the direct path is still open — one command, two write authorities. |
| 6 | Every persona who may raise a reorder can obtain the warehouse pick-list | RESOLVED by R-17 for admin / dispatcher / WAREHOUSE_MANAGER. STILL OPEN for PARTS_MANAGER -- WORKSTREAM 2C (DECISIONS #148). |
| 7 | A governed Warehouse can hold `operatingCompanyId` AND still pass the §3A governed check | It cannot today. WORKSTREAM 2A.1, and it must land BEFORE 2B activation (DECISIONS #148). |

### Condition 6 — RESOLVED by R-17: `listReorderWarehouseOptions`

`firestore.rules` grants `warehouses` read as `isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId)`.
The second half is a per-document test, and a pick-list is a collection LIST, which no per-document
condition can satisfy — so the two personas the manual-entry path exists for could not obtain the
warehouse identity the create now requires. Measured, before the fix:

| Persona | LIST `warehouses` | GET `warehouses/wh-main` |
|---|---|---|
| admin | 200 | 200 |
| dispatcher | 200 | 200 |
| technician, ACTIVE `PARTS_MANAGER` | **403** | 403 |
| technician, ACTIVE `WAREHOUSE_MANAGER` assigned to `wh-main` | **403** | 200 |

**Owner ruling R-17: a trusted projection, not a Rules widening.** `warehouses` is unchanged, and a
static contract test asserts it stays that way. `listReorderWarehouseOptions` returns exactly
`{ warehouseId, label }` — never `operatingCompanyId` (the client must not hold the company as an
authority), never inventory, staffing, status or provenance. It is authorized by the SAME capability
as the create it serves (`reorder.request.create.manual`), with no operational-role fallback and no
new `warehouse.list` capability.

**One eligibility, two consumers.** `reorderWarehouseEligibility.ts` answers *can this principal
raise a reorder for THIS warehouse?* once. `listReorderWarehouseOptions` filters by it and
`createReorderRequest` enforces it, so everything offered is accepted and a `warehouseId` posted by
hand is refused (`WAREHOUSE_NOT_IN_SCOPE`, mapped to `permission-denied`) exactly when it was not
offered. The invariant is tested as a property over a matrix of principals and warehouses, not as
examples.

**Scope comes from existing authority, and nothing was invented.** It mirrors the warehouse-read
authority already stated in Rules: admin/dispatcher are unscoped; a WAREHOUSE_MANAGER holds exactly
their linked Employee's `assignedWarehouseIds` (Issue #226), under the same fail-closed contract —
absent, empty or malformed assignment denies every warehouse, never "all".

### STILL OPEN — the PARTS_MANAGER warehouse scope (WORKSTREAM 2C)

`reorder.request.create.manual` is held by admin, dispatcher, and an active PARTS_MANAGER or
WAREHOUSE_MANAGER. Three of those four have a governed warehouse scope. **A PARTS_MANAGER has none.**
`assignedWarehouseIds` is consulted by exactly one authority in this repository, and that authority
requires WAREHOUSE_MANAGER membership; no capability, Rule, ADR or fixture says which warehouses a
Parts Manager may reorder for.

Per the ruling ("If current authority does not actually define Parts Manager warehouse scope, STOP on
that specific scope question rather than inventing one"), the resolver returns `NONE` with the reason
`PARTS_MANAGER_SCOPE_UNDEFINED` — a named state, not a silent zero — and a test pins it so the gap
cannot be closed by accident. **A Parts Manager therefore still cannot raise a reorder.** The two ways
to change that without a ruling would both be inventions: granting them every warehouse, or reading
`assignedWarehouseIds` for a role no authority says it scopes.

### BLOCKING DEFECT — a warehouse cannot be both §3A-governed and company-bearing (WORKSTREAM 2A.1)

Found while building the projection, and it blocks activation independently of everything above.

- `createReorderRequest` resolves the warehouse through the receiving-location authority, which
  validates the **whole document** against the §3A governed shape — a strict allow-list of twelve
  keys (`governedWarehouseValidation.ts`).
- The same command then requires `warehouses/{id}.operatingCompanyId`, because the request's
  operating company is derived from the warehouse (R-13).
- `operatingCompanyId` is **not** in that allow-list, so writing it makes the document fail §3A as
  `unknown_field`.

So the command refuses in both directions: without the company, `WAREHOUSE_NO_COMPANY`; with it,
`WAREHOUSE_NOT_GOVERNED`. **Activation condition 1 breaks activation condition 2 by construction**,
and no reorder can be created in any state.

The behaviour is at least coherent — the picker offers nothing and the create accepts nothing, so the
R-17 invariant holds — but the whole path is unreachable. `functions/test/reorderWarehouseEligibility.test.mjs`
pins the contradiction in a test named BLOCKER, which will fail when it is resolved.

**Not fixed here, because both repairs cross an authority boundary.** Widening the §3A allow-list
changes the Receiving authority's shape contract (Decision-tracked, I-LA C2). Giving the reorder its
own warehouse-validity opinion is precisely the second opinion the 2B design refused to invent. A
third option — storing the company somewhere other than the warehouse document — would change the
ownership model's physical-root shape. All three are Owner decisions.

### Order

**1 → 2 → 3 → 4 → 5.** (Functions covers both callables, so conditions 2 and 3 land in one deploy.) Each step is safe to sit in indefinitely; none of the intermediate states is a
broken system, and that is the property the ordering is chosen for.

1. **Warehouse company facts.** A data write against the five sandbox warehouses named in the
   activation prerequisite. Separately authorized, and the only step that is not a deploy.
   *State after:* nothing behaves differently. The facts are simply present.
   *Rollback:* removing them would strand any request already created against them, so the rollback
   is forward — correct a wrong company by an explicit governed change, never by deletion.

2. **Functions.** Additive: three new callables (two writes + the pick-list read), nothing calls them yet.
   *State after:* the callables exist and are unreachable from the shipped UI.
   *Rollback:* redeploy the previous Functions revision. No data written by anything.

3. **The pick-list callable -- same deploy, not a separate step.** `listReorderWarehouseOptions` ships in the same Functions deploy as the two write callables, so there is no separate step for it. It is called out as its own CONDITION because forgetting it produces an empty picker rather than an error, which is the quietest way this can fail.

4. **Hosting.** The client starts calling the callables. Rules still permit the direct path, so
   BOTH are legal here — but only the callables are used, because the client has no code left that
   writes directly (proved by `reorderTrustedWritePathContract.test.mjs`).
   *State after:* new requests carry `warehouseId` and `operatingCompanyId`. This is the first step
   that changes data.
   *Rollback:* redeploy the previous bundle. It writes directly again, which Rules still allow.
   Requests already created keep their warehouse and company — see *What rollback cannot undo*.

5. **Rules (Tier 2, human operator).** The three retirements land.
   *State after:* one write authority per command. The verifier's `GOVERNED_RULES_SHA256` stops
   reporting `LIVE != GOVERNED` — that mismatch is the signal to deploy, and must never be resolved
   by moving the pin back.
   *Rollback:* deploy the previous ruleset. The direct paths reopen.

### What goes wrong in the wrong order

- **5 before 2** — reorder creation is broken outright: the direct path is denied and no callable
  exists to replace it. This is the one genuinely destructive ordering.
- **5 before 4** — the deployed client still writes directly, and every Request Reorder fails with
  permission-denied. Not data loss, but a visibly broken feature for every user until Hosting lands.
- **4 before 1** — the client asks for a warehouse, the user picks one, and the callable refuses
  because that warehouse has no company. Fail-closed and honest, but it is a broken feature too.
- **2 before 1** — harmless. Nothing calls the callables yet.

### Rolling Rules back is safe for BOTH record generations

Worth stating because it is the non-obvious half. The previous ruleset's canonical key set does not
include `warehouseId` or `operatingCompanyId` — but that key set is only ever consulted on CREATE,
and every retained UPDATE branch is gated on `diff(resource.data).affectedKeys().hasOnly([...])`,
which looks at what changed rather than what the document contains. A new-generation record therefore
keeps every transition under the old Rules, exactly as a legacy record keeps every transition under
the new ones. The emulator suite proves the second direction; the first is the same mechanism read
backwards.

### What rollback cannot undo

Requests created while step 3 was live carry a `warehouseId` and an `operatingCompanyId`, and those
fields are immutable under every ruleset. A rollback does not remove them and must not try to: they
are true statements about records that really were raised for a real warehouse. The result of a
rollback is a collection holding both generations — which is the state the compatibility work already
covers, arrived at from the other direction.

### Verification at each step

| Step | What proves it |
|---|---|
| 1 | Read back the five warehouses; every one resolves through `resolveOperatingCompany` to `RESOLVED`. |
| 2 | The callables appear in the deployed Functions list. No behavioural check — nothing calls them. |
| 3 | `/version.json` reports the expected commit (never an exit code — see the deploy-verification convention), then one real Request Reorder end to end. |
| 4 | `verifyTruckRegistryDeployment` stops reporting `LIVE != GOVERNED`, and the live ruleset hashes to the governed pin. |

## Open question for the Owner

The 1:1 identity means `reorder_purchase_orders` documents are **named after their request**. If the
request's creation moves behind a callable that mints the id, that id is still the PO's future id.
Nothing changes — but it is worth stating, because the identity is load-bearing and it is now created
by a different actor.

**Implemented as of Workstream 2B.** Sections 1-11 were the reconciliation and the design; the code,
the Rules retirement and the tests are in the repository, and section 13 is the runbook for making
them live. Nothing in section 13 has been run, and no deployment or warehouse data write is
authorized.
