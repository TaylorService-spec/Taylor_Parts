import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { auth } from "../firebase/firebase";
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { resolveEmployeeSession } from "./employeeSession";
// ADDITIVE EOS SESSION (docs/architecture/eos-identity-session-foundation.md, 3(e)). When a valid EOS access
// token is present the session is signed in through EOS and identity comes from the EOS API; otherwise the
// Firebase path below runs exactly as before.
import { clearEosSession, clearEosScopedSessionStorage, readEosSession } from "./eosSession";
import { eosSessionUser, resolveEosSessionIdentity } from "./eosSessionIdentity";
import { operationsApiClient } from "../services/operationsApiClient.js";
import { workforceApiClient } from "../services/workforceApiClient.js";
// FIREBASE EXIT F1: where an EOS API is declared, identity comes from EOS (the person still signs in through Firebase);
// elsewhere the Firestore path below is the sole source. A compile-time choice -- there is no fallback on failure.
import { EOS_SESSION_SOURCE } from "../access/eosSessionSource.js";
import { resolveEosEmployeeSession } from "./eosEmployeeSession.js";
// EOS NATIVE LOGIN (docs/architecture/eos-native-identity.md, 3(e)): the human front door. Off unless the build enables it.
import { eosHumanLoginEnabled, eosLoginClient } from "./eosLoginClient.js";
// FIREBASE EXIT B2: in an EOS-only sign-in build there is no Firebase app (auth is null) and this context never touches
// Firebase: no subscription, no sign-in, no sign-out, no password-reset email. The EOS session is the only way in.
import { EOS_AUTH_ONLY } from "./authSource.js";

