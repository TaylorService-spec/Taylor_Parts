// Wave 7 completion, PART 1 -- RENDER tests (vitest + jsdom) for the combined Dispatch/Scheduling
// operating workspace. The governed read (useSchedulingData) is mocked and the write
// (transitionWorkOrder) is mocked -- no Firebase, no network. Mirrors schedulingWorkspace.test.jsx's own
// mocking convention exactly.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn() }));
vi.mock("../src/hooks/useSchedulingData", () => ({ useSchedulingData: vi.fn() }));

import DispatchSchedulingWorkspace from "../src/modules/dispatch/DispatchSchedulingWorkspace.jsx";
import { transitionWorkOrder } from "../src/services/workOrderService";
import { useSchedulingData } from "../src/hooks/useSchedulingData";

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const MONDAY = at(2026, 8, 3, 0, 0);
const MONDAY_NOON = at(2026, 8, 3, 12, 0);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setData(over = {}) {
  useSchedulingData.mockReturnValue({
    workOrders: [], technicians: [], loading: false, error: null, ...over,
  });
}

describe("DispatchSchedulingWorkspace honest states", () => {
  it("loading -> loading state", () => {
    setData({ loading: true });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);
    expect(screen.getByText(/Loading the dispatch board/i)).toBeTruthy();
  });

  it("error -> fail-closed FailureState", () => {
    setData({ error: "permission-denied" });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);
    expect(screen.getByText(/Board unavailable/i)).toBeTruthy();
  });

  it("no technicians -> honest empty board", () => {
    setData({ technicians: [] });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);
    expect(screen.getByText(/No technicians exist yet/i)).toBeTruthy();
  });
});

describe("layout: day runs left-to-right, technicians are rows", () => {
  it("renders the timeline grid with one row per technician + an hour axis, and Ready for Work exactly once", () => {
    const technicians = [{ id: "t1", name: "Alpha Tech", status: "available" }, { id: "t2", name: "Bravo Tech", status: "off_shift" }];
    setData({ technicians });
    const { container } = render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);

    // Technician rows, in a grid whose columns are [tech name][time track] -- i.e. technicians are ROWS,
    // not columns, and the row's own content (the time track) is what runs horizontally.
    expect(screen.getByText("Alpha Tech")).toBeTruthy();
    expect(screen.getByText("Bravo Tech")).toBeTruthy();
    const tracks = container.querySelectorAll(".fo-dboard-row__track");
    expect(tracks.length).toBe(2); // one horizontal track per technician row

    // Hour axis ticks exist and are ordered left (small leftPct) to right (large leftPct) -- confirms the
    // horizontal axis IS time, not something else.
    const ticks = [...container.querySelectorAll(".fo-dboard-tick")];
    expect(ticks.length).toBeGreaterThan(1);
    const lefts = ticks.map((t) => parseFloat(t.style.left));
    expect(lefts[0]).toBe(0);
    expect(lefts[lefts.length - 1]).toBe(100);
    expect(lefts.every((v, i) => i === 0 || v >= lefts[i - 1])).toBe(true);
  });

  it("responsive: the timeline scrolls horizontally instead of squeezing, and the Ready-for-Work grid reflows to available width (never a fixed desktop-only layout)", () => {
    const technicians = [{ id: "t1", name: "Alpha Tech" }];
    setData({ technicians });
    const { container } = render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);
    // The scroll wrapper exists around the fixed-minwidth timeline grid (index.css's .fo-dboard-timelinescroll
    // { overflow-x: auto }) -- on a narrow viewport the grid is never compressed illegibly, it scrolls.
    expect(container.querySelector(".fo-dboard-timelinescroll")).toBeTruthy();
    expect(container.querySelector(".fo-dboard-timelinescroll .fo-dboard-timelinegrid")).toBeTruthy();
    // Ready-for-Work uses a reflowing auto-fill grid (index.css's .fo-dboard-readygroup__list), not a fixed
    // column count, so it adapts down to phone widths rather than overflowing or squeezing text.
    const css = fs.readFileSync(path.join(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(/\.fo-dboard-readygroup__list[\s\S]*?repeat\(auto-fill/);
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.fo-dboard-timelinegrid/);
  });

  it("Ready for Work renders exactly once on the screen -- no duplicate/side-rail queue", () => {
    const technicians = [{ id: "t1", name: "Alpha Tech", status: "available" }];
    const workOrders = [{ id: "w1", woNumber: "WO-500", status: "READY_TO_DISPATCH", priority: 2 }];
    setData({ technicians, workOrders });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);

    // Scope to headings (h3) specifically -- the enclosing <section aria-label="Ready for Work"> also
    // "starts with" the same text once its child heading's text is included in a plain regex match.
    const headings = screen.getAllByText(/^Ready for Work/i, { selector: "h3" });
    expect(headings.length).toBe(1);
    // The WO itself appears exactly once too (not mirrored into a second list).
    expect(screen.getAllByText("WO-500").length).toBe(1);
  });
});

