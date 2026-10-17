// Owner "WORK HOURS AND PTO ENTRY" (2026-10-17): the Dispatcher Board's way to an Employee's working hours and PTO.
//
// The "Work schedule" link (technician review panel) and the linked "No schedule" marker open the governed Employee
// record's Work Schedule tab, carrying the board's exact address back. They are OFFERED only when the record route is
// mounted for this caller (employeeRecordsReachable) AND the caller holds FLAT employee.record.read -- fail closed
// otherwise, and no Workforce call at all without Administration. Scheduling never implies Employee Administration.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
vi.mock("../src/hooks/useWorkOrderTechnicians", () => ({ useWorkOrderTechnicians: vi.fn() }));
vi.mock("../src/hooks/useAccountNames", () => ({ useAccountNames: vi.fn(() => new Map()) }));
vi.mock("../src/hooks/useSessionActivityFeed", () => ({ useSessionActivityFeed: vi.fn(() => []) }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn(), suggestWorkOrderPlacement: vi.fn() }));
vi.mock("../src/hooks/useMyWorkOrderCapabilities", () => ({ useMyWorkOrderCapabilities: vi.fn() }));
vi.mock("../src/services/workspaceApiClient", () => ({ callWorkspaceApi: vi.fn() }));
vi.mock("../src/services/workforceApiClient.js", () => ({ workforceApiClient: { call: vi.fn() } }));
vi.mock("../src/services/schedulingCommandClient.js", () => ({
  rescheduleWorkOrder: vi.fn(), reassignScheduledWorkOrder: vi.fn(), readTechnicianAvailability: vi.fn(), setWorkOrderEstimatedDuration: vi.fn(),
}));

import DispatcherBoard from "../src/modules/dispatcherBoard/DispatcherBoard.jsx";
import { safeBoardReturn } from "../src/domain/employeeScheduleLink.js";
import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useWorkOrderTechnicians } from "../src/hooks/useWorkOrderTechnicians";
import { useAuth } from "../src/auth/AuthContext";
import { useMyWorkOrderCapabilities } from "../src/hooks/useMyWorkOrderCapabilities";
import { callWorkspaceApi } from "../src/services/workspaceApiClient";
import { workforceApiClient } from "../src/services/workforceApiClient.js";
import { readTechnicianAvailability } from "../src/services/schedulingCommandClient.js";

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TECHS = [{ id: "tech-a", name: "J. Barela", status: "available" }, { id: "tech-b", name: "R. Ochoa", status: "available" }];
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const NOT_CONFIGURED = (id) => ({ technicianId: id, availabilityState: "NOT_CONFIGURED", workingAvailability: null, workingIntervals: [],
  notConfiguredIntervals: [{ startMillis: dayStart(), endMillis: dayStart() + 86_400_000 }], blockedTime: [], availableMinutes: null });

function LocationProbe() {
  const l = useLocation();
  return <div data-testid="location" hidden>{`${l.pathname}${l.search}`}</div>;
}

/** A stand-in for the Employee record route. Its real "Back to the board" is tested against UserDetail itself
 *  (administrationUsersSurfaces.test.jsx); here it only proves the link carries the board address there. */
function RecordStandIn() {
  const l = useLocation();
  return <p>Employee record · back = {safeBoardReturn(new URLSearchParams(l.search).get("back")) ?? "none"}</p>;
}

function setup({ reachable = true, workforce = ["employee.record.read"], url = "/service/dispatcher-board" } = {}) {
  workforceApiClient.call.mockResolvedValue({ ok: true, result: { capabilities: workforce } });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/service/dispatcher-board" element={<DispatcherBoard employeeRecordsReachable={reachable} />} />
        <Route path="/administration/users/:employeeId" element={<RecordStandIn />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ role: "dispatcher", user: { uid: "prn-rudy" } });
  useWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
  useWorkOrderTechnicians.mockReturnValue({ data: TECHS, loading: false, error: null });
  useMyWorkOrderCapabilities.mockReturnValue({ status: "ready", has: () => true });
  callWorkspaceApi.mockResolvedValue({ ok: true, result: { companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "taylor", businessTimeZone: ZONE }] } });
  readTechnicianAvailability.mockResolvedValue({ result: { startMillis: dayStart(), endMillis: dayStart() + 86_400_000, technicians: [NOT_CONFIGURED("tech-a"), NOT_CONFIGURED("tech-b")] } });
});
afterEach(cleanup);

