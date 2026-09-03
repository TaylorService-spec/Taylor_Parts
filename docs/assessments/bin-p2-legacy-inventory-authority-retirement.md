---
artifact_type: assessment
gate: Assessment
status: Final
date: 2026-09-03
owner: Claude Code
related_adrs: ["ADR-014"]
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# BIN-P2 — retiring the legacy `stock_locations` / Epic-4 inventory authority

**Measured against** `origin/main` @ `7bcdb4468a3f68101b79926f3c6d735c69b45710`, which includes the BIN-P1 merge `5d73c5d3`. Authority: **Decision #160 / ADR-014** (`census → replace required readers → prove no required dependency → retire`).

## Why

`stock_locations` was a per-warehouse, per-part, per-`binCode` quantity row. **Nothing in this repository has ever written it** — it was a seeded legacy projection — and where it *had* been seeded it diverged from the ledger in **both directions**: `PRT-1001` held three genuinely received units while the row said 0 (a real order was BACKORDERED), and `PRT-1005` said 40 with nothing ever received (36 units committed that do not exist). A source that can both refuse real stock and promise imaginary stock is not an authority.

Sales-Order allocation was moved off it on 2026-08-17. `getInventoryAnalytics` was the last runtime backend reader.

## Repository census

| Surface | Reads | Writes | Runtime-reachable | Disposition |
|---|---|---|---|---|
| `inventoryAnalyticsCallables.ts` | `stock_locations` | — | **YES** — exported as `getInventoryAnalytics` | **REPLACE** |
| `warehouseService.ts` | `stock_locations` | `stock_locations`, Epic-4 `transfer_orders` | no importer in `functions/src` | **DELETE** |
| `warehouseReconciliationService.ts` | `StockLocation[]` (pure) | — | no importer | **DELETE** |
| `warehouseAnalyticsBridge.ts` | `StockLocation[]` (pure) | — | no importer | **DELETE** |
| `types/warehouse.ts` | `StockLocation`, Epic-4 `TransferOrder`, `WarehouseDiscrepancy`, `DiscrepancySeverity`, `Warehouse` | — | zero importers after the deletions above | **DELETE those types only** |
| `types/warehouse.ts` `GovernedWarehouse` / `WAREHOUSE_STATUSES` / `WAREHOUSE_PROVENANCES` | — | — | **live** — governance validator, migration, status writer | **KEEP** |
| `constants/collections.ts` `STOCK_LOCATIONS_COLLECTION` | — | — | zero references after the above | **DELETE** |
| `constants/collections.ts` `TRANSFER_ORDERS_COLLECTION` | — | — | **live** — the modern Transfer repository | **KEEP** |
| `functions/src/inventoryTransfer/*` | `transfer_orders` | `transfer_orders` | **live governed authority** | **KEEP — untouched** |
| `permissionCatalog.ts` (both copies) | — | — | describes `stock_locations` as bin-level quantity truth | **DOC-CORRECT** |
| `firestore.rules` (both copies) | active `stock_locations` read rule | writes already denied | — | **BLOCKED** — separate Tier-2 gate (Stage 10) |
| `field-ops-app-vite` `fetchStockLocations` → `Operations.jsx` → `WarehousePanel.jsx` | `stock_locations` (client-direct) | — | **YES** | **BLOCKED** — see *What remains* |
| `functions/scripts/**` seeds, `fixtures/*` | write `stock_locations` | — | seed/fixture tooling, not runtime | **KEEP for now** — they seed a collection nothing reads |
| ownership matrix / backfill rules | classify `stock_locations` | — | ownership tooling | **KEEP** — already records it as a balance row, not a place |

**Transfer classification.** Every `transfer_orders` reference in `functions/src/inventoryTransfer/*` is the **modern governed** authority and was not touched. The only Epic-4 transfer writer was `warehouseService.ts`'s `createTransferOrder`/`completeTransferOrder`, which moved `StockLocation` quantities between bin codes; it had no runtime importer and is deleted.

## Environment census — read-only, 2026-09-03T00:27:03Z

| Environment | Project | `stock_locations` | `transfer_orders` total | modern | legacy Epic-4 | unknown |
|---|---|---|---|---|---|---|
| Sandbox | `eos-platform-sandbox` | **5** | **47** | **47** | 0 | 0 |
| Production | `taylor-parts` | **4** | **1** | **0** | 0 | **1** |

