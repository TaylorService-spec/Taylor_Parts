---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-09-02
owner: Claude Code
related_adrs: ["ADR-014"]
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Implementation Plan: BIN-001 — governed Bin / Location authority and scanning

**Reconciled against:** `origin/main` @ `c54cd21800b424c75a74a85fa38dd2d7788e9a5c`, read directly on 2026-09-02. Every claim in *Verified current state* is sourced; nothing is recalled.

**Amended by BIN-P0, 2026-09-02:** Owner rulings O-1 through O-7 are final and recorded in **Decision #160** and **ADR-014 — Warehouse and Bin Inventory Custody Model**. No Owner architectural decision remains open.

**Reading this document:** §3 is the **VERIFIED CURRENT STATE** — what the repository does today, where a bin is still descriptive and no `BIN` movement exists. §6a onward is the **APPROVED TARGET STATE**. Nothing in §3 changes until BIN-P6 ships.

**Status of this document:** planning and governance only. No application code, Firestore Rules, capability, grant, or deployment change was made.

---

## 1. Context

The client requires an aisle/bay/bin process in the Parts Room and Warehouse, with human-readable labels and barcode scanning. The requested operating chain is:

```
governed physical Location -> stable locationId -> human-readable aisle/bay/bin code
  -> barcode resolves to that same locationId
  -> inventory movement records stock at that locationId
  -> authoritative (partId, locationId) quantity exists
  -> Cycle Count may later admit BIN as an eligible count scope
```

**The census produced one finding that changes the shape of this plan: most of this already exists, and the one part that does not exist was deliberately excluded by a ratified Owner decision.**

`functions/src/inventoryLocation/` already contains a governed bin registry, bin lifecycle commands, mounted callables, a put-away command, two declared least-privilege Roles, and a scanning UI. What it deliberately does **not** do is make a bin a custody location — because **Decision #116** ruled that it must not.

The last two links of the client's chain therefore required revisiting #116 — an Owner decision about warehouse operations, not an implementation detail. **That decision has now been made: Decision #160 adopts Model A, warehouse roll-up** (§6a). The warehouse remains the custody parent; a bin becomes an authoritative physical position beneath it, and a warehouse's total is the roll-up of its direct balance and its child bins.

## 2. Client convention (as supplied, not as decided)

Physical hierarchy: **Site → Area → Aisle → Bay → Bin.**

Parts Room code convention: `[Aisle + Bay]-[Bin]`, e.g. **`A01-001`**.

| Element | Parts Room | Warehouse |
|---|---|---|
| Aisle | `A`–`Z` (one letter) | `AA`–`ZZ` (two letters) |
| Bay | two digits | one digit *per the warehouse document*, but a separate floor-walk document shows aisles exceeding 9 bays |
| Bin | three digits | three digits |

Numbering policy: initial physical positions use **odd** values — `001, 003, 005, 007, …` — with **even values reserved, not invalid**. A reserved even value may later be activated as a governed location without renumbering its neighbours.

Variability: bay count varies by aisle; bin count varies by bay; irregular, deep, oversized and non-uniform storage must be configurable individually rather than forced into a uniform generated layout.

Labels and barcodes are required. Phone cameras and dedicated scanners must resolve the same governed location. **No MFID/RFID in this scope.**

**A useful compatibility fact:** the existing bin code pattern is `/^[A-Z0-9][A-Z0-9.\-_]{0,31}$/` after whitespace-collapse and upper-casing (`binRegistry.ts`). `A01-001` and `AA01-001` both satisfy it unchanged. **The client's display convention needs no code-format change to the existing registry.** The bay-width question is a generator and policy question, not a schema question.

## 3. Verified current state

### 3.1 Location identity

There is **no single generic Location registry.** There are two type-specific governed registries dispatched by a resolver switch:

| Type | Registry | Validator | Classification |
|---|---|---|---|
| `WAREHOUSE` | `warehouses/{id}` | `warehouseGovernance/governedWarehouseValidation.ts` (§3A, strict allow-list, `status ACTIVE`/`INACTIVE`) | **AUTHORITATIVE** |
| `MOBILE` | `mobile_locations/{id}` | `truckRegistry/truckRegistryRepository.ts` (ADR-010) | **AUTHORITATIVE** |

`inventoryTransfer/transferLocationResolver.ts` is the single governed resolver both Transfer and Cycle Count use (`makeResolveTransferLocationActive`, pinned in `cycleCountCommandComposition.ts`). It returns `false` for every type other than `WAREHOUSE` and `MOBILE`.

