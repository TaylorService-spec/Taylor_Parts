"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_OWNERSHIP_EVENTS = exports.MAX_ACCOUNT_HANDOFF_REASON_LENGTH = exports.ACCOUNT_OWNERSHIP_HANDOFF_SOURCES = void 0;
exports.createAccount = createAccount;
exports.updateAccount = updateAccount;
exports.getAccount = getAccount;
exports.listAccounts = listAccounts;
exports.listAccountOwnershipHistory = listAccountOwnershipHistory;
// Governed PostgreSQL Account authority -- wave D1-A. Internal; nothing external invokes it yet.
//
//   createAccount                  customer.record.create   idempotent; an EXPLICIT same-tenant Employee owner is REQUIRED
//   updateAccount                  customer.record.update   the business-field allowlist; paymentTerms / taxStatus changes
//                                                           also require customer.governedField.write; an owner change is
//                                                           a governed ownership-history event (below)
//   getAccount                     customer.record.read     one Account of the actor's tenant, with every governed business fact
//   listAccounts                   customer.record.read     bounded keyset list, optional status filter and folded-name prefix
//   listAccountOwnershipHistory    customer.record.read     one Account's append-only ownership history, newest first, bounded
//
// IDENTITY. `eos_crm.accounts.id` is THE canonical Account id: `eos_commercial.*.account_id` references it through the
// composite (tenant_id, account_id) foreign keys of migration 1759449600000. There is no mapping id; a new Account's id
// is minted once, here.
//
// OWNERSHIP IS NOT ATTRIBUTION. `created_by` / `updated_by` are the acting EOS Principal. The owner is an Employee the
// governed PostgreSQL Employee authority RESOLVES in this tenant, supplied explicitly at creation. It is never derived
// from the Principal, a Firebase uid, a Security Role, a Job Role or the creator, and this authority cannot create an
// ownerless Account. Owner ruling: legacy accountOwner.assignedBy* / assignedAt never become Account columns; owner
// changes go through a governed Account ownership-handoff writer (prior owner, new owner, effective time, changed-by
// Principal, governed reason/source).
//
// OWNERSHIP HISTORY (migration 1759924800000) -- PARITY with the Commercial Opportunity edit (opportunityCommandService
// + stageCommercialOwnershipTransfer), under the EXISTING customer.record.update: the legacy product let whoever could
// edit an Account change its owner, so no capability is added. `ownerEmployeeId` on updateAccount, with an optional
// `ownershipHandoff: { source?, reason? }`; the CURRENT owner is read under FOR UPDATE, never supplied:
//   * same owner                    no-op for ownership, no history row (naming ownershipHandoff with it refuses).
//   * owner A -> different owner B  OWNER_HANDOFF: previous A, new B, source (default DIRECT_HANDOFF), optional reason.
//   * NO owner -> owner B           INITIAL_OWNER_ASSIGNMENT (Owner ruling, option b): a legacy OWNERLESS Account (migration
//                                   008's state, carried by the cutover) receives its first owner. It is not a handoff:
//                                   no previous owner is invented, no source applies (naming ownershipHandoff.source
//                                   refuses INITIAL_OWNER_ASSIGNMENT_SOURCE_NOT_ALLOWED), reason stays optional, and the
//                                   legacy accountOwner.assignedBy* actor is never fabricated -- the actor is the Principal.
//   * owner -> null                 refuses OWNER_REQUIRED: a governed Account is never made ownerless.
//   * expectedCurrentOwnerEmployeeId (optional; null = "I read it ownerless"): when named, the change applies only if
//                                   the locked current owner still matches, else ACCOUNT_OWNER_CHANGED_SINCE_READ (412)
//                                   and nothing in the command is written -- a stale form never turns an intended first
//                                   assignment into a handoff, or a handoff into a different one.
// A new owner resolves exactly as at creation (requireOwnerEmployee). The history row and the owner column move in the
// SAME transaction as every other field change and the updated_by / updated_at attribution. effective_at is the INSERT's
// statement_timestamp(), taken AFTER the FOR UPDATE lock was granted, so concurrent changes order by effective time
// exactly as they serialized. NO CASCADE: Contacts and customer sites keep their own owner (inherited at creation only).
//
// BILLING ADDRESS. Owner ruling: a single free-text billing address is never parsed into the structured parts; it is
// refused here (FIELD_INVALID) and belongs only in import staging / reconciliation evidence until resolved.
//
// STATUS. The canonical vocabulary only. D-C1-5's transition graph is PROPOSED and is not enforced.
//
// GOVERNED FIELDS. Mirrors firestore.rules accountGovernedFieldsValid / accountGovernedCreateBaseline /
// accountGovernedFieldsUnchanged: the values are validated for everyone; creating beyond the baseline (paymentTerms
// unset, taxStatus unset or UNKNOWN) or changing either stored value requires customer.governedField.write.
const node_crypto_1 = require("node:crypto");
const customerIdentity_js_1 = require("../crm/customerIdentity.js");
const postgresEmployeeAuthority_js_1 = require("../employeeIdentity/postgresEmployeeAuthority.js");
const accountVocabulary_js_1 = require("./accountVocabulary.js");
const crmAuthorityKernel_js_1 = require("./crmAuthorityKernel.js");
/** One Account row with its normalized children, in canonical order. `a` is the eos_crm.accounts alias. */
const COLUMNS = `a.id, a.name, a.status, a.owner_employee_id, a.notes, a.billing_address_street, a.billing_address_city,
  a.billing_address_state, a.billing_address_postal_code, a.customer_number, a.erp_id, a.accounting_id, a.legacy_id,
  a.default_currency, a.purchase_order_required, a.invoice_delivery_method, a.payment_terms, a.tax_status,
  a.billing_contact_id, a.created_by, a.created_at, a.updated_by, a.updated_at,
  ARRAY(SELECT t.tag FROM eos_crm.account_tags t WHERE t.tenant_id = a.tenant_id AND t.account_id = a.id ORDER BY t.position) AS tags,
  ARRAY(SELECT r.relationship_type FROM eos_crm.account_relationship_types r WHERE r.tenant_id = a.tenant_id AND r.account_id = a.id) AS relationship_types,
  ARRAY(SELECT l.line_of_business FROM eos_crm.account_lines_of_business l WHERE l.tenant_id = a.tenant_id AND l.account_id = a.id) AS lines_of_business`;
