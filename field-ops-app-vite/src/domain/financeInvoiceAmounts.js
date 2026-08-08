// Finance — INVOICE AMOUNT DERIVATION (Owner §3, §8). Derives invoice line amounts from the COMMITTED Sales
// Order price snapshot (the contractual basis) × the billable quantity, keeping every money concept distinct
// (unit price / subtotal / discount / taxable base / tax / line total / invoice total). It NEVER re-prices
// silently and introduces NO Finance price book: a line with no committed price is UNPRICED (fail-closed). Tax
// is an INJECTED determination snapshotted at invoice generation (Owner §2) — absent/incomplete tax fails
// closed to REQUIRES_REVIEW, never invented. All math is exact integer Money (domain/money.js), never float.

import {
  isMoney, zeroMoney, addMoney, subtractMoney, multiplyMoneyByQuantity, sumMoney, DEFAULT_CURRENCY,
} from "./money.js";

// Derive amounts for one invoice's lines.
//   billable        : [{ ref, billableQty }] from invoiceCandidateFromBillingEligibility (NO amounts).
//   priceByRef      : { ref -> unitPrice Money }  — the SO unitPrice snapshot (contractual basis).
//   discountByRef   : { ref -> discount Money }   — explicit governed line discounts/adjustments (optional).
//   taxDetermination: { byRef: { ref -> tax Money }, provenance } — the injected tax determination (Owner §2).
//                     Omit / incomplete ⇒ tax REQUIRES_REVIEW (fail-closed), invoice total UNKNOWN.
//   currency        : the invoice currency (all lines must share it).
// Returns { status, currency, lines: [...], totals: {...} }. status: READY | UNPRICED | REQUIRES_REVIEW.
export function deriveInvoiceLineAmounts({ billable, priceByRef = {}, discountByRef = {}, taxDetermination = null, currency = DEFAULT_CURRENCY } = {}) {
  const rows = Array.isArray(billable) ? billable : [];
  const lines = [];
  let anyUnpriced = false;
  let taxKnownForAll = true;

  for (const b of rows) {
    const ref = b?.ref ?? null;
    const qty = Number.isSafeInteger(b?.billableQty) && b.billableQty > 0 ? b.billableQty : 0;
    const unitPrice = priceByRef[ref];
    if (ref == null || qty === 0) continue; // nothing to bill on this line
    if (!isMoney(unitPrice) || unitPrice.currency !== currency) {
      // No committed price for this billable line ⇒ cannot invoice it (do NOT invent or re-price).
      anyUnpriced = true;
      lines.push({ ref, billableQty: qty, unitPrice: null, subtotal: null, discount: null, taxableBase: null, tax: null, lineTotal: null, status: "UNPRICED" });
      continue;
    }
    const subtotal = multiplyMoneyByQuantity(unitPrice, qty);
    const discount = isMoney(discountByRef[ref]) && discountByRef[ref].currency === currency ? discountByRef[ref] : zeroMoney(currency);
    const taxableBase = subtractMoney(subtotal, discount);
    const tax = taxDetermination?.byRef?.[ref];
    if (!isMoney(tax) || tax.currency !== currency) {
      taxKnownForAll = false;
      lines.push({ ref, billableQty: qty, unitPrice, subtotal, discount, taxableBase, tax: null, lineTotal: null, status: "TAX_REQUIRES_REVIEW" });
      continue;
    }
    lines.push({ ref, billableQty: qty, unitPrice, subtotal, discount, taxableBase, tax, lineTotal: addMoney(taxableBase, tax), status: "READY" });
  }

  const status = anyUnpriced ? "UNPRICED" : !taxKnownForAll ? "REQUIRES_REVIEW" : "READY";
  const totals = status === "READY"
    ? {
        subtotal: sumMoney(lines.map((l) => l.subtotal), currency),
        discount: sumMoney(lines.map((l) => l.discount), currency),
        tax: sumMoney(lines.map((l) => l.tax), currency),
        total: sumMoney(lines.map((l) => l.lineTotal), currency),
      }
    // Totals are only asserted when every line is READY — an UNPRICED/tax-review invoice has NO authoritative
    // total (fail-closed; do not sum a partial/invented amount).
    : { subtotal: null, discount: null, tax: null, total: null };

  return { status, currency, lines, totals, taxProvenance: taxDetermination?.provenance ?? null };
}
