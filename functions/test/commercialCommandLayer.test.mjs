// WAVE C2, offline -- the governed PostgreSQL Commercial command layer's boundaries. The live-server proof of every
// command is functions/test/commercialCommandLayerPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FUNCTIONS_DIR, "src");
const COMMANDS = join(SRC, "eosCommercial", "commands");
const require = createRequire(import.meta.url);
const kernel = require("../lib/eosCommercial/commands/commercialCommandKernel.js");

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}
const commandSources = () => walk(COMMANDS, [".ts"]);
const rel = (f) => relative(FUNCTIONS_DIR, f).split("\\").join("/");

test("(42) no Firebase: no command module imports it, and loading every one resolves no Firebase module", () => {
  for (const file of commandSources()) {
    const code = strip(readFileSync(file, "utf8"));
    for (const forbidden of [/firebase/i, /firestore/i, /FieldValue/, /getFirestore/, /onCall\b/, /HttpsError/, /runTransaction/]) {
      assert.doesNotMatch(code, forbidden, `${rel(file)} reaches for ${forbidden}`);
    }
  }
  const sentinel = "C2_LOADED_FIREBASE";
  const preload = join(mkdtempSync(join(tmpdir(), "c2-")), "preload.cjs");
  writeFileSync(preload, `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.stderr.write("${sentinel}:"+r);process.exit(97);}return l.call(this,r,...a);};`);
  const modules = commandSources().map((f) => join(FUNCTIONS_DIR, "lib", relative(SRC, f)).replace(/\.ts$/, ".js"));
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", modules.map((m) => `require(${JSON.stringify(m)});`).join("")], { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.equal(probe.status, 0, `a C2 module transitively loaded Firebase: ${probe.stderr}`);
});

