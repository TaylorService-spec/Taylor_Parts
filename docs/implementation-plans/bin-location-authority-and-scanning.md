---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-09-02
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Implementation Plan: BIN-001 — governed Bin / Location authority and scanning

**Reconciled against:** `origin/main` @ `c54cd21800b424c75a74a85fa38dd2d7788e9a5c`, read directly on 2026-09-02. Every claim below is sourced; nothing is recalled.

**Status of this document:** analysis and planning only. No application code, Firestore Rules, capability, grant, or deployment change was made.

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

The last two links of the client's chain therefore cannot be planned as engineering work. They require revisiting #116, which is an Owner decision about warehouse operations, not an implementation detail. This plan records that contradiction rather than forcing the premise, and sequences everything that can proceed without it.

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

## 5. Gaps

| # | Gap | Severity |
|---|---|---|
| G1 | **Bin identity is derived from the human code.** `deriveBinDocId(warehouseId, code)` = `bin_{warehouseId}__{code}`. Correcting a mislabelled code creates a *different document* and orphans its placement history. This directly contradicts Non-negotiable 5 | **High** |
| G2 | No aisle / bay / area / site structure anywhere. A bin code is one flat string | Medium |
| G3 | No Administration surface to configure warehouses, bins or racking | High |
| G4 | No bin generator (odd-numbering, per-aisle bay counts, per-bay bin counts, individually configurable irregular positions) | Medium |
| G5 | No location label generation, printing or export | Medium |
| G6 | No bin-level quantity authority — **deliberate, see §6** | Blocking for BIN counting |
| G7 | `stock_locations` and the Epic 4 legacy bin/transfer model remain readable and are still described as bin-level quantity | High |
| G8 | Every bin capability is inert and ungranted; no operator can use what exists | High |
| G9 | No location alias or rename history; a code correction leaves no trail | Medium |
| G10 | Warehouse creation has no callable at all (`warehouseStatusWriter` is unexported and inert) | Medium |

## 6. The conflict this plan cannot resolve

**Decision #116 (Owner, 2026-08-20)** — recorded in `docs/DECISIONS.md`, resolving `docs/assessments/inventory-location-registry-2026-08-20.md`:

> **Warehouse = inventory custody authority. Bin = descriptive physical sub-location.** A bin does not become a separate inventory custody location in this phase.
> The load-bearing invariant: putting stock into a bin must not remove it from warehouse on-hand or available.
> … this phase adds **no** hierarchical inventory roll-up, **no** bin-level reservations, **no** second inventory balance authority… `BIN` does not become eligible for warehouse custody calculations.

The decision states its own cost: *"a bin-to-bin move is not an inventory movement under this model, and 'how many are in rack 14' is only as good as the last placement recorded."*

The client requirement — *authoritative `(partId, locationId)` quantity at a bin, so Cycle Count may admit BIN* — **is that cost, and it is now being asked for.** #116 must be revisited before links 5–7 of the client chain can be built.

The assessment already frames the three coherent answers, and they remain the right frame:

