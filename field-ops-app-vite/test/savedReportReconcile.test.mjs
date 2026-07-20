// Issue #325 / ADR-007 W-SAVE-UI -- pure tests for revalidate + reconcile-on-open.
// Pure: no firebase, no browser -- runs under plain node.
//
// The load-bearing behaviors: fail closed on unusable saved reports, and DROP + SURFACE catalog
// drift (removed fields / relationships / operators / predicates) WITHOUT ever restoring it.
// Catalog drift is simulated by referencing ids the real catalog does not offer -- exactly what a
// removed field/relationship looks like.
//
// Run: node test/savedReportReconcile.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { reconcileSavedReport, describeReconciliation } from "../src/domain/reporting/savedReportReconcile.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

function saved(definition) {
  return { id: "r1", name: "R", ownerUid: "u1", definition, createdAt: 1, updatedAt: 2 };
}

// ---- clean open ------------------------------------------------------------
ok("a still-valid saved report opens clean: openable, nothing dropped, no residual errors", () => {
  const res = reconcileSavedReport(saved({
    objectId: "customer",
    fields: ["customer.name", "customer.status"],
    filters: [{ fieldId: "customer.status", op: "eq", value: "active" }],
    groupBy: [],
    sort: [{ fieldId: "customer.name", direction: "asc" }],
    aggregates: [],
    presentation: {},
  }));
  assert.equal(res.openable, true);
  assert.equal(res.changed, false);
  assert.deepEqual(res.residualErrors, []);
  assert.deepEqual(res.dropped.fields, []);
  assert.equal(describeReconciliation(res), null);
});

