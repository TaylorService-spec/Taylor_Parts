// EOS Data Import -- governed OPENING INVENTORY BALANCE command.
//
// Pure/unit coverage over an in-memory transaction + ledger store. No emulator: every rule
// this command exists to enforce is decidable from the ledger contents it is given, so the
// rules are provable without infrastructure. (The end-to-end ledger write is separately
// exercised through the product path.)
//
// Run: node --test test/openingInventoryBalance.test.mjs   (after `npm run build`)

import test from "node:test";
import assert from "node:assert/strict";

const {
  applyOpeningInventoryBalanceThroughTxn,
  computeOpeningLedgerStateThroughTxn,
  openingBalanceIdempotencyKey,
  openingBalanceSourceObjectId,
  OpeningBalanceError,
  OPENING_BALANCE_SOURCE_PREFIX,
} = await import("../lib/dataImport/openingInventoryBalance.js");
const { serializeOperationalMovement, fingerprintMovement, operationalMovementDocId } = await import(
  "../lib/inventoryLedger/operationalMovementRepository.js"
);

const LOC = Object.freeze({ type: "WAREHOUSE", locationId: "wh-main" });
const PART = "prt-1001";
const ACTOR = "admin-uid-1";
const NOW = new Date("2026-09-04T12:00:00.000Z");
const OCCURRED = Date.parse("2026-09-04T12:00:00.000Z");

// ---------------------------------------------------------------- harness

function movementValue(over = {}) {
  return {
    type: "ADJUSTED",
    direction: "SIGNED",
    partId: PART,
    trackingMode: "NONE",
    location: LOC,
    quantity: 5,
    sourceObject: { type: "ADJUSTMENT", id: "manual-1" },
    idempotencyKey: "k-1",
    actor: { kind: "USER", id: "someone" },
    occurredAt: OCCURRED,
    ...over,
  };
}

/** A minimal Firestore stand-in: one collection, query by partId, transaction create/read. */
function makeDb(existingValues = []) {
  const docs = new Map();
  for (const v of existingValues) {
    const fp = fingerprintMovement(v);
    docs.set(operationalMovementDocId(v.idempotencyKey), serializeOperationalMovement(v, NOW, fp));
  }
  const created = [];
  const db = {
    collection() {
      return {
        where(field, _op, value) {
          return { __field: field, __value: value };
        },
        doc(id) {
          return { __id: id };
        },
      };
    },
    __docs: docs,
    __created: created,
  };
  const txn = {
    // Firestore's Transaction.get serves BOTH a Query and a DocumentReference, and the ledger
    // store uses the doc-ref form for its idempotency read. A fake that only answered queries
    // made every replay look like a first write.
    async get(target) {
      if (target && typeof target.__id === "string") {
        const data = docs.get(target.__id);
        return { exists: data !== undefined, data: () => data };
      }
      const rows = [...docs.entries()]
        .filter(([, data]) => data[target.__field] === target.__value)
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs: rows };
    },
    create(ref, data) {
      created.push({ id: ref.__id, data });
      docs.set(ref.__id, data);
    },
    set(ref, data) {
      created.push({ id: ref.__id, data });
      docs.set(ref.__id, data);
    },
  };
  return { db, txn, created };
}

function row(over = {}) {
  return {
    importJobId: "imp-001",
    sourceRowKey: "row-7",
    partId: PART,
    trackingMode: "NONE",
    location: LOC,
    openingQuantity: 25,
    actorUid: ACTOR,
    occurredAt: OCCURRED,
    ...over,
  };
}

async function refuses(fn, code) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof OpeningBalanceError) {
      assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
      return e;
    }
    throw e;
  }
  assert.fail(`expected refusal ${code}, but the command returned`);
}

// ---------------------------------------------------------------- the happy path

