// ACCOUNT OWNER CHANGES AGAINST THE GOVERNED POSTGRESQL CRM (platform-sandbox builds only).
//
// PURE: no Firebase, no transport. Consumed by the EOS API Account writer (domain/crm/eosApi/accounts.js), the Account
// form's platform-sandbox owner controls, and the ownership-history section. The legacy Firestore path never uses it.
//
// Mirrors the server authority (functions/src/eosCrm/accountAuthority.ts, updateAccount + listAccountOwnershipHistory):
//   * same owner                    no owner fields are sent (no history row);
//   * owner A -> different owner B  OWNER_HANDOFF: ownerEmployeeId + ownershipHandoff { source, reason? },
//                                   source one of ACCOUNT_OWNERSHIP_HANDOFF_SOURCES (default DIRECT_HANDOFF);
//   * NO owner -> owner B           INITIAL_OWNER_ASSIGNMENT: ownerEmployeeId (+ ownershipHandoff { reason } only when a
//                                   reason is given) -- a source is NEVER sent (the server refuses
//                                   INITIAL_OWNER_ASSIGNMENT_SOURCE_NOT_ALLOWED);
//   * owner -> no owner             never sent: the server refuses OWNER_REQUIRED, so the client refuses first.
// The server reads the current owner under lock and decides the recorded event; this only shapes what the form asks for.
//
// Module constants are annotated pure so a build that never routes to the EOS API drops this module entirely.

export const ACCOUNT_OWNERSHIP_HANDOFF_SOURCES = /* @__PURE__ */ Object.freeze(["DIRECT_HANDOFF", "CUSTOMER_HANDOFF_REVIEW", "ADMIN_CORRECTION"]);
export const DEFAULT_ACCOUNT_OWNERSHIP_HANDOFF_SOURCE = "DIRECT_HANDOFF";
export const ACCOUNT_OWNERSHIP_HANDOFF_SOURCE_LABEL = /* @__PURE__ */ Object.freeze({
  DIRECT_HANDOFF: "Direct handoff",
  CUSTOMER_HANDOFF_REVIEW: "Customer handoff review",
  ADMIN_CORRECTION: "Admin correction",
});
/** The server's MAX_ACCOUNT_HANDOFF_REASON_LENGTH. */
export const MAX_ACCOUNT_HANDOFF_REASON_LENGTH = 500;

export const ACCOUNT_OWNER_CHANGE = /* @__PURE__ */ Object.freeze({
  NONE: "NONE",
  OWNER_HANDOFF: "OWNER_HANDOFF",
  INITIAL_OWNER_ASSIGNMENT: "INITIAL_OWNER_ASSIGNMENT",
  CLEAR_REFUSED: "CLEAR_REFUSED",
});

export const ACCOUNT_OWNERSHIP_EVENT_LABEL = /* @__PURE__ */ Object.freeze({
  OWNER_HANDOFF: "Owner handoff",
  INITIAL_OWNER_ASSIGNMENT: "First owner assigned",
});

const idOrNull = (value) => (typeof value === "string" && value !== "" ? value : null);

/**
 * What an edit asks of the owner.
 * @returns {{ kind: string, input: object | null }} `input` is the owner part of the updateAccount input, or null.
 */
export function accountOwnerChange({ previousOwnerEmployeeId = null, nextOwnerEmployeeId = null, source = null, reason = null } = {}) {
  const previous = idOrNull(previousOwnerEmployeeId);
  const next = idOrNull(nextOwnerEmployeeId);
  const trimmedReason = typeof reason === "string" && reason.trim() !== "" ? reason.trim() : null;
  if (next === previous) return { kind: ACCOUNT_OWNER_CHANGE.NONE, input: null };
  if (next === null) return { kind: ACCOUNT_OWNER_CHANGE.CLEAR_REFUSED, input: null };
  if (previous === null) {
    return {
      kind: ACCOUNT_OWNER_CHANGE.INITIAL_OWNER_ASSIGNMENT,
      input: { ownerEmployeeId: next, ...(trimmedReason ? { ownershipHandoff: { reason: trimmedReason } } : {}) },
    };
  }
  const chosen = ACCOUNT_OWNERSHIP_HANDOFF_SOURCES.includes(source) ? source : DEFAULT_ACCOUNT_OWNERSHIP_HANDOFF_SOURCE;
  return {
    kind: ACCOUNT_OWNER_CHANGE.OWNER_HANDOFF,
    input: { ownerEmployeeId: next, ownershipHandoff: { source: chosen, ...(trimmedReason ? { reason: trimmedReason } : {}) } },
  };
}
