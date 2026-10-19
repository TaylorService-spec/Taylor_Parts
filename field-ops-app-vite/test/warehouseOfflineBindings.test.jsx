// WO-05 — THE BINDINGS AND THEIR PRECHECKS.
//
// Separate from the runtime suite because these import the real service clients, which import the
// Firebase app — plain `node --test` cannot resolve that, and pretending otherwise by stubbing the
// module path would test a stub instead of the binding.
//
// What is proven here is the half that only exists at the boundary: that inventory truth is re-read
// before a request is sent, that a world which moved produces a decision rather than a mutation, and
// that nothing is ever quietly substituted.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/firebase/firebase", () => ({ functions: {}, db: {}, auth: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => async () => ({ data: {} }) }));

const { createWarehouseBindings } = await import("../src/offline/warehouseCommandBindings.js");
const {
  WAREHOUSE_INTENT, WAREHOUSE_INTENT_TYPES,
  captureTransferDispatch, captureTransferReceive, capturePutAway,
  captureCycleCountSubmit, captureTruckHandoff,
} = await import("../src/offline/warehouseIntent.js");
const { runSyncPass, drainQueue } = await import("../src/offline/syncExecutor.js");
const { RECEIVING_OUTCOME } = await import("../src/domain/receivingTransport.js");
const { createWarehousePrecheckReads } = await import("../src/offline/warehousePrecheckReads.js");
const { enqueueIntent } = await import("../src/offline/intentQueue.js");

const UID = "uid-wh-1";
const okSession = () => ({ uid: UID });
const base = { principalUid: UID, at: 100, offline: true };
const queueOf = (...b) => b.reduce((q, i) => enqueueIntent(q, i.value ?? i), Object.freeze([]));

function recorder(outcome = { ok: true, serverIds: {} }) {
  const calls = [];
  const fn = async (i) => { calls.push(i); return typeof outcome === "function" ? outcome(i, calls) : outcome; };
  fn.calls = calls;
  return fn;
}
const allCommands = (fn) => Object.fromEntries(WAREHOUSE_INTENT_TYPES.map((t) => [t, fn]));

const DISPATCH = () => captureTransferDispatch({ ...base, transferOrderId: "TR-1042", sourceId: "wh-main", destinationId: "truck-12", captureKey: "d1" });
const RECEIVE_T = () => captureTransferReceive({ ...base, transferOrderId: "TR-1042", destinationId: "truck-12", captureKey: "tr1" });
const PUTAWAY = () => capturePutAway({ ...base, partId: "P", destinationBinId: "BIN-A1", quantity: 4, captureKey: "p1" });
const COUNT = () => captureCycleCountSubmit({ ...base, sheetId: "ccs_9", partId: "P", countedQuantity: 12, captureKey: "c1" });

// ═══════════════════════════════════════════ every type is bound

