// EOS Data Import P1 -- Customers.
//
// The Customer contract, the derived document id, and the two mirrors this entity depends
// on that nothing else in import does: the client's `nameLower` derivation, and the
// governed-create baseline firestore.rules enforces for everyone else.
//
// SEEDED SYNTHETIC DATA ONLY.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeCustomerRow,
  CUSTOMER_CANONICAL_FIELDS,
  CUSTOMER_REQUIRED_FIELDS,
  CUSTOMER_STATUSES,
  CUSTOMER_IMPORT_CONTRACT,
} from "../lib/dataImport/contracts/customerImportContract.js";
import { entityContractFor, wiredEntityContracts } from "../lib/dataImport/contracts/entityContract.js";
import { detectEntityType, validateMapping, parseSourceFile, isEntityWired } from "../lib/dataImport/importIntake.js";
import { buildEntityPreview } from "../lib/dataImport/importPreview.js";
import { normalizeAccountSearchName, GOVERNED_ACCOUNT_FIELDS } from "../lib/account/accountImportCommand.js";
import { deriveImportedAccountId } from "../lib/dataImport/firestoreDataImportAdapters.js";

const row = (values) => ({ sourceRowNumber: values.__row ?? 2, values });

// --------------------------------------------------------------- contract

test("a clean customer row normalizes, defaulting status to ACTIVE", () => {
  const { draft, findings } = normalizeCustomerRow({
    name: "  Mesquite Soda Works  ",
    customerNumber: "C-1001",
    billingAddress: "1 Main St, Dallas TX",
  });

  assert.equal(draft.name, "Mesquite Soda Works");
  assert.equal(draft.status, "ACTIVE");
  assert.equal(draft.customerNumber, "C-1001");
  assert.equal(findings.length, 0);
});

test("a missing name is an ERROR -- without it the row has no identity", () => {
  const { draft, findings } = normalizeCustomerRow({ customerNumber: "C-1", billingAddress: "x" });
  assert.equal(draft, null);
  assert.ok(findings.some((f) => f.severity === "ERROR" && f.field === "name"));
});

test("a missing billing address WARNS and still imports", () => {
  const { draft, findings } = normalizeCustomerRow({ name: "Acme" });
  // Refusing the row would block an import over a field EOS does not require; saying nothing
  // would let an invoicing gap arrive silently. A warning is the only honest third option.
  assert.ok(draft, "the customer must still import");
  assert.ok(findings.some((f) => f.severity === "WARNING" && f.field === "billingAddress"));
});

test("spreadsheet status vocabulary is translated, and an unknown one is refused", () => {
  for (const [input, expected] of [["Y", "ACTIVE"], ["no", "INACTIVE"], ["Lead", "PROSPECT"], ["ACTIVE", "ACTIVE"]]) {
    assert.equal(normalizeCustomerRow({ name: "Acme", status: input, billingAddress: "x" }).draft.status, expected);
  }
  const bad = normalizeCustomerRow({ name: "Acme", status: "PLATINUM", billingAddress: "x" });
  // Not defaulted to ACTIVE: a status nobody recognises is a fact about the file, and
  // guessing would make a PROSPECT look like a customer somebody can invoice.
  assert.equal(bad.draft, null);
  assert.ok(bad.findings.some((f) => f.code === "INVALID_ENUM"));
});

test("an over-long name is REFUSED, never truncated", () => {
  const { draft, findings } = normalizeCustomerRow({ name: "X".repeat(300), billingAddress: "x" });
  // A truncated name is a different customer -- and would then fail to match the one already
  // in EOS, creating the very duplicate import exists to avoid.
  assert.equal(draft, null);
  assert.ok(findings.some((f) => f.code === "TOO_LONG"));
});

// --------------------------------------------------------------- governed fields

