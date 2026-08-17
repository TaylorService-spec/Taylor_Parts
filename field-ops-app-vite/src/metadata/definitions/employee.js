import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { EMPLOYEES_COLLECTION } from "../../domain/constants.js";
import {
  EMPLOYMENT_STATUS_VALUES, EMPLOYMENT_STATUS_LABEL,
  OPERATIONAL_ROLE_VALUES, OPERATIONAL_ROLE_LABEL,
  SECURITY_ROLE_VALUES, SECURITY_ROLE_LABEL,
} from "../../domain/employeeVocabulary.js";

// Employee — S-ADM-EMPLOYEES-DEFINITION. The entity Work Order's assignedTechId and
// Opportunity's ownerEmployeeId already declare `referenceTo: "employee"` against, before
// this file existed to make that id resolvable to anything.
//
// PHASE 3 — PLATFORM ASSIGNMENT FOUNDATION (docs/specifications/employee-foundation.md).
// employees/{employeeId} is Admin-SDK-only to write (firestore.rules: `allow create,
// update, delete: if false`, unconditionally, no admin exception). The ONE writer is
// functions/scripts/provisionEmployeeAccess.js; this definition describes exactly the
// document shape that script produces (buildPlan()'s employeeDoc/employeeUpdates), not an
// aspirational schema.
//
// IDENTITY IS A NAME, WITH NO REFERENCE FIELD. displayName is the only human-facing name
// this schema has, and provisionEmployeeAccess.js requires it to create a record at all
// (`--displayName is required to create it`). No employee-number, badge id, or other
// business reference exists anywhere in the write path or in Rules — grepped across
// src/, functions/src/ and functions/scripts/ and found none (the "EMP-1"/"SBX-EMP-..."
// strings that do exist, e.g. sandbox fixtures, are the document id itself, not a stored
// field). Per DECISIONS #106, an optional or unenforced string must not be promoted into
// a referenceField merely because it looks like one — here there is not even a candidate.
//
// THE DOCUMENT ID ITSELF IS NOT DECLARED AS A FIELD. Unlike Part (whose partId is a
// genuinely stored, enforced-equal-to-the-doc-id column — partFromFirestore throws if
// they diverge), no employees/{employeeId} document stores its own id as a field:
// buildPlan()'s employeeDoc has no `employeeId` key. Declaring one here would claim a
// stored column that does not exist — the same restraint equipment.js and contact.js
// apply to their own Firestore-assigned ids.
//
// NO CAPABILITY GATES THIS COLLECTION. firestore.rules' `match /employees/{employeeId}`
// admits: isAdminOrDispatcher() (unconditional directory read), OR
// `userData().employeeId == employeeId` (self-read), OR a PARTS_MANAGER reading ONLY
// Employee docs matching the exact assignment-candidate contract (ACTIVE +
// PARTS_ASSOCIATE-eligible + linked user) — three role/self-scoped branches, never a
// capability id. There is no `employee.read` in the permission catalog. Declaring one
// would be inventing an authority nothing enforces — the same finding contact.js and
// part.js already made for their own collections. readCapability is therefore null.
//
// PROVENANCE: createdAt/updatedAt EXIST, AS NUMBERS, NEVER A FIRESTORE TIMESTAMP.
// buildPlan() writes both via `const now = Date.now()` — epoch milliseconds, the exact
// X-EQUIPMENT-PROVENANCE-GAP shape equipment.js already found one collection over.
// createdBy/updatedBy DO NOT EXIST AT ALL: grepped provisionEmployeeAccess.js for both
// names and found zero occurrences — no actor is recorded on either write. Declaring
// createdBy/updatedBy here would assert data absent from every document this collection
// has ever held; the gap is recorded, not papered over with an invented TIMESTAMP pair.
//
// THREE ENUMS, ONE NEW VOCABULARY MODULE. employmentStatus (EMPLOYMENT_STATUS),
// operationalRoles (OPERATIONAL_ROLE) and securityRole (ROLES) are all closed sets already
// named in domain/constants.js, but nothing in this client had ever turned any of the
// three into words a person reads — scouted and confirmed absent before creating
// domain/employeeVocabulary.js. That module is the one canonical source these three
// FieldDefinitions cite; this file carries no label map of its own.
//
// operationalRoles IS AN ARRAY — ENUM_SET, not ENUM, the same shape account.js's
// relationshipTypes already established for exactly this case (a stored value that is a
// list of enum members, not a single one).
//
// securityRole IS A DENORMALIZED, READ-ONLY MIRROR, NEVER AN AUTHORITY. It mirrors
// users/{uid}.role for query/display convenience only (provisionEmployeeAccess.js's
// SECURITY-ROLE MIRROR note; docs/BusinessEntityModel.md §8a) — firestore.rules enforces
// every real permission via users/{uid}.role directly, never via this field. It is
// declared ENUM (closed set, VALID_SECURITY_ROLES in useAssignableEmployees.js already
// enforces membership) but NOT filterable: no Firestore query in this codebase filters by
// it (the picker's PARTS_ASSOCIATE eligibility check in useAssignableEmployees.js runs
// entirely CLIENT-SIDE, post-fetch, over the already-loaded page — see
// applyPartsAssociateSecurityRoleEligibility() — never as a `where()` clause), so no index
// exists or is claimed for it.
//
// userId STAYS A PLAIN STRING, NOT A REFERENCE. No `user` entity is registered anywhere
// in this metadata program yet — the same restraint part.js applies to
// primaryManufacturerId and equipment.js applies to locationId. It is also NOT declared
// filterable here, even though buildAssignableEmployeesQuery() (domain/employees.js) does
// run a real `where("userId", "!=", null)` clause, evidenced by firestore.indexes.json's
// `employmentStatus+userId` composite: that clause is a picker-specific "has app access"
// implementation detail of ONE narrow consumer, not a filter value a person picks from a
// general Employee list — declaring it here would be a control with no meaningful values
// to type, the same category of restraint workOrder.js applies to assignedTechId
// ("Rendered, not filtered").
//
// assignedWarehouseIds IS AN ARRAY OF PLAIN IDS, RENDERED NOT FILTERED — same shape
// account.js's `tags` already established: declared so a column can show it, no operators
// claimed, no `warehouse` entity registered in this program to point a REFERENCE at.
//
// firestore.indexes.json ALREADY DECLARES TWO COMPOSITE INDEXES ON `employees` —
// (employmentStatus, userId) and (employmentStatus, operationalRoles CONTAINS, userId) —
// which is how this file confirms employmentStatus/operationalRoles/userId are the real,
// already-queried field names (not a guess), and that employmentStatus + operationalRoles
// legitimately combine in one composite. Neither existing index is reproduced verbatim
// below: both include userId, which — per the restraint above — this definition does not
// expose as a list filter. THE WORK ORDER LESSON: three independently optional filters
// (employmentStatus, operationalRoles, userId) would multiply out to seven composites,
// most of them unreviewable and unevidenced. Keeping the declared filter set to the two
// genuinely list-worthy dimensions (employmentStatus, operationalRoles) — mirroring
// equipment.js's own two-optional-filter shape exactly — keeps the demand at three, all of
// them justified by evidence even though none is byte-identical to what is already
// deployed. See REGISTRATION_PENDING in this lane's handoff.

