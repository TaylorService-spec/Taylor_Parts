import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../firebase/firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { USERS_COLLECTION, EMPLOYEES_COLLECTION } from "../domain/constants";

const AuthContext = createContext();

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
// resolveEmployeeSession() is a pure(ish) async function -- no React
// state -- deliberately separated from the effect below so the actual
// resolution logic this component depends on is directly testable
// against a real Firestore (emulator) without needing a React
// rendering environment, which this repo has no test infrastructure
// for. Exported for exactly that purpose.
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
    return { role, employeeId: null, displayName: null, operationalRoles: [] };
  }

  // Authorized by firestore.rules' employees/{employeeId} self-read
  // path (PR #82): any authenticated user may read only the Employee
  // document whose employeeId matches their own
  // users/{uid}.employeeId -- resolves correctly for every security
  // role, including technician, without any broader directory access.
  const employeeSnap = await getDoc(doc(db, EMPLOYEES_COLLECTION, employeeId));
  const employeeData = employeeSnap.exists() ? employeeSnap.data() : null;
  return {
    role,
    employeeId,
    displayName: employeeData?.displayName ?? null,
    operationalRoles: employeeData?.operationalRoles ?? [],
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [displayName, setDisplayName] = useState(null);
  const [operationalRoles, setOperationalRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Race-condition guard: onAuthStateChanged's callback is async
    // (two awaited getDoc() calls), so a second auth-state event (or
    // unmount) can fire while an earlier callback's reads are still in
    // flight -- e.g. sign-out while the previous sign-in's
    // users/{uid}/employees/{employeeId} reads haven't resolved yet.
    // `generation` is bumped on every callback invocation; each async
    // continuation checks it's still the most recent one before
    // calling setState, so a stale resolution is silently discarded
    // rather than overwriting a newer (or cleared) session state.
    // `isMounted` guards the same continuations against firing after
    // this effect has been cleaned up.
    let generation = 0;
    let isMounted = true;

    const unsub = onAuthStateChanged(auth, async (u) => {
      generation += 1;
      const thisGeneration = generation;

      if (!isMounted) return;
      setUser(u);

      if (!u) {
        setRole(null);
        setEmployeeId(null);
        setDisplayName(null);
        setOperationalRoles([]);
        setLoading(false);
        return;
      }

      // Still fundamentally a one-shot resolution, unchanged in
      // mechanism from before Phase 3 -- resolveEmployeeSession() just
      // factors the two getDoc() calls (users/{uid}, then
      // employees/{employeeId} if linked) into a directly-testable
      // function; see its own comment above.
      const session = await resolveEmployeeSession(u.uid);
      if (!isMounted || thisGeneration !== generation) return;

      setRole(session.role);
      setEmployeeId(session.employeeId);
      setDisplayName(session.displayName);
      setOperationalRoles(session.operationalRoles);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  const login = (email, password) =>
    signInWithEmailAndPassword(auth, email, password);

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider
      value={{ user, role, employeeId, displayName, operationalRoles, login, logout, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
