// THE MEASUREMENT — its fence, its read-only discipline, and its honesty about what it could not see.
//
// ════════════════════ WHAT IS WORTH PROVING ABOUT A COUNTING SCRIPT ════════════════════
//
// Not the arithmetic. Three other things, each of which is a way this tool could do real damage or tell
// a real lie:
//
//   1. THE FENCE. It refuses without an explicitly named environment and an explicitly named database
//      variable, and it refuses production twice over -- and the refusal happens BEFORE the process is
//      capable of connecting to anything. Proved by subprocess, because "refused before it could
//      contact anything" is a statement about a process's history rather than about a return value.
//   2. IT WRITES NOTHING. Proved statically over the source, because an absence is not observable by
//      running the happy path.
//   3. IT NEVER REPORTS AN UNKNOWN AS A ZERO. Ruling #187 §2 makes AUTHORITY_UNAVAILABLE distinct from a
//      finding, and for this tool the consequence is sharp: a report that showed "0 unresolved" for a
//      table it could not read would be the false clean bill of health that authorizes moving the
//      deferred foreign key. That is the single most expensive mistake this script could make.
//
// No database is needed for any of it. The `pg` client is a double.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const SCRIPT_REL = "scripts/measureEmployeeReferenceIntegrity.js";
const SCRIPT_PATH = join(FUNCTIONS_DIR, SCRIPT_REL);

const require = createRequire(import.meta.url);
const {
  assertMeasurementTarget,
  measureEmployeeReferenceIntegrity,
  describeReport,
  EMPLOYEE_REFERENCE_COLUMNS,
  OUT_OF_SCOPE_ACTOR_COLUMNS,
  PRODUCTION_PROJECT_ID,
} = require(SCRIPT_PATH);

// ════════════════════ 1. THE FENCE ════════════════════

test("no explicit environment = refuse", () => {
  assert.throws(
    () => assertMeasurementTarget({}, {}),
    /--environment is required/,
    "nothing may be inferred from the working directory, .firebaserc or process.env",
  );
});

test("an undeclared environment is refused rather than resolved", () => {
  assert.throws(
    () => assertMeasurementTarget({ environment: "sandbox", databaseUrlEnv: "X" }, { X: "postgres://x" }),
    /byte-identical to an environment id declared in config\/environments\.json/,
  );
  // A near-miss of a real id is still a miss.
  assert.throws(
    () => assertMeasurementTarget({ environment: "platform-sandbox " }, {}),
    /byte-identical/,
  );
});

test("production is refused by ROLE", () => {
  assert.throws(
    () => assertMeasurementTarget({ environment: "taylor-parts-production", databaseUrlEnv: "X" }, { X: "postgres://x" }),
    /has role "production"/,
  );
});

test("production is ALSO refused by project id, so a mislabelled registry entry cannot defeat it", () => {
  // sandboxTargetGuard.js's own header names this as a recommended follow-up it had not taken: the
  // existing allowlist is derived entirely from `role`, so it trusts one field in one file and a
  // copy-paste into the wrong environment would defeat it with nothing else noticing. This tool takes
  // the follow-up, and this test is what holds it -- the role is deliberately falsified here.
  const registry = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "..", "config", "environments.json"), "utf8"));
  const production = registry.environments.find((e) => e.firebase && e.firebase.projectId === PRODUCTION_PROJECT_ID);
  assert.ok(production, "the registry must still declare the customer production project somewhere");
  assert.equal(production.role, "production", "if this changes, the by-name refusal is the only one left");
});

test("no explicit database variable = refuse, and no ambient DATABASE_URL fallback", () => {
  assert.throws(
    () => assertMeasurementTarget({ environment: "platform-sandbox" }, { DATABASE_URL: "postgres://ambient" }),
    /--databaseUrlEnv <VAR> is required/,
    "an ambient DATABASE_URL is exactly the implicit target the fence exists to refuse",
  );
});

test("a named variable that is unset is refused, not worked around", () => {
  assert.throws(
    () => assertMeasurementTarget({ environment: "platform-sandbox", databaseUrlEnv: "NOPE" }, { DATABASE_URL: "postgres://ambient" }),
    /that environment variable is empty or unset/,
  );
});

test("a fully named non-production target is accepted, and the string comes from the environment", () => {
  const { environmentId, connectionString } = assertMeasurementTarget(
    { environment: "platform-sandbox", databaseUrlEnv: "MY_DB" },
    { MY_DB: "postgres://user:pw@host/db" },
  );
  assert.equal(environmentId, "platform-sandbox");
  assert.equal(connectionString, "postgres://user:pw@host/db");
});

// ════════════════════ 2. THE REFUSAL PRECEDES ANY CLIENT ════════════════════

