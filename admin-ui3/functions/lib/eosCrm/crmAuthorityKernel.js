"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_IDEMPOTENCY_KEY_LENGTH = exports.isoOf = exports.MAX_CRM_PAGE_SIZE = exports.DEFAULT_CRM_PAGE_SIZE = exports.MAX_CRM_TEXT_LENGTH = exports.CALLER_AUTHORITY_FIELDS = exports.fail = exports.CrmAuthorityError = exports.CRM_CAPABILITIES = void 0;
exports.translateCrmError = translateCrmError;
exports.requireActor = requireActor;
exports.requireAllowlistedInput = requireAllowlistedInput;
exports.requireRecordId = requireRecordId;
exports.requireName = requireName;
exports.optionalText = optionalText;
exports.requirePageSize = requirePageSize;
exports.encodeCrmCursor = encodeCrmCursor;
exports.decodeCrmCursor = decodeCrmCursor;
exports.pageOf = pageOf;
exports.runCrmCommand = runCrmCommand;
exports.requireIdempotencyKey = requireIdempotencyKey;
exports.runCrmCreate = runCrmCreate;
exports.splitIdempotentInput = splitIdempotentInput;
exports.runCrmRead = runCrmRead;
exports.requireTenantAccount = requireTenantAccount;
exports.assignmentsOf = assignmentsOf;
const node_crypto_1 = require("node:crypto");
/** The catalogued Customer capability KEYS (functions/src/access/permissionCatalog.ts). Nothing else is consulted. */
exports.CRM_CAPABILITIES = Object.freeze({
    CUSTOMER_RECORD_READ: "customer.record.read",
    CUSTOMER_RECORD_CREATE: "customer.record.create",
    CUSTOMER_RECORD_UPDATE: "customer.record.update",
    CUSTOMER_GOVERNED_FIELD_WRITE: "customer.governedField.write",
});
/**
 * The ONLY error that leaves a governed CRM operation. Same (code, category, message) shape as CommercialCommandError.
 * A multi-row command that refuses as a whole additionally names every refused row in `findings`.
 */
