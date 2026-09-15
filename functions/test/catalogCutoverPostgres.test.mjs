// CATALOG CUTOVER against a real postgres:16 -- the governed PostgreSQL catalog writers and the one-time
// COPY -> VERIFY, over fixture snapshots.
//
// Its OWN database, migrated by the normal runner, dropped in one t.after hook.
//
// ════════════════════ TWO SCHEMA STATES, BOTH PROVED ════════════════════
//
// Equipment Models live in eos_ops.equipment_models (migration 008, on main): every Equipment Model proof runs
// everywhere. Parts live in eos_ops.parts, which migration 025 creates (PR #1911, not on this branch) and deferred
// migration 027 extends. So:
//
//   * 025 ABSENT (this branch alone): the migration set is main's. Part proofs are SKIPPED with the reason, and the
//     copy is proved to REFUSE a snapshot carrying Parts (PART_TARGET_SCHEMA_ABSENT) rather than half-copy it.
//   * 025 PRESENT (after #1911 merges): the suite migrates a temporary directory of symlinks -- every applied
//     migration plus deferred/027 -- through the SAME runner, so 027 is executed exactly as it will be once moved,
//     and every Part proof runs. Nothing is copied or restated from 025.
//
// Same skip contract as every other Postgres suite: set POLICY_TEST_DATABASE_URL to run.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { cleanSnapshot, modelDoc, snapshotOf, wholeUnitPartDoc } from "./support/catalogSnapshotFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const eqWriter = require("../lib/catalogMaster/postgresEquipmentModelWriter.js");
const partWriter = require("../lib/catalogMaster/postgresPartMasterWriter.js");
const { copyCatalog, verifyCatalog, partMasterSchemaPresent, ABSENT_TENANT_PROBE } = require("../lib/catalogMaster/catalogCutover.js");
const { parseCatalogSnapshot, censusCatalogSnapshot } = require("../lib/catalogMaster/catalogSnapshot.js");

const MIGRATION_025 = "1759708800000_catalog-part-identity-reference-authority.sql";
const DEFERRED_027 = "1759881600000_catalog-master-descriptive-authority.sql";
const HAS_025 = existsSync(join(FUNCTIONS_DIR, "migrations", MIGRATION_025));
const PART_SKIP = HAS_025 ? false : "DEPENDS ON #1911: migration 025 (eos_ops.parts) is not in this tree; Part proofs run once it is";

const DB_NAME = `catalog_cutover_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

function migrationsDir() {
  if (!HAS_025) return { dir: join(FUNCTIONS_DIR, "migrations"), cleanup: () => {} };
  const dir = mkdtempSync(join(tmpdir(), "catalog-cutover-migrations-"));
  for (const f of readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"))) symlinkSync(join(FUNCTIONS_DIR, "migrations", f), join(dir, f));
  symlinkSync(join(FUNCTIONS_DIR, "migrations", "deferred", DEFERRED_027), join(dir, DEFERRED_027));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const runner = (dir, args) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", dir], {
  cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe", encoding: "utf8",
});

const EQ_CAPS = new Set(["equipment.model.manage"]);
const PART_CAPS = new Set(["inventory.catalog.manage", "inventory.catalog.activate"]);
const ALL_CAPS = new Set([...EQ_CAPS, ...PART_CAPS]);
const actor = (tenantId, principalId, capabilities = ALL_CAPS) => Object.freeze({ tenantId, principalId, capabilities });
const code = (c) => (e) => { assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`); return true; };
const CLOCK = () => new Date("2026-09-14T12:00:00.000Z");

