"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRM_BUSINESS_FACT_RELATIONS = exports.ACCOUNT_REFERENCING_TABLES = void 0;
exports.relationExists = relationExists;
exports.crmBusinessFactSchemaPresent = crmBusinessFactSchemaPresent;
exports.measureCrmTarget = measureCrmTarget;
const employeeAuthority_js_1 = require("../employeeIdentity/employeeAuthority.js");
/** Tables whose rows name an Account by `account_id` (the Commercial C6 dependency and its finance tail). */
exports.ACCOUNT_REFERENCING_TABLES = Object.freeze([
    "eos_commercial.opportunities",
    "eos_commercial.sales_agreements",
    "eos_commercial.sales_orders",
    "eos_finance.invoices",
    "eos_finance.payments",
    "eos_ops.equipment",
]);
/** The D1-A (#1912) Account business-fact schema the copy writes into. */
exports.CRM_BUSINESS_FACT_RELATIONS = Object.freeze([
    "eos_crm.account_tags",
    "eos_crm.account_relationship_types",
    "eos_crm.account_lines_of_business",
    "eos_crm.command_receipts",
]);
async function relationExists(db, qualified) {
    const { rows } = await db.query("SELECT to_regclass($1) IS NOT NULL AS present", [qualified]);
    return rows[0].present === true;
}
async function crmBusinessFactSchemaPresent(db) {
    for (const r of exports.CRM_BUSINESS_FACT_RELATIONS)
        if (!(await relationExists(db, r)))
            return false;
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'eos_crm' AND table_name = 'accounts'
        AND column_name IN ('billing_address_street', 'payment_terms', 'tax_status', 'billing_contact_id')`);
    return rows[0].n === 4;
}
/** Gather the target facts for one tenant. `ownerIds` are the distinct Employee ids the snapshot names. */
async function measureCrmTarget(db, tenantId, ownerIds) {
    const absent = [];
    let resolvable = new Set();
    if (await relationExists(db, "eos_workforce.employees")) {
        const { rows } = await db.query(`SELECT id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[]) AND employment_status::text = ANY($3::text[])`, [tenantId, [...ownerIds], [...employeeAuthority_js_1.EMPLOYMENT_STATUS_VALUES]]);
        resolvable = new Set(rows.map((r) => r.id));
    }
    else
        absent.push("eos_workforce.employees");
    const existing = { accounts: null, contacts: null, locations: null };
    let existingAccountIds = new Set();
    if (await relationExists(db, "eos_crm.accounts")) {
        const { rows } = await db.query("SELECT id FROM eos_crm.accounts WHERE tenant_id = $1", [tenantId]);
        existingAccountIds = new Set(rows.map((r) => r.id));
        existing.accounts = rows.length;
        existing.contacts = (await db.query("SELECT count(*)::int AS n FROM eos_crm.contacts WHERE tenant_id = $1", [tenantId])).rows[0].n;
        existing.locations = (await db.query("SELECT count(*)::int AS n FROM eos_crm.account_locations WHERE tenant_id = $1", [tenantId])).rows[0].n;
    }
    else
        absent.push("eos_crm.accounts");
    const checked = [];
    const commercialAccountIds = [];
    for (const table of exports.ACCOUNT_REFERENCING_TABLES) {
        if (!(await relationExists(db, table))) {
            absent.push(table);
            continue;
        }
        checked.push(table);
        // `table` comes only from the frozen list above.
        const { rows } = await db.query(`SELECT DISTINCT account_id FROM ${table} WHERE tenant_id = $1 ORDER BY account_id`, [tenantId]);
        for (const r of rows)
            commercialAccountIds.push({ table, accountId: r.account_id });
    }
    return {
        facts: { resolvableEmployeeIds: resolvable, commercialAccountIds, existingAccountIds },
        report: {
            relationsAbsent: absent,
            accountReferencingTablesChecked: checked,
            existing,
            ownerReferencesChecked: ownerIds.length,
            ownerReferencesResolved: resolvable.size,
            businessFactSchemaPresent: await crmBusinessFactSchemaPresent(db),
        },
    };
}
//# sourceMappingURL=crmCutoverTarget.js.map