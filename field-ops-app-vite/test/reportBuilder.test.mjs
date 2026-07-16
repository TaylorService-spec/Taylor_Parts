// Issue #325 unit F3 -- pure tests for the report builder's model, the gated execution seam,
// and the result-state categorizer. Pure: no firebase, no browser -- runs under plain node.
// (The ReportBuilder.jsx view itself is verified in a real browser: keyboard + 375px + the
// full state matrix.)
//
// Run: node test/reportBuilder.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  availableObjects, availableFieldGroups, defaultComparator,
  setObject, toggleField, toggleGroupBy, addFilter, updateFilter, removeFilter,
  addSort, updateSort, removeSort, builderErrors, builderStatus,
  hasCountRows, toggleCountRows,
} from "../src/domain/reporting/reportBuilderModel.js";
import { createReportDefinition } from "../src/domain/reporting/reportQueryModel.js";
import { describeRunOutcome } from "../src/domain/reporting/reportResultState.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// never leak a raw Firebase code/path/id/collection into user copy (Spec §12)
const RAW_LEAKS = /permission-denied|firestore\/|FirebaseError|code:|Missing or insufficient|apiKey|AIza|documents\/|accounts|contacts|locations|equipment\/|collection|stack/i;

// ---- object picker ---------------------------------------------------------
ok("the object picker offers wave-1 objects as selectable and later waves as coming-soon", () => {
  const objs = availableObjects();
  const byId = Object.fromEntries(objs.map((o) => [o.objectId, o]));
  for (const id of ["customer", "contact", "location", "equipment"]) {
    assert.equal(byId[id].comingSoon, false, `${id} should be selectable`);
  }
  for (const id of ["job", "workOrder", "employee", "serviceHistory"]) {
    assert.equal(byId[id].comingSoon, true, `${id} should be coming-soon`);
  }
  // every catalogued object is represented (nothing silently hidden)
  assert.equal(objs.length, 12);
});

// ---- field groups (base + one-hop related) ---------------------------------
ok("field groups list the base object's fields plus activated one-hop related objects", () => {
  const groups = availableFieldGroups("equipment");
  assert.equal(groups[0].objectId, "equipment");
  assert.ok(groups[0].fields.some((f) => f.fieldId === "equipment.name"));
  const relObjects = groups.slice(1).map((g) => g.objectId).sort();
  // equipment -> location and equipment -> customer are hop=1 and both activated
  assert.deepEqual(relObjects, ["customer", "location"]);
  // each field carries its catalog operators so the view drives controls off them
  const notes = groups[0].fields.find((f) => f.fieldId === "equipment.notes");
  assert.deepEqual([...notes.operators], []); // free-text: no clause controls
});

ok("a related object with no catalogued fields (employee from customer) is omitted, not empty", () => {
  const groups = availableFieldGroups("customer");
  const ids = groups.map((g) => g.objectId);
  assert.ok(ids.includes("contact"), "billingContact -> contact is activated");
  assert.ok(!ids.includes("employee"), "accountOwner -> employee is a stub; offer nothing");
});

ok("a later-wave (unpopulated) base object offers no field groups", () => {
  assert.deepEqual(availableFieldGroups("job"), []);
});

// ---- reducers are non-mutating and keep the definition valid-shaped --------
ok("reducers build a valid definition without mutating their input", () => {
  const empty = createReportDefinition(null);
  const d1 = setObject(empty, "customer");
  assert.equal(empty.objectId, null, "input not mutated");
  assert.equal(d1.objectId, "customer");

  const d2 = toggleField(d1, "customer.name");
  assert.deepEqual(d1.fields, [], "input not mutated");
  assert.deepEqual(d2.fields, ["customer.name"]);
  // toggle off again
  assert.deepEqual(toggleField(d2, "customer.name").fields, []);

  // group by the PROJECTED field so the definition stays grouping-consistent (Spec §7, F4):
  // a projected non-aggregate column must itself be grouped when the report groups.
  const d3 = toggleGroupBy(d2, "customer.name");
  assert.deepEqual(d3.groupBy, ["customer.name"]);

  const op = defaultComparator("enum");
  assert.equal(op, "eq");
  const d4 = addFilter(d3, { fieldId: "customer.status", op, value: "active" });
  assert.equal(d4.filters.length, 1);
  const d5 = updateFilter(d4, 0, { value: "inactive" });
  assert.equal(d5.filters[0].value, "inactive");
  assert.equal(d4.filters[0].value, "active", "updateFilter did not mutate");
  assert.equal(removeFilter(d5, 0).filters.length, 0);

  const d6 = addSort(d5, "customer.name");
  assert.deepEqual(d6.sort, [{ fieldId: "customer.name", direction: "asc" }]);
  assert.equal(addSort(d6, "customer.name").sort.length, 1, "one sort entry per field");
  assert.equal(updateSort(d6, 0, { direction: "desc" }).sort[0].direction, "desc");
  assert.equal(removeSort(d6, 0).sort.length, 0);

  // the assembled definition is valid per the F2 validator
  assert.deepEqual(builderErrors(d6), []);
});

