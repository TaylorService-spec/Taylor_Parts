# Inventory Commitment / Reservation Authority Reconciliation

**Status:** RECONCILIATION COMPLETE — analysis and proof only. No reservation engine was built, no
inventory side effect added, no calculation changed, no capability activated, no deployment. The
one code change in this pass is a new test file.

**Starting SHA:** `2c7c343d` (`origin/main` at start; unchanged during the run).

> ## ⚠ SUPERSEDED IN PART — Owner ruling DECISIONS #165, 2026-09-02
>
> This reconciliation was accepted and acted on. What changed:
>
> | Finding here | Now |
> |---|---|
> | **Conflict 2** — two on-hand definitions; static catalogue baseline gating dispatch | **CLOSED.** One derivation (`sumLedgerEligibleOnHand`) for both families; static baseline removed; the duplicate `sumGovernedLedger` deleted; UNKNOWN returned, never coerced; MOBILE excluded and tested |
> | **§7 release gaps** — plan decrease, plan increase, requirement removal | **CLOSED.** `reconcileReservation()` re-derives commitment from the current plan; `releaseParts` now iterates the ledger, closing the orphan leak |
> | **Conflict 1** — WO blind to SO allocations | **PARTIALLY closed.** Availability now nets every ledger commitment whatever wrote it, so SO commitments are seen the moment they become ledger events. They are not yet, because of the blocker below |
> | **Company / location scope on reservations** | **STILL OPEN**, and now understood to be blocked: a Work Order carries no `operatingCompanyId` and *neither* family selects a warehouse. Requiring both would fail every dispatch closed; inventing either is forbidden |
> | ATP · stockout · dashboard Committed/Available | **UNCHANGED — still gated** |
>
> **A new blocker was found while implementing:** nothing removes consumed stock from physical
> on-hand, and the two paths compensate differently — so the ratified Sales Order derivation reports
> 5 available after 5 were received and 2 consumed. Proven in
> `functions/test/inventoryConsumptionOnHandGap.test.mjs`. This must be ruled before Sales Order
> commitments may join the ledger. Details: DECISIONS #165.
>
> Everything below is the measurement as it stood at `2c7c343d`, kept because the ruling is only
> legible against it.

**Classification: CASE C — PARTIAL_OR_CONFLICTING_MODEL.**

A real, transactional, lock-protected commitment authority exists for **Work Orders** and is live.
A second, structurally different commitment authority exists for **Sales Orders** and is
governed-inert. The two are **asymmetric** — the Sales Order path nets both, the Work Order path
sees only its own — and they compute **on-hand from different sources**. Neither gap is a defect
introduced here; both are recorded, pinned by test, and left for an Owner ruling.

---

## 1. Executive answer

| Question | Answer |
|---|---|
| Does a commitment fact exist? | **Yes** — two of them |
| Is commitment governed? | Yes for Work Orders (live, deployed). Yes-but-inert for Sales Orders |
| Does picking reserve? | **No.** Invariant holds, proven on source |
| Does demand reserve? | **No.** WO creation, parts planning, SO creation and agreement acceptance all commit nothing |
| Is concurrency protected? | **Within** each authority, yes. **Across** them, no |
| Is release defined? | Mostly. One stale-window gap (§7) |
| Does ATP exist? | One governed derivation exists, Sales-Order-side, capability-inactive |
| Is stockout defined? | **No.** OPEN |

---

## 2. Candidate authorities — what was found

Searched `functions/`, `field-ops-app-vite/`, `scripts/`, `docs/`, Rules, types, seeders, tests and
migrations for reservation/allocation/committed/held/picked/staged/issued/required/available/ATP
vocabulary, then traced actual reads and writes rather than trusting the strings.

### 2.1 Authority A — Work Order reservations (LIVE)

