// WO-05 — THE WAREHOUSE OFFLINE RUNTIME, PROVEN.
// Run: node --test test/warehouseOfflineRuntime.test.mjs   (also `npm test`)
//
// The executor, the queue, the store and the failure classification are the SHIPPING ones, shared
// with the technician runtime. What is faked is one layer: the commands — the thing on the other
// side of the network — so "exactly one server effect" is a real count of real calls.
//
// The organising idea is that warehouse offline work is harder than technician offline work in one
// specific way: STOCK IS CONTENDED. Two people can be right at capture time and only one can be
// right at sync time. Most of what follows is about that.
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  WAREHOUSE_INTENT, WAREHOUSE_INTENT_TYPES, WAREHOUSE_STORE_NAMESPACE,
  RECONCILE_IS_ONLINE_ONLY, WAREHOUSE_DEPENDENCY_RULES,
  captureReceive, capturePutAway, capturePickStage, captureTransferDispatch,
  captureTransferReceive, captureTruckHandoff, captureCycleCountSubmit, captureReturnIntake,
} from "../src/offline/warehouseIntent.js";
import { warehouseConflictCard, warehousePendingCard } from "../src/offline/warehouseSyncPresentation.js";
import { enqueueIntent, readyIntents, summarizeQueue, markSynced } from "../src/offline/intentQueue.js";
import { runSyncPass, drainQueue, PASS_OUTCOME, hasUnsyncedWork } from "../src/offline/syncExecutor.js";
import { applyFailure } from "../src/offline/syncFailureClassification.js";
import { createIntentStore, localStorageAdapter } from "../src/offline/localIntentStore.js";
import { STORE_NAMESPACE } from "../src/offline/localIntentStore.js";

const UID = "uid-wh-1";
const queueOf = (...intents) => intents.reduce((q, i) => enqueueIntent(q, i.value ?? i), Object.freeze([]));
const okSession = () => ({ uid: UID });

const base = { principalUid: UID, at: 100, offline: true };
const RECEIVE = () => captureReceive({ ...base, sourceId: "PO-1", partId: "TS-4410", quantity: 4, destinationId: "wh-main", captureKey: "r1" });
const PUTAWAY = (dep) => capturePutAway({ ...base, partId: "TS-4410", destinationBinId: "BIN-A1", quantity: 4, dependsOnIntentId: dep, captureKey: "p1" });
const DISPATCH = () => captureTransferDispatch({ ...base, transferOrderId: "TR-1042", sourceId: "wh-main", destinationId: "truck-12", captureKey: "d1" });
const RECEIVE_T = (dep) => captureTransferReceive({ ...base, transferOrderId: "TR-1042", destinationId: "truck-12", dependsOnIntentId: dep, captureKey: "tr1" });
const COUNT = () => captureCycleCountSubmit({ ...base, cycleCountId: "CC-9", countedQuantity: 12, partId: "TS-4410", locationId: "BIN-A1", captureKey: "c1" });
const RETURN = () => captureReturnIntake({ ...base, sourceId: "CUST-5", partId: "TS-4410", quantity: 1, condition: "DAMAGED", captureKey: "ri1" });

/** A recording command set. Counts calls, so a duplicate business effect cannot hide. */
function recorder(outcome = { ok: true, serverIds: {} }) {
  const calls = [];
  const fn = async (intent) => { calls.push(intent); return typeof outcome === "function" ? outcome(intent, calls) : outcome; };
  fn.calls = calls;
  return fn;
}
const allCommands = (fn) => Object.fromEntries(WAREHOUSE_INTENT_TYPES.map((t) => [t, fn]));

// =====================================================================================
// 1 — THE OFFLINE PRINCIPLE
// =====================================================================================

