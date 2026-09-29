// DQ-025: the migration-only inventory snapshot exporter -- marker, exact allowlist (== the evidence artifact),
// read-only code, exclusive checksummed output, no runtime reachability, and the governed format round-trips
// through all three census tools. Offline; firebase-admin is never initialised.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const EXPORTER = "scripts/exportInventorySnapshot.js";
const ex = require("../scripts/exportInventorySnapshot.js");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("marked as the migration-only exception; allowlist is EXACTLY the enumerated evidence", () => {
  assert.equal(ex.FIREBASE_EXIT_MIGRATION_ONLY, "FIREBASE_EXIT_MIGRATION_ONLY");
  assert.match(readFileSync(EXPORTER, "utf8").split("\n")[0], /^\/\/ FIREBASE_EXIT_MIGRATION_ONLY$/);
  assert.deepEqual(Object.values(ex.SOURCE_COLLECTIONS), ["cycle_counts", "inventory_transactions", "transfer_orders"]);
  const evidence = JSON.parse(readFileSync("../docs/architecture/inventory-snapshot-export-evidence.json", "utf8"));
  assert.deepEqual(evidence.collections.map((c) => [c.snapshotKey, c.collection]), Object.entries(ex.SOURCE_COLLECTIONS));
  assert.equal(evidence.executionStatus, "NOT_EXECUTED");
  for (const other of ["serialized_assets", "warehouses", "parts", "users", "cycle_counts/x/lines", ""]) assert.throws(() => ex.assertAllowlisted(other), /not an allowlisted/);
});

test("READ ONLY: collection reads only, every read through the allowlist, never overwritten", () => {
  const code = stripComments(readFileSync(EXPORTER, "utf8"));
  assert.doesNotMatch(code, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete|listCollections|collectionGroup)\s*\(/);
  assert.deepEqual([...code.matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]), ["collection"]);
  assert.deepEqual([...code.matchAll(/\bdb\.collection\((.*?)\)\.get\(/g)].map((m) => m[1]), ["assertAllowlisted(name)"]);
  assert.match(code, /flag: "wx"/);
  // The fence runs before firebase-admin is required.
  const mainBody = code.split("async function main")[1];
  assert.ok(mainBody.indexOf("assertExportInvocation") < mainBody.indexOf('require("firebase-admin'));
  assert.deepEqual(code.split("async function main")[0].match(/require\(\s*["'][^"']+["']\s*\)/g),
    ['require("node:fs")', 'require("node:path")', 'require("node:crypto")', 'require("./projectTargetGuard.js")']);
});

test("STRUCTURAL: no runtime code reaches it; workflows may name it only as a path filter, never scheduled", () => {
  const root = resolve("..");
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    if (f === "node_modules" || f === ".git" || f === "lib" || f === "dist") return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(f) ? [p] : [];
  });
  const offenders = ["functions/src", "field-ops-app-vite/src", "integrations"].flatMap((d) => walk(join(root, d)))
    .filter((f) => /exportInventorySnapshot/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.doesNotMatch(JSON.stringify({ main: pkg.main, exports: pkg.exports ?? null, bin: pkg.bin ?? null, scripts: pkg.scripts }), /exportInventorySnapshot/);
  for (const wf of readdirSync(join(root, ".github", "workflows"))) {
    const text = readFileSync(join(root, ".github", "workflows", wf), "utf8");
    const lines = text.split("\n").filter((l) => /exportInventorySnapshot/.test(l));
    for (const line of lines) assert.match(line.trim(), /^- "functions\/scripts\/exportInventorySnapshot\.js"$/, `${wf}: ${line}`);
    if (lines.length > 0) assert.doesNotMatch(text, /^\s*schedule:/m);
  }
});

test("exclusive checksummed output, and the governed format round-trips through all three census tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "l3-inv-export-"));
  class FakeTimestamp { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } }
  const snap = {
    format: ex.SNAPSHOT_FORMAT, version: 1, source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-28T00:00:00.000Z" },
    cycleCounts: [{ id: "cc1", data: ex.encodeValue({ schemaVersion: 1, partId: "P", createdAt: new FakeTimestamp(1, 0) }, FakeTimestamp, "cc1") }],
    inventoryTransactions: [{ id: "t1", data: { type: "RESERVED", partId: "P", quantity: 1 } }],
    transferOrders: [],
  };
  const out = join(dir, "inv.json");
  const sha = ex.writeSnapshotFiles(out, JSON.stringify(snap, null, 2) + "\n");
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.throws(() => ex.writeSnapshotFiles(out, "{}\n"), /EEXIST/);
  assert.throws(() => ex.assertExportInvocation({ projectId: "eos-platform-sandbox", out }), /never overwritten/);
  const run = (script) => spawnSync(process.execPath, [script, "--snapshot", out], { encoding: "utf8" });
  assert.equal(run("scripts/cycleCountActivationCensus.js").status, 0);
  assert.equal(run("scripts/inventoryLedgerCensus.js").status, 0);
  assert.equal(run("scripts/transferCopyCensus.js").status, 0);
  // A governed snapshot WITHOUT its checksum is refused, and a tampered one too.
  const bare = join(dir, "bare.json");
  writeFileSync(bare, JSON.stringify(snap));
  assert.equal(spawnSync(process.execPath, ["scripts/inventoryLedgerCensus.js", "--snapshot", bare], { encoding: "utf8" }).status, 2);
  writeFileSync(`${bare}.sha256`, `${sha}  bare.json\n`);
  assert.equal(spawnSync(process.execPath, ["scripts/cycleCountActivationCensus.js", "--snapshot", bare], { encoding: "utf8" }).status, 2);
});
