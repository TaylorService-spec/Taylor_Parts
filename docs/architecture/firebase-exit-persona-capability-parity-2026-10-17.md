# Firebase exit F1-0: persona capability parity (measured 2026-10-17)

**Measurement only.** Nothing changes until the Owner rules on (a)–(e) in the F1 session capability map (controller Owner packet).

**Sources:**
- **Generator:** `functions/scripts/firebaseExit/personaCapabilityParity.mjs`.
- **OLD:** the live sandbox `resolveEffectiveAccessCallable` with the shell's own 51 ids.
- **NEW:** the live `eos-api-nonprod` `resolveMyCapabilities`.
- **Captures:** read-only, each with the persona's own session, no tokens. The controller made them with `personaCapabilityCapture.mjs`.
  - For the 4 personas with a `users` doc, the captures also hold the gate inputs G6 and G7 read: the `employees/{employeeId}` operationalRoles and `users/{uid}.technicianId`.
- **Rudy Admin** is the `administrator` row (the same account), so the 16 rows cover all 17.

## How to read it
- **WIDEN:** EOS allows something the Firebase feed denied.
  - **12 personas have no legacy `users` doc:** generalManager, nationalAccountsSales, officeManager, ownerExecutive, partsAssociate, partsManager, reportingAnalyst, retailSales, serviceManager, serviceTechnician, warehouseAssociate, warehouseManager. For them the Firebase feed granted little or nothing. EOS answers from their governed Roles and already enforces those grants server-side. In the shell, each WIDEN row **becomes a visible control or screen at F1-1**.
  - **4 personas have one:** administrator, dispatcher, financeAccounting, and generalEmployee (legacy role `technician`).
  - For `administrator`, the WIDEN rows come from the 2026-10-17 governed business-role grant. EOS includes it; Firestore `roleAssignments` was not changed.
- **NARROW:** EOS denies something the Firebase feed allowed. Each one is named below.
- **UNMAPPED_ALLOW:** Firebase allows an id that has no same-named EOS key. It would be lost unless mapped (ruling (a)).
- **Gates:** the NEW column is a CANDIDATE EOS capability, a proposal for ruling (b).
  - G1 has an alternative candidate (G1-alt, `workOrder.lifecycle.dispatch`) because a schedule-only candidate would hide the board from a dispatch-only holder.
  - G5 and G8 have no candidate.
  - OLD assumes a **Firebase** session. Under an EOS session every role gate is DENY today.
- A missing `old.decisions[id]` is refused, never read as DENY.


Legend: `=✓` both allow · `=` both deny · `W` WIDEN (EOS allows, Firebase denied) · `N` NARROW (EOS denies, Firebase allowed) · `N?` Firebase allows and EOS has no same-named key (lost unless mapped, ruling (a)) · `·` neither has it under this name.

Totals: UNMAPPED_ALLOW 22, EQUAL 461, WIDEN 74, UNMAPPED_DENY 362, NARROW 9, NO_CANDIDATE 32.

## The 51 shell capability ids

Legacy role: administrator=admin, dispatcher=dispatcher, financeAccounting=dispatcher, generalEmployee=technician, generalManager=none, nationalAccountsSales=none, officeManager=none, ownerExecutive=none, partsAssociate=none, partsManager=none, reportingAnalyst=none, retailSales=none, serviceManager=none, serviceTechnician=none, warehouseAssociate=none, warehouseManager=none.
- **administrator**: administrator persona == Rudy Admin (admin@sandbox.invalid); WIDEN rows explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)

