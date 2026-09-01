#!/usr/bin/env node
// FINANCIAL_REVIEW_P1 — bounded, idempotent Financials review fixtures for eos-platform-sandbox.
//
// ════════════════════ WHAT THIS IS FOR ════════════════════
//
// The Financials North Star P1 UX is complete and deployed, but every page renders an honest
// empty/dormant state because the sandbox holds almost no financial facts. This installs the
// SMALLEST deterministic fixture set that lets the Owner see the composition carrying real
// governed data — paid, partially paid, overdue, multi-invoice history, two business units,
// two operating companies, and two credited salespeople.
//
// ════════════════════ THE RULE THIS FILE OBEYS ════════════════════
//
// SEED SOURCE FACTS, NOT DESIRED SCREEN NUMBERS.
//
// Phase 1 writes ONE kind of record with the Admin SDK: the governed Sales Order — a SOURCE
// fact, exactly as certificationWorld/build.mjs seeds accounts, employees and equipment.
//
// Phase 2 writes NOTHING directly. Every financial result — invoice numbers, line subtotals,
// totals, outstanding balances, invoice state, payment applications, audit events — is DERIVED
// by invoking the DEPLOYED GOVERNED CALLABLES (issueInvoice, applyPayment) as a real signed-in
// principal. The command cores recompute amounts from the governed order, refuse
// over-application, allocate invoice numbers transactionally and stage audit events. Nothing
// here can put a number on a screen that the product's own authority did not produce.
//
// That is why this file contains no invoice totals, no outstanding balances and no aging
// buckets: it cannot express them. It expresses orders and payment amounts; the authority
// derives the rest.
//
// ════════════════════ WHAT IT DELIBERATELY DOES NOT DO ════════════════════
//
//   · no cost facts of any kind (FIN-BLOCK-003 open — Profitability must keep saying UNKNOWN)
//   · no service→billable bridge (FIN-BLOCK-002 open — service-origin billing stays absent)
//   · no intercompany events or eliminations (FIN-BLOCK-004 open — consolidated stays
//     UNELIMINATED_SUM; the two companies here are ordinary same-company sales, not transfers)
//   · no unapplied cash (page 05 must keep showing it as FUTURE AUTHORITY) — every payment is a
//     valid application at or below the invoice's outstanding balance
//   · no capability activation, no role grants, no scope bindings
//   · no goals, budgets or forecasts (FIN-003/FIN-005 have no persistence — see the report)
//   · no adjustments (FIN-007 approval policy is unconfigured; seeding one would invent policy)
//   · no commission, compensation, quota or margin facts
//
// ════════════════════ ATTRIBUTION ════════════════════
//
// creditedSalespersonId is set EXPLICITLY on each order and frozen there (FIN-002). It is never
// inferred from the account owner, the acting user, or a technician. Two orders deliberately
// carry ownerEmployeeId != creditedSalespersonId so reporting cannot quietly conflate the
// commercial owner with sales credit, and createdByUid is the seeding operator on every order,
// so createdBy != creditedSalespersonId throughout.
//
// Usage:
//   node functions/scripts/financialReviewFixtures.mjs verify  --projectId eos-platform-sandbox
//   node functions/scripts/financialReviewFixtures.mjs install --projectId eos-platform-sandbox --apply --apply-live-sandbox
//   node functions/scripts/financialReviewFixtures.mjs remove  --projectId eos-platform-sandbox --apply --apply-live-sandbox [--include-derived]
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

export const FIXTURE_VERSION = "1.0.0";
export const DATASET_ID = "FINANCIAL_REVIEW_P1";
/** Marker field, same shape convention as certificationWorld's — scopes verify/remove to what THIS tool wrote. */
export const MARKER_FIELD = "financialReviewP1";
export const SALES_ORDERS_COLLECTION = "sales_orders";

/** The ONLY project this tool will touch. */
const ALLOWED_PROJECT = "eos-platform-sandbox";

// Deterministic anchor. Every date below is an offset from it, so a rerun produces byte-identical
// input and acceptance evidence does not drift with the wall clock.
export const ANCHOR_MS = Date.UTC(2026, 8, 1, 0, 0, 0); // 2026-09-01T00:00:00Z
const days = (n) => n * 24 * 60 * 60 * 1000;

// Seeded salespeople — existing certification-world employees carrying the `salesperson` governed
// role. Their employeeId IS the creditedSalespersonId (never a uid, never the acting user).
export const SALESPERSON_A = "cw-emp-034"; // Lucian Brightwater
export const SALESPERSON_B = "cw-emp-035"; // Petra Lindqvist

