// F-1b, over real PostgreSQL -- governed credits, write-offs, adjustments, refunds and eligible voids of an ISSUED invoice (DECISIONS #F-1b; migration 1764712000000).
// Through the governed transport (/operations/finance), the people being REAL Principals linked to REAL Employees:
//   TWO PEOPLE    every money action (credit, write-off, debit, refund, void) is REQUESTED then APPROVED by a SEPARATE authorized Employee at a $0 threshold: a 1-cent credit is
//                 PENDING until approved; self-approval is refused (same Principal; one Principal holding both keys; a second Principal on the same Employee after a RELINK);
//                 a requester-only holder cannot approve; a non-holder is refused; every refusal leaves the whole state unchanged (a state hash).
//   THE INVOICE   its number, header, lines and totals are exactly as issued after every correction; the correction is its OWN row; OUTSTANDING is read from the receivable
//                 and always equals the invoice's amount due plus the applied adjustments minus what was settled.
//   REFUND        records the refund and its reconciliation only: the application is reversed (the original kept) and re-applied for the remainder, a CUSTOMER_REFUND
//                 DISBURSEMENT RECORD is written, and NOTHING else happens -- no handoff, no payment, no execution path; the kind is not creatable through recordSettlement.
//   VOID          only before any money moves (any application -- even a reversed one -- or any applied adjustment refuses it), with a reason and two people; the number is
//                 kept, never reused; the database itself refuses a void after settlement even for an approved correction.
//   COMPANY       a foreign company reads as nonexistent (identical to missing); a non-holder is refused; both before any write.
//   REPLAY        the same key and request writes nothing; a different request under the key is refused; ONE audit row per applied command.
//   DATABASE      the two-person CHECK, the approved-fact trigger, the origination-reversal guard and the narrow void gate hold on their own.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { assignFinanceCompanies } from "./support/financeCompanyAccess.mjs";
import { seedProtectedOwnerRows } from "./support/protectedOwnerFixture.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../lib/eosFinance/billingPackage.js");
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const financeOps = require("../lib/eosFinance/financeOperations.js");
const fin = require("../lib/eosFinance/financeFoundation.js");
const delivery = require("../lib/eosFinance/accountingDelivery.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-f1b";
const FIN = "/operations/finance";

test("F-1b invoice corrections over PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, pool, call } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "f1b" });
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const count = async (sql, v = []) => Number((await one(sql, v)).n);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body).slice(0, 700)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => { assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body).slice(0, 500)}`); return r.body; };
  const fn = (who, operation, input) => call(who, FIN, operation, input);
  const sys = { tenantId: TENANT, principalId: "finance-system" };
  let sk = 0;
  const key = (k) => `${k}-${++sk}`;
  const YEAR = Number((await one(`SELECT extract(year FROM now() AT TIME ZONE 'UTC')::int AS n`)).n);
  const number = (n) => `INV-${YEAR}-${String(n).padStart(6, "0")}`;
  const businessToday = async (company) => (await one(`SELECT to_char(eos_policy.operating_company_business_date($1,$2,now()),'YYYY-MM-DD') d`, [TENANT, company])).d;
  const plusDays = (day, n) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

  // ── roles: exactly the request keys, exactly the approval keys (so the suite does not depend on which Roles the migration's PROPOSED grants name) ──
  const APPROVE_KEYS = ["finance.adjustment.approve", "finance.refund.approve", "finance.invoice.void.approve"];
  assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key = ANY($1)`, [APPROVE_KEYS]), 3, "migration 1764712000000 registered the three approval capabilities");
  // NO GRANTS (Owner 2026-10-20: "Do not infer refund/void approval merely from existing settlement authority"): after the migration NO Role, Principal or Administration decision names an
  // approval key, so neither a default catalog nor Protected Administrator standing (admin, owner) holds one. The fixtures below grant them INSIDE THIS TEST ONLY.
  assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = ANY($1)`, [APPROVE_KEYS]), 0, "no Role holds an approval key");
  assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = ANY($1)`, [APPROVE_KEYS]), 0, "no Principal holds one directly");
  assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.role_capability_decisions WHERE capability_key = ANY($1)`, [APPROVE_KEYS]), 0);
  assert.deepEqual((await q(`SELECT object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = ANY($1) ORDER BY key`, [APPROVE_KEYS])).rows.map((r) => `${r.object_key}.${r.action_key}.${r.action_kind}`),
    ["invoice.approveAdjustment.BUSINESS_ACTION", "invoice.approveVoid.BUSINESS_ACTION", "payment.approveRefund.BUSINESS_ACTION"]);
  const customRole = async (roleKey, caps) => {
    const made = await admin("createRole", { key: roleKey, name: roleKey, reason: "local test tenant only (F-1b)" });
    assert.equal(made.ok, true, JSON.stringify(made).slice(0, 300));
    for (const cap of caps) {
      await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
               SELECT 'rc_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, 'f1b-test', 'f1b-test', 'f1b-test'
                 FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
               ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, cap]);
    }
    assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id=rc.role_id JOIN eos_policy.capabilities c ON c.id=rc.capability_id
      WHERE r.tenant_id=$1 AND r.key=$2 AND c.key = ANY($3)`, [TENANT, roleKey, caps]), caps.length, `${roleKey} holds exactly what it was given`);
  };
  await customRole("f1bRequester", ["finance.adjustment.record", "finance.refund.record"]);
  await customRole("f1bApprover", APPROVE_KEYS);
  await customRole("f1bAdjApprover", ["finance.adjustment.approve"]);

  // ── people: an issuer, a requester, three approvers, one holding both keys, an approver who is no Employee, company-narrowed ones, a relink pair, non-holders ──
  const ctrl = await person("uid-ctrl", ["controller"], { id: "e-ctrl", name: "Sage Controller" });
  const reqA = await person("uid-reqa", ["f1bRequester"], { id: "e-req-a", name: "Rita Requester" });
  const appA = await person("uid-appa", ["f1bApprover"], { id: "e-app-a", name: "Alan Approver" });
  const appB = await person("uid-appb", ["f1bApprover"], { id: "e-app-b", name: "Beth Approver" });
  const both = await person("uid-both", ["f1bRequester", "f1bApprover"], { id: "e-both", name: "Bo Both" });
  const adjApprover = await person("uid-adjapp", ["f1bAdjApprover"], { id: "e-adj", name: "Adam Adjustments" });
  const appNoEmployee = await person("uid-appnoemp", ["f1bApprover"]);
  const reqV = await person("uid-reqv", ["f1bRequester"], { id: "e-req-v", name: "Vera Requester" });
  const appV = await person("uid-appv", ["f1bApprover"], { id: "e-app-v", name: "Vic Approver" });
  const appT = await person("uid-appt", ["f1bApprover"], { id: "e-app-t", name: "Tara Taylor-only" });
  const reqT = await person("uid-reqt", ["f1bRequester"], { id: "e-req-t", name: "Theo Taylor-only" });
  const rl1 = await person("uid-rl1", ["f1bRequester"], { id: "e-rl", name: "Rey Link" });
  const rl2 = await person("uid-rl2", ["f1bApprover"]);
  const salesP = await person("uid-sales", ["salesperson"], { id: "e-sales", name: "Riley Retail" });
  const techP = await person("uid-tech", ["technician"], { id: "e-tech", name: "Finley Tech", technician: true });
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [ctrl, reqA, appA, appB, both, adjApprover, appNoEmployee, rl1, rl2]);
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [reqV, appV], ["ventana"]);
  await assignFinanceCompanies({ admin, q, tenant: TENANT }, [appT, reqT], ["taylor"]);

  // ── customers, commercial helpers: a direct sale made READY, as F-1a ──
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-a',$1,'Harbor Grill','ACTIVE','f','f'),
           ('acct-b',$1,'Other Diner','ACTIVE','f','f'), ('acct-c',$1,'Third Cafe','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_relationship_types (tenant_id, account_id, relationship_type) VALUES ($1,'acct-a','CUSTOMER'), ($1,'acct-b','CUSTOMER'), ($1,'acct-c','CUSTOMER')`, [TENANT]);
  await q(`INSERT INTO eos_policy.tenant_sales_channels (tenant_id, sales_channel, status, source, established_by, updated_by) VALUES ($1,'RETAIL','ACTIVE','f','f','f') ON CONFLICT DO NOTHING`, [TENANT]);
  const seller = await person("uid-seller", [], { id: "e-seller", name: "Sam Seller" });
  const sellerActor = { tenantId: TENANT, principalId: seller.principalId, capabilities: new Set(["salesAgreement.create", "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]) };
  const deps = { pool, catalog: { async verifyReferences(_db, _t, refs) { return refs.map(() => "FOUND"); } } };
  let gn = 0;
  const directPackage = async ({ account = "acct-a", price = 40000, tax = 0, companyKey = "taylor" } = {}) => {
    const opp = `opp-f1b-${++gn}`;
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, sales_channel, stage, operating_company_key,
               credited_salesperson_employee_id, created_by, updated_by) VALUES ($1,$2,$1,$3,'e-seller','RETAIL','DECISION',$4,'e-seller','f','f')`, [opp, TENANT, account, companyKey]);
    const ag = await sa.createSalesAgreement(deps, sellerActor, { idempotencyKey: `sa-${gn}`, opportunityId: opp, ownerEmployeeId: "e-seller", isLease: false,
      taxEvidence: { status: "DETERMINED", amountMinor: tax, currency: "USD" },
      lines: [{ kind: "SERVICE", ref: "SVC-X", quantity: 1, unitPrice: price, businessUnitId: "SERVICE" }] });
    const agreementId = (ag.result ?? ag).salesAgreementId;
    await sa.acceptSalesAgreement(deps, sellerActor, { idempotencyKey: `acc-${gn}`, salesAgreementId: agreementId });
    const so = `so-f1b-${gn}`;
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, state, sales_channel, currency, sales_agreement_id, created_by, updated_by)
             VALUES ($1,$2,$1,$3,'e-seller',$4,'IN_FULFILLMENT','RETAIL','USD',$5,'f','f')`, [so, TENANT, account, companyKey, agreementId]);
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty, unit_price_minor) VALUES ($1,$2,1,'SERVICE','SVC-X','INSTALLATION',1,$3)`, [TENANT, so, price]);
    await q(`INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind, source_work_order_id, evidence_kind, operating_company_key, operating_company_id, account_id, fulfilled_at, recorded_by)
             VALUES ($1,$2,$3,1,'SERVICE','SVC-X',1,'WORK_ORDER_COMPLETION',$4,'SERVICE_PERFORMED',$5,$5,$6,now(),'f')`, [`ful-${so}`, TENANT, so, `wo-${so}`, companyKey, account]);
    const out = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: so });
    assert.equal(out.status, "READY");
    const obligation = (await one(`SELECT id FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id=$2 AND kind='RECEIVABLE'`, [TENANT, out.packageId]))?.id ?? null;
    return { so, packageId: out.packageId, obligation };
  };
  /** An invoice issued the F-1a way (the issuer is the controller, assigned to both companies), with its receivable. */
  const issued = async (opts = {}) => {
    const p = await directPackage(opts);
    const invoice = ok(await fn(ctrl, "issueInvoice", { billingPackageId: p.packageId, idempotencyKey: key("iss"), dueOn: plusDays(await businessToday(opts.companyKey ?? "taylor"), 30), dueReason: "stated" }), "issue").invoice;
    return { ...p, invoice, account: opts.account ?? "acct-a" };
  };

  // ── the state hash: every table a correction may touch, and the audit rows ──
  const hashOf = async (table, order) => (await one(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY ${order}), '')) h FROM eos_finance.${table} x WHERE x.tenant_id = $1`, [TENANT])).h;
  const state = async () => ({
    invoices: await hashOf("invoices", "x.id"), lines: await hashOf("invoice_lines", "x.id"), corrections: await hashOf("invoice_corrections", "x.id"),
    facts: await hashOf("financial_facts", "x.id"), obligations: await hashOf("obligations", "x.id"), settlements: await hashOf("settlements", "x.id"),
    applications: await hashOf("settlement_applications", "x.id"), handoffs: await hashOf("accounting_handoffs", "x.id"),
    counters: await hashOf("invoice_number_counters", "x.year, x.operating_company_key"),
    audits: await count(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action LIKE 'finance.correction.%'`, [TENANT]),
  });
  const bal = async (obligationId) => {
    const b = await one(`SELECT originated_minor::text o, settled_minor::text s, outstanding_minor::text d, status FROM eos_finance.obligation_balances WHERE tenant_id=$1 AND obligation_id=$2`, [TENANT, obligationId]);
    return { originated: b.o, settled: b.s, outstanding: b.d, status: b.status };
  };
  const invoiceHash = async (invoiceId) => (await one(`SELECT md5(i::text) h FROM eos_finance.invoices i WHERE i.id=$1`, [invoiceId])).h
    + (await one(`SELECT md5(coalesce(string_agg(l::text, '|' ORDER BY l.id), '')) h FROM eos_finance.invoice_lines l WHERE l.invoice_id=$1`, [invoiceId])).h;
  const request = (who, input) => fn(who, "requestInvoiceCorrection", { idempotencyKey: key("req"), ...input });
  const decide = (who, correctionId, decision, over = {}) => fn(who, "decideInvoiceCorrection", { correctionId, decision, reason: "Reviewed against the order", idempotencyKey: key("dec"), ...over });
  const approve = (who, c, over = {}) => decide(who, c.id, "APPROVE", { amountMinor: Number(c.amountMinor), ...over });

  // ═══════════ the main invoice ═══════════
  const A = await issued({ price: 40000, account: "acct-a" });
  assert.equal(A.invoice.invoiceNumber, number(1));
  const A_HASH = await invoiceHash(A.invoice.id);
  let c1;

  await t.test("$0 THRESHOLD: a 1-cent credit is only PENDING -- nothing moves until a separate Employee approves", async () => {
    const before = await state();
    const r = ok(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: A.invoice.id, amountMinor: 1, reason: "Pricing correction" }), "request");
    assert.equal(r.outcome, "requested");
    c1 = r.correction;
    assert.deepEqual([c1.status, c1.kind, c1.amountMinor, c1.currency, c1.invoiceNumber, c1.requestedBy, c1.requestedByEmployeeId, c1.decidedBy],
      ["PENDING", "CREDIT_MEMO", "1", "USD", number(1), reqA.principalId, "e-req-a", null]);
    const after = await state();
    assert.deepEqual([after.facts, after.obligations, after.invoices, after.lines, after.settlements, after.applications, after.handoffs],
      [before.facts, before.obligations, before.invoices, before.lines, before.settlements, before.applications, before.handoffs], "a request moves nothing: no fact, no receivable, no invoice change");
    assert.equal(after.audits, before.audits + 1, "ONE audit row for the applied request");
    assert.deepEqual(await bal(A.obligation), { originated: "40000", settled: "0", outstanding: "40000", status: "OPEN" });
    // $0 is not an amount; a negative or fractional amount is not either
    for (const bad of [0, -5, 1.5]) refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: A.invoice.id, amountMinor: bad, reason: "x" }), 400, "AMOUNT_INVALID");
    assert.deepEqual(await state(), after, "refusals left no trace");
  });

  await t.test("SEPARATE APPROVER REQUIRED: non-holders, a requester-only holder, self-approval (one Principal holding both keys), a RELINKED Employee and an approver who is no Employee are all refused with zero trace", async () => {
    for (const who of [salesP, techP]) {
      refused(await request(who, { kind: "CREDIT_MEMO", invoiceId: A.invoice.id, amountMinor: 1, reason: "x" }), 403, "CAPABILITY_REQUIRED", "request by a non-holder");
      refused(await decide(who, c1.id, "APPROVE", { amountMinor: 1 }), 403, "CAPABILITY_REQUIRED", "decision by a non-holder");
    }
    // the requester-only holder holds the RECORD keys, not the approval key; an approval key is not a request key
    refused(await decide(reqA, c1.id, "APPROVE", { amountMinor: 1 }), 403, "CAPABILITY_REQUIRED", "requester-only holder");
    refused(await decide(reqA, c1.id, "REJECT"), 403, "CAPABILITY_REQUIRED", "a requester rejects nothing: she withdraws");
    refused(await request(appA, { kind: "CREDIT_MEMO", invoiceId: A.invoice.id, amountMinor: 1, reason: "x" }), 403, "CAPABILITY_REQUIRED", "approver-only holder requests");
    // nothing is inferred from existing Finance authority: a controller (settlement keys, record keys, issue key) holds no approval key
    refused(await decide(ctrl, c1.id, "APPROVE", { amountMinor: 1 }), 403, "CAPABILITY_REQUIRED", "settlement authority is not approval authority");
    // one Principal holding BOTH keys (the Owner's stand-in: the Owner requests, then the Owner approves) cannot approve (or reject) the request of the same Employee
    const own = ok(await request(both, { kind: "CREDIT_MEMO", invoiceId: A.invoice.id, amountMinor: 2, reason: "Own request" }), "own").correction;
    const s1 = await state();
    refused(await decide(both, own.id, "APPROVE", { amountMinor: 2 }), 412, "SELF_APPROVAL_FORBIDDEN", "same Principal");
    refused(await decide(both, own.id, "REJECT"), 412, "SELF_APPROVAL_FORBIDDEN", "same Principal rejecting");
    assert.deepEqual(await state(), s1, "zero trace: no mutation, no fact, no audit entry claiming a completed action");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action IN ('finance.correction.approve','finance.correction.reject') AND target_id=$2`, [TENANT, own.id]), 0);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, own.id]), 0);
    // an approver who is not an Employee: two people need two Employees
    refused(await decide(appNoEmployee, c1.id, "APPROVE", { amountMinor: 1 }), 412, "APPROVER_EMPLOYEE_REQUIRED");
    assert.deepEqual(await state(), s1, "zero trace");
    // RELINK: Rey requests; the same human (Employee e-rl) is moved to a NEW Principal, who holds the approval key -- still the same Employee
    const viaRl = ok(await request(rl1, { kind: "CREDIT_MEMO", invoiceId: A.invoice.id, amountMinor: 3, reason: "Relink case" }), "rl request").correction;
    assert.equal(viaRl.requestedByEmployeeId, "e-rl");
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE tenant_id=$1 AND principal_id=$2 AND status='active'`, [TENANT, rl1.principalId]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ('lnk-e-rl-2',$1,$2,'e-rl','taylor','OPERATOR_ASSERTED','active','fixture','relinked the same human')`, [TENANT, rl2.principalId]);
    const s2 = await state();
    refused(await decide(rl2, viaRl.id, "APPROVE", { amountMinor: 3 }), 412, "SELF_APPROVAL_FORBIDDEN", "a second Principal on the SAME Employee after a relink");
    assert.deepEqual(await state(), s2, "zero trace");
    // company: an approver assigned to Ventana only reads this Taylor correction as nonexistent
    refused(await decide(appV, c1.id, "APPROVE", { amountMinor: 1 }), 404, "CORRECTION_NOT_FOUND", "foreign-company approver");
    // the amount approved is the amount requested, and every decision states its reason
    refused(await decide(appA, c1.id, "APPROVE", { amountMinor: 2 }), 412, "APPROVAL_AMOUNT_MISMATCH");
    refused(await decide(appA, c1.id, "APPROVE", { amountMinor: 1, reason: " " }), 400, "REASON_REQUIRED");
    assert.deepEqual(await state(), s2, "no refusal wrote anything");
    assert.equal((await one(`SELECT status FROM eos_finance.invoice_corrections WHERE id=$1`, [c1.id])).status, "PENDING");
    // clean up the two probes so later totals stay legible
    ok(await decide(appA, own.id, "REJECT", { reason: "Probe" }), "reject own");
    ok(await decide(appA, viaRl.id, "REJECT", { reason: "Probe" }), "reject relink");
  });

  await t.test("APPROVED by a separate Employee: the credit moves the receivable only; the invoice (number, header, lines, totals) is exactly as issued; ONE audit row; replay writes nothing", async () => {
    const before = await state();
    const decided = ok(await approve(appA, c1, { idempotencyKey: "dec-c1" }), "approve");
    assert.equal(decided.outcome, "applied");
    const c = decided.correction;
    assert.deepEqual([c.status, c.decidedBy, c.decidedByEmployeeId, c.requestedByEmployeeId, c.decisionReason], ["APPLIED", appA.principalId, "e-app-a", "e-req-a", "Reviewed against the order"]);
    assert.notEqual(c.decidedByEmployeeId, c.requestedByEmployeeId);
    assert.ok(c.factId, "the adjustment fact is recorded on the correction");
    assert.deepEqual(await bal(A.obligation), { originated: "39999", settled: "0", outstanding: "39999", status: "OPEN" }, "outstanding is read from the receivable and reflects the credit");
    const fact = await one(`SELECT fact_class, fact_type, amount_minor::text a, source_domain, source_record_id FROM eos_finance.financial_facts WHERE id=$1`, [c.factId]);
    assert.deepEqual([fact.fact_class, fact.fact_type, fact.a, fact.source_domain, fact.source_record_id], ["OBLIGATION", "RECEIVABLE_CREDITED", "-1", "INVOICE_CORRECTION", c1.id]);
    assert.equal(await invoiceHash(A.invoice.id), A_HASH, "the issued invoice and its lines are untouched");
    const totals = await one(`SELECT total_minor::text t, amount_due_minor::text d, is_void FROM eos_finance.invoice_totals WHERE invoice_id=$1`, [A.invoice.id]);
    assert.deepEqual([totals.t, totals.d, totals.is_void], ["40000", "40000", false], "the invoice states what it ORIGINALLY billed");
    assert.equal((await one(`SELECT invoice_number FROM eos_finance.invoices WHERE id=$1`, [A.invoice.id])).invoice_number, number(1), "the number is preserved");
    const after = await state();
    assert.equal(after.audits, before.audits + 1, "ONE audit row for the applied approval");
    const audit = await one(`SELECT actor_uid, target_kind, before, after, reason FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='finance.correction.approve' AND target_id=$2`, [TENANT, c1.id]);
    assert.deepEqual([audit.actor_uid, audit.target_kind, audit.before.status, audit.after.status, audit.after.requestedByEmployeeId, audit.after.decidedByEmployeeId, audit.reason],
      [appA.principalId, "invoice_correction", "PENDING", "APPLIED", "e-req-a", "e-app-a", "Reviewed against the order"]);
    assert.deepEqual(Object.keys(audit.after).filter((k) => /notes|description|instructions|comment/i.test(k)), [], "no free text beyond the governed reason");
    // REPLAY: same approver, same key and request -> the stored answer, nothing written
    const replay = ok(await approve(appA, c1, { idempotencyKey: "dec-c1" }), "replay");
    assert.equal(replay.outcome, "replayed");
    assert.deepEqual(await state(), after, "a replay writes nothing: no fact, no row, no audit");
    refused(await approve(appA, c1, { idempotencyKey: "dec-c1", reason: "A different decision" }), 409, "IDEMPOTENCY_KEY_REUSED");
    refused(await approve(appB, c1), 409, "CORRECTION_NOT_PENDING", "another approver finds it already decided");
    refused(await approve(appA, c1, { idempotencyKey: key("again") }), 409, "CORRECTION_NOT_PENDING");
    assert.deepEqual(await state(), after, "neither refusal left a trace");
  });

  await t.test("REQUEST REPLAY: the same key and request writes nothing; the same key with another request is refused; a foreign company and a missing invoice read alike", async () => {
    const input = { kind: "WRITE_OFF", invoiceId: A.invoice.id, amountMinor: 7, reason: "Uncollectible remainder", idempotencyKey: "req-wo-1" };
    const first = ok(await fn(reqA, "requestInvoiceCorrection", input), "first");
    const before = await state();
    const again = ok(await fn(reqA, "requestInvoiceCorrection", input), "again");
    assert.deepEqual([again.outcome, again.correction.id], ["replayed", first.correction.id]);
    assert.deepEqual(await state(), before);
    refused(await fn(reqA, "requestInvoiceCorrection", { ...input, amountMinor: 8 }), 409, "IDEMPOTENCY_KEY_REUSED");
    assert.deepEqual(await state(), before);
    ok(await decide(appA, first.correction.id, "REJECT", { reason: "Not needed" }), "reject");
    // foreign / missing
    const V = await issued({ price: 1000, companyKey: "ventana", account: "acct-b" });
    const mine = await state();
    const missing = refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: "inv-does-not-exist", amountMinor: 1, reason: "x" }), 404, "INVOICE_NOT_FOUND");
    const foreign = refused(await request(reqT, { kind: "CREDIT_MEMO", invoiceId: V.invoice.id, amountMinor: 1, reason: "x" }), 404, "INVOICE_NOT_FOUND", "Ventana invoice, Taylor-only requester");
    assert.equal(foreign.message, missing.message, "a foreign company reads exactly like a missing invoice");
    assert.deepEqual(await state(), mine, "neither wrote");
  });

  await t.test("EVERY MONEY ACTION needs a separate approver: write-off, debit, credit above outstanding refused, REJECT and WITHDRAW paths; outstanding always equals the invoice amount plus the applied adjustments", async () => {
    const B = await issued({ price: 10000, account: "acct-b" });
    const B_HASH = await invoiceHash(B.invoice.id);
    const s0 = await state();
    refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: B.invoice.id, amountMinor: 10001, reason: "too much" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    refused(await request(reqA, { kind: "WRITE_OFF", invoiceId: B.invoice.id, amountMinor: 10001, reason: "too much" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    assert.deepEqual(await state(), s0);
    // write-off (the both-holder cannot approve her own)
    const wo = ok(await request(both, { kind: "WRITE_OFF", invoiceId: B.invoice.id, amountMinor: 2500, reason: "Small balance write-off" }), "wo").correction;
    refused(await decide(both, wo.id, "APPROVE", { amountMinor: 2500 }), 412, "SELF_APPROVAL_FORBIDDEN");
    assert.deepEqual(await bal(B.obligation), { originated: "10000", settled: "0", outstanding: "10000", status: "OPEN" }, "not applied");
    const woDone = ok(await approve(appA, wo), "approve wo").correction;
    assert.equal(woDone.status, "APPLIED");
    assert.equal((await one(`SELECT fact_type FROM eos_finance.financial_facts WHERE id=$1`, [woDone.factId])).fact_type, "RECEIVABLE_WRITTEN_OFF");
    assert.deepEqual(await bal(B.obligation), { originated: "7500", settled: "0", outstanding: "7500", status: "OPEN" });
    // debit charge (positive); the requester cannot decide it
    const dc = ok(await request(reqA, { kind: "DEBIT_CHARGE", invoiceId: B.invoice.id, amountMinor: 400, reason: "Late fee per terms" }), "dc").correction;
    refused(await decide(reqA, dc.id, "APPROVE", { amountMinor: 400 }), 403, "CAPABILITY_REQUIRED");
    ok(await approve(appB, dc), "approve dc");
    assert.deepEqual(await bal(B.obligation), { originated: "7900", settled: "0", outstanding: "7900", status: "OPEN" });
    refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: B.invoice.id, amountMinor: 7901, reason: "too much" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    // two pending credits whose SUM exceeds outstanding: the second APPROVAL is refused (eligibility is re-decided under the lock)
    const p1 = ok(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: B.invoice.id, amountMinor: 5000, reason: "First credit" }), "p1").correction;
    const p2 = ok(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: B.invoice.id, amountMinor: 5000, reason: "Second credit" }), "p2").correction;
    ok(await approve(appA, p1), "approve p1");
    const mid = await state();
    refused(await approve(appA, p2), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    assert.deepEqual(await state(), mid, "the refused approval wrote nothing; p2 is still PENDING");
    assert.equal((await one(`SELECT status FROM eos_finance.invoice_corrections WHERE id=$1`, [p2.id])).status, "PENDING");
    // REJECT by a separate person; a rejected correction is terminal
    ok(await decide(appA, p2.id, "REJECT", { reason: "Exceeds what is owed" }), "reject");
    refused(await approve(appB, p2), 409, "CORRECTION_NOT_PENDING", "a rejected correction is terminal");
    // WITHDRAW is the requester's own, with the request key
    const w = ok(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: B.invoice.id, amountMinor: 100, reason: "Withdrawn later" }), "w").correction;
    refused(await decide(appA, w.id, "WITHDRAW", { reason: "not mine" }), 403, "CAPABILITY_REQUIRED", "an approver holds no request key to withdraw with");
    refused(await decide(both, w.id, "WITHDRAW", { reason: "not mine" }), 412, "WITHDRAW_BY_REQUESTER_ONLY");
    const wd = ok(await decide(reqA, w.id, "WITHDRAW", { reason: "Entered in error" }), "withdraw").correction;
    assert.deepEqual([wd.status, wd.decidedBy], ["WITHDRAWN", reqA.principalId]);
    // the invariant: the invoice states what it originally billed; the receivable = that + applied adjustments - settled
    assert.equal(await invoiceHash(B.invoice.id), B_HASH, "the invoice is untouched by the corrections");
    const inv = await one(`SELECT t.amount_due_minor::text due, b.outstanding_minor::text out,
        (SELECT COALESCE(sum(f.amount_minor),0)::text FROM eos_finance.financial_facts f WHERE f.tenant_id=t.tenant_id AND f.obligation_id=b.obligation_id
          AND f.fact_type IN ('RECEIVABLE_CREDITED','RECEIVABLE_CHARGED','RECEIVABLE_WRITTEN_OFF')) adj
      FROM eos_finance.invoice_totals t JOIN eos_finance.obligation_balances b ON b.tenant_id=t.tenant_id AND b.obligation_id=$2 WHERE t.invoice_id=$1`, [B.invoice.id, B.obligation]);
    assert.equal(BigInt(inv.out), BigInt(inv.due) + BigInt(inv.adj), "invoice and obligation never diverge: outstanding = amount due + adjustments - settled (0)");
    // a credit to nothing settles the receivable: it owes nothing and shows as SETTLED, not OPEN
    const rest = ok(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: B.invoice.id, amountMinor: 2900, reason: "Remainder credited" }), "rest").correction;
    ok(await approve(appA, rest), "approve rest");
    assert.deepEqual(await bal(B.obligation), { originated: "0", settled: "0", outstanding: "0", status: "SETTLED" });
    refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: B.invoice.id, amountMinor: 1, reason: "nothing left" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    // ONE audit row per applied command on this invoice: 6 requests, 4 approvals, 1 rejection, 1 withdrawal (the refusals wrote none)
    const rows = (await q(`SELECT action, count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action LIKE 'finance.correction.%'
        AND target_id IN (SELECT id FROM eos_finance.invoice_corrections WHERE invoice_id=$2) GROUP BY action ORDER BY action`, [TENANT, B.invoice.id])).rows;
    assert.deepEqual(rows.map((r) => [r.action, r.n]), [["finance.correction.approve", 4], ["finance.correction.reject", 1], ["finance.correction.request", 6], ["finance.correction.withdraw", 1]]);
  });

  await t.test("REFUND records only: the application is reversed and re-applied for the remainder, a CUSTOMER_REFUND disbursement RECORD is written, nothing is paid or queued, and the kind cannot be created any other way", async () => {
    const R = await issued({ price: 20000, account: "acct-c" });
    const pay = ok(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-c" }, kind: "CUSTOMER_PAYMENT",
      amountMinor: 20000, currency: "USD", sourceReference: "CHK-F1B", idempotencyKey: key("stl") }), "pay").settlement;
    ok(await fn(ctrl, "applySettlement", { settlementId: pay.id, applications: [{ obligationId: R.obligation, amountMinor: 20000 }], idempotencyKey: key("app") }), "apply");
    const appRow = await one(`SELECT id FROM eos_finance.settlement_applications WHERE tenant_id=$1 AND settlement_id=$2 AND status='APPLIED'`, [TENANT, pay.id]);
    assert.deepEqual(await bal(R.obligation), { originated: "20000", settled: "20000", outstanding: "0", status: "SETTLED" });
    const R_HASH = await invoiceHash(R.invoice.id);
    // the refund names an application of THIS invoice, for no more than was applied
    const before = await state();
    refused(await request(reqA, { kind: "REFUND", invoiceId: R.invoice.id, amountMinor: 20001, applicationId: appRow.id, reason: "too much" }), 412, "REFUND_EXCEEDS_APPLIED");
    refused(await request(reqA, { kind: "REFUND", invoiceId: R.invoice.id, amountMinor: 100, applicationId: "sap-nope", reason: "x" }), 404, "APPLICATION_NOT_FOUND");
    refused(await request(reqA, { kind: "REFUND", invoiceId: A.invoice.id, amountMinor: 100, applicationId: appRow.id, reason: "another invoice's application" }), 404, "APPLICATION_NOT_FOUND");
    refused(await request(reqA, { kind: "REFUND", invoiceId: R.invoice.id, amountMinor: 100, reason: "x" }), 400, "APPLICATION_ID_REQUIRED");
    assert.deepEqual(await state(), before, "refusals left no trace");
    const rq = ok(await request(reqA, { kind: "REFUND", invoiceId: R.invoice.id, amountMinor: 8000, applicationId: appRow.id, reason: "Customer returned the unit" }), "refund request").correction;
    assert.deepEqual([rq.status, rq.settlementId, rq.applicationId, rq.refundRecordId], ["PENDING", pay.id, appRow.id, null]);
    assert.deepEqual(await bal(R.obligation), { originated: "20000", settled: "20000", outstanding: "0", status: "SETTLED" }, "a request refunds nothing");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.settlements WHERE tenant_id=$1 AND kind='CUSTOMER_REFUND'`, [TENANT]), 0);
    // the adjustment approval key does not approve a refund; the requester cannot; the refund approval key of a separate Employee can
    refused(await decide(adjApprover, rq.id, "APPROVE", { amountMinor: 8000 }), 403, "CAPABILITY_REQUIRED", "finance.adjustment.approve does not approve a refund");
    refused(await decide(reqA, rq.id, "APPROVE", { amountMinor: 8000 }), 403, "CAPABILITY_REQUIRED", "the requester");
    refused(await decide(appB, rq.id, "APPROVE", { amountMinor: 7999 }), 412, "APPROVAL_AMOUNT_MISMATCH");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.settlements WHERE tenant_id=$1 AND kind='CUSTOMER_REFUND'`, [TENANT]), 0);

    const handoffs = await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoffs WHERE tenant_id=$1`, [TENANT]);
    const attempts = await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoff_attempts WHERE tenant_id=$1`, [TENANT]);
    const refundResult = ok(await decide(appB, rq.id, "APPROVE", { amountMinor: 8000, reason: "Return verified" }), "approve refund");
    const done = refundResult.correction;
    assert.equal(done.status, "APPLIED");
    assert.ok(done.refundRecordId);
    // A refund record is an accounting fact, NOT evidence that cash was sent: the API says so.
    assert.deepEqual([refundResult.refundRecorded, refundResult.notice, done.refundRecorded], [true, "refund recorded; no payment has been sent", true]);
    assert.equal((await one(`SELECT refunded_minor::text r FROM eos_finance.settlement_balances WHERE settlement_id=$1`, [pay.id])).r, "8000");
    const viaRead = ok(await fn(ctrl, "readSettlement", { settlementId: pay.id }), "read settlement");
    assert.deepEqual([viaRead.appliedMinor, viaRead.refundedMinor, viaRead.unappliedMinor], ["12000", "8000", "0"], "readSettlement reports refundedMinor (F6)");
    const refund = await one(`SELECT kind, direction, amount_minor::text a, currency, status, method, correlation_id, notes, recorded_by FROM eos_finance.settlements WHERE id=$1`, [done.refundRecordId]);
    assert.deepEqual([refund.kind, refund.direction, refund.a, refund.currency, refund.status, refund.method, refund.correlation_id, refund.notes, refund.recorded_by],
      ["CUSTOMER_REFUND", "DISBURSEMENT", "8000", "USD", "RECORDED", null, null, null, appB.principalId], "a record: no method, no instruction, nothing to execute");
    // the original application is kept (REVERSED) and the remainder is applied again
    const apps = (await q(`SELECT id, status, amount_minor::text a FROM eos_finance.settlement_applications WHERE tenant_id=$1 AND settlement_id=$2`, [TENANT, pay.id])).rows;
    assert.deepEqual(apps.map((a) => `${a.status}:${a.a}`).sort(), ["APPLIED:12000", "REVERSED:20000"]);
    assert.equal(apps.find((a) => a.id === appRow.id).status, "REVERSED", "the original is kept, reversed");
    assert.deepEqual(await bal(R.obligation), { originated: "20000", settled: "12000", outstanding: "8000", status: "PARTIAL" }, "the receivable reopens by the refund");
    const sb = await one(`SELECT applied_minor::text ap, refunded_minor::text rf, unapplied_minor::text un FROM eos_finance.settlement_balances WHERE settlement_id=$1`, [pay.id]);
    assert.deepEqual([sb.ap, sb.rf, sb.un], ["12000", "8000", "0"], "the payment: 12000 applied + 8000 refunded = 20000; nothing left to apply");
    const rb = await one(`SELECT applied_minor::text ap, unapplied_minor::text un FROM eos_finance.settlement_balances WHERE settlement_id=$1`, [done.refundRecordId]);
    assert.deepEqual([rb.ap, rb.un], ["0", "0"], "a refund record is never an unapplied exception");
    assert.equal(await invoiceHash(R.invoice.id), R_HASH, "the invoice is untouched");
    // NO external payment: no handoff, no delivery attempt, no disbursement but the record itself
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoffs WHERE tenant_id=$1`, [TENANT]), handoffs);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoff_attempts WHERE tenant_id=$1`, [TENANT]), attempts);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.settlements WHERE tenant_id=$1 AND direction='DISBURSEMENT'`, [TENANT]), 1, "the one disbursement is the refund record");
    const ws = ok(await fn(ctrl, "readFinanceWorkspace", { operatingCompanyId: "taylor" }), "workspace");
    const unapplied = Array.isArray(ws.unappliedSettlements) ? ws.unappliedSettlements : ws.unappliedSettlements.items;
    assert.ok(!unapplied.some((s) => s.id === done.refundRecordId), "the workspace shows no unapplied exception for the record");
    // the record is reconciled like any settlement (evidence), never voided, applies to nothing; recordSettlement cannot make one
    const rec = ok(await fn(ctrl, "reconcileSettlement", { settlementId: done.refundRecordId, externalReference: "BANK-REF-1", externalAmountMinor: 8000, idempotencyKey: key("rec") }), "reconcile");
    assert.equal(rec.reconciliation.outcome, "RECONCILED");
    // the settlement read of the record never reads as cash out
    const rr = ok(await fn(ctrl, "readSettlement", { settlementId: done.refundRecordId }), "read refund record");
    assert.deepEqual([rr.kind, rr.refundRecorded, rr.notice, rr.direction, rr.ledgerDirection], ["CUSTOMER_REFUND", true, "refund recorded; no payment has been sent", "REFUND_RECORD", "DISBURSEMENT"]);
    refused(await fn(ctrl, "voidSettlement", { settlementId: done.refundRecordId, reason: "undo" }), 409, "SETTLEMENT_REFUND_RECORD");
    refused(await fn(ctrl, "applySettlement", { settlementId: done.refundRecordId, applications: [{ obligationId: R.obligation, amountMinor: 1 }], idempotencyKey: key("app") }), 409, "SETTLEMENT_KIND_MISMATCH");
    refused(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-c" }, kind: "CUSTOMER_REFUND",
      amountMinor: 100, currency: "USD", sourceReference: "X", idempotencyKey: key("stl") }), 400, "SETTLEMENT_KIND_INVALID");
    // the refunded money is no longer there to apply again
    refused(await fn(ctrl, "applySettlement", { settlementId: pay.id, applications: [{ obligationId: R.obligation, amountMinor: 1 }], idempotencyKey: key("app") }), 409, "SETTLEMENT_OVER_APPLIED");
    // a payment with a recorded refund is not voided (even after its applications are reversed)
    const live = (await one(`SELECT id FROM eos_finance.settlement_applications WHERE tenant_id=$1 AND settlement_id=$2 AND status='APPLIED'`, [TENANT, pay.id])).id;
    ok(await fn(ctrl, "reverseSettlementApplication", { applicationId: live, reason: "unwind", idempotencyKey: key("rev") }), "reverse");
    refused(await fn(ctrl, "voidSettlement", { settlementId: pay.id, reason: "undo" }), 409, "SETTLEMENT_HAS_REFUNDS");
    // a refunded invoice cannot be voided: money moved
    refused(await request(reqA, { kind: "VOID", invoiceId: R.invoice.id, reason: "after refund" }), 412, "VOID_AFTER_SETTLEMENT");
    // a refunded payment's application is only refundable once: the reversed original is not
    refused(await request(reqA, { kind: "REFUND", invoiceId: R.invoice.id, amountMinor: 1, applicationId: appRow.id, reason: "again" }), 412, "APPLICATION_NOT_APPLIED");
  });

  await t.test("VOID: only before any settlement or adjustment is applied, with a reason and two people; the number is kept and never reused", async () => {
    const V1 = await issued({ price: 3000, account: "acct-a" });
    const V1_NUMBER = V1.invoice.invoiceNumber;
    const reqd = ok(await request(reqA, { kind: "VOID", invoiceId: V1.invoice.id, reason: "Billed to the wrong customer" }), "void request").correction;
    assert.equal(reqd.amountMinor, "3000", "a void is of the whole invoice");
    assert.deepEqual(await bal(V1.obligation), { originated: "3000", settled: "0", outstanding: "3000", status: "OPEN" }, "a request voids nothing");
    refused(await request(reqA, { kind: "VOID", invoiceId: V1.invoice.id, reason: "again" }), 409, "VOID_ALREADY_REQUESTED", "one void request per invoice");
    // the void approval key, not the adjustment approval key; the requester cannot
    refused(await decide(adjApprover, reqd.id, "APPROVE", { amountMinor: 3000 }), 403, "CAPABILITY_REQUIRED", "finance.adjustment.approve does not approve a void");
    refused(await decide(reqA, reqd.id, "APPROVE", { amountMinor: 3000 }), 403, "CAPABILITY_REQUIRED");
    const before = await state();
    refused(await decide(appA, reqd.id, "APPROVE", { amountMinor: 2999 }), 412, "APPROVAL_AMOUNT_MISMATCH");
    assert.deepEqual(await state(), before);
    // a separate Employee approves: the invoice and its receivable are voided together; the number stays
    const originalOf = async (id) => ({
      header: (await one(`SELECT to_jsonb(i) - 'voided_at' - 'void_reason' - 'voided_by' AS j FROM eos_finance.invoices i WHERE i.id=$1`, [id])).j,
      lines: (await one(`SELECT md5(coalesce(string_agg(l::text, '|' ORDER BY l.id), '')) h FROM eos_finance.invoice_lines l WHERE l.invoice_id=$1`, [id])).h,
      totals: (await one(`SELECT total_minor::text t, amount_due_minor::text d, line_count::int n FROM eos_finance.invoice_totals WHERE invoice_id=$1`, [id])),
    });
    const V1_ORIGINAL = await originalOf(V1.invoice.id);
    const done = ok(await approve(appA, reqd), "void approve").correction;
    assert.equal(done.status, "APPLIED");
    assert.deepEqual(await originalOf(V1.invoice.id), V1_ORIGINAL, "the void workflow cannot change the original invoice: header (number, amounts, currency, dates), lines and totals are exactly as issued; only the three void columns moved");
    const inv = await one(`SELECT invoice_number, voided_at, void_reason, voided_by FROM eos_finance.invoices WHERE id=$1`, [V1.invoice.id]);
    assert.deepEqual([inv.invoice_number, inv.voided_at !== null, inv.void_reason, inv.voided_by], [V1_NUMBER, true, "Billed to the wrong customer", appA.principalId], "the original number and history are preserved");
    assert.equal((await bal(V1.obligation)).status, "VOID");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id=$2 AND reverses_fact_id IS NOT NULL`, [TENANT, V1.obligation]), 1,
      "the origination is reversed by a fact, never edited");
    refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: V1.invoice.id, amountMinor: 1, reason: "x" }), 412, "INVOICE_VOID");
    // F3: the void does not dead-end rebilling. The package is RETIRED with the invoice (not READY over a VOID receivable), the Billing Queue does not offer it, and a re-prepare of
    // the SAME Sales Order -- identical content -- produces a NEW package, a new receivable and a new invoice under a NEW number; the voided invoice keeps its own.
    assert.equal((await one(`SELECT status FROM eos_finance.billing_packages WHERE id=$1`, [V1.packageId])).status, "SUPERSEDED", "the voided invoice's package is retired");
    const queue1 = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE", invoiced: false }), "queue").items;
    assert.ok(!queue1.some((o) => o.id === V1.obligation), "the Billing Queue does not offer the voided sale's retired receivable");
    const again = await pkg.prepareBillingPackage(pool, sys, { salesOrderId: V1.so });
    assert.notEqual(again.packageId, V1.packageId, "a re-prepare of the same order produces a NEW package even with identical content");
    assert.deepEqual([again.status, again.version], ["READY", 2]);
    assert.equal((await one(`SELECT supersedes_package_id FROM eos_finance.billing_packages WHERE id=$1`, [again.packageId])).supersedes_package_id, V1.packageId);
    const newObligation = (await one(`SELECT id FROM eos_finance.obligations WHERE tenant_id=$1 AND source_record_id=$2 AND kind='RECEIVABLE'`, [TENANT, again.packageId])).id;
    assert.notEqual(newObligation, V1.obligation);
    const queue2 = ok(await fn(ctrl, "listObligations", { operatingCompanyId: "taylor", kind: "RECEIVABLE", invoiced: false }), "queue 2").items;
    assert.ok(queue2.some((o) => o.id === newObligation), "the corrected billing is offered");
    const rebilled = ok(await fn(ctrl, "issueInvoice", { billingPackageId: again.packageId, idempotencyKey: key("iss"), dueOn: plusDays(await businessToday("taylor"), 30), dueReason: "stated" }), "rebill issue").invoice;
    assert.notEqual(rebilled.invoiceNumber, V1_NUMBER, "a new invoice, a new number");
    assert.equal((await one(`SELECT invoice_number, voided_at IS NOT NULL AS v FROM eos_finance.invoices WHERE id=$1`, [V1.invoice.id])).invoice_number, V1_NUMBER, "the voided invoice keeps its number");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1 AND sales_order_id=$2`, [TENANT, V1.so]), 2);
    // the number is never reused: the next invoice takes the next number
    const next = await issued({ price: 500, account: "acct-a" });
    assert.notEqual(next.invoice.invoiceNumber, V1_NUMBER);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoices WHERE tenant_id=$1 AND invoice_number=$2`, [TENANT, V1_NUMBER]), 1);
    // after a SETTLEMENT (even one later reversed) a void is refused
    const V2 = await issued({ price: 4000, account: "acct-b" });
    const pay = ok(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-b" }, kind: "CUSTOMER_PAYMENT",
      amountMinor: 100, currency: "USD", sourceReference: "CHK-V2", idempotencyKey: key("stl") }), "pay").settlement;
    ok(await fn(ctrl, "applySettlement", { settlementId: pay.id, applications: [{ obligationId: V2.obligation, amountMinor: 100 }], idempotencyKey: key("app") }), "apply");
    const s0 = await state();
    refused(await request(reqA, { kind: "VOID", invoiceId: V2.invoice.id, reason: "after payment" }), 412, "VOID_AFTER_SETTLEMENT");
    assert.deepEqual(await state(), s0, "zero trace");
    const appId = (await one(`SELECT id FROM eos_finance.settlement_applications WHERE tenant_id=$1 AND settlement_id=$2`, [TENANT, pay.id])).id;
    ok(await fn(ctrl, "reverseSettlementApplication", { applicationId: appId, reason: "unwind", idempotencyKey: key("rev") }), "reverse");
    refused(await request(reqA, { kind: "VOID", invoiceId: V2.invoice.id, reason: "after a reversed payment" }), 412, "VOID_AFTER_SETTLEMENT", "a reversed application still means money moved");
    // after an APPLIED ADJUSTMENT a void is refused (the credit path applies)
    const V3 = await issued({ price: 900, account: "acct-b" });
    const cr = ok(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: V3.invoice.id, amountMinor: 10, reason: "Goodwill" }), "credit").correction;
    ok(await approve(appA, cr), "credit approve");
    refused(await request(reqA, { kind: "VOID", invoiceId: V3.invoice.id, reason: "after a credit" }), 412, "VOID_AFTER_ADJUSTMENT");
    // a void PENDING when a credit lands is refused at APPROVAL (eligibility is re-decided)
    const V4 = await issued({ price: 800, account: "acct-b" });
    const pv = ok(await request(reqA, { kind: "VOID", invoiceId: V4.invoice.id, reason: "Duplicate" }), "pv").correction;
    const cr4 = ok(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: V4.invoice.id, amountMinor: 5, reason: "Goodwill" }), "cr4").correction;
    ok(await approve(appA, cr4), "cr4 approve");
    refused(await approve(appB, pv), 412, "VOID_AFTER_ADJUSTMENT");
    assert.notEqual((await bal(V4.obligation)).status, "VOID");
  });

  await t.test("B1: delivery to accounting is anchored on the receivable AS ISSUED: an approved credit, debit and write-off never strand the original invoice", async () => {
    await fin.configureAccountingDestination(pool, sys, { operatingCompanyId: "taylor", displayName: "F1B test ledger", providerKey: "f1b-test-ledger", externalCompanyRef: "F1B-TEST", activate: true });
    const X = await issued({ price: 7000, account: "acct-a" });
    await pkg.refreshAccountingHandoffs(pool, sys);
    const handoffId = (await one(`SELECT id FROM eos_finance.accounting_handoffs WHERE tenant_id=$1 AND billing_package_id=$2`, [TENANT, X.packageId])).id;
    const before = await delivery.buildAccountingPayload(pool, TENANT, handoffId);
    assert.equal(before.payload.receivable.amountMinor, "7000");
    for (const [kind, amountMinor] of [["CREDIT_MEMO", 700], ["DEBIT_CHARGE", 300], ["WRITE_OFF", 200]]) {
      const c = ok(await request(reqA, { kind, invoiceId: X.invoice.id, amountMinor, reason: `${kind} after issue` }), kind).correction;
      ok(await approve(appA, c), `${kind} approve`);
    }
    assert.deepEqual(await bal(X.obligation), { originated: "6400", settled: "0", outstanding: "6400", status: "OPEN" }, "the receivable is adjusted: 7000 - 700 + 300 - 200");
    const after = await delivery.buildAccountingPayload(pool, TENANT, handoffId);
    assert.equal(after.payload.receivable.amountMinor, "7000", "delivery still anchors on the receivable as issued (not PAYLOAD_RECEIVABLE_MISMATCH)");
    assert.equal(after.payload.billingPackage.amounts.totalMinor, "7000");
    assert.equal(after.fingerprint, before.fingerprint, "the original invoice's delivery payload is exactly what it was before any correction");
  });

  /** A payment recorded and applied to an invoice's receivable. */
  const pay = async (X, amount, ref) => {
    const s = ok(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: X.account }, kind: "CUSTOMER_PAYMENT",
      amountMinor: amount, currency: "USD", sourceReference: ref, idempotencyKey: key("stl") }), "pay").settlement;
    ok(await fn(ctrl, "applySettlement", { settlementId: s.id, applications: [{ obligationId: X.obligation, amountMinor: amount }], idempotencyKey: key("app") }), "apply");
    return s;
  };
  const credit = async (X, amountMinor, who = reqA) => ok(await request(who, { kind: "CREDIT_MEMO", invoiceId: X.invoice.id, amountMinor, reason: "Credit" }), "credit request").correction;
  const noNegatives = async () => assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.obligation_balances WHERE tenant_id=$1 AND (outstanding_minor < 0 OR originated_minor < 0)`, [TENANT]), 0, "never a negative obligation");

  await t.test("CREDIT AND PAYMENT INTEGRITY: before payment, after a partial payment, equal to the remainder; collected amounts are never erased", async () => {
    // credit BEFORE payment
    const X1 = await issued({ price: 10000, account: "acct-a" });
    ok(await approve(appA, await credit(X1, 1000)), "credit before payment");
    assert.deepEqual(await bal(X1.obligation), { originated: "9000", settled: "0", outstanding: "9000", status: "OPEN" });
    await pay(X1, 9000, "CHK-I1");
    assert.deepEqual(await bal(X1.obligation), { originated: "9000", settled: "9000", outstanding: "0", status: "SETTLED" });
    // credit AFTER a partial payment, then EQUAL to the remaining outstanding
    const X2 = await issued({ price: 10000, account: "acct-a" });
    const p2 = await pay(X2, 4000, "CHK-I2");
    ok(await approve(appA, await credit(X2, 1000)), "credit after partial payment");
    assert.deepEqual(await bal(X2.obligation), { originated: "9000", settled: "4000", outstanding: "5000", status: "PARTIAL" });
    ok(await approve(appB, await credit(X2, 5000)), "credit equal to the remaining outstanding");
    assert.deepEqual(await bal(X2.obligation), { originated: "4000", settled: "4000", outstanding: "0", status: "SETTLED" });
    const sb = await one(`SELECT amount_minor::text a, applied_minor::text ap, unapplied_minor::text un FROM eos_finance.settlement_balances WHERE settlement_id=$1`, [p2.id]);
    assert.deepEqual([sb.a, sb.ap, sb.un], ["4000", "4000", "0"], "the collected 4000 is intact: still fully applied, nothing erased, no unapplied remainder created");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.settlement_applications WHERE settlement_id=$1 AND status='APPLIED'`, [p2.id]), 1);
    await noNegatives();
  });

  await t.test("CREDIT EXCEEDING the outstanding is REFUSED with zero trace: never a negative obligation, never erased collections, never an unapplied payment, never a refund; a pending credit that a later payment makes excessive is refused at approval", async () => {
    const X3 = await issued({ price: 10000, account: "acct-b" });
    await pay(X3, 4000, "CHK-I3");
    const s0 = await state();
    const settlementsBefore = await count(`SELECT count(*)::int n FROM eos_finance.settlements WHERE tenant_id=$1`, [TENANT]);
    refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: X3.invoice.id, amountMinor: 6001, reason: "excess" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    refused(await request(reqA, { kind: "WRITE_OFF", invoiceId: X3.invoice.id, amountMinor: 6001, reason: "excess" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    assert.deepEqual(await state(), s0, "zero trace: no correction row, no fact, no audit entry, no settlement");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.settlements WHERE tenant_id=$1`, [TENANT]), settlementsBefore, "no payment (unapplied or otherwise) was created");
    assert.deepEqual(await bal(X3.obligation), { originated: "10000", settled: "4000", outstanding: "6000", status: "PARTIAL" }, "the collected amount is untouched");
    // the amount is valid when requested (6000) but a later payment makes it excessive: the APPROVAL is refused, the row stays PENDING
    const pending = await credit(X3, 6000);
    await pay(X3, 2000, "CHK-I3B");
    const s1 = await state();
    refused(await approve(appA, pending), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    assert.deepEqual(await state(), s1, "zero trace");
    assert.equal((await one(`SELECT status FROM eos_finance.invoice_corrections WHERE id=$1`, [pending.id])).status, "PENDING");
    ok(await decide(appA, pending.id, "REJECT", { reason: "Overtaken by a payment" }), "reject");
    await noNegatives();
  });

  await t.test("CUMULATIVE credits cannot exceed the outstanding; a REVERSED application does not count; DUPLICATE approval and REPLAY apply once", async () => {
    const X4 = await issued({ price: 10000, account: "acct-b" });
    const c1x = await credit(X4, 6000);
    ok(await approve(appA, c1x, { idempotencyKey: "dec-cum-1" }), "first");
    ok(await approve(appB, await credit(X4, 3000)), "second");
    const sCum = await state();
    refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: X4.invoice.id, amountMinor: 1001, reason: "cumulative excess" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    assert.deepEqual(await state(), sCum, "zero trace: the full state hash is unchanged by the cumulative-excess refusal");
    ok(await approve(appA, await credit(X4, 1000)), "third, exactly the rest");
    assert.deepEqual(await bal(X4.obligation), { originated: "0", settled: "0", outstanding: "0", status: "SETTLED" });
    // duplicate approval and replay: ONE fact, ONE approval audit row
    const s = await state();
    assert.equal(ok(await approve(appA, c1x, { idempotencyKey: "dec-cum-1" }), "replay").outcome, "replayed");
    refused(await approve(appB, c1x), 409, "CORRECTION_NOT_PENDING");
    assert.deepEqual(await state(), s);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, c1x.id]), 1);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='finance.correction.approve' AND target_id=$2`, [TENANT, c1x.id]), 1);
    // a previously REVERSED application: the money is no longer applied, so the whole 10000 is outstanding -- and the reversed payment is NOT converted into a refund or an unapplied credit
    const X5 = await issued({ price: 10000, account: "acct-c" });
    const p5 = await pay(X5, 3000, "CHK-I5");
    const appId = (await one(`SELECT id FROM eos_finance.settlement_applications WHERE settlement_id=$1 AND status='APPLIED'`, [p5.id])).id;
    ok(await fn(ctrl, "reverseSettlementApplication", { applicationId: appId, reason: "wrong receivable", idempotencyKey: key("rev") }), "reverse");
    assert.deepEqual(await bal(X5.obligation), { originated: "10000", settled: "0", outstanding: "10000", status: "OPEN" });
    const sRev = await state();
    refused(await request(reqA, { kind: "CREDIT_MEMO", invoiceId: X5.invoice.id, amountMinor: 10001, reason: "excess" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    assert.deepEqual(await state(), sRev, "zero trace: the full state hash is unchanged by the reversed-application excess refusal");
    ok(await approve(appA, await credit(X5, 10000)), "credit equal to outstanding after a reversed application");
    assert.deepEqual(await bal(X5.obligation), { originated: "0", settled: "0", outstanding: "0", status: "SETTLED" });
    const sb5 = await one(`SELECT unapplied_minor::text un, refunded_minor::text rf FROM eos_finance.settlement_balances WHERE settlement_id=$1`, [p5.id]);
    assert.deepEqual([sb5.un, sb5.rf], ["3000", "0"], "the customer's reversed payment stays an ordinary unapplied payment: never converted, never refunded");
    await noNegatives();
  });

  await t.test("CONCURRENCY: two approvals racing on one receivable pass at most once when together they would exceed the outstanding; one correction approved twice at once applies once", async () => {
    const X6 = await issued({ price: 10000, account: "acct-a" });
    const cA = await credit(X6, 6000), cB = await credit(X6, 6000);
    const results = await Promise.all([approve(appA, cA), approve(appB, cB)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 412], "exactly one passes");
    const loser = results.find((r) => r.status !== 200);
    assert.equal(loser.body.code, "AMOUNT_EXCEEDS_OUTSTANDING");
    assert.deepEqual(await bal(X6.obligation), { originated: "4000", settled: "0", outstanding: "4000", status: "OPEN" });
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id=$2 AND fact_type='RECEIVABLE_CREDITED'`, [TENANT, X6.obligation]), 1);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoice_corrections WHERE obligation_id=$1 AND status='PENDING'`, [X6.obligation]), 1, "the loser stays PENDING");
    // zero trace for the loser: refusing it again changes nothing in the full state hash (and nothing was left behind by its first, concurrent refusal)
    const loserRow = await one(`SELECT id, amount_minor::text AS "amountMinor" FROM eos_finance.invoice_corrections WHERE obligation_id=$1 AND status='PENDING'`, [X6.obligation]);
    const sLoser = await state();
    refused(await approve(appA, loserRow), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    assert.deepEqual(await state(), sLoser, "zero trace: the concurrency loser leaves no fact, row or audit entry");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='finance.correction.approve' AND target_id=$2`, [TENANT, loserRow.id]), 0);
    await noNegatives();
    // the SAME correction approved by two people at once: one applies, the other finds it decided
    const X7 = await issued({ price: 5000, account: "acct-a" });
    const cC = await credit(X7, 100);
    const twin = await Promise.all([approve(appA, cC), approve(appB, cC)]);
    assert.deepEqual(twin.map((r) => r.status).sort(), [200, 409]);
    assert.equal(twin.find((r) => r.status === 409).body.code, "CORRECTION_NOT_PENDING");
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id=$1 AND source_record_id=$2`, [TENANT, cC.id]), 1);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action='finance.correction.approve' AND target_id=$2`, [TENANT, cC.id]), 1);
    // the same request raced under one actor and key: one row
    const X8 = await issued({ price: 5000, account: "acct-a" });
    const input = { kind: "CREDIT_MEMO", invoiceId: X8.invoice.id, amountMinor: 50, reason: "Racing request", idempotencyKey: "req-race-1" };
    const racing = await Promise.all([fn(reqA, "requestInvoiceCorrection", input), fn(reqA, "requestInvoiceCorrection", input)]);
    assert.ok(racing.every((r) => r.status === 200 || (r.status === 409 && r.body.code === "IDEMPOTENCY_KEY_REUSED")), JSON.stringify(racing.map((r) => r.body.code ?? r.body.result?.outcome)));
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.invoice_corrections WHERE invoice_id=$1`, [X8.invoice.id]), 1);
  });

  await t.test("COMPANY: a foreign company reads as nonexistent for requests, decisions and reads; the register is company-scoped", async () => {
    const V = await issued({ price: 1500, companyKey: "ventana", account: "acct-b" });
    const rv = ok(await request(reqV, { kind: "CREDIT_MEMO", invoiceId: V.invoice.id, amountMinor: 11, reason: "Ventana credit" }), "ventana request").correction;
    assert.equal(rv.operatingCompanyId, "ventana");
    const before = await state();
    // a Taylor-only approver: the Ventana correction reads exactly like a missing one
    const f = refused(await decide(appT, rv.id, "APPROVE", { amountMinor: 11 }), 404, "CORRECTION_NOT_FOUND", "foreign");
    const m = refused(await decide(appT, "icr-nowhere", "APPROVE", { amountMinor: 11 }), 404, "CORRECTION_NOT_FOUND", "missing");
    assert.equal(f.message, m.message);
    refused(await fn(appT, "readInvoiceCorrection", { correctionId: rv.id }), 404, "CORRECTION_NOT_FOUND");
    refused(await fn(ctrl, "readInvoiceCorrection", { correctionId: "icr-nowhere" }), 404, "CORRECTION_NOT_FOUND");
    assert.deepEqual(await state(), before);
    // the register shows each company its own
    const taylorList = ok(await fn(ctrl, "listInvoiceCorrections", { operatingCompanyId: "taylor" }), "list taylor").items;
    assert.ok(taylorList.length > 0 && taylorList.every((c) => c.operatingCompanyId === "taylor"));
    const ventanaOnly = ok(await fn(reqV, "listInvoiceCorrections", {}), "list ventana-only").items;
    assert.deepEqual(ventanaOnly.map((c) => c.id), [rv.id], "a Ventana-only reader sees only Ventana");
    refused(await fn(reqV, "listInvoiceCorrections", { operatingCompanyId: "taylor" }), 403, "OUTSIDE_OPERATING_COMPANY_SCOPE");
    // the Ventana approver completes it, and the read shows the original invoice beside the receivable
    ok(await approve(appV, rv), "ventana approve");
    const read = ok(await fn(ctrl, "readInvoiceCorrection", { correctionId: rv.id }), "read");
    assert.deepEqual([read.invoice.originalAmountDueMinor, read.receivable.outstandingMinor, read.invoice.void], ["1500", "1489", false]);
  });

  await t.test("DATABASE: the two-person CHECK, the Employee-link trigger, the approved-fact trigger, the origination guard and the narrow void gate hold on their own", async () => {
    const D = await issued({ price: 6000, account: "acct-c" });
    const REQ = reqA.principalId, DEC = appA.principalId;
    const insertPending = (id, over = {}) => q(
      `INSERT INTO eos_finance.invoice_corrections (id, tenant_id, operating_company_id, invoice_id, obligation_id, kind, amount_minor, currency, reason, status, requested_by, requested_by_employee_id, request_idempotency_key, request_fingerprint)
       VALUES ($1,$2,'taylor',$3,$4,$5,$6,'USD','raw','PENDING',$8,$9,$7,'fp')`, [id, TENANT, over.invoice ?? D.invoice.id, over.obligation ?? D.obligation, over.kind ?? "CREDIT_MEMO", over.amount ?? 100, `raw-${id}`, REQ, "e-req-a"]);
    const apply = (id, k) => q(`UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by=$3, decided_by_employee_id='e-app-a', decided_at=now(), decision_reason='raw', decision_idempotency_key=$2, decision_fingerprint='f' WHERE id=$1`, [id, k, DEC]);
    const rawFact = (src, type, amount) => q(
      `INSERT INTO eos_finance.financial_facts (id, tenant_id, operating_company_id, counterparty_id, fact_class, fact_type, source_domain, source_record_id, amount_minor, currency, basis, effective_at, idempotency_key, request_fingerprint, obligation_id, created_by)
       SELECT $1::text, $2::text, o.operating_company_id, o.counterparty_id, 'OBLIGATION', $3::text, 'INVOICE_CORRECTION', $4::text, $5::bigint, o.currency, 'raw', now(), $1::text, 'fp', o.id, 'raw'
         FROM eos_finance.obligations o WHERE o.id = $6::text`, [`ff-raw-${src}-${type}-${amount}`, TENANT, type, src, amount, D.obligation]);
    // F5: the Employee a correction records IS the Principal's active link: a stranger's Employee id is refused at request and at decision
    await assert.rejects(q(
      `INSERT INTO eos_finance.invoice_corrections (id, tenant_id, operating_company_id, invoice_id, obligation_id, kind, amount_minor, currency, reason, status, requested_by, requested_by_employee_id, request_idempotency_key, request_fingerprint)
       VALUES ('icr-raw-unlinked',$1,'taylor',$2,$3,'CREDIT_MEMO',100,'USD','raw','PENDING',$4,'e-someone-else','raw-unlinked','fp')`, [TENANT, D.invoice.id, D.obligation, REQ]), /CORRECTION_EMPLOYEE_UNLINKED/, "requester");
    // an adjustment fact for nothing is refused; so is one for a PENDING correction (a request is not an approval)
    await assert.rejects(rawFact("icr-none", "RECEIVABLE_CREDITED", -100), /ADJUSTMENT_NOT_APPROVED/, "no correction");
    await insertPending("icr-raw-1");
    await assert.rejects(rawFact("icr-raw-1", "RECEIVABLE_CREDITED", -100), /ADJUSTMENT_NOT_APPROVED/, "a PENDING correction is not an approval");
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by=$1, decided_by_employee_id='e-someone-else', decided_at=now(), decision_reason='r', decision_idempotency_key='k0', decision_fingerprint='f' WHERE id='icr-raw-1'`, [DEC]),
      /CORRECTION_EMPLOYEE_UNLINKED/, "decider");
    // the two-person CHECK: the same Principal cannot be stored as its own approver; neither can the same Employee under another Principal (triggers off, so only the CHECK speaks)
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by=$1, decided_by_employee_id='e-req-a', decided_at=now(), decision_reason='r', decision_idempotency_key='k1', decision_fingerprint='f' WHERE id='icr-raw-1'`, [REQ]),
      /SELF_APPROVAL_FORBIDDEN/, "same Principal (a non-Owner): refused by the people trigger, which routes through eos_policy.protected_owner_employee -- DECISIONS #SAE");
    // The same Employee under another Principal: that Principal's recorded Employee must be its own active link (the link trigger speaks first for a stranger), and the people trigger refuses
    // a same-Employee decision from anyone who is not the protected Owner. (The Owner's own self-decision is proved in saeProtectedOwnerExemptionPostgres.test.mjs.)
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by='someone-relinked', decided_by_employee_id='e-req-a', decided_at=now(), decision_reason='r', decision_idempotency_key='k2', decision_fingerprint='f' WHERE id='icr-raw-1'`),
      /CORRECTION_EMPLOYEE_UNLINKED|SELF_APPROVAL_FORBIDDEN/, "same Employee under another Principal");
    // A basis cannot be claimed by anyone but the protected Owner: a non-Owner naming PROTECTED_OWNER is refused, and so is a basis on an ordinary two-person decision.
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by=$1, decided_by_employee_id='e-req-a', decided_at=now(), decision_reason='r', decision_idempotency_key='k1b', decision_fingerprint='f',
      approval_basis='PROTECTED_OWNER', approval_grant_source='PROTECTED_OWNER_MEMBERSHIP' WHERE id='icr-raw-1'`, [REQ]), /SELF_APPROVAL_FORBIDDEN/, "a claimed basis is proved by the seam, never trusted");
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by=$1, decided_by_employee_id='e-app-a', decided_at=now(), decision_reason='r', decision_idempotency_key='k1c', decision_fingerprint='f',
      approval_basis='PROTECTED_OWNER', approval_grant_source='PROTECTED_OWNER_MEMBERSHIP' WHERE id='icr-raw-1'`, [DEC]), /CORRECTION_PEOPLE/, "an ordinary two-person decision carries no basis");
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by=$1, decided_by_employee_id='e-app-a', decided_at=now() WHERE id='icr-raw-1'`, [DEC]), /invoice_correction_decision_shape/, "a decision states its reason and key");
    await apply("icr-raw-1", "k3");
    // an APPLIED correction admits exactly its own fact: kind, amount and sign
    await assert.rejects(rawFact("icr-raw-1", "RECEIVABLE_WRITTEN_OFF", -100), /ADJUSTMENT_NOT_APPROVED/, "wrong kind");
    await assert.rejects(rawFact("icr-raw-1", "RECEIVABLE_CREDITED", -99), /ADJUSTMENT_NOT_APPROVED/, "wrong amount");
    await assert.rejects(rawFact("icr-raw-1", "RECEIVABLE_CREDITED", 100), /ADJUSTMENT_NOT_APPROVED/, "wrong sign");
    await rawFact("icr-raw-1", "RECEIVABLE_CREDITED", -100);
    // a decided correction never changes again, and is never deleted
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET reason='changed' WHERE id='icr-raw-1'`), /CORRECTION_IMMUTABLE/);
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET amount_minor=1 WHERE id='icr-raw-1'`), /CORRECTION_IMMUTABLE/);
    await assert.rejects(q(`DELETE FROM eos_finance.invoice_corrections WHERE id='icr-raw-1'`), /CORRECTION_IMMUTABLE/);
    // the credit can never take the receivable below what was settled (6000 - 100 credited = 5900, all of it settled)
    await pay(D, 5900, "CHK-D");
    await insertPending("icr-raw-2", { amount: 100 });
    await apply("icr-raw-2", "k4");
    await assert.rejects(rawFact("icr-raw-2", "RECEIVABLE_CREDITED", -100), /ADJUSTMENT_EXCEEDS_OUTSTANDING/, "5900 - 100 would fall below the 5900 settled");
    // the origination fact of a receivable with a LIVE invoice is never reversed
    const orig = (await one(`SELECT id FROM eos_finance.financial_facts WHERE tenant_id=$1 AND obligation_id=$2 AND fact_class='OBLIGATION' AND reverses_fact_id IS NULL AND fact_type='RECEIVABLE_ORIGINATED'`, [TENANT, D.obligation])).id;
    await assert.rejects(q(
      `INSERT INTO eos_finance.financial_facts (id, tenant_id, operating_company_id, counterparty_id, fact_class, fact_type, source_domain, source_record_id, amount_minor, currency, basis, effective_at, idempotency_key, request_fingerprint, obligation_id, reverses_fact_id, reason, created_by)
       SELECT 'ff-raw-rev', $1::text, f.operating_company_id, f.counterparty_id, f.fact_class, f.fact_type, f.source_domain, f.source_record_id, -f.amount_minor, f.currency, f.basis, now(), 'ff-raw-rev', 'fp', f.obligation_id, f.id, 'raw', 'raw'
         FROM eos_finance.financial_facts f WHERE f.id = $2::text`, [TENANT, orig]), /OBLIGATION_INVOICED/);
    // THE VOID GATE (money moved): a bare void is refused; even an APPROVED, two-person VOID correction is not enough once money has moved
    await assert.rejects(q(`UPDATE eos_finance.invoices SET voided_at=now(), void_reason='x', voided_by='y' WHERE id=$1`, [D.invoice.id]), /INVOICE_IMMUTABLE/, "no correction");
    await insertPending("icr-raw-void", { kind: "VOID", amount: 6000 });
    await apply("icr-raw-void", "k5");
    await assert.rejects(q(`UPDATE eos_finance.invoices SET voided_at=now(), void_reason='raw', voided_by=$2 WHERE id=$1`, [D.invoice.id, DEC]), /INVOICE_IMMUTABLE/, "money moved, so even an approved void is refused");
    await assert.rejects(q(`UPDATE eos_finance.invoices SET currency='EUR' WHERE id=$1`, [D.invoice.id]), /INVOICE_IMMUTABLE/, "nothing else about an issued invoice changes");
  });

  await t.test("F2 VOID GATE: with a valid APPLIED VOID and no money moved, ONLY the exact void columns may change -- never a currency or an amount, never a mismatched reason or actor; the exact void succeeds", async () => {
    const E = await issued({ price: 2500, account: "acct-c" });
    const REQ = reqA.principalId, DEC = appB.principalId;
    await q(`INSERT INTO eos_finance.invoice_corrections (id, tenant_id, operating_company_id, invoice_id, obligation_id, kind, amount_minor, currency, reason, status, requested_by, requested_by_employee_id, request_idempotency_key, request_fingerprint)
             VALUES ('icr-gate',$1,'taylor',$2,$3,'VOID',2500,'USD','Gate reason','PENDING',$4,'e-req-a','raw-gate','fp')`, [TENANT, E.invoice.id, E.obligation, REQ]);
    await q(`UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by=$2, decided_by_employee_id='e-app-b', decided_at=now(), decision_reason='ok', decision_idempotency_key='gate-k', decision_fingerprint='f' WHERE id=$1`, ["icr-gate", DEC]);
    const before = await invoiceHash(E.invoice.id);
    const voidSet = "voided_at = now(), void_reason = 'Gate reason', voided_by = $2";
    // the void columns AND another column in one UPDATE: refused, whichever column
    await assert.rejects(q(`UPDATE eos_finance.invoices SET ${voidSet}, currency = 'EUR' WHERE id = $1`, [E.invoice.id, DEC]), /INVOICE_IMMUTABLE|violates|invoice_correction/, "currency");
    await assert.rejects(q(`UPDATE eos_finance.invoices SET ${voidSet}, customer_discount_minor = 1 WHERE id = $1`, [E.invoice.id, DEC]), /INVOICE_IMMUTABLE/, "an amount");
    await assert.rejects(q(`UPDATE eos_finance.invoices SET ${voidSet}, shipping_minor = 5 WHERE id = $1`, [E.invoice.id, DEC]), /INVOICE_IMMUTABLE/, "another amount");
    await assert.rejects(q(`UPDATE eos_finance.invoices SET ${voidSet}, invoice_number = 'INV-9999-000009' WHERE id = $1`, [E.invoice.id, DEC]), /INVOICE_IMMUTABLE/, "the number");
    // a mismatched void_reason or voided_by
    await assert.rejects(q(`UPDATE eos_finance.invoices SET voided_at = now(), void_reason = 'A different reason', voided_by = $2 WHERE id = $1`, [E.invoice.id, DEC]), /INVOICE_IMMUTABLE/, "void_reason");
    await assert.rejects(q(`UPDATE eos_finance.invoices SET voided_at = now(), void_reason = 'Gate reason', voided_by = $2 WHERE id = $1`, [E.invoice.id, appA.principalId]), /INVOICE_IMMUTABLE/, "voided_by");
    assert.equal(await invoiceHash(E.invoice.id), before, "every refusal left the invoice exactly as issued");
    // the exact void, with no money moved, succeeds -- and changes nothing but the three columns
    const orig = (await one(`SELECT to_jsonb(i) - 'voided_at' - 'void_reason' - 'voided_by' AS j FROM eos_finance.invoices i WHERE i.id=$1`, [E.invoice.id])).j;
    await q(`UPDATE eos_finance.invoices SET ${voidSet} WHERE id = $1`, [E.invoice.id, DEC]);
    const row = await one(`SELECT to_jsonb(i) - 'voided_at' - 'void_reason' - 'voided_by' AS j, voided_at IS NOT NULL AS v, void_reason, voided_by FROM eos_finance.invoices i WHERE i.id=$1`, [E.invoice.id]);
    assert.deepEqual([row.v, row.void_reason, row.voided_by], [true, "Gate reason", DEC]);
    assert.deepEqual(row.j, orig, "only the three void columns moved");
  });

  // ════════════════════ SAE: the governed protected Owner (DECISIONS #SAE; Owner policy override 2026-10-20) ════════════════════
  // The Owner may request AND approve the same correction (no second Employee). It removes ONLY the second person: the request key, the approval key, company authority, the state, the
  // balance and invoice integrity, the reason, idempotency and audit all still apply, and every other person keeps SELF_APPROVAL_FORBIDDEN.
  const ownerPerson = async (subject, emp, roles = ["f1bRequester", "f1bApprover"], companies = undefined) => {
    const who = await person(subject, roles, { id: emp, name: `Owner ${emp}` });
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [who], companies);
    await seedProtectedOwnerRows(q, { tenantId: TENANT, principalId: who.principalId });
    return who;
  };
  const sae = {};

  await t.test("SAE-1 SEAM PARITY: the SQL seam (eos_policy.protected_owner_employee) and the TypeScript seam agree for the Owner and for every non-Owner", async () => {
    const seam = require("../lib/access/secondaryApprovalExemption.js");
    sae.owner = await ownerPerson("uid-sae-owner", "e-sae-owner");
    const lookalike = await person("uid-sae-look", ["f1bRequester", "f1bApprover"], { id: "e-sae-look", name: "Look Alike" });
    const administrator = await person("uid-sae-admin", ["admin", "f1bRequester", "f1bApprover"], { id: "e-sae-admin", name: "Ada Admin" });
    const fm = await person("uid-sae-fm", ["financeManager", "f1bRequester", "f1bApprover"], { id: "e-sae-fm", name: "Fay Finance" });
    const gm = await person("uid-sae-gm", ["generalManager", "f1bRequester", "f1bApprover"], { id: "e-sae-gm", name: "Glen General" });
    const pm = await person("uid-sae-pm", ["partsManager", "f1bRequester", "f1bApprover"], { id: "e-sae-pm", name: "Pat Parts" });
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [lookalike, administrator, fm, gm, pm]);
    const noEmployee = await person("uid-sae-noemp", ["f1bRequester", "f1bApprover"]);
    await seedProtectedOwnerRows(q, { tenantId: TENANT, principalId: noEmployee.principalId });
    sae.revoked = await ownerPerson("uid-sae-revoked", "e-sae-revoked");
    sae.unlinked = await ownerPerson("uid-sae-unlinked", "e-sae-unlinked");
    sae.terminated = await ownerPerson("uid-sae-terminated", "e-sae-terminated");
    await q(`UPDATE eos_policy.user_role_assignments SET status = 'revoked' WHERE principal_id = $1 AND id LIKE 'a-owner-%'`, [sae.revoked.principalId]);
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE principal_id = $1`, [sae.unlinked.principalId]);
    await q(`UPDATE eos_workforce.employees SET employment_status = 'TERMINATED' WHERE id = 'e-sae-terminated'`);
    const people = { owner: sae.owner, lookalike, administrator, financeManager: fm, generalManager: gm, partsManager: pm, ownerNoEmployee: noEmployee,
      ownerRevoked: sae.revoked, ownerUnlinked: sae.unlinked, ownerTerminated: sae.terminated };
    const exempt = [];
    for (const [label, who] of Object.entries(people)) {
      const sql = (await one(`SELECT eos_policy.protected_owner_employee($1, $2) AS e`, [TENANT, who.principalId])).e;
      const ts = await seam.resolveSecondaryApprovalExemption(pool, TENANT, who.principalId, "finance.invoiceCorrection");
      assert.equal(ts.exempt, sql !== null, `${label}: the two seams agree`);
      if (ts.exempt) { exempt.push(label); assert.equal(ts.employeeId, sql); assert.equal(ts.basis, "PROTECTED_OWNER"); }
      assert.equal((await one(`SELECT eos_policy.is_protected_owner_employee($1, $2, $3) AS b`, [TENANT, who.principalId, "e-sae-owner"])).b, label === "owner");
    }
    assert.deepEqual(exempt, ["owner"], "ONLY the governed protected Owner is exempt: not the Administrator, a General / Finance / Parts Manager, a look-alike, a revoked or unlinked or terminated Owner, or an Owner with no Employee");
    sae.people = people;
  });

  await t.test("SAE-2 THE OWNER decides a correction they requested: credit, write-off, debit and (below) refund and void -- applied, basis + provenance on the row, the audit and the read; the invoice is exactly as issued; outstanding is derived", async () => {
    const O = sae.owner;
    const S = await issued({ price: 30000, account: "acct-a" });
    const S_HASH = await invoiceHash(S.invoice.id);
    const own = (kind, amountMinor, reason) => request(O, { kind, invoiceId: S.invoice.id, amountMinor, reason });
    const apply = async (c, expectOutstanding) => {
      const before = await state();
      const r = ok(await approve(O, c, { reason: "Owner decision" }), `${c.kind} owner self-approval`);
      assert.equal(r.outcome, "applied");
      assert.deepEqual([r.correction.status, r.correction.requestedBy, r.correction.decidedBy, r.correction.requestedByEmployeeId, r.correction.decidedByEmployeeId],
        ["APPLIED", O.principalId, O.principalId, "e-sae-owner", "e-sae-owner"], "the request and the decision stay separate facts, by the same Owner");
      assert.deepEqual([r.correction.approvalBasis, r.correction.approvalScope, r.correction.approvalGrantSource], ["PROTECTED_OWNER", "FINANCIALS", "PROTECTED_OWNER_MEMBERSHIP"]);
      const row = await one(`SELECT approval_basis, approval_scope, approval_grant_source FROM eos_finance.invoice_corrections WHERE id = $1`, [c.id]);
      assert.deepEqual([row.approval_basis, row.approval_scope, row.approval_grant_source], ["PROTECTED_OWNER", "FINANCIALS", "PROTECTED_OWNER_MEMBERSHIP"]);
      const audit = await one(`SELECT after FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = 'finance.correction.approve' AND target_id = $2`, [TENANT, c.id]);
      assert.deepEqual([audit.after.approvalBasis, audit.after.approvalScope, audit.after.approvalGrantSource, audit.after.decidedBy, audit.after.requestedBy],
        ["PROTECTED_OWNER", "FINANCIALS", "PROTECTED_OWNER_MEMBERSHIP", O.principalId, O.principalId]);
      assert.equal((await state()).audits, before.audits + 1, "ONE audit row for the applied approval");
      if (expectOutstanding) assert.equal((await bal(S.obligation)).outstanding, expectOutstanding);
      assert.equal(await invoiceHash(S.invoice.id), S_HASH, "the issued invoice, its number and lines are untouched");
      return r.correction;
    };
    await apply(ok(await own("CREDIT_MEMO", 1000, "Pricing correction"), "credit req").correction, "29000");
    await apply(ok(await own("WRITE_OFF", 500, "Small balance"), "wo req").correction, "28500");
    await apply(ok(await own("DEBIT_CHARGE", 250, "Late fee per terms"), "debit req").correction, "28750");
    const inv = await one(`SELECT t.amount_due_minor::text due, b.outstanding_minor::text out FROM eos_finance.invoice_totals t JOIN eos_finance.obligation_balances b ON b.tenant_id=t.tenant_id AND b.obligation_id=$2 WHERE t.invoice_id=$1`, [S.invoice.id, S.obligation]);
    assert.deepEqual([inv.due, inv.out], ["30000", "28750"], "outstanding is DERIVED (original + adjustments - settled); the invoice still states what it billed");
    // the read says the same
    const read = ok(await fn(O, "readInvoiceCorrection", { correctionId: (await one(`SELECT id FROM eos_finance.invoice_corrections WHERE invoice_id = $1 ORDER BY requested_at LIMIT 1`, [S.invoice.id])).id }), "read");
    assert.equal(read.correction.approvalBasis, "PROTECTED_OWNER");
    // REFUND: records only (no payment); the Owner approves their own request
    const R = await issued({ price: 12000, account: "acct-c" });
    const pay = ok(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-c" }, kind: "CUSTOMER_PAYMENT",
      amountMinor: 12000, currency: "USD", sourceReference: "CHK-SAE", idempotencyKey: key("stl") }), "pay").settlement;
    ok(await fn(ctrl, "applySettlement", { settlementId: pay.id, applications: [{ obligationId: R.obligation, amountMinor: 12000 }], idempotencyKey: key("app") }), "apply");
    const appRow = await one(`SELECT id FROM eos_finance.settlement_applications WHERE tenant_id=$1 AND settlement_id=$2 AND status='APPLIED'`, [TENANT, pay.id]);
    const R_HASH = await invoiceHash(R.invoice.id);
    const handoffs = await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoffs WHERE tenant_id=$1`, [TENANT]);
    const rf = ok(await request(O, { kind: "REFUND", invoiceId: R.invoice.id, amountMinor: 3000, applicationId: appRow.id, reason: "Customer returned a unit" }), "refund req").correction;
    const rfDone = ok(await approve(O, rf, { reason: "Return verified" }), "refund owner approval");
    assert.deepEqual([rfDone.correction.status, rfDone.refundRecorded, rfDone.notice, rfDone.correction.approvalBasis], ["APPLIED", true, "refund recorded; no payment has been sent", "PROTECTED_OWNER"]);
    assert.equal(await invoiceHash(R.invoice.id), R_HASH);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.accounting_handoffs WHERE tenant_id=$1`, [TENANT]), handoffs, "no external payment path: nothing is handed off or sent");
    assert.deepEqual(await bal(R.obligation), { originated: "12000", settled: "9000", outstanding: "3000", status: "PARTIAL" });
    // VOID: only before money moves, for the Owner too
    const V = await issued({ price: 2200, account: "acct-a" });
    const vr = ok(await request(O, { kind: "VOID", invoiceId: V.invoice.id, reason: "Billed to the wrong customer" }), "void req").correction;
    const vDone = ok(await approve(O, vr, { reason: "Confirmed with the customer" }), "void owner approval").correction;
    assert.deepEqual([vDone.status, vDone.approvalBasis], ["APPLIED", "PROTECTED_OWNER"]);
    assert.equal((await one(`SELECT invoice_number, voided_at IS NOT NULL AS v, voided_by FROM eos_finance.invoices WHERE id = $1`, [V.invoice.id])).voided_by, O.principalId);
    assert.equal((await bal(V.obligation)).status, "VOID");
    const P = await issued({ price: 900, account: "acct-b" });
    const payP = ok(await fn(ctrl, "recordSettlement", { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "acct-b" }, kind: "CUSTOMER_PAYMENT",
      amountMinor: 100, currency: "USD", sourceReference: "CHK-SAE-V", idempotencyKey: key("stl") }), "pay").settlement;
    ok(await fn(ctrl, "applySettlement", { settlementId: payP.id, applications: [{ obligationId: P.obligation, amountMinor: 100 }], idempotencyKey: key("app") }), "apply");
    const s0 = await state();
    refused(await request(O, { kind: "VOID", invoiceId: P.invoice.id, reason: "after payment" }), 412, "VOID_AFTER_SETTLEMENT");
    assert.deepEqual(await state(), s0, "the Owner cannot void after money moved: zero trace");
    // the Owner cannot credit above what is owed either
    refused(await request(O, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 801, reason: "too much" }), 412, "AMOUNT_EXCEEDS_OUTSTANDING");
    sae.S = S; sae.P = P;
  });

  await t.test("SAE-3 EVERYONE ELSE keeps the refusal, with zero trace: Administrator, Finance / General / Parts Manager, a look-alike, a revoked / unlinked / terminated Owner, an Owner without the approval key; a client flag is not accepted", async () => {
    const P = sae.P;
    const refuseSelf = async (label, who, status = 412, code = "SELF_APPROVAL_FORBIDDEN") => {
      const c = ok(await request(who, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 3, reason: `SAE ${label}` }), `${label} request`).correction;
      const before = await state();
      refused(await approve(who, c), status, code, label);
      assert.deepEqual(await state(), before, `${label}: zero trace (state hash)`);
      assert.equal((await one(`SELECT status FROM eos_finance.invoice_corrections WHERE id = $1`, [c.id])).status, "PENDING");
      return c;
    };
    for (const label of ["lookalike", "administrator", "financeManager", "generalManager", "partsManager"]) await refuseSelf(label, sae.people[label]);
    await refuseSelf("ownerRevoked (membership ended)", sae.people.ownerRevoked);
    // an unlinked / terminated Owner cannot even REQUEST (a requester must be an access-eligible Employee) -- the exemption is not a way round that
    refused(await request(sae.people.ownerUnlinked, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 3, reason: "x" }), 412, "REQUESTER_EMPLOYEE_REQUIRED");
    assert.notEqual((await request(sae.people.ownerTerminated, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 3, reason: "x" })).status, 200, "a terminated Employee resolves to no access at all");
    // a request made while linked, then the link ended: the decider is no Employee
    const late = await ownerPerson("uid-sae-late", "e-sae-late");
    const lc = ok(await request(late, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 4, reason: "SAE late" }), "late req").correction;
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE principal_id = $1`, [late.principalId]);
    const s1 = await state();
    refused(await approve(late, lc), 412, "SELF_APPROVAL_FORBIDDEN", "the Owner's link ended after the request: not exempt, and not another person either");
    assert.deepEqual(await state(), s1);
    // relink: another Principal on the Owner's Employee (not an Owner) is not exempt
    const imp = await person("uid-sae-imp", ["f1bApprover"]);
    await assignFinanceCompanies({ admin, q, tenant: TENANT }, [imp]);
    const rlOwner = await ownerPerson("uid-sae-rl", "e-sae-rl");
    const oc = ok(await request(rlOwner, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 5, reason: "SAE relink probe" }), "owner req").correction;
    await q(`UPDATE eos_policy.employee_principal_links SET status = 'revoked' WHERE principal_id = $1`, [rlOwner.principalId]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ('lnk-sae-imp',$1,$2,'e-sae-rl','taylor','OPERATOR_ASSERTED','active','fixture','relinked the Owner''s Employee to another Principal')`, [TENANT, imp.principalId]);
    const s2 = await state();
    refused(await approve(imp, oc), 412, "SELF_APPROVAL_FORBIDDEN", "a relinked Employee is not the Owner");
    assert.deepEqual(await state(), s2);
    // client-supplied flags / role strings are not inputs
    for (const extra of [{ isOwner: true }, { owner: true }, { role: "owner" }, { exempt: true }, { approvalBasis: "PROTECTED_OWNER" }]) {
      const before = await state();
      refused(await fn(sae.people.lookalike, "decideInvoiceCorrection", { correctionId: oc.id, decision: "REJECT", reason: "x", idempotencyKey: key("dec"), ...extra }), 400, "FIELD_NOT_ACCEPTED", JSON.stringify(extra));
      assert.deepEqual(await state(), before);
    }
    // the exemption adds no authority: an Owner holding only the request key is refused the approval; one holding only the approval key cannot request
    const reqOnly = await ownerPerson("uid-sae-reqonly", "e-sae-reqonly", ["f1bRequester"]);
    const rc = ok(await request(reqOnly, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 6, reason: "SAE request-only Owner" }), "reqonly req").correction;
    const s3 = await state();
    refused(await approve(reqOnly, rc), 403, "CAPABILITY_REQUIRED", "the Owner without the approval key");
    const appOnly = await ownerPerson("uid-sae-apponly", "e-sae-apponly", ["f1bApprover"]);
    refused(await request(appOnly, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 6, reason: "x" }), 403, "CAPABILITY_REQUIRED", "the Owner without the request key");
    assert.deepEqual(await state(), s3);
    // company authority: an Owner assigned to Ventana only reads a Taylor correction as nonexistent
    const vOwner = await ownerPerson("uid-sae-vowner", "e-sae-vowner", ["f1bRequester", "f1bApprover"], ["ventana"]);
    refused(await approve(vOwner, rc), 404, "CORRECTION_NOT_FOUND", "a foreign company reads as nonexistent, even for the Owner");
    refused(await request(vOwner, { kind: "CREDIT_MEMO", invoiceId: P.invoice.id, amountMinor: 1, reason: "x" }), 404, "INVOICE_NOT_FOUND");
    assert.deepEqual(await state(), s3);
    ok(await decide(appA, rc.id, "REJECT", { reason: "Probe" }), "cleanup reject");
  });

  await t.test("SAE-4 REPLAY and CONCURRENCY: an Owner self-approval replays safely; the Owner's self-approval and a second Employee's approval of the same correction race -- exactly one wins", async () => {
    const O = sae.owner;
    const C = await issued({ price: 5000, account: "acct-a" });
    const c = ok(await request(O, { kind: "CREDIT_MEMO", invoiceId: C.invoice.id, amountMinor: 700, reason: "Replay probe" }), "req").correction;
    const first = ok(await decide(O, c.id, "APPROVE", { amountMinor: 700, idempotencyKey: "sae-replay" }), "first");
    const mid = await state();
    const again = ok(await decide(O, c.id, "APPROVE", { amountMinor: 700, idempotencyKey: "sae-replay" }), "replay");
    assert.deepEqual([first.outcome, again.outcome, again.correction.approvalBasis], ["applied", "replayed", "PROTECTED_OWNER"]);
    assert.deepEqual(await state(), mid, "a replay writes nothing");
    refused(await decide(O, c.id, "APPROVE", { amountMinor: 700, idempotencyKey: "sae-replay", reason: "A different decision" }), 409, "IDEMPOTENCY_KEY_REUSED");
    // the race
    const race = ok(await request(O, { kind: "CREDIT_MEMO", invoiceId: C.invoice.id, amountMinor: 300, reason: "Race probe" }), "race req").correction;
    const [a, b] = await Promise.all([decide(O, race.id, "APPROVE", { amountMinor: 300 }), decide(appA, race.id, "APPROVE", { amountMinor: 300 })]);
    const winners = [a, b].filter((r) => r.status === 200);
    const losers = [a, b].filter((r) => r.status !== 200);
    assert.equal(winners.length, 1, `exactly one wins: ${JSON.stringify([a.body, b.body]).slice(0, 600)}`);
    assert.deepEqual([losers[0].status, losers[0].body.code], [409, "CORRECTION_NOT_PENDING"]);
    assert.equal(await count(`SELECT count(*)::int n FROM eos_finance.financial_facts WHERE tenant_id = $1 AND source_record_id = $2`, [TENANT, race.id]), 1, "exactly one adjustment fact");
    const decided = await one(`SELECT status, approval_basis, decided_by FROM eos_finance.invoice_corrections WHERE id = $1`, [race.id]);
    assert.equal(decided.status, "APPLIED");
    // whichever won, the row is internally consistent: a different decider carries no basis, the Owner carries PROTECTED_OWNER
    assert.equal(decided.approval_basis, decided.decided_by === O.principalId ? "PROTECTED_OWNER" : null);
  });

  await t.test("SAE-5 THE DATABASE says it too: a same-person decision is stored only for the protected Owner with the basis; the seam is judged at the moment of the decision", async () => {
    const O = sae.owner;
    const D = await issued({ price: 4000, account: "acct-b" });
    const rawPending = async (id, kind = "CREDIT_MEMO", amount = 100) => q(
      `INSERT INTO eos_finance.invoice_corrections (id, tenant_id, operating_company_id, invoice_id, obligation_id, kind, amount_minor, currency, reason, status, requested_by, requested_by_employee_id, request_idempotency_key, request_fingerprint)
       VALUES ($1,$2,'taylor',$3,$4,$5,$6,'USD','raw','PENDING',$7,'e-sae-owner',$1,'fp')`, [id, TENANT, D.invoice.id, D.obligation, kind, amount, O.principalId]);
    const decideRaw = (id, basis, who = O.principalId, emp = "e-sae-owner") => q(
      `UPDATE eos_finance.invoice_corrections SET status='APPLIED', decided_by=$2, decided_by_employee_id=$3, decided_at=now(), decision_reason='r', decision_idempotency_key=$1, decision_fingerprint='f',
              approval_basis=$4, approval_grant_source=$5 WHERE id=$1`, [id, who, emp, basis, basis ? "PROTECTED_OWNER_MEMBERSHIP" : null]);
    await rawPending("icr-sae-1");
    await assert.rejects(decideRaw("icr-sae-1", null), /SELF_APPROVAL_FORBIDDEN/, "the Owner decides their own WITHOUT recording the basis: refused");
    await assert.rejects(decideRaw("icr-sae-1", "PROTECTED_OWNER", sae.people.administrator.principalId, "e-sae-admin"), /SELF_APPROVAL_FORBIDDEN|CORRECTION_PEOPLE|CORRECTION_EMPLOYEE_UNLINKED/, "a basis on another person's decision is refused");
    await decideRaw("icr-sae-1", "PROTECTED_OWNER");
    const stored = await one(`SELECT status, approval_basis, approval_scope, approval_grant_source FROM eos_finance.invoice_corrections WHERE id = 'icr-sae-1'`);
    assert.deepEqual([stored.status, stored.approval_basis, stored.approval_grant_source], ["APPLIED", "PROTECTED_OWNER", "PROTECTED_OWNER_MEMBERSHIP"]);
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET approval_basis = NULL, approval_grant_source = NULL WHERE id = 'icr-sae-1'`), /CORRECTION_IMMUTABLE|invoice_correction_approval_basis_shape/, "a recorded basis is never erased");
    // the fact is admitted for an Owner-approved correction (the seam is consulted again), and not once the Owner's membership has ended
    const rawFact = (src, amount) => q(
      `INSERT INTO eos_finance.financial_facts (id, tenant_id, operating_company_id, counterparty_id, fact_class, fact_type, source_domain, source_record_id, amount_minor, currency, basis, effective_at, idempotency_key, request_fingerprint, obligation_id, created_by)
       SELECT $1::text, $2::text, o.operating_company_id, o.counterparty_id, 'OBLIGATION', 'RECEIVABLE_CREDITED', 'INVOICE_CORRECTION', $3::text, $4::bigint, o.currency, 'raw', now(), $1::text, 'fp', o.id, 'raw'
         FROM eos_finance.obligations o WHERE o.id = $5::text`, [`ff-sae-${src}`, TENANT, src, amount, D.obligation]);
    await rawFact("icr-sae-1", -100);
    await rawPending("icr-sae-2");
    await decideRaw("icr-sae-2", "PROTECTED_OWNER");
    await q(`UPDATE eos_policy.user_role_assignments SET status = 'revoked' WHERE principal_id = $1 AND id LIKE 'a-owner-%'`, [O.principalId]);
    await assert.rejects(rawFact("icr-sae-2", -100), /ADJUSTMENT_NOT_APPROVED/, "judged at that moment: the Owner's membership has ended");
    await rawPending("icr-sae-3");
    await assert.rejects(decideRaw("icr-sae-3", "PROTECTED_OWNER"), /SELF_APPROVAL_FORBIDDEN/, "an ended Owner cannot decide their own");
    await q(`UPDATE eos_policy.user_role_assignments SET status = 'active' WHERE principal_id = $1 AND id LIKE 'a-owner-%'`, [O.principalId]);
    await rawFact("icr-sae-2", -100);
    // a withdrawal carries no basis
    await rawPending("icr-sae-4");
    await assert.rejects(q(`UPDATE eos_finance.invoice_corrections SET status='WITHDRAWN', decided_by=$2, decided_by_employee_id='e-sae-owner', decided_at=now(), decision_reason='r', decision_idempotency_key='w', decision_fingerprint='f',
      approval_basis='PROTECTED_OWNER', approval_grant_source='PROTECTED_OWNER_MEMBERSHIP' WHERE id='icr-sae-4'`, [O.principalId]), /CORRECTION_PEOPLE|invoice_correction_approval_basis_shape/);
  });

  await t.test("NO PAYOUT PATH: the Finance transport has no operation that moves money out, and every refund record carries nothing to execute", async () => {
    assert.deepEqual(financeOps.FINANCE_OPERATIONS.filter((n) => /payout|disburs|cashout|send|execute|initiate|transfer|wire|release/i.test(n)), []);
    const refunds = (await q(`SELECT method, correlation_id, notes, replaces_settlement_id FROM eos_finance.settlements WHERE tenant_id=$1 AND kind='CUSTOMER_REFUND'`, [TENANT])).rows;
    assert.ok(refunds.length >= 1 && refunds.every((r) => r.method === null && r.correlation_id === null && r.notes === null && r.replaces_settlement_id === null));
    const unknown = await fn(ctrl, "payRefund", { correctionId: "x" });
    assert.notEqual(unknown.status, 200, "there is no such operation");
  });
});
