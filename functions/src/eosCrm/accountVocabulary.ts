// CRM Account business vocabulary -- wave D1-A. Pure: no I/O, no SQL, no Firebase.
//
// Every list here restates a vocabulary the product already stores and validates, so the PostgreSQL authority accepts
// exactly what the Account form writes today and nothing more:
//
//   ACCOUNT_RELATIONSHIP_TYPES     field-ops-app-vite/src/domain/constants.js ACCOUNT_RELATIONSHIP_TYPE
//   ACCOUNT_LINES_OF_BUSINESS      field-ops-app-vite/src/domain/constants.js ACCOUNT_LINE_OF_BUSINESS
//   INVOICE_DELIVERY_METHODS       field-ops-app-vite/src/domain/constants.js INVOICE_DELIVERY_METHOD
//   PAYMENT_TERMS                  field-ops-app-vite/src/domain/constants.js PAYMENT_TERMS (governed)
//   TAX_STATUSES                   field-ops-app-vite/src/domain/constants.js TAX_STATUS (governed; absent == UNKNOWN)
//   ISO_4217_CURRENCIES            field-ops-app-vite/src/domain/commercialProfile.js ISO_4217_CURRENCIES -- the SAME
//                                  fixed set, fail-closed, never a runtime currency list
//
// Migration 1759795200000 carries the enum lists as CHECK constraints (lines of business only as an opaque key shape:
// executable SQL never names an operating company); crmAuthority.test.mjs pins these lists to the
// client sources and to that migration so the three cannot drift apart silently.

export const ACCOUNT_RELATIONSHIP_TYPES = Object.freeze(["CUSTOMER", "VENDOR"] as const);
export const ACCOUNT_LINES_OF_BUSINESS = Object.freeze(["TAYLOR", "VENTANA"] as const);
export const INVOICE_DELIVERY_METHODS = Object.freeze(["EMAIL", "PORTAL", "MAIL", "EDI"] as const);
export const PAYMENT_TERMS = Object.freeze(["COD", "NET_30", "NET_60", "NET_90"] as const);
export const TAX_STATUSES = Object.freeze(["UNKNOWN", "TAXABLE", "EXEMPT", "RESELLER"] as const);

/** The governed-field baseline firestore.rules accountGovernedCreateBaseline allows without the governed capability. */
export const isUngovernedPaymentTerms = (value: string | null): boolean => value === null;
export const isUngovernedTaxStatus = (value: string | null): boolean => value === null || value === "UNKNOWN";

export const ISO_4217_CURRENCIES: ReadonlySet<string> = new Set([
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BOV",
  "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHE", "CHF",
  "CHW", "CLF", "CLP", "CNY", "COP", "COU", "CRC", "CUC", "CUP", "CVE",
  "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD",
  "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD",
  "HNL", "HRK", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK",
  "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD",
  "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL",
  "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN",
  "MXV", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR",
  "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD",
  "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE",
  "SLL", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS",
  "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD",
  "USN", "UYI", "UYU", "UYW", "UZS", "VED", "VES", "VND", "VUV", "WST",
  "XAF", "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XCD", "XDR", "XOF",
  "XPD", "XPF", "XPT", "XSU", "XUA", "YER", "ZAR", "ZMW", "ZWL",
]);

export const MAX_ACCOUNT_TAGS = 100;
export const MAX_ACCOUNT_TAG_LENGTH = 200;
