# Firebase Exit Matrix — integrated BUSINESS_RUNTIME census

**Lane** P2-B1 (evidence lane) · **Tree** integrated head `d104cf49` (all 32 Wave-1 lanes merged
plus the `eos_finance` ruling) · **Date** 2026-09-12

This is the single definitive Firebase Exit Matrix for the integrated tree. It is an **evidence
document**: it classifies and records, and it retires nothing. No source, baseline, manifest, Rules,
index or deployment artifact was changed to produce it.

> **Scope fence.** Firebase Auth / session identity is **transitional and explicitly out of scope**.
> Nothing recommended below crosses into it. Confirmed: the only identity dependency on the target
> runtime path is `functions/src/eosApi/server.ts:105-108`, a lazy `import("firebase-admin")` whose
> sole use is `app.auth().verifyIdToken(bearerToken)` — exactly the transitional token step the
> target architecture names, and nothing more.

Target runtime: `Browser → Vercel → transitional Firebase Auth token → Render EOS API → EOS
authorization/workflow/business authority → PostgreSQL`. Firebase may **not** remain the business
authority or the data plane.

---

## 1. Method

Two independent passes, both re-run against this tree (not against `main`):

1. **Guard scan.** `scripts/firebaseExitGuard.mjs`'s own `scanTree()` was imported and dumped
   directly, so the category membership in this document is the guard's, not a re-implementation.
2. **Repo-wide import extraction.** A separate walker over every `.js/.jsx/.mjs/.cjs/.ts/.tsx` file
   in the repository (skipping only `.git` and `node_modules` — deliberately **not** `lib`, `dist`,
   `build` or `coverage`, which collide by basename with real source; `functions/src/coverage/` is
   real business source and an earlier draft of this census under-counted by 2 files by skipping it)
   capturing every import/require/dynamic-import specifier matching `firebase*`, `@firebase*` or
   `@google-cloud/firestore`.

Every claim below was verified in this tree. Claims that could not be verified are marked
**UNPROVEN** in §8 rather than repeated.

### Classification rule actually applied

| Category | Rule |
|---|---|
| `IDENTITY_ONLY` | File's only Firebase specifiers are `firebase/auth`, `firebase/app`, `firebase-admin/auth`, `firebase-admin/app`, or bare `firebase-admin` used solely for `verifyIdToken`. |
| `BUSINESS_RUNTIME` | File is deployed app source under `field-ops-app-vite/src` or `functions/src`, **or** an operator CLI that writes live business documents, and carries a business specifier (`firebase/firestore`, `firebase/functions`, `firebase-admin/firestore`, `firebase-admin/storage`, `firebase-functions[/v1|/v2…]`). |
| `MIGRATION_ONLY` | Backfill / migrate / repair / dual-read-parity tooling, including `*/migration/*` modules inside `functions/src`. |
| `TEST_ONLY` | Under a `test/` directory, named `*.test.*`, or a `.claude/skills` emulator harness. |
| `FIXTURE_ONLY` | Seed / demo / `certificationWorld` world-builders. |
| `HISTORICAL_DOCUMENTATION` | Mentions Firebase in prose or as a string literal but imports no Firebase module. |
| `DEAD_RETIREABLE` | No live caller, proven by exhaustive occurrence search **plus** positive evidence of the replacement (§5). |
| `UNKNOWN` | None remain. |

---

## 2. Classification counts

**2,206 files** in the tree reference Firebase by any spelling. Of those, **605** carry a real
Firebase SDK import specifier; the remaining **1,601** mention it only in prose or string literals.

| Category | Files | Notes |
|---:|---:|---|
| `BUSINESS_RUNTIME` | **295** | 95 frontend, 193 `functions/src`, 7 operator CLIs |
| `TEST_ONLY` | **198** | incl. `scripts/syncAccessContracts.mjs` (see below) |
| `FIXTURE_ONLY` | **58** | 46 under `functions/scripts/certificationWorld/` |
| `MIGRATION_ONLY` | **26** | incl. `functions/src/adminPolicy/migration/firestorePolicyParityHarness.ts` |
| `IDENTITY_ONLY` | **24** | out of scope for this fence |
| `DEAD_RETIREABLE` | **4** | §5 |
| `UNKNOWN` | **0** | — |
| **SDK-import subtotal** | **605** | |
| `HISTORICAL_DOCUMENTATION` | **1,601** | prose/string-literal mentions only |
| **Total** | **2,206** | |

`scripts/syncAccessContracts.mjs` classifies as `TEST_ONLY`, not `BUSINESS_RUNTIME`: its
`firebase-admin/firestore` and `firebase/firestore` occurrences are **quoted string literals** in a
declared substitution table (`scripts/syncAccessContracts.mjs:117-118`), not imports. It is the CI
parity generator that keeps the two `access/parityFixtures.ts` copies in sync.

