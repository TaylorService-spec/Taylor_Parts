import {
  makeEntityDefinition,
  makeFieldDefinition,
  makeIdentity,
  makeRelationshipDefinition,
} from "../entityDefinition.js";
import {
  makeColumn,
  makeFilter,
  makeListViewDefinition,
  makeSavedView,
  makeSort,
} from "../listViewDefinition.js";
import { makeGap, GAP_SEVERITY } from "../gapRegister.js";
import { UNSUPPORTED_REASON as WHY } from "../unsupportedReason.js";
import { ABSENCE } from "../absence.js";
import {
  ACCOUNTS_COLLECTION,
  ACCOUNT_STATUS,
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_RELATIONSHIP_TYPE,
  ACCOUNT_LINE_OF_BUSINESS,
} from "../../domain/constants.js";
import {
  INVOICE_DELIVERY_METHOD,
  INVOICE_DELIVERY_METHOD_LABEL,
  PAYMENT_TERMS,
  PAYMENT_TERMS_LABEL,
  TAX_STATUS,
  TAX_STATUS_LABEL,
} from "../../domain/accountCommercialVocabulary.js";

// The FIRST real EntityDefinition and ListViewDefinition — Account, behind /customers.
//
// Everything the contracts and runtimes promise has until now been exercised only by
// tests. This is the definition that has to survive contact with a surface that already
// exists, and its job is to describe Accounts as they ARE stored, not as a clean model
// would prefer them.
//
// ENUM LABELS COME FROM domain/constants.js, not from a second copy written here. Two
// label maps for one enum is how "0 Active" ended up beside a table of ACTIVE rows
// (#1093): the surfaces disagreed about what the stored value meant. The metadata layer
// must not become the third opinion.
//
// §9 — DECLARED FILTERS ARE PROMISES. Every operator below is a claim that the backend
// can serve that query, and scripts/listIndexCoverage.mjs now fails the build if a
// declared filter has no declared composite index. The filter set is therefore
// deliberately smaller than what the current client-side page offers: what the page does
// in memory over the whole collection is not evidence that the query layer can do it.

// THE TWO FIELDS RULES TREATS DIFFERENTLY FROM EVERY OTHER FIELD ON THIS RECORD.
//
// firestore.rules accountGovernedFieldsUnchanged(): a dispatcher may update an Account only if
// paymentTerms and taxStatus are UNCHANGED; an admin may change them. Exported so a surface can
// mirror that in PRESENTATION -- which pencils appear -- without restating the rule inline and
// drifting from it. accountRecordPage.test compares this list against firestore.rules itself.
//
// It decides presentation only. Rules remain the enforcement, and a write that reaches the server
// anyway is denied there, which is exactly what AccountForm already relies on: it does not hide
// these fields from a dispatcher either.
export const ACCOUNT_GOVERNED_FIELD_IDS = Object.freeze(["paymentTerms", "taxStatus"]);

