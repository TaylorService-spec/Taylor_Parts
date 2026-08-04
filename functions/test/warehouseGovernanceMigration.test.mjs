// Receiving Location Authority -- I-LA3: offline unit tests for the warehouse-governance migration core
// + operator CLI orchestration (functions/src/warehouseGovernance/warehouseGovernanceMigration.ts,
// warehouseGovernanceEvidence.ts, functions/scripts/warehouseGovernanceMigrationCli.js). PURE: no Firebase
// app, no emulator, no network. `Timestamp` is constructed offline. Prerequisite: npm run build.
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  warehouseGovernanceFingerprint,
  classifyWarehouse,
  planMigration,
  validateResolutionManifest,
  buildMigratedRecord,
  executeMigration,
  WarehouseMigrationError,
} from "../lib/warehouseGovernance/warehouseGovernanceMigration.js";
import { validateGovernedWarehouse } from "../lib/warehouseGovernance/governedWarehouseValidation.js";
import { buildDryRunEvidence, scanForSecrets } from "../lib/warehouseGovernance/warehouseGovernanceEvidence.js";
const cliMod = await import("../scripts/warehouseGovernanceMigrationCli.js");
const cli = cliMod.default ?? cliMod;

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); }
}
async function acheck(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); }
}

const TS = Timestamp.fromMillis(1_700_000_000_000);
const PINS = { projectId: "taylor-parts", governedCommit: "c".repeat(40) };
function governed(id) {
  return { id, name: "N", location: "L", status: "ACTIVE", version: 1, updatedAt: TS, updatedBy: "u", provenance: "NATIVE", createdAt: TS, createdBy: "u" };
}

// ---- fingerprint ----
check("fingerprint deterministic + drift-sensitive", () => {
  const a = { name: "N", location: "L", active: true };
  assert.equal(warehouseGovernanceFingerprint(a), warehouseGovernanceFingerprint({ location: "L", name: "N", active: true }));
  assert.notEqual(warehouseGovernanceFingerprint(a), warehouseGovernanceFingerprint({ ...a, active: false }));
});

// ---- classification matrix (§4) ----
check("classify: governed record -> GOVERNED no-op", () => {
  assert.equal(classifyWarehouse("wh", governed("wh")).category, "GOVERNED");
});
check("classify: missing status derives from active", () => {
  assert.deepEqual(pick(classifyWarehouse("w", { name: "N", location: "L", active: false })), ["DERIVE", "INACTIVE"]);
  assert.deepEqual(pick(classifyWarehouse("w", { name: "N", location: "L", active: true })), ["DERIVE", "ACTIVE"]);
  assert.deepEqual(pick(classifyWarehouse("w", { name: "N", location: "L" })), ["DERIVE", "ACTIVE"]);
});
check("classify: contradictions + malformed status -> AMBIGUOUS", () => {
  assert.equal(classifyWarehouse("w", { name: "N", location: "L", status: "ACTIVE", active: false }).category, "AMBIGUOUS");
  assert.equal(classifyWarehouse("w", { name: "N", location: "L", status: "INACTIVE", active: true }).category, "AMBIGUOUS");
  assert.equal(classifyWarehouse("w", { name: "N", location: "L", status: "PENDING" }).category, "AMBIGUOUS");
  assert.equal(classifyWarehouse("w", null).category, "AMBIGUOUS");
});
check("classify: valid status non-contradictory -> DERIVE that status", () => {
  assert.deepEqual(pick(classifyWarehouse("w", { name: "N", location: "L", status: "ACTIVE", active: true })), ["DERIVE", "ACTIVE"]);
  assert.deepEqual(pick(classifyWarehouse("w", { name: "N", location: "L", status: "INACTIVE" })), ["DERIVE", "INACTIVE"]);
});
function pick(c) { return [c.category, c.derivedStatus]; }

