// Part Master write -- PURE helpers for the in-app catalog administration workspace. No Firebase, no
// I/O; Node-importable and unit-tested. These CLIENT MIRRORS of the backend controlled vocabularies +
// status transitions (functions/src/partMaster/types.ts + partMasterCommands.ts PART_STATUS_TRANSITIONS)
// exist ONLY to shape input and offer sensible controls -- they are NOT a second authority. The trusted
// command (partMasterCommands.validatePart / status-transition check) owns the FINAL decision; the UI
// collects input and presents the governed outcome, and never claims a write succeeded on its own.

// ---- Controlled vocabularies (client mirror of functions/src/partMaster/types.ts) ----
export const PART_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"]);
export const CONTROL_TYPES = Object.freeze(["STANDARD", "SERIALIZED", "LOT", "SERIALIZED_LOT"]);
export const STOCKING_CLASSES = Object.freeze(["STOCKED", "NON_STOCK", "SERVICE", "KIT"]);
export const OEM_STATUSES = Object.freeze(["OEM", "AFTERMARKET", "UNKNOWN"]);
export const UNIT_CODES = Object.freeze(["EACH", "KIT", "BOTTLE", "TUBE", "BOX", "CASE", "FOOT", "ROLL", "GALLON", "OUNCE", "POUND"]);

// Client mirror of PART_STATUS_TRANSITIONS (partMasterCommands.ts). The status control offers only
// mirror-valid targets; the trusted command re-checks and is authoritative.
export const PART_STATUS_TRANSITIONS = Object.freeze({
  DRAFT: ["ACTIVE"],
  ACTIVE: ["INACTIVE", "DISCONTINUED", "SUPERSEDED"],
  INACTIVE: ["ACTIVE", "DISCONTINUED", "SUPERSEDED"],
  DISCONTINUED: [],
  SUPERSEDED: [],
});

export function allowedStatusTransitions(currentStatus) {
  return PART_STATUS_TRANSITIONS[currentStatus] ?? [];
}

// Wave 5 -- StatusPill tone for PART_STATUSES, preserving the exact colour intent of
// PartMasterList.jsx's former inline STATUS_TONE map (ACTIVE=success, DRAFT=neutral
// border, INACTIVE=warning, SUPERSEDED=info, DISCONTINUED=danger).
const PART_STATUS_TONE = {
  ACTIVE: "positive",
  DRAFT: "muted",
  INACTIVE: "attention",
  SUPERSEDED: "info",
  DISCONTINUED: "critical",
};

export function partStatusTone(status) {
  return PART_STATUS_TONE[status] ?? "unknown";
}

// Fields the update command accepts (mirror of UPDATABLE_FIELDS in partMasterCommands.ts). Used to build
// a minimal `changes` diff; the command re-validates every one.
export const UPDATABLE_FIELDS = Object.freeze([
  "internalPartNumber", "name", "description", "category", "stockingUnit", "controlType",
  "stockingClass", "manufacturerId", "manufacturerPartNumber", "oemStatus",
  // Equipment-model link (Option A). wholeUnit = the whole-unit classification (boolean); equipmentModelId =
  // the canonical equipment_models FK (string). The command re-validates the guardrail + catalog existence.
  "wholeUnit", "equipmentModelId",
]);

