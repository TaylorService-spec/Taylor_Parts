// Enterprise Access & Administration Platform (Issue #226) -- eight
// governed business Role definitions, added per Owner direction on
// Issue #226 (two comments dated 2026-07-16, main head
// `d4bae4b54496a515cf60cfc9018409559d98ea02`). Fixed by docs/
// specifications/enterprise-access-and-administration-platform.md §26
// and sequenced by docs/implementation-plans/enterprise-access-and-
// administration-platform.md §21 (Row 1a).
//
// These are NOT compatibility Roles -- see compatibilityRoles.ts for
// the three seeded `admin`/`dispatcher`/`technician` Roles that
// reproduce today's raw-role matrix exactly and serve as the shadow-
// mode parity oracle (Spec §7/§18). Deliberately kept in a SEPARATE
// module so this file's inert, new-capability content never blurs that
// file's own narrow, byte-for-byte-reproduction scope.
//
// PURE, dependency-free data module, same posture as
// compatibilityRoles.ts: declaring these Role objects grants nothing to
// anyone. No Rule/Function/claim reads this yet; `AdminRolesPermissions.jsx`'s
// ASSIGNABLE_ROLES still derives from COMPATIBILITY_ROLES only (Spec
// §26.3). Every Permission id referenced below already exists in
// permissionCatalog.ts -- this file registers no new capability id;
// where a role's stated mapping principle names a capability with no
// existing id, that is recorded as a catalog gap in Spec §26.4, not
// granted here via a substitute id (see that section for the full list).
//
// SHARED EOS ACCESS CONTRACT. This module exists in both the Functions and
// frontend packages because there is no shared-module tooling in this repo. It is
// maintained as ONE canonical source and mechanically synchronized by
// scripts/syncAccessContracts.mjs -- never by hand-editing two copies.
import type { Role } from "../types/access";
import { ADMIN_ROLE } from "./compatibilityRoles";
import { PERMISSION_CATALOG } from "./permissionCatalog";

// Spec §26.2: Owner's own grant is defined as "every id ADMIN_ROLE
// holds" rather than a hand-copied list, so the two can never silently
// drift apart if ADMIN_ROLE's own grant set is ever revised.
//
// Issue #325 / ADR-007: Owner ADDITIONALLY holds every ACTIVE `report.*`
// capability the catalog currently registers -- derived from
// permissionCatalog.ts, not hand-listed, so this can never silently
// drift from D-226's own registration and automatically picks up each
// later wave's additions without a code change here. Two waves
// contribute ids as of this comment:
//   - W1 (4 object-level `report.<object>.read` + 27 active field-level
//     `report.<object>.field.<id>.read` ids -- customer/contact/
//     location/equipment).
//   - W-SAVE (5 saved-definition CRUD ids: `report.definition.
//     {create,read,rename,duplicate,delete}` -- enforced exclusively
//     through the trusted saved-definition service,
//     functions/src/reporting/savedDefinitionCommands.ts; firestore.
//     rules denies ALL direct client read/write on reportDefinitions
//     unconditionally, so holding these ids confers nothing outside
//     that service).
// `active:false` ids (customer.notes/accountOwner, location.accessNotes
// -- security-text/employee-sensitivity fields pending their own later
// review/wave, per D-226's own catalog comment) are deliberately
// EXCLUDED from this list, not merely relied on to deny via the
// resolver's own active check: Owner's catalog membership should
// reflect exactly what's currently reportable, not carry ids that
// aren't yet meaningfully grantable. This is the ONLY Role (of all
// eleven -- three compatibility, eight governed business) that holds
// any report.* id; admin/dispatcher/technician and the other seven
// governed business Roles are byte-unchanged by this addition (see the
// dedicated tests) -- "only the approved W-SAVE role" (Owner) holds the
// five new ids, per this task's own explicit requirement.
const OWNER_ACTIVE_REPORT_PERMISSIONS = PERMISSION_CATALOG.filter(
  (p) => p.id.startsWith("report.") && p.active !== false,
).map((p) => p.id);

const OWNER_PERMISSIONS = [...ADMIN_ROLE.permissions, ...OWNER_ACTIVE_REPORT_PERMISSIONS];
const OWNER_CONDITIONS = ADMIN_ROLE.conditionsByPermission;

