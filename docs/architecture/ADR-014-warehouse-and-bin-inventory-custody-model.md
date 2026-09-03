# ADR-014 — Warehouse and Bin Inventory Custody Model

**Status:** ACCEPTED. Owner decision, 2026-09-02 (Model A — warehouse roll-up). **Amended 2026-09-03 by Decision #169** (internal relocation authority and ledger vocabulary; see *Movement semantics*).
**Amends:** Decision #116 (2026-08-20), for future BIN authority only. #116's ruling on the phase it governed stands as recorded.
**Recorded as:** Decision #160.
**Reconciliation:** `docs/implementation-plans/bin-location-authority-and-scanning.md`, `docs/assessments/inventory-location-registry-2026-08-20.md`.

---

## Context

The client requires an aisle/bay/bin process with human-readable labels and barcode scanning, and — critically — the ability to cycle count a scanned physical bin. That last requirement needs an authoritative quantity at a bin, which the system does not have.

Decision #116 (2026-08-20) ruled that **the warehouse is the inventory custody authority and a bin is a descriptive physical sub-location**. It ruled that way to protect one invariant: *putting stock into a bin must not remove it from warehouse on-hand or available*. Every governed authority — availability (`fulfillmentAvailability.ts`), receiving, transfer, and cycle-count expected quantity — counts a movement only at `type === "WAREHOUSE"` (and sometimes `MOBILE`). Had put-away moved stock to a `BIN`, a receipt would have vanished from sellable stock the moment it was stowed.

#116 also stated its own cost: *"a bin-to-bin move is not an inventory movement under this model, and 'how many are in rack 14' is only as good as the last placement recorded."* That cost is now being asked for, so #116 is revisited deliberately rather than worked around.

