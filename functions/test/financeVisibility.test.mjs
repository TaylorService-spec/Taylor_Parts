// FINANCE VISIBILITY -- the OFFLINE half (Firebase exit B1, DECISIONS #B1; no database, no environment): the pure inner-reach
// table, the migration's shape, and the pins that there is no finance search source, no finance export, and no Firebase.
// The PostgreSQL half (every projection, the activated fixture, the company boundary) is financeVisibilityPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const v = require("../lib/eosFinance/financeVisibility.js");
const financeOps = require("../lib/eosFinance/financeOperations.js");
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const MIGRATION = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../migrations/1764620000000_finance-visibility-and-credit-immutability.sql"), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const caps = (...keys) => ({ capabilities: new Set(["finance.payment.read", ...keys.map((k) => `finance.visibility.${k}`)]) });

test("inner reach per company: a full key or NO key is FULL; self / team only is restricted; inactive or businessUnit-only is empty", () => {
  const mode = (actor, active) => v.financeVisibilityModeAt(actor, "taylor", active);
  assert.equal(mode(caps(), false), "FULL", "no visibility key: the EOS company-assignment model (D-249-2)");
  assert.equal(mode(caps("consolidated"), false), "FULL");
  assert.equal(mode(caps("company"), false), "FULL");
  assert.equal(mode(caps("self", "consolidated"), true), "FULL", "a full key wins over self");
  // INACTIVE (every environment today, D-249-0): self / team alone read NOTHING, exactly Firebase's effective zero.
  assert.equal(mode(caps("self"), false), "EMPTY");
  assert.equal(mode(caps("team"), false), "EMPTY");
  assert.equal(mode(caps("self", "team"), false), "EMPTY");
  // ACTIVATED (the Owner's decision, not made): self / team restrict to attributed receivables.
  assert.equal(mode(caps("self"), true), "SELF");
  assert.equal(mode(caps("team"), true), "TEAM");
  assert.equal(mode(caps("self", "team"), true), "TEAM", "team includes self");
  // EOS receivables carry no business unit, so a business-unit-only reach sees nothing, activated or not.
  assert.equal(mode(caps("businessUnit"), true), "EMPTY");
  assert.equal(mode(caps("businessUnit"), false), "EMPTY");
  // A mixed principal that holds a visibility key without a full one is restricted, never widened.
  assert.equal(mode(caps("self", "businessUnit"), true), "SELF");
});

test("F1 (review): a restriction key held through a SCOPE or a CONDITION restricts -- it never resolves FULL (fail closed)", () => {
  const mode = (actor, active, company = "taylor") => v.financeVisibilityModeAt(actor, company, active);
  const reach = new Set(["finance.payment.read"]);
  // finance.visibility.* is not scope-evaluable, so a Role assigned at operatingCompany=taylor arrives as `inertScoped`, never in `capabilities`.
  const scoped = (key, company = "taylor", type = "operatingCompany") => ({ capabilities: reach, inertScoped: [{ capabilityKey: `finance.visibility.${key}`, scopeType: type, scopeValue: company }] });
  assert.equal(mode(scoped("self"), false), "EMPTY", "inactive: the company-scoped self holder reads nothing");
  assert.equal(mode(scoped("self"), true), "SELF", "activated: restricted to the credited rows");
  assert.equal(mode(scoped("team"), true), "TEAM");
  assert.equal(mode(scoped("self"), false, "ventana"), "FULL", "scoped to Taylor: no restriction key at Ventana (the other Role's reach stands)");
  assert.equal(mode(scoped("self", "taylor", "businessUnit"), true, "ventana"), "EMPTY", "a scope the runtime does not consume applies to EVERY company and reads nothing");
  assert.equal(mode(scoped("businessUnit"), true), "EMPTY");
  // A CONDITIONED grant (flat or scoped) restricts and, nothing evaluating the condition, reads nothing even when activated.
  const conditioned = { capabilities: reach, conditionallyHeld: new Set(["finance.visibility.self"]) };
  assert.equal(mode(conditioned, false), "EMPTY");
  assert.equal(mode(conditioned, true), "EMPTY");
  assert.equal(mode({ capabilities: reach, scopedHeld: [{ capabilityKey: "finance.visibility.self", scopeType: "operatingCompany", scopeValue: "taylor", sourceRole: "r", assignmentId: null, condition: { paths: [] } }] }, true), "EMPTY");
  // A conditioned or scoped FULL key never widens: only a flat (or unconditioned company-scoped) consolidated / company key is FULL.
  assert.equal(mode({ capabilities: reach, conditionallyHeld: new Set(["finance.visibility.consolidated"]), inertScoped: scoped("self").inertScoped }, true), "SELF");
  assert.equal(mode({ capabilities: new Set([...reach, "finance.visibility.consolidated"]), inertScoped: scoped("self").inertScoped }, false), "FULL", "an unconditioned full key is additive, as Firebase's scope union");
  // Global controller (no visibility key) + a company-scoped salesperson: restricted at the company the salesperson Role is scoped to.
  assert.equal(mode({ capabilities: new Set([...reach, "finance.read"]), inertScoped: scoped("self").inertScoped }, false), "EMPTY");
});

