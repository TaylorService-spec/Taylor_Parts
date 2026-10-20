// CAT-1 (docs/audits/firebase-retirement-equivalence-2026-10-11): the Part Master screens read the retired Firebase
// callable shape, so every successful EOS write was shown to the employee as "could not be completed".
//
// THIS test is the server half of the employee-workflow contract. It drives the REAL Catalog transport
// (handleCatalogRequest -> runCatalogCommand -> PostgreSQL) with payloads built by the SCREEN's own builders
// (field-ops-app-vite/src/domain/partMasterWrite.js), for each thing an employee does on the Part screens, and
// pins the exact HTTP answers in field-ops-app-vite/test/fixtures/catalogPartMasterContract.json.
//
// The browser half (field-ops-app-vite/test/partMasterEmployeeWorkflow.test.jsx) renders the real screen through
// the real hook, command client and catalogApiClient, fed THOSE bytes. Together: the server provably answers the
// fixture, and the screen provably shows the employee the right thing for it. Neither half mocks the other's shape.
//
// To refresh the fixture after a deliberate contract change: UPDATE_CATALOG_CONTRACT=1 with the database set.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const FIXTURE = resolve(REPO_ROOT, "field-ops-app-vite/test/fixtures/catalogPartMasterContract.json");
const require = createRequire(import.meta.url);
const http = require("../lib/catalogMaster/catalogHttp.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const ACTIVE = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });

test("the Part Master employee workflows answer the contract the screens read", { skip: SKIP, concurrency: 1 }, async (t) => {
  const screen = await import(pathToFileURL(resolve(REPO_ROOT, "field-ops-app-vite/src/domain/partMasterWrite.js")).href);

  const name = `cat_pm_contract_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(async () => {
    await endPoolAndDrain(pool);
    const c = new pg.Client({ connectionString: URL_BASE });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.end();
  });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  const TOKENS = new Map();
  const deps = {
    reader: repo, pool, writerAuthority: ACTIVE, allowedOrigins: [],
    verifyToken: async (token) => { const s = TOKENS.get(token); if (!s) throw new Error("bad"); return { externalSubject: s, identityProvider: "firebase" }; },
  };
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  const fixture = { tenantId: "t1", uid: "uid-fixture-admin" };
  const makeActor = async (subject, keys) => {
    const principalId = await repo.transact(fixture, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    if (keys.length) {
      const role = await repo.transact(fixture, (tx) => tx.createRole({ key: `role-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false }));
      for (const key of keys) {
        const r = await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
                           SELECT $1, 't1', $2, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities c WHERE c.key = $3`,
          [`rc_${role.id}_${key}`, role.id, key]);
        assert.equal(r.rowCount, 1, `${key} is a REGISTERED capability -- the fixture grants only what exists`);
      }
      await repo.transact(fixture, async (tx) => {
        const v = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
      });
    }
    TOKENS.set(`tok-${subject}`, subject);
    return { token: `tok-${subject}` };
  };

  // The holders the business actually has: manage (Parts Manager & co.), activate (the catalog administrator),
  // and a reader who holds neither.
  const manager = await makeActor("fb-parts-manager", ["inventory.catalog.read", "inventory.catalog.manage"]);
  const activator = await makeActor("fb-catalog-admin", ["inventory.catalog.read", "inventory.catalog.manage", "inventory.catalog.part.activate"]); // GRANT-1 A1 split key
  const reader = await makeActor("fb-reader", ["inventory.catalog.read"]);

  const call = async (actor, operation, input) => {
    const res = await http.handleCatalogRequest(deps, {
      method: "POST", url: http.CATALOG_ROUTE, headers: { authorization: `Bearer ${actor.token}` },
      body: JSON.stringify({ operation, input }),
    });
    return { request: { operation, input }, status: res.status, body: JSON.parse(res.body) };
  };

  // The screen's payloads, exactly as usePartMasterWrite -> partMasterCommandClient send them.
  const FORM = { partId: "PRT-CONTRACT-1", internalPartNumber: "PRT-CONTRACT-1", name: "Contract valve", category: "Valves",
    stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" };
  const createInput = { part: screen.buildCreatePartInput(FORM) };
  const loaded = { ...FORM, version: 1, status: "DRAFT" };

  const scenarios = {};
  scenarios.createApplied = await call(manager, "createPart", createInput);
  scenarios.createReplayed = await call(manager, "createPart", createInput);
  scenarios.createExisting = await call(manager, "createPart", { part: screen.buildCreatePartInput({ ...FORM, name: "A different valve" }) });
  scenarios.createDenied = await call(reader, "createPart", { part: screen.buildCreatePartInput({ ...FORM, partId: "PRT-CONTRACT-2", internalPartNumber: "PRT-CONTRACT-2" }) });
  scenarios.updateApplied = await call(manager, "updatePart",
    { partId: FORM.partId, expectedVersion: 1, changes: screen.buildUpdateChanges({ ...loaded, name: "Contract valve, brass" }, loaded) });
  scenarios.updateStale = await call(manager, "updatePart",
    { partId: FORM.partId, expectedVersion: 1, changes: screen.buildUpdateChanges({ ...loaded, category: "Brass" }, loaded) });
  scenarios.updateUnknownPart = await call(manager, "updatePart",
    { partId: "PRT-NEVER-EXISTED", expectedVersion: 1, changes: screen.buildUpdateChanges({ ...loaded, name: "x" }, loaded) });
  scenarios.updateControlType = await call(manager, "updatePart",
    { partId: FORM.partId, expectedVersion: 2, changes: screen.buildUpdateChanges({ ...loaded, controlType: "SERIALIZED" }, loaded) });
  // A rename INTO an identifier another part owns (review of #2059): part B is renamed, so its OLD number stays as
  // B's INTERNAL_PN identifier; renaming part A to that number is refused CONFLICT -- not a stale copy, and reloading
  // will never fix it.
  const FORM_B = { ...FORM, partId: "PRT-CONTRACT-B", internalPartNumber: "PRT-CONTRACT-B-OLD", name: "Contract valve B" };
  assert.equal((await call(manager, "createPart", { part: screen.buildCreatePartInput(FORM_B) })).status, 200);
  const loadedB = { ...FORM_B, version: 1, status: "DRAFT" };
  assert.equal((await call(manager, "updatePart", { partId: "PRT-CONTRACT-B", expectedVersion: 1,
    changes: screen.buildUpdateChanges({ ...loadedB, internalPartNumber: "PRT-CONTRACT-B" }, loadedB) })).status, 200);
  scenarios.updateRenameTaken = await call(manager, "updatePart",
    { partId: FORM.partId, expectedVersion: 2, changes: screen.buildUpdateChanges({ ...loaded, internalPartNumber: "PRT-CONTRACT-B-OLD" }, loaded) });
  scenarios.statusDenied = await call(manager, "changePartStatus", { partId: FORM.partId, expectedVersion: 2, newStatus: "ACTIVE" });
  scenarios.statusApplied = await call(activator, "changePartStatus", { partId: FORM.partId, expectedVersion: 2, newStatus: "ACTIVE" });
  scenarios.statusStale = await call(activator, "changePartStatus", { partId: FORM.partId, expectedVersion: 2, newStatus: "INACTIVE" });
  await call(activator, "changePartStatus", { partId: FORM.partId, expectedVersion: 3, newStatus: "DISCONTINUED" });
  scenarios.statusIllegal = await call(activator, "changePartStatus", { partId: FORM.partId, expectedVersion: 4, newStatus: "ACTIVE" });

  await t.test("the server answers each employee action as the contract says", () => {
    assert.deepEqual(scenarios.createApplied.body.result, { partId: FORM.partId, version: 1, replayed: false });
    assert.deepEqual(scenarios.createReplayed.body.result, { partId: FORM.partId, version: 1, replayed: true });
    assert.deepEqual([scenarios.createExisting.status, scenarios.createExisting.body.code], [409, "CONFLICT"]);
    assert.deepEqual([scenarios.createDenied.status, scenarios.createDenied.body.code], [403, "FORBIDDEN"]);
    assert.deepEqual(scenarios.updateApplied.body.result, { partId: FORM.partId, version: 2, replayed: false });
    assert.deepEqual([scenarios.updateStale.status, scenarios.updateStale.body.code], [409, "CONFLICT"]);
    assert.deepEqual([scenarios.updateUnknownPart.status, scenarios.updateUnknownPart.body.code], [404, "NOT_FOUND"]);
    assert.deepEqual([scenarios.updateControlType.status, scenarios.updateControlType.body.code], [412, "PRECONDITION_FAILED"]);
    assert.deepEqual([scenarios.updateRenameTaken.status, scenarios.updateRenameTaken.body.code], [409, "CONFLICT"]);
    assert.deepEqual([scenarios.statusDenied.status, scenarios.statusDenied.body.code], [403, "FORBIDDEN"]);
    assert.deepEqual(scenarios.statusApplied.body.result, { partId: FORM.partId, version: 3, replayed: false });
    assert.deepEqual([scenarios.statusStale.status, scenarios.statusStale.body.code], [409, "CONFLICT"]);
    assert.deepEqual([scenarios.statusIllegal.status, scenarios.statusIllegal.body.code], [412, "PRECONDITION_FAILED"]);
  });

  await t.test("the screen maps every answer to what the employee must be told", () => {
    const shown = (scenario, operation) => (scenario.body.ok
      ? screen.outcomeFromResult(scenario.body.result)
      : screen.outcomeFromError({ code: scenario.body.code }, operation)).kind;
    assert.equal(shown(scenarios.createApplied, "create"), "applied");
    assert.equal(shown(scenarios.createReplayed, "create"), "replayed");
    assert.equal(shown(scenarios.createExisting, "create"), "conflict");
    assert.equal(shown(scenarios.createDenied, "create"), "denied");
    assert.equal(shown(scenarios.updateApplied, "update"), "applied");
    assert.equal(shown(scenarios.updateStale, "update"), "conflict");
    assert.equal(shown(scenarios.updateUnknownPart, "update"), "notFound");
    assert.equal(shown(scenarios.updateControlType, "update"), "invalid");
    assert.equal(shown(scenarios.updateRenameTaken, "update"), "conflict");
    assert.equal(shown(scenarios.statusDenied, "changeStatus"), "denied");
    assert.equal(shown(scenarios.statusApplied, "changeStatus"), "applied");
    assert.equal(shown(scenarios.statusStale, "changeStatus"), "conflict");
    assert.equal(shown(scenarios.statusIllegal, "changeStatus"), "invalid");
  });

  await t.test("the committed browser fixture is exactly what the server answers", () => {
    const actual = { route: http.CATALOG_ROUTE, scenarios };
    if (process.env.UPDATE_CATALOG_CONTRACT === "1") writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    const committed = JSON.parse(readFileSync(FIXTURE, "utf8"));
    assert.deepEqual(committed, actual,
      "field-ops-app-vite/test/fixtures/catalogPartMasterContract.json drifted from the server -- the browser test would be " +
      "proving a shape the server no longer sends. Re-run with UPDATE_CATALOG_CONTRACT=1 and review the diff.");
  });
});
