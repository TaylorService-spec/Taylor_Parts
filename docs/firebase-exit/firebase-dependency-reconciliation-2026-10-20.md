# Firebase dependency reconciliation (2026-10-20)

**Status:** READ-ONLY EVIDENCE RECORD. Nothing was deleted, edited in `functions/` or `field-ops-app-vite/`, deployed, built or installed. Every number below is reproducible with the commands in section 1.
**Issued:** 2026-10-20 (America/Phoenix) · **Base:** `origin/main` `e19dc610da47280d8bebcc77bfa7b4c092fafb68` · **Lane:** DOC (docs and read-only).
**Instruction:** "Reconcile actual dependencies before deletion." This file measures the Owner baseline against the repository and the deployed-function captures, says what each Firebase dependency is replaced by, and orders what could be deleted once the Owner approves. It authorizes no deletion.

Sources read: `docs/architecture/firebase-exit-baseline.json`, `scripts/firebaseExitGuard.mjs`, `docs/operations/production-recovery-release-r1.md`, `docs/architecture/firebase-capability-equivalence.json`, and the lane evidence `evidence/firebase-deployed-inventory-20261019/` (the Owner-run read-only `firebase functions:list` captures), `firebase-replacement-matrix-2026-10-19.md`, `firebase-server-side-census-2026-10-19.md` (lane evidence, not in the repository; cited where used). Open specs F-1 (#2175), S1a (#2167), T-1 (#2173), REC (#2174) are cited by number only.

---

## 0. Reconciliation of the Owner baseline

| # | Owner baseline | Fresh recount (main `e19dc610`) | Verdict |
|---|---|---|---|
| 1 | 84 production functions, untouched | **84** deployed in `taylor-parts` (all `callable`, `nodejs22`, Gen 2). 41 of the 84 are not exported by current `functions/src/index.ts`; 43 are. | Matches. Untouched by this document. |
| 2 | 160 sandbox functions | **160** deployed in `eos-platform-sandbox` (all `callable`). Production's 84 are a strict subset; 76 are sandbox-only. | Matches. |
| 3 | 82 of the 160 are retired candidates | **79** are not exported by current `index.ts`. | **Differs by 3.** The 82 was measured at main `77d7745d`. Three PO-receiving callables were exported again since then: `getPurchaseOrderReceivingProgress`, `listReceivablePurchaseOrders`, `listReceivingLocationOptions`. They are live code, not retired candidates. (The last of the three is also one of production's earlier 42 "not in source", so production is 41, not 42.) |
| 4 | 17 client files importing Firebase | **19** files under `field-ops-app-vite/src` import the `firebase` package; **1** more (`services/adminPolicyApiClient.js`) reaches it only through the in-repo shim (the matrix's "20 including the shim"). The baseline JSON lists the same 19 (7 Firestore, 13 Functions, 2 Auth, with `firebase.js` and `useReportCapabilities.js` in two lists). | **Differs by 2.** 17 equals 19 minus the two identity-only entries `auth/AuthContext.jsx` and `firebase/firebase.js`; that reading is plausible but unconfirmed. The fenced business-runtime classes (Firestore plus Functions) alone are 18. |
| 5 | 161 server files naming Firebase packages | **171** files under `functions/src` name `firebase-admin*` or `firebase-functions*` in an import, re-export or require (158 Firestore Admin + 61 Functions + 3 Auth + 2 App signatures overlap into 170 distinct fenced files, plus `eosApi/server.ts` for the bare `firebase-admin` root). 126 of the 171 import at runtime; 45 only `import type` (erased by `tsc`). | **Differs by 10.** The 171 agrees with the census and the matrix header. No rule tested (runtime-only 126, fenced union 170, with or without script-only files) yields 161; the 10 are unexplained. |
| 6 | 55 potential test-only orphans | **50** server files are unreachable from every non-test entry point (49 reachable only from tests or from each other; **1** with no importer at all). Another **27** are reachable only from operator scripts, **93** only through `index.ts`, **1** from the EOS API server. | **Differs by 5.** The matrix's list of 55 includes five files that `index.ts` still exports (below, section 2.4). On the strict definition the count is 50, which agrees with the controller's census (93 / 27 / 50 / 1). |

Guard cross-check (read-only): `node scripts/firebaseExitGuard.mjs` reports no new dependency and an exact match with `firebase-exit-baseline.json` (7 / 13 / 2 client, 158 / 61 / 3 / 2 server signatures) at this head.

---

## 1. Method (reproducible)

All commands run from the repository root. None writes, builds or installs anything. The script uses only the Node standard library.

```bash
# 1. the guard: committed baseline vs an exact scan (fenced classes)
node scripts/firebaseExitGuard.mjs

# 2. client files, server files, runtime-import classes, per-directory counts, the orphan list
node docs/firebase-exit/reconcile-firebase-deps.mjs            # human-readable
node docs/firebase-exit/reconcile-firebase-deps.mjs --json     # deterministic JSON

# 3. deployed functions against index.ts exports (needs the Owner-run captures)
node docs/firebase-exit/reconcile-firebase-deps.mjs --functions D:/eos-lanes/evidence/firebase-deployed-inventory-20261019

# 4. production recovery tags (read-only)
git ls-remote --tags origin "production-release/*"
```

How `reconcile-firebase-deps.mjs` classifies a file (regex over source text; no compiler):

- **Edge.** A relative `import`, `export ... from`, dynamic `import()` or `require()`. `import type` and `export type` are **excluded** because `tsc` erases them. A script or test that loads compiled output by path (`../lib/x.js`, `functions/lib/x.js` through a helper such as `L("functions/lib/...")`) is mapped to `functions/src/x.ts`.
- **Entry points.** `functions/src/index.ts` (the deployed Cloud Functions). `functions/src/eosApi/server.ts` (the Render EOS API, started by `functions/scripts/serveEosApi.mjs`). Script entries: `functions/scripts/**`, `functions/authpr4/**`, `functions/migrations/**`, `functions/_e2e.mjs`, `scripts/**`, `integrations/**`. Test entries: `functions/test/**`, any `*.test.*`, `field-ops-app-vite/test/**`.
- **Class of a server Firebase file**, first match wins: `callable-only` (reachable from `index.ts`, not from the EOS API) · `eosApi-only` · `script-only` (reachable from a script entry) · `test-only` (reachable only from test entries or from other unreachable files) · `orphan` (no importer at all). The brief's "orphan" list is `test-only` plus `orphan`.
- **Client Firebase file.** A `field-ops-app-vite/src` file that imports `firebase` or a `firebase/*` subpath. A file importing only the shim `src/firebase/firebase.js` is reported separately.

Known limits (stated, not hidden): a module loaded through a computed path or a template string is invisible; a file excluded here may still be needed by a build step the regex cannot see (check with the proof command in 2.5 before any deletion); type-only edges are ignored, so a `test-only` file may still be named in a type position by a live file.

---

## 2. Server side: the 171 files in `functions/src`

### 2.1 Totals

| Class | Files | Meaning |
|---|---|---|
| callable-only | **93** | Reachable only through an `index.ts` export. These build the Cloud Functions (production 84, sandbox 160 deployed). |
| script-only | **27** | Reachable only from operator, migration or certification scripts. |
| test-only (unreachable from any runtime entry) | **49** | Only tests, or other unreachable files, import them. |
| orphan (no importer) | **1** | `workOrderConsumption/consumptionSourceCallables`. |
| eosApi-only | **1** | `eosApi/server.ts`: a lazy `import("firebase-admin")` for the Firebase token verifier, never loaded while `EOS_AUTH_FIREBASE_VERIFIER=disabled` (disabled on the Render nonprod service since 2026-10-18 per the lane evidence). |
| **Total** | **171** | 126 runtime importers, 45 type-only. |

### 2.2 Per directory (`functions/src/<dir>`)

| Directory | Callable-only | Script-only | Orphan (test-only + none) | EOS replacement (matrix section C1; `eosOps` unless noted) | Eligibility |
|---|---|---|---|---|---|
| `(root)` | 10 | 1 | 1 | Work Order create/lifecycle/field context (`workOrderCreateCommand`, `workOrderLifecycle`, `workOrderFieldContext`) DONE; reservations NOT_YET_ACTIVATED (S-1); `updateWorkOrderExecutionData` is the orphan (-> `recordWorkOrderExecution`) | HELD: S-1 for the reservation service; orphan RETIRE-READY |
| `access` | 12 | 0 | 1 | `adminPolicy/policyCommands.ts`, `eosAuth/*`, session/capability feed DONE for EOS logins; `employeeProfileCommands` is the orphan (Workforce commands replaced it) | HELD: PA-1 queue retires without a build; the rest waits on production sign-in (REC #2174) |
| `account` | 2 | 0 | 0 | `getAccountPortfolioSummary`: no EOS aggregate | BUILD-FIRST (small) or Owner accepts "unavailable" |
| `ai` | 1 | 0 | 0 | `workOrderReadiness.ts` DONE; `interpretWorkOrderReadinessContext` has no EOS twin (refuses everywhere) | RETIRE-READY, Owner nod on the AI seam |
| `coverage` | 2 | 0 | 0 | none (T-1, spec #2173) | BUILD-FIRST |
| `crmActivity` | 2 | 0 | 0 | `eosCrm/crmActivityAuthority.ts` DONE (#2134) | RETIRE-READY |
| `cycleCount` | 0 | 6 | 4 | `cycleCountOperations.ts` DONE | RETIRE-READY (script-only 6 go with certification tooling) |
| `dataImport` | 6 | 0 | 0 | `dataImportOperations.ts`: SERVICE_HISTORY only | HELD: other entity types have no EOS path |
| `eosApi` | 0 | 0 | 0 (+1 eosApi-only) | n/a (verifier) | HELD: last; see 5 |
| `equipmentCompatibility` | 2 | 1 | 5 | `equipmentOperations.ts` | RETIRE-READY (orphans); callables after proof |
| `equipmentInstall` | 2 | 1 | 0 | `workOrderEquipmentInstall.ts`, `serializedAssetAcquireOperations.ts` | RETIRE-READY after per-operation proof |
| `finance` | 7 | 0 | 1 | `eosFinance/*`, `eosOps/invoiceAuthority.ts` for issue; adjustments/refunds not built | HELD: F-1 (BUILD-FIRST); `financialPolicyProfileCommand` orphan RETIRE-READY |
| `fulfillment` | 2 | 0 | 0 | none (S-1, spec #2167) | BUILD-FIRST |
| `inventory` | 2 | 0 | 0 | `partsReads.ts` (`readInventoryOnHand`, batch <= 500) DONE | RETIRE-READY |
| `inventoryLedger` | 1 | 1 | 1 | ledger reads/placement DONE | RETIRE-READY |
| `inventoryLocation` | 5 | 1 | 3 | `binPlacementOperations.ts`, `stockRelocationOperations.ts`, `warehouseBinAdministration.ts` DONE | RETIRE-READY |
| `inventoryReceiving` | 9 | 0 | 0 | `supplierPurchaseOrderReceiving.ts` DONE (B3, P-1) | RETIRE-READY; three of its callables are exported again (live) |
| `inventoryReturns` | 2 | 0 | 0 | `returnIntake.ts` DONE (#2133) | RETIRE-READY |
| `inventoryTransfer` | 0 | 6 | 2 | `transferOperations.ts` DONE | RETIRE-READY |
| `opportunity` | 0 | 0 | 5 | commercial `POST /commercial/sales` DONE | RETIRE-READY |
| `partMaster` | 5 | 1 | 5 | catalog `/operations/catalog` DONE; alias/scan behaviour changes unruled (ALS-1/2) | HELD: equivalence rulings; orphans RETIRE-READY |
| `performance` | 4 | 0 | 0 | `performanceGoalReads.ts` + `performanceGoalAuthoring.ts` (G-1 #2165/#2166) | RETIRE-READY in repo; goal-data copy is an Owner gate |
| `reorderRequest` | 0 | 1 | 2 | `reorderLifecycleCommands.ts` DONE | RETIRE-READY |
| `reporting` | 4 | 0 | 0 | `reportOperations.ts` DONE | RETIRE-READY after R1 (saved-definition copy unverified) |
| `salesAgreement` | 2 | 0 | 4 | commercial sales ops DONE | RETIRE-READY |
| `salesOrder` | 1 | 2 | 2 | commercial sales ops DONE; numbering/backfill scripts | RETIRE-READY |
| `scheduling` | 5 | 0 | 0 | `workOrderScheduling.ts`, `workOrderAvailability.ts` DONE | RETIRE-READY |
| `serializedAsset` | 1 | 2 | 1 | `serializedAssetAcquireOperations.ts` DONE | RETIRE-READY after proof |
| `supplierMaster` | 0 | 0 | 5 | `supplierAdministration.ts`, `partSupplierTerms.ts`, `supplierCatalogRepository.ts` | RETIRE-READY (supplier migration tools are one-off) |
| `truckRegistry` | 0 | 1 | 3 | `truckRegistryAdministration.ts`, `truckFleetRepository.ts` | RETIRE-READY |
| `warehouseGovernance` | 2 | 3 | 1 | warehouse status authority DONE | RETIRE-READY |
| `workOrderConsumption` | 0 | 0 | 3 | `workOrderExecution.ts` truck consumption DONE (OD-T4) | RETIRE-READY |
| `workOrderInstall` | 1 | 0 | 0 | `workOrderEquipmentInstall.ts` | RETIRE-READY after proof |
| `workOrderLabor` | 0 | 0 | 1 | `workOrderLabor.ts`; labor rulings WOL-1/3/4 unruled | HELD: equivalence rulings; the orphan is the Firebase command module |
| `workOrderPartsPlan` | 1 | 0 | 0 | `workOrderPartsPlanAuthority.ts` DONE | RETIRE-READY |
| **Total (171)** | **93** | **27** | **50** (+1 `eosApi`) | | |

Capability labels follow the lane evidence matrix. "DONE" means an EOS operation of the same purpose exists in source; it does not claim live nonprod proof, which this lane did not re-read.

### 2.3 What the classes mean for deletion

- **Orphans (50):** no live module imports them. Their only consumers are tests (and each other). Deleting them cannot change any deployed or running behaviour.
- **Script-only (27):** needed only by operator and certification scripts under `functions/scripts/`. They go with the script that uses them, or are kept while the script is.
- **Callable-only (93):** the source of the 84 + 160 deployed callables. Deleting a file here removes an `index.ts` export; a later `firebase deploy --only functions` would then offer to delete the deployed copy. That is the destructive step and stays Owner-gated (section 4).

### 2.4 The five files the matrix's 55 includes that this recount keeps out

Matrix section C2 lists 55. Five of them are still exported from `index.ts` and are deployed in sandbox:

| File | Why it is live |
|---|---|
| `inventoryLocation/binCallables` | `index.ts` exports it; sandbox deploys `createBin`, `listBins`, `previewBinCreates`, `deactivateBin`, `reactivateBin`, `renameBin`, `resolveBin`, `resolveBinToken` |
| `inventoryLocation/binPreviewService`, `inventoryLocation/putAwayCommand` | imported by `binCallables` (`putAwayCommand` also by `stockRelocationCommand`), which `index.ts` exports (`previewBinCreates` is the binPreviewService callable) |
| `inventoryReceiving/receivingCallables` | `index.ts` exports it; production deploys `receiveInventoryStock` |
| `warehouseGovernance/receivingLocationOptionsService` | feeds `listReceivingLocationOptions` (production and sandbox) |

### 2.5 The exact orphan list (50) and the proof command

Unreachable from every non-test entry point. `(type-only Firebase)` means the file names Firebase only in `import type`, so it loads no Firebase package at runtime.

| Directory | Files | Names |
|---|---|---|
| `(root)` | 1 | updateWorkOrderExecutionData |
| `access` | 1 | employeeProfileCommands |
| `cycleCount` | 4 | cycleCountSheetCallables, cycleCountSheetCommand (type-only Firebase), cycleCountSheetRead, cycleCountSheetRepository |
| `equipmentCompatibility` | 5 | commands, compatibilityRepository (type-only Firebase), equipmentCompatibilityReadCallable, operationRepository, readService |
| `finance` | 1 | financialPolicyProfileCommand |
| `inventoryLedger` | 1 | mobileLocationPresenceProbe (type-only Firebase) |
| `inventoryLocation` | 3 | locationDisplayReadService, stockRelocationCallables, stockRelocationCommand (type-only Firebase) |
| `inventoryTransfer` | 2 | transferCallables, transferReceivableRead |
| `opportunity` | 5 | closeOpportunityAsWon, createSalesOrderFromOpportunity, opportunityCallables, opportunityNumbering, opportunityReadService |
| `partMaster` | 5 | partAliasReadService (type-only Firebase), partAliasScanResolver, partReferenceCompatibility, partSupplierItems, scannerPartLookup (type-only Firebase) |
| `reorderRequest` | 2 | reorderCallables, reorderWarehouseAuthority (type-only Firebase) |
| `salesAgreement` | 4 | agreementToSalesOrder, salesAgreementCallables, salesAgreementNumbering, salesAgreementReadService |
| `salesOrder` | 2 | salesOrderCallables, salesOrderReadService |
| `serializedAsset` | 1 | acquireCallables |
| `supplierMaster` | 5 | reorderPurchaseOrderSupplierMigration (type-only Firebase), reorderPurchaseOrderSupplierMigrationExecute, supplierMasterCommands, supplierMasterRepository (type-only Firebase), supplierMasterValidation |
| `truckRegistry` | 3 | operationalReferenceProbe (type-only Firebase), truckRegistryCallables, truckRegistryCommands |
| `warehouseGovernance` | 1 | warehouseStatusWriter |
| `workOrderConsumption` | 3 | consumptionSourceCallables **(0 importers)**, consumptionSourceService (type-only Firebase), planPhysicalConsumption |
| `workOrderLabor` | 1 | workOrderLaborCommand (type-only Firebase) |
| **Total** | **50** | 38 runtime-importing, 12 type-only |

Proof, per file (run for any file before it is deleted; replace `consumptionSourceCallables`):

```bash
# 1. the script's own verdict and importer counts for the whole set
node docs/firebase-exit/reconcile-firebase-deps.mjs | sed -n '/^ORPHAN/,$p'

# 2. independent check: every non-test file that mentions the module by name (expect only other orphans)
git grep -nE "consumptionSourceCallables" -- functions/src functions/scripts scripts integrations ':!functions/test'

# 3. is it exported from index.ts (expect no match)
git grep -n "consumptionSourceCallables" -- functions/src/index.ts
```

Deletion is by connected set, not file by file: the 50 import each other, and 49 of the 50 have at least one test importer (105 test-importer edges in total; the `testImporters` column of the script output). Those tests go in the same change. Several are parity suites that import the Firebase module to prove an EOS equivalent (for example `equipmentCompatibilityDomainParity`); deleting them removes that proof, so the matching equivalence record (`docs/architecture/firebase-capability-equivalence-gate.md`) must exist first.

---

## 3. The 17 (19 + 1) client files

Replacement status is taken from the lane matrix section B, updated for work merged since (F-2 #2168, G-1 #2165/#2166, P-1 #2162, B3/B4). RETIRE-READY = an EOS path exists in the EOS-only build; the Firebase path is the only path in builds whose environment declares `eosApi: null` (production, certification, integration, local). HELD carries the reason. No client file is BUILD-FIRST; the build-first work is server-side (F-1, S-1, T-1).

| # | File (`field-ops-app-vite/src/`) | Firebase use | EOS replacement | Status |
|---|---|---|---|---|
| 1 | `firebase/firebase.js` | the shim: app, Firestore, Auth, Functions | `firebaseAbsent.js` null handles in the EOS-only build | HELD: delete last, after every row below and R2 |
| 2 | `auth/AuthContext.jsx` | sign-in, sign-out, password reset | `EosLogin.jsx`, `/auth/*` (nonprod only) | HELD: production sign-in is still Firebase; recovery gaps (REC #2174) |
| 3 | `auth/employeeSession.js` | Firestore `users/{uid}`, `employees` at sign-in | EOS identity resolution in `AuthContext` | HELD: production path |
| 4 | `access/useReportCapabilities.js` | `onSnapshot users/{uid}`, `resolveEffectiveAccessCallable` | caller's EOS capability set | HELD: production path |
| 5 | `hooks/useCurrentTechnician.js` | Firestore `users.technicianId`, `fieldops_technicians` | EOS branch from `AuthContext` `employeeId` | RETIRE-READY |
| 6 | `hooks/useEmployeeDirectory.js` | Firestore `employees` listener | `useGovernedEmployeeDirectory` | RETIRE-READY |
| 7 | `hooks/useInventoryActions.js` | Firestore `inventory_actions` | read-only archive `listLegacyInventoryActionNotes`; archive empty until a copy is authorized | HELD: Owner decision D-246-1 (retire, or archive with a copy) |
| 8 | `services/operationsQueries.ts` | Firestore `getDocs` (warehouse picker, parity diagnostic, dead transfer readers) | `loadRackingWarehouses`; the parity diagnostic loses its purpose | RETIRE-READY (Owner nod: the parity diagnostic is removed) |
| 9 | `services/binCommandClient.js` | 8 bin callables | `eosRackingClient.js` on `POST /admin/policy` | RETIRE-READY |
| 10 | `services/performanceGoalClient.js` | 3 goal reads | EOS goal reads; authoring on EOS (G-1) | RETIRE-READY (goal-data copy is a separate Owner gate) |
| 11 | `services/receivingCallableClient.js` | 4 receiving callables | `supplierReceivingClient` on `/operations/inventory` | RETIRE-READY |
| 12 | `services/financeReadCallableClient.js` | `listAccountInvoiceAr`, `listFinancialFacts` | EOS finance reads (F-2 #2168) | RETIRE-READY in repo; invoice number and issue date arrive with F-1 (never user-visible in Firebase) |
| 13 | `services/privilegedApprovalClient.js` | list/decide privileged requests | none, by decision PA-1 (direct assignment) | RETIRE-READY (code); gated on the R0 census (0 pending requests) |
| 14 | `access/administrationUsersClient.js` | `setUserStatus`, `readPrincipalAccessState`, `listRecordChangeHistory` | `readLoginAccount`, `setLoginAccountStatus` (EOS logins) | HELD: pre-cutover history is not in EOS (Owner copy decision) |
| 15 | `access/adminPasswordResetClient.js` | `listResetEligibleUsers`, `initiateAdminPasswordReset` | `issueLoginReset` one-time ticket | HELD: production recovery (REC #2174) |
| 16 | `access/dataImportClient.js` | stage/execute/list import callables | `createDataImportClient`: SERVICE_HISTORY only | HELD: customers/inventory/parts/equipment imports have no EOS path |
| 17 | `access/importedServiceHistorySource.js` | `listImportedServiceHistory` | `eos_ops.imported_service_history` read | HELD: Owner decision on copying the Firestore history |
| 18 | `domain/reporting/reportExecutionSeam.js` | `runReportDefinitionCallable` | `runReportDefinition` | RETIRE-READY |
| 19 | `domain/reporting/savedReportService.js` | 6 saved-definition callables | `*SavedReportDefinition(s)` over `eos_ops.report_definitions` | RETIRE-READY (existing saved definitions: copy unverified, not planned) |
| (20) | `services/adminPolicyApiClient.js` | shim only: `auth.currentUser.getIdToken()` fallback | EOS token source | HELD with `AuthContext` |

Tally: **10 RETIRE-READY, 9 HELD, 0 BUILD-FIRST** for the 19 files that import the package; row 20 is HELD. Because rows 1-4 and 20 are the production sign-in path, 5 of 20 can only go when production has an EOS API and a recovery process, both Owner-reserved.

**EOS bundle (2026-10-21, lane FBX).** The B2 alias covered only `firebase/firebase`; 18 of the files above import `firebase/app|auth|firestore|functions` directly, and `AuthContext` (static from `main.jsx`) plus `App.jsx` pulled all four SDKs into the entry chunk of the EOS-only build even though the handles were null. In a `VITE_AUTH_SOURCE=eos` build `vite.config.js` now also aliases those four specifiers to `src/firebase/firebaseSdkAbsent.js` (fail-closed stand-ins; `httpsCallable` returns a callable that rejects with `FIREBASE_ABSENT`), and `npm run verify:eos-only` (CI: `vite-build-check`) fails if SDK code, a Google endpoint host or a Firebase config value is in the EOS output. Entry chunk 1,454 kB (gzip 432) -> 929 kB (gzip 277). No source file, the real `firebase.js`, or any non-EOS build changed. The HELD rows stay in the repo for the Firebase-backed builds.

---

## 4. Deployed functions mapped to their EOS replacement

Counts below come from `--functions` (section 1). P = deployed in `taylor-parts` (production, 84). S = deployed in `eos-platform-sandbox` (160, a superset of P). "Not in source" counts sandbox names absent from current `index.ts` (79). The certification project deploys one function, `interpretWorkOrderReadinessContext` (also in source), which is in neither P nor S.

Rules for reading the status column: **production is untouched** for all P rows; their live Hosting/Pages build (R1) calls them and production has no EOS API. For S-only names the status says what retiring the deployed copy would need. No row authorizes a `functions:delete`.

| Family | P | S | Not in source | EOS replacement | Status |
|---|---|---|---|---|---|
| A1 Sales, opportunities, agreements: createOpportunity, transitionOpportunity, updateOpportunity, closeOpportunityAsWon, getOpportunityContext, listOpportunitiesForAccount, listOpportunityContext, createSalesOrder, createSalesOrderFromOpportunity, transitionSalesOrder, getSalesOrderContext, listSalesOrderIndex, listSalesOrdersForAccount, createSalesAgreement, updateSalesAgreementDraft, acceptSalesAgreement, getSalesAgreementContext, getSalesAgreementForOpportunity | 10 | 18 | 18 | commercial `POST /commercial/sales` (`eosCommercial`) | RETIRE-READY (sandbox); production HELD (R1) |
| A2 Allocation: allocateSalesOrder, createServiceForSalesOrder | 2 | 2 | 0 | none; `serviceFromSalesOrderBoundary.ts` refuses part lines | BUILD-FIRST (S-1, spec #2167) |
| A3 Invoicing: issueInvoice, recordInvoiceAdjustment, recordRefund, applyPayment | 4 | 4 | 0 | `invoiceAuthority.ts`, `invoiceNumberAllocator.ts` exist unwired; payments partly covered by `recordSettlement` / `applySettlement` (obligation model) | BUILD-FIRST (F-1; F-1a #2184 issues an invoice) |
| A4 Finance reads: listAccountInvoiceAr, listFinancialFacts | 1 | 2 | 0 | `listObligations`, `readFinanceOverview` and the F-2 fact families | RETIRE-READY in repo; invoice number / issue date wait for F-1 |
| A5 Coverage: createSalesTerritory, createCoverageAssignment, resolveCoverageForContext | 3 | 3 | 0 | none | BUILD-FIRST (T-1, spec #2173) |
| A6 Goals: createPerformanceGoalDraft, approvePerformanceGoal, retirePerformanceGoal, listCurrentPerformanceGoals, listGoalSubjects, listPerformanceGoalVersions | 0 | 6 | 0 | `performanceGoalAuthoring.ts`, `performanceGoalReads.ts` (G-1) | RETIRE-READY (goal copy Owner-gated) |
| A7 Privileged and access requests: requestPrivilegedRole, listPrivilegedRoleRequests, decidePrivilegedRoleRequest, approveAccessRequest, rejectAccessRequest | 2 | 5 | 0 | PA-1: direct `assignRole` / `revokeRole`; no EOS op for access requests (nothing creates them) | RETIRE-READY (privileged three, after R0 census); HELD for the two access-request names (Owner: retire or build) |
| A8 Roles, users, sign-in administration: assignApprovedRole, grantRole, revokeRole, setUserStatus, readPrincipalAccessState, initiateAdminPasswordReset, listResetEligibleUsers, listRecordChangeHistory, resolveEffectiveAccessCallable, updateEmployeeProfile | 7 | 10 | 1 | `assignRole` / `revokeRole`; `readLoginAccount`, `setLoginAccountStatus`, `issueLoginReset`; EOS session feed; Workforce commands | HELD: production sign-in (REC #2174); pre-cutover history copy (Owner); `updateEmployeeProfile` RETIRE-READY |
| A9 Work Order engine, scheduling, readiness: createWorkOrder, transitionWorkOrder, completeAssignedJob, getWorkOrderFieldContext, getWorkOrderReadinessContext, listCoordinatedOperations, setWorkOrderPartsPlan, updateWorkOrderExecutionData, listWorkOrderConsumptionSources, rescheduleWorkOrderCallable, reassignScheduledWorkOrderCallable, setWorkOrderEstimatedDurationCallable, setTechnicianWorkingAvailabilityCallable, readTechnicianAvailabilityCallable, createTechnicianBlockedTimeCallable, deleteTechnicianBlockedTimeCallable | 7 | 16 | 2 | `workOrderCreateCommand`, `workOrderLifecycle`, `workOrderFieldContext`, `workOrderReadiness`, `workOrderScheduling`, `workOrderAvailability`, `workOrderPartsPlanAuthority`, `workOrderExecution` | RETIRE-READY (sandbox); production HELD (R1) |
| A10 Labor, install, serialized assets: recordWorkOrderLabor, correctWorkOrderLabor, getWorkOrderLabor, recordWorkOrderEquipmentInstall, getInstallableEquipmentForWorkOrder, installSerializedAsset, acquireSerializedAsset, getAvailableEquipment | 1 | 8 | 8 | `workOrderLabor.ts`, `workOrderEquipmentInstall.ts`, `serializedAssetAcquireOperations.ts` | HELD: labor semantics unruled (WOL-1/3/4); per-operation proof for install |
| A11 Truck registry (9): createTruckCallable, changeTruckHomeWarehouseCallable, changeTruckStatusCallable, deactivateTruckCallable, reactivateTruckCallable, deleteTruckCreatedInErrorCallable, assignTruckDriverCallable, reassignTruckDriverCallable, unassignTruckDriverCallable | 9 | 9 | 9 | `truckRegistryAdministration.ts`, `truckFleetRepository.ts` (a truck is a MOBILE location) | RETIRE-READY (sandbox); production HELD |
| A12 Transfers and cycle counts: createTransferOrder, dispatchTransferOrder, receiveTransferOrder, cancelTransferOrder, createCycleCount, submitCycleCount, reconcileCycleCount, cancelCycleCount | 8 | 8 | 8 | `transferOperations.ts`, `cycleCountOperations.ts` | RETIRE-READY (sandbox); production HELD |
| A13 Parts, suppliers, supplier terms: createPart, updatePart, changePartStatus, createSupplier, updateSupplier, activateSupplier, deactivateSupplier, createPartSupplierItem, updatePartSupplierItem, changePartSupplierItemStatus, setPreferredSupplier, searchProductReferences | 11 | 12 | 11 | catalog `/operations/catalog`; `supplierAdministration.ts`, `partSupplierTerms.ts` | HELD: the 2026-10-11 equivalence audit recorded gaps SUP-1/SUP-2 and live-proof pending; re-verify against current main |
| A14 Part aliases and scans: createPartAlias, deactivatePartAlias, reactivatePartAlias, listPartAliases, probePartAlias, resolveScannedPartIdentifier | 0 | 6 | 6 | catalog `createPartAlias` etc., `lookupScannedPart` | HELD: equivalence rulings ALS-1/2 (read gate narrowed) |
| A15 Receiving, put-away, locations, returns, reorder, balances: receiveInventoryStock, getPurchaseOrderReceivingProgress, listReceivablePurchaseOrders, listReceivingLocationOptions, recordPutAway, getLocationDisplay, recordReturnIntake, createReorderRequest, listReorderWarehouseOptions, recordReorderPurchaseOrder, getPartBalance, getPartBalances | 3 | 12 | 5 | `supplierPurchaseOrderReceiving.ts`, `binPlacementOperations.ts`, `returnIntake.ts`, `reorderLifecycleCommands.ts`, `partsReads.ts` | RETIRE-READY for the 5 retired-from-source names; the other 7 are exported again and live |
| A16 Bins: createBin, listBins, previewBinCreates, deactivateBin, reactivateBin, renameBin, resolveBin, resolveBinToken | 0 | 8 | 0 | `eosRackingClient.js` over `POST /admin/policy`, `warehouseBinAdministration.ts` | RETIRE-READY (still exported from source) |
| A17 Data import and imported history: stageDataImport, executeDataImport, listDataImportJobs, listImportedServiceHistory | 0 | 4 | 0 | `dataImportOperations.ts` (SERVICE_HISTORY), `importedServiceHistory.ts` | HELD: other entity types; history copy decision |
| A18 Reports: runReportDefinitionCallable, createSavedDefinitionCallable, getSavedDefinitionCallable, listSavedDefinitionsCallable, renameSavedDefinitionCallable, duplicateSavedDefinitionCallable, deleteSavedDefinitionCallable | 7 | 7 | 0 | `reportOperations.ts` | RETIRE-READY (sandbox); production HELD |
| A19 CRM, accounts, manufacturers: createCrmActivity, getCrmActivities, getAccountPortfolioSummary, createManufacturer, updateManufacturer, changeManufacturerStatus, getManufacturerCatalog | 7 | 7 | 0 | `eosCrm`, `manufacturerAuthority.ts`; no portfolio aggregate | RETIRE-READY, except `getAccountPortfolioSummary` BUILD-FIRST (small) |
| A20 Inventory analytics: getInventoryAnalytics, detectInventoryEffects | 2 | 2 | 0 | EOS analysis measure `inventory.onHand.quantity`; no twin for `detectInventoryEffects` (operator tool) | HELD: Owner nod to retire `detectInventoryEffects` |
| A21 Inbound work and email: acceptInboundWork, declineInboundWork, attachInboundWorkToWorkOrder, getInboundWorkAttachment, getInboundWorkRequest, listInboundWork, deliverInboundEmailMessage, getEmailIntakeConfiguration, saveEmailConnection, saveEmailMailbox, saveEmailRoutingRule | 0 | 11 | 11 | `inboundWorkOperations.ts`, `inboundProviderRuntime.ts`, `inboundWorkIntake.ts` (Render job) | RETIRE-READY |
| **Total** | **84** | **160** | **79** | | |

Tallies by family (21): RETIRE-READY 11 (A1, A4, A6, A9, A11, A12, A15, A16, A18, A19, A21), split 1 (A7: privileged three RETIRE-READY, access-request two HELD), HELD 6 (A8, A10, A13, A14, A17, A20), BUILD-FIRST 3 (A2 S-1, A3 F-1, A5 T-1). Production P rows in BUILD-FIRST families: 9 of 84 (A2 2, A3 4, A5 3). Single names flagged outside their family status: `getAccountPortfolioSummary` BUILD-FIRST, `updateEmployeeProfile` RETIRE-READY.

---

## 5. What deletion would break

1. **The production rebuild (R1).** Production runs Hosting `4f30ab3a`, Pages `6cac0423`, Functions `4f30ab3a` (84 of 84 exported, zero residual), Rules `0526140d`. The recovery tags exist on `origin` and are annotated: `production-release/hosting-4f30ab3ad7c4`, `production-release/functions-4f30ab3ad7c4`, `production-release/pages-6cac04232c81` (verified by `git ls-remote`, section 1). A rebuild uses the tag's own tree, so deleting files on `main` does not remove the ability to rebuild, **provided** the tags are never moved or deleted and the recipe in `docs/operations/production-recovery-release-r1.md` is run from a checkout of the tag, not of `main`. Two cautions:
   - `scripts/_prodRelease.run.sh` deploys the working checkout (`firebase deploy --only functions`, never `--force`) and tells the operator to STOP if the CLI reports it would delete a function. From `main`, 41 production functions are already outside current source, so a production release from `main` already reports deletions today; further deletion widens it.
   - The Rules revision `0526140d` has no tag. It is reachable in history, but a tag would pin it (`production-release/rules-0526140d` is a suggestion for the controller, who creates tags; this lane created none).
2. **`main` stops building a legacy production bundle.** `config/environments.json` declares `eosApi: null` for production, certification, integration and local, so the Firebase client code is their only path. Deleting rows 5-13 and 18-19 of section 3 means those roles build from a tag, never from `main`. Check which role each automatic deploy of `main` builds before merging a client deletion.
3. **The deployed copies.** Deleting source never removes a deployed function; the deployed artifact is a stored zip. The destructive step is a later `firebase functions:delete` (or a `--force` deploy, which `_prodRelease.run.sh` refuses). `scripts/_sandboxRefresh.run.sh` now deploys filtered batches, so a refresh no longer prunes; sandbox retirement is explicit `functions:delete`. Each needs separate Owner authorization.
4. **The ratchet and the equivalence gate.** A deletion PR must shrink `firebase-exit-baseline.json` in lockstep (a stale entry fails `firebaseExitGuard.mjs`), update `firebase-exit-manifest.json`, and carry or keep a capability-equivalence record for every operation it retires.
5. **Tests and scripts.** Tests import 49 of the 50 orphans; operator scripts import the 27 script-only files. Each must be removed or rewritten in the same change as the file it uses.
6. **History is the only copy** of retired source for the 41 production and 79 sandbox functions outside current source (inbound email, trucks, transfers, cycle counts, sales agreements, sandbox labor/install, part aliases). A tag on the commit before the first deletion keeps them one command away; recommended, not created here.
7. **Not caused by deletion but found:** the root `index.html` "Parts Control Center" page still reads and writes a Firestore `pcc` document with the production web config; production Rules deny it, so it is a broken public page, not a data risk (lane evidence `firebase-deployed-functions-and-pcc-risk-2026-10-19.md`). Its disposition is an Owner production decision.

---

## 6. Order: deletable now (subject to Owner approval) and what waits on which build

Nothing here is authorized. Each step needs the Owner's approval, an independent review, CI and the usual protected merge; the destructive and production steps need separate authorization.

| Step | What | Waits on | Count |
|---|---|---|---|
| 0 | Mark history: a tag on the commit before the first deletion; Rules tag for `0526140d` | controller creates tags | 0 files |
| 1 | **Delete now (repo only, no deployed effect):** the 50 unreachable server files and the tests that exist only for them, by connected set | Owner approval; matching equivalence records for the parity suites | 50 files + their tests |
| 2 | Client RETIRE-READY files: #5, 6, 8, 9, 10, 11, 12, 13, 18, 19 (section 3) | Owner approval; R0 census for #13; confirmation of which role each `main` auto-deploy builds | 10 files |
| 3 | Callable-only source for RETIRE-READY families (A1, A4, A6, A9, A11, A12, A15 retired names, A16, A18, A19, A21), with their `index.ts` exports | Step 2; Owner-approved undeploy plan (a removed export is pruned at the next unfiltered deploy) | 41 of the 93 (the callable-only files in directories marked RETIRE-READY in 2.2 with no proof or ruling pending: ai, crmActivity, inventory, inventoryLedger, inventoryLocation, inventoryReceiving, inventoryReturns, performance, reporting, salesAgreement, salesOrder, scheduling, warehouseGovernance, workOrderPartsPlan) |
| 4 | Script-only files, with their operator scripts | the scripts' retirement | 27 files |
| 5 | **After F-1:** finance callables (A3, 7 `finance` files), invoice fields on the receivable reads | F-1 built (F-1a #2184 open) and the F-1 Owner rulings | 7 + A3 |
| 6 | **After S-1:** `fulfillment/` (2), the reservation service in `(root)`, A2 | S1a spec #2167 and its build (Finance goes first, Reservations second) | 2 + A2 |
| 7 | **After T-1:** `coverage/` (2), A5 | T-1 spec #2173 and its build | 2 + A5 |
| 8 | **After REC and production sign-in:** `AuthContext`, `employeeSession`, `useReportCapabilities`, `adminPasswordResetClient`, `administrationUsersClient`, shim; then the `eosApi/server.ts` verifier and the `firebase-admin` / `firebase-functions` dependencies, with an EOS-only `tsconfig` | REC #2174 (design only), a production EOS API (Owner-reserved), Owner copy decisions (history, goals, saved definitions, `inventory_actions`) | the HELD rows |
| 9 | **Deployed retirement:** sandbox 79 by named `functions:delete` batches; production 84 only after production has an EOS API | separate Owner authorization (destructive) | 79 + 84 |

Builds that do **not** gate Firebase deletion: W-1 (warranty), D-1 (delivery), Q-1 (quotes). Firebase never held those capabilities. Service Work Order invoicing (`docs/architecture/service-wo-invoicing-policy-requirements.md`) is a B5 gap beside F-1; it removes no Firebase code.

---

## 7. Stated uncertainty

- The Owner figures 17, 161, 55 and 82 are not derivable from this repository by one rule; the table in section 0 gives the closest reconciliation and says where it is a guess.
- Reachability is regex-based (section 1 limits). The 50-file list is the strict set; the proof command in 2.5 is the gate, not this list.
- "DONE" and "RETIRE-READY" are repository facts about EOS operations. The deployed-function inventory is the Owner-run capture of 2026-10-19; nothing was read from Firebase, Firestore or Render in this lane.