// Spec §26.2 -- least-privilege baseline. Deliberately zero permissions:
// "grants no broad domain access by title alone" is satisfied by an
// empty grant set, not by a narrowed-but-nonempty one.
export const GENERAL_EMPLOYEE_ROLE: Role = Object.freeze({
  id: "generalEmployee",
  name: "General Employee",
  description:
    "Least-privilege governed baseline Role. Grants no domain capability by itself -- every further capability comes from an explicit additional Role assignment.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

// Spec §26.2 -- office/customer/service coordination; explicitly no
// governed-field (financial) write and no lifecycle-execution ids
// (transition/cancel), only creation/coordination.
export const OFFICE_MANAGER_ROLE: Role = Object.freeze({
  id: "officeManager",
  name: "Office Manager",
  description:
    "Office/customer/service coordination: Customer record read/create/update and Work Order creation. No governed-field write, no Work Order lifecycle execution, no role administration.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "account.record.read",
    "account.record.create",
    "account.record.update",
    "workOrder.create",
  ],
}) as Role;

// Spec §26.2 -- Customer/CRM coverage from the existing catalog only;
// quote/sales-pipeline/reporting capabilities are a recorded catalog
// gap (Spec §26.4), not granted here.
// MARKETING -- Owner ruling 2026-08-19: "need a marketing top top equal to salesManager".
// A top-level commercial position, peer to Sales Manager rather than reporting through it
// (roleHierarchy.ts places both directly under admin), which is what "equal to" fixes: on
// the same level, Marketing neither sees into Sales' people nor sits beneath them.
//
// GRANTED WHAT EXISTS, WHICH IS LESS THAN THE MATRIX ASKS FOR. The CRUD matrix gives
// Marketing CRED over "Marketing Initiatives", and NO marketing capability exists in the
// permission catalog at all -- there is no id to grant. Creating the Role with the reads it
// can actually hold is honest; inventing a capability the engine does not enforce would
// produce a Role that looks authorized and is not. Marketing Initiatives is recorded as a
// catalog gap alongside Commissions, Technician Time and Notifications.
//
// Contacts and Customer Locations, which the matrix also gives Marketing, are governed by
// firestore.rules today and have no capability either -- so they are not expressible here.
export const MARKETING_MANAGER_ROLE: Role = Object.freeze({
  id: "marketingManager",
  name: "Marketing Manager",
  description:
    "Top-level Marketing position, peer to Sales Manager. Read visibility across Customers, Opportunities and Sales Orders for segmentation and campaign targeting. Marketing Initiative capabilities are a recorded permission-catalog gap -- no marketing.* id exists to grant.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    // Owner ruling 2026-08-18, "they all should see accounts".
    "account.record.read",
    "opportunity.read",
    "salesOrder.read",
  ],
}) as Role;

// PURCHASING MANAGER -- Owner roster 2026-08-20 (Tom; Erik holds it as a second role
// alongside Accounting Manager).
//
// Carries the purchasing WORKFLOW, which is a sequence rather than one write: see what needs
// buying, take it into purchasing, record the resulting Purchase Order, keep it current.
// Granting create without the queue read would produce a buyer who cannot see what needs
// buying.
//
// Reads mirror the CRUD matrix's Purchasing row -- it must see the catalog, stock, transfers
// and serialized assets it is buying against, and the AR side of what it commits.
//
// THREE OMISSIONS, EACH A DECISION:
//   - reorder.request.approve / .reject: whoever raises an order must not approve it. The
//     matrix's own segregation-of-duties principle, applied to the role that raises them.
//   - reorder.purchaseOrder.void: carries an isOwnAssignment Condition everywhere it is
//     held; granting it unconditioned here would exceed admin's own authority.
//   - No finance WRITE. The matrix gives Purchasing read-only on Invoices/AR.
export const PURCHASING_MANAGER_ROLE: Role = Object.freeze({
  id: "purchasingManager",
  name: "Purchasing Manager",
  description:
    "Procurement authority: raises and maintains Purchase Orders through the governed reorder workflow, with read visibility across catalog, stock, transfers, serialized assets and AR. Cannot approve or void what it raises.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    // Owner ruling 2026-08-18, "they all should see accounts".
    "account.record.read",
    "salesOrder.read",
    // The purchasing workflow itself.
    "reorder.purchaseOrder.read",
    "reorder.purchaseOrder.create",
    "reorder.request.read.queue",
    "reorder.request.startPurchasing",
    "reorder.request.recordPurchaseOrder",
    "reorder.request.postPurchasingUpdate",
    // Buying context: what is in the catalog, what is on hand, what is moving.
    "inventory.catalog.read",
    "inventory.transaction.read",
    "inventory.action.read",
    "warehouse.transferOrder.read",
    "inventory.serializedAsset.read",
    // Invoices/AR read only, per the matrix's Purchasing row.
    "finance.read",
  ],
}) as Role;

