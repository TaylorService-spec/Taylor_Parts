// THE ENVELOPE, SHARED. One assembly, two runtimes.
//
// ============================ WHY THIS WAS EXTRACTED ============================
//
// WO-03 built the technician envelope. WO-05 needs the same envelope for warehouse work, and the
// alternative was a second copy of the assembly — which would have been thirty near-identical lines
// free to drift on the things that matter most: how identity is derived, whether credentials are
// refused, what state an intent is born in.
//
// So the ASSEMBLY is shared and the SEMANTICS are not. Each runtime brings its own closed list of
// types and its own idea of what an intent is *about*, because those genuinely differ:
//
//   technician   scope = a Work Order. A technician's work is Work Orders, always.
//   warehouse    scope = whatever the action concerns — a transfer, a cycle count, a receiving
//                source, a part at a location. There is no single spine, and pretending there was
//                one would mean inventing a fake work-order id for a put-away.
//
// ============================ WHAT IS DELIBERATELY NOT SHARED ============================
//
// Command semantics. Inventory operations have different concurrency, custody, quantity, serial,
// location and approval constraints from a technician's job, and a shared envelope must not be
// mistaken for shared behaviour. The bindings, the prechecks and the dependency rules are separate
// files per runtime for exactly that reason.
import { SYNC_STATE } from "../domain/technicianHandheld.js";
import { deriveIntentId, payloadFingerprint, containsForbiddenMaterial } from "./technicianIntent.js";

const isNonBlank = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Build an envelope factory for one runtime's closed type list.
 *
 * @param allowedTypes  the closed list. A type not on it is refused — this is never a generic
 *                      command queue, in either runtime.
 * @param scopeField    what the scope is CALLED on the resulting envelope, so each runtime's
 *                      vocabulary survives ("workOrderId", "scopeId") rather than being flattened
 *                      into a name that means nothing to either.
 * @param scopeRequired whether an intent must name a scope.
 */
export function createEnvelopeFactory({ allowedTypes, scopeField = "scopeId", scopeRequired = true }) {
  return function makeEnvelope({
    type, scope, principalUid, payload = null, captureKey,
    dependsOn = [], createdAtLocal = 0, deviceReportedAtMillis = null, describe = null,
    extra = null,
  } = {}) {
    if (!allowedTypes.includes(type)) return { valid: false, reason: "unknown_intent_type" };
    if (scopeRequired && !isNonBlank(scope)) return { valid: false, reason: "scope_required" };
    if (!isNonBlank(principalUid)) return { valid: false, reason: "principal_required" };
    if (!isNonBlank(captureKey)) return { valid: false, reason: "capture_key_required" };
    // Checked at capture rather than trusted by convention: the failure mode is a refresh token
    // sitting in IndexedDB on a phone somebody leaves in a warehouse.
    const forbidden = containsForbiddenMaterial(payload);
    if (forbidden) return { valid: false, reason: `forbidden_payload_key:${forbidden}` };
    const forbiddenExtra = containsForbiddenMaterial(extra);
    if (forbiddenExtra) return { valid: false, reason: `forbidden_payload_key:${forbiddenExtra}` };

    return {
      valid: true,
      value: Object.freeze({
        // DERIVED, never random. A retry, a reload and a crash-restore produce the same id, and that
        // id is what the server uses as its idempotency key.
        intentId: deriveIntentId({ type, workOrderId: scope ?? "", captureKey }),
        type,
        [scopeField]: scope ?? null,
        principalUid,
        payload,
        payloadFingerprint: payloadFingerprint(payload),
        // Frozen, so a later stage cannot quietly re-point a dependency it did not declare.
        dependsOn: Object.freeze(dependsOn.map((d) => Object.freeze({
          intentId: d.intentId, required: d.required !== false,
        }))),
        createdAtLocal,
        deviceReportedAtMillis,
        describe: isNonBlank(describe) ? describe : type,
        state: SYNC_STATE.PENDING_SYNC,
        attemptCount: 0,
        lastAttemptAt: null,
        nextEligibleAt: 0,
        lastServerError: null,
        resultingServerIds: null,
        // The business references a conflict card needs to show WHICH field changed, kept as
        // discrete values rather than folded into the payload blob — see the structured-object
        // standard. Absent for runtimes that carry none.
        ...(extra ? { references: Object.freeze({ ...extra }) } : {}),
      }),
    };
  };
}
