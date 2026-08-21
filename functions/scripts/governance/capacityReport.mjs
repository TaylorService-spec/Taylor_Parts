#!/usr/bin/env node
// AUTHORIZED CAPACITY. How much work the certification workforce can ACTUALLY do.
//
// ============================ THE DISTINCTION THAT CARRIES THIS FILE ============================
//
// Capacity is not headcount, not job title, not granted capability, and not functional-role
// assignment. It is all of those INTERSECTED WITH the permission catalog's active flag:
//
//   EMPLOYEE -> BUSINESS ROLE(S) -> FUNCTIONAL ROLE(S) -> GRANTED -> ACTIVE -> OPERABLE
//
// A capability that is granted but inactive resolves DENY / inactivePermission for every principal
// including owner. It is therefore ZERO operational capacity, and counting it would produce a
// staffing report claiming a workstream is covered when nobody in the company can perform it.
//
// That is not hypothetical here. Most inventory capabilities are inactive, so the honest answer for
// put-away, transfers, cycle count and returns is GRANTED_BUT_INACTIVE -- work the workforce is
// authorized to do and cannot do. A report hiding that behind a green ADEQUATE would be worse than
// no report at all.
//
// Run: node scripts/governance/capacityReport.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { PERMISSION_CATALOG } = await import(L("functions/lib/access/permissionCatalog.js"));
const { GOVERNED_BUSINESS_ROLES: GB } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { COMPATIBILITY_ROLES: CR } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { buildWorkforce } = await import(L("functions/scripts/certificationWorld/data/workforce.mjs"));
const { WORKSTREAM_REQUIREMENTS, effectiveCapabilities } =
  await import(L("functions/scripts/certificationWorld/authorityMatrix.mjs"));

const ACTIVE = new Set(PERMISSION_CATALOG.filter((p) => p.active !== false).map((p) => p.id));
const IN_CATALOG = new Set(PERMISSION_CATALOG.map((p) => p.id));

// The classifications the Owner asked for. GRANTED_BUT_INACTIVE is the one this report exists to
// surface: it is NOT under-privileged (the grant is correct) and NOT operable (the work cannot be
// done). Collapsing it into either neighbour destroys the only fact worth acting on.
export const CLASS = Object.freeze({
  OPERABLE: "OPERABLE",
  GRANTED_BUT_INACTIVE: "GRANTED_BUT_INACTIVE",
  UNDER_PRIVILEGED: "UNDER_PRIVILEGED",
  OVER_PRIVILEGED: "OVER_PRIVILEGED",
  SOD_CONFLICT: "SOD_CONFLICT",
  AUTHORITY_BLOCKED: "AUTHORITY_BLOCKED",
  EXPECTED_DENIAL: "EXPECTED_DENIAL",
});

// Which governed roles are FUNCTIONAL (authority-bearing, granted per employee) rather than
// positional. Derived from the composition module's own vocabulary, not re-guessed here.
const FUNCTIONAL = new Set([
  "inventoryLookupReader", "inventoryPutAwayOperator", "inventoryBinAdministrator",
  "inventoryCycleCountCounter", "inventoryCycleCountReconciler", "inventoryTransferOperator",
  "inventoryReturnsIntakeClerk", "inventoryCatalogAdministrator", "inventoryCreateExecutor",
  "workOrderPartsPlanner", "crmActivityContributor",
]);

/**
 * Classify one employee against one assigned workstream, using OPERABLE authority.
 *
 * Order matters and is deliberate:
 *   SOD_CONFLICT         first -- a conflict is a defect even when the capabilities are inactive.
 *                        An inactive capability still records that someone was given both sides.
 *   AUTHORITY_BLOCKED    the workstream needs a capability that is not in the catalog at all. No
 *                        grant and no activation fixes that; it is a build gap, not a staffing one.
 *   GRANTED_BUT_INACTIVE everything required is HELD and at least one is switched off.
 *   UNDER_PRIVILEGED     something required is genuinely not held.
 */
function classify(caps, workstream, { expectedDenial = false } = {}) {
  const req = WORKSTREAM_REQUIREMENTS[workstream];
  if (!req) return { classification: CLASS.AUTHORITY_BLOCKED, detail: "workstream declares no requirement" };

  const conflicting = req.forbids.filter((c) => caps.has(c));
  if (conflicting.length) {
    return { classification: CLASS.SOD_CONFLICT, detail: "holds forbidden " + conflicting.join(", ") };
  }
  const uncatalogued = req.requires.filter((c) => !IN_CATALOG.has(c));
  if (uncatalogued.length) {
    return { classification: CLASS.AUTHORITY_BLOCKED, detail: "not in catalog: " + uncatalogued.join(", ") };
  }
  const missing = req.requires.filter((c) => !caps.has(c));
  if (missing.length) {
    return expectedDenial
      ? { classification: CLASS.EXPECTED_DENIAL, detail: "deliberately lacks " + missing.join(", ") }
      : { classification: CLASS.UNDER_PRIVILEGED, detail: "missing " + missing.join(", ") };
  }
  const inactive = req.requires.filter((c) => !ACTIVE.has(c));
  if (inactive.length) {
    return { classification: CLASS.GRANTED_BUT_INACTIVE, detail: "held but inactive: " + inactive.join(", ") };
  }
  return { classification: CLASS.OPERABLE, detail: "" };
}

