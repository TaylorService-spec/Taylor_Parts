// publishControlCenterEnvelope.mjs
// ---------------------------------------------------------------------------
// Model-A governed publish tooling for the Owner Control Center (repo-safe).
//
// Owner (2026-08-09) ratified security-gating MODEL A: a static Hosting shell
// reads the board's DATA from a gated Firestore doc — NEVER a public static
// file. This module is the "governed publish" step of §9/§11 of
// owner-control-center-hosting-design.md:
//
//   import-envelope (build envelope from the project's adapter)
//     -> write { envelope, publish record } to  control_center_envelopes/{projectId}
//
// SAFETY / BOUNDARY:
//   * Pure by default. planPublish() computes WHAT would be written and returns
//     it; it performs no I/O. publishEnvelope() is DRY-RUN unless {execute:true}
//     AND a Firestore handle is injected — so importing or running this file
//     never touches production.
//   * No firebase-admin import here. The Admin Firestore handle is dependency-
//     injected by the operator's runner (Admin SDK bypasses Rules by design —
//     the same reason the Rules read-gate is client-facing only). This keeps the
//     module credential-free and unit-testable.
//   * This module NEVER creates a Hosting site, deploys Rules, deploys anything,
//     grants a capability, or mutates roadmap authority. Those remain Owner/
//     operator-gated actions executed with credentials the operator supplies.
//   * The envelope is the ONLY thing published. It already excludes raw
//     telemetry, credentials, secrets, and local filesystem paths (§19).
// ---------------------------------------------------------------------------

import { buildControlCenterPayload } from "./controlCenterAdapter.mjs";

export const ENVELOPE_COLLECTION = "control_center_envelopes";

/**
 * Compute the exact documents a governed publish would write — no I/O.
 *
 * @param {object}  opts
 * @param {string}  opts.projectId    e.g. "taylor-parts" (the Firestore doc id)
 * @param {string}  opts.commit       the governed commit the envelope was built from (required)
 * @param {string}  opts.generatedAt  ISO timestamp the envelope was built (required; caller supplies for purity)
 * @param {string}  opts.publishedAt  ISO timestamp of this publish (required; caller supplies for purity)
 * @param {object}  [opts.payload]    a prebuilt envelope; when omitted it is built via the adapter
 * @param {object}  [opts.buildOptions] passed to buildControlCenterPayload when payload is omitted
 * @returns {{ collection, docId, envelope, publishRecord }}
 */
export function planPublish({ projectId, commit, generatedAt, publishedAt, payload = null, buildOptions = {} } = {}) {
  if (!projectId) throw new Error("planPublish: projectId is required (it is the Firestore doc id)");
  if (!commit) throw new Error("planPublish: commit is required — a publish with no provenance is not governed");
  if (!generatedAt) throw new Error("planPublish: generatedAt is required (envelope build time)");
  if (!publishedAt) throw new Error("planPublish: publishedAt is required (this publish's time)");

  const envelope = payload || buildControlCenterPayload({ commit, generatedAt, ...buildOptions });

  // A publish is only governed if the envelope's own provenance matches the
  // commit/time we claim to be publishing. Fail closed rather than publish a
  // mislabelled board.
  const src = envelope?.source || {};
  if (src.commit && commit && src.commit !== commit) {
    throw new Error(`planPublish: envelope.source.commit (${src.commit}) != declared commit (${commit})`);
  }

  const publishRecord = {
    projectId,
    commit,
    generatedAt,
    publishedAt,
    schemaVersion: envelope?.schemaVersion ?? null,
  };

  return { collection: ENVELOPE_COLLECTION, docId: projectId, envelope, publishRecord };
}

/**
 * Governed publish. DRY-RUN by default: returns the plan and writes nothing.
 * Only writes when {execute:true} and a Firestore handle is injected.
 *
 * @param {object}   opts               all planPublish opts, plus:
 * @param {boolean}  [opts.execute]     must be explicitly true to write
 * @param {object}   [opts.firestore]   an Admin Firestore instance (getFirestore()); required to execute
 * @returns {Promise<{ dryRun, wrote, collection, docId, publishRecord, envelope }>}
 */
export async function publishEnvelope(opts = {}) {
  const { execute = false, firestore = null } = opts;
  const plan = planPublish(opts);

  if (!execute || !firestore) {
    return { dryRun: true, wrote: false, ...plan };
  }

  // Single document per project (Option A): the envelope + its publish record.
  // Client reads are gated by the Firestore Rule (read: authorized Owner uid);
  // this write uses the Admin SDK, which bypasses Rules by design.
  await firestore
    .collection(plan.collection)
    .doc(plan.docId)
    .set({ envelope: plan.envelope, publish: plan.publishRecord }, { merge: false });

  return { dryRun: false, wrote: true, ...plan };
}
