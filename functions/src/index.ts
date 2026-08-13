// Cloud Functions entry point. Deliberately thin: no logic here, so
// every exported module stays independently testable.
import { initializeApp } from "firebase-admin/app";

initializeApp();

// --- Issue #15 surface: Work Order Engine v1.2 ---
export { createWorkOrder } from "./createWorkOrder";
export { transitionWorkOrder } from "./transitionWorkOrder";
export { updateWorkOrderExecutionData } from "./updateWorkOrderExecutionData";
export { detectInventoryEffects } from "./inventoryEffectCallables";
export { getInventoryAnalytics } from "./inventoryAnalyticsCallables";
// WO Parts Planning Phase 2 -- the governed PLANNED producer. "export is not deployment": not deployed to
// the live project and no client calls it, and its capability (workOrder.parts.plan) is registered
// active:false (fail-closed for everyone) until a separate Owner deploy + grant gate.
export { setWorkOrderPartsPlan } from "./workOrderPartsPlan/setWorkOrderPartsPlan";
// Sales Opportunity governed write callables (Cycle 3). EXPORT != DEPLOY, REGISTER != GRANT: exported for
// build/test only; the `opportunity.write` capability is registered active:false (fail-closed) and nothing
// runs in production until a separate deploy + Owner grant.
export { createOpportunity, transitionOpportunity } from "./opportunity/opportunityCallables";
// Trusted minimal Opportunity READ projection (avoids client Rules widening). EXPORT != DEPLOY, capability
// `opportunity.read` registered active:false (REGISTER != GRANT).
export { listOpportunityContext } from "./opportunity/opportunityReadService";
// Sales Order governed write callables (Cycle 4). EXPORT != DEPLOY; capability `salesOrder.write` registered
// active:false (REGISTER != GRANT).
export { createSalesOrder, transitionSalesOrder } from "./salesOrder/salesOrderCallables";
// Fulfillment allocation (Cycle 5 live). EXPORT != DEPLOY; capability `salesOrder.fulfill` active:false.
export { allocateSalesOrder } from "./fulfillment/allocateSalesOrder";
// Sales Order → Service seam (Cycle 7). EXPORT != DEPLOY; capability `salesOrder.service` active:false.
export { createServiceForSalesOrder } from "./salesOrder/createServiceForSalesOrder";
// Finance (Billing/AR) — governed invoice issuance. EXPORT != DEPLOY; capability `finance.invoice.issue`
// active:false (ungranted); `invoices` is Admin-SDK-only (deny-all client Rules). Sensitive/audited.
export { issueInvoice } from "./finance/invoiceCallables";
// Finance (Billing/AR) — governed payment application. EXPORT != DEPLOY; capability `finance.payment.apply`
// active:false; `payments`/`payment_applications` are Admin-SDK-only (deny-all client Rules). Sensitive/audited.
export { applyPayment } from "./finance/paymentCallables";
// Finance (Billing/AR) — governed invoice adjustments (credit/charge/write-off). EXPORT != DEPLOY; capability
// `finance.adjustment.record` active:false; `invoice_adjustments` is Admin-SDK-only (deny-all client Rules).
export { recordInvoiceAdjustment } from "./finance/adjustmentCallables";
// Finance (Billing/AR) — trusted AR read projection. EXPORT != DEPLOY; capability `finance.read` active:false;
// backend read only (invoices stay Admin-SDK-only / deny-all client Rules).
export { listAccountInvoiceAr } from "./finance/financeReadCallables";
// Commercial Coverage & Territory (#15) — governed coverage writes. EXPORT != DEPLOY; capability
// `coverage.write` active:false; sales_territories / commercial_coverage_assignments are Admin-SDK-only.
export { createSalesTerritory, createCoverageAssignment } from "./coverage/coverageCallables";
// Commercial Coverage & Territory (#15) — trusted coverage resolve (read). EXPORT != DEPLOY; capability
// `coverage.read` active:false; backend read only (coverage collections stay Admin-SDK-only / deny-all).
export { resolveCoverageForContext } from "./coverage/coverageReadCallables";
// Finance (Billing/AR) — governed refund. EXPORT != DEPLOY; capability `finance.refund.record` active:false;
// `refunds` is Admin-SDK-only (deny-all client Rules). Sensitive/audited.
export { recordRefund } from "./finance/refundCallables";

