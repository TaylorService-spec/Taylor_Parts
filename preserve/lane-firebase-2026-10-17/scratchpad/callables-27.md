# The 27 write callables with no client caller: effective security today

Read-only investigation of worktree D:\eos-fb-exit (branch work/eos-firebase-exit, head 9f760ece). Paths are repo-relative. `FN` = functions/src. Nothing was edited, deployed, or contacted.

## 0. How the list was derived

- Source: `FN/index.ts` (590 lines). 46 write exports were reproduced exactly.
- Excluded as READ: detectInventoryEffects (`FN/inventoryEffectCallables.ts:7-12`, no write), plus every get/list/resolve/read/preview callable.
- 15 with a live UI caller: setUserStatus, initiateAdminPasswordReset, decidePrivilegedRoleRequest (`services/privilegedApprovalClient.js:26,43-52`), 4 saved-definition writers (`domain/reporting/savedReportService.js:24`), createBin/renameBin/deactivateBin/reactivateBin (`services/binCommandClient.js:28`), recordReturnIntake, createCrmActivity, stageDataImport, executeDataImport.
- 4 flag-dead: receiveInventoryStock + createManufacturer/updateManufacturer/changeManufacturerStatus.
- 27 with no UI caller (this report):
  - Work Order: createWorkOrder, transitionWorkOrder, setWorkOrderPartsPlan, completeAssignedJob (4)
  - Scheduling: rescheduleWorkOrderCallable, reassignScheduledWorkOrderCallable, setWorkOrderEstimatedDurationCallable, setTechnicianWorkingAvailabilityCallable, createTechnicianBlockedTimeCallable, deleteTechnicianBlockedTimeCallable (6)
  - Sales Order D2: allocateSalesOrder, createServiceForSalesOrder (2)
  - Finance: issueInvoice, applyPayment, recordInvoiceAdjustment, recordRefund (4)
  - Coverage: createSalesTerritory, createCoverageAssignment (2)
  - Access: grantRole, revokeRole, assignApprovedRole, requestPrivilegedRole, approveAccessRequest, rejectAccessRequest (6)
  - Performance goals: createPerformanceGoalDraft, approvePerformanceGoal, retirePerformanceGoal (3)
- "No UI caller" evidence. `httpsCallable` is used in 26 client files (grep `httpsCallable|getFunctions` over field-ops-app-vite/src). None names any of the 27 except the two cases below.
  - `services/completionService.js:72` does call completeAssignedJob. It is an ORPHAN: nothing imports it. `test/completionFlow.test.mjs:304` asserts "legacy completion callable is gone". It is still in the frontend baseline (`firebase-exit-baseline.json` frontend.firebase_functions_client).
  - `access/administrationUsersClient.js:34,109-141` has assignApprovedRole / revokeRole methods. No UI path calls them (UserAccessActions.jsx:224 calls only setUserStatus). `UserDetail.jsx:101-102` says "The Firebase assignApprovedRole path is GONE"; `EmployeeSecurityRoles.jsx:11-14,153` uses PostgreSQL assignRole/revokeRole.
  - Work Order and scheduling wrappers (`workOrderService.ts`, `schedulingCommandClient.js:1-14`, `workOrderApiClient.js:64-90`) go to POST /operations/work-orders. `salesOrderCommandClient.js:21-32` returns a constant "failed-precondition" for allocate/createService.
  - `privilegedApprovalClient` has list + decide only. No client creates requests (requestPrivilegedRole).
  - `performanceGoalClient.js:46,55,69` is reads only.

## 1. Cross-cutting facts (apply to every row)

