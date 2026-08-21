// ASSIGNMENT -> AUTHORITY MATRIX.
//
// Proves two things that are easy to assume and rarely checked:
//
//   POSITIVE  every worker given operational responsibility HAS the governed authority to discharge it.
//   NEGATIVE  no worker holds authority merely because the dataset found it convenient.
//
// The negative half is the stronger evidence. "A parts associate can count" says little; "can count
// AND cannot reconcile" says the segregation of duties actually holds.
//
// AUTHORITY IS COMPUTED FROM EFFECTIVE CAPABILITIES, never from a role name. A role called
// warehouseManager carries ZERO permissions in this model -- it is an org-chart position. Inferring
// authority from the noun would certify a fiction.
import { WORKSTREAM } from "./data/workforce.mjs";

export const VERDICT = Object.freeze({
  AUTHORIZED: "AUTHORIZED",
  UNDER_PRIVILEGED: "UNDER_PRIVILEGED",
  OVER_PRIVILEGED: "OVER_PRIVILEGED",
  SOD_CONFLICT: "SEGREGATION_OF_DUTIES_CONFLICT",
  AUTHORITY_BLOCKED: "AUTHORITY_BLOCKED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

// What each workstream ACTUALLY requires, in real capability ids read out of the governed roles.
// `requires` must all be held. `forbids` are capabilities whose presence alongside this assignment
// is a segregation-of-duties conflict rather than a bonus.
export const WORKSTREAM_REQUIREMENTS = Object.freeze({
  [WORKSTREAM.CRM_SALES]: { requires: ["account.record.read", "opportunity.read"], forbids: [] },
  [WORKSTREAM.DISPATCH]: { requires: ["workOrder.transition"], forbids: ["admin.roleAssignment.write"] },
  [WORKSTREAM.SERVICE]: { requires: ["workOrder.transition"], forbids: [] },
  [WORKSTREAM.PARTS_LOOKUP]: { requires: ["inventory.balance.read"], forbids: [] },
  [WORKSTREAM.PUT_AWAY]: { requires: ["inventory.placement.record", "inventory.location.bin.read"], forbids: [] },
  // Pick/stage has no dedicated capability today; it is exercised through lookup plus the work-order
  // path. Recorded as its real requirement rather than inventing a capability to make a row green.
  [WORKSTREAM.PICK_STAGE]: { requires: ["inventory.balance.read"], forbids: [] },
  [WORKSTREAM.TRANSFERS]: { requires: ["inventory.transfer.create", "inventory.transfer.dispatch"], forbids: [] },
  // THE SoD PAIR. A counter must not also be able to reconcile the variance they produced.
  [WORKSTREAM.CYCLE_COUNT]: { requires: ["inventory.cycleCount.create", "inventory.cycleCount.submit"], forbids: ["inventory.cycleCount.reconcile"] },
  [WORKSTREAM.CYCLE_COUNT_RECONCILE]: { requires: ["inventory.cycleCount.reconcile"], forbids: ["inventory.cycleCount.submit"] },
  [WORKSTREAM.RECEIVING]: { requires: ["inventory.stock.receive"], forbids: [] },
  [WORKSTREAM.RETURNS]: { requires: ["inventory.returns.intake"], forbids: [] },
  [WORKSTREAM.PROCUREMENT]: { requires: ["reorder.purchaseOrder.create", "reorder.request.startPurchasing"], forbids: [] },
  [WORKSTREAM.ACCOUNTING]: { requires: ["finance.read"], forbids: [] },
  [WORKSTREAM.ADMINISTRATION]: { requires: ["admin.roleAssignment.write"], forbids: [] },
  [WORKSTREAM.REPORTING]: { requires: ["report.definition.read"], forbids: [] },
});

/** Union of every capability an employee effectively holds: legacy security role + governed grants. */
export function effectiveCapabilities(employee, { governedRoles, compatibilityRoles }) {
  const caps = new Set();
  const compat = compatibilityRoles[employee.securityRole];
  for (const p of (compat && compat.permissions) || []) caps.add(p);
  for (const roleId of employee.certGovernedRoles || []) {
    for (const p of (governedRoles[roleId] && governedRoles[roleId].permissions) || []) caps.add(p);
  }
  return caps;
}

/**
 * Classify one employee against one assigned workstream.
 *
 * `expectedDenial` marks a fixture that is DELIBERATELY unauthorized -- an assignment built to prove
 * the denial happens. Those must be labelled, because an unlabelled expected-denial is
 * indistinguishable from a real defect and would quietly inflate the authorized count.
 */
export function classifyAssignment(employee, workstream, caps, { expectedDenial = false } = {}) {
  const req = WORKSTREAM_REQUIREMENTS[workstream];
  if (!req) return { verdict: VERDICT.NOT_APPLICABLE, missing: [], conflicting: [] };

  const missing = req.requires.filter((c) => !caps.has(c));
  const conflicting = req.forbids.filter((c) => caps.has(c));

  if (conflicting.length > 0) return { verdict: VERDICT.SOD_CONFLICT, missing, conflicting };
  if (missing.length === 0) return { verdict: VERDICT.AUTHORIZED, missing: [], conflicting: [] };
  if (expectedDenial) return { verdict: VERDICT.NOT_APPLICABLE, missing, conflicting, note: "expected-denial fixture" };
  return { verdict: VERDICT.UNDER_PRIVILEGED, missing, conflicting };
}

/**
 * Capabilities a worker holds that NO assignment of theirs requires.
 *
 * Reported, not auto-failed. Broad legacy roles legitimately carry more than any one assignment
 * needs, and calling that a defect on every row would bury the cases that matter. What matters is
 * holding authority for a workstream someone is NOT responsible for -- which is what this surfaces.
 */
export function unusedPrivilege(caps, assignments) {
  const needed = new Set();
  for (const a of assignments) {
    for (const c of (WORKSTREAM_REQUIREMENTS[a] || { requires: [] }).requires) needed.add(c);
  }
  const foreign = [];
  for (const [ws, req] of Object.entries(WORKSTREAM_REQUIREMENTS)) {
    if (assignments.includes(ws)) continue;
    if (req.requires.length > 0 && req.requires.every((c) => caps.has(c))) foreign.push(ws);
  }
  return foreign;
}
