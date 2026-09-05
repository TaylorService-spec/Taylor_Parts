import { makeEntityDefinition, makeFieldDefinition, makeIdentity } from "../entityDefinition.js";
import { makeColumn, makeFilter, makeListViewDefinition, makeSavedView, makeSort } from "../listViewDefinition.js";
import { EMPLOYEES_COLLECTION } from "../../domain/constants.js";
import {
  EMPLOYMENT_STATUS_VALUES, EMPLOYMENT_STATUS_LABEL,
  OPERATIONAL_ROLES, OPERATIONAL_ROLE_LABEL,
} from "../../domain/employeeVocabulary.js";

// Employee — the authoritative workforce identity (docs/PROJECT_ARCHITECTURE.md's Person
// Assignment Platform Service Standard, docs/BusinessEntityModel.md Section 8a), read from
// docs/specifications/employee-foundation.md's Data model, functions/scripts/
// provisionEmployeeAccess.js (the collection's only writer), domain/employees.js (the only
// reader), firestore.rules' employees/{employeeId} match block, and the two composite
// indexes already declared in firestore.indexes.json for `employees`. S-ADM-EMPLOYEES-
// DEFINITION — the entity id workOrder.js's assignedTechId, salesOrder.js's ownerEmployeeId
// and opportunity.js's owner field already reference as `referenceTo: "employee"`, so THIS
// is what those references have been pointing at since before it existed.
//
// IDENTITY IS A nameField ONLY, DELIBERATELY NO referenceField. `displayName` is the human
// name every write path sets (`employeeDoc.displayName`, provisionEmployeeAccess.js) and
// every consumer reads (useEmployeeDirectory.js resolves actor uids TO it). There is no
// employee-number-like business reference anywhere in this schema — `employeeId` is the
// document id, and the spec's own comment on it says so explicitly ("doc ID, technical,
// immutable -- never a name"). Promoting it to referenceField would be exactly the
// document-id-as-identity fallback DECISIONS #106 forbids reintroducing, the same
// reasoning equipment.js applies to serialNumber/assetTag (both present but neither a real,
// enforced reference) — here there is not even an optional candidate to reject, only the
// doc id itself, which stays declared separately (see next paragraph) rather than promoted.
//
// employeeId IS ALSO A STORED FIELD, DECLARED AS ITS OWN ID-TYPE FIELD — THE SAME SHAPE
// part.js's partId TAKES. Every employeeDoc write in provisionEmployeeAccess.js sets
// `employeeId` inside the document body, not only as the Firestore doc id
// (`{ employeeId, displayName, ... }`, both the create-without-access and grant-access
// branches). UNLIKE Part, nothing enforces the two agree — there is no
// employeeFromFirestore-style read guard here, no MalformedStoredRecordError if they ever
// drifted. Declared as ID, not filterable or sortable (nothing queries it by anything the
// document id does not already serve), with that gap named rather than assumed away.
//
// NO CAPABILITY GATES THIS COLLECTION. firestore.rules' employees/{employeeId} allow-read
// is three role/relationship-shaped OR branches — isAdminOrDispatcher() (directory), a
// self-read (`userData().employeeId == employeeId`), and a narrowly-scoped PARTS_MANAGER
// assignment-candidate read gated on the requesting Employee's OWN operationalRoles — never
// a capability id. There is no `employee.read` in the capability catalog. Declaring one
// here would be inventing an authority nothing enforces, the same finding contact.js,
// part.js and equipment.js already record for their own collections. readCapability is
// therefore null.
//
// TWO READ PATHS EXIST; THIS DEFINITION DESCRIBES THE DIRECTORY ONE. The self-read path
// (a signed-in user resolving their OWN linked Employee via AuthContext) is a single-
// document, identity-scoped read with no list shape — nothing an EntityDefinition /
// ListViewDefinition pair describes. readVia CLIENT_DIRECT and the index below describe
// the admin/dispatcher directory read (buildEmployeeDirectoryQuery()) and the assignment-
// eligibility read (buildAssignableEmployeesQuery()), both of which are unfiltered-or-
// role-gated collection queries a runtime could actually page.
//
// PROVENANCE: createdAt/updatedAt ARE DECLARED, AS NUMBER, NOT TIMESTAMP — NO ACTOR FIELDS
// EXIST AT ALL. provisionEmployeeAccess.js writes both via `Date.now()` (epoch
// milliseconds), never a Firestore Timestamp — the same storage shape equipment.js's
// X-EQUIPMENT-PROVENANCE-GAP already names for its own collection. There is no
// createdBy/updatedBy anywhere in the spec's Data model, the provisioning script, or
// firestore.rules — not a write-path gap to remediate later (as contact.js's is), but a
// field that was never part of this schema's design at all. Both are left undeclared for
// the same reason equipment.js leaves them undeclared: a definition claiming them would
// assert data no document has ever carried.
//
// TWO CLOSED ENUMS, BOTH VOCABULARY-SOURCED FROM THE NEW domain/employeeVocabulary.js
// (created alongside this definition — see its own header for why). employmentStatus's
// six machine values were already canonical in domain/constants.js
// (EMPLOYMENT_STATUS) with no label map; operationalRoles' eight-value write-time
// vocabulary (functions/scripts/provisionEmployeeAccess.js's VALID_OPERATIONAL_ROLES) had
// no client-side copy at all — domain/constants.js's OPERATIONAL_ROLE carries only the
// three values one eligibility check consumes today, not the full stored vocabulary. See
// employeeVocabulary.js for why all eight are declared here rather than three.
//
// operationalRoles IS ENUM_SET, THE SAME SHAPE account.js's relationshipTypes TAKES. The
// stored value is an array (`employee.operationalRoles is list`, firestore.rules), an
// Employee can hold more than one role, and ENUM_SET exists for exactly this — a scalar
// ENUM here would let a caller declare an equality filter no scalar query could match.
// ARRAY_CONTAINS only, for the same reason account.js gives: Firestore permits at most one
// array filter per query, and declaring ARRAY_CONTAINS_ANY too would invite a combination
// no declared index serves.
//
// securityRole IS DECLARED, RENDERED BUT NOT FILTERED. A real, stored, denormalized
// READ-ONLY mirror of `users/{uid}.role` (Inventory Operational Queue A0,
// docs/BusinessEntityModel.md Section 8a) — but no query anywhere filters by it server-
// side; the one consumer that cares (useAssignableEmployees.js's
// applyPartsAssociateSecurityRoleEligibility()) filters the already-fetched snapshot
// client-side. Declaring a backend filter here would promise a query the collection has
// never actually needed to serve — the same restraint part.js applies to stockingUnit.
//
// assignedWarehouseIds, companyId/departmentId/locationId ARE DELIBERATELY NOT DECLARED.
// assignedWarehouseIds (Issue #226, WAREHOUSE_MANAGER scoped access) is a real, stored
// array of warehouse document ids, gating firestore.rules' isAssignedToWarehouse() — but
// v1's FIELD_TYPE has nothing that fits an array of REFERENCE ids (ENUM_SET requires a
// closed, enumerable vocabulary; a warehouse id set is neither closed nor enumerable, and
// no `warehouse` EntityDefinition is registered anywhere in this program yet regardless).
// The same gap salesOrder.js's `lines` and part.js's `flags` leave undeclared rather than
// approximated. companyId/departmentId/locationId are, per the specification itself,
// "Future -- reserved, unused this sprint" — every write path (both employeeDoc branches
// in provisionEmployeeAccess.js) sets all three to `null` unconditionally, with no input
// that could set them to anything else. A FieldDefinition for a field no code path can
// currently populate would describe a promise, not a stored reality; the gap is recorded
// here rather than declared as three permanently-null columns.

