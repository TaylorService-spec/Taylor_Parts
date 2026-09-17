// CATALOG CUTOVER against a real postgres:16 -- the governed PostgreSQL catalog writers and the one-time
// COPY -> VERIFY, over fixture snapshots.
//
// Its OWN database, migrated by the normal runner from functions/migrations, dropped in one t.after hook. Every proof
// runs unconditionally: migration 026 (eos_ops.parts, #1911) and 027 (its Part Master columns) are both in the applied
// set, pinned by name below.
//
// Same skip contract as every other Postgres suite: set POLICY_TEST_DATABASE_URL to run.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { hash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { migrationFiles } from "./support/migrationSchema.mjs";
import pg from "pg";
import { cleanSnapshot, modelDoc, partDoc, snapshotOf, wholeUnitPartDoc } from "./support/catalogSnapshotFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const eqWriter = require("../lib/catalogMaster/postgresEquipmentModelWriter.js");
const partWriter = require("../lib/catalogMaster/postgresPartMasterWriter.js");
const { copyCatalog, verifyCatalog, partMasterSchemaPresent, ABSENT_TENANT_PROBE } = require("../lib/catalogMaster/catalogCutover.js");
const { parseCatalogSnapshot, censusCatalogSnapshot } = require("../lib/catalogMaster/catalogSnapshot.js");

const MIGRATION_026 = "1759795200000_catalog-part-identity-reference-authority.sql";
const MIGRATION_027 = "1759881600000_catalog-master-descriptive-authority.sql";
const { createPostgresCatalogReferenceAuthority } = require("../lib/catalogAuthority/postgresCatalogReferenceAuthority.js");

