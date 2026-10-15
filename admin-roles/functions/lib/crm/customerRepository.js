"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrmRepositoryError = void 0;
exports.createAccount = createAccount;
exports.assignAccountOwner = assignAccountOwner;
exports.createContact = createContact;
exports.createAccountLocation = createAccountLocation;
exports.readAccount = readAccount;
exports.readAccountLocation = readAccountLocation;
exports.listAccountLocations = listAccountLocations;
exports.listAccountContacts = listAccountContacts;
exports.findAccountsByFoldedName = findAccountsByFoldedName;
const customerIdentity_js_1 = require("./customerIdentity.js");
const SCHEMA = "eos_crm";
class CrmRepositoryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "CrmRepositoryError";
    }
}
exports.CrmRepositoryError = CrmRepositoryError;
const optionalText = (value, what) => {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== "string")
        throw new customerIdentity_js_1.CrmIdentityError(`${what} must be a string when present`);
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
};
const requireStatus = (value) => {
    if (!(0, customerIdentity_js_1.isCrmAccountStatus)(value)) {
        throw new CrmRepositoryError("STATUS_INVALID", "an Account status is one of PROSPECT, ACTIVE, INACTIVE, ARCHIVED — the lifecycle of D-C1-5, not a free string");
    }
    return value;
};
/** 23505 is a unique violation. Reported as the domain fact rather than as a constraint name. */
const isDuplicate = (err) => typeof err === "object" && err !== null && err.code === "23505";
async function inTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        try {
            await client.query("ROLLBACK");
        }
        catch {
            // A failed rollback must not mask the error that caused it.
        }
        throw err;
    }
    finally {
        client.release();
    }
}
const toAccount = (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    status: row.status,
    ownerEmployeeId: row.owner_employee_id ?? null,
});
const toContact = (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    name: row.name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    contactRole: row.contact_role ?? null,
    isPrimary: row.is_primary === true,
    ownerEmployeeId: row.owner_employee_id ?? null,
});
const toAccountLocation = (row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    name: row.name,
    addressStreet: row.address_street ?? null,
    addressCity: row.address_city ?? null,
    addressState: row.address_state ?? null,
    addressPostalCode: row.address_postal_code ?? null,
    accessNotes: row.access_notes ?? null,
    ownerEmployeeId: row.owner_employee_id ?? null,
});
async function createAccount(pool, tenantId, actorId, input) {
    const id = (0, customerIdentity_js_1.requireCrmId)(input.id, "an Account id");
    const name = (0, customerIdentity_js_1.requireCustomerName)(input.name, "an Account");
    const status = requireStatus(input.status);
    const owner = (0, customerIdentity_js_1.requireExplicitAccountOwner)(input.ownerEmployeeId ?? null);
    try {
        const result = await pool.query(`INSERT INTO ${SCHEMA}.accounts
         (id, tenant_id, name, status, owner_employee_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`, [id, tenantId, name, status, owner, actorId]);
        return toAccount(result.rows[0]);
    }
    catch (err) {
        if (isDuplicate(err)) {
            throw new CrmRepositoryError("DUPLICATE_ID", `an Account already exists with id ${id}`);
        }
        throw err;
    }
}
/**
 * Assign or clear an Account's owner — the ONLY way one is ever set after creation.
 *
 * Ruling D-6 again: this takes the owner as an argument and cannot reach the actor, a territory, or
 * any activity history. Passing `null` is a legitimate act (returning an Account to OWNERLESS), not
 * a failure to supply one.
 */
async function assignAccountOwner(pool, tenantId, actorId, accountId, ownerEmployeeId) {
    const owner = (0, customerIdentity_js_1.requireExplicitAccountOwner)(ownerEmployeeId);
    const result = await pool.query(`UPDATE ${SCHEMA}.accounts
        SET owner_employee_id = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`, [tenantId, accountId, owner, actorId]);
    if (result.rowCount === 0) {
        // A cross-tenant row reads as absent, the same posture postgresPolicyRepository.ts takes.
        throw new CrmRepositoryError("ACCOUNT_NOT_FOUND", `no Account ${accountId} in this tenant`);
    }
    return toAccount(result.rows[0]);
}
/**
 * Create a Contact, inheriting its owner from the parent Account IN THE SAME TRANSACTION.
 *
 * The read of the parent's owner and the INSERT that records it are one act. Split across two round
 * trips, a handoff of the Account between them would produce a Contact whose "inherited" owner was
 * never its parent's — an inheritance that is false at the moment it is written.
 */
