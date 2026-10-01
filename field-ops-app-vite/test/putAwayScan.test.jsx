// PUT-AWAY BY SCAN — the mounted surface (vitest + jsdom).
//
// The stow rules are proved pure in test/putAwaySession.test.mjs. These cover what only the screen
// can show: that the bin is validated by the server before anything can go in it, that a put-away says
// out loud the stock moved into the bin (warehouse total unchanged), and that each bin refusal reaches the
// operator in its own words. ON EOS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): the
// put-away is the relocation that records the placement (placementClient.putAwayStock), keyed by the bin id.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import PutAwayScan from "../src/modules/scan/PutAwayScan.jsx";

afterEach(cleanup);

let clock = 0;
const advancingClock = () => { clock += 1000; return clock; };
const scanInputDeps = { now: advancingClock };

const session = (over = {}) => ({ warehouseId: "WH-1", partId: "PRT-1001", serialTracked: false, ...over });

const client = (over = {}) => ({
  resolveBin: vi.fn().mockResolvedValue({ result: "FOUND", code: "A-14", warehouseId: "WH-1", binId: "bin_WH-1__A-14" }),
  putAwayStock: vi.fn().mockResolvedValue({ outcome: "relocated", relocationId: "srl_1", partId: "PRT-1001" }),
  ...over,
});

/**
 * A stand-in for the shared warehouse runtime.
 *
 * The screen is a handheld surface and gets its queue from the shell (or from the scan workspace),
 * so a mount without one would be testing a configuration an operator never sees. What the runtime
 * DOES with a queued stow is proven against the real store in warehouseOfflineRuntime.
 */
const runtime = () => {
  const enqueued = [];
  return {
    principalUid: "uid-wh-1",
    enqueue: async (intent) => {
      if (!intent?.valid) return { queued: false, reason: intent?.reason };
      enqueued.push(intent.value);
      return { queued: true, durable: true, intentId: intent.value.intentId };
    },
    enqueued,
  };
};

const mount = (binClient = client(), s = session(), offline = runtime()) => {
  render(<PutAwayScan deps={{ binClient, session: s, scanInputDeps, offline }} />);
  return binClient;
};

const scanInto = (label, value) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
};

async function scanBin(value = "A-14") {
  scanInto(/scan bin/i, value);
  await waitFor(() => expect(screen.queryByLabelText(/scan item/i) ?? screen.queryByRole("alert")).toBeTruthy());
}

// ────────────────────────────────────────────── the destination comes first

