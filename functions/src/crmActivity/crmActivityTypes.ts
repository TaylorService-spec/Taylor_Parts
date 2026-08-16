// CRM Activity / Notes — the governed activity `type` enum (Wave 7 extension PART 1.4). PURE,
// dependency-free (no firebase-admin import) so both crmActivityCommands.ts (write) and
// crmActivityReadService.ts (read) import the SAME single source of truth, and so this module can be
// mirrored verbatim at field-ops-app-vite/src/domain/crmActivityTypes.js (no shared/monorepo tooling in
// this repo — deliberate duplication, matching every other domain/functions type-mirror pair).
//
// Five values, chosen to cover the CRM interaction shapes this build authorizes without inventing a
// task/workflow taxonomy (that stays PART 1.5's, unbuilt, seam):
//   SALES_NOTE   -- a free-text note tied to active sales pursuit. This is the governed, timestamped,
//                    attributed replacement path for what `account.notes` (a single free-text blob on the
//                    Account document) conflates into one field today -- this build does NOT expand that
//                    blob; new sales notes belong here instead.
//   CALL         -- a phone/voice interaction with the account.
//   MEETING      -- an in-person or scheduled video interaction.
//   RELATIONSHIP -- a relationship-maintenance touch not tied to a specific commercial artifact or pursuit
//                    (e.g. a courtesy check-in) -- distinct from SALES_NOTE, which implies active pursuit.
//   GENERAL      -- catch-all for an interaction that does not cleanly fit the above. Never a dumping
//                    ground for follow-up/task semantics -- those fields do not exist on this record.
export type CrmActivityType = "SALES_NOTE" | "CALL" | "MEETING" | "RELATIONSHIP" | "GENERAL";

export const CRM_ACTIVITY_TYPES: readonly CrmActivityType[] = ["SALES_NOTE", "CALL", "MEETING", "RELATIONSHIP", "GENERAL"];

export function isCrmActivityType(value: unknown): value is CrmActivityType {
  return typeof value === "string" && (CRM_ACTIVITY_TYPES as readonly string[]).includes(value);
}
