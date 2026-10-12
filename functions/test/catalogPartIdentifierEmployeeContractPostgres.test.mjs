// CAT-2 (docs/audits/firebase-retirement-equivalence-2026-10-11): the Part identifier screens relayed the Catalog
// answers verbatim on the assumption they matched the retired Firebase callables. listPartAliases answers a bare
// array with `originalValue`, so every Part showed NO identifiers and Deactivate / Reactivate were unreachable.
//
// THIS test is the server half of the employee-workflow contract. It drives the REAL Catalog transport
// (handleCatalogRequest -> PostgreSQL) with the requests the identifier screen sends (exactly the fields
// services/partAliasCallableClient.js puts on the wire, idempotency key included), and pins the answers in
// field-ops-app-vite/test/fixtures/catalogPartIdentifierContract.json. Timestamps and principal ids are
// normalized (they vary per run); everything else is the server's own bytes.
//
// The browser half (field-ops-app-vite/test/partIdentifierEmployeeWorkflow.test.jsx) renders PartIdentifiersSection
// through the real hook, the real adapter and the real catalogApiClient, fed THOSE answers.
//
// To refresh the fixture after a deliberate contract change: UPDATE_CATALOG_CONTRACT=1 with the database set.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(FUNCTIONS_DIR, "..");
const FIXTURE = resolve(REPO_ROOT, "field-ops-app-vite/test/fixtures/catalogPartIdentifierContract.json");
const require = createRequire(import.meta.url);
const http = require("../lib/catalogMaster/catalogHttp.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const ACTIVE = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });

test("the Part identifier employee workflows answer the contract the screens read", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `cat_alias_contract_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(async () => {
    await pool.end();
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

  const manager = await makeActor("fb-parts-manager", ["inventory.catalog.read", "inventory.catalog.manage"]);
  const reader = await makeActor("fb-reader", ["inventory.catalog.read"]);

  // Two Parts, created through the same transport by the Parts Manager.
  const part = (partId) => ({ partId, internalPartNumber: partId, name: `Part ${partId}`, status: "DRAFT", category: "C",
    stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" });

  const call = async (actor, operation, input) => {
    const res = await http.handleCatalogRequest(deps, {
      method: "POST", url: http.CATALOG_ROUTE, headers: { authorization: `Bearer ${actor.token}` },
      body: JSON.stringify({ operation, input }),
    });
    return { request: { operation, input }, status: res.status, body: JSON.parse(res.body) };
  };
  for (const id of ["PRT-ALIAS-1", "PRT-ALIAS-2"]) {
    const r = await call(manager, "createPart", { part: part(id) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }

  // Exactly what services/partAliasCallableClient.js sends (the hook adds source "manual" and its own key).
  const create = (partId, aliasType, rawValue, key) => ({ partId, aliasType, rawValue, idempotencyKey: key, source: "manual" });
  const UPC = "012345678905";
  const scenarios = {};
  scenarios.listEmpty = await call(manager, "listPartAliases", { partId: "PRT-ALIAS-1" });
  scenarios.createApplied = await call(manager, "createPartAlias", create("PRT-ALIAS-1", "UPC", UPC, "pa-key-upc-1"));
  scenarios.createReplayed = await call(manager, "createPartAlias", create("PRT-ALIAS-1", "UPC", UPC, "pa-key-upc-2"));
  scenarios.createTaken = await call(manager, "createPartAlias", create("PRT-ALIAS-2", "UPC", UPC, "pa-key-upc-3"));
  scenarios.createDenied = await call(reader, "createPartAlias", create("PRT-ALIAS-1", "SUPPLIER_SKU", "SKU-DENIED-1", "pa-key-sku-0"));
  scenarios.createMalformed = await call(manager, "createPartAlias", create("PRT-ALIAS-1", "UPC", "12345", "pa-key-upc-4"));
  await call(manager, "createPartAlias", create("PRT-ALIAS-1", "SUPPLIER_SKU", "SKU-CONTRACT-1", "pa-key-sku-1"));
  scenarios.listBothActive = await call(manager, "listPartAliases", { partId: "PRT-ALIAS-1" });
  const sku = scenarios.listBothActive.body.result.find((a) => a.aliasType === "SUPPLIER_SKU");
  const upc = scenarios.listBothActive.body.result.find((a) => a.aliasType === "UPC");
  scenarios.deactivateApplied = await call(manager, "deactivatePartAlias", { aliasId: sku.aliasId, expectedVersion: 1, idempotencyKey: "pa-key-d-1" });
  scenarios.listAfterDeactivate = await call(manager, "listPartAliases", { partId: "PRT-ALIAS-1" });
  scenarios.deactivateAlready = await call(manager, "deactivatePartAlias", { aliasId: sku.aliasId, expectedVersion: 2, idempotencyKey: "pa-key-d-2" });
  scenarios.deactivateStale = await call(manager, "deactivatePartAlias", { aliasId: upc.aliasId, expectedVersion: 7, idempotencyKey: "pa-key-d-3" });
  scenarios.reactivateApplied = await call(manager, "reactivatePartAlias", { aliasId: sku.aliasId, expectedVersion: 2, idempotencyKey: "pa-key-r-1" });
  scenarios.listAfterReactivate = await call(manager, "listPartAliases", { partId: "PRT-ALIAS-1" });
  scenarios.listDenied = await call(reader, "listPartAliases", { partId: "PRT-ALIAS-1" });
  scenarios.probeFound = await call(manager, "probePartAlias", { aliasType: "UPC", rawValue: UPC });

  await t.test("the server answers each identifier action as the contract says", () => {
    assert.deepEqual(scenarios.listEmpty.body.result, []);
    assert.equal(Array.isArray(scenarios.listBothActive.body.result), true, "listPartAliases answers a BARE array");
    assert.equal(scenarios.listBothActive.body.result.length, 2);
    assert.ok(scenarios.listBothActive.body.result.every((a) => typeof a.originalValue === "string" && !("value" in a)),
      "the identifier is `originalValue` -- the retired callable's `value` does not exist");
    assert.deepEqual([scenarios.createApplied.status, scenarios.createApplied.body.result.replayed], [200, false]);
    assert.deepEqual([scenarios.createReplayed.status, scenarios.createReplayed.body.result.replayed], [200, true]);
    assert.deepEqual([scenarios.createTaken.status, scenarios.createTaken.body.code], [409, "CONFLICT"]);
    assert.deepEqual([scenarios.createDenied.status, scenarios.createDenied.body.code], [403, "FORBIDDEN"]);
    assert.deepEqual([scenarios.createMalformed.status, scenarios.createMalformed.body.code], [400, "INVALID_INPUT"]);
    assert.deepEqual([scenarios.deactivateApplied.body.result.status, scenarios.deactivateApplied.body.result.version], ["INACTIVE", 2]);
    assert.deepEqual(scenarios.listAfterDeactivate.body.result.map((a) => [a.aliasType, a.status]).sort(), [["SUPPLIER_SKU", "INACTIVE"], ["UPC", "ACTIVE"]]);
    assert.deepEqual([scenarios.deactivateAlready.status, scenarios.deactivateAlready.body.code], [412, "PRECONDITION_FAILED"]);
    assert.deepEqual([scenarios.deactivateStale.status, scenarios.deactivateStale.body.code], [409, "CONFLICT"]);
    assert.deepEqual([scenarios.reactivateApplied.body.result.status, scenarios.reactivateApplied.body.result.version], ["ACTIVE", 3]);
    assert.deepEqual([scenarios.listDenied.status, scenarios.listDenied.body.code], [403, "FORBIDDEN"]);
    assert.equal(scenarios.probeFound.body.result.result, "FOUND");
  });

  await t.test("the committed browser fixture is exactly what the server answers (timestamps and principals normalized)", () => {
    const VARYING = new Set(["createdAt", "updatedAt", "deactivatedAt", "createdBy", "updatedBy", "deactivatedBy"]);
    const normalize = (v) => (Array.isArray(v) ? v.map(normalize)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) =>
        [k, VARYING.has(k) && x !== null ? (k.endsWith("At") ? "2026-10-11T12:00:00.000Z" : "<principal>") : normalize(x)]))
        : v);
    const actual = normalize({ route: http.CATALOG_ROUTE, scenarios });
    if (process.env.UPDATE_CATALOG_CONTRACT === "1") writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    const committed = JSON.parse(readFileSync(FIXTURE, "utf8"));
    assert.deepEqual(committed, actual,
      "field-ops-app-vite/test/fixtures/catalogPartIdentifierContract.json drifted from the server -- the browser test would " +
      "be proving a shape the server no longer sends. Re-run with UPDATE_CATALOG_CONTRACT=1 and review the diff.");
  });
});
