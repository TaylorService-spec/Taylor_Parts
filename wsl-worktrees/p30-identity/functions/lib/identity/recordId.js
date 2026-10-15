"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordIdError = exports.OBJECT_CODE_PATTERN = exports.RECORD_ID_PATTERN_STRICT = exports.RECORD_ID_PATTERN = exports.SEPARATOR = exports.RECORD_ID_LENGTH = exports.OBJECT_CODE_LENGTH = exports.PAYLOAD_LENGTH = void 0;
exports.encodePayload = encodePayload;
exports.decodePayload = decodePayload;
exports.uuidV7Bytes = uuidV7Bytes;
exports.uuidV4Bytes = uuidV4Bytes;
exports.isObjectCodeShape = isObjectCodeShape;
exports.objectCodePartition = objectCodePartition;
exports.assertRegisteredObjectCode = assertRegisteredObjectCode;
exports.mintRecordId = mintRecordId;
exports.parseRecordId = parseRecordId;
exports.isRecordId = isRecordId;
exports.assertRecordId = assertRecordId;
exports.normalizeRecordId = normalizeRecordId;
exports.recordIdToUuid = recordIdToUuid;
exports.uuidToRecordPayload = uuidToRecordPayload;
exports.recordIdFromUuid = recordIdFromUuid;
exports.unsafeDecodeMintInstant = unsafeDecodeMintInstant;
const node_crypto_1 = require("node:crypto");
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
exports.PAYLOAD_LENGTH = 26;
/** Object code length in characters. See the standard §1.2 for why 4 and not 3. */
exports.OBJECT_CODE_LENGTH = 4;
/** Total Record ID length. Fixed, so CHAR(31) is available and nothing truncates. */
exports.RECORD_ID_LENGTH = 31;
/** The separator. U+005F LOW LINE, always at index 4, never any other character. */
exports.SEPARATOR = "_";
/**
 * PERMISSIVE form -- what a parser accepts.
 * STRICT form -- what is minted and what a database CHECK constraint should enforce. The leading
 * `[0-7]` encodes the two zero pad bits: 128 bits left-padded into 130 cannot set them.
 */
exports.RECORD_ID_PATTERN = /^[A-Z]{4}_[0-9A-HJKMNP-TV-Z]{26}$/;
exports.RECORD_ID_PATTERN_STRICT = /^[A-Z]{4}_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
exports.OBJECT_CODE_PATTERN = /^[A-Z]{4}$/;
class RecordIdError extends Error {
    constructor(message) {
        super(message);
        this.name = "RecordIdError";
    }
}
exports.RecordIdError = RecordIdError;
// ════════════════════ BASE32 ════════════════════
/**
 * 16 bytes -> 26 Crockford Base32 characters, big-endian, left-padded with two zero bits.
 *
 * Implemented over a bit accumulator rather than BigInt so the padding is explicit: the first
 * emitted group is (2 pad bits << 3 | top 3 bits of byte 0), which is why the first character can
 * only ever be 0-7.
 */
