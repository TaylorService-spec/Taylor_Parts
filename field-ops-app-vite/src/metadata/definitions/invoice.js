import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { INVOICE_STATES } from "../../domain/commercialFinance.js";

// Invoice — Finance / Billing / AR (A-ENTITY-BILLING-DEFINITIONS). The immutable issued invoice
// record `issueInvoice` (functions/src/finance/invoiceCallables.ts) writes, and the record
// `applyPayment` / `recordInvoiceAdjustment` / `recordRefund` later mutate a bounded, derived AR
// projection on top of.
//
// READ IS A TRUSTED CALLABLE, NOT A CLIENT QUERY. `invoices` is deny-all in Firestore Rules
// (firestore.rules line ~1764: "allow read, write: if false"). The only read path anywhere in
// this codebase is `listAccountInvoiceAr` (functions/src/finance/financeReadCallables.ts), an
// account-scoped bounded read gated by capability `finance.read` — registered in the catalog
// (functions/src/access/permissionCatalog.ts) with active:false, a hard deny for everyone until a
// separate Owner grant. Declaring readVia CALLABLE / readCallable / readCapability here describes
// that read path; it does not activate it — register is not grant, the same distinction
// salesOrder.js and opportunity.js already record.
//
// IDENTITY IS THE REFERENCE, WITH NO nameField. invoiceNumber (INV-######, formatInvoiceNumber in
// functions/src/finance/invoiceNumbering.ts) is allocated from a per-company counter INSIDE the
// same transaction that writes the invoice (allocateInvoiceNumber), immutable thereafter, and
// never reused. There is no human-entered name field on this record anywhere in its write path
// (invoiceCommands.ts's InvoiceRecord has none) — declaring one would be inventing data, not
// describing it.
//
// THE READ PROJECTION IS NARROWER THAN THE STORED DOCUMENT — A GAP, RECORDED RATHER THAN PAPERED
// OVER. listAccountInvoiceAr's projection (financeReadProjection.ts's projectInvoiceAr) returns
// only { invoiceId, invoiceNumber, accountId, salesOrderId, currency, state, totalMinor,
// appliedMinor, creditsMinor, chargesMinor, writeOffMinor, outstandingMinor, dueDate } plus two
// DERIVED fields computed at read time, never stored: arPosition and daysOverdue (NOT declared as
// FieldDefinitions here for that reason — the same restraint purchaseOrder.js applies to its own
// computed viewStatus). Fields declared below that are real, stored facts (invoiceCommands.ts /
// invoiceCallables.ts / paymentCallables.ts / adjustmentCallables.ts) but are NOT in that list —
// companyId, issuedAt, issuedAtMillis, updatedAt, subtotalMinor, discountMinor, taxMinor,
// taxProvenance — are marked individually below. A caller reading through the one real CALLABLE
// today will not receive them; this is a read-wiring gap (the same category salesOrder.js's own
// header names for salesOrderNumber), not a reason to omit them from what the record IS.
//
// STATE VALUES COME FROM domain/commercialFinance.js's INVOICE_STATES, never a second copy —
// the same rule salesOrder.js's state field follows. That module is a design-first, FORWARD-
// LOOKING vocabulary; DRAFT and SENT are declared there but UNREACHABLE by any write path that
// exists today — buildInvoiceRecord (invoiceCommands.ts) always creates an invoice already in
// state ISSUED, and the only other writers (deriveInvoiceStateFromFacts in paymentCommands.ts /
// adjustmentCommands.ts / refundCommands.ts) only ever produce PARTIALLY_PAID, PAID, or VOID.
// Declared here as the full module vocabulary anyway (reuse, not a fork) rather than a
// hand-maintained subset that could silently drift from the shared module. enumLabels are
// declared inline (no separate label module exists for this vocabulary anywhere in the codebase).
//
// NOT FILTERABLE. Unlike salesOrder.js's accountId (a real backing query — see below), state has
// no supporting query anywhere: listAccountInvoiceAr accepts only { accountId, limit }, no state
// parameter. Declaring a filter here would promise a query the read service cannot keep — the
// same restraint purchaseOrder.js applies to its own single-legal-value status.
//
// accountId IS FILTERABLE — THE ONE REAL BACKING QUERY. listAccountInvoiceAr's Firestore query is
// literally `.where("accountId", "==", accountId)`; this is not aspirational.
//
// MONEY IS CURRENCY_MINOR — INTEGER MINOR UNITS, VERIFIED AGAINST THE COMMAND CORE. Unlike
// salesOrder.js's plain-string currency (no minor-unit amount stored beside it), invoices carry
// real minor-unit money: invoiceCommands.ts's isNonNegInt/isPosInt guards enforce every amount
// (subtotalMinor/discountMinor/taxMinor/totalMinor/outstandingMinor) as a safe integer, never a
// float, and paymentCommands.ts / adjustmentCommands.ts extend the same integer discipline to
// appliedMinor/creditsMinor/chargesMinor/writeOffMinor. currency itself stays a plain STRING (the
// code the amounts are denominated in), matching account.js's defaultCurrency reasoning.
//
// appliedMinor / creditsMinor / chargesMinor / writeOffMinor ARE SPARSE, NOT ALWAYS PRESENT.
// buildInvoiceRecord never sets them at issuance — they are added to the document only by a LATER
// applyPayment / recordInvoiceAdjustment write (paymentCallables.ts / adjustmentCallables.ts), and
// read back via `nn()` (treats absent as 0) everywhere they are consumed. A freshly issued,
// never-paid invoice genuinely does not have these keys yet; that is the document's real shape,
// not a rendering bug.
//
// PROVENANCE HAS A NAMED GAP: NO createdBy, NO updatedBy, ANYWHERE ON THIS DOCUMENT. issuedAt
// (FieldValue.serverTimestamp(), set once in persistIssuedInvoice) is the real creation-time
// provenance field; issuedAtMillis (a plain number, `Date.now()` captured moments earlier inside
// the same transaction, InvoiceRecord's own field) is a near-duplicate at lower precision, kept
// distinct here because both are genuinely stored under different names and different types.
// updatedAt (FieldValue.serverTimestamp()) IS set — by applyPayment, recordInvoiceAdjustment, and
// recordRefund, every time one of them patches the AR projection — so the record is mutable and
// updatedAt is a real, if sparse (absent until the first such write), field. But NO write path
// anywhere — not issuance, not payment, not adjustment, not refund — ever stores WHO acted on the
// invoice DOCUMENT itself; the actor uid is captured only in the separate, append-only audit event
// (stageAuditEventWithId's actorUid), never copied onto the invoice. Declaring a createdBy/
// updatedBy FieldDefinition here would describe a write path that does not exist.
//
// sequence AND lines ARE DELIBERATELY NOT DECLARED. sequence is the raw counter integer
// invoiceNumber is formatted from (invoiceNumbering.ts) — redundant with the reference field
// already declared, an internal numbering artifact rather than a fact a list or record page would
// ever render on its own. `lines` is an embedded array (InvoiceLineRecord[]) on the document, not
// a flat column any list here could render — the same restraint salesOrder.js applies to its own
// `lines`.
//
// NO invoiceIndexList IS DECLARED (H4/M19 fix). One used to exist here, INDEX surface, with no
// readCallable override — which meant it silently inherited the entity's own readCallable at
// runtime (listRuntime.js, `entity.readCallable ?? null`). That inherited callable,
// listAccountInvoiceAr, is REQUIRED-scoped (functions/src/finance/financeReadCallables.ts —
// `.where("accountId", "==", accountId)`, HttpsError("invalid-argument") if accountId is
// missing), and an INDEX list never supplies a parent-scope filter (buildQueryDescriptor only
// prepends one for `surface === "RELATED"`) — so this list would have thrown on the FIRST
// request from every single user who opened it, forever, because no scope it could ever supply
// would satisfy the callable. Registering listAccountInvoiceAr in CALLABLE_SOURCES does not fix
// this — the mismatch is structural (scoped callable, unscoped surface), not a missing
// registration, and no unscoped invoice read exists anywhere in functions/src to swap in (unlike
// opportunity.index's listOpportunityContext / salesOrder.index's listSalesOrderIndex, both
// purpose-built unscoped siblings of their account-scoped callable). No route or component
// imported this list (verified: `grep -rl invoiceIndexList src` outside this file returned
// nothing), so removing it breaks no live surface. The entity's own readCallable stays declared
// (readVia CALLABLE genuinely applies — invoices is deny-all in Rules) and is now registered in
// CALLABLE_SOURCES for when the real consumer — a RELATED list under account.js, scoped by the
// accountId this callable actually requires — gets built; see REGISTRATION_PENDING.