describe("Ready for Work grouping + status rendering", () => {
  it("groups the ready queue by priority (the one real field), never by an invented duration", () => {
    const technicians = [{ id: "t1", name: "Alpha Tech" }];
    const workOrders = [
      { id: "w1", woNumber: "WO-1", status: "READY_TO_DISPATCH", priority: 1 },
      { id: "w2", woNumber: "WO-2", status: "READY_TO_DISPATCH", priority: 3 },
    ];
    setData({ technicians, workOrders });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);
    expect(screen.getByText("Emergency", { exact: false })).toBeTruthy();
    expect(screen.getByText("Normal", { exact: false })).toBeTruthy();
    expect(screen.getByText(/no estimated-duration field/i)).toBeTruthy();
  });

  it("status renders on both scheduled chips and ready cards using the shared status vocabulary", () => {
    const technicians = [{ id: "t1", name: "Alpha Tech" }];
    const workOrders = [
      { id: "w1", woNumber: "WO-9", status: "SCHEDULED", scheduledStart: at(2026, 8, 3, 9, 0), scheduledEnd: at(2026, 8, 3, 10, 0), assignedTechId: "t1" },
      { id: "w2", woNumber: "WO-10", status: "READY_TO_DISPATCH", priority: 2 },
    ];
    setData({ technicians, workOrders });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);
    expect(screen.getByText("WO-9")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.getByText("WO-10")).toBeTruthy();
    expect(screen.getByText("Ready to Dispatch")).toBeTruthy();
  });
});

describe("no raw Firebase UID", () => {
  it("renders the technician's governed name field, never an auth uid", () => {
    const technicians = [{ id: "uid-should-not-render-raw", name: "Casey Tech" }];
    setData({ technicians });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);
    expect(screen.getByText("Casey Tech")).toBeTruthy();
    expect(screen.queryByText("uid-should-not-render-raw")).toBeNull();
  });
});

describe("drag/drop scheduling through the governed transition", () => {
  const technicians = [{ id: "t1", name: "Alpha Tech" }];
  const workOrders = [{ id: "w1", woNumber: "WO-700", status: "READY_TO_DISPATCH", priority: 2 }];

  it("a drop opens a governed confirm step; confirming calls transitionWorkOrder(id,'Schedule',{start<end,techId})", async () => {
    transitionWorkOrder.mockResolvedValue({ id: "w1", status: "SCHEDULED" });
    setData({ technicians, workOrders });
    const { container } = render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);

    const card = screen.getByText("WO-700").closest(".fo-dboard-readycard");
    const track = container.querySelector(".fo-dboard-row__track");
    fireEvent.dragStart(card);
    fireEvent.dragOver(track, { clientX: 100 });
    fireEvent.drop(track, { clientX: 100 });

    // The confirm dialog appears, prefilled -- nothing was written yet.
    expect(transitionWorkOrder).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /Schedule WO-700/i });
    expect(dialog).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm & Schedule/i }));
    await waitFor(() => expect(transitionWorkOrder).toHaveBeenCalledTimes(1));

    const [id, action, extra] = transitionWorkOrder.mock.calls[0];
    expect(id).toBe("w1");
    expect(action).toBe("Schedule");
    expect(extra.scheduledTechId).toBe("t1");
    expect(typeof extra.scheduledStart).toBe("number");
    expect(extra.scheduledEnd).toBeGreaterThan(extra.scheduledStart);
  });

  it("cancelling the confirm step writes nothing and the card is unchanged (never moved optimistically)", () => {
    setData({ technicians, workOrders });
    const { container } = render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);

    const card = screen.getByText("WO-700").closest(".fo-dboard-readycard");
    const track = container.querySelector(".fo-dboard-row__track");
    fireEvent.dragStart(card);
    fireEvent.dragOver(track, { clientX: 100 });
    fireEvent.drop(track, { clientX: 100 });

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(transitionWorkOrder).not.toHaveBeenCalled();
    // Ready-for-Work still shows the card, untouched.
    expect(screen.getByText("WO-700")).toBeTruthy();
  });

  it("a denied drop shows honest feedback and leaves the card in Ready for Work (never fabricates a placement)", async () => {
    transitionWorkOrder.mockRejectedValue({ code: "permission-denied" });
    setData({ technicians, workOrders });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);

    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/i })); // fallback (non-drag) path -> same confirm step
    const dialog = screen.getByRole("dialog", { name: /Schedule WO-700/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm & Schedule/i }));

    await waitFor(() => expect(screen.getByText(/not allowed to perform this action/i)).toBeTruthy());
    // The board never optimistically moved the WO -- the live mock still reports it READY_TO_DISPATCH, so
    // it is still rendered as a Ready-for-Work card (the confirm dialog, still open with the honest error,
    // also names it in its own heading -- hence checking the specific card element, not just "any text").
    expect(screen.getByText("WO-700", { selector: ".fo-dboard-readycard__wo" })).toBeTruthy();
  });

  it("invalid confirm input (end before start) is refused client-side and never calls the transition", () => {
    setData({ technicians, workOrders });
    render(<DispatchSchedulingWorkspace nowMillis={MONDAY_NOON} initialDayMillis={MONDAY} />);
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/i }));
    const dialog = screen.getByRole("dialog", { name: /Schedule WO-700/i });
    // type=date/time inputs aren't role=textbox in jsdom -- select them directly by type.
    const inputs = dialog.querySelectorAll("input");
    const dateInput = [...inputs].find((i) => i.type === "date");
    const timeInputs = [...inputs].filter((i) => i.type === "time");
    fireEvent.change(dateInput, { target: { value: "2026-08-10" } });
    fireEvent.change(timeInputs[0], { target: { value: "11:00" } }); // start
    fireEvent.change(timeInputs[1], { target: { value: "09:00" } }); // end before start
    const select = dialog.querySelector("select");
    fireEvent.change(select, { target: { value: "t1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm & Schedule/i }));
    expect(screen.getByText(/end time must be after/i)).toBeTruthy();
    expect(transitionWorkOrder).not.toHaveBeenCalled();
  });
});
