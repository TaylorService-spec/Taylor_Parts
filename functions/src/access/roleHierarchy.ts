// ROLE HIERARCHY -- the organisation tree, expressed on the Roles themselves.
//
// Owner model, 2026-08-19: "Role is the hierarchy levels." Anyone above can see
// what is below them, and people at the same level in DIFFERENT branches see
// nothing of each other -- a Sales Manager sees every salesperson beneath them; a
// Warehouse Manager sits at the same level and sees warehouse people, but neither
// sees the other's side.
//
// So the tree lives here, with the Role definitions, rather than as a reportsTo
// field maintained per employee. An employee's position is derived from the Role
// they hold. The Owner named `reportsTo` on the employee as a NICE TO HAVE -- a
// later refinement that could narrow visibility WITHIN a level (which specific
// salespeople report to which of two sales managers). It is deliberately not
// modelled yet, and its absence has one consequence worth stating plainly:
//
//   With role-only hierarchy, EVERY salesManager sees EVERY salesperson.
//
// That is identical to the described behaviour while one manager per branch
// exists, and diverges the moment a second is appointed. Recorded here so the day
// that happens it is a known limitation with a known fix, not a surprise.
//
// WHAT THIS IS NOT. This is visibility, not capability. Being above someone does
// not confer what they can DO -- it scopes what a capability the holder ALREADY
// has can reach. The same separation ownership follows: authority comes from the
// Role's permissions, reach comes from position. Nothing here grants anything.
//
// This is also NOT the coverage/territory model, which stays deferred. Hierarchy
// answers "whose work can I see"; coverage answers "which accounts do I cover",
// independent of who reports to whom. Keeping them separate is what stops this
// change quietly becoming that one.

/** A Role's position. `parent: null` marks a root. */
export interface RoleHierarchyNode {
  readonly roleId: string;
  readonly parent: string | null;
  /** Why this Role sits here. Present for every entry, because a wrong placement
   *  silently grants or denies visibility and the reasoning is what makes a later
   *  correction safe. */
  readonly rationale: string;
  /** True where the Owner stated the placement; false where it was inferred and
   *  should be confirmed. Inference is marked rather than hidden. */
  readonly stated: boolean;
}

/**
 * The tree.
 *
 * Roles absent from this map have NO position and therefore confer no hierarchical
 * visibility at all -- see NON_HIERARCHICAL_ROLES below. Absence is meaningful, so
 * adding a Role to the system does not silently place it somewhere.
 */
