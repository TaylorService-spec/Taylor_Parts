// INV-1 Phase 0, PR 0.2 -- tests for the operator audit + retry tooling.
//
// Same convention as operatorAccessCommand.test.js /
// auditLegacyJobTechnicianData.test.js: node --test, requiring the script
// modules directly (require.main guard means nothing executes on import).
// All Firestore access is dependency-injected with in-memory fakes -- NO
// emulator, NO network, NO credentials, NO production project anywhere.
//
// Prerequisite: `npm run build` (scripts require ../lib/inventoryEffectDetection).
// Run: node --test test/inventoryEffectOperatorTools.test.js
//      (or npm run test:inventoryEffectOperatorTools)

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const shared = require("../scripts/inventoryEffectOperatorShared");
const audit = require("../scripts/auditInventoryEffects");
const retry = require("../scripts/retryInventoryEffects");

const TS = { present: true };

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
function fakeSyncSnap(data) {
  if (data === undefined) return { exists: false };
  return { exists: true, data: () => data };
}

// Read-only fake reader for the audit script. It exposes ONLY the read
// methods the reader contract names; any other property access throws --
// a structural proof the audit path never touches a write API.
function buildFakeReader(workOrders, syncDocs) {
  const target = {
    calls: { pages: 0, syncGets: 0, woGets: 0 },
    async listWorkOrdersPage(pageSize, afterDocId) {
      target.calls.pages += 1;
      const sorted = [...workOrders].sort((a, b) => (a.id < b.id ? -1 : 1));
      const start = afterDocId === null ? 0 : sorted.findIndex((d) => d.id === afterDocId) + 1;
      return sorted.slice(start, start + pageSize);
    },
    async getSyncStatus(id) {
      target.calls.syncGets += 1;
      return fakeSyncSnap(syncDocs[id]);
    },
    async getWorkOrder(id) {
      target.calls.woGets += 1;
      const doc = workOrders.find((d) => d.id === id);
      return doc ? { id: doc.id, exists: true, data: doc.data } : { id, exists: false };
    },
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      throw new Error(`Audit reader accessed unexpected member: ${String(prop)} -- write API?`);
    },
  });
}

const WO_DISPATCHED_MISS = {
  id: "WO-1",
  data: { status: "DISPATCHED", dispatchedAt: TS, inventorySnapshot: [{ sku: "TST-1001", qtyPlanned: 2 }] },
};
const WO_PROCESSED = { id: "WO-2", data: { status: "DISPATCHED", dispatchedAt: TS } };
const WO_FAILURE = { id: "WO-3", data: { status: "COMPLETED", dispatchedAt: TS, completedAt: TS } };
const WO_CREATED = { id: "WO-4", data: { status: "CREATED" } };
const WO_MALFORMED = { id: "WO-5", data: { status: "WEIRD", dispatchedAt: TS } };

const SYNC_DOCS = {
  "WO-2": { processedStates: { DISPATCHED: true } },
  "WO-3": {
    processedStates: { DISPATCHED: true },
    failures: { COMPLETED: { error: "Insufficient available quantity", at: TS, retryNeeded: true } },
  },
};

