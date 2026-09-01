// FINANCIALS NORTH STAR P1 — the shared surface vocabulary for the /financials pages.
//
// Design authority: docs/north-star/financials/ (approved P1 package). Behavioral authority:
// current main, reconciled in docs/north-star/financials/FINANCIALS-UX-CURRENT-MAIN-RECONCILIATION.md.
//
// PURE presentation vocabulary + read-state mapping. This module holds NO financial authority:
// no arithmetic over financial facts, no filtering-as-authority, no capability decisions. It
// names slots, labels and honest states so all twenty pages say the same things the same way.

import { OPERATING_COMPANY_IDS } from "./operatingCompanyAuthority.js";

// HonestState ids, restated as plain strings so this module stays importable by
// `node --test` (no JSX). Parity with shared/ui/HonestState.jsx's HONEST_STATE is
// asserted by test/financialsUxLifecycle.test.jsx.
const HONEST_STATE = Object.freeze({
  LOADING: "LOADING",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_ENABLED: "NOT_ENABLED",
});

// ─── Fact classes (FIN-001 vocabulary). Labels are display-only. ───
export const FACT_CLASS = Object.freeze({
  OPERATIONAL_ACTUAL: "OPERATIONAL_ACTUAL",
  ACCOUNTING_RECONCILED_ACTUAL: "ACCOUNTING_RECONCILED_ACTUAL",
  FORECAST: "FORECAST",
  BUDGET: "BUDGET",
  GOAL: "GOAL",
  DERIVED: "DERIVED",
});

export const FACT_CLASS_WORDS = Object.freeze({
  [FACT_CLASS.OPERATIONAL_ACTUAL]: "Operational actual",
  [FACT_CLASS.ACCOUNTING_RECONCILED_ACTUAL]: "Accounting reconciled actual",
  [FACT_CLASS.FORECAST]: "Forecast",
  [FACT_CLASS.BUDGET]: "Budget",
  [FACT_CLASS.GOAL]: "Goal",
  [FACT_CLASS.DERIVED]: "Derived",
});

// ─── The shared filter grammar (identical wording and order on every Financials page). ───
// Company is a governed dimension (operatingCompanyAuthority) — never inferred from
// location, warehouse, manufacturer, route or free text. These options parameterize a
// governed read request; they are NEVER client-side authority over returned data.
export const COMPANY_FILTER_OPTIONS = Object.freeze([
  Object.freeze({ key: "consolidated", label: "Consolidated" }),
  Object.freeze({ key: OPERATING_COMPANY_IDS.TAYLOR, label: "Taylor" }),
  Object.freeze({ key: OPERATING_COMPANY_IDS.VENTANA, label: "Ventana" }),
]);

// Canonical BU ids mirror functions/src/finance/financialAttribution.ts BUSINESS_UNITS.
export const BUSINESS_UNIT_FILTER_OPTIONS = Object.freeze([
  Object.freeze({ key: "all", label: "All units" }),
  Object.freeze({ key: "SERVICE", label: "Service" }),
  Object.freeze({ key: "EQUIPMENT_SALES", label: "Equipment Sales" }),
  Object.freeze({ key: "PARTS", label: "Parts" }),
  Object.freeze({ key: "INSTALLATION", label: "Installation" }),
]);

// ─── The lifecycle scorecard (page 01). Six slots, lifecycle order, distinct words. ───
// Unbilled is the ONE derived figure and carries its derivation in the label. Every slot
// keeps its place even when its read is not activated — absence renders as an honest
// state, never a zero and never a specimen number.
export const LIFECYCLE_SCORECARD_SLOTS = Object.freeze([
  Object.freeze({ key: "booked", label: "Booked", factClass: FACT_CLASS.OPERATIONAL_ACTUAL }),
  Object.freeze({ key: "billable", label: "Billable now", factClass: FACT_CLASS.OPERATIONAL_ACTUAL }),
  Object.freeze({ key: "billed", label: "Billed", factClass: FACT_CLASS.OPERATIONAL_ACTUAL }),
  Object.freeze({ key: "collected", label: "Collected", factClass: FACT_CLASS.OPERATIONAL_ACTUAL }),
  Object.freeze({ key: "arOutstanding", label: "A/R outstanding", factClass: FACT_CLASS.OPERATIONAL_ACTUAL }),
  Object.freeze({
    key: "unbilled",
    label: "Unbilled",
    factClass: FACT_CLASS.DERIVED,
    derivation: "booked − billed",
  }),
]);

