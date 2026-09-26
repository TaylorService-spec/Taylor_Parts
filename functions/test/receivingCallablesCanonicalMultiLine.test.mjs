// CONNECTED regression: the canonical multi-line PURCHASE_ORDER receipt that the Multi-Scan Receiving
// screen (field-ops-app-vite/src/modules/receiving/MultiScanReceiving.jsx) builds, driven through the
// EXPORTED receiveInventoryStock callable handler (runReceiveInventoryStock) -- the same function the
// onCall export invokes -- with the REAL production composition (pinned warehouse resolver, real
// command, real receiving/ledger repositories, real RO numbering), the REAL governed permission
// resolver (resolveReceivePermissionThroughTxn) and the REAL audit stager (stageReceiveAuditEvent).
// Only the Firestore backend is an in-memory fake with transaction semantics (reads see committed
// state; writes buffer and apply all-or-nothing on commit), and the Part authority is a fixed seam.
//
// The payload is not hand-written: it is produced by the client's OWN scan queue, reconciliation,
// submission-line builder and canonical request builder, exactly as the screen does, so a drift
// between what the screen sends and what the boundary accepts is caught here.
//
// DEFECT (pre-fix): validateReceiveRequest accepted only source.type REORDER_PURCHASE_ORDER, exactly
// one line, a required expectedQuantity and no expectedVersion, so every canonical receipt was refused
// invalid-argument before authorization or any read; and the public response carried only three keys,
// so the client's canonical response validator rejected even a successful receipt.
//
// PURE of any emulator/network: an admin app is initialized only so getFirestore() can mint
// DocumentReferences (RO counter, audit event) -- no read or write ever reaches it.
// Prerequisite: npm run build. Run: node --test test/receivingCallablesCanonicalMultiLine.test.mjs
delete process.env.FIRESTORE_EMULATOR_HOST;
import test from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

admin.initializeApp({ projectId: "s1-offline-receiving" });

const { runReceiveInventoryStock } = await import("../lib/inventoryReceiving/receivingCallables.js");
const { resolveReceivePermissionThroughTxn, stageReceiveAuditEvent } = await import("../lib/inventoryReceiving/receivingCallableWiring.js");
const client = await import("../../field-ops-app-vite/src/domain/receivingTransport.js");
const scanQueue = await import("../../field-ops-app-vite/src/domain/receivingScanQueue.js");

// ------------------------------------------------------------------ in-memory Firestore fake

function getPath(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

function makeFakeDb(seed = {}) {
  const store = new Map(); // path -> data
  for (const [path, data] of Object.entries(seed)) store.set(path, { ...data }); // shallow: structuredClone would strip Timestamp class
  let autoId = 0;
  let reads = 0;
  const docRef = (collection, id) => ({ id, path: `${collection}/${id}` });
  const query = (collection, wheres) => ({
    __query: true, collection, wheres,
    where(field, op, value) { assert.equal(op, "=="); return query(collection, [...wheres, { field, value }]); },
  });
  const snapDoc = (path) => {
    const has = store.has(path);
    const id = path.split("/").pop();
    return { exists: has, id, data: () => (has ? store.get(path) : undefined) };
  };
  const db = {
    collection(name) {
      return {
        doc: (id) => docRef(name, id ?? `auto${(autoId += 1)}`),
        where: (field, op, value) => query(name, []).where(field, op, value),
      };
    },
    async runTransaction(fn) {
      const pending = [];
      const txn = {
        async get(target) {
          reads += 1;
          if (target && target.__query) {
            const docs = [...store.keys()]
              .filter((p) => p.startsWith(`${target.collection}/`) && p.split("/").length === 2)
              .filter((p) => target.wheres.every((w) => getPath(store.get(p), w.field) === w.value))
              .map((p) => snapDoc(p));
            return { docs, empty: docs.length === 0, size: docs.length };
          }
          return snapDoc(target.path);
        },
        create(ref, data) { pending.push({ op: "create", path: ref.path, data }); return txn; },
        set(ref, data) { pending.push({ op: "set", path: ref.path, data }); return txn; },
        update(ref, data) { pending.push({ op: "update", path: ref.path, data }); return txn; },
      };
      const result = await fn(txn);
      // COMMIT, all-or-nothing: validate every op before applying any.
      for (const w of pending) {
        if (w.op === "create" && store.has(w.path)) throw new Error(`ALREADY_EXISTS ${w.path}`);
        if (w.op === "update" && !store.has(w.path)) throw new Error(`NOT_FOUND ${w.path}`);
      }
      for (const w of pending) {
        if (w.op === "update") store.set(w.path, { ...store.get(w.path), ...w.data });
        else store.set(w.path, w.data);
      }
      return result;
    },
  };
  const count = (collection) => [...store.keys()].filter((p) => p.startsWith(`${collection}/`)).length;
  return { db, store, count, reads: () => reads };
}

// ------------------------------------------------------------------ fixtures

const TS = Timestamp.fromMillis(1_700_000_000_000);
const NOW = new Date(1_700_000_000_000);
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

function baseSeed({ grant = true } = {}) {
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
    ...(grant ? {
      "roleAssignments/ra-1": { principalUid: ACTOR, roleId: "admin", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 },
    } : {}),
  };
}

