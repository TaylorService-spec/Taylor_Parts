// Enterprise Access & Administration Platform (Issue #226) -- stable,
// capability-based Permission catalog. Fixed by docs/specifications/
// enterprise-access-and-administration-platform.md §6/§7 and sequenced
// by docs/implementation-plans/enterprise-access-and-administration-
// platform.md (Row 1 / Task 6).
//
// This module is a PURE, dependency-free data + validation module --
// no firebase-admin import, no Firestore read/write, no Rules/Function
// wired to it yet. Declaring a Permission id here does not grant it to
// anyone; Role->Permission mapping is Row 2 (Task 7)'s compatibility
// resolver, not this file. No runtime authorization behavior changes.
//
// SHARED EOS ACCESS CONTRACT. This module exists in both the Functions and
// frontend packages because there is no shared-module tooling in this repo. It is
// maintained as ONE canonical source and mechanically synchronized by
// scripts/syncAccessContracts.mjs -- never by hand-editing two copies.
import type { Permission } from "../types/access";

// Spec §6: PermissionId = "<domain>.<resource>.<action>", lower-camel
// segments. Ids are immutable once published; deprecation is additive
// (`deprecated: true` + `deprecatedInFavorOf`), never a silent rename.
const PERMISSION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

// Issue #325 / ADR-007 D-226 -- field-level read-capability extension.
// docs/architecture/ADR-007-governed-object-based-report-creator.md §2.2/
// §2.3 and docs/specifications/governed-object-based-report-creator.md §3
// adopt "report.<objectId>.field.<fieldId>.read" (object read capability:
// "report.<objectId>.read") as the id shape -- both already satisfy
// PERMISSION_ID_PATTERN above unchanged (5 and 3 lower-camel dot segments
// respectively; no core pattern change required). These two STRICTER
// patterns exist only to give "malformed" its own explicit, testable
// failure mode for this capability class (a caller authoring or
// validating a `report.*` id gets a shape check narrower than the
// generic one) -- they are not consulted by findPermission()/
// resolveEffectivePermission(), which deny an unregistered or malformed
// id identically via exact catalog lookup (DenialReason
// "unknownPermission" either way).
const REPORT_OBJECT_READ_CAPABILITY_PATTERN = /^report\.[a-z][a-zA-Z0-9]*\.read$/;
const REPORT_FIELD_READ_CAPABILITY_PATTERN =
  /^report\.[a-z][a-zA-Z0-9]*\.field\.[a-zA-Z0-9]+\.read$/;

// Issue #325 / ADR-007 W-SAVE -- the saved-DEFINITION CRUD capability
// shape, "report.definition.<action>". NOTE: "report.definition.read"
// structurally also matches REPORT_OBJECT_READ_CAPABILITY_PATTERN above
// (both are the generic 3-segment "report.<x>.read" shape) -- this is a
// deliberate, harmless naming coincidence, not a real ambiguity:
// "definition" is not a catalogued report OBJECT (see reportCatalog.ts's
// REPORT_OBJECTS -- "definition" is not among them), so no caller
// confuses the two, but a shape-only check can't tell them apart. Any
// code that needs to categorize a `report.*` id correctly must check
// this pattern FIRST (or exclude these five known ids) before falling
// back to the object/field patterns -- see permissionCatalog.test.mjs's
// own id-shape-partition test for the canonical example.
const REPORT_DEFINITION_CAPABILITY_PATTERN = /^report\.definition\.(create|read|rename|duplicate|delete)$/;