The assessment framed three coherent answers — **A** (bins roll up into the warehouse), **B** (bins are descriptive; ratified as #116), and **C** (bins are full custody locations, and binned stock is no longer warehouse stock). They are materially different businesses, not implementation variants.

## Decision

> **Adopt Model A. The warehouse remains the custody boundary. A bin becomes an authoritative physical inventory position beneath it.**

Model **B** is rejected: a descriptive bin cannot support an authoritative expected quantity for a scanned physical bin, which is the requirement.

Model **C** is rejected: it is unnecessary, it reinterprets every ledger row ever written, and its central claim — that binned stock is not warehouse stock — is precisely the failure #116 exists to prevent.

Model A is the only option that satisfies the requirement while preserving #116's load-bearing invariant.

## Authority boundaries

| Authority | Owner | Change |
|---|---|---|
| Quantity | `inventory_transactions` operational ledger; `serialized_assets` for serial units | **None.** Still the sole quantity authority. No bin balance field, ever |
| Custody boundary | `warehouses` (governed §3A record) | **None.** The warehouse remains the custody parent |
| Physical position within a warehouse | `bins` registry | **Elevated** from descriptive identity to an authoritative inventory position |
| Location resolution | `makeResolveTransferLocationActive` | Extended to resolve `BIN`; still exactly one resolver |
| Scan identity | `scannedIdentity.js` `INVENTORY_LOCATION` | **None.** Already supports a location identity |
| Cycle Count eligible types | Command-time governed policy (ruling D0(ii)) | **None in this ADR.** BIN is not admitted here |

**There is one Location authority and one quantity authority.** This ADR creates neither a second location system nor a second balance.

## Warehouse roll-up semantics

A warehouse's inventory is the sum of its **direct** balance and its **child bin** balances:

```
Phoenix Warehouse (aggregate)
├── direct WAREHOUSE balance      stock in the warehouse, not assigned to a governed bin
├── BIN A01-001 balance
├── BIN A01-003 balance
├── BIN AA04-011 balance
└── …

aggregate = direct + Σ(child bin balances)
```

**The `WAREHOUSE` component becomes the direct/unbinned balance rather than the whole.** This is the substantive change every consumer must absorb: today `location.type === "WAREHOUSE" && locationId === X` *is* the warehouse's total, because nothing is in bins. Under Model A it becomes one term of the total.

Parentage is authoritative in the `bins` registry: a bin belongs to exactly one warehouse, and the aggregate is defined by that parentage — never by parsing a display code.

## Movement semantics

| Movement | Warehouse aggregate | Note |
|---|---|---|
| `WAREHOUSE → BIN` | **unchanged** | Put-away / assign a governed bin. Direct decreases, child bin increases |
| `BIN → WAREHOUSE` | **unchanged** | Removed from a governed bin, still in warehouse custody |
| `BIN → BIN` (same warehouse) | **unchanged** | Physical relocation |
| `WAREHOUSE → MOBILE` | **decreases** | Mobile increases |
| `BIN → MOBILE` | **decreases** | Mobile increases |
| `MOBILE → WAREHOUSE` | **increases** | Lands in the direct/unbinned balance |
| `MOBILE → BIN` | **increases** | Lands in the named child bin |

**Cross-warehouse bin movement remains a governed Transfer.** There is no bin-to-bin shortcut across custody boundaries; crossing a warehouse boundary crosses a custody boundary and goes through the Transfer authority like any other.

**Ledger vocabulary — RESOLVED by Decision #169 (2026-09-03).** This paragraph originally left the
question open. The Owner has since ruled, and the answer is a **distinct vocabulary**:

| Concern | Authority | Ledger types | Source object |
|---|---|---|---|
| Internal relocation (same Warehouse custody parent) | `inventory.stock.relocate` *(inert)* | `RELOCATION_OUT` / `RELOCATION_IN` | `STOCK_RELOCATION` |
| Custody boundary (warehouse↔warehouse, anything touching MOBILE) | existing Transfer commands | `TRANSFER_OUT` / `TRANSFER_IN` | `TRANSFER_ORDER` |

**`TRANSFER_OUT` / `TRANSFER_IN` are deliberately NOT overloaded.** The pair would have expressed the
arithmetic correctly, but it would have made every shelf-to-shelf move read as stock leaving the
building — and it would have handed the Transfer authority a second meaning it does not own. Two
paired rows rather than one signed row (the shape Decision #168 chose for `WORK_ORDER_CONSUMPTION`)
because a relocation genuinely has two endpoints: it leaves one exact location and arrives at
another, and one signed row cannot say both.

**Put-away therefore needs two capabilities, not one.** `inventory.placement.record` stays narrow —
placement and history evidence, no quantity. An operation that both moves stock and records where it
went requires **both** it and `inventory.stock.relocate`, atomically; an actor holding only placement
is **refused** the quantity movement rather than given a descriptive-only success that looks
authoritative.

### Internal relocation versus custody transfer

The distinction this ADR draws between *aggregate-preserving* and *aggregate-changing* movement is now
also an **authority** boundary, not only an arithmetic one. The rows in the table above that leave the
aggregate unchanged are `inventory.stock.relocate`; every row that changes it is Transfer. There is no
third path and no shortcut: in particular, **no separate "quick truck move" writer** may be created,
because every MOBILE endpoint crosses a custody boundary and belongs to Transfer.

**Exact location is authoritative for movement, and aggregate is not.** A `WAREHOUSE` ledger row means
*direct / unbinned* stock; a `BIN` row means that exact bin; the Warehouse aggregate is a **derived
read** over direct plus all child bins. A movement may never be authorized by aggregate sufficiency,
and a parent `WAREHOUSE` row is never debited merely because stock exists somewhere in its children.

**Consequence measured during the Decision #169 reconciliation:** three existing readers assume a
location scalar is a Warehouse and silently drop BIN-located stock —
`fulfillment/fulfillmentAvailability.ts:106`, `inventoryAnalyticsCallables.ts:85`, and
`cycleCount/cycleCountExpectedQuantity.ts:70`. They are correct today because nothing is ever located
at a bin. Each becomes wrong the moment relocation is real, and the first would let a purely internal
move **destroy** warehouse on-hand. Making them bin-aware is BIN-P6 scope and is required by the
derived-read rule above.

## Historical data posture

**Existing WAREHOUSE-level ledger evidence remains authoritative exactly as recorded, and is never rewritten.**

A historical row reading `WAREHOUSE wh-phoenix +10` continues to mean exactly that. No bin precision is manufactured for a period when no bin was known.

This works cleanly under Model A precisely because the `WAREHOUSE` component becomes the **direct/unbinned** balance: every historical row remains truthful without reinterpretation — stock recorded at the warehouse and never binned *is* unbinned stock. This is the property Model C does not have.

Moving stock into bins later is recorded as **new governed evidence**, conceptually a paired decrease of the direct balance and increase at the bin, with **no change to warehouse aggregate quantity**.

Initial inventory conversion follows the same principle: do not rewrite history, do not claim bin placement that was never known, and transition from warehouse-level truth to governed bin placement through explicit evidence only.

## Bin identity posture

**A human-readable bin code is not the database identity.**

The current implementation derives the document id from the code — `deriveBinDocId(warehouseId, code)` = `bin_{warehouseId}__{code}`. Correcting a mislabelled rack therefore produces a *different document* and orphans that bin's placement history. That is not acceptable for a governed location identity.

**Required invariant:** changing a legitimate physical or business code must not change the underlying stable location identity. Placement records, ledger evidence, cycle counts and audit continue to point at the same bin.

**Canonical code uniqueness is scoped to the warehouse.** `Phoenix / A01-001` and `Seattle / A01-001` are both valid and are different bins. Within one warehouse, two *active* governed bins must not share the same canonical code.

A renamed or corrected code must remain traceable, and a stale printed label must not silently resolve to the wrong physical location. The smallest correct mechanism for code history is a BIN-P1 decision; **it must not be a second Location authority.**

Structured `Area / Aisle / Bay / Bin` attributes are stored so that the display formatter — not the schema — produces the final code convention. Bay width is therefore a display and policy question, not a schema question.

## Legacy authority retirement

`stock_locations` (a per-`(warehouse, part, binCode)` balance row) and the Epic 4 `StockLocation` / bin-transfer model are **legacy competing concepts and must never become the new authority.** Nothing writes `stock_locations`; it was superseded by the ledger on 2026-08-17 after measured divergence in both directions.

Retirement is sequenced, not immediate: census every remaining reader and writer; replace required readers with the authoritative ledger derivation; prove no required production path depends on the old model; then remove or deprecate. **Nothing is treated as retired merely because nothing writes it** — `inventoryAnalyticsCallables.ts` still reads it, and the permission catalog still describes it as bin-level quantity.

## Cycle Count dependency

Cycle Count A1 stores a **governed location reference** and validates eligible location types at **command time** (ruling D0(ii)), so admitting BIN is a policy and validation change, **not a schema migration**.

**BIN is not admitted by this ADR.** It becomes eligible only when all three hold:

1. BIN-P6 has established authoritative bin-level quantity;
2. the target warehouse's initial inventory conversion is complete enough that expected quantity at a bin is truthful;
3. Cycle Count's own activation and durable-read dependencies are satisfied.

**A partially converted warehouse must not pretend BIN-level expected quantity is complete.** Cycle Count does not solve location authority; it consumes it.

## Consequences

**Accepted costs:**

- Every quantity consumer that filters on `type === "WAREHOUSE"` must learn parentage: availability, transfer sufficiency, and cycle-count expected quantity. This is the change #116 named, now taken deliberately.
- The `bins` registry becomes authoritative about parentage, so a bin's warehouse can no longer be treated as advisory.
- Bin-level accuracy is only as good as the conversion. A half-binned warehouse has a correct aggregate and an incomplete bin picture, and the system must say so rather than imply completeness.
- The bin identity migration (BIN-P1) must land before any label is mass printed, or the first mislabel means reprinting the wall.

**Preserved:**

- Warehouse and mobile quantity authority, unchanged.
- All existing ledger history, unchanged and unreinterpreted.
- One location authority, one quantity authority, one scan resolver.
- The #116 invariant: stowing stock never removes it from warehouse on-hand or available.

## Non-goals

- No second Location registry, and no bin barcode registry. The `bins` registry is extended, never replaced.
- No stored bin balance or `binQuantity` field. Bin quantity is derived from ledger evidence or it does not exist.
- No generic Site or facility real-estate model. The warehouse is the physical and custody parent; Area is an attribute beneath it.
- No warehouse or floor-map visualization — no map schema, coordinates, CAD layout, visual editor or floor plan. Deferred until real layout information exists.
- No quarantine or inspection. Decision #117 stands unchanged.
- No capability activation or grants. Bin capabilities remain inactive until their operational model is ready.
- No MFID/RFID.
- No Cycle Count BIN eligibility in this ADR.
