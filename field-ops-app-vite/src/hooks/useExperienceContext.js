// The one React hook that reads the EOS principal experience context.
//
// It calls POST /operations/experience once per signed-in principal and hands the result to
// access/experienceContext.js, which does all the interpretation. This file owns the LIFECYCLE only:
// when to fetch, how to discard a stale answer, and how to retry.
//
// WHEN THE SEAM IS OFF (EOS_NAVIGATION_AUTHORITY_READY === false) THIS HOOK MAKES NO REQUEST AT ALL.
// It is a compile-time constant, not a runtime probe: the code never reaches the network to find out
// whether it should have.
//
// NO FALLBACK LIVES HERE EITHER. A failed call yields UNAVAILABLE, which grants nothing. The caller
// renders that as a refusal; it must never be read as "use the legacy role instead".
import { useCallback, useEffect, useMemo, useState } from "react";
import { operationsApiClient } from "../services/operationsApiClient.js";
import {
  EXPERIENCE_STATE,
  EXPERIENCE_UNAVAILABLE_REASON,
  buildNavigationAuthority,
  experienceContextFrom,
} from "../access/experienceContext.js";
import { EOS_NAVIGATION_AUTHORITY_READY } from "../config/navigationAuthorityReadiness.js";

export const EXPERIENCE_OPERATION = "resolveMyExperienceContext";

/**
 * @param {object} options
 * @param {{call: Function}} [options.client]   injectable transport seam
 * @param {string|null} [options.principalKey]  the signed-in subject; a change re-resolves from scratch
 * @param {boolean} [options.enabled]           defaults to the environment's readiness flag
 * @returns {{authority: object|null, state: string, reason: string|null, reload: Function}}
 *          `authority` is null when the seam is OFF -- which is how every caller knows to keep using
 *          the legacy path. It is never null while the seam is ON, precisely so that "on" can never
 *          quietly mean "off".
 */
export function useExperienceContext({
  client = operationsApiClient,
  principalKey = null,
  enabled = EOS_NAVIGATION_AUTHORITY_READY,
} = {}) {
  const active = enabled === true && typeof principalKey === "string" && principalKey.length > 0;
  const [state, setState] = useState(active ? EXPERIENCE_STATE.LOADING : EXPERIENCE_STATE.LOADING);
  const [context, setContext] = useState(null);
  const [reason, setReason] = useState(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!active) {
      setState(EXPERIENCE_STATE.LOADING);
      setContext(null);
      setReason(null);
      return undefined;
    }
    let cancelled = false;
    // The PREVIOUS principal's context is cleared before the new read starts. Pairing a new subject
    // with the previous subject's surfaces -- even for one render -- is exactly the shared-device
    // failure AuthContext already guards against, and it would be worse here because these are
    // navigation grants.
    setState(EXPERIENCE_STATE.LOADING);
    setContext(null);
    setReason(null);

    (async () => {
      const result = await client.call(EXPERIENCE_OPERATION);
      if (cancelled) return;
      if (!result?.ok) {
        setState(EXPERIENCE_STATE.UNAVAILABLE);
        setReason(result?.code ?? "INTERNAL");
        return;
      }
      const projected = experienceContextFrom(result.result);
      if (!projected) {
        // Malformed is UNAVAILABLE, never REFUSED: a payload this bundle cannot read is a transport
        // fault, and reporting it as "you hold nothing" would blame the person for a broken deploy.
        setState(EXPERIENCE_STATE.UNAVAILABLE);
        setReason("MALFORMED_RESULT");
        return;
      }
      setContext(projected);
      setState(projected.surfaces.length > 0 ? EXPERIENCE_STATE.READY : EXPERIENCE_STATE.REFUSED);
      setReason(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, client, principalKey, generation]);

  const authority = useMemo(
    () => (enabled === true ? buildNavigationAuthority({ state, context, reason }) : null),
    [enabled, state, context, reason],
  );

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  return { authority, state, reason, context, reload };
}

export { EXPERIENCE_STATE, EXPERIENCE_UNAVAILABLE_REASON };
