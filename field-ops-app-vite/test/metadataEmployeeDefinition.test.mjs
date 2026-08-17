// Employee entity + employee.index — S-ADM-EMPLOYEES-DEFINITION.
//
// Pins the intended behavior for the entity every existing `referenceTo: "employee"`
// (Work Order assignedTechId, Sales Order ownerEmployeeId, Opportunity's owner field) has
// been pointing at without a definition to resolve against. Honest about what this record
// does NOT have — a business reference number, an actor-attributed provenance pair, a
// registered `warehouse`/`user` entity to point at — rather than idealizing any of them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { employeeEntity, employeeIndexList } from "../src/metadata/definitions/employee.js";
import {
  EMPLOYMENT_STATUS_VALUES, EMPLOYMENT_STATUS_LABEL, employmentStatusLabel,
  OPERATIONAL_ROLES, OPERATIONAL_ROLE_LABEL, operationalRoleLabel,
} from "../src/domain/employeeVocabulary.js";
import { EMPLOYMENT_STATUS } from "../src/domain/constants.js";

test("the Employee entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(employeeEntity), []);
});

test("the Employee index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(employeeIndexList, employeeEntity), []);
});

test("the entity id is exactly \"employee\" -- what every existing referenceTo already points at", () => {
  assert.equal(employeeEntity.id, "employee");
});

test("identity is a nameField only -- no referenceField exists to promote", () => {
  // employeeId is the document id, and the spec's own comment on it says so explicitly:
  // "doc ID, technical, immutable -- never a name." There is no employee-number-like
  // business reference anywhere in this schema. Promoting the doc id would be exactly the
  // fallback DECISIONS #106 forbids reintroducing.
  assert.equal(employeeEntity.identity.nameField, "displayName");
  assert.equal(employeeEntity.identity.referenceField, null);
  assert.ok(findField(employeeEntity, "displayName"));
});

test("employeeId is declared as its own ID field, not promoted into identity", () => {
  const employeeId = findField(employeeEntity, "employeeId");
  assert.equal(employeeId.type, "ID");
  assert.equal(employeeId.filterable, false);
  assert.equal(employeeId.sortable, false);
  assert.notEqual(employeeEntity.identity.nameField, "employeeId");
  assert.notEqual(employeeEntity.identity.referenceField, "employeeId");
});

test("no capability gates this collection -- Rules admit by role/relationship, not by capability", () => {
  assert.equal(employeeEntity.readCapability, null);
});

test("provenance: createdAt/updatedAt are declared NUMBER, and no actor fields exist", () => {
  // provisionEmployeeAccess.js writes Date.now() for both -- epoch milliseconds, never a
  // Firestore Timestamp. Reinterpreting as TIMESTAMP would assert storage semantics this
  // record does not have.
  const createdAt = findField(employeeEntity, "createdAt");
  const updatedAt = findField(employeeEntity, "updatedAt");
  assert.equal(createdAt.type, "NUMBER");
  assert.equal(updatedAt.type, "NUMBER");
  assert.notEqual(createdAt.type, "TIMESTAMP");
  assert.notEqual(updatedAt.type, "TIMESTAMP");
  // Neither the spec's Data model, provisionEmployeeAccess.js, nor firestore.rules ever
  // names a createdBy/updatedBy field on this collection -- not a write-path gap to
  // remediate, a field this schema never had.
  for (const name of ["createdBy", "updatedBy"]) {
    assert.equal(findField(employeeEntity, name), null, name);
  }
});

test("fields with no fitting v1 type or no registered target entity stay undeclared", () => {
  // assignedWarehouseIds is a real, stored array of warehouse ids (Issue #226) -- but v1
  // has no type for an array of REFERENCE ids, and no `warehouse` entity is registered
  // anywhere in this program regardless. companyId/departmentId/locationId are, per the
  // specification, "Future -- reserved, unused this sprint" -- every write path sets all
  // three to null unconditionally, so a FieldDefinition for them would describe a promise,
  // not a stored reality.
  for (const name of ["assignedWarehouseIds", "companyId", "departmentId", "locationId"]) {
    assert.equal(findField(employeeEntity, name), null, name);
  }
});

test("employmentStatus vocabulary comes from the domain module, not a copy here", () => {
  const status = findField(employeeEntity, "employmentStatus");
  assert.deepEqual([...status.enumValues], [...EMPLOYMENT_STATUS_VALUES]);
  assert.deepEqual({ ...status.enumLabels }, { ...EMPLOYMENT_STATUS_LABEL });
  // The six real machine values, exactly -- no invented seventh state.
  assert.deepEqual(new Set(status.enumValues), new Set(Object.values(EMPLOYMENT_STATUS)));
});

