// THE SHELL'S CAPABILITY GATES, DECLARED ONCE — and the request set DERIVED from them.
//
// ═══════════════════ THE THIRD FAILURE MODE (P2-G, found by P3-A2) ═══════════════════
//
// A capability can fail to authorize a control in three distinct ways, and only two of them were
// named before tonight:
//
//   1. INACTIVE      — `active: false` in permissionCatalog.ts. The resolver returns DENY
//                      (inactivePermission) for every principal. Server-side, visible, deliberate.
//   2. NOT ACTIVATED — active for the catalog but not for THIS environment
//                      (capabilityActivationOverrides / config/environments.json). Also server-side.
//   3. UNASKED       — registered, activatable AND granted, and the control is still dead, because
//                      the CLIENT never asks the server about it. `buildHasCapability` answers from
//                      `feed.decisions[id]`, and the feed decides only the ids in the request set.
//                      An id nobody requested has no entry; `undefined !== true`, so the gate is
//                      `false` — correctly, fail-closed, permanently, for every principal in every
//                      environment, including one who genuinely holds the grant. No amount of
//                      granting or activating fixes it, and nothing in the server logs shows it,
//                      because the question was never put.
//
// Modes 1 and 2 are decisions. Mode 3 is a wiring defect that WEARS the appearance of a decision.
// The screen says "not available to you", the Role says the principal holds it, the resolver agrees
// — and they never meet.
//
// ═══════════════════ WHY THIS FILE EXISTS RATHER THAN TWO MORE HAND-ADDED IDS ═══════════════════
//
// This class of defect has now been found and hand-patched FOUR separate times, each time by
// appending ids to REPORT_CAPABILITY_REQUEST and writing a note saying it must not happen again:
// My Dashboard's six module ids, Data Import's two, Administration > Users' six, and Inbound Work /
// Email Connections' two. Each patch was correct and none of them stopped the next one, because the
// gates and the request set were two lists that a person had to keep equal by remembering to.
//
// So the request set is no longer a list beside the gates. It IS the gates: every surface below
// declares the ids the SHELL's `hasCapability` is consulted about, the components import those
// declarations instead of writing literals of their own, and REPORT_CAPABILITY_REQUEST is the union.
// Adding a gate now widens the request automatically; the only way back into mode 3 is to type a
// raw literal at a gate site, which test/capabilityRequestCoverage.test.mjs fails on by name.
//
// This is the shape metadata/definitions/accountPageComponents.js already proved:
// `ACCOUNT_PAGE_CAPABILITY_REQUEST = declaredPageCapabilities(accountRecordPage)` — "read directly
// off the definition — never a hand-typed list that could drift from what the page declares".
//
// ═══════════════════ SCOPE: THE SHELL FEED ONLY ═══════════════════
//
// These are the ids reached through `operationalContext.hasCapability`, i.e. useReportCapabilities.
// Surfaces that resolve their OWN request in their OWN call against their OWN accessVersion are
// deliberately NOT here (Opportunity, Sales Order, Sales Agreement, Inbound Work's action ids,
// Email intake's manage id, Equipment install, Serialized asset acquire, Work Order parts plan,
// the Account record page). Folding them in would make the shell ask for authority it does not use.
//
// ASKING IS NOT GRANTING, AND ASKING IS NOT ACTIVATING. Every id below is already registered and
// already held (or not) by exactly the principals that already hold (or do not hold) it. A
// principal without the grant gets `false` — from the server, on the evidence, rather than from an
// absent answer. That distinction is the whole point: mode 3 is indistinguishable from a denial
// until you ask.
import { REPORT_WAVE1_OBJECT_READ_CAPABILITIES, REPORT_DEFINITION_CAPABILITY_IDS } from "./reportAccess.js";
import { GOVERNED_SURFACE_CAPABILITY_IDS, DASHBOARD_MODULE_CAPABILITY_IDS } from "./governedSurfaceCapabilities.js";

/**
 * The scan ids the shell has always asked the Firebase feed about (the pre-P1-2
 * SCAN_WORKFLOW_CAPABILITY_IDS, verbatim). Nothing in the Scan workspace consults the shell's answer
 * for them any more; see SHELL_CAPABILITY_GATES.scanWorkflows.
 */
