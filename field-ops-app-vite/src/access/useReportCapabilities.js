// Issue #325 / ADR-007 -- the React hook that integrates the trusted effective-access feed into
// client capability gating. On sign-in it asks Inventory's resolveEffectiveAccess callable for a
// decision on the wave-1 Report Builder capabilities, and exposes a fail-closed hasCapability the
// nav gate (navConfig.js capabilityAccess) consults via operationalContext.
//
// Fail-closed by construction: hasCapability grants only from a SUCCESSFUL, current-principal
// decision (buildHasCapability). While loading, on any error/unavailable/malformed result, when
// signed out, and across a principal change, it denies. Because the callable is UNDEPLOYED, a
// production call rejects -> error -> denied: production stays fail-closed until a separate,
// explicit deployment + Owner authorization.
//
// Stale-guarded: the effect is keyed on the principal uid, resets to loading on every change, and a
// `cancelled` flag discards a late response from a previous principal -- one principal's decisions
// are never applied to another. Governed access is derived ONLY from the callable; this hook never
// reads users/{uid}.role, Role names, or client Role definitions.
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";
import {
  REPORT_CAPABILITY_REQUEST, FEED_STATUS, SIGNED_OUT_STATE,
  interpretAccessResult, buildHasCapability,
} from "./reportCapabilityAccess.js";

// The callable's onCall export name (functions/src/index.ts), region us-central1 (firebase.js binds
// the functions instance to that region and, in ?emulator=1 dev, to the local Functions emulator).
const RESOLVE_EFFECTIVE_ACCESS_CALLABLE = "resolveEffectiveAccessCallable";

// `callFeed` is injectable ONLY for tests/harness (a fake callable); production always uses the
// real httpsCallable, which is what stays fail-closed while the function is undeployed.
export function useReportCapabilities(user, callFeed) {
  const uid = user?.uid ?? null;
  const [state, setState] = useState(SIGNED_OUT_STATE);

  useEffect(() => {
    if (!uid) {
      // Signed out (or user cleared): drop every prior decision immediately.
      setState(SIGNED_OUT_STATE);
      return undefined;
    }

    let cancelled = false;
    setState({ status: FEED_STATUS.LOADING, forUid: uid, decisions: null });

    const invoke = callFeed
      ?? ((permissionIds) => httpsCallable(functions, RESOLVE_EFFECTIVE_ACCESS_CALLABLE)({ permissionIds }));

    Promise.resolve()
      .then(() => invoke(REPORT_CAPABILITY_REQUEST))
      .then((res) => {
        if (cancelled) return; // a later principal took over -- discard this stale response
        const interpreted = interpretAccessResult(res?.data);
        setState(interpreted.ok
          ? { status: FEED_STATUS.READY, forUid: uid, decisions: interpreted.decisions }
          : { status: FEED_STATUS.ERROR, forUid: uid, decisions: null });
      })
      .catch(() => {
        if (cancelled) return;
        // unavailable / not-deployed / any rejection -> fail closed.
        setState({ status: FEED_STATUS.ERROR, forUid: uid, decisions: null });
      });

    return () => { cancelled = true; };
  }, [uid, callFeed]);

  // Recomputed each render; `uid` is the CURRENT principal, so a decision set still tagged to a
  // previous principal (forUid !== uid) never grants during the frame before the effect re-runs.
  const hasCapability = buildHasCapability(state, uid);
  return { hasCapability, status: state.status };
}