| Aspect | Measured |
|---|---|
| Canonical record | `inventory_transactions` entries of `type: "RESERVED" \| "RELEASED" \| "CONSUMED"` |
| Writer | **`functions/src/inventoryService.ts` — the SOLE writer of `type: "RESERVED"` in the entire repository** (proven by exhaustion over `functions/src`) |
| Permitted caller | `triggerInventoryEffects()`, called by `transitionWorkOrder.ts:663` *after* a WO transition commits. No client path, no direct callable |
| Creation event | **`DISPATCHED` only** (`STATE_TRIGGERS.DISPATCHED = reserveParts`) |
| Increase event | `consumeParts` tops a reservation up to `qtyPlanned` at COMPLETED |
| Decrease / release | `CANCELLED → releaseParts` (releases whatever is outstanding); `COMPLETED → consumeParts` (consumes actual `qtyUsed`, RELEASES the unused remainder) |
| Transaction boundary | `db().runTransaction()` around every read-and-write |
| Concurrency | Per-part lock documents (`reservation_locks/{partId}`) forced into the transaction's read *and* write set, so a competing reserve invalidates the query result and Firestore retries. All-or-nothing: any short line aborts the whole transaction, "no partial reservations ever land" |
| Quantity semantics | `available = warehouseQty(static catalogue) + governedLedgerSum − (grossReserved − released)`. CONSUMED is deliberately **not** subtracted again — it finalises what RESERVED already removed |
| Company scope | **None.** No `operatingCompanyId` on the reservation |
| Location scope | **None.** Summed across ALL locations, warehouse and mobile alike |
| Part identity | `sku` (the WO `inventorySnapshot` identifier), not canonical `partId` |
| Source linkage | `workOrderId` on every entry |
| Affects physical on-hand? | **No.** RESERVED/RELEASED are logical commitment events; physical movement is RECEIVED/TRANSFER_*/ADJUSTED |
| Durable? | Yes — append-only ledger |
| Audit | The ledger itself, plus `inventory_sync_status` processed/failure markers |
| Read authority | `getPartBalance` / `getPartBalances` (`inventory.balance.read`, `active:false`); analytics reads |

**This is a real reservation.** It is not a pick list, not a staged item, not a UI derivation.

### 2.2 Authority B — Sales Order allocations (GOVERNED-INERT)

| Aspect | Measured |
|---|---|
| Canonical record | `sales_orders.lines[].allocatedQty` (+ `selectedSerialIds` for equipment) |
| Writer | `functions/src/fulfillment/allocateSalesOrder.ts` — records allocation **entirely on the Sales Order**. Writes **no ledger event** |
| Capability | `salesOrder.fulfill`, registered `active: false`; sandbox-eligible and sandbox-activated. Exported at `index.ts:91`. **Live deployment UNMEASURED in this pass** (no deploy performed) |
| Creation / increase | `allocateSalesOrder`, additive per line (`already + allocatableQty`) |
| Release | **Implicit, by state.** `ACTIVE_SO_STATES = ["CONFIRMED","IN_FULFILLMENT"]`, so a CANCELLED / FULFILLED / CLOSED order stops being netted. No explicit release write |
| Concurrency | `db.runTransaction`, self-netting (`selfAllocated` from the same pool) so re-runs converge and never double-commit |
| Netting | on-hand − open WO reservations − **other** active SO allocations, with WOs linked by `salesOrderId` lineage excluded so an SO's own downstream WO is not counted twice |
| Non-forking | Deliberately no parallel allocation ledger; the Sales Order is the sole allocation-commitment record |

### 2.3 Not commitment — measured and excluded