// Existing recognizable sandbox accounts, so the Owner can follow these records across modules.
const ACCT_PAID = "cw-acct-0000";
const ACCT_PARTIAL = "cw-acct-0001";
const ACCT_OVERDUE = "cw-acct-0002";
const ACCT_MIXED = "cw-acct-0003";

// Refs that exist in the sandbox catalogue, so a line reads like real ordered work.
const EQUIP = { kind: "EQUIPMENT_MODEL", ref: "ICETRO--IM-0350-AC", businessUnitId: "EQUIPMENT_SALES" };
const PART = { kind: "PART", ref: "CW-P-0000", businessUnitId: "PARTS" };

/**
 * THE FIXTURE SET.
 *
 * Each entry is a SOURCE ORDER plus the governed calls to make against it. `payMinor` is an
 * application amount, never an outcome: whether the invoice ends PAID or PARTIALLY_PAID is
 * derived by the payment command from the invoice it recomputes.
 */
export const FIXTURES = [
  {
    id: "fr-p1-so-paid",
    scenario: "A · clean paid",
    accountId: ACCT_PAID,
    operatingCompanyId: "taylor",
    creditedSalespersonId: SALESPERSON_A,
    ownerEmployeeId: SALESPERSON_A,
    dueOffsetDays: 30,
    // Two business units on ONE order, so the invoice is genuinely mixed-BU (page 03 "Mixed",
    // page 14 BU composition) rather than a single-BU order pretending to be one.
    lines: [
      { ...EQUIP, lineId: "line-1", orderedQty: 1, unitPrice: 318000 },
      { ...PART, lineId: "line-2", orderedQty: 4, unitPrice: 2500 },
    ],
    payMinor: 328000, // exactly the invoice total → derives PAID / outstanding 0
  },
  {
    id: "fr-p1-so-partial",
    scenario: "B · partially paid",
    accountId: ACCT_PARTIAL,
    operatingCompanyId: "taylor",
    creditedSalespersonId: SALESPERSON_A,
    ownerEmployeeId: SALESPERSON_A,
    dueOffsetDays: 15,
    lines: [{ ...PART, lineId: "line-1", orderedQty: 46, unitPrice: 27500 }],
    payMinor: 450000, // materially less than the balance → derives PARTIALLY_PAID
  },
  {
    id: "fr-p1-so-overdue",
    scenario: "C · overdue receivable",
    accountId: ACCT_OVERDUE,
    operatingCompanyId: "taylor",
    creditedSalespersonId: SALESPERSON_B,
    ownerEmployeeId: SALESPERSON_B,
    dueOffsetDays: -75, // governed dueDate in the past — aging is DERIVED from it, never written
    lines: [{ ...EQUIP, lineId: "line-1", orderedQty: 1, unitPrice: 2735000 }],
    payMinor: null,
  },
  {
    id: "fr-p1-so-mixed-a",
    scenario: "D · mixed history (paid)",
    accountId: ACCT_MIXED,
    operatingCompanyId: "taylor",
    creditedSalespersonId: SALESPERSON_A,
    // OWNER != CREDIT. The commercial owner is B; the sale is credited to A and stays credited
    // to A. Reporting must never substitute one for the other.
    ownerEmployeeId: SALESPERSON_B,
    dueOffsetDays: -20,
    lines: [{ ...PART, lineId: "line-1", orderedQty: 12, unitPrice: 19500 }],
    payMinor: 234000,
  },
  {
    id: "fr-p1-so-mixed-b",
    scenario: "D · mixed history (partial)",
    accountId: ACCT_MIXED,
    operatingCompanyId: "taylor",
    creditedSalespersonId: SALESPERSON_A,
    ownerEmployeeId: SALESPERSON_B,
    dueOffsetDays: 10,
    lines: [{ ...EQUIP, lineId: "line-1", orderedQty: 1, unitPrice: 890000 }],
    payMinor: 320000,
  },
  {
    id: "fr-p1-so-mixed-c",
    scenario: "D/E · mixed history (open, second company, second salesperson)",
    accountId: ACCT_MIXED,
    // A DIFFERENT GOVERNED OPERATING COMPANY — an ordinary Ventana sale, NOT an intercompany
    // event. Nothing here is transferred between companies and nothing is eliminated;
    // consolidated figures stay an UNELIMINATED_SUM.
    operatingCompanyId: "ventana",
    creditedSalespersonId: SALESPERSON_B,
    ownerEmployeeId: SALESPERSON_B,
    dueOffsetDays: 45,
    lines: [{ ...PART, lineId: "line-1", orderedQty: 25, unitPrice: 7500 }],
    payMinor: null,
  },
];