function wiringFor(fake) {
  return {
    db: fake.db,
    resolvePermission: (txn, actorId) => resolveReceivePermissionThroughTxn(txn, fake.db, actorId),
    resolvePart: async (_txn, partId) => PARTS.get(partId) ?? null,
    stageAudit: stageReceiveAuditEvent,
    now: () => NOW,
  };
}
const call = (fake, data, uid = ACTOR) => runReceiveInventoryStock({ auth: { uid }, data }, wiringFor(fake));

// The server's derived progress lines, as getPurchaseOrderReceivingProgress would report them.
const PROGRESS = {
  version: 0,
  lines: [
    { lineId: "L1", partId: PART_NONE, trackingMode: "NONE", orderedQuantity: 5, receivedQuantity: 0, remainingQuantity: 5, state: "NOT_RECEIVED" },
    { lineId: "L2", partId: PART_SERIAL, trackingMode: "SERIAL", orderedQuantity: 2, receivedQuantity: 0, remainingQuantity: 2, state: "NOT_RECEIVED" },
  ],
};

// Build the wire payload EXACTLY as MultiScanReceiving.submit() + submitCanonicalReceive() do.
function clientPayload({ scans, idempotencyKey = "rcv-canon-key-1", progress = PROGRESS }) {
  let queue = scanQueue.createQueue();
  for (const s of scans) queue = scanQueue.addScan(queue, s);
  const reconciliation = scanQueue.reconcile(queue, progress.lines);
  const lines = scanQueue.buildSubmissionLines(reconciliation);
  assert.ok(lines !== null, "client reconciliation must be submittable");
  const request = {
    source: { type: "PURCHASE_ORDER", purchaseOrderId: PO },
    receivingLocation: { type: "WAREHOUSE", locationId: WH },
    lines: lines.map((l) => ({ ...l })),
    idempotencyKey,
    expectedVersion: progress.version,
  };
  const built = client.buildCanonicalReceiveRequest(request);
  assert.ok(built !== null, "client builder must accept its own request");
  return JSON.parse(JSON.stringify(built)); // what crosses the wire
}

const PARTIAL_SCANS = [
  { partId: PART_NONE }, { partId: PART_NONE }, { partId: PART_NONE },
  { partId: PART_SERIAL, serialNo: "SN-1" }, { partId: PART_SERIAL, serialNo: "SN-2" },
];

async function expectCode(promise, code, label) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof HttpsError, `${label}: HttpsError, got ${e && e.name}: ${e && e.message}`);
    assert.equal(e.code, code, `${label}: code`);
    return true;
  });
}

// ------------------------------------------------------------------ the canonical journey

test("the client's canonical payload is multi-line PURCHASE_ORDER with expectedVersion and no expectedQuantity", () => {
  const p = clientPayload({ scans: PARTIAL_SCANS });
  assert.deepEqual(p, {
    source: { type: "PURCHASE_ORDER", purchaseOrderId: PO },
    receivingLocation: { type: "WAREHOUSE", locationId: WH },
    lines: [
      { lineId: "L1", partId: PART_NONE, receivedQuantity: 3 },
      { lineId: "L2", partId: PART_SERIAL, receivedQuantity: 2, serialNumbers: ["SN-1", "SN-2"] },
    ],
    idempotencyKey: "rcv-canon-key-1",
    expectedVersion: 0,
  });
});

