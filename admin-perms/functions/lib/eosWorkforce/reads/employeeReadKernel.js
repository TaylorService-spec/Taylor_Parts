"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isoOf = exports.MAX_EMPLOYEE_PAGE_SIZE = exports.DEFAULT_EMPLOYEE_PAGE_SIZE = exports.EmployeeReadError = void 0;
exports.refuse = refuse;
exports.translateEmployeeReadError = translateEmployeeReadError;
exports.runEmployeeRead = runEmployeeRead;
exports.acceptOnly = acceptOnly;
exports.requireEmployeeId = requireEmployeeId;
exports.requirePageSize = requirePageSize;
exports.encodeEmployeeCursor = encodeEmployeeCursor;
exports.decodeEmployeeCursor = decodeEmployeeCursor;
// The PURE decision, deliberately: `conditionalEntitlement` carries no SQL, no pool factory and no
// runtime `pg`, so adopting the conditional seam does not widen this kernel's module boundary.
const conditionalEntitlement_1 = require("../../eosOps/conditionalEntitlement");
const contextualAuthorization_1 = require("../../eosOps/contextualAuthorization");
// Assignment scope (lane SC): the PURE scope model -- no SQL, no pool.
const assignmentScopeRuntime_1 = require("../../adminPolicy/assignmentScopeRuntime");
/** Every error leaving an Employee read is one of these. Nothing else crosses the boundary. */
class EmployeeReadError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "EmployeeReadError";
    }
}
exports.EmployeeReadError = EmployeeReadError;
function refuse(code, category, message) {
    throw new EmployeeReadError(code, category, message);
}
function translateEmployeeReadError(err) {
    if (err instanceof EmployeeReadError)
        return err;
    return new EmployeeReadError("READ_FAILED", "FAILED", "the read could not be completed");
}
const GLOBAL_REACH = Object.freeze({
    global: true,
    operatingCompanyIds: Object.freeze([]),
    authorizeEmployee: async () => undefined,
});
function requireActorContext(actor) {
    if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
        refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
    }
    if (!(actor.capabilities instanceof Set))
        refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
    if (!(0, conditionalEntitlement_1.hasResolvedEntitlements)(actor))
        refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved entitlement provider is required");
}
/**
 * Run ONE governed Employee read in ONE read-only snapshot.
 *
 * Order: actor context -> caller input validation (`prepare`) -> the capabilities that input requires ->
 * the CONDITION on each of those capabilities, per granting Role -> connect ->
 * BEGIN READ ONLY -> active principal + active membership -> body -> COMMIT. Refusals before `connect` touch no database.
 */
