# Firebase Functions as business transport — census and safe-retirement analysis

**Lane** P2-B3 · **Evidence lane: nothing is retired, changed, deployed, or pushed by this document.**

**Base** integrated head `d104cf49` (all 32 Wave-1 lanes merged), worktree branch
`night/p2b3-functions-transport`.

**Target architecture** (unchanged, and this document proposes no addition to it):
Browser → Vercel → transitional Firebase Auth token → Render EOS API → EOS
authorization/workflow/business authority → PostgreSQL. Firebase Auth/session identity is
transitional and out of scope. **No new Firebase Functions business transport is proposed here —
retirement paths only.**

---

## 0. How every claim below was established

Everything in this census was measured in this worktree, not inherited from a sibling summary.
Where a repository header, a client comment, or a prior lane's claim disagreed with the code, the
code won and the disagreement is recorded in §7.

| question | method |
|---|---|
| is it exported | `functions/src/index.ts`, parsed |
| is it a real Cloud Function | `functions/lib/index.js` `__endpoint` (the artifact `firebase deploy` itself loads), via `scripts/sandboxDeployableFunctions.mjs` `loadFunctionManifest` |
| is it deployable to the live sandbox | `deployableFunctionNames()` — the manifest minus the governed exclusion list |
| does a live client call it | every `httpsCallable` call site in `field-ops-app-vite/src`, plus the dynamic metadata dispatch in `src/metadata/callableListSource.js`, plus an import-graph check that the client transport module has a consumer |
| what capability gates it | the capability literal in the callable module and its direct command module |
| is the capability active | `PERMISSION_CATALOG` `active` flag, read out of the compiled `functions/lib/access/permissionCatalog.js` |
| is it granted to any Role | `COMPATIBILITY_ROLES` + `GOVERNED_BUSINESS_ROLES` (48 Roles), compiled and enumerated |
| is it activated in an environment | `config/environments.json` `capabilityActivationOverrides` / `productionCapabilityActivations`, intersected with `SPINE_OVERRIDE_ELIGIBLE_IDS` / `PRODUCTION_ACTIVATION_ELIGIBLE_IDS` |
| client readiness gate | `field-ops-app-vite/src/config/*Readiness.js`, resolved per environment from the same registry |

Build and guard, run in this worktree:

```
functions$ npm ci && npm run build          # tsc clean
$ node scripts/firebaseExitGuard.mjs --previous-baseline=docs/architecture/firebase-exit-baseline.json
  -> "no new Firebase business-runtime dependencies beyond the committed baseline"
$ git diff --check && git status --short    # clean
```

---

## 1. The transport surface, measured

**179 Cloud Function endpoints** are exported from `functions/src/index.ts`: **178 `onCall`
callables and one `onSchedule`** (`pollEmailMailboxes`). The compiled `__endpoint` manifest agrees
with the parsed export list exactly — 179 either way.

### 1.1 There is no HTTP handler — confirmed

**CONFIRMED in the integrated tree.** `functions/` contains **zero** `https.onRequest` handlers.
Every `onRequest` substring in the tree is part of a longer identifier:

| identifier | occurrences |
|---|---|
| `OperationalInterpretationRequest` | 6 |
| `buildAuthorizationRequest` | 6 |
| `jsonRequest` / `jsonRequestWithAuth` (a script, not a handler) | 4 |
| `RelocationRequest` | 3 |
| `validateRelocationRequest` | 2 |
| `AuthorizationRequest` | 2 |
| `AiProviderSelectionRequest` | 2 |
| `TransitionRequest` | 1 |

There are also **no Firestore document triggers** (`onDocumentCreated/Written/Updated/Deleted`) and
**no Auth triggers** (`beforeUserCreated`, `beforeUserSignedIn`, `auth.user()`) anywhere in
`functions/src`. The entire Functions business-transport surface is: 178 callables + 1 schedule.

### 1.2 Deployability

`scripts/sandboxDeployableFunctions.mjs` derives, from the compiled manifest, **170 sandbox-
deployable** of 179. Nine are excluded by a governed, exact-id decision because they bind secrets
`platform-sandbox` intentionally does not hold:

| excluded export | secrets bound |
|---|---|
| `interpretWorkOrderReadinessContext` | 5 × `KEYSTONE_*` |
| `startEmailConnectionAuthorization`, `completeEmailConnectionAuthorization`, `testEmailConnection`, `disconnectEmailConnection`, `getEmailProviderReadiness`, `pollEmailMailboxNow`, `retryEmailDelivery`, `pollEmailMailboxes` | 4 × `EMAIL_*` |

### 1.3 Five `onCall` callables exist that `index.ts` does NOT export

| callable | file | status |
|---|---|---|
| `createCycleCountCallable` | `functions/src/cycleCount/cycleCountCallables.ts` | v1 cycle count, de-exported (schema v2 replaced it). `index.ts` records that the four v1 functions **remain deployed** and that dropping the modules requires an operator action to delete them. **Retirement blocker — see tranche 0.** |
| `submitCycleCountCallable` | same | same |
| `reconcileCycleCountCallable` | same | same |
| `cancelCycleCountCallable` | same | same |
| `equipmentCompatibilityReadCallable` | `functions/src/equipmentCompatibility/equipmentCompatibilityReadCallable.ts` | deliberately unexported; `field-ops-app-vite/src/metadata/definitions/equipmentModel.js` nonetheless declares `readCallable: "equipmentCompatibilityReadCallable"`. That name is **not** in `callableListSource.js`'s `CALLABLE_SOURCES`, so `isKnownReadCallable` rejects it — the declaration is dangling but inert. |

### 1.4 Two authorization regimes, not one

This matters for retirement because they retire differently.

* **Governed capability regime** (153 exports) — `permissionCatalog.ts` capability + a
  `roleAssignments` document + per-environment activation, resolved by
  `resolveEffectivePermission`. Retiring one of these is an EOS authorization question.
* **Legacy security-role regime** (24 exports — two of them hybrid) — `users/{uid}.role ∈ {admin, dispatcher,
  technician}`, checked inside the service, **no capability at all, no `active:false` gate, no
  environment activation**. These are the ones that already allow in production today:
  the Work Order engine (`createWorkOrder`, `transitionWorkOrder`,
  `updateWorkOrderExecutionData`, `listWorkOrderConsumptionSources`, `getWorkOrderFieldContext`,
  `detectInventoryEffects`), the seven Scheduling callables, `completeAssignedJob`, and the nine
  Truck Registry callables. `functions/src/access/legacyAuthorizationSurface.ts` is the
  machine-checked census of the Rules half of this same regime.

---

## 2. Classification summary

| classification | count | meaning used here |
|---|---|---|
| `LIVE_BUSINESS_TRANSPORT` | **128** | deployed/deployable, a real client call path exists, and the gate can ALLOW a real principal in at least one **live** environment (`platform-sandbox`, `platform-certification`, `taylor-parts-production`) |
| `EXPORTED_BUT_UNREACHABLE` | **42** | deployed/deployable, but no browser can invoke it: no client transport names it, or its transport module is orphaned, or its client readiness flag is false in every live environment |
| `INERT_REGISTERED` | **9** | deployed/deployable **and** wired to a client, but the server denies or refuses for **every** principal in **every** environment — the capability is `active:false` and activated nowhere, or the command's own fail-closed predicate can never resolve |
| `IDENTITY_ONLY` | **0** | no exported callable is identity-only; Firebase Auth identity lives outside this surface and outside this fence |
| `MIGRATION_ONLY` | **0** | no exported callable exists solely to run a migration (`functions/migrations/` and `functions/src/serviceMigrations/` are scripts, not endpoints) |
| `TEST_ONLY` | **0** | no exported callable exists solely for tests |
| `DEAD_RETIREABLE` | **0** | see §5 — nothing on the 179 meets the bar |
| `UNKNOWN` | **0** | every export resolved; residual uncertainty is recorded as UNPROVEN in §8 rather than as a classification |