// ---- plan ----
check("planMigration: counts + duplicate/unpinned guards", () => {
  const plan = planMigration([
    { warehouseId: "g", data: governed("g") },
    { warehouseId: "a", data: { name: "N", location: "L" } },        // DERIVE
    { warehouseId: "b", data: { name: "N", location: "L", status: "ACTIVE", active: false } }, // AMBIGUOUS
  ], PINS);
  assert.deepEqual(plan.counts, { total: 3, governed: 1, derive: 1, ambiguous: 1 });
  assert.equal(plan.ambiguous[0].warehouseId, "b");
  assert.throws(() => planMigration([{ warehouseId: "x", data: {} }, { warehouseId: "x", data: {} }], PINS), WarehouseMigrationError);
  assert.throws(() => planMigration([], { projectId: "", governedCommit: "c" }), WarehouseMigrationError);
});

// ---- buildMigratedRecord ----
check("buildMigratedRecord: MIGRATED envelope; preserve authentic created pair; never fabricate", () => {
  const r1 = buildMigratedRecord("w", { name: "N", location: "L", createdAt: TS, createdBy: "orig" }, "INACTIVE", { actorId: "tool", nowMillis: TS.toMillis() });
  assert.equal(r1.provenance, "MIGRATED");
  assert.equal(r1.version, 1);
  assert.equal(r1.status, "INACTIVE");
  assert.ok(r1.governanceInitializedAt instanceof Timestamp && r1.governanceInitializedBy === "tool");
  assert.equal(r1.createdBy, "orig"); // authentic pair preserved
  assert.equal(validateGovernedWarehouse(r1, "w").valid, true);
  // incomplete/invalid created pair -> NOT fabricated, both omitted
  const r2 = buildMigratedRecord("w", { name: "N", location: "L", createdAt: TS }, "ACTIVE", { actorId: "tool", nowMillis: TS.toMillis() });
  assert.equal(r2.createdAt, undefined);
  assert.equal(r2.createdBy, undefined);
  assert.equal(validateGovernedWarehouse(r2, "w").valid, true);
  // no legacy active on the built record
  const r3 = buildMigratedRecord("w", { name: "N", location: "L", active: false }, "INACTIVE", { actorId: "tool", nowMillis: TS.toMillis() });
  assert.ok(!Object.prototype.hasOwnProperty.call(r3, "active"));
});

// ---- manifest validation ----
check("validateResolutionManifest: valid + every failure mode", () => {
  const plan = planMigration([
    { warehouseId: "b", data: { name: "N", location: "L", status: "ACTIVE", active: false } },
    { warehouseId: "c", data: { name: "N", location: "L", status: "PENDING" } },
  ], PINS);
  const fp = Object.fromEntries(plan.ambiguous.map((a) => [a.warehouseId, a.fingerprint]));
  const good = { projectId: PINS.projectId, governedCommit: PINS.governedCommit, entries: [
    { warehouseId: "b", intendedStatus: "INACTIVE", preStateFingerprint: fp.b },
    { warehouseId: "c", intendedStatus: "ACTIVE", preStateFingerprint: fp.c },
  ] };
  assert.equal(validateResolutionManifest(good, plan).valid, true);
  const reason = (over) => validateResolutionManifest({ ...good, ...over }, plan).reason;
  assert.equal(reason({ projectId: "other" }), "wrong_project");
  assert.equal(reason({ governedCommit: "d".repeat(40) }), "wrong_commit");
  assert.equal(reason({ entries: {} }), "entries_not_array");
  assert.equal(validateResolutionManifest({ ...good, entries: good.entries.slice(0, 1) }, plan).reason, "missing_entry");
  assert.equal(validateResolutionManifest({ ...good, entries: [...good.entries, { warehouseId: "zzz", intendedStatus: "ACTIVE", preStateFingerprint: "x" }] }, plan).reason, "extra_entry");
  assert.equal(validateResolutionManifest({ ...good, entries: [good.entries[0], good.entries[0], good.entries[1]] }, plan).reason, "duplicate_entry");
  assert.equal(validateResolutionManifest({ ...good, entries: [{ warehouseId: "b", intendedStatus: "NOPE", preStateFingerprint: fp.b }, good.entries[1]] }, plan).reason, "invalid_status");
  assert.equal(validateResolutionManifest({ ...good, entries: [{ warehouseId: "b", intendedStatus: "ACTIVE", preStateFingerprint: "stale" }, good.entries[1]] }, plan).reason, "stale_prestate");
});

