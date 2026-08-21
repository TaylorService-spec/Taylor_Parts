// PUT-AWAY OFFLINE — the first adoption of the submission queue (vitest + jsdom).
//
// ============================ WHY PUT-AWAY, AND ONLY PUT-AWAY ============================
//
// The queue's mechanics are proved pure in test/offlineSubmissionQueue.test.mjs and its hook in
// test/submissionQueue.test.jsx. This file covers the ADOPTION decision itself, which is a business
// judgement rather than a mechanism: which workflow may be allowed to finish while disconnected.
//
// Put-away, because DECISIONS #116 — a stow writes no ledger event, changes no quantity, touches no
// balance. A placement that lands twenty minutes late changes NOTHING about what the company has,
// only about where it says something was put. There is no window in which the queue can make
// inventory wrong, because the queue is not carrying inventory.
//
// The tests below assert the two halves of that judgement: that a stow CAN be finished offline, and
// that what the operator is told while it sits on the phone is the truth.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import PutAwayScan from "../src/modules/scan/PutAwayScan.jsx";
import { SUBMISSION_STATE, isRetryableCode, TERMINAL_ERROR_CODES } from "../src/domain/offlineSubmissionQueue.js";

afterEach(cleanup);

let clock = 0;
const advancingClock = () => { clock += 1000; return clock; };

/** An isolated store per test — a queue that leaked between tests would prove nothing. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    __map: map,
  };
}

/** Whatever the queue has actually persisted. The storage KEY always exists once the hook writes;
 * what matters is what is in it. */
const queued = (storage) => {
  const raw = [...storage.__map.values()][0];
  return raw ? JSON.parse(raw) : [];
};

const offline = () => Object.assign(new Error("unavailable"), { code: "functions/unavailable" });
const refused = () => Object.assign(new Error("nope"), { code: "functions/permission-denied" });

function mount({ recordPutAway, storage = memoryStorage() } = {}) {
  const binClient = {
    resolveBin: vi.fn().mockResolvedValue({ result: "FOUND", code: "A-14", warehouseId: "WH-1", binId: "bin_WH-1__A-14" }),
    recordPutAway,
  };
  render(<PutAwayScan deps={{
    binClient,
    session: { warehouseId: "WH-1", partId: "PRT-1001", serialTracked: false },
    scanInputDeps: { now: advancingClock },
    queueDeps: { storage, now: advancingClock },
  }} />);
  return { binClient, storage };
}


async function stowOneItem() {
  fireEvent.change(screen.getByLabelText(/scan bin/i), { target: { value: "A-14" } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await waitFor(() => expect(screen.queryByLabelText(/scan item/i)).toBeTruthy());
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/scan item/i), { target: { value: "PRT-1001" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /put it away|confirm|record/i }));
  });
}

// ═══════════════════════════════════════════ the adoption itself

describe("finishing a stow while disconnected", () => {
  it("a stow that cannot reach the server is KEPT, not lost", async () => {
    // The scenario the module was written for: the steel rack the operator is stowing into is the
    // thing between their phone and the access point.
    const recordPutAway = vi.fn().mockRejectedValue(offline());
    const { storage } = mount({ recordPutAway });
    await stowOneItem();

    expect(recordPutAway).toHaveBeenCalledTimes(1);
    expect(queued(storage), "the stow must survive the app being closed").toHaveLength(1);
  });

  it("and the operator is told it is NOT done — in those words", async () => {
    // The single most important assertion in this file. An operator who believes a stow committed
    // and walks away has left the warehouse in a state nobody recorded.
    mount({ recordPutAway: vi.fn().mockRejectedValue(offline()) });
    await stowOneItem();

    // Two things carry role="status" here — the stow outcome and the standing queue summary — so
    // the outcome notice is addressed by its own class rather than by role alone.
    const notice = document.querySelector(".fo-scan__notice");
    expect(notice.textContent).toMatch(/has not reached the server/i);
    expect(notice.textContent).toMatch(/do not assume it is done/i);
    expect(notice.textContent, "a queued stow must never claim to be recorded").not.toMatch(/✓ Recorded/);
    // And it is styled as an unfinished thing, not as a success in a different colour.
    expect(notice.className).toMatch(/warn/);
  });

  it("a stow that DOES reach the server says Recorded, and says the counts did not move", async () => {
    mount({ recordPutAway: vi.fn().mockResolvedValue({ outcome: "recorded", binCode: "A-14", placementIds: ["plc_1"] }) });
    await stowOneItem();
    const notice = document.querySelector(".fo-scan__notice");
    expect(notice.textContent).toMatch(/Recorded/);
    // DECISIONS #116, still said out loud on the happy path.
    expect(notice.textContent).toMatch(/Stock counts are unchanged/i);
  });
});

