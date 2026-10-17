# F1 map: per-session Firebase reads -> EOS Core (read-only investigation)

Base: worktree D:\eos-fb-exit, branch fix/postgres-test-pool-drain (= main 29114359 + test-only). All paths below are repo-relative.
FE = field-ops-app-vite/src. "UNVERIFIED" = not provable from repo files alone (usually needs live sandbox Firestore/PG).

## 0. Corrections to the brief (read first)

1. `POST /operations/experience` (op `resolveMyExperienceContext`) does NOT return jobRole / navigation / capabilities / displayName /
   employmentStatus / role / technicianId. Its entire result is `PrincipalExperienceContext`
   (functions/src/eosOps/experienceAuthority.ts:664-676): `{tenantId, principalId, securityRoleKeys[], employeeId|null,
   workEligibility[], operationalScopes[{scopeType,scopeId}], surfaces[]}`. Handler: functions/src/eosOps/eosOpsHttp.ts:415-425
   (route map eosOpsHttp.ts:171-173). The client projection (FE/access/experienceContext.js:81-110) additionally DROPS surface keys it does not know.
2. An EOS-session identity path ALREADY EXISTS in AuthContext (FE/auth/AuthContext.jsx:63-119, FE/auth/eosSessionIdentity.js:22-39). For an EOS
   session it sets `role=null, displayName=null, employmentStatus=null, operationalRoles=[]`, employeeId from the experience context. So the app
   already runs with null role/operationalRoles/displayName for EOS-session users (precedent for "no legacy fields"), but that path is a different
   credential (EOS token), not "Firebase login + EOS reads".
3. `explainEffectiveAccess` is NOT a self-read. It is an Administration read of ANOTHER principal: input `{principalId}` required
   (functions/src/adminPolicy/adminPolicyApi.ts:674-689), gated by `admin.principalAccess.read` (adminPolicyApi.ts:310), route `POST /admin/policy`
   (functions/src/adminPolicy/adminPolicyHttp.ts:98,132). Useful for parity measurement (returns accessVersion/capabilities/surfaces/employeeFacts,
   effectiveAccessExplanation.ts:108-155) but not as a runtime session read.
4. EOS navigation-authority flag is true ONLY in platform-sandbox (config/environments.json:145). false in local-emulator (:105),
   platform-certification (:291), platform-integration (:321), taylor-parts-production (:354). `eosApi` is null in all but platform-sandbox
   (:94 local, :126 sandbox object, :280, :310, :343 production). FE/config/navigationAuthorityReadiness.js:14-23,44.
   Consequence: any F1 EOS read is NOT_CONFIGURED in production. "No behaviour change" in production therefore means the Firebase path must stay
   where `eosApi` is null (env-gated), or production gets an EOS API first (Owner gate, out of scope).

## 1. The three Firebase modules: reads, returns, consumers

### 1A. FE/auth/employeeSession.js  `resolveEmployeeSession(uid)`
Reads (one-shot getDoc, no onSnapshot):
- `users/{uid}` (employeeSession.js:50) -> fields `role`, `employeeId` (:52-53). (Not read here but present on the doc: `technicianId`, `accessVersion`.)
- `employees/{employeeId}` (employeeSession.js:68), only if employeeId set -> `displayName`, `operationalRoles`, `employmentStatus`
  (shape-builder FE/auth/employeeSessionResult.js:15-26). Broken link (doc missing): employeeId kept, others empty (employeeSession.js:69-74).
Returns `{role, employeeId, displayName, operationalRoles[], employmentStatus}`; no employeeId => `{role, null, null, [], null}`.
Sole caller: FE/auth/AuthContext.jsx:160 (inside onAuthStateChanged, generation-guarded :161). Failure => identityError + all fields cleared
(AuthContext.jsx:169-189); App.jsx:1390 renders a retryable FailureState.
AuthContext exposes (AuthContext.jsx:232): `user, role, employeeId, displayName, operationalRoles, employmentStatus, login, logout, resetPassword,
eosSignedIn, loading, identityError, retryIdentityResolution`.