class CrmAuthorityError extends Error {
    code;
    category;
    findings;
    constructor(code, category, message, findings) {
        super(message);
        this.code = code;
        this.category = category;
        this.findings = findings;
        this.name = "CrmAuthorityError";
    }
}
exports.CrmAuthorityError = CrmAuthorityError;
const fail = (code, category, message, findings) => {
    throw new CrmAuthorityError(code, category, message, findings);
};
exports.fail = fail;
// ════════════════════ error translation ════════════════════
/** Named integrity rules of migration 1758758400000, reported as domain facts rather than as constraint names. */
const CONSTRAINT_CODES = Object.freeze({
    contacts_account_same_tenant: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
    account_locations_account_same_tenant: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
    accounts_name_present: ["NAME_REQUIRED", "INVALID_INPUT"],
    contacts_name_present: ["NAME_REQUIRED", "INVALID_INPUT"],
    account_locations_name_present: ["NAME_REQUIRED", "INVALID_INPUT"],
    accounts_pkey: ["ID_CONFLICT", "CONFLICT"],
    contacts_pkey: ["ID_CONFLICT", "CONFLICT"],
    account_locations_pkey: ["ID_CONFLICT", "CONFLICT"],
    accounts_billing_contact_on_account: ["BILLING_CONTACT_NOT_ON_ACCOUNT", "INVALID_INPUT"],
    account_tags_unique_per_account: ["FIELD_INVALID", "INVALID_INPUT"],
    command_receipts_one_per_key: ["IDEMPOTENCY_CONFLICT", "CONFLICT"],
    command_receipts_member_fk: ["ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN"],
    // Migration 1759924800000: the append-only Account ownership history.
    account_ownership_history_account_same_tenant: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
    account_ownership_history_event_shape: ["OWNERSHIP_EVENT_INVALID", "INVALID_INPUT"],
    account_ownership_history_reason_shape: ["HANDOFF_REASON_INVALID", "INVALID_INPUT"],
    account_ownership_history_one_initial_assignment: ["INITIAL_OWNER_ALREADY_ASSIGNED", "CONFLICT"],
    account_ownership_history_initial_assignment_first: ["INITIAL_OWNER_ALREADY_ASSIGNED", "CONFLICT"],
});
/** The pure CRM vocabulary's own refusals (functions/src/crm/customerIdentity.ts), kept as governed input refusals. */
const CRM_VOCABULARY_ERRORS = Object.freeze({
    CrmIdentityError: "IDENTITY_INVALID",
    CrmOwnershipError: "OWNER_INVALID",
    CrmLocationNamespaceError: "INVENTORY_LOCATION_DISCRIMINATOR_REFUSED",
});
function translateCrmError(err, fallback) {
    if (err instanceof CrmAuthorityError)
        return err;
    const e = err;
    if (e && typeof e.name === "string" && CRM_VOCABULARY_ERRORS[e.name]) {
        return new CrmAuthorityError(CRM_VOCABULARY_ERRORS[e.name], "INVALID_INPUT", String(e.message ?? e.name));
    }
    if (e && typeof e.constraint === "string" && CONSTRAINT_CODES[e.constraint]) {
        const [code, category] = CONSTRAINT_CODES[e.constraint];
        return new CrmAuthorityError(code, category, `refused by governed integrity rule ${code}`);
    }
    if (e && (e.code === "40001" || e.code === "40P01")) {
        return new CrmAuthorityError("CONCURRENT_MODIFICATION", "CONFLICT", "the operation collided with a concurrent change; retry it");
    }
    return fallback === "CRM_COMMAND_FAILED"
        ? new CrmAuthorityError("CRM_COMMAND_FAILED", "FAILED", "the command could not be completed")
        : new CrmAuthorityError("CRM_READ_FAILED", "FAILED", "the read could not be completed");
}
// ════════════════════ actor + caller input ════════════════════
function requireActor(actor, requiredCapability) {
    if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
        (0, exports.fail)("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
    }
    if (!(actor.capabilities instanceof Set)) {
        (0, exports.fail)("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
    }
    if (!actor.capabilities.has(requiredCapability)) {
        (0, exports.fail)("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${requiredCapability}`);
    }
}
/**
 * Authority is the actor context's, never the payload's. A caller naming any of these is refused outright -- dropping
 * the key silently would let a caller believe it had chosen a tenant, an attribution or a role.
 */
exports.CALLER_AUTHORITY_FIELDS = Object.freeze([
    "tenantId", "principalId", "capabilities", "uid", "roles", "securityRole", "jobRole", "externalSubject", "identityProvider",
]);
/** The caller's input as a plain object whose keys are all on the operation's allowlist. */
function requireAllowlistedInput(input, allowed) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        (0, exports.fail)("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
    }
    const record = input;
    const keys = Object.keys(record);
    const authority = keys.filter((k) => exports.CALLER_AUTHORITY_FIELDS.includes(k));
    if (authority.length > 0) {
        (0, exports.fail)("CALLER_AUTHORITY_REFUSED", "FORBIDDEN", `input may not carry authority: ${authority.sort().join(", ")}`);
    }
    const unknown = keys.filter((k) => !allowed.includes(k));
    if (unknown.length > 0) {
        (0, exports.fail)("FIELD_NOT_ALLOWED", "INVALID_INPUT", `not an accepted field for this operation: ${unknown.sort().join(", ")}`);
    }
    return record;
}
function requireRecordId(value, field) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
        (0, exports.fail)("RECORD_ID_REQUIRED", "INVALID_INPUT", `${field} is required and must be 1-200 characters of A-Z a-z 0-9 _ -`);
    }
    return value;
}
exports.MAX_CRM_TEXT_LENGTH = 2000;
function requireName(value, what) {
    if (typeof value !== "string" || value.trim() === "" || value.length > exports.MAX_CRM_TEXT_LENGTH) {
        (0, exports.fail)("NAME_REQUIRED", "INVALID_INPUT", `${what} requires a non-empty name of at most ${exports.MAX_CRM_TEXT_LENGTH} characters`);
    }
    return value.trim();
}
/** Absent or null clears; a blank string clears; anything that is not a string refuses. */
function optionalText(value, field) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== "string" || value.length > exports.MAX_CRM_TEXT_LENGTH) {
        (0, exports.fail)("FIELD_INVALID", "INVALID_INPUT", `${field} must be a string of at most ${exports.MAX_CRM_TEXT_LENGTH} characters, or null`);
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}
exports.DEFAULT_CRM_PAGE_SIZE = 50;
exports.MAX_CRM_PAGE_SIZE = 200;
/** Absent takes the default; present but invalid REFUSES -- a caller asking for 9999 is never quietly handed 50. */
function requirePageSize(value) {
    if (value === undefined)
        return exports.DEFAULT_CRM_PAGE_SIZE;
    if (!Number.isSafeInteger(value) || value <= 0 || value > exports.MAX_CRM_PAGE_SIZE) {
        (0, exports.fail)("PAGE_SIZE_INVALID", "INVALID_INPUT", `limit must be a positive integer no greater than ${exports.MAX_CRM_PAGE_SIZE}`);
    }
    return value;
}
const CURSOR_VERSION = 1;
/** Opaque to callers; NOT secret and NOT signed. It can only reposition inside an already-authorized ordering. */
function encodeCrmCursor(family, cursor) {
    return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, f: family, n: cursor.name, id: cursor.id }), "utf8").toString("base64url");
}
/** A structurally invalid cursor refuses; it is never read as "start from the beginning". */
function decodeCrmCursor(family, raw) {
    if (raw === undefined || raw === null)
        return null;
    const invalid = () => (0, exports.fail)("CURSOR_INVALID", "INVALID_INPUT", "cursor is not a valid position for this list");
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
    if (r.v !== CURSOR_VERSION || r.f !== family || typeof r.n !== "string" || typeof r.id !== "string" || r.id === "")
        return invalid();
    return { name: r.n, id: r.id };
}
/** Rows come back limit + 1, each carrying `folded_name`; the extra row is the truthful "there is more". */
function pageOf(family, rows, limit, project) {
    const truncated = rows.length > limit;
    const kept = rows.slice(0, limit);
    const last = kept[kept.length - 1];
    return {
        items: kept.map(project),
        truncated,
        nextCursor: truncated && last ? encodeCrmCursor(family, { name: last.folded_name, id: last.id }) : null,
    };
}
const isoOf = (d) => d.toISOString();
exports.isoOf = isoOf;
// ════════════════════ the runners ════════════════════
async function requireActiveMembership(client, actor) {
    const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [actor.tenantId, actor.principalId]);
    if (member.rows.length === 0)
        (0, exports.fail)("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
}
/**
 * Run ONE governed CRM command in ONE PostgreSQL transaction.
 *
 * Order: actor + capability -> caller input validation (`prepare`) -> connect -> BEGIN -> active principal + active
 * membership -> the body -> COMMIT. Refusals before `connect` touch no database; any later failure rolls back every
 * effect.
 */