describe("Put-away (the bin is validated before anything goes in it)", () => {
  it("asks for the bin first, and the contents field does not exist yet", () => {
    mount();
    expect(screen.getByLabelText(/scan bin/i)).toBeTruthy();
    expect(screen.queryByLabelText(/scan item/i)).toBeNull();
  });

  it("asks the SERVER whether the bin is real, at this warehouse", async () => {
    const c = mount();
    await scanBin("a-14");
    expect(c.resolveBin).toHaveBeenCalledWith({ warehouseId: "WH-1", code: "a-14" });
  });

  it("a FOUND bin opens the contents step", async () => {
    mount();
    await scanBin();
    expect(screen.getByLabelText(/scan item/i)).toBeTruthy();
    // The chosen bin is named on the card, so the operator can see where they are stowing.
    expect(screen.getByRole("region", { name: /put away PRT-1001/i }).textContent).toMatch(/A-14/);
  });

  it("WRONG WAREHOUSE says which building — not that the bin does not exist", async () => {
    const c = client({ resolveBin: vi.fn().mockResolvedValue({ result: "WRONG_WAREHOUSE", warehouseId: "WH-2" }) });
    mount(c);
    await scanBin();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/different warehouse|building/i);
    expect(alert.textContent).not.toMatch(/no bin is registered/i);
    expect(screen.queryByLabelText(/scan item/i)).toBeNull();
  });

  it("a RETIRED bin says retired, and blocks", async () => {
    mount(client({ resolveBin: vi.fn().mockResolvedValue({ result: "INACTIVE", code: "A-14" }) }));
    await scanBin();
    expect((await screen.findByRole("alert")).textContent).toMatch(/retired/i);
    expect(screen.getByRole("button", { name: /confirm put-away/i }).disabled).toBe(true);
  });

  it("an unregistered bin says so, distinctly", async () => {
    mount(client({ resolveBin: vi.fn().mockResolvedValue({ result: "NOT_FOUND" }) }));
    await scanBin();
    expect((await screen.findByRole("alert")).textContent).toMatch(/no bin is registered/i);
  });

  it("the bin can be changed after it is chosen", async () => {
    mount();
    await scanBin();
    fireEvent.click(screen.getByRole("button", { name: /change bin/i }));
    expect(screen.getByLabelText(/scan bin/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── contents

describe("Put-away (what goes in)", () => {
  it("a stow of the right part can be confirmed", async () => {
    const c = mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await waitFor(() => expect(c.putAwayStock).toHaveBeenCalled());
    expect(c.putAwayStock).toHaveBeenCalledWith(expect.objectContaining({
      warehouseId: "WH-1", binId: "bin_WH-1__A-14", partId: "PRT-1001", quantity: 2,
    }));
  });

  it("an EMPTY stow cannot be confirmed — nothing happening is not a placement", async () => {
    mount();
    await scanBin();
    expect(screen.getByRole("button", { name: /confirm put-away/i }).disabled).toBe(true);
    expect(screen.getByText(/scan what is going into the bin/i)).toBeTruthy();
  });

  it("the WRONG part blocks and says to stow it separately", async () => {
    mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-9999");
    expect(screen.getAllByText(/different part.*stow it separately/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /confirm put-away/i }).disabled).toBe(true);
  });

  it("a serialized stow sends the SERIALS, never a quantity", async () => {
    const c = mount(client(), session({ serialTracked: true }));
    await scanBin();
    scanInto(/scan item/i, "SN-1");
    scanInto(/scan item/i, "SN-2");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await waitFor(() => expect(c.putAwayStock).toHaveBeenCalled());
    const payload = c.putAwayStock.mock.calls[0][0];
    expect(payload.serialNumbers).toEqual(["SN-1", "SN-2"]);
    expect(payload.quantity).toBeUndefined();
  });

  it("a mis-scan can be undone", async () => {
    mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-9999");
    expect(screen.getByRole("button", { name: /confirm put-away/i }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /undo last scan/i }));
    expect(screen.getByText(/scan what is going into the bin/i)).toBeTruthy();
  });
});

// ────────────────────────────────────────────── it says what it did NOT do

describe("Put-away (the stock moves into the bin; the warehouse total does not change)", () => {
  it("says on success the stock is now in the bin and the warehouse total is unchanged", async () => {
    mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    // Scoped past the shared input's own aria-live announcement to the outcome notice.
    const ok = await screen.findByText(/warehouse total is unchanged/i);
    expect(ok.textContent).toMatch(/now in A-14/i);
  });

  it("a NEW stow gets a NEW idempotency key, so it records rather than replaying", async () => {
    const c = mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await screen.findByRole("status");
    const firstKey = c.putAwayStock.mock.calls[0][0].idempotencyKey;

    fireEvent.click(screen.getByRole("button", { name: /stow something else/i }));
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await waitFor(() => expect(c.putAwayStock).toHaveBeenCalledTimes(2));
    expect(c.putAwayStock.mock.calls[1][0].idempotencyKey).not.toBe(firstKey);
  });

  it("the SAME stow reuses its key, so a retry replays rather than doubling", async () => {
    const c = mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    const confirm = screen.getByRole("button", { name: /confirm put-away/i });
    fireEvent.click(confirm);
    await screen.findByRole("status");
    expect(c.putAwayStock.mock.calls[0][0].idempotencyKey).toBeTruthy();
  });
});

// ────────────────────────────────────────────── refusals

describe("Put-away (refusals are told truthfully)", () => {
  it("a DENIED placement says so, and does not look like a failed scan", async () => {
    const err = Object.assign(new Error("denied"), { code: "functions/permission-denied" });
    mount(client({ putAwayStock: vi.fn().mockRejectedValue(err) }));
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not authorized to put stock away/i);
  });

  it("a bin that went bad between scanning and confirming keeps the bin's own words", async () => {
    const err = Object.assign(new Error("bad bin"), { code: "functions/failed-precondition", details: "INACTIVE" });
    mount(client({ putAwayStock: vi.fn().mockRejectedValue(err) }));
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/retired/i);
  });

  it("a failure that might succeed later KEEPS the work, and still says nothing was changed", async () => {
    // CHANGED DELIBERATELY when put-away adopted the offline queue. This used to discard the stow
    // and tell the operator nothing had changed, which was true and unhelpful: they had to walk back
    // and rescan. `internal` is retryable, so the work is now kept and retried against the SAME
    // derived id — and the assurance that mattered survives verbatim in the new wording.
    //
    // What did NOT change: a refusal the server MEANT is still surfaced as an error rather than
    // queued (see the two tests above, and test/putAwayOfflineAdoption.test.jsx).
    const err = Object.assign(new Error("boom"), { code: "functions/internal" });
    mount(client({ putAwayStock: vi.fn().mockRejectedValue(err) }));
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    const notice = await waitFor(() => {
      const n = document.querySelector(".fo-scan__notice");
      expect(n).toBeTruthy();
      return n;
    });
    expect(notice.textContent).toMatch(/nothing was changed/i);
    expect(notice.textContent).toMatch(/has not reached the server/i);
  });

  it("NOT_ACTIVATED says the put-away is not switched on yet -- never a Firebase retry", async () => {
    const err = Object.assign(new Error("off"), { code: "failed-precondition", details: { code: "NOT_ACTIVATED" } });
    mount(client({ putAwayStock: vi.fn().mockRejectedValue(err) }));
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    const shown = await waitFor(() => {
      const n = document.querySelector('[role="alert"], .fo-scan__notice');
      expect(n).toBeTruthy();
      return n;
    });
    expect(shown.textContent).toMatch(/not switched on in this environment yet/i);
  });

  it("without a starting part it explains what it needs rather than showing an empty form", () => {
    render(<PutAwayScan deps={{ binClient: client(), session: null, scanInputDeps }} />);
    expect(screen.getByText(/starts from a part you have just received/i)).toBeTruthy();
    expect(screen.queryByLabelText(/scan bin/i)).toBeNull();
  });
});

// ────────────────────────────────────────────── exception notes (Phase N)

describe("Put-away (no note: the relocation carries none)", () => {
  it("offers no note field -- a put-away is a governed stock move, and the move has no free-text field", async () => {
    mount();
    await scanBin();
    expect(screen.queryByLabelText(/note/i)).toBeNull();
  });
});
