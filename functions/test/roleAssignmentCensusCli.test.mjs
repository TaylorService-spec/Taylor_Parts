// SECURITY ROLE ASSIGNMENT CENSUS CLI -- the offline structural proofs. No Firebase runtime, no database, no network.
//
//   * the CLI is the Owner's FIREBASE_EXIT_MIGRATION_ONLY exception and is held to it: marked, exact collection
//     allowlist, only collection reads, exclusive 0600 evidence + checksum, imported by NO runtime module;
//   * the fence is pure logic over argv / registry / env (the subprocess proofs live in
//     operatorScriptEnvironmentFence.test.mjs);
//   * the Firestore reader forwards only the fields the census consults.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CLI = "scripts/roleAssignmentCensusCli.js";
const cli = require("../scripts/roleAssignmentCensusCli.js");
const REPO_ROOT = resolve("..");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const walk = (dir, exts) => readdirSync(dir).flatMap((f) => {
  if (f === "node_modules" || f === "dist" || f === "lib") return [];
  const full = join(dir, f);
  return statSync(full).isDirectory() ? walk(full, exts) : exts.some((e) => f.endsWith(e)) ? [full] : [];
});

test("the CLI carries the FIREBASE_EXIT_MIGRATION_ONLY marker as its first line", () => {
  const src = readFileSync(CLI, "utf8");
  assert.equal(src.split("\n")[0], "// FIREBASE_EXIT_MIGRATION_ONLY");
  assert.equal(cli.MIGRATION_ONLY_MARKER, "FIREBASE_EXIT_MIGRATION_ONLY");
});

test("the CLI reads exactly roleAssignments, users, privilegedRoleRequests -- and performs only collection reads", () => {
  assert.deepEqual([...cli.LEGACY_COLLECTIONS], ["privilegedRoleRequests", "roleAssignments", "users"]);
  const code = stripComments(readFileSync(CLI, "utf8"));
  // The one `.update(` in the file is the sha256 digest of the evidence text, not a Firestore write.
  assert.equal([...code.matchAll(/createHash\("sha256"\)\.update\(text\)/g)].length, 1);
  assert.doesNotMatch(code.replace(/createHash\("sha256"\)\.update\(text\)/g, ""), /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete|listCollections|collectionGroup|onSnapshot|doc)\s*\(/);
  assert.doesNotMatch(code, /\b(writeBatch|runTransaction|bulkWriter)\b/);
  assert.deepEqual([...code.matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]), ["collection"]);
  assert.equal([...code.matchAll(/\.collection\(/g)].length, 1, "one collection read, driven by the allowlist");
  assert.equal([...code.matchAll(/flag: "wx", mode: 0o600/g)].length, 2, "evidence and checksum are both exclusive, 0600");
  assert.match(code, /default_transaction_read_only=on/, "PostgreSQL is opened read only at the database");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|COPY)\b/, "no SQL write verb");
  assert.doesNotMatch(code, /setInterval|setTimeout|cron|schedule|onRequest|onCall/);
});