const employees = buildWorkforce();
const capsOf = (e) => effectiveCapabilities(e, { governedRoles: GB, compatibilityRoles: CR });

// ============================ WHERE THE AUTHORITY ACTUALLY COMES FROM ============================
//
// effectiveCapabilities() unions the LEGACY compatibility role on the user with the governed role
// grants, which is correct -- it is what the server resolves. But it makes every capacity number
// ambiguous, because the two sources mean opposite things for certification:
//
//   a governed grant       is the model this program is building and is what must be proven
//   a compatibility grant  is the legacy authority R-1 exists to RETIRE
//
// Measured across this workforce: 80% of operable capability-holdings come from the compatibility
// role alone, 2% from a governed role alone. Fourteen of 43 employees would hold ZERO operable
// authority if the compatibility roles were removed today.
//
// So every workstream is ALSO counted governed-only. A workstream that is ADEQUATE on the union and
// NO_COVERAGE governed-only is not covered -- it is borrowing authority from the thing being
// retired, and reporting one number would hide exactly that.
const governedCapsOf = (e) =>
  new Set((e.certGovernedRoles || []).flatMap((r) => GB[r]?.permissions || []));
const compatCapsOf = (e) => new Set(CR[e.securityRole]?.permissions || []);

const rows = [];
for (const e of employees) {
  const caps = capsOf(e);
  const granted = [...caps].sort();
  const operable = granted.filter((c) => ACTIVE.has(c));
  const businessRoles = (e.certGovernedRoles || []).filter((r) => !FUNCTIONAL.has(r));
  const functionalRoles = (e.certGovernedRoles || []).filter((r) => FUNCTIONAL.has(r));

  // OVER_PRIVILEGED is an EMPLOYEE-level fact, not a per-assignment one: it means holding OPERABLE
  // authority for a workstream nobody made them responsible for. Compatibility roles legitimately
  // carry breadth, so this is surfaced and attributed rather than failed.
  const foreign = Object.entries(WORKSTREAM_REQUIREMENTS)
    .filter(([ws, req]) => !(e.certAssignments || []).includes(ws)
      && req.requires.length
      && req.requires.every((c) => caps.has(c) && ACTIVE.has(c)))
    .map(([ws]) => ws);

  rows.push({
    employeeId: e.employeeId,
    name: e.displayName,
    securityRole: e.securityRole,
    businessRoles,
    functionalRoles,
    grantedCount: granted.length,
    operableCount: operable.length,
    assignments: (e.certAssignments || []).map((ws) => ({ workstream: ws, ...classify(caps, ws) })),
    overPrivilegedFor: foreign,
    workload: e.certWorkload,
    available: e.certAvailable,
  });
}

// WORKSTREAM CAPACITY, counted three ways because they answer three different questions:
//   assignedWorkers  -- who was given the responsibility
//   grantedEligible  -- who HOLDS what it needs, ignoring activation
//   operableEligible -- who could actually do it today
//   available        -- operable AND the fixture marks them available
const ALL_WS = Object.keys(WORKSTREAM_REQUIREMENTS);
const capacity = ALL_WS.map((ws) => {
  const req = WORKSTREAM_REQUIREMENTS[ws];
  const assignedWorkers = rows.filter((r) => r.assignments.some((a) => a.workstream === ws)).length;
  const holders = employees.map((e) => ({ e, caps: capsOf(e) }));
  const grantedEligible = holders.filter(({ caps }) => req.requires.length && req.requires.every((c) => caps.has(c)));
  const operableEligible = grantedEligible.filter(() => req.requires.every((c) => ACTIVE.has(c)));
  const available = operableEligible.filter(({ e }) => e.certAvailable);
  // The same count using GOVERNED grants only -- what survives R-1 retiring the compatibility roles.
  const operableGovernedOnly = employees.filter((e) => {
    const g = governedCapsOf(e);
    return req.requires.length && req.requires.every((c) => g.has(c) && ACTIVE.has(c));
  }).length;
  const borrowsLegacyAuthority = operableEligible.length > 0 && operableGovernedOnly === 0;
  const inactiveReq = req.requires.filter((c) => IN_CATALOG.has(c) && !ACTIVE.has(c));
  const missingReq = req.requires.filter((c) => !IN_CATALOG.has(c));

  let result;
  let blockedReason = "";
  if (missingReq.length) {
    result = "AUTHORITY_BLOCKED";
    blockedReason = "capability not in catalog: " + missingReq.join(", ");
  } else if (grantedEligible.length === 0) {
    result = "NO_COVERAGE";
    blockedReason = "nobody holds the required capabilities";
  } else if (inactiveReq.length) {
    result = "GRANTED_BUT_INACTIVE";
    blockedReason = "inactive: " + inactiveReq.join(", ");
  } else if (operableEligible.length === 1) {
    result = "THIN";
    blockedReason = "single point of failure -- no backup";
  } else {
    result = "ADEQUATE";
  }

  return {
    workstream: ws,
    requires: req.requires,
    forbids: req.forbids,
    assignedWorkers,
    grantedEligible: grantedEligible.length,
    operableEligible: operableEligible.length,
    operableGovernedOnly,
    borrowsLegacyAuthority,
    available: available.length,
    blockedReason,
    result,
  };
});

