// EI Truck Registry -- the TEST-ONLY visual preview of the Truck Management experience.
//
// It is NOT wired into App.jsx or navConfig (excluded from production navigation) and
// imports NOTHING from firebase (incapable of reaching production): it drives the REAL
// TruckInventory workspace + management components with an in-memory mock command client
// and fixture drivers/warehouses, re-deriving the fleet through the SAME pure bridge
// (buildTruckInventorySourceFromRegistry) the connected producer uses. It exists so the
// full add/assign/status/warehouse/deactivate flows -- and the denied / conflict / disabled
// states -- can be reviewed and asserted without any backend. A later authorized activation
// gate governs the REAL callables; this preview never touches them.
import { useCallback, useMemo, useRef, useState } from "react";
import TruckInventory from "../TruckInventory";
import { buildTruckInventorySourceFromRegistry } from "../../../access/truckRegistrySource.js";
import { projectManagementRecords } from "../../../domain/truckManagement.js";
import { useTruckManagement } from "../../../hooks/useTruckManagement.js";
import {
  createTruckStore,
  truckDocsFromStore,
  mobileLocationDocsFromStore,
  createMockTruckCommandClient,
} from "./mockTruckCommandClient.js";

const FIXTURE_TRUCKS = [
  { docId: "TRK-101", data: { locationId: "MOBILE-101", homeWarehouseId: "WH-CENTRAL", status: "ACTIVE", assignedDriverEmployeeId: "EMP-1", displayLabel: "Truck 101", vehicleNumber: "V-101" } },
  { docId: "TRK-102", data: { locationId: "MOBILE-102", homeWarehouseId: "WH-NORTH", status: "IDLE", assignedDriverEmployeeId: null, displayLabel: "Truck 102", vehicleNumber: "V-102" } },
];
const FIXTURE_DRIVERS = [
  { value: "EMP-1", label: "Alex Rivera" },
  { value: "EMP-2", label: "Sam Okafor" },
  { value: "EMP-3", label: "Jordan Lee" },
];
const FIXTURE_WAREHOUSES = [
  { value: "WH-CENTRAL", label: "Central" },
  { value: "WH-NORTH", label: "North" },
  { value: "WH-SOUTH", label: "South" },
];

export default function TruckManagementPreview({
  writeReady = true,
  isAdmin = true,
  client,
  driverOptions = FIXTURE_DRIVERS,
  warehouseOptions = FIXTURE_WAREHOUSES,
  seedTrucks = FIXTURE_TRUCKS,
  accessVersion = "preview-v1",
}) {
  // Store + client created once and kept across reconcile re-renders.
  const storeRef = useRef(null);
  if (storeRef.current === null) storeRef.current = createTruckStore(seedTrucks);
  const store = storeRef.current;

  const clientRef = useRef(null);
  if (clientRef.current === null) clientRef.current = client ?? createMockTruckCommandClient(store);
  const mockClient = clientRef.current;

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Deterministic idempotency keys (no crypto/random needed in the preview).
  const keyRef = useRef(0);
  const keyFactory = useCallback(() => `preview_${keyRef.current++}`, []);

  const driverMap = useMemo(() => new Map(driverOptions.map((d) => [d.value, d.label])), [driverOptions]);
  const useDriverOptions = useCallback(
    (enabled) => (enabled ? { options: driverOptions, loading: false, error: false } : { options: [], loading: false, error: false }),
    [driverOptions]
  );
  const useWarehouseOptions = useCallback(
    (enabled) => (enabled ? { options: warehouseOptions, loading: false, error: false } : { options: [], loading: false, error: false }),
    [warehouseOptions]
  );

  const { writeReady: wr, commands } = useTruckManagement({
    accessVersion,
    canManage: true,
    writeReadyOverride: writeReady,
    client: mockClient,
    keyFactory,
    onReconcile: reload,
  });

  const read = useMemo(() => {
    void nonce; // recompute after every mutation
    return {
      status: "ready",
      accessVersion,
      mobileLocationDocs: mobileLocationDocsFromStore(store),
      truckDocs: truckDocsFromStore(store),
      resolveDriverName: (id) => driverMap.get(id) ?? null,
      equipmentConditionOptions: [],
    };
  }, [nonce, store, accessVersion, driverMap]);

  const source = buildTruckInventorySourceFromRegistry(read);
  const managementRecords = projectManagementRecords(read.truckDocs);
  const management = { canManage: true, isAdmin, writeReady: wr, enabled: wr, commands, useDriverOptions, useWarehouseOptions };

  return (
    <div data-testid="truck-management-preview">
      <TruckInventory source={source} accessVersion={accessVersion} management={management} managementRecords={managementRecords} onReconcile={reload} />
    </div>
  );
}