ok("deselecting a column prunes its filter/group/sort so no clause is orphaned", () => {
  let def = setObject(createReportDefinition(null), "customer");
  def = toggleField(def, "customer.name");   // string: filter/sort/group
  def = toggleField(def, "customer.status"); // enum: filter/group
  def = addFilter(def, { fieldId: "customer.name", op: "contains", value: "Acme" });
  def = toggleGroupBy(def, "customer.name");
  def = addSort(def, "customer.name");
  // remove the customer.name column -> its filter, groupBy, and sort go with it
  const pruned = toggleField(def, "customer.name");
  assert.deepEqual(pruned.fields, ["customer.status"]);
  assert.deepEqual(pruned.filters, []);
  assert.deepEqual(pruned.groupBy, []);
  assert.deepEqual(pruned.sort, []);
  // the earlier def is untouched (non-mutating)
  assert.equal(def.filters.length, 1);
});

ok("changing the base object clears field-referencing clauses (they can't carry over)", () => {
  let def = setObject(createReportDefinition(null), "customer");
  def = toggleField(def, "customer.name");
  def = addFilter(def, { fieldId: "customer.status", op: "eq", value: "active" });
  const switched = setObject(def, "equipment");
  assert.deepEqual(switched.fields, []);
  assert.deepEqual(switched.filters, []);
  assert.equal(switched.objectId, "equipment");
});

ok("countRows toggle adds/removes the fieldless aggregate and stays grouping-consistent", () => {
  let def = setObject(createReportDefinition(null), "customer");
  assert.equal(hasCountRows(def), false);
  def = toggleCountRows(def);
  assert.equal(hasCountRows(def), true);
  assert.deepEqual(def.aggregates, [{ fn: "countRows" }]);
  // countRows alone (no projected fields) is a valid total-count report
  assert.deepEqual(builderErrors(def), []);
  assert.equal(builderStatus(def), "ready");
  // adding an ungrouped column makes it invalid (grouping consistency); grouping it fixes it
  def = toggleField(def, "customer.status");
  assert.ok(builderErrors(def).some((e) => e.includes("must be grouped")));
  def = toggleGroupBy(def, "customer.status");
  assert.deepEqual(builderErrors(def), []);
  // toggling countRows off removes it (non-mutating)
  const off = toggleCountRows(def);
  assert.equal(hasCountRows(off), false);
  assert.equal(hasCountRows(def), true);
});

ok("builderStatus reflects empty -> invalid -> ready", () => {
  assert.equal(builderStatus(createReportDefinition(null)), "empty");
  const noCols = setObject(createReportDefinition(null), "customer"); // object but no fields
  assert.equal(builderStatus(noCols), "invalid");
  const ready = toggleField(noCols, "customer.name");
  assert.equal(builderStatus(ready), "ready");
});

// (The execution seam's D-FN wiring and its outcome/error mapping are tested in
// reportRunOutcome.test.mjs -- that logic is pure; the seam itself just imports firebase.)

// ---- result-state categorizer: full matrix, safe copy ----------------------
ok("describeRunOutcome maps every state-matrix kind to safe, correctly-toned copy", () => {
  const cases = {
    idle: { tone: "info", role: "status" },
    loading: { tone: "info", role: "status" },
    empty: { tone: "info", role: "status" },
    "permission-denied": { tone: "error", role: "alert" },
    "partially-authorized": { tone: "warning", role: "status" },
    unsupported: { tone: "warning", role: "status" },
    "truncated-widened": { tone: "warning", role: "status" },
    failure: { tone: "error", role: "alert" },
    unavailable: { tone: "info", role: "status" },
  };
  for (const [kind, want] of Object.entries(cases)) {
    const desc = describeRunOutcome({ kind });
    assert.equal(desc.kind, kind);
    assert.equal(desc.tone, want.tone, `${kind} tone`);
    assert.equal(desc.role, want.role, `${kind} role`);
    const text = [desc.title, desc.message, ...desc.notes].filter(Boolean).join(" ");
    assert.doesNotMatch(text, RAW_LEAKS, `${kind} copy must not leak internals`);
  }
});

ok("permission-denied reads as access, never a field enumeration", () => {
  const desc = describeRunOutcome({ kind: "permission-denied" });
  assert.match(desc.title + desc.message, /access/i);
});

ok("partially-authorized names dropped COLUMNS (runner-selected) but only COUNTS dropped predicates", () => {
  const desc = describeRunOutcome({
    kind: "partially-authorized",
    droppedColumnLabels: ["Payment terms", "Tax status"],
    droppedPredicateCount: 2,
  });
  const text = desc.notes.join(" ");
  assert.match(text, /Payment terms/); // a column the runner put there -> safe to name
  assert.match(text, /2 filters/);      // predicates are counted, never named
  // a malformed non-string label can't inject anything
  const safe = describeRunOutcome({ kind: "partially-authorized", droppedColumnLabels: [{ evil: 1 }], droppedPredicateCount: 0 });
  assert.doesNotMatch(safe.notes.join(" "), /evil|object Object/);
});

ok("truncated-widened surfaces the cap and never claims completeness", () => {
  const desc = describeRunOutcome({ kind: "truncated-widened", truncated: true, widened: true, rowCap: 10000 });
  const text = desc.notes.join(" ");
  assert.match(text, /10,000/);
  assert.match(text, /wider|cut off|isn't complete/i);
});

ok("an unknown/garbage outcome fails closed to a safe failure state", () => {
  for (const junk of [null, undefined, {}, { kind: "nonsense" }, 42]) {
    const desc = describeRunOutcome(junk);
    assert.equal(desc.kind, "failure");
    assert.equal(desc.role, "alert");
    assert.doesNotMatch(desc.message, RAW_LEAKS);
  }
});

console.log(`\n${passed} passed, 0 failed`);