describe("the bindings", () => {
  it("ALL EIGHT TYPES HAVE A COMMAND — an unbound type would strand work silently", () => {
    const { commands } = createWarehouseBindings();
    for (const type of WAREHOUSE_INTENT_TYPES) {
      expect(typeof commands[type], `${type} has no bound command`).toBe("function");
    }
    expect(Object.keys(commands)).toHaveLength(8);
  });

  it("THERE IS NO RECONCILE BINDING — absence at the boundary too", () => {
    const { commands, prechecks } = createWarehouseBindings();
    expect(Object.keys(commands).some((k) => /RECONCIL/i.test(k))).toBe(false);
    expect(Object.keys(prechecks).some((k) => /RECONCIL/i.test(k))).toBe(false);
  });

  it("a truck handoff binds to the TRANSFER lifecycle, not a second movement model", async () => {
    const dispatched = [];
    const { commands } = createWarehouseBindings({
      transferCommandClient: {
        dispatchTransferOrder: async (r) => { dispatched.push(["dispatch", r.transferOrderId]); return { status: "IN_TRANSIT" }; },
        receiveTransferOrder: async (r) => { dispatched.push(["receive", r.transferOrderId]); return { status: "COMPLETED" }; },
      },
    });
    await commands[WAREHOUSE_INTENT.TRUCK_HANDOFF](captureTruckHandoff({ ...base, transferOrderId: "TR-7", action: "dispatch", captureKey: "a" }).value);
    await commands[WAREHOUSE_INTENT.TRUCK_HANDOFF](captureTruckHandoff({ ...base, transferOrderId: "TR-7", action: "receive", captureKey: "b" }).value);
    expect(dispatched).toEqual([["dispatch", "TR-7"], ["receive", "TR-7"]]);
  });

  it("a pick stages through the SAME placement command as a put-away", async () => {
    const placements = [];
    const { commands } = createWarehouseBindings({ recordPutAway: async (r) => { placements.push(r); return { placementId: "plc1" }; } });
    await commands[WAREHOUSE_INTENT.PICK_STAGE]({ payload: { partId: "P", destinationBinId: "STG-1", quantity: 2 } });
    await commands[WAREHOUSE_INTENT.PUT_AWAY]({ payload: { partId: "P", destinationBinId: "BIN-1", quantity: 2 } });
    expect(placements).toHaveLength(2);
  });

  it("a receiving transport that is not ready stays RETRYABLE, not refused", async () => {
    // The receiving client's REAL vocabulary is the lower-case RECEIVING_OUTCOME; this test once
    // mocked "UNAVAILABLE", a value the client never returns, and so pinned a binding that matched nothing.
    const { commands } = createWarehouseBindings({ submitCanonicalReceive: async () => ({ status: RECEIVING_OUTCOME.UNAVAILABLE, receipt: null }) });
    const out = await commands[WAREHOUSE_INTENT.INVENTORY_RECEIVE]({ payload: {} });
    expect(out.ok).toBe(false);
    // Nobody refused it; it never reached anyone to be refused by.
    expect(out.offline).toBe(true);
    expect(out.code).toBe("unavailable");
  });

  it("an APPLIED or REPLAYED receipt is a success carrying the receipt's receivingId", async () => {
    for (const [status, replayed] of [[RECEIVING_OUTCOME.APPLIED, false], [RECEIVING_OUTCOME.REPLAYED, true]]) {
      const { commands } = createWarehouseBindings({ submitCanonicalReceive: async () => ({ status, receipt: { receivingId: "rcv_1" } }) });
      const out = await commands[WAREHOUSE_INTENT.INVENTORY_RECEIVE]({ payload: {} });
      expect(out).toEqual({ ok: true, replayed, serverIds: { receiptId: "rcv_1" } });
    }
  });

  it("a governed refusal of a receipt is NOT reported as success", async () => {
    const { commands } = createWarehouseBindings({ submitCanonicalReceive: async () => ({ status: RECEIVING_OUTCOME.CONFLICT, receipt: null }) });
    const out = await commands[WAREHOUSE_INTENT.INVENTORY_RECEIVE]({ payload: {} });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("failed-precondition");
  });
});

// ═══════════════════════════════════════════ the world moved (§52)

describe("stale server state", () => {
  it("A CANCELLED TRANSFER IS NEVER DISPATCHED", async () => {
    const cmd = recorder();
    const { prechecks } = createWarehouseBindings({ readTransfer: async () => ({ id: "TR-1042", status: "CANCELLED" }) });
    const r = await runSyncPass(queueOf(DISPATCH()), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), prechecks } });
    expect(cmd.calls).toHaveLength(0);
    expect(r.queue[0].state).toBe("CONFLICT");
    expect(r.queue[0].lastServerError.details).toBe("TRANSFER_CANCELLED");
  });

  it("AN ALREADY-DISPATCHED TRANSFER RECONCILES rather than dispatching twice", async () => {
    const cmd = recorder();
    const { prechecks } = createWarehouseBindings({ readTransfer: async () => ({ id: "TR-1042", status: "IN_TRANSIT" }) });
    const r = await runSyncPass(queueOf(DISPATCH()), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), prechecks } });
    expect(cmd.calls).toHaveLength(0);
    expect(r.queue[0].state).toBe("SYNCED");
    expect(r.queue[0].resultingServerIds.status).toBe("IN_TRANSIT");
  });

  it("A RETIRED BIN CONFLICTS, and NO OTHER BIN IS CHOSEN", async () => {
    const cmd = recorder();
    const { prechecks } = createWarehouseBindings({ readBin: async () => ({ id: "BIN-A1", status: "INACTIVE" }) });
    const r = await runSyncPass(queueOf(PUTAWAY()), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), prechecks } });
    expect(cmd.calls).toHaveLength(0);
    expect(r.queue[0].lastServerError.details).toBe("BIN_NOT_ACTIVE");
    expect(r.queue[0].payload.destinationBinId).toBe("BIN-A1");
  });

  it("A COUNT ALREADY RECONCILED REFUSES — arguing with a closed book", async () => {
    const cmd = recorder();
    const { prechecks } = createWarehouseBindings({ readCycleCount: async () => ({ partId: "P", status: "RECONCILED" }) });
    const r = await runSyncPass(queueOf(COUNT()), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), prechecks } });
    expect(cmd.calls).toHaveLength(0);
    expect(r.queue[0].lastServerError.details).toBe("CYCLE_COUNT_ALREADY_RECONCILED");
  });

  it("a precheck that cannot read lets the COMMAND answer on its own authority", async () => {
    const cmd = recorder();
    const { prechecks } = createWarehouseBindings({ readTransfer: async () => null });
    await runSyncPass(queueOf(DISPATCH()), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), prechecks } });
    expect(cmd.calls).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════ B3-x: the REAL reads feed the prechecks

