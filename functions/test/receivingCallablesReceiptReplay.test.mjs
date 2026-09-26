// CONNECTED regression: an EXACT RETRY of a committed receipt must REPLAY, never be refused.
//
// DEFECT (pre-fix, found by lane S1 and pinned there as "case B"): receiveInventoryStockCommand
// validated the request's quantities (remaining-to-receive), its expectedVersion and the PO's
// receivable status against the state AFTER the first receipt committed, and only THEN resolved
// whether this request's receipt id already existed. So the Multi-Scan screen's exact retry (which
// always carries expectedVersion), or any retry of a receipt that filled a line or completed the PO,
// was refused failed-precondition instead of returning `replayed`. No duplicate was ever written, but
// the client treats the refusal as a failure and the operator is told a committed receipt failed.
//
// FIX: receipt identity is derived and the existing receipt looked up FIRST (inside the
// transaction). A replay skips the status / version gates, and the committed-receipt derivation
// excludes the receipt being replayed, so the unchanged fingerprint check decides replay vs conflict.
//
// Driven through the EXPORTED handler runReceiveInventoryStock with the REAL composition, REAL
// governed permission resolver and REAL audit stager, and payloads built by the client's OWN scan
// queue + canonical request builder. Only Firestore is an in-memory fake -- this one with optimistic
// transaction semantics (read-set validated at commit; a conflicted transaction is re-run), so a
// concurrent duplicate behaves the way Firestore makes it behave.
//
// PURE of any emulator/network. Prerequisite: npm run build.
// Run: node --test test/receivingCallablesReceiptReplay.test.mjs
delete process.env.FIRESTORE_EMULATOR_HOST;
import test from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

admin.initializeApp({ projectId: "s1r-offline-receiving-replay" });

const { runReceiveInventoryStock } = await import("../lib/inventoryReceiving/receivingCallables.js");
const { resolveReceivePermissionThroughTxn, stageReceiveAuditEvent } = await import("../lib/inventoryReceiving/receivingCallableWiring.js");
const { receivingOrderDocId, canonicalReceivingOrderDocId } = await import("../lib/inventoryReceiving/receivingRepository.js");
const client = await import("../../field-ops-app-vite/src/domain/receivingTransport.js");
const scanQueue = await import("../../field-ops-app-vite/src/domain/receivingScanQueue.js");

// ------------------------------------------------- in-memory Firestore fake, optimistic transactions

function getPath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