test("no prior movement: opening 25 stages ONE signed ADJUSTED movement of +25", async () => {
  const { db, txn, created } = makeDb([]);
  const out = await applyOpeningInventoryBalanceThroughTxn(txn, db, row(), { now: NOW });

  assert.equal(out.outcome, "applied");
  assert.equal(out.quantity, 25);
  assert.equal(created.length, 1, "exactly one ledger movement");

  const d = created[0].data;
  assert.equal(d.type, "ADJUSTED", "reuses the existing signed correction primitive");
  assert.equal(d.direction, "SIGNED");
  assert.equal(d.quantity, 25);
  assert.equal(d.sourceObject.type, "ADJUSTMENT", "source object type is ADJUSTMENT, not a new type");
  assert.ok(
    String(d.sourceObject.id).startsWith(`${OPENING_BALANCE_SOURCE_PREFIX}:imp-001:row-7`),
    "source id ties the event to the import job AND the source row",
  );
  assert.equal(d.actor.kind, "USER");
  assert.equal(d.actor.id, ACTOR);

  // and the resulting ledger-derived opening balance reads back as 25
  const state = await computeOpeningLedgerStateThroughTxn(txn, db, PART, LOC);
  assert.equal(state.openingQuantity, 25);
  assert.equal(state.hasOperationalHistory, false);
});

test("it invents no movement type and no source-object type", async () => {
  const { db, txn, created } = makeDb([]);
  await applyOpeningInventoryBalanceThroughTxn(txn, db, row(), { now: NOW });
  const d = created[0].data;
  // Only types the existing ledger already declares.
  assert.ok(["RECEIVED", "ADJUSTED", "TRANSFER_OUT", "TRANSFER_IN", "RETURNED", "SCRAPPED", "WORK_ORDER_CONSUMPTION"].includes(d.type));
  assert.ok(["WORK_ORDER", "RECEIVING_ORDER", "TRANSFER_ORDER", "ADJUSTMENT", "RMA", "SCRAP"].includes(d.sourceObject.type));
  assert.notEqual(d.type, "OPENING_BALANCE", "must not invent an OPENING_BALANCE movement type");
});

// ---------------------------------------------------------------- idempotency

test("replaying the SAME approved row does not double inventory", async () => {
  const { db, txn, created } = makeDb([]);
  const first = await applyOpeningInventoryBalanceThroughTxn(txn, db, row(), { now: NOW });
  const second = await applyOpeningInventoryBalanceThroughTxn(txn, db, row(), { now: NOW });

  assert.equal(first.outcome, "applied");
  assert.equal(second.outcome, "replayed", "second application is a replay, not a new movement");
  assert.equal(created.length, 1, "still exactly one ledger movement");

  const state = await computeOpeningLedgerStateThroughTxn(txn, db, PART, LOC);
  assert.equal(state.openingQuantity, 25, "balance is 25, not 50");
});

test("a replay with CHANGED material facts is an idempotency conflict, not a silent rewrite", async () => {
  const { db, txn } = makeDb([]);
  await applyOpeningInventoryBalanceThroughTxn(txn, db, row({ openingQuantity: 25 }), { now: NOW });
  await assert.rejects(
    () => applyOpeningInventoryBalanceThroughTxn(txn, db, row({ openingQuantity: 40 }), { now: NOW }),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
    "same row identity + different quantity must conflict",
  );
});

test("the idempotency identity is deterministic and covers job + row + part + location", () => {
  const base = { importJobId: "imp-001", sourceRowKey: "row-7", partId: PART, location: LOC };
  assert.equal(openingBalanceIdempotencyKey(base), openingBalanceIdempotencyKey({ ...base }));
  const vary = [
    { ...base, importJobId: "imp-002" },
    { ...base, sourceRowKey: "row-8" },
    { ...base, partId: "prt-9" },
    { ...base, location: { type: "WAREHOUSE", locationId: "wh-other" } },
    { ...base, location: { type: "MOBILE", locationId: "wh-main" } },
  ];
  const seen = new Set([openingBalanceIdempotencyKey(base)]);
  for (const v of vary) {
    const k = openingBalanceIdempotencyKey(v);
    assert.ok(!seen.has(k), `changing a material fact must change the key: ${JSON.stringify(v)}`);
    seen.add(k);
  }
});

// ---------------------------------------------------------------- THE fail-closed rule