describe("the precheck reads are the real, scoped EOS reads (Firebase exit B3-x)", () => {
  // Server-shaped answers: exactly the fields listTransferOrders / listInventoryLocations / getCycleCountSheet return.
  const serverOf = (answers) => async (route, operation, input) => {
    const a = answers[operation];
    if (a instanceof Error) throw a;
    return typeof a === "function" ? a(input, route) : a;
  };

  it("readTransfer finds the transfer by its id; anything else it cannot see is null (the command then answers)", async () => {
    const reads = createWarehousePrecheckReads(serverOf({ listTransferOrders: { items: [{ transferOrderId: "TR-1042", status: "CANCELLED" }, { transferOrderId: "TR-9", status: "REQUESTED" }] } }));
    expect(await reads.readTransfer("TR-1042")).toEqual({ id: "TR-1042", status: "CANCELLED" });
    expect(await reads.readTransfer("TR-missing")).toBeNull();
    expect(await createWarehousePrecheckReads(serverOf({ listTransferOrders: new Error("down") })).readTransfer("TR-1042")).toBeNull();
  });

  it("readBin matches a BIN only (a warehouse with the same id is not a bin) and carries its status", async () => {
    const reads = createWarehousePrecheckReads(serverOf({ listInventoryLocations: { items: [
      { type: "WAREHOUSE", locationId: "BIN-A1", status: "ACTIVE" }, { type: "BIN", locationId: "BIN-A1", status: "INACTIVE" }] } }));
    expect(await reads.readBin("BIN-A1")).toEqual({ id: "BIN-A1", status: "INACTIVE" });
    expect(await reads.readBin("BIN-Z")).toBeNull();
  });

  it("readCycleCount reads the LINE's status by part; a closed or cancelled sheet outranks its lines", async () => {
    const lines = [{ partId: "P", status: "COUNTED" }, { partId: "Q", status: "RECONCILED" }];
    const open = createWarehousePrecheckReads(serverOf({ getCycleCountSheet: (input) => ({ sheet: { sheetId: input.sheetId, status: "OPEN" }, lines }) }));
    expect(await open.readCycleCount({ sheetId: "ccs_9", partId: "Q" })).toEqual({ status: "RECONCILED" });
    expect(await open.readCycleCount({ sheetId: "ccs_9", partId: "none" })).toBeNull();
    const closed = createWarehousePrecheckReads(serverOf({ getCycleCountSheet: { sheet: { status: "CLOSED" }, lines } }));
    expect(await closed.readCycleCount({ sheetId: "ccs_9", partId: "P" })).toEqual({ status: "CLOSED" });
    expect(await createWarehousePrecheckReads(serverOf({ getCycleCountSheet: new Error("refused") })).readCycleCount({ sheetId: "x", partId: "P" })).toBeNull();
  });

  it("the stale-state decisions now run on those reads: a cancelled transfer is spared, a receive before its dispatch WAITS, a retired bin conflicts", async () => {
    const run = async (answers, intent) => {
      const reads = createWarehousePrecheckReads(serverOf(answers));
      const cmd = recorder();
      const { prechecks } = createWarehouseBindings({ readTransfer: reads.readTransfer, readCycleCount: reads.readCycleCount, readBin: reads.readBin });
      const r = await runSyncPass(queueOf(intent), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), prechecks } });
      return { r, cmd };
    };
    let out = await run({ listTransferOrders: { items: [{ transferOrderId: "TR-1042", status: "CANCELLED" }] } }, DISPATCH());
    expect(out.cmd.calls).toHaveLength(0);
    expect(out.r.queue[0].lastServerError.details).toBe("TRANSFER_CANCELLED");
    out = await run({ listTransferOrders: { items: [{ transferOrderId: "TR-1042", status: "REQUESTED" }] } }, RECEIVE_T());
    expect(out.cmd.calls).toHaveLength(0);
    expect(out.r.queue[0].state).toBe("PENDING_SYNC");
    expect(out.r.queue[0].lastServerError.details).toBe("AWAITING_DISPATCH");
    out = await run({ listInventoryLocations: { items: [{ type: "BIN", locationId: "BIN-A1", status: "INACTIVE" }] } }, PUTAWAY());
    expect(out.cmd.calls).toHaveLength(0);
    expect(out.r.queue[0].lastServerError.details).toBe("BIN_NOT_ACTIVE");
    out = await run({ getCycleCountSheet: { sheet: { status: "OPEN" }, lines: [{ partId: "P", status: "RECONCILED" }] } }, COUNT());
    expect(out.cmd.calls).toHaveLength(0);
    expect(out.r.queue[0].lastServerError.details).toBe("CYCLE_COUNT_ALREADY_RECONCILED");
  });

  it("the app's bindings no longer default the reads to 'cannot read'", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/offline/warehouseCommandBindings.js"), "utf8");
    expect(src).not.toMatch(/\?\? \(async \(\) => null\)/);
    expect(src).toMatch(/createWarehousePrecheckReads\(\)/);
  });
});