export const ROLE_HIERARCHY: Readonly<Record<string, RoleHierarchyNode>> = Object.freeze({
  // --- top -----------------------------------------------------------------
  owner: Object.freeze({
    roleId: "owner",
    parent: null,
    rationale: "Top of the organisation chart. Sees every branch.",
    stated: true,
  }),
  generalManager: Object.freeze({
    roleId: "generalManager",
    parent: "owner",
    rationale: "Top block of the chart, beneath the Owner and above every branch head.",
    stated: true,
  }),
  admin: Object.freeze({
    roleId: "admin",
    parent: "generalManager",
    rationale:
      "Top block of the chart, listed under Owner and General Manager. Placed beneath the General Manager so the tree has one spine rather than two roots; the practical effect is unchanged, since both see every branch.",
    stated: true,
  }),

  // --- the three branch heads ----------------------------------------------
  // CORRECTION 2026-08-19: an earlier version of this file put salesManager UNDER
  // operationsManager. The Owner's org chart shows them as SIBLINGS -- Sales
  // Manager, Operations Manager and Finance Manager are three separate columns
  // beneath the top block. That mattered: the wrong version let operational
  // oversight see the entire sales pipeline, which the chart does not say.
  salesManager: Object.freeze({
    roleId: "salesManager",
    parent: "admin",
    rationale:
      "Head of the sales branch, a peer of Operations and Finance -- not beneath Operations. Sees the sales side only.",
    stated: true,
  }),
  // Owner ruling 2026-08-19: "need a marketing top top equal to salesManager".
  // parent: "admin" -- the SAME parent as salesManager, which is what makes them equal.
  // Placing Marketing under salesManager would have been the easy reading of "a marketing
  // top" and the wrong one: it would put the whole sales pipeline and every salesperson
  // inside Marketing's visibility, and put Marketing inside the Sales Manager's. Peers on
  // one level see neither across nor into each other, which is exactly the rule this file
  // already enforces between Sales and Warehouse.
  marketingManager: Object.freeze({
    roleId: "marketingManager",
    parent: "admin",
    rationale:
      "Head of the marketing branch, a peer of Sales, Operations and Finance. Equal to Sales Manager by Owner ruling, so neither sees the other's people.",
    stated: true,
  }),
  // Owner roster 2026-08-20. Purchasing Manager sits under Finance Manager: the 2026-08-19
  // ruling put purchasing under accounting, and the roster gives Erik BOTH Accounting
  // Manager and Purchasing Manager. Reporting line follows that, while the capability bundle
  // stays on its own role.
  purchasingManager: Object.freeze({
    roleId: "purchasingManager",
    parent: "financeManager",
    rationale: "Procurement reports into Finance, per the 2026-08-19 ruling that purchasing falls under accounting.",
    stated: true,
  }),
  // Shop Manager is a Service-organization position (Owner roster 2026-08-20, Willie),
  // placed under Service Manager -- the role its own description mirrors. Holds no
  // capabilities; placement is visibility only and confers nothing.
  shopManager: Object.freeze({
    roleId: "shopManager",
    parent: "fieldManager",
    rationale: "Service-organization position under the Service Manager. Placement is visibility; the CRUD matrix declares no authority row for it.",
    stated: true,
  }),
  operationsManager: Object.freeze({
    roleId: "operationsManager",
    parent: "admin",
    rationale:
      "Head of the operations branch: Warehouse, Service and Parts hang beneath it. Sees no sales or finance work.",
    stated: true,
  }),
  financeManager: Object.freeze({
    roleId: "financeManager",
    parent: "admin",
    rationale: "Head of the finance branch: Accounting and Controller beneath it. Sees no sales or operations work.",
    stated: true,
  }),

  // --- sales branch ---------------------------------------------------------
  // The chart's National Accounts and Retail Sales columns are CHANNELS, each with
  // its own salespeople. They are not modelled as separate Roles here -- see
  // PLACEMENT_GAPS. `salesperson` is the single Role today, and which channel a
  // person sells into is a property of the DEAL (SALES_CHANNELS on Opportunity and
  // Sales Order: NATIONAL_ACCOUNTS | RETAIL | STRATEGIC_ACCOUNTS), not of the Role.
  salesperson: Object.freeze({
    roleId: "salesperson",
    parent: "salesManager",
    rationale: "Individual sales contributor beneath the Sales Manager, in either channel.",
    stated: true,
  }),

  // --- operations branch ----------------------------------------------------
  // Service Manager on the chart is this platform's fieldManager Role: it carries
  // the full Work Order lifecycle, which is exactly the service function. The name
  // difference is why "serviceManager" could not be granted earlier -- it is this.
  fieldManager: Object.freeze({
    roleId: "fieldManager",
    parent: "operationsManager",
    rationale:
      "The chart's Service Manager. Carries the Work Order lifecycle; Dispatcher and Technicians sit beneath it.",
    stated: true,
  }),
  dispatcher: Object.freeze({
    roleId: "dispatcher",
    parent: "fieldManager",
    rationale:
      "Beneath the Service Manager and ABOVE the technicians. The chart lists Dispatcher and Technicians in the same column, which reads as siblings, but the Owner clarified the order: a dispatcher directs technicians and sees their work, while a technician sees no dispatcher work and neither sees the Service Manager above them.",
    stated: true,
  }),
  technician: Object.freeze({
    roleId: "technician",
    parent: "dispatcher",
    rationale:
      "Beneath the Dispatcher who assigns their work. The Service Manager still sees every technician, transitively, without needing a direct edge.",
    stated: true,
  }),

  warehouseManager: Object.freeze({
    roleId: "warehouseManager",
    parent: "operationsManager",
    rationale: "The chart's Warehouse Manager, an operations branch, with Warehouse Associates beneath.",
    stated: true,
  }),
  warehouseAssociate: Object.freeze({
    roleId: "warehouseAssociate",
    parent: "warehouseManager",
    rationale: "The chart places Warehouse Associate beneath the Warehouse Manager.",
    stated: true,
  }),
  partsManager: Object.freeze({
    roleId: "partsManager",
    parent: "operationsManager",
    rationale: "The chart's Parts Manager, a third operations branch alongside Warehouse and Service.",
    stated: true,
  }),
  partsAssociate: Object.freeze({
    roleId: "partsAssociate",
    parent: "partsManager",
    rationale: "The chart places Parts Associates beneath the Parts Manager.",
    stated: true,
  }),

  // --- finance branch -------------------------------------------------------
  accountingManager: Object.freeze({
    roleId: "accountingManager",
    parent: "financeManager",
    rationale:
      "The chart's Accounting column, beneath Finance Manager, with Support staff below it. Note this is a hierarchy position only -- accountingManager and financeManager remain intentionally IDENTICAL in capability (DECISIONS #114); position and authority are separate systems.",
    stated: true,
  }),

  controller: Object.freeze({
    roleId: "controller",
    parent: "financeManager",
    rationale: "The chart's Controller column, beneath Finance Manager and alongside Accounting.",
    stated: true,
  }),
  supportStaff: Object.freeze({
    roleId: "supportStaff",
    parent: "accountingManager",
    rationale: "The chart places Support staff beneath the Accounting column.",
    stated: true,
  }),

  // --- office branch --------------------------------------------------------
  officeManager: Object.freeze({
    roleId: "officeManager",
    parent: "admin",
    rationale:
      "A fourth branch head at the same level as Sales, Operations and Finance. Sees the general employees beneath it and nothing in the other three branches.",
    stated: true,
  }),
  generalEmployee: Object.freeze({
    roleId: "generalEmployee",
    parent: "officeManager",
    rationale:
      "Beneath the Office Manager. A leaf -- nobody reports to a general employee, so it sees no one.",
    stated: true,
  }),
});

