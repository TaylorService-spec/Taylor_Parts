// EI-P1e-1 -- deterministic pure unit tests for the MOBILE-location inventory projection/composer
// (src/domain/mobileLocationInventoryProjection.js). Proves: nullable-unless-authoritative section
// content, NO quantity fabrication, NO direct cycle-count/reconciliation stock overwrite,
// per-section honest fail-closed states (unavailable/loading/denied/error/ready), the access-version
// boundary invalidation, the LOCATION binding (every READY source must carry an authoritative
// locationId == the resolved identity.locationId), governed pick-list gating, malformed-input
// fail-closed downgrade, identity resolution (truckId->locationId), and deterministic output.
//
// Run: node test/mobileLocationInventoryProjection.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  MOBILE_INVENTORY_SECTION_STATE as S,
  MOBILE_INVENTORY_SECTIONS,
  buildMobileInventoryOptions,
  resolveMobileLocationIdentity,
  composeMobileLocationInventory,
} from "../src/domain/mobileLocationInventoryProjection.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

const IDENTITY = { truckId: "1", locationId: "1" };
const OPTIONS = { equipmentStatus: ["LOADED", "AVAILABLE", "RESERVED"], equipmentCondition: ["New", "Refurbished", "Used"] };
// Every READY fixture carries locationId matching IDENTITY.locationId ("1") -- the contract is explicit.
const ready = (payload) => ({ status: "ready", accessVersion: "v1", locationId: "1", ...payload });

// ---- honest default (today's reality: no source is MOBILE-indexed) -----------------------------
ok("no sources -> every section UNAVAILABLE with null content (honest default)", () => {
  const r = composeMobileLocationInventory({ identity: IDENTITY, boundaryKey: "v1" });
  assert.equal(r.resolved, true);
  assert.deepEqual(r.identity, { truckId: "1", locationId: "1" });
  for (const key of MOBILE_INVENTORY_SECTIONS) {
    assert.equal(r.sections[key].state, S.UNAVAILABLE, `${key} state`);
    const content = key === "reconciliation" ? r.sections[key].observation : r.sections[key].items;
    assert.equal(content, null, `${key} content must be null unless an authoritative source is READY`);
  }
});

// ---- NO quantity fabrication -------------------------------------------------------------------
ok("parts: onHand/reserved pass through; absent `available` is null, NEVER onHand - reserved", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { parts: ready({ items: [{ internalSku: "TST-1007", onHand: 5, reserved: 2 }] }) }, // available ABSENT
  });
  const row = r.sections.parts.items[0];
  assert.equal(r.sections.parts.state, S.READY);
  assert.equal(row.onHand, 5);
  assert.equal(row.reserved, 2);
  assert.equal(row.available, null, "available must NOT be computed (would be 3)");
});

ok("parts: absent onHand is null, NEVER 0", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { parts: ready({ items: [{ internalSku: "TST-2", reserved: 1 }] }) },
  });
  assert.equal(r.sections.parts.items[0].onHand, null);
});

// ---- NO direct cycle-count / reconciliation stock overwrite ------------------------------------
ok("reconciliation is an OBSERVATION only: discrepancies never alter the parts section", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: {
      parts: ready({ items: [{ internalSku: "TST-1007", onHand: 5, reserved: 2, available: 3 }] }),
      reconciliation: ready({ observation: { expectedParts: 5, scannedParts: 4, missing: [{ internalSku: "TST-1007", note: "1 short" }], unexpected: [] } }),
    },
  });
  assert.equal(r.sections.reconciliation.state, S.READY);
  assert.equal(r.sections.reconciliation.observation.scannedParts, 4);
  assert.equal(r.sections.reconciliation.observation.missing.length, 1);
  // parts stock untouched by the reconciliation observation (no overwrite to scanned 4).
  assert.equal(r.sections.parts.items[0].onHand, 5);
  assert.equal(r.sections.parts.items[0].available, 3);
  assert.ok(!("write" in r) && !("mutations" in r) && !("adjustments" in r));
});