function auditOptions(overrides = {}) {
  return {
    projectId: "demo-inv1",
    emulatorHost: null,
    outputDir: null,
    workOrderIds: [],
    pageSize: 2,
    maxWorkOrders: null,
    json: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared helper tests
// ---------------------------------------------------------------------------
test("shared: project confirmation refuses missing/mismatched confirmation and missing project", () => {
  assert.throws(() => shared.assertProjectConfirmation({}), shared.InvalidInvocationError);
  assert.throws(
    () => shared.assertProjectConfirmation({ "project-id": "demo-inv1" }),
    shared.InvalidInvocationError
  );
  assert.throws(
    () => shared.assertProjectConfirmation({ "project-id": "demo-inv1", "confirm-project": "other" }),
    shared.InvalidInvocationError
  );
  const ok = shared.assertProjectConfirmation({
    "project-id": "demo-inv1",
    "confirm-project": "demo-inv1",
  });
  assert.equal(ok.projectId, "demo-inv1");
});

test("shared: no silent production default -- production only via exact explicit id", () => {
  const prod = shared.assertProjectConfirmation({
    "project-id": shared.PRODUCTION_PROJECT_ID,
    "confirm-project": shared.PRODUCTION_PROJECT_ID,
  });
  assert.equal(typeof prod.isProduction, "boolean");
  // And nothing else resolves as production.
  const other = shared.assertProjectConfirmation({
    "project-id": "demo-inv1",
    "confirm-project": "demo-inv1",
  });
  assert.equal(other.isProduction, false);
});

test("shared: canonical JSON is key-order deterministic; sha256 stable", () => {
  const a = shared.canonicalJson({ b: 1, a: { d: 2, c: 3 } });
  const b = shared.canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(shared.sha256Hex(a), shared.sha256Hex(b));
});

test("shared: batch normalization rejects malformed/unsupported, dedupes deterministically", () => {
  const states = ["DISPATCHED", "COMPLETED", "CANCELLED"];
  const { pairs, duplicates, invalid } = shared.normalizeRetryBatch(
    [
      { workOrderId: "WO-1", state: "DISPATCHED" },
      { workOrderId: "WO-1", state: "DISPATCHED" }, // duplicate
      { workOrderId: "WO-2", state: "ARRIVED" }, // unsupported
      { workOrderId: "", state: "COMPLETED" }, // malformed
      { workOrderId: "WO-3", state: "CANCELLED", extra: 1 }, // unexpected key
    ],
    states
  );
  assert.deepEqual(pairs, [{ workOrderId: "WO-1", state: "DISPATCHED" }]);
  assert.equal(duplicates.length, 1);
  assert.equal(invalid.length, 3);
  assert.throws(() => shared.normalizeRetryBatch([], states), shared.InvalidInvocationError);
});

// ---------------------------------------------------------------------------
// Audit script tests
// ---------------------------------------------------------------------------
test("audit: refuses missing and mismatched project confirmation", () => {
  assert.throws(() => audit.parseAuditOptions(["--output-dir", "x"]), shared.InvalidInvocationError);
  assert.throws(
    () =>
      audit.parseAuditOptions([
        "--project-id", "demo-inv1",
        "--confirm-project", "taylor-parts",
        "--output-dir", "x",
      ]),
    shared.InvalidInvocationError
  );
});

test("audit: requires --output-dir; validates page size", () => {
  assert.throws(
    () => audit.parseAuditOptions(["--project-id", "d", "--confirm-project", "d"]),
    shared.InvalidInvocationError
  );
  assert.throws(
    () =>
      audit.parseAuditOptions([
        "--project-id", "d", "--confirm-project", "d", "--output-dir", "x", "--page-size", "0",
      ]),
    shared.InvalidInvocationError
  );
});

test("audit: read-only run -- correct counts, retry candidates, warnings; no write member ever touched", async () => {
  const reader = buildFakeReader(
    [WO_DISPATCHED_MISS, WO_PROCESSED, WO_FAILURE, WO_CREATED, WO_MALFORMED],
    SYNC_DOCS
  );
  const result = await audit.runAudit({
    reader,
    options: auditOptions(),
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.equal(result.summary.scannedWorkOrders, 5);
  // WO-1: DISPATCHED silent miss. WO-2: processed. WO-3: DISPATCHED processed +
  // COMPLETED recorded failure. WO-4: nothing. WO-5: unknown status, timestamp-driven miss.
  assert.equal(result.summary.countsByClassification.SILENT_MISS, 2);
  assert.equal(result.summary.countsByClassification.RECORDED_FAILURE, 1);
  assert.equal(result.summary.countsByClassification.PROCESSED, 2);
  assert.equal(
    result.summary.countsByClassification.NOT_EXPECTED,
    5 * 3 - 2 - 1 - 2
  );
  const candidateKeys = result.retryCandidates.map((c) => `${c.workOrderId}:${c.state}`).sort();
  assert.deepEqual(candidateKeys, ["WO-1:DISPATCHED", "WO-3:COMPLETED", "WO-5:DISPATCHED"]);
  // WO-5 carried an unknown-status warning -> flagged.
  assert.ok(result.flagged.some((f) => f.workOrderId === "WO-5"));
  // Pagination arithmetic: 5 docs at page size 2 => 3 pages.
  assert.equal(reader.calls.pages, 3);
  assert.equal(reader.calls.syncGets, 5);
});

test("audit: deterministic pagination and --max-work-orders truncation is visible", async () => {
  const reader = buildFakeReader(
    [WO_DISPATCHED_MISS, WO_PROCESSED, WO_FAILURE, WO_CREATED, WO_MALFORMED],
    SYNC_DOCS
  );
  const result = await audit.runAudit({
    reader,
    options: auditOptions({ maxWorkOrders: 3 }),
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.equal(result.summary.scannedWorkOrders, 3);
  assert.equal(result.summary.truncated, true);
  assert.equal(result.runMetadata.truncated, true);
});

test("audit: exact --work-order-id filter, including a missing id", async () => {
  const reader = buildFakeReader([WO_PROCESSED], SYNC_DOCS);
  const result = await audit.runAudit({
    reader,
    options: auditOptions({ workOrderIds: ["WO-2", "WO-MISSING"] }),
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.equal(result.summary.scannedWorkOrders, 1);
  assert.equal(result.summary.invalidRecordCount, 1);
  assert.equal(result.invalidRecords[0].reasonCode, "WORK_ORDER_NOT_FOUND");
  assert.equal(reader.calls.pages, 0); // filter mode never lists
});

test("audit: handles missing sync docs and malformed Work Orders without throwing", async () => {
  const reader = buildFakeReader([WO_DISPATCHED_MISS, WO_MALFORMED], {});
  const result = await audit.runAudit({
    reader,
    options: auditOptions(),
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.equal(result.summary.invalidRecordCount, 0);
  assert.equal(result.summary.countsByClassification.SILENT_MISS, 2);
});

test("audit: deterministic machine-readable output (same inputs, same bytes)", async () => {
  const run = () =>
    audit.runAudit({
      reader: buildFakeReader([WO_DISPATCHED_MISS, WO_FAILURE], SYNC_DOCS),
      options: auditOptions(),
      nowIso: "2026-07-22T00:00:00.000Z",
    });
  const [a, b] = [await run(), await run()];
  assert.equal(shared.canonicalJson(a), shared.canonicalJson(b));
});

test("audit: declared Firestore surface is read-only; source contains no write API", () => {
  for (const m of audit.FIRESTORE_METHODS_USED) {
    assert.ok(
      !/set\(|add\(|update\(|delete\(|runTransaction|BulkWriter/.test(m),
      `write-looking method declared: ${m}`
    );
  }
  const source = fs.readFileSync(require.resolve("../scripts/auditInventoryEffects.js"), "utf8");
  for (const forbidden of [".set(", ".add(", ".update(", ".delete(", "runTransaction", "BulkWriter", "FieldValue"]) {
    assert.ok(!source.includes(forbidden), `audit script source contains ${forbidden}`);
  }
});

test("audit: evidence artifacts written with checksums + sensitive scan; verifiable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inv1-audit-test-"));
  try {
    const { written, sensitiveClean } = shared.writeEvidenceArtifacts(dir, {
      "summary.json": { hello: "world" },
      "detection-results.jsonl": '{"a":1}\n',
    });
    assert.deepEqual(
      written.sort(),
      ["checksums.sha256", "detection-results.jsonl", "sensitive-scan.txt", "summary.json"].sort()
    );
    assert.equal(sensitiveClean, true);
    // Verify every checksum line against the actual file bytes.
    const lines = fs.readFileSync(path.join(dir, "checksums.sha256"), "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    for (const line of lines) {
      const [hash, name] = line.split(/\s{2}/);
      const actual = shared.sha256Hex(fs.readFileSync(path.join(dir, name), "utf8"));
      assert.equal(actual, hash, `checksum mismatch for ${name}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("audit: sensitive scan flags credential-shaped content", () => {
  const hits = shared.scanSensitive('{"private_key": "-----BEGIN PRIVATE KEY-----"}');
  assert.ok(hits.length >= 1);
});

test("audit: --help text covers safety essentials", () => {
  for (const needle of ["READ-ONLY", "--project-id", "--confirm-project", "--output-dir", "Gate 0.4(a)", "zero Firestore writes"]) {
    assert.ok(audit.HELP_TEXT.includes(needle), `help missing: ${needle}`);
  }
});

// ---------------------------------------------------------------------------
// Retry script tests
// ---------------------------------------------------------------------------
function retryDeps(workOrders, syncDocsInitial, { failWith } = {}) {
  // Mutable sync store so triggerEffects can simulate the real path's
  // markStateProcessed / recordFailure behavior.
  const syncDocs = JSON.parse(JSON.stringify(syncDocsInitial));
  const triggerCalls = [];
  return {
    syncDocs,
    triggerCalls,
    async loadWorkOrder(id) {
      const doc = workOrders.find((d) => d.id === id);
      return doc ? { id: doc.id, exists: true, data: doc.data } : { id, exists: false };
    },
    async loadSyncStatus(id) {
      return fakeSyncSnap(syncDocs[id]);
    },
    async triggerEffects(id, state) {
      triggerCalls.push(`${id}:${state}`);
      if (failWith === "throw") throw new Error("simulated SDK outage");
      if (!syncDocs[id]) syncDocs[id] = {};
      if (failWith === "business") {
        syncDocs[id].failures = {
          ...(syncDocs[id].failures ?? {}),
          [state]: { error: "Insufficient available quantity for part TST-1001", at: TS, retryNeeded: true },
        };
      } else {
        syncDocs[id].processedStates = { ...(syncDocs[id].processedStates ?? {}), [state]: true };
        if (syncDocs[id].failures) delete syncDocs[id].failures[state];
        if (state === "COMPLETED") syncDocs[id].finalized = true;
      }
    },
  };
}

test("retry: refuses missing project confirmation, mismatch, and missing owner acknowledgement", () => {
  assert.throws(() => retry.parseRetryOptions(["--input", "b.json", "--output-dir", "x"]), shared.InvalidInvocationError);
  assert.throws(
    () =>
      retry.parseRetryOptions([
        "--project-id", "demo-inv1", "--confirm-project", "other",
        "--confirm-owner-authorized-retry", "--input", "b.json", "--output-dir", "x",
      ]),
    shared.InvalidInvocationError
  );
  assert.throws(
    () =>
      retry.parseRetryOptions([
        "--project-id", "demo-inv1", "--confirm-project", "demo-inv1",
        "--input", "b.json", "--output-dir", "x",
      ]),
    /confirm-owner-authorized-retry/
  );
});

test("retry: rejects malformed input files and unsupported states before any execution", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inv1-retry-test-"));
  try {
    const write = (name, content) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, content);
      return p;
    };
    assert.throws(() => retry.loadBatchFile(write("nojson.json", "{nope")), shared.InvalidInvocationError);
    assert.throws(() => retry.loadBatchFile(write("empty.json", "[]")), shared.InvalidInvocationError);
    assert.throws(
      () => retry.loadBatchFile(write("badstate.json", JSON.stringify([{ workOrderId: "WO-1", state: "ARRIVED" }]))),
      shared.InvalidInvocationError
    );
    assert.throws(
      () => retry.loadBatchFile(write("extra.json", JSON.stringify([{ workOrderId: "WO-1", state: "DISPATCHED", note: "x" }]))),
      shared.InvalidInvocationError
    );
    // Duplicates are de-duplicated and reported, not fatal.
    const ok = retry.loadBatchFile(
      write("dup.json", JSON.stringify([
        { workOrderId: "WO-1", state: "DISPATCHED" },
        { workOrderId: "WO-1", state: "DISPATCHED" },
      ]))
    );
    assert.equal(ok.pairs.length, 1);
    assert.equal(ok.duplicates.length, 1);
    assert.equal(typeof ok.batchHash, "string");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("retry: preflight refuses PROCESSED, NOT_EXPECTED, missing WO, and flagged evidence -- zero trigger calls", async () => {
  const deps = retryDeps(
    [WO_PROCESSED, WO_CREATED, WO_MALFORMED_FLAGGED()],
    { "WO-2": { processedStates: { DISPATCHED: true } }, "WO-9": { processedStates: { DISPATCHED: "yes" } } }
  );
  const run = await retry.runRetryBatch({
    pairs: [
      { workOrderId: "WO-2", state: "DISPATCHED" }, // PROCESSED
      { workOrderId: "WO-4", state: "DISPATCHED" }, // NOT_EXPECTED
      { workOrderId: "WO-MISSING", state: "DISPATCHED" }, // missing doc
      { workOrderId: "WO-9", state: "DISPATCHED" }, // malformed marker -> flagged
    ],
    deps,
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.deepEqual(deps.triggerCalls, []); // nothing executed
  const byId = Object.fromEntries(run.outcomes.map((o) => [`${o.workOrderId}:${o.state}`, o.result]));
  assert.equal(byId["WO-2:DISPATCHED"], "REFUSED_ALREADY_PROCESSED");
  assert.equal(byId["WO-4:DISPATCHED"], "REFUSED_NOT_EXPECTED");
  assert.equal(byId["WO-MISSING:DISPATCHED"], "REFUSED_WORK_ORDER_NOT_FOUND");
  assert.equal(byId["WO-9:DISPATCHED"], "REFUSED_FLAGGED_EVIDENCE");
  assert.equal(run.allResolved, false);
});

function WO_MALFORMED_FLAGGED() {
  return { id: "WO-9", data: { status: "DISPATCHED", dispatchedAt: TS } };
}

test("retry: executes existing path exactly once per approved pair; post-check RESOLVED_PROCESSED", async () => {
  const deps = retryDeps([WO_DISPATCHED_MISS, WO_FAILURE], SYNC_DOCS);
  const run = await retry.runRetryBatch({
    pairs: [
      { workOrderId: "WO-1", state: "DISPATCHED" }, // SILENT_MISS
      { workOrderId: "WO-3", state: "COMPLETED" }, // RECORDED_FAILURE
    ],
    deps,
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.deepEqual(deps.triggerCalls, ["WO-1:DISPATCHED", "WO-3:COMPLETED"]); // exactly once each
  for (const o of run.outcomes) {
    assert.equal(o.result, "RESOLVED_PROCESSED");
    assert.equal(o.postCheck.classification, "PROCESSED");
  }
  assert.equal(run.allResolved, true);
});

test("retry: expected business failure recorded distinctly; batch continues", async () => {
  const deps = retryDeps([WO_DISPATCHED_MISS, WO_FAILURE], SYNC_DOCS, { failWith: "business" });
  const run = await retry.runRetryBatch({
    pairs: [
      { workOrderId: "WO-1", state: "DISPATCHED" },
      { workOrderId: "WO-3", state: "COMPLETED" },
    ],
    deps,
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.equal(deps.triggerCalls.length, 2); // continued past the first business failure
  for (const o of run.outcomes) {
    assert.equal(o.result, "BUSINESS_FAILURE_RECORDED");
    assert.match(o.error, /Insufficient available quantity/);
    assert.equal(o.postCheck.classification, "RECORDED_FAILURE");
  }
  assert.equal(run.allResolved, false);
});

test("retry: unexpected systemic error stops the batch immediately", async () => {
  const deps = retryDeps([WO_DISPATCHED_MISS, WO_FAILURE], SYNC_DOCS, { failWith: "throw" });
  const run = await retry.runRetryBatch({
    pairs: [
      { workOrderId: "WO-1", state: "DISPATCHED" },
      { workOrderId: "WO-3", state: "COMPLETED" },
    ],
    deps,
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.deepEqual(deps.triggerCalls, ["WO-1:DISPATCHED"]); // second never attempted
  assert.equal(run.outcomes[0].result, "SYSTEMIC_ERROR_STOP");
  assert.match(run.outcomes[0].error, /simulated SDK outage/);
  assert.equal(run.outcomes[1].result, "NOT_ATTEMPTED_AFTER_SYSTEMIC_STOP");
  assert.equal(run.systemicStop, "simulated SDK outage");
});

test("retry: never expands beyond the supplied list (allowed candidates elsewhere untouched)", async () => {
  // WO-1 is a valid SILENT_MISS candidate but is NOT in the batch.
  const deps = retryDeps([WO_DISPATCHED_MISS, WO_FAILURE], SYNC_DOCS);
  await retry.runRetryBatch({
    pairs: [{ workOrderId: "WO-3", state: "COMPLETED" }],
    deps,
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  assert.deepEqual(deps.triggerCalls, ["WO-3:COMPLETED"]);
});

test("retry: deterministic outcome artifact content", async () => {
  const run = () =>
    retry.runRetryBatch({
      pairs: [{ workOrderId: "WO-1", state: "DISPATCHED" }],
      deps: retryDeps([WO_DISPATCHED_MISS], {}),
      nowIso: "2026-07-22T00:00:00.000Z",
    });
  const [a, b] = [await run(), await run()];
  assert.equal(shared.canonicalJson(a), shared.canonicalJson(b));
});

test("retry: source reimplements no effect primitive and bypasses no guard", () => {
  const source = fs.readFileSync(require.resolve("../scripts/retryInventoryEffects.js"), "utf8");
  // The script must reference the existing path...
  assert.ok(source.includes("triggerInventoryEffects"));
  // ...and must not touch the primitives or write APIs directly.
  for (const forbidden of ["reserveParts", "releaseParts", "consumeParts", "finalizeInventoryTransaction", ".set(", ".add(", ".update(", ".delete(", "runTransaction", "BulkWriter", "FieldValue"]) {
    assert.ok(!source.includes(forbidden), `retry script source contains ${forbidden}`);
  }
  // No wildcard FLAG anywhere in its CLI surface (the prose comments
  // prohibiting wildcards are expected; actual flags would appear in
  // --flag syntax).
  for (const wildcard of ["--all", "--retry-all", "--all-failed", "--all-silent", "--retry-all-failed"]) {
    assert.ok(!source.includes(wildcard), `retry script offers wildcard flag: ${wildcard}`);
  }
});

test("retry: --help prominently states the exact-pairs requirement", () => {
  assert.ok(
    retry.HELP_TEXT.includes(
      "NO RETRY IS AUTHORIZED WITHOUT EXACT OWNER-APPROVED WORK ORDER / STATE PAIRS"
    )
  );
  for (const needle of ["--confirm-owner-authorized-retry", "Gate 0.4(b)", "--confirm-project"]) {
    assert.ok(retry.HELP_TEXT.includes(needle), `help missing: ${needle}`);
  }
});
