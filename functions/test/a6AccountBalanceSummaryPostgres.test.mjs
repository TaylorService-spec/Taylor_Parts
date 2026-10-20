// A6 CUSTOMER-BALANCE SUMMARY -- against a real postgres:16 (Owner decision A6, 2026-10-19; migration 1764680000000). Set POLICY_TEST_DATABASE_URL to run.
//
// The tenant is the baseline-equal service tenant (serviceBaselineTenant), so what is proved is what the rebuilt authority holds.
//   GRANTS  the capability is registered once as a READ (readBalanceSummary) on the payment Object; exactly the eight Owner Roles hold it (stamped by the migration); no direct grant;
//           the Finance roles and Owner do not.
//   REACH   the outer limit is the Employee's company authority UNION the explicit Finance company assignments: an Employee reads its own company; an assignment extends
//           it to another company; a company outside the union reads as NO DATA -- the very same answer as a customer that owes nothing.
//   ADMIN   a PROTECTED ADMINISTRATOR holds every company of the tenant for the summary.
//   ROWS    open RECEIVABLE obligations of ONE customer: settled and VOID are excluded, a partly settled one counts its balance; per company and currency.
//   SALES   a salesperson keeps self, a manager team (the inner reach, financeVisibility.ts): INACTIVE as deployed it reads nothing; ACTIVATED it reads only the receivables
//           credited to it / its team, inside its company.
//   SHAPE   five numbers per company and currency and nothing else: no id of an obligation, settlement, handoff or package appears anywhere in the answer.
//   WRITE   the operation writes nothing; a summary-only holder is refused every settlement / reconciliation command and every Finance workspace read.
//   (The offline half -- the migration shape, the baseline, the source shape -- is a6AccountBalanceSummary.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { assignFinanceCompanies } from "./support/financeCompanyAccess.mjs";

const require = createRequire(import.meta.url);
const fin = require("../lib/eosFinance/financeFoundation.js");
const finOps = require("../lib/eosFinance/financeOperations.js");
const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-a6bal";
const PREFIX = "a6bal";
const STAMP = "migration:1764680000000";
const KEY = "finance.accountBalance.read";
const OP = "readAccountBalanceSummary";
const FIN = "/operations/finance";
const OWNER_ROLES = ["fieldManager", "partsAssociate", "partsManager", "purchasingManager", "salesManager", "salesperson", "shopAssociate", "shopManager"];

