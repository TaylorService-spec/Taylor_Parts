// WO-03 — THE TECHNICIAN OFFLINE RUNTIME, PROVEN.
// Run: node --test test/technicianOfflineRuntime.test.mjs   (also `npm test`)
//
// The runtime is pure plus one injectable storage adapter, so every proof below is a real proof: the
// executor under test is the executor that ships, the queue logic is the queue logic that ships, and
// the fake in each test is a COMMAND — the thing on the other side of the network — not a stand-in
// for any of the machinery being asserted.
//
// The tests are organised the way the risk is:
//
//   1  envelope        identity is derived, replay and conflict are distinguishable
//   2  queue           dependency semantics, ordering, isolation
//   3  classification  four failure classes, bounded retry
//   4  store           durability, principal isolation, schema migration, quota
//   5  executor        the sequence, and every conflict it must survive
//   6  the flagship    one INSTALL work order, five intents, one reconnection
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  INTENT_TYPE, makeIntent, deriveIntentId, payloadFingerprint, containsForbiddenMaterial,
} from "../src/offline/technicianIntent.js";
import {
  enqueueIntent, readyIntents, evaluateIntent, markSynced, HOLD_REASON,
  summarizeQueue, diagnosticView, pruneSynced, retryIntent,
} from "../src/offline/intentQueue.js";
import {
  classifyFailure, applyFailure, FAILURE_CLASS, MAX_ATTEMPTS, nextBackoffMillis,
} from "../src/offline/syncFailureClassification.js";
import {
  createIntentStore, memoryAdapter, localStorageAdapter, selectAdapter,
  LOAD_OUTCOME, SCHEMA_VERSION, cacheEntry, CACHE_KIND,
} from "../src/offline/localIntentStore.js";
import {
  runSyncPass, drainQueue, PASS_OUTCOME, shouldAttemptSync, connectivityHint, hasUnsyncedWork,
} from "../src/offline/syncExecutor.js";
import {
  captureNote, captureLabor, capturePartsUsage, captureInstall, captureComplete,
  closeoutDependencies, classifyOfflineScan, OFFLINE_SCAN,
} from "../src/offline/technicianIntentCapture.js";

const UID = "uid-tech-1";
const WO = "wo-install-1";

const intent = (type, over = {}) => makeIntent({
  type, workOrderId: over.workOrderId ?? WO, principalUid: UID,
  captureKey: over.captureKey ?? `${type}-1`, payload: over.payload ?? { x: 1 },
  dependsOn: over.dependsOn ?? [], createdAtLocal: over.createdAtLocal ?? 0,
}).value;

const queueOf = (...intents) => intents.reduce((q, i) => enqueueIntent(q, i), Object.freeze([]));
const okSession = () => ({ uid: UID });

// =====================================================================================
// 1 — THE ENVELOPE
// =====================================================================================

