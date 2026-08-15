import { TECH_STATUS } from "./constants";

// Wave 5 -- the ONE technician-status tone map, shared by every surface that renders a
// technician's `status` (TechnicianBoard.jsx, TechnicianDashboard.jsx, Technicians.jsx --
// all of which used the SAME `fo-badge fo-badge-${status}` string before Wave 5). Pure and
// dependency-free, matching domain/inventoryUrgencyTone.js's own convention. Preserves the
// exact existing colour intent from index.css:
//   available -> color-success / success-surface   (exact StatusPill match: "positive")
//   on_job    -> color-warning / warning-surface    (exact StatusPill match: "attention")
//   off_shift -> color-surface-sunken / text-muted  (exact StatusPill match: "muted")
const STATUS_TONE = {
  [TECH_STATUS.AVAILABLE]: "positive",
  [TECH_STATUS.ON_JOB]: "attention",
  [TECH_STATUS.OFF_SHIFT]: "muted",
};

export function technicianStatusTone(status) {
  return STATUS_TONE[status] ?? "unknown";
}
