// Q-1a (Owner ruling Q1-11) against a real postgres:16 -- OPERATING-COMPANY AUTHORITY on Commercial reads, writes, approvals and lists.
//
//   capability  ->  company authority  ->  channel / ownership reach.
//
// A record of a company the caller does not reach is NONEXISTENT to it (the SAME code, category and words as a missing id; never "forbidden"), and a refusal
// leaves no trace: no receipt, no audit row, no number consumed, no row touched. A company-less Opportunity or Agreement is visible only to its owner or
// creator, the protected Administrator and the protected Owner. The protected Administrator's reach is UNCHANGED (proved by a before/after diff against the
// tenant-wide reach Commercial had before this lane). National accounts are a channel, never a company. The shared Sales Order visibility decision also hides
// an order from Sales Order allocation.
//
// NOTHING here injects the company seam except the explicit "before" half of the Administrator diff: every other call is the governed resolver.
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
import { ALL_COMPANIES } from "./support/commercialCompanyReachFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const opp = require("../lib/eosCommercial/commands/opportunityCommandService.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const so = require("../lib/eosCommercial/commands/salesOrderCommandService.js");
const oppRead = require("../lib/eosCommercial/reads/opportunityReadProjection.js");
const saRead = require("../lib/eosCommercial/reads/salesAgreementReadProjection.js");
const soRead = require("../lib/eosCommercial/reads/salesOrderReadProjection.js");
const { getAccountCommercialProjection } = require("../lib/eosCommercial/reads/accountCommercialProjection.js");
const authority = require("../lib/eosCommercial/commercialCompanyAuthority.js");
const alloc = require("../lib/eosOps/salesOrderAllocation.js");