| id | administrator | dispatcher | financeAccounting | generalEmployee | generalManager | nationalAccountsSales | officeManager | ownerExecutive | partsAssociate | partsManager | reportingAnalyst | retailSales | serviceManager | serviceTechnician | warehouseAssociate | warehouseManager |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `report.customer.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `report.contact.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `report.location.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `report.equipment.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `report.definition.create` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `report.definition.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `report.definition.rename` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `report.definition.duplicate` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `report.definition.delete` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `inventory.transfer.create` | =✓ | = | = | = | = | = | = | W | = | = | = | = | = | = | W | = |
| `inventory.transfer.dispatch` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | W | = |
| `inventory.transfer.receive` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | W | = | W |
| `inventory.transfer.cancel` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | W | = |
| `inventory.cycleCount.create` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | W | = |
| `inventory.cycleCount.submit` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | W | = |
| `inventory.cycleCount.reconcile` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | = | W |
| `inventory.cycleCount.cancel` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | W | = |
| `inventory.catalog.manage` | =✓ | = | N | = | W | = | = | W | = | W | = | = | W | = | = | W |
| `inventory.catalog.activate` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | = | = |
| `inventory.stock.receive` | =✓ | =✓ | = | = | = | = | = | = | W | = | = | = | = | = | = | = |
| `inventory.placement.record` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | W | = |
| `inventory.location.bin.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `inventory.returns.intake` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `admin.dataImport.stage` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `admin.dataImport.execute` | =✓ | = | = | = | = | = | = | = | = | = | = | = | = | = | = | = |
| `admin.userStatus.write` | =✓ | = | = | = | = | = | = | W | = | = | = | = | = | = | = | = |
| `audit.event.read` | =✓ | = | =✓ | = | W | = | = | W | = | W | = | = | W | = | = | W |
| `admin.credentialReset.initiate` | W | = | = | = | = | = | = | W | = | = | = | = | = | = | = | = |
| `admin.roleAssignment.write` | =✓ | = | = | = | = | = | = | W | = | = | = | = | = | = | = | = |
| `admin.principalAccess.read` | W | = | = | = | = | = | = | W | = | = | = | = | = | = | = | = |
| `service.inboundWork.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `administration.emailIntake.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `admin.securityPolicy.read` | W | = | = | = | = | = | = | W | = | = | = | = | = | = | = | = |
| `workflowDefinition.read` | W | = | = | = | = | = | = | W | = | = | = | = | = | = | = | = |
| `customer.record.read` | =✓ | =✓ | =✓ | = | W | W | W | W | W | W | = | W | W | = | = | W |
| `finance.read` | N? | · | N? | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `opportunity.read` | =✓ | =✓ | W | = | W | = | = | W | = | = | = | = | = | = | = | = |
| `salesOrder.read` | =✓ | =✓ | =✓ | = | W | = | = | W | W | W | = | = | W | = | W | W |
| `fulfillment.coordinatedVisit.read` | =✓ | =✓ | N | = | = | = | = | W | = | = | = | = | W | = | = | = |
| `inventory.balance.read` | N? | · | N? | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `finance.visibility.self` | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `finance.visibility.team` | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `finance.visibility.businessUnit` | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `finance.visibility.company` | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `finance.visibility.consolidated` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `inventory.stock.relocate` | W | = | = | = | = | = | = | = | = | = | = | = | = | = | W | = |
| `inventory.location.bin.manage` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `financialPolicy.profile.read` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `financialPolicy.profile.configure` | N? | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `equipment.compatibility.view` | W | = | = | = | = | = | = | W | = | = | = | = | = | = | = | = |
| `reorder.purchaseOrder.void` | W | = | = | = | = | = | = | = | = | W | = | = | = | = | = | = |

## The legacy-role gates (new column = CANDIDATE capability, a proposal for ruling (b))

OLD is each gate under a **Firebase** session: role = `users/{uid}.role`, operationalRoles = `employees/{employeeId}.operationalRoles`, technicianId = `users/{uid}.technicianId`. Under an EOS session `role` is null today (no frontend role map), so every role gate is DENY there. `?` = UNVERIFIED: a gate input was not captured.

