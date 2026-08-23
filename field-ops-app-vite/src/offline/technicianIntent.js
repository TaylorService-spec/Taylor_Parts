// A TECHNICIAN'S OFFLINE INTENT — the envelope, and the one thing it is never allowed to be.
//
// ============================ INTENT IS NOT BUSINESS STATE ============================
//
// Everything in this file describes something a technician MEANT to do on a device with no signal.
// None of it is a fact about the business. A queued EQUIPMENT_INSTALL does not mean a machine is
// installed; a queued WORK_ORDER_COMPLETE does not mean a job is finished. The canonical server
// authority decides that, later, and may refuse.
//
// So the vocabulary is deliberately one-directional: a phone may say "Pending sync". It may not say
// "Installed", "Completed" or "Saved" until a server said so. Every state in SYNC_STATE except
// SYNCED carries `claimsComplete: false` for exactly this reason, and this module never mints its own.
//
// ============================ WHY THE TYPES ARE A CLOSED LIST ============================
//
// Five types, matching five things a technician can already do. NOT a generic command queue.
//
// A generic queue would be less code and a much worse idea: it would let any future caller put an
// arbitrary callable and payload into durable storage on a phone, to be replayed against the server
// hours later under authority nobody checked at capture time. The closed list means every queued
// thing has a named business meaning, a known command and a reviewed dependency story.
//
// ============================ THE IDENTITY IS DERIVED, NEVER RANDOM ============================
//
// `intentId` is a pure function of (type, work order, capture key). A phone that retries, a tab that
// reloads, a queue restored from storage after a crash — all three produce the SAME id, and that id
// travels to the server as the idempotency key. Random ids would make every retry a new business
// effect, which for labor means double hours and for install means a second Equipment.
//
// PURE. No storage, no clock, no I/O, no transport.
import { SYNC_STATE } from "../domain/technicianHandheld.js";

/** The five, and only five. Each maps to a command that already exists and is already governed. */
export const INTENT_TYPE = Object.freeze({
  NOTE_ADD: "NOTE_ADD",
  LABOR_RECORD: "LABOR_RECORD",
  PARTS_USAGE: "PARTS_USAGE",
  EQUIPMENT_INSTALL: "EQUIPMENT_INSTALL",
  WORK_ORDER_COMPLETE: "WORK_ORDER_COMPLETE",
});

export const INTENT_TYPES = Object.freeze(Object.values(INTENT_TYPE));

/**
 * ORDERING PRECEDENCE — a tie-breaker, never a dependency.
 *
 * Dependencies decide what MAY go; this decides what goes FIRST among things that all may. The order
 * is not cosmetic: labor and parts are refused by their own commands once a Work Order leaves
 * execution, so sending Complete before them would turn "recorded the day's work" into a refusal the
 * technician cannot fix from a phone. Completion goes last because it closes the door.
 */
export const INTENT_PRECEDENCE = Object.freeze({
  [INTENT_TYPE.NOTE_ADD]: 10,
  [INTENT_TYPE.PARTS_USAGE]: 20,
  [INTENT_TYPE.LABOR_RECORD]: 30,
  [INTENT_TYPE.EQUIPMENT_INSTALL]: 40,
  [INTENT_TYPE.WORK_ORDER_COMPLETE]: 90,
});

/** What a queued intent may say about itself on screen. Borrowed from WO-02, never redefined. */
export const INTENT_STATE = SYNC_STATE;

/** States nothing moves out of without a person. */
export const ATTENTION_STATES = Object.freeze([
  SYNC_STATE.CONFLICT, SYNC_STATE.REFUSED, SYNC_STATE.NEEDS_ATTENTION,
]);

export const isSettled = (intent) => intent?.state === SYNC_STATE.SYNCED;
export const needsAttention = (intent) => ATTENTION_STATES.includes(intent?.state);

const isNonBlank = (v) => typeof v === "string" && v.trim() !== "";

/**
 * A stable hash, rendered hex.
 *
 * Two independent 32-bit passes (FNV-1a and djb2) concatenated. One 32-bit hash across a device's
 * whole queue is a collision risk somebody eventually meets; two different mixers over the same bytes
 * is cheap and makes an accidental match vanishingly unlikely. Not cryptographic and not trying to
 * be — nothing here is a security boundary, and the server re-checks every request on its own
 * authority regardless of what id it arrives under.
 */
