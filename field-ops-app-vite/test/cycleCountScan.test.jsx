// CYCLE COUNT BY SCAN — the mounted surface (vitest + jsdom).
//
// The session rules are proved pure in test/cycleCountScanSession.test.mjs. These cover what only
// the screen can show: that no expected figure ever appears while counting, that submitting is not
// adjusting, and that a refusal renders as a refusal.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import CycleCountScan from "../src/modules/scan/CycleCountScan.jsx";

afterEach(cleanup);

// Tests fire identical scans within the same millisecond, which no real scanner can do. The shared
// input suppresses that as a wedge stutter, so every test drives an advancing clock through the
// documented seam — otherwise these would be measuring the anti-stutter guard, not the workflow.
let clock = 0;
const advancingClock = () => { clock += 1000; return clock; };
const scanInputDeps = { now: advancingClock };


const client = (over = {}) => ({
  createCycleCount: vi.fn().mockResolvedValue({ cycleCountId: "CC-1", status: "COUNTING", trackingMode: "NONE" }),
  submitCycleCount: vi.fn().mockResolvedValue({ outcome: "submitted", cycleCountId: "CC-1", status: "SUBMITTED", countedQuantity: 2, variance: -1 }),
  reconcileCycleCount: vi.fn(),
  cancelCycleCount: vi.fn(),
  ...over,
});

async function startCount(c = client(), { trackingMode = "NONE" } = {}) {
  render(<CycleCountScan deps={{ cycleCountClient: c, scanInputDeps }} />);
  fireEvent.change(screen.getByLabelText(/part to count/i), { target: { value: "PRT-1001" } });
  fireEvent.change(screen.getByLabelText(/^location$/i), { target: { value: "WH-1" } });
  if (trackingMode !== "NONE") {
    fireEvent.change(screen.getByLabelText(/tracking mode/i), { target: { value: trackingMode } });
  }
  fireEvent.click(screen.getByRole("button", { name: /start counting/i }));
  await screen.findByLabelText(/scan item/i);
  return c;
}

const scan = (value) => {
  fireEvent.change(screen.getByLabelText(/scan item/i), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
};

// ────────────────────────────────────────────── the count is blind

describe("Cycle count scan (blind, by design)", () => {
  it("shows NO expected figure anywhere while counting", async () => {
    // DECISIONS #111. A helpful "expected: 12" would tell a counter when to stop looking.
    await startCount(client({
      // Even if the create response carried one, the screen must not render it.
      createCycleCount: vi.fn().mockResolvedValue({ cycleCountId: "CC-1", status: "COUNTING", trackingMode: "NONE", expectedQuantity: 12 }),
    }));
    scan("PRT-1001");
    // The VALUE must not appear. The word "expected" does appear — in the sentence explaining why
    // the count is blind — and banning the word would ban the explanation, so this checks the
    // rendered text for the figure and for any variance wording instead.
    const body = document.body.textContent;
    expect(body).not.toMatch(/12/);
    expect(body).not.toMatch(/expected[:\s]+\d/i);
    expect(body).not.toMatch(/variance/i);
    expect(body).not.toMatch(/(over|short) by/i);
  });

  it("says WHY it is blind, rather than looking like missing information", async () => {
    await startCount();
    expect(screen.getByText(/will not be shown what was expected until after you submit/i)).toBeTruthy();
  });

  it("the only number while counting is what has been scanned", async () => {
    await startCount();
    scan("PRT-1001");
    scan("PRT-1001");
    expect(screen.getByText(/2 scanned/)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── counting is not adjusting

describe("Cycle count scan (observation is not adjustment)", () => {
  it("offers NO reconcile or approve control", async () => {
    const c = await startCount();
    scan("PRT-1001");
    for (const forbidden of [/reconcile/i, /approve/i, /adjust/i, /accept/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: /submit this count/i }));
    await waitFor(() => expect(c.submitCycleCount).toHaveBeenCalled());
    expect(c.reconcileCycleCount).not.toHaveBeenCalled();
  });

  it("says on success that nothing was adjusted and a manager reviews separately", async () => {
    await startCount();
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /submit this count/i }));
    const ok = await screen.findByText(/nothing has been adjusted/i);
    expect(ok.textContent).toMatch(/manager reviews/i);
  });

  it("submits ONLY the counted figure — no decision, no reason", async () => {
    const c = await startCount();
    scan("PRT-1001");
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /submit this count/i }));
    await waitFor(() => expect(c.submitCycleCount).toHaveBeenCalled());
    expect(c.submitCycleCount).toHaveBeenCalledWith({ cycleCountId: "CC-1", countedQuantity: 2 });
  });
});

