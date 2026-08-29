// Dispatch North Star P1 — the board's composition and its command routing.
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

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));
vi.mock("../src/hooks/useAccountNames", () => ({ useAccountNames: vi.fn() }));
vi.mock("../src/hooks/useSessionActivityFeed", () => ({ useSessionActivityFeed: vi.fn(() => []) }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn() }));
vi.mock("../src/services/schedulingCommandClient.js", () => ({
  rescheduleWorkOrder: vi.fn(),
  reassignScheduledWorkOrder: vi.fn(),
  readTechnicianAvailability: vi.fn(),
  setWorkOrderEstimatedDuration: vi.fn(),
}));

import DispatcherBoard from "../src/modules/dispatcherBoard/DispatcherBoard.jsx";
import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection";
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
              workingAvailability: { technicianId: "tech-a", timeZone: "America/Phoenix", weeklyHours: { [dow]: [{ start: "07:00", end: "16:00" }] } },
              blockedTime: [{ blockId: "b1", kind: "LUNCH", startMillis: todayAt(12), endMillis: todayAt(12, 30) }],
              availableMinutes: 480,
            }
          : { technicianId: "tech-a", workingAvailability: null, blockedTime: [], availableMinutes: null },
        { technicianId: "tech-b", workingAvailability: null, blockedTime: [], availableMinutes: null },
      ],
    },
  };
}

function setup({ workOrders = [SCHEDULED_WO, QUEUE_WO], role = "dispatcher", availability = availabilityResult() } = {}) {
  useAuth.mockReturnValue({ role });
  useWorkOrders.mockReturnValue({ data: workOrders, loading: false, error: null });
  useFirestoreCollection.mockReturnValue({ data: [TECH_A, TECH_B], loading: false, error: null });
  useAccountNames.mockReturnValue(new Map([["cust-1", "Desert Sun"]]));
  readTechnicianAvailability.mockResolvedValue(availability);
  return render(<DispatcherBoard />);
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

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => cleanup());

// ---------------------------------------------------------------------------------------------
describe("the North Star composition", () => {
  it("renders the workspace identity, the lane grid and the ready queue", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: /Dispatch & Scheduling/i, level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Ready to schedule/i })).toBeTruthy();
    expect(screen.getByText("J. Barela")).toBeTruthy();
    expect(screen.getByText("R. Ochoa")).toBeTruthy();
  });

  it("offers Day, Week, 2 weeks and Map as views over one schedule", async () => {
    setup();
    await screen.findByRole("tab", { name: /^Day/ });
    expect(screen.getByRole("tab", { name: /^Week/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /2 weeks/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Map/ })).toBeTruthy();
  });

  it("draws a scheduled work order as a lane chip with its governed reference", async () => {
    setup();
    expect(await screen.findByText(/WO-2026-001248/)).toBeTruthy();
  });

  it("switching views does not issue a command", async () => {
    setup();
    fireEvent.click(await screen.findByRole("tab", { name: /^Week/ }));
    fireEvent.click(screen.getByRole("tab", { name: /2 weeks/ }));
    expect(transitionWorkOrder).not.toHaveBeenCalled();
    expect(rescheduleWorkOrder).not.toHaveBeenCalled();
  });

  it("the Map view states truthfully that location dispatch is unavailable, rather than faking a map", async () => {
    setup();
    fireEvent.click(await screen.findByRole("tab", { name: /Map/ }));
    expect(screen.getByText(/Location-based dispatch is not available/i)).toBeTruthy();
  });

  it("renders no raw document ids anywhere on the board", async () => {
    const { container } = setup();
    await screen.findByText(/WO-2026-001248/);
    expect(container.textContent).not.toContain("wo-scheduled");
    expect(container.textContent).not.toContain("cust-1");
    expect(container.textContent).not.toContain("tech-a");
  });
});