function makeFakeDb(seed = {}) {
  const store = new Map(); // path -> data
  const versions = new Map(); // path -> monotonically increasing write counter
  for (const [path, data] of Object.entries(seed)) { store.set(path, { ...data }); versions.set(path, 1); }
  let autoId = 0;
  let committedWrites = 0;
  let attempts = 0;
  const docRef = (collection, id) => ({ id, path: `${collection}/${id}` });
  const query = (collection, wheres) => ({
    __query: true, collection, wheres,
    where(field, op, value) { assert.equal(op, "=="); return query(collection, [...wheres, { field, value }]); },
  });
  const matches = (q) => [...store.keys()]
    .filter((p) => p.startsWith(`${q.collection}/`) && p.split("/").length === 2)
    .filter((p) => q.wheres.every((w) => getPath(store.get(p), w.field) === w.value))
    .sort();
  const snapDoc = (path) => {
    const has = store.has(path);
    const data = has ? store.get(path) : undefined;
    return { exists: has, id: path.split("/").pop(), data: () => data };
  };
  const db = {
    collection(name) {
      return {
        doc: (id) => docRef(name, id ?? `auto${(autoId += 1)}`),
        where: (field, op, value) => query(name, []).where(field, op, value),
      };
    },
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        attempts += 1;
        const pending = [];
        const readDocs = new Map(); // path -> version seen (0 = absent)
        const readQueries = []; // { q, paths }
        const txn = {
          async get(target) {
            // Yield so two concurrent transactions genuinely interleave their reads.
            await new Promise((r) => setImmediate(r));
            if (target && target.__query) {
              const paths = matches(target);
              readQueries.push({ q: target, paths: paths.join("|") });
              for (const p of paths) readDocs.set(p, versions.get(p) ?? 0);
              const docs = paths.map((p) => snapDoc(p));
              return { docs, empty: docs.length === 0, size: docs.length };
            }
            readDocs.set(target.path, store.has(target.path) ? (versions.get(target.path) ?? 0) : 0);
            return snapDoc(target.path);
          },
          create(ref, data) { pending.push({ op: "create", path: ref.path, data }); return txn; },
          set(ref, data) { pending.push({ op: "set", path: ref.path, data }); return txn; },
          update(ref, data) { pending.push({ op: "update", path: ref.path, data }); return txn; },
        };
        // Any document read (or query result set) that changed since it was read makes this attempt's
        // view inconsistent. Firestore never lets a transaction act on such a view: it aborts and re-runs.
        const stale = () =>
          [...readDocs].some(([p, v]) => (store.has(p) ? (versions.get(p) ?? 0) : 0) !== v) ||
          readQueries.some(({ q, paths }) => matches(q).join("|") !== paths);
        let result;
        try {
          result = await fn(txn);
        } catch (err) {
          if (stale()) continue; // an error raised from an inconsistent view is a contention abort
          throw err;
        }
        // COMMIT (synchronous => atomic w.r.t. other transactions), after optimistic validation.
        if (stale()) continue;
        for (const w of pending) {
          if (w.op === "create" && store.has(w.path)) throw new Error(`ALREADY_EXISTS ${w.path}`);
          if (w.op === "update" && !store.has(w.path)) throw new Error(`NOT_FOUND ${w.path}`);
        }
        for (const w of pending) {
          store.set(w.path, w.op === "update" ? { ...store.get(w.path), ...w.data } : w.data);
          versions.set(w.path, (versions.get(w.path) ?? 0) + 1);
          committedWrites += 1;
        }
        return result;
      }
      throw new Error("ABORTED: too much contention");
    },
  };
  const count = (collection) => [...store.keys()].filter((p) => p.startsWith(`${collection}/`)).length;
  return { db, store, count, writes: () => committedWrites, attempts: () => attempts };
}

// ------------------------------------------------------------------ fixtures

const TS = Timestamp.fromMillis(1_700_000_000_000);
const NOW = new Date(1_700_000_000_000);
const LATER = new Date(1_700_000_600_000);
const ACTOR = "receiver-1";
const WH = "wh-1";
const PO = "po-canon-1";
const PART_NONE = "part-none";
const PART_SERIAL = "part-serial";
const PARTS = new Map([
  [PART_NONE, { partId: PART_NONE, trackingMode: "NONE", active: true }],
  [PART_SERIAL, { partId: PART_SERIAL, trackingMode: "SERIAL", active: true }],
  ["part-legacy", { partId: "part-legacy", trackingMode: "NONE", active: true }],
]);

