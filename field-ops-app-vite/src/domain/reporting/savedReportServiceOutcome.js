// Issue #325 W-SAVE -- PURE mappers between the trusted saved-definition callables and the client's
// safe UI states. No firebase here (node-testable); the firebase-calling wrappers live in
// savedReportService.js and delegate here.
//
// A callable error is mapped to ONE safe outcome kind; the message is fixed, safe copy -- never a
// raw Firebase code/path/id, never a server-supplied field name. NotFound and NotOwner both arrive
// as `not-found` (the service maps them to the same code on purpose, so the client can't tell "not
// yours" from "doesn't exist"); the client treats both as "no longer available" + refresh.

export const SAVED_DEFINITION_OUTCOME = Object.freeze({
  DENIED: "denied",         // lacks the per-action capability (permission-denied / unauthenticated)
  NOT_FOUND: "not-found",   // gone / not-owner (indistinguishable by design)
  INVALID: "invalid",       // bad name / structurally invalid definition
  UNAVAILABLE: "unavailable", // transient: retry
  FAILURE: "failure",       // safe generic failure
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Map a thrown callable error (a Firebase FunctionsError; code optionally prefixed "functions/") to
// a safe { kind, message }. (Reachability note: the whole Saved Reports surface is gated on the
// trusted feed's `report.definition.read` decision, so in production -- where the callables are
// undeployed and the feed itself errors -- the surface is already hidden; an error here is a real
// service outcome, mapped safely regardless.)
export function mapSavedDefinitionError(err) {
  const code = String(err?.code ?? "").replace(/^functions\//, "");
  switch (code) {
    case "unauthenticated":
    case "permission-denied":
      return { kind: SAVED_DEFINITION_OUTCOME.DENIED, message: "You don't have access to do that." };
    case "not-found":
      return { kind: SAVED_DEFINITION_OUTCOME.NOT_FOUND, message: "That report no longer exists." };
    case "invalid-argument":
      return { kind: SAVED_DEFINITION_OUTCOME.INVALID, message: "That report couldn't be saved — check the name and try again." };
    case "unavailable":
    case "deadline-exceeded":
    case "cancelled":
    case "aborted":
    case "resource-exhausted":
      return { kind: SAVED_DEFINITION_OUTCOME.UNAVAILABLE, message: "Saved reports aren't available right now. Try again shortly." };
    default:
      return { kind: SAVED_DEFINITION_OUTCOME.FAILURE, message: "Something went wrong. Please try again." };
  }
}

// A record's timestamp can arrive as a serialized Firestore Timestamp ({_seconds}/{seconds}), an
// epoch-ms number, or an ISO string; return display millis or null. Never throws.
export function toMillis(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (isPlainObject(v)) {
    const s = typeof v._seconds === "number" ? v._seconds : (typeof v.seconds === "number" ? v.seconds : null);
    return s === null ? null : s * 1000;
  }
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  return null;
}

// Normalize one server record to a safe, display-ready shape. Returns null for a malformed record
// (fail closed -- a record without a string id/name is not shown).
export function normalizeRecord(rec) {
  if (!isPlainObject(rec) || typeof rec.id !== "string" || rec.id === "" || typeof rec.name !== "string") {
    return null;
  }
  return Object.freeze({
    id: rec.id,
    name: rec.name,
    ownerUid: typeof rec.ownerUid === "string" ? rec.ownerUid : null,
    definition: rec.definition,
    updatedAtMillis: toMillis(rec.updatedAt),
  });
}

// Normalize a list result to sorted (newest-updated first), malformed-dropped records.
export function normalizeList(data) {
  if (!Array.isArray(data)) return [];
  return data.map(normalizeRecord).filter(Boolean)
    .sort((a, b) => (b.updatedAtMillis ?? 0) - (a.updatedAtMillis ?? 0));
}
