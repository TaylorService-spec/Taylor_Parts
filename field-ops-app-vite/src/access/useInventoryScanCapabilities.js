// Which Scan workflows this caller may be OFFERED -- answered by PostgreSQL, the authority that authorizes them.
//
//   browser -> resolveMyCapabilities (services/operationsApiClient.js) -> POST /operations/inventory
//           -> the caller's resolved EOS Principal, ACTIVE membership, Roles and eos_policy.role_capabilities
//           -> kept: only the scan keys (access/inventoryScanCapabilityAccess.js)
//
// Replaces, for the three Scan mounts in App.jsx, the shell's Firebase effective-access feed
// (operationalContext.hasCapability / access/useReportCapabilities.js), which answers only after a Firestore
// users/{uid}.accessVersion exists -- so a warehouse associate authorized server-side was offered nothing but Lookup.
// Same shape as hooks/useCommercialCapabilities.js.
//
// FAIL CLOSED. Nothing is offered while the read is in flight, when it is refused or fails, when the answer is
// malformed, when no one is signed in, or while a previous principal's answer is still the one held. OFFER ONLY: every
// command re-checks its capability, warehouse scope and work eligibility server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { operationsApiClient } from "../services/operationsApiClient.js";
import { MY_INVENTORY_SCAN_CAPABILITIES_OPERATION, inventoryScanCapabilitiesFrom } from "./inventoryScanCapabilityAccess.js";

export const INVENTORY_SCAN_CAPABILITY_STATE = Object.freeze({ LOADING: "loading", READY: "ready", FAILED: "failed" });

const MALFORMED = Object.freeze({ ok: false, code: "INTERNAL", reason: "MALFORMED_CAPABILITIES", message: "the capability answer was malformed" });
const SIGNED_OUT = Object.freeze({ ok: false, code: "NOT_SIGNED_IN", reason: null, message: "sign in to reach the Operations service" });
const READ_FAILED = Object.freeze({ ok: false, code: "INTERNAL", reason: null, message: "the read failed" });

/**
 * @param user            the signed-in user (or null). Its uid is used ONLY to re-read on a principal change; it is
 *                        never sent -- the server resolves the caller from the bearer token.
 * @param options.client  the Operations client seam ({ call })
 * @param options.keys    the capability ids to keep (a STABLE Set; default: the scan keys) -- the Transfers and Cycle Counts screens ask for their own
 *                        (access/inventoryScreenCapabilities.js)
 * @returns { status, error, hasCapability(id), reload }
 */
export function useInventoryScanCapabilities(user, { client = operationsApiClient, keys } = {}) {
  const principalKey = user?.uid ?? null;
  const signedOut = principalKey === null || principalKey === "";
  const [state, setState] = useState(() => ({ key: principalKey, status: INVENTORY_SCAN_CAPABILITY_STATE.LOADING, held: null, error: null }));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (signedOut) {
      setState({ key: principalKey, status: INVENTORY_SCAN_CAPABILITY_STATE.FAILED, held: null, error: SIGNED_OUT });
      return undefined;
    }
    let cancelled = false;
    setState({ key: principalKey, status: INVENTORY_SCAN_CAPABILITY_STATE.LOADING, held: null, error: null });
    Promise.resolve()
      .then(() => client.call(MY_INVENTORY_SCAN_CAPABILITIES_OPERATION))
      .then((outcome) => {
        if (cancelled) return;
        if (!outcome || outcome.ok !== true) {
          setState({ key: principalKey, status: INVENTORY_SCAN_CAPABILITY_STATE.FAILED, held: null, error: outcome ?? MALFORMED });
          return;
        }
        const held = inventoryScanCapabilitiesFrom(outcome.result, keys);
        setState(held
          ? { key: principalKey, status: INVENTORY_SCAN_CAPABILITY_STATE.READY, held, error: null }
          : { key: principalKey, status: INVENTORY_SCAN_CAPABILITY_STATE.FAILED, held: null, error: MALFORMED });
      })
      .catch(() => {
        if (!cancelled) setState({ key: principalKey, status: INVENTORY_SCAN_CAPABILITY_STATE.FAILED, held: null, error: READ_FAILED });
      });
    return () => {
      cancelled = true;
    };
  }, [client, principalKey, signedOut, nonce, keys]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // Each answer is stamped with the principal it was asked for: a previous principal's grant never renders.
  const current = state.key === principalKey;
  const status = current ? state.status : INVENTORY_SCAN_CAPABILITY_STATE.LOADING;
  const held = current ? state.held : null;
  const error = current ? state.error : null;
  // Offered ONLY from a READY answer. Loading, failed, malformed and signed-out all answer false.
  const hasCapability = useCallback((id) => status === INVENTORY_SCAN_CAPABILITY_STATE.READY && held !== null && held.has(id), [status, held]);
  return useMemo(() => ({ status, error, hasCapability, reload }), [status, error, hasCapability, reload]);
}
