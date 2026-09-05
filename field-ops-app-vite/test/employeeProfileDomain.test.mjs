// ADMINISTRATION USERS CONSOLIDATION -- the User record's pure domain layer.
//
// Everything the Users surfaces decide about a person -- what their name is, what the header says,
// which fields a save actually sends, what is valid -- lives in domain/employeeProfile.js, so it is
// testable without a DOM and provable without a browser. The properties below are product
// invariants rather than rendering details, which is exactly why they are asserted here and not
// only through a component.
//
// Run: node --test test/employeeProfileDomain.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  EDITABLE_FIELDS,
  EMPLOYEE_EVENT_LABELS,
  EMPLOYEE_FIELD_LABELS,
  EMPLOYEE_TARGET_TYPE,
  EMPLOYMENT_STATUS_OPTIONS,
  EOS_ACCESS,
  OPERATING_COMPANY_OPTIONS,
  OPERATIONAL_ROLE_OPTIONS,
  changedProfileFields,
  employeeCompanyName,
  employeeDisplayName,
  employeeNameIsAbsent,
  employeeSubtitle,
  employmentFields,
  eosAccessState,
  identityFields,
  newTrustedIdempotencyKey,
  operationalRoleLabels,
  readField,
  securityRoleWords,
  seedEditValues,
  validateProfileValues,
} from "../src/domain/employeeProfile.js";
import { OPERATIONAL_ROLES, EMPLOYMENT_STATUS_VALUES } from "../src/domain/employeeVocabulary.js";

const JOHN = Object.freeze({
  id: "emp-1",
  employeeId: "emp-1",
  displayName: "John Smith",
  employmentStatus: "ACTIVE",
  operationalRoles: ["TECHNICIAN", "PARTS_ASSOCIATE"],
  securityRole: "technician",
  userId: "uid-john",
  jobTitle: "Senior Service Technician",
  employeeNumber: "TAZ-0042",
  operatingCompanyId: "taylor",
  managerEmployeeId: "emp-2",
  address: { city: "Phoenix", state: "AZ" },
});

// ════════════════════ identity ════════════════════

test("the display name is a NAME, and an unnamed record never falls back to its document id", () => {
  assert.equal(employeeDisplayName(JOHN), "John Smith");
  assert.equal(employeeDisplayName({ ...JOHN, preferredName: "Jack" }), "Jack");

  const unnamed = { id: "emp-9", employeeId: "emp-9" };
  assert.equal(employeeNameIsAbsent(unnamed), true);
  const shown = employeeDisplayName(unnamed);
  assert.equal(shown, "Unnamed employee");
  assert.ok(!shown.includes("emp-9"), "a document id must never be presented as a person's name");
});

test("the subtitle carries the BUSINESS employee number, never the technical document id", () => {
  const subtitle = employeeSubtitle(JOHN);
  assert.ok(subtitle.includes("TAZ-0042"), "the business employee number is what a person quotes");
  assert.ok(!subtitle.includes("emp-1"), "the Firestore document id is technical and stays internal");

  // A record with no assigned number shows none. Old employees legitimately have none, and
  // inventing one would be fabricating business data.
  const noNumber = employeeSubtitle({ jobTitle: "Installer" });
  assert.equal(noNumber, "Installer");
});

test("employeeNumber and employeeId are different fields, and only one is editable", () => {
  const editable = EDITABLE_FIELDS.map((f) => f.key);
  assert.ok(editable.includes("employeeNumber"));
  assert.ok(!editable.includes("employeeId"), "the technical document id is immutable");
  assert.equal(EMPLOYEE_FIELD_LABELS.employeeNumber, "Employee ID");
});

// ════════════════════ the independence rules ════════════════════

test("Security Role is not editable through this surface at all", () => {
  const editable = EDITABLE_FIELDS.map((f) => f.key);
  for (const forbidden of ["securityRole", "role", "userId", "accountStatus"]) {
    assert.ok(!editable.includes(forbidden), `${forbidden} must not be an editable profile field`);
  }
  // It is still RENDERED -- as the mirror it is.
  assert.equal(securityRoleWords(JOHN), "Technician");
});

test("changing operational roles sends operationalRoles and nothing else", () => {
  const values = { ...seedEditValues(JOHN), operationalRoles: ["TECHNICIAN"] };
  const changes = changedProfileFields(values, JOHN);
  assert.deepEqual(Object.keys(changes), ["operationalRoles"]);
  assert.deepEqual(changes.operationalRoles, ["TECHNICIAN"]);
});

