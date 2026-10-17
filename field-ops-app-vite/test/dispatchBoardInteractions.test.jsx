// Dispatch Board interactions (Owner 2026-10-17) — tap placement, employee review, dispatch gating. Harness from dispatchNorthStarBoard.test.jsx.
//
// Mocks the READS at their hook boundary and the COMMANDS at their transport boundary, then drives
// the real components through the real domain modules. What is asserted is the wiring that decides
// whether the board is honest:
//
//   * the North Star composition is present (workspace header, lane grid, queue, the three views);
//   * each gesture reaches the CORRECT governed command — and no other;
//   * unknown availability never becomes a percentage;
//   * a refusal is rendered in words and leaves the committed placement alone;
//   * ND-20's warnings survive a SUCCESSFUL placement;
//   * MarkReady is never a route out of SCHEDULED, and the availability collections are never read.
//
// The last two are invariants rather than features: they are the things that would still "work" if
// they were broken, which is exactly why they are asserted rather than trusted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
// The board reads the GOVERNED technician roster (listWorkOrderTechnicians), keyed by Employee id.
vi.mock("../src/hooks/useWorkOrderTechnicians", () => ({ useWorkOrderTechnicians: vi.fn() }));
vi.mock("../src/hooks/useAccountNames", () => ({ useAccountNames: vi.fn() }));
vi.mock("../src/hooks/useSessionActivityFeed", () => ({ useSessionActivityFeed: vi.fn(() => []) }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn(), suggestWorkOrderPlacement: vi.fn() }));
// What the board OFFERS follows the caller's governed capabilities; its grid clock is the caller's companies' zone.
vi.mock("../src/hooks/useMyWorkOrderCapabilities", () => ({ useMyWorkOrderCapabilities: vi.fn() }));
vi.mock("../src/services/workspaceApiClient", () => ({ callWorkspaceApi: vi.fn() }));
vi.mock("../src/services/schedulingCommandClient.js", () => ({
  rescheduleWorkOrder: vi.fn(),
  reassignScheduledWorkOrder: vi.fn(),
  readTechnicianAvailability: vi.fn(),
  setWorkOrderEstimatedDuration: vi.fn(),
}));

import DispatcherBoard from "../src/modules/dispatcherBoard/DispatcherBoard.jsx";
import { suggestWorkOrderPlacement } from "../src/services/workOrderService";
import { toZonedInput, zonedParts, zonedWallToMillis } from "../src/domain/zonedTime.js";
import { useMyWorkOrderCapabilities } from "../src/hooks/useMyWorkOrderCapabilities";
import { callWorkspaceApi } from "../src/services/workspaceApiClient";

// The governed placement default (suggestWorkOrderPlacement). Tests run in the browser's own zone so typed times read
// exactly as they did before the default moved server-side.
const TEST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const suggestionAt = (startMillis, { employeeId = "tech-a", minutes = 120, outcome = "SLOT_FOUND", alternative = null } = {}) => ({
  workOrderId: "wo-q", timeZone: TEST_ZONE, operatingCompanyId: "taylor", durationMinutes: minutes,
  searchedFrom: new Date(startMillis).toISOString(), searchedTo: new Date(startMillis + 14 * 86_400_000).toISOString(), outcome,
  suggestion: outcome === "SLOT_FOUND" ? { employeeId, displayName: null, start: new Date(startMillis).toISOString(), end: new Date(startMillis + minutes * 60_000).toISOString() } : null,
  alternative,
});
const startInput = (dialog) => dialog.querySelector('input[type="datetime-local"]');
const suggestionApplied = async (dialog) => waitFor(() => expect(startInput(dialog).value).not.toBe(""));
import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useWorkOrderTechnicians } from "../src/hooks/useWorkOrderTechnicians";
import { useAccountNames } from "../src/hooks/useAccountNames";
import { useAuth } from "../src/auth/AuthContext";
import { transitionWorkOrder } from "../src/services/workOrderService";
import {
  readTechnicianAvailability,
  reassignScheduledWorkOrder,
  rescheduleWorkOrder,
} from "../src/services/schedulingCommandClient.js";

const TECH_A = { id: "tech-a", name: "J. Barela", status: "available" };
const TECH_B = { id: "tech-b", name: "R. Ochoa", status: "available" };

