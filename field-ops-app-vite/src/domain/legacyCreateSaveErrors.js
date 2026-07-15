// Issue #214 PR-5 -- safe, categorized copy for a Job / Technician creation
// failure shown inside the retained-and-migrated creation modals (Jobs.jsx,
// Technicians.jsx). Dependency-free (no firebase / no other domain imports) so it
// is node-importable and unit-tested directly (test/legacyCreateSaveErrors.test.mjs),
// the same pure pattern as the other domain *SaveErrorMessage helpers. Never
// surfaces a raw Firebase code, document id, or internal detail.

export function jobSaveErrorMessage(err) {
  if (err?.blocked) return "Saving is disabled in this mode — nothing was added.";
  const code = err?.code ?? "";
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return "You do not have permission to add this. Nothing was added.";
  }
  return "Could not add this. Nothing was added — please try again.";
}

export function technicianSaveErrorMessage(err) {
  if (err?.blocked) return "Saving is disabled in this mode — no technician was added.";
  const code = err?.code ?? "";
  if (code === "permission-denied" || code === "firestore/permission-denied") {
    return "You do not have permission to add a technician. No technician was added.";
  }
  return "Could not add this technician. No technician was added — please try again.";
}
