"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createContact = createContact;
exports.updateContact = updateContact;
exports.getContact = getContact;
exports.listAccountContacts = listAccountContacts;
// Governed PostgreSQL Contact authority -- wave D1-A. Internal; nothing external invokes it yet.
//
//   createContact        a person AT an Account of the actor's tenant; owner inherited from that Account AT CREATION
//   updateContact        name, email, phone, contactRole, isPrimary ONLY -- never the Account, owner or attribution
//   getContact           one Contact of the actor's tenant
//   listAccountContacts  bounded keyset list of one Account's Contacts
//
// AUTHORITY. Owner ruling (V1): Contacts use `customer.record.read|create|update` for their verbs, the same capabilities
// as their Account. Repository evidence carries no finer distinction: legacyAuthorizationSurface row 23 gates `contacts`
// with the same predicate as `accounts`, and firestore.rules' contacts block is admin/dispatcher for read, create and
// update alike. Create is idempotent (runCrmCreate).
//
// TENANCY. The parent Account is read in the actor's tenant only, and `contacts_account_same_tenant` -- the composite
// (tenant_id, account_id) foreign key -- makes a cross-tenant link unrepresentable even if that read were skipped.
//
// A Contact is not a login: nothing here references eos_policy.principals except as the acting writer.
const node_crypto_1 = require("node:crypto");
const customerIdentity_js_1 = require("../crm/customerIdentity.js");
const crmAuthorityKernel_js_1 = require("./crmAuthorityKernel.js");
const COLUMNS = "id, account_id, name, email, phone, contact_role, is_primary, owner_employee_id, created_by, created_at, updated_by, updated_at";
const project = (row) => ({
    contactId: row.id,
    accountId: row.account_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    contactRole: row.contact_role,
    isPrimary: row.is_primary,
    ownerEmployeeId: row.owner_employee_id,
    createdBy: row.created_by,
    createdAt: (0, crmAuthorityKernel_js_1.isoOf)(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: (0, crmAuthorityKernel_js_1.isoOf)(row.updated_at),
});
function requireBoolean(value, field) {
    if (typeof value !== "boolean")
        (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", `${field} must be a boolean`);
    return value;
}
const CONTACT_UPDATE_COLUMNS = Object.freeze({
    name: "name",
    email: "email",
    phone: "phone",
    contactRole: "contact_role",
    isPrimary: "is_primary",
});
function contactFields(i) {
    const changes = new Map();
    if (i.name !== undefined)
        changes.set("name", (0, crmAuthorityKernel_js_1.requireName)(i.name, "a Contact"));
    for (const field of ["email", "phone", "contactRole"]) {
        if (i[field] !== undefined)
            changes.set(field, (0, crmAuthorityKernel_js_1.optionalText)(i[field], field));
    }
    if (i.isPrimary !== undefined)
        changes.set("isPrimary", requireBoolean(i.isPrimary, "isPrimary"));
    return changes;
}
// ════════════════════ commands ════════════════════
function createContact(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmCreate)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE, "crm.createContact", () => {
        const i = (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["idempotencyKey", "accountId", ...Object.keys(CONTACT_UPDATE_COLUMNS)]);
        const { idempotencyKey, request } = (0, crmAuthorityKernel_js_1.splitIdempotentInput)(i);
        const fields = contactFields(i);
        if (!fields.has("name"))
            (0, crmAuthorityKernel_js_1.fail)("NAME_REQUIRED", "INVALID_INPUT", "a Contact requires a name");
        return { idempotencyKey, request, accountId: (0, crmAuthorityKernel_js_1.requireRecordId)(i.accountId, "accountId"), fields };
    }, async (db, { tenantId, principalId }, { accountId, fields }) => {
        const parent = await (0, crmAuthorityKernel_js_1.requireTenantAccount)(db, tenantId, accountId, "SHARE");
        const { rows } = await db.query(`INSERT INTO eos_crm.contacts
           (id, tenant_id, account_id, name, email, phone, contact_role, is_primary, owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING ${COLUMNS}`, [`cont_${(0, node_crypto_1.randomUUID)()}`, tenantId, parent.id, fields.get("name"), fields.get("email") ?? null, fields.get("phone") ?? null,
            fields.get("contactRole") ?? null, fields.get("isPrimary") ?? false, (0, customerIdentity_js_1.inheritOwnerFromAccount)(parent.ownerEmployeeId), principalId]);
        return { result: project(rows[0]), targetType: "CONTACT", targetId: rows[0].id };
    });
}
function updateContact(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmCommand)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_UPDATE, () => {
        const i = (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["contactId", ...Object.keys(CONTACT_UPDATE_COLUMNS)]);
        const changes = contactFields(i);
        if (changes.size === 0)
            (0, crmAuthorityKernel_js_1.fail)("NO_CHANGES_REQUESTED", "INVALID_INPUT", "an update must name at least one accepted field");
        return { contactId: (0, crmAuthorityKernel_js_1.requireRecordId)(i.contactId, "contactId"), changes };
    }, async (db, { tenantId, principalId }, { contactId, changes }) => {
        const set = (0, crmAuthorityKernel_js_1.assignmentsOf)(changes, CONTACT_UPDATE_COLUMNS, 4);
        const { rows } = await db.query(`UPDATE eos_crm.contacts SET ${set.sql}, updated_by = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING ${COLUMNS}`, [tenantId, contactId, principalId, ...set.values]);
        if (rows.length === 0)
            (0, crmAuthorityKernel_js_1.fail)("CONTACT_NOT_FOUND", "NOT_FOUND", "the Contact does not exist in this tenant");
        return project(rows[0]);
    });
}
// ════════════════════ reads ════════════════════
function getContact(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmRead)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_READ, () => ({ contactId: (0, crmAuthorityKernel_js_1.requireRecordId)((0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["contactId"]).contactId, "contactId") }), async (db, tenantId, { contactId }) => {
        const { rows } = await db.query(`SELECT ${COLUMNS} FROM eos_crm.contacts WHERE tenant_id = $1 AND id = $2`, [tenantId, contactId]);
        if (rows.length === 0)
            (0, crmAuthorityKernel_js_1.fail)("CONTACT_NOT_FOUND", "NOT_FOUND", "the Contact does not exist in this tenant");
        return project(rows[0]);
    });
}
function listAccountContacts(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmRead)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_READ, () => {
        const i = (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["accountId", "limit", "cursor"]);
        return { accountId: (0, crmAuthorityKernel_js_1.requireRecordId)(i.accountId, "accountId"), limit: (0, crmAuthorityKernel_js_1.requirePageSize)(i.limit), cursor: (0, crmAuthorityKernel_js_1.decodeCrmCursor)("contact", i.cursor) };
    }, async (db, tenantId, { accountId, limit, cursor }) => {
        await (0, crmAuthorityKernel_js_1.requireTenantAccount)(db, tenantId, accountId);
        const { rows } = await db.query(`SELECT ${COLUMNS}, lower(btrim(name)) AS folded_name
           FROM eos_crm.contacts
          WHERE tenant_id = $1 AND account_id = $2
            AND ($3::text IS NULL OR (lower(btrim(name)), id) > ($3::text, $4::text))
          ORDER BY lower(btrim(name)), id
          LIMIT $5`, [tenantId, accountId, cursor?.name ?? null, cursor?.id ?? null, limit + 1]);
        return (0, crmAuthorityKernel_js_1.pageOf)("contact", rows, limit, project);
    });
}
//# sourceMappingURL=contactAuthority.js.map