export const employeeEntity = makeEntityDefinition({
  id: "employee",
  label: "Employee",
  labelPlural: "Employees",
  collection: EMPLOYEES_COLLECTION,
  readVia: "CLIENT_DIRECT",
  // Rules gate this by role/relationship (admin/dispatcher directory, self-read, or a
  // narrow PARTS_MANAGER candidate read), not by a capability. Recorded as null rather
  // than invented — see the header.
  readCapability: null,
  identity: makeIdentity({ nameField: "displayName" }),
  description: "The authoritative workforce identity — separate from users/{uid}'s application-access identity. Linked to a User by an Admin-SDK-only, two-way pointer pair.",
  fields: [
    // The document id, declared rather than left implicit — see the header. Also
    // written into the document body itself, unlike most of this program's ID fields,
    // though nothing enforces the two stay equal.
    makeFieldDefinition({
      id: "employeeId",
      entityId: "employee",
      label: "Employee ID",
      type: "ID",
      description: "The Firestore document id, also written into the document body by provisionEmployeeAccess.js. Nothing enforces the two match.",
    }),
    makeFieldDefinition({
      id: "displayName",
      entityId: "employee",
      label: "Name",
      type: "STRING",
      sortable: true,
      description: "The human name every write path sets and every consumer resolves an actor uid to. The nameField half of identity.",
    }),
    makeFieldDefinition({
      id: "firstName",
      entityId: "employee",
      label: "First Name",
      type: "STRING",
      description: "Optional, string | null (spec Data model). No consumer reads this independently of displayName today.",
    }),
    makeFieldDefinition({
      id: "lastName",
      entityId: "employee",
      label: "Last Name",
      type: "STRING",
      description: "Optional, string | null (spec Data model). No consumer reads this independently of displayName today.",
    }),
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // ADMINISTRATION USERS CONSOLIDATION -- the profile fields the governed write command
    // (functions/src/access/employeeProfileCommands.ts) can now set. Every one is nullable and
    // every existing record legitimately lacks all of them: nothing backfills, nothing invents a
    // value, and a record provisioned before these existed renders honest absences rather than
    // blanks pretending to be data.
    //
    // employeeNumber IS NOT employeeId, AND THAT IS THE WHOLE POINT. `employeeId` above is the
    // Firestore document id -- the spec's own comment calls it "technical, immutable -- never a
    // name". Taylor's human-facing Employee ID had no home in this schema at all, so promoting the
    // document id into that role would have been exactly the document-id-as-identity fallback
    // DECISIONS #106 forbids. This is a separate, nullable, business-facing field, labelled
    // "Employee ID" in the UI while the technical id stays internal.
    //
    // STILL NO referenceField ON identity. employeeNumber is optional and unenforced -- no writer
    // requires it, no uniqueness constraint exists, and most records will not have one for a long
    // time. Promoting an optional field to the entity's governed reference is the same mistake
    // equipment.js declines for serialNumber/assetTag, for the same reason.
    makeFieldDefinition({
      id: "employeeNumber",
      entityId: "employee",
      label: "Employee ID",
      type: "STRING",
      description: "The BUSINESS-facing employee number, nullable. Distinct from employeeId (the technical document id) and deliberately not a governed reference: optional, unenforced, and absent on every record provisioned before this field existed.",
    }),
    makeFieldDefinition({
      id: "middleName",
      entityId: "employee",
      label: "Middle Name",
      type: "STRING",
      description: "Optional, string | null.",
    }),
    makeFieldDefinition({
      id: "preferredName",
      entityId: "employee",
      label: "Preferred Name",
      type: "STRING",
      description: "Optional, string | null. What this person is called; displayName remains the identity nameField.",
    }),
    makeFieldDefinition({
      id: "workEmail",
      entityId: "employee",
      label: "Work Email",
      type: "STRING",
      description: "Optional, string | null. A contact fact on the workforce record -- NOT an authentication identity (that lives in Firebase Auth against users/{uid}).",
    }),
    makeFieldDefinition({
      id: "workPhone",
      entityId: "employee",
      label: "Work Phone",
      type: "STRING",
      description: "Optional, string | null.",
    }),
    makeFieldDefinition({
      id: "mobilePhone",
      entityId: "employee",
      label: "Mobile Phone",
      type: "STRING",
      description: "Optional, string | null.",
    }),
    makeFieldDefinition({
      id: "jobTitle",
      entityId: "employee",
      label: "Job Title",
      type: "STRING",
      description: "Optional, string | null. Descriptive only: a job title determines no permission, no operational role and no security role.",
    }),
    // RELATIONAL, not display text. The stored value is another employee's document id, so the
    // record page renders the manager as a link to that person's own User Detail and a rename
    // follows automatically. The trusted command validates the referenced document exists.
    //
    // Declared as a plain ID rather than a REFERENCE for the reason userId is: a REFERENCE this
    // registry can resolve needs the target entity's reference contract, and employee identity is
    // a nameField only -- there is no governed reference to point at.
    makeFieldDefinition({
      id: "managerEmployeeId",
      entityId: "employee",
      label: "Manager",
      type: "ID",
      description: "Nullable employees/{employeeId} pointer to this person's manager. Validated for existence by the trusted write command; never free-form display text.",
    }),
    // The governed operating-company id (domain/operatingCompanyAuthority.js). Declared as ID,
    // not ENUM: that authority's own contract requires additional companies to be addable without
    // a schema change, so a closed enumValues list here would contradict it.
    //
    // companyId/departmentId/locationId REMAIN UNDECLARED -- see the header. This is not the same
    // field: companyId was the spec's reserved, permanently-null placeholder, while
    // operatingCompanyId names an authority that actually exists and can resolve.
    makeFieldDefinition({
      id: "operatingCompanyId",
      entityId: "employee",
      label: "Operating Company",
      type: "ID",
      description: "Nullable governed operating-company id (taylor | ventana today). Resolved through domain/operatingCompanyAuthority.js -- never inferred from an Account's line of business.",
    }),
    // ISO calendar day strings, NOT timestamps. "Hired on the 3rd" is a calendar day; giving it an
    // instant invents a timezone the record never had. Declared STRING rather than DATE for the
    // same reason: the stored value is "2026-09-04", and a DATE-typed field would promise a
    // temporal value this collection does not store.
    makeFieldDefinition({
      id: "hireDate",
      entityId: "employee",
      label: "Hire Date",
      type: "STRING",
      description: "Optional ISO calendar day (YYYY-MM-DD), stored as a string. Not a timestamp.",
    }),
    makeFieldDefinition({
      id: "separationDate",
      entityId: "employee",
      label: "Separation Date",
      type: "STRING",
      description: "Optional ISO calendar day (YYYY-MM-DD), stored as a string. Independent of EOS account status, which lives in Firebase Auth and is changed only by setUserStatus.",
    }),
    // The postal address, as one nested map. Its five sub-keys are addressed individually by the
    // trusted command (address.city, ...) so a change to a city audits as a change to a city --
    // but the metadata layer has no nested-field type, so it is declared as the one field it is
    // rather than five it is not.
    makeFieldDefinition({
      id: "address",
      entityId: "employee",
      label: "Address",
      type: "STRING",
      description: "Nullable nested map { street, unit, city, state, postalCode }. Rendered field-by-field by the record page; v1 FIELD_TYPE has no nested-object member, so it is declared as a single field rather than approximated as five.",
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
      description: "The authoritative Employee lifecycle field -- there is no `active` boolean anywhere in this schema (spec Design decision). ACTIVE is the only Phase 3 assignment-eligibility value.",
    }),
    makeFieldDefinition({
      id: "operationalRoles",
      entityId: "employee",
      label: "Operational Roles",
      type: "ENUM_SET",
      enumValues: [...OPERATIONAL_ROLES],
      enumLabels: OPERATIONAL_ROLE_LABEL,
      filterable: true,
      // ARRAY_CONTAINS only -- see the header.
      operators: ["ARRAY_CONTAINS"],
      description: "Multi-valued: an Employee can hold more than one operational role. Eligibility markers for assignment, never a security role (see securityRole below).",
    }),
    makeFieldDefinition({
      id: "securityRole",
      entityId: "employee",
      label: "Security Role",
      type: "STRING",
      description: "Denormalized, READ-ONLY mirror of users/{uid}.role (Section 8a). Rendered, not filtered -- see the header. May be null/missing on records provisioned before this mirror existed.",
    }),
    // No `user` entity is registered anywhere in this program yet, so this stays a
    // plain reference id rather than a REFERENCE this registry cannot resolve -- the
    // same restraint part.js applies to primaryManufacturerId.
    makeFieldDefinition({
      id: "userId",
      entityId: "employee",
      label: "Linked User",
      type: "STRING",
      description: "Nullable link to users/{uid} (spec Data model). Written exclusively by provisionEmployeeAccess.js; no `user` entity is registered in this program yet.",
    }),
    // NUMBER, not TIMESTAMP -- see the header's provenance note. No createdBy/updatedBy
    // exist; this schema never carried them.
    makeFieldDefinition({
      id: "createdAt",
      entityId: "employee",
      label: "Created",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds (provisionEmployeeAccess.js writes Date.now()), never a Firestore Timestamp. No createdBy is stored -- see the header.",
    }),
    makeFieldDefinition({
      id: "updatedAt",
      entityId: "employee",
      label: "Updated",
      type: "NUMBER",
      sortable: true,
      description: "Epoch milliseconds, never a Firestore Timestamp. No updatedBy is stored -- see the header.",
    }),
  ],
  // No outbound relationships declared. Every known inbound reference (Work Order
  // assignedTechId, Sales Order ownerEmployeeId, Opportunity's owner field) points AT
  // employee and is declared on ITS OWNING entity, per the same rule account.js's edges
  // follow. Employee itself has no declared one-hop edge to another registered entity.
});

