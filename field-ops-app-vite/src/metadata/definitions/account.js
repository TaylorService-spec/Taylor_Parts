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
