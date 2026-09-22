// THE WORK ORDER MIGRATION DRY RUN -- proved against adversarial fixtures, not against whatever sandbox
// happens to hold today.
//
// The classification core is pure, so every rule below is exercised on constructed evidence: a diverged
// fixture, an unresolvable technician on an ACTIVE record, a target that already holds the id. A tool
// whose rules are only ever tested against the happy population is a tool whose refusals are untested.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const core = require("../lib/eosOps/migration/workOrderMigrationDryRun.js");
const runner = await import("../scripts/workOrderMigrationDryRun.mjs");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const wo = (id, data) => ({ id, data });

/** Evidence with nothing resolvable unless a test says so. */
const evidence = (over = {}) => ({
  technicians: new Map(), employees: new Set(), salesOrders: new Map(),
  accounts: new Set(), locations: new Set(), equipment: new Set(),
  operatingCompanyManifest: new Map(), targetWorkOrderIds: null, ...over,
});

const BUSINESS = (over = {}) => wo("biz-1", {
  woNumber: "WO-2026-000001", status: "SCHEDULED", type: "SERVICE_CALL", priority: 2,
  customerId: "acct-1", locationId: "loc-1", ...over,
});
const fullEvidence = (over = {}) => evidence({
  accounts: new Set(["acct-1"]), locations: new Set(["loc-1"]), ...over,
});

// ════════════════════ production refusal ════════════════════

test("production is refused by name, and an unknown source fails closed", () => {
  assert.throws(() => runner.assertSandboxSource("taylor-parts"), /production project/);
  assert.throws(() => runner.assertSandboxSource("some-other-project"), /fail closed|not eos-platform-sandbox/);
  assert.throws(() => runner.assertSandboxSource(""), /no default target/);
  assert.throws(() => runner.assertSandboxSource(undefined), /no default target/);
  assert.equal(runner.assertSandboxSource("eos-platform-sandbox"), "eos-platform-sandbox");
});

