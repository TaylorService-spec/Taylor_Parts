// The legacy operationalRoles retirement ledger, checked against the repository.
//
// A hand-kept inventory is worthless the day after it is written. So this suite DERIVES the real code-level consumer
// set and asserts correspondence in BOTH directions: a consumer in the code but not the ledger fails, and a ledger
// entry whose file no longer uses the term fails. The ledger can only be wrong by failing the build.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const require = createRequire(import.meta.url);
const ledgerModule = require("../lib/adminPolicy/migration/legacyConsumerLedger.js");
const { LEGACY_CONSUMER_LEDGER, LEGACY_TERMS, CONSUMER_CLASSIFICATIONS, CONSUMER_STATUSES, retirementReadiness } = ledgerModule;

/** Comments are PROSE: the decomposition modules must be free to say "never inferred from operationalRoles". */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/.*$/gm, "");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * The ledger module itself is not a consumer: the legacy names appear there as the SCANNER'S VOCABULARY
 * (`LEGACY_TERMS`), which is what makes this derivation possible at all. Listing it would make the ledger an entry
 * in itself and, worse, would let it block its own retirement gates forever.
 */
const SELF = "functions/src/adminPolicy/migration/legacyConsumerLedger.ts";

/** Every file whose CODE (not prose) names a legacy term, with the terms it names. */
function deriveConsumers() {
  const found = new Map();
  for (const root of ["functions/src", "field-ops-app-vite/src"]) {
    for (const file of walk(join(REPO, root))) {
      const code = stripComments(readFileSync(file, "utf8"));
      // WORD BOUNDARIES, not substrings: OPERATIONAL_ROLE_VALUES is its own identifier and must not be counted as
      // a use of OPERATIONAL_ROLE, or the ledger would attribute a dependency the file does not have.
      const terms = LEGACY_TERMS.filter((t) => new RegExp(`\\b${t}\\b`).test(code));
      const rel = relative(REPO, file).split("\\").join("/");
      if (terms.length > 0 && rel !== SELF) found.set(rel, terms);
    }
  }
  return found;
}

const derived = deriveConsumers();
const byPath = new Map(LEGACY_CONSUMER_LEDGER.map((e) => [e.path, e]));

test("the ledger and the repository name exactly the same consumers", () => {
  const inCode = [...derived.keys()].sort();
  const inLedger = [...byPath.keys()].sort();
  assert.deepEqual(inLedger, inCode,
    "a consumer appeared or disappeared: classify the new one, or remove the entry whose file no longer uses a legacy term");
  // Duplicate entries would let one path carry two contradictory statuses.
  assert.equal(byPath.size, LEGACY_CONSUMER_LEDGER.length, "a path is listed twice");
});

test("each entry names the terms its file actually uses", () => {
  for (const [path, terms] of derived) {
    assert.deepEqual([...byPath.get(path).terms].sort(), [...terms].sort(), path);
  }
});

test("every entry is internally coherent: a blocked entry says why, a settled one cannot", () => {
  for (const e of LEGACY_CONSUMER_LEDGER) {
    assert.ok(CONSUMER_CLASSIFICATIONS.includes(e.classification), `${e.path}: unknown classification`);
    assert.ok(CONSUMER_STATUSES.includes(e.status), `${e.path}: unknown status`);
    assert.ok(typeof e.consumer === "string" && e.consumer.length > 20, `${e.path}: consumer must say what it does`);

    // BLOCKED must name its blocker; nothing else may claim one.
    if (e.status === "BLOCKED") assert.ok(e.blockedReason && e.blockedReason.length > 20, `${e.path}: BLOCKED with no reason`);
    else assert.equal(e.blockedReason, null, `${e.path}: only a BLOCKED entry carries a reason`);

    // CONVERTED is a claim about work that landed, so it must name the PR that did it.
    if (e.status === "CONVERTED") assert.ok(e.replacementPr, `${e.path}: CONVERTED without a replacement PR`);

    // Everything that consumes legacy AUTHORITY must name what replaces it. Evidence has no replacement by design:
    // it reads the legacy export and retires with the field, not with the authority.
    if (e.classification === "MIGRATION_EVIDENCE" || e.classification === "DEAD_LEGACY") {
      assert.equal(e.replacementAuthority, null, `${e.path}: nothing replaces this`);
    } else {
      assert.ok(e.replacementAuthority, `${e.path}: names no replacement authority`);
    }
  }
});