The governed warehouse record carries exactly: `id`, `name`, `location` (a display string), `status`, `version`, `updatedAt/By`, `provenance`, `createdAt/By`, `governanceInitializedAt/By`, `operatingCompanyId`. **Any unknown key fails closed.** There is no aisle, bay, area or site field, and none can be added without amending that allow-list.

Per `ownership/ownershipMatrix.ts`, **only `warehouses` and `mobile_locations` are primary company-boundary roots** — a measured correction from an earlier four-root plan.

Retired/inactive locations are represented (`status`, and bin `INACTIVE`); **location aliases and rename history are not represented anywhere.**

### 3.2 The bin authority that already exists

`functions/src/inventoryLocation/` — 967 lines, all mounted:

| File | What it is | Classification |
|---|---|---|
| `binRegistry.ts` | Pure bin identity: `normalizeBinCode`, `deriveBinDocId(warehouseId, code)`, `validateBinDraft`, `resolveBin` returning `FOUND`/`INACTIVE`/`NOT_FOUND`/`WRONG_WAREHOUSE`/`MALFORMED` | **AUTHORITATIVE** (identity only) |
| `binCommands.ts` | `bins` collection; create / deactivate / reactivate / get / list | **AUTHORITATIVE** |
| `binCallables.ts` | `createBin`, `deactivateBin`, `reactivateBin`, `resolveBin`, `listBins`, `recordPutAway` — **exported from `functions/src/index.ts`** | **AUTHORITATIVE** |
| `putAwayCommand.ts` | `bin_placements` — append-only placement **events**. Writes no ledger event, no quantity, no balance. A test asserts it never imports the ledger | **AUTHORITATIVE** (placement evidence only) |
| `locationDisplayReadService.ts` | `getLocationDisplay`: id → `{type, label}` for `WAREHOUSE` and `MOBILE` only; anything else resolves `UNRESOLVED` and never fabricates a label | **DERIVED** |

Client surfaces already exist: `field-ops-app-vite/src/modules/scan/PutAwayScan.jsx`, `PickScan.jsx`, and `services/binCommandClient.js`.

Capabilities are registered **`active: false` and granted to no role**: `inventory.location.bin.manage`, `inventory.location.bin.read`, `inventory.placement.record`, `inventory.location.display.read`, `inventory.warehouse.status.set`. Two least-privilege Roles are *declared* in `governedBusinessRoles.ts` — one carrying `bin.read` + `placement.record`, one carrying `bin.manage` + `bin.read` — but declaring a Role grants nothing.

`bins` and `bin_placements` have **no `firestore.rules` match block**, so they are deny-all to every client by default. The callables run on the Admin SDK. This is the correct posture and needs no change.

### 3.3 Inventory quantity by location

**One authority: the append-only `inventory_transactions` operational ledger.**

`operationalMovementTypes.ts` defines `INVENTORY_LOCATION_TYPES = ["WAREHOUSE", "BIN", "MOBILE", "VENDOR", "CUSTOMER", "VIRTUAL"]` and a `LocationRef { type, locationId }` on every movement. **`BIN` is already schema-legal on a movement.** Nothing emits one.

Quantity derivation, verified in `cycleCount/cycleCountExpectedQuantity.ts` and `fulfillment/fulfillmentAvailability.ts`: `RECEIVED`/`RETURNED`/`TRANSFER_IN` add, `TRANSFER_OUT`/`SCRAPPED` subtract, `ADJUSTED` is signed, `COUNTED` is excluded. Filtering is on **both** `location.type` and `location.locationId`.

- **WAREHOUSE quantity: authoritative today.**
- **MOBILE quantity: authoritative today** (Cycle Count and Transfer both operate on it).
- **BIN quantity: NOT authoritative — and by ratified decision, not by omission.**

Writers: Receiving records at `WAREHOUSE`; Transfer moves `WAREHOUSE↔WAREHOUSE` and `WAREHOUSE↔MOBILE`; reconciled Cycle Count stages `ADJUSTED`. **No writer emits a `BIN` movement.** Put-away is not an inventory movement at all — it is a placement event. Pick/Stage is verification and staging, not custody.

### 3.4 The competing on-hand source (flagged, not normalised away)

`stock_locations` is a **second on-hand shape** and must be named plainly:

- `types/warehouse.ts` defines `StockLocation { id, warehouseId, partId, quantity, binCode, updatedAt }` — a per-(warehouse, part, binCode) **balance** row.
- `ownershipMatrix.ts` records the measured correction: *"`stock_locations` is a per-warehouse-per-part BALANCE record, not a place."*
- `fulfillmentAvailability.ts` records the supersession (Owner-ratified 2026-08-17): *"Nothing in the codebase ever WRITES `stock_locations` -- it is a seeded legacy projection"*, and documents real sandbox divergence in both directions (`PRT-1001` held 3 received units while `stock_locations` said 0; `PRT-1005` said 40 with nothing ever received).
- `permissionCatalog.ts:557` still describes `warehouse.stockLocation.read` as *"bin-level quantity within a warehouse"*.
- `inventoryAnalyticsCallables.ts` still reads the collection.

Alongside it, `types/warehouse.ts` carries a **legacy Epic 4 bin model** entirely disjoint from the governed one: `TransferOrder { fromWarehouseId, toWarehouseId, fromBinCode, toBinCode }` and `WarehouseDiscrepancy`, served by `warehouseService.ts` and `warehouseReconciliationService.ts`.

**Classification: DEAD/LEGACY, but still readable and still described in the permission catalog as a bin-level quantity.** This is the single most dangerous artefact for this program: a future implementer looking for "bin-level quantity" will find it, and it is neither authoritative nor written.

### 3.5 Scanning and barcode identity

`field-ops-app-vite/src/domain/scannedIdentity.js` is the shared boundary. `SCANNABLE_ENTITY_TYPES` already includes **`INVENTORY_LOCATION` — "LocationRef: { type, locationId } incl. MOBILE = truck"**, alongside `PART`, `SERIALIZED_ASSET`, `WORK_ORDER`, `EQUIPMENT`. Resolution states are `RESOLVED` / `NOT_FOUND` / `AMBIGUOUS` / `INVALID`, deliberately excluding an authorization outcome. The module is pure: candidates are injected by the caller, which owns the governed read.

`part_aliases` (`partMaster/`) is the barcode alias registry — ten alias types, GS1 digit-length validation, duplicates prevented by a derived document id. **It is part-scoped. There is no location alias type and no location alias registry.**

Bin scanning today does not go through an alias table at all: `resolveBin(rawCode, expectedWarehouseId, stored)` matches a scanned code against the normalized bin code within a warehouse, and duplicates are structurally impossible because the document id derives from `(warehouseId, code)`.

Phone camera and dedicated scanner input converge through the same `ScanInput` component and the same resolver; no second path exists.

### 3.6 Administration and configuration authority

| Configurable | Read | Write | Surface |
|---|---|---|---|
| Warehouses | `warehouses` client-readable per Rules | `warehouseStatusWriter.ts` — **INERT, unexported, no callable**; status transitions and NATIVE creation only | `modules/inventory/Warehouses.jsx` |
| Bins | `listBins` / `resolveBin` callables (inert) | `createBin` / `deactivateBin` / `reactivateBin` callables (inert) | **No Administration screen.** Only `services/binCommandClient.js` and the scan workflows |
| Aisles, bays, areas, sites | — | — | **Do not exist** |
| Location status | warehouse `status`; bin `status` | as above | partial |
| Location aliases / barcodes / labels | — | — | **Do not exist** |

**Gap against the Owner's no-developer-tooling rule:** there is no operator path to configure racking. The commands exist; the screen does not, and the capabilities are inert. Warehouse creation itself has no callable at all.

## 4. Existing authorities to preserve

Reuse these unchanged. Do not rebuild any of them.

1. `warehouses` §3A governed record and `governedWarehouseValidation.ts`.
2. `mobile_locations` truck registry (ADR-010).
3. `makeResolveTransferLocationActive` — the one governed location resolver.
4. `inventory_transactions` as the sole quantity authority, with its existing derivation rules.
5. `binRegistry.ts` — identity, normalization, derived-id uniqueness, `resolveBin` semantics including `WRONG_WAREHOUSE`.
6. `binCommands.ts` / `binCallables.ts` lifecycle.
7. `putAwayCommand.ts` and `bin_placements` as placement evidence.
8. `scannedIdentity.js` with its existing `INVENTORY_LOCATION` type.
9. `part_aliases` derived-id duplicate prevention as the **pattern** for any location alias, if one is ever needed.
10. The inert-and-ungranted capability posture, and the two declared bin Roles.
11. `getLocationDisplay` as the id → label resolver.

## 5. Gaps against the approved target

Gaps are measured against the **approved target state** (§6a), not against what #116 required.

