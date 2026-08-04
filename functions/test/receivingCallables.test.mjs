// Receiving Phase-2 E1: offline unit tests for the callable request/response/error CONTRACTS
// (functions/src/inventoryReceiving/receivingCallables.ts). PURE: no Firebase app, no emulator. Also
// asserts the two callables are exported from the compiled entry point. Prerequisite: npm run build.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
check("lines: empty / non-array / bad line -> invalid-argument", () => {
  expectInvalid({ ...validReq(), lines: [] });
  expectInvalid({ ...validReq(), lines: "x" });
  expectInvalid({ ...validReq(), lines: [{ lineId: "L1", partId: "p", expectedQuantity: "5", receivedQuantity: 5 }] });
  expectInvalid({ ...validReq(), lines: [{ lineId: "L1", partId: "p", expectedQuantity: 5, receivedQuantity: 5, nope: 1 }] });
  expectInvalid({ ...validReq(), lines: [{ lineId: "", partId: "p", expectedQuantity: 5, receivedQuantity: 5 }] });
});

check("validateEmptyRequest: {} / undefined / null ok; any field or non-object -> invalid-argument", () => {
  validateEmptyRequest({}); validateEmptyRequest(undefined); validateEmptyRequest(null);
  for (const bad of [{ a: 1 }, [], "x", 1]) assert.throws(() => validateEmptyRequest(bad), (e) => e instanceof HttpsError && e.code === "invalid-argument");
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

check("both callables are exported from the compiled entry point (lib/index.js)", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const compiled = fs.readFileSync(path.join(__dirname, "..", "lib", "index.js"), "utf8");
  assert.match(compiled, /receiveInventoryStockCallable/);
  assert.match(compiled, /listReceivingLocationOptionsCallable/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