CONSUMERS (by field), all via useAuth() unless noted:
- `role` (users.role in {admin,dispatcher,technician}; domain/constants.js:377-381 ROLE_NAV_ACCESS):
  - App.jsx:1318 `ROLE_NAV_ACCESS[role]` -> allowedLegacyKeys -> nav visibility (navConfig `legacyKey` path, navConfig.js:1757-1759). NAVIGATION.
    Under EOS source App passes `role=null` and NO_LEGACY_KEYS to shell/hasAnyAccess/visibility (App.jsx:1365,1512-1513; AppRoutes navRole
    App.jsx:~985-991). So nav is already EOS-decided in sandbox.
  - App.jsx:1516 AppRoutes keeps raw `role` and threads it to screens (renderSubnavItem App.jsx:433-440, 575 TechnicianWorkspaceSurface,
    581 WarehouseWorkspaceSurface, 590 ScanWorkspaceSurface, 265-276 DashboardIndex). The AppRoutes comment (App.jsx:~960-985) says screens use it
    "for CONTENT and for action affordances".
  - ACTION GATES that still read Firebase role even when EOS is nav source:
    * modules/dispatcherBoard/DispatcherBoard.jsx:93,502 hard refusal unless admin|dispatcher ("not available to you"); :454 getAllowedActions(status, role).
    * modules/jobs/Jobs.jsx:72,78-80 previewHasPermission("workOrder.create", role, {fallback admin|dispatcher}).
    * shared/ui/NotificationControl.jsx:64-66 previewHasPermission("reorder.request.read.queue", role, ...) (NotificationControl.jsx:65).
    * modules/workOrders/WorkOrderDetailPage.jsx:89,329 passes role to WorkOrderActions.
    * modules/accounts/AccountDetail.jsx:360,377 `isAdmin = role==="admin"` -> which governed Account fields show edit pencils.
    * modules/inventory/PartsShadowParityDiagnostics.jsx:20-21 isDiagnosticsAuthorized(role).
    * shared/inventory/RequestReorderControl.jsx:41,66-68 admin OR operationalRoles has PARTS_MANAGER/WAREHOUSE_MANAGER.
    * modules/mobile/PartsScanner.jsx:53,113 deriveScanActions(identity,{role,...}); modules/warehouse/WarehouseShell.jsx:52,70,84 -> ScanWorkspace deps.role;
      access/scanWorkflows.js:305 `role !== "technician" || !technicianId` => TECHNICIAN_WORK_ORDER scan workflow unavailable.
    * domain/dashboardComposition.js:346-356 dashboardSurfaceFor: EOS branch first, else `role==="technician"` => FIELD_WORK (TechnicianDashboard vs MyDashboard).
  - DISPLAY: navigation/AppRail.jsx:359-365 (role label, line absent if null), modules/employees/MyEmployeeProfile.jsx:42,70-76 (legacy compat role label),
    App.jsx:344-350 CrashTrailRecorder -> diagnostics/crashDiagnostics.js:102 recordIdentity (diagnostic only).
- `employeeId`: modules/dashboard/MyDashboard.jsx:343,354 (composition ctx; dashboardComposition.js:289-295 employeeIdOf prefers EOS context.employeeId under EOS source);
  modules/technicianDashboard/TechnicianDashboard.jsx:69,228 (`<TechnicianPerformance employeeId>`).
- `displayName`: MyDashboard.jsx:343,681 greeting "Hi, {displayName}"; navigation/AppRail.jsx:359-361 (`displayName || user.email`).
- `operationalRoles`: App.jsx:1351 -> operationalContext -> navConfig.js:1624-1630 hasEligibleOperationalRole (role must be technician AND employmentStatus ACTIVE AND role held)
  for nav items with `operationalRoleAccess` (legacy-source only; unreachable under EOS source navConfig.js:1747);
  MyDashboard.jsx:343,363 + domain/dashboardComposition.js:299-302 hasOperationalRole (cards); TechnicianDashboard.jsx:147 (unlinked + has opRoles => "go to My Inventory Role");
  RequestReorderControl.jsx:41,67-68. Existing retirement ledger classifies these (functions/src/adminPolicy/migration/legacyConsumerLedger.ts:191-250:
  navConfig/App/AuthContext/RequestReorderControl = SECURITY_AUTHORIZATION, replacement "CAPABILITY via readMyWorkforceCapabilities; ELIGIBILITY"; MyDashboard/TechnicianDashboard/dashboardComposition = DISPLAY_PERSONA, replacement JOB_ROLE; all NOT_STARTED).
- `employmentStatus`: App.jsx:1352 operationalContext only -> navConfig.js:1627-1628 (legacy operationalRole gate). No other behavioural consumer found.
- `identityError`/`retryIdentityResolution`/`loading`: App.jsx:1382,1390-1399.

Already-EOS-preferring consumers when `isEosNavigationSource(operationalContext)` (navConfig.js:1695; true only in platform-sandbox):
navConfig.js:1747 (isNavItemVisible EOS branch is total), :1789 (placeholder register empty), App.jsx:1364-1370 (hasAnyAccess + No-access copy),
App.jsx:1512-1513 (shell gets role=null), App.jsx:265-267 (DashboardIndex -> MyWorkspace, not MyDashboard), App.jsx:987-993 (WO record/create routes from
`service.workOrders` surface + readMyWorkOrderCapabilities), App.jsx:1272 (inventoryRole redirect suppressed), navigation/AppShell.jsx:65-75 + navigation/mobilePrimaryNav.js
(phone nav), domain/dashboardComposition.js:117-122,285-296,346-356 (surfaces, location scope, employeeId, field-work), modules/dashboard/MyDashboard.jsx (reads authority).
NOT EOS-preferring even then: every action gate listed under `role` above, AppRail role label, operationalRoles/employmentStatus in the context (just unused by nav).

### 1B. FE/access/useReportCapabilities.js (+ FE/access/reportCapabilityAccess.js)
Reads:
- `onSnapshot(users/{uid})` -> `accessVersion` ONLY (useReportCapabilities.js:38-44). Accepts finite non-negative integer (reportCapabilityAccess.js isValidObservedVersion);
  missing/malformed/error => version ERROR => deny, `accessResolving` false (settled). Live: a revocation bump denies instantly before re-fetch.
