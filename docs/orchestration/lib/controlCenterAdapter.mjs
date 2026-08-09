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

import { roadmapModel, validateRoadmapModel } from "./roadmapModel.mjs";
import { projectAll } from "./roadmapProjection.mjs";

/**
 * Envelope schema version. Bump MAJOR only for a breaking shape change; a consumer
 * pins the major it understands.
 */
export const CONTROL_CENTER_SCHEMA_VERSION = "1.0.0";

/** The distinctions the Owner requires the Control Center to preserve, never collapse. */
export const PRESERVED_DISTINCTIONS = Object.freeze([
  "IMPLEMENTED != ACTIVATED",
  "MERGED != DEPLOYED",
  "BACKEND_COMPLETE != USER_OPERABLE",
  "UX_COMPLETE != BACKEND_ACTIVE",
  "PERSONA_FINDING != PRODUCT_DECISION",
]);

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
} = {}) {
  // Fail closed: never hand a renderer a model this repo would not accept itself.
  const validation = validateRoadmapModel(model);
  const errors = Array.isArray(validation) ? validation : validation?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`controlCenterAdapter: refusing to emit an invalid roadmap model (${errors.length} error(s))`);
  }

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
    views: projectAll(model),
  };
}

/**
 * Consumer-side guard, exported so keystone uses THIS repo's definition of
 * compatibility rather than reimplementing it.
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