| gate | surface | candidate EOS capability | administrator | dispatcher | financeAccounting | generalEmployee | generalManager | nationalAccountsSales | officeManager | ownerExecutive | partsAssociate | partsManager | reportingAnalyst | retailSales | serviceManager | serviceTechnician | warehouseAssociate | warehouseManager |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G1 | Dispatch Board renders (DispatcherBoard.jsx:502) | `workOrder.lifecycle.schedule` | old✓/new✓ = | old✓/new✓ = | old✓/new✗ N | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✓ W | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = |
| G1-alt | Dispatch Board renders: ALTERNATIVE candidate (the board's EOS nav surface service.dispatch is earned by dispatch; schedule and dispatch are separate board controls since #2116) | `workOrder.lifecycle.dispatch` | old✓/new✓ = | old✓/new✓ = | old✓/new✗ N | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✓ W | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = |
| G2 | Jobs: New Work Order (Jobs.jsx:78) | `workOrder.create` | old✓/new✓ = | old✓/new✓ = | old✓/new✗ N | old✗/new✗ = | old✗/new✓ W | old✗/new✗ = | old✗/new✓ W | old✗/new✓ W | old✗/new✓ W | old✗/new✓ W | old✗/new✗ = | old✗/new✗ = | old✗/new✓ W | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = |
| G3 | Reorder queue notifications (NotificationControl.jsx:65) | `reorder.request.read.queue` | old✓/new✗ N | old✓/new✗ N | old✓/new✗ N | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = |
| G4 | Work Order office actions: Ready/Schedule/Dispatch/Close/Cancel/Unschedule (workOrderWorkflow.js ACTION_PERMISSIONS, WorkOrderDetailPage.jsx:329) | `workOrder.lifecycle.ready`, `workOrder.lifecycle.schedule`, `workOrder.lifecycle.dispatch`, `workOrder.lifecycle.close`, `workOrder.lifecycle.cancel` | old✓/new✓ = | old✓/new✓ = | old✓/new✗ N | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✓ W | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = |
| G5 | Account governed-field pencils (AccountDetail.jsx:377) | no candidate | old✓/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — |
| G6 | Request Reorder control (RequestReorderControl.jsx:66) | `reorder.request.create.manual` | old✓/new✓ = | old✗/new✓ W | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✓ W | old✗/new✓ W | old✗/new✓ W | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✓ W |
| G7 | Scan: technician Work Order workflow (scanWorkflows.js:305) | `workOrder.execution.record` | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✗ = | old✗/new✓ W | old✗/new✗ = | old✗/new✗ = |
| G8 | Parts shadow-parity diagnostics (PartsShadowParityDiagnostics.jsx:21) | no candidate | old✓/— — | old✓/— — | old✓/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — | old✗/— — |

## Every difference, named

- **administrator** `report.customer.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `report.contact.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `report.location.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `report.equipment.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `report.definition.create`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `report.definition.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `report.definition.rename`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `report.definition.duplicate`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `report.definition.delete`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `inventory.location.bin.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `inventory.returns.intake`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `admin.dataImport.stage`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `admin.credentialReset.initiate`: WIDEN (old DENY → new ALLOW) -- explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)
- **administrator** `admin.principalAccess.read`: WIDEN (old DENY → new ALLOW) -- explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)
- **administrator** `service.inboundWork.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `administration.emailIntake.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `admin.securityPolicy.read`: WIDEN (old DENY → new ALLOW) -- explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)
- **administrator** `workflowDefinition.read`: WIDEN (old DENY → new ALLOW) -- explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)
- **administrator** `finance.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `inventory.balance.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `finance.visibility.consolidated`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `inventory.stock.relocate`: WIDEN (old DENY → new ALLOW) -- explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)
- **administrator** `inventory.location.bin.manage`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `financialPolicy.profile.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `financialPolicy.profile.configure`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **administrator** `equipment.compatibility.view`: WIDEN (old DENY → new ALLOW) -- explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)
- **administrator** `reorder.purchaseOrder.void`: WIDEN (old DENY → new ALLOW) -- explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)
- **administrator** gate G3: NARROW (old ALLOW → new DENY)
- **administrator** gate G5: NO_CANDIDATE (old ALLOW → new no candidate)
- **administrator** gate G8: NO_CANDIDATE (old ALLOW → new no candidate)
- **dispatcher** gate G3: NARROW (old ALLOW → new DENY)
- **dispatcher** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **dispatcher** gate G6: WIDEN (old DENY → new ALLOW)
- **dispatcher** gate G8: NO_CANDIDATE (old ALLOW → new no candidate)
- **financeAccounting** `inventory.catalog.manage`: NARROW (old ALLOW → new DENY)
- **financeAccounting** `finance.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **financeAccounting** `opportunity.read`: WIDEN (old DENY → new ALLOW)
- **financeAccounting** `fulfillment.coordinatedVisit.read`: NARROW (old ALLOW → new DENY)
- **financeAccounting** `inventory.balance.read`: UNMAPPED_ALLOW (old ALLOW → new no EOS key)
- **financeAccounting** gate G1: NARROW (old ALLOW → new DENY)
- **financeAccounting** gate G1-alt: NARROW (old ALLOW → new DENY)
- **financeAccounting** gate G2: NARROW (old ALLOW → new DENY)
- **financeAccounting** gate G3: NARROW (old ALLOW → new DENY)
- **financeAccounting** gate G4: NARROW (old ALLOW → new DENY)
- **financeAccounting** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **financeAccounting** gate G8: NO_CANDIDATE (old ALLOW → new no candidate)
- **generalEmployee** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **generalEmployee** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **generalManager** `inventory.catalog.manage`: WIDEN (old DENY → new ALLOW)
- **generalManager** `audit.event.read`: WIDEN (old DENY → new ALLOW)
- **generalManager** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **generalManager** `opportunity.read`: WIDEN (old DENY → new ALLOW)
- **generalManager** `salesOrder.read`: WIDEN (old DENY → new ALLOW)
- **generalManager** gate G2: WIDEN (old DENY → new ALLOW)
- **generalManager** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **generalManager** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **nationalAccountsSales** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **nationalAccountsSales** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **nationalAccountsSales** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **officeManager** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **officeManager** gate G2: WIDEN (old DENY → new ALLOW)
- **officeManager** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **officeManager** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **ownerExecutive** `inventory.transfer.create`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `inventory.catalog.manage`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `admin.userStatus.write`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `audit.event.read`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `admin.credentialReset.initiate`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `admin.roleAssignment.write`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `admin.principalAccess.read`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `admin.securityPolicy.read`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `workflowDefinition.read`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `opportunity.read`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `salesOrder.read`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `fulfillment.coordinatedVisit.read`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** `equipment.compatibility.view`: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** gate G2: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **ownerExecutive** gate G6: WIDEN (old DENY → new ALLOW)
- **ownerExecutive** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **partsAssociate** `inventory.stock.receive`: WIDEN (old DENY → new ALLOW)
- **partsAssociate** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **partsAssociate** `salesOrder.read`: WIDEN (old DENY → new ALLOW)
- **partsAssociate** gate G2: WIDEN (old DENY → new ALLOW)
- **partsAssociate** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **partsAssociate** gate G6: WIDEN (old DENY → new ALLOW)
- **partsAssociate** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **partsManager** `inventory.catalog.manage`: WIDEN (old DENY → new ALLOW)
- **partsManager** `audit.event.read`: WIDEN (old DENY → new ALLOW)
- **partsManager** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **partsManager** `salesOrder.read`: WIDEN (old DENY → new ALLOW)
- **partsManager** `reorder.purchaseOrder.void`: WIDEN (old DENY → new ALLOW)
- **partsManager** gate G2: WIDEN (old DENY → new ALLOW)
- **partsManager** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **partsManager** gate G6: WIDEN (old DENY → new ALLOW)
- **partsManager** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **reportingAnalyst** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **reportingAnalyst** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **retailSales** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **retailSales** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **retailSales** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **serviceManager** `inventory.catalog.manage`: WIDEN (old DENY → new ALLOW)
- **serviceManager** `audit.event.read`: WIDEN (old DENY → new ALLOW)
- **serviceManager** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **serviceManager** `salesOrder.read`: WIDEN (old DENY → new ALLOW)
- **serviceManager** `fulfillment.coordinatedVisit.read`: WIDEN (old DENY → new ALLOW)
- **serviceManager** gate G1: WIDEN (old DENY → new ALLOW)
- **serviceManager** gate G1-alt: WIDEN (old DENY → new ALLOW)
- **serviceManager** gate G2: WIDEN (old DENY → new ALLOW)
- **serviceManager** gate G4: WIDEN (old DENY → new ALLOW)
- **serviceManager** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **serviceManager** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **serviceTechnician** `inventory.transfer.receive`: WIDEN (old DENY → new ALLOW)
- **serviceTechnician** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **serviceTechnician** gate G7: WIDEN (old DENY → new ALLOW)
- **serviceTechnician** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **warehouseAssociate** `inventory.transfer.create`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** `inventory.transfer.dispatch`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** `inventory.transfer.cancel`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** `inventory.cycleCount.create`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** `inventory.cycleCount.submit`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** `inventory.cycleCount.cancel`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** `inventory.placement.record`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** `salesOrder.read`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** `inventory.stock.relocate`: WIDEN (old DENY → new ALLOW)
- **warehouseAssociate** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **warehouseAssociate** gate G8: NO_CANDIDATE (old DENY → new no candidate)
- **warehouseManager** `inventory.transfer.receive`: WIDEN (old DENY → new ALLOW)
- **warehouseManager** `inventory.cycleCount.reconcile`: WIDEN (old DENY → new ALLOW)
- **warehouseManager** `inventory.catalog.manage`: WIDEN (old DENY → new ALLOW)
- **warehouseManager** `audit.event.read`: WIDEN (old DENY → new ALLOW)
- **warehouseManager** `customer.record.read`: WIDEN (old DENY → new ALLOW)
- **warehouseManager** `salesOrder.read`: WIDEN (old DENY → new ALLOW)
- **warehouseManager** gate G5: NO_CANDIDATE (old DENY → new no candidate)
- **warehouseManager** gate G6: WIDEN (old DENY → new ALLOW)
- **warehouseManager** gate G8: NO_CANDIDATE (old DENY → new no candidate)
