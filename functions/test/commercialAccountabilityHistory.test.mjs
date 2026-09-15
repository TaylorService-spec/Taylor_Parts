// ACTIVATION BLOCKER #1, offline -- the PostgreSQL accountability audit authority's vocabulary, its refusals before
// any statement, and the boundaries the Owner ruling set: no Firestore audit, blockers #2 and #3 untouched, no FK.
// The live-server proof is functions/test/commercialAccountabilityHistoryPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const require = createRequire(import.meta.url);
const repo = require("../lib/eosCommercial/commercialAccountabilityRepository.js");
const { ACCOUNTABLE_PERSON_SOURCES, mintGovernedAccountablePerson } = require("../lib/responsibility/accountablePersonStorage.js");
const { decideAccountabilityEligibility } = require("../lib/employeeIdentity/employeeAuthority.js");

const SRC = join(FUNCTIONS_DIR, "src");
const REPO_SOURCE = join(SRC, "eosCommercial", "commercialAccountabilityRepository.ts");
const MIGRATION = join(FUNCTIONS_DIR, "migrations", "1759363200000_accountability-history-action-and-source.sql");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const upSection = () => readFileSync(MIGRATION, "utf8").split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");

function walk(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

const V1 = { policyId: "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", eligibleStatuses: ["ACTIVE", "CONTRACTOR"] };
const mint = (tenantId, employeeId = "e-a", source = "EXPLICIT") => {
  const employee = { employeeId, tenantId, employmentStatus: "ACTIVE", operatingCompanyId: "taylor" };
  return mintGovernedAccountablePerson(employee, decideAccountabilityEligibility(employee, V1), source);
};
const recordingClient = () => {
  const issued = [];
  return { issued, async query(sql) { issued.push(sql); return { rows: [] }; } };
};

// ════════════════════ (1) VOCABULARY ════════════════════

test("(1) the history actions and sources are exactly the migration's, and source adds nothing to the mint's", () => {
  const up = upSection();
  assert.deepEqual([...repo.ACCOUNTABILITY_HISTORY_ACTIONS], ["ESTABLISHMENT", "HANDOFF"]);
  assert.match(up, /CASE WHEN previous_accountable_employee_id IS NULL THEN 'ESTABLISHMENT' ELSE 'HANDOFF' END/);
  assert.match(up, /CHECK \(action IN \('ESTABLISHMENT', 'HANDOFF'\)\)/);
  const enumValues = up.match(/CREATE TYPE accountable_person_source AS ENUM \(([^)]*)\)/)[1].match(/'([A-Z_]+)'/g).map((v) => v.slice(1, -1));
  assert.deepEqual(enumValues, [...ACCOUNTABLE_PERSON_SOURCES], "the history source vocabulary drifted from the mint's");
  assert.doesNotMatch(up, /commercial_handoff_source/, "ownership's handoff channel vocabulary was borrowed for accountability");
});

test("migration 021 is additive: no DROP, no trigger change, no rewrite of history, and existing rows keep NULL source", () => {
  const up = upSection();
  for (const forbidden of [/DROP\s/i, /DISABLE TRIGGER/i, /UPDATE\s+accountability_handoffs/i, /DELETE\s/i, /accountable_employee_id\s+TEXT/i, /FOREIGN KEY|REFERENCES/i]) {
    assert.doesNotMatch(up, forbidden);
  }
  assert.match(up, /CHECK \(source IS NOT NULL\) NOT VALID/, "the source requirement must not assert provenance about pre-021 rows");
  assert.doesNotMatch(up, /ADD COLUMN source [^,;]*(NOT NULL|DEFAULT)/i, "a provenance value was invented for existing rows");
  assert.match(readFileSync(MIGRATION, "utf8").split("-- Down Migration")[1], /refuses to drop/);
});

// ════════════════════ refusal BEFORE any statement ════════════════════

test("(11) forged, foreign-tenant, out-of-scope and derived-handoff changes refuse before a single statement", async () => {
  const cases = [
    ["ESTABLISHMENT", { family: "opportunity", recordId: "o", accountablePerson: { accountableEmployeeId: "e-a", tenantId: "t1", source: "EXPLICIT" } }, "ACCOUNTABLE_PERSON_NOT_GOVERNED"],
    ["ESTABLISHMENT", { family: "opportunity", recordId: "o", accountablePerson: "e-a" }, "ACCOUNTABLE_PERSON_NOT_GOVERNED"],
    ["ESTABLISHMENT", { family: "opportunity", recordId: "o", accountablePerson: JSON.parse(JSON.stringify(mint("t1"))) }, "ACCOUNTABLE_PERSON_NOT_GOVERNED"],
    ["ESTABLISHMENT", { family: "opportunity", recordId: "o", accountablePerson: mint("t2") }, "ACCOUNTABLE_PERSON_OTHER_TENANT"],
    ["ESTABLISHMENT", { family: "account", recordId: "o", accountablePerson: mint("t1") }, "FAMILY_NOT_ACCOUNTABLE"],
    ["HANDOFF", { family: "opportunity", recordId: "o", accountablePerson: mint("t1", "e-a", "DERIVED_FROM_RECORD_OWNER") }, "HANDOFF_SOURCE_NOT_EXPLICIT"],
    ["ASSIGNMENT", { family: "opportunity", recordId: "o", accountablePerson: mint("t1") }, "REQUEST_INVALID"],
  ];
  for (const [action, input, code] of cases) {
    const client = recordingClient();
    await assert.rejects(repo.stageCommercialAccountablePersonChange(client, "t1", "actor", action, input), (e) => e.code === code, `${action} ${code}`);
    assert.deepEqual(client.issued, [], `${code} issued a statement before refusing`);
  }
});

