// CLC (DECISIONS #CLC) against a real postgres:16 -- the GOVERNED, AUDITED, SET-ONCE correction of a COMPANY-LESS Opportunity or Sales Agreement.
//
//   assignRecordOperatingCompany { family, recordId, operatingCompanyId, reason, idempotencyKey }   (commercial.recordCompany.assign, registered with NO grants)
//
// Order: capability -> the record is VISIBLE under the null-company rule (else NONEXISTENT) -> the caller REACHES the target company (Q-1a) -> the record is still
// COMPANY-LESS -> LINEAGE agrees. Every refusal leaves ZERO trace (a hash of every row of every table the command could touch is unchanged). An applied command writes
// ONE audit row (reason, before, after) in its own transaction; a replay writes nothing; two concurrent assigns have exactly one winner.
//
// THE GOVERNED RESOLVER decides throughout: no `companyReach` seam is injected anywhere in this file.
// The capability row is inserted idempotently (the same row the migration registers) so this suite proves the command whether or not the migration has landed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";
import { seedProtectedOwnerRows } from "./support/protectedOwnerFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const opp = require("../lib/eosCommercial/commands/opportunityCommandService.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const rc = require("../lib/eosCommercial/commands/commercialRecordCompanyService.js");
const oppRead = require("../lib/eosCommercial/reads/opportunityReadProjection.js");
const saRead = require("../lib/eosCommercial/reads/salesAgreementReadProjection.js");
const authority = require("../lib/eosCommercial/commercialCompanyAuthority.js");