export const employeeEntity = makeEntityDefinition({
  id: "employee",
  label: "Employee",
  labelPlural: "Employees",
  collection: EMPLOYEES_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role/self, not by a capability. Recorded as null rather than
  // invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "displayName" }),
  description:
    "A workforce identity record — Platform Assignment Foundation Phase 3. Admin-SDK-write-only; " +
    "the target every assignedTechId / ownerEmployeeId reference already points at.",
  fields: [
    makeFieldDefinition({
      id: "displayName",
      entityId: "employee",
      label: "Name",
      type: "STRING",
      sortable: true,
      description: "Required to create the record. The only name field in this schema — see the header.",
    }),
    makeFieldDefinition({
      id: "employmentStatus",
      entityId: "employee",
      label: "Employment Status",
      type: "ENUM",
      enumValues: [...EMPLOYMENT_STATUS_VALUES],
      enumLabels: EMPLOYMENT_STATUS_LABEL,
      filterable: true,
      sortable: true,
      operators: ["EQUALS", "IN"],
      description:
        "The authoritative Employee lifecycle field — no `active` boolean exists. ACTIVE is the only " +
        "assignment-eligibility value; the other five are reserved non-eligible states.",
    }),
    makeFieldDefinition({
      id: "operationalRoles",
      entityId: "employee",
      label: "Operational Roles",
      type: "ENUM_SET",
      enumValues: [...OPERATIONAL_ROLE_VALUES],
      enumLabels: OPERATIONAL_ROLE_LABEL,
      filterable: true,
      // ARRAY_CONTAINS only — the same restraint account.js's relationshipTypes applies:
      // Firestore permits one array filter per query, and claiming
      // ARRAY_CONTAINS_ANY too would invite a combination no declared index serves.
      operators: ["ARRAY_CONTAINS"],
      description: "Multi-valued: an Employee can hold more than one operational role at once.",
    }),
    makeFieldDefinition({
      id: "securityRole",
      entityId: "employee",
      label: "Security Role",
      type: "ENUM",
      enumValues: [...SECURITY_ROLE_VALUES],
      enumLabels: SECURITY_ROLE_LABEL,
      description:
        "A denormalized, READ-ONLY mirror of users/{uid}.role, written only by " +
        "provisionEmployeeAccess.js. Never an authority — firestore.rules enforces every real " +
        "permission via users/{uid}.role directly. Not filterable: no query in this codebase " +
        "filters by it (the picker's eligibility check runs client-side, post-fetch). Optional — " +
        "absent until an Employee is granted application access.",
    }),
    makeFieldDefinition({
      id: "userId",
      entityId: "employee",
      label: "Linked User",
      type: "STRING",
      description:
        "The reciprocal link to users/{uid}, written only by provisionEmployeeAccess.js. No `user` " +
        "entity is registered in this program yet, so this stays a plain id, not a REFERENCE. " +
        "Rendered, not filtered — see the header for why buildAssignableEmployeesQuery's real " +
        "userId!=null clause is not translated into a declared list filter here.",
    }),
    makeFieldDefinition({
      id: "assignedWarehouseIds",
      entityId: "employee",
      label: "Assigned Warehouses",
      type: "STRING",
      description:
        "Array of warehouse ids scoping WAREHOUSE_MANAGER access (Issue #226). No `warehouse` " +
        "entity is registered in this program yet; rendered only, no operators claimed — the same " +
        "shape account.js's `tags` already established for its own unclaimed array field.",
    }),
    // NUMBER, not TIMESTAMP — see X-EQUIPMENT-PROVENANCE-GAP-shaped finding in the file
    // header. No createdBy/updatedBy: neither is stored anywhere on this collection.
    makeFieldDefinition({
      id: "createdAt",
      entityId: "employee",
      label: "Created",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds (provisionEmployeeAccess.js's `Date.now()`), never a Firestore Timestamp.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "employee",
      label: "Updated",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds, never a Firestore Timestamp. No updatedBy is stored.",
    }),
  ],
  // No outbound relationships declared. Every edge touching Employee today points AT it
  // (workOrder.assignedTechId, opportunity.ownerEmployeeId) — Employee itself owns no
  // related list in this lane's scope.
});

/**
 * The general Employee directory — no standalone route renders this yet, the same
 * restraint contact.index and equipment.index apply: a definition is not a surface, but
 * it gives a future route a real target instead of a dangling id.
 *
 * employmentStatus and operationalRoles are the two declared filters, mirroring
 * equipment.js's restraint exactly: two optional filters demand three composites, and a
 * third optional filter (userId, deliberately left undeclared — see the file header)
 * would push that toward the seven-composite explosion the Work Order lesson warns
 * against. ALL THREE are new demands — see REGISTRATION_PENDING in this lane's handoff.
 */
export const employeeIndexList = makeListViewDefinition({
  id: "employee.index",
  entityId: "employee",
  label: "Employees",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "displayName", sortable: true }),
    makeColumn({ fieldId: "employmentStatus" }),
    makeColumn({ fieldId: "operationalRoles" }),
    makeColumn({ fieldId: "securityRole" }),
  ],
  filters: [
    makeFilter({ fieldId: "employmentStatus", operators: ["EQUALS", "IN"] }),
    makeFilter({ fieldId: "operationalRoles", operators: ["ARRAY_CONTAINS"] }),
  ],
  // Alphabetical by name — a directory is scanned for a person, not read top-down like an
  // operational queue, the same reasoning equipment.index and contact.index already apply.
  defaultSort: [makeSort({ fieldId: "displayName", direction: "ASC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active employees",
      filters: [{ fieldId: "employmentStatus", operator: "EQUALS", value: "ACTIVE" }],
      sort: [makeSort({ fieldId: "displayName", direction: "ASC" })],
    }),
  ],
  rowNavigationTo: "/employees/:id",
});