// --- F1 surface: trusted minimal field-context display projection ---
// Answers "who is the customer / which site am I going to?" for the CALLER'S
// OWN assigned Work Order. Not a customer-lookup API: the request carries
// workOrderId only, and every id read comes from the governed Work Order
// itself. No Firestore Rules change and no broad customer-read capability
// accompany it -- see docs/assessments/f1-technician-customer-identity.md.
export { getWorkOrderFieldContext } from "./getWorkOrderFieldContext";

// --- F-RULES-1 surface: trusted technician job completion (Decision #39) ---
// Same "export is not deployment" posture as the surfaces below: not
// deployed to the live project, and no client calls it (Field Mode's
// integration is PR-B, a separate Owner gate) until Gate D1's Owner
// production authorization. Until then the legacy client completion path
// remains permitted by the interim Firestore Rules; the Rules that deny it
// land in PR-C and deploy at Gate D2, strictly after D1.
export { completeAssignedJob } from "./completeAssignedJob";

// --- Issue #226 surface: Enterprise Access & Administration Platform ---
// Exactly these six -- see docs/deployment/enterprise-access-deployment-
// manifest.md Section B. Not deployed, and no client calls them, until a
// separate, later Owner production authorization (Implementation Plan
// Row 19+) is issued.
export {
  grantRole,
  revokeRole,
  assignApprovedRole,
  setUserStatus,
  approveAccessRequest,
  rejectAccessRequest,
} from "./access/accessCommandCallables";

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
export { runReportDefinitionCallable } from "./reporting/runReportDefinitionCallable";

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
export {
  createSavedDefinitionCallable,
  getSavedDefinitionCallable,
  listSavedDefinitionsCallable,
  renameSavedDefinitionCallable,
  duplicateSavedDefinitionCallable,
  deleteSavedDefinitionCallable,
} from "./reporting/savedDefinitionCallables";

// --- Issue #226 surface: trusted effective-access feed ---
// Same "export is not deployment" posture as the surfaces above: not
// deployed to the live project, and no client calls it (Customer's own
// W1 UI integration is a separate, later, explicitly out-of-scope step
// for this PR) until a separate, later Owner production authorization.
// Read-only, mutates nothing, writes no Audit Event -- see
// effectiveAccessFeed.ts's own header for why this surface doesn't
// audit (unlike the mutating commands above or the row-reading report
// execution service).
export { resolveEffectiveAccessCallable } from "./access/effectiveAccessFeedCallable";

// --- AUTH-PR-3 surface: admin-initiated password reset (Authentication
// Modernization; extends Issue #226) ---
// Same "export is not deployment" posture as every surface above: NOT deployed
// to the live project, NO Admin UI wired to call them, and NO email provider
// configured (adminCredentialCallables wires NOT_CONFIGURED_DELIVERY) until a
// SEPARATE, later Owner production authorization. As deployed today the command
// FAILS CLOSED on the unconfigured delivery capability -- ZERO Auth side effects
// (no reset-link generation, no email, no session revocation).
export {
  initiateAdminPasswordReset,
  listResetEligibleUsers,
} from "./access/adminCredentialCallables";

// --- EI Truck Registry surface (ADR-010 / Decision #60): trusted write callables ---
// Same "export is not deployment" posture as every surface above: NOT deployed to the live
// project, NO Admin UI wired to call them, NO App Check requirement (matching every other
// callable here), and the governed inventory predicate does NOT exist yet -- so
// deactivateTruck FAILS CLOSED (INVENTORY_STATE_UNKNOWN) until a separate, later gate injects a
// real predicate. Authorization is admin/dispatcher (users/{uid}.role), enforced in the service.
export {
  createTruckCallable,
  assignTruckDriverCallable,
  reassignTruckDriverCallable,
  unassignTruckDriverCallable,
  changeTruckStatusCallable,
  changeTruckHomeWarehouseCallable,
  deactivateTruckCallable,
  reactivateTruckCallable,
  deleteTruckCreatedInErrorCallable,
} from "./truckRegistry/truckRegistryCallables";