| Option | Meaning | Consequence |
|---|---|---|
| **A — roll-up** | A BIN belongs to a warehouse; availability sums the warehouse *and* its bins | Existing math learns a parent-child rule. Stock stays sellable once put away. Registry must be authoritative about parentage |
| **B — descriptive** (ratified as #116) | Placement is recorded separately; `location` stays `WAREHOUSE` | Nothing existing changes. Bin counting and bin-to-bin moves are weaker |
| **C — full custody** | A BIN is a first-class location like a truck | Cleanest model, largest change. Every authority must be taught bins, and all existing ledger history — written at WAREHOUSE level — means something different from new history |

**Claude Code recommendation: Option A.** It is the only option that satisfies the client's chain while preserving the #116 load-bearing invariant — binned stock stays sellable, because availability sums the parent warehouse *and* its bins. Option C satisfies the chain but reinterprets every ledger row ever written, and C's "stock at a bin is not warehouse stock" is exactly what #116 was decided to prevent. Option B is the status quo and cannot deliver bin-level counting at all.

**This is an Owner decision. It is not made here, and nothing downstream of it is planned as though it were.**

## 7. Decisions required

### Owner decisions

| Ref | Decision | Recommendation |
|---|---|---|
| **O-1** | Revisit #116: keep **B**, or adopt **A** or **C**? | **A** — see §6. Blocks G6, BIN-P5/P6/P7 |
| **O-2** | Under A: how is pre-existing WAREHOUSE-level ledger history interpreted once bins carry stock? | Treat all existing rows as "at the warehouse, bin unknown"; never backfill a bin onto historical evidence |
| **O-3** | Bin identity: introduce a **stable surrogate `binId`** with `code` as a mutable attribute, or keep the code-derived id and declare codes immutable? | **Surrogate id.** Non-negotiable 5 and G1 require it; immutable codes make a mislabel permanent |
| **O-4** | Is the countable-location-type policy Administration data or governed? | **Governed**, consistent with Cycle Count ruling D0(ii). Configuring racking is operating data; deciding a type may hold custody is integrity policy |
| **O-5** | Activate and grant `inventory.location.bin.*` and `inventory.placement.record`, and to which Roles? | Two Roles are already declared for exactly this split; activation is the separate rollout step #119 anticipates |
| **O-6** | Retire `stock_locations` and the Epic 4 legacy model, or leave them? | **Retire.** G7 is a live trap; leaving a second "bin-level quantity" readable while building a real one invites exactly the divergence already measured |
| **O-7** | Is bin identity unique per warehouse (today) or per operating company? | Per warehouse — current derived id already assumes it, and racking is labelled per building |

### Client decisions (cannot be resolved from the repository)

| Ref | Decision |
|---|---|
| **C-1** | Warehouse bay width — one digit or two? The warehouse document says one; the floor-walk document shows aisles exceeding 9 bays. **Recommendation: two digits**, which the existing code pattern already accepts and which removes the contradiction permanently |
| **C-2** | Final Phoenix Parts Room and Warehouse area codes |
| **C-3** | Whether Site and Area are recorded as data, or Site is simply the warehouse and Area is a bin attribute. **Recommendation: warehouse = Site; Area/Aisle/Bay as structured attributes on the bin record** — nothing rolls up through them, so separate registries would be unused structure |
| **C-4** | Barcode symbology default (informs a default; does not define the data model) |
| **C-5** | Physical label medium — thermal/ZPL, which needs a print bridge, or laser plus label sheets, which needs nothing beyond an HTML print view |
| **C-6** | Part-to-bin business rules where not already governed — e.g. may one part occupy several bins, may one bin hold several parts |
| **C-7** | Whether irregular / deep / oversized positions need a recorded attribute (capacity, depth, oversize flag) or only individual creation |

## 8. Target authority model

Classified against what exists:

| Target concept | Status | Note |
|---|---|---|
| stable `locationId` | **EXISTS — extend minimally** | Warehouse and mobile ids are stable. Bin id is code-derived (G1) and needs O-3 |
| company / tenant scope | **EXISTS — reuse unchanged** | `operatingCompanyId` on the warehouse; bins derive from `warehouseId` |
| site | **EXISTS — reuse unchanged** | The warehouse is the site (pending C-3) |
| area | **MISSING — optional** | Recommend a bin attribute, not a registry |
| aisle | **MISSING — required** | Structured attribute on the bin record |
| bay | **MISSING — required** | Structured attribute on the bin record |
| bin | **EXISTS — reuse unchanged** | `bins` registry; `A01-001` already matches the code pattern |
| `displayCode` | **EXISTS — reuse unchanged** | `code` (normalized) plus `originalCode` (as typed, for reprinting) |
| status | **EXISTS — reuse unchanged** | `ACTIVE`/`INACTIVE`, retire-never-delete |
| barcode / scan identity | **EXISTS — extend minimally** | `INVENTORY_LOCATION` is already scannable; `resolveBin` already resolves a scanned code. No separate bin barcode table is required |
| audit / provenance | **EXISTS — reuse unchanged** | Governed command + audit event pattern |
| bin-level quantity | **CONFLICT — requires O-1** | See §6 |
| rename / alias history | **MISSING — required if O-3 chooses a surrogate id** | |

## 9. Barcode and scanning relationship

The required invariant is already achievable with what exists:

```
printed location identity (A01-001)
  -> barcode representation
  -> shared scan identity boundary (scannedIdentity.js, INVENTORY_LOCATION)
  -> resolveBin(code, expectedWarehouseId, stored)
  -> exactly one governed bin document
```

**No separate bin barcode table is recommended, and current authority does not require one.** Duplicate prevention is structural: the bin document id derives from `(warehouseId, code)`, so two identical codes in one warehouse are one document. That is the same discipline `part_aliases` uses.

Two consequences to hold:

- **A scan resolves identity and context. It never moves inventory.** `PutAwayScan.jsx` already obeys this — the scan resolves a bin, and a separate governed command records the placement.
- If O-3 adopts a surrogate `binId`, the printed code becomes a *lookup key* rather than the identity, and the resolver gains one indirection. That is the change that makes a label survive a code correction.

## 10. Inventory movement relationship

Under **B** (today): put-away writes `bin_placements`; the ledger is untouched; `(partId, warehouseId)` remains the finest authoritative granularity.

Under **A** (if O-1 adopts it): a movement may carry `location.type === "BIN"`, which the ledger schema already permits. Every derivation — `cycleCountExpectedQuantity.ts`, `fulfillmentAvailability.ts`, transfer sufficiency — must learn that a bin rolls up to its parent warehouse, and the bin registry becomes authoritative about parentage. Put-away becomes a real movement (`TRANSFER_OUT` at the warehouse, `TRANSFER_IN` at the bin, or a dedicated pair), and `bin_placements` is either retired or demoted to history.

**Non-negotiable in either case: no `binQuantity` field, ever.** Bin-level quantity is derived from ledger evidence or it does not exist. G7 is the cautionary example already in the repository.

## 11. Cycle Count dependency

The approved Cycle Count plan and A1 specification are compatible with this program **without migration**:

- The A1 sheet stores a **governed location reference only**, and A1 explicitly moves the `WAREHOUSE`/`MOBILE` fence out of shape validation into command-time eligibility policy (ruling D0(ii)).
- Admitting `BIN` is therefore a policy and validation change plus a capability decision — **not a Cycle Count schema migration.** Confirmed against `docs/specifications/cycle-count-multi-part-sheet.md` §"D0 — Location authority and eligibility policy".
- Cycle Count's expected quantity must continue to come from the ledger and the serialized asset registry. **Cycle Count must never create a bin quantity.** If the ledger cannot answer `(partId, binLocationId)`, BIN is not countable — Cycle Count does not solve location authority.

**BIN eligibility must not be recommended until O-1 is ruled and bin-level ledger truth exists.**

## 12. Initial inventory conversion dependency

Bins are useless until stock is actually located in them, and that is an operational programme, not a PR:

- Under **B**, conversion means recording a placement for existing stock — no ledger effect, and a partially converted warehouse is harmless.
- Under **A**, conversion means moving warehouse-level balances into bins as governed movements. A partially converted warehouse is then **half-binned**, and any bin-level count during that window is meaningless. Conversion completion is therefore a hard gate on BIN counting (see §14, gate D).

Either way, existing ledger history stays at WAREHOUSE level and must never be backfilled with a bin (O-2).

## 13. PR sequence

Fewer, larger PRs where a split would leave a non-working or unsafe intermediate state. No unrelated authority changes are combined.

| # | PR | Surfaces | Authority | Tier | Depends on | Deploy | Tests | Owner decision |
|---|---|---|---|---|---|---|---|---|
| **BIN-P0** | Custody-model ruling — record #116 revisit as a Decision + ADR | `docs/DECISIONS.md`, ADR | None (governance) | Tier 2 | — | none | none | **O-1, O-2 — required** |
| **BIN-P1** | Bin identity stability: surrogate `binId`, `code` as mutable attribute, rename history; structured `area`/`aisle`/`bay` attributes | `inventoryLocation/binRegistry.ts`, `binCommands.ts`, `binCallables.ts` | Bin registry | Tier 1 | O-3, C-3 | none | focused | **O-3, C-1, C-3** |
| **BIN-P2** | Retire the legacy on-hand and Epic 4 bin model | `types/warehouse.ts`, `warehouseService.ts`, `warehouseReconciliationService.ts`, `inventoryAnalyticsCallables.ts`, `permissionCatalog.ts` description | Removes a competing on-hand shape | Tier 2 (touches a permission description and an analytics read) | — | none | regression on analytics | **O-6** |
| **BIN-P3** | Administration racking configuration: list/create/deactivate/reactivate over existing callables, plus the odd-numbering generator with per-aisle bay and per-bay bin counts and individually configurable irregular positions | `modules/administration/*`, `services/binCommandClient.js` | UI over existing commands; **no new write authority** | Tier 1 | BIN-P1 | none | focused + UI | C-2, C-7 |
| **BIN-P4** | Activation and grants for `inventory.location.bin.manage` / `.read` / `inventory.placement.record` | `permissionCatalog.ts`, role grants | **Capability activation** | **Tier 2** | BIN-P3 verified | env activation | grant tests | **O-5 — required** |
| **BIN-P5** | Location label generation and export: `bwip-js`, HTML print view, Administration symbology configuration | new `modules/administration/*` | None new | Tier 1 | BIN-P1 | none | round-trip through `resolveBin` | C-4, C-5 |
| **BIN-P6** | Bin-level custody: ledger writers emit `BIN`; availability, transfer sufficiency and cycle-count expected quantity learn parentage | `inventoryLedger/*`, `fulfillment/*`, `inventoryTransfer/*`, `cycleCount/cycleCountExpectedQuantity.ts`, `putAwayCommand.ts` | **Changes what every existing quantity means** | **Tier 2** | **BIN-P0 = A or C** | none | heavy | **O-1, O-2** |
| **BIN-P7** | Cycle Count BIN eligibility — countable-type policy widened | `cycleCount/cycleCountCommandComposition.ts` policy seam | Eligibility policy | **Tier 2** | BIN-P6 + conversion complete + Cycle Count A5 | none | focused | **O-4** |
| **BIN-P8** | Multi-scan bin cycle count UX | `modules/inventory/CycleCounts.jsx`, scan session | UI | Tier 1 | BIN-P7 + Cycle Count A2 | none | UI | — |

**BIN-P1, P2, P3 and P5 do not depend on O-1** and can proceed while the custody decision is open. **BIN-P6, P7 and P8 are entirely gated on it.**

## 14. Hard gates

| Gate | Requires |
|---|---|
| **A — labels can be mass printed** | BIN-P1 (a label must survive a code correction — G1), C-1 bay width, C-2 area codes, C-4/C-5. **Printing before O-3 means reprinting every label after the first mislabel** |
| **B — locations can be imported/configured** | BIN-P1, BIN-P3, and BIN-P4 activation. Without P4 no operator can create a bin at all |
| **C — stock can be put away to bins** | Gate B, plus `inventory.placement.record` granted. Available under B today once activated |
| **D — bin-level expected quantity is authoritative** | **O-1 ruled A or C**, BIN-P6 merged, **and initial inventory conversion complete for that warehouse**. A half-binned warehouse cannot answer bin-level expected quantity |
| **E — Cycle Count may admit BIN** | Gate D, plus BIN-P7 and Cycle Count A5 activation |
| **F — multi-part bin scan/count activated** | Gate E, plus Cycle Count A1/A2 |

Not gates, deliberately: symbology (a default, changeable later), area codes for anything but printing, and RFID (out of scope).

## 15. Tests and verification

- `resolveBin` round-trip: every generated label resolves through the shared scan boundary to exactly one governed bin. This is the acceptance criterion for BIN-P5, not a nicety.
- Odd-numbering generator: N positions produce `2i-1`; activating `002` later leaves `001`/`003` untouched, with unchanged identities.
- Code correction under BIN-P1: changing a display code preserves `binId` and all placement history.
- `WRONG_WAREHOUSE` remains distinct from `NOT_FOUND`.
- BIN-P2 regression: no surface loses data when `stock_locations` is retired; analytics still computes.
- BIN-P6 (if reached): put-away no longer removes stock from availability; parent roll-up is asserted on availability, transfer sufficiency **and** cycle-count expected quantity — the three authorities #116 named.
- A test asserting no `binQuantity`-shaped field exists on any record.

## 16. Explicit non-goals

- MFID/RFID.
- A second Location registry. The `bins` registry is extended, never replaced.
- A separate bin barcode table.
- Any stored bin balance or `binQuantity` field.
- Quarantine and inspection — excluded by **Decision #117** and unchanged here.
- Widening client-direct Firestore read or write authority for configuration. `bins` and `bin_placements` stay deny-all; configuration goes through callables.
- BIN Cycle Count implementation in this program's early phases.
- Re-deciding #116 inside a PR. It is decided by the Owner or it is not decided.

## 17. Non-negotiables

1. **One Location authority.** Extend `bins`, `warehouses` and `mobile_locations`. Never a parallel registry.
2. **One on-hand authority.** Bin-level quantity is derived from ledger evidence or it does not exist. No `binQuantity`, ever — G7 is the measured example of what a second balance does.
3. **Barcode is identification, not inventory mutation.** A scan resolves identity and context; a governed command moves stock.
4. **Movement establishes custody.** Bin-level quantity becomes authoritative through governed movement evidence, never through UI assignment or a placement record promoted to a balance.
5. **Human code is not the database id.** `A01-003` identifies and displays; stable internal identity must survive a legitimate display correction. **The current implementation violates this (G1) and BIN-P1 exists to fix it.**
6. **Reserved even numbers are not invalid.** Initial generation uses odds; a governed later activation may use an even value.
7. **No silent renumbering.** Occupied and historical locations retain traceability; a code correction leaves a trail.
8. **No client-direct authority expansion** to satisfy a configuration UI.
9. **Cycle Count does not solve location authority.** BIN becomes countable only after bin-level inventory truth exists.
10. **No MFID/RFID.**

## 18. Questions requiring Owner or client input

Consolidated from §7. **O-1 and O-3 block the most work.**

```
OWNER
  O-1  Revisit Decision #116 — keep B (descriptive), or adopt A (roll-up) or C (full custody)?
       Recommendation: A.  Blocks BIN-P6/P7/P8 and gates D/E/F.
  O-2  Under A or C, how is existing WAREHOUSE-level ledger history interpreted?
       Recommendation: "at the warehouse, bin unknown"; never backfilled.
  O-3  Stable surrogate binId with mutable code, or immutable codes?
       Recommendation: surrogate.  Blocks BIN-P1, and gate A (label printing).
  O-4  Countable-location-type policy — governed, or Administration data?
       Recommendation: governed, consistent with Cycle Count D0(ii).
  O-5  Activate and grant inventory.location.bin.* and inventory.placement.record — to which Roles?
       Two Roles are already declared for the split.  Blocks gate B.
  O-6  Retire stock_locations and the Epic 4 legacy bin/transfer model?
       Recommendation: retire.
  O-7  Bin identity unique per warehouse, or per operating company?
       Recommendation: per warehouse (current derived id already assumes it).

CLIENT
  C-1  Warehouse bay width: one digit or two?  Recommendation: two — the existing code
       pattern already accepts it and it removes the document contradiction permanently.
  C-2  Final Phoenix Parts Room and Warehouse area codes.
  C-3  Are Site and Area recorded as data, or is Site the warehouse and Area a bin attribute?
       Recommendation: warehouse = Site; Area/Aisle/Bay as bin attributes.
  C-4  Default barcode symbology.
  C-5  Label medium — thermal/ZPL (needs a print bridge) or laser + sheets (needs nothing).
  C-6  Part-to-bin rules: may one part occupy several bins; may one bin hold several parts?
  C-7  Do irregular/deep/oversized positions need recorded attributes, or only individual creation?
```

## 19. What blocks implementation

**Nothing blocks BIN-P1, BIN-P2, BIN-P3 or BIN-P5** once O-3, O-6 and C-1/C-3 are answered. These deliver operator-configurable racking, retire the legacy trap, and produce labels — the whole visible half of the client's requirement — under Option B, without touching custody.

**BIN-P4 is blocked on O-5** (capability activation and grants — Tier 2, and per Decision #119 a separate rollout action).

**BIN-P6, BIN-P7 and BIN-P8 are blocked on O-1.** They cannot be specified, let alone implemented, while #116 stands as ratified. That is the single decision that determines whether the client's full chain is buildable, and it belongs to the Owner.
