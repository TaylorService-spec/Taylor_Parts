import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import {
  OPPORTUNITY_STAGES, OPPORTUNITY_OUTCOMES, SALES_CHANNELS,
  STAGE_LABEL, OUTCOME_LABEL, CHANNEL_LABEL,
} from "../../domain/opportunityLifecycle.js";

// Opportunity — the second Account related-list dependency, and the first CALLABLE-read
// entity in the program.
//
// READ IS A TRUSTED CALLABLE, NOT A CLIENT QUERY. `opportunities` is deny-all in Firestore
// Rules; listOpportunitiesForAccount and listOpportunityContext are the only ways in. That
// is recorded as readVia CALLABLE, which matters to the runtime: a callable-read entity
// demands no composite index, because the server owns the query. The index derivation
// already returns nothing for such an entity, and this is the first definition to exercise
// that path against a real collection.
//
// THE CAPABILITY IS REGISTERED AND INACTIVE. opportunity.read exists in the catalog with
// active:false, so it currently denies everyone. Declaring it is still correct — metadata
// states what a caller must hold, and what a caller must hold is exactly this, whether or
// not anyone has been granted it yet. Register is not grant, and a declaration is not an
// activation.
//
// TWO FIELDS ARE READ BUT NEVER WRITTEN. The read projection returns `name` and
// `nextAction`; no write path in the repository sets either. They are NOT declared here.
// A definition that listed them would promise a column the data cannot fill, and the
// read service's own comment already says the projection must not invent a value.

export const opportunityEntity = makeEntityDefinition({
  id: "opportunity",
  label: "Opportunity",
  labelPlural: "Opportunities",
  collection: "opportunities",
  readVia: "CALLABLE",
  readCallable: "listOpportunitiesForAccount",
  readCapability: "opportunity.read",
  // The reference is the identity. `name` is absent from every write path, so declaring it
  // as the nameField would name a field that is never populated — and a surface would then
  // fall back to something, which is always the document id.
  identity: makeIdentity({ referenceField: "opportunityNumber" }),
  description: "A pursued piece of business. Deny-all in Rules; read only through governed callables.",
  fields: [
    makeFieldDefinition({
      id: "opportunityNumber",
      entityId: "opportunity",
      label: "Opportunity",
      type: "STRING",
      sortable: true,
      description: "OPP-YYYY-######, allocated transactionally at creation and never rewritten.",
    }),
    makeFieldDefinition({
      id: "stage",
      entityId: "opportunity",
      label: "Stage",
      type: "ENUM",
      enumValues: [...OPPORTUNITY_STAGES],
      enumLabels: STAGE_LABEL,
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
    }),
    makeFieldDefinition({
      id: "outcome",
      entityId: "opportunity",
      label: "Outcome",
      type: "ENUM",
      enumValues: [...OPPORTUNITY_OUTCOMES],
      enumLabels: OUTCOME_LABEL,
      description: "Null while open. WON only from DECISION; LOST from any open stage.",
    }),
    makeFieldDefinition({
      id: "salesChannel",
      entityId: "opportunity",
      label: "Channel",
      type: "ENUM",
      enumValues: [...SALES_CHANNELS],
      enumLabels: CHANNEL_LABEL,
    }),
    // A plain number with NO currency field beside it. Declaring CURRENCY_MINOR would
    // assert minor-unit integer storage that does not exist, and inventing a currency
    // would be worse: a figure labelled with a unit nobody stored. The gap is described
    // rather than filled — v2 has an explicit vocabulary for exactly this.
    makeFieldDefinition({
      id: "expectedValue",
      entityId: "opportunity",
      label: "Expected value",
      type: "NUMBER",
      sortable: true,
      description: "Stored as a plain number with no currency field. NOT minor units; do not render a currency symbol the data does not justify.",
    }),
    makeFieldDefinition({
      id: "expectedCloseAt",
      entityId: "opportunity",
      label: "Expected close",
      type: "TIMESTAMP",
      sortable: true,
      description: "Epoch milliseconds, not a Firestore Timestamp — unlike createdAt on the same document.",
    }),
    makeFieldDefinition({
      id: "need",
      entityId: "opportunity",
      label: "Need",
      type: "TEXT",
      description: "The nearest thing to a human name this entity has, and it is optional.",
    }),
    makeFieldDefinition({
      id: "accountId",
      entityId: "opportunity",
      label: "Customer",
      type: "REFERENCE",
      referenceTo: "account",
      filterable: true,
      operators: ["EQUALS"],
    }),
    makeFieldDefinition({
      id: "ownerEmployeeId",
      entityId: "opportunity",
      label: "Owner",
      type: "REFERENCE",
      referenceTo: "employee",
      description: "Display resolution belongs to the employee entity, not to this list.",
    }),
    makeFieldDefinition({
      id: "salesOrderId",
      entityId: "opportunity",
      label: "Sales Order",
      type: "REFERENCE",
      referenceTo: "salesOrder",
      description: "Written only after a WON opportunity produces a Sales Order. Its presence is the duplicate guard.",
    }),
  ],
  // account.opportunities points FROM Account and is declared there. Traversal carries the
  // TARGET's authority: reading an account does not entitle a viewer to its pipeline.
});

