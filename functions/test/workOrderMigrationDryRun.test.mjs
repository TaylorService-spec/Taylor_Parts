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

/** Build a manifest through the REAL validator, so a test can never inject a decision the tool would refuse. */
const manifestFor = (records, snapshot, entries, ctxOver = {}) => core.validateResolutionManifest(
  {
    snapshotBodySha256: snapshot.bodySha256,
    decisionId: "OWNER-2026-09-22-A",
    decidedAt: "2026-09-22T00:00:00.000Z",
    records: entries,
  },
  {
    snapshotBodySha256: snapshot.bodySha256,
    businessIds: new Set(records.map((r) => r.id)),
    fixtureIds: new Set(),
    ...ctxOver,
  },
);

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
  const records = [BUSINESS()];
  const snapshot = core.buildSourceSnapshot("p", "c", records, sha256);
  const resolutionManifest = manifestFor(records, snapshot, [
    { workOrderId: "biz-1", operatingCompanyId: "ventana", decisionReason: "owner ruling" },
  ]);
  const withManifest = core.classifyRecord(BUSINESS(), "BUSINESS", null, fullEvidence({ resolutionManifest }));
  assert.equal(withManifest.operatingCompany.evidenceKind, "OWNER_AUTHORED_RESOLUTION_MANIFEST");
  assert.equal(withManifest.operatingCompany.resolvedOperatingCompanyKey, "ventana");
  // And with no manifest the same record blocks -- the tool did not invent the decision.
  assert.equal(core.classifyRecord(BUSINESS(), "BUSINESS", null, fullEvidence()).operatingCompany.resolvedOperatingCompanyKey, null);
});

