# W1-C10 (Commercial) — registrations this lane could not perform, and what it found

Lane C10, Wave 1. Objects: **Opportunity, Sales Agreement, Sales Order, Sales Territory**.
Branch `impl/w1-commercial`. Migration id `1758844800000`.

This lane may not edit `functions/package.json`, `field-ops-app-vite/src/metadata/entityRegistry.js`,
`field-ops-app-vite/src/access/objectPermissionMap.js`, `functions/src/access/permissionCatalog.ts`,
`firestore.rules`, `.github/workflows/**`, the Firebase-exit manifests, `capability-graph.json`, or
navigation. Everything below that would have required one of those files is recorded here instead of
being done.

---

## 1. REQUIRED — `functions/package.json` — `test:adminPolicyPostgres`

`functions/test/commercialOwnershipPostgres.test.mjs` (new, 19 tests) is **not** registered in the
serialized PostgreSQL command:

```
"test:adminPolicyPostgres": "npm run build && node --test --test-concurrency=1 \
  test/adminPolicyPostgres.test.mjs test/adminPolicySeed.test.mjs test/adminPolicyActivation.test.mjs \
  test/eosOpsPostgres.test.mjs test/eosOpsOperatingCompanyCustodyPostgres.test.mjs \
  test/inventoryCapabilityGrantMigration.test.mjs"
```

**Add `test/commercialOwnershipPostgres.test.mjs` to the end of that list.**

The suite is written so that *not* registering it is safe today: it performs **no schema reset**, so
it does not trip `adminPolicyPostgres.test.mjs`'s "every suite that resets the schema is covered by
that one command" guard, and it cannot race the resetting suites — it runs `migrate up` (a no-op
once applied) and confines every row to a tenant id generated per process.

Two consequences of not being registered, both real:

- The suite is **not run by any registered command**, so it only executes when someone names the
  file. It was run for this lane against `postgres:16` (19/19 pass; output in the PR body).
