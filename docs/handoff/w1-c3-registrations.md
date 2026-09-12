# W1-C3 — Warehouse / BIN / stock-location: required shared-file registrations

Lane C3 (Wave 1) owns **Warehouse**, **BIN**, and the legacy **stock location** representation. The
lane may not edit shared files, so every registration this packet needs is recorded here instead.

Migration id used: **`1758240000000`** — `functions/migrations/1758240000000_warehouse-and-bin-location-authority.sql`.

---

## 1. `functions/package.json` — `test:adminPolicyPostgres` (REQUIRED)

Add `test/eosOpsWarehouseBinPostgres.test.mjs` to the serialized Postgres command:

```
"test:adminPolicyPostgres": "npm run build && node --test --test-concurrency=1 test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs test/eosOpsWarehouseBinPostgres.test.mjs test/inventoryCapabilityGrantMigration.test.mjs"
```

**Why it is not already required to pass CI today.** `adminPolicyPostgres.test.mjs`'s *"every suite
that resets the schema is covered by that one command"* finds resetters by scanning test files for a
schema drop. The new suite deliberately **does not reset the schema** — it runs `migrate up`
(a no-op when current) and then clears only migration 008's own three tables — so it neither races
the resetters nor trips that check. It therefore runs correctly today but is **not executed by CI**
until the line above lands. Evidence that it passes is in the PR body (25/25 against PostgreSQL 16).

Also add the pure companion suite to `test:adminPolicy` (no database needed):

```
… test/eosOpsWarehouseBinAuthority.test.mjs
```

## 2. `field-ops-app-vite/src/metadata/entityRegistry.js` — Admin → Objects (REQUESTED, not urgent)

* **`bin` has no entity definition.** `bins` is a live, governed collection with a live callable
  (`createBin` is exported from `functions/src/index.ts:495`), and there is no
  `field-ops-app-vite/src/metadata/definitions/bin.js`, so BIN does not appear in Administration →
  Objects at all. Adding one is a new definition file plus one line in `entityRegistry.js`.
* **`stockLocation` should eventually be removed.** `field-ops-app-vite/src/metadata/definitions/stockLocation.js`
  is registered in `entityRegistry.js:*` and describes a retired duplicate balance authority
  (Decision #160 / ADR-014). This packet removed every remaining *writer* of the collection, but the
  definition file cannot be deleted without editing `entityRegistry.js`. **Do not delete the
  definition file alone** — the registry imports it.
* `warehouse.js`'s header says no code path writes the governed §3A fields. That remains true in
  Firestore. It is no longer the target state: `eos_ops.warehouses` is.

## 3. `functions/src/access/permissionCatalog.ts` — NOT required by this packet

The eos_ops repository is not wired to an HTTP operation or a callable, so it introduces no
capability. For the record, the two capabilities the *Firestore* bin/warehouse writers reference are
still in the state the census found them in:

* `inventory.warehouse.status.set` (`warehouseGovernance/warehouseStatusWriter.ts:29`) —
  **unregistered**, and the writer has **zero importers** outside its own tests.
* `inventory.location.bin.manage` / `inventory.location.bin.read`
  (`inventoryLocation/binCommands.ts:62-63`).

## 4. `firestore.rules` — no change requested

`bins`, `bin_code_claims`, `bin_placements` and `warehouse_bin_conversions` have no match block, so
Firestore denies every client already. `stock_locations`' client read was retired by BIN-P2R. This
packet asks for no rules change and makes no authorization decision in rules.

---

## Deliberately NOT done in this packet (named, not hidden)

* **No production cutover, import, dual-write, freeze or deploy.** Migration 008 stands the schema
  and the repository up; it imports no data. `warehouseBinMigrationSource.ts` is the pure mapping a
  future authorized import would run, and it is exercised only by tests.
* **No `inventory_movements` / `serialized_custody` / `cycle_count_sheets` foreign key on
  `location_id`.** The rule is per-type and the MOBILE arm has no table here (lane C4 owns the
  Truck/MOBILE registry). Two of three arms would read as a whole rule. It is enforced at the
  repository boundary (`resolveOpsLocation`) until MOBILE lands; the migration header states this.
* **`src/ownership/ownershipBackfillRules.ts` still names `stock_locations`.** It is a one-time
  Ownership-v1 *stamping plan over documents that already exist*, with a measured
  `AUTHORIZED_WRITE_CAPS` blast-radius cap of 5. Those five sandbox documents still exist (deleting
  them would be a cutover, which is prohibited here), so the measurement is still true and removing
  the rule would make the plan silently incomplete. It goes when those rows do.
  `test/eosOpsWarehouseBinAuthority.test.mjs` pins this as the **only** remaining reference, by name.
* **Two competing warehouse-eligibility predicates were left alone.** `transferLocationResolver.ts`
  and `receivingLocationResolver.ts` both use `validateGovernedWarehouse` + `status === "ACTIVE"`;
  the raw-`status` readers are client-side view code (`domain/warehousesView.js`). Consolidation is
  hygiene, not a blocker, and it is not what this packet is for.
* **Firestore-emulator suites were not run** (`binConversionReconciliation`, `putAwayCommand`,
  `stockRelocationCommand`, `warehouseGovernanceMigration*`, `warehouseStatusWriter`). No module
  they cover was modified by this packet.
