# Work Order Firebase retirement ledger

Owner rulings: **WORK ORDER DOMAIN CUTOVER AUTHORIZATION** and **WORK ORDER CUTOVER COMPLETION PASS** (2026-09-30).

Objective: **zero active Work Order runtime dependence on Firebase.** The only exception allowed is the provider/email polling boundary, which is technically separable and documented below.

Old Firebase functions that are no longer deployed or called may stay in source until the final Firebase retirement. The active EOS runtime and the client must not invoke them.

## Global dependency count (docs/architecture/firebase-exit-baseline.json)

| Point | Frontend Firestore | Frontend Functions | Server (unchanged) | Total |
|---|---|---|---|---|
| Deployed baseline, main 24403c2a | 34 | 41 | 262 | **337** |
| Core cutover (1bef1edb) | 28 | 40 | 262 | **330** |
| Completion pass (this candidate) | 26 | 35 | 262 | **323** |

- The server total of 262 is `firebase_admin_firestore` 183 + `firebase_functions_server` 72 + auth 5.
- The guard (`scripts/firebaseExitGuard.mjs`) reports **0 new violations**.
- The baseline only shrinks. Each removal is a file the scan no longer observes.

## Work Order dependencies

Every row below also has a client cutover: the listed client no longer invokes the old Firebase dependency.

| Firebase dependency | Former caller | EOS replacement | Test proof | Retirement state |
|---|---|---|---|---|
| `createWorkOrder` callable | `services/workOrderService.ts` (wizard) | `POST /operations/work-orders` `createWorkOrder` (governed company, idempotency key) | `workOrderJourneyAcceptancePostgres`, `serviceTechnicianJourneyPostgres` | RETIRED from client |
| `transitionWorkOrder` callable (all actions) | `workOrderService.ts` (office, dispatch, technician surfaces, offline bindings) | the lifecycle operations: markReady, schedule, unschedule, reschedule, dispatch, accept, travel, arrive, start, complete, close, cancel | `workOrderDomainCutoverPostgres`, both journeys | RETIRED from client |
| `updateWorkOrderExecutionData` callable | `workOrderService.ts` (ExecutionCapture, JobNote, PartsScanner, offline) | `recordWorkOrderExecution` (append-only actuals + notes; no stock movement) | `workOrderDomainCutoverPostgres` | RETIRED from client |
| `setWorkOrderPartsPlan` callable | `workOrderService.ts` (`useWorkOrderPartsPlan`) | `setWorkOrderPartsPlan` | journeys | RETIRED from client |
| `listWorkOrderConsumptionSources` callable | `workOrderService.ts` (ExecutionCapture) | none. Stock movement is NOT_YET_ACTIVATED; actuals are execution facts. | `workOrderDomainCutoverPostgres` | RETIRED from client (source picker removed) |
| Firestore `fieldops_wos` reads | `workOrderService.ts`, `useWorkOrder.js`, `useWorkOrderSearch.js`, `usePartWorkOrderDemand.js`, `accountWorkOrders.js`, `types/workOrder.ts`, `useEquipment.js`, `useSchedulingData.js` | readWorkOrder, listWorkOrders (search, customer, equipment, planned-part filters), listMyAssignedWorkOrders | `workOrderApiClient.test`, journeys | RETIRED from client |
| `getWorkOrderLabor` / `recordWorkOrderLabor` callables | `services/workOrderLaborCallableClient.js` | readWorkOrderLabor, recordWorkOrderLabor | `workOrderLaborPostgres`, `serviceTechnicianJourneyPostgres` | RETIRED from client |
| `getWorkOrderFieldContext` callable | `hooks/useWorkOrderFieldContext.js` | readWorkOrderFieldContext | `workOrderFieldContextPostgres`, `serviceTechnicianJourneyPostgres` | RETIRED from client |
| `getWorkOrderReadinessContext` callable | `services/workOrderReadinessContextClient.js` | readWorkOrderReadiness (inventory = NOT_YET_ACTIVATED) | `workOrderFieldContextPostgres`, `serviceTechnicianJourneyPostgres` | RETIRED from client |
| duration estimate (`setWorkOrderEstimatedDuration` callable) | `services/schedulingCommandClient.js` | setWorkOrderEstimatedDuration (audited) | `technicianAvailabilityClient.test`, `serviceTechnicianJourneyPostgres` | RETIRED from client |
| `readTechnicianAvailabilityCallable` (and working hours / blocked time) | `services/schedulingCommandClient.js` (dispatch board lanes) | readTechnicianAvailability, setTechnicianWorkingHours, record/endTechnicianUnavailability, findAvailableTechnicianSlots | `workOrderAvailabilityPostgres` | RETIRED from client |
| Firestore Work Order aggregates (3 reads) | `analytics/executionAnalyticsService.ts`, `modules/operations/Operations.jsx` | readTechnicianExecutionStats, readWorkOrderConsumptionSnapshot, readTechnicianVolumeBreakdown (active, non-quarantined set) | `workOrderAnalyticsPostgres`, `serviceTechnicianJourneyPostgres` | RETIRED from client |
| `listCoordinatedOperations` callable | `access/coordinatedOperationsSource.js` | Commercial transport `listCoordinatedOperations`: the parity-proven PostgreSQL read, with the Sales Order as coordinator and the quarantine excluded | `coordinatedVisitPostgresParity`, `coordinatedOperationsSource.test` | RETIRED from client |
| Inbound Work callables: `listInboundWork`, `getInboundWorkRequest`, `acceptInboundWork`, `declineInboundWork`, `attachInboundWorkToWorkOrder` | `modules/service/InboundWorkWorkspace.jsx` via `access/inboundWorkSource.js` | `POST /operations/inbound-work`: read, list, accept (EOS createWorkOrder, idempotent), attach, decline | `inboundWorkPostgres` | RETIRED from client |