function baseSeed() {
  return {
    [`warehouses/${WH}`]: { id: WH, name: "Main", location: "L", status: "ACTIVE", version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u" },
    [`purchase_orders/${PO}`]: {
      supplierId: "sup-1", status: "SENT",
      items: [
        { lineId: "L1", partId: PART_NONE, quantity: 5, unitPrice: 1 },
        { lineId: "L2", partId: PART_SERIAL, quantity: 2, unitPrice: 1 },
      ],
      totalCost: 7,
    },
    [`users/${ACTOR}`]: { accessVersion: 1 },
    "roleAssignments/ra-1": { principalUid: ACTOR, roleId: "admin", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 },
  };
}

function legacySeed() {
  return {
    ...baseSeed(),
    "reorder_purchase_orders/rr-1": {
      reorderRequestId: "rr-1", partId: "part-legacy", supplierName: "ACME", externalPoNumber: "PO-1",
      orderedQuantity: 4, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1,
    },
    "reorder_requests/rr-1": { partId: "part-legacy", status: "ORDERED", purchaseOrderId: "rr-1", receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1 },
  };
}

function wiringFor(fake, now = NOW) {
  return {
    db: fake.db,
    resolvePermission: (txn, actorId) => resolveReceivePermissionThroughTxn(txn, fake.db, actorId),
    resolvePart: async (_txn, partId) => PARTS.get(partId) ?? null,
    stageAudit: stageReceiveAuditEvent,
    now: () => now,
  };
}
const call = (fake, data, now = NOW) => runReceiveInventoryStock({ auth: { uid: ACTOR }, data }, wiringFor(fake, now));

const PROGRESS_0 = {
  version: 0,
  lines: [
    { lineId: "L1", partId: PART_NONE, trackingMode: "NONE", orderedQuantity: 5, receivedQuantity: 0, remainingQuantity: 5, state: "NOT_RECEIVED" },
    { lineId: "L2", partId: PART_SERIAL, trackingMode: "SERIAL", orderedQuantity: 2, receivedQuantity: 0, remainingQuantity: 2, state: "NOT_RECEIVED" },
  ],
};
const PROGRESS_1 = {
  version: 1,
  lines: [
    { ...PROGRESS_0.lines[0], receivedQuantity: 3, remainingQuantity: 2, state: "PARTIALLY_RECEIVED" },
    { ...PROGRESS_0.lines[1], receivedQuantity: 2, remainingQuantity: 0, state: "RECEIVED" },
  ],
};

// The wire payload EXACTLY as MultiScanReceiving.submit() + submitCanonicalReceive() build it.
function clientPayload({ scans, idempotencyKey, progress = PROGRESS_0 }) {
  let queue = scanQueue.createQueue();
  for (const s of scans) queue = scanQueue.addScan(queue, s);
  const lines = scanQueue.buildSubmissionLines(scanQueue.reconcile(queue, progress.lines));
  assert.ok(lines !== null, "client reconciliation must be submittable");
  const built = client.buildCanonicalReceiveRequest({
    source: { type: "PURCHASE_ORDER", purchaseOrderId: PO },
    receivingLocation: { type: "WAREHOUSE", locationId: WH },
    lines: lines.map((l) => ({ ...l })),
    idempotencyKey,
    expectedVersion: progress.version,
  });
  assert.ok(built !== null, "client builder must accept its own request");
  return JSON.parse(JSON.stringify(built));
}

// 3 x NONE on L1 (partial) + both serials on L2 (fills L2).
const PARTIAL_SCANS = [
  { partId: PART_NONE }, { partId: PART_NONE }, { partId: PART_NONE },
  { partId: PART_SERIAL, serialNo: "SN-1" }, { partId: PART_SERIAL, serialNo: "SN-2" },
];
// Everything on the order in one receipt.
const FULL_SCANS = [
  { partId: PART_NONE, quantity: 5 },
  { partId: PART_SERIAL, serialNo: "SN-1" }, { partId: PART_SERIAL, serialNo: "SN-2" },
];

const legacyReq = (over = {}) => ({
  source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "rr-1", purchaseOrderId: "rr-1" },
  receivingLocation: { type: "WAREHOUSE", locationId: WH },
  lines: [{ lineId: "client-line", partId: "part-legacy", expectedQuantity: 4, receivedQuantity: 4 }],
  idempotencyKey: "legacy-key-1",
  ...over,
});

async function expectCode(promise, code, label) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof HttpsError, `${label}: HttpsError, got ${e && e.name}: ${e && e.message}`);
    assert.equal(e.code, code, `${label}: code`);
    return true;
  });
}

// Deep snapshot of every document, so "zero new writes" means byte-identical state, not equal counts.
const snapshot = (fake) => new Map([...fake.store].map(([k, v]) => [k, JSON.stringify(v)]));
function assertUnchanged(fake, before, label) {
  assert.deepEqual([...fake.store.keys()].sort(), [...before.keys()].sort(), `${label}: document set unchanged`);
  for (const [k, v] of before) assert.equal(JSON.stringify(fake.store.get(k)), v, `${label}: ${k} unchanged`);
}