| # | Gap | Severity | Closed by |
|---|---|---|---|
| G1 | **Bin identity is derived from the human code.** `deriveBinDocId(warehouseId, code)` = `bin_{warehouseId}__{code}`. Correcting a mislabelled code creates a *different document* and orphans its placement history. Ruled unacceptable by O-3 | **High** | BIN-P1 |
| G2 | No structured Area / Aisle / Bay attributes. A bin code is one flat string | Medium | BIN-P1 |
| G3 | No Administration surface to configure warehouses, bins or racking | High | BIN-P3 |
| G4 | No bin generator (odd-numbering, per-aisle bay counts, per-bay bin counts, individually configurable irregular positions) | Medium | BIN-P3 |
| G5 | No location label generation, printing or export | Medium | BIN-P5 |
| G6 | **No bin-level quantity authority.** Deliberate under #116; now the central gap the approved target closes | **Blocking for BIN counting** | BIN-P6 |
| G7 | `stock_locations` and the Epic 4 legacy bin/transfer model remain readable and are still described as bin-level quantity | High | BIN-P2 |
| G8 | Every bin capability is inert and ungranted; no operator can use what exists | High | BIN-P4 |
| G9 | No location code history; a corrected code leaves no trail, and a stale printed label could resolve to the wrong place | Medium | BIN-P1 |
| G10 | Warehouse creation has no callable at all (`warehouseStatusWriter` is unexported and inert) | Medium | BIN-P3 |
| G11 | Every quantity consumer filters on `type === "WAREHOUSE"` as if it were the warehouse total. Under roll-up it becomes the direct/unbinned term | **High** | BIN-P6 |

## 6. Decision #116 — revisited and amended

**Decision #116 (Owner, 2026-08-20)** ruled the warehouse the custody authority and a bin a descriptive sub-location, protecting the invariant that *putting stock into a bin must not remove it from warehouse on-hand or available*. It stated its own cost: *"a bin-to-bin move is not an inventory movement under this model, and 'how many are in rack 14' is only as good as the last placement recorded."*

The client requirement is that cost. **#116 has been revisited and amended by Decision #160 / ADR-014 — deliberately, and only for the forward posture.** #116's ruling on the phase it governed stands as recorded, and the put-away implementation built under it remains correct for that phase.

### 6a. Approved target state — Model A, warehouse roll-up

> **The warehouse remains the custody parent. A BIN becomes an authoritative physical inventory position beneath it.**

```
Phoenix Warehouse (aggregate)
├── direct WAREHOUSE balance      stock in the warehouse, not assigned to a governed bin
├── BIN A01-001 balance
├── BIN A01-003 balance
├── BIN AA04-011 balance
└── …

aggregate = direct + Σ(child bin balances)
```

Model **B** (descriptive) was rejected: it cannot support an authoritative expected quantity for a scanned bin. Model **C** (bin replaces warehouse custody) was rejected: unnecessary, it reinterprets all existing ledger history, and its claim that binned stock is not warehouse stock is exactly what #116 prevents.

**The substantive shift:** today `type === "WAREHOUSE" && locationId === X` *is* the warehouse total, because nothing is in bins. Under the target it becomes the **direct/unbinned** term of the total. Parentage is authoritative in the `bins` registry — never parsed from a display code.

**This is a target, not current behaviour.** §3 remains the verified current state: bins are descriptive today, put-away writes placement events only, and no `BIN` movement exists. Nothing in §3 changes until BIN-P6 ships.

## 7. Owner rulings (final) and remaining client decisions

### Owner decisions — all resolved (Decision #160, ADR-014)