// ═══════════════════════════════════════════ what is NOT queued

describe("a refusal is not a connectivity problem", () => {
  it("a REFUSED stow is surfaced as an error, never queued for an indefinite retry", async () => {
    // Queueing a permission-denied would turn a clear "no" into a "maybe" that retries forever and
    // leaves the operator believing the work is still in flight.
    const recordPutAway = vi.fn().mockRejectedValue(refused());
    const { storage } = mount({ recordPutAway });
    await stowOneItem();

    expect(screen.queryByText(/has not reached the server/i)).toBeNull();
    expect(queued(storage), "a refusal must not be persisted as pending work").toEqual([]);
  });

  it("the retryable/terminal split has ONE definition, shared by the queue and its callers", () => {
    for (const code of TERMINAL_ERROR_CODES) {
      expect(isRetryableCode(code), `${code} must be terminal`).toBe(false);
      expect(isRetryableCode(`functions/${code}`), "the functions/ prefix must not defeat it").toBe(false);
    }
    for (const code of ["unavailable", "deadline-exceeded", "internal", "", undefined, "something-new"]) {
      // Unrecognized is retryable: retrying a transient failure costs one request, giving up on one
      // loses the operator's work.
      expect(isRetryableCode(code), `${String(code)} must be retryable`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════ the standing statement of outstanding work

describe("outstanding work stays visible", () => {
  it("the queue status is on screen while anything is unconfirmed", async () => {
    mount({ recordPutAway: vi.fn().mockRejectedValue(offline()) });
    await stowOneItem();
    expect(screen.getByLabelText(/work not yet confirmed/i)).toBeTruthy();
  });

  it("coming back into range flushes without the operator asking", async () => {
    // Not a poll: a timer retrying into a dead zone every few seconds drains a handheld for nothing.
    const recordPutAway = vi.fn()
      .mockRejectedValueOnce(offline())
      .mockResolvedValue({ outcome: "recorded", binCode: "A-14", placementIds: ["plc_1"] });
    mount({ recordPutAway });
    await stowOneItem();
    expect(recordPutAway).toHaveBeenCalledTimes(1);

    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(recordPutAway).toHaveBeenCalledTimes(2));
  });

  it("the retried request is BYTE-IDENTICAL, idempotency key included", async () => {
    // The whole safety argument rests on this: `plc_<key>` means a replay lands on the same document
    // rather than recording a second stow. A retry that regenerated the key would stow twice.
    const recordPutAway = vi.fn()
      .mockRejectedValueOnce(offline())
      .mockResolvedValue({ outcome: "recorded", binCode: "A-14", placementIds: ["plc_1"] });
    mount({ recordPutAway });
    await stowOneItem();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(recordPutAway).toHaveBeenCalledTimes(2));

    const [first] = recordPutAway.mock.calls[0];
    const [second] = recordPutAway.mock.calls[1];
    expect(second).toEqual(first);
    expect(typeof first.idempotencyKey).toBe("string");
    expect(first.idempotencyKey).not.toBe("");
  });
});

// ═══════════════════════════════════════════ the boundary of the adoption

describe("nothing else was adopted", () => {
  it("only recordPutAway may travel through this queue", async () => {
    // The queue is deliberately ignorant of payloads, so the guard against a custody-moving command
    // being queued has to live at the adoption site. This is that guard.
    const { storage } = mount({ recordPutAway: vi.fn().mockRejectedValue(offline()) });
    await stowOneItem();
    const stored = queued(storage);
    expect(stored.map((s) => s.callable)).toEqual(["recordPutAway"]);
    expect(stored.every((s) => s.state === SUBMISSION_STATE.FAILED || s.state === SUBMISSION_STATE.PENDING)).toBe(true);
  });

  it("the workflows that move CUSTODY are untouched — asserted on their source", async () => {
    // Receiving, transfer and cycle count move stock or depend on a live ledger read. A queue entry
    // for any of them is stock the company is wrong about, or an observation against an expectation
    // nobody could compute. If one is ever adopted it must be a deliberate decision, and this is
    // where that decision becomes visible.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const file of [
      "src/modules/scan/CycleCountScan.jsx",
      "src/modules/scan/TransferScan.jsx",
      "src/modules/receiving/MultiScanReceiving.jsx",
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src, `${file} must not adopt the offline queue without a recorded decision`)
        .not.toMatch(/useSubmissionQueue/);
    }
  });
});
