// Account Commercial Profile — the human-readable label vocabulary for its three closed
// enums (invoiceDeliveryMethod, paymentTerms, taxStatus).
//
// domain/constants.js already carries the canonical MACHINE VALUES for all three
// (INVOICE_DELIVERY_METHOD, PAYMENT_TERMS, TAX_STATUS) — the Commercial Profile PR 1/PR 2
// work needed them to validate a draft before a write (domain/commercialProfile.js) and to
// gate governed edits in firestore.rules. What none of them ever got is a word for any of
// them: AccountForm.jsx and AccountDetail.jsx (CommercialProfileSection) both render the
// stored value verbatim (see e.g. `{paymentTerms && <div>Payment terms: {paymentTerms}</div>}`
// and the `<option value={...}>{...}</option>` pairs in the edit form's <select>s). This
// module is that missing layer, sourced from the same three enums rather than a second copy
// of them — the #1093 lesson (a label map that drifts from the values it labels is how
// "0 Active" ends up beside a table of ACTIVE rows).
//
// Created for X-ACCOUNT-PAGE-GAPS (entity half) because account.js's new
// invoiceDeliveryMethod/paymentTerms/taxStatus FieldDefinitions need enumLabels from
// SOMEWHERE, and the task's own instruction is explicit: import a real vocabulary module,
// never copy a label map into the definition. No prior module existed to import.
//
// A metadata FieldDefinition imports its enumValues/enumLabels from here. It must never
// carry a second label map of its own.

import { INVOICE_DELIVERY_METHOD, PAYMENT_TERMS, TAX_STATUS } from "./constants.js";

export { INVOICE_DELIVERY_METHOD, PAYMENT_TERMS, TAX_STATUS };

/** Stored value -> the words a user reads. */
export const INVOICE_DELIVERY_METHOD_LABEL = Object.freeze({
  [INVOICE_DELIVERY_METHOD.EMAIL]: "Email",
  [INVOICE_DELIVERY_METHOD.PORTAL]: "Portal",
  [INVOICE_DELIVERY_METHOD.MAIL]: "Mail",
  [INVOICE_DELIVERY_METHOD.EDI]: "EDI (Electronic Data Interchange)",
});

// paymentTerms is a GOVERNED field (admin-only edit, firestore.rules'
// accountGovernedFieldsValid/accountGovernedFieldsUnchanged) — this label map covers its
// display vocabulary only, not its authorization. COD is spelled out rather than left as
// the bare acronym, matching how the other three read as words rather than codes.
export const PAYMENT_TERMS_LABEL = Object.freeze({
  [PAYMENT_TERMS.COD]: "Cash on Delivery",
  [PAYMENT_TERMS.NET_30]: "Net 30",
  [PAYMENT_TERMS.NET_60]: "Net 60",
  [PAYMENT_TERMS.NET_90]: "Net 90",
});

// taxStatus is the OTHER governed field. UNKNOWN is the safe default resolveTaxStatus()
// (domain/commercialProfile.js) returns for an absent stored value — never TAXABLE — and it
// gets a real label here rather than being left to render as a bare enum token.
export const TAX_STATUS_LABEL = Object.freeze({
  [TAX_STATUS.UNKNOWN]: "Unknown",
  [TAX_STATUS.TAXABLE]: "Taxable",
  [TAX_STATUS.EXEMPT]: "Exempt",
  [TAX_STATUS.RESELLER]: "Reseller",
});