export const expectedTotalMinor = (f) => f.lines.reduce((sum, l) => sum + l.unitPrice * l.orderedQty, 0);

/** The order as a governed source fact. Fulfilled, priced, attributed — billable by construction. */
export function buildSalesOrderDoc(f, actorUid, nowMs) {
  return {
    accountId: f.accountId,
    ownerEmployeeId: f.ownerEmployeeId,
    salesChannel: "RETAIL",
    currency: "USD",
    locationId: null,
    sourceOpportunityId: null,
    customerPO: null,
    notes: `${DATASET_ID} review fixture — ${f.scenario}`,
    // FULFILLED with fulfilledQty === orderedQty: billing eligibility is min(ordered, fulfilled),
    // so this is what makes the order billable. Delivery itself is not what this fixture set is
    // demonstrating, and inventing Work Orders to move the quantity would seed unrelated service
    // records (and brush against the open service-billing question).
    state: "FULFILLED",
    operatingCompanyId: f.operatingCompanyId,
    creditedSalespersonId: f.creditedSalespersonId,
    lines: f.lines.map((l) => ({
      lineId: l.lineId,
      kind: l.kind,
      ref: l.ref,
      businessUnitId: l.businessUnitId,
      orderedQty: l.orderedQty,
      allocatedQty: l.orderedQty,
      fulfilledQty: l.orderedQty,
      billedQty: 0,
      unitPrice: l.unitPrice,
    })),
    createdByUid: actorUid,
    salesOrderNumber: `SO-FR-${f.id.slice(-6).toUpperCase()}`,
    createdAtMillis: nowMs,
    updatedAtMillis: nowMs,
    [MARKER_FIELD]: { version: FIXTURE_VERSION, datasetId: DATASET_ID },
  };
}

export function issueInvoiceRequest(f) {
  return {
    // companyId is an ASSERTION, and it is sent deliberately. Under current authority the
    // invoice's company comes from the governed order and a mismatched assertion is refused;
    // the build deployed to sandbox predates that correction and still reads the caller's
    // value to key invoice numbering, so omitting it left that build with no company at all.
    // Sending the order's own governed id is correct under both: it matches the order under
    // the new rule, and it is the same value the old rule would have needed.
    companyId: f.operatingCompanyId,
    accountId: f.accountId,
    salesOrderId: f.id,
    currency: "USD",
    dueDate: ANCHOR_MS + days(f.dueOffsetDays),
    billingAction: "BILL_NOW",
    lines: f.lines.map((l) => ({
      salesOrderLineId: l.lineId,
      kind: l.kind,
      ref: l.ref,
      billableQty: l.orderedQty,
      unitPriceMinor: l.unitPrice,
      discountMinor: 0,
      taxMinor: 0, // explicit zero: an ABSENT taxMinor is REQUIRES_REVIEW, not "no tax"
    })),
    taxProvenance: `${DATASET_ID} fixture: no tax authority modelled`,
    idempotencyKey: `${DATASET_ID}:${FIXTURE_VERSION}:issue:${f.id}`,
  };
}

export function applyPaymentRequest(f, invoiceId) {
  return {
    // Assertion-only under current authority (cross-checked against the governed invoice), but
    // REQUIRED by the build deployed to sandbox — same situation as issueInvoice above.
    companyId: f.operatingCompanyId,
    accountId: f.accountId,
    invoiceId,
    currency: "USD",
    amountMinor: f.payMinor,
    method: "ACH",
    receivedAtMillis: ANCHOR_MS + days(Math.min(f.dueOffsetDays, 0) - 2),
    externalRef: `${DATASET_ID}-${f.id}`,
    idempotencyKey: `${DATASET_ID}:${FIXTURE_VERSION}:pay:${f.id}`,
  };
}

// ─────────────────────────────── runner ───────────────────────────────

