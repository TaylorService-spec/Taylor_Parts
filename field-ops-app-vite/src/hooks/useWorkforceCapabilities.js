// Which WORKFORCE controls this caller may be OFFERED -- answered by PostgreSQL, the authority that authorizes them
// (Workforce census finding #17).
//
//   browser -> readMyWorkforceCapabilities (services/workforceApiClient.js) -> the Workforce transport
//           -> the caller's resolved EOS Principal, ACTIVE membership, Roles and eos_policy.role_capabilities
//           -> { capabilities: [...] } intersected with the closed Workforce list
//
// The Administration Employee pages used to decide the Workforce offer from the Firebase effective-access feed while the
// Workforce server authorized the same command from PostgreSQL, so the two could disagree. This hook is the one place
// those pages now ask. It does NOT replace the app-wide feed: navigation, User Access, Security Roles, password reset
// and account status still come from that feed, because their authorities still live there.
//
// FAIL CLOSED. Nothing is granted while the read is in flight, when it is refused or fails, when the answer is
// malformed, or when no one is signed in. A failed read is a FAILED state the page states honestly -- it is never
// presented as "not granted" or "not configured", and nothing else is consulted in its place.
//
// OFFER ONLY. A positive answer decides what to render; every Workforce command re-checks its capability server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { workforceApiClient } from "../services/workforceApiClient.js";
import {
  MY_WORKFORCE_CAPABILITIES_OPERATION,
  WORKFORCE_CAPABILITY_REQUEST,
  workforceCapabilitiesFrom,
} from "../access/workforceCapabilityAccess.js";

export { MY_WORKFORCE_CAPABILITIES_OPERATION, workforceCapabilitiesFrom };
/** The closed list (access/workforceCapabilityAccess.js), mirrored from the server. Existing ids only. */
export const WORKFORCE_CAPABILITY_IDS = WORKFORCE_CAPABILITY_REQUEST;

export const WORKFORCE_CAPABILITY_STATE = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
});

/** The subject the page's honest unavailable wording names when this read fails (describeWorkforceFailure). */
export const WORKFORCE_CAPABILITY_SUBJECT = "Your Workforce permission check";

const MALFORMED = Object.freeze({ ok: false, code: "INTERNAL", reason: "MALFORMED_CAPABILITIES", message: "the Workforce capability answer was malformed" });
const SIGNED_OUT = Object.freeze({ ok: false, code: "NOT_SIGNED_IN", reason: null, message: "sign in to reach the Workforce service" });

/**
 * @param options.client        the Workforce client seam ({ call })
 * @param options.principalKey  the signed-in session's key, used ONLY to re-read on a principal change; `null` means
 *                              signed out (denied, nothing is called). Never sent to the server.
 * @returns { status, error, has(id), reload }
 */
export function useWorkforceCapabilities({ client = workforceApiClient, principalKey } = {}) {
  const signedOut = principalKey === null || principalKey === "";
  // Each answer is stamped with the principal it was asked for, so a previous principal's grant never renders -- not
  // even for the one render between a principal change and the effect that re-reads.
  const [state, setState] = useState(() => ({ key: principalKey, status: WORKFORCE_CAPABILITY_STATE.LOADING, held: null, error: null }));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (signedOut) {
      setState({ key: principalKey, status: WORKFORCE_CAPABILITY_STATE.FAILED, held: null, error: SIGNED_OUT });
      return undefined;
    }
    let cancelled = false;
    setState({ key: principalKey, status: WORKFORCE_CAPABILITY_STATE.LOADING, held: null, error: null });
    Promise.resolve()
      .then(() => client.call(MY_WORKFORCE_CAPABILITIES_OPERATION, undefined))
      .then((outcome) => {
        if (cancelled) return;
        if (!outcome || outcome.ok !== true) {
          setState({ key: principalKey, status: WORKFORCE_CAPABILITY_STATE.FAILED, held: null, error: outcome ?? MALFORMED });
          return;
        }
        const held = workforceCapabilitiesFrom(outcome.result);
        setState(held
          ? { key: principalKey, status: WORKFORCE_CAPABILITY_STATE.READY, held, error: null }
          : { key: principalKey, status: WORKFORCE_CAPABILITY_STATE.FAILED, held: null, error: MALFORMED });
      })
      .catch(() => {
        if (!cancelled) setState({ key: principalKey, status: WORKFORCE_CAPABILITY_STATE.FAILED, held: null, error: { ok: false, code: "INTERNAL", reason: null, message: "the read failed" } });
      });
    return () => {
      cancelled = true;
    };
  }, [client, principalKey, signedOut, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.key === principalKey;
  const status = current ? state.status : WORKFORCE_CAPABILITY_STATE.LOADING;
  const held = current ? state.held : null;
  const error = current ? state.error : null;
  // Granted ONLY from a READY answer. Loading, failed and signed-out all answer false.
  const has = useCallback((id) => status === WORKFORCE_CAPABILITY_STATE.READY && held !== null && held.has(id), [status, held]);
  return useMemo(() => ({ status, error, has, reload }), [status, error, has, reload]);
}
