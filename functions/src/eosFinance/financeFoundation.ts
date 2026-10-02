// FINANCE FOUNDATION -- the company-scoped OPERATIONAL financial subledger core (Controller FINANCE TARGET MODEL ACCEPTANCE
// + FOUNDATION IMPLEMENTATION, 2026-10-01; DECISIONS #145, #190, #191; migration 1764420000000).
//
// A REPOSITORY, not a transport: nothing here is routed, granted or activated. Later Finance packages compose it behind
// their own governed capabilities. PostgreSQL only -- no Firebase import, no Firebase bridge, no Firebase sample data.
//
//   organizations / counterparties  CRM Account is THE identity of an external organization (CUSTOMER / VENDOR /
//                                   FINANCING_PROVIDER are relationships of it); a supplier record is an operational
//                                   profile LINKED to its organization; an internal counterparty is an operating company.
//   company profiles                one organization, a distinct relationship with each operating company.
//   financial facts                 immutable, idempotent, exactly one operating company (never CONSOLIDATED); corrections
//                                   are new facts (reverse, then optionally replace) -- the original is never touched.
//   obligations                     one company + one counterparty; balances derive from facts; status is a projection.
//   acquisition-cost adapter        an existing priced receipt -> one COST_EVIDENCE fact (idempotent); an unpriced receipt
//                                   line -> a COST_EVIDENCE_MISSING exception, never a zero-cost fact.
//   accounting destinations         provider-neutral, per operating company; nothing is sent anywhere.
//
// The database enforces the invariants (triggers / constraints in the migration); this module resolves identities,
// validates input, makes every write idempotent and maps a database refusal to a named code.
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

export type FinanceFoundationCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT";

export class FinanceFoundationError extends Error {
  constructor(readonly code: string, readonly category: FinanceFoundationCategory, message: string) {
    super(message);
    this.name = "FinanceFoundationError";
  }
}
const refuse = (code: string, category: FinanceFoundationCategory, message: string): never => {
  throw new FinanceFoundationError(code, category, message);
};

export interface FinanceActor {
  readonly tenantId: string;
  readonly principalId: string;
}

export const FACT_CLASSES = Object.freeze(["COMMITMENT", "COST_EVIDENCE", "OBLIGATION", "SETTLEMENT"] as const);
export type FactClass = (typeof FACT_CLASSES)[number];
export const OBLIGATION_KINDS = Object.freeze([
  "RECEIVABLE", "PAYABLE", "FUNDING_RECEIVABLE", "INTERCOMPANY_RECEIVABLE", "INTERCOMPANY_PAYABLE",
] as const);
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];
/** The reporting projection name that can never own a financial record (#190 §1). */
export const CONSOLIDATED = "consolidated";
export const ACQUISITION_COST_FACT_TYPE = "ACQUISITION_COST";
export const COST_EVIDENCE_MISSING = "COST_EVIDENCE_MISSING";

const ID = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200;
const requireId = (v: unknown, field: string): string => {
  if (!ID(v)) refuse(`${field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${field} is required`);
  return v as string;
};

/** A database refusal raised by the migration's triggers ("CODE: message") becomes a named FinanceFoundationError. */
function mapDatabaseError(err: unknown): never {
  const e = err as { code?: string; message?: string; constraint?: string };
  const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec(e?.message ?? "");
  if (m) refuse(m[1], m[1].includes("NOT_FOUND") ? "NOT_FOUND" : "CONFLICT", m[2]);
  if (e?.code === "23505" && e.constraint === "financial_fact_reversed_once") refuse("FACT_ALREADY_REVERSED", "CONFLICT", "that financial fact is already reversed");
  if (e?.code === "23503") refuse("REFERENCE_NOT_FOUND", "NOT_FOUND", `a referenced record does not exist (${e.constraint ?? "foreign key"})`);
  if (e?.code === "23514" && /not_consolidated/.test(e.constraint ?? "")) refuse("CONSOLIDATED_NOT_A_COMPANY", "INVALID_INPUT", "CONSOLIDATED is a reporting projection, not an operating company");
  throw err;
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (err instanceof FinanceFoundationError) throw err;
    return mapDatabaseError(err);
  } finally {
    c.release();
  }
}

// ════════════════════ operating company ════════════════════

/**
 * The ONE operating company a financial record belongs to. Fails closed: missing, CONSOLIDATED, unknown or inactive is
 * refused -- a financial consequence is never attached to "no company" or to the reporting projection.
 */
export async function resolveOperatingCompany(db: Queryable, tenantId: string, operatingCompanyId: unknown): Promise<string> {
  if (typeof operatingCompanyId !== "string" || operatingCompanyId.trim() === "") {
    return refuse("OPERATING_COMPANY_UNRESOLVED", "PRECONDITION_FAILED", "a financial record must resolve to exactly one operating company");
  }
  if (operatingCompanyId.toLowerCase() === CONSOLIDATED) {
    return refuse("CONSOLIDATED_NOT_A_COMPANY", "INVALID_INPUT", "CONSOLIDATED is a reporting projection, not an operating company");
  }
  const { rows } = await db.query(`SELECT status FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2`,
    [tenantId, operatingCompanyId]);
  if (rows.length === 0 || rows[0].status !== "ACTIVE") {
    return refuse("OPERATING_COMPANY_UNRESOLVED", "PRECONDITION_FAILED", `"${operatingCompanyId}" is not an ACTIVE operating company of this tenant`);
  }
  return operatingCompanyId;
}

/** A transaction's operating-company KEY (PO, receipt, Work Order) to its governed company id, through the ACTIVE binding. */
export async function resolveOperatingCompanyFromKey(db: Queryable, tenantId: string, key: unknown): Promise<string> {
  if (typeof key !== "string" || key === "") return refuse("OPERATING_COMPANY_UNRESOLVED", "PRECONDITION_FAILED", "no operating-company key");
  const { rows } = await db.query(
    `SELECT operating_company_id FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_key = $2 AND status = 'ACTIVE'`,
    [tenantId, key]);
  if (rows.length !== 1) return refuse("OPERATING_COMPANY_UNRESOLVED", "PRECONDITION_FAILED", `key "${key}" is not bound to an ACTIVE operating company`);
  return resolveOperatingCompany(db, tenantId, rows[0].operating_company_id);
}

