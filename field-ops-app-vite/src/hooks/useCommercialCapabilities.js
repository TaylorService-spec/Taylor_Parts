// Which COMMERCIAL controls this caller may be OFFERED -- answered by PostgreSQL, the authority that authorizes them.
//
//   browser -> readMyCommercialCapabilities (services/commercialApiClient.js) -> POST /commercial/sales
//           -> the caller's resolved EOS Principal, ACTIVE membership, Roles and eos_policy.role_capabilities
//           -> { capabilities, channelScoped } intersected with the closed Commercial list
//
// Replaces access/useOpportunityCapabilities.js and access/useSalesOrderCapabilities.js, which asked the Firebase
// effective-access feed (Firestore users/{uid}.accessVersion + resolveEffectiveAccessCallable) while the Commercial
// server authorized from PostgreSQL -- so a salesperson authorized server-side was offered nothing whenever the two
// disagreed. Same shape as hooks/useWorkforceCapabilities.js.
//
// FAIL CLOSED. Nothing is offered while the read is in flight, when it is refused or fails, when the answer is
// malformed, or when no one is signed in. OFFER ONLY: every Commercial command re-checks its capability server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { commercialApiClient } from "../services/commercialApiClient.js";
import { MY_COMMERCIAL_CAPABILITIES_OPERATION, commercialCapabilitiesFrom, commercialChannelOffersFrom } from "../access/commercialCapabilityAccess.js";

export const COMMERCIAL_CAPABILITY_STATE = Object.freeze({ LOADING: "loading", READY: "ready", FAILED: "failed" });

const MALFORMED = Object.freeze({ ok: false, code: "INTERNAL", reason: "MALFORMED_CAPABILITIES", message: "the Commercial capability answer was malformed" });
const NO_CHANNELS = Object.freeze([]);
const SIGNED_OUT = Object.freeze({ ok: false, code: "NOT_SIGNED_IN", reason: null, message: "sign in to reach the Commercial service" });

/**
 * @param user              the signed-in user (or null). Its uid is used ONLY to re-read on a principal change; it is
 *                          never sent -- the server resolves the caller from the bearer token.
 * @param options.client    the Commercial client seam ({ call })
 * @returns { status, error, hasCapability(id), channelsFor(id), reload }
 */
export function useCommercialCapabilities(user, { client = commercialApiClient } = {}) {
  const principalKey = user?.uid ?? null;
  const signedOut = principalKey === null || principalKey === "";
  const [state, setState] = useState(() => ({ key: principalKey, status: COMMERCIAL_CAPABILITY_STATE.LOADING, held: null, channels: null, error: null }));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (signedOut) {
      setState({ key: principalKey, status: COMMERCIAL_CAPABILITY_STATE.FAILED, held: null, channels: null, error: SIGNED_OUT });
      return undefined;
    }
    let cancelled = false;
    setState({ key: principalKey, status: COMMERCIAL_CAPABILITY_STATE.LOADING, held: null, channels: null, error: null });
    Promise.resolve()
      .then(() => client.call(MY_COMMERCIAL_CAPABILITIES_OPERATION, undefined))
      .then((outcome) => {
        if (cancelled) return;
        if (!outcome || outcome.ok !== true) {
          setState({ key: principalKey, status: COMMERCIAL_CAPABILITY_STATE.FAILED, held: null, channels: null, error: outcome ?? MALFORMED });
          return;
        }
        const held = commercialCapabilitiesFrom(outcome.result);
        const channels = commercialChannelOffersFrom(outcome.result);
        setState(held && channels
          ? { key: principalKey, status: COMMERCIAL_CAPABILITY_STATE.READY, held, channels, error: null }
          : { key: principalKey, status: COMMERCIAL_CAPABILITY_STATE.FAILED, held: null, channels: null, error: MALFORMED });
      })
      .catch(() => {
        if (!cancelled) setState({ key: principalKey, status: COMMERCIAL_CAPABILITY_STATE.FAILED, held: null, channels: null, error: { ok: false, code: "INTERNAL", reason: null, message: "the read failed" } });
      });
    return () => {
      cancelled = true;
    };
  }, [client, principalKey, signedOut, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // Each answer is stamped with the principal it was asked for: a previous principal's grant never renders.
  const current = state.key === principalKey;
  const status = current ? state.status : COMMERCIAL_CAPABILITY_STATE.LOADING;
  const held = current ? state.held : null;
  const error = current ? state.error : null;
  const channels = current ? state.channels : null;
  // Offered ONLY from a READY answer. Loading, failed and signed-out all answer false.
  const hasCapability = useCallback((id) => status === COMMERCIAL_CAPABILITY_STATE.READY && held !== null && held.has(id), [status, held]);
  // The channels this caller may CHOOSE for a channel-choosing write (DQ-4). Not READY, or not such a key: none.
  const channelsFor = useCallback((id) => (status === COMMERCIAL_CAPABILITY_STATE.READY && channels !== null && Array.isArray(channels[id]) ? channels[id] : NO_CHANNELS), [status, channels]);
  return useMemo(() => ({ status, error, hasCapability, channelsFor, reload }), [status, error, hasCapability, channelsFor, reload]);
}