function parseArgs(argv) {
  const out = { mode: argv[0] ?? "verify", projectId: null, apply: false, liveSandbox: false, includeDerived: false };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--projectId") out.projectId = argv[++i] ?? null;
    else if (a === "--apply") out.apply = true;
    else if (a === "--apply-live-sandbox") out.liveSandbox = true;
    else if (a === "--include-derived") out.includeDerived = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function assertTarget(args) {
  if (args.projectId !== ALLOWED_PROJECT) {
    throw new Error(`REFUSING: --projectId must be exactly "${ALLOWED_PROJECT}" (got ${args.projectId ?? "none"}).`);
  }
  const ambient = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? null;
  if (ambient && ambient !== ALLOWED_PROJECT) {
    throw new Error(`REFUSING: ambient project ${ambient} disagrees with --projectId ${args.projectId}.`);
  }
  if (args.mode !== "verify" && !(args.apply && args.liveSandbox)) {
    throw new Error("REFUSING: writes require BOTH --apply and --apply-live-sandbox.");
  }
}

async function callableFetch(name, data, idToken) {
  const res = await fetch(`https://us-central1-${ALLOWED_PROJECT}.cloudfunctions.net/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? `${name} failed with HTTP ${res.status}`;
    throw new Error(`${name}: ${msg}`);
  }
  return body?.result ?? body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertTarget(args);
  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();

  console.log(`${DATASET_ID} v${FIXTURE_VERSION} :: ${args.mode} :: ${args.projectId}`);

  if (args.mode === "verify") {
    let orders = 0;
    for (const f of FIXTURES) {
      const snap = await db.collection(SALES_ORDERS_COLLECTION).doc(f.id).get();
      if (snap.exists && snap.data()?.[MARKER_FIELD]) orders += 1;
    }
    const invoices = await db.collection("invoices").get();
    const mine = invoices.docs.filter((d) => FIXTURES.some((f) => f.id === d.data()?.salesOrderId));
    console.log(`orders installed : ${orders}/${FIXTURES.length}`);
    console.log(`invoices derived : ${mine.length}`);
    for (const d of mine) {
      const x = d.data();
      console.log(`  ${x.invoiceNumber} ${x.companyId} ${x.state} total=${x.totalMinor} outstanding=${x.outstandingMinor} so=${x.salesOrderId}`);
    }
    return;
  }

  if (args.mode === "remove") {
    for (const f of FIXTURES) {
      await db.collection(SALES_ORDERS_COLLECTION).doc(f.id).delete();
    }
    console.log(`removed ${FIXTURES.length} fixture sales orders.`);
    if (args.includeDerived) {
      // SANDBOX FIXTURE TEARDOWN ONLY. Issued invoices are immutable governed history and no
      // product path deletes them; this exists so a review fixture set can be rebuilt in a
      // sandbox, and it is scoped to invoices whose salesOrderId is a fixture order.
      const invoices = await db.collection("invoices").get();
      let n = 0;
      for (const d of invoices.docs) {
        if (!FIXTURES.some((f) => f.id === d.data()?.salesOrderId)) continue;
        for (const c of ["payment_applications", "payments"]) {
          const rel = await db.collection(c).where("invoiceId", "==", d.id).get().catch(() => ({ docs: [] }));
          for (const r of rel.docs ?? []) await r.ref.delete();
        }
        await d.ref.delete();
        n += 1;
      }
      console.log(`removed ${n} derived invoices and their applications (sandbox teardown).`);
    }
    return;
  }

  // ── install ──
  const { signInPersona } = await import(
    pathToFileURL(join(REPO_ROOT, "field-ops-app-vite", ".claude", "skills", "run-field-ops-app-vite", "deployedSession.mjs")).href
  );
  const session = await signInPersona("admin");
  const actorUid = session.uid ?? session.localId ?? "sbx-admin";

  // Phase 1 — SOURCE FACTS (Admin SDK). Idempotent: set(merge) at a deterministic id.
  for (const f of FIXTURES) {
    await db
      .collection(SALES_ORDERS_COLLECTION)
      .doc(f.id)
      .set(buildSalesOrderDoc(f, actorUid, ANCHOR_MS), { merge: true });
    console.log(`  order  ${f.id.padEnd(20)} ${f.operatingCompanyId.padEnd(8)} credited=${f.creditedSalespersonId} total=${expectedTotalMinor(f)}`);
  }

  // Phase 2 — DERIVED FINANCIAL EVENTS (governed callables only). Idempotent by construction:
  // both commands key replay off a deterministic audit id, so a rerun is a no-op replay that
  // neither re-issues an invoice nor burns an invoice number.
  for (const f of FIXTURES) {
    const issued = await callableFetch("issueInvoice", issueInvoiceRequest(f), session.idToken);
    const invoiceId = issued?.invoiceId ?? null;
    console.log(`  invoice ${f.id.padEnd(20)} -> ${invoiceId}${issued?.replayed ? " (replay)" : ""}`);
    if (!invoiceId || f.payMinor === null) continue;
    const paid = await callableFetch("applyPayment", applyPaymentRequest(f, invoiceId), session.idToken);
    console.log(`  payment ${f.id.padEnd(20)} -> ${paid?.paymentId ?? "?"}${paid?.replayed ? " (replay)" : ""}`);
  }

  console.log("install complete.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(String(err?.message ?? err));
    process.exitCode = 1;
  });
}