- Callable `resolveEffectiveAccessCallable` with `{permissionIds}` (useReportCapabilities.js:33,45-47), re-fetched on every accessVersion change (:74-98).
Request set = REPORT_CAPABILITY_REQUEST = SHELL_GATED_CAPABILITY_IDS (FE/access/shellCapabilityGates.js:153-155; 51 distinct ids incl. dashboardModules etc.), derived from
gate declarations (shellCapabilityGates.js:111-129; governedSurfaceCapabilities.js; reportAccess.js).
Returns `{hasCapability(id), accessVersion|null, accessResolving, versionStatus, feedStatus}` (useReportCapabilities.js:100-108). hasCapability is true only if version READY for
this uid AND feed READY for this uid AND feed.forVersion === observed version AND decisions[id] === true (reportCapabilityAccess.js buildHasCapability).
Sole caller: App.jsx:1325 -> `operationalContext.{hasCapability,accessVersion}` (App.jsx:1347-1355). Also `accessResolving` gates the whole shell: App.jsx:1408
`if (accessResolving) return Loading` (all environments, even when EOS is nav source).
CONSUMERS of operationalContext.hasCapability / accessVersion:
- navConfig.js:1643-1647 holdsDeclaredCapability (legacy source only) for items with capabilityAccess (Report Builder navConfig.js:601, Saved Reports :606, Parts :361,
  Transfers :418, Cycle Counts :460, Scan :309, Warehouse Workspace :412, Data Import :716, etc.); navigation/LandingPage.jsx:79-83; navigation/AppShell.jsx:65.
  (Note: nav items declaring ids NOT in the shell request set - reorder.request.read :444, inboundWork.request.read :258, admin.systemConfiguration.manage :709,
  sales.discountAuthority.manage :710, inboundWork.intake.manage :723 - can never be granted by the Firebase feed; they only open under the EOS source. UNVERIFIED whether
  that is intended in legacy-source envs.)
- Screens given `hasCapability`: AdminWarehouseRacking (inventory.location.bin.read/.manage; App.jsx:708), AdminDataImport (admin.dataImport.stage/.execute; :719),
  SavedReports (report.definition.*; :754), UserDetail+UserAccessActions (admin.* user ids; App.jsx:1168, UserAccessActions.jsx:112), PartDetail (reorder.purchaseOrder.void
  PartDetail.jsx:255; equipment.compatibility.view via UsedInEquipmentSection; App.jsx:1235), MyDashboard module cards (customer.record.read, finance.read, opportunity.read, salesOrder.read,
  fulfillment.coordinatedVisit.read, inventory.balance.read, finance.visibility.* ; governedSurfaceCapabilities DASHBOARD_MODULE_CAPABILITY_IDS), Scan/Warehouse mounts DO NOT use it any more
  (useScanCapabilityGate -> EOS resolveMyCapabilities, access/useInventoryScanCapabilities.js:1-12; App.jsx:917,934,946), Commercial/Opportunity/SalesOrder/Agreement already EOS
  (hooks/useCommercialCapabilities.js:1-12; App.jsx:363,389,419,429), AdminFinancialPolicy already EOS (App.jsx:712-722).
- `accessVersion` as a re-fetch/boundary key: PartsList.jsx:401, Transfers.jsx:69-97, TruckInventory.jsx:113-126, Warehouses.jsx:101-106, UsedInEquipmentSection.jsx:128,
  SavedReports, NotificationControl (AppShell.jsx:163,204), MyDashboard.jsx:407, PartDetail.jsx:711. For EOS-session users and any user without users.accessVersion it is already `null`.

### 1C. FE/metadata/definitions/accountPageComponents.js lines 650-740 `useAccountPageCapabilityDecisions(user)`
Identical pattern to 1B (own copy): onSnapshot users/{uid}.accessVersion (:664-669) + callable resolveEffectiveAccessCallable with ACCOUNT_PAGE_CAPABILITY_REQUEST
(:657 = declaredPageCapabilities(accountRecordPage) = `crm.activity.read, finance.read, opportunity.read, salesOrder.read` from metadata/definitions/accountPage.js:191,200,209,217,275;
no actions/capabilityParts declared). Returns a plain `{id: boolean}` map (accountPageComponents.js:737-740).
Sole caller: modules/accounts/AccountDetail.jsx:402. AccountDetail.jsx:403-413 then OVERRIDES `opportunity.read` and `salesOrder.read` with EOS useCommercialCapabilities.
So the Firebase feed still decides only `finance.read` and `crm.activity.read` (section visibility on the Account record page).

### 1D. FE/hooks/useCurrentTechnician.js
Reads (both onSnapshot, with error handlers/retry/obsolete-callback guard):
- `users/{uid}` -> `technicianId` (:65-74)
- `fieldops_technicians/{technicianId}` -> whole doc `{id,...data}` (name, phone, status per header; :97-101)
Returns `{technicianId, technician, loading, error, retry}`.
Consumers:
- modules/mobile/FieldMode.jsx:55-60 (loading/error/retry gate: "Your technician profile could not be loaded" :178-183; `technicianId` also passed to useOfflineRuntime thunk :84 and PartsScanner :275,330 - PartsScanner ignores a technicianId prop (modules/mobile/PartsScanner.jsx:52 signature)).
  Work selection is NOT from here: it is EOS listMyAssignedWorkOrders via hooks/useAssignedWorkOrders.js (employeeId from server, :1-60).
- modules/technicianDashboard/TechnicianDashboard.jsx:69-80,179,187 (`technician.status` pill, `technician.name` greeting, error alert); `technician` is display-only.
- modules/technician/TechnicianShell.jsx:41,45,63 (loading + offline queue thunk `technicianId`).
- modules/scan/ScanWorkspace.jsx:194-195,212,240,323: `technicianId` -> deriveScanWorkflows -> access/scanWorkflows.js:305 (with users.role==="technician") decides whether TECHNICIAN_WORK_ORDER scan workflow is AVAILABLE; also TransferScan deps.
  technicianId in hooks/useOfflineRuntime.js:85-86 -> createTechnicianBindings(deps) but offline/technicianCommandBindings.js:45-90 does not read deps.technicianId (UNVERIFIED across the rest of that file: grep shows no other reference).
