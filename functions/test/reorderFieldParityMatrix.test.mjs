// The parity matrix's proof. The point of this suite is that the matrix CANNOT be the thing that
// decides what a legacy Reorder is: firestore.rules decides, and the matrix is checked against it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REORDER_FIELD_PARITY_MATRIX, REORDER_FIELD_DISPOSITIONS, IDENTITY_CONVERSIONS,
  copiedFields, identityConversionFields, schemaParityCorrections, blockerConditions,
} from "../lib/eosOps/migration/reorderFieldParityMatrix.js";

/**
 * The CLOSED legacy key set, extracted from firestore.rules.
 *
 * Comments are stripped FIRST and deliberately: a comment inside this very function contains a
 * literal "])" that truncates a naive slice, which is exactly the kind of near-miss that makes a
 * hand-maintained list look correct.
 */
function legacyKeysFromRules() {
  const src = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  const start = src.indexOf("function hasCanonicalReorderRequestKeys");
  assert.notEqual(start, -1, "firestore.rules no longer declares hasCanonicalReorderRequestKeys");
  const body = src.slice(start, start + 4000);
  const slice = (tag) => {
    const s = body.indexOf(tag);
    assert.notEqual(s, -1, `hasCanonicalReorderRequestKeys no longer calls ${tag}`);
    return body.slice(s, body.indexOf("])", s));
  };
  const keys = (s) => [...new Set((s.match(/"([A-Za-z]+)"/g) ?? []).map((x) => x.slice(1, -1)))];
  return { hasOnly: keys(slice("hasOnly([")), hasAll: keys(slice("hasAll([")) };
}

test("the matrix and firestore.rules name exactly the same legacy fields", () => {
  const { hasOnly } = legacyKeysFromRules();
  const classified = REORDER_FIELD_PARITY_MATRIX.map((m) => m.legacyField);

  const unclassified = hasOnly.filter((k) => !classified.includes(k));
  assert.deepEqual(unclassified, [],
    `these legacy Reorder fields have NO disposition, so the copy would silently drop them: ${unclassified.join(", ")}`);

  const phantom = classified.filter((k) => !hasOnly.includes(k));
  assert.deepEqual(phantom, [],
    `the matrix classifies fields firestore.rules does not permit on a Reorder: ${phantom.join(", ")}`);

  assert.equal(classified.length, hasOnly.length, "the matrix has a duplicate legacyField");
  assert.equal(new Set(classified).size, classified.length, "the matrix has a duplicate legacyField");
});

test("the three optional keys are the record-generation seam, and they block rather than backfill", () => {
  const { hasOnly, hasAll } = legacyKeysFromRules();
  const optional = hasOnly.filter((k) => !hasAll.includes(k)).sort();
  assert.deepEqual(optional, ["operatingCompanyId", "warehouseId", "workOrderId"]);

  // The two ownership facts are NOT NULL in PostgreSQL, so a generation-1 row cannot satisfy them.
  // Each must therefore carry a blocker: refusing is the only honest answer, and inferring a
  // warehouse or a company is exactly what the live create command refuses to do.
  for (const field of ["warehouseId", "operatingCompanyId"]) {
    const entry = REORDER_FIELD_PARITY_MATRIX.find((m) => m.legacyField === field);
    assert.ok(entry.blocker, `${field} must state how a generation-1 record blocks the copy`);
  }
  // workOrderId is a pure provenance back-link: optional by design, and absence is not a defect.
  assert.equal(REORDER_FIELD_PARITY_MATRIX.find((m) => m.legacyField === "workOrderId").blocker, null);
});

test("there is no implicit disposition: every field is classified, targeted and vocabulary-valid", () => {
  for (const m of REORDER_FIELD_PARITY_MATRIX) {
    assert.ok(REORDER_FIELD_DISPOSITIONS.includes(m.disposition),
      `${m.legacyField} carries an unknown disposition ${m.disposition}`);
    assert.ok(IDENTITY_CONVERSIONS.includes(m.identityConversion),
      `${m.legacyField} carries an unknown identity conversion ${m.identityConversion}`);
    assert.ok(typeof m.targetAuthority === "string" && m.targetAuthority.trim().length > 0,
      `${m.legacyField} names no target authority -- that is what silent loss looks like`);
    assert.equal(typeof m.copied, "boolean");
    assert.equal(typeof m.schemaParityCorrection, "boolean");
    assert.ok(m.blocker === null || (typeof m.blocker === "string" && m.blocker.trim().length > 0));
  }
});

test("a field may be left out of the Reorder row ONLY when its disposition says where the fact went", () => {
  // These four are the only dispositions that relocate a fact. Anything else that is not copied is
  // a fact that stopped existing without anyone deciding so.
  const RELOCATES = ["GOVERNED_ASSIGNMENT_FACT", "GOVERNED_OTHER_OBJECT_FACT", "DERIVED", "APPROVED_RETIREMENT"];
  for (const m of REORDER_FIELD_PARITY_MATRIX.filter((x) => !x.copied)) {
    assert.ok(RELOCATES.includes(m.disposition),
      `${m.legacyField} is not copied and its disposition ${m.disposition} does not say where its meaning went`);
  }
});

