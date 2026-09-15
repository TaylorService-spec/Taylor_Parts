// CRM CUTOVER against a real postgres:16 -- copy once and verify into the D1-A eos_crm schema.
//
// Its OWN database, migrated by the normal runner, dropped in ONE t.after that ends the pool first. The copied rows are
// read back through the governed D1-A authorities (functions/src/eosCrm/**) as well as by SQL. Nothing here asserts
// which migration is latest. No Firebase, no network beyond the local database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { FAKE_UID_A, FAKE_UID_B, accountDoc, asFile, cleanSnapshot } from "./support/crmSnapshotFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { parseCrmSnapshot, censusCrmSnapshot, finalizeCrmCensus } = require("../lib/crm/crmCutoverSnapshot.js");
const { copyCrm, verifyCrm, readTenantCrm } = require("../lib/crm/crmCutoverCopy.js");
const { measureCrmTarget } = require("../lib/crm/crmCutoverTarget.js");
const accounts = require("../lib/eosCrm/accountAuthority.js");
const contacts = require("../lib/eosCrm/contactAuthority.js");

const DB_NAME = `crm_cutover_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => {
  const u = new URL(URL_BASE);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
};
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
const code = (c) => (e) => {
  assert.equal(e.name, "CrmCutoverError", `not a governed cutover error: ${e}`);
  assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`);
  return true;
};

