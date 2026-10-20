// FINANCE VISIBILITY -- the credited-person / team reach INSIDE the company boundary, against a real PostgreSQL (Firebase exit B1,
// DECISIONS #B1; Owner rulings F7c-3 / SALES FINANCE VISIBILITY, 2026-10-17; migration 1764620000000).
//
//   MIG    five keys registered, exactly the Firebase holders granted (15 rows); the Sales Order credit is immutable at the store.
//   INACT  AS DEPLOYED self / team are INACTIVE (D-249-0): a self/team-only holder reads NOTHING in every projection.
//   ACT    the ACTIVATED fixture: a salesperson reads only the receivables credited to it; a manager only its team's, by the
//          reporting line AS OF THE ORDER'S CREATION (historical credit); unattributable / unattributed rows are hidden from
//          restricted readers and VISIBLE to Finance; the company boundary stays the outer limit.
//   LEAK   every projection: lists, details, totals/summary, workspace, the overview aggregate, settlements, Analysis measures and
//          exceptions. An aggregate never includes a hidden row; hidden answers exactly like a nonexistent id.
//   CMD    a restricted reader is refused every settlement command.
//   (The offline half -- the pure table, the migration shape, no search source / export -- is financeVisibility.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { assignFinanceCompanies } from "./support/financeCompanyAccess.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const visibility = require("../lib/eosFinance/financeVisibility.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-fvis";
const FIN = "/operations/finance", AN = "/operations/analysis";

