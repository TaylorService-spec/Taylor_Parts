// DQ-036 PARITY: the EOS relocation (eosOps/stockRelocationOperations.ts) must answer the request exactly as the
// Firestore command (inventoryLocation/stockRelocationCommand.ts) does -- the same validation reasons, the same
// deterministic relocation id, the same per-row idempotency keys -- so moving relocation onto EOS changes WHERE it
// runs, never WHAT it accepts or how a retry is recognised. Pure; no database, no emulator.
import test from "node:test";
import assert from "node:assert/strict";
import { validateRelocationRequest, deriveRelocationId, relocationRowKey, MAX_RELOCATION_SERIALS, RELOCATION_ENDPOINT_TYPES } from "../lib/inventoryLocation/stockRelocationCommand.js";
import { validateEosRelocationRequest, eosRelocationId, eosRelocationRowKey, EOS_MAX_RELOCATION_SERIALS, EOS_RELOCATION_ENDPOINT_TYPES } from "../lib/eosOps/stockRelocationOperations.js";

const W = (id) => ({ type: "WAREHOUSE", locationId: id });
const B = (id) => ({ type: "BIN", locationId: id });
const base = { partId: "P-1", source: W("WH-1"), destination: B("bin-1"), quantity: 2, idempotencyKey: "k-1" };
const CASES = [
  base,
  null, [], "x",
  { ...base, extra: 1 },
  { ...base, partId: " " },
  { ...base, partId: "  P-2  " },
  { ...base, source: { type: "MOBILE", locationId: "t" } },
  { ...base, source: { type: "WAREHOUSE", locationId: "bad id/" } },
  { ...base, source: { type: "WAREHOUSE", locationId: "WH-1", extra: 1 } },
  { ...base, destination: null },
  { ...base, destination: W("WH-1") },
  { ...base, idempotencyKey: "" },
  { ...base, idempotencyKey: "x".repeat(301) },
  { ...base, quantity: undefined },
  { ...base, serialNumbers: ["a"] },
  { ...base, quantity: 0 }, { ...base, quantity: 1.5 }, { ...base, quantity: -1 }, { ...base, quantity: "2" },
  { ...base, quantity: undefined, serialNumbers: [] },
  { ...base, quantity: undefined, serialNumbers: ["a", " a "] },
  { ...base, quantity: undefined, serialNumbers: ["a", ""] },
  { ...base, quantity: undefined, serialNumbers: Array.from({ length: 101 }, (_, i) => `s${i}`) },
  { ...base, quantity: undefined, serialNumbers: [" s1 ", "s2"] },
  { ...base, recordPlacement: "yes" },
  { ...base, recordPlacement: true },
  { ...base, recordPlacement: true, destination: W("WH-2") },
  { ...base, recordPlacement: true, pickedForWorkOrderId: "WO-1" },
  { ...base, pickedForWorkOrderId: "WO-1" },
  { ...base, recordPlacement: true, pickedForWorkOrderId: "  " },
];

test("the EOS validator gives the Firestore command's answer for every case", () => {
  for (const c of CASES) assert.deepEqual(validateEosRelocationRequest(c), validateRelocationRequest(c), JSON.stringify(c));
});

test("identity and replay keys are the same functions of the idempotency key", () => {
  for (const k of ["k-1", "a:b:c", "x".repeat(300)]) {
    assert.equal(eosRelocationId(k), deriveRelocationId(k));
    for (const side of ["out", "in"]) {
      assert.equal(eosRelocationRowKey(k, side), relocationRowKey(k, side));
      assert.equal(eosRelocationRowKey(k, side, "SN-1"), relocationRowKey(k, side, "SN-1"));
    }
  }
  assert.equal(EOS_MAX_RELOCATION_SERIALS, MAX_RELOCATION_SERIALS);
  assert.deepEqual([...EOS_RELOCATION_ENDPOINT_TYPES], [...RELOCATION_ENDPOINT_TYPES]);
});
