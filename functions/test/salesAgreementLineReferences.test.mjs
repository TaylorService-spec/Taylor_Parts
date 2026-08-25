// A SALES AGREEMENT LINE MUST NAME A PRODUCT THAT EXISTS.
//
// The defect: server validation proved only `ref` was non-empty, so
// { kind: "PART", ref: "asdfgh", unitPrice: 50000000 } was a valid commercial line -- draftable,
// ACCEPTABLE (which binds the business to the price), and copied unchanged into a Sales Order by
// deriveSalesOrderLinesFromAgreement, which maps { kind, ref } straight through to fulfillment.
//
// These tests are the control. Run: node --test test/salesAgreementLineReferences.test.mjs
// Prerequisite: `npm run build` (imports compiled lib/).
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSalesAgreementLineReferences,
  authorityCollectionFor,
  MAX_VALIDATED_LINE_REFERENCES,
  PARTS_COLLECTION,
  EQUIPMENT_MODELS_COLLECTION,
} from "../lib/salesAgreement/salesAgreementLineReferences.js";

// ═════════════════════════════════════════ a Firestore stand-in

/**
 * @param world { [collection]: Set<docId> } — what exists.
 * Records every read so the tests can assert the READ SHAPE, not only the verdict: "it rejects
 * asdfgh" is worth little if it costs one read per line to find out.
 */
function fakeDb(world) {
  const reads = { getAll: [], get: [] };
  const db = {
    collection: (name) => ({ doc: (id) => ({ __c: name, __id: id, id }) }),
  };
  const tx = {
    getAll: async (...refs) => {
      reads.getAll.push(refs.map((r) => `${r.__c}/${r.__id}`));
      return refs.map((r) => ({ id: r.__id, exists: !!world[r.__c]?.has(r.__id) }));
    },
    get: async (ref) => {
      reads.get.push(`${ref.__c}/${ref.__id}`);
      return { id: ref.__id, exists: !!world[ref.__c]?.has(ref.__id) };
    },
  };
  return { db, tx, reads };
}

const WORLD = {
  [PARTS_COLLECTION]: new Set(["CW-P-0000", "CW-P-0001"]),
  [EQUIPMENT_MODELS_COLLECTION]: new Set(["taylor--c713", "taylor--c161"]),
};
const run = (lines, world = WORLD) => {
  const { db, tx, reads } = fakeDb(world);
  return validateSalesAgreementLineReferences(db, tx, lines).then(
    () => ({ ok: true, reads }),
    (err) => ({ ok: false, code: err.code, message: err.message, reads }),
  );
};

// ═════════════════════════════════════════ the authority map

test("each kind resolves to its ACTUAL authority, and SERVICE truthfully has none", async () => {
  assert.equal(authorityCollectionFor("PART"), PARTS_COLLECTION);
  assert.equal(authorityCollectionFor("EQUIPMENT_MODEL"), EQUIPMENT_MODELS_COLLECTION);
  // Not an oversight and not a fall-through: no service-code catalog exists anywhere in the
  // repository, so there is nothing to validate against. Reported as a governance gap rather than
  // answered by inventing one.
  assert.equal(authorityCollectionFor("SERVICE"), null);
});

// ═════════════════════════════════════════ THE DEFECT

