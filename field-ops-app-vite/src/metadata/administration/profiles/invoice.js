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

// INVOICE — the Object Administration Profile.
//
// Written to the reference pattern Part established (administration/profiles/part.js): cite rather
// than restate, mutability is the spine, and admin editing is the smallest true answer.
//
// ════════════════════ THIS FILE IS DORMANT UNTIL THE FRAMEWORK LANDS ════════════════════
//
// `../objectAdministrationProfile.js` and `../administrationProfileRegistry.js` are Lane C2's and
// are NOT on main at the time this was written (PR #1866, branch impl/w1-part-admin-objects). This
// lane deliberately does not create a competing framework and does not edit C2's registry, so this
// file imports a module that will arrive with C2's merge. The one-line registry entry the
// integration writer must apply is recorded in docs/handoff/w1-c11-registrations.md. Nothing
// imports this file until then; test/invoiceAdministrationProfile.test.mjs skips with an explicit
// reason while the framework is absent and validates in full the moment it is present.
//
// ════════════════════ THE ONE THING A READER OF THIS PROFILE MUST TAKE AWAY ════════════════════
//
// The invoice's four money aggregates — subtotalMinor, discountMinor, taxMinor, totalMinor — are
// STORED on the header and computed once, at issuance, from the line array on the same document
// (invoiceCommands.ts's buildInvoiceRecord). Nothing re-checked them against those lines: the
// reconciler that exists (financialReconciliation.ts's reconcileInvoiceProjection) takes
// stored.totalMinor as its GIVEN basis and proves only the AR overlay above it. So the number every
// AR figure is computed from — billed, outstanding, and every aging bucket — was the one number
// with no proof. They are declared SYSTEM_MANAGED below and recorded as a RETIRE representation,
// because the answer is to delete them, not to add a second reconciler that keeps them honest.

