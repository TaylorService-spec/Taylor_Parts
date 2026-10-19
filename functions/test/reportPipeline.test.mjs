// THE REPORT PIPELINE (Firebase exit B4, DECISIONS #B4) -- the pure in-memory query core the EOS report engine shares with the Firebase engine's semantics.
// Each helper is pinned with the cases reportExecutionService.test.mjs asserts of the Firebase engine, so the two cannot drift without a build failing.
// Run: node --test test/reportPipeline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const P = await import("../lib/reporting/reportPipeline.js");
const { getReportField } = await import("../lib/reporting/reportCatalog.js");

const docs = [
  { id: "a", name: "Acme", status: "ACTIVE", tags: ["x", "y"], createdAt: "2024-01-05T00:00:00.000Z", billingAddress: { city: "Phoenix" } },
  { id: "b", name: "Beta", status: "PROSPECT", tags: [], createdAt: "2024-03-01T00:00:00.000Z", billingAddress: { city: "Tempe" } },
  { id: "c", name: "acorn", status: "ACTIVE", tags: ["y"], createdAt: null, billingAddress: { city: "Phoenix" } },
];
const flt = (fieldId, op, value) => ({ fieldId, op, value });
const ids = (rows) => rows.map((d) => d.id);
const match = (f) => ids(docs.filter((d) => P.matchesFilter(d, "customer", f)));

test("field access: the raw path is the field id minus its object, nested paths resolve, a missing path is undefined", () => {
  const city = getReportField("customer.billingAddress.city");
  assert.equal(P.rawFieldPath(city), "billingAddress.city");
  assert.equal(P.getFieldValue(docs[0], "customer", city), "Phoenix");
  assert.equal(P.getAtPath(docs[0], "billingAddress.zip"), undefined);
  assert.equal(P.getAtPath(docs[0], "name.length.x"), undefined);
  // A related-object field reads the JOINED document, never the base one.
  const locName = getReportField("location.name");
  assert.equal(P.getFieldValue({ name: "base", __related__location: { name: "Main Site" } }, "equipment", locName), "Main Site");
  assert.equal(P.getFieldValue({ name: "base" }, "equipment", locName), undefined);
});

test("filters: equality, set, string, list and number comparators; an unknown operator never matches", () => {
  assert.deepEqual(match(flt("customer.status", "eq", "ACTIVE")), ["a", "c"]);
  assert.deepEqual(match(flt("customer.status", "ne", "ACTIVE")), ["b"]);
  assert.deepEqual(match(flt("customer.status", "in", ["PROSPECT", "ARCHIVED"])), ["b"]);
  assert.deepEqual(match(flt("customer.name", "contains", "c")), ["a", "c"]);
  assert.deepEqual(match(flt("customer.name", "startsWith", "Ac")), ["a"], "case-sensitive, as in Firebase");
  assert.deepEqual(match(flt("customer.tags", "contains", "y")), ["a", "c"], "a list field's `contains` matches an element");
  assert.deepEqual(match(flt("customer.tags", "containsAny", ["x", "zzz"])), ["a"]);
  assert.deepEqual(match(flt("customer.status", "bogus", "ACTIVE")), []);
  assert.equal(P.matchesFilter({ n: 5 }, "customer", { fieldId: "customer.nope", op: "eq", value: 1 }), true, "an unresolvable field is the validator's job, not a silent exclusion");
});

test("date filters compare as instants; an unreadable date matches neither `eq` nor `ne`; `between` is inclusive", () => {
  const created = "customer.createdAt";
  assert.deepEqual(match(flt(created, "before", "2024-02-01")), ["a"]);
  assert.deepEqual(match(flt(created, "after", "2024-02-01")), ["b"]);
  assert.deepEqual(match(flt(created, "between", ["2024-01-05T00:00:00.000Z", "2024-03-01T00:00:00.000Z"])), ["a", "b"]);
  assert.deepEqual(match(flt(created, "between", ["2024-01-05"])), []);
  assert.deepEqual(match(flt(created, "eq", "2024-03-01T00:00:00.000Z")), ["b"]);
  assert.deepEqual(match(flt(created, "ne", "2024-03-01T00:00:00.000Z")), ["a"], "the row with no date is neither equal nor not-equal");
  assert.equal(P.toComparableDate("not a date"), null);
  assert.equal(P.toComparableDate({ toMillis: () => 5 }), 5);
});

