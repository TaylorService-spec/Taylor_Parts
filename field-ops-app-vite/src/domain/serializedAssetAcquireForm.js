// BRINGING AN ALREADY-OWNED UNIT ONTO THE BOOKS — the pure form layer.
//
// PURE: no Firebase, no network, no React, no clock, no input mutation. It shapes what the person
// chose into the request the governed command already defines, and decides what may be pressed.
// Every rule that MATTERS lives in `functions/src/serializedAsset/acquireSerializedAssetCommand.ts`
// and is re-checked inside its transaction; nothing here is authority.
//
// ============================ WHY THIS FLOW IS DELIBERATE AND SLOW ============================
//
// An acquisition asserts the company owns a machine with NO supplier document to check it against.
// There is no purchase order, no receipt, no delivery note — only a person saying so, and the audit
// record that says who. So the last screen before the write reads the whole thing back, the button
// names the act, and the reason comes from a closed set in which "we bought it" does not appear:
// a purchased unit HAS a purchase order and belongs in Receiving.
//
// ============================ WHAT IT DOES NOT DO ============================
//
// It creates no Equipment, no customer relationship and no purchasing history. A unit acquired here
// enters AVAILABLE company stock and is placed at a customer only by the separate, differently-held
// `equipment.install` authority.
import { ACQUIRE_REASON, ACQUIRE_REASON_LABEL } from "./serializedAssetAcquireVocabulary.js";

const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export const ACQUIRE_SUBMIT = Object.freeze({
  IDLE: "IDLE",
  SUBMITTING: "SUBMITTING",
  ACQUIRED: "ACQUIRED",
  FAILED: "FAILED",
  CONFLICT: "CONFLICT",
});

/** The command's own failure codes, as the client branches on them. */
export const ACQUIRE_FAILURE = Object.freeze({
  PERMISSION_DENIED: "PERMISSION_DENIED",
  REQUEST_INVALID: "REQUEST_INVALID",
  PART_NOT_FOUND: "PART_NOT_FOUND",
  PART_NOT_SERIALIZED: "PART_NOT_SERIALIZED",
  LOCATION_INVALID: "LOCATION_INVALID",
  ALREADY_EXISTS_CONFLICT: "ALREADY_EXISTS_CONFLICT",
  ACQUIRE_INTEGRITY: "ACQUIRE_INTEGRITY",
});

export const ACQUIRE_DISABLED_REASON =
  "You are not authorized to bring existing units into company inventory.";

/** The empty form. `attemptToken` is minted per attempt by the caller — see deriveIdempotencyKey. */
export const EMPTY_ACQUIRE_FORM = Object.freeze({
  partId: "",
  serialNo: "",
  locationId: "",
  reason: "",
  provenanceNote: "",
});

export function selectPart(form, partId) {
  return { ...form, partId: str(partId) ?? "" };
}
export function selectLocation(form, locationId) {
  return { ...form, locationId: str(locationId) ?? "" };
}
export function selectReason(form, reason) {
  return { ...form, reason: str(reason) ?? "" };
}
export function setSerialNo(form, serialNo) {
  return { ...form, serialNo: typeof serialNo === "string" ? serialNo : "" };
}
export function setProvenanceNote(form, note) {
  return { ...form, provenanceNote: typeof note === "string" ? note : "" };
}

/**
 * What is still missing, field by field.
 *
 * Each problem names ITS OWN field so the surface can put the message beside the control it is
 * about. One combined "form incomplete" sentence makes a person hunt.
 */
export function validateAcquireForm(form) {
  const problems = [];
  if (!str(form?.partId)) problems.push({ field: "part", message: "Choose the part this unit is." });
  if (!str(form?.serialNo)) problems.push({ field: "serialNo", message: "Enter the unit's serial number." });
  if (!str(form?.locationId)) problems.push({ field: "location", message: "Choose the company location holding it." });
  const reason = str(form?.reason);
  if (!reason) {
    problems.push({ field: "reason", message: "Say why this unit is being added without a purchase." });
  } else if (!Object.values(ACQUIRE_REASON).includes(reason)) {
    // An unrecognised reason is refused here for the same purpose the command refuses it: there is
    // no default that would be true.
    problems.push({ field: "reason", message: "That is not one of the recorded acquisition reasons." });
  }
  return { valid: problems.length === 0, problems };
}

