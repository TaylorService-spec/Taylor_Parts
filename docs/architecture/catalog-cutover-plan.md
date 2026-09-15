# Catalog cutover plan — Part Master and Equipment Model, Firestore → PostgreSQL

Branch `catalog/postgres-cutover`, based on main `736b1f17` (post-C4). Owner option (a): **governed catalog cutover
before Commercial C6** — COPY ONCE → VERIFY → RECONCILE → CUT OVER WRITERS → DISABLE FIRESTORE CATALOG WRITERS.

This change builds and proves the first three steps' tooling and the target writers, and builds (does not throw) the
switch for the last step. **Nothing is wired, copied, or disabled in any environment.** Line numbers are at this
branch's HEAD.

Classes (as in `catalog-reference-authority-census.md`): **A** canonical PostgreSQL authority · **B** PostgreSQL schema,
not authoritative · **C** Firestore-only authority · **D** derived / denormalized · **E** legacy defect · **F** Owner decision.

---

## 1. Census (repository truth)

### 1.1 Firestore WRITERS

**Master writers** (the only governed writers of master data):

| Writer | Evidence | Reached from |
|---|---|---|
| `createPart` → `repo.stageCreate` → `txn.create(parts/{partId})` | `functions/src/partMaster/partMasterCommands.ts:237,270`; `partMasterRepository.ts:174` | callable `createPart` (`index.ts:400` → `partMasterCallables.ts:75`); client `field-ops-app-vite/src/services/partMasterCommandClient.js:29` |
| `updatePart` → `repo.stageUpdate` → `txn.set(parts/{partId})` (+ INTERNAL_PN alias backfill into `part_aliases`) | `partMasterCommands.ts:302,404`; `partMasterRepository.ts:177` | callable `updatePart` (`partMasterCallables.ts:87`); client `partMasterCommandClient.js:31` |
| `changePartStatus` → `txn.set(parts/{partId})` | `partMasterCommands.ts:434,464` | callable `changePartStatus` (`partMasterCallables.ts:105`); client `partMasterCommandClient.js` (changeStatus) |
| `runEquipmentCompatibilityCommand` action `importEquipmentModel` → `txn.create`/`txn.update(equipment_models/{id})` | `functions/src/equipmentCompatibility/commands.ts:342,523,528`; `equipmentModelRepository.ts:173,179` | **no deployed callable** (not exported from `functions/src/index.ts`); tests only |

**Import writers** (no write authority of their own — they call the master writer):

| Writer | Evidence |
|---|---|
| Data Import execute → `createPart` | `functions/src/dataImport/firestoreDataImportAdapters.ts:200`; callable `executeDataImport` (`dataImportCallables.ts:359`); client `field-ops-app-vite/src/access/dataImportClient.js:54` |
| `executePartMasterCreate.js` (operator, via `createPart`) | `functions/scripts/executePartMasterCreate.js:139-141` |
| `generatePartMasterMigrationEvidence.js` (operator, via `createPart`/`changePartStatus`) | `functions/scripts/generatePartMasterMigrationEvidence.js:46,69` |

**Raw operator writers** (bypass the command; sandbox / Certification only):

| Writer | Evidence |
|---|---|
| Sandbox baseline seed, `set(..., {merge:true})` on `parts` | `functions/scripts/seedSandboxBaseline.js:134,192` |
| Certification world seed / emulator bootstrap / corrections (both collections) — **read-only mention; the Certification world is frozen** | `functions/scripts/certificationWorld/seedWrite.mjs:120`, `emulatorBootstrap.mjs:45`, `correctLiveWorld.mjs:185`, `migrateEquipmentModelIdentity.mjs:248` |

**Derived writers:** none. No Firestore trigger or command writes a denormalized field onto `parts` or
`equipment_models`. The non-master fields on stored Part documents (`sku`, `unitOfMeasure`, `partTrackingMode`,
`cert*`, `dataProvenance`, `certificationWorld`) are written only by the raw operator seeds above
(`seedSandboxBaseline.js:193-205`, `certificationWorld/data/partsCatalog.mjs:142-160`, `wholeUnitParts.mjs:112-133`).

**Rules:** `firestore.rules:1632-1637` `parts` — read for admin/dispatcher/PARTS_MANAGER/WAREHOUSE_MANAGER, **all
client writes false**; `firestore.rules:1714-1716` `equipment_models` — **read and write false** for every client.

### 1.2 Firestore READERS

**Server readers of `parts`** (all read `parts/{partId}` by id unless noted):

