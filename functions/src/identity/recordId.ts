// The Verenward Global Record Identity Standard (VGRIS v1) — reference implementation.
//
// SPEC: docs/architecture/verenward-global-record-identity-standard.md
// REGISTRY: docs/architecture/verenward-object-code-registry-proposed.md
// CENSUS: docs/architecture/record-id-migration-impact-census.md
//
// ════════════════════ WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ════════════════════
//
// This module mints, validates, parses and normalises a VGRIS Record ID:
//
//     OOOO_XXXXXXXXXXXXXXXXXXXXXXXXXX      31 chars
//     └┬─┘│└────────────┬───────────┘
//      │  │             └── 26 chars, Crockford Base32, 128 bits
//      │  └──────────────── exactly one U+005F, always at index 4
//      └─────────────────── 4 chars, A-Z, a centrally registered object code
//
// IT HAS NO CALL SITES, BY DESIGN. Nothing in this repository imports it, nothing writes an id
// produced by it, and no record's identity changes because it exists. It is the executable half of
// a design document: the properties the standard claims (lexical order == time order, the
// UUID bijection is lossless, the ambiguity mapping never corrupts an object code) are asserted by
// test/recordIdStandard.test.mjs rather than asserted by prose.
//
// IT KNOWS NO COLLECTION, NO TENANT AND NO DATABASE. It imports `node:crypto` and nothing else.
// Adding a persistence dependency here would put the data plane back inside the domain contract,
// which ADR-015 rules out.
//
// IT DOES NOT VALIDATE AGAINST THE OBJECT-CODE REGISTRY. The registry is a document today, not a
// runtime authority (standard §14.3 is the open question). This module enforces the SHAPE of a code
// -- four uppercase letters -- and the caller supplies which one. When the registry becomes a
// runtime table, `assertRegisteredObjectCode` is the seam it plugs into, and nothing else changes.

import { randomFillSync } from "node:crypto";

// ════════════════════ THE ALPHABET ════════════════════
//
// Crockford Base32: the digits and the uppercase letters EXCLUDING I, L, O and U.
//   I, L, O -- visually confusable with 1, 1 and 0.
//   U       -- excluded so an accidental obscenity is impossible.
//
// The symbols are in strictly ASCENDING ASCII order. That is not decorative: it is the whole reason
// byte-comparing two encoded payloads is the same as numerically comparing the 128-bit values they
// encode, which is the same as comparing their timestamps. Skipping letters preserves order;
// REMAPPING them would not, which is why the ambiguity mapping below is a decode-time behaviour and
// never an encode-time one.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Payload length in characters. 26 x 5 bits = 130 bits of capacity holding exactly 128 bits. */
export const PAYLOAD_LENGTH = 26;
/** Object code length in characters. See the standard §1.2 for why 4 and not 3. */
export const OBJECT_CODE_LENGTH = 4;
/** Total Record ID length. Fixed, so CHAR(31) is available and nothing truncates. */
export const RECORD_ID_LENGTH = 31;
/** The separator. U+005F LOW LINE, always at index 4, never any other character. */
export const SEPARATOR = "_";

/**
 * PERMISSIVE form -- what a parser accepts.
 * STRICT form -- what is minted and what a database CHECK constraint should enforce. The leading
 * `[0-7]` encodes the two zero pad bits: 128 bits left-padded into 130 cannot set them.
 */
export const RECORD_ID_PATTERN = /^[A-Z]{4}_[0-9A-HJKMNP-TV-Z]{26}$/;
export const RECORD_ID_PATTERN_STRICT = /^[A-Z]{4}_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const OBJECT_CODE_PATTERN = /^[A-Z]{4}$/;

/**
 * Ordering policy (standard §5.3, Amendment A1).
 *
 * TIME_ORDERED -- a UUIDv7 payload. Lexical order of the id is creation-millisecond order, which
 *                 gives index locality on a B-tree data plane. The default for every object.
 * SCATTERED    -- 128 CSPRNG bits (v4-shaped). No time correlation, no index locality, no
 *                 write hotspot. Reserved for an object whose sustained write rate approaches
 *                 Firestore's documented single-key-range ceiling.
 *
 * The two are INDISTINGUISHABLE from outside: same length, same alphabet, same validation, same
 * opacity. That is what makes the flag a registry attribute rather than a format change -- flipping
 * it migrates nothing, because it affects only ids minted after the flip.
 */
export type RecordIdOrdering = "TIME_ORDERED" | "SCATTERED";

export class RecordIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordIdError";
  }
}

// ════════════════════ BASE32 ════════════════════

/**
 * 16 bytes -> 26 Crockford Base32 characters, big-endian, left-padded with two zero bits.
 *
 * Implemented over a bit accumulator rather than BigInt so the padding is explicit: the first
 * emitted group is (2 pad bits << 3 | top 3 bits of byte 0), which is why the first character can
 * only ever be 0-7.
 */
