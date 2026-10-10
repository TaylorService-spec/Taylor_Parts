// FINANCE CONFIGURATION THROUGH ADMINISTRATION (Controller, 2026-10-02; DECISIONS #203). Served by /admin/policy as
// ADMIN_CONFIGURATION_OPERATIONS, every one gated on `finance.configuration.manage` (granted to nobody by the migration).
//
//   ACCOUNTING DESTINATIONS  view / configure / activate / deactivate each operating company's provider-neutral
//                            destination. One ACTIVE per company (database-enforced); Taylor and Ventana independent;
//                            CONSOLIDATED owns none; rows are never deleted (history). Activating attaches the company's
//                            untouched PENDING_DESTINATION handoffs (no attempt, by construction) -- a handoff with delivery
//                            history is never re-pointed. Deactivating changes no historical handoff.
//   PAYMENT TERMS            the company's per-counterparty profile: structured net days (and display text). Terms govern
//                            FUTURE obligations: an obligation's due date is stamped at establishment and is immutable.
//                            Each direction and each external supplier is its own profile -- nothing is mirrored.
//   (The operating-company business time zone moved to System Configuration -- Owner ruling #204: accounting destinations
//   and payment terms remain Finance configuration; company settings do not.)
//
// Every change is audited with its stated reason. No credential, no provider, no AP, no Firebase.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  configureAccountingDestination, ensureExternalCounterparty, ensureInternalCounterparty, FinanceFoundationError, resolveOperatingCompany,
  setCounterpartyCompanyProfile, type FinanceActor,
} from "./financeFoundation";
import { refreshAccountingHandoffs } from "./billingPackage";
import { ConfigurationRefusal, type AdminConfigurationOperation, type ConfigurationActor } from "../adminPolicy/configurationOperations";
import { withActorAuthority } from "../eosOps/administrationReach";

export const FINANCE_CONFIGURATION_OPERATIONS = Object.freeze([
  "listAccountingDestinations", "configureAccountingDestination", "setAccountingDestinationStatus",
  "listCounterpartyPaymentTerms", "setCounterpartyPaymentTerms",
] as const);
export const isFinanceConfigurationOperation = (op: string): boolean => (FINANCE_CONFIGURATION_OPERATIONS as readonly string[]).includes(op);

const CATEGORY: Record<string, "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN"> = {
  INVALID_INPUT: "INVALID_INPUT", NOT_FOUND: "NOT_FOUND", CONFLICT: "CONFLICT", PRECONDITION_FAILED: "CONFLICT",
};
const refuse = (code: string, category: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN", message: string): never => {
  throw new ConfigurationRefusal(code, category, message);
};
const only = (i: Record<string, unknown>, allowed: readonly string[]): void => {
  for (const k of Object.keys(i)) if (!allowed.includes(k)) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
};
const text = (v: unknown, name: string, max = 200): string => {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse("INVALID_INPUT", "INVALID_INPUT", `${name} is required`);
  return (v as string).trim();
};
const requireReason = (reason: string | null): string => {
  if (typeof reason !== "string" || reason.trim() === "") refuse("REASON_REQUIRED", "INVALID_INPUT", "a finance configuration change states its reason");
  return (reason as string).trim();
};

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
const audit = async (c: Pick<PoolClient, "query">, actor: ConfigurationActor, action: string, kind: string, id: string, before: unknown, after: unknown, reason: string) =>
  c.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,now(),$9)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, kind, id, before === null ? null : JSON.stringify(before), JSON.stringify(await withActorAuthority(c, actor.tenantId, actor.principalId, after)), reason]);

const destinationView = (r: Record<string, any>) => Object.freeze({
  id: String(r.id), operatingCompanyId: String(r.operating_company_id), displayName: String(r.display_name), providerKey: r.provider_key ?? null,
  externalCompanyRef: r.external_company_ref ?? null, status: String(r.status), updatedBy: String(r.updated_by), updatedAt: new Date(r.updated_at).toISOString(),
});

async function listAccountingDestinations(pool: Pool, actor: ConfigurationActor, i: Record<string, unknown>) {
  only(i, ["operatingCompanyId"]);
  const { rows } = await pool.query(
    `SELECT * FROM eos_finance.accounting_destinations WHERE tenant_id = $1 AND ($2::text IS NULL OR operating_company_id = $2)
      ORDER BY operating_company_id, (status = 'ACTIVE') DESC, updated_at DESC, id`, [actor.tenantId, typeof i.operatingCompanyId === "string" ? i.operatingCompanyId : null]);
  return Object.freeze({ items: rows.map(destinationView) });
}

