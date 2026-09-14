// THE ACCOUNTABILITY MEASUREMENT — its fence, its read-only discipline, and its refusal to guess.
//
// ════════════════════ WHAT IS WORTH PROVING ABOUT A COUNTING SCRIPT ════════════════════
//
// Four things, each of which is a way this tool could do damage or tell a real lie. The arithmetic is
// not one of them.
//
//   1. THE FENCE. It refuses without an explicitly named environment and an explicitly named database
//      variable, and it refuses production twice over — BEFORE the process can connect to anything.
//      Proved by subprocess, because "refused before it could contact anything" is a statement about a
//      process's history rather than about a return value.
//   2. THE POLICY IS NOT A DEFAULT. #189 `MI-ε`. A measurement that assumed `['ACTIVE']` would publish
//      an unruled policy as a governed number, and a census number is what authorizes enforcement.
//   3. IT WRITES NOTHING. Proved statically, because an absence is not observable by running the happy
//      path.
//   4. IT NEVER REPORTS AN UNKNOWN AS A ZERO. #187 §2: `AUTHORITY_UNAVAILABLE` is distinct from a
//      finding. A report showing "0 invalid" for a table it could not read would be the false clean
//      bill of health a backfill decision would be taken on.
//
// No database: the `pg` client is a double. The live-server proofs are in
// functions/test/commercialAccountabilityPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { EMPLOYMENT_STATUS_VALUES } from "../lib/employeeIdentity/employeeAuthority.js";
import { ACCOUNTABILITY_FAMILIES } from "../lib/responsibility/accountablePersonStorage.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const SCRIPT_REL = "scripts/measureCommercialAccountability.js";
const SCRIPT_PATH = join(FUNCTIONS_DIR, SCRIPT_REL);

const require = createRequire(import.meta.url);
const {
  assertEligibilityPolicy,
  measureCommercialAccountability,
  describeReport,
  ACCOUNTABILITY_TABLES,
  CLASSIFICATION_BUCKETS,
  EMPLOYMENT_STATUS_VALUES: SCRIPT_STATUSES,
} = require(SCRIPT_PATH);

const POLICY = Object.freeze({ policyId: "P-TEST", eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]) });

/**
 * A `pg`-shaped double. `counts` is the row the classification query returns; `has` decides which
 * `information_schema` probes succeed.
 */
function fakeClient({ counts = {}, has = () => true, failClassification = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/information_schema\.columns/.test(sql)) {
        const [schema, table, column] = params;
        return { rows: has(schema, table, column) ? [{ 1: 1 }] : [] };
      }
      if (failClassification) throw new Error("permission denied for relation");
      const zeroes = {
        scanned: 0,
        present_valid_eligible: 0,
        present_valid_not_eligible: 0,
        present_cross_tenant: 0,
        present_invalid: 0,
        missing_owner_derivable: 0,
        missing_owner_not_eligible: 0,
        missing_owner_invalid: 0,
      };
      return { rows: [{ ...zeroes, ...counts }] };
    },
  };
}

// ════════════════════ 1. THE FENCE, BY SUBPROCESS ════════════════════

const run = (args, env = {}) =>
  spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: FUNCTIONS_DIR,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

test("no explicit environment = refuse, and the refusal precedes any connection", () => {
  const r = run([]);
  assert.equal(r.status, 2, "a fence refusal must exit 2 — a FAILURE TO MEASURE, never a clean 0");
  assert.match(r.stderr, /--environment is required/);
  assert.equal(r.stdout, "", "a refused run printed a report");
});