test("there is NO implicit default: no code path produces a company nobody named", () => {
  const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationDryRun.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  assert.equal(/defaultOperatingCompany|DEFAULT_OPERATING_COMPANY/.test(src), false,
    "a default operating company must not exist, now or later");
  // "taylor" must not appear as a value the core can produce.
  assert.equal(/["']taylor["']/.test(src), false, "the core must never name a specific company");
  // And an unknown manifest key is REFUSED rather than ignored -- which is what stops a future default.
  assert.throws(() => core.validateResolutionManifest(
    { snapshotBodySha256: "x", decisionId: "d", decidedAt: "t", records: [], defaultOperatingCompany: "taylor" },
    { snapshotBodySha256: "x", businessIds: new Set(), fixtureIds: new Set() },
  ), (e) => { assert.equal(e.code, "MANIFEST_UNKNOWN_FIELD"); return true; });
});

// ════════════════════ type ════════════════════

test("OWNER NORMALIZATION: SERVICE -> SERVICE_CALL exactly, with the raw value retained", () => {
  const r = core.classifyRecord(BUSINESS({ type: "SERVICE" }), "BUSINESS", null, fullEvidence());
  assert.equal(r.type.action, "COPY");
  assert.equal(r.type.targetValue, "SERVICE_CALL");
  assert.equal(r.type.sourceValue, "SERVICE", "the RAW source value must survive as evidence");
  assert.equal(r.type.resolution, "OWNER_LEGACY_SERVICE_NORMALIZATION");
  assert.equal(r.type.provenance, "MIGRATED");
  assert.equal(r.type.factClass, "OWNER_MIGRATION_RESOLUTION");
  assert.equal(r.blockers.some((b) => b.kind === "WORK_ORDER_TYPE_REQUIRES_RESOLUTION"), false);
});

test("OWNER LEGACY DEFAULT: a missing type -> SERVICE_CALL, and never claims the source said so", () => {
  const r = core.classifyRecord(BUSINESS({ type: undefined }), "BUSINESS", null, fullEvidence());
  assert.equal(r.type.targetValue, "SERVICE_CALL");
  assert.equal(r.type.sourceValue, null, "the evidence must not claim the source contained SERVICE_CALL");
  assert.equal(r.type.resolution, "OWNER_LEGACY_DEFAULT");
  assert.equal(r.type.provenance, "MIGRATED");
  assert.equal(r.type.factClass, "OWNER_MIGRATION_RESOLUTION");
});

test("a genuine SERVICE_CALL is a SOURCE fact, not a migration artefact", () => {
  const r = core.classifyRecord(BUSINESS({ type: "SERVICE_CALL" }), "BUSINESS", null, fullEvidence());
  assert.equal(r.type.resolution, "SOURCE_EXACT");
  assert.equal(r.type.provenance, "SOURCE");
  assert.equal(r.type.factClass, "SOURCE_FACT");
  // THE POINT: after normalization these two look identical in the target and must not in the evidence.
  const defaulted = core.classifyRecord(BUSINESS({ type: undefined }), "BUSINESS", null, fullEvidence());
  assert.equal(defaulted.type.targetValue, r.type.targetValue);
  assert.notEqual(defaulted.type.factClass, r.type.factClass);
});

test("an UNRECOGNIZED type still blocks -- the ruling covers SERVICE, absent and exact values only", () => {
  const r = core.classifyRecord(BUSINESS({ type: "EMERGENCY" }), "BUSINESS", null, fullEvidence());
  assert.equal(r.type.action, "BLOCKER");
  assert.equal(r.type.targetValue, null);
  assert.ok(r.blockers.some((b) => b.kind === "WORK_ORDER_TYPE_REQUIRES_RESOLUTION"));
});

test("the NATIVE vocabulary is unchanged -- normalization is migration-only", () => {
  assert.deepEqual([...core.TARGET_WORK_ORDER_TYPES], ["SERVICE_CALL", "PM", "INSTALL", "WARRANTY", "INSPECTION"]);
  for (const forbidden of ["LEGACY_SERVICE", "LEGACY_UNCLASSIFIED", "SERVICE"]) {
    assert.equal(core.TARGET_WORK_ORDER_TYPES.includes(forbidden), false,
      `${forbidden} must not enter the permanent vocabulary`);
  }
  const sql = readFileSync(resolve(FUNCTIONS_DIR, "migrations/1761004800000_work-order-object-authority.sql"), "utf8");
  assert.match(sql, /CREATE TYPE ops_work_order_type AS ENUM \('SERVICE_CALL', 'PM', 'INSTALL', 'WARRANTY', 'INSPECTION'\)/,
    "the database enum must not have been widened for migration convenience");
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
    const snapshot = core.buildSourceSnapshot("p", "c", [record], sha256);
    const resolutionManifest = manifestFor([record], snapshot, [
      { workOrderId: "biz-1", operatingCompanyId: "taylor", decisionReason: "owner ruling" },
    ]);
    const r = core.classifyRecord(record, "BUSINESS", null, fullEvidence({ resolutionManifest }));
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
  const rec = BUSINESS({ type: "SERVICE_CALL" });
  const snap = core.buildSourceSnapshot("p", "c", [rec], sha256);
  const r = core.classifyRecord(rec, "BUSINESS", null, fullEvidence({
    targetWorkOrderIds: new Set(["biz-1"]),
    resolutionManifest: manifestFor([rec], snap, [{ workOrderId: "biz-1", operatingCompanyId: "taylor", decisionReason: "x" }]),
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
  const snap = core.buildSourceSnapshot("p", "c", [record], sha256);
  const r = core.classifyRecord(record, "BUSINESS", null, fullEvidence({
    resolutionManifest: manifestFor([record], snap, [{ workOrderId: "biz-1", operatingCompanyId: "taylor", decisionReason: "x" }]),
  }));
  assert.ok(r.blockers.some((b) => b.kind === "REFERENCE_NOT_FOUND" && /salesOrderId/.test(b.detail)));
});

// ════════════════════ summary arithmetic ════════════════════

test("blocker counts OVERLAP, and the report says so with intersections and a distinct count", () => {
  const records = [
    BUSINESS(),                                               // company only
    BUSINESS({ type: "EMERGENCY" }),                          // company + unrecognized type
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

  // Now break exactly one fact and watch it flip. `SERVICE` no longer breaks it -- the Owner normalized
  // that -- so the seeded defect is a type spelling the ruling does NOT cover.
  const broken = wo("clean-1", { ...clean.data, type: "EMERGENCY" });
  assert.equal(core.classifyRecord(broken, "BUSINESS", null, ev).result, "BLOCKED");
  // And the normalized value really is copyable, so this test is not passing for the wrong reason.
  const normalized = wo("clean-1", { ...clean.data, type: "SERVICE" });
  assert.equal(core.classifyRecord(normalized, "BUSINESS", null, ev).result, "COPYABLE");
});

// ════════════════════ the Owner resolution manifest ════════════════════

const snapOf = (records) => core.buildSourceSnapshot("eos-platform-sandbox", "fieldops_wos", records, sha256);
const ctxFor = (records, over = {}) => ({
  snapshotBodySha256: snapOf(records).bodySha256,
  businessIds: new Set(records.map((r) => r.id)),
  fixtureIds: new Set(),
  ...over,
});
const manifestBody = (records, entries, over = {}) => ({
  snapshotBodySha256: snapOf(records).bodySha256,
  decisionId: "OWNER-2026-09-22-A",
  decidedAt: "2026-09-22T00:00:00.000Z",
  records: entries,
  ...over,
});
const refusal = (code) => (e) => { assert.equal(e.code, code, e.message); return true; };

test("a manifest written against a DIFFERENT snapshot is refused", () => {
  const records = [BUSINESS()];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{ workOrderId: "biz-1", operatingCompanyId: "taylor", decisionReason: "x" }],
        { snapshotBodySha256: "0".repeat(64) }),
      ctxFor(records)),
    refusal("MANIFEST_SNAPSHOT_MISMATCH"));
});

test("a FIXTURE Work Order can never appear in the manifest", () => {
  const records = [BUSINESS()];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{ workOrderId: "wo-sbx-001", operatingCompanyId: "taylor", decisionReason: "x" }]),
      ctxFor(records, { fixtureIds: new Set(["wo-sbx-001"]) })),
    refusal("MANIFEST_FIXTURE_NAMED"));
});

