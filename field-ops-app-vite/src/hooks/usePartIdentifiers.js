import { useCallback, useEffect, useRef, useState } from "react";
import { partAliasCallableClient, NOT_READY_STATUS } from "../services/partAliasCallableClient.js";
import { outcomeFromErrorCode } from "../domain/partIdentifiers.js";

function newIdempotencyKey(prefix) {
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}-${uuid}`.slice(0, 200);
}

/**
 * Part identifier administration — the only place the alias callables are invoked from a screen.
 *
 * `deps.client` injects a mocked client in tests, the seam useOpportunityTransitions and
 * useSalesOrderActions already established.
 *
 * FOUR LOAD STATES, NOT TWO. `unavailable` (the transport is switched off), `denied` (the caller
 * lacks the capability), `failed` (the read broke), and `ready` with an empty list (this part really
 * has no identifiers) are four different facts. Collapsing any of them into "no identifiers" would
 * assert something about the data that the screen does not know — which is the exact defect the
 * previous version of this surface was written to avoid, and it is not lost by making the surface
 * live.
 *
 * IDEMPOTENCY. A key is generated once per user intent and reused across a RETRY of that intent, so
 * a double-click or a reconnect cannot apply twice. It is discarded once the intent resolves in a
 * way there is nothing left to retry — success, or a conflict the user must resolve differently.
 */
export function usePartIdentifiers(partId, deps) {
  const client = deps?.client ?? partAliasCallableClient;
  const [state, setState] = useState({ status: "loading", aliases: [], truncated: false });
  const [pending, setPending] = useState({});
  const [outcome, setOutcome] = useState(null);
  const keysRef = useRef({});

  const load = useCallback(async () => {
    if (!partId) {
      setState({ status: "ready", aliases: [], truncated: false });
      return;
    }
    setState((s) => ({ ...s, status: "loading" }));
    const { result, errorStatus, errorDetail } = await client.listPartAliases({ partId });
    if (errorStatus === NOT_READY_STATUS) {
      setState({ status: "unavailable", aliases: [], truncated: false });
      return;
    }
    if (errorStatus) {
      const mapped = outcomeFromErrorCode(errorStatus, errorDetail);
      setState({
        // A denial is NOT an empty list, and never rendered as one.
        status: mapped.kind === "denied" ? "denied" : "failed",
        aliases: [],
        truncated: false,
        message: mapped.message,
      });
      return;
    }
    setState({
      status: "ready",
      aliases: Array.isArray(result?.aliases) ? result.aliases : [],
      truncated: result?.truncated === true,
      limit: result?.limit ?? null,
    });
  }, [client, partId]);

  useEffect(() => {
    load();
  }, [load]);

  const clearOutcome = useCallback(() => setOutcome(null), []);

  const run = useCallback(
    async (intentKey, call) => {
      setPending((p) => ({ ...p, [intentKey]: true }));
      setOutcome(null);
      try {
        const key = keysRef.current[intentKey] ?? (keysRef.current[intentKey] = newIdempotencyKey("pa"));
        const { result, errorStatus, errorDetail } = await call(key);
        if (errorStatus === NOT_READY_STATUS) {
          const o = { kind: "unavailable", message: "Identifier administration is not switched on in this environment." };
          setOutcome(o);
          return o;
        }
        if (errorStatus) {
          const mapped = outcomeFromErrorCode(errorStatus, errorDetail);
          // A conflict ends the intent: the next attempt is a genuinely new one against state the
          // user has now seen, and reusing the key would replay the failed call's identity.
          if (mapped.kind === "conflict") delete keysRef.current[intentKey];
          setOutcome(mapped);
          return mapped;
        }
        delete keysRef.current[intentKey];
        const applied = {
          kind: result?.outcome === "replayed" ? "replayed" : "applied",
          message: result?.outcome === "replayed" ? "Already recorded (no change)." : "Saved.",
        };
        setOutcome(applied);
        // Re-read authoritatively. Never patch locally: the server owns the new version token, and
        // a locally-invented one would fail the NEXT change with a conflict nobody could explain.
        await load();
        return applied;
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[intentKey];
          return next;
        });
      }
    },
    [load]
  );

  const addIdentifier = useCallback(
    (draft) =>
      run("create", (idempotencyKey) =>
        client.createPartAlias({ ...draft, partId, source: "manual", idempotencyKey })
      ),
    [client, partId, run]
  );

  const deactivate = useCallback(
    (alias) =>
      run(`deactivate:${alias.aliasId}`, (idempotencyKey) =>
        client.deactivatePartAlias({ aliasId: alias.aliasId, expectedVersion: alias.version, idempotencyKey })
      ),
    [client, run]
  );

  const reactivate = useCallback(
    (alias) =>
      run(`reactivate:${alias.aliasId}`, (idempotencyKey) =>
        client.reactivatePartAlias({ aliasId: alias.aliasId, expectedVersion: alias.version, idempotencyKey })
      ),
    [client, run]
  );

  // The probe CHANGES NOTHING, so it carries no idempotency key and never touches the list.
  const probe = useCallback(
    async ({ aliasType, rawValue, manufacturerId }) => {
      setPending((p) => ({ ...p, probe: true }));
      try {
        const { result, errorStatus, errorDetail } = await client.probePartAlias({ aliasType, rawValue, manufacturerId });
        if (errorStatus === NOT_READY_STATUS) return { result: "UNAVAILABLE" };
        if (errorStatus) return { result: "ERROR", outcome: outcomeFromErrorCode(errorStatus, errorDetail) };
        return result;
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next.probe;
          return next;
        });
      }
    },
    [client]
  );

  return { ...state, pending, outcome, clearOutcome, reload: load, addIdentifier, deactivate, reactivate, probe };
}