test("the replacement authority never confuses the three decomposed authorities", () => {
  for (const e of LEGACY_CONSUMER_LEDGER) {
    const replacement = e.replacementAuthority ?? "";
    // A DISPLAY_PERSONA consumer must never be replaced by a qualification or a scope: presentation grants nothing,
    // and neither qualification nor Job Role may become application security.
    if (e.classification === "DISPLAY_PERSONA") {
      assert.doesNotMatch(replacement, /employee_work_eligibility|employee_operational_scopes/,
        `${e.path}: presentation must not be replaced by qualification or scope`);
      assert.match(replacement, /job_roles/, `${e.path}: persona is replaced by Job Role`);
    }
    // A qualification question is never answered by a scope alone, and vice versa.
    if (e.classification === "WORK_ELIGIBILITY") {
      assert.match(replacement, /employee_work_eligibility/, `${e.path}: a qualification question needs the qualification authority`);
    }
    if (e.classification === "OPERATIONAL_SCOPE") {
      assert.match(replacement, /employee_operational_scopes/, `${e.path}: a scope question needs the scope authority`);
    }
  }
});

test("the retirement gates are COMPUTED, and J and K are both still blocked", () => {
  const gates = Object.fromEntries(retirementReadiness().map((g) => [g.step, g]));
  // Nothing has been converted yet: steps A-E built authorities and tooling and converted no consumer.
  assert.equal(gates.J.ready, false, "J cannot be ready while any operationalRoleActive consumer is unsettled");
  assert.equal(gates.K.ready, false, "K cannot be ready while any operationalRoles consumer is unsettled");
  assert.ok(gates.J.blockedBy.length > 0 && gates.K.blockedBy.length > 0);
  // The gate is derived from status, not asserted: flipping a status to CONVERTED must move it.
  const pretend = LEGACY_CONSUMER_LEDGER.map((e) => ({ ...e, status: e.classification === "MIGRATION_EVIDENCE" ? e.status : "CONVERTED", blockedReason: null }));
  const opened = Object.fromEntries(retirementReadiness(pretend).map((g) => [g.step, g]));
  assert.equal(opened.J.ready, true);
  assert.equal(opened.K.ready, true);
  // Migration evidence never blocks retirement -- it reads the export, not the live path.
  const evidenceOnly = LEGACY_CONSUMER_LEDGER.filter((e) => e.classification === "MIGRATION_EVIDENCE");
  assert.ok(evidenceOnly.length > 0);
  for (const e of evidenceOnly) {
    assert.ok(!gates.J.blockedBy.includes(e.path) && !gates.K.blockedBy.includes(e.path), `${e.path} blocks retirement`);
  }
});

test("nothing is recorded as CONVERTED or DEAD yet, because no consumer has been converted", () => {
  // The ledger's whole value is that it refuses to flatter the programme. A/B/C built authorities, D/E built
  // tooling; not one live consumer moved. If this assertion starts failing, a conversion PR landed -- update it
  // deliberately, with the PR named.
  const claimed = LEGACY_CONSUMER_LEDGER.filter((e) => e.status === "CONVERTED" || e.status === "DEAD");
  assert.deepEqual(claimed.map((e) => e.path), [], "a status claims work that this ledger has no PR evidence for");
});

test("the ledger decides nothing and reads nothing: pure data, no scanning, no database, no Firebase", () => {
  const code = stripComments(readFileSync(join(FUNCTIONS_DIR, "src/adminPolicy/migration/legacyConsumerLedger.ts"), "utf8"));
  assert.doesNotMatch(code, /\bpg\b|pool|client\.query|SELECT |INSERT |UPDATE |DELETE /i);
  assert.doesNotMatch(code, /readFileSync|readdirSync|process\.env|fetch\(/, "the ledger must not scan; its suite does");
  assert.doesNotMatch(code, /require\(\s*["'][^"']*fire(base|store)[^"']*["']\s*\)|from\s+["'][^"']*fire(base|store)[^"']*["']/i);
  // It is data plus one derivation; it must not grow into a framework.
  assert.ok(Object.keys(ledgerModule).length <= 8, "the ledger module is growing beyond a ledger");
});
