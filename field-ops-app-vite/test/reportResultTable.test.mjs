// Issue #325 / ADR-007 W1 -- pure tests for the result-table column/cell helpers. The
// load-bearing one is FIELD OMISSION: a field the runner may not read is absent from the row
// objects (the trusted Function projected it out), so it must never become a column here.
// Pure node.
//
// Run: node test/reportResultTable.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  rowColumns, aggregateColumns, aggregateColumnLabel, formatCell,
} from "../src/domain/reporting/reportResultTable.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

ok("FIELD OMISSION: a selected field absent from the projected rows is not a column", () => {
  // The author selected name + paymentTerms; the runner couldn't read paymentTerms, so the
  // Function returned rows WITHOUT it. It must not appear as a column.
  const selected = ["customer.name", "customer.paymentTerms"];
  const rows = [{ "customer.name": "Acme" }, { "customer.name": "Globex" }];
  const cols = rowColumns(selected, rows);
  assert.deepEqual(cols.map((c) => c.key), ["customer.name"]);
  assert.equal(cols[0].label, "Name"); // labelled from the catalog
  assert.ok(!cols.some((c) => c.key === "customer.paymentTerms"), "dropped field is omitted");
});

ok("rowColumns keeps the author's field order and labels from the catalog", () => {
  const selected = ["customer.status", "customer.name"];
  const rows = [{ "customer.status": "active", "customer.name": "Acme" }];
  const cols = rowColumns(selected, rows);
  assert.deepEqual(cols.map((c) => c.key), ["customer.status", "customer.name"]);
  assert.deepEqual(cols.map((c) => c.label), ["Status", "Name"]);
});

ok("an unexpected extra key is still shown (defensive), after the selected ones", () => {
  const cols = rowColumns(["customer.name"], [{ "customer.name": "Acme", "mystery": 1 }]);
  assert.deepEqual(cols.map((c) => c.key), ["customer.name", "mystery"]);
  assert.equal(cols[1].label, "mystery"); // no catalog label -> raw key
});

ok("aggregateColumns labels group fields and renders countRows as 'Row count'", () => {
  const rows = [{ "customer.status": "active", "countRows": 12 }];
  const cols = aggregateColumns(rows);
  assert.deepEqual(cols.map((c) => c.label).sort(), ["Row count", "Status"]);
  assert.equal(aggregateColumnLabel("countRows"), "Row count");
  assert.equal(aggregateColumnLabel("customer.name"), "Name");
});

ok("formatCell renders values safely and never surfaces a nested object shape", () => {
  assert.equal(formatCell(null), "—");
  assert.equal(formatCell(undefined), "—");
  assert.equal(formatCell(true), "Yes");
  assert.equal(formatCell(false), "No");
  assert.equal(formatCell("Acme"), "Acme");
  assert.equal(formatCell(42), "42");
  assert.equal(formatCell(["a", "b"]), "a, b");
  assert.equal(formatCell({ secret: 1 }), ""); // objects are never rendered structurally
  assert.equal(formatCell([{ secret: 1 }, "ok"]), "ok");
});

console.log(`\n${passed} passed, 0 failed`);