| Reader | Evidence |
|---|---|
| Part repository `getById` users: cycle count, transfer, receiving (×2), part balance (×2), AI readiness, part aliases, supplier items, part reference compatibility | `cycleCount/cycleCountCallableWiring.ts:65`; `inventoryTransfer/transferCallableWiring.ts:62`; `inventoryReceiving/receivingCallableWiring.ts:66,113`; `inventory/partBalanceReadService.ts:400`; `inventory/partBalanceBatchReadService.ts:227`; `ai/workOrderReadinessContext.ts:295`; `partMaster/partAliasCommands.ts:101`; `partMaster/partSupplierItems.ts:307`; `partMaster/partReferenceCompatibility.ts:92` |
| Master writers' own reads | `partMasterCommands.ts` (via repository) |
| WO parts plan (txn) | `workOrderPartsPlan/setWorkOrderPartsPlan.ts:216,224` |
| Service for Sales Order (txn) | `salesOrder/createServiceForSalesOrder.ts:143,176` |
| WO consumption tracking mode | `workOrderConsumption/consumptionSourceService.ts:138` |
| Whole-unit query `where wholeUnit == true` | `workOrderInstall/workOrderInstallCommand.ts:255`; `workOrderInstall/workOrderInstallCallables.ts:134` |
| Sales Agreement line references (txn, PART/EQUIPMENT_MODEL) | `salesAgreement/salesAgreementLineReferences.ts:140,187` |
| Product picker search (id prefix) | `salesAgreement/productReferenceSearchService.ts:127` |
| Scanner lookup | `partMaster/scannerPartLookup.ts:82` |
| Data import identity / inventory import resolution (incl. `where internalPartNumber ==`) | `dataImport/firestoreDataImportAdapters.ts:75`; `dataImport/firestoreInventoryImportAdapters.ts:40,210,217` |

**Server readers of `equipment_models`:** `partMasterCommands.ts:260,344` (FK existence);
`equipmentCompatibility/commands.ts:523,533,548` (model + alias/compatibility referential integrity);
`equipmentCompatibility/readService.ts:158,344`; `salesAgreement/productReferenceSearchService.ts:154`;
`salesAgreementLineReferences.ts:140,187`.

**Client-direct readers** (`parts` only; `equipment_models` is deny-all):

| Reader | Evidence | Consumers |
|---|---|---|
| Whole collection | `field-ops-app-vite/src/services/partMasterQueries.js:53` | `PART_CATALOGUE_WHOLE_COLLECTION_READ` (`partMasterQueries.js:66-73`): useCanonicalPartNames, ReceiveAgainstPurchaseOrder, WorkOrderPartsPlanEditor, WarehouseManagerHome, PartsList, PartDetail (+ `partsShadowParityReaders.js:13`) |
| `where wholeUnit == true` | `field-ops-app-vite/src/hooks/useWholeUnitParts.js:40` | `modules/equipment/AvailableEquipment.jsx:45` |
| `where controlType == SERIALIZED` | `field-ops-app-vite/src/hooks/useSerialTrackedParts.js:63` | `modules/receiving/AcquireExistingUnit.jsx:67` |

**Scripts / verification (read only):** `_releaseStateSnapshot.mjs:74`; `extractProductionFixtures.mjs:33-35`;
`d2SmokeRulesVerification.js:73`; `firestoreDeploymentVerificationShared.js:16`; `truckRegistryVerificationMatrix.js:38`;
Certification world `g03Snapshot.mjs:72`, `buildGoldenManifest.mjs:168`, `buildQuestionSeed.mjs:87`,
`proveReceivingConcurrency.mjs:52`, `applyDemandPlan.mjs:82`, `verifyReferenceIntegrity.mjs:71`, `emulatorBootstrap.mjs:67`,
`proof.mjs:61`. **Reporting:** no `functions/src/reporting` module reads either collection. Index declarations:
`scripts/listIndexCoverage.mjs:225-245`.

### 1.3 Field inventory

**Part** — canonical master data is exactly `partToFirestore` (`partMasterRepository.ts:78-98`) as `partFromFirestore`
reads it back through `validatePart`:

