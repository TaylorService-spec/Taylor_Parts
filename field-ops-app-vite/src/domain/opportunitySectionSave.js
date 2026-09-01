// Opportunity SECTION SAVE — PURE draft→command mapping (no I/O, no React; unit-tested).
//
// The detail pane edits ONE SECTION AT A TIME (SalesWorkspace's DetailSection). Each section
// binds a draft keyed by the FIELD MODEL's field keys (domain/opportunityFieldModel.js's
// sectionDraft). The governed command (functions/src/opportunity/opportunityCommands.ts's
// buildUpdateOpportunity) names its own input fields. Those two vocabularies are NOT the same,
// and this module is the single place that reconciles them.
//
// Why a module rather than an inline object spread at the call site: the mismatch is small but
// silent. `channel` and `salesChannel` are the same datum under two names, and an inline mapping
// that forgot the rename would send an unknown key — which the command deliberately IGNORES
// rather than rejecting (its own note: "a caller cannot introduce a field by sending it"). The
// save would return success having changed nothing the user asked for. Naming the mapping once,
// and testing it, is what makes that class of failure impossible instead of invisible.
//
// ONLY the edited section's fields are sent. Absent means "leave alone" in the command's
// contract, so a section save can never disturb a field the user was not looking at — which is
// also what keeps two people editing different sections of the same Opportunity from clobbering
// each other's work beyond the version check.

// Field-model key → command input key. Identity for everything not listed.
const FIELD_TO_INPUT = Object.freeze({
  channel: "salesChannel",
});

// The command's editable set (functions/src/opportunity/opportunityCommands.ts's
// EDITABLE_OPPORTUNITY_FIELDS). Mirrored here so a draft key with no home is caught HERE, loudly,
// instead of being dropped silently by the server. Kept in sync by
// test/opportunitySectionSave.test.mjs, which asserts against the real exported list.
export const COMMAND_EDITABLE_FIELDS = Object.freeze([
  "accountId",
  "ownerEmployeeId",
  // FIN-002 (DECISIONS #150): explicit pre-close sales-credit reassignment. Distinct from
  // ownerEmployeeId — OWNERSHIP != SALES CREDIT; moving the owner never moves credit.
  "creditedSalespersonId",
  "salesChannel",
  "need",
  "expectedValue",
  "expectedCloseAt",
  "nextAction",
  "lines",
]);

/**
 * Map one section's draft onto updateOpportunity's input.
 *
 * @returns {{ input: object } | { unsupported: string[] }} — `unsupported` names draft keys the
 * governed command cannot write. Returned rather than thrown, and rather than quietly dropped:
 * a field the surface offers to edit but the command will not accept is a defect in one of the
 * two, and the surface must be able to say so instead of reporting a save that did nothing.
 */
export function buildSectionSaveInput({ opportunityId, expectedUpdatedAtMillis, idempotencyKey, draft }) {
  const input = { opportunityId, expectedUpdatedAtMillis, idempotencyKey };
  const unsupported = [];
  for (const [key, value] of Object.entries(draft ?? {})) {
    const inputKey = FIELD_TO_INPUT[key] ?? key;
    if (!COMMAND_EDITABLE_FIELDS.includes(inputKey)) {
      unsupported.push(key);
      continue;
    }
    input[inputKey] = value;
  }
  return unsupported.length > 0 ? { unsupported } : { input };
}

/**
 * Is this Opportunity editable at all? WON and LOST are terminal — the command refuses them
 * (CLOSED), so offering an Edit affordance would be an invitation to a guaranteed failure. The
 * UI mirrors the rule rather than discovering it by being rejected.
 *
 * This is a MIRROR, not the authority: the server re-checks on every call and is what actually
 * enforces it. Mirroring is how the surface stays honest before the round trip, not a substitute
 * for the round trip.
 */
export function isOpportunityEditable(row) {
  return !!row && row.outcome !== "WON" && row.outcome !== "LOST";
}