// The property is not "it throws". It is "it refused before the process was capable of contacting
// anything", which is a statement about load order. So the real CLI runs as a real child process with a
// Module._load hook that reports any attempt to RESOLVE a client library -- the mechanism, and the
// reasoning, of functions/test/operatorScriptEnvironmentFence.test.mjs.
const SENTINEL = "FENCE_VIOLATION_CLIENT_LIBRARY_LOADED";
const preloadPath = (() => {
  const dir = mkdtempSync(join(tmpdir(), "eos-measure-fence-"));
  const p = join(dir, "banClients.cjs");
  writeFileSync(
    p,
    `const Module = require("node:module");
const BANNED = [/^pg(\\/|$)/, /^firebase-admin(\\/|$)/, /^google-auth-library(\\/|$)/, /^@google-cloud\\//];
const original = Module._load;
Module._load = function (request) {
  if (BANNED.some((re) => re.test(request))) process.stderr.write("${SENTINEL}:" + request + "\\n");
  return original.apply(this, arguments);
};
`,
    "utf8",
  );
  return p;
})();

function runCli(args, extraEnv = {}) {
  return spawnSync(process.execPath, ["--require", preloadPath, SCRIPT_REL, ...args], {
    cwd: FUNCTIONS_DIR,
    encoding: "utf8",
    // Deliberately STACKED to look like a machine that would happily resolve a target on the operator's
    // behalf. If the script infers anything from this, these tests are how we find out.
    env: {
      ...process.env,
      DATABASE_URL: "postgres://ambient:ambient@localhost:5432/should_never_be_used",
      POLICY_TEST_DATABASE_URL: "postgres://ambient:ambient@localhost:5432/should_never_be_used",
      GOOGLE_CLOUD_PROJECT: "taylor-parts",
      GCLOUD_PROJECT: "taylor-parts",
      ...extraEnv,
    },
  });
}

for (const [name, args] of [
  ["no arguments at all", []],
  ["an environment but no database variable", ["--environment", "platform-sandbox"]],
  ["production named explicitly", ["--environment", "taylor-parts-production", "--databaseUrlEnv", "DATABASE_URL"]],
  ["an undeclared environment", ["--environment", "prod", "--databaseUrlEnv", "DATABASE_URL"]],
]) {
  test(`the CLI refuses (${name}) BEFORE loading any client library`, () => {
    const res = runCli(args);
    // Exit code 2 = FAILED TO MEASURE. Never 0 (which would claim a clean census) and never 1 (which
    // would claim the census found something).
    assert.equal(res.status, 2, "a fence refusal is a failure to measure");
    assert.match(res.stderr + res.stdout, /required|refus|role "production"|byte-identical/i, "it must say why");
    assert.ok(
      !res.stderr.includes(SENTINEL),
      `a client library was resolved before the fence refused: ${res.stderr}`,
    );
    assert.ok(!/should_never_be_used/.test(res.stdout), "the ambient connection string must never be used");
  });
}