test("a Work Order outside the business population is refused, never silently ignored", () => {
  const records = [BUSINESS()];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{ workOrderId: "not-in-snapshot", operatingCompanyId: "taylor", decisionReason: "x" }]),
      ctxFor(records)),
    refusal("MANIFEST_RECORD_NOT_IN_POPULATION"));
});

test("an UNKNOWN operating company is refused, and it is not collapsed into 'invalid'", () => {
  const records = [BUSINESS()];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{ workOrderId: "biz-1", operatingCompanyId: "acme", decisionReason: "x" }]),
      ctxFor(records)),
    refusal("MANIFEST_COMPANY_UNKNOWN"));
  // A malformed id is a DIFFERENT mistake and gets a different refusal.
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{ workOrderId: "biz-1", operatingCompanyId: "Taylor Freezer", decisionReason: "x" }]),
      ctxFor(records)),
    refusal("MANIFEST_COMPANY_INVALID"));
});

test("company validity is decided by the GOVERNED AUTHORITY, including the INACTIVE case", () => {
  // Every company in the catalog is active today, so the INACTIVE refusal is not reachable from data.
  // Rather than fake one, this asserts the two things that make it real when a company IS deactivated:
  // the validator consults the governed resolver, and it has a distinct refusal for that state.
  const authority = require("../lib/ownership/operatingCompanyAuthority.js");
  assert.deepEqual(authority.resolveOperatingCompany("taylor").state, "RESOLVED");
  assert.deepEqual(authority.resolveOperatingCompany("acme").state, "UNKNOWN");
  assert.equal(authority.OPERATING_COMPANIES.every((c) => c.active), true,
    "precondition: no inactive company exists, so the INACTIVE branch cannot be reached from data");
  const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationDryRun.ts"), "utf8");
  assert.match(src, /MANIFEST_COMPANY_INACTIVE/, "a distinct INACTIVE refusal must exist");
  assert.match(src, /resolveGovernedCompanyId\(/, "the validator must consult the governed authority, not a string list");
});

test("resolving one Work Order TWICE is refused as a disagreement", () => {
  const records = [BUSINESS()];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [
        { workOrderId: "biz-1", operatingCompanyId: "taylor", decisionReason: "x" },
        { workOrderId: "biz-1", operatingCompanyId: "ventana", decisionReason: "y" },
      ]),
      ctxFor(records)),
    refusal("MANIFEST_DUPLICATE_RECORD"));
});

test("an unknown field on a record is refused too", () => {
  const records = [BUSINESS()];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{ workOrderId: "biz-1", operatingCompanyId: "taylor", decisionReason: "x", priority: 1 }]),
      ctxFor(records)),
    refusal("MANIFEST_UNKNOWN_FIELD"));
});

test("a decision must state WHY", () => {
  const records = [BUSINESS()];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{ workOrderId: "biz-1", operatingCompanyId: "taylor", decisionReason: "" }]),
      ctxFor(records)),
    refusal("MANIFEST_MALFORMED"));
});

test("a Firebase uid is never accepted as an Employee identity", () => {
  const records = [BUSINESS({ status: "DISPATCHED", assignedTechId: "tech-x" })];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{
        workOrderId: "biz-1", operatingCompanyId: "taylor",
        assignmentEmployeeId: "aB3dEfGhIjKlMnOpQrStUvWxYz01", decisionReason: "x",
      }]),
      ctxFor(records)),
    refusal("MANIFEST_EMPLOYEE_IS_UID"));
});