| Ref | Decision | Ruling |
|---|---|---|
| **O-1** | Revisit #116 — B, A or C? | **Model A — warehouse roll-up.** §6a |
| **O-2** | Interpretation of existing WAREHOUSE-level ledger history | **Never rewritten.** Historical rows stay authoritative exactly as recorded; they become the direct/unbinned term, which keeps them truthful without reinterpretation. Later bin assignment is new governed evidence with no aggregate change. **Ledger vocabulary is not invented here** — `TRANSFER_OUT`/`TRANSFER_IN` already expresses the semantics; BIN-P6 confirms whether put-away may use it given Transfer's exclusive movement authority, or whether a distinct type is required |
| **O-3** | Bin identity | **Stable surrogate identity.** The human code is not the database id. Changing a legitimate code must not change the stable identity; placements, ledger evidence, cycle counts and audit keep pointing at the same bin. Code history must be traceable and a stale label must not silently resolve to the wrong place — smallest correct mechanism is a BIN-P1 decision, and **must not be a second Location authority** |
| **O-4** | Countable-location-type policy | **Governed integrity policy**, not ordinary Administration configuration. Racking configuration may be Admin data; admitting a type to Cycle Count changes stock-integrity authority. May later be stored as data, but ordinary Admin preference editing is not sufficient authority. Consistent with Cycle Count ruling D0(ii) |
| **O-5** | Capability activation | **Deferred.** `inventory.location.bin.*` and `inventory.placement.record` stay inactive and ungranted until the model is operationally coherent. Activation moves **after** BIN-P6 in the execution order |
| **O-6** | Legacy competing authority | **Retire, in sequence, deleting nothing now:** census readers/writers → replace required readers with the ledger derivation → prove no required production path depends on it → then remove or deprecate. **Not retired merely because nothing writes it** |
| **O-7** | Bin code uniqueness | **Scoped to the warehouse.** `Phoenix / A01-001` and `Seattle / A01-001` are both valid and different. Within one warehouse, two ACTIVE bins must not share a canonical code |

**Also ruled:** Site/Area posture is Operating Company → Warehouse → Area → Aisle → Bay → Bin, with the warehouse as the physical and custody parent and Area an attribute beneath it — **no generic facility or real-estate model**. Warehouse and floor-map **visualization is deferred**. Decision **#117** (no quarantine as a side effect of put-away) is unchanged.

### Client decisions — still open, none blocking BIN-P1

| Ref | Decision | Blocks |
|---|---|---|
| **C-1** | Warehouse bay width — one digit or two? The warehouse document says one; the floor-walk document shows aisles exceeding 9 bays. Recommendation: **two**. **Must close before mass label printing.** Does not block the data model — BIN-P1 stores structured bay identity so the display formatter produces the final convention without another identity migration. **One-digit bay width must not be hard-coded into the schema** | Gate A |
| **C-2** | Final Phoenix Parts Room and Warehouse area codes | Gate A |
| **C-3** | Recorded as ruled: warehouse = Site, Area an attribute. Remaining client input is which Areas exist (e.g. Parts Room, Warehouse Storage) | Gate A |
| **C-4** | Default barcode symbology — informs a default, does not define the data model | Gate A |
| **C-5** | Label medium — thermal/ZPL (needs a print bridge) or laser plus sheets (needs nothing beyond an HTML print view) | Gate A |
| **C-6** | Part-to-bin rules: may one part occupy several bins; may one bin hold several parts | BIN-P6 |
| **C-7** | Do irregular / deep / oversized positions need recorded attributes (capacity, depth, oversize flag), or only individual creation | BIN-P3 |

## 8. Target authority model

| Target concept | Status | Note |
|---|---|---|
| stable `locationId` | **EXISTS — extend minimally** | Warehouse and mobile ids are stable. Bin id is code-derived (G1); O-3 requires a surrogate |
| company / tenant scope | **EXISTS — reuse unchanged** | `operatingCompanyId` on the warehouse; bins derive from `warehouseId` |
| site | **EXISTS — reuse unchanged** | The warehouse is the site |
| area | **MISSING — required** | A bin attribute, not a registry |
| aisle | **MISSING — required** | Structured attribute on the bin record |
| bay | **MISSING — required** | Structured attribute; width is a formatter concern, never schema |
| bin | **EXISTS — reuse unchanged** | `bins` registry; `A01-001` and `AA01-001` already match the existing code pattern |
| `displayCode` | **EXISTS — extend minimally** | `code` (normalized) plus `originalCode` (as typed); becomes a mutable attribute under O-3 |
| code history | **MISSING — required** | BIN-P1; not a second authority |
| status | **EXISTS — reuse unchanged** | `ACTIVE`/`INACTIVE`, retire-never-delete |
| barcode / scan identity | **EXISTS — extend minimally** | `INVENTORY_LOCATION` already scannable; `resolveBin` already resolves a scanned code. **No separate bin barcode table** |
| audit / provenance | **EXISTS — reuse unchanged** | Governed command + audit event pattern |
| bin-level quantity | **MISSING — required** | BIN-P6, under roll-up. Derived from ledger evidence; **never a stored field** |
| warehouse aggregate = direct + children | **MISSING — required** | BIN-P6. G11 |

## 9. Barcode and scanning relationship

The required invariant is achievable with what exists:

