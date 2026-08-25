import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";

// Sales Agreement — the commercial commitment between an Opportunity and a Sales Order.
//
// ════════════════════ WHY THIS ENTITY EXISTS ════════════════════
//
// Nothing owned commitment. An Opportunity carries `expectedValue` — one forecast number on the
// header — and lines of `{ kind, ref, qty }` with no price at all, so WON → Sales Order produced
// orders with no committed pricing. That is where the seven unpriced CONFIRMED records came from,
// and why an order could be confirmed and then refused by invoicing.
//
// The Taylor signed Sales & Security Agreement is that missing authority written on paper: buyer,
// site, PO, lease, ship-via, deliver/install, line pricing, warranty, trade-in, down payment,
// balance, and a signature. This describes it.
//
// ════════════════════ READ IS A TRUSTED CALLABLE ════════════════════
//
// `sales_agreements` is an explicit deny-all in firestore.rules — read AND write. Opening client
// reads would have made this UI simpler and would have put committed pricing, charges and trade-in
// values in front of every authenticated principal, scoped by nothing.
//
// `readCallable` names getSalesAgreementForOpportunity rather than the by-id read, matching the
// choice salesOrder.js and opportunity.js already made: the entry point a person actually uses is
// the one that answers "is there an agreement for this negotiation yet", because that question
// decides between offering CREATE and offering VIEW.
//
// ════════════════════ IDENTITY ════════════════════
//
// salesAgreementNumber (SA-YYYY-######) is server-allocated at creation and immutable. There is no
// human-entered name — declaring one to satisfy the identity contract would be inventing data
// rather than describing it. The format is DERIVED from the convention every other business
// reference in this repo already follows (OPP-, SO-, WO-, RO-, TO-, RR-), not chosen.
//
// ════════════════════ MONEY ════════════════════
//
// Every amount is INTEGER MINOR UNITS, and every one is nullable. `totalMinor` is null while any
// line is unpriced — NULL IS NOT ZERO, and a partial sum presented as a total is a real number that
// is not what the customer would be committing to. `taxMinor` is INJECTED, never computed: no tax
// engine exists here and none is invented.

