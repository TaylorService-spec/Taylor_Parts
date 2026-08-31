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
export { getAccountPortfolioSummary } from "./account/accountPortfolioSummary";
// WO Parts Planning Phase 2 -- the governed PLANNED producer. Deployed to eos-platform-sandbox under the
// per-environment activation program; NOT deployed to the production project. No client calls it, and its
// capability (workOrder.parts.plan) is registered active:false (fail-closed for everyone) until a separate
// Owner grant gate.
export { setWorkOrderPartsPlan } from "./workOrderPartsPlan/setWorkOrderPartsPlan";
// Dispatch & Scheduler -- the governed Scheduling domain (ND-18 through ND-22, Owner ruling
// 2026-08-27). EXPORT IS NOT DEPLOY: these are exported for build and test only. Nothing in the
// client calls them yet, the North Star Dispatch composition that will is a separate step, and
// deploying them to any project is its own authorized action.
//
// Un-scheduling is NOT here -- it is a lifecycle transition and ships as transitionWorkOrder's
// "Unschedule" action (ND-18). Re-timing and reassignment are plan changes and ship here (ND-19).
export {
  rescheduleWorkOrderCallable,
  reassignScheduledWorkOrderCallable,
  setWorkOrderEstimatedDurationCallable,
  setTechnicianWorkingAvailabilityCallable,
  createTechnicianBlockedTimeCallable,
  deleteTechnicianBlockedTimeCallable,
  readTechnicianAvailabilityCallable,
} from "./scheduling/schedulingCallables";
// Sales Opportunity governed write callables (Cycle 3). EXPORT != DEPLOY, REGISTER != GRANT: exported for
// build/test only; the `opportunity.write` capability is registered active:false (fail-closed) and nothing
// runs in production until a separate deploy + Owner grant.
export { createOpportunity, transitionOpportunity, updateOpportunity } from "./opportunity/opportunityCallables";
// Trusted minimal Opportunity READ projection (avoids client Rules widening). EXPORT != DEPLOY, capability
// `opportunity.read` registered active:false (REGISTER != GRANT).
export { listOpportunityContext, listOpportunitiesForAccount } from "./opportunity/opportunityReadService";
// The PER-ID Opportunity read (North Star family 4). Same governed capability as the two list reads
// above -- `opportunity.read` -- because the authorization question is identical and only the query
// shape differs; no Rules change, no new capability. It is what gives an Opportunity a URL.
// EXPORT != DEPLOY.
export { getOpportunityContext } from "./opportunity/opportunityReadService";
// P1.3 -- governed, human-invoked WON -> Create Sales Order action (decision #3: no Firestore trigger).
// EXPORT != DEPLOY; capability `opportunity.createSalesOrder` registered active:false (REGISTER != GRANT).
export { createSalesOrderFromOpportunity } from "./opportunity/createSalesOrderFromOpportunity";
// The ATOMIC Won action. Closes the Opportunity as WON and creates its Sales Order in ONE
// transaction, so a Won Opportunity can never exist without its order. EXPORT != DEPLOY.
export { closeOpportunityAsWon } from "./opportunity/closeOpportunityAsWon";
// Sales Order trusted read projection. EXPORT != DEPLOY; capability `salesOrder.read` registered
// active:false (REGISTER != GRANT). Owner-ratified 2026-08-15 (see permissionCatalog.ts's entry).
export { getSalesOrderContext, listSalesOrdersForAccount, listSalesOrderIndex } from "./salesOrder/salesOrderReadService";
// Sales Agreement (Slice 4) -- the commercial commitment. Three write verbs and two reads; no
// generic update, and nothing that can amend an ACCEPTED agreement. EXPORT != DEPLOY: these are
// registered active:false and deny for everyone until a separate grant + per-environment activation.
export { createSalesAgreement, updateSalesAgreementDraft, acceptSalesAgreement } from "./salesAgreement/salesAgreementCallables";
export { getSalesAgreementContext, getSalesAgreementForOpportunity } from "./salesAgreement/salesAgreementReadService";
// The product picker read. Serves BOTH the Part typeahead and the Equipment Model picker, behind
// the existing inventory.catalog.read authority -- no new capability, no widened Firestore Rules.
export { searchProductReferences } from "./salesAgreement/productReferenceSearchService";
export { getManufacturerCatalog } from "./partMaster/manufacturerReadService";
// Serialized Asset trusted Available-Equipment read (Spec phase M.1). EXPORT != DEPLOY; capability
// `inventory.serializedAsset.read` registered active:false (REGISTER != GRANT), granted to NO Role.
export { getAvailableEquipment } from "./serializedAsset/serializedAssetReadService";
// Coordinated Operations trusted read (fidelity fix, 2026-08-15) -- serves the existing coordinatedVisit/
// coordinatedFieldMission pure projections from real fieldops_wos data. EXPORT != DEPLOY; capability
// `fulfillment.coordinatedVisit.read` registered active:false (REGISTER != GRANT), granted to NO Role.
export { listCoordinatedOperations } from "./fulfillment/coordinatedVisitReadService";
// Location-DISPLAY trusted resolver (sandbox-fidelity package PART 11A) -- id -> { type, label } for
// WAREHOUSE/MOBILE only, backing Available Equipment's location column. EXPORT != DEPLOY; capability
// `inventory.location.display.read` registered active:false (REGISTER != GRANT), granted to NO Role.
export { getLocationDisplay } from "./inventoryLocation/locationDisplayReadService";
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

