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

test("no runtime entry point reaches the command layer: only the layer itself imports it", () => {
  const importers = walk(SRC, [".ts"]).filter((f) => !f.startsWith(COMMANDS) && /eosCommercial\/commands\//.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers.map(rel), [], "a module outside the C2 command layer imports it");
  for (const surface of ["index.ts", "eosApi/server.ts", "eosOps/eosOpsHttp.ts", "adminPolicy/adminPolicyHttp.ts"]) {
    assert.doesNotMatch(strip(readFileSync(join(SRC, surface), "utf8")), /eosCommercial|CommandService|commercialCommandKernel/, `${surface} reaches Commercial commands`);
  }
});

test("(44) the identity-only spine writer cannot become a live Commercial create path", () => {
  const importers = [...walk(SRC, [".ts"]), ...walk(join(FUNCTIONS_DIR, "scripts"), [".js", ".mjs", ".cjs"])]
    .filter((f) => /\bcreateCommercialRecord\b/.test(strip(readFileSync(f, "utf8"))))
    .map(rel).sort();
  assert.deepEqual(importers, ["scripts/seedSyntheticNonprodWorkforce.js", "src/eosCommercial/commercialOwnershipRepository.ts"],
    "createCommercialRecord gained a caller other than its definition and the bounded synthetic nonprod seed");
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
  const migrations = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(FUNCTIONS_DIR, "migrations", f), "utf8"));
  assert.ok(!migrations.some((sql) => /'(opportunity|salesAgreement|salesOrder)\.[A-Za-z]+'/.test(sql.replace(/^\s*--.*$/gm, ""))), "a Commercial capability was registered in eos_policy");
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
