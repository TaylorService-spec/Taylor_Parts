// Q-1a, the Commercial surfaces OUTSIDE the Commercial transport's own record reads (security review of #2194), against a real postgres:16.
//
// The same reach (resolveCommercialCompanyReach + reach.sql) and the same "nonexistent" semantics, applied to:
//   H-1  site-wide search (searchEos: Opportunity / Sales Agreement / Sales Order) -- foreign records, and a foreign Opportunity's TEXT, are never found
//   L-2  My Work "records I own / am accountable for"
//   H-2  listRecordsOwnedByEmployee / listAccountabilitiesForEmployee (the Workforce transport)
//   M-1  listCoordinatedOperations: a foreign Sales Order's number and line refs are absent (Work Order scoping itself stays with Dispatch)
//   L-1  CRM activity: an opportunityId / salesOrderId link probe answers a foreign id exactly like an unknown one
//   M-3  an Agreement's explicit operating company must agree with its parent Opportunity's
// Nothing here injects the company seam: the governed resolver decides everywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-q1ab";
const WS = "/operations/workspace";

test("Q-1a breadth: search, My Work, record ownership, coordinated visits, CRM activity links, Agreement lineage", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, call, pool, repo } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "q1ab" });
  const workforce = require("../lib/eosWorkforce/workforceHttp.js");
  const coordinated = require("../lib/eosOps/coordinatedVisitPostgresRead.js");
  const crmActivity = require("../lib/eosCrm/crmActivityAuthority.js");
  const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 500)}`); return r.body.result; };
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } return assert.fail("expected a refusal"); };

  // ── people: a Taylor reader, a Ventana reader, a reader with no Employee, and the bootstrapped protected Administrator ──
  assert.equal((await admin("createRole", { key: "q1abReader", name: "Q1a Reader", reason: "fixture" })).ok, true);
  for (const objectKey of ["opportunity", "salesAgreement", "salesOrder"]) {
    const g = await admin("grantObjectActionToRole", { roleKey: "q1abReader", objectKey, actionKey: "read", reason: "fixture" });
    assert.equal(g.ok, true, `${objectKey} ${JSON.stringify(g).slice(0, 200)}`);
  }
  const tay = await person("uid-q1ab-tay", ["q1abReader"], { id: "e-tay", name: "Tess Taylor", company: "taylor" });
  const ven = await person("uid-q1ab-ven", ["q1abReader"], { id: "e-ven", name: "Vic Ventana", company: "ventana" });
  const none = await person("uid-q1ab-none", ["q1abReader"], null);
  const adminP = { subject: "uid-q1ab-admin", principalId: (await q(`SELECT id FROM eos_policy.principals WHERE external_subject = 'uid-q1ab-admin'`)).rows[0].id };

  // ── records: every one OWNED and ACCOUNTABLE by e-tay (so the ownership lists would name them all), in each company, plus company-less ones ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-1',$1,'Harbor Grill','ACTIVE','f','f')`, [T]);
  const opp = (id, number, company, need, createdBy = "p-other") => q(
    `INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, sales_channel, stage, need, created_by, updated_by)
     VALUES ($1,$2,$3,'acct-1','e-tay','e-tay',$4,'RETAIL','IDENTIFIED',$5,$6,$6)`, [id, T, number, company, need, createdBy]);
  await opp("opp-t", "OPP-2026-Q1A001", "taylor", "ALPHA reach-in for Taylor");
  await opp("opp-v", "OPP-2026-Q1A002", "ventana", "ALPHA SECRET reach-in for Ventana");
  await opp("opp-n", "OPP-2026-Q1A003", null, "ALPHA company not chosen yet");
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-nobody',$1,'ACTIVE','taylor') ON CONFLICT DO NOTHING`, [T]);
  await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, sales_channel, stage, need, created_by, updated_by)
           VALUES ('opp-n2',$1,'OPP-2026-Q1A004','acct-1','e-nobody','e-tay',NULL,'RETAIL','IDENTIFIED','ALPHA someone else''s unplaced deal','p-other','p-other')`, [T]);
  const agreement = (id, number, company, opportunityId) => q(
    `INSERT INTO eos_commercial.sales_agreements (id, tenant_id, sales_agreement_number, account_id, opportunity_id, owner_employee_id, accountable_employee_id, operating_company_key, state, currency, created_by, updated_by)
     VALUES ($1,$2,$3,'acct-1',$4,'e-tay','e-tay',$5,'DRAFT','USD','p-other','p-other')`, [id, T, number, opportunityId, company]);
  await agreement("sag-t", "SAG-2026-Q1A001", "taylor", "opp-t");
  await agreement("sag-v", "SAG-2026-Q1A002", "ventana", "opp-v");
  const order = (id, number, company) => q(
    `INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, sales_channel, currency, state, booked_at, created_by, updated_by)
     VALUES ($1,$2,$3,'acct-1','e-tay','e-tay',$4,'RETAIL','USD','CONFIRMED',now(),'p-other','p-other')`, [id, T, number, company]);
  await order("so-t", "SO-2026-Q1A001", "taylor");
  await order("so-v", "SO-2026-Q1A002", "ventana");
  for (const so of ["so-t", "so-v"]) {
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty) VALUES ($1,$2,1,'PART','PART-A','PARTS',2)`, [T, so]);
  }
  const ALL = ["opp-t", "opp-v", "opp-n", "opp-n2", "sag-t", "sag-v", "so-t", "so-v"];
  const search = async (who, text) => ok(await call(who, WS, "searchEos", { query: text }), "search").results.filter((r) => ALL.includes(r.id)).map((r) => r.id).sort();

  await t.test("H-1 site-wide search finds only the records of companies the caller reaches, and never matches a foreign Opportunity's text", async () => {
    // By number: the same prefix on every record.
    assert.deepEqual(await search(tay, "Q1A"), ["opp-n", "opp-t", "sag-t", "so-t"].sort(), "Taylor: its own, plus the company-less one it OWNS; not Ventana's, not another person's company-less one");
    assert.deepEqual(await search(ven, "Q1A"), ["opp-v", "sag-v", "so-v"].sort());
    assert.deepEqual(await search(none, "Q1A"), [], "no Employee link: no company, no claim");
    assert.deepEqual(await search(adminP, "Q1A"), ALL.slice().sort(), "the protected Administrator reaches everything, unchanged");
    // By text: o.need ILIKE is the leak -- a Taylor reader searching the words of a Ventana Opportunity finds nothing, and a Ventana reader does.
    assert.deepEqual(await search(tay, "SECRET"), []);
    assert.deepEqual(await search(ven, "SECRET"), ["opp-v"]);
    assert.deepEqual(await search(tay, "someone else"), [], "another person's company-less Opportunity text is not searchable");
  });

  await t.test("L-2 My Work 'records I own' lists only the records of the caller's companies", async () => {
    // e-tay OWNS every record. Taylor's reader sees the Taylor ones and the company-less one it owns; it never sees Ventana's or the other person's.
    const ids = (w) => w.sections.find((s) => s.key === "ownedRecords").items.map((i) => i.id).sort();
    const mine = ids(ok(await call(tay, WS, "readMyWork", {}), "my work"));
    assert.ok(["opp-t", "sag-t", "so-t"].every((id) => mine.includes(id)), JSON.stringify(mine));
    assert.ok(!mine.some((id) => ["opp-v", "sag-v", "so-v", "opp-n2"].includes(id)), `a foreign or someone else's record appeared: ${JSON.stringify(mine)}`);
    // A reader whose Employee owns nothing sees nothing (and a Ventana reader never sees the Taylor-owned ones).
    assert.deepEqual(ids(ok(await call(ven, WS, "readMyWork", {}), "my work ven")), []);
  });

  await t.test("H-2 record ownership and accountability lists are bounded by company authority; a caller reaching nothing gets an empty page", async () => {
    // Through the Workforce transport, as served: the real principals, roles and entitlements.
    const ids = async (operation, who, family) => {
      const r = await workforce.executeWorkforceOperation({ reader: repo, pool }, { caller: { externalSubject: who.subject, identityProvider: "firebase", requestedTenantId: null }, operation, input: { employeeId: "e-tay", family } });
      assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
      return r.result.items.map((i) => i.recordId).sort();
    };
    const owned = "listRecordsOwnedByEmployee";
    const accountable = "listAccountabilitiesForEmployee";
    for (const fn of [owned, accountable]) {
      // opp-n2 is accountable to e-tay but owned by another Employee and created by another Principal: Taylor's reader has no claim on it.
      assert.deepEqual(await ids(fn, tay, "OPPORTUNITY"), ["opp-n", "opp-t"], "Taylor's, and the company-less one it owns");
      assert.deepEqual(await ids(fn, ven, "OPPORTUNITY"), ["opp-v"]);
      assert.deepEqual(await ids(fn, none, "OPPORTUNITY"), [], "an empty page, not a refusal that reveals the family has rows");
      assert.deepEqual(await ids(fn, adminP, "OPPORTUNITY"), fn === owned ? ["opp-n", "opp-t", "opp-v"] : ["opp-n", "opp-n2", "opp-t", "opp-v"], "the protected Administrator is unchanged");
      assert.deepEqual(await ids(fn, tay, "SALES_ORDER"), ["so-t"]);
      assert.deepEqual(await ids(fn, tay, "SALES_AGREEMENT"), ["sag-t"]);
    }
  });

  await t.test("M-1 coordinated visits: a foreign Sales Order's number and line refs are absent; the caller's own are carried", async () => {
    const status = coordinated.ACTIVE_COORDINATION_STATUSES[0];
    for (const [wo, so] of [["wo-t", "so-t"], ["wo-v", "so-v"]]) {
      await q(`INSERT INTO eos_crm.account_locations (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('loc-1',$1,'acct-1','Downtown','f','f') ON CONFLICT DO NOTHING`, [T]);
      await q(`INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id, sales_order_id, provenance, created_at, updated_at)
               VALUES ($1,$2,'taylor',$3,$4,'SERVICE_CALL',3,'acct-1','loc-1',$5,'MIGRATED', now(), now())`, [wo, T, `WO-2026-90000${wo === "wo-t" ? 1 : 2}`, status, so]);
      await q(`INSERT INTO eos_ops.work_order_sales_order_lines (tenant_id, work_order_id, sales_order_id, sales_order_line_id) VALUES ($1,$2,$3,'1')`, [T, wo, so]);
    }
    const read = (who) => coordinated.readCoordinatedOperations({ pool }, { tenantId: T, principalId: who, capabilities: new Set([coordinated.COORDINATED_VISIT_CAPABILITY.key]) });
    const mine = await read(tay.principalId);
    assert.deepEqual(mine.salesOrderReferences, { "so-t": "SO-2026-Q1A001" }, "no number for the Ventana order");
    const lines = (r, wo) => r.workOrders.find((w) => w.id === wo).salesOrderLineRefs.map((l) => l.ref);
    assert.deepEqual([lines(mine, "wo-t"), lines(mine, "wo-v")], [["PART-A"], []], "no line refs of the Ventana order");
    const all = await read(adminP.principalId);
    assert.deepEqual(all.salesOrderReferences, { "so-t": "SO-2026-Q1A001", "so-v": "SO-2026-Q1A002" }, "the protected Administrator is unchanged");
    assert.deepEqual([lines(all, "wo-t"), lines(all, "wo-v")], [["PART-A"], ["PART-A"]]);
    assert.deepEqual((await read(none.principalId)).salesOrderReferences, {});
  });

  await t.test("L-1 a CRM activity link to a foreign Opportunity or Sales Order is refused exactly like an unknown id", async () => {
    const actor = (principalId) => ({ tenantId: T, principalId, capabilities: new Set(["crm.activity.create", "customer.record.read"]) });
    const make = (who, over) => crmActivity.createAccountActivity({ pool }, actor(who), { accountId: "acct-1", type: "CALL", body: "x", idempotencyKey: `k-${randomUUID()}`, ...over });
    for (const [field, foreign, missing, code] of [["opportunityId", "opp-v", "opp-missing", "OPPORTUNITY_NOT_FOUND"], ["salesOrderId", "so-v", "so-missing", "SALES_ORDER_NOT_FOUND"]]) {
      const f = await refusal(() => make(tay.principalId, { [field]: foreign }));
      const m = await refusal(() => make(tay.principalId, { [field]: missing }));
      assert.deepEqual([f.code, f.category, f.message], [code, "NOT_FOUND", m.message]);
      assert.deepEqual([f.code, f.category], [m.code, m.category]);
    }
    assert.equal((await make(tay.principalId, { opportunityId: "opp-t", salesOrderId: "so-t" })).success, true, "its own company's records still link");
    assert.equal((await make(adminP.principalId, { opportunityId: "opp-v" })).success, true, "the protected Administrator is unchanged");
  });

  await t.test("M-3 an Agreement carries its source Opportunity's operating company: an explicit, different one is refused, with nothing written", async () => {
    // A fresh Taylor Opportunity with no Agreement (the one-Agreement-per-Opportunity rule would answer first on opp-t), owned by nobody who reads here.
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, accountable_employee_id, operating_company_key, sales_channel, stage, need, created_by, updated_by)
             VALUES ('opp-t2',$1,'OPP-2026-ZZZ9','acct-1','e-nobody','e-nobody','taylor','RETAIL','IDENTIFIED','lineage fixture','p-other','p-other')`, [T]);
    const before = (await q(`SELECT count(*)::int n FROM eos_commercial.sales_agreements`)).rows[0].n;
    const actor = { tenantId: T, principalId: adminP.principalId, capabilities: new Set(["salesAgreement.create"]) };
    const e = await refusal(() => sa.createSalesAgreement({ pool }, actor, { idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-t2", ownerEmployeeId: "e-tay", operatingCompanyId: "ventana" }));
    assert.deepEqual([e.code, e.category], ["OPERATING_COMPANY_MISMATCH", "PRECONDITION_FAILED"]);
    const noCompany = await refusal(() => sa.createSalesAgreement({ pool }, actor, { idempotencyKey: `k-${randomUUID()}`, opportunityId: "opp-n", ownerEmployeeId: "e-tay", operatingCompanyId: "taylor" }));
    assert.equal(noCompany.code, "OPERATING_COMPANY_MISMATCH", "a company-less Opportunity does not hand its child a company");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_commercial.sales_agreements`)).rows[0].n, before);
  });
});
