// DQ-030 / DQ-031: every PostgreSQL Catalog READ is authorized SERVER-SIDE, against a real PostgreSQL, through the
// real Render transport (handleCatalogRequest) and the real identity resolution (resolveOperationalContext).
//
//   DQ-031  tenant membership alone is NOT authority to read the Catalog. A member without
//           `inventory.catalog.read` is refused (403 FORBIDDEN) by every read; a caller with it is answered; an
//           unauthenticated caller is refused (401) before any connection is taken.
//   DQ-030  `listEquipmentModels` serves the Sales Agreement Equipment Model picker from eos_ops.equipment_models,
//           bounded, tenant-scoped, behind the same capability.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const http = require("../lib/catalogMaster/catalogHttp.js");
const partWriter = require("../lib/catalogMaster/postgresPartMasterWriter.js");
const eqWriter = require("../lib/catalogMaster/postgresEquipmentModelWriter.js");
const reads = require("../lib/catalogMaster/postgresCatalogReads.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const ACTIVE = Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" });
const READ = "inventory.catalog.read";

test("the Catalog read capability table names inventory.catalog.read for every read, and invents no key", () => {
  const ops = [...http.CATALOG_READ_OPERATIONS];
  assert.deepEqual(Object.keys(http.CATALOG_READ_REQUIREMENTS).sort(), [...ops].sort(), "every read has a requirement");
  for (const op of ops) assert.ok(http.CATALOG_READ_REQUIREMENTS[op].includes(READ), `${op} requires ${READ}`);
  // The only other keys are the legacy callables' own predicates -- already registered ids, not new ones.
  const extra = new Set(ops.flatMap((op) => http.CATALOG_READ_REQUIREMENTS[op]).filter((k) => k !== READ));
  assert.deepEqual([...extra].sort(), ["inventory.catalog.alias.read", "inventory.catalog.manage"]);
});

