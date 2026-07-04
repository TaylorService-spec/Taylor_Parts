import { createContext, useContext, useState, useCallback } from "react";
import { DEMO_MODE } from "./demoConfig";
import { SEED_PARTS, SEED_WAREHOUSE_STOCK, SEED_TRUCK_STOCK } from "./inventoryData";

// Sprint 3.6 Demo Layer: in-memory-only inventory state (Warehouse
// stock, Truck stock, and per-job parts-used tracking). No Firestore
// collection backs this -- state resets on page reload. This is purely
// a UI/presentation layer: nothing here writes to Firestore, and
// nothing here touches the Job/Technician/Work Order domain layer
// (domain/jobActions.js remains the only place job/technician state
// changes -- see PROJECT_ARCHITECTURE.md).

const InventoryContext = createContext(null);

export function InventoryProvider({ children }) {
  const [warehouseStock, setWarehouseStock] = useState(DEMO_MODE ? SEED_WAREHOUSE_STOCK : {});
  const [truckStock, setTruckStock] = useState(DEMO_MODE ? SEED_TRUCK_STOCK : {});
  const [usedPartsByJob, setUsedPartsByJob] = useState({});

  // Warehouse -> Truck. Visual/local state only -- decrements warehouse,
  // increments truck. Clamped at 0 so a transfer can never go negative.
  const transferPart = useCallback((partId, quantity) => {
    setWarehouseStock((prev) => ({
      ...prev,
      [partId]: Math.max(0, (prev[partId] ?? 0) - quantity),
    }));
    setTruckStock((prev) => ({
      ...prev,
      [partId]: (prev[partId] ?? 0) + quantity,
    }));
  }, []);

  // Records a part as used on a job: decrements truck stock and appends
  // to that job's used-parts list (read by FieldMode's Complete Job
  // summary). Local state only -- no Firestore write, no change to the
  // job document itself.
  const consumePart = useCallback((jobId, partId, quantity = 1) => {
    setTruckStock((prev) => ({
      ...prev,
      [partId]: Math.max(0, (prev[partId] ?? 0) - quantity),
    }));
    setUsedPartsByJob((prev) => {
      const existing = prev[jobId] ?? [];
      return { ...prev, [jobId]: [...existing, { partId, quantity }] };
    });
  }, []);

  const value = {
    parts: SEED_PARTS,
    warehouseStock,
    truckStock,
    usedPartsByJob,
    transferPart,
    consumePart,
  };

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) {
    throw new Error("useInventory() must be used within an InventoryProvider");
  }
  return ctx;
}
