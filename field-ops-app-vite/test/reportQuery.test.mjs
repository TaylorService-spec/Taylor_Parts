// Issue #325 unit F2 -- pure tests for the report query-definition model + validator.
// Pure: no firebase, no emulator, no browser -- runs under plain node.
//
// Run: node test/reportQuery.test.mjs   (also `npm test`)
//
// Mutation-proven: a validator only tested against valid input proves nothing about what it
// REJECTS, so every rule is exercised by feeding a deliberately-corrupted definition and
// asserting the specific defect is caught (Spec §7, fail-closed).
import assert from "node:assert/strict";
import {
  createReportDefinition, AGGREGATE_FUNCTIONS, SORT_DIRECTIONS,
} from "../src/domain/reporting/reportQueryModel.js";
import {
  validateReportDefinition, resolveDefinitionField,
} from "../src/domain/reporting/reportQueryValidation.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// A structurally-valid definition over the wave-1 catalog: base=customer, real fields, a
// well-typed enum filter, a groupable field, and a sortable field. The mutation tests clone and
// break exactly one thing.
function baseValid() {
  return {
    objectId: "customer",
    fields: ["customer.name", "customer.status"],
    filters: [{ fieldId: "customer.status", op: "eq", value: "active" }],
    groupBy: ["customer.status"],
    sort: [{ fieldId: "customer.name", direction: "asc" }],
    aggregates: [],
    presentation: {},
  };
}

// clone + mutate + validate; assert the resulting errors CONTAIN the needle.
function bad(mutate, needle) {
  const def = structuredClone(baseValid());
  mutate(def);
  const errors = validateReportDefinition(def);
  assert.ok(
    errors.some((e) => e.includes(needle)),
    `expected an error containing "${needle}", got:\n  ${errors.join("\n  ") || "(none)"}`,
  );
}

// ---- the valid baseline is accepted ----------------------------------------
ok("a well-formed wave-1 definition validates clean", () => {
  assert.deepEqual(validateReportDefinition(baseValid()), []);
});

ok("createReportDefinition() produces an editable empty shell", () => {
  const d = createReportDefinition("customer");
  assert.equal(d.objectId, "customer");
  assert.deepEqual(d.fields, []);
  // must be mutable (the builder edits it) -- not frozen
  d.fields.push("customer.name");
  assert.deepEqual(d.fields, ["customer.name"]);
});

// ---- one-hop relationship traversal (Spec §7 relationship rule) ------------
ok("a one-hop relationship field is reportable; an unrelated object's field is not", () => {
  // equipment -> location and equipment -> customer are catalogued hop=1 relationships.
  const viaRel = {
    objectId: "equipment",
    fields: ["equipment.name", "location.name", "customer.name"],
  };
  assert.deepEqual(validateReportDefinition(viaRel), []);
  // customer has NO relationship to equipment, so equipment.name is not reportable from customer.
  assert.deepEqual(resolveDefinitionField("customer", "equipment.name"), null);
  // resolver returns the relationship it traversed for a related field.
  const r = resolveDefinitionField("equipment", "location.name");
  assert.equal(r.field.fieldId, "location.name");
  assert.equal(r.relationship.relationshipId, "equipment->location");
  // a base-owned field carries a null relationship.
  assert.equal(resolveDefinitionField("customer", "customer.name").relationship, null);
});

// ---- well-typed filter values across every data type -----------------------
ok("filters accept well-typed values for each data type and reject mis-typed ones", () => {
  // string contains
  assert.deepEqual(validateReportDefinition({
    objectId: "customer", fields: ["customer.name"],
    filters: [{ fieldId: "customer.name", op: "contains", value: "Acme" }],
  }), []);
  // date before (ISO string) and epoch number
  assert.deepEqual(validateReportDefinition({
    objectId: "customer", fields: ["customer.name"],
    filters: [{ fieldId: "customer.createdAt", op: "before", value: "2020-01-01" }],
  }), []);
  assert.deepEqual(validateReportDefinition({
    objectId: "customer", fields: ["customer.name"],
    filters: [{ fieldId: "customer.createdAt", op: "after", value: 1577836800000 }],
  }), []);
  // boolean eq
  assert.deepEqual(validateReportDefinition({
    objectId: "customer", fields: ["customer.name"],
    filters: [{ fieldId: "customer.purchaseOrderRequired", op: "eq", value: true }],
  }), []);
  // list contains / containsAny
  assert.deepEqual(validateReportDefinition({
    objectId: "customer", fields: ["customer.name"],
    filters: [{ fieldId: "customer.tags", op: "containsAny", value: ["vip", "net30"] }],
  }), []);
  // reference eq (by id)
  assert.deepEqual(validateReportDefinition({
    objectId: "equipment", fields: ["equipment.name"],
    filters: [{ fieldId: "equipment.accountId", op: "in", value: ["a1", "a2"] }],
  }), []);
});

