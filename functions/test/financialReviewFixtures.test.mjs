// FINANCIAL_REVIEW_P1 — the fixture set's contract, asserted without touching Firestore.
//
// These pin what the fixtures ARE ALLOWED TO SAY. The seeder cannot express an invoice total, an
// outstanding balance or an aging bucket — those are derived by the governed commands — so what is
// assertable here is the SOURCE shape and the boundaries the fixture set must not cross.
//
// Run: node --test test/financialReviewFixtures.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  FIXTURES,
  DATASET_ID,
  MARKER_FIELD,
  FIXTURE_VERSION,
  ANCHOR_MS,
  SALESPERSON_A,
  SALESPERSON_B,
  buildSalesOrderDoc,
  issueInvoiceRequest,
  applyPaymentRequest,
  expectedTotalMinor,
} from "../scripts/financialReviewFixtures.mjs";

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "financialReviewFixtures.mjs"),
  "utf8",
);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const CODE = stripComments(SOURCE);

test("the expected fixture ids exist, and nothing else", () => {
  assert.deepEqual(
    FIXTURES.map((f) => f.id),
    [
      "fr-p1-so-paid",
      "fr-p1-so-partial",
      "fr-p1-so-overdue",
      "fr-p1-so-mixed-a",
      "fr-p1-so-mixed-b",
      "fr-p1-so-mixed-c",
      // Post-attribution generation: additive, new ids, new idempotency keys.
      "fr-p2-so-lucian-paid",
      "fr-p2-so-petra-partial",
      "fr-p2-so-credit-split",
    ],
  );
});

test("idempotent by construction: deterministic ids, marker, anchored dates, stable idempotency keys", () => {
  const a = buildSalesOrderDoc(FIXTURES[0], "uid-1", ANCHOR_MS);
  const b = buildSalesOrderDoc(FIXTURES[0], "uid-1", ANCHOR_MS);
  assert.deepEqual(a, b, "the same fixture must build the same document every run");
  assert.deepEqual(a[MARKER_FIELD], { version: FIXTURE_VERSION, datasetId: DATASET_ID });
  // No wall-clock anywhere in the fixture data path — a rerun must not drift.
  assert.doesNotMatch(CODE, /Date\.now\(\)|new Date\(\)/, "fixture dates must be anchored, never wall-clock");
  const keys = new Set();
  for (const f of FIXTURES) {
    const k = issueInvoiceRequest(f).idempotencyKey;
    assert.match(k, new RegExp(`^${DATASET_ID}:`), "idempotency key must be namespaced to the dataset");
    assert.equal(keys.has(k), false, "idempotency keys must be unique per fixture");
    keys.add(k);
    assert.equal(issueInvoiceRequest(f).idempotencyKey, k, "and stable across calls");
  }
});

test("all money is integer minor units, USD", () => {
  for (const f of FIXTURES) {
    for (const l of f.lines) {
      assert.ok(Number.isSafeInteger(l.unitPrice) && l.unitPrice > 0, `${f.id} unitPrice must be a positive integer`);
      assert.ok(Number.isSafeInteger(l.orderedQty) && l.orderedQty > 0, `${f.id} orderedQty must be a positive integer`);
    }
    if (f.payMinor !== null) {
      assert.ok(Number.isSafeInteger(f.payMinor) && f.payMinor > 0, `${f.id} payMinor must be a positive integer`);
    }
    assert.equal(issueInvoiceRequest(f).currency, "USD");
    assert.equal(buildSalesOrderDoc(f, "u", ANCHOR_MS).currency, "USD");
  }
});

test("no payment exceeds its invoice, and no unapplied cash is created", () => {
  for (const f of FIXTURES) {
    if (f.payMinor === null) continue;
    assert.ok(
      f.payMinor <= expectedTotalMinor(f),
      `${f.id} would over-apply (${f.payMinor} > ${expectedTotalMinor(f)}) — the command refuses this, and an unapplied balance is FUTURE AUTHORITY`,
    );
  }
});

test("the paid fixture derives zero outstanding; the partial fixtures derive a positive one", () => {
  const paid = FIXTURES.find((f) => f.id === "fr-p1-so-paid");
  assert.equal(paid.payMinor, expectedTotalMinor(paid), "a fully paid fixture applies exactly the invoice total");

  for (const id of ["fr-p1-so-partial", "fr-p1-so-mixed-b"]) {
    const f = FIXTURES.find((x) => x.id === id);
    assert.ok(f.payMinor < expectedTotalMinor(f), `${id} must leave a governed outstanding balance`);
  }
  for (const id of ["fr-p1-so-overdue", "fr-p1-so-mixed-c"]) {
    assert.equal(FIXTURES.find((x) => x.id === id).payMinor, null, `${id} must remain unpaid`);
  }
});