const DB_NAME = `clc_company_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const T = "t1";
const KEY = "commercial.recordCompany.assign";
const WRITE = ["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"];
const READ = ["opportunity.read", "salesAgreement.read", "salesOrder.read"];
const ALL = new Set([...WRITE, ...READ]);
const ASSIGN = new Set([...ALL, KEY]);
const key = () => `k-${randomUUID()}`;
const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } return assert.fail("expected a refusal"); };
const words = (e) => [e.code, e.category, e.message];
const REASON = "Entered without a company by mistake; it belongs to the stated company.";

test("CLC: the governed, audited, set-once correction of a company-less record, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const wdeps = { pool, catalog };
  const rdeps = { pool };

  // The capability row, exactly as migration slot 1764719000000 registers it (idempotent: a no-op once the migration has run).
  await q(`INSERT INTO eos_policy.capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_commercial_recordCompany_assign', $1, 'Set the operating company of a company-less Opportunity or Sales Agreement, once.', 'opportunity', 'assignOperatingCompany', 'BUSINESS_ACTION', 'Set Operating Company')
    ON CONFLICT (key) DO NOTHING`, [KEY]);

  // ── the world: Taylor and Ventana (keys deliberately different from ids), two channels, people ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  for (const channel of ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ('t1', $1, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [channel]);
  }
  await bindOperatingCompany(q, T, "taylor", "taylor-ops-t1");
  await bindOperatingCompany(q, T, "ventana", "ventana-ops-t1");
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-tay','t1','Taylor Customer','ACTIVE','e-tay','x','x'), ('acct-ven','t1','Ventana Customer','ACTIVE','e-ven','x','x'), ('acct-null','t1','Unplaced Customer','ACTIVE','e-tay','x','x')`);
  const employees = [["e-tay", "taylor"], ["e-ven", "ventana"], ["e-dual", "taylor"], ["e-own", "taylor"], ["e-creator", "taylor"], ["e-vcreator", "ventana"], ["e-other", "taylor"]];
  for (const [id, company] of employees) {
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1,'t1','ACTIVE',$2,'2020-01-01T00:00:00Z')`, [id, company]);
  }
  const principal = async (id, employeeId = null, company = "taylor") => {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [id]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,'t1',$2)`, [`m-${id}`, id]);
    if (employeeId) {
      await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
               VALUES ($1,'t1',$2,$3,$4,'OPERATOR_ASSERTED','fixture','test','active')`, [`l-${id}`, id, employeeId, company]);
    }
    return id;
  };
  const tay = await principal("p-tay", "e-tay");               // Taylor; owns the company-less records created below (their Account's owner)
  const ven = await principal("p-ven", "e-ven", "ventana");
  const dual = await principal("p-dual", "e-dual");            // Taylor home + an explicit company-access grant for Ventana: reaches both
  const own = await principal("p-own", "e-own");               // the protected Owner (home Taylor)
  const creator = await principal("p-creator", "e-creator");   // Taylor; creates company-less records
  const vcreator = await principal("p-vcreator", "e-vcreator", "ventana"); // Ventana; creates company-less records for a Taylor-owned Account
  const other = await principal("p-other", "e-other");         // Taylor, unrelated to the company-less records
  const admin = await principal("p-admin");                    // the protected Administrator: no Employee, no company assignment
  {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`);
      await c.query(`INSERT INTO eos_policy.employee_company_authority_grants (id, tenant_id, employee_id, operating_company_id, reason, granted_by)
                     VALUES ('g-dual','t1','e-dual','ventana','fixture: reaches both companies','fixture')`);
      await c.query("COMMIT");
    } finally { c.release(); }
  }
  await q(`INSERT INTO eos_policy.roles (id, tenant_id, key, name, origin, protected, created_by, updated_by) VALUES ('role-admin','t1','admin','Administrator','SYSTEM',true,'fixture','fixture')`);
  await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
           VALUES ('a-admin','t1',$1,'role-admin','global',NULL,'active','fixture',0,'fixture','fixture')`, [admin]);
  await seedProtectedOwnerRows(q, { tenantId: T, principalId: own });
  const actor = (principalId, caps = ALL) => ({ tenantId: T, principalId, capabilities: caps });

  const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const oppIn = (who, over = {}) => opp.createOpportunity(wdeps, actor(who), defined({
    idempotencyKey: key(), accountId: "acct-tay", salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "Reach-in",
    lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }], ...over }));
  const companyless = (who, over = {}) => oppIn(who, { accountId: "acct-null", operatingCompanyId: undefined, need: "Company not yet chosen", ...over });
  const agreementIn = (who, opportunityId, over = {}) => sa.createSalesAgreement(wdeps, actor(who), {
    idempotencyKey: key(), opportunityId, ownerEmployeeId: "e-tay", isLease: false, fulfillmentIntent: "INSTALL",
    lines: [{ kind: "SERVICE", ref: "svc-install", quantity: 1, unitPrice: 50000, businessUnitId: "INSTALLATION" }], shippingMinor: 100, taxMinor: 50, ...over });
  const assign = (who, over = {}, caps = ASSIGN) => rc.assignRecordOperatingCompany(wdeps, actor(who, caps),
    { idempotencyKey: key(), family: "OPPORTUNITY", recordId: "set-me", operatingCompanyId: "taylor", reason: REASON, ...over });
  const keyOf = async (table, id) => (await q(`SELECT operating_company_key AS k FROM eos_commercial.${table} WHERE id = $1`, [id])).rows[0].k;
  const audits = async (id) => (await q(`SELECT action, actor_uid, target_kind, target_id, before, after, reason FROM eos_policy.audit_events WHERE action = 'recordCompany.assign' AND target_id = $1`, [id])).rows;
  const visible = (who, read, field, id) => read(rdeps, actor(who), { [field]: id }).then(() => true, (e) => (e.code === "RECORD_NOT_FOUND" ? false : Promise.reject(e)));
  const STATE_TABLES = ["eos_commercial.opportunities", "eos_commercial.sales_agreements", "eos_commercial.sales_orders", "eos_commercial.command_receipts",
    "eos_commercial.number_counters", "eos_commercial.ownership_handoffs", "eos_policy.audit_events"];
  const stateHash = async () => {
    const parts = [];
    for (const table of STATE_TABLES) {
      parts.push(`${table}=${(await q(`SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '-') AS h, count(*)::int AS n FROM ${table} t`)).rows.map((r) => `${r.n}:${r.h}`)[0]}`);
    }
    return parts.join(";");
  };
  /** A refusal, with the SAME hash of every row before and after: no receipt, no audit row, no number, no change. */
  const refusedWithZeroTrace = async (fn, code, what) => {
    const before = await stateHash();
    const err = await refusal(fn);
    assert.equal(err.code, code, `${what}: ${err.code} ${err.message}`);
    assert.equal(await stateHash(), before, `${what}: ZERO TRACE`);
    return err;
  };

  // ── the records ──
  const oT = await oppIn(tay);                                   // Taylor, keyed
  const aT = await agreementIn(tay, oT.opportunityId);           // its Agreement (inherits the key)
  const oV = await oppIn(ven, { accountId: "acct-ven", operatingCompanyId: "ventana" });
  const aV = await agreementIn(ven, oV.opportunityId, { ownerEmployeeId: "e-ven" });

  await t.test("the capability is ONE BUSINESS_ACTION row, held by NOBODY: no Role grant, no direct grant, not even the protected Administrator's implied standing", async () => {
    const cap = (await q(`SELECT action_kind, object_key FROM eos_policy.capabilities WHERE key = $1`, [KEY])).rows;
    assert.deepEqual(cap.map((c) => c.action_kind), ["BUSINESS_ACTION"]);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = $1`, [KEY])).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = $1`, [KEY])).rows[0].n, 0);
    const protectedAdmin = require("../lib/adminPolicy/protectedAdministrator.js");
    assert.equal(protectedAdmin.isImpliedForProtectedAdministrator({ key: KEY, objectKey: cap[0].object_key, actionKind: "BUSINESS_ACTION" }), false);
  });

  // ════════════════════ POSITIVE ════════════════════

  await t.test("(1) an OPPORTUNITY: set once, one audit row with the reason and the before (null) / after company; the record then follows normal Q-1a company authority", async () => {
    const oN = await companyless(vcreator);
    assert.deepEqual((await q(`SELECT operating_company_key AS k, owner_employee_id AS o, created_by AS c, edit_version AS v FROM eos_commercial.opportunities WHERE id = $1`, [oN.opportunityId])).rows[0],
      { k: null, o: "e-tay", c: vcreator, v: "1" });
    // Before: visible to its owner (tay) and its creator (vcreator), the protected Administrator and the protected Owner; nobody else.
    for (const [who, expected] of [[tay, true], [vcreator, true], [admin, true], [own, true], [other, false], [ven, false], [dual, false]]) {
      assert.equal(await visible(who, oppRead.getOpportunityDetail, "opportunityId", oN.opportunityId), expected, `before: ${who}`);
    }
    // Owner ruling 2026-10-21, "company assignment constrained by the record creator's company authority; no Administrator bypass" (SAL-03(c) / #2199): this record's
    // CREATOR is a Ventana employee, so it can NOT be moved into Taylor -- a Taylor owner reaching Taylor is not enough. Refused, nothing written, creator keeps access.
    const refused = await refusedWithZeroTrace(() => assign(tay, { recordId: oN.opportunityId, operatingCompanyId: "taylor" }), "COMPANY_TRANSFER_DECISION_REQUIRED", "Ventana-created record, Taylor target");
    assert.equal(refused.category, "PRECONDITION_FAILED");
    assert.equal(await keyOf("opportunities", oN.opportunityId), null);
    assert.equal(await visible(vcreator, oppRead.getOpportunityDetail, "opportunityId", oN.opportunityId), true, "the creator keeps access after a refusal");
    // A record created by a Taylor employee is assigned Taylor normally.
    const oP = await companyless(creator);
    const out = await assign(tay, { recordId: oP.opportunityId, operatingCompanyId: "taylor" });
    assert.deepEqual(out, { family: "OPPORTUNITY", recordId: oP.opportunityId, operatingCompanyId: "taylor", editVersion: 2, inheritedSalesAgreementIds: [], replayed: false });
    assert.equal(await keyOf("opportunities", oP.opportunityId), "taylor-ops-t1");
    const rows = await audits(oP.opportunityId);
    assert.equal(rows.length, 1, "ONE audit row per applied command");
    assert.deepEqual([rows[0].actor_uid, rows[0].target_kind, rows[0].reason], [tay, "opportunity", REASON]);
    assert.deepEqual(rows[0].before, { operatingCompanyId: null, operatingCompanyKey: null });
    assert.deepEqual({ ...rows[0].after, authorizedBy: undefined }, { operatingCompanyId: "taylor", operatingCompanyKey: "taylor-ops-t1", editVersion: 2, inheritedSalesAgreementIds: [], authorizedBy: undefined });
    // After: normal company authority. Taylor's people (including a colleague who never owned it) gain it; Ventana never sees it.
    for (const [who, expected] of [[creator, true], [vcreator, false], [ven, false], [tay, true], [other, true], [dual, true], [admin, true], [own, true]]) {
      assert.equal(await visible(who, oppRead.getOpportunityDetail, "opportunityId", oP.opportunityId), expected, `after: ${who}`);
    }
    assert.equal((await refusal(() => opp.updateOpportunity(wdeps, actor(ven), { idempotencyKey: key(), opportunityId: oP.opportunityId, expectedEditVersion: 2, need: "x" }))).code, "RECORD_NOT_FOUND",
      "a non-reaching person cannot even edit it");
  });

  await t.test("(2) an AGREEMENT (a legacy company-less Agreement under an Opportunity that has a company): it takes the Opportunity's company", async () => {
    const o = await oppIn(tay);
    const a = await agreementIn(tay, o.opportunityId);
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = NULL WHERE id = $1`, [a.salesAgreementId]);
    const out = await assign(tay, { family: "SALES_AGREEMENT", recordId: a.salesAgreementId, operatingCompanyId: "taylor" });
    assert.deepEqual(out, { family: "SALES_AGREEMENT", recordId: a.salesAgreementId, operatingCompanyId: "taylor", editVersion: null, inheritedSalesAgreementIds: [], replayed: false });
    assert.equal(await keyOf("sales_agreements", a.salesAgreementId), "taylor-ops-t1");
    const rows = await audits(a.salesAgreementId);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].target_kind, rows[0].reason], ["salesAgreement", REASON]);
    // An Agreement with NO Opportunity chooses among the companies the caller reaches.
    const lone = await companyless(creator);
    const loneAgreement = await agreementIn(creator, lone.opportunityId);
    await q(`UPDATE eos_commercial.sales_agreements SET opportunity_id = NULL WHERE id = $1`, [loneAgreement.salesAgreementId]);
    assert.equal((await assign(dual, { family: "SALES_AGREEMENT", recordId: loneAgreement.salesAgreementId, operatingCompanyId: "ventana" }).catch((e) => e)).code, "RECORD_NOT_FOUND",
      "dual neither owns nor created it: it is nonexistent to dual until a company is set");
    const owned = await assign(creator, { family: "SALES_AGREEMENT", recordId: loneAgreement.salesAgreementId, operatingCompanyId: "taylor" });
    assert.equal(owned.replayed, false);
    assert.equal(await keyOf("sales_agreements", loneAgreement.salesAgreementId), "taylor-ops-t1");
  });

  await t.test("(3) INHERITANCE (Owner ruling): an Opportunity set with a company-less Agreement -> BOTH carry the company, in one transaction, with TWO audit rows; only the company column changes; the result lists the child", async () => {
    const o = await companyless(creator);
    const a = await agreementIn(creator, o.opportunityId);
    assert.equal(await keyOf("sales_agreements", a.salesAgreementId), null, "a child of a company-less parent is company-less");
    const frozen = async () => (await q(`SELECT owner_employee_id, accountable_employee_id, credited_salesperson_employee_id, state::text AS state, created_by, sales_agreement_number FROM eos_commercial.sales_agreements WHERE id = $1`, [a.salesAgreementId])).rows[0];
    const beforeChild = await frozen();
    // Set on its own, before its Opportunity has a company, the Agreement is refused and the words name the conflict.
    const alone = await refusedWithZeroTrace(() => assign(creator, { family: "SALES_AGREEMENT", recordId: a.salesAgreementId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "the child alone");
    assert.match(alone.message, /Opportunity has no operating company yet; set the Opportunity's operating company first/);
    const out = await assign(creator, { recordId: o.opportunityId, operatingCompanyId: "taylor" });
    assert.deepEqual(out.inheritedSalesAgreementIds, [a.salesAgreementId], "nothing is silent: the result lists every inherited child");
    assert.equal(await keyOf("opportunities", o.opportunityId), "taylor-ops-t1");
    assert.equal(await keyOf("sales_agreements", a.salesAgreementId), "taylor-ops-t1", "the Agreement INHERITED the company");
    assert.deepEqual(await frozen(), beforeChild, "ownership, accountable Employee, credit, state and number are untouched: only the company changed");
    const parentRows = await audits(o.opportunityId);
    const childRows = await audits(a.salesAgreementId);
    assert.equal(parentRows.length, 1);
    assert.equal(childRows.length, 1, "one audit event for the parent plus one per CHANGED Agreement");
    assert.deepEqual(parentRows[0].after.inheritedSalesAgreementIds, [a.salesAgreementId]);
    assert.deepEqual([childRows[0].target_kind, childRows[0].reason, childRows[0].actor_uid], ["salesAgreement", REASON, creator]);
    assert.deepEqual(childRows[0].before, { operatingCompanyId: null, operatingCompanyKey: null });
    assert.deepEqual({ ...childRows[0].after, authorizedBy: undefined }, { operatingCompanyId: "taylor", operatingCompanyKey: "taylor-ops-t1", basis: `inherited from Opportunity ${o.opportunityId}`, authorizedBy: undefined });
    assert.equal(await visible(other, saRead.getSalesAgreementDetail, "salesAgreementId", a.salesAgreementId), true, "and the child now follows normal company authority");
    // A child never changes once set: asking again changes nothing.
    await refusedWithZeroTrace(() => assign(creator, { family: "SALES_AGREEMENT", recordId: a.salesAgreementId, operatingCompanyId: "taylor" }), "OPERATING_COMPANY_ALREADY_SET", "the inherited child");
  });

  await t.test("(3b) an Agreement ALREADY in the Opportunity's company is left unchanged: no child write, no child audit row; and an Opportunity with NO Agreement succeeds", async () => {
    const o = await companyless(creator);
    const a = await agreementIn(creator, o.opportunityId);
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = 'taylor-ops-t1' WHERE id = $1`, [a.salesAgreementId]);
    const stamp = async () => (await q(`SELECT updated_at::text AS u, updated_by AS b FROM eos_commercial.sales_agreements WHERE id = $1`, [a.salesAgreementId])).rows[0];
    const beforeChild = await stamp();
    const out = await assign(creator, { recordId: o.opportunityId, operatingCompanyId: "taylor" });
    assert.deepEqual(out.inheritedSalesAgreementIds, []);
    assert.deepEqual(await stamp(), beforeChild, "the child row was not written");
    assert.equal((await audits(a.salesAgreementId)).length, 0, "no audit row for an unchanged Agreement");
    assert.equal((await audits(o.opportunityId)).length, 1);
    const bare = await companyless(creator);
    assert.deepEqual((await assign(creator, { recordId: bare.opportunityId })).inheritedSalesAgreementIds, []);
    assert.equal(await keyOf("opportunities", bare.opportunityId), "taylor-ops-t1");
  });

  await t.test("(3c) an Agreement in ANOTHER company refuses the WHOLE command (LINEAGE_DISAGREEMENT, nothing overwritten, zero trace); neutral words when the Agreement is not visible to the caller", async () => {
    const o = await companyless(creator);
    const a = await agreementIn(creator, o.opportunityId);
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = 'ventana-ops-t1' WHERE id = $1`, [a.salesAgreementId]);
    // the creator reaches Taylor only: the Ventana Agreement is invisible to it -> the neutral words, no company named
    const hidden = await refusedWithZeroTrace(() => assign(creator, { recordId: o.opportunityId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "a hidden differing child");
    assert.equal(hidden.message, "the company of a related record cannot be confirmed from here; ask someone who can see it");
    // the Administrator sees it: the conflict is named
    const named = await refusedWithZeroTrace(() => assign(admin, { recordId: o.opportunityId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "a visible differing child");
    assert.match(named.message, /Sales Agreement is already in operating company 'ventana', which differs from 'taylor'/);
    assert.equal(await keyOf("opportunities", o.opportunityId), null);
    assert.equal(await keyOf("sales_agreements", a.salesAgreementId), "ventana-ops-t1", "nothing overwritten");
    // and an Agreement set directly to a company other than its (set) Opportunity's names the Opportunity's company only if the caller can see it
    const oK = await oppIn(ven, { accountId: "acct-ven", operatingCompanyId: "ventana" });
    const aK = await agreementIn(ven, oK.opportunityId, { ownerEmployeeId: "e-ven" });
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = NULL, owner_employee_id = 'e-tay' WHERE id = $1`, [aK.salesAgreementId]);
    const hiddenParent = await refusedWithZeroTrace(() => assign(tay, { family: "SALES_AGREEMENT", recordId: aK.salesAgreementId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "a parent Taylor cannot see");
    assert.equal(hiddenParent.message, "the company of a related record cannot be confirmed from here; ask someone who can see it");
    const namedParent = await refusedWithZeroTrace(() => assign(admin, { family: "SALES_AGREEMENT", recordId: aK.salesAgreementId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "a parent the Administrator sees");
    assert.match(namedParent.message, /Opportunity is in operating company 'ventana', not 'taylor'/);
  });

  await t.test("(3d) NEW Agreement creation: it inherits the Opportunity's company on the server and refuses a conflicting client-supplied company (Q-1a M-3); a company-less Opportunity keeps its Agreement company-less", async () => {
    const o = await oppIn(tay);
    const clash = await refusal(() => agreementIn(dual, o.opportunityId, { operatingCompanyId: "ventana" }));
    assert.equal(clash.code, "OPERATING_COMPANY_MISMATCH");
    const a = await agreementIn(tay, o.opportunityId);
    assert.equal(await keyOf("sales_agreements", a.salesAgreementId), "taylor-ops-t1", "inherited from the Opportunity");
    const n = await companyless(creator);
    assert.equal((await refusal(() => agreementIn(creator, n.opportunityId, { operatingCompanyId: "taylor" }))).code, "OPERATING_COMPANY_MISMATCH", "a company cannot be chosen by stating it on the child of a company-less Opportunity");
    const nc = await agreementIn(creator, n.opportunityId);
    assert.equal(await keyOf("sales_agreements", nc.salesAgreementId), null);
  });

  // ════════════════════ REFUSALS (each with ZERO trace) ════════════════════

  await t.test("(4) ALREADY SET: a record that has a company is never changed, whatever the target (even a company the caller reaches)", async () => {
    await refusedWithZeroTrace(() => assign(tay, { recordId: oT.opportunityId, operatingCompanyId: "taylor" }), "OPERATING_COMPANY_ALREADY_SET", "same company");
    await refusedWithZeroTrace(() => assign(dual, { recordId: oT.opportunityId, operatingCompanyId: "ventana" }), "OPERATING_COMPANY_ALREADY_SET", "another company the caller reaches");
    await refusedWithZeroTrace(() => assign(tay, { family: "SALES_AGREEMENT", recordId: aT.salesAgreementId, operatingCompanyId: "taylor" }), "OPERATING_COMPANY_ALREADY_SET", "an Agreement");
    assert.equal(await keyOf("opportunities", oT.opportunityId), "taylor-ops-t1");
  });

  await t.test("(5) TARGET COMPANY UNREACHED: reads exactly like a company this tenant does not govern, and the record is unchanged", async () => {
    const o = await companyless(creator);
    const unreached = await refusedWithZeroTrace(() => assign(creator, { recordId: o.opportunityId, operatingCompanyId: "ventana" }), "OPERATING_COMPANY_NOT_GOVERNED", "Taylor-only caller, Ventana");
    const ungoverned = await refusal(() => assign(creator, { recordId: o.opportunityId, operatingCompanyId: "nowhere" }));
    assert.deepEqual(words(unreached).slice(0, 2), words(ungoverned).slice(0, 2));
    assert.equal(unreached.message, "operating company 'ventana' is not governed in this tenant");
    assert.equal(await keyOf("opportunities", o.opportunityId), null);
  });

  await t.test("(6) RECORD NOT VISIBLE: a foreign-company record and another person's company-less record are NONEXISTENT, in the same words as a missing id", async () => {
    const o = await companyless(creator);
    const missing = await refusal(() => assign(other, { recordId: "opp-missing" }));
    for (const [what, fn] of [
      ["a Ventana record, by a Taylor caller", () => assign(tay, { recordId: oV.opportunityId })],
      ["a company-less record, by a colleague who neither owns nor created it", () => assign(other, { recordId: o.opportunityId })],
      ["a company-less record, by a Ventana caller", () => assign(ven, { recordId: o.opportunityId })],
      ["a Ventana Agreement, by a Taylor caller", () => assign(tay, { family: "SALES_AGREEMENT", recordId: aV.salesAgreementId })],
    ]) {
      const e = await refusedWithZeroTrace(fn, "RECORD_NOT_FOUND", what);
      if (!what.includes("Agreement")) assert.deepEqual(words(e), words(missing), what);
    }
    assert.equal(await keyOf("opportunities", o.opportunityId), null);
  });

  await t.test("(7) LINEAGE: an Agreement cannot differ from its Opportunity, nor be set while its Opportunity has no company; an Opportunity refuses a child that disagrees", async () => {
    // an Agreement under a Ventana Opportunity, company-less (legacy shape), visible to its Taylor owner
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = NULL, owner_employee_id = 'e-tay' WHERE id = $1`, [aV.salesAgreementId]);
    await refusedWithZeroTrace(() => assign(tay, { family: "SALES_AGREEMENT", recordId: aV.salesAgreementId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "Taylor onto a Ventana Opportunity's Agreement");
    await refusedWithZeroTrace(() => assign(dual, { family: "SALES_AGREEMENT", recordId: aV.salesAgreementId, operatingCompanyId: "taylor" }), "RECORD_NOT_FOUND", "dual cannot see another's company-less Agreement");
    // an Agreement whose Opportunity has no company
    const o = await companyless(creator);
    const a = await agreementIn(creator, o.opportunityId);
    await refusedWithZeroTrace(() => assign(creator, { family: "SALES_AGREEMENT", recordId: a.salesAgreementId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "parent without a company");
    // an Opportunity whose company-less-parent child already carries ANOTHER company (SQL only: the commands cannot make this)
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = 'ventana-ops-t1' WHERE id = $1`, [a.salesAgreementId]);
    await refusedWithZeroTrace(() => assign(creator, { recordId: o.opportunityId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "a disagreeing child");
    assert.equal(await keyOf("opportunities", o.opportunityId), null);
    // restore the legacy Ventana shape for the following tests
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = 'ventana-ops-t1', owner_employee_id = 'e-ven' WHERE id = $1`, [aV.salesAgreementId]);
  });

  await t.test("(8) A REASON IS REQUIRED, and bounded; the family and the company are required; nothing is accepted that the command does not name", async () => {
    const o = await companyless(creator);
    for (const [over, code] of [
      [{ reason: undefined }, "REASON_REQUIRED"], [{ reason: "   " }, "REASON_REQUIRED"], [{ reason: "x".repeat(501) }, "REASON_TOO_LONG"],
      [{ family: "SALES_ORDER" }, "FAMILY_INVALID"], [{ operatingCompanyId: undefined }, "OPERATING_COMPANY_REQUIRED"], [{ operatingCompanyKey: "taylor-ops-t1" }, "FIELD_NOT_ACCEPTED"],
    ]) {
      await refusedWithZeroTrace(() => assign(creator, { recordId: o.opportunityId, ...over }), code, JSON.stringify(over));
    }
  });

  await t.test("(9) A NON-HOLDER is refused CAPABILITY_REQUIRED before anything is read: not an owner, not a creator, not the Administrator, not the Owner", async () => {
    const o = await companyless(creator);
    for (const who of [tay, creator, admin, own, dual]) {
      await refusedWithZeroTrace(() => assign(who, { recordId: o.opportunityId }, ALL), "CAPABILITY_REQUIRED", who);
    }
    // the protected Administrator does not hold it by standing alone: the resolved context (no grant) is what the transport hands the command
    const protectedAdmin = require("../lib/adminPolicy/protectedAdministrator.js");
    assert.equal(protectedAdmin.PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES.has(KEY), false);
  });

  // ════════════════════ THE PROTECTED ADMINISTRATOR AND THE PROTECTED OWNER ════════════════════

  // Owner ruling 2026-10-21, "company assignment constrained by the record creator's company authority; no Administrator bypass" (SAL-03(c) / #2199): the protected
  // Administrator's unrestricted REACH no longer lets it move a record into a company its CREATOR does not hold. It still assigns the creator's own company.
  await t.test("(10) the protected ADMINISTRATOR (unrestricted reach, once the key is granted) assigns the creator's company with the standing stamp, but NOT a company the creator lacks (no Administrator bypass)", async () => {
    const o = await companyless(creator);
    const err = await refusedWithZeroTrace(() => assign(admin, { recordId: o.opportunityId, operatingCompanyId: "ventana" }), "COMPANY_TRANSFER_DECISION_REQUIRED", "Administrator, Ventana on a Taylor-created record");
    assert.equal(err.category, "PRECONDITION_FAILED");
    assert.match(err.message, /separate governed transfer decision/);
    assert.equal(await keyOf("opportunities", o.opportunityId), null);
    assert.equal(await visible(creator, oppRead.getOpportunityDetail, "opportunityId", o.opportunityId), true, "the Taylor creator still sees the record it created");
    const out = await assign(admin, { recordId: o.opportunityId, operatingCompanyId: "taylor" });
    assert.equal(out.replayed, false);
    assert.equal(await keyOf("opportunities", o.opportunityId), "taylor-ops-t1");
    const [row] = await audits(o.opportunityId);
    assert.ok(row.after.authorizedBy, "the protected-Administrator provenance stamp");
    assert.equal(row.after.operatingCompanyId, "taylor");
  });

  await t.test("(11) the protected OWNER follows its OWN companies: it sees every company-less record, but assigns only a company it reaches", async () => {
    const o = await companyless(creator);
    await refusedWithZeroTrace(() => assign(own, { recordId: o.opportunityId, operatingCompanyId: "ventana" }), "OPERATING_COMPANY_NOT_GOVERNED", "Owner, Ventana (not its company)");
    assert.equal((await assign(own, { recordId: o.opportunityId, operatingCompanyId: "taylor" })).replayed, false);
    assert.equal(await keyOf("opportunities", o.opportunityId), "taylor-ops-t1");
    assert.equal((await audits(o.opportunityId))[0].actor_uid, own);
  });

  // ════════════════════ REPLAY, CONCURRENCY ════════════════════

  await t.test("(12) REPLAY: the same key and request returns the first result and writes nothing; the key on another record is refused", async () => {
    const o = await companyless(creator);
    const other2 = await companyless(creator);
    const k = key();
    const first = await assign(creator, { recordId: o.opportunityId, idempotencyKey: k });
    const before = await stateHash();
    const again = await assign(creator, { recordId: o.opportunityId, idempotencyKey: k });
    assert.deepEqual(again, { ...first, replayed: true });
    assert.equal(await stateHash(), before, "a replay wrote nothing");
    assert.equal((await audits(o.opportunityId)).length, 1);
    await refusedWithZeroTrace(() => assign(creator, { recordId: other2.opportunityId, idempotencyKey: k }), "IDEMPOTENCY_KEY_REUSED", "the key on another record");
    assert.equal(await keyOf("opportunities", other2.opportunityId), null);
  });

  await t.test("(13) CONCURRENCY: simultaneous assigns of one company-less record have EXACTLY ONE winner, one audit row, and the winner's company", async () => {
    const o = await oppIn(dual, { accountId: "acct-null", operatingCompanyId: undefined, need: "Race" });
    const racers = ["taylor", "ventana", "taylor", "ventana"].map((company) => assign(dual, { recordId: o.opportunityId, operatingCompanyId: company }).then((r) => ({ ok: r }), (e) => ({ err: e })));
    const settled = await Promise.all(racers);
    const winners = settled.filter((s) => s.ok);
    const losers = settled.filter((s) => s.err);
    assert.equal(winners.length, 1, JSON.stringify(settled.map((s) => s.err?.code ?? "ok")));
    assert.ok(losers.every((l) => ["OPERATING_COMPANY_ALREADY_SET", "CONCURRENT_MODIFICATION"].includes(l.err.code)), losers.map((l) => l.err.code).join());
    assert.equal(await keyOf("opportunities", o.opportunityId), winners[0].ok.operatingCompanyId === "taylor" ? "taylor-ops-t1" : "ventana-ops-t1");
    assert.equal((await audits(o.opportunityId)).length, 1, "one audit row, whatever the race");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.command_receipts WHERE operation = 'recordCompany.assign' AND target_id = $1`, [o.opportunityId])).rows[0].n, 1);
  });

  await t.test("(12b) RETRY of an Opportunity that inherited into an Agreement: the replay writes NOTHING and adds no second audit event for the parent or the child", async () => {
    const o = await companyless(creator);
    const a = await agreementIn(creator, o.opportunityId);
    const k = key();
    const first = await assign(creator, { recordId: o.opportunityId, idempotencyKey: k });
    assert.deepEqual(first.inheritedSalesAgreementIds, [a.salesAgreementId]);
    const before = await stateHash();
    const again = await assign(creator, { recordId: o.opportunityId, idempotencyKey: k });
    assert.deepEqual(again, { ...first, replayed: true });
    assert.equal(await stateHash(), before, "no duplicate row, receipt or audit event");
    assert.equal((await audits(o.opportunityId)).length + (await audits(a.salesAgreementId)).length, 2);
    // a padded record id is the same command (trimmed before the replay identity is built)
    const padded = await assign(creator, { recordId: `  ${o.opportunityId}  `, idempotencyKey: k });
    assert.equal(padded.replayed, true);
    assert.equal(await stateHash(), before);
  });

  await t.test("(13b) CONCURRENCY with a child: racing assigns of an Opportunity AND a direct assign of its Agreement leave parent and child CONSISTENT, with one audit event per changed record", async () => {
    const o = await oppIn(dual, { accountId: "acct-null", operatingCompanyId: undefined, need: "Race with a child" });
    const a = await agreementIn(dual, o.opportunityId);
    const racers = [
      assign(dual, { recordId: o.opportunityId, operatingCompanyId: "taylor" }),
      assign(dual, { recordId: o.opportunityId, operatingCompanyId: "ventana" }),
      assign(dual, { family: "SALES_AGREEMENT", recordId: a.salesAgreementId, operatingCompanyId: "taylor" }),
      assign(dual, { recordId: o.opportunityId, operatingCompanyId: "taylor" }),
    ].map((p) => p.then((r) => ({ ok: r }), (e) => ({ err: e })));
    const settled = await Promise.all(racers);
    const parent = await keyOf("opportunities", o.opportunityId);
    const child = await keyOf("sales_agreements", a.salesAgreementId);
    assert.ok(parent !== null, JSON.stringify(settled.map((s) => s.err?.code ?? "ok")));
    assert.equal(child, parent, "parent and child agree after any interleaving");
    assert.equal(settled.filter((s) => s.ok && s.ok.family === "OPPORTUNITY").length, 1, "exactly one Opportunity assign wins");
    assert.equal((await audits(o.opportunityId)).length, 1);
    assert.equal((await audits(a.salesAgreementId)).length, 1, "the child changed exactly once (by inheritance or, if it ran first, refused)");
    assert.ok(settled.filter((s) => s.err).every((s) => ["OPERATING_COMPANY_ALREADY_SET", "LINEAGE_DISAGREEMENT", "CONCURRENT_MODIFICATION"].includes(s.err.code)));
  });

  // ════════════════════ THE SERVER-DECIDED OFFER ════════════════════

  await t.test("(14) the record read OFFERS \"Set operating company\" only when the record is company-less, the caller holds the key, and a company is reachable; the client decides nothing", async () => {
    const o = await companyless(creator);
    const detail = (who, caps = ASSIGN) => oppRead.getOpportunityDetail(rdeps, actor(who, caps), { opportunityId: o.opportunityId });
    assert.deepEqual((await detail(creator)).operatingCompanyAssignment, { companies: [{ operatingCompanyId: "taylor" }] }, "a Taylor-only holder is offered Taylor only");
    assert.deepEqual((await detail(admin)).operatingCompanyAssignment, { companies: [{ operatingCompanyId: "taylor" }, { operatingCompanyId: "ventana" }] }, "the Administrator is offered every company");
    assert.deepEqual((await detail(own)).operatingCompanyAssignment, { companies: [{ operatingCompanyId: "taylor" }] }, "the Owner is offered its own company");
    assert.equal("operatingCompanyAssignment" in (await detail(creator, ALL)), false, "a non-holder is offered nothing");
    // A keyed record, and a record once assigned, are never offered.
    assert.equal("operatingCompanyAssignment" in (await oppRead.getOpportunityDetail(rdeps, actor(tay, ASSIGN), { opportunityId: oT.opportunityId })), false);
    await assign(creator, { recordId: o.opportunityId });
    assert.equal("operatingCompanyAssignment" in (await detail(creator)), false, "after the assignment");
    // An Agreement is offered only its Opportunity's company, and nothing while its Opportunity has none.
    const oC = await companyless(creator);
    const aC = await agreementIn(creator, oC.opportunityId);
    assert.equal("operatingCompanyAssignment" in (await saRead.getSalesAgreementDetail(rdeps, actor(creator, ASSIGN), { salesAgreementId: aC.salesAgreementId })), false, "parent without a company");
    const oK = await oppIn(tay);
    const aK = await agreementIn(tay, oK.opportunityId);
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = NULL WHERE id = $1`, [aK.salesAgreementId]);
    assert.deepEqual((await saRead.getSalesAgreementDetail(rdeps, actor(tay, ASSIGN), { salesAgreementId: aK.salesAgreementId })).operatingCompanyAssignment, { companies: [{ operatingCompanyId: "taylor" }] });
    // The parent is decided on the REAL Opportunity, not on the masked link: a company-less Agreement of a Ventana Opportunity that a Taylor owner can see is offered NOTHING.
    const xo = await oppIn(ven, { accountId: "acct-ven", operatingCompanyId: "ventana" });
    const xa = await agreementIn(ven, xo.opportunityId, { ownerEmployeeId: "e-ven" });
    await q(`UPDATE eos_commercial.sales_agreements SET operating_company_key = NULL, owner_employee_id = 'e-tay' WHERE id = $1`, [xa.salesAgreementId]);
    const seen = await saRead.getSalesAgreementDetail(rdeps, actor(tay, ASSIGN), { salesAgreementId: xa.salesAgreementId });
    assert.equal(seen.opportunityId, null, "the link to the unreached Opportunity is masked");
    assert.equal("operatingCompanyAssignment" in seen, false, "and Taylor is not offered a company that would disagree with the real parent");
    await refusedWithZeroTrace(() => assign(tay, { family: "SALES_AGREEMENT", recordId: xa.salesAgreementId, operatingCompanyId: "taylor" }), "LINEAGE_DISAGREEMENT", "the masked parent");
  });

  await t.test("(15) the resolver's reach is what the command uses (a cross-check against the governed resolver itself)", async () => {
    const reach = (p) => authority.resolveCommercialCompanyReach(pool, T, p);
    assert.deepEqual([...(await reach(creator)).companyKeys], ["taylor-ops-t1"]);
    assert.deepEqual([...(await reach(vcreator)).companyKeys], ["ventana-ops-t1"]);
    assert.deepEqual([...(await reach(dual)).companyKeys].sort(), ["taylor-ops-t1", "ventana-ops-t1"]);
    assert.equal((await reach(admin)).basis, "PROTECTED_ADMINISTRATOR");
  });

  // ════════════════════ CREATOR AUTHORITY (Owner ruling 2026-10-21: "company assignment constrained by the record creator's company authority; no Administrator bypass") ════════════════════
  // The assigned company must be within the valid company authority of the record's stored creator (Employee-based, resolved by the governed resolver). The actor still
  // needs the capability, visibility and target reach. Nothing is granted, nothing is rewritten, and a refusal leaves zero trace.

  await t.test("(16) CREATOR AUTHORITY refuses: no actor reaches a company the CREATOR does not hold -- not the Administrator, not a dual-company caller -- and a creator with no Employee link or no standing", async () => {
    const TRANSFER = "COMPANY_TRANSFER_DECISION_REQUIRED";
    const o = await companyless(creator); // a Taylor creator
    const byAdmin = await refusedWithZeroTrace(() => assign(admin, { recordId: o.opportunityId, operatingCompanyId: "ventana" }), TRANSFER, "Administrator, Ventana on a Taylor-created record");
    assert.deepEqual([byAdmin.category, /separate governed transfer decision/.test(byAdmin.message)], ["PRECONDITION_FAILED", true]);
    assert.doesNotMatch(byAdmin.message, /ventana|taylor/i, "the refusal names no company");
    await refusedWithZeroTrace(() => assign(dual, { recordId: o.opportunityId,operatingCompanyId: "ventana" }), "RECORD_NOT_FOUND", "a dual-company actor who is neither owner nor creator cannot even see it");
    // A dual-company OWNER who reaches Ventana is still refused when the creator is Taylor-only.
    await q(`UPDATE eos_commercial.opportunities SET owner_employee_id = 'e-dual' WHERE id = $1`, [o.opportunityId]);
    await refusedWithZeroTrace(() => assign(dual, { recordId: o.opportunityId, operatingCompanyId: "ventana" }), TRANSFER, "dual-company owner, Taylor-only creator, Ventana");
    assert.equal(await keyOf("opportunities", o.opportunityId), null);

    // A creator with NO Employee link, a creator with no standing, and a creator that does not exist: refused for the Administrator and for a reaching owner.
    const nolink = await principal("p-nolink");
    for (const [label, createdBy] of [["no Employee link", nolink], ["a principal that does not exist", "p-ghost"]]) {
      const r = await companyless(creator);
      await q(`UPDATE eos_commercial.opportunities SET created_by = $2 WHERE id = $1`, [r.opportunityId, createdBy]);
      await refusedWithZeroTrace(() => assign(admin, { recordId: r.opportunityId, operatingCompanyId: "taylor" }), TRANSFER, `Administrator, creator with ${label}`);
      await refusedWithZeroTrace(() => assign(tay, { recordId: r.opportunityId, operatingCompanyId: "taylor" }), TRANSFER, `owner, creator with ${label}`);
      assert.equal(await keyOf("opportunities", r.opportunityId), null);
    }

    // A child Agreement whose creator lacks the company refuses the WHOLE command (both records stay company-less; zero trace). The parent's creator holds both companies.
    const parent = await oppIn(dual, { accountId: "acct-null", operatingCompanyId: undefined, need: "Child creator lacks the company" });
    const child = await agreementIn(tay, parent.opportunityId); // created by a Taylor-only principal
    const ref = await refusedWithZeroTrace(() => assign(dual, { recordId: parent.opportunityId, operatingCompanyId: "ventana" }), TRANSFER, "child Agreement created by a Taylor-only principal");
    assert.equal(ref.category, "PRECONDITION_FAILED");
    assert.equal(await keyOf("opportunities", parent.opportunityId), null);
    assert.equal(await keyOf("sales_agreements", child.salesAgreementId), null);
    assert.deepEqual([(await audits(parent.opportunityId)).length, (await audits(child.salesAgreementId)).length], [0, 0]);
  });

  await t.test("(17) CREATOR AUTHORITY allows: the creator's home company (by the Administrator or an authorized actor), either company for a dual-company creator, and Agreement inheritance when its creator holds the company; audit rows keep their shape", async () => {
    // The creator's home company, by the protected Administrator (Ventana creator, Ventana target).
    const v = await companyless(vcreator);
    const byAdmin = await assign(admin, { recordId: v.opportunityId, operatingCompanyId: "ventana" });
    assert.equal(byAdmin.replayed, false);
    assert.equal(await keyOf("opportunities", v.opportunityId), "ventana-ops-t1");
    // A dual-company creator (explicit grant) can be assigned either company.
    for (const [company, expectedKey] of [["taylor", "taylor-ops-t1"], ["ventana", "ventana-ops-t1"]]) {
      const d = await oppIn(dual, { accountId: "acct-null", operatingCompanyId: undefined, need: `Dual creator -> ${company}` });
      assert.equal((await assign(dual, { recordId: d.opportunityId, operatingCompanyId: company })).replayed, false);
      assert.equal(await keyOf("opportunities", d.opportunityId), expectedKey);
    }
    // Agreement inheritance works when the child's creator also holds the company.
    const parent = await oppIn(dual, { accountId: "acct-null", operatingCompanyId: undefined, need: "Inheritance" });
    const child = await agreementIn(dual, parent.opportunityId);
    const out = await assign(dual, { recordId: parent.opportunityId, operatingCompanyId: "ventana" });
    assert.deepEqual(out.inheritedSalesAgreementIds, [child.salesAgreementId]);
    assert.equal(await keyOf("opportunities", parent.opportunityId), "ventana-ops-t1");
    assert.equal(await keyOf("sales_agreements", child.salesAgreementId), "ventana-ops-t1");
    // Audit rows are unchanged in shape; ownership and creator are never rewritten.
    const [pr] = await audits(parent.opportunityId);
    assert.deepEqual(Object.keys(pr.after).filter((k) => k !== "authorizedBy").sort(), ["editVersion", "inheritedSalesAgreementIds", "operatingCompanyId", "operatingCompanyKey"]);
    assert.deepEqual(Object.keys(pr.before).sort(), ["operatingCompanyId", "operatingCompanyKey"]);
    assert.equal((await q(`SELECT created_by, owner_employee_id FROM eos_commercial.opportunities WHERE id = $1`, [parent.opportunityId])).rows[0].created_by, dual);
  });
});