/**
 * The idempotency key, derived from the ATTEMPT and its identifying choices.
 *
 * Two properties, and both matter:
 *
 *   a network retry of the same attempt reuses the same key, so the server replays rather than
 *   attempting a second acquisition of a unit already on the books
 *
 *   changing the part, serial or location changes the key, so a corrected attempt is a genuinely new
 *   request rather than a replay of the earlier, wrong one
 *
 * The command's identity is derived from part+serial independently of this key, so a replay is
 * recognised even across attempts — the key is what makes ONE attempt's retries safe.
 */
export function deriveIdempotencyKey(form, attemptToken) {
  const token = str(attemptToken);
  const partId = str(form?.partId);
  const serialNo = str(form?.serialNo);
  const locationId = str(form?.locationId);
  if (!token || !partId || !serialNo || !locationId) return null;
  // The command accepts letters, digits, underscore and hyphen only — a colon was rejected once
  // already on the grant path, and the fix belongs where the key is minted.
  const safe = (v) => v.replace(/[^A-Za-z0-9_-]/g, "-");
  return `acquire_${safe(partId)}_${safe(serialNo)}_${safe(locationId)}_${safe(token)}`;
}

/**
 * The request the callable receives. Built from the form so no caller assembles it by hand.
 *
 * ONLY THE COMMAND'S OWN KEYS. Its validator refuses any field outside its allow-list, so an extra
 * key here would not be ignored — it would fail the whole request. That is the stronger contract and
 * this respects it rather than testing it.
 */
export function buildAcquireRequest(form, { attemptToken } = {}) {
  const idempotencyKey = deriveIdempotencyKey(form, attemptToken);
  if (!idempotencyKey) return null;
  const { valid } = validateAcquireForm(form);
  if (!valid) return null;
  const note = str(form?.provenanceNote);
  return {
    partId: str(form.partId),
    serialNo: str(form.serialNo),
    locationId: str(form.locationId),
    reason: str(form.reason),
    idempotencyKey,
    ...(note ? { provenanceNote: note } : {}),
  };
}

/**
 * Interpret what came back.
 *
 * A REPLAY IS A SUCCESS. The command derives identity from part+serial, so submitting the same unit
 * twice returns `replayed` — the unit is on the books, which is what the person wanted. Presenting
 * that as a failure would invite a third attempt at something already done.
 *
 * A CONFLICT IS NOT A FAILURE TO RETRY. `ALREADY_EXISTS_CONFLICT` means a unit with that serial
 * already exists for this part recorded differently — possibly from a RECEIPT, which acquisition
 * must never overwrite. Retrying cannot help, and the surface must not offer it.
 */
export function interpretAcquireResult({ outcome, error } = {}) {
  if (outcome && (outcome.outcome === "acquired" || outcome.outcome === "replayed")) {
    const replayed = outcome.outcome === "replayed";
    return {
      status: ACQUIRE_SUBMIT.ACQUIRED,
      serializedAssetId: outcome.serializedAssetId ?? null,
      replayed,
      message: replayed
        ? "This unit was already on the books. Nothing was added a second time."
        : "Added to company inventory.",
    };
  }
  const code = str(error?.details) ?? str(error?.code) ?? null;
  if (code === ACQUIRE_FAILURE.ALREADY_EXISTS_CONFLICT) {
    return {
      status: ACQUIRE_SUBMIT.CONFLICT,
      serializedAssetId: null,
      code,
      message: "A unit with that serial already exists for this part, recorded differently. "
        + "It may have arrived on a purchase order — check Receiving before changing anything.",
    };
  }
  return {
    status: ACQUIRE_SUBMIT.FAILED,
    serializedAssetId: null,
    code,
    message: MESSAGE_FOR[code] ?? str(error?.message) ?? "The unit could not be added.",
  };
}

/** Client-side words for the codes worth explaining. Others fall through to the server's message. */
const MESSAGE_FOR = Object.freeze({
  [ACQUIRE_FAILURE.PERMISSION_DENIED]: ACQUIRE_DISABLED_REASON,
  [ACQUIRE_FAILURE.PART_NOT_SERIALIZED]:
    "That part is not serial-tracked, so it has no individual units to add.",
  [ACQUIRE_FAILURE.PART_NOT_FOUND]: "That part could not be found, or is not active.",
  [ACQUIRE_FAILURE.LOCATION_INVALID]:
    "That is not an active company location. A customer's location cannot hold company stock.",
});

