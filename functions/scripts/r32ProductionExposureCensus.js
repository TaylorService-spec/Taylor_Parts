// R-32 PRODUCTION EXPOSURE CENSUS -- READ ONLY, and structurally so.
//
// Answers one narrow question before any R-32 production deployment:
//
//     does production contain principals whose effective access currently depends on the
//     compatibility `technician` Role together with an active PARTS_MANAGER / WAREHOUSE_MANAGER
//     operational role?
//
// R-32 moved six manager-conditioned capabilities off `technician` onto the governed manager Roles.
// A principal holding BOTH halves today receives those capabilities through the compatibility
// carrier and would LOSE them on deployment unless they separately hold the governed manager Role.
// This module finds those principals. It does not fix them.
//
// ============================ WHY THERE IS NO --apply ============================
//
// There is deliberately no write path, and adding one later is not a small edit: this file imports
// no writer, no seeder, no migration helper, and calls no set/update/create/delete/batch API. The
// only Firestore verbs reached are .get() and .count(). A census that can also mutate is a
// migration tool with a modest default, and this is not that.
//
// INERT ON IMPORT: nothing runs unless invoked as the main module, so importing it for tests
// performs no read and touches no project.
//
// TARGET IS PINNED BY EXPLICIT ARGUMENT. `.firebaserc` defaults to production and is never
// consulted; the caller must pass --projectId, and the value must match the production id resolved
// from config/environments.json. A mismatch throws before firebase-admin is required.
"use strict";

const path = require("node:path");
const fs = require("node:fs");

// ---------------------------------------------------------------------------------------------
// PURE CLASSIFICATION LAYER -- no I/O, no SDK, unit-testable with plain fixtures.
// ---------------------------------------------------------------------------------------------

const MANAGER_OPERATIONAL_ROLES = Object.freeze(["PARTS_MANAGER", "WAREHOUSE_MANAGER"]);
const COMPATIBILITY_CARRIER_ROLE_ID = "technician";
const GOVERNED_ROLE_FOR_OPERATIONAL = Object.freeze({
  PARTS_MANAGER: "partsManager",
  WAREHOUSE_MANAGER: "warehouseManager",
});

/** The six capabilities R-32 moved. Exported so the report and the tests cannot drift apart. */
const SIX_CAPABILITIES = Object.freeze([
  "reorder.request.create.manual",
  "reorder.request.read.queue",
  "reorder.request.assign",
  "inventory.transaction.read",
  "inventory.action.read",
  "inventory.catalog.read",
]);

/** An assignment counts only when it is unambiguously ACTIVE. Anything else is reported, never
 *  silently treated as live -- a disabled row that looks active through an inconsistent field is
 *  exactly the anomaly section 12 asks for. */
function assignmentState(assignment) {
  if (assignment === null || typeof assignment !== "object") return "MALFORMED";
  const status = assignment.status;
  if (status === "active") return "ACTIVE";
  if (status === "disabled") return "DISABLED";
  if (typeof status !== "string" || status.length === 0) return "MALFORMED";
  return "UNKNOWN_STATUS";
}

/** ACTIVE operational manager roles held by an employee record. Employment must be ACTIVE: an
 *  operational role on a terminated employee is not live authority. */
function activeManagerOperationalRoles(employee) {
  if (employee === null || typeof employee !== "object") return [];
  if (employee.employmentStatus !== "ACTIVE") return [];
  const roles = employee.operationalRoles;
  if (!Array.isArray(roles)) return [];
  return MANAGER_OPERATIONAL_ROLES.filter((r) => roles.includes(r));
}

/**
 * Classify one principal against the primary exposure definition.
 *
 * `input` is already-joined raw state: the principal's assignments, and the employee record the
 * join resolved (or null when it could not be resolved unambiguously).
 */
function classifyPrincipal(input) {
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];
  const active = assignments.filter((a) => assignmentState(a) === "ACTIVE");

  if (input.joinUnresolved) {
    return { classification: "PRINCIPAL_JOIN_UNRESOLVED", exposed: false, managerRoles: [], carrier: null };
  }

  const managerRoles = activeManagerOperationalRoles(input.employee);
  const carrier = active.find((a) => a.roleId === COMPATIBILITY_CARRIER_ROLE_ID) ?? null;
  const exposed = carrier !== null && managerRoles.length > 0;

  // Which governed manager Roles does this principal ALREADY hold, and at what scope?
  const governed = managerRoles.map((operational) => {
    const roleId = GOVERNED_ROLE_FOR_OPERATIONAL[operational];
    const held = active.filter((a) => a.roleId === roleId);
    return {
      operational,
      governedRoleId: roleId,
      held: held.length > 0,
      scopes: held.map((a) => scopeLabel(a.scope)),
    };
  });

  return {
    classification: exposed ? "EXPOSED" : "NOT_EXPOSED",
    exposed,
    managerRoles,
    carrier: carrier ? { assignmentId: carrier.id, scope: scopeLabel(carrier.scope), status: carrier.status } : null,
    governed,
  };
}