test("the contract does not offer the two governed commercial fields AT ALL", () => {
  const offered = CUSTOMER_CANONICAL_FIELDS.map((f) => f.field);
  for (const governed of GOVERNED_ACCOUNT_FIELDS) {
    // Not merely unmapped by default -- absent, so no admin can map a column onto one. A tax
    // status is evidenced by a certificate somebody holds, not by a column in an export.
    assert.ok(!offered.includes(governed), `${governed} must not be importable`);
  }
  assert.ok(!offered.includes("accountOwner"), "accountOwner names a person in THIS system");
});

test("an imported customer lands at the governed CREATE BASELINE the Rules permit", () => {
  const { draft } = normalizeCustomerRow({ name: "Acme", billingAddress: "x" });
  // accountGovernedCreateBaseline(): paymentTerms unset, taxStatus absent-or-UNKNOWN. This is
  // the same baseline a dispatcher's manual create produces, which is the claim that import
  // grants nobody authority they did not already have.
  for (const governed of GOVERNED_ACCOUNT_FIELDS) {
    assert.equal(draft[governed], undefined, `${governed} must be absent from the draft`);
  }
});

// --------------------------------------------------------------- the nameLower mirror

test("the server's search-name derivation is byte-identical to the client's", () => {
  // THE FAILURE THIS STOPS. `nameLower` is what customer search queries. A second writer that
  // derived it even slightly differently would make an imported customer findable by one
  // spelling and an edited one findable by another -- and "search sometimes doesn't find
  // things" never points at its cause.
  const clientSrc = readFileSync(
    new URL("../../field-ops-app-vite/src/domain/nameNormalization.js", import.meta.url),
    "utf8",
  );
  const body = /export function normalizeNameForSearch\(name\)\s*\{([\s\S]*?)\n\}/.exec(clientSrc)?.[1];
  assert.ok(body, "the client derivation must be findable");

  const clientFn = new Function("name", body);
  for (const name of ["Mesquite Soda Works", "  ACME  ", "Bob's Diner", "Two  Spaces", "", "ÀÉÎ Café"]) {
    assert.equal(
      normalizeAccountSearchName(name),
      clientFn(name),
      `derivations must agree for ${JSON.stringify(name)}`,
    );
  }
});

// --------------------------------------------------------------- identity and ids

test("identity is the NAME, compared case- and spacing-insensitively", () => {
  const key = (name) => CUSTOMER_IMPORT_CONTRACT.identityKey({ name });
  assert.equal(key("Mesquite Soda Works"), key("  mesquite   soda works "));
  // Unlike a part number, spaces are COLLAPSED and not removed: "Acme Soda" and "AcmeSoda"
  // are plausibly two different companies.
  assert.notEqual(key("Acme Soda"), key("AcmeSoda"));
});

test("the derived account id is namespaced, legal, and stable", () => {
  const id = deriveImportedAccountId("Mesquite Soda Works");
  assert.match(id, /^IMP-[A-Z0-9-]+$/);
  assert.ok(id.length <= 200);
  assert.equal(id, deriveImportedAccountId("mesquite soda works"), "same customer, same id");
  assert.notEqual(deriveImportedAccountId("Acme"), deriveImportedAccountId("Acme Inc"));
  // Namespaced so a derived id is recognisable as one and cannot plausibly be mistaken for
  // the Firestore auto-id an interface-created customer carries.
  assert.ok(deriveImportedAccountId("!!!").startsWith("IMP-"));
});

// --------------------------------------------------------------- pipeline integration

test("a customer header is DETECTED, and a part header still detects as Parts", () => {
  assert.equal(detectEntityType(["CUSTOMER_NAME", "BILLING_ADDRESS", "STATUS"]).entityType, "CUSTOMERS");
  assert.equal(
    detectEntityType(["PART_NO", "NAME", "UOM", "CONTROL_TYPE", "STOCK_CLASS"]).entityType,
    "PARTS",
  );
});

