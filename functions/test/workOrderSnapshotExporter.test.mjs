// WORK ORDER SNAPSHOT EXPORTER -- the offline fence (DQ-S2, WORK ORDER DOMAIN CUTOVER AUTHORIZATION, 2026-09-30).
//
// The export of fieldops_wos + fieldops_technicians is a FIREBASE_EXIT_MIGRATION_ONLY exception and is held to it
// exactly as the CRM exporter is (crmCutover.test.mjs): marked, read-only, an exact two-collection allowlist, never
// overwrites a snapshot, and imported by NO runtime module, package entry point, workflow step or operator script.
// No database, no Firebase runtime, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve("..");
const EXPORTER = "scripts/exportWorkOrderSnapshot.js";
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const walk = (dir, exts) => readdirSync(dir).flatMap((f) => {
  if (f === "node_modules" || f === "dist" || f === "lib") return [];
  const full = join(dir, f);
  return statSync(full).isDirectory() ? walk(full, exts) : exts.some((e) => f.endsWith(e)) ? [full] : [];
});

test("the exporter carries the FIREBASE_EXIT_MIGRATION_ONLY marker as its first line", () => {
  const src = readFileSync(EXPORTER, "utf8");
  assert.equal(src.split("\n")[0], "// FIREBASE_EXIT_MIGRATION_ONLY");
  assert.match(stripComments(src), /const MIGRATION_ONLY_MARKER = "FIREBASE_EXIT_MIGRATION_ONLY";/);
});

test("the exporter reads exactly fieldops_wos and fieldops_technicians -- and performs only collection reads", () => {
  const { COLLECTIONS } = require("../scripts/exportWorkOrderSnapshot.js");
  assert.deepEqual([...COLLECTIONS], ["fieldops_wos", "fieldops_technicians"]);
  const code = stripComments(readFileSync(EXPORTER, "utf8"));
  assert.doesNotMatch(code, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete|listCollections|collectionGroup|onSnapshot)\s*\(/);
  assert.deepEqual([...code.matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]), ["collection"]);
  assert.equal([...code.matchAll(/\.collection\(/g)].length, 1, "one collection read, driven by the allowlist");
  assert.equal([...code.matchAll(/flag: "wx", mode: 0o600/g)].length, 2, "snapshot and checksum are both exclusive, 0600");
  assert.doesNotMatch(code, /setInterval|setTimeout|cron|schedule|onRequest|onCall|exports\.\w+\s*=\s*functions/);
});

test("STRUCTURAL: no runtime module, entry point, workflow step or operator script composes the exporter", () => {
  const offenders = [];
  for (const root of ["functions/src", "field-ops-app-vite/src", "integrations"]) {
    for (const file of walk(join(REPO_ROOT, root), [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])) {
      const text = readFileSync(file, "utf8");
      const importsIt = [...text.matchAll(/\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm)]
        .some((m) => /exportWorkOrderSnapshot/.test(m[1] ?? m[2] ?? m[3] ?? m[4]));
      if (importsIt) offenders.push(relative(REPO_ROOT, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offenders, []);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.doesNotMatch(JSON.stringify({ main: pkg.main, exports: pkg.exports ?? null, bin: pkg.bin ?? null, scripts: pkg.scripts }), /exportWorkOrderSnapshot/);
  for (const wf of readdirSync(join(REPO_ROOT, ".github", "workflows"))) {
    const text = readFileSync(join(REPO_ROOT, ".github", "workflows", wf), "utf8");
    const lines = text.split("\n").filter((l) => /exportWorkOrderSnapshot/.test(l));
    for (const line of lines) assert.match(line.trim(), /^- "functions\/scripts\/exportWorkOrderSnapshot\.js"$/, `${wf}: ${line}`);
    if (lines.length > 0) assert.doesNotMatch(text, /^\s*schedule:/m, `${wf} names the exporter and has a schedule`);
  }
  const scripts = walk(resolve("scripts"), [".js", ".mjs", ".cjs"]).filter((f) => !f.endsWith("exportWorkOrderSnapshot.js"));
  assert.deepEqual(scripts.filter((f) => /require\([^)]*exportWorkOrderSnapshot|from\s+["'][^"']*exportWorkOrderSnapshot/.test(readFileSync(f, "utf8"))), []);
});

test("the exporter encodes Timestamps, tags unsupported Firestore types, and refuses an ambiguous stored tag", () => {
  const { encodeValue } = require("../scripts/exportWorkOrderSnapshot.js");
  class FakeTimestamp { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } }
  class GeoPoint {}
  assert.deepEqual(encodeValue({ b: [1, "x", null], a: new FakeTimestamp(5, 7) }, FakeTimestamp, "d"), { a: { $timestamp: { seconds: 5, nanoseconds: 7 } }, b: [1, "x", null] });
  assert.deepEqual(encodeValue({ where: new GeoPoint() }, FakeTimestamp, "d"), { where: { $unsupported: "GeoPoint" } });
  assert.throws(() => encodeValue({ $timestamp: 1 }, FakeTimestamp, "d"), /ambiguous/);
});
