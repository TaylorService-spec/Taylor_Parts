// Contact CSV import -- PURE helpers: RFC 4180-style parsing, header
// auto-suggestion, column->field mapping validation, per-row validation, and
// duplicate detection. No React/Firebase import, so all of this is directly
// unit-testable in Node (same pattern as domain/accountPortfolio.js and
// domain/customerSearch.js). The account is ALWAYS fixed by context -- accountId
// is never a mappable CSV column here.

// Supported Contact fields a CSV column may map to -- human-facing labels only,
// never a document id and never accountId. `isPrimary` is deliberately NOT
// importable: importing it risks creating several "primary" contacts at once, so
// primary is set per-contact in the UI instead. Imported contacts are non-primary.
export const SUPPORTED_CONTACT_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "email", label: "Email", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "role", label: "Role", required: false },
];

// Bounded, DOCUMENTED row limit. A Firestore writeBatch caps at 500 writes; 200
// data rows keeps the single atomic import well inside that bound and is a sane
// per-import size for one account's contact list. A file with more data rows than
// this is rejected whole (never partially imported).
export const MAX_IMPORT_ROWS = 200;

// ---- CSV parsing (strict RFC 4180) ----
// Returns a TYPED result: `{ ok: true, headers, rows }` for a structurally valid
// file, or `{ ok: false, error: "MALFORMED", headers: [], rows: [] }` for a
// structurally invalid one. A malformed file is rejected WHOLE, before any batch
// is built -- consistent with the all-or-nothing import policy (never accept a
// ragged or unclosed-quote file and silently coerce it).
//
// Structural contract (each violation => MALFORMED):
//   1. EOF while still inside a quoted field.
//   2. A quote may open ONLY at the start of a field (a quote inside unquoted
//      content is invalid).
//   3. After a quoted field's closing quote, the next char must be a comma, CR/LF,
//      or EOF (any other char is invalid).
//   4/5. Every non-blank data record must have EXACTLY as many cells as the
//      header row -- both missing and extra cells are errors.
// Valid: embedded commas/newlines and escaped quotes ("") inside a properly
// quoted field (7); legitimate trailing empty cells represented by their
// delimiters, e.g. `a,b,` (6); blank physical lines, which are ignored (8);
// CRLF or LF endings; a leading UTF-8 BOM.
export function parseCsv(text) {
  const fail = { ok: false, error: "MALFORMED", headers: [], rows: [] };
  if (typeof text !== "string") return fail;
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip UTF-8 BOM

  const records = [];
  let field = "";
  let record = [];
  let i = 0;
  let inQuotes = false;
  let fieldStart = true; // at the start of the current field (no char yet)?
  let afterClose = false; // just closed a quoted field, awaiting a delimiter?
  let sawChar = false; // did the current record see any content char/delimiter?
  const pushField = () => { record.push(field); field = ""; fieldStart = true; afterClose = false; };
  const endRecord = () => { pushField(); records.push(record); record = []; sawChar = false; };

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; afterClose = true; i += 1; continue; // close quote
      }
      field += c; i += 1; continue; // any char (incl. , \r \n) is literal inside quotes
    }
    if (afterClose) {
      // Rule 3: only a delimiter or EOF may follow a closing quote.
      if (c === ",") { pushField(); sawChar = true; i += 1; continue; }
      if (c === "\r") { if (s[i + 1] === "\n") i += 1; endRecord(); i += 1; continue; }
      if (c === "\n") { endRecord(); i += 1; continue; }
      return fail;
    }
    if (c === '"') {
      if (!fieldStart) return fail; // Rule 2: quote not at field start
      inQuotes = true; fieldStart = false; sawChar = true; i += 1; continue;
    }
    if (c === ",") { pushField(); sawChar = true; i += 1; continue; }
    if (c === "\r") { if (s[i + 1] === "\n") i += 1; endRecord(); i += 1; continue; }
    if (c === "\n") { endRecord(); i += 1; continue; }
    field += c; fieldStart = false; sawChar = true; i += 1;
  }
  if (inQuotes) return fail; // Rule 1: EOF inside a quoted field
  // Flush a trailing record unless the file ended exactly on a line break.
  if (sawChar || field.length > 0 || record.length > 0) endRecord();

  // Ignore blank physical lines (a lone empty cell) everywhere (rule 8), then the
  // first remaining record is the header and every data record must match its
  // cell count (rules 4/5).
  const nonBlank = records.filter((rec) => !(rec.length === 1 && rec[0] === ""));
  if (nonBlank.length === 0) return { ok: true, headers: [], rows: [] };
  const [headerRec, ...dataRecs] = nonBlank;
  const headers = headerRec.map((h) => h.trim());
  const colCount = headers.length;
  for (const rec of dataRecs) {
    if (rec.length !== colCount) return fail;
  }
  return { ok: true, headers, rows: dataRecs };
}

