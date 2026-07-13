import { ROLES, EMPLOYMENT_STATUS } from "../domain/constants.js";

// Sprint 2.0.1 -- Navigation Foundation. Single source of truth for the
// business-domain nav tree: top-level domains + their sub-nav, and
// which existing screen (if any) each sub-item re-homes.
//
// This REPLACES App.jsx's old flat `NAV` array as the navigation
// source of truth (see docs/CLAUDE_CONTEXT.md's "Navigation" row in
// SYSTEM_AUTHORITIES.md, updated in this same sprint). Unlike PR #22's
// domain-routing scaffold (torn out on the same PR for being
// aspirational/not wired in -- see that PR's body), this one is wired
// into App.jsx's real <Routes> and is meant to stay.
//
// Every `legacyKey` below corresponds 1:1 to one of the 9 keys that
// used to live in App.jsx's NAV array -- every existing screen is
// re-homed, none deleted (Sprint 2.0.1 requirement #1/#2). Items with
// no `legacyKey` are net-new placeholders for business areas that
// don't exist yet (requirement #4).
//
// Role gating (requirement #7 -- role-aware, but NOT an overhaul):
// - Items with a `legacyKey` are gated exactly as before, by looking
//   that key up in `ROLE_NAV_ACCESS` (domain/constants.js) -- zero
//   change to who can see an existing screen.
// - Placeholder items (no `legacyKey`) have no pre-existing permission
//   concept to preserve, so they default to admin/dispatcher only,
//   not technician -- consistent with the existing, deliberately
//   narrow technician role scope, without inventing new granular
//   permission plumbing. This default is a judgment call, not a
//   product decision from the brief; revisit when Roles &
//   Permissions (Administration) is actually built.
// - `alwaysVisible: true` items are visible (and thus routable) to
//   every authenticated role regardless of the two rules above --
//   used only for "My Dashboard", whose content itself (App.jsx's
//   DashboardIndex) already branches per role. Gating the item's
//   *visibility* by `technicianDashboard`'s legacyKey as well would
//   hide the index route entirely for admin/dispatcher, leaving
//   "/dashboard" with no matching route at all -- caught via manual
//   browser testing (blank page for the dispatcher role) before this
//   shipped.
export const PLACEHOLDER_DEFAULT_ROLES = ["admin", "dispatcher"];

