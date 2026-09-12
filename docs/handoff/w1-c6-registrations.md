# W1-C6 — Supplier / Manufacturer / Supplier Catalog Item: required registrations & deltas

**Branch:** `impl/w1-supplier-manufacturer` · **Migration:** `functions/migrations/1758499200000_supplier-and-supplier-catalog-authority.sql` (migration 008)

This lane was not permitted to edit a set of shared files that ten concurrent lanes also touch.
Everything below is a change this work **needs** but **did not make**. Each is stated precisely
enough to be applied without re-deriving it.

---

## 1. `functions/package.json` — register the new PostgreSQL suite (REQUIRED)

`functions/test/supplierCatalogPostgres.test.mjs` needs `POLICY_TEST_DATABASE_URL` and must run
serialized with the other PostgreSQL suites, because they share one database.

Add it to the existing `test:adminPolicyPostgres` script:

```
"test:adminPolicyPostgres": "npm run build && node --test --test-concurrency=1 test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs test/inventoryCapabilityGrantMigration.test.mjs test/supplierCatalogPostgres.test.mjs"
```

**Why it is not already enforced.** `adminPolicyPostgres.test.mjs`'s "every suite that resets the
schema is covered by that one command" test only catches suites containing `DROP SCHEMA`. This
suite deliberately does **not** reset the schema — it migrates forward (idempotent) and empties only
its own two tables for its own two tenant ids — precisely so that it cannot race the registered
suites while it is unregistered. That is a safe interim state, not a correct final one: register it.

Also add the offline suite to `test:adminPolicy` (no database needed):

```
... test/legacyInventoryMovementMapping.test.mjs test/supplierCatalogAuthority.test.mjs"
```

## 2. `.github/workflows/**` — CI path trigger (REQUIRED)

`.github/workflows/eos-admin-policy-tests.yml` already triggers on `functions/migrations/**`, so
migration 008 is covered. Once (1) lands, the new suites run inside the existing jobs and no new
workflow file is needed. **Do not add a new workflow for this lane.**

## 3. `docs/architecture/firebase-exit-baseline.json` — the retirement this lane could not make

Two duplicate Firebase business authorities over this lane's own subject matter are **dead or
near-dead** and should be deleted. Deleting them changes the baseline (a baselined path that no
longer imports Firebase is a `staleEntry`, which fails the guard), and this lane may not edit it.

### 3a. `functions/src/supplierService.ts` — delete (duplicate Supplier authority)