export const accountEntity = makeEntityDefinition({
  id: "account",
  label: "Customer",
  labelPlural: "Customers",
  collection: ACCOUNTS_COLLECTION,
  // Firestore rules are the gate for accounts today; the Phase 0 audit found both
  // patterns in use, and recording which one this is stops the runtime from assuming.
  readVia: "CLIENT_DIRECT",
  // The account's name is how a human identifies it. There is no reference number for
  // an Account, and declaring one that does not exist would license a surface to render
  // a document id in its place — the exact defect corrected on Sales Orders (#1124).
  identity: makeIdentity({ nameField: "name" }),
  description: "A customer or vendor relationship. Internal name Account; the UI says Customer.",
  fields: [
    makeFieldDefinition({
      id: "name",
      entityId: "account",
      label: "Customer",
      type: "STRING",
      sortable: true,
      defaultVisible: true,
      // A record with no name is malformed and says so. It NEVER falls back to the document id —
      // the defect DECISIONS #106 forbids, and the one an unnamed record is most likely to reach.
      absence: ABSENCE.NOT_RECORDED,
      description:
        "The business identity. Sorting and prefix search run against `nameLower` (below), because " +
        "Firestore cannot compare case-insensitively and a query against the display name could not " +
        "find \"Mesquite Soda Works\" for \"mesquite\".",
    }),
    // THE DERIVED SEARCH NAME, declared because a query actually uses it.
    //
    // Written by domain/accounts.js's own writers (`withDerivedSearchName`) rather than by call
    // sites, so a caller cannot forget what it never had to remember — asserted by
    // accountWriteContract.test.mjs. Not displayable: it is a normalized copy of `name`, and
    // showing both would put the same value on screen twice, once in the wrong case.
    makeFieldDefinition({
      id: "nameLower",
      entityId: "account",
      label: "Customer (sort key)",
      type: "STRING",
      displayable: false,
      reportable: false,
      exportable: false,
      sortable: true,
      unsupportedFilterReason: WHY.NEEDS_INDEX,
      description: "Normalized lowercase copy of `name`. The only case-insensitive handle Firestore has.",
    }),
    makeFieldDefinition({
      id: "status",
      entityId: "account",
      label: "Status",
      type: "ENUM",
      enumValues: Object.values(ACCOUNT_STATUS),
      enumLabels: ACCOUNT_STATUS_LABEL,
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      defaultVisible: true,
      // SORTING GROUPS, IT DOES NOT SEQUENCE. Firestore orders by the STORED STRING, so a status
      // sort puts every ACTIVE together and every PROSPECT together — genuinely useful — but the
      // resulting order is alphabetical by enum value, not ACTIVE → INACTIVE → PROSPECT → ARCHIVED.
      // No ordinal is stored, so a lifecycle order is not executable. See
      // ACCOUNT_STATUS_LIFECYCLE_ORDER_NOT_EXECUTABLE, and note the sort control says "grouped"
      // rather than "first to last" for exactly this reason.
      description:
        "PROSPECT IS A STATUS, not a separate type and not a separate collection. There is no second " +
        "Customer identity model to avoid creating — the distinction is already a field.",
    }),
    // CORRECTION. This was first declared as a singular ENUM `relationshipType`, and
    // wiring the surface proved no such field is stored: accounts carry
    // `relationshipTypes`, an ARRAY, and an account may be both a customer and a vendor.
    // A filter on the singular name would have queried a field that does not exist and
    // returned an empty page that looked like an honest answer.
    //
    // Filterable by array-contains, now that the index derivation models filter
    // COMBINATIONS and emits arrayConfig for array operators. It was deferred until it
    // could be declared honestly: the old derivation emitted one combined index, which
    // would have left the relationship-only query with no index and failing in front of
    // a user while CI stayed green.
    makeFieldDefinition({
      id: "relationshipTypes",
      entityId: "account",
      label: "Relationship",
      type: "ENUM_SET",
      enumValues: Object.values(ACCOUNT_RELATIONSHIP_TYPE),
      enumLabels: { CUSTOMER: "Customer", VENDOR: "Vendor" },
      filterable: true,
      // ARRAY_CONTAINS only. array-contains-any would let a caller pass an arbitrary set,
      // and Firestore permits one array filter per query — declaring both invites a
      // combination no declared index serves.
      operators: ["ARRAY_CONTAINS"],
      defaultVisible: true,
      // AN ARRAY HAS NO ORDER TO SORT BY. Sorting rows by an array field would order them by
      // whatever Firestore does with the first element, which is not a business ordering of
      // anything — and alphabetising the array's CONTENTS and calling the list "sorted by
      // Relationship" would be worse: it looks sorted and means nothing.
      sortable: false,
      unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
      description: "Multi-valued: an account can be both a customer and a vendor.",
    }),
    // LINE OF BUSINESS — declared because a surface already renders it.
    //
    // AccountDetail.jsx has read `account.lineOfBusiness` since the LOB wireframe shipped, and this
    // definition did not declare it: metadata describing less than the document holds, which is the
    // mirror image of this program's usual defect and just as misleading to the next reader.
    //
    // A FOURTH DISTINCT CONCEPT, and the separation is load-bearing. NOT operatingCompanyId (whose
    // books a TRANSACTION lands in, per transaction). NOT salesChannel (retail vs national account,
    // per order). NOT the manufacturer's line. "Both" is a first-class, expected value.
    makeFieldDefinition({
      id: "lineOfBusiness",
      entityId: "account",
      label: "Line of Business",
      type: "ENUM_SET",
      enumValues: Object.values(ACCOUNT_LINE_OF_BUSINESS),
      enumLabels: { TAYLOR: "Taylor", VENTANA: "Ventana" },
      filterable: true,
      operators: ["ARRAY_CONTAINS"],
      defaultVisible: true,
      sortable: false,
      unsupportedSortReason: WHY.NO_CANONICAL_ORDER,
      description:
        "Informational only — gates no authorization, and an unset value renders nothing rather than " +
        "silently defaulting to Taylor.",
    }),
    makeFieldDefinition({
      id: "createdAt",
      entityId: "account",
      label: "Created",
      type: "TIMESTAMP",
      sortable: true,
      defaultVisible: true,
      // Epoch milliseconds, matching makeCollectionStore's convention for this collection — not a
      // Firestore Timestamp. Filtering by a date range is possible in principle and is not declared:
      // an optional range filter multiplies the composite-index set, and nothing asks for it yet.
      unsupportedFilterReason: WHY.NEEDS_INDEX,
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "account",
      label: "Last update",
      type: "TIMESTAMP",
      sortable: true,
      unsupportedFilterReason: WHY.NEEDS_INDEX,
    }),
    // Tags are stored as an array and the current page filters them in memory. The
    // field is declared so a column can render it, but NO operators are claimed:
    // array-contains combined with a sort needs its own composite index, and claiming
    // the filter before declaring that index is precisely the promise §9 forbids.
    makeFieldDefinition({
      id: "tags",
      entityId: "account",
      label: "Tags",
      type: "STRING",
      description: "Free-form labels. Filtering is not claimed until the index exists.",
    }),

    // --- Commercial Profile (PR 1: docs/specifications/account-commercial-profile-and-
    // financial-forecast-horizons.md; PR 2 adds paymentTerms/taxStatus). Every field below
    // is written by AccountForm.jsx's onSubmit payload and read back by AccountDetail.jsx's
    // CommercialProfileSection. None is filterable or sortable — the Work Order lesson
    // (three optional filters demanded seven composites) applies with more force here: not
    // one of these fields has a real cross-Account query behind it today, only a single-
    // Account detail render. Display-only is the default until a query proves otherwise.

    // defaultCurrency is an ISO 4217 ALPHABETIC CODE ("USD"), not a monetary amount — there
    // is no minor-unit integer anywhere near it (contrast salesOrder.js's actual
    // CURRENCY_MINOR usage, which stores cents). domain/commercialProfile.js's
    // isValidIso4217() validates it against a fixed 3-letter code set; declaring it STRING
    // rather than a fabricated CURRENCY_MINOR keeps the type honest to what is stored.
    makeFieldDefinition({
      id: "defaultCurrency",
      entityId: "account",
      label: "Default Currency",
      type: "STRING",
      description: "ISO 4217 alphabetic currency code (e.g. USD), stored uppercase. Validated against a fixed code set by domain/commercialProfile.js's isValidIso4217() — not a monetary amount, so not CURRENCY_MINOR.",
    }),
    makeFieldDefinition({
      id: "purchaseOrderRequired",
      entityId: "account",
      label: "PO Required",
      type: "BOOLEAN",
      description: "AccountDetail.jsx only renders this when a real boolean is stored (account.purchaseOrderRequired === true or === false) — a malformed stored value is surfaced in the edit form, never silently shown as Yes/No.",
    }),
    makeFieldDefinition({
      id: "invoiceDeliveryMethod",
      entityId: "account",
      label: "Invoice Delivery",
      type: "ENUM",
      enumValues: Object.values(INVOICE_DELIVERY_METHOD),
      enumLabels: INVOICE_DELIVERY_METHOD_LABEL,
      description: "Process metadata only — how an invoice is delivered, not a monetary value. Validated by domain/commercialProfile.js's isValidInvoiceDeliveryMethod().",
    }),
    // GOVERNED (Issue #175, capability catalog id customer.governedField.write, resource
    // account.governedField): firestore.rules' accountGovernedFieldsValid /
    // accountGovernedFieldsUnchanged / accountGovernedCreateBaseline restrict who may EDIT
    // this field to admin — a dispatcher may create at the unset baseline and may write the
    // rest of the document, but may not change an existing paymentTerms/taxStatus value.
    // That authority governs WRITE, not READ: the account document's READ gate is uniformly
    // isAdminOrDispatcher() for the whole record, same as every other field on this entity,
    // and readCapability models READ authority only (entityDefinition.js's own comment: "what
    // reading this field requires"). FieldDefinition v1 has no writeCapability concept to
    // carry customer.governedField.write, so nothing is declared for it here — inventing a
    // readCapability this field does not actually need would misstate what the id gates.
    // This gap is intentional and recorded, not an oversight.
    makeFieldDefinition({
      id: "paymentTerms",
      entityId: "account",
      label: "Payment Terms",
      type: "ENUM",
      enumValues: Object.values(PAYMENT_TERMS),
      enumLabels: PAYMENT_TERMS_LABEL,
      description: "GOVERNED — admin-only edit, enforced in firestore.rules (customer.governedField.write), not by UI hiding. Optional; absent means no default term is set. See the field comment above for why no capability is declared here.",
    }),
    // Same governance shape as paymentTerms — see that field's comment.
    makeFieldDefinition({
      id: "taxStatus",
      entityId: "account",
      label: "Tax Status",
      type: "ENUM",
      enumValues: Object.values(TAX_STATUS),
      enumLabels: TAX_STATUS_LABEL,
      description: "GOVERNED — admin-only edit (customer.governedField.write). An absent stored value means UNKNOWN, never TAXABLE (domain/commercialProfile.js's resolveTaxStatus() safe default) — a list or detail surface rendering this field must apply that same resolution, not render a blank.",
    }),
    // Stored at billingContact.contactId (a one-key map: `{ contactId }`), not a bare
    // scalar — declared with a flat id per the FIELD IDS ARE PLAIN, NOT DOTTED PATHS
    // convention location.js's address fields already establish, since v1 has no
    // dotted-storagePath concept. AccountDetail.jsx never renders the stored contactId
    // directly — it re-resolves the CURRENT contact name via resolveContactIdentity()
    // against this Account's own contacts, the same "current identity, not a stale
    // snapshot" pattern commercialProfile.js documents for accountOwner below.
    makeFieldDefinition({
      id: "billingContactId",
      entityId: "account",
      label: "Billing Contact",
      type: "REFERENCE",
      referenceTo: "contact",
      description: "Stored at billingContact.contactId on the document. Must belong to THIS Account — domain/commercialProfile.js's isContactOnAccount() rejects a contact id from another Account. Display resolution belongs to the contact entity, not to this field.",
    }),
    // accountOwner is stored as a full Person Assignment map: assignedToEmployeeId,
    // assignedToUserId, assignedToDisplayName, assignedByEmployeeId, assignedByUserId,
    // assignedByDisplayName, assignedAt (domain/commercialProfile.js's
    // isCompleteAccountOwner() requires every one of them together, or none). Only the
    // ASSIGNEE'S employee-doc reference is declared here, following the exact precedent
    // opportunity.js's ownerEmployeeId and salesOrder.js's ownerEmployeeId already set for
    // an "owner" field: REFERENCE to the employee entity, display resolution left to that
    // entity. The remaining six sub-fields are real, verified-stored data but are left
    // undeclared: AccountDetail.jsx's CommercialProfileSection does not render any of them
    // directly (resolveOwnerIdentity() re-resolves the CURRENT display name live from the
    // employee directory via assignedToUserId, never from the stored assignedToDisplayName
    // snapshot, and the assignedBy* provenance trio is written but never read back by any
    // surface found). Declaring fields nothing reads would be the inverse of the equipment.js
    // inventory-control lesson this program follows — not declaring a rendered-but-unstored
    // field — but the same restraint: don't declare what nothing consumes.
    makeFieldDefinition({
      id: "accountOwnerEmployeeId",
      entityId: "account",
      label: "Owner",
      type: "REFERENCE",
      referenceTo: "employee",
      defaultVisible: true,
      // THE NAME LIVES ON THE EMPLOYEE. It is resolved for the rows already fetched, which is right
      // for display and useless for a sort that has to happen inside the query choosing the rows —
      // the same rule as customerId on a Work Order. Filtering by owner would need the id, and no
      // index for it is declared.
      filterable: false,
      unsupportedFilterReason: WHY.NEEDS_INDEX,
      sortable: false,
      unsupportedSortReason: WHY.NOT_PROJECTED,
      // An owner who no longer resolves reads as unavailable. Never the employee id.
      absence: ABSENCE.UNRESOLVED,
      description: "Stored at accountOwner.assignedToEmployeeId, one of seven fields in the stored Person Assignment map. See the field comment above for which of the other six are deliberately left undeclared, and why.",
    }),

    // --- Notes & Identifiers. customerNumber/erpId/accountingId/legacyId are, per
    // domain/accounts.js's own header comment, "reserved for future integrations only --
    // nothing in this sprint populates or reads them beyond passing through whatever a user
    // types" — plain opaque strings, not validated or enforced-unique anywhere found (Rules'
    // accounts match block validates only the two governed fields; the rest of the document
    // is unconstrained). Declared as STRING, not ID: nothing resolves an entity BY these
    // values today, so REFERENCE/ID would claim a lookup capability that does not exist.
    makeFieldDefinition({
      id: "customerNumber",
      entityId: "account",
      label: "Customer #",
      type: "STRING",
      description: "Reserved external identifier — passthrough only (domain/accounts.js header). Not validated or enforced-unique.",
    }),
    makeFieldDefinition({
      id: "erpId",
      entityId: "account",
      label: "ERP ID",
      type: "STRING",
      description: "Reserved external identifier — passthrough only (domain/accounts.js header). Not validated or enforced-unique.",
    }),
    makeFieldDefinition({
      id: "accountingId",
      entityId: "account",
      label: "Accounting ID",
      type: "STRING",
      description: "Reserved external identifier — passthrough only (domain/accounts.js header). Not validated or enforced-unique.",
    }),
    makeFieldDefinition({
      id: "legacyId",
      entityId: "account",
      label: "Legacy ID",
      type: "STRING",
      description: "Reserved external identifier — passthrough only (domain/accounts.js header). Not validated or enforced-unique.",
    }),
    // Free text, rendered verbatim by AccountDetail.jsx's Notes & Identifiers section
    // ("No notes." when unset). TEXT, not STRING, matching location.js's accessNotes for
    // the same reason: a multi-line free-form field, not a short label.
    makeFieldDefinition({
      id: "notes",
      entityId: "account",
      label: "Notes",
      type: "TEXT",
      description: "Free-form text. Rendered verbatim; no formatting or length constraint found in any write path.",
    }),
    // STORED AND WRITTEN SINCE THE COMMERCIAL PROFILE WORK, AND UNDECLARED UNTIL NOW.
    //
    // AccountForm sends `billingAddress` as { street, city, state, zip } or null, and AccountDetail
    // renders it through domain/address.js's formatAddress. It simply had no FieldDefinition, so
    // the metadata layer could not see a field the write path has been maintaining all along —
    // which is why the record page had to reach around metadata to show a customer's address.
    //
    // Declared as ADDRESS rather than four strings: the parts are written and cleared together, and
    // splitting them would let a definition claim "City" is independently present.
    makeFieldDefinition({
      id: "billingAddress",
      entityId: "account",
      label: "Billing Address",
      type: "ADDRESS",
      description:
        "Structured { street, city, state, zip }, every part optional; the whole object is written " +
        "or cleared together. Not filterable or sortable — Firestore cannot order by a map, and no " +
        "projected scalar exists to filter on.",
    }),
  ],
  // KNOWN LIMITATIONS, AS DATA — see metadata/gapRegister.js. Every one traced against the
  // stored document and the write path, never inferred from what the CRM screens render.
  gaps: [
    makeGap({
      id: "ACCOUNT_MULTI_ARRAY_FILTER_GAP",
      title: "Relationship and Line of Business cannot be filtered together",
      entityId: "account",
      fieldId: "lineOfBusiness",
      severity: GAP_SEVERITY.MODELLING,
      finding:
        "Both relationshipTypes and lineOfBusiness are ARRAYS, and Firestore permits at most one " +
        "array-contains-family constraint per query. No composite index can change that — " +
        "requiredIndexes() already emits one index FAMILY per array filter rather than combining " +
        "them, for exactly this reason.",
      consequence:
        "“Customers on the Taylor line” — the first question anybody would ask of these two fields " +
        "together — is not executable against the current document shape.",
      refused:
        "Applying one array filter server-side and the other in the browser, and refusing to apply " +
        "one silently. Both would return a set that does not match what was asked for while looking " +
        "as though it did. The query planner returns MULTIPLE_ARRAY_FILTERS and the list says it is " +
        "broader than requested.",
      resolution:
        "A denormalized scalar combining the two (e.g. a `relationshipLine` array of composite " +
        "tokens), or a search index. Both are document-shape changes with their own maintenance " +
        "authority, and neither belongs in a list migration.",
    }),
    makeGap({
      id: "ACCOUNT_STATUS_LIFECYCLE_ORDER_NOT_EXECUTABLE",
      title: "Status sorts alphabetically, not through its lifecycle",
      entityId: "account",
      fieldId: "status",
      severity: GAP_SEVERITY.MODELLING,
      finding:
        "Firestore orders by the STORED STRING. ACTIVE / INACTIVE / PROSPECT / ARCHIVED has a real " +
        "business sequence, and no ordinal is stored anywhere, so the sequence cannot be executed.",
      consequence:
        "A status sort GROUPS — every ACTIVE together, every PROSPECT together — which is genuinely " +
        "useful, and is not the lifecycle order.",
      refused:
        "Labelling the sort “first to last”. It would read as the lifecycle and deliver the " +
        "alphabet. The control says “grouped” instead.",
      resolution: "A stored ordinal, if anybody actually needs lifecycle order in a query.",
    }),
    makeGap({
      id: "ACCOUNT_CITY_STATE_NOT_PROJECTED",
      title: "An Account has no city or state",
      entityId: "account",
      severity: GAP_SEVERITY.MISSING_AUTHORITY,
      reason: WHY.NOT_PROJECTED,
      finding:
        "addressCity and addressState live on `locations`, joined to an Account by locationsFieldId. " +
        "The Account document carries neither, and there is no primary-location concept: " +
        "account.locations is ONE_TO_MANY with nothing marking one of them as the one.",
      consequence: "City and State cannot be Account list columns, filters or sorts.",
      refused:
        "Taking the first Location as “the Account’s city”. A customer with three sites does not " +
        "have one obvious city merely because a list wants a column, and whichever site happened to " +
        "be created first is not an answer.",
      resolution:
        "Either a declared primary-location relationship, or a projected billing city on the Account. " +
        "Both are domain decisions about what a customer's address MEANS, not list plumbing.",
    }),
    makeGap({
      id: "ACCOUNT_PRIMARY_LOCATION_NOT_MODELLED",
      title: "No Location is marked as an Account's primary",
      entityId: "account",
      severity: GAP_SEVERITY.MODELLING,
      finding:
        "account.locations is a plain ONE_TO_MANY. Neither the Account nor the Location carries a " +
        "primary/default flag, and no write path sets one.",
      consequence:
        "Every question of the form “where is this customer” is ambiguous for a multi-site account, " +
        "which blocks City/State projection and any single-address display.",
      refused: "Inventing a primary by creation order, by name, or by whichever has the most Equipment.",
      resolution:
        "A domain decision first — is a primary location a billing address, a headquarters, or the " +
        "site that gets service most often? Those are three different fields.",
    }),
    makeGap({
      id: "ACCOUNT_INSTALLED_BASE_ROLLUP_GAP",
      title: "Equipment counts per Account require one query per row",
      entityId: "account",
      severity: GAP_SEVERITY.SCALE,
      reason: WHY.NOT_PROJECTED,
      finding:
        "`equipment` carries accountId and is queryable BY account, but nothing materializes a count " +
        "onto the Account. There is no batched or aggregate read for it.",
      consequence: "Installed Equipment Count and Active Equipment Count cannot be list columns.",
      refused: "One Equipment query per Account row. On a 250,000-account book that is not a column, it is an outage.",
      resolution: "A materialized rollup maintained by the Equipment writers, or a server-side aggregate read.",
    }),
    makeGap({
      id: "ACCOUNT_SERVICE_ROLLUP_GAP",
      title: "Open Work Orders and Last Service Date are not projected",
      entityId: "account",
      severity: GAP_SEVERITY.SCALE,
      reason: WHY.NOT_PROJECTED,
      finding:
        "fieldops_wos carries customerId and is queryable by it. Nothing projects a count, a most-recent " +
        "service date or a next scheduled date onto the Account.",
      consequence: "Open Work Orders, Last Service Date and Next Scheduled Service cannot be list columns.",
      refused: "Querying Work Orders once per Account row.",
      resolution: "A materialized service rollup, alongside ACCOUNT_INSTALLED_BASE_ROLLUP_GAP — they want the same machinery.",
    }),
    makeGap({
      id: "ACCOUNT_CONTACT_ROLLUP_GAP",
      title: "Primary Contact and Contact Count are not projected",
      entityId: "account",
      severity: GAP_SEVERITY.MODELLING,
      reason: WHY.NOT_PROJECTED,
      finding:
        "`billingContactId` is stored (at billingContact.contactId) and is a BILLING role, not a general " +
        "primary contact. No contact count exists, and no contact is flagged primary.",
      consequence: "A Primary Contact or Contact Count column would be inventing a relationship the data does not hold.",
      refused: "Promoting the billing contact to “the” primary contact. Who to invoice and who to call are different questions.",
    }),
    makeGap({
      id: "ACCOUNT_FINANCIAL_METRICS_ABSENT",
      title: "No revenue, pipeline or margin exists on an Account",
      entityId: "account",
      severity: GAP_SEVERITY.MISSING_AUTHORITY,
      reason: WHY.NO_AUTHORITY,
      finding:
        "The Account carries commercial PROCESS metadata — payment terms, tax status, invoice delivery, " +
        "default currency (an ISO code, not an amount) — and no monetary value of any kind.",
      consequence: "Pipeline, Revenue, Sales-to-goal and Margin cannot appear on this list.",
      refused: "Deriving any of them by summing related Sales Orders or Opportunities per row.",
      resolution: "Financial and Reporting authority, which owns what those numbers mean before anything displays them.",
    }),
  ],
  // Outbound relationships live on the OWNING entity, which is what stops one edge being
  // declared twice with two different viaFields.
  relationships: [
    makeRelationshipDefinition({
      id: "account.contacts",
      label: "Contacts",
      fromEntityId: "account",
      toEntityId: "contact",
      viaField: "accountId",
      cardinality: "ONE_TO_MANY",
      // No traversalCapability: nothing gates contacts by capability today. Rules admit
      // admin and dispatcher by ROLE, and declaring an authority nothing enforces would be
      // a false statement about the system rather than a stricter one.
    }),
    // location.js exists (S-CRM-LOCATION-DEFINITION) but could not declare this edge itself
    // — findParentRelationship requires a RELATED list's parent relationship to be declared
    // on the OWNING side, and account.js is what owns it. This is the edge location.js's own
    // header names as its REGISTRATION_PENDING blocker. Same shape as account.contacts:
    // locationEntity.readCapability is null (Rules gate locations/{locationId} by ROLE —
    // isAdminOrDispatcher() — with no field-shape guard and no capability check at all), so
    // declaring a traversalCapability here would assert an authority nothing enforces, the
    // exact false statement account.contacts' own comment already refuses to make.
    makeRelationshipDefinition({
      id: "account.locations",
      label: "Locations",
      fromEntityId: "account",
      toEntityId: "location",
      viaField: "accountId",
      cardinality: "ONE_TO_MANY",
    }),
    makeRelationshipDefinition({
      id: "account.opportunities",
      label: "Opportunities",
      fromEntityId: "account",
      toEntityId: "opportunity",
      viaField: "accountId",
      cardinality: "ONE_TO_MANY",
      // Traversal carries the TARGET's authority. Reading an account does not entitle a
      // viewer to its pipeline -- the disclosure a LOOKUP would launder, one level up.
      traversalCapability: "opportunity.read",
    }),
    makeRelationshipDefinition({
      id: "account.salesOrders",
      label: "Sales Orders",
      fromEntityId: "account",
      toEntityId: "salesOrder",
      viaField: "accountId",
      cardinality: "ONE_TO_MANY",
      // Same rule as account.opportunities: traversal carries the TARGET's authority, not
      // the Account's. Reading an account does not entitle a viewer to its committed orders.
      traversalCapability: "salesOrder.read",
    }),
  ],
});