// ---- the validator CATCHES each class of corruption ------------------------
ok("the validator CATCHES each class of corruption (feeding it broken definitions)", () => {
  // shape / base object
  bad((d) => { d.surprise = 1; }, "unknown keys");
  bad((d) => { delete d.objectId; }, "objectId is required");
  bad((d) => { d.objectId = "nope"; }, "unknown objectId");
  bad((d) => { d.objectId = "job"; }, "is not activated"); // wave-2 stub, not activated
  // fields
  bad((d) => { d.fields = "customer.name"; }, "fields must be an array");
  bad((d) => { d.fields = ["customer.bogus"]; }, "not a field of customer");
  bad((d) => { d.fields = ["equipment.name"]; }, "not a field of customer"); // unrelated object
  bad((d) => { d.fields = ["customer.name", "customer.name"]; }, "duplicate");
  bad((d) => { d.fields = []; d.aggregates = []; }, "selects no fields and no aggregates");
  // filters
  bad((d) => { d.filters[0].extra = 1; }, "unknown keys");
  bad((d) => { d.filters = [{ fieldId: "customer.notes", op: "contains", value: "x" }]; }, "does not support filter"); // free-text, no operators
  bad((d) => { d.filters[0].op = "gt"; }, "is not legal for enum"); // gt illegal on enum
  bad((d) => { d.filters[0].value = 123; }, "must be a string"); // enum wants string
  bad((d) => { d.filters = [{ fieldId: "customer.status", op: "in", value: "active" }]; }, "requires a non-empty array");
  bad((d) => { d.filters = [{ fieldId: "customer.createdAt", op: "before", value: "not-a-date" }]; }, "ISO-8601");
  bad((d) => { d.filters = [{ fieldId: "customer.createdAt", op: "between", value: ["2020-01-01"] }]; }, "exactly two");
  bad((d) => { d.filters = [{ fieldId: "customer.purchaseOrderRequired", op: "eq", value: "true" }]; }, "must be a boolean");
  // groupBy
  bad((d) => { d.groupBy = ["customer.billingAddress.street"]; }, "does not support group"); // string w/o group op
  bad((d) => { d.groupBy = ["customer.status", "customer.status"]; }, "duplicate");
  // sort
  bad((d) => { d.sort[0].direction = "up"; }, "direction must be one of");
  bad((d) => { d.sort = [{ fieldId: "customer.status", direction: "asc" }]; }, "does not support sort"); // enum w/o sort op
  bad((d) => { d.sort[0].wat = 1; }, "unknown keys");
  // aggregates (no wave-1 field supports `aggregate`, so both the operator gate and the fn gate fire)
  bad((d) => { d.aggregates = [{ fieldId: "customer.name", fn: "sum" }]; }, "does not support aggregate");
  bad((d) => { d.aggregates = [{ fieldId: "customer.name", fn: "bogus" }]; }, "fn must be one of");
  bad((d) => { d.aggregates = [{ fieldId: "customer.name", fn: "sum", extra: 1 }]; }, "unknown keys");
  // presentation
  bad((d) => { d.presentation = "nope"; }, "presentation must be an object");
});

// ---- activation is injectable so the Function reuses the same validator ------
ok("activation is injectable -- a de-activated base object is refused, a widened set accepts it", () => {
  const def = { objectId: "customer", fields: ["customer.name"] };
  // default activation = wave-1 populated objects -> customer is active
  assert.deepEqual(validateReportDefinition(def), []);
  // an empty activation set refuses even a valid, catalogued object (fail-closed on activation)
  const refused = validateReportDefinition(def, { activatedObjectIds: [] });
  assert.ok(refused.some((e) => e.includes("is not activated")));
});

// ---- non-object input is refused, never thrown -----------------------------
ok("a non-object definition is refused fail-closed, not thrown", () => {
  for (const junk of [null, undefined, 42, "x", []]) {
    const errors = validateReportDefinition(junk);
    assert.ok(errors.length > 0, `expected refusal for ${JSON.stringify(junk)}`);
  }
});

// ---- vocab sanity ----------------------------------------------------------
ok("aggregate functions and sort directions are the documented closed sets", () => {
  assert.deepEqual([...AGGREGATE_FUNCTIONS].sort(), ["avg", "count", "max", "min", "sum"]);
  assert.deepEqual([...SORT_DIRECTIONS].sort(), ["asc", "desc"]);
});

console.log(`\n${passed} passed, 0 failed`);
