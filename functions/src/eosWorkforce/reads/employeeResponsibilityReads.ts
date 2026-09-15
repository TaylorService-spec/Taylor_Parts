// EMP-RT-03 listRecordsOwnedByEmployee and EMP-RT-04 listAccountabilitiesForEmployee.
//
// RECORD OWNER != ACCOUNTABLE PERSON != ASSIGNED PERSON. Two reads, two columns, never merged:
//
//   RECORD_OWNER        <family>.owner_employee_id        (migration 016; ownership_handoffs is its history)
//   ACCOUNTABLE_PERSON  <family>.accountable_employee_id  (migration 020; accountability_handoffs is its history,
//                                                          action ESTABLISHMENT/HANDOFF + source from migration 021)
//
// A record owned by A and accountable to B is listed under A's ownership and B's accountability, and under nothing
// else. Neither read falls back to the other column, and neither reads credited_salesperson_employee_id. ASSIGNED
// PERSON is not here at all: no PostgreSQL column assigns work to an Employee (ASSIGNMENT_AUTHORITY_NOT_IN_POSTGRES).
//
// FAMILIES AND CAPABILITIES. One family per call, required, each gated by that family's EXISTING read capability --
// the same capability that already lets the holder read every record of the family (and its owner and accountable
// person) through the Commercial transport. These reads therefore reveal nothing that capability does not.
//
//   OPPORTUNITY      eos_commercial.opportunities      opportunity.read
//   SALES_AGREEMENT  eos_commercial.sales_agreements   salesAgreement.read
//   SALES_ORDER      eos_commercial.sales_orders       salesOrder.read
//
// NOT SERVED: the CRM families (eos_crm.accounts / contacts / account_locations .owner_employee_id, migration 015).
// The columns exist, but no CRM read capability is registered in eos_policy.capabilities (customer.record.read exists
// only in access/permissionCatalog.ts), so no Principal can hold one in PostgreSQL. An unlisted family refuses
// FAMILY_INVALID; it is never silently empty.
//
// The Employee must exist in the actor's tenant (any lifecycle status): a foreign-tenant or unknown id is
// EMPLOYEE_NOT_FOUND. Identity-only spine rows (no lifecycle) are not business records and are excluded, exactly as the
// Commercial list reads exclude them. Ordering is (business number DESC, id DESC), bounded, keyset-paginated.
import {
  acceptOnly, decodeEmployeeCursor, encodeEmployeeCursor, isoOf, refuse, requireEmployeeId, requirePageSize, runEmployeeRead,
  type EmployeeCursor, type EmployeeReadActor, type EmployeeReadDeps,
} from "./employeeReadKernel";

interface FamilySpec {
  readonly table: string;
  readonly numberColumn: string;
  readonly stateColumn: string;
  readonly complete: string;
  readonly capability: string;
  readonly handoffKey: string;
}

/** Closed. Table and column names come ONLY from here, never from caller input. */
const FAMILIES = Object.freeze({
  OPPORTUNITY: Object.freeze({
    table: "eos_commercial.opportunities", numberColumn: "opportunity_number", stateColumn: "stage",
    complete: "r.stage IS NOT NULL AND r.sales_channel IS NOT NULL", capability: "opportunity.read", handoffKey: "opportunity_id",
  }),
  SALES_AGREEMENT: Object.freeze({
    table: "eos_commercial.sales_agreements", numberColumn: "sales_agreement_number", stateColumn: "state",
    complete: "r.state IS NOT NULL AND r.currency IS NOT NULL", capability: "salesAgreement.read", handoffKey: "sales_agreement_id",
  }),
  SALES_ORDER: Object.freeze({
    table: "eos_commercial.sales_orders", numberColumn: "sales_order_number", stateColumn: "state",
    complete: "r.state IS NOT NULL AND r.sales_channel IS NOT NULL AND r.currency IS NOT NULL AND r.booked_at IS NOT NULL",
    capability: "salesOrder.read", handoffKey: "sales_order_id",
  }),
} as const satisfies Record<string, FamilySpec>);

export type EmployeeRecordFamily = keyof typeof FAMILIES;
export const EMPLOYEE_RECORD_FAMILIES = Object.freeze(Object.keys(FAMILIES) as EmployeeRecordFamily[]);

type Axis = "RECORD_OWNER" | "ACCOUNTABLE_PERSON";
const AXIS_COLUMN: Readonly<Record<Axis, string>> = Object.freeze({ RECORD_OWNER: "owner_employee_id", ACCOUNTABLE_PERSON: "accountable_employee_id" });

export interface EmployeeRecordItem {
  readonly family: EmployeeRecordFamily;
  readonly recordId: string;
  readonly recordNumber: string;
  readonly state: string;
  readonly accountId: string;
  readonly operatingCompanyId: string | null;
  readonly updatedAt: string;
}

export interface AccountableRecordItem extends EmployeeRecordItem {
  /** The accountability_handoffs row that made this Employee accountable; null when none is recorded. */
  readonly currentAccountability: { readonly action: string; readonly source: string | null; readonly effectiveAt: string } | null;
}

