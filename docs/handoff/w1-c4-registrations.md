# W1-C4 (Truck / Mobile Location) — registrations this lane could not make

This lane could not edit the shared files listed below. Everything it needed to register there is
recorded here instead, with enough detail to apply verbatim.

Branch: `impl/w1-truck-mobile` · Migration: `functions/migrations/1758326400000_truck-and-mobile-location-registry.sql`

---

## 1. `functions/package.json` — test script registration (REQUIRED)

Two new suites exist and neither is reachable from an `npm run` script.

**`test/truckFleetMigrationSource.test.mjs`** — pure, offline, no database. Add to `test:adminPolicy`
(it sits alongside `legacyInventoryMovementMapping.test.mjs`, the other migration-source suite), or
give it its own script:

```json
"test:truckFleetMigrationSource": "npm run build && node --test test/truckFleetMigrationSource.test.mjs"
```

**`test/truckFleetPostgres.test.mjs`** — requires `POLICY_TEST_DATABASE_URL`; SKIPS without it.

It is deliberately **not** a schema resetter: it runs `node-pg-migrate up` (idempotent) and deletes
only its own rows in its own tenant (`tenant-w1c4`). `test/adminPolicyPostgres.test.mjs:692-702`
requires every suite containing `DROP SCHEMA` to be listed in the single serialized
`test:adminPolicyPostgres` command; this suite contains none, so it does not have to join that
command and does not have to be serialized against the three resetters.

It does, however, exercise `node-pg-migrate down` once (proving migration 008's reversal refusal and
then its clean reversal, re-migrating up afterwards), so it must not run **concurrently** with
another suite against the same database. Registering it inside `test:adminPolicyPostgres` — which
already runs `--test-concurrency=1` — is the safest home:

```json
"test:adminPolicyPostgres": "npm run build && node --test --test-concurrency=1 test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs test/inventoryCapabilityGrantMigration.test.mjs test/truckFleetPostgres.test.mjs"
```

Verified locally against PostgreSQL 16: 18/18 pass.

## 2. `field-ops-app-vite/src/metadata/entityRegistry.js` — no change needed

`truck` and `mobileLocation` are already registered (`entityRegistry.js:35, 51`) and already reach
Administration → Objects through `access/policyObjectRegistry.js:29,166+` (as `REGISTRY_ONLY`
entries) and `modules/administration/RolePolicyGrid.jsx:120`. This lane adds no new client entity.

## 3. `field-ops-app-vite/src/access/objectPermissionMap.js` — gap, not a change this lane made

`OBJECT_PERMISSIONS` contains **no** `truck` or `mobileLocation` entry, so the Admin → Objects
summary cards in `modules/administration/AdminObjects.jsx:257,361` have nothing to show for either
object even though both appear in the governable-objects grid. Recording the gap; closing it is an
Admin-surface decision, not a Truck decision, and nothing in this PR depends on it.

## 4. `functions/src/access/permissionCatalog.ts` / `capability-graph.json` — no change needed

This lane registers **no new capability**. The eos_ops repository is not wired to any HTTP
operation (same posture as `cycleCountRepository.ts`), so there is no new authorization surface.

## 5. `firestore.rules` — no change needed, and none wanted

No Firestore Rules were added or changed. The existing Truck Registry block
(`firestore.rules:1229-1237`, `allow read: if isAdminOrDispatcher()`, all client writes denied) is
untouched, as is the `location_truck_claims` block at `firestore.rules:1245-1248`, which denies
clients even read access. Nothing in this lane uses Rules for authorization, ownership, routing or business config.

---

# Defects found during inspection that this lane did NOT fix

## A. Two client metadata files claim the truck callables are undeployed. They are deployed.

- `field-ops-app-vite/src/metadata/definitions/truck.js:37-49` — "ALL WRITES ARE A TRUSTED,
  TRANSACTIONAL COMMAND SERVICE — AND IT IS UNDEPLOYED", specifically `:38-39` "nothing here is
  exported from functions/src/index.ts, there is no callable/HTTP surface".
- `field-ops-app-vite/src/metadata/definitions/mobileLocation.js:38-45`, esp. `:42-43` "Nothing in
  functions/src/index.ts exports a callable reaching these commands".

Both are contradicted by `functions/src/index.ts:255-265`, which exports all nine truck callables.
The accurate posture is stated two lines above them at `functions/src/index.ts:249-251`: deployed to
`eos-platform-sandbox` under the per-environment activation program, **not** deployed to production.

`mobileLocation.js:77-84` additionally asserts no client-side reader exists for `mobile_locations`;
`services/truckRegistryQueries.js:34` (`fetchMobileLocationDocs`) is one, consumed by
`modules/inventory/CycleCounts.jsx:157` and `modules/inventory/Transfers.jsx:77`.

Not fixed here: both files are client metadata for objects this lane owns, but correcting a
deployment claim is a statement about the deployment program, and the same stale sentence pattern
appears in sibling definitions other lanes own. It should be corrected in one pass.

## B. `functions/src/ownership/ownershipDerivation.ts:85-88, 100-103`

Declares `family: "truck"` → `paths: ["homeWarehouseId"]` ("A truck derives from its home
warehouse") and the same for `mobileLocation`. It is a **referential census** — it measures whether a
reference resolves, which is what produced `derivedNotRoots.trucks` in
`config/ownership/operating-company-roots.sandbox.json` — and it performs no write, so it is left
alone. It is, however, the document that the backfill rule retired in this PR (see E) read as a
licence. A follow-up should say so in that file.

## C. The driver column, deliberately deferred to lane C5

`eos_ops.trucks` has no `assigned_driver_employee_id`. The truck side of the relationship is real,
but choosing between `employees`, `fieldops_technicians` and `eos_policy.principals` is an Employee
identity decision (see `scripts/employeeTruckCrosswalk.lib.mjs:18-37`). The Firestore field stays
authoritative; adding one nullable column plus a foreign key later is strictly additive.

`truckFleetMigrationSource.ts` reports `reconciliation.trucksWithDriverNotCarried` so the number of
affected trucks is visible rather than silently dropped.

## E. RETIRED IN THIS PR: `trucks` operating-company backfill from `homeWarehouseId`

`functions/src/ownership/ownershipBackfillRules.ts` carried an EXECUTABLE write rule
`{ collection: "trucks", fields: ["operatingCompanyId"], evaluate: companyFromRoot(["homeWarehouseId"]) }`
plus an authorized cap of `trucks: 2`. Applied by `functions/scripts/ownershipSandboxBackfill.js:233`
(`tx.set(..., { merge: true })`), it would have written a company derived from the home warehouse —
the exact inference the binding ruling forbids and that the sandbox data proves wrong for
`cert-trk-04` / `cert-trk-05`.

Both the rule and its cap are DELETED, with the reasoning inline. `test/truckFleetMigrationSource.test.mjs`
asserts that neither `trucks` nor `mobile_locations` appears in `BACKFILL_RULES` or
`AUTHORIZED_WRITE_CAPS`, so it cannot come back unnoticed. `AUTHORIZED_TOTAL` drops by 2; no test
asserted its value.

## D. No assignment history exists anywhere

Nothing in the Firestore Truck Registry persists prior truck↔location or truck↔driver links — the
commands overwrite the current value and keep only an Audit Event summary. No history table was
created here, because there is nothing to put in it.
