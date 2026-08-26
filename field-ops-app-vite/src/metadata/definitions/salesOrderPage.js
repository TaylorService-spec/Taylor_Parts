import { makePageDefinition, makeSection } from "../pageDefinition.js";

// THE SALES ORDER RECORD PAGE — READ-ONLY BY DERIVATION, NOT BY PREFERENCE.
//
// ════════════════════ WHY THERE ARE NO PENCILS HERE ════════════════════
//
// There is no field-update command for a Sales Order. Every write in this domain is a governed
// ACTION with its own capability and its own state guard:
//
//     allocateSalesOrder        capability salesOrder.fulfill, state CONFIRMED|IN_FULFILLMENT
//     createServiceForSalesOrder ...
//     advance / cancel          lifecycle transitions with their own preconditions
//
// `editableFieldIds` is therefore EMPTY, and that is a derived fact rather than a policy: nothing
// this page could call would accept a field patch. Converting action-based authority into pencils
// would mean inventing a command, which is exactly what this page must not do.
//
// The actions stay where they already are (SalesOrderActions.jsx), unchanged.
//
// ════════════════════ MONEY ════════════════════
//
// `totalMinor` is the sale's own money, projected server-side by salesOrderReadService and
// authoritative: invoiceCommands snapshots each line's unitPrice as unitPriceMinor, refuses to bill
// a line without one, and refuses any invoice price that disagrees with it.
//
// It is NULL on a partly-priced order, and the renderer shows an em dash rather than a number. That
// is the whole point: a sum over the priced lines would be a real figure that is not the sale's
// total, and somebody would act on it. NULL IS NOT ZERO.
//
// It sits in SUMMARY because "what is this sale worth" is one of the four questions the first
// viewport exists to answer.

export const salesOrderRecordPage = makePageDefinition({
  id: "salesOrder.record",
  entityId: "salesOrder",
  label: "Sales Order",
  // No command accepts a field patch on this object. See the header.
  writeCommand: null,
  editableFieldIds: [],
  sections: [
    makeSection({
      id: "salesOrderIdentity",
      kind: "FIELD_GROUP",
      region: "HEADER",
      order: 0,
      label: "Overview",
      density: "SUMMARY",
      // What it is, what state it is in, whose it is, what it is worth.
      fieldIds: ["salesOrderNumber", "state", "accountId", "totalMinor"],
    }),
    makeSection({
      id: "salesOrderCommercial",
      kind: "FIELD_GROUP",
      region: "MAIN",
      order: 0,
      label: "Order Details",
      density: "DETAILS",
      fieldIds: ["salesChannel", "customerPO", "locationId", "ownerEmployeeId"],
    }),
    makeSection({
      id: "salesOrderOrigin",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 0,
      label: "Origin & Notes",
      density: "SECONDARY",
      // sourceOpportunityNumber is DELIBERATELY ABSENT and is not missing from the page: the
      // ContextBand renders it as a LINK into the originating Opportunity, which a field grid
      // cannot do. Declaring it here as well would print the reference twice, once inert.
      //
      // sourceOpportunityId is absent for a different reason -- it is the routing key behind that
      // link, never content. The NUMBER is its business label, and DECISIONS #106 is exactly the
      // rule that a missing reference is not permission to display a document id.
      fieldIds: ["currency", "notes"],
    }),
  ],
});

/**
 * The fields the North Star composition leaves to the RAIL.
 *
 * ════════════════════ WHY A SUBSET RATHER THAN THE WHOLE PAGE ════════════════════
 *
 * NS-P4 is one fact, one rendering. The composed record header already states the customer, the
 * owner, the channel and the money as identity — so a field grid that ALSO prints salesChannel and
 * ownerEmployeeId is the same fact rendered twice, in two treatments, free to disagree. That is the
 * exact defect the pilot audit found on the Work Order ("status appears four times in four
 * treatments"), and the Work Order answered it the same way: `workOrderRecordPageRailSubset`.
 *
 * Notes are excluded for a different reason. They are prose, not a field: the composition reads
 * them as sentences in their own ruled section, which a two-column grid cannot do.
 *
 * What is LEFT is what the header does not say and prose does not carry — where the order was
 * written, what the customer called it, and what currency it is denominated in.
 */
const RAIL_FIELDS = new Set(["locationId", "customerPO", "currency"]);

export const salesOrderRecordPageRailSubset = {
  ...salesOrderRecordPage,
  sections: salesOrderRecordPage.sections
    .map((s) => ({ ...s, fieldIds: (s.fieldIds ?? []).filter((f) => RAIL_FIELDS.has(f)) }))
    .filter((s) => (s.fieldIds ?? []).length > 0),
};