/**
 * The Employee directory -- admin/dispatcher's assignment-eligible register.
 *
 * No standalone route renders this yet -- a definition is not a surface -- but it is
 * defined now, mirroring the restraint contact.index and part.index already apply, so a
 * future route (or the picker/directory reads that already exist) has a real target.
 *
 * employmentStatus and operationalRoles are the two declared filters, matching the two
 * real backend queries this collection already serves: buildAssignableEmployeesQuery()
 * (domain/employees.js) filters by exactly these two, and firestore.indexes.json already
 * declares BOTH composites that query needs (employmentStatus+userId,
 * employmentStatus+operationalRoles CONTAINS+userId) -- though sorted by userId there, an
 * artifact of the `!=` existence check, not a column a directory UI would sort by. This
 * list instead sorts by displayName (the human name, matching identity), the same
 * restraint equipment.index applies over its own accountId/status pair: two optional
 * equality-shaped filters (one scalar, one array) are three composites (neither / either /
 * both), all three NET NEW against firestore.indexes.json's two existing employees
 * composites -- see REGISTRATION_PENDING in this program's handoff. A third optional
 * filter is deliberately not added, the same Work Order lesson equipment.js and part.js
 * both cite.
 */
export const employeeIndexList = makeListViewDefinition({
  id: "employee.index",
  entityId: "employee",
  label: "Employees",
  surface: "INDEX",
  columns: [
    makeColumn({ fieldId: "displayName", sortable: true }),
    makeColumn({ fieldId: "employmentStatus", sortable: true }),
    makeColumn({ fieldId: "operationalRoles" }),
    // EOS ACCESS, rendered from the field that can actually prove something.
    //
    // The column answers "does this person have an EOS account", because that is what this client
    // is able to know. Whether that account is ENABLED or DISABLED is Firebase Auth state, and no
    // governed read of another user's account status exists -- so the page states that rather than
    // inferring it from employment status, which would show a CONTRACTOR who legitimately holds
    // access as switched off. The label is overridden here and the raw uid never reaches a cell:
    // AdminUsers.jsx maps this cell to the words a person reads.
    makeColumn({ fieldId: "userId", label: "EOS Access" }),
    makeColumn({ fieldId: "securityRole" }),
  ],
  filters: [
    makeFilter({ fieldId: "employmentStatus", operators: ["EQUALS", "IN"] }),
    makeFilter({ fieldId: "operationalRoles", operators: ["ARRAY_CONTAINS"] }),
  ],
  // Alphabetical by name -- a directory scanned for a person, the same reasoning
  // contact.index and equipment.index give for their own name-ordered defaults, not an
  // activity queue.
  defaultSort: [makeSort({ fieldId: "displayName", direction: "ASC" })],
  pageSize: 50,
  savedViews: [
    makeSavedView({ id: "recent", label: "Recently viewed", kind: "RECENTLY_VIEWED", isDefault: true }),
    makeSavedView({
      id: "active",
      label: "Active",
      filters: [{ fieldId: "employmentStatus", operator: "EQUALS", value: "ACTIVE" }],
      sort: [makeSort({ fieldId: "displayName", direction: "ASC" })],
    }),
  ],
});