```
printed location identity (A01-001)
  -> barcode representation
  -> shared scan identity boundary (scannedIdentity.js, INVENTORY_LOCATION)
  -> resolveBin(code, expectedWarehouseId, stored)
  -> exactly one governed bin, by stable identity
```

**No separate bin barcode table is recommended, and current authority does not require one.**

Two consequences to hold:

- **A scan resolves identity and context. It never moves inventory.** `PutAwayScan.jsx` already obeys this — the scan resolves a bin, a separate governed command records the effect.
- Under O-3 the printed code becomes a **lookup key rather than the identity**, so the resolver gains one indirection and a label survives a code correction. A stale label must fail visibly, never resolve to the wrong physical location.

**A label must not be required to expose a raw database id.** The human code is what is printed; the stable identity is what it resolves to.

## 10. Inventory movement relationship

**Current (verified):** put-away writes `bin_placements`; the ledger is untouched; `(partId, WAREHOUSE locationId)` and `(partId, MOBILE locationId)` are the finest authoritative granularity.

**Target (approved, BIN-P6):**

| Movement | Warehouse aggregate |
|---|---|
| `WAREHOUSE → BIN` (put-away) | **unchanged** — direct decreases, child bin increases |
| `BIN → WAREHOUSE` | **unchanged** |
| `BIN → BIN` (same warehouse) | **unchanged** |
| `WAREHOUSE → MOBILE` | **decreases** |
| `BIN → MOBILE` | **decreases** |
| `MOBILE → WAREHOUSE` | **increases** — lands in direct/unbinned |
| `MOBILE → BIN` | **increases** — lands in the named child bin |

**Cross-warehouse bin movement remains a governed Transfer**, never a bin shortcut: crossing a warehouse boundary crosses a custody boundary.

Every derivation must learn parentage — `cycleCountExpectedQuantity.ts`, `fulfillmentAvailability.ts`, transfer sufficiency (G11). **No `binQuantity` field, ever.** G7 is the measured example of what a second balance does.

## 11. Cycle Count dependency

> **Where those documents live:** the Cycle Count implementation plan and the A1 specification are on branch `claude/cycle-count-a1-spec` (commits `7e457d7f`, `f585125d`) and are **not yet on `main`**. The rulings referenced here — D0(ii) and the A1 record shape — come from that reviewed and approved pair.

Compatible **without migration**: the A1 sheet stores a governed location reference, and A1 moves the `WAREHOUSE`/`MOBILE` fence out of shape validation into command-time eligibility policy (ruling D0(ii)). Admitting BIN is a policy and validation change.

**Cycle Count eligibility is NOT widened here.** BIN becomes eligible only when all three hold:

1. **BIN-P6** has established authoritative bin-level quantity;
2. the target warehouse's **initial inventory conversion is complete enough** that expected quantity at a bin is truthful;
3. Cycle Count's own **activation and durable-read dependencies** are satisfied.

**A partially converted warehouse must not pretend BIN-level expected quantity is complete.** Cycle Count consumes location authority; it does not solve it.

## 12. Initial inventory conversion dependency

Bins are useless until stock is actually located in them, and that is an operational programme, not a PR.

Under the approved target, conversion records **new governed evidence** moving stock from the direct/unbinned balance into named bins, **with no change to warehouse aggregate quantity**. History is never rewritten and no bin placement is claimed for a period when none was known (O-2).

A partially converted warehouse therefore has a **correct aggregate and an incomplete bin picture**. The system must say so rather than imply completeness. Conversion completion for a given warehouse is a hard gate on BIN counting *at that warehouse* (gate E).

## 13. PR sequence

Identifiers are preserved from the reviewed BIN-001 reconciliation; **BIN-P4 now executes after BIN-P6** per ruling O-5. The identifiers are not renumbered, because they are already referenced in Decision #160 and in review.

**Execution order:** `P0 → P1 → P2 → P3 → P5 → P6 → P4 → P7 → P8`

