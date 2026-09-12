// Property-based and exhaustive proofs for the Verenward Global Record Identity Standard.
//
// SPEC:     docs/architecture/verenward-global-record-identity-standard.md
// REGISTRY: docs/architecture/verenward-object-code-registry-proposed.md
//
// recordIdStandard.test.mjs pins the standard's claims by EXAMPLE. This file pins them by PROPERTY,
// because the pad-bit defect that survived prose review would also have survived example tests: a
// decoder that treats the two pad bits as trailing rather than leading still round-trips plenty of
// individual values. Every test here is either a property over a large random sample, an exhaustive
// sweep of a bounded space, or a named regression pin for a defect this lane actually found.
//
// It also pins, deliberately, three things the standard does NOT provide (intra-millisecond order,
// forged-id detection, object-code preservation through the UUID projection). Those pins exist so a
// future reader cannot mistake an absent guarantee for an untested one.
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { randomFillSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
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
  uuidV7Bytes,
} from "../lib/identity/recordId.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const byteCmp = (a, b) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
const strCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hex = (b) => Buffer.from(b).toString("hex");

// ════════════════════ 1. 128-BIT ENCODING CORRECTNESS (checklist item 1) ════════════════════

test("item 1 PROPERTY bytes -> payload -> bytes is the identity over 200k random 128-bit values", () => {
  const b = new Uint8Array(16);
  for (let n = 0; n < 200_000; n += 1) {
    randomFillSync(b);
    const s = encodePayload(b);
    assert.equal(s.length, PAYLOAD_LENGTH, `payload width for ${hex(b)}`);
    assert.deepEqual([...decodePayload(s)], [...b], `round trip for ${hex(b)} via ${s}`);
  }
});

test("item 1 EXHAUSTIVE every one of the 128 bit positions round-trips, in both polarities", () => {
  // 256 vectors: each single bit set in an otherwise-zero value, and each single bit CLEARED in an
  // otherwise-all-ones value. A shift/pad/endianness error at ANY bit position shows up here, which
  // a random sample can miss and a hand-picked example certainly does.
  for (let bit = 0; bit < 128; bit += 1) {
    const lo = new Uint8Array(16);
    lo[bit >> 3] = 1 << (7 - (bit & 7));
    const hi = new Uint8Array(16).fill(0xff);
    hi[bit >> 3] &= ~(1 << (7 - (bit & 7)));
    for (const v of [lo, hi]) {
      const s = encodePayload(v);
      assert.deepEqual([...decodePayload(s)], [...v], `bit ${bit} vector ${hex(v)} via ${s}`);
      assert.ok("01234567".includes(s[0]), `bit ${bit}: pad bits leaked into ${s[0]}`);
    }
  }
});

test("item 1 BOUNDARY all-zero and all-ones encode to the exact expected strings", () => {
  assert.equal(encodePayload(new Uint8Array(16)), "0".repeat(26));
  // 128 ones left-padded into 130 bits: first group is 0b00111 = 7, then 25 groups of 0b11111 = Z.
  assert.equal(encodePayload(new Uint8Array(16).fill(0xff)), `7${"Z".repeat(25)}`);
  assert.equal(recordIdToUuid("ACCT_00000000000000000000000000"), "00000000-0000-0000-0000-000000000000");
  assert.equal(recordIdToUuid(`ACCT_7${"Z".repeat(25)}`), "ffffffff-ffff-ffff-ffff-ffffffffffff");
});

test("item 1 PROPERTY the OTHER direction: every strict payload decodes and re-encodes to itself", () => {
  // bytes -> str -> bytes only proves the encoder's image is decodable. This proves SURJECTIVITY
  // onto the strict form: every string the strict pattern admits has a 128-bit preimage. A pad-bit
  // error shows up here as a payload that is valid by regex but rejected or altered by the codec.
  for (let n = 0; n < 200_000; n += 1) {
    let s = CROCKFORD[Math.floor(Math.random() * 8)]; // first char 0-7 == strict
    for (let i = 1; i < PAYLOAD_LENGTH; i += 1) s += CROCKFORD[Math.floor(Math.random() * 32)];
    assert.ok(RECORD_ID_PATTERN_STRICT.test(`ACCT_${s}`), `generated non-strict payload ${s}`);
    assert.equal(encodePayload(decodePayload(s)), s, `str -> bytes -> str for ${s}`);
  }
});

test("item 1 PROPERTY the UUID bijection is lossless over 50k random 128-bit values", () => {
  const b = new Uint8Array(16);
  for (let n = 0; n < 50_000; n += 1) {
    randomFillSync(b);
    const h = hex(b);
    const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    const id = recordIdFromUuid("ACCT", uuid);
    assert.equal(recordIdToUuid(id), uuid, `uuid -> id -> uuid for ${uuid}`);
    assert.equal(uuidToRecordPayload(uuid), parseRecordId(id).payload);
  }
});

// ════════════════════ 2. PAD-BIT HANDLING (checklist item 2) ════════════════════

