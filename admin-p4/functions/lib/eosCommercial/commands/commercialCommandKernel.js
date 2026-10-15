"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fail = exports.CommercialCommandError = exports.COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1 = exports.ADMINISTRATIVE_HANDOFF_SOURCES = exports.OWNERSHIP_HANDOFF_CORRECT_CAPABILITY = exports.SALES_AGREEMENT_TRADE_IN_APPROVE_CAPABILITY = exports.COMMERCIAL_CAPABILITIES = void 0;
exports.requireCatalogReferences = requireCatalogReferences;
exports.translateCommercialError = translateCommercialError;
exports.runCommercialCommand = runCommercialCommand;
exports.requireTenantEmployee = requireTenantEmployee;
exports.requireAccountLocation = requireAccountLocation;
exports.requireTenantAccount = requireTenantAccount;
exports.requireActiveSalesChannel = requireActiveSalesChannel;
exports.requireActiveTenantAccount = requireActiveTenantAccount;
const node_crypto_1 = require("node:crypto");
const postgresEmployeeAuthority_1 = require("../../employeeIdentity/postgresEmployeeAuthority");
const assignmentScopeRuntime_1 = require("../../adminPolicy/assignmentScopeRuntime");
/** The Commercial capability keys the commands require -- the ids the permission catalog already registers. */
exports.COMMERCIAL_CAPABILITIES = Object.freeze({
    OPPORTUNITY_WRITE: "opportunity.write",
    OPPORTUNITY_CREATE_SALES_ORDER: "opportunity.createSalesOrder",
    SALES_AGREEMENT_CREATE: "salesAgreement.create",
    SALES_AGREEMENT_UPDATE_DRAFT: "salesAgreement.updateDraft",
    SALES_AGREEMENT_ACCEPT: "salesAgreement.accept",
    SALES_ORDER_WRITE: "salesOrder.write",
});
/**
 * Owner ruling #204: BUSINESS APPROVAL of a proposed trade-in value (PostgreSQL-native, migration 1764500000000). Not one of
 * the migration-023 vocabulary keys above, and never implied by administrative authority.
 */
exports.SALES_AGREEMENT_TRADE_IN_APPROVE_CAPABILITY = "salesAgreement.tradeIn.approve";
/**
 * DQ-022: an ADMINISTRATIVE handoff source (ADMIN_CORRECTION / CUSTOMER_HANDOFF_REVIEW) needs this in addition to the
 * record's edit capability. Not one of the Commercial vocabulary keys above (migration 023): it belongs to the ownership
 * handoff domain shared with the CRM Account (migration 1763683200000).
 */
