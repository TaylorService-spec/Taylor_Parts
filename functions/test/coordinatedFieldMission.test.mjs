// Fulfillment Cycle 9 — OFFLINE tests for the PURE coordinated field-mission projection. Proves the
// technician mission view: shared context, per-unit readiness, honest UNKNOWN, load readiness, overall rollup.
import test from "node:test";
import assert from "node:assert/strict";
import { buildCoordinatedFieldMission } from "../lib/fulfillment/coordinatedFieldMission.js";

const visit = (workOrders, extra = {}) => ({
  salesOrderId: "SO-1", customerId: "ACCT-1", locationId: "LOC-1", contextConsistent: true, workOrders, ...extra,
});
const u = (id, status) => ({ id, woNumber: id, status, lineRefs: ["C713"] });

test("shared mission context carries through", () => {
  const m = buildCoordinatedFieldMission(visit([u("W1", "CREATED")]));
  assert.equal(m.salesOrderId, "SO-1");
  assert.equal(m.customerId, "ACCT-1");
  assert.equal(m.locationId, "LOC-1");
});

test("missing field signals ⇒ unit UNKNOWN (never fake READY)", () => {
  const m = buildCoordinatedFieldMission(visit([u("W1", "CREATED")])); // no signals
  assert.equal(m.units[0].partsReadiness, "UNKNOWN");
  assert.equal(m.units[0].loadVerified, null);
  assert.equal(m.units[0].unitReadiness, "UNKNOWN");
  assert.equal(m.missionReadiness, "UNKNOWN");
});

test("a unit is READY only when parts READY and load verified", () => {
  const m = buildCoordinatedFieldMission(visit([u("W1", "CREATED")]), { W1: { partsReadiness: "READY", loadVerified: true } });
  assert.equal(m.units[0].unitReadiness, "READY");
  assert.equal(m.missionReadiness, "READY");
});

test("parts ATTENTION or unverified load ⇒ unit ATTENTION; blocked status ⇒ ATTENTION", () => {
  const attnParts = buildCoordinatedFieldMission(visit([u("W1", "CREATED")]), { W1: { partsReadiness: "ATTENTION", loadVerified: true } });
  assert.equal(attnParts.units[0].unitReadiness, "ATTENTION");
  const attnLoad = buildCoordinatedFieldMission(visit([u("W1", "CREATED")]), { W1: { partsReadiness: "READY", loadVerified: false } });
  assert.equal(attnLoad.units[0].unitReadiness, "ATTENTION");
  const blocked = buildCoordinatedFieldMission(visit([u("W1", "BLOCKED")]), { W1: { partsReadiness: "READY", loadVerified: true } });
  assert.equal(blocked.units[0].unitReadiness, "ATTENTION");
});

test("load readiness: all verified=READY; any false=ATTENTION; any undetermined=UNKNOWN", () => {
  const ready = buildCoordinatedFieldMission(visit([u("A", "CREATED"), u("B", "CREATED")]), { A: { loadVerified: true }, B: { loadVerified: true } });
  assert.equal(ready.loadReadiness, "READY");
  const attn = buildCoordinatedFieldMission(visit([u("A", "CREATED"), u("B", "CREATED")]), { A: { loadVerified: true }, B: { loadVerified: false } });
  assert.equal(attn.loadReadiness, "ATTENTION");
  const unk = buildCoordinatedFieldMission(visit([u("A", "CREATED"), u("B", "CREATED")]), { A: { loadVerified: true } });
  assert.equal(unk.loadReadiness, "UNKNOWN");
});

test("overall progress + PARTIAL: 4 of 5 done and remaining ready ⇒ PARTIAL; 1 blocked ⇒ ATTENTION", () => {
  const sig = { A: { partsReadiness: "READY", loadVerified: true }, B: { partsReadiness: "READY", loadVerified: true }, C: { partsReadiness: "READY", loadVerified: true }, D: { partsReadiness: "READY", loadVerified: true }, E: { partsReadiness: "READY", loadVerified: true } };
  const partial = buildCoordinatedFieldMission(visit([u("A", "COMPLETED"), u("B", "COMPLETED"), u("C", "COMPLETED"), u("D", "COMPLETED"), u("E", "CREATED")]), sig);
  assert.deepEqual(partial.progress, { total: 5, completed: 4, blocked: 0 });
  assert.equal(partial.missionReadiness, "PARTIAL");
  const attn = buildCoordinatedFieldMission(visit([u("A", "COMPLETED"), u("B", "COMPLETED"), u("C", "COMPLETED"), u("D", "COMPLETED"), u("E", "BLOCKED")]), sig);
  assert.equal(attn.progress.blocked, 1);
  assert.equal(attn.missionReadiness, "ATTENTION");
});