test("an Employee id that resolves to nobody is refused", () => {
  const records = [BUSINESS()];
  assert.throws(
    () => core.validateResolutionManifest(
      manifestBody(records, [{
        workOrderId: "biz-1", operatingCompanyId: "taylor",
        assignmentEmployeeId: "emp-ghost", decisionReason: "x",
      }]),
      ctxFor(records, { employeeIds: new Set(["emp-1"]) })),
    refusal("MANIFEST_EMPLOYEE_NOT_FOUND"));
});

test("an EXPLICIT snapshot-scoped BULK decision is deterministic and clears exactly its records", () => {
  const records = [wo("b1", BUSINESS().data), wo("b2", BUSINESS().data), wo("b3", BUSINESS().data)];
  const snapshot = snapOf(records);
  const entries = records.map((r) => ({
    workOrderId: r.id, operatingCompanyId: "taylor", decisionReason: "bulk: all listed business WOs -> taylor",
  }));
  const a = core.validateResolutionManifest(manifestBody(records, entries), ctxFor(records));
  const b = core.validateResolutionManifest(manifestBody(records, [...entries].reverse()), ctxFor(records));
  assert.deepEqual([...a.byWorkOrderId.keys()].sort(), [...b.byWorkOrderId.keys()].sort(),
    "order of entries must not change the outcome");

  const report = core.runDryRun({
    snapshot, records,
    evidence: fullEvidence({ resolutionManifest: a, targetWorkOrderIds: new Set() }),
  });
  assert.equal(report.summary.copyable, 3, "each explicitly listed record resolves");
  assert.equal(report.summary.blockersByKind.OPERATING_COMPANY_UNRESOLVED, 0);
  for (const r of report.records) {
    assert.equal(r.operatingCompany.evidenceKind, "OWNER_AUTHORED_RESOLUTION_MANIFEST");
  }

  // A FOURTH record that the manifest does NOT list stays blocked -- the bulk decision is a list, not a rule.
  const plusOne = [...records, wo("b4", BUSINESS().data)];
  const snapshot2 = snapOf(plusOne);
  const manifest2 = core.validateResolutionManifest(
    manifestBody(plusOne, entries), ctxFor(plusOne));
  const report2 = core.runDryRun({
    snapshot: snapshot2, records: plusOne,
    evidence: fullEvidence({ resolutionManifest: manifest2, targetWorkOrderIds: new Set() }),
  });
  assert.equal(report2.records.find((r) => r.workOrderId === "b4").result, "BLOCKED");
  assert.equal(report2.summary.blockersByKind.OPERATING_COMPANY_UNRESOLVED, 1);
});

test("an explicit Employee decision clears ONLY the active-assignment blocker", () => {
  const record = wo("biz-1", BUSINESS({ status: "DISPATCHED", assignedTechId: "tech-x" }).data);
  const snapshot = snapOf([record]);
  // Company deliberately NOT decided: the company blocker must survive.
  const manifest = core.validateResolutionManifest(
    manifestBody([record], [{
      workOrderId: "biz-1", operatingCompanyId: "taylor",
      assignmentEmployeeId: "emp-7", decisionReason: "reassigned by dispatch",
    }]),
    ctxFor([record], { employeeIds: new Set(["emp-7"]) }));

  const r = core.classifyRecord(record, "BUSINESS", null, fullEvidence({ resolutionManifest: manifest }));
  assert.equal(r.assignment.outcome, "ASSIGNMENT_COPYABLE");
  assert.equal(r.blockers.some((b) => b.kind === "ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION"), false);
  // The legacy reference is RETAINED as evidence -- the decision did not rewrite history.
  const ref = r.assignment.references.find((x) => x.field === "assignedTechId");
  assert.equal(ref.technicianId, "tech-x");
  assert.equal(ref.employeeId, null, "the legacy technician still does not resolve; a decision is not a discovery");
  assert.equal(r.fields.find((f) => f.field === "assignedTechId").factClass, "OWNER_MIGRATION_RESOLUTION");
});

test("the three fact classes are carried on every field and never collapsed", () => {
  const r = core.classifyRecord(BUSINESS({ type: undefined }), "BUSINESS", null, fullEvidence());
  for (const f of r.fields) {
    assert.ok(core.FACT_CLASSES.includes(f.factClass), `${f.field} -> ${f.factClass}`);
  }
  assert.equal(r.fields.find((f) => f.field === "type").factClass, "OWNER_MIGRATION_RESOLUTION");
  assert.ok(r.fields.some((f) => f.factClass === "SOURCE_FACT"));
});