async function createContact(pool, tenantId, actorId, input) {
    const id = (0, customerIdentity_js_1.requireCrmId)(input.id, "a Contact id");
    const accountId = (0, customerIdentity_js_1.requireCrmId)(input.accountId, "a Contact's accountId");
    const name = (0, customerIdentity_js_1.requireCustomerName)(input.name, "a Contact");
    const email = optionalText(input.email, "a Contact email");
    const phone = optionalText(input.phone, "a Contact phone");
    const contactRole = optionalText(input.contactRole, "a Contact role");
    return inTransaction(pool, async (client) => {
        const owner = await selectAccountOwner(client, tenantId, accountId);
        try {
            const result = await client.query(`INSERT INTO ${SCHEMA}.contacts
           (id, tenant_id, account_id, name, email, phone, contact_role, is_primary,
            owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING *`, [id, tenantId, accountId, name, email, phone, contactRole,
                input.isPrimary === true, (0, customerIdentity_js_1.inheritOwnerFromAccount)(owner), actorId]);
            return toContact(result.rows[0]);
        }
        catch (err) {
            if (isDuplicate(err)) {
                throw new CrmRepositoryError("DUPLICATE_ID", `a Contact already exists with id ${id}`);
            }
            throw err;
        }
    });
}
/**
 * Create a CRM customer site.
 *
 * THE NAMESPACE GUARD RUNS FIRST, on the raw input, before anything is validated or written. A
 * caller that supplied `type: "WAREHOUSE"` meant an inventory location; writing the row without it
 * would silently record a warehouse as a customer's site and lose the only evidence of the mistake.
 * The `accountId` is mandatory here and NOT NULL in the schema for the same reason — an inventory
 * location has no Account, so it cannot be expressed through this function at all.
 */
async function createAccountLocation(pool, tenantId, actorId, input) {
    (0, customerIdentity_js_1.assertNoInventoryLocationDiscriminator)(input);
    const id = (0, customerIdentity_js_1.requireCrmId)(input.id, "a customer site id");
    const accountId = (0, customerIdentity_js_1.requireCrmId)(input.accountId, "a customer site's accountId");
    const name = (0, customerIdentity_js_1.requireCustomerName)(input.name, "a customer site");
    const street = optionalText(input.addressStreet, "a street");
    const city = optionalText(input.addressCity, "a city");
    const state = optionalText(input.addressState, "a state");
    const postalCode = optionalText(input.addressPostalCode, "a postal code");
    const accessNotes = optionalText(input.accessNotes, "access notes");
    return inTransaction(pool, async (client) => {
        const owner = await selectAccountOwner(client, tenantId, accountId);
        try {
            const result = await client.query(`INSERT INTO ${SCHEMA}.account_locations
           (id, tenant_id, account_id, name, address_street, address_city, address_state,
            address_postal_code, access_notes, owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         RETURNING *`, [id, tenantId, accountId, name, street, city, state, postalCode, accessNotes,
                (0, customerIdentity_js_1.inheritOwnerFromAccount)(owner), actorId]);
            return toAccountLocation(result.rows[0]);
        }
        catch (err) {
            if (isDuplicate(err)) {
                throw new CrmRepositoryError("DUPLICATE_ID", `a customer site already exists with id ${id}`);
            }
            throw err;
        }
    });
}
async function selectAccountOwner(client, tenantId, accountId) {
    const parent = await client.query(`SELECT owner_employee_id FROM ${SCHEMA}.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
    if (parent.rowCount === 0) {
        throw new CrmRepositoryError("ACCOUNT_NOT_FOUND", `no Account ${accountId} in this tenant`);
    }
    return parent.rows[0].owner_employee_id ?? null;
}
// ════════════════════ reads ════════════════════
async function readAccount(pool, tenantId, accountId) {
    const result = await pool.query(`SELECT * FROM ${SCHEMA}.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
    return result.rowCount === 0 ? null : toAccount(result.rows[0]);
}
/**
 * Is this id a customer site of this tenant?
 *
 * `null` MEANS "NOT A CUSTOMER SITE". It does not mean "try the inventory namespace next". See the
 * file header.
 */
async function readAccountLocation(pool, tenantId, locationId) {
    const result = await pool.query(`SELECT * FROM ${SCHEMA}.account_locations WHERE tenant_id = $1 AND id = $2`, [tenantId, locationId]);
    return result.rowCount === 0 ? null : toAccountLocation(result.rows[0]);
}
async function listAccountLocations(pool, tenantId, accountId) {
    const result = await pool.query(`SELECT * FROM ${SCHEMA}.account_locations
      WHERE tenant_id = $1 AND account_id = $2 ORDER BY lower(btrim(name)), id`, [tenantId, accountId]);
    return result.rows.map((r) => toAccountLocation(r));
}
async function listAccountContacts(pool, tenantId, accountId) {
    const result = await pool.query(`SELECT * FROM ${SCHEMA}.contacts
      WHERE tenant_id = $1 AND account_id = $2 ORDER BY lower(btrim(name)), id`, [tenantId, accountId]);
    return result.rows.map((r) => toContact(r));
}
/**
 * The ADVISORY duplicate lookup of D-C1-4 — a normalized-name match, never a constraint.
 *
 * It returns the candidates and says nothing about what to do with them, because the ruling is that
 * duplicate prevention is advisory at create: two genuinely distinct customers may share a name,
 * and the schema deliberately carries no unique index that would refuse the second one.
 */
async function findAccountsByFoldedName(pool, tenantId, name) {
    const result = await pool.query(`SELECT * FROM ${SCHEMA}.accounts
      WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) ORDER BY id`, [tenantId, name]);
    return result.rows.map((r) => toAccount(r));
}
//# sourceMappingURL=customerRepository.js.map