// ---------------------------------------------------------------------------------------------
describe("availability is rendered truthfully", () => {
  it("shows the recorded shift and a real percentage", async () => {
    setup();
    expect(await screen.findByText(/7a–4p/)).toBeTruthy();
    expect(screen.getByText(/% booked/)).toBeTruthy();
  });

  it("shows blocked time from the trusted read", async () => {
    setup();
    expect(await screen.findByText("Lunch")).toBeTruthy();
  });

  it("an unrecorded shift says so and shows NO percentage", async () => {
    // The rule the whole domain is built around. R. Ochoa has no availability record in the fixture.
    setup();
    await screen.findByText(/WO-2026-001248/);
    const lanes = screen.getAllByText(/Shift not recorded/);
    expect(lanes.length).toBeGreaterThan(0);
    for (const lane of lanes) {
      expect(lane.textContent).not.toMatch(/0%/);
      expect(lane.textContent).not.toMatch(/%\s*booked/);
    }
  });

  it("never reads the deny-all availability collections directly", async () => {
    // The board reaches availability ONLY through the trusted callable. Both collections deny client
    // reads, so a direct query would fail closed and look like a bug.
    setup();
    await waitFor(() => expect(readTechnicianAvailability).toHaveBeenCalled());
    expect(useFirestoreCollection).not.toHaveBeenCalledWith("technician_working_availability");
    expect(useFirestoreCollection).not.toHaveBeenCalledWith("technician_blocked_time");
  });
});

// ---------------------------------------------------------------------------------------------
describe("each gesture reaches the correct governed command", () => {
  it("queue card onto a lane proposes SCHEDULE through the existing transition", async () => {
    transitionWorkOrder.mockResolvedValue({ id: QUEUE_WO.id, status: "SCHEDULED", warnings: [] });
    const { container } = setup();
    await screen.findByText(/WO-2026-001239/);

    dragOnto(screen.getByText(/WO-2026-001239/).closest("article"), container.querySelector('[data-technician-id="tech-a"]'));
    fireEvent.click(await screen.findByRole("button", { name: /^Schedule$/ }));

    await waitFor(() => expect(transitionWorkOrder).toHaveBeenCalled());
    const [id, action, extra] = transitionWorkOrder.mock.calls[0];
    expect(id).toBe(QUEUE_WO.id);
    expect(action).toBe("Schedule");
    expect(extra.scheduledTechId).toBe("tech-a");
    expect(typeof extra.scheduledStart).toBe("number");
  });

  it("lane chip onto ITS OWN lane proposes RESCHEDULE, with the stale-view guard", async () => {
    rescheduleWorkOrder.mockResolvedValue({ result: { warnings: [] } });
    const { container } = setup();
    await screen.findByText(/WO-2026-001248/);

    dragOnto(screen.getByText(/WO-2026-001248/).closest("button"), container.querySelector('[data-technician-id="tech-a"]'));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "customer moved the appointment" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm new time/i }));

    await waitFor(() => expect(rescheduleWorkOrder).toHaveBeenCalled());
    const payload = rescheduleWorkOrder.mock.calls[0][0];
    expect(payload.workOrderId).toBe(SCHEDULED_WO.id);
    expect(payload.reason).toBe("customer moved the appointment");
    expect(payload.expectedScheduledStart).toBe(todayAt(9));
    expect(reassignScheduledWorkOrder).not.toHaveBeenCalled();
  });

  it("lane chip onto ANOTHER lane proposes REASSIGN, and never restates the window", async () => {
    reassignScheduledWorkOrder.mockResolvedValue({ result: { warnings: [] } });
    const { container } = setup();
    await screen.findByText(/WO-2026-001248/);

    dragOnto(screen.getByText(/WO-2026-001248/).closest("button"), container.querySelector('[data-technician-id="tech-b"]'));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "held at Desert Sun" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm reassignment/i }));

    await waitFor(() => expect(reassignScheduledWorkOrder).toHaveBeenCalled());
    const payload = reassignScheduledWorkOrder.mock.calls[0][0];
    expect(payload.scheduledTechId).toBe("tech-b");
    expect(payload.reason).toBe("held at Desert Sun");
    // The server takes the window from the record; a caller that could restate it could re-time and
    // reassign in one un-named action.
    expect(payload.scheduledStart).toBeUndefined();
    expect(payload.scheduledEnd).toBeUndefined();
    expect(rescheduleWorkOrder).not.toHaveBeenCalled();
  });

  it("lane chip back onto the queue proposes the governed UNSCHEDULE, never MarkReady", async () => {
    transitionWorkOrder.mockResolvedValue({ id: SCHEDULED_WO.id, status: "READY_TO_DISPATCH" });
    setup();
    await screen.findByText(/WO-2026-001248/);

    dragOnto(
      screen.getByText(/WO-2026-001248/).closest("button"),
      screen.getByRole("region", { name: /Ready to schedule/i }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "parts did not arrive" } });
    fireEvent.click(screen.getByRole("button", { name: /Return to queue/i }));

    await waitFor(() => expect(transitionWorkOrder).toHaveBeenCalled());
    const [, action, extra] = transitionWorkOrder.mock.calls[0];
    expect(action).toBe("Unschedule");
    expect(extra.unscheduleReason).toBe("parts did not arrive");
    // MarkReady targets the same status and would be a second, reason-free way out of SCHEDULED.
    const actions = transitionWorkOrder.mock.calls.map((c) => c[1]);
    expect(actions).not.toContain("MarkReady");
  });
});