test("the activation switch defaults to INACTIVE and nothing in src reads the environment for it", () => {
  assert.equal(v.FINANCE_SELF_TEAM_ACTIVE_DEFAULT, false);
  const src = strip(readFileSync(join(SRC, "eosFinance/financeVisibility.ts"), "utf8"));
  assert.doesNotMatch(src, /process\s*\.\s*env/, "no environment variable activates it");
  assert.equal(v.TEAM_MAX_DEPTH, 8);
});

test("a visibility clause names the FULL companies and the visible ids only (parameters, never interpolated)", () => {
  const vis = Object.freeze({ fullCompanies: ["taylor"], restrictedCompanies: ["ventana"], emptyCompanies: [], visibleReceivableIds: ["obl_1"], restricted: true });
  const params = ["tenant"];
  const sql = v.obligationVisibilityClause(vis, "o", params);
  assert.deepEqual(params, ["tenant", ["taylor"], ["obl_1"]]);
  assert.match(sql, /o\.operating_company_id = ANY\(\$2\) OR o\.id = ANY\(\$3\)/);
  assert.doesNotMatch(sql, /obl_1|taylor/, "values travel as parameters");
  const sp = ["tenant"];
  const ssql = v.settlementVisibilityClause(vis, "s", sp);
  assert.deepEqual(sp, ["tenant", ["taylor"], ["ventana"], ["obl_1"]]);
  assert.match(ssql, /EXISTS \(SELECT 1 FROM eos_finance\.settlement_applications/, "an unapplied settlement is hidden from a restricted reader");
  assert.match(ssql, /NOT EXISTS[\s\S]*NOT \(sa\.obligation_id = ANY\(\$4\)\)/, "every application ever recorded must be to a visible receivable");
  assert.doesNotMatch(ssql, /status\s*=\s*'APPLIED'/, "reversed applications count: 'every application ever recorded'");
});

test("migration: five keys, exactly the Firebase holders (15 grants), the credit trigger, a refusing down", () => {
  const up = MIGRATION.split("-- Down Migration")[0];
  for (const k of ["self", "team", "businessUnit", "company", "consolidated"]) assert.ok(up.includes(`'finance.visibility.${k}'`), k);
  const pairs = [...up.matchAll(/\('([A-Za-z]+)', 'finance\.visibility\.([A-Za-z]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(pairs, [
    "accountingManager:consolidated", "admin:businessUnit", "admin:company", "admin:consolidated", "admin:self", "admin:team",
    "financeManager:consolidated", "generalManager:consolidated",
    "owner:businessUnit", "owner:company", "owner:consolidated", "owner:self", "owner:team", "salesManager:team", "salesperson:self",
  ]);
  assert.equal(pairs.length, 15);
  assert.match(up, /CREATE TRIGGER sales_order_credit_immutable BEFORE UPDATE ON sales_orders/);
  assert.match(up, /SALES_ORDER_CREDIT_IMMUTABLE/);
  assert.doesNotMatch(up, /ALTER TABLE[^;]*obligations/i, "attribution is DERIVED, never persisted: the obligation is not altered");
  assert.match(MIGRATION, /-- Down Migration[\s\S]*RAISE EXCEPTION 'FINANCE_VISIBILITY: refuses to reverse/);
});

test("there is no finance search source and no export operation, and no Firebase in the finance read path (pinned)", () => {
  const myWork = readFileSync(join(SRC, "eosExperience/myWork.ts"), "utf8");
  const searchBlock = myWork.slice(myWork.indexOf("const SEARCH_KINDS"), myWork.indexOf("export async function searchEos"));
  assert.ok(searchBlock.length > 200, "found the search source list");
  assert.doesNotMatch(searchBlock, /eos_finance|obligation|settlement/i, "searchEos has no Finance source");
  for (const op of financeOps.FINANCE_OPERATIONS) assert.doesNotMatch(op, /export|csv|download|report/i, `${op}: no Finance export operation`);
  for (const f of ["eosFinance/financeVisibility.ts", "eosFinance/financeOperations.ts"]) {
    assert.doesNotMatch(strip(readFileSync(join(SRC, f), "utf8")), /firebase|firestore/i, `${f}: no Firebase`);
  }
});

test("every Finance projection routes through the ONE visibility module", () => {
  const ops = readFileSync(join(SRC, "eosFinance/financeOperations.ts"), "utf8");
  // The only SELECTs over obligations / settlements in the operations table are the visibility-scoped ones.
  assert.match(ops, /obligationVisibilityClause\(vis, "o", params\)/);
  assert.match(ops, /settlementVisibilityClause\(vis, "s", params\)/);
  const analysis = readFileSync(join(SRC, "eosAnalysis/analysis.ts"), "utf8");
  assert.match(analysis, /resolveFinanceVisibility\(/, "Analysis resolves the same inner reach");
  assert.match(analysis, /RESTRICTED_RECEIVABLE_MEASURES/);
});