export function stableHash(input) {
  const s = String(input);
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    fnv = Math.imul(fnv ^ c, 0x01000193) >>> 0;
    djb = ((djb << 5) + djb + c) >>> 0;
  }
  return `${fnv.toString(16).padStart(8, "0")}${djb.toString(16).padStart(8, "0")}`;
}

/**
 * A fingerprint of WHAT was intended, independent of when it was captured.
 *
 * Key-sorted, so two structurally identical payloads built in different key order fingerprint the
 * same — otherwise a harmless refactor of a form would read as a changed business request.
 *
 * This is what separates a REPLAY from a CONFLICT: same id and same fingerprint is one act arriving
 * twice, and is safe. Same id and a DIFFERENT fingerprint means the request changed under a key that
 * was already used, and that must surface rather than silently overwrite.
 */
export function payloadFingerprint(payload) {
  const canonical = (value) => {
    if (value === null || value === undefined) return "null";
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (typeof value === "object") {
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return stableHash(canonical(payload ?? null));
}

/**
 * The id, derived from the three things that identify the ACT.
 *
 * Note the capture key rather than a timestamp: a technician who taps "Add time" once has performed
 * one act, and it keeps that identity through a reload, a crash and six retries. A timestamp would
 * make the same act a different one on every attempt, which is how hours double.
 */
export function deriveIntentId({ type, workOrderId, captureKey }) {
  return `int_${stableHash(`${type}|${workOrderId}|${captureKey}`)}`;
}

/** Key fragments that must never reach durable device storage. */
const FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
  "token", "authorization", "password", "apikey", "secret", "credential", "bearer",
]);

/**
 * Does this payload contain something that must not be written to a phone?
 *
 * Browser storage is NOT application-encrypted (see docs/architecture/technician-offline-runtime.md),
 * so anything durable here should be assumed readable by anything else with access to the device.
 * Business data is accepted on that understanding; credentials are not, ever.
 *
 * Checked at capture rather than trusted by convention, because a convention is not a control — and
 * the failure mode is a refresh token sitting in IndexedDB on a lost phone.
 */
export function containsForbiddenMaterial(payload, path = "") {
  if (payload === null || typeof payload !== "object") return null;
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_PAYLOAD_KEYS.some((f) => lower.includes(f))) return path ? `${path}.${key}` : key;
    const nested = containsForbiddenMaterial(value, path ? `${path}.${key}` : key);
    if (nested) return nested;
  }
  return null;
}

/**
 * Build one queued intent.
 *
 * @param type                    one of INTENT_TYPE.
 * @param workOrderId             the job it belongs to. Every V1 intent has one — this is a
 *                                technician's queue, and a technician's work is Work Orders.
 * @param principalUid            WHOSE queue this is. Carried on the envelope as well as on the store,
 *                                so a record can be checked against the session trying to send it.
 * @param payload                 the command's own request; opaque here beyond the forbidden-key check.
 * @param captureKey              stable per user gesture. Identity comes from this, not the clock.
 * @param dependsOn               [{ intentId, required }] — see intentQueue.js for what required means.
 * @param createdAtLocal          the device's clock. A tie-breaker and a display fact, not an authority.
 * @param deviceReportedAtMillis  passed to commands that accept a device claim. Present only when the
 *                                capture really was offline; an online capture claims nothing.
 */
export function makeIntent({
  type, workOrderId, principalUid, payload = null, captureKey,
  dependsOn = [], createdAtLocal = 0, deviceReportedAtMillis = null, describe = null,
} = {}) {
  if (!INTENT_TYPES.includes(type)) return { valid: false, reason: "unknown_intent_type" };
  if (!isNonBlank(workOrderId)) return { valid: false, reason: "work_order_required" };
  if (!isNonBlank(principalUid)) return { valid: false, reason: "principal_required" };
  if (!isNonBlank(captureKey)) return { valid: false, reason: "capture_key_required" };
  const forbidden = containsForbiddenMaterial(payload);
  if (forbidden) return { valid: false, reason: `forbidden_payload_key:${forbidden}` };

  return {
    valid: true,
    value: Object.freeze({
      intentId: deriveIntentId({ type, workOrderId, captureKey }),
      type,
      workOrderId,
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
      /** What the server actually created, once it says. The link between an intent and a fact. */
      resultingServerIds: null,
    }),
  };
}
