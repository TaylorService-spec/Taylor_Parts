// WAVE D1-A, offline -- the governed PostgreSQL CRM authority layer's boundaries. The live-server proof is
// functions/test/crmAuthorityPostgres.test.mjs.
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
const CRM = join(SRC, "eosCrm");
const require = createRequire(import.meta.url);
const kernel = require("../lib/eosCrm/crmAuthorityKernel.js");
const accounts = require("../lib/eosCrm/accountAuthority.js");
const contacts = require("../lib/eosCrm/contactAuthority.js");
const sites = require("../lib/eosCrm/accountLocationAuthority.js");

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
const crmSources = () => walk(CRM, [".ts"]);
const rel = (f) => relative(FUNCTIONS_DIR, f).split("\\").join("/");
const MIGRATION_024 = "1759622400000_crm-capability-vocabulary.sql";

/** A pool that must never be reached: every refusal below happens before a connection is taken. */
const unreachablePool = { connect: async () => { throw new Error("the database was reached"); } };
const deps = { pool: unreachablePool };
const ALL = new Set(["customer.record.read", "customer.record.create", "customer.record.update"]);
const actor = (capabilities = ALL) => ({ tenantId: "t1", principalId: "p1", capabilities });
const code = (c) => (e) => {
  assert.equal(e.name, "CrmAuthorityError");
  assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`);
  return true;
};

test("(F1) no Firebase: no CRM authority module names it, and loading every one resolves no Firebase module", () => {
  for (const file of crmSources()) {
    const src = strip(readFileSync(file, "utf8"));
    for (const forbidden of [/firebase/i, /firestore/i, /FieldValue/, /getFirestore/, /onCall\b/, /HttpsError/, /runTransaction/, /\bcollection\(/]) {
      assert.doesNotMatch(src, forbidden, `${rel(file)} reaches for ${forbidden}`);
    }
  }
  const sentinel = "D1A_LOADED_FIREBASE";
  const preload = join(mkdtempSync(join(tmpdir(), "d1a-")), "preload.cjs");
  writeFileSync(preload, `const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase/i.test(r)){process.stderr.write("${sentinel}:"+r);process.exit(97);}return l.call(this,r,...a);};`);
  const modules = crmSources().map((f) => join(FUNCTIONS_DIR, "lib", relative(SRC, f)).replace(/\.ts$/, ".js"));
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", modules.map((m) => `require(${JSON.stringify(m)});`).join("")], { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.equal(probe.status, 0, `a D1-A module transitively loaded Firebase: ${probe.stderr}`);
});

test("(F2) not wired: nothing outside src/eosCrm imports it, and no runtime surface or client names it", () => {
  const importers = walk(SRC, [".ts"]).filter((f) => !f.startsWith(CRM) && /eosCrm\//.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers.map(rel), [], "a module outside the CRM authority layer imports it");
  for (const surface of ["index.ts", "eosApi/server.ts", "eosOps/eosOpsHttp.ts", "adminPolicy/adminPolicyHttp.ts"]) {
    assert.doesNotMatch(strip(readFileSync(join(SRC, surface), "utf8")), /eosCrm|crmAuthorityKernel|accountAuthority|contactAuthority|accountLocationAuthority/, `${surface} reaches the CRM authority layer`);
  }
  const client = walk(join(FUNCTIONS_DIR, "..", "field-ops-app-vite", "src"), [".js", ".jsx", ".ts", ".tsx"]);
  assert.ok(!client.some((f) => /eosCrm|crmAuthorityKernel/.test(readFileSync(f, "utf8"))), "the client references the CRM authority layer");
});

test("(F3) capabilities: exactly the three catalogued Customer ids, none invented, none activated or changed", () => {
  const catalog = readFileSync(join(SRC, "access", "permissionCatalog.ts"), "utf8");
  const used = new Set(crmSources().flatMap((f) => [...strip(readFileSync(f, "utf8")).matchAll(/"([a-z][A-Za-z]*\.[a-z][A-Za-z]*\.[a-z][A-Za-z]*)"/g)].map((m) => m[1])));
  assert.deepEqual([...used].sort(), ["customer.record.create", "customer.record.read", "customer.record.update"]);
  for (const id of used) assert.ok(catalog.includes(`id: "${id}"`), `${id} is not in the permission catalog`);
  assert.deepEqual({ ...kernel.CRM_CAPABILITIES }, { CUSTOMER_RECORD_READ: "customer.record.read", CUSTOMER_RECORD_CREATE: "customer.record.create", CUSTOMER_RECORD_UPDATE: "customer.record.update" });
  // CRM_AUTHORITY_GAP, pinned: Contacts and customer sites carry no capability of their own and use the parent's per verb.
  assert.deepEqual({ ...contacts.CRM_CHILD_RECORD_CAPABILITIES }, { READ: "customer.record.read", CREATE: "customer.record.create", UPDATE: "customer.record.update" });
  assert.doesNotMatch(catalog, /id: "(crm\.contact|crm\.location|contact\.record|location\.record)\./, "a Contact/Location capability now exists; retire the child-record gap mapping");
});

test("(F4) migration 024 registers exactly that vocabulary, grants nothing, and does not depend on 023", () => {
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"));
  assert.ok(files.includes(MIGRATION_024));
  const sql = readFileSync(join(FUNCTIONS_DIR, "migrations", MIGRATION_024), "utf8");
  const up = sql.split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
  assert.deepEqual([...up.matchAll(/'([a-z]+\.[a-z]+\.[a-z]+)'/gi)].map((m) => m[1]).sort(), ["customer.record.create", "customer.record.read", "customer.record.update"]);
  assert.doesNotMatch(up, /role_capabilities|role_object_permissions|user_role_assignments/, "migration 024 grants a capability");
  assert.doesNotMatch(up, /opportunity|salesAgreement|salesOrder|eos_commercial|eos_crm/i, "migration 024 reaches beyond CRM vocabulary");
  const naming = files.filter((f) => /'customer\.record\.[a-z]+'/.test(readFileSync(join(FUNCTIONS_DIR, "migrations", f), "utf8").replace(/^\s*--.*$/gm, "")));
  assert.deepEqual(naming, [MIGRATION_024], "a Customer capability was registered or granted outside migration 024");
});

test("(F5) no generic CRUD, no delete, no legacy or Job Role authority source", () => {
  assert.deepEqual(Object.keys(accounts).filter((k) => typeof accounts[k] === "function").sort(), ["createAccount", "getAccount", "listAccounts", "updateAccount"]);
  assert.deepEqual(Object.keys(contacts).filter((k) => typeof contacts[k] === "function").sort(), ["createContact", "getContact", "listAccountContacts", "updateContact"]);
  assert.deepEqual(Object.keys(sites).filter((k) => typeof sites[k] === "function").sort(), ["createAccountLocation", "getAccountLocation", "listAccountLocations", "updateAccountLocation"]);
  for (const file of crmSources()) {
    const src = strip(readFileSync(file, "utf8"));
    assert.doesNotMatch(src, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bupsert\b|ON CONFLICT/i, `${rel(file)} has a delete/upsert path`);
    assert.doesNotMatch(src, /users\/|customClaims|custom_claims|\brequest\.auth\b|job_role|employee_roles|role_object_permissions|user_role_assignments/, `${rel(file)} consults a forbidden authority source`);
    // The only mentions of securityRole / jobRole are the REFUSAL list itself.
    if (!file.endsWith("crmAuthorityKernel.ts")) assert.doesNotMatch(src, /securityRole|jobRole/, `${rel(file)} reads a role field`);
  }
});

test("(F6) every eos_crm statement is tenant-predicated", () => {
  for (const file of crmSources()) {
    const src = strip(readFileSync(file, "utf8"));
    const statements = [...src.matchAll(/`([^`]*eos_crm\.[^`]*)`/g)].map((m) => m[1]);
    for (const s of statements) {
      if (/^\s*INSERT/i.test(s)) assert.match(s, /\(id, tenant_id,/, `${rel(file)} INSERT without tenant_id: ${s}`);
      else assert.match(s, /WHERE tenant_id = \$1/, `${rel(file)} statement without a tenant predicate: ${s}`);
    }
    if (file.endsWith("Authority.ts")) assert.ok(statements.length > 0, `${rel(file)} has no eos_crm statement`);
  }
});

test("(F7) no write without the capability, and a read capability never stands in for a write one", async () => {
  const readOnly = actor(new Set(["customer.record.read"]));
  await assert.rejects(accounts.createAccount(deps, readOnly, { name: "A", status: "ACTIVE" }), code("CAPABILITY_REQUIRED"));
  await assert.rejects(accounts.updateAccount(deps, readOnly, { accountId: "a1", name: "B" }), code("CAPABILITY_REQUIRED"));
  await assert.rejects(contacts.createContact(deps, readOnly, { accountId: "a1", name: "C" }), code("CAPABILITY_REQUIRED"));
  await assert.rejects(contacts.updateContact(deps, readOnly, { contactId: "c1", name: "C" }), code("CAPABILITY_REQUIRED"));
  await assert.rejects(sites.createAccountLocation(deps, readOnly, { accountId: "a1", name: "S" }), code("CAPABILITY_REQUIRED"));
  await assert.rejects(sites.updateAccountLocation(deps, readOnly, { accountLocationId: "s1", name: "S" }), code("CAPABILITY_REQUIRED"));
  const none = actor(new Set(["ADMIN", "admin", "dispatcher", "jobRole:SALES", "customer.governedField.write", "report.customer.read"]));
  await assert.rejects(accounts.getAccount(deps, none, { accountId: "a1" }), code("CAPABILITY_REQUIRED"));
  await assert.rejects(accounts.listAccounts(deps, none, {}), code("CAPABILITY_REQUIRED"));
  await assert.rejects(contacts.listAccountContacts(deps, none, { accountId: "a1" }), code("CAPABILITY_REQUIRED"));
  await assert.rejects(sites.getAccountLocation(deps, none, { accountLocationId: "s1" }), code("CAPABILITY_REQUIRED"));
  // Capabilities must be a resolved Set; an array of the right strings is not a resolved context.
  await assert.rejects(accounts.getAccount(deps, { tenantId: "t1", principalId: "p1", capabilities: [...ALL] }, { accountId: "a1" }), code("ACTOR_CONTEXT_REQUIRED"));
  await assert.rejects(accounts.getAccount(deps, { tenantId: "", principalId: "p1", capabilities: ALL }, { accountId: "a1" }), code("ACTOR_CONTEXT_REQUIRED"));
});

test("(F8) caller authority in input is refused on every operation", async () => {
  const ops = [
    [accounts.createAccount, { name: "A", status: "ACTIVE" }],
    [accounts.updateAccount, { accountId: "a1", name: "A" }],
    [accounts.getAccount, { accountId: "a1" }],
    [accounts.listAccounts, {}],
    [contacts.createContact, { accountId: "a1", name: "C" }],
    [contacts.updateContact, { contactId: "c1", name: "C" }],
    [contacts.getContact, { contactId: "c1" }],
    [contacts.listAccountContacts, { accountId: "a1" }],
    [sites.createAccountLocation, { accountId: "a1", name: "S" }],
    [sites.updateAccountLocation, { accountLocationId: "s1", name: "S" }],
    [sites.getAccountLocation, { accountLocationId: "s1" }],
    [sites.listAccountLocations, { accountId: "a1" }],
  ];
  assert.deepEqual([...kernel.CALLER_AUTHORITY_FIELDS].sort(), ["capabilities", "externalSubject", "identityProvider", "jobRole", "principalId", "roles", "securityRole", "tenantId", "uid"]);
  for (const [op, base] of ops) {
    for (const field of kernel.CALLER_AUTHORITY_FIELDS) {
      await assert.rejects(op(deps, actor(), { ...base, [field]: "x" }), code("CALLER_AUTHORITY_REFUSED"), `${op.name} accepted ${field}`);
    }
  }
});

test("(F9) updates are allowlisted: attribution, ownership, relinking and free-form fields refuse", async () => {
  for (const extra of ["ownerEmployeeId", "createdBy", "updatedBy", "createdAt", "updatedAt", "id", "nameLower", "paymentTerms", "notes", "tags", "billingAddress"]) {
    await assert.rejects(accounts.updateAccount(deps, actor(), { accountId: "a1", [extra]: "x" }), code("FIELD_NOT_ALLOWED"), `updateAccount accepted ${extra}`);
  }
  for (const extra of ["accountId", "ownerEmployeeId", "createdBy", "role"]) {
    await assert.rejects(contacts.updateContact(deps, actor(), { contactId: "c1", name: "C", [extra]: "x" }), code("FIELD_NOT_ALLOWED"), `updateContact accepted ${extra}`);
    await assert.rejects(sites.updateAccountLocation(deps, actor(), { accountLocationId: "s1", name: "S", [extra]: "x" }), code("FIELD_NOT_ALLOWED"), `updateAccountLocation accepted ${extra}`);
  }
  await assert.rejects(accounts.createAccount(deps, actor(), { name: "A", status: "ACTIVE", createdBy: "someone" }), code("FIELD_NOT_ALLOWED"));
  await assert.rejects(accounts.updateAccount(deps, actor(), { accountId: "a1" }), code("NO_CHANGES_REQUESTED"));
  await assert.rejects(accounts.updateAccount(deps, actor(), { accountId: "a1", status: "DELETED" }), code("STATUS_INVALID"));
  await assert.rejects(accounts.createAccount(deps, actor(), { name: "   ", status: "ACTIVE" }), code("NAME_REQUIRED"));
  await assert.rejects(accounts.createAccount(deps, actor(), { name: "A", status: "ACTIVE", ownerEmployeeId: "" }), code("OWNER_INVALID"));
  await assert.rejects(contacts.createContact(deps, actor(), { accountId: "a1", name: "C", isPrimary: "yes" }), code("FIELD_INVALID"));
  await assert.rejects(accounts.createAccount(deps, actor(), null), code("INPUT_INVALID"));
  await assert.rejects(accounts.createAccount(deps, actor(), [["name", "A"]]), code("INPUT_INVALID"));
});

test("(F10) a customer site refuses an inventory discriminator before anything else", async () => {
  for (const key of ["type", "locationType"]) {
    await assert.rejects(sites.createAccountLocation(deps, actor(), { accountId: "a1", name: "Main", [key]: "WAREHOUSE" }), code("INVENTORY_LOCATION_DISCRIMINATOR_REFUSED"));
    await assert.rejects(sites.updateAccountLocation(deps, actor(), { accountLocationId: "s1", [key]: "BIN" }), code("INVENTORY_LOCATION_DISCRIMINATOR_REFUSED"));
  }
});

test("(F11) reads are bounded and cursors cannot be forged into a different list", async () => {
  await assert.rejects(accounts.listAccounts(deps, actor(), { limit: 201 }), code("PAGE_SIZE_INVALID"));
  await assert.rejects(accounts.listAccounts(deps, actor(), { limit: 0 }), code("PAGE_SIZE_INVALID"));
  await assert.rejects(contacts.listAccountContacts(deps, actor(), { accountId: "a1", limit: 1e9 }), code("PAGE_SIZE_INVALID"));
  await assert.rejects(accounts.listAccounts(deps, actor(), { cursor: "not-a-cursor" }), code("CURSOR_INVALID"));
  const contactCursor = kernel.encodeCrmCursor("contact", { name: "a", id: "c1" });
  await assert.rejects(accounts.listAccounts(deps, actor(), { cursor: contactCursor }), code("CURSOR_INVALID"));
  await assert.rejects(accounts.listAccounts(deps, actor(), { status: ["ACTIVE", "GONE"] }), code("FILTER_INVALID"));
  assert.equal(kernel.MAX_CRM_PAGE_SIZE, 200);
  for (const file of crmSources().filter((f) => f.endsWith("Authority.ts"))) {
    const lists = [...strip(readFileSync(file, "utf8")).matchAll(/`(SELECT[^`]*ORDER BY[^`]*)`/g)].map((m) => m[1]);
    for (const s of lists) assert.match(s, /LIMIT \$\d+/, `${rel(file)} has an unbounded list: ${s}`);
  }
});

test("(F12) an infrastructure failure leaks nothing: no host, user, database or driver message", async () => {
  const secretPool = { connect: async () => { const e = new Error("connect ECONNREFUSED 10.9.8.7:5432 password authentication failed for user \"eos_secret\" database \"crm_prod\""); e.code = "28P01"; throw e; } };
  for (const [op, input] of [[accounts.getAccount, { accountId: "a1" }], [accounts.createAccount, { name: "A", status: "ACTIVE" }]]) {
    const err = await op({ pool: secretPool }, actor(), input).then(() => null, (e) => e);
    assert.ok(err, "an unreachable database did not refuse");
    assert.ok(["CRM_READ_FAILED", "CRM_COMMAND_FAILED"].includes(err.code), err.code);
    assert.doesNotMatch(`${err.message} ${JSON.stringify(err)}`, /10\.9\.8\.7|eos_secret|crm_prod|ECONNREFUSED|password/);
  }
  const translated = kernel.translateCrmError(Object.assign(new Error('insert or update on table "contacts" violates foreign key constraint "contacts_account_same_tenant"'), { code: "23503", constraint: "contacts_account_same_tenant", detail: "Key (tenant_id, account_id)=(t2, a1) is not present" }), "CRM_COMMAND_FAILED");
  assert.equal(translated.code, "ACCOUNT_NOT_FOUND");
  assert.doesNotMatch(translated.message, /contacts_account_same_tenant|Key \(|t2/);
});