export interface EmployeeRecordPage<Item> {
  readonly employeeId: string;
  readonly family: EmployeeRecordFamily;
  readonly axis: Axis;
  readonly items: Item[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

interface Prepared {
  readonly employeeId: string;
  readonly family: EmployeeRecordFamily;
  readonly limit: number;
  readonly cursor: EmployeeCursor | null;
  readonly scope: string;
}

const LIST_FIELDS = Object.freeze(["employeeId", "family", "limit", "cursor"]);

function prepare(axis: Axis, input: Record<string, unknown> | undefined): Prepared {
  acceptOnly(input, LIST_FIELDS);
  const employeeId = requireEmployeeId(input?.employeeId);
  const family = input?.family;
  if (typeof family !== "string" || !Object.prototype.hasOwnProperty.call(FAMILIES, family)) {
    refuse("FAMILY_INVALID", "INVALID_INPUT", `family must be one of ${EMPLOYEE_RECORD_FAMILIES.join(", ")}`);
  }
  const scope = `${axis}:${family}:${employeeId}`;
  return { employeeId, family: family as EmployeeRecordFamily, limit: requirePageSize(input?.limit), cursor: decodeEmployeeCursor(scope, input?.cursor), scope };
}

async function listForAxis<Item>(
  deps: EmployeeReadDeps, actor: EmployeeReadActor, axis: Axis, input: Record<string, unknown> | undefined,
): Promise<EmployeeRecordPage<Item>> {
  return runEmployeeRead(deps, actor, () => prepare(axis, input), (p) => [FAMILIES[p.family].capability],
    async (db, tenantId, _principalId, p) => {
      const exists = await db.query(`SELECT 1 FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, p.employeeId]);
      if (exists.rows.length === 0) refuse("EMPLOYEE_NOT_FOUND", "NOT_FOUND", "the Employee does not exist in this tenant");
      const f = FAMILIES[p.family];
      const personColumn = AXIS_COLUMN[axis];
      const accountability = axis === "ACCOUNTABLE_PERSON"
        ? `, h.action AS accountability_action, h.source::text AS accountability_source, h.effective_at AS accountability_effective_at`
        : "";
      const accountabilityJoin = axis === "ACCOUNTABLE_PERSON"
        ? `LEFT JOIN LATERAL (
             SELECT ah.action, ah.source, ah.effective_at FROM eos_commercial.accountability_handoffs ah
              WHERE ah.tenant_id = r.tenant_id AND ah.${f.handoffKey} = r.id AND ah.new_accountable_employee_id = r.accountable_employee_id
              ORDER BY ah.effective_at DESC, ah.recorded_at DESC, ah.id DESC LIMIT 1) h ON true`
        : "";
      const { rows } = await db.query(
        `SELECT r.id, r.${f.numberColumn} AS record_number, r.${f.stateColumn}::text AS state, r.account_id, r.operating_company_key, r.updated_at${accountability}
           FROM ${f.table} r
           ${accountabilityJoin}
          WHERE r.tenant_id = $1 AND r.${personColumn} = $2 AND ${f.complete}
            AND ($3::text IS NULL OR (r.${f.numberColumn}, r.id) < ($3::text, $4::text))
          ORDER BY r.${f.numberColumn} DESC, r.id DESC
          LIMIT $5`,
        [tenantId, p.employeeId, p.cursor?.number ?? null, p.cursor?.id ?? null, p.limit + 1],
      );
      const truncated = rows.length > p.limit;
      const kept = rows.slice(0, p.limit);
      const items = kept.map((r) => {
        const base: EmployeeRecordItem = {
          family: p.family, recordId: r.id, recordNumber: r.record_number, state: r.state, accountId: r.account_id,
          operatingCompanyId: r.operating_company_key ?? null, updatedAt: isoOf(r.updated_at)!,
        };
        if (axis !== "ACCOUNTABLE_PERSON") return base;
        return {
          ...base,
          currentAccountability: r.accountability_action == null ? null
            : { action: r.accountability_action, source: r.accountability_source ?? null, effectiveAt: isoOf(r.accountability_effective_at)! },
        };
      }) as unknown as Item[];
      const last = kept[kept.length - 1];
      return {
        employeeId: p.employeeId, family: p.family, axis, items, truncated,
        nextCursor: truncated && last ? encodeEmployeeCursor(p.scope, { number: last.record_number, id: last.id }) : null,
      };
    });
}

/** EMP-RT-03: records whose RECORD OWNER is this Employee, one family, bounded. */
export function listRecordsOwnedByEmployee(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<EmployeeRecordPage<EmployeeRecordItem>> {
  return listForAxis<EmployeeRecordItem>(deps, actor, "RECORD_OWNER", input);
}

/** EMP-RT-04: records whose CURRENT ACCOUNTABLE PERSON is this Employee, one family, bounded. */
export function listAccountabilitiesForEmployee(deps: EmployeeReadDeps, actor: EmployeeReadActor, input?: Record<string, unknown>): Promise<EmployeeRecordPage<AccountableRecordItem>> {
  return listForAxis<AccountableRecordItem>(deps, actor, "ACCOUNTABLE_PERSON", input);
}
