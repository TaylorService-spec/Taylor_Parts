// PART BALANCE -- whether a part is serial-tracked is the SERVER'S fact, not the caller's claim.
// Run: node --test test/partBalanceTrackingModeAuthority.test.mjs
//
// ============================ THE DEFECT THIS PINS ============================
//
// getPartBalanceCallable read `serialTracked` straight off the request. The caller therefore chose
// the SHAPE of the answer, and both directions were wrong in a way an operator would act on.
//
// Found in sandbox validation on 2026-08-21, against real deployed callables and real data:
//
//   PRT-2001 has two serialized units on the shelf at wh-main.
//   Asked with serialTracked:false, the server answered { state: "KNOWN", value: 0 }.
//
// A CONFIDENT ZERO FOR A SHELF THAT IS NOT EMPTY -- precisely the "missing evidence treated as zero"
// failure this service's own header says it exists to prevent. The mirror image was equally
// reachable: a quantity-tracked part asked with serialTracked:true answered
// NOT_COUNTED_BY_QUANTITY, hiding a real number behind a category error.
//
// Neither is a rounding problem. One tells a warehouse there is nothing to pick when there is; the
// other tells them the question does not apply when it does.
//
// The fix: the Part Master's `controlType` decides, mapped through the one shared vocabulary that
// receiving and transfer already use.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { controlTypeToTrackingMode, isSerialTracked } from "../lib/partMaster/controlTypeTrackingMode.js";
import { composePartBalance } from "../lib/inventory/partBalanceReadService.js";

const source = () => readFileSync(new URL("../src/inventory/partBalanceReadService.ts", import.meta.url), "utf8");
const codeOnly = () => source().replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ═══════════════════════════════════════════ the authority

test("THE CALLABLE NEVER READS serialTracked FROM THE REQUEST", () => {
  // The whole defect in one assertion. If this string comes back, the caller is deciding again.
  const code = codeOnly();
  assert.doesNotMatch(code, /data\.serialTracked/, "serialTracked must never be taken from request data");
  assert.doesNotMatch(code, /request\.data[\s\S]{0,80}serialTracked/, "no indirect read of a caller-supplied flag");
});

test("it derives the answer from the Part's controlType instead", () => {
  const code = codeOnly();
  assert.match(code, /isSerialTracked\(\s*stored\.part\.controlType\s*\)/, "controlType is the authority");
  assert.match(code, /buildFirestorePartRepository/, "the Part is resolved server-side");
});

test("an unknown part FAILS CLOSED rather than being assumed quantity-tracked", () => {
  // Assuming NONE for an unresolvable part would reintroduce the confident zero by another route.
  const code = codeOnly();
  assert.match(code, /stored === null[\s\S]{0,140}not-found/, "an unresolvable part must be refused, not guessed");
});

// ═══════════════════════════════════════════ the shared vocabulary

test("ONE mapping, shared -- receiving and transfer no longer carry private copies", () => {
  // Two copies of the rule that decides quantity-vs-serial is two chances to disagree, and the
  // disagreement is quiet: one surface reports a quantity another says cannot exist.
  for (const file of [
    "../src/inventoryReceiving/receivingCallableWiring.ts",
    "../src/inventoryTransfer/transferCallableWiring.ts",
  ]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /function controlTypeToTrackingMode/, `${file} must import the shared mapping, not redefine it`);
    assert.match(src, /controlTypeTrackingMode\.js/, `${file} must import the shared mapping`);
  }
});

test("the mapping is exhaustive and fails closed on the unknown", () => {
  assert.equal(controlTypeToTrackingMode("STANDARD"), "NONE");
  assert.equal(controlTypeToTrackingMode("SERIALIZED"), "SERIAL");
  assert.equal(controlTypeToTrackingMode("LOT"), "LOT");
  // An unrecognized controlType must NOT become NONE and be treated as ordinary countable stock.
  for (const unknown of ["", "BATCH", "serialized", "WEIGHTED", "undefined"]) {
    assert.equal(controlTypeToTrackingMode(unknown), "LOT", `${unknown} must fail closed`);
  }
  assert.equal(isSerialTracked("SERIALIZED"), true);
  assert.equal(isSerialTracked("STANDARD"), false);
  assert.equal(isSerialTracked("LOT"), false, "LOT is not counted individually by the serialized registry");
});

// ═══════════════════════════════════════════ the two wrong answers, pinned

test("THE SANDBOX FINDING: a serialized part must never report a confident zero", () => {
  // PRT-2001's actual situation: units exist, but they are in the serialized registry, so the ledger
  // carries no quantity rows for them. Composed as SERIAL this is honest; composed as quantity it is
  // a lie a picker would act on.
  const asSerial = composePartBalance({
    partId: "PRT-2001", ledgerRows: [], eligibleWarehouseIds: new Set(["wh-main"]),
    openOrderedQuantity: null, serialTracked: true,
  });
  assert.equal(asSerial.onHand.state, "NOT_COUNTED_BY_QUANTITY");
  assert.equal(asSerial.onHand.value, null);

  const asQuantity = composePartBalance({
    partId: "PRT-2001", ledgerRows: [], eligibleWarehouseIds: new Set(["wh-main"]),
    openOrderedQuantity: null, serialTracked: false,
  });
  // This is the shape the caller could previously force. It is not wrong of composePartBalance --
  // it is wrong of anyone who lets a caller choose which of these two to ask for.
  assert.equal(asQuantity.onHand.state, "UNKNOWN", "with no rows at all the honest answer is UNKNOWN");
});

test("and a quantity part must never be hidden behind NOT_COUNTED_BY_QUANTITY", () => {
  const rows = [{ type: "RECEIVED", quantity: 7, location: { type: "WAREHOUSE", locationId: "wh-main" }, trackingMode: "NONE" }];
  const honest = composePartBalance({
    partId: "PRT-1001", ledgerRows: rows, eligibleWarehouseIds: new Set(["wh-main"]),
    openOrderedQuantity: null, serialTracked: false,
  });
  assert.equal(honest.onHand.state, "KNOWN");
  assert.equal(honest.onHand.value, 7);

  const hidden = composePartBalance({
    partId: "PRT-1001", ledgerRows: rows, eligibleWarehouseIds: new Set(["wh-main"]),
    openOrderedQuantity: null, serialTracked: true,
  });
  assert.equal(hidden.onHand.state, "NOT_COUNTED_BY_QUANTITY", "seven units hidden — the mirror-image defect");
  assert.notEqual(honest.onHand.state, hidden.onHand.state,
    "the two shapes genuinely differ, which is why the flag must not be caller-controlled");
});
