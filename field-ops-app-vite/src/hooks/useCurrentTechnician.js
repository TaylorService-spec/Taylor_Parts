import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { WORK_ORDER_READ_RESULT, readSelfTechnician } from "../access/scopedWorkOrderClient.js";
import { loadErrorMessage } from "../domain/loadErrorMessage";

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
export function useCurrentTechnician() {
  const { user } = useAuth();
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

    // Obsolete-callback guard: a result or error that arrives after this effect is torn down
    // (user changed, unmount, or a retry) must not write state belonging to a read that no longer
    // matters.
    let active = true;
    setLoading(true);
    setError(null);

    // ONE CALL, WHERE THERE WERE TWO SUBSCRIPTIONS. The seam resolves uid -> technician AND reads
    // the profile, both server-side, so this hook no longer knows that `users/{uid}.technicianId`
    // is where the mapping lives -- and no client does.
    //
    // ONE-SHOT, AND THAT WAS MEASURED RATHER THAN ASSUMED. The writer census for
    // fieldops_technicians on this branch found exactly one live mutation path for an EXISTING
    // technician's status: the trusted `completeAssignedJob` callable, which a technician invokes
    // from this very session. The cross-session writer that used to exist -- a dispatcher's
    // `assignJob` flipping a technician to ON_JOB -- was deleted as dead code. So a successful
    // mutation followed by `retry()` is exact parity here, which is what the ruling allows.
    //
    // The uid -> technician MAPPING is changed only by an out-of-band Admin-SDK operator script
    // (functions/scripts/assignTechnicianToUser.js); there is no in-product administrative
    // operation for it. `retry()` remains the refresh affordance for that case.
    (async () => {
      const res = await readSelfTechnician();
      if (!active) return;
      if (!res.ok) {
        // Fail closed: clear any stale mapping/technician rather than leave a previous user's data
        // on screen looking current.
        setTechnicianId(null);
        setTechnician(null);
        setError(
          loadErrorMessage(
            { code: res.result === WORK_ORDER_READ_RESULT.DENIED ? "permission-denied" : "unavailable" },
            { entity: ENTITY },
          ),
        );
        setLoading(false);
        return;
      }
      // An UNMAPPED principal is a real, benign state, not an error: the mapping is an out-of-band
      // operator action, and the consuming surfaces already render "no operational identity".
      setTechnicianId(res.technicianId);
      setTechnician(res.technician);
      setError(null);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [user, attempt]);

  return { technicianId, technician, loading, error, retry };
}