test("item 2 the two pad bits are LEADING, not trailing -- the known defect class", () => {
  // The distinguishing witness. Under LEADING pad bits, byte 15's low 5 bits land in the LAST
  // character and byte 0's top 3 bits land in the FIRST. Under trailing pad bits both shift, so
  // these two assertions cannot both hold. This is the test the original defect would have failed.
  const lowBit = new Uint8Array(16); lowBit[15] = 1;
  assert.equal(encodePayload(lowBit), `${"0".repeat(25)}1`, "the least significant bit must land in the LAST character");
  const topBit = new Uint8Array(16); topBit[0] = 0x80;
  assert.equal(encodePayload(topBit), `4${"0".repeat(25)}`, "bit 0 must land in the FIRST character as 0b00100 = 4");
  // ...and every one of the 8 reachable first-character values is reachable, from byte 0's top 3 bits.
  for (let t = 0; t < 8; t += 1) {
    const v = new Uint8Array(16); v[0] = t << 5;
    assert.equal(encodePayload(v)[0], CROCKFORD[t], `top 3 bits of byte 0 = ${t}`);
    assert.deepEqual([...decodePayload(encodePayload(v))], [...v]);
  }
});

test("item 2 PROPERTY a minted id's first payload character is always 0-7, over 100k mints", () => {
  for (let n = 0; n < 100_000; n += 1) {
    const id = mintRecordId("PART");
    assert.ok("01234567".includes(id[OBJECT_CODE_LENGTH + 1]), `pad bits leaked: ${id}`);
    assert.ok(RECORD_ID_PATTERN_STRICT.test(id), `minted id is not strict: ${id}`);
  }
});

test("item 2 EXHAUSTIVE all 24 illegal first characters overflow 128 bits and are REJECTED", () => {
  // 8..Z would need a 129th..130th bit. Rejected, never truncated, by every entry point.
  for (let fi = 8; fi < 32; fi += 1) {
    let s = CROCKFORD[fi];
    for (let i = 1; i < PAYLOAD_LENGTH; i += 1) s += CROCKFORD[Math.floor(Math.random() * 32)];
    assert.throws(() => decodePayload(s), RecordIdError, `decodePayload accepted overflow ${s}`);
    assert.equal(RECORD_ID_PATTERN_STRICT.test(`ACCT_${s}`), false);
    assert.equal(isRecordId(`ACCT_${s}`), false);
    assert.equal(normalizeRecordId(`ACCT_${s}`), null);
    assert.throws(() => recordIdToUuid(`ACCT_${s}`), RecordIdError);
  }
});

test("item 2 the decoder rejects a payload whose trailing bits are non-zero garbage", () => {
  // Belt and braces on the `acc !== 0` guard: a 26-char payload is exactly 128 bits, so there is no
  // legal slack. Any codec change that leaves slack must fail loudly rather than silently truncate.
  assert.throws(() => decodePayload("0".repeat(25)), RecordIdError);       // 25 chars
  assert.throws(() => decodePayload("0".repeat(27)), RecordIdError);       // 27 chars
  assert.throws(() => decodePayload(`0${"I".repeat(25)}`), RecordIdError); // I is not in the alphabet
  for (const ch of ["I", "L", "O", "U"]) {
    assert.throws(() => decodePayload(`0${ch}${"0".repeat(24)}`), RecordIdError, `${ch} must be rejected by the decoder`);
  }
});

// ════════════════════ 3. LEXICAL ORDERING (checklist item 3) ════════════════════

test("item 3 the alphabet AS IMPLEMENTED is Crockford, recovered through the encoder", () => {
  // recordIdStandard.test.mjs asserts these properties of a CROCKFORD constant declared in the test
  // file, which proves nothing about the module: ALPHABET is not exported, so that assertion passes
  // even if the module's alphabet were reordered. Recover the real one symbol by symbol instead --
  // byte 15's low 5 bits are the last character -- and assert the properties of THAT.
  let recovered = "";
  for (let v = 0; v < 32; v += 1) {
    const bytes = new Uint8Array(16);
    bytes[15] = v;
    recovered += encodePayload(bytes)[PAYLOAD_LENGTH - 1];
  }
  assert.equal(recovered, CROCKFORD, "the encoder's alphabet is not Crockford Base32");
  assert.equal(new Set(recovered).size, 32, "alphabet has a duplicate symbol");
  // STRICTLY ASCENDING ASCII is the entire basis of §5.2's proof.
  for (let i = 1; i < 32; i += 1) {
    assert.ok(recovered.charCodeAt(i - 1) < recovered.charCodeAt(i), `alphabet not ascending at ${i}: ${recovered[i - 1]} !< ${recovered[i]}`);
  }
  // And SKIPPING I/L/O/U preserves order, where remapping them would not: the implemented alphabet
  // is exactly the ascending digits-then-letters sequence with those four deleted in place.
  const skipped = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((c) => !"ILOU".includes(c)).join("");
  assert.equal(recovered, skipped, "alphabet is not digits+letters with I, L, O, U skipped in place");
  for (const bad of "ILOU") assert.ok(!recovered.includes(bad), `${bad} must not be in the alphabet`);
});

test("item 3 PROPERTY sign(byte comparison) === sign(string comparison) over 200k pairs", () => {
  // The load-bearing property, stated as an equivalence rather than a sorted-list spot check.
  const a = new Uint8Array(16); const b = new Uint8Array(16);
  for (let n = 0; n < 200_000; n += 1) {
    randomFillSync(a); randomFillSync(b);
    // Half the pairs share a long prefix, so tie-breaking DEEP in the string is actually exercised.
    if (n % 2 === 0) { const k = 1 + Math.floor(Math.random() * 15); for (let i = 0; i < k; i += 1) b[i] = a[i]; }
    assert.equal(byteCmp(a, b), strCmp(encodePayload(a), encodePayload(b)), `order mismatch ${hex(a)} vs ${hex(b)}`);
  }
});