So the only decision-bearing use is the scan gate (`role==="technician"` && technicianId truthy). Everything else is loading/error/display.

## 2. EOS replacements and field-by-field equivalents

Transport: FE/services/operationsApiClient.js:30-33 (ops `resolveMyCapabilities` -> /operations/inventory, `resolveMyExperienceContext` -> /operations/experience), POST `{operation}`,
`Authorization: Bearer <Firebase ID token>` (policyApiBaseUrl/currentIdToken from adminPolicyApiClient). Server verifies the token, resolves Principal by (identity_provider='firebase', external_subject=uid)
(functions/scripts/fixtures/personaAuthorityDimensions.v1.json identityArchitecture.chain; functions/src/eosApi/server.ts:103-128), ACTIVE tenant membership; refuses unknown/disabled/unmembered/ambiguous
as FORBIDDEN (eosOpsHttp.ts:337-346). Failure categories: NOT_CONFIGURED, NOT_SIGNED_IN, UNAUTHENTICATED, FORBIDDEN, INTERNAL, UNREACHABLE (operationsApiClient.js:38-48). Never throws.

| EOS read | Route | Auth | Response |
|---|---|---|---|
| resolveMyExperienceContext | POST /operations/experience | bearer; no capability needed | `{tenantId, principalId, securityRoleKeys[], employeeId|null, workEligibility[], operationalScopes[], surfaces[]}` (experienceAuthority.ts:664-676,686-722). FE wrapper: hooks/useExperienceContext.js (flag-gated, :35-100) + access/experienceContext.js. Also used by eosSessionIdentity.js:22. |
| resolveMyCapabilities | POST /operations/inventory | bearer; returns empty list when no role | `{tenantId, uid(=principalId), heldRoleKeys[], capabilities[] (sorted, UNCONDITIONAL flat set, conditions via postgresGrantConditionProvider)}` (eosOpsHttp.ts:396-413). FE wrapper: hooks via operationsApiClient in access/useInventoryScanCapabilities.js (filters to scan keys, inventoryScanCapabilityAccess.js:35-45). No FE wrapper returns the whole set. |
| readMyWorkOrderCapabilities | POST /operations/work-orders (WORK_ORDER_ROUTE, eosOpsHttp.ts:262) | bearer; WORK_ORDER writer must be activated else NOT_ACTIVATED (workOrderOperations.ts:7-9) | `{capabilities: [workOrder.* only]}` (workOrderOperations.ts:68-71). FE: hooks/useMyWorkOrderCapabilities.js (asks only workOrder.create) via services/workOrderApiClient.js. |
| readMyWorkforceCapabilities | POST /workforce/employees (workforceHttp.ts:121) | bearer | `{capabilities: subset of 6 workforce ids}` (eosWorkforce/reads/myWorkforceCapabilities.ts:26-48). |
| readMyCommercialCapabilities | POST /commercial/sales | bearer | `{capabilities, channelScoped}` closed Commercial list; FE hooks/useCommercialCapabilities.js. |
| readMyEmployeeProfile (EMP-RT-07) | POST /workforce/employees | bearer; no capability | `{employee:{employeeId, employmentStatus, operatingCompanyId, employeeNumber, displayName(derived), name{...}, jobTitle, contact, address, hireDate, separationDate, currentManager, createdAt, updatedAt}, principalLink}` (eosWorkforce/reads/myEmployeeProfile.ts:41-76; employeeRecordProjection.ts:46-96). Refuses 404 no link / 409 ambiguous / 412 unresolved. FE: services/workforceApiClient.js:45; used by modules/employees/MyEmployeeProfile.jsx and modules/sales/OpportunityList.jsx:124. Explicitly returns NO operationalRoles (Owner ruling E) and NO Job Role (EMP-RT-08 not implemented, myEmployeeProfile.ts:29-30 header). |
| explainEffectiveAccess | POST /admin/policy | bearer + admin.principalAccess.read; target principalId required | `EffectiveAccessExplanation` incl. accessVersion, securityRoleKeys, capabilities (flat), conditionallyHeld, scopedHeld, surfaces, actions[], employeeFacts{functionalRoles, jobRole, employee{displayName,operatingCompanyId,employmentStatus}} (effectiveAccessExplanation.ts:108-155). Admin tool, not a session read. |

Field-by-field (Firebase fact -> EOS source):
- `users.role` (admin|dispatcher|technician): NO EQUIVALENT BY DESIGN. EOS has `securityRoleKeys[]` (many roles per principal, 48+ keys: owner, admin, dispatcher, technician, fieldManager,
  salesperson, controller, ...) and no single role. A mapping securityRoleKeys ∩ {admin,dispatcher,technician} is possible but is a NEW rule: personas like serviceManager (`fieldManager`)
  have no legacy-role analogue; what Firebase `users.role` holds for them is UNVERIFIED (live Firestore). Server-side the EOS stance is "no frontend role map" (eosSessionIdentity.js:5-9).
  Every `role` action gate in sec 1A would need to be re-expressed as capability/surface checks (replacementAuthority per legacyConsumerLedger.ts), not a role-string swap.
