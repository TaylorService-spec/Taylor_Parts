// Issue #325 / ADR-007 W-SAVE-UI foundation -- the pure, IN-MEMORY saved-report store.
//
// A "store" is just an ordered array of saved reports (savedReportModel.js) held in client state
// (React useState). Every operation is PURE and NON-MUTATING: it returns a NEW array, never edits
// the input. There is NO persistence here -- no Firestore, no collection, no Rules (that is
// W-SAVE / D-RULES, a later lane). Ids/timestamps are INJECTED by the caller so the store is
// deterministic under test.
//
// Private by owner (Spec §9): reads are owner-scoped, and rename/duplicate/delete never touch a
// report owned by someone else (fail-closed no-op if the id isn't the owner's).
import { createSavedReport, duplicateName } from "./savedReportModel.js";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

// Only the owner's own reports, newest-updated first. Never leaks another principal's reports.
export function reportsForOwner(reports, ownerUid) {
  const list = Array.isArray(reports) ? reports : [];
  return list.filter((r) => r && r.ownerUid === ownerUid).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSavedReport(reports, id, ownerUid) {
  const list = Array.isArray(reports) ? reports : [];
  return list.find((r) => r && r.id === id && r.ownerUid === ownerUid) ?? null;
}

// Create a new saved report for `ownerUid` from a report definition. Returns a NEW store array.
export function createInStore(reports, { id, name, ownerUid, definition, now }) {
  const list = Array.isArray(reports) ? reports : [];
  return [...list, createSavedReport({ id, name, ownerUid, definition, now })];
}

// Rename the owner's report `id`. No-op (returns the same-shaped list) if the id isn't the owner's.
export function renameInStore(reports, id, ownerUid, name, now) {
  const list = Array.isArray(reports) ? reports : [];
  return list.map((r) =>
    r && r.id === id && r.ownerUid === ownerUid
      ? Object.freeze({ ...r, name, updatedAt: now })
      : r,
  );
}

// Duplicate the owner's report `id` as a new report (new id, "Copy of ..." name, same definition,
// same owner). No-op if the source isn't the owner's. `newId`/`now` injected.
export function duplicateInStore(reports, id, ownerUid, { newId, now }) {
  const list = Array.isArray(reports) ? reports : [];
  const source = list.find((r) => r && r.id === id && r.ownerUid === ownerUid);
  if (!source) return list;
  return [
    ...list,
    createSavedReport({
      id: newId,
      name: duplicateName(source.name),
      ownerUid,
      definition: source.definition,
      now,
    }),
  ];
}

// Delete the owner's report `id`. No-op if the id isn't the owner's.
export function deleteFromStore(reports, id, ownerUid) {
  const list = Array.isArray(reports) ? reports : [];
  return list.filter((r) => !(r && r.id === id && r.ownerUid === ownerUid));
}

// A stable, unique display name check the UI uses to avoid silent duplicate names within an owner's
// own set (not a hard validation rule -- duplicates are allowed, this just powers a soft warning).
export function ownerHasReportNamed(reports, ownerUid, name) {
  if (!isNonEmptyString(name)) return false;
  return reportsForOwner(reports, ownerUid).some((r) => r.name.trim() === name.trim());
}
