import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../firebase/firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { USERS_COLLECTION } from "../domain/constants";

const AuthContext = createContext();

// Explicit auth lifecycle states, so "not resolved yet" is never
// confused with "resolved and signed out" -- AuthGate is the only
// consumer that needs to branch on this.
export const AUTH_STATUS = {
  LOADING: "loading",
  AUTHENTICATED: "authenticated",
  UNAUTHENTICATED: "unauthenticated",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries a transient Firestore read failure (e.g. a flaky connection
// right after sign-in) rather than leaving role/technicianId stuck at
// null after one failed attempt. A doc that legitimately doesn't exist
// isn't an error -- that returns null immediately, no retry.
async function fetchUserDoc(uid, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const snap = await getDoc(doc(db, USERS_COLLECTION, uid));
      return snap.exists() ? snap.data() : null;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await sleep(300 * attempt);
    }
  }
}

export function AuthProvider({ children }) {
  // Temporary diagnostic: confirms AuthProvider mounts exactly once (two
  // logs in dev is expected StrictMode double-invoke, not a bug -- watch
  // for more than that, which would mean two real provider instances
  // and therefore two competing onAuthStateChanged listeners). Remove
  // once the lifecycle testing is done.
  console.log("AUTH PROVIDER INSTANCE");

  const [status, setStatus] = useState(AUTH_STATUS.LOADING);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [technicianId, setTechnicianId] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setStatus(AUTH_STATUS.LOADING);

      if (!firebaseUser) {
        setUser(null);
        setRole(null);
        setTechnicianId(null);
        setStatus(AUTH_STATUS.UNAUTHENTICATED);
        return;
      }

      setUser(firebaseUser);

      try {
        const data = await fetchUserDoc(firebaseUser.uid);
        // Temporary diagnostic: shows exactly which uid was queried and
        // what Firestore returned for it -- remove once resolved.
        console.log("USER DOC LOOKUP:", { uid: firebaseUser.uid, data });
        setRole(data?.role ?? null);
        setTechnicianId(data?.technicianId ?? null);
      } catch (err) {
        console.error("Role fetch failed after retries:", err);
        setRole(null);
        setTechnicianId(null);
      }

      setStatus(AUTH_STATUS.AUTHENTICATED);
    });
    return () => unsub();
  }, []);

  const login = (email, password) =>
    signInWithEmailAndPassword(auth, email, password);

  const logout = () => signOut(auth);

  const value = {
    user,
    role,
    technicianId,
    status,
    isLoading: status === AUTH_STATUS.LOADING,
    isAuthenticated: status === AUTH_STATUS.AUTHENTICATED,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