- `users.employeeId` / employees doc id: `employeeId` in experience context (experienceAuthority.ts:670-671) or readMyEmployeeProfile.employee.employeeId. Same id space as Firestore employee doc ids for the
  synthetic sandbox (registry expectedEmployeeId `synthetic-np-emp-*`, config/sandboxRoleIdentityRegistry.json) - UNVERIFIED for any real/production-derived employee; EOS reads never match by uid/technician id (myEmployeeProfile.ts:1-16).
  Not equal for the Owner persona today per registry ownerAdminSplit note (owner Principal had NO employee link; split in progress) - check current state.
- `employees.displayName`: readMyEmployeeProfile.employee.displayName (rule: preferred_name, else display_name, else first+last; employeeRecordProjection.ts:10-16). Firestore `displayName` raw vs derived: may differ (UNVERIFIED).
- `employees.employmentStatus`: readMyEmployeeProfile.employee.employmentStatus (pg enum workforce_employment_status, migration 1759104000000; same 6 values as FE EMPLOYMENT_STATUS domain/constants.js:36-43 - names match, UNVERIFIED value-for-value).
  The experience context does NOT carry it; the server only gates on DQ-007 eligibility (eosSessionIdentity.js:31-33).
- `employees.operationalRoles`: NO EQUIVALENT (not migrated, Owner ruling E; myEmployeeProfile.ts header). Governed replacements: workEligibility[] + operationalScopes[] (experience context) for qualification/scope; capabilities (resolveMyCapabilities / readMyWorkforceCapabilities) for authorization; Job Role (persona layout only) for display.
- `users.accessVersion` (live counter, bumped by trusted writers): EOS has a per-principal access version (principal_access_versions; surfaced in effectiveAccessExplanation.ts:112,308 and authorityChangePreview.ts) but NO self-read returns it: neither resolveMyCapabilities nor experience includes it. NO SELF-READ EQUIVALENT. Also EOS reads are one-shot; no push channel.
- `users.technicianId` + `fieldops_technicians` (name/phone/status where status in TECH_STATUS available|on_job|off_shift, domain/constants.js:7-11): NO EQUIVALENT. EOS deliberately never keys on technician id (myEmployeeProfile.ts:7-9; hooks/useAssignedWorkOrders.js:6-17 "browser passes no technician id"). Closest: employeeId + Employee displayName/jobTitle; work-eligibility SERVICE_TECHNICIAN (workEligibility[]) for "is this a technician". Field status pill has no direct equivalent (EOS readTechnicianAvailability/readEmployeeWorkSchedule, eosOps/workOrderAvailability.ts, are availability not TECH_STATUS - UNVERIFIED mapping).
- `resolveEffectiveAccess` decisions `{permissionId: bool}`: EOS resolveMyCapabilities.capabilities membership (flat set) - ONLY where the key exists in both vocabularies (sec 3). Conditioned grants are withheld from the flat set (eosOps resolveMyCapabilities uses postgresGrantConditionProvider), Firebase evaluates operationalRoleActive conditions per principal (effectiveAccessFeed.ts below).

## 3. "Capability set" on each side; vocabularies; existing parity tooling

Firebase side `resolveEffectiveAccessCallable` (functions/src/access/effectiveAccessFeedCallable.ts, index.ts export; logic functions/src/access/effectiveAccessFeed.ts:150-245):
- Input: caller uid from request.auth only; `permissionIds` 1..100 strings (MAX_PERMISSION_IDS 100). Output `{accessVersion, decisions{id: bool}}`.
- Reads Firestore `users/{uid}` (accessVersion, employeeId) + `roleAssignments` where principalUid==uid && status=="active"; plus `employees/{employeeId}` via operationalRoleContext for the
  `operationalRoleActive` condition. Resolves each id with resolveEffectivePermission against COMPATIBILITY_ROLES (admin/dispatcher/technician grant sets) merged with
  GOVERNED_BUSINESS_ROLES (functions/src/access/compatibilityRoles.ts, governedBusinessRoles.ts), global scope, and PER-ENVIRONMENT activation overrides from GCLOUD_PROJECT
  (environmentCapabilityOverrides.ts; empty in production => active:false catalog ids hard-deny). Unknown id => DENY.
- accessVersion staleness: assignment valid only if accessVersionAtGrant <= current (resolveEffectivePermission).
EOS side resolveMyCapabilities: PostgreSQL principal -> ACTIVE tenant membership -> user_role_assignments -> eos_policy.role_capabilities UNION principal_capabilities (direct exceptions), with grant
conditions (eosOps/capabilityAuthority.ts resolveOperationalContext; adminPolicyApi.ts:~697-720 doc). Scoped assignments are NOT in the flat set (`scopedHeld` separate). Keys = eos_policy.capabilities (139 rows at
migration 99; functions/test/governedNonprodReplayPostgres.test.mjs:44).

