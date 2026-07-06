import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useAuth } from "../auth/AuthContext";
import { USERS_COLLECTION, TECHNICIANS_COLLECTION } from "../domain/constants";

// Epic 6 Phase 6.1 -- resolves the signed-in user to their technician
// document, in two hops:
//   users/{uid}.technicianId (PT-001's mapping field)
//   -> fieldops_technicians/{technicianId} (name/phone/status)
//
// Deliberately NOT added to auth/AuthContext.jsx: that file is shared
// by every screen in this app (admin/dispatcher/technician alike) and
// currently only reads `role`; this hook is scoped to the one new
// technician-facing feature that actually needs the second hop, per
// this phase's "UI + read-layer composition only" scope -- not an
// auth-system change.
//
// Both hops use onSnapshot (not a one-shot getDoc) so a status change
// (e.g. an admin/dispatcher toggling TECH_STATUS) or a technicianId
// remapping (PT-001's assignTechnicianToUser.js run again) reflects
// live, matching this app's existing real-time convention everywhere
// else.
export function useCurrentTechnician() {
  const { user } = useAuth();
  const [technicianId, setTechnicianId] = useState(null);
  const [technician, setTechnician] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setTechnicianId(null);
      setTechnician(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(doc(db, USERS_COLLECTION, user.uid), (snap) => {
      const id = snap.exists() ? (snap.data().technicianId ?? null) : null;
      setTechnicianId(id);
      if (!id) {
        setTechnician(null);
        setLoading(false);
      }
    });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!technicianId) return undefined;

    const unsub = onSnapshot(doc(db, TECHNICIANS_COLLECTION, technicianId), (snap) => {
      setTechnician(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    });

    return () => unsub();
  }, [technicianId]);

  return { technicianId, technician, loading };
}
