// F-RULES-1 PR-0 -- tests for the READ-ONLY legacy job/technician
// compatibility audit. Exercises the PURE analyzer + the CLI project
// guard directly (no Firestore, no emulator, no credentials).
//
// Run: node --test test/auditLegacyJobTechnicianData.test.js

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  analyzeLegacyData,
  assertProjectTarget,
  parseArgs,
  isValidIdentifier,
  InvalidInvocationError,
  FIRESTORE_METHODS_USED,
  PRODUCTION_PROJECT_ID,
} = require("../scripts/auditLegacyJobTechnicianData");

// A fully compatible baseline: one dispatcher, one mapped technician
// user, its technician doc, and one valid assigned job.
function cleanDataset() {
  return {
    users: [
      { id: "u-admin", role: "admin" },
      { id: "u-disp", role: "dispatcher" },
      { id: "u-tech1", role: "technician", technicianId: "T1" },
    ],
    technicians: [{ id: "T1", name: "Tech One", phone: "555", status: "available", createdAt: 1 }],
    jobs: [{ id: "J1", status: "assigned", technicianId: "T1" }],
  };
}

function checkById(result, id) {
  return result.checkResults.find((c) => c.id === id);
}

test("1. clean compatible dataset -> GO, no blockers", () => {
  const r = analyzeLegacyData(cleanDataset());
  assert.equal(r.finalDecision, "GO");
  assert.equal(r.blockerCount, 0);
});

test("2. technician user missing technicianId -> NO-GO (A1) and D1", () => {
  const d = cleanDataset();
  d.users.push({ id: "u-tech2", role: "technician" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "A1").documentIds.includes("u-tech2"));
  assert.ok(checkById(r, "D1").documentIds.includes("u-tech2"));
});

test("3. user references missing technician doc -> NO-GO (A2)", () => {
  const d = cleanDataset();
  d.users.push({ id: "u-tech3", role: "technician", technicianId: "GHOST" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "A2").documentIds.includes("u-tech3"));
  assert.ok(checkById(r, "D1").documentIds.includes("u-tech3"));
});

test("4. duplicate technician mapping -> REVIEW (A3), still GO", () => {
  const d = cleanDataset();
  d.users.push({ id: "u-tech1b", role: "technician", technicianId: "T1" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "GO");
  assert.deepEqual(checkById(r, "A3").documentIds, ["T1"]);
});

test("5. unreferenced technician -> REVIEW (A4), still GO", () => {
  const d = cleanDataset();
  d.technicians.push({ id: "T2", name: "Two", phone: "5", status: "off_shift", createdAt: 1 });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "GO");
  assert.ok(checkById(r, "A4").documentIds.includes("T2"));
});

test("6. job missing status -> NO-GO (B1)", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J2", technicianId: "T1" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.deepEqual(checkById(r, "B1").documentIds, ["J2"]);
});

test("7. unknown job status -> NO-GO (B2)", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J3", status: "cancelled", technicianId: "T1" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.deepEqual(checkById(r, "B2").documentIds, ["J3"]);
});

test("8. assigned job missing technicianId -> NO-GO (B3)", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J4", status: "assigned" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.deepEqual(checkById(r, "B3").documentIds, ["J4"]);
});

test("9. in_progress job missing technicianId -> NO-GO (B3)", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J5", status: "in_progress", technicianId: "" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "B3").documentIds.includes("J5"));
});

test("10. open job with technicianId -> REVIEW (B4), still GO", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J6", status: "open", technicianId: "T1" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "GO");
  assert.deepEqual(checkById(r, "B4").documentIds, ["J6"]);
});

test("11. job references missing technician -> REVIEW (B5), still GO", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J7", status: "open", technicianId: "GHOST" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "GO");
  assert.ok(checkById(r, "B5").documentIds.includes("J7"));
});

test("12. invalid technician status -> NO-GO (C2)", () => {
  const d = cleanDataset();
  d.technicians.push({ id: "T9", name: "Nine", phone: "5", status: "vacationing", createdAt: 1 });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.deepEqual(checkById(r, "C2").documentIds, ["T9"]);
});