const FOREIGN_HISTORY = [
  ["RECEIVED", { type: "RECEIVED", direction: "IN", sourceObject: { type: "RECEIVING_ORDER", id: "ro-1" }, idempotencyKey: "h-recv" }],
  [
    "TRANSFER_IN",
    {
      type: "TRANSFER_IN",
      direction: "IN",
      sourceObject: { type: "TRANSFER_ORDER", id: "to-1" },
      idempotencyKey: "h-tin",
      counterpartyLocation: { type: "WAREHOUSE", locationId: "wh-far" },
    },
  ],
  [
    "TRANSFER_OUT",
    {
      type: "TRANSFER_OUT",
      direction: "OUT",
      sourceObject: { type: "TRANSFER_ORDER", id: "to-2" },
      idempotencyKey: "h-tout",
      counterpartyLocation: { type: "WAREHOUSE", locationId: "wh-far" },
    },
  ],
  ["SCRAPPED", { type: "SCRAPPED", direction: "OUT", sourceObject: { type: "SCRAP", id: "s-1" }, idempotencyKey: "h-scrap" }],
  ["RETURNED", { type: "RETURNED", direction: "IN", sourceObject: { type: "RMA", id: "r-1" }, idempotencyKey: "h-ret" }],
  [
    "WORK_ORDER_CONSUMPTION",
    { type: "WORK_ORDER_CONSUMPTION", direction: "SIGNED", quantity: -2, sourceObject: { type: "WORK_ORDER", id: "wo-1" }, idempotencyKey: "h-wo" },
  ],
  [
    "a non-opening ADJUSTED (e.g. cycle-count reconciliation)",
    { type: "ADJUSTED", direction: "SIGNED", sourceObject: { type: "ADJUSTMENT", id: "cycle-count-cc-1" }, idempotencyKey: "h-adj" },
  ],
];

for (const [label, over] of FOREIGN_HISTORY) {
  test(`prior ${label} at the pair REFUSES the opening balance row`, async () => {
    const { db, txn, created } = makeDb([movementValue(over)]);
    const e = await refuses(
      () => applyOpeningInventoryBalanceThroughTxn(txn, db, row(), { now: NOW }),
      "OPENING_BALANCE_ALREADY_OPERATIONAL",
    );
    assert.match(e.message, /already has operational movement history/);
    assert.match(e.message, /Cycle Count/, "the message names where a correction belongs");
    assert.equal(created.length, 0, "nothing staged on the refusal path");
  });
}

test("it never computes a delta to force live stock back to the spreadsheet value", async () => {
  // 10 received, spreadsheet says 25. A reset mechanism would write +15. This must refuse.
  const { db, txn, created } = makeDb([
    movementValue({ type: "RECEIVED", direction: "IN", quantity: 10, sourceObject: { type: "RECEIVING_ORDER", id: "ro-9" }, idempotencyKey: "h-r" }),
  ]);
  await refuses(() => applyOpeningInventoryBalanceThroughTxn(txn, db, row({ openingQuantity: 25 }), { now: NOW }), "OPENING_BALANCE_ALREADY_OPERATIONAL");
  assert.equal(created.length, 0);
});

test("history at a DIFFERENT location does not block this location", async () => {
  const { db, txn } = makeDb([
    movementValue({
      type: "RECEIVED",
      direction: "IN",
      location: { type: "WAREHOUSE", locationId: "wh-other" },
      sourceObject: { type: "RECEIVING_ORDER", id: "ro-2" },
      idempotencyKey: "h-elsewhere",
    }),
  ]);
  const out = await applyOpeningInventoryBalanceThroughTxn(txn, db, row(), { now: NOW });
  assert.equal(out.outcome, "applied");
});

// ---------------------------------------------------------------- quantity rules

test("negative, NaN, Infinity and non-numeric quantities are refused", async () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "25", null, undefined, {}]) {
    const { db, txn, created } = makeDb([]);
    await refuses(
      () => applyOpeningInventoryBalanceThroughTxn(txn, db, row({ openingQuantity: bad }), { now: NOW }),
      "OPENING_BALANCE_QUANTITY_INVALID",
    );
    assert.equal(created.length, 0);
  }
});

