// Reading and writing the EOS policy store, from a screen.
//
// ════════════════════ ONE RULE, AND EVERYTHING HERE FOLLOWS FROM IT ════════════════════
//
//   A MUTATION IS FOLLOWED BY A RE-READ. Always.
//
// Not "usually", and never "optimistically". The server may refuse, may adjust, may apply only part
// of what was asked; the browser is not the source of truth and its current grid state is not
// authority. So `mutate` returns the server's answer and then reloads from the store, and what the
// screen renders is what the store holds.
//
// The cost is an extra round trip per change. The alternative is a UI that reports success for a
// change that did not happen, which is the single most damaging thing an Administration screen can
// do -- an administrator walks away believing access was granted, or revoked.
import { useCallback, useEffect, useMemo, useState } from "react";
import { callPolicyApi, describePolicyFailure, isPolicyApiConfigured } from "../../services/adminPolicyApiClient.js";

/**
 * Load one read operation, and expose a mutate that re-reads it.
 *
 * `input` is compared by its JSON, not by identity: a screen that rebuilds `{ objectKey }` on every
 * render would otherwise reload for ever.
 */
export function usePolicyStore(operation, input = null, options = {}) {
  const enabled = options.enabled !== false && isPolicyApiConfigured();
  const inputKey = useMemo(() => JSON.stringify(input ?? {}), [input]);

  const [state, setState] = useState(() => ({
    status: enabled ? "loading" : "unconfigured",
    data: null,
    tenantId: null,
    error: null,
  }));

  // A reload counter rather than a boolean: two mutations in quick succession must produce two
  // reloads, and a boolean would collapse them into one and leave the second change unshown.
  const [reloadCount, setReloadCount] = useState(0);

  // THERE IS NO COMPONENT-LIFETIME "is this still mounted" FLAG, and that is the fix for a defect
  // the browser found that no unit test would have: a ref set false by an unmount cleanup stays
  // false FOR EVER, and React StrictMode mounts, unmounts and remounts every component in
  // development. The second -- real -- mount then discarded its own response, and the panel sat on
  // "Reading the policy store..." indefinitely with no error anywhere to explain it.
  //
  // The per-effect `cancelled` flag below is the correct scope: it belongs to ONE run of the
  // effect, is created fresh each time, and cancels only that run.

  useEffect(() => {
    if (!enabled) {
      setState({ status: "unconfigured", data: null, tenantId: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    setState((prev) => ({ ...prev, status: "loading", error: null }));

    (async () => {
      const result = await callPolicyApi(operation, JSON.parse(inputKey), { signal: controller.signal });
      if (cancelled) return;
      if (result.ok) {
        setState({ status: "ready", data: result.data, tenantId: result.tenantId, error: null });
      } else {
        setState({
          status: result.code === "NOT_CONFIGURED" ? "unconfigured" : "failed",
          data: null,
          tenantId: null,
          error: { ...result, description: describePolicyFailure(result) },
        });
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [enabled, operation, inputKey, reloadCount]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  /**
   * Perform one mutation, then RE-READ.
   *
   * Returns the server's own result so a caller can show the refusal it got, and reloads on success
   * so what is on screen came from the store rather than from the request.
   */
  const mutate = useCallback(async (mutationOperation, mutationInput) => {
    const result = await callPolicyApi(mutationOperation, mutationInput ?? {});
    if (result.ok) reload();
    return result.ok ? result : { ...result, description: describePolicyFailure(result) };
  }, [reload]);

  return { ...state, reload, mutate, configured: isPolicyApiConfigured() };
}

/** The four states a policy-backed panel can be in, named once so every screen says the same thing. */
export const POLICY_PANEL_STATES = Object.freeze({
  unconfigured: "No EOS policy service is configured here, so this screen shows the measured model and is read-only.",
  loading: "Reading the policy store…",
  failed: "The policy store could not be read.",
  ready: null,
});