export function encodePayload(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new RecordIdError(`payload must be 16 bytes, got ${bytes.length}`);
  // The length check alone is not enough. A caller handing over a plain 16-element array (or a bad
  // `fill`) whose elements are outside 0-255 used to be encoded silently: `(acc << 8) | 300` sets
  // bits above the byte, the first emitted group stops being (2 zero pad bits | top 3 bits of
  // byte 0), and the encoder returns a payload whose first character is outside 0-7 -- an id that
  // fails the STRICT pattern the standard says every minted id satisfies. Reject the input instead.
  for (let i = 0; i < 16; i += 1) {
    const b = bytes[i]!;
    if (!Number.isInteger(b) || b < 0 || b > 0xff) {
      throw new RecordIdError(`payload byte ${i} is not an integer 0-255: ${String(b)}`);
    }
  }
  let out = "";
  let acc = 0;
  let bits = 2; // the two zero pad bits, present before any byte is read
  for (let i = 0; i < 16; i += 1) {
    acc = (acc << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >>> bits) & 0x1f];
    }
    acc &= (1 << bits) - 1;
  }
  // 2 + 128 = 130 bits = exactly 26 groups, so nothing is left over.
  if (bits !== 0 || out.length !== PAYLOAD_LENGTH) {
    throw new RecordIdError(`encoder produced ${out.length} chars with ${bits} bits left over`);
  }
  // POSTCONDITION, not a defensive nicety: "the first payload character is 0-7" is the observable
  // form of "the two leading pad bits are zero", and the standard (§3) states it as a fixed
  // property of the format. Assert it here so the property is guaranteed by the encoder rather than
  // merely emergent from its arithmetic.
  if (out.charCodeAt(0) > 0x37 /* "7" */) {
    throw new RecordIdError(`encoder produced a payload whose first character is ${JSON.stringify(out[0])}, outside 0-7`);
  }
  return out;
}

const DECODE = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** 26 Crockford Base32 characters -> 16 bytes. Rejects anything the strict pattern would reject. */
export function decodePayload(payload: string): Uint8Array {
  if (payload.length !== PAYLOAD_LENGTH) {
    throw new RecordIdError(`payload must be ${PAYLOAD_LENGTH} chars, got ${payload.length}`);
  }
  const bytes = new Uint8Array(16);
  let acc = 0;
  // The two zero pad bits live at the FRONT, inside the first character, so they are dropped on the
  // way in rather than left over at the end. 3 + 25*5 = 128 bits = exactly 16 bytes, nothing spare.
  let bits = 0;
  let index = 0;
  for (let i = 0; i < PAYLOAD_LENGTH; i += 1) {
    const code = payload.charCodeAt(i);
    const value = code < 128 ? DECODE[code]! : -1;
    if (value < 0) throw new RecordIdError(`payload character ${JSON.stringify(payload[i])} is not in the Crockford alphabet`);
    if (i === 0) {
      if (value > 7) throw new RecordIdError("payload overflows 128 bits: the first character must be 0-7");
      acc = value & 0x07;
      bits = 3;
      continue;
    }
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes[index] = (acc >>> bits) & 0xff;
      index += 1;
    }
    acc &= (1 << bits) - 1;
  }
  if (index !== 16 || bits !== 0 || acc !== 0) {
    throw new RecordIdError("payload did not decode to exactly 16 bytes with zero padding");
  }
  return bytes;
}

// ════════════════════ THE 128-BIT SOURCE ════════════════════

/**
 * A UUIDv7 (RFC 9562 §5.7) as 16 bytes.
 *
 *   0..5   48-bit big-endian Unix milliseconds
 *   6      version nibble 0111 | 4 random bits
 *   7      8 random bits
 *   8      variant bits 10 | 6 random bits
 *   9..15  56 random bits
 *
 * Node 22 does NOT provide this. `crypto.randomUUID({ version: 7 })` is accepted and silently
 * ignored -- it still returns a v4 -- which is why fifteen lines here beat a dependency.
 *
 * `now` and `fill` are injected so a test can pin the clock and the entropy. Production passes
 * neither and gets `Date.now()` and `node:crypto`.
 */
export function uuidV7Bytes(now: number = Date.now(), fill: (b: Uint8Array) => void = (b) => { randomFillSync(b); }): Uint8Array {
  if (!Number.isInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new RecordIdError(`timestamp out of range for a 48-bit millisecond field: ${now}`);
  }
  const bytes = new Uint8Array(16);
  fill(bytes);
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  return bytes;
}

