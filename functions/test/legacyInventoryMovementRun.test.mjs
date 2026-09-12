// LEGACY INVENTORY MOVEMENT CUTOVER TOOLING -- the RUN layer (reject bucket, replay safety,
// reconciliation, manifest).
// Run: node --test test/legacyInventoryMovementRun.test.mjs   (after `npm run build`; no emulator)
//
// The load-bearing assertions are:
//   · TOTALITY        -- planned + rejected === rowsRead, for every batch, including pathological ones.
//   · REPLAY SAFETY   -- every planned movement has a NON-NULL namespaced key, and a second identical
//                        run inserts nothing. A null key is invisible to the destination's PARTIAL
//                        unique index, so "the database will dedupe it" is false by construction.
//   · VERDICT HONESTY -- a run with no source-side census reports UNVERIFIED, never BALANCED.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  planLegacyInventoryMovementRun,
  planImport,
  buildExportManifest,
  reconcileRun,
  summarizeBalances,
  describeMigrationRun,
  migrationIdempotencyKey,
  MIGRATION_IDEMPOTENCY_NAMESPACE,
  RUN_REFUSAL_CODES,
} from "../lib/eosOps/migration/legacyInventoryMovementRun.js";
import { MAPPING_REFUSAL_CODES } from "../lib/eosOps/migration/legacyInventoryMovementMapping.js";
import { MOVEMENT_DIRECTION } from "../lib/inventoryLedger/operationalMovementTypes.js";

const OCCURRED_AT = 1_700_000_000_000;
const CONTEXT = { sourceProjectId: "legacy-project", destinationTenantId: "tenant-1", generatedAt: OCCURRED_AT };

/** A well-formed legacy row, with the source-faithful quantity convention applied for `type`. */
function row(id, type, over = {}) {
  return {
    id,
    type,
    direction: MOVEMENT_DIRECTION[type],
    partId: "part_canonical_1",
    trackingMode: "NONE",
    quantity: 5,
    location: { type: "WAREHOUSE", locationId: "wh-1" },
    sourceObject: { type: "RECEIVING_ORDER", id: "ro-1" },
    actor: { kind: "EMPLOYEE", id: "emp-1" },
    occurredAt: OCCURRED_AT,
    operatingCompanyKey: "taylor",
    ...over,
  };
}

function plan(rows, extra = {}) {
  return planLegacyInventoryMovementRun({ runId: "run-1", rows, ...extra });
}

// ============================ totality: nothing is silently dropped ============================

test("every source row is accounted for exactly once, as planned or as a retained rejection", () => {
  const rows = [
    row("a", "RECEIVED"),
    row("b", "TRANSFER_OUT"),
    { id: "c", type: "RESERVED", quantity: 3 },          // commitment -- refused by the mapper
    row("d", "RECEIVED", { location: "wh-1" }),           // bare location -- refused
    row("e", "RECEIVED", { id: undefined }),              // no source id -- refused by THIS layer
    "not-an-object",                                      // not a row at all
  ];
  const run = plan(rows);
  assert.equal(run.rowsRead, 6);
  assert.equal(run.planned.length + run.rejectBucket.entries.length, 6);
  assert.equal(run.reconciliation.totality.accountedFor, 6);
  assert.equal(run.reconciliation.totality.complete, true);
  assert.equal(run.reconciliation.counts.planned, 2);
  assert.equal(run.reconciliation.counts.rejected, 4);
});

test("an empty batch is a complete, planned-nothing run rather than an error", () => {
  const run = plan([]);
  assert.equal(run.rowsRead, 0);
  assert.equal(run.planned.length, 0);
  assert.equal(run.rejectBucket.entries.length, 0);
  assert.deepEqual(run.rejectBucket.countsByCode, {});
  assert.equal(run.reconciliation.totality.complete, true);
  assert.equal(run.reconciliation.verdict, "UNVERIFIED");
});

test("the reject bucket keeps the source ordinal so a row with no id is still locatable", () => {
  const run = plan([row("a", "RECEIVED"), { id: undefined, type: "NOT_A_TYPE" }]);
  const entry = run.rejectBucket.entries[0];
  assert.equal(entry.sourceOrdinal, 1);
  assert.equal(entry.sourceTransactionId, null);
  assert.equal(entry.code, "UNKNOWN_MOVEMENT_TYPE");
  assert.equal(entry.stage, "MAPPING");
});