test("A6 customer-balance summary on PostgreSQL: grants, reach, company isolation, sales restrictions, summary-only shape, no write path", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call, repo, http } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: PREFIX });
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 600)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const sys = { tenantId: TENANT, principalId: "finance-system" };
  // The deployed server activates nothing; the ACTIVATED fixture injects the switch (D-249-0), exactly as the Finance visibility suite does.
  const callAs = (active) => async (who, route, operation, input = {}) => {
    const res = await http.handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE", financeSelfTeamVisibilityActive: active,
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }) },
    { method: "POST", url: route, headers: { authorization: `Bearer ${who.subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const off = (who, op, input) => call(who, FIN, op, input);
  const on = (who, op, input) => callAs(true)(who, FIN, op, input);
  const summary = async (via, who, crmAccountId) => ok(await via(who, OP, { crmAccountId }), `${who.subject} ${crmAccountId}`);
  const rows = (r) => r.summaries.map((s) => [s.operatingCompanyId, s.currency, s.openReceivableCount, s.outstandingMinor, s.overdueCount, s.overdueMinor]);

  // ── GRANTS ──
  await t.test("GRANTS: the capability is a registered READ; exactly the eight Owner Roles hold it, stamped by the migration; no direct grant; Finance roles and Owner do not", async () => {
    const reg = (await q(`SELECT key, object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = $1`, [KEY])).rows;
    assert.deepEqual(reg, [{ key: KEY, object_key: "payment", action_key: "readBalanceSummary", action_kind: "READ" }]);
    const held = (await q(
      `SELECT r.key AS role, rc.granted_by FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE rc.tenant_id = $1 AND c.key = $2 ORDER BY 1`, [TENANT, KEY])).rows;
    assert.deepEqual(held.map((r) => r.role), [...OWNER_ROLES].sort());
    assert.ok(held.every((r) => r.granted_by === STAMP), "every grant is stamped by the migration");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = $1`, [KEY])).rows[0].n, 0);
    for (const role of ["owner", "admin", "controller", "accountingManager", "financeManager", "generalManager", "dispatcher", "technician"]) {
      assert.equal((await capabilitiesForRoleKeys(pool, TENANT, [role])).has(KEY), false, `${role} does not hold the summary key`);
    }
    for (const role of OWNER_ROLES) assert.equal((await capabilitiesForRoleKeys(pool, TENANT, [role])).has(KEY), true, role);
  });

  // ── fixture ──
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrl]);
  const pmT = await person("uid-pmt", ["partsManager"], { id: "e-pmt", name: "Pat Taylor-Parts", company: "taylor" });
  const smV = await person("uid-smv", ["shopManager"], { id: "e-smv", name: "Val Ventana-Shop", company: "ventana" });
  const ext = await person("uid-ext", ["partsAssociate"], { id: "e-ext", name: "Ed Extended", company: "taylor" });
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ext], ["ventana"]); // the admin extends Ed to Ventana
  const noLink = await person("uid-nolink", ["partsManager"]);                    // a Principal with no Employee: no company authority of its own
  const sp1 = await person("uid-sp1", ["salesperson"], { id: "e-sp1", name: "Sam Seller", company: "taylor" });
  const mgr = await person("uid-mgr", ["salesManager"], { id: "e-mgr", name: "Mia Manager", company: "taylor" });
  const dsp = await person("uid-dsp", ["dispatcher"], { id: "e-dsp", name: "Dee Dispatcher", company: "taylor" });
  await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,display_name) VALUES ('e-sp2',$1,'ACTIVE','taylor','e-sp2')`, [TENANT]);
  // Sam reports to Mia from 2026-01-01 (the team reach); e-sp2 reports to nobody.
  await q(`INSERT INTO eos_workforce.employee_reporting_relationships (id,tenant_id,employee_id,manager_employee_id,effective_from,effective_to,established_by,ended_by,ended_at,source)
           VALUES ('rr-1',$1,'e-sp1','e-mgr','2026-01-01T00:00:00Z',NULL,'f',NULL,NULL,'GOVERNED_COMMAND')`, [TENANT]);
  for (const [id, name] of [["acct-a", "Both Companies Customer"], ["acct-b", "Taylor Other Customer"], ["acct-v", "Ventana Only Customer"], ["acct-none", "Owes Nothing Customer"], ["acct-void", "Voided Only Customer"]]) {
    await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ($1,$2,$3,'ACTIVE','f','f')`, [id, TENANT, name]);
    await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,$2,'CUSTOMER')`, [TENANT, id]);
  }
  const cp = {};
  for (const id of ["acct-a", "acct-b", "acct-v", "acct-void"]) cp[id] = (await fin.ensureExternalCounterparty(pool, sys, id)).id;
  // Sales Orders carry the AUTHORITATIVE credit (set at creation, never edited).
  const order = (id, company, account, credited) => q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key,
      sales_channel, currency, state, credited_salesperson_employee_id, created_by, updated_by, created_at) VALUES ($1,$2,upper($1),$3,'e-ctrl',$4,'RETAIL','USD','CONFIRMED',$5,'f','f','2026-03-01T00:00:00Z')`,
  [id, TENANT, account, company, credited]);
  const pkg = (id, so, company, account) => q(`INSERT INTO eos_finance.billing_packages (id, tenant_id, source_kind, sales_order_id, version, status, readiness_exceptions, operating_company_id,
      operating_company_key, commercial_customer_account_id, obligor_basis, commercial_disposition, currency, content_fingerprint, prepared_by)
    VALUES ($1,$2,'SALES_ORDER',$3,1,'HELD',ARRAY['FIXTURE'],$4,$4,$5,'UNRESOLVED','SALE','USD',$1,'f')`, [id, TENANT, so, company, account]);
  const obl = (n, company, account, source, sourceId, amount, dueOn = null) => fin.openObligation(pool, sys, { operatingCompanyId: company, counterpartyId: cp[account], kind: "RECEIVABLE",
    currency: "USD", sourceDomain: source, sourceRecordId: sourceId, originationAmountMinor: amount, basis: "FIXTURE", effectiveAt: new Date(), idempotencyKey: `a6-obl-${n}`, dueOn })
    .then((r) => r.obligationId);
  const billed = async (n, so, company, account, credited, amount, dueOn = null) => {
    await order(so, company, account, credited);
    await pkg(`bp-${n}`, so, company, account);
    return obl(n, company, account, "BILLING_PACKAGE", `bp-${n}`, amount, dueOn);
  };
  const oA1 = await billed("a1", "so-a1", "taylor", "acct-a", "e-sp1", 40000, "2026-01-15");   // open, OVERDUE, credited Sam
  const oA2 = await billed("a2", "so-a2", "taylor", "acct-a", "e-sp2", 25000);                 // open (partly settled below), credited e-sp2
  const oA3 = await billed("a3", "so-a3", "taylor", "acct-a", "e-sp1", 3000);                  // fully settled below: excluded
  const oA4 = await billed("a4", "so-a4", "taylor", "acct-a", "e-sp1", 9000);                  // VOID below: excluded
  const oA5 = await billed("a5", "so-a5", "ventana", "acct-a", "e-sp1", 11000, "2026-01-10");  // Ventana, open, OVERDUE, credited Sam (Sam's home is Taylor)
  const oA6 = await obl("a6", "taylor", "acct-a", "FIXTURE", "no-package", 4000);              // no Sales Order source: not attributable (hidden from restricted readers)
  const oB1 = await billed("b1", "so-b1", "taylor", "acct-b", "e-sp2", 7000);
  const oV1 = await billed("v1", "so-v1", "ventana", "acct-v", "e-sp2", 6000);
  const oW1 = await obl("w1", "taylor", "acct-void", "FIXTURE", "w1-src", 5000);                 // VOID below: a customer whose only receivable is void owes nothing
  const voidIt = async (obligationId, key) => {
    const c = await pool.connect();
    try { await c.query("BEGIN"); await fin.voidObligationOn(c, sys, { obligationId, reason: "fixture void", idempotencyKey: key }); await c.query("COMMIT"); }
    catch (err) { await c.query("ROLLBACK"); throw err; } finally { c.release(); }
  };
  await voidIt(oA4, "a6-void-a4");
  await voidIt(oW1, "a6-void-w1");
  // Settlements through the governed commands, as the Controller.
  let sk = 0;
  const settle = async (obligationId, amountMinor) => {
    const stl = ok(await off(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-a" }, kind: "CUSTOMER_PAYMENT",
      amountMinor, currency: "USD", sourceReference: `A6-REF-${++sk}`, idempotencyKey: `a6-stl-${sk}` }), "record").settlement;
    ok(await off(ctrl, "applySettlement", { settlementId: stl.id, applications: [{ obligationId, amountMinor }], idempotencyKey: `a6-app-${++sk}` }), "apply");
    return stl.id;
  };
  const stlA3 = await settle(oA3, 3000);
  const stlA2 = await settle(oA2, 5000);                                                          // oA2 outstanding 20000
  const NONE = { status: "READY", restricted: false, summaries: [] };
  const strip = (r) => ({ status: r.status, restricted: r.restricted, summaries: r.summaries }); // asOf is the only moving part of an answer
  // After: acct-a Taylor open = oA1 40000 (overdue) + oA2 20000 + oA6 4000 = 3 / 64000 / 1 overdue 40000; Ventana open = oA5 11000 (overdue) = 1 / 11000 / 1 overdue 11000.
  const A_TAYLOR = ["taylor", "USD", 3, "64000", 1, "40000"];
  const A_VENTANA = ["ventana", "USD", 1, "11000", 1, "11000"];

  // ── REACH ──
  await t.test("REACH: an Employee reads its OWN company; another company reads as no data; an assignment extends the reach; a Principal with no Employee reads nothing", async () => {
    assert.deepEqual(rows(await summary(off, pmT, "acct-a")), [A_TAYLOR], "Taylor's Parts Manager: only Taylor -- Ventana's balance of the same customer is not hers");
    assert.deepEqual(rows(await summary(off, smV, "acct-a")), [A_VENTANA], "Ventana's Shop Manager: only Ventana");
    assert.deepEqual(rows(await summary(off, ext, "acct-a")), [A_TAYLOR, A_VENTANA], "home company UNION the Finance assignment");
    assert.deepEqual(rows(await summary(off, noLink, "acct-a")), [], "no Employee link, no assignment: no company");
    // Non-sales roles read ALL customers inside their reach (no per-customer relationship is required).
    assert.deepEqual(rows(await summary(off, pmT, "acct-b")), [["taylor", "USD", 1, "7000", 0, "0"]]);
    assert.deepEqual(rows(await summary(off, smV, "acct-v")), [["ventana", "USD", 1, "6000", 0, "0"]]);
    const all = ok(await off(ext, OP, { crmAccountId: "acct-v" }));
    assert.deepEqual(rows(all), [["ventana", "USD", 1, "6000", 0, "0"]]);
    assert.equal(all.status, "READY");
    assert.equal(all.restricted, false, "a non-sales role holds no visibility key: its reach is FULL");
  });

  await t.test("ISOLATION: a customer whose receivables are all in a company outside the reach reads EXACTLY like a customer that owes nothing", async () => {
    const owesNothing = strip(await summary(off, pmT, "acct-none"));
    assert.deepEqual(owesNothing, NONE);
    const unknown = strip(await summary(off, pmT, "acct-does-not-exist"));
    assert.deepEqual(unknown, owesNothing, "an account that does not exist answers the same");
    assert.deepEqual(strip(await summary(off, pmT, "acct-v")), owesNothing, "Taylor's Parts Manager on a Ventana-only customer");
    assert.deepEqual(strip(await summary(off, smV, "acct-b")), owesNothing, "Ventana's Shop Manager on a Taylor-only customer");
    // A fully settled customer is also "nothing open": settled and VOID rows are excluded, so no zero row appears.
    assert.deepEqual(strip(await summary(off, pmT, "acct-void")), owesNothing, "a VOID-only customer is nothing owed");
  });

  await t.test("ADMIN: a protected Administrator holds every company of the tenant for the summary", async () => {
    const adminId = (await q(`SELECT id FROM eos_policy.principals WHERE external_subject = $1`, [`uid-${PREFIX}-admin`])).rows[0].id;
    const caller = { actor: { tenantId: TENANT, principalId: adminId, capabilities: new Set([KEY]) } };
    const r = await finOps.EOS_FINANCE_OPERATIONS[OP]({ pool }, caller, { crmAccountId: "acct-a" });
    assert.deepEqual(rows(r), [A_TAYLOR, A_VENTANA]);
    // A holder of the key with NO standing and no company authority (here the Controller's tenant member without an Employee) reads nothing: nothing implies a company.
    const nobody = { actor: { tenantId: TENANT, principalId: noLink.principalId, capabilities: new Set([KEY]) } };
    assert.deepEqual(rows(await finOps.EOS_FINANCE_OPERATIONS[OP]({ pool }, nobody, { crmAccountId: "acct-a" })), []);
  });

  // ── ROWS ──
  await t.test("ROWS: open receivables of the one customer only; settled and VOID excluded; a partly settled one counts its balance; counts and amounts agree with the Finance list", async () => {
    const r = await summary(off, ext, "acct-a");
    assert.deepEqual(rows(r), [A_TAYLOR, A_VENTANA]);
    // The full read (the Controller) agrees with the summary, to the minor unit.
    const list = ok(await off(ctrl, "listObligations", { operatingCompanyId: "taylor", crmAccountId: "acct-a", kind: "RECEIVABLE" })).items;
    const open = list.filter((o) => ["OPEN", "PARTIAL"].includes(o.status) && BigInt(o.outstandingMinor) > 0n);
    assert.equal(open.length, 3);
    assert.equal(open.reduce((s, o) => s + BigInt(o.outstandingMinor), 0n).toString(), "64000");
    assert.equal(open.filter((o) => o.overdue).length, 1);
    assert.deepEqual(list.map((o) => o.status).sort(), ["OPEN", "OPEN", "PARTIAL", "SETTLED", "VOID"].sort());
    // Another customer's receivables never enter this customer's totals.
    assert.deepEqual(rows(await summary(off, ext, "acct-b")), [["taylor", "USD", 1, "7000", 0, "0"]]);
  });

  // ── SALES ──
  await t.test("SALES (as deployed): a salesperson and a manager keep self / team, which are INACTIVE -- they read nothing, and are told they are restricted", async () => {
    for (const who of [sp1, mgr]) {
      const r = await summary(off, who, "acct-a");
      assert.deepEqual(r.summaries, [], who.subject);
      assert.equal(r.status, "READY");
      assert.equal(r.restricted, true);
    }
  });

  await t.test("SALES (activated): a salesperson reads only the receivables credited to it, a manager its team's, each inside its company; unattributable rows stay hidden", async () => {
    // Sam (home Taylor): oA1 only -- oA2 is credited e-sp2, oA6 has no Sales Order source, oA3 is settled, oA4 is VOID, and Ventana's oA5 is outside his company.
    const own = await summary(on, sp1, "acct-a");
    assert.deepEqual(rows(own), [["taylor", "USD", 1, "40000", 1, "40000"]]);
    assert.equal(own.restricted, true);
    // Mia (home Taylor) reads her team: Sam's credit (reporting line in force at the Order's creation), not e-sp2's.
    assert.deepEqual(rows(await summary(on, mgr, "acct-a")), [["taylor", "USD", 1, "40000", 1, "40000"]]);
    // e-sp2's credit on another customer is not Sam's, and not Mia's.
    assert.deepEqual(rows(await summary(on, sp1, "acct-b")), []);
    assert.deepEqual(rows(await summary(on, mgr, "acct-b")), []);
  });

  // ── SHAPE ──
  await t.test("SHAPE: five numbers per company and currency and nothing else -- no id of an obligation, settlement, handoff or package", async () => {
    const r = ok(await off(ext, OP, { crmAccountId: "acct-a" }));
    assert.deepEqual(Object.keys(r).sort(), ["asOf", "restricted", "status", "summaries"]);
    assert.ok(!Number.isNaN(Date.parse(r.asOf)));
    for (const s of r.summaries) {
      assert.deepEqual(Object.keys(s).sort(), ["currency", "openReceivableCount", "operatingCompanyId", "outstandingMinor", "overdueCount", "overdueMinor"]);
      assert.equal(typeof s.openReceivableCount, "number");
      assert.equal(typeof s.outstandingMinor, "string");
    }
    const text = JSON.stringify(r);
    const ids = [oA1, oA2, oA3, oA4, oA5, oA6, oB1, oV1, oW1, stlA2, stlA3, "bp-a1", "bp-a5", "so-a1", "so-a5", "acct-a", "SO-A1"];
    for (const id of ids) assert.equal(text.includes(id), false, `the answer carries no ${id}`);
    assert.doesNotMatch(text, /invoice|settlement|handoff|payable|funding|intercompany|counterparty|billingPackage|sourceReference|name/i);
    // A refused or empty answer carries no identifier either.
    assert.equal(JSON.stringify(ok(await off(pmT, OP, { crmAccountId: "acct-v" }))).includes("acct-v"), false);
  });

  // ── WRITE ──
  await t.test("WRITE: the operation writes nothing, and a summary-only holder is refused every Finance command and every workspace read", async () => {
    const tables = ["obligations", "financial_facts", "settlements", "settlement_applications", "accounting_handoffs"];
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (n) => [n, (await q(`SELECT count(*)::int c FROM eos_finance.${n} WHERE tenant_id = $1`, [TENANT])).rows[0].c])));
    const audit = async () => (await q(`SELECT count(*)::int c FROM eos_policy.audit_events WHERE tenant_id = $1`, [TENANT])).rows[0].c;
    const before = [await counts(), await audit()];
    for (const who of [pmT, smV, ext, sp1, mgr, noLink]) { await off(who, OP, { crmAccountId: "acct-a" }); await on(who, OP, { crmAccountId: "acct-a" }); }
    assert.deepEqual([await counts(), await audit()], before, "nothing was written");
    for (const [op, input] of [
      ["recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-a" }, kind: "CUSTOMER_PAYMENT", amountMinor: 1, currency: "USD", sourceReference: "X", idempotencyKey: "a6-x" }],
      ["applySettlement", { settlementId: stlA2, applications: [{ obligationId: oA2, amountMinor: 1 }], idempotencyKey: "a6-y" }],
      ["reverseSettlementApplication", { applicationId: "x", reason: "x", idempotencyKey: "a6-z" }],
      ["voidSettlement", { settlementId: stlA2, reason: "x", idempotencyKey: "a6-v" }],
      ["reconcileSettlement", { settlementId: stlA2, idempotencyKey: "a6-r" }],
    ]) refused(await off(pmT, op, input), 403, "CAPABILITY_REQUIRED", `pmT ${op}`);
    // The Finance workspace reads need a company the summary does NOT give: the summary key opens no list, no detail, no workspace, no overview.
    for (const [op, input] of [["listObligations", { operatingCompanyId: "taylor" }], ["readFinanceWorkspace", { operatingCompanyId: "taylor" }], ["readFinanceOverview", { operatingCompanyId: "taylor" }],
      ["listSettlements", { operatingCompanyId: "taylor" }]]) {
      assert.equal((await off(pmT, op, input)).status, 403, `pmT ${op}`);
    }
    // An id is not readable through the summary key (404 when the Role also holds the flat Finance view, 403 when it does not -- never an answer).
    for (const [op, input] of [["readObligation", { obligationId: oA1 }], ["readSettlement", { settlementId: stlA2 }]]) {
      const res = await off(pmT, op, input);
      assert.ok([403, 404].includes(res.status), `pmT ${op} ${res.status}`);
      assert.notEqual(res.body.ok, true);
    }
  });

  await t.test("GATE: the key is required; the Finance roles and a Role without it are refused; the input is closed and validated", async () => {
    refused(await off(dsp, OP, { crmAccountId: "acct-a" }), 403, "CAPABILITY_REQUIRED", "a dispatcher holds no summary key");
    refused(await off(ctrl, OP, { crmAccountId: "acct-a" }), 403, "CAPABILITY_REQUIRED", "the Controller keeps its full reads; the summary key is not its door");
    refused(await off(pmT, OP, {}), 400, "ACCOUNT_INVALID");
    refused(await off(pmT, OP, { crmAccountId: "  " }), 400, "ACCOUNT_INVALID");
    refused(await off(pmT, OP, { crmAccountId: "acct-a", operatingCompanyId: "ventana" }), 400, "FIELD_NOT_ACCEPTED", "the company is not a caller choice: the server decides the reach");
    refused(await off(pmT, OP, { crmAccountId: "acct-a", limit: 1000 }), 400, "FIELD_NOT_ACCEPTED");
  });
});