/**
 * Roles that are deliberately OUTSIDE the tree.
 *
 * These are narrow, capability-specific grants a person holds IN ADDITION to their
 * position -- "may reconcile a cycle count", "may plan Work Order parts". They are
 * not levels, nobody reports to them, and holding one confers no visibility over
 * anyone. Placing them in the tree would invent a seniority that does not exist.
 *
 * `dispatcher` was previously listed here on the reasoning that supervising
 * technicians day to day is a job function rather than a rung. The Owner's org
 * chart places it explicitly under Service Manager alongside Technicians, so it is
 * now a positioned Role. Recorded because the earlier reasoning was sound and only
 * the evidence changed.
 */
export const NON_HIERARCHICAL_ROLES: ReadonlySet<string> = new Set([
  "inventoryCreateExecutor",
  "inventoryCatalogAdministrator",
  "workOrderPartsPlanner",
  "crmActivityContributor",
  "inventoryTransferOperator",
  "inventoryCycleCountCounter",
  "inventoryCycleCountReconciler",
]);

/**
 * Known gaps, stated rather than silently resolved.
 *
 * The Owner's example named a Warehouse Manager seeing warehouse people beneath
 * them. No such governed Role exists -- warehouse/parts responsibilities are
 * OPERATIONAL roles on the employee record (PARTS_MANAGER, PARTS_ASSOCIATE,
 * WAREHOUSE_MANAGER), which this platform deliberately keeps separate from
 * security authorization. So the warehouse branch cannot be expressed as a Role
 * tree today without either inventing Roles or mixing the two systems, and both
 * are decisions for the Owner rather than inferences for an implementer.
 */
export const PLACEMENT_GAPS: readonly string[] = Object.freeze([
  "National Accounts vs Retail Sales -- shown as separate columns under Sales Manager. Deliberately NOT modelled as Roles: which market a deal belongs to is a property of the DEAL (SALES_CHANNELS on Opportunity and Sales Order), not of the person. A Role per channel multiplies every time a channel is added, and there are already three. If a national-accounts salesperson must be unable to see retail deals, that is channel-scoped visibility -- the deferred coverage model, not this hierarchy.",
]);

/** Every ancestor of a Role, nearest first. Cycle-safe. */
export function ancestorsOf(roleId: string): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current = ROLE_HIERARCHY[roleId]?.parent ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = ROLE_HIERARCHY[current]?.parent ?? null;
  }
  return Object.freeze(out);
}

/** Every Role beneath this one, at any depth. */
export function descendantsOf(roleId: string): readonly string[] {
  const out: string[] = [];
  const queue = [roleId];
  const seen = new Set<string>([roleId]);
  while (queue.length > 0) {
    const parent = queue.shift() as string;
    for (const node of Object.values(ROLE_HIERARCHY)) {
      if (node.parent === parent && !seen.has(node.roleId)) {
        seen.add(node.roleId);
        out.push(node.roleId);
        queue.push(node.roleId);
      }
    }
  }
  return Object.freeze(out);
}

/**
 * Can a holder of `viewerRoleId` see work belonging to `subjectRoleId`?
 *
 * True only for a strict ancestor. Deliberately FALSE for:
 *   - the same Role (two salespeople do not see each other),
 *   - siblings and cousins (Sales Manager and the warehouse side),
 *   - anything involving a Role outside the tree.
 *
 * Fail-closed: an unknown Role sees nothing and is seen by nobody, so adding a
 * Role without placing it cannot silently widen visibility.
 */
export function canSeeAcrossHierarchy(viewerRoleId: string, subjectRoleId: string): boolean {
  if (!viewerRoleId || !subjectRoleId) return false;
  if (viewerRoleId === subjectRoleId) return false;
  if (NON_HIERARCHICAL_ROLES.has(viewerRoleId) || NON_HIERARCHICAL_ROLES.has(subjectRoleId)) return false;
  if (!ROLE_HIERARCHY[viewerRoleId] || !ROLE_HIERARCHY[subjectRoleId]) return false;
  return ancestorsOf(subjectRoleId).includes(viewerRoleId);
}
