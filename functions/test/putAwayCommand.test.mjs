// PUT-AWAY — the placement contract. Pure request validation + structural invariants; no emulator.
// Run: node --test test/putAwayCommand.test.mjs
//
// The single most important thing this file proves is a NEGATIVE: put-away writes no ledger event,
// changes no quantity and touches no balance. That is the invariant DECISIONS #116 exists to
// protect, and a comment promising it is not enough.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  validatePutAwayRequest, derivePlacementId, PLACEMENT_RECORD_CAPABILITY, BIN_PLACEMENTS_COLLECTION,
  MAX_PLACEMENT_NOTE,
} from "../lib/inventoryLocation/putAwayCommand.js";

const req = (over = {}) => ({
  warehouseId: "WH-1", binCode: "A-14", partId: "PRT-1001", quantity: 3, idempotencyKey: "k1", ...over,
});

const source = () => readFileSync(new URL("../src/inventoryLocation/putAwayCommand.ts", import.meta.url), "utf8");
const codeOnly = () => source().replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ═══════════════════════════════════════════ THE INVARIANT

test("put-away writes NO ledger event — asserted on the code, not on a promise", () => {
  // If put-away moved stock to a BIN, the moment a receipt was stowed it would vanish from sellable
  // on-hand, transfer sufficiency and cycle-count expected quantity. This is that guard.
  const code = codeOnly();
  for (const forbidden of [
    /inventory_transactions/, /INVENTORY_TRANSACTIONS/, /stageOperationalMovement/,
    /operationalMovement/i, /"TRANSFER_OUT"|"TRANSFER_IN"|"RECEIVED"|"ADJUSTED"|"SCRAPPED"|"RETURNED"/,
  ]) {
    assert.doesNotMatch(code, forbidden, `put-away must never reference ${forbidden}`);
  }
});

test("put-away touches NO balance authority", () => {
  const code = codeOnly();
  for (const forbidden of [/sumLedgerEligibleOnHand/, /openWorkOrderReserved/, /onHand/i, /available/i, /reserved/i]) {
    assert.doesNotMatch(code, forbidden, `put-away must never reference ${forbidden}`);
  }
});