// ---- executeMigration (fake in-memory store) ----
function fakeStore(map) {
  const staged = [];
  return { staged, async reRead(id) { return map.has(id) ? map.get(id) : null; }, stage(id, rec) { staged.push({ id, rec }); } };
}
const NOW = () => new Date(TS.toMillis());

await acheck("executeMigration: derive-only set migrates all; governed skipped; MIGRATED envelope", async () => {
  const live = [
    { warehouseId: "g", data: governed("g") },
    { warehouseId: "a", data: { name: "A", location: "L", active: false } },
    { warehouseId: "b", data: { name: "B", location: "L" } },
  ];
  const plan = planMigration(live, PINS);
  const map = new Map(live.map((w) => [w.warehouseId, w.data]));
  const store = fakeStore(map);
  const res = await executeMigration({ plan, manifest: {}, store, actorId: "tool", now: NOW });
  assert.deepEqual(res.counts, { migrated: 2, skippedGoverned: 1 });
  assert.equal(store.staged.length, 2);
  for (const s of store.staged) assert.equal(validateGovernedWarehouse(s.rec, s.id).valid, true);
  assert.equal(store.staged.find((s) => s.id === "a").rec.status, "INACTIVE");
  assert.equal(store.staged.find((s) => s.id === "b").rec.status, "ACTIVE");
});

await acheck("executeMigration: ambiguous requires manifest; resolves via manifest", async () => {
  const live = [{ warehouseId: "b", data: { name: "N", location: "L", status: "ACTIVE", active: false } }];
  const plan = planMigration(live, PINS);
  const map = new Map(live.map((w) => [w.warehouseId, w.data]));
  // no manifest entry -> MANIFEST_INVALID (missing_entry)
  await assert.rejects(executeMigration({ plan, manifest: { projectId: PINS.projectId, governedCommit: PINS.governedCommit, entries: [] }, store: fakeStore(map), actorId: "tool", now: NOW }), (e) => e.code === "MANIFEST_INVALID");
  // with a valid manifest entry -> migrates to the resolved status
  const manifest = { projectId: PINS.projectId, governedCommit: PINS.governedCommit, entries: [{ warehouseId: "b", intendedStatus: "INACTIVE", preStateFingerprint: plan.ambiguous[0].fingerprint }] };
  const store = fakeStore(map);
  const res = await executeMigration({ plan, manifest, store, actorId: "tool", now: NOW });
  assert.equal(res.counts.migrated, 1);
  assert.equal(store.staged[0].rec.status, "INACTIVE");
});

await acheck("executeMigration: stale pre-state -> STALE_PRESTATE, no further staging", async () => {
  const live = [{ warehouseId: "a", data: { name: "A", location: "L" } }];
  const plan = planMigration(live, PINS);
  // store returns MUTATED live data -> fingerprint mismatch
  const store = fakeStore(new Map([["a", { name: "A-CHANGED", location: "L" }]]));
  await assert.rejects(executeMigration({ plan, manifest: {}, store, actorId: "tool", now: NOW }), (e) => e.code === "STALE_PRESTATE");
  assert.equal(store.staged.length, 0);
});

await acheck("executeMigration: disappeared record -> RECORD_DISAPPEARED", async () => {
  const live = [{ warehouseId: "a", data: { name: "A", location: "L" } }];
  const plan = planMigration(live, PINS);
  await assert.rejects(executeMigration({ plan, manifest: {}, store: fakeStore(new Map()), actorId: "tool", now: NOW }), (e) => e.code === "RECORD_DISAPPEARED");
});

await acheck("executeMigration: idempotent -- all-governed set stages nothing", async () => {
  const live = [{ warehouseId: "g", data: governed("g") }];
  const plan = planMigration(live, PINS);
  const store = fakeStore(new Map([["g", governed("g")]]));
  const res = await executeMigration({ plan, manifest: {}, store, actorId: "tool", now: NOW });
  assert.deepEqual(res.counts, { migrated: 0, skippedGoverned: 1 });
  assert.equal(store.staged.length, 0);
});

