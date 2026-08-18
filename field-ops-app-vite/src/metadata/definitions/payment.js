import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";

// Payment (cash receipt) — Finance / Billing / AR (A-ENTITY-BILLING-DEFINITIONS). The record
// `applyPayment` (functions/src/finance/paymentCallables.ts) writes: money RECEIVED, distinct from
// HOW it is applied (paymentCommands.ts's own header). Applications live in the separate
// `payment_applications` collection — a DIFFERENT collection, not registered here (outside this
// lane's writeScope; see REGISTRATION_PENDING in the handoff). A Payment document therefore has NO
// invoiceId of its own — that link is the payment_applications record's job, not this one's.
//
// READ VIA IS HONESTLY UNKNOWN — THERE IS NO READ PATH ANYWHERE, NOT EVEN A REGISTERED-INACTIVE
// ONE. `payments` is deny-all in Firestore Rules (firestore.rules: "allow read, write: if false"
// on `match /payments/{paymentId}`), exactly like `invoices`. But unlike invoices — which has
// listAccountInvoiceAr, a real trusted read callable registered end to end even while its
// capability sits active:false — grepping functions/src for PAYMENTS_COLLECTION finds it used in
// exactly two places: its own collection-name constant, and the WRITE side of applyPayment
// (paymentCallables.ts). No listPaymentsForAccount, no getPayment, no read callable of any kind
// exists, registered or not. There is also no `finance.payment.read` (or similar) anywhere in the
// capability catalog (functions/src/access/permissionCatalog.ts / the client-side mirror in
// src/access/permissionCatalog.ts) — finance.read's own description names it as covering
// "invoice + derived AR position ... via the trusted listAccountInvoiceAr callable" specifically,
// not payments, so citing it here would misattribute a capability to a read path that does not
// exist. readVia is therefore UNKNOWN, readCallable and readCapability are both null, and NO list
// view is declared in this file at all (an INDEX or RELATED list over an unreachable collection
// would promise a surface nothing can actually serve). This is a genuine, load-bearing gap in the
// program today, recorded rather than routed around.
//
// IDENTITY IS A nameField, AND THE CHOICE IS RECORDED AS IMPERFECT RATHER THAN CLEAN. There is no
// server-allocated business reference anywhere in this write path (no PAY-YYYY-###### /
// allocatePaymentNumber; grepping functions/src and src/domain for either finds nothing) — the
// same absence purchaseOrder.js already names for its own record, and per this lane's brief,
// inventing one is a business decision outside a leaf's authority, so referenceField stays
// undeclared. externalRef (paymentCommands.ts's CashReceiptRecord) is the one candidate: a
// caller-supplied external reference (e.g. a check or wire number) a human might actually read to
// identify a receipt. But UNLIKE purchaseOrder.js's externalPoNumber (required, non-empty,
// enforced by Rules) this field is genuinely OPTIONAL — `typeof input.externalRef === "string" &&
// input.externalRef.length > 0 ? ... : null` — and nothing anywhere requires a caller to supply
// one. A payment recorded without one has NO human-legible name at all; that is a real data-model
// gap this identity declaration does not paper over. It is declared as nameField anyway because
// the identity contract requires a nameField or a referenceField (an entity with neither cannot be
// validated), and externalRef — even though frequently null — is the only real, non-invented field
// on this record that is ever a human-facing label. The gap (null externalRef ⇒ no name) is
// recorded here and in the test file rather than silently normalized to a document id, which
// identity.js's own contract explicitly forbids.
//
// MONEY IS CURRENCY_MINOR — INTEGER MINOR UNITS. paymentCommands.ts's isPosInt/nn guards enforce
// amountMinor as a positive safe integer and appliedMinor/unappliedMinor as non-negative safe
// integers, matching invoice.js's own money fields exactly. currency stays a plain STRING (the
// code the amounts are denominated in), not a currency type itself.
//
// appliedMinor / unappliedMinor DESCRIBE THIS INCREMENT'S ACTUAL BEHAVIOR, NOT A FUTURE ONE.
// paymentCommands.ts's own header names the forward-compat intent (a receipt may one day apply
// across many invoices, or leave a credit balance) but buildApplyPayment's current implementation
// always fully applies a receipt to exactly one invoice and REJECTS any amount that would exceed
// the invoice's outstanding balance (OVER_APPLICATION) — so appliedMinor === amountMinor and
// unappliedMinor === 0 on every stored receipt today. Declared as real fields because they are
// really written (not because their value is expected to vary yet).
//
// receivedAtMillis / receivedAt / createdAt ARE THREE DISTINCT, ALL-REAL FIELDS, NOT A TYPO.
// receivedAtMillis (paymentCommands.ts's CashReceiptRecord) is CALLER-SUPPLIED — the actual date
// the cash was received, which the trusted command core never overrides and which may be in the
// past (recording a check received last week). receivedAt and createdAt are BOTH set to
// `FieldValue.serverTimestamp()` in the SAME `tx.set` call in persistIssuedInvoice's payment
// counterpart (paymentCallables.ts) — two different field names carrying what will always be the
// identical server commit time on every write. That redundancy is a genuine, if odd, fact about
// the stored document, not a modeling choice made here; both are declared as they exist.
//
// PROVENANCE: createdAt EXISTS; createdBy DOES NOT, ANYWHERE. createdAt is the record's real
// creation-time provenance field (see above). No write path stores an actor uid on the payment
// document itself — actorUid is captured only in the separate, append-only audit event
// (stageAuditEventWithId), never copied onto the receipt. Declaring a createdBy FieldDefinition
// here would describe a write path that does not exist.
//
// NO updatedAt / updatedBy — A STRUCTURAL FACT, NOT A GAP. Grepping paymentCallables.ts (the
// collection's only writer) finds exactly one write to PAYMENTS_COLLECTION: the initial
// `tx.set(paymentRef, ...)` inside applyPayment. No other command in this program ever calls
// `.update()` on a `payments/{paymentId}` document. A cash receipt is append-only by construction
// (a new receipt, not an edit, is how a correction would be represented) — the same distinction
// purchaseOrder.js's header draws for its own never-updated record (`allow update, delete: if
// false` there; here there is simply no update call anywhere in the writer, since Rules deny ALL
// direct writes regardless and the trusted command never issues one).

