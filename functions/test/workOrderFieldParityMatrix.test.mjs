// The Work Order parity matrix's proof. The matrix cannot be the thing that decides what a legacy
// Work Order is: the WorkOrder interface decides, and the matrix is checked against it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORK_ORDER_FIELD_PARITY_MATRIX, WORK_ORDER_FIELD_DISPOSITIONS, IDENTITY_CONVERSIONS,
  copiedFields, identityConversionFields, schemaParityCorrections, blockerConditions,
} from "../lib/eosOps/migration/workOrderFieldParityMatrix.js";

/**
 * The legacy Work Order field set, extracted from the interface that defines it.
 *
 * firestore.rules gives no key list for Work Orders because it permits no client write at all
 * (`allow create, update, delete: if false`). The interface plus the Admin-SDK commands are the
 * contract, so that is what this reads.
 */
function fieldsFromInterface() {
  const src = readFileSync(new URL("../src/types/workOrder.ts", import.meta.url), "utf8");
  const start = src.indexOf("export interface WorkOrder {");
  assert.notEqual(start, -1, "types/workOrder.ts no longer declares the WorkOrder interface");
  const body = src.slice(start, src.indexOf("\n}", start))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  return [...body.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\??\s*:/gm)].map((m) => m[1]);
}

test("the matrix and the WorkOrder interface name exactly the same fields", () => {
  const declared = fieldsFromInterface();
  assert.ok(declared.length >= 40, "the extraction found suspiciously few fields; it has probably broken");
  const classified = WORK_ORDER_FIELD_PARITY_MATRIX.map((m) => m.legacyField);

  const unclassified = declared.filter((k) => !classified.includes(k));
  assert.deepEqual(unclassified, [],
    `these Work Order fields have NO disposition, so a copy would silently drop them: ${unclassified.join(", ")}`);

  const phantom = classified.filter((k) => !declared.includes(k));
  assert.deepEqual(phantom, [],
    `the matrix classifies fields the WorkOrder interface does not declare: ${phantom.join(", ")}`);

  assert.equal(new Set(classified).size, classified.length, "the matrix has a duplicate legacyField");
});

test("there is no implicit disposition: every field is classified, targeted and vocabulary-valid", () => {
  for (const m of WORK_ORDER_FIELD_PARITY_MATRIX) {
    assert.ok(WORK_ORDER_FIELD_DISPOSITIONS.includes(m.disposition), `${m.legacyField}: ${m.disposition}`);
    assert.ok(IDENTITY_CONVERSIONS.includes(m.identityConversion), `${m.legacyField}: ${m.identityConversion}`);
    assert.ok(typeof m.targetAuthority === "string" && m.targetAuthority.trim().length > 0,
      `${m.legacyField} names no target authority -- that is what silent loss looks like`);
    assert.equal(typeof m.copied, "boolean");
    assert.equal(typeof m.schemaParityCorrection, "boolean");
    assert.ok(m.blocker === null || (typeof m.blocker === "string" && m.blocker.trim().length > 0));
  }
});

test("a field may be left out of the Work Order row ONLY when its disposition says where it went", () => {
  // LEGACY_IDENTITY relocates as well: the RESOLVED identity lands on the assignment row's
  // ended_by_principal_id. What must never happen is the legacy value being copied as-is, which the
  // identity test below asserts separately.
  const RELOCATES = ["GOVERNED_ASSIGNMENT_FACT", "GOVERNED_OTHER_OBJECT_FACT", "DERIVED",
    "SUPERSEDED_BY_HISTORY", "LEGACY_IDENTITY", "APPROVED_RETIREMENT"];
  for (const m of WORK_ORDER_FIELD_PARITY_MATRIX.filter((x) => !x.copied)) {
    assert.ok(RELOCATES.includes(m.disposition),
      `${m.legacyField} is not copied and its disposition ${m.disposition} does not say where its meaning went`);
  }
});

test("BOTH technician fields are one assignment axis, and neither becomes a Work Order column", () => {
  // #1915 section 3.2: planned vs dispatched is the STATUS, not a second assignee. Keeping two
  // columns would recreate the ambiguity the interval model exists to remove.
  for (const field of ["scheduledTechId", "assignedTechId"]) {
    const m = WORK_ORDER_FIELD_PARITY_MATRIX.find((x) => x.legacyField === field);
    assert.equal(m.disposition, "GOVERNED_ASSIGNMENT_FACT", field);
    assert.equal(m.copied, false, `${field} must not become a column on work_orders`);
    assert.equal(m.identityConversion, "TECHNICIAN_TO_EMPLOYEE",
      "a fieldops_technicians id is not an Employee id");
    assert.match(m.targetAuthority, /work_order_assignments/);
    assert.ok(m.blocker, `${field} must state how an unresolvable technician blocks the copy`);
  }
});

