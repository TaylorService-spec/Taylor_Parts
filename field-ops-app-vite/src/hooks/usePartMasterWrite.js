import { useCallback, useMemo } from "react";
import { resolveWriteReadiness } from "../config/partMasterWriteReadiness";
import { partMasterCommandClient } from "../services/partMasterCommandClient";
import {
  buildCreatePartInput,
  buildUpdateChanges,
  outcomeFromResult,
  outcomeFromError,
  WRITE_DISABLED_OUTCOME,
  NO_CHANGES_OUTCOME,
} from "../domain/partMasterWrite";

// Part Master write hook. The ONLY place the trusted Part callables are invoked from the workspace.
// FAIL-CLOSED: when write-readiness is false (the production posture -- callables undeployed/ungranted),
// every action returns WRITE_DISABLED_OUTCOME and makes ZERO callable attempts. Server re-enforces
// authorization regardless; the client never claims a success it didn't get. `deps` lets tests/preview
// inject an explicit readiness + a MOCKED client without touching the constant or `firebase`.
export function usePartMasterWrite(deps) {
  const readinessOverride = deps?.readinessOverride;
  const client = deps?.client ?? partMasterCommandClient;
  const writeReady = resolveWriteReadiness(readinessOverride);

  // Idempotency key: a random UUID (36 chars, all in [A-Za-z0-9-]) -> matches the command's
  // [A-Za-z0-9_-]{8,200} contract. Only generated when a write is actually attempted.
  const newKey = useCallback(() => {
    const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    return `pm-${uuid}`.slice(0, 200);
  }, []);

  const runCreate = useCallback(async (form) => {
    if (!writeReady) return WRITE_DISABLED_OUTCOME;
    try {
      const data = await client.createPart({ idempotencyKey: newKey(), part: buildCreatePartInput(form) });
      return outcomeFromResult(data);
    } catch (error) {
      return outcomeFromError(error);
    }
  }, [writeReady, client, newKey]);

  const runUpdate = useCallback(async (partId, expectedVersion, form, original) => {
    if (!writeReady) return WRITE_DISABLED_OUTCOME;
    const changes = buildUpdateChanges(form, original);
    if (Object.keys(changes).length === 0) return NO_CHANGES_OUTCOME;
    try {
      const data = await client.updatePart({ idempotencyKey: newKey(), partId, expectedVersion, changes });
      return outcomeFromResult(data);
    } catch (error) {
      return outcomeFromError(error);
    }
  }, [writeReady, client, newKey]);

  const runChangeStatus = useCallback(async (partId, expectedVersion, newStatus) => {
    if (!writeReady) return WRITE_DISABLED_OUTCOME;
    try {
      const data = await client.changePartStatus({ idempotencyKey: newKey(), partId, expectedVersion, newStatus });
      return outcomeFromResult(data);
    } catch (error) {
      return outcomeFromError(error);
    }
  }, [writeReady, client, newKey]);

  return useMemo(() => ({ writeReady, runCreate, runUpdate, runChangeStatus }), [writeReady, runCreate, runUpdate, runChangeStatus]);
}