// ────────────────────────────────────────────── counting

describe("Cycle count scan (what is on the shelf)", () => {
  it("creates the count with the part and location, and nothing else", async () => {
    const c = await startCount();
    expect(c.createCycleCount).toHaveBeenCalledTimes(1);
    const payload = c.createCycleCount.mock.calls[0][0];
    expect(payload.partId).toBe("PRT-1001");
    expect(payload.location).toEqual({ type: "WAREHOUSE", locationId: "WH-1" });
    expect(payload.idempotencyKey).toBeTruthy();
    expect(payload.expectedQuantity).toBeUndefined();
  });

  it("an EMPTY shelf is submittable — that is the finding", async () => {
    const c = await startCount();
    expect(screen.getByRole("button", { name: /submit this count/i }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /submit this count/i }));
    await waitFor(() => expect(c.submitCycleCount).toHaveBeenCalledWith({ cycleCountId: "CC-1", countedQuantity: 0 }));
  });

  it("a DIFFERENT part is refused and blocks submission", async () => {
    await startCount();
    scan("PRT-1001");
    scan("PRT-9999");
    expect(screen.getAllByText(/different part.*count it separately/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /submit this count/i }).disabled).toBe(true);
  });

  it("a mis-scan can be undone", async () => {
    await startCount();
    scan("PRT-9999");
    expect(screen.getByRole("button", { name: /submit this count/i }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /undo last scan/i }));
    expect(screen.getByRole("button", { name: /submit this count/i }).disabled).toBe(false);
  });

  it("a serialized count submits the LIST of serials, not a number", async () => {
    const c = await startCount(
      client({ createCycleCount: vi.fn().mockResolvedValue({ cycleCountId: "CC-1", status: "COUNTING", trackingMode: "SERIAL" }) }),
      { trackingMode: "SERIAL" },
    );
    scan("SN-1");
    scan("SN-2");
    fireEvent.click(screen.getByRole("button", { name: /submit this count/i }));
    await waitFor(() => expect(c.submitCycleCount).toHaveBeenCalled());
    expect(c.submitCycleCount).toHaveBeenCalledWith({ cycleCountId: "CC-1", countedSerialNumbers: ["SN-1", "SN-2"] });
  });

  it("a serialized result keeps MISSING and UNEXPECTED separate", async () => {
    // Netting them to one number would hide that two different units are involved.
    await startCount(
      client({
        createCycleCount: vi.fn().mockResolvedValue({ cycleCountId: "CC-1", status: "COUNTING", trackingMode: "SERIAL" }),
        submitCycleCount: vi.fn().mockResolvedValue({
          status: "SUBMITTED", serialVariance: { missing: ["SN-9"], unexpected: ["SN-5"] },
        }),
      }),
      { trackingMode: "SERIAL" },
    );
    scan("SN-5");
    fireEvent.click(screen.getByRole("button", { name: /submit this count/i }));
    const ok = (await screen.findByText(/expected but not found/i)).closest("section");
    expect(ok.textContent).toMatch(/expected but not found.*SN-9/i);
    expect(ok.textContent).toMatch(/found but not expected.*SN-5/i);
  });
});

// ────────────────────────────────────────────── refusals

describe("Cycle count scan (refusals are told truthfully)", () => {
  it("a DENIED create says so, and does not look like a failed count", async () => {
    // Every inventory.cycleCount.* capability is inert today.
    const err = Object.assign(new Error("denied"), { code: "functions/permission-denied" });
    render(<CycleCountScan deps={{ cycleCountClient: client({ createCycleCount: vi.fn().mockRejectedValue(err) }), scanInputDeps }} />);
    fireEvent.change(screen.getByLabelText(/part to count/i), { target: { value: "PRT-1001" } });
    fireEvent.change(screen.getByLabelText(/^location$/i), { target: { value: "WH-1" } });
    fireEvent.click(screen.getByRole("button", { name: /start counting/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not authorized to count stock/i);
    expect(alert.textContent).toMatch(/not been granted or switched on/i);
  });

  it("a DENIED submit leaves the count unrecorded and says nothing was recorded", async () => {
    const err = Object.assign(new Error("boom"), { code: "functions/internal" });
    await startCount(client({ submitCycleCount: vi.fn().mockRejectedValue(err) }));
    scan("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /submit this count/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/nothing was recorded/i);
  });

  it("a missing part or location is caught before any call is made", async () => {
    const c = client();
    render(<CycleCountScan deps={{ cycleCountClient: c, scanInputDeps }} />);
    fireEvent.click(screen.getByRole("button", { name: /start counting/i }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(c.createCycleCount).not.toHaveBeenCalled();
  });
});