function trimOrUndefined(v) {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

// Shape a create form into the `part` payload the createPart callable expects. New parts start DRAFT
// (activation is a separate governed status change). Optional fields are omitted when blank so the
// backend's "validated-if-present" rules apply. This does NOT validate -- the command does.
export function buildCreatePartInput(form) {
  const part = {
    partId: trimOrUndefined(form?.partId) ?? "",
    internalPartNumber: trimOrUndefined(form?.internalPartNumber) ?? "",
    name: trimOrUndefined(form?.name) ?? "",
    status: "DRAFT",
    stockingUnit: form?.stockingUnit ?? "EACH",
    controlType: form?.controlType ?? "STANDARD",
    stockingClass: form?.stockingClass ?? "STOCKED",
  };
  for (const f of ["description", "category", "manufacturerId", "manufacturerPartNumber", "equipmentModelId"]) {
    const v = trimOrUndefined(form?.[f]);
    if (v !== undefined) part[f] = v;
  }
  if (form?.oemStatus && OEM_STATUSES.includes(form.oemStatus)) part.oemStatus = form.oemStatus;
  // Whole-unit classification passes through only when explicitly true (the command owns the guardrail).
  if (form?.wholeUnit === true) part.wholeUnit = true;
  return part;
}

// Build the minimal changes diff for updatePart: only updatable fields that actually differ from the
// loaded part. Returns {} when nothing changed (the caller should not submit an empty update).
export function buildUpdateChanges(form, original) {
  const changes = {};
  for (const f of UPDATABLE_FIELDS) {
    if (!(f in (form ?? {}))) continue;
    const next = typeof form[f] === "string" ? form[f].trim() : form[f];
    const prev = original?.[f];
    if (next !== prev && !(next === "" && (prev === undefined || prev === null))) {
      changes[f] = next;
    }
  }
  return changes;
}

// ---- Governed outcome mapping ----
// The Part commands answer through the governed Catalog API (POST /operations/catalog). Its contract, which
// test/fixtures/catalogPartMasterContract.json pins from the REAL server (functions/test/
// catalogPartMasterEmployeeContractPostgres.test.mjs proves the fixture against PostgreSQL):
//
//   success  { partId, version, replayed }            -- replayed:true is an identical resend, nothing written
//   refusal  an Error whose `code` is the Catalog category (catalogApiClient.catalogFailureCategory):
//            FORBIDDEN | NOT_SIGNED_IN | INVALID_INPUT | NOT_FOUND | CONFLICT | PRECONDITION_FAILED | UNAVAILABLE |
//            UNREACHABLE | NOT_CONFIGURED | INTERNAL, with the server's message.
//
// The retired Firebase callables answered {outcome:"applied"|"replayed"} and HttpsError codes. This module used to
// read only that shape, so every successful EOS write was shown as "could not be completed" (finding CAT-1,
// docs/audits/firebase-retirement-equivalence-2026-10-11). The client still never invents a success: anything that
// is not the governed success shape is an error.
//
// The server sends the refusal CATEGORY, not the rule (VERSION_CONFLICT vs PART_ALREADY_EXISTS both arrive as
// CONFLICT). Within one operation each category has one meaning, so the message is chosen per operation:
//   createPart       CONFLICT = PART_ALREADY_EXISTS; NOT_FOUND = EQUIPMENT_MODEL_NOT_FOUND
//   updatePart       CONFLICT = VERSION_CONFLICT; NOT_FOUND = PART_NOT_FOUND | EQUIPMENT_MODEL_NOT_FOUND;
//                    PRECONDITION_FAILED = CONTROL_TYPE_IMMUTABLE | NO_CHANGES
//   changePartStatus CONFLICT = VERSION_CONFLICT; NOT_FOUND = PART_NOT_FOUND; PRECONDITION_FAILED = ILLEGAL_TRANSITION
export const PART_WRITE_OPERATIONS = Object.freeze({ create: "create", update: "update", changeStatus: "changeStatus" });

const DENIED = Object.freeze({ kind: "denied", message: "You are not authorized to make this change." });
const UNAVAILABLE = Object.freeze({ kind: "unavailable", message: "The catalog service can't be reached right now. Try again shortly." });
const GENERIC_ERROR = Object.freeze({ kind: "error", message: "The request could not be completed. Try again." });

const CATEGORY_OUTCOMES = Object.freeze({
  FORBIDDEN: DENIED,
  NOT_SIGNED_IN: Object.freeze({ kind: "denied", message: "You must be signed in." }),
  INVALID_INPUT: Object.freeze({ kind: "invalid", message: "Some fields are missing or invalid. Check the form and try again." }),
  UNAVAILABLE,
  UNREACHABLE: UNAVAILABLE,
  NOT_CONFIGURED: UNAVAILABLE,
});

const OPERATION_OUTCOMES = Object.freeze({
  create: Object.freeze({
    CONFLICT: Object.freeze({ kind: "conflict", message: "A part already exists with that Part ID." }),
    NOT_FOUND: Object.freeze({ kind: "notFound", message: "The equipment model this part names doesn't exist. Choose another model." }),
    PRECONDITION_FAILED: Object.freeze({ kind: "invalid", message: "This part can't be created in its current form." }),
  }),
  update: Object.freeze({
    CONFLICT: Object.freeze({ kind: "conflict", message: "This part changed since you loaded it. Reload and retry." }),
    NOT_FOUND: Object.freeze({ kind: "notFound", message: "That part, or the equipment model it names, no longer exists. Reload the list." }),
    PRECONDITION_FAILED: Object.freeze({ kind: "invalid", message: "That change isn't allowed for this part (the control type can't change)." }),
  }),
  changeStatus: Object.freeze({
    CONFLICT: Object.freeze({ kind: "conflict", message: "This part changed since you loaded it. Reload and retry." }),
    NOT_FOUND: Object.freeze({ kind: "notFound", message: "That part no longer exists. Reload the list." }),
    PRECONDITION_FAILED: Object.freeze({ kind: "invalid", message: "That status change isn't allowed from the part's current status." }),
  }),
});

/** A governed command's answer -> the outcome the screen renders. Only the governed success shape is a success. */
export function outcomeFromResult(result) {
  const governed = result && typeof result === "object" && typeof result.partId === "string"
    && Number.isInteger(result.version) && typeof result.replayed === "boolean";
  if (!governed) return GENERIC_ERROR;
  return result.replayed
    ? { kind: "replayed", message: "Already recorded (no change).", version: result.version, partId: result.partId }
    : { kind: "applied", message: "Saved.", version: result.version, partId: result.partId };
}

/** A governed refusal -> the outcome the screen renders, worded for the operation that was refused. */
export function outcomeFromError(error, operation = null) {
  const code = error?.code;
  const byOperation = operation ? OPERATION_OUTCOMES[operation]?.[code] : undefined;
  return byOperation ?? CATEGORY_OUTCOMES[code] ?? GENERIC_ERROR;
}

// The write-disabled outcome (readiness false): never a callable attempt, always this honest state.
export const WRITE_DISABLED_OUTCOME = Object.freeze({
  kind: "unavailable",
  message: "Part editing isn't enabled in this environment yet. Changes are made by the catalog administration service once activated.",
});

// No-op outcome: an edit with no changed fields -- no callable is made. Kept here (not ad hoc in the
// hook) so this module owns the full outcome vocabulary.
export const NO_CHANGES_OUTCOME = Object.freeze({ kind: "noop", message: "No changes to save." });

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;
export function isValidIdempotencyKey(key) {
  return typeof key === "string" && IDEMPOTENCY_KEY_PATTERN.test(key);
}
