// SYNTHETIC ACCEPTANCE AVAILABILITY (Owner DECISION 5, 2026-09-30): "Synthetic acceptance availability may be configured
// explicitly." A test that schedules a technician states that technician's working hours through the governed command --
// round the clock, UTC -- instead of relying on an assumed 24/7 default, which the runtime refuses to assume.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const availability = require("../../lib/eosOps/workOrderAvailability.js");

export const ROUND_THE_CLOCK = Object.freeze(Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"]
  .map((d) => [d, [{ start: "00:00", end: "24:00" }]])));

/** Configure round-the-clock UTC hours for each Employee, as `scheduler` (an actor holding workOrder.lifecycle.schedule). */
export async function configureRoundTheClock(pool, scheduler, employeeIds) {
  for (const employeeId of employeeIds) {
    await availability.setTechnicianWorkingHours({ pool }, { actor: scheduler },
      { employeeId, timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "synthetic acceptance availability" });
  }
}
