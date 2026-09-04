#!/usr/bin/env node
// Roster reconciliation classifier for docs/customer-1/identity/PRODUCTION_ROSTER_RECONCILIATION.md
// (gate C1-IDENTITY-01).
//
// The procedure document states steps R1-R5 and eleven exception classes as a prose table. This
// module is that table made executable: given already-read state for the five identity stores, it
// returns the exception list a reconciliation run would report.
//
// It is a PURE CLASSIFIER and deliberately has no I/O. It opens no connection, reads no
// credential, imports no Firebase SDK and names no Taylor person. The production read that would
// feed it -- the R1 Firebase Auth enumeration -- is still missing, and building it belongs in
// functions/scripts/ where firebase-admin and the assertProjectTarget contract already live. That
// adapter is ~30 lines around this function; the classification rules it would otherwise reinvent
// are here, tested, and reviewable without any production authorization.
//
// This module establishes nothing about production. It reconciles nothing until an authorized
// operator feeds it a real read.
//
// Assignment state and the legacy/governed location comparison are REUSED from
// functions/scripts/r32ProductionExposureCensus.js rather than restated. A second copy of
// "what counts as an active assignment" is a second answer, and the census is the one that has
// already been run against production.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const require = createRequire(import.meta.url);
// Inert on import: the census only runs its read adapter under require.main === module.
const { assignmentState, compareAssignedWarehouseIds } = require(
  join(REPO, "functions", "scripts", "r32ProductionExposureCensus.js"),
);

const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);
const byId = (rows, key) => new Map((rows ?? []).map((r) => [r?.[key], r]).filter(([k]) => str(k)));

/**
 * Classify one production roster.
 *
 * Every input is already-read raw state, supplied by the caller. `authAccounts` is the R1
 * denominator; omitting it is legitimate (no instrument reads Auth yet) and is reported as a
 * stated limit rather than silently treated as "no orphans".
 *
 * @param {object} input
 * @param {Array<{uid: string, disabled?: boolean}>} [input.authAccounts]
 * @param {Array<{uid: string, role?: string, employeeId?: string}>} [input.users]
 * @param {Array<object>} [input.employees] each carrying employeeId, userId, employmentStatus,
 *        securityRole, operationalRoles[], assignedWarehouseIds[]
 * @param {Array<{id: string, principalUid: string, roleId?: string, status?: string, scope?: object}>} [input.roleAssignments]
 * @param {string[]} [input.knownRoleIds] the Role catalog; assignments outside it are exceptions
 */
