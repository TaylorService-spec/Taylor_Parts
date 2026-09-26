// WORK ORDER COPY CONTRACT -- the pure half: timestamp conversion, the field contract, and the plan.
//
// No database. These prove that the plan the COPY writes carries every contracted fact exactly, refuses
// (never defaults) what it cannot carry, and is deterministic. The PostgreSQL half is
// workOrderMigrationCopyContractPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const require = createRequire(import.meta.url);
const dry = require("../lib/eosOps/migration/workOrderMigrationDryRun.js");
const copy = require("../lib/eosOps/migration/workOrderMigrationCopy.js");
const { WORK_ORDER_FIELD_PARITY_MATRIX } = require("../lib/eosOps/migration/workOrderFieldParityMatrix.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
/** A Firestore Timestamp stand-in: the shape the Admin SDK hands back, without importing it. */
const fsTs = (iso, extraNanos = 0) => {
  const ms = Date.parse(iso);
  const seconds = Math.floor(ms / 1000);
  const nanoseconds = (ms - seconds * 1000) * 1e6 + extraNanos;
  return { seconds, nanoseconds, toMillis: () => ms, toDate: () => new Date(ms) };
};

const BASE = {
  woNumber: "WO-2026-000101", status: "DISPATCHED", type: "SERVICE_CALL", priority: 2,
  customerId: "acct-1", locationId: "loc-1",
  createdAt: "2026-04-01T09:00:00.000Z", updatedAt: "2026-04-03T10:00:00.000Z",
};
const rec = (id, over = {}) => ({ id, data: { ...BASE, woNumber: `WO-2026-000${id.replace(/\D/g, "").padStart(3, "0")}`, ...over } });

function planReportFor(records, { technicians = new Map([["tech-1", { employeeId: "emp-1" }], ["tech-2", { employeeId: "emp-2" }]]), decisions = {} } = {}) {
  const snapshot = dry.buildSourceSnapshot("eos-platform-sandbox", "fieldops_wos", records, sha256);
  const evidence = {
    technicians, employees: new Set(["emp-1", "emp-2"]), salesOrders: new Map(),
    accounts: new Set(["acct-1"]), locations: new Set(["loc-1"]), equipment: new Set(),
    resolutionManifest: null, targetWorkOrderIds: new Set(),
  };
  const first = dry.runDryRun({ snapshot, records, evidence });
  const businessIds = new Set(first.records.filter((r) => r.recordClass === "BUSINESS").map((r) => r.workOrderId));
  const manifest = dry.validateResolutionManifest({
    snapshotBodySha256: snapshot.bodySha256, decisionId: "OWNER-WOC", decidedAt: "2026-09-26T00:00:00.000Z",
    records: [...businessIds].map((id) => ({ workOrderId: id, operatingCompanyId: "taylor", decisionReason: "test", ...(decisions[id] ?? {}) })),
  }, { snapshotBodySha256: snapshot.bodySha256, businessIds, fixtureIds: new Set(), employeeIds: new Set(["emp-1", "emp-2"]) });
  const report = dry.runDryRun({ snapshot, records, evidence: { ...evidence, resolutionManifest: manifest } });
  const blocked = report.records.filter((r) => r.result !== "COPYABLE");
  assert.deepEqual(blocked.map((r) => [r.workOrderId, r.blockers]), [], "fixture must be COPYABLE in the DRY RUN");
  const input = { report, records, manifest, operatingCompanyKeyByCompanyId: new Map([["taylor", "sample-co-synthetic"]]) };
  return { input, snapshot, ...copy.buildCopyPlanReport(input) };
}
const planOne = (over) => {
  const out = planReportFor([rec("wo-1", over)]);
  return { planned: out.planned[0], refused: out.refused[0], all: out };
};
const reasonsOf = (over) => (planOne(over).refused?.reasons ?? []).map((r) => `${r.code}:${r.field}`);

// ════════ timestamps ════════

test("a Firestore Timestamp converts exactly, to the microsecond, in UTC", () => {
  assert.deepEqual(copy.toTimestamptz(fsTs("2026-04-01T09:00:00.123Z", 456789)), { ok: true, value: "2026-04-01T09:00:00.123456Z" },
    "nanoseconds truncate to microseconds -- never rounded, never lost to milliseconds");
  assert.deepEqual(copy.toTimestamptz({ _seconds: 1775034000, _nanoseconds: 5000 }), { ok: true, value: "2026-04-01T09:00:00.000005Z" },
    "the exported (_seconds/_nanoseconds) form is the same instant");
});

test("ISO strings normalize to UTC exactly; a string without a zone is REFUSED, never assumed", () => {
  assert.equal(copy.toTimestamptz("2026-04-01T09:00:00Z").value, "2026-04-01T09:00:00.000000Z");
  assert.equal(copy.toTimestamptz("2026-04-01T14:30:00.5+05:30").value, "2026-04-01T09:00:00.500000Z");
  assert.equal(copy.toTimestamptz("2026-03-31T23:00:00-10:00").value, "2026-04-01T09:00:00.000000Z");
  for (const zoneless of ["2026-04-01T09:00:00", "2026-04-01 09:00", "2026-04-01"]) {
    assert.equal(copy.toTimestamptz(zoneless).code, "TIMESTAMP_AMBIGUOUS_TIMEZONE", zoneless);
  }
  assert.equal(copy.toTimestamptz("2026-02-30T00:00:00Z").code, "TIMESTAMP_INVALID", "an impossible calendar date");
  assert.equal(copy.toTimestamptz("yesterday").code, "TIMESTAMP_INVALID");
});

test("epoch MILLISECONDS are accepted; epoch SECONDS are never reinterpreted", () => {
  assert.equal(copy.toTimestamptz(Date.parse("2026-04-01T09:00:00.007Z")).value, "2026-04-01T09:00:00.007000Z");
  assert.equal(copy.toTimestamptz(1775034000).code, "TIMESTAMP_OUT_OF_RANGE", "seconds read as millis land in 1970 and are refused");
  assert.equal(copy.toTimestamptz(1.5).code, "TIMESTAMP_INVALID");
  assert.equal(copy.toTimestamptz("1999-12-31T23:59:59Z").code, "TIMESTAMP_OUT_OF_RANGE");
});

test("absent is NULL, and objects that are not instants are refused", () => {
  for (const v of [null, undefined, ""]) assert.deepEqual(copy.toTimestamptz(v), { ok: true, value: null });
  assert.equal(copy.toTimestamptz(new Date("2026-04-01T09:00:00Z")).value, "2026-04-01T09:00:00.000000Z");
  assert.equal(copy.toTimestamptz({ at: 1 }).code, "TIMESTAMP_INVALID");
  assert.equal(copy.toTimestamptz([1]).code, "TIMESTAMP_INVALID");
});

// ════════ the contract itself ════════

test("the code contract covers every field the parity matrix names, with a known class", () => {
  for (const entry of WORK_ORDER_FIELD_PARITY_MATRIX) {
    assert.ok(Object.hasOwn(copy.WORK_ORDER_COPY_CONTRACT, entry.legacyField), `${entry.legacyField} has no COPY contract class`);
  }
  for (const [field, cls] of Object.entries(copy.WORK_ORDER_COPY_CONTRACT)) {
    assert.ok(copy.COPY_CONTRACT_CLASSES.includes(cls), `${field}: ${cls}`);
  }
});

test("the contract document names every contracted field, and the code names every UNKNOWN the document reports", () => {
  const doc = readFileSync(resolve(REPO_ROOT, "docs/engineering/work-order-migration-copy-contract-2026-09-26.md"), "utf8");
  for (const field of Object.keys(copy.WORK_ORDER_COPY_CONTRACT).filter((f) => f !== "id")) {
    assert.ok(doc.includes(`\`${field}\``), `the contract document does not name ${field}`);
  }
  const unknown = Object.entries(copy.WORK_ORDER_COPY_CONTRACT).filter(([, c]) => c === "UNKNOWN").map(([f]) => f).sort();
  assert.deepEqual(unknown, ["authorizationNumber", "executionLog", "externalReference", "inboundWorkRequestId", "salesOrderLineRefs"]);
});

test("the COPY source never uses the database clock and never writes a Firebase uid column", () => {
  const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationCopy.ts"), "utf8");
  assert.equal(/now\(\)/i.test(src), false, "no now() anywhere -- historical instants are passed explicitly");
  assert.equal(/\bUPDATE\s+\$\{SCHEMA\}|\bUPDATE\s+eos_|ON CONFLICT|DELETE FROM/i.test(src), false, "the COPY is insert-only");
});

// ════════ the plan: preservation ════════

test("every contracted Work Order fact is carried exactly -- including the historical created_at", () => {
  const { planned } = planOne({
    status: "COMPLETED", severity: "EQUIPMENT_DOWN", complaint: "  no cooling \n", diagnosis: "", resolution: "replaced relay",
    estimatedDurationMinutes: 90, equipmentId: null,
    scheduledStart: fsTs("2026-04-02T08:00:00.000Z", 1000), scheduledEnd: fsTs("2026-04-02T10:00:00.000Z"),
    dispatchedAt: fsTs("2026-04-02T07:00:00.000Z"), acceptedAt: fsTs("2026-04-02T07:05:00.000Z"),
    enRouteAt: fsTs("2026-04-02T07:10:00.000Z"), arrivedAt: fsTs("2026-04-02T07:40:00.000Z"),
    workStartedAt: fsTs("2026-04-02T07:45:00.000Z"), completedAt: fsTs("2026-04-02T09:30:00.250Z"),
    partsPlanUpdatedAt: fsTs("2026-04-01T12:00:00.000Z"), createdAt: fsTs("2026-04-01T09:00:00.123Z", 456000),
    updatedAt: fsTs("2026-04-02T09:30:00.250Z"), laborHours: 2.5, lastUpdated: fsTs("2026-04-02T09:31:00.000Z"),
  });
  assert.ok(planned, "the record must plan");
  assert.equal(planned.createdAt, "2026-04-01T09:00:00.123456Z", "the legacy instant, not the copy time");
  assert.equal(planned.updatedAt, "2026-04-02T09:30:00.250000Z");
  assert.equal(planned.complaint, "  no cooling \n", "authored text is verbatim");
  assert.equal(planned.diagnosis, "", "an empty string is not NULL");
  assert.equal(planned.resolution, "replaced relay");
  assert.equal(planned.severity, "EQUIPMENT_DOWN");
  assert.equal(planned.priority, 2, "severity never touches priority");
  assert.equal(planned.estimatedDurationMinutes, 90);
  assert.equal(planned.scheduledStart, "2026-04-02T08:00:00.000001Z");
  for (const [k, v] of Object.entries({ dispatchedAt: "07:00:00.000000", acceptedAt: "07:05:00.000000", enRouteAt: "07:10:00.000000",
    arrivedAt: "07:40:00.000000", workStartedAt: "07:45:00.000000", completedAt: "09:30:00.250000" })) {
    assert.equal(planned[k], `2026-04-02T${v}Z`, k);
  }
  assert.equal(planned.partsPlanUpdatedAt, "2026-04-01T12:00:00.000000Z");
  assert.equal(planned.closedAt, null);
  assert.equal(planned.sourceSha256.length, 64, "each record carries its source fingerprint");
});

test("a CANCELLED record's closedAt is the CANCELLATION instant: a transition row, not closed_at", () => {
  const { planned } = planOne({ status: "CANCELLED", closedAt: "2026-04-05T12:00:00Z" });
  assert.equal(planned.closedAt, null, "native CANCELLED never stamps closed_at; a second meaning is refused");
  assert.equal(planned.cancelledAt, "2026-04-05T12:00:00.000000Z");
  assert.equal(planned.transitions.length, 1);
  assert.equal(planned.transitions[0].toStatus, "CANCELLED");
  assert.equal(planned.transitions[0].occurredAt, "2026-04-05T12:00:00.000000Z");
  const closed = planOne({ status: "CLOSED", completedAt: "2026-04-04T12:00:00Z", closedAt: "2026-04-05T12:00:00Z" }).planned;
  assert.equal(closed.closedAt, "2026-04-05T12:00:00.000000Z");
  assert.deepEqual(closed.transitions, []);
});

// ════════ the plan: refusals, never defaults ════════

test("a missing required fact REFUSES the record -- no priority default, no created_at from the clock", () => {
  assert.deepEqual(reasonsOf({ priority: undefined }), ["MISSING_REQUIRED_FIELD:priority"]);
  assert.deepEqual(reasonsOf({ createdAt: undefined }), ["MISSING_REQUIRED_FIELD:createdAt"]);
  assert.deepEqual(reasonsOf({ updatedAt: undefined }), ["MISSING_REQUIRED_FIELD:updatedAt"]);
  assert.deepEqual(reasonsOf({ status: "COMPLETED" }), ["MISSING_REQUIRED_FIELD:completedAt"]);
  assert.deepEqual(reasonsOf({ status: "CLOSED", completedAt: "2026-04-02T00:00:00Z" }), ["MISSING_REQUIRED_FIELD:closedAt"]);
  assert.deepEqual(reasonsOf({ locationId: "" }), ["MISSING_REQUIRED_FIELD:locationId"]);
});

test("a semantic mismatch refuses with a named reason", () => {
  assert.deepEqual(reasonsOf({ createdAt: "2026-04-01T09:00:00" }), ["TIMESTAMP_AMBIGUOUS_TIMEZONE:createdAt"]);
  assert.deepEqual(reasonsOf({ dispatchedAt: "2026-03-01T00:00:00Z" }), ["TIMESTAMP_ORDER_VIOLATION:dispatchedAt"]);
  assert.deepEqual(reasonsOf({ status: "DISPATCHED", closedAt: "2026-04-05T00:00:00Z" }), ["TIMESTAMP_STATUS_INCOHERENT:closedAt"]);
  assert.deepEqual(reasonsOf({ priority: 7 }), ["FIELD_VALUE_INVALID:priority"]);
  assert.deepEqual(reasonsOf({ status: "PAUSED" }), ["FIELD_VALUE_INVALID:status"]);
  assert.deepEqual(reasonsOf({ estimatedDurationMinutes: 0 }), ["FIELD_VALUE_INVALID:estimatedDurationMinutes"]);
  assert.deepEqual(reasonsOf({ scheduledStart: "2026-04-02T08:00:00Z" }), ["FIELD_VALUE_INVALID:scheduledStart"]);
  assert.deepEqual(reasonsOf({ complaint: 42 }), ["FIELD_VALUE_INVALID:complaint"]);
});

test("a field with no target (schema gap) or no contract entry refuses the record rather than vanishing", () => {
  assert.deepEqual(reasonsOf({ executionLog: [{ note: "x", at: fsTs("2026-04-02T00:00:00Z"), byTechnicianId: "tech-1" }] }),
    ["SCHEMA_GAP_FIELD_PRESENT:executionLog"]);
  assert.deepEqual(reasonsOf({ externalReference: "PO-7" }), ["SCHEMA_GAP_FIELD_PRESENT:externalReference"]);
  assert.deepEqual(reasonsOf({ salesOrderLineRefs: [{ ref: "p", kind: "PART", orderedQty: 1, allocatedQty: 1 }] }),
    ["SCHEMA_GAP_FIELD_PRESENT:salesOrderLineRefs"]);
  assert.deepEqual(reasonsOf({ executionLog: [] }), [], "an empty gap field carries nothing to lose");
  assert.deepEqual(reasonsOf({ mysteryField: 1 }), ["UNMAPPED_SOURCE_FIELD:mysteryField"]);
});

test("Parts Plan: planned lines need a canonical Part id and a whole quantity; usage-only lines are not plan lines", () => {
  const ok = planOne({ inventorySnapshot: [
    { partId: "P-2", sku: "S2", qtyPlanned: 1, qtyUsed: 1 }, { sku: "USED-ONLY", qtyUsed: 3 }, { partId: "P-1", qtyPlanned: 4 },
  ] }).planned;
  assert.deepEqual(ok.partsPlan, [{ partId: "P-1", qtyPlanned: 4 }, { partId: "P-2", qtyPlanned: 1 }]);
  assert.deepEqual(reasonsOf({ inventorySnapshot: [{ sku: "LEGACY", qtyPlanned: 2 }] }), ["PARTS_PLAN_LINE_UNMAPPABLE:inventorySnapshot[0]"]);
  assert.deepEqual(reasonsOf({ inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1.5 }] }), ["PARTS_PLAN_LINE_UNMAPPABLE:inventorySnapshot[0]"]);
  assert.deepEqual(reasonsOf({ inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }, { partId: "P-1", qtyPlanned: 2 }] }),
    ["PARTS_PLAN_DUPLICATE_PART:inventorySnapshot[1]"]);
});

