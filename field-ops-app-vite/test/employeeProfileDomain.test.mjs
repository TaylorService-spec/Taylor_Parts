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
  EMPLOYEE_EDIT_RESULT,
  EMPLOYEE_EVENT_LABELS,
  EMPLOYEE_FIELD_LABELS,
  EMPLOYEE_TARGET_TYPE,
  EOS_ACCESS,
  MANAGER_CHANGE,
  NEVER_SENT_EMPLOYEE_KEYS,
  PROFILE_FIELDS,
  changedProfileFields,
  describeEmployeeEditResult,
  employeeCompanyName,
  employeeDisplayName,
  employeeNameIsAbsent,
  employeeSubtitle,
  employmentFields,
  eosAccessState,
  identityFields,
  managerChange,
  newTrustedIdempotencyKey,
  operationalRoleLabels,
  readField,
  readProfileField,
  saveEmployeeEdit,
  securityRoleWords,
  seedEditValues,
  validateProfileValues,
} from "../src/domain/employeeProfile.js";

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

// The governed PostgreSQL record (EMP-RT-01 readEmployee) -- the shape the editor seeds from and diffs against.
const JOHN_REC = Object.freeze({
  employeeId: "emp-1",
  employmentStatus: "ACTIVE",
  operatingCompanyId: "taylor",
  employeeNumber: "TAZ-0042",
  displayName: "John Smith",
  name: { displayName: "John Smith", firstName: "John", middleName: null, lastName: "Smith", preferredName: null },
  jobTitle: "Senior Service Technician",
  contact: { workEmail: "john@taylor.test", workPhone: null, mobilePhone: null },
  address: { street: null, unit: null, city: "Phoenix", state: "AZ", postalCode: null },
  hireDate: "2020-03-02",
  separationDate: null,
  currentManager: { managerEmployeeId: "emp-2", displayName: "Mike Jones", effectiveFrom: "2026-01-05T00:00:00.000Z" },
  userAccess: "LINKED",
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
  const editable = PROFILE_FIELDS.map((f) => f.key);
  assert.ok(editable.includes("employeeNumber"));
  assert.ok(!editable.includes("employeeId"), "the technical document id is immutable");
  assert.equal(EMPLOYEE_FIELD_LABELS.employeeNumber, "Employee ID");
});

// ════════════════════ the independence rules ════════════════════

test("Security Role, lifecycle, eligibility and the manager are not PROFILE fields of this surface", () => {
  const editable = PROFILE_FIELDS.map((f) => f.key);
  for (const forbidden of ["securityRole", "role", "userId", "accountStatus", "jobRole", ...NEVER_SENT_EMPLOYEE_KEYS, "managerEmployeeId"]) {
    assert.ok(!editable.includes(forbidden), `${forbidden} must not be an editable profile field`);
  }
  // It is still RENDERED -- as the mirror it is.
  assert.equal(securityRoleWords(JOHN), "Technician");
});

