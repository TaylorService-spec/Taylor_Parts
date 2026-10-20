// F-1b, offline -- governed credits, write-offs, adjustments, refunds and eligible voids of an ISSUED invoice (DECISIONS #F-1b; spec docs/architecture/f1-invoicing-spec.md;
// Owner rulings docs/governance/owner-commercial-spec-rulings-2026-10-20.md OD-F1-1 / OD-F1-4 / OD-F1-9 / OD-F1-11). No database: the real-database proof is
// functions/test/f1bInvoiceCorrectionPostgres.test.mjs. This file proves, with a recording stand-in for the connection, what the CODE decides:
//   * every money action is REQUESTED then APPROVED; the people rule (same Principal, same Employee, a relinked Employee) refuses BEFORE any write;
//   * the $0 threshold: a 1-cent request is a real request that needs approval; $0 is not an amount; there is no "record" shortcut around approval;
//   * authority and company are decided by the transport before the command can write; a foreign company reads exactly like a missing record;
//   * a refund RECORDS, it never pays: no operation, module or settlement kind in the Finance table can execute, send or initiate a payment;
//   * the proposed approval grants are a subset of the existing record holders, and exclude admin, partsManager and every A6 summary-key role.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const corr = require("../lib/eosFinance/invoiceCorrection.js");
const ops = require("../lib/eosFinance/financeOperations.js");
const settlement = require("../lib/eosFinance/settlement.js");
const code = (file) => readFileSync(join(ROOT, "src", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const count = (haystack, needle) => haystack.split(needle).length - 1;
const T = "t-f1b";
const ACTOR = { tenantId: T, principalId: "p-app" };

/** A recording stand-in for the connection: rules are [regex over the whitespace-normalised SQL, (params) => result]; anything else fails the test. */
function mockPool(rules = []) {
  const log = [];
  const query = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    log.push(s);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [], rowCount: 0 };
    for (const [re, fn] of rules) if (re.test(s)) return fn(params, s);
    throw new Error(`UNEXPECTED SQL: ${s.slice(0, 160)}`);
  };
  return { log, query, connect: async () => ({ query, release() {} }) };
}
const writes = (log) => log.filter((s) => /^(INSERT|UPDATE|DELETE)/i.test(s));
const NO_DB = { connect: async () => { throw new Error("NO_CONNECTION"); }, query: async () => { throw new Error("NO_CONNECTION"); } };
const failure = async (p) => { try { await p; } catch (e) { return e; } return null; };
const sha = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

const CORR = (over = {}) => ({
  id: "icr1", tenant_id: T, operating_company_id: "taylor", invoice_id: "inv1", obligation_id: "obl1", invoice_number: "INV-2026-000001", kind: "CREDIT_MEMO", amount_minor: "100",
  currency: "USD", reason: "pricing error", status: "PENDING", settlement_id: null, application_id: null, requested_by: "p-req", requested_by_employee_id: "e-req",
  requested_at: "2026-10-20T10:00:00Z", decided_by: null, decided_by_employee_id: null, decided_at: null, decision_reason: null, decision_idempotency_key: null,
  decision_fingerprint: null, fact_id: null, refund_settlement_id: null, ...over,
});
/** The queries decideInvoiceCorrection makes before its first write. */
const decideRules = ({ row = CORR(), employees = { "p-app": "e-app", "p-req": "e-req" }, current = { "p-req": ["e-req"] }, keyed = [] } = {}) => [
  [/FROM eos_finance\.invoice_corrections WHERE tenant_id = \$1 AND id = \$2 FOR UPDATE/, () => ({ rows: [row] })],
  [/FROM eos_finance\.invoice_corrections WHERE tenant_id = \$1 AND decided_by = \$2 AND decision_idempotency_key = \$3/, () => ({ rows: keyed })],
  [/FROM eos_policy\.employee_principal_links l LEFT JOIN eos_workforce\.employees e/, (p) => (employees[p[1]] ? { rows: [{ employee_id: employees[p[1]], employment_status: "ACTIVE" }] } : { rows: [] })],
  [/SELECT employee_id FROM eos_policy\.employee_principal_links WHERE tenant_id = \$1 AND principal_id = \$2 AND status = 'active'/, (p) => ({ rows: (current[p[1]] ?? []).map((e) => ({ employee_id: e })) })],
  [/FROM eos_finance\.invoice_corrections c JOIN eos_finance\.invoices i/, () => ({ rows: [{ ...row }] })],
];
const decide = (pool, actor, input) => corr.decideInvoiceCorrection(pool, actor, { correctionId: "icr1", decision: "APPROVE", amountMinor: 100, reason: "checked", idempotencyKey: "k-1", ...input });

// ════════════════════ the rule: two people, $0 ════════════════════