test("an out-of-vocabulary severity is NOT coerced: NULL in the column, the raw value kept as history", () => {
  const { planned } = planOne({ severity: "URGENT" });
  assert.equal(planned.severity, null);
  assert.equal(planned.severityRaw, "URGENT");
  assert.equal(planned.severityDisposition, "OUT_OF_VOCABULARY_HISTORICAL_ONLY");
  assert.equal(planned.priority, 2);
});

// ════════ the plan: assignment ════════

test("a dispatch REASSIGNMENT opens the current interval at reassignedAt", () => {
  const { planned } = planOne({
    status: "DISPATCHED", assignedTechId: "tech-1", scheduledTechId: "tech-1", dispatchedAt: "2026-04-02T07:00:00Z",
    reassignedFromTechId: "tech-2", reassignedAt: "2026-04-02T07:00:00Z", reassignedReason: "sick", reassignedByUid: "uid-d",
  });
  assert.equal(planned.assignment.employeeId, "emp-1");
  assert.equal(planned.assignment.basis, "REASSIGNED_AT");
  assert.equal(planned.assignment.effectiveFrom, "2026-04-02T07:00:00.000000Z");
  assert.match(planned.assignment.reason, /legacy:assignedTechId=tech-1 basis:REASSIGNED_AT/);
  assert.equal(planned.legacyAssignment.reassignedFromTechId, "tech-2", "the prior technician survives as evidence");
});