| Fact | Evidence |
|---|---|
| No App Check anywhere | `git grep -i enforceAppCheck\|appcheck functions/src` returns nothing. Every callable is `onCall({region})` with no `invoker`/`cors`/`enforceAppCheck`. The public-invoker posture is documented in `docs/releases/sandbox-functions-invoker-gap-2026-08-16.md:36-41`: anyone on the internet reaches the function, and only the in-function checks stand. |
| Auth = Firebase Auth ID token only | each handler: `if (!request.auth) throw unauthenticated` |
| Legacy-role guard (WO/scheduling/completion) | `FN/callerContext.ts:14-21` reads Firestore `users/{uid}.role` (admin/dispatcher/technician) and `technicianId`. Clients cannot write `users` (`firestore.rules:436-439`). Only Admin-SDK provisioning scripts do. |
| Capability guard (everything else) | `resolveEffectiveAccess` (`FN/access/effectiveAccessFeed.ts:157-231`). It reads Firestore `users/{uid}` + `roleAssignments where principalUid==uid && status==active`, and resolves against COMPATIBILITY_ROLES ∪ GOVERNED_BUSINESS_ROLES. Capability data is NOT PostgreSQL. PostgreSQL `eos_policy.user_role_assignments` supersedes `roleAssignments` ("dual-read until cutover", `docs/architecture/eos-admin-policy-workflow-reconciliation.md:137`). The Firestore copy is a stale legacy snapshot. Live content UNVERIFIED. |
| Catalog activation | Every capability gating callables 4-27 below is `active:false` in `FN/access/permissionCatalog.ts`: workOrder.parts.plan :141-146, salesOrder.fulfill :253-258, salesOrder.service :264-269, finance.* :278-379, coverage.write :425-430, performance.goal.* :1600-1629. `resolveEffectivePermission.ts:264` DENYs an inactive capability unless an activation override includes it. |
| Activation overrides | `FN/access/environmentCapabilityOverrides.ts` + `config/environments.json`. **taylor-parts (production): only 25 report.* ids (`productionCapabilityActivations`)**, so every capability-gated callable below DENIES in production. **platform-sandbox: 92 ids** including workOrder.parts.plan, salesOrder.fulfill/service, finance.invoice.issue/payment.apply/adjustment.record/refund.record, performance.goal.create/approve/retire. **`coverage.write` is in neither list and is not in SPINE_OVERRIDE_ELIGIBLE_IDS** (the comment at `environmentCapabilityOverrides.ts:~30-38` says coverage.* is excluded on purpose), so coverage denies in EVERY environment. |
| Access-mutation guard | `FN/access/trustedWriterCommands.ts:395-419` resolves with `roles: COMPATIBILITY_ROLES` only (:411). It requires `admin.roleAssignment.write` (compat `admin` role, `compatibilityRoles.ts:155`) via an active, global-scope, in-version Firestore roleAssignment doc. The `owner` role is NOT in that catalog (comment at :~1105), so an owner-only holder is refused. |
| Writer-state freeze | `FN/eosOps/workOrderWriterState.ts:30` declares `WORK_ORDER_WRITER_AUTHORITY = {firestore:"FROZEN", postgres:"ACTIVE"}`. **It is imported only by eosOps/*.ts (`eosOpsHttp.ts:58`, `selfSchedulingHttp.ts:18`, `workOrderOperationTypes.ts:8`). None of createWorkOrder / transitionWorkOrder / setWorkOrderPartsPlan / scheduling / completeAssignedJob / allocate / createService / finance / coverage / access / performance imports any WriterState or freeze guard.** The freeze is declared but not enforced in these callables. They are "frozen" only by having no caller. `docs/architecture/commercial-c5-data-migration-plan.md:370-375` confirms the D2 writers "need a retirement switch" and none exists in code. |
| Custom claims | grantRole/revokeRole/assignApprovedRole/requestPrivilegedRole-decide call `runAccessMutationCommand` (:634-684) → `syncPendingClaims` (:688) → `refreshAccessVersionClaim` (:742) → `claimsWriter.ts:31` `setCustomUserClaims(uid,{accessVersion,…})`. No reader exists: no client `getIdTokenResult`/claims use; `eosApi/server.ts:186` uses only `decoded.uid`; no `token.accessVersion` read in functions/src. The claim is write-only. |
| Auditing | Every writer stages an `auditEvents` doc in the same transaction (`stageAuditEvent*`). |
| Deployment (production, project `taylor-parts`) | Last recorded estate is 22 Functions as of 2026-08-06 (`docs/Deployment.md:70,129-131`). **It includes createWorkOrder, transitionWorkOrder (`docs/audits/functions-live-state/functions-live-state-verification-report.md:71,87-88`; `docs/deployment/issue-226-row20-21-production-gate-reconciliation.md:20-25`) and completeAssignedJob (`docs/deployment/w3-receiving-activation-runbook.md:90-99`; DECISIONS.md:495 Gate D1 deployed + used via the UI).** No other of the 27 is recorded in production. State after 2026-08-08: UNVERIFIED. |
| Deployment (sandbox `eos-platform-sandbox`) | `index.ts` comments say deployed to sandbox for setWorkOrderPartsPlan (:22-24), completeAssignedJob (:150-152) and the access surface (:157-160). `scripts/sandboxDeployableFunctions.mjs:6-8,55-66` deploys EVERY exported function except interpretWorkOrderReadinessContext, so any export present at the last refresh is live there. `docs/releases/sandbox-release-readiness-2026-09-03.md:186-191` lists the performance callables + setWorkOrderPartsPlan. 2026-08-16: setWorkOrderPartsPlan, applyPayment, createCoverageAssignment, createSalesTerritory had no run.invoker binding (403) (`sandbox-functions-invoker-gap-2026-08-16.md:48-56`). Whether it was fixed: UNVERIFIED. |
| Stale comment | `index.ts:150-151` says completeAssignedJob is "NOT deployed to the production project". This contradicts DECISIONS.md:495 and the runbook baseline. Treat the comment as stale. |
| Equivalence records | `docs/architecture/firebase-capability-equivalence.json` has `records` = 22 HISTORICAL only. **None of the 27 has a record.** All 27 are in `exportBaseline.entries` (82 names). Removing any export without a GATED, retirement-complete record fails `scripts/firebaseCapabilityEquivalenceGuard.mjs` (gate doc §4.2, §4.5). Record format: gate doc §3. |

## 2. Ranked table (highest risk first)

Columns: Risk | Callable | Handler | Guard (effective caller) | Writes | Prod deployed? | EOS replacement | Equivalence record

| Risk | Callable | Handler | Effective caller today | Writes | Deployed |
|---|---|---|---|---|---|
| HIGH | grantRole | `FN/access/accessCommandCallables.ts:139` → `trustedWriterCommands.ts:770` | Any Firebase user with an active global compat-`admin` roleAssignment. Privileged roles (admin, owner) need `approverUid`, which is client-supplied data. | `roleAssignments` create :839; users.accessVersion bump; auditEvents; Auth custom claim | sandbox yes; prod no (as of 2026-07-21/08-06) |
| HIGH | assignApprovedRole | `accessCommandCallables.ts:171` → `trustedWriterCommands.ts:1836` | Same admin RA holder; assigns any NON-privileged compat or governed role to anyone, including themselves. | `roleAssignments` create :1887-1905; accessVersion; claim; audit | sandbox yes; prod no |
| HIGH | revokeRole | `accessCommandCallables.ts:156` → `trustedWriterCommands.ts:1737` | Same; privileged revoke needs client-supplied approverUid | `roleAssignments.status="disabled"` :~1819; accessVersion; claim; audit | sandbox yes; prod no |
| HIGH | transitionWorkOrder | `FN/transitionWorkOrder.ts:181` | Any user with `users.role` admin/dispatcher (any action) or technician (own assignment). No capability, no company scope, no freeze guard. | `fieldops_wos` update :612; `work_order_tech_locks` :610; `sales_orders` fulfillment write-back :687; auditEvents; post-commit `triggerInventoryEffects` :729 writes Firestore `inventory_transactions` + `inventory_sync_status` (reserve/consume/release) | **PROD yes** |
| MEDIUM | createWorkOrder | `FN/createWorkOrder.ts:139` | `users.role` admin/dispatcher (:144-147). No capability, no company. | `fieldops_wos` create :81; `counters/work_orders_<yr>` (woNumbering.ts:22,31); auditEvents :194/203 | **PROD yes** |
| MEDIUM | completeAssignedJob | `FN/completeAssignedJob.ts:190` | `users.role=="technician"` + `technicianId`, own `fieldops_jobs` row, status in_progress (:206-232, 248-298) | `fieldops_jobs.status` :315; `fieldops_technicians.status` :316; auditEvents :320 | **PROD yes** (Gate D1) |
| MEDIUM | issueInvoice | `FN/finance/invoiceCallables.ts:112` | Capability `finance.invoice.issue`. Prod DENY; sandbox ALLOW for compat-admin/finance roles. No caller-company scope. | `invoices` create :97; `sales_orders.lines` billedQty :96; invoice counter; auditEvents | sandbox yes |
| MEDIUM | applyPayment | `finance/paymentCallables.ts:62` | `finance.payment.apply` | `payments` :90; `payment_applications` :93; `invoices` :95; audit | sandbox yes (was 403 on 2026-08-16) |
| MEDIUM | recordInvoiceAdjustment | `finance/adjustmentCallables.ts:58` | `finance.adjustment.record` | `invoice_adjustments` :85; `invoices` :92; audit | sandbox presumed |
| MEDIUM | recordRefund | `finance/refundCallables.ts:57` | `finance.refund.record` | `refunds` :80; `invoices` :81; audit | sandbox presumed |
| MEDIUM | requestPrivilegedRole | `accessCommandCallables.ts:244` → `trustedWriterCommands.ts:1315` | admin RA holder | `privilegedRoleRequests` create :~1384; audit. No claims bump. | sandbox yes |
| MEDIUM | allocateSalesOrder | `FN/fulfillment/allocateSalesOrder.ts:97` | `salesOrder.fulfill` (:35-44). Prod DENY. | `sales_orders` update :183 (lines.allocatedQty, readiness) | sandbox yes |
| MEDIUM | createServiceForSalesOrder | `FN/salesOrder/createServiceForSalesOrder.ts:122` | `salesOrder.service`. Prod DENY. | `fieldops_wos` create via createWorkOrderRecord :202; `sales_orders` update :228; WO counter | sandbox yes |
| MEDIUM | setWorkOrderPartsPlan | `FN/workOrderPartsPlan/setWorkOrderPartsPlan.ts:193` | `workOrder.parts.plan` (:199). Prod DENY. | `fieldops_wos.inventorySnapshot` :244; `reconcileReservation` :270 writes Firestore inventory ledger | sandbox yes (was 403 on 2026-08-16) |
| LOW-MED | rescheduleWorkOrderCallable | `scheduling/schedulingCallables.ts:50` adapt → `schedulingCommands.ts:269` | `users.role` admin/dispatcher (`requireDispatcher` :81-90) | `fieldops_wos` update :225; `work_order_tech_locks` :224; audit | sandbox presumed |
| LOW-MED | reassignScheduledWorkOrderCallable | `schedulingCallables.ts:51` → `schedulingCommands.ts:304` | same | same | same |
| LOW-MED | setWorkOrderEstimatedDurationCallable | `schedulingCallables.ts:52` → `schedulingCommands.ts:364` | same | `fieldops_wos.estimatedDurationMinutes` :376; audit | same |
| LOW-MED | setTechnicianWorkingAvailabilityCallable | `schedulingCallables.ts:53` → `schedulingCommands.ts:401` | same | `technician_working_availability` set :413; audit | same |
| LOW-MED | createTechnicianBlockedTimeCallable | `schedulingCallables.ts:54` → `schedulingCommands.ts:440` | same | `technician_blocked_time` :530; lock :529; audit | same |
| LOW-MED | deleteTechnicianBlockedTimeCallable | `schedulingCallables.ts:55` → `schedulingCommands.ts:555` | same | `technician_blocked_time` delete :579; audit | same |
| LOW | createPerformanceGoalDraft | `performance/performanceGoalCallables.ts:82` → `performanceGoalCommands.ts:193` | `performance.goal.create`, scoped (`requireGoalAuthority` ~:103-147). Prod DENY. | `performance_goals` create :265; audit | sandbox yes |
| LOW | approvePerformanceGoal | `performanceGoalCallables.ts:106` → `:314` | `performance.goal.approve` + self-approval refusal | `performance_goals` update :390-393 (+ supersede predecessor); audit | sandbox yes |
| LOW | retirePerformanceGoal | `performanceGoalCallables.ts:121` → `:446` | `performance.goal.retire` | `performance_goals` update :486; audit | sandbox yes |
| LOW | approveAccessRequest | `accessCommandCallables.ts:202` → `trustedWriterCommands.ts:2245/2162` | `admin.accessRequest.decide`. **No code creates `accessRequests` docs** (only decideAccessRequest touches the collection), so the callable is inert unless docs were seeded out of band. | `accessRequests` update :2220; audit | sandbox yes |
| LOW | rejectAccessRequest | `accessCommandCallables.ts:216` → `trustedWriterCommands.ts:2258` | same | same | same |
| LOW | createSalesTerritory | `coverage/coverageCallables.ts:41` | `coverage.write` (:25-34). **Denies in every environment** (inactive, not activatable). | `sales_territories` :56; audit | sandbox yes (403) |
| LOW | createCoverageAssignment | `coverageCallables.ts:65` | same | `commercial_coverage_assignments` :80; audit | same |

## 3. Per-callable notes

### 3.1 Work Order core and completion

**createWorkOrder** (`FN/createWorkOrder.ts:139-214`)
- Writes: `fieldops_wos` doc (:81-98), the yearly counter, and an auditEvent (:194/:203). The write contains NO `operatingCompanyId` (:81-98). The EOS version requires a governed operating company (`work-order-firebase-retirement-ledger.md` row 1; `WorkOrderWizard.jsx:4`, `listWorkOrderOperatingCompanies`). This is a Taylor/Ventana isolation gap in the legacy path.
- Guard: auth :140 → `getCallerContext` :144 → role admin|dispatcher :145. No capability. No existence check on customerId/locationId (:108-113 only non-empty). Equipment is integrity-checked :173-185. No freeze guard.
- Frozen? `WORK_ORDER_WRITER_AUTHORITY` firestore=FROZEN (`workOrderWriterState.ts:30`), not enforced here. EOS: `/operations/work-orders createWorkOrder` exists and is UI-wired (`workOrderApiClient.js:66`; ledger row 1). `createWorkOrderRecord` (:55) is imported by createServiceForSalesOrder, so createWorkOrder.ts cannot be deleted until that retires.
- Deployed: PROD yes (2026-07-21 live-state report :71,87). Sandbox yes presumed.
- Effective: any provisioned legacy admin/dispatcher in the live Firestore `users` set (live values UNVERIFIED) can create a Firestore WO that no EOS reader sees, burning the Firestore WO counter and writing an audit row. Not authority-bearing.
- Harness callers: `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/driver.mjs:2725` (page.route mock), `functions/scripts/seedSandbox*.js`, `certificationWorld/applyDemandPlan.mjs`, 4 workflows (work-order-engine-functions-tests.yml etc.).

**transitionWorkOrder** (`FN/transitionWorkOrder.ts:181-731`)
- Guard: auth :182 → `getCallerContext` :190 → `getAllowedActions(status, role, isOwnAssignment)` :212 (`transitionEngine.ts:128-143` matrix: admin/dispatcher for MarkReady/Unschedule/Schedule/Dispatch/Close/Cancel; technician for Accept…Complete on own assignment). No capability, no company scope, no freeze guard.
- Writes: WO (:612), tech lock (:610), Sales Order fulfillment write-back (:687, `salesOrderFulfillmentWriteBack.ts`), 3-4 audit events (:627-711), then `triggerInventoryEffects` (:729) → Firestore ledger reserve (DISPATCHED), consume+finalize (COMPLETED), release (CANCELLED) (`FN/inventoryService.ts:489-496`).
- Frozen? WO store FROZEN by declaration only. `commercial-c5-data-migration-plan.md:380-383` says the SO write-back "must be removed or fail closed at cutover". Not done. EOS replacement: markWorkOrderReady/schedule/unschedule/reschedule/dispatch/accept/travel/arrive/start/complete/close/cancel (`workOrderApiClient.js:65-90`).
- Deployed: PROD yes.
- Effective: a legacy admin/dispatcher/technician can push a Firestore WO through the lifecycle from any browser. Real side effects: Firestore inventory ledger rows and Firestore SO fulfilledQty/state that PostgreSQL never sees (stock/SO divergence). Reaches only Firestore WOs that already exist. UNVERIFIED how many exist in prod.
- Retirement blockers: `scripts/schedulingFunctionalGate.mjs` (roadmap §1 "used by the held Scheduling gate"), `dispatchInteractionPass.mjs:347` (direct fetch to sandbox transitionWorkOrder), ~6 workflows, `functions/scripts/phantomSalesOrderLinkRepairCli.js`, `retryInventory*` scripts, `inventory-effect-recovery-runbook.md`.
- Also holds `FN/scheduling/errorMapping.ts` (shared with schedulingCallables).

**setWorkOrderPartsPlan** (`FN/workOrderPartsPlan/setWorkOrderPartsPlan.ts:193-283`)
- Guard: auth :194 → capability workOrder.parts.plan via `resolveEffectiveAccess` :199-200 (fail-closed on resolver error :203-205). Held by `workOrderPartsPlanner` governed role (`governedBusinessRoles.ts:1412`) and others. No company scope.
- Writes: WO inventorySnapshot + partsPlanUpdatedAt (:244), `reconcileReservation` (:270) when an applied reservation exists → Firestore `inventory_transactions`.
- Prod: DENY (capability not in production activations). Sandbox: ALLOW for holders (environments.json override list). EOS: `/operations/work-orders setWorkOrderPartsPlan` (ledger row 4; `workOrderApiClient.js:74`, `useWorkOrderPartsPlan.js:91` uses `workOrderService`). `index.ts:22-26` says deployed to sandbox, not production.
- Effective: only sandbox personas holding the role. Writes Firestore WO + ledger that EOS ignores.

**completeAssignedJob** (`FN/completeAssignedJob.ts:190-340`)
- Guard: auth :191 → `getCallerContext` :206 → technician only :215 (admin/dispatcher denied and audited), requires technicianId :222; the job's `technicianId` must equal the caller's (:~272); status must be in_progress.
- Writes: `fieldops_jobs.status=complete` :315, `fieldops_technicians.status=available` :316, applied/denied auditEvents.
- Frozen? Legacy `fieldops_jobs` (the roadmap says it needs a ruling that legacy fieldops_jobs is retired). No EOS counterpart for fieldops_jobs; EOS `completeWorkOrder` covers WOs only. Rules since Gate D2 deny the direct client path, so this callable is the ONLY path to complete a legacy job.
- Deployed: PROD yes (DECISIONS.md:495). Config: `TRUSTED_COMPLETION_ENABLED` true in prod but nothing imports `config/trustedCompletion.js`, so it gates nothing.
- Effective: a real technician (own job, in_progress only). Low blast radius but live in prod. If legacy jobs are retired, this is dead.
- Callers: orphan `services/completionService.js` (frontend baseline entry), d1/d2/d3 smoke scripts (`functions/scripts/d1SmokeCompleteAssignedJob.js:58`), `complete-assigned-job-tests.yml`, certificationWorld build/verify.

### 3.2 Scheduling (six writers; the seventh export `readTechnicianAvailabilityCallable` is a READ in the same file)
- Handler: `scheduling/schedulingCallables.ts:30-55` `adapt()` → auth :33 → `schedulingCommands.ts` `requireDispatcher` :81-90 (users.role admin|dispatcher; "No new capability is registered"). Error table `errorMapping.ts`.
- Writes: see table. All keyed on `fieldops_technicians` ids and `fieldops_wos` (:225, :376), not Employee ids.
- Freeze: none. EOS: rescheduleWorkOrder (covers reassign through scheduledTechId; there is no separate reassign op), setWorkOrderEstimatedDuration, setTechnicianWorkingHours, recordTechnicianUnavailability, endTechnicianUnavailability (`workOrderApiClient.js:70,82-86`; `schedulingCommandClient.js:1-14`, "availability is now the PostgreSQL authority keyed by EMPLOYEE id", DECISION 5 2026-09-30). The key change from technician id to Employee id is a material behaviour change, so the record is SUPERSEDED and needs an Owner DECISIONS reference that names these operations.
- Deployed: `index.ts:27-30` "exported for build and test only". Sandbox refresh deploys all exports (sandboxDeployableFunctions.mjs:6-8). Prod no evidence. Treat sandbox yes, prod no.
- Effective: sandbox legacy admin/dispatcher users could edit Firestore schedule data that EOS no longer reads. Low.
- Blockers: `scripts/schedulingFunctionalGate.mjs:97,337-495` (HTTP to sandbox callables), `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/dispatchInteractionPass.mjs:233`, `dispatchCorrectionsProbe.mjs`, `.github/workflows/dispatch-scheduling-domain-tests.yml`. The roadmap marks the scheduling domain "HELD on schedulingFunctionalGate.mjs".

### 3.3 Sales Order D2

**allocateSalesOrder** (`FN/fulfillment/allocateSalesOrder.ts:97-203`)
- Guard: auth :98, `requireFulfill` :99 (salesOrder.fulfill, `resolveEffectiveAccess` :35-44). Prod DENY; sandbox ALLOW.
- Writes: Firestore `sales_orders` update :183 (lines[].allocatedQty, fulfillmentReadiness). Reads the Firestore inventory ledger and warehouses.
- Pass 11 moved Sales Orders to PostgreSQL (`index.ts:98-100`). The client allocate is a hard-coded HELD refusal (`salesOrderCommandClient.js:21-26`, Owner ruling D2). This callable can only act on legacy Firestore orders (17 per the C5 census, `commercial-c5-data-migration-plan.md:79`).
- EOS replacement: NONE (D2 held, `commercial-c5-data-migration-plan.md:378-379`). Disposition would be GAP.

**createServiceForSalesOrder** (`FN/salesOrder/createServiceForSalesOrder.ts:122-239`)
- Guard: `salesOrder.service` :126. Prod DENY.
- Writes: `fieldops_wos` create via `createWorkOrderRecord` :202, SO update :228, WO counter. Creates a Firestore WO that EOS never sees.
- EOS replacement: NONE (D2 "waits for the governed Work Order lane", `salesOrderCommandClient.js:30-32`). Imports `createWorkOrderRecord` from createWorkOrder.ts (the only non-index importer).

### 3.4 Finance (four writers)
- All: auth → capability → Firestore transaction. Cap ids and writes are in the table. No company scoping on the caller: issueInvoice derives company from the SO (`invoiceCallables.ts:88-92`), and the payment/adjustment/refund callables take only an `invoiceId` with no caller-reach check (grep for scope/reach in the four files: none). Cross-company isolation therefore rests entirely on the capability being granted narrowly. A global holder (compat `admin` has all four, `compatibilityRoles.ts:169-172`) can act on either operating company's invoices.
- Prod: DENY (capability inactive in production). Sandbox: ALLOW. `functions/scripts/financialReviewFixtures.mjs:435,439` issues invoices and payments over HTTP in the sandbox (Owner financial review fixtures).
- Freeze/replacement: Firestore `invoices` is STILL the live authority. `eosOps/invoiceAuthority.ts:7-10`: the PostgreSQL repository is "not wired to any HTTP operation… the Firestore `invoices` collection remains the live authority". Roadmap §1: "No EOS refund or adjustment operation". There is no EOS issue/payment operation either. Disposition would be GAP for all four. Not retireable without an Owner GAP acceptance or new EOS operations.
- Rules: `firestore.rules:1760-1788` deny-all client access, so these callables are the only write path.
- Reads `listAccountInvoiceAr` / `listFinancialFacts` are live and separate.

### 3.5 Coverage
- `coverageCallables.ts:25-34` guard coverage.write; writes at :56, :80. Denies in every environment (see §1). Roadmap: "no EOS territory/coverage authority". Disposition GAP (no consumer, no data), needs an Owner decision either to accept it or to design the EOS authority. `coverageReadCallables.ts` (resolveCoverageForContext) is a separate file/baseline entry.

### 3.6 Access (six)
- All wrap `trustedWriterCommands`. Actor = `request.auth.uid` only (`accessCommandCallables.ts:119-125`).
- grantRole/revokeRole privileged path: `approverUid` is request data. `trustedWriterCommands.ts:1248-1257` itself records this as a defect: "A caller able to type the Admin UID could mint a privileged Role without the Admin being present", replaced by requestPrivilegedRole/decide. The old route remains exported and callable. An admin-RA actor plus another admin's uid mints a Firestore `admin` or `owner` roleAssignment (`:801-813`, `verifyApproverIsPrivileged` :455 proves only that the named uid holds authority).
- assignApprovedRole has no self-assignment check (:1836-1870): the actor can self-assign any non-privileged compat or governed role (e.g. fieldManager, operationsManager, inventoryCatalogAdministrator).
- Authority impact today: Firestore `roleAssignments` feeds only the surviving Firebase callables and the client capability feed (`resolveEffectiveAccessCallable`, used by `access/useReportCapabilities.js:46` and `metadata/definitions/accountPageComponents.js:671`). The EOS API authorizes from PostgreSQL (`administrationAuthority.ts:41-45`; `eosApi/server.ts:186`). Today's blast radius is therefore bounded to Firebase-side authority plus nav gating, but a minted role makes the holder an allowed caller of finance/performance/etc. callables (sandbox).
- EOS replacement: `/admin/policy` assignRole / revokeRole (`adminPolicy/adminPolicyApi.ts:193-194,784-788`; `EmployeeSecurityRoles.jsx`). The two-person privileged route is "superseded by this ruling" (`administrationAuthority.ts:21-23`), so SUPERSEDED with a material change, needing an Owner DECISIONS reference. approve/rejectAccessRequest: the capability `admin.accessRequest.decide` exists in the PG policy seed, but a matching EOS operation was not found (UNVERIFIED). There is also no producer of accessRequests.
- Prod: not deployed (live-state report :98-103 and Deployment.md:72,129-131). Sandbox: deployed. `applyRoleGrants.mjs:97` calls the deployed sandbox grantRole to apply the 83 certification grants (and `operatorAccessCommand.js:255`, `productionFoundationVerification.js:359`, `seedSandboxPerformanceStory.mjs` use the command core directly). So `trustedWriterCommands.ts` must stay for operator tooling; only the callable exports go.
- decidePrivilegedRoleRequest (live) consumes requestPrivilegedRole's output. The request side has no UI, so the queue is fed only by direct API calls (UNVERIFIED whether any docs exist).

### 3.7 Performance goals
- Auth :65-70; `requireGoalAuthority` (performanceGoalCommands.ts ~:103-147) loads `users`, `roleAssignments`, and `loadPrincipalPositions` (`access/hierarchicalVisibility.ts:114-115` reads Firestore `users` + `roleAssignments`) and denies by scope. Prod DENY; sandbox ALLOW for holders. Denials are audited.
- EOS replacement: none (roadmap "Performance … No goal-creation UI"; `functions/src/**` outside the performance dir has no performanceGoal operation). The seed script `seedSandboxPerformanceStory.mjs:87,527-536` uses the command core directly (not the callable). Three live read callables share the same file and client (`performanceGoalClient.js:46,55,69`).

## 4. Equivalence-gate and baseline mechanics (what retirement needs)
- Record fields: gate doc §3 (legacyOperation, capabilityId, era GATED, retiredIn {pr,commit}, disposition, gates A-E, audit, ownerDecision, gaps). GATED records must be retirement-complete (REPLACED all-verified, SUPERSEDED all-verified + Owner for material change, or Owner-accepted GAP). Gate B requires BOTH an executable ui-test and a recorded live `uat`; no such evidence is recorded for any of the 27.
- Owner decisions must be `DECISIONS #NNN` headings that name the retired operation, its capability id or the EOS replacement operation (gate doc §4.7).
- Guard failure mode: a removed export with no GATED record fails CI. A new `exportBaseline` is frozen (digest pinned).
- Baseline (docs/architecture/firebase-exit-baseline.json) is per FILE per target. Removing an export removes baseline entries only if the whole file is deleted or no longer imports the SDK. Current memberships:

| File | functions_server | admin_firestore | other |
|---|---|---|---|
| createWorkOrder.ts | yes | yes | - |
| transitionWorkOrder.ts | yes | yes | - |
| completeAssignedJob.ts | yes | yes | frontend: services/completionService.js (functions_client) |
| workOrderPartsPlan/setWorkOrderPartsPlan.ts | yes | yes | - |
| scheduling/schedulingCallables.ts | yes | - | - |
| scheduling/schedulingCommands.ts | - | yes | - |
| scheduling/errorMapping.ts | yes | - | importers: transitionWorkOrder.ts, schedulingCallables.ts |
| fulfillment/allocateSalesOrder.ts | yes | yes | - |
| salesOrder/createServiceForSalesOrder.ts | yes | yes | - |
| finance/{invoice,payment,adjustment,refund}Callables.ts | yes ×4 | yes ×4 | invoiceCallables also imported by scripts/buildCapabilityGraph.mjs |
| coverage/coverageCallables.ts | yes | yes | - |
| access/accessCommandCallables.ts | yes | - | stays (live setUserStatus/decide/list/read) |
| access/trustedWriterCommands.ts | - | yes | auth yes, app yes; stays (operator tooling) |
| access/claimsWriter.ts | - | - | auth yes; stays |
| performance/performanceGoalCallables.ts | yes | - | stays until 3 live reads retire |
| performance/performanceGoalCommands.ts, performanceGoalRepository.ts | - | yes ×2 | stay (seed script + reads) |

## 5. Proposed retirement batches (smallest blast radius first)

Each batch = code removal + GATED record(s) + regenerated capability graph + baseline shrink, then an operator-only `firebase functions:delete <names> --project <id>` (with `EOS_FIREBASE_PRODUCTION_DEPLOY` confirmation if taylor-parts; `scripts/firebaseDeployGuard.mjs:49`).

| # | Batch | Exports | Gate status | Baseline entries removed | Notes / blockers |
|---|---|---|---|---|---|
| R0 | Dead client residue (no export change) | - | no record needed | frontend functions_client: `services/completionService.js` (1). Also drop unused assignApprovedRole/revokeRole methods from `access/administrationUsersClient.js` (0 entries; file stays for setUserStatus/readPrincipalAccessState). | trivial. Confirms zero client callers. |
| R1 | setWorkOrderPartsPlan | 1 | REPLACED candidate (EOS op UI-wired). Needs ui-test (real EOS shape) + live uat | 2 (`setWorkOrderPartsPlan.ts` fn+adminFs) | prod DENY today, sandbox only. Delete `wo-parts-plan-tests.yml`. `inventoryService.reconcileReservation` stays (used by transitionWorkOrder). |
| R2 | Access callable surface | grantRole, revokeRole, assignApprovedRole, requestPrivilegedRole, approveAccessRequest, rejectAccessRequest | SUPERSEDED (PG assignRole/revokeRole); material change (privileged two-person route superseded, `administrationAuthority.ts:21-23`) → Owner DECISIONS naming each op. approve/reject need a named EOS equivalent or GAP acceptance | 0 (files shared with live callables) | Highest security win per line changed. Removes authority-writing public endpoints. Keep `trustedWriterCommands.ts`/`claimsWriter.ts` for operator scripts. Migrate `certificationWorld/applyRoleGrants.mjs:97` (sandbox HTTP grantRole) to the direct-service route it already has for the certification world. Sandbox undeploy of the 6 is operator-run. |
| R3 | Scheduling six + the read `readTechnicianAvailabilityCallable` | 7 | SUPERSEDED (identity key technician→Employee) → Owner DECISIONS | 2 (`schedulingCallables.ts`, `schedulingCommands.ts`); `errorMapping.ts` follows in R4 | Blocked until `scripts/schedulingFunctionalGate.mjs`, `dispatchInteractionPass.mjs`, `dispatchCorrectionsProbe.mjs`, `dispatch-scheduling-domain-tests.yml` are re-pointed to /operations/work-orders. |
| R4 | transitionWorkOrder + createWorkOrder callable | 2 | REPLACED candidates (lifecycle ops + createWorkOrder UI-wired). Gate B live uat missing | transitionWorkOrder.ts (2) + errorMapping.ts (1) = 3. createWorkOrder.ts stays (2 entries held) while createServiceForSalesOrder imports `createWorkOrderRecord` | PRODUCTION-DEPLOYED. Needs the SO write-back and inventory-effects semantics resolved (C7). Consider R4a: operator undeploy of createWorkOrder/transitionWorkOrder/completeAssignedJob from taylor-parts BEFORE code removal (Owner-gated, no code change) as the cheapest exposure cut. |
| R5 | completeAssignedJob | 1 | GAP unless an Owner ruling retires legacy `fieldops_jobs` (roadmap §1) | 2 server + (R0's frontend entry) | production-deployed. Rewrite/remove d1/d2/d3 smoke scripts + `complete-assigned-job-tests.yml` + certificationWorld refs. |
| R6 | Coverage | 2 | GAP (no EOS authority) → Owner acceptance DECISIONS | 2 (`coverageCallables.ts`) | inert everywhere, no data, no consumer. |
| R7 | Sales Order D2 | allocateSalesOrder, createServiceForSalesOrder | GAP (D2 held) → Owner decision | 4 (+2 more for `createWorkOrder.ts` once `createWorkOrderRecord` has no importer) | Do before/with the last createWorkOrder.ts removal. |
| R8 | Performance goal writers | 3 | GAP (no EOS authority, no UI) → Owner decision | 0 until the 3 live reads move | seed script uses cores directly. |
| R9 | Finance writers | issueInvoice, applyPayment, recordInvoiceAdjustment, recordRefund | GAP (Firestore invoices is the live authority; no EOS ops) | 8 | LAST. Needs new EOS Finance operations or an explicit Owner GAP acceptance. `financialReviewFixtures.mjs:435,439` and `finance-invoice-persistence-tests.yml` must move. |

Net baseline effect if all land: server functions_server -13 files (createWorkOrder, transitionWorkOrder, completeAssignedJob, setWorkOrderPartsPlan, schedulingCallables, errorMapping, allocate, createService, 4 finance, coverageCallables), admin_firestore -14 (adds schedulingCommands and the same files), frontend -1. Access and performance exports add 0 until their live siblings retire.

## 6. Open items (UNVERIFIED)
- Live Firestore `users.role` and `roleAssignments` contents in either project.
- Production Function estate after 2026-08-08 (was 22). Whether anyone has since deployed or deleted any of the 27 in taylor-parts. Confirm with `firebase functions:list --project taylor-parts` (operator).
- Whether the sandbox IAM invoker gap (2026-08-16) was fixed for setWorkOrderPartsPlan / applyPayment / coverage.
- Whether any Firestore `accessRequests`, `privilegedRoleRequests`, `performance_goals`, `invoices` docs exist (data census).
- Whether EOS has an operation for approve/reject access request (none found).
