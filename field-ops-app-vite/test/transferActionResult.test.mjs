// Enterprise Inventory Phase 4 -- OFFLINE tests for the pure transfer-action error/outcome mapping.
import assert from "node:assert/strict";
import { mapTransferActionError, describeOutcome } from "../src/domain/transferActionResult.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("transferActionResult.test.mjs");

check("known HttpsError codes map to honest, bounded messages", () => {
  assert.equal(mapTransferActionError({ code: "functions/permission-denied" }), "You are not authorized to perform this transfer action.");
  assert.equal(mapTransferActionError({ code: "not-found" }), "That transfer order could not be found.");
  assert.equal(mapTransferActionError({ code: "failed-precondition" }).includes("not currently permitted"), true);
});

check("unknown/malformed error -> generic bounded message, never raw error text", () => {
  assert.equal(mapTransferActionError({ code: "weird-unknown-code" }), "The transfer action could not be completed.");
  assert.equal(mapTransferActionError(new Error("some raw internal detail")), "The transfer action could not be completed.");
  assert.equal(mapTransferActionError(null), "The transfer action could not be completed.");
});

check("the governed details.code the server sends selects a specific message; unknown detail falls back to the HTTP code", () => {
  assert.match(mapTransferActionError({ code: "functions/failed-precondition", details: { code: "INSUFFICIENT_STOCK" } }), /not enough stock/);
  assert.match(mapTransferActionError({ code: "failed-precondition", details: { code: "SAME_CUSTODY_PARENT" } }), /relocation/);
  assert.match(mapTransferActionError({ code: "failed-precondition", details: { code: "STATUS_INVALID" } }), /not in a state/);
  assert.equal(mapTransferActionError({ code: "failed-precondition", details: { code: "SOMETHING_NEW" } }).includes("not currently permitted"), true);
  assert.equal(mapTransferActionError({ code: "failed-precondition", details: "INSUFFICIENT_STOCK" }).includes("not currently permitted"), true);
  assert.equal(mapTransferActionError({ code: "internal", details: { code: "__proto__" } }), "The transfer action could not be completed.");
});

check("describeOutcome distinguishes applied vs replayed per action", () => {
  assert.equal(describeOutcome("create", "applied"), "Transfer created.");
  assert.equal(describeOutcome("create", "replayed"), "Already created (no change made).");
  assert.equal(describeOutcome("dispatch", "applied"), "Transfer dispatched.");
  assert.equal(describeOutcome("receive", "replayed"), "Already received (no change made).");
  assert.equal(describeOutcome("cancel", "applied"), "Transfer cancelled.");
});

console.log(`${passed} passed`);
