// MULTI-SCAN RECEIVING, OFFLINE — the queued receipt must be the EXACT request, under the SAME key.
//
// DEFECTS (pre-fix):
//   D-1  captureReceive stored {sourceId, partId: lines[0].partId, quantity: sum, serials flattened}.
//        The multi-line shape was gone, the canonical builder returned null on replay, and a receipt
//        saved offline could never sync.
//   D-2  the queued payload's idempotencyKey was the derived intent id (int_<hash>), not the key the
//        online attempt sent. An online attempt that COMMITTED but lost its response would, on replay,
//        be a NEW receipt id -- the server's replay recognition matches by key, so it could double-post.
//   D-3  (found while proving D-2) the receive binding compared the transport's status to upper-case
//        literals; submitCanonicalReceive returns lower-case RECEIVING_OUTCOME values, so a real
//        applied/replayed drain was recorded as a CONFLICT and a real "unavailable" was not retryable.
//
// Every proof goes through the rendered screen and the real queue/binding/sync code; only the
// transport function and the offline runtime's store are stand-ins.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within, act } from "@testing-library/react";

vi.mock("../src/firebase/firebase", () => ({ functions: {}, db: {}, auth: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: {} }) }));

const { default: MultiScanReceiving } = await import("../src/modules/receiving/MultiScanReceiving.jsx");
const { RECEIVING_OUTCOME, buildCanonicalReceiveRequest } = await import("../src/domain/receivingTransport.js");
const { createWarehouseBindings } = await import("../src/offline/warehouseCommandBindings.js");
const { captureReceive, WAREHOUSE_INTENT } = await import("../src/offline/warehouseIntent.js");
const { runSyncPass } = await import("../src/offline/syncExecutor.js");
const { enqueueIntent } = await import("../src/offline/intentQueue.js");
const { warehouseConflictCard } = await import("../src/offline/warehouseSyncPresentation.js");

afterEach(cleanup);
const setOnline = (v) => Object.defineProperty(window.navigator, "onLine", { value: v, configurable: true });
beforeEach(() => setOnline(true));

const UID = "uid-wh-1";

const line = (over) => ({ trackingMode: "NONE", receivedQuantity: 0, state: "NOT_RECEIVED", ...over });
const PROGRESS = {
  purchaseOrderId: "PO-1", supplierId: "SUP-1", supplierName: "Acme",
  storedStatus: "SENT", derivedState: "NOT_RECEIVED", receivable: true, version: 3,
  lines: [
    line({ lineId: "L1", partId: "P1", orderedQuantity: 5, remainingQuantity: 5 }),
    line({ lineId: "L2", partId: "P2", trackingMode: "SERIAL", orderedQuantity: 2, remainingQuantity: 2 }),
  ],
};

function runtime() {
  const enqueued = [];
  return {
    principalUid: UID,
    enqueue: vi.fn(async (intent) => {
      if (!intent?.valid) return { queued: false, reason: intent?.reason };
      enqueued.push(intent.value);
      return { queued: true, durable: true, intentId: intent.value.intentId };
    }),
    enqueued,
  };
}

function deps(submitCanonicalReceive, rt) {
  return {
    fetchReceivablePurchaseOrders: vi.fn().mockResolvedValue({
      status: RECEIVING_OUTCOME.READY,
      purchaseOrders: [{ purchaseOrderId: "PO-1", supplierId: "SUP-1", storedStatus: "SENT", lineCount: 2 }],
    }),
    fetchPurchaseOrderProgress: vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.READY, progress: PROGRESS }),
    fetchReceivingLocationOptions: vi.fn().mockResolvedValue({
      status: RECEIVING_OUTCOME.READY, options: [{ locationId: "WH-1", label: "Main warehouse" }],
    }),
    submitCanonicalReceive,
    offline: rt,
  };
}

const scan = (partId, serial = "") => {
  fireEvent.change(screen.getByLabelText(/^part$/i), { target: { value: partId } });
  if (serial) fireEvent.change(screen.getByLabelText(/^serial$/i), { target: { value: serial } });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
};

