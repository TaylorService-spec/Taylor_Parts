// Tests for the EOS Network Health Adapter (Phase 4A). Deterministic: synthetic
// netwatch CSV + injected nowMs. Proves states derive from OBVIOUS FACTS only —
// no speculative latency thresholds. Run:
//   node --test docs/orchestration/lib/networkHealthAdapter.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveNetworkHealth, reconcileNetworkState, parseNetwatchCsv, HEALTH_STATES } from "./networkHealthAdapter.mjs";

const HEADER = "ts,gw_ms,wan1_ms,wan2_ms,dns,tcp_conns";
// Build a CSV of N rows ending at a base time, each 5s apart, with a shaper(row_index)->fields.
function csv(rows) { return [HEADER, ...rows].join("\n") + "\n"; }
const at = (ts, gw, w1, w2, dns, c) => `${ts},${gw},${w1},${w2},${dns},${c}`;
const NOW = Date.parse("2026-08-09T16:03:30");
const fresh = "2026-08-09 16:03:27"; // 3s before NOW

test("all healthy + fresh → NORMAL / ALL_HEALTHY / HIGH confidence", () => {
  const h = deriveNetworkHealth(csv([at(fresh, 1, 12, 22, "ok", 44)]), NOW);
  assert.equal(h.state, "NORMAL");
  assert.deepEqual(h.reasonCodes, ["ALL_HEALTHY"]);
  assert.equal(h.confidence, "HIGH");
  assert.equal(h.gatewayReachable, true);
  assert.equal(h.wanReachable, true);
  assert.equal(h.connectionCount, 44);
});

test("gateway FAIL → NETWORK_UNAVAILABLE / GATEWAY_UNREACHABLE (local link down)", () => {
  const h = deriveNetworkHealth(csv([at(fresh, "FAIL", "FAIL", "FAIL", "FAIL", 5)]), NOW);
  assert.equal(h.state, "NETWORK_UNAVAILABLE");
  assert.ok(h.reasonCodes.includes("GATEWAY_UNREACHABLE"));
});

test("gateway ok but BOTH WAN FAIL → NETWORK_UNAVAILABLE / WAN_DOWN", () => {
  const h = deriveNetworkHealth(csv([at(fresh, 1, "FAIL", "FAIL", "ok", 40)]), NOW);
  assert.equal(h.state, "NETWORK_UNAVAILABLE");
  assert.ok(h.reasonCodes.includes("WAN_DOWN"));
});

test("one WAN FAIL → NETWORK_PRESSURE / WAN_PARTIAL (partial, not down)", () => {
  const h = deriveNetworkHealth(csv([at(fresh, 1, 12, "FAIL", "ok", 40)]), NOW);
  assert.equal(h.state, "NETWORK_PRESSURE");
  assert.ok(h.reasonCodes.includes("WAN_PARTIAL"));
  assert.equal(h.wanReachable, true); // one WAN still up
});

test("DNS FAIL (WAN up) → NETWORK_PRESSURE / DNS_FAIL", () => {
  const h = deriveNetworkHealth(csv([at(fresh, 1, 12, 22, "FAIL", 40)]), NOW);
  assert.equal(h.state, "NETWORK_PRESSURE");
  assert.ok(h.reasonCodes.includes("DNS_FAIL"));
});

test("NO speculative thresholds: high latency but all reachable stays NORMAL", () => {
  const h = deriveNetworkHealth(csv([at(fresh, 9, 480, 505, "ok", 60)]), NOW);
  assert.equal(h.state, "NORMAL"); // latency reported, never used to change state in Phase 4A
  assert.equal(h.recentLatency.wan1MsAvg, 480);
});

test("stale telemetry → NETWORK_PRESSURE / TELEMETRY_STALE / LOW confidence — never halts on staleness alone", () => {
  const old = "2026-08-09 15:00:00"; // ~63 min old vs NOW
  const h = deriveNetworkHealth(csv([at(old, 1, 12, 22, "ok", 40)]), NOW);
  assert.equal(h.state, "NETWORK_PRESSURE");
  assert.ok(h.reasonCodes.includes("TELEMETRY_STALE"));
  assert.equal(h.confidence, "LOW");
  assert.notEqual(h.state, "NETWORK_UNAVAILABLE"); // stale != unavailable
});

test("no telemetry at all → NETWORK_PRESSURE / NO_TELEMETRY (conservative default, not a halt)", () => {
  const h = deriveNetworkHealth(HEADER + "\n", NOW);
  assert.equal(h.state, "NETWORK_PRESSURE");
  assert.deepEqual(h.reasonCodes, ["NO_TELEMETRY"]);
  assert.equal(h.telemetryAvailable, false);
});

test("outage samples in window are counted", () => {
  const rows = [at("2026-08-09 16:03:07", 1, 12, 22, "ok", 40), at("2026-08-09 16:03:12", "FAIL", "FAIL", "FAIL", "FAIL", 3), at(fresh, 1, 12, 22, "ok", 40)];
  const h = deriveNetworkHealth(csv(rows), NOW);
  assert.equal(h.state, "NORMAL"); // current is healthy
  assert.equal(h.outageSamplesInWindow, 1); // but the blip is recorded
});

test("reconcileNetworkState reuses Phase-3 RECOVERY (stability window), no new machine", () => {
  // Outage persists.
  assert.equal(reconcileNetworkState("NORMAL", "NETWORK_UNAVAILABLE"), "NETWORK_UNAVAILABLE");
  // Came back but must hold in RECOVERY until stability elapses.
  assert.equal(reconcileNetworkState("NETWORK_UNAVAILABLE", "NORMAL", { stabilityElapsed: false }), "RECOVERY");
  assert.equal(reconcileNetworkState("RECOVERY", "NORMAL", { stabilityElapsed: false }), "RECOVERY");
  // Stability window elapsed → resume telemetry-driven state.
  assert.equal(reconcileNetworkState("RECOVERY", "NORMAL", { stabilityElapsed: true }), "NORMAL");
});

test("adapter states are a subset of the Phase-3 governor states (no new instantaneous state)", () => {
  assert.deepEqual([...HEALTH_STATES], ["NORMAL", "NETWORK_PRESSURE", "NETWORK_UNAVAILABLE"]);
  assert.equal(parseNetwatchCsv(csv([at(fresh, 1, 2, 3, "ok", 9)])).length, 1);
});