describe("intent identity", () => {
  test("the id is derived, so the same act keeps it across a reload", () => {
    const a = makeIntent({ type: INTENT_TYPE.LABOR_RECORD, workOrderId: WO, principalUid: UID, captureKey: "tap-1", payload: { m: 90 } });
    const b = makeIntent({ type: INTENT_TYPE.LABOR_RECORD, workOrderId: WO, principalUid: UID, captureKey: "tap-1", payload: { m: 90 } });
    assert.equal(a.value.intentId, b.value.intentId);
    assert.equal(a.value.intentId, deriveIntentId({ type: INTENT_TYPE.LABOR_RECORD, workOrderId: WO, captureKey: "tap-1" }));
  });

  test("a different act gets a different id", () => {
    const a = intent(INTENT_TYPE.LABOR_RECORD, { captureKey: "tap-1" });
    const b = intent(INTENT_TYPE.LABOR_RECORD, { captureKey: "tap-2" });
    assert.notEqual(a.intentId, b.intentId);
  });

  test("the fingerprint ignores key order, so a refactor is not a changed request", () => {
    assert.equal(payloadFingerprint({ a: 1, b: { c: 2, d: 3 } }), payloadFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  test("REPLAY and CONFLICT are distinguishable: same id, different fingerprint", () => {
    const a = makeIntent({ type: INTENT_TYPE.NOTE_ADD, workOrderId: WO, principalUid: UID, captureKey: "k", payload: { executionNote: "left" } });
    const b = makeIntent({ type: INTENT_TYPE.NOTE_ADD, workOrderId: WO, principalUid: UID, captureKey: "k", payload: { executionNote: "right" } });
    assert.equal(a.value.intentId, b.value.intentId, "same act id");
    assert.notEqual(a.value.payloadFingerprint, b.value.payloadFingerprint, "different request");
  });

  test("CREDENTIALS NEVER REACH DEVICE STORAGE", () => {
    for (const bad of [
      { idToken: "x" }, { auth: { refreshToken: "x" } }, { password: "x" },
      { apiKey: "x" }, { headers: { Authorization: "Bearer x" } }, { mySecret: "x" },
    ]) {
      assert.ok(containsForbiddenMaterial(bad), `${JSON.stringify(bad)} must be refused`);
      const r = makeIntent({ type: INTENT_TYPE.NOTE_ADD, workOrderId: WO, principalUid: UID, captureKey: "k", payload: bad });
      assert.equal(r.valid, false);
      assert.match(r.reason, /^forbidden_payload_key:/);
    }
  });

  test("business data IS allowed — it is a cache, not a vault", () => {
    const r = makeIntent({
      type: INTENT_TYPE.NOTE_ADD, workOrderId: WO, principalUid: UID, captureKey: "k",
      payload: { executionNote: "Replaced the compressor at Acme Foods, 14 Mill St" },
    });
    assert.equal(r.valid, true);
  });

  test("an intent is born PENDING_SYNC and claims nothing", () => {
    assert.equal(intent(INTENT_TYPE.EQUIPMENT_INSTALL).state, "PENDING_SYNC");
  });

  test("an unknown type is refused — this is not a generic command queue", () => {
    assert.equal(makeIntent({ type: "DELETE_EVERYTHING", workOrderId: WO, principalUid: UID, captureKey: "k" }).reason, "unknown_intent_type");
  });

  test("a principal is required, so nothing is ever queued unattributed", () => {
    assert.equal(makeIntent({ type: INTENT_TYPE.NOTE_ADD, workOrderId: WO, captureKey: "k" }).reason, "principal_required");
  });
});

// =====================================================================================
// 2 — THE QUEUE
// =====================================================================================

describe("dependencies", () => {
  test("a REQUIRED dependency blocks its dependent until it succeeds", () => {
    const install = intent(INTENT_TYPE.EQUIPMENT_INSTALL, { captureKey: "i" });
    const complete = intent(INTENT_TYPE.WORK_ORDER_COMPLETE, {
      captureKey: "c", dependsOn: [{ intentId: install.intentId, required: true }],
    });
    const q = queueOf(install, complete);
    assert.equal(evaluateIntent(complete, q).reason, HOLD_REASON.AWAITING_REQUIRED);
    assert.deepEqual(readyIntents(q).map((i) => i.type), [INTENT_TYPE.EQUIPMENT_INSTALL]);

    const after = markSynced(q, install.intentId, { serverIds: { equipmentId: "eq1" } });
    assert.equal(evaluateIntent(complete, after).sendable, true);
  });

  test("A FAILED REQUIREMENT BLOCKS COMPLETION PERMANENTLY — the whole point of install-first", () => {
    const install = intent(INTENT_TYPE.EQUIPMENT_INSTALL, { captureKey: "i" });
    const complete = intent(INTENT_TYPE.WORK_ORDER_COMPLETE, {
      captureKey: "c", dependsOn: [{ intentId: install.intentId, required: true }],
    });
    const failed = applyFailure(install, { code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE" });
    const q = queueOf(failed, complete);
    const verdict = evaluateIntent(complete, q);
    assert.equal(verdict.sendable, false);
    assert.equal(verdict.reason, HOLD_REASON.BLOCKED_BY_FAILED_REQUIREMENT);
    // A completed job whose installation never happened must be unreachable, not merely unlikely.
    assert.equal(readyIntents(q).length, 0);
  });

  test("an OPTIONAL dependency yields while it can still land", () => {
    const labor = intent(INTENT_TYPE.LABOR_RECORD, { captureKey: "l" });
    const complete = intent(INTENT_TYPE.WORK_ORDER_COMPLETE, {
      captureKey: "c", dependsOn: [{ intentId: labor.intentId, required: false }],
    });
    const q = queueOf(labor, complete);
    assert.equal(evaluateIntent(complete, q).reason, HOLD_REASON.AWAITING_SEQUENCED);
  });

  test("an OPTIONAL dependency that has STOPPED no longer blocks — a dead note must not strand a job", () => {
    const note = intent(INTENT_TYPE.NOTE_ADD, { captureKey: "n" });
    const complete = intent(INTENT_TYPE.WORK_ORDER_COMPLETE, {
      captureKey: "c", dependsOn: [{ intentId: note.intentId, required: false }],
    });
    const refused = applyFailure(note, { code: "permission-denied" });
    assert.equal(evaluateIntent(complete, queueOf(refused, complete)).sendable, true);
  });

  test("a dependency that is gone counts as satisfied, not as missing forever", () => {
    const complete = intent(INTENT_TYPE.WORK_ORDER_COMPLETE, {
      captureKey: "c", dependsOn: [{ intentId: "int_pruned", required: true }],
    });
    assert.equal(evaluateIntent(complete, queueOf(complete)).sendable, true);
  });

  test("closeoutDependencies derives the graph from the QUEUE, not from render order", () => {
    const q = queueOf(
      intent(INTENT_TYPE.NOTE_ADD, { captureKey: "n" }),
      intent(INTENT_TYPE.EQUIPMENT_INSTALL, { captureKey: "i" }),
      intent(INTENT_TYPE.LABOR_RECORD, { captureKey: "l" }),
      intent(INTENT_TYPE.PARTS_USAGE, { captureKey: "p" }),
      intent(INTENT_TYPE.NOTE_ADD, { captureKey: "other", workOrderId: "wo-other" }),
    );
    const deps = closeoutDependencies(q, WO);
    assert.equal(deps.length, 4, "only this work order's intents");
    const required = deps.filter((d) => d.required);
    assert.equal(required.length, 1, "installation is the only requirement");
  });

  test("a SYNCED intent produces no dependency edge", () => {
    const install = intent(INTENT_TYPE.EQUIPMENT_INSTALL, { captureKey: "i" });
    const synced = markSynced(queueOf(install), install.intentId);
    assert.equal(closeoutDependencies(synced, WO).length, 0);
  });
});

describe("ordering", () => {
  test("ORDER COMES FROM THE GRAPH, NOT FROM INSERTION — reversed input, same output", () => {
    const note = intent(INTENT_TYPE.NOTE_ADD, { captureKey: "n", createdAtLocal: 40 });
    const parts = intent(INTENT_TYPE.PARTS_USAGE, { captureKey: "p", createdAtLocal: 30 });
    const labor = intent(INTENT_TYPE.LABOR_RECORD, { captureKey: "l", createdAtLocal: 20 });
    const forward = readyIntents(queueOf(note, parts, labor)).map((i) => i.type);
    const backward = readyIntents(queueOf(labor, parts, note)).map((i) => i.type);
    assert.deepEqual(forward, backward);
    assert.deepEqual(forward, [INTENT_TYPE.NOTE_ADD, INTENT_TYPE.PARTS_USAGE, INTENT_TYPE.LABOR_RECORD]);
  });

  test("dependency depth beats type precedence", () => {
    // A note that depends on an install must not sort ahead of it, even though notes go first.
    const install = intent(INTENT_TYPE.EQUIPMENT_INSTALL, { captureKey: "i" });
    const note = intent(INTENT_TYPE.NOTE_ADD, {
      captureKey: "n", dependsOn: [{ intentId: install.intentId, required: false }],
    });
    const q = markSynced(queueOf(install, note), install.intentId);
    assert.deepEqual(readyIntents(q).map((i) => i.type), [INTENT_TYPE.NOTE_ADD]);
    // and while the install is live, the note waits despite its higher precedence
    assert.deepEqual(readyIntents(queueOf(install, note)).map((i) => i.type), [INTENT_TYPE.EQUIPMENT_INSTALL]);
  });

  test("the order is TOTAL — identical timestamps still sort reproducibly", () => {
    const a = intent(INTENT_TYPE.NOTE_ADD, { captureKey: "a", createdAtLocal: 5 });
    const b = intent(INTENT_TYPE.NOTE_ADD, { captureKey: "b", createdAtLocal: 5 });
    assert.deepEqual(readyIntents(queueOf(a, b)).map((i) => i.intentId), readyIntents(queueOf(b, a)).map((i) => i.intentId));
  });

  test("backoff removes an intent from the ready set until its time comes", () => {
    const failed = applyFailure(intent(INTENT_TYPE.NOTE_ADD), { code: "unavailable", at: 1000 });
    const q = queueOf(failed);
    assert.equal(readyIntents(q, 1000).length, 0);
    assert.equal(evaluateIntent(failed, q, 1000).reason, HOLD_REASON.BACKOFF);
    assert.equal(readyIntents(q, 1000 + nextBackoffMillis(1)).length, 1);
  });
});

describe("queue housekeeping", () => {
  test("enqueueing the same act twice records it once", () => {
    const i = intent(INTENT_TYPE.LABOR_RECORD);
    assert.equal(queueOf(i, i).length, 1);
  });

  test("pruning forgets successes and KEEPS refusals", () => {
    const ok = intent(INTENT_TYPE.NOTE_ADD, { captureKey: "a" });
    const bad = applyFailure(intent(INTENT_TYPE.NOTE_ADD, { captureKey: "b" }), { code: "permission-denied" });
    const pruned = pruneSynced(markSynced(queueOf(ok, bad), ok.intentId));
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0].state, "REFUSED");
  });

  test("the summary never hides a refusal inside a pending count", () => {
    const s = summarizeQueue(queueOf(
      intent(INTENT_TYPE.NOTE_ADD, { captureKey: "a" }),
      applyFailure(intent(INTENT_TYPE.LABOR_RECORD, { captureKey: "b" }), { code: "permission-denied" }),
    ));
    assert.equal(s.pending, 1);
    assert.equal(s.refused, 1);
    assert.equal(s.attentionCount, 1);
    assert.equal(s.unsynced, 2);
  });

  test("DIAGNOSTICS CARRY NO PAYLOAD — support gets shape, never customer data", () => {
    const i = makeIntent({
      type: INTENT_TYPE.NOTE_ADD, workOrderId: WO, principalUid: UID, captureKey: "k",
      payload: { executionNote: "Acme Foods, 14 Mill Street, unit serial TL-99812" },
    }).value;
    const dump = JSON.stringify(diagnosticView(queueOf(i)));
    assert.ok(!dump.includes("Acme"), "no customer name");
    assert.ok(!dump.includes("Mill Street"), "no site address");
    assert.ok(!dump.includes("TL-99812"), "no serial");
    assert.ok(dump.includes(i.intentId), "but the id support needs IS there");
  });
});

// =====================================================================================
// 3 — FAILURE CLASSIFICATION
// =====================================================================================

describe("failure classification", () => {
  test("the four classes land where they should", () => {
    assert.equal(classifyFailure({ code: "unavailable" }), FAILURE_CLASS.RETRYABLE);
    assert.equal(classifyFailure({ code: "internal" }), FAILURE_CLASS.RETRYABLE);
    assert.equal(classifyFailure({ code: "permission-denied" }), FAILURE_CLASS.REFUSED);
    assert.equal(classifyFailure({ code: "unauthenticated" }), FAILURE_CLASS.REFUSED);
    assert.equal(classifyFailure({ code: "invalid-argument" }), FAILURE_CLASS.REFUSED);
    assert.equal(classifyFailure({ code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE" }), FAILURE_CLASS.CONFLICT);
    assert.equal(classifyFailure({ code: "failed-precondition", details: "IDEMPOTENCY_CONFLICT" }), FAILURE_CLASS.NEEDS_ATTENTION);
  });

  test("OFFLINE IS NEVER A REFUSAL — nobody said no", () => {
    assert.equal(classifyFailure({ code: "permission-denied", offline: true }), FAILURE_CLASS.RETRYABLE);
  });

  test("the functions/ prefix is stripped, so a wrapped code is not misread as unknown", () => {
    assert.equal(classifyFailure({ code: "functions/permission-denied" }), FAILURE_CLASS.REFUSED);
  });

  test("anything unrecognized is retried — losing work is worse than one wasted request", () => {
    assert.equal(classifyFailure({ code: "something-new" }), FAILURE_CLASS.RETRYABLE);
  });

  test("RETRY IS BOUNDED, and exhaustion is not re-labelled as a refusal", () => {
    let i = intent(INTENT_TYPE.NOTE_ADD);
    for (let n = 0; n < MAX_ATTEMPTS; n += 1) i = applyFailure(i, { code: "unavailable", at: n * 1000 });
    assert.equal(i.attemptCount, MAX_ATTEMPTS);
    assert.equal(i.state, "NEEDS_ATTENTION", "stopped, and a person is asked");
    assert.notEqual(i.state, "REFUSED", "the server never refused it — we stopped asking");
  });

  test("backoff grows and is capped", () => {
    assert.ok(nextBackoffMillis(1) < nextBackoffMillis(3));
    assert.equal(nextBackoffMillis(50), nextBackoffMillis(99));
    assert.ok(nextBackoffMillis(99) <= 5 * 60_000);
  });

  test("a person can put a stopped intent back in play", () => {
    const dead = applyFailure(intent(INTENT_TYPE.NOTE_ADD), { code: "permission-denied", at: 10 });
    const back = retryIntent(queueOf(dead), dead.intentId, 50)[0];
    assert.equal(back.state, "PENDING_SYNC");
    assert.equal(back.attemptCount, 0);
  });
});

// =====================================================================================
// 4 — THE DURABLE STORE
// =====================================================================================

/** A localStorage stand-in. The real Storage contract, so the adapter is exercised as written. */
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

describe("the durable store", () => {
  test("a queue survives a restart", async () => {
    const storage = fakeStorage();
    const store = createIntentStore({ adapter: localStorageAdapter(storage) });
    const i = intent(INTENT_TYPE.LABOR_RECORD);
    assert.deepEqual(await store.save(UID, { intents: [i] }, 100), { durable: true, reason: null });

    // A brand-new store object over the same storage — the app was closed and reopened.
    const reopened = createIntentStore({ adapter: localStorageAdapter(storage) });
    const loaded = await reopened.load(UID);
    assert.equal(loaded.outcome, LOAD_OUTCOME.LOADED);
    assert.equal(loaded.record.intents.length, 1);
    assert.equal(loaded.record.intents[0].intentId, i.intentId);
    assert.equal(loaded.record.intents[0].state, "PENDING_SYNC");
  });

  test("CROSS-USER ISOLATION — a second login cannot see the first person's work", async () => {
    const storage = fakeStorage();
    const store = createIntentStore({ adapter: localStorageAdapter(storage) });
    await store.save(UID, { intents: [intent(INTENT_TYPE.LABOR_RECORD)] }, 1);

    const other = await store.load("uid-someone-else");
    assert.equal(other.outcome, LOAD_OUTCOME.EMPTY);
    assert.equal(other.record.intents.length, 0);

    // And the first person's work is STILL THERE — it was not adopted and it was not destroyed.
    assert.equal((await store.load(UID)).record.intents.length, 1);
  });

  test("a record stored under a foreign principal is refused, never adopted", async () => {
    const storage = fakeStorage();
    // Somebody else's record sitting under this uid's key: refused rather than sent as ours.
    storage.setItem(`eos.tech.offline/${UID}`, JSON.stringify({
      schemaVersion: SCHEMA_VERSION, principalUid: "uid-intruder", intents: [intent(INTENT_TYPE.NOTE_ADD)], cache: {},
    }));
    const loaded = await createIntentStore({ adapter: localStorageAdapter(storage) }).load(UID);
    assert.equal(loaded.outcome, LOAD_OUTCOME.FOREIGN_PRINCIPAL);
    assert.equal(loaded.record.intents.length, 0);
    assert.ok(storage.getItem(`eos.tech.offline/${UID}`), "and it is left on the device, not deleted");
  });

  test("SCHEMA MIGRATION V1 -> V2 PRESERVES PENDING INTENTS", async () => {
    const storage = fakeStorage();
    const pending = intent(INTENT_TYPE.LABOR_RECORD);
    storage.setItem(`eos.tech.offline/${UID}`, JSON.stringify({
      schemaVersion: 1, principalUid: UID, intents: [pending], cache: {},
    }));
    const store = createIntentStore({
      adapter: localStorageAdapter(storage),
      targetVersion: 2,
      migrations: {
        1: (record) => ({
          ...record, schemaVersion: 2,
          intents: record.intents.map((i) => ({ ...i, migratedField: "added-in-v2" })),
        }),
      },
    });
    const loaded = await store.load(UID);
    assert.equal(loaded.outcome, LOAD_OUTCOME.LOADED);
    assert.equal(loaded.record.schemaVersion, 2);
    assert.equal(loaded.record.intents.length, 1, "FIELD WORK IS NOT STRANDED BY AN APP UPDATE");
    assert.equal(loaded.record.intents[0].intentId, pending.intentId);
    assert.equal(loaded.record.intents[0].state, "PENDING_SYNC");
    assert.equal(loaded.record.intents[0].migratedField, "added-in-v2");
  });

  test("a record from a NEWER build is left alone, never downgraded", async () => {
    const storage = fakeStorage();
    storage.setItem(`eos.tech.offline/${UID}`, JSON.stringify({
      schemaVersion: 99, principalUid: UID, intents: [intent(INTENT_TYPE.NOTE_ADD)], cache: {},
    }));
    const loaded = await createIntentStore({ adapter: localStorageAdapter(storage) }).load(UID);
    assert.equal(loaded.outcome, LOAD_OUTCOME.FUTURE_SCHEMA);
    assert.ok(storage.getItem(`eos.tech.offline/${UID}`), "still on the device");
  });

  test("a missing migration is a refusal, not a silent data loss", async () => {
    const storage = fakeStorage();
    storage.setItem(`eos.tech.offline/${UID}`, JSON.stringify({
      schemaVersion: 1, principalUid: UID, intents: [intent(INTENT_TYPE.NOTE_ADD)], cache: {},
    }));
    const loaded = await createIntentStore({
      adapter: localStorageAdapter(storage), targetVersion: 3, migrations: {},
    }).load(UID);
    assert.equal(loaded.outcome, LOAD_OUTCOME.CORRUPT);
  });

  test("corrupt storage reports CORRUPT rather than an empty queue", async () => {
    const storage = fakeStorage();
    storage.setItem(`eos.tech.offline/${UID}`, "{not json");
    assert.equal((await createIntentStore({ adapter: localStorageAdapter(storage) }).load(UID)).outcome, LOAD_OUTCOME.CORRUPT);
  });

  test("A FAILED SAVE IS REPORTED — never a silent loss dressed as Pending sync", async () => {
    const store = createIntentStore({ adapter: localStorageAdapter(fakeStorage({ failOn: "quota" })) });
    const result = await store.save(UID, { intents: [intent(INTENT_TYPE.LABOR_RECORD)] });
    assert.equal(result.durable, false);
    assert.equal(result.reason, "quota_exceeded");
  });

  test("memory storage admits it is not durable", async () => {
    const store = createIntentStore({ adapter: memoryAdapter() });
    assert.equal(store.durable, false);
    assert.equal((await store.save(UID, { intents: [] })).reason, "storage_not_durable");
  });

  test("adapter selection prefers durability and falls back rather than throwing", () => {
    assert.equal(selectAdapter({ localStorage: fakeStorage() }).kind, "localStorage");
    assert.equal(selectAdapter({}).kind, "memory");
    // Safari private mode: localStorage exists and throws on write. Must not be chosen.
    assert.equal(selectAdapter({ localStorage: fakeStorage({ failOn: "quota" }) }).kind, "memory");
  });

  test("cache entries carry provenance, and only allowed kinds exist", () => {
    const ok = cacheEntry({ kind: CACHE_KIND.WORK_ORDER, serverId: WO, data: {}, fetchedAt: 900, source: "fieldops_wos" });
    assert.equal(ok.valid, true);
    assert.equal(ok.value.fetchedAt, 900);
    assert.equal(ok.value.serverVersion, null, "null is an honest answer where no version exists");
    assert.equal(cacheEntry({ kind: "ALL_CUSTOMERS", serverId: "x" }).reason, "unknown_cache_kind");
  });
});

// =====================================================================================
// 5 — THE EXECUTOR
// =====================================================================================

/** A recording command. Counts calls, so a duplicate business effect cannot hide. */
function recorder(outcome = { ok: true, serverIds: { id: "srv1" } }) {
  const calls = [];
  const fn = async (intentArg) => { calls.push(intentArg); return typeof outcome === "function" ? outcome(intentArg, calls) : outcome; };
  fn.calls = calls;
  return fn;
}

const allCommands = (fn) => Object.fromEntries(Object.values(INTENT_TYPE).map((t) => [t, fn]));

describe("the executor", () => {
  test("no session means nothing is sent — there is no authority to send under", async () => {
    const cmd = recorder();
    const r = await runSyncPass(queueOf(intent(INTENT_TYPE.NOTE_ADD)), {
      principalUid: UID, deps: { session: () => null, commands: allCommands(cmd) },
    });
    assert.equal(r.outcome, PASS_OUTCOME.NO_SESSION);
    assert.equal(cmd.calls.length, 0);
  });

  test("A DIFFERENT USER'S SESSION NEVER SENDS THIS QUEUE", async () => {
    const cmd = recorder();
    const r = await runSyncPass(queueOf(intent(INTENT_TYPE.LABOR_RECORD)), {
      principalUid: UID, deps: { session: () => ({ uid: "uid-somebody-else" }), commands: allCommands(cmd) },
    });
    assert.equal(r.outcome, PASS_OUTCOME.PRINCIPAL_MISMATCH);
    assert.equal(cmd.calls.length, 0, "not one request under the wrong principal");
  });

  test("a successful send records what the server created", async () => {
    const q = queueOf(intent(INTENT_TYPE.EQUIPMENT_INSTALL));
    const r = await runSyncPass(q, {
      principalUid: UID,
      deps: { session: okSession, commands: allCommands(recorder({ ok: true, serverIds: { equipmentId: "eq-77" } })) },
    });
    assert.equal(r.queue[0].state, "SYNCED");
    assert.deepEqual(r.queue[0].resultingServerIds, { equipmentId: "eq-77" });
  });

  test("AUTHORITY REVOKED BEFORE RECONNECT — refused, and nothing mutates", async () => {
    // Captured while authorized. By the time it syncs, the capability is gone.
    const cmd = recorder({ ok: false, code: "permission-denied", details: "PERMISSION_DENIED" });
    const q = queueOf(intent(INTENT_TYPE.LABOR_RECORD));
    const r = await runSyncPass(q, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    assert.equal(r.queue[0].state, "REFUSED");
    assert.equal(r.sent, 0);
    assert.equal(cmd.calls.length, 1, "asked once");

    // AND IT IS NOT RETRIED FOREVER: a refusal is terminal without a person.
    const again = await runSyncPass(r.queue, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
    assert.equal(again.outcome, PASS_OUTCOME.NOTHING_READY);
    assert.equal(cmd.calls.length, 1, "still once");
  });

  test("WORK ORDER REASSIGNED — the server's ownership wins over a stale cache", async () => {
    const cmd = recorder();
    const precheck = async () => ({ proceed: false, code: "permission-denied", details: "NOT_ASSIGNED_TECHNICIAN" });
    const r = await runSyncPass(queueOf(intent(INTENT_TYPE.WORK_ORDER_COMPLETE)), {
      principalUid: UID,
      deps: {
        session: okSession, commands: allCommands(cmd),
        prechecks: { [INTENT_TYPE.WORK_ORDER_COMPLETE]: precheck },
      },
    });
    assert.equal(cmd.calls.length, 0, "a job that is not mine is never even attempted");
    assert.equal(r.queue[0].state, "CONFLICT");
    assert.equal(r.queue[0].lastServerError.details, "NOT_ASSIGNED_TECHNICIAN");
  });

  test("A LOST RESPONSE RECONCILES — an already-COMPLETED job is not transitioned twice", async () => {
    const cmd = recorder();
    const r = await runSyncPass(queueOf(intent(INTENT_TYPE.WORK_ORDER_COMPLETE)), {
      principalUid: UID,
      deps: {
        session: okSession, commands: allCommands(cmd),
        prechecks: {
          [INTENT_TYPE.WORK_ORDER_COMPLETE]: async () => ({
            alreadySatisfied: true, serverIds: { workOrderId: WO, status: "COMPLETED" },
          }),
        },
      },
    });
    assert.equal(cmd.calls.length, 0, "transitionWorkOrder is NOT idempotent — it must not be called again");
    assert.equal(r.queue[0].state, "SYNCED");
    assert.equal(r.queue[0].resultingServerIds.status, "COMPLETED");
  });

  test("a thrown transport error is unreachable, not refused", async () => {
    const boom = async () => { const e = new Error("network down"); e.code = "unavailable"; throw e; };
    const r = await runSyncPass(queueOf(intent(INTENT_TYPE.NOTE_ADD)), {
      principalUid: UID, deps: { session: okSession, commands: allCommands(boom), now: () => 1000 },
    });
    assert.equal(r.queue[0].state, "PENDING_SYNC", "still ours to send");
    assert.equal(r.queue[0].lastServerError.offline, true);
    assert.ok(r.queue[0].nextEligibleAt > 1000, "and it waits before trying again");
  });

  test("an intent type with no bound command goes to a person, never silently vanishes", async () => {
    const r = await runSyncPass(queueOf(intent(INTENT_TYPE.PARTS_USAGE)), {
      principalUid: UID, deps: { session: okSession, commands: {} },
    });
    assert.equal(r.queue[0].lastServerError.details, "NO_COMMAND_BOUND");
    assert.notEqual(r.queue[0].state, "SYNCED");
  });

  test("a precheck may RESOLVE a scanned serial, and the resolution is kept", async () => {
    const cmd = recorder();
    const install = captureInstall({
      workOrderId: WO, principalUid: UID, rawScannedSerial: "TL-99812", captureKey: "scan-1",
    }).value;
    const r = await runSyncPass(queueOf(install), {
      principalUid: UID,
      deps: {
        session: okSession, commands: allCommands(cmd),
        prechecks: { [INTENT_TYPE.EQUIPMENT_INSTALL]: async () => ({ proceed: true, resolve: { serializedAssetId: "sa-1" } }) },
      },
    });
    assert.equal(cmd.calls[0].payload.serializedAssetId, "sa-1", "the command receives the resolved asset");
    assert.deepEqual(r.queue[0].resolvedBySync, { serializedAssetId: "sa-1" });
  });

  test("prechecks and commands are given the CURRENT session, every pass", async () => {
    const seen = [];
    const cmd = async (_i, ctx) => { seen.push(ctx.sessionUid); return { ok: true }; };
    await runSyncPass(queueOf(intent(INTENT_TYPE.NOTE_ADD)), {
      principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) },
    });
    assert.deepEqual(seen, [UID]);
  });

  test("a failing refreshAuthority does not stop the pass — the server decides anyway", async () => {
    const cmd = recorder();
    const r = await runSyncPass(queueOf(intent(INTENT_TYPE.NOTE_ADD)), {
      principalUid: UID,
      deps: { session: okSession, commands: allCommands(cmd), refreshAuthority: async () => { throw new Error("no"); } },
    });
    assert.equal(r.queue[0].state, "SYNCED");
  });
});

describe("isolation between work orders", () => {
  test("ONE CONFLICTED JOB DOES NOT BLOCK AN UNRELATED ONE", async () => {
    const good = intent(INTENT_TYPE.LABOR_RECORD, { workOrderId: "wo-good", captureKey: "g" });
    const badInstall = intent(INTENT_TYPE.EQUIPMENT_INSTALL, { workOrderId: "wo-bad", captureKey: "bi" });
    const badComplete = intent(INTENT_TYPE.WORK_ORDER_COMPLETE, {
      workOrderId: "wo-bad", captureKey: "bc", dependsOn: [{ intentId: badInstall.intentId, required: true }],
    });

    const commands = {
      ...allCommands(recorder()),
      [INTENT_TYPE.EQUIPMENT_INSTALL]: recorder({ ok: false, code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE" }),
    };
    const r = await drainQueue(queueOf(good, badInstall, badComplete), {
      principalUid: UID, deps: { session: okSession, commands },
    });
    const state = (id) => r.queue.find((i) => i.intentId === id).state;
    assert.equal(state(good.intentId), "SYNCED", "the healthy job went through");
    assert.equal(state(badInstall.intentId), "CONFLICT");
    assert.equal(state(badComplete.intentId), "PENDING_SYNC", "held, not sent, not lost");
    assert.equal(r.summary.attentionCount, 1);
  });
});

describe("connectivity", () => {
  test("navigator.onLine is a hint, and its absence is not treated as offline", () => {
    assert.deepEqual(connectivityHint(undefined), { likelyOnline: true, known: false });
    assert.deepEqual(connectivityHint({ onLine: false }), { likelyOnline: false, known: true });
  });

  test("a device that knows it is offline does not attempt; anything else tries", () => {
    const q = queueOf(intent(INTENT_TYPE.NOTE_ADD));
    assert.equal(shouldAttemptSync(q, { hint: { likelyOnline: false } }).attempt, false);
    assert.equal(shouldAttemptSync(q, { hint: { likelyOnline: true } }).attempt, true);
    // A captive portal reports online and resolves nothing. We try, and the request answers.
    assert.equal(shouldAttemptSync(q, { hint: { likelyOnline: true, known: true } }).attempt, true);
  });

  test("an empty queue is not a reason to open a connection", () => {
    assert.equal(shouldAttemptSync(Object.freeze([])).attempt, false);
  });
});

// =====================================================================================
// 6 — IDEMPOTENCY, RESTART, FLAPPING, AND THE FLAGSHIP
// =====================================================================================

describe("no duplicate business effects", () => {
  for (const type of Object.values(INTENT_TYPE)) {
    test(`${type}: retrying produces ONE effect`, async () => {
      const cmd = recorder();
      const q = queueOf(intent(type, { captureKey: "once" }));
      const first = await runSyncPass(q, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
      // Every subsequent pass, forever: a SYNCED intent is never sendable again.
      const second = await runSyncPass(first.queue, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
      const third = await drainQueue(second.queue, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) } });
      assert.equal(cmd.calls.length, 1, `${type} must reach the server exactly once`);
      assert.equal(third.queue[0].state, "SYNCED");
    });
  }

  test("the SAME idempotency key travels on every attempt of one act", async () => {
    const keys = [];
    let attempt = 0;
    const cmd = async (i) => {
      keys.push(i.payload.idempotencyKey);
      attempt += 1;
      return attempt === 1 ? { ok: false, code: "unavailable" } : { ok: true };
    };
    const labor = captureLabor({
      workOrderId: WO, principalUid: UID, laborType: "ONSITE", durationMinutes: 90,
      workDate: "2026-08-23", captureKey: "tap", at: 0, offline: true,
    }).value;
    let q = queueOf(labor);
    q = (await runSyncPass(q, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), now: () => 0 } })).queue;
    // Past the backoff, the same act goes again — under the same key, so the server replays it.
    q = (await runSyncPass(q, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), now: () => 10 ** 7 } })).queue;
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1], "one act, one key");
    assert.equal(keys[0], labor.intentId);
    assert.equal(q[0].state, "SYNCED");
  });

  test("a server REPLAY is reported as success, because it is one", async () => {
    const r = await runSyncPass(queueOf(intent(INTENT_TYPE.LABOR_RECORD)), {
      principalUid: UID,
      deps: { session: okSession, commands: allCommands(recorder({ ok: true, replayed: true, serverIds: { laborEntryId: "lab1" } })) },
    });
    assert.equal(r.queue[0].state, "SYNCED");
  });
});

