// THE POSTGRESQL PART ALIAS AUTHORITY, against a real postgres:16.
//
// The authority this suite proves is the one whose ABSENCE made `updatePart` refuse an
// internalPartNumber change. So the centre of it is not "an alias row can be written" -- it is that
// renaming a Part preserves the old number ATOMICALLY, and that a conflict refuses the whole update
// rather than leaving a renamed Part whose previous number resolves to somebody else.
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
const partWriter = require("../lib/catalogMaster/postgresPartMasterWriter.js");
const aliasWriter = require("../lib/catalogMaster/postgresPartAliasWriter.js");
const eqWriter = require("../lib/catalogMaster/postgresEquipmentModelWriter.js");
const { deriveAliasDocId } = require("../lib/partMaster/partAliasRepository.js");

const DB_NAME = `cat_alias_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const CAPS = new Set(["inventory.catalog.manage", "inventory.catalog.activate", "equipment.model.manage"]);
const actor = (tenantId, principalId, capabilities = CAPS) => Object.freeze({ tenantId, principalId, capabilities });
const code = (c) => (e) => { assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`); return true; };
const CLOCK = () => new Date("2026-09-20T12:00:00.000Z");

test("the PostgreSQL Part Alias authority", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const deps = { pool, now: CLOCK };

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  const principal = async (id, tenant) => {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [id]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${id}`, tenant, id]);
  };
  await principal("p1", "t1");
  await principal("p2", "t2");
  const a1 = actor("t1", "p1");

  const partOf = (partId, internalPartNumber) => ({
    partId, internalPartNumber, name: `Part ${partId}`, status: "ACTIVE", category: "COMPRESSOR",
    stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
    flags: { expiryTracked: false, consumable: false, returnableCore: false },
    wholeUnit: false,
  });
  const makePart = async (partId, ipn) => partWriter.createPart(deps, a1, { part: partOf(partId, ipn) });
  await makePart("P-1", "IPN-0001");
  await makePart("P-2", "IPN-0002");

  const withClientOf = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };
  const aliasRow = (aliasId) => q(`SELECT * FROM eos_ops.part_aliases WHERE tenant_id='t1' AND id=$1`, [aliasId]);
  const aliasCount = async () => Number((await q(`SELECT count(*)::int n FROM eos_ops.part_aliases`)).rows[0].n);

  // ════════════════════════════ IDENTITY ════════════════════════════

  await t.test("alias identity is DERIVED by the existing authority, never generated", async () => {
    const r = await aliasWriter.createPartAlias(deps, a1, {
      partId: "P-1", aliasType: "SUPPLIER_SKU", rawValue: "sku-abc 123",
    });
    const derived = deriveAliasDocId("SUPPLIER_SKU", "sku-abc 123");
    assert.equal(r.aliasId, derived.docId, "the id comes from normalization + buildAliasKey + encodeAliasDocId");
    assert.equal(r.aliasId, "SUPPLIER_SKU__SKU-ABC 123", "normalization upper-cases and collapses whitespace");
    const { rows } = await aliasRow(r.aliasId);
    assert.equal(rows[0].normalized_value, derived.normalizedValue);
    assert.equal(rows[0].original_value, "sku-abc 123", "what a person typed is preserved verbatim");
    assert.equal(rows[0].provenance, "NATIVE");
    assert.equal(rows[0].version, 1);
    assert.equal(rows[0].status, "ACTIVE");
  });

  await t.test("the same identifier, however it is typed, is the SAME identity", async () => {
    // Case and whitespace are normalization's business, not the caller's.
    const again = await aliasWriter.createPartAlias(deps, a1, {
      partId: "P-1", aliasType: "SUPPLIER_SKU", rawValue: "  SKU-ABC   123 ",
    });
    assert.equal(again.replayed, true, "an equivalent ACTIVE alias for the same part is idempotent-equivalent");
    assert.equal(await aliasCount(), 1, "and never a second row");
  });

  await t.test("one identity cannot resolve to two Parts", async () => {
    await assert.rejects(
      aliasWriter.createPartAlias(deps, a1, { partId: "P-2", aliasType: "SUPPLIER_SKU", rawValue: "SKU-ABC 123" }),
      code("ALIAS_IDENTITY_OWNED_BY_ANOTHER_PART"));
  });

  await t.test("a dangling alias is impossible", async () => {
    await assert.rejects(
      aliasWriter.createPartAlias(deps, a1, { partId: "P-NOPE", aliasType: "LEGACY", rawValue: "OLD-1" }),
      code("PART_NOT_FOUND"));
    // And the foreign key holds even against a direct write.
    await assert.rejects(
      q(`INSERT INTO eos_ops.part_aliases (id, tenant_id, part_id, alias_type, original_value, normalized_value,
                                           status, source, version, provenance, created_at, created_by, updated_at, updated_by)
         VALUES ('LEGACY__X','t1','P-NOPE','LEGACY','X','X','ACTIVE','manual',1,'NATIVE',now(),'p1',now(),'p1')`),
      /part_alias_part_same_tenant|foreign key/);
  });

  await t.test("a MANUFACTURER_PN carries its scope, and no other type may", async () => {
    const r = await aliasWriter.createPartAlias(deps, a1, {
      partId: "P-1", aliasType: "MANUFACTURER_PN", rawValue: "MPN-77", manufacturerId: "acme",
    });
    assert.match(r.aliasId, /^MANUFACTURER_PN__acme\|MPN-77$/);
    await assert.rejects(
      aliasWriter.createPartAlias(deps, a1, { partId: "P-1", aliasType: "LEGACY", rawValue: "L-1", manufacturerId: "acme" }),
      code("ALIAS_VALUE_MALFORMED"));
    // No foreign key to Manufacturer: that master is outside this slice.
    const fks = await q(`SELECT count(*)::int n FROM pg_constraint
                          WHERE conrelid='eos_ops.part_aliases'::regclass AND contype='f'
                            AND pg_get_constraintdef(oid) ILIKE '%manufacturer%'`);
    assert.equal(fks.rows[0].n, 0, "manufacturer master is outside the Catalog slice");
  });

  await t.test("a malformed identifier is refused, never stored", async () => {
    await assert.rejects(
      aliasWriter.createPartAlias(deps, a1, { partId: "P-1", aliasType: "UPC", rawValue: "12345" }),
      code("ALIAS_VALUE_MALFORMED"));
  });

  // ════════════════════════════ LIFECYCLE ════════════════════════════

  await t.test("deactivate and reactivate are governed facts; DELETE is refused", async () => {
    const created = await aliasWriter.createPartAlias(deps, a1, { partId: "P-2", aliasType: "LEGACY", rawValue: "OLD-P2" });
    const off = await aliasWriter.deactivatePartAlias(deps, a1, { aliasId: created.aliasId, expectedVersion: 1 });
    assert.equal(off.status, "INACTIVE");
    assert.equal(off.version, 2);
    let row = (await aliasRow(created.aliasId)).rows[0];
    assert.ok(row.deactivated_at, "an INACTIVE alias states when");
    assert.equal(row.deactivated_by, "p1", "and by whom");

    const on = await aliasWriter.reactivatePartAlias(deps, a1, { aliasId: created.aliasId, expectedVersion: 2 });
    assert.equal(on.status, "ACTIVE");
    row = (await aliasRow(created.aliasId)).rows[0];
    assert.equal(row.deactivated_at, null, "reactivation clears the deactivation moment");

    await assert.rejects(q(`DELETE FROM eos_ops.part_aliases WHERE tenant_id='t1' AND id=$1`, [created.aliasId]),
      /deactivated, never deleted/);
  });

  await t.test("version conflict and replay behave as the rest of the catalog does", async () => {
    const created = await aliasWriter.createPartAlias(deps, a1, { partId: "P-2", aliasType: "CUSTOMER_REF", rawValue: "CR-9" });
    await aliasWriter.deactivatePartAlias(deps, a1, { aliasId: created.aliasId, expectedVersion: 1 });
    const replay = await aliasWriter.deactivatePartAlias(deps, a1, { aliasId: created.aliasId, expectedVersion: 1 });
    assert.equal(replay.replayed, true, "the same command at the same expected version replays");
    await assert.rejects(
      aliasWriter.deactivatePartAlias(deps, a1, { aliasId: created.aliasId, expectedVersion: 99 }),
      code("VERSION_CONFLICT"));
  });

  // ════════════════════════════ THE ATOMIC RENAME ════════════════════════════

  await t.test("renaming a Part preserves the OLD internal part number, atomically", async () => {
    await makePart("P-RENAME", "IPN-OLD");
    const before = await aliasCount();
    const updated = await partWriter.updatePart(deps, a1, {
      partId: "P-RENAME", expectedVersion: 1, changes: { internalPartNumber: "IPN-NEW" },
    });
    assert.equal(updated.version, 2);
    const expectedAlias = deriveAliasDocId("INTERNAL_PN", "IPN-OLD").docId;
    assert.equal(updated.preservedAliasId, expectedAlias);
    assert.equal(await aliasCount(), before + 1);

    const row = (await aliasRow(expectedAlias)).rows[0];
    assert.equal(row.part_id, "P-RENAME", "the old number resolves to the SAME part");
    assert.equal(row.status, "ACTIVE");
    assert.equal(row.alias_type, "INTERNAL_PN");
    assert.equal(row.source, "internal-part-number-preservation", "the row says why it exists");
    assert.equal(row.created_by, "p1");

    const part = (await q(`SELECT internal_part_number FROM eos_ops.parts WHERE tenant_id='t1' AND id='P-RENAME'`)).rows[0];
    assert.equal(part.internal_part_number, "IPN-NEW");
  });

  await t.test("a conflicting alias refuses the ENTIRE Part update", async () => {
    // P-OTHER already owns the number P-CONFLICT is about to rename INTO.
    await makePart("P-OTHER", "IPN-TAKEN");
    await makePart("P-CONFLICT", "IPN-C1");
    const aliasesBefore = await aliasCount();
    const partBefore = (await q(`SELECT internal_part_number, version FROM eos_ops.parts WHERE tenant_id='t1' AND id='P-CONFLICT'`)).rows[0];
    await aliasWriter.createPartAlias(deps, a1, { partId: "P-OTHER", aliasType: "INTERNAL_PN", rawValue: "IPN-TARGET" });

    await assert.rejects(
      partWriter.updatePart(deps, a1, { partId: "P-CONFLICT", expectedVersion: 1, changes: { internalPartNumber: "IPN-TARGET" } }),
      code("ALIAS_IDENTITY_OWNED_BY_ANOTHER_PART"));

    const partAfter = (await q(`SELECT internal_part_number, version FROM eos_ops.parts WHERE tenant_id='t1' AND id='P-CONFLICT'`)).rows[0];
    assert.equal(partAfter.internal_part_number, partBefore.internal_part_number, "NO Part update");
    assert.equal(partAfter.version, partBefore.version);
    assert.equal(await aliasCount(), aliasesBefore + 1, "only the alias this test created deliberately");
  });

  await t.test("a rename whose OLD number is a DEACTIVATED alias of this part refuses, rather than silently reactivating", async () => {
    await makePart("P-DEACT", "IPN-D1");
    const alias = await aliasWriter.createPartAlias(deps, a1, { partId: "P-DEACT", aliasType: "INTERNAL_PN", rawValue: "IPN-D1" });
    await aliasWriter.deactivatePartAlias(deps, a1, { aliasId: alias.aliasId, expectedVersion: 1 });
    await assert.rejects(
      partWriter.updatePart(deps, a1, { partId: "P-DEACT", expectedVersion: 1, changes: { internalPartNumber: "IPN-D2" } }),
      code("ALIAS_INACTIVE_FOR_THIS_PART"));
  });

  await t.test("an ordinary field update creates no alias at all", async () => {
    await makePart("P-PLAIN", "IPN-PLAIN");
    const before = await aliasCount();
    const r = await partWriter.updatePart(deps, a1, { partId: "P-PLAIN", expectedVersion: 1, changes: { name: "Renamed label" } });
    assert.equal(r.version, 2);
    assert.equal(r.preservedAliasId, undefined);
    assert.equal(await aliasCount(), before);
  });

  await t.test("INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE is gone, because the authority exists", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/catalogMaster/postgresPartMasterWriter.ts"), "utf8");
    const executable = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    assert.equal(executable.includes("INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE"), false,
      "the refusal goes only because the gap it protected is closed");
    assert.ok(executable.includes("preserveInternalPartNumberAlias"), "and the rule it protected is enforced instead");
  });

  // ════════════════════════════ READS ════════════════════════════

  await t.test("alias administration lists a Part's identifiers with their ORIGINAL values", async () => {
    const rows = await withClientOf((c) => aliasWriter.listPartAliases(c, "t1", "P-1"));
    assert.ok(rows.length >= 2);
    assert.ok(rows.some((r) => r.originalValue === "sku-abc 123"),
      "a person correcting a mis-typed SKU has to see what was typed");
    assert.ok(rows.every((r) => r.partId === "P-1"));
  });

  await t.test("the scanner resolves through the SHARED fan-out: FOUND, INACTIVE, NOT_FOUND, MALFORMED", async () => {
    await withClientOf(async (c) => {
      const found = await aliasWriter.resolveScannedPartIdentifier(c, "t1", { rawValue: "sku-abc 123" });
      assert.equal(found.result, "FOUND");
      assert.equal(found.partId, "P-1");
      assert.equal(found.aliasType, "SUPPLIER_SKU");

      const direct = await aliasWriter.probePartAlias(c, "t1", { aliasType: "INTERNAL_PN", rawValue: "IPN-OLD" });
      assert.equal(direct.result, "FOUND", "a preserved historical part number still resolves");
      assert.equal(direct.partId, "P-RENAME");

      const off = await aliasWriter.createPartAlias(deps, a1, { partId: "P-2", aliasType: "VENDOR_REF", rawValue: "VR-OFF" });
      await aliasWriter.deactivatePartAlias(deps, a1, { aliasId: off.aliasId, expectedVersion: 1 });
      const inactive = await aliasWriter.resolveScannedPartIdentifier(c, "t1", { rawValue: "VR-OFF" });
      assert.equal(inactive.result, "INACTIVE", "a switched-off identifier is not NOT_FOUND");
      assert.equal(inactive.partId, "P-2");

      const missing = await aliasWriter.resolveScannedPartIdentifier(c, "t1", { rawValue: "NOTHING-HERE" });
      assert.equal(missing.result, "NOT_FOUND");

      const malformed = await aliasWriter.resolveScannedPartIdentifier(c, "t1", { rawValue: "   " });
      assert.equal(malformed.result, "MALFORMED");
    });
  });

  await t.test("resolution is TENANT SCOPED: another tenant's identifier is not found", async () => {
    await withClientOf(async (c) => {
      const other = await aliasWriter.resolveScannedPartIdentifier(c, "t2", { rawValue: "sku-abc 123" });
      assert.equal(other.result, "NOT_FOUND");
    });
  });

  // ════════════════════════════ ACTOR AND AUTHORIZATION ════════════════════════════

  await t.test("authorization is required, and refusal writes nothing", async () => {
    const before = await aliasCount();
    await assert.rejects(
      aliasWriter.createPartAlias(deps, actor("t1", "p1", new Set()), { partId: "P-1", aliasType: "LEGACY", rawValue: "NOPE" }),
      (e) => { assert.equal(e.category, "FORBIDDEN"); return true; });
    assert.equal(await aliasCount(), before);
  });

  await t.test("no Firebase uid is ever written as the business actor", async () => {
    // Every actor column names a Principal of this tenant. A uid would not.
    const bad = await q(
      `SELECT count(*)::int n FROM eos_ops.part_aliases a
        WHERE a.tenant_id='t1' AND a.provenance='NATIVE'
          AND NOT EXISTS (SELECT 1 FROM eos_policy.tenant_memberships m
                           WHERE m.tenant_id=a.tenant_id AND m.principal_id=a.created_by)`);
    assert.equal(bad.rows[0].n, 0);
    const uidShaped = await q(
      `SELECT count(*)::int n FROM information_schema.columns
        WHERE table_schema='eos_ops' AND table_name='part_aliases'
          AND (column_name LIKE '%uid%' OR column_name LIKE '%external_subject%')`);
    assert.equal(uidShaped.rows[0].n, 0, "no column here can even hold an external subject");
  });

  await t.test("a NATIVE row may not hide an unresolved actor; MIGRATED may be truthful about one", async () => {
    await assert.rejects(
      q(`INSERT INTO eos_ops.part_aliases (id, tenant_id, part_id, alias_type, original_value, normalized_value,
                                           status, source, version, provenance, created_at, created_by, updated_at, updated_by)
         VALUES ('LEGACY__NATIVE-NULL','t1','P-1','LEGACY','x','X','ACTIVE','manual',1,'NATIVE',now(),NULL,now(),NULL)`),
      /part_alias_native_actors_present/);
    // MIGRATED is allowed to say "this historical actor is unknown" rather than invent one.
    await q(`INSERT INTO eos_ops.part_aliases (id, tenant_id, part_id, alias_type, original_value, normalized_value,
                                               status, source, version, provenance, created_at, created_by, updated_at, updated_by)
             VALUES ('LEGACY__MIGRATED-NULL','t1','P-1','LEGACY','y','Y','ACTIVE','import',1,'MIGRATED',now(),NULL,now(),NULL)`);
    const row = (await aliasRow("LEGACY__MIGRATED-NULL")).rows[0];
    assert.equal(row.created_by, null, "the historical absence is recorded, not substituted");
  });

  await t.test("the audit carries a FINGERPRINT, never the raw identifier", async () => {
    const { rows } = await q(
      `SELECT after FROM eos_policy.audit_events WHERE tenant_id='t1' AND action = 'catalog.partAlias.create' ORDER BY occurred_at LIMIT 1`);
    const after = rows[0].after;
    assert.match(after.valueFingerprint, /^[0-9a-f]{16}$/);
    const serialized = JSON.stringify(rows.map((r) => r.after));
    assert.equal(serialized.includes("SKU-ABC"), false, "an audit trail outlives the controls around the original");
  });

  await t.test("the Catalog alias migration sorts after every migration already applied, and collides with none", async () => {
    // Authored as 1762560000000; renumbered to 1763164800000 when the coordinated Catalog + Reorder activation candidate
    // was assembled on current main, because node-pg-migrate refuses an unapplied migration that precedes applied ones
    // (main had reached 1763078400000). The Reorder migrations follow it, in their authored order.
    const { readdirSync } = await import("node:fs");
    const all = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"));
    const ours = all.filter((f) => f.startsWith("1763164800000_"));
    assert.deepEqual(ours, ["1763164800000_catalog-part-alias-authority.sql"], "exactly one migration holds the Catalog alias id");
    const earlierMain = all.map((f) => Number(f.split("_")[0])).filter((n) => n < 1763164800000);
    assert.ok(Math.max(...earlierMain) === 1763078400000, "the Catalog alias migration follows main's last applied migration");
  });
});
