// CAPTURE — turning a tap on a phone with no signal into a queued intent.
//
// This is the layer screens talk to. It owns two things they must not each invent for themselves:
// the payload each command expects, and the DEPENDENCIES between the intents that make up a closeout.
//
// ============================ WHY DEPENDENCIES ARE DERIVED HERE ============================
//
// A screen knows a technician pressed Complete. It does not know that this Work Order also has a
// queued installation that must land first, or that the labor entry captured twenty minutes ago will
// become impossible the moment completion succeeds.
//
// If each screen wired its own dependencies, the graph would be assembled from whatever happened to
// be mounted at the time — which is exactly the accidental, render-order-dependent coupling §19
// forbids. So the graph is derived from the QUEUE, once, here.
import { INTENT_TYPE, makeIntent } from "./technicianIntent.js";
import { normalizeScanToken } from "../domain/scannedIdentity.js";

/**
 * The dependencies a completion intent must carry, derived from what is already queued for that job.
 *
 * REQUIRED on installation. OPTIONAL on everything else. The reasoning for each is in
 * intentQueue.js's header, and the important half is the optional one: notes, labor and parts are not
 * requirements for finishing a job, but they must be SEQUENCED before it, because their commands
 * refuse a Work Order that has left execution.
 *
 * Only unsettled intents produce edges. An already-synced installation is a fact about the server,
 * not a thing to wait for.
 */
export function closeoutDependencies(queue, workOrderId) {
  const mine = (queue ?? []).filter((i) => i.workOrderId === workOrderId && i.state !== "SYNCED");
  return Object.freeze(mine
    .filter((i) => i.type !== INTENT_TYPE.WORK_ORDER_COMPLETE)
    .map((i) => Object.freeze({
      intentId: i.intentId,
      required: i.type === INTENT_TYPE.EQUIPMENT_INSTALL,
    })));
}

/**
 * The one place a device decides whether to make a device-time claim.
 *
 * An intent captured with a live connection is submitted immediately and the server's own clock is
 * the only timestamp that matters, so it claims nothing. An intent captured offline may be submitted
 * hours later, and without this the platform would record the work as having happened at the moment
 * the signal returned.
 */
const deviceClaim = (offline, at) => (offline ? at : null);

/** A note. The draft is the technician's; this is the moment they said save. */
export function captureNote({ workOrderId, principalUid, text, captureKey, at = 0, offline = false }) {
  return makeIntent({
    type: INTENT_TYPE.NOTE_ADD,
    workOrderId, principalUid, captureKey, createdAtLocal: at,
    deviceReportedAtMillis: deviceClaim(offline, at),
    describe: "Note",
    payload: { workOrderId, executionNote: text },
  });
}

/**
 * Labor. The idempotency key IS the intent id, set by the queue rather than by the form.
 *
 * That matters more here than anywhere else in this runtime: the form's own attempt token is scoped
 * to a component mount, so a phone that reloads between capture and sync would have produced a second
 * key and a second set of hours. A derived intent id survives the reload.
 */
export function captureLabor({
  workOrderId, principalUid, laborType, durationMinutes, workDate, captureKey, at = 0, offline = false,
}) {
  const intent = makeIntent({
    type: INTENT_TYPE.LABOR_RECORD,
    workOrderId, principalUid, captureKey, createdAtLocal: at,
    deviceReportedAtMillis: deviceClaim(offline, at),
    describe: "Time",
    payload: {
      workOrderId,
      // DURATION, not INTERVAL: a technician entering time on a phone knows how long, and inventing
      // a start time to fill an interval would be a fabricated clock position. Labor V1 supports both
      // shapes precisely so this one does not have to lie.
      entryKind: "DURATION",
      laborType, durationMinutes, workDate,
    },
  });
  if (!intent.valid) return intent;
  return {
    valid: true,
    value: Object.freeze({
      ...intent.value,
      payload: Object.freeze({
        ...intent.value.payload,
        idempotencyKey: intent.value.intentId,
        // Present only when the capture was genuinely offline — see deviceClaim.
        ...(intent.value.deviceReportedAtMillis
          ? { deviceReportedAtMillis: intent.value.deviceReportedAtMillis } : {}),
      }),
    }),
  };
}

/**
 * Parts used. A delta, and it is intent — inventory has not moved.
 *
 * `provenance` records whether the SKU came off a scanner or a keyboard. Not decoration: a mis-keyed
 * part number and a mis-scanned label are different failures with different fixes, and by the time
 * anybody investigates, nobody remembers which it was.
 */
export function capturePartsUsage({
  workOrderId, principalUid, sku, delta, provenance = "MANUAL", captureKey, at = 0, offline = false,
}) {
  return makeIntent({
    type: INTENT_TYPE.PARTS_USAGE,
    workOrderId, principalUid, captureKey, createdAtLocal: at,
    deviceReportedAtMillis: deviceClaim(offline, at),
    describe: `Parts used — ${sku}`,
    payload: { workOrderId, qtyUsedUpdates: [{ sku, delta }], provenance },
  });
}