test("the refusing CLI exits 2 -- a failure to measure, never mistaken for a measurement", () => {
  // Checked without a pipe: spawnSync gives the real status of the real process.
  const res = spawnSync(process.execPath, [SCRIPT_REL], { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.equal(res.status, 2, "2 means FAILED TO MEASURE; 0 would claim clean and 1 would claim a finding");
});

// ════════════════════ 3. IT WRITES NOTHING ════════════════════

test("the script contains no SQL write verb", () => {
  // An absence, so it is checked against the source rather than by running a path. The header claims it;
  // this is what keeps the claim true after the next edit.
  const source = readFileSync(SCRIPT_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  for (const verb of ["INSERT", "UPDATE ", "DELETE", "ALTER", "DROP", "TRUNCATE", "MERGE", "COPY ", "GRANT", "REVOKE"]) {
    assert.ok(!source.includes(verb), `the measurement must not contain ${verb.trim()}`);
  }
  assert.ok(/SET TRANSACTION READ ONLY/.test(source), "and the database must be told to refuse writes too");
});

test("the script loads no Firebase module, so it cannot 'resolve' a reference from a legacy store", () => {
  // Comments stripped first, for functions/test/adminPolicyNoFirebase.test.mjs's stated reason: this is a
  // check about CODE, and the header explaining WHY the measurement must never consult
  // `fieldops_technicians` is exactly the comment that should survive. Banning the word outright would
  // delete the reasoning along with the coupling.
  const source = readFileSync(SCRIPT_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const forbidden of ["firebase-admin", "firebase-functions", "firebase/firestore", "getFirestore", "fieldops_technicians"]) {
    assert.ok(!source.includes(forbidden), `the measurement must not reach ${forbidden}`);
  }
});

// ════════════════════ 4. SCOPE — NINE COLUMNS, AND THE ACTOR COLUMNS DECLARED OUT ════════════════════

test("the nine Employee-id columns are the scope, each citing where it was read from", () => {
  assert.equal(EMPLOYEE_REFERENCE_COLUMNS.length, 9);
  for (const c of EMPLOYEE_REFERENCE_COLUMNS) {
    assert.match(c.source, /^\d{13}:\d+$/, `${c.table}.${c.column} must cite migration:line`);
    assert.ok(["eos_policy", "eos_crm", "eos_commercial"].includes(c.schema));
  }
  // The two append-only ones are flagged, because a bad value there is permanent by design (#189).
  const appendOnly = EMPLOYEE_REFERENCE_COLUMNS.filter((c) => c.appendOnly);
  assert.equal(appendOnly.length, 2);
  assert.ok(appendOnly.every((c) => c.table === "ownership_handoffs"));
});

test("actor / credential columns are declared OUT OF SCOPE by name, not silently skipped", () => {
  // #185's chain runs CREDENTIAL -> PRINCIPAL -> EMPLOYEE, one way. Counting `created_by` against the
  // Employee authority would infer Employee identity from a credential id, which #185 calls insufficient
  // proof and #189 forbids. Declaring them is what lets a reader see the omission was a decision.
  for (const expected of ["created_by", "updated_by", "actor_uid", "recorded_by", "principal_id"]) {
    assert.ok(OUT_OF_SCOPE_ACTOR_COLUMNS.includes(expected), `${expected} must be declared out of scope`);
  }
  // And none of them is also in scope.
  const inScope = new Set(EMPLOYEE_REFERENCE_COLUMNS.map((c) => c.column));
  for (const actor of OUT_OF_SCOPE_ACTOR_COLUMNS) {
    assert.ok(!inScope.has(actor), `${actor} must not be measured as an Employee reference`);
  }
});

// ════════════════════ 5. THE CLASSIFICATION, AND THE HONESTY ════════════════════

/** A `pg`-shaped client double. `present` names which schema.table.column exist; `counts` answers the
 *  classification query per table.column; `failOn` makes a table's read throw, the way an outage does. */
function fakeClient({ present = [], counts = {}, failOn = [] } = {}) {
  return {
    query: async (sql, params) => {
      if (/SET TRANSACTION READ ONLY/.test(sql)) return { rows: [] };
      if (/information_schema\.columns/.test(sql)) {
        const key = params.join(".");
        return { rows: present.includes(key) ? [{ "1": 1 }] : [] };
      }
      const table = /FROM ([a-z_]+)\.([a-z_]+) r/.exec(sql);
      const column = /count\(\*\) FILTER \(WHERE r\.([a-z_]+) IS NULL\)/.exec(sql);
      const key = `${table[1]}.${table[2]}.${column[1]}`;
      if (failOn.includes(key)) throw new Error(`relation "${table[1]}.${table[2]}" does not exist`);
      const c = counts[key] ?? {};
      return {
        rows: [{
          row_count: c.rows ?? 0, null_reference: c.nullReference ?? 0, malformed: c.malformed ?? 0,
          resolved: c.resolved ?? 0, cross_tenant: c.crossTenant ?? 0, unresolved: c.unresolved ?? 0,
        }],
      };
    },
  };
}

const ALL_PRESENT = [
  "eos_workforce.employees.id",
  ...EMPLOYEE_REFERENCE_COLUMNS.map((c) => `${c.schema}.${c.table}.${c.column}`),
];
const LINK = "eos_policy.employee_principal_links.employee_id";

test("an absent Employee authority makes EVERY column AUTHORITY_UNAVAILABLE, not zero", () => {
  // This is the case that matters most. Migration 019 not applied here means nothing can be classified,
  // and a report of "0 unresolved" would be a lie that authorizes moving the deferred foreign key.
  return measureEmployeeReferenceIntegrity(fakeClient({ present: [] })).then((report) => {
    assert.equal(report.authorityPresent, false);
    assert.equal(report.columns.length, 9);
    assert.ok(report.columns.every((c) => c.status === "AUTHORITY_UNAVAILABLE"));
    assert.equal(report.unmeasured, 9);
    assert.equal(report.deferredForeignKeyPrecondition.met, false, "an unmeasurable database never meets the precondition");
    assert.match(describeReport(report, "test"), /AUTHORITY_UNAVAILABLE for 9 column\(s\) -- these are NOT zeroes/);
  });
});

test("a table that cannot be read is AUTHORITY_UNAVAILABLE for that column alone", async () => {
  const report = await measureEmployeeReferenceIntegrity(
    fakeClient({ present: ALL_PRESENT, failOn: [LINK], counts: {} }),
  );
  const link = report.columns.find((c) => c.column === "employee_id");
  assert.equal(link.status, "AUTHORITY_UNAVAILABLE");
  assert.match(link.reason, /does not exist/);
  // The others still measured -- a partial outage is reported partially, not as a total failure.
  assert.equal(report.columns.filter((c) => c.status === "MEASURED").length, 8);
  assert.equal(report.unmeasured, 1);
  assert.equal(report.deferredForeignKeyPrecondition.met, false);
  assert.match(report.deferredForeignKeyPrecondition.reason, /could not be measured/);
});

test("UNRESOLVED references block the deferred foreign key, and are never counted as resolved", async () => {
  const report = await measureEmployeeReferenceIntegrity(
    fakeClient({ present: ALL_PRESENT, counts: { [LINK]: { rows: 10, resolved: 7, unresolved: 3 } } }),
  );
  const link = report.columns.find((c) => c.column === "employee_id");
  assert.equal(link.status, "MEASURED");
  assert.equal(link.resolved, 7);
  assert.equal(link.unresolved, 3);
  assert.equal(report.deferredForeignKeyPrecondition.met, false);
  assert.match(report.deferredForeignKeyPrecondition.reason, /3 employee_principal_links rows/);
  // And the report tells the operator what NOT to do, in the ruling's own terms.
  const text = describeReport(report, "test");
  assert.match(text, /Do NOT move/);
  assert.match(text, /preserve and quarantine/i);
  assert.match(text, /Never fabricate an/);
});

test("CROSS_TENANT is reported separately and also blocks the key -- it is not 'resolved'", async () => {
  // Migration 003's Ruling B: an Employee that exists in another tenant is an identity leak rather than a
  // dangling row, and a key onto employees(id) alone would have let it through.
  const report = await measureEmployeeReferenceIntegrity(
    fakeClient({ present: ALL_PRESENT, counts: { [LINK]: { rows: 5, resolved: 4, crossTenant: 1 } } }),
  );
  assert.equal(report.totals.crossTenant, 1);
  assert.equal(report.deferredForeignKeyPrecondition.met, false);
  assert.match(report.deferredForeignKeyPrecondition.reason, /DIFFERENT tenant/);
});

test("MALFORMED blocks the key too", async () => {
  const report = await measureEmployeeReferenceIntegrity(
    fakeClient({ present: ALL_PRESENT, counts: { [LINK]: { rows: 2, resolved: 1, malformed: 1 } } }),
  );
  assert.equal(report.deferredForeignKeyPrecondition.met, false);
  assert.match(report.deferredForeignKeyPrecondition.reason, /malformed/);
});

test("a fully clean census MEETS the precondition, and says so", async () => {
  const report = await measureEmployeeReferenceIntegrity(
    fakeClient({ present: ALL_PRESENT, counts: { [LINK]: { rows: 4, resolved: 4 } } }),
  );
  assert.equal(report.unmeasured, 0);
  assert.equal(report.totals.unresolved, 0);
  assert.equal(report.totals.crossTenant, 0);
  assert.equal(report.deferredForeignKeyPrecondition.met, true);
  assert.match(describeReport(report, "test"), /DEFERRED FOREIGN KEY PRECONDITION: MET/);
});

test("a NULL reference is not a defect on its own", async () => {
  // #182 state D: NONE is legitimate "where the family legitimately permits no person reference", and
  // three of the nine columns are nullable for exactly that reason.
  const report = await measureEmployeeReferenceIntegrity(
    fakeClient({ present: ALL_PRESENT, counts: { "eos_crm.accounts.owner_employee_id": { rows: 6, nullReference: 6 } } }),
  );
  assert.equal(report.totals.nullReference, 6);
  assert.equal(report.totals.unresolved, 0);
  assert.equal(report.deferredForeignKeyPrecondition.met, true, "unowned Accounts do not block an Employee key");
});

test("the report names the out-of-scope columns and says why", () => {
  const text = describeReport(
    { authorityPresent: true, columns: [], outOfScopeActorColumns: [...OUT_OF_SCOPE_ACTOR_COLUMNS], totals: { resolved: 0, crossTenant: 0, unresolved: 0, malformed: 0, nullReference: 0 }, deferredForeignKeyPrecondition: { met: false, reason: "x" }, unmeasured: 0 },
    "test",
  );
  assert.match(text, /OUT OF SCOPE, deliberately/);
  assert.match(text, /infer Employee identity from a credential/);
  assert.match(text, /created_by/);
  assert.match(text, /READ ONLY: this run wrote nothing/);
});

test("MEASUREMENT AGAINST A REAL DATABASE IS NOT RUN", () => {
  // Recorded as a test so the gap shows in the suite output. The classification logic is proved against a
  // double; the COUNTS it would produce on a real estate are unknown to this lane, because no credential
  // for a database was available to it. That is exactly why the deferred foreign key stays deferred: this
  // lane could not satisfy #189's MEASURE FIRST, and did not pretend to.
  assert.equal(process.env.POLICY_TEST_DATABASE_URL ?? "", "", "if this fails, a database WAS available and the census should have been taken");
});