| # | PR | Surfaces | Authority | Tier | Depends on | Owner decision |
|---|---|---|---|---|---|---|
| **BIN-P0** | Custody-model ruling — Decision #160 + ADR-014 + this amendment | `docs/DECISIONS.md`, `docs/architecture/ADR-014-*`, this plan | None (governance) | Tier 2 | — | **Complete** |
| **BIN-P1** | Stable surrogate bin identity; structured Area/Aisle/Bay/Bin; canonical-code uniqueness within warehouse; code-history posture | `inventoryLocation/binRegistry.ts`, `binCommands.ts`, `binCallables.ts` | Bin registry identity | Tier 1 | BIN-P0 | — |
| **BIN-P2** | Retire/neutralize `stock_locations` + Epic 4 competing authority; replace required readers with ledger derivation first | `types/warehouse.ts`, `warehouseService.ts`, `warehouseReconciliationService.ts`, `inventoryAnalyticsCallables.ts`, `permissionCatalog.ts` description | Removes a competing on-hand shape | Tier 2 | BIN-P0 | — |
| **BIN-P3** | Administration racking configuration + odd-numbering generator, per-aisle bay and per-bay bin counts, individually configurable irregular positions | `modules/administration/*`, `services/binCommandClient.js` | UI over existing commands; **no new write authority** | Tier 1 | BIN-P1 | C-2, C-7 |
| **BIN-P5** | Location label generation and export; symbology as Administration configuration | new `modules/administration/*` | None new | Tier 1 | BIN-P1, C-1 | C-1, C-4, C-5 |
| **BIN-P6** | **Bin-level custody:** ledger emits `BIN`; availability, transfer sufficiency and cycle-count expected quantity learn parentage; WAREHOUSE↔BIN and BIN↔BIN semantics | `inventoryLedger/*`, `fulfillment/*`, `inventoryTransfer/*`, `cycleCount/cycleCountExpectedQuantity.ts`, `putAwayCommand.ts` | **Changes what every existing quantity means** | **Tier 2** | BIN-P1, BIN-P2 | C-6 |
| **BIN-P4** | Capability activation + grants for `inventory.location.bin.*` and `inventory.placement.record` | `permissionCatalog.ts`, role grants | **Capability activation** | **Tier 2** | **BIN-P3 and BIN-P6 verified** | **O-5 timing satisfied; grant approval still Owner-only** |
| **BIN-P7** | Cycle Count admits BIN — countable-type policy widened | `cycleCount/cycleCountCommandComposition.ts` policy seam | Governed eligibility policy | **Tier 2** | BIN-P6 + conversion + Cycle Count A5 | O-4 governed change |
| **BIN-P8** | Scan bin → multi-part Cycle Count workflow | `modules/inventory/CycleCounts.jsx`, scan session | UI | Tier 1 | BIN-P7 + Cycle Count A2 | — |

**BIN-P1, P2, P3 and P5 deliver the entire visible half of the requirement — operator-configurable racking and printed labels — before any custody change.**

## 14. Hard gates

| Gate | Requires |
|---|---|
| **A — labels can be mass printed** | BIN-P1 (a label must survive a code correction — G1), **C-1 bay width closed**, C-2 area codes, C-4, C-5. Printing before BIN-P1 means reprinting the wall after the first mislabel |
| **B — locations can be imported/configured** | BIN-P1, BIN-P3, and BIN-P4 activation. Without P4 no operator can create a bin |
| **C — stock can be put away to bins** | Gate B, plus `inventory.placement.record` granted |
| **D — bin-level expected quantity is authoritative** | BIN-P6 merged (roll-up implemented, parentage taught to every consumer) |
| **E — Cycle Count may admit BIN** | Gate D, **plus initial inventory conversion complete for that warehouse**, plus BIN-P7 and Cycle Count A5 |
| **F — multi-part bin scan/count activated** | Gate E, plus Cycle Count A1/A2 |

Not gates, deliberately: symbology (a default, changeable later), visualization (deferred), and RFID (out of scope).

## 15. Tests and verification

- `resolveBin` round-trip: every generated label resolves through the shared scan boundary to exactly one governed bin, by stable identity. Acceptance criterion for BIN-P5.
- Odd-numbering generator: N positions produce `2i-1`; activating `002` later leaves `001`/`003` untouched with unchanged identities.
- BIN-P1 code correction: changing a display code preserves the stable id and all placement history; the previous code remains traceable; a stale label does not silently resolve elsewhere.
- Canonical-code uniqueness within a warehouse; the same code in two warehouses is two bins.
- `WRONG_WAREHOUSE` remains distinct from `NOT_FOUND`.
- BIN-P2 regression: no surface loses data when `stock_locations` is retired; analytics still computes from the ledger.
- BIN-P6: put-away does **not** reduce availability; `WAREHOUSE↔BIN` and `BIN↔BIN` leave the warehouse aggregate unchanged; parentage is asserted on availability, transfer sufficiency **and** cycle-count expected quantity — the three authorities #116 named.
- A test asserting no `binQuantity`-shaped field exists on any record.

## 16. Explicit non-goals