// Every id below reproduces a capability that already exists in
// production today (Assessment §1 current-state matrix, Assessment's
// "Inventory domain audit" table, and firestore.rules on `main`). This
// catalog names capabilities that ALREADY behave this way -- it does
// not invent new ones. Seeding these ids is the prerequisite for Row 2
// (Task 7)'s compatibility Role mapping, which is the parity oracle
// (Spec §7) all later shadow-mode comparisons (Row 4) are scored
// against.
export const PERMISSION_CATALOG: readonly Permission[] = Object.freeze([
  // --- Customer / Account domain (Assessment §1; accounts Rules) ---
  Object.freeze({
    id: "customer.record.read",
    description: "Read a Customer record.",
    resource: "account.record",
    action: "read",
  }),
  Object.freeze({
    id: "customer.record.create",
    description: "Create a Customer record.",
    resource: "account.record",
    action: "create",
  }),
  Object.freeze({
    id: "customer.record.update",
    description: "Edit a Customer record's non-governed fields.",
    resource: "account.record",
    action: "update",
  }),
  Object.freeze({
    id: "customer.governedField.write",
    description:
      "Edit a Customer's governed commercial fields (paymentTerms/taxStatus) -- Issue #175, admin-only today.",
    resource: "account.governedField",
    action: "write",
  }),

  // --- Work Order domain (Assessment §1; transitionEngine.ts) ---
  Object.freeze({
    id: "workOrder.create",
    description: "Create a Work Order.",
    resource: "workOrder",
    action: "create",
  }),
  Object.freeze({
    id: "workOrder.transition",
    description:
      "Perform a Work Order lifecycle transition via the transitionWorkOrder authority (ADR-002).",
    resource: "workOrder",
    action: "transition",
  }),
  Object.freeze({
    id: "workOrder.cancel",
    description:
      "Cancel a Work Order, subject to the dispatcher in-flight-technician narrowing preserved from today's behavior.",
    resource: "workOrder",
    action: "cancel",
  }),
  // WO Parts Planning Phase 2 -- authoring/changing a Work Order's planned parts (qtyPlanned) via the
  // governed setWorkOrderPartsPlan producer. Registered active:false: fail-closed for every principal until
  // a SEPARATE Owner grant through the Persona/Permissions architecture. This is a capability, NOT a role
  // check -- it answers only "may this actor author/change planned parts". PLAN != RESERVE != USE.
  // TECHNICIAN LABOR (Labor Domain V1). Two capabilities, not one, because recording your own time
  // and correcting somebody's recorded time are different acts with different accountability -- a
  // technician fixing their own typo and a manager adjusting a crew's hours are not the same
  // authority even when the keystrokes match.
  //
  // Registered active:false. `work_order_labor_entries` has no firestore.rules match block, so it is
  // deny-all to every client: labor is written only by the trusted commands.
  Object.freeze({
    id: "workOrder.labor.record",
    description:
      "Record labor the AUTHENTICATED technician performed, on a Work Order assigned to them. Never for another technician -- the request carries no technicianId and is refused if it tries. Confers no correction authority and no visibility of cost or billing.",
    resource: "workOrder.labor",
    action: "record",
    active: false,
  }),
  Object.freeze({
    id: "workOrder.labor.correct",
    description:
      "Correct an existing labor entry by reversing it and recording a replacement. The original is never deleted -- it keeps its author and values and gains a pointer to what replaced it. Separate from workOrder.labor.record because correcting another person's recorded time is a different act.",
    resource: "workOrder.labor",
    action: "correct",
    active: false,
  }),
  Object.freeze({
    id: "workOrder.parts.plan",
    description:
      "Author or change the planned parts (qtyPlanned) for a Work Order via the governed setWorkOrderPartsPlan producer. Does not reserve, consume, or procure.",
    resource: "workOrder.parts",
    action: "plan",
    active: false,
  }),
  // Sales Opportunity Cycle 3 -- authoring/advancing a governed Opportunity (create + lifecycle transition)
  // via the trusted opportunity command. Registered active:false: fail-closed for every principal until a
  // SEPARATE Owner grant. A capability, NOT a role check -- it answers only "may this actor write
  // Opportunities". Opportunity is PRE-COMMITMENT: it never creates inventory movement, Work Orders, or
  // invoices, and its lines are product-level (never a serialized Equipment asset).
  Object.freeze({
    id: "opportunity.write",
    description:
      "Create or advance a Sales Opportunity (lifecycle transition) via the governed opportunity command. Pre-commitment only; does not create Work Orders, inventory movement, or invoices.",
    resource: "opportunity",
    action: "write",
    active: false,
  }),
  // Sales Opportunity Cycle 3c -- read authorization for the TRUSTED MINIMAL read projection
  // (listOpportunityContext). Registered active:false (fail-closed). This governs a trusted backend read that
  // returns only the minimal Sales-workspace projection; the client never reads the opportunities collection
  // directly (no client Rules widening).
  Object.freeze({
    id: "opportunity.read",
    description:
      "Read the minimal Sales Opportunity projection via the trusted listOpportunityContext read service (backend-resolved scope; no client-direct collection read).",
    resource: "opportunity",
    action: "read",
    active: false,
  }),
  // P1.3 -- the governed, human-invoked WON -> Create Sales Order action (decision #3: no Firestore trigger;
  // an explicit action, not auto-created on WON). Reuses the same buildCreateSalesOrder pure builder as the
  // direct createSalesOrder callable; account/lines are server-derived from the WON Opportunity, never
  // client-supplied. Registered active:false (fail-closed) pending a SEPARATE Owner grant.
  Object.freeze({
    id: "opportunity.createSalesOrder",
    description:
      "Create a committed Sales Order from a WON Opportunity via the governed createSalesOrderFromOpportunity action. Human-invoked only (no trigger); account and lines are server-derived from the Opportunity, never client-supplied.",
    resource: "opportunity",
    action: "createSalesOrder",
    active: false,
  }),
  // ════════ SALES AGREEMENT — the commercial commitment (Slice 4) ════════
  //
  // Four ids, not one, because these are four different authorities and a single
  // "salesAgreement.write" would make drafting terms and BINDING THE BUSINESS TO THEM the
  // same permission. Accepting is the act with commercial consequence; it deserves its own
  // grant, and separating it now keeps a future approval-limit model possible without a
  // rename. Registered active:false (fail-closed) like the rest of the spine.
  Object.freeze({
    id: "salesAgreement.create",
    description:
      "Draft a Sales Agreement (the commercial commitment) for an Opportunity via the governed createSalesAgreement command. The customer account is server-derived from the Opportunity, never client-supplied. Creates a DRAFT only; commits the business to nothing.",
    resource: "salesAgreement",
    action: "create",
    active: false,
  }),
  Object.freeze({
    id: "salesAgreement.updateDraft",
    description:
      "Edit a DRAFT Sales Agreement through the bounded updateSalesAgreementDraft command (explicit field allowlist; identity, currency, acceptance and totals are not caller-supplied). DRAFT only — an ACCEPTED agreement is immutable.",
    resource: "salesAgreement",
    action: "updateDraft",
    active: false,
  }),
  Object.freeze({
    id: "salesAgreement.accept",
    description:
      "Accept a DRAFT Sales Agreement, binding the committed prices via the governed acceptSalesAgreement command. Requires a committed price on every line; acceptedBy/acceptedAt are server-stamped. This is the authority that lets a WON Opportunity become a priced Sales Order.",
    resource: "salesAgreement",
    action: "accept",
    active: false,
  }),
  Object.freeze({
    id: "salesAgreement.read",
    description:
      "Read the minimal governed Sales Agreement projection (identity, state, account, commercial terms, priced lines, totals, and lineage to the source Opportunity and resulting Sales Order) via the trusted getSalesAgreementContext read service. Backend-resolved scope; no client-direct sales_agreements read.",
    resource: "salesAgreement",
    action: "read",
    active: false,
  }),
  // Sales Order read -- Owner-ratified 2026-08-15: "A user cannot meaningfully perform... governed
  // Sales Order operations without a governed way to inspect the Sales Order state they operate on.
  // This is an authority gap, not merely a missing screen." Follows the opportunity.read pattern
  // exactly: a trusted minimal read projection (functions/src/salesOrder/salesOrderReadService.ts),
  // never a client-direct sales_orders Rules widening (sales_orders stays Admin-SDK-only deny-all).
  // Registered active:false (fail-closed) until a separate grant + per-environment activation.
  Object.freeze({
    id: "salesOrder.read",
    description:
      "Read the minimal governed Sales Order projection (identity, account, source Opportunity, lifecycle state, lines with the ordered/allocated/fulfilled/billed quantity model, service Work Order lineage) via the trusted getSalesOrderContext read service. Backend-resolved scope; no client-direct sales_orders read.",
    resource: "salesOrder",
    action: "read",
    active: false,
  }),
  // Sales Order Cycle 4 -- creating/advancing a committed Sales Order via the governed salesOrder command.
  // Registered active:false (fail-closed). The committed commercial order following a WON Opportunity; it does
  // not assign serialized assets or write Work Orders/inventory (later governed seams do).
  Object.freeze({
    id: "salesOrder.write",
    description:
      "Create or advance a committed Sales Order (lifecycle transition) via the governed salesOrder command. Does not assign serialized assets, write Work Orders, or move inventory.",
    resource: "salesOrder",
    action: "write",
    active: false,
  }),
  // Fulfillment Cycle 5 -- allocate a committed Sales Order via the governed allocateSalesOrder command
  // (authoritative availability from canonical inventory/warehouses; records allocation only on the Sales
  // Order). Registered active:false (fail-closed).
  Object.freeze({
    id: "salesOrder.fulfill",
    description:
      "Allocate a committed Sales Order against authoritative inventory availability via the governed allocateSalesOrder command. Records allocation only on the Sales Order; does not write the inventory ledger or Equipment authority.",
    resource: "salesOrder",
    action: "fulfill",
    active: false,
  }),
  // Sales Order Cycle 7 -- create governed Service demand for a Sales Order via createServiceForSalesOrder,
  // which produces a Work Order through the existing governed Work Order authority (ADR-009) with demand
  // lineage. Registered active:false. The Sales Order never writes Work Order state / assignment / schedule.
  Object.freeze({
    id: "salesOrder.service",
    description:
      "Create governed Service demand (a Work Order via the governed Work Order authority) for a committed Sales Order, with demand lineage. Does not author Work Order state, assignment, or schedule directly.",
    resource: "salesOrder",
    action: "service",
    active: false,
  }),
  // Finance (Billing/AR) -- issue a governed invoice for a Sales Order's billable lines via the trusted
  // issueInvoice command. The server allocates a per-company invoice number, recomputes authoritative amounts
  // (integer minor units) from the committed unit-price snapshot + injected tax determination, and writes the
  // immutable ISSUED invoice + an audit event. Registered active:false (fail-closed): hard DENY for everyone
  // until a separate Owner grant. Invoices are Admin-SDK-only (deny-all client Rules); the client never writes
  // invoices, allocates numbers, or computes authoritative money/tax.
  Object.freeze({
    id: "finance.invoice.issue",
    description:
      "Issue a governed invoice (per-company number, server-recomputed amounts, immutable ISSUED record + audit) for a committed Sales Order's billable lines via the trusted issueInvoice command. Does not compute tax authority, re-price, or write client-visible financial data.",
    resource: "finance.invoice",
    action: "issue",
    active: false,
  }),
  // Finance (Billing/AR) -- apply a cash receipt to an invoice via the trusted applyPayment command. Records
  // the receipt + the application and maintains the invoice's AR projection (outstanding/state DERIVED from
  // the application fact, not an independent authority) + an audit event, in one transaction. Registered
  // active:false (fail-closed). payments / payment_applications are Admin-SDK-only (deny-all client Rules).
  Object.freeze({
    id: "finance.payment.apply",
    description:
      "Record a cash receipt and apply it to an invoice (maintaining the invoice's derived AR projection + audit) via the trusted applyPayment command. Does not expose client-direct financial writes or edit an outstanding balance independently of its facts.",
    resource: "finance.payment",
    action: "apply",
    active: false,
  }),
  // Finance (Billing/AR) -- record an explicit linked invoice adjustment (credit memo / debit charge /
  // write-off) via the trusted recordInvoiceAdjustment command. Writes the adjustment record + maintains the
  // invoice's derived AR projection + audit, in one transaction; NEVER rewrites the issued invoice. Registered
  // active:false (fail-closed). invoice_adjustments is Admin-SDK-only (deny-all client Rules).
  Object.freeze({
    id: "finance.adjustment.record",
    description:
      "Record an explicit linked invoice adjustment (credit memo / debit charge / write-off) and maintain the invoice's derived AR projection + audit via the trusted recordInvoiceAdjustment command. Does not rewrite the issued invoice or expose client-direct financial writes.",
    resource: "finance.adjustment",
    action: "record",
    active: false,
  }),
  // Finance (Billing/AR) -- trusted AR READ (a governed backend projection over the Admin-SDK-only invoices
  // collection; the client never reads invoices directly). Registered active:false (fail-closed) pending a
  // separate Owner grant. A READ capability -- it writes nothing and widens no client Rule.
  Object.freeze({
    id: "finance.read",
    description:
      "The Finance AR FACT-FAMILY gate (FIN-004): may this principal see AR facts at all, via the trusted listAccountInvoiceAr callable. REACH additionally requires a finance.visibility.* scope grant — this id alone reads nothing (the pre-FIN-004 behavior where it served any accountId consolidated-wide is retired). Backend read only; the client never reads invoices/payments/adjustments directly.",
    resource: "finance",
    action: "read",
    active: false,
  }),
  // FIN-004 Financial Visibility (finance/financialVisibility.ts) -- the five reach scopes.
  // CAN PERFORM WORK != CAN SEE FINANCIAL RESULT: every financial read requires the fact-family
  // gate (finance.read) AND one of these scopes; reach is the union of held scopes; UI hiding is
  // never authority. All registered active:false -- REGISTER != GRANT != ACTIVATE. The COMPANY and
  // BUSINESS_UNIT scopes bind through the governed access-scope types operatingCompany /
  // businessUnit on RoleAssignments (DECISIONS #157 -- FIN-BLOCK-001 CLOSED): values are
  // validated against the governed company/unit vocabularies at grant time, and a held grant
  // with NO scoped binding still confers NO reach (fail-closed in
  // loadFinancialVisibilityAuthority), never "all companies"/"all units".
  Object.freeze({
    id: "finance.visibility.self",
    description:
      "FIN-004 reach scope SELF: financial records credited to this principal (attribution.creditedSalespersonId == the principal's linked employeeId). Requires finance fact-family capability in addition; confers nothing alone.",
    resource: "finance.visibility",
    action: "self",
    active: false,
  }),
  Object.freeze({
    id: "finance.visibility.team",
    description:
      "FIN-004 reach scope TEAM: SELF plus records credited to employees the governed role hierarchy (access/hierarchicalVisibility.ts) places under this principal. No peer visibility; requires the finance fact-family capability in addition.",
    resource: "finance.visibility",
    action: "team",
    active: false,
  }),
  Object.freeze({
    id: "finance.visibility.businessUnit",
    description:
      "FIN-004 reach scope BUSINESS_UNIT: financial records wholly attributable to one governed business unit (a cross-unit document stays hidden entirely — visibility follows the number). Reach binds through a businessUnit-scoped RoleAssignment validated against the canonical unit vocabulary (DECISIONS #157); a grant with no scoped binding confers no reach.",
    resource: "finance.visibility",
    action: "businessUnit",
    active: false,
  }),
  Object.freeze({
    id: "finance.visibility.company",
    description:
      "FIN-004 reach scope OPERATING_COMPANY: financial records of one governed operating company (invoice companyId, which FIN-002 pins to the Sales Order's operatingCompanyId). Reach binds through an operatingCompany-scoped RoleAssignment validated against the governed company authority (DECISIONS #157); a grant with no scoped binding confers no reach.",
    resource: "finance.visibility",
    action: "company",
    active: false,
  }),
  Object.freeze({
    id: "finance.visibility.consolidated",
    description:
      "FIN-004 reach scope CONSOLIDATED: every financial record across companies and units. Never a default and never implied by any operational capability — expressly granted only. Requires the finance fact-family capability in addition.",
    resource: "finance.visibility",
    action: "consolidated",
    active: false,
  }),
  // Finance (Billing/AR) -- record a refund (money returned after payment) via the trusted recordRefund
  // command. Reverses applied payment on the invoice (outstanding/state re-derived) + audit; NEVER rewrites the
  // issued invoice. Distinct from a credit/write-off. Registered active:false (fail-closed). refunds is
  // Admin-SDK-only (deny-all client Rules).
  Object.freeze({
    id: "finance.refund.record",
    description:
      "Record a refund (money returned after payment) and reverse the applied payment on the invoice via the trusted recordRefund command. Does not rewrite the issued invoice, collapse into a negative payment, or expose client-direct financial writes.",
    resource: "finance.refund",
    action: "record",
    active: false,
  }),
  // CERT-FIN-02 Financial Policy Profile -- a company's DEPLOYMENT-TIME accounting configuration
  // (functions/src/finance/financialPolicyProfile.ts). Deliberately NOT a `finance.*` transaction
  // capability: this is company setup authority, exercised once with the customer's accounting team
  // during deployment, not routine financial work.
  //
  // OWNER RULING (financial-policy authority). Both are now ACTIVATED -- through the per-environment
  // seam, NOT by flipping `active` here. A catalogued `active: true` means LIVE IN EVERY ENVIRONMENT
  // including production, because an override set can only ADD activation and never remove it; that
  // is the exact defect DECISIONS #167 corrected for the report.* family. So these stay
  // `active: false` and environmentCapabilityOverrides.ts activates them per environment. Production
  // activation is a separate ruling and that path cannot deliver it (production is triple-blocked).
  //
  // WHO HOLDS WHAT. `.configure` is held by admin and owner ONLY, and by DERIVATION rather than a new
  // grant: ADMIN_ALL_PERMISSIONS is every catalog id and OWNER_PERMISSIONS is built from
  // ADMIN_ROLE.permissions, so no Role edit was needed and none was made. `.read` is deliberately
  // broader -- accountingManager + financeManager (via MONEY_MANAGER_PERMISSIONS), controller and
  // generalManager -- because seeing which costing method governs your numbers is part of that work.
  // The money Roles do NOT get `.configure`: approving an accounting policy does not confer EOS
  // configuration authority, and read authority never implies write authority.
  //
  // NEITHER BEATS THE LOCK. Once a profile is LOCKED the trusted command refuses mutation for every
  // principal including admin and owner, checked against stored state inside the transaction.
  // `financial_policy_profiles` has no firestore.rules match block (deny-all to every client), and
  // the only write path is that command.
  Object.freeze({
    id: "financialPolicy.profile.read",
    description:
      "Read the operating company's governed financial policy profile (inventory cost method, COGS recognition point, treatment choices, lifecycle status) via the trusted read. A READ capability: it configures nothing and widens no client Rule.",
    resource: "financialPolicy.profile",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "financialPolicy.profile.configure",
    description:
      "Configure an operating company's DRAFT/APPROVED financial policy profile during deployment via the trusted command. Never edits a LOCKED profile: once financial authority is activated, changing accounting policy requires a separately governed financial-policy migration, and no capability -- including admin and owner -- bypasses that.",
    resource: "financialPolicy.profile",
    action: "configure",
    active: false,
  }),
  // Commercial Coverage & Territory (#15) -- create durable Sales Territories + effective-dated coverage
  // assignments via the trusted coverage commands. Records only (no precedence/credit/commission). Registered
  // active:false (fail-closed). sales_territories / commercial_coverage_assignments are Admin-SDK-only.
  Object.freeze({
    id: "coverage.write",
    description:
      "Create a Sales Territory or a Commercial Coverage Assignment via the governed coverage command. Records durable coverage facts only; does not resolve precedence, credit, or commission, and exposes no client-direct writes.",
    resource: "coverage",
    action: "write",
    active: false,
  }),
  // Commercial Coverage & Territory (#15) -- trusted READ: resolve the coverageAssignments[] for a context via
  // the governed backend (the client never reads coverage collections directly). Registered active:false
  // (fail-closed). A READ capability -- writes nothing, widens no client Rule, resolves no precedence/winner.
  Object.freeze({
    id: "coverage.read",
    description:
      "Resolve the commercial coverage (all effective, matching coverage assignments) for a context via the trusted resolveCoverageForContext callable. Backend read only; returns every matching assignment (split coverage), never a single owner/credit/commission.",
    resource: "coverage",
    action: "read",
    active: false,
  }),

  // --- Inventory / Reorder / Purchasing domain (Issue #100; Assessment's
  // Inventory domain audit table; firestore.rules current `main`) ---
  Object.freeze({
    id: "reorder.request.read.queue",
    description:
      "Read the Parts Manager queue/oversight/history views of reorder requests.",
    resource: "reorder.request",
    action: "read.queue",
  }),
  Object.freeze({
    id: "reorder.request.read.own",
    description:
      "Read only the reorder requests assigned to the caller's own identity.",
    resource: "reorder.request",
    action: "read.own",
  }),
  Object.freeze({
    id: "reorder.request.create.manual",
    description:
      "Submit a manual NEEDS_PLANNING reorder request via the zero-history quantity path.",
    resource: "reorder.request",
    action: "create.manual",
  }),
  Object.freeze({
    id: "reorder.request.create.system",
    description:
      "Create a system-originated (READY-path) reorder request -- admin/dispatcher only today.",
    resource: "reorder.request",
    action: "create.system",
  }),
  Object.freeze({
    id: "reorder.request.assign",
    description: "Assign a reorder request to a Parts Associate.",
    resource: "reorder.request",
    action: "assign",
  }),
  Object.freeze({
    id: "reorder.request.startPurchasing",
    description: "Transition an assigned reorder request to Start Purchasing.",
    resource: "reorder.request",
    action: "startPurchasing",
  }),
  Object.freeze({
    id: "reorder.request.postPurchasingUpdate",
    description: "Post a purchasing status update on an assigned reorder request.",
    resource: "reorder.request",
    action: "postPurchasingUpdate",
  }),
  Object.freeze({
    id: "reorder.request.recordPurchaseOrder",
    description: "Record a Purchase Order against an assigned reorder request.",
    resource: "reorder.request",
    action: "recordPurchaseOrder",
  }),
  Object.freeze({
    id: "reorder.request.markReceived",
    description: "Mark an assigned reorder request's Purchase Order as Received.",
    resource: "reorder.request",
    action: "markReceived",
  }),
  Object.freeze({
    id: "reorder.request.approve",
    description: "Approve a reorder request -- admin/dispatcher only today.",
    resource: "reorder.request",
    action: "approve",
  }),
  Object.freeze({
    id: "reorder.request.reject",
    description: "Reject a reorder request -- admin/dispatcher only today.",
    resource: "reorder.request",
    action: "reject",
  }),
  Object.freeze({
    id: "reorder.request.cancel",
    description: "Cancel a reorder request -- admin/dispatcher only today.",
    resource: "reorder.request",
    action: "cancel",
  }),
  Object.freeze({
    id: "reorder.purchaseOrder.read",
    description: "Read reorder Purchase Orders / Purchase Order Voids.",
    resource: "reorder.purchaseOrder",
    action: "read",
  }),
  Object.freeze({
    id: "reorder.purchaseOrder.create",
    description: "Create a reorder Purchase Order.",
    resource: "reorder.purchaseOrder",
    action: "create",
  }),
  Object.freeze({
    id: "reorder.purchaseOrder.void",
    description:
      "Void a reorder Purchase Order -- admin/dispatcher, or the recorded assignee only.",
    resource: "reorder.purchaseOrder",
    action: "void",
  }),
  // Inventory analytics -- the trusted getInventoryAnalytics read (inventory health
  // dashboard over inventory_transactions + stock_locations).
  //
  // AUTHORITY NORMALIZATION, NOT A PERMISSION CHANGE. This callable previously
  // authorized with a direct `caller.role === "admin" || "dispatcher"` check, the only
  // read service in the repo bypassing the capability catalog. Registering it here and
  // granting it through SHARED_ADMIN_DISPATCHER_BASE_PERMISSIONS reproduces that exact
  // audience -- admin and dispatcher, no one else, nothing removed.
  //
  // Deliberately ONE capability rather than requiring inventory.transaction.read AND
  // warehouse.stockLocation.read together. Those two each cover one of the collections
  // it reads, but no callable in this repo requires two capabilities, and inventing that
  // pattern for a single case would be a worse precedent than a composite id.
  //
  // `active` is omitted (undefined !== false), so it resolves like every other
  // pre-existing capability. Registering it active:false would have DENIED today's
  // admins and dispatchers, which is a permission removal disguised as a refactor.
  Object.freeze({
    id: "inventory.analytics.read",
    description:
      "Read the trusted inventory health analytics projection (getInventoryAnalytics) computed over inventory_transactions and serialized_assets at ACTIVE warehouses. Backend-resolved; no client-direct read of either collection.",
    resource: "inventory.analytics",
    action: "read",
  }),
  Object.freeze({
    id: "inventory.transaction.read",
    description: "Read inventory_transactions records.",
    resource: "inventory.transaction",
    action: "read",
  }),
  Object.freeze({
    id: "inventory.action.read",
    description: "Read inventory_actions records.",
    resource: "inventory.action",
    action: "read",
  }),
  Object.freeze({
    id: "inventory.action.create",
    description: "Create an inventory_actions record -- admin/dispatcher only today.",
    resource: "inventory.action",
    action: "create",
  }),

  // --- Warehouse domain (Epic 4 Warehouse + Fulfillment System; Spec §27) --
  // read-only: no create/update/delete permission exists for any of the
  // three collections below because no client-reachable write path
  // exists (Admin-SDK-internal only) -- see Spec §27.1 for the repository
  // evidence this claim is grounded in.
  Object.freeze({
    id: "warehouse.record.read",
    description: "Read a warehouses record (physical warehouse site).",
    resource: "warehouse.record",
    action: "read",
  }),
  Object.freeze({
    id: "warehouse.stockLocation.read",
    description: "LEGACY, RETIRED AUTHORITY. Read a stock_locations record. BIN-P2 (Decision #160 / ADR-014) retired stock_locations as an inventory authority: nothing writes it, no runtime code reads it, and it is NOT bin-level quantity truth. Physical on-hand is inventory_transactions (NONE) and serialized_assets (SERIAL). BIN-P2R removed the last client reader and the Firestore Rules read arm, so no principal can reach the collection at all; the id is retained only as a historical catalog entry and nothing evaluates it.",
    resource: "warehouse.stockLocation",
    action: "read",
  }),
  Object.freeze({
    id: "warehouse.transferOrder.read",
    description: "Read a transfer_orders record (inter-warehouse stock transfer).",
    resource: "warehouse.transferOrder",
    action: "read",
  }),

  // --- Report field-level read capabilities (Issue #325 / ADR-007 D-226) ---
  // docs/specifications/governed-object-based-report-creator.md §4/§5,
  // wave 1 only (customer/contact/location/equipment -- the four objects
  // whose Specification field tables are already fully authored and
  // Owner-approved; later waves' fields are catalogued at their own,
  // separately-authorized activation per ADR-007 §2.9/§4). No Rule,
  // Function, or Role grants any of these ids yet (see
  // resolveEffectivePermission.test.mjs's A3 acceptance test, which
  // defers this whole class the same way it already defers
  // `audit.event.read`) -- this is catalog data only, exactly as
  // required for D-226 ("resolvable by resolveEffectivePermission per
  // field") and no more. One capability governs every operation on a
  // field (select/filter/sort/group/aggregate/display/share/schedule/
  // export) -- ADR-007 §4 open decision 2, resolved here as NOT
  // operator-differentiated (the Specification's own adopted default).
  // A field id is never embedded as a static Role.conditionsByPermission
  // param -- the field identity IS the PermissionId itself (catalog
  // data), and any future genuinely per-target authorization for a
  // report capability must use a ConditionContext closure, never a
  // static param, per the precedent set by Issue #226 Warehouse Rows A/B
  // (isAssignedToWarehouse()).
  //
  // `active: false` marks a REGISTERED-but-not-yet-grantable capability
  // (ADR-007 §2.6): `customer.notes`/`location.accessNotes` are
  // `security-text` fields the Specification requires the wave-1 review
  // to explicitly confirm before activation (Spec §5, sensitivity
  // legend) -- not yet done here; `customer.accountOwner` is `employee`-
  // sensitivity and explicitly deferred to wave 4 despite sitting in the
  // wave-1 table (Spec §4, load-bearing example). Every other wave-1
  // field/object id is `active: true` -- their review IS the merged
  // Specification itself.
  Object.freeze({
    id: "report.customer.read",
    description: "Object-level read gate for reporting on Customer/Account records.",
    resource: "report.customer",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.name.read",
    description: "Report field-read: customer.name.",
    resource: "report.customer.field.name",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.status.read",
    description: "Report field-read: customer.status.",
    resource: "report.customer.field.status",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.relationshipTypes.read",
    description: "Report field-read: customer.relationshipTypes.",
    resource: "report.customer.field.relationshipTypes",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.billingAddress.read",
    description:
      "Report field-read: customer.billingAddress (street/city/state/zip -- one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.billingAddress",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.tags.read",
    description: "Report field-read: customer.tags.",
    resource: "report.customer.field.tags",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.externalIds.read",
    description:
      "Report field-read: customer.customerNumber/erpId/accountingId/legacyId (one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.externalIds",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.notes.read",
    description:
      "Report field-read: customer.notes -- security-text, inactive pending the wave-1 review's explicit confirmation (Spec §5 sensitivity legend).",
    resource: "report.customer.field.notes",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.createdAt.read",
    description: "Report field-read: customer.createdAt.",
    resource: "report.customer.field.createdAt",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.paymentTerms.read",
    description: "Report field-read: customer.paymentTerms -- governed (Rules admin-only write, Issue #175).",
    resource: "report.customer.field.paymentTerms",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.taxStatus.read",
    description: "Report field-read: customer.taxStatus -- governed (Rules admin-only write, Issue #175).",
    resource: "report.customer.field.taxStatus",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.commercialProfile.read",
    description:
      "Report field-read: customer.defaultCurrency/purchaseOrderRequired/invoiceDeliveryMethod (one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.commercialProfile",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.billingContact.read",
    description: "Report field-read: customer.billingContact (reference -> contact).",
    resource: "report.customer.field.billingContact",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.customer.field.accountOwner.read",
    description:
      "Report field-read: customer.accountOwner (reference -> employee) -- employee-sensitivity, deferred to wave 4 despite sitting in the wave-1 object table (Spec §4).",
    resource: "report.customer.field.accountOwner",
    action: "read",
    active: false,
  }),

  Object.freeze({
    id: "report.contact.read",
    description: "Object-level read gate for reporting on Contact records.",
    resource: "report.contact",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.contact.field.name.read",
    description: "Report field-read: contact.name.",
    resource: "report.contact.field.name",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.contact.field.email.read",
    description: "Report field-read: contact.email.",
    resource: "report.contact.field.email",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.contact.field.phone.read",
    description: "Report field-read: contact.phone.",
    resource: "report.contact.field.phone",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.contact.field.role.read",
    description: "Report field-read: contact.role.",
    resource: "report.contact.field.role",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.contact.field.customer.read",
    description: "Report field-read: contact.accountId (reference -> customer).",
    resource: "report.contact.field.customer",
    action: "read",
    active: false,
  }),

  Object.freeze({
    id: "report.location.read",
    description: "Object-level read gate for reporting on Location records.",
    resource: "report.location",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.location.field.name.read",
    description: "Report field-read: location.name.",
    resource: "report.location.field.name",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.location.field.address.read",
    description:
      "Report field-read: location.address.street/city/state/zip (one capability, grouped per Spec §5.3).",
    resource: "report.location.field.address",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.location.field.accessNotes.read",
    description:
      "Report field-read: location.accessNotes -- security-text, inactive pending the wave-1 review's explicit confirmation (Spec §5 sensitivity legend).",
    resource: "report.location.field.accessNotes",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.location.field.customer.read",
    description: "Report field-read: location.accountId (reference -> customer).",
    resource: "report.location.field.customer",
    action: "read",
    active: false,
  }),

  Object.freeze({
    id: "report.equipment.read",
    description: "Object-level read gate for reporting on Equipment records.",
    resource: "report.equipment",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.equipment.field.name.read",
    description: "Report field-read: equipment.name.",
    resource: "report.equipment.field.name",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.equipment.field.status.read",
    description: "Report field-read: equipment.status.",
    resource: "report.equipment.field.status",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.equipment.field.identity.read",
    description:
      "Report field-read: equipment.manufacturer/model/serialNumber/assetTag (one capability, grouped per Spec §5.4).",
    resource: "report.equipment.field.identity",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.equipment.field.dates.read",
    description: "Report field-read: equipment.installedDate/warrantyExpiresDate (one capability, grouped per Spec §5.4).",
    resource: "report.equipment.field.dates",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.equipment.field.notes.read",
    description: "Report field-read: equipment.notes -- standard (not security-text; distinct from customer/location notes, Spec §5.4).",
    resource: "report.equipment.field.notes",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.equipment.field.customer.read",
    description: "Report field-read: equipment.accountId (reference -> customer).",
    resource: "report.equipment.field.customer",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.equipment.field.location.read",
    description: "Report field-read: equipment.locationId (reference -> location).",
    resource: "report.equipment.field.location",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.equipment.field.createdAt.read",
    description: "Report field-read: equipment.createdAt.",
    resource: "report.equipment.field.createdAt",
    action: "read",
    active: false,
  }),

  // --- Report saved-definition domain (Issue #325 / ADR-007 W-SAVE) ---
  // Governs CRUD authority over the reportDefinitions collection's
  // DOCUMENTS via the trusted saved-definition service
  // (functions/src/reporting/savedDefinitionCommands.ts) -- never
  // client-direct Firestore access (firestore.rules denies all direct
  // client read/write on this collection unconditionally). Holding one
  // of these ids says nothing about which REPORT DATA a principal may
  // see -- "a definition confers no data access" (Spec sec8/sec9);
  // running a saved definition still re-authorizes every object/field
  // through the SAME resolver via reportExecutionService.ts (D-FN),
  // every time. `read` covers both a single get() and the caller's own
  // list -- ownership (ownerUid == the trusted actor) is enforced by
  // the service itself, not by these ids (a capability answers "may
  // this principal use this action on THEIR OWN definitions at all",
  // never "on any definition regardless of owner" -- there is no
  // owner-override id here, matching Spec sec9's "private by default,
  // no admin override" invariant carried over from D-RULES).
  Object.freeze({
    id: "report.definition.create",
    description: "Create a saved report definition (trusted saved-definition service).",
    resource: "report.definition",
    action: "create",
    active: false,
  }),
  Object.freeze({
    id: "report.definition.read",
    description: "Read (get one or list one's own) saved report definitions (trusted saved-definition service).",
    resource: "report.definition",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "report.definition.rename",
    description: "Rename one's own saved report definition (trusted saved-definition service).",
    resource: "report.definition",
    action: "rename",
    active: false,
  }),
  Object.freeze({
    id: "report.definition.duplicate",
    description: "Duplicate one's own saved report definition (trusted saved-definition service).",
    resource: "report.definition",
    action: "duplicate",
    active: false,
  }),
  Object.freeze({
    id: "report.definition.delete",
    description: "Delete one's own saved report definition (trusted saved-definition service).",
    resource: "report.definition",
    action: "delete",
    active: false,
  }),

  // --- Enterprise Access & Administration domain (this platform; Spec §16) ---
  Object.freeze({
    id: "admin.userStatus.write",
    description: "Enable/disable a principal's account status.",
    resource: "admin.userStatus",
    action: "write",
  }),
  Object.freeze({
    id: "admin.roleAssignment.write",
    description: "Assign or revoke an already-approved Role.",
    resource: "admin.roleAssignment",
    action: "write",
  }),
  Object.freeze({
    id: "admin.accessRequest.decide",
    description: "Approve or reject a pending Access Request.",
    resource: "admin.accessRequest",
    action: "decide",
  }),
  // DATA IMPORT P1 (sandbox-only native file import). TWO capabilities, deliberately, because
  // the flow has two audiences of risk and only one of them writes anything.
  //
  // `admin.dataImport.stage` covers upload, entity selection, column mapping, normalization,
  // validation and preview. Every module behind it is structurally incapable of an operational
  // write -- there is no write path to hold back, which is why staging is a lower bar than
  // executing without that being a concession.
  //
  // `admin.dataImport.execute` is the authority to turn an approved preview into governed EOS
  // records. It is NOT a bypass: execution runs the SAME governed commands a human would
  // (createPart, and for Inventory the opening-balance authority over the existing ledger), so
  // holding it never authorizes a write the holder could not have made one record at a time.
  //
  // Registered active:false. Import is sandbox-only for P1, and that property is enforced twice
  // over: per-environment activation here, and importTargetGuard.ts refusing the production
  // project by name inside the command itself.
  Object.freeze({
    id: "admin.dataImport.stage",
    description:
      "Upload a file, choose or confirm the entity, map columns, and see the validated preview of what an import would do. Writes no operational record and cannot: the staging path has no write capability of any kind.",
    resource: "admin.dataImport",
    action: "stage",
    active: false,
  }),
  Object.freeze({
    id: "admin.dataImport.execute",
    description:
      "Approve a validated import preview and execute it through the governed EOS commands. Creates records only: never overwrites an existing one, and never bypasses the command that owns the record it writes.",
    resource: "admin.dataImport",
    action: "execute",
    active: false,
  }),
  // AUTH-PR-3.5 (Authentication Modernization; DECISIONS #56 D-RESET-PERMISSION).
  // Admin-initiated password reset for another eligible user. Registered
  // INACTIVE (`active: false` = hard, unconditional DENY through
  // resolveEffectivePermission regardless of any Role grant) -- activation and
  // any Role grant are a separate, later production/security gate. The merged
  // command authorizes via the compatibility admin authority
  // (`users/{uid}.role === "admin"`, encapsulated for a 1:1 resolver swap per
  // auth-modernization-architecture.md §6.1); this catalog entry is the declared
  // future governed contract, not a runtime activation.
  Object.freeze({
    id: "admin.credentialReset.initiate",
    description: "Initiate an admin-initiated password reset for another eligible user (inactive pending a separate production/security gate).",
    resource: "admin.credentialReset",
    action: "initiate",
    active: false,
  }),
  Object.freeze({
    id: "audit.event.read",
    description: "Read the immutable Audit Event history.",
    resource: "audit.event",
    action: "read",
  }),
  // INV-1 Phase 1 PR 1.2 -- Part Master trusted write service (ADR-008 /
  // Decision #40; capability ids named by the accepted Part Master spec
  // sec10). Registered-but-ungranted: no Role grants these yet, so every
  // real resolution DENIES (unavailable-not-unsafe, same posture the
  // report.* ids launched with).
  Object.freeze({
    id: "inventory.catalog.manage",
    description: "Create and edit canonical Part and Manufacturer descriptive records (trusted Part Master service).",
    resource: "inventory.catalog",
    action: "manage",
  }),
  Object.freeze({
    id: "inventory.catalog.activate",
    description: "Change Part or Manufacturer lifecycle status (trusted Part Master service).",
    resource: "inventory.catalog",
    action: "activate",
  }),
  // Wave 6 Owner Decision (2026-08-15): trusted catalog/reference read the Parts experience needs,
  // starting with the Manufacturer catalog (functions/src/partMaster/manufacturerReadService.ts).
  // Backend-resolved scope; no client-direct manufacturers read (Rules stay deny-all).
  Object.freeze({
    id: "inventory.catalog.read",
    description: "Read the minimal governed catalog/reference projection (Manufacturer identity/status) via the trusted getManufacturerCatalog read service. Backend-resolved scope; no client-direct manufacturers read.",
    resource: "inventory.catalog",
    action: "read",
    active: false,
  }),
  // Scanner Phase Q -- RETURNS INTAKE (functions/src/inventoryReturns/returnIntakeCommand.ts).
  //
  // DECISIONS #118: intake and disposition are SEPARATE authorities, and a return must not
  // automatically restore inventory to sellable stock. This authorizes recording that something came
  // back -- source, item, quantity, condition, reason -- and nothing else. It writes no ledger event,
  // which is exactly why `RETURNED` still has no writer in this platform.
  //
  // NOT `inventory.stock.receive`: receiving accepts stock INTO sellable inventory, which is
  // precisely what a return must not do. Reusing it would put intake behind an authority whose whole
  // meaning is the thing #118 forbids.
  //
  // Disposition -- return to stock, inspect/quarantine, repair, vendor RMA, scrap -- will need its
  // OWN capability when the policy exists. None is registered here, because none has been decided.
  //
  // REGISTERED BUT UNGRANTED AND INERT BY DESIGN: `active: false`, granted to NO Role.
  Object.freeze({
    id: "inventory.returns.intake",
    description:
      "Record a returned item (source, identity, quantity or serials, condition, reason) as AWAITING_DISPOSITION via the trusted returns intake command. Intake only: authors no ledger movement and never restores stock to sellable inventory (DECISIONS #118).",
    resource: "inventory.returns",
    action: "intake",
    active: false,
  }),
  // Scanner Phase L -- PUT-AWAY (functions/src/inventoryLocation/putAwayCommand.ts).
  //
  // Records WHERE stock was stowed inside a warehouse it already belongs to. Per DECISIONS #116 this
  // writes a PLACEMENT RECORD and nothing else: no ledger event, no quantity change, no balance --
  // because putting stock into a bin must not remove it from warehouse on-hand or available.
  //
  // A THIRD audience, and therefore a third capability. `inventory.location.bin.manage` labels
  // racking and `.read` checks a bin is real; stowing is neither. It is also deliberately NOT
  // `inventory.stock.receive`: receiving is a custody event that changes what the company has, and
  // reusing it would make every stow look like an authority to accept stock.
  //
  // REGISTERED BUT UNGRANTED AND INERT BY DESIGN: `active: false`, granted to NO Role.
  Object.freeze({
    id: "inventory.placement.record",
    description:
      "Record a physical put-away: which bin stock was stowed in, within the warehouse that already holds it. Placement only -- authors no ledger movement, no quantity change and no inventory custody (DECISIONS #116).",
    resource: "inventory.placement",
    action: "record",
    active: false,
  }),
  // BIN-P6 / DECISIONS #169 -- INTERNAL PHYSICAL RELOCATION.
  //
  // Move already-owned stock between exact governed locations INSIDE one Warehouse custody parent:
  // WAREHOUSE direct -> BIN, BIN -> WAREHOUSE direct, BIN -> BIN in the same Warehouse. The
  // Warehouse aggregate does not change, because nothing crossed a custody boundary.
  //
  // A THIRD AUTHORITY, DELIBERATELY DISTINCT FROM BOTH ITS NEIGHBOURS.
  //
  // Not `inventory.placement.record`: that authorizes placement/history EVIDENCE only and authors no
  // quantity. Keeping it narrow is the point -- a put-away that both moves stock and records where it
  // went requires BOTH capabilities, and an actor holding only placement must be REFUSED the quantity
  // movement rather than given a descriptive-only success that looks authoritative.
  //
  // Not the Transfer authority: Transfer owns CUSTODY BOUNDARIES (warehouse to warehouse, and every
  // move touching MOBILE). Reusing it for an internal shelf-to-shelf move would make every relocation
  // look like stock leaving the building.
  //
  // REGISTERED BUT UNGRANTED AND INERT BY DESIGN: `active: false`, granted to NO Role. BIN-P4 owns
  // activation and grants; the relocation command itself is BIN-P6 work and does not exist yet.
  Object.freeze({
    id: "inventory.stock.relocate",
    description:
      "Move already-owned physical inventory between exact governed locations inside the same Warehouse custody parent (warehouse-direct to bin, bin to warehouse-direct, bin to bin). Authors internal relocation movement only: the Warehouse aggregate is unchanged, no custody boundary is crossed, and this grants nothing about transferring stock between warehouses or to a truck (DECISIONS #169).",
    resource: "inventory.stock",
    action: "relocate",
    active: false,
  }),
  // Scanner Phase K -- the DESCRIPTIVE BIN REGISTRY (functions/src/inventoryLocation/bin*.ts).
  //
  // WHAT A BIN IS, PER DECISIONS #116: the warehouse is the inventory custody authority and a bin is
  // a descriptive physical sub-location within one. Putting stock into a bin must NOT remove it from
  // warehouse on-hand or available, so these capabilities govern PLACE IDENTITY only -- they author
  // no quantity, no ledger event and no location reference any movement command would accept.
  //
  // TWO CAPABILITIES BECAUSE THERE ARE TWO AUDIENCES. An operator putting stock away needs to check
  // that a scanned bin is real; an administrator labels racking. Gating the check on the write
  // capability would let every put-away operator create and retire bins -- the same broadening the
  // catalog exists to prevent, and the same split Phase G drew for alias lookup vs administration.
  //
  // `bins` has NO firestore.rules match block, so it is deny-all to every client including admin.
  // That needed no Rules change: these run on the Admin SDK, which Rules do not govern.
  //
  // REGISTERED BUT UNGRANTED AND INERT BY DESIGN: both `active: false`, granted to NO Role, no
  // per-environment activation override.
  Object.freeze({
    id: "inventory.location.bin.manage",
    description:
      "Create, rename, retire or revive a descriptive bin (a physical sub-location within one warehouse) via the trusted bin registry commands. Renaming moves the bin code claim and keeps the same bin. Place identity only: authors no quantity, no ledger movement and no inventory custody.",
    resource: "inventory.location.bin",
    action: "manage",
    active: false,
  }),
  Object.freeze({
    id: "inventory.location.bin.read",
    description:
      "Resolve a scanned bin code within a warehouse, list a warehouse's bins, or preview what creating a proposed bin would do, via the trusted bin read services. Read-only: authors nothing, does not authorize creating or retiring bins, and grants nothing about inventory.",
    resource: "inventory.location.bin",
    action: "read",
    active: false,
  }),
  // Scanner Phase H -- the shared INVENTORY BALANCE read (functions/src/inventory/
  // partBalanceReadService.ts): on-hand, reserved, available and on-order for one Part.
  //
  // NOT A SCANNER CAPABILITY. It answers a general inventory question and the scanner is merely its
  // first consumer. The numbers come from fulfillment/fulfillmentAvailability.ts's Owner-ratified
  // pure functions -- no fourth parallel on-hand implementation.
  //
  // WHY NOT REUSE AN EXISTING ID. `warehouse.stockLocation.read` names the stock_locations
  // collection, which the Owner's 2026-08-17 ruling SUPERSEDED as a stock authority (nothing writes
  // it; it diverged from the ledger in both directions); pointing it at a ledger-derived read would
  // make it a synonym for something it no longer means. It is also granted only to
  // admin/dispatcher/owner, which is the wrong audience for a warehouse balance question.
  // `inventory.analytics.read` is a dashboard projection over the whole estate, not a per-part
  // answer. Neither fits, so this is the smallest id that does.
  //
  // REGISTERED BUT UNGRANTED AND INERT BY DESIGN: `active: false`, granted to NO Role, no
  // per-environment activation override -- resolveEffectivePermission() denies for every principal
  // until activation and grant are separately authorized.
  Object.freeze({
    id: "inventory.balance.read",
    description:
      "Read the governed inventory balance for one Part (on-hand at ACTIVE warehouses, open Work Order reservations, available, and outstanding ordered quantity) via the trusted getPartBalance read service. Backend-resolved scope; composed from the ratified fulfillment availability functions, not a second on-hand authority.",
    resource: "inventory.balance",
    action: "read",
    active: false,
  }),
  // Scanner Phase G -- barcode/alias LOOKUP, as distinct from alias ADMINISTRATION.
  //
  // THE AUDIENCE SPLIT THIS EXISTS FOR. partAliasCallables.ts recorded, at Phase A, that identifier
  // administration reuses `inventory.catalog.manage` and that a dedicated alias-read capability was
  // "the option NOT taken, so the choice is visible if the audience ever splits". It has now split:
  // a warehouse or Parts user scanning a barcode to see WHAT A PART IS needs to resolve an alias,
  // and gating that on `inventory.catalog.manage` would hand every scanning user the authority to
  // CREATE, DEACTIVATE and REACTIVATE identifiers. Broadening a write capability to serve a read is
  // the widening this catalog exists to prevent.
  //
  // WHY NOT REUSE `inventory.catalog.read`. That id is scoped to the Manufacturer catalog
  // projection served by getManufacturerCatalog -- its own description says so. Reusing it here
  // would make it a synonym for something it does not mean, and the two reads would then be
  // impossible to grant independently.
  //
  // RESOLVE-ONLY, AND NARROWER THAN THE ADMIN LIST. This authorizes exactly one question: "which
  // Part does this scanned identifier point to?" It does not authorize listing a Part's identifiers
  // (listPartAliases stays on `inventory.catalog.manage`, because seeing INACTIVE identifiers is
  // load-bearing for the write path), and it grants nothing about the Part record itself -- reading
  // the Part is separately governed by firestore.rules.
  //
  // REGISTERED BUT UNGRANTED AND INERT BY DESIGN: `active: false`, granted to NO compatibility,
  // default or operational Role, with no per-environment activation override, so
  // resolveEffectivePermission() denies for every principal. Activation and grant are a separate
  // Owner decision -- same posture as inventory.serializedAsset.read at its own introduction.
  Object.freeze({
    id: "inventory.catalog.alias.read",
    description:
      "Resolve a scanned or typed identifier (barcode, UPC/EAN/GTIN, supplier SKU, manufacturer part number or other registered alias) to the Part it points to, via the trusted resolveScannedPartIdentifier read service. Resolve-only: does not authorize listing a Part's identifiers, and does not authorize reading the Part record itself. Backend-resolved scope; no client-direct part_aliases read.",
    resource: "inventory.catalog.alias",
    action: "read",
    active: false,
  }),
  // Serialized Asset registry, Spec phase M.1 (docs/specifications/serialized-asset-equipment-installation.md
  // §I / §M.1, ADR-010 + DECISIONS #59): trusted Available-Equipment read (functions/src/serializedAsset/
  // serializedAssetReadService.ts). Backend-resolved scope; no client-direct serialized_assets read (no
  // firestore.rules match block exists for this collection -- default deny). REGISTERED BUT UNGRANTED BY
  // DESIGN: this phase grants the capability to NO compatibility Role and adds NO per-environment activation
  // override, so resolveEffectivePermission() denies for every principal until a later, separately
  // authorized grant + activation gate -- same posture as inventory.catalog.read at its own introduction.
  Object.freeze({
    id: "inventory.serializedAsset.read",
    description:
      "Read the minimal governed Available Equipment projection (serialNo, partId, currentLocationId, inventoryState, currentEquipmentId, ownership) via the trusted getAvailableEquipment read service. Backend-resolved scope; no client-direct serialized_assets read.",
    resource: "inventory.serializedAsset",
    action: "read",
    active: false,
  }),
  // SERIALIZED ASSET ACQUISITION -- an already-owned unit entering EOS without a purchase order.
  //
  // Quantity stock could already do this: an ADJUSTED movement sourced from an ADJUSTMENT says "we
  // already hold 571 of these". Serialized stock could not -- its only creator was receipt against a
  // purchase order -- so the platform could not say "we already own THIS machine" without inventing
  // a purchase that never happened.
  //
  // HIGH TRUST, and narrow by construction: it creates owned inventory with no procurement record,
  // and every acquisition must name a reason from a closed set in which "we bought it" does not
  // appear. Registered active:false and granted to no Role.
  Object.freeze({
    id: "inventory.serializedAsset.acquire",
    description: "Bring an already-owned serialized unit into managed custody without a purchase order (opening balance, legacy migration, existing company asset) via the trusted acquireSerializedAsset command. Creates no Equipment, no customer relationship and no purchasing history.",
    resource: "inventory.serializedAsset",
    action: "acquire",
    active: false,
  }),
  // EI Phase-2 Receiving (Phase C): the trusted receiveInventoryStock command's capability.
  // GRANTED to the governed admin, dispatcher and owner Roles since 2026-08-06 (compatibilityRoles.ts
  // grants it directly to admin + dispatcher; owner inherits by composition -- Decisions #65/#68).
  // resolveEffectivePermission() therefore allows those three Roles; it still denies `noQualifyingGrant`
  // for technician and other ungranted principals. Client transport readiness (whether the UI actually
  // calls it) is a SEPARATE, still-gated concern -- see field-ops-app-vite/src/config/receivingReadiness.js.
  Object.freeze({
    id: "inventory.stock.receive",
    description: "Receive inbound stock into an inventory location against a reorder purchase order (trusted Receiving service).",
    resource: "inventory.stock",
    action: "receive",
  }),
  // Enterprise Inventory Phase 4 -- Transfer operating authority (functions/src/inventoryTransfer/*).
  // Closes the WAREHOUSE -> MOBILE/TRUCK -> WAREHOUSE loop over the already-merged transfer_orders read
  // model + inventoryLedger TRANSFER_OUT/TRANSFER_IN contract. REGISTERED BUT UNGRANTED by design -- no
  // compatibility/default/operational Role holds any of these four ids, no claims initializer/migration/
  // fixture mints them, and there is no superuser/wildcard bypass, so resolveEffectivePermission() denies
  // `noQualifyingGrant` for every principal until a later, separately-authorized grant gate. Same
  // ungranted posture as inventory.stock.receive at its own introduction. CUSTOMER delivery is a separate,
  // not-yet-authorized future capability -- not registered here.
  Object.freeze({
    id: "inventory.transfer.create",
    description: "Create a governed Transfer Order between two active WAREHOUSE/MOBILE(truck) inventory locations (trusted Transfer service).",
    resource: "inventory.transfer",
    action: "create",
    active: false,
  }),
  Object.freeze({
    id: "inventory.transfer.dispatch",
    description: "Dispatch a REQUESTED Transfer Order (stage TRANSFER_OUT ledger effect(s), REQUESTED -> IN_TRANSIT).",
    resource: "inventory.transfer",
    action: "dispatch",
    active: false,
  }),
  Object.freeze({
    id: "inventory.transfer.receive",
    description: "Receive an IN_TRANSIT Transfer Order at its destination (stage TRANSFER_IN ledger effect(s), IN_TRANSIT -> COMPLETED).",
    resource: "inventory.transfer",
    action: "receive",
    active: false,
  }),
  Object.freeze({
    id: "inventory.transfer.cancel",
    description: "Cancel a REQUESTED Transfer Order before any movement has been dispatched (REQUESTED -> CANCELLED).",
    resource: "inventory.transfer",
    action: "cancel",
    active: false,
  }),
  // Enterprise Inventory -- Cycle Count operating authority (functions/src/cycleCount/*). Re-audited the
  // location-aware operational ledger PR #1032 made live for Transfer sufficiency and reused the SAME
  // authority as Cycle Count's expected-quantity source (never a second manually maintained on-hand
  // number). REGISTERED BUT UNGRANTED by design -- no compatibility/default/operational Role holds any
  // of these four ids, no claims initializer/migration/fixture mints them, and there is no superuser/
  // wildcard bypass, so resolveEffectivePermission() denies `noQualifyingGrant` for every principal until
  // a later, separately-authorized grant gate. Same ungranted posture as inventory.transfer.* at its own
  // introduction.
  Object.freeze({
    id: "inventory.cycleCount.create",
    description: "Create a governed Cycle Count at an active WAREHOUSE/MOBILE(truck) inventory location, snapshotting expected quantity/serials from the ledger/registry authority (trusted Cycle Count service).",
    resource: "inventory.cycleCount",
    action: "create",
    active: false,
  }),
  Object.freeze({
    id: "inventory.cycleCount.submit",
    description: "Record the counted quantity/serials for an OPEN Cycle Count and compute variance evidence (OPEN -> COUNTED).",
    resource: "inventory.cycleCount",
    action: "submit",
    active: false,
  }),
  Object.freeze({
    id: "inventory.cycleCount.reconcile",
    description: "Reconcile a COUNTED Cycle Count's variance by staging ADJUSTED ledger evidence (COUNTED -> RECONCILED); requires a reason on non-zero variance.",
    resource: "inventory.cycleCount",
    action: "reconcile",
    active: false,
  }),
  Object.freeze({
    id: "inventory.cycleCount.cancel",
    description: "Cancel an OPEN Cycle Count before any count has been submitted (OPEN -> CANCELLED).",
    resource: "inventory.cycleCount",
    action: "cancel",
    active: false,
  }),
  // D4 -- Part-Equipment Compatibility trusted persistence (design package
  // docs/implementation-plans/equipment-compatibility-d4-trusted-persistence.md sec5).
  // REGISTERED BUT NOT GRANTABLE: every entry is `active: false`, so
  // resolveEffectivePermission() denies unconditionally ahead of any Role
  // check. D4 creates no Role, no grant and no client Rules path -- the
  // five governed collections are client-closed (sec7). Activation is a
  // later, separately authorized decision; declaring an id here changes
  // no runtime authorization behavior.
  Object.freeze({
    id: "equipment.compatibility.view",
    description: "Read Part-Equipment compatibility relationships (future read service; no client read exists in D4).",
    resource: "equipment.compatibility",
    action: "view",
    active: false,
  }),
  Object.freeze({
    id: "equipment.compatibility.import",
    description: "Import Part-Equipment compatibility relationships and evidence (trusted Equipment command service).",
    resource: "equipment.compatibility",
    action: "import",
    active: false,
  }),
  Object.freeze({
    id: "equipment.compatibility.verify",
    description: "Change the verification status of a Part-Equipment compatibility relationship (trusted Equipment command service).",
    resource: "equipment.compatibility",
    action: "verify",
    active: false,
  }),
  Object.freeze({
    id: "equipment.compatibility.correct",
    description: "Correct a governed Part-Equipment compatibility relationship (trusted Equipment command service).",
    resource: "equipment.compatibility",
    action: "correct",
    active: false,
  }),
  Object.freeze({
    id: "equipment.model.manage",
    description: "Create and edit canonical Equipment Model records and their aliases (trusted Equipment command service).",
    resource: "equipment.model",
    action: "manage",
    active: false,
  }),
  // EQUIPMENT INSTALLATION (serialized asset -> customer-installed Equipment). The authority the
  // Serialized Asset contract calls "§H's job", and records as not built.
  //
  // WHY IT IS ITS OWN CAPABILITY. Installation is the moment a company-owned unit becomes a
  // customer's equipment: it creates a customer-scoped record whose accountId and locationId are
  // immutable ever after. Nothing existing means that. Receiving accepts stock into custody,
  // transfer moves it between company locations, put-away places it on a shelf -- none of them
  // hands anything to a customer, and reusing one of them would put an irreversible customer
  // assignment behind an authority whose meaning is internal movement.
  //
  // Registered active:false, fail-closed, and granted to NO Role here. Declaring a capability
  // grants nothing; who may install is a separate Owner decision.
  Object.freeze({
    id: "equipment.install",
    description: "Install a company-held serialized asset as customer Equipment: creates the Equipment record and links the asset to it (trusted installSerializedAsset command). Irreversible under the current model -- Equipment accountId/locationId are immutable after create.",
    resource: "equipment",
    action: "install",
    active: false,
  }),
  // CRM Activity / Notes (Taylor EOS Wave 7 extension, PART 1.4) -- the SMALLEST domain-correct CRM
  // interaction authority. Create a governed, immutable-identity account-scoped activity/note record
  // (Sales Note / Call / Meeting / Relationship / General) via the trusted createCrmActivity command
  // (functions/src/crmActivity/crmActivityCallables.ts). Registered active:false (fail-closed) and NOT
  // granted to any Role -- hard DENY for everyone until a separate Owner grant AND per-environment
  // activation. Does NOT expand account.notes (the existing single free-text blob); does NOT carry an
  // assignee/due date/completion state (that is PART 1.5's separate, not-yet-authorized seam).
  Object.freeze({
    id: "crm.activity.create",
    description:
      "Create a governed CRM Activity/Note (Sales Note, Call, Meeting, Relationship, or General) scoped to an Account, optionally referencing a Contact/Opportunity/Sales Order by id. Immutable identity; no assignee, due date, or completion state.",
    resource: "crm.activity",
    action: "create",
    active: false,
  }),
  // CRM Activity / Notes read -- the account-scoped timeline read for the ActivityAndNotesSection UX,
  // mirroring the salesOrder.read / finance.read trusted-read precedent exactly: a minimal projection via
  // the trusted getCrmActivities read service (functions/src/crmActivity/crmActivityReadService.ts), never
  // a client-direct crm_activities Rules widening. Registered active:false (fail-closed) until a separate
  // grant + per-environment activation.
  Object.freeze({
    id: "crm.activity.read",
    description:
      "Read the minimal governed CRM Activity projection (type, body, occurredAt/createdAt, actor, linked Account/Contact/Opportunity/Sales Order ids) for one Account via the trusted getCrmActivities read service. Backend-resolved scope; no client-direct crm_activities read.",
    resource: "crm.activity",
    action: "read",
    active: false,
  }),
  // Coordinated Operations fidelity fix (2026-08-15): the trusted read backing `Coordinated Visits`
  // (Service/Dispatch) and `Coordinated Mission` (Technician) -- functions/src/fulfillment/
  // coordinatedVisitReadService.ts. Serves the TWO ALREADY-EXISTING pure projections
  // (coordinatedVisit.ts / coordinatedFieldMission.ts) from real fieldops_wos data; no new coordination
  // model, no new Job/Visit/WorkOrderGroup authority. REGISTERED BUT UNGRANTED BY DESIGN: this phase grants
  // the capability to NO compatibility Role and adds NO per-environment activation override, so
  // resolveEffectivePermission() denies for every principal until a later, separately authorized grant +
  // activation gate -- same posture as inventory.serializedAsset.read's own introduction.
  Object.freeze({
    id: "fulfillment.coordinatedVisit.read",
    description:
      "Read the minimal governed coordinated-Work-Order projection (id, woNumber, status, customerId, locationId, salesOrderId, salesOrderLineRefs) for active Work Orders that carry a salesOrderId, via the trusted listCoordinatedOperations read service. Backend-resolved scope; no client-direct fieldops_wos read.",
    resource: "fulfillment.coordinatedVisit",
    action: "read",
    active: false,
  }),
  // Sandbox-fidelity package PART 11A (2026-08-15): the trusted location-DISPLAY resolver backing
  // Available Equipment's location column (functions/src/inventoryLocation/locationDisplayReadService.ts).
  // PR #1029 left location display BLOCKED because the governed Serialized Asset read returns only the
  // scalar `currentLocationId`; this resolves id -> { type, label } for WAREHOUSE (warehouses/{id}.name)
  // and MOBILE (mobile_locations/{id}.displayLabel) ONLY -- CUSTOMER and any other category resolve to
  // UNRESOLVED (label null), never a fabricated type. Bounded point-reads only (getAll on the exact
  // requested ids, capped at 50) -- no collection scan, no new index, no client-direct warehouses
  // widening, and no client-direct mobile_locations widening introduced here. (Corrected 2026-08-17:
  // this previously said mobile_locations has no Rules match block and is default-deny.
  // firestore.rules:1235-1238 grants admin/dispatcher read on it and denies all client writes.)
  // REGISTERED BUT UNGRANTED BY DESIGN: this phase grants the capability to NO compatibility Role and
  // adds NO per-environment activation override, so resolveEffectivePermission() denies for every
  // principal until a later, separately authorized grant + activation gate -- same posture as
  // inventory.serializedAsset.read's own introduction.
  Object.freeze({
    id: "inventory.location.display.read",
    description:
      "Read the minimal governed location-display projection ({ locationId, type, label }) for a bounded set of location ids (WAREHOUSE via warehouses/{id}.name, MOBILE via mobile_locations/{id}.displayLabel; any other category resolves UNRESOLVED) via the trusted getLocationDisplay read service. Backend-resolved scope; no client-direct warehouses widening; no client-direct mobile_locations read.",
    resource: "inventory.location.display",
    action: "read",
    active: false,
  }),

  // PERFORMANCE GOAL AUTHORITY (performance/performanceGoalAuthority.ts) -- the five verbs of the
  // governed TARGET authority. A goal is a versioned, effective-dated, approved TARGET; the ACTUAL
  // stays with the domain that owns it, and these ids confer no reach over any actual whatsoever.
  //
  // WRITE AND APPROVAL ARE SEPARATE IDS, DELIBERATELY. This repository separates authoring from
  // approving wherever a governance event exists (FIN-007's unconditional self-approval prohibition,
  // the privileged two-person role-approval path), and collapsing them here would let one person set
  // and bless their own team's numbers in a single act.
  //
  // SUPERSEDE IS ITS OWN ID, not a synonym for create. Superseding has an effect create does not: it
  // CLOSES a predecessor version's effective window. That is the operation that could rewrite
  // history if done wrongly, so it is separately grantable and separately auditable.
  //
  // HOLDING ONE OF THESE IS NOT REACH. Every act additionally resolves the capability AT THE GOAL'S
  // OWN TARGET SCOPE, requires authority over the metric's own actual where an enumerated capability
  // exists for it, and -- for an EMPLOYEE-scoped goal -- requires the subject to be inside the
  // actor's governed hierarchical visibility. Holding a manager title alone widens nothing.
  //
  // All five registered active:false.
  //
  // "REGISTER != GRANT" HOLDS FOR EVERY ROLE EXCEPT ONE, and the exception is worth knowing before
  // reading the grant table as the whole story: by Owner ruling (2026-08-19) admin's permission set
  // is DERIVED as ADMIN_CURATED_PERMISSIONS plus the entire PERMISSION_CATALOG, so a capability
  // becomes admin's -- and owner's, which composes admin's set -- THE MOMENT IT IS REGISTERED HERE.
  // Registering these five therefore granted them to admin and owner as a side effect, without
  // appearing as a literal in any Role source. That derivation is exactly what defeated the
  // dashboard census's grep-based FIN-004 measurement (#1743), so it is stated here rather than
  // left to be rediscovered the same way.
  //
  // REGISTER != ACTIVATE still holds without exception: an id registered active:false resolves DENY
  // inactivePermission for admin too, in every environment, until an environment activates it.
  Object.freeze({
    id: "performance.goal.read",
    description:
      "Read governed performance goals (targets) at the caller's authorized scope. Reads targets only -- it confers no reach over any metric's ACTUAL, which stays governed by that metric's own domain authority.",
    resource: "performance.goal",
    action: "read",
    active: false,
  }),
  Object.freeze({
    id: "performance.goal.create",
    description:
      "Author a DRAFT performance goal version. Authoring is not approving: a DRAFT is never a measurement authority and is never compared against. An employee may not author their own target.",
    resource: "performance.goal",
    action: "create",
    active: false,
  }),
  Object.freeze({
    id: "performance.goal.approve",
    description:
      "Approve a DRAFT performance goal version, making it the target in force for its effective window. Self-approval is forbidden unconditionally (FIN-007) -- the author of a version may never be its approver, under any policy.",
    resource: "performance.goal",
    action: "approve",
    active: false,
  }),
  Object.freeze({
    id: "performance.goal.supersede",
    description:
      "Replace an APPROVED goal version with a later one, closing the predecessor's effective window. Separate from create because this is the only operation that alters an existing version's window -- a September target must remain September's target after October's target changes.",
    resource: "performance.goal",
    action: "supersede",
    active: false,
  }),
  Object.freeze({
    id: "performance.goal.retire",
    description:
      "Withdraw an APPROVED goal with no successor. Distinct from supersede: 'we changed the number' and 'we stopped measuring this' are different facts, and a retired goal must not appear to have a successor nobody can find.",
    resource: "performance.goal",
    action: "retire",
    active: false,
  }),
]) as readonly Permission[];