### 2.1 The 60 type-only entries — a materially smaller real surface

**60 of the 295 `BUSINESS_RUNTIME` files reference Firebase only through `import type`**, which
TypeScript erases at compile time. They carry **zero runtime Firebase dependency**; the reference is
a compile-time type binding (`Timestamp`, `Firestore`, `Transaction`, `DocumentReference`).

| Guard category | Baseline entries | Of which type-only |
|---|---:|---:|
| `server.firebase_admin_firestore` | 184 | **58** |
| `frontend.firestore_client` | 55 | **3** |
| `server.firebase_functions_server` | 72 | 0 |
| `frontend.firebase_functions_client` | 55 | 0 |

Examples verified by direct inspection: `functions/src/types/workOrder.ts:13`,
`functions/src/cycleCount/cycleCountCommand.ts:30`,
`functions/src/supplierMaster/supplierMasterRepository.ts:7`,
`functions/src/access/operationalRoleContext.ts:67`,
`field-ops-app-vite/src/access/parityFixtures.ts:30`. Counter-checked against a genuine value
import: `functions/src/createWorkOrder.ts:9` is
`import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore"`
— correctly classified as a runtime dependency despite its inline `type` modifiers.

The guard is **right** to fence these (it is documented as deliberately matching `import type`, and
that is the fail-closed direction — a type import is one keystroke from a value import). But for
migration planning they are **tranche 1, mechanical**: retiring them is a type-swap to a
locally-declared or `pg`-derived type, with no behaviour change and no data-plane work.

**The real runtime Firebase business surface is 235 files, not 295.**

---

## 3. The live Firebase business plane

### 3.1 Firestore Security Rules — live business authorization

`firestore.rules` (1,876 lines) is deployed to the **production** project `taylor-parts`
(`sb-evidence/deploy-output.txt`: `✔ firestore: released rules firestore.rules to cloud.firestore`,
`Deploying to 'taylor-parts'`). Verified counts in this tree: **56 `match /` blocks** (1 root scope +
55 collection blocks) and **95 `allow` statements**.

- **22 collections client-readable**, incl. `fieldops_jobs`, `fieldops_wos`, `employees`, `users`,
  `parts`, `warehouses`, `suppliers`, `supplier_catalog`, `purchase_orders`, `accounts`, `locations`,
  `equipment`, `contacts`, `transfer_orders`, `trucks`, `inventory_transactions`, `reorder_requests`.
- **9 collections client-writable** across 13 grants: `fieldops_jobs` (create :366, update :381),
  `fieldops_technicians` (:407, :418), `reorder_requests` (**update :763**, the largest client-write
  surface in the file — a multi-branch status state machine spanning :763–:1001),
  `reorder_purchase_order_voids` (:1108), `inventory_actions` (create :1156), `accounts` (:1332,
  :1335), `locations` (:1343), `equipment` (create :1508, update :1542), `contacts` (:1557).
- **No client delete is permitted anywhere** — every `delete` grant resolves to `if false`.
- **33 collections fully retired** to `allow read, write: if false;`.
- `field-ops-app-vite/firestore.rules` is a **byte-identical** second copy (both md5
  `e10bc046d30e337ef8e95f3d5f96ee0f`, verified).

**Classification: `BUSINESS_RUNTIME`.** This is Firebase acting as the business authorization plane,
which the target architecture forbids. It cannot be retired before the corresponding EOS API
endpoints exist.

`storage.rules` is **fully closed to clients** (`storage.rules:21-22`,
`allow read, write: if false;` under `match /{allPaths=**}`). Inbound-email attachments are reached
only through the `getInboundWorkAttachment` callable using the Admin SDK, which bypasses Rules by
design. Classification: `BUSINESS_RUNTIME` (server-side object custody), but it presents **no client
surface**.

### 3.2 Composite indexes

`firestore.indexes.json`: **44 composite indexes** over **20 collection groups** (`fieldOverrides`
empty). Largest: `fieldops_wos` (9), `accounts` (5), `employees` (5), `equipment` (3), `parts` (3),
`sales_orders` (3), `trucks` (3).

Six collection groups carry indexes but are **client-denied** in Rules — `sales_orders` (3),
`opportunities`, `auditEvents`, `technician_blocked_time`, `manufacturers`, `serialized_assets`.
Those indexes serve **Admin-SDK / callable** queries only. `serialized_assets` has an index and
**no rules block at all**, so it is reachable only via the Admin SDK (Firestore default-deny).

Classification: `BUSINESS_RUNTIME` (they are the physical query plan of the business data plane).

### 3.3 Deployed Cloud Functions

