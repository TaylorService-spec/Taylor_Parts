// THE OPERATIONAL KEY -> GOVERNED BUSINESS COMPANY BINDING, read inside a transaction.
//
// An operating company KEY is what operational rows carry (`operating_company_key` on warehouses,
// purchase orders, receipts, movements). An operating company ID is the governed business company
// the tenant is authorized to operate as. They are DIFFERENT VOCABULARIES with different shapes, and
// nothing in this repository may assume they are equal by string comparison -- the binding between
// them is a governed record in eos_policy, and reading it is the only way to cross from one to the
// other.
//
// Both sides must be ACTIVE: the binding itself, and the company it names. An INACTIVE binding is a
// key that no longer names its company; an INACTIVE company is one the tenant may no longer operate
// as. Either way the answer is a refusal, never a guess.
//
// This exists because the acquisition-cost fact must FREEZE the company id at receipt time (Owner
// Ruling R3), and because it is read in the same transaction as the write that depends on it, so a
// concurrent rebinding cannot be committed between the check and the fact.

import type { PoolClient } from "pg";

export class OperatingCompanyBindingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "OperatingCompanyBindingError";
  }
}

/**
 * Resolve the ACTIVE governed operating company id bound to one operational key.
 *
 * FAILS CLOSED on missing, inactive or unbound. There is deliberately no fallback: not the
 * warehouse's company, not the actor's, not the key itself reinterpreted as an id. An acquisition
 * cost that cannot say whose acquisition it was is not evidence, and an inferred owner is the single
 * most plausible-looking way to get that wrong.
 */
export async function resolveActiveOperatingCompanyId(
  client: PoolClient,
  tenantId: string,
  operatingCompanyKey: unknown,
): Promise<string> {
  if (typeof operatingCompanyKey !== "string" || operatingCompanyKey.trim() === "") {
    throw new OperatingCompanyBindingError(
      "OPERATING_COMPANY_KEY_REQUIRED",
      "an operating company key is required to resolve the governed company that owns this fact",
    );
  }
  const { rows } = await client.query(
    `SELECT b.operating_company_id
       FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies c
         ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.operating_company_key = $2
        AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'`,
    [tenantId, operatingCompanyKey],
  );
  // `tenant_operating_company_key_unique` makes more than one row impossible; the check is kept
  // because "exactly one" is the property this function promises, and a schema change that widened
  // the key would otherwise turn ambiguity into an arbitrary pick.
  if (rows.length !== 1) {
    throw new OperatingCompanyBindingError(
      "OPERATING_COMPANY_NOT_GOVERNED",
      `operating company key "${operatingCompanyKey}" is not bound to exactly one ACTIVE operating company this tenant is authorized to operate as`,
    );
  }
  return rows[0].operating_company_id as string;
}

/**
 * THE SYMMETRIC RESOLVER: tenant + operating company id -> the eos_ops partition key.
 *
 * The reverse of resolveActiveOperatingCompanyId above, and it exists so that no domain writes its own.
 * A private Work Order resolver would be a second answer to "which partition does this company use", and
 * Reorder, Work Order and everything after them must reach the same one.
 *
 * ════════════════════ NO EQUALITY INFERENCE, EVER ════════════════════
 *
 * `taylor` happens to bind to key `taylor` in nonprod today, and that is a coincidence of authoring. The
 * Sample Company fixture is the counter-example that keeps it honest -- company `taylor`, key
 * `sample-co-synthetic` -- and a resolver that fell back to the company id when no row existed would
 * invent a partition for every company nobody has keyed yet. It returns nothing instead.
 *
 * BOTH GATES, NOT ONE. The company must be ACTIVE for the tenant (it may operate as it at all) AND the
 * key binding must be ACTIVE (its partition is established). Authorizing a company and keying it are two
 * decisions, and Ventana is deliberately in between: authorized, unkeyed, and therefore fail-closed.
 */
export async function resolveOperatingCompanyKeyForCompany(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  operatingCompanyId: string,
): Promise<string> {
  if (typeof tenantId !== "string" || tenantId.trim() === "" ||
      typeof operatingCompanyId !== "string" || operatingCompanyId.trim() === "") {
    throw new OperatingCompanyBindingError(
      "OPERATING_COMPANY_BINDING_INPUT_INVALID",
      "a key is only resolvable for a stated company within a stated tenant",
    );
  }
  const { rows } = await db.query(
    `SELECT b.operating_company_key
       FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies c
         ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.operating_company_id = $2
        AND b.status = 'ACTIVE' AND c.status = 'ACTIVE'`,
    [tenantId, operatingCompanyId],
  );
  if (rows.length === 0) {
    throw new OperatingCompanyBindingError(
      "OPERATING_COMPANY_KEY_NOT_BOUND",
      `no ACTIVE key binding exists for company '${operatingCompanyId}' in this tenant. A company may be `
      + "authorized without being keyed; nothing is inferred from the company id.",
    );
  }
  if (rows.length > 1) {
    throw new OperatingCompanyBindingError(
      "OPERATING_COMPANY_KEY_AMBIGUOUS",
      `company '${operatingCompanyId}' resolves to more than one ACTIVE key binding`,
    );
  }
  return String(rows[0].operating_company_key);
}
