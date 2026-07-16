// Issue #325 / ADR-007 D-FN -- parity test for the server-side
// TypeScript PORT of the Customer Reporting lane's catalog/query-model
// (functions/src/reporting/reportCatalog.ts, reportQueryModel.ts).
//
// No shared/monorepo tooling exists in this repo (every access/ module
// documents "mirrored, not imported"), so the server needs its OWN copy
// of what Customer's F1/F2 units already ship. Rather than trust a
// hand-copy is correct, this test imports the CLIENT's actual .js files
// directly via a relative path (both are dependency-free pure-data
// modules, so a plain Node ESM import across the two packages works
// with no bundler/workspace resolution needed) and structurally diffs
// them against the compiled server port. A drift here means the server
// would authorize/reject a definition differently than the client's own
// F2 validator -- exactly the class of bug ADR-007 sec2.3 warns against
// ("client and server agree on what a well-formed, in-catalog
// definition is").
//
// Prerequisite: `npm run build` in functions/ first (imports the
// compiled lib/ output for the server side).
import assert from "node:assert/strict";
import * as serverCatalog from "../lib/reporting/reportCatalog.js";
import * as serverModel from "../lib/reporting/reportQueryModel.js";
import { validateReportDefinition as serverValidate } from "../lib/reporting/reportQueryValidation.js";
import * as clientCatalog from "../../field-ops-app-vite/src/domain/reporting/reportCatalog.js";
import * as clientModel from "../../field-ops-app-vite/src/domain/reporting/reportQueryModel.js";
import { validateReportDefinition as clientValidate } from "../../field-ops-app-vite/src/domain/reporting/reportQueryValidation.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

function normalize(x) {
  return JSON.parse(JSON.stringify(x));
}

check("REPORT_OBJECTS matches the client catalog exactly", () => {
  assert.deepEqual(normalize(serverCatalog.REPORT_OBJECTS), normalize(clientCatalog.REPORT_OBJECTS));
});

check("REPORT_FIELDS matches the client catalog exactly", () => {
  assert.deepEqual(normalize(serverCatalog.REPORT_FIELDS), normalize(clientCatalog.REPORT_FIELDS));
});

check("REPORT_RELATIONSHIPS matches the client catalog exactly", () => {
  assert.deepEqual(normalize(serverCatalog.REPORT_RELATIONSHIPS), normalize(clientCatalog.REPORT_RELATIONSHIPS));
});

check("objectsWithPopulatedFields() matches the client's wave-1 object list", () => {
  assert.deepEqual(
    normalize(serverCatalog.objectsWithPopulatedFields()),
    normalize(clientCatalog.objectsWithPopulatedFields()),
  );
});

check("getReportObject/getReportField resolve identically for every client-side id", () => {
  for (const o of clientCatalog.REPORT_OBJECTS) {
    assert.deepEqual(normalize(serverCatalog.getReportObject(o.objectId)), normalize(o));
  }
  for (const field of clientCatalog.REPORT_FIELDS) {
    assert.deepEqual(normalize(serverCatalog.getReportField(field.fieldId)), normalize(field));
  }
});

check("relationshipsFrom() matches the client's relationship graph for every object", () => {
  for (const o of clientCatalog.REPORT_OBJECTS) {
    assert.deepEqual(
      normalize(serverCatalog.relationshipsFrom(o.objectId)),
      normalize(clientCatalog.relationshipsFrom(o.objectId)),
    );
  }
});

check("reportQueryModel constants match the client's exactly", () => {
  assert.deepEqual(serverModel.DEFINITION_KEYS, clientModel.DEFINITION_KEYS);
  assert.deepEqual(serverModel.FILTER_KEYS, clientModel.FILTER_KEYS);
  assert.deepEqual(serverModel.SORT_KEYS, clientModel.SORT_KEYS);
  assert.deepEqual(serverModel.AGGREGATE_KEYS, clientModel.AGGREGATE_KEYS);
  assert.deepEqual(serverModel.SORT_DIRECTIONS, clientModel.SORT_DIRECTIONS);
  assert.deepEqual(serverModel.FIELD_AGGREGATE_FUNCTIONS, clientModel.FIELD_AGGREGATE_FUNCTIONS);
  assert.deepEqual(serverModel.FIELDLESS_AGGREGATE_FUNCTIONS, clientModel.FIELDLESS_AGGREGATE_FUNCTIONS);
  assert.deepEqual(serverModel.AGGREGATE_FUNCTIONS, clientModel.AGGREGATE_FUNCTIONS);
  assert.deepEqual(serverModel.FILTER_COMPARATORS_BY_TYPE, clientModel.FILTER_COMPARATORS_BY_TYPE);
  assert.deepEqual(serverModel.ARRAY_VALUE_COMPARATORS, clientModel.ARRAY_VALUE_COMPARATORS);
});