export const LEGACY_SHELL_SCAN_REQUEST_IDS = Object.freeze([
  "inventory.stock.receive",
  "inventory.transfer.dispatch",
  "inventory.transfer.receive",
  "inventory.cycleCount.create",
  "inventory.cycleCount.submit",
  "inventory.placement.record",
  "inventory.location.bin.read",
  "inventory.returns.intake",
  "inventory.stock.relocate",
]);

/**
 * Administration > Warehouse Racking (`/administration/warehouse-racking`).
 *
 * THE FIRST CONFIRMED MODE-3 HIT. AdminWarehouseRacking gates reading on
 * `inventory.location.bin.read` and EVERY write control — create, rename, retire, revive, and the
 * whole racking-generator apply path — on `inventory.location.bin.manage`. The read id rides in
 * through PLACEMENT_SURFACE_CAPABILITIES; the manage id was in no request set at all, so every
 * write control on that screen rendered `Ungated` for every principal in every environment,
 * including `inventoryBinAdministrator` — the Role that exists for nothing else and carries exactly
 * these two ids (access/governedBusinessRoles.ts, INVENTORY_BIN_ADMINISTRATOR_ROLE).
 *
 * `inventory.location.bin.manage` is deliberately still ABSENT from PLACEMENT_SURFACE_CAPABILITIES
 * and from WAREHOUSE_HANDHELD_CAPABILITIES, and that stays true: stowing stock all day must not
 * confer the authority to create and retire racking, and route visibility for the handheld is not
 * the same question as whether this administration screen's write controls are live. Requesting a
 * DECISION on an id is not the same as adding it to a surface's admission set.
 */
export const WAREHOUSE_RACKING_GATE = Object.freeze({
  read: "inventory.location.bin.read",
  manage: "inventory.location.bin.manage",
});

/**
 * Administration > Financial Policy (`/administration/financial-policy`).
 *
 * FOUND BY THIS LANE'S CENSUS, not reported by P3-A2, and the same defect exactly: AdminFinancialPolicy
 * gates the whole screen on `financialPolicy.profile.read` and every editing control on
 * `financialPolicy.profile.configure`, receives the SHELL's `hasCapability` (App.jsx), and neither id
 * was in any request set. `financialPolicy.profile.read` is granted to three governed Roles today
 * (governedBusinessRoles.ts); the screen told every one of them it was not available to them.
 */
export const FINANCIAL_POLICY_GATE = Object.freeze({
  read: "financialPolicy.profile.read",
  configure: "financialPolicy.profile.configure",
});

/**
 * Inventory > Part detail → "Used In Equipment" (domain/equipmentCompatibilitySection.js).
 *
 * ALSO FOUND BY THIS LANE'S CENSUS. PartDetail passes the shell's `hasCapability` to
 * UsedInEquipmentSection, which gates the section on `equipment.compatibility.view`; the id was in
 * no request set.
 *
 * THIS ONE IS HONESTLY OVERDETERMINED, and saying so is the point of separating the modes. It is
 * ALSO mode 1 (`active: false`) and ALSO effectively mode "ungranted" — the four
 * `equipment.compatibility.*` ids are deliberately excluded from equipmentCatalogAdministrator
 * (governedBusinessRoles.ts) because the D4 engine is a draft, so only ADMIN_ROLE's derived
 * whole-catalog grant reaches it. Fixing mode 3 here changes nothing an operator can see today, and
 * that is correct: the section stays dark because the SERVER says so, on the evidence, rather than
 * because nobody asked. When D4 is activated and granted, the control will work without a second
 * discovery of this same wiring defect.
 */
export const EQUIPMENT_COMPATIBILITY_GATE = Object.freeze({
  view: "equipment.compatibility.view",
});

/**
 * Inventory > Part detail → the ORDERED Reorder's "Void Purchase Order" control.
 *
 * VOID IS A MANAGEMENT EXCEPTION (Controller ruling 2026-09-28): it is offered to a holder of
 * reorder.purchaseOrder.void -- the Parts Manager by the ruled Administration grant -- not to the purchasing
 * assignee as such. The governed command decides the rest (the Purchase Order company's REORDER_QUEUE scope,
 * the ORDERED state, a stated reason); this gate only decides whether the control is offered.
 */
export const REORDER_PURCHASE_ORDER_VOID_GATE = Object.freeze({
  void: "reorder.purchaseOrder.void",
});