test("changing employment status sends employmentStatus and nothing else", () => {
  const values = { ...seedEditValues(JOHN), employmentStatus: "TERMINATED" };
  const changes = changedProfileFields(values, JOHN);
  assert.deepEqual(Object.keys(changes), ["employmentStatus"]);
  // Nothing here can express "and also disable their account" -- account status is not a field of
  // this payload and there is no code path that would add one.
  assert.ok(!("accountStatus" in changes));
  assert.ok(!("userId" in changes));
});

test("EOS access state is derived from the account LINKAGE, never from employment status", () => {
  assert.equal(eosAccessState(JOHN), EOS_ACCESS.LINKED);
  // A terminated employee whose account is still linked is still LINKED. Whether that account is
  // switched off is a separate fact this client cannot read, and guessing it here is the defect.
  assert.equal(eosAccessState({ ...JOHN, employmentStatus: "TERMINATED" }), EOS_ACCESS.LINKED);
  // A CONTRACTOR with an account holds one -- the case a status-derived answer gets wrong.
  assert.equal(eosAccessState({ ...JOHN, employmentStatus: "CONTRACTOR" }), EOS_ACCESS.LINKED);
  assert.equal(eosAccessState({ ...JOHN, userId: null }), EOS_ACCESS.NO_ACCOUNT);
});

// ════════════════════ the diff ════════════════════

test("a save sends ONLY what changed, compared against the record the form was seeded from", () => {
  const values = seedEditValues(JOHN);
  assert.deepEqual(changedProfileFields(values, JOHN), {}, "an untouched form changes nothing");

  values.jobTitle = "Service Manager";
  assert.deepEqual(changedProfileFields(values, JOHN), { jobTitle: "Service Manager" });
});

test("whitespace is not a change, and a cleared field is an ABSENCE rather than an empty string", () => {
  const values = seedEditValues(JOHN);
  values.jobTitle = "  Senior Service Technician  ";
  assert.deepEqual(changedProfileFields(values, JOHN), {}, "trimming to the same value is no change");

  values.jobTitle = "";
  assert.deepEqual(changedProfileFields(values, JOHN), { jobTitle: null });
});

test("reordering operational roles is not a change", () => {
  const values = { ...seedEditValues(JOHN), operationalRoles: ["PARTS_ASSOCIATE", "TECHNICIAN"] };
  // The seed is ["TECHNICIAN","PARTS_ASSOCIATE"]; both normalize to declared vocabulary order.
  assert.deepEqual(changedProfileFields(values, JOHN), {});
});

test("a nested address key diffs as its own field", () => {
  const values = { ...seedEditValues(JOHN), "address.city": "Tucson" };
  assert.deepEqual(changedProfileFields(values, JOHN), { "address.city": "Tucson" });
  assert.equal(readField(JOHN, "address.city"), "Phoenix");
  assert.equal(readField(JOHN, "address.postalCode"), undefined);
});

// ════════════════════ validation ════════════════════

test("employment status is a closed picklist and operational roles come from the canonical vocabulary", () => {
  assert.deepEqual(EMPLOYMENT_STATUS_OPTIONS.map((o) => o.value), [...EMPLOYMENT_STATUS_VALUES]);
  assert.deepEqual(OPERATIONAL_ROLE_OPTIONS.map((o) => o.value), [...OPERATIONAL_ROLES]);
  assert.ok(OPERATIONAL_ROLE_OPTIONS.every((o) => o.label && o.label !== o.value), "every role has words");

  const bad = validateProfileValues({
    ...seedEditValues(JOHN),
    employmentStatus: "PROBATION",
    operationalRoles: ["SUPERVISOR"],
  });
  assert.ok(bad.employmentStatus);
  assert.ok(bad.operationalRoles);
});

test("the business employee number is a CODE, and the shape rule mirrors the enforcing one", () => {
  // Uniqueness is the command's to enforce (this client cannot check it without reading every
  // employee). SHAPE is checked here so a malformed number is refused before a round trip.
  for (const bad of ["has space", "-leading", "a".repeat(33), "with/slash"]) {
    const errors = validateProfileValues({ ...seedEditValues(JOHN), employeeNumber: bad });
    assert.ok(errors.employeeNumber, `"${bad}" must be refused`);
  }
  for (const good of ["TAZ-0042", "100234", "E.42", "a"]) {
    const errors = validateProfileValues({ ...seedEditValues(JOHN), employeeNumber: good });
    assert.equal(errors.employeeNumber, undefined, `"${good}" must be accepted`);
  }
  // Clearable: a wrongly assigned number must be removable, which releases its claim server-side.
  assert.equal(
    validateProfileValues({ ...seedEditValues(JOHN), employeeNumber: "" }).employeeNumber,
    undefined,
  );

  // The pattern is the ENFORCING one, read from the command rather than restated.
  const enforcing = readFileSync(
    fileURLToPath(new URL("../../functions/src/access/employeeProfileCommands.ts", import.meta.url)),
    "utf8",
  );
  assert.match(enforcing, /EMPLOYEE_NUMBER_PATTERN = \/\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,31\}\$\//);
});