check("isFieldlessAggregate agrees with the client for every real and bogus function name", () => {
  for (const fn of [...clientModel.AGGREGATE_FUNCTIONS, "notARealFn", undefined, null]) {
    assert.equal(serverModel.isFieldlessAggregate(fn), clientModel.isFieldlessAggregate(fn), `mismatch for fn=${JSON.stringify(fn)}`);
  }
});

// --- Wave-1 report.* readCapability ids must also match Issue #226's D-226 catalog exactly ---
// (functions/src/access/permissionCatalog.ts) -- confirms the server catalog port and D-226's
// independently-authored permission catalog were not allowed to silently diverge.
check("every wave-1 readCapability/objectReadCapability id exists in D-226's permissionCatalog.ts", async () => {
  const { PERMISSION_CATALOG } = await import("../lib/access/permissionCatalog.js");
  const known = new Set(PERMISSION_CATALOG.map((p) => p.id));
  for (const o of serverCatalog.objectsWithPopulatedFields()) {
    assert.ok(known.has(o.objectReadCapability), `${o.objectReadCapability} is not in permissionCatalog.ts`);
  }
  const wave1ObjectIds = new Set(serverCatalog.objectsWithPopulatedFields().map((o) => o.objectId));
  for (const field of serverCatalog.REPORT_FIELDS) {
    if (!wave1ObjectIds.has(field.objectId)) continue;
    assert.ok(known.has(field.readCapability), `${field.readCapability} is not in permissionCatalog.ts`);
  }
});

// --- validateReportDefinition() behavioral parity ---
// Same idea, but for the F2 VALIDATOR's decisions, not just its data --
// a battery of valid and invalid fixture definitions must produce
// EQUAL (empty or non-empty, same count) error results from both ports,
// proving the server's execution-time validation gate agrees with the
// client's save-time gate on every case exercised.
const DEFINITION_FIXTURES = [
  { objectId: "customer", fields: ["customer.name"] },
  { objectId: "customer", fields: ["customer.name", "customer.status"], filters: [{ fieldId: "customer.status", op: "eq", value: "Active" }] },
  { objectId: "customer", fields: ["equipment.name"] }, // wrong object -> invalid
  { objectId: "equipment", fields: ["equipment.name", "location.name"] }, // one-hop relationship -> valid
  { objectId: "equipment", fields: ["equipment.name"], filters: [{ fieldId: "equipment.notes", op: "eq", value: "x" }] }, // notes has no filter operator -> invalid
  { objectId: "customer", aggregates: [{ fn: "countRows" }] },
  { objectId: "customer", aggregates: [{ fn: "countRows", fieldId: "customer.name" }] }, // countRows takes no fieldId -> invalid
  { objectId: "customer", fields: ["customer.status"], groupBy: ["customer.status"], aggregates: [{ fieldId: "customer.name", fn: "count" }] },
  { objectId: "customer", fields: ["customer.name"], groupBy: ["customer.status"] }, // ungrouped raw column under grouping -> invalid
  { objectId: "customer" }, // no fields, no aggregates -> invalid
  { objectId: "notAnObject" },
  { notAField: true },
  null,
  "a string, not an object",
  { objectId: "customer", fields: ["customer.name"], sort: [{ fieldId: "customer.name", direction: "asc" }] },
  { objectId: "customer", fields: ["customer.name"], sort: [{ fieldId: "customer.name", direction: "sideways" }] },
  { objectId: "customer", fields: ["customer.name"], extraKey: true },
  { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.createdAt", op: "between", value: [1, 2] }] },
  { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.createdAt", op: "between", value: [1] }] }, // between needs 2 values
];

check("validateReportDefinition() agrees with the client validator on every fixture (same valid/invalid outcome and error count)", () => {
  for (const def of DEFINITION_FIXTURES) {
    const serverErrors = serverValidate(def);
    const clientErrors = clientValidate(def);
    assert.equal(
      serverErrors.length,
      clientErrors.length,
      `error-count mismatch for ${JSON.stringify(def)}: server=${JSON.stringify(serverErrors)} client=${JSON.stringify(clientErrors)}`,
    );
    assert.equal(
      serverErrors.length === 0,
      clientErrors.length === 0,
      `valid/invalid mismatch for ${JSON.stringify(def)}`,
    );
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
