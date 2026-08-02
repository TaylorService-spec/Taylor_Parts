// EI Truck Registry -- OperationalReferenceProbe unit tests. Pure `node --test` (no emulator, no
// firebase): the authority checks are injected fakes and the real registry's checks return UNKNOWN
// without any I/O. Proves aggregation, fail-closed wrapping (throw/malformed -> UNKNOWN), runtime
// completeness, the current-schema fail-closed reality, and crosswalk coverage.
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  REFERENCE_AUTHORITY_KEYS,
  REFERENCE_AUTHORITIES,
  aggregateReferenceStates,
  buildReferenceCrosswalk,
  buildOperationalReferenceProbe,
} = await import("../lib/truckRegistry/operationalReferenceProbe.js");

const DB = { db: {} }; // unused by fakes / by the current all-UNKNOWN registry
const TXN = {};
const ARGS = { truckId: "TRK-1", locationId: "MLOC-1" };

// A full-coverage authorities list where every governed key returns `state` (override individual keys).
function authoritiesAll(state, overrides = {}) {
  return REFERENCE_AUTHORITY_KEYS.map((key) => ({
    key,
    description: key,
    verifiableNow: true,
    check: overrides[key] ?? (async () => state),
  }));
}

test("aggregateReferenceStates: REFERENCED dominates; empty/any-UNKNOWN -> UNKNOWN; all CLEAR -> CLEAR", () => {
  assert.equal(aggregateReferenceStates(["CLEAR", "CLEAR"]), "CLEAR");
  assert.equal(aggregateReferenceStates(["CLEAR", "REFERENCED"]), "REFERENCED");
  assert.equal(aggregateReferenceStates(["REFERENCED", "UNKNOWN"]), "REFERENCED");
  assert.equal(aggregateReferenceStates(["CLEAR", "UNKNOWN"]), "UNKNOWN");
  assert.equal(aggregateReferenceStates([]), "UNKNOWN");
});

test("crosswalk covers EXACTLY the governed authority keys (no missing / no extra) -- completeness", () => {
  const crosswalk = buildReferenceCrosswalk();
  const crossKeys = crosswalk.map((c) => c.key).sort();
  const enumKeys = [...REFERENCE_AUTHORITY_KEYS].sort();
  assert.deepEqual(crossKeys, enumKeys);
  const registryKeys = REFERENCE_AUTHORITIES.map((a) => a.key).sort();
  assert.deepEqual(registryKeys, enumKeys);
});

test("current schema: EVERY authority is unverifiable with a documented blocker -> real probe UNKNOWN", async () => {
  for (const a of buildReferenceCrosswalk()) {
    assert.equal(a.verifiableNow, false, `${a.key} verifiableNow`);
    assert.ok(typeof a.blocker === "string" && a.blocker.length > 0, `${a.key} has a blocker`);
  }
  const probe = buildOperationalReferenceProbe(DB); // real REFERENCE_AUTHORITIES
  assert.equal(await probe(ARGS, TXN), "UNKNOWN");
});

test("framework: all authorities CLEAR (full coverage) -> CLEAR", async () => {
  const probe = buildOperationalReferenceProbe(DB, authoritiesAll("CLEAR"));
  assert.equal(await probe(ARGS, TXN), "CLEAR");
});

test("framework: any authority REFERENCED -> REFERENCED (short-circuit)", async () => {
  const probe = buildOperationalReferenceProbe(DB, authoritiesAll("CLEAR", { ledgerEvents: async () => "REFERENCED" }));
  assert.equal(await probe(ARGS, TXN), "REFERENCED");
});

test("framework: a throwing authority fails closed -> UNKNOWN", async () => {
  const probe = buildOperationalReferenceProbe(DB, authoritiesAll("CLEAR", { partsStock: async () => { throw new Error("boom at collection X"); } }));
  assert.equal(await probe(ARGS, TXN), "UNKNOWN");
});

test("framework: a malformed authority result fails closed -> UNKNOWN", async () => {
  const probe = buildOperationalReferenceProbe(DB, authoritiesAll("CLEAR", { rma: async () => "MAYBE" }));
  assert.equal(await probe(ARGS, TXN), "UNKNOWN");
});

test("framework: an UNMENTIONED governed authority (incomplete coverage) -> UNKNOWN (never CLEAR)", async () => {
  const missingOne = authoritiesAll("CLEAR").filter((a) => a.key !== "scrap"); // drop a required authority
  const probe = buildOperationalReferenceProbe(DB, missingOne);
  assert.equal(await probe(ARGS, TXN), "UNKNOWN");
});
