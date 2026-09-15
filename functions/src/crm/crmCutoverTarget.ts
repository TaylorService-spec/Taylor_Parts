// CRM CUTOVER -- the READ-ONLY PostgreSQL facts the census needs (functions/scripts/crmCutover.js --mode census).
//
// Every query is tenant-predicated and runs inside the caller's READ ONLY transaction. Nothing here writes, and no
// Firebase module is loaded (crmCutover.test.mjs). A relation that does not exist is reported as ABSENT, never as zero:
// "we did not look" and "we looked and found nothing" stay distinguishable.
import type { PoolClient } from "pg";
import { EMPLOYMENT_STATUS_VALUES } from "../employeeIdentity/employeeAuthority.js";
import type { CrmTargetFacts } from "./crmCutoverSnapshot.js";

type Db = Pick<PoolClient, "query">;

/** Tables whose rows name an Account by `account_id` (the Commercial C6 dependency and its finance tail). */
export const ACCOUNT_REFERENCING_TABLES = Object.freeze([
  "eos_commercial.opportunities",
  "eos_commercial.sales_agreements",
  "eos_commercial.sales_orders",
  "eos_finance.invoices",
  "eos_finance.payments",
  "eos_ops.equipment",
] as const);

/** The D1-A (#1912) Account business-fact schema the copy writes into. */
export const CRM_BUSINESS_FACT_RELATIONS = Object.freeze([
  "eos_crm.account_tags",
  "eos_crm.account_relationship_types",
  "eos_crm.account_lines_of_business",
  "eos_crm.command_receipts",
] as const);

export async function relationExists(db: Db, qualified: string): Promise<boolean> {
  const { rows } = await db.query("SELECT to_regclass($1) IS NOT NULL AS present", [qualified]);
  return rows[0].present === true;
}

export async function crmBusinessFactSchemaPresent(db: Db): Promise<boolean> {
  for (const r of CRM_BUSINESS_FACT_RELATIONS) if (!(await relationExists(db, r))) return false;
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'eos_crm' AND table_name = 'accounts'
        AND column_name IN ('billing_address_street', 'payment_terms', 'tax_status', 'billing_contact_id')`,
  );
  return rows[0].n === 4;
}

export interface CrmTargetMeasurement {
  readonly facts: CrmTargetFacts;
  readonly report: {
    readonly relationsAbsent: readonly string[];
    readonly accountReferencingTablesChecked: readonly string[];
    readonly existing: { readonly accounts: number | null; readonly contacts: number | null; readonly locations: number | null };
    readonly ownerReferencesChecked: number;
    readonly ownerReferencesResolved: number;
    readonly businessFactSchemaPresent: boolean;
  };
}

/** Gather the target facts for one tenant. `ownerIds` are the distinct Employee ids the snapshot names. */
export async function measureCrmTarget(db: Db, tenantId: string, ownerIds: readonly string[]): Promise<CrmTargetMeasurement> {
  const absent: string[] = [];

  let resolvable = new Set<string>();
  if (await relationExists(db, "eos_workforce.employees")) {
    const { rows } = await db.query(
      `SELECT id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[]) AND employment_status = ANY($3::text[])`,
      [tenantId, [...ownerIds], [...EMPLOYMENT_STATUS_VALUES]],
    );
    resolvable = new Set(rows.map((r: { id: string }) => r.id));
  } else absent.push("eos_workforce.employees");

  const existing: { accounts: number | null; contacts: number | null; locations: number | null } = { accounts: null, contacts: null, locations: null };
  let existingAccountIds = new Set<string>();
  if (await relationExists(db, "eos_crm.accounts")) {
    const { rows } = await db.query("SELECT id FROM eos_crm.accounts WHERE tenant_id = $1", [tenantId]);
    existingAccountIds = new Set(rows.map((r: { id: string }) => r.id));
    existing.accounts = rows.length;
    existing.contacts = (await db.query("SELECT count(*)::int AS n FROM eos_crm.contacts WHERE tenant_id = $1", [tenantId])).rows[0].n;
    existing.locations = (await db.query("SELECT count(*)::int AS n FROM eos_crm.account_locations WHERE tenant_id = $1", [tenantId])).rows[0].n;
  } else absent.push("eos_crm.accounts");

  const checked: string[] = [];
  const commercialAccountIds: { table: string; accountId: string }[] = [];
  for (const table of ACCOUNT_REFERENCING_TABLES) {
    if (!(await relationExists(db, table))) { absent.push(table); continue; }
    checked.push(table);
    // `table` comes only from the frozen list above.
    const { rows } = await db.query(`SELECT DISTINCT account_id FROM ${table} WHERE tenant_id = $1 ORDER BY account_id`, [tenantId]);
    for (const r of rows as { account_id: string }[]) commercialAccountIds.push({ table, accountId: r.account_id });
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