export const opportunityRelatedList = makeListViewDefinition({
  id: "account.opportunities",
  entityId: "opportunity",
  label: "Opportunities",
  surface: "RELATED",
  parentRelationshipId: "account.opportunities",
  viewAllListId: "opportunity.index",
  columns: [
    makeColumn({ fieldId: "opportunityNumber", sortable: true }),
    makeColumn({ fieldId: "need" }),
    makeColumn({ fieldId: "stage", sortable: true }),
    makeColumn({ fieldId: "outcome" }),
    makeColumn({ fieldId: "expectedValue", sortable: true }),
    makeColumn({ fieldId: "expectedCloseAt", sortable: true }),
  ],
  filters: [],
  defaultSort: [makeSort({ fieldId: "expectedCloseAt", direction: "ASC" })],
  pageSize: 25,
  capabilityRequirement: "opportunity.read",
  // No rowNavigationTo. "/sales/opportunities/:id" was declared here and named a route
  // that has never existed in App.jsx -- the only Opportunity route is the workspace at
  // /customers/opportunities, which takes no :id. It was harmless only while nothing
  // consumed rowNavigationTo; the moment DefaultRelatedList started reading it, every
  // Opportunity row would have linked to a 404. Removed rather than defended against
  // downstream: a consumer stripping a bad declaration leaves the bad declaration in
  // place for the next consumer. Restore this with a real per-Opportunity route.
});

/**
 * The pipeline index.
 *
 * Stage is the one declared filter. A CALLABLE-read entity needs no composite index — the
 * server owns the query — so the usual index-cost argument does not apply here, and the
 * restraint is instead about what the callable actually supports: it filters by account,
 * and a stage filter is a claim the read service would have to keep.
 */
export const opportunityIndexList = makeListViewDefinition({
  id: "opportunity.index",
  entityId: "opportunity",
  label: "Opportunities",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "opportunityNumber", sortable: true }),
    makeColumn({ fieldId: "accountId" }),
    makeColumn({ fieldId: "stage", sortable: true }),
    makeColumn({ fieldId: "salesChannel" }),
    makeColumn({ fieldId: "expectedValue", sortable: true }),
    makeColumn({ fieldId: "expectedCloseAt", sortable: true }),
  ],
  filters: [makeFilter({ fieldId: "stage", operators: ["EQUALS", "IN"] })],
  defaultSort: [makeSort({ fieldId: "expectedCloseAt", direction: "ASC" })],
  pageSize: 50,
  capabilityRequirement: "opportunity.read",
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "open",
      label: "Open pipeline",
      // Open means "no outcome yet". Expressed as the stage set rather than as an outcome
      // null-check, because a stage IN is servable from the same shape an equality is.
      filters: [{ fieldId: "stage", operator: "IN", value: [...OPPORTUNITY_STAGES] }],
      sort: [makeSort({ fieldId: "expectedCloseAt", direction: "ASC" })],
    }),
  ],
  // No rowNavigationTo. "/sales/opportunities/:id" was declared here and named a route
  // that has never existed in App.jsx -- the only Opportunity route is the workspace at
  // /customers/opportunities, which takes no :id. It was harmless only while nothing
  // consumed rowNavigationTo; the moment DefaultRelatedList started reading it, every
  // Opportunity row would have linked to a 404. Removed rather than defended against
  // downstream: a consumer stripping a bad declaration leaves the bad declaration in
  // place for the next consumer. Restore this with a real per-Opportunity route.
});