KEY VOCABULARIES ARE NOT THE SAME. Evidence:
- functions/src/adminPolicy/migration/credEquivalence.ts:7-14: "two different vocabularies ... FIREBASE permission catalog (several hundred ids), not in eos_policy.capabilities".
- My offline string-match (scratch script, approximate; Firebase catalog 151 `id:` entries in functions/src/access/permissionCatalog.ts, 71 of them appear as a same-named key in EOS migrations/baseline):
  Of the 51 ids the shell+account page request (shellCapabilityGates.js + accountPage.js), SAME-NAMED EOS KEY EXISTS for: admin.credentialReset.initiate, admin.dataImport.execute, admin.principalAccess.read,
  admin.roleAssignment.write, admin.securityPolicy.read*, admin.userStatus.write, audit.event.read, customer.record.read, equipment.compatibility.view, fulfillment.coordinatedVisit.read,
  inventory.catalog.activate/.manage, inventory.cycleCount.cancel/.create/.reconcile/.submit, inventory.placement.record, inventory.stock.receive, inventory.stock.relocate,
  inventory.transfer.cancel/.create/.dispatch/.receive, opportunity.read, reorder.purchaseOrder.void (migration key; no baseline grant string), salesOrder.read, workflowDefinition.read*.
  (* = key exists in EOS but has NO id in the Firebase catalog, so the Firebase feed denies it for everyone: governedBusinessRoles.ts:370-374.)
  NO SAME-NAMED EOS KEY (renamed, split, or absent): admin.dataImport.stage, crm.activity.read, finance.read (EOS split into finance.invoice.read / finance.payment.read, credEquivalence.ts:71-77),
  finance.visibility.{self,team,businessUnit,company,consolidated}, financialPolicy.profile.read/.configure (EOS: finance.policy.read/.prepare/.approve/.activate; migration 1764560000000 header :39),
  inventory.balance.read, inventory.location.bin.read/.manage, inventory.returns.intake, service.inboundWork.read (EOS: inboundWork.request.read; nav already uses that name, navConfig.js:258),
  report.customer.read/.contact.read/.location.read/.equipment.read, report.definition.{create,read,rename,duplicate,delete} (EOS reporting is BLOCKED: persona manifest report-analyst blockedBy REPORTING_CAPABILITY_VOCABULARY_ABSENT;
  EOS has surface `analysis.workspace` instead). Anything in this list needs a Named mapping decision (Owner/Controller) before an EOS read can answer it - a rename is not safe to infer.
  Where the client already used an EOS key for the same Firebase id (precedent): scan ids (inventory.stock.receive etc.) pass straight through (inventoryScanCapabilityAccess.js:32-35), opportunity.read/salesOrder.read via Commercial (AccountDetail.jsx:406-410).
- Surfaces vs permission ids are a separate vocabulary again: EXPERIENCE_SURFACE_KEYS (experienceContext.js:39-80 mirrors experienceAuthority.ts:802) are decided from capabilities; nav (`surfaceAccess`) uses them; screen gates use capability ids.