test("every authored Reorder business fact survives the copy", () => {
  // A GOVERNED_REORDER_FACT is, by definition, the Reorder's own fact. If one were not copied it
  // would have been dropped while claiming to be governed.
  for (const m of REORDER_FIELD_PARITY_MATRIX.filter((x) => x.disposition === "GOVERNED_REORDER_FACT")) {
    assert.equal(m.copied, true, `${m.legacyField} claims to be a governed Reorder fact but is not copied`);
  }
  // The specific authored facts the Owner named. Derived from the matrix, asserted by name here
  // because losing one of these silently is the failure this whole gate exists to prevent.
  for (const field of ["reviewDecision", "reviewNotes", "cancellationReason", "purchasingNotes",
    "vendorContacted", "expectedAvailabilityDate"]) {
    const entry = REORDER_FIELD_PARITY_MATRIX.find((m) => m.legacyField === field);
    assert.ok(entry.copied, `${field} is an authored business fact and must not be dropped`);
  }
  // voidReason is authored too -- it survives in the already-canonical void record, not by being dropped.
  const voidReason = REORDER_FIELD_PARITY_MATRIX.find((m) => m.legacyField === "voidReason");
  assert.equal(voidReason.disposition, "GOVERNED_OTHER_OBJECT_FACT");
  assert.match(voidReason.targetAuthority, /purchase_order_voids\.reason/);
});

test("no audit event is used to retire an authored business field", () => {
  // Audit of a mutation and the fact the mutation produced are not the same thing, so no field may
  // name audit_events as the place its meaning went.
  for (const m of REORDER_FIELD_PARITY_MATRIX) {
    assert.doesNotMatch(m.targetAuthority, /audit_events/,
      `${m.legacyField} retires into audit_events, which records that a mutation happened rather than the fact it produced`);
  }
});

test("every uid-bearing field converts, and no uid is copied forward", () => {
  const converting = identityConversionFields();
  // Every legacy identity field must state its conversion; a LEGACY_IDENTITY with conversion NONE
  // would be a uid landing in a governed column.
  for (const m of REORDER_FIELD_PARITY_MATRIX.filter((x) => x.disposition === "LEGACY_IDENTITY")) {
    assert.notEqual(m.identityConversion, "NONE",
      `${m.legacyField} holds a Firebase uid and must state how it resolves to a governed identity`);
  }
  assert.ok(converting.length >= 10, "the uid surface is larger than the assignment triple");
  // The assignment identity resolves to an EMPLOYEE; every other identity resolves to a PRINCIPAL.
  const toEmployee = converting.filter((m) => m.identityConversion === "UID_TO_EMPLOYEE").map((m) => m.legacyField);
  assert.deepEqual(toEmployee, ["assignedToUserId"],
    "the Employee is the business assignee; no other legacy field resolves to an Employee");
});

test("requestedBy is provenance, not authority, and never blocks", () => {
  const requester = REORDER_FIELD_PARITY_MATRIX.find((m) => m.legacyField === "requestedBy");
  assert.equal(requester.disposition, "LEGACY_IDENTITY");
  assert.equal(requester.identityConversion, "UID_TO_PRINCIPAL");
  assert.equal(requester.copied, true);
  // The measurement said nothing reads it back, so an unresolved historical requester is recorded
  // as unknown rather than blocking a record from migrating.
  assert.equal(requester.blocker, null,
    "requested_by is written and never read back, so an unresolved requester is provenance, not a blocker");
  // And it must be able to say "unknown" truthfully, which today's NOT NULL column cannot.
  assert.equal(requester.schemaParityCorrection, true);
  assert.match(requester.targetAuthority, /NULL/);
});

test("the assignment triple stays in the assignment authority and never becomes Reorder columns", () => {
  for (const field of ["assignedToUserId", "assignedBy", "assignedAt"]) {
    const m = REORDER_FIELD_PARITY_MATRIX.find((x) => x.legacyField === field);
    assert.equal(m.disposition, "GOVERNED_ASSIGNMENT_FACT");
    assert.equal(m.copied, false, `${field} must not become a column on reorder_requests`);
    assert.match(m.targetAuthority, /reorder_request_assignments/);
    assert.equal(m.schemaParityCorrection, false, "the assignment authority already exists");
  }
});

test("the derivations agree with the matrix", () => {
  const copied = copiedFields();
  assert.equal(copied.length, REORDER_FIELD_PARITY_MATRIX.filter((m) => m.copied).length);
  assert.deepEqual([...copied], [...copied].sort(), "copiedFields must be deterministic");

  const corrections = schemaParityCorrections();
  assert.ok(corrections.length > 0, "the copy cannot be truthful against today's schema");
  for (const field of corrections) {
    const m = REORDER_FIELD_PARITY_MATRIX.find((x) => x.legacyField === field);
    assert.equal(m.copied, true, "a schema parity correction exists to receive a copied value");
  }

  const blockers = blockerConditions();
  for (const [field, reason] of blockers) {
    assert.ok(reason.trim().length > 0, `${field} states an empty blocker`);
  }
});

test("the matrix decides nothing and scans nothing: pure data plus derivations", async () => {
  const src = readFileSync(new URL("../src/eosOps/migration/reorderFieldParityMatrix.ts", import.meta.url), "utf8");
  for (const forbidden of ["firebase-admin", "require(", "readFileSync", "process.env", "pg", "Date.now"]) {
    assert.ok(!src.includes(forbidden), `the matrix must not reach for ${forbidden}`);
  }
  assert.ok(Object.isFrozen(REORDER_FIELD_PARITY_MATRIX));
  for (const m of REORDER_FIELD_PARITY_MATRIX) assert.ok(Object.isFrozen(m));
});