test("REGRESSION: canonical multi-line receipt is applied through the exported callable handler", async () => {
  const fake = makeFakeDb(baseSeed());
  const res = await call(fake, clientPayload({ scans: PARTIAL_SCANS }));

  // The client's own response validator must accept it -- otherwise a committed receipt is shown as
  // "unavailable" and re-queued.
  const receipt = client.validateCanonicalReceiveResponse(res);
  assert.ok(receipt !== null, `client rejected response: ${JSON.stringify(res)}`);
  assert.equal(receipt.outcome, "applied");
  assert.equal(receipt.purchaseOrderId, PO);
  assert.equal(receipt.derivedState, "PARTIALLY_RECEIVED");
  assert.equal(receipt.storedStatus, "SENT");
  assert.deepEqual(receipt.lines.map((l) => [l.lineId, l.receivedNow, l.remainingQuantity, l.state]), [
    ["L1", 3, 2, "PARTIALLY_RECEIVED"],
    ["L2", 2, 0, "RECEIVED"],
  ]);
  // Response is bounded to the client's allow-list: no internal ids leak.
  assert.deepEqual(Object.keys(res).sort(), ["derivedState", "ledgerEventId", "lines", "outcome", "purchaseOrderId", "receivingId", "storedStatus"]);

  // Effects: one receipt, one NONE ledger event + one per serial, two serialized assets, one audit,
  // PO version bumped and still SENT (partial).
  assert.equal(fake.count("receiving_orders"), 1);
  assert.equal(fake.count("inventory_transactions"), 3);
  assert.equal(fake.count("serialized_assets"), 2);
  assert.equal(fake.count("auditEvents"), 1);
  const po = fake.store.get(`purchase_orders/${PO}`);
  assert.equal(po.version, 1);
  assert.equal(po.status, "SENT");
});

test("idempotency: a retry never creates a second effect; a still-valid retry replays the same receipt", async () => {
  // (A) A retry that is still valid against what remains REPLAYS to the same receipt id, writes
  // nothing, and reports the same progress as the original.
  const fake = makeFakeDb(baseSeed());
  const payload = clientPayload({ scans: [{ partId: PART_NONE }, { partId: PART_NONE }] });
  delete payload.expectedVersion;
  const a = await call(fake, payload);
  const snapshot = new Map(fake.store);
  const b = await call(fake, payload);
  assert.equal(a.outcome, "applied");
  assert.equal(b.outcome, "replayed");
  assert.equal(b.receivingId, a.receivingId);
  assert.deepEqual(b.lines, a.lines, "replay reports the original progress");
  assert.deepEqual([...fake.store.keys()].sort(), [...snapshot.keys()].sort());
  assert.equal(fake.store.get(`purchase_orders/${PO}`).version, 1);

  // (B) KNOWN COMMAND LIMIT, pinned so it is visible (NOT changed here -- the command is out of this
  // boundary fix's scope): the command validates quantities and expectedVersion against the
  // post-commit state BEFORE it looks up the receipt id, so a retry of the screen's exact request
  // (which carries expectedVersion, and here also fills L2) is REFUSED failed-precondition instead of
  // replayed. It is still never a second effect.
  const fake2 = makeFakeDb(baseSeed());
  const screen = clientPayload({ scans: PARTIAL_SCANS });
  await call(fake2, screen);
  const before = new Map(fake2.store);
  await expectCode(call(fake2, screen), "failed-precondition", "retry of a committed, stale-version receipt");
  assert.deepEqual([...fake2.store.keys()].sort(), [...before.keys()].sort());
  assert.equal(fake2.count("inventory_transactions"), 3);
  assert.equal(fake2.store.get(`purchase_orders/${PO}`).version, 1);
});

