import {
  ADMIN_EDIT_SCOPE,
  MIGRATION_READINESS,
  MUTABILITY,
  REPRESENTATION_DISPOSITION,
  cite,
  makeAdminEditing,
  makeCommandDescriptor,
  makeFieldPolicy,
  makeIdentityRule,
  makeMigrationStatus,
  makeObjectAdministrationProfile,
  makeOwnershipRule,
  makeReadModel,
  makeRepresentation,
} from "../objectAdministrationProfile.js";

// PAYMENT — the cash receipt, as an Object Administration Profile.
//
// ════════════════════ THIS FILE'S IMPORT DOES NOT RESOLVE ON `main` YET ════════════════════
//
// `../objectAdministrationProfile.js` is lane C2's module (branch impl/w1-part-admin-objects, PR
// #1866) and has not landed. This profile is written to C2's contract and deliberately NOT
// cherry-picked, so it becomes live the moment C2 merges and its registry gains one line. That
// registry line is recorded in docs/handoff/w1-c12-registrations.md rather than applied here,
// because `administrationProfileRegistry.js` does not exist on this branch to edit. Nothing
// imports this file until then, so nothing breaks in the meantime -- but a reviewer should know
// the dependency is real and is the reason the profile arrives before its registration.
//
// ════════════════════ WHAT PAYMENT LOOKS LIKE WHEN YOU ACTUALLY MEASURE IT ════════════════════
//
// Part (C2's reference) was chosen because its whole chain was intact and could be described.
// Payment is the opposite case, and describing it honestly is the point:
//
//   * ONE governed write command exists (applyPayment) and NOTHING ELSE writes the collection.
//   * NO read path of any kind exists -- not a callable, not a Rules-permitted client read, not
//     even a registered-inactive capability. `payments` is `allow read, write: if false`.
//   * NO post-creation command exists at all, so every field is SET_AT_CREATE or server-stamped
//     and there is nothing an administration surface could offer to edit.
//   * The one thing the object stores that is NOT a durable fact -- the receipt's own
//     appliedMinor/unappliedMinor -- is a stored aggregate of a separate collection, written once
//     and never maintained. It is declared below as a representation marked RETIRE, because that
//     is what it is, and because a compatibility layer with no recorded disposition becomes
//     permanent by default.
//
// ════════════════════ THE ONE CLAIM THIS PROFILE WOULD BE WRONG TO MAKE ════════════════════
//
// It would be easy to write "outstanding and applied are derived, not stored" here, because
// functions/src/finance/paymentCommands.ts's header says so in its own words. Measured, that is
// half true and the false half is the one that matters: the derivation function is real and pure,
// AND the results are written into columns that a later command (recordRefund) changes without
// writing a corresponding fact. So this profile does not restate the promise. It cites the
// derivation where the derivation is real, names the stored copies as a representation to retire,
// and records in `migration` that the drift detector for the receipt half is not called from
// anywhere in production.