// ════════════════════ C1. organizations and counterparties ════════════════════

export interface Counterparty {
  readonly id: string;
  readonly kind: "EXTERNAL_ORGANIZATION" | "INTERNAL_OPERATING_COMPANY";
  readonly crmAccountId: string | null;
  readonly operatingCompanyId: string | null;
}
const counterpartyOf = (r: Record<string, unknown>): Counterparty => Object.freeze({
  id: String(r.id), kind: r.kind as Counterparty["kind"],
  crmAccountId: (r.crm_account_id as string) ?? null, operatingCompanyId: (r.operating_company_id as string) ?? null,
});

/** The counterparty of an external organization -- its CRM Account, never a second organization record. Idempotent. */
export async function ensureExternalCounterparty(db: Queryable, actor: FinanceActor, crmAccountId: unknown): Promise<Counterparty> {
  const accountId = requireId(crmAccountId, "crmAccountId");
  const { rows: acct } = await db.query(`SELECT 1 FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, accountId]);
  if (acct.length === 0) refuse("ORGANIZATION_NOT_FOUND", "NOT_FOUND", "no CRM Account (organization) with that id");
  await db.query(
    `INSERT INTO eos_finance.financial_counterparties (id, tenant_id, kind, crm_account_id, created_by)
     VALUES ($1, $2, 'EXTERNAL_ORGANIZATION', $3, $4) ON CONFLICT DO NOTHING`,
    [`fcp_${randomUUID()}`, actor.tenantId, accountId, actor.principalId]);
  const { rows } = await db.query(`SELECT * FROM eos_finance.financial_counterparties WHERE tenant_id = $1 AND crm_account_id = $2`,
    [actor.tenantId, accountId]);
  return counterpartyOf(rows[0]);
}

/** The counterparty of an operating company (Taylor / Ventana as each other's counterparty). Never a CRM Account. */
export async function ensureInternalCounterparty(db: Queryable, actor: FinanceActor, operatingCompanyId: unknown): Promise<Counterparty> {
  const company = await resolveOperatingCompany(db, actor.tenantId, operatingCompanyId);
  await db.query(
    `INSERT INTO eos_finance.financial_counterparties (id, tenant_id, kind, operating_company_id, created_by)
     VALUES ($1, $2, 'INTERNAL_OPERATING_COMPANY', $3, $4) ON CONFLICT DO NOTHING`,
    [`fcp_${randomUUID()}`, actor.tenantId, company, actor.principalId]);
  const { rows } = await db.query(`SELECT * FROM eos_finance.financial_counterparties WHERE tenant_id = $1 AND operating_company_id = $2`,
    [actor.tenantId, company]);
  return counterpartyOf(rows[0]);
}

export async function readCounterparty(db: Queryable, tenantId: string, counterpartyId: string): Promise<Counterparty | null> {
  const { rows } = await db.query(`SELECT * FROM eos_finance.financial_counterparties WHERE tenant_id = $1 AND id = $2`, [tenantId, counterpartyId]);
  return rows[0] ? counterpartyOf(rows[0]) : null;
}

/** The organization's governed relationships (CUSTOMER / VENDOR / FINANCING_PROVIDER). */
export async function organizationRelationships(db: Queryable, tenantId: string, crmAccountId: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT relationship_type FROM eos_crm.account_relationship_types WHERE tenant_id = $1 AND account_id = $2 ORDER BY 1`, [tenantId, crmAccountId]);
  return rows.map((r) => String(r.relationship_type));
}

/**
 * Link an operational supplier profile to the organization it belongs to. The organization must be governed as a VENDOR;
 * a supplier already linked to a DIFFERENT organization is refused (no silent re-homing); relinking to the same one is a
 * no-op. The supplier record is not removed or replaced.
 */
export async function linkSupplierToOrganization(db: Queryable, actor: FinanceActor, input: { supplierId: unknown; crmAccountId: unknown }) {
  const supplierId = requireId(input.supplierId, "supplierId");
  const accountId = requireId(input.crmAccountId, "crmAccountId");
  if (!(await organizationRelationships(db, actor.tenantId, accountId)).includes("VENDOR")) {
    refuse("ORGANIZATION_NOT_VENDOR", "PRECONDITION_FAILED", "the organization is not governed as a VENDOR");
  }
  const { rows } = await db.query(`SELECT crm_account_id FROM eos_ops.suppliers WHERE tenant_id = $1 AND supplier_id = $2 FOR UPDATE`,
    [actor.tenantId, supplierId]);
  if (rows.length === 0) refuse("SUPPLIER_NOT_FOUND", "NOT_FOUND", "no supplier with that id");
  if (rows[0].crm_account_id === accountId) return { outcome: "NO_CHANGE" as const, supplierId, crmAccountId: accountId };
  if (rows[0].crm_account_id) refuse("SUPPLIER_ALREADY_LINKED", "CONFLICT", "the supplier is already linked to a different organization");
  try {
    await db.query(`UPDATE eos_ops.suppliers SET crm_account_id = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND supplier_id = $2`,
      [actor.tenantId, supplierId, accountId, actor.principalId]);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") refuse("ORGANIZATION_ALREADY_HAS_SUPPLIER", "CONFLICT", "the organization already has a supplier profile");
    throw err;
  }
  return { outcome: "LINKED" as const, supplierId, crmAccountId: accountId };
}

/** The counterparty behind a supplier, when the supplier is governed onto its organization; null otherwise. */
export async function counterpartyForSupplier(db: Queryable, actor: FinanceActor, supplierId: string | null): Promise<Counterparty | null> {
  if (!supplierId) return null;
  const { rows } = await db.query(`SELECT crm_account_id FROM eos_ops.suppliers WHERE tenant_id = $1 AND supplier_id = $2`, [actor.tenantId, supplierId]);
  if (!rows[0]?.crm_account_id) return null;
  return ensureExternalCounterparty(db, actor, rows[0].crm_account_id);
}

// ════════════════════ C2. counterparty-by-company profile ════════════════════

