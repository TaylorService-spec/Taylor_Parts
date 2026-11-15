// A13 / D5: MAKE A PERSON LOGIN-READY -- the parts that need no database. docs/architecture/eos-login-ready-person.md.
// The Postgres half (rows, rollback, concurrency, the inactive proof against real grants) is loginReadyPersonPostgres.test.mjs.
import "./support/firebaseOfflineGuard.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("../lib/eosAuth/eosLoginService.js");
const { OPERATION_ACCESS } = require("../lib/eosOps/operationAccessMap.js");
const { isImpliedForProtectedAdministrator, PROTECTED_ADMINISTRATOR_EXCLUSIONS } = require("../lib/adminPolicy/protectedAdministrator.js");

const KEY = "admin.loginReadyPerson.provision";
const ASSIGN = "admin.roleAssignment.write";
// A `this` with no database at all: any I/O throws, so a refusal that arrives proves it came first.
const noIo = { deps: { repo: new Proxy({}, { get: () => () => { throw new Error("NO_IO"); } }), pool: new Proxy({}, { get: () => () => { throw new Error("NO_IO"); } }) } };
const actor = (...caps) => ({ tenantId: "t1", uid: "p-admin", capabilities: new Set(caps) });
const call = (a, input) => S.EosLoginService.prototype.makePersonLoginReady.call(noIo, a, input);
const valid = { employeeId: "emp-1", loginIdentifier: "new.person@example.test", reason: "new hire onboarding" };

test("the operation is in the closed table: a mutation gated on the new key", () => {
  assert.deepEqual({ ...S.LOGIN_ADMINISTRATION_OPERATIONS.makePersonLoginReady }, { mutation: true, capability: KEY });
  assert.equal(S.LOGIN_READY_PERSON_CAPABILITY, KEY);
  assert.equal(S.PROVISIONED_IDENTITY_PROVIDER, "eos-provisioned");
  assert.equal(S.isLoginAdministrationOperation("makePersonLoginReady"), true);
});

test("createLoginAdministration dispatches it to the service", async () => {
  const seen = [];
  const handler = S.createLoginAdministration({ makePersonLoginReady: async (a, i) => { seen.push([a, i]); return "ok"; } }, {}, null);
  assert.equal(await handler("makePersonLoginReady", { uid: "u" }, { employeeId: "e" }), "ok");
  assert.deepEqual(seen, [[{ uid: "u" }, { employeeId: "e" }]]);
});

test("mfaRequired:false and any principalId are refused before any I/O or capability check", async () => {
  for (const bad of [{ ...valid, mfaRequired: false }, { ...valid, principalId: "p-x" }, { ...valid, principalId: undefined }]) {
    await assert.rejects(() => call(actor(), bad), (e) => e instanceof S.LoginRefusal && e.code === "INVALID_INPUT" && e.status === 400);
  }
});

test("double gate: the new key AND admin.roleAssignment.write; either alone is refused, before any I/O", async () => {
  await assert.rejects(() => call(actor(ASSIGN), valid), (e) => e instanceof S.LoginRefusal && e.code === "FORBIDDEN" && e.message.includes(KEY));
  await assert.rejects(() => call(actor(), valid), (e) => e instanceof S.LoginRefusal && e.code === "FORBIDDEN");
  await assert.rejects(() => call(actor(KEY), valid), (e) => e.message.includes(ASSIGN), "the key alone does nothing");
});

test("with both keys the input is checked next, still before any I/O", async () => {
  const both = actor(KEY, ASSIGN);
  await assert.rejects(() => call(both, { ...valid, employeeId: "" }), (e) => e.code === "INVALID_INPUT");
  await assert.rejects(() => call(both, { ...valid, reason: "  " }), (e) => e.code === "REASON_REQUIRED");
  await assert.rejects(() => call(both, { ...valid, reason: "x".repeat(501) }), (e) => e.code === "INVALID_INPUT");
  await assert.rejects(() => call(both, { ...valid, loginIdentifier: "no" }), (e) => e.code === "INVALID_INPUT");
  // A clean input reaches the database and (here) fails on NO_IO, i.e. every pre-check passed.
  await assert.rejects(() => S.EosLoginService.prototype.makePersonLoginReady.call({ deps: noIo.deps, tx: async () => { throw new Error("NO_IO"); } }, both, valid), /NO_IO/);
});

test("the refusals by name exist and are conflicts (409)", () => {
  for (const code of ["EMPLOYEE_NOT_ELIGIBLE", "EMPLOYEE_SEPARATED", "ALREADY_LINKED", "LOGIN_RETIRED"]) {
    const r = new S.LoginRefusal(code, "x");
    assert.equal(r.status, 409, code);
  }
});

test("the access map states the double gate for the browser", () => {
  assert.deepEqual([...OPERATION_ACCESS.makePersonLoginReady.allOf].sort(), [ASSIGN, KEY].sort());
});

test("standing never implies the key (inactive until the Owner grants it), though it hangs on a system-administration Object", () => {
  const meta = { key: KEY, objectKey: "rolesPermissions", actionKind: "BUSINESS_ACTION" };
  assert.equal(PROTECTED_ADMINISTRATOR_EXCLUSIONS.has(KEY), true);
  assert.equal(isImpliedForProtectedAdministrator(meta), false);
  assert.equal(isImpliedForProtectedAdministrator({ ...meta, key: "admin.someOther.thing" }), true, "control: without the exclusion the Object would imply it");
});

test("the registering migration registers one BUSINESS_ACTION and writes no grant", () => {
  const sql = readFileSync(new URL("../migrations/1764720000000_login-ready-person-provision.sql", import.meta.url), "utf8");
  const up = sql.split("-- Down Migration")[0];
  assert.match(up, /INSERT INTO capabilities/);
  assert.match(up, /'admin\.loginReadyPerson\.provision'/);
  assert.match(up, /'BUSINESS_ACTION'/);
  assert.doesNotMatch(up.replace(/--.*$/gm, ""), /role_capabilities|principal_capabilities|role_capability_decisions/);
  assert.equal((up.match(/INSERT INTO/g) ?? []).length, 1);
});
