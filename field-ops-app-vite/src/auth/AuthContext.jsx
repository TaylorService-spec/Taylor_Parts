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
//
// A linked employeeId whose Employee document doesn't exist (a broken
// link -- e.g. the Employee record was deleted out of band, which
// firestore.rules doesn't actually allow today but this still guards
// against data drift) is NOT an error: the read succeeds, the document
// simply doesn't exist. employeeId is retained (so the broken link
// itself stays visible/diagnosable) but displayName/operationalRoles
// resolve to their empty defaults -- no operational identity is
// granted from a link that doesn't resolve to a real record. A safe
// warning (employeeId only, never document contents) is logged so this
// state is discoverable, not silently swallowed.
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
  if (!employeeSnap.exists()) {
    console.warn(
      `AuthContext: users/${uid}.employeeId "${employeeId}" has no matching employees/${employeeId} document -- broken link, granting no operational identity.`
    );
    return { role, employeeId, displayName: null, operationalRoles: [] };
  }

  const employeeData = employeeSnap.data();
  return {
    role,
    employeeId,
    displayName: employeeData.displayName ?? null,
    operationalRoles: employeeData.operationalRoles ?? [],
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
    // (one or two awaited getDoc() calls), so a second auth-state
    // event (or unmount) can fire while an earlier callback's reads
    // are still in flight -- e.g. sign-out while the previous
    // sign-in's users/{uid}/employees/{employeeId} reads haven't
    // resolved yet, or User A's resolution still pending when User B
    // signs in on a shared device. `generation` is bumped on every
    // callback invocation; each async continuation checks it's still
    // the most recent one before calling setState, so a stale
    // resolution is silently discarded rather than overwriting a newer
    // (or cleared) session state. `isMounted` guards the same
    // continuations against firing after this effect has been cleaned
    // up.
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

      // Clear the PREVIOUS session's identity immediately, before
      // awaiting the new user's resolution -- otherwise, while
      // resolution is in flight, this context would briefly pair a
      // brand-new Firebase Auth user with a stale role/Employee
      // snapshot left over from whoever was signed in before. Unsafe
      // on shared devices and during rapid sign-out/sign-in
      // transitions. loading is also restored to true here, not just
      // at mount, so any consumer gating on `loading` correctly waits
      // out this resolution too.
      setLoading(true);
      setRole(null);
      setEmployeeId(null);
      setDisplayName(null);
      setOperationalRoles([]);

      try {
        // Still fundamentally a one-shot resolution, unchanged in
        // mechanism from before Phase 3 -- resolveEmployeeSession()
        // just factors the getDoc() calls into a directly-testable
        // function; see its own comment above.
        const session = await resolveEmployeeSession(u.uid);
        if (!isMounted || thisGeneration !== generation) return;

        setRole(session.role);
        setEmployeeId(session.employeeId);
        setDisplayName(session.displayName);
        setOperationalRoles(session.operationalRoles);
        setLoading(false);
      } catch (err) {
        if (!isMounted || thisGeneration !== generation) return;

        // A denied or failed read is never treated as successful
        // identity resolution, and never falls back to any default
        // role -- the authenticated Firebase user stays in `user`
        // (they really are signed in), but role/employeeId/
        // displayName/operationalRoles all clear to their empty
        // defaults, the same as an unauthenticated session for
        // authorization purposes. Logged with the error code/message
        // only -- never a token, credential, or document payload.
        console.error("AuthContext: failed to resolve session identity.", err?.code ?? err?.message ?? err);
        setRole(null);
        setEmployeeId(null);
        setDisplayName(null);
        setOperationalRoles([]);
        setLoading(false);
      }
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