Field-masked reads over the Firestore REST API with the operator's existing `gcloud` login. No `nextPageToken` on any listing, so counts are complete. **Nothing was mutated.**

**The one production `transfer_orders` record.** Field names only: `createdAt, fromWarehouseId, id, partId, quantity, status, toWarehouseId, updatedAt`. That is the **Epic-4 family shape minus `fromBinCode`/`toBinCode`** — it carries none of the modern contract (`schemaVersion`, `fingerprint`, `origin`, `destination`, `idempotencyKey`, `version`).

**It does not block this retirement**, and the reasoning is worth stating rather than assuming:

- the deleted `completeTransferOrder` read `fromBinCode`/`toBinCode`, which this record **does not have** — the code being removed could never have processed it;
- the modern Transfer deserializer already fails closed on it today, and this change does not alter that;
- nothing else reads `transfer_orders` in a way the deletions affect.

It is recorded here as a **pre-existing finding**: production holds one transfer record that neither authority can read. It was not deleted, rewritten, or otherwise touched, and its disposition is a separate maintenance question.

## Analytics replacement

| | Before | After |
|---|---|---|
| Physical baseline | `sum(stock_locations.quantity)` per part | **NONE-tracked:** `sumLedgerEligibleOnHand` over `inventory_transactions` at `status == ACTIVE` warehouses — the same function Sales-Order allocation already uses |
| | | **SERIAL-tracked:** `serialized_assets` units that are `AVAILABLE` at an eligible warehouse — the same rule Cycle Count's expected-serial snapshot uses |
| Reservations | `− (RESERVED − RELEASED)` | **unchanged**, applied exactly once. `RESERVED`/`RELEASED` are logical commitment events and are deliberately absent from the physical sum, so nothing double-counts |
| Unknown | part absent from `stock_locations` → omitted | part with no physical evidence → **omitted**. Absence still expresses UNKNOWN; a 0 is never fabricated |
| Response contract | `{ health: [...] }` | **unchanged**, including the `Infinity → null` wire encoding |
| Fallback to `stock_locations` | — | **NONE** |

Movement semantics are inherited, not reimplemented: `RECEIVED`/`RETURNED`/`TRANSFER_IN` add, `TRANSFER_OUT`/`SCRAPPED` subtract, `ADJUSTED` is signed, `COUNTED` is excluded, non-`WAREHOUSE` locations are excluded, and a row without location attribution cannot inflate anything.

One implementation note: the baseline is computed from the **raw** ledger docs, not the normalized ones. `normalizeLedgerTransactions` drops `location` and `trackingMode` — exactly the two facts the warehouse fence and the serial exclusion depend on.

## Post-retirement proof

| Claim | Result |
|---|---|
| `STOCK_LOCATIONS_COLLECTION` runtime references in `functions/src` | **0** (one comment recording the removal) |
| `stock_locations` collection access in `functions/src` | **0** |
| Legacy Epic-4 `transfer_orders` writers | **0** |
| `functions/src/inventoryTransfer/*` | intact, 10 files, untouched |
| `TRANSFER_ORDERS_COLLECTION` | present |
| `WAREHOUSES_COLLECTION` | present |
| `GovernedWarehouse` authority | intact |
| New quantity/balance collection introduced | **none** |
| `firestore.rules` (both copies) | **0 lines changed** |
| Capability ids added or removed | **0** |
| Grants / activation changed | none |
| BIN custody or Cycle Count BIN eligibility | unchanged |
| Deployment | **none** |

## Firestore Rules — the remaining blocker

Both copies still carry an **active** block:

```
match /stock_locations/{stockLocationId} {
  allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(resource.data.warehouseId);
  allow create, update, delete: if false;
}
```

Writes are already denied. The **read** arm is what still admits a client-direct read, and Stage 10 of this task explicitly forbids changing it here: altering read authority is its own governance gate. **This is the only thing standing between BIN-P2 and a structural "zero readers" guarantee**, rather than a conventional one.

## What remains, and why it is not done here

**The client-direct read is still live.** `field-ops-app-vite/src/services/operationsQueries.ts` exposes `fetchStockLocations()`, consumed by `Operations.jsx` and rendered by `WarehousePanel.jsx` as a bin-stock table plus a reconciliation section, using `domain/warehouseReconciliationEngine.ts`.

