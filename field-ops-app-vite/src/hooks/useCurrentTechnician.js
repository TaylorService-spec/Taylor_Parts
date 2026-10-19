import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { useAuth } from "../auth/AuthContext";
import { USERS_COLLECTION, TECHNICIANS_COLLECTION } from "../domain/constants";
import { loadErrorMessage } from "../domain/loadErrorMessage";
// FIREBASE EXIT F1 (DECISIONS #244): where an EOS API is declared the technician link is the EOS Employee, not two Firestore reads.
import { EOS_SESSION_SOURCE } from "../access/eosSessionSource.js";

const ENTITY = "technician profile";

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
//
// site-work #3 (usecurrenttechnician-no-snapshot-error-handler): both hops
// used to pass no error callback to onSnapshot, so a DENIED or failed read
// of either document never resolved -- `loading` stayed true forever, and
// FieldMode / TechnicianDashboard were stuck on "Loading your day..." with
// no way to tell a real failure from a slow network. It now fails closed to
// a safe `error` (loadErrorMessage -- never a raw code/path/id) and clears
// any stale technician data, plus the retry re-subscription and
// obsolete-callback guard useAccount.js / useLocationsForAccount.js already
// establish for this exact shape.
// The Firebase two-hop link. `enabled === false` makes it inert (no subscription, no read): that is how an environment whose
// source is EOS keeps the hook mounted without touching Firebase.
function useFirebaseCurrentTechnician({ enabled = true } = {}) {
  const { user: authUser } = useAuth();
  const user = enabled ? authUser : null;
  const [technicianId, setTechnicianId] = useState(null);
  const [technician, setTechnician] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped by retry() to force a clean teardown + re-subscribe of BOTH hops
  // (it is a dependency of both effects below). It only changes on an
  // explicit call, so there is no loop.
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!user) {
      setTechnicianId(null);
      setTechnician(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Obsolete-callback guard: a snapshot or error that arrives after this
    // effect is torn down (user changed, unmount, or a retry) must not write
    // state belonging to a subscription that no longer exists.
    let active = true;
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      doc(db, USERS_COLLECTION, user.uid),
      (snap) => {
        if (!active) return;
        const id = snap.exists() ? (snap.data().technicianId ?? null) : null;
        setTechnicianId(id);
        if (!id) {
          setTechnician(null);
          setLoading(false);
        }
      },
      (err) => {
        if (!active) return;
        // Fail closed: clear any stale mapping/technician rather than leave
        // a previous user's data on screen looking current.
        setTechnicianId(null);
        setTechnician(null);
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [user, attempt]);

  useEffect(() => {
    if (!technicianId) return undefined;

    let active = true;
    const unsub = onSnapshot(
      doc(db, TECHNICIANS_COLLECTION, technicianId),
      (snap) => {
        if (!active) return;
        setTechnician(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        setTechnician(null);
        setError(loadErrorMessage(err, { entity: ENTITY }));
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [technicianId, attempt]);

  return { technicianId, technician, loading, error, retry };
}

// THE EOS LINK. The signed-in person's Employee, as AuthContext already resolved it from EOS (resolveMyExperienceContext +
// readMyEmployeeProfile) -- no read of its own. technicianId is the EOS employeeId (EOS never keys on a fieldops
// technician id); technician is the Employee's display name. There is NO field-status pill under EOS: TECH_STATUS has no
// EOS twin, so technician.status is left undefined and the dashboard omits the pill rather than inventing one. Whether the person
// is a technician at all is a capability question (workOrder.execution.record, access/sessionAccess.js), not this hook's.
function useEosCurrentTechnician() {
  const { user, employeeId, displayName, loading, identityError, retryIdentityResolution } = useAuth() ?? {};
  return {
    technicianId: user && employeeId ? employeeId : null,
    technician: user && employeeId ? { id: employeeId, name: displayName ?? null } : null,
    loading: Boolean(loading),
    error: identityError ?? null,
    retry: retryIdentityResolution ?? (() => {}),
  };
}

// FIREBASE ARM: HELD FOR THE PRODUCTION RECOVERY RELEASE (2026-10-19, TECH lane).
// REPLACE -> VERIFY -> REMOVE -> PROVE AGAIN: the EOS replacement above is in place and VERIFIED -- where EOS_SESSION_SOURCE is
// true this hook takes the governed Employee from AuthContext and the Firestore arm is inert (enabled:false -> no
// subscription, no read; test/technicianIdentityEos.test.jsx). It is NOT removed because the production build still runs
// Firebase (EOS_SESSION_SOURCE is false and no EOS API is declared there), and for that build users.technicianId +
// fieldops_technicians is the only technician link: deleting the arm now would leave production technicians unlinked.
// Remove it in the release that moves production to the EOS session source, not before. No consumer takes an ID from this
// hook for anything but display/profile state any more (the shell, the scanner and the offline queue use the governed
// Employee id or the signed-in principal).
/** Both hooks are always called so the rules of hooks hold; the one that is not the source is inert. eosSource is a test seam. */
export function useCurrentTechnician({ eosSource } = {}) {
  const eos = (eosSource ?? EOS_SESSION_SOURCE) === true;
  const firebase = useFirebaseCurrentTechnician({ enabled: !eos });
  const eosAnswer = useEosCurrentTechnician();
  return eos ? eosAnswer : firebase;
}