test("PRODUCTION IS REFUSED, by role and by project id", () => {
  const r = run(["--environment", "taylor-parts-production", "--databaseUrlEnv", "X"], { X: "postgres://x" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refuses production|production/);
});

test("an undeclared environment is refused rather than resolved", () => {
  const r = run(["--environment", "sandbox", "--databaseUrlEnv", "X"], { X: "postgres://x" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /byte-identical to an environment id declared/);
});

test("no explicit database variable = refuse; and a named-but-empty one is refused too", () => {
  const missing = run(["--environment", "platform-sandbox"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--databaseUrlEnv <VAR> is required/);

  const empty = run(["--environment", "platform-sandbox", "--databaseUrlEnv", "NOPE_NOT_SET"]);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /empty or unset/);
});

test("the fence is SHARED with the Employee-reference measurement, not reimplemented", () => {
  const src = readFileSync(SCRIPT_PATH, "utf8");
  assert.match(
    src,
    /require\("\.\/measureEmployeeReferenceIntegrity\.js"\)/,
    "this tool reimplements the fence instead of sharing it. Two fences drift, and the one that drifts " +
      "is the one nobody reads.",
  );
  // And it does not define its own copy of the production constants.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /taylor-parts/, "a second literal copy of the production project id");
});

// ════════════════════ 2. THE POLICY IS AN ARGUMENT (#189 MI-ε) ════════════════════

test("#189 MI-ε: there is NO default eligibility policy — both halves are required", () => {
  assert.throws(() => assertEligibilityPolicy({}), /--policyId <ID> is required/);
  assert.throws(
    () => assertEligibilityPolicy({ policyId: "P" }),
    /--eligibleStatus .* is required and has NO DEFAULT/,
  );
  // And the refusal message must NOT suggest ACTIVE as the answer.
  try {
    assertEligibilityPolicy({ policyId: "P" });
  } catch (err) {
    assert.doesNotMatch(
      err.message,
      /default(s)? to ACTIVE|assume ACTIVE|try ACTIVE/i,
      "the refusal nudges the operator toward the one policy #189 forbids assuming",
    );
  }
  // Nothing in the SOURCE bakes a policy in.
  const code = readFileSync(SCRIPT_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /eligibleStatuses\s*[:=]\s*\[\s*["']ACTIVE["']\s*\]/);
  assert.doesNotMatch(code, /!==\s*["']ACTIVE["']/);
});

test("a typo'd status is refused rather than treated as a policy that accepts nothing", () => {
  assert.throws(
    () => assertEligibilityPolicy({ policyId: "P", eligibleStatus: "ACTIVE,ACTVE" }),
    /not governed employment statuses/,
  );
});

test("a comma-separated list is accepted, de-duplicated, and all six are legal to name", () => {
  const policy = assertEligibilityPolicy({ policyId: "P", eligibleStatus: "ACTIVE,CONTRACTOR,ACTIVE" });
  assert.deepEqual([...policy.eligibleStatuses], ["ACTIVE", "CONTRACTOR"]);
  for (const status of EMPLOYMENT_STATUS_VALUES) {
    assert.ok(assertEligibilityPolicy({ policyId: "P", eligibleStatus: status }));
  }
});

test("the script's mirrored employment vocabulary matches the governed port's, exactly", () => {
  assert.deepEqual(
    [...SCRIPT_STATUSES],
    [...EMPLOYMENT_STATUS_VALUES],
    "the measurement's mirrored vocabulary drifted from employeeAuthority.ts's EMPLOYMENT_STATUS_VALUES",
  );
});

// ════════════════════ 3. IT WRITES NOTHING ════════════════════

test("READ ONLY by construction — no write verb anywhere, and a READ ONLY transaction", () => {
  const src = readFileSync(SCRIPT_PATH, "utf8");
  // Comments stripped: the header NAMES the verbs it refuses to use, and a naive scan would match that.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const verb of ["INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "TRUNCATE", "MERGE", "CREATE TABLE", "COPY "]) {
    assert.ok(
      !new RegExp(verb, "i").test(code.replace(/SET TRANSACTION READ ONLY/g, "")),
      `the measurement's code contains "${verb}" — it must only ever SELECT`,
    );
  }
  assert.match(code, /SET TRANSACTION READ ONLY/, "the DATABASE must refuse a write, not merely this file");
  // And no Firebase of any kind: #187 §2 forbids falling back to Firestore, users, or technicians.
  for (const forbidden of ["firebase", "firestore", "fieldops_technicians", '"users"', "getAuth"]) {
    assert.ok(!new RegExp(forbidden, "i").test(code), `the measurement reaches for ${forbidden}`);
  }
});

// ════════════════════ 4. THE CLASSIFICATION, AND WHAT IT REFUSES TO SAY ════════════════════

test("#189 OD-16: exactly the three admitted families are scanned, and no other", () => {
  assert.deepEqual(
    ACCOUNTABILITY_TABLES.map((t) => t.family),
    [...ACCOUNTABILITY_FAMILIES],
    "the measurement's scope drifted from the governed accountability family scope",
  );
  for (const t of ACCOUNTABILITY_TABLES) assert.equal(t.schema, "eos_commercial");
});

test("every row lands in exactly one bucket, and the buckets sum to `scanned`", async () => {
  const client = fakeClient({
    counts: {
      scanned: 21,
      present_valid_eligible: 6,
      present_valid_not_eligible: 4,
      present_cross_tenant: 1,
      present_invalid: 2,
      missing_owner_derivable: 5,
      missing_owner_not_eligible: 2,
      missing_owner_invalid: 1,
    },
  });
  const report = await measureCommercialAccountability(client, POLICY);
  assert.equal(report.unmeasured, 0);
  assert.equal(report.scanned, 63, "three families x 21 rows");
  const summed = CLASSIFICATION_BUCKETS.reduce((a, k) => a + report.totals[k], 0);
  assert.equal(summed, report.scanned);
  assert.equal(report.totals.presentValidNotEligible, 12);
  assert.equal(report.totals.missingOwnerDerivable, 15);
  assert.equal(report.totals.governedException, 0);
});

test("a classification that does not partition the population REFUSES to be a finding", async () => {
  // A row in no bucket, or in two. The script must not print a number it cannot account for.
  const client = fakeClient({ counts: { scanned: 10, present_valid_eligible: 3 } });
  const report = await measureCommercialAccountability(client, POLICY);
  assert.equal(report.unmeasured, ACCOUNTABILITY_TABLES.length);
  for (const t of report.tables) {
    assert.equal(t.measured, false);
    assert.match(t.error, /does not partition the population/);
  }
  assert.equal(report.scanned, 0, "an untrustworthy classification still contributed to the totals");
});

test("#187 §2: a MISSING EMPLOYEE AUTHORITY is AUTHORITY_UNAVAILABLE, never 'every reference invalid'", async () => {
  const client = fakeClient({
    counts: { scanned: 100 },
    has: (schema) => schema !== "eos_workforce",
  });
  const report = await measureCommercialAccountability(client, POLICY);
  assert.equal(report.unmeasured, 3);
  assert.equal(report.scanned, 0);
  for (const bucket of CLASSIFICATION_BUCKETS) assert.equal(report.totals[bucket], 0);
  for (const t of report.tables) {
    assert.match(t.error, /AUTHORITY_UNAVAILABLE/);
    assert.match(t.error, /explicitly NOT a finding that these references are invalid or missing/);
  }
  // And the printed report says so, loudly, rather than letting a reader take zeroes for a clean bill.
  const text = describeReport(report, "platform-sandbox");
  assert.match(text, /COULD NOT BE MEASURED/);
  assert.match(text, /NOT a clean bill of health/);
});

test("an unapplied migration is a FAILURE TO MEASURE, not a finding of zero", async () => {
  const client = fakeClient({ has: (schema, table, column) => column !== "accountable_employee_id" });
  const report = await measureCommercialAccountability(client, POLICY);
  assert.equal(report.unmeasured, 3);
  for (const t of report.tables) {
    assert.match(t.error, /has not been applied here/);
    assert.match(t.error, /FAILURE TO MEASURE, not a finding of zero/);
  }
});

test("a read that THROWS is reported per family and never swallowed into a count", async () => {
  const report = await measureCommercialAccountability(fakeClient({ failClassification: true }), POLICY);
  assert.equal(report.unmeasured, 3);
  for (const t of report.tables) assert.match(t.error, /read failed: permission denied/);
  assert.equal(report.scanned, 0);
});

test("the report states the policy it used, and says what it did NOT measure", async () => {
  const report = await measureCommercialAccountability(fakeClient({ counts: { scanned: 0 } }), POLICY);
  const text = describeReport(report, "platform-sandbox");
  assert.match(text, /eligibility policy: P-TEST/);
  assert.match(text, /accepts employment status: ACTIVE, CONTRACTOR/);
  // The two honest omissions, named rather than left as ambiguous zeroes.
  assert.match(text, /ACTIONABLE vs HISTORICAL/);
  assert.match(text, /eos_commercial holds no lifecycle state/);
  assert.match(text, /governedException is 0 because NOTHING IN EOS WRITES ONE/);
  // And the scope is stated with the ruling's own vocabulary for everything outside it.
  assert.match(text, /NOT APPLICABLE -- not MISSING, not OWNERLESS,/);
});

test("the measurement DECLARES that it performs no backfill, and has no mechanism for one", async () => {
  // The word appears exactly once in the code, and it is the report's own first line saying this tool
  // does not do it. #182 §10 and #189 MI-lambda: a backfill is a separate, separately-proven artifact.
  const code = readFileSync(SCRIPT_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const mentions = code.match(/backfill/gi) ?? [];
  assert.equal(
    mentions.length,
    1,
    "the measurement's code mentions backfill more than once. The single legitimate occurrence is the " +
      "report header declaring that it performs none.",
  );
  const report = await measureCommercialAccountability(fakeClient({ counts: { scanned: 0 } }), POLICY);
  assert.match(describeReport(report, "platform-sandbox"), /read only, no backfill/);
});
