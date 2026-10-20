# S1a: Stock-reservation authority spec (EOS)

**Status:** SPEC. Docs only. No code, no migration, no capability, no grant, no activation, no deploy.
**Issued:** 2026-10-20 (America/Phoenix). **Base:** `main` `09a82d3e`.
**Plan row:** S1a of `firebase-replacement-matrix-2026-10-19.md` section A3 (S1a, then S1b, then S1c).
**Resolves:** the three open blockers of DECISIONS #165 (consumption on-hand gap; company and location scope; dispatch applies no reservation). Every material choice is a numbered **OWNER DECISION** (section 9), with options and a recommendation.
**Machine-readable companion:** [`s1a-reservation-grant-parity.json`](s1a-reservation-grant-parity.json) (Firebase-parity holders, derived read-only).
**Does not define:** ATP and stockout. They stay OPEN (DECISIONS #165 rulings 5 and 6). This spec uses the word *available* for a netted quantity only.

---

## 1. Summary

| Question | Answer |
|---|---|
| Is there one governed pool arithmetic? | Yes, and two of the three live definitions already agree: `RESERVED - RELEASED - CONSUMED`, floored at 0, per (tenant, company, Part). The third (`committedQuantityForPart`, never called) and Firebase `openCommitment` differ and are retired from the target (OD-1). |
| Is the consumption gap still open? | It changed shape. EOS posts a real `WORK_ORDER_CONSUMPTION` movement for truck usage and for serial installs, so consumed stock does leave physical on-hand. What is left is the interval between a Part leaving the warehouse and the commitment ending (OD-1), and nothing in the movement writers consults commitments (OD-1). |
| Is the company blocker still open? | No. EOS Work Orders and Sales Orders each carry a NOT NULL `operating_company_key`. A commitment takes its company from its demand document, never from location, technician or creator (OD-2 confirms). |
| Is the location blocker still open? | Yes, as a choice, not as missing data. Neither demand family selects a warehouse. The schema has no location column (OD-2). |
| Why does dispatch reserve nothing? | It was deliberately left `NOT_YET_ACTIVATED` (`workOrderLifecycle.ts:130`). Activation is an Owner decision because it changes what a dispatch does (OD-5). |
| Can S1b be built now? | **No.** Reserve and release need an availability gate, and that gate's scope, the activation semantics and the authorization model are Owner decisions (OD-2, OD-3, OD-5, OD-6). Nothing in S1b has a single governed answer yet. See section 8. |

---

## 2. What was read

| Subject | Where | Fact that matters |
|---|---|---|
| Firebase reserve / release / consume | `functions/src/inventoryService.ts` | Sole writer of `RESERVED`. DISPATCHED reserves, CANCELLED releases, COMPLETED consumes. Quantity per sku is summed first. All-or-nothing in one transaction under a per-part lock. A failed reserve **never** rolls back the dispatch: it records `retryNeeded`. No company, no location. |
| Firebase available | `inventoryService.ts getAvailableQuantity` | `sumLedgerEligibleOnHand` (ACTIVE warehouses, MOBILE excluded, UNKNOWN when no evidence) minus `RESERVED - RELEASED`. CONSUMED is deliberately not subtracted. |
| Firebase SO allocation | `fulfillment/allocateSalesOrder.ts`, `fulfillmentAvailability.ts` | Writes `lines[].allocatedQty` on the Sales Order only, no ledger event. Nets other SO allocations, its own prior allocation and open WO reservations (SO-linked WOs excluded). Equipment lines are UNKNOWN (fail closed). Capability `salesOrder.fulfill`. |
| Firebase create-service | `salesOrder/createServiceForSalesOrder.ts` | Seeds each PART line's `qtyPlanned` from `allocatedQty`, never `orderedQty`. Refuses when allocation never ran. Capability `salesOrder.service`. |
| EOS commitment store | `functions/migrations/1758067200000_inventory-commitment-and-work-order-replay.sql` | `eos_ops.inventory_commitments`: `work_order_id NOT NULL`, `operating_company_key NOT NULL`, `part_id`, `event_type` RESERVED / RELEASED / CONSUMED, `quantity > 0`, `idempotency_key` unique per tenant. **No location, no sales-order source, no serial.** Append-only. |
| EOS commitment repository | `eosOps/inventoryCommitmentRepository.ts` | `reserve` (no availability gate, by design), `releaseOutstanding` (reads the ledger, not the plan), `reconcileConsumption` (top up, consume, release remainder, refuses overage), `outstandingByPart`, `committedQuantityForPart`. Refuses a Part that is unknown or not `trackingMode NONE`. **Called by no HTTP operation and no other module.** |
| EOS dispatch | `eosOps/workOrderScheduling.ts dispatchWorkOrder`, `workOrderLifecycle.ts` | Dispatch is one transaction. The edge returns `RESERVE_NOT_APPLIED`; COMPLETED returns `CONSUME_NOT_APPLIED`; CANCELLED returns `RELEASE_NOT_APPLIED`. Cancel is allowed from every non-terminal state. |
| EOS availability read | `eosOps/partsReads.ts readPartBalance` | `onHand` is limited to the caller's WAREHOUSE scope and companies. `reserved` is `RESERVED - RELEASED - CONSUMED` over **all** the caller's companies, **not** limited to scope. `available = max(0, onHand - reserved)`. Serial Parts return `NOT_COUNTED_BY_QUANTITY`. |
| EOS consumption | `eosOps/workOrderExecution.ts`, `workOrderEquipmentInstall.ts` | Truck usage posts `WORK_ORDER_CONSUMPTION` from a MOBILE location in the same transaction as the usage record (OD-T4). A serial install posts `-1` at the WAREHOUSE or BIN the unit left. Neither writes a commitment event. |
| EOS serial custody | `eos_ops.serialized_custody` | Status enum already has `RESERVED`; no EOS writer sets it for a sale. Rental has its own unit reservation (`eos_rental.fleet_units.availability`). |
| EOS Commercial | `serviceFromSalesOrderBoundary.ts`, `eosCommercial/fulfillment/salesOrderFulfillmentAuthority.ts` | `sales_order_lines` has no allocated quantity (migration `1759449600000`). Service from an order with PART lines is refused as `ALLOCATION_AUTHORITY_UNAVAILABLE`. Fulfillment evidence comes from Work Order actuals. |
| Client | `field-ops-app-vite/src/services/salesOrderCommandClient.js` | `allocateSalesOrder` and `createServiceForSalesOrder` are HELD stubs returning `failed-precondition`; no Firebase call. |
| Capability vocabulary | migration `1759536000000` | `salesOrder.fulfill` and `.service` deliberately **not registered** in EOS ("D2 execution stays deferred"). |

**Defects and gaps found while reading** (each is resolved in section 3 or 9):

1. **Three arithmetics for one pool.** `readPartBalance` and `openWorkOrderReserved` subtract CONSUMED. `committedQuantityForPart` and Firebase `openCommitment` do not.
2. **`reserved` is a confident `0` that nothing earned.** `readPartBalance` documents "no commitment row is a known 0 (the reservation ledger is written on every reservation)". Nothing writes it. This is the B5 stage-5 "Reserved is always 0".
3. **Scope mismatch inside one figure.** `available` subtracts a company-wide `reserved` from a scope-limited `onHand`. A warehouse-scoped reader sees an understated `available`.
4. **Movement writers ignore commitments.** Transfer, relocation, cycle-count and truck consumption decide from the balance at one location under `stockLocationLock`. Not one of them reads `inventory_commitments`. A reservation does not stop reserved stock being moved out.
5. **The commitment table cannot hold a Sales Order claim.** `work_order_id` is NOT NULL.

---

## 3. The three #165 blockers, resolved

### 3.1 Blocker: nothing removes consumed stock from on-hand

DECISIONS #165 named three remedies: (a) consumption writes a physical removal, (b) on-hand counts location-less CONSUMED rows, (c) commitment permanently retains consumed quantity.

**In EOS, (a) is already true and (b) and (c) are not needed.** `WORK_ORDER_CONSUMPTION` is a physical movement type, signed by the one rule in `inventoryLedger/locationOnHand`, and it is posted at truck consumption and serial install. DECISIONS #171 item 11 made physical consumption live on the Firebase side for the same reason. The EOS conclusion follows:

- **The pool is `RESERVED - RELEASED - CONSUMED`, floored at 0.** Keeping CONSUMED counted as committed (Firebase "wrong reason, right number", `(c)`) would now subtract the same unit twice, once in on-hand and once in commitment, and would never free it. `committedQuantityForPart` and the Firebase `openCommitment` therefore cannot be the target definition (OD-1).
- **CONSUMED reconciles a promise; it moves no stock.** `reconcileConsumption` already says so. The physical removal is authored by whoever owns the movement (execution record or install). The two facts stay separate and neither writer calls the other.

**What remains is an interval, not a gap.** A Part reserved against warehouse stock normally reaches the technician by a transfer to the truck. The transfer lowers sellable (warehouse) on-hand at once. The commitment stays outstanding until COMPLETED (consume) or CANCELLED (release). During the interval the same units are subtracted in on-hand **and** in commitment, so `available` is understated. This is conservative (it under-promises), it is what Firebase did, and it ends at completion. OD-1 asks the Owner to accept it or to require a hand-over event.

### 3.2 Blocker: company and location scope

**Company: closed by the EOS data model.** `eos_ops.work_orders.operating_company_key` and `eos_commercial.sales_orders.operating_company_key` are both NOT NULL (`1761004800000:66` with a stated-company CHECK at `:121`; `1758844800000:234`, "the only NOT NULL one" of the Commercial tables). The 30 sandbox Work Orders that #165 recorded as `NO_GOVERNED_COMPANY_SOURCE` were Firebase documents; the EOS table cannot hold such a row. A commitment copies its demand document's company. It is never inferred from location, technician, dispatcher, creator or customer (DECISIONS #143). The pool is keyed `(tenant, company, Part)`. Taylor stock is never netted against Ventana commitments and the reverse.

**Location: a real choice, not missing data.** Neither family selects a warehouse, and the ruling forbids inventing a "global" location. Options are in OD-2. The recommendation keeps commitments location-less and pooled across the company's ACTIVE warehouses, because that is exactly what Firebase did, what `readPartBalance` already assumes, and what the table can hold today. The cost is finding 3 above, handled by OD-3.

### 3.3 Blocker: dispatch applies no reservation

Dispatch was left unactivated on purpose. Turning it on changes the behaviour of the most-used edge in Service, and it has two coherent shapes (OD-5):

- **A. Effect after commit (Firebase parity).** Dispatch commits. A second transaction claims `work_order_inventory_effects (DISPATCHED)`, takes the pool lock, checks availability and writes all RESERVED rows or none. A shortage or UNKNOWN stock records `FAILED` with the reason and leaves the Work Order DISPATCHED, visible as attention. A dispatched Work Order still does not guarantee committed stock, but now says so.
- **B. Reserve inside the dispatch transaction.** A shortage refuses the dispatch. Stronger guarantee, but a part stockout then blocks sending a technician, which the business has never been asked to accept.

---

## 4. Semantics

All semantics below apply to quantity-tracked Parts (`trackingMode NONE`). Serial handling is section 4.6.

### 4.1 Events

| Event | Meaning | Moves stock? | Writer |
|---|---|---|---|
| RESERVED | A demand document claims a quantity of one Part for one company. | No | reserve command |
| RELEASED | The claim shrinks or ends without use. | No | release / reconcile |
| CONSUMED | The claim ended because the quantity was used. | No (the physical movement is a separate row) | reconcileConsumption at COMPLETED |

Append-only. A release is a new row. No update, no delete. The repository's static test already enforces that.

Per demand document and Part, `outstanding = RESERVED - RELEASED - CONSUMED`. It must stay `>= 0`. A release or consume larger than `outstanding` is refused before any write. A negative `outstanding` found on read is an integrity fault and is **returned, not floored** (the repository already does this).

### 4.2 Reserve

Trigger (after OD-5): the DISPATCHED edge. Input: the Work Order's `work_order_parts_plan` rows, summed per Part first (duplicate rows must not each pass against the same figure).

Order of work, every refusal **before** any write:

1. Part exists in this tenant's catalog and is `trackingMode NONE` (existing `requireCommittablePartsThroughClient`).
2. Take the pool lock for `(tenant, company, Part)` for every Part, in sorted Part order (deadlock-free). One `pg_advisory_xact_lock` per pool, in the same family as `stockLocationLock`.
3. Compute `sellableOnHand` (4.5) and `outstandingCommitment` (4.4) inside the lock.
4. `sellableOnHand` UNKNOWN: refuse as **UNKNOWN_STOCK**, distinct from a shortage, naming the Part. Never read as 0 and never as plenty.
5. `quantity > available`: refuse as **INSUFFICIENT_STOCK**, naming `need` and `available` per Part.
6. Write one RESERVED row per Part. All rows or none.

Idempotency: each row's key derives from the operation key as `<base>:RESERVED:<partId>` (existing `derivedKey`). A replay returns the original rows. Reusing a key with different content is a `CommitmentIdempotencyConflictError`, never a silent replay.

Audit: one audit event per operation naming the Work Order, the company, the Parts and quantities, the outcome and the refusal code.

### 4.3 Release and consume

| Edge | Action |
|---|---|
| CANCELLED (any non-terminal state, after DISPATCHED effect processed) | `releaseOutstanding`: release everything outstanding, **read from the commitment ledger, not the plan** (the #165 orphan fix). No catalog check, so a deactivated Part cannot strand stock. |
| COMPLETED | `reconcileConsumption`: top up to `qtyPlanned`, CONSUME `qtyUsed` (execution record actuals), RELEASE the remainder. Overage (`used > planned`) is refused by the repository today; the governed overage path is a separate build and is not decided here. |
| Plan edited while DISPATCHED to WORK_IN_PROGRESS | **Demand follows (ruling 3):** increase reserves the delta (all-or-nothing for the delta), decrease releases the excess, removal releases everything outstanding. Runs after the plan command commits, outside the plan transaction, so a shortage cannot undo the plan edit. |
| Before DISPATCHED | Nothing. Planning, scheduling, picking and staging reserve nothing (standing invariant). |

### 4.4 Committed quantity (the pool)

`committed(tenant, company, Part) = max(0, sum(RESERVED) - sum(RELEASED) - sum(CONSUMED))` over all demand sources. One definition, one function. `committedQuantityForPart`'s `RESERVED - RELEASED` body is replaced (OD-1); `readPartBalance` and the gate call that one function.

### 4.5 Sellability and available

**Sellable on-hand** for `(tenant, company, Part)` is the quantity sum of `trackingMode NONE` movements at WAREHOUSE or BIN locations whose governing warehouse has `status = ACTIVE`, for that company, floored at 0.

- MOBILE (truck) stock is excluded. It is real stock but not sellable warehouse stock.
- No movement evidence for the Part at all is **UNKNOWN**, not 0. Evidence that nets to 0 is a known 0.
- Inbound purchase orders, in-flight transfers, safety stock and reorder points are not part of it. There is no quarantine, damaged or on-hold state in EOS today, so there is nothing to exclude and none is invented here.

**Available** `= max(0, sellableOnHand - committed)`, UNKNOWN whenever `sellableOnHand` is. This is a netted quantity. It is not ATP and is not labelled so.

### 4.6 Serial-aware behaviour

- A quantity commitment cannot name units. The repository refuses a Part that is not `trackingMode NONE` (`TRACKING_MODE_NOT_SUPPORTED`). `readPartBalance` already reports serial Parts as `NOT_COUNTED_BY_QUANTITY`. Both stay.
- A serial reservation is a different fact: a named unit moves `AVAILABLE -> RESERVED` in `serialized_custody` and needs a holder reference that table does not have. Rental already reserves its own fleet units elsewhere. This spec does **not** design it; it is out of S1b and S1c (OD-8).
- Sales Order EQUIPMENT_MODEL lines therefore stay UNKNOWN and fail closed, exactly as `readEquipmentAvailability` does in Firebase.
- A Work Order plan that contains a serial or whole-unit Part: that Part is recorded as `NOT_APPLICABLE` for quantity reservation (with the reason) and does not fail the other Parts.

---

## 5. Sales Order allocation and create-service (the S1c shape)

Not built tonight. Stated so S1b does not close a door.

1. **One pool (ruling 1).** `allocatedQty` must not survive as a second authority. A Sales Order allocation becomes `RESERVED` rows in the same ledger, sourced to the order line. The table needs an additive migration (OD-9): `work_order_id` becomes nullable, nullable `sales_order_id` and `sales_order_line_number` are added, and a CHECK requires exactly one source.
2. **SO and its service Work Order must not claim the same unit twice.** Firebase excluded SO-linked WO reservations from the sum (lineage). In one ledger the clean answer is a hand-over: at the WO's dispatch, one transaction releases the SO claim for that line and reserves for the WO, so availability is computed after the release and the arithmetic needs no exclusion set (OD-10).
3. **Release is explicit.** Firebase released implicitly because a CANCELLED, FULFILLED or CLOSED order stopped being "active". A ledger has no implicit release. SO cancel, SO close with unfulfilled remainder and a line-quantity decrease each write RELEASED (OD-11).
4. **create-service** seeds `plannedParts` from the order's allocated (reserved) quantity, never from `ordered_qty`. The `ALLOCATION_AUTHORITY_UNAVAILABLE` gate lifts when the allocation authority exists and "allocation has run" is defined as at least one RESERVED row sourced to the order. Orders with no PART lines are already ungated.
5. **Client.** Replace the HELD stub only when both operations exist. The screen already hides them for an order whose downstream is untracked.

---

## 6. Grants

### 6.1 Firebase-parity holders, derived (A7-style)

Derived read-only from `functions/src/access/{compatibilityRoles,governedBusinessRoles,permissionCatalog}.ts`. Nothing was written to a role, a grant, a database or a fixture. Full machine-readable form: `s1a-reservation-grant-parity.json`.

| Capability | Firebase holders | Why | EOS today |
|---|---|---|---|
| `salesOrder.fulfill` | `admin`, `dispatcher`, `owner` | `dispatcher` and `admin` through `SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS` (`compatibilityRoles.ts:112`; admin also holds the whole catalog by derivation). `owner` through `OWNER_COMMERCIAL_AUTHORITY` (`governedBusinessRoles.ts:175`). | **Not registered** (migration `1759536000000:16`). No holder. |
| `salesOrder.service` | `admin`, `dispatcher`, `owner` | Same two sources (`compatibilityRoles.ts:113`; `governedBusinessRoles.ts:177`). | **Not registered.** No holder. |

No conditioned Firebase grant exists for either key (no `isOwnAssignment` style condition), so nothing is excluded as "conditioned". No other role holds them: Sales Manager, Salesperson, General Manager, Warehouse and Parts roles do **not**, and are **not** added. The EOS roles `admin`, `dispatcher` and `owner` all exist and are active in the authority baseline.

**Parity grant set if the Owner confirms OD-12:** register both keys (BUSINESS_ACTION, PostgreSQL-native) and add six rows: `(admin|dispatcher|owner) x (salesOrder.fulfill|salesOrder.service)`. Explicit `VALUES`, protected roles matched as protected rows, `ON CONFLICT DO NOTHING`, no deletes, no `rm -rf`-style sweep. That is S1c, not S1b.

### 6.2 Reservation keys

Firebase has **no reservation capability.** Reserve, release and consume are system effects of Work Order edges (`triggerInventoryEffects`, called after `transitionWorkOrder`). There is no callable, no client path and no key. The parity design is therefore:

- Reserve, release, consume run inside the lifecycle commands, authorized by the **existing** lifecycle keys for those edges. **No new key and no new grant.**
- A manual "reserve stock" or "release stock" command has no Firebase analogue. Granting one would be a non-parity grant and is a STOP item (OD-6). It is not recommended.
- Reading the netted figure stays under the existing `inventory.transaction.read` (the key `readPartBalance` already uses). The Firebase key `inventory.balance.read` has no EOS registration; that is an existing grant matter and is not changed here.

---

## 7. What S1b would test (for the next round, not run here)

Proposed test names, none written yet:

1. `reservation refuses before any write: unknown Part, serial Part, UNKNOWN stock, insufficient stock`
2. `reservation is all-or-nothing across Parts and replays idempotently`
3. `reservation conflicts when a key is reused with different content`
4. `two concurrent reservations cannot both claim the last unit (pool lock)`
5. `company isolation: a Taylor reservation never nets Ventana stock`
6. `committed is RESERVED - RELEASED - CONSUMED and one function serves read and gate`
7. `release reads the ledger so a removed requirement still releases`
8. `completion consumes actuals, releases the remainder, refuses overage`
9. `plan edit after dispatch reserves the delta and releases the excess`
10. `readPartBalance reserved/available agree with the gate`

---

## 8. Is S1b buildable? No.

The brief builds S1b only if this spec shows one governed answer. It does not:

| S1b piece | Blocked by |
|---|---|
| Reserve command with an availability gate | The gate's scope: pooled across the company's warehouses or pinned to one (OD-2), and how a scoped reader sees the result (OD-3). Writing it now would choose for the Owner. |
| Release / consume commands | Safe in isolation, but useless and untestable end to end without reserve. They also embed the interval choice (OD-1). |
| Who calls them | System effect after commit versus inside the dispatch transaction (OD-5), and system-only versus a manual command (OD-6). |
| `readPartBalance` reservation netting | **Already built.** It nets `RESERVED - RELEASED - CONSUMED` today. The only open piece is whether it may keep printing a known `0` before activation (OD-4). |
| Migration | None needed for the Work Order slice. The Sales Order source columns are S1c (OD-9). |
| Grants | None for the Work Order slice. Any manual command is non-parity (OD-6). |

S1b stops here. S1c is not started.

---

## 9. OWNER DECISIONS

Each has options and a recommendation. Until the Owner rules, the repository stays as it is.

**OWNER DECISION 1. One pool arithmetic, and what happens while stock is in transit to a truck.**
Options: (A) pool = `RESERVED - RELEASED - CONSUMED`; a commitment stays outstanding until COMPLETED or CANCELLED even after its Parts are transferred to a truck (conservative double-subtract, ends at completion). (B) As A, plus a new "issued to job" event when a transfer to a truck names the Work Order, ending the commitment at the transfer. (C) Keep `RESERVED - RELEASED` and retain consumed quantity as committed forever.
**Recommend A.** It is Firebase behaviour, needs no new event or link, never over-promises, and C would permanently shrink availability. B is the better long-run model and can be added later because it only adds an event. Also confirm that movement writers (transfer, relocation, cycle count, truck consumption) stay un-gated by commitments (Firebase parity), with a later attention signal when reserved stock is moved.

**OWNER DECISION 2. Location scope of a commitment.**
Options: (A) location-less, company-scoped, pooled across the company's ACTIVE warehouses (today's schema and Firebase behaviour). (B) A nullable warehouse pin on the commitment, set by an allocation rule. (C) Require a warehouse choice at dispatch or allocation (new business authority).
**Recommend A.** B and C need a warehouse-selection rule nobody has ratified, and the ruling forbids a fake global location. A is the only option the current table can hold. This also confirms that company comes from the demand document (section 3.2).

**OWNER DECISION 3. What a warehouse-scoped reader sees as `available`.**
With pooled commitments, a reader whose scope covers only some warehouses cannot be shown an honest `onHand - reserved`.
Options: (A) leave it: company-wide `reserved` subtracted from scope-limited `onHand` (today; understates). (B) Show `available` only when the caller's scope covers every ACTIVE warehouse of the company holding the Part; otherwise `available` is a new `SCOPE_PARTIAL` state and `reserved` is shown company-wide. (C) Show a company-wide `available` to everyone with the read key (discloses out-of-scope totals).
**Recommend B.** It never prints a wrong number and discloses nothing out of scope. C breaks the "nothing about an out-of-scope row is disclosed" rule.

**OWNER DECISION 4. What `reserved` says before dispatch actually reserves.**
Today it returns a known `0`. Options: (A) return it as `NOT_YET_ACTIVATED` (the UNKNOWN family) until S1b is switched on per company, then known. (B) Keep the known `0`.
**Recommend A.** DECISIONS #165 ruling 2: missing evidence stays UNKNOWN. A true `0` is a claim no writer has earned. Note the effect on the B5 stage-5 acceptance row.

**OWNER DECISION 5. Dispatch activation: when and how the reservation is made.**
Options: (A) Effect after commit using the existing `work_order_inventory_effects` claim, FAILED plus retry plus attention on shortage or UNKNOWN (Firebase parity). (B) Reserve inside the dispatch transaction and refuse the dispatch on shortage. (C) Stay unactivated.
**Recommend A.** B changes whether a job can be sent, which the Owner has not ruled on. A keeps the business flow and makes the unmet reservation visible instead of silent. Activation is per environment: nonprod first; production is an operator action and a separate Owner gate.

**OWNER DECISION 6. Who may reserve and release.**
Options: (A) System effects of Work Order edges only, under the existing lifecycle keys: no new capability, no grant (Firebase parity). (B) Add a manual hold/release command with a new capability and grants.
**Recommend A.** B has no Firebase analogue, so it is a non-parity grant and requires an explicit Owner ruling on holders before any migration.

**OWNER DECISION 7. Reserve and consume refusal vocabulary.**
Confirm two distinct refusals, `UNKNOWN_STOCK` (no governed evidence) and `INSUFFICIENT_STOCK` (known shortage), both before any write, matching Firebase's separation of the two.
**Recommend confirm.**

**OWNER DECISION 8. Serial and whole-unit Parts.**
Options: (A) Out of S-1: quantity reservation excludes them with a recorded `NOT_APPLICABLE`, Sales Order equipment lines stay UNKNOWN, and serial reservation is a later, separately designed capability on `serialized_custody`. (B) Design serial reservation now.
**Recommend A.** There is no holder column and rental already has its own model; designing it now would invent a custody authority.

**OWNER DECISION 9. How a Sales Order claim is stored.**
Options: (A) Additive columns: `work_order_id` nullable, add `sales_order_id` and `sales_order_line_number`, CHECK exactly one source. (B) A polymorphic `(source_kind, source_id)` pair. (C) Keep `allocatedQty` on the order (violates ruling 1).
**Recommend A.** Smallest additive change, existing code keeps working, and ruling 1 is met.

**OWNER DECISION 10. SO claim versus its own service Work Order.**
Options: (A) Hand-over in one transaction at WO dispatch: release the SO claim for the line, reserve for the WO. (B) Firebase lineage exclusion: count SO-linked WO reservations through the SO and exclude them from the sum.
**Recommend A.** One pool, one arithmetic, no exclusion set to keep in step.

**OWNER DECISION 11. Release triggers for a Sales Order claim.**
Confirm explicit RELEASED rows on SO cancel, on close with an unfulfilled remainder, and on a line-quantity decrease, because a ledger has no implicit release.
**Recommend confirm.**

**OWNER DECISION 12. Holders of `salesOrder.fulfill` and `salesOrder.service`.**
Confirm exact Firebase parity: `admin`, `dispatcher`, `owner` for both keys (six rows), nonprod migration, production activation as a separate operator step. Any extension (for example Sales Manager) is a separate ruling and is not included.
**Recommend confirm parity.**

**Not decided here, still OPEN by ruling:** ATP formula, stockout definition, any dashboard Committed / Available / ATP tile, overage beyond plan at completion, quarantine or damaged stock states.

---

## 10. Non-goals and boundaries kept

No code, migration, capability, grant, role, Rules, schema or deployment is changed by this document. Picking and staging still reserve nothing. The Firebase writers stay frozen. No production read or write was performed; everything above comes from the repository at `09a82d3e` and the cited evidence.