// ─── A/R aging grammar (page 04): ONE canonical bucket vocabulary, used everywhere. ───
// No repository authority distinguishes 61+/91+ treatments yet, so the Design's minimal
// grammar stands; this choice is UI-only and recorded in the reconciliation doc.
export const AR_AGING_BUCKETS = Object.freeze([
  Object.freeze({ key: "total", label: "Total A/R" }),
  Object.freeze({ key: "current", label: "Current" }),
  Object.freeze({ key: "b1_30", label: "1–30 days" }),
  Object.freeze({ key: "b31_60", label: "31–60 days" }),
  Object.freeze({ key: "b61_plus", label: "61+ days", tone: "danger" }),
]);

// ─── Measurement bases (FIN-003 vocabulary; page 08/10/13 grammar). ───
// Unlike bases are never summed or compared silently — a table over these carries no
// total row, and rollups group by basis only. GROSS_MARGIN-basis attainment cannot be
// computed truthfully until FIN-006 cost supply exists.
export const MEASUREMENT_BASES = Object.freeze([
  Object.freeze({ key: "BOOKED", label: "Booked" }),
  Object.freeze({ key: "BILLED", label: "Billed" }),
  Object.freeze({ key: "COLLECTED", label: "Collected" }),
  Object.freeze({ key: "REVENUE", label: "Revenue" }),
  Object.freeze({ key: "GROSS_MARGIN", label: "Gross margin" }),
]);

// ─── Read-state mapping ───
//
// Every Financials read renders through this one mapping so the same fact gets the same
// sentence on every page. Inputs mirror the {loading, errorStatus, result} shape of
// hooks/useAccountAr.js / services/financeReadCallableClient.js.
//
//   READ_NOT_WIRED   there is no governed read surface for this fact family at all
//                    (e.g. payments/corrections: command cores merged, no read callable).
//   loading          a governed read is in flight.
//   errorStatus "denied"       the server refused — a permission fact (HONEST DENIED).
//   errorStatus "unavailable"  the read failed — not a data fact.
//   result           the caller interprets its own envelope (page-specific view model).
export const FINANCIALS_READ = Object.freeze({
  NOT_WIRED: "NOT_WIRED",
});

// The sentences are contract copy: they state which authority is missing, in the
// reconciliation vocabulary (BUILT_DORMANT / NOT ACTIVATED / NOT USER-EXPOSED), and they
// never claim an error occurred when the truth is an unactivated capability.
export const READ_STATE_DETAIL = Object.freeze({
  notActivated:
    "Financial reads exist but are not activated in this environment (finance.read is inactive). Nothing failed — this surface composes governed reads only, and renders none until activation.",
  notWired:
    "No governed read surface exists for these records yet. The command core is merged and dormant; its read exposure has not been built or activated.",
});

export function financialsReadHonestState({ loading, errorStatus, result }) {
  if (loading) return { state: HONEST_STATE.LOADING };
  if (errorStatus === "denied") return { state: HONEST_STATE.DENIED };
  if (errorStatus === "unavailable") return { state: HONEST_STATE.UNAVAILABLE };
  if (result == null) {
    // A settled read chain with nothing returned and no error: with every finance
    // capability inactive today this is the NOT_ENABLED truth, not an empty collection.
    return { state: HONEST_STATE.NOT_ENABLED, detail: READ_STATE_DETAIL.notActivated };
  }
  return { state: null, result };
}

// For fact families with no read callable at all (payments, corrections, invoice
// collection listing): the page keeps the approved composition and states this truth.
export function unwiredReadHonestState() {
  return { state: HONEST_STATE.NOT_ENABLED, detail: READ_STATE_DETAIL.notWired };
}
