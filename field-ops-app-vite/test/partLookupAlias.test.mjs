// BARCODE / ALIAS LOOKUP — how the identifier answer composes with the part-code answer. PURE.
// Run: node --test test/partLookupAlias.test.mjs
//
// The rule under test throughout: an IDENTIFIER failure never widens into an unrelated Part match,
// and the identifier answer is consulted ONLY when the part code did not match.
//
// Phase F's own contract (direct part-code lookup, UNKNOWN handling, the absent-row states) stays
// in test/partLookup.test.mjs and is deliberately not re-proved here.
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPartLookup, LOOKUP_STATE, MATCHED_BY, ALIAS_RESULT, ALIAS_NOT_READY, ALIAS_TYPE_LABEL,
} from "../src/domain/partLookup.js";

const part = (over = {}) => ({
  invalid: false, partId: "PRT-1001", internalPartNumber: "TS-1001", name: "Compressor relay",
  description: "Start relay, 240V", category: "Electrical", status: "ACTIVE",
  stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", version: 3, ...over,
});
const ok = (...parts) => ({ ok: true, parts, invalid: [] });

const aliasFound = (partId, aliasType = "UPC") =>
  ({ result: { result: ALIAS_RESULT.FOUND, partId, aliasType, aliasId: "a1" } });
const aliasSays = (result, extra = {}) => ({ result: { result, ...extra } });
const BARCODE = "0037000112345";

// ─────────────────────────────────────────── direct lookup is untouched

test("a direct PART CODE match is unchanged, and is reported as matched by part code", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasSays(ALIAS_RESULT.NOT_FOUND), token: "PRT-1001" });
  assert.equal(r.state, LOOKUP_STATE.RESOLVED);
  assert.equal(r.matchedBy, MATCHED_BY.PART_CODE);
  assert.equal(r.matchedIdentifier, null);
});

test("the identifier answer is IGNORED when the part code matched the same part", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasFound("PRT-1001"), token: "PRT-1001" });
  assert.equal(r.state, LOOKUP_STATE.RESOLVED);
  assert.equal(r.matchedBy, MATCHED_BY.PART_CODE, "a part's own code is the stronger identity");
});

test("a direct match survives a DENIED or UNAVAILABLE identifier lookup", () => {
  // Half the search failing must not cost the operator an answer the other half already had.
  for (const outcome of [{ errorStatus: "permission-denied" }, { errorStatus: ALIAS_NOT_READY }, { errorStatus: "internal" }, null]) {
    const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: outcome, token: "PRT-1001" });
    assert.equal(r.state, LOOKUP_STATE.RESOLVED, `${JSON.stringify(outcome)} must not break direct lookup`);
  }
});

// ─────────────────────────────────────────── resolution by identifier

test("an ACTIVE identifier resolves to the part, and says WHICH identifier matched", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasFound("PRT-1001", "SUPPLIER_SKU"), token: BARCODE });
  assert.equal(r.state, LOOKUP_STATE.RESOLVED);
  assert.equal(r.part.partId, "PRT-1001");
  assert.equal(r.matchedBy, MATCHED_BY.IDENTIFIER);
  assert.equal(r.matchedIdentifier.aliasType, "SUPPLIER_SKU");
  assert.ok(r.rows.length > 0, "it is the same part projection as a direct match");
});

test("resolving by identifier produces the SAME rows as resolving the part directly", () => {
  const direct = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasSays(ALIAS_RESULT.NOT_FOUND), token: "PRT-1001" });
  const viaAlias = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasFound("PRT-1001"), token: BARCODE });
  assert.deepEqual(viaAlias.rows, direct.rows, "how you reached a part cannot change what it is");
});

// ─────────────────────────────────────────── every failure keeps its own identity

test("an INACTIVE identifier is its own state, names the part, and resolves nothing", () => {
  const r = buildPartLookup({
    catalogResult: ok(part()),
    aliasOutcome: aliasSays(ALIAS_RESULT.INACTIVE, { partId: "PRT-1001", aliasType: "UPC", aliasId: "a1" }),
    token: BARCODE,
  });
  assert.equal(r.state, LOOKUP_STATE.ALIAS_INACTIVE);
  assert.equal(r.part, null, "an inactive identifier must not silently resolve");
  assert.match(r.message, /no longer active/i);
  assert.match(r.message, /PRT-1001/, "it names what the identifier used to mean");
  assert.doesNotMatch(r.message, /no governed record|not registered/i);
});