test("the DRY RUN performs NO WRITES -- derived from its own source, not asserted", () => {
  const src = readFileSync(resolve(FUNCTIONS_DIR, "scripts/workOrderMigrationDryRun.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  // THE PROBE HAS TO NAME THE HANDLE, NOT THE METHOD. A bare `.set(` search fails on `Map.prototype.set`
  // -- which this file uses to build evidence maps -- while still passing a `batch.set(...)` written on
  // another line. A probe that is loud about safe code and quiet about the dangerous kind is worse than
  // none, because it gets relaxed. So each pattern below names a WRITE on a database handle.
  const FIRESTORE_WRITES = [
    /\.doc\([^)]*\)\s*\.\s*(set|update|delete)\s*\(/,
    /\.collection\([^)]*\)\s*\.\s*(add|set)\s*\(/,
    /\b(batch|writeBatch|bulkWriter)\s*\(/,
    /runTransaction\s*\(/,
    /FieldValue\./,
  ];
  for (const pattern of FIRESTORE_WRITES) {
    assert.equal(pattern.test(src), false, `the dry run must not write to Firestore (${pattern})`);
  }
  for (const sql of ["INSERT INTO", "UPDATE ", "DELETE FROM", "TRUNCATE", "CREATE ", "ALTER "]) {
    assert.equal(src.includes(sql), false, `the dry run must not write to PostgreSQL (${sql})`);
  }
  // And the only SQL it runs at all is a SELECT.
  const statements = [...src.matchAll(/client\.query\(\s*"([^"]+)"/g)].map((m) => m[1].trim());
  for (const statement of statements) {
    assert.match(statement, /^SELECT /, `the dry run ran a non-SELECT statement: ${statement}`);
  }
  // NON-VACUITY: the probe must actually reject a write if one were added.
  assert.equal(FIRESTORE_WRITES.some((p) => p.test('await db.collection("x").doc("y").set({ a: 1 });')), true,
    "the write probe must detect a real Firestore write");
  const coreSrc = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationDryRun.ts"), "utf8");
  assert.equal(/firebase-admin|from "pg"/.test(coreSrc), false, "the classification core must stay pure");
});

// ════════════════════ snapshot determinism ════════════════════

test("the snapshot is deterministic: key order and document order cannot change the checksum", () => {
  const a = core.buildSourceSnapshot("p", "c", [
    wo("b", { z: 1, a: 2, nested: { y: 1, x: 2 } }),
    wo("a", { m: 3 }),
  ], sha256);
  const b = core.buildSourceSnapshot("p", "c", [
    wo("a", { m: 3 }),
    wo("b", { nested: { x: 2, y: 1 }, a: 2, z: 1 }),
  ], sha256);
  assert.equal(a.bodySha256, b.bodySha256, "the same documents must produce the same checksum");
  assert.deepEqual(a.documents.map((d) => d.id), ["a", "b"], "documents are sorted by id");
});

test("the checksum CHANGES when a fact changes -- non-vacuity", () => {
  const before = core.buildSourceSnapshot("p", "c", [wo("a", { status: "SCHEDULED" })], sha256);
  const after = core.buildSourceSnapshot("p", "c", [wo("a", { status: "COMPLETED" })], sha256);
  assert.notEqual(before.bodySha256, after.bodySha256);
});

// ════════════════════ completeness ════════════════════

test("every record ends in exactly one result, and every governed field in exactly one action", () => {
  const records = [BUSINESS(), wo("wo-sbx-001", { woNumber: "WO-2026-SBX001", scenarioId: "SBX-SCN-001", type: "SERVICE", status: "ARRIVED" })];
  const report = core.runDryRun({
    snapshot: core.buildSourceSnapshot("eos-platform-sandbox", "fieldops_wos", records, sha256),
    records, evidence: fullEvidence(),
  });
  assert.equal(report.records.length, records.length);
  for (const r of report.records) {
    assert.ok(core.RECORD_RESULTS.includes(r.result), `${r.workOrderId}: ${r.result}`);
    assert.ok(r.fields.length > 0, "fields must be classified");
    for (const f of r.fields) {
      assert.ok(core.FIELD_ACTIONS.includes(f.action), `${r.workOrderId}.${f.field} -> ${f.action}`);
      assert.ok(String(f.reason).length > 0, `${r.workOrderId}.${f.field} must say why`);
    }
    // No field appears twice, and none is silently dropped.
    assert.equal(new Set(r.fields.map((f) => f.field)).size, r.fields.length, "a field is dispositioned once");
  }
});

// ════════════════════ operating company ════════════════════

test("there is NO default operating company -- absent evidence is a blocker, never a guess", () => {
  const r = core.classifyRecord(BUSINESS(), "BUSINESS", null, fullEvidence());
  assert.equal(r.operatingCompany.resolutionStatus, "EXPLICIT_RESOLUTION_REQUIRED");
  assert.equal(r.operatingCompany.resolvedOperatingCompanyKey, null);
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blockers.some((b) => b.kind === "OPERATING_COMPANY_UNRESOLVED"));
});

test("a Sales Order upstream WITHOUT a company does not resolve it either", () => {
  const record = BUSINESS({ salesOrderId: "so-1" });
  const r = core.classifyRecord(record, "BUSINESS", null, fullEvidence({
    salesOrders: new Map([["so-1", { operatingCompanyId: null }]]),
  }));
  assert.equal(r.operatingCompany.resolutionStatus, "EXPLICIT_RESOLUTION_REQUIRED");
  assert.match(r.operatingCompany.evidenceKind, /lineage exists but carries no company/);
});

test("a governed upstream Sales Order company IS exact evidence", () => {
  const record = BUSINESS({ salesOrderId: "so-1" });
  const r = core.classifyRecord(record, "BUSINESS", null, fullEvidence({
    salesOrders: new Map([["so-1", { operatingCompanyId: "taylor" }]]),
  }));
  assert.equal(r.operatingCompany.resolutionStatus, "EXACT_SOURCE_EVIDENCE");
  assert.equal(r.operatingCompany.evidenceKind, "GOVERNED_UPSTREAM_SALES_ORDER");
  assert.equal(r.operatingCompany.resolvedOperatingCompanyKey, "taylor");
});

test("the tool CONSUMES an Owner manifest but never authors one", () => {
  const withManifest = core.classifyRecord(BUSINESS(), "BUSINESS", null, fullEvidence({
    operatingCompanyManifest: new Map([["biz-1", "ventana"]]),
  }));
  assert.equal(withManifest.operatingCompany.evidenceKind, "OWNER_AUTHORED_RESOLUTION_MANIFEST");
  assert.equal(withManifest.operatingCompany.resolvedOperatingCompanyKey, "ventana");
  // And with no manifest the same record blocks -- the tool did not invent the decision.
  assert.equal(core.classifyRecord(BUSINESS(), "BUSINESS", null, fullEvidence()).operatingCompany.resolvedOperatingCompanyKey, null);
});

// ════════════════════ type ════════════════════

test("SERVICE is NOT silently mapped to SERVICE_CALL", () => {
  const r = core.classifyRecord(BUSINESS({ type: "SERVICE" }), "BUSINESS", null, fullEvidence());
  assert.equal(r.type.action, "BLOCKER");
  assert.equal(r.type.targetValue, null, "no target value may be invented");
  assert.equal(r.type.deterministic, false);
  assert.match(r.type.reason, /NOT mapped|destroy/i);
  assert.ok(r.blockers.some((b) => b.kind === "WORK_ORDER_TYPE_REQUIRES_RESOLUTION"));
  // And the field-level disposition agrees with the record-level one.
  assert.equal(r.fields.find((f) => f.field === "type").action, "BLOCKER");
});

test("a missing type blocks, and an exact vocabulary match copies", () => {
  assert.equal(core.classifyRecord(BUSINESS({ type: undefined }), "BUSINESS", null, fullEvidence()).type.action, "BLOCKER");
  const ok = core.classifyRecord(BUSINESS({ type: "INSTALL" }), "BUSINESS", null, fullEvidence());
  assert.equal(ok.type.action, "COPY");
  assert.equal(ok.type.targetValue, "INSTALL");
  assert.equal(ok.type.deterministic, true);
});

// ════════════════════ number ════════════════════

test("a historical Work Order is NEVER renumbered", () => {
  const r = core.classifyRecord(BUSINESS({ woNumber: "WO-2026-SBX004" }), "BUSINESS", null, fullEvidence());
  assert.equal(r.number.action, "MIGRATED_NUMBER_COMPATIBILITY_REQUIRED");
  assert.equal(r.number.sourceNumber, "WO-2026-SBX004", "the exact number is preserved");
  assert.match(r.number.reason, /PRESERVED EXACTLY/);
  // There is no RENUMBER action anywhere in the vocabulary.
  const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationDryRun.ts"), "utf8");
  assert.equal(/"RENUMBER"|RENUMBER_/.test(src), false, "a RENUMBER action must not exist");
});

test("the native constraint is not widened: a conforming number copies, a nonconforming one is reported", () => {
  assert.equal(core.NATIVE_WORK_ORDER_NUMBER.test("WO-2026-000001"), true);
  assert.equal(core.NATIVE_WORK_ORDER_NUMBER.test("WO-2026-SBX001"), false);
  assert.equal(core.NATIVE_WORK_ORDER_NUMBER.test("WO-2026-C71301"), false);
  assert.equal(core.classifyRecord(BUSINESS(), "BUSINESS", null, fullEvidence()).number.action, "COPY_NATIVE_COMPATIBLE");
});

// ════════════════════ fixture classification ════════════════════

const SBX = (n, over = {}) => wo(`wo-sbx-${String(n).padStart(3, "0")}`, {
  woNumber: `WO-2026-SBX${String(n).padStart(3, "0")}`, scenarioId: "SBX-SCN-001",
  type: "SERVICE", status: "COMPLETED", ...over,
});

test("fixture exclusion requires EVERY marker to agree, not a prefix", () => {
  const [family] = core.classifyFixtureFamilies([SBX(1), SBX(2)]).filter((f) => f.key === "SBX-SCN-001");
  assert.equal(family.excluded, true);
  assert.deepEqual(family.memberIds, ["wo-sbx-001", "wo-sbx-002"]);
  assert.equal(family.divergedIds.length, 0);
});

test("ONE diverged occupant refuses the whole family, and its members fall back to BUSINESS", () => {
  // Same number shape, but a Firestore auto-id and no scenarioId: someone authored this by hand.
  const diverged = wo("AbCdEfGhIjKlMnOpQrSt", { woNumber: "WO-2026-SBX009", type: "SERVICE", status: "SCHEDULED" });
  const families = core.classifyFixtureFamilies([SBX(1), diverged]);
  const family = families.find((f) => f.key === "SBX-SCN-001");
  assert.equal(family.excluded, false, "a diverged occupant must refuse exclusion");
  assert.deepEqual(family.divergedIds, ["AbCdEfGhIjKlMnOpQrSt"]);
  assert.match(family.refusalReason, /FIXTURE_EXCLUSION_REFUSED/);

  const records = [SBX(1), diverged];
  const report = core.runDryRun({
    snapshot: core.buildSourceSnapshot("p", "c", records, sha256), records, evidence: fullEvidence(),
  });
  for (const r of report.records) {
    assert.equal(r.recordClass, "BUSINESS", `${r.workOrderId} must not be excluded when its family is refused`);
    assert.notEqual(r.result, "EXCLUDED_WITH_EVIDENCE");
  }
});

test("an excluded record carries its evidence and needs no target row", () => {
  const records = [SBX(1)];
  const report = core.runDryRun({
    snapshot: core.buildSourceSnapshot("p", "c", records, sha256), records, evidence: fullEvidence(),
  });
  const r = report.records[0];
  assert.equal(r.result, "EXCLUDED_WITH_EVIDENCE");
  assert.match(r.exclusionEvidence, /SBX-SCN-001/);
  assert.match(r.exclusionEvidence, /seedSandboxTransactional\.js/);
  assert.equal(r.blockers.length, 0, "an excluded record raises no blocker -- it simply does not migrate");
});

// ════════════════════ severity ════════════════════

test("severity HIGH does not alter priority and never becomes one", () => {
  const r = core.classifyRecord(BUSINESS({ severity: "HIGH", priority: 2 }), "BUSINESS", null, fullEvidence());
  const severity = r.fields.find((f) => f.field === "severity");
  assert.equal(severity.action, "HISTORICAL_ONLY");
  assert.match(severity.reason, /never translated into priority|must not influence priority/);
  const priority = r.fields.find((f) => f.field === "priority");
  assert.equal(priority.action, "COPY", "priority is an independent governed fact and is unaffected");
  assert.equal(r.blockers.some((b) => /SEVERITY/.test(b.kind)), false, "an unknown severity is history, not a blocker");
});

// ════════════════════ assignment ════════════════════

const tech = (id, employeeId) => new Map([[id, { employeeId }]]);

test("technician resolves to Employee only by EXACT id chain", () => {
  const record = BUSINESS({ assignedTechId: "tech-1" });
  const ok = core.classifyAssignment(record, evidence({ technicians: tech("tech-1", "emp-1"), employees: new Set(["emp-1"]) }));
  assert.equal(ok.outcome, "ASSIGNMENT_COPYABLE");
  assert.equal(ok.references.find((r) => r.field === "assignedTechId").employeeId, "emp-1");

  // employeeId names an Employee that does not exist -> not resolved, never invented.
  const ghost = core.classifyAssignment(record, evidence({ technicians: tech("tech-1", "emp-gone"), employees: new Set() }));
  assert.equal(ghost.references.find((r) => r.field === "assignedTechId").resolution, "EMPLOYEE_NOT_FOUND");
  assert.equal(ghost.references.find((r) => r.field === "assignedTechId").employeeId, null);
});

test("assigned and scheduled are resolved INDEPENDENTLY and never merged", () => {
  const record = BUSINESS({ assignedTechId: "tech-1", scheduledTechId: "tech-2" });
  const report = core.classifyAssignment(record, evidence({
    technicians: new Map([["tech-1", { employeeId: "emp-1" }], ["tech-2", { employeeId: null }]]),
    employees: new Set(["emp-1"]),
  }));
  const byField = Object.fromEntries(report.references.map((r) => [r.field, r.resolution]));
  assert.deepEqual(byField, { assignedTechId: "EXACT_EMPLOYEE", scheduledTechId: "TECHNICIAN_HAS_NO_EMPLOYEE_ID" });
});

test("an ACTIVE Work Order with an unresolved technician BLOCKS", () => {
  const record = BUSINESS({ status: "WORK_IN_PROGRESS", assignedTechId: "tech-x" });
  const r = core.classifyRecord(record, "BUSINESS", null, fullEvidence());
  assert.equal(r.assignment.outcome, "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION");
  assert.ok(r.blockers.some((b) => b.kind === "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION"));
  assert.equal(r.fields.find((f) => f.field === "assignedTechId").action, "BLOCKER");
});

test("a TERMINAL Work Order with an unresolved technician may migrate as historical-only", () => {
  for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
    const record = BUSINESS({ status, assignedTechId: "tech-x", type: "SERVICE_CALL" });
    const r = core.classifyRecord(record, "BUSINESS", null, fullEvidence({
      operatingCompanyManifest: new Map([["biz-1", "taylor"]]),
    }));
    assert.equal(r.assignment.outcome, "TERMINAL_ASSIGNMENT_HISTORICAL_ONLY", status);
    assert.equal(r.fields.find((f) => f.field === "assignedTechId").action, "HISTORICAL_ONLY", status);
    assert.equal(r.result, "COPYABLE", `${status}: terminal history should not be held hostage to a dead assignment`);
    // The unresolved source reference survives as evidence -- no Employee was invented.
    assert.equal(r.assignment.references.find((x) => x.field === "assignedTechId").technicianId, "tech-x");
    assert.equal(r.assignment.references.find((x) => x.field === "assignedTechId").employeeId, null);
  }
});

// ════════════════════ target collisions ════════════════════

test("a target that already holds the id is a hard blocker, never an upsert", () => {
  const r = core.classifyRecord(BUSINESS({ type: "SERVICE_CALL" }), "BUSINESS", null, fullEvidence({
    targetWorkOrderIds: new Set(["biz-1"]),
    operatingCompanyManifest: new Map([["biz-1", "taylor"]]),
  }));
  assert.equal(r.targetCollision, "TARGET_CONFLICT");
  assert.ok(r.blockers.some((b) => b.kind === "TARGET_CONFLICT"));
  assert.equal(r.result, "BLOCKED");
});

test("an unreadable target is reported UNKNOWN, never assumed empty", () => {
  const records = [BUSINESS()];
  const report = core.runDryRun({
    snapshot: core.buildSourceSnapshot("p", "c", records, sha256), records,
    evidence: fullEvidence({ targetWorkOrderIds: null }),
  });
  assert.equal(report.targetCollisionStatusKnown, false);
  assert.equal(report.records[0].targetCollision, "TARGET_COLLISION_STATUS_UNKNOWN");
});

// ════════════════════ references ════════════════════

test("a dangling reference is a named blocker", () => {
  const record = BUSINESS({ type: "SERVICE_CALL", salesOrderId: "so-gone" });
  const r = core.classifyRecord(record, "BUSINESS", null, fullEvidence({
    operatingCompanyManifest: new Map([["biz-1", "taylor"]]),
  }));
  assert.ok(r.blockers.some((b) => b.kind === "REFERENCE_NOT_FOUND" && /salesOrderId/.test(b.detail)));
});

// ════════════════════ summary arithmetic ════════════════════

test("blocker counts OVERLAP, and the report says so with intersections and a distinct count", () => {
  const records = [
    BUSINESS({ id: "a" }),                                    // company + type? type is SERVICE_CALL -> only company
    BUSINESS({ type: "SERVICE" }),                            // company + type
  ].map((r, i) => wo(`b${i}`, r.data));
  const report = core.runDryRun({
    snapshot: core.buildSourceSnapshot("p", "c", records, sha256), records, evidence: fullEvidence(),
  });
  const s = report.summary;
  const summed = Object.values(s.blockersByKind).reduce((a, b) => a + b, 0);
  assert.ok(summed > s.blockedRecordCount, "precondition: the kinds overlap in this fixture");
  assert.equal(s.blockedRecordCount, 2, "the DISTINCT record count is what a person should read");
  assert.equal(s.blockerIntersections.reduce((a, i) => a + i.records, 0), s.blockedRecordCount,
    "the intersections must partition the blocked records exactly");
});

test("NON-VACUITY: a deliberately seeded blocker is detected, and a clean record is COPYABLE", () => {
  const clean = wo("clean-1", {
    woNumber: "WO-2026-000042", status: "COMPLETED", type: "SERVICE_CALL", priority: 2,
    customerId: "acct-1", locationId: "loc-1", salesOrderId: "so-ok",
  });
  const ev = fullEvidence({
    salesOrders: new Map([["so-ok", { operatingCompanyId: "taylor" }]]),
    targetWorkOrderIds: new Set(),
  });
  const cleanResult = core.classifyRecord(clean, "BUSINESS", null, ev);
  assert.equal(cleanResult.result, "COPYABLE", "a fully-evidenced record must be copyable, or the tool blocks everything");
  assert.deepEqual(cleanResult.blockers, []);

  // Now break exactly one fact and watch it flip.
  const broken = wo("clean-1", { ...clean.data, type: "SERVICE" });
  assert.equal(core.classifyRecord(broken, "BUSINESS", null, ev).result, "BLOCKED");
});
