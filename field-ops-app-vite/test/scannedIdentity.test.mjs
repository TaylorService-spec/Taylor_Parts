import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeScanToken,
  resolveScannedIdentity,
  SCAN_RESOLUTION,
  SCANNABLE_ENTITY_TYPES,
} from "../src/domain/scannedIdentity.js";

const CANDIDATES = {
  parts: [{ partId: "PRT-1001", sku: "PRT-1001" }, { partId: "PRT-1002", sku: "EVAP-2" }],
  serializedAssets: [{ serialNo: "SBX-AM450-0001", partId: "PRT-1001" }],
  workOrders: [{ id: "wo-sbx-001", woNumber: "WO-2026-SBX001" }],
  locations: [{ locationId: "wh-main", type: "WAREHOUSE" }, { locationId: "truck-14", type: "MOBILE" }],
  equipment: [{ equipmentId: "eq-ice-001", serialNumber: "AM450-SN-9" }],
};

// ------------------------------------------------------- normalization

test("unwraps JSON, URL and vendor-prefixed payloads to one token", () => {
  assert.equal(normalizeScanToken('{"partId":"PRT-1001"}'), "PRT-1001");
  assert.equal(normalizeScanToken('{"serialNo":"SBX-AM450-0001"}'), "SBX-AM450-0001");
  assert.equal(normalizeScanToken("https://x.example/scan?part=PRT-1002"), "PRT-1002");
  assert.equal(normalizeScanToken("https://x.example/s?wo=WO-2026-SBX001"), "WO-2026-SBX001");
  assert.equal(normalizeScanToken("TAYLOR-PART:PRT-1001"), "PRT-1001");
  assert.equal(normalizeScanToken("  PRT-1001  "), "PRT-1001");
});

test("unusable input normalizes to null rather than a guess", () => {
  for (const bad of ["", "   ", null, undefined, 42, {}, "{}", '{"nothing":"here"}']) {
    assert.equal(normalizeScanToken(bad), null, String(bad));
  }
});

// ------------------------------------------------------------ identity

test("resolves each governed entity type by its canonical identifier", () => {
  const cases = [
    ["PRT-1001", "PART", "PRT-1001"],
    ["EVAP-2", "PART", "PRT-1002"],                      // sku -> canonical partId
    ["SBX-AM450-0001", "SERIALIZED_ASSET", "SBX-AM450-0001"],
    ["WO-2026-SBX001", "WORK_ORDER", "wo-sbx-001"],       // woNumber -> canonical doc id
    ["wh-main", "INVENTORY_LOCATION", "wh-main"],
    ["truck-14", "INVENTORY_LOCATION", "truck-14"],       // a truck IS a MOBILE location
    ["AM450-SN-9", "EQUIPMENT", "eq-ice-001"],            // serialNumber -> canonical equipmentId
  ];
  for (const [token, type, id] of cases) {
    const r = resolveScannedIdentity(token, CANDIDATES);
    assert.equal(r.resolutionState, SCAN_RESOLUTION.RESOLVED, token);
    assert.equal(r.entityType, type, token);
    assert.equal(r.entityId, id, token);
    assert.ok(r.canonicalIdentity, token);
  }
});

test("matching is case-insensitive but never fuzzy", () => {
  assert.equal(resolveScannedIdentity("prt-1001", CANDIDATES).entityType, "PART");
  // A near-miss must NOT resolve.
  assert.equal(resolveScannedIdentity("PRT-100", CANDIDATES).resolutionState, SCAN_RESOLUTION.NOT_FOUND);
  assert.equal(resolveScannedIdentity("PRT-10011", CANDIDATES).resolutionState, SCAN_RESOLUTION.NOT_FOUND);
});

// ----------------------------------------------------- failure states