const eosOnlyRefusal = () => Promise.reject(Object.assign(new Error("this build signs in through EOS only"), { code: "EOS_AUTH_ONLY" }));

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
  const [identityError, setIdentityError] = useState(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  // One silent session restore per page load: a tab reopened after the access token lapsed but within the refresh
  // window resumes without a sign-in. Attempted once, so a failed exchange can never loop.
  const restoreAttempted = useRef(false);

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

    // ── EOS SESSION ── checked once per mount/retry. While it is present, Firebase auth state is not
    // subscribed: one session, one identity source, never two identities paired in one context.
    // EOS NATIVE LOGIN: the refresh credential is an HttpOnly cookie this code cannot see, so a reload ASKS once whether
    // it still holds a session. One request per page load; a refusal falls through to the Firebase path below.
    if (eosHumanLoginEnabled() && !restoreAttempted.current && !eosLoginClient.currentSession()) {
      restoreAttempted.current = true;
      setLoading(true);
      eosLoginClient.refresh().finally(() => {
        if (isMounted) setRetryGeneration((n) => n + 1);
      });
      return () => {
        isMounted = false;
      };
    }

    // A human login's session lives in memory (eosLoginClient); the nonprod persona harness's in sessionStorage.
    const humanSession = eosHumanLoginEnabled() ? eosLoginClient.currentSession() : null;
    const eosSession = humanSession ?? readEosSession();
    if (eosSession) {
      setUser(humanSession
        // The bearer is fetched fresh on every call: the access token lasts five minutes and is refreshed by cookie.
        ? Object.freeze({ uid: humanSession.subject, identitySource: "eos", getIdToken: () => eosLoginClient.freshAccessToken() })
        : eosSessionUser(eosSession));
      setLoading(true);
      setIdentityError(null);
      setRole(null);
      setEmployeeId(null);
      setDisplayName(null);
      setOperationalRoles([]);
      setEmploymentStatus(null);
      // Where EOS is the session source the identity is the SAME read a Firebase-signed-in person gets (F1): the Employee link
      // plus the display name and employment status from the governed profile read, so an EOS sign-in shows a name. An EOS
      // sign-in has no legacy role either way. Elsewhere (production never reaches here) the experience context alone.
      const resolveIdentity = EOS_SESSION_SOURCE
        ? resolveEosEmployeeSession({ operations: operationsApiClient, workforce: workforceApiClient })
        : resolveEosSessionIdentity(operationsApiClient);
      resolveIdentity.then((identity) => {
        if (!isMounted) return;
        setRole(identity.role);
        setEmployeeId(identity.employeeId);
        setDisplayName(identity.displayName);
        // No legacy operational-role list for an EOS session: scope and eligibility are the server's.
        setOperationalRoles([]);
        setEmploymentStatus(identity.employmentStatus);
        setLoading(false);
      }, (err) => {
        if (!isMounted) return;
        // Refused or unreachable: signed in, but no identity -- the same fail-closed shape as a Firebase
        // resolution failure below. Never a fallback role.
        console.error("AuthContext: failed to resolve EOS session identity.", err?.code ?? err?.message ?? err);
        setIdentityError("Your account details could not be loaded. Please retry.");
        setLoading(false);
      });
      // The session can END server-side (revoked, disabled, expired): the client then holds no token, and this context
      // re-runs and signs the person out rather than leaving a signed-in shell that every request refuses.
      const unsubscribe = humanSession ? eosLoginClient.subscribe((next) => {
        if (!next && isMounted) setRetryGeneration((n) => n + 1);
      }) : null;
      return () => {
        isMounted = false;
        if (unsubscribe) unsubscribe();
      };
    }

    // EOS-ONLY SIGN-IN: no EOS session means signed out. Firebase auth state is never subscribed (there is no Firebase app).
    if (EOS_AUTH_ONLY) {
      setUser(null);
      setRole(null);
      setEmployeeId(null);
      setDisplayName(null);
      setOperationalRoles([]);
      setEmploymentStatus(null);
      setIdentityError(null);
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

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
      setIdentityError(null);
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
        const session = EOS_SESSION_SOURCE
          ? await resolveEosEmployeeSession({ operations: operationsApiClient, workforce: workforceApiClient })
          : await resolveEmployeeSession(u.uid);
        if (!isMounted || thisGeneration !== generation) return;

        setRole(session.role);
        setEmployeeId(session.employeeId);
        setDisplayName(session.displayName);
        // An EOS-sourced session carries no legacy role list (scope and eligibility are the server's): the empty default.
        setOperationalRoles(session.operationalRoles ?? []);
        setEmploymentStatus(session.employmentStatus);
        setLoading(false);
      } catch (err) {
        if (!isMounted || thisGeneration !== generation) return;

        setIdentityError("Your account details could not be loaded. Please retry.");
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
  }, [retryGeneration]);

  const login = (email, password) =>
    EOS_AUTH_ONLY ? eosOnlyRefusal() : signInWithEmailAndPassword(auth, email, password);

  // After an EOS login stored its session: resolve identity from the EOS API, exactly as for any EOS session.
  const eosSignedIn = useCallback(() => setRetryGeneration((n) => n + 1), []);

  const logout = async () => {
    // Ending an EOS session clears its token (and, with the front door enabled, revokes it on the server); the
    // Firebase sign-out is unchanged.
    const hadEosSession = readEosSession() !== null || (eosHumanLoginEnabled() && eosLoginClient.currentSession() !== null);
    try {
      if (eosHumanLoginEnabled()) await eosLoginClient.logout();
    } catch {
      // The client already treats an unreachable server as "local session gone"; nothing below may be skipped.
    }
    // Whatever the server call did, the client session ends: nothing is left half signed in.
    clearEosSession();
    clearEosScopedSessionStorage();
    if (hadEosSession) {
      setUser(null);
      setRole(null);
      setEmployeeId(null);
      setDisplayName(null);
      setOperationalRoles([]);
      setEmploymentStatus(null);
      setRetryGeneration((n) => n + 1);
    }
    return EOS_AUTH_ONLY ? undefined : signOut(auth);
  };

  // AUTH-PR-2 self-service recovery (email-input path). Fire-and-forget: asks
  // Firebase to send a password-reset email. Callers MUST show a neutral
  // confirmation regardless of the outcome -- never reveal whether the address
  // exists (see Login.jsx). This does not touch auth STATE, so AuthContext
  // remains the single source of auth truth. Username-input recovery and
  // username login are DEFERRED (D-RESOLVER) and are intentionally absent.
  const resetPassword = (email) => (EOS_AUTH_ONLY ? eosOnlyRefusal() : sendPasswordResetEmail(auth, email));

  return (
    <AuthContext.Provider
      value={{ user, role, employeeId, displayName, operationalRoles, employmentStatus, login, logout, resetPassword, eosSignedIn, loading, identityError, retryIdentityResolution: () => setRetryGeneration((n) => n + 1) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
