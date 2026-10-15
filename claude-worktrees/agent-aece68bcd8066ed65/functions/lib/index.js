"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unassignTruckDriverCallable = exports.reassignTruckDriverCallable = exports.assignTruckDriverCallable = exports.createTruckCallable = exports.listResetEligibleUsers = exports.initiateAdminPasswordReset = exports.resolveEffectiveAccessCallable = exports.deleteSavedDefinitionCallable = exports.duplicateSavedDefinitionCallable = exports.renameSavedDefinitionCallable = exports.listSavedDefinitionsCallable = exports.getSavedDefinitionCallable = exports.createSavedDefinitionCallable = exports.runReportDefinitionCallable = exports.rejectAccessRequest = exports.approveAccessRequest = exports.setUserStatus = exports.assignApprovedRole = exports.revokeRole = exports.grantRole = exports.completeAssignedJob = exports.getWorkOrderFieldContext = exports.recordRefund = exports.resolveCoverageForContext = exports.createCoverageAssignment = exports.createSalesTerritory = exports.listAccountInvoiceAr = exports.recordInvoiceAdjustment = exports.applyPayment = exports.issueInvoice = exports.createServiceForSalesOrder = exports.allocateSalesOrder = exports.transitionSalesOrder = exports.createSalesOrder = exports.listCoordinatedOperations = exports.getAvailableEquipment = exports.getManufacturerCatalog = exports.listSalesOrdersForAccount = exports.getSalesOrderContext = exports.createSalesOrderFromOpportunity = exports.listOpportunitiesForAccount = exports.listOpportunityContext = exports.transitionOpportunity = exports.createOpportunity = exports.setWorkOrderPartsPlan = exports.getInventoryAnalytics = exports.detectInventoryEffects = exports.updateWorkOrderExecutionData = exports.transitionWorkOrder = exports.createWorkOrder = void 0;
exports.getCrmActivities = exports.createCrmActivity = exports.setPreferredSupplier = exports.changePartSupplierItemStatus = exports.updatePartSupplierItem = exports.createPartSupplierItem = exports.changeManufacturerStatus = exports.updateManufacturer = exports.createManufacturer = exports.changePartStatus = exports.updatePart = exports.createPart = exports.deactivateSupplier = exports.activateSupplier = exports.updateSupplier = exports.createSupplier = exports.cancelCycleCount = exports.reconcileCycleCount = exports.submitCycleCount = exports.createCycleCount = exports.cancelTransferOrder = exports.receiveTransferOrder = exports.dispatchTransferOrder = exports.createTransferOrder = exports.listReceivingLocationOptions = exports.receiveInventoryStock = exports.deleteTruckCreatedInErrorCallable = exports.reactivateTruckCallable = exports.deactivateTruckCallable = exports.changeTruckHomeWarehouseCallable = exports.changeTruckStatusCallable = void 0;
// Cloud Functions entry point. Deliberately thin: no logic here, so
// every exported module stays independently testable.
const app_1 = require("firebase-admin/app");
(0, app_1.initializeApp)();
// --- Issue #15 surface: Work Order Engine v1.2 ---
var createWorkOrder_1 = require("./createWorkOrder");
Object.defineProperty(exports, "createWorkOrder", { enumerable: true, get: function () { return createWorkOrder_1.createWorkOrder; } });
var transitionWorkOrder_1 = require("./transitionWorkOrder");
Object.defineProperty(exports, "transitionWorkOrder", { enumerable: true, get: function () { return transitionWorkOrder_1.transitionWorkOrder; } });
var updateWorkOrderExecutionData_1 = require("./updateWorkOrderExecutionData");
Object.defineProperty(exports, "updateWorkOrderExecutionData", { enumerable: true, get: function () { return updateWorkOrderExecutionData_1.updateWorkOrderExecutionData; } });
var inventoryEffectCallables_1 = require("./inventoryEffectCallables");
Object.defineProperty(exports, "detectInventoryEffects", { enumerable: true, get: function () { return inventoryEffectCallables_1.detectInventoryEffects; } });
var inventoryAnalyticsCallables_1 = require("./inventoryAnalyticsCallables");
Object.defineProperty(exports, "getInventoryAnalytics", { enumerable: true, get: function () { return inventoryAnalyticsCallables_1.getInventoryAnalytics; } });
// WO Parts Planning Phase 2 -- the governed PLANNED producer. "export is not deployment": not deployed to
// the live project and no client calls it, and its capability (workOrder.parts.plan) is registered
// active:false (fail-closed for everyone) until a separate Owner deploy + grant gate.
var setWorkOrderPartsPlan_1 = require("./workOrderPartsPlan/setWorkOrderPartsPlan");
Object.defineProperty(exports, "setWorkOrderPartsPlan", { enumerable: true, get: function () { return setWorkOrderPartsPlan_1.setWorkOrderPartsPlan; } });
// Sales Opportunity governed write callables (Cycle 3). EXPORT != DEPLOY, REGISTER != GRANT: exported for
// build/test only; the `opportunity.write` capability is registered active:false (fail-closed) and nothing
// runs in production until a separate deploy + Owner grant.
var opportunityCallables_1 = require("./opportunity/opportunityCallables");
Object.defineProperty(exports, "createOpportunity", { enumerable: true, get: function () { return opportunityCallables_1.createOpportunity; } });
Object.defineProperty(exports, "transitionOpportunity", { enumerable: true, get: function () { return opportunityCallables_1.transitionOpportunity; } });
// Trusted minimal Opportunity READ projection (avoids client Rules widening). EXPORT != DEPLOY, capability
// `opportunity.read` registered active:false (REGISTER != GRANT).
var opportunityReadService_1 = require("./opportunity/opportunityReadService");
Object.defineProperty(exports, "listOpportunityContext", { enumerable: true, get: function () { return opportunityReadService_1.listOpportunityContext; } });
Object.defineProperty(exports, "listOpportunitiesForAccount", { enumerable: true, get: function () { return opportunityReadService_1.listOpportunitiesForAccount; } });
// P1.3 -- governed, human-invoked WON -> Create Sales Order action (decision #3: no Firestore trigger).
// EXPORT != DEPLOY; capability `opportunity.createSalesOrder` registered active:false (REGISTER != GRANT).
var createSalesOrderFromOpportunity_1 = require("./opportunity/createSalesOrderFromOpportunity");
Object.defineProperty(exports, "createSalesOrderFromOpportunity", { enumerable: true, get: function () { return createSalesOrderFromOpportunity_1.createSalesOrderFromOpportunity; } });
// Sales Order trusted read projection. EXPORT != DEPLOY; capability `salesOrder.read` registered
// active:false (REGISTER != GRANT). Owner-ratified 2026-08-15 (see permissionCatalog.ts's entry).
var salesOrderReadService_1 = require("./salesOrder/salesOrderReadService");
Object.defineProperty(exports, "getSalesOrderContext", { enumerable: true, get: function () { return salesOrderReadService_1.getSalesOrderContext; } });
Object.defineProperty(exports, "listSalesOrdersForAccount", { enumerable: true, get: function () { return salesOrderReadService_1.listSalesOrdersForAccount; } });
var manufacturerReadService_1 = require("./partMaster/manufacturerReadService");
Object.defineProperty(exports, "getManufacturerCatalog", { enumerable: true, get: function () { return manufacturerReadService_1.getManufacturerCatalog; } });
// Serialized Asset trusted Available-Equipment read (Spec phase M.1). EXPORT != DEPLOY; capability
// `inventory.serializedAsset.read` registered active:false (REGISTER != GRANT), granted to NO Role.
var serializedAssetReadService_1 = require("./serializedAsset/serializedAssetReadService");
Object.defineProperty(exports, "getAvailableEquipment", { enumerable: true, get: function () { return serializedAssetReadService_1.getAvailableEquipment; } });
// Coordinated Operations trusted read (fidelity fix, 2026-08-15) -- serves the existing coordinatedVisit/
// coordinatedFieldMission pure projections from real fieldops_wos data. EXPORT != DEPLOY; capability
// `fulfillment.coordinatedVisit.read` registered active:false (REGISTER != GRANT), granted to NO Role.
var coordinatedVisitReadService_1 = require("./fulfillment/coordinatedVisitReadService");
Object.defineProperty(exports, "listCoordinatedOperations", { enumerable: true, get: function () { return coordinatedVisitReadService_1.listCoordinatedOperations; } });
// Sales Order governed write callables (Cycle 4). EXPORT != DEPLOY; capability `salesOrder.write` registered
// active:false (REGISTER != GRANT).
var salesOrderCallables_1 = require("./salesOrder/salesOrderCallables");
Object.defineProperty(exports, "createSalesOrder", { enumerable: true, get: function () { return salesOrderCallables_1.createSalesOrder; } });
Object.defineProperty(exports, "transitionSalesOrder", { enumerable: true, get: function () { return salesOrderCallables_1.transitionSalesOrder; } });
// Fulfillment allocation (Cycle 5 live). EXPORT != DEPLOY; capability `salesOrder.fulfill` active:false.
var allocateSalesOrder_1 = require("./fulfillment/allocateSalesOrder");
Object.defineProperty(exports, "allocateSalesOrder", { enumerable: true, get: function () { return allocateSalesOrder_1.allocateSalesOrder; } });
// Sales Order → Service seam (Cycle 7). EXPORT != DEPLOY; capability `salesOrder.service` active:false.
var createServiceForSalesOrder_1 = require("./salesOrder/createServiceForSalesOrder");
Object.defineProperty(exports, "createServiceForSalesOrder", { enumerable: true, get: function () { return createServiceForSalesOrder_1.createServiceForSalesOrder; } });
// Finance (Billing/AR) — governed invoice issuance. EXPORT != DEPLOY; capability `finance.invoice.issue`
// active:false (ungranted); `invoices` is Admin-SDK-only (deny-all client Rules). Sensitive/audited.
var invoiceCallables_1 = require("./finance/invoiceCallables");
Object.defineProperty(exports, "issueInvoice", { enumerable: true, get: function () { return invoiceCallables_1.issueInvoice; } });
// Finance (Billing/AR) — governed payment application. EXPORT != DEPLOY; capability `finance.payment.apply`
// active:false; `payments`/`payment_applications` are Admin-SDK-only (deny-all client Rules). Sensitive/audited.
var paymentCallables_1 = require("./finance/paymentCallables");
Object.defineProperty(exports, "applyPayment", { enumerable: true, get: function () { return paymentCallables_1.applyPayment; } });
// Finance (Billing/AR) — governed invoice adjustments (credit/charge/write-off). EXPORT != DEPLOY; capability
// `finance.adjustment.record` active:false; `invoice_adjustments` is Admin-SDK-only (deny-all client Rules).
var adjustmentCallables_1 = require("./finance/adjustmentCallables");
Object.defineProperty(exports, "recordInvoiceAdjustment", { enumerable: true, get: function () { return adjustmentCallables_1.recordInvoiceAdjustment; } });
// Finance (Billing/AR) — trusted AR read projection. EXPORT != DEPLOY; capability `finance.read` active:false;
// backend read only (invoices stay Admin-SDK-only / deny-all client Rules).
var financeReadCallables_1 = require("./finance/financeReadCallables");
Object.defineProperty(exports, "listAccountInvoiceAr", { enumerable: true, get: function () { return financeReadCallables_1.listAccountInvoiceAr; } });
// Commercial Coverage & Territory (#15) — governed coverage writes. EXPORT != DEPLOY; capability
// `coverage.write` active:false; sales_territories / commercial_coverage_assignments are Admin-SDK-only.
var coverageCallables_1 = require("./coverage/coverageCallables");
Object.defineProperty(exports, "createSalesTerritory", { enumerable: true, get: function () { return coverageCallables_1.createSalesTerritory; } });
Object.defineProperty(exports, "createCoverageAssignment", { enumerable: true, get: function () { return coverageCallables_1.createCoverageAssignment; } });
// Commercial Coverage & Territory (#15) — trusted coverage resolve (read). EXPORT != DEPLOY; capability
// `coverage.read` active:false; backend read only (coverage collections stay Admin-SDK-only / deny-all).
var coverageReadCallables_1 = require("./coverage/coverageReadCallables");
Object.defineProperty(exports, "resolveCoverageForContext", { enumerable: true, get: function () { return coverageReadCallables_1.resolveCoverageForContext; } });
// Finance (Billing/AR) — governed refund. EXPORT != DEPLOY; capability `finance.refund.record` active:false;
// `refunds` is Admin-SDK-only (deny-all client Rules). Sensitive/audited.
var refundCallables_1 = require("./finance/refundCallables");
Object.defineProperty(exports, "recordRefund", { enumerable: true, get: function () { return refundCallables_1.recordRefund; } });
// --- F1 surface: trusted minimal field-context display projection ---
// Answers "who is the customer / which site am I going to?" for the CALLER'S
// OWN assigned Work Order. Not a customer-lookup API: the request carries
// workOrderId only, and every id read comes from the governed Work Order
// itself. No Firestore Rules change and no broad customer-read capability
// accompany it -- see docs/assessments/f1-technician-customer-identity.md.
var getWorkOrderFieldContext_1 = require("./getWorkOrderFieldContext");
Object.defineProperty(exports, "getWorkOrderFieldContext", { enumerable: true, get: function () { return getWorkOrderFieldContext_1.getWorkOrderFieldContext; } });
// --- F-RULES-1 surface: trusted technician job completion (Decision #39) ---
// Same "export is not deployment" posture as the surfaces below: not
// deployed to the live project, and no client calls it (Field Mode's
// integration is PR-B, a separate Owner gate) until Gate D1's Owner
// production authorization. Until then the legacy client completion path
// remains permitted by the interim Firestore Rules; the Rules that deny it
// land in PR-C and deploy at Gate D2, strictly after D1.
var completeAssignedJob_1 = require("./completeAssignedJob");
Object.defineProperty(exports, "completeAssignedJob", { enumerable: true, get: function () { return completeAssignedJob_1.completeAssignedJob; } });
// --- Issue #226 surface: Enterprise Access & Administration Platform ---
// Exactly these six -- see docs/deployment/enterprise-access-deployment-
// manifest.md Section B. Not deployed, and no client calls them, until a
// separate, later Owner production authorization (Implementation Plan
// Row 19+) is issued.
var accessCommandCallables_1 = require("./access/accessCommandCallables");
Object.defineProperty(exports, "grantRole", { enumerable: true, get: function () { return accessCommandCallables_1.grantRole; } });
Object.defineProperty(exports, "revokeRole", { enumerable: true, get: function () { return accessCommandCallables_1.revokeRole; } });
Object.defineProperty(exports, "assignApprovedRole", { enumerable: true, get: function () { return accessCommandCallables_1.assignApprovedRole; } });
Object.defineProperty(exports, "setUserStatus", { enumerable: true, get: function () { return accessCommandCallables_1.setUserStatus; } });
Object.defineProperty(exports, "approveAccessRequest", { enumerable: true, get: function () { return accessCommandCallables_1.approveAccessRequest; } });
Object.defineProperty(exports, "rejectAccessRequest", { enumerable: true, get: function () { return accessCommandCallables_1.rejectAccessRequest; } });
// --- Issue #325 / ADR-007 D-FN surface: trusted report execution ---
// Same "export is not deployment" posture as the six commands above:
// not deployed to the live project, and no client calls it (the client
// run seam, field-ops-app-vite/src/domain/reporting/
// reportExecutionSeam.js, is unchanged and still unconditionally
// unavailable) until a separate, later Owner production authorization.
// Additionally requires NO Role grant exists for any report.*
// capability (permissionCatalog.ts/compatibilityRoles.ts/
// governedBusinessRoles.ts, untouched) -- every real call denies today
// by construction of the access layer this depends on, independent of
// deployment/export status.
var runReportDefinitionCallable_1 = require("./reporting/runReportDefinitionCallable");
Object.defineProperty(exports, "runReportDefinitionCallable", { enumerable: true, get: function () { return runReportDefinitionCallable_1.runReportDefinitionCallable; } });
// --- Issue #325 / ADR-007 D-RULES CORRECTED surface: trusted saved-
// definition CRUD ---
// Same "export is not deployment" posture as the surfaces above: not
// deployed to the live project, and no client calls these (Customer
// persistence integration is explicitly out of scope for this task)
// until a separate, later Owner production authorization. firestore.
// rules denies ALL direct client read/write on reportDefinitions
// unconditionally -- these six callables are now the ONLY path to that
// collection. A saved definition confers no report-data access;
// executing a saved definition's query still reauthorizes independently
// through the D-FN surface above.
var savedDefinitionCallables_1 = require("./reporting/savedDefinitionCallables");
Object.defineProperty(exports, "createSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.createSavedDefinitionCallable; } });
Object.defineProperty(exports, "getSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.getSavedDefinitionCallable; } });
Object.defineProperty(exports, "listSavedDefinitionsCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.listSavedDefinitionsCallable; } });
Object.defineProperty(exports, "renameSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.renameSavedDefinitionCallable; } });
Object.defineProperty(exports, "duplicateSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.duplicateSavedDefinitionCallable; } });
Object.defineProperty(exports, "deleteSavedDefinitionCallable", { enumerable: true, get: function () { return savedDefinitionCallables_1.deleteSavedDefinitionCallable; } });
// --- Issue #226 surface: trusted effective-access feed ---
// Same "export is not deployment" posture as the surfaces above: not
// deployed to the live project, and no client calls it (Customer's own
// W1 UI integration is a separate, later, explicitly out-of-scope step
// for this PR) until a separate, later Owner production authorization.
// Read-only, mutates nothing, writes no Audit Event -- see
// effectiveAccessFeed.ts's own header for why this surface doesn't
// audit (unlike the mutating commands above or the row-reading report
// execution service).
var effectiveAccessFeedCallable_1 = require("./access/effectiveAccessFeedCallable");
Object.defineProperty(exports, "resolveEffectiveAccessCallable", { enumerable: true, get: function () { return effectiveAccessFeedCallable_1.resolveEffectiveAccessCallable; } });
// --- AUTH-PR-3 surface: admin-initiated password reset (Authentication
// Modernization; extends Issue #226) ---
// Same "export is not deployment" posture as every surface above: NOT deployed
// to the live project, NO Admin UI wired to call them, and NO email provider
// configured (adminCredentialCallables wires NOT_CONFIGURED_DELIVERY) until a
// SEPARATE, later Owner production authorization. As deployed today the command
// FAILS CLOSED on the unconfigured delivery capability -- ZERO Auth side effects
// (no reset-link generation, no email, no session revocation).
var adminCredentialCallables_1 = require("./access/adminCredentialCallables");
Object.defineProperty(exports, "initiateAdminPasswordReset", { enumerable: true, get: function () { return adminCredentialCallables_1.initiateAdminPasswordReset; } });
Object.defineProperty(exports, "listResetEligibleUsers", { enumerable: true, get: function () { return adminCredentialCallables_1.listResetEligibleUsers; } });
// --- EI Truck Registry surface (ADR-010 / Decision #60): trusted write callables ---
// Same "export is not deployment" posture as every surface above: NOT deployed to the live
// project, NO Admin UI wired to call them, NO App Check requirement (matching every other
// callable here), and the governed inventory predicate does NOT exist yet -- so
// deactivateTruck FAILS CLOSED (INVENTORY_STATE_UNKNOWN) until a separate, later gate injects a
// real predicate. Authorization is admin/dispatcher (users/{uid}.role), enforced in the service.
var truckRegistryCallables_1 = require("./truckRegistry/truckRegistryCallables");
Object.defineProperty(exports, "createTruckCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.createTruckCallable; } });
Object.defineProperty(exports, "assignTruckDriverCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.assignTruckDriverCallable; } });
Object.defineProperty(exports, "reassignTruckDriverCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.reassignTruckDriverCallable; } });
Object.defineProperty(exports, "unassignTruckDriverCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.unassignTruckDriverCallable; } });
Object.defineProperty(exports, "changeTruckStatusCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.changeTruckStatusCallable; } });
Object.defineProperty(exports, "changeTruckHomeWarehouseCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.changeTruckHomeWarehouseCallable; } });
Object.defineProperty(exports, "deactivateTruckCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.deactivateTruckCallable; } });
Object.defineProperty(exports, "reactivateTruckCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.reactivateTruckCallable; } });
Object.defineProperty(exports, "deleteTruckCreatedInErrorCallable", { enumerable: true, get: function () { return truckRegistryCallables_1.deleteTruckCreatedInErrorCallable; } });
// --- EI Phase-2 Receiving surface (E1): trusted Receiving callables ---
// "Export is not deployment/grant": NOT deployed to the live project, NO Admin/Customer UI wired to
// call them, NO App Check requirement (matching every other callable here). Both require the governed
// inventory.stock.receive capability, which is REGISTERED BUT UNGRANTED -- so every real user is denied
// until a separate grant gate. The receive callable runs the pinned §3A ACTIVE-warehouse resolver; the
// option callable serves sanitized eligible options from the trusted backend (no client warehouses read).
// Firebase deploys each callable under its exported index property name, so these MUST be the exact
// frozen public names (no "Callable" suffix). The suffixed implementation consts are aliased here and are
// NOT otherwise exposed as callable surfaces.
var receivingCallables_1 = require("./inventoryReceiving/receivingCallables");
Object.defineProperty(exports, "receiveInventoryStock", { enumerable: true, get: function () { return receivingCallables_1.receiveInventoryStockCallable; } });
Object.defineProperty(exports, "listReceivingLocationOptions", { enumerable: true, get: function () { return receivingCallables_1.listReceivingLocationOptionsCallable; } });
// --- Enterprise Inventory Phase 4 -- Transfer operating authority (functions/src/inventoryTransfer/*) ---
// Every inventory.transfer.* capability is registered `active: false` and granted to NO Role, so every
// principal is denied `noQualifyingGrant` until a later, separately-authorized grant + activation gate.
// Exporting a callable is not deployment authorization by itself -- see receiveInventoryStock above.
var transferCallables_1 = require("./inventoryTransfer/transferCallables");
Object.defineProperty(exports, "createTransferOrder", { enumerable: true, get: function () { return transferCallables_1.createTransferOrderCallable; } });
Object.defineProperty(exports, "dispatchTransferOrder", { enumerable: true, get: function () { return transferCallables_1.dispatchTransferOrderCallable; } });
Object.defineProperty(exports, "receiveTransferOrder", { enumerable: true, get: function () { return transferCallables_1.receiveTransferOrderCallable; } });
Object.defineProperty(exports, "cancelTransferOrder", { enumerable: true, get: function () { return transferCallables_1.cancelTransferOrderCallable; } });
// --- Enterprise Inventory -- Cycle Count operating authority (functions/src/cycleCount/*) ---
// Every inventory.cycleCount.* capability is registered `active: false` and granted to NO Role, so every
// principal is denied `noQualifyingGrant` until a later, separately-authorized grant + activation gate.
// Exporting a callable is not deployment authorization by itself -- see receiveInventoryStock above.
var cycleCountCallables_1 = require("./cycleCount/cycleCountCallables");
Object.defineProperty(exports, "createCycleCount", { enumerable: true, get: function () { return cycleCountCallables_1.createCycleCountCallable; } });
Object.defineProperty(exports, "submitCycleCount", { enumerable: true, get: function () { return cycleCountCallables_1.submitCycleCountCallable; } });
Object.defineProperty(exports, "reconcileCycleCount", { enumerable: true, get: function () { return cycleCountCallables_1.reconcileCycleCountCallable; } });
Object.defineProperty(exports, "cancelCycleCount", { enumerable: true, get: function () { return cycleCountCallables_1.cancelCycleCountCallable; } });
// --- Supplier Master (DECISIONS #78): trusted Supplier command callables ---
// "Export is not deployment/grant": NOT deployed to the live project, NO UI wired to call them, NO App
// Check requirement (matching every other callable here). Authorization is enforced INSIDE the command
// against the actor's real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for activate/deactivate. NO capability is granted here; activate/deactivate
// currently fail closed because no STANDING role carries inventory.catalog.activate (a deferred protected
// grant -- see docs/releases/supplier-master-rc-1.md). Firebase deploys each callable under its exported
// index property name, so these MUST be the exact frozen public names (no "Callable" suffix); the
// suffixed implementation consts are aliased here and are NOT otherwise exposed.
var supplierMasterCallables_1 = require("./supplierMaster/supplierMasterCallables");
Object.defineProperty(exports, "createSupplier", { enumerable: true, get: function () { return supplierMasterCallables_1.createSupplierCallable; } });
Object.defineProperty(exports, "updateSupplier", { enumerable: true, get: function () { return supplierMasterCallables_1.updateSupplierCallable; } });
Object.defineProperty(exports, "activateSupplier", { enumerable: true, get: function () { return supplierMasterCallables_1.activateSupplierCallable; } });
Object.defineProperty(exports, "deactivateSupplier", { enumerable: true, get: function () { return supplierMasterCallables_1.deactivateSupplierCallable; } });
// --- Part Master (ADR-009 G2): trusted Part command callables ---
// "Export is not deployment/grant": NOT deployed to the live project, NO UI wired to call them yet, NO
// App Check requirement (matching every other callable here). Authorization is enforced INSIDE the
// command against the actor's real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for changePartStatus (the accepted catalog authority / future durable
// inventoryCatalogAdministrator role). NO capability is granted here; catalog capabilities are carried
// by no standing role, so create/update/status fail closed until a deferred protected grant. Firebase
// deploys each callable under its exported index property name, so these MUST be the exact frozen
// public names (no "Callable" suffix); the suffixed impl consts are aliased here and NOT otherwise exposed.
var partMasterCallables_1 = require("./partMaster/partMasterCallables");
Object.defineProperty(exports, "createPart", { enumerable: true, get: function () { return partMasterCallables_1.createPartCallable; } });
Object.defineProperty(exports, "updatePart", { enumerable: true, get: function () { return partMasterCallables_1.updatePartCallable; } });
Object.defineProperty(exports, "changePartStatus", { enumerable: true, get: function () { return partMasterCallables_1.changePartStatusCallable; } });
// --- Manufacturer (catalog reference object): trusted Manufacturer command callables ---
// "Export is not deployment/grant": NOT deployed, NO UI wired yet, NO App Check. Authorization enforced
// INSIDE the command against real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for status (the SAME catalog authority Part/Supplier use; future durable
// inventoryCatalogAdministrator). NO capability granted here; catalog capabilities are carried by no
// standing role, so all three fail closed until a deferred protected grant. Closes the referential gap
// Part write created (parts.manufacturerId -> a currently-unmanageable entity). Firebase deploys each
// callable under its exported index property name -> frozen public names (no "Callable" suffix); the
// suffixed impl consts are aliased here and NOT otherwise exposed.
var manufacturerCallables_1 = require("./partMaster/manufacturerCallables");
Object.defineProperty(exports, "createManufacturer", { enumerable: true, get: function () { return manufacturerCallables_1.createManufacturerCallable; } });
Object.defineProperty(exports, "updateManufacturer", { enumerable: true, get: function () { return manufacturerCallables_1.updateManufacturerCallable; } });
Object.defineProperty(exports, "changeManufacturerStatus", { enumerable: true, get: function () { return manufacturerCallables_1.changeManufacturerStatusCallable; } });
// --- Part↔Supplier procurement terms (part_supplier_items): trusted command callables ---
// "Export is not deployment/grant": NOT deployed, NO UI wired yet, NO capability granted, NO App Check.
// Authorization enforced INSIDE the command against real governed roles -- inventory.catalog.manage for
// create/update/setPreferred, inventory.catalog.activate for status (the SAME catalog authority the rest of
// the catalog uses). All four fail closed until a deferred protected grant. Closes the procure-to-stock
// gap (governed preferred-supplier + terms instead of free-form). The part_supplier_items READ stays served
// by governed projections gated on R-1's inventory.catalog.read / .cost.read (partSupplierItemProjections.ts
// is the pure contract; the read service is NOT activated here). Firebase deploys each callable under its
// exported index property name -> frozen public names (no "Callable" suffix); suffixed impl consts aliased.
var partSupplierItemCallables_1 = require("./partMaster/partSupplierItemCallables");
Object.defineProperty(exports, "createPartSupplierItem", { enumerable: true, get: function () { return partSupplierItemCallables_1.createPartSupplierItemCallable; } });
Object.defineProperty(exports, "updatePartSupplierItem", { enumerable: true, get: function () { return partSupplierItemCallables_1.updatePartSupplierItemCallable; } });
Object.defineProperty(exports, "changePartSupplierItemStatus", { enumerable: true, get: function () { return partSupplierItemCallables_1.changePartSupplierItemStatusCallable; } });
Object.defineProperty(exports, "setPreferredSupplier", { enumerable: true, get: function () { return partSupplierItemCallables_1.setPreferredSupplierCallable; } });
// CRM Activity / Notes (Taylor EOS Wave 7 extension, PART 1.4). EXPORT != DEPLOY, REGISTER != GRANT:
// exported for build/test only; `crm.activity.create` / `crm.activity.read` are both registered
// active:false and granted to NO Role -- nothing runs in production until a separate deploy + Owner
// grant + per-environment activation. `crm_activities` is Admin-SDK-only (no firestore.rules match block,
// default deny); these two trusted callables are the only read/write path.
var crmActivityCallables_1 = require("./crmActivity/crmActivityCallables");
Object.defineProperty(exports, "createCrmActivity", { enumerable: true, get: function () { return crmActivityCallables_1.createCrmActivity; } });
var crmActivityReadService_1 = require("./crmActivity/crmActivityReadService");
Object.defineProperty(exports, "getCrmActivities", { enumerable: true, get: function () { return crmActivityReadService_1.getCrmActivities; } });
//# sourceMappingURL=index.js.map