test("item 3 EXHAUSTIVE incrementing by one always increases the string, across every carry boundary", () => {
  const inc = (v) => { for (let i = 15; i >= 0; i -= 1) { if (v[i] === 0xff) { v[i] = 0; } else { v[i] += 1; return true; } } return false; };
  // A carry that propagates out of byte `bpos` and beyond, for every byte position.
  for (let bpos = 0; bpos < 16; bpos += 1) {
    const v = new Uint8Array(16);
    for (let i = bpos; i < 16; i += 1) v[i] = 0xff;
    const before = encodePayload(v);
    if (!inc(v)) continue; // all-ones wraps to all-zero; not an increment
    assert.ok(before < encodePayload(v), `carry out of byte ${bpos}: ${before} !< ${encodePayload(v)}`);
  }
  // Random walks that force a carry chain out of the last byte.
  for (let trial = 0; trial < 5_000; trial += 1) {
    const v = new Uint8Array(16);
    randomFillSync(v);
    v[0] &= 0x7f; // stay away from the wrap
    v[15] = 0xfd;
    for (let k = 0; k < 6; k += 1) {
      const before = encodePayload(v);
      inc(v);
      assert.ok(before < encodePayload(v), `increment: ${before} !< ${encodePayload(v)}`);
    }
  }
});

test("item 3 PROPERTY printed-string sort order equals mint-timestamp order, 20k random instants", () => {
  const rows = [];
  for (let n = 0; n < 20_000; n += 1) {
    const ms = Math.floor(Math.random() * 0x1000000000000); // the full 48-bit range
    rows.push({ ms, id: mintRecordId("IVTX", { now: ms }) });
  }
  const byString = [...rows].sort((x, y) => strCmp(x.id, y.id));
  for (let i = 1; i < byString.length; i += 1) {
    assert.ok(byString[i - 1].ms <= byString[i].ms, `string sort put ${byString[i - 1].ms} before ${byString[i].ms}`);
  }
});

test("item 3 PROPERTY the 48-bit timestamp survives the float-division layout, exhaustively per bit", () => {
  // uuidV7Bytes splits `now` with `(now / 2**40) & 0xff` and friends. Every bit position, every
  // boundary, plus 50k random instants -- because a 48-bit value in a float64 is where an
  // off-by-one-power-of-two hides.
  const instants = [0, 1, 0xffffffffffff];
  for (let bit = 0; bit < 48; bit += 1) { instants.push(2 ** bit, 2 ** bit - 1, 0xffffffffffff - 2 ** bit); }
  for (let n = 0; n < 50_000; n += 1) instants.push(Math.floor(Math.random() * 0x1000000000000));
  for (const ms of instants) {
    if (!Number.isInteger(ms) || ms < 0 || ms > 0xffffffffffff) continue;
    const b = uuidV7Bytes(ms, (x) => x.fill(0xff));
    const back = b[0] * 2 ** 40 + b[1] * 2 ** 32 + b[2] * 2 ** 24 + b[3] * 2 ** 16 + b[4] * 2 ** 8 + b[5];
    assert.equal(back, ms, `48-bit layout lost ${ms}`);
    assert.equal(b[6] >>> 4, 0x7, "version nibble");
    assert.equal(b[8] >>> 6, 0b10, "variant bits");
    const id = mintRecordId("WKOR", { now: ms, fill: (x) => x.fill(0xff) });
    assert.equal(unsafeDecodeMintInstant(id), ms);
    assert.ok(RECORD_ID_PATTERN_STRICT.test(id), `minted id not strict at now=${ms}: ${id}`);
  }
  for (const bad of [-1, 0x1000000000000, 1.5, NaN, Infinity]) {
    assert.throws(() => uuidV7Bytes(bad), RecordIdError, `out-of-range instant accepted: ${bad}`);
  }
});

// ════════════════════ 4. MONOTONIC BEHAVIOUR (checklist item 4) ════════════════════

test("item 4 intra-millisecond ordering is ABSENT, not best-effort: there is no counter", () => {
  // Pinned as an ABSENT guarantee. RFC 9562 §6.2 describes optional monotonic counter methods for
  // UUIDv7; this implementation uses NONE of them. Within one millisecond the 74 random bits decide
  // the order, so relative order is random and NOT mint sequence. If anything ever starts depending
  // on intra-millisecond order, this test is the place that says it was never promised.
  const now = 1_700_000_000_000;
  const seq = [];
  for (let n = 0; n < 400; n += 1) seq.push(mintRecordId("WKOR", { now }));
  assert.equal(new Set(seq).size, 400, "74 random bits must still make them distinct");
  for (const id of seq) assert.equal(unsafeDecodeMintInstant(id), now);
  // Mint order and string order genuinely disagree: with 400 samples the chance of accidental
  // agreement is 1/400! -- so an implementation that DID add a counter would fail this and should.
  const sorted = [...seq].sort();
  assert.notDeepEqual(sorted, seq, "ids minted in one millisecond came out already sorted -- a counter was added; update the standard §5.4 before relying on it");
  // An earlier-minted id can compare GREATER than a later-minted one. Demonstrated, not asserted.
  const a = mintRecordId("WKOR", { now, fill: (b) => b.fill(0xff) });
  const b = mintRecordId("WKOR", { now, fill: (x) => x.fill(0x00) });
  assert.ok(b < a, "minted second, sorts first -- intra-millisecond order is not mint order");
});

// ════════════════════ 5. CONCURRENCY (checklist item 5) ════════════════════