test("a later receipt completes the order (stored status RECEIVED)", async () => {
  const fake = makeFakeDb(baseSeed());
  await call(fake, clientPayload({ scans: PARTIAL_SCANS }));
  const progress2 = {
    version: 1,
    lines: [
      { ...PROGRESS.lines[0], receivedQuantity: 3, remainingQuantity: 2, state: "PARTIALLY_RECEIVED" },
      { ...PROGRESS.lines[1], receivedQuantity: 2, remainingQuantity: 0, state: "RECEIVED" },
    ],
  };
  const res = await call(fake, clientPayload({ scans: [{ partId: PART_NONE, quantity: 2 }], idempotencyKey: "rcv-canon-key-2", progress: progress2 }));
  assert.equal(res.outcome, "applied");
  assert.equal(res.derivedState, "RECEIVED");
  assert.equal(res.storedStatus, "RECEIVED");
  assert.equal(fake.store.get(`purchase_orders/${PO}`).status, "RECEIVED");
  assert.equal(fake.count("receiving_orders"), 2);
});

// ------------------------------------------------------------------ denied cases

const canonical = (over = {}, lineOver = null) => {
  const p = clientPayload({ scans: PARTIAL_SCANS });
  if (lineOver) p.lines = lineOver;
  return { ...p, ...over };
};

test("bad shape is refused invalid-argument at the boundary, before any read", async () => {
  const fake = makeFakeDb(baseSeed());
  const cases = [
    ["canonical source carrying reorderRequestId", canonical({ source: { type: "PURCHASE_ORDER", purchaseOrderId: PO, reorderRequestId: PO } })],
    ["canonical source missing purchaseOrderId", canonical({ source: { type: "PURCHASE_ORDER" } })],
    ["unknown source type", canonical({ source: { type: "SALES_ORDER", purchaseOrderId: PO } })],
    ["empty lines", canonical({ lines: [] })],
    ["lines not an array", canonical({ lines: "L1" })],
    ["canonical line claiming expectedQuantity", canonical({}, [{ lineId: "L1", partId: PART_NONE, receivedQuantity: 1, expectedQuantity: 5 }])],
    ["line with unknown field", canonical({}, [{ lineId: "L1", partId: PART_NONE, receivedQuantity: 1, status: "RECEIVED" }])],
    ["line quantity not a number", canonical({}, [{ lineId: "L1", partId: PART_NONE, receivedQuantity: "1" }])],
    ["serialNumbers not an array", canonical({}, [{ lineId: "L2", partId: PART_SERIAL, receivedQuantity: 1, serialNumbers: "SN-1" }])],
    ["expectedVersion not a number", canonical({ expectedVersion: "0" })],
    ["fractional receivedQuantity", canonical({}, [{ lineId: "L1", partId: PART_NONE, receivedQuantity: 1.5 }])],
    ["fractional serial-line receivedQuantity", canonical({}, [{ lineId: "L2", partId: PART_SERIAL, receivedQuantity: 1.5, serialNumbers: ["SN-1"] }])],
    ["fractional expectedVersion", canonical({ expectedVersion: 1.5 })],
    ["negative expectedVersion", canonical({ expectedVersion: -1 })],
    ["client-supplied actor", canonical({ actor: { kind: "USER", id: "evil" } })],
    ["missing idempotencyKey", canonical({ idempotencyKey: "" })],
  ];
  for (const [label, data] of cases) await expectCode(call(fake, data), "invalid-argument", label);
  assert.equal(fake.reads(), 0, "no Firestore read for a malformed request");
});

test("unauthorized actor is refused permission-denied with zero effects", async () => {
  const fake = makeFakeDb(baseSeed({ grant: false }));
  const before = new Map(fake.store);
  await expectCode(call(fake, clientPayload({ scans: PARTIAL_SCANS })), "permission-denied", "no grant");
  assert.deepEqual([...fake.store.keys()].sort(), [...before.keys()].sort());
  await expectCode(runReceiveInventoryStock({ auth: null, data: clientPayload({ scans: PARTIAL_SCANS }) }, wiringFor(fake)), "unauthenticated", "no auth");
});