test("the threshold is ZERO and there is no record mode: every kind needs a distinct approval key, none of them a request key", () => {
  assert.equal(corr.CORRECTION_APPROVAL_THRESHOLD_MINOR, 0n);
  assert.deepEqual([...corr.INVOICE_CORRECTION_KINDS], ["CREDIT_MEMO", "DEBIT_CHARGE", "WRITE_OFF", "REFUND", "VOID"]);
  for (const kind of corr.INVOICE_CORRECTION_KINDS) {
    assert.ok(corr.CORRECTION_APPROVE_CAPABILITY[kind], `${kind} has an approval key`);
    assert.notEqual(corr.CORRECTION_APPROVE_CAPABILITY[kind], corr.CORRECTION_REQUEST_CAPABILITY[kind], `${kind}: approving is never the request key`);
  }
  assert.deepEqual([...corr.CORRECTION_REQUEST_CAPABILITIES].sort(), ["finance.adjustment.record", "finance.refund.record"]);
  assert.deepEqual([...corr.CORRECTION_APPROVAL_CAPABILITIES].sort(), ["finance.adjustment.approve", "finance.invoice.void.approve", "finance.refund.approve"]);
  assert.equal(corr.CORRECTION_APPROVE_CAPABILITY.REFUND, "finance.refund.approve");
  assert.equal(corr.CORRECTION_APPROVE_CAPABILITY.VOID, "finance.invoice.void.approve");
  // The existing Firebase record keys are the request keys; a void is requested as an adjustment to an issued invoice.
  assert.equal(corr.CORRECTION_REQUEST_CAPABILITY.REFUND, "finance.refund.record");
  assert.equal(corr.CORRECTION_REQUEST_CAPABILITY.VOID, "finance.adjustment.record");
});