**`EXPORTED_BUT_UNREACHABLE` and `INERT_REGISTERED` are different retirement classes.**
An unreachable export is a *transport* decision: deleting it changes what a browser could call,
and the answer today is "nothing", so the blast radius is the deployed function estate.
An inert-registered export is an *authority* decision: the transport is wired and the UI is built;
what is missing is an Owner's activation or grant. Deleting one of those destroys work that is one
governed decision away from being useful, and the retirement question is "should this authority
exist at all?", not "is anyone calling it?".

---

## 3. `LIVE_BUSINESS_TRANSPORT` — the 128, with gate and grant status

### 3.1 Live in **production** (`taylor-parts`) — 26

These are the only exports a production principal can reach today. Everything else in production is
blocked by `active: false` (production resolves `capabilityActivationOverrides` to EMPTY
unconditionally — a role-keyed hard block) or by a readiness flag that is false there.

| export | gating authority | catalog state | granted Roles |
|---|---|---|---|
| `createWorkOrder` | `users/{uid}.role` = admin \| dispatcher | legacy — no capability | n/a |
| `transitionWorkOrder` | `users/{uid}.role`, per-action matrix | legacy | n/a |
| `updateWorkOrderExecutionData` | `users/{uid}.role` = technician | legacy | n/a |
| `listWorkOrderConsumptionSources` | `users/{uid}.role` = technician, own WO | legacy | n/a |
| `getWorkOrderFieldContext` | `users/{uid}.role` = technician, own WO | legacy | n/a |
| `rescheduleWorkOrderCallable` | `users/{uid}.role` = admin \| dispatcher | legacy | n/a |
| `reassignScheduledWorkOrderCallable` | `users/{uid}.role` = admin \| dispatcher | legacy | n/a |
| `setWorkOrderEstimatedDurationCallable` | `users/{uid}.role` = admin \| dispatcher | legacy | n/a |
| `readTechnicianAvailabilityCallable` | `users/{uid}.role` = admin \| dispatcher | legacy | n/a |
| `getAccountPortfolioSummary` | `customer.record.read` | **ACTIVE** | 20 Roles incl. admin, dispatcher, owner |
| `createReorderRequest` | `reorder.request.create.manual` | **ACTIVE** | admin, dispatcher, warehouseManager, partsManager, owner |
| `recordReorderPurchaseOrder` | `reorder.request.recordPurchaseOrder` | **ACTIVE** | admin, dispatcher, technician, purchasingManager, owner |
| `listReorderWarehouseOptions` | `reorder.request.create.manual` | **ACTIVE** | as above |
| `listImportedServiceHistory` | `customer.record.read` | **ACTIVE** | 20 Roles |
| `revokeRole` | `admin.roleAssignment.write` | **ACTIVE** | admin, owner |
| `assignApprovedRole` | `admin.roleAssignment.write` | **ACTIVE** | admin, owner |
| `setUserStatus` | `admin.userStatus.write` | **ACTIVE** | admin, owner |
| `readPrincipalAccessState` | `admin.principalAccess.read` | **ACTIVE** | admin, owner |
| `listPrivilegedRoleRequests` | `admin.principalAccess.read` | **ACTIVE** | admin, owner |
| `decidePrivilegedRoleRequest` | `admin.accessRequest.decide` | **ACTIVE** | admin, owner |
| `updateEmployeeProfile` | `admin.employeeProfile.write` | **ACTIVE** | admin, owner |
| `listRecordChangeHistory` | `audit.event.read` | **ACTIVE** | admin, salesManager, shopManager, generalManager, warehouseManager, partsManager, controller, … owner |
| `resolveEffectiveAccessCallable` | none — self-read of the caller's own effective access | n/a | any authenticated principal |
| `runReportDefinitionCallable` | `report.<object>.read` + `report.<object>.field.<f>.read` | INERT in catalog, **25 ids production-ADOPTED** via `productionCapabilityActivations` | admin, owner, reportViewer |
| `getSavedDefinitionCallable` | `report.definition.read` | INERT, **production-adopted** | admin, owner, reportViewer |
| `listSavedDefinitionsCallable` | `report.definition.read` | INERT, **production-adopted** | admin, owner, reportViewer |

### 3.2 Live in **platform-sandbox** only — 102

The whole sales/fulfillment/finance spine, Transfers, Cycle Count, bins/put-away/relocation,
Receiving, Part Master writes, serialized-asset acquire/install, CRM Activity, performance-goal
reads, Data Import, the ten Inbound Work callables and the eight email-transport callables, the
seven client-reachable Truck Registry writes, plus `setWorkOrderPartsPlan`,
`getWorkOrderReadinessContext` and the four saved-definition mutations. Each is listed with its
capability, catalog state, grants and environment in the full table in §9.

The mechanism is uniform: the capability is registered `active: false`, `platform-sandbox` declares
it in `capabilityActivationOverrides`, the resolver intersects that with
`SPINE_OVERRIDE_ELIGIBLE_IDS`, and a principal still needs a qualifying `roleAssignments` document.
`platform-certification` declares only three (`inventory.cycleCount.create/submit/reconcile`).
Production declares none.

---

## 4. `EXPORTED_BUT_UNREACHABLE` — 42

No browser can invoke these today. Three distinct sub-causes, which matter because they retire at
different cost.

### 4.1 No client transport module names them at all — 28

`detectInventoryEffects` · `getInventoryAnalytics` · `setTechnicianWorkingAvailabilityCallable` ·
`createTechnicianBlockedTimeCallable` · `deleteTechnicianBlockedTimeCallable` ·
`createSalesOrderFromOpportunity` · `createSalesOrder` · `issueInvoice` · `applyPayment` ·
`recordInvoiceAdjustment` · `recordRefund` · `interpretWorkOrderReadinessContext` · `grantRole` ·
`requestPrivilegedRole` · `approveAccessRequest` · `rejectAccessRequest` · `createSupplier` ·
`updateSupplier` · `activateSupplier` · `deactivateSupplier` · `getPartBalances` ·
`createPartSupplierItem` · `updatePartSupplierItem` · `changePartSupplierItemStatus` ·
`setPreferredSupplier` · `createPerformanceGoalDraft` · `approvePerformanceGoal` ·
`retirePerformanceGoal`

Every occurrence of these names in `field-ops-app-vite/src` is prose, a capability-catalog
description, or a metadata `enforcedBy` citation — never an `httpsCallable` argument and never a
`readCallable` the runtime dispatches. Two have a **script** caller
(`scripts/schedulingFunctionalGate.mjs` calls `createTechnicianBlockedTimeCallable` and
`deleteTechnicianBlockedTimeCallable`), which is an operational gate, not business transport, and is
a retirement dependency.

**Note the shape of the finance group.** `issueInvoice`, `applyPayment`,
`recordInvoiceAdjustment` and `recordRefund` are the only writers of `invoices`, `payments`,
`payment_applications`, `invoice_adjustments` and `refunds`, all of which are deny-all to every
client. Unreachable here means *no AR exists yet*, not *AR moved somewhere else*. The same is true
of `createSupplier`/`updateSupplier` for `suppliers` and of the four `partSupplierItem` writes.

### 4.2 The client transport module exists but is orphaned — 1