test("the reject bucket retains identity, stage, code, detail and observed -- and no source row body", () => {
  const run = plan([row("a", "RECEIVED", { location: { type: "VENDOR", locationId: "v-1" } })]);
  const entry = run.rejectBucket.entries[0];
  assert.deepEqual(Object.keys(entry).sort(),
    ["code", "detail", "observed", "sourceOrdinal", "sourceTransactionId", "stage"]);
  assert.equal(entry.code, "NON_PHYSICAL_LOCATION_TYPE");
  assert.equal(entry.sourceTransactionId, "a");
  assert.ok(entry.detail.length > 0);
  // `observed` is vocabulary tokens only -- never the row.
  for (const value of Object.values(entry.observed)) assert.equal(typeof value, "string");
  const serialized = JSON.stringify(run.rejectBucket);
  assert.ok(!serialized.includes("emp-1"), "an actor id is row content, not diagnostic vocabulary");
  assert.ok(!serialized.includes("part_canonical_1"), "a part id from a refused row is not retained");
});

test("commitment events are RETAINED as rejections, never dropped and never imported", () => {
  const run = plan([{ id: "r1", type: "RESERVED" }, { id: "r2", type: "RELEASED" }, { id: "r3", type: "CONSUMED" }]);
  assert.equal(run.planned.length, 0);
  assert.equal(run.rejectBucket.entries.length, 3);
  assert.deepEqual(run.rejectBucket.countsByCode, { COMMITMENT_EVENT_NOT_PHYSICAL: 3 });
});

test("the reject histogram is key-sorted and sums to the rejected count", () => {
  const run = plan([
    { id: "r1", type: "RESERVED" },
    row("d", "RECEIVED", { location: "wh-1" }),
    { id: "r2", type: "CONSUMED" },
  ]);
  const codes = Object.keys(run.rejectBucket.countsByCode);
  assert.deepEqual(codes, [...codes].sort());
  const total = Object.values(run.rejectBucket.countsByCode).reduce((a, b) => a + b, 0);
  assert.equal(total, run.rejectBucket.entries.length);
});

test("run refusal codes are disjoint from the mapper's, so one code never means two things", () => {
  for (const code of RUN_REFUSAL_CODES) {
    assert.ok(!MAPPING_REFUSAL_CODES.includes(code), `${code} collides with a mapping refusal code`);
  }
});

// ============================ replay safety ============================

test("every planned movement carries a NON-NULL namespaced idempotency key", () => {
  const run = plan([row("a", "RECEIVED"), row("b", "SCRAPPED", { direction: MOVEMENT_DIRECTION.SCRAPPED })]);
  assert.equal(run.planned.length, 2);
  for (const movement of run.planned) {
    assert.equal(typeof movement.idempotencyKey, "string");
    assert.ok(movement.idempotencyKey.startsWith(`${MIGRATION_IDEMPOTENCY_NAMESPACE}:`));
  }
  assert.equal(run.planned[0].idempotencyKey, "legacy-inv-txn:a");
});

test("the key is derived from source identity, never from content -- two identical rows differ", () => {
  const identicalExceptId = [row("a", "RECEIVED"), row("b", "RECEIVED")];
  const run = plan(identicalExceptId);
  assert.equal(run.planned.length, 2, "two distinct movements must both be planned");
  assert.notEqual(run.planned[0].idempotencyKey, run.planned[1].idempotencyKey);
});

test("a row with no stable source identity is rejected, not imported unsafely", () => {
  const run = plan([row(undefined, "RECEIVED")]);
  assert.equal(run.planned.length, 0);
  const entry = run.rejectBucket.entries[0];
  assert.equal(entry.code, "NO_STABLE_SOURCE_IDENTITY");
  assert.equal(entry.stage, "REPLAY_SAFETY");
});

test("a duplicated source id rejects the LATER occurrence instead of letting the database eat one", () => {
  const run = plan([row("dup", "RECEIVED"), row("dup", "SCRAPPED")]);
  assert.equal(run.planned.length, 1);
  assert.equal(run.planned[0].sourceOrdinal, 0);
  const entry = run.rejectBucket.entries[0];
  assert.equal(entry.code, "DUPLICATE_SOURCE_TRANSACTION_ID");
  assert.equal(entry.sourceOrdinal, 1);
  assert.equal(entry.observed.firstSourceOrdinal, "0");
});