export const paymentEntity = makeEntityDefinition({
  id: "payment",
  label: "Payment",
  labelPlural: "Payments",
  collection: "payments",
  readVia: "UNKNOWN",
  readCapability: null,
  identity: makeIdentity({ nameField: "externalRef" }),
  description: "A cash receipt recorded by the trusted applyPayment command — money received, distinct from how it is applied (see payment_applications, out of scope here). Deny-all in Rules; no read path of any kind exists today.",
  fields: [
    makeFieldDefinition({
      id: "externalRef",
      entityId: "payment",
      label: "Reference",
      type: "STRING",
      description: "Caller-supplied external reference (e.g. a check or wire number). OPTIONAL — null when not supplied, in which case this record has no human-legible name at all. See the file header for why this is nameField despite that.",
    }),
    makeFieldDefinition({
      id: "companyId",
      entityId: "payment",
      label: "Company",
      type: "STRING",
      description: "Required. No `company` EntityDefinition is registered in this program, so this stays a plain string rather than a REFERENCE — the same reasoning invoice.js's own companyId field gives.",
    }),
    makeFieldDefinition({
      id: "accountId",
      entityId: "payment",
      label: "Account",
      type: "REFERENCE",
      referenceTo: "account",
      description: "Required. Not filterable — no read path exists to back a query of any kind (see the file header).",
    }),
    makeFieldDefinition({
      id: "currency",
      entityId: "payment",
      label: "Currency",
      type: "STRING",
      description: "Free-form string (e.g. \"USD\"); the code the CURRENCY_MINOR amounts below are denominated in.",
    }),
    makeFieldDefinition({
      id: "amountMinor",
      entityId: "payment",
      label: "Amount",
      type: "CURRENCY_MINOR",
      description: "The cash amount received. Required, positive integer minor units (paymentCommands.ts's isPosInt), never a float.",
    }),
    makeFieldDefinition({
      id: "method",
      entityId: "payment",
      label: "Method",
      type: "STRING",
      description: "Optional, free-form (e.g. \"CHECK\", \"ACH\"). No closed vocabulary/enum exists for this field anywhere in the codebase, so it is declared STRING rather than an invented ENUM.",
    }),
    makeFieldDefinition({
      id: "receivedAtMillis",
      entityId: "payment",
      label: "Received",
      type: "NUMBER",
      description: "Ms epoch, CALLER-SUPPLIED (the actual date the cash was received, which may be in the past). A plain number, never a Firestore Timestamp. Distinct from receivedAt/createdAt below — see the file header.",
    }),
    makeFieldDefinition({
      id: "receivedAt",
      entityId: "payment",
      label: "Received (server)",
      type: "TIMESTAMP",
      description: "FieldValue.serverTimestamp(), set once at write time — identical in value to createdAt on every stored receipt (both set in the same tx.set call). See the file header for why both are declared despite the redundancy.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "payment",
      label: "Created",
      type: "TIMESTAMP",
      description: "FieldValue.serverTimestamp(), set once at write time. The record's real creation-time provenance field. No createdBy exists anywhere — see the file header.",
    }),
    makeFieldDefinition({
      id: "appliedMinor",
      entityId: "payment",
      label: "Applied",
      type: "CURRENCY_MINOR",
      description: "The portion of this receipt applied to an invoice. Always equal to amountMinor today (buildApplyPayment fully applies every receipt to one invoice) — see the file header.",
    }),
    makeFieldDefinition({
      id: "unappliedMinor",
      entityId: "payment",
      label: "Unapplied",
      type: "CURRENCY_MINOR",
      description: "The receipt's own unapplied balance. Always 0 today (over-application is rejected, not banked as a credit) — forward-compat field, see the file header.",
    }),
  ],
  // No relationships declared. account.payments (the Account -> Payment edge) would be declared
  // on account.js, the owning entity — outside this lane's writeScope. See REGISTRATION_PENDING.
});
