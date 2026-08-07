import { useCallback, useMemo } from "react";
import { resolveWriteReadiness } from "../config/manufacturerWriteReadiness";
import { manufacturerCommandClient } from "../services/manufacturerCommandClient";
import {
  buildCreateManufacturerInput,
  buildUpdateName,
  outcomeFromResult,
  outcomeFromError,
  WRITE_DISABLED_OUTCOME,
  NO_CHANGES_OUTCOME,
} from "../domain/manufacturerWrite";

// Manufacturer write hook. The ONLY place the trusted Manufacturer callables are invoked from the
// workspace. FAIL-CLOSED: when write-readiness is false (production posture -- callables undeployed/
// ungranted), every action returns WRITE_DISABLED_OUTCOME and makes ZERO callable attempts. Server
// re-enforces authorization regardless. `deps` lets tests/preview inject readiness + a mocked client.
export function useManufacturerWrite(deps) {
  const client = deps?.client ?? manufacturerCommandClient;
  const writeReady = resolveWriteReadiness(deps?.readinessOverride);

  const newKey = useCallback(() => {
    const uuid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    return `mf-${uuid}`.slice(0, 200);
  }, []);

  const runCreate = useCallback(async (form) => {
    if (!writeReady) return WRITE_DISABLED_OUTCOME;
    try {
      const { manufacturerId, name } = buildCreateManufacturerInput(form);
      return outcomeFromResult(await client.createManufacturer({ idempotencyKey: newKey(), manufacturerId, name }));
    } catch (error) { return outcomeFromError(error); }
  }, [writeReady, client, newKey]);

  const runRename = useCallback(async (manufacturerId, expectedVersion, form, original) => {
    if (!writeReady) return WRITE_DISABLED_OUTCOME;
    const name = buildUpdateName(form, original);
    if (name === null) return NO_CHANGES_OUTCOME;
    try {
      return outcomeFromResult(await client.updateManufacturer({ idempotencyKey: newKey(), manufacturerId, expectedVersion, name }));
    } catch (error) { return outcomeFromError(error); }
  }, [writeReady, client, newKey]);

  const runChangeStatus = useCallback(async (manufacturerId, expectedVersion, newStatus) => {
    if (!writeReady) return WRITE_DISABLED_OUTCOME;
    try {
      return outcomeFromResult(await client.changeManufacturerStatus({ idempotencyKey: newKey(), manufacturerId, expectedVersion, newStatus }));
    } catch (error) { return outcomeFromError(error); }
  }, [writeReady, client, newKey]);

  return useMemo(() => ({ writeReady, runCreate, runRename, runChangeStatus }), [writeReady, runCreate, runRename, runChangeStatus]);
}