/**
 * Inventory > Part detail → the Reorder workflow cards' Approve / Reject / Assign / Cancel controls.
 *
 * Each is offered only to a holder of the capability its governed command enforces
 * (functions/src/eosOps/reorderLifecycleCommands.ts, reorderAssignmentAuthority.ts). The commands still
 * decide reach (queue scope, company, status); this gate only stops offering a control the server will
 * refuse (PL10, purchasing-loop proof 2026-10-19).
 */
export const REORDER_WORKFLOW_GATE = Object.freeze({
  approve: "reorder.request.approve",
  reject: "reorder.request.reject",
  assign: "reorder.request.assign",
  cancel: "reorder.request.cancel",
});

/**
 * UI PERMISSION PARITY (PERM-UI, 2026-10-19): create / edit controls that were offered to everyone while the server refused
 * non-holders. Each is offered only to a holder of the capability its governed command enforces; the server stays the
 * authority and still decides on every call.
 *
 *   Part Master        New Part / Edit            -> inventory.catalog.manage   (postgresPartMasterWriter createPart / updatePart)
 *                      Status                     -> inventory.catalog.part.activate (changePartStatus; GRANT-1 A1 split)
 *   Manufacturers      Status                     -> inventory.catalog.part.activate (changeManufacturerStatus; the same split key)
 *   Customers          New Customer               -> customer.record.create
 *   Equipment register Add Equipment tab / Edit   -> equipment.record.manage    (eosOps/equipmentOperations.ts)
 *   Equipment models   the Equipment Models tab   -> equipment.model.manage     (postgresEquipmentModelWriter)
 *
 * (Finance Record / Apply / Reconcile are not here: that workspace reads the server's own per-company advice,
 * readMyFinanceCompanyAccess.actions, which is already fail-closed and company-scoped.)
 */
export const PART_CATALOG_GATE = Object.freeze({
  manage: "inventory.catalog.manage",
  // GRANT-1 A1 SPLIT (Owner 2026-10-19): Part AND Manufacturer status run under their own EOS-only key (migration 1764670000000, asked under its own name
  // of the caller's EOS capability set); `inventory.catalog.activate` is now the Supplier status key only (SupplierAdministration), not asked by these screens.
  activate: "inventory.catalog.part.activate",
});
export const CUSTOMER_RECORD_GATE = Object.freeze({ create: "customer.record.create" });
export const EQUIPMENT_REGISTER_GATE = Object.freeze({ manage: "equipment.record.manage" });
export const EQUIPMENT_MODEL_GATE = Object.freeze({ manage: "equipment.model.manage" });

/**
 * Purchasing > Purchase Orders > Supplier purchase orders (P-1, DECISIONS #P-1; Owner ruling D). EOS-ONLY keys (no Firebase twin): asked under their own
 * names of the caller's EOS capability set (access/eosCapabilityAccess.js), registered by the P-1 migration. Each control is offered only to a holder of
 * the capability its governed command enforces (functions/src/eosOps/supplierPurchaseOrderAuthoring.ts); the server's own `allowed` flags then narrow it
 * by status and segregation of duties, and the command re-decides on every call.
 *
 *   read    the Supplier purchase orders view            -> supplier.purchaseOrder.read
 *   create  "Raise supplier purchase order"              -> supplier.purchaseOrder.create
 *   approve Approve (never the creator's own order)      -> supplier.purchaseOrder.approve
 *   send    Mark as sent to the supplier                 -> supplier.purchaseOrder.send
 *   cancel  Cancel (before anything is received)         -> supplier.purchaseOrder.cancel
 */
export const SUPPLIER_PURCHASE_ORDER_GATE = Object.freeze({
  read: "supplier.purchaseOrder.read",
  create: "supplier.purchaseOrder.create",
  approve: "supplier.purchaseOrder.approve",
  send: "supplier.purchaseOrder.send",
  cancel: "supplier.purchaseOrder.cancel",
  // Not a supplier key: the OTHER view on the same page (the Reorder purchase orders a buyer records). A supplier-only holder (Parts Associate, Parts Manager: they hold
  // supplier.purchaseOrder.read, not reorder.purchaseOrder.read) is shown the supplier view alone, never the recorded list the server would refuse.
  recordedRead: "reorder.purchaseOrder.read",
});

/**
 * Customers > Account > Accounts Receivable, for a role that holds no Finance workspace (A6, Owner 2026-10-19; migration 1764680000000). An EOS-ONLY key, asked
 * under its own name of the caller's EOS capability set (access/eosCapabilityAccess.js). A holder is shown the customer-balance SUMMARY (five numbers per company
 * and currency, readAccountBalanceSummary) and nothing else; the full receivable detail stays on finance.payment.read (finance.read in the Firebase feed). The
 * server decides the reach on every call.
 */
