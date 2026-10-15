"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogMasterError = exports.CATALOG_CAPABILITIES = void 0;
exports.refuse = refuse;
exports.translateCatalogError = translateCatalogError;
exports.runCatalogCommand = runCatalogCommand;
exports.requirePlainObject = requirePlainObject;
exports.requireExpectedVersion = requireExpectedVersion;
const node_crypto_1 = require("node:crypto");
/**
 * The catalog write capability keys -- the ids functions/src/access/permissionCatalog.ts registers and the
 * Firestore commands check today. Nothing invented (catalogMaster test asserts each against the catalog).
 */
exports.CATALOG_CAPABILITIES = Object.freeze({
    /** partMasterCommands.ts CAP_CATALOG_MANAGE: createPart / updatePart. */
    PART_MANAGE: "inventory.catalog.manage",
    /** partMasterCommands.ts CAP_CATALOG_ACTIVATE: changePartStatus. */
    PART_ACTIVATE: "inventory.catalog.activate",
    /** equipmentCompatibility/commands.ts COMMAND_CAPABILITIES.importEquipmentModel. */
    EQUIPMENT_MODEL_MANAGE: "equipment.model.manage",
});
class CatalogMasterError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "CatalogMasterError";
    }
}
exports.CatalogMasterError = CatalogMasterError;
function refuse(code, category, message) {
    throw new CatalogMasterError(code, category, message);
}
const CONSTRAINT_CODES = Object.freeze({
    parts_pkey: ["PART_ALREADY_EXISTS", "CONFLICT"],
    equipment_models_pkey: ["EQUIPMENT_MODEL_ALREADY_EXISTS", "CONFLICT"],
    part_equipment_model_same_tenant: ["EQUIPMENT_MODEL_NOT_FOUND", "NOT_FOUND"],
});
/** Every error leaving a catalog command is a CatalogMasterError. Nothing else crosses the boundary. */
function translateCatalogError(err) {
    if (err instanceof CatalogMasterError)
        return err;
    const e = err;
    if (e && typeof e.constraint === "string" && CONSTRAINT_CODES[e.constraint]) {
        const [code, category] = CONSTRAINT_CODES[e.constraint];
        return new CatalogMasterError(code, category, `refused by governed integrity rule ${code}`);
    }
    if (e && e.code === "23514")
        return new CatalogMasterError("RECORD_INVALID", "INVALID_INPUT", "the record violates a governed catalog rule");
    if (e && (e.code === "40001" || e.code === "40P01")) {
        return new CatalogMasterError("CONCURRENT_MODIFICATION", "CONFLICT", "the command collided with a concurrent change; retry it");
    }
    return new CatalogMasterError("COMMAND_FAILED", "FAILED", "the command could not be completed");
}
/**
 * Run ONE governed catalog command in ONE PostgreSQL transaction.
 *
 * Order: actor shape -> capability -> connect -> BEGIN -> active principal + active membership -> body -> audit
 * (only when the body applied a change) -> COMMIT. Any failure rolls back every effect.
 */
async function runCatalogCommand(deps, actor, requiredCapability, body) {
    if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
        throw new CatalogMasterError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
    }
    if (!(actor.capabilities instanceof Set)) {
        throw new CatalogMasterError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
    }
    if (!actor.capabilities.has(requiredCapability)) {
        throw new CatalogMasterError("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${requiredCapability}`);
    }
    const now = (deps.now ?? (() => new Date()))();
    let client;
    try {
        client = await deps.pool.connect();
        await client.query("BEGIN");
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [actor.tenantId, actor.principalId]);
        if (member.rows.length === 0)
            refuse("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
        const outcome = await body(client, now);
        if (outcome.audit !== null) {
            await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [`audit_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, outcome.audit.action, actor.principalId, outcome.audit.targetKind,
                outcome.audit.targetId, outcome.audit.before === null ? null : JSON.stringify(outcome.audit.before),
                JSON.stringify(outcome.audit.after), now]);
        }
        await client.query("COMMIT");
        return { ...outcome.result, replayed: outcome.replayed };
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        throw translateCatalogError(err);
    }
    finally {
        client?.release();
    }
}
/** Plain-object guard for untrusted command input. */
function requirePlainObject(value, what) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        refuse("INVALID_INPUT", "INVALID_INPUT", `${what} must be a plain object`);
    }
    return value;
}
/** A positive integer expectedVersion, or a refusal. */
function requireExpectedVersion(value) {
    if (!Number.isSafeInteger(value) || value < 1)
        refuse("INVALID_INPUT", "INVALID_INPUT", "expectedVersion must be a positive integer");
    return value;
}
//# sourceMappingURL=catalogMasterKernel.js.map