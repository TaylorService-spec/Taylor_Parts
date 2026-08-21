// PUT-AWAY BY SCAN — the mounted surface (vitest + jsdom).
//
// The stow rules are proved pure in test/putAwaySession.test.mjs. These cover what only the screen
// can show: that the bin is validated by the server before anything can go in it, that a stow says
// out loud it changed no counts, and that each bin refusal reaches the operator in its own words.
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
  recordPutAway: vi.fn().mockResolvedValue({ outcome: "recorded", binCode: "A-14", partId: "PRT-1001", placementIds: ["plc_1"] }),
  ...over,
});

const mount = (binClient = client(), s = session()) => {
  render(<PutAwayScan deps={{ binClient, session: s, scanInputDeps }} />);
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
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalled());
    expect(c.recordPutAway).toHaveBeenCalledWith(expect.objectContaining({
      warehouseId: "WH-1", binCode: "A-14", partId: "PRT-1001", quantity: 2,
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
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalled());
    const payload = c.recordPutAway.mock.calls[0][0];
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

describe("Put-away (it records where, not what)", () => {
  it("says on success that stock counts are UNCHANGED", async () => {
    // An operator could reasonably assume a stow moved something. DECISIONS #116 says it did not,
    // and the screen has to say so rather than leave them to assume.
    mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    // Scoped past the shared input's own aria-live announcement to the outcome notice.
    const ok = await screen.findByText(/stock counts are unchanged/i);
    expect(ok.textContent).toMatch(/where it is, not what there is/i);
  });

  it("a NEW stow gets a NEW idempotency key, so it records rather than replaying", async () => {
    const c = mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await screen.findByRole("status");
    const firstKey = c.recordPutAway.mock.calls[0][0].idempotencyKey;

    fireEvent.click(screen.getByRole("button", { name: /stow something else/i }));
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalledTimes(2));
    expect(c.recordPutAway.mock.calls[1][0].idempotencyKey).not.toBe(firstKey);
  });

  it("the SAME stow reuses its key, so a retry replays rather than doubling", async () => {
    const c = mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    const confirm = screen.getByRole("button", { name: /confirm put-away/i });
    fireEvent.click(confirm);
    await screen.findByRole("status");
    expect(c.recordPutAway.mock.calls[0][0].idempotencyKey).toBeTruthy();
  });
});

// ────────────────────────────────────────────── refusals

describe("Put-away (refusals are told truthfully)", () => {
  it("a DENIED placement says so, and does not look like a failed scan", async () => {
    const err = Object.assign(new Error("denied"), { code: "functions/permission-denied" });
    mount(client({ recordPutAway: vi.fn().mockRejectedValue(err) }));
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not authorized to put stock away/i);
    expect(alert.textContent).toMatch(/not been granted or switched on/i);
  });

  it("a bin that went bad between scanning and confirming keeps the bin's own words", async () => {
    const err = Object.assign(new Error("bad bin"), { code: "functions/failed-precondition", details: "INACTIVE" });
    mount(client({ recordPutAway: vi.fn().mockRejectedValue(err) }));
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
    mount(client({ recordPutAway: vi.fn().mockRejectedValue(err) }));
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

  it("without a starting part it explains what it needs rather than showing an empty form", () => {
    render(<PutAwayScan deps={{ binClient: client(), session: null, scanInputDeps }} />);
    expect(screen.getByText(/starts from a part you have just received/i)).toBeTruthy();
    expect(screen.queryByLabelText(/scan bin/i)).toBeNull();
  });
});

// ────────────────────────────────────────────── exception notes (Phase N)

describe("Put-away (an exception note, typed or dictated)", () => {
  it("offers a note only once there is something to stow into", async () => {
    // A note field above the scan input would make every routine stow look like it wanted a comment.
    mount();
    expect(screen.queryByLabelText(/note/i)).toBeNull();
    await scanBin();
    expect(screen.getByLabelText(/note \(optional\)/i)).toBeTruthy();
  });

  it("sends the note with the stow when there is one", async () => {
    const c = mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.change(screen.getByLabelText(/note \(optional\)/i), { target: { value: "  Box was crushed.  " } });
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalled());
    expect(c.recordPutAway.mock.calls[0][0].note).toBe("Box was crushed.");
  });

  it("sends NO note when there is nothing to say", async () => {
    const c = mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    fireEvent.change(screen.getByLabelText(/note \(optional\)/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalled());
    expect(c.recordPutAway.mock.calls[0][0].note).toBeUndefined();
  });

  it("a note never blocks the stow — it is optional in both directions", async () => {
    const c = mount();
    await scanBin();
    scanInto(/scan item/i, "PRT-1001");
    expect(screen.getByRole("button", { name: /confirm put-away/i }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /confirm put-away/i }));
    await waitFor(() => expect(c.recordPutAway).toHaveBeenCalled());
  });
});
