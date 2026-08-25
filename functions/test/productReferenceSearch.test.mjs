// THE PRODUCT PICKER'S READ — bounded, minimal, and it must not become a catalog download.
//
// Run: node --test test/productReferenceSearch.test.mjs   (after `npm run build`)
import test from "node:test";
import assert from "node:assert/strict";
import {
  projectProductReference,
  searchParts,
  listEquipmentModels,
  MIN_SEARCH_LENGTH,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  EQUIPMENT_MODEL_LIST_CAP,
} from "../lib/salesAgreement/productReferenceSearchService.js";

// ═════════════════════════════════════════ a query-recording Firestore stand-in

function fakeDb(docsByCollection) {
  const queries = [];
  const makeQuery = (collection) => {
    const state = { collection, startAt: null, endAt: null, limit: null, orderBy: null };
    const q = {
      orderBy: (f) => { state.orderBy = f; return q; },
      startAt: (v) => { state.startAt = v; return q; },
      endAt: (v) => { state.endAt = v; return q; },
      limit: (n) => { state.limit = n; return q; },
      get: async () => {
        queries.push({ ...state });
        const all = docsByCollection[collection] ?? [];
        let rows = all;
        if (state.startAt !== null) {
          rows = rows.filter((d) => d.id >= state.startAt && d.id <= state.endAt);
        }
        return { docs: rows.slice(0, state.limit ?? rows.length).map((d) => ({ id: d.id, data: () => d.data })) };
      },
    };
    return q;
  };
  return { db: { collection: (c) => makeQuery(c) }, queries };
}

const PARTS = [
  { id: "CW-P-0000", data: { name: "Evaporator Fan Motor", status: "ACTIVE", cost: 4200, supplierId: "sup-1" } },
  { id: "CW-P-0001", data: { name: "Drive Belt", status: "ACTIVE" } },
  { id: "CW-P-0002", data: { name: "Door Gasket", status: "DISCONTINUED" } },
  { id: "ZZ-OTHER-1", data: { name: "Unrelated", status: "ACTIVE" } },
];
const MODELS = [
  { id: "taylor--c161", data: { displayName: "Taylor C161", modelNumber: "C161", status: "ACTIVE" } },
  { id: "taylor--c713", data: { modelNumber: "C713", status: "ACTIVE" } },
];

// ═════════════════════════════════════════ the projection is MINIMAL

test("the projection returns identity, a label and status — AND NOTHING COMMERCIAL", () => {
  const p = projectProductReference("CW-P-0000", PARTS[0].data, "PART");
  assert.deepEqual(Object.keys(p).sort(), ["displayName", "kind", "ref", "status"]);
  assert.equal(p.ref, "CW-P-0000");
  assert.equal(p.displayName, "Evaporator Fan Motor");
  // A picker does not need cost or supplier, and a salesperson's picker is not the place to
  // disclose them. This assertion failing on a new field is the guard working.
  assert.equal("cost" in p, false);
  assert.equal("supplierId" in p, false);
});

test("THE IDENTITY IS THE DOCUMENT ID, never a field that could disagree with it", () => {
  // A doc whose `partId` field contradicted its own id would otherwise let the picker store a ref
  // that resolves to nothing -- passing the picker and failing validation at accept.
  const p = projectProductReference("CW-P-0000", { partId: "SOMETHING-ELSE", name: "X" }, "PART");
  assert.equal(p.ref, "CW-P-0000");
});

test("an equipment model falls back to modelNumber, and NEVER to the raw id", () => {
  assert.equal(projectProductReference("taylor--c161", MODELS[0].data, "EQUIPMENT_MODEL").displayName, "Taylor C161");
  assert.equal(projectProductReference("taylor--c713", MODELS[1].data, "EQUIPMENT_MODEL").displayName, "C713");
  // No name at all is an honest null -- the surface renders its own absence copy. DECISIONS #106:
  // a missing name is not permission to display the id as though it were one.
  assert.equal(projectProductReference("taylor--x", { status: "ACTIVE" }, "EQUIPMENT_MODEL").displayName, null);
});

test("an unrecognised status is reported honestly, not guessed", () => {
  assert.equal(projectProductReference("p", { name: "n", status: "   " }, "PART").status, null);
  assert.equal(projectProductReference("p", { name: "n" }, "PART").status, null);
});

