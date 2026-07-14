// Issue #214 PR-2 -- safe, categorized copy for a Contact/Location creation
// failure shown inside the creation modals. Deliberately a DEPENDENCY-FREE module
// (no firebase / no other domain imports) so it is node-importable and
// unit-tested directly (test/contactLocationSaveErrors.test.mjs), the same pure
// pattern as the other domain error-message helpers. Never surfaces a raw
// Firebase code, document id, or credential detail.

export function contactSaveErrorMessage(err) {
  if (err?.blocked) return "Saving is disabled in this mode -- no contact was added.";
  const code = err?.code ?? "";
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return "You do not have permission to add a contact for this customer.";
  }
  return "Could not add this contact. No contact was added -- please try again.";
}

export function locationSaveErrorMessage(err) {
  if (err?.blocked) return "Saving is disabled in this mode -- no location was added.";
  const code = err?.code ?? "";
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return "You do not have permission to add a location for this customer.";
  }
  return "Could not add this location. No location was added -- please try again.";
}