export interface CounterpartyCompanyProfile {
  readonly counterpartyId: string;
  readonly operatingCompanyId: string;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly paymentTerms: string | null;
  readonly accountingReference: string | null;
}

export async function setCounterpartyCompanyProfile(db: Queryable, actor: FinanceActor, input: {
  counterpartyId: unknown; operatingCompanyId: unknown; paymentTerms?: string | null; accountingReference?: string | null; status?: "ACTIVE" | "INACTIVE";
}): Promise<CounterpartyCompanyProfile> {
  const counterpartyId = requireId(input.counterpartyId, "counterpartyId");
  const company = await resolveOperatingCompany(db, actor.tenantId, input.operatingCompanyId);
  try {
    await db.query(
      `INSERT INTO eos_finance.counterparty_company_profiles (tenant_id, counterparty_id, operating_company_id, status, payment_terms, accounting_reference, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, counterparty_id, operating_company_id)
       DO UPDATE SET status = EXCLUDED.status, payment_terms = EXCLUDED.payment_terms, accounting_reference = EXCLUDED.accounting_reference,
                     updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [actor.tenantId, counterpartyId, company, input.status ?? "ACTIVE", input.paymentTerms ?? null, input.accountingReference ?? null, actor.principalId]);
  } catch (err) {
    return mapDatabaseError(err);
  }
  return (await readCounterpartyCompanyProfile(db, actor.tenantId, counterpartyId, company)) as CounterpartyCompanyProfile;
}

export async function readCounterpartyCompanyProfile(db: Queryable, tenantId: string, counterpartyId: string, operatingCompanyId: string)
  : Promise<CounterpartyCompanyProfile | null> {
  const { rows } = await db.query(
    `SELECT * FROM eos_finance.counterparty_company_profiles WHERE tenant_id = $1 AND counterparty_id = $2 AND operating_company_id = $3`,
    [tenantId, counterpartyId, operatingCompanyId]);
  const r = rows[0];
  return r ? Object.freeze({ counterpartyId, operatingCompanyId, status: r.status, paymentTerms: r.payment_terms ?? null, accountingReference: r.accounting_reference ?? null }) : null;
}

// ════════════════════ C3. financial facts ════════════════════

export interface FinancialFactInput {
  readonly operatingCompanyId: unknown;
  readonly counterpartyId?: string | null;
  readonly factClass: FactClass;
  readonly factType: string;
  readonly sourceDomain: string;
  readonly sourceRecordId: string;
  readonly sourceLine?: string | null;
  readonly amountMinor: number | bigint;
  readonly currency: string;
  readonly basis: string;
  readonly effectiveAt: Date;
  readonly idempotencyKey: string;
  readonly obligationId?: string | null;
  readonly correlationId?: string | null;
}

export interface FinancialFact {
  readonly id: string;
  readonly operatingCompanyId: string;
  readonly counterpartyId: string | null;
  readonly factClass: FactClass;
  readonly factType: string;
  readonly sourceDomain: string;
  readonly sourceRecordId: string;
  readonly sourceLine: string | null;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly basis: string;
  readonly effectiveAt: Date;
  readonly idempotencyKey: string;
  readonly obligationId: string | null;
  readonly reversesFactId: string | null;
  readonly correctsFactId: string | null;
  readonly correlationId: string | null;
  readonly reason: string | null;
}
const factOf = (r: Record<string, unknown>): FinancialFact => Object.freeze({
  id: String(r.id), operatingCompanyId: String(r.operating_company_id), counterpartyId: (r.counterparty_id as string) ?? null,
  factClass: r.fact_class as FactClass, factType: String(r.fact_type), sourceDomain: String(r.source_domain),
  sourceRecordId: String(r.source_record_id), sourceLine: (r.source_line as string) ?? null, amountMinor: BigInt(r.amount_minor as string),
  currency: String(r.currency), basis: String(r.basis), effectiveAt: r.effective_at as Date, idempotencyKey: String(r.idempotency_key),
  obligationId: (r.obligation_id as string) ?? null, reversesFactId: (r.reverses_fact_id as string) ?? null,
  correctsFactId: (r.corrects_fact_id as string) ?? null, correlationId: (r.correlation_id as string) ?? null, reason: (r.reason as string) ?? null,
});

interface InternalFactInput extends FinancialFactInput {
  readonly reversesFactId?: string | null;
  readonly correctsFactId?: string | null;
  readonly reason?: string | null;
}

function validateFact(i: InternalFactInput): void {
  if (!(FACT_CLASSES as readonly string[]).includes(i.factClass)) refuse("FACT_CLASS_INVALID", "INVALID_INPUT", `factClass is one of ${FACT_CLASSES.join(", ")}`);
  if (typeof i.factType !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(i.factType)) refuse("FACT_TYPE_INVALID", "INVALID_INPUT", "factType is an UPPER_SNAKE code");
  for (const [k, v] of [["sourceDomain", i.sourceDomain], ["sourceRecordId", i.sourceRecordId], ["basis", i.basis], ["idempotencyKey", i.idempotencyKey]] as const) {
    if (typeof v !== "string" || v.trim() === "") refuse(`${k.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${k} is required`);
  }
  const amount = typeof i.amountMinor === "bigint" ? i.amountMinor : Number.isSafeInteger(i.amountMinor) ? BigInt(i.amountMinor) : null;
  if (amount === null || amount === 0n) refuse("AMOUNT_INVALID", "INVALID_INPUT", "amountMinor is a non-zero integer of minor units (unknown is not zero)");
  if (typeof i.currency !== "string" || !/^[A-Z]{3}$/.test(i.currency)) refuse("CURRENCY_INVALID", "INVALID_INPUT", "currency is an ISO 4217 code");
  if (!(i.effectiveAt instanceof Date) || Number.isNaN(i.effectiveAt.getTime())) refuse("EFFECTIVE_AT_REQUIRED", "INVALID_INPUT", "effectiveAt is required");
  if ((i.factClass === "OBLIGATION" || i.factClass === "SETTLEMENT") !== Boolean(i.obligationId)) {
    refuse("OBLIGATION_CLASS_MISMATCH", "INVALID_INPUT", "OBLIGATION / SETTLEMENT facts (and only they) name an obligation");
  }
}

const fingerprintOf = (company: string, i: InternalFactInput): string => createHash("sha256").update(JSON.stringify([
  company, i.counterpartyId ?? null, i.factClass, i.factType, i.sourceDomain, i.sourceRecordId, i.sourceLine ?? null, String(i.amountMinor),
  i.currency, i.basis, i.effectiveAt.toISOString(), i.obligationId ?? null, i.reversesFactId ?? null, i.correctsFactId ?? null, i.correlationId ?? null,
])).digest("hex");

/** Insert ONE fact inside the caller's transaction. Same key + same content = the original (replayed); different = conflict. */
async function insertFact(db: Queryable, actor: FinanceActor, i: InternalFactInput): Promise<{ outcome: "recorded" | "replayed"; fact: FinancialFact }> {
  validateFact(i);
  const company = await resolveOperatingCompany(db, actor.tenantId, i.operatingCompanyId);
  const fingerprint = fingerprintOf(company, i);
  try {
    const { rows } = await db.query(
      `INSERT INTO eos_finance.financial_facts (id, tenant_id, operating_company_id, counterparty_id, fact_class, fact_type, source_domain,
          source_record_id, source_line, amount_minor, currency, basis, effective_at, idempotency_key, request_fingerprint, obligation_id,
          reverses_fact_id, corrects_fact_id, correlation_id, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING *`,
      [`ff_${randomUUID()}`, actor.tenantId, company, i.counterpartyId ?? null, i.factClass, i.factType, i.sourceDomain, i.sourceRecordId,
        i.sourceLine ?? null, String(i.amountMinor), i.currency, i.basis, i.effectiveAt, i.idempotencyKey, fingerprint, i.obligationId ?? null,
        i.reversesFactId ?? null, i.correctsFactId ?? null, i.correlationId ?? null, i.reason ?? null, actor.principalId]);
    if (rows[0]) return { outcome: "recorded", fact: factOf(rows[0]) };
  } catch (err) {
    return mapDatabaseError(err);
  }
  const { rows } = await db.query(`SELECT * FROM eos_finance.financial_facts WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, i.idempotencyKey]);
  if (rows[0].request_fingerprint !== fingerprint) {
    refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotency key already recorded a different financial fact");
  }
  return { outcome: "replayed", fact: factOf(rows[0]) };
}

/** Record one immutable financial fact (COMMITMENT or COST_EVIDENCE; OBLIGATION / SETTLEMENT go through the obligation API). */
export async function recordFinancialFact(pool: Pool, actor: FinanceActor, input: FinancialFactInput) {
  if (input.factClass === "OBLIGATION" || input.factClass === "SETTLEMENT") {
    refuse("USE_OBLIGATION_API", "INVALID_INPUT", "obligation origination and settlement facts are recorded through the obligation API");
  }
  return tx(pool, (c) => insertFact(c, actor, input));
}

export async function readFinancialFact(db: Queryable, tenantId: string, factId: string): Promise<FinancialFact | null> {
  const { rows } = await db.query(`SELECT * FROM eos_finance.financial_facts WHERE tenant_id = $1 AND id = $2`, [tenantId, factId]);
  return rows[0] ? factOf(rows[0]) : null;
}

// ════════════════════ C6. corrections ════════════════════

async function reverseInTx(c: Queryable, actor: FinanceActor, input: { factId: unknown; reason: unknown; idempotencyKey: unknown }) {
  const factId = requireId(input.factId, "factId");
  if (typeof input.reason !== "string" || input.reason.trim() === "") refuse("REASON_REQUIRED", "INVALID_INPUT", "a correction states its reason");
  const idempotencyKey = requireId(input.idempotencyKey, "idempotencyKey");
  const original = await readFinancialFact(c, actor.tenantId, factId);
  if (!original) return refuse("FACT_NOT_FOUND", "NOT_FOUND", "no financial fact with that id");
  return insertFact(c, actor, {
    operatingCompanyId: original.operatingCompanyId, counterpartyId: original.counterpartyId, factClass: original.factClass,
    factType: original.factType, sourceDomain: original.sourceDomain, sourceRecordId: original.sourceRecordId, sourceLine: original.sourceLine,
    amountMinor: -original.amountMinor, currency: original.currency, basis: original.basis, effectiveAt: new Date(),
    idempotencyKey, obligationId: original.obligationId, correlationId: original.correlationId,
    reversesFactId: original.id, reason: (input.reason as string).trim(),
  });
}

/** REVERSE: a new, equal-and-opposite fact linked to the original (which is never changed). At most once per fact. */
export async function reverseFinancialFact(pool: Pool, actor: FinanceActor, input: { factId: unknown; reason: unknown; idempotencyKey: unknown }) {
  return tx(pool, async (c) => {
    const out = await reverseInTx(c, actor, input);
    if (out.fact.obligationId) await refreshObligationStatus(c, actor, out.fact.obligationId);
    return out;
  });
}

/**
 * CORRECT: reverse the original and record its replacement in ONE transaction. The replacement keeps the original's company,
 * class, currency and source operational record, carries `corrects_fact_id`, and states the reason. The original survives.
 */
export async function correctFinancialFact(pool: Pool, actor: FinanceActor, input: {
  factId: unknown; reason: unknown; idempotencyKey: unknown;
  replacement: { amountMinor: number | bigint; basis?: string; counterpartyId?: string | null; effectiveAt?: Date };
}) {
  const key = requireId(input.idempotencyKey, "idempotencyKey");
  return tx(pool, async (c) => {
    const reversal = await reverseInTx(c, actor, { factId: input.factId, reason: input.reason, idempotencyKey: `${key}:reverse` });
    const original = (await readFinancialFact(c, actor.tenantId, input.factId as string)) as FinancialFact;
    const replacement = await insertFact(c, actor, {
      operatingCompanyId: original.operatingCompanyId, counterpartyId: input.replacement.counterpartyId === undefined ? original.counterpartyId : input.replacement.counterpartyId,
      factClass: original.factClass, factType: original.factType, sourceDomain: original.sourceDomain, sourceRecordId: original.sourceRecordId,
      sourceLine: original.sourceLine, amountMinor: input.replacement.amountMinor, currency: original.currency,
      basis: input.replacement.basis ?? original.basis, effectiveAt: input.replacement.effectiveAt ?? original.effectiveAt,
      idempotencyKey: `${key}:replace`, obligationId: original.obligationId, correlationId: original.correlationId,
      correctsFactId: original.id, reason: (input.reason as string).trim(),
    });
    return { reversal: reversal.fact, replacement: replacement.fact, outcome: replacement.outcome };
  });
}

// ════════════════════ C4. obligations ════════════════════

export interface ObligationBalance {
  readonly obligationId: string;
  readonly operatingCompanyId: string;
  readonly counterpartyId: string;
  readonly kind: ObligationKind;
  readonly currency: string;
  readonly status: string;
  readonly originatedMinor: bigint;
  readonly settledMinor: bigint;
  readonly outstandingMinor: bigint;
}

export async function readObligationBalance(db: Queryable, tenantId: string, obligationId: string): Promise<ObligationBalance | null> {
  const { rows } = await db.query(`SELECT * FROM eos_finance.obligation_balances WHERE tenant_id = $1 AND obligation_id = $2`, [tenantId, obligationId]);
  const r = rows[0];
  return r ? Object.freeze({ obligationId, operatingCompanyId: r.operating_company_id, counterpartyId: r.counterparty_id, kind: r.kind,
    currency: r.currency, status: r.status, originatedMinor: BigInt(r.originated_minor), settledMinor: BigInt(r.settled_minor),
    outstandingMinor: BigInt(r.outstanding_minor) }) : null;
}

/** The status PROJECTION of an obligation, derived from its facts (never the truth itself). VOID is sticky. */
async function refreshObligationStatus(c: Queryable, actor: FinanceActor, obligationId: string): Promise<void> {
  const b = (await readObligationBalance(c, actor.tenantId, obligationId)) as ObligationBalance;
  if (b.status === "VOID") return;
  const status = b.originatedMinor > 0n && b.outstandingMinor === 0n ? "SETTLED" : b.settledMinor > 0n ? "PARTIAL" : "OPEN";
  if (status !== b.status) {
    await c.query(`UPDATE eos_finance.obligations SET status = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, obligationId, status, actor.principalId]);
  }
}

/**
 * Open an obligation of ONE company toward ONE counterparty, with its origination fact, in one transaction. Idempotent on
 * `idempotencyKey`. The counterparty must fit the kind (enforced by the database too): INTERCOMPANY_* -> the other
 * operating company; FUNDING_RECEIVABLE -> an organization governed as a FINANCING_PROVIDER; the rest -> an organization.
 */
export interface OpenObligationInput {
  operatingCompanyId: unknown; counterpartyId: unknown; kind: ObligationKind; currency: string; sourceDomain: string; sourceRecordId: string;
  sourceLine?: string | null; originationAmountMinor: number | bigint; basis: string; effectiveAt: Date; idempotencyKey: string; correlationId?: string | null;
}

export async function openObligation(pool: Pool, actor: FinanceActor, input: OpenObligationInput) {
  return tx(pool, (c) => openObligationOn(c, actor, input));
}

/** The same obligation opening INSIDE the caller's transaction (a governed consequence composed with its source). */
export async function openObligationOn(c: Queryable, actor: FinanceActor, input: OpenObligationInput) {
  if (!(OBLIGATION_KINDS as readonly string[]).includes(input.kind)) refuse("OBLIGATION_KIND_INVALID", "INVALID_INPUT", `kind is one of ${OBLIGATION_KINDS.join(", ")}`);
  const counterpartyId = requireId(input.counterpartyId, "counterpartyId");
  const key = requireId(input.idempotencyKey, "idempotencyKey");
  if (typeof input.originationAmountMinor !== "bigint" && !(Number.isSafeInteger(input.originationAmountMinor) && input.originationAmountMinor > 0)) {
    refuse("AMOUNT_INVALID", "INVALID_INPUT", "an obligation originates for a positive amount");
  }
  if (typeof input.originationAmountMinor === "bigint" && input.originationAmountMinor <= 0n) {
    refuse("AMOUNT_INVALID", "INVALID_INPUT", "an obligation originates for a positive amount");
  }
  try {
    const company = await resolveOperatingCompany(c, actor.tenantId, input.operatingCompanyId);
    const { rows: existing } = await c.query(`SELECT id FROM eos_finance.obligations WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
    let obligationId: string;
    if (existing[0]) {
      obligationId = existing[0].id;
    } else {
      obligationId = `obl_${randomUUID()}`;
      await c.query(
        `INSERT INTO eos_finance.obligations (id, tenant_id, operating_company_id, counterparty_id, kind, currency, source_domain, source_record_id,
            idempotency_key, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [obligationId, actor.tenantId, company, counterpartyId, input.kind, input.currency, input.sourceDomain, input.sourceRecordId, key, actor.principalId]);
    }
    const origination = await insertFact(c, actor, {
      operatingCompanyId: company, counterpartyId, factClass: "OBLIGATION", factType: `${input.kind}_ORIGINATED`, sourceDomain: input.sourceDomain,
      sourceRecordId: input.sourceRecordId, sourceLine: input.sourceLine ?? null, amountMinor: input.originationAmountMinor, currency: input.currency,
      basis: input.basis, effectiveAt: input.effectiveAt, idempotencyKey: `${key}:originate`, obligationId, correlationId: input.correlationId ?? null,
    });
    return { outcome: origination.outcome, obligationId, origination: origination.fact, balance: await readObligationBalance(c, actor.tenantId, obligationId) };
  } catch (err) {
    if (err instanceof FinanceFoundationError) throw err;
    return mapDatabaseError(err);
  }
}

/**
 * VOID an obligation whose SOURCE was legitimately superseded (#191 / target model §15: "package / obligation VOID status +
 * reversing facts (before acceptance)"). Refused once anything was settled against it. The origination facts are reversed
 * (never edited) and the status projection becomes VOID (sticky). Idempotent on the key.
 */
export async function voidObligationOn(c: Queryable, actor: FinanceActor, input: { obligationId: string; reason: string; idempotencyKey: string }) {
  const balance = await readObligationBalance(c, actor.tenantId, input.obligationId);
  if (!balance) return refuse("OBLIGATION_NOT_FOUND", "NOT_FOUND", "no obligation with that id");
  if (balance.status === "VOID") return { outcome: "replayed" as const, obligationId: input.obligationId };
  if (balance.settledMinor !== 0n) refuse("OBLIGATION_HAS_SETTLEMENTS", "PRECONDITION_FAILED", "a settled obligation is corrected through its settlements, not voided");
  const { rows } = await c.query(
    `SELECT f.id FROM eos_finance.financial_facts f WHERE f.tenant_id = $1 AND f.obligation_id = $2 AND f.fact_class = 'OBLIGATION'
        AND f.reverses_fact_id IS NULL AND NOT EXISTS (SELECT 1 FROM eos_finance.financial_facts r WHERE r.tenant_id = f.tenant_id AND r.reverses_fact_id = f.id)`,
    [actor.tenantId, input.obligationId]);
  for (const f of rows) await reverseInTx(c, actor, { factId: f.id, reason: input.reason, idempotencyKey: `${input.idempotencyKey}:${f.id}` });
  await c.query(`UPDATE eos_finance.obligations SET status = 'VOID', updated_by = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [actor.tenantId, input.obligationId, actor.principalId]);
  return { outcome: "voided" as const, obligationId: input.obligationId };
}

/** Settle part or all of an obligation with a SETTLEMENT fact. Over-application is refused (and enforced by the database). */
export async function recordSettlement(pool: Pool, actor: FinanceActor, input: {
  obligationId: unknown; amountMinor: number | bigint; basis: string; effectiveAt: Date; idempotencyKey: string; sourceDomain: string; sourceRecordId: string;
}) {
  const obligationId = requireId(input.obligationId, "obligationId");
  return tx(pool, async (c) => {
    const { rows } = await c.query(`SELECT * FROM eos_finance.obligations WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, obligationId]);
    const o = rows[0];
    if (!o) return refuse("OBLIGATION_NOT_FOUND", "NOT_FOUND", "no obligation with that id");
    if (o.status === "VOID") refuse("OBLIGATION_VOID", "PRECONDITION_FAILED", "a VOID obligation cannot be settled");
    const settlement = await insertFact(c, actor, {
      operatingCompanyId: o.operating_company_id, counterpartyId: o.counterparty_id, factClass: "SETTLEMENT", factType: "SETTLEMENT",
      sourceDomain: input.sourceDomain, sourceRecordId: input.sourceRecordId, amountMinor: input.amountMinor, currency: o.currency, basis: input.basis,
      effectiveAt: input.effectiveAt, idempotencyKey: input.idempotencyKey, obligationId,
    });
    await refreshObligationStatus(c, actor, obligationId);
    return { outcome: settlement.outcome, settlement: settlement.fact, balance: await readObligationBalance(c, actor.tenantId, obligationId) };
  });
}

// ════════════════════ C5. acquisition-cost adapter ════════════════════

export interface AcquisitionCostProjection {
  readonly receivingId: string;
  readonly facts: readonly { readonly outcome: "recorded" | "replayed"; readonly fact: FinancialFact }[];
  readonly missingCostEvidence: readonly { readonly receivingLineId: string; readonly partId: string; readonly receivedQuantity: number }[];
}

/**
 * Project ONE existing receipt into the financial-fact core. Reads -- never writes -- the receipt and its acquisition-cost
 * evidence (eos_finance.inventory_acquisition_costs stays the single source of the cost; this is a derived, idempotent fact,
 * not a second truth).
 *
 *   priced line    -> one COST_EVIDENCE / ACQUISITION_COST fact for the extended cost, keyed `acq:<evidence id>`, owned by the
 *                     operating company the evidence was frozen with at receipt (the PURCHASING transaction's company --
 *                     never inferred from where the stock sits, #190 §5 / correction A2); counterparty = the supplier's
 *                     organization when the supplier is governed onto one.
 *   unpriced line  -> NO fact (never a zero cost) and one COST_EVIDENCE_MISSING exception, keyed per receipt line.
 *
 * Replaying the same receipt records nothing new.
 */
/**
 * The counterparty behind ONE piece of acquisition-cost evidence (DECISIONS #193) -- from GOVERNED identity only, never a name:
 *   Reorder PO, EXTERNAL_ORGANIZATION      -> the supplier's organization (EXTERNAL_ORGANIZATION), when governed onto one;
 *   Reorder PO, INTERNAL_OPERATING_COMPANY -> the supplying operating company (INTERNAL_OPERATING_COMPANY), never the buyer;
 *   Reorder PO, legacy text-only           -> null (unresolved; the text is never guessed into a counterparty);
 *   canonical PO                           -> the evidence's supplier id, as before.
 */
async function counterpartyForEvidence(c: Queryable, actor: FinanceActor, e: Record<string, unknown>): Promise<Counterparty | null> {
  if (e.purchase_order_source_type !== "REORDER_PURCHASE_ORDER") return counterpartyForSupplier(c, actor, (e.supplier_id as string | null) ?? null);
  const { rows } = await c.query(
    `SELECT supplier_kind, supplier_id, supplier_operating_company_id FROM eos_ops.purchase_orders WHERE tenant_id = $1 AND id = $2`,
    [actor.tenantId, e.purchase_order_id]);
  const po = rows[0];
  if (!po || po.supplier_kind === null) return null;
  if (po.supplier_kind === "EXTERNAL_ORGANIZATION") return counterpartyForSupplier(c, actor, po.supplier_id as string);
  if (po.supplier_operating_company_id === e.operating_company_id) {
    return refuse("SELF_PURCHASE_REFUSED", "PRECONDITION_FAILED", "an operating company cannot be its own supplier counterparty");
  }
  return ensureInternalCounterparty(c, actor, po.supplier_operating_company_id);
}

/** A replacement receipt's link to the facts its lines correct (receipt correction, DECISIONS #193). */
export interface ReceiptFactCorrection {
  readonly correctsFactIdByLine: ReadonlyMap<string, string>;
  readonly reason: string;
}

export async function projectReceiptAcquisitionCostOn(c: Queryable, actor: FinanceActor,
  input: { receivingId: unknown; correction?: ReceiptFactCorrection }): Promise<AcquisitionCostProjection> {
  const receivingId = requireId(input.receivingId, "receivingId");
  const { rows: rcv } = await c.query(
    `SELECT id, operating_company_key, source_purchase_order_id, status::text AS status FROM eos_ops.receiving_orders WHERE tenant_id = $1 AND id = $2`,
    [actor.tenantId, receivingId]);
  if (!rcv[0]) return refuse("RECEIPT_NOT_FOUND", "NOT_FOUND", "no receipt with that id");
  if (rcv[0].status === "CANCELLED") refuse("RECEIPT_CANCELLED", "PRECONDITION_FAILED", "a cancelled receipt carries no cost consequence");
  const { rows: lines } = await c.query(
    `SELECT line_id, part_id, received_quantity FROM eos_ops.receiving_order_lines WHERE tenant_id = $1 AND receiving_order_id = $2 ORDER BY line_id`,
    [actor.tenantId, receivingId]);
  const { rows: evidence } = await c.query(
    `SELECT * FROM eos_finance.inventory_acquisition_costs WHERE tenant_id = $1 AND receiving_id = $2`, [actor.tenantId, receivingId]);
  const byLine = new Map(evidence.map((e) => [String(e.receiving_line_id), e]));
  const facts: { outcome: "recorded" | "replayed"; fact: FinancialFact }[] = [];
  const missing: { receivingLineId: string; partId: string; receivedQuantity: number }[] = [];
  let receiptCompany: string | null = null;
  for (const line of lines) {
    const e = byLine.get(String(line.line_id));
    if (e) {
      const counterparty = await counterpartyForEvidence(c, actor, e);
      const corrects = input.correction?.correctsFactIdByLine.get(String(line.line_id)) ?? null;
      facts.push(await insertFact(c, actor, {
        operatingCompanyId: e.operating_company_id, counterpartyId: counterparty?.id ?? null, factClass: "COST_EVIDENCE",
        factType: ACQUISITION_COST_FACT_TYPE, sourceDomain: "RECEIVING", sourceRecordId: receivingId, sourceLine: String(line.line_id),
        amountMinor: BigInt(e.extended_cost_minor), currency: e.currency, basis: String(e.cost_basis), effectiveAt: e.received_at,
        idempotencyKey: `acq:${e.id}`, correlationId: e.purchase_order_id,
        ...(corrects === null ? {} : { correctsFactId: corrects, reason: (input.correction as ReceiptFactCorrection).reason }),
      }));
    } else {
      receiptCompany ??= await resolveOperatingCompanyFromKey(c, actor.tenantId, rcv[0].operating_company_key);
      await c.query(
        `INSERT INTO eos_finance.cost_evidence_exceptions (id, tenant_id, operating_company_id, condition, receiving_id, receiving_line_id,
            purchase_order_id, part_id, received_quantity, detected_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id, receiving_id, receiving_line_id, condition) DO NOTHING`,
        [`cee_${randomUUID()}`, actor.tenantId, receiptCompany, COST_EVIDENCE_MISSING, receivingId, String(line.line_id),
          rcv[0].source_purchase_order_id, line.part_id, line.received_quantity, actor.principalId]);
      missing.push({ receivingLineId: String(line.line_id), partId: String(line.part_id), receivedQuantity: Number(line.received_quantity) });
    }
  }
  return Object.freeze({ receivingId, facts: Object.freeze(facts), missingCostEvidence: Object.freeze(missing) });
}

/** The same projection in its own transaction (recovery / tooling). */
export async function projectReceiptAcquisitionCost(pool: Pool, actor: FinanceActor, input: { receivingId: unknown }): Promise<AcquisitionCostProjection> {
  return tx(pool, (c) => projectReceiptAcquisitionCostOn(c, actor, input));
}

/**
 * THE FINANCE CONSEQUENCE OF A RECEIPT CORRECTION (DECISIONS #193), inside the correction's transaction. Every live
 * acquisition fact of the corrected receipt -- one that is not itself a reversal and is not yet reversed (an original, or the
 * replacement left by an earlier Finance correction) -- gets ONE equal-and-opposite reversal keyed by the correction. The
 * facts themselves are never edited. Returns the live fact each receipt line had, so a replacement receipt can link to it.
 */
export async function reverseReceiptFinancialConsequenceOn(c: Queryable, actor: FinanceActor,
  input: { receivingId: string; correctionId: string; reason: string })
  : Promise<{ readonly reversed: readonly { readonly lineId: string; readonly factId: string; readonly reversalFactId: string }[] }> {
  const { rows } = await c.query(
    `SELECT f.id, f.source_line FROM eos_finance.financial_facts f
      WHERE f.tenant_id = $1 AND f.source_domain = 'RECEIVING' AND f.source_record_id = $2 AND f.fact_type = $3
        AND f.reverses_fact_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM eos_finance.financial_facts r WHERE r.tenant_id = f.tenant_id AND r.reverses_fact_id = f.id)
      ORDER BY f.source_line, f.created_at`, [actor.tenantId, input.receivingId, ACQUISITION_COST_FACT_TYPE]);
  const reversed: { lineId: string; factId: string; reversalFactId: string }[] = [];
  for (const f of rows) {
    const out = await reverseInTx(c, actor, { factId: f.id, reason: input.reason, idempotencyKey: `rcvcorr:${input.correctionId}:${f.id}` });
    reversed.push({ lineId: String(f.source_line), factId: String(f.id), reversalFactId: out.fact.id });
  }
  return Object.freeze({ reversed: Object.freeze(reversed) });
}

/** A corrected receipt's open COST_EVIDENCE_MISSING exceptions are RESOLVED by an append-only row (never edited). */
export async function resolveReceiptCostExceptionsOn(c: Queryable, actor: FinanceActor,
  input: { receivingId: string; correctionId: string; resolution: "RECEIPT_VOIDED" | "RECEIPT_CORRECTED"; reason: string }): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT x.id FROM eos_finance.cost_evidence_exceptions x
      WHERE x.tenant_id = $1 AND x.receiving_id = $2
        AND NOT EXISTS (SELECT 1 FROM eos_finance.cost_evidence_exception_resolutions r WHERE r.exception_id = x.id)
      ORDER BY x.receiving_line_id`, [actor.tenantId, input.receivingId]);
  for (const x of rows) {
    await c.query(
      `INSERT INTO eos_finance.cost_evidence_exception_resolutions (exception_id, tenant_id, resolution, receiving_correction_id, reason, resolved_by)
       VALUES ($1,$2,$3,$4,$5,$6)`, [x.id, actor.tenantId, input.resolution, input.correctionId, input.reason, actor.principalId]);
  }
  return rows.map((x) => String(x.id));
}

/**
 * DETERMINISTIC RECOVERY (Finance Activation 1). Every receipt line whose durable source state has not yet produced its
 * Finance consequence -- a priced line without its `acq:<evidence id>` fact, or an unpriced line without its
 * COST_EVIDENCE_MISSING exception -- is projected again from the durable evidence. Idempotent: running it twice records
 * nothing new. It recovers receipts recorded before the consequence was wired into receiving; for new receipts the
 * consequence commits in the receipt's own transaction. No manual database edit is ever needed.
 */
export async function recoverReceiptFinancialConsequences(pool: Pool, actor: FinanceActor, opts: { readonly limit?: number } = {})
  : Promise<{ readonly receiptsProjected: readonly string[]; readonly factsRecorded: number; readonly missingCostEvidence: number }> {
  const limit = Number.isSafeInteger(opts.limit) && (opts.limit as number) > 0 ? (opts.limit as number) : 500;
  const { rows } = await pool.query(
    `SELECT DISTINCT r.id FROM eos_ops.receiving_orders r
       JOIN eos_ops.receiving_order_lines l ON l.tenant_id = r.tenant_id AND l.receiving_order_id = r.id
       LEFT JOIN eos_finance.inventory_acquisition_costs e ON e.tenant_id = r.tenant_id AND e.receiving_id = r.id AND e.receiving_line_id = l.line_id
      WHERE r.tenant_id = $1 AND r.status::text <> 'CANCELLED'
        AND ((e.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM eos_finance.financial_facts f WHERE f.tenant_id = r.tenant_id AND f.idempotency_key = 'acq:' || e.id))
          OR (e.id IS NULL AND NOT EXISTS (SELECT 1 FROM eos_finance.cost_evidence_exceptions x WHERE x.tenant_id = r.tenant_id
                AND x.receiving_id = r.id AND x.receiving_line_id = l.line_id AND x.condition = 'COST_EVIDENCE_MISSING')))
      ORDER BY r.id LIMIT $2`, [actor.tenantId, limit]);
  const projected: string[] = [];
  let facts = 0, missing = 0;
  for (const r of rows) {
    const p = await projectReceiptAcquisitionCost(pool, actor, { receivingId: r.id });
    projected.push(String(r.id));
    facts += p.facts.filter((f) => f.outcome === "recorded").length;
    missing += p.missingCostEvidence.length;
  }
  return Object.freeze({ receiptsProjected: Object.freeze(projected), factsRecorded: facts, missingCostEvidence: missing });
}

// ════════════════════ C7. accounting destinations ════════════════════

export interface AccountingDestination {
  readonly id: string;
  readonly operatingCompanyId: string;
  readonly displayName: string;
  readonly providerKey: string | null;
  readonly externalCompanyRef: string | null;
  readonly status: "ACTIVE" | "INACTIVE";
}
const destinationOf = (r: Record<string, unknown>): AccountingDestination => Object.freeze({
  id: String(r.id), operatingCompanyId: String(r.operating_company_id), displayName: String(r.display_name),
  providerKey: (r.provider_key as string) ?? null, externalCompanyRef: (r.external_company_ref as string) ?? null, status: r.status as "ACTIVE" | "INACTIVE",
});

/**
 * Configure a provider-NEUTRAL accounting destination for ONE operating company. `providerKey` is an opaque label; no
 * connection detail or credential is accepted, nothing is contacted. Activating a destination deactivates the company's
 * previous active one (one active destination per company; companies never have to share).
 */
export async function configureAccountingDestination(pool: Pool, actor: FinanceActor, input: {
  operatingCompanyId: unknown; displayName: string; providerKey?: string | null; externalCompanyRef?: string | null; activate?: boolean;
}): Promise<AccountingDestination> {
  for (const k of Object.keys(input)) {
    if (!["operatingCompanyId", "displayName", "providerKey", "externalCompanyRef", "activate"].includes(k)) {
      refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k} (no connection detail or credential is stored here)`);
    }
  }
  if (typeof input.displayName !== "string" || input.displayName.trim() === "") refuse("DISPLAY_NAME_REQUIRED", "INVALID_INPUT", "displayName is required");
  return tx(pool, async (c) => {
    const company = await resolveOperatingCompany(c, actor.tenantId, input.operatingCompanyId);
    if (input.activate) {
      await c.query(`UPDATE eos_finance.accounting_destinations SET status = 'INACTIVE', updated_by = $3, updated_at = now()
                      WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`, [actor.tenantId, company, actor.principalId]);
    }
    const { rows } = await c.query(
      `INSERT INTO eos_finance.accounting_destinations (id, tenant_id, operating_company_id, display_name, provider_key, external_company_ref, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [`acd_${randomUUID()}`, actor.tenantId, company, input.displayName.trim(), input.providerKey ?? null, input.externalCompanyRef ?? null,
        input.activate ? "ACTIVE" : "INACTIVE", actor.principalId]);
    return destinationOf(rows[0]);
  });
}

/** The ACTIVE accounting destination of ONE operating company, or null (not configured). Never another company's. */
export async function resolveAccountingDestination(db: Queryable, tenantId: string, operatingCompanyId: unknown): Promise<AccountingDestination | null> {
  const company = await resolveOperatingCompany(db, tenantId, operatingCompanyId);
  const { rows } = await db.query(
    `SELECT * FROM eos_finance.accounting_destinations WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`, [tenantId, company]);
  return rows[0] ? destinationOf(rows[0]) : null;
}
