// VISUAL HARNESS — renders the real Dispatcher Board (Day and Week) to static pages with fixture data,
// for the Scheduling lane's before/after review. No dev server, no API, no credentials.
//
// Skipped unless VISUAL=1. VISUAL_OUT names the output directory; VISUAL_TAG prefixes the file names.
import { describe, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
vi.mock("../../src/hooks/useWorkOrderTechnicians", () => ({ useWorkOrderTechnicians: vi.fn() }));
vi.mock("../../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));
vi.mock("../../src/hooks/useAccountNames", () => ({ useAccountNames: vi.fn() }));
vi.mock("../../src/hooks/useSessionActivityFeed", () => ({ useSessionActivityFeed: vi.fn(() => []) }));
vi.mock("../../src/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn() }));
vi.mock("../../src/services/schedulingCommandClient.js", () => ({
  rescheduleWorkOrder: vi.fn(), reassignScheduledWorkOrder: vi.fn(), readTechnicianAvailability: vi.fn(), setWorkOrderEstimatedDuration: vi.fn(),
}));

import DispatcherBoard from "../../src/modules/dispatcherBoard/DispatcherBoard.jsx";
import { useWorkOrders } from "../../src/hooks/useWorkOrders";
import { useWorkOrderTechnicians } from "../../src/hooks/useWorkOrderTechnicians";
import { useAccountNames } from "../../src/hooks/useAccountNames";
import { useAuth } from "../../src/auth/AuthContext";
import { readTechnicianAvailability } from "../../src/services/schedulingCommandClient.js";

const DAY = 86_400_000;
const at = (h, m = 0, dayOffset = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime() + dayOffset * DAY; };
const dow = new Date().getDay();
const wo = (id, n, type, tech, s, e, cust = "c1") => ({ id, woNumber: `WO-2026-00${n}`, status: "SCHEDULED", type, priority: 2,
  customerId: cust, scheduledTechId: tech, scheduledStart: s, scheduledEnd: e });

// Synthetic fixture only: three technicians — a split shift with PTO, an early shift, and NO schedule.
const TECHS = [
  { id: "t1", name: "Avery Lane", status: "available" },
  { id: "t2", name: "Blake Ortiz", status: "available" },
  { id: "t3", name: "Casey Reyes", status: "available" },
];
const WORK = [
  wo("w1", "1301", "PM", "t1", at(8), at(10)),
  wo("w2", "1302", "SERVICE_CALL", "t1", at(11), at(12)),
  wo("w3", "1303", "INSTALL", "t2", at(9, 30), at(12, 30), "c2"),
  wo("w4", "1304", "SERVICE_CALL", "t3", at(13), at(15), "c2"),
  { id: "q1", woNumber: "WO-2026-001310", status: "READY_TO_DISPATCH", type: "PM", priority: 2, customerId: "c1", estimatedDurationMinutes: 90 },
];
const weekly = (start, end) => Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, [{ start, end }]]));
const workdays = (fromH, toH, gap) => {
  const out = [];
  for (let k = -7; k < 21; k += 1) {
    const wd = new Date(at(0, 0, k)).getDay();
    if (wd === 0 || wd === 6) continue;
    if (gap) { out.push({ startMillis: at(fromH, 0, k), endMillis: at(12, 0, k) }, { startMillis: at(12, 30, k), endMillis: at(toH, 0, k) }); }
    else out.push({ startMillis: at(fromH, 0, k), endMillis: at(toH, 0, k) });
  }
  return out;
};
const AVAILABILITY = { result: { startMillis: at(0, 0, -7), endMillis: at(0, 0, 21), technicians: [
  { technicianId: "t1", availabilityState: "CONFIGURED", availableMinutes: 330,
    workingAvailability: { timeZone: "America/Phoenix", weeklyHours: { ...weekly("07:00", "16:00"), [dow]: [{ start: "07:00", end: "12:00" }, { start: "12:30", end: "16:00" }] } },
    workingIntervals: workdays(7, 16, true), notConfiguredIntervals: [],
    blockedTime: [{ blockId: "pto", kind: "PTO", startMillis: at(14), endMillis: at(16), reason: "Dentist" }] },
  { technicianId: "t2", availabilityState: "CONFIGURED", availableMinutes: 480,
    workingAvailability: { timeZone: "America/Phoenix", weeklyHours: weekly("06:00", "14:00") },
    workingIntervals: workdays(6, 14, false), notConfiguredIntervals: [], blockedTime: [] },
  { technicianId: "t3", availabilityState: "NOT_CONFIGURED", availableMinutes: null, workingAvailability: null,
    workingIntervals: [], notConfiguredIntervals: [{ startMillis: at(0, 0, -7), endMillis: at(0, 0, 21) }], blockedTime: [] },
] } };

async function snapshot(name) {
  await screen.findByText(/WO-2026-001301/);
  await new Promise((r) => setTimeout(r, 50));
  const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
  const out = `<!doctype html><meta charset="utf-8"><title>${name}</title><style>${css}</style>
<body style="margin:0;padding:24px;background:var(--color-surface,#fff)">${document.body.innerHTML}</body>`;
  fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", `${process.env.VISUAL_TAG || "board"}-${name}.html`), out);
}

describe.skipIf(!process.env.VISUAL)("visual harness — Dispatcher Board", () => {
  for (const view of ["day", "week"]) {
    it(`writes the ${view} board`, async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(at(10, 40));
      useAuth.mockReturnValue({ role: "dispatcher" });
      useWorkOrders.mockReturnValue({ data: WORK, loading: false, error: null });
      useWorkOrderTechnicians.mockReturnValue({ data: TECHS, loading: false, error: null });
      useAccountNames.mockReturnValue(new Map([["c1", "Desert Sun Market"], ["c2", "Canyon Creamery"]]));
      readTechnicianAvailability.mockResolvedValue(AVAILABILITY);
      const { unmount } = render(<MemoryRouter><DispatcherBoard /></MemoryRouter>);
      if (view === "week") fireEvent.click(await screen.findByRole("tab", { name: /^Week/ }));
      await snapshot(view);
      unmount();
      vi.useRealTimers();
    });
  }
});
