// EMP-RT-W1A (#1931): the governed PostgreSQL Employee profile command, offline. Every refusal here happens BEFORE a
// database connection is taken -- the pool below throws if touched. The real-database proof (transaction, audit, tenant
// isolation, Employee/Principal separation, rollback and mutation controls) is employeeProfileCommandPostgres.test.mjs.
// Prerequisite: npm run build (this imports from ../lib).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FUNCTIONS_DIR, "src", "eosWorkforce");
const require = createRequire(import.meta.url);
const command = require("../lib/eosWorkforce/commands/employeeProfileCommand.js");
const vocabulary = require("../lib/eosWorkforce/employeeProfileVocabulary.js");
const snapshotLib = require("../lib/eosWorkforce/migration/employeeProfileSnapshot.js");
const entitlement = require("../lib/eosOps/conditionalEntitlement.js");

const untouchablePool = { connect: () => { throw new Error("the command touched the database before refusing"); } };
const deps = { pool: untouchablePool };
const WRITE = "admin.employeeProfile.write";
// A RESOLVED actor carries the conditional-entitlement metadata resolveOperationalContext produces,
// not only the flat set. Built through the real composer with the SHIPPED (empty) catalog, so every
// entitlement here is unconditional -- exactly what the deployed resolver produces today.
const entitlementsOf = (caps) => async () => entitlement.entitlementsFrom(
  caps.map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "admin" }, capabilityKey })));
const actor = (caps = [WRITE], extra = {}) => ({
  tenantId: "t1", principalId: "p-admin", capabilities: new Set(caps), entitlements: entitlementsOf(caps), ...extra });
const refusedWith = (code) => (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; };
const run = (input, a = actor()) => command.updateEmployeeProfile(deps, a, input);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("vocabulary: exactly the seventeen profile facts, keyed as the Firestore command and Administration form key them", () => {
  assert.deepEqual([...command.EMPLOYEE_PROFILE_FIELD_KEYS], [
    "employeeNumber", "displayName", "firstName", "middleName", "lastName", "preferredName", "jobTitle", "workEmail",
    "workPhone", "mobilePhone", "address.street", "address.unit", "address.city", "address.state", "address.postalCode",
    "hireDate", "separationDate",
  ]);
  assert.deepEqual(vocabulary.PROFILE_FIELD_MAP.map(([, column]) => column), [...vocabulary.PROFILE_COLUMNS]);
  // The migration module re-exports the SAME objects: the copy and the writer share one statement.
  assert.equal(snapshotLib.PROFILE_COLUMNS, vocabulary.PROFILE_COLUMNS);
  // Every key is one the Firestore command also edits (source-level, so the Firebase module is never loaded here).
  const firestoreCommand = readFileSync(join(FUNCTIONS_DIR, "src", "access", "employeeProfileCommands.ts"), "utf8");
  for (const key of command.EMPLOYEE_PROFILE_FIELD_KEYS) assert.match(firestoreCommand, new RegExp(`\\{ key: "${key.replace(".", "\\.")}", kind: "`), key);
});

test("actor: resolved context and admin.employeeProfile.write are required before anything else", async () => {
  await assert.rejects(run({ employeeId: "e1", changes: { jobTitle: "Lead" } }, null), refusedWith("ACTOR_CONTEXT_REQUIRED"));
  await assert.rejects(run({ employeeId: "e1", changes: { jobTitle: "Lead" } }, { tenantId: "t1", principalId: "p1", capabilities: [WRITE] }), refusedWith("ACTOR_CONTEXT_REQUIRED"));
  await assert.rejects(run({ employeeId: "e1", changes: { jobTitle: "Lead" } }, actor(["employee.record.read"])), refusedWith("CAPABILITY_REQUIRED"));
  // Authority submitted as INPUT is not authority: a caller cannot supply its own capability, tenant or actor.
  await assert.rejects(run({ employeeId: "e1", changes: { jobTitle: "Lead" }, capabilities: [WRITE] }, actor([])), refusedWith("CAPABILITY_REQUIRED"));
  // The entitlement metadata is part of a RESOLVED actor, not an optional extra. An actor without it
  // is REFUSED rather than decided on the flat set alone -- falling back would let any caller that
  // omitted the field escape every per-grant condition.
  await assert.rejects(
    run({ employeeId: "e1", changes: { jobTitle: "Lead" } }, { tenantId: "t1", principalId: "p1", capabilities: new Set([WRITE]) }),
    refusedWith("ACTOR_CONTEXT_REQUIRED"), "an actor with no entitlements must refuse");
  // ...and so must an actor that supplies them as a VALUE. Deferring the WORK behind a required
  // resolver never made the OBLIGATION optional: a pre-computed, stale or hand-built list -- even a
  // correct one -- is not a resolution against the live grant and condition stores.
  await assert.rejects(
    run({ employeeId: "e1", changes: { jobTitle: "Lead" } },
      { tenantId: "t1", principalId: "p1", capabilities: new Set([WRITE]),
        entitlements: entitlement.entitlementsFrom([{ grantor: { kind: "ROLE", roleKey: "admin" }, capabilityKey: WRITE }]) }),
    refusedWith("ACTOR_CONTEXT_REQUIRED"), "a bare entitlement VALUE must not discharge the obligation");
  await assert.rejects(
    run({ employeeId: "e1", changes: { jobTitle: "Lead" } },
      { tenantId: "t1", principalId: "p1", capabilities: new Set([WRITE]), entitlements: [] }),
    refusedWith("ACTOR_CONTEXT_REQUIRED"), "an empty entitlement array must not discharge the obligation");
  // ...and it still refuses BEFORE a connection: the pool above throws if touched.
});

