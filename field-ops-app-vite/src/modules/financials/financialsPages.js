// WHICH FINANCIALS PAGE MOUNTS, decided once at BUILD time (Firebase exit B1, DECISIONS #B1) by the compile-time flag F1, F7c and the
// facts hook use (access/eosSessionSource.js): where an EOS API is declared the five record pages are the EOS ones (Receivables,
// Accounts Receivable, Settlements and their record pages, over the Finance register); everywhere else -- production declares none --
// the Firebase-backed pages are the SOLE implementation, exactly as before. There is no runtime fallback in either direction, and a
// page that is not chosen is never loaded (each is its own lazy chunk).
import { lazy } from "react";
import { EOS_SESSION_SOURCE } from "../../access/eosSessionSource.js";

const pick = (eos, legacy) => lazy(() => (EOS_SESSION_SOURCE ? eos() : legacy()));

export const FinancialsInvoices = pick(() => import("./FinancialsReceivablesEos.jsx"), () => import("./FinancialsInvoices.jsx"));
export const FinancialsAccountsReceivable = pick(() => import("./FinancialsAccountsReceivableEos.jsx"), () => import("./FinancialsAccountsReceivable.jsx"));
export const FinancialsPayments = pick(() => import("./FinancialsSettlementsEos.jsx"), () => import("./FinancialsPayments.jsx"));
export const FinancialsInvoiceDetail = pick(() => import("./FinancialsReceivableDetailEos.jsx"), () => import("./FinancialsInvoiceDetail.jsx"));
export const FinancialsPaymentDetail = pick(() => import("./FinancialsSettlementDetailEos.jsx"), () => import("./FinancialsPaymentDetail.jsx"));
