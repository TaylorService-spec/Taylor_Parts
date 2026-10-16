// VISUAL HARNESS — the Employee record's Work Schedule tab (Scheduling PR-2), rendered to static pages with a mocked
// Work Order client and synthetic data. No server, no credentials. Skipped unless VISUAL=1.
import { describe, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import EmployeeWorkSchedule from "../../src/modules/administration/EmployeeWorkSchedule.jsx";

const DAY = 86_400_000;
const split = [{ start: "07:00", end: "12:00" }, { start: "12:30", end: "16:00" }];
const READ = {
  employeeId: "emp-1", operatingCompanyId: "taylor", schedulesHasMore: false,
  schedules: [
    { scheduleId: "s2", status: "UPCOMING", operatingCompanyId: null, timeZone: "America/Phoenix", effectiveFrom: "2026-11-02", effectiveTo: null,
      weeklyHours: Object.fromEntries(["1", "2", "3", "4", "5"].map((d) => [d, [{ start: "06:00", end: "14:00" }]])) },
    { scheduleId: "s1", status: "CURRENT", operatingCompanyId: null, timeZone: "America/Phoenix", effectiveFrom: "2026-09-01", effectiveTo: "2026-11-02",
      weeklyHours: { 1: split, 2: split, 3: split, 4: split, 5: [{ start: "07:00", end: "13:00" }] } },
  ],
  exceptions: [{ unavailabilityId: "x1", kind: "PTO", startMillis: Date.now() + 3 * DAY, endMillis: Date.now() + 5 * DAY, ended: false, reason: "Family trip" }],
};
const client = (caps) => ({ call: async (op) => (op === "readEmployeeWorkSchedule" ? { ok: true, result: READ }
  : op === "readMyWorkOrderCapabilities" ? { ok: true, result: { capabilities: caps } } : { ok: false, code: "UNKNOWN_OPERATION" }) });

function write(name) {
  const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
  fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", `schedule-tab-${name}.html`),
    `<!doctype html><meta charset="utf-8"><style>${css}</style><body style="margin:0;padding:24px;max-width:1100px">${document.body.innerHTML}</body>`);
}

describe.skipIf(!process.env.VISUAL)("visual harness — Employee Work Schedule tab", () => {
  it("writes the held (read-only) tab", async () => {
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client(["workOrder.lifecycle.schedule"])} />);
    await screen.findByRole("table", { name: /Weekly working hours/ });
    write("held");
    cleanup();
  });
  it("writes the editor as it will look once activated", async () => {
    render(<EmployeeWorkSchedule employeeId="emp-1" client={client(["workOrder.lifecycle.schedule"])} editReady />);
    fireEvent.click(await screen.findByRole("button", { name: "Record a new schedule" }));
    write("editor-when-activated");
    cleanup();
  });
});
