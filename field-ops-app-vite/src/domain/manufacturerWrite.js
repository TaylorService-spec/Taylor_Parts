// Manufacturer write -- PURE helpers for the administration workspace (no Firebase/I/O; unit-tested).
// CLIENT MIRRORS of the governed status vocabulary (functions/src/partMaster/types.ts
// MANUFACTURER_STATUSES) exist only to shape input + offer controls -- NOT a second authority. The trusted
// command (partMasterCommands changeManufacturerStatus) owns the final decision; the UI collects input and
// presents the governed outcome, and never claims a write succeeded on its own.
export const MANUFACTURER_STATUSES = Object.freeze(["ACTIVE", "INACTIVE"]);

// Governed 2-state lifecycle: ACTIVE<->INACTIVE (the backend re-checks and is authoritative). The control
// offers the OTHER state as the only transition.
export function allowedStatusTransitions(currentStatus) {
  if (currentStatus === "ACTIVE") return ["INACTIVE"];
  if (currentStatus === "INACTIVE") return ["ACTIVE"];
  return [];
}

// Shape a create form into the createManufacturer payload {manufacturerId, name}. Trims; does NOT validate
// (the command's validation owns that). New manufacturers are created ACTIVE by the command.
export function buildCreateManufacturerInput(form) {
  return {
    manufacturerId: typeof form?.manufacturerId === "string" ? form.manufacturerId.trim() : "",
    name: typeof form?.name === "string" ? form.name.trim() : "",
  };
}

// The only editable field is `name`. Returns the trimmed name, or null when unchanged from the original
// (the caller should not submit a no-op update).
export function buildUpdateName(form, original) {
  const next = typeof form?.name === "string" ? form.name.trim() : "";
  if (next === "" || next === original?.name) return null;
  return next;
}

// ---- Governed outcome mapping (identical taxonomy to partMasterWrite; the client never invents success) ----
const CODE_OUTCOMES = Object.freeze({
  "permission-denied": { kind: "denied", message: "You are not authorized to make this change." },
  unauthenticated: { kind: "denied", message: "You must be signed in." },
  "invalid-argument": { kind: "invalid", message: "Some fields are missing or invalid. Check the form and try again." },
  "not-found": { kind: "notFound", message: "That manufacturer no longer exists. Reload the list." },
  "already-exists": { kind: "conflict", message: "A manufacturer already exists with that identifier." },
  aborted: { kind: "conflict", message: "This manufacturer changed since you loaded it. Reload and retry." },
  "failed-precondition": { kind: "invalid", message: "That change isn't allowed for this manufacturer's current state." },
  internal: { kind: "error", message: "The request could not be completed. Try again." },
});

export function outcomeFromResult(result) {
  const outcome = result?.outcome;
  if (outcome === "applied" || outcome === "replayed") {
    return { kind: outcome === "replayed" ? "replayed" : "applied", message: outcome === "replayed" ? "Already recorded (no change)." : "Saved.", version: result?.version };
  }
  return { kind: "error", message: "The request could not be completed. Try again." };
}

export function outcomeFromError(error) {
  return CODE_OUTCOMES[error?.code] ?? { kind: "error", message: "The request could not be completed. Try again." };
}

export const WRITE_DISABLED_OUTCOME = Object.freeze({
  kind: "unavailable",
  message: "Manufacturer editing isn't enabled in this environment yet. Changes are made by the catalog administration service once activated.",
});
export const NO_CHANGES_OUTCOME = Object.freeze({ kind: "noop", message: "No changes to save." });
