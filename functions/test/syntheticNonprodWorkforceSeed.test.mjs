// THE GOVERNED SYNTHETIC NONPROD SEED -- its fence, its manifest invariants, and the boundaries the Owner set on
// it. No database; the seeded-and-measured proof is functions/test/syntheticNonprodWorkforceSeedPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { EMPLOYMENT_STATUS_VALUES } from "../lib/employeeIdentity/employeeAuthority.js";
import { FIREBASE_IDENTITY_PROVIDER } from "../lib/adminPolicy/principalContext.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const SCRIPT_PATH = join(FUNCTIONS_DIR, "scripts/seedSyntheticNonprodWorkforce.js");
const require = createRequire(import.meta.url);
const { validateManifest, assertSeedArguments, MANIFEST, EMPLOYMENT_STATUS_VALUES: SCRIPT_STATUSES, SYNTHETIC_IDENTITY_PROVIDER } = require(SCRIPT_PATH);

const code = () => readFileSync(SCRIPT_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const clone = () => JSON.parse(JSON.stringify(MANIFEST));

const SENTINEL = "SYNTHETIC_SEED_LOADED_A_CLIENT";
const preloadPath = join(mkdtempSync(join(tmpdir(), "synthetic-seed-offline-")), "preload.cjs");
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
    encoding: "utf8",
    env: { ...process.env, EOS_ENVIRONMENT: "", X: "postgres://u:S3CR3T@127.0.0.1:1/db", ...env },
  });
const SEED_ARGS = ["--tenantKey", "taylor-nonprod", "--existingAdminPrincipalId", "p", "--performedBy", "op"];

// ════════════════════ (1) THE FENCE ════════════════════

test("(1) PRODUCTION is refused, by role and project id, even when the process claims nonprod", () => {
  const r = run(["--environment", "taylor-parts-production", "--databaseUrlEnv", "X", ...SEED_ARGS], { EOS_ENVIRONMENT: "nonprod" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /production/);
  assert.doesNotMatch(r.stderr, new RegExp(SENTINEL));
  assert.doesNotMatch(r.stdout + r.stderr, /S3CR3T/);
});

test("a missing nonprod runtime marker, environment, database variable or seed argument refuses before any client loads", () => {
  const cases = [
    [[], {}, /--environment is required/],
    [["--environment", "platform-sandbox", "--databaseUrlEnv", "X", ...SEED_ARGS], {}, /EOS_ENVIRONMENT must read exactly 'nonprod'/],
    [["--environment", "platform-sandbox", ...SEED_ARGS], { EOS_ENVIRONMENT: "nonprod" }, /--databaseUrlEnv <VAR> is required/],
    [["--environment", "platform-sandbox", "--databaseUrlEnv", "X", "--tenantKey", "taylor-nonprod"], { EOS_ENVIRONMENT: "nonprod" }, /--existingAdminPrincipalId is required/],
  ];
  for (const [args, env, message] of cases) {
    const r = run(args, env);
    assert.equal(r.status, 2, `${args.join(" ")} was not refused`);
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, new RegExp(SENTINEL), "the refusal came after a client library loaded");
    assert.equal(r.stdout, "");
  }
  assert.throws(() => assertSeedArguments({ tenantKey: "t", existingAdminPrincipalId: "p" }), /--performedBy is required/);
});

test("the fence is SHARED with the measurement tools, not reimplemented", () => {
  assert.match(code(), /require\("\.\/measureEmployeeReferenceIntegrity\.js"\)/);
  assert.match(code(), /require\("\.\/measureWorkforceActivation\.js"\)/);
  assert.doesNotMatch(code(), /taylor-parts/);
});

// ════════════════════ (3) (4) (5) THE MANIFEST ════════════════════

test("the shipped manifest satisfies every invariant, and is marked SYNTHETIC throughout", () => {
  assert.doesNotThrow(() => validateManifest(MANIFEST));
  assert.match(MANIFEST.classification, /SYNTHETIC NONPROD FIXTURE DATA/);
  assert.match(MANIFEST.classification, /not migrated Taylor production data/);
  for (const e of MANIFEST.employees) assert.match(e.id, /^synthetic-np-emp-/);
  for (const a of [...MANIFEST.accounts, ...MANIFEST.contacts, ...MANIFEST.locations]) assert.match(a.name, /^SYNTHETIC NONPROD /);
  for (const r of MANIFEST.commercial) assert.match(r.number, /^SYN-NP-/);
  assert.equal(
    MANIFEST.rulings.jobRole,
    "Job Role authority is NOT YET IMPLEMENTED in PostgreSQL. Synthetic Job Role values are seed-manifest metadata only and are not authoritative runtime data.",
  );
});

