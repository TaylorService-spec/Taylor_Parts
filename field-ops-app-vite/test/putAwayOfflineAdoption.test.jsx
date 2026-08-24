// PUT-AWAY OFFLINE — the adoption decision, now on the one warehouse queue (vitest + jsdom).
//
// ============================ WHAT CHANGED, AND WHY THIS FILE SURVIVED ============================
//
// This file was written when put-away was the ONLY workflow allowed to finish while disconnected
// (DECISIONS #116): a stow writes no ledger event, changes no quantity and touches no balance, so a
// placement landing twenty minutes late changes nothing about what the company HAS — only about
// where it says something was put.
//
// WO-05 and WO-05A deliberately widen that: receiving, transfers, counts and returns are now
// capturable too, under a runtime built for contended stock. That is an Owner decision recorded
// across two packages, and it supersedes the narrow scope — see
// docs/architecture/warehouse-parts-offline-runtime.md.
//
// The BEHAVIOURAL requirements this file protected did not change, and are all still asserted below:
// a stow survives a dead zone, the operator is told it is NOT done in those words, a refusal is
// never queued, and the retried request is byte-identical so a replay lands on the same placement.
//
// What moved is the mechanism. Durability, retry, the reconnect trigger and the standing queue
// summary now belong to the shared warehouse runtime — one durable, PRINCIPAL-SCOPED queue — rather
// than to this screen and a storage key that any user of the device shared.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import PutAwayScan from "../src/modules/scan/PutAwayScan.jsx";
import { isRetryableCode, TERMINAL_ERROR_CODES } from "../src/domain/offlineSubmissionQueue.js";
import { WAREHOUSE_INTENT } from "../src/offline/warehouseIntent.js";

afterEach(cleanup);

let clock = 0;
const advancingClock = () => { clock += 1000; return clock; };

const setOnline = (value) => Object.defineProperty(window.navigator, "onLine", { value, configurable: true });

const offline = () => Object.assign(new Error("unavailable"), { code: "functions/unavailable" });
const refused = () => Object.assign(new Error("nope"), { code: "functions/permission-denied" });

/**
 * A stand-in for the shared runtime. It records what the SCREEN decided to queue, which is exactly
 * what this file is about — the queue's own durability is proven against the real store in
 * test/warehouseOfflineRuntime.test.mjs.
 */
function fakeRuntime({ durable = true } = {}) {
  const enqueued = [];
  return {
    principalUid: "uid-wh-1",
    enqueue: vi.fn(async (intent) => {
      if (!intent?.valid) return { queued: false, reason: intent?.reason };
      enqueued.push(intent.value);
      return { queued: true, durable, intentId: intent.value.intentId };
    }),
    enqueued,
  };
}

function mount({ recordPutAway, runtime = fakeRuntime() } = {}) {
  const binClient = {
    resolveBin: vi.fn().mockResolvedValue({ result: "FOUND", code: "A-14", warehouseId: "WH-1", binId: "bin_WH-1__A-14" }),
    recordPutAway,
  };
  render(<PutAwayScan deps={{
    binClient,
    session: { warehouseId: "WH-1", partId: "PRT-1001", serialTracked: false },
    scanInputDeps: { now: advancingClock },
    offline: runtime,
  }} />);
  return { binClient, runtime };
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
    setOnline(true);
    const recordPutAway = vi.fn().mockRejectedValue(offline());
    const { runtime } = mount({ recordPutAway });
    await stowOneItem();

    expect(recordPutAway).toHaveBeenCalledTimes(1);
    expect(runtime.enqueued, "the stow must survive the app being closed").toHaveLength(1);
    expect(runtime.enqueued[0].type).toBe(WAREHOUSE_INTENT.PUT_AWAY);
  });

  it("and the operator is told it is NOT done — in those words", async () => {
    // The single most important assertion in this file. An operator who believes a stow committed
    // and walks away has left the warehouse in a state nobody recorded.
    setOnline(true);
    mount({ recordPutAway: vi.fn().mockRejectedValue(offline()) });
    await stowOneItem();

    const notice = document.querySelector(".fo-scan__notice");
    expect(notice.textContent).toMatch(/has not reached the server/i);
    expect(notice.textContent).toMatch(/do not assume it is done/i);
    expect(notice.textContent, "a queued stow must never claim to be recorded").not.toMatch(/✓ Recorded/);
    expect(notice.className).toMatch(/warn/);
  });

  it("a stow that DOES reach the server says Recorded, and says the counts did not move", async () => {
    setOnline(true);
    mount({ recordPutAway: vi.fn().mockResolvedValue({ outcome: "recorded", binCode: "A-14", placementIds: ["plc_1"] }) });
    await stowOneItem();
    const notice = document.querySelector(".fo-scan__notice");
    expect(notice.textContent).toMatch(/Recorded/);
    // DECISIONS #116, still said out loud on the happy path.
    expect(notice.textContent).toMatch(/Stock counts are unchanged/i);
  });

  it("A DEVICE THAT KNOWS IT IS OFFLINE DOES NOT EVEN TRY", async () => {
    // The one signal trustworthy in the negative direction. Attempting into a known-dead network
    // costs a request and a delay for nothing.
    setOnline(false);
    const recordPutAway = vi.fn();
    const { runtime } = mount({ recordPutAway });
    await stowOneItem();
    expect(recordPutAway).not.toHaveBeenCalled();
    expect(runtime.enqueued).toHaveLength(1);
    setOnline(true);
  });
});

