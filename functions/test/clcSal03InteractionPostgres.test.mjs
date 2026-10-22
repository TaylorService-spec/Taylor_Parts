// UAT-R2 interaction test: #2199 CLC x #2211 SAL-03(c), on the integrated code.
//   - a company-less record created by a Taylor creator whose Taylor-inherited owner is valid can be assigned Taylor by CLC;
//   - CLC cannot assign Ventana to it (COMPANY_TRANSFER_DECISION_REQUIRED);
//   - while the record is company-less, a foreign (Ventana) owner cannot be set: not at creation, not by reassignment;
//   - after CLC makes it company-keyed, owner reassignment is outside SAL-03(c) (known P1 SAL-03(a)), but the foreign
//     Employee still never gains reach to the record: reach on a company-keyed record is decided by company alone.
// Real PostgreSQL, real services, no injected seams.
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

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const opp = require("../lib/eosCommercial/commands/opportunityCommandService.js");
const rc = require("../lib/eosCommercial/commands/commercialRecordCompanyService.js");
const oppRead = require("../lib/eosCommercial/reads/opportunityReadProjection.js");

const DB_NAME = `r2i_int_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) { const c = new pg.Client({ connectionString: url }); await c.connect(); try { return await fn(c); } finally { await c.end(); } }
const T = "t1";
const KEY = "commercial.recordCompany.assign";
const CAPS = new Set(["opportunity.read", "opportunity.write", "salesAgreement.read", "salesAgreement.create", "salesAgreement.updateDraft"]);
const ASSIGN = new Set([...CAPS, KEY]);
const key = () => `k-${randomUUID()}`;
const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } return assert.fail("expected a refusal"); };

test("CLC x SAL-03(c): a Taylor-created company-less record", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 4 });
  t.after(async () => { await endPoolAndDrain(pool); await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)); });
  const q = (text, values = []) => pool.query(text, values);
  const wdeps = { pool, catalog };
  const rdeps = { pool };

  await q(`INSERT INTO eos_policy.capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_commercial_recordCompany_assign', $1, 'Set the operating company of a company-less Opportunity or Sales Agreement, once.', 'opportunity', 'assignOperatingCompany', 'BUSINESS_ACTION', 'Set Operating Company')
    ON CONFLICT (key) DO NOTHING`, [KEY]);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  for (const channel of ["RETAIL"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ('t1', $1, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [channel]);
  }
  await bindOperatingCompany(q, T, "taylor", "taylor-ops-t1");
  await bindOperatingCompany(q, T, "ventana", "ventana-ops-t1");
  // acct-null-tay: no company on the Account's own record, governed owner = e-tay (Taylor). acct-ven: owned by e-ven (Ventana).
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-null-tay','t1','Unplaced, Taylor-owned','ACTIVE','e-tay','x','x'), ('acct-ven','t1','Ventana Customer','ACTIVE','e-ven','x','x')`);
  for (const [id, company] of [["e-tay", "taylor"], ["e-ven", "ventana"], ["e-creator", "taylor"]]) {
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1,'t1','ACTIVE',$2,'2020-01-01T00:00:00Z')`, [id, company]);
  }
  const principal = async (id, employeeId, company) => {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [id]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,'t1',$2)`, [`m-${id}`, id]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
             VALUES ($1,'t1',$2,$3,$4,'OPERATOR_ASSERTED','fixture','test','active')`, [`l-${id}`, id, employeeId, company]);
    return id;
  };
  const creator = await principal("p-creator", "e-creator", "taylor");
  const tay = await principal("p-tay", "e-tay", "taylor");
  const ven = await principal("p-ven", "e-ven", "ventana");
  // The protected Administrator (no Employee): sees every company-less record and reaches Ventana, so the ONLY thing that can refuse Ventana is the CREATOR-company check (no Administrator bypass).
  await q("INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ('p-admin','p-admin','proof','active')");
  await q("INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m-p-admin','t1','p-admin')");
  await q("INSERT INTO eos_policy.roles (id, tenant_id, key, name, origin, protected, created_by, updated_by) VALUES ('role-admin','t1','admin','Administrator','SYSTEM',true,'fixture','fixture')");
  await q("INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by) VALUES ('a-admin','t1','p-admin','role-admin','global',NULL,'active','fixture',0,'fixture','fixture')");
  const dual = 'p-admin';
  const actor = (principalId, caps = CAPS) => ({ tenantId: T, principalId, capabilities: caps });
  const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const mk = (who, over = {}) => opp.createOpportunity(wdeps, actor(who), defined({ idempotencyKey: key(), accountId: "acct-null-tay", salesChannel: "RETAIL", need: "Reach-in", lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }], ...over }));
  const assign = (who, recordId, operatingCompanyId) => rc.assignRecordOperatingCompany(wdeps, actor(who, ASSIGN),
    { idempotencyKey: key(), family: "OPPORTUNITY", recordId, operatingCompanyId, reason: "Rehearsal: company-less record belongs to the stated company." });
  const keyOf = async (id) => (await q(`SELECT operating_company_key AS k FROM eos_commercial.opportunities WHERE id = $1`, [id])).rows[0].k;
  const ownerOf = async (id) => (await q(`SELECT owner_employee_id AS o FROM eos_commercial.opportunities WHERE id = $1`, [id])).rows[0].o;
  const sees = (who, id) => oppRead.getOpportunityDetail(rdeps, actor(who), { opportunityId: id }).then(() => true, (e) => (e.code === "RECORD_NOT_FOUND" ? false : Promise.reject(e)));
  const reassign = (who, id, expectedEditVersion, ownerEmployeeId) => opp.updateOpportunity(wdeps, actor(who), { idempotencyKey: key(), opportunityId: id, expectedEditVersion, ownerEmployeeId });

  await t.test("(a) Taylor creator + Taylor-inherited valid owner: created company-less, CLC assigns Taylor", async () => {
    const o = await mk(creator); // owner inherited from acct-null-tay = e-tay, home company inside the creator's authority
    assert.equal(await ownerOf(o.opportunityId), "e-tay");
    assert.equal(await keyOf(o.opportunityId), null);
    const out = await assign(tay, o.opportunityId, "taylor");
    assert.equal(out.replayed, false);
    assert.equal(await keyOf(o.opportunityId), "taylor-ops-t1");
    assert.equal(await sees(ven, o.opportunityId), false, "Ventana never sees it");
  });

  await t.test("(b) CLC cannot assign Ventana to a Taylor-created record", async () => {
    const o = await mk(creator);
    const e = await refusal(() => assign(dual, o.opportunityId, "ventana"));
    assert.equal(e.code, "COMPANY_TRANSFER_DECISION_REQUIRED");
    assert.equal(await keyOf(o.opportunityId), null);
  });

  await t.test("(c) a foreign owner can never be set: not at creation, not by reassignment before assignment", async () => {
    const e1 = await refusal(() => mk(creator, { ownerEmployeeId: "e-ven" }));
    assert.equal(e1.code, "OWNER_NOT_FOUND");
    const e2 = await refusal(() => mk(creator, { accountId: "acct-ven" })); // inherited owner e-ven (Ventana account owner) is outside the Taylor creator's authority
    assert.equal(e2.code, "OWNER_REQUIRED");
    const o = await mk(creator);
    const e3 = await refusal(() => reassign(creator, o.opportunityId, 1, "e-ven"));
    assert.equal(e3.code, "OWNER_NOT_FOUND");
    assert.equal(await ownerOf(o.opportunityId), "e-tay");
    assert.equal(await sees(ven, o.opportunityId), false);
  });

  await t.test("(d) after assignment: a foreign owner still cannot gain reach to the record", async () => {
    const o = await mk(creator);
    await assign(tay, o.opportunityId, "taylor");
    const editVersion = (await q(`SELECT edit_version AS v FROM eos_commercial.opportunities WHERE id = $1`, [o.opportunityId])).rows[0].v;
    const verdict = await reassign(creator, o.opportunityId, Number(editVersion), "e-ven").then(() => "SET", (e) => e.code);
    const reach = await sees(ven, o.opportunityId);
    // Record whichever mechanism holds; the invariant is that Ventana's Employee never reaches the Taylor-keyed record.
    assert.equal(reach, false, `foreign owner reach after assignment (reassign verdict ${verdict})`);
    console.log(`R2I_INTERACTION_D reassignAfterAssignVerdict=${verdict} ownerNow=${await ownerOf(o.opportunityId)} ventanaSees=${reach}`);
  });
});
