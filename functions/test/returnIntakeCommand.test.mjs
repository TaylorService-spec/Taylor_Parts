// RETURNS INTAKE — the DECISIONS #118 invariant. No emulator.
// Run: node --test test/returnIntakeCommand.test.mjs
//
// The single most important thing this proves is a NEGATIVE: a return does not restore stock.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  validateReturnIntake, deriveReturnId, RETURN_INTAKE_CAPABILITY, RETURNS_COLLECTION,
  RETURN_STATES, RETURN_CONDITIONS, RETURN_SOURCES,
} from "../lib/inventoryReturns/returnIntakeCommand.js";

const req = (over = {}) => ({
  partId: "PRT-1001", source: "WORK_ORDER", condition: "UNOPENED", quantity: 2, idempotencyKey: "k1", ...over,
});
const codeOnly = () => readFileSync(new URL("../src/inventoryReturns/returnIntakeCommand.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ═══════════════════════════════════════════ THE INVARIANT

test("a return writes NO ledger event — this is why RETURNED still has no writer", () => {
  // DECISIONS #118: a return must not automatically restore inventory to sellable stock. Writing a
  // RETURNED movement at intake would BE that automatic restock.
  const code = codeOnly();
  for (const forbidden of [/"RETURNED"/, /inventory_transactions/, /INVENTORY_TRANSACTIONS/, /stageOperationalMovement/, /ledger/i]) {
    assert.doesNotMatch(code, forbidden, `returns intake must never reference ${forbidden}`);
  }
});

test("it touches NO balance and NO availability", () => {
  const code = codeOnly();
  for (const forbidden of [/sumLedgerEligibleOnHand/, /onHand/i, /available/i, /reserved/i, /increment/]) {
    assert.doesNotMatch(code, forbidden, `returns intake must never reference ${forbidden}`);
  }
});

test("a returned SERIALIZED unit is not made available again", () => {
  // Whether a returned unit may be sold again is disposition's decision. Changing its state at
  // intake would answer that question by accident.
  const code = codeOnly();
  assert.doesNotMatch(code, /serialized_assets|SERIALIZED_ASSETS/, "intake must not touch the serialized registry");
  assert.doesNotMatch(code, /"AVAILABLE"/);
});

test("it writes ONE collection and nothing else", () => {
  assert.equal(RETURNS_COLLECTION, "inventory_returns");
  const collections = [...codeOnly().matchAll(/collection\(([A-Za-z_]+)\)/g)].map((m) => m[1]);
  for (const c of collections) assert.equal(c, "RETURNS_COLLECTION", `unexpected collection: ${c}`);
});

test("the capability is its OWN — receiving accepts stock, and that is the thing #118 forbids", () => {
  assert.equal(RETURN_INTAKE_CAPABILITY, "inventory.returns.intake");
  assert.notEqual(RETURN_INTAKE_CAPABILITY, "inventory.stock.receive");
});

// ═══════════════════════════════════════════ every return awaits disposition

test("there is exactly ONE state, and no transition out of it here", () => {
  assert.deepEqual([...RETURN_STATES], ["AWAITING_DISPOSITION"]);
  const code = codeOnly();
  for (const forbidden of [/RESTOCK/i, /SCRAP/i, /QUARANTINE/i, /REPAIR/i, /\.update\(/]) {
    assert.doesNotMatch(code, forbidden, `intake must not decide or change disposition (${forbidden})`);
  }
});

// ═══════════════════════════════════════════ condition is an observation

test("CONDITION never gates, routes or determines anything", () => {
  // "The box is crushed" is observable. "Therefore scrap it" is policy.
  const code = codeOnly();
  // Rejecting an INVALID condition is fine and necessary. What must never happen is branching on a
  // condition VALUE — that is the moment an observation quietly becomes a routing decision.
  for (const value of RETURN_CONDITIONS) {
    assert.doesNotMatch(
      code,
      new RegExp(`condition\s*===\s*["']${value}["']`),
      `behaviour must not depend on condition being ${value}`,
    );
  }
  assert.doesNotMatch(code, /switch\s*\(\s*condition/, "condition must not route");
});

test("UNKNOWN is a first-class condition — a sealed carton genuinely is unknown", () => {
  assert.ok(RETURN_CONDITIONS.includes("UNKNOWN"));
  assert.equal(validateReturnIntake(req({ condition: "UNKNOWN" })).valid, true);
});

test("an UNRECOGNIZED condition or source is REFUSED, never coerced to UNKNOWN", () => {
  // UNKNOWN means "nobody could tell"; a typo means the caller is broken. Turning one into the other
  // would record a deliberate observation that was never made.
  assert.equal(validateReturnIntake(req({ condition: "SMASHED" })).valid, false);
  assert.equal(validateReturnIntake(req({ source: "SOMEWHERE" })).valid, false);
  assert.equal(validateReturnIntake(req({ condition: undefined })).valid, false);
  assert.equal(validateReturnIntake(req({ source: undefined })).valid, false);
});

test("the vocabularies are observational, and carry no disposition", () => {
  for (const decision of ["RESTOCKED", "SCRAPPED", "REPAIRED", "QUARANTINED", "REJECTED"]) {
    assert.equal(RETURN_CONDITIONS.includes(decision), false, `${decision} is a decision, not an observation`);
  }
  assert.ok(RETURN_SOURCES.includes("UNKNOWN"));
});

// ═══════════════════════════════════════════ what is captured

test("a quantity return is accepted with its context", () => {
  const r = validateReturnIntake(req({ sourceReference: " WO-2026-0001 ", reason: "  Wrong part sent.  " }));
  assert.equal(r.valid, true);
  assert.equal(r.value.sourceReference, "WO-2026-0001");
  assert.equal(r.value.reason, "Wrong part sent.");
  assert.equal(r.value.quantity, 2);
});

test("a serialized return keeps its units", () => {
  const r = validateReturnIntake(req({ quantity: undefined, serialNumbers: [" SN-1 ", "SN-2"] }));
  assert.deepEqual(r.value.serialNumbers, ["SN-1", "SN-2"]);
  assert.equal(r.value.quantity, undefined);
});

test("EXACTLY ONE of quantity or serials", () => {
  assert.equal(validateReturnIntake(req({ serialNumbers: ["SN-1"] })).valid, false);
  assert.equal(validateReturnIntake(req({ quantity: undefined })).valid, false);
});

test("a duplicated serial is refused rather than de-duplicated", () => {
  assert.equal(validateReturnIntake(req({ quantity: undefined, serialNumbers: ["SN-1", "sn-1"] })).valid, false);
});

test("a non-positive or fractional quantity is refused", () => {
  for (const quantity of [0, -1, 1.5, "2", null]) {
    assert.equal(validateReturnIntake(req({ quantity })).valid, false);
  }
});

test("reason is optional, trimmed, and refused rather than truncated when over-long", () => {
  assert.equal(validateReturnIntake(req()).value.reason, null);
  assert.equal(validateReturnIntake(req({ reason: "   " })).value.reason, null);
  assert.equal(validateReturnIntake(req({ reason: "x".repeat(501) })).valid, false);
});

test("part and idempotency key are required", () => {
  for (const field of ["partId", "idempotencyKey"]) {
    assert.equal(validateReturnIntake(req({ [field]: "" })).valid, false);
  }
});

test("a non-object request is refused", () => {
  for (const bad of [null, undefined, [], "return", 3]) {
    assert.equal(validateReturnIntake(bad).valid, false);
  }
});

test("the return id is derived, so a retry replays rather than recording twice", () => {
  assert.equal(deriveReturnId("k1"), deriveReturnId("k1"));
  assert.notEqual(deriveReturnId("k1"), deriveReturnId("k2"));
});