test("aging comes from the governed dueDate, never from a written bucket", () => {
  const overdue = FIXTURES.find((f) => f.id === "fr-p1-so-overdue");
  assert.ok(overdue.dueOffsetDays <= -61, "the overdue fixture must sit in the 61+ bucket by its due date alone");
  assert.equal(issueInvoiceRequest(overdue).dueDate, ANCHOR_MS + overdue.dueOffsetDays * 86400000);
  // NO FIXTURE MAY EXPRESS A DERIVED VALUE. Asserted against the fixture DATA and the documents
  // it builds — not the whole file, because `verify` legitimately READS totalMinor/outstandingMinor
  // back off the derived invoices to report them.
  for (const f of FIXTURES) {
    const surfaces = [JSON.stringify(f), JSON.stringify(buildSalesOrderDoc(f, "u", ANCHOR_MS)), JSON.stringify(issueInvoiceRequest(f))];
    for (const s of surfaces) {
      for (const derived of ["outstandingMinor", "agingBucket", "totalMinor", "subtotalMinor", "lineTotalMinor", "invoiceNumber"]) {
        assert.ok(!s.includes(derived), `${f.id} must not express the derived value ${derived}`);
      }
    }
  }
});

test("company and business-unit attribution are explicit on every fixture", () => {
  for (const f of FIXTURES) {
    assert.ok(["taylor", "ventana"].includes(f.operatingCompanyId), `${f.id} needs a governed operatingCompanyId`);
    const doc = buildSalesOrderDoc(f, "u", ANCHOR_MS);
    assert.equal(doc.operatingCompanyId, f.operatingCompanyId);
    for (const l of doc.lines) {
      assert.ok(["PARTS", "EQUIPMENT_SALES"].includes(l.businessUnitId), `${f.id} line needs an explicit businessUnitId`);
    }
  }
  assert.ok(FIXTURES.some((f) => f.operatingCompanyId === "ventana"), "two companies, so consolidated has something to sum");
});

// ─────────────────── salesperson / credit attribution ───────────────────

test("every sales-credit fact is an EXPLICIT creditedSalespersonId", () => {
  for (const f of FIXTURES) {
    assert.ok(f.creditedSalespersonId, `${f.id} must carry an explicit creditedSalespersonId`);
    assert.match(f.creditedSalespersonId, /^cw-emp-\d{3}$/, "credit is an employeeId, never a uid");
    assert.equal(buildSalesOrderDoc(f, "u", ANCHOR_MS).creditedSalespersonId, f.creditedSalespersonId);
  }
});

test("credit is NOT derived from the customer owner", () => {
  const divergent = FIXTURES.filter((f) => f.ownerEmployeeId !== f.creditedSalespersonId);
  assert.ok(divergent.length >= 1, "at least one fixture must prove owner != credited");
  for (const f of divergent) {
    const doc = buildSalesOrderDoc(f, "u", ANCHOR_MS);
    assert.notEqual(doc.creditedSalespersonId, doc.ownerEmployeeId);
    // Both facts survive independently — neither overwrites the other.
    assert.equal(doc.ownerEmployeeId, f.ownerEmployeeId);
    assert.equal(doc.creditedSalespersonId, f.creditedSalespersonId);
  }
});

test("createdBy is NOT used as sales credit", () => {
  for (const f of FIXTURES) {
    const doc = buildSalesOrderDoc(f, "operator-uid-xyz", ANCHOR_MS);
    assert.equal(doc.createdByUid, "operator-uid-xyz");
    assert.notEqual(doc.creditedSalespersonId, doc.createdByUid);
  }
});

test("historical credit does not move when the acting operator or owner changes", () => {
  const f = FIXTURES.find((x) => x.id === "fr-p1-so-mixed-a");
  const first = buildSalesOrderDoc(f, "operator-1", ANCHOR_MS);
  const later = buildSalesOrderDoc({ ...f, ownerEmployeeId: "cw-emp-999" }, "operator-2", ANCHOR_MS);
  assert.equal(first.creditedSalespersonId, SALESPERSON_A);
  assert.equal(later.creditedSalespersonId, SALESPERSON_A, "changing the owner must not re-credit the historical sale");
});

test("salesperson A and B hold distinct, non-empty event sets across different customers", () => {
  const a = FIXTURES.filter((f) => f.creditedSalespersonId === SALESPERSON_A);
  const b = FIXTURES.filter((f) => f.creditedSalespersonId === SALESPERSON_B);
  assert.ok(a.length >= 2 && b.length >= 2, "both salespeople need a comparable set");
  assert.ok(a.length !== b.length, "the two sets should be visibly different in size");
  assert.notEqual(SALESPERSON_A, SALESPERSON_B);
  const accountsA = new Set(a.map((f) => f.accountId));
  const accountsB = new Set(b.map((f) => f.accountId));
  assert.ok([...accountsB].some((x) => !accountsA.has(x)), "B must have at least one customer of their own");
  // Distinct lifecycle states across the two sets.
  assert.ok(a.some((f) => f.payMinor !== null), "A has settled/partly settled activity");
  assert.ok(b.some((f) => f.payMinor === null), "B has open activity");
});

