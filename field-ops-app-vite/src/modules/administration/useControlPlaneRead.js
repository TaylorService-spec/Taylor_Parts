// One control-plane read, from a screen, through an injectable seam.
//
// The same rule as usePolicyStore: A MUTATION IS FOLLOWED BY A RE-READ, never an optimistic edit. What
// the screen draws is what the server returned. `read` is null when there is nothing to ask yet (no
// Object or Role chosen) -- a state, not an error.
//
// States: idle | loading | ready | failed | unavailable (the server does not serve the operation).
import { useCallback, useEffect, useRef, useState } from "react";
import { isOperationUnavailable } from "../../services/adminControlPlaneClient.js";

export function useControlPlaneRead(read, key) {
  const [state, setState] = useState(() => ({ status: read ? "loading" : "idle", data: null, error: null }));
  const [nonce, setNonce] = useState(0);
  // `read` is a fresh closure every render; `key` identifies WHAT is read, so only a key change, an
  // enable/disable or an explicit reload re-runs the request.
  const readRef = useRef(read);
  readRef.current = read;
  const enabled = Boolean(read);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle", data: null, error: null });
      return undefined;
    }
    let cancelled = false;
    // A RE-READ of the same key keeps the last answer on screen (so an outcome message beside it
    // survives); a DIFFERENT key never shows the previous key's answer.
    setState((prev) => (prev.forKey === key ? { ...prev, status: "loading", error: null } : { status: "loading", data: null, error: null, forKey: key }));
    Promise.resolve()
      .then(() => readRef.current())
      .catch(() => ({ ok: false, code: "UNREACHABLE", message: "the Administration API could not be reached" }))
      .then((result) => {
        if (cancelled) return;
        if (result?.ok) setState({ status: "ready", data: result.data, error: null, forKey: key });
        else setState({ status: isOperationUnavailable(result) ? "unavailable" : "failed", data: null, error: result ?? { ok: false, code: "INTERNAL" }, forKey: key });
      });
    return () => { cancelled = true; };
  }, [key, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