async function scanMultiLineAndSubmit(d) {
  render(<MultiScanReceiving deps={d} />);
  fireEvent.click(await screen.findByRole("button", { name: "PO-1" }));
  await screen.findByLabelText(/^part$/i);
  scan("P1"); scan("P1"); scan("P1");
  scan("P2", "SN-1"); scan("P2", "SN-2");
  fireEvent.change(screen.getByLabelText(/receiving location/i), { target: { value: "WH-1" } });
  await waitFor(() => expect(screen.getByRole("button", { name: /submit receipt/i }).disabled).toBe(false));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /submit receipt/i })); });
}

const EXPECTED_LINES = [
  { lineId: "L1", partId: "P1", receivedQuantity: 3 },
  { lineId: "L2", partId: "P2", receivedQuantity: 2, serialNumbers: ["SN-1", "SN-2"] },
];

describe("multi-scan receipt captured offline (D-1: exact lines)", () => {
  it("a device that KNOWS it is offline queues the EXACT canonical request, every line preserved", async () => {
    setOnline(false);
    const send = vi.fn();
    const rt = runtime();
    await scanMultiLineAndSubmit(deps(send, rt));
    await waitFor(() => expect(rt.enqueued).toHaveLength(1));
    expect(send).not.toHaveBeenCalled();
    const { payload } = rt.enqueued[0];
    expect(payload.source).toEqual({ type: "PURCHASE_ORDER", purchaseOrderId: "PO-1" });
    expect(payload.receivingLocation).toEqual({ type: "WAREHOUSE", locationId: "WH-1" });
    expect(payload.lines).toEqual(EXPECTED_LINES);
    expect(payload.expectedVersion).toBe(3);
    expect(typeof payload.idempotencyKey).toBe("string");
    // What the replay will send is a request the canonical builder accepts -- not a permanent refusal.
    expect(buildCanonicalReceiveRequest(payload)).not.toBeNull();
  });
});

describe("online attempt whose response was lost, then replayed (D-2: the SAME key)", () => {
  it("the queued request is the online request, byte for byte, including its idempotencyKey", async () => {
    // The online attempt reached nobody we heard back from: unavailable -> retryable -> queued.
    const send = vi.fn().mockResolvedValue({ status: RECEIVING_OUTCOME.UNAVAILABLE, receipt: null });
    const rt = runtime();
    await scanMultiLineAndSubmit(deps(send, rt));
    await waitFor(() => expect(rt.enqueued).toHaveLength(1));
    expect(send).toHaveBeenCalledTimes(1);
    const online = send.mock.calls[0][0];
    const queued = rt.enqueued[0].payload;
    expect(queued.idempotencyKey).toBe(online.idempotencyKey);
    expect(queued.idempotencyKey.startsWith("int_")).toBe(false);
    expect(JSON.parse(JSON.stringify(queued))).toEqual(JSON.parse(JSON.stringify(online)));

    // And the drain sends that same request, unchanged, through the REAL binding + precheck.
    const replaySend = vi.fn().mockResolvedValue({
      status: RECEIVING_OUTCOME.REPLAYED,
      receipt: { outcome: "replayed", receivingId: "rcvc_1" },
    });
    const { commands, prechecks } = createWarehouseBindings({ submitCanonicalReceive: replaySend });
    const q = enqueueIntent(Object.freeze([]), rt.enqueued[0]);
    const r = await runSyncPass(q, { principalUid: UID, deps: { session: () => ({ uid: UID }), commands, prechecks } });
    expect(replaySend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.stringify(replaySend.mock.calls[0][0]))).toEqual(JSON.parse(JSON.stringify(online)));
    expect(r.queue[0].state).toBe("SYNCED");
    expect(r.queue[0].resultingServerIds.receiptId).toBe("rcvc_1");
  });

  it("another user's queued receipt is never sent", async () => {
    const built = captureReceive({
      principalUid: UID, sourceId: "PO-1", captureKey: "k-1", offline: true,
      request: { source: { type: "PURCHASE_ORDER", purchaseOrderId: "PO-1" }, receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" }, lines: EXPECTED_LINES, idempotencyKey: "k-1", expectedVersion: 3 },
    });
    const send = vi.fn();
    const { commands, prechecks } = createWarehouseBindings({ submitCanonicalReceive: send });
    const r = await runSyncPass(enqueueIntent(Object.freeze([]), built.value), { principalUid: UID, deps: { session: () => ({ uid: "someone-else" }), commands, prechecks } });
    expect(r.outcome).toBe("PRINCIPAL_MISMATCH");
    expect(send).not.toHaveBeenCalled();
  });

  it("a captured request whose key is not the capture key is refused at capture", () => {
    const built = captureReceive({
      principalUid: UID, sourceId: "PO-1", captureKey: "k-1",
      request: { source: { type: "PURCHASE_ORDER", purchaseOrderId: "PO-1" }, lines: EXPECTED_LINES, idempotencyKey: "k-OTHER" },
    });
    expect(built.valid).toBe(false);
    expect(built.reason).toBe("receipt_request_key_mismatch");
  });
});

