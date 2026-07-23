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
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at field-ops-app-vite/src/access/governedBusinessRoles.ts. If
// either file changes, change the other to match.
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
export const SALES_MANAGER_ROLE: Role = Object.freeze({
  id: "salesManager",
  name: "Sales Manager",
  description:
    "Customer/CRM read/create/update. Quote, sales-pipeline, and reporting capabilities are a recorded permission-catalog gap (Spec §26.4), not yet grantable.",
  systemSeed: true,
  compatibility: false,
  permissions: ["account.record.read", "account.record.create", "account.record.update"],
}) as Role;

// Spec §26.2 -- read-only customer visibility only; invoice/payment/
// credit/accounting-reporting capabilities do not exist in the catalog
// (Spec §26.4). Deliberately holds no write permission and no overlap
// with Finance Manager's account.governedField.write, preserving the
// Owner's explicit "remain distinct" requirement.
export const ACCOUNTING_MANAGER_ROLE: Role = Object.freeze({
  id: "accountingManager",
  name: "Accounting Manager",
  description:
    "Read-only Customer visibility today. Invoice/payment/credit/accounting-reporting capabilities are a recorded permission-catalog gap (Spec §26.4) -- distinct from Finance Manager, which holds no accounting-operations id either.",
  systemSeed: true,
  compatibility: false,
  permissions: ["account.record.read"],
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
    "Financial oversight/policy: Customer read visibility plus governed commercial-field write authority (Issue #175). Margin/cost visibility and finance-specific reporting are a recorded permission-catalog gap (Spec §26.4) -- distinct from Accounting Manager, which holds no policy-write id.",
  systemSeed: true,
  compatibility: false,
  permissions: ["account.record.read", "account.governedField.write"],
}) as Role;

// Spec §26.2 -- full existing Work Order lifecycle authority
// (technicians/dispatch/Work Orders) plus field-inventory read
// visibility. Deliberately excludes reorder.*/inventory.action.* --
// reorder/purchasing execution authority stays with the Roles Issue
// #100 already scopes it to (expressed as Conditions on `technician`,
// Spec §9), not duplicated here as an unconditioned grant. Equipment
// capabilities are a recorded catalog gap (Spec §26.4).
export const FIELD_MANAGER_ROLE: Role = Object.freeze({
  id: "fieldManager",
  name: "Field Manager",
  description:
    "Technicians/dispatch/Work Orders: full Work Order lifecycle authority plus field-inventory read visibility. Equipment capabilities are a recorded permission-catalog gap (Spec §26.4).",
  systemSeed: true,
  compatibility: false,
  permissions: ["workOrder.create", "workOrder.transition", "workOrder.cancel", "inventory.transaction.read"],
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
    "Cross-domain operational oversight across Customer, Service, Inventory, Warehouse, and Purchasing. No role administration, no governed-field write, no reorder decision authority.",
  systemSeed: true,
  compatibility: false,
  permissions: [
    "account.record.read",
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
  ],
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

export const GOVERNED_BUSINESS_ROLES: Readonly<Record<string, Role>> = Object.freeze({
  generalEmployee: GENERAL_EMPLOYEE_ROLE,
  officeManager: OFFICE_MANAGER_ROLE,
  salesManager: SALES_MANAGER_ROLE,
  accountingManager: ACCOUNTING_MANAGER_ROLE,
  financeManager: FINANCE_MANAGER_ROLE,
  fieldManager: FIELD_MANAGER_ROLE,
  operationsManager: OPERATIONS_MANAGER_ROLE,
  owner: OWNER_ROLE,
  inventoryCreateExecutor: INVENTORY_CREATE_EXECUTOR_ROLE,
});
