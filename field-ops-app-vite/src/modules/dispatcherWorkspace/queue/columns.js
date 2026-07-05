import { formatDate, relativeTime, resolveTechnicianName } from "../shared/formatters";

// Epic 2 Phase 2A -- config-driven columns. QueueHeader/QueueRow both
// render from this array; adding/reordering/removing a column means
// editing this file only, never touching QueueHeader.jsx/QueueRow.jsx's
// JSX. `render(workOrder, ctx)` returns a plain value (string) or a
// React node -- ctx carries whatever a column needs beyond the WO
// itself (currently just `technicians`, for name resolution).
export const QUEUE_COLUMNS = [
  {
    key: "priority",
    label: "Priority",
    render: (wo) => wo.priority,
  },
  {
    key: "woNumber",
    label: "WO #",
    render: (wo) => wo.woNumber,
  },
  {
    key: "customer",
    label: "Customer",
    render: (wo) => wo.customerId,
  },
  {
    key: "location",
    label: "Location",
    render: (wo) => wo.locationId,
  },
  {
    key: "status",
    label: "Status",
    render: (wo) => wo.status,
  },
  {
    key: "technician",
    label: "Technician",
    render: (wo, ctx) => resolveTechnicianName(wo.assignedTechId, ctx.technicians),
  },
  {
    key: "scheduledDate",
    label: "Scheduled",
    render: (wo) => formatDate(wo.scheduledStart),
  },
  {
    key: "age",
    label: "Age",
    render: (wo) => relativeTime(wo.createdAt),
  },
  {
    key: "parts",
    label: "Parts",
    render: (wo) => (wo.inventorySnapshot?.length ? "📦" : ""),
  },
];