export const NAV_DOMAINS = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "dashboard",
    subnav: [
      { key: "my", label: "My Dashboard", path: "", alwaysVisible: true },
      { key: "operationsDashboard", label: "Operations Dashboard", path: "operations", legacyKey: "operations" },
      { key: "activity", label: "Activity", path: "activity" },
      { key: "notifications", label: "Notifications", path: "notifications" },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    path: "customers",
    subnav: [
      // Sprint 2.0.2 -- Customer Foundation: real screen now
      // (AccountsList, special-cased in App.jsx's renderSubnavItem
      // since it has no legacyKey -- this is a new screen, not a
      // re-homed one). Account Detail (/customers/:accountId) is a
      // sibling parameterized route added directly in App.jsx, not
      // representable in this static subnav list.
      { key: "customers", label: "Customers", path: "" },
      { key: "contacts", label: "Contacts", path: "contacts" },
      { key: "locations", label: "Locations", path: "locations" },
      { key: "equipment", label: "Equipment", path: "equipment" },
      { key: "serviceHistory", label: "Service History", path: "service-history" },
    ],
  },
  {
    key: "service",
    label: "Service",
    path: "service",
    subnav: [
      // Sprint 2.0.3 -- "Work Orders" is now the real Work Order
      // workspace (WorkOrdersList, special-cased in App.jsx's
      // renderSubnavItem since it has no legacyKey -- new screen, not
      // a re-homed one). No legacyKey means this defaults to
      // admin/dispatcher visibility (PLACEHOLDER_DEFAULT_ROLES),
      // which is correct here -- technicians keep their own separate
      // Work Order view (Dashboard > My Dashboard /
      // TechnicianDashboard.jsx), untouched by this sprint.
      { key: "workOrders", label: "Work Orders", path: "" },
      // The legacy fieldops_jobs screen (Jobs.jsx), relocated from
      // the "Work Orders" slot above. Same legacyKey ("jobs") as
      // before, so existing role access (including technician) is
      // unchanged -- only its label/position moved, per explicit
      // instruction not to relabel this "Legacy" in user-facing UI.
      { key: "jobAssignments", label: "Job Assignments", path: "job-assignments", legacyKey: "jobs" },
      { key: "dispatch", label: "Dispatch", path: "dispatch", legacyKey: "dispatch" },
      { key: "technicianWorkspace", label: "Technician Workspace", path: "technician-workspace", legacyKey: "fieldMode" },
      { key: "controlTower", label: "Control Tower", path: "control-tower", legacyKey: "controlTower" },
      { key: "dispatcherBoard", label: "Dispatcher Board", path: "dispatcher-board", legacyKey: "dispatcherBoard" },
      { key: "scheduling", label: "Scheduling", path: "scheduling" },
      { key: "warranty", label: "Warranty", path: "warranty" },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    path: "inventory",
    subnav: [
      { key: "parts", label: "Parts", path: "", legacyKey: "inventory" },
      { key: "warehouses", label: "Warehouses", path: "warehouses" },
      { key: "truckInventory", label: "Truck Inventory", path: "truck-inventory" },
      { key: "transfers", label: "Transfers", path: "transfers" },
      { key: "receiving", label: "Receiving", path: "receiving" },
      { key: "cycleCounts", label: "Cycle Counts", path: "cycle-counts" },
      { key: "backOrders", label: "Back Orders", path: "back-orders" },
    ],
  },
  {
    key: "purchasing",
    label: "Purchasing",
    path: "purchasing",
    subnav: [
      { key: "purchaseOrders", label: "Purchase Orders", path: "" },
      { key: "suppliers", label: "Suppliers", path: "suppliers" },
      { key: "quotes", label: "Quotes", path: "quotes" },
      { key: "receipts", label: "Receipts", path: "receipts" },
      { key: "demandPlanning", label: "Demand Planning", path: "demand-planning" },
    ],
  },
  {
    key: "reporting",
    label: "Reporting",
    path: "reporting",
    subnav: [
      { key: "executive", label: "Executive", path: "" },
      { key: "service", label: "Service", path: "service" },
      { key: "inventory", label: "Inventory", path: "inventory" },
      { key: "purchasing", label: "Purchasing", path: "purchasing" },
      { key: "warehouse", label: "Warehouse", path: "warehouse" },
      { key: "employees", label: "Employees", path: "employees" },
      { key: "customers", label: "Customers", path: "customers" },
      { key: "financial", label: "Financial", path: "financial" },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    path: "administration",
    subnav: [
      { key: "employees", label: "Employees", path: "", legacyKey: "technicians" },
      { key: "users", label: "Users", path: "users" },
      { key: "rolesPermissions", label: "Roles & Permissions", path: "roles-permissions" },
      { key: "vehicles", label: "Vehicles", path: "vehicles" },
      { key: "regions", label: "Regions", path: "regions" },
      { key: "companySettings", label: "Company Settings", path: "company-settings" },
      { key: "integrations", label: "Integrations", path: "integrations" },
      { key: "auditLogs", label: "Audit Logs", path: "audit-logs" },
    ],
  },
  // Future placeholder top-level areas (requirement: "Future placeholder
  // top-level areas"). No sub-nav yet -- a single stub page each.
  { key: "salesCrm", label: "Sales / CRM", path: "sales-crm", future: true },
  { key: "financials", label: "Financials", path: "financials", future: true },
];

// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// PR 0) -- capability-scoped nav access for an ACTIVE, eligible
// operationalRoles Employee whose security role is technician. Mirrors
// firestore.rules' isActiveOperationalRole() at the presentation
// layer: technician-only (admin/dispatcher already have full access
// via their own legacyKey/PLACEHOLDER_DEFAULT_ROLES path above and
// must never additionally need this branch), ACTIVE employment
// required, and at least one of the item's operationalRoleAccess
// values must be present in operationalContext.operationalRoles.
// Fails closed on every edge case without a separate branch: a
// missing/null operationalContext, an empty operationalRoles array
// (unresolved or broken Employee linkage -- AuthContext's
// resolveEmployeeSession() already resolves both to []), and a
// non-ACTIVE employmentStatus (undefined/null/any other enum value)
// all simply fail the checks below and return false.
function hasEligibleOperationalRole(operationalRoleAccess, role, operationalContext) {
  if (role !== ROLES.TECHNICIAN) return false;
  const { operationalRoles = [], employmentStatus = null } = operationalContext ?? {};
  if (employmentStatus !== EMPLOYMENT_STATUS.ACTIVE) return false;
  return operationalRoleAccess.some((required) => operationalRoles.includes(required));
}

// `allowedLegacyKeys` is ROLE_NAV_ACCESS[role] (domain/constants.js) --
// passed in rather than imported here so this stays pure/testable and
// the actual permission source of truth stays in one place.
// `operationalContext` (optional -- omitted entirely for a role/item
// combination that doesn't use it, per Issue #100's design) is
// `{ operationalRoles, employmentStatus }` from AuthContext -- only
// consulted when an item declares `operationalRoleAccess`, so every
// existing legacyKey/PLACEHOLDER_DEFAULT_ROLES/alwaysVisible item's
// behavior is byte-for-byte unchanged regardless of whether this
// argument is passed at all.
export function isNavItemVisible(item, role, allowedLegacyKeys, operationalContext) {
  if (item.alwaysVisible) return true;
  if (item.operationalRoleAccess) {
    return hasEligibleOperationalRole(item.operationalRoleAccess, role, operationalContext);
  }
  if (item.legacyKey) {
    return (allowedLegacyKeys ?? []).includes(item.legacyKey);
  }
  return PLACEHOLDER_DEFAULT_ROLES.includes(role);
}

export function isDomainVisible(domain, role, allowedLegacyKeys, operationalContext) {
  if (domain.future) {
    return PLACEHOLDER_DEFAULT_ROLES.includes(role);
  }
  return domain.subnav.some((item) => isNavItemVisible(item, role, allowedLegacyKeys, operationalContext));
}
