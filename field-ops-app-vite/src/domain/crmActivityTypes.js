// CRM Activity / Notes — the governed activity `type` enum (Taylor EOS Wave 7 extension, PART 1.4). PURE,
// dependency-free. Mirrors functions/src/crmActivity/crmActivityTypes.ts (hand-mirrored -- no shared/
// monorepo tooling in this repo, matching every other domain/functions type-mirror pair).
//
// Five values, chosen to cover the CRM interaction shapes this build authorizes without inventing a
// task/workflow taxonomy (that stays PART 1.5's, unbuilt, seam):
//   SALES_NOTE   -- a free-text note tied to active sales pursuit. Governed replacement path for what
//                    account.notes (a single free-text blob) conflates into one field today.
//   CALL         -- a phone/voice interaction with the account.
//   MEETING      -- an in-person or scheduled video interaction.
//   RELATIONSHIP -- a relationship-maintenance touch not tied to a specific commercial artifact/pursuit.
//   GENERAL      -- catch-all for an interaction that does not cleanly fit the above.
export const CRM_ACTIVITY_TYPES = Object.freeze(["SALES_NOTE", "CALL", "MEETING", "RELATIONSHIP", "GENERAL"]);

export const CRM_ACTIVITY_TYPE_LABELS = Object.freeze({
  SALES_NOTE: "Sales Note",
  CALL: "Call",
  MEETING: "Meeting",
  RELATIONSHIP: "Relationship",
  GENERAL: "General",
});

export function isCrmActivityType(value) {
  return typeof value === "string" && CRM_ACTIVITY_TYPES.includes(value);
}

export function crmActivityTypeLabel(type) {
  return CRM_ACTIVITY_TYPE_LABELS[type] ?? "Activity";
}