test("a display name is required, and a malformed email or date is caught before a round trip", () => {
  const errors = validateProfileValues({
    ...seedEditValues(JOHN),
    displayName: "   ",
    workEmail: "nope",
    hireDate: "3 March",
  });
  assert.ok(errors.displayName);
  assert.ok(errors.workEmail);
  assert.ok(errors.hireDate);
  assert.deepEqual(validateProfileValues(seedEditValues(JOHN)), {});
});

// ════════════════════ references and honest absence ════════════════════

test("the operating company resolves through the governed authority, never through free text", () => {
  assert.equal(employeeCompanyName(JOHN), "Taylor Freezer of Arizona");
  assert.equal(employeeCompanyName({ operatingCompanyId: null }), null);
  assert.equal(employeeCompanyName({ operatingCompanyId: "not-a-company" }), null);
  assert.deepEqual(OPERATING_COMPANY_OPTIONS.map((o) => o.value).sort(), ["taylor", "ventana"]);
});

test("a recorded-but-unresolvable company reads as UNAVAILABLE, an absent one as NOT RECORDED", () => {
  // Two different facts about the record, and a single blank cell would collapse them.
  const unresolvable = employmentFields({ operatingCompanyId: "acme" }).find((f) => f.label === "Operating Company");
  assert.equal(unresolvable.value, "Unavailable");
  const absent = employmentFields({}).find((f) => f.label === "Operating Company");
  assert.equal(absent.value, "Not recorded");
});

test("missing optional profile fields render honestly rather than as blanks", () => {
  const sparse = identityFields({ displayName: "New Person" });
  const employeeNumber = sparse.find((f) => f.label === "Employee ID");
  assert.equal(employeeNumber.present, false);
  assert.equal(employeeNumber.value, "Not recorded");
  assert.ok(sparse.every((f) => f.value !== ""), "an absent value is stated, never left blank");
});

test("an employee with no operational roles holds none -- that is an answer, not a gap", () => {
  assert.deepEqual(operationalRoleLabels({ operationalRoles: [] }), []);
  assert.deepEqual(operationalRoleLabels({}), []);
  assert.deepEqual(operationalRoleLabels(JOHN), ["Technician", "Parts Associate"]);
});

// ════════════════════ the wiring contracts ════════════════════

test("the trail's targetType and the field labels are the ones the shared history component needs", () => {
  assert.equal(EMPLOYEE_TARGET_TYPE, "employee");
  // Every editable field has a label, so no Change History row can render a machine key.
  for (const f of EDITABLE_FIELDS) {
    assert.equal(EMPLOYEE_FIELD_LABELS[f.key], f.label, `${f.key} must have display words`);
  }
  // And the events that change no single field have words too.
  for (const action of ["setUserStatus", "initiateAdminPasswordReset", "updateEmployeeProfile"]) {
    assert.ok(EMPLOYEE_EVENT_LABELS[action], `${action} must have display words`);
  }
});

test("the idempotency key is narrowed to the alphabet the trusted commands accept", () => {
  // The reset generator's alphabet includes "." and ":", which assertValidIdempotencyKey rejects.
  // One generator, one narrowing -- two call sites each writing their own regex is how one of them
  // ends up producing keys the server refuses only under a value nobody tested.
  for (let i = 0; i < 50; i += 1) {
    const key = newTrustedIdempotencyKey();
    assert.match(key, /^[A-Za-z0-9_-]{8,200}$/, `bad key: ${key}`);
  }
});

test("the editable set matches the trusted command's, so the form cannot offer what it refuses", () => {
  const enforcing = readFileSync(
    fileURLToPath(new URL("../../functions/src/access/employeeProfileCommands.ts", import.meta.url)),
    "utf8",
  );
  const block = /EDITABLE_EMPLOYEE_FIELDS[\s\S]*?\n\] as const\);/.exec(enforcing);
  assert.ok(block, "EDITABLE_EMPLOYEE_FIELDS must still exist in the trusted command");
  const serverKeys = [...block[0].matchAll(/\{ key: "([a-zA-Z.]+)", kind:/g)].map((m) => m[1]);
  assert.deepEqual(
    EDITABLE_FIELDS.map((f) => f.key).sort(),
    serverKeys.sort(),
    "the form's fields and the command's enforced fields must be the same set",
  );
});
