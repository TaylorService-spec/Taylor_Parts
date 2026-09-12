// Proves the claims the Verenward Global Record Identity Standard makes.
//
// SPEC: docs/architecture/verenward-global-record-identity-standard.md
//
// Every test here corresponds to a sentence in that document that would otherwise be an assertion
// nobody checks. The ordering proof (§5.2) and the object-code/ambiguity separation (§6.2) are the
// two that would fail silently and expensively if they were wrong.
import assert from "node:assert/strict";
import test from "node:test";
import {
  OBJECT_CODE_LENGTH,
  PAYLOAD_LENGTH,
  RECORD_ID_LENGTH,
  RECORD_ID_PATTERN,
  RECORD_ID_PATTERN_STRICT,
  RecordIdError,
  assertRecordId,
  decodePayload,
  encodePayload,
  isObjectCodeShape,
  isRecordId,
  mintRecordId,
  normalizeRecordId,
  objectCodePartition,
  parseRecordId,
  recordIdFromUuid,
  recordIdToUuid,
  unsafeDecodeMintInstant,
  uuidToRecordPayload,
  uuidV4Bytes,
  uuidV7Bytes,
} from "../lib/identity/recordId.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// A deterministic byte filler, so a test can pin the entropy without pinning the algorithm.
const constantFill = (byte) => (b) => b.fill(byte);
const seqFill = (start) => (b) => { for (let i = 0; i < b.length; i += 1) b[i] = (start + i) & 0xff; };

// ════════════════════ §3 — the fixed properties ════════════════════

test("§3 an id is exactly 31 characters: 4 + 1 + 26", () => {
  const id = mintRecordId("ACCT");
  assert.equal(id.length, RECORD_ID_LENGTH);
  assert.equal(RECORD_ID_LENGTH, OBJECT_CODE_LENGTH + 1 + PAYLOAD_LENGTH);
  assert.equal(id[OBJECT_CODE_LENGTH], "_");
  assert.equal(id.slice(0, 4), "ACCT");
});

test("§3.1 every minted id matches the STRICT pattern, over many samples", () => {
  for (const code of ["ACCT", "WKOR", "PART", "INVC", "MLOC", "LOCN"]) {
    for (let i = 0; i < 500; i += 1) {
      const id = mintRecordId(code);
      assert.ok(RECORD_ID_PATTERN_STRICT.test(id), `strict pattern rejected ${id}`);
      assert.ok(RECORD_ID_PATTERN.test(id));
      assert.ok(isRecordId(id, code));
    }
  }
});

test("§3 the alphabet is Crockford: 32 symbols, ascending, no I L O U", () => {
  assert.equal(CROCKFORD.length, 32);
  assert.equal(new Set(CROCKFORD).size, 32);
  for (const bad of ["I", "L", "O", "U"]) assert.ok(!CROCKFORD.includes(bad), `${bad} must not be in the alphabet`);
  // Ascending ASCII order is what §5.2's proof rests on.
  for (let i = 1; i < CROCKFORD.length; i += 1) {
    assert.ok(CROCKFORD[i - 1] < CROCKFORD[i], `alphabet not ascending at index ${i}`);
  }
});

test("§3 the first payload character is always 0-7 (the two zero pad bits)", () => {
  // All-ones input is the worst case: if padding leaked, this is where it would show.
  const maxed = encodePayload(new Uint8Array(16).fill(0xff));
  assert.equal(maxed.length, PAYLOAD_LENGTH);
  assert.equal(maxed[0], "7");
  assert.equal(encodePayload(new Uint8Array(16)), "0".repeat(26));
  for (let i = 0; i < 300; i += 1) {
    assert.ok("01234567".includes(mintRecordId("PART")[5]));
  }
});

test("§3 a payload that overflows 128 bits is rejected, not truncated", () => {
  assert.throws(() => decodePayload("8" + "0".repeat(25)), RecordIdError);
  assert.equal(normalizeRecordId("PART_" + "8" + "0".repeat(25)), null);
  assert.equal(isRecordId("PART_" + "Z".repeat(26)), false);
});

// ════════════════════ §4 — the 128-bit source ════════════════════