export const salesAgreementEntity = makeEntityDefinition({
  id: "salesAgreement",
  label: "Sales Agreement",
  labelPlural: "Sales Agreements",
  collection: "sales_agreements",
  readVia: "CALLABLE",
  readCallable: "getSalesAgreementForOpportunity",
  readCapability: "salesAgreement.read",
  identity: makeIdentity({ referenceField: "salesAgreementNumber" }),
  description:
    "The accepted commercial commitment: what was sold, at what price, on what terms. Deny-all in Rules; read only through governed callables, written only through create/updateDraft/accept.",
  fields: [
    makeFieldDefinition({
      id: "salesAgreementNumber",
      entityId: "salesAgreement",
      label: "Agreement",
      type: "STRING",
      sortable: true,
      description: "SA-YYYY-######, server-allocated at creation and immutable. The displayed identity — never the document id (DECISIONS #106).",
    }),
    makeFieldDefinition({
      id: "state",
      entityId: "salesAgreement",
      label: "State",
      type: "ENUM",
      enumValues: ["DRAFT", "ACCEPTED", "DECLINED"],
      enumLabels: { DRAFT: "Draft", ACCEPTED: "Accepted", DECLINED: "Declined" },
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description: "DRAFT terms are still being negotiated. ACCEPTED and DECLINED are terminal — an accepted commitment cannot be un-accepted, because the prices a Sales Order was created from must not move underneath it.",
    }),
    makeFieldDefinition({
      id: "accountId",
      entityId: "salesAgreement",
      label: "Customer",
      type: "REFERENCE",
      referenceTo: "account",
      description: "SERVER-DERIVED from the source Opportunity at creation, never client-supplied. Immutable thereafter — an agreement that could change customer is a different agreement wearing the same number.",
    }),
    makeFieldDefinition({
      id: "locationId",
      entityId: "salesAgreement",
      label: "Location",
      type: "REFERENCE",
      referenceTo: "location",
      description: "Where the sale is delivered or installed. Optional in storage — not every agreement names one.",
    }),
    makeFieldDefinition({
      id: "ownerEmployeeId",
      entityId: "salesAgreement",
      label: "Salesperson",
      type: "REFERENCE",
      referenceTo: "employee",
      description: "The canonical Employee who owns the commitment.",
    }),
    makeFieldDefinition({
      id: "totalMinor",
      entityId: "salesAgreement",
      label: "Total",
      type: "CURRENCY_MINOR",
      description: "Integer minor units. NULL while any line is unpriced — a partial sum presented as a total is a real number that is not what the customer would be committing to, and somebody would sign it.",
    }),
    makeFieldDefinition({
      id: "subtotalMinor",
      entityId: "salesAgreement",
      label: "Subtotal",
      type: "CURRENCY_MINOR",
      description: "The lines' own arithmetic, integer minor units. Null while any line is unpriced.",
    }),
    makeFieldDefinition({
      id: "shippingMinor",
      entityId: "salesAgreement",
      label: "Shipping",
      type: "CURRENCY_MINOR",
      description: "Injected charge, integer minor units. Zero is a real amount — a waived charge is a commercial act.",
    }),
    makeFieldDefinition({
      id: "installChargeMinor",
      entityId: "salesAgreement",
      label: "Install Charge",
      type: "CURRENCY_MINOR",
      description: "Injected charge, integer minor units.",
    }),
    makeFieldDefinition({
      id: "taxMinor",
      entityId: "salesAgreement",
      label: "Tax",
      type: "CURRENCY_MINOR",
      description: "INJECTED, never computed. No tax determination exists on this surface and none is invented — the number supplied is the number carried.",
    }),
    makeFieldDefinition({
      id: "downPaymentMinor",
      entityId: "salesAgreement",
      label: "Down Payment",
      type: "CURRENCY_MINOR",
      description: "Integer minor units.",
    }),
    makeFieldDefinition({
      id: "tradeInMinor",
      entityId: "salesAgreement",
      label: "Trade-In",
      type: "CURRENCY_MINOR",
      description: "Integer minor units.",
    }),
    makeFieldDefinition({
      id: "balanceMinor",
      entityId: "salesAgreement",
      label: "Balance Due",
      type: "CURRENCY_MINOR",
      description: "Total less down payment and trade-in, integer minor units. Null when the total is.",
    }),
    makeFieldDefinition({
      id: "currency",
      entityId: "salesAgreement",
      label: "Currency",
      type: "STRING",
      description: "Server-set, single-currency, matching the Sales Order header so a committed price survives into billing without a conversion nobody authorised.",
    }),
    makeFieldDefinition({
      id: "customerPO",
      entityId: "salesAgreement",
      label: "Customer PO",
      type: "STRING",
      description: "The customer's own purchase-order reference. Travels to the Sales Order because it appears on the pick ticket and the invoice.",
    }),
    makeFieldDefinition({
      id: "isLease",
      entityId: "salesAgreement",
      label: "Lease",
      type: "BOOLEAN",
      description: "A financing arrangement. Commercial, not operational — it changes nothing a warehouse does, so it stays on the agreement rather than travelling to the order.",
    }),
    makeFieldDefinition({
      id: "fulfillmentIntent",
      entityId: "salesAgreement",
      label: "Fulfillment",
      type: "ENUM",
      enumValues: ["DELIVER", "INSTALL", "BOTH"],
      enumLabels: { DELIVER: "Deliver", INSTALL: "Install", BOTH: "Deliver and install" },
      description: "What the customer is buying the delivery of, from the paper form's deliver/install box. A COMMERCIAL commitment, not a dispatch instruction — the install Work Order carries it out.",
    }),
    makeFieldDefinition({
      id: "shipVia",
      entityId: "salesAgreement",
      label: "Ship Via",
      type: "STRING",
      description: "How it travels. Operational, and deliberately not yet snapshotted onto the Sales Order — there is no shipment object to act on it.",
    }),
    makeFieldDefinition({
      id: "shippingInstructions",
      entityId: "salesAgreement",
      label: "Shipping Instructions",
      type: "STRING",
    }),
    makeFieldDefinition({
      id: "specialInstructions",
      entityId: "salesAgreement",
      label: "Special Instructions",
      type: "STRING",
      description: "The one commercial note with an operational consumer — it becomes the Sales Order's notes, which is what a person reads before acting on the order.",
    }),
    makeFieldDefinition({
      id: "sourceOpportunityId",
      entityId: "salesAgreement",
      label: "Source Opportunity",
      type: "REFERENCE",
      referenceTo: "opportunity",
      description: "Which negotiation this came from. Immutable — repointing it would silently rewrite lineage a Sales Order may already depend on.",
    }),
    makeFieldDefinition({
      id: "salesOrderId",
      entityId: "salesAgreement",
      label: "Sales Order",
      type: "REFERENCE",
      referenceTo: "salesOrder",
      description: "Which order this commitment became. Written by the conversion in the same commit as the order, so it can never name one that was not created. Null until then — the honest 'not converted yet'.",
    }),
    makeFieldDefinition({
      id: "acceptedAtMillis",
      entityId: "salesAgreement",
      label: "Accepted",
      type: "DATE",
      description: "Server-stamped at acceptance. Not reachable from any client input — a caller who could set it could record an acceptance on a date of its choosing.",
    }),
    makeFieldDefinition({
      id: "acceptedByUid",
      entityId: "salesAgreement",
      label: "Accepted By",
      type: "STRING",
      description: "From request.auth at acceptance, never from the payload.",
    }),
  ],
  listViews: [],
});