test("a same-technician dispatch does NOT claim dispatchedAt as the start: the start was never recorded", () => {
  const { planned } = planOne({ status: "DISPATCHED", assignedTechId: "tech-1", scheduledTechId: "tech-1", dispatchedAt: "2026-04-02T07:00:00Z" });
  assert.equal(planned.assignment.basis, "MIGRATION_INSTANT");
  assert.equal(planned.assignment.effectiveFrom, null, "filled with the run's copiedAt, and said so in the reason");
});

test("before dispatch, scheduledTechId is the current assignee; a reschedule to a new technician starts it", () => {
  const { planned } = planOne({
    status: "SCHEDULED", scheduledTechId: "tech-2",
    scheduledStart: "2026-04-06T08:00:00Z", scheduledEnd: "2026-04-06T10:00:00Z",
    rescheduledFromTechId: "tech-1", rescheduledFromStart: "2026-04-05T08:00:00Z", rescheduledFromEnd: "2026-04-05T10:00:00Z",
    rescheduledAt: "2026-04-03T09:00:00Z", rescheduledReason: "customer asked", rescheduledByUid: "uid-s",
  });
  assert.equal(planned.assignment.employeeId, "emp-2");
  assert.equal(planned.assignment.sourceField, "scheduledTechId");
  assert.equal(planned.assignment.basis, "RESCHEDULED_AT");
  assert.equal(planned.assignment.effectiveFrom, "2026-04-03T09:00:00.000000Z");
  assert.deepEqual({ ...planned.scheduleHistory }, {
    id: "wosh_mig_wo-1", previousStart: "2026-04-05T08:00:00.000000Z", previousEnd: "2026-04-05T10:00:00.000000Z",
    newStart: "2026-04-06T08:00:00.000000Z", newEnd: "2026-04-06T10:00:00.000000Z",
    changedAt: "2026-04-03T09:00:00.000000Z", reason: "customer asked", changedByLegacyUid: "uid-s",
  });
  assert.deepEqual(reasonsOf({ status: "SCHEDULED", scheduledTechId: "tech-2", scheduledStart: "2026-04-06T08:00:00Z",
    scheduledEnd: "2026-04-06T10:00:00Z", rescheduledFromStart: "2026-04-05T08:00:00Z", rescheduledFromEnd: "2026-04-05T10:00:00Z" }),
  ["MISSING_REQUIRED_FIELD:rescheduledAt"], "a reschedule snapshot without its instant is refused");
});