// --- EI Phase-2 Receiving surface (E1): trusted Receiving callables ---
// "Export is not deployment/grant": NOT deployed to the live project, NO Admin/Customer UI wired to
// call them, NO App Check requirement (matching every other callable here). Both require the governed
// inventory.stock.receive capability, which is REGISTERED BUT UNGRANTED -- so every real user is denied
// until a separate grant gate. The receive callable runs the pinned §3A ACTIVE-warehouse resolver; the
// option callable serves sanitized eligible options from the trusted backend (no client warehouses read).
// Firebase deploys each callable under its exported index property name, so these MUST be the exact
// frozen public names (no "Callable" suffix). The suffixed implementation consts are aliased here and are
// NOT otherwise exposed as callable surfaces.
export {
  receiveInventoryStockCallable as receiveInventoryStock,
  listReceivingLocationOptionsCallable as listReceivingLocationOptions,
} from "./inventoryReceiving/receivingCallables";

// --- Supplier Master (DECISIONS #78): trusted Supplier command callables ---
// "Export is not deployment/grant": NOT deployed to the live project, NO UI wired to call them, NO App
// Check requirement (matching every other callable here). Authorization is enforced INSIDE the command
// against the actor's real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for activate/deactivate. NO capability is granted here; activate/deactivate
// currently fail closed because no STANDING role carries inventory.catalog.activate (a deferred protected
// grant -- see docs/releases/supplier-master-rc-1.md). Firebase deploys each callable under its exported
// index property name, so these MUST be the exact frozen public names (no "Callable" suffix); the
// suffixed implementation consts are aliased here and are NOT otherwise exposed.
export {
  createSupplierCallable as createSupplier,
  updateSupplierCallable as updateSupplier,
  activateSupplierCallable as activateSupplier,
  deactivateSupplierCallable as deactivateSupplier,
} from "./supplierMaster/supplierMasterCallables";

// --- Part Master (ADR-009 G2): trusted Part command callables ---
// "Export is not deployment/grant": NOT deployed to the live project, NO UI wired to call them yet, NO
// App Check requirement (matching every other callable here). Authorization is enforced INSIDE the
// command against the actor's real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for changePartStatus (the accepted catalog authority / future durable
// inventoryCatalogAdministrator role). NO capability is granted here; catalog capabilities are carried
// by no standing role, so create/update/status fail closed until a deferred protected grant. Firebase
// deploys each callable under its exported index property name, so these MUST be the exact frozen
// public names (no "Callable" suffix); the suffixed impl consts are aliased here and NOT otherwise exposed.
export {
  createPartCallable as createPart,
  updatePartCallable as updatePart,
  changePartStatusCallable as changePartStatus,
} from "./partMaster/partMasterCallables";

// --- Manufacturer (catalog reference object): trusted Manufacturer command callables ---
// "Export is not deployment/grant": NOT deployed, NO UI wired yet, NO App Check. Authorization enforced
// INSIDE the command against real governed roles -- inventory.catalog.manage for create/update,
// inventory.catalog.activate for status (the SAME catalog authority Part/Supplier use; future durable
// inventoryCatalogAdministrator). NO capability granted here; catalog capabilities are carried by no
// standing role, so all three fail closed until a deferred protected grant. Closes the referential gap
// Part write created (parts.manufacturerId -> a currently-unmanageable entity). Firebase deploys each
// callable under its exported index property name -> frozen public names (no "Callable" suffix); the
// suffixed impl consts are aliased here and NOT otherwise exposed.
export {
  createManufacturerCallable as createManufacturer,
  updateManufacturerCallable as updateManufacturer,
  changeManufacturerStatusCallable as changeManufacturerStatus,
} from "./partMaster/manufacturerCallables";

// --- Part↔Supplier procurement terms (part_supplier_items): trusted command callables ---
// "Export is not deployment/grant": NOT deployed, NO UI wired yet, NO capability granted, NO App Check.
// Authorization enforced INSIDE the command against real governed roles -- inventory.catalog.manage for
// create/update/setPreferred, inventory.catalog.activate for status (the SAME catalog authority the rest of
// the catalog uses). All four fail closed until a deferred protected grant. Closes the procure-to-stock
// gap (governed preferred-supplier + terms instead of free-form). The part_supplier_items READ stays served
// by governed projections gated on R-1's inventory.catalog.read / .cost.read (partSupplierItemProjections.ts
// is the pure contract; the read service is NOT activated here). Firebase deploys each callable under its
// exported index property name -> frozen public names (no "Callable" suffix); suffixed impl consts aliased.
export {
  createPartSupplierItemCallable as createPartSupplierItem,
  updatePartSupplierItemCallable as updatePartSupplierItem,
  changePartSupplierItemStatusCallable as changePartSupplierItemStatus,
  setPreferredSupplierCallable as setPreferredSupplier,
} from "./partMaster/partSupplierItemCallables";
