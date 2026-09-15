# Catalog cutover plan — Part Master and Equipment Model, Firestore → PostgreSQL

Branch `catalog/postgres-cutover`, based on main `736b1f17` (post-C4). Owner option (a): **governed catalog cutover
before Commercial C6** — COPY ONCE → VERIFY → RECONCILE → CUT OVER WRITERS → DISABLE FIRESTORE CATALOG WRITERS.

This change builds and proves the copy/verify tooling, the target writers, and the writer-authority state switch that
the freeze, activation and retirement steps move. **Nothing is wired, frozen, copied or disabled in any environment.**
Owner rulings of 2026-09-14 (controlled freeze window, Certification exclusion, legacy creator uid, migration-only
snapshot export, production fence) are implemented as stated in §4–§6. Line numbers are at this branch's HEAD.

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

| Field | Class | PostgreSQL (migration 027) |
|---|---|---|
| doc id = `partId` (= SKU, Decision #44; `parsePartId` `/^[A-Za-z0-9_-]{1,64}$/`) | identity | `eos_ops.parts.id` (026) |
| `internalPartNumber`, `name`, `description?`, `category?` | C → A | `internal_part_number`, `name`, `description`, `category` |
| `status` DRAFT/ACTIVE/INACTIVE/SUPERSEDED/DISCONTINUED | C → A | `status ops_part_status` |
| `stockingUnit`, `controlType`, `stockingClass` | C → A | enums |
| `flags {expiryTracked, consumable, returnableCore}` | C → A | three NOT NULL booleans |
| `primaryManufacturerId?`, `primaryManufacturerPartNumber?`, `oemStatus?` | C → A | opaque key (manufacturers stay Firestore), text, enum |
| `wholeUnit?` (absent = false), `equipmentModelId?` | C → A | `whole_unit`, tenant-scoped FK to `equipment_models` |
| `version`, `createdAt`, `updatedAt` | repository metadata | carried verbatim |
| `createdBy`, `updatedBy` (Firebase uids) | identity provenance | **never written to a column** — migration evidence only (§4.4) |
| `sku` (== partId), `unitOfMeasure`, `partTrackingMode` | **D** legacy projections | not copied; census counts them and reports `sku ≠ id` |
| `cert*`, `dataProvenance`, `certificationWorld` | Certification fixture identification | a marked document is **always excluded** (§4.3) |

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
never infers it. **Production has no PostgreSQL tenant and no mapping; none is inferred (§6).**

---

---

## 2. Target PostgreSQL writers (built, unwired)

`functions/src/catalogMaster/`: no Firebase import (static test and runtime load probe), not composed in
`functions/src/eosApi/server.ts` (structural test tied to the writer state, §5.3).

| Module | Commands | Capability (existing ids, `permissionCatalog.ts`) |
|---|---|---|
| `catalogMasterKernel.ts` | one transaction per command: resolved actor `{tenantId, principalId, capabilities}` → capability → active principal + membership → body (reads `FOR UPDATE`) → `eos_policy.audit_events` row → COMMIT; deterministic non-leaking error codes | — |
| `postgresEquipmentModelWriter.ts` | `createEquipmentModel`, `updateEquipmentModel` | `equipment.model.manage` (= Firestore `COMMAND_CAPABILITIES.importEquipmentModel`) |
| `postgresPartMasterWriter.ts` | `createPart`, `updatePart`, `changePartStatus` | `inventory.catalog.manage` / `inventory.catalog.activate` (= `CAP_CATALOG_MANAGE` / `CAP_CATALOG_ACTIVATE`) |
| `catalogRows.ts` | canonical record shape, row mapping, inserts — shared by writers and copy | — |
| `catalogWriterState.ts` | the writer-authority state and its legal transitions (§5.3) | — |

Rules reused, not restated: `validatePart` and `validateEquipmentModel` (pure). Restated with parity tests: the Part
status transition table and updatable-field allowlist. Ids carried verbatim (no remapping). Allowlisted input fields;
`version` is repository authority (create = 1, update = expected + 1). Actor columns are always an EOS Principal id.

**Idempotency is content-addressed.** The Firestore commands are idempotent by *key* (an audit document per key), not
by id. PostgreSQL has no catalog receipts table and must not borrow `eos_commercial.command_receipts`. So: a create
whose row already holds exactly the requested fields replays; an update/status change whose row is at
`expectedVersion + 1` holding exactly the requested result replays; otherwise a deterministic conflict. Whole no-op
updates are `NO_CHANGES` rather than a version bump.

**Gaps (CATALOG_AUTHORITY_GAP):**
1. **Capability vocabulary.** The three ids exist in `permissionCatalog.ts` but not in `eos_policy.capabilities`; no
   PostgreSQL Role can be granted them. Migration 027 registers them (definitions only, no grant).
2. **INTERNAL_PN alias.** Firestore `updatePart` preserves a changed `internalPartNumber` as a `part_aliases` alias
   atomically. `part_aliases` is not in PostgreSQL, so the PostgreSQL `updatePart` **fails closed**
   (`INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE`) on a number change until aliases move.
3. **Dependent Firestore authorities.** `part_aliases`, `part_supplier_items`, `equipment_model_aliases`,
   `equipment_part_compatibility` commands check Part / Equipment Model existence in Firestore
   (`partAliasCommands.ts:101`, `partSupplierItems.ts:307`, `equipmentCompatibility/commands.ts:533,548`). They must move
   or stay frozen with the catalog until their own cutover.
4. **Manufacturers** stay Firestore; `primary_manufacturer_id` is an opaque key (the Firestore command never checked it).

---

## 3. Schema

- **Equipment Model:** `eos_ops.equipment_models` (migration 008, on main) already holds every master field. No migration.
- **Part:** migration **027**, `functions/migrations/1759881600000_catalog-master-descriptive-authority.sql`:
  `ALTER TABLE eos_ops.parts` — the identity table of migration **026**
  (`1759795200000_catalog-part-identity-reference-authority.sql`, PR #1911) — adding the §1.3 columns as
  enums/booleans/text, `validatePart`'s combination rules as CHECKs, the tenant-scoped FK to `equipment_models`,
  `version/updated_by/updated_at`; plus the three capability vocabulary rows. Pre-flight refuses if `eos_ops.parts` has
  rows; Down refuses while records or grants exist. It creates no table and restates nothing of 026.

**Migration order (Owner):** 024 + 025 CRM (`1759622400000`, `1759708800000`); 026 catalog foundation #1911
(`1759795200000`); Employee runtime authority PR(s) take timestamps strictly between `1759795200000` and
`1759881600000` and integrate before this cutover; **027 = this cutover (`1759881600000`)**.

**How it arrived.** 027 extends a table that existed only once #1911 landed, so it was prepared in
`functions/migrations/deferred/` (read by neither node-pg-migrate nor `migrationSchema.mjs`). After #1911 (026) and
#1912 (024/025) merged, this branch merged main normally (no rebase) and moved 027 into `functions/migrations/`. The
Employee runtime authority lane (#1913) holds `1759838400000`, which sorts between 026 and 027. The PostgreSQL suite
migrates from `functions/migrations` with the real runner and runs every Part proof unconditionally; it asserts 026 and
027 by name, never "the latest migration".

---

## 4. Population and reconciliation

```
exportCatalogSnapshot.js (FIREBASE_EXIT_MIGRATION_ONLY, read only) → snapshot.json + snapshot.json.sha256
      → catalogCutover.js census | copy | verify (PostgreSQL, no Firebase module)
```

### 4.1 The migration-only Firestore export (Owner ruling)

`functions/scripts/exportCatalogSnapshot.js` is the one permitted Firebase read of this cutover, marked with the literal
`FIREBASE_EXIT_MIGRATION_ONLY` (first line, and the exported constant). Conditions and how each is held:

| Condition | Enforcement |
|---|---|
| read-only, source-export purpose only | only `db.collection(assertAllowlisted(name)).get()`; no write verb in the code (static test) |
| exact source allowlist `parts`, `equipment_models` | `SOURCE_COLLECTIONS` + `assertAllowlisted` (test: every read goes through it; other names refused) |
| not imported by runtime; not reachable from client or normal API | STRUCTURAL test: no file under `functions/src`, `field-ops-app-vite/src`, `integrations` names it; not in `functions/package.json` `main`/`exports`/`bin`/`scripts`; the copy tool never loads it |
| no scheduled job, no sync | STRUCTURAL test: a workflow may name it only as a path filter, and no workflow naming it has `schedule:` |
| environment-fenced / Certification-fenced / production-fenced | `--projectId` required and registry-declared; `eos-platform-certification` refused; `taylor-parts` refused outright (no production mode) — fence tests prove each refusal precedes loading `firebase-admin` |
| output immutable and checksummed | snapshot and `<snapshot>.sha256` created with `wx` / `0600`, never overwritten (test); `catalogCutover.js` refuses a missing or mismatching checksum in every mode |
| no credentials/secrets in output | output = source project id, export time, documents; credentials come from ADC and are never read into the output |

The Firebase exit guard (`scripts/firebaseExitGuard.mjs`) scans only `functions/src`, `field-ops-app-vite/src` and
`integrations`; `functions/scripts` is where existing Firestore operator tools live, so the guard permits this file and
the structural test above is what keeps it out of the runtime.

**Retirement** (convention: `docs/architecture/firebase-exit-manifest.json` — migrationState `CUTOVER` "the Firebase
path is inert in the live runtime", `RETIRED` "removed from source"; dispositions `RETIRE` "deleted rather than
migrated", `ARCHIVE` "captured as read-only evidence/history"): the exporter is **deleted** in the change that removes
the legacy Firestore catalog writers (§5.2 step 10). The exported snapshot and its `.sha256` are the **archive**, kept
with the cutover evidence outside the repository.

### 4.2 Copy tool

`functions/scripts/catalogCutover.js` — canonicalization = what the Firestore adapters read back (`partFromFirestore`,
`modelFromFirestore`, `readMeta`); a document either would refuse is INVALID and blocks the copy; nothing is repaired.
Timestamps compared at microsecond precision.

| Mode | Behaviour |
|---|---|
| `census` | read only: counts, invalid records, duplicate canonical identities, Part → Equipment Model references missing from the snapshot, status distribution, non-master field counts, `sku ≠ id`, duplicate internal part numbers, cross-kind ids, truncated timestamps, blockers, canonical digest, **excluded Certification fixtures**; target tenant counts |
| `copy` | refuses unless census is copy-ready; ONE transaction + per-tenant advisory lock; inserts absent records verbatim (models before parts) as the cutover **EOS Principal**; identical present → nothing; **different present → `DRIFT_DETECTED`, all rolled back, never overwritten**; tenant rows not in the snapshot → `TARGET_HAS_UNKNOWN_RECORDS`; one `eos_policy.audit_events` row (`catalog.cutover.copy`, digest, counts) only if something was inserted |
| `verify` | READ ONLY: counts, identity-set reconciliation, exact field reconciliation (`--sample N|all`), duplicate identity, dangling references, reference verdict spot-checks with the #1911 adapter's tenant-scoped EXISTS probe, and **no excluded Certification fixture present in the target** |

Every mode prints `evidence`: `snapshotSha256`, `certificationExcluded` (counts, ids, reason), `legacyActorProvenance`.

**Fence** (before `pg`/`lib` load; subprocess-proved): `--environment` declared, not production by role or project id,
`--databaseUrlEnv` named (shared `assertMeasurementTarget`); `EOS_ENVIRONMENT` exactly `nonprod` (shared
`assertNonprodRuntime`); not `platform-certification`; `--tenantKey`, `--snapshot`, `--principalId` for copy; any
`--certificationMarked` option refused. After parsing: checksum must match; snapshot `firebaseProjectId` must equal the
environment's declared project and must not be `taylor-parts`.

### 4.3 Certification exclusion (Owner ruling)

Certification remains frozen. A document is an **explicitly identified Certification fixture** when it carries the
`certificationWorld` marker (`functions/scripts/certificationWorld/manifest.mjs` `MARKER_FIELD`; `parts` and
`equipment_models` are markered groups, only `warehouses` is markerless) or `dataProvenance:
"SYNTHETIC_CERTIFICATION_FACT"`. Such documents are **always excluded** before canonicalization — there is no option
to include them — so they are never copied, never block the copy, and never serve as seed truth (an operational Part
naming a fixture model is a `MISSING_REFERENCES` blocker). Their counts, ids and exclusion reason are in census, copy
and verify evidence; verify fails if any is found in the target. Nothing reads or writes Certification data beyond the
read-only export of the source project, and the Certification project itself is refused.

### 4.4 Legacy creator/updater uid (Owner ruling)

A Firebase uid is not an EOS Principal id. Copied rows carry `created_by` / `updated_by` = the cutover Principal
(`--principalId`, which must be an active principal with an active membership in the target tenant), as does the audit
row's `actor_uid`. Legacy `createdBy` / `updatedBy` uids are kept **only** in `evidence.legacyActorProvenance` in the
tool's JSON output (the reconciliation / import provenance artifact) — never in a business column and never in the
audit payload. Tests assert no fixture uid appears in any `created_by`, `updated_by`, `actor_uid` or audit `after`.

**Nothing has been run against any Firebase project or Render database.**

---

## 5. Controlled freeze window — cutover sequence (Owner ruling)

### 5.1 Sequence

Each step separately authorized and evidenced. **Never two authoritative writer sets.**

1. **Pre-cutover census** — export a read-only snapshot, run `census`; resolve every blocker at the source through the
   existing governed writers (never in the tool). Business operations continue.
2. **FREEZE legacy Firestore catalog writers** — writer state `OPEN/INACTIVE → FROZEN/INACTIVE`, deployed to the
   environment. During the freeze: **no Part Master create / update / status change, no Equipment Model create /
   update, no catalog import write** (`executeDataImport` reaches Parts only through `createPart`).
3. **Export source snapshot** — the post-freeze snapshot + `.sha256`: the exact source of the copy.
4. **Copy once into PostgreSQL** — `copy`.
5. **Verify** — `verify --sample all`; a rerun of `copy` must be `NO_CHANGES`.
6. **Reconcile** — every count, identity, field, exclusion and verdict check reconciled; findings explained.
7. **Activate PostgreSQL writers** — `FROZEN/INACTIVE → FROZEN/ACTIVE`: governed capability grants; the catalogMaster
   commands become the only writer set.
8. **Compose the PostgreSQL catalog authority in Render** — the #1911 reference authority and the catalog writers behind
   the trusted API; client and import writers pointed at it.
9. **Verify governed read/write behaviour** — through the Render API, with real principals.
10. **Disable/remove legacy Firestore writers** — `FROZEN/ACTIVE → RETIRED/ACTIVE`, then delete the legacy writers,
    their callable exports (`functions/src/index.ts:400-402`), the migration-only exporter (§4.1), and shrink
    `docs/architecture/firebase-exit-baseline.json`.
11. **Unfreeze business operations.**

The freeze covers, via the guard: callables `createPart`, `updatePart`, `changePartStatus` (→ `failed-precondition`,
"frozen for the catalog cutover"); Part rows of `executeDataImport`; `runEquipmentCompatibilityCommand`
`importEquipmentModel`; operator scripts `executePartMasterCreate.js`, `generatePartMasterMigrationEvidence.js`; client
paths `partMasterCommandClient.js` and `dataImportClient.js`. Not covered (raw Admin SDK writers, forbidden during the
freeze by procedure): `seedSandboxBaseline.js`; Certification scripts (frozen regardless).

### 5.2 Rollback

- **Before PostgreSQL writes begin** (any failure in steps 3–6, or before step 7 completes): keep the PostgreSQL target
  **inactive**, move the writer state `FROZEN/INACTIVE → OPEN/INACTIVE` (restore/re-enable the legacy writers),
  investigate. **No partial cutover**: the copy is all-or-nothing, and rows already copied stay inert (nothing reads or
  writes them) until a clean rerun.
- **Once PostgreSQL writers accept authoritative writes** (after step 7): **no silent revert to Firestore.** A reverse
  migration is a separate Owner decision and a new design, not a state of the switch.

### 5.3 The writer-state switch matches the ruling

`functions/src/catalogMaster/catalogWriterState.ts` — `CATALOG_WRITER_AUTHORITY = { firestore: "OPEN", postgres:
"INACTIVE" }` (a code constant; changing it is a reviewed commit and deploy).

| Move | From → To | Step |
|---|---|---|
| `FREEZE` | OPEN/INACTIVE → FROZEN/INACTIVE | 2 |
| `ROLLBACK_BEFORE_POSTGRES_WRITES` | FROZEN/INACTIVE → OPEN/INACTIVE | rollback |
| `ACTIVATE_POSTGRES` | FROZEN/INACTIVE → FROZEN/ACTIVE | 7 |
| `RETIRE_FIRESTORE` | FROZEN/ACTIVE → RETIRED/ACTIVE | 10 |

Incoherent: `OPEN/ACTIVE` (two authoritative writer sets), `RETIRED/INACTIVE` (none). Every other move is refused,
including any move out of `ACTIVE` and any move back to `OPEN` once `ACTIVE`. **Freeze ≠ removal:** `FROZEN` keeps the
legacy writers in source, refusing with `FIRESTORE_CATALOG_WRITER_FROZEN`; `RETIRED` refuses with
`FIRESTORE_CATALOG_WRITER_RETIRED` and is the precondition for deleting them. The re-enable path (`ROLLBACK…`) exists
only from `FROZEN/INACTIVE`. Tests: committed state coherent; the four moves exactly; all others refused; each legacy
writer calls the guard first; while `postgres` is `INACTIVE` nothing outside catalogMaster imports the PostgreSQL writers.

---

## 6. Production

**No production catalog mutation is authorized.** Both tools refuse production (environment role, project id
`taylor-parts`, snapshot source), and neither infers a tenant: the target tenant is always the explicit `--tenantKey`;
no production tenant mapping exists or is assumed.

Production prerequisites, each a separate Owner authorization before any production step:
1. **Source census** of the production Firebase project's `parts` / `equipment_models` (a production data read):
   counts, invalid records, duplicates, missing references, Certification markers, `sku ≠ id`, duplicate internal part
   numbers.
2. **Target tenant mapping**: a production PostgreSQL tenant created by its own governed bootstrap, and the Owner's
   statement of which Firebase project's catalog belongs to which tenant.
3. **Counts and identity reconciliation** plan and acceptance criteria for that tenant.
4. **Owner cutover authorization** for the §5 sequence in production, including the freeze window.
5. A production mode for the tools, added only under that authorization (none exists today).

Stop conditions in any environment: a census blocker; verify not reconciled; a post-freeze copy rerun not `NO_CHANGES`;
a Firestore catalog write observed after the freeze; unexplained `sku ≠ id` or duplicate internal part numbers.

---

## 7. Integration order and dependencies

1. CRM 024 + 025 (#1912) and catalog foundation 026 (#1911, `1759795200000`).
2. Employee runtime authority PR(s) (timestamps between 026 and 027).
3. Done: #1911 and #1912 are on main; this branch **merged main normally** (never a rebase) and moved 027 into
   `functions/migrations/`; the Part proofs run unconditionally.
4. After a reconciled verify in an authorized freeze window: steps 7–9 (writer activation, Render composition of the
   reference authority — CATALOG_CUTOVER_TAIL — and the catalog writers).
5. `functions/package.json` / workflow edits here are append-only next to lines #1911 and #1912 also touch.

---

## 8. Unresolved facts

- **Live data shape** of `eos-platform-sandbox` (counts, invalid records, `sku ≠ id`, duplicate internal part numbers,
  Certification fixtures) is unmeasured until an authorized export + census.
- **Production tenancy** does not exist (§6).
- **`part_aliases`** and the dependent alias / supplier item / compatibility authorities (§2 gaps 2–3) are not in
  PostgreSQL; their freeze or move must be scheduled with the catalog window.

Resolved by Owner ruling 2026-09-14: controlled freeze window (§5); Certification exclusion (§4.3); legacy creator uid
(§4.4); migration-only snapshot export (§4.1); production fence (§6).

---

## 9. Proof

- `functions/test/catalogMaster.test.mjs` (offline, `test:adminPolicy`): capability ids and rule parity; no Firebase in
  `src/catalogMaster` (static + runtime probe) or the copy tool; exporter marker, allowlist, exclusive checksummed
  write, structural no-runtime-import; writer-state coherence, transitions, freeze vs retire, guard placement, no
  PostgreSQL writer composition while INACTIVE; census (clean, duplicates, invalid, missing references, Certification
  exclusion, no inclusion path, legacy uid provenance, non-blocking findings, timestamps); migration 027 applied after 026, pinned by name.
- `functions/test/catalogCutoverPostgres.test.mjs` (`test:adminPolicyPostgres`): Equipment Model writer; Part writer
  (unconditional); copy exact ids/versions/timestamps as the cutover Principal; Certification fixtures never land and are
  listed; no uid in any actor column or audit payload; non-member principal refused; verify all fields, verdicts, and
  fixture-in-target failure; rerun no-op; drift refused; unknown target refused; tenant scoping; CLI end to end
  (checksum, evidence, refused inclusion flag); 027 Down refusal; the #1911 reference authority's
  FOUND / WRONG_KIND / NOT_FOUND over the populated copy, agreeing with verify's probe.
- `functions/test/operatorScriptEnvironmentFence.test.mjs`: 14 refusals for the two scripts, each before any client library loads.
- Negative controls (each red, then restored byte-identically) are listed in the PR description.