test("§4.4 uuidV7Bytes lays out RFC 9562 §5.7: 48-bit ms, version 7, variant 10", () => {
  const now = 0x0123456789ab;
  const b = uuidV7Bytes(now, constantFill(0xff));
  assert.deepEqual([...b.slice(0, 6)], [0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
  assert.equal(b[6] >>> 4, 0x7, "version nibble must be 7");
  assert.equal(b[8] >>> 6, 0b10, "variant bits must be 10");
});

test("§4.4 uuidV4Bytes sets version 4 and carries no timestamp", () => {
  const b = uuidV4Bytes(constantFill(0x00));
  assert.equal(b[6] >>> 4, 0x4);
  assert.equal(b[8] >>> 6, 0b10);
});

test("§4.1 the UUID bijection is lossless in both directions", () => {
  for (let i = 0; i < 500; i += 1) {
    const id = mintRecordId("SORD");
    const uuid = recordIdToUuid(id);
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(recordIdFromUuid("SORD", uuid), id, "record id -> uuid -> record id must round-trip");
    assert.equal(uuidToRecordPayload(uuid), parseRecordId(id).payload);
  }
});

test("§4.1 encode/decode round-trips every byte pattern we can cheaply cover", () => {
  for (let byte = 0; byte < 256; byte += 1) {
    const bytes = new Uint8Array(16).fill(byte);
    assert.deepEqual([...decodePayload(encodePayload(bytes))], [...bytes]);
  }
  for (let start = 0; start < 64; start += 1) {
    const bytes = new Uint8Array(16);
    seqFill(start)(bytes);
    assert.deepEqual([...decodePayload(encodePayload(bytes))], [...bytes]);
  }
});

// ════════════════════ §5 — sorting ════════════════════

test("§5.2 LEXICAL order of the id equals TIME order of the mint instant", () => {
  // The load-bearing claim. Byte-comparing two 31-char strings must order them by creation ms.
  const ids = [];
  for (let ms = 1; ms <= 400; ms += 1) {
    // Random entropy each time, so nothing but the timestamp can be doing the ordering.
    ids.push({ ms, id: mintRecordId("IVTX", { now: ms * 7919 }) });
  }
  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  const byString = [...shuffled].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byTime = [...shuffled].sort((a, b) => a.ms - b.ms);
  assert.deepEqual(byString.map((x) => x.ms), byTime.map((x) => x.ms));
});

test("§5.2 ordering holds across the whole 48-bit millisecond range", () => {
  const instants = [0, 1, 255, 256, 65535, 65536, 2 ** 24, 2 ** 32, Date.now(), 0xffffffffffff];
  const ids = instants.map((ms) => mintRecordId("WKOR", { now: ms, fill: constantFill(0) }));
  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(ids[i - 1] < ids[i], `${instants[i - 1]} should sort before ${instants[i]}`);
  }
});

test("§5.1 the object code is a strict prefix, so one object's ids sort together", () => {
  const mixed = [];
  for (const code of ["ACCT", "WKOR", "PART"]) {
    for (let i = 0; i < 40; i += 1) mixed.push(mintRecordId(code, { now: Date.now() - i }));
  }
  const sorted = [...mixed].sort();
  const codes = sorted.map((id) => id.slice(0, 4));
  assert.deepEqual(codes, [...codes].sort(), "codes must appear in contiguous ascending runs");
});

test("§5.3 SCATTERED and TIME_ORDERED are indistinguishable from outside", () => {
  const t = mintRecordId("IVTX", { ordering: "TIME_ORDERED" });
  const s = mintRecordId("IVTX", { ordering: "SCATTERED" });
  assert.equal(t.length, s.length);
  assert.ok(RECORD_ID_PATTERN_STRICT.test(t) && RECORD_ID_PATTERN_STRICT.test(s));
  assert.ok(isRecordId(t, "IVTX") && isRecordId(s, "IVTX"));
  assert.equal(parseRecordId(t).objectCode, parseRecordId(s).objectCode);
});

test("§5.3 SCATTERED ids do NOT sort by time (which is the point)", () => {
  const early = mintRecordId("IVTX", { ordering: "SCATTERED", fill: constantFill(0xff) });
  const late = mintRecordId("IVTX", { ordering: "SCATTERED", fill: constantFill(0x00) });
  // Minted later, sorts earlier. No time correlation, therefore no write hotspot.
  assert.ok(late < early);
});

test("§5.4 ids minted in the same millisecond are NOT totally ordered", () => {
  const now = 1_700_000_000_000;
  const a = mintRecordId("WKOR", { now, fill: constantFill(0x11) });
  const b = mintRecordId("WKOR", { now, fill: constantFill(0x22) });
  assert.notEqual(a, b);
  assert.equal(unsafeDecodeMintInstant(a), unsafeDecodeMintInstant(b));
  // Their relative order is the random tail's, not a creation sequence. Nothing may rely on it.
});

// ════════════════════ §6 — case, ambiguity, separator ════════════════════

test("§6.2 THE OBJECT CODE IS NEVER AMBIGUITY-MAPPED: LOCN does not become 10CN", () => {
  // The bug this split exists to make impossible. I, L and O are legal letters in an object code.
  for (const code of ["LOCN", "MLOC", "IVTX", "OPPT", "IADJ", "RLOC", "SLOC", "PALS"]) {
    const id = mintRecordId(code);
    assert.equal(normalizeRecordId(id), id, `${code} must survive normalisation unchanged`);
    assert.equal(normalizeRecordId(id.toLowerCase()), id, `${code} lowercased must normalise back`);
    assert.equal(normalizeRecordId(id).slice(0, 4), code);
  }
});

test("§6.2 the payload IS ambiguity-mapped: I/L -> 1, O -> 0, lowercase -> upper", () => {
  const canonical = "LOCN_0123456789ABCDEFGHJKMNPQRS";
  assert.ok(RECORD_ID_PATTERN_STRICT.test(canonical));
  // Someone retyping from a printed page confuses O for 0 and I/l for 1.
  assert.equal(normalizeRecordId("LOCN_O123456789ABCDEFGHJKMNPQRS"), canonical);
  assert.equal(normalizeRecordId("LOCN_0I23456789ABCDEFGHJKMNPQRS"), canonical);
  assert.equal(normalizeRecordId("LOCN_0l23456789ABCDEFGHJKMNPQRS"), canonical);
  assert.equal(normalizeRecordId("locn_0123456789abcdefghjkmnpqrs"), canonical);
  assert.equal(normalizeRecordId("  LOCN_0123456789ABCDEFGHJKMNPQRS  "), canonical);
});

test("§6.1 comparison is case-SENSITIVE: a lowercase id is not a valid id at rest", () => {
  const id = mintRecordId("ACCT");
  assert.equal(isRecordId(id.toLowerCase()), false);
  assert.equal(parseRecordId(id.toLowerCase()), null);
  assert.throws(() => assertRecordId(id.toLowerCase(), "ACCT"), RecordIdError);
  // It is only ever repaired at the ingress boundary, and only there.
  assert.equal(normalizeRecordId(id.toLowerCase()), id);
});

test("§6.2 normalisation REJECTS rather than repairs anything that is not an id", () => {
  for (const bad of [
    null, undefined, 42, "", "ACCT", "ACCT_", "ACCT-0123456789ABCDEFGHJKMNPQRS",
    "AC_T_0123456789ABCDEFGHJKMNPQRS", "ACC1_0123456789ABCDEFGHJKMNPQRS",
    "ACCT_0123456789ABCDEFGHJKMNPQR", "ACCT_0123456789ABCDEFGHJKMNPQRST",
    "ACCT_U123456789ABCDEFGHJKMNPQRS", "ACCT/0123456789ABCDEFGHJKMNPQRS",
  ]) {
    assert.equal(normalizeRecordId(bad), null, `${JSON.stringify(bad)} must not normalise`);
  }
});

test("§6.3 the separator is exactly one underscore at index 4, always", () => {
  const id = mintRecordId("TORD");
  assert.equal(id.indexOf("_"), 4);
  assert.equal(id.split("_").length, 2, "exactly one separator");
  assert.equal(normalizeRecordId(id.replace("_", "-")), null, "a hyphen is not the separator");
});

// ════════════════════ §1.3 / §9 — mis-wiring, minting, partitions ════════════════════

test("§1.3 an id of the wrong object fails at the boundary and names both codes", () => {
  const account = mintRecordId("ACCT");
  assert.equal(isRecordId(account, "WKOR"), false);
  assert.throws(
    () => assertRecordId(account, "WKOR"),
    (e) => e instanceof RecordIdError && /expected a WKOR record id, got a ACCT one/.test(e.message),
  );
  assert.equal(assertRecordId(account, "ACCT"), account);
});

test("§9.2 parseRecordId never throws; assertRecordId always does", () => {
  for (const bad of [null, undefined, 0, {}, [], "", "nonsense", mintRecordId("ACCT") + "X"]) {
    assert.equal(parseRecordId(bad), null);
    assert.equal(isRecordId(bad), false);
    assert.throws(() => assertRecordId(bad, "ACCT"), RecordIdError);
  }
});

test("§9.1 minting refuses a malformed object code", () => {
  for (const bad of ["", "ACC", "ACCTS", "acct", "AC1T", "AC_T", "ACCT ", null, 4]) {
    assert.throws(() => mintRecordId(bad), RecordIdError, `mint should refuse ${JSON.stringify(bad)}`);
  }
});

test("registry §2 the first letter partitions the code namespace", () => {
  assert.equal(objectCodePartition("ACCT"), "PLATFORM");
  assert.equal(objectCodePartition("WKOR"), "PLATFORM");
  assert.equal(objectCodePartition("XRNT"), "CUSTOMER");
  assert.equal(objectCodePartition("ZTST"), "RESERVED");
  assert.ok(isObjectCodeShape("PART"));
  assert.ok(!isObjectCodeShape("part"));
});

// ════════════════════ §7 / §13 — collisions and safety ════════════════════

test("§7 a large sample of minted ids contains no duplicate", () => {
  const seen = new Set();
  for (let i = 0; i < 50_000; i += 1) seen.add(mintRecordId("IVTX"));
  assert.equal(seen.size, 50_000);
});

test("§7 ids minted within a single millisecond still differ (74 random bits)", () => {
  const now = 1_700_000_000_000;
  const seen = new Set();
  for (let i = 0; i < 20_000; i += 1) seen.add(mintRecordId("IVTX", { now }));
  assert.equal(seen.size, 20_000);
});

test("§13 the safety matrix holds character by character", () => {
  for (let i = 0; i < 2_000; i += 1) {
    const id = mintRecordId(["ACCT", "WKOR", "INVC", "PART"][i % 4]);
    // URL-unreserved (RFC 3986): never needs percent-encoding.
    assert.equal(encodeURIComponent(id), id);
    assert.equal(encodeURI(id), id);
    // CSV: no comma, quote, newline or CR.
    for (const ch of [",", '"', "\n", "\r", "\t", ";"]) assert.ok(!id.includes(ch));
    // CSV formula injection: the first character is always a letter.
    assert.ok(!["=", "+", "-", "@"].includes(id[0]));
    assert.match(id[0], /[A-Z]/);
    // Spreadsheet auto-format: not a number, not a date, no scientific notation.
    assert.ok(Number.isNaN(Number(id)));
    assert.ok(!id.includes("-") && !id.includes("/") && !id.includes("."));
    // Firestore document id legality.
    assert.ok(!id.includes("/") && id !== "." && id !== ".." && !/^__.*__$/.test(id));
    assert.ok(Buffer.byteLength(id, "utf8") === 31 && Buffer.byteLength(id) < 1500);
    // Shell / glob / regex metacharacters.
    assert.ok(!/[*?[\]{}~!$&|;<>()'"`\\ ]/.test(id));
    // grep -w: the whole token is one word, because _ is a word character.
    assert.ok(new RegExp(`\\b${id}\\b`).test(`before ${id} after`));
    // JSON: survives a round trip byte for byte.
    assert.equal(JSON.parse(JSON.stringify({ id })).id, id);
  }
});

// ════════════════════ §2.2 — the timestamp is not business data ════════════════════

test("§2.2 the embedded instant is mint time and is recoverable only by the forensic path", () => {
  const now = 1_764_000_000_123;
  const id = mintRecordId("WKOR", { now });
  assert.equal(unsafeDecodeMintInstant(id), now);
  // Nothing else in the surface exposes it: parse gives you the opaque payload and nothing more.
  assert.deepEqual(Object.keys(parseRecordId(id)).sort(), ["objectCode", "payload"]);
});