// ---------------------------------------------------------------------------------------------
describe("reason gates", () => {
  it("Confirm stays disabled until a reason is typed, for both reschedule and reassign", async () => {
    const { container } = setup();
    await screen.findByText(/WO-2026-001248/);
    dragOnto(screen.getByText(/WO-2026-001248/).closest("button"), container.querySelector('[data-technician-id="tech-b"]'));

    const confirm = screen.getByRole("button", { name: /Confirm reassignment/i });
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/Confirm stays disabled until a reason is typed/i)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "held at site" } });
    expect(screen.getByRole("button", { name: /Confirm reassignment/i }).disabled).toBe(false);
  });

  it("whitespace is not a reason", async () => {
    const { container } = setup();
    await screen.findByText(/WO-2026-001248/);
    dragOnto(screen.getByText(/WO-2026-001248/).closest("button"), container.querySelector('[data-technician-id="tech-b"]'));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /Confirm reassignment/i }).disabled).toBe(true);
  });

  it("an initial Schedule needs no reason — nothing is being withdrawn", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Schedule…/ }));
    expect(screen.getByRole("button", { name: /^Schedule$/ }).disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the accessible path is the same path", () => {
  it("the picker reaches the same command a drag reaches", async () => {
    transitionWorkOrder.mockResolvedValue({ id: QUEUE_WO.id, status: "SCHEDULED", warnings: [] });
    setup();
    // No drag anywhere in this test: keyboard/touch only.
    fireEvent.click(await screen.findByRole("button", { name: /Schedule…/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getAllByRole("combobox")[0], { target: { value: "tech-a" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Schedule$/ }));

    await waitFor(() => expect(transitionWorkOrder).toHaveBeenCalled());
    expect(transitionWorkOrder.mock.calls[0][1]).toBe("Schedule");
  });

  it("the placement dialog is a real modal with an accessible name", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Schedule…/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
describe("backend truth is what renders", () => {
  it("a refusal is shown in words and the dialog stays open to correct it", async () => {
    rescheduleWorkOrder.mockResolvedValue({ errorStatus: "failed-precondition", errorCode: "BLOCKED_TIME_CONFLICT" });
    const { container } = setup();
    await screen.findByText(/WO-2026-001248/);

    dragOnto(screen.getByText(/WO-2026-001248/).closest("button"), container.querySelector('[data-technician-id="tech-a"]'));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "moving it" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm new time/i }));

    // Scoped to the DIALOG: the board surfaces the same refusal in its own message band, and both
    // are alerts on purpose — a lost placement should interrupt. The dialog is what must keep it.
    const dialog = await screen.findByRole("dialog");
    const alert = within(dialog).getByRole("alert");
    expect(alert.textContent).toMatch(/blocked time/i);
    expect(alert.textContent).not.toMatch(/BLOCKED_TIME_CONFLICT/);
  });

  it("a refused placement leaves the committed placement exactly where it was", async () => {
    rescheduleWorkOrder.mockResolvedValue({ errorStatus: "failed-precondition", errorCode: "SCHEDULE_CONFLICT" });
    const { container } = setup();
    await screen.findByText(/WO-2026-001248/);
    // Scoped to the LANE: the dialog names the same work order, and the assertion is about where the
    // CHIP sits, not about how many places the reference appears.
    const chipOf = () => container.querySelector('.ns-dispatch-chip--wo');
    const before = chipOf().getAttribute("style");

    dragOnto(chipOf(), container.querySelector('[data-technician-id="tech-a"]'));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "moving it" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirm new time/i }));
    await within(await screen.findByRole("dialog")).findByRole("alert");

    // Nothing was written and nothing was patched locally, so the chip is still exactly where the
    // committed record puts it.
    expect(chipOf().getAttribute("style")).toBe(before);
  });

  it("an out-of-hours placement COMMITS and shows the warning, not a failure", async () => {
    transitionWorkOrder.mockResolvedValue({
      id: QUEUE_WO.id, status: "SCHEDULED", warnings: [{ code: "OUTSIDE_WORKING_HOURS" }],
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /Schedule…/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getAllByRole("combobox")[0], { target: { value: "tech-a" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Schedule$/ }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/scheduled/i);
    expect(status.textContent).toMatch(/outside/i);
    expect(status.className).toMatch(/warn/);
    expect(status.className).not.toMatch(/error/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("honest states", () => {
  it("a failed work order read is not a false-empty board", () => {
    useAuth.mockReturnValue({ role: "dispatcher" });
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: new Error("boom") });
    useFirestoreCollection.mockReturnValue({ data: [TECH_A], loading: false, error: null });
    useAccountNames.mockReturnValue(new Map());
    readTechnicianAvailability.mockResolvedValue(availabilityResult());
    render(<DispatcherBoard />);
    expect(screen.getByText(/Work orders could not be loaded/i)).toBeTruthy();
  });

  it("a failed technician read gets its OWN sentence, never 'no technicians exist'", () => {
    useAuth.mockReturnValue({ role: "dispatcher" });
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: new Error("boom") });
    useAccountNames.mockReturnValue(new Map());
    readTechnicianAvailability.mockResolvedValue(availabilityResult());
    render(<DispatcherBoard />);
    expect(screen.getByText(/Technicians could not be loaded/i)).toBeTruthy();
  });

  it("an empty queue is good news, and says so distinctly", async () => {
    setup({ workOrders: [SCHEDULED_WO] });
    expect(await screen.findByText(/Every ready work order has a window and a technician/i)).toBeTruthy();
  });

  it("a role without dispatch authority is denied without leaking the board", () => {
    setup({ role: "technician" });
    expect(screen.getByText(/not available to you/i)).toBeTruthy();
    expect(screen.queryByText(/WO-2026-001248/)).toBeNull();
  });

  it("an availability read failure degrades the lanes without blocking scheduling", async () => {
    useAuth.mockReturnValue({ role: "dispatcher" });
    useWorkOrders.mockReturnValue({ data: [SCHEDULED_WO, QUEUE_WO], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [TECH_A], loading: false, error: null });
    useAccountNames.mockReturnValue(new Map());
    readTechnicianAvailability.mockResolvedValue({ errorStatus: "permission-denied", errorCode: "PERMISSION_DENIED" });
    render(<DispatcherBoard />);
    expect(await screen.findByText(/Working hours and blocked time could not be read/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Ready to schedule/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Frame 1a's technician selector. Omitted from the first build, and the omission only became
// visible on the DEPLOYED board where 24 lanes turned the day grid into a long scroll.
//
// The assertions that matter are not "does it render" — they are the four things a filter must NOT
// do. Narrowing what a dispatcher LOOKS at must never narrow what the system KNOWS: not the
// availability it reads, not the technicians it recommends, not the work in the queue, and above all
// not a single committed placement.
describe("the technician selector", () => {
  it("renders, and defaults to all technicians", async () => {
    setup();
    const trigger = await screen.findByRole("button", { name: /Technicians.*All technicians/is });
    expect(trigger.textContent).toMatch(/All technicians \(2\)/);
  });

  it("narrows the visible lanes, and only the lanes", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /All technicians/i }));
    // Hide R. Ochoa; J. Barela remains.
    fireEvent.click(screen.getByRole("checkbox", { name: "R. Ochoa" }));

    await waitFor(() => expect(laneNames()).not.toContain("R. Ochoa"));
    expect(laneNames()).toContain("J. Barela");
    expect(screen.getByRole("button", { name: /1 of 2 technicians/i })).toBeTruthy();
  });

  it("'Show all technicians' restores every lane", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /All technicians/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "R. Ochoa" }));
    await waitFor(() => expect(laneNames()).not.toContain("R. Ochoa"));

    fireEvent.click(screen.getByRole("button", { name: /Show all technicians/i }));
    await waitFor(() => expect(laneNames()).toContain("R. Ochoa"));
    expect(screen.getByRole("button", { name: /All technicians \(2\)/i })).toBeTruthy();
  });

  it("does NOT lose or mutate a scheduled work order that is still visible", async () => {
    const { container } = setup();
    await screen.findByText(/WO-2026-001248/);
    const before = container.querySelector(".ns-dispatch-chip--wo").getAttribute("style");

    fireEvent.click(screen.getByRole("button", { name: /All technicians/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "R. Ochoa" })); // NOT this job's technician
    await waitFor(() => expect(laneNames()).not.toContain("R. Ochoa"));

    // Same chip, same geometry: filtering is a view, not a re-placement.
    expect(screen.getByText(/WO-2026-001248/)).toBeTruthy();
    expect(container.querySelector(".ns-dispatch-chip--wo").getAttribute("style")).toBe(before);
  });

  it("leaves the Ready queue untouched — it is about work, not people", async () => {
    setup();
    await screen.findByText(/WO-2026-001239/);
    fireEvent.click(screen.getByRole("button", { name: /All technicians/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "J. Barela" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "R. Ochoa" }));

    // Every lane hidden, and the queue is exactly as it was.
    await waitFor(() => expect(laneNames()).toHaveLength(0));
    expect(screen.getByText(/WO-2026-001239/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Ready to schedule/i })).toBeTruthy();
  });

  it("invokes NO scheduling command — filtering is presentation only", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /All technicians/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "R. Ochoa" }));
    fireEvent.click(screen.getByRole("button", { name: /Show all technicians/i }));

    expect(transitionWorkOrder).not.toHaveBeenCalled();
    expect(rescheduleWorkOrder).not.toHaveBeenCalled();
    expect(reassignScheduledWorkOrder).not.toHaveBeenCalled();
  });

  it("does not re-read availability for a narrower roster", async () => {
    // The board keeps reading the WHOLE roster: a hidden technician's capacity stays known and stays
    // correct the moment they are shown again. Re-reading per filter would also make the trusted
    // read a function of a view control, which it is not.
    setup();
    await waitFor(() => expect(readTechnicianAvailability).toHaveBeenCalled());
    const before = readTechnicianAvailability.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /All technicians/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "R. Ochoa" }));
    await waitFor(() => expect(laneNames()).not.toContain("R. Ochoa"));
    expect(readTechnicianAvailability.mock.calls.length).toBe(before);
    for (const [args] of readTechnicianAvailability.mock.calls) {
      expect(args.technicianIds).toBeUndefined();
    }
  });

  it("applies to Week and 2 Weeks too, so the three views still show one schedule", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /All technicians/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "R. Ochoa" }));
    await waitFor(() => expect(laneNames()).not.toContain("R. Ochoa"));

    for (const tab of [/^Week/, /2 weeks/]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      await waitFor(() => expect(rowHeaderNames()).toContain("J. Barela"));
      expect(rowHeaderNames()).not.toContain("R. Ochoa");
    }
  });

  it("lists a technician with no governed name truthfully, rather than hiding them", async () => {
    // An unnamed record is still a technician work can be scheduled onto. Dropping it from the
    // selector would make it unreachable; printing its document id would leak an id. It reads
    // "Unknown technician" here exactly as it does on the lane.
    useAuth.mockReturnValue({ role: "dispatcher" });
    useWorkOrders.mockReturnValue({ data: [SCHEDULED_WO], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [TECH_A, { id: "tech-nameless" }], loading: false, error: null });
    useAccountNames.mockReturnValue(new Map());
    readTechnicianAvailability.mockResolvedValue(availabilityResult());
    render(<DispatcherBoard />);

    fireEvent.click(await screen.findByRole("button", { name: /All technicians/i }));
    expect(screen.getByRole("checkbox", { name: "Unknown technician" })).toBeTruthy();
    expect(screen.queryByText("tech-nameless")).toBeNull();
  });

  it("is keyboard reachable and closes on Escape", async () => {
    setup();
    const trigger = await screen.findByRole("button", { name: /All technicians/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(document.querySelector(".ns-dispatch-techfilter__trigger").getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "R. Ochoa" })).toBeNull());
  });
});
