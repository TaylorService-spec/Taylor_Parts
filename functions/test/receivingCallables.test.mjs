// Receiving Phase-2 E1: offline unit tests for the callable request/response/error CONTRACTS
// (functions/src/inventoryReceiving/receivingCallables.ts). PURE: no Firebase app, no emulator. Also
// asserts the two callables are exported from the compiled entry point. Prerequisite: npm run build.
import assert from "node:assert/strict";
import {
  validateReceiveRequest,
  validateEmptyRequest,
  requireAuth,
  mapReceiveError,
  mapOptionsError,
} from "../lib/inventoryReceiving/receivingCallables.js";
import { HttpsError } from "firebase-functions/v2/https";
import {
  UnauthorizedReceivingError, SourceNotFoundError, SourceNotReceivableError,
  DestinationInvalidError, PartInvalidError, ReceivingIntegrityError,
} from "../lib/inventoryReceiving/receiveInventoryStockCommand.js";
import { IdempotencyConflictError, MalformedStoredRecordError, InvalidReceivingError } from "../lib/inventoryReceiving/receivingTypes.js";
import { ReceivingLocationOptionsError } from "../lib/warehouseGovernance/receivingLocationOptionsService.js";

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ok - ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL - ${name}: ${err && err.message}`); }
}
const RAW = /firestore|INVALID_ARGUMENT|a\/b|Transaction is invalid|\.accessVersion|roleAssignments/i;
function validReq() {
  return {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "rr", purchaseOrderId: "rr" },
    receivingLocation: { type: "WAREHOUSE", locationId: "wh" },
    lines: [{ lineId: "L1", partId: "p", expectedQuantity: 5, receivedQuantity: 5 }],
    idempotencyKey: "idem",
  };
}
function expectInvalid(data, label) {
  assert.throws(() => validateReceiveRequest(data), (e) => e instanceof HttpsError && e.code === "invalid-argument", label);
}

check("valid receive payload passes and returns the same object", () => { const r = validReq(); assert.equal(validateReceiveRequest(r), r); });

// ---- SERIAL receipts (Wave 7) ------------------------------------------------------------------
// Regression: this validator runs BEFORE the command, so omitting serialNumbers from LINE_KEYS
// rejected every well-formed SERIAL payload as an unknown field and broke SERIAL receiving end to
// end, even though the command's own validator accepted it.
check("a SERIAL line carrying serialNumbers is accepted structurally", () => {
  const r = validReq();
  r.lines[0].serialNumbers = ["SN-1", "SN-2", "SN-3", "SN-4", "SN-5"];
  assert.equal(validateReceiveRequest(r), r);
});

check("serialNumbers shape is enforced, but count/duplication are left to the command", () => {
  const bad = (v) => { const r = validReq(); r.lines[0].serialNumbers = v; return r; };
  expectInvalid(bad("SN-1"), "not an array");
  expectInvalid(bad([""]), "blank serial");
  expectInvalid(bad(["SN-1", 5]), "non-string serial");
  expectInvalid(bad([{ serial: "SN-1" }]), "object serial");
  // Count mismatch and duplicates are NOT rejected here: only the command knows the authoritative
  // Part tracking mode and PO ordered quantity. Enforcing them here would fork the rule.
  const mismatched = bad(["SN-1"]);              // 1 serial for a qty-5 line
  assert.equal(validateReceiveRequest(mismatched), mismatched);
  const duplicated = bad(["SN-1", "SN-1"]);
  assert.equal(validateReceiveRequest(duplicated), duplicated);
});

check("lotId and other serial-adjacent keys are still rejected", () => {
  const r = validReq();
  r.lines[0].lotId = "LOT-1";
  expectInvalid(r, "lotId");
});

check("unknown / server-owned / actor top-level fields -> invalid-argument", () => {
  expectInvalid({ ...validReq(), actor: { kind: "USER", id: "evil" } }, "actor");
  expectInvalid({ ...validReq(), version: 1 }, "version");
  expectInvalid({ ...validReq(), status: "x" }, "status");
  expectInvalid({ ...validReq(), extra: true }, "extra");
});
check("non-object / missing top-level -> invalid-argument", () => {
  for (const bad of [null, undefined, [], "x", 1, true]) expectInvalid(bad, String(bad));
  const noSource = validReq(); delete noSource.source; expectInvalid(noSource, "no source");
  const noKey = validReq(); delete noKey.idempotencyKey; expectInvalid(noKey, "no idempotencyKey");
});
check("source: wrong type / blank ids / unknown field -> invalid-argument", () => {
  expectInvalid({ ...validReq(), source: { type: "X", reorderRequestId: "rr", purchaseOrderId: "rr" } });
  expectInvalid({ ...validReq(), source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "", purchaseOrderId: "rr" } });
  expectInvalid({ ...validReq(), source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "rr", purchaseOrderId: "rr", nope: 1 } });
});
check("receivingLocation: wrong type / blank id / unknown field -> invalid-argument", () => {
  expectInvalid({ ...validReq(), receivingLocation: { type: "BIN", locationId: "wh" } });
  expectInvalid({ ...validReq(), receivingLocation: { type: "WAREHOUSE", locationId: "  " } });
  expectInvalid({ ...validReq(), receivingLocation: { type: "WAREHOUSE", locationId: "wh", nope: 1 } });
});
check("lines: empty / multiple / non-array / bad line -> invalid-argument (exactly one line)", () => {
  const good = { lineId: "L1", partId: "p", expectedQuantity: 5, receivedQuantity: 5 };
  expectInvalid({ ...validReq(), lines: [] });
  expectInvalid({ ...validReq(), lines: [good, { ...good, lineId: "L2" }] }); // multiple -> invalid-argument
  expectInvalid({ ...validReq(), lines: "x" });
  expectInvalid({ ...validReq(), lines: [{ lineId: "L1", partId: "p", expectedQuantity: "5", receivedQuantity: 5 }] });
  expectInvalid({ ...validReq(), lines: [{ lineId: "L1", partId: "p", expectedQuantity: 5, receivedQuantity: 5, nope: 1 }] });
  expectInvalid({ ...validReq(), lines: [{ lineId: "", partId: "p", expectedQuantity: 5, receivedQuantity: 5 }] });
});

check("validateEmptyRequest: only {} ok; null/undefined/array/primitive/keyed -> invalid-argument", () => {
  validateEmptyRequest({});
  for (const bad of [undefined, null, { a: 1 }, [], "x", 1, true]) {
    assert.throws(() => validateEmptyRequest(bad), (e) => e instanceof HttpsError && e.code === "invalid-argument");
  }
});

check("requireAuth: derives uid from request.auth only; missing/invalid -> unauthenticated", () => {
  assert.equal(requireAuth({ auth: { uid: "u1" } }), "u1");
  for (const bad of [{}, { auth: null }, { auth: {} }, { auth: { uid: "" } }, { auth: { uid: 123 } }]) {
    assert.throws(() => requireAuth(bad), (e) => e instanceof HttpsError && e.code === "unauthenticated");
  }
});

check("mapReceiveError: exact governed -> public code matrix, no raw leak", () => {
  const cases = [
    [new UnauthorizedReceivingError(), "permission-denied"],
    [new SourceNotFoundError("po missing"), "not-found"],
    [new SourceNotReceivableError("not ORDERED"), "failed-precondition"],
    [new DestinationInvalidError("inactive"), "failed-precondition"],
    [new PartInvalidError("inactive part"), "failed-precondition"],
    [new ReceivingIntegrityError("ledger disagreed"), "internal"],
    [new IdempotencyConflictError("conflict"), "failed-precondition"],
    [new MalformedStoredRecordError("bad stored"), "failed-precondition"],
    [new InvalidReceivingError("bad input"), "invalid-argument"],
    [new Error("3 INVALID_ARGUMENT firestore path warehouses/a/b"), "internal"],
  ];
  for (const [err, code] of cases) {
    const mapped = mapReceiveError(err);
    assert.ok(mapped instanceof HttpsError && mapped.code === code, `${err.name} -> ${mapped.code} (want ${code})`);
    assert.ok(!RAW.test(mapped.message), `no raw leak in "${mapped.message}"`);
    assert.ok(mapped.message.length <= 200, "bounded message");
  }
  // HttpsError passes through unchanged
  const passthrough = new HttpsError("invalid-argument", "bad payload");
  assert.equal(mapReceiveError(passthrough), passthrough);
});

check("mapOptionsError: option-service codes -> public matrix, no raw leak", () => {
  const cases = [
    [new ReceivingLocationOptionsError("INVALID_REQUEST", "x"), "invalid-argument"],
    [new ReceivingLocationOptionsError("PERMISSION_DENIED", "x"), "permission-denied"],
    [new ReceivingLocationOptionsError("SOURCE_UNAVAILABLE", "firestore boom a/b"), "internal"],
    [new Error("raw"), "internal"],
  ];
  for (const [err, code] of cases) {
    const mapped = mapOptionsError(err);
    assert.ok(mapped instanceof HttpsError && mapped.code === code);
    assert.ok(!RAW.test(mapped.message));
  }
});

// (Compiled-entry export-name assertions live in receivingCallablesExport.test.mjs, which imports lib/index.js.)

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