test("quantity 0 authors NO movement rather than a meaningless zero row", async () => {
  const { db, txn, created } = makeDb([]);
  const out = await applyOpeningInventoryBalanceThroughTxn(txn, db, row({ openingQuantity: 0 }), { now: NOW });
  assert.equal(out.outcome, "no-movement");
  assert.equal(created.length, 0, "CERT-LEDGER-COUNTED-08: a movement that moves nothing is not written");
});

// ---------------------------------------------------------------- serial / lot

for (const mode of ["SERIAL", "LOT"]) {
  test(`${mode}-tracked parts are refused -- P1 does not fake ${mode} identity`, async () => {
    const { db, txn, created } = makeDb([]);
    const e = await refuses(
      () => applyOpeningInventoryBalanceThroughTxn(txn, db, row({ trackingMode: mode }), { now: NOW }),
      "OPENING_BALANCE_TRACKING_MODE_UNSUPPORTED",
    );
    assert.match(e.message, new RegExp(mode));
    assert.equal(created.length, 0);
  });
}

// ---------------------------------------------------------------- required inputs

test("job id, source row key, part and location are each required", async () => {
  const cases = [
    [{ importJobId: "" }, "OPENING_BALANCE_JOB_REQUIRED"],
    [{ sourceRowKey: "" }, "OPENING_BALANCE_ROW_REQUIRED"],
    [{ partId: "" }, "OPENING_BALANCE_PART_REQUIRED"],
    [{ location: { type: "WAREHOUSE", locationId: "" } }, "OPENING_BALANCE_LOCATION_REQUIRED"],
  ];
  for (const [over, code] of cases) {
    const { db, txn } = makeDb([]);
    await refuses(() => applyOpeningInventoryBalanceThroughTxn(txn, db, row(over), { now: NOW }), code);
  }
});

test("the source object id is durable provenance: job + row are both recoverable from it", () => {
  const id = openingBalanceSourceObjectId("imp-042", "row-13");
  assert.equal(id, `${OPENING_BALANCE_SOURCE_PREFIX}:imp-042:row-13`);
  const [prefix, job, srcRow] = id.split(":");
  assert.equal(prefix, OPENING_BALANCE_SOURCE_PREFIX);
  assert.equal(job, "imp-042");
  assert.equal(srcRow, "row-13");
});

test("a SECOND opening balance at the same position is refused -- there is only one", async () => {
  // FOUND BY THE END-TO-END TEST, NOT BY READING. Importing the same position twice was
  // accepted and STACKED: a prior opening event is not "foreign" operational history, so 12
  // then 99 left a balance of 111 and two opening movements at one position. The second one
  // was never an opening balance -- it is an adjustment arriving without the authority,
  // reason or variance record that adjusting a live position is supposed to carry.
  const priorOpening = movementValue({
    quantity: 12,
    sourceObject: { type: "ADJUSTMENT", id: openingBalanceSourceObjectId("imp-000", "row-1") },
    idempotencyKey: "prior-opening",
  });

  await assert.rejects(
    (() => {
      const harness = makeDb([priorOpening]);
      return applyOpeningInventoryBalanceThroughTxn(harness.txn, harness.db, row(), { now: NOW });
    })(),
    (err) => err instanceof OpeningBalanceError && err.code === "OPENING_BALANCE_ALREADY_SET",
  );
});

test("the ledger state names the opening sources it found, which is what tells a replay apart", async () => {
  // The guard compares SOURCE IDS rather than quantities, precisely so re-running the SAME
  // job row stays distinguishable from stating a second opening balance. Quantities cannot
  // tell those apart, and refusing both would make a retried execution fail where it should
  // have been a no-op.
  const sourceId = openingBalanceSourceObjectId("imp-001", "row-7");
  const mine = movementValue({
    quantity: 12,
    sourceObject: { type: "ADJUSTMENT", id: sourceId },
    idempotencyKey: "mine",
  });
  const harness = makeDb([mine]);
  const state = await computeOpeningLedgerStateThroughTxn(harness.txn, harness.db, PART, LOC);

  assert.deepEqual([...state.openingSourceIds], [sourceId]);
  assert.equal(state.openingQuantity, 12);
  assert.equal(state.hasOperationalHistory, false, "an opening event is not operational history");
});
