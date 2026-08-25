// WHAT CURRENCY A SALES ORDER IS DENOMINATED IN, WHEN THE RECORD DOES NOT SAY.
//
// ════════════════════ THE DATA HALF OF THE DOLLARS DEFECT ════════════════════
//
// Two Sales Orders worth the same fifty dollars rendered as `USD 50.00` and `50.00`. The formatter
// was half of it; this is the other half. The two records genuinely differ:
//
//   PR #976 (3c62345a, "persist currency on created Sales Orders") added `currency: "USD"` to
//   buildCreateSalesOrder. Orders created BEFORE that commit have NO currency field at all.
//
// The read projection reports that honestly — `salesOrderReadService.ts` returns
// `str(data.currency)`, which is `null` for those records, and it should keep doing so. The gap is
// real and the server is right not to paper over it.
//
// ════════════════════ WHY A FALLBACK IS TRUTHFUL HERE, AND ONLY HERE ════════════════════
//
// `buildCreateSalesOrder` hardcodes `currency: "USD"` and has no parameter that could produce
// anything else. Every Sales Order this implementation is capable of creating is a USD Sales Order,
// before and after #976 — the older records are not orders in an unknown currency, they are USD
// orders written before the field existed. Saying so is describing the write path, not guessing.
//
// THAT IS A FACT ABOUT THIS IMPLEMENTATION, NOT ABOUT EOS. It is scoped to this file and to Sales
// Orders on purpose:
//
//   - it is NOT in money.js or moneyDisplay.js, which are reusable domain code. A missing currency
//     defaulting to USD in a formatter would make "unlabelled means dollars" a system-wide
//     financial invariant established by a rendering function;
//   - it is NOT applied to Invoices, Payments, Parts or Account balances. `account.js`'s
//     `defaultCurrency` already validates against the FULL ISO 4217 set, so those surfaces have a
//     real reason to carry an unknown currency and must keep saying so;
//   - it does NOT write anything. The stored documents are untouched; this decides display only.
//
// ════════════════════ WHAT REPLACES IT ════════════════════
//
// There is no governed tenant/company currency setting in this repository today. When one exists —
// see the Multi-Currency + FX Governance roadmap entry — a Sales Order's currency comes from the
// company/base currency and the Account default, and this file is deleted rather than adjusted.
// Until then, the honest options were an implementation-scoped fallback or a data normalisation of
// the sandbox records; the fallback was chosen because it needs no production write and no deploy
// beyond the client.

/**
 * The currency a Taylor Sales Order is denominated in.
 *
 * WHAT IS STORED ALWAYS WINS. This only supplies the value for a record written before the field
 * existed — so if multi-currency ever lands, a record that says CAD renders as CAD immediately,
 * without this function needing to know about it.
 */
export const TAYLOR_SALES_ORDER_CURRENCY = "USD";

export function salesOrderDisplayCurrency(record) {
  const stored = record?.currency;
  if (typeof stored === "string" && stored.trim().length === 3) return stored.trim().toUpperCase();
  return TAYLOR_SALES_ORDER_CURRENCY;
}