// Asserts the replay is the original answer: same receipt, same ledger id, same progress, same status.
function assertSameReceipt(replayed, original) {
  assert.equal(original.outcome, "applied");
  assert.equal(replayed.outcome, "replayed");
  const { outcome: _a, ...r } = replayed;
  const { outcome: _b, ...o } = original;
  assert.deepEqual(r, o, "replay returns the ORIGINAL result");
}

// ===================================================================== (a) canonical multi-line

test("(a) canonical multi-line: the screen's EXACT retry (same key, same payload incl. expectedVersion) REPLAYS", async () => {
  const fake = makeFakeDb(baseSeed());
  const payload = clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "key-a" });
  assert.equal(payload.expectedVersion, 0, "the screen always sends expectedVersion");
  const first = await call(fake, payload);
  const before = snapshot(fake);
  const writesBefore = fake.writes();

  const retry = await call(fake, payload, LATER); // a later clock must not matter
  assertSameReceipt(retry, first);
  const accepted = client.validateCanonicalReceiveResponse(retry);
  assert.ok(accepted !== null, `client must accept the replay (else the screen requeues): ${JSON.stringify(retry)}`);
  assert.equal(accepted.outcome, "replayed");

  assert.equal(fake.writes(), writesBefore, "zero writes on replay");
  assertUnchanged(fake, before, "replay");
  assert.equal(fake.count("receiving_orders"), 1);
  assert.equal(fake.count("inventory_transactions"), 3);
  assert.equal(fake.count("serialized_assets"), 2);
  assert.equal(fake.count("auditEvents"), 1, "no duplicate audit");
  assert.equal(fake.store.get(`purchase_orders/${PO}`).version, 1, "no version bump on replay");
});

// ===================================================================== (b) receipt that completes the PO

test("(b1) a retry of the receipt that COMPLETES the order (PO now RECEIVED, version moved) REPLAYS", async () => {
  const fake = makeFakeDb(baseSeed());
  await call(fake, clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "key-b-1" }));
  const completing = clientPayload({ scans: [{ partId: PART_NONE, quantity: 2 }], idempotencyKey: "key-b-2", progress: PROGRESS_1 });
  const first = await call(fake, completing);
  assert.equal(first.storedStatus, "RECEIVED");
  assert.equal(first.derivedState, "RECEIVED");
  assert.equal(fake.store.get(`purchase_orders/${PO}`).status, "RECEIVED");
  const before = snapshot(fake);
  const writesBefore = fake.writes();

  const retry = await call(fake, completing);
  assertSameReceipt(retry, first);
  assert.ok(client.validateCanonicalReceiveResponse(retry) !== null, "client accepts the replay");
  assert.equal(fake.writes(), writesBefore);
  assertUnchanged(fake, before, "completing replay");
  assert.equal(fake.count("auditEvents"), 2);

  // And the EARLIER receipt (key-b-1) also still replays after the order closed -- its progress is
  // reported against current committed state (the later receipt is counted as previously received
  // only for lines it touched; this receipt's own quantities are never double counted).
  const earlier = await call(fake, clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "key-b-1" }));
  assert.equal(earlier.outcome, "replayed");
  assert.deepEqual(earlier.lines.map((l) => [l.lineId, l.receivedNow, l.remainingQuantity]), [["L1", 3, 0], ["L2", 2, 0]]);
  assert.equal(fake.writes(), writesBefore);
});

test("(b2) a single receipt that receives the WHOLE order, retried exactly, REPLAYS", async () => {
  const fake = makeFakeDb(baseSeed());
  const payload = clientPayload({ scans: FULL_SCANS, idempotencyKey: "key-b-full" });
  const first = await call(fake, payload);
  assert.equal(first.storedStatus, "RECEIVED");
  const before = snapshot(fake);
  const retry = await call(fake, payload);
  assertSameReceipt(retry, first);
  assert.ok(client.validateCanonicalReceiveResponse(retry) !== null);
  assertUnchanged(fake, before, "full replay");
});