test("put-away emits NO location reference a movement command would accept", () => {
  const code = codeOnly();
  assert.doesNotMatch(code, /type:\s*["']BIN["']/, "a bin must never become a movement location");
  assert.doesNotMatch(code, /type:\s*["']WAREHOUSE["']/, "put-away authors no location ref at all");
});

test("it writes to the PLACEMENT collection and nothing else", () => {
  const code = codeOnly();
  assert.equal(BIN_PLACEMENTS_COLLECTION, "bin_placements");
  // The only collections it may reach: placements (write), bins and serialized assets (read).
  const collections = [...code.matchAll(/collection\((?:deps\.db|db)?\.?([A-Z_]+|[A-Za-z_]+)\)/g)].map((m) => m[1]);
  for (const c of collections) {
    assert.ok(
      ["BIN_PLACEMENTS_COLLECTION", "BINS_COLLECTION", "SERIALIZED_ASSETS_COLLECTION"].includes(c),
      `put-away reached an unexpected collection: ${c}`,
    );
  }
});

test("NO QUARANTINE — DECISIONS #117 keeps condition and inspection out of put-away", () => {
  const code = codeOnly();
  for (const forbidden of [/quarantine/i, /inspect/i, /condition/i, /disposition/i, /hold/i]) {
    assert.doesNotMatch(code, forbidden, `put-away must not invent ${forbidden}`);
  }
});

test("the capability is its OWN, not receiving's and not bin administration's", () => {
  // Stowing all day must not confer the authority to accept stock or to retire racking.
  assert.equal(PLACEMENT_RECORD_CAPABILITY, "inventory.placement.record");
  assert.notEqual(PLACEMENT_RECORD_CAPABILITY, "inventory.stock.receive");
  assert.notEqual(PLACEMENT_RECORD_CAPABILITY, "inventory.location.bin.manage");
});

// ═══════════════════════════════════════════ request shape

test("a quantity put-away is accepted and normalized", () => {
  const r = validatePutAwayRequest(req({ binCode: " a-14 " }));
  assert.equal(r.valid, true);
  assert.equal(r.value.binCode, "A-14");
  assert.equal(r.value.quantity, 3);
  assert.equal(r.value.serialNumbers, undefined);
});

test("a serialized put-away is accepted, trimmed, and keeps its serials", () => {
  const r = validatePutAwayRequest(req({ quantity: undefined, serialNumbers: [" SN-1 ", "SN-2"] }));
  assert.equal(r.valid, true);
  assert.deepEqual(r.value.serialNumbers, ["SN-1", "SN-2"]);
  assert.equal(r.value.quantity, undefined);
});

test("BOTH quantity and serials is refused — guessing is how a serial becomes bulk", () => {
  assert.equal(validatePutAwayRequest(req({ serialNumbers: ["SN-1"] })).valid, false);
});

test("NEITHER quantity nor serials is refused", () => {
  assert.equal(validatePutAwayRequest(req({ quantity: undefined })).valid, false);
});

test("a non-positive or fractional quantity is refused, never rounded", () => {
  for (const quantity of [0, -1, 2.5, "3", null, NaN, Infinity]) {
    assert.equal(validatePutAwayRequest(req({ quantity })).valid, false, `${String(quantity)} must be refused`);
  }
});

test("an empty serial list is refused — stowing nothing is not a put-away", () => {
  assert.equal(validatePutAwayRequest(req({ quantity: undefined, serialNumbers: [] })).valid, false);
});

test("a DUPLICATED serial is refused rather than de-duplicated", () => {
  // Silently de-duplicating would record a different stow from the one that happened.
  const r = validatePutAwayRequest(req({ quantity: undefined, serialNumbers: ["SN-1", "sn-1"] }));
  assert.equal(r.valid, false);
  assert.equal(r.reason, "serials_duplicated");
});

test("a blank serial in the list is refused", () => {
  assert.equal(validatePutAwayRequest(req({ quantity: undefined, serialNumbers: ["SN-1", "  "] })).valid, false);
});

test("warehouse, part, bin and idempotency key are all required", () => {
  for (const field of ["warehouseId", "partId", "idempotencyKey", "binCode"]) {
    assert.equal(validatePutAwayRequest(req({ [field]: "" })).valid, false, `${field} must be required`);
    assert.equal(validatePutAwayRequest(req({ [field]: undefined })).valid, false);
  }
});

test("a malformed bin code is refused before anything is read", () => {
  assert.equal(validatePutAwayRequest(req({ binCode: "A/14" })).valid, false);
});

test("a non-object request is refused", () => {
  for (const bad of [null, undefined, [], "stow", 4]) {
    assert.equal(validatePutAwayRequest(bad).valid, false);
  }
});

// ═══════════════════════════════════════════ idempotency

test("the placement id is derived, so a retry writes the SAME document", () => {
  assert.equal(derivePlacementId("k1", "SN-1"), derivePlacementId("k1", "SN-1"));
});

test("each SERIAL gets its own placement — a unit has its own place", () => {
  // "Where is SN-42" must have one answer, not "somewhere among the twelve we stowed that day".
  assert.notEqual(derivePlacementId("k1", "SN-1"), derivePlacementId("k1", "SN-2"));
});

test("a different stow is a different placement", () => {
  assert.notEqual(derivePlacementId("k1", "PRT-1001"), derivePlacementId("k2", "PRT-1001"));
});

// ═══════════════════════════════════════════ what it is honest about

test("placement is an EVENT — the module never accumulates a per-bin total", () => {
  // A bin is not a custody location, so there is no authoritative "how many are in A-14". What is
  // authoritative is what somebody recorded doing.
  const code = codeOnly();
  assert.doesNotMatch(code, /increment|FieldValue\.increment/, "a placement must not accumulate a balance");
  assert.doesNotMatch(code, /\.update\(/, "placements are append-only events");
});

// ═══════════════════════════════════════════ exception notes (Phase N)

test("a note is optional, trimmed, and stored as written", () => {
  const r = validatePutAwayRequest(req({ note: "  Box was crushed on arrival.  " }));
  assert.equal(r.valid, true);
  assert.equal(r.value.note, "Box was crushed on arrival.");
});

test("no note at all is fine — most stows need no explaining", () => {
  assert.equal(validatePutAwayRequest(req()).value.note, undefined);
  assert.equal(validatePutAwayRequest(req({ note: "" })).value.note, undefined);
  assert.equal(validatePutAwayRequest(req({ note: "   " })).value.note, undefined);
  assert.equal(validatePutAwayRequest(req({ note: null })).value.note, undefined);
});

test("an over-long note is REFUSED, never truncated", () => {
  // Silently cutting an explanation in half is worse than not taking it: the half that survives
  // reads as the whole story.
  assert.equal(validatePutAwayRequest(req({ note: "x".repeat(MAX_PLACEMENT_NOTE + 1) })).valid, false);
  assert.equal(validatePutAwayRequest(req({ note: "x".repeat(MAX_PLACEMENT_NOTE) })).valid, true);
});

test("a non-string note is refused", () => {
  assert.equal(validatePutAwayRequest(req({ note: 42 })).valid, false);
  assert.equal(validatePutAwayRequest(req({ note: { text: "hi" } })).valid, false);
});

test("the note is NEVER parsed, matched or acted on", () => {
  // A note explains a placement to the next human. Giving it meaning to the system would turn what
  // somebody typed into an input the system obeys.
  const code = codeOnly();
  for (const forbidden of [/note\.match/, /note\.includes/, /parseNote/i, /note\.split/, /RegExp/]) {
    assert.doesNotMatch(code, forbidden, `a note must not be interpreted (${forbidden})`);
  }
});