test("every legacy identity converts, and no uid or technician id is copied forward", () => {
  const converting = identityConversionFields();
  // Seven: four technician fields and three uid-bearing ones. Larger than the two assignee columns
  // a reader would expect, which is the point of counting it.
  assert.equal(converting.length, 7, "the legacy identity surface is larger than the two assignee fields");
  for (const m of converting) {
    assert.equal(m.copied, false,
      `${m.legacyField} carries a legacy identity and must not be copied into the governed row as-is`);
  }
  // The four uid fields resolve to PRINCIPALS; the four technician fields resolve to EMPLOYEES.
  const toPrincipal = converting.filter((m) => m.identityConversion === "UID_TO_PRINCIPAL").map((m) => m.legacyField).sort();
  assert.deepEqual(toPrincipal, ["executionLog", "reassignedByUid", "rescheduledByUid"]);
  const toEmployee = converting.filter((m) => m.identityConversion === "TECHNICIAN_TO_EMPLOYEE").map((m) => m.legacyField).sort();
  assert.deepEqual(toEmployee,
    ["assignedTechId", "reassignedFromTechId", "rescheduledFromTechId", "scheduledTechId"]);
});

test("the per-write snapshots are retired INTO history, not dropped", () => {
  // Each snapshot holds only the LATEST reassignment and is overwritten by the next, so the legacy
  // record has already lost the earlier ones. Retiring them into interval rows is a gain in history.
  const superseded = WORK_ORDER_FIELD_PARITY_MATRIX.filter((m) => m.disposition === "SUPERSEDED_BY_HISTORY");
  assert.ok(superseded.length >= 8);
  for (const m of superseded) {
    assert.equal(m.copied, false);
    assert.match(m.targetAuthority, /assignment row|effective_to|effective_from|end_reason|schedule_history|work_order_transitions/,
      `${m.legacyField} must name the history that now holds it`);
  }
});

test("no authored Work Order fact is dropped, and none retires into an audit event", () => {
  for (const m of WORK_ORDER_FIELD_PARITY_MATRIX.filter((x) => x.disposition === "GOVERNED_WORK_ORDER_FACT")) {
    assert.equal(m.copied, true, `${m.legacyField} claims to be a governed Work Order fact but is not copied`);
  }
  for (const field of ["complaint", "diagnosis", "resolution"]) {
    assert.ok(WORK_ORDER_FIELD_PARITY_MATRIX.find((m) => m.legacyField === field).copied,
      `${field} is an authored business fact and must not be dropped`);
  }
  // Audit of a mutation and the fact it produced are not the same thing.
  for (const m of WORK_ORDER_FIELD_PARITY_MATRIX) {
    assert.doesNotMatch(m.targetAuthority, /audit_events/, `${m.legacyField} retires into audit_events`);
  }
});

test("the two update timestamps are reconciled rather than both carried", () => {
  const last = WORK_ORDER_FIELD_PARITY_MATRIX.find((m) => m.legacyField === "lastUpdated");
  assert.equal(last.disposition, "DERIVED");
  assert.equal(last.copied, false);
  assert.ok(last.blocker, "a disagreement between the two must be caught, not silently resolved");
  assert.ok(WORK_ORDER_FIELD_PARITY_MATRIX.find((m) => m.legacyField === "updatedAt").copied);
});

test("the derivations agree with the matrix", () => {
  const copied = copiedFields();
  assert.deepEqual([...copied], [...copied].sort(), "copiedFields must be deterministic");
  for (const field of schemaParityCorrections()) {
    assert.ok(WORK_ORDER_FIELD_PARITY_MATRIX.some((m) => m.legacyField === field));
  }
  for (const [field, reason] of blockerConditions()) {
    assert.ok(reason.trim().length > 0, `${field} states an empty blocker`);
  }
});

test("the matrix decides nothing and scans nothing: pure data plus derivations", () => {
  const src = readFileSync(new URL("../src/eosOps/migration/workOrderFieldParityMatrix.ts", import.meta.url), "utf8");
  for (const forbidden of ["firebase-admin", "require(", "readFileSync", "process.env", "Date.now"]) {
    assert.ok(!src.includes(forbidden), `the matrix must not reach for ${forbidden}`);
  }
  assert.ok(Object.isFrozen(WORK_ORDER_FIELD_PARITY_MATRIX));
  for (const m of WORK_ORDER_FIELD_PARITY_MATRIX) assert.ok(Object.isFrozen(m));
});
