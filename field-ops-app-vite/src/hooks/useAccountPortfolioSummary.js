import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

/**
 * Complete Account portfolio counts, from the governed aggregate read.
 *
 * The Customers headline numbers are claims about the whole book of business, so they
 * come from `getAccountPortfolioSummary` — a server-side count over the complete scope —
 * and never from the rows currently on screen. A total computed from a page is smaller
 * than the truth while still being labelled "Total", which is a worse failure than the
 * unbounded client subscription it replaces: that one was merely slow.
 *
 * There is deliberately no pageSize, cursor, or filter argument. An aggregate that
 * accepted a bound would be able to produce a partial number under a complete name.
 *
 * DENIED AND UNAVAILABLE STAY SEPARATE, for the same reason they do everywhere else in
 * this program: a surface that renders "—" for both tells someone their data is missing
 * when the real answer is that they may not see it.
 */
export function useAccountPortfolioSummary({ enabled = true } = {}) {
  const [summary, setSummary] = useState(null);
  const [state, setState] = useState(enabled ? "LOADING" : "IDLE");

  const load = useCallback(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState("LOADING");
    httpsCallable(functions, "getAccountPortfolioSummary")()
      .then((res) => {
        if (cancelled) return;
        setSummary(res?.data?.summary ?? null);
        setState(res?.data?.summary ? "READY" : "UNAVAILABLE");
      })
      .catch((e) => {
        if (cancelled) return;
        setSummary(null);
        setState(e?.code === "functions/permission-denied" ? "DENIED" : "UNAVAILABLE");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => load(), [load]);

  return { summary, state, retry: load };
}
