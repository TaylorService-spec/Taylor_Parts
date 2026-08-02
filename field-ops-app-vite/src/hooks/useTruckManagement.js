// EI Truck Registry (ADR-010 / Decision #60) -- the orchestration hook that turns the
// Truck Management UI's intents into invocations of the eight trusted callables, behind
// TWO independent gates and with fail-closed stale-completion handling.
//
// GATES (both required to invoke a callable):
//   * canManage   -- the signed-in user's SECURITY ROLE is admin/dispatcher (mirrors the
//                    server-side users/{uid}.role check; a defense-in-depth UI gate, never
//                    the sole enforcement). The route is already admin/dispatcher-only.
//   * writeReady  -- the write-readiness seam (config/truckManagementReadiness.js). The
//                    eight callables are exported-but-undeployed, so the production default
//                    is FALSE and every command short-circuits BEFORE touching the client
//                    (zero callable attempts). No runtime probing.
//
// STALE-COMPLETION: each command captures the accessVersion at call time; if accessVersion
// changes (an access-boundary shift) or the component unmounts before the callable resolves,
// the result is discarded -- onReconcile is NOT called and the outcome is marked stale, so a
// prior-scope success/failure can never be applied to a newer access scope.
import { useCallback, useEffect, useRef } from "react";
import { truckRegistryCommandClient as defaultClient } from "../services/truckRegistryCommandClient.js";
import {
  makeIdempotencyKey as defaultKeyFactory,
  mapTruckCommandError,
  TRUCK_COMMAND_OUTCOME,
} from "../domain/truckManagement.js";
import { resolveWriteReadiness } from "../config/truckManagementReadiness.js";

// Reasons a command was refused before any callable was attempted.
export const TRUCK_MANAGEMENT_BLOCKED = Object.freeze({
  ROLE: "blocked-role", // not admin/dispatcher
  NOT_READY: "blocked-not-ready", // callables not deployed / readiness false
});

export function useTruckManagement({
  accessVersion,
  canManage = false,
  writeReadyOverride,
  client = defaultClient,
  keyFactory = defaultKeyFactory,
  onReconcile,
} = {}) {
  const writeReady = resolveWriteReadiness(writeReadyOverride);
  const enabled = canManage && writeReady;

  // Refs so a resolving command can detect an access-boundary shift or unmount.
  const accessVersionRef = useRef(accessVersion);
  const mountedRef = useRef(true);
  const reconcileRef = useRef(onReconcile);
  // SYNCHRONOUS boundary update: assign during render, NOT in a useEffect. A useEffect runs
  // AFTER commit, leaving a window where a render with a new accessVersion has committed but the
  // ref still holds the old value -- an in-flight command resolving in that window would be
  // wrongly accepted (and would reconcile) under the new access boundary. Writing the ref in
  // render closes that window: any command captures the boundary that is current as of the last
  // render, and a completion under a newer boundary is always stale. (Idempotent write; safe in
  // StrictMode's double render.)
  accessVersionRef.current = accessVersion;
  reconcileRef.current = onReconcile;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Run a single command through the gates + invoke + sanitize + stale-guard + reconcile.
  // `invoke(payload)` receives the payload with idempotencyKey already stamped and returns
  // the client's promise. It is NEVER called when !enabled.
  const run = useCallback(
    async (invoke) => {
      if (!canManage) return { kind: TRUCK_COMMAND_OUTCOME.DENIED, blocked: TRUCK_MANAGEMENT_BLOCKED.ROLE, message: null };
      if (!writeReady) return { kind: TRUCK_COMMAND_OUTCOME.UNAVAILABLE, blocked: TRUCK_MANAGEMENT_BLOCKED.NOT_READY, message: null };

      const captured = accessVersionRef.current;
      const isStale = () => !mountedRef.current || accessVersionRef.current !== captured;
      try {
        const idempotencyKey = keyFactory();
        const data = await invoke(idempotencyKey);
        if (isStale()) return { kind: TRUCK_COMMAND_OUTCOME.OK, stale: true };
        // Success in the still-current scope -> reconcile the read source.
        if (typeof reconcileRef.current === "function") reconcileRef.current();
        return { kind: TRUCK_COMMAND_OUTCOME.OK, data };
      } catch (err) {
        // A missing/throwing client seam is indistinguishable from a transport failure at
        // this boundary and is sanitized the same way -- fail closed, never a raw message.
        if (isStale()) return { ...mapTruckCommandError(err), stale: true };
        return mapTruckCommandError(err);
      }
    },
    [canManage, writeReady, keyFactory]
  );

  const commands = {
    createTruck: useCallback(
      (value) =>
        run((idempotencyKey) =>
          client.createTruck({
            idempotencyKey,
            truckId: value.truckId,
            locationId: value.locationId,
            homeWarehouseId: value.homeWarehouseId,
            status: value.status,
            assignedDriverEmployeeId: value.assignedDriverEmployeeId ?? null,
            displayLabel: value.displayLabel,
            vehicleNumber: value.vehicleNumber,
          })
        ),
      [run, client]
    ),
    assignDriver: useCallback(
      ({ truckId, employeeId, expectedVersion }) =>
        run((idempotencyKey) => client.assignDriver({ idempotencyKey, truckId, employeeId, expectedVersion })),
      [run, client]
    ),
    reassignDriver: useCallback(
      ({ truckId, employeeId, expectedVersion }) =>
        run((idempotencyKey) => client.reassignDriver({ idempotencyKey, truckId, employeeId, expectedVersion })),
      [run, client]
    ),
    unassignDriver: useCallback(
      ({ truckId, expectedVersion }) =>
        run((idempotencyKey) => client.unassignDriver({ idempotencyKey, truckId, expectedVersion })),
      [run, client]
    ),
    changeStatus: useCallback(
      ({ truckId, status, expectedVersion }) =>
        run((idempotencyKey) => client.changeStatus({ idempotencyKey, truckId, status, expectedVersion })),
      [run, client]
    ),
    changeHomeWarehouse: useCallback(
      ({ truckId, homeWarehouseId, expectedVersion }) =>
        run((idempotencyKey) => client.changeHomeWarehouse({ idempotencyKey, truckId, homeWarehouseId, expectedVersion })),
      [run, client]
    ),
    deactivateTruck: useCallback(
      ({ truckId, expectedVersion }) =>
        run((idempotencyKey) => client.deactivateTruck({ idempotencyKey, truckId, expectedVersion })),
      [run, client]
    ),
    reactivateTruck: useCallback(
      ({ truckId, targetStatus, expectedVersion }) =>
        run((idempotencyKey) => client.reactivateTruck({ idempotencyKey, truckId, targetStatus, expectedVersion })),
      [run, client]
    ),
  };

  return { enabled, canManage, writeReady, commands };
}