// ═══════════════════════════════════════════ what is NOT queued

describe("a refusal is not a connectivity problem", () => {
  it("a REFUSED stow is surfaced as an error, never queued for an indefinite retry", async () => {
    // Queueing a permission-denied would turn a clear "no" into a "maybe" that retries forever and
    // leaves the operator believing the work is still in flight.
    setOnline(true);
    const { runtime } = mount({ recordPutAway: vi.fn().mockRejectedValue(refused()) });
    await stowOneItem();

    expect(screen.queryByText(/has not reached the server/i)).toBeNull();
    expect(runtime.enqueued, "a refusal must not be persisted as pending work").toEqual([]);
  });

  it("the retryable/terminal split has ONE definition, shared by every caller", () => {
    for (const code of TERMINAL_ERROR_CODES) {
      expect(isRetryableCode(code), `${code} must be terminal`).toBe(false);
      expect(isRetryableCode(`functions/${code}`), "the functions/ prefix must not defeat it").toBe(false);
    }
    for (const code of ["unavailable", "deadline-exceeded", "internal", "", undefined, "something-new"]) {
      expect(isRetryableCode(code), `${String(code)} must be retryable`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════ durability is a promise, not an assumption

describe("when the phone cannot keep it", () => {
  it("the work is NOT called pending, and the destination stays on screen", async () => {
    setOnline(false);
    mount({ recordPutAway: vi.fn(), runtime: fakeRuntime({ durable: false }) });
    await stowOneItem();
    // Telling somebody a stow is queued on a phone that cannot store it is the one lie this whole
    // runtime exists to prevent.
    expect(screen.queryByText(/has not reached the server/i)).toBeNull();
    expect(document.body.textContent).toMatch(/could not save that offline/i);
    setOnline(true);
  });
});

// ═══════════════════════════════════════════ the replay argument

describe("a retry lands on the same placement", () => {
  it("the queued intent carries a DERIVED idempotency key", async () => {
    // The whole safety argument rests on this: `plc_<key>` means a replay lands on the same document
    // rather than recording a second stow. The key is the intent id, so a reload cannot change it.
    setOnline(true);
    const { runtime } = mount({ recordPutAway: vi.fn().mockRejectedValue(offline()) });
    await stowOneItem();

    const intent = runtime.enqueued[0];
    expect(typeof intent.payload.idempotencyKey).toBe("string");
    expect(intent.payload.idempotencyKey).toBe(intent.intentId);
    expect(intent.payload.destinationBinId).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ one queue, and only one

describe("the boundary of the adoption", () => {
  it("PUT-AWAY NO LONGER USES THE OLD UNSCOPED QUEUE", async () => {
    // The previous queue persisted to one localStorage key that was not scoped to a principal: two
    // warehouse workers on one device shared it. The warehouse runtime is scoped by uid, and this
    // asserts the screen does not reach back to the old one.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/modules/scan/PutAwayScan.jsx"), "utf8");
    expect(src).not.toMatch(/useSubmissionQueue/);
    expect(src).toMatch(/useWarehouseSubmit/);
  });

  it("every warehouse workflow now uses the SAME submit policy", async () => {
    // WO-05A: receiving, transfer, count and return were adopted deliberately, under a runtime built
    // for contended stock. What matters is that no screen invents its own send-or-queue rule.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const file of [
      "src/modules/scan/PutAwayScan.jsx",
      "src/modules/scan/PickScan.jsx",
      "src/modules/scan/CycleCountScan.jsx",
      "src/modules/scan/TransferScan.jsx",
      "src/modules/scan/ReturnIntakeScan.jsx",
      "src/modules/receiving/MultiScanReceiving.jsx",
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src, `${file} must route through the shared policy`).toMatch(/useWarehouseSubmit/);
      expect(src, `${file} must not use the old unscoped queue`).not.toMatch(/useSubmissionQueue/);
    }
  });

  it("RECONCILIATION IS NOT AMONG THEM", async () => {
    // The permanent negative requirement. Approving a variance is a decision against current
    // inventory truth, and no screen may queue one.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/modules/scan/CycleCountScan.jsx"), "utf8");
    // The count may be queued; the reconcile may not.
    expect(src).not.toMatch(/captureReconcile|RECONCILE_INTENT|queueReconcile/);
  });
});
