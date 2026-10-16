// FIX JOBS AND DISPATCH (Owner 2026-10-16). The Jobs page could not dispatch anything: since the governed cutover a
// scheduled Work Order already carries its technician, so the old "pick a technician for an unassigned job" branch never
// matched and every scheduled row read "Assigned to X" with no control. These tests pin the repaired flow:
//   * a scheduled job offers Dispatch to its scheduled technician — the governed Dispatch transition;
//   * a job waiting to be scheduled opens the SAME Schedule dialog as the Board, defaulted by suggestWorkOrderPlacement;
//   * what is offered follows the caller's governed capabilities (fail closed), not a hardcoded role;
//   * the Jobs page and the Board share one placement runner.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
vi.mock("../src/hooks/useWorkOrderTechnicians", () => ({ useWorkOrderTechnicians: vi.fn() }));
vi.mock("../src/hooks/useMyWorkOrderCapabilities", () => ({ useMyWorkOrderCapabilities: vi.fn() }));
vi.mock("../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn(), suggestWorkOrderPlacement: vi.fn() }));
vi.mock("../src/services/schedulingCommandClient.js", () => ({ rescheduleWorkOrder: vi.fn(), reassignScheduledWorkOrder: vi.fn() }));

import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useWorkOrderTechnicians } from "../src/hooks/useWorkOrderTechnicians";
import { useMyWorkOrderCapabilities } from "../src/hooks/useMyWorkOrderCapabilities";
import { suggestWorkOrderPlacement, transitionWorkOrder } from "../src/services/workOrderService";
import Dispatch from "../src/modules/dispatch/Dispatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const at = (ms) => ({ toMillis: () => ms });
const FUTURE = Date.now() + 2 * 86_400_000;

const SCHEDULED = { id: "wo-s", woNumber: "WO-2030-000001", status: "SCHEDULED", customerName: "Harbor Grill",
  assignedTechId: "tech-a", scheduledTechId: "tech-a", scheduledStart: at(FUTURE), scheduledEnd: at(FUTURE + 7_200_000) };
const READY = { id: "wo-r", woNumber: "WO-2030-000002", status: "READY_TO_DISPATCH", customerName: "Summit Grill", priority: 3 };
const ROSTER = [{ id: "tech-a", name: "Ava Ramirez" }, { id: "tech-b", name: "Bo Field" }];
const caps = (...keys) => ({ status: "ready", has: (k) => keys.includes(k) });

beforeEach(() => {
  useWorkOrders.mockReturnValue({ data: [READY, SCHEDULED], loading: false, error: null });
  useWorkOrderTechnicians.mockReturnValue({ data: ROSTER, loading: false, error: null });
  useMyWorkOrderCapabilities.mockReturnValue(caps("workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch"));
  suggestWorkOrderPlacement.mockImplementation(async () => ({
    workOrderId: READY.id, timeZone: ZONE, operatingCompanyId: "taylor", durationMinutes: 120,
    searchedFrom: new Date(FUTURE).toISOString(), searchedTo: new Date(FUTURE + 14 * 86_400_000).toISOString(),
    outcome: "SLOT_FOUND", suggestion: { employeeId: "tech-b", displayName: null, start: new Date(FUTURE).toISOString(),
      end: new Date(FUTURE + 7_200_000).toISOString() }, alternative: null,
  }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("the Jobs page dispatches and schedules through the governed commands", () => {
  it("groups the work: scheduled-and-ready-to-dispatch first, then waiting to be scheduled", () => {
    render(<Dispatch />);
    const titles = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(titles).toEqual(["Scheduled — ready to dispatch", "Waiting to be scheduled"]);
  });

  it("a scheduled job offers Dispatch to its scheduled technician — the governed Dispatch transition", async () => {
    transitionWorkOrder.mockResolvedValue({ id: SCHEDULED.id, status: "DISPATCHED" });
    render(<Dispatch />);
    fireEvent.click(screen.getByRole("button", { name: "Dispatch to Ava Ramirez" }));
    await waitFor(() => expect(transitionWorkOrder).toHaveBeenCalledWith("wo-s", "Dispatch", { assignedTechId: "tech-a" }));
    expect(await screen.findByText(/WO-2030-000001 dispatched\./)).toBeTruthy();
  });

  it("a job waiting to be scheduled opens the Board's Schedule dialog, defaulted to the governed suggestion", async () => {
    transitionWorkOrder.mockResolvedValue({ id: READY.id, status: "SCHEDULED", warnings: [] });
    render(<Dispatch />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule…" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.querySelector('input[type="datetime-local"]').value).not.toBe(""));
    expect(suggestWorkOrderPlacement.mock.calls[0][0].workOrderId).toBe(READY.id);
    expect(within(dialog).getAllByRole("combobox")[0].value).toBe("tech-b"); // the suggested technician, not a guess
    fireEvent.click(within(dialog).getByRole("button", { name: /^Schedule$/ }));
    await waitFor(() => expect(transitionWorkOrder).toHaveBeenCalled());
    const [id, action, extra] = transitionWorkOrder.mock.calls[0];
    expect([id, action, extra.scheduledTechId, extra.scheduledStart]).toEqual([READY.id, "Schedule", "tech-b", FUTURE - (FUTURE % 60_000)]);
  });

  it("offers only what the caller's governed capabilities allow — and fails closed while they are unknown", () => {
    useMyWorkOrderCapabilities.mockReturnValue(caps("workOrder.lifecycle.schedule"));
    const { unmount } = render(<Dispatch />);
    expect(screen.queryByRole("button", { name: /Dispatch to/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Schedule…" })).toBeTruthy();
    unmount();

    useMyWorkOrderCapabilities.mockReturnValue({ status: "loading", has: () => false });
    render(<Dispatch />);
    expect(screen.queryByRole("button", { name: /Dispatch to|Schedule…|Reassign…|Move…/ })).toBeNull();
  });

  it("says so when the caller can see jobs but holds neither scheduling nor dispatch", () => {
    useMyWorkOrderCapabilities.mockReturnValue(caps());
    render(<Dispatch />);
    expect(screen.getByText(/scheduling and dispatching are not part of your access/i)).toBeTruthy();
  });

  it("the Jobs page and the Dispatcher Board share one placement runner and one dialog (no second scheduler)", () => {
    const src = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
    const jobs = src("../src/modules/dispatch/Dispatch.jsx");
    const board = src("../src/modules/dispatcherBoard/DispatcherBoard.jsx");
    for (const s of [jobs, board]) {
      expect(s).toMatch(/usePlacementCommands/);
      expect(s).toMatch(/PlacementDialog/);
      expect(s).toMatch(/suggestWorkOrderPlacement/);
    }
    expect(jobs).not.toMatch(/getAllowedActions\([^)]*"dispatcher"/); // no hardcoded role decides what is offered
  });
});
