import {
  makeEntityDefinition,
  makeFieldDefinition,
  makeIdentity,
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
    makeFieldDefinition({
      id: "relationshipType",
      entityId: "account",
      label: "Relationship",
      type: "ENUM",
      enumValues: Object.values(ACCOUNT_RELATIONSHIP_TYPE),
      enumLabels: { CUSTOMER: "Customer", VENDOR: "Vendor" },
      filterable: true,
      operators: ["EQUALS", "IN"],
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
});

export const accountIndexList = makeListViewDefinition({
  id: "account.index",
  entityId: "account",
  label: "Customers",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "status", sortable: true }),
    makeColumn({ fieldId: "relationshipType" }),
    makeColumn({ fieldId: "tags" }),
    makeColumn({ fieldId: "updatedAt", sortable: true }),
  ],
  filters: [
    makeFilter({ fieldId: "status", operators: ["EQUALS", "IN"] }),
    makeFilter({ fieldId: "relationshipType", operators: ["EQUALS", "IN"] }),
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
