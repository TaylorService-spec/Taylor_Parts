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
export const CONTROL_CENTER_SCHEMA_VERSION = "1.0.0";

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