/** 128 CSPRNG bits shaped as a UUIDv4. No timestamp, no ordering, no write hotspot. */
export function uuidV4Bytes(fill: (b: Uint8Array) => void = (b) => { randomFillSync(b); }): Uint8Array {
  const bytes = new Uint8Array(16);
  fill(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytes;
}

// ════════════════════ OBJECT CODES ════════════════════

/** The SHAPE of an object code. Registration is a separate question -- see the header. */
export function isObjectCodeShape(value: unknown): value is string {
  return typeof value === "string" && OBJECT_CODE_PATTERN.test(value);
}

/**
 * The namespace partition (registry §2). The FIRST LETTER decides who may allocate, which is what
 * guarantees a customer-defined object can never collide with a Verenward object that does not
 * exist yet.
 */
export type ObjectCodePartition = "PLATFORM" | "CUSTOMER" | "RESERVED";

export function objectCodePartition(code: string): ObjectCodePartition {
  if (!isObjectCodeShape(code)) throw new RecordIdError(`not an object code: ${JSON.stringify(code)}`);
  if (code[0] === "X") return "CUSTOMER";
  if (code[0] === "Z") return "RESERVED";
  return "PLATFORM";
}

/** The seam a runtime registry plugs into. Today it checks shape only; see the header. */
export function assertRegisteredObjectCode(code: string): void {
  if (!isObjectCodeShape(code)) {
    throw new RecordIdError(`object code must be exactly ${OBJECT_CODE_LENGTH} characters A-Z, got ${JSON.stringify(code)}`);
  }
}

// ════════════════════ MINT / PARSE / VALIDATE ════════════════════

export interface MintOptions {
  ordering?: RecordIdOrdering;
  now?: number;
  fill?: (b: Uint8Array) => void;
}

/**
 * THE ONLY MINTING PATH. A Record ID is minted by the platform, server-side, here and nowhere else.
 * No client, import file, fixture, migration script, seed, customer, integration partner or
 * administrator supplies one.
 */
export function mintRecordId(objectCode: string, options: MintOptions = {}): string {
  assertRegisteredObjectCode(objectCode);
  const ordering = options.ordering ?? "TIME_ORDERED";
  const bytes = ordering === "SCATTERED"
    ? uuidV4Bytes(options.fill)
    : uuidV7Bytes(options.now ?? Date.now(), options.fill);
  return `${objectCode}${SEPARATOR}${encodePayload(bytes)}`;
}

export interface ParsedRecordId {
  readonly objectCode: string;
  readonly payload: string;
}

/** `{ objectCode, payload }` or null. NEVER throws -- an unrecognised string is a question. */
export function parseRecordId(value: unknown): ParsedRecordId | null {
  if (typeof value !== "string" || value.length !== RECORD_ID_LENGTH) return null;
  if (!RECORD_ID_PATTERN.test(value)) return null;
  return { objectCode: value.slice(0, OBJECT_CODE_LENGTH), payload: value.slice(OBJECT_CODE_LENGTH + 1) };
}

/** Strict validation, optionally asserting the object. Returns a boolean; never throws. */
export function isRecordId(value: unknown, objectCode?: string): boolean {
  if (typeof value !== "string" || !RECORD_ID_PATTERN_STRICT.test(value)) return false;
  return objectCode === undefined || value.slice(0, OBJECT_CODE_LENGTH) === objectCode;
}

/**
 * Assert at a service boundary. This is what turns "an Account id cannot be used as a Work Order
 * id" from a property of the format into a mechanism: the failure names both codes and happens at
 * the boundary, instead of surfacing as a not-found three services away.
 */
export function assertRecordId(value: unknown, objectCode: string): string {
  assertRegisteredObjectCode(objectCode);
  const parsed = parseRecordId(value);
  if (parsed === null) {
    throw new RecordIdError(`expected a ${objectCode} record id, got ${JSON.stringify(value)}`);
  }
  if (parsed.objectCode !== objectCode) {
    throw new RecordIdError(`expected a ${objectCode} record id, got a ${parsed.objectCode} one`);
  }
  if (!RECORD_ID_PATTERN_STRICT.test(value as string)) {
    throw new RecordIdError(`${objectCode} record id payload overflows 128 bits`);
  }
  return value as string;
}

// ════════════════════ INGRESS NORMALISATION ════════════════════

// Crockford's decode-time ambiguity mapping, for the PAYLOAD ONLY.
const AMBIGUITY: Readonly<Record<string, string>> = Object.freeze({ I: "1", L: "1", O: "0" });

/** Any code point outside 7-bit ASCII. See `normalizeRecordId` for why this is checked first. */
const NON_ASCII = /[^\x00-\x7F]/;

/**
 * The §6.2 ingress normaliser, and the ONLY place the ambiguity mapping is ever applied.
 *
 * Call this exactly once, at the edge -- a URL, a form field, a query parameter, an import file, an
 * API body, a support ticket. From that point inward only the canonical form exists. Never call it
 * on a value already inside the system, never store a non-canonical form, and never compare
 * case-insensitively: Firestore document ids and Postgres TEXT are both case-sensitive, so a
 * case-insensitive comparison layered over a case-sensitive store produces "the same record" that
 * the store believes is two records.
 *
 * THE MAPPING IS APPLIED TO THE PAYLOAD AND NEVER TO THE OBJECT CODE. This is not a nicety: I, L
 * and O are perfectly legal letters in an object code, and `LOCN` -- Location -- would normalise to
 * `10CN` under a naive whole-string mapping. That is the bug this split exists to make impossible.
 *
 * Returns the canonical form, or null if the input cannot be one.
 */
export function normalizeRecordId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length !== RECORD_ID_LENGTH) return null;
  // §3: "Encoding -- 7-bit ASCII; no Unicode, no normalisation forms". This gate must come BEFORE
  // any case mapping, because `String.prototype.toUpperCase()` applies the full Unicode case
  // mapping: U+0131 "ı" uppercases to "I" and U+017F "ſ" uppercases to "S". Without this check a
  // non-ASCII input is not rejected but REPAIRED -- "ıCCT_…" normalises to "ICCT_…" and
  // "ACCT_0123456ı89…" to "ACCT_0123456189…" -- silently resolving one caller's string onto a
  // DIFFERENT record's canonical id. An ingress normaliser may repair case and Crockford
  // ambiguity; it may not invent an identifier out of a homoglyph.
  if (NON_ASCII.test(trimmed)) return null;
  if (trimmed[OBJECT_CODE_LENGTH] !== SEPARATOR) return null;

  const code = trimmed.slice(0, OBJECT_CODE_LENGTH).toUpperCase();
  if (!OBJECT_CODE_PATTERN.test(code)) return null;

  let payload = "";
  for (const ch of trimmed.slice(OBJECT_CODE_LENGTH + 1).toUpperCase()) {
    payload += AMBIGUITY[ch] ?? ch;
  }

  const candidate = `${code}${SEPARATOR}${payload}`;
  return RECORD_ID_PATTERN_STRICT.test(candidate) ? candidate : null;
}

