// D5 — pure-logic tests for the untrusted navigation cursor (posture B). No emulator.
// Proves the cursor is a validated position hint, NOT an integrity boundary: shape + (dir,key) request
// consistency are enforced fail-closed, while a structurally valid afterId for the correct (dir,key) is
// accepted (repositioning). No signature/tamper claim is made or tested.
import assert from "node:assert/strict";

const CUR = await import("../lib/equipmentCompatibility/readCursor.js");
const E = await import("../lib/equipmentCompatibility/errors.js");

let passed = 0;
const ok = (n, f) => { f(); passed += 1; console.log(`PASS -- ${n}`); };

const CANON = "cmp_" + "a".repeat(64);
const CANON2 = "cmp_" + "b".repeat(64);

ok("round-trips a valid payload and decodes with matching (dir,key)", () => {
  const enc = CUR.encodeCursor({ dir: "forward", key: "TST-1001", afterId: CANON });
  assert.equal(CUR.decodeCursor(enc, { dir: "forward", key: "TST-1001" }).afterId, CANON);
});

ok("a valid afterId for the correct (dir,key) is ACCEPTED as a reposition (no tamper refusal)", () => {
  const enc = CUR.encodeCursor({ dir: "reverse", key: "TAYLOR--C713", afterId: CANON });
  // A caller who swaps to another canonical id for the SAME (dir,key) is accepted (repositioning).
  const swapped = CUR.encodeCursor({ dir: "reverse", key: "TAYLOR--C713", afterId: CANON2 });
  assert.equal(CUR.decodeCursor(swapped, { dir: "reverse", key: "TAYLOR--C713" }).afterId, CANON2);
});

ok("direction mismatch is refused (fail closed)", () => {
  const fwd = CUR.encodeCursor({ dir: "forward", key: "TST-1001", afterId: CANON });
  assert.throws(() => CUR.decodeCursor(fwd, { dir: "reverse", key: "TST-1001" }), E.InvalidInputError);
});

ok("query-key mismatch is refused (fail closed)", () => {
  const enc = CUR.encodeCursor({ dir: "forward", key: "TST-1001", afterId: CANON });
  assert.throws(() => CUR.decodeCursor(enc, { dir: "forward", key: "OTHER-9" }), E.InvalidInputError);
});

ok("non-canonical afterId is refused", () => {
  const enc = Buffer.from(JSON.stringify({ v: 1, dir: "forward", key: "TST-1001", afterId: "not-canonical" }), "utf8").toString("base64url");
  assert.throws(() => CUR.decodeCursor(enc, { dir: "forward", key: "TST-1001" }), E.InvalidInputError);
});

ok("unknown/extra field, missing field, or wrong version is refused", () => {
  const extra = Buffer.from(JSON.stringify({ v: 1, dir: "forward", key: "TST-1001", afterId: CANON, x: 1 }), "utf8").toString("base64url");
  assert.throws(() => CUR.decodeCursor(extra, { dir: "forward", key: "TST-1001" }), E.InvalidInputError);
  const missing = Buffer.from(JSON.stringify({ v: 1, dir: "forward", key: "TST-1001" }), "utf8").toString("base64url");
  assert.throws(() => CUR.decodeCursor(missing, { dir: "forward", key: "TST-1001" }), E.InvalidInputError);
  const badV = Buffer.from(JSON.stringify({ v: 2, dir: "forward", key: "TST-1001", afterId: CANON }), "utf8").toString("base64url");
  assert.throws(() => CUR.decodeCursor(badV, { dir: "forward", key: "TST-1001" }), E.InvalidInputError);
});

ok("garbage / non-base64 / non-JSON input is refused, never treated as 'from the start'", () => {
  for (const bad of ["", "not a cursor!!", "{}", Buffer.from("[]", "utf8").toString("base64url")]) {
    assert.throws(() => CUR.decodeCursor(bad, { dir: "forward", key: "TST-1001" }), E.InvalidInputError);
  }
});

console.log(`\n${passed} cursor posture-B checks passed`);