// ---- CLI: parseArgs + atomic evidence publish ----
check("cli.parseArgs: dry-run default; execute requires ack + manifest; required pins", () => {
  const base = ["--project", "taylor-parts", "--commit", "c", "--evidence-dir", "/ev"];
  assert.equal(cli.parseArgs(base).execute, false);
  assert.throws(() => cli.parseArgs([...base, "--execute"]), /acknowledge-production-write/);
  assert.throws(() => cli.parseArgs([...base, "--execute", "--acknowledge-production-write"]), /--manifest/);
  assert.equal(cli.parseArgs([...base, "--execute", "--acknowledge-production-write", "--manifest", "/m.json"]).execute, true);
  assert.throws(() => cli.parseArgs(["--commit", "c", "--evidence-dir", "/ev"]), /--project/);
});

function fakeFs() {
  const files = new Map(); const dirs = new Set();
  return { stamp: "T", files, dirs,
    mkdirp: (d) => dirs.add(d),
    rmrf: (d) => { dirs.delete(d); for (const k of [...files.keys()]) if (k.startsWith(d)) files.delete(k); },
    writeFile: (p, c) => files.set(p, c),
    exists: (p) => dirs.has(p),
    rename: (a, b) => { dirs.delete(a); dirs.add(b); for (const [k, v] of [...files]) if (k.startsWith(a)) { files.set(b + k.slice(a.length), v); files.delete(k); } },
  };
}
check("cli.publishEvidenceAtomically: happy path writes files + checksums to final dir", () => {
  const fs = fakeFs();
  const dir = cli.publishEvidenceAtomically(fs, "/ev/run", [{ name: "dry-run.json", content: '{"kind":"warehouse-migration-dry-run","counts":{"total":0}}' }]);
  assert.equal(dir, "/ev/run");
  assert.ok(fs.dirs.has("/ev/run"));
  assert.ok([...fs.files.keys()].some((k) => k.includes("checksums.sha256")));
  assert.ok(![...fs.dirs].some((d) => d.includes(".tmp-")), "temp dir cleaned");
});
check("cli.publishEvidenceAtomically: secret-like content blocks publish; NO final dir", () => {
  const fs = fakeFs();
  assert.throws(() => cli.publishEvidenceAtomically(fs, "/ev/run", [{ name: "leak.json", content: '{"password":"hunter2"}' }]), /secret-like/);
  assert.ok(!fs.dirs.has("/ev/run"), "no final evidence dir on failure");
  assert.ok(![...fs.dirs].some((d) => d.includes(".tmp-")), "temp dir removed");
});

await acheck("cli.runExecute: failed verification publishes NO evidence", async () => {
  const fs = fakeFs();
  const deps = {
    fs,
    readManifest: async () => ({ projectId: PINS.projectId, governedCommit: PINS.governedCommit, entries: [] }),
    readLiveWarehouses: async () => [{ warehouseId: "a", data: { name: "N", location: "L" } }], // still legacy after "migration"
    runMigrationTxn: async () => ({ migrated: [], skippedGoverned: [], counts: { migrated: 0, skippedGoverned: 0 } }),
  };
  await assert.rejects(cli.runExecute(deps, { projectId: PINS.projectId, governedCommit: PINS.governedCommit, evidenceDir: "/ev/x", execute: true }), /verification failed/);
  assert.ok(!fs.dirs.has("/ev/x"), "no evidence dir when verification fails");
});

check("evidence: dry-run evidence is sanitized (no raw name/location leak) + secret scan", () => {
  const plan = planMigration([{ warehouseId: "b", data: { name: "SECRET-NAME", location: "SECRET-LOC", status: "PENDING" } }], PINS);
  const ev = buildDryRunEvidence(plan);
  const text = JSON.stringify(ev);
  assert.ok(!text.includes("SECRET-NAME") && !text.includes("SECRET-LOC"), "raw fields not in evidence");
  assert.equal(scanForSecrets(text).length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