const DB_NAME = `q1a_company_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const T = "t1";
const WRITE = ["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"];
const READ = ["opportunity.read", "salesAgreement.read", "salesOrder.read"];
const ALL = new Set([...WRITE, ...READ]);
const key = () => `k-${randomUUID()}`;
const catalog = { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } };
const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } return assert.fail("expected a refusal"); };
const words = (e) => [e.code, e.category, e.message];

test("Q-1a: operating-company authority on Commercial, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  // THE GOVERNED RESOLVER: no `companyReach` seam anywhere below, except the labelled "before" half of the Administrator diff.
  const wdeps = { pool, catalog };
  const rdeps = { pool };
  const before = { pool, catalog, companyReach: ALL_COMPANIES };

  // ── the world: Taylor and Ventana (keys deliberately different from ids), two channels, people ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  for (const channel of ["NATIONAL_ACCOUNTS", "RETAIL", "STRATEGIC_ACCOUNTS"]) {
    await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ('t1', $1, 'ACTIVE', 'fixture', 'fixture', 'fixture')`, [channel]);
  }
  await bindOperatingCompany(q, T, "taylor", "taylor-ops-t1");
  await bindOperatingCompany(q, T, "ventana", "ventana-ops-t1");
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-tay','t1','Taylor Customer','ACTIVE','e-tay','x','x'), ('acct-ven','t1','Ventana Customer','ACTIVE','e-ven','x','x'), ('acct-null','t1','Unplaced Customer','ACTIVE','e-tay','x','x')`);
  const employees = [["e-tay", "taylor"], ["e-ven", "ventana"], ["e-dual", "taylor"], ["e-own", "taylor"], ["e-creator", "taylor"], ["e-other", "taylor"]];
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
  const tay = await principal("p-tay", "e-tay");
  const ven = await principal("p-ven", "e-ven", "ventana");
  const dual = await principal("p-dual", "e-dual");           // Taylor home + an explicit company-access grant for Ventana
  const own = await principal("p-own", "e-own");              // the protected Owner (home Taylor)
  const creator = await principal("p-creator", "e-creator");  // creates company-less records; owns none of them
  const other = await principal("p-other", "e-other");        // Taylor, unrelated to the company-less records
  const none = await principal("p-none");                     // no Employee link: no company authority, and no claim on a company-less record
  const admin = await principal("p-admin");                   // the protected Administrator: no Employee, no company assignment
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
  const actor = (principalId, caps = ALL, scopedHeld = undefined) => ({ tenantId: T, principalId, capabilities: caps, ...(scopedHeld ? { scopedHeld } : {}) });
  const OWNER_CAPS = new Set([...ALL, "salesAgreement.tradeIn.approve"]);

  // ── the records: one chain per company, a National Accounts Taylor Opportunity, and two company-less ones ──
  const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const oppIn = (who, over) => opp.createOpportunity(wdeps, who, defined({
    idempotencyKey: key(), accountId: "acct-tay", salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "Reach-in",
    lines: [{ kind: "SERVICE", ref: "svc", qty: 1 }], ...over }));
  const agreementIn = (who, opportunityId, over = {}) => sa.createSalesAgreement(wdeps, who, {
    idempotencyKey: key(), opportunityId, ownerEmployeeId: "e-tay", isLease: false, fulfillmentIntent: "INSTALL",
    lines: [{ kind: "SERVICE", ref: "svc-install", quantity: 1, unitPrice: 50000, businessUnitId: "INSTALLATION" }], shippingMinor: 100, taxMinor: 50, ...over });
  const orderIn = (who, over) => so.createSalesOrder(wdeps, who, {
    idempotencyKey: key(), accountId: "acct-tay", ownerEmployeeId: "e-tay", operatingCompanyId: "taylor", salesChannel: "RETAIL",
    lines: [{ kind: "PART", ref: "part-b", orderedQty: 3, unitPrice: 2500 }], ...over });
  const oT = await oppIn(actor(tay));
  const oV = await oppIn(actor(ven), { accountId: "acct-ven", operatingCompanyId: "ventana" });
  const oTN = await oppIn(actor(tay), { salesChannel: "NATIONAL_ACCOUNTS" });
  const aT = await agreementIn(actor(tay), oT.opportunityId);
  const oT2 = await oppIn(actor(tay));
  const aT2 = await agreementIn(actor(tay), oT2.opportunityId, { tradeIns: [{ description: "Used reach-in", proposedValueMinor: 4000 }] });
  const aV = await agreementIn(actor(ven), oV.opportunityId, { ownerEmployeeId: "e-ven", tradeIns: [{ description: "Used unit", proposedValueMinor: 5000 }] });
  const sT = await orderIn(actor(tay));
  const sV = await orderIn(actor(ven), { accountId: "acct-ven", ownerEmployeeId: "e-ven", operatingCompanyId: "ventana" });
  const oN = await oppIn(actor(creator), { accountId: "acct-null", operatingCompanyId: undefined, need: "Company not yet chosen" });
  const aN = await agreementIn(actor(creator), oN.opportunityId);
  const row = async (table, id, cols = "operating_company_key, owner_employee_id, created_by") => (await q(`SELECT ${cols} FROM eos_commercial.${table} WHERE id = $1`, [id])).rows[0];

  await t.test("the world is what the proofs below assume (keys are not ids; company-less records carry a creator and an owner)", async () => {
    assert.deepEqual(await row("opportunities", oT.opportunityId), { operating_company_key: "taylor-ops-t1", owner_employee_id: "e-tay", created_by: tay });
    assert.deepEqual(await row("opportunities", oV.opportunityId), { operating_company_key: "ventana-ops-t1", owner_employee_id: "e-ven", created_by: ven });
    assert.deepEqual(await row("opportunities", oN.opportunityId), { operating_company_key: null, owner_employee_id: "e-tay", created_by: creator });
    assert.deepEqual(await row("sales_agreements", aN.salesAgreementId), { operating_company_key: null, owner_employee_id: "e-tay", created_by: creator });
    assert.equal((await row("sales_orders", sV.salesOrderId)).operating_company_key, "ventana-ops-t1");
  });

  await t.test("the resolver: own companies, an explicit grant, the protected Owner and Administrator, an identity gap", async () => {
    const reach = (p) => authority.resolveCommercialCompanyReach(pool, T, p);
    const r = { tay: await reach(tay), ven: await reach(ven), dual: await reach(dual), own: await reach(own), admin: await reach(admin), none: await reach(none) };
    assert.deepEqual([r.tay.basis, [...r.tay.companyKeys], r.tay.protectedOwner], ["OWN", ["taylor-ops-t1"], false]);
    assert.deepEqual([r.ven.basis, [...r.ven.companyKeys]], ["OWN", ["ventana-ops-t1"]]);
    assert.deepEqual([...r.dual.companyKeys].sort(), ["taylor-ops-t1", "ventana-ops-t1"], "an explicit company-access grant is reach");
    assert.deepEqual([r.own.basis, [...r.own.companyKeys], r.own.protectedOwner], ["OWN", ["taylor-ops-t1"], true], "the protected Owner follows OWN for company-keyed records and sees company-less ones");
    assert.deepEqual([r.admin.basis, [...r.admin.companyKeys]], ["PROTECTED_ADMINISTRATOR", []], "the protected Administrator is unrestricted, not a list");
    assert.deepEqual([r.none.basis, [...r.none.companyKeys]], ["NONE", []], "no Employee link: no authority");
  });

  // ════════════════════ READS ════════════════════
  await t.test("(a) a foreign-company record READS AS NONEXISTENT: detail, list and the Account projection, with the words of a missing id", async () => {
    const taylor = actor(tay);
    for (const [read, family, foreign, idField] of [
      [oppRead.getOpportunityDetail, "Opportunity", oV.opportunityId, "opportunityId"],
      [saRead.getSalesAgreementDetail, "Sales Agreement", aV.salesAgreementId, "salesAgreementId"],
      [soRead.getSalesOrderDetail, "Sales Order", sV.salesOrderId, "salesOrderId"],
    ]) {
      const foreignErr = await refusal(() => read(rdeps, taylor, { [idField]: foreign }));
      const missingErr = await refusal(() => read(rdeps, taylor, { [idField]: "does-not-exist" }));
      assert.deepEqual(words(foreignErr), ["RECORD_NOT_FOUND", "NOT_FOUND", `the ${family} does not exist in this tenant`], `${family}: nonexistent, never forbidden`);
      assert.deepEqual(words(foreignErr), words(missingErr), `${family}: indistinguishable from a missing id`);
    }
    const ids = (page) => page.items.map((i) => i.id).sort();
    assert.deepEqual(ids(await oppRead.listOpportunities(rdeps, taylor, {})), [oT.opportunityId, oT2.opportunityId, oTN.opportunityId, oN.opportunityId].sort(), "Taylor's own, plus the company-less one it OWNS; never Ventana's");
    assert.deepEqual(ids(await saRead.listSalesAgreements(rdeps, taylor, {})), [aT.salesAgreementId, aT2.salesAgreementId, aN.salesAgreementId].sort());
    assert.deepEqual(ids(await soRead.listSalesOrders(rdeps, taylor, {})), [sT.salesOrderId]);
    const account = await getAccountCommercialProjection(rdeps, taylor, { accountId: "acct-ven" });
    assert.deepEqual([account.opportunities.items.length, account.salesAgreements.items.length, account.salesOrders.items.length], [0, 0, 0], "the Account is shared; Ventana's records on it are not Taylor's to see");
    assert.deepEqual([account.opportunities.truncated, account.salesAgreements.truncated, account.salesOrders.truncated], [false, false, false]);
  });

  await t.test("(b) SAME-COMPANY reach is unchanged, and an explicit company-access grant reaches the second company", async () => {
    assert.equal((await oppRead.getOpportunityDetail(rdeps, actor(tay), { opportunityId: oT.opportunityId })).operatingCompanyId, "taylor");
    assert.equal((await saRead.getSalesAgreementDetail(rdeps, actor(ven), { salesAgreementId: aV.salesAgreementId })).operatingCompanyId, "ventana");
    assert.equal((await soRead.getSalesOrderDetail(rdeps, actor(ven), { salesOrderId: sV.salesOrderId })).id, sV.salesOrderId);
    const both = (await soRead.listSalesOrders(rdeps, actor(dual), {})).items.map((i) => i.id).sort();
    assert.deepEqual(both, [sT.salesOrderId, sV.salesOrderId].sort());
    assert.equal((await oppRead.getOpportunityDetail(rdeps, actor(dual), { opportunityId: oV.opportunityId })).id, oV.opportunityId);
  });

  await t.test("(c) CHANNEL narrowing still applies INSIDE company authority; National Accounts is a channel and crosses no company", async () => {
    const scoped = (principalId) => actor(principalId, new Set(), [{ capabilityKey: "opportunity.read", scopeType: "salesChannel", scopeValue: "RETAIL", sourceRole: "r", assignmentId: null, condition: null }]);
    const retailOnly = (await oppRead.listOpportunities(rdeps, scoped(tay), {})).items.map((i) => i.id).sort();
    assert.deepEqual(retailOnly, [oT.opportunityId, oT2.opportunityId, oN.opportunityId].sort(), "RETAIL only: the NATIONAL_ACCOUNTS Opportunity is outside the channel, the foreign RETAIL one outside the company");
    assert.equal((await refusal(() => oppRead.getOpportunityDetail(rdeps, scoped(tay), { opportunityId: oTN.opportunityId }))).code, "RECORD_NOT_FOUND");
    assert.equal((await refusal(() => oppRead.getOpportunityDetail(rdeps, scoped(tay), { opportunityId: oV.opportunityId }))).code, "RECORD_NOT_FOUND");
    // A Ventana seller holding the National Accounts channel globally still does not see Taylor's National Accounts record.
    assert.equal((await refusal(() => oppRead.getOpportunityDetail(rdeps, actor(ven), { opportunityId: oTN.opportunityId }))).code, "RECORD_NOT_FOUND");
    assert.ok((await oppRead.listOpportunities(rdeps, actor(ven), {})).items.every((i) => i.id !== oTN.opportunityId));
    // Channel-scoped WRITE: the company is decided before the channel (a foreign record is not found, whatever its channel).
    const scopedWrite = actor(ven, new Set(), [{ capabilityKey: "opportunity.write", scopeType: "salesChannel", scopeValue: "RETAIL", sourceRole: "r", assignmentId: null, condition: null }]);
    assert.equal((await refusal(() => opp.updateOpportunity(wdeps, scopedWrite, { idempotencyKey: key(), opportunityId: oTN.opportunityId, expectedEditVersion: 1, need: "x" }))).code, "RECORD_NOT_FOUND");
  });

  await t.test("(d) the lineage of a visible record never names a record of a company the reader does not reach", async () => {
    // A Taylor order whose source Agreement is (by a historical edit) Ventana's: Taylor reads the order, the Agreement reference is null.
    const linked = await orderIn(actor(tay));
    await q(`UPDATE eos_commercial.sales_orders SET sales_agreement_id = $2 WHERE id = $1`, [linked.salesOrderId, aV.salesAgreementId]);
    const detail = await soRead.getSalesOrderDetail(rdeps, actor(tay), { salesOrderId: linked.salesOrderId });
    assert.equal(detail.sourceAgreement, null);
    assert.equal((await soRead.getSalesOrderDetail(rdeps, actor(dual), { salesOrderId: linked.salesOrderId })).sourceAgreement?.id, aV.salesAgreementId, "a reader who reaches both sees the link");
    await q(`UPDATE eos_commercial.sales_orders SET sales_agreement_id = NULL WHERE id = $1`, [linked.salesOrderId]);
  });

  // ════════════════════ WRITES ════════════════════
  const trace = async () => JSON.stringify((await q(`SELECT
      (SELECT count(*) FROM eos_policy.audit_events WHERE tenant_id = 't1')::int AS audit,
      (SELECT count(*) FROM eos_commercial.command_receipts)::int AS receipts,
      (SELECT coalesce(sum(last_value), 0) FROM eos_commercial.number_counters)::int AS numbers,
      (SELECT count(*) FROM eos_commercial.opportunities)::int AS opps, (SELECT count(*) FROM eos_commercial.sales_agreements)::int AS agreements,
      (SELECT count(*) FROM eos_commercial.sales_orders)::int AS orders,
      (SELECT coalesce(sum(edit_version), 0) FROM eos_commercial.opportunities)::int AS versions,
      (SELECT string_agg(state::text, ',' ORDER BY id) FROM eos_commercial.sales_orders) AS order_states,
      (SELECT string_agg(state::text || coalesce(special_instructions, ''), ',' ORDER BY id) FROM eos_commercial.sales_agreements) AS agreement_states,
      (SELECT count(*) FROM eos_commercial.sales_order_service_providers)::int AS providers`)).rows[0]);

  await t.test("(e) a foreign-company WRITE or APPROVAL is refused as NOT FOUND before any mutation, with ZERO trace", async () => {
    const taylor = actor(tay);
    const ownerOfTaylor = actor(own, OWNER_CAPS);
    const attempts = [
      ["opportunity.update", (id) => opp.updateOpportunity(wdeps, taylor, { idempotencyKey: key(), opportunityId: id, expectedEditVersion: 1, need: "x" }), oV.opportunityId, "opp-missing"],
      ["opportunity.transition", (id) => opp.transitionOpportunity(wdeps, taylor, { idempotencyKey: key(), opportunityId: id, toStage: "QUALIFYING" }), oV.opportunityId, "opp-missing"],
      ["opportunity.closeAsWon", (id) => opp.closeOpportunityAsWon(wdeps, taylor, { idempotencyKey: key(), opportunityId: id, salesChannel: "RETAIL" }), oV.opportunityId, "opp-missing"],
      ["salesAgreement.create (on a foreign Opportunity)", (id) => sa.createSalesAgreement(wdeps, taylor, { idempotencyKey: key(), opportunityId: id, ownerEmployeeId: "e-tay" }), oV.opportunityId, "opp-missing"],
      ["salesAgreement.updateDraft (discount and terms)", (id) => sa.updateSalesAgreementDraft(wdeps, taylor, { idempotencyKey: key(), salesAgreementId: id, specialInstructions: "x" }), aV.salesAgreementId, "sag-missing"],
      ["salesAgreement.accept", (id) => sa.acceptSalesAgreement(wdeps, taylor, { idempotencyKey: key(), salesAgreementId: id }), aV.salesAgreementId, "sag-missing"],
      ["salesAgreement.approveTradeIn", (id) => sa.approveSalesAgreementTradeIn(wdeps, ownerOfTaylor, { idempotencyKey: key(), salesAgreementId: id, itemNumber: 1, approvedCreditMinor: 5000 }), aV.salesAgreementId, "sag-missing"],
      ["salesAgreement.declineTradeIn", (id) => sa.declineSalesAgreementTradeIn(wdeps, ownerOfTaylor, { idempotencyKey: key(), salesAgreementId: id, itemNumber: 1, reason: "no" }), aV.salesAgreementId, "sag-missing"],
      ["salesOrder.createFromOpportunity", (id) => so.createSalesOrderFromOpportunity(wdeps, taylor, { idempotencyKey: key(), opportunityId: id }), oV.opportunityId, "opp-missing"],
      ["salesOrder.transition", (id) => so.transitionSalesOrder(wdeps, taylor, { idempotencyKey: key(), salesOrderId: id, transition: "ADVANCE" }), sV.salesOrderId, "sor-missing"],
      ["salesOrder.authorizeServiceProvider", (id) => so.authorizeSalesOrderServiceProvider(wdeps, taylor, { idempotencyKey: key(), salesOrderId: id, serviceOperatingCompanyId: "taylor", scopes: ["SERVICE"], reason: "r" }), sV.salesOrderId, "sor-missing"],
      ["salesOrder.revokeServiceProvider", (id) => so.revokeSalesOrderServiceProvider(wdeps, taylor, { idempotencyKey: key(), salesOrderId: id, serviceOperatingCompanyId: "taylor", reason: "r" }), sV.salesOrderId, "sor-missing"],
    ];
    const snapshot = await trace();
    for (const [name, run, foreignId, missingId] of attempts) {
      const foreignErr = await refusal(() => run(foreignId));
      const missingErr = await refusal(() => run(missingId));
      assert.equal(foreignErr.code, "RECORD_NOT_FOUND", `${name}: nonexistent, never forbidden`);
      assert.deepEqual(foreignErr.category, "NOT_FOUND", name);
      assert.deepEqual(words(foreignErr).slice(0, 2), words(missingErr).slice(0, 2), `${name}: the same refusal as a missing id`);
      assert.equal(await trace(), snapshot, `${name}: no receipt, audit row, number or change`);
    }
    // A direct order from a foreign source Opportunity names it as missing too.
    const direct = await refusal(() => so.createSalesOrder(wdeps, taylor, { idempotencyKey: key(), accountId: "acct-ven", ownerEmployeeId: "e-tay", operatingCompanyId: "taylor", salesChannel: "RETAIL",
      sourceOpportunityId: oV.opportunityId, lines: [{ kind: "PART", ref: "part-b", orderedQty: 3, unitPrice: 2500 }] }));
    assert.equal(direct.code, "SOURCE_OPPORTUNITY_NOT_FOUND");
    assert.equal(await trace(), snapshot);
  });

  await t.test("(f) CREATING a record in a company the caller does not reach reads exactly like a company this tenant does not govern", async () => {
    const snapshot = await trace();
    const foreign = await refusal(() => oppIn(actor(tay), { operatingCompanyId: "ventana" }));
    const ungoverned = await refusal(() => oppIn(actor(tay), { operatingCompanyId: "nowhere" }));
    assert.deepEqual([foreign.code, foreign.category], ["OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED"]);
    assert.deepEqual([foreign.code, foreign.category], [ungoverned.code, ungoverned.category]);
    assert.equal((await refusal(() => orderIn(actor(tay), { operatingCompanyId: "ventana" }))).code, "OPERATING_COMPANY_NOT_GOVERNED");
    assert.equal(await trace(), snapshot, "nothing was booked, numbered or audited");
    // Reach through an explicit grant books to the second company; the Administrator books to either.
    assert.equal((await oppIn(actor(dual), { operatingCompanyId: "ventana" })).replayed, false);
    assert.equal((await oppIn(actor(admin), { operatingCompanyId: "ventana" })).replayed, false);
  });

  await t.test("(g) SAME-COMPANY writes are unchanged, and the audit still writes ONE row per applied command", async () => {
    const audit = async () => (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = 't1'`)).rows[0].n;
    const a0 = await audit();
    const updated = await opp.updateOpportunity(wdeps, actor(tay), { idempotencyKey: key(), opportunityId: oT.opportunityId, expectedEditVersion: 1, need: "Updated by a Taylor seller" });
    assert.equal(updated.editVersion, 2);
    assert.equal(await audit(), a0 + 1);
    const moved = await opp.transitionOpportunity(wdeps, actor(tay), { idempotencyKey: key(), opportunityId: oT.opportunityId, toStage: "QUALIFYING" });
    assert.equal(moved.stage, "QUALIFYING");
    assert.equal(await audit(), a0 + 2);
    const advanced = await so.transitionSalesOrder(wdeps, actor(ven), { idempotencyKey: key(), salesOrderId: sV.salesOrderId, transition: "ADVANCE" });
    assert.equal(advanced.state, "IN_FULFILLMENT");
    assert.equal(await audit(), a0 + 3);
    const idem = key();
    const first = await sa.updateSalesAgreementDraft(wdeps, actor(ven), { idempotencyKey: idem, salesAgreementId: aV.salesAgreementId, specialInstructions: "Dock access" });
    const replay = await sa.updateSalesAgreementDraft(wdeps, actor(ven), { idempotencyKey: idem, salesAgreementId: aV.salesAgreementId, specialInstructions: "Dock access" });
    assert.deepEqual([first.replayed, replay.replayed], [false, true]);
    assert.equal(await audit(), a0 + 4, "a replay writes nothing");
    // The reserved approver, inside its company, still decides the trade-in.
    const decided = await sa.approveSalesAgreementTradeIn(wdeps, actor(own, OWNER_CAPS), { idempotencyKey: key(), salesAgreementId: aT2.salesAgreementId, itemNumber: 1, approvedCreditMinor: 4000 });
    assert.equal(decided.approvalStatus, "APPROVED", "a Taylor Owner decides a Taylor Agreement's trade-in");
    assert.equal(await audit(), a0 + 5);
  });

  await t.test("(h) the PROTECTED OWNER's company-keyed reach is its OWN companies: a Ventana Agreement's trade-in is not found by a Taylor Owner", async () => {
    const e = await refusal(() => sa.approveSalesAgreementTradeIn(wdeps, actor(own, OWNER_CAPS), { idempotencyKey: key(), salesAgreementId: aV.salesAgreementId, itemNumber: 1, approvedCreditMinor: 5000 }));
    assert.equal(e.code, "RECORD_NOT_FOUND");
    const dec = await sa.approveSalesAgreementTradeIn(wdeps, actor(admin, OWNER_CAPS), { idempotencyKey: key(), salesAgreementId: aV.salesAgreementId, itemNumber: 1, approvedCreditMinor: 5000 })
      .catch((err) => err);
    assert.notEqual(dec.code, "RECORD_NOT_FOUND", "the Administrator reaches every company (the reserved-holder rule may still decide the approval itself)");
  });

  // ════════════════════ COMPANY-LESS RECORDS ════════════════════
  await t.test("(i) a company-less Opportunity or Agreement is visible ONLY to its owner or creator, the protected Administrator and the protected Owner", async () => {
    const canRead = async (who, read, field, id) => (await read(rdeps, actor(who), { [field]: id }).then(() => true, (e) => (e.code === "RECORD_NOT_FOUND" ? false : Promise.reject(e))));
    const matrix = {
      [tay]: true,       // the owner (e-tay is the record's owner)
      [creator]: true,   // the creator (created_by)
      [admin]: true,     // the protected Administrator
      [own]: true,       // the protected Owner
      [ven]: false, [dual]: false, [other]: false, [none]: false,
    };
    for (const [who, visible] of Object.entries(matrix)) {
      assert.equal(await canRead(who, oppRead.getOpportunityDetail, "opportunityId", oN.opportunityId), visible, `Opportunity ${who}`);
      assert.equal(await canRead(who, saRead.getSalesAgreementDetail, "salesAgreementId", aN.salesAgreementId), visible, `Agreement ${who}`);
      const listed = (await oppRead.listOpportunities(rdeps, actor(who), {})).items.some((i) => i.id === oN.opportunityId);
      assert.equal(listed, visible, `list ${who}`);
    }
    // Writes and approvals: an outsider's attempt is NOT FOUND with zero trace; the owner's and the creator's are applied.
    const snapshot = await trace();
    for (const outsider of [ven, other, none]) {
      const e = await refusal(() => opp.updateOpportunity(wdeps, actor(outsider), { idempotencyKey: key(), opportunityId: oN.opportunityId, expectedEditVersion: 1, need: "x" }));
      assert.equal(e.code, "RECORD_NOT_FOUND", outsider);
    }
    assert.equal(await trace(), snapshot);
    assert.equal((await opp.updateOpportunity(wdeps, actor(creator), { idempotencyKey: key(), opportunityId: oN.opportunityId, expectedEditVersion: 1, need: "By its creator" })).editVersion, 2);
    assert.equal((await opp.updateOpportunity(wdeps, actor(tay), { idempotencyKey: key(), opportunityId: oN.opportunityId, expectedEditVersion: 2, need: "By its owner" })).editVersion, 3);
    assert.equal((await opp.updateOpportunity(wdeps, actor(admin), { idempotencyKey: key(), opportunityId: oN.opportunityId, expectedEditVersion: 3, need: "By the Administrator" })).editVersion, 4);
  });

  await t.test("(j) SETTING a company brings the record under normal company authority: its creator and owner lose the special claim", async () => {
    await q(`UPDATE eos_commercial.opportunities SET operating_company_key = 'ventana-ops-t1' WHERE id = $1`, [oN.opportunityId]);
    const sees = async (who) => oppRead.getOpportunityDetail(rdeps, actor(who), { opportunityId: oN.opportunityId }).then(() => true, (e) => (e.code === "RECORD_NOT_FOUND" ? false : Promise.reject(e)));
    assert.deepEqual([await sees(ven), await sees(dual), await sees(admin)], [true, true, true], "Ventana's people and the Administrator");
    assert.deepEqual([await sees(creator), await sees(tay), await sees(other), await sees(none)], [false, false, false, false], "the creator and owner are Taylor's: company authority now decides");
    await q(`UPDATE eos_commercial.opportunities SET operating_company_key = NULL WHERE id = $1`, [oN.opportunityId]);
  });

  // ════════════════════ THE PROTECTED ADMINISTRATOR: BEFORE / AFTER ════════════════════
  await t.test("(k) the protected Administrator's reach is IDENTICAL before and after: every read, including a company-less record and a record of an ungoverned company", async () => {
    // A historical record booked to a company key this tenant no longer governs: tenant-wide Commercial reached it before; the Administrator still does.
    const legacy = await oppIn(actor(admin), { operatingCompanyId: "taylor", need: "Historical" });
    await q(`UPDATE eos_commercial.opportunities SET operating_company_key = 'legacy-ops-key' WHERE id = $1`, [legacy.opportunityId]);
    const A = actor(admin);
    const battery = async (deps) => JSON.stringify([
      await oppRead.listOpportunities(deps, A, {}), await saRead.listSalesAgreements(deps, A, {}), await soRead.listSalesOrders(deps, A, {}),
      await oppRead.getOpportunityDetail(deps, A, { opportunityId: oV.opportunityId }), await oppRead.getOpportunityDetail(deps, A, { opportunityId: oN.opportunityId }),
      await oppRead.getOpportunityDetail(deps, A, { opportunityId: legacy.opportunityId }), await oppRead.getOpportunityDetail(deps, A, { opportunityId: oTN.opportunityId }),
      await saRead.getSalesAgreementDetail(deps, A, { salesAgreementId: aV.salesAgreementId }), await saRead.getSalesAgreementDetail(deps, A, { salesAgreementId: aN.salesAgreementId }),
      await soRead.getSalesOrderDetail(deps, A, { salesOrderId: sV.salesOrderId }), await soRead.getSalesOrderDetail(deps, A, { salesOrderId: sT.salesOrderId }),
      await getAccountCommercialProjection(deps, A, { accountId: "acct-ven" }), await getAccountCommercialProjection(deps, A, { accountId: "acct-tay" }),
    ]);
    const was = await battery({ pool, companyReach: ALL_COMPANIES });   // BEFORE: tenant-wide, no company predicate at all
    const now = await battery({ pool });                                 // AFTER: the governed resolver
    assert.equal(now, was, "the Administrator's read reach is byte-identical");
    assert.ok(now.includes(oN.opportunityId) && now.includes(legacy.opportunityId) && now.includes(sV.salesOrderId), "and it really spans the company-less, the historical and the other company");

    // WRITES: the same command on a Taylor, a Ventana and a company-less sibling, once under each mode: the same outcomes.
    const outcome = async (deps, id, n) => opp.updateOpportunity({ ...deps, catalog }, A, { idempotencyKey: key(), opportunityId: id, expectedEditVersion: n, need: `by admin ${n}` })
      .then((r) => ({ ok: true, keys: Object.keys(r).sort().join(","), version: r.editVersion }), (e) => ({ ok: false, code: e.code }));
    const ids = [oT.opportunityId, oV.opportunityId, oN.opportunityId, legacy.opportunityId];
    const versionOf = async (id) => (await q(`SELECT edit_version FROM eos_commercial.opportunities WHERE id = $1`, [id])).rows[0].edit_version;
    const beforeOut = []; const afterOut = [];
    for (const id of ids) {
      const v1 = await versionOf(id);
      beforeOut.push({ ...(await outcome({ pool, companyReach: ALL_COMPANIES }, id, v1)), version: undefined });
      const v2 = await versionOf(id);
      afterOut.push({ ...(await outcome({ pool }, id, v2)), version: undefined });
    }
    assert.deepEqual(afterOut, beforeOut, "the Administrator's write reach is identical");
    assert.ok(afterOut.every((o) => o.ok === true), "and every one was applied");
    const refusalOf = async (deps) => (await refusal(() => opp.transitionOpportunity({ ...deps, catalog }, A, { idempotencyKey: key(), opportunityId: "opp-missing", toStage: "QUALIFYING" }))).code;
    assert.equal(await refusalOf({ pool }), await refusalOf({ pool, companyReach: ALL_COMPANIES }));
    // A non-protected admin-role holder has no standing: it is an ordinary caller (no company, no claim).
    await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
             VALUES ('a-admin-scoped','t1',$1,'role-admin','operatingCompany','taylor','active','fixture',0,'fixture','fixture')`, [other]);
    assert.equal((await authority.resolveCommercialCompanyReach(pool, T, other)).basis, "OWN", "a company-scoped admin assignment is not the protected Administrator's standing");
  });

  // ════════════════════ SALES ORDER ALLOCATION ════════════════════
  await t.test("(l) the SHARED Sales Order decision: a Q-1a denial hides the order from allocation too (allocate, release and read)", async () => {
    const A = { tenantId: T, principalId: tay, capabilities: new Set(["salesOrder.fulfill", "salesOrder.read"]) };
    // The shared helper, with the real resolver: a Taylor caller sees a Taylor order and not a Ventana one; the Administrator sees both.
    assert.equal(await authority.callerMaySeeSalesOrder(pool, A, sT.salesOrderId, ["salesOrder.fulfill"]), true);
    assert.equal(await authority.callerMaySeeSalesOrder(pool, A, sV.salesOrderId, ["salesOrder.fulfill"]), false);
    assert.equal(await authority.callerMaySeeSalesOrder(pool, { ...A, principalId: admin }, sV.salesOrderId, ["salesOrder.fulfill"]), true);
    assert.equal(await authority.callerMaySeeSalesOrder(pool, A, "sor-missing", ["salesOrder.fulfill"]), false);
    // A denying resolver stands in for "Commercial hides this order from the caller" -- allocation, with every inventory check satisfied, reads it as missing.
    const deny = async () => authority.commercialCompanyReachOf({ unrestricted: false, protectedOwner: false, companyKeys: [], employeeIds: [], creatorId: null });
    const req = { salesOrderId: sT.salesOrderId, lineNumber: 1, operatingCompanyId: "taylor", warehouseId: "wh-none", idempotencyKey: key() };
    const allocated = await refusal(() => alloc.allocateSalesOrderLine({ pool, companyReach: deny }, A, { ...req, partId: "part-b", quantity: 1 }));
    assert.deepEqual([allocated.code, allocated.category], ["SALES_ORDER_NOT_FOUND", "NOT_FOUND"]);
    const released = await refusal(() => alloc.releaseSalesOrderAllocation({ pool, companyReach: deny }, A, { ...req, reason: "r" }));
    assert.equal(released.code, "SALES_ORDER_NOT_FOUND");
    const read = await refusal(() => alloc.readSalesOrderAllocations({ pool, companyReach: deny }, A, { salesOrderId: sT.salesOrderId }));
    assert.equal(read.code, "SALES_ORDER_NOT_FOUND");
    // Without the denial the same caller passes the order check (and is stopped, if at all, by a LATER inventory rule -- never NOT_FOUND).
    const open = await refusal(() => alloc.allocateSalesOrderLine({ pool }, A, { ...req, partId: "part-b", quantity: 1 }));
    assert.notEqual(open.code, "SALES_ORDER_NOT_FOUND");
  });
});