/** The pure census, finalized with the tenant's real facts -- exactly what the CLI does. */
async function censusFor(pool, tenantId, snapshot) {
  const pre = censusCrmSnapshot(parseCrmSnapshot(asFile(snapshot)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const target = await measureCrmTarget(client, tenantId, Object.keys(pre.census.ownerReferences));
    await client.query("COMMIT");
    return { ...finalizeCrmCensus(pre, target.facts), target };
  } finally {
    client.release();
  }
}
const withPoolClient = async (pool, fn) => {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
};
const provenanceActors = (evidence) => [...new Set(evidence.provenance.flatMap((p) => [p.createdBy, p.updatedBy, p.ownerAssignment?.assignedToUserId, p.ownerAssignment?.assignedByUserId]).filter((v) => typeof v === "string"))];
const excludedIds = (evidence) => {
  const out = { accounts: [], contacts: [], locations: [] };
  for (const e of evidence.certificationExcluded) out[e.collection].push(e.id);
  return out;
};

test("CRM cutover copy once / verify, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 6 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);

  // ── the world: two tenants, cutover Principals, the owner Employee in t1 only ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','taylor-nonprod','T1'), ('t2','t2','T2')`);
  for (const [p, tenant] of [["p-cutover", "t1"], ["p-t2", "t2"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [p]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${p}`, tenant, p]);
  }
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('emp-owner-1','t1','ACTIVE','taylor'), ('emp-t2-only','t2','ACTIVE','taylor')`);

  const snapshot = cleanSnapshot();
  // A Certification fixture in the same export: excluded, never copied.
  snapshot.accounts.push(accountDoc("cw-acct-000", { certificationWorld: { version: "v9" }, category: "x" }));
  const clean = await censusFor(pool, "t1", snapshot);
  const ACTOR = "p-cutover";
  const copyInput = (over = {}) => ({
    tenantId: "t1", performedByPrincipalId: ACTOR, crm: clean.crm, canonicalDigest: clean.census.canonicalDigest,
    snapshotSha256: "a".repeat(64), evidenceSha256: "b".repeat(64), ...over,
  });
  const counts = async (tenant = "t1") => ({
    accounts: Number((await q(`SELECT count(*)::int n FROM eos_crm.accounts WHERE tenant_id = $1`, [tenant])).rows[0].n),
    contacts: Number((await q(`SELECT count(*)::int n FROM eos_crm.contacts WHERE tenant_id = $1`, [tenant])).rows[0].n),
    locations: Number((await q(`SELECT count(*)::int n FROM eos_crm.account_locations WHERE tenant_id = $1`, [tenant])).rows[0].n),
  });

  await t.test("(0) the census against the real tenant resolves owners and is copy-ready", () => {
    assert.equal(clean.census.copyReady, true, JSON.stringify(clean.census.blockers));
    assert.equal(clean.target.report.businessFactSchemaPresent, true);
    assert.deepEqual(clean.target.report.relationsAbsent, []);
    assert.equal(clean.census.certificationExcluded.accounts, 1);
  });

  await t.test("(1) OWNER: an owner that is an Employee of ANOTHER tenant blocks the census and refuses the copy in-transaction", async () => {
    const other = await censusFor(pool, "t2", snapshot);
    assert.ok(other.census.blockers.includes("OWNER_UNRESOLVED"));
    await assert.rejects(withPoolClient(pool, (c) => copyCrm(c, copyInput({ tenantId: "t2", performedByPrincipalId: "p-t2" }))), code("OWNER_UNRESOLVED"));
    assert.deepEqual(await counts("t2"), { accounts: 0, contacts: 0, locations: 0 });
  });

  await t.test("(2) the performer must be an active EOS Principal of the tenant -- a Firebase uid is refused", async () => {
    await assert.rejects(withPoolClient(pool, (c) => copyCrm(c, copyInput({ performedByPrincipalId: FAKE_UID_A }))), code("PERFORMER_NOT_TENANT_PRINCIPAL"));
    await assert.rejects(withPoolClient(pool, (c) => copyCrm(c, copyInput({ performedByPrincipalId: "p-t2" }))), code("PERFORMER_NOT_TENANT_PRINCIPAL"));
    assert.deepEqual(await counts(), { accounts: 0, contacts: 0, locations: 0 });
  });

  let report;
  await t.test("(3) COPY: ids, fields, children, microsecond timestamps verbatim; EOS Principal attribution; one audit event", async () => {
    report = await withPoolClient(pool, (c) => copyCrm(c, copyInput()));
    assert.equal(report.outcome, "COPIED");
    assert.deepEqual([report.accounts, report.contacts, report.locations], [{ inserted: 2, unchanged: 0 }, { inserted: 2, unchanged: 0 }, { inserted: 2, unchanged: 0 }]);
    const target = await withPoolClient(pool, (c) => readTenantCrm(c, "t1"));
    assert.deepEqual({ accounts: target.accounts, contacts: target.contacts, locations: target.locations }, JSON.parse(JSON.stringify(clean.crm)));
    for (const [, who] of target.attribution) assert.deepEqual(who, { createdBy: ACTOR, updatedBy: ACTOR });
    const alpha = (await q(`SELECT created_at, billing_contact_id, tax_status FROM eos_crm.accounts WHERE id = 'acct-alpha'`)).rows[0];
    assert.equal(alpha.billing_contact_id, "con-alpha-ap");
    assert.equal((await q(`SELECT ${"to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"} AS iso FROM eos_crm.accounts WHERE id = 'acct-alpha'`)).rows[0].iso, "2025-01-02T03:04:05.678000Z");
    const audits = (await q(`SELECT actor_uid, action, after FROM eos_policy.audit_events WHERE tenant_id = 't1' AND action = 'crm.cutover.copy'`)).rows;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor_uid, ACTOR);
    assert.equal(audits[0].after.canonicalDigest, clean.census.canonicalDigest);
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_crm.accounts WHERE id = 'cw-acct-000'`)).rows[0].n), 0, "a Certification fixture was copied");
  });

  await t.test("(4) UID: no Firebase uid or legacy actor appears in ANY column of any copied row", async () => {
    for (const table of ["accounts", "contacts", "account_locations", "account_tags", "account_relationship_types", "account_lines_of_business"]) {
      const { rows } = await q(`SELECT row_to_json(x)::text AS j FROM eos_crm.${table} x WHERE x.tenant_id = 't1'`);
      for (const r of rows) for (const uid of [FAKE_UID_A, FAKE_UID_B, "emp-manager-1"]) assert.ok(!r.j.includes(uid), `${table} carries ${uid}: ${r.j}`);
    }
  });

  await t.test("(5) the copied rows are readable through the governed D1-A authorities", async () => {
    const deps = { pool };
    const actor = { tenantId: "t1", principalId: ACTOR, capabilities: new Set(["customer.record.read"]) };
    const a = await accounts.getAccount(deps, actor, { accountId: "acct-alpha" });
    assert.deepEqual(a.billingAddress, { street: "1 Fixture Way", city: "Testville", state: "AZ", zip: "85001" });
    assert.deepEqual([a.ownerEmployeeId, a.paymentTerms, a.taxStatus, a.billingContactId, a.tags, a.lineOfBusiness], ["emp-owner-1", "NET_30", "TAXABLE", "con-alpha-ap", ["fixture"], ["TAYLOR"]]);
    const bravo = await accounts.getAccount(deps, actor, { accountId: "acct-bravo" });
    assert.equal(bravo.ownerEmployeeId, null, "the legacy ownerless Account reads back ownerless");
    const listed = await contacts.listAccountContacts(deps, actor, { accountId: "acct-alpha" });
    assert.deepEqual(listed.items.map((c) => c.contactId), ["con-alpha-ap"]);
  });

  await t.test("(6) RERUN of the same snapshot writes nothing and appends no audit event", async () => {
    const again = await withPoolClient(pool, (c) => copyCrm(c, copyInput({ performedByPrincipalId: ACTOR })));
    assert.equal(again.outcome, "NO_CHANGES");
    assert.equal(again.auditEventId, null);
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE action = 'crm.cutover.copy'`)).rows[0].n), 1);
  });

  await t.test("(7) VERIFY --sample all is reconciled, including Commercial compatibility", async () => {
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, created_by, updated_by)
             VALUES ('opp-1','t1','OPP-2026-000001','acct-alpha','emp-owner-1','seed','seed')`);
    const v = await withPoolClient(pool, (c) => verifyCrm(c, { tenantId: "t1", crm: clean.crm, sample: "all", provenanceActors: provenanceActors(clean.evidence), excludedIds: excludedIds(clean.evidence) }));
    assert.equal(v.reconciled, true, JSON.stringify(v, null, 2));
    assert.deepEqual(v.sampled, { accounts: 2, contacts: 2, locations: 2 });
    assert.deepEqual(v.commercialAccountReferences.find((c) => c.table === "eos_commercial.opportunities"), { table: "eos_commercial.opportunities", rows: 1, unresolved: 0 });
  });

  await t.test("(8) VERIFY finds a changed field and a uid attribution", async () => {
    await q(`UPDATE eos_crm.contacts SET phone = '555-9999', created_by = $1 WHERE id = 'con-alpha-ap'`, [FAKE_UID_A]);
    try {
      const v = await withPoolClient(pool, (c) => verifyCrm(c, { tenantId: "t1", crm: clean.crm, sample: "all", provenanceActors: provenanceActors(clean.evidence), excludedIds: excludedIds(clean.evidence) }));
      assert.equal(v.reconciled, false);
      assert.deepEqual(v.fieldMismatches, [{ collection: "contacts", id: "con-alpha-ap", fields: ["phone"] }]);
      assert.equal(v.integrity.attributionIsLegacyActor, 1);
      assert.equal(v.integrity.attributionNotAnEosPrincipal, 1);
    } finally {
      await q(`UPDATE eos_crm.contacts SET phone = '555-0100', created_by = $1 WHERE id = 'con-alpha-ap'`, [ACTOR]);
    }
  });

  await t.test("(9) DRIFT: a changed source record is refused and NEVER overwrites the copied row", async () => {
    const drifted = cleanSnapshot();
    drifted.accounts[0].data.notes = "changed in Firestore after the copy";
    const d = await censusFor(pool, "t1", drifted);
    const before = (await q(`SELECT notes, updated_at FROM eos_crm.accounts WHERE id = 'acct-alpha'`)).rows[0];
    await assert.rejects(withPoolClient(pool, (c) => copyCrm(c, copyInput({ crm: d.crm, canonicalDigest: d.census.canonicalDigest }))), (e) => {
      code("DRIFT_DETECTED")(e);
      assert.deepEqual(e.details, [{ collection: "accounts", id: "acct-alpha", fields: ["notes"] }]);
      return true;
    });
    assert.deepEqual((await q(`SELECT notes, updated_at FROM eos_crm.accounts WHERE id = 'acct-alpha'`)).rows[0], before);
  });

  await t.test("(10) UNKNOWN target rows refuse; manifest-declared synthetic seed rows are retained only when explicitly asked", async () => {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
      ('synthetic-np-acct-retail','t1','SYNTHETIC NONPROD Retail Customer (fixture)','ACTIVE','emp-owner-1','seed','seed'),
      ('acct-created-elsewhere','t1','Stray','ACTIVE','emp-owner-1','seed','seed')`);
    const declared = { accounts: ["synthetic-np-acct-retail"], contacts: [], locations: [] };
    await assert.rejects(withPoolClient(pool, (c) => copyCrm(c, copyInput({ declaredSynthetic: declared, retainDeclaredSynthetic: true }))), (e) => {
      code("TARGET_HAS_UNKNOWN_RECORDS")(e);
      assert.deepEqual(e.details, [{ collection: "accounts", id: "acct-created-elsewhere" }]);
      return true;
    });
    await q(`DELETE FROM eos_crm.accounts WHERE id = 'acct-created-elsewhere'`);
    await assert.rejects(withPoolClient(pool, (c) => copyCrm(c, copyInput({ declaredSynthetic: declared }))), code("TARGET_HAS_UNKNOWN_RECORDS"));
    const kept = await withPoolClient(pool, (c) => copyCrm(c, copyInput({ declaredSynthetic: declared, retainDeclaredSynthetic: true })));
    assert.equal(kept.outcome, "NO_CHANGES");
    assert.deepEqual(kept.retainedDeclaredSyntheticRows.accounts, ["synthetic-np-acct-retail"]);
    await q(`DELETE FROM eos_crm.accounts WHERE id = 'synthetic-np-acct-retail'`);
  });

  await t.test("(11) TENANCY: another tenant sees none of t1's copy, and cannot take t1's ids", async () => {
    const t2 = await withPoolClient(pool, (c) => readTenantCrm(c, "t2"));
    assert.deepEqual([t2.accounts, t2.contacts, t2.locations], [[], [], []]);
    const v = await withPoolClient(pool, (c) => verifyCrm(c, { tenantId: "t2", crm: clean.crm, sample: "all", provenanceActors: [], excludedIds: excludedIds(clean.evidence) }));
    assert.equal(v.reconciled, false);
    assert.deepEqual(v.missingInTarget.accounts, ["acct-alpha", "acct-bravo"]);
    // A finance row (append-only, no Account FK) naming an Account this tenant does not hold is reported unresolved.
    await q(`INSERT INTO eos_finance.payments (id, tenant_id, operating_company_key, account_id, currency, amount_minor, received_at, recorded_by)
             VALUES ('pay-t2','t2','taylor','acct-gone','USD',100, now(),'seed')`);
    const withPayment = await withPoolClient(pool, (c) => verifyCrm(c, { tenantId: "t2", crm: { accounts: [], contacts: [], locations: [] }, sample: "all", provenanceActors: [], excludedIds: excludedIds(clean.evidence) }));
    assert.deepEqual(withPayment.commercialAccountReferences.find((c) => c.table === "eos_finance.payments"), { table: "eos_finance.payments", rows: 1, unresolved: 1 });
    assert.equal(withPayment.reconciled, false);
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('emp-owner-1-t2','t2','ACTIVE','taylor')`);
    const crmForT2 = JSON.parse(JSON.stringify(clean.crm).replaceAll('"emp-owner-1"', '"emp-owner-1-t2"'));
    await assert.rejects(withPoolClient(pool, (c) => copyCrm(c, copyInput({ tenantId: "t2", performedByPrincipalId: "p-t2", crm: crmForT2 }))), code("ID_HELD_BY_ANOTHER_TENANT"));
    assert.deepEqual(await counts("t2"), { accounts: 0, contacts: 0, locations: 0 });
  });

  await t.test("(12) CLI end to end: census -> copy -> verify through the fenced tool; no secret in any output", async () => {
    // A fresh tenant so the CLI's copy is a real one.
    await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t3','crm-cli','T3')`);
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ('p-t3','p-t3','proof','active')`);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-p-t3','t3','p-t3')`);
    // Employee and record ids are global primary keys: t3 gets its own owner and its own record ids.
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('emp-owner-t3','t3','ACTIVE','taylor')`);
    const snap = JSON.parse(JSON.stringify(asFile(cleanSnapshot())).replaceAll('"emp-owner-1"', '"emp-owner-t3"')
      .replaceAll("acct-", "t3acct-").replaceAll("con-", "t3con-").replaceAll("loc-", "t3loc-"));
    const dir = mkdtempSync(join(tmpdir(), "crm-cli-"));
    const file = join(dir, "crm-snapshot.json");
    const bytes = JSON.stringify(asFile(snap), null, 2) + "\n";
    writeFileSync(file, bytes);
    writeFileSync(`${file}.sha256`, `${createHash("sha256").update(bytes).digest("hex")}  crm-snapshot.json\n`);
    const run = (mode, extra = []) => spawnSync(process.execPath, ["scripts/crmCutover.js", "--mode", mode, "--environment", "platform-sandbox", "--databaseUrlEnv", "CRM_CLI_DB",
      "--tenantKey", "crm-cli", "--snapshot", file, ...extra], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", CRM_CLI_DB: dbUrl() } });
    const secret = new URL(URL_BASE).password;
    const check = (res, status, label) => {
      const out = `${res.stdout}${res.stderr}`;
      assert.equal(res.status, status, `${label}: ${out}`);
      assert.ok(!out.includes(secret), `${label} printed the database password`);
      assert.ok(!out.includes("postgres://"), `${label} printed a connection string`);
      return out;
    };
    const census = JSON.parse(check(run("census", ["--evidenceOut", join(dir, "census-evidence.json")]), 0, "census"));
    assert.equal(census.census.copyReady, true);
    const evidence = JSON.parse(readFileSync(join(dir, "census-evidence.json"), "utf8"));
    assert.ok(evidence.evidence.provenance.some((p) => p.createdBy === FAKE_UID_A), "uid provenance is in the evidence file");
    const copied = JSON.parse(check(run("copy", ["--performedByPrincipalId", "p-t3", "--evidenceOut", join(dir, "copy-evidence.json")]), 0, "copy"));
    assert.equal(copied.report.outcome, "COPIED");
    assert.equal(copied.evidenceSha256, createHash("sha256").update(readFileSync(join(dir, "copy-evidence.json"))).digest("hex"));
    const verified = JSON.parse(check(run("verify", ["--sample", "all"]), 0, "verify"));
    assert.equal(verified.report.reconciled, true);
    check(run("copy", ["--performedByPrincipalId", "p-t3", "--evidenceOut", join(dir, "copy-evidence.json")]), 2, "copy with an existing evidence file");
    const rerun = JSON.parse(check(run("copy", ["--performedByPrincipalId", "p-t3", "--evidenceOut", join(dir, "copy-evidence-2.json")]), 0, "rerun"));
    assert.equal(rerun.report.outcome, "NO_CHANGES");
    writeFileSync(`${file}.sha256`, `${"0".repeat(64)}  crm-snapshot.json\n`);
    check(run("copy", ["--performedByPrincipalId", "p-t3", "--evidenceOut", join(dir, "copy-evidence-3.json")]), 2, "copy with a tampered checksum");
  });
});
