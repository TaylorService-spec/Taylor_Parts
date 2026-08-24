import { makeSection, makePageDefinition } from "../pageDefinition.js";
import { opportunityRelatedList } from "./opportunity.js";
import { salesOrderRelatedList } from "./salesOrder.js";

// accountRecordPage — the Account record's PageDefinition.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §5, §6, §7, §8.
//
// DESCRIBES THE EXISTING SURFACE. This is not a redesign — it is
// `src/modules/accounts/AccountDetail.jsx` as it is actually composed today, read off
// section by section, in the order it renders. Where the live component holds data this
// layer cannot yet honestly describe (see GAPS below), the section is left out rather than
// forced into a shape that would misstate what is stored or what gates it.
//
// ─────────────────────────────────────────────────────────────────────────────
// DECISION: compositionMode = RECORD, not OPERATIONAL
//
// An Account is a party you have a relationship with, not a thing moving through a
// lifecycle. It carries no state machine, no transition set, no "ready to proceed"
// question, and nothing blocks it the way a Work Order can be blocked — a customer is
// simply active or it is not. Opportunities move through a pipeline; Sales Orders move
// through fulfillment; Work Orders move through dispatch. The Account itself does none of
// that — it is the party those operational records are scoped to, not an operational
// record in its own right.
//
// Declaring OPERATIONAL would trip pageDefinition.js's conditional rule requiring at least
// MIN_OPERATIONAL_SECTION_KINDS (2) distinct kinds from OPERATIONAL_SECTION_KINDS
// (LIFECYCLE/READINESS/BLOCKERS/NEXT_ACTIONS/ATTENTION/CUSTODY). The only way to satisfy
// that today would be inventing lifecycle/readiness sections an Account does not have —
// exactly the "hollow operational theatre" pageDefinition.js's header warns against
// (§5: "forcing a LIFECYCLE section onto [an Account] to satisfy a universal rule would
// produce exactly the hollow operational theatre this is meant to prevent"). So: RECORD.
//
// This page DOES use the ATTENTION and ACTIVITY section kinds below (accountAttention,
// activityAndNotes, serviceActivity) — that is allowed and correct. The OPERATIONAL-mode
// minimum only applies when compositionMode itself is declared OPERATIONAL; a RECORD page
// may still use operational-named kinds for sections that are genuinely that shape (an
// attention panel, an activity feed) without the page as a whole claiming to be an
// operational record.
// ─────────────────────────────────────────────────────────────────────────────
//
// CAPABILITY DECLARATIONS — verified, not guessed (§6: metadata DECLARES, never resolves):
//   - RELATED_LIST opportunities  -> "opportunity.read"   (account.js: accountEntity
//     relationship `account.opportunities`, traversalCapability: "opportunity.read";
//     mirrored on opportunity.js's own readCapability.)
//   - RELATED_LIST salesOrders    -> "salesOrder.read"    (account.js: relationship
//     `account.salesOrders`, traversalCapability: "salesOrder.read"; mirrored on
//     salesOrder.js's own readCapability.)
//   - financials (AR)             -> "finance.read"       (permissionCatalog.ts: "Finance
//     (Billing/AR) -- trusted AR READ ... via the trusted listAccountInvoiceAr callable."
//     AccountFinancialsSection.jsx's authoritative sub-block is AccountArSection, which is
//     the finance.read-gated listAccountInvoiceAr read; the provider-dependent Financial
//     Summary/Forecast blocks render only a bounded "not connected" line today and carry
//     no separate capability of their own.)
//   - activityAndNotes (CRM)      -> "crm.activity.read"  (permissionCatalog.ts: "CRM
//     Activity / Notes read -- the account-scoped timeline read for the
//     ActivityAndNotesSection UX ... via the trusted getCrmActivities read service."
//     Registered active:false today — declaring it here is still correct: a declaration
//     states what a viewer must hold, independent of whether the capability is currently
//     activated for anyone.)
//   - accountAttention            -> "finance.read"       (AccountAttentionSection.jsx
//     composes useAccountAr (finance.read-gated) with useAccountAttentionWorkOrders, which
//     reads fieldops_wos client-direct with NO capability gating it — Firestore Rules admit
//     by role, not by capability, the same pattern contact.js documents and records as
//     `readCapability: null` rather than inventing one. finance.read is declared here as the
//     strictest REAL gate this composed section actually has; the Work Order half is
//     undeclared for the same reason contacts and Service Activity are undeclared below.)
//   - locations (RELATED_LIST)    -> NO capability declared. location.js:
//     locationEntity.readCapability is null (`locations/{locationId}` is Rules-gated by
//     ROLE — isAdminOrDispatcher() — with no capability check at all). Same precedent as
//     `contacts` immediately below.
//   - commercialProfile (FIELD_GROUP) -> NO capability declared. account.js's own field
//     comments for paymentTerms/taxStatus: `customer.governedField.write` (capability id
//     customer.governedField.write, resource account.governedField, firestore.rules'
//     accountGovernedFieldsValid/accountGovernedFieldsUnchanged/
//     accountGovernedCreateBaseline) gates WRITE of those two fields to admin only — it
//     does not gate READ. The Account document's READ gate is uniform (isAdminOrDispatcher()
//     for the whole record, same as every other field on this entity), which is exactly
//     why account.js itself declares no readCapability on paymentTerms/taxStatus (see that
//     file's comment on the paymentTerms field). Declaring a section-level read capability
//     here would contradict that finding, not strengthen it.
//   - notesAndIdentifiers (FIELD_GROUP) -> NO capability declared, same uniform-read-gate
//     reasoning as commercialProfile: notes/customerNumber/erpId/accountingId/legacyId
//     carry no governance of their own in account.js.
//   - contacts, serviceActivity, and the header identity FIELD_GROUP carry NO
//     capabilityRequirement — verified absent, not merely unlisted:
//       - contacts: contact.js declares `readCapability: null` explicitly — "NO CAPABILITY
//         GATES THIS COLLECTION ... there is no `contact.read` in the permission catalog."
//       - serviceActivity: domain/accountWorkOrders.js reads fieldops_wos client-direct
//         (getCountFromServer / getDocs against composite indexes); no workOrder.read
//         capability id exists anywhere in permissionCatalog.ts or workOrder.js's
//         readCapability. Declaring one would assert an authority nothing enforces (§6).
// ─────────────────────────────────────────────────────────────────────────────
//
// CLOSED GAPS (were open in the prior version of this file; both are now modeled):
//
//   1. Locations. account.js now declares the owning-side `account.locations` relationship
//      and location.js now declares `locationRelatedList` (id "account.locations",
//      parentRelationshipId "account.locations", viewAllListId "location.index"). The
//      `locations` RELATED_LIST section below names that list.
//
//   2. Commercial Profile and Notes & Identifiers. account.js now declares
//      defaultCurrency/purchaseOrderRequired/invoiceDeliveryMethod/paymentTerms/
//      taxStatus/billingContactId/accountOwnerEmployeeId (Commercial Profile) and
//      customerNumber/erpId/accountingId/legacyId/notes (Notes & Identifiers). The two
//      FIELD_GROUP sections below name exactly the fieldIds
//      CommercialProfileSection/the Notes & Identifiers `<details>` block in
//      AccountDetail.jsx actually render, in the order they render them.
// ─────────────────────────────────────────────────────────────────────────────

