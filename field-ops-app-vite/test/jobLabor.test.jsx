// Recording time on a phone, rendered.
//
// The decision layer proves what may be sent. What only a render proves is that the SCREEN honours
// it: that the form asks for the two things the platform does not know and nothing else, that a
// disabled control says why, that no figure of money appears anywhere, and that one press sends one
// entry.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import JobLabor from "../src/modules/mobile/JobLabor.jsx";

const READY = {
  status: "ready", workOrderId: "wo1",
  entries: [], canRecord: true, canCorrect: false,
  totals: { totalMinutes: 90, onsiteMinutes: 60, travelMinutes: 30, activeEntries: 2, reversedEntries: 0 },
  laborTypes: ["ONSITE", "TRAVEL"], entryKinds: ["INTERVAL", "DURATION"], maxMinutes: 960,
};

let fetchLabor, recordLabor;
beforeEach(() => {
  fetchLabor = vi.fn().mockResolvedValue({ outcome: READY, error: null });
  recordLabor = vi.fn().mockResolvedValue({
    outcome: { outcome: "recorded", laborEntryId: "lab_1", durationMinutes: 90 }, error: null,
  });
});
const mount = () => render(<JobLabor workOrderId="wo1" deps={{ fetchLabor, recordLabor }} />);
const enter = async (h, m) => {
  await screen.findByRole("button", { name: /Add time/i });
  fireEvent.change(screen.getByRole("spinbutton", { name: /Hours/i }), { target: { value: h } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /Minutes/i }), { target: { value: m } });
};

describe("recording time", () => {
  it("asks for the two things the platform does not know, and nothing else", async () => {
    mount();
    await screen.findByRole("button", { name: /Add time/i });
    expect(screen.getByRole("spinbutton", { name: /Hours/i })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: /Minutes/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Type/i })).toBeTruthy();
    // The server knows all of these. A form asking for them is asking for a mistake.
    expect(screen.queryByLabelText(/technician/i)).toBeNull();
    expect(screen.queryByLabelText(/work order/i)).toBeNull();
    expect(screen.queryByLabelText(/date/i)).toBeNull();
  });

  it("shows the total as TIME, never as a cost", async () => {
    mount();
    expect(await screen.findByText(/1h 30m recorded/)).toBeTruthy();
    expect(screen.getByText(/1h on site, 30m travel/)).toBeTruthy();
  });

  it("NO MONEY APPEARS ANYWHERE", async () => {
    // The record carries no rate, cost or billable flag; a screen showing one would have to invent it.
    const { container } = mount();
    await screen.findByRole("button", { name: /Add time/i });
    expect(container.textContent).not.toMatch(/\$|rate|cost|billab|invoice/i);
  });

  it("only ONSITE and TRAVEL are offered", async () => {
    mount();
    const select = await screen.findByRole("combobox", { name: /Type/i });
    expect([...select.options].map((o) => o.value)).toEqual(["ONSITE", "TRAVEL"]);
  });

  it("Add time is dead until there is a time, and says why", async () => {
    mount();
    const button = await screen.findByRole("button", { name: /Add time/i });
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Enter how long you worked/i)).toBeTruthy();
  });

  it("a 26-hour entry is refused with an instruction, not a shrug", async () => {
    mount();
    await enter("26", "0");
    expect(screen.getByRole("button", { name: /Add time/i }).disabled).toBe(true);
    expect(screen.getByText(/Split it into separate entries/i)).toBeTruthy();
  });

  it("sends a DURATION entry, naming no technician", async () => {
    mount();
    await enter("1", "30");
    fireEvent.click(screen.getByRole("button", { name: /Add time/i }));
    await waitFor(() => expect(recordLabor).toHaveBeenCalled());
    const payload = recordLabor.mock.calls[0][0];
    expect(payload.entryKind).toBe("DURATION");
    expect(payload.durationMinutes).toBe(90);
    expect(payload.workOrderId).toBe("wo1");
    expect(payload.technicianId).toBeUndefined();
    expect(payload.startedAtMillis).toBeUndefined();
    expect(payload.idempotencyKey).toBeTruthy();
  });

  it("ONE entry per press, however many times it is pressed", async () => {
    let release;
    recordLabor.mockReturnValue(new Promise((r) => { release = r; }));
    mount();
    await enter("1", "0");
    const button = screen.getByRole("button", { name: /Add time/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(recordLabor).toHaveBeenCalledTimes(1);
    release({ outcome: { outcome: "recorded", laborEntryId: "lab_1" }, error: null });
  });

  it("a refusal is shown in words a technician can act on", async () => {
    recordLabor.mockResolvedValue({ outcome: null, error: { details: "OVERLAPPING_ENTRY", message: "raw" } });
    mount();
    await enter("1", "0");
    fireEvent.click(screen.getByRole("button", { name: /Add time/i }));
    expect(await screen.findByText(/overlaps labor you already recorded/i)).toBeTruthy();
  });

  it("FAILS CLOSED, VISIBLY, when the capability is absent", async () => {
    // Both labor capabilities are inactive everywhere today. That must render as an explained,
    // disabled control -- never a form that accepts input and throws it away.
    fetchLabor.mockResolvedValue({ outcome: { ...READY, canRecord: false }, error: null });
    mount();
    const button = await screen.findByRole("button", { name: /Add time/i });
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/not authorized to record labor/i)).toBeTruthy();
  });

  it("a denied read is a denial, never 'no time recorded'", async () => {
    fetchLabor.mockResolvedValue({ outcome: null, error: { code: "permission-denied", message: "You are not authorized to record labor." } });
    mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/0m recorded/)).toBeNull();
  });

  it("corrected entries are counted separately, not erased", async () => {
    fetchLabor.mockResolvedValue({
      outcome: { ...READY, totals: { ...READY.totals, reversedEntries: 1 } }, error: null,
    });
    mount();
    expect(await screen.findByText(/\(1 corrected\)/)).toBeTruthy();
  });
});