// --- North Star Work Order readiness context ---
// Trusted READ-ONLY assembler for #1492. Request carries workOrderId only; every inventory/procurement
// join key is derived from the authorized Work Order server-side. EXPORT != DEPLOY and the client stays
// fail-closed behind WORK_ORDER_READINESS_CONTEXT_READY until a separately authorized sandbox release.
export { getWorkOrderReadinessContext } from "./ai/workOrderReadinessContext";

// Private-AI interpretation of that same readiness context. EXPORT != DEPLOY, and here the export is
// unusually far from a grant: the callable refuses in every environment the registry declares, which
// is currently all of them, and the only environment classified as synthetic (demo-certworld) is an
// emulator project that cannot be deployed to. It also cannot write, cannot dispatch a command, and
// cannot recommend an action -- the verifier rejects any action the model names.
export { interpretWorkOrderReadinessContext } from "./ai/workOrderReadinessContext";

// --- F-RULES-1 surface: trusted technician job completion (Decision #39) ---
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. No client calls it (Field Mode's integration is PR-B, a separate Owner gate) until
// Gate D1's Owner production authorization. Until then the legacy client completion path remains
// permitted by the interim Firestore Rules; the Rules that deny it land in PR-C and deploy at Gate D2,
// strictly after D1.
export { completeAssignedJob } from "./completeAssignedJob";

// --- Issue #226 surface: Enterprise Access & Administration Platform ---
// Exactly these six -- see docs/deployment/enterprise-access-deployment-
// manifest.md Section B. Deployed to eos-platform-sandbox under the per-environment activation program;
// NOT deployed to the production project. No client calls them until a separate, later Owner production
// authorization (Implementation Plan Row 19+) is issued.
export {
  grantRole,
  revokeRole,
  assignApprovedRole,
  requestPrivilegedRole,
  decidePrivilegedRoleRequest,
  listPrivilegedRoleRequests,
  setUserStatus,
  approveAccessRequest,
  rejectAccessRequest,
} from "./access/accessCommandCallables";

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
export { runReportDefinitionCallable } from "./reporting/runReportDefinitionCallable";

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
export {
  createSavedDefinitionCallable,
  getSavedDefinitionCallable,
  listSavedDefinitionsCallable,
  renameSavedDefinitionCallable,
  duplicateSavedDefinitionCallable,
  deleteSavedDefinitionCallable,
} from "./reporting/savedDefinitionCallables";

// --- Issue #226 surface: trusted effective-access feed ---
// Same posture as the surfaces above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. No client calls it (Customer's own
// W1 UI integration is a separate, later, explicitly out-of-scope step
// for this PR) until a separate, later Owner production authorization.
// Read-only, mutates nothing, writes no Audit Event -- see
// effectiveAccessFeed.ts's own header for why this surface doesn't
// audit (unlike the mutating commands above or the row-reading report
// execution service).
export { resolveEffectiveAccessCallable } from "./access/effectiveAccessFeedCallable";

// --- AUTH-PR-3 surface: admin-initiated password reset (Authentication
// Modernization; extends Issue #226) ---
// Same posture as every surface above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. NO Admin UI wired to call them, and NO
// email provider configured (adminCredentialCallables wires NOT_CONFIGURED_DELIVERY) until a
// SEPARATE, later Owner production authorization. As deployed today the command
// FAILS CLOSED on the unconfigured delivery capability -- ZERO Auth side effects
// (no reset-link generation, no email, no session revocation).
export {
  initiateAdminPasswordReset,
  listResetEligibleUsers,
} from "./access/adminCredentialCallables";

// --- EI Truck Registry surface (ADR-010 / Decision #60): trusted write callables ---
// Same posture as every surface above: deployed to eos-platform-sandbox under the per-environment
// activation program, NOT deployed to the production project. NO Admin UI wired to call them, NO App
// Check requirement (matching every other callable here), and the governed inventory predicate does NOT
// exist yet -- so
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
// Deployed and live in eos-platform-sandbox (2026-08-06, Decision #63). The governed
// inventory.stock.receive capability is GRANTED to admin, dispatcher and owner (compatibilityRoles.ts,
// Decisions #65/#68) -- it is NOT ungranted. The remaining gate is client transport readiness:
// RECEIVING_TRANSPORT_READY (field-ops-app-vite/src/config/receivingReadiness.js) stays false until a
// separate Owner authorization releases the Hosting bundle, so no client UI calls these today even
// though the backend accepts calls from a granted principal. NO App Check requirement (matching every
// other callable here). The receive callable runs the pinned §3A ACTIVE-warehouse resolver; the option
// callable serves sanitized eligible options from the trusted backend (no client warehouses read).
// Firebase deploys each callable under its exported index property name, so these MUST be the exact
// frozen public names (no "Callable" suffix). The suffixed implementation consts are aliased here and are
// NOT otherwise exposed as callable surfaces.
export {
  receiveInventoryStockCallable as receiveInventoryStock,
  // Phase D READS. The multi-scan surface needs ordered lines AND what remains before scanning
  // starts; purchase_orders is client-readable but receiving_orders is deny-all, so remaining cannot
  // be derived in a browser. Both are gated on the SAME inventory.stock.receive capability -- no new
  // capability, and read-only (no transaction, no write, no lifecycle change).
  getPurchaseOrderReceivingProgressCallable as getPurchaseOrderReceivingProgress,
  listReceivablePurchaseOrdersCallable as listReceivablePurchaseOrders,
  listReceivingLocationOptionsCallable as listReceivingLocationOptions,
} from "./inventoryReceiving/receivingCallables";

// --- Enterprise Inventory Phase 4 -- Transfer operating authority (functions/src/inventoryTransfer/*) ---
// Every inventory.transfer.* capability is registered `active: false` and granted to NO Role, so every
// principal is denied `noQualifyingGrant` until a later, separately-authorized grant + activation gate.
// Exporting a callable is not deployment authorization by itself -- see receiveInventoryStock above.
export {
  createTransferOrderCallable as createTransferOrder,
  dispatchTransferOrderCallable as dispatchTransferOrder,
  receiveTransferOrderCallable as receiveTransferOrder,
  cancelTransferOrderCallable as cancelTransferOrder,
} from "./inventoryTransfer/transferCallables";

// --- Enterprise Inventory -- Cycle Count operating authority (functions/src/cycleCount/*) ---
// Every inventory.cycleCount.* capability is registered `active: false` and granted to NO Role, so every
// principal is denied `noQualifyingGrant` until a later, separately-authorized grant + activation gate.
// Exporting a callable is not deployment authorization by itself -- see receiveInventoryStock above.
export {
  createCycleCountCallable as createCycleCount,
  submitCycleCountCallable as submitCycleCount,
  reconcileCycleCountCallable as reconcileCycleCount,
  cancelCycleCountCallable as cancelCycleCount,
} from "./cycleCount/cycleCountCallables";

// --- Supplier Master (DECISIONS #78): trusted Supplier command callables ---
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. NO UI wired to call them, NO App
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
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. NO UI wired to call them yet, NO
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
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. NO UI wired yet, NO App Check. Authorization enforced
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
export {
  createPartAliasCallable as createPartAlias,
  deactivatePartAliasCallable as deactivatePartAlias,
  reactivatePartAliasCallable as reactivatePartAlias,
  listPartAliasesCallable as listPartAliases,
  probePartAliasCallable as probePartAlias,
  // Phase G. Gated on `inventory.catalog.alias.read`, NOT on `inventory.catalog.manage` -- alias
  // lookup and alias administration have different audiences, and the read capability is registered
  // INERT and granted to nobody, so this denies for every principal until separately authorized.
  resolveScannedPartIdentifierCallable as resolveScannedPartIdentifier,
} from "./partMaster/partAliasCallables";

// --- Returns INTAKE (Scanner Phase Q; DECISIONS #118) ---
// Intake and disposition are SEPARATE authorities. This records that something came back and writes
// NO ledger event -- which is exactly why `RETURNED` still has no writer. Gated on
// inventory.returns.intake, registered INERT and granted to nobody. `inventory_returns` has no Rules
// match block, so it is deny-all to every client. EXPORT != DEPLOY.
export { recordReturnIntakeCallable as recordReturnIntake } from "./inventoryReturns/returnCallables";

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
export { installSerializedAssetCallable as installSerializedAsset } from "./equipmentInstall/installCallables";

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
export { acquireSerializedAssetCallable as acquireSerializedAsset } from "./serializedAsset/acquireCallables";

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
export {
  getInstallableEquipmentForWorkOrder,
  recordWorkOrderEquipmentInstallCallable as recordWorkOrderEquipmentInstall,
} from "./workOrderInstall/workOrderInstallCallables";

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
export {
  recordWorkOrderLaborCallable as recordWorkOrderLabor,
  correctWorkOrderLaborCallable as correctWorkOrderLabor,
  getWorkOrderLabor,
} from "./workOrderLabor/laborCallables";

// --- Descriptive bin registry (Scanner Phase K; DECISIONS #116) ---
// A bin describes WHERE stock sits inside a warehouse; the warehouse still owns it. These author no
// quantity and no ledger movement. Gated on inventory.location.bin.manage (write) and .read
// (resolve/list) -- two capabilities because a put-away operator needs the check without the ability
// to create racking. Both registered INERT and granted to nobody. `bins` has no Rules match block,
// so it is deny-all to every client; these run on the Admin SDK. EXPORT != DEPLOY.
export {
  createBinCallable as createBin,
  deactivateBinCallable as deactivateBin,
  reactivateBinCallable as reactivateBin,
  resolveBinCallable as resolveBin,
  listBinsCallable as listBins,
  // Scanner Phase L. Gated on inventory.placement.record -- its own capability. Writes a placement
  // record and nothing else: no ledger event, no quantity change, no balance (DECISIONS #116).
  recordPutAwayCallable as recordPutAway,
} from "./inventoryLocation/binCallables";

// --- Shared inventory BALANCE read (Scanner Phase H, general-purpose) ---
// Gated on `inventory.balance.read`, registered INERT and granted to nobody, so it denies for every
// principal until separately authorized. EXPORT != DEPLOY.
export { getPartBalanceCallable as getPartBalance } from "./inventory/partBalanceReadService";
// The BATCHED sibling, for a page of parts. Same capability, same pure composition; one set of
// reads instead of N. See partBalanceBatchReadService.ts for why the shared inputs dominate.
export { getPartBalancesCallable as getPartBalances } from "./inventory/partBalanceBatchReadService";

// --- Part↔Supplier procurement terms (part_supplier_items): trusted command callables ---
// Deployed to eos-platform-sandbox under the per-environment activation program; NOT deployed to the
// production project. NO UI wired yet, NO capability granted, NO App Check.
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

// CRM Activity / Notes (Taylor EOS Wave 7 extension, PART 1.4). EXPORT != DEPLOY, REGISTER != GRANT:
// exported for build/test only; `crm.activity.create` / `crm.activity.read` are both registered
// active:false and granted to NO Role -- nothing runs in production until a separate deploy + Owner
// grant + per-environment activation. `crm_activities` is Admin-SDK-only (no firestore.rules match block,
// default deny); these two trusted callables are the only read/write path.
export { createCrmActivity } from "./crmActivity/crmActivityCallables";
export { getCrmActivities } from "./crmActivity/crmActivityReadService";