export const accountRecordPage = makePageDefinition({
  id: "account.record",
  entityId: "account",
  label: "Customer Detail",
  compositionMode: "RECORD", // see DECISION above — an Account has no lifecycle to declare
  // ═══════════════════ WHAT AN EDIT ON THIS PAGE ACTUALLY WRITES ═══════════════════
  //
  // domain/accounts.js's `updateAccount` — a client-direct patch that firestore.rules gates on
  // isAdminOrDispatcher(), with `nameLower` derived and `updatedAt` stamped inside the writer so
  // no caller can forget them.
  //
  // The list below is EXACTLY the payload AccountForm already sends, and accountRecordPage.test
  // compares the two so it cannot drift. It is not a wish list: a field here that the form does not
  // send would be a promise no command keeps.
  //
  // DELIBERATELY ABSENT, and each renders read-only rather than hidden:
  //   nameLower  — derived from name inside the writer; editing it directly would let the search
  //                key disagree with the name it is a copy of. Also displayable:false.
  //   createdAt  — when the record came into existence. Not a preference.
  //   updatedAt  — stamped by updateAccount on every write; typing a value would be overwritten
  //                by the same call that saved it.
  //
  // paymentTerms and taxStatus ARE on the list and are ADMIN-ONLY at the Rules layer
  // (accountGovernedFieldsUnchanged). They are offered to an admin and shown read-only, with the
  // reason, to everyone else — the form does not hide them either, and Rules, not the UI, is what
  // enforces it.
  writeCommand: "domain/accounts.js#updateAccount",
  editableFieldIds: [
    "name", "status", "relationshipTypes", "lineOfBusiness", "tags", "billingAddress",
    "accountOwnerEmployeeId", "defaultCurrency", "paymentTerms", "purchaseOrderRequired",
    "invoiceDeliveryMethod", "taxStatus", "billingContactId",
    "notes", "customerNumber", "erpId", "accountingId", "legacyId",
  ],
  sections: [
    // HEADER — status/relationship/tags pill row + ContextBand, backed by the fields
    // accountEntity actually declares today. (lineOfBusiness is rendered in AccountDetail
    // but is not yet a declared entity field, so it is not claimed here either.)
    makeSection({
      id: "identity",
      kind: "FIELD_GROUP",
      region: "HEADER",
      order: 0,
      label: "Overview",
      // lineOfBusiness JOINS THIS GROUP. It is a declared field, it is the Taylor/Ventana split,
      // and no section claimed it — so the one attribute that says which operating company a
      // customer belongs to rendered nowhere on the customer's own record.
      fieldIds: ["name", "status", "relationshipTypes", "lineOfBusiness", "tags"],
    }),

    // HIGHLIGHTS — AccountHealthStrip: open Work Order count + AR view, in the metric-strip
    // slot above the two-column body. Composite of two existing account-scoped reads with
    // no capability of its own to declare (WO count is the same undeclared-capability read
    // as Service Activity below; the AR half is finance.read, but the strip is presentational
    // composition over accountHealthStrip.js, not itself a governed read boundary).
    makeSection({
      id: "healthStrip",
      kind: "METRIC_STRIP",
      region: "HIGHLIGHTS",
      order: 0,
      componentId: "accountHealthStrip", // REGISTRATION_PENDING — not yet registered
    }),

    // MAIN (PRIMARY column) — in AccountDetail.jsx's actual top-to-bottom order:
    // Opportunities, Sales Orders, Financials, Activity & Notes, Service Activity, Contacts.
    // H-A11: label is READ OFF opportunityRelatedList/salesOrderRelatedList rather than
    // retyped, so this heading can never drift from the list-view's own "Opportunities" /
    // "Sales Orders" (the label a viewer already sees on the "view all" index page) —
    // one string, one owner, instead of a second copy that silently goes stale here while
    // the list view is renamed. Without an explicit label, makeSection defaults to null,
    // MetadataRecordPage renders no <h3>, and BOTH sections' aria-label degraded to the
    // same generic "RELATED_LIST" (H-A11) — indistinguishable to a screen-reader user and
    // the reason this regressed silently when these replaced AccountOpportunitiesSection.jsx
    // (`<h4>Opportunities</h4>`) and AccountSalesOrdersSection.jsx (`<h4>Sales Orders</h4>`).
    makeSection({
      id: "opportunities",
      kind: "RELATED_LIST",
      region: "MAIN",
      order: 10,
      label: opportunityRelatedList.label, // "Opportunities"
      listId: "account.opportunities", // definitions/opportunity.js: opportunityRelatedList
      capabilityRequirement: "opportunity.read",
    }),
    makeSection({
      id: "salesOrders",
      kind: "RELATED_LIST",
      region: "MAIN",
      order: 20,
      label: salesOrderRelatedList.label, // "Sales Orders"
      listId: "account.salesOrders", // definitions/salesOrder.js: salesOrderRelatedList
      capabilityRequirement: "salesOrder.read",
    }),
    makeSection({
      id: "financials",
      kind: "METRIC_STRIP", // AR balance + provider-dependent summary/forecast, not a field
      // group or a related list — the closest declared kind for a financial-metrics area.
      region: "MAIN",
      order: 30,
      componentId: "accountFinancialsSection", // REGISTRATION_PENDING
      capabilityRequirement: "finance.read",
    }),
    makeSection({
      id: "activityAndNotes",
      kind: "ACTIVITY", // durable, attributed CRM interaction history
      region: "MAIN",
      order: 40,
      componentId: "accountActivityAndNotesSection", // REGISTRATION_PENDING
      capabilityRequirement: "crm.activity.read",
    }),
    makeSection({
      id: "serviceActivity",
      kind: "ACTIVITY", // Work Order summary counts + Account Activity timeline
      region: "MAIN",
      order: 50,
      componentId: "accountServiceActivity", // REGISTRATION_PENDING
      // No capabilityRequirement — verified absent, see CAPABILITY DECLARATIONS above.
    }),
    makeSection({
      id: "contacts",
      kind: "RELATED_LIST",
      region: "MAIN",
      order: 60,
      listId: "account.contacts", // definitions/contact.js: contactRelatedList
      // No capabilityRequirement — contact.js declares readCapability: null explicitly.
    }),
    // "4. Locations" in AccountDetail.jsx's own in-file numbering, rendered immediately
    // after Contacts in the PRIMARY column.
    makeSection({
      id: "locations",
      kind: "RELATED_LIST",
      region: "MAIN",
      order: 70,
      listId: "account.locations", // definitions/location.js: locationRelatedList
      // No capabilityRequirement — location.js declares readCapability: null explicitly,
      // the same finding as contacts above.
    }),

    // SIDE (SECONDARY column) — in AccountDetail.jsx's actual top-to-bottom order:
    // Commercial Profile, Account Attention, Notes & Identifiers.
    makeSection({
      id: "commercialProfile",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 0,
      label: "Billing & Terms",
      // Exactly the fields CommercialProfileSection (AccountDetail.jsx) renders, in the
      // order it renders them: Owner, Default currency, Payment terms, PO required,
      // Invoice delivery, Tax status, Billing contact.
      fieldIds: [
        "accountOwnerEmployeeId",
        "defaultCurrency",
        "paymentTerms",
        "purchaseOrderRequired",
        "invoiceDeliveryMethod",
        "taxStatus",
        "billingContactId",
      ],
      // No capabilityRequirement — see the CAPABILITY DECLARATIONS block above.
    }),
    makeSection({
      id: "accountAttention",
      kind: "ATTENTION", // "what needs a human" — AR overdue + WO past due, composed
      region: "SIDE",
      order: 10,
      componentId: "accountAttentionSection", // REGISTRATION_PENDING
      capabilityRequirement: "finance.read",
    }),
    // "6. Notes / Identifiers" in AccountDetail.jsx's own in-file numbering — a
    // <details>, collapsed by default, matching this section's collapsedByDefault.
    makeSection({
      id: "billingAddress",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 5,
      label: "Address",
      // A REAL SECTION FOR A REAL STORED FIELD, not a decorative one. billingAddress has been
      // written by AccountForm since the Commercial Profile work; it was rendered by reaching
      // around the metadata layer because no FieldDefinition existed for it. Both now do.
      fieldIds: ["billingAddress"],
    }),

    makeSection({
      id: "recordProvenance",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 30,
      label: "Record",
      // WHEN THIS RECORD CAME INTO EXISTENCE AND WHEN IT LAST MOVED. Both are declared fields that
      // no section claimed, so a customer record could not answer "is this current?" from itself.
      // Read-only by construction: createdAt is a fact, and updatedAt is stamped by updateAccount
      // on every write -- typing a value would be overwritten by the same call that saved it.
      fieldIds: ["createdAt", "updatedAt"],
      collapsedByDefault: true,
    }),

    makeSection({
      id: "notesAndIdentifiers",
      kind: "FIELD_GROUP",
      region: "SIDE",
      order: 20,
      label: "Notes & Identifiers",
      fieldIds: ["notes", "customerNumber", "erpId", "accountingId", "legacyId"],
      collapsedByDefault: true,
      // No capabilityRequirement — see the CAPABILITY DECLARATIONS block above.
    }),
  ],
});