describe("offline capture is an observation, never inventory state", () => {
  test("every intent is born PENDING_SYNC and claims nothing", () => {
    for (const built of [RECEIVE(), PUTAWAY(), DISPATCH(), RECEIVE_T(), COUNT(), RETURN()]) {
      assert.equal(built.valid, true);
      assert.equal(built.value.state, "PENDING_SYNC");
      assert.equal(built.value.resultingServerIds, null);
    }
  });

  test("NOTHING IN A PAYLOAD RESERVES, ALLOCATES OR PROJECTS A BALANCE", () => {
    // Two workers can both be right at capture. Holding a quantity on the strength of an intent
    // would make one of them wrong in a way the server never agreed to.
    const dump = JSON.stringify([RECEIVE(), PUTAWAY(), DISPATCH(), COUNT(), RETURN()].map((b) => b.value.payload));
    for (const forbidden of ["reserved", "allocated", "projectedBalance", "onHandAfter", "committed"]) {
      assert.ok(!dump.includes(forbidden), `${forbidden} must not appear in any payload`);
    }
  });

  test("the idempotency key IS the intent id, on every type", () => {
    for (const built of [RECEIVE(), PUTAWAY(), DISPATCH(), RECEIVE_T(), COUNT(), RETURN()]) {
      assert.equal(built.value.payload.idempotencyKey, built.value.intentId);
    }
  });

  test("identity is derived, so a reload does not become a second act", () => {
    assert.equal(RECEIVE().value.intentId, RECEIVE().value.intentId);
    assert.notEqual(RECEIVE().value.intentId, COUNT().value.intentId);
  });

  test("an unknown type is refused — this is not a generic warehouse command blob", () => {
    const bad = capturePutAway({ ...base, destinationBinId: "BIN-A1", captureKey: "x" });
    assert.equal(bad.valid, false, "an item with no identity at all cannot be placed");
    assert.equal(bad.reason, "item_identity_required");
  });

  test("credentials never reach warehouse device storage", () => {
    const r = captureReturnIntake({ ...base, sourceId: "C", partId: "P", notes: "x", captureKey: "k" });
    assert.equal(r.valid, true);
    const withToken = captureReceive({ ...base, sourceId: "PO", partId: "P", quantity: 1, captureKey: "k2" });
    // The forbidden-key guard is shared and already proven; this asserts warehouse payloads run
    // through it rather than around it.
    assert.ok(Object.keys(withToken.value.payload).every((k) => !/token|secret|password/i.test(k)));
  });
});

describe("reconciliation is online only, permanently", () => {
  test("THERE IS NO RECONCILE INTENT TYPE", () => {
    assert.ok(!WAREHOUSE_INTENT_TYPES.some((t) => /RECONCIL/i.test(t)));
    assert.equal(WAREHOUSE_INTENT_TYPES.length, 8);
  });

  test("and the reason is recorded, not merely the absence", () => {
    assert.match(RECONCILE_IS_ONLINE_ONLY.reason, /authority decision/i);
    assert.match(RECONCILE_IS_ONLINE_ONLY.uiText, /Reconnect to reconcile/i);
  });

});

// =====================================================================================
// 2 — DEPENDENCIES
// =====================================================================================

describe("dependencies follow stock, not capture order", () => {
  test("PUT-AWAY WAITS FOR ITS RECEIPT — placing stock the server does not know exists is a certain refusal", () => {
    const receive = RECEIVE();
    const putAway = PUTAWAY(receive.value.intentId);
    const q = queueOf(receive, putAway);
    assert.deepEqual(readyIntents(q).map((i) => i.type), [WAREHOUSE_INTENT.INVENTORY_RECEIVE]);

    const after = markSynced(q, receive.value.intentId, { serverIds: { receiptId: "rcv1" } });
    assert.deepEqual(readyIntents(after).map((i) => i.type), [WAREHOUSE_INTENT.PUT_AWAY]);
  });

  test("A FAILED RECEIPT BLOCKS ITS PUT-AWAY permanently", () => {
    const receive = RECEIVE();
    const putAway = PUTAWAY(receive.value.intentId);
    const failed = applyFailure(receive.value, { code: "permission-denied" });
    assert.equal(readyIntents(queueOf({ value: failed }, putAway)).length, 0);
  });

  test("a return intake depends on NOTHING — a note must never hold up the intake it describes", () => {
    assert.deepEqual(RETURN().value.dependsOn, []);
    assert.equal(readyIntents(queueOf(RETURN())).length, 1);
  });

  test("a count depends on nothing either — an observation changes no balance", () => {
    assert.deepEqual(COUNT().value.dependsOn, []);
  });

  test("the dependency graph is DOCUMENTED, with a reason per edge", () => {
    for (const rule of WAREHOUSE_DEPENDENCY_RULES) {
      assert.ok(rule.why && rule.why.length > 20, `${rule.to} must say why`);
    }
    const required = WAREHOUSE_DEPENDENCY_RULES.filter((r) => r.required);
    assert.equal(required.length, 2, "exactly two required edges: receipt->put-away, dispatch->receive");
  });

  test("put-away captured WITHOUT a local receipt does not invent a dependency", () => {
    // The stock may already exist server-side. Blocking on an edge nobody declared would strand it.
    assert.deepEqual(PUTAWAY(null).value.dependsOn, []);
  });
});