test("the legacy row's own idempotency key is kept as evidence and is NOT used as the destination key", () => {
  const run = plan([row("a", "RECEIVED", { idempotencyKey: "cycmv_deadbeef" })]);
  const movement = run.planned[0];
  assert.equal(movement.sourceIdempotencyKey, "cycmv_deadbeef");
  assert.equal(movement.idempotencyKey, "legacy-inv-txn:a");
});

test("migrationIdempotencyKey is deterministic and pure", () => {
  assert.equal(migrationIdempotencyKey("x"), migrationIdempotencyKey("x"));
  assert.equal(migrationIdempotencyKey("x"), "legacy-inv-txn:x");
});

test("planning the same rows twice produces identical plans (no clock, no counter, no randomness)", () => {
  const rows = [row("a", "RECEIVED"), row("b", "TRANSFER_IN"), { id: "c", type: "RESERVED" }];
  assert.deepEqual(
    JSON.parse(JSON.stringify(plan(rows))),
    JSON.parse(JSON.stringify(plan(rows))),
  );
});

// ============================ resume / idempotence ============================

test("re-running a COMPLETED import inserts nothing", () => {
  const run = plan([row("a", "RECEIVED"), row("b", "TRANSFER_OUT")]);
  const first = planImport(run, []);
  assert.equal(first.counts.toInsert, 2);
  assert.equal(first.counts.alreadyPresent, 0);

  // Simulate the destination now holding exactly what the first pass wrote.
  const destination = first.toInsert.map((m) => m.idempotencyKey);
  const second = planImport(plan([row("a", "RECEIVED"), row("b", "TRANSFER_OUT")]), destination);
  assert.equal(second.counts.toInsert, 0);
  assert.equal(second.counts.alreadyPresent, 2);
});

test("an INTERRUPTED import resumes on exactly the remainder, with no cursor and no progress file", () => {
  const rows = [row("a", "RECEIVED"), row("b", "TRANSFER_OUT"), row("c", "SCRAPPED")];
  const run = plan(rows);
  // The first pass died after writing one row.
  const written = [run.planned[0].idempotencyKey];
  const resumed = planImport(plan(rows), written);
  assert.equal(resumed.counts.toInsert, 2);
  assert.deepEqual(resumed.toInsert.map((m) => m.candidate.sourceTransactionId), ["b", "c"]);
  assert.deepEqual(resumed.alreadyPresent.map((m) => m.candidate.sourceTransactionId), ["a"]);
});

test("the destination's unique index is PARTIAL, which is why a null key would defeat replay safety", () => {
  // Not decoration: the schema fact this module exists to work around.
  const sql = readFileSync("migrations/1757808000000_eos-ops-foundation.sql", "utf8");
  assert.match(sql, /CREATE UNIQUE INDEX inventory_movements_idempotency/);
  assert.match(sql, /WHERE idempotency_key IS NOT NULL/);
});

test("the migrated namespace cannot collide with a key minted by a live writer", () => {
  const liveMinted = ["cycmv_abc123", "wox_abc123"];
  for (const key of liveMinted) {
    assert.ok(!key.startsWith(`${MIGRATION_IDEMPOTENCY_NAMESPACE}:`));
  }
});

// ============================ reconciliation ============================

test("balances sum DERIVED signed deltas, so an OUT row decrements", () => {
  const run = plan([
    row("in", "RECEIVED", { quantity: 7 }),
    row("out", "SCRAPPED", { quantity: 3, direction: MOVEMENT_DIRECTION.SCRAPPED }),
  ]);
  assert.equal(run.reconciliation.balances.length, 1);
  const line = run.reconciliation.balances[0];
  assert.equal(line.movementCount, 2);
  assert.equal(line.quantityDelta, 4, "7 received minus 3 scrapped -- never 7 + 3");
});

