import assert from "node:assert/strict";
import test from "node:test";
import {
  buildControlCenterPayload,
  checkPayloadCompatibility,
  CONTROL_CENTER_SCHEMA_VERSION,
  PRESERVED_DISTINCTIONS,
  freshnessState,
  FRESHNESS_STATES,
} from "./controlCenterAdapter.mjs";

test("freshness never infers CURRENT from a payload merely existing", () => {
  const NOW = Date.parse("2026-08-10T00:00:00Z");
  assert.deepEqual([...FRESHNESS_STATES], ["CURRENT", "STALE", "UNKNOWN", "INCOMPATIBLE", "NOT_AUTHORIZED"]);
  // an unauthorized viewer -> NOT_AUTHORIZED, never STALE/UNKNOWN (auth failure isn't old data)
  assert.equal(freshnessState({ schemaVersion: "1.1.0", source: { generatedAt: "2026-08-10T00:00:00Z", commit: "a" } }, NOW, { authorized: false }).state, "NOT_AUTHORIZED");
  // incompatible payload -> INCOMPATIBLE (never rendered as understood)
  assert.equal(freshnessState({ schemaVersion: "9.0.0" }, NOW).state, "INCOMPATIBLE");
  // no generatedAt -> UNKNOWN (not guessed)
  assert.equal(freshnessState({ schemaVersion: "1.1.0", source: {} }, NOW).state, "UNKNOWN");
  // fresh -> CURRENT
  assert.equal(freshnessState({ schemaVersion: "1.1.0", source: { generatedAt: "2026-08-10T00:00:00Z", commit: "a" } }, NOW).state, "CURRENT");
  // old -> STALE (announces staleness rather than passing as current)
  assert.equal(freshnessState({ schemaVersion: "1.1.0", source: { generatedAt: "2026-08-01T00:00:00Z" } }, NOW).state, "STALE");
  // a newer known publish commit -> STALE even if recent
  assert.equal(freshnessState({ schemaVersion: "1.1.0", source: { generatedAt: "2026-08-10T00:00:00Z", commit: "old" } }, NOW, { latestKnownCommit: "new" }).state, "STALE");
});

// autoLoad:false so the UNKNOWN-without-injected-data tests are deterministic (the real
// generation path — import-envelope — uses the default autoLoad:true to self-load).
const payload = () => buildControlCenterPayload({ commit: "abc1234", generatedAt: "2026-08-09T00:00:00Z", autoLoad: false });

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

test("§Agent Operations: UNKNOWN without a ledger; built from an injected ledger, never fabricated", () => {
  assert.equal(payload().agentOperations.available, false); // no ledger -> honest unavailable
  const p = buildControlCenterPayload({
    commit: "c", generatedAt: "t", ownerRelayCount: 0,
    ledger: {
      requests: [{ requestId: "R1", requestedByWorkstream: "UX", mode: "PERSONA", purpose: "x", status: "COMPLETE" }],
      results: [{ resultId: "R1-r", requestId: "R1", routedBackTo: "UX", status: "COMPLETE", findings: ["a"] }],
    },
  });
  assert.ok(p.agentOperations.metrics, "agent ops built from the ledger");
  assert.equal(p.agentOperations.ownerRelayCount, 0);
  assert.equal(p.agentOperations.metrics.acceptedFindings, 1);
});

test("§Network Health: UNKNOWN without a summary; sanitized-only when injected (no raw telemetry)", () => {
  assert.equal(payload().networkHealth.available, false);
  const p = buildControlCenterPayload({
    commit: "c", generatedAt: "t",
    networkHealth: { state: "NORMAL", confidence: "HIGH", reasonCodes: ["ALL_HEALTHY"], connectionCount: 40, asOf: "2026-08-09" },
  });
  assert.equal(p.networkHealth.state, "NORMAL");
  assert.equal(p.networkHealth.connectionCount, 40);
  assert.ok(!/tcp_conns|,ok,|wan2_ms/.test(JSON.stringify(p.networkHealth)), "no raw CSV shape leaks");
});

test("§Recent Progress: DONE items with PR evidence, ordered by PR number, no invented timeline", () => {
  const rp = payload().recentProgress;
  assert.ok(rp.length > 0, "there is recorded progress");
  for (let i = 1; i < rp.length; i++) assert.ok(rp[i - 1].latestPr >= rp[i].latestPr, "ordered by latest PR desc");
  assert.ok(rp.every((x) => x.prs && x.prs.length > 0), "every entry cites PR evidence (none dated from nothing)");
});

test("§UX board now carries the registered UX workstream (gap 4 closed)", () => {
  const ux = payload().views.uxBoard;
  assert.ok(ux.length >= 3, "UX-1 / UX-2 / UX-3 (+ invalid-date) projected into uxBoard");
  assert.ok(ux.some((r) => /Coordinated Visits/.test(r.name)), "UX-2 present");
  assert.ok(ux.some((r) => r.status === "OWNER_DECISION"), "UX-3 grain stays an Owner decision, not flattened");
});

test("the additive schema is 1.1 and still major-1 compatible for a pinned consumer", () => {
  assert.equal(payload().schemaVersion, "1.1.0");
  assert.equal(checkPayloadCompatibility(payload(), 1).compatible, true);
});

import fs from "node:fs";
function readSource() {
  return fs.readFileSync(new URL("./controlCenterAdapter.mjs", import.meta.url), "utf8");
}