It was left in place deliberately, and the reason is the Rules block above: the client read exists *because* that rule admits it, and removing the reader while the rule stands leaves the authority half-retired either way. Retiring both together under the one Tier-2 Rules gate is the coherent unit.

Two facts make leaving it temporarily safe, and one makes it urgent:

- the reconciliation guard **already fires on every live call** — the panel renders `CANNOT_EVALUATE`, not a clean bill of health (the M15 honesty fix). It is not producing a competing *quantity* answer;
- writes were already denied, so nothing can grow;
- **but the panel still renders bin quantities from a retired authority**, and in production those are 4 rows nothing has ever written. That is the visible half of the same defect, and it should not survive long.

**Do not feed that engine an empty array as a shortcut.** With `warehouseStock = []` the M15 guard stops firing and the panel would render "No discrepancies" — a clean result for a check that never ran, which is precisely the defect M15 exists to prevent. The surface must be removed, not emptied.

## Environment data posture

`stock_locations` documents remain: **5 in sandbox, 4 in production**. After this change they are:

- **zero active backend readers**, zero writers anywhere;
- still readable by an admin/dispatcher client until the Rules gate closes;
- **inert legacy data**.

They were **not deleted**. Nor was any `transfer_orders` row — the modern authority shares that collection name and is live. Data disposition is a separate, explicitly authorized maintenance action.

## Test evidence

| Suite | Result |
|---|---|
| `inventoryAnalyticsCallables.test.mjs` (emulator) | **6/6** — rewritten for the ledger baseline, plus new coverage for every movement type, `COUNTED` non-compounding, non-`WAREHOUSE` exclusion, malformed rows, `INACTIVE` warehouses, SERIAL via the asset registry, and a behavioural proof that a part known only to `stock_locations` does not appear |
| `transferOrderCommand.test.mjs` (emulator) | pass — modern Transfer unaffected |
| `governedWarehouseValidation.test.mjs` | pass — governed Warehouse authority intact |
| `warehouseProcurementSupplierServices.test.mjs` (emulator) | 5/5 — the deleted `updateStockLocation` case removed with its writer; procurement/supplier coverage retained |
| `governedBusinessRoles` + `semanticMappingGuards` | pass |
| `functions` `tsc` build | clean |


---

# BIN-P2R — closure: the client reader and the Rules read arm

**The section above stands as written.** BIN-P2 genuinely stopped with a client-direct reader and an active Rules read arm still in place, and that was the honest state at the time. BIN-P2R closed both. The order matters and is preserved rather than rewritten.

## What was still live after BIN-P2

| Surface | Kind |
|---|---|
| `operationsQueries.ts` → `fetchStockLocations()` | **runtime client reader** (client-direct Firestore) |
| `Operations.jsx` | UI composition: fed the reader into reconciliation and an omitted-parts count |
| `WarehousePanel.jsx` | operator UI: bin-stock table + Reconciliation section |
| `InventoryHealthPanel.jsx` | `omittedBinStockCount` disclosure, counted from `stock_locations` |
| `domain/warehouseReconciliationEngine.ts` | pure obsolete engine |
| `firestore.rules` ×2 | **active read grant** (`isAdminOrDispatcher()` OR `isAssignedToWarehouse(...)`); writes already denied |
| backend | already zero readers, zero writers |

## Retired

- **`fetchStockLocations`, `RawStockLocation` and the collection constant** deleted from `operationsQueries.ts`.
- **`Operations.jsx`**: the fetch, the `detectStockDiscrepancies` / `generateReconciliationReport` composition, `stockLocations`, `reconciliationReport`, `omittedBinStockCount`, and the now-unused `consumedTransactions` all removed.
- **`WarehousePanel.jsx`**: the bin-stock table and the entire Reconciliation section removed. The **Transfer Orders** table — a read-only view of the *current* governed transfer authority — is untouched, and `resolveName` is retained because that table uses it.
- **`InventoryHealthPanel.jsx`**: the omitted-bin-stock disclosure removed. It counted parts present in `stock_locations` but absent from the ledger; with the collection retired there is no such set, and asserting one would be fiction.
- **`domain/warehouseReconciliationEngine.ts`** and its test deleted; the dead `suites.json` entry removed.
- **Firestore Rules**: the `stock_locations` match block removed from **both** governed copies. No block means **deny-all**, the same posture `bins`, `bin_code_claims` and `bin_placements` already use. The diff is authority-narrowing only — `warehouses` and `transfer_orders` are untouched.
- **Doc drift**: the `warehouse.stockLocation.read` catalog description (both copies) no longer claims the Rules block still exists; `metadata/definitions/stockLocation.js` now records READ PATH: NONE; and `legacyAuthorizationSurface` — a *measured* inventory of legacy Rules sites — dropped its `stock_locations` row and was regenerated through `scripts/syncAccessContracts.mjs`.

