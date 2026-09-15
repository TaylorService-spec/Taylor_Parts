// COMMERCIAL C5 against a real postgres:16 -- census, COPY ONCE, VERIFY, rerun, drift, counters, next number,
// accountability history, attribution, tenancy and the CLI, over fixture snapshots.
//
// Its OWN database, migrated by the normal runner from functions/migrations, dropped in one t.after hook. The migrations
// C5 depends on are pinned BY NAME below (never "the latest").
//
// Same skip contract as every other Postgres suite: set POLICY_TEST_DATABASE_URL to run.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { hash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { cleanSnapshot, clone, EMP } from "./support/commercialC5SnapshotFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const C5 = require("../lib/commercialMigration/commercialC5Snapshot.js");
const T = require("../lib/commercialMigration/commercialC5Target.js");
const { allocateCommercialNumber } = require("../lib/eosCommercial/commercialNumbering.js");
const { createPostgresCatalogReferenceAuthority } = require("../lib/catalogAuthority/postgresCatalogReferenceAuthority.js");
const opportunityCommands = require("../lib/eosCommercial/commands/opportunityCommandService.js");

const PINNED_MIGRATIONS = Object.freeze([
  "1758844800000_commercial-ownership-authority",
  "1759104000000_employee-business-authority",
  "1759276800000_commercial-accountability-authority",
  "1759363200000_accountability-history-action-and-source",
  "1759449600000_commercial-schema-parity-numbering-receipts",
  "1759708800000_crm-account-business-facts-and-receipts",
  "1759795200000_catalog-part-identity-reference-authority",
  "1759838400000_employee-profile-and-reporting-authority",
  "1759881600000_catalog-master-descriptive-authority",
]);

const DB_NAME = `commercial_c5_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const runner = (args) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", ...args, "--migrations-dir", "migrations"], {
  cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe", encoding: "utf8",
});
const code = (c) => (e) => { assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message} ${JSON.stringify(e.details ?? null)}`); return true; };
const SHA = (s) => hash("sha256", s);