describe("an entry already queued in the OLD summarised shape", () => {
  it("is refused (never reconstructed), stays on the phone, and says why", async () => {
    // Exactly what the pre-fix screen stored for a two-line receipt.
    const legacy = captureReceive({
      principalUid: UID, sourceId: "PO-1", partId: "P1", quantity: null, serialNumbers: ["SN-1", "SN-2"],
      destinationId: "WH-1", captureKey: "old-key", offline: true,
    });
    expect(legacy.valid).toBe(true);
    const send = vi.fn();
    const { commands, prechecks } = createWarehouseBindings({ submitCanonicalReceive: send });
    const r = await runSyncPass(enqueueIntent(Object.freeze([]), legacy.value), { principalUid: UID, deps: { session: () => ({ uid: UID }), commands, prechecks } });
    expect(send, "no lines are guessed and nothing is sent").not.toHaveBeenCalled();
    const entry = r.queue[0];
    expect(entry.state).toBe("CONFLICT"); // the same terminal-without-a-person state as before
    expect(entry.lastServerError.code).toBe("failed-precondition");
    expect(entry.lastServerError.details).toBe("RECEIPT_CAPTURE_INCOMPLETE");
    expect(entry.payload).toEqual(legacy.value.payload); // untouched
    const card = warehouseConflictCard(entry);
    expect(card.happened).toMatch(/without its separate lines/i);
    expect(card.next).toMatch(/nothing was received/i);
    expect(card.fields.map((f) => f.label)).toContain("Source");
  });

  it("the legacy capture API itself is unchanged for its existing callers", () => {
    const built = captureReceive({ principalUid: UID, sourceId: "PO-1", partId: "P", quantity: 4, captureKey: "r1" });
    expect(built.value.type).toBe(WAREHOUSE_INTENT.INVENTORY_RECEIVE);
    expect(built.value.payload).toEqual({ sourceId: "PO-1", partId: "P", quantity: 4, idempotencyKey: built.value.intentId });
  });
});

describe("the receive binding reads the transport's REAL outcome values", () => {
  // submitCanonicalReceive returns RECEIVING_OUTCOME values, which are lower case. The binding used to
  // compare upper-case literals, so a real applied/replayed receipt became a false conflict and a real
  // "unavailable" was burned as a refusal instead of staying retryable.
  const req = { payload: { source: { type: "PURCHASE_ORDER", purchaseOrderId: "PO-1" }, lines: EXPECTED_LINES, idempotencyKey: "k" } };
  it("applied -> ok", async () => {
    const { commands } = createWarehouseBindings({ submitCanonicalReceive: async () => ({ status: RECEIVING_OUTCOME.APPLIED, receipt: { receivingId: "rcvc_9" } }) });
    const out = await commands[WAREHOUSE_INTENT.INVENTORY_RECEIVE](req);
    expect(out).toMatchObject({ ok: true, replayed: false, serverIds: { receiptId: "rcvc_9" } });
  });
  it("unavailable -> retryable, not refused", async () => {
    const { commands } = createWarehouseBindings({ submitCanonicalReceive: async () => ({ status: RECEIVING_OUTCOME.UNAVAILABLE, receipt: null }) });
    const out = await commands[WAREHOUSE_INTENT.INVENTORY_RECEIVE](req);
    expect(out).toMatchObject({ ok: false, code: "unavailable", offline: true });
  });
  it("conflict -> refused with the transport's status as the detail", async () => {
    const { commands } = createWarehouseBindings({ submitCanonicalReceive: async () => ({ status: RECEIVING_OUTCOME.CONFLICT, receipt: null }) });
    const out = await commands[WAREHOUSE_INTENT.INVENTORY_RECEIVE](req);
    expect(out).toMatchObject({ ok: false, code: "failed-precondition", details: "conflict" });
  });
});