Existing parity / equivalence tooling (what each compares, how run):
1. functions/src/access/shadowParityHarness.ts + parityFixtures.ts + legacyAuthorizationSurface.ts (dual-mirrored to FE/access/*.ts by scripts/syncAccessContracts.mjs): FIREBASE-INTERNAL; compares new resolver
   (resolveEffectivePermission) vs the legacy compat-role decision per fixture label (shadowParityHarness.ts:49-58). Pure/offline. Run: `npm run test:access` -> `node test/shadowParityHarness.test.mjs`, test/legacyAuthorizationSurface.test.mjs (functions/package.json:16).
2. functions/src/adminPolicy/migration/roleAssignmentCensus.ts + effectiveAccessParity.ts (+ scripts/roleAssignmentCensusCli.js): FIREBASE roleAssignments vs POSTGRES user_role_assignments per principal, ROLE-LEVEL grants
   (roleKey, scope, capabilities); verdicts EXACT_PARITY / APPROVED_RETIREMENT_NARROWING / UNAPPROVED_NARROWING / WIDENING_BLOCKER / UNRESOLVED_EVIDENCE (effectiveAccessParity.ts:33-60). Pure core; CLI reads live Firestore (operator, read-only). Tests: test/effectiveAccessParity.test.mjs, roleAssignmentCensus*.test.mjs, roleAssignmentCensusPostgres.test.mjs (`npm run test:adminPolicy[Postgres]`).
3. functions/scripts/inventoryCapabilityParityHarness.js: legacy Firestore decision (re-using lib/access resolver modules) vs eos_policy decision for 8 inventory writer ops; needs live Firestore + PG (operator).
4. functions/src/adminPolicy/migration/credEquivalence.ts (+ test/credConvergencePostgres.test.mjs): CRED (Object x verb) grants in Firebase catalog terms vs capability-derived; PG test, offline with POLICY_TEST_DATABASE_URL.
5. functions/test/personaBusinessAccessRegression.test.mjs (1292 lines; test:adminPolicyPostgres): for each persona in functions/scripts/fixtures/personaAuthorityDimensions.v1.json resolves Security Roles -> capabilitiesForRoleKeys -> grantedSurfaceKeys -> client's own isNavItemVisible against a rebuilt disposable PG (proved equal to nonprod: 387 pairs at 2026-09-24 baseline). EOS side only.
   functions/test/governedNonprodReplayPostgres.test.mjs: repo replay reproduces nonprod authority exactly (94 migrations / 128 caps / 542 grants; later 99 / 139). functions/test/effectiveAccessExplanationPostgres.test.mjs proves explainEffectiveAccess == resolveOperationalContext + resolveExperienceContext per persona.
6. functions/scripts/sandboxPersonaAccessReport.js: Firebase side per persona via the REAL resolveEffectiveAccess against LIVE sandbox Firestore (read-only, refuses production; needs ADC credentials). Not offline.
7. Governance gates: scripts/firebaseCapabilityEquivalenceGuard.mjs + docs/architecture/firebase-capability-equivalence.json (retired Firebase operations need gates A-E + audit; docs/architecture/firebase-capability-equivalence-gate.md); scripts/firebaseExitGuard.mjs ratchet with docs/architecture/firebase-exit-baseline.json (these three FE files are listed there as firestore_client baselines: useReportCapabilities.js, employeeSession.js, useCurrentTechnician.js, accountPageComponents.js at baseline lines 13-20; functions client: useReportCapabilities.js, accountPageComponents.js :29,34 - the baseline "may only shrink").
No existing harness compares a Firebase `resolveEffectiveAccess` decision vs EOS `resolveMyCapabilities` for the SHELL id set per persona. That is the gap F1 must fill (for the ids whose names match; renamed ids need an explicit map first).

## 4. Personas

The 16 governed nonprod persona keys (closed list): functions/src/eosAuth/nonprodPersonas.ts:10-27, pinned to config/sandboxRoleIdentityRegistry.json roles[].key (test/eosAuthNoFirebase.test.mjs).
EOS subject pattern `nonprod-persona.<key>` (nonprodPersonas.ts:41-48). Security Roles / Job Roles from functions/scripts/fixtures/personaAuthorityDimensions.v1.json (manifest keys differ from registry keys; jobRole shown is the manifest's):

| registry key | manifest persona | Security Roles (EOS) | Job Role | notes |
|---|---|---|---|---|
| ownerExecutive | owner-executive | owner (47 caps) | OWNER_EXECUTIVE | Owner persona; no Work Eligibility/Scope by design; registry ownerAdminSplit says the owner Principal had no Employee link until the split is applied |
| administrator | administrator | admin (66 caps) | OFFICE_ADMINISTRATION | THE admin persona (existing real sandbox admin Principal, reused); employee synthetic-np-emp-administrator |
| generalManager | general-manager | generalManager | GENERAL_MANAGER | |
| officeManager | office-manager | officeManager | OFFICE_MANAGER | |
| serviceManager | service-manager | fieldManager | SERVICE_MANAGER | Security Role != legacy role (sharpest legacy-role-mapping risk) |
| dispatcher | dispatcher | dispatcher | SERVICE_COORDINATOR_DISPATCHER | |
| serviceTechnician | service-technician-a | technician | SERVICE_TECHNICIAN | the ONE login technician (other technician fixtures have no login) |
| partsAssociate | parts-associate | partsAssociate, inventoryReceivingClerk | PARTS_ASSOCIATE | |
| partsManager | parts-manager | partsManager, purchasingManager | PARTS_MANAGER | |
| warehouseAssociate | warehouse-associate | warehouseAssociate, inventoryCycleCountCounter | WAREHOUSE_ASSOCIATE | |
| warehouseManager | warehouse-manager | warehouseManager, inventoryCycleCountReconciler, inventoryBinAdministrator | WAREHOUSE_MANAGER | |
| retailSales | retail-sales-a | salesperson | RETAIL_SALES | |
| nationalAccountsSales | national-accounts-sales | salesperson | NATIONAL_ACCOUNTS_SALES | same Role, different scope |
| financeAccounting | finance-controller | manifest: controller; REGISTRY: expectedSecurityRoles ["accountingManager"] | FINANCE_ACCOUNTING | DISCREPANCY between manifest and registry - UNVERIFIED which is live |
| reportingAnalyst | report-analyst | manifest: []; REGISTRY: ["reportViewer"] | REPORTING_ANALYST | reporting BLOCKED_DOMAIN; reportViewer has 0 grants (personaBusinessAccessRegression header) |
| generalEmployee | restricted-user | manifest: ["generalEmployee"]; REGISTRY: [] and forbids generalEmployee | OFFICE_MANAGER | DISCREPANCY - UNVERIFIED; the access-control "restricted" control |
Sandbox synthetic workforce seed: functions/scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json has 16 Employees (ids `synthetic-np-emp-*`; incl. contract-technician status CONTRACTOR and technician-on-leave ON_LEAVE, which have no login) and 8 non-authenticating Principals; superseded by sampleCompany.v2.json (21 employees, 18 principals).
Other manifest-only personas without login: records-clerk, technician-on-leave, contract-technician, retail-sales-b, service-technician-b.

Offline computability of capability sets on BOTH sides without production credentials:
- EOS side: YES. personaBusinessAccessRegression.test.mjs / personaAuthorityDimensions seeding (functions/scripts/sampleCompany/personaAuthorityDimensions.js, test/personaAuthorityDimensions.test.mjs) and `capabilitiesForRoleKeys` over a local disposable PG
  (`POLICY_TEST_DATABASE_URL`, per AGENTS.md Cursor Cloud section: postgres://eos:eos@127.0.0.1:5432/eos_policy via .cursor/start.sh). Nothing needs Firebase or production.
- Firebase side: PARTIAL. `resolveEffectiveAccess(input, {db, roles})` accepts an injected db and role catalog (effectiveAccessFeed.ts:93-103) and `resolveEffectivePermission` is pure, so a fake Firestore with
  `users/{uid}` + `roleAssignments` docs gives the callable's exact decisions offline. BUT no repo file records what each persona's Firestore `users.role` and `roleAssignments` actually are: they were written by
  governed trusted-writer commands into the live sandbox Firestore (sandboxPersonaBootstrap.js never writes Firebase roles; applyRoleGrants.mjs uses grantRole). So the Firebase-side per-persona input is either
  (a) assumed equal to the EOS Security Role keys (many Firebase governed-role ids coincide with EOS role keys, e.g. owner/admin/dispatcher/technician; NOT proven for fieldManager, generalManager, officeManager, controller/accountingManager ...), or
  (b) read from live sandbox Firestore (scripts/sandboxPersonaAccessReport.js / roleAssignmentCensusCli.js; operator-run, read-only, needs ADC).
  Verdict: no existing script computes BOTH sides offline from seed snapshots; a new harness would combine (EOS: capabilitiesForRoleKeys over local PG) with (Firebase: resolveEffectiveAccess with a fake db) and either assume or snapshot the Firebase assignments.

## 5. Risks if the source switches (behaviour changes)

1. LEGACY ROLE IS AN ACTION GATE, NOT JUST NAV. If `role` becomes null/EOS-derived, these change even in sandbox where nav is already EOS: DispatcherBoard hard-denies (DispatcherBoard.jsx:502), Jobs create-WO button
   (Jobs.jsx:78-80), NotificationControl reorder queue (NotificationControl.jsx:65), WorkOrderActions (WorkOrderDetailPage.jsx:329), AccountDetail governed-field pencils (AccountDetail.jsx:377), RequestReorderControl,
   scan TECHNICIAN_WORK_ORDER (scanWorkflows.js:305), Dashboard FIELD_WORK choice (legacy branch only), diagnostics route. A role-string swap would silently change who can do what.
2. ROLE VOCABULARY: EOS has many Security Roles; legacy has 3 roles. Personas serviceManager (fieldManager), generalManager, officeManager, controller/accountingManager, salesperson, partsManager have no 1:1 legacy role. Firebase users.role for them is UNVERIFIED.
3. technicianId vs employeeId: scan gate requires users.technicianId (fieldops id); EOS has none. Replacement must be employeeId + workEligibility SERVICE_TECHNICIAN, which can differ (contract-technician CONTRACTOR, technician-on-leave ON_LEAVE are eligibility-gated server-side). `technician.name/status` display has no equivalent (name -> Employee displayName; status pill TECH_STATUS has no EOS twin).
4. operationalRoles has NO EOS source (not migrated). Consumers: RequestReorderControl (security-like), dashboard cards, TechnicianDashboard "inventory role" redirect, nav operationalRoleAccess (legacy-only). Must be re-expressed via capabilities/eligibility/scope; legacyConsumerLedger.ts lists all as NOT_STARTED.
5. employmentStatus: only nav operationalRoleAccess uses it; EOS readMyEmployeeProfile fails 404/409/412 for an unlinked/ambiguous principal where Firestore silently returned nulls (employeeSession.js:59-61 treats missing employeeId as valid). New failure mode -> must map to "null identity" not identityError, or AuthContext shows the retry panel (App.jsx:1390) for every unlinked user (e.g. Owner persona before link, generalEmployee).
6. accessVersion SEMANTICS: Firebase = live onSnapshot counter; revocation takes effect the instant the counter bumps, grants after refetch (useReportCapabilities.js:7-16). EOS reads are one-shot per principalKey (useExperienceContext.js:60-100, useCommercialCapabilities.js) with no version, no push, no staleness signal; `accessVersion` consumers (list re-key sites in 1B) would receive null forever. Existing EOS hooks accepted this; any F1 hook must say whether stale-until-reload is acceptable or add a poll/refresh-on-focus (a behaviour decision, not mechanics).
7. `accessResolving` shell gate (App.jsx:1408): a slow/failed EOS read must map to settled-deny (not infinite Loading) or the whole app blanks; today a missing users.accessVersion is "settled ERROR", not Loading.
8. FAIL-CLOSED DIRECTION: Firebase feed denies ids absent from its catalog and active:false ids per environment; EOS grants whatever the Role holds. Switching widens in places (admin.securityPolicy.read, workflowDefinition.read are denied by Firebase for everyone but held in EOS) and may narrow elsewhere (renamed/absent ids: report.*, finance.visibility.*, inventory.location.bin.*, admin.dataImport.stage, crm.activity.read, finance.read). Both directions are a behaviour change; the effectiveAccessParity doctrine treats WIDENING as a hard stop with no approval path.
9. PRODUCTION: eosApi null, flag false => EOS reads NOT_CONFIGURED. Without an env gate, production sessions would lose role/identity entirely (identityError). The F1 code must keep the Firebase path as the SOLE source wherever `policyApiBaseUrl()` is null (this is not a "fallback on failure": it is source selection by environment, which navigationAuthorityReadiness.js explicitly forbids doing at runtime - a compile-time flag in config/environments.json + scripts/resolveEnvironment.mjs REQUIRED key is the established pattern).
10. Account page (accountPageComponents.js): only finance.read and crm.activity.read still come from the Firebase feed; neither has a same-named EOS key (finance.read split; crm.activity.read absent) so those two sections cannot be switched without a mapping/ruling.
11. CI guards: scripts/firebaseExitGuard.mjs baseline lists these files; removing the Firestore imports must lower the baseline in the same PR (ratchet only shrinks). Any F1 PR also trips scripts/firebaseCapabilityEquivalenceGuard.mjs only if it removes an exported Cloud Function (resolveEffectiveAccessCallable removal would need a GATED record; keeping the callable avoids this).
12. Tests that pin current behaviour (UNVERIFIED list, not read): test/capabilityRequestCoverage.test.mjs (request set == gates), test/operationsExperienceTransport.test.jsx (flag false => no request), AccountDetail fail-closed tests, auth tests for resolveEmployeeSession shape (FE/test/*.test.mjs). Re-read before editing.