test("the worksheet NEVER fills or suggests a company", () => {
  const records = [
    wo("b1", BUSINESS({ woNumber: "WO-2026-000002", type: "SERVICE" }).data),
    wo("b2", BUSINESS({ woNumber: "WO-2026-000001" }).data),
  ];
  const report = core.runDryRun({ snapshot: snapOf(records), records, evidence: fullEvidence() });
  const rows = core.buildOwnerWorksheet(report, records);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.woNumber), ["WO-2026-000001", "WO-2026-000002"], "sorted by woNumber");
  for (const row of rows) {
    assert.equal(row.operatingCompanyDecision, "", "the company column must be blank");
    assert.equal(Object.values(row).includes("taylor"), false, "no company may be suggested");
    assert.equal(Object.values(row).includes("ventana"), false);
  }
  // It still shows the Owner-normalized target type beside the raw source value.
  const normalized = rows.find((r) => r.workOrderId === "b1");
  assert.equal(normalized.sourceType, "SERVICE");
  assert.equal(normalized.targetType, "SERVICE_CALL");
  assert.equal(normalized.typeResolution, "OWNER_LEGACY_SERVICE_NORMALIZATION");
});

test("the assignment worksheet lists ONLY the active unresolved records, with a blank decision", () => {
  const active = wo("b1", BUSINESS({ status: "DISPATCHED", assignedTechId: "tech-x" }).data);
  const terminal = wo("b2", BUSINESS({ status: "COMPLETED", assignedTechId: "tech-y" }).data);
  const clean = wo("b3", BUSINESS().data);
  const records = [active, terminal, clean];
  const report = core.runDryRun({ snapshot: snapOf(records), records, evidence: fullEvidence() });
  const rows = core.buildAssignmentWorksheet(report, records);
  assert.deepEqual(rows.map((r) => r.workOrderId), ["b1"], "only the ACTIVE unresolved record needs a decision");
  assert.equal(rows[0].assignmentEmployeeDecision, "");
  assert.equal(rows[0].legacyAssignedTechId, "tech-x");
  assert.match(rows[0].exactResolutionResult, /assignedTechId=TECHNICIAN_DOC_MISSING/);
});

test("the blank scaffold covers every genuine record and is REFUSED until filled", () => {
  const active = wo("b1", BUSINESS({ woNumber: "WO-2026-000002", status: "DISPATCHED", assignedTechId: "tech-x" }).data);
  const plain = wo("b2", BUSINESS({ woNumber: "WO-2026-000001" }).data);
  const fixture = wo("wo-sbx-001", { woNumber: "WO-2026-SBX001", scenarioId: "SBX-SCN-001", type: "SERVICE", status: "COMPLETED" });
  const records = [active, plain, fixture];
  const snapshot = snapOf(records);
  const report = core.runDryRun({ snapshot, records, evidence: fullEvidence() });
  const scaffold = core.buildManifestScaffold(report, records);

  assert.equal(scaffold.snapshotBodySha256, snapshot.bodySha256, "bound to THIS snapshot");
  assert.equal(scaffold.decisionId, null);
  assert.deepEqual(scaffold.records.map((r) => r.workOrderId), ["b2", "b1"], "genuine only, sorted by woNumber");
  for (const row of scaffold.records) {
    assert.equal(row.operatingCompanyId, null, "no company may be pre-filled");
    assert.equal(row.decisionReason, null);
  }
  // Only the ACTIVE unresolved record carries the assignment slot.
  assert.equal("assignmentEmployeeId" in scaffold.records.find((r) => r.workOrderId === "b1"), true);
  assert.equal("assignmentEmployeeId" in scaffold.records.find((r) => r.workOrderId === "b2"), false);
  // No fixture appears.
  assert.equal(scaffold.records.some((r) => r.workOrderId === "wo-sbx-001"), false);

  // AND THE SCAFFOLD IS NOT A MANIFEST. Handed back unfilled it must be refused, or the blank template
  // would itself be a decision.
  assert.throws(() => core.validateResolutionManifest(scaffold, ctxFor(records, {
    businessIds: new Set(["b1", "b2"]), fixtureIds: new Set(["wo-sbx-001"]),
  })), (e) => { assert.match(e.code, /MANIFEST_MALFORMED|MANIFEST_COMPANY_INVALID/); return true; });
});

// ════════════════════ THE FUTURE-STATE RULE ════════════════════