`functions/src/index.ts` (654 lines) exports **~143 callables/triggers** (the count recorded by
`scripts/sandboxDeployableFunctions.mjs`, which reads the compiled `functions/lib/index.js`
`__endpoint` manifest rather than parsing source — the file explicitly documents that a source
parser finds only 55 of the 143 because most exports are multi-line blocks).

**`EXPORT != DEPLOY` is a production-project statement, not a global one.** A general
`platform-sandbox` refresh deploys *every* applicable function; exactly **one** is excluded,
`interpretWorkOrderReadinessContext`, because platform-sandbox intentionally lacks its five
`KEYSTONE_*` secrets. So for reachability purposes **an exported callable is a live network-reachable
surface in the sandbox estate**, whether or not the frontend calls it.

This is the single most important correction to any "no caller ⇒ dead" reasoning on the server side:
a callable with no frontend caller is still deployed, still authenticated, and still able to write
the business data plane.

### 3.4 The Render EOS API — what actually exists today

Entry point chain, verified: `render.yaml` `startCommand: npm start` → `functions/package.json`
`"start": "node scripts/serveEosApi.mjs"` → `functions/scripts/serveEosApi.mjs:12` imports
`../lib/eosApi/server.js` (compiled from `functions/src/eosApi/server.ts`).

**Full import closure of `functions/src/eosApi/server.ts` is 15 files, and its only Firebase
specifier is the identity one** (`firebase-admin`, `verifyIdToken`). Traced, not assumed.

Route surface actually exposed: **`/health`, `/admin/policy/*`, `/operations/inventory`** (whose only
operation is `resolveMyCapabilities`, `functions/src/eosOps/eosOpsHttp.ts:77`).

The Postgres authorities exist as repositories and migrations — 18 migrations under
`functions/migrations/` establishing `eos_policy`, `eos_ops` and `eos_finance`, and repositories
under `functions/src/eosOps/` (12), `functions/src/eosCommercial/` (2) and
`functions/src/adminPolicy/` — and those directories are **Firebase-free on the business plane**
(verified: the only Firebase strings in `eosOps`/`eosCommercial`/`eosApi` are the identity lines in
`server.ts` plus one explanatory comment in `eosOps/migration/supplierCatalogMigration.ts:118`).

**But they are not reachable from a browser.** There is no EOS API endpoint for work orders, parts,
inventory reads, equipment, commercial or finance objects. This is the governing blocker: it is why
essentially every frontend `BUSINESS_RUNTIME` row below carries the same entry.

---

## 4. BUSINESS_RUNTIME dependency records

