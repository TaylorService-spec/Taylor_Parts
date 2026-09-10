// ONE ON-HAND AUTHORITY -- static and pure guards for BIN-P6 (no emulator).
// Run: node --test test/locationOnHandAuthority.test.mjs   (after `npm run build`)
//
// The sign rule used to be written out five times, and three copies missed WORK_ORDER_CONSUMPTION after
// Decision #171 made it live. These guards make a sixth copy a CI failure rather than a future defect.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  MOVEMENT_SIGN,
  signedQuantity,
  sumExactLocationOnHand,
  sumWarehouseAggregateOnHand,
  resolveCustodyWarehouseId,
  binIdsReferenced,
} from "../lib/inventoryLedger/locationOnHand.js";
import { OPERATIONAL_MOVEMENT_TYPES, COUNTERPARTY_MOVEMENT_TYPES, MOVEMENT_SOURCE_TYPE } from "../lib/inventoryLedger/operationalMovementTypes.js";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
/** Source with comments removed: a comment explaining the old branches is not a copy of them. */
const code = (p) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the sign map covers every movement type -- a new type cannot silently contribute zero", () => {
  assert.deepEqual(Object.keys(MOVEMENT_SIGN).sort(), [...OPERATIONAL_MOVEMENT_TYPES].sort());
});

test("NO reader outside locationOnHand re-implements the movement sign rule", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    if (rel === "inventoryLedger/locationOnHand.ts") continue;
    const src = code(file);
    // Any comparison of a movement's type against a sign-bearing movement type is the start of a
    // hand-written sign rule. The five copies this replaced each had one, in different shapes
    // (`if (...) onHand += q`, `{ sawEligible = true; onHand += q; }`, `balanceByPart.set(...)`), so
    // the guard matches the comparison itself rather than any one shape of what follows it.
    // RECEIVED is left out because it is also a receiving-order status name.
    if (/\b\w+\.type\s*===\s*"(TRANSFER_IN|TRANSFER_OUT|RELOCATION_IN|RELOCATION_OUT|SCRAPPED|RETURNED|WORK_ORDER_CONSUMPTION)"/.test(src)) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `re-implemented sign rule in: ${offenders.join(", ")}`);
});

test("every on-hand reader imports the shared authority", () => {
  for (const rel of [
    "fulfillment/fulfillmentAvailability.ts",
    "inventoryTransfer/transferOrderCommand.ts",
    "cycleCount/cycleCountExpectedQuantity.ts",
    "inventoryLedger/mobileLocationPresenceProbe.ts",
    "inventoryLocation/stockRelocationCommand.ts",
  ]) {
    assert.match(readFileSync(join(SRC, rel), "utf8"), /from "\.{1,2}\/(inventoryLedger\/)?locationOnHand\.js"/, rel);
  }
});

test("the relocation pair is its own vocabulary, never the Transfer pair", () => {
  assert.equal(MOVEMENT_SOURCE_TYPE.RELOCATION_OUT, "STOCK_RELOCATION");
  assert.equal(MOVEMENT_SOURCE_TYPE.RELOCATION_IN, "STOCK_RELOCATION");
  assert.equal(MOVEMENT_SOURCE_TYPE.TRANSFER_OUT, "TRANSFER_ORDER");
  assert.ok(COUNTERPARTY_MOVEMENT_TYPES.has("RELOCATION_OUT") && COUNTERPARTY_MOVEMENT_TYPES.has("RELOCATION_IN"));
});

test("exact location never aggregates, and never borrows from a sibling", () => {
  const rows = [
    { type: "RECEIVED", quantity: 10, trackingMode: "NONE", location: { type: "WAREHOUSE", locationId: "WH" } },
    { type: "RELOCATION_OUT", quantity: 4, trackingMode: "NONE", location: { type: "WAREHOUSE", locationId: "WH" } },
    { type: "RELOCATION_IN", quantity: 4, trackingMode: "NONE", location: { type: "BIN", locationId: "binA" } },
  ];
  assert.equal(sumExactLocationOnHand(rows, { type: "WAREHOUSE", locationId: "WH" }), 6);
  assert.equal(sumExactLocationOnHand(rows, { type: "BIN", locationId: "binA" }), 4);
  assert.equal(sumExactLocationOnHand(rows, { type: "BIN", locationId: "binB" }), 0);
  // A location id that matches but a type that does not is a different place.
  assert.equal(sumExactLocationOnHand(rows, { type: "BIN", locationId: "WH" }), 0);
});

test("aggregate counts each row exactly once, and excludes an unresolved bin rather than guessing", () => {
  const rows = [
    { type: "RECEIVED", quantity: 10, trackingMode: "NONE", location: { type: "WAREHOUSE", locationId: "WH" } },
    { type: "RELOCATION_OUT", quantity: 4, trackingMode: "NONE", location: { type: "WAREHOUSE", locationId: "WH" } },
    { type: "RELOCATION_IN", quantity: 4, trackingMode: "NONE", location: { type: "BIN", locationId: "binA" } },
  ];
  assert.equal(sumWarehouseAggregateOnHand(rows, new Set(["WH"]), new Map([["binA", "WH"]])), 10);
  assert.equal(sumWarehouseAggregateOnHand(rows, new Set(["WH"]), new Map()), 6, "unresolved bin excluded");
  assert.equal(sumWarehouseAggregateOnHand(rows, new Set(["OTHER"]), new Map([["binA", "WH"]])), 0);
});

test("custody parent: WAREHOUSE is itself, BIN is its governed parent, a truck has none", () => {
  const p = new Map([["binA", "WH"]]);
  assert.equal(resolveCustodyWarehouseId({ type: "WAREHOUSE", locationId: "WH" }, p), "WH");
  assert.equal(resolveCustodyWarehouseId({ type: "BIN", locationId: "binA" }, p), "WH");
  assert.equal(resolveCustodyWarehouseId({ type: "BIN", locationId: "binZ" }, p), null);
  assert.equal(resolveCustodyWarehouseId({ type: "MOBILE", locationId: "truck" }, p), null);
});

test("only the bins actually referenced are resolved", () => {
  assert.deepEqual(binIdsReferenced([
    { location: { type: "BIN", locationId: "b2" } },
    { location: { type: "WAREHOUSE", locationId: "WH" } },
    { location: { type: "BIN", locationId: "b1" } },
    { location: { type: "BIN", locationId: "b2" } },
  ]), ["b1", "b2"]);
});

test("signedQuantity: consumption counts, a commitment does not, a corrupt magnitude contributes nothing", () => {
  assert.equal(signedQuantity({ type: "WORK_ORDER_CONSUMPTION", quantity: -3 }), -3);
  assert.equal(signedQuantity({ type: "RESERVED", quantity: 3 }), 0);
  assert.equal(signedQuantity({ type: "TRANSFER_OUT", quantity: -3 }), 0);
});
