Issued: 2026-10-17 (America/Phoenix) · base main `c707a32f` · Firebase-exit lane, slice **F2** of the controller-confirmed plan (`D:/eos-lanes/lane-firebase/firebase-exit-slice-plan-2026-10-17.md`)

**Do not merge without the controller's / Owner's exact-head decision.** Lane D reviews after the lane is idle. The controller verifies on nonprod.

## What changes
The Operations dashboard ("Inventory & Supply Overview") Procurement panel stops reading Firestore. Replacing these reads leaves the screen with **no Firebase traffic**.

| Read | Before (Firebase) | After (EOS Core) |
|---|---|---|
| Supplier names | Firestore `suppliers` (`operationsQueries.fetchSuppliers`) | `listSuppliers` (`partsOperationsReads.fetchSupplierList`, `supplier.record.read`), the same read `useSuppliers` already uses |
| Supplier catalog for draft proposals | The whole Firestore `supplier_catalog` (`fetchSupplierCatalog`) | **Each recommended Part's** governed terms: `listPartSupplierItems` through the new `fetchSupplierCatalogForParts` (`inventory.supplierTerms.read`), 4 reads at a time |

### Behaviour, intended and recorded
- **The drafts engine keeps its rule.** It suggests the cheapest **available** supplier when prices are readable in one currency.
- **When cost is withheld.** EOS cost is the COMMERCIAL field group (DECISIONS #210 / #230). For a caller without `inventory.catalog.cost.read`, cost is withheld: the engine then suggests the **preferred** supplier and shows no price estimate. It never invents a price.
- **Availability.** "Available" means status ACTIVE and availability AVAILABLE.
- **Missing parts.** A Part the Catalog doesn't hold contributes no item.
- **Refusals.** Any other refusal fails the catalog and is reported inside the Procurement panel, exactly as before. The other panels never blank.
- **Deleted:** `fetchSuppliers` and `fetchSupplierCatalog`.

### Exit baseline
**Unchanged** (`operationsQueries.ts` keeps two Firestore readers; the next section says why). This slice removes reachable Firebase traffic from a routed screen; the ratchet moves when the last reader in that file leaves.

### Firebase reads deliberately NOT moved (recorded in the retirement ledger)
- **`fetchWarehouses`:** used only by the Warehouse Racking planner. Moves in F6, which needs Owner decisions D1–D10.
- **`fetchInventoryTransactions`:** used only by the Parts shadow-parity diagnostics screen. **Open Owner question:** retire it with Firebase, or keep it as an archived comparison.
- **Inventory Action History** (Part Detail, Warehouse Manager home): Firestore `inventory_actions`.
  - The Owner ruling of 2026-08-30 says "keep existing history readable".
  - Those notes are not ledger movements, so EOS movement history is **not** their replacement.
  - Moving them needs a PostgreSQL archive, which is a migration and a data copy: Owner- and operator-gated.

## Tests
- `operationsProcurementLiveSource.test.jsx` now drives the supplier reads through the EOS transport (refusal per operation) instead of a mocked Firestore. It asserts:
  - the recommended Part's terms are read;
  - no Firestore `suppliers` / `supplier_catalog` read happens.
- New cases cover the mapping (cost string → number; withheld → null; availability; `NOT_FOUND` skipped; other refusals fail) and the engine rule (cheapest when priced; preferred when withheld).
- `operationsCanonicalNames` / `operationsTransferOrders`: their mocks move to the EOS module.

## Verification (local; WSL Ubuntu-24.04 LF clone; bounded workers, one process at a time)
- vitest, the 6 Operations / procurement suites: **43 / 43**.
- `npm test` (the full client manifest): **319 suites passed**.
- Firebase-exit guards: **141 / 141**.
- oxlint: 0 errors, 0 warnings in the touched files. `tsc --noEmit`: OK. Build: OK.

### For the controller's nonprod check
Run Inventory & Supply Overview as a synthetic persona who holds `supplier.record.read` and `inventory.supplierTerms.read`. Expect 0 requests to `firestore.googleapis.com` / `*.cloudfunctions.net` on that screen. Supplier names resolve, and drafts propose a supplier.

No server, migration, Rules, deploy or credential change. Frontend only, so Render does not redeploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
