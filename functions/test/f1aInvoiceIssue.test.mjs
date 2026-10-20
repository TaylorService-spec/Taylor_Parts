// F-1a, offline -- issue an invoice on EOS (DECISIONS #F-1a; spec docs/architecture/f1-invoicing-spec.md). No database: the real-database proof is
// functions/test/f1aInvoiceIssuePostgres.test.mjs. This file pins what can be proved from the code and the committed baseline:
//   * the operation is on the Finance table, behind finance.invoice.issue, and its authority is decided BEFORE the command can write;
//   * input is validated before any connection is taken (a refused request leaves no trace);
//   * ONE audit row per applied command, the number is allocated on the apply path only, cash is never touched (settlements stay the only cash record);
//   * the number is never seeded: the counter has no seed parameter and no seeding statement anywhere in the code (Owner safeguard C);
//   * the holders of the key in the committed baseline are the Firebase holders (no grant is added by this change).
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
const code = (file) => readFileSync(join(ROOT, "src", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const count = (haystack, needle) => haystack.split(needle).length - 1;
const ACTOR = { tenantId: "t", principalId: "p" };
/** A pool that fails the test if any connection is taken: input refusals happen before one. */
const NO_DB = { connect: async () => { throw new Error("a refused request must not take a connection"); }, query: async () => { throw new Error("no query"); } };
const refusal = async (input) => { try { await issue.issueFinancialInvoice(NO_DB, ACTOR, input); } catch (e) { return e.code; } return "ISSUED"; };

test("issueInvoice is on the Finance table behind finance.invoice.issue, and the capability and the company are decided before the command", () => {
  assert.equal(ops.INVOICE_ISSUE_CAPABILITY, "finance.invoice.issue");
  assert.ok(ops.FINANCE_OPERATIONS.includes("issueInvoice"));
  const body = code("eosFinance/financeOperations.ts");
  const at = body.indexOf("issueInvoice: async");
  const slice = body.slice(at, body.indexOf("supplyReceiptCostEvidence:", at));
  assert.ok(slice.indexOf("requireCapability(caller, INVOICE_ISSUE_CAPABILITY)") >= 0);
  assert.ok(slice.indexOf("requireCapability(") < slice.indexOf("fullReachedCompanies(") && slice.indexOf("fullReachedCompanies(") < slice.indexOf("issueFinancialInvoice("),
    "capability, then company authority, then the write");
  assert.match(slice, /refuse\("BILLING_PACKAGE_NOT_FOUND", "NOT_FOUND"/, "a package outside the caller's companies reads as nonexistent");
  assert.match(code("adminPolicy/assignmentScopeRuntime.ts"), /"operations\.issueInvoice"/, "the company-scoped consumers list names it");
});

test("input is refused before any connection: unknown fields, missing ids, a bad or past-shaped date, an over-long reason", async () => {
  assert.equal(await refusal({ billingPackageId: "b", idempotencyKey: "k", approverId: "x" }), "FIELD_NOT_ACCEPTED", "there is no approver field: issue is one step");
  assert.equal(await refusal({ billingPackageId: "b", idempotencyKey: "k", operatingCompanyId: "taylor" }), "FIELD_NOT_ACCEPTED", "the company is the package's, never the caller's");
  assert.equal(await refusal({ idempotencyKey: "k" }), "BILLING_PACKAGE_ID_REQUIRED");
  assert.equal(await refusal({ billingPackageId: "b" }), "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await refusal({ billingPackageId: "b", idempotencyKey: "k", dueOn: "2026-02-30" }), "DUE_DATE_INVALID");
  assert.equal(await refusal({ billingPackageId: "b", idempotencyKey: "k", dueOn: "10/20/2026" }), "DUE_DATE_INVALID");
  assert.equal(await refusal({ billingPackageId: "b", idempotencyKey: "k", dueOn: "2026-12-01", dueReason: "x".repeat(issue.INVOICE_REASON_MAX + 1) }), "DUE_REASON_REQUIRED");
  assert.equal(await refusal({ billingPackageId: "  ", idempotencyKey: "k" }), "BILLING_PACKAGE_ID_REQUIRED");
});

test("ONE audit row per applied command, allocated on the apply path only, in the command's own transaction", () => {
  const src = code("eosFinance/invoiceIssue.ts");
  assert.equal(count(src, "recordCommandAudit("), 1, "exactly one audit write");
  assert.equal(count(src, "allocateInvoiceNumber("), 1, "exactly one allocation");
  assert.match(src, /action: "finance\.invoice\.issue"/);
  const replay = src.indexOf('outcome: "replayed"');
  assert.ok(replay > 0 && replay < src.indexOf("allocateInvoiceNumber(") && replay < src.indexOf("recordCommandAudit("), "a replay returns before the number is allocated and before the audit");
  assert.ok(src.indexOf("INSERT INTO eos_finance.invoices") < src.indexOf("recordCommandAudit("), "the audit follows the writes in the same transaction");
  assert.ok(src.indexOf("return tx(pool") > 0 && src.indexOf("return tx(pool") < src.indexOf("recordCommandAudit("), "inside the command's one transaction (tx: BEGIN .. COMMIT / ROLLBACK)");
  assert.ok(src.indexOf("COMMIT") < src.indexOf("return tx(pool") && src.indexOf("ROLLBACK") < src.indexOf("return tx(pool"), "tx commits on success and rolls back on any refusal");
  // No free text but the governed reason: the audit carries identity, amounts and the due basis.
  const audit = src.slice(src.indexOf("recordCommandAudit("));
  assert.doesNotMatch(audit, /notes|description|instructions/i);
});

test("settlements stay the only cash record: no payments table, no cash application, no settlement is written by issuing", () => {
  const src = code("eosFinance/invoiceIssue.ts");
  assert.doesNotMatch(src, /eos_finance\.payments|payment_applications|settlement_applications|INSERT INTO eos_finance\.settlements|financial_facts/);
  assert.doesNotMatch(src, /firebase|firestore/i, "no Firebase");
});

test("the number is never seeded: no seed parameter, no starting sequence from history, and the counter starts at 1", () => {
  const allocator = code("eosFinance/invoiceNumberAllocator.ts");
  assert.doesNotMatch(allocator, /seed|startAt|startingSequence|initialValue/i);
  assert.match(allocator, /VALUES \(\$1, \$2, \$3, 1\)/, "a fresh (tenant, company, year) inserts last_value 1");
  assert.doesNotMatch(code("eosFinance/invoiceIssue.ts"), /seed|startAt|legacy|firebase/i);
  const { formatInvoiceNumber } = require("../lib/eosFinance/invoiceNumberAllocator.js");
  assert.equal(formatInvoiceNumber(2026, 1), "INV-2026-000001");
});

test("the committed baseline holds finance.invoice.issue for the Firebase holders and no operational role; this change grants nothing", () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
  const holders = new Set(baseline.grants.filter((g) => g.capabilityKey === "finance.invoice.issue").map((g) => g.roleKey));
  for (const role of ["accountingManager", "admin", "controller", "financeManager", "generalManager", "owner"]) assert.ok(holders.has(role), `${role} holds it`);
  for (const role of ["salesperson", "salesManager", "technician", "dispatcher", "warehouseManager", "shopManager", "fieldManager"]) assert.ok(!holders.has(role), `${role} must not hold it`);
  // No migration of this change registers a capability or a grant (the SQL is the controller's; it is reviewed against this sentence).
  assert.doesNotMatch(code("eosFinance/invoiceIssue.ts"), /role_capabilities|eos_policy\.capabilities/);
});

test("B1: a package with an issued invoice cannot be superseded -- the check runs before the receivable can be voided", () => {
  const src = code("eosFinance/billingPackage.ts");
  const retire = src.slice(src.indexOf("export async function retirePackageReceivableOn"));
  const guard = retire.indexOf("PACKAGE_INVOICED");
  assert.ok(guard > 0 && guard < retire.indexOf("voidObligationOn("), "PACKAGE_INVOICED is decided before voidObligationOn");
  assert.match(retire.slice(0, guard), /FROM eos_finance\.invoices WHERE tenant_id = \$1 AND billing_package_id = \$2 AND voided_at IS NULL/);
});

test("F4: a lost race on a unique index is a governed CONFLICT, not a raw error", () => {
  const src = code("eosFinance/invoiceIssue.ts");
  assert.match(src, /code === "23505" && u\.constraint === "invoices_idempotency"\) refuse\("IDEMPOTENCY_KEY_REUSED", "CONFLICT"/);
  assert.match(src, /invoices_one_per_obligation[\s\S]{0,80}invoices_one_per_package[\s\S]{0,80}refuse\("INVOICE_ALREADY_ISSUED", "CONFLICT"/);
});

test("F5: no governed business date is a clean refusal; the later-date bound is 365 days", async () => {
  assert.equal(issue.INVOICE_DUE_EXTENSION_MAX_DAYS, 365);
  const outcome = async (db) => { try { await issue.businessToday(db, "t", "taylor"); } catch (e) { return [e.code, e.category]; } return "OK"; };
  assert.deepEqual(await outcome({ query: async () => { throw new Error("OPERATING_COMPANY_UNRESOLVED: taylor is not an operating company of this tenant"); } }), ["BUSINESS_DATE_UNAVAILABLE", "PRECONDITION_FAILED"]);
  assert.deepEqual(await outcome({ query: async () => ({ rows: [{ d: null }] }) }), ["BUSINESS_DATE_UNAVAILABLE", "PRECONDITION_FAILED"]);
  assert.equal(await issue.businessToday({ query: async () => ({ rows: [{ d: "2026-10-20" }] }) }, "t", "taylor"), "2026-10-20");
  await assert.rejects(issue.businessToday({ query: async () => { throw new Error("connection lost"); } }, "t", "taylor"), /connection lost/, "an unrelated failure is not disguised");
});

test("F3: the receivable's due date is set exactly once, and a miss is refused", () => {
  const src = code("eosFinance/invoiceIssue.ts");
  assert.match(src, /dated\.rowCount !== 1\) refuse\("RECEIVABLE_ALREADY_DATED", "CONFLICT"/);
  assert.doesNotMatch(src, /o\.due_on/);
});