test("THE ARBITRARY REFERENCE IS REJECTED", async () => {
  const r = await run([{ lineId: "line-1", kind: "PART", ref: "asdfgh" }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, "REFERENCE_NOT_FOUND");
  assert.match(r.message, /line-1/, "the failing line must be identifiable without hunting");
  assert.match(r.message, /asdfgh/, "quoting the user's own input identifies the mistake");
  assert.match(r.message, /Part/);
});

test("a valid Part and a valid Equipment Model are accepted", async () => {
  assert.equal((await run([{ kind: "PART", ref: "CW-P-0000" }])).ok, true);
  assert.equal((await run([{ kind: "EQUIPMENT_MODEL", ref: "taylor--c713" }])).ok, true);
  assert.equal(
    (await run([
      { kind: "PART", ref: "CW-P-0001" },
      { kind: "EQUIPMENT_MODEL", ref: "taylor--c161" },
    ])).ok,
    true,
  );
});

test("a nonexistent Part and a nonexistent Equipment Model are both rejected", async () => {
  for (const line of [
    { kind: "PART", ref: "CW-P-9999" },
    { kind: "EQUIPMENT_MODEL", ref: "taylor--nope" },
  ]) {
    const r = await run([line]);
    assert.equal(r.ok, false, `${line.kind} ${line.ref} must be rejected`);
    assert.equal(r.code, "REFERENCE_NOT_FOUND");
  }
});

// ═════════════════════════════════════════ WRONG KIND

test("a Part reference submitted as an EQUIPMENT_MODEL is rejected AS A TYPE MISTAKE", async () => {
  // It would fail the existence check anyway. The distinct code and message exist because
  // "no Equipment Model matches CW-P-0000" sends somebody looking for a missing catalog entry that
  // is sitting right there under Parts. Same reference, materially different fix.
  const r = await run([{ lineId: "line-1", kind: "EQUIPMENT_MODEL", ref: "CW-P-0000" }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, "REFERENCE_WRONG_KIND");
  assert.match(r.message, /is a Part/);
});

test("an Equipment Model reference submitted as a PART is rejected AS A TYPE MISTAKE", async () => {
  const r = await run([{ lineId: "line-2", kind: "PART", ref: "taylor--c713" }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, "REFERENCE_WRONG_KIND");
  assert.match(r.message, /is an Equipment Model/);
});

// ═════════════════════════════════════════ the kind this brief does not govern

test("SERVICE lines remain valid — a supported kind is not deleted by a correctness fix", async () => {
  // Rejecting SERVICE because no catalog exists would silently remove a declared commercial
  // capability under the banner of fixing correctness, and a service line is not made truer by
  // refusing it. Left exactly as it is today, and reported.
  const r = await run([{ kind: "SERVICE", ref: "annual-maintenance-visit" }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.reads.getAll, [], "an unvalidatable kind must not cost a read");
});

test("SERVICE mixed with real products validates the products and passes the service through", async () => {
  const r = await run([
    { kind: "SERVICE", ref: "install-labor" },
    { kind: "PART", ref: "CW-P-0000" },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.reads.getAll, [[`${PARTS_COLLECTION}/CW-P-0000`]], "only the checkable line is read");
});

test("a SERVICE line still cannot smuggle in an invalid Part beside it", async () => {
  const r = await run([
    { kind: "SERVICE", ref: "install-labor" },
    { lineId: "line-2", kind: "PART", ref: "asdfgh" },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.message, /line-2/, "the index must survive filtering out the unvalidatable kinds");
});

// ═════════════════════════════════════════ read shape

test("REPEATED REFERENCES COST ONE READ, not one per line", async () => {
  const r = await run([
    { kind: "PART", ref: "CW-P-0000" },
    { kind: "PART", ref: "CW-P-0000" },
    { kind: "PART", ref: "CW-P-0001" },
    { kind: "PART", ref: "CW-P-0000" },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.reads.getAll.length, 1, "one batched read, not four");
  assert.deepEqual(r.reads.getAll[0], [`${PARTS_COLLECTION}/CW-P-0000`, `${PARTS_COLLECTION}/CW-P-0001`]);
});

test("no lines issues no read at all", async () => {
  for (const lines of [[], undefined, null]) {
    const r = await run(lines);
    assert.equal(r.ok, true);
    assert.deepEqual(r.reads.getAll, []);
  }
});

test("the line cap bounds the fan-out", async () => {
  const many = Array.from({ length: MAX_VALIDATED_LINE_REFERENCES + 1 }, (_, i) => ({ kind: "PART", ref: `p${i}` }));
  const r = await run(many);
  assert.equal(r.ok, false);
  assert.equal(r.code, "LINE_INVALID");
  assert.deepEqual(r.reads.getAll, [], "the cap must be refused BEFORE the read, not after");
});

// ═════════════════════════════════════════ no raw ids in what a user reads

test("no message exposes an internal document id the user did not supply", async () => {
  // DECISIONS #106. `ref` is the caller's own input, so quoting it back is identification, not
  // disclosure. Nothing else may appear.
  const RAW_ID = /\b[A-Za-z0-9]{20}\b/;
  for (const line of [
    { lineId: "line-1", kind: "PART", ref: "asdfgh" },
    { lineId: "line-1", kind: "EQUIPMENT_MODEL", ref: "CW-P-0000" },
  ]) {
    const r = await run([line]);
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.message, RAW_ID, `a raw id reached the user: ${r.message}`);
    assert.doesNotMatch(r.message, /Firestore|collection|doc\(/i);
  }
});
