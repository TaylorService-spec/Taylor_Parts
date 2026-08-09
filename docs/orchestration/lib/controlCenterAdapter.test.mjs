import assert from "node:assert/strict";
import test from "node:test";
import {
  buildControlCenterPayload,
  checkPayloadCompatibility,
  CONTROL_CENTER_SCHEMA_VERSION,
  PRESERVED_DISTINCTIONS,
} from "./controlCenterAdapter.mjs";

const payload = () => buildControlCenterPayload({ commit: "abc1234", generatedAt: "2026-08-09T00:00:00Z" });

test("the payload carries every Owner view, unmodified", () => {
  const p = payload();
  for (const view of [
    "executiveRoadmap", "detailedRoadmap", "activeWork", "blocked",
    "ownerDecisions", "protected", "designBoard", "uxBoard",
  ]) {
    assert.ok(view in p.views, `${view} must reach the Control Center`);
  }
});

test("provenance travels with the data — a stale board must be detectable", () => {
  const p = payload();
  assert.equal(p.source.projectId, "taylor-parts");
  assert.equal(p.source.commit, "abc1234");
  assert.equal(p.source.generatedAt, "2026-08-09T00:00:00Z");
  assert.match(p.source.origin, /roadmapModel\.mjs$/, "must name the durable source, not a copy");
});

test("the distinctions the Owner requires are transmitted, not assumed", () => {
  const p = payload();
  for (const d of [
    "IMPLEMENTED != ACTIVATED",
    "MERGED != DEPLOYED",
    "BACKEND_COMPLETE != USER_OPERABLE",
    "UX_COMPLETE != BACKEND_ACTIVE",
    "PERSONA_FINDING != PRODUCT_DECISION",
  ]) {
    assert.ok(p.preservedDistinctions.includes(d), `${d} must survive the adapter`);
  }
  assert.deepEqual(p.preservedDistinctions, PRESERVED_DISTINCTIONS);
});

test("a consumer can tell whether it understands the payload", () => {
  const p = payload();
  assert.deepEqual(checkPayloadCompatibility(p, 1), { compatible: true, reason: null });
  assert.equal(checkPayloadCompatibility(p, 2).compatible, false);
  for (const bad of [null, undefined, 42, "x", {}, { schemaVersion: 7 }, { schemaVersion: "x.y" }]) {
    const r = checkPayloadCompatibility(bad, 1);
    assert.equal(r.compatible, false, `${JSON.stringify(bad)} must not be judged compatible`);
    assert.ok(r.reason, "an incompatible payload must say why");
  }
});

test("the adapter invents nothing — no percentage or synthesized progress", () => {
  // Inspect CODE only. The module deliberately discusses invented percentages in its
  // header, and matching prose would fail on the very comment that forbids them.
  const code = readSource()
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join(String.fromCharCode(10));
  assert.doesNotMatch(code, /\* *100|percent/i, "no invented completion maths in code");
});

test("it refuses to emit an invalid model rather than rendering a wrong board", () => {
  assert.throws(
    () => buildControlCenterPayload({ model: { capabilities: [{ id: "broken" }] } }),
    /refusing to emit an invalid roadmap model|Cannot read|invalid/i,
  );
});

test("the schema version is a real semver major a consumer can pin", () => {
  assert.match(CONTROL_CENTER_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});

import fs from "node:fs";
function readSource() {
  return fs.readFileSync(new URL("./controlCenterAdapter.mjs", import.meta.url), "utf8");
}
