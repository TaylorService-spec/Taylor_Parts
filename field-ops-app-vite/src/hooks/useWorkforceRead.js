// One governed Workforce read, as screen state. No cache, no fallback, no second source: the state is exactly
// what the Workforce transport returned, and a failure stays a failure the screen must say out loud.
import { useCallback, useEffect, useMemo, useState } from "react";
import { workforceApiClient } from "../services/workforceApiClient.js";

export const WORKFORCE_READ_STATE = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
});

/**
 * @param operation  a closed Workforce operation name
 * @param input      the input object, `undefined` for an input-less read, or `null` to stay IDLE (not asked yet)
 * @param options    { client = workforceApiClient, enabled = true }
 */
export function useWorkforceRead(operation, input, { client = workforceApiClient, enabled = true } = {}) {
  const idle = input === null || !enabled;
  const inputKey = useMemo(() => (input === undefined ? "__none__" : JSON.stringify(input)), [input]);
  const [state, setState] = useState(() => ({ status: idle ? WORKFORCE_READ_STATE.IDLE : WORKFORCE_READ_STATE.LOADING, data: null, error: null }));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (idle) {
      setState({ status: WORKFORCE_READ_STATE.IDLE, data: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ status: WORKFORCE_READ_STATE.LOADING, data: null, error: null });
    Promise.resolve(client.call(operation, inputKey === "__none__" ? undefined : JSON.parse(inputKey)))
      .then((outcome) => {
        if (cancelled) return;
        if (outcome && outcome.ok) setState({ status: WORKFORCE_READ_STATE.READY, data: outcome.result, error: null });
        else setState({ status: WORKFORCE_READ_STATE.FAILED, data: null, error: outcome ?? { ok: false, code: "INTERNAL", message: "no result" } });
      })
      .catch(() => {
        if (!cancelled) setState({ status: WORKFORCE_READ_STATE.FAILED, data: null, error: { ok: false, code: "INTERNAL", message: "the read failed" } });
      });
    return () => {
      cancelled = true;
    };
  }, [client, operation, inputKey, idle, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/**
 * One responsibility axis for one Employee, family by family. Each family is its own read with its own
 * capability, so one family refused (403) never hides another family's records.
 *
 * Returns { status, families: [{ family, status, items, truncated, error }] }.
 */
export function useEmployeeResponsibility(operation, employeeId, families, { client = workforceApiClient, limit = 25 } = {}) {
  const familiesKey = families.join(",");
  const [state, setState] = useState({ status: WORKFORCE_READ_STATE.IDLE, families: [] });

  useEffect(() => {
    if (!employeeId) {
      setState({ status: WORKFORCE_READ_STATE.IDLE, families: [] });
      return undefined;
    }
    let cancelled = false;
    const list = familiesKey.split(",").filter(Boolean);
    setState({ status: WORKFORCE_READ_STATE.LOADING, families: list.map((family) => ({ family, status: WORKFORCE_READ_STATE.LOADING, items: [], truncated: false, error: null })) });
    Promise.all(
      list.map((family) =>
        Promise.resolve(client.call(operation, { employeeId, family, limit }))
          .then((outcome) =>
            outcome && outcome.ok
              ? { family, status: WORKFORCE_READ_STATE.READY, items: outcome.result?.items ?? [], truncated: Boolean(outcome.result?.truncated), error: null }
              : { family, status: WORKFORCE_READ_STATE.FAILED, items: [], truncated: false, error: outcome ?? { code: "INTERNAL" } },
          )
          .catch(() => ({ family, status: WORKFORCE_READ_STATE.FAILED, items: [], truncated: false, error: { code: "INTERNAL" } })),
      ),
    ).then((results) => {
      if (!cancelled) setState({ status: WORKFORCE_READ_STATE.READY, families: results });
    });
    return () => {
      cancelled = true;
    };
  }, [client, operation, employeeId, familiesKey, limit]);

  return state;
}