describe("app restart", () => {
  for (const type of Object.values(INTENT_TYPE)) {
    test(`${type}: captured offline, survives a restart, syncs to exactly one effect`, async () => {
      const storage = fakeStorage();
      const cmd = recorder();

      // 1-2. offline, capture.
      const captured = intent(type, { captureKey: `restart-${type}` });
      const store = createIntentStore({ adapter: localStorageAdapter(storage) });
      const saved = await store.save(UID, { intents: [captured] }, 10);
      assert.equal(saved.durable, true, "the technician was told the truth about it being kept");

      // 3-5. the app closes and reopens, still offline. The intent is still there.
      const reopened = createIntentStore({ adapter: localStorageAdapter(storage) });
      const loaded = await reopened.load(UID);
      assert.equal(loaded.record.intents.length, 1);
      assert.equal(loaded.record.intents[0].state, "PENDING_SYNC");

      // 6-8. reconnect, sync, exactly one server effect.
      const r = await drainQueue(loaded.record.intents, {
        principalUid: UID, deps: { session: okSession, commands: allCommands(cmd) },
      });
      assert.equal(cmd.calls.length, 1);
      assert.equal(r.queue[0].state, "SYNCED");
    });
  }
});

describe("a flapping connection", () => {
  test("online -> offline -> weak -> online -> dropped mid-sync -> online: no duplicates, nothing lost", async () => {
    const attempts = [];
    // Fails the first two times it sees any intent, then succeeds. A genuinely bad link.
    const failures = new Map();
    const cmd = async (i) => {
      attempts.push(i.intentId);
      const n = (failures.get(i.intentId) ?? 0) + 1;
      failures.set(i.intentId, n);
      if (n <= 2) return { ok: false, code: "unavailable", offline: true };
      return { ok: true, serverIds: { id: `srv-${i.intentId}` } };
    };

    const a = intent(INTENT_TYPE.NOTE_ADD, { captureKey: "a" });
    const b = intent(INTENT_TYPE.PARTS_USAGE, { captureKey: "b" });
    const c = intent(INTENT_TYPE.LABOR_RECORD, { captureKey: "c" });
    let q = queueOf(a, b, c);

    // Six reconnections, each far enough apart to clear any backoff.
    let clock = 0;
    for (let round = 0; round < 6; round += 1) {
      clock += 60 * 60_000;
      const now = () => clock;
      q = (await drainQueue(q, { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), now } })).queue;
    }

    assert.equal(q.length, 3, "nothing lost");
    for (const i of q) assert.equal(i.state, "SYNCED", `${i.type} landed`);
    // Each intent was attempted three times (two failures, one success) and NEVER a fourth.
    for (const i of [a, b, c]) {
      assert.equal(attempts.filter((id) => id === i.intentId).length, 3, "no duplicate business effect");
    }
    assert.equal(hasUnsyncedWork(q), false);
  });

  test("an unsent action is NEVER marked synced when a pass is interrupted", async () => {
    // The command throws part-way through a batch. Whatever had not gone must still be pending.
    let n = 0;
    const cmd = async () => { n += 1; if (n === 2) throw new Error("connection dropped"); return { ok: true }; };
    const r = await drainQueue(queueOf(
      intent(INTENT_TYPE.NOTE_ADD, { captureKey: "1" }),
      intent(INTENT_TYPE.PARTS_USAGE, { captureKey: "2" }),
      intent(INTENT_TYPE.LABOR_RECORD, { captureKey: "3" }),
    ), { principalUid: UID, deps: { session: okSession, commands: allCommands(cmd), now: () => 1 } });

    const dropped = r.queue.find((i) => i.type === INTENT_TYPE.PARTS_USAGE);
    assert.equal(dropped.state, "PENDING_SYNC", "not synced — we were never told it landed");
    assert.notEqual(dropped.state, "SYNCED");
  });
});