test("balances are grouped by the typed (company, part, location) grain", () => {
  const run = plan([
    row("a", "RECEIVED", { quantity: 2 }),
    row("b", "RECEIVED", { quantity: 3, location: { type: "BIN", locationId: "wh-1" } }),
    row("c", "RECEIVED", { quantity: 4, operatingCompanyKey: "ventana" }),
  ]);
  assert.equal(run.reconciliation.balances.length, 3, "a BIN is not the same key as a WAREHOUSE of the same id");
  const keys = run.reconciliation.balances.map((b) => `${b.operatingCompanyKey}/${b.locationType}`);
  assert.deepEqual([...keys].sort(), keys, "balance lines are deterministically sorted");
});

test("a run with no source-side census reports UNVERIFIED, never BALANCED", () => {
  const run = plan([row("a", "RECEIVED")]);
  assert.equal(run.reconciliation.expectation, null);
  assert.equal(run.reconciliation.verdict, "UNVERIFIED");
});

test("a census that matches every key yields BALANCED", () => {
  const run = plan([row("a", "RECEIVED", { quantity: 7 })], {
    expectedBalances: [{ operatingCompanyKey: "taylor", partId: "part_canonical_1", locationType: "WAREHOUSE", locationId: "wh-1", quantityDelta: 7 }],
  });
  assert.equal(run.reconciliation.verdict, "BALANCED");
  assert.equal(run.reconciliation.expectation.matched, 1);
  assert.deepEqual(run.reconciliation.expectation.mismatched, []);
});

test("a census that disagrees on a sum yields UNBALANCED and names both numbers", () => {
  const run = plan([row("a", "RECEIVED", { quantity: 7 })], {
    expectedBalances: [{ operatingCompanyKey: "taylor", partId: "part_canonical_1", locationType: "WAREHOUSE", locationId: "wh-1", quantityDelta: -7 }],
  });
  assert.equal(run.reconciliation.verdict, "UNBALANCED");
  const mismatch = run.reconciliation.expectation.mismatched[0];
  assert.equal(mismatch.expectedQuantityDelta, -7);
  assert.equal(mismatch.actualQuantityDelta, 7);
});

test("a key the census expects but the plan never produced is MISSING, not silently ignored", () => {
  const run = plan([], {
    expectedBalances: [{ operatingCompanyKey: "taylor", partId: "p1", locationType: "WAREHOUSE", locationId: "wh-9", quantityDelta: 4 }],
  });
  assert.equal(run.reconciliation.expectation.missing.length, 1);
  assert.equal(run.reconciliation.verdict, "UNBALANCED");
});

test("a key the plan produced but the census never expected is UNEXPECTED, not silently ignored", () => {
  const run = plan([row("a", "RECEIVED")], { expectedBalances: [] });
  assert.equal(run.reconciliation.expectation.unexpected.length, 1);
  assert.equal(run.reconciliation.verdict, "UNBALANCED");
});

test("an incomplete accounting is UNBALANCED even when every supplied expectation matched", () => {
  // reconcileRun is exported precisely so this failure mode is testable: rowsRead disagrees with
  // planned + rejected, which no downstream count could otherwise detect.
  const run = plan([row("a", "RECEIVED", { quantity: 7 })]);
  const report = reconcileRun({
    runId: "run-1",
    rowsRead: 99,
    planned: run.planned,
    rejectBucket: run.rejectBucket,
    expectedBalances: [{ operatingCompanyKey: "taylor", partId: "part_canonical_1", locationType: "WAREHOUSE", locationId: "wh-1", quantityDelta: 7 }],
  });
  assert.equal(report.totality.complete, false);
  assert.equal(report.verdict, "UNBALANCED");
});

test("summarizeBalances over an empty plan is empty, not a zero row", () => {
  assert.deepEqual(summarizeBalances([]), []);
});

// ============================ manifest ============================

