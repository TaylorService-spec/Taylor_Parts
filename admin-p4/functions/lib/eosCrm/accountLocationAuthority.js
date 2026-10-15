"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAccountLocation = createAccountLocation;
exports.updateAccountLocation = updateAccountLocation;
exports.getAccountLocation = getAccountLocation;
exports.listAccountLocations = listAccountLocations;
// Governed PostgreSQL CRM customer-site (Location) authority -- wave D1-A. Internal; nothing external invokes it yet.
//
//   createAccountLocation   a customer site of an Account of the actor's tenant; owner inherited AT CREATION
//   updateAccountLocation   name, the four address parts, accessNotes ONLY -- never the Account, owner or attribution
//   getAccountLocation      one customer site of the actor's tenant
//   listAccountLocations    bounded keyset list of one Account's customer sites
//
// THE TWO `location` NAMESPACES (migration 1758758400000's header). This is `eos_crm.account_locations` -- a customer's
// site -- and never an inventory location. A payload carrying `type` / `locationType` is REFUSED before anything else is
// validated, and a `null` read means "not a customer site of this tenant", never "try the inventory namespace".
//
// AUTHORITY. Owner ruling (V1): customer sites use `customer.record.read|create|update` for their verbs, the same
// capabilities as their Account (firestore.rules' locations block is admin/dispatcher for read, create and update alike;
// legacyAuthorizationSurface row 23). Create is idempotent (runCrmCreate).
//
// TENANCY: the parent Account is read in the actor's tenant only, and `account_locations_account_same_tenant` makes a
// cross-tenant link unrepresentable.
const node_crypto_1 = require("node:crypto");
const customerIdentity_js_1 = require("../crm/customerIdentity.js");
const crmAuthorityKernel_js_1 = require("./crmAuthorityKernel.js");
const COLUMNS = "id, account_id, name, address_street, address_city, address_state, address_postal_code, access_notes, owner_employee_id, created_by, created_at, updated_by, updated_at";
const project = (row) => ({
    accountLocationId: row.id,
    accountId: row.account_id,
    name: row.name,
    addressStreet: row.address_street,
    addressCity: row.address_city,
    addressState: row.address_state,
    addressPostalCode: row.address_postal_code,
    accessNotes: row.access_notes,
    ownerEmployeeId: row.owner_employee_id,
    createdBy: row.created_by,
    createdAt: (0, crmAuthorityKernel_js_1.isoOf)(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: (0, crmAuthorityKernel_js_1.isoOf)(row.updated_at),
});
const LOCATION_UPDATE_COLUMNS = Object.freeze({
    name: "name",
    addressStreet: "address_street",
    addressCity: "address_city",
    addressState: "address_state",
    addressPostalCode: "address_postal_code",
    accessNotes: "access_notes",
});
/** The namespace guard runs on the RAW payload, before the allowlist could report `type` as merely unknown. */
function siteInput(input, keys) {
    if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        (0, customerIdentity_js_1.assertNoInventoryLocationDiscriminator)(input);
    }
    return (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, [...keys, ...Object.keys(LOCATION_UPDATE_COLUMNS)]);
}
function siteFields(i) {
    const changes = new Map();
    if (i.name !== undefined)
        changes.set("name", (0, crmAuthorityKernel_js_1.requireName)(i.name, "a customer site"));
    for (const field of ["addressStreet", "addressCity", "addressState", "addressPostalCode", "accessNotes"]) {
        if (i[field] !== undefined)
            changes.set(field, (0, crmAuthorityKernel_js_1.optionalText)(i[field], field));
    }
    return changes;
}
// ════════════════════ commands ════════════════════
function createAccountLocation(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmCreate)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE, "crm.createAccountLocation", () => {
        const i = siteInput(input, ["idempotencyKey", "accountId"]);
        const { idempotencyKey, request } = (0, crmAuthorityKernel_js_1.splitIdempotentInput)(i);
        const fields = siteFields(i);
        if (!fields.has("name"))
            (0, crmAuthorityKernel_js_1.fail)("NAME_REQUIRED", "INVALID_INPUT", "a customer site requires a name");
        return { idempotencyKey, request, accountId: (0, crmAuthorityKernel_js_1.requireRecordId)(i.accountId, "accountId"), fields };
    }, async (db, { tenantId, principalId }, { accountId, fields }) => {
        const parent = await (0, crmAuthorityKernel_js_1.requireTenantAccount)(db, tenantId, accountId, "SHARE");
        const { rows } = await db.query(`INSERT INTO eos_crm.account_locations
           (id, tenant_id, account_id, name, address_street, address_city, address_state, address_postal_code, access_notes,
            owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         RETURNING ${COLUMNS}`, [`site_${(0, node_crypto_1.randomUUID)()}`, tenantId, parent.id, fields.get("name"), fields.get("addressStreet") ?? null, fields.get("addressCity") ?? null,
            fields.get("addressState") ?? null, fields.get("addressPostalCode") ?? null, fields.get("accessNotes") ?? null,
            (0, customerIdentity_js_1.inheritOwnerFromAccount)(parent.ownerEmployeeId), principalId]);
        return { result: project(rows[0]), targetType: "ACCOUNT_LOCATION", targetId: rows[0].id };
    });
}
function updateAccountLocation(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmCommand)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_UPDATE, () => {
        const i = siteInput(input, ["accountLocationId"]);
        const changes = siteFields(i);
        if (changes.size === 0)
            (0, crmAuthorityKernel_js_1.fail)("NO_CHANGES_REQUESTED", "INVALID_INPUT", "an update must name at least one accepted field");
        return { accountLocationId: (0, crmAuthorityKernel_js_1.requireRecordId)(i.accountLocationId, "accountLocationId"), changes };
    }, async (db, { tenantId, principalId }, { accountLocationId, changes }) => {
        const set = (0, crmAuthorityKernel_js_1.assignmentsOf)(changes, LOCATION_UPDATE_COLUMNS, 4);
        const { rows } = await db.query(`UPDATE eos_crm.account_locations SET ${set.sql}, updated_by = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING ${COLUMNS}`, [tenantId, accountLocationId, principalId, ...set.values]);
        if (rows.length === 0)
            (0, crmAuthorityKernel_js_1.fail)("ACCOUNT_LOCATION_NOT_FOUND", "NOT_FOUND", "the customer site does not exist in this tenant");
        return project(rows[0]);
    });
}
// ════════════════════ reads ════════════════════
function getAccountLocation(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmRead)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_READ, () => ({ accountLocationId: (0, crmAuthorityKernel_js_1.requireRecordId)((0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["accountLocationId"]).accountLocationId, "accountLocationId") }), async (db, tenantId, { accountLocationId }) => {
        const { rows } = await db.query(`SELECT ${COLUMNS} FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = $2`, [tenantId, accountLocationId]);
        if (rows.length === 0)
            (0, crmAuthorityKernel_js_1.fail)("ACCOUNT_LOCATION_NOT_FOUND", "NOT_FOUND", "the customer site does not exist in this tenant");
        return project(rows[0]);
    });
}
function listAccountLocations(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmRead)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_READ, () => {
        const i = (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["accountId", "limit", "cursor"]);
        return { accountId: (0, crmAuthorityKernel_js_1.requireRecordId)(i.accountId, "accountId"), limit: (0, crmAuthorityKernel_js_1.requirePageSize)(i.limit), cursor: (0, crmAuthorityKernel_js_1.decodeCrmCursor)("accountLocation", i.cursor) };
    }, async (db, tenantId, { accountId, limit, cursor }) => {
        await (0, crmAuthorityKernel_js_1.requireTenantAccount)(db, tenantId, accountId);
        const { rows } = await db.query(`SELECT ${COLUMNS}, lower(btrim(name)) AS folded_name
           FROM eos_crm.account_locations
          WHERE tenant_id = $1 AND account_id = $2
            AND ($3::text IS NULL OR (lower(btrim(name)), id) > ($3::text, $4::text))
          ORDER BY lower(btrim(name)), id
          LIMIT $5`, [tenantId, accountId, cursor?.name ?? null, cursor?.id ?? null, limit + 1]);
        return (0, crmAuthorityKernel_js_1.pageOf)("accountLocation", rows, limit, project);
    });
}
//# sourceMappingURL=accountLocationAuthority.js.map