async function configureDestination(pool: Pool, actor: ConfigurationActor, i: Record<string, unknown>, reason: string | null) {
  only(i, ["operatingCompanyId", "displayName", "providerKey", "externalCompanyRef", "activate"]);
  const why = requireReason(reason);
  const fa: FinanceActor = { tenantId: actor.tenantId, principalId: actor.principalId };
  const d = await configureAccountingDestination(pool, fa, {
    operatingCompanyId: i.operatingCompanyId, displayName: text(i.displayName, "displayName"),
    providerKey: i.providerKey === undefined || i.providerKey === null ? null : text(i.providerKey, "providerKey", 64),
    externalCompanyRef: i.externalCompanyRef === undefined || i.externalCompanyRef === null ? null : text(i.externalCompanyRef, "externalCompanyRef"),
    activate: i.activate === true,
  });
  await audit(pool, actor, "finance.configuration.accountingDestination.configure", "accounting_destination", d.id, null, d, why);
  const attached = i.activate === true ? await refreshAccountingHandoffs(pool, fa) : { attached: 0, repointedUntouched: 0 };
  return Object.freeze({ destination: d, attachedPendingHandoffs: attached.attached, repointedUntouchedHandoffs: attached.repointedUntouched });
}

async function setDestinationStatus(pool: Pool, actor: ConfigurationActor, i: Record<string, unknown>, reason: string | null) {
  only(i, ["destinationId", "status"]);
  const why = requireReason(reason);
  const id = text(i.destinationId, "destinationId");
  if (i.status !== "ACTIVE" && i.status !== "INACTIVE") refuse("INVALID_INPUT", "INVALID_INPUT", "status is ACTIVE or INACTIVE");
  const out = await tx(pool, async (c) => {
    const { rows } = await c.query(`SELECT * FROM eos_finance.accounting_destinations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, id]);
    const d = rows[0] ?? refuse("DESTINATION_NOT_FOUND", "NOT_FOUND", "no accounting destination with that id");
    if (d.status === i.status) return { destination: destinationView(d), changed: false };
    if (i.status === "ACTIVE") {
      // One ACTIVE per company: the company's current active destination steps down first (it stays as history).
      await c.query(`UPDATE eos_finance.accounting_destinations SET status = 'INACTIVE', updated_by = $3, updated_at = now()
                      WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`, [actor.tenantId, d.operating_company_id, actor.principalId]);
    }
    const { rows: done } = await c.query(`UPDATE eos_finance.accounting_destinations SET status = $3, updated_by = $4, updated_at = now()
                                          WHERE tenant_id = $1 AND id = $2 RETURNING *`, [actor.tenantId, id, i.status, actor.principalId]);
    await audit(c, actor, "finance.configuration.accountingDestination.status", "accounting_destination", id, { status: d.status }, { status: i.status }, why);
    return { destination: destinationView(done[0]), changed: true };
  });
  const attached = out.changed && i.status === "ACTIVE" ? await refreshAccountingHandoffs(pool, { tenantId: actor.tenantId, principalId: actor.principalId }) : { attached: 0, repointedUntouched: 0 };
  return Object.freeze({ ...out, attachedPendingHandoffs: attached.attached, repointedUntouchedHandoffs: attached.repointedUntouched });
}

async function listPaymentTerms(pool: Pool, actor: ConfigurationActor, i: Record<string, unknown>) {
  only(i, ["operatingCompanyId"]);
  const { rows } = await pool.query(
    `SELECT p.operating_company_id, p.status, p.payment_terms, p.payment_terms_net_days, p.updated_by, p.updated_at,
            cp.id AS counterparty_id, cp.kind, cp.operating_company_id AS counterparty_company, cp.crm_account_id, a.name AS counterparty_name
       FROM eos_finance.counterparty_company_profiles p JOIN eos_finance.financial_counterparties cp ON cp.tenant_id = p.tenant_id AND cp.id = p.counterparty_id
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = cp.tenant_id AND a.id = cp.crm_account_id
      WHERE p.tenant_id = $1 AND ($2::text IS NULL OR p.operating_company_id = $2) ORDER BY p.operating_company_id, cp.kind, cp.id`,
    [actor.tenantId, typeof i.operatingCompanyId === "string" ? i.operatingCompanyId : null]);
  return Object.freeze({ items: rows.map((r) => Object.freeze({
    operatingCompanyId: r.operating_company_id, status: r.status, paymentTerms: r.payment_terms ?? null, paymentTermsNetDays: r.payment_terms_net_days ?? null,
    counterparty: r.kind === "INTERNAL_OPERATING_COMPANY" ? { kind: r.kind, operatingCompanyId: r.counterparty_company }
      : { kind: r.kind, crmAccountId: r.crm_account_id, name: r.counterparty_name ?? null },
    updatedBy: r.updated_by, updatedAt: new Date(r.updated_at).toISOString(),
  })) });
}

async function setPaymentTerms(pool: Pool, actor: ConfigurationActor, i: Record<string, unknown>, reason: string | null) {
  only(i, ["operatingCompanyId", "counterparty", "paymentTermsNetDays", "paymentTerms"]);
  const why = requireReason(reason);
  const cpIn = i.counterparty as Record<string, unknown> | undefined;
  if (!cpIn || typeof cpIn !== "object") refuse("INVALID_INPUT", "INVALID_INPUT", "counterparty is { kind: INTERNAL_OPERATING_COMPANY, operatingCompanyId } or { kind: EXTERNAL_ORGANIZATION, crmAccountId }");
  const netDays = i.paymentTermsNetDays === null ? null : i.paymentTermsNetDays;
  if (netDays !== null && !(Number.isSafeInteger(netDays) && (netDays as number) >= 0 && (netDays as number) <= 3650)) {
    refuse("PAYMENT_TERMS_INVALID", "INVALID_INPUT", "paymentTermsNetDays is a whole number of days (0-3650), or null to clear");
  }
  const fa: FinanceActor = { tenantId: actor.tenantId, principalId: actor.principalId };
  return tx(pool, async (c) => {
    const company = await resolveOperatingCompany(c, actor.tenantId, i.operatingCompanyId);
    const counterparty = cpIn!.kind === "INTERNAL_OPERATING_COMPANY"
      ? await ensureInternalCounterparty(c, fa, cpIn!.operatingCompanyId)
      : cpIn!.kind === "EXTERNAL_ORGANIZATION" ? await ensureExternalCounterparty(c, fa, cpIn!.crmAccountId)
        : refuse("INVALID_INPUT", "INVALID_INPUT", "counterparty.kind is INTERNAL_OPERATING_COMPANY or EXTERNAL_ORGANIZATION");
    if (counterparty.kind === "INTERNAL_OPERATING_COMPANY" && counterparty.operatingCompanyId === company) {
      refuse("COUNTERPARTY_IS_SELF", "INVALID_INPUT", "a company has no payment terms with itself");
    }
    const { rows: before } = await c.query(`SELECT payment_terms, payment_terms_net_days FROM eos_finance.counterparty_company_profiles
      WHERE tenant_id = $1 AND counterparty_id = $2 AND operating_company_id = $3`, [actor.tenantId, counterparty.id, company]);
    const profile = await setCounterpartyCompanyProfile(c, fa, { counterpartyId: counterparty.id, operatingCompanyId: company,
      paymentTerms: i.paymentTerms === undefined || i.paymentTerms === null ? (netDays === null ? null : `Net ${netDays}`) : text(i.paymentTerms, "paymentTerms", 80),
      paymentTermsNetDays: netDays as number | null });
    await audit(c, actor, "finance.configuration.paymentTerms.set", "counterparty_company_profile", `${company}:${counterparty.id}`,
      before[0] ? { paymentTerms: before[0].payment_terms, paymentTermsNetDays: before[0].payment_terms_net_days } : null,
      { paymentTerms: profile.paymentTerms, paymentTermsNetDays: profile.paymentTermsNetDays }, why);
    return Object.freeze({ profile, appliesTo: "FUTURE_OBLIGATIONS" as const });
  });
}

export function createFinanceConfigurationAdministration(pool: Pool) {
  return async (operation: AdminConfigurationOperation, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null): Promise<unknown> => {
    const { reason: _stated, ...i } = input && typeof input === "object" && !Array.isArray(input) ? input : ({} as Record<string, unknown>);
    void _stated;
    try {
      switch (operation) {
        case "listAccountingDestinations": return await listAccountingDestinations(pool, actor, i);
        case "configureAccountingDestination": return await configureDestination(pool, actor, i, reason);
        case "setAccountingDestinationStatus": return await setDestinationStatus(pool, actor, i, reason);
        case "listCounterpartyPaymentTerms": return await listPaymentTerms(pool, actor, i);
        case "setCounterpartyPaymentTerms": return await setPaymentTerms(pool, actor, i, reason);
        default: throw new Error(`not a finance configuration operation: ${String(operation)}`);
      }
    } catch (err) {
      if (err instanceof FinanceFoundationError) throw new ConfigurationRefusal(err.code, CATEGORY[err.category] ?? "CONFLICT", err.message);
      throw err;
    }
  };
}
