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
const COUNT = () => captureCycleCountSubmit({ ...base, cycleCountId: "CC-9", countedQuantity: 12, captureKey: "c1" });

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
    const { commands } = createWarehouseBindings({ submitCanonicalReceive: async () => ({ status: "UNAVAILABLE", receipt: null }) });
    const out = await commands[WAREHOUSE_INTENT.INVENTORY_RECEIVE]({ payload: {} });
    expect(out.ok).toBe(false);
    // Nobody refused it; it never reached anyone to be refused by.
    expect(out.offline).toBe(true);
    expect(out.code).toBe("unavailable");
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
    const { prechecks } = createWarehouseBindings({ readCycleCount: async () => ({ id: "CC-9", status: "RECONCILED" }) });
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
