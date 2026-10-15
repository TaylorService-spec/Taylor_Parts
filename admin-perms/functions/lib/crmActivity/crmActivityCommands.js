"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OCCURRED_AT_FUTURE_TOLERANCE_MILLIS = exports.MAX_BODY_LENGTH = exports.CrmActivityCommandError = exports.CRM_ACTIVITY_TYPES = void 0;
exports.buildCreateCrmActivity = buildCreateCrmActivity;
// CRM Activity / Notes — PURE governed write core (Taylor EOS Wave 7 extension, PART 1.4). No Firestore /
// firebase-functions imports — framework-independent, unit-tested offline exactly like
// salesOrder/salesOrderCommands.ts. Builds the field map the callable persists; enforces the ratified
// invariants below. No mutation, no I/O.
//
// SCOPE: this record owns the CRM interaction ONLY. It references Account (required) / Contact /
// Opportunity / Sales Order by id — it never duplicates or contradicts their own authoritative fields (no
// customer name, no opportunity stage, no sales order total; those stay resolved from their own canonical
// authority by the reader, exactly like SalesOrderProjection's own "accountId only, no Customer name" rule).
//
// PART 1.5 SEAM (do not build here): a dated follow-up / next-action is a SEPARATE roadmap capability
// (Exception Ownership / Operational Accountability) and is NOT authorized by this PR. This record
// therefore has NO assignee, NO due date, NO completion state, NO status workflow field — full stop. If a
// future change adds one of those fields to this module, that is PART 1.5 (or later), not this one.
const crmActivityTypes_1 = require("./crmActivityTypes");
var crmActivityTypes_2 = require("./crmActivityTypes");
Object.defineProperty(exports, "CRM_ACTIVITY_TYPES", { enumerable: true, get: function () { return crmActivityTypes_2.CRM_ACTIVITY_TYPES; } });
class CrmActivityCommandError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CrmActivityCommandError";
    }
}
exports.CrmActivityCommandError = CrmActivityCommandError;
// A note body has to stay a note, not a document -- bounded well above any realistic single interaction
// summary while still refusing an unbounded blob (the exact failure mode account.notes has today).
exports.MAX_BODY_LENGTH = 4000;
// Clock-skew tolerance for a caller-supplied occurredAt. occurredAt records a REAL past/present
// interaction ("when the interaction happened," possibly backdated) -- it is NOT a scheduled future
// action (that is PART 1.5's, not this record's). A small tolerance absorbs ordinary client/server clock
// drift without opening the field up to "log an activity for next Tuesday."
exports.OCCURRED_AT_FUTURE_TOLERANCE_MILLIS = 5 * 60 * 1000;
const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
// Build a NEW CRM Activity. `actorUid`/`nowMillis` come from the callable (server-derived, never
// client-supplied) -- mirrors buildCreateSalesOrder's own ctx contract exactly.
function buildCreateCrmActivity(input, ctx) {
    if (!input || typeof input !== "object")
        throw new CrmActivityCommandError("INVALID", "Missing input");
    if (!nonEmptyStr(input.accountId))
        throw new CrmActivityCommandError("ACCOUNT_REQUIRED", "accountId is required");
    if (!crmActivityTypes_1.CRM_ACTIVITY_TYPES.includes(input.type)) {
        throw new CrmActivityCommandError("TYPE_INVALID", `type must be one of ${crmActivityTypes_1.CRM_ACTIVITY_TYPES.join("/")}`);
    }
    if (!nonEmptyStr(input.body))
        throw new CrmActivityCommandError("BODY_REQUIRED", "body is required");
    const body = input.body.trim();
    if (body.length > exports.MAX_BODY_LENGTH) {
        throw new CrmActivityCommandError("BODY_TOO_LONG", `body must not exceed ${exports.MAX_BODY_LENGTH} characters`);
    }
    let occurredAtMillis = ctx.nowMillis;
    if (input.occurredAtMillis !== undefined) {
        if (typeof input.occurredAtMillis !== "number" || !Number.isFinite(input.occurredAtMillis)) {
            throw new CrmActivityCommandError("OCCURRED_AT_INVALID", "occurredAtMillis must be a finite number when present");
        }
        if (input.occurredAtMillis > ctx.nowMillis + exports.OCCURRED_AT_FUTURE_TOLERANCE_MILLIS) {
            throw new CrmActivityCommandError("OCCURRED_AT_FUTURE", "occurredAtMillis cannot be materially in the future");
        }
        occurredAtMillis = input.occurredAtMillis;
    }
    return {
        accountId: input.accountId.trim(),
        contactId: nonEmptyStr(input.contactId) ? input.contactId.trim() : null,
        opportunityId: nonEmptyStr(input.opportunityId) ? input.opportunityId.trim() : null,
        salesOrderId: nonEmptyStr(input.salesOrderId) ? input.salesOrderId.trim() : null,
        type: input.type,
        body,
        occurredAtMillis,
        createdByUid: ctx.actorUid,
        createdAtMillis: ctx.nowMillis,
    };
}
//# sourceMappingURL=crmActivityCommands.js.map