async function runEmployeeRead(deps, actor, prepare, requiredCapabilities, body, options = {}) {
    let client;
    try {
        requireActorContext(actor);
        const prepared = prepare();
        const required = requiredCapabilities(prepared);
        // A key absent from the flat set may still be held WITHIN AN ASSIGNMENT SCOPE -- but only a read that opted in
        // and can decide it per record honours that. Every other read refuses exactly as it always did.
        const scoped = options.recordScope === "operatingCompany" && Array.isArray(actor.scopedHeld) ? actor.scopedHeld : [];
        const deferred = required.filter((c) => !actor.capabilities.has(c) && scoped.some((h) => h.capabilityKey === c));
        const missing = required.filter((c) => !actor.capabilities.has(c) && !deferred.includes(c));
        if (missing.length > 0)
            refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this read requires ${missing.join(", ")}`);
        // THE CONDITIONAL DECISION. LAZY, and MEMOIZED FOR THIS READ: the loop below may require several
        // capabilities, and the actor's resolver answers all of them from ONE resolution of the grant and
        // condition stores. With no condition on any entitlement this allows every required key through
        // the unconditional path, consults no context authority and performs no context read.
        const reader = (0, contextualAuthorization_1.postgresContextualReader)(deps.pool);
        const reach = deferred.length === 0 ? GLOBAL_REACH : Object.freeze({
            global: false,
            // The companies EVERY deferred key is held in, unconditionally. A list is filtered to exactly these.
            operatingCompanyIds: Object.freeze(deferred
                .map((c) => (0, assignmentScopeRuntime_1.admittedScopeValues)(scoped, c, "operatingCompany"))
                .reduce((acc, ids) => acc.filter((id) => ids.includes(id)))),
            async authorizeEmployee(operatingCompanyId) {
                for (const capabilityKey of deferred) {
                    const decision = await (0, conditionalEntitlement_1.authorizeEntitledAction)(reader, {
                        actor, capabilityKey,
                        businessContext: typeof operatingCompanyId === "string" ? { operatingCompanyId } : {},
                    });
                    if (!decision.allowed) {
                        if (decision.outcome === "CONTEXT_AUTHORITY_UNAVAILABLE") {
                            refuse("CAPABILITY_CONDITION_UNSATISFIED", "FORBIDDEN", `this read requires ${capabilityKey} for this Employee: ${decision.outcome}`);
                        }
                        // NO EXISTENCE ORACLE (Pass 9 S7). A scoped holder is refused an out-of-scope Employee with EXACTLY the
                        // refusal a missing id gets, so it cannot enumerate other companies' Employee ids. (A GLOBAL holder never
                        // reaches here: its reach is GLOBAL_REACH, and its NOT_FOUND is unchanged.)
                        refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
                    }
                }
            },
        });
        for (const capabilityKey of required.filter((c) => !deferred.includes(c))) {
            const decision = await (0, conditionalEntitlement_1.authorizeEntitledAction)(reader, { actor, capabilityKey });
            if (!decision.allowed) {
                refuse("CAPABILITY_CONDITION_UNSATISFIED", "FORBIDDEN", `this read requires ${capabilityKey}: ${decision.outcome}`);
            }
        }
        client = await deps.pool.connect();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [actor.tenantId, actor.principalId]);
        if (member.rows.length === 0)
            refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
        const result = await body(client, actor.tenantId, actor.principalId, prepared, reach);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        throw translateEmployeeReadError(err);
    }
    finally {
        client?.release();
    }
}
// ==================== THE CONDITIONAL ENTITLEMENT SEAM ====================
//
// `capabilities.has(key)` answers "is this key in the set" and can answer nothing else -- which is
// why a per-GRANT condition was unreachable from any of the thirteen kernel gate sites. The actor
// now also carries `entitlements`, resolved by `capabilityAuthority.resolveOperationalContext` on
// the request path, so a gate site can ask the question that needs the grantor.
//
// THE EXISTING CHECK IS NOT REPLACED. The flat-set check below runs first and is byte-identical to
// what it always was; the entitled decision runs AFTER it and can only ever refuse further. That
// ordering is the guarantee that wiring this in front of a governed read narrows nothing while
// `eos_policy.capability_grant_conditions` holds zero rows -- and it means a bug in the new path can
// only be a false refusal, never a false allow.
//
// AN ACTOR WITHOUT ENTITLEMENTS IS REFUSED, not waved through. A fall-back to the flat set would
// mean any caller that omitted the field escaped every condition.
/** A read accepts exactly its named fields. An unnamed field is refused, never ignored. */
function acceptOnly(input, allowed) {
    if (input === undefined || input === null)
        return;
    if (typeof input !== "object" || Array.isArray(input))
        refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
    const extra = Object.keys(input).filter((k) => !allowed.includes(k));
    if (extra.length > 0)
        refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
}
function requireEmployeeId(value) {
    if (typeof value !== "string" || value === "" || value.trim() !== value || value.length > 200 || value.includes("/")) {
        refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "employeeId is required and must be a governed Employee id");
    }
    return value;
}
exports.DEFAULT_EMPLOYEE_PAGE_SIZE = 50;
exports.MAX_EMPLOYEE_PAGE_SIZE = 200;
/** Absent takes the default; present but invalid REFUSES -- a caller asking for 9999 is never quietly handed 50. */
function requirePageSize(value) {
    if (value === undefined)
        return exports.DEFAULT_EMPLOYEE_PAGE_SIZE;
    if (!Number.isSafeInteger(value) || value <= 0 || value > exports.MAX_EMPLOYEE_PAGE_SIZE) {
        refuse("PAGE_SIZE_INVALID", "INVALID_INPUT", `limit must be a positive integer no greater than ${exports.MAX_EMPLOYEE_PAGE_SIZE}`);
    }
    return value;
}
const CURSOR_VERSION = 1;
/** Opaque to callers; NOT secret and NOT signed. Bound to one list + family + Employee, so it cannot move between them. */
function encodeEmployeeCursor(scope, cursor) {
    return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, f: scope, n: cursor.number, id: cursor.id }), "utf8").toString("base64url");
}
/** A structurally invalid cursor refuses; it is never read as "start from the beginning". */
function decodeEmployeeCursor(scope, raw) {
    if (raw === undefined)
        return null;
    const invalid = () => refuse("CURSOR_INVALID", "INVALID_INPUT", "cursor is not a valid position for this list");
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
    if (r.v !== CURSOR_VERSION || r.f !== scope || typeof r.n !== "string" || r.n === "" || typeof r.id !== "string" || r.id === "") {
        return invalid();
    }
    return { number: r.n, id: r.id };
}
const isoOf = (d) => (d === null ? null : d.toISOString());
exports.isoOf = isoOf;
//# sourceMappingURL=employeeReadKernel.js.map