test("sort: first key primary, stable ties, descending, and null/undefined always LAST", () => {
  const rows = [{ n: "b", c: 1 }, { n: null, c: 2 }, { n: "a", c: 1 }, { n: "b", c: 0 }];
  // customer.name is a catalog field; the raw path is `name`.
  const byName = P.sortRows(rows.map((r) => ({ name: r.n, c: r.c })), "customer", [{ fieldId: "customer.name", direction: "asc" }]);
  assert.deepEqual(byName.map((r) => r.name), ["a", "b", "b", null]);
  const desc = P.sortRows(rows.map((r) => ({ name: r.n, c: r.c })), "customer", [{ fieldId: "customer.name", direction: "desc" }]);
  assert.deepEqual(desc.map((r) => r.name), ["b", "b", "a", null], "nulls last in BOTH directions (the documented intent; the Firebase engine's code puts them first on `desc`)");
  assert.deepEqual(P.sortRows(rows, "customer", []), rows);
  assert.equal(P.compareValues(1, 2) < 0, true);
  assert.equal(P.compareValues({ toMillis: () => 9 }, { toMillis: () => 3 }) > 0, true);
});

test("group and aggregate: buckets keep their rows; sum/avg/min/max/count over finite numbers only; countRows needs no field", () => {
  const groups = P.groupDocuments(docs, "customer", ["customer.status"]);
  assert.deepEqual([...groups.keys()].sort(), ['"ACTIVE"', '"PROSPECT"']);
  assert.equal(groups.get('"ACTIVE"').length, 2);
  assert.equal(P.groupDocuments(docs, "customer", []).size, 1, "no group key = one bucket");
  assert.equal(P.aggregateResultKey({ fn: "countRows" }), "countRows");
  assert.equal(P.aggregateResultKey({ fn: "sum", fieldId: "customer.x" }), "sum(customer.x)");
  assert.equal(P.computeAggregate(docs, "customer", { fn: "countRows" }), 3);
  // The catalog carries no numeric field today, so every field aggregate runs over non-numeric values: 0, never NaN, never a string concatenation.
  for (const fn of ["count", "sum", "avg", "min", "max"]) {
    assert.equal(P.computeAggregate(docs, "customer", { fn, fieldId: "customer.name" }), 0, fn);
  }
  assert.equal(P.computeAggregate(docs, "customer", { fn: "sum", fieldId: "customer.nope" }), 0, "an unresolvable field aggregates to 0");
});

test("projection: ONLY the authorized fields appear, absent values are null, a missing field id is skipped", () => {
  assert.deepEqual(P.projectDoc(docs[1], "customer", ["customer.name", "customer.status"]), { "customer.name": "Beta", "customer.status": "PROSPECT" });
  assert.deepEqual(P.projectDoc({ name: "x" }, "customer", ["customer.status", "customer.nope"]), { "customer.status": null });
  assert.deepEqual(P.projectDoc(docs[0], "customer", []), {}, "nothing authorized = an empty row, never the whole document");
});

test("the two completeness judgements: a cut scan refuses totals and absences; a bounded page may be a page", () => {
  assert.equal(P.judgeScanCompleteness({ scanTruncated: false, hasAggregates: true }), "complete");
  assert.equal(P.judgeScanCompleteness({ scanTruncated: true, hasAggregates: false }), "bounded-page");
  assert.equal(P.judgeScanCompleteness({ scanTruncated: true, hasAggregates: true }), "refuse-incomplete-total");
  assert.equal(P.judgeAbsenceProvenance({ scanTruncated: true, rowCount: 3 }), "not-an-absence");
  assert.equal(P.judgeAbsenceProvenance({ scanTruncated: false, rowCount: 0 }), "proven-absence");
  assert.equal(P.judgeAbsenceProvenance({ scanTruncated: true, rowCount: 0 }), "refuse-unproven-absence");
  assert.equal(P.judgeAbsenceProvenance({ scanTruncated: false, rowCount: 0, joinIncomplete: true }), "refuse-unproven-absence");
  assert.deepEqual([P.MAX_RESULT_ROWS, P.MAX_GROUP_CARDINALITY, P.MAX_SCAN_DOCS], [10000, 1000, 20000], "the bounds the Firebase engine enforces");
});

test("the pipeline imports nothing but the pure catalog: no Firebase, no database, no clock", () => {
  const src = readFileSync(new URL("../src/reporting/reportPipeline.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./reportCatalog", "./reportQueryModel"]);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /Date\.now|new Date\(|firebase|require\(|process\./);
  // The CSV parser the shared Data Import intake needs is import-free too, so an EOS operation can use that intake without loading the Admin SDK.
  const csv = readFileSync(new URL("../src/partMaster/csvParse.ts", import.meta.url), "utf8");
  assert.deepEqual([...csv.matchAll(/^import /gm)], []);
  const intake = readFileSync(new URL("../src/dataImport/importIntake.ts", import.meta.url), "utf8");
  assert.match(intake, /from "\.\.\/partMaster\/csvParse\.js"/);
  assert.doesNotMatch(intake, /csvMigrationAnalysis\.js"/);
});
