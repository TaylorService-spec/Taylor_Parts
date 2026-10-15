"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.minorOf = exports.isoOf = exports.personOf = exports.MAX_COMMERCIAL_PAGE_SIZE = exports.DEFAULT_COMMERCIAL_PAGE_SIZE = exports.salesChannelScopedWithLineage = exports.SALES_CHANNEL_SCOPED = exports.COMMERCIAL_READ_CAPABILITIES = void 0;
exports.refuseOutsideReach = refuseOutsideReach;
exports.translateCommercialReadError = translateCommercialReadError;
exports.runCommercialRead = runCommercialRead;
exports.requireRecordId = requireRecordId;
exports.requirePageSize = requirePageSize;
exports.requireEnumFilter = requireEnumFilter;
exports.optionalAccountId = optionalAccountId;
exports.encodeCommercialCursor = encodeCommercialCursor;
exports.decodeCommercialCursor = decodeCommercialCursor;
exports.pageOf = pageOf;
const commercialCommandKernel_1 = require("../commands/commercialCommandKernel");
const assignmentScopeRuntime_1 = require("../../adminPolicy/assignmentScopeRuntime");
/** The Commercial read capability keys -- the ids the permission catalog already registers. */
exports.COMMERCIAL_READ_CAPABILITIES = Object.freeze({
    OPPORTUNITY_READ: "opportunity.read",
    SALES_AGREEMENT_READ: "salesAgreement.read",
    SALES_ORDER_READ: "salesOrder.read",
});
const GLOBAL_REACH = Object.freeze({
    global: true,
    channelsFor: () => null,
    admits: () => true,
});
/** Lane GA: the Commercial reads honour a salesChannel-scoped holding against the record's stored channel. */
exports.SALES_CHANNEL_SCOPED = Object.freeze({ recordScope: "salesChannel" });
/** SALES_CHANNEL_SCOPED, plus the lineage keys a detail read discloses (Pass 10 P10-4). */
const salesChannelScopedWithLineage = (lineageCapabilities) => Object.freeze({ recordScope: "salesChannel", lineageCapabilities: Object.freeze([...lineageCapabilities]) });
exports.salesChannelScopedWithLineage = salesChannelScopedWithLineage;
/** The refusal a scoped holder gets for a record outside its channels: the SAME words a missing record gets. */
function refuseOutsideReach(family) {
    return (0, commercialCommandKernel_1.fail)("RECORD_NOT_FOUND", "NOT_FOUND", `the ${family} does not exist in this tenant`);
}
/** Every error leaving a read is a CommercialCommandError. Nothing else crosses the boundary. */
function translateCommercialReadError(err) {
    if (err instanceof commercialCommandKernel_1.CommercialCommandError)
        return err;
    return new commercialCommandKernel_1.CommercialCommandError("READ_FAILED", "FAILED", "the read could not be completed");
}
function requireActor(actor, requiredCapabilities, options) {
    if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
        (0, commercialCommandKernel_1.fail)("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
    }
    if (!(actor.capabilities instanceof Set)) {
        (0, commercialCommandKernel_1.fail)("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
    }
    // GLOBAL FIRST, unchanged. A key absent from the flat set may still be held within sales-channel scopes -- but only
    // a read that opted in, and only through UNCONDITIONED holdings (admittedScopeValues excludes conditioned ones).
    const scoped = options.recordScope === "salesChannel" && Array.isArray(actor.scopedHeld) ? actor.scopedHeld : [];
    const channels = new Map();
    const lineage = (options.lineageCapabilities ?? []).filter((c) => !requiredCapabilities.includes(c));
    for (const c of [...requiredCapabilities, ...lineage]) {
        if (actor.capabilities.has(c))
            continue;
        const admitted = (0, assignmentScopeRuntime_1.admittedScopeValues)(scoped, c, "salesChannel");
        if (admitted.length > 0)
            channels.set(c, Object.freeze([...admitted]));
    }
    const missing = requiredCapabilities.filter((c) => !actor.capabilities.has(c) && !channels.has(c));
    if (missing.length > 0)
        (0, commercialCommandKernel_1.fail)("CAPABILITY_REQUIRED", "FORBIDDEN", `this read requires ${missing.join(", ")}`);
    if (channels.size === 0)
        return GLOBAL_REACH;
    return Object.freeze({
        global: false,
        channelsFor: (c) => channels.get(c) ?? (actor.capabilities.has(c) ? null : Object.freeze([])),
        admits: (c, salesChannel) => {
            if (actor.capabilities.has(c))
                return true;
            const held = channels.get(c);
            return !!held && typeof salesChannel === "string" && salesChannel !== "" && held.includes(salesChannel);
        },
    });
}
/**
 * Run ONE governed Commercial read in ONE read-only snapshot.
 *
 * Order: actor context + capability -> caller input validation (`prepare`) -> connect -> BEGIN READ ONLY -> active
 * principal + active membership -> the read body -> COMMIT. Refusals before `connect` touch no database.
 */
async function runCommercialRead(deps, actor, requiredCapabilities, prepare, body, options = {}) {
    let client;
    try {
        const reach = requireActor(actor, requiredCapabilities, options);
        const prepared = prepare();
        client = await deps.pool.connect();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [actor.tenantId, actor.principalId]);
        if (member.rows.length === 0)
            (0, commercialCommandKernel_1.fail)("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
        const result = await body(client, actor.tenantId, prepared, reach);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        throw translateCommercialReadError(err);
    }
    finally {
        client?.release();
    }
}
// ════════════════════ caller input ════════════════════
function requireRecordId(value, field) {
    if (typeof value !== "string" || value.trim() === "" || value.length > 200) {
        (0, commercialCommandKernel_1.fail)("RECORD_ID_REQUIRED", "INVALID_INPUT", `${field} is required`);
    }
    return value.trim();
}
exports.DEFAULT_COMMERCIAL_PAGE_SIZE = 50;
exports.MAX_COMMERCIAL_PAGE_SIZE = 200;
/** Absent takes the default; present but invalid REFUSES -- a caller asking for 9999 is never quietly handed 50. */
function requirePageSize(value) {
    if (value === undefined)
        return exports.DEFAULT_COMMERCIAL_PAGE_SIZE;
    if (!Number.isSafeInteger(value) || value <= 0 || value > exports.MAX_COMMERCIAL_PAGE_SIZE) {
        (0, commercialCommandKernel_1.fail)("PAGE_SIZE_INVALID", "INVALID_INPUT", `limit must be a positive integer no greater than ${exports.MAX_COMMERCIAL_PAGE_SIZE}`);
    }
    return value;
}
/** An optional EQUALS / IN filter over ONE governed enum. Values are checked against the allowlist, never passed through. */
function requireEnumFilter(value, field, allowed) {
    if (value === undefined)
        return null;
    const values = typeof value === "string" ? [value] : value;
    if (!Array.isArray(values) || values.length === 0 || values.length > allowed.length || !values.every((v) => typeof v === "string" && allowed.includes(v))) {
        (0, commercialCommandKernel_1.fail)("FILTER_INVALID", "INVALID_INPUT", `${field} must be one of, or a non-empty array of, ${allowed.join(", ")}`);
    }
    return [...new Set(values)];
}
function optionalAccountId(value) {
    if (value === undefined)
        return null;
    return requireRecordId(value, "accountId");
}
const CURSOR_VERSION = 1;
/** Opaque to callers; NOT secret and NOT signed. It can only reposition inside an already-authorized ordering. */
function encodeCommercialCursor(family, cursor) {
    return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, f: family, n: cursor.number, id: cursor.id }), "utf8").toString("base64url");
}
/** A structurally invalid cursor refuses; it is never read as "start from the beginning". */
function decodeCommercialCursor(family, raw) {
    if (raw === undefined)
        return null;
    const invalid = () => (0, commercialCommandKernel_1.fail)("CURSOR_INVALID", "INVALID_INPUT", "cursor is not a valid position for this list");
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 1024)
        return invalid();
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    }
    catch {
        return invalid();
    }
    const r = parsed;
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).sort().join(",") !== "f,id,n,v")
        return invalid();
    if (r.v !== CURSOR_VERSION || r.f !== family || typeof r.n !== "string" || r.n === "" || typeof r.id !== "string" || r.id === "") {
        return invalid();
    }
    return { number: r.n, id: r.id };
}
/** Rows come back limit + 1; the extra row is the truthful "there is more". */
function pageOf(family, rows, limit, numberOf, project) {
    const truncated = rows.length > limit;
    const kept = rows.slice(0, limit);
    const last = kept[kept.length - 1];
    return {
        items: kept.map(project),
        truncated,
        nextCursor: truncated && last ? encodeCommercialCursor(family, { number: numberOf(last), id: last.id }) : null,
    };
}
const personOf = (employeeId, resolved) => employeeId === null ? null : { employeeId, displayName: null, resolved: resolved === true };
exports.personOf = personOf;
const isoOf = (d) => (d === null ? null : d.toISOString());
exports.isoOf = isoOf;
const minorOf = (v) => (v === null ? null : Number(v));
exports.minorOf = minorOf;
//# sourceMappingURL=commercialReadKernel.js.map