export const invoiceAdministrationProfile = makeObjectAdministrationProfile({
  entityId: "invoice",
  description:
    "The immutable ISSUED invoice following a billable Sales Order. Deny-all to clients; written only " +
    "by trusted commands and read only through one account-scoped governed callable.",

  // ── IDENTITY ───────────────────────────────────────────────────────────────────────────────
  //
  // THE CANONICAL IDENTITY IS NOT A DECLARED FIELD, AND THAT IS THE HONEST ANSWER. The invoice's
  // identity is an opaque record id — `db.collection(INVOICES_COLLECTION).doc()` in
  // persistIssuedInvoice, which the code itself calls "canonical opaque identity, distinct from the
  // number", and `eos_finance.invoices.id` in the Postgres authority. Neither is declared as a
  // FieldDefinition on the invoice entity, so `idField` names the only identity-bearing field the
  // entity actually has: invoiceNumber, its declared reference field.
  //
  // `documentIdIsIdentity` is false, and deliberately so: no read path anywhere refuses an invoice
  // whose stored value disagrees with its storage key, the way partMasterRepository does for Part.
  // Claiming otherwise is exactly how a document id becomes a display fallback.
  identityRule: makeIdentityRule({
    idField: "invoiceNumber",
    documentIdIsIdentity: false,
    // The ONE authority that mints an invoice number — a per-company counter read and incremented
    // inside the same transaction that writes the invoice, so a number is never reused and never
    // derived from a Sales Order id, a Work Order id, a timestamp or a client counter.
    canonicalValidator: cite("functions/src/finance/invoiceNumbering.ts", "allocateInvoiceNumber"),
    neverSubstituted: [
      "the Sales Order id or number — the invoice's lineage, never its identity",
      "the opaque record id (Firestore document id / eos_finance.invoices.id): it IS the canonical identity, and it is not this field",
      "the `sequence` integer the number is formatted from — an internal numbering artifact",
      "the Account id, which scopes the only read query and identifies nothing",
      "a payment or payment_application id, which reference the invoice and are not it",
    ],
    description:
      "invoiceNumber is INV-###### (formatInvoiceNumber), allocated per operating company at creation " +
      "and immutable thereafter. It is UNIQUE PER COMPANY, not globally: the counter is keyed " +
      "`invoices_${companyId}`, so a second company may legitimately hold the same number. " +
      "migrations/1758931200000_invoice-authority.sql expresses that as UNIQUE (tenant_id, " +
      "operating_company_key, invoice_number) rather than asserting a global numbering authority the " +
      "allocator does not have.",
  }),

  // ── OWNERSHIP AND OPERATING COMPANY ────────────────────────────────────────────────────────
  //
  // Ruling D-15, and it is a RECLASSIFICATION worth reading rather than skimming: a ledger entry
  // belongs to the books it lands in, not to the salesperson upstream of it. ownerFields is EMPTY
  // and that is the classification — there is no owner PERSON on an invoice. Commercial
  // attribution is still fully available through Account -> Opportunity -> Sales Agreement ->
  // Sales Order, and the credited salesperson rides on the frozen attribution snapshot, which is
  // sales credit and not ownership.
  ownership: makeOwnershipRule({
    ownerClass: "COMPANY",
    companyScope: "SINGLE_COMPANY",
    companyField: "companyId",
    authority: cite("functions/src/ownership/ownershipMatrix.ts", "OWNERLESS_UNTIL_SUPPLIED"),
    prohibitedInference: [
      "the caller's own company — `input.companyId` is ASSERTION-ONLY and a mismatch is refused as COMPANY_MISMATCH before numbering, write or audit",
      "a warehouse, a truck, an employee or a homeWarehouseId",
      "the credited salesperson's company — sales credit is not accounting ownership (ruling D-15)",
      "a default or backfilled company: a Sales Order with no resolved operatingCompanyId is refused COMPANY_REQUIRED rather than invoiced",
    ],
    description:
      "ONE company authority: the governed Sales Order's operatingCompanyId. verifySalesOrderMatch " +
      "refuses COMPANY_REQUIRED when the order has none and COMPANY_MISMATCH when a caller asserts a " +
      "different one, both BEFORE a counter is allocated, so a refused issuance burns no sequence " +
      "number. buildInvoiceRecord re-asserts it, so the invariant invoice.companyId === " +
      "invoice.attribution.operatingCompanyId holds by construction. The Postgres authority carries " +
      "the same rule structurally: operating_company_key is NOT NULL with NO DEFAULT.",
  }),

  // ── READ MODEL ─────────────────────────────────────────────────────────────────────────────
  readModel: makeReadModel({
    path: "CALLABLE",
    collection: "invoices",
    gate: "finance.read",
    gateIsCapability: true,
    authority: cite("functions/src/finance/financeReadCallables.ts", "listAccountInvoiceAr"),
    description:
      "The ONLY read path in the codebase, and it is account-scoped: `.where(\"accountId\", \"==\", " +
      "accountId)`, with a per-invoice FIN-004 visibility predicate applied BEFORE projection. " +
      "`finance.read` is REGISTERED, not granted — the catalog entry is active:false, a hard deny for " +
      "everyone until a separate Owner grant. THE PROJECTION IS NARROWER THAN THE RECORD: companyId, " +
      "issuedAt, issuedAtMillis, updatedAt, subtotalMinor, discountMinor, taxMinor and taxProvenance " +
      "are stored and are NOT returned. That is a read-wiring gap, recorded rather than papered over.",
  }),

  // ── FIELD POLICIES ─────────────────────────────────────────────────────────────────────────
  //
  // THE SPINE. Read the SYSTEM_MANAGED block below with the RETIRE representation: seven of these
  // fields are a second, stored representation of facts held elsewhere (the invoice's own lines,
  // and the payment/adjustment/refund fact records), and every one of them is a place the same
  // number can be stated twice and disagree.
  fieldPolicies: [
    // ── written once, at creation, from the governed Sales Order ──
    ...[
      ["accountId", "Cross-checked against the Sales Order's committed account (ACCOUNT_MISMATCH) and never changed afterwards."],
      ["salesOrderId", "The billing lineage. Written once at issuance; no path updates it."],
      ["currency", "Cross-checked against the Sales Order's committed currency (CURRENCY_MISMATCH)."],
      ["dueDate", "Carried, never computed. AR aging begins here. Ms epoch in storage; a DATE by kind."],
      ["taxProvenance", "Provenance of the INJECTED tax determination, carried through unchanged from issuance input."],
    ].map(([fieldId, reason]) =>
      makeFieldPolicy({
        fieldId,
        mutability: MUTABILITY.SET_AT_CREATE,
        requiredAtCreate: fieldId !== "taxProvenance",
        // THE ENFORCEMENT IS AN ALLOWLIST, NOT A GUARD. Every post-creation write to an invoice is
        // one of three `tx.update(invoiceRef, {...})` calls, and all three name the same four
        // fields (appliedMinor/creditsMinor/chargesMinor/writeOffMinor, outstandingMinor, state,
        // updatedAt). No path anywhere writes the fields above after issuance.
        enforcedBy: cite("functions/src/finance/paymentCallables.ts", "applyPayment"),
        reason,
      }),
    ),

    // ── the server states it; no caller supplies it ──
    makeFieldPolicy({
      fieldId: "invoiceNumber",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason:
        "Allocated from the per-company counter inside the issuing transaction. The client never supplies it.",
    }),
    makeFieldPolicy({
      fieldId: "companyId",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason:
        "Taken from the governed Sales Order's operatingCompanyId. `input.companyId` is an assertion the " +
        "command refuses when it disagrees — the caller does not choose the invoice's company.",
    }),
    makeFieldPolicy({
      fieldId: "issuedAt",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason: "FieldValue.serverTimestamp(), set once in persistIssuedInvoice. The record's real creation provenance.",
    }),
    makeFieldPolicy({
      fieldId: "issuedAtMillis",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason:
        "A plain Date.now() captured moments before issuedAt commits, in the same transaction — a " +
        "near-duplicate of issuedAt at lower precision, not a second event.",
    }),
    makeFieldPolicy({
      fieldId: "updatedAt",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason:
        "Stamped by applyPayment / recordInvoiceAdjustment / recordRefund. Sparse — absent until the " +
        "first such write. THERE IS NO updatedBy AND NO createdBy ANYWHERE ON THIS RECORD: the actor " +
        "uid is captured only in the separate append-only audit event, never copied onto the invoice.",
    }),
    makeFieldPolicy({
      fieldId: "state",
      mutability: MUTABILITY.SYSTEM_MANAGED,
      reason:
        "Always the literal \"ISSUED\" at creation; thereafter DERIVED from facts by " +
        "deriveInvoiceStateFromFacts and written back as a projection. DRAFT and SENT are in the shared " +
        "vocabulary and are unreachable by any write path. VOID is READ by four commands that refuse to " +
        "act on a void invoice, and is written by NOTHING — searched: every occurrence of \"VOID\" in " +
        "functions/src/finance/ is a read. No caller supplies this field.",
    }),

    // ── THE STORED AGGREGATES: server-written, and a second statement of facts held elsewhere ──
    ...[
      ["subtotalMinor", "Sum of line subtotals. Recomputed at issuance from the lines, then stored beside them."],
      ["discountMinor", "Sum of explicit governed line discounts. Same shape, same exposure."],
      ["taxMinor", "Sum of the injected per-line tax determination. Same shape, same exposure."],
      ["totalMinor", "THE number every AR figure is computed from, and until reconcileInvoiceTotals nothing proved it against the lines it summarises."],
    ].map(([fieldId, reason]) =>
      makeFieldPolicy({
        fieldId,
        mutability: MUTABILITY.SYSTEM_MANAGED,
        // The proof that did not exist. Cited here so the claim in this profile is checkable and
        // so deleting the proof breaks this description rather than quietly outliving it.
        heldBy: cite("functions/src/eosOps/invoiceTotals.ts", "reconcileInvoiceTotalsAgainstLines"),
        reason:
          `${reason} A STORED AGGREGATE THAT CAN DISAGREE WITH ITS OWN LINES. In the Postgres ` +
          "authority (migration 008) the header stores no totals at all and `invoice_totals` is a view " +
          "over GENERATED ALWAYS line columns, so this divergence class does not exist there.",
      }),
    ),

    // ── THE AR OVERLAY: maintained projections of facts that live in other records ──
    ...[
      ["appliedMinor", "payment_applications rows"],
      ["creditsMinor", "invoice_adjustments rows of type CREDIT_MEMO"],
      ["chargesMinor", "invoice_adjustments rows of type DEBIT_CHARGE"],
      ["writeOffMinor", "invoice_adjustments rows of type WRITE_OFF"],
      ["outstandingMinor", "total − applied − credits + charges − write-offs, over all of the above"],
    ].map(([fieldId, facts]) =>
      makeFieldPolicy({
        fieldId,
        mutability: MUTABILITY.SYSTEM_MANAGED,
        heldBy: cite("functions/src/finance/financialReconciliation.ts", "reconcileInvoiceProjection"),
        reason:
          `A transactionally-maintained PROJECTION of ${facts} — never an independently editable ` +
          "authority, and no caller supplies it. Sparse: absent until the first write of its kind, and " +
          "read back through nn() (absent means 0). This overlay IS reconciled against its facts, " +
          "which is exactly what made the header aggregates' lack of a proof invisible. The Payment " +
          "lane owns these; they are described here, not decided here.",
      }),
    ),
  ],

  // ── COMMANDS ───────────────────────────────────────────────────────────────────────────────
  //
  // ONE command is declared, and that is the honest count for THIS object. issueInvoice is the only
  // command that creates an invoice. applyPayment, recordInvoiceAdjustment and recordRefund write to
  // an invoice document, but what they command is a PAYMENT, an ADJUSTMENT and a REFUND; the four
  // fields they touch on the invoice are maintained projections of their own facts, which is why
  // those fields are SYSTEM_MANAGED above rather than listed as mutated by a command declared here.
  // Declaring another object's command as this object's would put the same command in two profiles.
  commands: [
    makeCommandDescriptor({
      id: "issueInvoice",
      label: "Issue Invoice",
      phase: "CREATE",
      transport: "CALLABLE",
      entryPoint: "issueInvoice",
      implementation: cite("functions/src/finance/invoiceCallables.ts", "persistIssuedInvoice"),
      capability: "finance.invoice.issue",
      auditAction: "issueInvoice",
      // CREATE: there is no prior version to check. Concurrency is handled by the Firestore
      // transaction that reads the Sales Order, allocates the number and writes, together.
      versionChecked: false,
      // A deterministic audit id over (actorUid, salesOrderId, idempotencyKey) makes a retry a
      // no-op replay: no duplicate invoice, and no burned sequence number.
      idempotent: true,
      mutates: ["accountId", "salesOrderId", "currency", "dueDate", "taxProvenance"],
      description:
        "Re-computes every amount server-side in exact integer minor units from the Sales Order's " +
        "committed unitPrice snapshot and the INJECTED tax determination, and fails closed on any gap: " +
        "NOT_BILLABLE without an explicit BILL_NOW decision, UNPRICED without a committed price, " +
        "TAX_REQUIRES_REVIEW without a determination, QTY_EXCEEDS_ELIGIBLE beyond the billing-eligible " +
        "quantity. `finance.invoice.issue` is REGISTERED active:false — a hard deny for everyone until " +
        "a separate Owner grant. Register is not grant.",
    }),
  ],

  // ── REPRESENTATIONS ────────────────────────────────────────────────────────────────────────
  representations: [
    makeRepresentation({
      id: "firestore-invoices",
      label: "Firestore `invoices` collection",
      disposition: REPRESENTATION_DISPOSITION.AUTHORITY,
      location: cite("functions/src/constants/collections.ts", "INVOICES_COLLECTION"),
      readBy: ["listAccountInvoiceAr (functions/src/finance/financeReadCallables.ts)"],
      description:
        "The authority today. Deny-all to clients in Rules, Admin-SDK-only, written by four trusted " +
        "commands. Transitional: the target is the Postgres authority named under migration below.",
    }),
    makeRepresentation({
      id: "invoice-header-money-aggregates",
      label: "The stored header totals (subtotalMinor / discountMinor / taxMinor / totalMinor)",
      disposition: REPRESENTATION_DISPOSITION.RETIRE,
      location: cite("functions/src/finance/invoiceCommands.ts", "buildInvoiceRecord"),
      readBy: [
        "projectInvoiceAr and summarizeAccountAr (functions/src/finance/financeReadProjection.ts) — billed, collected, outstanding",
        "summarizeArAging (same file) — every aging bucket",
        "reconcileInvoiceProjection (functions/src/finance/financialReconciliation.ts) — as its GIVEN basis",
      ],
      blockedBy:
        "The AR read projects totalMinor straight off the header, and the AR overlay reconciler takes it " +
        "as given. Deleting these four fields means the read must sum the lines instead — which is what " +
        "the Postgres `invoice_totals` view does, and is a cutover this packet does not perform. Until " +
        "then reconcileInvoiceTotals is the proof that a header and its lines still agree.",
      description:
        "A second statement of a fact the lines already hold. Retire, do not reconcile forever: " +
        "migration 008 removes the columns entirely rather than adding a maintenance path for them.",
    }),
  ],

  // ── MIGRATION ──────────────────────────────────────────────────────────────────────────────
  migration: makeMigrationStatus({
    readiness: MIGRATION_READINESS.ANALYZED,
    targetAuthority: "PostgreSQL eos_finance.invoices + eos_finance.invoice_lines + the eos_finance.invoice_totals view",
    source: "Firestore `invoices` (documents with an embedded InvoiceLineRecord[] `lines` array)",
    evaluator: cite("functions/src/eosOps/invoiceAuthority.ts", "insertIssuedInvoice"),
    reconciliation: cite("functions/src/eosOps/invoiceAuthority.ts", "reconcileMigratedInvoice"),
    blockedBy: [],
    description:
      "ANALYZED, not READY: the target schema, the repository and the reconciliation proof exist and are " +
      "tested against a real database, and NOTHING HAS MOVED — no extractor, no backfill, no dual write, " +
      "no cutover. The reconciliation deliberately answers TWO questions rather than one: whether the " +
      "copy is faithful (target lines vs source lines) and, separately, whether the SOURCE header ever " +
      "agreed with its own lines. A header-to-header check would carry an already-wrong total across and " +
      "report success. The AR overlay (payments, applications, adjustments, refunds) is not modelled in " +
      "the target yet and belongs to the Payment lane.",
  }),

  // ── ADMINISTRATION EDITING ─────────────────────────────────────────────────────────────────
  adminEditing: makeAdminEditing({
    scope: ADMIN_EDIT_SCOPE.NONE,
    commands: [],
    reason:
      "An issued invoice is an immutable financial record and no Administration edit path exists for it — " +
      "not for the money, not for the lineage, not for the state. The one command this profile declares " +
      "is CREATE-phase and belongs to the billing workflow, not to an object-administration surface, so " +
      "GOVERNED_COMMAND would promise a dispatch that would be wrong to offer. PRESENTATION_ONLY is not " +
      "the answer either: nothing in this lane added a tenant-presentation editing path for this object, " +
      "and claiming one would describe a control that does not exist.",
  }),
});
