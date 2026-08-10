// EOS → Owner Control Center ADAPTER.
//
// Owner placement decision (2026-08-09): the reusable Control Center UI lives in
// project-keystone; the DATA stays here. This module is the seam between them, and
// the only thing keystone is allowed to depend on.
//
// It is a projection, NOT a second roadmap. Everything below is derived from
// roadmapModel.mjs — the durable machine-readable state — via the existing pure
// views in roadmapProjection.mjs. Nothing is computed here that the model does not
// already assert, and no percentage is invented: the model's own rule is that if it
// and a cited repository artifact disagree, the repository wins.
//
// WHY AN ENVELOPE. keystone is a separate repository on its own release cadence, and
// is intended to serve more than one company/project later. A bare JSON dump would
// couple its renderer to this repo's internal shape, so every payload carries a
// declared `schemaVersion` and a `source` block. A consumer that does not recognise
// the version must say so rather than render a shape it does not understand — the
// same honesty rule the product UI follows for UNKNOWN.
//
// MULTI-PROJECT WITHOUT MULTI-TENANCY. `source.projectId` identifies whose data this
// is. That is the entire provision for future adapters: another project ships its own
// adapter emitting the same envelope. No tenant registry, no routing, no shared
// infrastructure is created here, because none is needed to render one project today.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { roadmapModel, validateRoadmapModel } from "./roadmapModel.mjs";
// The contract is dependency-free and lives in its own module so a consumer can
// vendor it without dragging the roadmap model along -- see controlCenterContract.mjs.
import { CONTROL_CENTER_SCHEMA_VERSION, PRESERVED_DISTINCTIONS, checkPayloadCompatibility, freshnessState, FRESHNESS_STATES } from "./controlCenterContract.mjs";
import { projectAll, projectAgentOperations, projectRecentProgress } from "./roadmapProjection.mjs";

// Auto-load the PROJECT's own durable state (the agent-request ledger + the sanitized
// telemetry summary) that sit next to this module, so a plain buildControlCenterPayload()
// -- the call keystone's import-envelope.mjs makes -- carries Agent Operations and Network
// Health from real data. Reads only THIS repository's files, relative to this module; if
// they are not reachable (e.g. the module is vendored elsewhere) it returns nulls and the
// sections fail closed to honest UNKNOWN. Never reads raw telemetry (only the sanitized
// summary the repo already commits). Tests pass autoLoad:false for determinism.
function loadDurableState() {
  try {
    const ledgerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "agent-requests");
    if (!existsSync(ledgerDir)) return { ledger: null, networkHealth: null };
    const requests = [], results = [];
    let networkHealth = null;
    for (const f of readdirSync(ledgerDir).filter((n) => n.endsWith(".json")).sort()) {
      const obj = JSON.parse(readFileSync(join(ledgerDir, f), "utf8"));
      if (f.endsWith(".request.json")) requests.push(obj);
      else if (f.endsWith(".result.json")) results.push(obj);
      else if (f === "telemetry-summary.json") networkHealth = obj;
    }
    return { ledger: { requests, results }, networkHealth };
  } catch {
    return { ledger: null, networkHealth: null }; // fail closed to UNKNOWN, never a fabricated section
  }
}

/**
 * Build the Control Center payload.
 *
 * @param {object} [options]
 * @param {object} [options.model]      durable roadmap model (defaults to the committed one)
 * @param {string} [options.projectId]  which project's data this is
 * @param {string} [options.commit]     repository commit the payload was generated from
 * @param {string} [options.generatedAt] ISO timestamp; caller supplies it so this stays pure
 * @returns {object} the versioned envelope
 */
export function buildControlCenterPayload({
  model = roadmapModel,
  projectId = "taylor-parts",
  commit = null,
  generatedAt = null,
  // Injected durable state so the adapter stays pure (no I/O): the generator/consumer
  // loads these from the committed ledger + sanitized telemetry summary and passes them in.
  ledger = null, // { requests: [...], results: [...] } from docs/orchestration/agent-requests/
  networkHealth = null, // sanitized telemetry summary (telemetry-summary.json) — never raw
  ownerRelayCount = 0,
  autoLoad = true, // load the project's durable ledger/telemetry when not injected (import-envelope path)
} = {}) {
  // Fill from the project's own durable files unless explicitly injected (tests inject).
  if (autoLoad && (ledger === null || networkHealth === null)) {
    const durable = loadDurableState();
    if (ledger === null) ledger = durable.ledger;
    if (networkHealth === null) networkHealth = durable.networkHealth;
  }
  // Fail closed: never hand a renderer a model this repo would not accept itself.
  const validation = validateRoadmapModel(model);
  const errors = Array.isArray(validation) ? validation : validation?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`controlCenterAdapter: refusing to emit an invalid roadmap model (${errors.length} error(s))`);
  }

  // Honest UNKNOWN when a source is not provided — a Control Center section built on
  // absent evidence must say so, never fabricate metrics.
  const unavailable = (reason) => ({ available: false, reason });

  return {
    schemaVersion: CONTROL_CENTER_SCHEMA_VERSION,
    source: {
      projectId,
      // Provenance is part of the contract: a Control Center showing stale state is
      // worse than one showing none, and the viewer must be able to tell which build
      // produced this.
      commit,
      generatedAt,
      origin: "docs/orchestration/lib/roadmapModel.mjs",
    },
    preservedDistinctions: PRESERVED_DISTINCTIONS,
    // The existing eight read-only views, unmodified. keystone renders; it does not
    // recompute status, and it must not derive progress the model has not asserted.
    // (uxBoard now populates from the model's UX / Experience domain.)
    views: projectAll(model),
    // §Agent Operations — from the durable agent-request/result ledger via the existing
    // pure projection. Fail-closed UNKNOWN when no ledger is injected; nothing fabricated.
    agentOperations: ledger
      ? projectAgentOperations(ledger.requests || [], ledger.results || [], { networkHealth, ownerRelayCount })
      : unavailable("no agent-request ledger provided"),
    // §Network Health — sanitized orchestration-relevant state ONLY (no raw telemetry,
    // no household traffic). UNKNOWN when no sanitized summary is provided.
    networkHealth: networkHealth
      ? {
          state: networkHealth.state ?? "UNKNOWN",
          confidence: networkHealth.confidence ?? "UNKNOWN",
          telemetryAvailable: networkHealth.telemetryAvailable ?? null,
          sampleAgeSec: networkHealth.sampleAgeSec ?? null,
          reasonCodes: networkHealth.reasonCodes || [],
          recentLatency: networkHealth.recentLatency || null,
          connectionCount: networkHealth.connectionCount ?? null,
          asOf: networkHealth.asOf || null,
          loggerHealth: networkHealth.loggerHealth || null, // supervisor/logger health when supplied
        }
      : unavailable("no sanitized telemetry summary provided"),
    // §Recent Progress — derived only from the model's own DONE + PR evidence (trustworthy
    // sequence), never a git-history dump and never a fabricated timeline.
    recentProgress: projectRecentProgress(model),
  };
}

// One definition, re-exported so existing importers of the adapter are unaffected.
export { CONTROL_CENTER_SCHEMA_VERSION, PRESERVED_DISTINCTIONS, checkPayloadCompatibility, freshnessState, FRESHNESS_STATES };