export const ACCOUNT_BALANCE_GATE = Object.freeze({ read: "finance.accountBalance.read" });

/**
 * Every gate the shell's `hasCapability` answers, by surface. The keys are documentation; the
 * union below is what is asked for.
 *
 * ORDER IS LOAD-BEARING ONLY FOR REVIEWABILITY: the four pre-existing groups come first and in
 * their original order, so the diff against the previous 44-id request reads as an append.
 */
export const SHELL_CAPABILITY_GATES = Object.freeze({
  // navConfig.js `capabilityAccess` on the Report Builder item.
  reportBuilder: REPORT_WAVE1_OBJECT_READ_CAPABILITIES,
  // navConfig.js `capabilityAccess` on Saved Reports + SavedReports.jsx's five per-action gates.
  savedReports: REPORT_DEFINITION_CAPABILITY_IDS,
  // navConfig.js / LandingPage.jsx route + nav visibility, and the per-action gates on Data Import
  // and Administration > Users. See governedSurfaceCapabilities.js for each entry's reasoning.
  governedSurfaces: GOVERNED_SURFACE_CAPABILITY_IDS,
  // domain/dashboardComposition.js module gates, via MyDashboard.jsx.
  dashboardModules: DASHBOARD_MODULE_CAPABILITY_IDS,
  // P1-2 (2026-10-13): the Scan workspace NO LONGER reads this feed -- its gates are answered by the
  // caller's EOS capability set (access/useInventoryScanCapabilities.js). This group is kept VERBATIM
  // (the pre-P1-2 scan ids) so the shell's request set is unchanged by a client-only repair; retiring
  // it is a separate Firebase-retirement step, not this one.
  scanWorkflows: LEGACY_SHELL_SCAN_REQUEST_IDS,
  // modules/administration/AdminWarehouseRacking.jsx.
  warehouseRacking: Object.freeze(Object.values(WAREHOUSE_RACKING_GATE)),
  // modules/administration/AdminFinancialPolicy.jsx.
  financialPolicy: Object.freeze(Object.values(FINANCIAL_POLICY_GATE)),
  // domain/equipmentCompatibilitySection.js, via PartDetail → UsedInEquipmentSection.
  equipmentCompatibility: Object.freeze(Object.values(EQUIPMENT_COMPATIBILITY_GATE)),
  // modules/inventory/PartDetail.jsx VoidPurchaseOrderAction.
  reorderPurchaseOrderVoid: Object.freeze(Object.values(REORDER_PURCHASE_ORDER_VOID_GATE)),
  // modules/inventory/PartDetail.jsx Reorder workflow cards.
  reorderWorkflow: Object.freeze(Object.values(REORDER_WORKFLOW_GATE)),
  // PERM-UI: PartMasterList, AccountsList, EquipmentWorkspace / EquipmentDetail.
  partCatalog: Object.freeze(Object.values(PART_CATALOG_GATE)),
  customerRecord: Object.freeze(Object.values(CUSTOMER_RECORD_GATE)),
  equipmentRegister: Object.freeze(Object.values(EQUIPMENT_REGISTER_GATE)),
  equipmentModel: Object.freeze(Object.values(EQUIPMENT_MODEL_GATE)),
  // P-1: modules/purchasing/SupplierPurchaseOrders.jsx (mounted by PurchaseOrders.jsx).
  supplierPurchaseOrder: Object.freeze(Object.values(SUPPLIER_PURCHASE_ORDER_GATE)),
  // A6: modules/accounts/AccountDetail.jsx (the Accounts Receivable summary).
  accountBalance: Object.freeze(Object.values(ACCOUNT_BALANCE_GATE)),
});

/**
 * The union, de-duplicated, first-occurrence order preserved.
 *
 * DE-DUPLICATION IS REQUIRED, NOT TIDINESS: the surfaces genuinely overlap (bin.read is both a
 * placement-surface id and a racking-screen id; every scan-workflow id but one already appears in a
 * governed-surface set), and a repeated id would be sent twice in one request for no decision.
 */
export const SHELL_GATED_CAPABILITY_IDS = Object.freeze([
  ...new Set(Object.values(SHELL_CAPABILITY_GATES).flat()),
]);