/**
 * An installation.
 *
 * The asset may be identified two ways, and the difference is real. A `serializedAssetId` was
 * resolved against the server's own list of what may be installed on this job. A `rawScannedSerial`
 * is a string off a label that nothing has checked — it is not an asset, it is a claim about one, and
 * the executor must resolve it before any install is attempted.
 *
 * Customer and location are deliberately absent: the command derives both from the Work Order and
 * refuses a request that supplies them. A device is not a source of truth about where a machine went.
 */
export function captureInstall({
  workOrderId, principalUid, serializedAssetId = null, rawScannedSerial = null,
  notes = null, captureKey, at = 0, offline = false,
}) {
  if (!serializedAssetId && !rawScannedSerial) {
    return { valid: false, reason: "asset_identity_required" };
  }
  const intent = makeIntent({
    type: INTENT_TYPE.EQUIPMENT_INSTALL,
    workOrderId, principalUid, captureKey, createdAtLocal: at,
    deviceReportedAtMillis: deviceClaim(offline, at),
    describe: "Installation",
    payload: {
      workOrderId,
      serializedAssetId,
      rawScannedSerial,
      ...(notes ? { notes } : {}),
    },
  });
  if (!intent.valid) return intent;
  return {
    valid: true,
    value: Object.freeze({
      ...intent.value,
      payload: Object.freeze({ ...intent.value.payload, idempotencyKey: intent.value.intentId }),
    }),
  };
}

/**
 * Completion, with its dependencies attached from the queue as it stands.
 *
 * The intended result is recorded on the payload so the executor can recognise a job the server has
 * ALREADY moved — §17's lost-response case — instead of attempting a second transition against a
 * state machine that is not idempotent.
 */
export function captureComplete({
  workOrderId, principalUid, queue = [], captureKey, at = 0, offline = false,
}) {
  return makeIntent({
    type: INTENT_TYPE.WORK_ORDER_COMPLETE,
    workOrderId, principalUid, captureKey, createdAtLocal: at,
    deviceReportedAtMillis: deviceClaim(offline, at),
    describe: "Complete the job",
    dependsOn: closeoutDependencies(queue, workOrderId),
    payload: { workOrderId, action: "Complete", intendedStatus: "COMPLETED" },
  });
}

// ============================ SCANNING WITH NO SIGNAL ============================

/**
 * What a scan means when the catalogue is not reachable.
 *
 * The distinction this exists to protect is the last one: NEEDS_ONLINE_RESOLUTION is not NOT_FOUND. A
 * technician told "not found" puts the box down and looks for another one. Telling them that because
 * a lookup could not run is how the wrong machine gets installed.
 *
 * Local format checking reuses `normalizeScanToken` — the existing, shared authority on what a
 * scanned string can be unwrapped into — rather than a second regex that would drift from it.
 */
export const OFFLINE_SCAN = Object.freeze({
  /** Matched a record already cached for this technician's own assigned work. Stale, and says so. */
  KNOWN_FROM_CACHE: "KNOWN_FROM_CACHE",
  /** Well-formed, not in the cache. Means nothing yet. Never rendered as "not found". */
  NEEDS_ONLINE_RESOLUTION: "NEEDS_ONLINE_RESOLUTION",
  /** Not a usable token at all. The one verdict a device can reach on its own. */
  INVALID_FORMAT: "INVALID_FORMAT",
  /** The server looked and does not have it. Only reachable online. */
  SERVER_NOT_FOUND: "SERVER_NOT_FOUND",
});

export const OFFLINE_SCAN_TEXT = Object.freeze({
  [OFFLINE_SCAN.KNOWN_FROM_CACHE]: "Matched from your downloaded job data — not checked with the server yet.",
  [OFFLINE_SCAN.NEEDS_ONLINE_RESOLUTION]: "Saved. This needs a connection before it can be checked.",
  [OFFLINE_SCAN.INVALID_FORMAT]: "That is not a code this app can read. Try scanning again.",
  [OFFLINE_SCAN.SERVER_NOT_FOUND]: "The server has no record of that code.",
});

/**
 * @param raw     what the scanner or keyboard produced.
 * @param lookup  (token) => cached match | null. The technician's OWN cached data only.
 * @param online  whether a server lookup was actually possible.
 */
export function classifyOfflineScan({ raw, lookup = () => null, online = false } = {}) {
  const token = normalizeScanToken(raw);
  // The only judgement a device may reach alone: this string is not a code at all.
  if (!token) return Object.freeze({ resolution: OFFLINE_SCAN.INVALID_FORMAT, token: null, match: null });

  const cached = lookup(token);
  if (cached) return Object.freeze({ resolution: OFFLINE_SCAN.KNOWN_FROM_CACHE, token, match: cached, stale: true });

  return Object.freeze({
    resolution: online ? OFFLINE_SCAN.SERVER_NOT_FOUND : OFFLINE_SCAN.NEEDS_ONLINE_RESOLUTION,
    token,
    match: null,
  });
}
