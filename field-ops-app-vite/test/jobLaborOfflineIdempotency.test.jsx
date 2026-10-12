// WOL-2 (docs/audits/firebase-retirement-equivalence-2026-10-11): a technician's hours must be recorded ONCE per
// press -- not twice when an answer is lost, and not once when two genuine entries look alike.
//
// The screen runs with the REAL offline machinery: submitOrQueue, captureLabor and the queue's own enqueueIntent.
// Only the server is a stand-in, and it keeps the one rule that matters here exactly as functions/src/eosOps/
// workOrderLabor.ts does (proven in functions/test/workOrderLaborPostgres.test.mjs "IDEMPOTENT: the same key and
// request replays"): the same idempotency key is a REPLAY, never a second entry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import JobLabor from "../src/modules/mobile/JobLabor.jsx";
import { enqueueIntent } from "../src/offline/intentQueue.js";

const READY = {
  status: "ready", workOrderId: "wo1", entries: [], canRecord: true, canCorrect: false,
  totals: { totalMinutes: 0, onsiteMinutes: 0, travelMinutes: 0, activeEntries: 0, reversedEntries: 0 },
  laborTypes: ["ONSITE", "TRAVEL"], entryKinds: ["INTERVAL", "DURATION"], maxMinutes: 960,
};

// The stand-in server: entries keyed by idempotency key. `loseNextAnswer` commits and then fails the response,
// which is what a dropped connection after the write looks like to the phone.
function server() {
  const entries = new Map();
  let loseNextAnswer = false;
  const record = async (request) => {
    const replay = entries.has(request.idempotencyKey);
    if (!replay) entries.set(request.idempotencyKey, request);
    if (loseNextAnswer) { loseNextAnswer = false; return { outcome: null, error: { code: "unavailable", details: null, message: "network" } }; }
    return { outcome: { outcome: replay ? "replayed" : "recorded", laborEntryId: `lab_${entries.size}` }, error: null };
  };
  return { entries, record, loseAnswer: () => { loseNextAnswer = true; } };
}

// The device queue, through the queue's REAL enqueue rule (a key already present is the same act).
function deviceQueue() {
  let queue = [];
  const enqueue = vi.fn(async (built) => {
    queue = enqueueIntent(queue, built.value);
    return { durable: true, intentId: built.value.intentId };
  });
  return { enqueue, items: () => queue };
}

let srv, dev;
beforeEach(() => { srv = server(); dev = deviceQueue(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => render(<JobLabor workOrderId="wo1"
  offline={{ enqueue: dev.enqueue, principalUid: "tech-a" }}
  deps={{ fetchLabor: vi.fn().mockResolvedValue({ outcome: READY, error: null }), recordLabor: vi.fn(srv.record) }} />);

async function press(h, m) {
  const button = await screen.findByRole("button", { name: /Add time/i });
  fireEvent.change(screen.getByRole("spinbutton", { name: /Hours/i }), { target: { value: h } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /Minutes/i }), { target: { value: m } });
  fireEvent.click(button);
}

describe("WOL-2: one press records the hours once", () => {
  it("a send that committed but lost its answer is queued under the SAME key, so syncing it REPLAYS -- one entry", async () => {
    mount();
    srv.loseAnswer();
    await press("2", "0");
    await screen.findByText(/held on this phone/i);
    expect(srv.entries.size).toBe(1); // the server DID record it; the phone could not know
    const [queued] = dev.items();
    expect(queued).toBeTruthy();
    // The sync later delivers the queued payload. Same key -> the server replays; the hours are not doubled.
    const synced = await srv.record(queued.payload);
    expect(synced.outcome.outcome).toBe("replayed");
    expect(srv.entries.size).toBe(1);
    expect(queued.payload.idempotencyKey).toBe([...srv.entries.keys()][0]);
  });

  it("two genuine entries of the same length, type and day are two entries online", async () => {
    mount();
    await press("1", "0");
    await screen.findByText(/time added/i);
    await press("1", "0");
    await waitFor(() => expect(srv.entries.size).toBe(2));
  });

  it("two genuine entries captured OFFLINE are two queued intents, not one collapsed by the queue", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mount();
    await press("1", "0");
    await screen.findByText(/held on this phone/i);
    await press("1", "0");
    await waitFor(() => expect(dev.enqueue).toHaveBeenCalledTimes(2));
    expect(dev.items()).toHaveLength(2);
    const [a, b] = dev.items();
    expect(a.intentId).not.toBe(b.intentId);
    expect(a.payload.idempotencyKey).not.toBe(b.payload.idempotencyKey);
    // Each syncs as its own entry.
    await srv.record(a.payload);
    await srv.record(b.payload);
    expect(srv.entries.size).toBe(2);
  });

  it("repeated taps of ONE press are still one act", async () => {
    let release;
    const recordLabor = vi.fn(() => new Promise((r) => { release = r; }));
    render(<JobLabor workOrderId="wo1" offline={{ enqueue: dev.enqueue, principalUid: "tech-a" }}
      deps={{ fetchLabor: vi.fn().mockResolvedValue({ outcome: READY, error: null }), recordLabor }} />);
    const button = await screen.findByRole("button", { name: /Add time/i });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Hours/i }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Minutes/i }), { target: { value: "0" } });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(recordLabor).toHaveBeenCalledTimes(1));
    expect(recordLabor).toHaveBeenCalledTimes(1);
    release({ outcome: { outcome: "recorded", laborEntryId: "lab_1" }, error: null });
  });
});