// SHOP MANAGER -- Owner roster 2026-08-20 (Willie).
//
// GRANTED NOTHING, DELIBERATELY. The roster names the position and the CRUD matrix's
// User-to-Role sheet describes it in Service terms, but the matrix's Role x Object grid has
// NO Shop Manager row -- there is no stated authority to implement.
//
// The alternative was to copy Service Manager's grants on the strength of a similar
// description. That would be inventing authority the business has not specified, and an
// invented grant is indistinguishable from a decided one once it is in the file. An empty
// Role is honest: the position exists, is assignable, and holds nothing until the matrix
// says what it holds. Same posture as the other org-chart positions awaiting a row.
export const SHOP_MANAGER_ROLE: Role = Object.freeze({
  id: "shopManager",
  name: "Shop Manager",
  description:
    "Service-organization position from the Owner roster. Carries no permissions of its own: the CRUD matrix names the role but declares no Role x Object row for it, and authority is not inferred from a job description.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

export const SALES_MANAGER_ROLE: Role = Object.freeze({
  id: "salesManager",
  name: "Sales Manager",
  description:
    "Customer/CRM read/create/update. Quote, sales-pipeline, and reporting capabilities are a recorded permission-catalog gap (Spec §26.4), not yet grantable.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "account.record.read",
    "account.record.create",
    "account.record.update",
    // Owner ruling 2026-08-18: a Sales Manager who cannot see the committed order
    // their pipeline produced, or whether the parts exist to fill it, is reading
    // only half the transaction. salesOrder.read is registered active:false -- the
    // grant is recorded now and stays inert until per-environment activation.
    "salesOrder.read",
    "inventory.transaction.read",
    // Owner ruling 2026-08-19: Sales Manager holds full opportunity authority.
    // opportunity.write covers create AND edit -- the catalog registers no separate
    // update or delete id, so "CRUD" on an Opportunity is exactly these two ids.
    //
    // Both are registered active:false, so this is a GRANT, not activation. They
    // resolve only where a per-environment override activates them, which today is
    // eos-platform-sandbox alone; production stays denied.
    //
    // opportunity.createSalesOrder is deliberately NOT included. Converting a WON
    // Opportunity into a Sales Order creates a DIFFERENT object with its own
    // commercial commitment, and the ruling was about opportunities. Adding it is a
    // one-line change if that is wanted; guessing it in would be scope the Owner
    // did not ask for.
    "opportunity.read",
    "opportunity.write",
  ],
}) as Role;

// Spec §26.2 -- the individual contributor the Sales Manager is over. Created
// 2026-08-19 on the Owner's clarification that "salesManager and Sales are
// different -- the manager is over the salesperson".
//
// ITS CAPABILITIES ARE IDENTICAL TO SALES MANAGER'S TODAY, deliberately, and that
// is worth stating rather than hiding: the difference between the two Roles is
// ORGANISATIONAL, not authorizational. A manager currently holds no authority over
// their reports' records, because "a manager sees their team's work" requires the
// coverage/territory model the Owner explicitly deferred ("record and preserve the
// seams, do NOT build during the runway"). Giving salesManager a wider grant here
// would be building that model by accident, one capability at a time.
//
// The same pattern already exists in this file: accountingManager and financeManager
// are intentionally identical (DECISIONS #114). Two Roles that resolve the same way
// are not a defect when the distinction they encode is real and the authority
// difference has not been designed yet.
export const SALESPERSON_ROLE: Role = Object.freeze({
  id: "salesperson",
  name: "Salesperson",
  description:
    "Individual sales contributor: Customer read/create/update and full Opportunity authority, plus read visibility of the committed order and of stock. Identical in capability to Sales Manager today -- the manager relationship is organisational and confers no additional authority until the deferred coverage/territory model lands.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "account.record.read",
    "account.record.create",
    "account.record.update",
    "salesOrder.read",
    "inventory.transaction.read",
    "opportunity.read",
    "opportunity.write",
  ],
}) as Role;

// Spec §26.2 -- invoice/payment/credit/accounting-reporting capabilities
// still do not exist in the catalog (Spec §26.4).
//
// OWNER REVERSAL 2026-08-18: "accountingManager should be like financeManager
// for now." This DELIBERATELY supersedes the earlier Owner requirement that the
// two Roles "remain distinct". That distinction was drawn from the one id that
// happened to differentiate them, not from a described difference in the two
// jobs, and the Owner has since decided they do the same work here. The two sets
// are now intentionally identical, and the pinning test was inverted to assert
// exactly that -- so a future divergence has to be a decision, not a drift.
export const ACCOUNTING_MANAGER_ROLE: Role = Object.freeze({
  id: "accountingManager",
  name: "Accounting Manager",
  description:
    "Customer visibility, governed commercial-field write, Sales Order and Purchase Order read. Intentionally identical to Finance Manager (Owner ruling 2026-08-18). Invoice/payment/credit/accounting-reporting capabilities are a recorded permission-catalog gap (Spec §26.4).",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "account.record.read",
    "account.governedField.write",
    "salesOrder.read",
    "reorder.purchaseOrder.read",
    // PURCHASING MOVED OFF THIS ROLE on 2026-08-20, to PURCHASING_MANAGER_ROLE.
    //
    // The 2026-08-19 ruling "Purchasing falls under accounting" was implemented by granting
    // the purchasing workflow here, because no Purchasing role existed to receive it. The
    // Owner's roster then named Purchasing Manager AND assigned Erik BOTH Accounting Manager
    // and Purchasing Manager.
    //
    // That honors both statements better than merging the bundles did: purchasing reports
    // into accounting THROUGH THE PERSON, while the authority sits on the role whose job it
    // is. Anyone who needs both holds both -- which is exactly what a stacked assignment is
    // for, and it keeps a pure Accounting Manager from silently acquiring buying power.
  ],
}) as Role;

// Spec §26.2 -- financial oversight/policy authority via the one
// existing id that concretely matches ("account.governedField.write",
// Issue #175's admin-only commercial-terms/tax-status field), distinct
// from Accounting Manager's operational read-only grant. Margin/cost
// visibility and finance-specific reporting are a recorded catalog gap
// (Spec §26.4).
export const FINANCE_MANAGER_ROLE: Role = Object.freeze({
  id: "financeManager",
  name: "Finance Manager",
  description:
    "Financial oversight/policy: Customer read visibility, governed commercial-field write authority (Issue #175), and both sides of the committed-money picture -- Sales Orders out, Purchase Orders in. Margin/cost visibility and finance-specific reporting are a recorded permission-catalog gap (Spec §26.4). Intentionally identical to Accounting Manager (Owner ruling 2026-08-18).",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "account.record.read",
    "account.governedField.write",
    // Owner ruling 2026-08-18: finance sees what was committed to customers and
    // what was committed to suppliers. READ on both -- no create/void on either
    // side. salesOrder.read is active:false and stays inert until activation.
    "salesOrder.read",
    "reorder.purchaseOrder.read",
  ],
}) as Role;