// ---- per-section honest states -----------------------------------------------------------------
ok("each section reflects its OWN injected source state independently", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: {
      parts: ready({ items: [] }),
      serializedAssets: { status: "denied" },
      reservations: { status: "loading" },
      reconciliation: { status: "error", detail: "should never surface" },
      activity: { status: "bogus-status" }, // unknown -> unavailable
    },
  });
  assert.equal(r.sections.parts.state, S.READY);
  assert.deepEqual(r.sections.parts.items, []); // READY with zero rows is READY, not UNAVAILABLE
  assert.equal(r.sections.serializedAssets.state, S.DENIED);
  assert.equal(r.sections.reservations.state, S.LOADING);
  assert.equal(r.sections.reconciliation.state, S.ERROR);
  assert.equal(r.sections.activity.state, S.UNAVAILABLE);
  assert.equal(r.sections.serializedAssets.items, null);
  assert.equal(r.sections.reservations.items, null);
  assert.equal(r.sections.reconciliation.observation, null);
  assert.equal(r.sections.activity.items, null);
});

// ---- malformed-input fail-closed ---------------------------------------------------------------
ok("READY array source with a non-array payload downgrades to ERROR, content null", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { parts: { status: "ready", accessVersion: "v1", locationId: "1", items: "not-an-array" } },
  });
  assert.equal(r.sections.parts.state, S.ERROR);
  assert.equal(r.sections.parts.items, null);
});

ok("READY reconciliation with a non-object observation downgrades to ERROR", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { reconciliation: { status: "ready", accessVersion: "v1", locationId: "1", observation: 42 } },
  });
  assert.equal(r.sections.reconciliation.state, S.ERROR);
  assert.equal(r.sections.reconciliation.observation, null);
});

ok("non-object / missing source -> UNAVAILABLE; malformed rows are dropped", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { parts: 12345, serializedAssets: ready({ items: [null, 7, { assetId: "EQ-1", status: "LOADED", condition: "New" }] }) },
    options: OPTIONS,
  });
  assert.equal(r.sections.parts.state, S.UNAVAILABLE);
  assert.equal(r.sections.serializedAssets.items.length, 1); // the two malformed rows dropped
  assert.equal(r.sections.serializedAssets.items[0].assetId, "EQ-1");
});

ok("composeMobileLocationInventory tolerates a non-object argument (fail-closed)", () => {
  const r = composeMobileLocationInventory(undefined);
  assert.equal(r.resolved, false);
  assert.equal(r.identity, null);
  assert.equal(r.sections.parts.state, S.UNAVAILABLE);
});

// ---- access-version boundary invalidation ------------------------------------------------------
ok("stale READY source (accessVersion != boundaryKey) becomes LOADING with null content", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v2",
    sources: { parts: { status: "ready", accessVersion: "v1", locationId: "1", items: [{ internalSku: "TST-1" }] } },
  });
  assert.equal(r.sections.parts.state, S.LOADING);
  assert.equal(r.sections.parts.items, null);
});

ok("matching accessVersion is READY; undefined boundaryKey does not gate", () => {
  const src = { parts: { status: "ready", accessVersion: "v9", locationId: "1", items: [{ internalSku: "TST-1" }] } };
  assert.equal(composeMobileLocationInventory({ identity: IDENTITY, boundaryKey: "v9", sources: src }).sections.parts.state, S.READY);
  assert.equal(composeMobileLocationInventory({ identity: IDENTITY, sources: src }).sections.parts.state, S.READY);
});

// ---- LOCATION binding (P2) ---------------------------------------------------------------------
ok("matching locationId + matching accessVersion -> READY", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { parts: ready({ items: [{ internalSku: "TST-1", onHand: 3 }] }) }, // locationId "1" via helper
  });
  assert.equal(r.sections.parts.state, S.READY);
  assert.equal(r.sections.parts.items[0].onHand, 3);
});

ok("MISSING locationId on a READY source -> no content (integrity ERROR)", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { parts: { status: "ready", accessVersion: "v1", items: [{ internalSku: "TST-1", onHand: 9 }] } }, // no locationId
  });
  assert.equal(r.sections.parts.state, S.ERROR);
  assert.equal(r.sections.parts.items, null);
});

ok("MALFORMED locationId on a READY source -> no content (integrity ERROR)", () => {
  for (const bad of [42, "", "   ", null, {}]) {
    const r = composeMobileLocationInventory({
      identity: IDENTITY, boundaryKey: "v1",
      sources: { parts: { status: "ready", accessVersion: "v1", locationId: bad, items: [{ internalSku: "TST-1" }] } },
    });
    assert.equal(r.sections.parts.state, S.ERROR, `locationId=${JSON.stringify(bad)}`);
    assert.equal(r.sections.parts.items, null);
  }
});