/** A stored set, in the vocabulary's canonical order (the order the Account form writes). */
const inCanonicalOrder = (values, vocabulary) => [...values].sort((x, y) => vocabulary.indexOf(x) - vocabulary.indexOf(y) || (x < y ? -1 : x > y ? 1 : 0));
const project = (row) => {
    const address = [row.billing_address_street, row.billing_address_city, row.billing_address_state, row.billing_address_postal_code];
    return {
        accountId: row.id,
        name: row.name,
        status: row.status,
        ownerEmployeeId: row.owner_employee_id,
        notes: row.notes,
        billingAddress: address.every((p) => p === null)
            ? null
            : { street: row.billing_address_street, city: row.billing_address_city, state: row.billing_address_state, zip: row.billing_address_postal_code },
        customerNumber: row.customer_number,
        erpId: row.erp_id,
        accountingId: row.accounting_id,
        legacyId: row.legacy_id,
        defaultCurrency: row.default_currency,
        purchaseOrderRequired: row.purchase_order_required,
        invoiceDeliveryMethod: row.invoice_delivery_method,
        paymentTerms: row.payment_terms,
        taxStatus: row.tax_status,
        billingContactId: row.billing_contact_id,
        tags: row.tags,
        relationshipTypes: inCanonicalOrder(row.relationship_types, accountVocabulary_js_1.ACCOUNT_RELATIONSHIP_TYPES),
        lineOfBusiness: inCanonicalOrder(row.lines_of_business, accountVocabulary_js_1.ACCOUNT_LINES_OF_BUSINESS),
        createdBy: row.created_by,
        createdAt: (0, crmAuthorityKernel_js_1.isoOf)(row.created_at),
        updatedBy: row.updated_by,
        updatedAt: (0, crmAuthorityKernel_js_1.isoOf)(row.updated_at),
    };
};
// ════════════════════ field validation ════════════════════
function requireStatus(value) {
    if (!(0, customerIdentity_js_1.isCrmAccountStatus)(value))
        (0, crmAuthorityKernel_js_1.fail)("STATUS_INVALID", "INVALID_INPUT", `status must be one of ${customerIdentity_js_1.CRM_ACCOUNT_STATUSES.join(", ")}`);
    return value;
}
function optionalEnum(value, field, allowed) {
    if (value === null)
        return null;
    if (typeof value !== "string" || !allowed.includes(value))
        (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", `${field} must be one of ${allowed.join(", ")}, or null`);
    return value;
}
function enumSet(value, field, allowed) {
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && allowed.includes(v)) || new Set(value).size !== value.length) {
        (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", `${field} must be an array of distinct values from ${allowed.join(", ")}`);
    }
    // Canonical order, as the Account form writes it.
    return allowed.filter((v) => value.includes(v));
}
function tagList(value) {
    if (!Array.isArray(value) || value.length > accountVocabulary_js_1.MAX_ACCOUNT_TAGS) {
        (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", `tags must be an array of at most ${accountVocabulary_js_1.MAX_ACCOUNT_TAGS} strings`);
    }
    const tags = value.map((t) => {
        if (typeof t !== "string" || t.trim() === "" || t.trim().length > accountVocabulary_js_1.MAX_ACCOUNT_TAG_LENGTH) {
            (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", `each tag must be a non-blank string of at most ${accountVocabulary_js_1.MAX_ACCOUNT_TAG_LENGTH} characters`);
        }
        return t.trim();
    });
    if (new Set(tags).size !== tags.length)
        (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", "tags must be distinct");
    return tags;
}
function billingAddress(value) {
    if (value === null)
        return [null, null, null, null];
    if (typeof value !== "object" || Array.isArray(value))
        (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", "billingAddress must be { street, city, state, zip } or null");
    const record = value;
    const unknown = Object.keys(record).filter((k) => !["street", "city", "state", "zip"].includes(k));
    if (unknown.length > 0)
        (0, crmAuthorityKernel_js_1.fail)("FIELD_NOT_ALLOWED", "INVALID_INPUT", `not an accepted billingAddress part: ${unknown.sort().join(", ")}`);
    return [(0, crmAuthorityKernel_js_1.optionalText)(record.street, "billingAddress.street"), (0, crmAuthorityKernel_js_1.optionalText)(record.city, "billingAddress.city"),
        (0, crmAuthorityKernel_js_1.optionalText)(record.state, "billingAddress.state"), (0, crmAuthorityKernel_js_1.optionalText)(record.zip, "billingAddress.zip")];
}
function currency(value) {
    if (value === null)
        return null;
    if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value) || !accountVocabulary_js_1.ISO_4217_CURRENCIES.has(value)) {
        (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", "defaultCurrency must be an ISO 4217 alphabetic code (e.g. USD), or null");
    }
    return value;
}
function optionalBoolean(value, field) {
    if (value !== null && typeof value !== "boolean")
        (0, crmAuthorityKernel_js_1.fail)("FIELD_INVALID", "INVALID_INPUT", `${field} must be a boolean or null`);
    return value;
}
/** Scalar business fields: input name -> [column, validator]. Column names only ever come from here. */
const SCALAR_FIELDS = Object.freeze({
    name: ["name", (v) => (0, crmAuthorityKernel_js_1.requireName)(v, "an Account")],
    status: ["status", requireStatus],
    notes: ["notes", (v) => (0, crmAuthorityKernel_js_1.optionalText)(v, "notes")],
    customerNumber: ["customer_number", (v) => (0, crmAuthorityKernel_js_1.optionalText)(v, "customerNumber")],
    erpId: ["erp_id", (v) => (0, crmAuthorityKernel_js_1.optionalText)(v, "erpId")],
    accountingId: ["accounting_id", (v) => (0, crmAuthorityKernel_js_1.optionalText)(v, "accountingId")],
    legacyId: ["legacy_id", (v) => (0, crmAuthorityKernel_js_1.optionalText)(v, "legacyId")],
    defaultCurrency: ["default_currency", currency],
    purchaseOrderRequired: ["purchase_order_required", (v) => optionalBoolean(v, "purchaseOrderRequired")],
    invoiceDeliveryMethod: ["invoice_delivery_method", (v) => optionalEnum(v, "invoiceDeliveryMethod", accountVocabulary_js_1.INVOICE_DELIVERY_METHODS)],
    paymentTerms: ["payment_terms", (v) => optionalEnum(v, "paymentTerms", accountVocabulary_js_1.PAYMENT_TERMS)],
    taxStatus: ["tax_status", (v) => optionalEnum(v, "taxStatus", accountVocabulary_js_1.TAX_STATUSES)],
    billingContactId: ["billing_contact_id", (v) => (v === null ? null : (0, crmAuthorityKernel_js_1.requireRecordId)(v, "billingContactId"))],
});
const ADDRESS_COLUMNS = ["billing_address_street", "billing_address_city", "billing_address_state", "billing_address_postal_code"];
const SET_FIELDS = ["tags", "relationshipTypes", "lineOfBusiness"];
function accountFields(i) {
    const columns = new Map();
    for (const [field, [column, validate]] of Object.entries(SCALAR_FIELDS)) {
        if (i[field] !== undefined)
            columns.set(column, validate(i[field]));
    }
    if (i.billingAddress !== undefined)
        billingAddress(i.billingAddress).forEach((part, n) => columns.set(ADDRESS_COLUMNS[n], part));
    return {
        columns,
        tags: i.tags === undefined ? undefined : tagList(i.tags),
        relationshipTypes: i.relationshipTypes === undefined ? undefined : enumSet(i.relationshipTypes, "relationshipTypes", accountVocabulary_js_1.ACCOUNT_RELATIONSHIP_TYPES),
        lineOfBusiness: i.lineOfBusiness === undefined ? undefined : enumSet(i.lineOfBusiness, "lineOfBusiness", accountVocabulary_js_1.ACCOUNT_LINES_OF_BUSINESS),
    };
}
const requireGovernedFieldCapability = (actor) => {
    if (!actor.capabilities.has(crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_GOVERNED_FIELD_WRITE)) {
        (0, crmAuthorityKernel_js_1.fail)("CAPABILITY_REQUIRED", "FORBIDDEN", `setting or changing paymentTerms or taxStatus requires ${crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_GOVERNED_FIELD_WRITE}`);
    }
};
async function replaceChildren(db, tenantId, accountId, fields, replacing) {
    const sets = [
        ["account_tags", "tag", fields.tags, true],
        ["account_relationship_types", "relationship_type", fields.relationshipTypes, false],
        ["account_lines_of_business", "line_of_business", fields.lineOfBusiness, false],
    ];
    for (const [table, column, values, ordered] of sets) {
        if (values === undefined)
            continue;
        if (replacing)
            await db.query(`DELETE FROM eos_crm.${table} WHERE tenant_id = $1 AND account_id = $2`, [tenantId, accountId]);
        if (values.length === 0)
            continue;
        await db.query(ordered
            ? `INSERT INTO eos_crm.${table} (tenant_id, account_id, position, ${column})
           SELECT $1, $2, (v.ord - 1)::smallint, v.value FROM unnest($3::text[]) WITH ORDINALITY AS v(value, ord)`
            : `INSERT INTO eos_crm.${table} (tenant_id, account_id, ${column}) SELECT $1, $2, v.value FROM unnest($3::text[]) AS v(value)`, [tenantId, accountId, values]);
    }
}
async function selectAccount(db, tenantId, accountId) {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM eos_crm.accounts a WHERE a.tenant_id = $1 AND a.id = $2`, [tenantId, accountId]);
    if (rows.length === 0)
        (0, crmAuthorityKernel_js_1.fail)("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
    return project(rows[0]);
}
async function requireOwnerEmployee(db, tenantId, employeeId) {
    const resolution = await (0, postgresEmployeeAuthority_js_1.createPostgresEmployeeAuthority)(db).resolveEmployeeReference({ tenantId, employeeId });
    if (resolution.outcome === "RESOLVED")
        return resolution.employee.employeeId;
    if (resolution.outcome === "AUTHORITY_UNAVAILABLE")
        (0, crmAuthorityKernel_js_1.fail)("EMPLOYEE_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "the Employee authority could not answer");
    return (0, crmAuthorityKernel_js_1.fail)("OWNER_NOT_FOUND", "NOT_FOUND", "the owner is not an Employee of this tenant");
}
/** An explicit owner id, shaped like an Employee id. Absent or null is OWNER_REQUIRED: a governed Account is never ownerless. */
function requireOwnerEmployeeId(value) {
    if (value === undefined || value === null)
        (0, crmAuthorityKernel_js_1.fail)("OWNER_REQUIRED", "INVALID_INPUT", "an Account requires an explicit owner: an Employee of this tenant");
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value))
        (0, crmAuthorityKernel_js_1.fail)("OWNER_INVALID", "INVALID_INPUT", "ownerEmployeeId must be an Employee id");
    return value;
}
/** Mirrors OWNERSHIP_HANDOFF_SOURCES (access/auditEventWriter.ts), COMMERCIAL_HANDOFF_SOURCES and migration 1759924800000. */
exports.ACCOUNT_OWNERSHIP_HANDOFF_SOURCES = Object.freeze(["DIRECT_HANDOFF", "CUSTOMER_HANDOFF_REVIEW", "ADMIN_CORRECTION"]);
/** The audit writer's MAX_HANDOFF_REASON_LENGTH, as eos_commercial.ownership_handoffs holds it. */
exports.MAX_ACCOUNT_HANDOFF_REASON_LENGTH = 500;
const DEFAULT_HANDOFF_SOURCE = "DIRECT_HANDOFF";
exports.ACCOUNT_OWNERSHIP_EVENTS = Object.freeze(["OWNER_HANDOFF", "INITIAL_OWNER_ASSIGNMENT"]);
function ownershipTerms(value) {
    if (value === undefined)
        return { named: false, sourceNamed: false, source: DEFAULT_HANDOFF_SOURCE, reason: null };
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        (0, crmAuthorityKernel_js_1.fail)("HANDOFF_INVALID", "INVALID_INPUT", "ownershipHandoff must be an object { source?, reason? }");
    }
    const record = value;
    const unknown = Object.keys(record).filter((k) => k !== "source" && k !== "reason");
    if (unknown.length > 0)
        (0, crmAuthorityKernel_js_1.fail)("FIELD_NOT_ALLOWED", "INVALID_INPUT", `not an accepted ownershipHandoff field: ${unknown.sort().join(", ")}`);
    const source = record.source === undefined ? DEFAULT_HANDOFF_SOURCE : record.source;
    if (typeof source !== "string" || !exports.ACCOUNT_OWNERSHIP_HANDOFF_SOURCES.includes(source)) {
        (0, crmAuthorityKernel_js_1.fail)("HANDOFF_SOURCE_INVALID", "INVALID_INPUT", `ownershipHandoff.source must be one of ${exports.ACCOUNT_OWNERSHIP_HANDOFF_SOURCES.join(", ")}`);
    }
    let reason = null;
    if (record.reason !== undefined && record.reason !== null) {
        if (typeof record.reason !== "string")
            (0, crmAuthorityKernel_js_1.fail)("HANDOFF_REASON_INVALID", "INVALID_INPUT", "ownershipHandoff.reason must be a string or null");
        const trimmed = record.reason.trim();
        if (trimmed.length > exports.MAX_ACCOUNT_HANDOFF_REASON_LENGTH) {
            (0, crmAuthorityKernel_js_1.fail)("HANDOFF_REASON_INVALID", "INVALID_INPUT", `ownershipHandoff.reason must be at most ${exports.MAX_ACCOUNT_HANDOFF_REASON_LENGTH} characters`);
        }
        reason = trimmed === "" ? null : trimmed;
    }
    return { named: true, sourceNamed: record.source !== undefined, source: source, reason };
}
/**
 * Append ONE ownership-history event and move the current owner, on the CALLER's transaction. `previousOwnerEmployeeId`
 * is the value the caller read under FOR UPDATE in this same transaction: null makes the event INITIAL_OWNER_ASSIGNMENT
 * (no source), otherwise OWNER_HANDOFF. One Account; nothing cascades to its Contacts or sites.
 */
async function stageAccountOwnershipChange(db, tenantId, principalId, accountId, previousOwnerEmployeeId, newOwnerEmployeeId, terms) {
    const event = previousOwnerEmployeeId === null ? "INITIAL_OWNER_ASSIGNMENT" : "OWNER_HANDOFF";
    await db.query(`INSERT INTO eos_crm.account_ownership_history
       (id, tenant_id, account_id, event, previous_owner_employee_id, new_owner_employee_id, source, reason, changed_by, effective_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             -- Strictly after this Account's previous event even if the wall clock stepped back: the Account row lock
             -- serializes ownership writers, so the chain's effective order is its causal order.
             GREATEST(statement_timestamp(), (SELECT max(effective_at) + interval '1 microsecond' FROM eos_crm.account_ownership_history
                                              WHERE tenant_id = $2 AND account_id = $3)))`, [`acown_${(0, node_crypto_1.randomUUID)()}`, tenantId, accountId, event, previousOwnerEmployeeId, newOwnerEmployeeId,
        event === "OWNER_HANDOFF" ? terms.source : null, terms.reason, principalId]);
    await db.query(`UPDATE eos_crm.accounts SET owner_employee_id = $3 WHERE tenant_id = $1 AND id = $2 AND owner_employee_id IS NOT DISTINCT FROM $4`, [tenantId, accountId, newOwnerEmployeeId, previousOwnerEmployeeId]);
}
const CREATE_FIELDS = ["idempotencyKey", "ownerEmployeeId", "billingAddress", ...SET_FIELDS, ...Object.keys(SCALAR_FIELDS).filter((f) => f !== "billingContactId")];
const UPDATE_FIELDS = ["accountId", "ownerEmployeeId", "expectedCurrentOwnerEmployeeId", "ownershipHandoff", "billingAddress", ...SET_FIELDS, ...Object.keys(SCALAR_FIELDS)];
// ════════════════════ commands ════════════════════
function createAccount(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmCreate)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE, "crm.createAccount", () => {
        const i = (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, CREATE_FIELDS);
        const { idempotencyKey, request } = (0, crmAuthorityKernel_js_1.splitIdempotentInput)(i);
        const owner = requireOwnerEmployeeId(i.ownerEmployeeId);
        if (i.name === undefined)
            (0, crmAuthorityKernel_js_1.fail)("NAME_REQUIRED", "INVALID_INPUT", "an Account requires a name");
        if (i.status === undefined)
            (0, crmAuthorityKernel_js_1.fail)("STATUS_INVALID", "INVALID_INPUT", `status is required: one of ${customerIdentity_js_1.CRM_ACCOUNT_STATUSES.join(", ")}`);
        const fields = accountFields(i);
        const paymentTerms = (fields.columns.get("payment_terms") ?? null);
        const taxStatus = (fields.columns.get("tax_status") ?? null);
        if (!(0, accountVocabulary_js_1.isUngovernedPaymentTerms)(paymentTerms) || !(0, accountVocabulary_js_1.isUngovernedTaxStatus)(taxStatus))
            requireGovernedFieldCapability(actor);
        return { idempotencyKey, request, owner, fields };
    }, async (db, { tenantId, principalId }, { owner, fields }) => {
        const ownerEmployeeId = await requireOwnerEmployee(db, tenantId, owner);
        const accountId = `acct_${(0, node_crypto_1.randomUUID)()}`;
        const extra = [...fields.columns.entries()].filter(([column]) => column !== "name" && column !== "status");
        const extraColumns = extra.map(([column]) => ", " + column).join("");
        const extraParams = extra.map((_, n) => ", $" + (7 + n)).join("");
        await db.query(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by${extraColumns})
         VALUES ($1, $2, $3, $4, $5, $6, $6${extraParams})`, [accountId, tenantId, fields.columns.get("name"), fields.columns.get("status"), ownerEmployeeId, principalId, ...extra.map(([, v]) => v)]);
        await replaceChildren(db, tenantId, accountId, fields, false);
        return { result: await selectAccount(db, tenantId, accountId), targetType: "ACCOUNT", targetId: accountId };
    });
}
function updateAccount(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmCommand)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_UPDATE, () => {
        const i = (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, UPDATE_FIELDS);
        const fields = accountFields(i);
        // `ownerEmployeeId: null` is named, and refuses: clearing the owner is never an update.
        const owner = i.ownerEmployeeId === undefined ? null : requireOwnerEmployeeId(i.ownerEmployeeId);
        if (i.ownershipHandoff !== undefined && owner === null) {
            (0, crmAuthorityKernel_js_1.fail)("OWNERSHIP_HANDOFF_WITHOUT_OWNER_CHANGE", "INVALID_INPUT", "ownershipHandoff describes an owner change; name ownerEmployeeId");
        }
        const terms = ownershipTerms(i.ownershipHandoff);
        // OPTIMISTIC OWNER PRECONDITION: the owner the caller last read (null = it read the Account as ownerless). When
        // named, the change applies only if the locked current owner still matches, so a form opened before someone
        // else's assignment or handoff can never silently turn an intended first assignment into a handoff (or back).
        const expectsOwner = Object.prototype.hasOwnProperty.call(i, "expectedCurrentOwnerEmployeeId");
        if (expectsOwner && owner === null) {
            (0, crmAuthorityKernel_js_1.fail)("OWNER_PRECONDITION_WITHOUT_OWNER_CHANGE", "INVALID_INPUT", "expectedCurrentOwnerEmployeeId applies only to an owner change; name ownerEmployeeId");
        }
        const expectedOwner = !expectsOwner || i.expectedCurrentOwnerEmployeeId === null ? null : requireOwnerEmployeeId(i.expectedCurrentOwnerEmployeeId);
        if (fields.columns.size === 0 && SET_FIELDS.every((f) => i[f] === undefined) && owner === null) {
            (0, crmAuthorityKernel_js_1.fail)("NO_CHANGES_REQUESTED", "INVALID_INPUT", "an update must name at least one accepted field");
        }
        return { accountId: (0, crmAuthorityKernel_js_1.requireRecordId)(i.accountId, "accountId"), fields, owner, terms, expectsOwner, expectedOwner };
    }, async (db, principal, { accountId, fields, owner, terms, expectsOwner, expectedOwner }) => {
        const { tenantId, principalId } = principal;
        const current = await db.query(`SELECT payment_terms, tax_status, owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, accountId]);
        if (current.rows.length === 0)
            (0, crmAuthorityKernel_js_1.fail)("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
        // accountGovernedFieldsUnchanged: naming a governed field with its CURRENT value is not a governed write.
        for (const column of ["payment_terms", "tax_status"]) {
            if (fields.columns.has(column) && fields.columns.get(column) !== current.rows[0][column])
                requireGovernedFieldCapability(principal);
        }
        if (owner !== null) {
            const previous = current.rows[0].owner_employee_id;
            if (expectsOwner && previous !== expectedOwner) {
                (0, crmAuthorityKernel_js_1.fail)("ACCOUNT_OWNER_CHANGED_SINCE_READ", "PRECONDITION_FAILED", "the Account's owner changed since it was read; re-read the Account and decide again");
            }
            if (previous === null && terms.sourceNamed) {
                (0, crmAuthorityKernel_js_1.fail)("INITIAL_OWNER_ASSIGNMENT_SOURCE_NOT_ALLOWED", "INVALID_INPUT", "this Account has no owner: its first owner is an INITIAL_OWNER_ASSIGNMENT, not a handoff, and takes no handoff source");
            }
            if (owner === previous) {
                if (terms.named)
                    (0, crmAuthorityKernel_js_1.fail)("OWNERSHIP_HANDOFF_WITHOUT_OWNER_CHANGE", "INVALID_INPUT", "the Account is already owned by that Employee; there is no ownership change to record");
            }
            else {
                const newOwner = await requireOwnerEmployee(db, tenantId, owner);
                await stageAccountOwnershipChange(db, tenantId, principalId, accountId, previous, newOwner, terms);
            }
        }
        const set = (0, crmAuthorityKernel_js_1.assignmentsOf)(fields.columns, Object.fromEntries([...fields.columns.keys()].map((c) => [c, c])), 4);
        const assignments = set.sql === "" ? "" : set.sql + ", ";
        await db.query(`UPDATE eos_crm.accounts SET ${assignments}updated_by = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId, principalId, ...set.values]);
        await replaceChildren(db, tenantId, accountId, fields, true);
        return selectAccount(db, tenantId, accountId);
    });
}
// ════════════════════ reads ════════════════════
function getAccount(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmRead)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_READ, () => ({ accountId: (0, crmAuthorityKernel_js_1.requireRecordId)((0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["accountId"]).accountId, "accountId") }), (db, tenantId, { accountId }) => selectAccount(db, tenantId, accountId));
}
const MAX_NAME_PREFIX = 200;
function listAccounts(deps, actor, input = {}) {
    return (0, crmAuthorityKernel_js_1.runCrmRead)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_READ, () => {
        const i = (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["limit", "cursor", "status", "nameStartsWith"]);
        let statuses = null;
        if (i.status !== undefined) {
            const values = typeof i.status === "string" ? [i.status] : i.status;
            if (!Array.isArray(values) || values.length === 0 || values.length > customerIdentity_js_1.CRM_ACCOUNT_STATUSES.length || !values.every(customerIdentity_js_1.isCrmAccountStatus)) {
                (0, crmAuthorityKernel_js_1.fail)("FILTER_INVALID", "INVALID_INPUT", `status must be one of, or a non-empty array of, ${customerIdentity_js_1.CRM_ACCOUNT_STATUSES.join(", ")}`);
            }
            statuses = [...new Set(values)];
        }
        let prefix = null;
        if (i.nameStartsWith !== undefined) {
            if (typeof i.nameStartsWith !== "string" || i.nameStartsWith.trim() === "" || i.nameStartsWith.length > MAX_NAME_PREFIX) {
                (0, crmAuthorityKernel_js_1.fail)("FILTER_INVALID", "INVALID_INPUT", `nameStartsWith must be a non-empty string of at most ${MAX_NAME_PREFIX} characters`);
            }
            // The SAME fold as eos_crm's `lower(btrim(name))` index and customerIdentity.foldCustomerName.
            prefix = i.nameStartsWith.trim().toLowerCase();
        }
        return { limit: (0, crmAuthorityKernel_js_1.requirePageSize)(i.limit), cursor: (0, crmAuthorityKernel_js_1.decodeCrmCursor)("account", i.cursor), statuses, prefix };
    }, async (db, tenantId, { limit, cursor, statuses, prefix }) => {
        const { rows } = await db.query(`SELECT ${COLUMNS}, lower(btrim(a.name)) AS folded_name
           FROM eos_crm.accounts a
          WHERE a.tenant_id = $1
            AND ($2::text[] IS NULL OR a.status::text = ANY($2::text[]))
            AND ($3::text IS NULL OR left(lower(btrim(a.name)), char_length($3::text)) = $3::text)
            AND ($4::text IS NULL OR (lower(btrim(a.name)), a.id) > ($4::text, $5::text))
          ORDER BY lower(btrim(a.name)), a.id
          LIMIT $6`, [tenantId, statuses, prefix, cursor?.name ?? null, cursor?.id ?? null, limit + 1]);
        return (0, crmAuthorityKernel_js_1.pageOf)("account", rows, limit, project);
    });
}
const HISTORY_CURSOR_FAMILY = "accountOwnershipHistory";
const HISTORY_POSITION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
function listAccountOwnershipHistory(deps, actor, input) {
    return (0, crmAuthorityKernel_js_1.runCrmRead)(deps, actor, crmAuthorityKernel_js_1.CRM_CAPABILITIES.CUSTOMER_RECORD_READ, () => {
        const i = (0, crmAuthorityKernel_js_1.requireAllowlistedInput)(input, ["accountId", "limit", "cursor"]);
        const cursor = (0, crmAuthorityKernel_js_1.decodeCrmCursor)(HISTORY_CURSOR_FAMILY, i.cursor);
        if (cursor && !HISTORY_POSITION.test(cursor.name))
            (0, crmAuthorityKernel_js_1.fail)("CURSOR_INVALID", "INVALID_INPUT", "cursor is not a valid position for this list");
        return { accountId: (0, crmAuthorityKernel_js_1.requireRecordId)(i.accountId, "accountId"), limit: (0, crmAuthorityKernel_js_1.requirePageSize)(i.limit), cursor };
    }, async (db, tenantId, { accountId, limit, cursor }) => {
        await (0, crmAuthorityKernel_js_1.requireTenantAccount)(db, tenantId, accountId);
        const { rows } = await db.query(`SELECT id, account_id, event, previous_owner_employee_id, new_owner_employee_id, source, reason, changed_by, effective_at, created_at,
                to_char(effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS folded_name
           FROM eos_crm.account_ownership_history
          WHERE tenant_id = $1 AND account_id = $2
            AND ($3::timestamptz IS NULL OR (effective_at, id) < ($3::timestamptz, $4::text))
          ORDER BY effective_at DESC, id DESC
          LIMIT $5`, [tenantId, accountId, cursor?.name ?? null, cursor?.id ?? null, limit + 1]);
        return (0, crmAuthorityKernel_js_1.pageOf)(HISTORY_CURSOR_FAMILY, rows, limit, (row) => ({
            historyId: row.id,
            accountId: row.account_id,
            event: row.event,
            previousOwnerEmployeeId: row.previous_owner_employee_id,
            newOwnerEmployeeId: row.new_owner_employee_id,
            source: row.source,
            reason: row.reason,
            changedBy: row.changed_by,
            effectiveAt: (0, crmAuthorityKernel_js_1.isoOf)(row.effective_at),
            createdAt: (0, crmAuthorityKernel_js_1.isoOf)(row.created_at),
        }));
    });
}
//# sourceMappingURL=accountAuthority.js.map