test("13. malformed technician field types -> NO-GO (C3)", () => {
  const d = cleanDataset();
  d.technicians.push({ id: "T10", name: 42, phone: "5", status: "available", createdAt: "nope" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "C3").documentIds.includes("T10"));
});

test("14. unknown technician field -> REVIEW (C4), not a blocker", () => {
  const d = cleanDataset();
  d.technicians.push({ id: "T11", name: "Eleven", phone: "5", status: "available", createdAt: 1, skills: ["hvac"] });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "GO");
  assert.deepEqual(checkById(r, "C4").documentIds, ["T11"]);
  assert.equal(checkById(r, "C4").classification, "REVIEW");
});

test("15. multiple blocker categories -> one NO-GO with complete counts", () => {
  const d = cleanDataset();
  d.users.push({ id: "u-techX", role: "technician" });         // A1
  d.jobs.push({ id: "JX", status: "weird" });                   // B2 (+B3? no: not assigned/in_progress)
  d.jobs.push({ id: "JY", status: "assigned" });                // B3
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(r.blockerCount >= 3);
  assert.equal(checkById(r, "A1").count, 1);
  assert.equal(checkById(r, "B2").count, 1);
  assert.equal(checkById(r, "B3").count, 1);
});

test("16. output identifiers are deterministically sorted", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J-c", status: "assigned" });
  d.jobs.push({ id: "J-a", status: "assigned" });
  d.jobs.push({ id: "J-b", status: "assigned" });
  const r = analyzeLegacyData(d);
  assert.deepEqual(checkById(r, "B3").documentIds, ["J-a", "J-b", "J-c"]);
});

test("17. no sensitive field values appear in structured output", () => {
  const d = cleanDataset();
  d.technicians.push({ id: "T-sens", name: "Jane Q Public", phone: "555-123-4567", status: "vacationing", createdAt: 1 });
  d.jobs.push({ id: "J-sens", status: "assigned", technicianId: "T1", customer: { name: "ACME", address: "1 Secret Rd" } });
  const r = analyzeLegacyData(d);
  const blob = JSON.stringify(r);
  for (const secret of ["Jane Q Public", "555-123-4567", "ACME", "1 Secret Rd"]) {
    assert.ok(!blob.includes(secret), `structured output must not contain "${secret}"`);
  }
});

test("18. missing --projectId is rejected (invalid invocation)", () => {
  assert.throws(() => assertProjectTarget(parseArgs([])), InvalidInvocationError);
  assert.throws(() => assertProjectTarget(parseArgs(["--json"])), InvalidInvocationError);
});

test("19. production project WITHOUT confirmation is rejected", () => {
  assert.throws(
    () => assertProjectTarget(parseArgs(["--projectId", PRODUCTION_PROJECT_ID])),
    InvalidInvocationError,
  );
});

test("20. production project with INCORRECT confirmation is rejected", () => {
  assert.throws(
    () => assertProjectTarget(parseArgs(["--projectId", PRODUCTION_PROJECT_ID, "--confirmProduction", "taylor-part"])),
    InvalidInvocationError,
  );
});

test("21. non-production project does NOT require the production confirmation", () => {
  const projectId = assertProjectTarget(parseArgs(["--projectId", "demo-fixture"]));
  assert.equal(projectId, "demo-fixture");
  // production id WITH exact confirmation is also accepted
  assert.equal(
    assertProjectTarget(parseArgs(["--projectId", PRODUCTION_PROJECT_ID, "--confirmProduction", PRODUCTION_PROJECT_ID])),
    PRODUCTION_PROJECT_ID,
  );
});

test("22. read-only method surface contains no write API", () => {
  // Structural assertion that the declared Firestore surface is read-only.
  const WRITE_APIS = /set|add|update|delete|batch|runTransaction|BulkWriter|writeBatch|FieldValue/i;
  for (const m of FIRESTORE_METHODS_USED) {
    assert.ok(!WRITE_APIS.test(m), `declared method "${m}" must not be a write API`);
  }
  assert.ok(FIRESTORE_METHODS_USED.some((m) => m.includes("get")), "must declare a read (get) method");
});

