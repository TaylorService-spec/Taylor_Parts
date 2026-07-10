import { collection, query, where } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { EMPLOYEES_COLLECTION, EMPLOYMENT_STATUS } from "./constants";

// Phase 3 -- Platform Assignment Foundation (docs/specifications/
// employee-foundation.md). Read-only query service over the
// employees collection -- there is no write function here, and none
// should ever be added. The only writer of employees/{employeeId} is
// functions/scripts/provisionEmployeeAccess.js (Admin SDK, bypasses
// firestore.rules by design, same posture as inventory_transactions'
// Admin-SDK-only write path). Consumed by hooks/useAssignableEmployees.js.
//
// employmentStatus is the authoritative Employee lifecycle field --
// there is no `active` boolean anywhere in this schema. Phase 3
// assignment eligibility is EMPLOYMENT_STATUS.ACTIVE only.
const employeesRef = collection(db, EMPLOYEES_COLLECTION);

// requireLinkedUser defaults to true because every Phase 3 consumer of
// this query (EmployeeAssignmentPicker, later Reorder Request
// assignment adoption) needs a real users/{uid} to assign work to --
// an Employee with no linked User can't be the target of a later
// per-user-restricted write (see firestore.rules' reorder_requests
// assignment-transition pattern this collection is meant to feed).
export function buildAssignableEmployeesQuery({ requiredOperationalRole, requireLinkedUser = true } = {}) {
  const clauses = [where("employmentStatus", "==", EMPLOYMENT_STATUS.ACTIVE)];

  if (requiredOperationalRole) {
    clauses.push(where("operationalRoles", "array-contains", requiredOperationalRole));
  }

  if (requireLinkedUser) {
    clauses.push(where("userId", "!=", null));
  }

  return query(employeesRef, ...clauses);
}
