import { createContext, useContext, useEffect, useState } from "react";
import { auth } from "../firebase/firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { resolveEmployeeSession } from "./employeeSession";

const AuthContext = createContext();

// resolveEmployeeSession()/buildEmployeeSessionResult() (Phase 3 --
// Platform Assignment Foundation; Issue #100 PR 0's employmentStatus
// addition) now live in ./employeeSession.js, a plain .js module, and
// are re-exported here unchanged so this file's existing public API
// (`import { resolveEmployeeSession } from "./AuthContext"`) still
// works. See that file's own header comment for the full rationale --
// this file contains JSX and cannot be imported by this project's
// plain-`node` unit test runner, which is why the actual resolution
// logic was moved out rather than kept inline.
export { resolveEmployeeSession, buildEmployeeSessionResult } from "./employeeSession";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [displayName, setDisplayName] = useState(null);
  const [operationalRoles, setOperationalRoles] = useState([]);
  const [employmentStatus, setEmploymentStatus] = useState(null);
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
        setEmploymentStatus(null);
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
      setEmploymentStatus(null);

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
        setEmploymentStatus(session.employmentStatus);
        setLoading(false);
      } catch (err) {
        if (!isMounted || thisGeneration !== generation) return;

        // A denied or failed read is never treated as successful
        // identity resolution, and never falls back to any default
        // role -- the authenticated Firebase user stays in `user`
        // (they really are signed in), but role/employeeId/
        // displayName/operationalRoles/employmentStatus all clear to
        // their empty defaults, the same as an unauthenticated session
        // for authorization purposes. Logged with the error code/
        // message only -- never a token, credential, or document
        // payload.
        console.error("AuthContext: failed to resolve session identity.", err?.code ?? err?.message ?? err);
        setRole(null);
        setEmployeeId(null);
        setDisplayName(null);
        setOperationalRoles([]);
        setEmploymentStatus(null);
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
      value={{ user, role, employeeId, displayName, operationalRoles, employmentStatus, login, logout, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
