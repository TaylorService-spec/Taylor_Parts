// EI Receiving -- PURE, ISOLATED frontend adapter that validates the merged I-LA4 trusted
// backend "selectable location option" DTO (docs/specifications/
// receiving-location-authority-i-la-c2-warehouse-status.md §7/§505):
//
//   { value, label, type: "WAREHOUSE" }
//
// The trusted backend is the ONLY authority for existence/active status (it returns only
// ACTIVE-status options); this adapter proves the DTO's SHAPE fail-closed before the frontend
// ever offers an option. It has NO production caller in this slice.
//
// STRICTLY PURE: no Firebase, no Firestore, no `warehouses`/RawWarehouse read, no callable, no
// transport/envelope/error mapping, no hooks/UI. It knows nothing about how the DTO is fetched.
// Every effect is a value transform on its argument; it is Node-importable and unit-tested.
//
// FAIL CLOSED, WHOLE-PAYLOAD: any input that is not an array of valid, non-duplicate options
// yields a sanitized `{ ok: false, options: [] }` -- never a partial or fabricated option list.
// A genuine empty array is the only honest empty success (`{ ok: true, options: [] }`).
// DETERMINISTIC + NON-MUTATING: pure function of its input; the input array/rows are never
// mutated; results are frozen and ordered by label, then value (code-unit lexicographic).

export const RECEIVING_LOCATION_TYPE = "WAREHOUSE";
const REQUIRED_KEYS = Object.freeze(["value", "label", "type"]);

// Firestore document-ID constraints for a single path segment.
const MAX_ID_BYTES = 1500; // Firestore document-ID byte limit
const RESERVED_ID = /^__.*__$/; // Firestore-reserved id pattern

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function byteLength(s) {
  return new TextEncoder().encode(s).length;
}

// True if `s` contains a C0 control character (U+0000..U+001F) or DEL (U+007F). Implemented by
// code point (not a literal control-char regex) so the source carries no control bytes.
function hasControlChar(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

// A `value` must be a non-blank, path-safe SINGLE document-ID segment: a string with no
// surrounding whitespace, no "/" (single segment), not "."/"..", not a Firestore-reserved
// __…__ id, no control characters, and within the Firestore id byte limit. The value is an
// identity and is NEVER trimmed/normalized -- surrounding whitespace fails closed.
export function isPathSafeIdSegment(v) {
  if (typeof v !== "string") return false;
  if (v.length === 0 || v !== v.trim()) return false;
  if (v === "." || v === "..") return false;
  if (v.includes("/")) return false;
  if (hasControlChar(v)) return false;
  if (RESERVED_ID.test(v)) return false;
  if (byteLength(v) > MAX_ID_BYTES) return false;
  return true;
}

// The row must be a plain object with EXACTLY the three required keys.
function hasExactKeys(row) {
  const keys = Object.keys(row);
  return keys.length === REQUIRED_KEYS.length && REQUIRED_KEYS.every((k) => Object.prototype.hasOwnProperty.call(row, k));
}

// Validate + sanitize one option row. Returns a fresh frozen `{ value, label, type }` (label
// trimmed for display; value verbatim) or null if the row is malformed. Never spreads the input,
// so an extra key can neither pass validation nor leak into the output.
function validateOption(row) {
  if (!isPlainObject(row)) return null;
  if (!hasExactKeys(row)) return null;
  if (row.type !== RECEIVING_LOCATION_TYPE) return null;
  if (!isPathSafeIdSegment(row.value)) return null;
  if (typeof row.label !== "string" || row.label.trim() === "") return null;
  return Object.freeze({ value: row.value, label: row.label.trim(), type: RECEIVING_LOCATION_TYPE });
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const FAIL_CLOSED = Object.freeze({ ok: false, options: Object.freeze([]) });

// Adapt the trusted I-LA4 option DTO array into a sanitized, ordered option list.
//   input: unknown
//   -> { ok: true,  options: Frozen<{ value, label, type }>[] }  on a fully-valid array
//   -> { ok: true,  options: [] }                                on a genuine empty array
//   -> { ok: false, options: [] }                                on ANY other input (fail closed)
// Whole-payload: a single malformed row or a duplicate `value` fails the entire payload closed
// (no partial options). Deterministic order: by label, then value. Never mutates the input.
export function adaptReceivingLocationOptions(input) {
  if (!Array.isArray(input)) return FAIL_CLOSED;
  const options = [];
  const seenValues = new Set();
  for (const row of input) {
    const option = validateOption(row);
    if (option === null) return FAIL_CLOSED; // any malformed row -> whole payload fails closed
    if (seenValues.has(option.value)) return FAIL_CLOSED; // duplicate value -> fail closed
    seenValues.add(option.value);
    options.push(option);
  }
  options.sort((a, b) => cmp(a.label, b.label) || cmp(a.value, b.value));
  return Object.freeze({ ok: true, options: Object.freeze(options) });
}

// Exported for focused tests only.
export const __test__ = Object.freeze({ isPathSafeIdSegment, RECEIVING_LOCATION_TYPE });