test("a terminal unresolved technician: no assignment row, legacy reference kept, never an invented Employee", () => {
  const { planned } = planOne({ status: "COMPLETED", completedAt: "2026-04-02T09:00:00Z", assignedTechId: "tech-gone" });
  assert.equal(planned.assignment, null);
  assert.equal(planned.legacyTechnicianReference, "tech-gone");
});

test("an Owner-decided assignee is carried with its decision id and a migration-instant start", () => {
  const out = planReportFor([rec("wo-1", { status: "DISPATCHED", assignedTechId: "tech-gone", dispatchedAt: "2026-04-02T07:00:00Z" })],
    { decisions: { "wo-1": { assignmentEmployeeId: "emp-2" } } });
  const p = out.planned[0];
  assert.equal(p.assignment.employeeId, "emp-2");
  assert.equal(p.assignment.basis, "MIGRATION_INSTANT");
  assert.match(p.assignment.reason, /decision:OWNER-WOC$/);
});

// ════════ determinism ════════

test("the plan is deterministic, and buildCopyPlan refuses listing EVERY refused record and reason", () => {
  const records = [rec("wo-1"), rec("wo-2", { priority: undefined, createdAt: "2026-04-01T09:00:00" }), rec("wo-3", { status: "CANCELLED", closedAt: "2026-04-05T00:00:00Z" })];
  const a = planReportFor(records);
  const b = planReportFor(records.map((r) => ({ id: r.id, data: Object.fromEntries(Object.entries(r.data).reverse()) })));
  assert.equal(copy.planDigest(a.planned), copy.planDigest(b.planned), "key order and rebuilds do not move the digest");
  assert.deepEqual(a.refused, b.refused);
  assert.deepEqual(a.refused.map((r) => [r.workOrderId, r.reasons.map((x) => x.code).sort()]),
    [["wo-2", ["MISSING_REQUIRED_FIELD", "TIMESTAMP_AMBIGUOUS_TIMEZONE"]]]);
  assert.throws(() => copy.buildCopyPlan(a.input), (e) => {
    assert.equal(e.code, "RECORD_NOT_COPYABLE");
    assert.match(e.message, /wo-2 \[/);
    assert.equal(e.details.length, 1);
    return true;
  });
});