test("a Parts export is not read as Customers, even though both contracts claim NAME", () => {
  // THE FAILURE THIS PINS. Scoring by the fraction of REQUIRED fields matched is not
  // comparable between entities: a Customer needs one field and a Part needs five, so the
  // Customer contract scored a perfect 1.0 on any header containing NAME -- including a
  // Parts export, which it would then have won on a tie-break. Coverage asks the comparable
  // question: how much of THIS HEADER does the entity explain?
  const detection = detectEntityType(["PART_NO", "NAME", "UOM", "CONTROL_TYPE", "STOCK_CLASS"]);
  assert.equal(detection.entityType, "PARTS");
});

test("an entity whose REQUIRED fields are absent is excluded, whatever else it matches", () => {
  // A Parts header missing Stocking Class is not a Part file. The gate runs before any
  // scoring, so no amount of coverage can promote an entity the header cannot satisfy.
  const detection = detectEntityType(["PART_NO", "DESCRIPTION", "UOM", "CONTROL", "CLASS"]);
  assert.equal(detection.entityType, null);
  assert.match(detection.reason, /Only 3 of 5 required Part columns/);
});

test("a header nothing recognises says so, rather than naming a near-miss it did not have", () => {
  const detection = detectEntityType(["FOO", "BAR"]);
  assert.equal(detection.entityType, null);
  assert.match(detection.reason, /No entity could be recognised/);
});
test("the wired entities are registered, and the unwired ones are honestly absent", () => {
  assert.deepEqual(
    wiredEntityContracts().map((c) => c.entityType),
    ["PARTS", "CUSTOMERS", "EQUIPMENT"],
  );
  for (const later of ["INVENTORY", "SERVICE_HISTORY"]) {
    assert.equal(entityContractFor(later), null, `${later} must have no contract yet`);
    assert.equal(isEntityWired(later), false);
  }
});

test("an unwired entity fails mapping validation instead of reporting valid with no fields", () => {
  const parsed = parseSourceFile("x.csv", "A,B\n1,2");
  const v = validateMapping("INVENTORY", parsed, { A: null, B: null });
  // "Valid" here would be the one answer that lets an operator approve an import that does
  // nothing at all.
  assert.equal(v.valid, false);
  assert.ok(v.findings.some((f) => f.code === "ENTITY_NOT_WIRED"));
});

test("the shared preview classifies customers with the CUSTOMER contract's vocabulary", () => {
  const preview = buildEntityPreview(
    "CUSTOMERS",
    [
      row({ __row: 2, name: "Acme", billingAddress: "1 Main" }),
      row({ __row: 3, name: "acme", billingAddress: "2 Main" }),
      row({ __row: 4, name: "Existing Co", billingAddress: "3 Main" }),
    ],
    new Set([CUSTOMER_IMPORT_CONTRACT.identityKey({ name: "Existing Co" })]),
  );

  assert.equal(preview.entityType, "CUSTOMERS");
  assert.deepEqual(preview.summary, { total: 3, ready: 1, warnings: 0, errors: 2 });
  // The message names the CUSTOMER label and identity, not the Part one -- the shared
  // pipeline must not describe a customer as a Part.
  const dup = preview.rows[1].findings.find((f) => f.code === "DUPLICATE_IN_FILE");
  assert.match(dup.message, /Customer Name/);
  const exists = preview.rows[2].findings.find((f) => f.code === "ALREADY_EXISTS");
  assert.match(exists.message, /A Customer with Customer Name/);
});

test("the required-field set is exactly the name", () => {
  assert.deepEqual(CUSTOMER_REQUIRED_FIELDS, ["name"]);
  assert.deepEqual([...CUSTOMER_STATUSES], ["ACTIVE", "INACTIVE", "PROSPECT"]);
});

// --------------------------------------------------------------- portability

test("the customer contract stays on the portable side", () => {
  const src = readFileSync(new URL("../src/dataImport/contracts/customerImportContract.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/from\s+["'][^"']*firebase-admin/.test(src));
  assert.ok(!/\.collection\(/.test(src));
});