test("an AMBIGUOUS identifier refuses to pick, and lists the parts", () => {
  const r = buildPartLookup({
    catalogResult: ok(part()),
    aliasOutcome: aliasSays(ALIAS_RESULT.AMBIGUOUS, { matches: [{ partId: "PRT-1001" }, { partId: "PRT-2002" }] }),
    token: BARCODE,
  });
  assert.equal(r.state, LOOKUP_STATE.AMBIGUOUS);
  assert.equal(r.part, null);
  assert.deepEqual(r.candidates.map((c) => c.entityId), ["PRT-1001", "PRT-2002"]);
});

test("an unknown identifier is plain NOT_FOUND — one fact, one message", () => {
  for (const result of [ALIAS_RESULT.NOT_FOUND, ALIAS_RESULT.MALFORMED]) {
    const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasSays(result, { detail: "x" }), token: BARCODE });
    assert.equal(r.state, LOOKUP_STATE.NOT_FOUND);
    assert.match(r.message, /no governed record matches/i);
  }
});

test("a DENIED identifier lookup says the check could not be MADE, not that nothing was found", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: { errorStatus: "permission-denied" }, token: BARCODE });
  assert.equal(r.state, LOOKUP_STATE.ALIAS_DENIED);
  assert.match(r.message, /not authorized/i);
  assert.doesNotMatch(r.message, /no governed record|not registered/i);
});

test("TRANSPORT NOT READY is its own state — the honest form of we did not check", () => {
  // This is the state every environment is in today. Reporting a bare NOT_FOUND here would tell an
  // operator their barcode is unregistered when it was never looked at.
  const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: { errorStatus: ALIAS_NOT_READY }, token: BARCODE });
  assert.equal(r.state, LOOKUP_STATE.ALIAS_UNAVAILABLE);
  assert.match(r.message, /not switched on/i);
  assert.doesNotMatch(r.message, /not authorized/i, "unavailable is not a denial");
});

test("any other transport error is UNAVAILABLE, never an absence", () => {
  for (const status of ["internal", "unavailable", "deadline-exceeded", "unauthenticated"]) {
    const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: { errorStatus: status }, token: BARCODE });
    assert.equal(r.state, LOOKUP_STATE.ALIAS_UNAVAILABLE, `${status} must not read as not-registered`);
  }
});

test("a malformed transport payload is UNAVAILABLE, never nothing-is-registered", () => {
  for (const bad of [{ result: null }, { result: {} }, { result: { result: "SOMETHING_ELSE" } }, {}]) {
    const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: bad, token: BARCODE });
    assert.equal(r.state, LOOKUP_STATE.ALIAS_UNAVAILABLE);
  }
});

test("NOT ATTEMPTED falls back to the plain part-code NOT_FOUND, claiming nothing about identifiers", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: null, token: BARCODE });
  assert.equal(r.state, LOOKUP_STATE.NOT_FOUND);
  assert.doesNotMatch(r.message, /identifier|barcode/i);
});

test("an identifier resolving to an UNREADABLE part is its own state, and names the part", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasFound("PRT-MISSING"), token: BARCODE });
  assert.equal(r.state, LOOKUP_STATE.ALIAS_PART_UNREADABLE);
  assert.equal(r.part, null);
  assert.match(r.message, /PRT-MISSING/);
  assert.match(r.message, /could not be read/i);
  assert.doesNotMatch(r.message, /no governed record/i);
});

// ─────────────────────────────────────────── no silent fallback

