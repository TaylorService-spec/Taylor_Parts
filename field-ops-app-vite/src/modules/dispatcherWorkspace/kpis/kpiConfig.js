import { DISPATCHER_QUEUE_STATUSES } from "../../../services/workOrderQueries";
import { isToday } from "../shared/formatters";

// Epic 2 Phase 2A -- config-driven KPIs, computed over the FULL
// (unfiltered) Work Order set -- these are always "the whole board,"
// independent of whichever Saved View/Quick Filter/search is currently
// narrowing the queue below, so a dispatcher always sees true totals.
export const KPI_CONFIG = [
  { key: "total", label: "Total", compute: (workOrders) => workOrders.length },
  { key: "p1", label: "Priority 1", compute: (workOrders) => workOrders.filter((wo) => wo.priority === 1).length },
  {
    key: "unassigned",
    label: "Unassigned",
    compute: (workOrders) => workOrders.filter((wo) => !wo.assignedTechId).length,
  },
  {
    key: "waiting",
    label: "Waiting on Dispatch",
    compute: (workOrders) => workOrders.filter((wo) => DISPATCHER_QUEUE_STATUSES.includes(wo.status)).length,
  },
  {
    key: "scheduledToday",
    label: "Scheduled Today",
    compute: (workOrders) => workOrders.filter((wo) => isToday(wo.scheduledStart)).length,
  },
];