test("no edit of any value can put a lifecycle, eligibility or access key into the profile change set", () => {
  const values = { ...seedEditValues(JOHN_REC), employmentStatus: "TERMINATED", operatingCompanyId: "ventana", operationalRoles: ["TECHNICIAN"], securityRole: "admin", jobTitle: "Lead" };
  const changes = changedProfileFields(values, JOHN_REC);
  assert.deepEqual(changes, { jobTitle: "Lead" });
  for (const key of NEVER_SENT_EMPLOYEE_KEYS) assert.ok(!(key in changes), key);
  assert.ok(!("managerEmployeeId" in changes), "the manager is a relationship, never a profile change");
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

test("the editor seeds from the governed PostgreSQL record shape, not the Firestore document", () => {
  const values = seedEditValues(JOHN_REC);
  assert.equal(values.displayName, "John Smith");
  assert.equal(values.firstName, "John");
  assert.equal(values.workEmail, "john@taylor.test");
  assert.equal(values["address.city"], "Phoenix");
  assert.equal(values.hireDate, "2020-03-02");
  assert.equal(values.separationDate, "");
  assert.equal(values.managerEmployeeId, "emp-2");
  assert.deepEqual(Object.keys(values).sort(), [...PROFILE_FIELDS.map((f) => f.key), "managerEmployeeId"].sort());
  // The STORED display name, not the read's derived one.
  assert.equal(readProfileField({ displayName: "Derived", name: { displayName: null } }, "displayName"), null);
});

test("a save sends ONLY what changed, compared against the record the form was seeded from", () => {
  const values = seedEditValues(JOHN_REC);
  assert.deepEqual(changedProfileFields(values, JOHN_REC), {}, "an untouched form changes nothing");

  values.jobTitle = "Service Manager";
  assert.deepEqual(changedProfileFields(values, JOHN_REC), { jobTitle: "Service Manager" });
});

test("whitespace is not a change, and a cleared field is an ABSENCE rather than an empty string", () => {
  const values = seedEditValues(JOHN_REC);
  values.jobTitle = "  Senior Service Technician  ";
  assert.deepEqual(changedProfileFields(values, JOHN_REC), {}, "trimming to the same value is no change");

  values.jobTitle = "";
  assert.deepEqual(changedProfileFields(values, JOHN_REC), { jobTitle: null });
});

test("a nested address key diffs as its own field", () => {
  const values = { ...seedEditValues(JOHN_REC), "address.city": "Tucson" };
  assert.deepEqual(changedProfileFields(values, JOHN_REC), { "address.city": "Tucson" });
  assert.equal(readField(JOHN, "address.city"), "Phoenix");
  assert.equal(readField(JOHN, "address.postalCode"), undefined);
});

test("the manager change is its own decision: unchanged, established, or ended", () => {
  const seed = seedEditValues(JOHN_REC);
  assert.equal(managerChange(seed, JOHN_REC).action, MANAGER_CHANGE.NONE);
  assert.deepEqual(managerChange({ ...seed, managerEmployeeId: "emp-3" }, JOHN_REC), { action: MANAGER_CHANGE.ESTABLISH, managerEmployeeId: "emp-3" });
  assert.deepEqual(managerChange({ ...seed, managerEmployeeId: "" }, JOHN_REC), { action: MANAGER_CHANGE.END, managerEmployeeId: null });
  const noManager = { ...JOHN_REC, currentManager: null };
  assert.equal(managerChange(seedEditValues(noManager), noManager).action, MANAGER_CHANGE.NONE);
  assert.equal(managerChange({ ...seedEditValues(noManager), managerEmployeeId: "emp-2" }, noManager).action, MANAGER_CHANGE.ESTABLISH);
});

// ════════════════════ validation ════════════════════

test("a recorded display name cannot be cleared, but a record with none stored is not blocked", () => {
  assert.ok(validateProfileValues({ ...seedEditValues(JOHN_REC), displayName: "  " }, JOHN_REC).displayName);
  const derivedOnly = { ...JOHN_REC, name: { ...JOHN_REC.name, displayName: null } };
  assert.equal(validateProfileValues(seedEditValues(derivedOnly), derivedOnly).displayName, undefined);
  // Lifecycle and eligibility are not validated here, because they are not edited here.
  const errors = validateProfileValues({ ...seedEditValues(JOHN_REC), employmentStatus: "PROBATION", operationalRoles: ["SUPERVISOR"] }, JOHN_REC);
  assert.deepEqual(errors, {});
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

  // The pattern is the ENFORCING one, read from the governed PostgreSQL vocabulary rather than restated.
  const enforcing = readFileSync(
    fileURLToPath(new URL("../../functions/src/eosWorkforce/employeeProfileVocabulary.ts", import.meta.url)),
    "utf8",
  );
  assert.match(enforcing, /EMPLOYEE_NUMBER_PATTERN = \/\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,31\}\$\//);
});

test("a display name is required, and a malformed email or date is caught before a round trip", () => {
  const errors = validateProfileValues({
    ...seedEditValues(JOHN_REC),
    displayName: "   ",
    workEmail: "nope",
    hireDate: "3 March",
  }, JOHN_REC);
  assert.ok(errors.displayName);
  assert.ok(errors.workEmail);
  assert.ok(errors.hireDate);
  assert.deepEqual(validateProfileValues(seedEditValues(JOHN_REC), JOHN_REC), {});
});

// ════════════════════ references and honest absence ════════════════════

test("the operating company resolves through the governed authority, never through free text", () => {
  assert.equal(employeeCompanyName(JOHN), "Taylor Freezer of Arizona");
  assert.equal(employeeCompanyName({ operatingCompanyId: null }), null);
  assert.equal(employeeCompanyName({ operatingCompanyId: "not-a-company" }), null);
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
  // Every editable field has a label, so no Change History row can render a machine key -- and so do the
  // pre-cutover legacy trail's fields the governed editor no longer writes.
  for (const f of PROFILE_FIELDS) {
    assert.equal(EMPLOYEE_FIELD_LABELS[f.key], f.label, `${f.key} must have display words`);
  }
  for (const legacy of ["managerEmployeeId", "employmentStatus", "operatingCompanyId", "operationalRoles"]) {
    assert.ok(EMPLOYEE_FIELD_LABELS[legacy], `${legacy} must keep display words for legacy history rows`);
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

test("the profile field set matches the governed PostgreSQL writer's vocabulary, so the form cannot offer what it refuses", () => {
  const enforcing = readFileSync(
    fileURLToPath(new URL("../../functions/src/eosWorkforce/employeeProfileVocabulary.ts", import.meta.url)),
    "utf8",
  );
  const block = /PROFILE_FIELD_MAP[\s\S]*?\n\]\);/.exec(enforcing);
  assert.ok(block, "PROFILE_FIELD_MAP must still exist in the governed vocabulary");
  const serverKeys = [...block[0].matchAll(/\["([a-zA-Z.]+)", "[a-z_]+", "[A-Z_]+"\]/g)].map((m) => m[1]);
  assert.equal(serverKeys.length, 17);
  assert.deepEqual(PROFILE_FIELDS.map((f) => f.key), serverKeys, "the form's fields and the writer's enforced fields must be the same, in order");
});

// ════════════════════ the save: governed commands, in order, reported exactly ════════════════════

const fakeWorkforce = (answers = {}) => {
  const calls = [];
  return {
    calls,
    call: async (operation, input) => {
      calls.push([operation, input]);
      const answer = answers[operation];
      return typeof answer === "function" ? answer(input) : answer ?? { ok: false, code: "UNKNOWN_OPERATION" };
    },
  };
};
const UPDATED = (changedFields) => ({ ok: true, result: { outcome: "UPDATED", employeeId: "emp-1", changedFields, auditEventId: "ae-1" } });

test("nothing changed: no command is called", async () => {
  const w = fakeWorkforce();
  const saved = await saveEmployeeEdit({ workforce: w, employeeId: "emp-1", changes: {}, manager: { action: MANAGER_CHANGE.NONE } });
  assert.equal(saved.state, EMPLOYEE_EDIT_RESULT.NOTHING_CHANGED);
  assert.deepEqual(w.calls, []);
  assert.equal(describeEmployeeEditResult(saved).words, "Nothing was changed.");
});

test("profile first, then the manager; the inputs carry no authority and no lifecycle key", async () => {
  const w = fakeWorkforce({
    updateEmployeeProfile: UPDATED(["jobTitle"]),
    establishReportingRelationship: { ok: true, result: { outcome: "CHANGED" } },
  });
  const saved = await saveEmployeeEdit({
    workforce: w,
    employeeId: "emp-1",
    changes: { jobTitle: "Lead", employmentStatus: "TERMINATED" },
    manager: { action: MANAGER_CHANGE.ESTABLISH, managerEmployeeId: "emp-3" },
  });
  assert.equal(saved.state, EMPLOYEE_EDIT_RESULT.SAVED);
  assert.deepEqual(w.calls, [
    ["updateEmployeeProfile", { employeeId: "emp-1", changes: { jobTitle: "Lead" } }],
    ["establishReportingRelationship", { employeeId: "emp-1", managerEmployeeId: "emp-3" }],
  ]);
  const described = describeEmployeeEditResult(saved);
  assert.equal(described.reload, true);
  assert.match(described.words, /^Saved: Job Title, Manager\./);
});

test("a refused profile command stops the save: the manager command is never attempted, nothing is claimed", async () => {
  const w = fakeWorkforce({ updateEmployeeProfile: { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED", status: 403 } });
  const saved = await saveEmployeeEdit({ workforce: w, employeeId: "emp-1", changes: { jobTitle: "Lead" }, manager: { action: MANAGER_CHANGE.END } });
  assert.equal(saved.state, EMPLOYEE_EDIT_RESULT.NOT_SAVED);
  assert.deepEqual(w.calls.map((c) => c[0]), ["updateEmployeeProfile"]);
  assert.deepEqual(describeEmployeeEditResult(saved), { state: "NOT_SAVED", words: "You are not authorized to edit this Employee. Nothing was saved.", reload: false });
});

test("a taken employee number is actionable, and an unreachable service is never called saved or refused", async () => {
  const taken = await saveEmployeeEdit({
    workforce: fakeWorkforce({ updateEmployeeProfile: { ok: false, code: "CONFLICT", reason: "EMPLOYEE_NUMBER_TAKEN", status: 409 } }),
    employeeId: "emp-1",
    changes: { employeeNumber: "TAZ-0099" },
    manager: { action: MANAGER_CHANGE.NONE },
  });
  assert.match(describeEmployeeEditResult(taken).words, /already held by another Employee\. Choose a different one\. Nothing was saved\./);
  const down = await saveEmployeeEdit({
    workforce: fakeWorkforce({ updateEmployeeProfile: { ok: false, code: "UNREACHABLE" } }),
    employeeId: "emp-1",
    changes: { jobTitle: "Lead" },
    manager: { action: MANAGER_CHANGE.NONE },
  });
  assert.equal(down.state, EMPLOYEE_EDIT_RESULT.NOT_CONFIRMED);
  assert.match(describeEmployeeEditResult(down).words, /not confirmed/);
  assert.doesNotMatch(describeEmployeeEditResult(down).words, /Nothing was saved|Saved/);
});

test("profile saved, manager refused: PARTIAL, naming exactly what was saved and what was not", async () => {
  const w = fakeWorkforce({
    updateEmployeeProfile: UPDATED(["jobTitle", "workEmail"]),
    endReportingRelationship: { ok: false, code: "NOT_FOUND", reason: "REPORTING_RELATIONSHIP_NOT_FOUND", status: 404 },
  });
  const saved = await saveEmployeeEdit({ workforce: w, employeeId: "emp-1", changes: { jobTitle: "Lead", workEmail: "j@t.test" }, manager: { action: MANAGER_CHANGE.END } });
  assert.equal(saved.state, EMPLOYEE_EDIT_RESULT.PARTIAL);
  const described = describeEmployeeEditResult(saved);
  assert.equal(described.reload, true);
  assert.equal(
    described.words,
    "The profile changes were saved (Job Title, Work Email). The manager removal was NOT saved: this Employee no longer has a current manager to remove. The record below is re-read from the Employee authority.",
  );
});

test("a profile that converged (NO_CHANGE) and a refused manager is NOT a partial save: nothing was written", async () => {
  const w = fakeWorkforce({
    updateEmployeeProfile: { ok: true, result: { outcome: "NO_CHANGE", employeeId: "emp-1", changedFields: [], auditEventId: null } },
    establishReportingRelationship: { ok: false, code: "NOT_FOUND", reason: "MANAGER_NOT_FOUND", status: 404 },
  });
  const saved = await saveEmployeeEdit({ workforce: w, employeeId: "emp-1", changes: { jobTitle: "Lead" }, manager: { action: MANAGER_CHANGE.ESTABLISH, managerEmployeeId: "emp-x" } });
  assert.equal(saved.state, EMPLOYEE_EDIT_RESULT.NOT_SAVED);
  assert.match(describeEmployeeEditResult(saved).words, /^Nothing was saved: the chosen manager is not an Employee of this company\./);
});
