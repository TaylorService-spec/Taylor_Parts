// THE GOVERNED WORK ORDER COPY OPERATOR -- the fence, proved separately from the migration.
//
// This suite does NOT re-prove the migration: plan, transaction, collision handling and verification are
// the executor's, and workOrderMigrationCopyPostgres.test.mjs owns them. What is proved here is that the
// operator seam cannot be talked past -- because the one thing standing between "COPY ran against
// nonprod" and "COPY ran against something else" is this file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cli = require("../scripts/workOrderMigrationCopyCli.js");

const SHA = "3800975c2838f6c1610790c2eea153e7719b6d390c61b2f74319093650531b59";
const ENV = { EOS_ENVIRONMENT: "nonprod", DATABASE_URL: "postgres://fenced" };
const OK = Object.freeze({
  environment: "platform-sandbox", databaseUrlEnv: "DATABASE_URL", tenantKey: "taylor-nonprod",
  performedBy: "operator", "snapshot-sha": SHA, manifest: "docs/assessments/x.json",
});
const invoke = (over = {}, env = ENV) => cli.assertCopyInvocation({ ...OK, ...over }, env);

test("DRY RUN is the default; mutation requires an explicit --apply", () => {
  assert.equal(invoke().apply, false, "absence of --apply must never mutate");
  assert.equal(invoke({ apply: "true" }).apply, true);
  // Anything that is not exactly "true" is not an apply.
  for (const value of ["1", "yes", "TRUE", ""]) assert.equal(invoke({ apply: value }).apply, false, value);
});

test("every operator fact is required, and none is inferred", () => {
  for (const [field, pattern] of [
    ["environment", /--environment is required/],
    ["databaseUrlEnv", /--databaseUrlEnv/],
    ["tenantKey", /--tenantKey is required/],
    ["performedBy", /--performedBy/],
    ["snapshot-sha", /--snapshot-sha/],
    ["manifest", /--manifest/],
  ]) {
    const args = { ...OK };
    delete args[field];
    assert.throws(() => cli.assertCopyInvocation(args, ENV), pattern, `${field} must be required`);
  }
});

test("a malformed snapshot sha is refused -- it is a measurement, not a label", () => {
  for (const bad of ["not-a-sha", SHA.slice(0, 63), `${SHA}0`, SHA.toUpperCase()]) {
    assert.throws(() => invoke({ "snapshot-sha": bad }), /--snapshot-sha/);
  }
});

test("there is NO force, NO drift override and NO accept-latest", () => {
  for (const forbidden of ["force", "no-drift-check", "acceptLatest", "accept-latest"]) {
    assert.throws(() => invoke({ [forbidden]: "true" }),
      /is not accepted: a drifted source invalidates/,
      `--${forbidden} must be refused loudly rather than ignored`);
  }
  // And no escape hatch exists in the source either.
  const src = readFileSync(resolve(FUNCTIONS_DIR, "scripts/workOrderMigrationCopyCli.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  assert.equal(/skipDrift|ignoreDrift|FORCE|--force/.test(src), false);
});

test("PRODUCTION is refused by role AND by project id, and an unknown environment fails closed", () => {
  const registry = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "..", "config/environments.json"), "utf8"));
  const production = (registry.environments ?? []).find((e) => e.role === "production");
  assert.ok(production, "precondition: the registry declares a production environment");
  assert.throws(() => invoke({ environment: production.id }), /refuses production|production/i);
  assert.throws(() => invoke({ environment: "not-a-real-environment" }), /byte-identical to an environment id/);
  // Refused by NAME too, so a mislabelled registry entry cannot become a production target.
  assert.throws(() => cli.assertSourceProject(production.id), /taylor-parts|Refused/);
});

test("the frozen Certification world is refused", () => {
  assert.throws(() => invoke({ environment: "platform-certification" }), /Certification world, which is frozen/);
});

test("a non-nonprod runtime is refused before any database or Firebase handle is built", () => {
  assert.throws(() => invoke({}, { ...ENV, EOS_ENVIRONMENT: "local" }), /nonprod/i);
  assert.throws(() => invoke({}, { ...ENV, EOS_ENVIRONMENT: undefined }), /nonprod/i);
});