test("the CLI loads firebase-admin, pg and lib/ only inside functions, after the fence", () => {
  const code = stripComments(readFileSync(CLI, "utf8"));
  const topLevelRequires = code.split("\n").filter((l) => /^const .*require\(/.test(l)).join("\n");
  assert.doesNotMatch(topLevelRequires, /firebase|["']pg["']|\.\.\/lib\//);
  assert.ok(code.indexOf("assertCensusInvocation(parseArgs") < code.indexOf('require("firebase-admin/app")'));
});

test("STRUCTURAL: no runtime module imports the CLI, no npm script or workflow step runs it", () => {
  const offenders = [];
  for (const root of ["functions/src", "field-ops-app-vite/src", "integrations"]) {
    for (const file of walk(join(REPO_ROOT, root), [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])) {
      const text = readFileSync(file, "utf8");
      const importsIt = [...text.matchAll(/\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm)]
        .some((m) => /roleAssignmentCensusCli/.test(m[1] ?? m[2] ?? m[3] ?? m[4]));
      if (importsIt) offenders.push(relative(REPO_ROOT, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offenders, []);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.doesNotMatch(JSON.stringify({ main: pkg.main, exports: pkg.exports ?? null, bin: pkg.bin ?? null, scripts: pkg.scripts }), /roleAssignmentCensusCli\.js/);
  for (const wf of readdirSync(join(REPO_ROOT, ".github", "workflows"))) {
    const text = readFileSync(join(REPO_ROOT, ".github", "workflows", wf), "utf8");
    const lines = text.split("\n").filter((l) => /roleAssignmentCensusCli\.js/.test(l));
    for (const line of lines) assert.match(line.trim(), /^- "functions\/scripts\/roleAssignmentCensusCli\.js"$/, `${wf} may name the CLI only as a path filter: ${line}`);
  }
});

// ════════════════════ the fence, as pure logic ════════════════════

const ENV = { EOS_ENVIRONMENT: "nonprod", CENSUS_DB: "postgres://fence:fence@127.0.0.1:1/never" };
const ARGS = { environment: "platform-sandbox", databaseUrlEnv: "CENSUS_DB", tenantKey: "taylor-nonprod", out: "/nonexistent-dir/census.json" };

test("a complete nonprod invocation resolves the Firebase project from the registry, never from argv or env", () => {
  const options = cli.assertCensusInvocation(ARGS, { ...ENV, GOOGLE_CLOUD_PROJECT: "taylor-parts", GCLOUD_PROJECT: "taylor-parts" });
  assert.equal(options.projectId, "eos-platform-sandbox");
  assert.equal(options.environmentId, "platform-sandbox");
  assert.equal(options.tenantKey, "taylor-nonprod");
});

for (const [label, args, env, pattern] of [
  ["a --projectId", { ...ARGS, projectId: "eos-platform-sandbox" }, ENV, /--projectId is not accepted/],
  ["production", { ...ARGS, environment: "taylor-parts-production" }, ENV, /production/],
  ["certification", { ...ARGS, environment: "platform-certification" }, ENV, /frozen/],
  ["no Firebase project", { ...ARGS, environment: "local-emulator" }, ENV, /declares no Firebase project/],
  ["EOS_ENVIRONMENT not nonprod", ARGS, { ...ENV, EOS_ENVIRONMENT: "production" }, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
  ["an emulator host", ARGS, { ...ENV, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8182" }, /FIRESTORE_EMULATOR_HOST/],
  ["no tenant", { ...ARGS, tenantKey: undefined }, ENV, /--tenantKey is required/],
  ["no out", { ...ARGS, out: undefined }, ENV, /--out <file> is required/],
  ["an existing out", { ...ARGS, out: CLI }, ENV, /never overwritten/],
]) {
  test(`the fence refuses ${label}`, () => {
    assert.throws(() => cli.assertCensusInvocation(args, env), pattern);
  });
}

// ════════════════════ the Firestore reader ════════════════════

test("the Firestore reader forwards only the fields the census consults, via collection().get() alone", async () => {
  const calls = [];
  const docs = {
    roleAssignments: [{ id: "a", data: () => ({ principalUid: "u", roleId: "admin", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1, grantedBy: "x", note: "n" }) }],
    users: [{ id: "u", data: () => ({ role: "admin", accessVersion: 2, email: "someone@example.invalid", displayName: "Someone" }) }],
    privilegedRoleRequests: [{ id: "r", data: () => ({ status: "PENDING_APPROVAL", principalUid: "u", reason: "r" }) }],
  };
  const db = new Proxy({}, {
    get(_t, prop) {
      if (prop !== "collection") throw new Error(`unexpected Firestore call ${String(prop)}`);
      return (name) => ({ get: async () => { calls.push(name); return { docs: docs[name] }; } });
    },
  });
  const reader = cli.createFirestoreLegacyReader(db);
  assert.deepEqual(await reader.listUserProfileDocuments(), [{ id: "u", data: { role: "admin", accessVersion: 2 } }]);
  assert.deepEqual(await reader.listPrivilegedRoleRequestDocuments(), [{ id: "r", data: { status: "PENDING_APPROVAL" } }]);
  assert.deepEqual((await reader.listRoleAssignmentDocuments())[0].data, { principalUid: "u", roleId: "admin", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 });
  assert.deepEqual(calls.sort(), ["privilegedRoleRequests", "roleAssignments", "users"]);
});