/** A scope rendered for reporting, with malformed shapes named rather than coerced. */
function scopeLabel(scope) {
  if (scope === null || typeof scope !== "object") return "MALFORMED";
  const t = scope.type;
  if (typeof t !== "string" || t.length === 0) return "MALFORMED";
  return scope.value === undefined ? t : `${t}:${scope.value}`;
}

/**
 * Per-capability effect of deploying R-32 for one exposed principal.
 *
 * `carrierGrants` / `governedGrants` are the capability id sets each source confers, supplied by
 * the caller from the real Role catalog -- this layer never hardcodes what a Role contains.
 *
 * TARGET_DEPENDENT is a real answer, not a hedge: a capability whose governed binding is
 * location-restricted resolves differently per warehouse target, and a census that collapsed that
 * to LOST or RETAINED would be asserting something it did not measure.
 */
function capabilityEffect({ capability, fromCarrier, fromGoverned, governedBindingScopes }) {
  if (!fromCarrier) return "NONE";
  if (!fromGoverned) return "LOST";
  if (Array.isArray(governedBindingScopes) && governedBindingScopes.length > 0) return "TARGET_DEPENDENT";
  return "RETAINED";
}

/** Diagnostic only (section 10). Never a defect on its own. */
function compareAssignedWarehouseIds(assignedWarehouseIds, governedLocationValues) {
  const legacy = Array.isArray(assignedWarehouseIds) ? assignedWarehouseIds.filter((x) => typeof x === "string") : [];
  const governed = Array.isArray(governedLocationValues) ? governedLocationValues.filter((x) => typeof x === "string") : [];
  if (legacy.length === 0 && governed.length === 0) return "BOTH_EMPTY";
  if (legacy.length === 0) return "GOVERNED_ONLY";
  if (governed.length === 0) return "ASSIGNEDWAREHOUSE_ONLY";
  const same = legacy.length === governed.length && legacy.every((x) => governed.includes(x));
  return same ? "MATCH" : "CONTRADICTORY";
}

module.exports = {
  SIX_CAPABILITIES,
  MANAGER_OPERATIONAL_ROLES,
  COMPATIBILITY_CARRIER_ROLE_ID,
  GOVERNED_ROLE_FOR_OPERATIONAL,
  assignmentState,
  activeManagerOperationalRoles,
  classifyPrincipal,
  scopeLabel,
  capabilityEffect,
  compareAssignedWarehouseIds,
};

// ---------------------------------------------------------------------------------------------
// THIN READ ADAPTER -- only runs as the main module.
// ---------------------------------------------------------------------------------------------