function encodePayload(bytes) {
    if (bytes.length !== 16)
        throw new RecordIdError(`payload must be 16 bytes, got ${bytes.length}`);
    let out = "";
    let acc = 0;
    let bits = 2; // the two zero pad bits, present before any byte is read
    for (let i = 0; i < 16; i += 1) {
        acc = (acc << 8) | bytes[i];
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += ALPHABET[(acc >>> bits) & 0x1f];
        }
        acc &= (1 << bits) - 1;
    }
    // 2 + 128 = 130 bits = exactly 26 groups, so nothing is left over.
    if (bits !== 0 || out.length !== exports.PAYLOAD_LENGTH) {
        throw new RecordIdError(`encoder produced ${out.length} chars with ${bits} bits left over`);
    }
    return out;
}
const DECODE = (() => {
    const table = new Int8Array(128).fill(-1);
    for (let i = 0; i < ALPHABET.length; i += 1)
        table[ALPHABET.charCodeAt(i)] = i;
    return table;
})();
/** 26 Crockford Base32 characters -> 16 bytes. Rejects anything the strict pattern would reject. */
function decodePayload(payload) {
    if (payload.length !== exports.PAYLOAD_LENGTH) {
        throw new RecordIdError(`payload must be ${exports.PAYLOAD_LENGTH} chars, got ${payload.length}`);
    }
    const bytes = new Uint8Array(16);
    let acc = 0;
    // The two zero pad bits live at the FRONT, inside the first character, so they are dropped on the
    // way in rather than left over at the end. 3 + 25*5 = 128 bits = exactly 16 bytes, nothing spare.
    let bits = 0;
    let index = 0;
    for (let i = 0; i < exports.PAYLOAD_LENGTH; i += 1) {
        const code = payload.charCodeAt(i);
        const value = code < 128 ? DECODE[code] : -1;
        if (value < 0)
            throw new RecordIdError(`payload character ${JSON.stringify(payload[i])} is not in the Crockford alphabet`);
        if (i === 0) {
            if (value > 7)
                throw new RecordIdError("payload overflows 128 bits: the first character must be 0-7");
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
function uuidV7Bytes(now = Date.now(), fill = (b) => { (0, node_crypto_1.randomFillSync)(b); }) {
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
    bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    return bytes;
}
/** 128 CSPRNG bits shaped as a UUIDv4. No timestamp, no ordering, no write hotspot. */
function uuidV4Bytes(fill = (b) => { (0, node_crypto_1.randomFillSync)(b); }) {
    const bytes = new Uint8Array(16);
    fill(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytes;
}
// ════════════════════ OBJECT CODES ════════════════════
/** The SHAPE of an object code. Registration is a separate question -- see the header. */
function isObjectCodeShape(value) {
    return typeof value === "string" && exports.OBJECT_CODE_PATTERN.test(value);
}
function objectCodePartition(code) {
    if (!isObjectCodeShape(code))
        throw new RecordIdError(`not an object code: ${JSON.stringify(code)}`);
    if (code[0] === "X")
        return "CUSTOMER";
    if (code[0] === "Z")
        return "RESERVED";
    return "PLATFORM";
}
/** The seam a runtime registry plugs into. Today it checks shape only; see the header. */
function assertRegisteredObjectCode(code) {
    if (!isObjectCodeShape(code)) {
        throw new RecordIdError(`object code must be exactly ${exports.OBJECT_CODE_LENGTH} characters A-Z, got ${JSON.stringify(code)}`);
    }
}
/**
 * THE ONLY MINTING PATH. A Record ID is minted by the platform, server-side, here and nowhere else.
 * No client, import file, fixture, migration script, seed, customer, integration partner or
 * administrator supplies one.
 */
function mintRecordId(objectCode, options = {}) {
    assertRegisteredObjectCode(objectCode);
    const ordering = options.ordering ?? "TIME_ORDERED";
    const bytes = ordering === "SCATTERED"
        ? uuidV4Bytes(options.fill)
        : uuidV7Bytes(options.now ?? Date.now(), options.fill);
    return `${objectCode}${exports.SEPARATOR}${encodePayload(bytes)}`;
}
/** `{ objectCode, payload }` or null. NEVER throws -- an unrecognised string is a question. */
function parseRecordId(value) {
    if (typeof value !== "string" || value.length !== exports.RECORD_ID_LENGTH)
        return null;
    if (!exports.RECORD_ID_PATTERN.test(value))
        return null;
    return { objectCode: value.slice(0, exports.OBJECT_CODE_LENGTH), payload: value.slice(exports.OBJECT_CODE_LENGTH + 1) };
}
/** Strict validation, optionally asserting the object. Returns a boolean; never throws. */
function isRecordId(value, objectCode) {
    if (typeof value !== "string" || !exports.RECORD_ID_PATTERN_STRICT.test(value))
        return false;
    return objectCode === undefined || value.slice(0, exports.OBJECT_CODE_LENGTH) === objectCode;
}
/**
 * Assert at a service boundary. This is what turns "an Account id cannot be used as a Work Order
 * id" from a property of the format into a mechanism: the failure names both codes and happens at
 * the boundary, instead of surfacing as a not-found three services away.
 */
function assertRecordId(value, objectCode) {
    assertRegisteredObjectCode(objectCode);
    const parsed = parseRecordId(value);
    if (parsed === null) {
        throw new RecordIdError(`expected a ${objectCode} record id, got ${JSON.stringify(value)}`);
    }
    if (parsed.objectCode !== objectCode) {
        throw new RecordIdError(`expected a ${objectCode} record id, got a ${parsed.objectCode} one`);
    }
    if (!exports.RECORD_ID_PATTERN_STRICT.test(value)) {
        throw new RecordIdError(`${objectCode} record id payload overflows 128 bits`);
    }
    return value;
}
// ════════════════════ INGRESS NORMALISATION ════════════════════
// Crockford's decode-time ambiguity mapping, for the PAYLOAD ONLY.
const AMBIGUITY = Object.freeze({ I: "1", L: "1", O: "0" });
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
function normalizeRecordId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (trimmed.length !== exports.RECORD_ID_LENGTH)
        return null;
    if (trimmed[exports.OBJECT_CODE_LENGTH] !== exports.SEPARATOR)
        return null;
    const code = trimmed.slice(0, exports.OBJECT_CODE_LENGTH).toUpperCase();
    if (!exports.OBJECT_CODE_PATTERN.test(code))
        return null;
    let payload = "";
    for (const ch of trimmed.slice(exports.OBJECT_CODE_LENGTH + 1).toUpperCase()) {
        payload += AMBIGUITY[ch] ?? ch;
    }
    const candidate = `${code}${exports.SEPARATOR}${payload}`;
    return exports.RECORD_ID_PATTERN_STRICT.test(candidate) ? candidate : null;
}
// ════════════════════ THE UUID BIJECTION ════════════════════
const HEX = "0123456789abcdef";
function bytesToUuid(bytes) {
    let hex = "";
    for (let i = 0; i < 16; i += 1) {
        hex += HEX[(bytes[i] >>> 4) & 0x0f];
        hex += HEX[bytes[i] & 0x0f];
    }
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function uuidToBytes(uuid) {
    if (!UUID_PATTERN.test(uuid))
        throw new RecordIdError(`not a UUID: ${JSON.stringify(uuid)}`);
    const hex = uuid.replace(/-/g, "").toLowerCase();
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1)
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}
/**
 * The payload as a standard UUID. This is what makes a Postgres `uuid` column available WITHOUT
 * changing the printed identifier, and what buys interoperability with every tool that already
 * understands UUIDs. It is a representation, not a second identity.
 */
function recordIdToUuid(value) {
    const parsed = parseRecordId(value);
    if (parsed === null)
        throw new RecordIdError(`not a record id: ${JSON.stringify(value)}`);
    return bytesToUuid(decodePayload(parsed.payload));
}
/** The inverse: a UUID as a 26-character payload. `uuidToRecordPayload(recordIdToUuid(x))` is x's payload. */
function uuidToRecordPayload(uuid) {
    return encodePayload(uuidToBytes(uuid));
}
/** Compose a Record ID from an object code and an existing UUID. For a crosswalk, never for minting. */
function recordIdFromUuid(objectCode, uuid) {
    assertRegisteredObjectCode(objectCode);
    return `${objectCode}${exports.SEPARATOR}${uuidToRecordPayload(uuid)}`;
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
function unsafeDecodeMintInstant(value) {
    const parsed = parseRecordId(value);
    if (parsed === null)
        throw new RecordIdError(`not a record id: ${JSON.stringify(value)}`);
    const b = decodePayload(parsed.payload);
    return b[0] * 2 ** 40 + b[1] * 2 ** 32 + b[2] * 2 ** 24 + b[3] * 2 ** 16 + b[4] * 2 ** 8 + b[5];
}
//# sourceMappingURL=recordId.js.map