- MFID/RFID.
- A second Location registry, and no separate bin barcode table. The `bins` registry is extended, never replaced.
- A generic Site / facility / real-estate hierarchy.
- Any stored bin balance or `binQuantity` field.
- **Warehouse and floor-map visualization** — no map schema, x/y coordinates, CAD layout, visual editor or floor-plan implementation. Deferred until real photos and layout information exist; structured Area/Aisle/Bay/Bin data from BIN-P1 is sufficient for the authority work.
- Quarantine and inspection — Decision **#117** unchanged.
- Widening client-direct Firestore read or write authority for configuration. `bins` and `bin_placements` stay deny-all.
- Deleting legacy collections in BIN-P0.
- BIN Cycle Count implementation before gate E.

## 17. Non-negotiables

1. **One governed Location/Bin authority.** No second inventory-location system.
2. **One quantity authority.** `inventory_transactions` and the existing serialized authority remain authoritative.
3. **WAREHOUSE remains the custody parent.**
4. **BIN is an authoritative physical position under that warehouse.**
5. **Warehouse aggregate = direct WAREHOUSE balance + child BIN balances.**
6. **`WAREHOUSE ↔ BIN` and `BIN ↔ BIN` inside one warehouse must not change the warehouse aggregate.**
7. **Human-readable bin code is not the stable database identity.**
8. **Historical WAREHOUSE evidence is never rewritten** to fake bin precision that was never known.
9. **Barcode resolves identity; scanning alone never mutates inventory.**
10. **Reserved even bin numbers are not invalid.** Initial generation uses odds; governed future insertion may activate an even value.
11. **No silent renumbering.** Occupied and historical locations retain traceability.
12. **No second bin on-hand field, and no `stock_locations` resurrection.**
13. **Countable location-type policy remains governed**, never an ordinary Admin preference.
14. **BIN Cycle Count cannot activate before BIN quantity is authoritative** — and before the warehouse is converted.
15. **Existing bin capabilities remain inactive** until their operational model is ready.
16. **Visualization is deferred.**

## 18. Open questions

**No Owner architectural decision remains open.** O-1 through O-7 are ruled in Decision #160 and ADR-014.

Remaining questions are client and operational, and **none blocks BIN-P1**:

```
CLIENT
  C-1  Warehouse bay width — one digit or two?  Recommendation: two.
       MUST close before mass label printing (gate A). Does not block the data model:
       BIN-P1 stores structured bay identity so the formatter produces the final
       convention without a second identity migration. Do not hard-code one digit.
  C-2  Final Phoenix Parts Room and Warehouse area codes.
  C-3  Which Areas exist (e.g. Parts Room, Warehouse Storage).
  C-4  Default barcode symbology.
  C-5  Label medium — thermal/ZPL (needs a print bridge) or laser + sheets.
  C-6  Part-to-bin rules: may one part occupy several bins; may one bin hold several parts?
  C-7  Do irregular/deep/oversized positions need recorded attributes?

FUTURE-STAGE GOVERNANCE (not blocking BIN-P1)
  - BIN-P6 ledger vocabulary: may put-away emit TRANSFER_OUT/TRANSFER_IN given
    Transfer's exclusive movement authority, or is a distinct governed type required?
    Specified in BIN-P6 from existing ledger conventions; deliberately not invented in P0.
  - BIN-P4 grant approval: which Roles hold bin.manage, bin.read and placement.record.
    Two least-privilege Roles are already declared for the split.
  - BIN-P7: the governed mechanism by which the countable-type policy is amended.
```

## 19. What blocks implementation

**BIN-P1 is unblocked.** Its scope — stable surrogate bin identity, structured Area/Aisle/Bay/Bin attributes, canonical-code uniqueness within a warehouse, and the code-history posture — is fully determined by rulings O-3, O-7 and the Site/Area posture. No client answer is required: bay width (C-1) is a formatter concern that BIN-P1 must not hard-code.

**BIN-P2, P3 and P5 are unblocked** on architecture. P5 additionally waits on C-1/C-4/C-5 before labels are actually printed (gate A).

**BIN-P6 is unblocked on architecture** and sequenced after P1 and P2; C-6 shapes its rules.

**BIN-P4 waits on P3 and P6** per ruling O-5, and its grants remain an Owner-only approval.

**BIN-P7 and P8 wait on gate E** — bin quantity authoritative *and* the warehouse converted.

**BIN-P1 implementation is not authorized by this pass.** BIN-P1 specification and review is the next gate.