// ===================================================================== (c) legacy

test("(c) legacy REORDER_PURCHASE_ORDER exact retry after the reorder moved to RECEIVED REPLAYS (key-only id preserved)", async () => {
  const fake = makeFakeDb(legacySeed());
  const first = await call(fake, legacyReq());
  assert.equal(first.receivingId, receivingOrderDocId("legacy-key-1"), "legacy id = rcv_ + sha256(key) -- key ALONE");
  assert.equal(fake.store.get("reorder_requests/rr-1").status, "RECEIVED");
  const before = snapshot(fake);
  const writesBefore = fake.writes();
  const retry = await call(fake, legacyReq(), LATER);
  assert.deepEqual(Object.keys(retry).sort(), ["ledgerEventId", "outcome", "receivingId"], "legacy response stays 3 keys");
  assertSameReceipt(retry, first);
  assert.equal(fake.writes(), writesBefore);
  assertUnchanged(fake, before, "legacy replay");
});

// ===================================================================== pinned semantics

test("replay identity is the receipt id + fingerprint; expectedVersion is a pre-commit gate only", async () => {
  // The stored receipt does not record expectedVersion (it never did), so it is not part of the
  // fingerprint. A retry that re-read progress and now sends the post-commit version is the same
  // receipt and replays too.
  const fake = makeFakeDb(baseSeed());
  const payload = clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "key-v" });
  const first = await call(fake, payload);
  const retry = await call(fake, { ...payload, expectedVersion: 1 });
  assertSameReceipt(retry, first);
  assert.equal(first.receivingId, canonicalReceivingOrderDocId({
    operation: "receiveInventoryStock", sourceType: "PURCHASE_ORDER", purchaseOrderId: PO, actorId: ACTOR, idempotencyKey: "key-v",
  }), "canonical id derivation unchanged (target + actor scoped)");
});

// ===================================================================== negative proofs

test("NEGATIVE: same key with a DIFFERENT payload is still refused (idempotency conflict), zero writes", async () => {
  const fake = makeFakeDb(baseSeed());
  const payload = clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "key-n1" });
  await call(fake, payload);
  const before = snapshot(fake);
  const cases = [
    ["fewer units on L1", { ...payload, lines: [{ ...payload.lines[0], receivedQuantity: 2 }, payload.lines[1]] }],
    ["drops a line", { ...payload, lines: [payload.lines[0]] }],
    ["more than the order on L1", { ...payload, lines: [{ ...payload.lines[0], receivedQuantity: 6 }, payload.lines[1]] }],
    ["different serials", { ...payload, lines: [payload.lines[0], { ...payload.lines[1], serialNumbers: ["SN-8", "SN-9"] }] }],
  ];
  for (const [label, data] of cases) await expectCode(call(fake, data), "failed-precondition", label);
  assertUnchanged(fake, before, "conflicting reuse");
});

test("NEGATIVE: same key, different payload, after the order CLOSED is still refused", async () => {
  const fake = makeFakeDb(baseSeed());
  const payload = clientPayload({ scans: FULL_SCANS, idempotencyKey: "key-n1b" });
  await call(fake, payload);
  const before = snapshot(fake);
  await expectCode(call(fake, { ...payload, lines: [{ ...payload.lines[0], receivedQuantity: 4 }, payload.lines[1]] }), "failed-precondition", "changed payload on closed PO");
  assertUnchanged(fake, before, "closed-PO conflict");
});

