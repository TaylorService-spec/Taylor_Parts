// WAVE C1, offline -- the schema's vocabularies mirror the governed modules, numbering matches today's visible
// formats without depending on Firestore, and nothing is wired, activated or exposed. The live-server proof is
// functions/test/commercialSchemaParityPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const SRC = join(FUNCTIONS_DIR, "src");
const require = createRequire(import.meta.url);
const MIGRATION = join(FUNCTIONS_DIR, "migrations", "1759449600000_commercial-schema-parity-numbering-receipts.sql");
const NUMBERING_SOURCE = join(SRC, "eosCommercial", "commercialNumbering.ts");
const numbering = require("../lib/eosCommercial/commercialNumbering.js");

const up = () => readFileSync(MIGRATION, "utf8").split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
const enumValues = (name) => {
  const m = up().match(new RegExp(`CREATE TYPE ${name} AS ENUM \\(([^)]*)\\)`));
  assert.ok(m, `enum ${name} is missing`);
  return m[1].match(/'([A-Z_]+)'/g).map((v) => v.slice(1, -1));
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function walk(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

test("every schema vocabulary mirrors its governed lifecycle module exactly", () => {
  const opp = require("../lib/opportunity/opportunityLifecycle.js");
  const sa = require("../lib/salesAgreement/salesAgreementLifecycle.js");
  const so = require("../lib/salesOrder/salesOrderLifecycle.js");
  const fin = require("../lib/finance/financialAttribution.js");
  assert.deepEqual(enumValues("opportunity_stage"), [...opp.OPPORTUNITY_STAGES]);
  assert.deepEqual(enumValues("opportunity_outcome"), [...opp.OPPORTUNITY_OUTCOMES]);
  assert.deepEqual(enumValues("commercial_sales_channel"), [...opp.SALES_CHANNELS]);
  assert.deepEqual(enumValues("commercial_sales_channel"), [...so.SALES_CHANNELS]);
  for (const kinds of [opp.OPPORTUNITY_LINE_KINDS, sa.SALES_AGREEMENT_LINE_KINDS, so.SALES_ORDER_LINE_KINDS]) {
    assert.deepEqual(enumValues("commercial_line_kind"), [...kinds]);
  }
  assert.deepEqual(enumValues("sales_agreement_state"), [...sa.SALES_AGREEMENT_STATES]);
  assert.deepEqual(enumValues("agreement_fulfillment_intent"), [...sa.FULFILLMENT_INTENTS]);
  assert.deepEqual(enumValues("agreement_line_condition"), [...sa.AGREEMENT_LINE_CONDITIONS]);
  assert.deepEqual(enumValues("sales_order_state"), [...so.SALES_ORDER_STATES]);
  assert.deepEqual(enumValues("commercial_business_unit"), [...fin.BUSINESS_UNITS]);
  assert.deepEqual(enumValues("commercial_number_series"), [...numbering.COMMERCIAL_NUMBER_SERIES]);
});

test("(9) PostgreSQL numbers are byte-identical to today's Firestore formatters, and UTC-year scoped", () => {
  const { formatOpportunityNumber } = require("../lib/opportunity/opportunityNumbering.js");
  const { formatSalesAgreementNumber } = require("../lib/salesAgreement/salesAgreementNumbering.js");
  const { formatSalesOrderNumber } = require("../lib/salesOrder/salesOrderNumbering.js");
  for (const [year, seq] of [[2026, 1], [2026, 42], [2027, 999999], [2027, 1000000]]) {
    assert.equal(numbering.formatCommercialNumber("OPPORTUNITY", year, seq), formatOpportunityNumber(year, seq));
    assert.equal(numbering.formatCommercialNumber("SALES_AGREEMENT", year, seq), formatSalesAgreementNumber(year, seq));
    assert.equal(numbering.formatCommercialNumber("SALES_ORDER", year, seq), formatSalesOrderNumber(year, seq));
  }
  assert.equal(numbering.commercialNumberYear(new Date("2026-12-31T23:59:59.999Z")), 2026);
  assert.equal(numbering.commercialNumberYear(new Date("2027-01-01T00:00:00.000Z")), 2027);
  assert.throws(() => numbering.formatCommercialNumber("INVOICE", 2026, 1), /unknown commercial number series/);
  assert.throws(() => numbering.formatCommercialNumber("OPPORTUNITY", 2026, 0), /positive/);
});

test("(17) the numbering module has no Firestore counter dependency and allocates with one atomic statement", () => {
  const src = readFileSync(NUMBERING_SOURCE, "utf8");
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["pg"]);
  const code = strip(src);
  for (const forbidden of [/firebase/i, /firestore/i, /COUNTERS_COLLECTION/, /counters\//, /SELECT\s+MAX/i, /randomUUID/]) {
    assert.doesNotMatch(code, forbidden);
  }
  assert.match(code, /ON CONFLICT \(tenant_id, series, year\)\s+DO UPDATE SET last_value = eos_commercial\.number_counters\.last_value \+ 1/);
});

test("(18) no runtime module imports the C1 numbering module yet", () => {
  // Only the unwired C2 command layer allocates numbers; commercialCommandLayer.test.mjs proves no runtime entry point reaches it.
  // MEASURE IMPORTS, NOT MENTIONS. A bare /commercialNumbering/ search matched a COMMENT -- the Work
  // Order allocator's header says it "Mirrors eosCommercial/commercialNumbering.ts exactly", which is a
  // citation, not a call. This ratchet exists to catch a module that ALLOCATES commercial numbers, and a
  // probe that fires on prose gets relaxed by whoever trips it next.
  const IMPORTS_NUMBERING = /(?:from|import|require)\s*\(?\s*["'][^"']*commercialNumbering(?:\.js)?["']/;
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const reaching = walk(SRC, ".ts")
    .filter((f) => f !== NUMBERING_SOURCE && IMPORTS_NUMBERING.test(strip(readFileSync(f, "utf8"))))
    .map((f) => relative(FUNCTIONS_DIR, f));
  // NON-VACUITY: the probe must still detect a real import, and must ignore a mention.
  assert.equal(IMPORTS_NUMBERING.test('import { allocateCommercialNumber } from "../commercialNumbering.js";'), true);
  assert.equal(IMPORTS_NUMBERING.test("// mirrors eosCommercial/commercialNumbering.ts exactly"), false);
  // Commercial C5 verify is the one sanctioned outside reader: a PROBE allocation inside a transaction that is always rolled
  // back, in an operator-only module no runtime entry point reaches (commercialC5Migration.test.mjs STRUCTURAL).
  const C5_VERIFY_PROBE = "src/commercialMigration/commercialC5Target.ts";
  assert.ok(reaching.every((f) => f.startsWith("src/eosCommercial/commands/") || f === C5_VERIFY_PROBE), `a module outside the C2 command layer allocates numbers: ${reaching}`);
  assert.doesNotMatch(readFileSync(join(SRC, "index.ts"), "utf8"), /commercialNumbering|eosCommercial\//);
});

test("(19) every Commercial capability is still registered inactive", () => {
  const catalog = readFileSync(join(SRC, "access", "permissionCatalog.ts"), "utf8");
  const ids = ["opportunity.write", "opportunity.createSalesOrder", "opportunity.read", "salesAgreement.create", "salesAgreement.updateDraft",
    "salesAgreement.accept", "salesAgreement.read", "salesOrder.write", "salesOrder.fulfill", "salesOrder.service"];
  for (const id of ids) {
    const at = catalog.indexOf(`id: "${id}"`);
    assert.ok(at > 0, `${id} is no longer registered`);
    const entry = catalog.slice(at, catalog.indexOf("}", at));
    assert.match(entry, /active:\s*false/, `${id} became active`);
  }
});

test("(20) the Render Commercial surface is only the separate C4 transport, never an Administration or Operations operation", () => {
  for (const file of [join(SRC, "eosOps", "eosOpsHttp.ts"), join(SRC, "adminPolicy", "adminPolicyHttp.ts")]) {
    assert.doesNotMatch(strip(readFileSync(file, "utf8")), /commercial|opportunit|salesAgreement|salesOrder/i, `${relative(FUNCTIONS_DIR, file)} gained a Commercial surface`);
  }
  const server = strip(readFileSync(join(SRC, "eosApi", "server.ts"), "utf8"));
  assert.doesNotMatch(server, /opportunit|salesAgreement|salesOrder|commercialNumbering/i, "server.ts names Commercial business directly");
  assert.match(server, /from "\.\.\/eosCommercial\/commercialHttp"/);
});

test("the migration is additive, keeps Job Role out, and adds no Employee foreign key", () => {
  const sql = up();
  for (const forbidden of [/DROP\s/i, /ALTER COLUMN/i, /RENAME/i, /DELETE\s/i, /UPDATE\s+eos_/i, /DISABLE TRIGGER/i, /job_role/i, /eos_workforce/i]) {
    assert.doesNotMatch(sql, forbidden);
  }
  assert.equal((sql.match(/REFERENCES eos_crm\.accounts \(tenant_id, id\) NOT VALID/g) ?? []).length, 3, "the Account key must be NOT VALID on all three tables");
  assert.doesNotMatch(sql, /ADD COLUMN [a-z_]+\s+[A-Za-z_]+[^,;]*NOT NULL(?! DEFAULT 1)/, "a new business column was made NOT NULL for rows that never had it");
  assert.doesNotMatch(sql, /\b(allocated_qty|fulfilled_qty|billed_qty|fulfillment_readiness|service_work_order_ids|allocated_at)\b/, "a D2 execution field was added");
});

test("(21) the deferred Employee FK stays deferred and (23) blocker #3 stays open", () => {
  assert.ok(readdirSync(join(FUNCTIONS_DIR, "migrations", "deferred")).some((f) => f.includes("employee-principal-link-employee-fk")));
  const callables = strip(readFileSync(join(SRC, "opportunity", "opportunityCallables.ts"), "utf8"));
  assert.ok(!callables.includes("OWNERSHIP_HANDOFF") && !callables.includes("stageOwnershipHandoff"), "updateOpportunity gained a handoff");
  assert.doesNotMatch(readFileSync(join(REPO_ROOT, "firestore.rules"), "utf8"), /number_counters|command_receipts/);
});

// EMP-RT-08 (Owner ruling 2026-09-16) now defines the Job Role authority -- in its OWN migration, as an Employee business
// function in eos_workforce. The commercial schema must still never carry a Job Role: no commercial table, column or
// mapping keys on one (Retail / National Accounts Sales are Job Roles, never record ownership or permission).
test("(22) Job Role authority lives only in the EMP-RT-08 Workforce migration; no commercial or other table carries a Job Role", () => {
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"));
  const sql = (f) => readFileSync(join(FUNCTIONS_DIR, "migrations", f), "utf8").replace(/^\s*--.*$/gm, "");
  const defining = files.filter((f) => /CREATE TABLE[^(]*job_role|ADD COLUMN\s+job_role/i.test(sql(f)));
  assert.deepEqual(defining, ["1760011200000_employee-job-role-authority.sql"]);
  for (const f of files.filter((f) => !defining.includes(f))) assert.doesNotMatch(sql(f), /job_role/i, f);
  assert.doesNotMatch(sql(defining[0]), /eos_commercial|eos_crm|owner_employee_id|accountab|user_role_assignments/i);
});
