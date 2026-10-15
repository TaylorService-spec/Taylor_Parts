"use strict";
// ASSISTANT CONTEXT. What the client is allowed to say about where the user is.
//
// ============================ WHAT THE CLIENT MAY AND MAY NOT SEND ============================
//
// The client sends LOCATION and INTENT: which screen, which record, what was asked. The server
// derives AUTHORITY: which Roles, which capabilities, which company. Nothing a browser asserts is
// ever treated as permission, and that split is the reason this type has the fields it has and not
// the obvious convenient ones.
//
// A `capabilities: string[]` or `roles: string[]` field here would be a privilege-escalation
// primitive with a friendly name. `companyId` is accepted but is VERIFIED against the actor's own
// company server-side, never trusted -- a client naming another tenant is a cross-tenant read
// attempt, and it is rejected rather than honoured.
//
// CONTEXT MINIMISATION. Only what a tool could legitimately need. The record id is enough for the
// server to fetch what the actor may see; sending a pre-loaded record body from the client would
// mean the model receives data EOS never re-authorized.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_HISTORY_TURNS = void 0;
exports.validateAssistantContext = validateAssistantContext;
exports.historyIsInScope = historyIsInScope;
/**
 * Recent conversational context is capped deliberately.
 *
 * An unbounded transcript is three problems at once: cost that grows without limit, a widening
 * surface for injected instructions to persist across turns, and protected data from earlier turns
 * outliving the authorization that permitted it. Six turns is enough for "and what about the other
 * one?" and short enough that nothing lingers.
 */
exports.MAX_HISTORY_TURNS = 6;
/**
 * Validate a client-supplied context.
 *
 * Rejects rather than sanitises. A context that names another tenant, or carries a field this
 * contract does not define, is a request to be refused rather than trimmed -- trimming would let a
 * caller keep probing for a field that IS honoured.
 */
function validateAssistantContext(input, verified) {
    const failures = [];
    const c = (input ?? {});
    if (typeof c.question !== "string" || c.question.trim().length === 0) {
        failures.push({ field: "question", reason: "a question is required" });
    }
    if (typeof c.conversationId !== "string" || c.conversationId.length === 0) {
        failures.push({ field: "conversationId", reason: "a conversation id is required" });
    }
    // THE TENANT CHECK. Not a formatting rule -- a cross-tenant read attempt.
    if (typeof c.companyId === "string" && c.companyId !== verified.companyId) {
        failures.push({ field: "companyId", reason: "context company does not match the authenticated actor" });
    }
    if (typeof c.actorUid === "string" && c.actorUid !== verified.actorUid) {
        failures.push({ field: "actorUid", reason: "context actor does not match the authenticated caller" });
    }
    // A client sending authority-shaped fields is refused loudly. Silently dropping them would let a
    // caller keep trying variations until one is honoured.
    for (const forbidden of ["capabilities", "roles", "permissions", "effectiveAuthority", "isAdmin"]) {
        if (forbidden in c) {
            failures.push({ field: forbidden, reason: "authority is derived server-side and must not be supplied" });
        }
    }
    if (failures.length > 0)
        return { ok: false, failures };
    const history = Array.isArray(c.history) ? c.history.slice(-exports.MAX_HISTORY_TURNS) : [];
    return {
        ok: true,
        context: {
            companyId: verified.companyId,
            actorUid: verified.actorUid,
            route: typeof c.route === "string" ? c.route : "",
            surface: (typeof c.surface === "string" ? c.surface : "UNKNOWN"),
            record: c.record && typeof c.record === "object" && typeof c.record.id === "string"
                ? { type: c.record.type, id: c.record.id }
                : null,
            subView: typeof c.subView === "string" ? c.subView : null,
            question: c.question.trim(),
            conversationId: c.conversationId,
            history: history,
        },
    };
}
/**
 * Is prior conversation still usable for this turn?
 *
 * CONVERSATION ISOLATION. Moving from Customer A to Customer B must not leave A's protected context
 * reachable, and the cheap mistake is to keep history because the conversation id did not change.
 * The boundary is (company, actor, conversation, RECORD): change the record and history is dropped.
 *
 * Dropping is the fail-safe direction. Losing "and what about the other one?" is an inconvenience;
 * carrying Customer A's balances into a question about Customer B is a disclosure.
 */
function historyIsInScope(previous, next) {
    if (!previous)
        return false;
    if (previous.companyId !== next.companyId)
        return false;
    if (previous.actorUid !== next.actorUid)
        return false;
    if (previous.conversationId !== next.conversationId)
        return false;
    const prevRecord = previous.record ? previous.record.type + ":" + previous.record.id : null;
    const nextRecord = next.record ? next.record.type + ":" + next.record.id : null;
    return prevRecord === nextRecord;
}
//# sourceMappingURL=assistantContext.js.map