| Thing | What it actually is |
|---|---|
| `bin_placements` (put-away **and pick**) | Placement events. Write no ledger entry, change no quantity, touch no balance (Decision #116). A pick carries `pickedForWorkOrderId` and the source states beside it: *"IT STILL RESERVES NOTHING"* |
| `WorkOrder.inventorySnapshot[].qtyPlanned` | **Demand.** `setWorkOrderPartsPlan` states the invariant: *"PLAN PARTS != RESERVE PARTS != USE PARTS"*, and deliberately does not call `triggerInventoryEffects` |
| `sales_orders.lines[].orderedQty` | Demand. An order line commits nothing |
| Sales Agreement lines | Committed **price**, not committed stock |
| `receiving_orders`, transfers, cycle counts | Physical movement (RECEIVED / TRANSFER_IN / TRANSFER_OUT / ADJUSTED) |
| `inventory_returns` | Intake only; disposition authority does not exist (Decision #118) |
| Purchase orders / reorder requests | Inbound supply intent. No commitment of on-hand |
| `partsCatalog.ts warehouseQty` | Static baseline whose own header says **"NO STOCK AUTHORITY"** |

---

## 3. Work Order path — exact behaviour

```
create WO                      → no inventory effect
plan parts (qtyPlanned)        → no inventory effect  (explicit invariant)
SCHEDULED                      → no inventory effect
DISPATCHED                     → reserveParts()  ← THE COMMITMENT POINT
  · sums qtyPlanned per sku first, so duplicate rows cannot separately pass
  · checks availability per sku, takes per-part locks
  · ALL-OR-NOTHING: any shortfall aborts the whole transaction
pick / stage / scan            → no inventory effect
ARRIVED / WORK_IN_PROGRESS     → no trigger at all (not even a no-op marker)
COMPLETED                      → consumeParts(): top up to qtyPlanned, CONSUME qtyUsed,
                                 RELEASE the unused remainder
CANCELLED                      → releaseParts(): release whatever is outstanding
```

**The exact point stock becomes unavailable to another transaction: the `DISPATCHED` transition,
and nowhere earlier.** The standing invariant *PICKING RESERVES NOTHING* is confirmed, not
contradicted, and is now pinned by test.

A reservation failure never rolls back the Work Order: `triggerInventoryEffects` catches, records
`retryNeeded`, and swallows — the WO stays DISPATCHED with an unfulfilled reservation recorded for
retry. So **a dispatched Work Order does not guarantee committed stock.**

---

## 4. Sales Order path — exact behaviour

```
Opportunity → Agreement (ACCEPTED)  → commits PRICE, not stock
create Sales Order                  → no inventory effect
SO lines (orderedQty)               → DEMAND ONLY
allocateSalesOrder (explicit call)  → writes allocatedQty on the SO  ← THE COMMITMENT POINT
createServiceForSalesOrder          → seeds WO qtyPlanned from allocatedQty (demand, not commitment)
CANCELLED / FULFILLED / CLOSED      → implicitly released (no longer an ACTIVE_SO_STATE)
```

**An accepted or created Sales Order reserves nothing.** Commitment requires the separate,
capability-gated allocation command. Reservation is never inferred from the existence of a line.

---

## 5. Current "available" semantics — classification

| Surface | Formula | Class |
|---|---|---|
| `fulfillmentAvailability.computePartAvailability` | `onHandEligible − openWoReserved − otherSoAllocated − selfAllocated`, floored at 0, UNKNOWN if on-hand unknown | **GOVERNED DERIVATION** (Owner-ratified 2026-08-07, ledger amendment 2026-08-17) |
| `fulfillmentAvailability.sumLedgerEligibleOnHand` | ledger movements at `status==ACTIVE` warehouses; MOBILE excluded; SERIAL rows excluded from quantity math | **GOVERNED DERIVATION** |
| `fulfillmentAvailability.openWorkOrderReserved` | `RESERVED − RELEASED − CONSUMED`, floored at 0 | **GOVERNED DERIVATION** |
| `inventoryService.getAvailableQuantity` | `staticWarehouseQty + governedLedger − (grossReserved − released)`, **all locations** | **GOVERNED FACT** (it gates a real refusal) — but built on a **non-authoritative baseline**; see §6 |
| `partBalanceReadService.composePartBalance` | on-hand / reserved / available, UNKNOWN infectious | **GOVERNED DERIVATION**, capability-gated (`inventory.balance.read`), client transport flag off |
| `inventoryAnalyticsEngine.availableStock` (client) | client-side sum over `inventory_transactions` | **PRESENTATION-ONLY DERIVATION** — ND-28 permits it only as clearly-labelled derived information |
| `partsCatalog.ts warehouseQty` | static constant | **FIXTURE/SPECIMEN** — "NO STOCK AUTHORITY" |
| `PartsList` "Ledger-derived stock" | client derivation, renamed under ND-28 | **PRESENTATION-ONLY DERIVATION** |

---

## 6. The two conflicts

### CONFLICT 1 — the Work Order path is blind to Sales Order allocations

- `allocateSalesOrder` reads `inventory_transactions` **and** `sales_orders`, subtracting open WO
  reservations and other SOs' allocations before allocating.
- `inventoryService.getAvailableQuantity` reads `inventory_transactions` **and nothing else**. It
  contains no reference to `sales_orders`, `SALES_ORDERS_COLLECTION` or `allocatedQty`.

**Consequence:** a Sales Order can allocate units, and a later Work Order — one not linked to that
Sales Order by `salesOrderId` lineage — can be dispatched and reserve **the same units**. The
guard exists in one direction only.

**Severity today: LATENT, not live.** `salesOrder.fulfill` is `active:false` (sandbox-eligible
only), so no allocation exists in production to be over-committed. The conflict becomes real the
moment Sales Order fulfilment is activated in an environment where Work Orders are also dispatched.

### CONFLICT 2 — the two paths disagree about what is on hand

| | Work Order path | Sales Order path |
|---|---|---|
| Baseline | static `partsCatalog.warehouseQty` **+** ledger | ledger only |
| Locations | **ALL** (warehouse + mobile/truck) | `status==ACTIVE` **warehouses only** |
| Missing evidence | treated as `0` baseline | **UNKNOWN**, never 0 |

The Work Order path's static baseline comes from the file whose own header reads *"METADATA ONLY —
NO STOCK AUTHORITY"*, and ND-25 (Owner, 2026-08-30) ruled that same figure non-authoritative for
display. It is still load-bearing for a **refusal decision** here. Summing across all locations
also conflates warehouse and truck stock, which the Sales Order path deliberately separates.

**Not fixed here.** Changing either would change inventory calculations and commitment semantics —
explicitly outside this pass.

---

## 7. Release semantics — measured

| Event | Behaviour | Verdict |
|---|---|---|
| WO CANCELLED | `releaseParts` releases outstanding | **DEFINED** |
| WO COMPLETED | `consumeParts` consumes actual, releases remainder | **DEFINED** |
| WO plan quantity DECREASED after dispatch | Reservation **not** adjusted; `setWorkOrderPartsPlan` deliberately does not re-trigger | **STALE WINDOW** — self-heals only at COMPLETED (remainder released) or CANCELLED |
| WO plan quantity INCREASED after dispatch | Not reserved at the time; `consumeParts` tops up at COMPLETED, and can fail closed if stock is short | **STALE WINDOW** — commitment deferred to completion |
| WO requirement removed after dispatch | Row leaves `inventorySnapshot`; `releaseParts` iterates the CURRENT snapshot, so a removed row's outstanding reservation is **not** released | **GAP** — orphaned reservation possible |
| SO CANCELLED / FULFILLED / CLOSED | Falls out of `ACTIVE_SO_STATES`, so it stops being netted | **DEFINED** (implicit, by state) |
| SO line quantity decreased | No explicit release path found | **UNDEFINED** |
| Pick / stage | Nothing to release — nothing was committed | **N/A by design** |
| Issue (consume) | Converts reservation to permanent removal | **DEFINED** |
| Transfer | TRANSFER_IN/OUT; reservations untouched | **DEFINED** — but see Conflict 2 (all-location sum makes a transfer net to zero for the WO path) |
| Return | `inventory_returns` intake only; no ledger, no release | **N/A** — disposition authority does not exist (#118) |
| Inventory adjustment | ADJUSTED moves on-hand, not commitment | **DEFINED** |

---

## 8. Dashboard implication

The Sales & Inventory Dashboard North Star artifact is **not tracked in this repository** (no
`docs/north-star/` inventory-dashboard package; the specimen figures 4,182 / 618 / 3,564 appear
nowhere in the tree). The required correction is therefore recorded here rather than by editing an
untracked artifact.

The design asserts: `On hand 4,182 · Committed 618 · Available 3,564`, "reserved to WOs/SOs".

| KPI | Verdict |
|---|---|
| **On hand** | **TRUTHFUL, gated.** `sumLedgerEligibleOnHand` via `getPartBalance`. Must render UNKNOWN as unknown, must state it is ACTIVE-warehouse stock excluding trucks. Blocked only by `inventory.balance.read` activation + the client transport flag |
| **Committed** | **PARTIALLY TRUTHFUL, and the label is wrong as drawn.** A real WO commitment figure exists (`openWorkOrderReserved`). It is *not* "reserved to WOs **and** SOs": SO allocations live in a different store, under an inactive capability, and are invisible to the WO path. A single "Committed" number implies one authority where there are two, one of which is inert |
| **Available** | **NOT `on hand − committed` as drawn.** The one governed ATP derivation also subtracts other-SO allocations and self-allocation, and returns UNKNOWN rather than a number when on-hand evidence is missing |
| "reserved to WOs / SOs" | **NOT TRUTHFUL today.** The SO half commits nothing in any active environment |

**Required P1v2 correction, recorded for the design authority:**

1. Split the single "Committed" KPI, or scope it explicitly to **"Reserved to Work Orders"** — the
   only commitment that is live. Do not aggregate the two authorities behind one number.
2. Do not render "Available to promise" from `on hand − committed`. Either compose
   `computePartAvailability` in full or omit the KPI.
3. Every figure must be able to render **UNKNOWN**; the design has no unknown state.
4. Where neither authority is active, the truthful label for a Work Order's parts requirement is
   **"Open demand"**, not "Committed" or "Reserved".
5. State the location scope on screen — warehouse stock excludes truck/van inventory by design.

A test now fails if `availableToPromise`, `"Committed"`, or "Reserved to WOs/SOs" appears in the
client, so this cannot ship ahead of the ruling.

---

## 9. ATP — **OPEN**

A governed ATP derivation **exists** (`computePartAvailability`) and is Sales-Order-side,
capability-inactive. It is nonetheless **not** a general platform ATP, because these inputs are
not governed:

| Input | State |
|---|---|
| Location / eligible-warehouse set | governed on the SO path, **absent** on the WO path (Conflict 2) |
| Company ownership (Taylor / Ventana) | **not carried on a reservation at all** |
| Custody (truck / van / technician) | excluded from SO on-hand by design; conflated on the WO path |
| Already-picked / staged units | not represented — a pick commits nothing |
| Inbound PO quantities | not included; no promise-date authority exists |
| In-flight transfer quantities | net to zero on the WO path; not modelled as in-transit |
| Safety stock, reorder point | **no stored reorder point exists** (ND-29: "Not established") |
| Damaged / quarantined | no such state (Decision #117 kept condition out of put-away) |
| Serialized inventory | excluded from quantity math; counted by `serialized_assets` |

**ATP cannot be closed until Conflict 1 and Conflict 2 are ruled.** `onHand − committed` is
**not** the correct formula and must not be adopted by default.

---

## 10. Stockout — **OPEN**

No governed stockout definition exists. Candidates, none ruled: company on-hand = 0; location
on-hand = 0; available = 0; ATP ≤ 0; demand exists while supply = 0.

What exists instead is `inventoryAnalyticsService.predictStockout` — a deterministic **forecast**
over ledger history (`daysRemaining`, `riskLevel`), explicitly "NOT an inventory control system",
and permitted by ND-28 only as clearly-labelled derived information. It is a risk projection, not
a stockout state. `NEEDS_PLANNING` means "nothing to compute", not "low risk".

---

## 11. Proof

`functions/test/inventoryCommitmentAuthority.test.mjs` — **12 checks, no emulator required.**

Emulator-backed round trips (reserve/release/consume, WO-vs-WO concurrency, allocation idempotency)
are already covered by `inventoryService.test.mjs` and `allocateSalesOrderAllocation.test.mjs`;
this file deliberately does not duplicate them. It pins what nothing asserted:

1. `inventoryService.ts` is the **sole** writer of `type: "RESERVED"` — proven by exhaustion over
   `functions/src`, so a second writer fails the test rather than passing unnoticed.
2. Commitment is a lifecycle effect: DISPATCHED reserves, CANCELLED releases, COMPLETED consumes —
   and CREATED / READY_TO_DISPATCH / SCHEDULED / ACCEPTED / EN_ROUTE / ARRIVED / WORK_IN_PROGRESS
   are **not** triggers.
3. Eight governed demand/movement writers commit nothing.
4. **Picking reserves nothing**, including the `pickedForWorkOrderId` trap.
5. The SO path nets both authorities.
6. **The WO path is blind to SO allocations** — Conflict 1, pinned.
7. The two paths disagree about on-hand — Conflict 2, pinned.
8. `RESERVED − RELEASED − CONSUMED` floored at 0; lineage exclusion.
9. UNKNOWN carries **no quantity**, and a known 0 is a different fact.
10. ATP nets both authorities, self-nets, floors at 0.
11. No client surface renders Committed / Reserved-to / ATP.
12. The governed balance read is UNKNOWN-honest and capability-gated.

**Mutation-verified:** adding a `sales_orders` read to `inventoryService.ts` fails check 6, which
is the check that would have to change when Conflict 1 is ruled.

---

## 12. Open decisions (Owner)

1. **Conflict 1 — should a Work Order dispatch respect Sales Order allocations?** Three coherent
   answers: (a) WO reservation subtracts SO allocations, making one pool with one guard;
   (b) allocations and reservations are deliberately separate pools and the overlap is accepted;
   (c) SO allocation is retired in favour of a single ledger-based commitment. This must be ruled
   **before** `salesOrder.fulfill` is activated anywhere Work Orders are dispatched.
2. **Conflict 2 — one on-hand definition or two?** Specifically whether
   `inventoryService.getAvailableQuantity` should drop the static `partsCatalog` baseline and adopt
   the ratified `sumLedgerEligibleOnHand` (ACTIVE warehouses, MOBILE excluded, UNKNOWN honest).
   This changes what a dispatch refuses, so it is not a repo-hygiene call.
3. **Release on plan change** — should changing `qtyPlanned` after dispatch adjust the reservation,
   and should removing a requirement release its outstanding reservation? (§7 gap.)
4. **Reservation scope** — should a reservation carry `operatingCompanyId` and a location? Today it
   carries neither, so Taylor/Ventana and warehouse/truck cannot be distinguished in commitment.
5. **Stockout definition** (§10).
6. **ATP policy** (§9) — blocked on 1, 2 and 4.

---

## 13. Non-closures

- **ATP** — OPEN. A derivation exists; the policy does not.
- **Stockout** — OPEN. No definition of any kind.
- **Conflict 1** — recorded, latent, unruled. Gates `salesOrder.fulfill` activation.
- **Conflict 2** — recorded, live on the WO path, unruled.
- **Release gaps** (§7) — plan decrease, plan increase, requirement removal, SO line decrease.
- **Company / location scope on reservations** — absent.
- **Live deployment of `allocateSalesOrder`** — UNMEASURED. Exported and sandbox-eligible; merge is
  not deployment and no environment was read in this pass.
- **`salesOrder.fulfill` remains `active:false`** — unchanged by this reconciliation.
- **Dashboard** — Committed and ATP stay gated; the P1v2 correction in §8 is recorded, not applied,
  because the design artifact is not in this repository.
