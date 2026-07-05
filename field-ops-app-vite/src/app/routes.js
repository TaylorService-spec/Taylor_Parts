import ExecutionWorkspace from "../domains/execution/ExecutionWorkspace";
import InventoryLedgerView from "../domains/inventory/InventoryLedgerView";
import AnalyticsDashboard from "../domains/analytics/AnalyticsDashboard";
import WarehouseView from "../domains/warehouse/WarehouseView";
import ProcurementView from "../domains/procurement/ProcurementView";
import OptimizationView from "../domains/optimization/OptimizationView";

// Domain-routing scaffold (structural only) -- see AppRouter.jsx's
// header comment. Path -> component map only, no logic.
export const routes = [
  { path: "/execution", Component: ExecutionWorkspace },
  { path: "/inventory", Component: InventoryLedgerView },
  { path: "/analytics", Component: AnalyticsDashboard },
  { path: "/warehouse", Component: WarehouseView },
  { path: "/procurement", Component: ProcurementView },
  { path: "/optimization", Component: OptimizationView },
];