test("NEGATIVE: a NEW key receiving more than remains is still refused; a NEW key on a closed PO is still refused", async () => {
  const fake = makeFakeDb(baseSeed());
  await call(fake, clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "key-n2-1" }));
  let before = snapshot(fake);
  await expectCode(call(fake, { ...clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "key-n2-2" }), expectedVersion: 1 }), "failed-precondition", "over remaining (L2 satisfied)");
  // The client would not build this (it reconciles against remaining), so it is hand-built: a caller
  // that bypasses the screen is still bound by the server-derived remaining.
  const over = clientPayload({ scans: [{ partId: PART_NONE, quantity: 2 }], idempotencyKey: "key-n2-3", progress: PROGRESS_1 });
  await expectCode(call(fake, { ...over, lines: [{ ...over.lines[0], receivedQuantity: 3 }] }), "failed-precondition", "3 of 2 remaining");
  await expectCode(call(fake, clientPayload({ scans: [{ partId: PART_NONE }], idempotencyKey: "key-n2-4" })), "failed-precondition", "stale expectedVersion under a new key");
  assertUnchanged(fake, before, "new-key refusals");

  await call(fake, clientPayload({ scans: [{ partId: PART_NONE, quantity: 2 }], idempotencyKey: "key-n2-5", progress: PROGRESS_1 }));
  assert.equal(fake.store.get(`purchase_orders/${PO}`).status, "RECEIVED");
  before = snapshot(fake);
  await expectCode(call(fake, { ...clientPayload({ scans: [{ partId: PART_NONE }], idempotencyKey: "key-n2-6", progress: PROGRESS_1 }), expectedVersion: 2 }), "failed-precondition", "new key on a RECEIVED PO");
  assertUnchanged(fake, before, "closed PO");
});

test("NEGATIVE: a legacy retry under a NEW key after RECEIVED is still refused", async () => {
  const fake = makeFakeDb(legacySeed());
  await call(fake, legacyReq());
  const before = snapshot(fake);
  await expectCode(call(fake, legacyReq({ idempotencyKey: "legacy-key-2" })), "failed-precondition", "legacy second receipt");
  assertUnchanged(fake, before, "legacy new key");
});

test("NEGATIVE: CONCURRENT duplicate (two transactions, same key) -> exactly one applied, the other replays", async () => {
  const fake = makeFakeDb(baseSeed());
  const payload = clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "key-conc" });
  const [x, y] = await Promise.all([call(fake, payload), call(fake, payload)]);
  const outcomes = [x.outcome, y.outcome].sort();
  assert.deepEqual(outcomes, ["applied", "replayed"], "exactly one applied");
  assert.ok(fake.attempts() > 2, "the loser really conflicted and re-ran");
  assert.equal(x.receivingId, y.receivingId);
  assert.equal(fake.count("receiving_orders"), 1);
  assert.equal(fake.count("inventory_transactions"), 3);
  assert.equal(fake.count("serialized_assets"), 2);
  assert.equal(fake.count("auditEvents"), 1);
  assert.equal(fake.store.get(`purchase_orders/${PO}`).version, 1);
});