test("item 5 the module holds NO shared mutable state: interleaved minters cannot interfere", () => {
  // Two logical minters, interleaved, with pinned clock and pinned entropy. If any module-level
  // counter, cached buffer or seeded generator existed, interleaving would change the output.
  const now = 1_700_000_000_123;
  const solo = [
    mintRecordId("ACCT", { now, fill: (b) => b.fill(0x11) }),
    mintRecordId("ACCT", { now, fill: (b) => b.fill(0x11) }),
    mintRecordId("ACCT", { now, fill: (b) => b.fill(0x11) }),
  ];
  // Identical inputs must give identical outputs -- i.e. minting is a PURE function of its inputs.
  assert.equal(new Set(solo).size, 1, "minting is not a pure function of (code, now, fill)");
  const interleaved = [];
  for (let i = 0; i < 3; i += 1) {
    interleaved.push(mintRecordId("ACCT", { now, fill: (b) => b.fill(0x11) }));
    mintRecordId("WKOR", { now: now + 7, fill: (b) => b.fill(0x22) }); // the other minter
    encodePayload(new Uint8Array(16).fill(0x99));                      // and a codec user
  }
  assert.deepEqual(interleaved, solo, "an interleaved second minter changed the first minter's output");
  // The decoder is reentrant too: its lookup table is a frozen module-level Int8Array, read-only.
  const p = parseRecordId(solo[0]).payload;
  assert.equal(encodePayload(decodePayload(p)), p);
});

test("item 5 CROSS-PROCESS four independent processes minting in the same millisecond never collide", () => {
  // Different processes share no state at all, so the only protection is entropy. This proves the
  // generator does NOT derive from anything process-deterministic (a fixed seed, a pid, a constant
  // clock reading) -- a seeded-counter design would produce four identical id streams here.
  const mod = path.join(REPO, "functions", "lib", "identity", "recordId.js");
  const script = `
    const { mintRecordId } = require(${JSON.stringify(mod)});
    const out = [];
    for (let i = 0; i < 4000; i += 1) out.push(mintRecordId("IVTX", { now: 1700000000000 }));
    process.stdout.write(out.join("\\n"));
  `;
  const streams = [];
  for (let p = 0; p < 4; p += 1) {
    streams.push(execFileSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 60_000 }).split("\n"));
  }
  const all = streams.flat();
  assert.equal(all.length, 16_000);
  assert.equal(new Set(all).size, 16_000, "two processes minted the same id in the same millisecond");
  // And the four streams are genuinely different -- not four replays of one seeded sequence.
  for (let i = 1; i < streams.length; i += 1) {
    assert.notEqual(streams[i][0], streams[0][0], `process ${i} replayed process 0's stream -- the entropy source is seeded, not CSPRNG`);
  }
  for (const id of all) assert.ok(isRecordId(id, "IVTX"), `cross-process id is not valid: ${id}`);
});

// ════════════════════ 6-8. THE OBJECT-CODE REGISTRY (checklist items 6, 7, 8) ════════════════════