test("(3) the lifecycle vocabulary is exactly the governed six, and a seventh is refused", () => {
  assert.deepEqual([...SCRIPT_STATUSES], [...EMPLOYMENT_STATUS_VALUES]);
  for (const e of MANIFEST.employees) assert.ok(EMPLOYMENT_STATUS_VALUES.includes(e.employmentStatus));
  const m = clone();
  m.employees[1].employmentStatus = "FIRED";
  assert.throws(() => validateManifest(m), /not a governed lifecycle status/);
});

test("(4) Retail Sales and National Accounts Sales are distinct Job Roles, and a generic Sales Job Role is refused", () => {
  const keys = MANIFEST.jobRoles.map((r) => r.key);
  assert.ok(keys.includes("RETAIL_SALES") && keys.includes("NATIONAL_ACCOUNTS_SALES"));
  assert.ok(!MANIFEST.jobRoles.some((r) => /^sales$/i.test(r.key) || /^sales$/i.test(r.label)));
  assert.ok(MANIFEST.employees.some((e) => e.jobRole === "RETAIL_SALES"));
  assert.ok(MANIFEST.employees.some((e) => e.jobRole === "NATIONAL_ACCOUNTS_SALES"));
  const generic = clone();
  generic.jobRoles.push({ key: "SALES", label: "Sales" });
  assert.throws(() => validateManifest(generic), /generic Sales Job Role is forbidden/);
  const collapsed = clone();
  collapsed.jobRoles = collapsed.jobRoles.filter((r) => r.key !== "NATIONAL_ACCOUNTS_SALES");
  assert.throws(() => validateManifest(collapsed), /Job Role NATIONAL_ACCOUNTS_SALES must be declared separately|undeclared Job Role NATIONAL_ACCOUNTS_SALES/);
});

test("(5) Job Role != Security Role: separate vocabularies, explicit assignments, and no mapping in code", () => {
  const jobRoleKeys = new Set(MANIFEST.jobRoles.map((r) => r.key));
  const employee = new Map(MANIFEST.employees.map((e) => [e.key, e]));
  for (const p of MANIFEST.principals) {
    assert.ok(!("jobRole" in p), "a Principal carries a Job Role");
    for (const key of p.securityRoles) assert.ok(!jobRoleKeys.has(key), `${key} is both a Job Role and a Security Role`);
  }
  // Two different Job Roles legitimately share one Security Role.
  const sales = MANIFEST.principals.filter((p) => p.securityRoles.includes("salesperson")).map((p) => employee.get(p.employee).jobRole).sort();
  assert.deepEqual(sales, ["NATIONAL_ACCOUNTS_SALES", "RETAIL_SALES"]);
  // The seed never reads a Job Role to decide anything at runtime.
  // The one permitted mention is the ruling sentence echoed into the output; any other is a lookup.
  const runtime = code().slice(code().indexOf("async function seedSyntheticNonprodWorkforce")).replace("jobRoleAuthority: manifest.rulings.jobRole", "");
  assert.doesNotMatch(runtime, /jobRole/, "the seed consults Job Role while writing -- a Security Role could be inferred from it");
  const smuggled = clone();
  smuggled.principals[1].jobRole = "GENERAL_MANAGER";
  assert.throws(() => validateManifest(smuggled), /carries no Job Role/);
});

// ════════════════════ (12) (13) (14) COMMERCIAL ACCOUNTABILITY UNDER V1 ════════════════════

test("(12) only ACTIVE or CONTRACTOR people may own or be accountable, and the policy is exactly V1", () => {
  const ineligible = clone();
  ineligible.commercial[1].accountable = "technician-on-leave";
  assert.throws(() => validateManifest(ineligible), /not eligible under COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1/);
  const owner = clone();
  owner.commercial[0].owner = "technician-on-leave";
  assert.throws(() => validateManifest(owner), /not eligible/);
  const policy = clone();
  policy.eligibilityPolicy.eligibleStatuses = ["ACTIVE"];
  assert.throws(() => validateManifest(policy), /exactly COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1/);
});