export function reconcileRoster(input = {}) {
  const authRead = Array.isArray(input.authAccounts);
  const authAccounts = authRead ? input.authAccounts : [];
  const users = byId(input.users, "uid");
  const employees = byId(input.employees, "employeeId");
  const knownRoleIds = new Set(input.knownRoleIds ?? []);

  const assignmentsByUid = new Map();
  const assignmentsWithoutPrincipal = [];
  for (const a of input.roleAssignments ?? []) {
    const uid = str(a?.principalUid);
    if (!uid) {
      assignmentsWithoutPrincipal.push(a?.id ?? null);
      continue;
    }
    if (!assignmentsByUid.has(uid)) assignmentsByUid.set(uid, []);
    assignmentsByUid.get(uid).push(a);
  }

  const exceptions = [];
  const add = (kind, fields) => exceptions.push({ kind, ...fields });

  // The principal set is the union of all three sources on purpose. Building it from
  // roleAssignments alone is the denominator problem the procedure document records.
  const uids = new Set([
    ...authAccounts.map((a) => str(a?.uid)).filter(Boolean),
    ...users.keys(),
    ...assignmentsByUid.keys(),
  ]);

  for (const uid of [...uids].sort()) {
    const account = authAccounts.find((a) => a?.uid === uid) ?? null;
    const user = users.get(uid) ?? null;
    const assignments = assignmentsByUid.get(uid) ?? [];

    if (authRead && account && !user) {
      add("ORPHAN_AUTH_ACCOUNT", { uid });
    }

    // users/{uid}.employeeId is the only authoritative join. Never email, never name.
    let employee = null;
    if (user) {
      const employeeId = str(user.employeeId);
      if (!employeeId) {
        add("PRINCIPAL_HAS_NO_EMPLOYEE_LINK", { uid });
      } else if (!employees.has(employeeId)) {
        add("PRINCIPAL_JOIN_UNRESOLVED", { uid, employeeId });
      } else {
        employee = employees.get(employeeId);
        if (str(employee.userId) !== uid) {
          add("BACK_LINK_MISMATCH", { uid, employeeId, backLink: employee.userId ?? null });
        }
        if (str(employee.securityRole) !== str(user.role)) {
          add("SECURITY_ROLE_MIRROR_DRIFT", {
            uid,
            employeeId,
            securityRole: employee.securityRole ?? null,
            userRole: user.role ?? null,
          });
        }
      }

      if (assignments.length === 0) {
        // Authority entirely from users.role + employees.operationalRoles -- exactly how this
        // system worked before the governed model existed, and invisible to the R-32 census.
        add("UNGOVERNED_PRINCIPAL", { uid });
      }
    }

    const active = [];
    for (const a of [...assignments].sort((x, y) => String(x?.id).localeCompare(String(y?.id)))) {
      const state = assignmentState(a);
      if (state === "ACTIVE") active.push(a);
      if (state === "MALFORMED" || state === "UNKNOWN_STATUS") {
        add(`ASSIGNMENT_${state}`, { uid, assignmentId: a?.id ?? null, status: a?.status ?? null });
      }
      const scope = a?.scope;
      const scopeType = scope !== null && typeof scope === "object" ? str(scope.type) : null;
      // Structural only: this module does not own the scope-type enum, so it asserts shape
      // (a type is present, and a non-global type carries a value) rather than membership.
      if (!scopeType || (scopeType !== "global" && !str(scope.value))) {
        add("ASSIGNMENT_MALFORMED_SCOPE", { uid, assignmentId: a?.id ?? null });
      }
      if (knownRoleIds.size > 0 && !knownRoleIds.has(str(a?.roleId))) {
        add("ASSIGNMENT_REFERENCES_MISSING_ROLE", { uid, assignmentId: a?.id ?? null, roleId: a?.roleId ?? null });
      }
    }

    if (employee && employee.employmentStatus !== "ACTIVE" && (active.length > 0 || (account && account.disabled !== true))) {
      add("ACCESS_ON_TERMINATED_EMPLOYEE", {
        uid,
        employeeId: employee.employeeId,
        employmentStatus: employee.employmentStatus ?? null,
        activeAssignments: active.length,
        authAccountEnabled: account ? account.disabled !== true : null,
      });
    }

    if (employee) {
      const governedLocations = active.filter((a) => a?.scope?.type === "location").map((a) => a.scope.value);
      if (compareAssignedWarehouseIds(employee.assignedWarehouseIds, governedLocations) === "CONTRADICTORY") {
        add("CONTRADICTORY_LOCATION_SCOPE", {
          uid,
          employeeId: employee.employeeId,
          assignedWarehouseIds: employee.assignedWarehouseIds,
          governedLocations,
        });
      }
    }
  }

  return {
    denominator: {
      // R1 is the gap. When Auth was not read, say so instead of implying a complete roster.
      authAccountsRead: authRead ? authAccounts.length : null,
      usersDocuments: users.size,
      principalsWithAssignments: assignmentsByUid.size,
      principalsConsidered: uids.size,
    },
    limits: authRead ? [] : ["AUTH_NOT_READ: ORPHAN_AUTH_ACCOUNT cannot be detected without an R1 Auth enumeration"],
    assignmentsWithoutPrincipal,
    exceptions,
  };
}