test("$0 is not an amount, and a 1-cent request is a real request: the amount reaches the connection step, so it will wait for approval", async () => {
  const base = { kind: "CREDIT_MEMO", invoiceId: "inv1", reason: "x", idempotencyKey: "k" };
  for (const bad of [0, -1, 1.5, "100", null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal((await failure(corr.requestInvoiceCorrection(NO_DB, ACTOR, { ...base, amountMinor: bad })))?.code, "AMOUNT_INVALID", `amount ${String(bad)}`);
  }
  for (const kind of ["CREDIT_MEMO", "DEBIT_CHARGE", "WRITE_OFF"]) {
    assert.equal((await failure(corr.requestInvoiceCorrection(NO_DB, ACTOR, { ...base, kind, amountMinor: 1 })))?.message, "NO_CONNECTION", `${kind}: one cent passes validation and goes to the database as a PENDING request`);
  }
  const src = code("eosFinance/invoiceCorrection.ts");
  assert.match(src, /status = \$3, decided_by/, "approval is a decision recorded on the request row");
  assert.doesNotMatch(src, /recordInvoiceAdjustment|recordInvoiceCorrection|applyImmediately|skipApproval|noApproval|autoApprove/, "no one-step path exists");
});

test("input is refused before any connection: unknown fields, ids, kinds, a void with an amount, a refund without its application, an over-long reason", async () => {
  const ok = { kind: "WRITE_OFF", invoiceId: "inv1", amountMinor: 5, reason: "r", idempotencyKey: "k" };
  const code_ = async (over) => (await failure(corr.requestInvoiceCorrection(NO_DB, ACTOR, { ...ok, ...over })))?.code;
  assert.equal(await code_({ approverId: "someone" }), "FIELD_NOT_ACCEPTED", "the approver is chosen at decision time, never at request time");
  assert.equal(await code_({ operatingCompanyId: "taylor" }), "FIELD_NOT_ACCEPTED", "the company is the invoice's, never the caller's");
  assert.equal(await code_({ kind: "PAYOUT" }), "CORRECTION_KIND_INVALID");
  assert.equal(await code_({ invoiceId: " " }), "INVOICE_ID_REQUIRED");
  assert.equal(await code_({ reason: "" }), "REASON_REQUIRED");
  assert.equal(await code_({ reason: "x".repeat(corr.CORRECTION_REASON_MAX + 1) }), "REASON_REQUIRED");
  assert.equal(await code_({ idempotencyKey: undefined }), "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await code_({ kind: "VOID", amountMinor: 5 }), "AMOUNT_NOT_ACCEPTED", "a void is of the whole invoice");
  assert.equal(await code_({ kind: "REFUND" }), "APPLICATION_ID_REQUIRED", "a refund names the application it returns");
  assert.equal(await code_({ applicationId: "sap1" }), "FIELD_NOT_ACCEPTED", "only a refund names an application");
  assert.equal((await failure(corr.requestInvoiceCorrection(NO_DB, ACTOR, { kind: "VOID", invoiceId: "inv1", reason: "r", idempotencyKey: "k" })))?.message, "NO_CONNECTION", "a void states no amount");
  assert.equal((await failure(corr.requestInvoiceCorrection(NO_DB, ACTOR, { kind: "REFUND", invoiceId: "inv1", amountMinor: 5, applicationId: "sap1", reason: "r", idempotencyKey: "k" })))?.message, "NO_CONNECTION");
  const d = async (over) => (await failure(decide(NO_DB, ACTOR, over)))?.code;
  assert.equal(await d({ decision: "PAY" }), "DECISION_INVALID");
  assert.equal(await d({ amountMinor: undefined }), "AMOUNT_INVALID", "an approval states an amount");
  assert.equal(await d({ amountMinor: 0 }), "AMOUNT_INVALID");
  assert.equal(await d({ decision: "REJECT", amountMinor: 100 }), "AMOUNT_NOT_ACCEPTED", "only an approval states an amount");
  assert.equal(await d({ reason: " " }), "REASON_REQUIRED", "every decision states its reason");
  assert.equal(await d({ idempotencyKey: "" }), "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await d({ approverEmployeeId: "e-x" }), "FIELD_NOT_ACCEPTED", "the deciding Employee is the caller's own link, never a field");
});

// ════════════════════ no requester self-approval ════════════════════

test("SELF-APPROVAL is refused before any write: same Principal; a second Principal on the same Employee; a relinked Employee; no Employee at all", async () => {
  const run = async (actor, setup) => {
    const pool = mockPool(decideRules(setup));
    const e = await failure(decide(pool, actor, {}));
    return { code: e?.code, category: e?.category, writes: writes(pool.log), log: pool.log };
  };
  // 1. the requester's own Principal
  const same = await run({ tenantId: T, principalId: "p-req" }, {});
  assert.deepEqual([same.code, same.category, same.writes], ["SELF_APPROVAL_FORBIDDEN", "PRECONDITION_FAILED", []]);
  // 2. a DIFFERENT Principal linked to the Employee recorded on the request
  const sameEmployee = await run({ tenantId: T, principalId: "p-app" }, { employees: { "p-app": "e-req", "p-req": "e-req" } });
  assert.deepEqual([sameEmployee.code, sameEmployee.writes], ["SELF_APPROVAL_FORBIDDEN", []]);
  // 3. RELINK: the requester's Employee was relinked to another Principal, and the approver is now the requester's CURRENT Employee
  const relinked = await run({ tenantId: T, principalId: "p-app" }, { employees: { "p-app": "e-new", "p-req": "e-new" }, current: { "p-req": ["e-new"] } });
  assert.deepEqual([relinked.code, relinked.writes], ["SELF_APPROVAL_FORBIDDEN", []]);
  // 3b. the requester's Principal is now linked to the approver's Employee even though the request recorded another one
  const requesterNow = await run({ tenantId: T, principalId: "p-app" }, { employees: { "p-app": "e-app", "p-req": "e-req" }, current: { "p-req": ["e-app"] } });
  assert.deepEqual([requesterNow.code, requesterNow.writes], ["SELF_APPROVAL_FORBIDDEN", []]);
  // 4. an approver who is no Employee at all
  const none = await run({ tenantId: T, principalId: "p-nobody" }, {});
  assert.deepEqual([none.code, none.writes], ["APPROVER_EMPLOYEE_REQUIRED", []]);
  // REJECT is a decision too: the requester cannot reject (that is WITHDRAW), and the same people rule holds
  const reject = await failure(decide(mockPool(decideRules()), { tenantId: T, principalId: "p-req" }, { decision: "REJECT", amountMinor: undefined }));
  assert.equal(reject?.code, "SELF_APPROVAL_FORBIDDEN");
});

test("a SEPARATE Employee passes the people rule and the first write is the decision itself; the stated amount must equal the request's", async () => {
  // REJECT by a distinct Employee: the people rule passes, so the next statement is the UPDATE that records the decision (the stand-in then ends the run).
  const pool = mockPool(decideRules());
  const e = await failure(decide(pool, ACTOR, { decision: "REJECT", amountMinor: undefined, reason: "wrong customer" }));
  assert.match(e?.message ?? "", /UNEXPECTED SQL: UPDATE eos_finance\.invoice_corrections SET status = \$3/);
  // APPROVE of a different amount ("approving 100 is not approving 150")
  const wrong = mockPool(decideRules());
  const m = await failure(decide(wrong, ACTOR, { amountMinor: 150 }));
  assert.deepEqual([m?.code, writes(wrong.log)], ["APPROVAL_AMOUNT_MISMATCH", []]);
});

test("WITHDRAW is the requester's own; nobody else withdraws (they reject, with the approval key)", async () => {
  const pool = mockPool(decideRules());
  const e = await failure(decide(pool, ACTOR, { decision: "WITHDRAW", amountMinor: undefined }));
  assert.deepEqual([e?.code, writes(pool.log)], ["WITHDRAW_BY_REQUESTER_ONLY", []]);
  const own = mockPool(decideRules());
  const w = await failure(decide(own, { tenantId: T, principalId: "p-req" }, { decision: "WITHDRAW", amountMinor: undefined }));
  assert.match(w?.message ?? "", /UNEXPECTED SQL: UPDATE eos_finance\.invoice_corrections SET status = \$3/, "the requester reaches the decision write");
});

test("REPLAY writes nothing; the same key with a different decision is IDEMPOTENCY_KEY_REUSED; another decider finds it already decided", async () => {
  const fp = sha(["icr1", "APPROVE", "100", "checked"]);
  const applied = CORR({ status: "APPLIED", decided_by: "p-app", decided_by_employee_id: "e-app", decided_at: "2026-10-20T11:00:00Z", decision_reason: "checked", decision_idempotency_key: "k-1", decision_fingerprint: fp, fact_id: "ff1" });
  const pool = mockPool(decideRules({ row: applied }));
  const again = await decide(pool, ACTOR, {});
  assert.equal(again.outcome, "replayed");
  assert.deepEqual(writes(pool.log), [], "a replay writes no row, no fact and no audit");
  const different = await failure(decide(mockPool(decideRules({ row: applied })), ACTOR, { reason: "something else" }));
  assert.equal(different?.code, "IDEMPOTENCY_KEY_REUSED");
  const other = await failure(decide(mockPool(decideRules({ row: applied })), { tenantId: T, principalId: "p-other" }, {}));
  assert.equal(other?.code, "CORRECTION_NOT_PENDING");
  const otherKey = await failure(decide(mockPool(decideRules({ row: applied })), ACTOR, { idempotencyKey: "k-2" }));
  assert.equal(otherKey?.code, "CORRECTION_NOT_PENDING");
  const keyOfAnother = await failure(decide(mockPool(decideRules({ keyed: [{ "?column?": 1 }] })), ACTOR, {}));
  assert.equal(keyOfAnother?.code, "IDEMPOTENCY_KEY_REUSED", "a key names ONE decision of an actor");
});

test("a requester who is no access-eligible Employee cannot request (two people need two Employees), and the refusal writes nothing", async () => {
  const pool = mockPool([
    [/FROM eos_finance\.invoice_corrections WHERE tenant_id = \$1 AND requested_by = \$2 AND request_idempotency_key = \$3/, () => ({ rows: [] })],
    [/FROM eos_policy\.employee_principal_links l LEFT JOIN eos_workforce\.employees e/, () => ({ rows: [] })],
  ]);
  const e = await failure(corr.requestInvoiceCorrection(pool, ACTOR, { kind: "CREDIT_MEMO", invoiceId: "inv1", amountMinor: 1, reason: "r", idempotencyKey: "k" }));
  assert.deepEqual([e?.code, e?.category, writes(pool.log)], ["REQUESTER_EMPLOYEE_REQUIRED", "PRECONDITION_FAILED", []]);
});

// ════════════════════ authority and company: decided by the transport, before any write ════════════════════

const caller = (caps, companies = ["taylor"], principalId = "p-1") => ({
  actor: { tenantId: T, principalId, capabilities: new Set(caps) },
  operational: { scopedHeld: companies.map((c) => ({ capabilityKey: "finance.payment.read", scopeType: "operatingCompany", scopeValue: c, sourceRole: "controller", assignmentId: `a-${c}`, condition: null })) },
});
const transportRules = ({ invoices = {}, corrections = {} } = {}) => [
  [/SELECT operating_company_id FROM eos_policy\.tenant_operating_companies WHERE tenant_id = \$1 AND status = 'ACTIVE'/, () => ({ rows: [{ operating_company_id: "taylor" }, { operating_company_id: "ventana" }] })],
  [/SELECT o\.operating_company_id FROM eos_finance\.invoices i JOIN eos_finance\.obligations o/, (p) => ({ rows: invoices[p[1]] ? [{ operating_company_id: invoices[p[1]] }] : [] })],
  [/SELECT operating_company_id, kind FROM eos_finance\.invoice_corrections WHERE tenant_id = \$1 AND id = \$2/, (p) => ({ rows: corrections[p[1]] ? [{ operating_company_id: corrections[p[1]].company, kind: corrections[p[1]].kind }] : [] })],
  [/FROM eos_finance\.invoice_corrections WHERE tenant_id = \$1 AND requested_by = \$2/, () => ({ rows: [] })],
  [/FROM eos_policy\.employee_principal_links l LEFT JOIN eos_workforce\.employees e/, () => ({ rows: [{ employee_id: "e-1", employment_status: "ACTIVE" }] })],
  [/FROM eos_finance\.invoices i JOIN eos_finance\.obligations o ON o\.tenant_id = i\.tenant_id AND o\.id = i\.obligation_id WHERE i\.tenant_id = \$1 AND i\.id = \$2/, () => ({ rows: [] })],
  [/FROM eos_finance\.invoice_corrections WHERE tenant_id = \$1 AND id = \$2 FOR UPDATE/, () => ({ rows: [] })],
];
const op = (name, pool, who, input) => ops.EOS_FINANCE_OPERATIONS[name]({ pool }, who, input);
const REQ = { kind: "CREDIT_MEMO", invoiceId: "inv-t", amountMinor: 1, reason: "r", idempotencyKey: "k" };

test("REQUEST authority: a non-holder is refused; the kind decides the key; the company is the invoice's; a foreign company reads exactly like a missing invoice", async () => {
  const pool = () => mockPool(transportRules({ invoices: { "inv-t": "taylor", "inv-v": "ventana" } }));
  // a non-holder
  const p0 = pool();
  assert.equal((await failure(op("requestInvoiceCorrection", p0, caller(["finance.payment.read"]), REQ)))?.code, "CAPABILITY_REQUIRED");
  assert.deepEqual(p0.log, [], "refused before any query");
  // the refund key does not request a credit; the adjustment key does not request a refund
  assert.equal((await failure(op("requestInvoiceCorrection", pool(), caller(["finance.refund.record"]), REQ)))?.code, "CAPABILITY_REQUIRED");
  assert.equal((await failure(op("requestInvoiceCorrection", pool(), caller(["finance.adjustment.record"]), { ...REQ, kind: "REFUND", applicationId: "sap1" })))?.code, "CAPABILITY_REQUIRED");
  assert.equal((await failure(op("requestInvoiceCorrection", pool(), caller(["finance.adjustment.record"]), { ...REQ, kind: "NOPE" })))?.code, "CORRECTION_KIND_INVALID");
  // an APPROVAL key is not a request key
  assert.equal((await failure(op("requestInvoiceCorrection", pool(), caller(["finance.adjustment.approve"]), REQ)))?.code, "CAPABILITY_REQUIRED");
  // foreign company (Ventana invoice, Taylor-only caller) == missing invoice: identical code, category and message; neither wrote
  const foreign = pool(), missing = pool();
  const f = await failure(op("requestInvoiceCorrection", foreign, caller(["finance.adjustment.record"], ["taylor"]), { ...REQ, invoiceId: "inv-v" }));
  const m = await failure(op("requestInvoiceCorrection", missing, caller(["finance.adjustment.record"], ["taylor"]), { ...REQ, invoiceId: "inv-nowhere" }));
  assert.deepEqual([f?.code, f?.category], ["INVOICE_NOT_FOUND", "NOT_FOUND"]);
  assert.deepEqual([m?.code, m?.category, m?.message], [f?.code, f?.category, f?.message], "foreign reads exactly like missing");
  assert.deepEqual(writes(foreign.log), []);
  assert.deepEqual(writes(missing.log), []);
  // no Finance company assignment at all: nothing is reached
  const unassigned = await failure(op("requestInvoiceCorrection", pool(), caller(["finance.adjustment.record"], []), REQ));
  assert.equal(unassigned?.code, "INVOICE_NOT_FOUND");
});

test("DECIDE authority: the approval key of the KIND, at the correction's company; a requester-only holder cannot approve; foreign reads as missing; WITHDRAW uses the request key", async () => {
  const corrections = { "c-credit": { company: "taylor", kind: "CREDIT_MEMO" }, "c-refund": { company: "taylor", kind: "REFUND" }, "c-void": { company: "taylor", kind: "VOID" }, "c-foreign": { company: "ventana", kind: "CREDIT_MEMO" } };
  const pool = () => mockPool(transportRules({ corrections }));
  const approve = (who, id, over = {}) => failure(op("decideInvoiceCorrection", pool(), who, { correctionId: id, decision: "APPROVE", amountMinor: 1, reason: "r", idempotencyKey: "k", ...over }));
  // holds no approval key (only record keys): refused, and nothing is looked up
  const p0 = pool();
  assert.equal((await failure(op("decideInvoiceCorrection", p0, caller(["finance.adjustment.record", "finance.refund.record"]), { correctionId: "c-credit", decision: "APPROVE" })))?.code, "CAPABILITY_REQUIRED");
  assert.deepEqual(p0.log, []);
  // one approval key does not approve another kind
  assert.equal((await approve(caller(["finance.adjustment.approve"]), "c-refund"))?.code, "CAPABILITY_REQUIRED");
  assert.equal((await approve(caller(["finance.refund.approve"]), "c-credit"))?.code, "CAPABILITY_REQUIRED");
  assert.equal((await approve(caller(["finance.adjustment.approve", "finance.refund.approve"]), "c-void"))?.code, "CAPABILITY_REQUIRED", "a void needs finance.invoice.void.approve");
  // foreign company and a missing id read identically
  const f = await approve(caller(["finance.adjustment.approve"], ["taylor"]), "c-foreign");
  const m = await approve(caller(["finance.adjustment.approve"], ["taylor"]), "c-nowhere");
  assert.deepEqual([f?.code, f?.category], ["CORRECTION_NOT_FOUND", "NOT_FOUND"]);
  assert.deepEqual([m?.code, m?.category, m?.message], [f?.code, f?.category, f?.message]);
  // WITHDRAW is decided with the REQUEST key, not an approval key
  assert.equal((await approve(caller(["finance.adjustment.approve"]), "c-credit", { decision: "WITHDRAW", amountMinor: undefined }))?.code, "CAPABILITY_REQUIRED");
  // a holder at the right company and key reaches the command (which then reads the stand-in's empty row as missing)
  assert.equal((await approve(caller(["finance.adjustment.approve"], ["taylor"]), "c-credit"))?.code, "CORRECTION_NOT_FOUND");
});

test("the transport decides capability, then the company, then calls the command (source order), and the operations are on the Finance table", () => {
  for (const name of ["requestInvoiceCorrection", "decideInvoiceCorrection", "listInvoiceCorrections", "readInvoiceCorrection"]) assert.ok(ops.FINANCE_OPERATIONS.includes(name), name);
  const body = code("eosFinance/financeOperations.ts");
  const req = body.slice(body.indexOf("requestInvoiceCorrection: async"), body.indexOf("decideInvoiceCorrection: async"));
  assert.ok(req.indexOf("CAPABILITY_REQUIRED") < req.indexOf("fullReachedCompanies(") && req.indexOf("fullReachedCompanies(") < req.indexOf("return requestInvoiceCorrection("), "request: key, company, command");
  assert.match(req, /refuse\("INVOICE_NOT_FOUND", "NOT_FOUND"/);
  const dec = body.slice(body.indexOf("decideInvoiceCorrection: async"), body.indexOf("listInvoiceCorrections: async"));
  assert.ok(dec.indexOf("CAPABILITY_REQUIRED") < dec.indexOf("correctionScope(") && dec.indexOf("correctionScope(") < dec.indexOf("requireCapability(") && dec.indexOf("requireCapability(") < dec.indexOf("return decideInvoiceCorrection("),
    "decide: any key, the company, the kind's key, then the command");
  assert.match(dec, /refuse\("CORRECTION_NOT_FOUND", "NOT_FOUND"/);
  assert.match(code("adminPolicy/assignmentScopeRuntime.ts"), /"operations\.requestInvoiceCorrection", "operations\.decideInvoiceCorrection"/, "the company-scoped consumers list names them");
  // reads are FULL reach only
  const reads = body.slice(body.indexOf("listInvoiceCorrections: async"), body.indexOf("supplyReceiptCostEvidence:"));
  assert.equal(count(reads, "fullReachedCompanies(deps, caller, FINANCE_VIEW_CAPABILITY)"), 2);
});

// ════════════════════ adjustments happen only on approval; one audit row; replay writes nothing ════════════════════

test("an adjustment fact is written in ONE place: the approval's effect, after the decision row is APPLIED", () => {
  const src = code("eosFinance/invoiceCorrection.ts");
  assert.equal(count(src, "insertObligationAdjustmentFactOn("), 1);
  assert.equal(count(src, "applyEffectOn("), 2, "its definition and its single call");
  const callAt = src.indexOf("effect = await applyEffectOn(");
  assert.ok(callAt > src.indexOf("SET status = $3, decided_by") && src.indexOf("if (decision === \"APPROVE\") effect = await applyEffectOn(") === callAt - "if (decision === \"APPROVE\") ".length,
    "applied only for APPROVE, after the row records the decision");
  assert.ok(src.indexOf("eligibilityOn(c, actor, { kind, invoiceId: String(corr.invoice_id)") < src.indexOf("SET status = $3, decided_by"), "eligibility is re-decided before the row becomes APPLIED");
  for (const f of readdirSync(join(ROOT, "src", "eosFinance")).filter((n) => n.endsWith(".ts") && n !== "invoiceCorrection.ts" && n !== "financeFoundation.ts" && n !== "accountingDelivery.ts")) {
    assert.doesNotMatch(code(`eosFinance/${f}`), /insertObligationAdjustmentFactOn|RECEIVABLE_CREDITED|RECEIVABLE_WRITTEN_OFF|RECEIVABLE_CHARGED/, `${f} writes no adjustment fact`);
  }
  // credits and write-offs are negative, debits positive; the invoice is never updated except by the governed void
  assert.match(src, /amountMinor: kind === "DEBIT_CHARGE" \? amount : -amount/);
  assert.equal(count(src, "UPDATE eos_finance.invoices"), 1, "the only invoice write is the governed void");
  assert.doesNotMatch(src, /DELETE FROM|UPDATE eos_finance\.invoice_lines|INSERT INTO eos_finance\.invoice_lines|UPDATE eos_finance\.obligations/, "the invoice, its lines and the receivable row are not edited");
});

test("ONE audit row per applied command, inside the command's transaction, never on a replay or a refusal; no free text beyond the governed reason", () => {
  const src = code("eosFinance/invoiceCorrection.ts");
  assert.equal(count(src, "recordCommandAudit("), 2, "one in request, one in decide (approve / reject / withdraw)");
  for (const action of ["finance.correction.request", "finance.correction.approve", "finance.correction.reject", "finance.correction.withdraw"]) assert.ok(src.includes(`"${action}"`), action);
  const req = src.slice(src.indexOf("export async function requestInvoiceCorrection"), src.indexOf("// ════════════════════ decide"));
  assert.ok(req.indexOf('outcome: "replayed"') < req.indexOf("INSERT INTO eos_finance.invoice_corrections") && req.indexOf("INSERT INTO eos_finance.invoice_corrections") < req.indexOf("recordCommandAudit("), "request: replay returns first; the audit follows the write");
  const dec = src.slice(src.indexOf("export async function decideInvoiceCorrection"));
  assert.ok(dec.indexOf('outcome: "replayed"') < dec.indexOf("SET status = $3, decided_by") && dec.indexOf("SET status = $3, decided_by") < dec.indexOf("recordCommandAudit("), "decide: replay first; the audit follows the writes");
  assert.ok(dec.indexOf("return tx(pool") < dec.indexOf("recordCommandAudit("), "inside the one transaction (tx: BEGIN .. COMMIT / ROLLBACK)");
  const audits = src.slice(src.indexOf("recordCommandAudit("));
  assert.doesNotMatch(audits, /notes|description|instructions|comment/i);
});

// ════════════════════ a refund records, it never pays (OD-F1-11) ════════════════════

test("a refund creates NO external payment: no operation, module, settlement kind or call can execute, send or initiate money (a refund is a recorded fact, not cash sent)", () => {
  const names = ops.FINANCE_OPERATIONS;
  assert.deepEqual(names.filter((n) => /payout|disburs|cashout|cash_out|sendmoney|send|execute|initiate|transfer|wire|release|pay[A-Z]|^pay$/i.test(n)), [],
    "the Finance table has no operation that moves money out");
  // the refund RECORD is a settlement kind that recordSettlement can never create
  assert.ok(!settlement.SETTLEMENT_KINDS.includes("CUSTOMER_REFUND"));
  assert.equal(settlement.CUSTOMER_REFUND_KIND, "CUSTOMER_REFUND");
  assert.equal(settlement.SETTLEMENT_DIRECTION.CUSTOMER_PAYMENT, "RECEIPT");
  const src = code("eosFinance/invoiceCorrection.ts");
  const stl = code("eosFinance/settlement.ts");
  for (const [file, body] of [["invoiceCorrection.ts", src], ["settlement.ts", stl]]) {
    assert.doesNotMatch(body, /fetch\(|https?:\/\/|axios|XMLHttpRequest|stripe|plaid|dwolla|bankapi|paymentprovider|initiatePayment|executePayment|sendPayment|submitPayment|achTransfer|wireTransfer/i, `${file}: no network or payment-provider call`);
  }
  const refundEffect = src.slice(src.indexOf('if (kind === "REFUND") {'), src.indexOf("const voided = await c.query("));
  assert.ok(refundEffect.includes("recordRefundFactOn("), "the refund effect is read from the right block");
  assert.doesNotMatch(refundEffect, /accounting|handoff|provider|deliver/i, "a refund queues nothing for any provider");
  assert.doesNotMatch(src, /(INSERT INTO|UPDATE)\s+eos_finance\.accounting|accountingDelivery/, "this module writes no accounting handoff (a void's handoff is superseded by the existing retirement path)");
  assert.doesNotMatch(src, /INSERT INTO eos_finance\.settlements/, "the refund record is written by the settlement module only");
  assert.match(stl, /'DISBURSEMENT'[\s\S]{0,400}NULL,NULL,NULL,NULL/, "the record carries no method, correlation, replacement or notes: nothing to execute");
  // the only writer of a settlement kind CUSTOMER_REFUND in the whole backend
  const writers = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".ts") && /CUSTOMER_REFUND/.test(readFileSync(p, "utf8"))) writers.push(p.slice(ROOT.length + 5).replaceAll("\\", "/")); } };
  walk(join(ROOT, "src"));
  assert.deepEqual(writers.sort(), ["eosFinance/invoiceCorrection.ts", "eosFinance/settlement.ts"]);
});

test("recordSettlement cannot create a refund record: CUSTOMER_REFUND is not an accepted kind, refused before any connection", async () => {
  const e = await failure(settlement.recordFinancialSettlement(NO_DB, ACTOR, { operatingCompanyId: "taylor", counterparty: { kind: "EXTERNAL_ORGANIZATION", crmAccountId: "a" },
    kind: "CUSTOMER_REFUND", amountMinor: 100, currency: "USD", sourceReference: "x", idempotencyKey: "k" }));
  assert.equal(e?.code, "SETTLEMENT_KIND_INVALID");
});

// ════════════════════ void: only before any settlement or adjustment ════════════════════

test("VOID eligibility is decided in code AND by the database: any application (reversed or not), settlement fact, applied adjustment or delivered handoff refuses it", () => {
  const src = code("eosFinance/invoiceCorrection.ts");
  const voidCase = src.slice(src.indexOf('case "VOID": {'), src.indexOf("return { inv, balance, app };"));
  for (const code_ of ["VOID_AFTER_SETTLEMENT", "VOID_AFTER_ADJUSTMENT", "ACCOUNTING_HANDOFF_DELIVERED", "VOID_NOT_APPLICABLE"]) assert.ok(voidCase.includes(code_), code_);
  assert.match(voidCase, /FROM eos_finance\.settlement_applications WHERE tenant_id = \$1 AND obligation_id = \$2 LIMIT 1/, "ANY application, whatever its status");
  assert.match(voidCase, /fact_class = 'SETTLEMENT'/);
  assert.match(voidCase, /invoice_corrections WHERE tenant_id = \$1 AND invoice_id = \$2 AND status = 'APPLIED'/);
  // the effect: the invoice's void columns first, then the receivable and handoff through the existing retirement path (which refuses a delivered handoff)
  const effect = src.slice(src.indexOf("const voided = await c.query("));
  assert.ok(effect.indexOf("UPDATE eos_finance.invoices SET voided_at") < effect.indexOf("retirePackageReceivableOn("));
  assert.doesNotMatch(src, /invoice_number\s*=|allocateInvoiceNumber|invoice_number_counters/, "a void never touches numbering: the number is not reused");
});

// ════════════════════ grants: NONE (Owner 2026-10-20) ════════════════════

test("NO approval key is granted to anyone: the baseline carries no pair, no catalog or Protected Administrator standing confers it, and the Owner-only proposal is recorded as UNAPPLIED", () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
  assert.deepEqual(baseline.grants.filter((g) => corr.CORRECTION_APPROVAL_CAPABILITIES.includes(g.capabilityKey)), [], "grants +0: no baseline pair");
  assert.equal(baseline.totalGrants, baseline.grants.length);
  // Protected Administrator standing implies only ADMIN_ACTION / READ keys (and a named list); these are BUSINESS_ACTION and on no list.
  const pa = require("../lib/adminPolicy/protectedAdministrator.js");
  for (const [key, objectKey] of [["finance.adjustment.approve", "invoice"], ["finance.refund.approve", "payment"], ["finance.invoice.void.approve", "invoice"]]) {
    assert.equal(pa.isImpliedForProtectedAdministrator({ key, objectKey, actionKind: "BUSINESS_ACTION" }), false, `${key}: not implied by Administrator standing`);
    assert.ok(!pa.PROTECTED_ADMINISTRATOR_MANAGEMENT_CAPABILITIES.has(key));
    // No default catalog (Firebase-compatible or governed business Role, environment overrides, client catalog) names it.
    for (const file of ["access/compatibilityRoles.ts", "access/governedBusinessRoles.ts", "access/permissionCatalog.ts", "access/environmentCapabilityOverrides.ts"]) {
      assert.ok(!readFileSync(join(ROOT, "src", file), "utf8").includes(key), `${file} does not name ${key}`);
    }
  }
  // The proposal: Owner only, three pairs, every one UNAPPLIED; the earlier 15-pair proposal is gone.
  const proposal = JSON.parse(readFileSync(resolve(ROOT, "..", "docs/architecture/f1b-invoice-correction-grant-proposal.json"), "utf8"));
  assert.match(proposal.status, /UNAPPLIED/);
  assert.deepEqual(proposal.proposedGrants.map((g) => [g.roleKey, g.capabilityKey, g.applied]).sort(),
    [["owner", "finance.adjustment.approve", false], ["owner", "finance.invoice.void.approve", false], ["owner", "finance.refund.approve", false]]);
  assert.deepEqual([...proposal.explicitlyNotGranted].sort(), ["accountingManager", "admin", "controller", "financeManager", "generalManager", "partsManager"]);
  for (const k of Object.values(proposal.authorityMatrix)) assert.deepEqual([k.proposedHolder, k.applied], ["owner", false]);
});

test("the Owner cannot approve the Owner's own request: same Principal (and Employee) is refused before any write", async () => {
  const owner = { tenantId: T, principalId: "p-owner" };
  const row = CORR({ requested_by: "p-owner", requested_by_employee_id: "e-owner" });
  for (const decision of ["APPROVE", "REJECT"]) {
    const pool = mockPool(decideRules({ row, employees: { "p-owner": "e-owner" }, current: { "p-owner": ["e-owner"] } }));
    const e = await failure(decide(pool, owner, { decision, ...(decision === "REJECT" ? { amountMinor: undefined } : {}) }));
    assert.deepEqual([e?.code, writes(pool.log)], ["SELF_APPROVAL_FORBIDDEN", []], decision);
  }
});

// ════════════════════ delivery, rebill, lines, vocabulary ════════════════════

test("B1: accounting delivery anchors on the receivable AS ISSUED (origination facts), never the adjusted total", () => {
  const src = code("eosFinance/accountingDelivery.ts");
  assert.match(src, /export const ORIGINATED_AS_ISSUED_SQL/);
  assert.equal(count(src, "${ORIGINATED_AS_ISSUED_SQL} AS originated_minor"), 2, "the direct / rental anchor and the financed customer receivable");
  assert.doesNotMatch(src, /obligation_balances/, "delivery no longer reads the adjusted balance");
  assert.match(src, /NOT IN \('RECEIVABLE_CREDITED', 'RECEIVABLE_CHARGED', 'RECEIVABLE_WRITTEN_OFF'\)/);
});

test("F3: a void RETIRES the package and a re-prepare takes the next version even when no package is current", () => {
  assert.match(code("eosFinance/invoiceCorrection.ts"), /UPDATE eos_finance\.billing_packages SET status = 'SUPERSEDED'/);
  const bp = code("eosFinance/billingPackage.ts");
  assert.match(bp, /ORDER BY version DESC LIMIT 1/);
  assert.match(bp, /const version = current\[0\] \? Number\(current\[0\]\.version\) \+ 1 : prior\[0\] \? Number\(prior\[0\]\.version\) \+ 1 : 1;/);
});

test("F4: no correction path writes invoice lines (or the invoice's amounts) in any transaction", () => {
  const src = code("eosFinance/invoiceCorrection.ts");
  assert.doesNotMatch(src, /invoice_lines/, "no read-modify-write of lines at all");
  assert.equal(count(src, "UPDATE eos_finance.invoices"), 1);
  assert.match(src, /UPDATE eos_finance\.invoices SET voided_at = now\(\), void_reason = \$3, voided_by = \$4 WHERE/, "the only invoice write sets the three void columns");
});

test("F6 and refund vocabulary: the refund is a recorded fact, never a payment; the result says so; settlements report refundedMinor", () => {
  assert.equal(corr.REFUND_NOTICE, "refund recorded; no payment has been sent");
  const view = corr.correctionView({ id: "i", operating_company_id: "taylor", invoice_id: "v", invoice_number: "INV-1", obligation_id: "o", kind: "REFUND", amount_minor: "5", currency: "USD", reason: "r",
    status: "APPLIED", requested_by: "a", requested_by_employee_id: "e1", requested_at: "2026-10-20T00:00:00Z", decided_by: "b", decided_by_employee_id: "e2", decided_at: "2026-10-20T00:00:00Z",
    decision_reason: "r", refund_settlement_id: "stl1", settlement_id: "stl0", application_id: "sap" });
  assert.deepEqual([view.refundRecorded, view.notice, view.refundRecordId], [true, "refund recorded; no payment has been sent", "stl1"]);
  assert.equal(corr.correctionView({ ...view, id: "i", invoice_id: "v", operating_company_id: "taylor", obligation_id: "o", invoice_number: "n", kind: "REFUND", amount_minor: "5", currency: "USD", reason: "r", status: "PENDING",
    requested_by: "a", requested_by_employee_id: "e1", requested_at: "2026-10-20T00:00:00Z" }).refundRecorded, false);
  const src = code("eosFinance/invoiceCorrection.ts") + code("eosFinance/settlement.ts");
  assert.doesNotMatch(src, /payout|pay_out|cashOut|cash_out|sendMoney|disburseNow|executeRefund|issueRefundPayment/i);
  assert.match(code("eosFinance/settlement.ts"), /refundedMinor: String\(b\.refunded_minor \?\? 0\)/);
});