export const paymentAdministrationProfile = makeObjectAdministrationProfile({
  entityId: "payment",
  description:
    "A cash receipt — money received, distinct from how it is applied. Written by exactly one governed " +
    "command, readable by nothing, and append-only by construction.",

  // ── IDENTITY ───────────────────────────────────────────────────────────────────────────────
  //
  // `documentIdIsIdentity` is FALSE, and the reason is not that the id is something else. It is
  // that the Firestore receipt stores NO paymentId field, so the stored-value-equals-storage-key
  // claim has no stored value to be about -- there is nothing to enforce and nothing that could be
  // caught disagreeing. Declaring it true and citing nothing is exactly the shape C2's validator
  // refuses, and it would be the more flattering of the two available answers.
  identityRule: makeIdentityRule({
    idField: "paymentId",
    documentIdIsIdentity: false,
    // An opaque server-allocated id has exactly one canonical rule -- it is a non-empty governed
    // string and nothing else may stand in for it. That rule is implemented once, for every
    // governed key this authority carries, and cited rather than restated.
    canonicalValidator: cite("functions/src/eosOps/cashApplicationAuthority.ts", "requireGovernedKey"),
    enforcedBy: null,
    neverSubstituted: [
      "externalRef — a check or wire number, caller-supplied, frequently null, and not unique",
      "the invoiceId the receipt was applied to (that link is a payment_applications row, not the receipt)",
      "the invoiceNumber of that invoice (a different object's reference, allocated by a different command)",
      "the payment_applications document id (the allocation is not the money)",
      "the accountId the cash came from",
      "the deterministic audit event id applyPayment derives for idempotency",
      "receivedAtMillis, or any timestamp — two receipts can arrive in the same millisecond",
    ],
    derivation: null,
    description:
      "Canonical identity is the `payments` document id, allocated by applyPayment via " +
      "db.collection(PAYMENTS_COLLECTION).doc() and never written onto the document. In the target " +
      "authority it is eos_finance.payments.id, a TEXT PRIMARY KEY, where a stored/key divergence is " +
      "structurally impossible. There is no PAY-###### sequence anywhere in the program; inventing " +
      "one is a business decision, not a metadata one.",
  }),

  // ── OWNERSHIP AND OPERATING COMPANY ────────────────────────────────────────────────────────
  //
  // COMPANY / SINGLE_COMPANY by ruling D-15: a ledger entry belongs to the books it lands in, not
  // to the salesperson upstream of it. The owning company is NEVER inferred -- applyPayment takes
  // it from the governed invoice and treats the caller's own `companyId` as an assertion that must
  // match or the call fails (COMPANY_MISMATCH).
  //
  // THE FIELD IS NAMED `companyId`, NOT `operatingCompanyId`, AND THAT IS A REAL DIVERGENCE. Its
  // VALUE is the operating company -- invoiceCommands.ts sets invoice.companyId from the sales
  // order's operatingCompanyId and nothing else -- but the finance family spells the field
  // differently from every other object in the ownership matrix. Recorded here rather than
  // silently normalized, because a reader matching field names across objects will otherwise
  // conclude Payment has no operating company at all.
  ownership: makeOwnershipRule({
    ownerClass: "COMPANY",
    companyScope: "SINGLE_COMPANY",
    companyField: "companyId",
    authority: cite("functions/src/ownership/ownershipMatrix.ts", "OWNERSHIP_MATRIX"),
    prohibitedInference: [
      "a warehouse, a truck, an employee or a homeWarehouseId — the binding ruling names these explicitly",
      "the actor who recorded the receipt (an actor is not a company, and applyPayment stores no actor on the record at all)",
      "the bank account or payment method the money arrived through",
      "the creditedSalespersonId on the attribution snapshot — sales credit and accounting ownership are different questions (FIN-002)",
      "the customer's own company or territory",
    ],
    description:
      "Derived once from the governed invoice by requireInvoiceParty and frozen onto both the receipt " +
      "and its application, so the two halves of one financial event can never report different " +
      "attribution. A receipt whose invoice carries no company is REFUSED (COMPANY_REQUIRED), not " +
      "recorded ownerless.",
  }),

  // ── READ MODEL ─────────────────────────────────────────────────────────────────────────────
  //
  // The uncomfortable answer, stated plainly: there is no read path. Not a scoped one, not an
  // inactive one, not a capability waiting for a grant. Grepping functions/src for
  // PAYMENTS_COLLECTION finds the constant and the WRITE side of applyPayment, and nothing else.
  readModel: makeReadModel({
    path: "SERVER_ONLY",
    collection: "payments",
    gate: "none — firestore.rules denies all client access to /payments/{paymentId} (read, write: if false) and NO read callable or read capability exists anywhere in the program",
    gateIsCapability: false,
    authority: cite("functions/src/constants/collections.ts", "PAYMENTS_COLLECTION"),
    description:
      "Unlike Invoice — which has listAccountInvoiceAr, a real trusted read callable registered end " +
      "to end even while its capability sits active:false — Payment has nothing. finance.read's own " +
      "catalog description names the invoice AR position specifically, not payments, so citing it " +
      "here would attribute a capability to a read path that does not exist. This is a load-bearing " +
      "gap: no surface can show a customer what they paid.",
  }),

  // ── FIELD POLICIES ─────────────────────────────────────────────────────────────────────────
  //
  // EVERY field is SET_AT_CREATE or SYSTEM_MANAGED, and that uniformity is the measurement, not a
  // shortcut: applyPayment issues exactly one `tx.set` on the collection and no command anywhere
  // issues an update to a payments document. There is no allowlist to read because there is no
  // update to allowlist.
  fieldPolicies: [
    makeFieldPolicy({
      fieldId: "paymentId",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason:
        "The document id, allocated by the server. No caller supplies it and no command accepts it — " +
        "which is also why it is absent from applyPayment's mutates list below: the command does not " +
        "WRITE this value, the storage layer assigns it.",
    }),
    makeFieldPolicy({
      fieldId: "companyId",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      enforcedBy: cite("functions/src/finance/financialAttribution.ts", "requireInvoiceParty"),
      reason:
        "Not merely fixed — never chosen. Taken from the governed invoice; a caller-supplied value is " +
        "an assertion that must match (COMPANY_MISMATCH) and an invoice with no company is refused.",
    }),
    makeFieldPolicy({
      fieldId: "accountId",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      enforcedBy: cite("functions/src/finance/financialAttribution.ts", "requireInvoiceParty"),
      reason: "Same rule as companyId: the event's customer comes from the invoice, never from the caller.",
    }),
    makeFieldPolicy({
      fieldId: "currency",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      enforcedBy: cite("functions/src/finance/paymentCommands.ts", "buildApplyPayment"),
      reason:
        "Must equal the invoice's currency or the call fails (CURRENCY_MISMATCH). In the target " +
        "authority the same rule is a composite foreign key, so a mismatched row cannot be written at all.",
    }),
    makeFieldPolicy({
      fieldId: "amountMinor",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      enforcedBy: cite("functions/src/finance/paymentCommands.ts", "buildApplyPayment"),
      reason:
        "A positive integer count of minor units (isPosInt), never a float. The cash that arrived is a " +
        "fact about the past; a correction is a new receipt, not an edit.",
    }),
    makeFieldPolicy({
      fieldId: "method",
      mutability: MUTABILITY.SET_AT_CREATE,
      enforcedBy: cite("functions/src/finance/paymentCallables.ts", "applyPayment"),
      reason: "Optional free text. No closed vocabulary for payment method exists anywhere in the program.",
    }),
    makeFieldPolicy({
      fieldId: "externalRef",
      mutability: MUTABILITY.SET_AT_CREATE,
      enforcedBy: cite("functions/src/finance/paymentCallables.ts", "applyPayment"),
      reason:
        "The check or wire number, and the entity's nameField. GENUINELY OPTIONAL — a receipt recorded " +
        "without one has no human-legible name at all, and no path exists to add one afterwards.",
    }),
    makeFieldPolicy({
      fieldId: "receivedAtMillis",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      enforcedBy: cite("functions/src/finance/paymentCommands.ts", "buildApplyPayment"),
      reason:
        "CALLER-SUPPLIED and legitimately in the past (a check recorded a week late). The command never " +
        "overrides it with a clock, which is why it is a real input and not provenance.",
    }),

    // ── THE STORED AGGREGATE ──────────────────────────────────────────────────────────────────
    //
    // Declared as written fields because they really are written; declared with the defect in the
    // reason because an administration surface that showed them as ordinary money fields would be
    // presenting a number that can be wrong as a number that cannot.
    makeFieldPolicy({
      fieldId: "appliedMinor",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      enforcedBy: cite("functions/src/finance/paymentCallables.ts", "applyPayment"),
      reason:
        "A STORED AGGREGATE of the separate payment_applications collection, written once and never " +
        "maintained. recordRefund reverses applied money on the INVOICE without touching this field or " +
        "writing a reversing application, so after any refund this number claims cash is applied that " +
        "the invoice says is not. See the RETIRE representation below.",
    }),
    makeFieldPolicy({
      fieldId: "unappliedMinor",
      mutability: MUTABILITY.SET_AT_CREATE,
      requiredAtCreate: true,
      enforcedBy: cite("functions/src/finance/paymentCallables.ts", "applyPayment"),
      reason:
        "Always 0 on every stored receipt today: buildApplyPayment rejects any amount exceeding the " +
        "invoice's outstanding balance (OVER_APPLICATION) rather than banking the excess as cash on " +
        "account. A forward-compat field whose value does not yet vary.",
    }),

    // ── SERVER-STAMPED ────────────────────────────────────────────────────────────────────────
    makeFieldPolicy({
      fieldId: "receivedAt",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason:
        "FieldValue.serverTimestamp(). Identical in value to createdAt on every stored receipt — both " +
        "are set in the same tx.set call — which is a genuine redundancy in the record, not a modeling " +
        "choice. Distinct from receivedAtMillis, which is the caller's real receipt date.",
    }),
    makeFieldPolicy({
      fieldId: "createdAt",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason:
        "The record's only provenance. There is NO createdBy: applyPayment captures the actor uid in " +
        "the append-only audit event and never copies it onto the receipt, so the record alone cannot " +
        "say who recorded it.",
    }),
  ],

  // ── GOVERNED COMMANDS ──────────────────────────────────────────────────────────────────────
  //
  // One. Not "one so far" — one, and no update, no void, no reversal, no lifecycle transition of
  // any kind touches a payments document.
  commands: [
    makeCommandDescriptor({
      id: "applyPayment",
      label: "Record a cash receipt and apply it",
      phase: "CREATE",
      transport: "CALLABLE",
      entryPoint: cite("functions/src/finance/paymentCallables.ts", "applyPayment"),
      implementation: cite("functions/src/finance/paymentCommands.ts", "buildApplyPayment"),
      capability: "finance.payment.apply",
      auditAction: "applyPayment",
      // No expectedVersion, and correctly so: there is no prior receipt to conflict with. The
      // invoice it reads IS read inside the transaction, so the AR projection it maintains cannot
      // be computed from a stale total.
      versionChecked: false,
      // A deterministic audit document id over (actor, invoice, idempotencyKey): a retried apply
      // returns the prior paymentId instead of writing a second receipt and a second application.
      idempotent: true,
      mutates: [
        "companyId",
        "accountId",
        "currency",
        "amountMinor",
        "method",
        "externalRef",
        "receivedAtMillis",
        "appliedMinor",
        "unappliedMinor",
      ],
      description:
        "ONE transaction writes THREE things this profile's object is only one of: the receipt, a " +
        "payment_applications row, and an update to the invoice's stored AR projection " +
        "(appliedMinor/outstandingMinor/state). The second and third belong to objects this profile " +
        "does not govern, and they are named here because an administrator reading only the Payment " +
        "row would otherwise not know the command changes an invoice.",
    }),
  ],

  // ── REPRESENTATIONS ────────────────────────────────────────────────────────────────────────
  representations: [
    makeRepresentation({
      id: "firestore-payments",
      label: "Firestore `payments` collection",
      disposition: REPRESENTATION_DISPOSITION.AUTHORITY,
      location: cite("functions/src/constants/collections.ts", "PAYMENTS_COLLECTION"),
      readBy: [],
      description:
        "The authority today. Admin-SDK-only: firestore.rules denies every client read and write, so " +
        "the sole path in is the governed callable and the sole path out is nothing at all.",
    }),
    makeRepresentation({
      id: "receipt-applied-columns",
      label: "The receipt's own appliedMinor / unappliedMinor",
      disposition: REPRESENTATION_DISPOSITION.RETIRE,
      location: cite("functions/src/finance/paymentCommands.ts", "CashReceiptRecord"),
      readBy: [],
      blockedBy:
        "Nothing reads them (no read path exists), so retirement is not blocked by a consumer — it is " +
        "blocked by the absence of the thing that would replace them. Deleting them means the one " +
        "writer stops emitting them AND a derivation exists to answer the same question; " +
        "eos_finance.payment_balances is that derivation, and it is not the authority yet.",
      description:
        "A second statement of an amount whose durable facts live in payment_applications. Written " +
        "once and never maintained: recordRefund reverses applied money on the invoice without " +
        "touching them. reconcileReceipt would DETECT the divergence, except that it takes no refund " +
        "input and is not called from anywhere outside its own test.",
    }),
    makeRepresentation({
      id: "eos-ops-payment-balances",
      label: "eos_finance.payment_balances (Postgres)",
      disposition: REPRESENTATION_DISPOSITION.DERIVED,
      location: cite("functions/migrations/1759017600000_ar-cash-application-authority.sql", "payment_balances"),
      readBy: [],
      description:
        "A plain view — applied is SUM(payment_applications), unapplied is the remainder. Kept in step " +
        "by construction because there is nothing to keep: the numbers are not stored, so no writer " +
        "can forget to maintain them and no repair script can set them wrongly. Deliberately not " +
        "MATERIALIZED, which would be the stored aggregate reintroduced with a refresh schedule.",
    }),
  ],

  // ── MIGRATION ──────────────────────────────────────────────────────────────────────────────
  migration: makeMigrationStatus({
    readiness: MIGRATION_READINESS.BLOCKED,
    targetAuthority:
      "PostgreSQL eos_finance.payments + eos_finance.payment_applications (functions/migrations/1759017600000_ar-cash-application-authority.sql)",
    source: cite("functions/src/constants/collections.ts", "PAYMENTS_COLLECTION"),
    evaluator: null,
    blockedBy: [
      "No governed EOS server command writes the eos_ops tables — the schema exists and is proved, and nothing calls it. There is no repository, no HTTP operation and no client path.",
      "The Postgres Invoice authority now exists in the SAME schema (eos_finance, migration 1758931200000), so payment_applications.invoice_id is a real tenant-scoped foreign key to eos_finance.invoices rather than an opaque governed key: an application settles an obligation that exists, in the same tenant, the same currency and the same operating company. What remains one-sided is the RECONCILIATION, not the reference -- eos_finance.invoice_application_totals states what cash was applied, and the invoice's own outstanding figure is still projected in Firestore by the deployed read path.",
      "recordRefund reverses applied money by rewriting the invoice's stored projection and writing a `refunds` row; the target schema has no representation for that reversal, and inventing one from the Payment side would be guessing another owner's shape.",
      "There is no Postgres Account authority either, so payments.account_id is likewise opaque.",
      "No reconciliation has ever been RUN. reconcileInvoiceProjection and reconcileReceipt are pure, tested, exported — and imported by nothing outside functions/test/financialReconciliation.test.mjs. There is no scheduler, no callable and no index.ts export.",
    ],
    reconciliation:
      "Per invoice id, eos_finance.invoice_application_totals.applied_minor must equal the invoice authority's own applied figure; per receipt, eos_finance.payment_balances.applied_minor + unapplied_minor must equal amount_minor, which holds by construction rather than by check. Neither is a cutover proof on its own: a migration that moved receipts without their applications would satisfy the second trivially.",
    description:
      "BLOCKED, not READY: a schema that is ready is not a schema that has been switched to, and this " +
      "is financial data. Nothing deployed reads or writes the eos_ops tables; the live path remains " +
      "Firestore, untouched.",
  }),

  // ── ADMINISTRATION EDITING ─────────────────────────────────────────────────────────────────
  //
  // THE SMALLEST TRUE ANSWER, and here it is genuinely small. Every field is SET_AT_CREATE or
  // server-stamped, there is no post-creation command of any kind, and there is no read path, so
  // Administration cannot even display a receipt to edit it. Widening this is not a configuration
  // change; it is building a command that does not exist.
  adminEditing: makeAdminEditing({
    scope: ADMIN_EDIT_SCOPE.PRESENTATION_ONLY,
    commands: [],
    reason:
      "No governed command changes a payments document after creation — applyPayment's tx.set is the " +
      "collection's only write in the entire codebase. Offering record editing here would mean " +
      "offering an edit no path delivers; offering a correction would mean offering a second receipt " +
      "under the guise of a form field.",
  }),
});