export const invoiceEntity = makeEntityDefinition({
  id: "invoice",
  label: "Invoice",
  labelPlural: "Invoices",
  collection: "invoices",
  readVia: "CALLABLE",
  readCallable: "listAccountInvoiceAr",
  readCapability: "finance.read",
  identity: makeIdentity({ referenceField: "invoiceNumber" }),
  description: "The immutable ISSUED invoice record following a billable Sales Order. Deny-all in Rules; read only through the governed listAccountInvoiceAr callable.",
  fields: [
    makeFieldDefinition({
      id: "invoiceNumber",
      entityId: "invoice",
      label: "Invoice",
      type: "STRING",
      sortable: true,
      description: "INV-######, server-allocated per company at creation (allocateInvoiceNumber) and immutable. Returned by listAccountInvoiceAr's projection.",
    }),
    makeFieldDefinition({
      id: "state",
      entityId: "invoice",
      label: "State",
      type: "ENUM",
      enumValues: [...INVOICE_STATES],
      enumLabels: {
        DRAFT: "Draft",
        ISSUED: "Issued",
        SENT: "Sent",
        PARTIALLY_PAID: "Partially Paid",
        PAID: "Paid",
        VOID: "Void",
      },
      description: "DRAFT/SENT are declared in the shared vocabulary but unreachable by any write path today — see the file header. Not filterable: no query anywhere filters invoices by state.",
    }),
    makeFieldDefinition({
      id: "currency",
      entityId: "invoice",
      label: "Currency",
      type: "STRING",
      description: "Free-form string (e.g. \"USD\"); the code the CURRENCY_MINOR amounts below are denominated in.",
    }),
    makeFieldDefinition({
      id: "accountId",
      entityId: "invoice",
      label: "Account",
      type: "REFERENCE",
      referenceTo: "account",
      filterable: true,
      operators: ["EQUALS"],
      description: "The scope listAccountInvoiceAr actually queries by (`.where(\"accountId\", \"==\", accountId)`).",
    }),
    makeFieldDefinition({
      id: "salesOrderId",
      entityId: "invoice",
      label: "Sales Order",
      type: "REFERENCE",
      referenceTo: "salesOrder",
      description: "Written once at issuance (issueInvoice cross-checks it against the governed Sales Order). Preserves the Sales Order -> Invoice lineage.",
    }),
    makeFieldDefinition({
      id: "dueDate",
      entityId: "invoice",
      label: "Due Date",
      // DATE, NOT NUMBER — it is a date that happens to be STORED as ms epoch (invoiceCommands.ts's
      // isInt guard), never a Firestore Timestamp. Typing it NUMBER made it a date claiming to be a
      // plain number; DATE resolves through the same shared formatter as TIMESTAMP
      // (listPresentation.js's cellValue -> domain/displayTimestamp.js's formatTimestamp), which
      // already coerces an epoch-millisecond NUMBER, so no storage-shape change is implied. Not
      // filtered or sorted by anywhere in this file (no list view is declared here at all — see
      // the file header's account of why invoiceIndexList was removed) so this retype changes no
      // FILTER/SORT meaning and demands no composite index.
      type: "DATE",
      sortable: true,
      description: "Ms epoch, carried (not computed) at issuance — AR aging begins here. A plain number in storage, never a Firestore Timestamp (invoiceCommands.ts's isInt guard), but a DATE by kind — see cellValue's DATE/TIMESTAMP handling.",
    }),
    makeFieldDefinition({
      id: "issuedAt",
      entityId: "invoice",
      label: "Issued",
      type: "TIMESTAMP",
      description: "FieldValue.serverTimestamp(), set once in persistIssuedInvoice. The record's real creation-time provenance field. Not in listAccountInvoiceAr's current projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "issuedAtMillis",
      entityId: "invoice",
      label: "Issued (ms)",
      type: "NUMBER",
      description: "A plain `Date.now()` snapshot captured moments before issuedAt commits, inside the same transaction (InvoiceRecord's own field). A near-duplicate of issuedAt at lower precision, not a second event. Not in the current read projection.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "invoice",
      label: "Updated",
      type: "TIMESTAMP",
      description: "FieldValue.serverTimestamp(), set by applyPayment / recordInvoiceAdjustment / recordRefund whenever one of them patches the AR projection. Sparse — absent until the first such write. No updatedBy exists anywhere; see the file header.",
    }),
    makeFieldDefinition({
      id: "totalMinor",
      entityId: "invoice",
      label: "Total",
      type: "CURRENCY_MINOR",
      description: "The authoritative invoice total, recomputed server-side at issuance from the committed Sales Order unit-price snapshot + injected tax. Integer minor units, never a float.",
    }),
    makeFieldDefinition({
      id: "outstandingMinor",
      entityId: "invoice",
      label: "Outstanding",
      type: "CURRENCY_MINOR",
      description: "= totalMinor at issuance; a transactionally-maintained PROJECTION thereafter (total - applied - credits + charges - writeoffs), never an independently editable authority.",
    }),
    makeFieldDefinition({
      id: "subtotalMinor",
      entityId: "invoice",
      label: "Subtotal",
      type: "CURRENCY_MINOR",
      description: "Sum of line subtotals before tax/discount. Stored on the document; not in listAccountInvoiceAr's current projection — see the file header.",
    }),
    makeFieldDefinition({
      id: "discountMinor",
      entityId: "invoice",
      label: "Discount",
      type: "CURRENCY_MINOR",
      description: "Sum of explicit governed line discounts. Stored on the document; not in the current read projection.",
    }),
    makeFieldDefinition({
      id: "taxMinor",
      entityId: "invoice",
      label: "Tax",
      type: "CURRENCY_MINOR",
      description: "Sum of the injected per-line tax determination. Stored on the document; not in the current read projection.",
    }),
    makeFieldDefinition({
      id: "appliedMinor",
      entityId: "invoice",
      label: "Applied",
      type: "CURRENCY_MINOR",
      description: "Running sum of payment applications. Sparse — absent until the first applyPayment. See the file header.",
    }),
    makeFieldDefinition({
      id: "creditsMinor",
      entityId: "invoice",
      label: "Credits",
      type: "CURRENCY_MINOR",
      description: "Running sum of CREDIT_MEMO adjustments feeding the outstanding formula. Sparse — absent until the first recordInvoiceAdjustment of that type.",
    }),
    makeFieldDefinition({
      id: "chargesMinor",
      entityId: "invoice",
      label: "Charges",
      type: "CURRENCY_MINOR",
      description: "Running sum of DEBIT_CHARGE adjustments feeding the outstanding formula. Sparse — absent until the first recordInvoiceAdjustment of that type.",
    }),
    makeFieldDefinition({
      id: "writeOffMinor",
      entityId: "invoice",
      label: "Write-offs",
      type: "CURRENCY_MINOR",
      description: "Running sum of WRITE_OFF adjustments feeding the outstanding formula. Sparse — absent until the first recordInvoiceAdjustment of that type.",
    }),
    makeFieldDefinition({
      id: "companyId",
      entityId: "invoice",
      label: "Company",
      type: "STRING",
      description: "The per-company scope the invoice numbering counter is keyed by (invoiceNumbering.ts). No `company` EntityDefinition is registered in this program, so this stays a plain string rather than a REFERENCE.",
    }),
    makeFieldDefinition({
      id: "taxProvenance",
      entityId: "invoice",
      label: "Tax Provenance",
      type: "STRING",
      description: "Optional provenance of the injected tax determination (audit/evidence), carried through unchanged from issuance input. Stored on the document; not in the current read projection.",
    }),
  ],
  // No relationships declared. account.invoices (the Account -> Invoice edge) would be declared
  // on account.js, the owning entity, the same rule salesOrder.js's own footer names — account.js
  // is outside this lane's writeScope. See REGISTRATION_PENDING in the handoff.
});

