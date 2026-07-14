import assert from "node:assert/strict";
import {
  parseCsv,
  suggestMapping,
  validateMapping,
  validateRows,
  contactDuplicateKey,
  contactImportErrorMessage,
  MALFORMED_FILE_MESSAGE,
  SUPPORTED_CONTACT_FIELDS,
  MAX_IMPORT_ROWS,
} from "../src/domain/contactCsvImport.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// ===== parseCsv (strict, typed result) =====
ok("parseCsv: simple LF rows + header -> ok", () => {
  const r = parseCsv("Name,Email\nAda,ada@x.com\nGrace,grace@x.com");
  assert.equal(r.ok, true);
  assert.deepEqual(r.headers, ["Name", "Email"]);
  assert.deepEqual(r.rows, [["Ada", "ada@x.com"], ["Grace", "grace@x.com"]]);
});
ok("parseCsv: strips a leading UTF-8 BOM", () => {
  const bom = String.fromCharCode(0xfeff);
  const r = parseCsv(bom + "Name,Email\nAda,ada@x.com");
  assert.equal(r.ok, true);
  assert.deepEqual(r.headers, ["Name", "Email"]);
});
ok("parseCsv: CRLF line endings", () => {
  const r = parseCsv("Name,Email\r\nAda,ada@x.com\r\nGrace,grace@x.com\r\n");
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [["Ada", "ada@x.com"], ["Grace", "grace@x.com"]]);
});
ok("parseCsv: quoted field with embedded comma", () => {
  const r = parseCsv('Name,Role\n"Doe, John",Manager');
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [["Doe, John", "Manager"]]);
});
ok("parseCsv: escaped quotes inside a quoted field", () => {
  const r = parseCsv('Name,Role\n"She said ""hi""",Owner');
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [['She said "hi"', "Owner"]]);
});
ok("parseCsv: VALID embedded newline inside a quoted field stays accepted", () => {
  const r = parseCsv('Name,Note\n"Line1\nLine2",ok');
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [["Line1\nLine2", "ok"]]);
});
ok("parseCsv: blank interior cells preserved", () => {
  const r = parseCsv("Name,Email,Phone\nAda,,555");
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [["Ada", "", "555"]]);
});
ok("parseCsv: VALID trailing empty columns (represented by delimiters) accepted", () => {
  const r = parseCsv("Name,Email,Phone\nAda,ada@x.com,"); // 3 cells, last empty
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [["Ada", "ada@x.com", ""]]);
});
ok("parseCsv: trailing newline does not add a phantom row", () => {
  const r = parseCsv("Name\nAda\n");
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [["Ada"]]);
});
ok("parseCsv: blank physical lines are ignored", () => {
  const r = parseCsv("Name,Email\nAda,ada@x.com\n\nGrace,grace@x.com\n");
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [["Ada", "ada@x.com"], ["Grace", "grace@x.com"]]);
});
// --- structural rejections (all-or-nothing) ---
ok("parseCsv: unclosed quoted field -> MALFORMED", () => {
  const r = parseCsv('Name,Email\n"Ada,ada@x.com');
  assert.equal(r.ok, false);
  assert.equal(r.error, "MALFORMED");
  assert.deepEqual(r.rows, []);
});
ok("parseCsv: EOF inside a quoted field -> MALFORMED", () => {
  assert.equal(parseCsv('Name\n"Ada').ok, false);
});
ok("parseCsv: quote inside unquoted content -> MALFORMED", () => {
  assert.equal(parseCsv('Name,Role\nAd"a,Owner').ok, false);
});
ok("parseCsv: unexpected char after a closing quote -> MALFORMED", () => {
  assert.equal(parseCsv('Name,Role\n"Ada"x,Owner').ok, false);
});
ok("parseCsv: too FEW columns -> MALFORMED", () => {
  assert.equal(parseCsv("Name,Email\nAda").ok, false); // 1 cell, 2 expected
});
ok("parseCsv: too MANY columns -> MALFORMED", () => {
  assert.equal(parseCsv("Name,Email\nAda,a@x.com,extra").ok, false); // 3 cells, 2 expected
});
ok("parseCsv: empty/whitespace input -> ok with no headers/rows; non-string -> MALFORMED", () => {
  assert.deepEqual(parseCsv(""), { ok: true, headers: [], rows: [] });
  assert.equal(parseCsv(123).ok, false);
});
ok("malformed input yields ZERO accepted contacts (parse rejected before validate)", () => {
  const r = parseCsv('Name,Email\n"Ada,ada@x.com'); // unclosed quote
  assert.equal(r.ok, false);
  // A malformed parse never produces rows to validate -> nothing can be accepted.
  assert.equal(validateRows(r.rows, { name: 0 }, []).accepted.length, 0);
});

// ===== suggestMapping =====
ok("suggestMapping: matches common header spellings", () => {
  const m = suggestMapping(["Full Name", "E-mail", "Phone Number", "Title"]);
  assert.equal(m.name, 0);
  assert.equal(m.email, 1);
  assert.equal(m.phone, 2);
  assert.equal(m.role, 3);
});
ok("suggestMapping: leaves unknown headers unmapped", () => {
  const m = suggestMapping(["Widget", "Sprocket"]);
  assert.deepEqual(m, {});
});
ok("suggestMapping: each column used for at most one field", () => {
  const m = suggestMapping(["Name", "Name"]); // two 'Name' columns
  assert.equal(m.name, 0); // first only
});

// ===== validateMapping =====
ok("validateMapping: valid mapping passes", () => {
  const { valid, errors } = validateMapping({ name: 0, email: 1 });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});