test("the SOURCE Firebase project comes from the registry and is the sandbox", () => {
  assert.equal(cli.assertSourceProject("platform-sandbox"), "eos-platform-sandbox");
  assert.equal(cli.SOURCE_COLLECTION, "fieldops_wos");
});

test("the CLI implements NO migration logic -- it delegates to the tested executor", () => {
  const src = readFileSync(resolve(FUNCTIONS_DIR, "scripts/workOrderMigrationCopyCli.js"), "utf8");
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  // It must CALL each executor entry point...
  for (const fn of ["assertNoSourceDrift", "assertTargetSchemaReady", "buildCopyPlan",
                    "recheckTargetCollisions", "copyOnce", "verifyCopy",
                    "runDryRun", "validateResolutionManifest", "buildSourceSnapshot",
                    "resolveOperatingCompanyKey"]) {
    assert.match(stripped, new RegExp(`\\b${fn}\\s*\\(`), `the CLI must delegate to ${fn}`);
  }
  // ...and define none of them, nor any SQL that writes.
  for (const fn of ["function buildCopyPlan", "function copyOnce", "function verifyCopy",
                    "function runDryRun", "function recheckTargetCollisions"]) {
    assert.equal(stripped.includes(fn), false, `the CLI must not define ${fn}`);
  }
  for (const sql of ["INSERT INTO", "UPDATE ", "DELETE FROM", "CREATE ", "ALTER ", "TRUNCATE"]) {
    assert.equal(stripped.includes(sql), false, `the CLI must not contain ${sql}`);
  }
  // Its only SQL is a SELECT.
  for (const statement of [...stripped.matchAll(/query\(\s*"([^"]+)"/g)].map((m) => m[1].trim())) {
    assert.match(statement, /^SELECT /, `the CLI ran a non-SELECT statement: ${statement}`);
  }
});

test("the CLI offers NO Firestore mutation path", () => {
  const src = readFileSync(resolve(FUNCTIONS_DIR, "scripts/workOrderMigrationCopyCli.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const FIRESTORE_WRITES = [
    /\.doc\([^)]*\)\s*\.\s*(set|update|delete)\s*\(/,
    /\.collection\([^)]*\)\s*\.\s*(add|set)\s*\(/,
    /\b(batch|writeBatch|bulkWriter)\s*\(/, /runTransaction\s*\(/, /FieldValue\./,
  ];
  for (const pattern of FIRESTORE_WRITES) assert.equal(pattern.test(src), false, `Firestore write (${pattern})`);
  // NON-VACUITY.
  assert.equal(FIRESTORE_WRITES.some((p) => p.test('db.collection("x").doc("y").set({})')), true);
});

test("APPLY refuses on a preflight that is not exactly clean", () => {
  // The operator-facing half of the gate copyOnce also enforces inside its transaction.
  const src = readFileSync(resolve(FUNCTIONS_DIR, "scripts/workOrderMigrationCopyCli.js"), "utf8");
  assert.match(src, /WORK_ORDER_COPY_PREFLIGHT_DRIFT/);
  assert.match(src, /preflight\.blocked !== 0 \|\| preflight\.targetConflict !== 0/);
  // VERIFY is the executor's, invoked after apply, and a mismatch is a non-zero exit rather than a repair.
  assert.match(src, /verifyCopy\(/);
  assert.match(src, /if \(!verification\.ok\) process\.exitCode = 1;/);
  assert.equal(/repair|fixUp|reconcileRow/i.test(src), false, "the operator must not repair anything");
});

test("the drift fence runs BEFORE the plan is built or the target is touched", () => {
  const src = readFileSync(resolve(FUNCTIONS_DIR, "scripts/workOrderMigrationCopyCli.js"), "utf8");
  const drift = src.indexOf("assertNoSourceDrift");
  const plan = src.indexOf("buildCopyPlan(");
  const copyCall = src.indexOf("copy.copyOnce(");
  assert.ok(drift > 0 && plan > drift, "drift is checked before the plan is built");
  assert.ok(copyCall > drift, "and long before anything is written");
});