test("an identifier failure NEVER falls back to an unrelated part", () => {
  const catalog = ok(part(), part({ partId: "PRT-2002", internalPartNumber: "TS-2002", name: "Other" }));
  for (const outcome of [
    { errorStatus: "permission-denied" },
    { errorStatus: ALIAS_NOT_READY },
    aliasSays(ALIAS_RESULT.INACTIVE, { partId: "PRT-1001", aliasType: "UPC", aliasId: "a1" }),
    aliasSays(ALIAS_RESULT.AMBIGUOUS, { matches: [{ partId: "PRT-1001" }] }),
    aliasFound("PRT-NOWHERE"),
  ]) {
    const r = buildPartLookup({ catalogResult: catalog, aliasOutcome: outcome, token: BARCODE });
    assert.equal(r.part, null, `${JSON.stringify(outcome)} must not produce a part`);
    assert.notEqual(r.state, LOOKUP_STATE.RESOLVED);
  }
});

test("CONFLICT: a value that is one part's CODE and another part's IDENTIFIER resolves to neither", () => {
  const catalog = ok(part(), part({ partId: "PRT-2002", internalPartNumber: "TS-2002", name: "Other" }));
  const r = buildPartLookup({ catalogResult: catalog, aliasOutcome: aliasFound("PRT-2002"), token: "PRT-1001" });
  assert.equal(r.state, LOOKUP_STATE.CONFLICT);
  assert.equal(r.part, null, "picking either would hide a data error inside a confident answer");
  assert.deepEqual(r.candidates.map((c) => c.entityId).sort(), ["PRT-1001", "PRT-2002"]);
  assert.match(r.message, /corrected/i, "it says the data needs fixing, not that the user erred");
});

test("a DENIED catalog read still takes precedence — nothing resolves without the part", () => {
  const r = buildPartLookup({ catalogResult: { ok: false, code: "permission-denied" }, aliasOutcome: aliasFound("PRT-1001"), token: BARCODE });
  assert.equal(r.state, LOOKUP_STATE.DENIED);
  assert.equal(r.part, null);
});

// ─────────────────────────────────────────── vocabulary integrity

test("every alias type the server can return has a plain-language label", () => {
  // Mirrors functions/src/partMaster/types.ts ALIAS_TYPES. A type with no label renders as a raw
  // enum next to a scan result, which is the moment plain language matters most.
  const SERVER_ALIAS_TYPES = [
    "INTERNAL_PN", "MANUFACTURER_PN", "SUPPLIER_SKU", "UPC", "EAN",
    "GTIN", "LEGACY", "CUSTOMER_REF", "VENDOR_REF", "BARCODE_OTHER",
  ];
  for (const t of SERVER_ALIAS_TYPES) {
    assert.ok(ALIAS_TYPE_LABEL[t], `${t} would render as a raw enum`);
    assert.notEqual(ALIAS_TYPE_LABEL[t], t);
  }
  assert.equal(
    Object.keys(ALIAS_TYPE_LABEL).length,
    SERVER_ALIAS_TYPES.length,
    "a label exists for a type the server cannot return, or one is missing",
  );
});

test("every Phase G state is distinct, and none reuses another's message", () => {
  const outcomes = [
    buildPartLookup({ catalogResult: ok(part()), aliasOutcome: { errorStatus: "permission-denied" }, token: BARCODE }),
    buildPartLookup({ catalogResult: ok(part()), aliasOutcome: { errorStatus: ALIAS_NOT_READY }, token: BARCODE }),
    buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasSays(ALIAS_RESULT.INACTIVE, { partId: "P1", aliasType: "UPC" }), token: BARCODE }),
    buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasFound("PRT-MISSING"), token: BARCODE }),
    buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasFound("PRT-2002"), token: "PRT-1001" }),
  ];
  const states = outcomes.map((o) => o.state);
  const messages = outcomes.map((o) => o.message);
  assert.equal(new Set(states).size, states.length, "states collapsed into each other");
  assert.equal(new Set(messages).size, messages.length, "two different problems share one sentence");
});

test("no Phase G state carries an action, and all stay frozen", () => {
  const r = buildPartLookup({ catalogResult: ok(part()), aliasOutcome: aliasFound("PRT-1001"), token: BARCODE });
  assert.equal(r.actions, undefined);
  assert.throws(() => { r.matchedBy = MATCHED_BY.PART_CODE; }, TypeError);
  assert.throws(() => { r.matchedIdentifier.aliasType = "LEGACY"; }, TypeError);
});