// ─────────────────── boundaries this fixture set must not cross ───────────────────

test("no cost, margin, commission, compensation or quota facts anywhere", () => {
  for (const forbidden of [
    /unitCostMinor|costMinor|acquisitionCost|standardCost|laborRate|landedCost/i,
    /commission/i,
    /compensation|payroll/i,
    /quota/i,
    /marginMinor|grossMargin/i,
  ]) {
    assert.doesNotMatch(CODE, forbidden, `fixture set must not contain ${forbidden}`);
  }
});

test("no intercompany, elimination, unapplied cash, adjustment or plan facts", () => {
  for (const forbidden of [
    /intercompany/i,
    /elimination/i,
    /unappliedMinor|unapplied_cash/i,
    /invoice_adjustments|recordInvoiceAdjustment|recordRefund/,
    /goals|budgets|forecasts/,
  ]) {
    assert.doesNotMatch(CODE, forbidden, `fixture set must not contain ${forbidden}`);
  }
});

test("no capability, grant or role mutation, and no service-origin billing", () => {
  for (const forbidden of [/roleAssignments/, /permissionCatalog/, /capabilityActivationOverrides/, /workOrder|work_orders/i]) {
    assert.doesNotMatch(CODE, forbidden, `fixture set must not touch ${forbidden}`);
  }
});

test("the tool can only ever target the sandbox", () => {
  assert.match(CODE, /const ALLOWED_PROJECT = "eos-platform-sandbox"/);
  assert.doesNotMatch(CODE, /taylor-parts|eos-platform-certification/, "no production or certification project may appear");
  assert.match(CODE, /--apply-live-sandbox/, "writes must be double-gated");
});

test("financial results are DERIVED through governed callables, never written directly", () => {
  // The only collection this tool writes with the Admin SDK is the source order.
  const setCalls = [...CODE.matchAll(/collection\((?:"|')?([A-Za-z_]+)/g)].map((m) => m[1]);
  const written = [...CODE.matchAll(/\.collection\(([^)]*)\)\s*\n?\s*\.doc\([^)]*\)\s*\n?\s*\.set\(/g)];
  assert.ok(written.length >= 1, "the seeder writes at least the source order");
  assert.match(CODE, /callableFetch\("issueInvoice"/, "invoices must come from the governed command");
  assert.match(CODE, /callableFetch\("applyPayment"/, "payments must come from the governed command");
  // It must never write the derived financial collections itself (delete-on-teardown aside).
  assert.doesNotMatch(CODE, /collection\("invoices"\)\s*\.doc\([^)]*\)\.set\(/, "invoices are never written directly");
  assert.doesNotMatch(CODE, /collection\("payments"\)\s*\.doc\([^)]*\)\.set\(/, "payments are never written directly");
  assert.ok(setCalls.includes("SALES_ORDERS_COLLECTION") || CODE.includes("collection(SALES_ORDERS_COLLECTION)"));
});

test("the payment request is a valid application, deterministic and namespaced", () => {
  const paid = FIXTURES.find((f) => f.id === "fr-p1-so-paid");
  const req = applyPaymentRequest(paid, "invoice-123");
  assert.equal(req.invoiceId, "invoice-123");
  assert.equal(req.currency, "USD");
  assert.equal(req.amountMinor, paid.payMinor);
  assert.ok(Number.isSafeInteger(req.receivedAtMillis), "receivedAt must be a fixed anchored instant");
  assert.equal(applyPaymentRequest(paid, "invoice-123").receivedAtMillis, req.receivedAtMillis);
  assert.match(req.idempotencyKey, new RegExp(`^${DATASET_ID}:.*:pay:`));
  // An application never exceeds what the command would compute as outstanding.
  assert.ok(req.amountMinor <= expectedTotalMinor(paid));
});

test("the company assertion is sent, and always equals the order's governed company", () => {
  // The build deployed to sandbox predates the company-authority correction and reads the
  // caller's companyId; current authority treats it as an assertion and refuses a mismatch.
  // Sending the order's own governed id is the one value correct under both.
  for (const f of FIXTURES) {
    assert.equal(issueInvoiceRequest(f).companyId, f.operatingCompanyId);
    assert.equal(applyPaymentRequest(f, "inv").companyId, f.operatingCompanyId);
    assert.equal(applyPaymentRequest(f, "inv").accountId, f.accountId);
  }
});