Recorded at **domain** granularity — the unit the manifest itself defines
(`domainMigrationWaveModel`: "the first path segment beneath `field-ops-app-vite/src` or
`functions/src`") and the unit its wave model groups. File-level membership is the guard's own
`scanTree()` output and is reproducible with
`node -e "import('./scripts/firebaseExitGuard.mjs').then(g=>…scanTree())"`.

Common values, stated once rather than repeated in every row:

- **Current authority** — Firestore (documents + Security Rules) via deployed Cloud Functions and,
  for 22 collections, direct client reads.
- **Blocks nonprod?** — **No** for every row. The nonprod estate (`eos-platform-sandbox` +
  `eos-api-nonprod` + `eos-policy-nonprod`) already stands up and the guard is green; Firebase
  business runtime is *tolerated* by the baseline floor, so nothing here prevents a nonprod deploy.
- **Blocks cutover?** — **Yes** for every row. Firebase may not remain the business authority, so
  every row must reach `RETIRED` before cutover is complete.

### 4.1 Frontend — `field-ops-app-vite/src` (95 files; 110 guard entries across two categories)

| Domain | Files (FS / Fn) | Firebase service | Object / workflow | R/W | Live caller | EOS replacement | Blocker | Tranche |
|---|---|---|---|---|---|---|---|---|
| `hooks` | 26 / 2 | Firestore client | work orders, technicians, equipment, assigned jobs, reference reads | **R** | route components under `src/modules/**` | none yet | no EOS read endpoint | 3 |
| `services` | 5 / 34 | Functions callables + Firestore | the callable clients for every governed write verb | **R+W** | hooks + `src/modules/**` | none yet | no EOS write endpoint | 3 |
| `access` | 8 / 14 | Firestore + callables | permission catalog, effective access, role/claims reads | **R** | `AuthContext`, `operationalContext` | `adminPolicy` on `eos_policy` (**exists**, `/admin/policy`) | frontend not re-pointed | **2** |
| `domain` | 6 / 2 | Firestore | inventory analytics, equipment writes, list views | **R+W** | `src/modules/**` | partial (`eos_ops`) | no EOS endpoint | 3 |
| `metadata` | 2 / 2 | Firestore + callables | the object-list metadata runtime (`firestoreListSource.js`, `callableListSource.js`) | **R** | every metadata-driven list route | none yet | no EOS list endpoint | 4 |
| `firebase` | 2 / 1 | app/firestore/functions init | the SDK singletons (`db`, `functions`) | — | everything above | — | terminal: retires last | 5 |
| `types` | 2 / 0 | **type-only** | `Timestamp` in shared types | — | compile-time only | local type decl | none — mechanical | **1** |
| `analytics`, `auth`, `lib`, `modules` | 4 / 0 | Firestore | analytics reads, auth-adjacent reads, `lib/firebaseSafe.js` | **R** | live routes | none yet | no EOS endpoint | 3 |

Representative live-caller chain, **traced end-to-end in this tree** (and the case the program was
warned about):

> `src/App.jsx:36` `lazy(() => import("./modules/operations/Operations"))`
> → `src/modules/operations/Operations.jsx:12` imports `fetchSupplierCatalog`, calls it at **`:96`**
> → `src/services/operationsQueries.ts:175` `fetchSupplierCatalog = () => listCollection(SUPPLIER_CATALOG_COLLECTION)`
> → `src/services/operationsQueries.ts:85-86` `getDocs(collection(db, name))`
> → authorized by `firestore.rules:1261` `allow read: if isAdminOrDispatcher();`
> → seeded by `functions/scripts/seedOperationsDemoData.js`.

`supplier_catalog` is **read-live**, confirmed independently here. (The line numbers circulated
earlier in the program — `Operations.jsx:81`, `operationsQueries.ts:83` — do not match this
integrated tree; the correct integrated-tree citations are `Operations.jsx:96` and
`operationsQueries.ts:175` → `:85`. The *conclusion* was right; the citations had drifted.)

### 4.2 Server — `functions/src` (193 files; 256 guard entries across two categories)

Domains carrying `firebase-admin/firestore` persistence and/or `firebase-functions` triggers and
callables. "PG" = a PostgreSQL authority already exists in `functions/migrations` +
`functions/src/eosOps|eosCommercial|adminPolicy`; it is **not** exposed over the EOS API unless noted.

| Domain | admin/firestore (of which type-only) | firebase-functions | Object / workflow | R/W | Live caller | EOS replacement | Tranche |
|---|---|---|---|---|---|---|---|
| `inboundWork` | 12 (4) | 3 | inbound email → work, attachment custody, provider credential vault | R+W | deployed callables | none | 4 |
| `(root)` | 11 (0) | 7 | `createWorkOrder`, `transitionWorkOrder`, `updateWorkOrderExecutionData`, `completeAssignedJob`, inventory analytics/effects | R+W | deployed callables; frontend `services/*` | partial (WO replay) | 4 |
| `cycleCount` | 11 (6) | 2 | cycle-count sheets and lines | R+W | deployed callables | **PG** `eosOps/cycleCountRepository.ts` | **2** |
| `partMaster` | 11 (2) | 5 | parts, aliases, supplier items, manufacturers | R+W | deployed callables | none | 4 |
| `access` | 10 (2) | 4 | permissions, roles, roleAssignments, auditEvents, claims | R+W | deployed callables; every authz check | **PG** `adminPolicy` (**exposed**) | **2** |
| `inventoryLocation` | 9 (6) | 3 | bins, put-away, stock relocation | R+W | deployed callables | **PG** `warehouseBinRepository.ts` | **2** |
| `inventoryReceiving` | 9 (5) | 1 | receiving orders, PO progress | R+W | deployed callables | partial (`purchasingRepository`) | 3 |
| `equipmentCompatibility` | 8 (2) | 1 | equipment models, compatibility, sources | R+W | deployed callables | none | 4 |
| `finance` | 8 (0) | 6 | invoices, payments, applications, refunds, adjustments | R+W | deployed callables | **PG** `eos_finance` (7 objects) | **2** |
| `inventoryTransfer` | 8 (4) | 1 | transfer orders | R+W | deployed callables | partial | 3 |
| `dataImport` | 6 (1) | 1 | import jobs, opening balances, imported service history | **W** | deployed callables | n/a (migration surface) | 3 |
| `supplierMaster` | 6 (3) | 1 | suppliers, supplier catalog | R+W | deployed callables | **PG** `supplierCatalogRepository.ts` | **2** |
| `warehouseGovernance` | 6 (1) | 0 | warehouses, receiving-location options | R+W | called by receiving/transfer | **PG** `warehouseBinRepository.ts` | **2** |
| `opportunity` | 5 (0) | 4 | opportunities, WON→SO | R+W | deployed callables; `callableListSource.js` | **PG** `eosCommercial` (partial) | 3 |
| `salesAgreement` | 5 (1) | 4 | agreements, product-reference search | R+W | deployed callables | partial | 3 |
| `salesOrder` | 5 (0) | 3 | sales orders, index/account reads | R+W | deployed callables; `callableListSource.js` | **PG** `eosCommercial` (partial) | 3 |
| `types` | 5 (5) | 0 | shared Firestore types | — | compile-time only | local type decl | **1** |
| `equipmentInstall` | 4 (2) | 1 | installed-asset install/uninstall | R+W | deployed callables | **PG** `equipmentCustody.ts` | **2** |
| `scheduling` | 4 (2) | 2 | availability, blocked time, reschedule/reassign | R+W | deployed callables | none | 4 |
| `serializedAsset` | 4 (2) | 2 | serialized-asset acquire, available-equipment read | R+W | deployed callables | **PG** operating-company + serialized custody | **2** |
| `truckRegistry` | 4 (1) | 1 | trucks, mobile locations, driver assignment | R+W | deployed callables | **PG** `truckFleetRepository.ts` | **2** |
| `inventoryLedger` | 3 (2) | 0 | movement ledger, bin-conversion report | R+W | called by inventory domains | partial | 3 |
| `performance` | 3 (1) | 1 | performance goals | R+W | deployed callables | none | 4 |
| `reorderRequest` | 3 (1) | 1 | reorder requests + purchase orders | R+W | deployed callables **and direct client writes** (`firestore.rules:763`) | none | 4 |
| `workOrderConsumption` | 3 (2) | 2 | consumption source selection, physical consumption | R+W | deployed callables | partial (`inventoryCommitmentRepository`) | 3 |
| `account`, `coverage`, `crmActivity`, `fulfillment`, `inventory`, `inventoryReturns`, `reporting`, `workOrderInstall`, `workOrderLabor` | 2 each (7 total) | 1–2 each | accounts, coverage assignments, CRM activity, allocation, inventory service, returns, report definitions/execution, WO install/labor | R+W | deployed callables | mixed | 3–4 |
| `adminPolicy` | 1 (0) | 0 | **`migration/firestorePolicyParityHarness.ts`** | R | migration verification only | — | `MIGRATION_ONLY`, not business runtime |
| `ai` | 1 (0) | 1 | `workOrderReadinessContext` (private-AI) | R | `interpretWorkOrderReadinessContext` — **the one function excluded from sandbox refresh** | none | 4 |
| `workOrderPartsPlan` | 1 (0) | 1 | `setWorkOrderPartsPlan` | W | deployed; capability `active:false` | none | 4 |

`functions/src/adminPolicy/migration/firestorePolicyParityHarness.ts` is the single `adminPolicy`
entry and is **`MIGRATION_ONLY`** — a Firestore→Postgres dual-read parity harness — even though the
guard necessarily counts it under `server.firebase_admin_firestore`. The rest of `adminPolicy` is
Firebase-free (`adminPolicyHttp.ts:15` documents that `verifyToken` is a parameter precisely so the
module imports no `firebase-admin`).

### 4.3 Operator CLIs that write the live business plane (7 files)

These are **not** deployed app code, but they are a live write path into Firestore business
documents, invoked by documented operational procedure. They are `BUSINESS_RUNTIME`, not tooling.

| Path | Service | Object | R/W | Live caller | Tranche |
|---|---|---|---|---|---|
| `functions/scripts/provisionEmployeeAccess.js` | `firebase-admin/firestore` + `/auth` | `employees`, `users` (`:341`, `:382`, `:613-614`) | **W** | the `onboard-employee` skill — a documented, Owner-gated procedure | 3 |
| `functions/scripts/assignTechnicianToUser.js` | admin/firestore | `users`, `fieldops_technicians` | **W** | operator runbook | 3 |
| `functions/scripts/assignWarehouseRootCompany.js` | admin/firestore | `warehouses` | **W** | operator runbook | 3 |
| `functions/scripts/warehouseAssignmentProvisioningCli.js` | admin/firestore | `employees`, `warehouses` | **W** | operator runbook | 3 |
| `functions/scripts/bootstrapCompatibilityAdmin.js` | admin/firestore + auth | `roleAssignments` | **W** | bootstrap procedure | 3 |
| `functions/scripts/executePartMasterCreate.js` | admin/firestore | `parts` | **W** | Part Master import procedure | 3 |
| `functions/scripts/operatorAccessCommand.js` | admin/firestore | access/claims | **W** | operator runbook | 3 |

`functions/scripts/generatePasswordResetLink.js` and `activateSandboxPersonas.js` are
`IDENTITY_ONLY`/`FIXTURE_ONLY` respectively and are **not** counted here.

### 4.4 Retirement tranches

| Tranche | Content | Precondition |
|---|---|---|
| **1** | The 60 `import type` entries | none — mechanical type-swap, no behaviour change |
| **2** | Domains with a Postgres authority already built: `access`, `cycleCount`, `inventoryLocation`, `warehouseGovernance`, `supplierMaster`, `finance`, `truckRegistry`, `equipmentInstall`, `serializedAsset` | **EOS API endpoints must be exposed first** — today only `/admin/policy` and `/operations/inventory` exist |
| **3** | Domains with partial Postgres coverage + the operator CLIs | schema completion |
| **4** | Domains with no Postgres authority: `partMaster`, `scheduling`, `reporting`, `inboundWork`, `equipmentCompatibility`, `reorderRequest`, `performance`, `ai`, the root work-order engine | authority design not started |
| **5** | `firestore.rules`, `firestore.indexes.json`, `src/firebase/*` singletons | everything above retired |

---

## 5. `DEAD_RETIREABLE` — 4 entries, with unreachability proof

Every one of these was proven by an **exhaustive occurrence search** over `field-ops-app-vite/src`
(not merely an import search), plus **positive identification of the replacement**. No static
importer alone was accepted as proof.

### 5.1 `field-ops-app-vite/src/services/completionService.js` — `frontend.firebase_functions_client`

- Every occurrence of the string `completionService` in `src/` is a **comment**: the only hit is
  `src/services/receivingCallableClient.js:4`.
- **Replacement identified**: `src/modules/mobile/FieldMode.jsx` completes via
  `transitionWorkOrder` (`:4`) and `captureComplete` from `offline/technicianIntentCapture.js`
  (`:17`, used at `:120-127`). It does not import `completionService` or `completionFlow`.
- **Coupling that must move with it**: `field-ops-app-vite/test/completionFlow.test.mjs:258`
  `readFileSync`s this file as **text** and asserts it performs no direct Firestore write. The test
  must be updated in the same change.
- **Does not retire the server callable.** `completeAssignedJob` remains exported from
  `functions/src/index.ts` and therefore deployed.

### 5.2 `field-ops-app-vite/src/hooks/useInstalledEquipmentPage.js` — `frontend.firestore_client`

- All four remaining occurrences in `src/` are comments (`CustomerEquipment.jsx:49`,
  `truckRegistryQueries.js:3`, `metadata/listViewDefinition.js:28`,
  `domain/installedEquipmentListView.js:6`).
- **Replacement identified, and stated in-source**: `src/modules/equipment/CustomerEquipment.jsx`
  documents that the surface "now has exactly one read, the metadata runtime's, and **the old paging
  hook is no longer called from here**."
- **Coupling**: `field-ops-app-vite/test/useInstalledEquipmentPage.test.jsx` imports it. Note this is
  a `.test.jsx` vitest suite — `node --test` cannot run it.

### 5.3 / 5.4 `accountOpportunitiesReadCallableClient.js` and `accountSalesOrdersReadCallableClient.js` — `frontend.firebase_functions_client`

Each sits at the head of a 3-file orphan chain:

```
AccountOpportunitiesSection.jsx → useAccountOpportunities.js → accountOpportunitiesReadCallableClient.js
AccountSalesOrdersSection.jsx   → useAccountSalesOrders.js   → accountSalesOrdersReadCallableClient.js
```

- The two `*Section.jsx` components have **no importer of any kind** in `src/` — every remaining
  occurrence is a comment.
- **Replacement identified, and stated in-source**: `src/metadata/definitions/accountPage.js:182-183`
  records "the reason this regressed silently when these replaced `AccountOpportunitiesSection.jsx`
  (`<h4>Opportunities</h4>`) and `AccountSalesOrdersSection.jsx` (`<h4>Sales Orders</h4>`)".
- **The server callables are NOT dead.** `src/metadata/callableListSource.js:31-38` invokes the same
  callables through its own lazy `import("firebase/functions")` + `httpsCallable`, and its header
  comment states explicitly that it "is not a second way to call the same function". So
  `listOpportunitiesForAccount` and `listSalesOrdersForAccount` remain **live** — only the two
  request-shaped client modules are dead.
- **Coupling**: `field-ops-app-vite/test/accountOpportunitiesAndSalesOrdersSections.test.jsx` still
  renders both components.

**Net effect if retired (a later lane's decision, not this one's):** 4 baseline entries removed —
`frontend.firestore_client` 55→54, `frontend.firebase_functions_client` 55→52. Retiring them
requires updating three test files in the same change, and the baseline must shrink in lockstep or
the guard's stale-entry check fails.

### 5.5 Explicitly NOT dead

`field-ops-app-vite/src/access/parityFixtures.ts` has **no importer anywhere** in
`field-ops-app-vite`, and a naive reading would call it dead. It is not: it is a **generated
byte-mirror** of `functions/src/access/parityFixtures.ts`, produced and enforced by
`scripts/syncAccessContracts.mjs` (`:64`, `:115-118`) under parity CI, and the functions-side
original is consumed by `functions/test/shadowParityHarness.test.mjs:18`. Deleting it would break
the parity guard. Its Firebase reference is additionally **type-only**
(`parityFixtures.ts:30`, `import type { Timestamp } from "firebase/firestore"`), and that import is
the one *declared substitution* the sync tool makes (`firebase-admin/firestore` → `firebase/firestore`).

---

## 6. Manifest ↔ guard reconciliation

**Answer: the manifest and the guard agree exactly, and the prior lane's 8/4 split is CORRECT — but
its wording needs one correction about who made the change.**

### 6.1 They agree

`docs/architecture/firebase-exit-manifest.json` lists **12** `BUSINESS_RUNTIME` `baselineKeys`. The
guard's `FORBIDDEN_CATEGORIES` is `SCAN_ROOTS.flatMap(... BUSINESS_RUNTIME_CLASSES ...)` = 3 roots ×
4 classes = **12** keys. Dumped from the guard itself, the two lists are identical:

```
frontend.{firestore_client, firebase_functions_client, firebase_admin_firestore, firebase_functions_server}
server.{firestore_client, firebase_functions_client, firebase_admin_firestore, firebase_functions_server}
integrations.{firestore_client, firebase_functions_client, firebase_admin_firestore, firebase_functions_server}
```

Live scan vs committed baseline, exact match in both directions (0 violations, 0 stale entries):

| Key | Scan | Baseline |
|---|---:|---:|
| `frontend.firestore_client` | 55 | 55 |
| `frontend.firebase_functions_client` | 55 | 55 |
| `server.firebase_admin_firestore` | 184 | 184 |
| `server.firebase_functions_server` | 72 | 72 |
| the other **8** | **0** | absent ⇒ empty set |

### 6.2 Verifying the 8-doc / 4-authority split

Verified against `f867ff5c^` (the pre-C28 guard), read directly — not taken from a summary.

- Pre-C28 `FORBIDDEN_CATEGORIES` had **4** entries: `frontend.firestore_client` and
  `frontend.firebase_functions_client` rooted at `field-ops-app-vite/src`;
  `server.firebase_admin_firestore` and `server.firebase_functions_server` rooted at `functions/src`.
- Pre-C28 **`classifyFile(text)` took no path argument** and looped over *all* `FORBIDDEN_CATEGORIES`
  for every file from every root. `root` was used only to seed `scanRoots` for the walk. So a
  `functions/src` file importing `firebase/firestore` was recorded under **`frontend.firestore_client`**
  — mis-attributed, but caught (that path is not in the frontend baseline list, so it was a
  violation). Symmetrically for a frontend file importing `firebase-admin/firestore`.

**Therefore the 4 cross-keys inside the two original roots** — `frontend.firebase_admin_firestore`,
`frontend.firebase_functions_server`, `server.firestore_client`, `server.firebase_functions_client` —
**were already enforced before C28**, under a wrong key name. Naming them in the manifest changes
attribution and legibility, not authority. Together with the 4 keys the manifest already listed,
that is **8 keys = documentation change. Confirmed.**

**The 4 `integrations.*` keys are a genuine authority expansion. Confirmed, and doubly so:**

1. `integrations` was **not a scan root** pre-C28 — `scanRoots` is derived from the categories'
   `root` values, and no category named it. The directory was never walked.
2. Pre-C28 `SCAN_EXTENSIONS = [".js",".jsx",".ts",".tsx"]` — **no `.mjs`**. Every file under
   `integrations/chatgpt-eos-intake/` is `.mjs`, so even had the root been walked, no file would
   have been read.

A module there could have imported `firebase-admin/firestore` and the ratchet would never have seen
it. That is a real new fence over a real business-runtime boundary (the ChatGPT/MCP intake service).

C28's claim that the new behaviour is a **strict superset** also holds: for every (file, class) pair
covered before, a violation is still raised post-C28 — only the key it is reported under changes —
and `integrations` + `.mjs` are net-new coverage. Nothing lost.

### 6.3 Current state of the `integrations` root

`integrations/chatgpt-eos-intake/` contains **zero** Firebase imports (verified independently of the
guard). The only two occurrences of the word are **regexes in its own boundary test**,
`integrations/chatgpt-eos-intake/test/boundary.test.mjs:37-38`, which forbid exactly these imports.
So the four `integrations.*` ratchets are pinned at zero and are additionally defended locally.

### 6.4 One wording correction

The manifest widening from 4 keys to 12 was **not** made by C28. C28 (`f867ff5c`) changed only
`scripts/firebaseExitGuard.mjs`. The manifest was widened in the integration commit `8dfcd006`,
whose message states it "widened the firebase-exit manifest's BUSINESS_RUNTIME key list from 4 to
the 12 the guard actually fences". Between `f867ff5c` and `8dfcd006` the guard fenced 12 categories
while the manifest documented 4. That window is closed; the split itself is unaffected.

---

## 7. What blocks nonprod vs what blocks cutover

### Blocks nonprod: **nothing in this matrix**

- The guard is green on the integrated tree: `0` violations, `0` stale entries, `0` ratchet
  additions.
- The baseline is a tolerated floor, so existing Firebase business runtime does not fail any gate.
- `render.yaml` stands the nonprod estate up with no secret to paste, and its only Firebase
  dependency is the in-scope identity one.
- **The one thing that *would* block nonprod** is a *new* Firebase business dependency. Any import
  of a fenced class in `field-ops-app-vite/src`, `functions/src` or `integrations` fails the guard
  immediately — and for the 8 empty categories there is no baseline row to fall back on, so a single
  import is an instant hard failure.

### Blocks cutover: essentially the whole matrix

1. **No EOS API business endpoints.** The Render API exposes `/health`, `/admin/policy/*` and
   `/operations/inventory`. Until objects are reachable over it, no frontend row can move past
   `NOT_STARTED`. **This is the critical path.**
2. **Firestore Rules are the live business authorization plane** — 95 allow statements, 22 readable
   collections, 13 client-write grants, deployed to production `taylor-parts`. The architecture
   forbids this. Retiring it is tranche 5 and depends on everything above.
3. **Direct client writes**, chiefly `reorder_requests` (`firestore.rules:763-1001`), plus
   `equipment`, `accounts`, `locations`, `contacts`, `inventory_actions`, `fieldops_jobs`,
   `fieldops_technicians`. These bypass any server authority entirely.
4. **~143 deployed callables** are network-reachable regardless of frontend usage. Cutover means
   undeploying them, not merely removing client callers.
5. **9 domains have no PostgreSQL authority at all** (tranche 4) — authority design has not started.
6. **7 operator CLIs** write business documents outside the app; operational procedure must move too.

---

## 8. UNPROVEN

Recorded as unproven rather than asserted:

1. **The production deployed-function set.** `functions/lib` is not built in this worktree and no
   `firebase functions:list` output for `taylor-parts` exists in the repo beyond
   `docs/audits/inv-convergence-e-stage-a/deployment/postdeploy-functions.txt`, which records only
   "EQUAL to the predeploy inventory" without enumerating. The "~143 exports" figure is
   `scripts/sandboxDeployableFunctions.mjs`'s own recorded count, taken on trust from that file's
   header comment; I did not rebuild `lib` to re-derive it. **Which functions are deployed to
   production specifically is UNPROVEN.**
2. **Whether live production Rules match committed `firestore.rules` today.**
   `sb-evidence/postdeploy-live-firestore.rules` records a past deploy; no live fetch was performed
   (and none is permitted by this lane's prohibitions).
3. **Runtime reachability of frontend modules** is established by static import closure plus
   exhaustive occurrence search. A route rendered only behind a capability flag could still be
   statically reachable and practically dead; I did not execute the app. The four
   `DEAD_RETIREABLE` findings are the inverse case (statically unreachable **and** with an
   identified replacement), which is the safe direction.
4. **Firestore-emulator-backed suites were not run.** Port 8080 in this environment is an unrelated
   `uvicorn` process and the Admin SDK retries to deadline, so those suites hang rather than fail.
   Any assertion resting on emulator execution is unverified here.
5. **Collection-level read/write direction** in §4.2 is inferred from domain naming and the callable
   surface, not from per-call-site auditing of all 193 server files. The domain groupings and file
   counts are exact; the R/W column is indicative.
6. **A latent guard gap, not currently exercised.** The `firebase_admin_firestore` matcher requires
   the `/firestore` subpath, so a bare `import admin from "firebase-admin"` followed by
   `admin.firestore()` would **not** trip the guard. I verified this is not exploited today: the
   only bare `firebase-admin` import in any scan root is `functions/src/eosApi/server.ts:105-106`
   (identity), and `admin.firestore(` appears nowhere in `functions/src`,
   `field-ops-app-vite/src` or `integrations`. Whether to close the gap is a guard-lane decision,
   not this lane's.

---

## 9. Prohibitions honoured

Nothing was retired. No deletion, no baseline edit, no manifest edit, no Rules change, no index
change, no seed, no backfill, no deploy, no production contact, no new Firebase dependency. The only
file added is this document. Verification run locally:

```
node scripts/firebaseExitGuard.mjs --previous-baseline=docs/architecture/firebase-exit-baseline.json
  → no new Firebase business-runtime dependencies beyond the committed baseline
node --test scripts/firebaseExitGuard.test.mjs
git diff --check && git status --short
```