function parseArgs(argv, repoRoot) {
  const args = argv.slice(2);
  if (!args.includes("--read-only")) {
    throw new Error("--read-only is required and is the only mode this tool has");
  }
  const i = args.indexOf("--projectId");
  const projectId = i >= 0 ? args[i + 1] : null;
  if (!projectId) throw new Error("--projectId <id> is required; .firebaserc is never consulted");

  const envs = JSON.parse(fs.readFileSync(path.join(repoRoot, "config", "environments.json"), "utf8")).environments;
  const production = envs.filter((e) => e.role === "production" && e.firebase && e.firebase.projectId);
  if (production.length !== 1) throw new Error(`expected exactly one production environment, found ${production.length}`);
  const expected = production[0].firebase.projectId;
  if (projectId !== expected) {
    throw new Error(`refusing: --projectId ${projectId} is not the production project (${expected})`);
  }
  return { projectId };
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const { projectId } = parseArgs(process.argv, repoRoot);

  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const app = initializeApp({ credential: applicationDefault(), projectId }, "r32-census");
  const db = getFirestore(app);

  const { COMPATIBILITY_ROLES } = require(path.join(repoRoot, "functions", "lib", "access", "compatibilityRoles.js"));
  const { GOVERNED_BUSINESS_ROLES } = require(path.join(repoRoot, "functions", "lib", "access", "governedBusinessRoles.js"));
  const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

  const [assignmentsSnap, usersSnap, employeesSnap, warehousesSnap] = await Promise.all([
    db.collection("roleAssignments").get(),
    db.collection("users").get(),
    db.collection("employees").get(),
    db.collection("warehouses").get(),
  ]);

  const employees = new Map(employeesSnap.docs.map((d) => [d.id, d.data()]));
  const warehouses = new Map(warehousesSnap.docs.map((d) => [d.id, d.data()]));
  // users/{uid}.employeeId is the ONLY authoritative principal -> employee join. Never email or name.
  const employeeIdByUid = new Map(
    usersSnap.docs.map((d) => [d.id, (d.data() ?? {}).employeeId]).filter(([, e]) => typeof e === "string" && e.length > 0),
  );

  const byPrincipal = new Map();
  for (const d of assignmentsSnap.docs) {
    const a = { id: d.id, ...d.data() };
    const uid = a.principalUid;
    if (typeof uid !== "string" || uid.length === 0) {
      byPrincipal.set(`__MALFORMED__${d.id}`, [a]);
      continue;
    }
    if (!byPrincipal.has(uid)) byPrincipal.set(uid, []);
    byPrincipal.get(uid).push(a);
  }

  const out = {
    measuredAt: new Date().toISOString(),
    projectId,
    totals: {
      roleAssignments: assignmentsSnap.size,
      users: usersSnap.size,
      employees: employeesSnap.size,
      warehouses: warehousesSnap.size,
    },
    principals: [],
    managerCensus: [],
    anomalies: [],
  };

  for (const [uid, assignments] of byPrincipal) {
    const employeeId = employeeIdByUid.get(uid);
    const employee = employeeId ? employees.get(employeeId) ?? null : null;
    const joinUnresolved = uid.startsWith("__MALFORMED__") || (employeeId !== undefined && employee === null);
    const c = classifyPrincipal({ assignments, employee, joinUnresolved });

    for (const a of assignments) {
      const st = assignmentState(a);
      if (st === "MALFORMED" || st === "UNKNOWN_STATUS") out.anomalies.push({ kind: `ASSIGNMENT_${st}`, assignmentId: a.id, principalUid: uid, status: a.status ?? null });
      if (!ROLES[a.roleId]) out.anomalies.push({ kind: "ASSIGNMENT_REFERENCES_MISSING_ROLE", assignmentId: a.id, roleId: a.roleId ?? null });
      if (scopeLabel(a.scope) === "MALFORMED") out.anomalies.push({ kind: "ASSIGNMENT_MALFORMED_SCOPE", assignmentId: a.id });
    }
    if (employeeId === undefined && !uid.startsWith("__MALFORMED__")) {
      out.anomalies.push({ kind: "PRINCIPAL_HAS_NO_EMPLOYEE_LINK", principalUid: uid });
    }

    out.principals.push({
      principalUid: uid,
      employeeId: employeeId ?? null,
      classification: c.classification,
      exposed: c.exposed,
      managerOperationalRoles: c.managerRoles,
      carrier: c.carrier,
      governed: c.governed ?? [],
      activeAssignments: assignments.filter((a) => assignmentState(a) === "ACTIVE").map((a) => `${a.roleId}@${scopeLabel(a.scope)}`),
    });
  }

  // Section 8/9/10: every employee carrying an ACTIVE manager operational role, whether or not any
  // principal maps to them -- an unassigned manager is still a deployment consideration.
  for (const [employeeId, employee] of employees) {
    const managerRoles = activeManagerOperationalRoles(employee);
    if (managerRoles.length === 0) continue;
    const uid = [...employeeIdByUid.entries()].find(([, e]) => e === employeeId)?.[0] ?? null;
    const assignments = uid ? byPrincipal.get(uid) ?? [] : [];
    const active = assignments.filter((a) => assignmentState(a) === "ACTIVE");
    const row = { employeeId, principalUid: uid, managerOperationalRoles: managerRoles, governedRoles: [], locationGrants: [], assignedWarehouseComparison: null };
    for (const operational of managerRoles) {
      const roleId = GOVERNED_ROLE_FOR_OPERATIONAL[operational];
      const held = active.filter((a) => a.roleId === roleId);
      row.governedRoles.push({
        operational,
        governedRoleId: roleId,
        state: held.length > 0 ? "OPERATIONAL_AND_GOVERNED_ROLE_PRESENT" : "OPERATIONAL_ROLE_ONLY",
        scopes: held.map((a) => scopeLabel(a.scope)),
      });
      for (const a of held) {
        if (a.scope?.type !== "location") continue;
        const w = warehouses.get(a.scope.value);
        row.locationGrants.push({
          assignmentId: a.id,
          warehouseId: a.scope.value,
          state: !w ? "UNKNOWN_WAREHOUSE" : w.status === "ACTIVE" ? "VALID_ACTIVE_LOCATION" : "VALID_INACTIVE_LOCATION",
          operatingCompanyId: w?.operatingCompanyId ?? null,
        });
      }
    }
    const governedLocations = active.filter((a) => a.scope?.type === "location").map((a) => a.scope.value);
    row.assignedWarehouseComparison = compareAssignedWarehouseIds(employee.assignedWarehouseIds, governedLocations);
    out.managerCensus.push(row);
  }

  // Six-capability effect, per exposed principal.
  out.capabilityMatrix = [];
  for (const p of out.principals.filter((x) => x.exposed)) {
    for (const capability of SIX_CAPABILITIES) {
      const fromCarrier = ROLES[COMPATIBILITY_CARRIER_ROLE_ID]?.permissions.includes(capability) ?? false;
      const governedRoleIds = p.governed.filter((g) => g.held).map((g) => g.governedRoleId);
      const fromGoverned = governedRoleIds.some((r) => ROLES[r]?.permissions.includes(capability));
      const bindingScopes = governedRoleIds.map((r) => ROLES[r]?.scopesByPermission?.[capability]).find(Boolean) ?? null;
      out.capabilityMatrix.push({
        principalUid: p.principalUid, capability, fromCarrier, fromGoverned,
        effect: capabilityEffect({ capability, fromCarrier, fromGoverned, governedBindingScopes: bindingScopes }),
      });
    }
  }

  process.stdout.write(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`census failed: ${err.message}\n`);
    process.exit(1);
  });
}
