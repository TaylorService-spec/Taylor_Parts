// WHICH SOURCE ANSWERS THE ACCOUNT PAGE'S RECEIVABLES, as the screen needs to know it. Firebase exit F7c (DECISIONS #245).
//
// The choice itself is the compile-time flag F1 introduced (access/eosSessionSource.js); this only names the consequence for the
// words on screen. Where an EOS API is declared the rows are the Finance register's receivables (NOT accounting invoices,
// DECISIONS #197), so a screen that has not yet heard from its read says "Receivable"; elsewhere it says "Invoice", unchanged.
// A settled read names its own noun (domain/accountArView.js `recordNoun`), which wins.
import { EOS_SESSION_SOURCE } from "./eosSessionSource.js";
import { EOS_RECORD_NOUN } from "../domain/accountReceivablesEos.js";

export const ACCOUNT_AR_RECORD_NOUN = EOS_SESSION_SOURCE ? EOS_RECORD_NOUN : "Invoice";