// ═══════════════════════════════════════════ §40 reverse reconnect order

describe("FLAGSHIP — the transfer lifecycle in reverse reconnect order", () => {
  it("the destination reconnects FIRST and waits, rather than failing", async () => {
    const state = { status: "REQUESTED" };
    const { prechecks } = createWarehouseBindings({ readTransfer: async () => ({ id: "TR-1042", status: state.status }) });
    const commands = allCommands(async () => {
      if (state.status !== "IN_TRANSIT") return { ok: false, code: "failed-precondition", details: "INVALID_TRANSITION" };
      state.status = "COMPLETED";
      return { ok: true, serverIds: { status: "COMPLETED" } };
    });

    let r = await drainQueue(queueOf(RECEIVE_T()), { principalUid: UID, deps: { session: okSession, commands, prechecks, now: () => 0 } });
    // WAITING, not refused. Receiving an undispatched transfer is an ordering problem, and burning
    // it as a refusal would make somebody re-scan work that was never wrong.
    expect(r.queue[0].state).toBe("PENDING_SYNC");
    expect(r.queue[0].lastServerError.details).toBe("AWAITING_DISPATCH");
    expect(state.status).toBe("REQUESTED");

    // The other end dispatches. Now it may go — and the manual retry clears the backoff.
    state.status = "IN_TRANSIT";
    r = await drainQueue(r.queue, { principalUid: UID, deps: { session: okSession, commands, prechecks, now: () => 10 ** 7 } });
    expect(state.status).toBe("COMPLETED");
    expect(r.queue[0].state).toBe("SYNCED");
  });

  it("an ALREADY COMPLETED transfer reconciles instead of receiving twice", async () => {
    const cmd = recorder();
    const { prechecks } = createWarehouseBindings({ readTransfer: async () => ({ id: "TR-1042", status: "COMPLETED" }) });
    const r = await runSyncPass(queueOf(RECEIVE_T()), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), prechecks } });
    expect(cmd.calls).toHaveLength(0);
    expect(r.queue[0].state).toBe("SYNCED");
  });
});