test("the minted value carries the tenant it was resolved in, so no second Employee lookup is needed (OD-7)", () => {
  assert.equal(mint("t1").tenantId, "t1");
  const code = strip(readFileSync(REPO_SOURCE, "utf8"));
  assert.doesNotMatch(code, /employeeAuthority|resolveEmployeeReference|eos_workforce/, "the writer performs its own Employee lookup");
});

test("(6) an accountability change writes no ownership, assignment or role field", () => {
  const code = strip(readFileSync(REPO_SOURCE, "utf8"));
  for (const forbidden of [/owner_employee_id/, /ownership_handoffs/, /assign/i, /role/i, /OWNERSHIP_HANDOFF/]) {
    assert.doesNotMatch(code, forbidden);
  }
  const updates = code.match(/UPDATE \$\{storage\.table\} SET [^`]*/g) ?? [];
  assert.equal(updates.length, 1);
  assert.match(updates[0], /SET \$\{storage\.column\} = \$3, updated_by = \$4, updated_at = now\(\)/);
});

// ════════════════════ (13) (14) NO FIRESTORE AUDIT ════════════════════

test("(13) the writer imports no Firebase, no Firestore and no Firestore audit writer", () => {
  const src = readFileSync(REPO_SOURCE, "utf8");
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["../responsibility/accountabilityFamilyScope", "../responsibility/accountablePersonStorage", "node:crypto", "pg"]);
});

test("(14) the Firestore AuditAction vocabulary was NOT extended for accountability", () => {
  const union = readFileSync(join(SRC, "types", "access.ts"), "utf8");
  const writer = readFileSync(join(SRC, "access", "auditEventWriter.ts"), "utf8");
  for (const [name, text] of [["types/access.ts", union], ["access/auditEventWriter.ts", writer]]) {
    assert.doesNotMatch(strip(text), /["']ACCOUNTABILITY[A-Z_]*["']|["'][a-zA-Z]*[Aa]ccountab[a-zA-Z]*["']/, `${name} gained an accountability audit action`);
  }
});

// ════════════════════ (15) (16) THE OTHER BLOCKERS STAY OPEN ════════════════════

test("(15) blocker #2 stays unwired: no callable, no runtime entry point and no index export reaches the writer", () => {
  // Commercial wave C2 composes the writer inside the governed PostgreSQL command layer, which is itself unreachable
  // from every runtime entry point (proved by commercialCommandLayer.test.mjs). Nothing outside that layer may import it.
  const reaching = walk(SRC, ".ts")
    .filter((f) => f !== REPO_SOURCE && /commercialAccountabilityRepository/.test(readFileSync(f, "utf8")))
    .map((f) => relative(FUNCTIONS_DIR, f));
  // Commercial C5 copy once (src/commercialMigration/commercialC5Target.ts) is the one other importer: the operator-only,
  // nonprod-fenced one-time migration, which no runtime entry point reaches (commercialC5Migration.test.mjs STRUCTURAL).
  assert.deepEqual(reaching.sort(), ["src/commercialMigration/commercialC5Target.ts", "src/eosCommercial/commands/commercialCreation.ts"]);
  assert.doesNotMatch(readFileSync(join(SRC, "index.ts"), "utf8"), /responsibility\/|commercialAccountabilityRepository/);
  for (const callable of ["opportunity/opportunityCallables.ts", "salesAgreement/salesAgreementCallables.ts", "salesOrder/salesOrderCallables.ts"]) {
    const code = strip(readFileSync(join(SRC, callable), "utf8"));
    assert.doesNotMatch(code, /establishCreationAccountablePerson|evaluateResponsibilityEnforcement|stageCommercialAccountablePersonChange/, `${callable} is now wired`);
  }
});

test("(16) blocker #3 stays unfixed: updateOpportunity still emits no governed ownership handoff", () => {
  const code = strip(readFileSync(join(SRC, "opportunity", "opportunityCallables.ts"), "utf8"));
  assert.ok(!code.includes("OWNERSHIP_HANDOFF") && !code.includes("stageOwnershipHandoff"));
});

test("(17) the deferred Employee foreign key stays deferred", () => {
  assert.ok(readdirSync(join(FUNCTIONS_DIR, "migrations", "deferred")).some((f) => f.includes("employee-principal-link-employee-fk")));
  assert.ok(!readdirSync(join(FUNCTIONS_DIR, "migrations")).some((f) => f.endsWith(".sql") && f.includes("employee-fk")));
  assert.doesNotMatch(readFileSync(join(REPO_ROOT, "firestore.rules"), "utf8"), /accountab/i, "Rules gained an accountability statement");
});
