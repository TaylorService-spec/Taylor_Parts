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
import {
  ACCOUNTS_COLLECTION,
  ACCOUNT_STATUS,
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_RELATIONSHIP_TYPE,
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
      description: "Multi-valued: an account can be both a customer and a vendor.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "account",
      label: "Last update",
      type: "TIMESTAMP",
      sortable: true,
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
    // GOVERNED (Issue #175, capability catalog id account.governedField.write, resource
    // account.governedField): firestore.rules' accountGovernedFieldsValid /
    // accountGovernedFieldsUnchanged / accountGovernedCreateBaseline restrict who may EDIT
    // this field to admin — a dispatcher may create at the unset baseline and may write the
    // rest of the document, but may not change an existing paymentTerms/taxStatus value.
    // That authority governs WRITE, not READ: the account document's READ gate is uniformly
    // isAdminOrDispatcher() for the whole record, same as every other field on this entity,
    // and readCapability models READ authority only (entityDefinition.js's own comment: "what
    // reading this field requires"). FieldDefinition v1 has no writeCapability concept to
    // carry account.governedField.write, so nothing is declared for it here — inventing a
    // readCapability this field does not actually need would misstate what the id gates.
    // This gap is intentional and recorded, not an oversight.
    makeFieldDefinition({
      id: "paymentTerms",
      entityId: "account",
      label: "Payment Terms",
      type: "ENUM",
      enumValues: Object.values(PAYMENT_TERMS),
      enumLabels: PAYMENT_TERMS_LABEL,
      description: "GOVERNED — admin-only edit, enforced in firestore.rules (account.governedField.write), not by UI hiding. Optional; absent means no default term is set. See the field comment above for why no capability is declared here.",
    }),
    // Same governance shape as paymentTerms — see that field's comment.
    makeFieldDefinition({
      id: "taxStatus",
      entityId: "account",
      label: "Tax Status",
      type: "ENUM",
      enumValues: Object.values(TAX_STATUS),
      enumLabels: TAX_STATUS_LABEL,
      description: "GOVERNED — admin-only edit (account.governedField.write). An absent stored value means UNKNOWN, never TAXABLE (domain/commercialProfile.js's resolveTaxStatus() safe default) — a list or detail surface rendering this field must apply that same resolution, not render a blank.",
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
  id: "account.index",
  entityId: "account",
  label: "Customers",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "relationshipTypes" }),
    makeColumn({ fieldId: "tags" }),
    makeColumn({ fieldId: "updatedAt", sortable: true }),
  ],
  filters: [
    makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] }),
    makeFilter({ fieldId: "relationshipTypes", operators: ["ARRAY_CONTAINS"] }),
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
