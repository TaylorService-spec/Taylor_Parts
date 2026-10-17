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
  // lookupScannedPart's alias half is gated INSIDE the read on inventory.catalog.alias.read (OD-T6, 2026-10-01): without it
  // the half is not run and the answer says aliasDenied -- the legacy lookupScannedPart contract.
  // inventory.manufacturer.read is the PostgreSQL Manufacturer authority's own registered key (F5).
  assert.deepEqual([...extra].sort(), ["inventory.catalog.manage", "inventory.manufacturer.read"]);
  assert.equal(http.CATALOG_ALIAS_READ_CAPABILITY, "inventory.catalog.alias.read");
});

test("Catalog reads are capability-gated server-side, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `cat_readauthz_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
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
  const MFR_READ = "inventory.manufacturer.read";
  const mfrReader = await makeActor("t1", "fb-mfr-reader", [READ, MFR_READ]);
  const mfrAdmin = await makeActor("t1", "fb-mfr-admin", [READ, MFR_READ, "inventory.catalog.manage", "inventory.catalog.activate"]);
  const mfrReaderT2 = await makeActor("t2", "fb-mfr-reader-t2", [READ, MFR_READ]);

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
    listManufacturers: {}, getManufacturer: { manufacturerId: "m-taylor" }, searchManufacturers: { term: "tay" },
  };

  await t.test("F5: the Manufacturer list and its writes, through the Catalog API, under their own capabilities", async () => {
    // Writes: inventory.catalog.manage creates and renames; inventory.catalog.activate changes status. A reader is refused.
    const denied = await call(mfrReader, "createManufacturer", { manufacturer: { manufacturerId: "m-taylor", name: "Taylor" } });
    assert.deepEqual([denied.status, denied.body.code], [403, "FORBIDDEN"]);
    const created = await call(mfrAdmin, "createManufacturer", { manufacturer: { manufacturerId: "m-taylor", name: "Taylor" } });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.result.manufacturerId, "m-taylor");
    // Reads need BOTH keys: inventory.catalog.read alone is refused.
    const narrow = await call(readerT1, "listManufacturers");
    assert.deepEqual([narrow.status, narrow.body.code], [403, "FORBIDDEN"]);
    const list = await call(mfrReader, "listManufacturers");
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.result.truncated, false);
    assert.deepEqual(list.body.result.manufacturers.map((m) => [m.id, m.name, m.status]), [["m-taylor", "Taylor", "ACTIVE"]]);
    const token = list.body.result.manufacturers[0].updatedAt;
    assert.equal(token, created.body.result.updatedAt, "the list hands out the writer's own concurrency token");
    const renamed = await call(mfrAdmin, "updateManufacturer", { manufacturerId: "m-taylor", expectedUpdatedAt: token, name: "Taylor Company" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    const stale = await call(mfrAdmin, "updateManufacturer", { manufacturerId: "m-taylor", expectedUpdatedAt: token, name: "Taylor Co" });
    assert.deepEqual([stale.status, stale.body.code], [409, "CONFLICT"], "a stale token is refused");
    const off = await call(mfrAdmin, "changeManufacturerStatus", { manufacturerId: "m-taylor", expectedUpdatedAt: renamed.body.result.updatedAt, newStatus: "INACTIVE" });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    const one = await call(mfrReader, "getManufacturer", INPUT.getManufacturer);
    assert.deepEqual([one.body.result.name, one.body.result.status], ["Taylor Company", "INACTIVE"]);
    const found = await call(mfrReader, "searchManufacturers", INPUT.searchManufacturers);
    assert.deepEqual(found.body.result.map((m) => m.id), ["m-taylor"]);
    const blank = await call(mfrReader, "searchManufacturers", { term: " " });
    assert.deepEqual([blank.status, blank.body.code], [400, "INVALID_INPUT"]);
    // Tenant isolation: the other tenant sees none of it.
    const other = await call(mfrReaderT2, "listManufacturers");
    assert.deepEqual(other.body.result.manufacturers, []);
  });

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
    // Scanned-identifier resolution requires inventory.catalog.alias.read, as the legacy lookupScannedPart did: without it
    // the alias half is NOT run and the result says so (aliasDenied), exactly the legacy callable's contract.
    const scan = await call(aliasAdmin, "lookupScannedPart", INPUT.lookupScannedPart);
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.deepEqual([scan.body.result.aliasDenied, scan.body.result.alias], [true, null]);
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

  // ── SCANNER LOOKUP CONTRACT -- migrated from scannerGovernedReads.test.mjs / the sandbox scanner scenario 2 when the
  // Firebase lookupScannedPart and resolveScannedPartIdentifier callables were retired (Firebase retirement F3b,
  // 2026-10-11). The same assertions, now against the authoritative path: POST /operations/catalog lookupScannedPart.
  // resolveScannedPartIdentifier is SUPERSEDED by lookupScannedPart's alias half (same resolver, same alias.read gate);
  // the one contract difference is stated below, not hidden: a blank or oversize scan is refused at the request
  // (INVALID_INPUT) where the old resolver answered MALFORMED -- still never NOT_FOUND.
  await t.test("SCANNER: lookupScannedPart answers the scanner contract on the EOS path (migrated from the retired callables)", async () => {
    const aliasWriter = require("../lib/catalogMaster/postgresPartAliasWriter.js");
    const scanner = await makeActor("t1", "fb-scanner", [READ, "inventory.catalog.alias.read"]);
    const scannerT2 = await makeActor("t2", "fb-scanner-t2", [READ, "inventory.catalog.alias.read"]);
    const BARCODE = "0123456789012";
    await aliasWriter.createPartAlias(wdeps, { tenantId: "t1", principalId: writer.principalId, capabilities: W_CAPS },
      { partId: "CW-P-0001", aliasType: "BARCODE_OTHER", rawValue: BARCODE });
    const ids = (r) => r.body.result.parts.map((p) => p.id);

    // Part code, case-insensitively (the scanner sends what was typed or scanned).
    const byCode = await call(scanner, "lookupScannedPart", { rawValue: "CW-P-0001", partCode: "cw-p-0001" });
    assert.equal(byCode.status, 200, JSON.stringify(byCode.body));
    assert.deepEqual(ids(byCode), ["CW-P-0001"]);

    // A registered barcode resolves to its Part, wedge whitespace and all; the alias answer is carried.
    const byBarcode = await call(scanner, "lookupScannedPart", { rawValue: `  ${BARCODE}  ` });
    assert.equal(byBarcode.status, 200, JSON.stringify(byBarcode.body));
    assert.deepEqual([byBarcode.body.result.alias?.result, byBarcode.body.result.alias?.partId, byBarcode.body.result.aliasDenied],
      ["FOUND", "CW-P-0001", false]);
    assert.deepEqual(ids(byBarcode), ["CW-P-0001"]);

    // Only the scanner's fields leave the server.
    for (const p of byBarcode.body.result.parts) {
      for (const k of Object.keys(p.data)) assert.ok(http.SCANNER_PART_FIELDS.includes(k), `scanner saw a non-scanner field: ${k}`);
    }

    // Unknown is truthful: NOT_FOUND, no fallback partId, no Part.
    const unknown = await call(scanner, "lookupScannedPart", { rawValue: "BC-NOT-REGISTERED", partCode: "NOPE-000" });
    assert.equal(unknown.status, 200, JSON.stringify(unknown.body));
    assert.deepEqual([unknown.body.result.alias?.result, unknown.body.result.alias?.partId, ids(unknown)], ["NOT_FOUND", undefined, []]);

    // The request contract: rawValue and partCode only; non-empty; bounded. A blank scan is refused (was MALFORMED).
    for (const input of [{ rawValue: BARCODE, collection: "users" }, { rawValue: "x".repeat(300) }, { rawValue: "   " }]) {
      const r = await call(scanner, "lookupScannedPart", input);
      assert.deepEqual([r.status, r.body.code], [400, "INVALID_INPUT"], JSON.stringify(input));
      assert.equal(r.body.result, undefined);
    }

    // Tenant isolation: another tenant's scanner with the same rights resolves nothing of t1's.
    const other = await call(scannerT2, "lookupScannedPart", { rawValue: BARCODE, partCode: "CW-P-0001" });
    assert.equal(other.status, 200, JSON.stringify(other.body));
    assert.deepEqual([other.body.result.alias?.result, ids(other)], ["NOT_FOUND", []]);
  });
});