test("NO Taylor default is encoded anywhere in the Work Order path -- schema, mapper or command", () => {
  // The Owner ruled ALL EXISTING historical Work Orders to Taylor for THIS snapshot. That is a migration
  // fact about one population. Ventana can own Work Orders, so the moment that ruling leaks into a
  // default, a Ventana Work Order silently becomes a Taylor one -- and nothing would report it, because a
  // default produces a value rather than an error.
  const read = (p) => readFileSync(resolve(FUNCTIONS_DIR, p), "utf8");
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").replace(/^\s*--.*$/, "")).join("\n");

  // The SCHEMA states the company and never supplies one.
  const sql = strip(read("migrations/1761004800000_work-order-object-authority.sql"));
  assert.match(sql, /operating_company_key\s+TEXT\s+NOT NULL/, "the column must be mandatory");
  assert.equal(/operating_company_key[^,]*DEFAULT/i.test(sql), false, "the column must carry no DEFAULT");
  assert.match(sql, /work_orders_company_is_stated CHECK \(btrim\(operating_company_key\) <> ''\)/,
    "a blank company must be refused structurally, not just by convention");

  // No Work Order module may name a company as a value.
  for (const path of [
    "src/eosOps/migration/workOrderMigrationDryRun.ts",
    "src/eosOps/migration/workOrderFieldParityMatrix.ts",
    "src/eosOps/workOrderAssignmentAuthority.ts",
    "src/eosOps/workOrderPartsPlanAuthority.ts",
    "src/eosOps/serviceFromSalesOrderBoundary.ts",
  ]) {
    const src = strip(read(path));
    assert.equal(/["'`]taylor["'`]|["'`]ventana["'`]/i.test(src), false,
      `${path} names a specific operating company; a migration ruling must not become code`);
    assert.equal(/default\w*OperatingCompany|DEFAULT_OPERATING_COMPANY|FALLBACK_COMPANY/i.test(src), false,
      `${path} encodes a default operating company`);
  }

  // And the resolver offers exactly two outcomes -- evidence, or an explicit requirement. No third path.
  const core2 = require("../lib/eosOps/migration/workOrderMigrationDryRun.js");
  const noEvidence = core2.resolveOperatingCompany(
    { id: "x", data: { woNumber: "WO-2026-000001" } },
    { technicians: new Map(), employees: new Set(), salesOrders: new Map(), accounts: new Set(),
      locations: new Set(), equipment: new Set(), resolutionManifest: null },
  );
  assert.equal(noEvidence.resolutionStatus, "EXPLICIT_RESOLUTION_REQUIRED");
  assert.equal(noEvidence.resolvedOperatingCompanyKey, null, "absent evidence must never produce a company");
});

test("the manifest accepts ANY active governed company, not only the one this ruling used", () => {
  // Ventana must be expressible today, or the model has quietly become single-company.
  const records = [wo("b1", BUSINESS().data), wo("b2", BUSINESS().data)];
  const snapshot = snapOf(records);
  const mixed = core.validateResolutionManifest(
    manifestBody(records, [
      { workOrderId: "b1", operatingCompanyId: "taylor", decisionReason: "owner ruling" },
      { workOrderId: "b2", operatingCompanyId: "ventana", decisionReason: "owner ruling" },
    ]),
    ctxFor(records));
  const report = core.runDryRun({
    snapshot, records,
    evidence: fullEvidence({ resolutionManifest: mixed, targetWorkOrderIds: new Set() }),
  });
  assert.equal(report.summary.copyable, 2);
  assert.deepEqual(
    report.records.map((r) => r.operatingCompany.resolvedOperatingCompanyKey).sort(),
    ["taylor", "ventana"]);
});

test("the company ruling does NOT erase independent blockers", () => {
  // The exact shape of the live re-run: an ACTIVE record with an unresolvable technician and a dangling
  // reference must stay BLOCKED even once its company is decided.
  const record = wo("b1", BUSINESS({
    status: "DISPATCHED", assignedTechId: "probe-t-x", customerId: "ghost-c",
  }).data);
  const snapshot = snapOf([record]);
  const manifest = core.validateResolutionManifest(
    manifestBody([record], [{ workOrderId: "b1", operatingCompanyId: "taylor", decisionReason: "owner ruling" }]),
    ctxFor([record]));
  const r = core.classifyRecord(record, "BUSINESS", null, evidence({
    locations: new Set(["loc-1"]), resolutionManifest: manifest,
  }));
  assert.equal(r.operatingCompany.resolvedOperatingCompanyKey, "taylor");
  assert.equal(r.result, "BLOCKED", "company resolved, but the record is not copyable");
  const kinds = [...new Set(r.blockers.map((b) => b.kind))].sort();
  assert.deepEqual(kinds, ["ACTIVE_ASSIGNMENT_REQUIRES_RESOLUTION", "REFERENCE_NOT_FOUND"]);
  assert.equal(kinds.includes("OPERATING_COMPANY_UNRESOLVED"), false);
});

