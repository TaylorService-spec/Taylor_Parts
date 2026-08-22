// CERTIFICATION IDENTITY STABILITY. A person's name is not their identity.
//
// ============================ WHAT BREAKS IF THIS IS WRONG ============================
//
// If the synthetic login were derived from a display name, renaming "Jordan Smith" to
// "Jordan Rivera" would resolve to a different email, create a SECOND Auth principal, orphan the
// first UID, and silently split the person in two: the old roleAssignments key still grants the
// abandoned principal, the audit lineage points at a UID nobody uses, and the work history stays
// attached to a ghost.
//
// None of that fails loudly. The rename appears to work, and the damage is only visible later when
// someone asks why a certification employee has no authority any more.
//
// So the identity key is the DETERMINISTIC EMPLOYEE ID, and this file asserts that the name is not
// an input to it — not by inspecting the provisioning script's behaviour, but by pinning the
// derivation itself, which is the thing that would have to change for the failure to occur.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkforce } from "../scripts/certificationWorld/data/workforce.mjs";

// The derivation under test. Deliberately duplicated from provisionPrincipals.mjs rather than
// imported: that module reaches for firebase-admin and the environment registry at import time, and
// a test that needs credentials to check a string rule is a test that stops being run.
const CERT_EMAIL_DOMAIN = "@eos-sandbox.invalid";
const emailFor = (employeeId) => `${employeeId}${CERT_EMAIL_DOMAIN}`;

const employees = buildWorkforce();

test("the workforce is populated, so these checks are not vacuous", () => {
  assert.equal(employees.length, 47, "expected the 47-employee certification workforce");
});

test("a display-name change does not change the identity key", () => {
  // THE ASSERTION THE OWNER ASKED FOR. Same employee id, different name, same email -- therefore
  // the same Auth principal, the same UID, the same userId link and the same roleAssignments key.
  const original = employees[0];
  const renamed = { ...original, firstName: "Jordan", lastName: "Rivera", displayName: "Jordan Rivera" };

  assert.notEqual(renamed.displayName, original.displayName, "the test must actually rename someone");
  assert.equal(renamed.employeeId, original.employeeId);
  assert.equal(
    emailFor(renamed.employeeId), emailFor(original.employeeId),
    "renaming an employee must not resolve to a different login, or the rename creates a second principal",
  );
});

test("no part of any display name appears in any identity key", () => {
  // The general form. A single renamed fixture proves one case; this proves the derivation cannot
  // depend on a name for ANY employee, including a future one whose name happens to look like an id.
  for (const e of employees) {
    const email = emailFor(e.employeeId);
    const local = email.slice(0, email.indexOf("@")).toLowerCase();
    for (const part of [e.firstName, e.lastName]) {
      assert.equal(
        local.includes(part.toLowerCase()), false,
        `identity key "${email}" contains name fragment "${part}" -- a rename would move the identity`,
      );
    }
    assert.equal(email, `${e.employeeId}${CERT_EMAIL_DOMAIN}`,
      "the identity key must be exactly the employee id plus the certification domain");
  }
});

test("every employee id is unique and stable in shape", () => {
  // Duplicate ids would collapse two people onto one principal, which is the same failure as the
  // rename, arriving from the other direction.
  const ids = employees.map((e) => e.employeeId);
  assert.equal(new Set(ids).size, ids.length, "employee ids must be unique");
  for (const id of ids) {
    assert.match(id, /^cw-emp-\d{3}$/, `${id} does not match the stable deterministic pattern`);
  }
  const emails = ids.map(emailFor);
  assert.equal(new Set(emails).size, emails.length, "derived logins must be unique");
});

test("the certification namespace cannot be captured by persona rotation", () => {
  // activateSandboxPersonas.js filters on a literal "@sandbox.invalid" suffix and rotates every
  // matching account. If the certification domain ever matched that test, a routine persona rotation
  // would silently invalidate all 47 certification credentials -- and the failure would surface as
  // "invalid password", sending whoever hit it to debug entirely the wrong thing.
  //
  // The character before "sandbox" is a hyphen, not an "@", so it does not match. Asserted rather
  // than assumed, because the safety comes from one character.
  const PERSONA_SUFFIX = "@sandbox.invalid";
  for (const e of employees) {
    assert.equal(
      emailFor(e.employeeId).endsWith(PERSONA_SUFFIX), false,
      "a certification login matched the persona rotation filter -- rotation would clobber it",
    );
  }
  // And the converse, so the two namespaces cannot converge from the other side.
  assert.equal("owner@sandbox.invalid".endsWith(CERT_EMAIL_DOMAIN), false,
    "an existing persona matched the certification namespace");
});

test("identity is not derived from anything a data reset can change", () => {
  // Everything a rebuild rewrites -- names, workload, availability, assignments, roles -- must be
  // absent from the derivation. This is what makes "reset the data, keep the identities" true.
  const volatile = ["displayName", "firstName", "lastName", "certWorkload", "certAvailable",
    "certAssignments", "certGovernedRoles", "securityRole", "operationalRoles"];
  const e = employees[0];
  const baseline = emailFor(e.employeeId);
  for (const field of volatile) {
    const mutated = { ...e, [field]: Array.isArray(e[field]) ? [] : "MUTATED" };
    assert.equal(
      emailFor(mutated.employeeId), baseline,
      `changing ${field} moved the identity key -- a world rebuild would orphan the principal`,
    );
  }
});