test("the manifest carries counts, verdict, source project, destination tenant and hashes", () => {
  const run = plan([row("a", "RECEIVED"), { id: "r", type: "RESERVED" }]);
  const manifest = buildExportManifest(run, CONTEXT);
  assert.equal(manifest.kind, "legacy-inventory-movement-export-manifest");
  assert.equal(manifest.sourceProjectId, "legacy-project");
  assert.equal(manifest.destinationTenantId, "tenant-1");
  assert.equal(manifest.generatedAt, OCCURRED_AT);
  assert.equal(manifest.idempotencyNamespace, MIGRATION_IDEMPOTENCY_NAMESPACE);
  assert.deepEqual(manifest.counts, { rowsRead: 2, planned: 1, rejected: 1 });
  assert.deepEqual(manifest.rejectedByCode, { COMMITMENT_EVENT_NOT_PHYSICAL: 1 });
  assert.equal(manifest.verdict, "UNVERIFIED");
  for (const hash of [manifest.plannedHash, manifest.rejectBucketHash, manifest.reconciliationHash, manifest.manifestHash]) {
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
});

test("the manifest is reproducible: same run + same context => byte-identical hashes", () => {
  const rows = [row("a", "RECEIVED"), row("b", "TRANSFER_OUT")];
  const one = buildExportManifest(plan(rows), CONTEXT);
  const two = buildExportManifest(plan(rows), CONTEXT);
  assert.deepEqual(one, two);
});

test("a single changed quantity changes the manifest hash", () => {
  const a = buildExportManifest(plan([row("a", "RECEIVED", { quantity: 5 })]), CONTEXT);
  const b = buildExportManifest(plan([row("a", "RECEIVED", { quantity: 6 })]), CONTEXT);
  assert.notEqual(a.plannedHash, b.plannedHash);
  assert.notEqual(a.manifestHash, b.manifestHash);
});

test("a changed rejection changes the reject-bucket hash, so a shrinking bucket is visible", () => {
  const a = buildExportManifest(plan([{ id: "r", type: "RESERVED" }]), CONTEXT);
  const b = buildExportManifest(plan([{ id: "r", type: "CONSUMED" }]), CONTEXT);
  assert.notEqual(a.rejectBucketHash, b.rejectBucketHash);
  assert.notEqual(a.manifestHash, b.manifestHash);
});

test("the manifest hash covers the destination tenant, so an export cannot be replayed at another", () => {
  const rows = [row("a", "RECEIVED")];
  const a = buildExportManifest(plan(rows), CONTEXT);
  const b = buildExportManifest(plan(rows), { ...CONTEXT, destinationTenantId: "tenant-2" });
  assert.notEqual(a.manifestHash, b.manifestHash);
});

// ============================ operator summary ============================

test("the operator summary never calls an unverified run a pass", () => {
  const text = describeMigrationRun(plan([row("a", "RECEIVED")]));
  assert.match(text, /UNVERIFIED/);
  assert.match(text, /NOT a pass/);
  assert.doesNotMatch(text, /=> BALANCED/);
});

test("the operator summary tells an operator not to cut over on an unbalanced run", () => {
  const run = plan([row("a", "RECEIVED")], { expectedBalances: [] });
  assert.match(describeMigrationRun(run), /do not cut over/);
});

test("the operator summary reports the manifest hashes when a manifest is supplied", () => {
  const run = plan([row("a", "RECEIVED")]);
  const manifest = buildExportManifest(run, CONTEXT);
  const text = describeMigrationRun(run, manifest);
  assert.ok(text.includes(manifest.manifestHash));
  assert.ok(text.includes("legacy-project"));
});

// ============================ the module stays offline ============================

test("the run module opens no connection: no firebase, no pg, no fs, no clock, no randomness", () => {
  const source = readFileSync("src/eosOps/migration/legacyInventoryMovementRun.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of ["firebase", "firebase-admin", '"pg"', "node:fs", "Date.now(", "Math.random(", "process.env"]) {
    assert.ok(!source.includes(forbidden), `the run layer must not reference ${forbidden}`);
  }
});

test("this tranche adds no SQL migration -- the destination already has every column it needs", () => {
  // If this ever fails, the run layer grew a schema dependency and the shared migration-order tests
  // (eosOpsOperatingCompanyCustody.test.mjs) need the canonical ORDER-not-COUNT fix.
  const foundation = readFileSync("migrations/1757808000000_eos-ops-foundation.sql", "utf8");
  assert.match(foundation, /idempotency_key TEXT/);
  const company = readFileSync("migrations/1757980800000_operating-company-and-serialized-custody.sql", "utf8");
  assert.match(company, /ALTER TABLE inventory_movements ADD COLUMN operating_company_key TEXT NOT NULL/);
});
