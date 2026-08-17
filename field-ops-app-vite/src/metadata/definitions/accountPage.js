import { makeSection, makePageDefinition } from "../pageDefinition.js";

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
// GAPS — deliberately NOT modeled in this version, and why:
//
//   1. Locations. AccountDetail.jsx renders a Locations related section (add-only, backed
//      by useLocationsForAccount), but no `account.locations` ListViewDefinition exists —
//      there is no location.js under definitions/ and accountEntity declares no
//      `account.locations` relationship. pageDefinition.js's RELATED_LIST rule requires a
//      section to "name the ListViewDefinition it renders"; naming one that does not exist
//      would fail this file's own test that every RELATED_LIST listId resolves to a real,
//      imported list. Out of scope for this lane (writeScope excludes every other
//      definition file). REGISTRATION_PENDING: a future lane defines `account.locations`
//      (entity relationship + ListViewDefinition) and this page adds the section.
//
//   2. Commercial Profile (owner, default currency, payment terms, PO-required, invoice
//      delivery method, tax status, billing contact) and Notes & Identifiers (notes,
//      customerNumber, erpId, accountingId, legacyId). Both are real, literally-rendered
//      Account fields in AccountDetail.jsx, but accountEntity (account.js) currently
//      declares only five fields: name, status, relationshipTypes, updatedAt, tags. A
//      FIELD_GROUP section must name fieldIds that exist on the entity
//      (validatePageDefinition), and account.js is not in this lane's writeScope. Modeling
//      these as a non-FIELD_GROUP componentId section would misstate them as some other
//      SECTION_KIND (activity/attention/metric) they are not. REGISTRATION_PENDING: extend
//      accountEntity's field list in account.js, then add these as FIELD_GROUP sections.
// ─────────────────────────────────────────────────────────────────────────────

export const accountRecordPage = makePageDefinition({
  id: "account.record",
  entityId: "account",
  label: "Customer Detail",
  compositionMode: "RECORD", // see DECISION above — an Account has no lifecycle to declare
  sections: [
    // HEADER — status/relationship/tags pill row + ContextBand, backed by the fields
    // accountEntity actually declares today. (lineOfBusiness is rendered in AccountDetail
    // but is not yet a declared entity field, so it is not claimed here either.)
    makeSection({
      id: "identity",
      kind: "FIELD_GROUP",
      region: "HEADER",
      order: 0,
      fieldIds: ["name", "status", "relationshipTypes", "tags"],
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
    makeSection({
      id: "opportunities",
      kind: "RELATED_LIST",
      region: "MAIN",
      order: 10,
      listId: "account.opportunities", // definitions/opportunity.js: opportunityRelatedList
      capabilityRequirement: "opportunity.read",
    }),
    makeSection({
      id: "salesOrders",
      kind: "RELATED_LIST",
      region: "MAIN",
      order: 20,
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

    // SIDE (SECONDARY column) — Account Attention only, in this version. Commercial Profile
    // and Notes & Identifiers are the field-backed GAPS documented above and are not
    // modeled here yet.
    makeSection({
      id: "accountAttention",
      kind: "ATTENTION", // "what needs a human" — AR overdue + WO past due, composed
      region: "SIDE",
      order: 10,
      componentId: "accountAttentionSection", // REGISTRATION_PENDING
      capabilityRequirement: "finance.read",
    }),
  ],
});