// ═════════════════════════════════════════ the typeahead is BOUNDED

test("A SHORT QUERY READS NOTHING", async () => {
  // The threshold is not a nicety. A one-character prefix over a real parts catalog returns an
  // arbitrary slice of thousands of rows -- the whole-catalog read wearing a filter, which is the
  // boundary this entire service exists to respect.
  const { db, queries } = fakeDb({ parts: PARTS });
  for (const q of ["", " ", "C"]) {
    assert.deepEqual(await searchParts(db, q, DEFAULT_SEARCH_LIMIT), []);
  }
  assert.equal(queries.length, 0, "below the threshold, no read is issued at all");
});

test("the search is a bounded PREFIX RANGE over the id, with no composite index", async () => {
  const { db, queries } = fakeDb({ parts: PARTS });
  const out = await searchParts(db, "CW-P", 10);
  assert.deepEqual(out.map((p) => p.ref), ["CW-P-0000", "CW-P-0001", "CW-P-0002"]);
  assert.ok(queries.length >= 1);
  for (const q of queries) {
    assert.equal(q.collection, "parts");
    assert.equal(q.orderBy, "__name__", "ordering by id is what avoids needing a composite index");
    assert.equal(q.limit, 10, "every read is capped");
    assert.ok(q.endAt.endsWith(""), "the prefix sentinel bounds the range");
  }
});

test("THE LIMIT IS HONOURED ACROSS the case-variant reads, not per read", async () => {
  const { db } = fakeDb({ parts: PARTS });
  const out = await searchParts(db, "cw-p", 2);
  assert.equal(out.length, 2, "two reads must not be able to return 2x the cap");
});

test("a lower-case query still finds an upper-case catalog, without assuming either", async () => {
  // Upper-casing unconditionally would work here and silently return nothing for a catalog that is
  // not upper case -- a local convention promoted to a requirement, failing as "no such part".
  const { db, queries } = fakeDb({ parts: PARTS });
  const out = await searchParts(db, "cw-p", 10);
  assert.deepEqual(out.map((p) => p.ref), ["CW-P-0000", "CW-P-0001", "CW-P-0002"]);
  assert.equal(queries.length, 2, "the raw and upper-case forms differ, so both are asked");
});

test("a query already upper-case costs ONE read, not two", async () => {
  const { db, queries } = fakeDb({ parts: PARTS });
  await searchParts(db, "CW-P", 10);
  assert.equal(queries.length, 1);
});

test("results are DEDUPED across the variant reads", async () => {
  const { db } = fakeDb({ parts: PARTS });
  const out = await searchParts(db, "cw-p", 10);
  assert.equal(new Set(out.map((p) => p.ref)).size, out.length, "the same part must not appear twice");
});

test("a prefix that matches nothing is an empty result, not an error", async () => {
  const { db } = fakeDb({ parts: PARTS });
  assert.deepEqual(await searchParts(db, "QQ-NOPE", 10), []);
});

// ═════════════════════════════════════════ the equipment picker

test("equipment models are listed whole but CAPPED, ordered by id not by a droppable field", async () => {
  const { db, queries } = fakeDb({ equipment_models: MODELS });
  const out = await listEquipmentModels(db, EQUIPMENT_MODEL_LIST_CAP);
  assert.deepEqual(out.map((m) => m.ref), ["taylor--c161", "taylor--c713"]);
  // A Firestore orderBy is also a FILTER: ordering on displayName would silently drop every model
  // that lacks one, and taylor--c713 has none.
  assert.equal(queries[0].orderBy, "__name__");
  assert.equal(queries[0].limit, EQUIPMENT_MODEL_LIST_CAP);
});

// ═════════════════════════════════════════ the bounds are real numbers

test("the declared bounds are sane and bounded", () => {
  assert.ok(MIN_SEARCH_LENGTH >= 2);
  assert.ok(DEFAULT_SEARCH_LIMIT <= MAX_SEARCH_LIMIT);
  assert.ok(MAX_SEARCH_LIMIT <= 50, "a picker page must never become a bulk export");
  assert.ok(EQUIPMENT_MODEL_LIST_CAP <= 500);
});
