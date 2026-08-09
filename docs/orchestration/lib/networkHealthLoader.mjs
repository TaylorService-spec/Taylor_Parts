// EOS Network Health Loader — thin runtime wrapper around the pure adapter.
//
// Reads the machine-local netwatch CSV (never committed to git) and returns the
// derived health. Separated from networkHealthAdapter.mjs so the adapter stays
// pure/testable; this file does fs + real-clock I/O and is used by the driver /
// the real-load proof, NOT by the deterministic roadmap snapshot generator.
//
// Default telemetry location (durable machine-local EOS runtime home):
//   %LOCALAPPDATA%\EOS\netwatch\netwatch-standalone.csv   (override: env EOS_NETWATCH_CSV)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { deriveNetworkHealth, summarizeLoggerHealth } from "./networkHealthAdapter.mjs";

export function defaultNetwatchCsvPath() {
  if (process.env.EOS_NETWATCH_CSV) return process.env.EOS_NETWATCH_CSV;
  const base = process.env.LOCALAPPDATA || join(process.env.HOME || process.env.USERPROFILE || ".", "AppData", "Local");
  return join(base, "EOS", "netwatch", "netwatch-standalone.csv");
}

// Read the supervisor's sanitized health file (Phase 5) and summarize logger supervision.
export function loadLoggerHealth({ csvPath = defaultNetwatchCsvPath(), nowMs = Date.now() } = {}) {
  const healthPath = join(dirname(csvPath), "netwatch-health.json");
  if (!existsSync(healthPath)) return summarizeLoggerHealth(null, nowMs);
  try { return summarizeLoggerHealth(JSON.parse(readFileSync(healthPath, "utf8")), nowMs); }
  catch { return summarizeLoggerHealth(null, nowMs); }
}

// Read telemetry and derive health. nowMs defaults to the real clock (runtime use).
export function loadNetworkHealth({ path = defaultNetwatchCsvPath(), nowMs = Date.now(), opts = {} } = {}) {
  if (!existsSync(path)) return { ...deriveNetworkHealth("", nowMs, opts), source: { path, present: false } };
  const csv = readFileSync(path, "utf8");
  return { ...deriveNetworkHealth(csv, nowMs, opts), source: { path, present: true } };
}

// Produce a SANITIZED, committable summary (derived health only — no raw rows, no
// machine-specific detail beyond aggregate counts). Safe for durable repo evidence (§13).
export function sanitizedTelemetrySummary(health, { label = "", asOf = null } = {}) {
  return {
    label,
    asOf, // caller supplies a fixed timestamp/anchor — never a live clock in committed evidence
    state: health.state,
    confidence: health.confidence,
    telemetryAvailable: health.telemetryAvailable,
    sampleAgeSec: health.sampleAgeSec,
    gatewayReachable: health.gatewayReachable,
    wanReachable: health.wanReachable,
    dnsHealthy: health.dnsHealthy,
    recentLatency: health.recentLatency,
    outageSamplesInWindow: health.outageSamplesInWindow,
    connectionCount: health.connectionCount,
    evidenceWindow: health.evidenceWindow,
    reasonCodes: health.reasonCodes,
  };
}

// CLI: `node networkHealthLoader.mjs` prints current derived health (no raw telemetry).
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith("networkHealthLoader.mjs"))) {
  const h = loadNetworkHealth();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(sanitizedTelemetrySummary(h, { label: "cli" }), null, 2));
}