// ---- fail closed (unopenable) ----------------------------------------------
ok("fail closed on malformed / unknown-keys / missing or de-activated base object", () => {
  const unopenable = (definition, opts) => {
    const res = reconcileSavedReport(saved(definition), opts);
    assert.equal(res.openable, false, `expected unopenable for ${JSON.stringify(definition)}`);
    assert.equal(res.definition, null);
    assert.match(res.reason, /can't be opened|no longer available/);
  };
  unopenable("not-an-object");
  unopenable({ objectId: "customer", fields: ["customer.name"], sneaky: 1 }); // unknown top-level key
  unopenable({ objectId: "notARealObject", fields: ["x"] });                   // unknown base object
  unopenable({ objectId: "job", fields: ["job.status"] });                     // real object, NOT activated
  unopenable({ objectId: "customer", fields: ["customer.name"] }, { activatedObjectIds: [] }); // de-activated
  // a non-object saved report at all
  assert.equal(reconcileSavedReport(null).openable, false);
});

// ---- reconcile: drop + surface, never restore ------------------------------
ok("a removed COLUMN is dropped and surfaced, never restored", () => {
  const res = reconcileSavedReport(saved({
    objectId: "customer",
    fields: ["customer.name", "customer.goneField"], // goneField no longer catalogued
  }));
  assert.equal(res.openable, true);
  assert.equal(res.changed, true);
  assert.deepEqual(res.dropped.fields, ["customer.goneField"]);
  assert.deepEqual(res.definition.fields, ["customer.name"], "surviving fields only");
  assert.ok(!res.definition.fields.includes("customer.goneField"), "never restored");
  assert.match(describeReconciliation(res), /no longer available/);
});

ok("removed FILTERS, GROUPINGS, SORTS, and field-bound AGGREGATES are each dropped; countRows survives", () => {
  const res = reconcileSavedReport(saved({
    objectId: "customer",
    fields: ["customer.status"],
    filters: [
      { fieldId: "customer.status", op: "eq", value: "active" },   // keep
      { fieldId: "customer.goneField", op: "eq", value: "x" },      // drop: removed field
      { fieldId: "customer.status", op: "gt", value: "x" },         // drop: op not legal for enum (operator drift)
      { fieldId: "customer.status", op: "eq", value: "x", extra: 1 }, // drop: unknown clause key
    ],
    groupBy: ["customer.status", "customer.goneField"],             // drop the removed one
    sort: [
      { fieldId: "customer.name", direction: "asc" },              // keep
      { fieldId: "customer.name", direction: "sideways" },         // drop: bad direction
      { fieldId: "customer.goneField", direction: "asc" },         // drop: removed field
    ],
    aggregates: [
      { fn: "countRows" },                                         // keep: fieldless
      { fieldId: "customer.name", fn: "sum" },                     // drop: string can't aggregate
    ],
  }));
  assert.equal(res.openable, true);
  assert.equal(res.dropped.filters, 3);
  assert.deepEqual(res.definition.filters.map((f) => f.op), ["eq"]);
  assert.deepEqual(res.dropped.groupBy, ["customer.goneField"]);
  assert.deepEqual(res.definition.groupBy, ["customer.status"]);
  assert.equal(res.dropped.sort.length, 2);
  assert.deepEqual(res.definition.sort, [{ fieldId: "customer.name", direction: "asc" }]);
  assert.equal(res.dropped.aggregates, 1);
  assert.deepEqual(res.definition.aggregates, [{ fn: "countRows" }]); // countRows retained
});

ok("a related-object field whose relationship is gone is dropped (customer has no ->location hop)", () => {
  const res = reconcileSavedReport(saved({
    objectId: "customer",
    fields: ["customer.name", "location.name"], // no customer->location relationship
  }));
  assert.deepEqual(res.dropped.fields, ["location.name"]);
  assert.deepEqual(res.definition.fields, ["customer.name"]);
});

// ---- residual validity surfaced, still not restored ------------------------
ok("when drops leave the definition invalid, residual errors are SURFACED (not auto-repaired)", () => {
  // The only projected column is removed -> after the drop the report selects nothing.
  const res = reconcileSavedReport(saved({
    objectId: "customer",
    fields: ["customer.goneField"],
  }));
  assert.equal(res.openable, true);
  assert.equal(res.changed, true);
  assert.deepEqual(res.definition.fields, []); // dropped, never restored
  assert.ok(res.residualErrors.some((e) => e.includes("selects no fields and no aggregates")));
});

ok("dropping a grouped field surfaces a grouping-consistency residual, never re-adds the group", () => {
  const res = reconcileSavedReport(saved({
    objectId: "customer",
    fields: ["customer.name", "customer.status"],
    groupBy: ["customer.status", "customer.goneField"],
    aggregates: [{ fn: "countRows" }],
  }));
  // goneField group is dropped; customer.name is projected but no longer grouped -> residual
  assert.deepEqual(res.dropped.groupBy, ["customer.goneField"]);
  assert.ok(!res.definition.groupBy.includes("customer.goneField"));
  assert.ok(res.residualErrors.some((e) => e.includes("must be grouped")));
});

// ---- safe surfacing --------------------------------------------------------
ok("describeReconciliation returns safe, count-based copy and null when nothing changed", () => {
  const clean = reconcileSavedReport(saved({ objectId: "customer", fields: ["customer.name"] }));
  assert.equal(describeReconciliation(clean), null);
  const drifted = reconcileSavedReport(saved({ objectId: "customer", fields: ["customer.name", "customer.goneField"], filters: [{ fieldId: "customer.goneField", op: "eq", value: "x" }] }));
  const msg = describeReconciliation(drifted);
  assert.match(msg, /1 column/);
  assert.match(msg, /1 filter/);
  assert.doesNotMatch(msg, /goneField/); // counts, not raw ids, in the summary sentence
});

ok("surfaced copy (announced by assistive tech) never leaks a raw object/field id", () => {
  // unopenable reason must not echo the raw (possibly sensitive) collection/object id
  const bad = reconcileSavedReport(saved({ objectId: "secret_internal_collection", fields: ["x"] }));
  assert.equal(bad.openable, false);
  assert.doesNotMatch(bad.reason, /secret_internal_collection/);
  // the drift summary counts parts, never names raw field ids
  const drift = reconcileSavedReport(saved({ objectId: "customer", fields: ["customer.name", "customer.secretHiddenField"] }));
  assert.doesNotMatch(describeReconciliation(drift), /secretHiddenField/);
});

console.log(`\n${passed} passed, 0 failed`);
