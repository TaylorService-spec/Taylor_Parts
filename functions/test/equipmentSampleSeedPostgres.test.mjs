// THE EQUIPMENT REGISTER SAMPLE_DATA_SEED (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01): census -> classify ->
// copy once -> verify -> replay, against real PostgreSQL. Customers and sites resolve against PostgreSQL CRM; a document
// that cannot is EXCLUDED_SAMPLE by code, never repaired. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
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
const seed = require("../lib/eosOps/migration/equipmentSampleSeed.js");
const script = require("../scripts/equipmentSampleSeed.js");

const MANIFEST = { format: "EOS_EQUIPMENT_SAMPLE_SEED_MANIFEST", version: 1, ruling: "GLOBAL OWNER RULING 2026-10-01", operatingCompanyKey: "taylor",
  excluded: [{ legacyId: "eq-fixture-cert", reason: "Certification World fixture" }] };

test("the manifest and the invocation are refused before anything is read", () => {
  assert.throws(() => seed.validateEquipmentSeedManifest({ ...MANIFEST, operatingCompanyKey: "" }), /operatingCompanyKey/);
  assert.throws(() => seed.validateEquipmentSeedManifest({ ...MANIFEST, excluded: [{ legacyId: "x" }] }), /reason/);
  assert.throws(() => seed.validateEquipmentSeedManifest({ ...MANIFEST, format: "OTHER" }), /MANIFEST|not an/);
  assert.throws(() => script.assertEquipmentSeedInvocation({ mode: "delete" }, {}), /--mode/);
  assert.throws(() => script.parseEquipmentSnapshot({ format: "EOS_INVENTORY_SNAPSHOT", version: 1, source: {} }), /no 'equipment' collection/);
  assert.deepEqual(seed.sampleSeedEquipmentId("t", "a"), seed.sampleSeedEquipmentId("t", "a"), "deterministic");
  assert.notEqual(seed.sampleSeedEquipmentId("t", "a"), seed.sampleSeedEquipmentId("t2", "a"), "per tenant");
});

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("SAMPLE_DATA_SEED: census -> copy once -> verify -> replay", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `eqseed_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (s, v = []) => pool.query(s, v);
  const T = "t-seed";
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by) VALUES ($1,'taylor','ACTIVE','f','f','f')`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,'taylor','taylor','ACTIVE','NATIVE','f','f','f')`, [T]);
  for (const [id, status] of [["acct-1", "ACTIVE"], ["acct-2", "INACTIVE"]]) {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ($1,$2,$1,$3,'f','f')`, [id, T, status]);
  }
  for (const [id, acct] of [["loc-1", "acct-1"], ["loc-2", "acct-2"]]) {
    await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ($1,$2,$3,$1,'f','f')`, [id, T, acct]);
  }
  const docs = [
    { id: "eq-good", data: { name: "Cooler", status: "ACTIVE", accountId: "acct-1", locationId: "loc-1", serialNumber: "S-1", manufacturer: "Acme", model: "C-1",
      installedDate: "2024-01-02", warrantyExpiresDate: "not a date", createdAt: 1700000000000 } },
    { id: "eq-history", data: { name: "Old Fryer", status: "RETIRED", accountId: "acct-2", locationId: "loc-2" } },
    { id: "eq-installed", data: { name: "Reach-in", status: "ACTIVE", accountId: "acct-1", locationId: "loc-1", serializedAssetId: "sa-legacy-1" } },
    { id: "eq-no-account", data: { name: "Orphan", status: "ACTIVE", accountId: "acct-firebase-only", locationId: "loc-1" } },
    { id: "eq-no-site", data: { name: "Lost", status: "ACTIVE", accountId: "acct-1", locationId: "loc-firebase-only" } },
    { id: "eq-cross", data: { name: "Crossed", status: "ACTIVE", accountId: "acct-1", locationId: "loc-2" } },
    { id: "eq-no-name", data: { status: "ACTIVE", accountId: "acct-1", locationId: "loc-1" } },
    { id: "eq-bad-status", data: { name: "Odd", status: "BROKEN", accountId: "acct-1", locationId: "loc-1" } },
    { id: "eq-fixture-cert", data: { name: "Cert", status: "ACTIVE", accountId: "acct-1", locationId: "loc-1" } },
  ];
  const input = { tenantId: T, snapshotSha256: "a".repeat(64), manifestSha256: "b".repeat(64), manifest: seed.validateEquipmentSeedManifest(MANIFEST), docs, performedBy: "prn-operator" };
  const codes = (plan) => Object.fromEntries(plan.findings.map((f) => [f.legacyId, f.code ?? f.disposition]));

  await t.test("CENSUS classifies every document; nothing is written", async () => {
    const plan = await seed.censusEquipmentSeed(pool, { ...input, performedBy: "census" });
    assert.deepEqual(codes(plan), {
      "eq-bad-status": "STATUS_INVALID", "eq-cross": "SITE_NOT_OF_ACCOUNT", "eq-fixture-cert": "MANIFEST_EXCLUDED", "eq-good": "PLANNED",
      "eq-history": "PLANNED", "eq-installed": "PLANNED", "eq-no-account": "ACCOUNT_UNRESOLVED", "eq-no-name": "NAME_MISSING", "eq-no-site": "SITE_UNRESOLVED",
    });
    assert.deepEqual(plan.counts, { documents: 9, EXCLUDED_SAMPLE: 5, MANIFEST_EXCLUDED: 1, PLANNED: 3 });
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.equipment`)).rows[0].n, 0);
    await assert.rejects(seed.copyEquipmentSeedOnce(pool, { ...input, performedBy: "census" }), { code: "PRINCIPAL_REQUIRED" });
    await assert.rejects(seed.censusEquipmentSeed(pool, { ...input, manifest: { ...input.manifest, operatingCompanyKey: "acme" } }), { code: "OPERATING_COMPANY_NOT_GOVERNED" });
  });

  await t.test("COPY writes the resolvable documents with SAMPLE_DATA_SEED lineage; VERIFY; a rerun is NO_CHANGES", async () => {
    assert.equal((await seed.verifyEquipmentSeed(pool, input)).verdict, "NOT_VERIFIED", "nothing copied yet");
    const copied = await seed.copyEquipmentSeedOnce(pool, input);
    assert.deepEqual([copied.outcome, copied.inserted], ["COPIED", 3]);
    const good = (await q(`SELECT ${"operating_company_key, account_id, customer_location_id, name, status::text AS status, serial_number, to_char(installed_on,'YYYY-MM-DD') AS installed_on, warranty_expires_on, equipment_model_id, installed_from_location_id"}
        FROM eos_ops.equipment WHERE tenant_id = $1 AND id = $2`, [T, seed.sampleSeedEquipmentId(T, "eq-good")])).rows[0];
    assert.deepEqual(good, { operating_company_key: "taylor", account_id: "acct-1", customer_location_id: "loc-1", name: "Cooler", status: "ACTIVE",
      serial_number: "S-1", installed_on: "2024-01-02", warranty_expires_on: null, equipment_model_id: null, installed_from_location_id: null },
    "free-text model never becomes a governed model; an invalid date is dropped, not guessed");
    const ev = (await q(`SELECT source, event_type, idempotency_key, changes, actor_principal_id FROM eos_ops.equipment_events WHERE tenant_id = $1 AND equipment_id = $2`,
      [T, seed.sampleSeedEquipmentId(T, "eq-installed")])).rows;
    assert.deepEqual(ev.map((e) => [e.source, e.event_type, e.idempotency_key, e.changes.legacyFirestoreId, e.changes.legacySerializedAssetId, e.actor_principal_id]),
      [["SAMPLE_DATA_SEED", "CREATED", "sample-seed:equipment:eq-installed", "eq-installed", "sa-legacy-1", "prn-operator"]]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.serialized_custody`)).rows[0].n, 0, "no custody is invented for a legacy installed record");
    const v = await seed.verifyEquipmentSeed(pool, input);
    assert.deepEqual([v.verdict, v.expected, v.found, v.missingEvents], ["VERIFIED", 3, 3, 0]);
    const again = await seed.copyEquipmentSeedOnce(pool, input);
    assert.deepEqual([again.outcome, again.inserted], ["NO_CHANGES", 0]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.equipment_events`)).rows[0].n, 3, "replay duplicates nothing");
  });
});