`completeAssignedJob`. `field-ops-app-vite/src/services/completionService.js` binds it correctly and
`TRUSTED_COMPLETION_ENABLED` is **true** in production — but the module's three exports
(`completeAssignedJobViaCallable`, `hasPendingCompletionAttempt`, `reconcilePendingCompletion`) are
imported by **nothing** outside its own tests. The index.ts header that says "No client calls it
(Field Mode's integration is PR-B)" is accurate; the readiness flag being true is not the whole
gate, and this is exactly the kind of export a "no importer ⇒ dead" rule would mis-retire, because
the deployed function is the designated replacement for a technician write path the Rules still
permit.

### 4.3 Wired to a client whose readiness flag is false in every live environment — 12

| export group | flag | value in sandbox / certification / production |
|---|---|---|
| `createPartAlias`, `deactivatePartAlias`, `reactivatePartAlias`, `listPartAliases`, `probePartAlias`, `resolveScannedPartIdentifier`, `lookupScannedPart` | `PART_IDENTIFIER_TRANSPORT_READY` | false / false / false |
| `getPartBalance` (its batched sibling `getPartBalances` has no client binding at all and sits in §4.1) | `INVENTORY_BALANCE_READ_READY` | false / false / false |
| `createManufacturer`, `updateManufacturer`, `changeManufacturerStatus` | `MANUFACTURER_WRITE_READY` | false / false / false |
| `deactivateTruckCallable` | `TRUCK_MANAGEMENT_WRITE_READY` + `TRUCK_DEACTIVATE_READY` | true+false / false+false / false+false |

Plus the orphaned `completeAssignedJob` (§4.2) and `pollEmailMailboxes`, which is a **schedule**, not a callable: it has no client by
construction, binds four `EMAIL_*` secrets, is on the sandbox exclusion list, and therefore runs on
no schedule anywhere. Deploying it is what would start it.

**These 12 are the cheapest reversible class and the most dangerous to delete.** The backend is
governed, the UI is built, and the gate is a compile-time constant baked into a Hosting bundle.
`truckManagementReadiness.js` records the live-exposure caveat explicitly: a previously released
production bundle may still carry an old `true`, so the repository declaration being false does not
prove the live browser agrees.

---

## 5. `INERT_REGISTERED` — 9, and why none of them is `DEAD_RETIREABLE`

The server refuses these for every principal in every environment.

| export | mechanism | granted Roles | why it is not dead |
|---|---|---|---|
| `createSalesTerritory` | `coverage.write` `active:false`, in **no** environment's activation set and **not** in `SPINE_OVERRIDE_ELIGIBLE_IDS` | admin, owner | the only writer of `sales_territories` (Admin-SDK-only) |
| `createCoverageAssignment` | `coverage.write`, same | admin, owner | the only writer of `commercial_coverage_assignments` |
| `resolveCoverageForContext` | `coverage.read`, same | admin, owner | the only reader of those two collections; `metadata/definitions/salesTerritory.js` names this as a genuinely unreachable read |
| `initiateAdminPasswordReset` | `admin.credentialReset.initiate` `active:false`, explicitly excluded from sandbox eligibility; delivery additionally wired `NOT_CONFIGURED_DELIVERY` | admin, owner | AUTH-PR-3's whole surface; fails closed with zero Auth side effects |
| `listResetEligibleUsers` | same | admin, owner | same |
| `recordWorkOrderLabor` | `workOrder.labor.record` `active:false`, in no activation set | admin, owner, technicianLaborRecorder | only writer of `work_order_labor_entries` (no Rules match block ⇒ deny-all) |
| `getWorkOrderLabor` | `workOrder.labor.record`, same | as above | only reader of the same |
| `correctWorkOrderLabor` | `workOrder.labor.correct`, same | admin, owner, workOrderLaborCorrector | the only correction path; a mutable `workOrder.laborHours` is explicitly not the replacement |
| `deleteTruckCreatedInErrorCallable` | **not** a capability — `operationalReferenceProbe.ts` aggregates 11 governed authorities; **6 are unmodelled on the current schema**, so the aggregate is *necessarily* `UNKNOWN` and the command refuses `REFERENCE_STATE_UNKNOWN` for every caller | `users/{uid}.role` = admin, re-read inside the transaction | proving it cannot succeed is not proving it should not exist; the probe header is a code+review artifact naming exactly which six authorities are the blocker |

**`DEAD_RETIREABLE` is empty, and that is a finding, not an omission.** Every one of the 179 is
either live somewhere, or the sole path to a collection that is deny-all to clients, or one Owner
decision from being live. Retiring any of them retires an authority, not just a wire.

### 5.1 The one thing in `functions/src` that genuinely is wired to nothing

**`functions/src/assistant/` — 15 modules — VERIFIED wired to nothing.**

* No `onCall` and no `firebase-functions` import anywhere in the directory.
* Not exported from `functions/src/index.ts`, directly or transitively.
* The only non-test importer in the entire repository is
  `functions/scripts/aiProviderSelfCheck.mjs`, a self-check script.
* The three test files that import it (`aiProviderPolicyAndSelfHosted.test.mjs`,
  `assistantStartersAndEvaluation.test.mjs`, `assistantSecurityBoundary.test.mjs`) are its only
  other consumers.
* `functions/src/ai/types.ts` mentions it in a comment explaining why `ai/` is separate; that is
  prose, not an import.

It is not on the 179 because it is not transport. Classified `DEAD_RETIREABLE` **as a module
group, not as an export**, with the one dependency named: the self-check script and three test
files go with it. This is the only retirement in this census that removes no business authority.

---

## 6. The Render EOS API side — what already exists, and what it does not

### 6.1 It is deployed. The code that says otherwise is stale.

`functions/src/eosApi/server.ts`'s header says "**NOT DEPLOYED** … there is no Render service, and
creating one needs Owner action." `field-ops-app-vite/src/services/adminPolicyApiClient.js` says
"`VITE_EOS_API_BASE_URL` is absent in every environment today, because no EOS API is deployed."
`docs/architecture/eos-policy-nonprod-activation.md` says "Status: MERGED TO `main`. NOT DEPLOYED."

`docs/architecture/eos-real-nonprod-activation.md` — the newer document, measured 2026-09-10 through
the Render MCP — records the opposite for non-production:

| | |
|---|---|
| EOS API | `https://eos-api-nonprod.onrender.com` · `srv-dah49f1t0dsc73egpvi0` · starter · 1 instance · Oregon |
| PostgreSQL | `eos-policy-nonprod` · PostgreSQL 16 · migrations `001` `002` `003` |
| frontend | `https://verenwardeos.vercel.app` |
| tenant | `taylor-nonprod` |
| production | **untouched, and out of scope** |

`render.yaml` is the committed non-production Blueprint for exactly that service, and
`readServiceConfig` refuses to start if `EOS_ENVIRONMENT` names production.

### 6.2 The complete Render operation surface today — 25 operations on two closed lists

**Administration API** — `POST /admin/policy`, `functions/src/adminPolicy/adminPolicyApi.ts`:

*9 reads*: `listTenantPrincipals`, `listObjects`, `readObjectWithFields`, `listRoles`,
`readRolePolicy`, `listPrincipalRoleAssignments`, `listWorkflows`, `readWorkflowVersion`,
`readPolicyAuditHistory`.

*15 mutations*: `updateObjectMetadata`, `createCustomField`, `updateCustomFieldMetadata`,
`createRole`, `updateRole`, `setObjectPermission`, `setFieldPermissionOverride`,
`removeFieldPermissionOverride`, `assignRole`, `revokeRole`, `createWorkflowDraft`,
`createWorkflowVersion`, `updateWorkflowDefinition`, `setWorkflowRoleBinding`,
`publishWorkflowVersion`.

**Operations API** — `POST /operations/inventory`, `functions/src/eosOps/eosOpsHttp.ts`:

*1 read*: **`resolveMyCapabilities`** — and that is the entire list.
`OPERATIONS_READ_OPERATIONS` is `Object.freeze(["resolveMyCapabilities"])`. The file states its own
scope: "There is deliberately no `POST /sql`, no `mutate(table, id, patch)`, no Firestore proxy, and
no route that takes a table name."

Plus `GET /health`. `server.ts` routes anything under `/operations/` to the Operations handler and
everything else to the Administration handler.

**There is no browser client for the Operations API.** `adminPolicyApiClient.js` is the only EOS API
client in the frontend and it mirrors only the Administration list. `resolveMyCapabilities` has no
caller in this repository outside its own tests.

### 6.3 The replacement map, honestly

| Firebase Functions business authority | Render EOS API replacement today |
|---|---|
| `grantRole`, `revokeRole`, `assignApprovedRole` | **`assignRole` / `revokeRole`** on the Administration API — the only genuine one-for-one replacement in the census |
| `readPrincipalAccessState`, `listPrivilegedRoleRequests` | **partial** — `listPrincipalRoleAssignments` + `listTenantPrincipals` cover assignment state; the privileged-request workflow has no Render operation |
| `resolveEffectiveAccessCallable` | **partial** — `resolveMyCapabilities` answers the same question (what does this principal hold) from PostgreSQL; the response shape differs and no client consumes it |
| every Work Order engine callable (createWorkOrder, transitionWorkOrder, updateWorkOrderExecutionData, the 7 Scheduling callables, completeAssignedJob) | **none.** The 5 stored workflow state machines in `eos-policy-nonprod` are all **DRAFT** |
| the sales / opportunity / sales-order / sales-agreement spine (24 callables) | **none** |
| finance / AR / invoicing / payments / refunds (8 callables) | **none** |
| all inventory: receiving, transfers, cycle count, bins, put-away, relocation, balances, returns, serialized assets, part/supplier/manufacturer master (60+ callables) | **none.** `functions/src/eosOps/` holds the repositories (`inventoryCommitmentRepository`, `purchasingRepository`, `warehouseBinRepository`, `truckFleetRepository`, `cycleCountRepository`, `supplierCatalogRepository`, `equipmentCustody`, `invoiceAuthority`, `cashApplicationAuthority`, `operatingCompanyCustody`) — **built, typechecked, and reachable through no operation**, because the closed list has one entry |
| CRM activity, performance goals, data import, inbound work / email intake (30 callables) | **none** |
| `updateEmployeeProfile`, `listRecordChangeHistory` | **partial** — `readPolicyAuditHistory` covers policy audit only, not record change history |

**One callable family of 179 has a named, deployed Render replacement.** Everything else has a
repository waiting behind a closed operation list of one. That is the central finding of this
census: the Functions retirement is not blocked by transport, it is blocked by the Operations API
having exactly one read on it.

---

## 7. Claims in the tree that this lane found stale

Recorded so the next lane does not re-trust them. **No file was corrected — this is an evidence lane.**

| where | claim | measured |
|---|---|---|
| `functions/src/eosApi/server.ts` header | "NOT DEPLOYED … there is no Render service" | the non-production service **is** deployed (`eos-api-nonprod.onrender.com`), per `eos-real-nonprod-activation.md` measured through the Render MCP |
| `field-ops-app-vite/src/services/adminPolicyApiClient.js:26` | "`VITE_EOS_API_BASE_URL` is absent in every environment today, because no EOS API is deployed" | same |
| `field-ops-app-vite/src/config/inventoryBalanceReadiness.js` | "`inventory.balance.read` is registered `active:false` **and granted to no Role**" | `active:false` is correct; **granted to 17 Roles** (admin, salesManager, purchasingManager, shopManager, shopAssociate, salesperson, generalManager, warehouseManager, warehouseAssociate, partsManager, partsAssociate, controller, accountingManager, financeManager, fieldManager, owner, inventoryLookupReader) and **activated in platform-sandbox**. Also names one callable; there are now two (`getPartBalance`, `getPartBalances`) |
| `field-ops-app-vite/src/config/partIdentifierReadiness.js` | "The **five** callables … are EXPORTED but NOT DEPLOYED, and `inventory.catalog.manage` is not granted to any standing role" | **seven** are exported now (`resolveScannedPartIdentifier`, `lookupScannedPart` added); all seven are in the 170-name sandbox-deployable set; and **`inventory.catalog.manage` is `ACTIVE` (not inert) and granted to admin, generalManager, warehouseManager, partsManager, fieldManager, operationsManager, owner** |
| `functions/src/index.ts` — Supplier Master, Part Master, Manufacturer, partSupplierItem blocks | "NO capability is granted here; catalog capabilities are carried by no standing role, so create/update/status fail closed until a deferred protected grant" | **false on both halves.** `inventory.catalog.manage` and `inventory.catalog.activate` are both `ACTIVE(default)` in the catalog and both granted — `activate` to admin, owner, inventoryCatalogAdministrator. These commands allow for a granted principal wherever deployed; what stops them is the **client** readiness flag, not the authority |
| `functions/src/index.ts` — reporting D-FN block | "No client calls it (the client run seam … is unchanged and still unconditionally unavailable)" | `field-ops-app-vite/src/domain/reporting/reportExecutionSeam.js` calls `runReportDefinitionCallable` **unconditionally**, and `modules/reporting/ReportBuilder.jsx` imports and invokes it. With 25 `report.*` ids **production-adopted**, this is live production transport |
| `functions/src/index.ts` — several blocks | "capability … registered `active:false` … granted to **NO** Role" (bin/placement/relocate, cycleCount, transfer, equipment.install, serializedAsset.*, returns.intake, crm.activity.*, …) | `active:false` is correct everywhere it is claimed. **"Granted to no Role" is stale for every one of them**: of 147 catalogued capabilities, **zero** are inert-and-ungranted. The governed Role catalog (45 Roles beyond the 3 compatibility Roles) now carries every one |
| `field-ops-app-vite/src/metadata/definitions/equipmentModel.js:123` | declares `readCallable: "equipmentCompatibilityReadCallable"` | that callable is genuinely unexported, and the name is absent from `callableListSource.js`'s `CALLABLE_SOURCES`, so `isKnownReadCallable` rejects it. Dangling but inert |

---

## 8. UNPROVEN

Stated as unproven rather than assumed either way.

1. **What is actually deployed to `taylor-parts` (production).** No production function inventory
   exists in this repository. `truckManagementReadiness.js` records the same gap and fails closed
   because of it. This census reasons about *deployability* and *authorization*, both of which are
   provable from source; it does not claim a production deployment set. **No retirement tranche may
   delete a deployed function on the strength of this document alone.**
2. **Whether the four orphaned v1 Cycle Count functions are still live.** `index.ts` says they are
   deployed and that dropping the modules requires an operator delete. Unverifiable locally.
3. **Whether any production principal holds a `roleAssignments` document.** The sandbox admin
   persona does (`roleAssignments/bootstrap-admin-<uid>`, recorded in `index.ts`). For production,
   nothing in the tree establishes it either way — which is the difference between "these 26 exports
   *can* allow in production" (proven) and "they *do* allow someone" (unproven).
4. **Whether a released production Hosting bundle still carries an old `true` readiness constant.**
   `truckManagementReadiness.js` names this as a live, tracked exposure. A repository constant is
   not evidence about the bundle a browser loaded.
5. **Whether `platform-certification` and `platform-sandbox` hold the same deployed function set.**
   Both are `status: live`; only the sandbox refresh path is scripted.
6. **The `deleteTruckCreatedInErrorCallable` probe's behaviour against real data.** Its aggregate is
   *necessarily* UNKNOWN by construction on the current schema — that much is proven from the code.
   It was not executed.

---

## 9. Retirement tranches, in dependency order

Each tranche states what it removes, what must be true first, and what it does **not** touch.
**Nothing in this section has been executed.**

### Tranche 0 — operator reconciliation (removes nothing from source)

Delete the four **deployed** v1 Cycle Count functions (`createCycleCount`, `submitCycleCount`,
`reconcileCycleCount`, `cancelCycleCount`) from every project that carries them. They are already
de-exported; the source modules survive as frozen Certification tooling. This is an operator
action and a prerequisite for any later deletion of `functions/src/cycleCount/cycleCountCallables.ts`.
**Blocked on:** UNPROVEN #2 — an actual per-project function inventory.

### Tranche 1 — `functions/src/assistant/` (the only clean retirement)

Remove the 15 modules, `functions/scripts/aiProviderSelfCheck.mjs`, and the three test files that
import them. Removes **no** business authority, **no** export, **no** deployed function.
**Blocked on:** nothing. Verified in §5.1.

### Tranche 2 — the 28 exports with no client transport of any kind (§4.1)

Retire as **deployed functions**, source last. Two hard dependencies before anything is removed:

* `createTechnicianBlockedTimeCallable` and `deleteTechnicianBlockedTimeCallable` are invoked by
  `scripts/schedulingFunctionalGate.mjs`. That gate retires with them or is repointed first.
* The finance group (`issueInvoice`, `applyPayment`, `recordInvoiceAdjustment`, `recordRefund`),
  the supplier group and the four `partSupplierItem` writes are the **sole** writers of
  Admin-SDK-only collections. Retiring them retires the ability to create AR, suppliers and
  procurement terms at all. That needs an Owner ruling that those authorities are not wanted, or a
  Render replacement — of which **none exists** (§6.3).

**Recommended split:** 2a = the seven with no downstream authority
(`detectInventoryEffects`, `getInventoryAnalytics`, the three Scheduling availability writes,
`grantRole`/`requestPrivilegedRole`/`approveAccessRequest`/`rejectAccessRequest` — note `grantRole`
is the one with a real Render replacement, `assignRole`). 2b = everything that owns a collection,
deferred to tranche 5.

### Tranche 3 — the schedule and the secret-bound email transport

`pollEmailMailboxes` runs nowhere (excluded from the only scripted deploy path, binds four absent
secrets). The eight `emailTransportCallables` are in the same position. They are wired to a client
and capability-activated in sandbox, so this is **not** a deletion — it is a decision to stop the
email-intake programme. Retire only on that decision.

### Tranche 4 — the 12 readiness-gated exports (§4.3)

Part identifiers (7), `getPartBalance`, manufacturer writes (3), `deactivateTruckCallable`, and
by extension the whole Truck Registry write family. Each is a compile-time constant away from live.
**Blocked on:** UNPROVEN #4 — what a released production bundle actually carries. Flipping a flag
off in the registry does not retract a bundle already served. Retire the **flag and the client
surface first**, ship a Hosting release, *then* the function.

### Tranche 5 — the sandbox-only governed spine (102 exports, §3.2)

The sales/finance/inventory/CRM/import/inbound-work spine. **Blocked on the Render Operations API.**
`functions/src/eosOps/` already holds ten repositories covering inventory commitment, purchasing,
warehouse bins, truck fleet, cycle count, supplier catalog, equipment custody, invoice authority,
cash application and operating-company custody — behind `OPERATIONS_READ_OPERATIONS`, a frozen list
with **one** entry. The named prerequisite is: extend that closed list, one governed operation at a
time, each with its own EOS authorization; then dual-read; then cut over; then retire. No tranche-5
retirement is safe before its replacement operation is on that list and serving.

### Tranche 6 — the 9 `INERT_REGISTERED` exports (§5)

Coverage (3), admin credential reset (2), Work Order labour (3), `deleteTruckCreatedInError` (1).
These are authority decisions, not transport decisions. Each needs an explicit Owner ruling that the
authority is abandoned. For `deleteTruckCreatedInError`, the alternative to retirement is modelling
the six missing operational-reference authorities.

### Tranche 7 — the 26 production-live exports (§3.1)

Last, and only behind a live Render replacement per row. The nine legacy-`users/{uid}.role` Work
Order/Scheduling callables additionally depend on the legacy-role retirement programme
(`legacyAuthorizationSurface.ts`, ADR-005 §2.7, Issue #226 rows 23–26) and on the five stored EOS
workflow state machines leaving DRAFT. `grantRole`/`revokeRole`/`assignApprovedRole` can go first —
they are the only family with a deployed one-for-one replacement.

---

## 10. Full export table (179)

`allows in` names the **live** environments (`platform-sandbox`, `platform-certification`,
`taylor-parts-production`) in which the gating authority can resolve ALLOW for a principal holding a
qualifying Role and the client readiness gate is true. `— none` means no live environment.

| # | deployed export | source module | gating authority | catalog state | granted Roles (sample) | client transport | client readiness gate | allows in (live envs) | classification |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `createWorkOrder` | `./createWorkOrder` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 2 | `transitionWorkOrder` | `./transitionWorkOrder` | LEGACY:users.role (per-action matrix) | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 3 | `updateWorkOrderExecutionData` | `./updateWorkOrderExecutionData` | LEGACY:users.role technician | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 4 | `listWorkOrderConsumptionSources` | `./workOrderConsumption/consumptionSourceCallables` | LEGACY:users.role technician (own WO) | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 5 | `detectInventoryEffects` | `./inventoryEffectCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 6 | `getInventoryAnalytics` | `./inventoryAnalyticsCallables` | inventory.analytics.read | ACTIVE(default) | admin|dispatcher|owner | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 7 | `getAccountPortfolioSummary` | `./account/accountPortfolioSummary` | customer.record.read | ACTIVE(default) | accountingManager|admin|controller|dispatcher|fieldManager… | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 8 | `setWorkOrderPartsPlan` | `./workOrderPartsPlan/setWorkOrderPartsPlan` | workOrder.parts.plan | INERT | admin|owner|workOrderPartsPlanner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 9 | `rescheduleWorkOrderCallable` | `./scheduling/schedulingCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 10 | `reassignScheduledWorkOrderCallable` | `./scheduling/schedulingCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 11 | `setWorkOrderEstimatedDurationCallable` | `./scheduling/schedulingCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 12 | `setTechnicianWorkingAvailabilityCallable` | `./scheduling/schedulingCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 13 | `createTechnicianBlockedTimeCallable` | `./scheduling/schedulingCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 14 | `deleteTechnicianBlockedTimeCallable` | `./scheduling/schedulingCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 15 | `readTechnicianAvailabilityCallable` | `./scheduling/schedulingCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 16 | `createOpportunity` | `./opportunity/opportunityCallables` | opportunity.write | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 17 | `transitionOpportunity` | `./opportunity/opportunityCallables` | opportunity.write | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 18 | `updateOpportunity` | `./opportunity/opportunityCallables` | opportunity.write | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 19 | `createReorderRequest` | `./reorderRequest/reorderCallables` | reorder.request.create.manual | ACTIVE(default) | admin|dispatcher|owner|partsManager|warehouseManager | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 20 | `recordReorderPurchaseOrder` | `./reorderRequest/reorderCallables` | reorder.request.recordPurchaseOrder | ACTIVE(default) | admin|dispatcher|owner|purchasingManager|technician | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 21 | `listReorderWarehouseOptions` | `./reorderRequest/reorderCallables` | reorder.request.create.manual | ACTIVE(default) | admin|dispatcher|owner|partsManager|warehouseManager | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 22 | `listOpportunityContext` | `./opportunity/opportunityReadService` | opportunity.read | INERT | accountingManager|admin|controller|dispatcher|financeManag… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 23 | `listOpportunitiesForAccount` | `./opportunity/opportunityReadService` | opportunity.read | INERT | accountingManager|admin|controller|dispatcher|financeManag… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 24 | `getOpportunityContext` | `./opportunity/opportunityReadService` | opportunity.read | INERT | accountingManager|admin|controller|dispatcher|financeManag… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 25 | `createSalesOrderFromOpportunity` | `./opportunity/createSalesOrderFromOpportunity` | opportunity.createSalesOrder | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 26 | `closeOpportunityAsWon` | `./opportunity/closeOpportunityAsWon` | opportunity.write + opportunity.createSalesOrder | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 27 | `getSalesOrderContext` | `./salesOrder/salesOrderReadService` | salesOrder.read | INERT | accountingManager|admin|controller|dispatcher|fieldManager… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 28 | `listSalesOrdersForAccount` | `./salesOrder/salesOrderReadService` | salesOrder.read | INERT | accountingManager|admin|controller|dispatcher|fieldManager… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 29 | `listSalesOrderIndex` | `./salesOrder/salesOrderReadService` | salesOrder.read | INERT | accountingManager|admin|controller|dispatcher|fieldManager… | YES (dynamic) | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 30 | `createSalesAgreement` | `./salesAgreement/salesAgreementCallables` | salesAgreement.create | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 31 | `updateSalesAgreementDraft` | `./salesAgreement/salesAgreementCallables` | salesAgreement.updateDraft | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 32 | `acceptSalesAgreement` | `./salesAgreement/salesAgreementCallables` | salesAgreement.accept | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 33 | `getSalesAgreementContext` | `./salesAgreement/salesAgreementReadService` | salesAgreement.read | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 34 | `getSalesAgreementForOpportunity` | `./salesAgreement/salesAgreementReadService` | salesAgreement.read | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 35 | `searchProductReferences` | `./salesAgreement/productReferenceSearchService` | inventory.catalog.read | INERT | accountingManager|admin|controller|dispatcher|fieldManager… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 36 | `getManufacturerCatalog` | `./partMaster/manufacturerReadService` | inventory.catalog.read | INERT | accountingManager|admin|controller|dispatcher|fieldManager… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 37 | `getAvailableEquipment` | `./serializedAsset/serializedAssetReadService` | inventory.serializedAsset.read | INERT | accountingManager|admin|controller|fieldManager|financeMan… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 38 | `listCoordinatedOperations` | `./fulfillment/coordinatedVisitReadService` | fulfillment.coordinatedVisit.read | INERT | admin|dispatcher|fieldManager|operationsManager|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 39 | `getLocationDisplay` | `./inventoryLocation/locationDisplayReadService` | inventory.location.display.read | INERT | admin|inventoryLookupReader|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 40 | `createSalesOrder` | `./salesOrder/salesOrderCallables` | salesOrder.write | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 41 | `transitionSalesOrder` | `./salesOrder/salesOrderCallables` | salesOrder.write | INERT | admin|dispatcher|generalManager|owner|salesManager|salespe… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 42 | `allocateSalesOrder` | `./fulfillment/allocateSalesOrder` | salesOrder.fulfill | INERT | admin|dispatcher|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 43 | `createServiceForSalesOrder` | `./salesOrder/createServiceForSalesOrder` | salesOrder.service | INERT | admin|dispatcher|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 44 | `issueInvoice` | `./finance/invoiceCallables` | finance.invoice.issue | INERT | accountingManager|admin|controller|financeManager|generalM… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 45 | `applyPayment` | `./finance/paymentCallables` | finance.payment.apply | INERT | accountingManager|admin|controller|financeManager|generalM… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 46 | `recordInvoiceAdjustment` | `./finance/adjustmentCallables` | finance.adjustment.record | INERT | accountingManager|admin|controller|financeManager|generalM… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 47 | `listAccountInvoiceAr` | `./finance/financeReadCallables` | finance.read | INERT | accountingManager|admin|controller|fieldManager|financeMan… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 48 | `listFinancialFacts` | `./finance/financialReportingRead` | finance.read + finance.visibility.* | INERT | accountingManager|admin|controller|fieldManager|financeMan… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 49 | `createSalesTerritory` | `./coverage/coverageCallables` | coverage.write | INERT | admin|owner | NO | - | — none | INERT_REGISTERED |
| 50 | `createCoverageAssignment` | `./coverage/coverageCallables` | coverage.write | INERT | admin|owner | NO | - | — none | INERT_REGISTERED |
| 51 | `resolveCoverageForContext` | `./coverage/coverageReadCallables` | coverage.read | INERT | admin|owner | NO | - | — none | INERT_REGISTERED |
| 52 | `recordRefund` | `./finance/refundCallables` | finance.refund.record | INERT | accountingManager|admin|controller|financeManager|generalM… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 53 | `getWorkOrderFieldContext` | `./getWorkOrderFieldContext` | LEGACY:users.role technician (own WO) | LEGACY_ROLE | users/{uid}.role | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 54 | `getWorkOrderReadinessContext` | `./ai/workOrderReadinessContext` | LEGACY:users.role (WO assignment) + reorder.request.read.queue | ACTIVE(default) | admin|dispatcher|operationsManager|owner|partsManager|purc… | YES | WORK_ORDER_READINESS_CONTEXT_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 55 | `interpretWorkOrderReadinessContext` | `./ai/workOrderReadinessContext` | same as getWorkOrderReadinessContext + private-AI env classification | n/a | - | NO | WORK_ORDER_READINESS_CONTEXT_READY | sandbox | EXPORTED_BUT_UNREACHABLE |
| 56 | `completeAssignedJob` | `./completeAssignedJob` | LEGACY:users.role technician (own WO) | LEGACY_ROLE | users/{uid}.role | ORPHANED | TRUSTED_COMPLETION_ENABLED | sandbox, production | EXPORTED_BUT_UNREACHABLE |
| 57 | `grantRole` | `./access/accessCommandCallables` | admin.roleAssignment.write | ACTIVE(default) | admin|owner | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 58 | `revokeRole` | `./access/accessCommandCallables` | admin.roleAssignment.write | ACTIVE(default) | admin|owner | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 59 | `assignApprovedRole` | `./access/accessCommandCallables` | admin.roleAssignment.write | ACTIVE(default) | admin|owner | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 60 | `requestPrivilegedRole` | `./access/accessCommandCallables` | admin.roleAssignment.write | ACTIVE(default) | admin|owner | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 61 | `decidePrivilegedRoleRequest` | `./access/accessCommandCallables` | admin.accessRequest.decide | ACTIVE(default) | admin|owner | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 62 | `listPrivilegedRoleRequests` | `./access/accessCommandCallables` | admin.principalAccess.read | ACTIVE(default) | admin|owner | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 63 | `readPrincipalAccessState` | `./access/accessCommandCallables` | admin.principalAccess.read | ACTIVE(default) | admin|owner | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 64 | `setUserStatus` | `./access/accessCommandCallables` | admin.userStatus.write | ACTIVE(default) | admin|owner | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 65 | `approveAccessRequest` | `./access/accessCommandCallables` | admin.accessRequest.decide | ACTIVE(default) | admin|owner | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 66 | `rejectAccessRequest` | `./access/accessCommandCallables` | admin.accessRequest.decide | ACTIVE(default) | admin|owner | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 67 | `runReportDefinitionCallable` | `./reporting/runReportDefinitionCallable` | report.<object>.read + report.<object>.field.<f>.read | n/a | - | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 68 | `createSavedDefinitionCallable` | `./reporting/savedDefinitionCallables` | report.definition.create | INERT | admin|owner|reportAuthor | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 69 | `getSavedDefinitionCallable` | `./reporting/savedDefinitionCallables` | report.definition.read | INERT | admin|owner|reportViewer | YES | - | sandbox, production | LIVE_BUSINESS_TRANSPORT |
| 70 | `listSavedDefinitionsCallable` | `./reporting/savedDefinitionCallables` | report.definition.read | INERT | admin|owner|reportViewer | YES | - | sandbox, production | LIVE_BUSINESS_TRANSPORT |
| 71 | `renameSavedDefinitionCallable` | `./reporting/savedDefinitionCallables` | report.definition.rename | INERT | admin|owner|reportAuthor | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 72 | `duplicateSavedDefinitionCallable` | `./reporting/savedDefinitionCallables` | report.definition.duplicate | INERT | admin|owner|reportAuthor | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 73 | `deleteSavedDefinitionCallable` | `./reporting/savedDefinitionCallables` | report.definition.delete | INERT | admin|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 74 | `resolveEffectiveAccessCallable` | `./access/effectiveAccessFeedCallable` | NONE (self-read of own effective access) | NONE | - | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 75 | `initiateAdminPasswordReset` | `./access/adminCredentialCallables` | admin.credentialReset.initiate | INERT | admin|owner | YES | - | — none | INERT_REGISTERED |
| 76 | `listResetEligibleUsers` | `./access/adminCredentialCallables` | admin.credentialReset.initiate | INERT | admin|owner | YES | - | — none | INERT_REGISTERED |
| 77 | `updateEmployeeProfile` | `./access/administrationUsersCallables` | admin.employeeProfile.write | ACTIVE(default) | admin|owner | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 78 | `listRecordChangeHistory` | `./access/administrationUsersCallables` | audit.event.read | ACTIVE(default) | accountingManager|admin|controller|fieldManager|financeMan… | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 79 | `createTruckCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 80 | `assignTruckDriverCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 81 | `reassignTruckDriverCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 82 | `unassignTruckDriverCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 83 | `changeTruckStatusCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 84 | `changeTruckHomeWarehouseCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 85 | `deactivateTruckCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY+TRUCK_DEACTIVATE_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 86 | `reactivateTruckCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin|dispatcher | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 87 | `deleteTruckCreatedInErrorCallable` | `./truckRegistry/truckRegistryCallables` | LEGACY:users.role admin (txn-read) | LEGACY_ROLE | users/{uid}.role | YES | TRUCK_MANAGEMENT_WRITE_READY+TRUCK_DELETE_READY | — none | INERT_REGISTERED |
| 88 | `receiveInventoryStock` | `./inventoryReceiving/receivingCallables` | inventory.stock.receive | ACTIVE(default) | admin|dispatcher|inventoryReceivingClerk|owner | YES | RECEIVING_TRANSPORT_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 89 | `getPurchaseOrderReceivingProgress` | `./inventoryReceiving/receivingCallables` | inventory.stock.receive | ACTIVE(default) | admin|dispatcher|inventoryReceivingClerk|owner | YES | RECEIVING_TRANSPORT_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 90 | `listReceivablePurchaseOrders` | `./inventoryReceiving/receivingCallables` | inventory.stock.receive | ACTIVE(default) | admin|dispatcher|inventoryReceivingClerk|owner | YES | RECEIVING_TRANSPORT_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 91 | `listReceivingLocationOptions` | `./inventoryReceiving/receivingCallables` | inventory.stock.receive | ACTIVE(default) | admin|dispatcher|inventoryReceivingClerk|owner | YES | RECEIVING_TRANSPORT_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 92 | `createTransferOrder` | `./inventoryTransfer/transferCallables` | inventory.transfer.create | INERT | admin|inventoryTransferOperator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 93 | `dispatchTransferOrder` | `./inventoryTransfer/transferCallables` | inventory.transfer.dispatch | INERT | admin|inventoryTransferOperator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 94 | `receiveTransferOrder` | `./inventoryTransfer/transferCallables` | inventory.transfer.receive | INERT | admin|inventoryTransferOperator|inventoryTransferReceiver|… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 95 | `cancelTransferOrder` | `./inventoryTransfer/transferCallables` | inventory.transfer.cancel | INERT | admin|inventoryTransferOperator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 96 | `listMyReceivableTransfers` | `./inventoryTransfer/transferCallables` | inventory.transfer.receive | INERT | admin|inventoryTransferOperator|inventoryTransferReceiver|… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 97 | `createCycleCountSheet` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.create | INERT | admin|inventoryCycleCountCounter|owner | YES | - | sandbox, certification | LIVE_BUSINESS_TRANSPORT |
| 98 | `openCycleCountLine` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.create | INERT | admin|inventoryCycleCountCounter|owner | YES | - | sandbox, certification | LIVE_BUSINESS_TRANSPORT |
| 99 | `submitCycleCountLine` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.submit | INERT | admin|inventoryCycleCountCounter|owner | YES | - | sandbox, certification | LIVE_BUSINESS_TRANSPORT |
| 100 | `reconcileCycleCountLine` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.reconcile | INERT | admin|inventoryCycleCountReconciler|owner | YES | - | sandbox, certification | LIVE_BUSINESS_TRANSPORT |
| 101 | `cancelCycleCountLine` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.cancel | INERT | admin|inventoryCycleCountCounter|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 102 | `cancelCycleCountSheet` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.cancel | INERT | admin|inventoryCycleCountCounter|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 103 | `closeCycleCountSheet` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.reconcile | INERT | admin|inventoryCycleCountReconciler|owner | YES | - | sandbox, certification | LIVE_BUSINESS_TRANSPORT |
| 104 | `listCycleCountSheets` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.create | INERT | admin|inventoryCycleCountCounter|owner | YES | - | sandbox, certification | LIVE_BUSINESS_TRANSPORT |
| 105 | `getCycleCountSheet` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.create | INERT | admin|inventoryCycleCountCounter|owner | YES | - | sandbox, certification | LIVE_BUSINESS_TRANSPORT |
| 106 | `getCycleCountAssignedMobileLocation` | `./cycleCount/cycleCountSheetCallables` | inventory.cycleCount.submit | INERT | admin|inventoryCycleCountCounter|owner | YES | - | sandbox, certification | LIVE_BUSINESS_TRANSPORT |
| 107 | `createSupplier` | `./supplierMaster/supplierMasterCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 108 | `updateSupplier` | `./supplierMaster/supplierMasterCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 109 | `activateSupplier` | `./supplierMaster/supplierMasterCallables` | inventory.catalog.activate | ACTIVE(default) | admin|inventoryCatalogAdministrator|owner | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 110 | `deactivateSupplier` | `./supplierMaster/supplierMasterCallables` | inventory.catalog.activate | ACTIVE(default) | admin|inventoryCatalogAdministrator|owner | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 111 | `createPart` | `./partMaster/partMasterCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | PART_MASTER_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 112 | `updatePart` | `./partMaster/partMasterCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | PART_MASTER_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 113 | `changePartStatus` | `./partMaster/partMasterCallables` | inventory.catalog.activate | ACTIVE(default) | admin|inventoryCatalogAdministrator|owner | YES | PART_MASTER_WRITE_READY | sandbox | LIVE_BUSINESS_TRANSPORT |
| 114 | `createManufacturer` | `./partMaster/manufacturerCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | MANUFACTURER_WRITE_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 115 | `updateManufacturer` | `./partMaster/manufacturerCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | MANUFACTURER_WRITE_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 116 | `changeManufacturerStatus` | `./partMaster/manufacturerCallables` | inventory.catalog.activate | ACTIVE(default) | admin|inventoryCatalogAdministrator|owner | YES | MANUFACTURER_WRITE_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 117 | `createPartAlias` | `./partMaster/partAliasCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | PART_IDENTIFIER_TRANSPORT_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 118 | `deactivatePartAlias` | `./partMaster/partAliasCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | PART_IDENTIFIER_TRANSPORT_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 119 | `reactivatePartAlias` | `./partMaster/partAliasCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | PART_IDENTIFIER_TRANSPORT_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 120 | `listPartAliases` | `./partMaster/partAliasCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | PART_IDENTIFIER_TRANSPORT_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 121 | `probePartAlias` | `./partMaster/partAliasCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | YES | PART_IDENTIFIER_TRANSPORT_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 122 | `resolveScannedPartIdentifier` | `./partMaster/partAliasCallables` | inventory.catalog.alias.read | INERT | admin|inventoryLookupReader|inventoryStockRelocationOperat… | YES | PART_IDENTIFIER_TRANSPORT_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 123 | `lookupScannedPart` | `./partMaster/partAliasCallables` | inventory.catalog.alias.read | INERT | admin|inventoryLookupReader|inventoryStockRelocationOperat… | YES | PART_IDENTIFIER_TRANSPORT_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 124 | `recordReturnIntake` | `./inventoryReturns/returnCallables` | inventory.returns.intake | INERT | admin|inventoryReturnsIntakeClerk|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 125 | `installSerializedAsset` | `./equipmentInstall/installCallables` | equipment.install | INERT | admin|equipmentInstaller|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 126 | `acquireSerializedAsset` | `./serializedAsset/acquireCallables` | inventory.serializedAsset.acquire | INERT | admin|inventorySerializedAssetAcquirer|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 127 | `getInstallableEquipmentForWorkOrder` | `./workOrderInstall/workOrderInstallCallables` | equipment.install | INERT | admin|equipmentInstaller|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 128 | `recordWorkOrderEquipmentInstall` | `./workOrderInstall/workOrderInstallCallables` | equipment.install | INERT | admin|equipmentInstaller|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 129 | `recordWorkOrderLabor` | `./workOrderLabor/laborCallables` | workOrder.labor.record | INERT | admin|owner|technicianLaborRecorder | YES | - | — none | INERT_REGISTERED |
| 130 | `correctWorkOrderLabor` | `./workOrderLabor/laborCallables` | workOrder.labor.correct | INERT | admin|owner|workOrderLaborCorrector | NO | - | — none | INERT_REGISTERED |
| 131 | `getWorkOrderLabor` | `./workOrderLabor/laborCallables` | workOrder.labor.record | INERT | admin|owner|technicianLaborRecorder | YES | - | — none | INERT_REGISTERED |
| 132 | `createBin` | `./inventoryLocation/binCallables` | inventory.location.bin.manage | INERT | admin|inventoryBinAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 133 | `renameBin` | `./inventoryLocation/binCallables` | inventory.location.bin.manage | INERT | admin|inventoryBinAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 134 | `deactivateBin` | `./inventoryLocation/binCallables` | inventory.location.bin.manage | INERT | admin|inventoryBinAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 135 | `reactivateBin` | `./inventoryLocation/binCallables` | inventory.location.bin.manage | INERT | admin|inventoryBinAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 136 | `resolveBin` | `./inventoryLocation/binCallables` | inventory.location.bin.read | INERT | admin|inventoryBinAdministrator|inventoryPutAwayOperator|i… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 137 | `resolveBinToken` | `./inventoryLocation/binCallables` | inventory.location.bin.read | INERT | admin|inventoryBinAdministrator|inventoryPutAwayOperator|i… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 138 | `previewBinCreates` | `./inventoryLocation/binCallables` | inventory.location.bin.read | INERT | admin|inventoryBinAdministrator|inventoryPutAwayOperator|i… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 139 | `listBins` | `./inventoryLocation/binCallables` | inventory.location.bin.read | INERT | admin|inventoryBinAdministrator|inventoryPutAwayOperator|i… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 140 | `recordPutAway` | `./inventoryLocation/binCallables` | inventory.placement.record | INERT | admin|inventoryPutAwayOperator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 141 | `relocateStock` | `./inventoryLocation/stockRelocationCallables.js` | inventory.stock.relocate | INERT | admin|inventoryStockRelocationOperator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 142 | `listStockMovementLocations` | `./inventoryLocation/stockRelocationCallables.js` | inventory.location.bin.read | INERT | admin|inventoryBinAdministrator|inventoryPutAwayOperator|i… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 143 | `getPartBalance` | `./inventory/partBalanceReadService` | inventory.balance.read | INERT | accountingManager|admin|controller|fieldManager|financeMan… | YES | INVENTORY_BALANCE_READ_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 144 | `getPartBalances` | `./inventory/partBalanceBatchReadService` | inventory.balance.read | INERT | accountingManager|admin|controller|fieldManager|financeMan… | NO | INVENTORY_BALANCE_READ_READY | — none | EXPORTED_BUT_UNREACHABLE |
| 145 | `createPartSupplierItem` | `./partMaster/partSupplierItemCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 146 | `updatePartSupplierItem` | `./partMaster/partSupplierItemCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 147 | `changePartSupplierItemStatus` | `./partMaster/partSupplierItemCallables` | inventory.catalog.activate | ACTIVE(default) | admin|inventoryCatalogAdministrator|owner | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 148 | `setPreferredSupplier` | `./partMaster/partSupplierItemCallables` | inventory.catalog.manage | ACTIVE(default) | admin|fieldManager|generalManager|inventoryCatalogAdminist… | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |
| 149 | `createCrmActivity` | `./crmActivity/crmActivityCallables` | crm.activity.create | INERT | admin|crmActivityContributor|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 150 | `getCrmActivities` | `./crmActivity/crmActivityReadService` | crm.activity.read | INERT | admin|crmActivityContributor|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 151 | `createPerformanceGoalDraft` | `./performance/performanceGoalCallables` | performance.goal.create | INERT | admin|fieldManager|generalManager|operationsManager|owner|… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 152 | `approvePerformanceGoal` | `./performance/performanceGoalCallables` | performance.goal.approve | INERT | admin|fieldManager|generalManager|operationsManager|owner|… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 153 | `retirePerformanceGoal` | `./performance/performanceGoalCallables` | performance.goal.retire | INERT | admin|fieldManager|generalManager|operationsManager|owner|… | NO | - | sandbox | EXPORTED_BUT_UNREACHABLE |
| 154 | `listCurrentPerformanceGoals` | `./performance/performanceGoalCallables` | performance.goal.read | INERT | admin|fieldManager|generalManager|operationsManager|owner|… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 155 | `listPerformanceGoalVersions` | `./performance/performanceGoalCallables` | performance.goal.read | INERT | admin|fieldManager|generalManager|operationsManager|owner|… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 156 | `listGoalSubjects` | `./performance/performanceGoalCallables` | performance.goal.read | INERT | admin|fieldManager|generalManager|operationsManager|owner|… | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 157 | `stageDataImport` | `./dataImport/dataImportCallables` | admin.dataImport.stage | INERT | admin|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 158 | `executeDataImport` | `./dataImport/dataImportCallables` | admin.dataImport.execute | INERT | admin|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 159 | `listDataImportJobs` | `./dataImport/dataImportCallables` | admin.dataImport.stage | INERT | admin|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 160 | `listImportedServiceHistory` | `./dataImport/dataImportCallables` | customer.record.read | ACTIVE(default) | accountingManager|admin|controller|dispatcher|fieldManager… | YES | - | sandbox, certification, production | LIVE_BUSINESS_TRANSPORT |
| 161 | `listInboundWork` | `./inboundWork/inboundWorkCallables` | service.inboundWork.read | INERT | admin|owner|serviceInboundWorkReviewer | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 162 | `getInboundWorkRequest` | `./inboundWork/inboundWorkCallables` | service.inboundWork.read | INERT | admin|owner|serviceInboundWorkReviewer | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 163 | `acceptInboundWork` | `./inboundWork/inboundWorkCallables` | service.inboundWork.accept | INERT | admin|owner|serviceInboundWorkReviewer | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 164 | `declineInboundWork` | `./inboundWork/inboundWorkCallables` | service.inboundWork.decline | INERT | admin|owner|serviceInboundWorkReviewer | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 165 | `attachInboundWorkToWorkOrder` | `./inboundWork/inboundWorkCallables` | service.inboundWork.attachExisting | INERT | admin|owner|serviceInboundWorkReviewer | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 166 | `getEmailIntakeConfiguration` | `./inboundWork/inboundWorkCallables` | administration.emailIntake.read | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 167 | `saveEmailConnection` | `./inboundWork/inboundWorkCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 168 | `saveEmailMailbox` | `./inboundWork/inboundWorkCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 169 | `saveEmailRoutingRule` | `./inboundWork/inboundWorkCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 170 | `deliverInboundEmailMessage` | `./inboundWork/inboundWorkCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 171 | `startEmailConnectionAuthorization` | `./inboundWork/emailTransportCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 172 | `completeEmailConnectionAuthorization` | `./inboundWork/emailTransportCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 173 | `testEmailConnection` | `./inboundWork/emailTransportCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 174 | `disconnectEmailConnection` | `./inboundWork/emailTransportCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 175 | `getEmailProviderReadiness` | `./inboundWork/emailTransportCallables` | administration.emailIntake.read | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 176 | `pollEmailMailboxNow` | `./inboundWork/emailTransportCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 177 | `retryEmailDelivery` | `./inboundWork/emailTransportCallables` | administration.emailIntake.manage | INERT | admin|emailIntakeAdministrator|owner | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 178 | `getInboundWorkAttachment` | `./inboundWork/emailTransportCallables` | service.inboundWork.read | INERT | admin|owner|serviceInboundWorkReviewer | YES | - | sandbox | LIVE_BUSINESS_TRANSPORT |
| 179 | `pollEmailMailboxes` | `./inboundWork/emailDeliverySchedule` | NONE (scheduled; no principal) | NONE | - | NO | - | sandbox, certification, production | EXPORTED_BUT_UNREACHABLE |

---

## 11. Lane attestation

* **Nothing was retired.** No export removed, no module deleted, no capability flipped, no Role
  changed, no readiness flag altered.
* **No code changed.** The only file this lane adds is this document.
* **No deploy, no production contact, no Firebase or Render call.** Every measurement is static, over
  this worktree, plus `npm ci` / `tsc` / the exit guard.
* **No new Firebase dependency.** `node scripts/firebaseExitGuard.mjs
  --previous-baseline=docs/architecture/firebase-exit-baseline.json` reports *no new Firebase
  business-runtime dependencies beyond the committed baseline*.
* **Nothing pushed, no PR opened.** Committed locally on `night/p2b3-functions-transport` only.