function todayAt(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

const SCHEDULED_WO = {
  id: "wo-scheduled", woNumber: "WO-2026-001248", status: "SCHEDULED", type: "SERVICE_CALL",
  priority: 2, customerId: "cust-1", scheduledTechId: "tech-a",
  scheduledStart: todayAt(9), scheduledEnd: todayAt(11),
};
const QUEUE_WO = {
  id: "wo-queued", woNumber: "WO-2026-001239", status: "READY_TO_DISPATCH", type: "PM",
  priority: 2, customerId: "cust-1", estimatedDurationMinutes: 120,
};

const NOT_CONFIGURED = (id) => ({
  technicianId: id, availabilityState: "NOT_CONFIGURED", workingAvailability: null, workingIntervals: [],
  notConfiguredIntervals: [{ startMillis: todayAt(0), endMillis: todayAt(0) + 86_400_000 }], blockedTime: [], availableMinutes: null,
});

/** A technician WITH a recorded shift, and one WITHOUT — the distinction the board must keep. */
function availabilityResult({ withHours = true } = {}) {
  const dow = new Date().getDay();
  return {
    result: {
      startMillis: todayAt(0), endMillis: todayAt(0) + 86_400_000,
      technicians: [
        withHours
          ? {
              technicianId: "tech-a",
              availabilityState: "CONFIGURED",
              workingAvailability: { technicianId: "tech-a", timeZone: "America/Phoenix", weeklyHours: { [dow]: [{ start: "07:00", end: "16:00" }] } },
              // The adapted governed read's instants (schedulingCommandClient.adaptAvailabilityView).
              workingIntervals: [{ startMillis: todayAt(7), endMillis: todayAt(16) }],
              notConfiguredIntervals: [],
              blockedTime: [{ blockId: "b1", kind: "LUNCH", startMillis: todayAt(12), endMillis: todayAt(12, 30) }],
              availableMinutes: 480,
            }
          : NOT_CONFIGURED("tech-a"),
        NOT_CONFIGURED("tech-b"),
      ],
    },
  };
}

/** Renders the router location so a test can read what the board wrote to the URL. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location" hidden>{location.search}</div>;
}

function setup({ workOrders = [SCHEDULED_WO, QUEUE_WO], role = "dispatcher", availability = availabilityResult(), url = "/service/dispatcher-board" } = {}) {
  useAuth.mockReturnValue({ role });
  useWorkOrders.mockReturnValue({ data: workOrders, loading: false, error: null });
  useWorkOrderTechnicians.mockReturnValue({ data: [TECH_A, TECH_B], loading: false, error: null });
  useAccountNames.mockReturnValue(new Map([["cust-1", "Desert Sun"]]));
  readTechnicianAvailability.mockResolvedValue(availability);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DispatcherBoard />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Drag `source` onto `target` through the real DnD handlers. */
function dragOnto(source, target) {
  fireEvent.dragStart(source);
  fireEvent.dragOver(target);
  fireEvent.drop(target);
}

/** Technician names as drawn on the DAY board's lanes. The selector menu lists everyone by design. */
const laneNames = () => Array.from(document.querySelectorAll(".ns-dispatch-lane__name")).map((e) => e.textContent);
/** Technician names as drawn on the Week / 2-week row headers. */
const rowHeaderNames = () =>
  Array.from(document.querySelectorAll(".ns-dispatch-week__identity, .ns-dispatch-load__identity")).map((e) => e.textContent);

// THE CLOCK IS PINNED, and that is a correctness fix rather than a convenience.
//
// VC-4 makes past slots on TODAY invalid targets, so a suite whose fixtures sit at 09:00 "today"
// passed before lunch and failed after it. That is a test asserting the wall clock — the same
// mistake DECISIONS #137 names: a moment pinned as if it were a contract. Freezing now at 06:00
// makes every fixture below deterministically in the FUTURE, so these tests assert the GESTURE.
// The past-slot behaviour gets its own tests, which move the clock deliberately.
const PINNED_NOW = (() => { const d = new Date(); d.setHours(6, 0, 0, 0); return d.getTime(); })();

beforeEach(() => {
  vi.clearAllMocks();
  // shouldAdvanceTime keeps @testing-library's waitFor polling; a frozen clock deadlocks it.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(PINNED_NOW);
  suggestWorkOrderPlacement.mockReset();
  suggestWorkOrderPlacement.mockImplementation(async () => suggestionAt(todayAt(7, 0)));
  useMyWorkOrderCapabilities.mockReturnValue({ status: "ready", has: () => true });
  // The governed zone defaults to the test machine's own, so every assertion above reads exactly as it did.
  callWorkspaceApi.mockResolvedValue({ ok: true, result: { companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "taylor", businessTimeZone: TEST_ZONE }] } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });


// ---------------------------------------------------------------------------------------------
// Owner "DISPATCH BOARD INTERACTIONS" (2026-10-17): tap/click placement as the alternative to dragging, the employee
// review opened from a lane name (Board state restored on Back), and Dispatch offered only with its capability.
describe("tap placement — the alternative to dragging", () => {
  it("'Place on a lane' then a click on a lane proposes the SAME Schedule a drop proposes", async () => {
    transitionWorkOrder.mockResolvedValue({ id: QUEUE_WO.id, status: "SCHEDULED", warnings: [] });
    const { container } = setup();
    const card = (await screen.findByText(/WO-2026-001239/)).closest("article");
    fireEvent.click(within(card).getByRole("button", { name: "Place on a lane" }));
    expect(screen.getByText(/click a time on a technician/i)).toBeTruthy();
    fireEvent.click(container.querySelector('[data-technician-id="tech-a"]'), { clientX: 0 });
    await waitFor(() => expect(transitionWorkOrder).toHaveBeenCalled());
    const [id, action, extra] = transitionWorkOrder.mock.calls[0];
    expect([id, action, extra.scheduledTechId]).toEqual([QUEUE_WO.id, "Schedule", "tech-a"]);
    expect(screen.queryByText(/click a time on a technician/i)).toBeNull();
  });

  it("a click on a lane does nothing unless a work order is armed; Esc disarms", async () => {
    const { container } = setup();
    const card = (await screen.findByText(/WO-2026-001239/)).closest("article");
    fireEvent.click(container.querySelector('[data-technician-id="tech-a"]'));
    fireEvent.click(within(card).getByRole("button", { name: "Place on a lane" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(container.querySelector('[data-technician-id="tech-a"]'));
    await new Promise((r) => setTimeout(r, 50));
    expect(transitionWorkOrder).not.toHaveBeenCalled();
    expect(rescheduleWorkOrder).not.toHaveBeenCalled();
  });

  it("a caller without workOrder.lifecycle.schedule is offered no tap placement", async () => {
    useMyWorkOrderCapabilities.mockReturnValue({ status: "ready", has: (k) => k !== "workOrder.lifecycle.schedule" });
    setup();
    await screen.findByText(/WO-2026-001239/);
    expect(screen.queryByRole("button", { name: "Place on a lane" })).toBeNull();
  });
});

describe("employee review from a lane name", () => {
  it("opens that technician's schedule and work, and Back restores the board's date, view and filters", async () => {
    setup({ url: "/service/dispatcher-board?date=2030-01-07&techs=tech-a,tech-b" });
    fireEvent.click(await screen.findByRole("button", { name: "J. Barela" }));
    const loc = () => new URLSearchParams(screen.getByTestId("location").textContent);
    expect(loc().get("focus")).toBe("tech-a");
    expect(loc().get("view")).toBe("week");
    expect(loc().get("techs")).toBe("tech-a");
    expect(screen.getByRole("region", { name: /J. Barela: schedule and work/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the board" }));
    expect(loc().get("focus")).toBeNull();
    expect(loc().get("view")).toBeNull();
    expect(loc().get("date")).toBe("2030-01-07");
    expect(loc().get("techs")).toBe("tech-a,tech-b");
  });

  it("lists only that technician's placed work, from what the board already read", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "J. Barela" }));
    const review = screen.getByRole("region", { name: /schedule and work/ });
    expect(within(review).getByText("WO-2026-001248")).toBeTruthy();
    expect(within(review).queryByText("WO-2026-001239")).toBeNull();
  });
});

describe("dispatch follows its own capability", () => {
  it("a caller without workOrder.lifecycle.dispatch is offered no Dispatch picker", async () => {
    useMyWorkOrderCapabilities.mockReturnValue({ status: "ready", has: (k) => k !== "workOrder.lifecycle.dispatch" });
    setup();
    fireEvent.click(await screen.findByText(/WO-2026-001239/));
    await screen.findByRole("heading", { name: "WO-2026-001239" });
    expect(screen.queryByLabelText("Select technician to dispatch")).toBeNull();
  });
});

describe("a company-authority refusal is said in words", () => {
  it("COMPANY_AUTHORITY_REQUIRED on a drop names the missing company link, not a generic failure", async () => {
    transitionWorkOrder.mockRejectedValue(Object.assign(new Error("no operating-company authority"), { code: "COMPANY_AUTHORITY_REQUIRED", details: { code: "COMPANY_AUTHORITY_REQUIRED" } }));
    const { container } = setup();
    const card = (await screen.findByText(/WO-2026-001239/)).closest("article");
    fireEvent.dragStart(card);
    fireEvent.dragOver(container.querySelector('[data-technician-id="tech-a"]'));
    fireEvent.drop(container.querySelector('[data-technician-id="tech-a"]'));
    expect(await screen.findByText(/no operating company is linked to your login/i)).toBeTruthy();
  });
});
