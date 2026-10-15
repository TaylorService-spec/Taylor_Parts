"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNTABLE_RECORD_FAMILIES = exports.EMPLOYEE_RECORD_FAMILIES = void 0;
exports.listRecordsOwnedByEmployee = listRecordsOwnedByEmployee;
exports.listAccountabilitiesForEmployee = listAccountabilitiesForEmployee;
// EMP-RT-03 listRecordsOwnedByEmployee and EMP-RT-04 listAccountabilitiesForEmployee.
//
// RECORD OWNER != ACCOUNTABLE PERSON != ASSIGNED PERSON. Two reads, two columns, never merged:
//
//   RECORD_OWNER        <family>.owner_employee_id        (Commercial: migration 016, ownership_handoffs is its
//                                                          history; CRM: migration 015)
//   ACCOUNTABLE_PERSON  <family>.accountable_employee_id  (Commercial only: migration 020; accountability_handoffs is
//                                                          its history, action ESTABLISHMENT/HANDOFF + source from 021)
//
// A record owned by A and accountable to B is listed under A's ownership and B's accountability, and under nothing
// else. Neither read falls back to the other column, and neither reads credited_salesperson_employee_id. ASSIGNED
// PERSON is not here at all: no PostgreSQL column assigns work to an Employee (ASSIGNMENT_AUTHORITY_NOT_IN_POSTGRES).
//
// FAMILIES AND CAPABILITIES. One family per call, required, each gated by that family's EXISTING read capability --
// the same capability that already lets the holder read every record of the family (and its owner) through its own
// governed reader. These reads therefore reveal nothing that capability does not.
//
//   OPPORTUNITY       eos_commercial.opportunities     opportunity.read      owner + accountable
//   SALES_AGREEMENT   eos_commercial.sales_agreements  salesAgreement.read   owner + accountable
//   SALES_ORDER       eos_commercial.sales_orders      salesOrder.read       owner + accountable
//   ACCOUNT           eos_crm.accounts                 customer.record.read  owner ONLY (Owner ruling G)
//   CONTACT           eos_crm.contacts                 customer.record.read  owner ONLY
//   ACCOUNT_LOCATION  eos_crm.account_locations        customer.record.read  owner ONLY
//
// CRM has NO accountability column, and none is inferred: listAccountabilitiesForEmployee refuses a CRM family with
// FAMILY_INVALID rather than answering "empty" -- an empty answer would claim the axis exists there. customer.record.read
// is registered PostgreSQL vocabulary since migration 024 (1759622400000).
//
// The Employee must exist in the actor's tenant (any lifecycle status): a foreign-tenant or unknown id is
// EMPLOYEE_NOT_FOUND. Commercial identity-only spine rows (no lifecycle) are not business records and are excluded,
// exactly as the Commercial list reads exclude them. Ordering is bounded and keyset-paginated: Commercial by
// (business number DESC, id DESC); CRM by (folded name ASC, id ASC), the CRM readers' own ordering.
const employeeReadKernel_1 = require("./employeeReadKernel");
const commercial = (table, number, state, complete, capability, handoffKey) => Object.freeze({
    table, sortKey: `r.${number}`, direction: "DESC", numberExpr: `r.${number}`, nameExpr: "NULL::text", stateExpr: `r.${state}::text`,
    accountExpr: "r.account_id", companyExpr: "r.operating_company_key", complete, capability, handoffKey,
});
const crm = (table, stateExpr, numberExpr, accountExpr) => Object.freeze({
    table, sortKey: "lower(btrim(r.name))", direction: "ASC", numberExpr, nameExpr: "r.name", stateExpr, accountExpr,
    companyExpr: "NULL::text", complete: "TRUE", capability: "customer.record.read", handoffKey: null,
});
/** Closed. Table and column names come ONLY from here, never from caller input. */
const FAMILIES = Object.freeze({
    OPPORTUNITY: commercial("eos_commercial.opportunities", "opportunity_number", "stage", "r.stage IS NOT NULL AND r.sales_channel IS NOT NULL", "opportunity.read", "opportunity_id"),
    SALES_AGREEMENT: commercial("eos_commercial.sales_agreements", "sales_agreement_number", "state", "r.state IS NOT NULL AND r.currency IS NOT NULL", "salesAgreement.read", "sales_agreement_id"),
    SALES_ORDER: commercial("eos_commercial.sales_orders", "sales_order_number", "state", "r.state IS NOT NULL AND r.sales_channel IS NOT NULL AND r.currency IS NOT NULL AND r.booked_at IS NOT NULL", "salesOrder.read", "sales_order_id"),
    ACCOUNT: crm("eos_crm.accounts", "r.status::text", "r.customer_number", "r.id"),
    CONTACT: crm("eos_crm.contacts", "NULL::text", "NULL::text", "r.account_id"),
    ACCOUNT_LOCATION: crm("eos_crm.account_locations", "NULL::text", "NULL::text", "r.account_id"),
});
exports.EMPLOYEE_RECORD_FAMILIES = Object.freeze(Object.keys(FAMILIES));
/** Families that carry an ACCOUNTABLE_PERSON column. */
exports.ACCOUNTABLE_RECORD_FAMILIES = Object.freeze(exports.EMPLOYEE_RECORD_FAMILIES.filter((f) => FAMILIES[f].handoffKey !== null));
const AXIS_COLUMN = Object.freeze({ RECORD_OWNER: "owner_employee_id", ACCOUNTABLE_PERSON: "accountable_employee_id" });
const LIST_FIELDS = Object.freeze(["employeeId", "family", "limit", "cursor"]);
function prepare(axis, input) {
    (0, employeeReadKernel_1.acceptOnly)(input, LIST_FIELDS);
    const employeeId = (0, employeeReadKernel_1.requireEmployeeId)(input?.employeeId);
    const allowed = axis === "ACCOUNTABLE_PERSON" ? exports.ACCOUNTABLE_RECORD_FAMILIES : exports.EMPLOYEE_RECORD_FAMILIES;
    const family = input?.family;
    if (typeof family !== "string" || !allowed.includes(family)) {
        (0, employeeReadKernel_1.refuse)("FAMILY_INVALID", "INVALID_INPUT", `family must be one of ${allowed.join(", ")}`);
    }
    const scope = `${axis}:${family}:${employeeId}`;
    return { employeeId, family: family, limit: (0, employeeReadKernel_1.requirePageSize)(input?.limit), cursor: (0, employeeReadKernel_1.decodeEmployeeCursor)(scope, input?.cursor), scope };
}
async function listForAxis(deps, actor, axis, input) {
    return (0, employeeReadKernel_1.runEmployeeRead)(deps, actor, () => prepare(axis, input), (p) => [FAMILIES[p.family].capability], async (db, tenantId, _principalId, p) => {
        const exists = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, p.employeeId]);
        if (exists.rows.length === 0)
            (0, employeeReadKernel_1.refuse)("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
        const f = FAMILIES[p.family];
        const personColumn = AXIS_COLUMN[axis];
        const accountable = axis === "ACCOUNTABLE_PERSON" && f.handoffKey !== null;
        const accountability = accountable
            ? `, h.action AS accountability_action, h.source::text AS accountability_source, h.effective_at AS accountability_effective_at`
            : "";
        const accountabilityJoin = accountable
            ? `LEFT JOIN LATERAL (
             SELECT ah.action, ah.source, ah.effective_at FROM eos_commercial.accountability_handoffs ah
              WHERE ah.tenant_id = r.tenant_id AND ah.${f.handoffKey} = r.id AND ah.new_accountable_employee_id = r.accountable_employee_id
              ORDER BY ah.effective_at DESC, ah.recorded_at DESC, ah.id DESC LIMIT 1) h ON true`
            : "";
        const after = f.direction === "DESC" ? "<" : ">";
        const { rows } = await db.query(`SELECT r.id, ${f.sortKey} AS sort_key, ${f.numberExpr} AS record_number, ${f.nameExpr} AS record_name, ${f.stateExpr} AS state,
                ${f.accountExpr} AS account_id, ${f.companyExpr} AS operating_company_key, r.updated_at${accountability}
           FROM ${f.table} r
           ${accountabilityJoin}
          WHERE r.tenant_id = $1 AND r.${personColumn} = $2 AND ${f.complete}
            AND ($3::text IS NULL OR (${f.sortKey}, r.id) ${after} ($3::text, $4::text))
          ORDER BY ${f.sortKey} ${f.direction}, r.id ${f.direction}
          LIMIT $5`, [tenantId, p.employeeId, p.cursor?.number ?? null, p.cursor?.id ?? null, p.limit + 1]);
        const truncated = rows.length > p.limit;
        const kept = rows.slice(0, p.limit);
        const items = kept.map((r) => {
            const base = {
                family: p.family, recordId: r.id, recordNumber: r.record_number ?? null, name: r.record_name ?? null, state: r.state ?? null,
                accountId: r.account_id, operatingCompanyId: r.operating_company_key ?? null, updatedAt: (0, employeeReadKernel_1.isoOf)(r.updated_at),
            };
            if (!accountable)
                return base;
            return {
                ...base,
                currentAccountability: r.accountability_action == null ? null
                    : { action: r.accountability_action, source: r.accountability_source ?? null, effectiveAt: (0, employeeReadKernel_1.isoOf)(r.accountability_effective_at) },
            };
        });
        const last = kept[kept.length - 1];
        return {
            employeeId: p.employeeId, family: p.family, axis, items, truncated,
            nextCursor: truncated && last ? (0, employeeReadKernel_1.encodeEmployeeCursor)(p.scope, { number: last.sort_key, id: last.id }) : null,
        };
    });
}
/** EMP-RT-03: records whose RECORD OWNER is this Employee, one family, bounded. */
function listRecordsOwnedByEmployee(deps, actor, input) {
    return listForAxis(deps, actor, "RECORD_OWNER", input);
}
/** EMP-RT-04: records whose CURRENT ACCOUNTABLE PERSON is this Employee, one Commercial family, bounded. */
function listAccountabilitiesForEmployee(deps, actor, input) {
    return listForAxis(deps, actor, "ACCOUNTABLE_PERSON", input);
}
//# sourceMappingURL=employeeResponsibilityReads.js.map