## The false-clean, deliberately made unreachable

`reconciliationHonestyM15.test.jsx` is superseded by **`stockLocationSurfaceRetired.test.jsx`**, which inverts it: the panel must now render **neither** verdict.

This matters because the shortcut was dangerous. The M15 scope guard only fires when bin stock is **present**, so keeping the component and passing `warehouseStock: []` would have flipped the panel from an honest `CANNOT_EVALUATE` to **"No discrepancies"** — a clean bill of health for a comparison nobody performed, which is worse than the defect M15 fixed. One test therefore renders the panel *with* the old props still attached and proves they are ignored: the false-clean is unreachable **by shape**, not by discipline.

## Post-closure proof

| Claim | Result |
|---|---|
| Backend runtime `stock_locations` readers | **0** |
| Client runtime `stock_locations` readers | **0** |
| Runtime writers, anywhere | **0** |
| `match /stock_locations/` in either Rules copy | **0** |
| Client imports of `warehouseReconciliationEngine` | **0** (one stale comment in `operationsIntelligenceService.ts`) |
| Active `StockLocation` UI consumers | **0** |
| `warehouses` / `transfer_orders` Rules | **unchanged** |
| `functions/src/inventoryTransfer/*` | 10 files, untouched |
| `TRANSFER_ORDERS_COLLECTION`, `WAREHOUSES_COLLECTION`, `GovernedWarehouse` | intact |
| BIN-P1 (`functions/src/inventoryLocation/*`) | 5 files, untouched |
| New capability / grant / activation | **none** |
| Deployment | **none** |

Remaining textual hits are historical or descriptive: the metadata definition of an inert collection, catalog history, seed/fixture tooling, and append-only decision records. **Current and runtime are zero; historical documentation may remain.**

## Tests

| Suite | Result |
|---|---|
| `stockLocationSurfaceRetired.test.jsx` (new) | **10/10** |
| `operationsTransferOrders` · `operationsPanelsNames` · `operationsCanonicalNames` · `operationsProcurementLiveSource` · `warehouseOfflineBindings` | **36/36 total** |
| `metadataStockLocationDefinition` | 10/10 |
| `legacyAuthorizationSurface` (contract + drift) | 7/7 |
| `functions` `tsc` build · Vite build | clean |

**One test updated but not run locally.** `functions/test/warehouseManagerScopedAccessRules.test.js` had its assertions **inverted** — admin, dispatcher and an assigned warehouse manager are now all expected to be **denied** `stock_locations`, while its `warehouses` / `transfer_orders` cases are unchanged. It requires the Firestore **and Auth** emulators together, and in this environment it hangs before emitting any output; that is a local harness failure, not evidence about the Rules. The static and behavioural proofs above stand on their own — an absent match block is deny-all — and CI is the verifier for the persona-level run.

## Environment data

Unchanged and **not mutated**: 5 `stock_locations` in sandbox, 4 in production. After P2R they have zero readers, zero writers, and **no client access path at all**. Inert legacy data pending an optional, separately authorized maintenance disposition. The one unreadable legacy production `transfer_orders` record was **not touched**.

## Deployment

**None, and deliberately so.** The repository now removes both the client dependency and the permission in one change. When deployment is authorized it must be **coordinated**: a Hosting bundle that still expected the old read must never be live against Rules that deny it. That sequencing decision belongs to the release gate, not here.

## Next gate

**BIN-P3 — Administration racking configuration and generator.**

One carried-forward item, not blocking P3: **environment data disposition** — 9 inert `stock_locations` documents and one unreadable legacy `transfer_orders` record in production.