test("(13) (14) the commercial seed must prove BOTH owner == accountable and owner != accountable", () => {
  const allSame = clone();
  for (const r of allSame.commercial) r.accountable = "DERIVE_FROM_OWNER";
  assert.throws(() => validateManifest(allSame), /both owner == accountable and owner != accountable/);
  const allDifferent = clone();
  for (const r of allDifferent.commercial) r.accountable = "general-manager";
  allDifferent.commercial.forEach((r) => { if (r.owner === "general-manager") r.accountable = "office-manager"; });
  assert.throws(() => validateManifest(allDifferent), /both owner == accountable and owner != accountable/);
});

// ════════════════════ GOVERNED/SEED, statically ════════════════════

test("GOVERNED/SEED: the ONLY accountable-person write takes its value from the governed establishment + mint", () => {
  const src = code();
  assert.doesNotMatch(src, /accountableEmployeeId/, "the seed names the accountability field literal instead of importing it");
  const writes = src.match(/accountable_employee_id\s*=\s*\$\d/g) ?? [];
  assert.equal(writes.length, 1, "more than one statement writes accountable_employee_id");
  assert.match(src, /accountable_employee_id = \$1, updated_by = \$2, updated_at = now\(\)\s*\n\s*WHERE tenant_id = \$3 AND id = \$4 AND accountable_employee_id IS NULL/);
  assert.match(src, /\[governedAccountable, options\.performedBy, tenantId, id\]/, "the persisted value is not the governed one");
  assert.match(src, /const governedAccountable = accountablePersonFields\(established\)\[ACCOUNTABLE_PERSON_FIELD\];/);
  assert.match(src, /const established = await establishCreationAccountablePerson\(/);
  // Establishment happens BEFORE the record is created, so a refusal writes nothing.
  assert.ok(src.indexOf("establishCreationAccountablePerson(") < src.indexOf("createCommercialRecord(client"));
});

test("GOVERNED/SEED is unavailable to the runtime: no source module or index export reaches the seed", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts") && /seedSyntheticNonprodWorkforce|eos-synthetic-nonprod/.test(readFileSync(full, "utf8"))) offenders.push(full);
    }
  };
  walk(join(FUNCTIONS_DIR, "src"));
  assert.deepEqual(offenders, [], "runtime source references the synthetic seed or its identity provider");
});

test("synthetic Principals cannot authenticate: the verifier's provider is firebase, and nothing recognizes eos-synthetic-nonprod", () => {
  assert.equal(SYNTHETIC_IDENTITY_PROVIDER, "eos-synthetic-nonprod");
  assert.equal(FIREBASE_IDENTITY_PROVIDER, "firebase");
  assert.notEqual(SYNTHETIC_IDENTITY_PROVIDER, FIREBASE_IDENTITY_PROVIDER);
  assert.equal(MANIFEST.principals.filter((p) => !p.existingAdministrator).length, 7);
  assert.match(MANIFEST.rulings.principals, /No authentication verifier recognizes this identity provider/);
});

// ════════════════════ (15) (16) NO FIREBASE, NO FK, NO SCHEMA ════════════════════

test("(15) no Firebase: nothing imported or named, and loading the module resolves no Firebase module", () => {
  for (const forbidden of ["firebase-admin", "firestore", "getAuth", "createUser", "fieldops_technicians"]) {
    assert.ok(!new RegExp(forbidden, "i").test(code()), `the seed reaches for ${forbidden}`);
  }
  const probe = spawnSync(process.execPath, ["--require", preloadPath, "-e", `require(${JSON.stringify(SCRIPT_PATH)})`], { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
});

test("(16) no deferred foreign key, no schema change, and no direct Principal, membership or Role-assignment SQL", () => {
  const src = code();
  for (const forbidden of [/deferred/i, /ALTER\s/i, /CREATE\s/i, /DROP\s/i, /FOREIGN KEY/i, /node-pg-migrate/i, /DELETE\s/i, /TRUNCATE/i]) {
    assert.doesNotMatch(src, forbidden);
  }
  const inserts = (src.match(/INSERT INTO [a-z_.]+/g) ?? []).sort();
  assert.deepEqual(inserts, ["INSERT INTO eos_workforce.employees"], "only Employees, which have no governed writer, are inserted directly");
  const updates = (src.match(/UPDATE [a-z_.$`{}]+/g) ?? []);
  assert.equal(updates.length, 1, "the only direct UPDATE is the GOVERNED/SEED accountable person");
});
