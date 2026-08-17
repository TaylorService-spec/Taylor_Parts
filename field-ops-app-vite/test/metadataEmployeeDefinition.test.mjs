// Employee entity + employee.index — S-ADM-EMPLOYEES-DEFINITION.
//
// Pins INTENDED behavior for the entity every assignedTechId / ownerEmployeeId reference
// already points at: identity honest about having no reference field, provenance
// described exactly as provisionEmployeeAccess.js stores it (numbers, no actors),
// operationalRoles as a genuine ENUM_SET, securityRole recorded as a mirror rather than
// an authority, and the declared filter set restrained to what stays reviewable — not the
// seven-composite explosion the Work Order lesson warns against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { employeeEntity, employeeIndexList } from "../src/metadata/definitions/employee.js";
import {
  EMPLOYMENT_STATUS_VALUES, EMPLOYMENT_STATUS_LABEL,
  OPERATIONAL_ROLE_VALUES, OPERATIONAL_ROLE_LABEL,
  SECURITY_ROLE_VALUES, SECURITY_ROLE_LABEL,
} from "../src/domain/employeeVocabulary.js";
import { EMPLOYMENT_STATUS, OPERATIONAL_ROLE, ROLES } from "../src/domain/constants.js";

test("the Employee entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(employeeEntity), []);
});

test("the Employee index list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(employeeIndexList, employeeEntity), []);
});

test("identity is a nameField, with NO referenceField and NO document-id field declared", () => {
  // displayName is the only human name this schema has, and no employee-number or other
  // business reference exists anywhere in the write path (DECISIONS #106 forbids
  // promoting an unenforced field into a referenceField).
  assert.equal(employeeEntity.identity.nameField, "displayName");
  assert.equal(employeeEntity.identity.referenceField, null);
  assert.ok(findField(employeeEntity, "displayName"));
  // Unlike Part's partId, no employees/{employeeId} document stores its own id as a
  // field — buildPlan()'s employeeDoc never sets one.
  assert.equal(findField(employeeEntity, "employeeId"), null);
});

test("no capability gates this collection -- Rules admit by role/self, not by capability", () => {
  assert.equal(employeeEntity.readCapability, null);
});

test("createdAt/updatedAt are declared NUMBER, and no actor fields exist", () => {
  // provisionEmployeeAccess.js writes both via Date.now() -- epoch milliseconds, never a
  // Firestore Timestamp. Declaring TIMESTAMP here would assert storage semantics this
  // record does not have.
  const createdAt = findField(employeeEntity, "createdAt");
  const updatedAt = findField(employeeEntity, "updatedAt");
  assert.equal(createdAt.type, "NUMBER");
  assert.equal(updatedAt.type, "NUMBER");
  assert.notEqual(createdAt.type, "TIMESTAMP");
  assert.notEqual(updatedAt.type, "TIMESTAMP");
  // provisionEmployeeAccess.js never sets either actor field on any write path.
  for (const name of ["createdBy", "updatedBy"]) {
    assert.equal(findField(employeeEntity, name), null, name);
  }
});

test("operationalRoles is an ENUM_SET, not a scalar ENUM", () => {
  // The stored value is an array -- an Employee can hold more than one operational role
  // at once, the same shape account.js's relationshipTypes already established.
  const field = findField(employeeEntity, "operationalRoles");
  assert.equal(field.type, "ENUM_SET");
  assert.equal(field.filterable, true);
  assert.deepEqual([...field.operators], ["ARRAY_CONTAINS"]);
});

test("securityRole is declared but NOT filterable -- it is a mirror, never a query target", () => {
  // No Firestore query in this codebase filters by securityRole; the picker's
  // PARTS_ASSOCIATE eligibility check runs entirely client-side, post-fetch, over
  // useAssignableEmployees.js's applyPartsAssociateSecurityRoleEligibility().
  const field = findField(employeeEntity, "securityRole");
  assert.equal(field.type, "ENUM");
  assert.equal(field.filterable, false);
  assert.deepEqual([...field.operators], []);
  assert.match(field.description, /mirror/i);
  assert.match(field.description, /users\/\{uid\}\.role/);
});

