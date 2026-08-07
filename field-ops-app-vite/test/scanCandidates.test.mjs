import test from "node:test";
import assert from "node:assert/strict";

import {
  buildScanCandidates,
  plannedPartsFromWorkOrders,
  notFoundReason,
  CANDIDATE_SCOPE,
} from "../src/domain/scanCandidates.js";
import { resolveScannedIdentity, SCAN_RESOLUTION } from "../src/domain/scannedIdentity.js";

const WOS = [
  {
    id: "wo-1", woNumber: "WO-2026-000001",
    inventorySnapshot: [
      { partId: "PRT-1001", sku: "PRT-1001", qtyPlanned: 2 },
      { partId: "PRT-1004", sku: "ICE-PROBE", qtyPlanned: 1 },
    ],
  },
  {
    id: "wo-2", woNumber: "WO-2026-000002",
    inventorySnapshot: [{ partId: "PRT-1001", sku: "PRT-1001", qtyPlanned: 1 }], // duplicate
  },
];

test("planned parts are collected across work orders and de-duplicated", () => {
  const parts = plannedPartsFromWorkOrders(WOS);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.partId).sort(), ["PRT-1001", "PRT-1004"]);
});

test("with no readable catalog the scope narrows to the caller's assigned work", () => {
  const c = buildScanCandidates({ workOrders: WOS });
  assert.equal(c.scope, CANDIDATE_SCOPE.ASSIGNED_WORK);
  assert.equal(c.parts.length, 2);
  assert.equal(c.workOrders.length, 2);
});

test("the candidate set NEVER fabricates data the caller cannot read", () => {
  // equipment, stock locations and serialized assets are not technician-readable
  // (firestore.rules). The scanner must not imply otherwise.
  const c = buildScanCandidates({ workOrders: WOS });
  assert.deepEqual(c.equipment, []);
  assert.deepEqual(c.locations, []);
  assert.deepEqual(c.serializedAssets, []);
});

test("a readable catalog widens the scope, and only then", () => {
  const c = buildScanCandidates({
    workOrders: WOS,
    catalogParts: [{ partId: "PRT-9999", sku: "WIDGET" }],
  });
  assert.equal(c.scope, CANDIDATE_SCOPE.CATALOG);
  assert.deepEqual(c.parts.map((p) => p.partId), ["PRT-9999"]);
});

test("a technician resolves a part planned on their own job", () => {
  const c = buildScanCandidates({ workOrders: WOS });
  const r = resolveScannedIdentity("ICE-PROBE", c);
  assert.equal(r.resolutionState, SCAN_RESOLUTION.RESOLVED);
  assert.equal(r.entityType, "PART");
  assert.equal(r.entityId, "PRT-1004");
});

test("a technician can scan their own Work Order", () => {
  const c = buildScanCandidates({ workOrders: WOS });
  const r = resolveScannedIdentity("WO-2026-000002", c);
  assert.equal(r.resolutionState, SCAN_RESOLUTION.RESOLVED);
  assert.equal(r.entityType, "WORK_ORDER");
  assert.equal(r.entityId, "wo-2");
});

test("a part outside the caller's work is NOT_FOUND, and the copy says why honestly", () => {
  const c = buildScanCandidates({ workOrders: WOS });
  const r = resolveScannedIdentity("PRT-9999", c);
  assert.equal(r.resolutionState, SCAN_RESOLUTION.NOT_FOUND);
  // The message must not claim the part does not exist -- the search was scoped.
  const msg = notFoundReason(c.scope, r.tokenShape);
  assert.match(msg, /your current jobs/i);
  // The search was SCOPED -- it may never claim the thing does not exist.
  assert.doesNotMatch(msg, /does not exist|no such part/i);
});

test("catalog scope gets different, equally honest copy", () => {
  assert.match(notFoundReason(CANDIDATE_SCOPE.CATALOG, "PART"), /No governed record matches/i);
});

test("three different failures read three different ways", () => {
  const scoped = CANDIDATE_SCOPE.ASSIGNED_WORK;
  const gibberish = notFoundReason(scoped, "UNRECOGNIZED");
  const notYours = notFoundReason(scoped, "PART");
  const notYourWo = notFoundReason(scoped, "WORK_ORDER");
  assert.notEqual(gibberish, notYours);
  assert.notEqual(notYours, notYourWo);
  // Gibberish must not imply a real object merely scoped away.
  assert.match(gibberish, /doesn.t look like/i);
  assert.doesNotMatch(gibberish, /your/i);
  // And none of them asserts non-existence.
  for (const m of [gibberish, notYours, notYourWo]) {
    assert.doesNotMatch(m, /does not exist/i);
  }
});

test("empty inputs are safe and yield an empty, scoped set", () => {
  const c = buildScanCandidates({});
  assert.equal(c.scope, CANDIDATE_SCOPE.ASSIGNED_WORK);
  assert.deepEqual(c.parts, []);
  assert.equal(resolveScannedIdentity("ANYTHING", c).resolutionState, SCAN_RESOLUTION.NOT_FOUND);
});

test("malformed snapshot rows are skipped rather than becoming fake parts", () => {
  const parts = plannedPartsFromWorkOrders([
    { id: "wo-x", inventorySnapshot: [{ qtyPlanned: 3 }, { partId: "   " }, { sku: "OK-1" }] },
  ]);
  assert.deepEqual(parts.map((p) => p.partId), ["OK-1"]);
});