// ---- Header auto-suggestion ----
const HEADER_ALIASES = {
  name: ["name", "full name", "fullname", "contact", "contact name", "customer name"],
  email: ["email", "e mail", "email address", "mail", "e mail address"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "cell", "cell phone"],
  role: ["role", "title", "job title", "position"],
};
function normHeader(h) {
  return (h ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
// Best-effort field->columnIndex guesses from the header row. Each column is used
// for at most one field; unmatched fields are simply absent (user maps manually).
export function suggestMapping(headers = []) {
  const mapping = {};
  const used = new Set();
  for (const field of SUPPORTED_CONTACT_FIELDS) {
    const aliases = HEADER_ALIASES[field.key] ?? [];
    for (let idx = 0; idx < headers.length; idx++) {
      if (used.has(idx)) continue;
      if (aliases.includes(normHeader(headers[idx]))) {
        mapping[field.key] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

// ---- Mapping validation ----
function hasIdx(v) { return v !== undefined && v !== null && v !== ""; }
// Rejects (a) a required field left unmapped, and (b) two fields mapped to the
// SAME csv column. `mapping` is { fieldKey: headerIndex }.
export function validateMapping(mapping = {}) {
  const errors = [];
  for (const f of SUPPORTED_CONTACT_FIELDS) {
    if (f.required && !hasIdx(mapping[f.key])) {
      errors.push(`Map a CSV column to the required "${f.label}" field.`);
    }
  }
  const seen = new Map(); // headerIndex -> fieldLabel
  for (const f of SUPPORTED_CONTACT_FIELDS) {
    const idx = mapping[f.key];
    if (!hasIdx(idx)) continue;
    if (seen.has(idx)) {
      errors.push(`Each CSV column maps to only one field — "${seen.get(idx)}" and "${f.label}" use the same column.`);
    } else {
      seen.set(idx, f.label);
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---- Row validation + duplicate detection ----
function cell(row, idx) { return !hasIdx(idx) ? "" : (row[idx] ?? "").trim(); }
function normKey(s) { return (s ?? "").trim().toLowerCase(); }
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// Fixed, actionable copy for a structurally malformed CSV file. Deliberately
// generic -- it never contains raw parser output or any row/file content.
export const MALFORMED_FILE_MESSAGE = "This CSV file is malformed. Correct its rows or quotes and try again.";

// Safe, user-facing message for a FAILED contact import (batch commit). A
// permission-denied (Rules rejection) and a demo/panic blocked write each get a
// distinct message; anything else is a generic retry line -- NEVER a raw Firebase
// message/code/detail. Pure, so it is unit-testable.
export function contactImportErrorMessage(err) {
  if (err?.blocked) return "Importing is disabled in this mode -- no contacts were imported.";
  const code = err?.code ?? "";
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return "You do not have permission to import contacts for this customer.";
  }
  return "Could not import these contacts. No contacts were imported -- please try again.";
}

// Duplicate key from EXISTING Contact fields (never a document id): same email
// (case-insensitive) marks a duplicate; when a row has no email, same name + same
// phone does. Used to SKIP duplicates -- an existing Contact is never overwritten.
export function contactDuplicateKey(contact = {}) {
  const email = normKey(contact.email);
  if (email) return `email:${email}`;
  return `namephone:${normKey(contact.name)}|${normKey(contact.phone)}`;
}

// Validates EVERY data row up front (before any write). Returns accepted rows
// (ready to import) and rejected rows (with a human reason), plus an overLimit
// flag. Fully-blank lines are ignored (not counted as rejects). A file over the
// row limit is rejected whole (accepted empty) so it can never partially import.
export function validateRows(rows = [], mapping = {}, existingContacts = [], { maxRows = MAX_IMPORT_ROWS } = {}) {
  const dataRows = rows.filter((r) => Array.isArray(r) && r.some((c) => (c ?? "").trim() !== ""));
  if (dataRows.length > maxRows) {
    return { accepted: [], rejected: [], overLimit: true, limit: maxRows, dataRowCount: dataRows.length };
  }
  const accepted = [];
  const rejected = [];
  const seen = new Set((existingContacts ?? []).map((c) => contactDuplicateKey(c)));
  dataRows.forEach((row, i) => {
    const rowNumber = i + 1;
    const contact = {
      name: cell(row, mapping.name),
      email: cell(row, mapping.email),
      phone: cell(row, mapping.phone),
      role: cell(row, mapping.role),
    };
    if (!contact.name) { rejected.push({ rowNumber, reason: "Missing name" }); return; }
    if (contact.email && !isValidEmail(contact.email)) { rejected.push({ rowNumber, reason: "Invalid email", name: contact.name }); return; }
    const key = contactDuplicateKey(contact);
    if (seen.has(key)) { rejected.push({ rowNumber, reason: "Duplicate — already exists", name: contact.name }); return; }
    seen.add(key);
    accepted.push({ rowNumber, contact });
  });
  return { accepted, rejected, overLimit: false, limit: maxRows, dataRowCount: dataRows.length };
}