test("over-receipt, serial mismatch, stale version and key conflict are refused with zero effects", async () => {
  const fake = makeFakeDb(baseSeed());
  const before = new Map(fake.store);
  const deny = [
    ["over-receipt (6 of 5 remaining)", canonical({}, [{ lineId: "L1", partId: PART_NONE, receivedQuantity: 6 }])],
    ["serial count mismatch", canonical({}, [{ lineId: "L2", partId: PART_SERIAL, receivedQuantity: 2, serialNumbers: ["SN-1"] }])],
    ["serial duplicated", canonical({}, [{ lineId: "L2", partId: PART_SERIAL, receivedQuantity: 2, serialNumbers: ["SN-1", "SN-1"] }])],
    ["serial on a NONE line", canonical({}, [{ lineId: "L1", partId: PART_NONE, receivedQuantity: 1, serialNumbers: ["SN-9"] }])],
    ["SERIAL line without serials", canonical({}, [{ lineId: "L2", partId: PART_SERIAL, receivedQuantity: 1 }])],
    ["part not on the named line", canonical({}, [{ lineId: "L1", partId: PART_SERIAL, receivedQuantity: 1, serialNumbers: ["SN-1"] }])],
    ["line not on the order", canonical({}, [{ lineId: "L9", partId: PART_NONE, receivedQuantity: 1 }])],
    ["duplicate submitted line", canonical({}, [{ lineId: "L1", partId: PART_NONE, receivedQuantity: 1 }, { lineId: "L1", partId: PART_NONE, receivedQuantity: 1 }])],
    ["stale expectedVersion", canonical({ expectedVersion: 7 })],
  ];
  for (const [label, data] of deny) await expectCode(call(fake, data), "failed-precondition", label);
  assert.deepEqual([...fake.store.keys()].sort(), [...before.keys()].sort(), "no effect from any refused receipt");

  // Same key, different payload -> idempotency conflict, not a second receipt.
  const payload = clientPayload({ scans: PARTIAL_SCANS });
  delete payload.expectedVersion;
  await call(fake, payload);
  const changed = { ...payload, lines: [{ lineId: "L1", partId: PART_NONE, receivedQuantity: 1 }] };
  await expectCode(call(fake, changed), "failed-precondition", "key reused with a different payload");
  assert.equal(fake.count("receiving_orders"), 1);
});

// ------------------------------------------------------------------ legacy path preserved

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
const legacyReq = (over = {}) => ({
  source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "rr-1", purchaseOrderId: "rr-1" },
  receivingLocation: { type: "WAREHOUSE", locationId: WH },
  lines: [{ lineId: "client-line", partId: "part-legacy", expectedQuantity: 4, receivedQuantity: 4 }],
  idempotencyKey: "legacy-key-1",
  ...over,
});

test("legacy REORDER_PURCHASE_ORDER single-line receipt is unchanged (3-key response)", async () => {
  const fake = makeFakeDb(legacySeed());
  const legacyPoBefore = structuredClone(fake.store.get("reorder_purchase_orders/rr-1"));
  const res = await call(fake, legacyReq());
  assert.deepEqual(Object.keys(res).sort(), ["ledgerEventId", "outcome", "receivingId"]);
  assert.equal(res.outcome, "applied");
  assert.equal(fake.store.get("reorder_requests/rr-1").status, "RECEIVED");
  assert.deepEqual(fake.store.get("reorder_purchase_orders/rr-1"), legacyPoBefore, "legacy PO is never written");
  const replay = await call(fake, legacyReq());
  assert.equal(replay.outcome, "replayed");
  assert.equal(replay.receivingId, res.receivingId);
});

test("legacy boundary contract is unchanged: one line, expectedQuantity required, no expectedVersion", async () => {
  const fake = makeFakeDb(legacySeed());
  const line = legacyReq().lines[0];
  await expectCode(call(fake, legacyReq({ lines: [line, { ...line, lineId: "x2" }] })), "invalid-argument", "two legacy lines");
  await expectCode(call(fake, legacyReq({ lines: [] })), "invalid-argument", "no legacy lines");
  const noExpected = { ...line }; delete noExpected.expectedQuantity;
  await expectCode(call(fake, legacyReq({ lines: [noExpected] })), "invalid-argument", "legacy line without expectedQuantity");
  await expectCode(call(fake, legacyReq({ expectedVersion: 0 })), "invalid-argument", "legacy expectedVersion");
  await expectCode(call(fake, legacyReq({ source: { type: "REORDER_PURCHASE_ORDER", purchaseOrderId: "rr-1" } })), "invalid-argument", "legacy without reorderRequestId");
  assert.equal(fake.reads(), 0);
  // Partial legacy receipt is still refused by the command.
  await expectCode(call(fake, legacyReq({ lines: [{ ...line, receivedQuantity: 2 }] })), "failed-precondition", "legacy partial");
});