/**
 * May the confirm control be pressed right now?
 *
 * Each reason is separate and named. Collapsing them into one disabled button teaches the user
 * nothing about which one applies — and the capability case in particular must say so out loud
 * rather than leaving a greyed control with no explanation.
 */
export function deriveAcquireAction({ canAcquire, form, submitStatus }) {
  if (!canAcquire) return { enabled: false, reason: ACQUIRE_DISABLED_REASON };
  if (submitStatus === ACQUIRE_SUBMIT.SUBMITTING) {
    return { enabled: false, reason: "Adding this unit…" };
  }
  if (submitStatus === ACQUIRE_SUBMIT.ACQUIRED) {
    return { enabled: false, reason: "This unit is already on the books." };
  }
  const { valid, problems } = validateAcquireForm(form);
  if (!valid) return { enabled: false, reason: problems[0].message };
  return { enabled: true, reason: null };
}

/** The read-back shown before the write. Null until every governed input is present. */
export function acquireConfirmationSummary({ form, part, location } = {}) {
  const { valid } = validateAcquireForm(form);
  if (!valid) return null;
  const note = str(form.provenanceNote);
  return Object.freeze([
    Object.freeze({ key: "part", label: "Unit", value: str(part?.label) ?? str(form.partId) }),
    Object.freeze({ key: "serial", label: "Serial number", value: str(form.serialNo) }),
    Object.freeze({ key: "location", label: "Company location", value: str(location?.label) ?? str(form.locationId) }),
    Object.freeze({ key: "reason", label: "Acquisition reason", value: ACQUIRE_REASON_LABEL[form.reason] ?? form.reason }),
    ...(note ? [Object.freeze({ key: "note", label: "Provenance note", value: note })] : []),
  ]);
}

export const ACQUIRE_CONSEQUENCE =
  "This creates a company-owned serialized asset in AVAILABLE inventory without a purchase or "
  + "receiving record. It does not assign the unit to a customer.";

// ═══════════════════════ THE TWO STAGES, AND WHY THE FORM IS NOT ONE SCREEN ═══════════════════════
//
// The read-back used to appear inline, below the fields, the moment the form became valid — and the
// single button beneath it said "Confirm acquisition". So the act of completing the last field
// silently armed the write, and the summary a person was meant to CHECK sat in the same scroll as
// the controls they were still editing. Nothing distinguished "I am filling this in" from "I have
// read this back and I mean it".
//
// Two stages make that distinction structural. Review assembles; Confirm commits. Neither calls the
// backend except the second, and Back returns to the form with every answer intact.

export const ACQUIRE_STAGE = Object.freeze({
  FORM: "FORM",
  CONFIRM: "CONFIRM",
  DONE: "DONE",
});

/**
 * What is still outstanding, named as things rather than as instructions.
 *
 * DELIBERATELY DIFFERENT WORDS FROM `validateAcquireForm`. Each field already carries its own
 * instruction beside the control it is about ("Say why this unit is being added without a
 * purchase."). Repeating that same sentence again next to the button was the duplication the surface
 * was reported for: the same message twice says nothing twice.
 *
 * What the action needs to answer is a different question — not "what should I type here?" but "why
 * can I not go on?" — so it names the missing facts and lets the field-level messages say how.
 */
export function outstandingRequirements(form) {
  const { problems } = validateAcquireForm(form);
  return problems.map((problem) => OUTSTANDING_NOUN[problem.field] ?? problem.field);
}

const OUTSTANDING_NOUN = Object.freeze({
  part: "the part",
  serialNo: "the serial number",
  location: "the company location",
  reason: "a reason",
});

/** "the part and a reason" — an English list, because a person reads this, not a machine. */
export function outstandingRequirementSummary(form) {
  const missing = outstandingRequirements(form);
  if (missing.length === 0) return null;
  const list = missing.length === 1
    ? missing[0]
    : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Still needed: ${list}.`;
}

/**
 * May the form-stage action be pressed?
 *
 * Review assembles a read-back and calls nothing, so the only things that can stop it are the
 * capability and the missing facts — never the submit status, which belongs to the stage after it.
 */
export function deriveAcquireReviewAction({ canAcquire, form }) {
  if (!canAcquire) return { enabled: false, reason: ACQUIRE_DISABLED_REASON };
  const summary = outstandingRequirementSummary(form);
  if (summary) return { enabled: false, reason: summary };
  return { enabled: true, reason: null };
}
