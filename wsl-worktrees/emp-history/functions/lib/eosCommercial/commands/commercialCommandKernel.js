"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fail = exports.CommercialCommandError = exports.COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1 = exports.COMMERCIAL_CAPABILITIES = void 0;
exports.requireCatalogReferences = requireCatalogReferences;
exports.translateCommercialError = translateCommercialError;
exports.runCommercialCommand = runCommercialCommand;
exports.requireTenantEmployee = requireTenantEmployee;
exports.requireTenantAccount = requireTenantAccount;
const node_crypto_1 = require("node:crypto");
const postgresEmployeeAuthority_1 = require("../../employeeIdentity/postgresEmployeeAuthority");
/** The Commercial capability keys the commands require -- the ids the permission catalog already registers. */
exports.COMMERCIAL_CAPABILITIES = Object.freeze({
    OPPORTUNITY_WRITE: "opportunity.write",
    OPPORTUNITY_CREATE_SALES_ORDER: "opportunity.createSalesOrder",
    SALES_AGREEMENT_CREATE: "salesAgreement.create",
    SALES_AGREEMENT_UPDATE_DRAFT: "salesAgreement.updateDraft",
    SALES_AGREEMENT_ACCEPT: "salesAgreement.accept",
    SALES_ORDER_WRITE: "salesOrder.write",
});
/** Owner ruling 2026-09-14. Fixed here; a command cannot be handed a different policy. */
exports.COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1 = Object.freeze({
    policyId: "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1",
    eligibleStatuses: Object.freeze(["ACTIVE", "CONTRACTOR"]),
});
class CommercialCommandError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "CommercialCommandError";
    }
}
exports.CommercialCommandError = CommercialCommandError;
const fail = (code, category, message) => {
    throw new CommercialCommandError(code, category, message);
};
exports.fail = fail;
const CATALOG_VERDICTS = new Set(["FOUND", "NOT_FOUND", "WRONG_KIND"]);
/** Validate product references through the port, refusing when no authority exists. */
async function requireCatalogReferences(deps, db, tenantId, lines) {
    const references = lines
        .filter((l) => l.kind === "PART" || l.kind === "EQUIPMENT_MODEL")
        .map((l) => ({ kind: l.kind, ref: l.ref }));
    if (references.length === 0)
        return;
    if (!deps.catalog) {
        (0, exports.fail)("CATALOG_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "no PostgreSQL catalog authority is available to validate PART / EQUIPMENT_MODEL references; this command cannot run until one is governed");
    }
    const verdicts = await deps.catalog.verifyReferences(db, tenantId, references);
    // The authority must answer every reference with a governed verdict. A short, long or unrecognised answer is a broken
    // authority, and a broken authority must never read as FOUND.
    if (!Array.isArray(verdicts) || verdicts.length !== references.length || !verdicts.every((v) => CATALOG_VERDICTS.has(v))) {
        (0, exports.fail)("CATALOG_AUTHORITY_CONTRACT_VIOLATION", "UNAVAILABLE", "the catalog authority did not return one governed verdict per reference");
    }
    verdicts.forEach((verdict, i) => {
        if (verdict === "NOT_FOUND")
            (0, exports.fail)("REFERENCE_NOT_FOUND", "INVALID_INPUT", `line reference ${references[i].ref} does not exist`);
        if (verdict === "WRONG_KIND")
            (0, exports.fail)("REFERENCE_WRONG_KIND", "INVALID_INPUT", `line reference ${references[i].ref} is not a ${references[i].kind}`);
    });
}
// ════════════════════ error translation ════════════════════
const PRECONDITION_CODES = new Set([
    "ALREADY_CLOSED", "ILLEGAL_TRANSITION", "OUTCOME_REQUIRES_DECISION", "NO_LINES", "LINE_QTY_REQUIRED_FOR_WON", "CLOSED",
    "NO_CHANGES", "TERMINAL", "NOT_FULFILLABLE", "UNPRICED_LINE", "COMPANY_REQUIRED", "ALREADY_ESTABLISHED", "NOTHING_TO_HAND_OFF",
    "HANDOFF_IS_NO_OP", "NO_OP",
]);
const DOMAIN_ERROR_NAMES = new Set([
    "OpportunityCommandError", "SalesAgreementCommandError", "SalesOrderCommandError", "CommercialCompanyScopeError",
    "CommercialOwnershipError", "CreationOwnerUnresolvedError", "AttributionError", "CreationAccountablePersonError",
    "AccountablePersonMintError", "CommercialAccountabilityWriteError", "CommercialNumberingError", "EmployeeAuthorityFailure",
]);
const CONSTRAINT_CODES = Object.freeze({
    opportunities_account_fk: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
    sales_agreements_account_fk: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
    sales_orders_account_fk: ["ACCOUNT_NOT_FOUND", "NOT_FOUND"],
    sales_agreements_one_per_opportunity: ["AGREEMENT_ALREADY_EXISTS", "CONFLICT"],
    sales_orders_one_per_opportunity: ["SALES_ORDER_ALREADY_EXISTS", "CONFLICT"],
    sales_orders_one_per_agreement: ["SALES_ORDER_ALREADY_EXISTS", "CONFLICT"],
    opportunities_number_unique: ["NUMBER_CONFLICT", "CONFLICT"],
    sales_agreements_number_unique: ["NUMBER_CONFLICT", "CONFLICT"],
    sales_orders_number_unique: ["NUMBER_CONFLICT", "CONFLICT"],
    command_receipts_one_per_key: ["IDEMPOTENCY_CONFLICT", "CONFLICT"],
    command_receipts_member_fk: ["ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN"],
});
/** Every error leaving a command is a CommercialCommandError. Nothing else crosses the boundary. */
function translateCommercialError(err) {
    if (err instanceof CommercialCommandError)
        return err;
    const e = err;
    if (e && typeof e.name === "string" && DOMAIN_ERROR_NAMES.has(e.name) && typeof e.code === "string") {
        const category = e.code === "RECORD_NOT_FOUND" || e.code === "EMPLOYEE_REFERENCE_NOT_FOUND" ? "NOT_FOUND"
            : e.code.endsWith("AUTHORITY_UNAVAILABLE") ? "UNAVAILABLE"
                : PRECONDITION_CODES.has(e.code) ? "PRECONDITION_FAILED"
                    : "INVALID_INPUT";
        return new CommercialCommandError(e.code, category, String(e.message ?? e.code));
    }
    if (e && e.name === "CommercialRecordNotFoundError")
        return new CommercialCommandError("RECORD_NOT_FOUND", "NOT_FOUND", String(e.message));
    if (e && typeof e.constraint === "string" && CONSTRAINT_CODES[e.constraint]) {
        const [code, category] = CONSTRAINT_CODES[e.constraint];
        return new CommercialCommandError(code, category, `refused by governed integrity rule ${code}`);
    }
    if (e && (e.code === "40001" || e.code === "40P01")) {
        return new CommercialCommandError("CONCURRENT_MODIFICATION", "CONFLICT", "the command collided with a concurrent change; retry it");
    }
    return new CommercialCommandError("COMMAND_FAILED", "FAILED", "the command could not be completed");
}
const hashKey = (key) => (0, node_crypto_1.createHash)("sha256").update(key, "utf8").digest("hex");
/**
 * Run ONE governed Commercial command in ONE PostgreSQL transaction.
 *
 * Order: capability check -> BEGIN -> advisory lock on the idempotency identity -> replay if a committed receipt
 * exists -> active principal + active membership -> the command body -> the receipt -> COMMIT. Any failure rolls
 * back every effect, the receipt included, and leaves the key free for a genuine retry.
 */
async function runCommercialCommand(deps, actor, operation, requiredCapabilities, idempotencyKey, body) {
    if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
        throw new CommercialCommandError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
    }
    if (!(actor.capabilities instanceof Set)) {
        throw new CommercialCommandError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
    }
    const missing = requiredCapabilities.filter((c) => !actor.capabilities.has(c));
    if (missing.length > 0) {
        throw new CommercialCommandError("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${missing.join(", ")}`);
    }
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
        throw new CommercialCommandError("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "a non-empty idempotency key is required");
    }
    const keyHash = hashKey(idempotencyKey);
    const now = (deps.now ?? (() => new Date()))();
    // Acquisition is INSIDE the governed boundary: a pool that cannot connect is a COMMAND_FAILED like any other
    // infrastructure failure, never a raw driver error carrying a host, user or connection string.
    let client;
    try {
        client = await deps.pool.connect();
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
            `commercial-command|${actor.tenantId}|${actor.principalId}|${operation}|${keyHash}`,
        ]);
        const prior = await client.query(`SELECT result FROM eos_commercial.command_receipts
        WHERE tenant_id = $1 AND principal_id = $2 AND operation = $3 AND idempotency_key_hash = $4`, [actor.tenantId, actor.principalId, operation, keyHash]);
        if (prior.rows.length === 1) {
            await client.query("COMMIT");
            return { ...prior.rows[0].result, replayed: true };
        }
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [actor.tenantId, actor.principalId]);
        if (member.rows.length === 0) {
            (0, exports.fail)("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
        }
        const outcome = await body(client, now);
        await client.query(`INSERT INTO eos_commercial.command_receipts
         (id, tenant_id, principal_id, operation, idempotency_key_hash, target_family, target_id, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [`rcpt_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, actor.principalId, operation, keyHash,
            outcome.target?.family ?? null, outcome.target?.id ?? null, JSON.stringify(outcome.result)]);
        await client.query("COMMIT");
        return { ...outcome.result, replayed: false };
    }
    catch (err) {
        if (client)
            await client.query("ROLLBACK").catch(() => undefined);
        throw translateCommercialError(err);
    }
    finally {
        client?.release();
    }
}
/** The Employee must RESOLVE in this tenant through the governed PostgreSQL Employee authority. */
async function requireTenantEmployee(db, tenantId, employeeId, role) {
    const resolution = await (0, postgresEmployeeAuthority_1.createPostgresEmployeeAuthority)(db).resolveEmployeeReference({ tenantId, employeeId });
    if (resolution.outcome === "RESOLVED")
        return resolution.employee.employeeId;
    if (resolution.outcome === "AUTHORITY_UNAVAILABLE") {
        (0, exports.fail)("EMPLOYEE_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "the Employee authority could not answer");
    }
    return (0, exports.fail)(role === "OWNER" ? "OWNER_NOT_FOUND" : "CREDITED_SALESPERSON_NOT_FOUND", "NOT_FOUND", `${role === "OWNER" ? "the owner" : "the credited salesperson"} ${employeeId} is not an Employee of this tenant`);
}
/** The Account row, read in THIS tenant only. */
async function requireTenantAccount(db, tenantId, accountId) {
    const { rows } = await db.query(`SELECT id, owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
    if (rows.length === 0)
        (0, exports.fail)("ACCOUNT_NOT_FOUND", "NOT_FOUND", `no Account ${accountId} in this tenant`);
    return { id: rows[0].id, ownerEmployeeId: rows[0].owner_employee_id };
}
//# sourceMappingURL=commercialCommandKernel.js.map