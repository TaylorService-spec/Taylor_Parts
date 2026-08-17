import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { CONTACTS_COLLECTION } from "../../domain/constants.js";

// Contact — the first Account related-list dependency.
//
// Describes what is STORED, which for this entity is less tidy than a schema would be.
// Contacts have three write paths that do not agree with each other, and the definition
// records the intersection they actually share rather than the union somebody hoped for.
//
// NO CAPABILITY GATES THIS COLLECTION. Contacts are client-direct and Firestore Rules
// admit admin and dispatcher by ROLE, not by capability — there is no `contact.read` in
// the permission catalog. Declaring one here would be inventing an authority that nothing
// enforces, which §6 forbids more clearly than it forbids having none: metadata declares
// what a caller must hold, and a declaration nothing checks is a false statement about the
// system. The gap is recorded on the entity and in the ledger instead.
//
// NO PROVENANCE, DELIBERATELY UNDECLARED. The invariant says every durable business
// record carries createdAt/createdBy — contacts do not, consistently: the single-add path
// writes neither, CSV import writes createdAt/updatedAt and no actor, and only the sandbox
// seed writes createdBy/updatedBy. Declaring the fields here would assert data that is
// absent from most existing documents. The remediation is a data and write-path change,
// not a metadata claim, and it is recorded as such.

export const contactEntity = makeEntityDefinition({
  id: "contact",
  label: "Contact",
  labelPlural: "Contacts",
  collection: CONTACTS_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role (admin/dispatcher), not by a capability. Recorded as null
  // rather than invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "name" }),
  description: "A person at a customer account. No standalone route; reached through the Account record.",
  fields: [
    makeFieldDefinition({
      id: "name",
      entityId: "contact",
      label: "Name",
      type: "STRING",
      sortable: true,
      description: "A single stored name, not a first/last split. Every write path agrees on this one.",
    }),
    makeFieldDefinition({ id: "email", entityId: "contact", label: "Email", type: "STRING" }),
    makeFieldDefinition({ id: "phone", entityId: "contact", label: "Phone", type: "STRING" }),
    // Free text, not an enum. The CSV importer accepts a "Role" column and nothing
    // constrains its values, so declaring an enum here would reject data the app itself
    // creates — describing reality, not correcting it in the wrong layer.
    makeFieldDefinition({
      id: "role",
      entityId: "contact",
      label: "Role",
      type: "STRING",
      description: "Free text. No canonical vocabulary exists; the importer accepts any value.",
    }),
    makeFieldDefinition({
      id: "isPrimary",
      entityId: "contact",
      label: "Primary",
      type: "BOOLEAN",
      description: "Uniqueness is NOT enforced by storage — more than one contact can carry it, and the Account surface reports that rather than hiding it.",
    }),
    makeFieldDefinition({
      id: "accountId",
      entityId: "contact",
      label: "Customer",
      type: "REFERENCE",
      referenceTo: "account",
      filterable: true,
      operators: ["EQUALS"],
      description: "The parent scope. Every read of contacts is account-scoped.",
    }),
  ],
  // No outbound relationships. account.contacts points FROM Account, so it is declared
  // there — the contract requires a relationship to live on its owning entity, which is
  // what stops the same edge being declared twice with two different viaFields.
});

/**
 * The Account record's Contacts section.
 *
 * RELATED, not INDEX: there is no standalone contacts route, and one has never existed.
 * A RELATED surface caps its rows and hands off rather than paging, which is right here —
 * an account with more contacts than a section can show has an organizational question,
 * not a paging one.
 */
export const contactRelatedList = makeListViewDefinition({
  id: "account.contacts",
  entityId: "contact",
  label: "Contacts",
  surface: "RELATED",
  parentRelationshipId: "account.contacts",
  viewAllListId: "contact.index",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "role" }),
    makeColumn({ fieldId: "email" }),
    makeColumn({ fieldId: "phone" }),
    makeColumn({ fieldId: "isPrimary" }),
  ],
  // No declared filters. The parent scope is applied by the runtime from the
  // relationship, and nothing else about a contact is indexed — claiming a role filter
  // would promise a query no index serves over a field with no vocabulary.
  filters: [],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  // Alphabetical is right for a section a person scans for a name, unlike a queue.
  pageSize: 25,
});

/**
 * The full contacts list — the handoff target the section needs.
 *
 * A RELATED section must be able to say "view all", and the contract enforces it: a
 * capped section with nowhere to go presents its cap as the whole set. Contacts had no
 * such target, and the honest fix is to define one rather than to exempt the section.
 *
 * NO ROUTE RENDERS THIS YET. A definition is not a surface, and defining it now is what
 * makes the section's handoff a real promise instead of a dangling id. Scoped by account
 * in practice, because that is the only query the collection supports.
 */
export const contactIndexList = makeListViewDefinition({
  id: "contact.index",
  entityId: "contact",
  label: "Contacts",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "name", sortable: true }),
    makeColumn({ fieldId: "role" }),
    makeColumn({ fieldId: "email" }),
    makeColumn({ fieldId: "phone" }),
    makeColumn({ fieldId: "accountId" }),
  ],
  filters: [makeFilter({ fieldId: "accountId", operators: ["EQUALS"] })],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  pageSize: 50,
  savedViews: [makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true })],
});