// Spec §26.2 -- full existing Work Order lifecycle authority
// (technicians/dispatch/Work Orders) plus field-inventory read
// visibility. Deliberately excludes reorder.*/inventory.action.* --
// reorder/purchasing execution authority stays with the Roles Issue
// #100 already scopes it to (expressed as Conditions on `technician`,
// Spec §9), not duplicated here as an unconditioned grant. Equipment
// capabilities are a recorded catalog gap (Spec §26.4).
export const FIELD_MANAGER_ROLE: Role = Object.freeze({
  // THE ID STAYS "fieldManager"; ONLY THE LABEL CHANGES. Owner ruling 2026-08-19:
  // "service Manager is fieldManager" -- the business calls this position Service
  // Manager, and the CRUD matrix lists it under that name. The id is load-bearing in a
  // way the label is not: it is what live role assignments, roleHierarchy.ts and the
  // access audit trail all reference, so renaming it would orphan every existing grant
  // to silently rename a job title. The name is what people read; the id is what the
  // system resolves. They are allowed to differ, and here they must.
  id: "fieldManager",
  name: "Service Manager",
  description:
    "Service Manager (id `fieldManager`). Technicians/dispatch/Work Orders: full Work Order lifecycle authority plus field-inventory read visibility. Equipment capabilities are a recorded permission-catalog gap (Spec §26.4).",
  systemSeed: true,
  compatibility: false,
  permissions: [
    // Owner ruling 2026-08-18, "they all should see accounts": every manager Role
    // gets Customer read. A Work Order without its customer is an address.
    "account.record.read",
    "workOrder.create",
    "workOrder.transition",
    "workOrder.cancel",
    "inventory.transaction.read",
    // Owner ruling (grantable-governed-roles workstream): Field Manager is one of the five roles
    // named in Owner's proposed fulfillment.coordinatedVisit.read grant set ({owner, admin,
    // operationsManager, fieldManager, dispatcher}) -- Coordinated Visits/Mission are a field/
    // dispatch operational surface, matching this Role's existing Work Order lifecycle authority.
    // Still active:false (grant is not activation); see compatibilityRoles.ts's own comment.
    "fulfillment.coordinatedVisit.read",
    // Catalog curation -- Owner ruling 2026-08-19. A field/service manager standing in front
    // of a machine is the highest-volume place a new Part gets created, and therefore the
    // likeliest source of duplicate catalog rows: TST-1234 vs "TST 1234" vs "Compressor Assy"
    // as three separate Parts, with stock, purchase history and Work Order usage split across
    // all three, and every resulting count wrong.
    //
    // That risk was raised before this grant and the Owner ruled all three management Roles
    // hold it, with duplicate detection starting immediately as the mitigation rather than the
    // grant waiting on it. Recorded here so the sequencing stays visible: the inlet was opened
    // deliberately, on the stated condition that the defence follows.
    //
    // MANAGE only, NOT inventory.catalog.activate -- lifecycle status stays with
    // inventoryCatalogAdministrator.
    "inventory.catalog.manage",
  ],
}) as Role;

// Spec §26.2/§27.4 -- cross-domain operational oversight (Customer,
// Service, Inventory, Warehouse, Purchasing) via read-heavy grants plus
// Work Order lifecycle authority. Deliberately excludes
// account.record.create/update (oversight is not direct customer-
// editing authority in this conservative reading),
// account.governedField.write, and every admin.*/reorder.request.assign/
// approve/reject/cancel id ("no automatic role administration"). The
// three warehouse.*.read ids (Spec §27.2) close the Warehouse-specific
// catalog gap §26.4 originally recorded here.
export const OPERATIONS_MANAGER_ROLE: Role = Object.freeze({
  id: "operationsManager",
  name: "Operations Manager",
  description:
    "Cross-domain operational oversight across Customer, Service, Inventory, Warehouse, and Purchasing. Can open a Customer record but not amend one. No role administration, no governed-field write, no reorder decision authority.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "account.record.read",
    // Owner ruling 2026-08-18: "operationsManager should be able to create accounts also".
    // CREATE only -- account.record.update and account.governedField.write stay DENIED, so
    // this Role can open a new Customer but cannot amend an existing one. That asymmetry is
    // intentional and pinned by test; it is not an oversight to be "completed" later.
    "account.record.create",
    "workOrder.create",
    "workOrder.transition",
    "workOrder.cancel",
    "inventory.transaction.read",
    "inventory.action.read",
    "reorder.request.read.queue",
    "reorder.purchaseOrder.read",
    "warehouse.record.read",
    "warehouse.stockLocation.read",
    "warehouse.transferOrder.read",
    // Owner ruling (grantable-governed-roles workstream): Operations Manager is one of the five
    // roles named in Owner's proposed fulfillment.coordinatedVisit.read grant set ({owner, admin,
    // operationsManager, fieldManager, dispatcher}) -- cross-domain operational oversight is
    // exactly the reader this coordinated-Work-Order projection is for. Still active:false (grant
    // is not activation); see compatibilityRoles.ts's own comment.
    "fulfillment.coordinatedVisit.read",
    // Catalog curation -- Owner ruling 2026-08-19, same ruling that granted it to admin.
    // Cross-domain operational oversight includes fixing a wrong Part or Manufacturer
    // record rather than escalating it to whoever holds inventoryCatalogAdministrator.
    //
    // MANAGE only, NOT activate: lifecycle status stays with inventoryCatalogAdministrator.
    // This Role already holds inventory.transaction.read and inventory.action.read, and
    // catalog READ resolves for it through the compatibility layer, so the curation pair is
    // coherent.
    //
    // DELIBERATELY NOT granted to fieldManager. The Owner held that one back: catalog.manage
    // mints canonical Parts, and a field/service role creating new Part records at the point
    // of a repair is how duplicate catalog rows start. There is no duplicate detection in
    // this system today, so the inlet stays closed until there is. Revisit with dedup, not
    // before.
    "inventory.catalog.manage",
  ],
}) as Role;