describe("THE FLAGSHIP — one install job, five intents, one reconnection", () => {
  test("note, labor, parts, install, complete: ordered, dependent, exact", async () => {
    const order = [];
    const commands = Object.fromEntries(Object.values(INTENT_TYPE).map((t) => [t, async (i) => {
      order.push(i.type);
      return { ok: true, serverIds: t === INTENT_TYPE.EQUIPMENT_INSTALL ? { equipmentId: "eq-1" } : { id: "srv" } };
    }]));

    // The technician's afternoon, in a plant room with no signal.
    let q = Object.freeze([]);
    q = enqueueIntent(q, captureNote({ workOrderId: WO, principalUid: UID, text: "Old unit drained and removed.", captureKey: "n1", at: 100, offline: true }).value);
    q = enqueueIntent(q, captureLabor({ workOrderId: WO, principalUid: UID, laborType: "ONSITE", durationMinutes: 180, workDate: "2026-08-23", captureKey: "l1", at: 200, offline: true }).value);
    q = enqueueIntent(q, capturePartsUsage({ workOrderId: WO, principalUid: UID, sku: "TS-4410", delta: 2, provenance: "SCAN", captureKey: "p1", at: 300, offline: true }).value);
    q = enqueueIntent(q, captureInstall({ workOrderId: WO, principalUid: UID, serializedAssetId: "sa-9", captureKey: "i1", at: 400, offline: true }).value);
    // Completion is captured LAST and derives its dependencies from the queue as it stands.
    q = enqueueIntent(q, captureComplete({ workOrderId: WO, principalUid: UID, queue: q, captureKey: "c1", at: 500, offline: true }).value);

    assert.equal(q.length, 5);
    const complete = q.find((i) => i.type === INTENT_TYPE.WORK_ORDER_COMPLETE);
    assert.equal(complete.dependsOn.length, 4);
    assert.equal(complete.dependsOn.filter((d) => d.required).length, 1, "only the installation is a requirement");

    // Nothing on the device ever claimed the job was done.
    for (const i of q) assert.equal(i.state, "PENDING_SYNC");

    const r = await drainQueue(q, { principalUid: UID, deps: { session: okSession, commands, now: () => 10_000 } });

    // EVERY ONE LANDED, EXACTLY ONCE, IN THE ONLY ORDER THAT KEEPS THEM ALL POSSIBLE.
    assert.deepEqual(order, [
      INTENT_TYPE.NOTE_ADD,
      INTENT_TYPE.PARTS_USAGE,
      INTENT_TYPE.LABOR_RECORD,
      INTENT_TYPE.EQUIPMENT_INSTALL,
      INTENT_TYPE.WORK_ORDER_COMPLETE,
    ]);
    assert.equal(r.sent, 5);
    for (const i of r.queue) assert.equal(i.state, "SYNCED", `${i.type} must have landed`);
    assert.equal(r.queue.find((i) => i.type === INTENT_TYPE.EQUIPMENT_INSTALL).resultingServerIds.equipmentId, "eq-1");
  });

  test("IF THE INSTALLATION IS REFUSED, THE JOB DOES NOT COMPLETE", async () => {
    const order = [];
    const commands = Object.fromEntries(Object.values(INTENT_TYPE).map((t) => [t, async (i) => {
      order.push(i.type);
      return t === INTENT_TYPE.EQUIPMENT_INSTALL
        ? { ok: false, code: "failed-precondition", details: "ASSET_INSTALLED_ELSEWHERE" }
        : { ok: true };
    }]));

    let q = Object.freeze([]);
    q = enqueueIntent(q, captureLabor({ workOrderId: WO, principalUid: UID, laborType: "ONSITE", durationMinutes: 120, workDate: "2026-08-23", captureKey: "l", at: 1, offline: true }).value);
    q = enqueueIntent(q, captureInstall({ workOrderId: WO, principalUid: UID, serializedAssetId: "sa-9", captureKey: "i", at: 2, offline: true }).value);
    q = enqueueIntent(q, captureComplete({ workOrderId: WO, principalUid: UID, queue: q, captureKey: "c", at: 3, offline: true }).value);

    const r = await drainQueue(q, { principalUid: UID, deps: { session: okSession, commands, now: () => 10_000 } });

    assert.ok(!order.includes(INTENT_TYPE.WORK_ORDER_COMPLETE), "Complete was NEVER SENT");
    assert.equal(r.queue.find((i) => i.type === INTENT_TYPE.LABOR_RECORD).state, "SYNCED", "the hours were still saved");
    assert.equal(r.queue.find((i) => i.type === INTENT_TYPE.EQUIPMENT_INSTALL).state, "CONFLICT");
    assert.equal(r.queue.find((i) => i.type === INTENT_TYPE.WORK_ORDER_COMPLETE).state, "PENDING_SYNC");
    assert.equal(hasUnsyncedWork(r.queue), true);
  });

  test("labor is sent BEFORE completion, because afterwards it becomes impossible", async () => {
    // The real constraint: recordWorkOrderLabor refuses a Work Order that has left execution.
    let completed = false;
    const commands = {
      ...allCommands(recorder()),
      [INTENT_TYPE.LABOR_RECORD]: async () => (completed
        ? { ok: false, code: "failed-precondition", details: "WORK_ORDER_STATE_INVALID" }
        : { ok: true }),
      [INTENT_TYPE.WORK_ORDER_COMPLETE]: async () => { completed = true; return { ok: true }; },
    };
    let q = Object.freeze([]);
    q = enqueueIntent(q, captureLabor({ workOrderId: WO, principalUid: UID, laborType: "TRAVEL", durationMinutes: 45, workDate: "2026-08-23", captureKey: "l", at: 1, offline: true }).value);
    q = enqueueIntent(q, captureComplete({ workOrderId: WO, principalUid: UID, queue: q, captureKey: "c", at: 2, offline: true }).value);

    const r = await drainQueue(q, { principalUid: UID, deps: { session: okSession, commands, now: () => 5 } });
    assert.equal(r.queue.find((i) => i.type === INTENT_TYPE.LABOR_RECORD).state, "SYNCED", "the technician's hours were not stranded");
    assert.equal(r.queue.find((i) => i.type === INTENT_TYPE.WORK_ORDER_COMPLETE).state, "SYNCED");
  });
});