async function runCrmCommand(deps, actor, requiredCapability, prepare, body) {
    let client;
    try {
        requireActor(actor, requiredCapability);
        const prepared = prepare();
        client = await deps.pool.connect();
        await client.query("BEGIN");
        await requireActiveMembership(client, actor);
        const result = await body(client, actor, prepared);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        throw translateCrmError(err, "CRM_COMMAND_FAILED");
    }
    finally {
        client?.release();
    }
}
const sha256 = (value) => (0, node_crypto_1.createHash)("sha256").update(value, "utf8").digest("hex");
/** Deterministic JSON: object keys sorted at every depth, so the same request always hashes the same. */
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.keys(value).sort()
            .filter((k) => value[k] !== undefined)
            .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
        return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value ?? null);
}
exports.MAX_IDEMPOTENCY_KEY_LENGTH = 200;
/** A create's idempotency key: required, a non-blank string of bounded length. Only its SHA-256 is ever persisted. */
function requireIdempotencyKey(value) {
    if (typeof value !== "string" || value.trim() === "" || value.length > exports.MAX_IDEMPOTENCY_KEY_LENGTH) {
        (0, exports.fail)("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", `idempotencyKey is required: a non-blank string of at most ${exports.MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
    }
    return value;
}
/**
 * Run ONE governed CRM CREATE, idempotently, in ONE PostgreSQL transaction.
 *
 * Order: actor + capability -> `prepare` (which must validate the key and return the caller's request without it) ->
 * connect -> BEGIN -> active principal + membership -> advisory lock on (tenant, principal, operation, key hash) ->
 * committed receipt? replay it (or refuse a different request under the same key) -> the body -> the receipt -> COMMIT.
 *
 * SCOPE. A key belongs to one (tenant, principal, operation): the same key used by another principal, in another tenant
 * or for another create operation is a DIFFERENT key. Reusing a key for the same operation with a different request
 * (compared by SHA-256 of the canonical request) refuses with IDEMPOTENCY_KEY_REUSED and changes nothing. A replay
 * returns the result recorded at creation, not the record's current state. Any failure rolls the receipt back with the
 * create, so the key stays free for a genuine retry.
 */
async function runCrmCreate(deps, actor, requiredCapability, operation, prepare, body) {
    let client;
    try {
        requireActor(actor, requiredCapability);
        const prepared = prepare();
        const keyHash = sha256(prepared.idempotencyKey);
        const requestHash = sha256(canonicalJson(prepared.request));
        client = await deps.pool.connect();
        await client.query("BEGIN");
        await requireActiveMembership(client, actor);
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
            `crm-create|${actor.tenantId}|${actor.principalId}|${operation}|${keyHash}`,
        ]);
        const prior = await client.query(`SELECT request_hash, result FROM eos_crm.command_receipts
        WHERE tenant_id = $1 AND principal_id = $2 AND operation = $3 AND idempotency_key_hash = $4`, [actor.tenantId, actor.principalId, operation, keyHash]);
        if (prior.rows.length === 1) {
            if (prior.rows[0].request_hash !== requestHash) {
                (0, exports.fail)("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "this idempotency key was already used for a different request");
            }
            await client.query("COMMIT");
            return { ...prior.rows[0].result, replayed: true };
        }
        const outcome = await body(client, actor, prepared);
        await client.query(`INSERT INTO eos_crm.command_receipts
         (id, tenant_id, principal_id, operation, idempotency_key_hash, request_hash, target_type, target_id, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [`crcpt_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, actor.principalId, operation, keyHash, requestHash,
            outcome.targetType, outcome.targetId, JSON.stringify(outcome.result)]);
        await client.query("COMMIT");
        return { ...outcome.result, replayed: false };
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        throw translateCrmError(err, "CRM_COMMAND_FAILED");
    }
    finally {
        client?.release();
    }
}
/** Split a create input into its idempotency key and the request it names. */
function splitIdempotentInput(i) {
    const { idempotencyKey, ...request } = i;
    return { idempotencyKey: requireIdempotencyKey(idempotencyKey), request };
}
/** Run ONE governed CRM read in ONE read-only snapshot. PostgreSQL itself refuses any write attempted inside it. */
async function runCrmRead(deps, actor, requiredCapability, prepare, body) {
    let client;
    try {
        requireActor(actor, requiredCapability);
        const prepared = prepare();
        client = await deps.pool.connect();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await requireActiveMembership(client, actor);
        const result = await body(client, actor.tenantId, prepared);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        throw translateCrmError(err, "CRM_READ_FAILED");
    }
    finally {
        client?.release();
    }
}
/**
 * The parent Account, in THIS tenant only. A cross-tenant Account reads as absent, never as "exists elsewhere".
 * `SHARE` holds the row for the rest of the transaction, so an owner inherited from it cannot be handed off between the
 * read and the child INSERT that records it.
 */
async function requireTenantAccount(db, tenantId, accountId, lock = "NONE") {
    const { rows } = await db.query(`SELECT id, owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2${lock === "SHARE" ? " FOR SHARE" : ""}`, [tenantId, accountId]);
    if (rows.length === 0)
        (0, exports.fail)("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
    return { id: rows[0].id, ownerEmployeeId: rows[0].owner_employee_id };
}
/**
 * Build `SET col = $n, ...` from a FIXED field->column map. Column names only ever come from the map; caller keys that
 * are not in it were already refused by `requireAllowlistedInput`.
 */
function assignmentsOf(changes, columns, firstParam) {
    const parts = [];
    const values = [];
    for (const [field, value] of changes) {
        const column = columns[field];
        if (!column)
            (0, exports.fail)("FIELD_NOT_ALLOWED", "INVALID_INPUT", `not an accepted field for this operation: ${field}`);
        values.push(value);
        parts.push(`${column} = $${firstParam + values.length - 1}`);
    }
    return { sql: parts.join(", "), values };
}
//# sourceMappingURL=crmAuthorityKernel.js.map