test("userId stays a plain STRING, rendered not filtered -- no user entity is registered", () => {
  const field = findField(employeeEntity, "userId");
  assert.equal(field.type, "STRING");
  assert.notEqual(field.type, "REFERENCE");
  assert.equal(field.filterable, false);
});

test("assignedWarehouseIds is rendered only, the same shape account.js's tags already established", () => {
  const field = findField(employeeEntity, "assignedWarehouseIds");
  assert.equal(field.type, "STRING");
  assert.equal(field.filterable, false);
  assert.deepEqual([...field.operators], []);
});

test("no outbound relationships are declared -- every existing edge points AT Employee, not from it", () => {
  assert.equal(employeeEntity.relationships.length, 0);
});

test("employmentStatus vocabulary comes from the domain module, not a copy here", () => {
  const field = findField(employeeEntity, "employmentStatus");
  assert.deepEqual([...field.enumValues], [...EMPLOYMENT_STATUS_VALUES]);
  assert.deepEqual({ ...field.enumLabels }, { ...EMPLOYMENT_STATUS_LABEL });
  // The six real machine values, exactly -- no invented seventh state.
  assert.deepEqual(new Set(field.enumValues), new Set(Object.values(EMPLOYMENT_STATUS)));
});

test("operationalRoles vocabulary comes from the domain module, not a copy here", () => {
  const field = findField(employeeEntity, "operationalRoles");
  assert.deepEqual([...field.enumValues], [...OPERATIONAL_ROLE_VALUES]);
  assert.deepEqual({ ...field.enumLabels }, { ...OPERATIONAL_ROLE_LABEL });
  assert.deepEqual(new Set(field.enumValues), new Set(Object.values(OPERATIONAL_ROLE)));
});

test("securityRole vocabulary comes from the domain module, not a copy here", () => {
  const field = findField(employeeEntity, "securityRole");
  assert.deepEqual([...field.enumValues], [...SECURITY_ROLE_VALUES]);
  assert.deepEqual({ ...field.enumLabels }, { ...SECURITY_ROLE_LABEL });
  assert.deepEqual(new Set(field.enumValues), new Set(Object.values(ROLES)));
});

test("the index list declares exactly the two evidenced dimensions, not a third that would explode the index count", () => {
  // firestore.indexes.json already proves employmentStatus and operationalRoles combine
  // in one real composite. userId is deliberately left undeclared as a filter here (see
  // the definition file header) -- adding it as a third independently optional filter
  // would multiply this to seven composites, the exact Work Order lesson this program
  // exists to avoid repeating.
  const filterIds = employeeIndexList.filters.map((f) => f.fieldId);
  assert.deepEqual(filterIds, ["employmentStatus", "operationalRoles"]);
  assert.equal(requiredIndexes(employeeIndexList, employeeEntity).length, 3);
});

test("every required index is a NEW demand -- none reproduces an existing declaration verbatim", () => {
  // Both indexes already in firestore.indexes.json include userId, which this
  // definition does not filter on; both also lack the displayName sort this list
  // declares. So none of the three composites this list demands is byte-identical to
  // what is already deployed -- see REGISTRATION_PENDING in the lane handoff.
  const required = requiredIndexes(employeeIndexList, employeeEntity);
  const declaredShapes = [
    "employmentStatus:ASCENDING,userId:ASCENDING",
    "employmentStatus:ASCENDING,operationalRoles:CONTAINS,userId:ASCENDING",
  ];
  for (const idx of required) {
    const key = idx.fields
      .filter((f) => f.fieldPath !== "__name__")
      .map((f) => `${f.fieldPath}:${f.arrayConfig ?? f.order}`)
      .join(",");
    assert.ok(!declaredShapes.includes(key), `unexpectedly matches an existing declaration: ${key}`);
  }
});

test("the directory sorts alphabetically by name, not like an operational queue", () => {
  assert.deepEqual(employeeIndexList.defaultSort, [{ fieldId: "displayName", direction: "ASC" }]);
});