ok("validateMapping: missing required Name mapping fails", () => {
  const { valid, errors } = validateMapping({ email: 1 });
  assert.equal(valid, false);
  assert.match(errors.join(" "), /required "Name"/);
});
ok("validateMapping: two fields on the same column fail (duplicate mapping)", () => {
  const { valid, errors } = validateMapping({ name: 0, email: 0 });
  assert.equal(valid, false);
  assert.match(errors.join(" "), /only one field/);
});

// ===== validateRows =====
const map = { name: 0, email: 1, phone: 2, role: 3 };
ok("validateRows: accepts valid rows, builds contacts", () => {
  const { accepted, rejected, overLimit } = validateRows(
    [["Ada", "ada@x.com", "555", "Owner"]], map, []
  );
  assert.equal(overLimit, false);
  assert.equal(rejected.length, 0);
  assert.deepEqual(accepted[0].contact, { name: "Ada", email: "ada@x.com", phone: "555", role: "Owner" });
});
ok("validateRows: rejects a row missing the required name", () => {
  const { accepted, rejected } = validateRows([["", "x@x.com", "", ""]], map, []);
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "Missing name");
});
ok("validateRows: rejects an invalid email", () => {
  const { rejected } = validateRows([["Ada", "not-an-email", "", ""]], map, []);
  assert.equal(rejected[0].reason, "Invalid email");
});
ok("validateRows: skips a duplicate of an EXISTING contact (never overwrites)", () => {
  const existing = [{ name: "Ada", email: "ada@x.com" }];
  const { accepted, rejected } = validateRows([["Ada", "ada@x.com", "", ""]], map, existing);
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /Duplicate/);
});
ok("validateRows: skips a within-file duplicate (keeps first)", () => {
  const { accepted, rejected } = validateRows(
    [["Ada", "ada@x.com", "", ""], ["Ada", "ada@x.com", "", ""]], map, []
  );
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
});
ok("validateRows: ignores fully-blank lines (not counted as rejects)", () => {
  const { accepted, rejected } = validateRows([["", "", "", ""], ["Ada", "", "", ""]], map, []);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 0);
});
ok("validateRows: a file over the row limit is rejected WHOLE (no partial import)", () => {
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`P${i}`, "", "", ""]);
  const res = validateRows(rows, map, [], { maxRows: MAX_IMPORT_ROWS });
  assert.equal(res.overLimit, true);
  assert.equal(res.accepted.length, 0);
  assert.equal(res.rejected.length, 0);
  assert.equal(res.dataRowCount, MAX_IMPORT_ROWS + 1);
});
ok("validateRows: exactly at the limit is allowed", () => {
  const rows = Array.from({ length: 3 }, (_, i) => [`P${i}`, "", "", ""]);
  const res = validateRows(rows, map, [], { maxRows: 3 });
  assert.equal(res.overLimit, false);
  assert.equal(res.accepted.length, 3);
});

// ===== contactDuplicateKey =====
ok("contactDuplicateKey: email match is case-insensitive", () => {
  assert.equal(contactDuplicateKey({ email: "A@X.com" }), contactDuplicateKey({ email: "a@x.com" }));
});
ok("contactDuplicateKey: falls back to name+phone when no email", () => {
  assert.equal(contactDuplicateKey({ name: "Ada", phone: "555" }), "namephone:ada|555");
  assert.notEqual(contactDuplicateKey({ name: "Ada", phone: "555" }), contactDuplicateKey({ name: "Ada", phone: "556" }));
});

// ===== supported fields metadata =====
ok("SUPPORTED_CONTACT_FIELDS: Name required; no accountId/id exposed", () => {
  const keys = SUPPORTED_CONTACT_FIELDS.map((f) => f.key);
  assert.deepEqual(keys, ["name", "email", "phone", "role"]);
  assert.equal(SUPPORTED_CONTACT_FIELDS.find((f) => f.key === "name").required, true);
  assert.ok(!keys.includes("accountId") && !keys.includes("id"));
});

// ===== contactImportErrorMessage (safe copy, no raw detail) =====
ok("contactImportErrorMessage: permission-denied -> authorization copy", () => {
  assert.match(contactImportErrorMessage({ code: "permission-denied" }), /permission/i);
  assert.match(contactImportErrorMessage({ code: "firestore/permission-denied" }), /permission/i);
});
ok("contactImportErrorMessage: blocked -> disabled-mode copy", () => {
  assert.match(contactImportErrorMessage({ blocked: true }), /disabled/i);
});
ok("contactImportErrorMessage: generic error -> retry copy, no raw detail leaked", () => {
  const msg = contactImportErrorMessage({ code: "unavailable", message: "RAW-FIRE-DETAIL-42" });
  assert.match(msg, /no contacts were imported/i);
  assert.ok(!msg.includes("RAW-FIRE-DETAIL-42"));
});
ok("contactImportErrorMessage: null error -> generic copy", () => {
  assert.match(contactImportErrorMessage(null), /no contacts were imported/i);
});

// ===== malformed-file copy is fixed + contains no raw file content =====
ok("MALFORMED_FILE_MESSAGE is fixed actionable copy with no row/file content", () => {
  assert.equal(MALFORMED_FILE_MESSAGE, "This CSV file is malformed. Correct its rows or quotes and try again.");
  // Prove it can't echo a malformed file's contents: the message is a constant,
  // independent of any parse input.
  const badFile = '"Ada,SECRET-ROW-DATA,oops';
  assert.equal(parseCsv(badFile).ok, false);
  assert.ok(!MALFORMED_FILE_MESSAGE.includes("SECRET-ROW-DATA"));
});

console.log(`\n${passed} passed, 0 failed`);