test("input: closed top-level key set; tenant, actor and principal keys are refused, never honored", async () => {
  for (const key of ["tenantId", "principalId", "actor", "actorUid", "capabilities", "idempotencyKey", "role"]) {
    await assert.rejects(run({ employeeId: "e1", changes: { jobTitle: "Lead" }, [key]: "x" }), refusedWith("INPUT_FIELD_NOT_ACCEPTED"), key);
  }
  await assert.rejects(run([]), refusedWith("INPUT_INVALID"));
  await assert.rejects(run(undefined), refusedWith("INPUT_INVALID"));
  for (const bad of [undefined, "", " e1", "tenants/t1/employees/e1", 42]) {
    await assert.rejects(run({ employeeId: bad, changes: { jobTitle: "Lead" } }), refusedWith("EMPLOYEE_ID_REQUIRED"), String(bad));
  }
  await assert.rejects(run({ employeeId: "e1", changes: { jobTitle: "Lead" }, reason: " padded" }), refusedWith("REASON_INVALID"));
});

test("changes: non-empty; relationship, lifecycle, access and role keys refused by name", async () => {
  for (const bad of [undefined, null, [], "jobTitle", {}]) {
    await assert.rejects(run({ employeeId: "e1", changes: bad }), refusedWith("CHANGES_REQUIRED"), JSON.stringify(bad));
  }
  for (const key of ["managerEmployeeId", "employmentStatus", "operatingCompanyId", "operationalRoles", "securityRole", "role",
    "userId", "employeeId", "principalId", "accessVersion", "accountStatus", "disabled", "jobRole", "address", "tenantId"]) {
    await assert.rejects(run({ employeeId: "e1", changes: { jobTitle: "Lead", [key]: "x" } }), (e) => {
      assert.equal(e.code, "INPUT_FIELD_NOT_ACCEPTED");
      assert.match(e.message, new RegExp(key));
      return true;
    }, key);
  }
});

test("normalization: the Firestore command's validators, refused before the database", async () => {
  const cases = [
    [{ workEmail: "not-an-email" }, /workEmail is not a valid email address/],
    [{ hireDate: "2021-02-30" }, /hireDate must be a calendar date/],
    [{ separationDate: "03/04/2021" }, /separationDate must be a calendar date/],
    [{ employeeNumber: "TAZ 42" }, /employeeNumber must be 1-32 characters/],
    [{ employeeNumber: "-TAZ" }, /employeeNumber must be 1-32 characters/],
    [{ displayName: "x".repeat(201) }, /displayName exceeds 200 characters/],
    [{ "address.city": 7 }, /address.city must be a string or null/],
  ];
  for (const [changes, message] of cases) {
    await assert.rejects(run({ employeeId: "e1", changes }), (e) => e.code === "PROFILE_FIELD_INVALID" && message.test(e.message), JSON.stringify(changes));
  }
  assert.deepEqual(vocabulary.normalizeProfileValue("TEXT", "  Robert  "), { value: "Robert" });
  assert.deepEqual(vocabulary.normalizeProfileValue("TEXT", "   "), { value: null });
  assert.deepEqual(vocabulary.normalizeProfileValue("DATE", "2024-02-29"), { value: "2024-02-29" });
});

test("boundary: no Firebase, no Rules; the Workforce transport (W1B) is the only module that composes the command", () => {
  for (const file of ["commands/employeeProfileCommand.ts", "commands/employeeCommandKernel.ts", "employeeProfileVocabulary.ts"]) {
    const src = strip(readFileSync(join(SRC, file), "utf8"));
    assert.doesNotMatch(src, /firebase|firestore|from "\.\.\/migration\//i, file);
    const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    // PER-FILE, so admitting the command kernel's authorization seam does not widen what the command
    // body or the vocabulary may reach. The kernel -- and ONLY the kernel -- may import the
    // conditional-entitlement decision, because that is where the capability gate lives.
    const allowed = {
      "commands/employeeProfileCommand.ts": ["pg", "node:crypto", "./employeeCommandKernel", "../employeeProfileVocabulary", "../reads/employeeReadKernel"],
      "commands/employeeCommandKernel.ts": ["pg", "node:crypto", "./employeeCommandKernel", "../employeeProfileVocabulary", "../reads/employeeReadKernel",
        "../../eosOps/conditionalEntitlement", "../../eosOps/contextualAuthorization"],
      "employeeProfileVocabulary.ts": ["pg", "node:crypto", "./employeeCommandKernel", "../employeeProfileVocabulary", "../reads/employeeReadKernel"],
    }[file];
    assert.ok(imports.every((i) => allowed.includes(i)), `${file}: ${imports}`);
  }
  assert.match(strip(readFileSync(join(SRC, "workforceHttp.ts"), "utf8")), /updateEmployeeProfile: command\(updateEmployeeProfile\)/);
  assert.doesNotMatch(readFileSync(join(FUNCTIONS_DIR, "..", "firestore.rules"), "utf8"), /employeeProfileCommand|workforce\/employees/);
  // Every statement the command issues is tenant-scoped.
  const body = strip(readFileSync(join(SRC, "commands", "employeeProfileCommand.ts"), "utf8"));
  const tables = (body.match(/eos_workforce\.employees/g) ?? []).length;
  assert.ok(tables >= 3);
  assert.equal((body.match(/WHERE tenant_id = \$1 AND id (?:=|<>) \$2/g) ?? []).length, tables, "an employees statement without the tenant predicate");
});