test("employmentStatusLabel renders real words for every stored value", () => {
  assert.equal(employmentStatusLabel(EMPLOYMENT_STATUS.ACTIVE), "Active");
  assert.equal(employmentStatusLabel(EMPLOYMENT_STATUS.ON_LEAVE), "On Leave");
  assert.equal(employmentStatusLabel(EMPLOYMENT_STATUS.CONTRACTOR), "Contractor");
  // Unrecognized values pass through verbatim rather than silently defaulting.
  assert.equal(employmentStatusLabel("SOMETHING_ELSE"), "SOMETHING_ELSE");
});

test("operationalRoles is ENUM_SET -- an Employee can hold more than one role", () => {
  const roles = findField(employeeEntity, "operationalRoles");
  assert.equal(roles.type, "ENUM_SET");
  assert.deepEqual([...roles.enumValues], [...OPERATIONAL_ROLES]);
  assert.deepEqual({ ...roles.enumLabels }, { ...OPERATIONAL_ROLE_LABEL });
  // ARRAY_CONTAINS only -- Firestore permits at most one array filter per query, and
  // ARRAY_CONTAINS_ANY would invite a combination no declared index serves.
  assert.deepEqual([...roles.operators], ["ARRAY_CONTAINS"]);
});

test("the full 8-value operational-role vocabulary is declared, not just the 3 with a live consumer today", () => {
  // domain/constants.js' OPERATIONAL_ROLE carries only PARTS_MANAGER/WAREHOUSE_MANAGER/
  // PARTS_ASSOCIATE (the three an eligibility check consumes). The stored field's real,
  // write-time vocabulary is functions/scripts/provisionEmployeeAccess.js's
  // VALID_OPERATIONAL_ROLES, which accepts five more. A stored, legally-written
  // "SERVICE_MANAGER" must still resolve to a label, not fall through undeclared.
  assert.equal(OPERATIONAL_ROLES.length, 8);
  for (const role of ["TECHNICIAN", "WAREHOUSE_ASSOCIATE", "SERVICE_MANAGER", "SALES_MANAGER", "SALES_ASSOCIATE"]) {
    assert.ok(OPERATIONAL_ROLES.includes(role), role);
    assert.notEqual(operationalRoleLabel(role), role, `${role} should have a real label, not fall through verbatim`);
  }
});

test("securityRole is declared but not filterable -- rendered, never a backend filter", () => {
  // Only one consumer (useAssignableEmployees.js) reads securityRole at all, and it
  // filters an already-fetched client-side snapshot -- no query anywhere filters by it
  // server-side, so declaring a filter here would promise a query the collection has
  // never needed to serve.
  const securityRole = findField(employeeEntity, "securityRole");
  assert.equal(securityRole.type, "STRING");
  assert.equal(securityRole.filterable, false);
  assert.deepEqual([...securityRole.operators], []);
});

test("userId stays a plain string -- no `user` entity is registered in this program", () => {
  const userId = findField(employeeEntity, "userId");
  assert.equal(userId.type, "STRING");
  assert.notEqual(userId.type, "REFERENCE");
});

test("no outbound relationships are declared -- every known inbound edge is owned elsewhere", () => {
  assert.equal(employeeEntity.relationships.length, 0);
});

test("the index list declares exactly the two filters the real backend queries already use", () => {
  // buildAssignableEmployeesQuery() (domain/employees.js) filters by employmentStatus and
  // optionally operationalRoles -- the same two fields, nothing more.
  const filterIds = employeeIndexList.filters.map((f) => f.fieldId).sort();
  assert.deepEqual(filterIds, ["employmentStatus", "operationalRoles"]);
});

test("two optional filters (one equality, one array) demand exactly three composite indexes", () => {
  // Neither / employmentStatus only / operationalRoles only / both -- the "neither" case
  // is served by the single-field sort's automatic index, so three composites remain, all
  // net-new against firestore.indexes.json's two existing `employees` composites (which
  // are shaped for buildAssignableEmployeesQuery()'s userId-ordered existence check, not
  // this list's displayName-ordered directory sort).
  const required = requiredIndexes(employeeIndexList, employeeEntity);
  assert.equal(required.length, 3);
  for (const idx of required) assert.equal(idx.collectionGroup, "employees");
});