export function isValidPermissionId(id: string): boolean {
  return PERMISSION_ID_PATTERN.test(id);
}

export function findPermission(id: string): Permission | undefined {
  return PERMISSION_CATALOG.find((permission) => permission.id === id);
}

// Fail-closed helper (Spec §13): callers that need to assert a
// permission id is real should use this rather than trusting an
// unchecked string -- an unknown id is never silently treated as valid.
export function requirePermission(id: string): Permission {
  const permission = findPermission(id);
  if (!permission) {
    throw new Error(`Unknown PermissionId: "${id}"`);
  }
  return permission;
}

// Issue #325 / ADR-007 D-226 -- shape-only validators (no catalog
// lookup) for the report.* capability class. `isValidPermissionId`
// above already accepts both shapes (they satisfy the generic
// "<domain>.<resource>.<action>"+ pattern); these exist so a caller
// authoring or validating a `report.*` id -- e.g. a future Reporting-
// lane catalog-authoring script -- gets a check narrower than the
// generic one, with "malformed" as its own distinguishable outcome
// from "not shaped like a report id at all".
export function isValidReportObjectReadCapabilityId(id: string): boolean {
  return REPORT_OBJECT_READ_CAPABILITY_PATTERN.test(id);
}

export function isValidReportFieldReadCapabilityId(id: string): boolean {
  return REPORT_FIELD_READ_CAPABILITY_PATTERN.test(id);
}

export function isValidReportDefinitionCapabilityId(id: string): boolean {
  return REPORT_DEFINITION_CAPABILITY_PATTERN.test(id);
}

// Fail-closed helper (ADR-007 §2.6 / Spec §4-§5's "denied by default
// until dedicated security review" sensitive-field posture): true only
// for a REGISTERED (found in the catalog) capability whose `active`
// flag is not explicitly `false`. An unregistered id is never "active"
// -- this is not a substitute for `findPermission`, it is stricter.
// resolveEffectivePermission() (resolveEffectivePermission.ts) enforces
// this same rule as an unconditional gate ahead of any Role-grant
// check; this export exists for callers (tests, future catalog
// tooling) that want the same answer without invoking the full resolver.
export function isActivePermission(id: string): boolean {
  const permission = findPermission(id);
  return !!permission && permission.active !== false;
}
