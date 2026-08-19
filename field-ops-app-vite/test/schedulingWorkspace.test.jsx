// Scheduling -- RENDER tests (vitest + jsdom). Covers the governed Schedule collector (calls the deployed
// transitionWorkOrder("Schedule", ...) with the validated payload; honest failures never call it) and the
// weekly workspace honest states + week navigation + Ready-to-Schedule flow. The governed reads are mocked
// (useSchedulingData) and the transition service is mocked -- no Firebase, no network.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn() }));
vi.mock("../src/hooks/useSchedulingData", () => ({ useSchedulingData: vi.fn() }));

import ScheduleWorkOrderForm from "../src/shared/scheduling/ScheduleWorkOrderForm.jsx";
import SchedulingWorkspace from "../src/modules/scheduling/SchedulingWorkspace.jsx";
import { transitionWorkOrder } from "../src/services/workOrderService";
import { useSchedulingData } from "../src/hooks/useSchedulingData";

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const MONDAY = at(2026, 8, 3, 0, 0); // week of Aug 3-9 2026
const WED_NOON = at(2026, 8, 5, 12, 0);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ScheduleWorkOrderForm (governed Schedule collector)", () => {
  const techs = [{ id: "t1", name: "Alpha Tech" }, { id: "t2", name: "Bravo Tech" }];

  it("valid input calls transitionWorkOrder(id, 'Schedule', {start<end, techId})", async () => {
    transitionWorkOrder.mockResolvedValue({ id: "w1", status: "SCHEDULED" });
    const onScheduled = vi.fn();
    render(<ScheduleWorkOrderForm workOrder={{ id: "w1", woNumber: "WO-1" }} technicians={techs} onScheduled={onScheduled} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("Technician"), { target: { value: "t2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    await Promise.resolve();
    expect(transitionWorkOrder).toHaveBeenCalledTimes(1);
    const [id, action, extra] = transitionWorkOrder.mock.calls[0];
    expect(id).toBe("w1");
    expect(action).toBe("Schedule");
    expect(extra.scheduledTechId).toBe("t2");
    expect(typeof extra.scheduledStart).toBe("number");
    expect(extra.scheduledEnd).toBeGreaterThan(extra.scheduledStart);
  });

  it("end-before-start shows an honest error and does NOT call the transition", () => {
    render(<ScheduleWorkOrderForm workOrder={{ id: "w1", woNumber: "WO-1" }} technicians={techs} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("Technician"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    expect(screen.getByText(/end time must be after/i)).toBeTruthy();
    expect(transitionWorkOrder).not.toHaveBeenCalled();
  });

  it("no technician selected -> the transition is never called (native required guards; domain TECH_REQUIRED covered in the .mjs suite)", () => {
    render(<ScheduleWorkOrderForm workOrder={{ id: "w1", woNumber: "WO-1" }} technicians={techs} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "11:00" } });
    // The technician <select> is left empty. It is `required`, so submission never reaches the transition.
    expect(screen.getByLabelText("Technician").required).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    expect(transitionWorkOrder).not.toHaveBeenCalled();
  });
});

describe("SchedulingWorkspace honest states + week board", () => {
  function setData(over = {}) {
    useSchedulingData.mockReturnValue({
      workOrders: [], technicians: [], loading: false, error: null, ...over,
    });
  }

  it("loading -> loading state", () => {
    setData({ loading: true });
    render(<SchedulingWorkspace nowMillis={WED_NOON} initialWeekStart={MONDAY} />);
    expect(screen.getByText(/Loading the weekly schedule/i)).toBeTruthy();
  });

  it("error -> fail-closed FailureState", () => {
    setData({ error: "permission-denied" });
    render(<SchedulingWorkspace nowMillis={WED_NOON} initialWeekStart={MONDAY} />);
    expect(screen.getByText(/Schedule unavailable/i)).toBeTruthy();
  });

  it("no technicians -> honest empty board", () => {
    setData({ technicians: [] });
    render(<SchedulingWorkspace nowMillis={WED_NOON} initialWeekStart={MONDAY} />);
    expect(screen.getByText(/No technicians exist yet/i)).toBeTruthy();
  });

  it("renders a scheduled job in the week + a Ready-to-Schedule row; opening its form; week nav clears it", () => {
    const technicians = [{ id: "t1", name: "Alpha Tech" }];
    const workOrders = [
      { id: "w1", woNumber: "WO-100", status: "SCHEDULED", scheduledTechId: "t1", scheduledStart: at(2026, 8, 5, 9, 0), scheduledEnd: at(2026, 8, 5, 10, 0), priority: 3, type: "PM" },
      { id: "w2", woNumber: "WO-200", status: "READY_TO_DISPATCH", priority: 1, type: "SERVICE_CALL" },
    ];
    setData({ technicians, workOrders });
    render(<SchedulingWorkspace nowMillis={WED_NOON} initialWeekStart={MONDAY} />);

    // Scheduled job chip is on the board; ready-to-schedule WO is in the queue.
    expect(screen.getByText("WO-100")).toBeTruthy();
    expect(screen.getByText("WO-200")).toBeTruthy();
    // Summary label text is split across a <strong> count + a text node; match the label alone.
    expect(screen.getByText(/scheduled this week/i)).toBeTruthy();

    // Open the schedule collector for the ready WO.
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    // The collector's Technician select only exists once the form opens (unique to the form).
    expect(screen.getByLabelText("Technician")).toBeTruthy();

    // Navigate to next week -> the scheduled job (this week only) is gone from the board.
    fireEvent.click(screen.getByRole("button", { name: /Next week/i }));
    expect(screen.queryByText("WO-100")).toBeNull();
  });

  it("opening a job's detail renders an accessible modal -- aria-modal, focus moved in, Escape closes", () => {
    const technicians = [{ id: "t1", name: "Alpha Tech" }];
    const workOrders = [
      { id: "w1", woNumber: "WO-100", status: "SCHEDULED", scheduledTechId: "t1", scheduledStart: at(2026, 8, 5, 9, 0), scheduledEnd: at(2026, 8, 5, 10, 0), priority: 3, type: "PM" },
    ];
    setData({ technicians, workOrders });
    render(<SchedulingWorkspace nowMillis={WED_NOON} initialWeekStart={MONDAY} />);

    // Open the job's inline detail from its chip.
    fireEvent.click(screen.getByRole("button", { name: /WO-100/ }));

    const dialog = screen.getByRole("dialog", { name: "WO-100" });
    // aria-modal must be present (a bare role="dialog" with no aria-modal is not a real
    // modal to assistive tech).
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Focus must move INTO the dialog on open, not stay wherever it was on the page.
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Escape closes it -- the detail disappears from the document entirely.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "WO-100" })).toBeNull();
  });
});
