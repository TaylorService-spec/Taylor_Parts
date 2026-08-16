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
// Mirrored (not imported -- no shared/monorepo tooling exists in this
// repo) at functions/src/access/permissionCatalog.ts. If either file
// changes, change the other to match.
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
    id: "account.record.read",
    description: "Read a Customer/Account record.",
    resource: "account.record",
    action: "read",
  }),
  Object.freeze({
    id: "account.record.create",
    description: "Create a Customer/Account record.",
    resource: "account.record",
    action: "create",
  }),
  Object.freeze({
    id: "account.record.update",
    description: "Edit a Customer/Account record's non-governed fields.",
    resource: "account.record",
    action: "update",
  }),
  Object.freeze({
    id: "account.governedField.write",
    description:
      "Edit an Account's governed commercial fields (paymentTerms/taxStatus) -- Issue #175, admin-only today.",
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
  // a SEPARATE Owner grant through the Persona/Permissions architecture. A capability, NOT a role check --
  // it answers only "may this actor author/change planned parts". PLAN != RESERVE != USE.
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
  // SEPARATE Owner grant. A capability, NOT a role check. Opportunity is PRE-COMMITMENT: it never creates
  // inventory movement, Work Orders, or invoices, and its lines are product-level (never a serialized asset).
  Object.freeze({
    id: "opportunity.write",
    description:
      "Create or advance a Sales Opportunity (lifecycle transition) via the governed opportunity command. Pre-commitment only; does not create Work Orders, inventory movement, or invoices.",
    resource: "opportunity",
    action: "write",
    active: false,
  }),
  // Sales Opportunity Cycle 3c -- read authorization for the TRUSTED MINIMAL read projection
  // (listOpportunityContext), registered active:false. Backend-resolved scope; no client-direct collection read.
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
  // Sales Order Cycle 4 -- creating/advancing a committed Sales Order via the governed salesOrder command,
  // registered active:false. Committed commercial order following a WON Opportunity.
  Object.freeze({
    id: "salesOrder.write",
    description:
      "Create or advance a committed Sales Order (lifecycle transition) via the governed salesOrder command. Does not assign serialized assets, write Work Orders, or move inventory.",
    resource: "salesOrder",
    action: "write",
    active: false,
  }),
  // Fulfillment Cycle 5 -- allocate a committed Sales Order against authoritative inventory availability,
  // registered active:false. Records allocation only on the Sales Order.
  Object.freeze({
    id: "salesOrder.fulfill",
    description:
      "Allocate a committed Sales Order against authoritative inventory availability via the governed allocateSalesOrder command. Records allocation only on the Sales Order; does not write the inventory ledger or Equipment authority.",
    resource: "salesOrder",
    action: "fulfill",
    active: false,
  }),
  // Sales Order Cycle 7 -- create governed Service demand (a Work Order via the governed Work Order authority)
  // for a Sales Order with demand lineage, registered active:false. SO never writes WO state/assignment/schedule.
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
      "Read the minimal Finance AR projection (invoice + derived AR position) for an account via the trusted listAccountInvoiceAr callable. Backend read only; the client never reads invoices/payments/adjustments directly.",
    resource: "finance",
    action: "read",
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
    description: "Read a stock_locations record (bin-level quantity within a warehouse).",
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
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.name.read",
    description: "Report field-read: customer.name.",
    resource: "report.customer.field.name",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.status.read",
    description: "Report field-read: customer.status.",
    resource: "report.customer.field.status",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.relationshipTypes.read",
    description: "Report field-read: customer.relationshipTypes.",
    resource: "report.customer.field.relationshipTypes",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.billingAddress.read",
    description:
      "Report field-read: customer.billingAddress (street/city/state/zip -- one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.billingAddress",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.tags.read",
    description: "Report field-read: customer.tags.",
    resource: "report.customer.field.tags",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.externalIds.read",
    description:
      "Report field-read: customer.customerNumber/erpId/accountingId/legacyId (one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.externalIds",
    action: "read",
    active: true,
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
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.paymentTerms.read",
    description: "Report field-read: customer.paymentTerms -- governed (Rules admin-only write, Issue #175).",
    resource: "report.customer.field.paymentTerms",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.taxStatus.read",
    description: "Report field-read: customer.taxStatus -- governed (Rules admin-only write, Issue #175).",
    resource: "report.customer.field.taxStatus",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.commercialProfile.read",
    description:
      "Report field-read: customer.defaultCurrency/purchaseOrderRequired/invoiceDeliveryMethod (one capability, grouped per Spec §5.1).",
    resource: "report.customer.field.commercialProfile",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.customer.field.billingContact.read",
    description: "Report field-read: customer.billingContact (reference -> contact).",
    resource: "report.customer.field.billingContact",
    action: "read",
    active: true,
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
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.name.read",
    description: "Report field-read: contact.name.",
    resource: "report.contact.field.name",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.email.read",
    description: "Report field-read: contact.email.",
    resource: "report.contact.field.email",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.phone.read",
    description: "Report field-read: contact.phone.",
    resource: "report.contact.field.phone",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.role.read",
    description: "Report field-read: contact.role.",
    resource: "report.contact.field.role",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.contact.field.customer.read",
    description: "Report field-read: contact.accountId (reference -> customer).",
    resource: "report.contact.field.customer",
    action: "read",
    active: true,
  }),

  Object.freeze({
    id: "report.location.read",
    description: "Object-level read gate for reporting on Location records.",
    resource: "report.location",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.location.field.name.read",
    description: "Report field-read: location.name.",
    resource: "report.location.field.name",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.location.field.address.read",
    description:
      "Report field-read: location.address.street/city/state/zip (one capability, grouped per Spec §5.3).",
    resource: "report.location.field.address",
    action: "read",
    active: true,
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
    active: true,
  }),

  Object.freeze({
    id: "report.equipment.read",
    description: "Object-level read gate for reporting on Equipment records.",
    resource: "report.equipment",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.name.read",
    description: "Report field-read: equipment.name.",
    resource: "report.equipment.field.name",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.status.read",
    description: "Report field-read: equipment.status.",
    resource: "report.equipment.field.status",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.identity.read",
    description:
      "Report field-read: equipment.manufacturer/model/serialNumber/assetTag (one capability, grouped per Spec §5.4).",
    resource: "report.equipment.field.identity",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.dates.read",
    description: "Report field-read: equipment.installedDate/warrantyExpiresDate (one capability, grouped per Spec §5.4).",
    resource: "report.equipment.field.dates",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.notes.read",
    description: "Report field-read: equipment.notes -- standard (not security-text; distinct from customer/location notes, Spec §5.4).",
    resource: "report.equipment.field.notes",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.customer.read",
    description: "Report field-read: equipment.accountId (reference -> customer).",
    resource: "report.equipment.field.customer",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.location.read",
    description: "Report field-read: equipment.locationId (reference -> location).",
    resource: "report.equipment.field.location",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.equipment.field.createdAt.read",
    description: "Report field-read: equipment.createdAt.",
    resource: "report.equipment.field.createdAt",
    action: "read",
    active: true,
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
    active: true,
  }),
  Object.freeze({
    id: "report.definition.read",
    description: "Read (get one or list one's own) saved report definitions (trusted saved-definition service).",
    resource: "report.definition",
    action: "read",
    active: true,
  }),
  Object.freeze({
    id: "report.definition.rename",
    description: "Rename one's own saved report definition (trusted saved-definition service).",
    resource: "report.definition",
    action: "rename",
    active: true,
  }),
  Object.freeze({
    id: "report.definition.duplicate",
    description: "Duplicate one's own saved report definition (trusted saved-definition service).",
    resource: "report.definition",
    action: "duplicate",
    active: true,
  }),
  Object.freeze({
    id: "report.definition.delete",
    description: "Delete one's own saved report definition (trusted saved-definition service).",
    resource: "report.definition",
    action: "delete",
    active: true,
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
  // EI Phase-2 Receiving (Phase C): the trusted receiveInventoryStock command's capability.
  // REGISTERED BUT UNGRANTED by design -- no compatibility/default/operational Role holds it, no
  // claims initializer/migration/fixture mints it, and there is no superuser/wildcard bypass, so
  // resolveEffectivePermission() denies `noQualifyingGrant` for every principal until a later,
  // separately-authorized grant gate. The trusted command's authorization is an injected seam;
  // nothing invokes it in production. Same ungranted posture as the inventory.catalog.* entries above.
  Object.freeze({
    id: "inventory.stock.receive",
    description: "Receive inbound stock into an inventory location against a reorder purchase order (trusted Receiving service).",
    resource: "inventory.stock",
    action: "receive",
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
