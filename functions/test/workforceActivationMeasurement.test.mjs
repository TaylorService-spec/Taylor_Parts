// THE WORKFORCE ACTIVATION MEASUREMENT — its fence, its read-only discipline, and its refusal to print an
// unknown as a zero. No database: the `pg` client is a double. The live-server proof of every count and
// of the output schema is functions/test/workforceActivationPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { EMPLOYMENT_STATUS_VALUES } from "../lib/employeeIdentity/employeeAuthority.js";
import { ACCOUNTABILITY_FAMILIES } from "../lib/responsibility/accountabilityFamilyScope.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const SCRIPT_PATH = join(FUNCTIONS_DIR, "scripts/measureWorkforceActivation.js");
const require = createRequire(import.meta.url);
const { assertNonprodRuntime, measureWorkforceActivation, COMMERCIAL_TABLES, EMPLOYMENT_STATUS_VALUES: SCRIPT_STATUSES } =
  require(SCRIPT_PATH);

/** Source with comments removed: the header NAMES what the code refuses to do. */
const code = () =>
  readFileSync(SCRIPT_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// A preload that fails loudly if the process ever resolves a database driver or any Firebase module.
const SENTINEL = "WORKFORCE_MEASUREMENT_LOADED_A_CLIENT";
const preloadPath = join(mkdtempSync(join(tmpdir(), "wf-measure-")), "preload.cjs");
writeFileSync(
  preloadPath,
  `const Module = require("module"); const load = Module._load;
   Module._load = function (request, ...rest) {
     if (request === "pg" || /firebase/i.test(request)) { process.stderr.write("${SENTINEL}:" + request + "\\n"); process.exit(97); }
     return load.call(this, request, ...rest);
   };`,
);

const run = (args, env = {}) =>
  spawnSync(process.execPath, ["--require", preloadPath, SCRIPT_PATH, ...args], {
    cwd: FUNCTIONS_DIR,
    env: { ...process.env, EOS_ENVIRONMENT: "", ...env },
    encoding: "utf8",
  });

// ════════════════════ 2. NONPROD FENCING ════════════════════

test("no explicit environment = refuse, before any client library is loaded", () => {
  const r = run([]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--environment is required/);
  assert.doesNotMatch(r.stderr, new RegExp(SENTINEL));
  assert.equal(r.stdout, "");
});

test("PRODUCTION is refused by the shared fence, even when the process claims nonprod", () => {
  const r = run(["--environment", "taylor-parts-production", "--databaseUrlEnv", "X"], {
    X: "postgres://u:p@127.0.0.1:1/db",
    EOS_ENVIRONMENT: "nonprod",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /production/);
  assert.doesNotMatch(r.stderr, new RegExp(SENTINEL));
});

test("a non-production registry id is NOT enough: the process must positively declare EOS_ENVIRONMENT=nonprod", () => {
  for (const label of [undefined, "", "local", "production", "NONPROD", " nonprod"]) {
    const env = { X: "postgres://u:p@127.0.0.1:1/db" };
    if (label !== undefined) env.EOS_ENVIRONMENT = label;
    const r = run(["--environment", "platform-sandbox", "--databaseUrlEnv", "X"], env);
    assert.equal(r.status, 2, `label ${JSON.stringify(label)} was not refused`);
    assert.match(r.stderr, /EOS_ENVIRONMENT must read exactly 'nonprod'/);
    assert.doesNotMatch(r.stderr, new RegExp(SENTINEL), "the refusal came after a client library was loaded");
    assert.equal(r.stdout, "");
  }
  assert.doesNotThrow(() => assertNonprodRuntime({ EOS_ENVIRONMENT: "nonprod" }));
});

test("no explicit database variable = refuse; the connection string is never echoed", () => {
  const missing = run(["--environment", "platform-sandbox"], { EOS_ENVIRONMENT: "nonprod" });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--databaseUrlEnv <VAR> is required/);

  const secret = "postgres://measure-user:S3CR3T-PASSWORD@127.0.0.1:1/db";
  const refused = run(["--environment", "taylor-parts-production", "--databaseUrlEnv", "X"], { X: secret });
  assert.doesNotMatch(`${refused.stdout}${refused.stderr}`, /S3CR3T-PASSWORD/);
});

test("the fence is SHARED with the existing measurements, not reimplemented", () => {
  assert.match(code(), /require\("\.\/measureEmployeeReferenceIntegrity\.js"\)/);
  assert.doesNotMatch(code(), /taylor-parts/, "a second literal copy of the production project id");
  assert.match(code(), /resolvePolicyDatabaseConfig/, "the application's own connection path must be used");
});

// ════════════════════ 1 + 4. READ ONLY, NO MUTATION ════════════════════

test("READ ONLY by construction — no write verb, and a READ ONLY transaction", () => {
  const src = code();
  for (const verb of ["INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "TRUNCATE", "MERGE", "CREATE", "GRANT", "COPY ", "nextval", "setval"]) {
    assert.ok(!new RegExp(verb, "i").test(src.replace(/SET TRANSACTION READ ONLY/g, "")), `code contains "${verb}"`);
  }
  assert.match(src, /SET TRANSACTION READ ONLY/);
  // No populate/repair/link/assign mechanism of any kind exists to be called.
  for (const verb of ["backfill", "repair", "establish", "mint", "grant(", "assignRole", "createLink"]) {
    assert.ok(!src.toLowerCase().includes(verb.toLowerCase()), `code names a mutation mechanism: ${verb}`);
  }
});

test("every statement the measurement issues is a read", async () => {
  const issued = [];
  const client = {
    async query(sql) {
      issued.push(sql);
      return { rows: [] }; // every relation reads as absent
    },
  };
  await measureWorkforceActivation(client);
  assert.ok(issued.length > 0);
  for (const sql of issued) assert.match(sql.trim(), /^(SELECT|WITH)\b/i, `not a read: ${sql.slice(0, 80)}`);
});

// ════════════════════ 3. NO FIREBASE DEPENDENCY ════════════════════

test("no Firebase: nothing imported, nothing named but the governed link-source literal", () => {
  // RECIPROCAL_FIREBASE_UID_LINK is a stored link_source VALUE being counted, not a Firebase dependency.
  const src = code().replace(/RECIPROCAL_FIREBASE_UID_LINK/g, "");
  for (const forbidden of ["firebase", "firestore", "getAuth", "fieldops_technicians", '"users"']) {
    assert.ok(!new RegExp(forbidden, "i").test(src), `the measurement reaches for ${forbidden}`);
  }
  const probe = spawnSync(process.execPath, ["--require", preloadPath, "-e", `require(${JSON.stringify(SCRIPT_PATH)})`], {
    cwd: FUNCTIONS_DIR,
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, `loading the module pulled in a client or Firebase: ${probe.stderr}`);
});

// ════════════════════ 5. OUTPUT SCHEMA, AND UNKNOWN IS NEVER ZERO ════════════════════

test("an absent relation is NOT MEASURED with a reason, never a zero", async () => {
  const report = await measureWorkforceActivation({ async query() { return { rows: [] }; } });
  assert.deepEqual(Object.keys(report), ["tool", "readOnly", "mutations", "sections", "unmeasured", "measuredElsewhere"]);
  assert.equal(report.readOnly, true);
  assert.equal(report.mutations, 0);
  assert.deepEqual(Object.keys(report.sections), [
    "employeePopulation",
    "employeePrincipalLinkage",
    "ownerVersusAccountable",
    "securityRoleOccupancy",
  ]);
  assert.deepEqual(report.unmeasured, ["C", "D", "G", "H"]);
  for (const section of Object.values(report.sections)) {
    assert.deepEqual(Object.keys(section), ["id", "measured", "error"]);
    assert.equal(section.measured, false);
    assert.match(section.error, /FAILURE TO MEASURE, not a finding of zero/);
  }
  assert.deepEqual(report.measuredElsewhere, {
    E: "scripts/measureEmployeeReferenceIntegrity.js",
    F: "scripts/measureCommercialAccountability.js",
  });
});

test("a read that THROWS is reported per section and never swallowed into a count", async () => {
  const report = await measureWorkforceActivation({
    async query() {
      throw new Error("permission denied for schema eos_workforce");
    },
  });
  assert.deepEqual(report.unmeasured, ["C", "D", "G", "H"]);
  for (const section of Object.values(report.sections)) assert.match(section.error, /read failed: permission denied/);
});

test("mirrored vocabularies match the governed sources exactly", () => {
  assert.deepEqual([...SCRIPT_STATUSES], [...EMPLOYMENT_STATUS_VALUES]);
  assert.deepEqual(COMMERCIAL_TABLES.map((t) => t.family), [...ACCOUNTABILITY_FAMILIES]);
});