export const accountIndexList = makeListViewDefinition({
  emptyGuidance:
    "A customer is the account everything else hangs off — its locations are where service happens, and its work orders, equipment, and financial summary all roll up here.",
  id: "account.index",
  entityId: "account",
  label: "Customers",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "relationshipTypes" }),
    makeColumn({ fieldId: "lineOfBusiness" }),
    makeColumn({ fieldId: "accountOwnerEmployeeId" }),
    // Tags stay a COLUMN and claim no filter, unchanged. Tag values are open, so the only way to
    // know which exist is to read every account, and rebuilding the facet from the current page
    // would present "the tags on these fifty rows" as "the tags that exist".
    makeColumn({ fieldId: "tags" }),
    makeColumn({ fieldId: "createdAt", sortable: true }),
    // The DEFAULT SORT's own field. A list ordered by most-recently-touched that does not show
    // when each row was touched asks the reader to take the ordering on faith.
    makeColumn({ fieldId: "updatedAt", sortable: true }),
  ],
  filters: [
    makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] }),
    makeFilter({ fieldId: "relationshipTypes", operators: ["ARRAY_CONTAINS"] }),
    // THE THIRD FILTER, and its cost was checked before it was declared. Array filters do not
    // combine with each other, so this adds one index FAMILY rather than doubling the set — and
    // the combination `relationshipTypes AND lineOfBusiness` is refused at the query planner
    // (MULTIPLE_ARRAY_FILTERS), because Firestore cannot serve it at any index cost.
    makeFilter({ fieldId: "lineOfBusiness", operators: ["ARRAY_CONTAINS"] }),
  ],
  // Most-recently-touched first is the ordering that makes a first page useful when the
  // set is larger than anyone will scroll. Name-ascending is available as a sort but is
  // a poor default: it makes page one a permanent property of the alphabet.
  defaultSort: [makeSort({ fieldId: "updatedAt", direction: "DESC" })],
  pageSize: 50,
  savedViews: [
    // At 250,000 accounts an unfiltered first page answers nobody's question, so the
    // landing state is what this person was actually working on.
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active customers",
      filters: [{ fieldId: "status", operator: "EQUALS", value: ACCOUNT_STATUS.ACTIVE }],
      sort: [makeSort({ fieldId: "updatedAt", direction: "DESC" })],
    }),
  ],
  rowNavigationTo: "/customers/:id",
});
