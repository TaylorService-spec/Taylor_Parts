"use strict";
// Sales Opportunity — PURE governed write core (framework-independent; unit-tested). Builds the field maps
// the callable persists; enforces the ratified business rules. No Firestore/firebase-functions imports, so
// the rules are testable in isolation and the callable layer only supplies I/O + auth.
//
// INVARIANTS (fail-closed): Opportunity is PRE-COMMITMENT. Solution lines are PRODUCT-level (EQUIPMENT_MODEL/
// PART/SERVICE) — a serialized Equipment asset is NEVER a line (assigned downstream of WON -> Sales Order ->
// fulfillment). owner is a canonical Employee ref (ownerEmployeeId), not free text or a UID. Creation always
// starts at IDENTIFIED, open (no outcome). Transitions are validated by checkTransition().
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDITABLE_OPPORTUNITY_FIELDS = exports.OpportunityCommandError = void 0;
exports.buildCreateOpportunity = buildCreateOpportunity;
exports.buildUpdateOpportunity = buildUpdateOpportunity;
exports.buildTransitionPatch = buildTransitionPatch;
const creationOwnerResolution_1 = require("../ownership/creationOwnerResolution");
const accountablePersonStorage_1 = require("../responsibility/accountablePersonStorage");
const commercialCompanyScope_1 = require("../ownership/commercialCompanyScope");
const financialAttribution_1 = require("../finance/financialAttribution");
const opportunityLifecycle_1 = require("./opportunityLifecycle");
class OpportunityCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "OpportunityCommandError";
    }
}
exports.OpportunityCommandError = OpportunityCommandError;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const finiteNum = (v) => typeof v === "number" && Number.isFinite(v);
// Mirrors salesOrderCommands.ts's posInt: both Sales Order creation paths require an INTEGER orderedQty. A
// fractional Opportunity line qty (e.g. 2.5) would pass here but can never seed a Sales Order (QTY_INVALID on
// both paths) — a permanent dead-end once WON, since WON is terminal. Require integer qty at the same points.
const posInt = (v) => finiteNum(v) && v > 0 && Number.isInteger(v);
// A guard that catches the ONE identity mistake that would corrupt the pre-commitment boundary: a line that
// carries a serialized-asset reference. We reject any line that declares a serial explicitly, or whose kind
// is outside the product-level allowlist. `ref` must be a product/model/part/service reference.
function validateLine(line, index) {
    if (!line || typeof line !== "object") {
        throw new OpportunityCommandError("LINE_INVALID", `Line ${index} is not an object`);
    }
    const l = line;
    if (!opportunityLifecycle_1.OPPORTUNITY_LINE_KINDS.includes(l.kind)) {
        throw new OpportunityCommandError("LINE_INVALID", `Line ${index} has an invalid kind`);
    }
    if ("serial" in l || "serialNumber" in l || "serializedAssetId" in l || "equipmentId" in l) {
        throw new OpportunityCommandError("SERIALIZED_LINE_FORBIDDEN", `Line ${index} references a serialized asset; Opportunity lines are product-level only`);
    }
    if (!nonEmpty(l.ref)) {
        throw new OpportunityCommandError("LINE_INVALID", `Line ${index} is missing a product reference`);
    }
    // qty is REQUIRED on every line (not merely validated-if-present): a line without a qty is not persistable.
    // This is the enforcement point that closes the qty-less WON dead-end at its source — a line that can never
    // be created without a valid qty can never reach WON without one either. (See also the WON-outcome guard in
    // buildTransitionPatch below, which defends any opportunity persisted before this rule existed.)
    if (!posInt(l.qty)) {
        throw new OpportunityCommandError("LINE_INVALID", `Line ${index} is missing a valid qty (positive integer)`);
    }
    const out = { kind: l.kind, ref: l.ref.trim(), qty: l.qty };
    return out;
}
// Build the persisted fields for a NEW opportunity. Always IDENTIFIED + open. `actorUid`/`nowMillis` come from
// the callable (request.auth.uid, Date.now) so this stays pure.
function buildCreateOpportunity(input, ctx) {
    if (!input || typeof input !== "object")
        throw new OpportunityCommandError("INVALID", "Missing input");
    if (!nonEmpty(input.accountId))
        throw new OpportunityCommandError("ACCOUNT_REQUIRED", "accountId is required");
    // Ruling D-4. The OWNER_REQUIRED error code is preserved on the refusal path -- a caller that
    // supplies nothing and has nothing to inherit still fails with the same code it always did, so
    // existing error handling keeps working; only the message gained the reason.
    let resolvedOwner;
    try {
        resolvedOwner = (0, creationOwnerResolution_1.resolveCreationOwner)(input.ownerEmployeeId, input.inheritedOwner, "the Account");
    }
    catch (e) {
        throw new OpportunityCommandError("OWNER_REQUIRED", e.message);
    }
    if (!(0, opportunityLifecycle_1.isChannel)(input.salesChannel))
        throw new OpportunityCommandError("CHANNEL_INVALID", "salesChannel is invalid");
    if (input.expectedValue !== undefined && input.expectedValue !== null && !finiteNum(input.expectedValue)) {
        throw new OpportunityCommandError("INVALID", "expectedValue must be a number or null");
    }
    if (input.expectedCloseAt !== undefined && input.expectedCloseAt !== null && !finiteNum(input.expectedCloseAt)) {
        throw new OpportunityCommandError("INVALID", "expectedCloseAt must be an epoch-ms number or null");
    }
    const lines = Array.isArray(input.lines) ? input.lines.map((l, i) => validateLine(l, i)) : [];
    // #184: the builder VERIFIES that the accountable person came from a governed establishment; it does
    // not establish one. A value without the governed mark is refused rather than written, so there is
    // no path from a caller-supplied id to persisted accountability that skips the authority.
    if (input.accountablePerson !== undefined && !(0, accountablePersonStorage_1.isGovernedAccountablePerson)(input.accountablePerson)) {
        throw new OpportunityCommandError("ACCOUNTABLE_PERSON_NOT_GOVERNED", "accountablePerson must be the result of a governed establishment " +
            "(responsibility/accountablePersonEstablishment.ts). An id, a plain object, or a serialized " +
            "copy is not evidence that the Employee authority was consulted (#184, #182 s5).");
    }
    const accountability = input.accountablePerson === undefined ? {} : (0, accountablePersonStorage_1.accountablePersonFields)(input.accountablePerson);
    return {
        accountId: input.accountId.trim(),
        ...accountability,
        ownerEmployeeId: resolvedOwner.ownerEmployeeId,
        salesChannel: input.salesChannel,
        operatingCompanyId: (0, commercialCompanyScope_1.resolveCommercialCompanyScope)(input.operatingCompanyId),
        // Explicit credit wins; otherwise the governed commercial owner at chain entry. Never the
        // actor: `ctx.actorUid` deliberately does not appear in this expression.
        creditedSalespersonId: (0, financialAttribution_1.resolveCreditedSalesperson)(input.creditedSalespersonId, null, resolvedOwner.ownerEmployeeId),
        stage: "IDENTIFIED",
        outcome: null,
        need: nonEmpty(input.need) ? input.need.trim() : null,
        expectedValue: finiteNum(input.expectedValue) ? input.expectedValue : null,
        expectedCloseAt: finiteNum(input.expectedCloseAt) ? input.expectedCloseAt : null,
        lines,
        createdByUid: ctx.actorUid,
        createdAtMillis: ctx.nowMillis,
        updatedAtMillis: ctx.nowMillis,
    };
}
/** The ordinary-editable fields. Lifecycle fields are deliberately absent. */
exports.EDITABLE_OPPORTUNITY_FIELDS = Object.freeze([
    "accountId",
    "ownerEmployeeId",
    // FIN-002: explicit pre-close credit reassignment rides the SAME governed edit authority as
    // ownership (opportunity.write) -- before the commitment snapshot, credit may move by explicit
    // governed action; after it, changing credit is a FIN-007 attribution adjustment.
    "creditedSalespersonId",
    "salesChannel",
    "need",
    "expectedValue",
    "expectedCloseAt",
    // nextAction was PROJECTED AND DISPLAYED but writable by nothing. The workspace's field
    // model classifies it USER_MAINTAINED and renders it as an editable section, so the surface
    // offered an edit the system could not accept -- the field could be read forever and never
    // corrected. It is an ordinary free-text field on the deal, not a lifecycle position, so it
    // belongs in exactly this set and nowhere else.
    "nextAction",
    "lines",
]);
// Build the field patch for an ordinary edit. Pure: no Firestore, no clock, no identity --
// `actorUid`/`nowMillis` are supplied by the callable, exactly as the other two cores do.
//
// LINES ARE REPLACED WHOLE, not patched element-wise. Add/edit/remove all arrive as the new
// array. That is the honest shape for an ARRAY FIELD ON THE DOCUMENT (which is where lines
// live -- there is no line subcollection): a per-line command would have to re-read, splice
// and write the same array anyway, while inviting the belief that two concurrent line edits
// merge. They do not. Whole-array replacement under the version check makes the conflict
// visible instead of silently losing one of them.
function buildUpdateOpportunity(current, input, ctx) {
    if (!input || typeof input !== "object")
        throw new OpportunityCommandError("INVALID", "Missing input");
    if (!nonEmpty(input.opportunityId))
        throw new OpportunityCommandError("INVALID", "opportunityId is required");
    if (!current || !(0, opportunityLifecycle_1.isStage)(current.stage))
        throw new OpportunityCommandError("INVALID", "Invalid current state");
    // ACCOUNTABILITY IS NOT AN ORDINARY FIELD, and this REFUSES rather than ignores.
    //
    // `EDITABLE_OPPORTUNITY_FIELDS` does not contain the accountable person, so the field could never
    // have been written by this command -- the patch is built key by key from named fields. But silently
    // dropping it would tell a caller its change succeeded when nothing moved, and a UI built on that
    // belief would ship a control that does nothing. #184 is also explicit that the answer to a mutation
    // path outside the governed boundary is to "eliminate or refuse the bypass", and a refusal names
    // where the change belongs: the governed responsibility handoff boundary, which reads the
    // authoritative previous value, authorizes the caller, and stages an audit record. None of which
    // this command does.
    const attempted = input;
    if (accountablePersonStorage_1.ACCOUNTABLE_PERSON_FIELD in attempted || accountablePersonStorage_1.ACCOUNTABLE_PERSON_SOURCE_FIELD in attempted) {
        throw new OpportunityCommandError("ACCOUNTABLE_PERSON_NOT_EDITABLE", "the accountable person cannot be changed by an ordinary edit. Changing ACCOUNTABILITY is a " +
            "governed responsibility handoff (#184 OD-7, #187 M-1) -- it requires an authoritative " +
            "Employee resolution, a current-eligibility verdict, caller authorization and an audit record, " +
            "and it does not move RECORD OWNERSHIP with it (#181).");
    }
    // A closed Opportunity is a historical record. WON and LOST are terminal, and editing the
    // deal terms of a WON Opportunity would silently disagree with the Sales Order already
    // derived from them.
    if (current.outcome === "WON" || current.outcome === "LOST") {
        throw new OpportunityCommandError("CLOSED", `Opportunity is ${current.outcome} and cannot be edited`);
    }
    // OPTIMISTIC CONCURRENCY. Compared before anything is built, so a stale writer is rejected
    // rather than validated and then rejected -- and so the error a caller sees is the real one.
    if (!finiteNum(input.expectedUpdatedAtMillis)) {
        throw new OpportunityCommandError("INVALID", "expectedUpdatedAtMillis is required");
    }
    const currentVersion = finiteNum(current.updatedAtMillis) ? current.updatedAtMillis : 0;
    if (currentVersion !== input.expectedUpdatedAtMillis) {
        throw new OpportunityCommandError("VERSION_CONFLICT", "This Opportunity changed since it was loaded. Reload and reapply your edit.");
    }
    const patch = {};
    const changes = [];
    const record = (field, before, after) => {
        patch[field] = after;
        changes.push({ field, before: before ?? null, after: after ?? null });
    };
    const cur = current;
    if (input.accountId !== undefined) {
        if (!nonEmpty(input.accountId))
            throw new OpportunityCommandError("ACCOUNT_REQUIRED", "accountId cannot be empty");
        if (input.accountId !== cur.accountId)
            record("accountId", cur.accountId, input.accountId);
    }
    if (input.ownerEmployeeId !== undefined) {
        if (!nonEmpty(input.ownerEmployeeId)) {
            throw new OpportunityCommandError("OWNER_REQUIRED", "ownerEmployeeId cannot be empty");
        }
        if (input.ownerEmployeeId !== cur.ownerEmployeeId) {
            record("ownerEmployeeId", cur.ownerEmployeeId, input.ownerEmployeeId);
        }
    }
    if (input.creditedSalespersonId !== undefined) {
        // Explicit reassignment only -- an edit never re-derives credit from ownership, and moving the
        // OWNER above deliberately does NOT move credit (OWNERSHIP != SALES CREDIT).
        if (!nonEmpty(input.creditedSalespersonId)) {
            throw new OpportunityCommandError("INVALID", "creditedSalespersonId cannot be empty");
        }
        if (input.creditedSalespersonId !== cur.creditedSalespersonId) {
            record("creditedSalespersonId", cur.creditedSalespersonId ?? null, input.creditedSalespersonId);
        }
    }
    if (input.salesChannel !== undefined) {
        if (!(0, opportunityLifecycle_1.isChannel)(input.salesChannel)) {
            throw new OpportunityCommandError("CHANNEL_INVALID", "salesChannel is not a recognized channel");
        }
        if (input.salesChannel !== cur.salesChannel)
            record("salesChannel", cur.salesChannel, input.salesChannel);
    }
    if (input.need !== undefined) {
        const next = nonEmpty(input.need) ? input.need : null;
        if (next !== (cur.need ?? null))
            record("need", cur.need ?? null, next);
    }
    if (input.expectedValue !== undefined) {
        const next = input.expectedValue === null ? null : input.expectedValue;
        if (next !== null && !finiteNum(next)) {
            throw new OpportunityCommandError("INVALID", "expectedValue must be a number or null");
        }
        if (next !== (cur.expectedValue ?? null))
            record("expectedValue", cur.expectedValue ?? null, next);
    }
    if (input.expectedCloseAt !== undefined) {
        const next = input.expectedCloseAt === null ? null : input.expectedCloseAt;
        if (next !== null && !finiteNum(next)) {
            throw new OpportunityCommandError("INVALID", "expectedCloseAt must be a number or null");
        }
        if (next !== (cur.expectedCloseAt ?? null))
            record("expectedCloseAt", cur.expectedCloseAt ?? null, next);
    }
    if (input.nextAction !== undefined) {
        // Same absent/null/blank handling as `need`: blank clears rather than storing "".
        const next = nonEmpty(input.nextAction) ? input.nextAction : null;
        if (next !== null && typeof next !== "string") {
            throw new OpportunityCommandError("INVALID", "nextAction must be a string or null");
        }
        if (next !== (cur.nextAction ?? null))
            record("nextAction", cur.nextAction ?? null, next);
    }
    if (input.lines !== undefined) {
        if (!Array.isArray(input.lines))
            throw new OpportunityCommandError("LINE_INVALID", "lines must be an array");
        // Reuses validateLine -- the SAME product-level guard creation uses. A serialized-asset
        // reference is rejected on edit exactly as it is on create; there is no second, looser
        // path into the lines array.
        const nextLines = input.lines.map((l, i) => validateLine(l, i));
        record("lines", cur.lines ?? [], nextLines);
    }
    if (changes.length === 0) {
        throw new OpportunityCommandError("NO_CHANGES", "No editable field changed");
    }
    patch.updatedByUid = ctx.actorUid;
    patch.updatedAtMillis = ctx.nowMillis;
    return { patch, changes };
}
// Build the field patch for a transition, after validating legality against the ratified graph. Throws an
// OpportunityCommandError (fail-closed) on any illegal transition; the callable maps the code to an HttpsError.
function buildTransitionPatch(current, intent, ctx) {
    if (!current || !(0, opportunityLifecycle_1.isStage)(current.stage))
        throw new OpportunityCommandError("INVALID", "Invalid current state");
    if (intent.kind === "OUTCOME" && intent.outcome === "WON") {
        if (!Array.isArray(current.lines) || current.lines.length === 0) {
            throw new OpportunityCommandError("NO_LINES", "Opportunity requires at least one line before it can be WON");
        }
        // Defense in depth for opportunities that were persisted before qty became required at line-creation time
        // (validateLine): WON is terminal/irreversible with no line-edit/reopen path, and downstream
        // createSalesOrderFromOpportunity fails closed forever on a qty-less line, so a qty-less line must never
        // be allowed to reach WON in the first place.
        const badIndex = current.lines.findIndex((l) => !posInt(l?.qty));
        if (badIndex !== -1) {
            throw new OpportunityCommandError("LINE_QTY_REQUIRED_FOR_WON", `Opportunity line ${badIndex} is missing a valid qty (positive integer); WON requires every line to carry one`);
        }
    }
    const check = (0, opportunityLifecycle_1.checkTransition)({ stage: current.stage, outcome: current.outcome ?? null }, intent);
    if (!check.ok) {
        const msg = check.code === "ALREADY_CLOSED"
            ? "Opportunity is already closed (WON/LOST)"
            : check.code === "OUTCOME_REQUIRES_DECISION"
                ? "WON can only be set from the DECISION stage"
                : check.code === "ILLEGAL_TRANSITION"
                    ? "Only a single forward stage advance is permitted"
                    : "Invalid transition";
        throw new OpportunityCommandError(check.code, msg);
    }
    if (intent.kind === "ADVANCE") {
        return { stage: intent.toStage, outcome: null, updatedByUid: ctx.actorUid, updatedAtMillis: ctx.nowMillis };
    }
    // OUTCOME: stage stays at its current value; outcome closes the opportunity.
    return {
        stage: current.stage,
        outcome: intent.outcome,
        closedAtMillis: ctx.nowMillis,
        updatedByUid: ctx.actorUid,
        updatedAtMillis: ctx.nowMillis,
    };
}
//# sourceMappingURL=opportunityCommands.js.map