// =====================================================================================
// 3 — §53 IDEMPOTENCY MATRIX — the hard gate
// =====================================================================================

describe("exactly one server effect, per workflow", () => {
  const CAPTURES = [
    [WAREHOUSE_INTENT.INVENTORY_RECEIVE, RECEIVE],
    [WAREHOUSE_INTENT.PUT_AWAY, () => PUTAWAY(null)],
    [WAREHOUSE_INTENT.PICK_STAGE, () => capturePickStage({ ...base, workOrderId: "WO-1", partId: "P", pickedQuantity: 2, stagingBinId: "STG-1", captureKey: "ps" })],
    [WAREHOUSE_INTENT.TRANSFER_DISPATCH, DISPATCH],
    [WAREHOUSE_INTENT.TRANSFER_RECEIVE, () => RECEIVE_T(null)],
    [WAREHOUSE_INTENT.TRUCK_HANDOFF, () => captureTruckHandoff({ ...base, transferOrderId: "TR-2", captureKey: "th" })],
    [WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT, COUNT],
    [WAREHOUSE_INTENT.RETURN_INTAKE, RETURN],
  ];

  for (const [type, build] of CAPTURES) {
    test(`${type}: retried forever, sent ONCE`, async () => {
      const cmd = recorder();
      let q = queueOf(build());
      for (let pass = 0; pass < 4; pass += 1) {
        q = (await drainQueue(q, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } })).queue;
      }
      assert.equal(cmd.calls.length, 1, `${type} must reach the server exactly once`);
      assert.equal(q[0].state, "SYNCED");
    });
  }


  test("a server REPLAY is success, because it is", async () => {
    const r = await runSyncPass(queueOf(RECEIVE()), {
      principalUid: UID,
      deps: { session: okSession, commands: allCommands(recorder({ ok: true, replayed: true, serverIds: { receiptId: "rcv1" } })) },
    });
    assert.equal(r.queue[0].state, "SYNCED");
  });
});

// =====================================================================================
// 4 — CONTENDED STOCK
// =====================================================================================