// THE INERT FUNCTIONAL ROLES. Four separate facts, deliberately not collapsed into one:
//   ROLE EXISTS / ROLE IS ASSIGNED / CAPABILITY IS ACTIVE / WORKFLOW IS OPERABLE.
const assignedRoleIds = new Set(employees.flatMap((e) => e.certGovernedRoles || []));
const inert = Object.values(GB)
  .filter((r) => (r.permissions || []).length && !(r.permissions || []).some((c) => ACTIVE.has(c)))
  .map((r) => ({
    roleId: r.id,
    capabilities: [...r.permissions].sort(),
    allCapabilitiesInactive: true,
    assignedToAPlannedEmployee: assignedRoleIds.has(r.id),
    bothInactiveAndUnassigned: !assignedRoleIds.has(r.id),
    dependentWorkstreams: ALL_WS.filter((ws) =>
      WORKSTREAM_REQUIREMENTS[ws].requires.some((c) => r.permissions.includes(c))),
    sandboxActivationRequired: true,
    employeeGrantRequired: !assignedRoleIds.has(r.id),
  }));

const tally = {};
for (const r of rows) for (const a of r.assignments) tally[a.classification] = (tally[a.classification] || 0) + 1;
const byResult = {};
for (const c of capacity) byResult[c.result] = (byResult[c.result] || 0) + 1;

const out = {
  basis: "OPERABLE authority = granted capability INTERSECT permission-catalog active flag. "
    + "Granted-but-inactive is ZERO operational capacity.",
  catalog: { total: IN_CATALOG.size, active: ACTIVE.size, inactive: IN_CATALOG.size - ACTIVE.size },
  employeesEvaluated: rows.length,
  assignmentClassifications: tally,
  workstreamResults: byResult,
  coverage: {
    twoOrMoreOperable: capacity.filter((c) => c.operableEligible >= 2).map((c) => c.workstream),
    exactlyOneOperable: capacity.filter((c) => c.operableEligible === 1).map((c) => c.workstream),
    zeroOperable: capacity.filter((c) => c.operableEligible === 0).map((c) => c.workstream),
  },
  authoritySource: (() => {
    let compatOnly = 0; let govOnly = 0; let both = 0; let total = 0; let zeroGoverned = 0;
    for (const e of employees) {
      const compat = compatCapsOf(e); const gov = governedCapsOf(e);
      const op = [...new Set([...compat, ...gov])].filter((c) => ACTIVE.has(c));
      total += op.length;
      for (const c of op) {
        if (compat.has(c) && gov.has(c)) both += 1;
        else if (compat.has(c)) compatOnly += 1;
        else govOnly += 1;
      }
      if (![...gov].some((c) => ACTIVE.has(c))) zeroGoverned += 1;
    }
    return {
      operableHoldingsTotal: total,
      fromCompatibilityRoleOnly: compatOnly,
      fromGovernedRoleOnly: govOnly,
      fromBoth: both,
      employeesWithZeroOperableGovernedAuthority: zeroGoverned,
      note: "Compatibility-role authority is what R-1 exists to retire. A workstream operable only "
        + "through it is borrowing authority from the thing being removed.",
    };
  })(),
  capacity,
  inertFunctionalRoles: inert,
  employees: rows,
};
writeFileSync(path.join(REPO, "docs/governance/capacity-report.json"), JSON.stringify(out, null, 1));

console.log("employees " + rows.length + " | catalog " + IN_CATALOG.size
  + " active " + ACTIVE.size + " inactive " + (IN_CATALOG.size - ACTIVE.size));
console.log("\nassignment classifications:");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log("  ", k.padEnd(22), v);
console.log("\n" + "WORKSTREAM".padEnd(26) + "ASGN".padStart(5) + "GRANT".padStart(6)
  + "OPER".padStart(5) + "GOVONLY".padStart(8) + "AVAIL".padStart(6) + "  RESULT");
for (const c of capacity) {
  console.log(c.workstream.padEnd(26) + String(c.assignedWorkers).padStart(5)
    + String(c.grantedEligible).padStart(6) + String(c.operableEligible).padStart(5)
    + String(c.operableGovernedOnly).padStart(8) + String(c.available).padStart(6)
    + "  " + c.result + (c.borrowsLegacyAuthority ? "  [LEGACY-BORROWED]" : ""));
}
console.log("\nworkstream results:");
for (const [k, v] of Object.entries(byResult).sort((a, b) => b[1] - a[1])) console.log("  ", k.padEnd(22), v);
console.log("\n>=2 operable: " + out.coverage.twoOrMoreOperable.length
  + " | exactly 1: " + out.coverage.exactlyOneOperable.length
  + " | zero: " + out.coverage.zeroOperable.length);
console.log("inert functional roles: " + inert.length + " -- " + inert.map((i) => i.roleId).join(", "));
