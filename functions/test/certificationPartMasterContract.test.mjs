// EVERY CERTIFICATION PART MUST SURVIVE THE REAL PART MASTER READER.
//
// ============================ WHY THE PRODUCT'S READER, NOT A FIELD LIST ============================
//
// The obvious version of this test asserts that each record has `version`, `createdBy` and
// `updatedBy`. That test would have been written from the error message, would pass forever, and
// would say nothing about the contract -- if the repository later required a fourth field, the
// fixture would break again and this test would still be green.
//
// So it runs partFromFirestore, the function receiving actually calls. Whatever the stored-record
// contract is, this asserts the fixture satisfies it, including the parts of it nobody has thought
// about yet.
//
// ============================ WHAT WENT WRONG ============================
//
// The certification catalog was hand-built and omitted the metadata block. Nothing noticed for the
// entire program: the demand applier reads the parts collection directly and wants only
// internalPartNumber, and the inventory ledger never consults Part Master at all. The first
// consumer to read a Part through the repository was the receiving service, which refused the very
// first receipt with MalformedStoredRecordError.
//
// That is the third time in this program that a fixture has been internally consistent and wrong,
// and the third time only a real adapter said so.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Timestamp } from "firebase-admin/firestore";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { partFromFirestore, MalformedStoredRecordError, INITIAL_VERSION } =
  await import(L("functions/lib/partMaster/partMasterRepository.js"));
const { CERT_PARTS, partRecordFor } =
  await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));

/** The seeder stamps createdAt/updatedAt; the catalog supplies everything else. */
const asStored = (record) => ({
  createdAt: Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z")),
  updatedAt: Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z")),
  ...record.data,
});

test("every certification Part is readable by the real Part Master reader", () => {
  assert.ok(CERT_PARTS.length > 0, "the catalog must not be empty");
  for (const part of CERT_PARTS) {
    const record = partRecordFor(part);
    const stored = partFromFirestore(record.id, asStored(record));
    assert.equal(stored.part.partId, part.partId);
    assert.ok(stored.version >= INITIAL_VERSION, `${part.partId} version below INITIAL_VERSION`);
  }
});

test("the reader is what refuses -- a record missing its metadata does not pass", () => {
  // MUTATION. Proves the check above is actually consulting the contract: strip the metadata the
  // fixture used to omit, and the same reader that just accepted 37 records rejects this one.
  const record = partRecordFor(CERT_PARTS[0]);
  const stripped = asStored(record);
  delete stripped.version;
  delete stripped.createdBy;
  delete stripped.updatedBy;
  assert.throws(() => partFromFirestore(record.id, stripped), MalformedStoredRecordError);
});

test("MUTATION: a non-integer version is refused", () => {
  // The contract is not merely presence. A fixture that wrote version: "1" would satisfy a
  // field-list test and still be malformed to the reader.
  const record = partRecordFor(CERT_PARTS[0]);
  assert.throws(() => partFromFirestore(record.id, { ...asStored(record), version: "1" }),
    MalformedStoredRecordError);
});

test("MUTATION: a plain Date is not a Timestamp", () => {
  // The seeder's stamp must be a Firestore Timestamp. A Date reads correctly in every log line and
  // is refused by the reader, which is exactly the kind of difference a fixture cannot see itself.
  const record = partRecordFor(CERT_PARTS[0]);
  assert.throws(() => partFromFirestore(record.id, { ...asStored(record), createdAt: new Date() }),
    MalformedStoredRecordError);
});

test("the audit author is the builder, never a fabricated employee", () => {
  // Nobody typed this catalog. Attributing it to an employee id would put a false name in an audit
  // field, and audit fields are believed.
  for (const part of CERT_PARTS.slice(0, 5)) {
    const { data } = partRecordFor(part);
    assert.equal(data.createdBy, "certification-world-builder");
    assert.equal(data.updatedBy, "certification-world-builder");
    assert.ok(!/^cw-emp-/.test(data.createdBy), "an employee id here would be a fabricated author");
  }
});