const DB_NAME = `catalog_cutover_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const runner = (args) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations"], {
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
  // Migrated THROUGH 027 by count (the Sample Company pin technique): the 027 rollback-guard proof below uses `down 1`,
  // which reaches 027 only while it is the last-run migration. Later migrations are not what this suite proves.
  const sqlFiles = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const through027 = sqlFiles.indexOf("1759881600000_catalog-master-descriptive-authority.sql") + 1;
  assert.ok(through027 > 0, "migration 027 is missing");
  runner(["up", String(through027)]);
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await pool.end();
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
  await principal("p-cutover-t3", "t3");
  await principal("p-cutover-t4", "t4");

  const withPool = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };
  const auditCount = async (tenant) => Number((await q(`SELECT count(*) FROM eos_policy.audit_events WHERE tenant_id = $1`, [tenant])).rows[0].count);

  await t.test("migrations 026 and 027 are applied, by name, and the Part Master schema is present", async () => {
    const applied = (await q(`SELECT name FROM public.pgmigrations ORDER BY run_on, id`)).rows.map((r) => r.name);
    assert.ok(migrationFiles().includes(MIGRATION_027));
    for (const m of [MIGRATION_026, MIGRATION_027]) assert.ok(applied.includes(m.replace(/\.sql$/, "")), `${m} applied`);
    assert.equal(await withPool(partMasterSchemaPresent), true);
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

  // ════════════════════ the Part Master writer ════════════════════

  await t.test("part writer: create, FK to the tenant's model, replay, conflict", async () => {
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

  await t.test("part writer: update rules -- control type immutable, internal part number fails closed, replay, conflict", async () => {
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

  await t.test("part writer: status transitions under inventory.catalog.activate, replay, terminal states", async () => {
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

  const censusOf = (snap) => censusCatalogSnapshot(parseCatalogSnapshot(snap));
  // Every copy snapshot also carries identified Certification fixtures and legacy uids, so exclusion and uid
  // treatment are proved on every path, not in one corner.
  const LEGACY_UIDS = ["legacy-uid-a", "legacy-uid-b", "legacy-uid-c"];
  const withFixtures = (snap) => {
    snap.parts.push(partDoc("CW-P-0000", { certificationWorld: { version: "1.9.0", datasetId: "cw" }, certFamily: "CTRL" }));
    snap.equipmentModels.push(modelDoc("CERT--MODEL-1", { certificationWorld: { version: "1.9.0", datasetId: "cw" } }));
    snap.equipmentModels.push(modelDoc("CERT--MODEL-2", { dataProvenance: "SYNTHETIC_CERTIFICATION_FACT" }));
    return snap;
  };

  const COPY_SNAPSHOT = () => withFixtures(cleanSnapshot());

  await t.test("copy populates the tenant with exact ids, versions and timestamps, and one audit row", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    assert.equal(census.copyReady, true);
    const report = await withPool((c) => copyCatalog(c, { tenantId: "t3", principalId: "p-cutover-t3", catalog, canonicalDigest: census.canonicalDigest, now: CLOCK() }));
    assert.equal(report.outcome, "COPIED");
    assert.deepEqual(report.equipmentModels, { inserted: 3, unchanged: 0 });
    assert.deepEqual(report.parts, { inserted: 4, unchanged: 0 });
    const rows = (await q(`SELECT id, version, status::text, created_by, updated_by, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
                             FROM eos_ops.equipment_models WHERE tenant_id = 't3' ORDER BY id`)).rows;
    assert.deepEqual(rows.map((r) => r.id), ["ACME--CW-100", "ACME--CW-200", "KOLD--KX-9"]);
    assert.ok(rows.every((r) => r.version === 3 && r.created_by === "p-cutover-t3" && r.updated_by === "p-cutover-t3" && r.created_at === "2025-09-04T15:33:20.123456Z"));
    {
      const parts = (await q(`SELECT id, equipment_model_id, whole_unit FROM eos_ops.parts WHERE tenant_id = 't3' ORDER BY id`)).rows;
      assert.deepEqual(parts, [
        { id: "TST-1001", equipment_model_id: null, whole_unit: false }, { id: "TST-1002", equipment_model_id: null, whole_unit: false },
        { id: "TST-1003", equipment_model_id: null, whole_unit: false }, { id: "UNIT-CW-100", equipment_model_id: "ACME--CW-100", whole_unit: true },
      ]);
    }
    const audit = (await q(`SELECT action, actor_uid, target_kind, target_id FROM eos_policy.audit_events WHERE tenant_id = 't3'`)).rows;
    assert.deepEqual(audit, [{ action: "catalog.cutover.copy", actor_uid: "p-cutover-t3", target_kind: "catalog_snapshot", target_id: census.canonicalDigest }]);
    assert.equal(report.cutoverPrincipalId, "p-cutover-t3");
  });

  await t.test("Certification fixtures never land in PostgreSQL, and the copy evidence lists them with their reason", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    const fixtureRows = await q(`SELECT id FROM eos_ops.equipment_models WHERE id LIKE 'CERT--%'`);
    assert.equal(fixtureRows.rows.length, 0);
    assert.equal((await q(`SELECT id FROM eos_ops.parts WHERE id LIKE 'CW-%'`)).rows.length, 0);
    const rerun = await withPool((c) => copyCatalog(c, { tenantId: "t3", principalId: "p-cutover-t3", catalog, canonicalDigest: census.canonicalDigest, certificationExcluded: census.certificationExcluded.records }));
    assert.deepEqual(rerun.certificationExcluded, {
      count: 3,
      records: [
        { kind: "equipment_model", id: "CERT--MODEL-1", reason: "CERTIFICATION_FIXTURE_EXCLUDED:certificationWorld-marker" },
        { kind: "equipment_model", id: "CERT--MODEL-2", reason: "CERTIFICATION_FIXTURE_EXCLUDED:dataProvenance" },
        { kind: "part", id: "CW-P-0000", reason: "CERTIFICATION_FIXTURE_EXCLUDED:certificationWorld-marker" },
      ],
    });
  });

  await t.test("a Firebase uid is never written to created_by, updated_by, an audit actor or an audit payload; it survives only as evidence", async () => {
    const { legacyActorProvenance } = censusOf(COPY_SNAPSHOT());
    assert.ok(legacyActorProvenance.some((p) => p.legacyCreatedBy === "legacy-uid-a"), "the evidence keeps the legacy uids");
    const actorColumns = await q(`SELECT created_by AS v FROM eos_ops.equipment_models UNION ALL SELECT updated_by FROM eos_ops.equipment_models
                                  UNION ALL SELECT actor_uid FROM eos_policy.audit_events UNION ALL SELECT COALESCE(after::text, '') FROM eos_policy.audit_events`);
    const partColumns = (await q(`SELECT created_by AS v FROM eos_ops.parts UNION ALL SELECT updated_by FROM eos_ops.parts`)).rows;
    for (const { v } of [...actorColumns.rows, ...partColumns]) for (const uid of LEGACY_UIDS) assert.equal(String(v).includes(uid), false, `${uid} leaked into a column`);
  });

  await t.test("the cutover Principal must be an active member of the target tenant", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    for (const principalId of ["p1", "p-disabled", "legacy-uid-a", ""]) {
      await assert.rejects(withPool((c) => copyCatalog(c, { tenantId: "t3", principalId, catalog, canonicalDigest: census.canonicalDigest })),
        (e) => ["CUTOVER_PRINCIPAL_NOT_TENANT_MEMBER", "CUTOVER_PRINCIPAL_REQUIRED"].includes(e.code));
    }
  });

  await t.test("verify reconciles counts, identities and EVERY field, with reference verdict spot-checks", async () => {
    const { catalog } = censusOf(COPY_SNAPSHOT());
    const { census } = censusOf(COPY_SNAPSHOT());
    const report = await withPool((c) => verifyCatalog(c, { tenantId: "t3", catalog, sample: "all", certificationExcluded: census.certificationExcluded.records }));
    assert.equal(report.reconciled, true, JSON.stringify(report, null, 2));
    assert.equal(report.certificationExcluded.count, 3);
    assert.deepEqual(report.certificationFixturesInTarget, []);
    assert.deepEqual(report.counts, { equipmentModels: { source: 3, target: 3 }, parts: { source: 4, target: 4 } });
    assert.deepEqual(report.sampled, { equipmentModels: 3, parts: 4 });
    const verdicts = report.verdictChecks;
    assert.ok(verdicts.some((v) => v.kind === "EQUIPMENT_MODEL" && v.tenant === "t3" && v.actual === "FOUND"));
    assert.ok(verdicts.some((v) => v.kind === "EQUIPMENT_MODEL" && v.tenant === ABSENT_TENANT_PROBE && v.actual === "NOT_FOUND"));
    assert.ok(verdicts.some((v) => v.ref === "catalog-cutover-verify-absent-ref" && v.actual === "NOT_FOUND"));
    {
      assert.ok(verdicts.some((v) => v.kind === "PART" && v.tenant === "t3" && v.actual === "FOUND"));
      assert.ok(verdicts.some((v) => v.kind === "PART" && v.tenant === "t3" && v.actual === "WRONG_KIND"));
      assert.ok(verdicts.some((v) => v.kind === "EQUIPMENT_MODEL" && v.tenant === "t3" && v.actual === "WRONG_KIND"));
    }
  });

  await t.test("the #1911 PostgreSQL catalog reference authority answers FOUND / WRONG_KIND / NOT_FOUND over the populated copy, agreeing with verify", async () => {
    const authority = createPostgresCatalogReferenceAuthority();
    const refs = [
      { kind: "PART", ref: "TST-1001" }, { kind: "PART", ref: "UNIT-CW-100" }, { kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100" },
      { kind: "EQUIPMENT_MODEL", ref: "KOLD--KX-9" }, { kind: "PART", ref: "ACME--CW-200" }, { kind: "EQUIPMENT_MODEL", ref: "TST-1002" },
      { kind: "PART", ref: "CW-P-0000" }, { kind: "EQUIPMENT_MODEL", ref: "CERT--MODEL-1" }, { kind: "PART", ref: "NOPE-1" },
    ];
    const answers = await withPool((c) => authority.verifyReferences(c, "t3", refs));
    assert.deepEqual([...answers], ["FOUND", "FOUND", "FOUND", "FOUND", "WRONG_KIND", "WRONG_KIND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"],
      "copied records resolve by kind; excluded Certification fixtures and absent refs are NOT_FOUND");
    assert.deepEqual([...(await withPool((c) => authority.verifyReferences(c, "t5", refs.slice(0, 4))))], ["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"], "another tenant sees nothing");
    const { catalog } = censusOf(COPY_SNAPSHOT());
    const report = await withPool((c) => verifyCatalog(c, { tenantId: "t3", catalog, sample: "all" }));
    for (const check of report.verdictChecks.filter((v) => v.tenant === "t3")) {
      const [adapter] = await withPool((c) => authority.verifyReferences(c, "t3", [{ kind: check.kind, ref: check.ref }]));
      assert.equal(adapter, check.actual, `verify's probe and the adapter disagree on ${check.kind} ${check.ref}`);
    }
  });

  await t.test("verify fails if an excluded Certification fixture is present in the target", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
             VALUES ('CERT--MODEL-1', 't5', 'CERT', 'Cert', 'MODEL-1', 'Cert', 'ACTIVE', 'proof', 1, 'proof', 'proof')`);
    const report = await withPool((c) => verifyCatalog(c, { tenantId: "t5", catalog, sample: "all", certificationExcluded: census.certificationExcluded.records }));
    assert.equal(report.reconciled, false);
    assert.deepEqual(report.certificationFixturesInTarget, ["equipment_model:CERT--MODEL-1"]);
    await q(`DELETE FROM eos_ops.equipment_models WHERE tenant_id = 't5'`);
  });

  await t.test("rerun of the identical snapshot is a no-op: no insert, no update, no audit row", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    const snapshotRows = async () => (await q(`SELECT * FROM eos_ops.equipment_models WHERE tenant_id = 't3' ORDER BY id`)).rows;
    const before = JSON.stringify(await snapshotRows());
    const audits = await auditCount("t3");
    const report = await withPool((c) => copyCatalog(c, { tenantId: "t3", principalId: "p-cutover-t3", catalog, canonicalDigest: census.canonicalDigest }));
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
    await assert.rejects(withPool((c) => copyCatalog(c, { tenantId: "t3", principalId: "p-cutover-t3", catalog, canonicalDigest: census.canonicalDigest })), (e) => {
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
    s.parts = s.parts.filter((d) => d.id !== "TST-1003");
    const { census, catalog } = censusOf(s);
    await assert.rejects(withPool((c) => copyCatalog(c, { tenantId: "t3", principalId: "p-cutover-t3", catalog, canonicalDigest: census.canonicalDigest })), code("TARGET_HAS_UNKNOWN_RECORDS"));
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.equipment_models WHERE tenant_id = 't3'`)).rows[0].count), 3);
  });

  await t.test("tenant scoping: another tenant's catalog neither satisfies nor blocks this tenant's copy, and verify sees only its own", async () => {
    const { census, catalog } = censusOf(COPY_SNAPSHOT());
    // t2 holds ACME--CW-100 (from the writer proofs) with different content: that is t2's record, not drift for t4.
    const report = await withPool((c) => copyCatalog(c, { tenantId: "t4", principalId: "p-cutover-t4", catalog, canonicalDigest: census.canonicalDigest }));
    assert.deepEqual(report.equipmentModels, { inserted: 3, unchanged: 0 });
    const unrelated = await withPool((c) => verifyCatalog(c, { tenantId: "t5", catalog, sample: "all" }));
    assert.equal(unrelated.reconciled, false);
    assert.equal(unrelated.counts.equipmentModels.target, 0);
    assert.equal(unrelated.identity.missingInTarget.length, catalog.equipmentModels.length + catalog.parts.length);
    assert.ok(unrelated.verdictChecks.every((v) => v.actual === "NOT_FOUND"), "nothing of t3/t4 is visible from t5");
  });

  await t.test("a missing tenant is refused; the copy never creates one", async () => {
    const { census, catalog } = censusOf(cleanSnapshot());
    await assert.rejects(withPool((c) => copyCatalog(c, { tenantId: "t-nope", principalId: "p-cutover-t3", catalog, canonicalDigest: census.canonicalDigest })), code("TENANT_NOT_FOUND"));
  });

  await t.test("migration 027 refuses to be reversed while Part Master records exist", async () => {
    assert.throws(() => runner(["down", "1"]), /migration 027 cannot be reversed/);
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.parts`)).rows[0].count) > 0, true);
  });

  // ════════════════════ the operator CLI, end to end ════════════════════

  await t.test("CLI: census -> copy -> verify -> rerun, and a duplicate identity refuses the copy with nothing written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cutover-cli-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('tenant-cli', 'taylor-nonprod-cli', 'CLI proof')`);
    await principal("p-cli", "tenant-cli");
    const run = (mode, snapshot, extra = [], { checksum = true } = {}) => {
      const file = join(dir, `${mode}-${randomUUID()}.json`);
      const text = JSON.stringify(snapshot);
      writeFileSync(file, text);
      if (checksum) writeFileSync(`${file}.sha256`, `${hash("sha256", text)}  snapshot.json\n`);
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
    assert.equal(JSON.parse(census.out).evidence.certificationExcluded.counts.equipmentModels, 2);
    const unsummed = run("census", snap, [], { checksum: false });
    assert.equal(unsummed.status, 2);
    assert.match(unsummed.err, /sha256 is missing/);
    // Look for the connection secret in a form that cannot collide with ordinary output (a short CI password such as
    // "eos" also appears in project ids): the whole URL, and the password in its user:password@ position.
    const leaked = census.out + census.err;
    assert.ok(!leaked.includes(URL_BASE), "the database URL leaked");
    const password = new URL(URL_BASE).password;
    if (password) assert.ok(!leaked.includes(`:${password}@`), "the database password leaked");

    const dup = COPY_SNAPSHOT();
    dup.equipmentModels.push(modelDoc("ACME--CW-100"));
    const refused = run("copy", dup, ["--principalId", "p-cli"]);
    assert.equal(refused.status, 2);
    // (With Parts present the duplicated model is also unselectable, so the whole unit naming it is a missing reference too.)
    assert.ok(JSON.parse(refused.out).blockers.includes("DUPLICATE_CANONICAL_IDENTITY"));
    assert.equal(Number((await q(`SELECT count(*) FROM eos_ops.equipment_models WHERE tenant_id = 'tenant-cli'`)).rows[0].count), 0);

    const missing = snapshotOf({ equipmentModels: [modelDoc("ACME--CW-100")], parts: [wholeUnitPartDoc("UNIT-Z", "ACME--GONE-1")] });
    const missingRun = run("copy", missing, ["--principalId", "p-cli"]);
    assert.equal(missingRun.status, 2);
    assert.deepEqual(JSON.parse(missingRun.out).blockers, ["MISSING_REFERENCES"]);

    const copied = run("copy", snap, ["--principalId", "p-cli"]);
    assert.equal(copied.status, 0, copied.err);
    const copiedOut = JSON.parse(copied.out);
    assert.equal(copiedOut.report.outcome, "COPIED");
    assert.equal(copiedOut.report.cutoverPrincipalId, "p-cli");
    assert.deepEqual(copiedOut.report.certificationExcluded.records.map((r) => r.id), ["CERT--MODEL-1", "CERT--MODEL-2", "CW-P-0000"]);
    assert.ok(copiedOut.evidence.legacyActorProvenance.some((p) => p.legacyUpdatedBy === "legacy-uid-b"), "legacy uids are in the evidence JSON");
    assert.match(copiedOut.evidence.snapshotSha256, /^[0-9a-f]{64}$/);
    const verified = run("verify", snap, ["--sample", "all"]);
    assert.equal(verified.status, 0, verified.err);
    assert.equal(JSON.parse(verified.out).report.reconciled, true);
    assert.equal(JSON.parse(verified.out).evidence.certificationExcluded.records.length, 3);
    const flagged = run("copy", snap, ["--principalId", "p-cli", "--certificationMarked", "include"]);
    assert.equal(flagged.status, 2);
    assert.match(flagged.err, /not an option/);
    const rerun = run("copy", snap, ["--principalId", "p-cli"]);
    assert.equal(JSON.parse(rerun.out).report.outcome, "NO_CHANGES");

    const foreign = run("census", { ...snap, source: { ...snap.source, firebaseProjectId: "taylor-parts" } });
    assert.equal(foreign.status, 2);
    assert.match(foreign.err, /production project 'taylor-parts'/);
    const otherProject = run("census", { ...snap, source: { ...snap.source, firebaseProjectId: "eos-platform-integration" } });
    assert.equal(otherProject.status, 2);
    assert.match(otherProject.err, /declares 'eos-platform-sandbox'/);
  });
});
