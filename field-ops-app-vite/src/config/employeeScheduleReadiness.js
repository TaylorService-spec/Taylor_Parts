// Employee Work Schedule — the SINGLE, explicit edit-readiness seam (Scheduling PR-2).
//
//   EMPLOYEE_SCHEDULE_EDIT_READY = false   (absent from config/environments.json = false, everywhere)
//
// The Work Schedule tab READS through readEmployeeWorkSchedule. Its edit controls (record a schedule, add or end an
// exception) call the governed commands setTechnicianWorkingHours / recordTechnicianUnavailability /
// endTechnicianUnavailability, which G-9 (#2111) company-isolated. The Owner ruled (2026-10-16) that editing ACTIVATION
// stays held until the controlled G-9 proof passes and PR-2 is separately approved, so this seam is FAIL-CLOSED:
// while false the tab renders no edit control and makes ZERO command calls, whatever capability the caller holds.
//
// Compile-time constant from the one environment registry (vite `__APP_READINESS__`), never a runtime probe.
// Activation is a reviewed registry change per environment, not a code edit. `resolveScheduleEditReady` lets tests inject
// an explicit readiness; an explicit false still fails closed.
export const EMPLOYEE_SCHEDULE_EDIT_READY = __APP_READINESS__.EMPLOYEE_SCHEDULE_EDIT_READY === true;

export function resolveScheduleEditReady(override) {
  return typeof override === "boolean" ? override : EMPLOYEE_SCHEDULE_EDIT_READY;
}
