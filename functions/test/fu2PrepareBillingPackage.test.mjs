// FU-2, offline -- the governed rebill trigger (prepareBillingPackage on /operations/finance) and the server-derived Issue eligibility (DECISIONS #F-1b addendum).
// No database: the real-database proof is functions/test/fu2PrepareBillingPackagePostgres.test.mjs. This file proves, with a recording stand-in for the connection,
// what the CODE decides:
//   * REGISTRATION: the operation exists, is the SAME capability as issuing (no new key), and the client mirrors it;
//   * AUTHORITY, before any write: a non-holder is refused before any query; a foreign, missing or unresolvable-company order reads exactly alike;
//   * COMMAND: input is closed; the Sales Order row is locked FIRST; a missing or not-ELIGIBLE order rolls back with zero writes; a key replay writes nothing and
//     returns the recorded package; the same key for another order is IDEMPOTENCY_KEY_REUSED;
//   * ONE PREDICATE: issueBlocker is the only place the issue refusals are decided, used by the command AND the receivable read, and it names a financed sale.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ops = require("../lib/eosFinance/financeOperations.js");
const issue = require("../lib/eosFinance/invoiceIssue.js");
const pkg = require("../lib/eosFinance/billingPackage.js");
const src = (file) => readFileSync(join(ROOT, "src", file), "utf8");
const code = (file) => src(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const T = "t-fu2";
const ACTOR = { tenantId: T, principalId: "p-app" };

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
const failure = async (p) => { try { await p; } catch (e) { return e; } return null; };

// ════════════════════ registration ════════════════════

test("REGISTRATION: prepareBillingPackage is a Finance operation on the invoice-issue key (no new capability) and the client mirrors it", () => {
  assert.equal(typeof ops.EOS_FINANCE_OPERATIONS.prepareBillingPackage, "function");
  assert.ok(ops.FINANCE_OPERATIONS.includes("prepareBillingPackage"));
  const body = code("eosFinance/financeOperations.ts");
  const start = body.indexOf("prepareBillingPackage: async");
  const op = body.slice(start, body.indexOf("requestInvoiceCorrection: async", start));
  assert.match(op, /requireCapability\(caller, INVOICE_ISSUE_CAPABILITY\)/, "the first half of issuing: the SAME key");
  assert.ok(op.indexOf("requireCapability") < op.indexOf("deps.pool.query"), "capability before any read");
  assert.ok(op.indexOf("fullReachedCompanies") < op.indexOf("prepareBillingPackageCommand"), "company authority before the command");
  assert.doesNotMatch(op, /finance\.billingPackage|finance\.invoice\.prepare/, "no new capability key");
  const client = readFileSync(join(ROOT, "..", "field-ops-app-vite", "src", "services", "financeApiClient.js"), "utf8");
  assert.match(client, /FINANCE_COMMAND_OPERATIONS = Object\.freeze\(\[[^\]]*"prepareBillingPackage"/s, "the browser client's closed list names it");
});

// ════════════════════ authority: decided by the transport, before any write ════════════════════

const caller = (caps, companies = ["taylor"], principalId = "p-1") => ({
  actor: { tenantId: T, principalId, capabilities: new Set(caps) },
  operational: { scopedHeld: companies.map((c) => ({ capabilityKey: "finance.payment.read", scopeType: "operatingCompany", scopeValue: c, sourceRole: "controller", assignmentId: `a-${c}`, condition: null })) },
});
const transportRules = (orders = {}) => [
  [/SELECT operating_company_id FROM eos_policy\.tenant_operating_companies WHERE tenant_id = \$1 AND status = 'ACTIVE'/, () => ({ rows: [{ operating_company_id: "taylor" }, { operating_company_id: "ventana" }] })],
  [/FROM eos_commercial\.sales_orders so LEFT JOIN eos_policy\.tenant_operating_company_keys k/, (p) => ({ rows: p[1] in orders ? [{ operating_company_id: orders[p[1]] }] : [] })],
];
const op = (pool, who, input) => ops.EOS_FINANCE_OPERATIONS.prepareBillingPackage({ pool }, who, input);
const IN = { salesOrderId: "so-t", idempotencyKey: "k-1" };
const HOLDER = ["finance.invoice.issue"];

test("AUTHORITY: a non-holder is refused before any query; a foreign, missing or company-unresolvable order reads exactly alike; nothing is written", async () => {
  const pool = () => mockPool(transportRules({ "so-t": "taylor", "so-v": "ventana", "so-nokey": null }));
  const p0 = pool();
  assert.equal((await failure(op(p0, caller(["finance.payment.read"]), IN)))?.code, "CAPABILITY_REQUIRED");
  assert.equal((await failure(op(p0, caller(["finance.settlement.apply"]), IN)))?.code, "CAPABILITY_REQUIRED");
  assert.deepEqual(p0.log, [], "refused before any query");
  const answers = [];
  for (const id of ["so-v", "so-nowhere", "so-nokey"]) {
    const p = pool();
    const e = await failure(op(p, caller(HOLDER, ["taylor"]), { ...IN, salesOrderId: id }));
    answers.push([e?.code, e?.category, e?.message]);
    assert.deepEqual(writes(p.log), [], id);
  }
  assert.deepEqual(answers[0], ["SALES_ORDER_NOT_FOUND", "NOT_FOUND", "no Sales Order with that id"]);
  assert.deepEqual(answers[1], answers[0], "foreign == missing");
  assert.deepEqual(answers[2], answers[0], "an order whose company cannot be resolved is refused the same way");
  // no Finance company assignment at all: nothing is reached
  assert.equal((await failure(op(pool(), caller(HOLDER, []), IN)))?.code, "SALES_ORDER_NOT_FOUND");
});

// ════════════════════ the command ════════════════════

test("COMMAND input is closed and refused before any connection", async () => {
  const noDb = { connect: async () => { throw new Error("NO_CONNECTION"); } };
  const run = async (input) => (await failure(pkg.prepareBillingPackageCommand(noDb, ACTOR, input)))?.code;
  assert.equal(await run({ idempotencyKey: "k" }), "SALES_ORDER_ID_REQUIRED");
  assert.equal(await run({ salesOrderId: "so-1" }), "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await run({ salesOrderId: "so-1", idempotencyKey: " " }), "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await run({ salesOrderId: "so-1", idempotencyKey: "k", operatingCompanyId: "taylor" }), "FIELD_NOT_ACCEPTED", "the company is the order's, never a field");
});

const cmdRules = ({ order = true, audit = [], live = [], facts = { fully_eligible: true, has_current: false, latest_voided: true } } = {}) => [
  [/FROM eos_commercial\.sales_orders WHERE tenant_id = \$1 AND id = \$2 FOR NO KEY UPDATE/, () => ({ rows: order ? [{ id: "so-1" }] : [] })],
  [/pg_advisory_xact_lock\(hashtext\(\$1\)\)/, () => ({ rows: [{}] })],
  [/FROM eos_policy\.audit_events WHERE tenant_id = \$1 AND action = 'finance\.billingPackage\.prepare' AND actor_uid = \$2 AND after @> jsonb_build_object\('idempotencyKey', \$3::text\) ORDER BY occurred_at, id LIMIT 1/, () => ({ rows: audit })],
  [/FROM eos_finance\.billing_packages WHERE tenant_id = \$1 AND id = \$2$/, () => ({ rows: live })],
  [/^SELECT \(SELECT count\(\*\) > 0 AND count\(\*\) = count\(\*\) FILTER/, () => ({ rows: [facts] })],
  [/FROM eos_commercial\.sales_orders so LEFT JOIN eos_commercial\.sales_agreements a/, () => ({ rows: [{ id: "so-1", state: "IN_FULFILLMENT", operating_company_key: "taylor", account_id: "acct-a", currency: "USD", sales_agreement_id: null }] })],
  [/FROM eos_commercial\.sales_order_line_billing_eligibility WHERE tenant_id = \$1 AND sales_order_id = \$2/, () => ({ rows: [{ line_number: 1, eligibility: "NOT_YET" }] })],
];
const noPrepare = (log) => !log.some((s) => /sales_orders so LEFT JOIN/.test(s));

test("COMMAND: the Sales Order is locked first; a missing order and every rebill blocker roll back with ZERO writes, before any preparation", async () => {
  const missing = mockPool(cmdRules({ order: false }));
  const e1 = await failure(pkg.prepareBillingPackageCommand(missing, ACTOR, { salesOrderId: "so-1", idempotencyKey: "k" }));
  assert.deepEqual([e1?.code, e1?.category], ["SALES_ORDER_NOT_FOUND", "NOT_FOUND"]);
  assert.deepEqual(writes(missing.log), []);
  assert.match(missing.log[1], /FOR NO KEY UPDATE/, "the order row is the first statement after BEGIN: two prepares of one order take turns");
  const cases = [
    [{ fully_eligible: false, has_current: false, latest_voided: true }, "SALES_ORDER_NOT_ELIGIBLE", "PRECONDITION_FAILED"],
    [{ fully_eligible: true, has_current: true, latest_voided: true }, "BILLING_PACKAGE_ALREADY_PREPARED", "CONFLICT"],
    [{ fully_eligible: true, has_current: true, latest_voided: false }, "BILLING_PACKAGE_ALREADY_PREPARED", "CONFLICT"], // a live package is never re-versioned, whatever its evidence
    [{ fully_eligible: true, has_current: false, latest_voided: false }, "NOT_LATEST_VOIDED_INVOICE", "PRECONDITION_FAILED"], // the latest invoice is live
    [{ fully_eligible: true, has_current: false, latest_voided: null }, "NOT_LATEST_VOIDED_INVOICE", "PRECONDITION_FAILED"], // never invoiced: not a rebill
  ];
  for (const [facts, codeExpected, categoryExpected] of cases) {
    const pool = mockPool(cmdRules({ facts }));
    const e = await failure(pkg.prepareBillingPackageCommand(pool, ACTOR, { salesOrderId: "so-1", idempotencyKey: "k" }));
    assert.deepEqual([e?.code, e?.category], [codeExpected, categoryExpected], JSON.stringify(facts));
    assert.deepEqual(writes(pool.log), [], "zero trace");
    assert.ok(noPrepare(pool.log), "refused BEFORE the preparation runs");
    assert.equal(pool.log.at(-1), "ROLLBACK");
    assert.ok(!pool.log.includes("COMMIT"));
  }
});

test("REPLAY: the same key returns the LIVE package row and writes nothing; the same key for another order is IDEMPOTENCY_KEY_REUSED; the lookup is serialized and indexed", async () => {
  const audit = [{ target_id: "bpk_2", after: { salesOrderId: "so-1", version: 2, status: "READY", readinessExceptions: [], totalMinor: "3000", idempotencyKey: "k-1" } }];
  // the package has moved on since the command applied (voided again): the replay answers what is true now, not the snapshot
  const live = [{ id: "bpk_2", version: 2, status: "SUPERSEDED", readiness_exceptions: [], total_minor: "3000" }];
  const pool = mockPool(cmdRules({ audit, live }));
  const r = await pkg.prepareBillingPackageCommand(pool, ACTOR, { salesOrderId: "so-1", idempotencyKey: "k-1" });
  assert.deepEqual({ ...r }, { outcome: "replayed", packageId: "bpk_2", version: 2, status: "SUPERSEDED", readinessExceptions: [], totalMinor: "3000" });
  assert.deepEqual(writes(pool.log), []);
  assert.equal(pool.log.at(-1), "COMMIT");
  assert.ok(noPrepare(pool.log));
  const lockAt = pool.log.findIndex((s) => /pg_advisory_xact_lock/.test(s)), lookupAt = pool.log.findIndex((s) => /FROM eos_policy\.audit_events/.test(s));
  assert.ok(lockAt > 0 && lockAt < lookupAt, "the per-(actor, key) advisory lock is taken BEFORE the key lookup");
  const other = mockPool(cmdRules({ audit, live }));
  const e = await failure(pkg.prepareBillingPackageCommand(other, ACTOR, { salesOrderId: "so-9", idempotencyKey: "k-1" }));
  assert.deepEqual([e?.code, e?.category], ["IDEMPOTENCY_KEY_REUSED", "CONFLICT"]);
  assert.deepEqual(writes(other.log), []);
});

test("PREDICATE: rebillBlocker is REBILL ONLY -- eligible in full, no current package, latest invoice voided -- and names the first failing condition", () => {
  const b = (o) => pkg.rebillBlocker({ orderFullyEligible: true, hasCurrentPackage: false, latestInvoiceVoided: true, ...o })?.code ?? null;
  assert.equal(b({}), null);
  assert.equal(b({ orderFullyEligible: false }), "SALES_ORDER_NOT_ELIGIBLE");
  assert.equal(b({ orderFullyEligible: false, hasCurrentPackage: true, latestInvoiceVoided: false }), "SALES_ORDER_NOT_ELIGIBLE", "eligibility is named first");
  assert.equal(b({ hasCurrentPackage: true }), "BILLING_PACKAGE_ALREADY_PREPARED");
  assert.equal(b({ hasCurrentPackage: true, latestInvoiceVoided: false }), "BILLING_PACKAGE_ALREADY_PREPARED");
  assert.equal(b({ latestInvoiceVoided: false }), "NOT_LATEST_VOIDED_INVOICE", "never invoiced, or the latest invoice is live: not a rebill");
  assert.equal(pkg.rebillBlocker({ orderFullyEligible: true, hasCurrentPackage: true, latestInvoiceVoided: true }).category, "CONFLICT");
});

test("ONE FUNCTION, TWO CALLERS (rebill): the command and the receivable read both decide through rebillBlocker, and the key lookup uses the GIN-indexed containment", () => {
  const cmd = code("eosFinance/billingPackage.ts");
  const body = cmd.slice(cmd.indexOf("export async function prepareBillingPackageCommand"), cmd.indexOf("export async function prepareEligibleBillingPackages"));
  assert.match(body, /rebillBlocker\(\{/);
  assert.match(body, /after @> jsonb_build_object\('idempotencyKey', \$3::text\)/);
  assert.doesNotMatch(body, /->>/, "no ->> equality on the audit row: it cannot use the GIN index");
  assert.match(body, /ORDER BY occurred_at, id LIMIT 1/);
  const read = code("eosFinance/financeOperations.ts");
  assert.match(read, /rebillBlocker\(\{ orderFullyEligible/);
  assert.doesNotMatch(read, /BILLING_PACKAGE_ALREADY_PREPARED|SALES_ORDER_NOT_ELIGIBLE|NOT_LATEST_VOIDED_INVOICE/, "the read re-states no rebill refusal");
});

test("ONE AUDIT ROW per applied command: the existing preparation audit row carries the key, and the command writes no other row of its own", () => {
  const body = code("eosFinance/billingPackage.ts");
  const cmd = body.slice(body.indexOf("export async function prepareBillingPackageCommand"), body.indexOf("export async function prepareEligibleBillingPackages"));
  assert.doesNotMatch(cmd, /INSERT|UPDATE |DELETE/, "the command itself inserts nothing; the one audit row is prepareBillingPackageOn's");
  assert.match(body, /finance\.billingPackage\.prepare/);
  assert.match(body, /idempotencyKey: input\.idempotencyKey/, "the key rides on that row");
});

// ════════════════════ one predicate for Issue ════════════════════

const P = (over = {}) => ({ source_kind: "SALES_ORDER", tax_evidence_status: "DETERMINED", tax_minor: "0", status: "READY", readiness_exceptions: [], obligor_basis: "DIRECT_SALE_CUSTOMER",
  counterparty_id: "cp1", operating_company_id: "taylor", currency: "USD", ...over });
const O = (over = {}) => ({ status: "OPEN", operating_company_id: "taylor", currency: "USD", ...over });

test("PREDICATE: issueBlocker names every refusal, in the command's order, and is null only for an issuable direct sale", () => {
  const b = (p, o, n = null) => issue.issueBlocker(p, o, n)?.code ?? null;
  assert.equal(b(P(), O()), null);
  assert.equal(b(P({ obligor_basis: "FINANCING_PROVIDER_FUNDED" }), O()), "UNSUPPORTED_FINANCIAL_OBLIGOR", "a financed sale is never issuable");
  assert.equal(b(P({ obligor_basis: "UNRESOLVED", counterparty_id: null }), O()), "UNSUPPORTED_FINANCIAL_OBLIGOR");
  assert.equal(b(null, O()), "UNSUPPORTED_BILLING_SOURCE");
  assert.equal(b(P({ source_kind: "RENTAL" }), O()), "UNSUPPORTED_BILLING_SOURCE");
  assert.equal(b(P({ tax_evidence_status: "NOT_DETERMINED", tax_minor: null, status: "HELD" }), O()), "TAX_NOT_DETERMINED", "tax is named before readiness");
  assert.equal(b(P({ status: "HELD" }), O()), "BILLING_PACKAGE_NOT_READY");
  assert.equal(b(P({ status: "SUPERSEDED" }), O()), "BILLING_PACKAGE_NOT_READY");
  assert.equal(b(P({ status: "HELD", obligor_basis: "FINANCING_PROVIDER_FUNDED" }), O()), "BILLING_PACKAGE_NOT_READY", "readiness is named before the obligor");
  assert.equal(b(P(), null), "RECEIVABLE_NOT_ESTABLISHED");
  assert.equal(b(P(), O({ status: "VOID" })), "RECEIVABLE_VOID");
  assert.equal(b(P(), O({ currency: "CAD" })), "RECEIVABLE_PACKAGE_MISMATCH");
  assert.equal(b(P(), O({ operating_company_id: "ventana" })), "RECEIVABLE_PACKAGE_MISMATCH");
  assert.equal(b(P(), O(), "INV-2026-000001"), "INVOICE_ALREADY_ISSUED");
  // the category the command refuses with
  assert.equal(issue.issueBlocker(P({ obligor_basis: "FINANCING_PROVIDER_FUNDED" }), O(), null).category, "PRECONDITION_FAILED");
  assert.equal(issue.issueBlocker(P(), O(), "INV-1").category, "CONFLICT");
});

test("ONE FUNCTION, TWO CALLERS: the command and the receivable read both decide through issueBlocker; neither re-states a refusal", () => {
  const cmd = code("eosFinance/invoiceIssue.ts");
  const body = cmd.slice(cmd.indexOf("export async function issueFinancialInvoice"));
  assert.match(body, /issueBlocker\(p, o, /);
  for (const c of ["UNSUPPORTED_BILLING_SOURCE", "TAX_NOT_DETERMINED", "BILLING_PACKAGE_NOT_READY", "UNSUPPORTED_FINANCIAL_OBLIGOR", "RECEIVABLE_VOID", "RECEIVABLE_PACKAGE_MISMATCH", "INVOICE_ALREADY_ISSUED"]) {
    assert.ok(!body.includes(`"${c}"`), `${c} lives only in issueBlocker`);
  }
  const read = code("eosFinance/financeOperations.ts");
  assert.match(read, /issueBlocker\(pkg, receivable, r\.invoice_number \?\? null\)/);
  assert.match(read, /issuable: issuableOf\(r\)/);
  assert.match(read, /rebill: r\.invoice_voided_at \? rebillOf\(r\) : null/);
});
