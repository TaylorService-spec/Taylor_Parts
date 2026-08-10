// The Control Center ENVELOPE CONTRACT — deliberately dependency-free.
//
// Split out of controlCenterAdapter.mjs on consumer evidence. The adapter imports the
// roadmap model and its projections, which a consuming repository does not have and
// must never need: project-keystone vendors the compatibility rule so it applies THIS
// repository's definition rather than reimplementing it, and vendoring the full adapter
// dragged in modules that do not exist over there. The browser then failed to load the
// check and rendered every project as incompatible — a compatibility mechanism that
// fails closed against itself.
//
// So the contract lives here, importing nothing. The adapter re-exports it, so there is
// still exactly ONE definition; only its packaging changed.

/**
 * Envelope schema version. Bump MAJOR only for a breaking shape change; a consumer
 * pins the major it understands.
 */
export const CONTROL_CENTER_SCHEMA_VERSION = "1.2.0"; // 1.2: additive `cockpit` rollup (systemHealth/needsYou/workSupply/autonomy/operability/sinceLastVisit + honest aiGovernance/customerOutcome gaps); still major 1

/** The distinctions the Control Center must never collapse into a single "progress" idea. */
export const PRESERVED_DISTINCTIONS = Object.freeze([
  "IMPLEMENTED != ACTIVATED",
  "MERGED != DEPLOYED",
  "BACKEND_COMPLETE != USER_OPERABLE",
  "UX_COMPLETE != BACKEND_ACTIVE",
  "PERSONA_FINDING != PRODUCT_DECISION",
]);

/**
 * Whether a consumer that understands major version `expectedMajor` may render this
 * payload. Exported for consumers so compatibility is decided once, here.
 *
 * @returns {{compatible: boolean, reason: string|null}}
 */
export function checkPayloadCompatibility(payload, expectedMajor = 1) {
  if (!payload || typeof payload !== "object") {
    return { compatible: false, reason: "payload is not an object" };
  }
  const version = payload.schemaVersion;
  if (typeof version !== "string") {
    return { compatible: false, reason: "payload carries no schemaVersion" };
  }
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major)) {
    return { compatible: false, reason: `unparseable schemaVersion "${version}"` };
  }
  if (major !== expectedMajor) {
    return { compatible: false, reason: `schemaVersion ${version} is not major ${expectedMajor}` };
  }
  return { compatible: true, reason: null };
}

/** Freshness states a hosted (or local) Control Center must distinguish — a board that loaded
 * successfully is NOT thereby CURRENT. Dependency-free so keystone vendors the rule (decided once). */
export const FRESHNESS_STATES = Object.freeze(["CURRENT", "STALE", "UNKNOWN", "INCOMPATIBLE", "NOT_AUTHORIZED"]);

/**
 * Decide whether a payload's displayed state is CURRENT / STALE / UNKNOWN / INCOMPATIBLE.
 * Never infers CURRENT merely because a payload exists: it must be compatible, carry a parseable
 * generatedAt within the window, and (if a latest known publish is provided) match its commit.
 *
 * @param {object} payload            the Control Center envelope
 * @param {number} nowMs              current epoch ms (injected — pure)
 * @param {object} [opts]
 * @param {number} [opts.freshWindowMs] max age before STALE (default 24h)
 * @param {string} [opts.latestKnownCommit] the newest governed-publish commit, if known
 * @param {number} [opts.expectedMajor] schema major the consumer understands (default 1)
 * @param {boolean} [opts.authorized] whether the viewer is authorized to read the envelope.
 *   Pass false when the gated fetch returned 401/403 or the session/auth expired. Takes
 *   precedence over everything: you cannot judge the freshness of data you may not see, and
 *   an auth failure must NEVER be shown as STALE/UNKNOWN (that would mask a NOT_AUTHORIZED
 *   condition as merely old data). Distinct from host-unreachable, which the launcher handles.
 * @returns {{state:string, reason:string|null, ageMs:number|null}}
 */
export function freshnessState(payload, nowMs, { freshWindowMs = 24 * 60 * 60 * 1000, latestKnownCommit = null, expectedMajor = 1, authorized = true } = {}) {
  if (authorized === false) return { state: "NOT_AUTHORIZED", reason: "viewer is not authorized to read this envelope (or the session expired)", ageMs: null };
  const compat = checkPayloadCompatibility(payload, expectedMajor);
  if (!compat.compatible) return { state: "INCOMPATIBLE", reason: compat.reason, ageMs: null };
  const generatedAt = payload.source && payload.source.generatedAt;
  const genMs = typeof generatedAt === "string" ? Date.parse(generatedAt) : NaN;
  if (!Number.isFinite(genMs)) return { state: "UNKNOWN", reason: "no parseable generatedAt", ageMs: null };
  const ageMs = nowMs - genMs;
  if (latestKnownCommit && payload.source && payload.source.commit && payload.source.commit !== latestKnownCommit) {
    return { state: "STALE", reason: `envelope commit ${payload.source.commit} is behind ${latestKnownCommit}`, ageMs };
  }
  if (ageMs > freshWindowMs) return { state: "STALE", reason: `generated ${Math.round(ageMs / 3.6e6)}h ago (> window)`, ageMs };
  if (ageMs < 0) return { state: "UNKNOWN", reason: "generatedAt is in the future", ageMs };
  return { state: "CURRENT", reason: null, ageMs };
}
