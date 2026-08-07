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

// Fields the update command accepts (mirror of UPDATABLE_FIELDS in partMasterCommands.ts). Used to build
// a minimal `changes` diff; the command re-validates every one.
export const UPDATABLE_FIELDS = Object.freeze([
  "internalPartNumber", "name", "description", "category", "stockingUnit", "controlType",
  "stockingClass", "manufacturerId", "manufacturerPartNumber", "oemStatus",
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
  for (const f of ["description", "category", "manufacturerId", "manufacturerPartNumber"]) {
    const v = trimOrUndefined(form?.[f]);
    if (v !== undefined) part[f] = v;
  }
  if (form?.oemStatus && OEM_STATUSES.includes(form.oemStatus)) part.oemStatus = form.oemStatus;
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
// Map a callable HttpsError `code` (or a success) to a stable UI outcome + a human message. The client
// never invents a success: a resolved callable is "applied"/"replayed" per the command's own outcome.
const CODE_OUTCOMES = Object.freeze({
  "permission-denied": { kind: "denied", message: "You are not authorized to make this change." },
  unauthenticated: { kind: "denied", message: "You must be signed in." },
  "invalid-argument": { kind: "invalid", message: "Some fields are missing or invalid. Check the form and try again." },
  "not-found": { kind: "notFound", message: "That part no longer exists. Reload the list." },
  "already-exists": { kind: "conflict", message: "A part already exists with that identifier." },
  aborted: { kind: "conflict", message: "This part changed since you loaded it. Reload and retry." },
  "failed-precondition": { kind: "invalid", message: "That change isn't allowed for this part's current state." },
  internal: { kind: "error", message: "The request could not be completed. Try again." },
});

// The workspace/hook uses this: `result` is the callable's resolved data ({outcome, version}) OR the
// thrown error is passed as `error`.
export function outcomeFromResult(result) {
  const outcome = result?.outcome;
  if (outcome === "applied" || outcome === "replayed") {
    return { kind: outcome === "replayed" ? "replayed" : "applied", message: outcome === "replayed" ? "Already recorded (no change)." : "Saved.", version: result?.version };
  }
  return { kind: "error", message: "The request could not be completed. Try again." };
}

export function outcomeFromError(error) {
  const code = error?.code;
  return CODE_OUTCOMES[code] ?? { kind: "error", message: "The request could not be completed. Try again." };
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
