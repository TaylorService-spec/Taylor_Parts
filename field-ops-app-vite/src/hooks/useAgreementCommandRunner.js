import { useCallback, useEffect, useRef, useState } from "react";

// THE ONE WAY A SALES AGREEMENT COMMAND IS RUN.
//
// Extracted from `useSalesAgreement` in PR 4 of the Sales Agreement North Star run, UNCHANGED in
// behaviour except for the in-flight guard noted below, so that the by-id record page and the
// by-opportunity workspace share one mechanism instead of two.
//
// ════════════════════ WHY IT HAD TO MOVE ════════════════════
//
// `useSalesAgreement` reads BY OPPORTUNITY and re-reads by opportunity after a command. The record
// page reads BY ID. Reusing that hook on the page would have refreshed the wrong question — or, at
// `enabled: false`, refreshed nothing at all and left the page showing pre-command state after a
// successful write. Copying its `run` into the by-id hook would have made a second idempotency
// discipline, which is exactly what the work order says not to do.
//
// So the discipline moved to one place and both hooks pass their own `refresh`. What each read asks
// is theirs; how a command is run, keyed, retried and reconciled is here.
//
// ════════════════════ IDEMPOTENCY KEYS ARE MINTED PER INTENT, NOT PER CALL ════════════════════
//
// Each command's key is generated ONCE when the user forms the intent and reused across every retry
// of that intent. A key minted inside the transport layer would make every retry a fresh create —
// precisely the failure the server's replay path exists to prevent, defeated on the client. The key
// is cleared only when the command SUCCEEDS, so a network failure followed by a retry replays
// rather than duplicating.
//
// ════════════════════ NOTHING IS PATCHED LOCALLY ════════════════════
//
// A successful command re-reads. It never merges the command's return value into local state: the
// server owns state, totals, timestamps, the resolved actor and the allocated number, and a
// locally-assembled optimistic record would be a second answer that disagrees the moment any of
// them is derived differently. Slower, and honest.

let keySeq = 0;
const mintKey = (prefix) => `${prefix}-${Date.now()}-${++keySeq}-${Math.floor(Math.random() * 1e6)}`;

/**
 * @param refresh the caller's OWN authoritative re-read, awaited after a successful command.
 */
export function useAgreementCommandRunner(refresh) {
  const [pending, setPending] = useState(null);
  const [commandError, setCommandError] = useState(null);
  // Keys survive a re-render so a retry reuses the SAME key. Keyed by intent, not by attempt.
  const keys = useRef({});
  // THE DOUBLE-SUBMIT GUARD IS A REF, NOT THE `pending` STATE, and that is the whole point: a second
  // click in the same tick would see a stale `pending` because React batches, and would issue a
  // second call. The server would replay it rather than duplicate — the idempotency key is the real
  // control — but a UI that fires two accepts and shows two outcomes is still lying about what
  // happened. This refuses synchronously.
  const inFlight = useRef(false);
  // A command that lands after unmount still SUCCEEDED on the server. Only the local state update
  // is abandoned — under jsdom a setState after teardown fails the whole suite from an innocent file.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async (intent, fn) => {
    if (inFlight.current) return { ok: false, errorStatus: "already-in-flight" };
    inFlight.current = true;
    setPending(intent);
    setCommandError(null);
    keys.current[intent] = keys.current[intent] ?? mintKey(intent);
    try {
      const res = await fn(keys.current[intent]);
      if (!mounted.current) {
        return res.errorStatus ? { ok: false, errorStatus: res.errorStatus } : { ok: true, result: res.result };
      }
      setPending(null);
      if (res.errorStatus) {
        // The key is DELIBERATELY kept: the next attempt is a retry of the same intent, and the
        // server must be able to recognise it as one.
        setCommandError(res.errorStatus === "internal" ? "That did not go through. Try again." : res.errorStatus);
        return { ok: false, errorStatus: res.errorStatus };
      }
      delete keys.current[intent];
      await refresh();
      return { ok: true, result: res.result };
    } finally {
      inFlight.current = false;
    }
  }, [refresh]);

  return {
    run,
    pending,
    commandError,
    clearCommandError: useCallback(() => setCommandError(null), []),
  };
}

export default useAgreementCommandRunner;