It reads the **same `suppliers` collection** through a second, incompatible shape
(`functions/src/types/procurement.ts`'s `Supplier`: `contactEmail`, `leadTimeDays`) that contradicts
the governed `GovernedSupplier` (`email`; no lead time — lead time belongs to a catalog item).

Proven dead: nothing in `functions/src` imports it, it is not exported from `functions/src/index.ts`,
and the only importer in the repository is `functions/test/warehouseProcurementSupplierServices.test.mjs`.

Delta:
- delete `functions/src/supplierService.ts`
- remove the line `"functions/src/supplierService.ts"` from the
  `server.firebase_admin_firestore` list in `docs/architecture/firebase-exit-baseline.json`
  (a removal — the ratchet permits the baseline to shrink)
- delete or rewrite `functions/test/warehouseProcurementSupplierServices.test.mjs`
- drop the now-unused `Supplier` / `SupplierCatalogItem` interfaces from
  `functions/src/types/procurement.ts` if nothing else uses them

### 3b. `supplier_catalog` — retire (duplicate Supplier Catalog Item authority)

`SUPPLIER_CATALOG_COLLECTION` (`functions/src/constants/collections.ts:41`) is a second
representation of the same business fact as the governed `part_supplier_items`. **No write path
exists anywhere in the repository** (only `functions/scripts/seedOperationsDemoData.js:142` seeds
it). It is still READ live by the client:
`field-ops-app-vite/src/services/operationsQueries.ts:175` (`fetchSupplierCatalog`), consumed by
Operations.jsx's ProcurementPanel.

Retiring it is therefore a client workstream, not a backend deletion: point the panel at the
governed `part_supplier_items` projection, then delete the collection constant, the
`supplierCatalogItem` metadata definition, its `entityRegistry.js` entry and its
`ownershipMatrix.ts` row. **Not attempted here** — it crosses into UI ownership.

## 4. `field-ops-app-vite/src/metadata/entityRegistry.js` — no change needed

`supplierEntity`, `supplierCatalogItemEntity` and `manufacturerEntity` are **already registered**
(`entityRegistry.js:66`, `:80`, `:81`). Administration→Objects readiness for this lane's objects is
an existing fact, not something this work had to add. When the read path moves to the EOS API, the
change is `readVia` / `readCallable` on those definitions — not a new registration.

## 5. `functions/src/access/permissionCatalog.ts` — no new capability (confirmed)

The governed supplier/manufacturer/supplier-item commands all gate on the **existing**
`inventory.catalog.manage` and `inventory.catalog.activate`. Migration 008 adds no capability, and
the repository in this lane deliberately enforces **no** authorization (that belongs to the command
layer above it). Nothing to register.

Standing production gap, unchanged and not this lane's to fix: no standing role carries
`inventory.catalog.activate`, so supplier activate/deactivate fails closed
(`docs/releases/supplier-master-rc-1.md`).

---

## Open question this lane surfaced but did NOT settle

`functions/src/ownership/ownershipMatrix.ts:430-435` flags `suppliers` as an **OPEN QUESTION**:
"Supplier identity is shared; supplier terms may be per-company."

Migration 008 does not settle it, and specifically does not settle it by adding a column — no
governed source record carries an operating company, so a `NOT NULL` column would have to be
defaulted or backfilled with a value nobody stated, and a nullable one would record "we do not know"
as data.

What the modelling **does** establish, for whoever rules: every commercial term — cost, currency,
lead time, minimum order quantity, order multiple, contract window — lives on
`supplier_catalog_items`, not on `suppliers`. The Supplier record carries identity, contact and
`payment_terms_ref`, which `supplierMasterTypes.ts` states is "a label/reference, not a terms
engine". **If the ruling is "terms are company-scoped", the column lands on
`supplier_catalog_items`, and both tables are still empty, so it is a one-line additive migration.**

## Verdict recorded here for the next lane: Manufacturer

Manufacturer is a **real, fully built governed object with no data** — not an unbuilt concept, and
not an authority worth a Postgres table yet. It has three trusted commands
(`functions/src/partMaster/partMasterCommands.ts:481-640`), three callables
(`functions/src/index.ts:365-369`), a read service, a metadata definition and UI surfaces; doc id is
enforced to equal `manufacturerId` (`partMasterRepository.ts:143-145`); Rules are fully closed
(`firestore.rules:1638-1640`).

It was deliberately **not** modelled in migration 008 because:

1. Its only relationship is `parts.manufacturerId` (`partMaster/types.ts:113`), and there is no
   `parts` table in `eos_ops` to hold the other end — Lane C2 owns Part. The foreign key that would
   justify the table cannot exist yet.
2. **No supplier↔manufacturer relationship exists anywhere in this codebase.** A full search of
   `functions/src` finds no field, on any record, relating the two. Inventing a join table would be
   inventing the business fact.
3. It holds no rows (the `manufacturers` collection is absent from the sandbox) and client writes
   are gated off in every environment
   (`field-ops-app-vite/src/config/environments.json` `MANUFACTURER_WRITE_READY: false`).

**Sequencing:** model `manufacturers` in Postgres in the same tranche that lands `parts`, so the
`parts.manufacturerId` foreign key — which has **no referential-integrity enforcement today**;
`partMasterCommands.ts` validates the id's format only and never reads the manufacturer repository —
is created with it. That FK is the whole reason for the table.