test("finance inner reach over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call, repo, http } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "fvis" });
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const sys = { tenantId: TENANT, principalId: "finance-system" };
  // The deployed server activates nothing; the ACTIVATED fixture injects the switch (D-249-0).
  const callAs = (active) => async (who, route, operation, input = {}) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE", financeSelfTeamVisibilityActive: active,
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const off = (who, op, input) => call(who, FIN, op, input);
  const on = (who, op, input) => callAs(true)(who, FIN, op, input);
  const idsOf = (res) => ok(res).items.map((i) => i.id).sort();

  // ── MIG ──
  await t.test("MIG: the five keys are registered and granted to exactly the Firebase holders; the Sales Order credit is immutable", async () => {
    const caps = (await q(`SELECT key, action_kind FROM eos_policy.capabilities WHERE key LIKE 'finance.visibility.%' ORDER BY key`)).rows;
    assert.deepEqual(caps.map((c) => c.key), ["finance.visibility.businessUnit", "finance.visibility.company", "finance.visibility.consolidated", "finance.visibility.self", "finance.visibility.team"]);
    const grants = (await q(`SELECT r.key AS role, c.key AS cap FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key LIKE 'finance.visibility.%' ORDER BY 1, 2`, [TENANT])).rows;
    const byRole = {};
    for (const g of grants) (byRole[g.role] ??= []).push(g.cap.replace("finance.visibility.", ""));
    assert.deepEqual(byRole, {
      accountingManager: ["consolidated"], admin: ["businessUnit", "company", "consolidated", "self", "team"], financeManager: ["consolidated"],
      generalManager: ["consolidated"], owner: ["businessUnit", "company", "consolidated", "self", "team"], salesManager: ["team"], salesperson: ["self"],
    });
    assert.equal(grants.length, 15);
  });

  // ── fixture ──
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const gm = await person("uid-gm", ["generalManager"], { id: "e-gm", name: "Gale GM" });
  const gs = await person("uid-gs", ["generalManager", "salesperson"], { id: "e-gs", name: "Gus Both" });
  const mx = await person("uid-mx", ["salesperson", "controller"], { id: "e-mx", name: "Max Mixed" });
  const s1 = await person("uid-s1", ["salesperson"], { id: "e-s1", name: "Sam Seller" });
  const s2 = await person("uid-s2", ["salesperson"], { id: "e-s2", name: "Sue Seller" });
  const s5 = await person("uid-s5", ["salesperson"], { id: "e-s5", name: "Stan Taylor-Only" });
  const m1 = await person("uid-m1", ["salesManager"], { id: "e-m1", name: "Mia Manager" });
  const m2 = await person("uid-m2", ["salesManager"], { id: "e-m2", name: "Max Other-Manager" });
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrl, gm, gs, mx, s1, s2, m1, m2]);
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [s5], ["taylor"]);
  for (const e of ["e-s3", "e-s4"]) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ($1,$2,'ACTIVE','taylor',$1)`, [e, TENANT]);
  }
  // Reporting lines. s1 reported to m1 until 2026-08-01 and to m2 after (the D-249-1 example); s3 -> s2 -> m1 (two levels); and a
  // CYCLE m1 -> s3 that the walk must survive. s4 has no line at all.
  await q(`INSERT INTO eos_workforce.employee_reporting_relationships (id,tenant_id,employee_id,manager_employee_id,effective_from,effective_to,established_by,ended_by,ended_at,source) VALUES
    ('rr1',$1,'e-s1','e-m1','2026-01-01T00:00:00Z','2026-08-01T00:00:00Z','f','f',now(),'GOVERNED_COMMAND'),
    ('rr2',$1,'e-s1','e-m2','2026-08-01T00:00:00Z',NULL,'f',NULL,NULL,'GOVERNED_COMMAND'),
    ('rr3',$1,'e-s3','e-s2','2026-01-01T00:00:00Z',NULL,'f',NULL,NULL,'GOVERNED_COMMAND'),
    ('rr4',$1,'e-s2','e-m1','2026-01-01T00:00:00Z',NULL,'f',NULL,NULL,'GOVERNED_COMMAND'),
    ('rr5',$1,'e-m1','e-s3','2026-01-01T00:00:00Z',NULL,'f',NULL,NULL,'GOVERNED_COMMAND')`, [TENANT]);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-t',$1,'Taylor Customer','ACTIVE','f','f'), ('acct-v',$1,'Ventana Customer','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-t','CUSTOMER'), ($1,'acct-v','CUSTOMER')`, [TENANT]);
  const cpT = (await fin.ensureExternalCounterparty(pool, sys, "acct-t")).id;
  const cpV = (await fin.ensureExternalCounterparty(pool, sys, "acct-v")).id;
  // Sales Orders: the AUTHORITATIVE credit, recorded at creation (2026-03-01).
  const order = async (id, company, credited) => q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key,
      sales_channel, currency, state, credited_salesperson_employee_id, created_by, updated_by, created_at) VALUES ($1,$2,upper($1),$3,'e-ctrl',$4,'RETAIL','USD','CONFIRMED',$5,'f','f','2026-03-01T00:00:00Z')`,
  [id, TENANT, company === "ventana" ? "acct-v" : "acct-t", company, credited]);
  await order("so-1", "taylor", "e-s1");
  await order("so-2", "taylor", "e-s2");
  await order("so-3", "taylor", null);
  await order("so-4", "ventana", "e-s1");
  await order("so-5", "taylor", "e-s3");
  await order("so-6", "taylor", "e-s4");
  await order("so-7", "taylor", "e-s1");
  await order("so-8", "ventana", "e-s5");
  const pkg = (id, so, company) => q(`INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, version, status, readiness_exceptions, operating_company_id,
      operating_company_key, commercial_customer_account_id, obligor_basis, commercial_disposition, currency, content_fingerprint, prepared_by)
    VALUES ($1,$2,'SALES_ORDER',$3,1,'HELD',ARRAY['FIXTURE'],$4,$4,'acct-t','UNRESOLVED','SALE','USD',$1,'f')`, [id, TENANT, so, company]);
  await pkg("bp-1", "so-1", "taylor"); await pkg("bp-2", "so-2", "taylor"); await pkg("bp-3", "so-3", "taylor"); await pkg("bp-4", "so-4", "ventana");
  await pkg("bp-5", "so-5", "taylor"); await pkg("bp-6", "so-6", "taylor");
  await pkg("bp-7", "so-7", "ventana"); // a package whose company DIFFERS from its obligation's (taylor): not attributable
  await pkg("bp-10", "so-8", "ventana");
  await q(`INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, rental_charge_id, rental_agreement_id, version, status, readiness_exceptions,
      operating_company_id, operating_company_key, commercial_customer_account_id, obligor_basis, commercial_disposition, currency, content_fingerprint, prepared_by)
    VALUES ('bp-8',$1,'RENTAL_CHARGE',NULL,'rc-1','ra-1',1,'HELD',ARRAY['FIXTURE'],'taylor','taylor','acct-t','RENTAL_CUSTOMER','RENTAL','USD','bp-8','f')`, [TENANT]);
  const obl = (n, company, cp, source, sourceId, amount, dueOn = null) => fin.openObligation(pool, sys, { operatingCompanyId: company, counterpartyId: cp, kind: "RECEIVABLE",
    currency: "USD", sourceDomain: source, sourceRecordId: sourceId, originationAmountMinor: amount, basis: "FIXTURE", effectiveAt: new Date(), idempotencyKey: `obl-${n}`, dueOn })
    .then((r) => r.obligationId);
  const o1 = await obl("1", "taylor", cpT, "BILLING_PACKAGE", "bp-1", 40000, "2026-01-15");   // credited e-s1 (overdue)
  const o2 = await obl("2", "taylor", cpT, "BILLING_PACKAGE", "bp-2", 25000);                 // credited e-s2
  const o3 = await obl("3", "taylor", cpT, "BILLING_PACKAGE", "bp-3", 7000);                  // the Order records NO credit
  const o4 = await obl("4", "ventana", cpV, "BILLING_PACKAGE", "bp-4", 11000);                // credited e-s1, Ventana
  const o5 = await obl("5", "taylor", cpT, "BILLING_PACKAGE", "bp-5", 5000);                  // credited e-s3 (s3 -> s2 -> m1)
  const o6 = await obl("6", "taylor", cpT, "BILLING_PACKAGE", "bp-6", 3000);                  // credited e-s4 (no reporting line)
  const o7 = await obl("7", "taylor", cpT, "BILLING_PACKAGE", "bp-7", 9000);                  // package company differs
  const o8 = await obl("8", "taylor", cpT, "BILLING_PACKAGE", "bp-8", 4000);                  // a rental charge package
  const o9 = await obl("9", "taylor", cpT, "FIXTURE", "no-package", 2000);                    // no billing package at all
  const o10 = await obl("10", "ventana", cpV, "BILLING_PACKAGE", "bp-10", 6000);              // credited e-s5, Ventana (s5 is assigned Taylor only)
  const taylorAll = [o1, o2, o3, o5, o6, o7, o8, o9].sort();

  // Settlements (through the governed commands, as the Controller).
  let sk = 0;
  const customer = (id) => ({ kind: "EXTERNAL_ORGANIZATION", crmAccountId: id });
  const record = async (amountMinor) => ok(await off(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-t"), kind: "CUSTOMER_PAYMENT", amountMinor,
    currency: "USD", sourceReference: `REF-${++sk}`, idempotencyKey: `stl-${sk}` }), "record").settlement;
  const apply = async (settlementId, applications) => ok(await off(ctrl, "applySettlement", { settlementId, applications, idempotencyKey: `app-${++sk}` }), "apply");
  const stlA = (await record(10000)).id; await apply(stlA, [{ obligationId: o1, amountMinor: 10000 }]);                            // only to o1
  const stlB = (await record(20000)).id; await apply(stlB, [{ obligationId: o1, amountMinor: 5000 }, { obligationId: o2, amountMinor: 5000 }]); // o1 + o2
  const stlC = (await record(3000)).id;                                                                                            // unapplied
  const stlD = (await record(8000)).id;
  const dApp = (await apply(stlD, [{ obligationId: o2, amountMinor: 2000 }])).applications[0];
  ok(await off(ctrl, "reverseSettlementApplication", { applicationId: dApp.applicationId, reason: "fixture reversal", idempotencyKey: `rev-${++sk}` }), "reverse");
  await apply(stlD, [{ obligationId: o1, amountMinor: 1000 }]);                                                                    // o2 (REVERSED) and o1
  // After: o1 settled 16000 (outstanding 24000); o2 settled 5000 (outstanding 20000). Taylor total outstanding 74000, billed 95000, collected 21000.

  await t.test("MIG: a Sales Order's credited salesperson can never be changed (store trigger); other columns still update", async () => {
    await assert.rejects(q(`UPDATE eos_commercial.sales_orders SET credited_salesperson_employee_id = 'e-s2' WHERE id = 'so-1'`), /SALES_ORDER_CREDIT_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_commercial.sales_orders SET credited_salesperson_employee_id = NULL WHERE id = 'so-1'`), /SALES_ORDER_CREDIT_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_commercial.sales_orders SET credited_salesperson_employee_id = 'e-s1' WHERE id = 'so-3'`), /SALES_ORDER_CREDIT_IMMUTABLE/, "an unset credit is not backfilled either");
    assert.equal((await q(`UPDATE eos_commercial.sales_orders SET updated_by = 'x' WHERE id = 'so-1'`)).rowCount, 1);
    assert.equal((await q(`SELECT credited_salesperson_employee_id AS c FROM eos_commercial.sales_orders WHERE id = 'so-1'`)).rows[0].c, "e-s1");
  });

  // ── the control: Finance (no visibility key) and the General Manager (consolidated) read everything, in both modes ──
  await t.test("FULL: Finance and the General Manager read every row of their companies, unattributed ones included, with or without activation", async () => {
    for (const who of [ctrl, gm, gs]) {
      for (const via of [off, on]) {
        assert.deepEqual(idsOf(await via(who, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE" })), taylorAll, who.subject);
        const ov = ok(await via(who, "readFinanceOverview", { operatingCompanyId: "taylor" }));
        assert.deepEqual([ov.visibility.restricted, ov.currencies[0].billedMinor, ov.currencies[0].collectedMinor, ov.currencies[0].outstandingMinor, ov.currencies[0].openCount],
          [false, "95000", "21000", "74000", 8], who.subject);
      }
    }
    const access = ok(await on(gs, "readMyFinanceCompanyAccess", {}));
    assert.deepEqual(access.companies.map((c) => c.visibility), ["FULL", "FULL"], "salesperson + General Manager: the consolidated key is a full reach");
    const detail = ok(await off(ctrl, "readObligation", { obligationId: o1 }));
    assert.deepEqual(detail.sourceSalesOrder, { id: "so-1", salesOrderNumber: "SO-1" });
    assert.equal(detail.attribution.state, "ATTRIBUTED");
    assert.equal(detail.attribution.creditedSalespersonEmployeeId, "e-s1");
    assert.deepEqual(detail.facts.map((f) => f.factType).slice(0, 1), ["RECEIVABLE_ORIGINATED"]);
    for (const [id, state] of [[o3, "UNATTRIBUTED"], [o7, "NOT_ATTRIBUTABLE"], [o8, "NOT_ATTRIBUTABLE"], [o9, "NOT_ATTRIBUTABLE"]]) {
      const d = ok(await off(ctrl, "readObligation", { obligationId: id }));
      assert.equal(d.attribution.state, state, id);
      assert.equal(d.attribution.creditedSalespersonEmployeeId, undefined, `${id}: no credited person is shown for a row that has none`);
    }
    assert.equal(ok(await off(ctrl, "readObligation", { obligationId: o8 })).sourceSalesOrder, null, "a rental charge has no Sales Order source");
    const o7Detail = ok(await off(ctrl, "readObligation", { obligationId: o7 }));
    assert.equal(o7Detail.sourceSalesOrder, null, "the DETAIL agrees with the list: a package of a DIFFERENT company is no source, so no other company's Sales Order number");
    assert.equal(o7Detail.attribution.reason, "the billing package belongs to a different operating company than the receivable", "the attribution reason is unchanged");
    // F-2: the LIST carries the same Sales Order reference (obligation -> billing package -> Sales Order), null where there is none, so a list
    // reader needs no per-row detail read. A payment names the customer it came from.
    const listed = ok(await off(ctrl, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE" })).items;
    const sourceOf = (id) => listed.find((i) => i.id === id)?.sourceSalesOrder;
    assert.deepEqual(sourceOf(o1), { id: "so-1", salesOrderNumber: "SO-1" });
    assert.equal(sourceOf(o7), null, "a package of a DIFFERENT company than the receivable is no source: no other company's Sales Order number");
    assert.equal(sourceOf(o8), null, "a rental charge: no Sales Order source");
    assert.equal(sourceOf(o9), null, "no billing package at all");
    assert.ok(listed.every((i) => "sourceSalesOrder" in i), "every listed receivable answers the key (a reference or null)");
    const stl = ok(await off(ctrl, "readSettlement", { settlementId: stlA }));
    assert.deepEqual([stl.counterparty.kind, stl.counterparty.crmAccountId], ["EXTERNAL_ORGANIZATION", "acct-t"]);
    assert.ok(ok(await off(ctrl, "listSettlements", { operatingCompanyId: "taylor" })).items.every((s) => s.counterparty?.kind === "EXTERNAL_ORGANIZATION"));
  });

  // ── INACT ──
  await t.test("INACTIVE (as deployed): a self / team-only holder reads NOTHING in every projection, though assigned to the companies", async () => {
    for (const who of [s1, s2, m1, m2]) {
      const access = ok(await off(who, "readMyFinanceCompanyAccess", {}));
      assert.deepEqual(access.companies.map((c) => [c.operatingCompanyId, c.visibility]), [["taylor", "RESTRICTED_EMPTY"], ["ventana", "RESTRICTED_EMPTY"]], who.subject);
      assert.equal(access.restricted, true);
      assert.ok(access.companies.every((c) => Object.values(c.actions).filter((v, i) => i > 0).every((v) => v === false)), "no settlement action is offered");
      assert.deepEqual(ok(await off(who, "listObligations", { operatingCompanyId: "taylor" })).items, []);
      assert.deepEqual(ok(await off(who, "listObligations", { operatingCompanyId: "consolidated" })).items, []);
      assert.deepEqual(ok(await off(who, "listSettlements", { operatingCompanyId: "taylor" })).items, []);
      for (const id of [o1, o2, o4]) refused(await off(who, "readObligation", { obligationId: id }), 404, "OBLIGATION_NOT_FOUND", `${who.subject} ${id}`);
      refused(await off(who, "readSettlement", { settlementId: stlA }), 404, "SETTLEMENT_NOT_FOUND");
      const ws = ok(await off(who, "readFinanceWorkspace", { operatingCompanyId: "taylor" }));
      assert.equal(ws.receivables.count, 0);
      assert.equal(ws.visibility.restricted, true);
      assert.ok(ws.withheld.sections.includes("payables"));
      assert.equal(ws.exceptionCounts.unappliedSettlements, null, "withheld, never zero");
      const ov = ok(await off(who, "readFinanceOverview", { operatingCompanyId: "taylor" }));
      assert.deepEqual(ov.currencies, [], "no totals, no zeros");
      refused(await call(who, AN, "readMeasureAnalysis", { measureId: "finance.receivables.open", operatingCompanyId: "taylor" }), 403, "MEASURE_NOT_AUTHORIZED");
    }
    // The inactive mirror grants no reach even to the Role that holds the key (Firebase's effective zero).
    const ws = ok(await call(s1, AN, "readAnalysisWorkspace", { area: "finance", operatingCompanyId: "taylor" }));
    assert.deepEqual(ws.exceptions, [], "no finance exception for an empty reader");
    assert.ok(ws.measures.filter((m) => m.id.startsWith("finance.")).every((m) => m.status !== "COMPUTED"), "no finance measure is computed for an empty reader");
  });

  // ── ACT ──
  await t.test("ACTIVATED: a salesperson reads only the receivables credited to it (the company boundary stays the outer limit)", async () => {
    assert.deepEqual(idsOf(await on(s1, "listObligations", { operatingCompanyId: "taylor" })), [o1], "o2 (e-s2), o3 (no credit), o5..o9 are hidden; o7's package company differs");
    assert.deepEqual(idsOf(await on(s1, "listObligations", { operatingCompanyId: "ventana" })), [o4]);
    // F-2: the account narrowing and the Sales Order reference never widen a restricted reader's reach.
    const narrowed = ok(await on(s1, "listObligations", { operatingCompanyId: "taylor", crmAccountId: "acct-t" })).items;
    assert.deepEqual(narrowed.map((i) => i.id), [o1], "the account narrowing returns only the visible rows of that account");
    assert.deepEqual(narrowed[0].sourceSalesOrder, { id: "so-1", salesOrderNumber: "SO-1" });
    assert.deepEqual(idsOf(await on(s1, "listObligations", { operatingCompanyId: "taylor", crmAccountId: "acct-nobody" })), [], "an unknown account is empty, not an error");
    assert.deepEqual(idsOf(await on(s1, "listObligations", { operatingCompanyId: "consolidated" })), [o1, o4].sort());
    assert.deepEqual(idsOf(await on(s1, "listObligations", { operatingCompanyId: "taylor", kind: "FUNDING_RECEIVABLE" })), [], "funding receivables are hidden");
    const d = ok(await on(s1, "readObligation", { obligationId: o1 }));
    assert.equal(d.attribution.creditedSalespersonEmployeeId, "e-s1");
    assert.equal(d.sourceSalesOrder.id, "so-1");
    // A hidden record answers EXACTLY like one that does not exist (code, status and message).
    const missing = await on(s1, "readObligation", { obligationId: "obl_does_not_exist" });
    for (const hidden of [o2, o3, o5, o7, o8, o9]) {
      const h = await on(s1, "readObligation", { obligationId: hidden });
      assert.deepEqual([h.status, h.body.code, h.body.message], [missing.status, missing.body.code, missing.body.message], hidden);
    }
    // Stan is assigned to Taylor only: his Ventana credit (o10) is outside the company boundary, so it is not his to read.
    assert.deepEqual(idsOf(await on(s5, "listObligations", { operatingCompanyId: "taylor" })), []);
    refused(await on(s5, "listObligations", { operatingCompanyId: "ventana" }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE");
    refused(await on(s5, "listObligations", { operatingCompanyId: "consolidated" }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE");
    refused(await on(s5, "readObligation", { obligationId: o10 }), 404, "OBLIGATION_NOT_FOUND");
    // Another salesperson sees only theirs.
    assert.deepEqual(idsOf(await on(s2, "listObligations", { operatingCompanyId: "taylor" })), [o2]);
    const access = ok(await on(s1, "readMyFinanceCompanyAccess", {}));
    assert.deepEqual(access.companies.map((c) => c.visibility), ["RESTRICTED", "RESTRICTED"]);
    // A mixed salesperson + Controller holds a visibility key without a full one: RESTRICTED, never widened (fail closed).
    assert.deepEqual(ok(await on(mx, "readMyFinanceCompanyAccess", {})).companies.map((c) => c.visibility), ["RESTRICTED", "RESTRICTED"]);
    assert.deepEqual(idsOf(await on(mx, "listObligations", { operatingCompanyId: "taylor" })), []);
  });

  await t.test("ACTIVATED: a manager reads its team's receivables by the reporting line AS OF THE ORDER'S CREATION (D-249-1 A); fail-closed; cycle-safe", async () => {
    // s1 reported to m1 on 2026-03-01 (until 2026-08-01) and reports to m2 now: m1 yes, m2 no. s2 -> m1; s3 -> s2 -> m1 (two levels).
    assert.deepEqual(idsOf(await on(m1, "listObligations", { operatingCompanyId: "taylor" })), [o1, o2, o5].sort(), "o6 (s4 has no reporting line) and o3 (no credit) are hidden");
    assert.deepEqual(idsOf(await on(m1, "listObligations", { operatingCompanyId: "ventana" })), [o4], "the rule does not depend on the company, only on the line at the credit date");
    assert.deepEqual(idsOf(await on(m2, "listObligations", { operatingCompanyId: "taylor" })), [], "the CURRENT line is not the rule");
    assert.deepEqual(idsOf(await on(m2, "listObligations", { operatingCompanyId: "ventana" })), []);
    refused(await on(m2, "readObligation", { obligationId: o1 }), 404, "OBLIGATION_NOT_FOUND");
    // The credited person always sees their own, and Finance sees the unknown-line row.
    assert.deepEqual(idsOf(await on(s1, "listObligations", { operatingCompanyId: "taylor" })), [o1]);
    assert.ok(idsOf(await on(ctrl, "listObligations", { operatingCompanyId: "taylor" })).includes(o6));
  });

  await t.test("NO LEAK: totals, counts, the workspace, the overview and Analysis include visible rows and nothing else", async () => {
    // s1 (SELF): o1 only. m1 (TEAM): o1 + o2 + o5. Finance: everything.
    const expect = { s1: { billed: "40000", collected: "16000", outstanding: "24000", open: 1, overdue: 1 },
      m1: { billed: "70000", collected: "21000", outstanding: "49000", open: 3, overdue: 1 } };
    for (const [who, e] of [[s1, expect.s1], [m1, expect.m1]]) {
      const ov = ok(await on(who, "readFinanceOverview", { operatingCompanyId: "taylor" }));
      assert.equal(ov.visibility.restricted, true);
      assert.deepEqual([ov.currencies[0].billedMinor, ov.currencies[0].collectedMinor, ov.currencies[0].outstandingMinor, ov.currencies[0].openCount, ov.currencies[0].overdueCount],
        [e.billed, e.collected, e.outstanding, e.open, e.overdue], `${who.subject} overview`);
      assert.equal(ov.currencies[0].aging.days61PlusMinor, "24000", "o1 (due 2026-01-15) ages 61+; nothing hidden is in a bucket");
      assert.equal(ov.currencies[0].aging.unagedMinor, who === s1 ? "0" : "25000", "o2 + o5 have no due date: unaged, never Current");
      assert.equal(ov.byCompany.length, 1);
      const ws = ok(await on(who, "readFinanceWorkspace", { operatingCompanyId: "taylor" }));
      assert.equal(ws.receivables.outstandingByCurrency.USD, e.outstanding);
      assert.equal(ws.receivables.count, e.open);
      assert.deepEqual(ws.overdue.map((o) => o.id), [o1]);
      assert.ok(["fundingReceivables", "payables", "intercompanyReceivables", "intercompanyPayables", "unappliedSettlements", "accountingHandoffs", "reconciliation",
        "missingCostEvidence", "intercompanyReliefPending"].every((s) => ws.withheld.sections.includes(s)), "every non-attributable section is NAMED as withheld");
      assert.equal(ws.payables.withheld, true);
      assert.equal(ws.payables.count, null, "withheld is not zero");
      assert.equal(ws.exceptionCounts.reconciliationMismatches, null);
      // Analysis: the same figure, computed over the same visible rows.
      const open = ok(await callAs(true)(who, AN, "readMeasureAnalysis", { measureId: "finance.receivables.open", operatingCompanyId: "taylor" })).measure;
      assert.equal(open.value.value, e.outstanding, `${who.subject}: Analysis open receivables`);
      assert.equal(open.provenance.contributingRecords, e.open);
      assert.ok(open.provenance.sources.every((s) => [o1, o2, o5].includes(s.recordId)), "no hidden record is a contributing source");
      const over = ok(await callAs(true)(who, AN, "readMeasureAnalysis", { measureId: "finance.receivables.overdue", operatingCompanyId: "taylor" })).measure;
      assert.equal(over.value.value, "24000");
      refused(await callAs(true)(who, AN, "readMeasureAnalysis", { measureId: "finance.payables.open", operatingCompanyId: "taylor" }), 403, "MEASURE_NOT_AUTHORIZED");
      refused(await callAs(true)(who, AN, "readMeasureAnalysis", { measureId: "finance.settlements.unapplied", operatingCompanyId: "taylor" }), 403, "MEASURE_NOT_AUTHORIZED");
      const aws = ok(await callAs(true)(who, AN, "readAnalysisWorkspace", { area: "finance", operatingCompanyId: "taylor" }));
      assert.deepEqual(aws.exceptions.map((x) => [x.kind, x.recordId]), [["OVERDUE_RECEIVABLE", o1]], "exceptions name only visible records");
      assert.ok(aws.measures.filter((m) => m.status === "COMPUTED").every((m) => ["finance.receivables.open", "finance.receivables.overdue"].includes(m.id)), "only the attributable measures compute");
    }
    // Finance, the control: the full figure.
    const full = ok(await callAs(true)(ctrl, AN, "readMeasureAnalysis", { measureId: "finance.receivables.open", operatingCompanyId: "taylor" })).measure;
    assert.equal(full.value.value, "74000");
    // A consolidated figure for s1 is its visible rows across both companies (Taylor o1 + Ventana o4), still never the hidden ones.
    const cons = ok(await on(s1, "readFinanceOverview", { operatingCompanyId: "consolidated" }));
    assert.deepEqual([cons.currencies[0].outstandingMinor, cons.byCompany.map((c) => [c.operatingCompanyId, c.outstandingMinor])], ["35000", [["taylor", "24000"], ["ventana", "11000"]]]);
    // The recording-window filter narrows what is already visible, never widens it.
    const future = ok(await on(s1, "readFinanceOverview", { operatingCompanyId: "taylor", recordedFrom: "2999-01-01T00:00:00Z" }));
    assert.deepEqual(future.currencies, []);
    refused(await on(s1, "readFinanceOverview", { operatingCompanyId: "taylor", recordedFrom: "yesterday" }), 400, "RECORDED_WINDOW_INVALID");
    refused(await on(s1, "readFinanceOverview", { operatingCompanyId: "taylor", unknownField: 1 }), 400, "FIELD_NOT_ACCEPTED");
  });

  await t.test("SETTLEMENTS: visible to a restricted reader only when EVERY application ever recorded is to a visible receivable; unapplied ones are hidden", async () => {
    const settlementIds = async (who) => ok(await on(who, "listSettlements", { operatingCompanyId: "taylor" })).items.map((s) => s.id).sort();
    assert.deepEqual(await settlementIds(ctrl), [stlA, stlB, stlC, stlD].sort(), "Finance sees all four");
    // s1: stlA (only o1). stlB also applies to o2 (not s1's); stlC is unapplied; stlD has a REVERSED application to o2.
    assert.deepEqual(await settlementIds(s1), [stlA]);
    // F-2: the restricted reader's settlement carries its counterparty only because the settlement is visible to it; a hidden one is not listed at all.
    assert.deepEqual(ok(await on(s1, "listSettlements", { operatingCompanyId: "taylor" })).items.map((s) => [s.id, s.counterparty.crmAccountId]), [[stlA, "acct-t"]]);
    // m1 (TEAM) sees o1 and o2: stlA, stlB and stlD; the unapplied one stays hidden.
    assert.deepEqual(await settlementIds(m1), [stlA, stlB, stlD].sort());
    assert.deepEqual(await settlementIds(m2), []);
    const readA = ok(await on(s1, "readSettlement", { settlementId: stlA }));
    assert.deepEqual(readA.applications.map((a) => a.obligationId), [o1]);
    const missing = await on(s1, "readSettlement", { settlementId: "stl_does_not_exist" });
    for (const hidden of [stlB, stlC, stlD]) {
      const h = await on(s1, "readSettlement", { settlementId: hidden });
      assert.deepEqual([h.status, h.body.code, h.body.message], [missing.status, missing.body.code, missing.body.message], hidden);
    }
    // The settlement application a restricted reader sees on ITS receivable names no other obligation.
    const d = ok(await on(s1, "readObligation", { obligationId: o1 }));
    assert.equal(d.applications.length, 3);
    assert.ok(d.applications.every((a) => a.amountMinor && a.status), "its own applications, amounts only for ITS obligation");
    // F2 (review): a settlement readSettlement hides from this reader (stlB, stlD also settle o2) is NOT described here either --
    // no id, kind or source reference; the application says only that the settlement is not visible, with its own date.
    const visibleApps = d.applications.filter((a) => a.settlementVisible === true), hiddenApps = d.applications.filter((a) => a.settlementVisible === false);
    assert.deepEqual(visibleApps.map((a) => a.settlementId), [stlA]);
    assert.equal(hiddenApps.length, 2);
    for (const h of hiddenApps) {
      assert.deepEqual([h.settlementId, h.settlementKind, h.sourceReference, h.businessDate], [null, null, null, null]);
      assert.match(h.appliedOn, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(h.amountMinor && h.status);
    }
    const leaked = JSON.stringify(hiddenApps);
    for (const hiddenId of [stlB, stlD]) assert.ok(!leaked.includes(hiddenId), "a hidden settlement's id appears nowhere in the application");
    // ...nor anywhere in the WHOLE result: the settlement-application FACTS name their settlement too (source_record_id, copied onto reversals).
    const whole = JSON.stringify(d);
    for (const hiddenId of [stlB, stlD]) assert.ok(!whole.includes(hiddenId), "a hidden settlement's id appears nowhere in the entire readObligation result");
    assert.ok(d.facts.some((f) => f.sourceDomain === "SETTLEMENT" && f.settlementVisible === false && f.sourceRecordId === null && f.reason === null), "its facts survive, de-identified");
    assert.ok(d.facts.some((f) => f.sourceDomain === "SETTLEMENT" && f.sourceRecordId === stlA), "the visible settlement's fact keeps its source");
    const wholeFor = async (who) => JSON.stringify(ok(await on(who, "readObligation", { obligationId: o1 })));
    for (const who of [ctrl, m1]) for (const hiddenId of [stlB, stlD]) assert.ok((await wholeFor(who)).includes(hiddenId), `${who.subject} still sees ${hiddenId}`);
    // Finance and the Team manager (who sees o2 too) see every settlement of these applications.
    assert.ok(ok(await on(ctrl, "readObligation", { obligationId: o1 })).applications.every((a) => a.settlementVisible === true && a.settlementId));
    assert.ok(ok(await on(m1, "readObligation", { obligationId: o1 })).applications.every((a) => a.settlementVisible === true));
    // The business-date window is accepted and validated.
    assert.deepEqual(ok(await on(ctrl, "listSettlements", { operatingCompanyId: "taylor", businessDateFrom: "2999-01-01" })).items, []);
    refused(await on(ctrl, "listSettlements", { operatingCompanyId: "taylor", businessDateFrom: "01/01/2026" }), 400, "BUSINESS_DATE_INVALID");
  });

  // ── F1 (independent review) ──
  await t.test("FAIL CLOSED: a restriction key held through a company SCOPE or a CONDITION restricts -- never FULL; a global controller plus a company-scoped salesperson is restricted at that company", async () => {
    // finance.visibility.* is not scope-evaluable, so the runtime reports a scoped holding as inert (never in the flat set); and a conditioned
    // grant leaves the flat set. Both used to resolve FULL ("no visibility key held"). Raw rows, as an Administrator's custom Role would write them.
    const giveRole = async (who, roleKey, capKeys, scopeValue = null) => {
      const roleId = `rl-f1-${roleKey}`;
      await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by) VALUES ($1,$2,$3,$3,'CUSTOM','f1','f1') ON CONFLICT DO NOTHING`, [roleId, TENANT, roleKey]);
      for (const k of capKeys) {
        await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
                 SELECT $1,$2,$3,c.id,'f1','f1','f1' FROM eos_policy.capabilities c WHERE c.key = $4 ON CONFLICT DO NOTHING`, [`rc-f1-${roleKey}-${k}`, TENANT, roleId, k]);
      }
      await q(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
               VALUES ($1,$2,$3,$4,$5,$6,'active','f1',0,'f1','f1') ON CONFLICT DO NOTHING`,
        [`ura-f1-${roleKey}-${who.principalId}`, TENANT, who.principalId, roleId, scopeValue ? "operatingCompany" : "global", scopeValue]);
    };
    const modes = async (call_, who) => ok(await call_(who, "readMyFinanceCompanyAccess", {})).companies.map((c) => [c.operatingCompanyId, c.visibility]);
    const SELF = "finance.visibility.self";

    // (a) a custom Role holding finance.visibility.self, assigned at operatingCompany=taylor (the financeCompanyAccess pattern).
    const sc = await person("uid-f1-scoped", [], { id: "e-f1-scoped", name: "Scoped Seller" });
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [sc], ["taylor"]);
    await giveRole(sc, "fvScopedSelf", [SELF], "taylor");
    assert.deepEqual(await modes(off, sc), [["taylor", "RESTRICTED_EMPTY"]], "inactive: restricted-empty, never FULL");
    assert.deepEqual(idsOf(await off(sc, "listObligations", { operatingCompanyId: "taylor" })), [], "inactive: nothing is listed");
    refused(await off(sc, "readObligation", { obligationId: o1 }), 404, "OBLIGATION_NOT_FOUND");
    assert.equal(ok(await off(sc, "readFinanceWorkspace", { operatingCompanyId: "taylor" })).visibility.restricted, true);
    assert.deepEqual(await modes(on, sc), [["taylor", "RESTRICTED"]], "activated: restricted to the credited rows");
    assert.deepEqual(idsOf(await on(sc, "listObligations", { operatingCompanyId: "taylor" })), [], "activated: only receivables credited to this Employee (none)");
    assert.equal(ok(await on(sc, "readFinanceOverview", { operatingCompanyId: "taylor" })).visibility.restricted, true);

    // (b) a CONDITIONED grant of the key (a raw condition row, as the F7/F8 reviews write them): restricts and reads nothing, even when activated.
    const cc = await person("uid-f1-cond", [], { id: "e-f1-cond", name: "Conditioned Seller" });
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [cc]);
    await giveRole(cc, "fvCondSelf", [SELF]);
    await q(`INSERT INTO eos_policy.capability_grant_conditions (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('gc-f1',$1,'ROLE','fvCondSelf',$2,'{"paths":[[{"kind":"WORK_ELIGIBILITY","qualificationCode":"NO_SUCH_QUALIFICATION"}]]}'::jsonb,'x','x')`, [TENANT, SELF]);
    for (const [label, c_] of [["inactive", off], ["activated", on]]) {
      assert.deepEqual(await modes(c_, cc), [["taylor", "RESTRICTED_EMPTY"], ["ventana", "RESTRICTED_EMPTY"]], `${label}: a conditioned restriction key reads nothing`);
      assert.deepEqual(idsOf(await c_(cc, "listObligations", { operatingCompanyId: "taylor" })), [], label);
    }

    // (c) a GLOBAL controller (no visibility key, hence FULL on its own) plus a salesperson Role scoped to Taylor: restricted at Taylor, FULL at Ventana.
    const mx2 = await person("uid-f1-mixed", ["controller"], { id: "e-f1-mixed", name: "Mixed Scope" });
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [mx2]);
    await giveRole(mx2, "fvScopedSales", [SELF], "taylor");
    assert.deepEqual(await modes(off, mx2), [["taylor", "RESTRICTED_EMPTY"], ["ventana", "FULL"]]);
    assert.deepEqual(idsOf(await off(mx2, "listObligations", { operatingCompanyId: "taylor" })), []);
    assert.deepEqual(idsOf(await off(mx2, "listObligations", { operatingCompanyId: "ventana" })), [o4, o10].sort(), "the company with no restriction key stays FULL");
    assert.deepEqual(await modes(on, mx2), [["taylor", "RESTRICTED"], ["ventana", "FULL"]]);
  });

  await t.test("COMMANDS: a restricted reader is refused every settlement command (the same answer as a missing record); Finance still acts", async () => {
    // Give the Sales Manager the settlement keys: the restriction, not the missing key, must be what refuses.
    for (const key of ["finance.settlement.record", "finance.settlement.apply", "finance.settlement.correct", "finance.reconciliation.record"]) {
      const c = (await q(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = $1`, [key])).rows[0];
      assert.equal((await admin("grantObjectActionToRole", { roleKey: "salesManager", objectKey: c.object_key, actionKey: c.action_key, reason: "local test tenant only" })).ok, true, key);
    }
    for (const via of [on, off]) {
      const before = (await q(`SELECT (SELECT count(*) FROM eos_finance.settlements) s, (SELECT count(*) FROM eos_finance.settlement_applications) a`)).rows[0];
      refused(await via(m1, "recordSettlement", { operatingCompanyId: "taylor", counterparty: customer("acct-t"), kind: "CUSTOMER_PAYMENT", amountMinor: 5, currency: "USD",
        sourceReference: "x", idempotencyKey: `cmd-r-${++sk}` }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE");
      refused(await via(m1, "applySettlement", { settlementId: stlC, applications: [{ obligationId: o2, amountMinor: 100 }], idempotencyKey: `cmd-a-${++sk}` }), 404, "SETTLEMENT_NOT_FOUND");
      refused(await via(m1, "voidSettlement", { settlementId: stlC, reason: "x" }), 404, "SETTLEMENT_NOT_FOUND");
      refused(await via(m1, "reconcileSettlement", { settlementId: stlA, externalReference: "x", externalAmountMinor: 10000, idempotencyKey: `cmd-c-${++sk}` }), 404, "SETTLEMENT_NOT_FOUND");
      refused(await via(m1, "reverseSettlementApplication", { applicationId: dApp.applicationId, reason: "x", idempotencyKey: `cmd-v-${++sk}` }), 404, "APPLICATION_NOT_FOUND");
      assert.deepEqual((await q(`SELECT (SELECT count(*) FROM eos_finance.settlements) s, (SELECT count(*) FROM eos_finance.settlement_applications) a`)).rows[0], before, "nothing was written");
    }
    // Finance (no visibility key) acts as before.
    ok(await on(ctrl, "applySettlement", { settlementId: stlC, applications: [{ obligationId: o2, amountMinor: 100 }], idempotencyKey: `cmd-ok-${++sk}` }), "Finance applies");
  });

  await t.test("IDENTITY: a restricted principal without exactly one access-eligible linked Employee reads nothing", async () => {
    const actor = { capabilities: new Set(["finance.payment.read", "finance.visibility.self"]), tenantId: TENANT, principalId: "principal-without-employee", financeSelfTeamActive: true };
    const v = await visibility.resolveFinanceVisibility(pool, actor, ["taylor"]);
    assert.deepEqual([v.restricted, v.emptyCompanies, v.visibleReceivableIds, v.fullCompanies], [true, ["taylor"], [], []]);
    const none = await visibility.resolveFinanceVisibility(pool, { ...actor, capabilities: new Set(["finance.payment.read"]) }, ["taylor"]);
    assert.deepEqual([none.restricted, none.fullCompanies], [false, ["taylor"]], "no visibility key at all: the company-assignment model (D-249-2)");
  });
});
