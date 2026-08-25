import { makePageDefinition, makeSection } from "../pageDefinition.js";
import { salesAgreementEntity } from "./salesAgreement.js";

// THE SALES AGREEMENT RECORD PAGE.
//
// ════════════════════ EDITING IS BOUNDED, AND ONLY WHILE DRAFT ════════════════════
//
// `editableFieldIds` names exactly the fields the bounded updateSalesAgreementDraft command accepts
// — it is the SAME allowlist, restated on the surface that offers the pencils, and the page must
// never offer a pencil the command would refuse.
//
// Absent from it, deliberately: accountId and sourceOpportunityId (identity — an agreement that
// could change customer is a different agreement wearing the same number), salesAgreementNumber and
// currency (server-allocated, immutable), state / acceptedAt / acceptedBy (the ACCEPT command's,
// from server context), the totals (COMPUTED from the lines — a supplied total is a second answer
// to a question the lines already answer), and salesOrderId (written by the conversion).
//
// The DRAFT-only rule is enforced by the command, not by this page. A page that hid the pencils on
// an accepted agreement and a command that allowed the edit would be a UI convention, not a
// control; the command refuses, and the page follows.
//
// ════════════════════ ACCEPT IS NOT A PENCIL ════════════════════
//
// Owner §G: "Acceptance action must be visually distinct from ordinary editing. Do not use an edit
// pencil to represent ACCEPT."
//
// It is not in `editableFieldIds` and cannot be, because `state` is not a field a caller may write.
// Acceptance is a governed ACTION with its own capability (salesAgreement.accept), its own state
// guard, and its own irreversible consequence — it binds the business to these prices, and it
// cannot be undone. It lives in the page's action area (SalesAgreementActions.jsx), the same place
// the Sales Order's governed actions live, and never in the field grid.
//
// ════════════════════ DENSITY ════════════════════
//
// SUMMARY answers the four questions the first viewport exists to answer: what is this, what state
// is it in, whose is it, and what is it worth. The money lives here for the same reason it lives in
// the Sales Order's summary — "what is this sale worth" is not a detail.
//
// SYSTEM carries provenance and lineage: which negotiation this came from, which order it became,
// and who accepted it when. Collapsed by density, because a person opening an agreement is asking
// about the commitment, not about the audit trail — but present, because the chain is the point.

export const salesAgreementRecordPage = makePageDefinition({
  id: "salesAgreement.record",
  entityId: "salesAgreement",
  label: "Sales Agreement",
  writeCommand: "updateSalesAgreementDraft",
  // EXACTLY the bounded command's allowlist. See the header.
  editableFieldIds: [
    "locationId",
    "customerPO",
    "isLease",
    "fulfillmentIntent",
    "shippingInstructions",
    "shipVia",
    "specialInstructions",
    "shippingMinor",
    "installChargeMinor",
    "taxMinor",
    "downPaymentMinor",
    "tradeInMinor",
  ],
  sections: [
    makeSection({
      id: "salesAgreementIdentity",
      kind: "FIELD_GROUP",
      region: "HEADER",
      order: 0,
      label: "Overview",
      density: "SUMMARY",
      fieldIds: ["salesAgreementNumber", "state", "accountId", "locationId", "ownerEmployeeId", "totalMinor"],
    }),
    makeSection({
      id: "salesAgreementTerms",
      kind: "FIELD_GROUP",
      region: "MAIN",
      order: 0,
      label: "Commercial Terms",
      density: "DETAILS",
      fieldIds: ["customerPO", "isLease", "fulfillmentIntent", "shipVia", "shippingInstructions"],
    }),
    makeSection({
      id: "salesAgreementPricing",
      kind: "FIELD_GROUP",
      region: "MAIN",
      order: 1,
      label: "Pricing",
      density: "DETAILS",
      // Subtotal through balance, in the order the paper form works down the page: what the lines
      // come to, what is added, what is taken off, what is left to pay.
      fieldIds: [
        "subtotalMinor",
        "shippingMinor",
        "installChargeMinor",
        "taxMinor",
        "downPaymentMinor",
        "tradeInMinor",
        "balanceMinor",
        "currency",
      ],
    }),
    makeSection({
      id: "salesAgreementSecondary",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 0,
      label: "Instructions",
      density: "SECONDARY",
      // Per-line condition, warranty and estimated arrival are NOT here: they are properties of a
      // LINE, and flattening them onto the header would have to pick one line's answer and present
      // it as the agreement's. They render in the lines table, where they belong.
      fieldIds: ["specialInstructions"],
    }),
    makeSection({
      id: "salesAgreementProvenance",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 1,
      label: "Provenance",
      density: "SYSTEM",
      fieldIds: ["sourceOpportunityId", "salesOrderId", "acceptedAtMillis", "acceptedByUid"],
    }),
  ],
});

// THE PAGE NEEDS ITS ENTITY, AND NOTHING WAS HANDING IT OVER.
//
// MetadataRecordPage resolves field DEFINITIONS through a caller-supplied `entityResolver`, because
// a record page is rendered in contexts that own different slices of the metadata graph. Where no
// resolver is passed it has nothing to look fields up in, and every FIELD_GROUP section renders
// "Field details are unavailable — this section's entity is not registered."
//
// That is what a live sandbox user saw on SA-2026-000001: an accepted agreement worth $9,530.00
// whose Overview, Commercial Terms, Pricing, Instructions and Provenance sections were five
// identical apologies. The entity definition existed the whole time, fully specified, one import
// away. Nothing was broken -- nothing was connected.
//
// So the page ships its own resolver rather than depending on each mounting surface to remember.
// A record page that cannot render its own fields without an assist from its host is a page with a
// hidden prerequisite, and the missing-prerequisite state looks exactly like a permissions problem
// to the person reading it.
//
// Returns null for any other entityId -- this resolver speaks for the Sales Agreement and says so,
// rather than silently answering for entities it does not own.
export function salesAgreementEntityResolver(entityId) {
  return entityId === salesAgreementEntity.id ? salesAgreementEntity : null;
}
