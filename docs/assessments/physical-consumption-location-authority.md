# Physical consumption source-location authority — Owner decision package

**Status:** ASSESSMENT + OWNER DECISION REQUIRED. No physical inventory semantics were changed, no
location was inferred, no availability arithmetic was altered. Measured 2026-09-02 against `5824df2a`.

**Classification: `OWNER_LOCATION_AUTHORITY_REQUIRED`.**

---

## 0. The defect, stated exactly

Receive 5, consume 2, and governed physical on-hand still reads 5. A later Sales Order availability
read therefore re-offers units that are physically fitted to a machine.

Pinned by `functions/test/inventoryConsumptionOnHandGap.test.mjs` (#1749) and, from the custody side,
by `functions/test/consumptionCustodyBoundary.test.mjs` (this package).

---

## 1. The finding that matters: this is NOT "no location authority exists"

It is much narrower, and the difference changes what the Owner is being asked.

**Everything needed to remove stock at consumption already exists and is governed — except one fact.**

| Capability | State | Evidence |
|---|---|---|
| WAREHOUSE ⇄ MOBILE transfer | **EXISTS**, governed | `inventoryTransfer/transferOrderCommand.ts` — `dispatchTransferOrder` stages TRANSFER_OUT, `receiveTransferOrder` stages TRANSFER_IN; location-scoped, idempotent, audited; exported as 4 callables |
| Warehouse on-hand decrements on transfer-out | **EXISTS**, and **exactly once** | measured: receive 5 → transfer 3 → warehouse reads 2 |
| MOBILE (truck) on-hand derivation | **EXISTS** | `computeNoneOnHandThroughTxn` (per part+location) and `inventoryLedger/mobileLocationPresenceProbe.ts` (per location), both over the same single ledger |
| Truck identity | **EXISTS**, governed | Truck Registry `mobile_locations/{locationId}`; a truck has a governed driver, one truck per driver |
| Serialized custody | **EXISTS** | `serialized_assets.currentLocationId`, kept in sync by the Transfer command |
| Bin placement, linked to a Work Order | **EXISTS**, server-written | `bin_placements` carries `warehouseId`, `binId`/`binCode`, `partId`, `quantity`\|`serialNo`, `placedBy`, and **`pickedForWorkOrderId`**; deterministic placement id |
| **Which location a CONSUMED quantity left** | **ABSENT** | — |

That last row is the entire gap.

---

## 2. Where the pointer is missing — all three layers

The consumption path could have carried a source location at any of three points. It carries one at
none of them.

**1. The plan.** `InventorySnapshotItem` is `{ sku, partId?, name?, qtyPlanned?, qtyUsed?, category?,
notes?, lineId? }`. No `warehouseId`, no `inventoryLocationId`, no location of any kind.

**2. The capture.** `updateWorkOrderExecutionData` is the **only** write path for `qtyUsed`, and its
input is `{ sku, delta }`. The technician-facing surface (`ExecutionCapture.jsx`) is +/− buttons per
planned part and has **zero** location awareness.

**3. The ledger write.** `consumeParts` writes `{ workOrderId, partId, type: "CONSUMED", quantity }`.
No location.

And the model says so deliberately: `MOVEMENT_SOURCE_TYPE` maps each operational movement to its
producing source object, and **`WORK_ORDER` is deliberately absent** — "it belongs to the deferred
reservation/consumption ledger". `WORK_ORDER` *is* a declared `SOURCE_OBJECT_TYPE`. The exclusion is a
designed boundary, not an oversight, which is why moving it is an Owner decision rather than a fix.

**Reservation is location-less by design** — it pools eligible ACTIVE warehouses rather than selecting
one — so there is no reservation-time location to inherit either.

---

## 3. Why existing authority cannot resolve it

Every remaining route to a location is an inference the ruling forbids, and each is also wrong in
practice:

- **Work Order `locationId`** is the **customer site**, not an inventory location. Using it would be
  "infer from customer".
- **`assignedTechId` → employee → truck** is a real governed chain (a truck has a governed driver),
  but it is "infer from technician identity" — and it is *materially* wrong whenever the technician
  collected the part from a warehouse that morning rather than off the truck.
- **First / largest / nearest ACTIVE warehouse** manufactures business authority outright.
- **Subtracting CONSUMED globally, or only inside Sales Order availability**, would produce the right
  headline number while leaving the physical movement missing — a second derived truth, and the
  defect hidden rather than closed.

`bin_placements` is the closest existing thing, and it is genuinely close — but it is **not
sufficient on its own**, for two measured reasons:

1. **It changes no balance.** The command "writes a PLACEMENT RECORD and NOTHING ELSE… no ledger
   event, changes no balance". Placement is an event, not stock.
2. **It has no reader.** `bin_placements` is referenced nowhere in `functions/src` outside its own
   writer. It is durable evidence that nothing currently consumes.

And picking is **optional**: nothing requires a pick before dispatch or consumption, and picking
reserves nothing by explicit design. So a placement record may simply not exist for a given
consumption.

---

## 4. The double-subtraction hazard (the thing a fix will get wrong)

Measured, and now pinned:

```
receive 5 at warehouse            → warehouse on-hand 5
transfer 3 warehouse → truck      → warehouse on-hand 2      ← already decremented, once
technician fits 3 from the truck  → warehouse on-hand MUST STILL BE 2
```

A fix that decrements "the warehouse" on every consumption takes the warehouse to −1 (floored to 0),
**destroying stock that is physically still on the shelf**. The units stopped being warehouse stock at
transfer time.

Also measured, and sharper than it first appears: **truck stock is excluded from warehouse
availability by TYPE, not by an eligibility list.** `sumLedgerEligibleOnHand` skips every row whose
`location.type !== "WAREHOUSE"`, so passing a truck id in the eligible set does nothing at all.

This separates the two questions §7 of the brief asked to keep apart:

- **Does warehouse Sales Order availability include truck inventory?** **No, and correctly so** — the
  transfer already removed it, and the type filter keeps it out. Nothing to fix.
- **Can a Work Order consume inventory held on a truck?** **There is no mechanism at all** — and this
  is the open question.

---

## 5. Owner decision — the three viable models

### OPTION A — CUSTODY-FIRST
*A part must enter a governed custody location (truck, or staged/issued custody) before it can be
consumed. Consumption removes from that custody location; a Work Order cannot consume what has no
custody source.*

| | |
|---|---|
| **Workflow** | Every WO part is transferred/issued before use. Warehouse → truck (already supported) or warehouse → staged custody. |
| **Scanner** | Transfer scan already exists (`TransferScan.jsx`). No new screen strictly required. |
| **Technician** | No new action at consumption — custody is already established. |
| **Warehouse** | Significant new discipline: every job's parts must be issued, not just picked. |
| **Correctness** | **Highest.** Stock is always somewhere governed; the ledger is complete at every step. |
| **Offline** | Good — custody is established before the technician leaves. |
| **Audit** | Strongest: an unbroken chain from receipt to consumption. |
| **Migration** | **Highest.** Existing Work Orders have no custody; consumption would fail closed until every flow is retrained and re-tooled. |
| **Failure mode** | Dispatch/consumption blocked when custody is missing — i.e. **fail-closed everywhere on day one**. |
| **Authority change** | Adds a mandatory issue step to the Work Order lifecycle. |
| **Truck compatibility** | Native — this is what transfers already do. |

### OPTION B — EXPLICIT SOURCE AT CONSUMPTION
*The technician names the source inventory location when recording part usage. Consumption creates the
physical movement from that location.*

| | |
|---|---|
| **Workflow** | Unchanged up to the job; one new answer at usage time. |
| **Scanner** | `PartsScanner.jsx` / `ExecutionCapture.jsx` gain a location selection. |
| **Technician** | **New action on every part used** — the real cost of this option. |
| **Warehouse** | No change. |
| **Correctness** | High *if answered honestly*; the technician is the person who actually knows. |
| **Offline** | Needs the governed location list available offline; a truck's own id is easy, a warehouse list less so. |
| **Audit** | Good — an explicit human assertion, attributable. |
| **Migration** | **Lowest.** No back-fill; unanswered older records simply stay unknown. |
| **Failure mode** | Wrong or hurried answers; or refusal-to-record if the field is mandatory. |
| **Authority change** | Adds a location to the qtyUsed capture contract. |
| **Truck compatibility** | Native — the technician can name the truck. |

### OPTION C — SOURCE ESTABLISHED AT PICK / ASSIGNMENT
*The source is fixed earlier, when parts are picked/staged/handed off, and consumption follows that
lineage.*

| | |
|---|---|
| **Workflow** | Already exists for the picked path: `PickScan` stages parts into a bin **for a named Work Order**. |
| **Scanner** | **No new screen** — `bin_placements` already carries `warehouseId` + `pickedForWorkOrderId`. |
| **Technician** | **No new action.** |
| **Warehouse** | Picking becomes mandatory rather than optional — that is the real change. |
| **Correctness** | Good for picked parts; **silent on anything used off the truck that was never picked for this job**. |
| **Offline** | Already handled — picking is a warehouse-side action. |
| **Audit** | Good, and already server-written and idempotent. |
| **Migration** | Moderate: `bin_placements` needs a reader, picking needs to become required, and staged ≠ consumed quantities must be reconciled. |
| **Failure mode** | A consumption with no placement record has no source — so it still needs a fallback. |
| **Authority change** | Makes an optional operational step load-bearing for inventory truth. |
| **Truck compatibility** | Partial — covers warehouse picks, not truck stock. |

---

## 6. Recommendation

**Option C as the primary path, with Option B as the explicit fallback — and not Option A first.**

The reasoning is repository truth, not ease of coding:

1. **C is the only option where the required record already exists.** `bin_placements` already carries
   `warehouseId` + `pickedForWorkOrderId` + part + quantity, server-written with a deterministic id.
   It needs a reader, not a new subsystem.
2. **C alone is provably insufficient**, and the gap is exactly the truck case — a part fitted from
   truck stock that was never picked for this job has no placement record. That case is real and
   common, so a fallback is required rather than optional.
3. **B is the honest fallback** precisely there: the technician is the only party who knows they took
   it off the truck, and the truck is a single governed id they can name.
4. **A is the strongest model and the wrong place to start.** It is where this should probably end up,
   but adopting it now makes consumption fail closed for every existing Work Order until warehouse
   practice changes. That is an operational programme, not a code change.

**The refusal case must be decided too, and it is not a detail.** When neither a placement nor an
explicit source exists, consumption must either be **refused** (correct inventory, blocked field work)
or **recorded with source UNKNOWN** (field work proceeds, physical on-hand stays overstated for that
quantity, and the figure must say so). This package does not choose. It is the single question that
determines whether Day-1 can ship.

---

## 7. What this package changed

**Nothing in physical inventory semantics.** One test file was added —
`functions/test/consumptionCustodyBoundary.test.mjs` (10 cases) — pinning the custody facts a fix will
be built on: transfer conserves and decrements once, MOBILE is excluded by type, MOBILE on-hand is
derivable, SERIAL custody stays with the serialized authority, the consumption path carries no
location at any of its three layers, and `WORK_ORDER` produces no operational movement.

Its central assertion models **both** candidate fixes and shows the wrong one erasing real stock — so
the double-subtraction hazard fails a test rather than reaching production.

---

## 8. Non-closures

- `PHYSICAL_CONSUMPTION_LOCATION_AUTHORITY_REQUIRED` — **OPEN**, pending the ruling above.
- Sales Order commitment unification — gated; `salesOrder.fulfill` remains `active: false`.
- ATP, stockout — OPEN and untouched.
- Whether warehouse availability should ever include truck stock — **not** raised by this package;
  the transfer already handles it correctly.
- `bin_placements` has no reader; making it load-bearing is part of Option C, not a separate fix.
