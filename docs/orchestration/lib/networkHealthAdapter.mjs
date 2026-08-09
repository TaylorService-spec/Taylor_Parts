// EOS Network Health Adapter (Phase 4) — READ-ONLY over the standalone netwatch logger.
//
// The logger (netwatch.ps1) runs independently of Claude sessions and appends
// samples to netwatch-standalone.csv. This adapter ONLY READS recent samples and
// derives a deterministic health result that maps into the EXISTING Phase-3
// network states (networkState.mjs: NORMAL / NETWORK_PRESSURE / NETWORK_UNAVAILABLE
// / RECOVERY). It NEVER controls, rewrites, or restarts the logger, and it does
// not create a second network state machine.
//
// Logger CSV contract (discovered 2026-08-09 from the live environment):
//   header: ts,gw_ms,wan1_ms,wan2_ms,dns,tcp_conns
//   ts       = 'yyyy-MM-dd HH:mm:ss' local time
//   gw_ms    = gateway (192.168.0.1) ping ms, or 'FAIL'
//   wan1_ms  = 1.1.1.1 ping ms, or 'FAIL'
//   wan2_ms  = 8.8.8.8 ping ms, or 'FAIL'
//   dns      = 'ok' | 'FAIL' (nslookup github.com via 1.1.1.1)
//   tcp_conns= established TCP connection count
//   interval = 5s
//
// PHASE 4A DISCIPLINE: states derive from OBVIOUS FACTS ONLY (reachability, DNS,
// telemetry staleness). Latency values are reported but NOT thresholded — real
// NETWORK_PRESSURE latency thresholds are gathered under controlled load first,
// then proposed/ratified with evidence. No speculative causation is asserted.

export const HEALTH_STATES = Object.freeze(["NORMAL", "NETWORK_PRESSURE", "NETWORK_UNAVAILABLE"]);
export const REASON_CODES = Object.freeze([
  "ALL_HEALTHY", "GATEWAY_UNREACHABLE", "WAN_DOWN", "WAN_PARTIAL", "DNS_FAIL", "TELEMETRY_STALE", "NO_TELEMETRY",
]);

const DEFAULTS = Object.freeze({ intervalSec: 5, staleAfterSec: 60, windowSamples: 12 });

// Parse 'yyyy-MM-dd HH:mm:ss' (local) to epoch ms. Returns NaN on failure.
function parseTs(ts) {
  if (!ts) return NaN;
  return Date.parse(ts.trim().replace(" ", "T"));
}
const numOrNull = (v) => (v === "FAIL" || v == null || v === "" ? null : Number(v));

export function parseNetwatchCsv(csvText) {
  const rows = [];
  for (const line of String(csvText || "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("ts,")) continue; // skip blank + header
    const [ts, gw, w1, w2, dns, conns] = s.split(",");
    if (!ts) continue;
    rows.push({
      ts, tsMs: parseTs(ts),
      gwFail: gw === "FAIL", wan1Fail: w1 === "FAIL", wan2Fail: w2 === "FAIL",
      gwMs: numOrNull(gw), wan1Ms: numOrNull(w1), wan2Ms: numOrNull(w2),
      dnsHealthy: dns === "ok", conns: numOrNull(conns),
    });
  }
  return rows;
}

function avg(nums) {
  const xs = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
}

/**
 * Derive deterministic network health from netwatch CSV text.
 * @param {string} csvText
 * @param {number} nowMs  current epoch ms (injected — no wall clock here)
 * @param {object} [opts] {intervalSec, staleAfterSec, windowSamples}
 */
export function deriveNetworkHealth(csvText, nowMs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rows = parseNetwatchCsv(csvText);

  if (rows.length === 0) {
    // Conservative default: no signal ⇒ throttle NEW heavy work, do not halt (Phase 4A).
    return {
      state: "NETWORK_PRESSURE", confidence: "LOW", telemetryAvailable: false,
      sampleAgeSec: null, gatewayReachable: null, wanReachable: null, dnsHealthy: null,
      recentLatency: null, outageSamplesInWindow: 0, connectionCount: null,
      evidenceWindow: { samples: 0, fromTs: null, toTs: null }, reasonCodes: ["NO_TELEMETRY"],
    };
  }

  const window = rows.slice(-o.windowSamples);
  const last = rows[rows.length - 1];
  const sampleAgeSec = Number.isNaN(last.tsMs) ? null : Math.max(0, Math.round((nowMs - last.tsMs) / 1000));
  const stale = sampleAgeSec == null || sampleAgeSec > o.staleAfterSec;

  const gatewayReachable = !last.gwFail;
  const wanReachable = !(last.wan1Fail && last.wan2Fail);
  const wanPartial = last.wan1Fail !== last.wan2Fail; // exactly one WAN down
  const dnsHealthy = last.dnsHealthy;
  const outageSamplesInWindow = window.filter((r) => r.gwFail || (r.wan1Fail && r.wan2Fail) || !r.dnsHealthy).length;

  const reasonCodes = [];
  let state;
  if (stale) {
    // Telemetry too old to confirm health ⇒ throttle (PRESSURE), never halt on staleness alone.
    state = "NETWORK_PRESSURE"; reasonCodes.push("TELEMETRY_STALE");
  } else if (!gatewayReachable) {
    state = "NETWORK_UNAVAILABLE"; reasonCodes.push("GATEWAY_UNREACHABLE");
  } else if (!wanReachable) {
    state = "NETWORK_UNAVAILABLE"; reasonCodes.push("WAN_DOWN");
  } else if (wanPartial || !dnsHealthy) {
    state = "NETWORK_PRESSURE";
    if (wanPartial) reasonCodes.push("WAN_PARTIAL");
    if (!dnsHealthy) reasonCodes.push("DNS_FAIL");
  } else {
    state = "NORMAL"; reasonCodes.push("ALL_HEALTHY");
  }

  return {
    state, confidence: stale ? "LOW" : "HIGH", telemetryAvailable: true,
    sampleAgeSec, gatewayReachable, wanReachable, dnsHealthy,
    // Latencies are REPORTED for correlation, never used to change state in Phase 4A.
    recentLatency: { gatewayMsAvg: avg(window.map((r) => r.gwMs)), wan1MsAvg: avg(window.map((r) => r.wan1Ms)), wan2MsAvg: avg(window.map((r) => r.wan2Ms)) },
    outageSamplesInWindow, connectionCount: last.conns,
    evidenceWindow: { samples: window.length, fromTs: window[0].ts, toTs: last.ts },
    reasonCodes,
  };
}

// Compose the instantaneous adapter health with the EXISTING Phase-3 network state
// machine so RECOVERY (a temporal, stability-window concept) is reused, not reinvented.
// previousState: last governor network state; instantaneous: deriveNetworkHealth().state.
export function reconcileNetworkState(previousState, instantaneous, { stabilityElapsed = false } = {}) {
  if (instantaneous === "NETWORK_UNAVAILABLE") return "NETWORK_UNAVAILABLE";
  // Recovering from an outage: hold in RECOVERY until a stability window elapses.
  if (previousState === "NETWORK_UNAVAILABLE") return stabilityElapsed ? instantaneous : "RECOVERY";
  if (previousState === "RECOVERY") return stabilityElapsed ? instantaneous : "RECOVERY";
  return instantaneous; // NORMAL <-> NETWORK_PRESSURE follow telemetry directly
}