// =====================================================================================
// SCANNING WITH NO SIGNAL
// =====================================================================================

describe("offline scanning", () => {
  test("NEEDS_ONLINE_RESOLUTION IS NOT NOT-FOUND", () => {
    const r = classifyOfflineScan({ raw: "TS-4410", lookup: () => null, online: false });
    assert.equal(r.resolution, OFFLINE_SCAN.NEEDS_ONLINE_RESOLUTION);
    assert.notEqual(r.resolution, OFFLINE_SCAN.SERVER_NOT_FOUND);
    assert.equal(r.token, "TS-4410", "and the raw identifier is kept");
  });

  test("the same scan, online and unmatched, IS not-found", () => {
    assert.equal(classifyOfflineScan({ raw: "TS-4410", lookup: () => null, online: true }).resolution, OFFLINE_SCAN.SERVER_NOT_FOUND);
  });

  test("a cached match is offered, and flagged stale", () => {
    const r = classifyOfflineScan({ raw: "TS-4410", lookup: () => ({ sku: "TS-4410", name: "Seal kit" }), online: false });
    assert.equal(r.resolution, OFFLINE_SCAN.KNOWN_FROM_CACHE);
    assert.equal(r.stale, true);
  });

  test("only an unreadable token is judged locally", () => {
    assert.equal(classifyOfflineScan({ raw: "   " }).resolution, OFFLINE_SCAN.INVALID_FORMAT);
    assert.equal(classifyOfflineScan({ raw: "" }).resolution, OFFLINE_SCAN.INVALID_FORMAT);
  });

  test("an unresolved scan is never a business action", () => {
    // An install intent may carry a raw serial, but the command refuses to act on one.
    const i = captureInstall({ workOrderId: WO, principalUid: UID, rawScannedSerial: "TL-1", captureKey: "s" });
    assert.equal(i.valid, true);
    assert.equal(i.value.payload.serializedAssetId, null, "not an asset — a claim about one");
  });

  test("an install with no identity at all is refused outright", () => {
    assert.equal(captureInstall({ workOrderId: WO, principalUid: UID, captureKey: "s" }).reason, "asset_identity_required");
  });
});