test("NEGATIVE: CONCURRENT different keys over the same remaining -> exactly one applied, the other refused", async () => {
  const fake = makeFakeDb(baseSeed());
  const results = await Promise.allSettled([
    call(fake, clientPayload({ scans: FULL_SCANS, idempotencyKey: "key-c1" })),
    call(fake, clientPayload({ scans: FULL_SCANS, idempotencyKey: "key-c2" })),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected");
  assert.ok(rejected.reason instanceof HttpsError && rejected.reason.code === "failed-precondition", String(rejected.reason && rejected.reason.stack));
  assert.equal(fake.count("receiving_orders"), 1);
});

test("NEGATIVE: a serial already received cannot be reused under a NEW key", async () => {
  const fake = makeFakeDb(baseSeed());
  // Receive one of the two serials, leaving L2 capacity so the refusal is the serial identity, not quantity.
  await call(fake, clientPayload({ scans: [{ partId: PART_SERIAL, serialNo: "SN-1" }], idempotencyKey: "key-s1" }));
  const progress = {
    version: 1,
    lines: [PROGRESS_0.lines[0], { ...PROGRESS_0.lines[1], receivedQuantity: 1, remainingQuantity: 1, state: "PARTIALLY_RECEIVED" }],
  };
  const before = snapshot(fake);
  // Refused. The public code is "internal" because mapReceiveError has no SERIAL_IDENTITY_CONFLICT arm
  // -- a pre-existing mapping, pinned here as-is and NOT changed by this lane.
  await expectCode(call(fake, clientPayload({ scans: [{ partId: PART_SERIAL, serialNo: "SN-1" }], idempotencyKey: "key-s2", progress })), "internal", "serial reuse");
  assertUnchanged(fake, before, "serial reuse");
  // ...while the ORIGINAL receipt's exact retry still replays.
  const again = await call(fake, clientPayload({ scans: [{ partId: PART_SERIAL, serialNo: "SN-1" }], idempotencyKey: "key-s1" }));
  assert.equal(again.outcome, "replayed");
  assertUnchanged(fake, before, "serial replay");
});

// ===================================================================== offline replay after a lost response

// The offline queue stores the request the screen sent online and replays it (field-ops-app-vite
// MultiScanReceiving -> captureReceive({ request }) -> warehouseCommandBindings -> submitCanonicalReceive).
// What reaches the server is that request after a JSON round trip through the device store.
const throughDeviceStore = (req) => JSON.parse(JSON.stringify(req));

test("OFFLINE REPLAY: online commit whose response was lost, then the queued SAME request -> replayed, zero writes", async () => {
  const fake = makeFakeDb(baseSeed());
  const online = clientPayload({ scans: PARTIAL_SCANS, idempotencyKey: "rcv-online-key" });
  const committed = await call(fake, online); // the response never reaches the phone
  assert.equal(committed.outcome, "applied");
  const before = snapshot(fake);
  const writesBefore = fake.writes();

  const replay = await call(fake, throughDeviceStore(online), LATER);
  assertSameReceipt(replay, committed);
  assert.ok(client.validateCanonicalReceiveResponse(replay) !== null);
  assert.equal(fake.writes(), writesBefore, "zero new writes");
  assertUnchanged(fake, before, "offline replay");
});

test("WHY THE KEY MATTERS: the same receipt replayed under a DIFFERENT key is a second receipt (or a refusal), never a replay", async () => {
  // (i) Without expectedVersion -- the pre-fix offline capture carried none -- a different key applies
  //     AGAIN: the same physical delivery is double-posted.
  const fake = makeFakeDb(baseSeed());
  const online = clientPayload({ scans: [{ partId: PART_NONE }, { partId: PART_NONE }], idempotencyKey: "rcv-online-key" });
  delete online.expectedVersion;
  const first = await call(fake, online);
  const second = await call(fake, { ...throughDeviceStore(online), idempotencyKey: "int_derived_offline_key" });
  assert.equal(first.outcome, "applied");
  assert.equal(second.outcome, "applied", "a different key is a different receipt");
  assert.notEqual(second.receivingId, first.receivingId);
  assert.equal(fake.count("receiving_orders"), 2, "DOUBLE-POSTED: 2 receipts for one delivery");
  assert.deepEqual(second.lines.map((l) => [l.lineId, l.previouslyReceived, l.receivedNow]), [["L1", 2, 2], ["L2", 0, 0]]);

  // (ii) WITH the original expectedVersion, a different key is refused version_conflict rather than
  //      double-applied -- the version is a backstop, but it reports a FAILURE for a receipt that did
  //      commit. Only the SAME key turns the retry into the truthful `replayed`.
  const fake2 = makeFakeDb(baseSeed());
  const withVersion = clientPayload({ scans: [{ partId: PART_NONE }, { partId: PART_NONE }], idempotencyKey: "rcv-online-key" });
  await call(fake2, withVersion);
  const before = snapshot(fake2);
  await expectCode(call(fake2, { ...throughDeviceStore(withVersion), idempotencyKey: "int_derived_offline_key" }), "failed-precondition", "different key, stale version");
  assertUnchanged(fake2, before, "version backstop");
  const same = await call(fake2, throughDeviceStore(withVersion));
  assert.equal(same.outcome, "replayed", "same key + same (now stale) expectedVersion replays");
  assertUnchanged(fake2, before, "same-key replay");
});