// === ORG-CHART POSITIONS (Owner chart, 2026-08-19) ==========================
//
// Seven Roles that exist so the organisation chart is fully expressible in
// functions/src/access/roleHierarchy.ts. Every one of them ships with NO
// permissions.
//
// That is deliberate, not an oversight. A Role's POSITION and a Role's AUTHORITY
// are separate systems here: position decides whose work you can see, permissions
// decide what you can do. Inventing capability sets for seven Roles at once would
// be guessing at seven business decisions the Owner has not made, and every guess
// would be live authority. An empty Role grants nothing and denies nothing that
// was not already denied -- so these can be assigned today for their hierarchy
// effect, and their capabilities granted later, one Owner ruling at a time.
//
// A NAME COLLISION WORTH UNDERSTANDING. warehouseManager, partsManager and
// partsAssociate already exist as OPERATIONAL ROLES on the employee record
// (WAREHOUSE_MANAGER / PARTS_MANAGER / PARTS_ASSOCIATE, domain/constants.js).
// Those are operational QUALIFICATIONS -- "is this person trained and assigned to
// run a warehouse" -- and this platform deliberately keeps them separate from
// security authorization (Spec §9). The Roles below are the SECURITY side of the
// same job title. They are not the same object, they are not interchangeable, and
// one does not imply the other. Holding the operational role still drives the
// operational-role home screens exactly as before; holding the governed Role adds
// a position in the visibility tree.

