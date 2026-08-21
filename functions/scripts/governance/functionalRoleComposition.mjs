// FUNCTIONAL ROLE COMPOSITION. Which functional Roles a business Role carries BY DEFAULT, and which
// stay per-employee.
//
// ============================ THE GOVERNING PRINCIPLE ============================
//
// Owner direction: governance is managed through the Roles and permissions assigned to EMPLOYEES. A
// business Role must not become an irreversible bundle of every authority its job title might ever
// need. "Parts Manager" does not mean every parts permission.
//
// So the default answer here is KEEP_STANDALONE. COMPOSE_BY_DEFAULT has to be earned: the work must
// be normal for EVERY employee holding that business role, not merely common.
//
// The practical consequence, and the point of the design:
//
//   Parts Associate A -> business role + Lookup + Put-away + Cycle Count Counter
//   Parts Associate B -> business role + Lookup + Put-away
//
// Both are Parts Associates. Their authority legitimately differs, and that difference is visible in
// their employee record rather than hidden in a role definition.
export const COMPOSITION = Object.freeze({
  COMPOSE_BY_DEFAULT: "COMPOSE_BY_DEFAULT",
  KEEP_STANDALONE: "KEEP_STANDALONE",
  RETIRE_CANDIDATE: "RETIRE_CANDIDATE",
});

export const FUNCTIONAL_ROLE_DECISIONS = Object.freeze({
  // Reading a balance or resolving a scanned identifier is the floor of working in parts or the
  // warehouse at all -- an associate who cannot look stock up cannot do any of their other work.
  inventoryLookupReader: {
    decision: COMPOSITION.COMPOSE_BY_DEFAULT,
    composedInto: ["partsAssociate", "partsManager", "warehouseAssociate", "warehouseManager"],
    why: "Lookup is the precondition for every other parts/warehouse task; nobody in these roles works without it.",
  },
  // Put-away is ordinary receiving-floor work for associates. Managers are NOT given it by default:
  // bin administration sits with the manager, and one person holding both defines where stock lives
  // AND puts it there unobserved.
  inventoryPutAwayOperator: {
    decision: COMPOSITION.COMPOSE_BY_DEFAULT,
    composedInto: ["partsAssociate", "warehouseAssociate"],
    why: "Normal floor work for associates. Deliberately not composed into managers -- see bin-administration SoD.",
  },
  inventoryBinAdministrator: {
    decision: COMPOSITION.KEEP_STANDALONE,
    composedInto: [],
    why: "Defines where stock may live. Separated from put-away so the person defining locations is not the person filling them.",
  },
  // THE SoD PAIR. Never both, and never automatic: counting is assigned to specific people, and the
  // reconciler must be someone other than the counter who produced the variance.
  inventoryCycleCountCounter: {
    decision: COMPOSITION.KEEP_STANDALONE,
    composedInto: [],
    why: "Assigned per employee. Composing it would make every associate a counter and erode who is accountable for a count.",
  },
  inventoryCycleCountReconciler: {
    decision: COMPOSITION.KEEP_STANDALONE,
    composedInto: [],
    why: "DECISIONS #111: a counter may not approve their own material variance. Must never be composed alongside the counter role.",
  },
  inventoryTransferOperator: {
    decision: COMPOSITION.KEEP_STANDALONE,
    composedInto: [],
    why: "Moves custody between locations. Assigned to the people who actually run transfers, not to every warehouse employee.",
  },
  inventoryReturnsIntakeClerk: {
    decision: COMPOSITION.KEEP_STANDALONE,
    composedInto: [],
    why: "Returns intake is a specific station. DECISIONS #118 keeps intake separate from disposition, which does not exist yet.",
  },
  inventoryCatalogAdministrator: {
    decision: COMPOSITION.KEEP_STANDALONE,
    composedInto: [],
    why: "Catalog manage/activate is administration of the part master, not operating on it. Separated from lookup.",
  },
  inventoryCreateExecutor: {
    decision: COMPOSITION.RETIRE_CANDIDATE,
    composedInto: [],
    why: "Its own definition marks it temporary. Flagged for retirement review rather than composed anywhere.",
  },
  workOrderPartsPlanner: {
    decision: COMPOSITION.KEEP_STANDALONE,
    composedInto: [],
    why: "Parts planning against a work order is a specific responsibility, not an automatic part of service management.",
  },
  crmActivityContributor: {
    decision: COMPOSITION.COMPOSE_BY_DEFAULT,
    composedInto: ["salesperson", "salesManager", "marketingManager"],
    why: "Logging customer activity is ordinary sales/marketing work; the matrix grants these roles Contacts CR.",
  },
});

// TWO DIFFERENT THINGS, and conflating them would over-apply the rule.
//
// MUTUALLY EXCLUSIVE: one person holding both sides defeats a control. A role definition must never
// hand someone both; a human may still be granted both deliberately, which is an employee-level
// decision with a visible audit trail.
export const SOD_EXCLUSIVE_PAIRS = Object.freeze([
  ["inventoryCycleCountCounter", "inventoryCycleCountReconciler", "cycle count: counter may not approve their own material variance (DECISIONS #111)"],
  ["inventoryBinAdministrator", "inventoryPutAwayOperator", "the person defining where stock may live is not the person filling those locations unobserved"],
]);

// DISTINCT AUTHORITIES: must remain separately grantable so they can be withheld independently, but
// holding several is ordinary. A parts manager who looks parts up AND maintains the catalog is doing
// their job, not defeating a control.
//
// An earlier draft listed catalog-vs-lookup as mutually exclusive. That over-applied the rule: the
// governance requirement is that Lookup, Manage and Activate stay SEPARATE capabilities, not that one
// person may never hold two of them.
export const SOD_DISTINCT_AUTHORITIES = Object.freeze([
  ["inventory.catalog.alias.read", "inventory.catalog.manage", "inventory.catalog.activate",
   "catalog: lookup vs manage vs activate must stay independently grantable"],
  ["inventory.returns.intake", "(disposition not implemented)",
   "returns: intake is not disposition (DECISIONS #118). Disposition has no capability -- FUNCTIONAL_GAP."],
]);

export function composedFor(businessRoleId) {
  return Object.entries(FUNCTIONAL_ROLE_DECISIONS)
    .filter(([, d]) => d.decision === COMPOSITION.COMPOSE_BY_DEFAULT && d.composedInto.includes(businessRoleId))
    .map(([id]) => id);
}