test("the four failure states stay distinct", () => {
  assert.equal(resolveScannedIdentity("", CANDIDATES).resolutionState, SCAN_RESOLUTION.INVALID);
  assert.equal(resolveScannedIdentity("NOPE-999", CANDIDATES).resolutionState, SCAN_RESOLUTION.NOT_FOUND);

  const ambiguous = resolveScannedIdentity("DUP-1", {
    parts: [{ partId: "DUP-1", sku: "DUP-1" }],
    equipment: [{ equipmentId: "DUP-1", serialNumber: "x" }],
  });
  assert.equal(ambiguous.resolutionState, SCAN_RESOLUTION.AMBIGUOUS);
  assert.equal(ambiguous.candidates.length, 2);
  // Ambiguity must not silently pick a winner.
  assert.equal(ambiguous.entityType, null);
  assert.equal(ambiguous.entityId, null);
});

test("the same entity in two candidate lists is not a false ambiguity", () => {
  const r = resolveScannedIdentity("PRT-1001", {
    parts: [{ partId: "PRT-1001", sku: "PRT-1001" }, { partId: "PRT-1001", sku: "PRT-1001" }],
  });
  assert.equal(r.resolutionState, SCAN_RESOLUTION.RESOLVED);
  assert.equal(r.entityId, "PRT-1001");
});

test("a well-formed Work Order number that matches nothing is NOT_FOUND, never fabricated", () => {
  const r = resolveScannedIdentity("WO-2026-NOTREAL", CANDIDATES);
  assert.equal(r.resolutionState, SCAN_RESOLUTION.NOT_FOUND);
  assert.equal(r.entityType, null);
  assert.equal(r.entityId, null);
  assert.equal(r.looksLike, "WORK_ORDER"); // a message hint only
});

test("a location without a governed type is not a canonical location", () => {
  const r = resolveScannedIdentity("mystery-loc", { locations: [{ locationId: "mystery-loc", type: "NOT_A_TYPE" }] });
  assert.equal(r.resolutionState, SCAN_RESOLUTION.NOT_FOUND);
});

test("no candidates at all yields NOT_FOUND, never a fabricated identity", () => {
  const r = resolveScannedIdentity("PRT-1001", {});
  assert.equal(r.resolutionState, SCAN_RESOLUTION.NOT_FOUND);
  assert.equal(r.entityType, null);
});

// --------------------------------------------- the F2 core guarantee

test("identity resolution NEVER returns actions or authority", () => {
  const probes = ["PRT-1001", "WO-2026-SBX001", "wh-main", "NOPE", ""];
  const forbidden = ["actions", "allowedActions", "permissions", "capabilities", "canConsume", "authorized", "authority"];
  for (const p of probes) {
    const r = resolveScannedIdentity(p, CANDIDATES);
    for (const key of forbidden) {
      assert.ok(!(key in r), `${p}: identity result must not carry "${key}"`);
    }
  }
});

test("the resolution result never carries an authorization outcome", () => {
  // Authorization is a separate axis. A scanner reporting "denied" would be
  // conflating identity with authority — the exact thing F2 exists to prevent.
  const r = resolveScannedIdentity("PRT-1001", CANDIDATES);
  assert.ok(!Object.values(SCAN_RESOLUTION).includes("DENIED"));
  assert.ok(!("denied" in r) && !("notAuthorized" in r));
});

test("raw scanned strings never become entity labels", () => {
  const r = resolveScannedIdentity("SOME-RANDOM-SCAN", CANDIDATES);
  assert.equal(r.entityType, null);
  assert.equal(r.canonicalIdentity, null);
  // The token is echoed for diagnostics but is not an identity.
  assert.equal(r.token, "SOME-RANDOM-SCAN");
});

test("every supported entity type is reachable and each has a canonical identifier", () => {
  assert.equal(SCANNABLE_ENTITY_TYPES.length, 5);
  const reached = new Set();
  for (const t of ["PRT-1001", "SBX-AM450-0001", "WO-2026-SBX001", "wh-main", "AM450-SN-9"]) {
    reached.add(resolveScannedIdentity(t, CANDIDATES).entityType);
  }
  for (const t of SCANNABLE_ENTITY_TYPES) assert.ok(reached.has(t), `unreachable: ${t}`);
});