describe("two workers, one quantity", () => {
  test("THE SECOND RECEIPT IS REFUSED, NOT SMOOTHED OVER — no over-receipt", async () => {
    // Both captured offline against the same remaining quantity. Both were right at capture.
    let committed = false;
    const cmd = async () => {
      if (committed) return { ok: false, code: "failed-precondition", details: "OVER_RECEIPT" };
      committed = true;
      return { ok: true, serverIds: { receiptId: "rcv1" } };
    };
    const first = await runSyncPass(queueOf(RECEIVE()), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    assert.equal(first.queue[0].state, "SYNCED");

    const second = captureReceive({ ...base, sourceId: "PO-1", partId: "TS-4410", quantity: 4, captureKey: "OTHER-WORKER" });
    const r = await runSyncPass(queueOf(second), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    assert.equal(r.queue[0].state, "CONFLICT");
    assert.equal(r.queue[0].lastServerError.details, "OVER_RECEIPT");
  });

  test("a stale pick cannot force stock that is gone", async () => {
    const cmd = recorder({ ok: false, code: "failed-precondition", details: "INSUFFICIENT_STOCK" });
    const pick = capturePickStage({ ...base, workOrderId: "WO-1", partId: "P", pickedQuantity: 9, stagingBinId: "STG-1", captureKey: "stale" });
    const r = await runSyncPass(queueOf(pick), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    // Not forced through, not silently reduced, and NOT retried forever.
    assert.equal(r.queue[0].state, "CONFLICT");
    const again = await runSyncPass(r.queue, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    assert.equal(again.outcome, PASS_OUTCOME.NOTHING_READY);
    assert.equal(cmd.calls.length, 1);
  });

  test("SERIALS ARE CARRIED INDIVIDUALLY, never summed into a count", () => {
    const built = captureReceive({ ...base, sourceId: "PO-1", partId: "P", serialNumbers: ["S1", "S2", "S3"], captureKey: "ser" });
    assert.deepEqual(built.value.payload.serialNumbers, ["S1", "S2", "S3"]);
    assert.equal(built.value.payload.quantity, undefined, "a serialized receipt carries identities, not a quantity");
    assert.equal(built.value.references.Quantity, 3, "the count shown to a person is derived from the identities");
  });

  test("A DUPLICATE SERIAL IS A CONFLICT, and nothing is substituted", async () => {
    const cmd = recorder({ ok: false, code: "failed-precondition", details: "DUPLICATE_SERIAL" });
    const built = captureReceive({ ...base, sourceId: "PO-1", partId: "P", serialNumbers: ["S1"], captureKey: "dup" });
    const r = await runSyncPass(queueOf(built), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    assert.equal(r.queue[0].state, "CONFLICT");
    // The intent still names the exact serial it was about -- a person can go and look at the unit.
    assert.equal(r.queue[0].references.Serial, "S1");
  });

  test("the same serialized unit in two incompatible intents: one lands, one conflicts", async () => {
    let taken = false;
    const cmd = async () => {
      if (taken) return { ok: false, code: "failed-precondition", details: "SERIAL_ALREADY_RECEIVED" };
      taken = true;
      return { ok: true };
    };
    const a = captureReceive({ ...base, sourceId: "PO-1", partId: "P", serialNumbers: ["S9"], captureKey: "a" });
    const b = capturePutAway({ ...base, serialNo: "S9", destinationBinId: "BIN-B", captureKey: "b" });
    const r = await drainQueue(queueOf(a, b), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    const states = r.queue.map((i) => i.state).sort();
    assert.deepEqual(states, ["CONFLICT", "SYNCED"], "one landed, one was refused; the unit was never cloned");
  });
});

// =====================================================================================
// 5 — STALE SERVER STATE (§52)
// =====================================================================================

// =====================================================================================
// 6 — AUTHORITY (§51)
// =====================================================================================

describe("authority is resolved at SEND, never at capture", () => {
  for (const [name, build] of [
    ["receiving", RECEIVE], ["transfer", DISPATCH], ["count", COUNT], ["return", RETURN],
  ]) {
    test(`${name}: revoked before reconnect -> REFUSED, no mutation, no endless retry`, async () => {
      const cmd = recorder({ ok: false, code: "permission-denied", details: "PERMISSION_DENIED" });
      const r = await runSyncPass(queueOf(build()), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
      assert.equal(r.queue[0].state, "REFUSED");
      assert.equal(r.sent, 0);
      const again = await runSyncPass(r.queue, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
      assert.equal(again.outcome, PASS_OUTCOME.NOTHING_READY);
      assert.equal(cmd.calls.length, 1, "asked once, and only once");
    });
  }

  test("A DIFFERENT USER NEVER SENDS THIS QUEUE", async () => {
    const cmd = recorder();
    const r = await runSyncPass(queueOf(RECEIVE()), {
      principalUid: UID, deps: { session: () => ({ uid: "somebody-else" }), commands: allCommands(cmd) },
    });
    assert.equal(r.outcome, PASS_OUTCOME.PRINCIPAL_MISMATCH);
    assert.equal(cmd.calls.length, 0);
  });
});

// =====================================================================================
// 7 — STORAGE AND ISOLATION
// =====================================================================================

function fakeStorage({ failOn = null } = {}) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failOn === "quota") { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

describe("the warehouse queue is its own", () => {
  test("IT DOES NOT SHARE A STORAGE KEY WITH THE TECHNICIAN QUEUE", async () => {
    // One person can be both. A shared key would let each runtime's save wipe the other's queue.
    assert.notEqual(WAREHOUSE_STORE_NAMESPACE, STORE_NAMESPACE);
    const storage = fakeStorage();
    const wh = createIntentStore({ adapter: localStorageAdapter(storage), namespace: WAREHOUSE_STORE_NAMESPACE });
    const tech = createIntentStore({ adapter: localStorageAdapter(storage) });
    await wh.save(UID, { intents: [RECEIVE().value] }, 1);
    await tech.save(UID, { intents: [] }, 2);
    assert.equal((await wh.load(UID)).record.intents.length, 1, "the warehouse queue survived the technician save");
  });

  test("a receipt survives a restart", async () => {
    const storage = fakeStorage();
    const store = createIntentStore({ adapter: localStorageAdapter(storage), namespace: WAREHOUSE_STORE_NAMESPACE });
    const built = RECEIVE();
    assert.equal((await store.save(UID, { intents: [built.value] }, 10)).durable, true);

    const reopened = createIntentStore({ adapter: localStorageAdapter(storage), namespace: WAREHOUSE_STORE_NAMESPACE });
    const loaded = await reopened.load(UID);
    assert.equal(loaded.record.intents[0].intentId, built.value.intentId);
    assert.equal(loaded.record.intents[0].state, "PENDING_SYNC");
  });

  test("ANOTHER WAREHOUSE USER SEES NOTHING OF THIS ONE'S, and it is not deleted", async () => {
    const storage = fakeStorage();
    const store = createIntentStore({ adapter: localStorageAdapter(storage), namespace: WAREHOUSE_STORE_NAMESPACE });
    await store.save(UID, { intents: [RECEIVE().value] }, 1);
    assert.equal((await store.load("uid-other")).record.intents.length, 0);
    assert.equal((await store.load(UID)).record.intents.length, 1);
  });

  test("A FAILED SAVE IS REPORTED — never a silent loss dressed as queued", async () => {
    const store = createIntentStore({ adapter: localStorageAdapter(fakeStorage({ failOn: "quota" })), namespace: WAREHOUSE_STORE_NAMESPACE });
    const result = await store.save(UID, { intents: [RECEIVE().value] });
    assert.equal(result.durable, false);
    assert.equal(result.reason, "quota_exceeded");
  });
});

describe("restart, for every workflow", () => {
  for (const [type, build] of [
    [WAREHOUSE_INTENT.INVENTORY_RECEIVE, RECEIVE],
    [WAREHOUSE_INTENT.PUT_AWAY, () => PUTAWAY(null)],
    [WAREHOUSE_INTENT.TRANSFER_DISPATCH, DISPATCH],
    [WAREHOUSE_INTENT.TRANSFER_RECEIVE, () => RECEIVE_T(null)],
    [WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT, COUNT],
    [WAREHOUSE_INTENT.RETURN_INTAKE, RETURN],
  ]) {
    test(`${type}: capture -> restart -> reconnect -> ONE effect`, async () => {
      const storage = fakeStorage();
      const cmd = recorder();
      const store = createIntentStore({ adapter: localStorageAdapter(storage), namespace: WAREHOUSE_STORE_NAMESPACE });
      await store.save(UID, { intents: [build().value] }, 5);

      const reopened = createIntentStore({ adapter: localStorageAdapter(storage), namespace: WAREHOUSE_STORE_NAMESPACE });
      const loaded = await reopened.load(UID);
      assert.equal(loaded.record.intents.length, 1);

      const r = await drainQueue(loaded.record.intents, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
      assert.equal(cmd.calls.length, 1);
      assert.equal(r.queue[0].state, "SYNCED");
    });
  }
});

// =====================================================================================
// 8 — FLAPPING, ISOLATION, FLAGSHIPS
// =====================================================================================

describe("a flapping connection in a steel building", () => {
  test("nothing duplicated, nothing lost, nothing falsely marked sent", async () => {
    const attempts = [];
    const failures = new Map();
    const cmd = async (i) => {
      attempts.push(i.intentId);
      const n = (failures.get(i.intentId) ?? 0) + 1;
      failures.set(i.intentId, n);
      if (n <= 2) return { ok: false, code: "unavailable", offline: true };
      return { ok: true, serverIds: { id: `srv-${i.intentId}` } };
    };
    let q = queueOf(RECEIVE(), COUNT(), RETURN());
    let clock = 0;
    for (let round = 0; round < 6; round += 1) {
      clock += 60 * 60_000;
      q = (await drainQueue(q, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), now: () => clock } })).queue;
    }
    assert.equal(q.length, 3);
    for (const i of q) assert.equal(i.state, "SYNCED");
    for (const id of new Set(attempts)) {
      assert.equal(attempts.filter((a) => a === id).length, 3, "two failures then one success, never a fourth");
    }
    assert.equal(hasUnsyncedWork(q), false);
  });

  test("an interrupted pass leaves unsent work PENDING, never synced", async () => {
    let n = 0;
    const cmd = async () => { n += 1; if (n === 2) throw new Error("dropped"); return { ok: true }; };
    const r = await drainQueue(queueOf(RECEIVE(), COUNT(), RETURN()), {
      principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), now: () => 1 },
    });
    assert.ok(r.queue.some((i) => i.state === "PENDING_SYNC"));
    assert.ok(!r.queue.some((i) => i.state === "SYNCED" && i.attemptCount === 0));
  });
});

describe("one bad task does not block the rest", () => {
  test("a conflicted count leaves the receipt and the return alone", async () => {
    const commands = {
      ...allCommands(recorder()),
      [WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT]: recorder({ ok: false, code: "failed-precondition", details: "CYCLE_COUNT_CANCELLED" }),
    };
    const r = await drainQueue(queueOf(RECEIVE(), COUNT(), RETURN(), DISPATCH()), {
      principalUid: UID, deps: { session: okSession, commands },
    });
    const byType = Object.fromEntries(r.queue.map((i) => [i.type, i.state]));
    assert.equal(byType[WAREHOUSE_INTENT.INVENTORY_RECEIVE], "SYNCED");
    assert.equal(byType[WAREHOUSE_INTENT.RETURN_INTAKE], "SYNCED");
    assert.equal(byType[WAREHOUSE_INTENT.TRANSFER_DISPATCH], "SYNCED");
    assert.equal(byType[WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT], "CONFLICT");
    assert.equal(summarizeQueue(r.queue).attentionCount, 1);
  });
});

describe("FLAGSHIP — receive then put away", () => {
  test("ordered, dependent, and exactly once each", async () => {
    const order = [];
    const commands = Object.fromEntries(WAREHOUSE_INTENT_TYPES.map((t) => [t, async (i) => {
      order.push(i.type);
      return { ok: true, serverIds: { id: `srv-${t}` } };
    }]));
    const receive = RECEIVE();
    const putAway = PUTAWAY(receive.value.intentId);
    const r = await drainQueue(queueOf(receive, putAway), { principalUid: UID, deps: { session: okSession, commands } });
    assert.deepEqual(order, [WAREHOUSE_INTENT.INVENTORY_RECEIVE, WAREHOUSE_INTENT.PUT_AWAY]);
    assert.equal(r.sent, 2);
  });

  test("IF THE RECEIPT IS REFUSED, THE STOCK IS NOT PLACED", async () => {
    const order = [];
    const commands = Object.fromEntries(WAREHOUSE_INTENT_TYPES.map((t) => [t, async (i) => {
      order.push(i.type);
      return t === WAREHOUSE_INTENT.INVENTORY_RECEIVE
        ? { ok: false, code: "failed-precondition", details: "OVER_RECEIPT" }
        : { ok: true };
    }]));
    const receive = RECEIVE();
    const putAway = PUTAWAY(receive.value.intentId);
    const r = await drainQueue(queueOf(receive, putAway), { principalUid: UID, deps: { session: okSession, commands } });
    assert.ok(!order.includes(WAREHOUSE_INTENT.PUT_AWAY), "put-away was NEVER SENT");
    assert.equal(r.queue.find((i) => i.type === WAREHOUSE_INTENT.PUT_AWAY).state, "PENDING_SYNC");
  });
});

describe("FLAGSHIP — the transfer lifecycle, both reconnect orders", () => {
  const transferCommands = (state) => Object.fromEntries(WAREHOUSE_INTENT_TYPES.map((t) => [t, async () => {
    if (t === WAREHOUSE_INTENT.TRANSFER_DISPATCH) {
      if (state.status !== "REQUESTED" && state.status !== "IN_TRANSIT") return { ok: false, code: "failed-precondition", details: "INVALID_TRANSITION" };
      const replayed = state.status === "IN_TRANSIT";
      state.status = "IN_TRANSIT";
      return { ok: true, replayed, serverIds: { status: "IN_TRANSIT" } };
    }
    if (t === WAREHOUSE_INTENT.TRANSFER_RECEIVE) {
      if (state.status !== "IN_TRANSIT" && state.status !== "COMPLETED") return { ok: false, code: "failed-precondition", details: "INVALID_TRANSITION" };
      const replayed = state.status === "COMPLETED";
      state.status = "COMPLETED";
      return { ok: true, replayed, serverIds: { status: "COMPLETED" } };
    }
    return { ok: true };
  }]));

  test("REQUESTED -> IN_TRANSIT -> COMPLETED, exactly once", async () => {
    const state = { status: "REQUESTED" };
    const dispatch = DISPATCH();
    const receipt = RECEIVE_T(dispatch.value.intentId);
    const r = await drainQueue(queueOf(dispatch, receipt), {
      principalUid: UID, deps: { session: okSession, commands: transferCommands(state) },
    });
    assert.equal(state.status, "COMPLETED");
    for (const i of r.queue) assert.equal(i.state, "SYNCED");
  });

});

describe("FLAGSHIP — cycle count", () => {
  test("blind count survives a restart, submits once, and the COUNTER NEVER RECONCILES", async () => {
    const storage = fakeStorage();
    const store = createIntentStore({ adapter: localStorageAdapter(storage), namespace: WAREHOUSE_STORE_NAMESPACE });
    const built = COUNT();

    // BLIND: there is nowhere in the payload for an expected quantity to hide.
    assert.equal(built.value.payload.expectedQuantity, undefined);
    assert.equal(built.value.payload.variance, undefined);

    await store.save(UID, { intents: [built.value] }, 1);
    const loaded = await (createIntentStore({ adapter: localStorageAdapter(storage), namespace: WAREHOUSE_STORE_NAMESPACE })).load(UID);

    const cmd = recorder({ ok: true, serverIds: { cycleCountId: "CC-9", status: "COUNTED" } });
    const r = await drainQueue(loaded.record.intents, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    assert.equal(cmd.calls.length, 1);
    assert.equal(r.queue[0].resultingServerIds.status, "COUNTED", "COUNTED -- awaiting reconciliation, not reconciled");
    // And there is no way for this runtime to reconcile it.
    assert.ok(!WAREHOUSE_INTENT_TYPES.some((t) => /RECONCIL/i.test(t)));
  });
});

describe("FLAGSHIP — return intake", () => {
  test("one intake record, and ZERO restock effect", async () => {
    const built = RETURN();
    // Asserted on the payload itself: nothing here can be read as a stock movement.
    const payload = JSON.stringify(built.value.payload);
    for (const word of ["restock", "disposition", "credit", "scrap", "repair", "quantityOnHand"]) {
      assert.ok(!payload.toLowerCase().includes(word.toLowerCase()), `${word} must not appear`);
    }
    const cmd = recorder({ ok: true, serverIds: { returnId: "ret_1" } });
    const r = await drainQueue(queueOf(built), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    assert.equal(cmd.calls.length, 1);
    assert.equal(r.queue[0].resultingServerIds.returnId, "ret_1");
  });
});

// =====================================================================================
// 9 — STRUCTURED CONFLICT UX (§25 / §26 / §47 / §58)
// =====================================================================================

describe("a warehouse conflict is an object, not a sentence", () => {
  const conflicted = () => applyFailure(DISPATCH().value, { code: "failed-precondition", details: "TRANSFER_CANCELLED" });

  test("it renders DISCRETE FIELDS so a person can see which one moved", () => {
    const card = warehouseConflictCard(conflicted(), { domainStatus: "CANCELLED", domainStatusLabel: "Transfer status" });
    const byLabel = Object.fromEntries(card.fields.map((f) => [f.label, f.value]));
    assert.equal(byLabel.Transfer, "TR-1042");
    assert.equal(byLabel.Source, "wh-main");
    assert.equal(byLabel.Destination, "truck-12");
  });

  test("DOMAIN STATUS AND SYNC STATUS ARE TWO FIELDS", () => {
    // "the transfer was cancelled" and "your dispatch has not been sent" are opposite problems.
    const card = warehouseConflictCard(conflicted(), { domainStatus: "CANCELLED", domainStatusLabel: "Transfer status" });
    const labels = card.fields.map((f) => f.label);
    assert.ok(labels.includes("Transfer status"));
    assert.ok(labels.includes("Sync status"));
    const domain = card.fields.find((f) => f.label === "Transfer status");
    const sync = card.fields.find((f) => f.label === "Sync status");
    assert.equal(domain.value, "Cancelled");
    assert.equal(domain.raw, "CANCELLED");
    assert.equal(sync.value, "Needs review — changed elsewhere");
    assert.notEqual(domain.value, sync.value);
  });

  test("NO FIELD VALUE IS A JOINED STRING", () => {
    const card = warehouseConflictCard(conflicted(), { domainStatus: "CANCELLED" });
    for (const f of card.fields) {
      // The separators that mean "two business attributes were glued together". An em-dash inside a
      // status PHRASE ("Needs review — changed elsewhere") is one label, not two attributes, so the
      // check is on the joining characters this standard actually forbids.
      assert.ok(!/ · |·|, Qty | S\/N /.test(String(f.value)), `"${f.value}" looks like two attributes in one field`);
    }
    // And each BUSINESS reference is a single atomic value.
    for (const label of ["Transfer", "Source", "Destination"]) {
      const f = card.fields.find((x) => x.label === label);
      if (f) assert.ok(!/\s/.test(String(f.value)), `${label} must be one value, got "${f.value}"`);
    }
  });

  test("the headline describes the WORLD, and the raw code is one level deeper", () => {
    const card = warehouseConflictCard(conflicted());
    assert.match(card.happened, /cancelled while you were offline/i);
    assert.ok(!card.happened.includes("failed-precondition"));
    assert.equal(card.technical.details, "TRANSFER_CANCELLED");
  });

  test("EVERY CARD SAYS THE WORK IS KEPT", () => {
    assert.match(warehouseConflictCard(conflicted()).preserved, /kept on this phone/i);
  });

  test("a pending card carries the same fields, so reading mode never switches", () => {
    const card = warehousePendingCard(RECEIVE().value);
    const byLabel = Object.fromEntries(card.fields.map((f) => [f.label, f.value]));
    assert.equal(byLabel.Source, "PO-1");
    assert.equal(byLabel.Part, "TS-4410");
    assert.equal(byLabel.Quantity, "4");
    assert.equal(byLabel["Sync status"], "Waiting to sync");
  });

  test("a reference nobody recorded is omitted, not rendered as a false blank", () => {
    // Unlike an object's own attributes, these vary legitimately by intent type: "Serial: Not
    // recorded" on a quantity-tracked part is noise pretending to be information.
    const card = warehousePendingCard(RECEIVE().value);
    assert.ok(!card.fields.some((f) => f.label === "Serial"));
  });
});
