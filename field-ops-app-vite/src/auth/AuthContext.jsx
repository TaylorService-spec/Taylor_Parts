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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [technicianId, setTechnicianId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (u) {
        const roleSnap = await getDoc(doc(db, USERS_COLLECTION, u.uid));
        const data = roleSnap.exists() ? roleSnap.data() : null;
        setRole(data?.role ?? null);
        setTechnicianId(data?.technicianId ?? null);
      } else {
        setRole(null);
        setTechnicianId(null);
      }

      setLoading(false);
    });
    return unsub;
  }, []);

  const login = (email, password) =>
    signInWithEmailAndPassword(auth, email, password);

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ user, role, technicianId, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
