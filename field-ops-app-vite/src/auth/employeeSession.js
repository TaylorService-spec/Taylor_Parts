import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { USERS_COLLECTION, EMPLOYEES_COLLECTION } from "../domain/constants";
import { buildEmployeeSessionResult } from "./employeeSessionResult";

export { buildEmployeeSessionResult };

// Phase 3 -- Platform Assignment Foundation (docs/specifications/
// employee-foundation.md, PR 3: Current Employee Session Resolution).
// Adds employeeId/displayName/operationalRoles to session context,
// resolved via an ADDITIONAL one-shot read alongside the existing
// users/{uid} read -- the existing one-shot getDoc() mechanism for
// role/employeeId itself is UNCHANGED, deliberately not converted to
// onSnapshot() in this phase (a realtime User/access-identity
// subscription affects every authenticated session platform-wide and
// is out of scope here; see the specification's "AuthContext impact"
// section for the full rationale, including why the Notification
// Panel's prior onSnapshot() conversion isn't sufficient
// justification for this different decision).
//
// Deliberately a plain .js module, not part of AuthContext.jsx --
// AuthContext.jsx imports and re-exports resolveEmployeeSession() from
// here unchanged, but a .jsx file containing JSX cannot be imported by
// this project's plain-`node` unit test runner (test/*.test.mjs, no
// transpiler). The actual shape-building logic (buildEmployeeSessionResult())
// lives in ./employeeSessionResult.js, a further split so that pure
// function alone can be unit-tested without also importing the
// Firebase SDK/app initialization this file pulls in for its Firestore
// reads -- mirrors domain/commercialProfile.js's "no Firebase import"
// convention.
//
// A linked employeeId whose Employee document doesn't exist (a broken
// link -- e.g. the Employee record was deleted out of band, which
// firestore.rules doesn't actually allow today but this still guards
// against data drift) is NOT an error: the read succeeds, the document
// simply doesn't exist. employeeId is retained (so the broken link
// itself stays visible/diagnosable) but displayName/operationalRoles/
// employmentStatus resolve to their empty defaults -- no operational
// identity is granted from a link that doesn't resolve to a real
// record. A safe warning (employeeId only, never document contents)
// is logged so this state is discoverable, not silently swallowed.
//
// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// PR 0) -- employmentStatus is now exposed alongside operationalRoles
// so the UI can proactively state "your account is not currently
// active" rather than only ever observing a silent Rules denial. Read
// from the same Employee document this function already fetches --
// no new read.
export async function resolveEmployeeSession(uid) {
  const userSnap = await getDoc(doc(db, USERS_COLLECTION, uid));
  const userData = userSnap.exists() ? userSnap.data() : null;
  const role = userData?.role ?? null;
  const employeeId = userData?.employeeId ?? null;

  // Missing employeeId is a valid, expected migration state, not an
  // error -- true for every account until
  // functions/scripts/provisionEmployeeAccess.js (PR 2) has been run
  // against it. No Employee-side read is attempted in this case.
  if (!employeeId) {
    return buildEmployeeSessionResult(role, null, null);
  }

  // Authorized by firestore.rules' employees/{employeeId} self-read
  // path (PR #82): any authenticated user may read only the Employee
  // document whose employeeId matches their own
  // users/{uid}.employeeId -- resolves correctly for every security
  // role, including technician, without any broader directory access.
  const employeeSnap = await getDoc(doc(db, EMPLOYEES_COLLECTION, employeeId));
  if (!employeeSnap.exists()) {
    console.warn(
      `AuthContext: users/${uid}.employeeId "${employeeId}" has no matching employees/${employeeId} document -- broken link, granting no operational identity.`
    );
    return buildEmployeeSessionResult(role, employeeId, null);
  }

  return buildEmployeeSessionResult(role, employeeId, employeeSnap.data());
}