describe("the device clock", () => {
  test("an OFFLINE capture claims a device time; an ONLINE one claims nothing", () => {
    const off = captureLabor({ workOrderId: WO, principalUid: UID, laborType: "ONSITE", durationMinutes: 60, workDate: "2026-08-23", captureKey: "a", at: 1234, offline: true });
    const on = captureLabor({ workOrderId: WO, principalUid: UID, laborType: "ONSITE", durationMinutes: 60, workDate: "2026-08-23", captureKey: "b", at: 1234, offline: false });
    assert.equal(off.value.deviceReportedAtMillis, 1234);
    assert.equal(off.value.payload.deviceReportedAtMillis, 1234);
    assert.equal(on.value.deviceReportedAtMillis, null);
    assert.equal(on.value.payload.deviceReportedAtMillis, undefined, "no claim where the server's clock is authoritative");
  });

  test("offline labor is a DURATION, never a fabricated interval", () => {
    const l = captureLabor({ workOrderId: WO, principalUid: UID, laborType: "ONSITE", durationMinutes: 90, workDate: "2026-08-23", captureKey: "x", at: 1, offline: true });
    assert.equal(l.value.payload.entryKind, "DURATION");
    assert.equal(l.value.payload.startedAtMillis, undefined);
    assert.equal(l.value.payload.endedAtMillis, undefined);
  });
});
