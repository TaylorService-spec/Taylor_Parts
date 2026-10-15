"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCoverageAssignment = exports.createSalesTerritory = exports.listFinancialFacts = exports.listAccountInvoiceAr = exports.recordInvoiceAdjustment = exports.applyPayment = exports.issueInvoice = exports.createServiceForSalesOrder = exports.allocateSalesOrder = exports.transitionSalesOrder = exports.createSalesOrder = exports.getLocationDisplay = exports.listCoordinatedOperations = exports.getAvailableEquipment = exports.getManufacturerCatalog = exports.searchProductReferences = exports.getSalesAgreementForOpportunity = exports.getSalesAgreementContext = exports.acceptSalesAgreement = exports.updateSalesAgreementDraft = exports.createSalesAgreement = exports.listSalesOrderIndex = exports.listSalesOrdersForAccount = exports.getSalesOrderContext = exports.closeOpportunityAsWon = exports.createSalesOrderFromOpportunity = exports.getOpportunityContext = exports.listOpportunitiesForAccount = exports.listOpportunityContext = exports.listReorderWarehouseOptions = exports.recordReorderPurchaseOrder = exports.createReorderRequest = exports.updateOpportunity = exports.transitionOpportunity = exports.createOpportunity = exports.readTechnicianAvailabilityCallable = exports.deleteTechnicianBlockedTimeCallable = exports.createTechnicianBlockedTimeCallable = exports.setTechnicianWorkingAvailabilityCallable = exports.setWorkOrderEstimatedDurationCallable = exports.reassignScheduledWorkOrderCallable = exports.rescheduleWorkOrderCallable = exports.setWorkOrderPartsPlan = exports.getAccountPortfolioSummary = exports.getInventoryAnalytics = exports.detectInventoryEffects = exports.listWorkOrderConsumptionSources = exports.updateWorkOrderExecutionData = exports.transitionWorkOrder = exports.createWorkOrder = void 0;
exports.reconcileCycleCountLine = exports.submitCycleCountLine = exports.openCycleCountLine = exports.createCycleCountSheet = exports.listMyReceivableTransfers = exports.cancelTransferOrder = exports.receiveTransferOrder = exports.dispatchTransferOrder = exports.createTransferOrder = exports.listReceivingLocationOptions = exports.listReceivablePurchaseOrders = exports.getPurchaseOrderReceivingProgress = exports.receiveInventoryStock = exports.deleteTruckCreatedInErrorCallable = exports.reactivateTruckCallable = exports.deactivateTruckCallable = exports.changeTruckHomeWarehouseCallable = exports.changeTruckStatusCallable = exports.unassignTruckDriverCallable = exports.reassignTruckDriverCallable = exports.assignTruckDriverCallable = exports.createTruckCallable = exports.listRecordChangeHistory = exports.updateEmployeeProfile = exports.listResetEligibleUsers = exports.initiateAdminPasswordReset = exports.resolveEffectiveAccessCallable = exports.deleteSavedDefinitionCallable = exports.duplicateSavedDefinitionCallable = exports.renameSavedDefinitionCallable = exports.listSavedDefinitionsCallable = exports.getSavedDefinitionCallable = exports.createSavedDefinitionCallable = exports.runReportDefinitionCallable = exports.rejectAccessRequest = exports.approveAccessRequest = exports.setUserStatus = exports.readPrincipalAccessState = exports.listPrivilegedRoleRequests = exports.decidePrivilegedRoleRequest = exports.requestPrivilegedRole = exports.assignApprovedRole = exports.revokeRole = exports.grantRole = exports.completeAssignedJob = exports.interpretWorkOrderReadinessContext = exports.getWorkOrderReadinessContext = exports.getWorkOrderFieldContext = exports.recordRefund = exports.resolveCoverageForContext = void 0;
exports.getCrmActivities = exports.createCrmActivity = exports.setPreferredSupplier = exports.changePartSupplierItemStatus = exports.updatePartSupplierItem = exports.createPartSupplierItem = exports.getPartBalances = exports.getPartBalance = exports.listStockMovementLocations = exports.relocateStock = exports.recordPutAway = exports.listBins = exports.previewBinCreates = exports.resolveBinToken = exports.resolveBin = exports.reactivateBin = exports.deactivateBin = exports.renameBin = exports.createBin = exports.getWorkOrderLabor = exports.correctWorkOrderLabor = exports.recordWorkOrderLabor = exports.recordWorkOrderEquipmentInstall = exports.getInstallableEquipmentForWorkOrder = exports.acquireSerializedAsset = exports.installSerializedAsset = exports.recordReturnIntake = exports.lookupScannedPart = exports.resolveScannedPartIdentifier = exports.probePartAlias = exports.listPartAliases = exports.reactivatePartAlias = exports.deactivatePartAlias = exports.createPartAlias = exports.changeManufacturerStatus = exports.updateManufacturer = exports.createManufacturer = exports.changePartStatus = exports.updatePart = exports.createPart = exports.deactivateSupplier = exports.activateSupplier = exports.updateSupplier = exports.createSupplier = exports.getCycleCountAssignedMobileLocation = exports.getCycleCountSheet = exports.listCycleCountSheets = exports.closeCycleCountSheet = exports.cancelCycleCountSheet = exports.cancelCycleCountLine = void 0;
exports.pollEmailMailboxes = exports.getInboundWorkAttachment = exports.retryEmailDelivery = exports.pollEmailMailboxNow = exports.getEmailProviderReadiness = exports.disconnectEmailConnection = exports.testEmailConnection = exports.completeEmailConnectionAuthorization = exports.startEmailConnectionAuthorization = exports.deliverInboundEmailMessage = exports.saveEmailRoutingRule = exports.saveEmailMailbox = exports.saveEmailConnection = exports.getEmailIntakeConfiguration = exports.attachInboundWorkToWorkOrder = exports.declineInboundWork = exports.acceptInboundWork = exports.getInboundWorkRequest = exports.listInboundWork = exports.listImportedServiceHistory = exports.listDataImportJobs = exports.executeDataImport = exports.stageDataImport = exports.listGoalSubjects = exports.listPerformanceGoalVersions = exports.listCurrentPerformanceGoals = exports.retirePerformanceGoal = exports.approvePerformanceGoal = exports.createPerformanceGoalDraft = void 0;
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
// Decision #171 -- the ONE narrow trusted read that makes consumption source selection possible
// without granting technicians any standing inventory or location read.
var consumptionSourceCallables_1 = require("./workOrderConsumption/consumptionSourceCallables");
Object.defineProperty(exports, "listWorkOrderConsumptionSources", { enumerable: true, get: function () { return consumptionSourceCallables_1.listWorkOrderConsumptionSources; } });
var inventoryEffectCallables_1 = require("./inventoryEffectCallables");
Object.defineProperty(exports, "detectInventoryEffects", { enumerable: true, get: function () { return inventoryEffectCallables_1.detectInventoryEffects; } });
var inventoryAnalyticsCallables_1 = require("./inventoryAnalyticsCallables");
Object.defineProperty(exports, "getInventoryAnalytics", { enumerable: true, get: function () { return inventoryAnalyticsCallables_1.getInventoryAnalytics; } });
var accountPortfolioSummary_1 = require("./account/accountPortfolioSummary");
Object.defineProperty(exports, "getAccountPortfolioSummary", { enumerable: true, get: function () { return accountPortfolioSummary_1.getAccountPortfolioSummary; } });
// WO Parts Planning Phase 2 -- the governed PLANNED producer. Deployed to eos-platform-sandbox under the
// per-environment activation program; NOT deployed to the production project. No client calls it, and its
// capability (workOrder.parts.plan) is registered active:false (fail-closed for everyone) until a separate
// Owner grant gate.
var setWorkOrderPartsPlan_1 = require("./workOrderPartsPlan/setWorkOrderPartsPlan");
Object.defineProperty(exports, "setWorkOrderPartsPlan", { enumerable: true, get: function () { return setWorkOrderPartsPlan_1.setWorkOrderPartsPlan; } });
// Dispatch & Scheduler -- the governed Scheduling domain (ND-18 through ND-22, Owner ruling
// 2026-08-27). EXPORT IS NOT DEPLOY: these are exported for build and test only. Nothing in the
// client calls them yet, the North Star Dispatch composition that will is a separate step, and
// deploying them to any project is its own authorized action.
//
// Un-scheduling is NOT here -- it is a lifecycle transition and ships as transitionWorkOrder's
// "Unschedule" action (ND-18). Re-timing and reassignment are plan changes and ship here (ND-19).
var schedulingCallables_1 = require("./scheduling/schedulingCallables");
Object.defineProperty(exports, "rescheduleWorkOrderCallable", { enumerable: true, get: function () { return schedulingCallables_1.rescheduleWorkOrderCallable; } });
Object.defineProperty(exports, "reassignScheduledWorkOrderCallable", { enumerable: true, get: function () { return schedulingCallables_1.reassignScheduledWorkOrderCallable; } });
Object.defineProperty(exports, "setWorkOrderEstimatedDurationCallable", { enumerable: true, get: function () { return schedulingCallables_1.setWorkOrderEstimatedDurationCallable; } });
Object.defineProperty(exports, "setTechnicianWorkingAvailabilityCallable", { enumerable: true, get: function () { return schedulingCallables_1.setTechnicianWorkingAvailabilityCallable; } });
Object.defineProperty(exports, "createTechnicianBlockedTimeCallable", { enumerable: true, get: function () { return schedulingCallables_1.createTechnicianBlockedTimeCallable; } });
Object.defineProperty(exports, "deleteTechnicianBlockedTimeCallable", { enumerable: true, get: function () { return schedulingCallables_1.deleteTechnicianBlockedTimeCallable; } });
Object.defineProperty(exports, "readTechnicianAvailabilityCallable", { enumerable: true, get: function () { return schedulingCallables_1.readTechnicianAvailabilityCallable; } });
// Sales Opportunity governed write callables (Cycle 3). EXPORT != DEPLOY, REGISTER != GRANT: exported for
// build/test only; the `opportunity.write` capability is registered active:false (fail-closed) and nothing
// runs in production until a separate deploy + Owner grant.
var opportunityCallables_1 = require("./opportunity/opportunityCallables");
Object.defineProperty(exports, "createOpportunity", { enumerable: true, get: function () { return opportunityCallables_1.createOpportunity; } });
Object.defineProperty(exports, "transitionOpportunity", { enumerable: true, get: function () { return opportunityCallables_1.transitionOpportunity; } });
Object.defineProperty(exports, "updateOpportunity", { enumerable: true, get: function () { return opportunityCallables_1.updateOpportunity; } });
// Workstream 2B -- the two reorder writes that author a governed company fact. EXPORT != DEPLOY:
// these are exported for build and test, and deployment is NOT authorized. They are half of a
// three-part activation (Functions + Rules + Hosting) that must land together, because the Rules
// retirement below removes the client-direct path these replace.
var reorderCallables_1 = require("./reorderRequest/reorderCallables");
Object.defineProperty(exports, "createReorderRequest", { enumerable: true, get: function () { return reorderCallables_1.createReorderRequest; } });
Object.defineProperty(exports, "recordReorderPurchaseOrder", { enumerable: true, get: function () { return reorderCallables_1.recordReorderPurchaseOrder; } });
// R-17. The trusted warehouse projection the reorder picker reads, INSTEAD of a `warehouses`
// collection LIST. Same capability as the create it serves; no warehouse.list capability exists.
Object.defineProperty(exports, "listReorderWarehouseOptions", { enumerable: true, get: function () { return reorderCallables_1.listReorderWarehouseOptions; } });
// Trusted minimal Opportunity READ projection (avoids client Rules widening). EXPORT != DEPLOY, capability
// `opportunity.read` registered active:false (REGISTER != GRANT).
var opportunityReadService_1 = require("./opportunity/opportunityReadService");
Object.defineProperty(exports, "listOpportunityContext", { enumerable: true, get: function () { return opportunityReadService_1.listOpportunityContext; } });
Object.defineProperty(exports, "listOpportunitiesForAccount", { enumerable: true, get: function () { return opportunityReadService_1.listOpportunitiesForAccount; } });
// The PER-ID Opportunity read (North Star family 4). Same governed capability as the two list reads
// above -- `opportunity.read` -- because the authorization question is identical and only the query
// shape differs; no Rules change, no new capability. It is what gives an Opportunity a URL.
// EXPORT != DEPLOY.
var opportunityReadService_2 = require("./opportunity/opportunityReadService");
Object.defineProperty(exports, "getOpportunityContext", { enumerable: true, get: function () { return opportunityReadService_2.getOpportunityContext; } });
// P1.3 -- governed, human-invoked WON -> Create Sales Order action (decision #3: no Firestore trigger).
// EXPORT != DEPLOY; capability `opportunity.createSalesOrder` registered active:false (REGISTER != GRANT).
var createSalesOrderFromOpportunity_1 = require("./opportunity/createSalesOrderFromOpportunity");
Object.defineProperty(exports, "createSalesOrderFromOpportunity", { enumerable: true, get: function () { return createSalesOrderFromOpportunity_1.createSalesOrderFromOpportunity; } });
// The ATOMIC Won action. Closes the Opportunity as WON and creates its Sales Order in ONE
// transaction, so a Won Opportunity can never exist without its order. EXPORT != DEPLOY.
var closeOpportunityAsWon_1 = require("./opportunity/closeOpportunityAsWon");
Object.defineProperty(exports, "closeOpportunityAsWon", { enumerable: true, get: function () { return closeOpportunityAsWon_1.closeOpportunityAsWon; } });
// Sales Order trusted read projection. EXPORT != DEPLOY; capability `salesOrder.read` registered
// active:false (REGISTER != GRANT). Owner-ratified 2026-08-15 (see permissionCatalog.ts's entry).
var salesOrderReadService_1 = require("./salesOrder/salesOrderReadService");
Object.defineProperty(exports, "getSalesOrderContext", { enumerable: true, get: function () { return salesOrderReadService_1.getSalesOrderContext; } });
Object.defineProperty(exports, "listSalesOrdersForAccount", { enumerable: true, get: function () { return salesOrderReadService_1.listSalesOrdersForAccount; } });
Object.defineProperty(exports, "listSalesOrderIndex", { enumerable: true, get: function () { return salesOrderReadService_1.listSalesOrderIndex; } });
// Sales Agreement (Slice 4) -- the commercial commitment. Three write verbs and two reads; no
// generic update, and nothing that can amend an ACCEPTED agreement. EXPORT != DEPLOY: these are
// registered active:false and deny for everyone until a separate grant + per-environment activation.
var salesAgreementCallables_1 = require("./salesAgreement/salesAgreementCallables");
Object.defineProperty(exports, "createSalesAgreement", { enumerable: true, get: function () { return salesAgreementCallables_1.createSalesAgreement; } });
Object.defineProperty(exports, "updateSalesAgreementDraft", { enumerable: true, get: function () { return salesAgreementCallables_1.updateSalesAgreementDraft; } });
Object.defineProperty(exports, "acceptSalesAgreement", { enumerable: true, get: function () { return salesAgreementCallables_1.acceptSalesAgreement; } });
var salesAgreementReadService_1 = require("./salesAgreement/salesAgreementReadService");
Object.defineProperty(exports, "getSalesAgreementContext", { enumerable: true, get: function () { return salesAgreementReadService_1.getSalesAgreementContext; } });
Object.defineProperty(exports, "getSalesAgreementForOpportunity", { enumerable: true, get: function () { return salesAgreementReadService_1.getSalesAgreementForOpportunity; } });
// The product picker read. Serves BOTH the Part typeahead and the Equipment Model picker, behind
// the existing inventory.catalog.read authority -- no new capability, no widened Firestore Rules.
var productReferenceSearchService_1 = require("./salesAgreement/productReferenceSearchService");
Object.defineProperty(exports, "searchProductReferences", { enumerable: true, get: function () { return productReferenceSearchService_1.searchProductReferences; } });
var manufacturerReadService_1 = require("./partMaster/manufacturerReadService");
Object.defineProperty(exports, "getManufacturerCatalog", { enumerable: true, get: function () { return manufacturerReadService_1.getManufacturerCatalog; } });
// Serialized Asset trusted Available-Equipment read (Spec phase M.1). EXPORT != DEPLOY; capability
// `inventory.serializedAsset.read` registered active:false (REGISTER != GRANT). Measured 2026-09-12:
// held by thirteen governed Roles and ACTIVATED in platform-sandbox; production neither activates nor grants it.
var serializedAssetReadService_1 = require("./serializedAsset/serializedAssetReadService");
Object.defineProperty(exports, "getAvailableEquipment", { enumerable: true, get: function () { return serializedAssetReadService_1.getAvailableEquipment; } });
// Coordinated Operations trusted read (fidelity fix, 2026-08-15) -- serves the existing coordinatedVisit/
// coordinatedFieldMission pure projections from real fieldops_wos data. EXPORT != DEPLOY; capability
// `fulfillment.coordinatedVisit.read` registered active:false (REGISTER != GRANT). Measured 2026-09-12:
// held by dispatcher/fieldManager/operationsManager and ACTIVATED in platform-sandbox; production neither.
var coordinatedVisitReadService_1 = require("./fulfillment/coordinatedVisitReadService");
Object.defineProperty(exports, "listCoordinatedOperations", { enumerable: true, get: function () { return coordinatedVisitReadService_1.listCoordinatedOperations; } });
// Location-DISPLAY trusted resolver (sandbox-fidelity package PART 11A) -- id -> { type, label } for
// WAREHOUSE/MOBILE only, backing Available Equipment's location column. EXPORT != DEPLOY; capability
// `inventory.location.display.read` registered active:false (REGISTER != GRANT). Measured 2026-09-12:
// held by inventoryLookupReader and ACTIVATED in platform-sandbox; production neither activates nor grants it.
var locationDisplayReadService_1 = require("./inventoryLocation/locationDisplayReadService");
Object.defineProperty(exports, "getLocationDisplay", { enumerable: true, get: function () { return locationDisplayReadService_1.getLocationDisplay; } });
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
// active:false and ACTIVATED in platform-sandbox (granted to five governed Roles; production neither);
// `invoices` is Admin-SDK-only (deny-all client Rules). Sensitive/audited.
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
var financialReportingRead_1 = require("./finance/financialReportingRead");
Object.defineProperty(exports, "listFinancialFacts", { enumerable: true, get: function () { return financialReportingRead_1.listFinancialFacts; } });
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
// --- North Star Work Order readiness context ---
// Trusted READ-ONLY assembler for #1492. Request carries workOrderId only; every inventory/procurement
// join key is derived from the authorized Work Order server-side. EXPORT != DEPLOY and the client stays
// fail-closed behind WORK_ORDER_READINESS_CONTEXT_READY until a separately authorized sandbox release.
var workOrderReadinessContext_1 = require("./ai/workOrderReadinessContext");
Object.defineProperty(exports, "getWorkOrderReadinessContext", { enumerable: true, get: function () { return workOrderReadinessContext_1.getWorkOrderReadinessContext; } });
// Private-AI interpretation of that same readiness context. EXPORT != DEPLOY, and here the export is
// unusually far from a grant: the callable refuses in every environment the registry declares, which
// is currently all of them, and the only environment classified as synthetic (demo-certworld) is an
// emulator project that cannot be deployed to. It also cannot write, cannot dispatch a command, and
// cannot recommend an action -- the verifier rejects any action the model names.
var workOrderReadinessContext_2 = require("./ai/workOrderReadinessContext");
Object.defineProperty(exports, "interpretWorkOrderReadinessContext", { enumerable: true, get: function () { return workOrderReadinessContext_2.interpretWorkOrderReadinessContext; } });
// --- F-RULES-1 surface: trusted technician job completion (Decision #39) ---
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. No client calls it (Field Mode's integration is PR-B, a separate Owner gate) until
// Gate D1's Owner production authorization. Until then the legacy client completion path remains
// permitted by the interim Firestore Rules; the Rules that deny it land in PR-C and deploy at Gate D2,
// strictly after D1.
var completeAssignedJob_1 = require("./completeAssignedJob");
Object.defineProperty(exports, "completeAssignedJob", { enumerable: true, get: function () { return completeAssignedJob_1.completeAssignedJob; } });
// --- Issue #226 surface: Enterprise Access & Administration Platform ---
// See docs/deployment/enterprise-access-deployment-manifest.md Section B. Deployed to
// eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project.
//
// readPrincipalAccessState (Owner ruling 2026-09-06 §4) is the READ half of this surface and the
// newest member: the write commands here have been deployed for months while Administration >
// Users had no governed way to see the state they change, which left "Account Status: Not
// available" on the record page and made revokeRole uncallable for want of an assignmentId.
var accessCommandCallables_1 = require("./access/accessCommandCallables");
Object.defineProperty(exports, "grantRole", { enumerable: true, get: function () { return accessCommandCallables_1.grantRole; } });
Object.defineProperty(exports, "revokeRole", { enumerable: true, get: function () { return accessCommandCallables_1.revokeRole; } });
Object.defineProperty(exports, "assignApprovedRole", { enumerable: true, get: function () { return accessCommandCallables_1.assignApprovedRole; } });
Object.defineProperty(exports, "requestPrivilegedRole", { enumerable: true, get: function () { return accessCommandCallables_1.requestPrivilegedRole; } });
Object.defineProperty(exports, "decidePrivilegedRoleRequest", { enumerable: true, get: function () { return accessCommandCallables_1.decidePrivilegedRoleRequest; } });
Object.defineProperty(exports, "listPrivilegedRoleRequests", { enumerable: true, get: function () { return accessCommandCallables_1.listPrivilegedRoleRequests; } });
Object.defineProperty(exports, "readPrincipalAccessState", { enumerable: true, get: function () { return accessCommandCallables_1.readPrincipalAccessState; } });
Object.defineProperty(exports, "setUserStatus", { enumerable: true, get: function () { return accessCommandCallables_1.setUserStatus; } });
Object.defineProperty(exports, "approveAccessRequest", { enumerable: true, get: function () { return accessCommandCallables_1.approveAccessRequest; } });
Object.defineProperty(exports, "rejectAccessRequest", { enumerable: true, get: function () { return accessCommandCallables_1.rejectAccessRequest; } });
// --- Issue #325 / ADR-007 D-FN surface: trusted report execution ---
// Same posture as the six commands above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. No client calls it (the client
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
// Same posture as the surfaces above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. No client calls these (Customer
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
// Same posture as the surfaces above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. No client calls it (Customer's own
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
// Same posture as every surface above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. NO Admin UI wired to call them, and NO
// email provider configured (adminCredentialCallables wires NOT_CONFIGURED_DELIVERY) until a
// SEPARATE, later Owner production authorization. As deployed today the command
// FAILS CLOSED on the unconfigured delivery capability -- ZERO Auth side effects
// (no reset-link generation, no email, no session revocation).
var adminCredentialCallables_1 = require("./access/adminCredentialCallables");
Object.defineProperty(exports, "initiateAdminPasswordReset", { enumerable: true, get: function () { return adminCredentialCallables_1.initiateAdminPasswordReset; } });
Object.defineProperty(exports, "listResetEligibleUsers", { enumerable: true, get: function () { return adminCredentialCallables_1.listResetEligibleUsers; } });
// --- ADMINISTRATION USERS CONSOLIDATION surface: the Employee profile write + the
// record-scoped Change History read ---
// Same posture as every surface above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. Both re-authorize server-side on a
// governed capability (admin.employeeProfile.write / audit.event.read).
//
// CORRECTED 2026-09-06. This said both "DENY today in every environment for the standing platform
// reason -- no principal holds a roleAssignments document". That was true when written and is now
// false: eos-platform-sandbox's admin persona has held `roleAssignments/bootstrap-admin-<uid>`
// (active, roleId admin, global) since the 2026-08-14 compatibility-admin bootstrap, and
// resolveEffectivePermission returns ALLOW there. What remains true is only that they deny for a
// principal holding no qualifying Role -- the ordinary fail-closed path. Neither weakens
// firestore.rules: employees stays client-write-denied and auditEvents stays client-read-denied,
// so these callables are the only paths that exist.
var administrationUsersCallables_1 = require("./access/administrationUsersCallables");
Object.defineProperty(exports, "updateEmployeeProfile", { enumerable: true, get: function () { return administrationUsersCallables_1.updateEmployeeProfile; } });
Object.defineProperty(exports, "listRecordChangeHistory", { enumerable: true, get: function () { return administrationUsersCallables_1.listRecordChangeHistory; } });
// --- EI Truck Registry surface (ADR-010 / Decision #60): trusted write callables ---
// Same posture as every surface above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. NO Admin UI wired to call them, NO App
// Check requirement (matching every other callable here), and the governed inventory predicate does NOT
// exist yet -- so
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
// Deployed and live in eos-platform-sandbox (2026-08-06, Decision #63). The governed
// inventory.stock.receive capability is GRANTED to admin, dispatcher and owner (compatibilityRoles.ts,
// Decisions #65/#68) -- it is NOT ungranted. The remaining gate is client transport readiness:
// RECEIVING_TRANSPORT_READY (field-ops-app-vite/src/config/receivingReadiness.js) is PER-ENVIRONMENT --
// corrected 2026-09-12, this used to say it "stays false ... so no client UI calls these today", which is
// false of sandbox. config/environments.json sets it TRUE in platform-sandbox and FALSE everywhere else,
// so the client DOES call these in sandbox; production stays closed until a separate Owner authorization
// releases the Hosting bundle. The capability is also granted to inventoryReceivingClerk, not only the
// three Roles named above. NO App Check requirement (matching every
// other callable here). The receive callable runs the pinned §3A ACTIVE-warehouse resolver; the option
// callable serves sanitized eligible options from the trusted backend (no client warehouses read).
// Firebase deploys each callable under its exported index property name, so these MUST be the exact
// frozen public names (no "Callable" suffix). The suffixed implementation consts are aliased here and are
// NOT otherwise exposed as callable surfaces.
var receivingCallables_1 = require("./inventoryReceiving/receivingCallables");
Object.defineProperty(exports, "receiveInventoryStock", { enumerable: true, get: function () { return receivingCallables_1.receiveInventoryStockCallable; } });
// Phase D READS. The multi-scan surface needs ordered lines AND what remains before scanning
// starts; purchase_orders is client-readable but receiving_orders is deny-all, so remaining cannot
// be derived in a browser. Both are gated on the SAME inventory.stock.receive capability -- no new
// capability, and read-only (no transaction, no write, no lifecycle change).
Object.defineProperty(exports, "getPurchaseOrderReceivingProgress", { enumerable: true, get: function () { return receivingCallables_1.getPurchaseOrderReceivingProgressCallable; } });
Object.defineProperty(exports, "listReceivablePurchaseOrders", { enumerable: true, get: function () { return receivingCallables_1.listReceivablePurchaseOrdersCallable; } });
Object.defineProperty(exports, "listReceivingLocationOptions", { enumerable: true, get: function () { return receivingCallables_1.listReceivingLocationOptionsCallable; } });
// --- Enterprise Inventory Phase 4 -- Transfer operating authority (functions/src/inventoryTransfer/*) ---
// Every inventory.transfer.* capability is registered `active: false`. Measured 2026-09-12: all four are
// held by inventoryTransferOperator (plus inventoryTransferReceiver for `.receive`) and all four are
// ACTIVATED in platform-sandbox, so a sandbox holder is ALLOWED. Production neither activates nor grants
// them, and wherever the capability is not activated every principal is denied.
// Exporting a callable is not deployment authorization by itself -- see receiveInventoryStock above.
var transferCallables_1 = require("./inventoryTransfer/transferCallables");
Object.defineProperty(exports, "createTransferOrder", { enumerable: true, get: function () { return transferCallables_1.createTransferOrderCallable; } });
Object.defineProperty(exports, "dispatchTransferOrder", { enumerable: true, get: function () { return transferCallables_1.dispatchTransferOrderCallable; } });
Object.defineProperty(exports, "receiveTransferOrder", { enumerable: true, get: function () { return transferCallables_1.receiveTransferOrderCallable; } });
Object.defineProperty(exports, "cancelTransferOrder", { enumerable: true, get: function () { return transferCallables_1.cancelTransferOrderCallable; } });
// The technician's command-scoped read of IN_TRANSIT Transfers bound for their own truck
// (inventory.transfer.receive; no Rules change, no new capability).
Object.defineProperty(exports, "listMyReceivableTransfers", { enumerable: true, get: function () { return transferCallables_1.listMyReceivableTransfersCallable; } });
// --- Enterprise Inventory -- Cycle Count: the A1 SHEET / LINE model (schema v2) + A4 durable reads ---
// Decision #179. These are the ONLY callables that create or read cycle counts. The v1 single-part
// callables (createCycleCount / submitCycleCount / reconcileCycleCount / cancelCycleCount) are NO LONGER
// exported: v1 records are retired in place (M-1) and the v1 modules survive only as frozen Certification
// tooling. A release that drops them must also delete the four deployed v1 functions (operator action).
var cycleCountSheetCallables_1 = require("./cycleCount/cycleCountSheetCallables");
Object.defineProperty(exports, "createCycleCountSheet", { enumerable: true, get: function () { return cycleCountSheetCallables_1.createCycleCountSheetCallable; } });
Object.defineProperty(exports, "openCycleCountLine", { enumerable: true, get: function () { return cycleCountSheetCallables_1.openCycleCountLineCallable; } });
Object.defineProperty(exports, "submitCycleCountLine", { enumerable: true, get: function () { return cycleCountSheetCallables_1.submitCycleCountLineCallable; } });
Object.defineProperty(exports, "reconcileCycleCountLine", { enumerable: true, get: function () { return cycleCountSheetCallables_1.reconcileCycleCountLineCallable; } });
Object.defineProperty(exports, "cancelCycleCountLine", { enumerable: true, get: function () { return cycleCountSheetCallables_1.cancelCycleCountLineCallable; } });
Object.defineProperty(exports, "cancelCycleCountSheet", { enumerable: true, get: function () { return cycleCountSheetCallables_1.cancelCycleCountSheetCallable; } });
Object.defineProperty(exports, "closeCycleCountSheet", { enumerable: true, get: function () { return cycleCountSheetCallables_1.closeCycleCountSheetCallable; } });
Object.defineProperty(exports, "listCycleCountSheets", { enumerable: true, get: function () { return cycleCountSheetCallables_1.listCycleCountSheetsCallable; } });
Object.defineProperty(exports, "getCycleCountSheet", { enumerable: true, get: function () { return cycleCountSheetCallables_1.getCycleCountSheetCallable; } });
Object.defineProperty(exports, "getCycleCountAssignedMobileLocation", { enumerable: true, get: function () { return cycleCountSheetCallables_1.getCycleCountAssignedMobileLocationCallable; } });
// --- Supplier Master (DECISIONS #78): trusted Supplier command callables ---
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. NO UI wired to call them, NO App
// Check requirement (matching every other callable here). Authorization is enforced INSIDE the command
// against the actor's real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for activate/deactivate. NO capability is granted BY THIS EXPORT; exporting a
// callable confers nothing. CORRECTED 2026-09-12: this used to say activate/deactivate "currently fail
// closed because no STANDING role carries inventory.catalog.activate". That standing Role now exists --
// inventoryCatalogAdministrator (access/governedBusinessRoles.ts) carries both ids, and seven governed
// Roles carry `.manage`. Both are registered ACTIVE, so a principal holding one of those Roles through a
// governed roleAssignment is ALLOWED. See docs/releases/supplier-master-rc-1.md for the grant history. Firebase deploys each callable under its exported
// index property name, so these MUST be the exact frozen public names (no "Callable" suffix); the
// suffixed implementation consts are aliased here and are NOT otherwise exposed.
var supplierMasterCallables_1 = require("./supplierMaster/supplierMasterCallables");
Object.defineProperty(exports, "createSupplier", { enumerable: true, get: function () { return supplierMasterCallables_1.createSupplierCallable; } });
Object.defineProperty(exports, "updateSupplier", { enumerable: true, get: function () { return supplierMasterCallables_1.updateSupplierCallable; } });
Object.defineProperty(exports, "activateSupplier", { enumerable: true, get: function () { return supplierMasterCallables_1.activateSupplierCallable; } });
Object.defineProperty(exports, "deactivateSupplier", { enumerable: true, get: function () { return supplierMasterCallables_1.deactivateSupplierCallable; } });
// --- Part Master (ADR-009 G2): trusted Part command callables ---
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. NO UI wired to call them yet, NO
// App Check requirement (matching every other callable here). Authorization is enforced INSIDE the
// command against the actor's real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for changePartStatus (the accepted catalog authority). NO capability is
// granted BY THIS EXPORT. CORRECTED 2026-09-12: this used to call inventoryCatalogAdministrator a "future
// durable role" and say catalog capabilities "are carried by no standing role". It exists
// (access/governedBusinessRoles.ts), carries both ids, and both ids are registered ACTIVE -- so a holder
// is ALLOWED, not failed closed. The remaining client-side gate is PART_MASTER_WRITE_READY. Firebase
// deploys each callable under its exported index property name, so these MUST be the exact frozen
// public names (no "Callable" suffix); the suffixed impl consts are aliased here and NOT otherwise exposed.
var partMasterCallables_1 = require("./partMaster/partMasterCallables");
Object.defineProperty(exports, "createPart", { enumerable: true, get: function () { return partMasterCallables_1.createPartCallable; } });
Object.defineProperty(exports, "updatePart", { enumerable: true, get: function () { return partMasterCallables_1.updatePartCallable; } });
Object.defineProperty(exports, "changePartStatus", { enumerable: true, get: function () { return partMasterCallables_1.changePartStatusCallable; } });
// --- Manufacturer (catalog reference object): trusted Manufacturer command callables ---
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. NO UI wired yet, NO App Check. Authorization enforced
// INSIDE the command against real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for status (the SAME catalog authority Part/Supplier use). NO capability is
// granted BY THIS EXPORT. CORRECTED 2026-09-12: inventoryCatalogAdministrator is no longer "future" --
// it is a standing Role carrying both ids (access/governedBusinessRoles.ts), and both ids are registered
// ACTIVE, so a holder is ALLOWED. The remaining client-side gate is MANUFACTURER_WRITE_READY. Closes the referential gap
// Part write created (parts.manufacturerId -> a currently-unmanageable entity). Firebase deploys each
// callable under its exported index property name -> frozen public names (no "Callable" suffix); the
// suffixed impl consts are aliased here and NOT otherwise exposed.
var manufacturerCallables_1 = require("./partMaster/manufacturerCallables");
Object.defineProperty(exports, "createManufacturer", { enumerable: true, get: function () { return manufacturerCallables_1.createManufacturerCallable; } });
Object.defineProperty(exports, "updateManufacturer", { enumerable: true, get: function () { return manufacturerCallables_1.updateManufacturerCallable; } });
Object.defineProperty(exports, "changeManufacturerStatus", { enumerable: true, get: function () { return manufacturerCallables_1.changeManufacturerStatusCallable; } });
// --- Part IDENTIFIERS / barcodes (part_aliases): trusted alias command + read callables ---
// Scanner Program Phase A (docs/product/inventory-scanner-program.md §18 step 4). The alias commands
// have existed, unit-tested, since INV-1 Phase 1 PR 1.3 and were UNREACHABLE: no onCall adapter was
// ever exported, so no browser could call them. The Part Master "Barcodes & Identifiers" section
// rendered UNAVAILABLE and named that gap precisely. These adapters close the TRANSPORT gap only.
//
// NO NEW CAPABILITY. All five are governed by `inventory.catalog.manage` -- the capability the alias
// commands already enforce, per the recorded O-gate direction. The two reads are gated on the same
// id because this is an administration surface with no separate audience, and because seeing an
// INACTIVE identifier is what makes the create path's conflict refusal legible. See
// partAliasCallables.ts for the alternative that was considered and not taken.
//
// EXPORT != DEPLOY, REGISTER != GRANT != ACTIVATE. Nothing here is deployed or granted by this
// slice, and the client transport additionally fails closed behind PART_IDENTIFIER_TRANSPORT_READY
// (false in every environment). `part_aliases` stays deny-all in firestore.rules and does not need
// to change: a callable runs on the Admin SDK, which Rules do not govern. Firebase deploys each
// callable under its exported index property name -> frozen public names (no "Callable" suffix).
var partAliasCallables_1 = require("./partMaster/partAliasCallables");
Object.defineProperty(exports, "createPartAlias", { enumerable: true, get: function () { return partAliasCallables_1.createPartAliasCallable; } });
Object.defineProperty(exports, "deactivatePartAlias", { enumerable: true, get: function () { return partAliasCallables_1.deactivatePartAliasCallable; } });
Object.defineProperty(exports, "reactivatePartAlias", { enumerable: true, get: function () { return partAliasCallables_1.reactivatePartAliasCallable; } });
Object.defineProperty(exports, "listPartAliases", { enumerable: true, get: function () { return partAliasCallables_1.listPartAliasesCallable; } });
Object.defineProperty(exports, "probePartAlias", { enumerable: true, get: function () { return partAliasCallables_1.probePartAliasCallable; } });
// Phase G. Gated on `inventory.catalog.alias.read`, NOT on `inventory.catalog.manage` -- alias
// lookup and alias administration have different audiences. The read capability is registered
// `active: false` but is held by inventoryLookupReader and inventoryStockRelocationOperator and is
// ACTIVATED in platform-sandbox (measured 2026-09-12); production neither activates nor grants it.
Object.defineProperty(exports, "resolveScannedPartIdentifier", { enumerable: true, get: function () { return partAliasCallables_1.resolveScannedPartIdentifierCallable; } });
// The scanner's ONE governed Part read (Lookup + Move stock), replacing client-direct `parts` reads.
Object.defineProperty(exports, "lookupScannedPart", { enumerable: true, get: function () { return partAliasCallables_1.lookupScannedPartCallable; } });
// --- Returns INTAKE (Scanner Phase Q; DECISIONS #118) ---
// Intake and disposition are SEPARATE authorities. This records that something came back and writes
// NO ledger event -- which is exactly why `RETURNED` still has no writer. Gated on
// inventory.returns.intake, registered `active: false`, held by inventoryReturnsIntakeClerk and activated
// in platform-sandbox only (measured 2026-09-12). `inventory_returns` has no Rules
// match block, so it is deny-all to every client. EXPORT != DEPLOY.
var returnCallables_1 = require("./inventoryReturns/returnCallables");
Object.defineProperty(exports, "recordReturnIntake", { enumerable: true, get: function () { return returnCallables_1.recordReturnIntakeCallable; } });
// --- Equipment INSTALL (serialized asset -> customer Equipment) ---
// The only path that can put a unit into a customer's hands. `serialized_assets` is deny-all to
// every client and the LINK between an asset and its Equipment cannot be written from a browser at
// all, so without this callable the authority is real and unreachable -- which is exactly what it
// was before this export.
//
// IRREVERSIBLE BY DESIGN: Equipment accountId and locationId are immutable after create and nothing
// clears the asset's currentEquipmentId, so a unit installed against the wrong customer stays there.
// Recovery is a separate, unimplemented authority (EQUIPMENT RECOVERY AUTHORITY GAP) and this
// callable must never be read as covering it.
//
// Gated on equipment.install, registered active:false and carried by exactly one Role
// (equipmentInstaller) -- deliberately NOT the same Role that may acquire units, so no single person
// can take a machine from non-existence to a customer. EXPORT != DEPLOY.
var installCallables_1 = require("./equipmentInstall/installCallables");
Object.defineProperty(exports, "installSerializedAsset", { enumerable: true, get: function () { return installCallables_1.installSerializedAssetCallable; } });
// --- NON-PO SERIALIZED ASSET ACQUISITION (ND-33) ---
//
// The other end of the same story the block above tells. Installing puts a unit the company already
// holds into a customer's hands; this brings a unit the company ALREADY OWNS onto the books without
// a purchase — an opening balance, a legacy migration, a machine that has been in the van for three
// years. Quantity stock could always say "we already hold 571 of these" through an ADJUSTED
// movement; serialized stock could not, because its only creator was receipt against a purchase
// order, so the platform could not say "we already own THIS machine" without inventing a purchase
// that never happened.
//
// HIGH TRUST, and narrow by construction: it creates owned inventory with NO procurement record, and
// every acquisition must name a reason from a closed set in which "we bought it" does not appear.
// The unit starts AVAILABLE with acquisitionProvenance NON_PO_ACQUISITION and no
// activatedByReceivingId, so the two populations stay distinguishable in every report forever.
//
// IT CREATES NO EQUIPMENT AND NO CUSTOMER RELATIONSHIP. Gated on
// inventory.serializedAsset.acquire, registered active:false and carried by exactly one Role —
// deliberately NOT the Role that may install, so no single person can take a machine from
// non-existence to a customer.
//
// THIS EXPORT IS THE GAP ND-33 RECORDED. The command and its production seams were both built and
// nothing exposed them; `acquireCallableWiring.ts` holds dependency resolvers, not a callable, and
// an earlier claim that it was "wired" was wrong. EXPORT != DEPLOY — the sandbox Functions deploy
// remains a separate Owner gate.
var acquireCallables_1 = require("./serializedAsset/acquireCallables");
Object.defineProperty(exports, "acquireSerializedAsset", { enumerable: true, get: function () { return acquireCallables_1.acquireSerializedAssetCallable; } });
// --- Equipment install AT WORK ORDER CLOSEOUT (WO-01A) ---
// The technician's path to the SAME equipment.install authority. Not a second install command: it
// decides whether this technician, on this work order, may ask -- then asks installSerializedAsset.
//
// WHY ITS OWN READ. getAvailableEquipment is gated on inventory.serializedAsset.read, a general
// inventory-browsing capability installer technicians do not hold and should not be given to populate
// a picker. getInstallableEquipmentForWorkOrder is gated on equipment.install and scoped to one work
// order, so a technician sees what they may install on THIS job and nothing else.
//
// Customer and location are DERIVED from the work order, read server-side; the request may not carry
// them and is refused if it tries. `serialized_assets` stays deny-all to every client -- the trusted
// function reads on the technician's behalf after checking the job is theirs.
//
// SCAN IS NOT INSTALL: the read writes nothing, including when resolving a scanned serial.
var workOrderInstallCallables_1 = require("./workOrderInstall/workOrderInstallCallables");
Object.defineProperty(exports, "getInstallableEquipmentForWorkOrder", { enumerable: true, get: function () { return workOrderInstallCallables_1.getInstallableEquipmentForWorkOrder; } });
Object.defineProperty(exports, "recordWorkOrderEquipmentInstall", { enumerable: true, get: function () { return workOrderInstallCallables_1.recordWorkOrderEquipmentInstallCallable; } });
// --- TECHNICIAN LABOR (Labor Domain V1) ---
// The canonical record of work performed. NOT workOrder.laborHours -- that field is a single mutable
// number that answers "how many hours" and destroys every other question: when, by whom, travel or
// onsite, what a correction changed, whether two entries overlap.
//
// Three facts the schema refuses to collapse: WORK PERFORMED, BILLABLE LABOR, LABOR COST. Only the
// first is recorded here. No rate, no cost, no billable flag -- V1 calculates neither payroll nor
// invoices, and must not pretend to know values nobody has decided.
//
// `work_order_labor_entries` has no Rules match block, so it is deny-all to every client: a
// technician's hours cannot be written from a browser at all. Both capabilities are registered
// active:false and carried by no Role yet. EXPORT != DEPLOY.
var laborCallables_1 = require("./workOrderLabor/laborCallables");
Object.defineProperty(exports, "recordWorkOrderLabor", { enumerable: true, get: function () { return laborCallables_1.recordWorkOrderLaborCallable; } });
Object.defineProperty(exports, "correctWorkOrderLabor", { enumerable: true, get: function () { return laborCallables_1.correctWorkOrderLaborCallable; } });
Object.defineProperty(exports, "getWorkOrderLabor", { enumerable: true, get: function () { return laborCallables_1.getWorkOrderLabor; } });
// --- Descriptive bin registry (Scanner Phase K; DECISIONS #116) ---
// A bin describes WHERE stock sits inside a warehouse; the warehouse still owns it. These author no
// quantity and no ledger movement. Gated on inventory.location.bin.manage (write) and .read
// (resolve/list) -- two capabilities because a put-away operator needs the check without the ability
// to create racking. Both registered `active: false`; measured 2026-09-12 `.manage` is held by
// inventoryBinAdministrator and `.read` also by inventoryPutAwayOperator/inventoryStockRelocationOperator,
// and both are ACTIVATED in platform-sandbox (production neither). `bins` has no Rules match block,
// so it is deny-all to every client; these run on the Admin SDK. EXPORT != DEPLOY.
var binCallables_1 = require("./inventoryLocation/binCallables");
Object.defineProperty(exports, "createBin", { enumerable: true, get: function () { return binCallables_1.createBinCallable; } });
// BIN-P1: correcting a mislabelled rack keeps the same stable binId, so placement history survives
// it. Same inventory.location.bin.manage capability -- a new command shape, not new authority.
Object.defineProperty(exports, "renameBin", { enumerable: true, get: function () { return binCallables_1.renameBinCallable; } });
Object.defineProperty(exports, "deactivateBin", { enumerable: true, get: function () { return binCallables_1.deactivateBinCallable; } });
Object.defineProperty(exports, "reactivateBin", { enumerable: true, get: function () { return binCallables_1.reactivateBinCallable; } });
Object.defineProperty(exports, "resolveBin", { enumerable: true, get: function () { return binCallables_1.resolveBinCallable; } });
// BIN-P1: the trusted machine-token lookup, gated on the same inventory.location.bin.read as the
// human-code resolve. It is the barcode path's governed read, and the reason the pure scan
// boundary needs no Firestore access of its own.
Object.defineProperty(exports, "resolveBinToken", { enumerable: true, get: function () { return binCallables_1.resolveBinTokenCallable; } });
// BIN-P3: the trusted READ-ONLY preview. Same inventory.location.bin.read as the resolves and
// the list -- it answers what createBin WOULD do, and writes nothing.
Object.defineProperty(exports, "previewBinCreates", { enumerable: true, get: function () { return binCallables_1.previewBinCreatesCallable; } });
Object.defineProperty(exports, "listBins", { enumerable: true, get: function () { return binCallables_1.listBinsCallable; } });
// Scanner Phase L. Gated on inventory.placement.record -- its own capability. Writes a placement
// record and nothing else: no ledger event, no quantity change, no balance (DECISIONS #116).
Object.defineProperty(exports, "recordPutAway", { enumerable: true, get: function () { return binCallables_1.recordPutAwayCallable; } });
// BIN-P6 / Decision #170 -- same-Warehouse stock relocation (RELOCATION_OUT / RELOCATION_IN).
// Gated on inventory.stock.relocate, registered `active: false`; BIN-P4 (Owner ruling B1, 2026-09-10)
// activated it in platform-sandbox ONLY and granted it through inventoryStockRelocationOperator alone.
var stockRelocationCallables_js_1 = require("./inventoryLocation/stockRelocationCallables.js");
Object.defineProperty(exports, "relocateStock", { enumerable: true, get: function () { return stockRelocationCallables_js_1.relocateStockCallable; } });
Object.defineProperty(exports, "listStockMovementLocations", { enumerable: true, get: function () { return stockRelocationCallables_js_1.listStockMovementLocationsCallable; } });
// --- Shared inventory BALANCE read (Scanner Phase H, general-purpose) ---
// Gated on `inventory.balance.read`, registered `active: false` but held by fifteen governed Roles and
// ACTIVATED in platform-sandbox (measured 2026-09-12); production neither activates nor grants it.
// EXPORT != DEPLOY.
var partBalanceReadService_1 = require("./inventory/partBalanceReadService");
Object.defineProperty(exports, "getPartBalance", { enumerable: true, get: function () { return partBalanceReadService_1.getPartBalanceCallable; } });
// The BATCHED sibling, for a page of parts. Same capability, same pure composition; one set of
// reads instead of N. See partBalanceBatchReadService.ts for why the shared inputs dominate.
var partBalanceBatchReadService_1 = require("./inventory/partBalanceBatchReadService");
Object.defineProperty(exports, "getPartBalances", { enumerable: true, get: function () { return partBalanceBatchReadService_1.getPartBalancesCallable; } });
// --- Part↔Supplier procurement terms (part_supplier_items): trusted command callables ---
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. NO UI wired yet, NO App Check. NO capability is granted BY THIS EXPORT.
// Authorization enforced INSIDE the command against real governed roles -- inventory.catalog.manage for
// create/update/setPreferred, inventory.catalog.activate for status (the SAME catalog authority the rest of
// the catalog uses). CORRECTED 2026-09-12: this used to say all four "fail closed until a deferred
// protected grant". Both ids are registered ACTIVE and carried by inventoryCatalogAdministrator
// (access/governedBusinessRoles.ts), so a holder is ALLOWED; undeployment is what closes production. Closes the procure-to-stock
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
// active:false; measured 2026-09-12 both are held by crmActivityContributor (and dispatcher/admin) and
// ACTIVATED in platform-sandbox. Nothing runs in production: it neither activates nor grants them, and
// production activation is triple-hard-blocked (access/environmentCapabilityOverrides.ts). `crm_activities` is Admin-SDK-only (no firestore.rules match block,
// default deny); these two trusted callables are the only read/write path.
var crmActivityCallables_1 = require("./crmActivity/crmActivityCallables");
Object.defineProperty(exports, "createCrmActivity", { enumerable: true, get: function () { return crmActivityCallables_1.createCrmActivity; } });
var crmActivityReadService_1 = require("./crmActivity/crmActivityReadService");
Object.defineProperty(exports, "getCrmActivities", { enumerable: true, get: function () { return crmActivityReadService_1.getCrmActivities; } });
// PERFORMANCE GOAL AUTHORITY (docs/governance/eos-dashboard-composition-authority.md, Rule 3). The
// governed TARGET authority: versioned, effective-dated, approved goals a dashboard compares against
// domain-owned actuals. Reconciles FIN-003 rather than competing with it -- a goal whose metric
// declares a financialBasis IS a FIN-003 plan and is compared by that core, and approval composes
// FIN-007's PLAN_APPROVAL invariants.
//
// EXPORT != DEPLOY, REGISTER != GRANT != ACTIVATE. All five `performance.goal.*` capabilities are
// registered active:false, and production resolves its activation override set to EMPTY
// unconditionally, so a deployed callable still denies for every principal there. `performance_goals`
// is Admin-SDK-only (no firestore.rules match block, default deny) -- these callables are the only
// read/write path. Firebase deploys each callable under its exported index property name, so the
// suffixed impl consts are aliased to frozen public names here.
var performanceGoalCallables_1 = require("./performance/performanceGoalCallables");
Object.defineProperty(exports, "createPerformanceGoalDraft", { enumerable: true, get: function () { return performanceGoalCallables_1.createPerformanceGoalDraftCallable; } });
Object.defineProperty(exports, "approvePerformanceGoal", { enumerable: true, get: function () { return performanceGoalCallables_1.approvePerformanceGoalCallable; } });
Object.defineProperty(exports, "retirePerformanceGoal", { enumerable: true, get: function () { return performanceGoalCallables_1.retirePerformanceGoalCallable; } });
Object.defineProperty(exports, "listCurrentPerformanceGoals", { enumerable: true, get: function () { return performanceGoalCallables_1.listCurrentPerformanceGoalsCallable; } });
Object.defineProperty(exports, "listPerformanceGoalVersions", { enumerable: true, get: function () { return performanceGoalCallables_1.listPerformanceGoalVersionsCallable; } });
Object.defineProperty(exports, "listGoalSubjects", { enumerable: true, get: function () { return performanceGoalCallables_1.listGoalSubjectsCallable; } });
// --- EOS Data Import P1 (sandbox-only native file import) ---
// Administration -> Data Import. Three callables: stage a file into a previewed job, execute an
// approved job, and list history. SANDBOX ONLY, and enforced in the code rather than by deployment
// discipline: every one of them calls assertNonProductionImportTarget FIRST, which refuses the
// production project by name from the runtime's own GCLOUD_PROJECT before any authority is even
// evaluated. Both capabilities (admin.dataImport.stage / .execute) are registered active:false and
// activated only where config/environments.json says so.
//
// EXECUTION ADDS NO WRITE AUTHORITY. It calls the same governed partMaster createPart a human uses,
// which enforces inventory.catalog.manage, validates, keys idempotency and audits inside its own
// transaction. Import cannot write anything a person with the same capabilities could not have
// written one record at a time. Frozen public names, no "Callable" suffix, per the convention above.
var dataImportCallables_1 = require("./dataImport/dataImportCallables");
Object.defineProperty(exports, "stageDataImport", { enumerable: true, get: function () { return dataImportCallables_1.stageDataImportCallable; } });
Object.defineProperty(exports, "executeDataImport", { enumerable: true, get: function () { return dataImportCallables_1.executeDataImportCallable; } });
Object.defineProperty(exports, "listDataImportJobs", { enumerable: true, get: function () { return dataImportCallables_1.listDataImportJobsCallable; } });
// --- EOS Data Import P1 -- the READ side of imported service history ---
// Separate from the three import callables above in every way that matters: it is NOT
// sandbox-gated (reading records that already exist is not a sandbox-only act), and it is NOT
// gated on the import capabilities (gating it on those would make imported history visible only
// to whoever imported it). It gates on `customer.record.read` -- the existing, ACTIVE authority
// to read a Customer -- and resolves nothing: the technician name and equipment serial leave as
// the historical TEXT they were stored as.
var dataImportCallables_2 = require("./dataImport/dataImportCallables");
Object.defineProperty(exports, "listImportedServiceHistory", { enumerable: true, get: function () { return dataImportCallables_2.listImportedServiceHistoryCallable; } });
// --- Email Connections + Inbound Work (base EOS email intake) ---
//
// EXPORT != DEPLOY, REGISTER != GRANT. Ten callables covering the whole vertical slice: the Service
// Inbound Work queue and its review detail, the three governed decisions (accept / decline / attach to
// existing), the Administration configuration read and its three writes, and the non-production delivery
// seam. All six capabilities (administration.emailIntake.read/manage, service.inboundWork.read/accept/
// decline/attachExisting) are registered active:false, so every principal is denied in every environment
// until a per-environment activation AND a governed roleAssignment exist -- production activation is
// hard-blocked in environmentCapabilityOverrides.ts.
//
// NO RULES CHANGE. The four collections these read and write (email_connections, email_mailboxes,
// email_routing_rules, inbound_work_requests) have no firestore.rules match block, so every client read and
// write is denied by default and these trusted callables are the only path in or out.
//
// ACCEPT ADDS NO WRITE AUTHORITY: it creates the Work Order through the SAME governed createWorkOrderRecord
// core the createWorkOrder callable uses, inside one transaction with its audit event.
var inboundWorkCallables_1 = require("./inboundWork/inboundWorkCallables");
Object.defineProperty(exports, "listInboundWork", { enumerable: true, get: function () { return inboundWorkCallables_1.listInboundWork; } });
Object.defineProperty(exports, "getInboundWorkRequest", { enumerable: true, get: function () { return inboundWorkCallables_1.getInboundWorkRequest; } });
Object.defineProperty(exports, "acceptInboundWork", { enumerable: true, get: function () { return inboundWorkCallables_1.acceptInboundWork; } });
Object.defineProperty(exports, "declineInboundWork", { enumerable: true, get: function () { return inboundWorkCallables_1.declineInboundWork; } });
Object.defineProperty(exports, "attachInboundWorkToWorkOrder", { enumerable: true, get: function () { return inboundWorkCallables_1.attachInboundWorkToWorkOrder; } });
Object.defineProperty(exports, "getEmailIntakeConfiguration", { enumerable: true, get: function () { return inboundWorkCallables_1.getEmailIntakeConfiguration; } });
Object.defineProperty(exports, "saveEmailConnection", { enumerable: true, get: function () { return inboundWorkCallables_1.saveEmailConnection; } });
Object.defineProperty(exports, "saveEmailMailbox", { enumerable: true, get: function () { return inboundWorkCallables_1.saveEmailMailbox; } });
Object.defineProperty(exports, "saveEmailRoutingRule", { enumerable: true, get: function () { return inboundWorkCallables_1.saveEmailRoutingRule; } });
Object.defineProperty(exports, "deliverInboundEmailMessage", { enumerable: true, get: function () { return inboundWorkCallables_1.deliverInboundEmailMessage; } });
// --- Email Connections: REAL provider delivery + attachment custody (phase 2 of the same capability) ---
//
// EXPORT != DEPLOY, and this group additionally REFUSES PRODUCTION at runtime: every callable below and
// the schedule check the runtime's own project identity first, so production provider binding, production
// polling and production attachment ingestion are impossible rather than merely unauthorized.
//
// It adds NO intake path and NO Work Order path. Delivery fetches a provider message, hands it to the
// SAME normalizer and the SAME ingestInboundMessage phase 1 uses, and stops there; Accept still creates
// the Work Order through createWorkOrderRecord exactly as before.
//
// Authority is phase 1's: connecting, testing, polling and retrying are administration.emailIntake.manage;
// reading an attachment is service.inboundWork.read -- the same capability that opens the request it
// belongs to. No new capability was introduced.
var emailTransportCallables_1 = require("./inboundWork/emailTransportCallables");
Object.defineProperty(exports, "startEmailConnectionAuthorization", { enumerable: true, get: function () { return emailTransportCallables_1.startEmailConnectionAuthorization; } });
Object.defineProperty(exports, "completeEmailConnectionAuthorization", { enumerable: true, get: function () { return emailTransportCallables_1.completeEmailConnectionAuthorization; } });
Object.defineProperty(exports, "testEmailConnection", { enumerable: true, get: function () { return emailTransportCallables_1.testEmailConnection; } });
Object.defineProperty(exports, "disconnectEmailConnection", { enumerable: true, get: function () { return emailTransportCallables_1.disconnectEmailConnection; } });
Object.defineProperty(exports, "getEmailProviderReadiness", { enumerable: true, get: function () { return emailTransportCallables_1.getEmailProviderReadiness; } });
Object.defineProperty(exports, "pollEmailMailboxNow", { enumerable: true, get: function () { return emailTransportCallables_1.pollEmailMailboxNow; } });
Object.defineProperty(exports, "retryEmailDelivery", { enumerable: true, get: function () { return emailTransportCallables_1.retryEmailDelivery; } });
Object.defineProperty(exports, "getInboundWorkAttachment", { enumerable: true, get: function () { return emailTransportCallables_1.getInboundWorkAttachment; } });
// The scheduled poller -- the thing that makes delivery automatic. Deploying it is what starts it; until
// then nothing runs on any schedule anywhere.
var emailDeliverySchedule_1 = require("./inboundWork/emailDeliverySchedule");
Object.defineProperty(exports, "pollEmailMailboxes", { enumerable: true, get: function () { return emailDeliverySchedule_1.pollEmailMailboxes; } });
//# sourceMappingURL=index.js.map