- One claim is proved only over the migration **source text** rather than against a server: that the
  DOWN migration refuses to reverse while ownership handoffs exist
  (`commercialOwnershipAuthority.test.mjs`, "reversing the migration refuses while any ownership
  history exists"). Proving it against a real server needs a schema rebuild, which needs
  registration. **When the registration lands, that proof should move to the PostgreSQL suite.**

## 2. REQUIRED IF/WHEN `eos_commercial` GOES LIVE — nothing yet

No capability key, no permission-catalog entry, no `objectPermissionMap` row, and no Rules change is
requested by this lane, because nothing in this change is reachable by a client or a callable. The
`eos_commercial` tables are **pre-cutover**: nothing deployed writes them, exactly as migrations 005
and 007 established for `eos_ops`. The Firestore commands remain the live authority.

## 3. NOT REQUESTED, deliberately — Administration → Objects

All four objects **already appear** in Administration → Objects, so this lane asks for no registry
change:

| Object | `entityRegistry.js` | `objectPermissionMap.js` | How it reaches Admin→Objects |
|---|---|---|---|
| Opportunity | `:68` `opportunityEntity` | `:38-39` `"Opportunities"` | `MATRIX_AND_REGISTRY` |
| Sales Order | `:77` `salesOrderEntity` | `:41-43` `"Sales Orders"` | `MATRIX_AND_REGISTRY` |
| Sales Agreement | `:76` `salesAgreementEntity` | **absent** | `REGISTRY_ONLY`, verbs from `policyObjectRegistry.js:126-130` `MATRIX_GAP_CAPABILITIES.salesAgreement` |
| Sales Territory | `:78` `salesTerritoryEntity` | **absent** | `REGISTRY_ONLY`, **no grantable verb** (`policyObjectRegistry.js:117-119` names it explicitly) |

**Open gap, for whoever owns the CRUD matrix (not this lane):** Sales Agreement and Sales Territory
have no `OBJECT_PERMISSIONS` row. Sales Agreement is covered by the gap table; Sales Territory is
listed as an object "no capability in the catalog names". That is a policy decision, not a code fix,
and it is recorded here rather than guessed at.

---

## 4. Verdict: **is Sales Territory a real built object?**

**Yes. It is real and built — and it is deliberately not an ownable one.**

Built, with evidence:

- Governed write command: `functions/src/coverage/coverageCommands.ts:36` `buildTerritory` (pure,
  validates `STATE / STATE_GROUP / ZIP_GROUP / GEOSPATIAL` and their geography).
- Governed callable: `functions/src/coverage/coverageCallables.ts:41-59` `createSalesTerritory`,
  idempotency-keyed, audit-staged, Admin-SDK write.
- Exported: `functions/src/index.ts:113` (export ≠ deploy, per its own note at `:111-112`).
- Collection constant: `functions/src/constants/collections.ts:71`
  `SALES_TERRITORIES_COLLECTION = "sales_territories"`.
- Deny-all Rules: `firestore.rules:1832`.
- Read path: `functions/src/coverage/coverageReadCallables.ts:60`, feeding the pure resolver
  `coverage/coverageResolution.ts`.
- Client object definition: `field-ops-app-vite/src/metadata/definitions/salesTerritory.js`,
  registered at `entityRegistry.js:78`.

What it is **not**:

- **Not ownable.** `ownershipMatrix.ts:452` classifies `salesTerritory` `EXCLUDED` — "coverage is not
  ownership, credit, commission or security". No owner field, refused by the handoff command
  (`FAMILY_NOT_OWNABLE`), never censused.
- **No operating-company axis.** No `operatingCompanyId` anywhere in `functions/src/coverage/`.
- **Effectively write-only today.** No update and no delete call site exists in `coverage/`; the
  client definition records `readVia: "UNKNOWN"`, `readCapability: null`
  (`salesTerritory.js:99-100`) and no list view.

So it is a real object with a governed create path and a resolver, not vapour and not a stub — but
there is nothing about ownership for this lane to enforce on it, which is why migration 008 gives it
no table and invents no model for it. Its Firestore authority is untouched by this change.

---

## 5. Findings this lane did NOT act on (each is someone's next step, none is guessed at)

1. **`ownershipMatrix.ts:143-145` is stale.** It says `operatingCompanyId` is "NOT STORED TODAY" on
   the commercial rows. It is stored now, and required: `salesOrderCommands.ts:274-282` and
   `salesAgreementCommands.ts:354-361` both throw `COMPANY_REQUIRED`. Left alone because correcting
   a comment in a file nine sibling lanes are also reading is a conflict for no behavioural gain.
2. **`SALES_CHANNELS` is still declared twice server-side** — `opportunityLifecycle.ts:27` and
   `salesOrderLifecycle.ts:18`, each with its own guard (`isChannel` / `isSalesChannel`), plus the
   client mirror. Increment 2 of
   `docs/assessments/commercial-coverage-territory-authority-model.md` (unify the two enum gates into
   the configurable ref-data lookup) is **still open**; only the `STRATEGIC_ACCOUNTS` widening
   happened. Retiring one of the two is a behaviour-touching change to two live command paths and is
   out of this lane's smallest-coherent step.
3. **`PARTS_COLLECTION = "parts"` is declared three times server-side and three times client-side**,
   and `functions/src/constants/collections.ts` declares it **not at all**:
   `salesAgreement/salesAgreementLineReferences.ts:67`, `partMaster/partMasterRepository.ts:19`,
   `workOrderInstall/workOrderInstallCommand.ts:58`, plus `useSerialTrackedParts.js:38`,
   `useWholeUnitParts.js:28`, `partMasterQueries.js:22`. This change touches no part reference, so
   `functions/src/eosOps/migration/partIdContract.ts` was not needed and no second canonicalization
   was written. Consolidating the six declarations belongs to whoever owns Part.
4. **`sales_orders` is re-declared in scripts**: `functions/scripts/financialReviewFixtures.mjs:67`
   exports its own `SALES_ORDERS_COLLECTION`; `phantomSalesOrderLinkRepairCli.js:339` and
   `salesOrderNumberBackfillCli.js:275` each hold a local copy. Script-only, not runtime.

---

## 6. Test-stack edits this lane HAD to make (conflict warning for sibling lanes)

Adding an eighth migration invalidates assertions that hard-code the migration stack's depth. All
seven edits are mechanical and every one is in a file a sibling lane adding a migration will also
need to touch:

- `test/adminPolicyPostgres.test.mjs`, `test/adminPolicySeed.test.mjs`,
  `test/adminPolicyActivation.test.mjs`, `test/eosOpsPostgres.test.mjs`,
  `test/eosOpsOperatingCompanyCustodyPostgres.test.mjs`,
  `test/inventoryCapabilityGrantMigration.test.mjs` — each `reset()` now also drops
  `eos_commercial`, or a second `migrateFromClean()` in the same job fails on the surviving type.
- `test/adminPolicyPostgres.test.mjs` — `down "7"` → `down "8"`, and the "newest migration reverses
  alone" walk gained a leading step for 008 (asserting `eos_commercial` goes and `eos_ops` /
  `eos_policy` do not).
- `test/eosOpsOperatingCompanyCustodyPostgres.test.mjs` — the two `down 1` calls that meant "reverse
  007" became `down 2`.
- `test/eosOpsOperatingCompanyCustody.test.mjs` — "007 sorts last" became "007 sorts seventh", and
  the exact migration count became a minimum. This is the edit that will keep re-conflicting;
  pinning 007's *position* rather than its *lastness* is what makes it stable from here.
