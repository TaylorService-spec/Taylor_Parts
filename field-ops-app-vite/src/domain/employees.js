import { readGovernedList } from "../access/governedCollectionClient.js";
import { EMPLOYMENT_STATUS } from "./constants";

// Phase 3 -- Platform Assignment Foundation (docs/specifications/employee-foundation.md).
// Read-only query service over employees -- there is no write function here, and none should ever
// be added. The only writer of employees/{employeeId} is functions/scripts/provisionEmployeeAccess.js
// (Admin SDK, by design).
//
// THROUGH THE GOVERNED SOURCES, not a client-composed Firestore query. This module used to build
// `query(collection(db, "employees"), ...clauses)` and hand it to a caller's onSnapshot. It now
// names a source id and supplies values for that source's declared filters; the server owns the
// collection, the field names, the operators and the workforce.directory.read check.
//
// employmentStatus remains the authoritative Employee lifecycle field -- there is no `active`
// boolean anywhere in this schema, and Phase 3 assignment eligibility is ACTIVE only.

// TWO SOURCES, because the two shapes cannot share an ordering (see governedReadRegistry.ts).
// `requireLinkedUser` selects between them rather than toggling a filter: the linked read carries a
// `userId != null` inequality, which Firestore requires be the first orderBy, while the unlinked
// read must NOT order by userId -- orderBy silently excludes documents missing the field, which is
// precisely the population "unlinked" exists to include.
const SOURCE_LINKED = "assignableEmployeesLinked";
const SOURCE_ALL = "assignableEmployeesAll";

/**
 * Employees who may be assigned work.
 *
 * `requireLinkedUser` defaults to true because every Phase 3 consumer needs a real `users/{uid}` to
 * assign work to -- an Employee with no linked User cannot be the target of a later
 * per-user-restricted write.
 *
 * Returns the governed client's own outcome shape (`{ ok, result, items, ... }`) rather than
 * throwing, so a caller can keep DENIED distinct from UNAVAILABLE.
 */
export function readAssignableEmployees({ requiredOperationalRole, requireLinkedUser = true } = {}) {
  const filters = { employmentStatus: EMPLOYMENT_STATUS.ACTIVE };
  if (requiredOperationalRole) filters.operationalRole = requiredOperationalRole;
  // The value is only ever `null` -- the source declares the operator (`!=`), so this supplies the
  // right-hand side and nothing else. A caller cannot turn this into a different comparison.
  if (requireLinkedUser) filters.hasLinkedUser = null;

  return readGovernedList({
    sourceId: requireLinkedUser ? SOURCE_LINKED : SOURCE_ALL,
    filters,
    pageSize: 200,
  });
}

/**
 * The whole directory, unfiltered.
 *
 * Deliberately carries NO employmentStatus/operationalRoles/userId clause: it resolves an
 * already-persisted actor uid back to a display name, and a historical actor may since have gone
 * INACTIVE, lost their operationalRoles, or -- an admin or dispatcher acting in a security role
 * rather than an operational one -- never have had a linked Employee at all. Filtering here would
 * turn a real past actor into an unresolvable id.
 */
export function readEmployeeDirectory() {
  return readGovernedList({ sourceId: "employeeDirectory", pageSize: 200 });
}