// The registry is a MARKDOWN FILE. This parser is what makes registry §1.6 ("the uniqueness of a
// code is a property of this file, and a test asserts it") and §3.10 true rather than aspirational.
function readRegistry() {
  const text = readFileSync(path.join(REPO, "docs", "architecture", "verenward-object-code-registry-proposed.md"), "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("### 3.2"));
  const end = lines.findIndex((l) => l.startsWith("### 3.10"));
  assert.ok(start > 0 && end > start, "registry §3.2..§3.10 not found -- the registry was restructured; update this parser");
  const allocated = [];
  const retired = [];
  let inRetired = false;
  for (const line of lines.slice(start, end)) {
    if (line.startsWith("### 3.9")) inRetired = true;
    const m = /^\|\s*`([A-Z]{4})`\s*\|/.exec(line);
    if (m) (inRetired ? retired : allocated).push(m[1]);
  }
  return { allocated, retired };
}

test("item 6 the registry is a FILE ONLY: no runtime table, and the code enforces shape, not registration", () => {
  const { allocated, retired } = readRegistry();
  assert.ok(allocated.length > 50, `expected the full platform registry, parsed ${allocated.length}`);
  // The module accepts ANY [A-Z]{4}, including codes that are in no registry section at all.
  for (const unregistered of ["QQQQ", "ZZZZ", "AAAA", "JUNK"]) {
    assert.ok(isObjectCodeShape(unregistered));
    assert.equal(mintRecordId(unregistered).slice(0, 4), unregistered, "minting rejected an unregistered but well-shaped code");
  }
  // And it accepts a RETIRED code, which registry §1.3 says is a permanent gravestone.
  for (const dead of retired) {
    assert.ok(isObjectCodeShape(dead));
    assert.equal(mintRecordId(dead).slice(0, 4), dead,
      `minting a retired code ${dead} succeeded -- expected today (no runtime registry) but it is the gap item 7 names`);
  }
});

test("item 7 retired-code tombstones are a PROPOSAL: the code has no mechanism to refuse one", () => {
  // Pinned as an ABSENT mechanism. registry §1.3 and §3.9 reserve SLOC and IVAC "forever"; standard
  // §11 sketches `record_id_tombstones`. Neither exists as a table or as a check. When a runtime
  // registry lands, `assertRegisteredObjectCode` is its seam and THIS test is what must flip.
  const { retired } = readRegistry();
  assert.deepEqual(retired.sort(), ["IVAC", "SLOC"], "the retired set changed; re-verify the tombstone gap");
  for (const dead of retired) {
    const id = mintRecordId(dead);
    assert.ok(isRecordId(id, dead), "a retired object code mints and validates like any other");
    assert.equal(objectCodePartition(dead), "PLATFORM");
  }
});

test("item 8 registry §2 partition rules hold over the WHOLE registry, and §3.10's claim is true", () => {
  const { allocated, retired } = readRegistry();
  const all = [...allocated, ...retired];
  // §1.6 / §3.10: all distinct.
  assert.equal(new Set(all).size, all.length, `duplicate object code in the registry: ${all.filter((c, i) => all.indexOf(c) !== i)}`);
  for (const code of all) {
    // §1.7 / §3.10: all [A-Z]{4}.
    assert.ok(isObjectCodeShape(code), `registry code ${code} is not [A-Z]{4}`);
    // §3.10: none begins with X or Z. This is the assertion that caught `XWLK` -- a PLATFORM object
    // allocated inside the X (customer) partition, which §4.2 says the registrar must reject.
    assert.notEqual(code[0], "X", `registry allocates ${code} inside the X partition, which §2 reserves for customer-defined objects and §4.2 forbids to platform objects`);
    assert.notEqual(code[0], "Z", `registry allocates ${code} inside the Z (reserved/never-production) partition`);
    assert.equal(objectCodePartition(code), "PLATFORM", `${code} does not classify as a platform code`);
  }
  // The partition function itself, exhaustively over the first letter.
  for (const first of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const expected = first === "X" ? "CUSTOMER" : first === "Z" ? "RESERVED" : "PLATFORM";
    assert.equal(objectCodePartition(`${first}AAA`), expected, `partition of ${first}AAA`);
  }
});

test("item 8 the X partition is CLASSIFIED but NOT ENFORCED -- minting does not consult it", () => {
  // Pinned as an ABSENT enforcement. objectCodePartition() reports the partition; nothing acts on
  // it. Any caller can mint in the customer or reserved namespace with no registrar involved.
  const x = mintRecordId("XRNT");
  assert.equal(objectCodePartition("XRNT"), "CUSTOMER");
  assert.ok(isRecordId(x, "XRNT"), "a customer-partition code mints with no registration check");
  const z = mintRecordId("ZTST");
  assert.equal(objectCodePartition("ZTST"), "RESERVED");
  assert.ok(isRecordId(z, "ZTST"), "a reserved-partition code mints with no registration check");
});

// ════════════════════ 9. EOS-LOOKING IMPORTED IDs (checklist item 9) ════════════════════

test("item 9 a caller-supplied string that LOOKS like a Record ID IS accepted as one", () => {
  // THE INJECTION-SHAPED RISK, pinned as a real and currently unmitigated property. Standard §6.4
  // rejects a check character and §9.1 ("nothing else ever mints one") is POLICY, not a mechanism.
  // Nothing in the format is unforgeable: no MAC, no checksum, no registry of issued ids. So
  // "never accept an id you did not mint" MUST be enforced by the writer -- by requiring the record
  // to already exist (standard §10.1 allows a supplied id only to MATCH, never to CREATE).
  const forged = [
    "ACCT_00000000000000000000000000",
    `ACCT_7${"Z".repeat(25)}`,
    "PART_00000000000000000000000001",
    "WKOR_0000000000000000DEADBEEF00",
  ];
  for (const f of forged) {
    assert.ok(isRecordId(f), `isRecordId rejected ${f}`);
    assert.notEqual(parseRecordId(f), null);
    assert.equal(assertRecordId(f, f.slice(0, 4)), f, `assertRecordId rejected ${f}`);
    assert.equal(normalizeRecordId(f), f);
  }
  // Worse: a forged id is indistinguishable from a minted one even under the forensic path, because
  // an attacker can choose the embedded instant outright.
  const chosen = 1_234_567_890_123;
  const believable = recordIdFromUuid("WKOR", recordIdToUuid(mintRecordId("WKOR", { now: chosen })));
  assert.equal(unsafeDecodeMintInstant(believable), chosen);
  assert.ok(isRecordId(believable, "WKOR"));
  // The ONE thing the format does catch for free: the wrong OBJECT. That is a type error, not
  // provenance -- it stops mis-wiring, never forgery.
  assert.throws(() => assertRecordId(mintRecordId("ACCT"), "WKOR"), RecordIdError);
});

// ════════════════════ 10. DATABASE SHAPE CONSTRAINT (checklist item 10) ════════════════════

test("item 10 EXHAUSTIVE the strict pattern accepts exactly the alphabet and nothing else, per position", () => {
  // Sweeps U+0000..U+2FFF in each of the four structural positions and asserts the accept set is
  // EXACTLY the legal set -- no over-acceptance (an invalid id stored) and no under-acceptance (a
  // valid id refused). This is the regex the standard §8.1 puts in a Postgres CHECK.
  const base = "ACCT_0123456789ABCDEFGHJKMNPQRS";
  assert.equal(base.length, RECORD_ID_LENGTH);
  assert.ok(RECORD_ID_PATTERN_STRICT.test(base));
  const positions = [
    { at: 0, legal: new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") },   // object code: ALL letters, I/L/O/U too
    { at: 4, legal: new Set("_") },                            // separator
    { at: 5, legal: new Set("01234567") },                     // payload head: the two pad bits
    { at: 12, legal: new Set(CROCKFORD) },                     // payload body
  ];
  for (const { at, legal } of positions) {
    for (let cp = 0; cp < 0x3000; cp += 1) {
      const ch = String.fromCodePoint(cp);
      if (ch.length !== 1) continue;
      const candidate = base.slice(0, at) + ch + base.slice(at + 1);
      if (candidate.length !== RECORD_ID_LENGTH) continue;
      assert.equal(
        RECORD_ID_PATTERN_STRICT.test(candidate), legal.has(ch),
        `position ${at}, U+${cp.toString(16).toUpperCase().padStart(4, "0")}: regex said ${RECORD_ID_PATTERN_STRICT.test(candidate)}, legal set says ${legal.has(ch)}`,
      );
    }
  }
});

test("item 10 the pattern is fully anchored: no leading or trailing anything slips past", () => {
  // The classic CHECK-constraint defect. In JavaScript `$` does not match before a trailing newline
  // (unlike Python), and Postgres POSIX `$` matches end-of-string without the `n` flag -- so the
  // same literal is safe in both. Pinned so a future `m` flag or a `\n` in a CHECK cannot creep in.
  const base = "ACCT_0123456789ABCDEFGHJKMNPQRS";
  for (const t of [`${base}\n`, `\n${base}`, `${base} `, ` ${base}`, `${base}\r`, `${base}\0`, `${base}\t`, `x${base}`, `${base}x`, `${base}${base}`]) {
    assert.equal(RECORD_ID_PATTERN_STRICT.test(t), false, `strict pattern accepted ${JSON.stringify(t)}`);
    assert.equal(RECORD_ID_PATTERN.test(t), false, `permissive pattern accepted ${JSON.stringify(t)}`);
    assert.equal(isRecordId(t), false);
    assert.equal(parseRecordId(t), null);
  }
});

test("item 10 the §8.1 Postgres CHECK literal is character-for-character the strict pattern", () => {
  // The standard puts a literal regex in a CHECK constraint. If the document's literal and the
  // module's literal ever drift, the database and the application disagree about what an id is.
  const doc = readFileSync(path.join(REPO, "docs", "architecture", "verenward-global-record-identity-standard.md"), "utf8");
  const check = /CHECK \(id ~ '\^([A-Z]{4})_(\[0-7\]\[0-9A-HJKMNP-TV-Z\]\{25\})\$'\)/.exec(doc);
  assert.ok(check, "§8.1's CHECK constraint literal was not found in the expected form");
  const [, code, tail] = check;
  // Rebuild the module's strict pattern with the object code pinned, and compare source text.
  const expected = RECORD_ID_PATTERN_STRICT.source.replace("[A-Z]{4}", code);
  assert.equal(`^${code}_${tail}$`, expected, "the §8.1 CHECK regex and RECORD_ID_PATTERN_STRICT have drifted apart");
  // And it behaves identically on real ids of that object.
  const rx = new RegExp(`^${code}_${tail}$`);
  const otherCode = code === "ACCT" ? "WKOR" : "ACCT";
  for (let i = 0; i < 2_000; i += 1) {
    assert.ok(rx.test(mintRecordId(code)), `§8.1 CHECK would REJECT a valid ${code} id`);
    // The whole point of a per-object CHECK: the right-shaped id of the WRONG object is refused.
    assert.ok(!rx.test(mintRecordId(otherCode)), `§8.1 CHECK accepted a ${otherCode} id in a ${code} column`);
  }
  for (const bad of [`${code}_${"Z".repeat(26)}`, `${code}_${"0".repeat(25)}`, `${code}_${"0".repeat(27)}`, `${code.toLowerCase()}_${"0".repeat(26)}`, `${code}-${"0".repeat(26)}`]) {
    assert.ok(!rx.test(bad), `§8.1 CHECK would ACCEPT an invalid id: ${bad}`);
  }
});

test("item 10 PERMISSIVE and STRICT disagree, and parseRecordId uses the PERMISSIVE one", () => {
  // A documented asymmetry with a sharp edge: `parseRecordId(x) !== null` is NOT a validity gate.
  const over = `ACCT_${"Z".repeat(26)}`;          // first char Z: 130 bits of value, no 128-bit preimage
  assert.ok(RECORD_ID_PATTERN.test(over), "permissive pattern should admit it");
  assert.ok(!RECORD_ID_PATTERN_STRICT.test(over), "strict pattern must reject it");
  assert.notEqual(parseRecordId(over), null, "parseRecordId is permissive -- documented, and a footgun");
  assert.equal(isRecordId(over), false, "isRecordId is strict");
  assert.throws(() => recordIdToUuid(over), RecordIdError, "it has no 128-bit preimage");
  assert.throws(() => assertRecordId(over, "ACCT"), RecordIdError, "assertRecordId must re-check strict");
  assert.equal(normalizeRecordId(over), null, "the ingress normaliser must emit strict only");
});

// ════════════════════ 11. CROSS-PRODUCT UNIQUENESS (checklist item 11) ════════════════════

test("item 11 different object codes cannot collide, because the separator index is fixed", () => {
  // The reasoning: the code is exactly OBJECT_CODE_LENGTH characters of [A-Z], the separator is
  // always at that index, and the total length is fixed. So the first 4 characters of an id are
  // always exactly its object code -- two ids with different codes differ within the first 4
  // characters and are therefore different strings. Certain, not probabilistic (§7 layer 2).
  const payload = "0123456789ABCDEFGHJKMNPQRS";
  const codes = [];
  for (const a of "AMXZ") for (const b of "AQZ") for (const c of "AT") for (const d of "AZ") codes.push(a + b + c + d);
  for (const c1 of codes) {
    for (const c2 of codes) {
      const i1 = `${c1}${"_"}${payload}`; const i2 = `${c2}${"_"}${payload}`;
      assert.equal(i1 === i2, c1 === c2, `${c1} vs ${c2} collided at an identical payload`);
      assert.equal(parseRecordId(i1).objectCode, c1, "the first 4 characters must always be the object code");
      assert.equal(i1.indexOf("_"), OBJECT_CODE_LENGTH, "the separator must be at a fixed index");
    }
  }
  // The separator cannot appear inside a code, so index 4 is never ambiguous.
  for (let cp = 0; cp < 0x800; cp += 1) {
    const ch = String.fromCodePoint(cp);
    if (ch === "_") continue;
    assert.equal(RECORD_ID_PATTERN_STRICT.test(`ACCT${ch}${payload}`), false, `U+${cp.toString(16)} accepted as a separator`);
  }
  // Same-code ids still collide only by payload equality, which is the 128-bit question.
  assert.notEqual(mintRecordId("ACCT"), mintRecordId("ACCT"));
});

test("item 11 CAVEAT the UUID projection DISCARDS the object code and is therefore not injective", () => {
  // Pinned because §8.1 offers a Postgres `uuid` column and §4.1 calls the bijection "lossless",
  // and both are true only PER OBJECT. recordIdToUuid is a bijection between a PAYLOAD and a UUID,
  // not between a RECORD ID and a UUID. A shared `uuid PRIMARY KEY` across objects would give away
  // exactly the structural partition §7 layer 2 calls "impossible, not improbable".
  const payload = "0123456789ABCDEFGHJKMNPQRS";
  const a = `ACCT_${payload}`; const b = `WKOR_${payload}`;
  assert.notEqual(a, b, "the record ids differ");
  assert.equal(recordIdToUuid(a), recordIdToUuid(b), "...but their uuid projections are equal");
  // Which is why the round trip needs the code supplied back explicitly.
  assert.equal(recordIdFromUuid("ACCT", recordIdToUuid(a)), a);
  assert.equal(recordIdFromUuid("WKOR", recordIdToUuid(a)), b, "the uuid alone cannot say which object it came from");
});

// ════════════════════ DEFECTS THIS LANE FOUND AND FIXED ════════════════════

test("DEFECT FIX encodePayload rejects out-of-range bytes instead of silently corrupting the payload", () => {
  // Before the fix: only `bytes.length` was checked, so a plain 16-element array (or a bad `fill`)
  // carrying 300 encoded to "9C0000..." -- first character "9", outside 0-7, an id that FAILS the
  // strict pattern the standard says every minted id satisfies. Now it throws.
  const over = new Array(16).fill(0); over[0] = 300;
  assert.throws(() => encodePayload(over), RecordIdError, "a byte above 255 must be rejected");
  const neg = new Array(16).fill(0); neg[15] = -1;
  assert.throws(() => encodePayload(neg), RecordIdError, "a negative byte must be rejected");
  const frac = new Array(16).fill(0); frac[3] = 1.5;
  assert.throws(() => encodePayload(frac), RecordIdError, "a fractional byte must be rejected");
  const nan = new Array(16).fill(0); nan[7] = NaN;
  assert.throws(() => encodePayload(nan), RecordIdError, "NaN must be rejected");
  const undef = new Array(16); // 16 holes, every element undefined
  assert.throws(() => encodePayload(undef), RecordIdError, "an unfilled array must be rejected");
  // And the legitimate cases keep working, including a plain array of in-range bytes.
  assert.equal(encodePayload(new Array(16).fill(0)), "0".repeat(26));
  assert.equal(encodePayload(new Array(16).fill(255)), `7${"Z".repeat(25)}`);
  // The postcondition holds for every output the encoder ever produces.
  const b = new Uint8Array(16);
  for (let i = 0; i < 5_000; i += 1) { randomFillSync(b); assert.ok("01234567".includes(encodePayload(b)[0])); }
});

test("DEFECT FIX normalizeRecordId rejects non-ASCII instead of repairing a homoglyph into an id", () => {
  // Before the fix: `.toUpperCase()` applies the full Unicode case mapping, so U+0131 "ı" -> "I"
  // and U+017F "ſ" -> "S". A non-ASCII input was therefore not rejected but REPAIRED, resolving one
  // caller's string onto a DIFFERENT record's canonical id -- against standard §3's "7-bit ASCII;
  // no Unicode, no normalisation forms".
  const base = "ACCT_0123456789ABCDEFGHJKMNPQRS";
  assert.equal(normalizeRecordId(base), base, "the canonical form must still normalise to itself");
  // The two specific homoglyphs that used to get through, in both structural regions.
  assert.equal(normalizeRecordId(`ı${base.slice(1)}`), null, 'U+0131 "ı" must not become "I" in the object code');
  assert.equal(normalizeRecordId(`ſ${base.slice(1)}`), null, 'U+017F "ſ" must not become "S" in the object code');
  assert.equal(normalizeRecordId(`${base.slice(0, 12)}ı${base.slice(13)}`), null, 'U+0131 must not become "1" in the payload');
  assert.equal(normalizeRecordId(`${base.slice(0, 12)}ſ${base.slice(13)}`), null, 'U+017F must not become "S" in the payload');
  // EXHAUSTIVE: no code point outside 7-bit ASCII normalises, in either region.
  for (let cp = 0x80; cp < 0x3000; cp += 1) {
    const ch = String.fromCodePoint(cp);
    if (ch.length !== 1) continue;
    assert.equal(normalizeRecordId(ch + base.slice(1)), null, `U+${cp.toString(16)} survived in the object code`);
    assert.equal(normalizeRecordId(base.slice(0, 12) + ch + base.slice(13)), null, `U+${cp.toString(16)} survived in the payload`);
  }
  // The legitimate ingress repairs are untouched: case, Crockford ambiguity, surrounding whitespace.
  assert.equal(normalizeRecordId(base.toLowerCase()), base);
  assert.equal(normalizeRecordId("LOCN_O123456789ABCDEFGHJKMNPQRS"), "LOCN_0123456789ABCDEFGHJKMNPQRS");
  assert.equal(normalizeRecordId("LOCN_0I23456789ABCDEFGHJKMNPQRS"), "LOCN_0123456789ABCDEFGHJKMNPQRS");
  assert.equal(normalizeRecordId(`  ${base}  `), base);
  // ...and LOCN still does not become 10CN.
  for (const code of ["LOCN", "MLOC", "IVTX", "OPPT", "SLOC", "RLOC"]) {
    const id = mintRecordId(code);
    assert.equal(normalizeRecordId(id), id);
    assert.equal(normalizeRecordId(id.toLowerCase()).slice(0, 4), code);
  }
});

// ════════════════════ THE OWNER'S FORBIDDEN-ENCODING RULING ════════════════════

test("ruling the identity encodes NO tenant, company, owner, year, status or location", () => {
  // Proved structurally: minting is a pure function of (objectCode, ordering, now, fill) and there
  // is NO other input channel, so no ambient context can reach the bytes. If a future change adds
  // one -- a tenant argument, a company option, a module-level "current context" -- this fails.
  assert.equal(mintRecordId.length, 1, "mintRecordId gained a positional parameter beyond objectCode");
  const now = 1_700_000_000_000;
  const fill = (b) => b.fill(0x5a);
  const reference = mintRecordId("ACCT", { now, fill });
  // Every forbidden dimension, offered as an option, must be ignored entirely.
  const forbidden = ["tenant", "tenantId", "company", "operatingCompany", "companyId", "owner", "ownerId",
    "assignee", "year", "period", "status", "lifecycleState", "location", "locationId", "warehouse",
    "site", "region", "environment", "customer", "supplier", "sourceSystem", "importBatch", "sequence"];
  for (const key of forbidden) {
    const id = mintRecordId("ACCT", { now, fill, [key]: "CONTAMINANT" });
    assert.equal(id, reference, `mintRecordId consumed a "${key}" option -- the ruling forbids it in the identity`);
  }
  // The only honoured options are exactly these three.
  assert.notEqual(mintRecordId("ACCT", { now: now + 1, fill }), reference, "now must be honoured");
  assert.notEqual(mintRecordId("ACCT", { now, fill, ordering: "SCATTERED" }), reference, "ordering must be honoured");
  assert.notEqual(mintRecordId("ACCT", { now, fill: (b) => b.fill(0x5b) }), reference, "fill must be honoured");
  // And nothing recoverable FROM an id names any of them: the payload is 128 bits of timestamp+CSPRNG.
  const payload = parseRecordId(reference).payload;
  assert.deepEqual([...decodePayload(payload)].slice(6), [...uuidV7Bytes(now, fill)].slice(6),
    "bytes 6..15 must be version/variant + entropy only");
  assert.deepEqual(Object.keys(parseRecordId(reference)).sort(), ["objectCode", "payload"],
    "parseRecordId must expose nothing but the code and the opaque payload");
});

test("ruling business number, legacy id and external id stay OUTSIDE the Record ID contract", () => {
  // A sibling lane established that the business-number defect class is deliberately NOT fixed by
  // this standard. The separation is proved by ABSENCE: the module has no surface for any of them.
  // If someone adds one -- `mintRecordId(code, { legacyId })`, a `businessNumber` export, an
  // `IMP-` prefix path -- this test is what fails.
  const surface = Object.keys(mintRecordId).length; // no static properties expected
  assert.equal(surface, 0);
  const now = 1_700_000_000_000; const fill = (b) => b.fill(0x33);
  const reference = mintRecordId("WKOR", { now, fill });
  for (const key of ["businessNumber", "woNumber", "legacyId", "externalId", "external_subject",
    "sourceValue", "idempotencyKey", "prefix", "suffix", "id"]) {
    assert.equal(mintRecordId("WKOR", { now, fill, [key]: "WO-2026-000008" }), reference,
      `mintRecordId consumed "${key}" -- a Record ID must never carry another identifier kind`);
  }
  // A legacy id never becomes a Record ID and never a prefix on one (§2.1 rule 4).
  for (const legacy of ["IMP-000123", "WO-2026-000008", "opp_1a2b", "bin_deadbeef", "tenant-abc"]) {
    assert.equal(isRecordId(legacy), false, `${legacy} must not validate as a Record ID`);
    assert.equal(normalizeRecordId(legacy), null, `${legacy} must not normalise into one`);
    assert.equal(parseRecordId(legacy), null);
    assert.throws(() => assertRecordId(legacy, "WKOR"), RecordIdError);
  }
  // An idempotency key (§9.4) is none of the four and must not validate as identity either.
  assert.equal(isRecordId("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), false);
});