// --------------------------------------------------------------------
// PR-0 review correction: blank / whitespace-only / whitespace-padded
// technician identifiers must be rejected and never trimmed-and-matched.
// --------------------------------------------------------------------

test("23. predicate: blank/whitespace/padded ids are invalid; exact ids valid", () => {
  for (const bad of [null, undefined, "", "   ", "\t", " T1 ", "T1 ", " T1"]) {
    assert.equal(isValidIdentifier(bad), false, `${JSON.stringify(bad)} must be invalid`);
  }
  assert.equal(isValidIdentifier("T1"), true);
});

test("24. technician-role user with technicianId '   ' -> A1 + D1 + NO-GO", () => {
  const d = cleanDataset();
  d.users.push({ id: "u-ws", role: "technician", technicianId: "   " });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "A1").documentIds.includes("u-ws"));
  assert.ok(checkById(r, "D1").documentIds.includes("u-ws"));
});

test("25. technician-role user with technicianId '\\t' is invalid (A1 + D1)", () => {
  const d = cleanDataset();
  d.users.push({ id: "u-tab", role: "technician", technicianId: "\t" });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "A1").documentIds.includes("u-tab"));
  assert.ok(checkById(r, "D1").documentIds.includes("u-tab"));
});

test("26. user technicianId ' T1 ' is malformed and NOT silently matched to T1", () => {
  // Only this padded reference "points at" T1; if it were normalized, T1
  // would look referenced. It must NOT be -> A1 fires for the user AND
  // T1 shows up as unreferenced (A4), proving no trim-and-match occurred.
  const d = {
    users: [{ id: "u-pad", role: "technician", technicianId: " T1 " }],
    technicians: [{ id: "T1", name: "One", phone: "5", status: "available", createdAt: 1 }],
    jobs: [],
  };
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "A1").documentIds.includes("u-pad"), "padded id is invalid -> A1");
  assert.ok(checkById(r, "D1").documentIds.includes("u-pad"));
  assert.ok(checkById(r, "A4").documentIds.includes("T1"), "T1 must remain UNreferenced (not matched to ' T1 ')");
  assert.equal(checkById(r, "A3").count, 0, "no shared-mapping match for a padded id");
});

test("27. assigned job with technicianId '   ' -> B3 + NO-GO", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J-ws", status: "assigned", technicianId: "   " });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "B3").documentIds.includes("J-ws"));
});

test("28. in_progress job with technicianId ' T1 ' -> B3, not normalized to T1", () => {
  const d = cleanDataset();
  d.jobs.push({ id: "J-pad", status: "in_progress", technicianId: " T1 " });
  const r = analyzeLegacyData(d);
  assert.equal(r.finalDecision, "NO-GO");
  assert.ok(checkById(r, "B3").documentIds.includes("J-pad"), "padded id invalid -> B3");
  assert.ok(!checkById(r, "B5").documentIds.includes("J-pad"), "not treated as a valid-but-dangling ref to T1");
});

test("29. exact 'T1' remains valid and resolves normally (regression guard)", () => {
  const r = analyzeLegacyData(cleanDataset()); // J1 assigned->T1, u-tech1->T1
  assert.equal(r.finalDecision, "GO");
  assert.equal(checkById(r, "A1").count, 0);
  assert.equal(checkById(r, "B3").count, 0);
  assert.equal(checkById(r, "A4").count, 0, "T1 is referenced -> not unreferenced");
});

// Note: a genuine Firestore READ FAILURE (exit code 2, distinct from
// GO/NO-GO) is produced by main()'s try/catch around loadCollections()
// and is validated at the integration/operator level rather than here,
// since it requires initializeApp() -- the pure analyzer and guard above
// carry the credential-free contract this suite asserts.