// ════════════════════ THE OWNER-CLASSIFIED EXCLUSION ════════════════════

const LIVE_SNAPSHOT = "3800975c2838f6c1610790c2eea153e7719b6d390c61b2f74319093650531b59";
const PROBE_ID = "p8nHWH7HywDUMiaS21YA";

test("the Owner exclusion names an EXACT id bound to an EXACT snapshot -- never a pattern", () => {
  const ruled = core.OWNER_CLASSIFIED_EXCLUSIONS.find((x) => x.workOrderId === PROBE_ID);
  assert.ok(ruled, "the ruling must be recorded");
  assert.equal(ruled.familyId, "OWNER_CLASSIFIED_PROBE_RESIDUE_2026_09_22");
  assert.equal(ruled.snapshotBodySha256, LIVE_SNAPSHOT);
  assert.ok(ruled.measuredEvidence.length >= 5, "the measured facts must be recorded, not just the verdict");
  // No exclusion may be expressed as a pattern.
  for (const x of core.OWNER_CLASSIFIED_EXCLUSIONS) {
    assert.equal(typeof x.workOrderId, "string");
    assert.equal(/[*?\[\]]|RegExp/.test(x.workOrderId), false, "an exclusion is an id, never a pattern");
  }
});

test("the exclusion is EVIDENCE-BASED, not a 'probe-' heuristic", () => {
  // A DIFFERENT record carrying the same probe-shaped values is NOT excluded. This is the whole
  // distinction: the word proves nothing, and only the ruled id is ruled.
  const lookalike = wo("SomeOtherFirestoreId01", {
    woNumber: "WO-2026-000099", status: "DISPATCHED", type: "SERVICE_CALL",
    customerId: "probe-c", locationId: "probe-l", assignedTechId: "probe-t-mtbxlplt",
  });
  const records = [lookalike];
  // Force the live snapshot binding so the ruling is in scope, then prove it still does not catch it.
  const report = core.runDryRun({
    snapshot: { ...snapOf(records), bodySha256: LIVE_SNAPSHOT },
    records, evidence: fullEvidence(),
  });
  const r = report.records[0];
  assert.equal(r.recordClass, "BUSINESS", "a lookalike must NOT be excluded by resemblance");
  assert.equal(r.result, "BLOCKED");
  assert.equal(core.OWNER_CLASSIFIED_EXCLUSIONS.some((x) => x.workOrderId === "SomeOtherFirestoreId01"), false);
});

test("an Owner ruling does NOT carry over to a different snapshot", () => {
  const probe = wo(PROBE_ID, { woNumber: "WO-2026-000034", status: "DISPATCHED", type: "SERVICE_CALL" });
  const inScope = core.ownerExclusionsForSnapshot(LIVE_SNAPSHOT);
  assert.equal(inScope.has(PROBE_ID), true, "in scope for the snapshot it was ruled about");
  const elsewhere = core.ownerExclusionsForSnapshot("f".repeat(64));
  assert.equal(elsewhere.size, 0, "a ruling about one population must not silently drop a record in another");
  // And end to end: under a different checksum the record is BUSINESS again and blocks.
  const report = core.runDryRun({
    snapshot: { ...snapOf([probe]), bodySha256: "f".repeat(64) }, records: [probe], evidence: fullEvidence(),
  });
  assert.equal(report.records[0].recordClass, "BUSINESS");
  assert.equal(report.records[0].result, "BLOCKED");
});

test("the excluded probe record carries its Owner evidence and raises no blocker", () => {
  const probe = wo(PROBE_ID, { woNumber: "WO-2026-000034", status: "DISPATCHED", type: "SERVICE_CALL" });
  const report = core.runDryRun({
    snapshot: { ...snapOf([probe]), bodySha256: LIVE_SNAPSHOT }, records: [probe], evidence: fullEvidence(),
  });
  const r = report.records[0];
  assert.equal(r.result, "EXCLUDED_WITH_EVIDENCE");
  assert.equal(r.recordClass, "OTHER_NONBUSINESS_EVIDENCE");
  assert.match(r.exclusionEvidence, /OWNER_CLASSIFIED_PROBE_RESIDUE_2026_09_22/);
  assert.match(r.exclusionEvidence, /RETAINED in Firestore/, "exclusion is not deletion");
  assert.deepEqual(r.blockers, [], "an excluded record does not block; it simply does not migrate");
});

