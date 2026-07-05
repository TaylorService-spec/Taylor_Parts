import { TECH_STATUS } from "../../domain/constants";

// Epic 2 Phase 2C -- friendly labels for the 3 real TECH_STATUS values
// (available/on_job/off_shift). "On Break" does NOT exist anywhere in
// this schema and is deliberately NOT included -- per this epic's own
// instruction to never fabricate a status. Any unrecognized status
// value renders as "Unknown" rather than silently showing nothing or
// a raw enum string. Split into its own file (not exported alongside
// TechnicianCapacityCard.jsx's component) to avoid a fast-refresh
// lint warning for mixing component and non-component exports in one
// file.
const STATUS_LABEL = {
  [TECH_STATUS.AVAILABLE]: "Available",
  [TECH_STATUS.ON_JOB]: "Busy",
  [TECH_STATUS.OFF_SHIFT]: "Off Shift",
};

export function technicianStatusLabel(status) {
  return STATUS_LABEL[status] ?? "Unknown";
}