## Held boundaries: named, not hidden

| Firebase dependency | Caller | Why it is held | State |
|---|---|---|---|
| `getInstallableEquipmentForWorkOrder` / `recordWorkOrderEquipmentInstall`, `installSerializedAsset` | `services/workOrderInstallCallableClient.js`, `services/equipmentInstallCallableClient.js` (still in the baseline) | Serialized custody mutation waits for the Inventory authority (DECISION 6). The Work Order UI no longer calls them and shows "Equipment install is not activated yet". | NO ACTIVE WORK ORDER CALLER; NOT_YET_ACTIVATED |
| Provider email polling and mailbox administration: `pollEmailMailboxes`, the transport callables, the intake admin callables, collections `email_*` and `inbound_work_requests` | `access/inboundWorkSource.js` (Administration → Email & Communications) | Firebase Functions cannot reach the Render PostgreSQL. Mail polled from a real mailbox lands in Firestore. An EOS-side poller is a separate provider-runtime cutover. This path does not act on Work Orders. | PROVIDER BOUNDARY: documented, separable |
| Reporting `workOrder` / `serviceHistory` objects over `fieldops_wos` | `domain/reporting/reportCatalog.js` (Reporting domain) | "Do not redesign Reporting". This is not a Service surface. | Outside this cutover |
| Firebase-feed navigation gate for Service → Inbound Work (`service.inboundWork.read`) | `NAV_SURFACE_GAPS` "service/inboundWork" | The navigation needs remapping to `inboundWork.request.read` once that grant is ruled | OPEN (see Decision Queue) |
| Equipment register reads over the Firestore `equipment` collection (by account, by location, one unit) | `hooks/useEquipment.js` (still in the baseline) | The Equipment domain is not part of this cutover. A Work Order's own Equipment is read from PostgreSQL through readWorkOrder / readWorkOrderFieldContext, and the Work Orders-for-a-unit query in the same hook moved to listWorkOrders. | Outside this cutover (Equipment domain) |
| `fieldops_technicians` profile reads (`useCurrentTechnician.js`, `Technicians.jsx`, `jobActions.js`, `collectionStore.js`) | technician profile and legacy jobs | Not Work Order assignment: assignment uses the Employee. These are profile and legacy-jobs surfaces. | Outside this cutover |

## Server side

- The EOS server (Render) calls no Firebase for Work Orders.
- The Firebase Work Order functions stay in source and are exported. No active client calls them. They retire with the final Firebase retirement.
- Firebase deploy for this package: **NONE**.