| Field | Class | PostgreSQL (deferred 027) |
|---|---|---|
| doc id = `partId` (= SKU, Decision #44; `parsePartId` `/^[A-Za-z0-9_-]{1,64}$/`) | identity | `eos_ops.parts.id` (025) |
| `internalPartNumber`, `name`, `description?`, `category?` | C → A | `internal_part_number`, `name`, `description`, `category` |
| `status` DRAFT/ACTIVE/INACTIVE/SUPERSEDED/DISCONTINUED | C → A | `status ops_part_status` |
| `stockingUnit`, `controlType`, `stockingClass` | C → A | enums |
| `flags {expiryTracked, consumable, returnableCore}` | C → A | three NOT NULL booleans |
| `primaryManufacturerId?`, `primaryManufacturerPartNumber?`, `oemStatus?` | C → A | opaque key (manufacturers stay Firestore), text, enum |
| `wholeUnit?` (absent = false), `equipmentModelId?` | C → A | `whole_unit`, tenant-scoped FK to `equipment_models` |
| `version`, `createdAt`, `updatedAt` | repository metadata | carried verbatim |
| `createdBy`, `updatedBy` (Firebase uids) | identity provenance | **not carried** — see §8 |
| `sku` (== partId), `unitOfMeasure`, `partTrackingMode` | **D** legacy projections | not copied; census counts them and reports `sku ≠ id` |
| `cert*`, `dataProvenance`, `certificationWorld` | fixture metadata | not copied; marker drives the §8 decision |

**Equipment Model** — `modelToFirestore` (`equipmentModelRepository.ts:37-55`): `equipmentModelId` (canonical
`{manufacturerId}--{modelNumber}`), `manufacturerId`, `manufacturerName`, `modelNumber`, `displayName`, `family`,
`subtype`, `revision`, `status` DRAFT/ACTIVE/INACTIVE/RETIRED, `sourceAuthority`, `version`, meta. All map 1:1 to
`eos_ops.equipment_models` (migration 008, class B today). No derived fields.

### 1.4 Lifecycle

Part: `DRAFT→ACTIVE; ACTIVE↔INACTIVE; ACTIVE|INACTIVE→DISCONTINUED|SUPERSEDED`; DISCONTINUED/SUPERSEDED terminal
(`partMasterCommands.ts:63-69`); no physical delete; `controlType` immutable after create (P1B R2). Equipment Model: four
statuses, **no transition rule** in the Firestore command (any status on import). Status never changes a Commercial
reference verdict (#1911 census).

### 1.5 Tenancy

Firestore catalog documents carry **no tenant field**; tenancy today is the Firebase project. PostgreSQL identity is
tenant-scoped (`(tenant_id, id)`). Evidence for the nonprod mapping: `render.yaml:58-79` declares one nonprod service
(`EOS_ENVIRONMENT=nonprod`) and database; the tenant key `taylor-nonprod` is the one the bootstrap
(`functions/scripts/bootstrapEosTenant.mjs:14`), the synthetic seed (`seedSyntheticNonprodWorkforce.js:44`) and the
training doc (`docs/training/administration-policy-and-access.md:7`) use; `config/environments.json` declares
`platform-sandbox` ↔ Firebase `eos-platform-sandbox`. So **platform-sandbox catalog → tenant `taylor-nonprod`** is
supported by evidence, but it is an operator assertion, not a stored fact: the tool takes `--tenantKey` explicitly and
never infers it. **Production has no PostgreSQL tenant and no mapping (unresolved, §8).**

---

## 2. Target PostgreSQL writers (built, unwired)

`functions/src/catalogMaster/` — no Firebase import (static test), not composed in `functions/src/eosApi/server.ts`.

| Module | Commands | Capability (existing ids, `permissionCatalog.ts`) |
|---|---|---|
| `catalogMasterKernel.ts` | one transaction per command: resolved actor `{tenantId, principalId, capabilities}` → capability → active principal + membership → body (reads `FOR UPDATE`) → `eos_policy.audit_events` row → COMMIT; deterministic non-leaking error codes | — |
| `postgresEquipmentModelWriter.ts` | `createEquipmentModel`, `updateEquipmentModel` | `equipment.model.manage` (= Firestore `COMMAND_CAPABILITIES.importEquipmentModel`) |
| `postgresPartMasterWriter.ts` | `createPart`, `updatePart`, `changePartStatus` | `inventory.catalog.manage` / `inventory.catalog.activate` (= `CAP_CATALOG_MANAGE` / `CAP_CATALOG_ACTIVATE`) |
| `catalogRows.ts` | canonical record shape, row mapping, inserts — shared by writers and copy | — |

Rules reused, not restated: `validatePart` and `validateEquipmentModel` (pure). Restated with parity tests: the Part
status transition table and updatable-field allowlist. Ids carried verbatim (no remapping). Allowlisted input fields;
`version` is repository authority (create = 1, update = expected + 1).

**Idempotency is content-addressed.** The Firestore commands are idempotent by *key* (an audit document per key), not
by id. PostgreSQL has no catalog receipts table and must not borrow `eos_commercial.command_receipts`. So: a create
whose row already holds exactly the requested fields replays; an update/status change whose row is at
`expectedVersion + 1` holding exactly the requested result replays; otherwise a deterministic conflict. Whole no-op
updates are `NO_CHANGES` rather than a version bump.

**Gaps (CATALOG_AUTHORITY_GAP):**
1. **Capability vocabulary.** `inventory.catalog.manage`, `inventory.catalog.activate`, `equipment.model.manage` exist in
   `permissionCatalog.ts` but **not in `eos_policy.capabilities`**, so no PostgreSQL Role can be granted them. Deferred
   027 registers them (definitions only, no grant).
2. **INTERNAL_PN alias.** Firestore `updatePart` preserves a changed `internalPartNumber` as a `part_aliases` alias
   atomically. `part_aliases` is not in PostgreSQL, so the PostgreSQL `updatePart` **fails closed**
   (`INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE`) on a number change until aliases move.
3. **Dependent Firestore authorities.** `part_aliases`, `part_supplier_items`, `equipment_model_aliases`,
   `equipment_part_compatibility` commands check Part / Equipment Model existence in Firestore
   (`partAliasCommands.ts:101`, `partSupplierItems.ts:307`, `equipmentCompatibility/commands.ts:533,548`). After writer
   cutover, a record created only in PostgreSQL is invisible to them. See §5.
4. **Manufacturers** stay Firestore; `primary_manufacturer_id` is an opaque key (the Firestore command never checked it either).

---

## 3. Schema

- **Equipment Model:** `eos_ops.equipment_models` (migration 008, on main) already holds every master field. **No
  migration.**
- **Part:** `functions/migrations/deferred/1759881600000_catalog-master-descriptive-authority.sql` (**027, deferred**):
  `ALTER TABLE eos_ops.parts` (025's identity table) adding the §1.3 columns as enums/booleans/text, `validatePart`'s
  combination rules as CHECKs, the tenant-scoped FK to `equipment_models`, `version/updated_by/updated_at`; plus the
  three capability vocabulary rows. Pre-flight refuses if `eos_ops.parts` has rows; Down refuses while records or grants
  exist. It creates no table and restates nothing of 025.

**Why deferred (least-coupled design).** 027 extends a table that exists only on #1911. Putting it in
`functions/migrations/` here would break every migration run on this branch; merging #1911 into this branch is not
allowed; restating 025's DDL is forbidden. The repository already has the pattern for "prepared, precondition not
met": `functions/migrations/deferred/` (neither node-pg-migrate nor `migrationSchema.mjs` reads it). Moving 027 up one
directory after #1911 merges is the integration act. The PostgreSQL suite proves both states: without 025 it runs on
main's migration set (Part proofs skip with `DEPENDS ON #1911`, and the copy refuses Parts with
`PART_TARGET_SCHEMA_ABSENT`); with 025 present it migrates a temporary symlink directory of every migration plus
deferred 027 through the real runner, so 027 executes exactly as it will once moved. (Proved locally both ways — §9.)

---

## 4. Population and reconciliation

```
exportCatalogSnapshot.js (Firestore, read only)  →  snapshot.json  →  catalogCutover.js census | copy | verify (PostgreSQL)
```

**Source approach and the Firebase exit guard.** `scripts/firebaseExitGuard.mjs` scans `functions/src`,
`field-ops-app-vite/src` and `integrations` only; `functions/scripts` is not fenced and is where every existing
Firestore operator tool lives. The guard would therefore *permit* a copy tool that reads Firestore directly. The design
still splits the read out: the PostgreSQL tool loads no Firebase module (static test + fence preload), and the exact
bytes copied are a hashable artifact. No existing export fits (`extractProductionFixtures.mjs` is production-only,
bounded and sanitizing). `exportCatalogSnapshot.js` is the minimal read-only step: only `collection(name).get()` on
`parts` and `equipment_models`, Timestamps tagged, any other non-JSON value refused, output `0600`, never overwritten.

**Snapshot format** (`catalogSnapshot.ts` header): `{format:"EOS_CATALOG_SNAPSHOT", version:1, source:{firebaseProjectId,
exportedAt}, parts:[{id,data}], equipmentModels:[{id,data}]}`.

**Canonicalization** = what the Firestore adapters read back (`partFromFirestore`, `modelFromFirestore`, `readMeta`). A
document either would refuse is INVALID and blocks the copy; nothing is repaired or defaulted. Timestamps are compared
at microsecond precision (TIMESTAMPTZ); sub-microsecond truncation is counted.

**Modes:**

| Mode | Behaviour |
|---|---|
| `census` | read only: counts, certification-marked counts, invalid records (identity mismatch, non-canonical id, domain, meta), duplicate canonical identities, Part → Equipment Model references missing from the snapshot, status distribution, non-master field counts, `sku ≠ id`, duplicate internal part numbers, cross-kind ids, truncated timestamps, blockers, canonical digest; target tenant row counts and whether the Part schema is present |
| `copy` | refuses unless census is copy-ready; ONE transaction + per-tenant advisory lock; inserts absent records verbatim (models before parts); identical present → nothing; **different present → `DRIFT_DETECTED`, everything rolled back, never overwritten**; tenant rows not in the snapshot → `TARGET_HAS_UNKNOWN_RECORDS`; one `eos_policy.audit_events` row (`catalog.cutover.copy`, digest, counts) only if something was inserted; actor columns `catalog-cutover:<performedBy>` |
| `verify` | READ ONLY transaction: source vs target counts, identity-set reconciliation, exact field reconciliation over a deterministic sample (`--sample N|all`, sha256 order), duplicate identity, dangling Part → Equipment Model references, reference verdict spot-checks with the #1911 adapter's tenant-scoped EXISTS probe (own kind FOUND, other kind WRONG_KIND, absent ref and absent tenant NOT_FOUND) |

**Fence** (refuses before `pg`/`lib` load; proved by subprocess with a module-load sentinel): `--environment` declared in
`config/environments.json`, not production by role or by project id, `--databaseUrlEnv` named (shared
`assertMeasurementTarget`); `EOS_ENVIRONMENT` exactly `nonprod` (shared `assertNonprodRuntime`); not
`platform-certification`; `--tenantKey`, `--snapshot`, and `--performedBy` for copy. After parsing: the snapshot's
`firebaseProjectId` must equal the environment's declared project and must not be `taylor-parts`. The export refuses no
`--projectId`, `taylor-parts` (even "confirmed"), `eos-platform-certification`, undeclared projects, missing/existing `--out`.

**Nothing has been run against any Firebase project or Render database.**

---

## 5. Writer cutover and old-writer disablement

### 5.1 The reader constraint (why the order matters)

Every Firestore reader in §1.2 keeps reading Firestore after the copy. With no sync and no dual write, **any catalog
write accepted by PostgreSQL after the copy is invisible to those readers**, and any write accepted by Firestore after
the copy is drift. The only coherent sequence therefore freezes Firestore first and opens PostgreSQL writers only when
the readers that must see new catalog records have moved (or the Owner accepts a catalog write freeze for that window
— §8).

### 5.2 Sequence (each step separately authorized and evidenced)

1. **Integrate** #1911 (025) → this branch (move deferred 027 into `functions/migrations/`) → migrate nonprod.
2. **Export** `exportCatalogSnapshot.js --projectId eos-platform-sandbox`; record sha256.
3. **Census** → resolve every blocker at the source through the existing governed writers (never in the tool); decide
   certification-marked records (§8).
4. **Freeze Firestore catalog writers:** set `FIRESTORE_CATALOG_WRITER_STATE = "RETIRED"` in
   `functions/src/catalogMaster/firestoreCatalogWriterRetirement.ts`, deploy Functions to the environment. From here:
   - callables `createPart`, `updatePart`, `changePartStatus` → `failed-precondition` (`partMasterCallables.ts` `mapError`);
   - `executeDataImport` Part rows → refused per row by `createPart`;
   - `runEquipmentCompatibilityCommand` `importEquipmentModel` → pre-acceptance denial;
   - operator scripts `executePartMasterCreate.js`, `generatePartMasterMigrationEvidence.js` → refused (they call `createPart`);
   - client paths `partMasterCommandClient.js` (create/update/changeStatus) and `dataImportClient.js` (execute) receive the refusal.
   Not covered by the switch (raw Admin SDK writes, must not be run after the freeze): `seedSandboxBaseline.js`,
   Certification world scripts (frozen anyway).
5. **Re-export after the freeze**, census, **copy**, **verify `--sample all`**. A reconciled verify on a post-freeze
   snapshot is the population evidence. A rerun must be `NO_CHANGES`.
6. **Move readers** (§1.2) to PostgreSQL through the Render API, domain by domain (separate PRs): Commercial reference
   authority composition (#1911's adapter, CATALOG_CUTOVER_TAIL) first, since it is what C6 needs.
7. **Open PostgreSQL writers:** compose `catalogMaster` commands into the Render transport, grant the capabilities
   (governed Role grant), move `partMasterCommandClient.js` / Data Import to the API. Only now do catalog writes resume.
8. **Remove** the retired Firestore writers, their callable exports (`functions/src/index.ts:400-402`), the switch, and
   shrink `docs/architecture/firebase-exit-baseline.json`.

The switch is proved (offline): OPEN today; RETIRED refuses every listed writer; each writer calls it with its own id
before capability resolution; the callable maps it to `failed-precondition`.

---

## 6. Production stop conditions

Stop and obtain separate authorization before any of: a production (`taylor-parts`) export or census (a production data
read — both tools refuse it outright and have no production mode); creating a production PostgreSQL tenant or choosing
its key; deploying the RETIRED switch to production; any copy into a production database. Also stop if: census reports
any blocker; verify is not reconciled; a post-freeze rerun is not `NO_CHANGES`; any Firestore catalog write is observed
after the freeze; `sku ≠ id` or duplicate internal part numbers are found and not explained.

---

## 7. Integration order and dependencies

1. **#1911** (catalog foundation: 025 + reference authority) merges first.
2. This branch rebases on it and, in the integration commit, moves
   `migrations/deferred/1759881600000_catalog-master-descriptive-authority.sql` into `migrations/`. The Part proofs in
   `catalogCutoverPostgres.test.mjs` then run in CI without change. (C4's "023 is the latest migration" tests will need
   the coordinator's migration-pin patch at that point, as for every lane that adds a migration.)
3. Reference-authority composition into `server.ts` (CATALOG_CUTOVER_TAIL) after a reconciled verify.
4. CRM lane (#1912) touches the same `functions/package.json` / workflow lines; edits here are append-only.

---

## 8. Unresolved facts and Owner decisions

- **F — Writer freeze window.** Between the Firestore freeze (§5.2 step 4) and PostgreSQL writers opening (step 7),
  catalog records cannot be created or edited anywhere. Accept a freeze window, or require readers to move first?
- **F — Certification-marked records** in the sandbox `parts` / `equipment_models`: copy into the nonprod tenant
  (`--certificationMarked include`) or not (`exclude`)? The copy refuses until decided.
- **F — Legacy actor uids.** Copied rows record the cutover operator as `created_by`/`updated_by`; the Firestore
  `createdBy`/`updatedBy` uids are not carried into eos_ops (identity, not authority). Acceptable, or must they be
  archived elsewhere?
- **Unresolved — production tenancy.** No production PostgreSQL tenant exists; the production catalog → tenant mapping
  cannot be proved from the repository.
- **Unresolved — live data shape.** Counts, invalid records, `sku ≠ id`, duplicate internal part numbers and
  certification markers in `eos-platform-sandbox` are unmeasured until an authorized export + census.
- **Gap — `part_aliases`** not in PostgreSQL (internal part number changes fail closed); dependent alias / supplier item /
  compatibility authorities (§2 gap 3) must move or be frozen with the catalog.

---

## 9. Proof

- `functions/test/catalogMaster.test.mjs` (offline, in `test:adminPolicy`): capability ids and rule parity; no Firebase
  in `src/catalogMaster` or the copy tool; export read-only; retirement switch; census (clean, duplicates, invalid,
  missing references, certification decision, non-blocking findings, timestamps); deferred 027 not applied and extends 025.
- `functions/test/catalogCutoverPostgres.test.mjs` (in `test:adminPolicyPostgres`): Equipment Model writer; Part writer
  (with 025); copy exact ids/versions/timestamps; verify all fields + verdicts; rerun no-op; drift refused; unknown
  target refused; tenant scoping; CLI end to end; 027 Down refusal (with 025).
- `functions/test/operatorScriptEnvironmentFence.test.mjs`: 13 refusals for the two new scripts, each before any client library loads.
- Negative controls (each red, then restored byte-identically): tenant predicate removed from the copy read or the
  verdict probe; duplicate detection removed; drift overwritten; `assertNonprodRuntime` removed; a Firestore write added
  to `catalogCutover.ts` (static test and `firebaseExitGuard` both red).