const marker = (name) => screen.getByText(name).closest(".ns-dispatch-grid__row").querySelector(".ns-dispatch-lane__noschedule");

describe("who is offered the Work schedule link", () => {
  it("Administration reachable + flat employee.record.read: the No schedule marker links to the Work Schedule tab with the board address", async () => {
    setup({ url: "/service/dispatcher-board?view=day&date=2026-10-20" });
    await waitFor(() => expect(marker("J. Barela").tagName).toBe("A"));
    const href = marker("J. Barela").getAttribute("href");
    const u = new URL(href, "https://app.example");
    expect(u.pathname).toBe("/administration/users/tech-a");
    expect(u.searchParams.get("tab")).toBe("schedule");
    expect(u.searchParams.get("back")).toBe("/service/dispatcher-board?view=day&date=2026-10-20");
  });

  it("no Administration: no link, and NO Workforce call is made", async () => {
    setup({ reachable: false });
    await screen.findByText("J. Barela");
    await waitFor(() => expect(marker("J. Barela")).toBeTruthy());
    expect(marker("J. Barela").tagName).toBe("SPAN");
    expect(workforceApiClient.call).not.toHaveBeenCalled();
  });

  it("Administration but no employee.record.read (or a failed answer): no link", async () => {
    for (const answer of [{ ok: true, result: { capabilities: ["admin.principalAccess.read"] } }, { ok: false, code: "UNREACHABLE" }]) {
      cleanup();
      workforceApiClient.call.mockResolvedValue(answer);
      render(
        <MemoryRouter initialEntries={["/service/dispatcher-board"]}>
          <DispatcherBoard employeeRecordsReachable />
        </MemoryRouter>,
      );
      await waitFor(() => expect(workforceApiClient.call).toHaveBeenCalled());
      await screen.findByText("J. Barela");
      expect(marker("J. Barela").tagName).toBe("SPAN");
      workforceApiClient.call.mockClear();
    }
  });
});

describe("the technician review panel and the round trip", () => {
  it("the review offers Work schedule; the record's Back to the board restores the board and the review", async () => {
    setup({ url: "/service/dispatcher-board?view=week&date=2026-10-20" });
    fireEvent.click(await screen.findByRole("button", { name: "J. Barela" }));
    const review = await screen.findByRole("region", { name: /J. Barela: schedule and work/ });
    const boardBefore = screen.getByTestId("location").textContent;
    const link = await within(review).findByRole("link", { name: "Work schedule" });
    const u = new URL(link.getAttribute("href"), "https://app.example");
    expect(u.searchParams.get("back")).toBe(boardBefore);
    expect(boardBefore).toMatch(/focus=tech-a/);

    // Follow it: the record receives the board's exact address (date, view, filter AND the open review).
    fireEvent.click(link);
    expect(screen.getByTestId("location").textContent).toMatch(/^\/administration\/users\/tech-a\?tab=schedule&back=/);
    expect(screen.getByText(/Employee record · back = /).textContent).toBe(`Employee record · back = ${boardBefore}`);
  });

  it("without the capability the review has no Work schedule link, and Back to the board still works", async () => {
    setup({ workforce: [] });
    fireEvent.click(await screen.findByRole("button", { name: "J. Barela" }));
    const review = await screen.findByRole("region", { name: /J. Barela: schedule and work/ });
    await waitFor(() => expect(workforceApiClient.call).toHaveBeenCalled());
    expect(within(review).queryByRole("link", { name: "Work schedule" })).toBeNull();
    expect(within(review).getByRole("button", { name: "Back to the board" })).toBeTruthy();
  });
});