test("catalog cutover, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  const migrations = migrationsDir();
  runner(migrations.dir, ["up"]);
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await pool.end();
    migrations.cleanup();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const deps = { pool, now: CLOCK };

  for (const tenant of ["t1", "t2", "t3", "t4", "t5"]) await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1)`, [tenant]);
  const principal = async (id, tenant, status = "active") => {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1, $1, 'proof', $2)`, [id, status]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1, $2, $3)`, [`m-${id}`, tenant, id]);
  };
  await principal("p1", "t1");
  await principal("p2", "t2");
  await principal("p-disabled", "t1", "disabled");

  const withPool = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };
  const auditCount = async (tenant) => Number((await q(`SELECT count(*) FROM eos_policy.audit_events WHERE tenant_id = $1`, [tenant])).rows[0].count);

  await t.test("schema state is the one this tree declares", async () => {
    assert.equal(await withPool(partMasterSchemaPresent), HAS_025);
  });

  // ════════════════════ the Equipment Model writer ════════════════════

  const MODEL = { manufacturerId: "acme", manufacturerName: "Acme Refrigeration", modelNumber: "cw 100", displayName: "Acme CW-100", status: "ACTIVE", sourceAuthority: "MANUFACTURER_CATALOG" };

  await t.test("equipment model create: canonical id, version 1, one audit row, tenant-scoped", async () => {
    const before = await auditCount("t1");
    const r = await eqWriter.createEquipmentModel(deps, actor("t1", "p1", EQ_CAPS), { model: MODEL });
    assert.deepEqual(r, { equipmentModelId: "ACME--CW-100", version: 1, replayed: false });
    const row = (await q(`SELECT model_number, version, created_by, tenant_id FROM eos_ops.equipment_models WHERE id = 'ACME--CW-100'`)).rows;
    assert.deepEqual(row, [{ model_number: "CW 100", version: 1, created_by: "p1", tenant_id: "t1" }]);
    assert.equal(await auditCount("t1"), before + 1);
    const audit = (await q(`SELECT action, target_kind, target_id, actor_uid FROM eos_policy.audit_events WHERE tenant_id = 't1' ORDER BY occurred_at DESC LIMIT 1`)).rows[0];
    assert.deepEqual(audit, { action: "catalog.equipmentModel.create", target_kind: "equipment_model", target_id: "ACME--CW-100", actor_uid: "p1" });
  });

  await t.test("equipment model create is idempotent by content: identical replays, different conflicts, nothing written", async () => {
    const before = await auditCount("t1");
    assert.deepEqual(await eqWriter.createEquipmentModel(deps, actor("t1", "p1"), { model: MODEL }), { equipmentModelId: "ACME--CW-100", version: 1, replayed: true });
    await assert.rejects(eqWriter.createEquipmentModel(deps, actor("t1", "p1"), { model: { ...MODEL, displayName: "different" } }), code("EQUIPMENT_MODEL_ALREADY_EXISTS"));
    assert.equal(await auditCount("t1"), before);
  });

  await t.test("the same canonical id in another tenant is a different record", async () => {
    const r = await eqWriter.createEquipmentModel(deps, actor("t2", "p2"), { model: { ...MODEL, displayName: "T2's own" } });
    assert.equal(r.replayed, false);
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.equipment_models WHERE id = 'ACME--CW-100'`)).rows[0].count), 2);
  });

  await t.test("equipment model update: expected version, identity immutable, replay, conflict, no-op", async () => {
    const a = actor("t1", "p1", EQ_CAPS);
    await assert.rejects(eqWriter.updateEquipmentModel(deps, a, { equipmentModelId: "ACME--CW-100", expectedVersion: 1, changes: { manufacturerId: "OTHER" } }), code("FIELD_NOT_UPDATABLE"));
    await assert.rejects(eqWriter.updateEquipmentModel(deps, a, { equipmentModelId: "ACME--CW-100", expectedVersion: 1, changes: { version: 9 } }), code("FIELD_NOT_UPDATABLE"));
    await assert.rejects(eqWriter.updateEquipmentModel(deps, a, { equipmentModelId: "ACME--CW-100", expectedVersion: 1, changes: { modelNumber: "CW 999" } }), code("EQUIPMENT_MODEL_INVALID"));
    const change = { equipmentModelId: "ACME--CW-100", expectedVersion: 1, changes: { status: "INACTIVE", displayName: "Acme CW-100 (legacy)" } };
    assert.deepEqual(await eqWriter.updateEquipmentModel(deps, a, change), { equipmentModelId: "ACME--CW-100", version: 2, replayed: false });
    assert.deepEqual(await eqWriter.updateEquipmentModel(deps, a, change), { equipmentModelId: "ACME--CW-100", version: 2, replayed: true });
    await assert.rejects(eqWriter.updateEquipmentModel(deps, a, { ...change, changes: { displayName: "racing" } }), code("VERSION_CONFLICT"));
    await assert.rejects(eqWriter.updateEquipmentModel(deps, a, { ...change, expectedVersion: 2 }), code("NO_CHANGES"));
    await assert.rejects(eqWriter.updateEquipmentModel(deps, actor("t2", "p2"), { ...change, expectedVersion: 5 }), code("VERSION_CONFLICT"));
    await assert.rejects(eqWriter.updateEquipmentModel(deps, a, { equipmentModelId: "ACME--NOPE", expectedVersion: 1, changes: { status: "ACTIVE" } }), code("EQUIPMENT_MODEL_NOT_FOUND"));
    const t2 = (await q(`SELECT version, display_name FROM eos_ops.equipment_models WHERE tenant_id = 't2' AND id = 'ACME--CW-100'`)).rows[0];
    assert.deepEqual(t2, { version: 1, display_name: "T2's own" }, "another tenant's record is untouched");
  });

  await t.test("authority: missing capability, non-member, disabled principal, allowlist -- all refused, nothing written", async () => {
    const count = async () => Number((await q(`SELECT count(*) FROM eos_ops.equipment_models`)).rows[0].count);
    const before = await count();
    const m2 = { ...MODEL, modelNumber: "CW-500" };
    await assert.rejects(eqWriter.createEquipmentModel(deps, actor("t1", "p1", PART_CAPS), { model: m2 }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(eqWriter.createEquipmentModel(deps, actor("t1", "p2"), { model: m2 }), code("ACTOR_NOT_TENANT_MEMBER"));
    await assert.rejects(eqWriter.createEquipmentModel(deps, actor("t1", "p-disabled"), { model: m2 }), code("ACTOR_NOT_TENANT_MEMBER"));
    await assert.rejects(eqWriter.createEquipmentModel(deps, actor("t1", "p1"), { model: { ...m2, version: 7 } }), code("FIELD_NOT_WRITABLE"));
    await assert.rejects(eqWriter.createEquipmentModel(deps, { tenantId: "t1", principalId: "p1", capabilities: ["equipment.model.manage"] }, { model: m2 }), code("ACTOR_CONTEXT_REQUIRED"));
    assert.equal(await count(), before);
  });

  await t.test("errors never leak SQL or driver detail", async () => {
    const broken = { pool: { connect: async () => { throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432 user=eos password=hunter2"), { code: "ECONNREFUSED" }); } } };
    await assert.rejects(eqWriter.createEquipmentModel(broken, actor("t1", "p1"), { model: MODEL }), (e) => e.code === "COMMAND_FAILED" && !/10\.0\.0\.1|hunter2|ECONNREFUSED/.test(e.message));
  });

  // ════════════════════ the Part Master writer (depends on #1911) ════════════════════

  await t.test("part writer: create, FK to the tenant's model, replay, conflict", { skip: PART_SKIP }, async () => {
    const a = actor("t1", "p1", PART_CAPS);
    const unit = { partId: "UNIT-CW-100", internalPartNumber: "UNIT-CW-100", name: "Acme CW-100 unit", status: "DRAFT", stockingUnit: "EACH",
      controlType: "SERIALIZED", stockingClass: "STOCKED", wholeUnit: true, equipmentModelId: "ACME--CW-100" };
    assert.deepEqual(await partWriter.createPart(deps, a, { part: unit }), { partId: "UNIT-CW-100", version: 1, replayed: false });
    assert.deepEqual(await partWriter.createPart(deps, a, { part: unit }), { partId: "UNIT-CW-100", version: 1, replayed: true });
    await assert.rejects(partWriter.createPart(deps, a, { part: { ...unit, name: "other" } }), code("PART_ALREADY_EXISTS"));
    await assert.rejects(partWriter.createPart(deps, a, { part: { ...unit, partId: "UNIT-X", internalPartNumber: "UNIT-X", equipmentModelId: "KOLD--KX-9" } }), code("EQUIPMENT_MODEL_NOT_FOUND"));
    await assert.rejects(partWriter.createPart(deps, actor("t2", "p2"), { part: { ...unit, equipmentModelId: "ACME--NOT-IN-T2" } }), code("EQUIPMENT_MODEL_NOT_FOUND"));
    await assert.rejects(partWriter.createPart(deps, a, { part: { ...unit, partId: "UNIT-Y", wholeUnit: false } }), code("PART_INVALID"));
    await assert.rejects(partWriter.createPart(deps, a, { part: { ...unit, partId: "UNIT-Y", version: 3 } }), code("FIELD_NOT_WRITABLE"));
    await assert.rejects(partWriter.createPart(deps, actor("t1", "p1", EQ_CAPS), { part: unit }), code("CAPABILITY_REQUIRED"));
  });

  await t.test("part writer: update rules -- control type immutable, internal part number fails closed, replay, conflict", { skip: PART_SKIP }, async () => {
    const a = actor("t1", "p1", PART_CAPS);
    const base = { partId: "UNIT-CW-100", expectedVersion: 1 };
    await assert.rejects(partWriter.updatePart(deps, a, { ...base, changes: { controlType: "LOT" } }), (e) => ["CONTROL_TYPE_IMMUTABLE", "PART_INVALID"].includes(e.code));
    await assert.rejects(partWriter.updatePart(deps, a, { ...base, changes: { controlType: "SERIALIZED_LOT" } }), code("CONTROL_TYPE_IMMUTABLE"));
    await assert.rejects(partWriter.updatePart(deps, a, { ...base, changes: { internalPartNumber: "UNIT-RENAMED" } }), code("INTERNAL_PART_NUMBER_ALIAS_AUTHORITY_UNAVAILABLE"));
    await assert.rejects(partWriter.updatePart(deps, a, { ...base, changes: { status: "ACTIVE" } }), code("FIELD_NOT_UPDATABLE"));
    const change = { ...base, changes: { name: "Acme CW-100 whole unit", controlType: "SERIALIZED", category: "UNITS" } };
    assert.deepEqual(await partWriter.updatePart(deps, a, change), { partId: "UNIT-CW-100", version: 2, replayed: false });
    assert.deepEqual(await partWriter.updatePart(deps, a, change), { partId: "UNIT-CW-100", version: 2, replayed: true });
    await assert.rejects(partWriter.updatePart(deps, a, { ...change, changes: { name: "racing" } }), code("VERSION_CONFLICT"));
    await assert.rejects(partWriter.updatePart(deps, a, { ...change, expectedVersion: 2 }), code("NO_CHANGES"));
  });

  await t.test("part writer: status transitions under inventory.catalog.activate, replay, terminal states", { skip: PART_SKIP }, async () => {
    const manage = actor("t1", "p1", new Set(["inventory.catalog.manage"]));
    const activate = actor("t1", "p1", new Set(["inventory.catalog.activate"]));
    await assert.rejects(partWriter.changePartStatus(deps, manage, { partId: "UNIT-CW-100", expectedVersion: 2, newStatus: "ACTIVE" }), code("CAPABILITY_REQUIRED"));
    await assert.rejects(partWriter.changePartStatus(deps, activate, { partId: "UNIT-CW-100", expectedVersion: 2, newStatus: "INACTIVE" }), code("ILLEGAL_TRANSITION"));
    assert.deepEqual(await partWriter.changePartStatus(deps, activate, { partId: "UNIT-CW-100", expectedVersion: 2, newStatus: "ACTIVE" }), { partId: "UNIT-CW-100", version: 3, replayed: false });
    assert.deepEqual(await partWriter.changePartStatus(deps, activate, { partId: "UNIT-CW-100", expectedVersion: 2, newStatus: "ACTIVE" }), { partId: "UNIT-CW-100", version: 3, replayed: true });
    assert.deepEqual(await partWriter.changePartStatus(deps, activate, { partId: "UNIT-CW-100", expectedVersion: 3, newStatus: "DISCONTINUED" }), { partId: "UNIT-CW-100", version: 4, replayed: false });
    await assert.rejects(partWriter.changePartStatus(deps, activate, { partId: "UNIT-CW-100", expectedVersion: 4, newStatus: "ACTIVE" }), code("ILLEGAL_TRANSITION"));
    await assert.rejects(partWriter.changePartStatus(deps, actor("t2", "p2"), { partId: "UNIT-CW-100", expectedVersion: 4, newStatus: "ACTIVE" }), code("PART_NOT_FOUND"));
  });

  // ════════════════════ COPY ONCE -> VERIFY ════════════════════

  const censusOf = (snap, decision = null) => censusCatalogSnapshot(parseCatalogSnapshot(snap), decision);
  const modelsOnly = () => { const s = cleanSnapshot(); s.parts = []; return s; };

  await t.test("copy refuses Parts when eos_ops.parts has no Part Master schema, and writes nothing", { skip: HAS_025 ? "025 present: the Part schema exists" : false }, async () => {
    const { census, catalog } = censusOf(cleanSnapshot());
    await assert.rejects(withPool((c) => copyCatalog(c, { tenantId: "t3", performedBy: "op", catalog, canonicalDigest: census.canonicalDigest })), code("PART_TARGET_SCHEMA_ABSENT"));
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.equipment_models WHERE tenant_id = 't3'`)).rows[0].count), 0);
  });

  const COPY_SNAPSHOT = () => (HAS_025 ? cleanSnapshot() : modelsOnly());

  await t.test("copy populates the tenant with exact ids, versions and timestamps, and one audit row", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    assert.equal(census.copyReady, true);
    const report = await withPool((c) => copyCatalog(c, { tenantId: "t3", performedBy: "operator.jane", catalog, canonicalDigest: census.canonicalDigest, now: CLOCK() }));
    assert.equal(report.outcome, "COPIED");
    assert.deepEqual(report.equipmentModels, { inserted: 3, unchanged: 0 });
    assert.deepEqual(report.parts, { inserted: HAS_025 ? 4 : 0, unchanged: 0 });
    const rows = (await q(`SELECT id, version, status::text, created_by, updated_by, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
                             FROM eos_ops.equipment_models WHERE tenant_id = 't3' ORDER BY id`)).rows;
    assert.deepEqual(rows.map((r) => r.id), ["ACME--CW-100", "ACME--CW-200", "KOLD--KX-9"]);
    assert.ok(rows.every((r) => r.version === 3 && r.created_by === "catalog-cutover:operator.jane" && r.created_at === "2025-09-04T15:33:20.123456Z"));
    if (HAS_025) {
      const parts = (await q(`SELECT id, equipment_model_id, whole_unit FROM eos_ops.parts WHERE tenant_id = 't3' ORDER BY id`)).rows;
      assert.deepEqual(parts, [
        { id: "TST-1001", equipment_model_id: null, whole_unit: false }, { id: "TST-1002", equipment_model_id: null, whole_unit: false },
        { id: "TST-1003", equipment_model_id: null, whole_unit: false }, { id: "UNIT-CW-100", equipment_model_id: "ACME--CW-100", whole_unit: true },
      ]);
    }
    const audit = (await q(`SELECT action, target_kind, target_id FROM eos_policy.audit_events WHERE tenant_id = 't3'`)).rows;
    assert.deepEqual(audit, [{ action: "catalog.cutover.copy", target_kind: "catalog_snapshot", target_id: census.canonicalDigest }]);
  });

  await t.test("verify reconciles counts, identities and EVERY field, with reference verdict spot-checks", async () => {
    const { catalog } = censusOf(COPY_SNAPSHOT());
    const report = await withPool((c) => verifyCatalog(c, { tenantId: "t3", catalog, sample: "all" }));
    assert.equal(report.reconciled, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.counts, { equipmentModels: { source: 3, target: 3 }, parts: { source: HAS_025 ? 4 : 0, target: HAS_025 ? 4 : 0 } });
    assert.deepEqual(report.sampled, { equipmentModels: 3, parts: HAS_025 ? 4 : 0 });
    const verdicts = report.verdictChecks;
    assert.ok(verdicts.some((v) => v.kind === "EQUIPMENT_MODEL" && v.tenant === "t3" && v.actual === "FOUND"));
    assert.ok(verdicts.some((v) => v.kind === "EQUIPMENT_MODEL" && v.tenant === ABSENT_TENANT_PROBE && v.actual === "NOT_FOUND"));
    assert.ok(verdicts.some((v) => v.ref === "catalog-cutover-verify-absent-ref" && v.actual === "NOT_FOUND"));
    if (HAS_025) {
      assert.ok(verdicts.some((v) => v.kind === "PART" && v.tenant === "t3" && v.actual === "FOUND"));
      assert.ok(verdicts.some((v) => v.kind === "PART" && v.tenant === "t3" && v.actual === "WRONG_KIND"));
      assert.ok(verdicts.some((v) => v.kind === "EQUIPMENT_MODEL" && v.tenant === "t3" && v.actual === "WRONG_KIND"));
    }
  });

  await t.test("rerun of the identical snapshot is a no-op: no insert, no update, no audit row", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    const snapshotRows = async () => (await q(`SELECT * FROM eos_ops.equipment_models WHERE tenant_id = 't3' ORDER BY id`)).rows;
    const before = JSON.stringify(await snapshotRows());
    const audits = await auditCount("t3");
    const report = await withPool((c) => copyCatalog(c, { tenantId: "t3", performedBy: "operator.bob", catalog, canonicalDigest: census.canonicalDigest }));
    assert.equal(report.outcome, "NO_CHANGES");
    assert.deepEqual(report.equipmentModels, { inserted: 0, unchanged: 3 });
    assert.equal(JSON.stringify(await snapshotRows()), before);
    assert.equal(await auditCount("t3"), audits);
  });

  await t.test("a source that changed after the copy is DRIFT -- refused, reported, never overwritten, and nothing else is written", async () => {
    const s = COPY_SNAPSHOT();
    s.equipmentModels[0] = modelDoc("ACME--CW-100", { displayName: "renamed in Firestore after the copy", version: 4 });
    s.equipmentModels.push(modelDoc("ACME--CW-NEW"));
    const { census, catalog } = censusOf(s);
    await assert.rejects(withPool((c) => copyCatalog(c, { tenantId: "t3", performedBy: "op", catalog, canonicalDigest: census.canonicalDigest })), (e) => {
      assert.equal(e.code, "DRIFT_DETECTED");
      assert.deepEqual(e.details, [{ kind: "equipment_model", id: "ACME--CW-100", fields: ["displayName", "version"] }]);
      return true;
    });
    const row = (await q(`SELECT display_name, version FROM eos_ops.equipment_models WHERE tenant_id = 't3' AND id = 'ACME--CW-100'`)).rows[0];
    assert.deepEqual(row, { display_name: "Model CW-100", version: 3 });
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.equipment_models WHERE tenant_id = 't3' AND id = 'ACME--CW-NEW'`)).rows[0].count), 0, "the new record in the same run was rolled back too");
    const verify = await withPool((c) => verifyCatalog(c, { tenantId: "t3", catalog, sample: "all" }));
    assert.equal(verify.reconciled, false);
    assert.deepEqual(verify.identity.missingInTarget, ["equipment_model:ACME--CW-NEW"]);
    assert.deepEqual(verify.fieldMismatches, [{ kind: "equipment_model", id: "ACME--CW-100", fields: ["displayName", "version"] }]);
  });

  await t.test("a tenant row the snapshot does not contain is refused, not deleted", async () => {
    const s = COPY_SNAPSHOT();
    s.equipmentModels = s.equipmentModels.filter((d) => d.id !== "KOLD--KX-9");
    if (HAS_025) s.parts = s.parts.filter((d) => d.id !== "TST-1003");
    const { census, catalog } = censusOf(s);
    await assert.rejects(withPool((c) => copyCatalog(c, { tenantId: "t3", performedBy: "op", catalog, canonicalDigest: census.canonicalDigest })), code("TARGET_HAS_UNKNOWN_RECORDS"));
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.equipment_models WHERE tenant_id = 't3'`)).rows[0].count), 3);
  });

  await t.test("tenant scoping: another tenant's catalog neither satisfies nor blocks this tenant's copy, and verify sees only its own", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    // t2 holds ACME--CW-100 (from the writer proofs) with different content: that is t2's record, not drift for t4.
    const report = await withPool((c) => copyCatalog(c, { tenantId: "t4", performedBy: "op", catalog, canonicalDigest: census.canonicalDigest }));
    assert.deepEqual(report.equipmentModels, { inserted: 3, unchanged: 0 });
    const unrelated = await withPool((c) => verifyCatalog(c, { tenantId: "t5", catalog, sample: "all" }));
    assert.equal(unrelated.reconciled, false);
    assert.equal(unrelated.counts.equipmentModels.target, 0);
    assert.equal(unrelated.identity.missingInTarget.length, catalog.equipmentModels.length + catalog.parts.length);
    assert.ok(unrelated.verdictChecks.every((v) => v.actual === "NOT_FOUND"), "nothing of t3/t4 is visible from t5");
  });

  await t.test("a missing tenant is refused; the copy never creates one", async () => {
    const { census, catalog } = censusOf(modelsOnly());
    await assert.rejects(withPool((c) => copyCatalog(c, { tenantId: "t-nope", performedBy: "op", catalog, canonicalDigest: census.canonicalDigest })), code("TENANT_NOT_FOUND"));
  });

  await t.test("migration 027 refuses to be reversed while Part Master records exist", { skip: PART_SKIP }, async () => {
    assert.throws(() => runner(migrations.dir, ["down", "1"]), /migration 027 cannot be reversed/);
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.parts`)).rows[0].count) > 0, true);
  });

  // ════════════════════ the operator CLI, end to end ════════════════════

  await t.test("CLI: census -> copy -> verify -> rerun, and a duplicate identity refuses the copy with nothing written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cutover-cli-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('tenant-cli', 'taylor-nonprod-cli', 'CLI proof')`);
    const run = (mode, snapshot, extra = []) => {
      const file = join(dir, `${mode}-${randomUUID()}.json`);
      writeFileSync(file, JSON.stringify(snapshot));
      const res = spawnSync(process.execPath, ["scripts/catalogCutover.js", "--mode", mode, "--environment", "platform-sandbox", "--databaseUrlEnv", "CATALOG_TEST_DB",
        "--tenantKey", "taylor-nonprod-cli", "--snapshot", file, ...extra], {
        cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", CATALOG_TEST_DB: dbUrl() },
      });
      return { status: res.status, out: res.stdout, err: res.stderr };
    };
    const snap = COPY_SNAPSHOT();
    const census = run("census", snap);
    assert.equal(census.status, 0, census.err);
    assert.equal(JSON.parse(census.out).target.equipmentModels, 0);
    assert.doesNotMatch(census.out + census.err, new RegExp(new URL(URL_BASE).password || "no-password-to-leak"));

    const dup = COPY_SNAPSHOT();
    dup.equipmentModels.push(modelDoc("ACME--CW-100"));
    const refused = run("copy", dup, ["--performedBy", "op"]);
    assert.equal(refused.status, 2);
    // (With Parts present the duplicated model is also unselectable, so the whole unit naming it is a missing reference too.)
    assert.ok(JSON.parse(refused.out).blockers.includes("DUPLICATE_CANONICAL_IDENTITY"));
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.equipment_models WHERE tenant_id = 'tenant-cli'`)).rows[0].count), 0);

    const missing = snapshotOf({ equipmentModels: [modelDoc("ACME--CW-100")], parts: [wholeUnitPartDoc("UNIT-Z", "ACME--GONE-1")] });
    const missingRun = run("copy", missing, ["--performedBy", "op"]);
    assert.equal(missingRun.status, 2);
    assert.deepEqual(JSON.parse(missingRun.out).blockers, ["MISSING_REFERENCES"]);

    const copied = run("copy", snap, ["--performedBy", "op"]);
    assert.equal(copied.status, 0, copied.err);
    assert.equal(JSON.parse(copied.out).report.outcome, "COPIED");
    const verified = run("verify", snap, ["--sample", "all"]);
    assert.equal(verified.status, 0, verified.err);
    assert.equal(JSON.parse(verified.out).report.reconciled, true);
    const rerun = run("copy", snap, ["--performedBy", "op"]);
    assert.equal(JSON.parse(rerun.out).report.outcome, "NO_CHANGES");

    const foreign = run("census", { ...snap, source: { ...snap.source, firebaseProjectId: "taylor-parts" } });
    assert.equal(foreign.status, 2);
    assert.match(foreign.err, /production project 'taylor-parts'/);
    const otherProject = run("census", { ...snap, source: { ...snap.source, firebaseProjectId: "eos-platform-integration" } });
    assert.equal(otherProject.status, 2);
    assert.match(otherProject.err, /declares 'eos-platform-sandbox'/);
  });
});