exports.OWNERSHIP_HANDOFF_CORRECT_CAPABILITY = "ownership.handoff.correct";
/** DQ-022: the handoff sources that state an administrative act, and so require OWNERSHIP_HANDOFF_CORRECT. */
exports.ADMINISTRATIVE_HANDOFF_SOURCES = new Set(["ADMIN_CORRECTION", "CUSTOMER_HANDOFF_REVIEW"]);
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
    "OPERATING_COMPANY_KEY_NOT_BOUND", "OPERATING_COMPANY_KEY_AMBIGUOUS",
    "ALREADY_CLOSED", "ILLEGAL_TRANSITION", "OUTCOME_REQUIRES_DECISION", "NO_LINES", "LINE_QTY_REQUIRED_FOR_WON", "CLOSED",
    "NO_CHANGES", "TERMINAL", "NOT_FULFILLABLE", "UNPRICED_LINE", "COMPANY_REQUIRED", "ALREADY_ESTABLISHED", "NOTHING_TO_HAND_OFF",
    "HANDOFF_IS_NO_OP", "NO_OP",
]);
const DOMAIN_ERROR_NAMES = new Set([
    "OpportunityCommandError", "SalesAgreementCommandError", "SalesOrderCommandError", "CommercialCompanyScopeError",
    "CommercialOwnershipError", "CreationOwnerUnresolvedError", "AttributionError", "CreationAccountablePersonError",
    "AccountablePersonMintError", "CommercialAccountabilityWriteError", "CommercialNumberingError", "EmployeeAuthorityFailure",
    // The governed company -> key binding (eosOps/operatingCompanyBinding.ts): an unkeyed or inactive company refuses.
    "OperatingCompanyBindingError",
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
async function runCommercialCommand(deps, actor, operation, requiredCapabilities, idempotencyKey, body, 
/**
 * The record the caller's input NAMES (e.g. the Opportunity an edit targets), for commands that act on an existing
 * record. A committed receipt for the same key is a replay ONLY of a command on that same record: the replay identity
 * is (tenant, principal, operation, key), so without this a key reused on a DIFFERENT record would return the first
 * record's result as "replayed" and apply nothing -- the false replay the retired Firestore path closed by scoping its
 * replay id to the record. Refused IDEMPOTENCY_KEY_REUSED instead.
 */
replayTarget) {
    if (!actor || typeof actor.tenantId !== "string" || actor.tenantId.trim() === "" || typeof actor.principalId !== "string" || actor.principalId.trim() === "") {
        throw new CommercialCommandError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant and principal are required");
    }
    if (!(actor.capabilities instanceof Set)) {
        throw new CommercialCommandError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved capability set is required");
    }
    // Global first (unchanged); a key absent from the flat set may still be held at sales-channel scope (DQ-020).
    const channelsByCapability = new Map();
    for (const c of requiredCapabilities) {
        if (actor.capabilities.has(c))
            continue;
        const channels = (0, assignmentScopeRuntime_1.admittedScopeValues)(actor.scopedHeld, c, "salesChannel");
        if (channels.length > 0)
            channelsByCapability.set(c, channels);
    }
    const missing = requiredCapabilities.filter((c) => !actor.capabilities.has(c) && !channelsByCapability.has(c));
    if (missing.length > 0) {
        throw new CommercialCommandError("CAPABILITY_REQUIRED", "FORBIDDEN", `this command requires ${missing.join(", ")}`);
    }
    let channelDecided = false;
    const scope = Object.freeze({
        global: channelsByCapability.size === 0,
        admitChannel(channel) {
            channelDecided = true;
            for (const [capability, channels] of channelsByCapability) {
                if (typeof channel !== "string" || channel === "" || !channels.includes(channel)) {
                    (0, exports.fail)("OUTSIDE_SALES_CHANNEL_SCOPE", "FORBIDDEN", `${capability} is held only for sales channel(s) ${channels.join(", ")}; this record's channel is ${channel ?? "unset"}`);
                }
            }
        },
    });
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
        const prior = await client.query(`SELECT result, target_family, target_id FROM eos_commercial.command_receipts
        WHERE tenant_id = $1 AND principal_id = $2 AND operation = $3 AND idempotency_key_hash = $4`, [actor.tenantId, actor.principalId, operation, keyHash]);
        if (prior.rows.length === 1) {
            const receipt = prior.rows[0];
            if (replayTarget && (receipt.target_family !== replayTarget.family || receipt.target_id !== replayTarget.id)) {
                (0, exports.fail)("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "this idempotency key was already used for a different record; use a new key for a new action");
            }
            await client.query("COMMIT");
            return { ...prior.rows[0].result, replayed: true };
        }
        const member = await client.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
        WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [actor.tenantId, actor.principalId]);
        if (member.rows.length === 0) {
            (0, exports.fail)("ACTOR_NOT_TENANT_MEMBER", "FORBIDDEN", "the principal is not an active member of this tenant");
        }
        const outcome = await body(client, now, scope);
        if (!scope.global && !channelDecided) {
            (0, exports.fail)("OUTSIDE_SALES_CHANNEL_SCOPE", "FORBIDDEN", "this command did not establish the record's sales channel for a channel-scoped caller");
        }
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
/**
 * A customer SITE stated on an Agreement or Sales Order must be one of THAT record's Account's governed sites
 * (eos_crm.account_locations). A National Accounts customer has many sites; a site id is never free text, never another
 * customer's site, and never a site that does not exist -- the read projection would otherwise silently show none.
 * (National Accounts reconciliation, 2026-09-30: the location was stored unvalidated.) null / absent states no site.
 */
async function requireAccountLocation(db, tenantId, accountId, locationId) {
    if (locationId === null || locationId === undefined)
        return;
    if (typeof locationId !== "string" || locationId.trim() === "" || locationId.length > 255) {
        (0, exports.fail)("LOCATION_INVALID", "INVALID_INPUT", "locationId, when stated, is a customer site id");
    }
    const { rows } = await db.query(`SELECT 1 FROM eos_crm.account_locations WHERE tenant_id = $1 AND account_id = $2 AND id = $3`, [tenantId, accountId, locationId]);
    if (rows.length === 0)
        (0, exports.fail)("LOCATION_NOT_FOR_ACCOUNT", "PRECONDITION_FAILED", "that site is not one of this customer's sites");
}
async function requireTenantAccount(db, tenantId, accountId) {
    const { rows } = await db.query(`SELECT id, owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
    if (rows.length === 0)
        (0, exports.fail)("ACCOUNT_NOT_FOUND", "NOT_FOUND", `no Account ${accountId} in this tenant`);
    return { id: rows[0].id, ownerEmployeeId: rows[0].owner_employee_id };
}
/**
 * NEW COMMERCIAL WORK REQUIRES AN ACTIVE SALES CHANNEL (Controller NATIONAL ACCOUNTS ACTIVATION, 2026-09-30: "Inactive
 * STRATEGIC_ACCOUNTS: not offered and not writable"). The channel a record is CREATED in, or MOVED into, must be one this
 * tenant has made ACTIVE (eos_policy.tenant_sales_channels, set through Administration setTenantSalesChannelStatus) --
 * for EVERY writer: a channel-scoped holder could never be assigned an inactive channel, but a GLOBAL holder's
 * admitChannel admits any channel, so this is the gate that closes it. SALES_CHANNEL_NOT_ACTIVE. Records already in a
 * channel that is later deactivated stay governed history and continue their lifecycle; nothing is rewritten.
 */
async function requireActiveSalesChannel(db, tenantId, salesChannel) {
    const { rows } = await db.query(`SELECT 1 FROM eos_policy.tenant_sales_channels WHERE tenant_id = $1 AND sales_channel::text = $2 AND status = 'ACTIVE'`, [tenantId, salesChannel]);
    if (rows.length === 0)
        (0, exports.fail)("SALES_CHANNEL_NOT_ACTIVE", "PRECONDITION_FAILED", `sales channel ${String(salesChannel)} is not active for this tenant`);
}
/**
 * NEW COMMERCIAL WORK REQUIRES AN ACTIVE CUSTOMER (Controller DQ-5, 2026-09-30). Opening an Opportunity, moving one onto
 * another customer, or booking a direct Sales Order refuses an Account whose CRM status is not ACTIVE (PROSPECT, INACTIVE,
 * ARCHIVED) with ACCOUNT_NOT_ACTIVE. Channel-blind: RETAIL and NATIONAL_ACCOUNTS alike. It governs only the act of
 * starting work -- records already on a customer that later goes inactive stay governed history and continue their
 * lifecycle; nothing is rewritten. Unknown / other-tenant Accounts remain ACCOUNT_NOT_FOUND (non-disclosing).
 */
async function requireActiveTenantAccount(db, tenantId, accountId) {
    const { rows } = await db.query(`SELECT id, owner_employee_id, status::text AS status FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
    if (rows.length === 0)
        (0, exports.fail)("ACCOUNT_NOT_FOUND", "NOT_FOUND", `no Account ${accountId} in this tenant`);
    if (rows[0].status !== "ACTIVE")
        (0, exports.fail)("ACCOUNT_NOT_ACTIVE", "PRECONDITION_FAILED", "new Commercial work requires an ACTIVE customer");
    return { id: rows[0].id, ownerEmployeeId: rows[0].owner_employee_id };
}
//# sourceMappingURL=commercialCommandKernel.js.map