test("an excluded record can NEVER be named in the manifest as a migrated business Work Order", () => {
  const probe = wo(PROBE_ID, { woNumber: "WO-2026-000034", status: "DISPATCHED", type: "SERVICE_CALL" });
  const biz = wo("b1", BUSINESS().data);
  const records = [probe, biz];
  const snapshot = { ...snapOf(records), bodySha256: LIVE_SNAPSHOT };
  const report = core.runDryRun({ snapshot, records, evidence: fullEvidence() });
  const businessIds = new Set(report.records.filter((r) => r.recordClass === "BUSINESS").map((r) => r.workOrderId));
  const fixtureIds = new Set(report.records.filter((r) => r.recordClass !== "BUSINESS").map((r) => r.workOrderId));
  assert.equal(fixtureIds.has(PROBE_ID), true);

  assert.throws(() => core.validateResolutionManifest({
    snapshotBodySha256: LIVE_SNAPSHOT, decisionId: "d", decidedAt: "t",
    records: [{ workOrderId: PROBE_ID, operatingCompanyId: "taylor", decisionReason: "x" }],
  }, { snapshotBodySha256: LIVE_SNAPSHOT, businessIds, fixtureIds }),
    (e) => { assert.equal(e.code, "MANIFEST_FIXTURE_NAMED"); return true; });

  // The scaffold for the final population does not offer it either.
  const scaffold = core.buildManifestScaffold(report, records);
  assert.equal(scaffold.records.some((r) => r.workOrderId === PROBE_ID), false);
  assert.deepEqual(scaffold.records.map((r) => r.workOrderId), ["b1"]);
});

test("the committed Owner manifest holds exactly the 13 genuine records, all Taylor", () => {
  const manifest = JSON.parse(readFileSync(
    resolve(FUNCTIONS_DIR, "..", "docs/assessments/work-order-migration-manifest-OWNER-WO-COMPANY-2026-09-22.json"), "utf8"));
  assert.equal(manifest.decisionId, "OWNER-WO-COMPANY-2026-09-22");
  assert.equal(manifest.snapshotBodySha256, LIVE_SNAPSHOT, "bound to the measured snapshot");
  assert.equal(manifest.records.length, 13, "the final migration input is 13 records, not the superseded 14");
  assert.equal(manifest.records.some((r) => r.workOrderId === PROBE_ID), false,
    "the excluded record must not be represented as a migrated Taylor business Work Order");
  assert.deepEqual([...new Set(manifest.records.map((r) => r.operatingCompanyId))], ["taylor"]);
  for (const r of manifest.records) {
    assert.match(r.decisionReason, /Owner ruling/);
    assert.equal("assignmentEmployeeId" in r, false, "no Employee was invented for any record");
  }
});

test("COPYABLE = 13 and BLOCKED = 0 with no target conflict, and a conflict still fails closed", () => {
  const ids = Array.from({ length: 13 }, (_, i) => `b${i}`);
  const records = ids.map((id) => wo(id, BUSINESS().data));
  const snapshot = snapOf(records);
  const manifest = core.validateResolutionManifest(
    manifestBody(records, ids.map((id) => ({ workOrderId: id, operatingCompanyId: "taylor", decisionReason: "owner ruling" }))),
    ctxFor(records));

  const clean = core.runDryRun({
    snapshot, records,
    evidence: fullEvidence({ resolutionManifest: manifest, targetWorkOrderIds: new Set() }),
  });
  assert.equal(clean.summary.copyable, 13);
  assert.equal(clean.summary.blocked, 0);
  assert.equal(clean.targetCollisionStatusKnown, true);

  // One id already in the target: that record alone fails closed, and it is never an upsert.
  const conflicted = core.runDryRun({
    snapshot, records,
    evidence: fullEvidence({ resolutionManifest: manifest, targetWorkOrderIds: new Set(["b7"]) }),
  });
  assert.equal(conflicted.summary.copyable, 12);
  assert.equal(conflicted.summary.blocked, 1);
  assert.equal(conflicted.records.find((r) => r.workOrderId === "b7").targetCollision, "TARGET_CONFLICT");
});
