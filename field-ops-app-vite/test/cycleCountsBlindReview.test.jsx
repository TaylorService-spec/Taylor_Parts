// CYCLE COUNTS workspace — durable, blind per line, reviewed per line (A1 + A4, Decision #179).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import CycleCounts from "../src/modules/inventory/CycleCounts.jsx";

vi.mock("../src/services/operationsQueries", () => ({ fetchWarehouses: vi.fn().mockResolvedValue([{ id: "WH-1", name: "Phoenix" }]) }));
vi.mock("../src/services/truckRegistryQueries", () => ({ fetchMobileLocationDocs: vi.fn().mockResolvedValue([]) }));

afterEach(cleanup);

const SHEET = { sheetId: "ccs_1", location: { type: "BIN", locationId: "bin_a" }, locationLabel: "A01-003", status: "OPEN", createdAt: 1_700_000_000_000 };
const LINES = [
  { partId: "PRT-OPEN", trackingMode: "NONE", status: "OPEN" },
  { partId: "PRT-SHORT", trackingMode: "NONE", status: "COUNTED", countedQuantity: 3, expectedQuantity: 5, variance: -2, submittedBy: "u1" },
  { partId: "PRT-DONE", trackingMode: "NONE", status: "RECONCILED", countedQuantity: 5, expectedQuantity: 5, variance: 0, reviewDecision: "APPROVE", ledgerEventIds: [] },
];
function client(over = {}) {
  return {
    listCycleCountSheets: vi.fn().mockResolvedValue({ sheets: [SHEET], nextCursor: null }),
    getCycleCountSheet: vi.fn().mockResolvedValue({ sheet: SHEET, lines: LINES, nextCursor: null }),
    reconcileCycleCountLine: vi.fn().mockResolvedValue({ outcome: "applied", status: "RECONCILED" }),
    closeCycleCountSheet: vi.fn(), cancelCycleCountSheet: vi.fn(), createCycleCountSheet: vi.fn(),
    openCycleCountLine: vi.fn(), submitCycleCountLine: vi.fn(), cancelCycleCountLine: vi.fn(),
    ...over,
  };
}
async function openSheet(c = client()) {
  render(<CycleCounts deps={{ cycleCountClient: c }} />);
  const btn = await screen.findByRole("button", { name: /A01-003/ });
  await act(async () => { fireEvent.click(btn); });
  await screen.findByRole("region", { name: /count sheet/i });
  return c;
}
const lineOf = (partId) => screen.getByText(partId).closest("li");

describe("Cycle Counts workspace", () => {
  it("lists sheets from the durable read, by location label", async () => {
    const c = client();
    render(<CycleCounts deps={{ cycleCountClient: c }} />);
    expect(await screen.findByRole("button", { name: /Bin A01-003/ })).toBeTruthy();
    expect(c.listCycleCountSheets).toHaveBeenCalledWith({ status: "OPEN" });
  });

  it("BLIND PER LINE: an open line shows no expected figure; a counted one shows its own", async () => {
    await openSheet();
    expect(within(lineOf("PRT-OPEN")).queryByText(/expected/i)).toBeNull();
    expect(within(lineOf("PRT-SHORT")).getByText(/expected 5/i)).toBeTruthy();
  });

  it("a differing count needs a reason before it can be approved or rejected", async () => {
    const c = await openSheet();
    const row = lineOf("PRT-SHORT");
    const approve = within(row).getByRole("button", { name: /approve and adjust/i });
    expect(approve.disabled).toBe(true);
    fireEvent.change(within(row).getByLabelText(/review reason/i), { target: { value: "two damaged" } });
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: /approve and adjust/i })); });
    expect(c.reconcileCycleCountLine).toHaveBeenCalledWith({ sheetId: "ccs_1", partId: "PRT-SHORT", decision: "APPROVE", reason: "two damaged" });
  });

  it("separation of duties: the server's refusal is shown on THAT line", async () => {
    await openSheet(client({ reconcileCycleCountLine: vi.fn().mockRejectedValue({ code: "functions/permission-denied", details: { code: "SEPARATION_OF_DUTIES" } }) }));
    const row = lineOf("PRT-SHORT");
    fireEvent.change(within(row).getByLabelText(/review reason/i), { target: { value: "x" } });
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: /^reject$/i })); });
    expect(within(lineOf("PRT-SHORT")).getByRole("alert").textContent).toMatch(/cannot approve or reject its own material variance/);
  });

  it("close is offered only when every live line is decided; cancel only while nothing is counted", async () => {
    await openSheet();
    expect(screen.queryByRole("button", { name: /close this count/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel this count/i })).toBeNull();
    cleanup();
    await openSheet(client({ getCycleCountSheet: vi.fn().mockResolvedValue({ sheet: SHEET, lines: [LINES[2]], nextCursor: null }) }));
    expect(screen.getByRole("button", { name: /close this count/i })).toBeTruthy();
  });

  it("a failed list read is a refusal, not an empty workspace", async () => {
    render(<CycleCounts deps={{ cycleCountClient: client({ listCycleCountSheets: vi.fn().mockRejectedValue({ code: "functions/permission-denied" }) }) }} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/not authorized/i);
    expect(screen.queryByText(/no counts here/i)).toBeNull();
  });
});