// ════════════════════ THE UUID BIJECTION ════════════════════

const HEX = "0123456789abcdef";

function bytesToUuid(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < 16; i += 1) {
    hex += HEX[(bytes[i]! >>> 4) & 0x0f];
    hex += HEX[bytes[i]! & 0x0f];
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_PATTERN.test(uuid)) throw new RecordIdError(`not a UUID: ${JSON.stringify(uuid)}`);
  const hex = uuid.replace(/-/g, "").toLowerCase();
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * The payload as a standard UUID. This is what makes a Postgres `uuid` column available WITHOUT
 * changing the printed identifier, and what buys interoperability with every tool that already
 * understands UUIDs. It is a representation, not a second identity.
 */
export function recordIdToUuid(value: string): string {
  const parsed = parseRecordId(value);
  if (parsed === null) throw new RecordIdError(`not a record id: ${JSON.stringify(value)}`);
  return bytesToUuid(decodePayload(parsed.payload));
}

/** The inverse: a UUID as a 26-character payload. `uuidToRecordPayload(recordIdToUuid(x))` is x's payload. */
export function uuidToRecordPayload(uuid: string): string {
  return encodePayload(uuidToBytes(uuid));
}

/** Compose a Record ID from an object code and an existing UUID. For a crosswalk, never for minting. */
export function recordIdFromUuid(objectCode: string, uuid: string): string {
  assertRegisteredObjectCode(objectCode);
  return `${objectCode}${SEPARATOR}${uuidToRecordPayload(uuid)}`;
}

// ════════════════════ THE TIMESTAMP, AND WHY IT IS NOT EXPORTED FOR USE ════════════════════

/**
 * The 48-bit millisecond timestamp inside a TIME_ORDERED payload.
 *
 * THIS EXISTS FOR THE TEST SUITE AND FOR FORENSICS. No production code path may call it.
 *
 * The instant in the id is when the IDENTITY was minted, which for an imported record is the import
 * time and not the historical event date. It is therefore useless as business data and actively
 * harmful if read as such. Creation time is a stored, queryable field (`createdAt`); the bits in
 * here exist for index locality and for nothing else, and are not a documented part of the format.
 *
 * A SCATTERED payload has no timestamp, and this function will happily return the meaningless
 * number its random leading bits encode -- which is the second reason not to call it.
 */
export function unsafeDecodeMintInstant(value: string): number {
  const parsed = parseRecordId(value);
  if (parsed === null) throw new RecordIdError(`not a record id: ${JSON.stringify(value)}`);
  const b = decodePayload(parsed.payload);
  return b[0]! * 2 ** 40 + b[1]! * 2 ** 32 + b[2]! * 2 ** 24 + b[3]! * 2 ** 16 + b[4]! * 2 ** 8 + b[5]!;
}