export const GENERAL_MANAGER_ROLE: Role = Object.freeze({
  id: "generalManager",
  name: "General Manager",
  description:
    "Org-chart position in the top block, between Owner and the branch heads. Carries no permissions of its own -- its effect is hierarchical visibility over every branch. Capability grants are a separate Owner decision.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

export const WAREHOUSE_MANAGER_ROLE: Role = Object.freeze({
  id: "warehouseManager",
  name: "Warehouse Manager",
  description:
    "Org-chart position: head of the warehouse branch under Operations, with Warehouse Associates beneath. Distinct from the WAREHOUSE_MANAGER operational role on the employee record, which is an operational qualification rather than a security Role. Carries no permissions of its own.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

export const WAREHOUSE_ASSOCIATE_ROLE: Role = Object.freeze({
  id: "warehouseAssociate",
  name: "Warehouse Associate",
  description:
    "Org-chart position beneath the Warehouse Manager. Carries no permissions of its own.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

export const PARTS_MANAGER_ROLE: Role = Object.freeze({
  id: "partsManager",
  name: "Parts Manager",
  description:
    "Org-chart position: head of the parts branch under Operations, with Parts Associates beneath. Distinct from the PARTS_MANAGER operational role on the employee record. Carries no permissions of its own.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

export const PARTS_ASSOCIATE_ROLE: Role = Object.freeze({
  id: "partsAssociate",
  name: "Parts Associate",
  description:
    "Org-chart position beneath the Parts Manager. Distinct from the PARTS_ASSOCIATE operational role on the employee record. Carries no permissions of its own.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

export const CONTROLLER_ROLE: Role = Object.freeze({
  id: "controller",
  name: "Controller",
  description:
    "Org-chart position beneath the Finance Manager, alongside Accounting. Carries no permissions of its own -- financial authority is granted separately and deliberately.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

export const SUPPORT_STAFF_ROLE: Role = Object.freeze({
  id: "supportStaff",
  name: "Support Staff",
  description:
    "Org-chart position beneath Accounting. Carries no permissions of its own.",
  systemSeed: true,
  compatibility: false,
  permissions: [],
}) as Role;

// Spec §26.2 -- privileged full-platform Role. Matches ADMIN_ROLE's
// exact grant rather than inventing a broader one: "privileged/full-
// access but never a security bypass" is satisfied by holding the same
// audited, Condition-gated grant `admin` already holds, through the
// same resolver (resolveEffectivePermission.ts), not a special-cased
// escape hatch. `privileged: true` (same as ADMIN_ROLE) means grant/
// revoke requires a second, distinct approver (Spec §15) -- Owner is
// never single-admin-assignable.
export const OWNER_ROLE: Role = Object.freeze({
  id: "owner",
  name: "Owner",
  description:
    "Privileged full-platform Role. Holds every capability the admin compatibility Role holds, through the same governed resolver, Scope, Condition, and audit path -- never a bypass -- PLUS every active wave-1 report.* object/field capability (Issue #325 W1), which admin itself does not hold. The only Role with report access today.",
  systemSeed: true,
  compatibility: false,
  privileged: true,
  permissions: OWNER_PERMISSIONS,
  conditionsByPermission: OWNER_CONDITIONS,
}) as Role;

// INV-1 Post-Phase-1 -- temporary, execution-scoped Role for the approved
// 190-Part CREATE run (Decision #42; CREATE Execution Authorization gate).
// NOT one of Spec §26's eight business-oversight Roles: it exists solely to
// make `inventory.catalog.manage` grantable to the approved operator for the
// ONE approved CREATE execution, then be revoked immediately after execution
// and reconciliation. Least privilege by construction: carries ONLY
// `inventory.catalog.manage` (create/edit canonical Part records through the
// trusted Part Master service) -- deliberately NOT `inventory.catalog.
// activate` (lifecycle changes remain a separate step) and no other id.
// `privileged: false` per the Privileged Approval Scope Correction
// (docs/governance/privileged-approval-classification.md): two-person
// approval is reserved for capabilities that can materially administer
// security/access policy, grant platform/security-admin authority, change
// role/permission definitions or tenant isolation, deploy/weaken security
// enforcement, bypass trusted-command authorization, or alter/suppress audit
// evidence. `inventory.catalog.manage` is ordinary OPERATIONAL authority
// (create/edit descriptive Part records through the trusted service) -- it
// administers no security, grants no admin authority, changes no policy, and
// cannot touch audit integrity -- so it requires ONE authorized Owner/admin
// plus append-only audit, not a second approver. Least privilege is
// unchanged: carries ONLY `inventory.catalog.manage` (NOT `inventory.
// catalog.activate`, no other id). Declaring this object grants nothing: a
// principal gains the capability only when a governed, audited roleAssignment
// (functions/src/access/trustedWriterCommands.ts) assigns them this roleId,
// and loses it the instant that assignment is revoked (revoke after CREATE
// execution and reconciliation).
export const INVENTORY_CREATE_EXECUTOR_ROLE: Role = Object.freeze({
  id: "inventoryCreateExecutor",
  name: "Inventory CREATE Executor (temporary)",
  description:
    "Temporary execution-scoped Role for the approved Part Master CREATE run (INV-1, Decision #42). Grants only inventory.catalog.manage (operational authority -- single-approver + audited, not two-person); assigned to the approved operator for one CREATE execution and revoked immediately after execution and reconciliation.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["inventory.catalog.manage"],
}) as Role;

// Durable catalog/reference-data administrator -- Option A of the accepted
// role design in docs/releases/supplier-master-promotion-package.md §A
// ("Adopt Option A"), referenced as accepted by the Part Master RC
// (docs/releases/part-master-write-rc.md §"Exact production delta" item 2),
// the Manufacturer RC, and the three catalog sandbox-handoff docs. Until now
// the design existed only in prose and in `// future inventoryCatalogAdministrator`
// comments in index.ts / partMasterCallables.ts / manufacturerCallables.ts /
// partSupplierItemCallables.ts, so there was no Role object to assign to
// anyone -- the catalog write callables were unreachable by construction
// rather than merely ungranted.
//
// One catalog authority, not three: `inventory.catalog.manage` +
// `inventory.catalog.activate` govern ALL catalog reference data -- Parts,
// Manufacturers, and (reused per DECISIONS #78) Suppliers. A supplier-only
// or part-only role would fragment a single authority and mint symmetry-only
// structure; §A rejects that explicitly.
//
// Least privilege, exactly two ids and nothing else. The pair is one coherent
// resource authority (`resource: "inventory.catalog"`, actions `manage` +
// `activate`), so granting both to one purpose-built role is the minimal
// auditable unit. Catalog write deliberately stays OFF `admin`/`owner`
// (see the `inventoryCreateExecutor` rationale above): catalog write is a
// specific operational authority, not a title-based one.
//
// Durable, unlike `inventoryCreateExecutor` -- that role is execution-scoped,
// `.manage`-only, and revoked after one approved CREATE run. This one is a
// standing role for ongoing catalog administration, and carries `.activate`
// (lifecycle status changes) which the executor deliberately does not.
//
// `privileged: false` per docs/governance/privileged-approval-classification.md,
// on the same reasoning recorded for `inventoryCreateExecutor`: catalog write
// administers no security/access policy, grants no admin authority, changes no
// role/permission definition or tenant isolation, bypasses no trusted-command
// authorization, and cannot alter or suppress audit evidence. It is ordinary
// operational authority -- one authorized approver plus append-only audit,
// not two-person approval.
//
// Mints NO new capability id, so it stays consistent with R-1 convergence:
// R-1 governs how capabilities map to Roles, and this is a clean
// single-resource Role with nothing for convergence to retire.
//
// DECLARING THIS OBJECT GRANTS NOTHING. A principal gains these capabilities
// only through a governed, audited `roleAssignments/{id}` write via the access
// command path (functions/src/access/trustedWriterCommands.ts), which bumps
// `accessVersion` and syncs claims. §A names that grant as "the protected
// grant action" -- it is a separate authorization from this definition, and no
// grant is performed here, in any environment.
export const INVENTORY_CATALOG_ADMINISTRATOR_ROLE: Role = Object.freeze({
  id: "inventoryCatalogAdministrator",
  name: "Inventory Catalog Administrator",
  description:
    "Durable least-privilege Role for governed catalog reference data: reading the governed catalog, creating and curating Parts, Manufacturers and Suppliers, and changing their lifecycle status. Carries exactly inventory.catalog.read + inventory.catalog.manage + inventory.catalog.activate and nothing else. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  // inventory.catalog.read ADDED 2026-08-16 (Owner decision). Live E2E: partsManager could open the
  // catalog surface and then got HTTP 403 from getManufacturerCatalog -- correct enforcement of the
  // Role as written, but the Role scope was operationally incomplete. A principal authorized to
  // MANAGE and ACTIVATE governed catalog data must be able to READ the catalog required to do that
  // work; curating a Part against a manufacturer list you cannot see is not a coherent authority.
  //
  // Deliberately narrow: the catalog read ONLY. This confers no stock, transfer, cycle-count,
  // receiving or transaction read authority, and the Role stays privileged:false -- it administers
  // reference data, not access. No admin/owner bypass is involved: admin already resolves this id
  // through its own compatibility grant, unchanged by this edit.
  permissions: ["inventory.catalog.read", "inventory.catalog.manage", "inventory.catalog.activate"],
}) as Role;

// Work Order parts planner -- the durable least-privilege Role for the governed WO parts-planning
// producer (setWorkOrderPartsPlan, capability workOrder.parts.plan).
//
// WHY THIS EXISTS. The capability was registered active:false and carried by NO Role, so there was
// literally nothing to grant: the planning UI shipped and activated but every principal resolved
// DENY, with no assignable Role to fix it. Defining the Role is what makes the grant possible; it is
// not itself a grant.
//
// Least privilege: exactly one capability id. Planning is not reserving and not consuming -- this
// Role confers no inventory movement, no reservation, and no execution authority, matching the
// command's own PLAN != RESERVE != USE invariant.
//
// `privileged: false` per docs/governance/privileged-approval-classification.md, on the same
// reasoning recorded for inventoryCreateExecutor and inventoryCatalogAdministrator: planning parts
// administers no security/access policy, grants no admin authority, changes no role/permission
// definition, bypasses no trusted-command authorization, and cannot alter or suppress audit
// evidence. Ordinary operational authority -- one authorized approver plus append-only audit.
//
// DECLARING THIS OBJECT GRANTS NOTHING. A principal holds it only through a governed, audited
// roleAssignments write, which bumps accessVersion and syncs claims.
export const WORK_ORDER_PARTS_PLANNER_ROLE: Role = Object.freeze({
  id: "workOrderPartsPlanner",
  name: "Work Order Parts Planner",
  description:
    "Durable least-privilege Role for planning parts on a Work Order through the governed setWorkOrderPartsPlan command. Carries exactly workOrder.parts.plan and nothing else: planning is not reserving and not consuming. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["workOrder.parts.plan"],
}) as Role;

// CRM activity contributor -- the durable least-privilege Role for the CRM Activity authority
// (crm.activity.create + crm.activity.read).
//
// Same situation as above: both capabilities were registered active:false and carried by NO Role, so
// the Activity & Notes surface could ship, activate, and still deny everyone.
//
// The two ids are kept as separate capabilities deliberately, so a future read-only Role remains
// possible without redefining the authority. This Role holds both because a salesperson who records
// interaction history necessarily also reads it; a read-only variant is a separate future Role, not a
// reason to fragment this one now.
//
// Least privilege: exactly these two ids. It confers no Account, Opportunity or Sales Order write
// authority -- the activity record references those objects and never restates or mutates them.
//
// `privileged: false` on the same reasoning as its siblings. DECLARING THIS OBJECT GRANTS NOTHING.
export const CRM_ACTIVITY_CONTRIBUTOR_ROLE: Role = Object.freeze({
  id: "crmActivityContributor",
  name: "CRM Activity Contributor",
  description:
    "Durable least-privilege Role for recording and reading governed CRM activity/notes on an Account. Carries exactly crm.activity.create + crm.activity.read and nothing else; it confers no Account, Opportunity or Sales Order write authority. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["crm.activity.create", "crm.activity.read"],
}) as Role;

// Inventory transfer operator -- the durable least-privilege Role for the governed Transfer Order
// authority (create -> dispatch -> receive, plus cancel).
//
// Same situation the two Roles above were written for: all four ids were registered active:false and
// carried by NO Role, so the Transfer surface could ship, be activated in an environment, and still
// deny every principal. Activation is not authorization; this Role is the authorization half.
//
// WHY ONE ROLE FOR ALL FOUR: a transfer is a single custody movement whose steps are performed by the
// same operational owner -- whoever sends stock is who confirms it arrived, and cancel is the same
// authority declining to complete its own movement. Splitting dispatch from receive would not create
// segregation of duties, it would only make an ordinary transfer un-completable by its owner. Cycle
// Count below is split precisely because that separation IS meaningful there.
//
// Least privilege: exactly these four ids. It confers no catalog write, no receiving authority, and
// no stock adjustment power -- a transfer moves existing units between locations and creates none.
//
// `privileged: false` on the same reasoning as its siblings: it administers no security/access
// policy, grants no admin authority, bypasses no trusted-command authorization, and cannot alter or
// suppress audit evidence. DECLARING THIS OBJECT GRANTS NOTHING.
export const INVENTORY_TRANSFER_OPERATOR_ROLE: Role = Object.freeze({
  id: "inventoryTransferOperator",
  name: "Inventory Transfer Operator",
  description:
    "Durable least-privilege Role for moving stock between inventory locations through the governed Transfer Order commands. Carries exactly inventory.transfer.create/dispatch/receive/cancel and nothing else; it confers no catalog write, receiving, or stock-adjustment authority. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.transfer.create",
    "inventory.transfer.dispatch",
    "inventory.transfer.receive",
    "inventory.transfer.cancel",
  ],
}) as Role;

// Cycle count counter -- opens a count, submits the counted figures, and may cancel a count it
// opened. Deliberately does NOT carry inventory.cycleCount.reconcile.
//
// SEGREGATION OF DUTIES, not fragmentation for its own sake. Reconciling a cycle count is what turns
// a claimed variance into a real ledger adjustment -- it is the step that changes on-hand quantity.
// Letting the same principal both report the count and approve the adjustment it implies would mean
// one person could write inventory to any number they chose and have it accepted, with no second
// party in the path. That is the classic inventory-shrinkage control, and it is the reason these four
// ids are split across two Roles rather than collected into one convenient "cycle count" Role.
//
// A principal may of course hold both Roles where an organisation accepts that risk; the point is
// that doing so is then an explicit, audited grant decision rather than an invisible default.
//
// `privileged: false` on the same reasoning as its siblings. DECLARING THIS OBJECT GRANTS NOTHING.
export const INVENTORY_CYCLE_COUNT_COUNTER_ROLE: Role = Object.freeze({
  id: "inventoryCycleCountCounter",
  name: "Inventory Cycle Count Counter",
  description:
    "Durable least-privilege Role for performing a physical cycle count: opening a count, submitting counted quantities, and cancelling one. Carries exactly inventory.cycleCount.create/submit/cancel and deliberately NOT inventory.cycleCount.reconcile, so the principal who reports a variance is not also the one who approves the adjustment. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: [
    "inventory.cycleCount.create",
    "inventory.cycleCount.submit",
    "inventory.cycleCount.cancel",
  ],
}) as Role;

// Cycle count reconciler -- the approving half of the control described above. Carries exactly
// inventory.cycleCount.reconcile: the authority to accept a submitted count and let it adjust
// on-hand quantity through the governed reconcile command's own append-only ledger write.
//
// It carries no ability to open or submit a count, which is what keeps the two halves independent:
// a reconciler can only ever act on a count somebody else reported.
//
// `privileged: false`. Reconciling adjusts inventory, not access: it administers no security policy,
// grants no admin authority, and cannot alter or suppress the audit evidence of its own decision --
// the adjustment and its Audit Event are written in the command's single transaction.
// DECLARING THIS OBJECT GRANTS NOTHING.
export const INVENTORY_CYCLE_COUNT_RECONCILER_ROLE: Role = Object.freeze({
  id: "inventoryCycleCountReconciler",
  name: "Inventory Cycle Count Reconciler",
  description:
    "Durable least-privilege Role for approving a submitted cycle count and allowing it to adjust on-hand quantity. Carries exactly inventory.cycleCount.reconcile and nothing else -- notably no authority to open or submit a count, so a reconciler can only act on a count reported by someone else. Declaring it grants nothing; a principal holds it only via a governed, audited roleAssignment.",
  systemSeed: true,
  compatibility: false,
  privileged: false,
  permissions: ["inventory.cycleCount.reconcile"],
}) as Role;

export const GOVERNED_BUSINESS_ROLES: Readonly<Record<string, Role>> = Object.freeze({
  generalEmployee: GENERAL_EMPLOYEE_ROLE,
  officeManager: OFFICE_MANAGER_ROLE,
  salesManager: SALES_MANAGER_ROLE,
  marketingManager: MARKETING_MANAGER_ROLE,
  purchasingManager: PURCHASING_MANAGER_ROLE,
  shopManager: SHOP_MANAGER_ROLE,
  salesperson: SALESPERSON_ROLE,
  generalManager: GENERAL_MANAGER_ROLE,
  warehouseManager: WAREHOUSE_MANAGER_ROLE,
  warehouseAssociate: WAREHOUSE_ASSOCIATE_ROLE,
  partsManager: PARTS_MANAGER_ROLE,
  partsAssociate: PARTS_ASSOCIATE_ROLE,
  controller: CONTROLLER_ROLE,
  supportStaff: SUPPORT_STAFF_ROLE,
  accountingManager: ACCOUNTING_MANAGER_ROLE,
  financeManager: FINANCE_MANAGER_ROLE,
  fieldManager: FIELD_MANAGER_ROLE,
  operationsManager: OPERATIONS_MANAGER_ROLE,
  owner: OWNER_ROLE,
  inventoryCreateExecutor: INVENTORY_CREATE_EXECUTOR_ROLE,
  inventoryCatalogAdministrator: INVENTORY_CATALOG_ADMINISTRATOR_ROLE,
  workOrderPartsPlanner: WORK_ORDER_PARTS_PLANNER_ROLE,
  crmActivityContributor: CRM_ACTIVITY_CONTRIBUTOR_ROLE,
  inventoryTransferOperator: INVENTORY_TRANSFER_OPERATOR_ROLE,
  inventoryCycleCountCounter: INVENTORY_CYCLE_COUNT_COUNTER_ROLE,
  inventoryCycleCountReconciler: INVENTORY_CYCLE_COUNT_RECONCILER_ROLE,
});