test("the only runtime entry point to the command layer is the C4 Commercial transport", () => {
  const importers = walk(SRC, [".ts"]).filter((f) => !f.startsWith(COMMANDS) && /eosCommercial\/commands\//.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers.map(rel), [], "a module outside the Commercial layer imports the command layer");
  const direct = walk(SRC, [".ts"]).filter((f) => !f.startsWith(join(SRC, "eosCommercial")) && /CommandService|commercialCommandKernel/.test(strip(readFileSync(f, "utf8"))));
  assert.deepEqual(direct.map(rel), [], "a runtime module reaches Commercial commands without the transport");
  for (const surface of ["index.ts", "eosOps/eosOpsHttp.ts", "adminPolicy/adminPolicyHttp.ts"]) {
    assert.doesNotMatch(strip(readFileSync(join(SRC, surface), "utf8")), /eosCommercial|CommandService|commercialCommandKernel/, `${surface} reaches Commercial commands`);
  }
  const server = strip(readFileSync(join(SRC, "eosApi", "server.ts"), "utf8"));
  assert.deepEqual([...server.matchAll(/from "([^"]*eosCommercial[^"]*)"/g)].map((m) => m[1]), ["../eosCommercial/commercialHttp"]);
});

test("(44) the identity-only spine writer cannot become a live Commercial create path", () => {
  const importers = [...walk(SRC, [".ts"]), ...walk(join(FUNCTIONS_DIR, "scripts"), [".js", ".mjs", ".cjs"])]
    .filter((f) => /\bcreateCommercialRecord\b/.test(strip(readFileSync(f, "utf8"))))
    .map(rel).sort();
  // THE ALLOWLIST IS TWO BOUNDED NONPROD SEEDS AND THE DEFINITION, and nothing else. Both seeds are
  // fenced to EOS_ENVIRONMENT=nonprod + platform-sandbox before `pg` resolves, refuse production twice
  // over, and refuse the Certification world by name; neither is reachable from any transport, callable
  // or client. scripts/seedSampleCompany.js is the Sample Company v2 orchestrator, which supersedes
  // scripts/seedSyntheticNonprodWorkforce.js as a superset rather than replacing it.
  assert.deepEqual(importers,
    ["scripts/seedSampleCompany.js", "scripts/seedSyntheticNonprodWorkforce.js", "src/eosCommercial/commercialOwnershipRepository.ts"],
    "createCommercialRecord gained a caller other than its definition and the two bounded synthetic nonprod seeds");
  for (const file of commandSources()) assert.doesNotMatch(strip(readFileSync(file, "utf8")), /createCommercialRecord/, `${rel(file)} uses the spine writer`);
  // A governed command refuses to drive a record that did not come through one.
  for (const service of ["opportunityCommandService.ts", "salesAgreementCommandService.ts"]) {
    assert.match(readFileSync(join(COMMANDS, service), "utf8"), /RECORD_INCOMPLETE/);
  }
});

test("(45) no Commercial capability is activated", () => {
  const catalog = readFileSync(join(SRC, "access", "permissionCatalog.ts"), "utf8");
  for (const id of Object.values(kernel.COMMERCIAL_CAPABILITIES)) {
    const at = catalog.indexOf(`id: "${id}"`);
    assert.ok(at > 0, `${id} is not registered`);
    assert.match(catalog.slice(at, catalog.indexOf("}", at)), /active:\s*false/, `${id} became active`);
  }
  // C4 registers the VOCABULARY (migration 023) and nothing else may name a Commercial capability in SQL; no migration grants one.
  // REGISTERED OR GRANTED -- not merely NAMED. Migration 1761350400000's canonical Object <- action
  // backfill names every capability by its own key, which is the opposite of prefix inference and
  // must not read as a registration. The scan therefore looks only inside statements that INSERT a
  // capability or touch a grant table.
  const registersOrGrants = (sql) => sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .filter((stmt) => /INSERT\s+INTO\s+capabilities|role_capabilities/i.test(stmt))
    .some((stmt) => /'(opportunity|salesAgreement|salesOrder)\.[A-Za-z]+'/.test(stmt));
  const naming = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"))
    .filter((f) => registersOrGrants(readFileSync(join(FUNCTIONS_DIR, "migrations", f), "utf8")));
  assert.deepEqual(naming, ["1759536000000_commercial-capability-vocabulary.sql"], "a Commercial capability was registered or granted outside migration 023");
  assert.ok(registersOrGrants(readFileSync(join(FUNCTIONS_DIR, "migrations", "1759536000000_commercial-capability-vocabulary.sql"), "utf8")),
    "the scan stopped recognising migration 023 and would now pass for the wrong reason");
  assert.doesNotMatch(readFileSync(join(FUNCTIONS_DIR, "migrations", naming[0]), "utf8").split("-- Down Migration")[0].replace(/^\s*--.*$/gm, ""), /role_capabilities/, "migration 023 grants a Commercial capability");
});

test("(31) no D2 execution write: the layer names no execution field or integration", () => {
  for (const file of commandSources()) {
    const code = strip(readFileSync(file, "utf8"));
    for (const forbidden of [/allocated_?qty/i, /fulfilled_?qty/i, /billed_?qty/i, /service_?work_?order/i, /allocateSalesOrder/, /createServiceForSalesOrder/, /invoice/i, /inventory/i, /work_orders|workOrder/]) {
      assert.doesNotMatch(code, forbidden, `${rel(file)} reaches D2 execution: ${forbidden}`);
    }
  }
});

test("the accountability policy is the fixed V1 ruling, and no command accepts a policy", () => {
  assert.deepEqual(kernel.COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1, { policyId: "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", eligibleStatuses: ["ACTIVE", "CONTRACTOR"] });
  assert.ok(Object.isFrozen(kernel.COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1) && Object.isFrozen(kernel.COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1.eligibleStatuses));
  for (const file of commandSources()) assert.doesNotMatch(strip(readFileSync(file, "utf8")), /input\.eligibilityPolicy|input\?\.eligibilityPolicy/);
  // Persistence of the accountable person goes only through the #1905 writer.
  for (const file of commandSources()) assert.doesNotMatch(strip(readFileSync(file, "utf8")), /accountable_employee_id\s*=/, `${rel(file)} writes the accountable person directly`);
});

test("capability, context and idempotency-key refusals happen before any database connection", async () => {
  const pool = { connect: () => { throw new Error("the command touched the database before refusing"); } };
  const deps = { pool };
  const actor = { tenantId: "t1", principalId: "p1", capabilities: new Set(["opportunity.write"]) };
  const refuse = (promise, code) => assert.rejects(promise, (e) => e.code === code);
  await refuse(kernel.runCommercialCommand(deps, { ...actor, capabilities: new Set() }, "opportunity.create", ["opportunity.write"], "k", async () => ({})), "CAPABILITY_REQUIRED");
  await refuse(kernel.runCommercialCommand(deps, { ...actor, principalId: "" }, "opportunity.create", ["opportunity.write"], "k", async () => ({})), "ACTOR_CONTEXT_REQUIRED");
  await refuse(kernel.runCommercialCommand(deps, { ...actor, capabilities: ["opportunity.write"] }, "opportunity.create", ["opportunity.write"], "k", async () => ({})), "ACTOR_CONTEXT_REQUIRED");
  await refuse(kernel.runCommercialCommand(deps, actor, "opportunity.create", ["opportunity.write"], "", async () => ({})), "IDEMPOTENCY_KEY_REQUIRED");
});

test("errors are deterministic and never leak SQL, driver or connection detail", () => {
  const unknown = kernel.translateCommercialError(Object.assign(new Error('insert into "eos_commercial"."x" failed at postgres://u:secret@h/db'), { code: "XX000" }));
  assert.deepEqual([unknown.code, unknown.category, unknown.message], ["COMMAND_FAILED", "FAILED", "the command could not be completed"]);
  const fk = kernel.translateCommercialError(Object.assign(new Error("violates foreign key constraint opportunities_account_fk"), { code: "23503", constraint: "opportunities_account_fk" }));
  assert.deepEqual([fk.code, fk.category], ["ACCOUNT_NOT_FOUND", "NOT_FOUND"]);
  assert.doesNotMatch(fk.message, /violates|constraint/);
  const serialization = kernel.translateCommercialError({ code: "40001", message: "could not serialize access" });
  assert.equal(serialization.code, "CONCURRENT_MODIFICATION");
  const governed = kernel.translateCommercialError(Object.assign(new Error("Only a single forward stage advance is permitted"), { name: "OpportunityCommandError", code: "ILLEGAL_TRANSITION" }));
  assert.deepEqual([governed.code, governed.category], ["ILLEGAL_TRANSITION", "PRECONDITION_FAILED"]);
});

test("the receipt stores only a key hash and a committed result -- it is not an audit log", () => {
  const code = strip(readFileSync(join(COMMANDS, "commercialCommandKernel.ts"), "utf8"));
  assert.match(code, /createHash\("sha256"\)/);
  assert.match(code, /INSERT INTO eos_commercial\.command_receipts/);
  assert.doesNotMatch(code, /audit_events|appendAudit|actor_uid|before|after/i, "the receipt grew audit semantics");
  assert.match(code, /pg_advisory_xact_lock/, "concurrent first executions are serialized in PostgreSQL");
});

test("a pool that cannot connect yields only the governed error: no driver message, no connection string, no release", async () => {
  const leaks = [
    Object.assign(new Error("connect ECONNREFUSED 10.0.0.7:5432 for postgres://eos_app:S3cr3t-P4ss@db.internal:5432/eos_policy"), { code: "ECONNREFUSED", address: "10.0.0.7" }),
    Object.assign(new Error('password authentication failed for user "eos_app"'), { code: "28P01", severity: "FATAL" }),
    Object.assign(new Error("timeout exceeded when trying to connect"), { name: "Error" }),
  ];
  for (const raw of leaks) {
    let released = false;
    const pool = { connect: async () => { throw raw; }, release: () => { released = true; } };
    const actor = { tenantId: "t1", principalId: "p1", capabilities: new Set(["opportunity.write"]) };
    const err = await kernel.runCommercialCommand({ pool }, actor, "opportunity.create", ["opportunity.write"], "k-1", async () => {
      throw new Error("the body ran without a connection");
    }).then(() => null, (e) => e);
    assert.ok(err, "a failed connection resolved");
    assert.equal(err.name, "CommercialCommandError");
    assert.deepEqual([err.code, err.category, err.message], ["COMMAND_FAILED", "FAILED", "the command could not be completed"]);
    assert.doesNotMatch(`${err.message}\n${err.stack}\n${JSON.stringify(err)}`, /postgres:\/\/|S3cr3t|eos_app|ECONNREFUSED|10\.0\.0\.7|password|timeout exceeded/);
    assert.equal(released, false);
  }
});

test("the catalog authority must return exactly one governed verdict per reference, or the command refuses", async () => {
  const lines = [{ kind: "PART", ref: "p-1" }, { kind: "SERVICE", ref: "s-1" }, { kind: "EQUIPMENT_MODEL", ref: "m-1" }];
  const run = (verifyReferences) => kernel.requireCatalogReferences({ pool: {}, catalog: { verifyReferences } }, {}, "t1", lines);
  const contract = (e) => e.code === "CATALOG_AUTHORITY_CONTRACT_VIOLATION" && e.category === "UNAVAILABLE";
  let asked;
  await run(async (_d, _t, refs) => { asked = refs; return refs.map(() => "FOUND"); });
  assert.deepEqual(asked, [{ kind: "PART", ref: "p-1" }, { kind: "EQUIPMENT_MODEL", ref: "m-1" }], "SERVICE lines were sent to the catalog");
  await assert.rejects(run(async () => ["FOUND"]), contract, "too few verdicts read as FOUND");
  await assert.rejects(run(async () => ["FOUND", "FOUND", "FOUND"]), contract, "too many verdicts were accepted");
  await assert.rejects(run(async () => ["FOUND", "PROBABLY"]), contract, "an unknown verdict was accepted");
  await assert.rejects(run(async () => "FOUND"), contract, "a non-array answer was accepted");
  await assert.rejects(run(async () => [undefined, undefined]), contract);
  await assert.rejects(run(async () => ["FOUND", "NOT_FOUND"]), (e) => e.code === "REFERENCE_NOT_FOUND");
  await assert.rejects(kernel.requireCatalogReferences({ pool: {} }, {}, "t1", lines), (e) => e.code === "CATALOG_AUTHORITY_UNAVAILABLE");
  await kernel.requireCatalogReferences({ pool: {} }, {}, "t1", [{ kind: "SERVICE", ref: "s-1" }]);
});

test("every command that accepts new product lines consults the catalog before writing; Agreement-derived Orders do not", () => {
  const src = (f) => strip(readFileSync(join(COMMANDS, f), "utf8"));
  const opportunity = src("opportunityCommandService.ts");
  const createBody = opportunity.slice(opportunity.indexOf("export function createOpportunity"), opportunity.indexOf("export function updateOpportunity"));
  assert.ok(createBody.indexOf("requireCatalogReferences(") > 0 && createBody.indexOf("requireCatalogReferences(") < createBody.indexOf("allocateCommercialNumber("), "Opportunity create allocates before the catalog check");
  const updateBody = opportunity.slice(opportunity.indexOf("export function updateOpportunity"), opportunity.indexOf("export function transitionOpportunity"));
  assert.ok(updateBody.indexOf("requireCatalogReferences(") > 0 && updateBody.indexOf("requireCatalogReferences(") < updateBody.indexOf("UPDATE eos_commercial.opportunities"), "line replacement writes before the catalog check");
  const order = src("salesOrderCommandService.ts");
  const directBody = order.slice(order.indexOf("export function createSalesOrder("), order.indexOf("export function createSalesOrderFromOpportunity"));
  assert.ok(directBody.indexOf("requireCatalogReferences(") > 0 && directBody.indexOf("requireCatalogReferences(") < directBody.indexOf("stageBuiltSalesOrder("), "direct Order create allocates before the catalog check");
  const derived = order.slice(order.indexOf("export async function stageSalesOrderFromAgreement"), order.indexOf("async function stageBuiltSalesOrder"));
  assert.doesNotMatch(derived, /requireCatalogReferences/, "an ACCEPTED Agreement's committed references are re-decided");
  const agreement = src("salesAgreementCommandService.ts");
  assert.equal((agreement.match(/requireCatalogReferences\(/g) ?? []).length, 3, "Agreement create, draft update and accept each keep their check");
});

test("closed_at comes from the command's governed clock, not a second wall-clock read", () => {
  const opportunity = strip(readFileSync(join(COMMANDS, "opportunityCommandService.ts"), "utf8"));
  const apply = opportunity.slice(opportunity.indexOf("async function applyOpportunityTransition"));
  assert.doesNotMatch(apply.slice(0, apply.indexOf("\n}\n")), /new Date\(|Date\.now\(|now\(\)\s*[,)]/, "applyOpportunityTransition reads the wall clock");
  for (const file of commandSources()) {
    if (file.endsWith("commercialCommandKernel.ts")) continue;
    assert.doesNotMatch(strip(readFileSync(file, "utf8")), /new Date\(\)|Date\.now\(\)/, `${rel(file)} reads the wall clock instead of the command's now`);
  }
});
