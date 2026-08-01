// EI-P1d-2-2b -- the PRODUCER hook that turns the client-direct Truck Registry reads into the
// injected source the (frozen, EI-P1d-1) TruckInventory workspace consumes. It performs the
// one-shot reads, feeds them through the pure buildTruckInventorySourceFromRegistry bridge
// STAMPED with the current accessVersion, and returns { source } -- the caller passes that
// SAME accessVersion to <TruckInventory>, so the workspace's boundary key matches and READY
// data is never shown across an access change.
//
// Fail-closed on every axis:
//   * a permission-denied read -> status "denied" (no payload);
//   * any other read failure -> status "error" (SANITIZED -- the raw error is never surfaced);
//   * in flight (initial or after an access change) -> status "loading";
//   * a successful empty read -> status "ready" with no trucks (the honest empty state);
//   * STALE-ACCESS: a read that resolves after accessVersion has changed is discarded (the
//     cancelled flag), and the stamped accessVersion additionally lets the workspace downgrade
//     any prior-version READY source to LOADING synchronously.
// Reads are injectable (deps) so the behavior is unit-testable without Firestore.
import { useCallback, useEffect, useState } from "react";
import { buildTruckInventorySourceFromRegistry } from "../access/truckRegistrySource.js";
import { projectManagementRecords } from "../domain/truckManagement.js";
import {
  fetchTruckDocs as defaultFetchTruckDocs,
  fetchMobileLocationDocs as defaultFetchMobileLocationDocs,
  fetchDriverNames as defaultFetchDriverNames,
} from "../services/truckRegistryQueries.js";

const LOADING_SOURCE = (accessVersion) => ({ status: "loading", accessVersion });

function isPermissionDenied(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return code === "permission-denied" || code === "firestore/permission-denied";
}

export function useTruckRegistrySource(accessVersion, deps = {}) {
  const {
    fetchTruckDocs = defaultFetchTruckDocs,
    fetchMobileLocationDocs = defaultFetchMobileLocationDocs,
    fetchDriverNames = defaultFetchDriverNames,
  } = deps;

  // Start (and re-scope on any access change) in a sanitized LOADING state -- never a prior
  // access version's data. The bridge is fed a message-less non-ready read.
  const [read, setRead] = useState(() => LOADING_SOURCE(accessVersion));

  // A monotonic reload token: bumping it re-runs the read WITHOUT an access change, so a
  // successful management command can reconcile the fleet (and the governed management
  // records) against the current backend state. Additive -- the frozen read contract and
  // the LOADING/DENIED/ERROR/READY semantics are unchanged.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setRead(LOADING_SOURCE(accessVersion));

    (async () => {
      try {
        // Locations first, then trucks; driver names resolved for ONLY the referenced
        // drivers (bounded, no N+1) via the trucks read.
        const [mobileLocationDocs, truckDocs] = await Promise.all([
          fetchMobileLocationDocs(),
          fetchTruckDocs(),
        ]);
        const driverNames = await fetchDriverNames(truckDocs);
        if (cancelled) return;
        const resolveDriverName = (id) => driverNames.get(id) ?? null;
        setRead({
          status: "ready",
          accessVersion,
          mobileLocationDocs,
          truckDocs,
          resolveDriverName,
          // equipmentCondition stays DEFERRED/empty in this gate.
          equipmentConditionOptions: [],
        });
      } catch (error) {
        if (cancelled) return;
        // Sanitized: map permission-denied to "denied", everything else to a message-less
        // "error" -- the raw error object/message is never carried into the source.
        setRead({ status: isPermissionDenied(error) ? "denied" : "error", accessVersion });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessVersion, reloadToken, fetchTruckDocs, fetchMobileLocationDocs, fetchDriverNames]);

  const source = buildTruckInventorySourceFromRegistry(read);
  // Governed management projection (truckId + version + governed ids) for the Manage
  // drawer's optimistic-concurrency writes. Derived from the SAME truck docs (zero extra
  // reads); empty unless the read is READY. Never surfaced to the frozen inventory view.
  const managementRecords = read.status === "ready" ? projectManagementRecords(read.truckDocs) : [];
  return { source, managementRecords, reload };
}