test("Catalog reads are capability-gated server-side, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `cat_readauthz_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  let verified = 0;
  const deps = {
    reader: repo, pool, writerAuthority: ACTIVE, allowedOrigins: [],
    verifyToken: async (token) => { verified += 1; const s = TOKENS.get(token); if (!s) throw new Error("bad"); return { externalSubject: s, identityProvider: "firebase" }; },
  };

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });
  const makeActor = async (tenantId, subject, keys) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    if (keys.length) {
      const role = await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key: `role-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false }));
      for (const key of keys) {
        const r = await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
                           SELECT $1, $2, $3, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities c WHERE c.key = $4`,
          [`rc_${role.id}_${key}`, tenantId, role.id, key]);
        assert.equal(r.rowCount, 1, `${key} is a REGISTERED capability -- the fixture grants only what exists`);
      }
      await repo.transact(fixture(tenantId), async (tx) => {
        const v = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
      });
    }
    TOKENS.set(`tok-${subject}`, subject);
    return { principalId, token: `tok-${subject}` };
  };

  const writer = await makeActor("t1", "fb-writer", ["inventory.catalog.manage", "inventory.catalog.activate", "equipment.model.manage"]);
  const writerT2 = await makeActor("t2", "fb-writer-t2", ["inventory.catalog.manage", "equipment.model.manage"]);
  const readerT1 = await makeActor("t1", "fb-reader", [READ]);
  const memberOnly = await makeActor("t1", "fb-member", []);
  const otherCap = await makeActor("t1", "fb-other", ["customer.record.read"]);
  const aliasAdmin = await makeActor("t1", "fb-alias-admin", [READ, "inventory.catalog.manage"]);

  // Fixture data, written through the governed writers (their own capability checks, not the transport's).
  const W_CAPS = new Set(["inventory.catalog.manage", "inventory.catalog.activate", "equipment.model.manage"]);
  const wdeps = { pool };
  const MODEL = { manufacturerId: "acme", manufacturerName: "Acme Refrigeration", modelNumber: "cw 100", displayName: "Acme CW-100", status: "ACTIVE", sourceAuthority: "MANUFACTURER_CATALOG" };
  await eqWriter.createEquipmentModel(wdeps, { tenantId: "t1", principalId: writer.principalId, capabilities: W_CAPS }, { model: MODEL });
  await eqWriter.createEquipmentModel(wdeps, { tenantId: "t1", principalId: writer.principalId, capabilities: W_CAPS }, { model: { ...MODEL, modelNumber: "cw 200", displayName: "Acme CW-200" } });
  await eqWriter.createEquipmentModel(wdeps, { tenantId: "t2", principalId: writerT2.principalId, capabilities: W_CAPS }, { model: { ...MODEL, modelNumber: "t2 only", displayName: "Other tenant" } });
  await partWriter.createPart(wdeps, { tenantId: "t1", principalId: writer.principalId, capabilities: W_CAPS }, {
    part: {
      partId: "CW-P-0001", internalPartNumber: "IPN-1", name: "Fan motor", status: "ACTIVE", category: "C",
      stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
      flags: { expiryTracked: false, consumable: false, returnableCore: false }, wholeUnit: false,
    },
  });

  const call = async (actor, operation, input = {}) => {
    const headers = actor ? { authorization: `Bearer ${actor.token}` } : {};
    const res = await http.handleCatalogRequest(deps, { method: "POST", url: http.CATALOG_ROUTE, headers, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const INPUT = {
    readPart: { partId: "CW-P-0001" }, readPartsByIds: { partIds: ["CW-P-0001"] }, searchParts: { query: "fan" },
    countParts: {}, listEquipmentModels: {}, listPartAliases: { partId: "CW-P-0001" },
    probePartAlias: { aliasType: "MANUFACTURER_PART_NUMBER", rawValue: "X-1", manufacturerId: "acme" },
    lookupScannedPart: { rawValue: "CW-P-0001" },
  };

  await t.test("ALLOWED: a Principal holding inventory.catalog.read is answered", async () => {
    const s = await call(readerT1, "searchParts", { query: "fan" });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.deepEqual(s.body.result.parts.map((p) => p.id), ["CW-P-0001"]);
    for (const op of ["readPart", "readPartsByIds", "countParts"]) {
      const r = await call(readerT1, op, INPUT[op]);
      assert.equal(r.status, 200, `${op}: ${JSON.stringify(r.body)}`);
    }
  });

  await t.test("DQ-030: listEquipmentModels lists this tenant's models from PostgreSQL, bounded", async () => {
    const r = await call(readerT1, "listEquipmentModels");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.result.models.map((m) => [m.id, m.displayName, m.status]),
      [["ACME--CW-100", "Acme CW-100", "ACTIVE"], ["ACME--CW-200", "Acme CW-200", "ACTIVE"]], "t2's model never appears");
    assert.equal(r.body.result.nextCursor, null);
    assert.equal(r.body.result.limit, reads.EQUIPMENT_MODEL_LIST_MAX_LIMIT);
    // Paged and clamped, never trusted.
    const p1 = await call(readerT1, "listEquipmentModels", { limit: 1 });
    assert.deepEqual([p1.body.result.models.map((m) => m.id), p1.body.result.nextCursor], [["ACME--CW-100"], "ACME--CW-100"]);
    const p2 = await call(readerT1, "listEquipmentModels", { limit: 1, cursor: p1.body.result.nextCursor });
    assert.deepEqual([p2.body.result.models.map((m) => m.id), p2.body.result.nextCursor], [["ACME--CW-200"], null]);
    const huge = await call(readerT1, "listEquipmentModels", { limit: 1_000_000 });
    assert.equal(huge.body.result.limit, reads.EQUIPMENT_MODEL_LIST_MAX_LIMIT);
    const bad = await call(readerT1, "listEquipmentModels", { cursor: 7 });
    assert.deepEqual([bad.status, bad.body.code], [400, "INVALID_INPUT"]);
  });

  await t.test("REFUSED: a tenant MEMBER without inventory.catalog.read is refused by EVERY read", async () => {
    for (const actor of [memberOnly, otherCap]) {
      for (const op of http.CATALOG_READ_OPERATIONS) {
        const r = await call(actor, op, INPUT[op]);
        assert.deepEqual([r.status, r.body.code], [403, "FORBIDDEN"], `${op}: ${JSON.stringify(r.body)}`);
        assert.match(r.body.message, /inventory\.catalog\.read/, op);
        assert.equal(r.body.result, undefined, `${op} leaked a result`);
      }
    }
  });

  await t.test("the alias reads keep their legacy predicate on top of inventory.catalog.read", async () => {
    // catalog.read alone does not administer identifiers.
    for (const op of ["listPartAliases", "probePartAlias"]) {
      const r = await call(readerT1, op, INPUT[op]);
      assert.deepEqual([r.status, r.body.code], [403, "FORBIDDEN"], op);
      assert.match(r.body.message, /inventory\.catalog\.manage/);
      const ok = await call(aliasAdmin, op, INPUT[op]);
      assert.equal(ok.status, 200, `${op}: ${JSON.stringify(ok.body)}`);
    }
    // Scanned-identifier resolution requires inventory.catalog.alias.read, as the legacy callable did.
    const scan = await call(aliasAdmin, "lookupScannedPart", INPUT.lookupScannedPart);
    assert.deepEqual([scan.status, scan.body.code], [403, "FORBIDDEN"]);
    assert.match(scan.body.message, /inventory\.catalog\.alias\.read/);
  });

  await t.test("UNAUTHENTICATED: no token, or an unverifiable one, is 401 before identity or data is touched", async () => {
    const before = verified;
    for (const op of http.CATALOG_READ_OPERATIONS) {
      const r = await call(null, op, INPUT[op]);
      assert.deepEqual([r.status, r.body.code], [401, "UNAUTHENTICATED"], op);
    }
    assert.equal(verified, before, "no verifier ran for a missing token");
    const forged = await call({ token: "tok-nobody" }, "searchParts", { query: "fan" });
    assert.deepEqual([forged.status, forged.body.code], [401, "UNAUTHENTICATED"]);
  });

  await t.test("a verified identity that is no tenant member is refused, not answered", async () => {
    TOKENS.set("tok-stranger", "fb-stranger");
    const r = await call({ token: "tok-stranger" }, "listEquipmentModels");
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.result, undefined);
  });
});