test("commercial C5, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  runner(["up"]);
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 6 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const withPool = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };

  // ── the world: tenants, Principals, Employees, Accounts, sites, catalog
  for (const tenant of ["t1", "t2", "t3", "tcli"]) await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1)`, [tenant]);
  for (const [p, tenant] of [["p1", "t1"], ["p2", "t2"], ["p3", "t3"], ["pcli", "tcli"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1, $1, 'proof', 'active')`, [p]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1, $2, $3)`, [`m-${p}`, tenant, p]);
  }
  for (const tenant of ["t1", "t3", "tcli"]) {
    for (const [id, status] of [[EMP.owner, "ACTIVE"], [EMP.accountable, "CONTRACTOR"], [EMP.terminated, "TERMINATED"], [EMP.credited, "ON_LEAVE"]]) {
      // employee ids are global primary keys: one set per tenant, suffixed except in t1
      await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1, $2, $3, 'taylor')`, [tenant === "t1" ? id : `${tenant}-${id}`, tenant, status]);
    }
  }
  const account = (id, tenant, owner) => q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES ($1,$2,$1,'ACTIVE',$3,'seed','seed')`, [id, tenant, owner]);
  await account("acct-1", "t1", EMP.owner);
  await account("acct-2", "t1", EMP.owner);
  await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-1','t1','acct-1','Site','seed','seed')`);
  const catalog = async (tenant, prefix = "") => {
    await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
      VALUES ('ACME--CW-100', $1, 'ACME', 'Acme', 'CW-100', 'CW-100', 'ACTIVE', 'proof', 1, 'seed', 'seed')`, [tenant]).catch(() => undefined);
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
      VALUES ($2, $1, 'seed', $2, 'proof part', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'seed')`, [tenant, `${prefix}P-100`]);
  };
  await catalog("t1");

  const snapshotBytes = (snap) => JSON.stringify(snap, null, 2) + "\n";
  const SNAP = cleanSnapshot();
  const SNAP_SHA = SHA(snapshotBytes(SNAP));
  const measured = C5.censusCommercialSnapshot(C5.parseCommercialSnapshot(SNAP));
  const copy = (tenantId, principalId, over = {}) => withPool((c) => T.copyCommercial(c, {
    tenantId, principalId, census: measured.census, canonical: measured.canonical, snapshotSha256: SNAP_SHA, confirmedSnapshotSha256: SNAP_SHA, now: new Date("2026-09-15T12:00:00Z"), ...over,
  }));
  const verify = (tenantId, over = {}) => withPool((c) => T.verifyCommercial(c, { tenantId, census: measured.census, canonical: measured.canonical, legacyActorProvenance: measured.legacyActorProvenance, ...over }));
  const auditCount = async (tenant) => Number((await q(`SELECT count(*) FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'commercial.c5.copy'`, [tenant])).rows[0].count);

  await t.test("the migrations C5 depends on are applied, pinned by name, and the target schema is present", async () => {
    const applied = (await q(`SELECT name FROM public.pgmigrations`)).rows.map((r) => r.name);
    for (const m of PINNED_MIGRATIONS) assert.ok(applied.includes(m), `${m} applied`);
    assert.deepEqual(await withPool(T.c5SchemaPresence), { commercialParity: true, accountabilitySource: true, crmAccounts: true, partMaster: true });
  });

  await t.test("the restated catalog probe answers exactly as the #1911 catalog reference authority", async () => {
    const refs = [{ kind: "PART", ref: "P-100" }, { kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100" }, { kind: "PART", ref: "ACME--CW-100" }, { kind: "EQUIPMENT_MODEL", ref: "P-100" }, { kind: "PART", ref: "nope" }];
    const adapter = createPostgresCatalogReferenceAuthority();
    for (const tenant of ["t1", "t2"]) {
      assert.deepEqual(await withPool((c) => T.probeCatalogReferences(c, tenant, refs)), [...(await withPool((c) => adapter.verifyReferences(c, tenant, refs)))]);
    }
  });

  await t.test("census (read only): copy-ready against t1, with the accountability plan and counter seed plan", async () => {
    const facts = await withPool(async (c) => { await c.query("BEGIN READ ONLY"); try { return await T.measureC5Target(c, "t1", measured.census, measured.canonical); } finally { await c.query("COMMIT"); } });
    const final = T.finalizeC5Census(measured.census, measured.canonical, facts);
    assert.deepEqual(final.blockers, []);
    assert.equal(final.copyReady, true);
    assert.deepEqual(final.accountabilityPlan.map((p) => [p.id, p.path]), [["opp-1", "GOVERNED_ESTABLISHMENT"], ["opp-2", "GOVERNED_ESTABLISHMENT"], ["opp-3", "HISTORICAL_PRESERVED"], ["sa-1", "GOVERNED_ESTABLISHMENT"], ["so-1", "GOVERNED_ESTABLISHMENT"]]);
    assert.equal(Number((await q(`SELECT count(*) FROM eos_commercial.opportunities`)).rows[0].count), 0, "the census wrote nothing");
  });

  await t.test("copy refuses a Firebase uid as the Principal, a missing confirmation and a production source -- nothing written", async () => {
    await assert.rejects(copy("t1", "uid-creator"), code("CUTOVER_PRINCIPAL_NOT_TENANT_MEMBER"));
    await assert.rejects(copy("t1", "p2"), code("CUTOVER_PRINCIPAL_NOT_TENANT_MEMBER"), "a Principal of another tenant");
    await assert.rejects(copy("t1", "p1", { confirmedSnapshotSha256: "b".repeat(64) }), code("MIGRATION_CONFIRMATION_REQUIRED"));
    const prod = C5.censusCommercialSnapshot(C5.parseCommercialSnapshot(cleanSnapshot("", { environmentId: "taylor-parts-production", projectId: "taylor-parts" })));
    await assert.rejects(withPool((c) => T.copyCommercial(c, { tenantId: "t1", principalId: "p1", census: prod.census, canonical: prod.canonical, snapshotSha256: SNAP_SHA, confirmedSnapshotSha256: SNAP_SHA })), code("PRODUCTION_COPY_REFUSED"));
    assert.equal(Number((await q(`SELECT count(*) FROM eos_commercial.opportunities`)).rows[0].count), 0);
  });

  await t.test("COPY ONCE: ids, numbers, facts, lines and timestamps verbatim; EOS Principal attribution; one audit event; no receipts; Certification fixtures absent", async () => {
    const report = await copy("t1", "p1");
    assert.equal(report.outcome, "COPIED");
    assert.deepEqual(report.inserted, { opportunity: ["opp-1", "opp-2", "opp-3"], salesAgreement: ["sa-1"], salesOrder: ["so-1"] });
    assert.deepEqual(report.accountability, { governedEstablishments: 4, historicalPreserved: 1, derivedAtMigration: ["opportunity:opp-2"] });
    assert.equal(report.receiptsWritten, 0);
    for (const f of C5.C5_FAMILIES) {
      const rows = await withPool((c) => T.readTenantRows(c, f.family, "t1"));
      for (const r of measured.canonical[f.key]) {
        const row = rows.get(r.id);
        assert.deepEqual(T.differingFields(f.family, r, row.record), [], `${f.family} ${r.id} copied exactly`);
        assert.deepEqual([row.createdBy, row.updatedBy], ["p1", "p1"]);
      }
    }
    assert.equal((await q(`SELECT accepted_by FROM eos_commercial.sales_agreements WHERE id = 'sa-1'`)).rows[0].accepted_by, "p1");
    assert.equal((await q(`SELECT edit_version FROM eos_commercial.opportunities WHERE id = 'opp-1'`)).rows[0].edit_version, "1");
    assert.equal(await auditCount("t1"), 1);
    assert.equal(Number((await q(`SELECT count(*) FROM eos_commercial.command_receipts`)).rows[0].count), 0, "receipts are idempotency, never migration audit");
    assert.equal(Number((await q(`SELECT count(*) FROM eos_commercial.opportunities WHERE id LIKE 'cw-%'`)).rows[0].count + (await q(`SELECT count(*) FROM eos_commercial.sales_orders WHERE id LIKE 'cw-%'`)).rows[0].count), 0);
    assert.equal(Number((await q(`SELECT count(*) FROM eos_commercial.ownership_handoffs`)).rows[0].count), 0, "a creation owner has no handoff history");
  });

  await t.test("accountability: exactly one ESTABLISHMENT per record, recorded source, the governed writer's column set, derived and historical rows labelled", async () => {
    const rows = (await q(`SELECT coalesce(opportunity_id, sales_agreement_id, sales_order_id) AS rec, action, source::text AS source, previous_accountable_employee_id AS prev,
        new_accountable_employee_id AS person, eligibility_policy_id AS policy, recorded_by, reason FROM eos_commercial.accountability_handoffs WHERE tenant_id = 't1' ORDER BY 1`)).rows;
    assert.deepEqual(rows.map((r) => [r.rec, r.action, r.source, r.prev, r.person, r.policy, r.recorded_by]), [
      ["opp-1", "ESTABLISHMENT", "EXPLICIT", null, EMP.accountable, "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", "p1"],
      ["opp-2", "ESTABLISHMENT", "DERIVED_FROM_RECORD_OWNER", null, EMP.owner, "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", "p1"],
      ["opp-3", "ESTABLISHMENT", "DERIVED_FROM_RECORD_OWNER", null, EMP.terminated, "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", "p1"],
      ["sa-1", "ESTABLISHMENT", "EXPLICIT", null, EMP.accountable, "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", "p1"],
      ["so-1", "ESTABLISHMENT", "DERIVED_FROM_RECORD_OWNER", null, EMP.accountable, "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1", "p1"],
    ]);
    assert.match(rows[1].reason, new RegExp(`^C5_MIGRATION_DERIVED_FROM_RECORD_OWNER snapshot:${SNAP_SHA.slice(0, 16)}$`));
    assert.match(rows[2].reason, /^C5_MIGRATION_HISTORICAL_ACCOUNTABILITY_PRESERVED .* status:TERMINATED context:HISTORICAL/);
    assert.match(rows[0].reason, /^C5_MIGRATION_RECORDED_ACCOUNTABLE_PERSON /);
    const persons = (await q(`SELECT id, owner_employee_id, accountable_employee_id FROM eos_commercial.opportunities WHERE tenant_id = 't1' ORDER BY id`)).rows;
    assert.deepEqual(persons.map((r) => [r.id, r.owner_employee_id, r.accountable_employee_id]), [["opp-1", EMP.owner, EMP.accountable], ["opp-2", EMP.owner, EMP.owner], ["opp-3", EMP.owner, EMP.terminated]]);
  });

  await t.test("no Firebase uid anywhere: every text column of every Commercial, history and audit row in the tenant is uid-free", async () => {
    const uids = new Set(measured.legacyActorProvenance.flatMap((p) => [p.createdByUid, p.updatedByUid, p.acceptedByUid]).filter(Boolean));
    assert.ok(uids.size >= 3);
    for (const table of ["eos_commercial.opportunities", "eos_commercial.sales_agreements", "eos_commercial.sales_orders", "eos_commercial.accountability_handoffs", "eos_policy.audit_events"]) {
      const dump = JSON.stringify((await q(`SELECT * FROM ${table} WHERE tenant_id = 't1'`)).rows);
      for (const uid of uids) assert.ok(!dump.includes(uid), `${table} carries ${uid}`);
    }
  });

  await t.test("counters seeded to the highest migrated number per series/year; the next allocation never collides (probe rolled back)", async () => {
    const counters = (await q(`SELECT series::text AS series, year, last_value FROM eos_commercial.number_counters WHERE tenant_id = 't1' ORDER BY series, year`)).rows;
    assert.deepEqual(counters.map((c) => [c.series, c.year, Number(c.last_value)]), [["OPPORTUNITY", 2025, 3], ["OPPORTUNITY", 2026, 9], ["SALES_AGREEMENT", 2026, 4], ["SALES_ORDER", 2026, 11]]);
    const next = await withPool(async (c) => { await c.query("BEGIN"); try { return await allocateCommercialNumber(c, "t1", "SALES_ORDER", new Date("2026-06-01T00:00:00Z")); } finally { await c.query("ROLLBACK"); } });
    assert.equal(next.number, "SO-2026-000012");
    assert.equal(Number((await q(`SELECT last_value FROM eos_commercial.number_counters WHERE tenant_id = 't1' AND series = 'SALES_ORDER' AND year = 2026`)).rows[0].last_value), 11, "the probe was rolled back");
  });

  await t.test("VERIFY: reconciled -- counts, ids, fields, numbers, counters with probe, people, history, Account FKs, lineage, exclusions, attribution", async () => {
    const report = await verify("t1");
    assert.equal(report.reconciled, true, JSON.stringify(report, null, 2));
    assert.deepEqual(report.counts, { opportunity: { source: 3, target: 3 }, salesAgreement: { source: 1, target: 1 }, salesOrder: { source: 1, target: 1 } });
    assert.equal(report.accountabilityHistory.establishments, 5);
    assert.deepEqual(report.counters.map((c) => [c.series, c.year, c.probeNumber, c.ok]), [["OPPORTUNITY", 2025, "OPP-2025-000004", true], ["OPPORTUNITY", 2026, "OPP-2026-000010", true], ["SALES_AGREEMENT", 2026, "SA-2026-000005", true], ["SALES_ORDER", 2026, "SO-2026-000012", true]]);
    assert.equal(report.receiptsNamingMigratedRecords, 0);
    assert.equal(Number((await q(`SELECT last_value FROM eos_commercial.number_counters WHERE tenant_id = 't1' AND series = 'OPPORTUNITY' AND year = 2026`)).rows[0].last_value), 9, "verify commits nothing");
  });

  await t.test("RERUN of the same snapshot is a no-op: no insert, no history, no counter write, no audit event", async () => {
    const before = Number((await q(`SELECT count(*) FROM eos_commercial.accountability_handoffs`)).rows[0].count);
    const report = await copy("t1", "p1");
    assert.equal(report.outcome, "NO_CHANGES");
    assert.deepEqual(report.unchanged, { opportunity: 3, salesAgreement: 1, salesOrder: 1 });
    assert.ok(report.counters.every((c) => c.action === "NONE"));
    assert.equal(Number((await q(`SELECT count(*) FROM eos_commercial.accountability_handoffs`)).rows[0].count), before);
    assert.equal(await auditCount("t1"), 1);
  });

  await t.test("DRIFT: a source that changed after the copy is refused and never overwritten", async () => {
    const changed = clone(SNAP);
    changed.opportunities.find((o) => o.id === "opp-2").data.need = "a different need";
    const m = C5.censusCommercialSnapshot(C5.parseCommercialSnapshot(changed));
    const sha = SHA(snapshotBytes(changed));
    await assert.rejects(withPool((c) => T.copyCommercial(c, { tenantId: "t1", principalId: "p1", census: m.census, canonical: m.canonical, snapshotSha256: sha, confirmedSnapshotSha256: sha })),
      (e) => e.code === "DRIFT_DETECTED" && JSON.stringify(e.details).includes("need"));
    assert.equal((await q(`SELECT need FROM eos_commercial.opportunities WHERE id = 'opp-2'`)).rows[0].need, null);
  });

  await t.test("verify detects a changed field, a legacy uid in an actor column and a lowered counter", async () => {
    await q(`UPDATE eos_commercial.sales_orders SET notes = 'tampered', created_by = 'uid-creator' WHERE id = 'so-1'`);
    await q(`UPDATE eos_commercial.number_counters SET last_value = 5 WHERE tenant_id = 't1' AND series = 'SALES_ORDER'`);
    const report = await verify("t1");
    assert.equal(report.reconciled, false);
    assert.deepEqual(report.fieldMismatches, [{ family: "salesOrder", id: "so-1", fields: ["notes"] }]);
    assert.deepEqual(report.legacyUidAttributions, ["uid-creator"]);
    assert.ok(report.nonPrincipalAttributions.includes("uid-creator"));
    assert.deepEqual(report.counters.filter((c) => !c.ok).map((c) => [c.series, c.counter, c.probeNumber]), [["SALES_ORDER", 5, "SO-2026-000006"]]);
    await q(`UPDATE eos_commercial.sales_orders SET notes = 'call first', created_by = 'p1' WHERE id = 'so-1'`);
    await q(`UPDATE eos_commercial.number_counters SET last_value = 11 WHERE tenant_id = 't1' AND series = 'SALES_ORDER'`);
    assert.equal((await verify("t1")).reconciled, true);
  });

  await t.test("after the copy, the governed C2 create allocates the next number with no collision -- and the new row makes a rerun refuse", async () => {
    const deps = { pool, now: () => new Date("2026-09-15T12:00:00Z") };
    const actor = { tenantId: "t1", principalId: "p1", capabilities: new Set(["opportunity.write"]) };
    const created = await opportunityCommands.createOpportunity(deps, actor, { idempotencyKey: "c5-next", accountId: "acct-1", salesChannel: "RETAIL" });
    assert.equal(created.opportunityNumber, "OPP-2026-000010");
    await assert.rejects(copy("t1", "p1"), (e) => e.code === "CENSUS_NOT_COPY_READY" && e.details.includes("TARGET_HAS_UNKNOWN_RECORDS"));
    const report = await verify("t1");
    assert.deepEqual(report.identity.extraInTarget, [`opportunity:${created.opportunityId}`]);
  });

  await t.test("counters are raised, never lowered: an existing lower counter is raised to the migrated max, a higher one is untouched", async () => {
    // t3 holds its own world with prefixed ids (ids are global primary keys)
    const snap3 = cleanSnapshot("t3-");
    for (const docs of [snap3.opportunities, snap3.salesAgreements, snap3.salesOrders]) {
      for (const d of docs) for (const field of ["ownerEmployeeId", "accountableEmployeeId", "creditedSalespersonId"]) if (typeof d.data[field] === "string") d.data[field] = `t3-${d.data[field]}`;
    }
    await account("t3-acct-1", "t3", `t3-${EMP.owner}`);
    await account("t3-acct-2", "t3", `t3-${EMP.owner}`);
    await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
      VALUES ('ACME--CW-100', 't3', 'ACME', 'Acme', 'CW-100', 'CW-100', 'ACTIVE', 'proof', 1, 'seed', 'seed')`).catch(() => undefined);
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
      VALUES ('t3-P-100', 't3', 'seed', 'P-100', 'proof part', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'seed')`).catch(() => undefined);
    for (const d of snap3.opportunities) d.data.lines = (d.data.lines ?? []).map((l) => (l.kind === "PART" ? { ...l, ref: "t3-P-100" } : l));
    await q(`INSERT INTO eos_commercial.number_counters (tenant_id, series, year, last_value) VALUES ('t3','OPPORTUNITY',2026,2), ('t3','SALES_ORDER',2026,500)`);
    const m = C5.censusCommercialSnapshot(C5.parseCommercialSnapshot(snap3));
    assert.deepEqual(m.census.blockers, []);
    const sha = SHA(snapshotBytes(snap3));
    const eq = await withPool(async (c) => { await c.query("BEGIN READ ONLY"); try { return await T.measureC5Target(c, "t3", m.census, m.canonical); } finally { await c.query("COMMIT"); } });
    const eqFinal = T.finalizeC5Census(m.census, m.canonical, eq);
    assert.equal(eq.catalog.verdicts.find((v) => v.kind === "EQUIPMENT_MODEL").verdict, "FOUND", JSON.stringify(eqFinal.blockers));
    const report = await withPool((c) => T.copyCommercial(c, { tenantId: "t3", principalId: "p3", census: m.census, canonical: m.canonical, snapshotSha256: sha, confirmedSnapshotSha256: sha }));
    assert.deepEqual(report.counters.map((c) => [c.series, c.year, c.action, c.from, c.to]), [
      ["OPPORTUNITY", 2025, "INSERT", null, 3], ["OPPORTUNITY", 2026, "RAISE", 2, 9], ["SALES_AGREEMENT", 2026, "INSERT", null, 4], ["SALES_ORDER", 2026, "NONE", 500, 500],
    ]);
    const final = (await q(`SELECT series::text AS series, year, last_value FROM eos_commercial.number_counters WHERE tenant_id = 't3' ORDER BY series, year`)).rows.map((r) => [r.series, r.year, Number(r.last_value)]);
    assert.deepEqual(final, [["OPPORTUNITY", 2025, 3], ["OPPORTUNITY", 2026, 9], ["SALES_AGREEMENT", 2026, 4], ["SALES_ORDER", 2026, 500]]);
    const v = await withPool((c) => T.verifyCommercial(c, { tenantId: "t3", census: m.census, canonical: m.canonical, legacyActorProvenance: m.legacyActorProvenance }));
    assert.equal(v.reconciled, true, JSON.stringify(v, null, 2));
  });

  await t.test("TENANCY: another tenant cannot take the copied ids, cannot resolve t1's Employees or Accounts, and sees nothing", async () => {
    const facts = await withPool((c) => T.measureC5Target(c, "t2", measured.census, measured.canonical));
    const final = T.finalizeC5Census(measured.census, measured.canonical, facts);
    for (const b of ["ID_HELD_BY_ANOTHER_TENANT", "OWNER_UNRESOLVED", "ACCOUNT_UNRESOLVED", "CATALOG_REFERENCE_NOT_FOUND"]) assert.ok(final.blockers.includes(b), b);
    await assert.rejects(copy("t2", "p2"), code("CENSUS_NOT_COPY_READY"));
    assert.equal(Number((await q(`SELECT count(*) FROM eos_commercial.opportunities WHERE tenant_id = 't2'`)).rows[0].count), 0);
    assert.equal((await verify("t2")).reconciled, false);
  });

  await t.test("CLI: census -> copy -> verify -> rerun through the real script; disposition refusal; tampered checksum; no connection string or password in any output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "c5-cli-"));
    const snap = cleanSnapshot("cli-");
    for (const docs of [snap.opportunities, snap.salesAgreements, snap.salesOrders]) {
      for (const d of docs) {
        for (const field of ["ownerEmployeeId", "accountableEmployeeId", "creditedSalespersonId"]) if (typeof d.data[field] === "string") d.data[field] = `tcli-${d.data[field]}`;
        d.data.lines = (d.data.lines ?? []).map((l) => (l.kind === "PART" ? { ...l, ref: "cli-P-100" } : l));
      }
    }
    await account("cli-acct-1", "tcli", `tcli-${EMP.owner}`);
    await account("cli-acct-2", "tcli", `tcli-${EMP.owner}`);
    await catalog("tcli", "cli-");
    const file = join(dir, "snap.json");
    const text = snapshotBytes(snap);
    writeFileSync(file, text);
    writeFileSync(`${file}.sha256`, `${SHA(text)}  snap.json\n`);
    const env = { ...process.env, EOS_ENVIRONMENT: "nonprod", C5_TEST_DB: dbUrl() };
    const run = (args) => spawnSync(process.execPath, ["scripts/commercialC5.js", "--environment", "platform-sandbox", "--databaseUrlEnv", "C5_TEST_DB", "--tenantKey", "tcli", "--snapshot", file, ...args], { cwd: FUNCTIONS_DIR, env, encoding: "utf8" });
    const password = new URL(URL_BASE).password;
    const noLeak = (res) => {
      const out = `${res.stdout}${res.stderr}`;
      assert.ok(!out.includes(dbUrl()) && !out.includes(URL_BASE), "a connection string leaked");
      assert.ok(!out.includes(`:${password}@`), "a :password@ leaked");
      if (password.length >= 6) assert.ok(!out.includes(password), "the password leaked");
      return out;
    };
    const census = run(["--mode", "census"]);
    noLeak(census);
    assert.equal(census.status, 0, census.stderr);
    const cj = JSON.parse(census.stdout);
    assert.equal(cj.disposition.disposition, "MIGRATION_REQUIRED_OR_OWNER_REVIEW");
    assert.equal(cj.final.copyReady, true, JSON.stringify(cj.final.blockers));
    const sha = SHA(text);
    const wrongConfirm = run(["--mode", "copy", "--principalId", "pcli", "--confirmMigrationRequired", "c".repeat(64)]);
    noLeak(wrongConfirm);
    assert.equal(wrongConfirm.status, 2);
    assert.match(wrongConfirm.stdout, /MIGRATION_CONFIRMATION_DOES_NOT_NAME_THIS_SNAPSHOT/);
    const copied = run(["--mode", "copy", "--principalId", "pcli", "--confirmMigrationRequired", sha]);
    noLeak(copied);
    assert.equal(copied.status, 0, copied.stderr);
    assert.equal(JSON.parse(copied.stdout).report.outcome, "COPIED");
    const verified = run(["--mode", "verify"]);
    noLeak(verified);
    assert.equal(verified.status, 0, verified.stdout.slice(0, 4000));
    const again = run(["--mode", "copy", "--principalId", "pcli", "--confirmMigrationRequired", sha]);
    noLeak(again);
    assert.equal(JSON.parse(again.stdout).report.outcome, "NO_CHANGES");
    // a disposable source is refused by copy before any database write
    const quiet = cleanSnapshot("q-");
    quiet.salesOrders = [];
    for (const o of quiet.opportunities) delete o.data.salesOrderId;
    for (const a of quiet.salesAgreements) delete a.data.salesOrderId;
    const qfile = join(dir, "quiet.json");
    const qtext = snapshotBytes(quiet);
    writeFileSync(qfile, qtext);
    writeFileSync(`${qfile}.sha256`, `${SHA(qtext)}  quiet.json\n`);
    const refused = spawnSync(process.execPath, ["scripts/commercialC5.js", "--mode", "copy", "--environment", "platform-sandbox", "--databaseUrlEnv", "C5_TEST_DB", "--tenantKey", "tcli", "--snapshot", qfile, "--principalId", "pcli", "--confirmMigrationRequired", SHA(qtext)], { cwd: FUNCTIONS_DIR, env, encoding: "utf8" });
    noLeak(refused);
    assert.equal(refused.status, 2);
    assert.match(refused.stdout, /DISPOSITION_DISPOSABLE_FIXTURE_ONLY/);
    writeFileSync(file, text.replace("PO-77", "PO-78"));
    const tampered = run(["--mode", "census"]);
    noLeak(tampered);
    assert.equal(tampered.status, 2);
    assert.match(tampered.stderr, /changed after export/);
  });
});