ok("MISMATCHED locationId -> no content (wrong-scope, never exposes another location's rows)", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { parts: { status: "ready", accessVersion: "v1", locationId: "2", items: [{ internalSku: "OTHER-LOC", onHand: 99 }] } },
  });
  assert.notEqual(r.sections.parts.state, S.READY);
  assert.equal(r.sections.parts.state, S.LOADING); // wrong-scope data -> boundary semantics
  assert.equal(r.sections.parts.items, null, "rows from location 2 must never surface under location 1");
});

ok("reconciliation receives the same location binding", () => {
  const mism = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { reconciliation: { status: "ready", accessVersion: "v1", locationId: "2", observation: { expectedParts: 5 } } },
  });
  assert.equal(mism.sections.reconciliation.observation, null);
  assert.notEqual(mism.sections.reconciliation.state, S.READY);
  const missing = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: { reconciliation: { status: "ready", accessVersion: "v1", observation: { expectedParts: 5 } } }, // no locationId
  });
  assert.equal(missing.sections.reconciliation.state, S.ERROR);
  assert.equal(missing.sections.reconciliation.observation, null);
});

ok("one valid section cannot make a mismatched section visible", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1",
    sources: {
      parts: ready({ items: [{ internalSku: "TST-1", onHand: 3 }] }), // location "1" -> READY
      serializedAssets: { status: "ready", accessVersion: "v1", locationId: "2", items: [{ assetId: "EQ-X" }] }, // location "2"
    },
  });
  assert.equal(r.sections.parts.state, S.READY);
  assert.equal(r.sections.parts.items.length, 1);
  assert.notEqual(r.sections.serializedAssets.state, S.READY);
  assert.equal(r.sections.serializedAssets.items, null, "location-2 serialized rows must never surface");
});

// ---- governed pick-list gating -----------------------------------------------------------------
ok("serialized status/condition outside the governed option sets become null", () => {
  const r = composeMobileLocationInventory({
    identity: IDENTITY, boundaryKey: "v1", options: OPTIONS,
    sources: { serializedAssets: ready({ items: [{ assetId: "EQ-1", status: "LOADED", condition: "Mint" }, { assetId: "EQ-2", status: "GONE", condition: "New" }] }) },
  });
  const [a, b] = r.sections.serializedAssets.items;
  assert.equal(a.status, "LOADED"); assert.equal(a.condition, null); // "Mint" not governed
  assert.equal(b.status, null); assert.equal(b.condition, "New"); // "GONE" not governed
  assert.deepEqual(buildMobileInventoryOptions(OPTIONS).equipmentStatus, ["LOADED", "AVAILABLE", "RESERVED"]);
});

// ---- identity resolution (truckId -> locationId) -----------------------------------------------
ok("unresolved identity forces every section UNAVAILABLE even when sources are READY", () => {
  const r = composeMobileLocationInventory({
    identity: { truckId: "1" }, // missing locationId
    boundaryKey: "v1",
    sources: { parts: ready({ items: [{ internalSku: "TST-1", onHand: 9 }] }) },
  });
  assert.equal(r.resolved, false);
  assert.equal(r.identity, null);
  assert.equal(r.sections.parts.state, S.UNAVAILABLE);
  assert.equal(r.sections.parts.items, null, "no inventory may attach to an unresolved MOBILE location");
});

ok("resolveMobileLocationIdentity requires both governed ids", () => {
  assert.deepEqual(resolveMobileLocationIdentity({ truckId: "1", locationId: "1" }), { truckId: "1", locationId: "1" });
  assert.equal(resolveMobileLocationIdentity({ truckId: " ", locationId: "1" }), null);
  assert.equal(resolveMobileLocationIdentity({ locationId: "1" }), null);
  assert.equal(resolveMobileLocationIdentity(null), null);
});

// ---- deterministic + non-mutating --------------------------------------------------------------
ok("deterministic: identical input -> deeply equal output; input not mutated", () => {
  const input = {
    identity: IDENTITY, boundaryKey: "v1", options: OPTIONS,
    sources: {
      parts: ready({ items: [{ internalSku: "TST-1007", onHand: 5, reserved: 2 }] }),
      serializedAssets: ready({ items: [{ assetId: "EQ-1", status: "LOADED", condition: "New" }] }),
      reservations: { status: "loading" },
      reconciliation: ready({ observation: { expectedParts: 5, scannedParts: 5 } }),
      activity: ready({ items: [{ time: "09:42", type: "scan", message: "ok" }] }),
    },
  };
  const snapshot = JSON.stringify(input);
  assert.deepEqual(composeMobileLocationInventory(input), composeMobileLocationInventory(input));
  assert.equal(JSON.stringify(input), snapshot, "input must not be mutated");
});

console.log(`\n${passed} passed`);
