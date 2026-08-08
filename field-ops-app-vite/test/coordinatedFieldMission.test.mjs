// Coordinated FIELD MISSION mirror — pure unit tests (node:test). Mirrors functions/src/fulfillment/
// coordinatedFieldMission.ts. Proves honest per-unit + mission readiness (missing evidence ⇒ UNKNOWN, never a
// fake READY), load rollup, honest partial progress, and material-blocker normalization that ROUTES an
// unconnected replenishment substrate as UNKNOWN rather than fabricating a resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoordinatedVisit } from "../src/domain/coordinatedVisit.js";
import {
  buildCoordinatedFieldMission, normalizeMaterialBlocker,
  missionReadinessTone, unitReadinessTone, loadVerifiedLabel, loadVerifiedTone,
} from "../src/domain/coordinatedFieldMission.js";

const wo = (id, status) => ({ id, woNumber: id, status, salesOrderId: "SO1", customerId: "C1", locationId: "L1" });
const visitOf = (...wos) => buildCoordinatedVisit("SO1", wos);

test("done unit READY; blocked unit ATTENTION regardless of signals", () => {
  const m = buildCoordinatedFieldMission(visitOf(wo("a", "COMPLETED"), wo("b", "BLOCKED")), {
    b: { partsReadiness: "READY", loadVerified: true },
  });
  assert.equal(m.units.find((u) => u.workOrderId === "a").unitReadiness, "READY");
  assert.equal(m.units.find((u) => u.workOrderId === "b").unitReadiness, "ATTENTION");
});

test("missing parts/load evidence ⇒ UNKNOWN unit (never fake READY)", () => {
  const m = buildCoordinatedFieldMission(visitOf(wo("a", "IN_PROGRESS")), {}); // no signals
  assert.equal(m.units[0].partsReadiness, "UNKNOWN");
  assert.equal(m.units[0].loadVerified, null);
  assert.equal(m.units[0].unitReadiness, "UNKNOWN");
});

test("parts ATTENTION or load not-verified ⇒ ATTENTION unit", () => {
  const m = buildCoordinatedFieldMission(visitOf(wo("a", "IN_PROGRESS"), wo("b", "IN_PROGRESS")), {
    a: { partsReadiness: "ATTENTION", loadVerified: true },
    b: { partsReadiness: "READY", loadVerified: false },
  });
  assert.equal(m.units.find((u) => u.workOrderId === "a").unitReadiness, "ATTENTION");
  assert.equal(m.units.find((u) => u.workOrderId === "b").unitReadiness, "ATTENTION");
});

test("C713×5: 3 done + 1 in-progress-ready + 1 blocked ⇒ mission ATTENTION, honest progress", () => {
  const visit = visitOf(
    wo("a", "COMPLETED"), wo("b", "COMPLETED"), wo("c", "COMPLETED"), wo("d", "IN_PROGRESS"), wo("e", "BLOCKED"),
  );
  const m = buildCoordinatedFieldMission(visit, {
    a: { partsReadiness: "READY", loadVerified: true }, b: { partsReadiness: "READY", loadVerified: true },
    c: { partsReadiness: "READY", loadVerified: true }, d: { partsReadiness: "READY", loadVerified: true },
    e: { partsReadiness: "ATTENTION", loadVerified: false, materialBlocker: { partRef: "PRT-X", shortBy: 1, replenishmentConnected: false } },
  });
  assert.equal(m.missionReadiness, "ATTENTION");
  assert.deepEqual(m.progress, { total: 5, completed: 3, blocked: 1, remaining: 2 });
  assert.equal(m.loadReadiness, "ATTENTION"); // e load not verified
  const eu = m.units.find((u) => u.workOrderId === "e");
  assert.equal(eu.materialBlocker.replenishmentConnected, false);
  assert.equal(eu.materialBlocker.resolution, "UNKNOWN"); // routed, not fabricated
});

test("all done ⇒ mission READY; some done + rest READY ⇒ PARTIAL", () => {
  const allDone = buildCoordinatedFieldMission(visitOf(wo("a", "COMPLETED"), wo("b", "CLOSED")), {});
  assert.equal(allDone.missionReadiness, "READY");
  const partial = buildCoordinatedFieldMission(visitOf(wo("a", "COMPLETED"), wo("b", "IN_PROGRESS")), {
    b: { partsReadiness: "READY", loadVerified: true },
  });
  assert.equal(partial.missionReadiness, "PARTIAL");
});

test("loadReadiness: any undetermined ⇒ UNKNOWN; any false ⇒ ATTENTION; all true ⇒ READY", () => {
  assert.equal(buildCoordinatedFieldMission(visitOf(wo("a", "IN_PROGRESS")), {}).loadReadiness, "UNKNOWN");
  assert.equal(buildCoordinatedFieldMission(visitOf(wo("a", "IN_PROGRESS")), { a: { loadVerified: false } }).loadReadiness, "ATTENTION");
  assert.equal(buildCoordinatedFieldMission(visitOf(wo("a", "IN_PROGRESS")), { a: { partsReadiness: "READY", loadVerified: true } }).loadReadiness, "READY");
});

test("normalizeMaterialBlocker: no partRef ⇒ null; unconnected ⇒ UNKNOWN resolution", () => {
  assert.equal(normalizeMaterialBlocker(null), null);
  assert.equal(normalizeMaterialBlocker({ shortBy: 2 }), null); // no partRef
  const routed = normalizeMaterialBlocker({ partRef: "P1", shortBy: 2, replenishmentConnected: false, resolution: "ETA tomorrow" });
  assert.equal(routed.resolution, "UNKNOWN"); // ignores fabricated resolution when substrate not connected
  const connected = normalizeMaterialBlocker({ partRef: "P1", replenishmentConnected: true, resolution: "ETA 2 days" });
  assert.equal(connected.resolution, "ETA 2 days");
});

test("tone/label helpers honest", () => {
  assert.equal(missionReadinessTone("UNKNOWN"), "unknown");
  assert.equal(unitReadinessTone("READY"), "positive");
  assert.equal(loadVerifiedLabel(null), "Load unknown");
  assert.equal(loadVerifiedTone(false), "attention");
});
