// The contact CSV import, as a pure decision.
//
// The builder carries what the browser used to decide: the four provenance fields, the row bound,
// the isPrimary rule, and which fields survive at all. Tested offline -- no emulator, no Firestore.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImportedContacts,
  MAX_IMPORT_ROWS,
} from "../lib/crm/contactImportCommand.js";

const CTX = { actorUid: "uid-actor", nowMillis: 1_700_000_000_000 };
const rows = [
  { name: "Ada", email: "ada@x.com" },
  { name: "  Grace  ", phone: "555", role: "Buyer" },
];

test("provenance is the SERVER's: the resolved actor and one clock, on every row", () => {
  const built = buildImportedContacts("account-1", rows, CTX);
  assert.equal(built.length, 2);
  for (const c of built) {
    assert.equal(c.createdBy, "uid-actor");
    assert.equal(c.updatedBy, "uid-actor");
    assert.equal(c.createdAt, CTX.nowMillis);
    assert.equal(c.updatedAt, CTX.nowMillis);
  }
  // ONE clock across the batch, not N. Rows imported together share a timestamp, so the import
  // stays legible afterwards as a single act rather than as N arrivals microseconds apart -- the
  // behaviour the client's single `now` already had.
  assert.equal(built[0].createdAt, built[1].createdAt);
});

test("a caller cannot author provenance, even by sending it", () => {
  // The old client path read `auth.currentUser`; a payload field is the equivalent forgery here.
  // The builder reads ctx and never the row, so there is nothing for such a field to reach.
  const built = buildImportedContacts(
    "account-1",
    [{ name: "Ada", createdBy: "uid-someone-else", createdAt: 1, isPrimary: true, accountId: "other-account" }],
    CTX,
  );
  assert.equal(built[0].createdBy, "uid-actor");
  assert.equal(built[0].createdAt, CTX.nowMillis);
  assert.equal(built[0].accountId, "account-1", "the account is the command's argument, not a row field");
});

test("an imported contact is never primary", () => {
  // Primary is chosen per-contact in the UI. An import electing one would silently demote whoever
  // held it.
  const built = buildImportedContacts("account-1", [{ name: "Ada", isPrimary: true }], CTX);
  assert.equal(built[0].isPrimary, false);
});

test("optional fields become null, never empty strings or undefined", () => {
  const built = buildImportedContacts("account-1", [{ name: "Ada", phone: "   ", email: "" }], CTX);
  assert.equal(built[0].phone, null);
  assert.equal(built[0].email, null);
  assert.equal(built[0].role, null);
  // A whitespace-only phone stored as "   " reads as a phone number that is present and blank,
  // which is a different claim from "we do not have one".
});

test("names are trimmed, and a nameless row is refused rather than created", () => {
  assert.equal(buildImportedContacts("account-1", rows, CTX)[1].name, "Grace");
  for (const bad of [{ name: "   " }, { name: "" }, {}, { name: 42 }]) {
    assert.throws(
      () => buildImportedContacts("account-1", [bad], CTX),
      (e) => e.code === "ROW_INVALID",
      `${JSON.stringify(bad)} must be refused`,
    );
  }
});

test("the row bound is enforced HERE, because this is now the only write path", () => {
  const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `C${i}` }));
  assert.throws(
    () => buildImportedContacts("account-1", many, CTX),
    (e) => e.code === "TOO_MANY_ROWS",
  );
  // Exactly at the bound is allowed -- an off-by-one here would refuse a legitimate full import.
  assert.equal(buildImportedContacts("account-1", many.slice(0, MAX_IMPORT_ROWS), CTX).length, MAX_IMPORT_ROWS);
});

test("an empty import and a missing account are each refused by their own code", () => {
  assert.throws(
    () => buildImportedContacts("account-1", [], CTX),
    (e) => e.code === "NO_ROWS",
  );
  for (const bad of [null, undefined, "", "   "]) {
    assert.throws(
      () => buildImportedContacts(bad, rows, CTX),
      (e) => e.code === "ACCOUNT_REQUIRED",
    );
  }
});

test("the built row carries exactly the ten fields the client wrote, and nothing else", () => {
  // Pins the stored shape. A field added here silently changes what an import produces, and a field
  // dropped changes it just as silently -- the reason this asserts the whole key set rather than
  // spot-checking a few.
  assert.deepEqual(Object.keys(buildImportedContacts("account-1", [{ name: "Ada" }], CTX)[0]).sort(), [
    "accountId",
    "createdAt",
    "createdBy",
    "email",
    "isPrimary",
    "name",
    "phone",
    "role",
    "updatedAt",
    "updatedBy",
  ]);
});
