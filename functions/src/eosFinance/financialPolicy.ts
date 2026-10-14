// FINANCIAL POLICY FOUNDATION (DECISIONS #232, continuing the CERT-FIN-02 Owner ruling of 2026-09-03; migration 1764560000000).
//
// Each operating company's governed accounting-policy profile, in PostgreSQL, as VERSIONS with an approval lifecycle:
//
//     DRAFT --submit--> SUBMITTED --approve--> APPROVED --activate--> ACTIVE --(a later version activates)--> SUPERSEDED
//                                  \--reject---> REJECTED
//
// Served on /operations/finance (the Finance Closure transport) as seven operations, each behind its own PG-native key:
//
//   readFinancialPolicy            finance.policy.read      the version IN FORCE (or NOT_CONFIGURED), any SCHEDULED one, the one in flight
//   listFinancialPolicyVersions    finance.policy.read      the company's whole version history, newest first
//   saveFinancialPolicyDraft       finance.policy.prepare   create the company's next DRAFT, or edit the current one
//   submitFinancialPolicy          finance.policy.prepare   DRAFT -> SUBMITTED (the content freezes)
//   approveFinancialPolicy         finance.policy.approve   SUBMITTED -> APPROVED   (never by a preparer or the submitter)
//   rejectFinancialPolicy          finance.policy.approve   SUBMITTED -> REJECTED   (a reason; never by a preparer or the submitter)
//   activateFinancialPolicy        finance.policy.activate  APPROVED -> ACTIVE on a stated effective date; the prior ACTIVE
//                                                           version becomes SUPERSEDED in the same transaction, intact
//
// RULES, each enforced here AND by the database (migration 1764560000000), so a crafted request and a direct write meet the
// same refusal:
//   * COMPANY SCOPE. Every operation names one ACTIVE operating company of the caller's tenant. CONSOLIDATED, an unknown and an
//     inactive company are refused. Taylor and Ventana hold independent policies; a version id from another company is NOT_FOUND.
//     COMPANY-SCOPED AUTHORITY (#232 Amendment A): each finance.policy.* key applies only where the caller holds it -- a
//     GLOBAL assignment (or Administrator standing) reaches every company; an operatingCompany-scoped assignment reaches its
//     company only (SCOPE_EVALUABLE_GRANTS). The requested company is admitted BEFORE any version lookup; otherwise
//     OUTSIDE_OPERATING_COMPANY_SCOPE. Conditioned scoped holdings admit nothing. Separation of duties stays per version.
//   * FAIL CLOSED. A company with no version IN FORCE is NOT_CONFIGURED. Nothing here, or in resolveFinancialPolicyInForce,
//     ever substitutes a default method.
//   * VALIDATION is the pure domain module's (../finance/financialPolicyProfile, imported unchanged): supported methods only
//     (LIFO / STANDARD_COST / REPLACEMENT_COST do not exist), an AVAILABLE recognition point only (WORK_ORDER_CONSUMPTION
//     follows PHYSICAL_CONSUMPTION_ACTIVE), EXCLUDED freight / landed cost only, no unknown field. Re-checked at submit,
//     approval and activation, so a gate that closes after drafting stops activation.
//   * THE LOCK. ACTIVE and SUPERSEDED versions are immutable; REJECTED is final; content freezes when a version leaves DRAFT.
//     There is no unlock, reopen or force. A change is a governed REVISION: a new DRAFT through the same lifecycle.
//   * SEPARATION OF DUTIES. The approver / rejecter / ACTIVATOR is neither the submitter nor any principal who wrote the draft -- even if
//     that principal also holds finance.policy.approve.
//   * LIFECYCLE IS NOT EFFECTIVITY. Activating a version locks it and supersedes the prior ACTIVE one at once, but the version
//     IN FORCE on a business date is the latest ACTIVE / SUPERSEDED one dated on or before it; a future-dated ACTIVE version is
//     SCHEDULED. Consequence: while a version is scheduled, a correction must be dated after it (no cancel-scheduled path).
//   * EFFECTIVE DATE is stated at ACTIVATION (not approval): an approval may wait, and a date fixed earlier could lapse into
//     the past, leaving an approved version that can neither activate nor be edited. At activation it must not precede the
//     company's business date (eos_policy.operating_company_business_date) nor any earlier activated version's.
//   * REPLAY. Re-sending a command whose effect is already recorded (same caller, same content, same reason / note) returns the
//     recorded state with `replayed: true` and writes nothing; a differing note is FINANCIAL_POLICY_REPLAY_CONFLICT. Every change writes ONE eos_policy.audit_events row whose `after` is the
//     full version snapshot, so the version history can be rebuilt from the audit trail (rebuildFinancialPolicyVersions).
//
// No Firebase. The Firestore-era command (../finance/financialPolicyProfileCommand) is not used, read or extended.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  COGS_RECOGNITION_POINTS, COGS_RECOGNITION_POINT_IDS, FREIGHT_TREATMENTS, INVENTORY_COST_METHODS, LANDED_COST_TREATMENTS, PLATFORM_INVARIANTS,
  SERIALIZED_COST_METHODS, UNKNOWN_COST_TREATMENT, FinancialPolicyError, validateFinancialPolicyProfile, type CogsRecognitionPoint,
} from "../finance/financialPolicyProfile";
import { FinanceFoundationError, resolveOperatingCompany } from "./financeFoundation";
import { withActorAuthority } from "../eosOps/administrationReach";
import { admittedScopeValues, type ScopedHolding } from "../adminPolicy/assignmentScopeRuntime";
import { RESERVED_CAPABILITY_HOLDERS } from "../adminPolicy/roleCapabilityAdministration";
import { principalHasProtectedAdministratorStanding } from "../eosOps/administrationReach";
import { CommercialCommandError, requireReservedHolder } from "../eosCommercial/commands/commercialCommandKernel";

export const FINANCIAL_POLICY_READ_CAPABILITY = "finance.policy.read";
export const FINANCIAL_POLICY_PREPARE_CAPABILITY = "finance.policy.prepare";
export const FINANCIAL_POLICY_APPROVE_CAPABILITY = "finance.policy.approve";
export const FINANCIAL_POLICY_ACTIVATE_CAPABILITY = "finance.policy.activate";
export const FINANCIAL_POLICY_CAPABILITIES = Object.freeze([
  FINANCIAL_POLICY_READ_CAPABILITY, FINANCIAL_POLICY_PREPARE_CAPABILITY, FINANCIAL_POLICY_APPROVE_CAPABILITY, FINANCIAL_POLICY_ACTIVATE_CAPABILITY,
] as const);

export const FINANCIAL_POLICY_STATUSES = Object.freeze(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ACTIVE", "SUPERSEDED"] as const);
export type FinancialPolicyStatus = (typeof FINANCIAL_POLICY_STATUSES)[number];
/** Statuses that are LOCKED: no ordinary path changes them (ACTIVE admits only its supersession by a later activation). */
export const LOCKED_FINANCIAL_POLICY_STATUSES: readonly FinancialPolicyStatus[] = Object.freeze(["ACTIVE", "SUPERSEDED"]);

/** The audit trail's target kind for a version. */
export const FINANCIAL_POLICY_AUDIT_TARGET = "financial_policy_version";

/** The five policy fields a version carries -- the domain profile's deployment choices, nothing more. */
export const FINANCIAL_POLICY_FIELDS = Object.freeze([
  "inventoryCostMethod", "serializedInventoryCostMethod", "cogsRecognitionPointId", "freightTreatment", "landedCostTreatment",
] as const);

export type FinancialPolicyRefusalCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN";

export class FinancialPolicyRefusal extends Error {
  constructor(readonly code: string, readonly category: FinancialPolicyRefusalCategory, message: string) {
    super(message);
    this.name = "FinancialPolicyRefusal";
  }
}
const refuse = (code: string, category: FinancialPolicyRefusalCategory, message: string): never => {
  throw new FinancialPolicyRefusal(code, category, message);
};

export interface FinancialPolicyActor {
  readonly tenantId: string;
  readonly principalId: string;
  /** The flat (GLOBAL) capability set, including Protected Administrator standing. A flat key reaches every company. */
  readonly capabilities: ReadonlySet<string>;
  /**
   * Holdings from operatingCompany-SCOPED Security Role assignments (#232 Amendment A), as the transport resolved them
   * (caller.operational.scopedHeld). A scoped holding reaches only its company; a conditioned one reaches none.
   */
  readonly scopedHeld?: readonly ScopedHolding[];
}
export interface FinancialPolicyOptions {
  /** The recognition points and their availability. Defaults to the domain module's; injectable so the gate is testable. */
  readonly recognitionPoints?: readonly CogsRecognitionPoint[];
}

/**
 * COMPANY REACH (#232 Amendment A): where a policy capability applies. The CommercialWriteScope pattern, at operatingCompany
 * scope: a key in the flat set is held through a GLOBAL assignment (or standing) and reaches every company -- the current EOS
 * meaning of "All (Global)", pending the Owner's confirmation; otherwise it is held only for the companies its UNCONDITIONED
 * scoped holdings admit. Holding it nowhere is CAPABILITY_REQUIRED.
 */
interface CompanyReach { readonly key: string; readonly global: boolean; readonly companies: readonly string[] }
const requireCapability = (actor: FinancialPolicyActor, key: string): CompanyReach => {
  if (actor.capabilities.has(key)) return Object.freeze({ key, global: true, companies: Object.freeze([]) });
  const companies = admittedScopeValues(actor.scopedHeld, key, "operatingCompany");
  if (companies.length === 0) return refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${key}`);
  return Object.freeze({ key, global: false, companies });
};
/**
 * THE RUNTIME HALF OF THE RESERVATION (#232 Phase 1). finance.policy.approve / .activate are reserved to the Owner Role, and
 * the write path refuses every other grant -- but a row that bypassed it must not authorize either. So, like trade-in
 * approval, the key is exercised only through a qualifying global assignment of a reserved Role (the existing
 * requireReservedHolder). UNLIKE trade-in, Protected Administrator standing ALSO exercises it: trade-in is excluded from
 * standing (PROTECTED_ADMINISTRATOR_EXCLUSIONS), while #232 gives the Administrator approve / activate by standing.
 */
async function requireReservedAuthority(db: Db, actor: FinancialPolicyActor, key: string): Promise<void> {
  if (!RESERVED_CAPABILITY_HOLDERS.has(key)) return;
  if (await principalHasProtectedAdministratorStanding(db, actor.tenantId, actor.principalId)) return;
  try {
    await requireReservedHolder(db, actor.tenantId, actor.principalId, key);
  } catch (err) {
    if (err instanceof CommercialCommandError) refuse(err.code, "FORBIDDEN", err.message);
    throw err;
  }
}

/**
 * Decided on the RESOLVED company, before any version is looked up -- an out-of-scope company's versions never leak. For a
 * caller holding the key only at scope, OUT OF SCOPE == MISSING (the platform rule): an unknown, inactive or ACTIVE-but-
 * unadmitted company all get this same refusal, so a scoped holder cannot probe which companies exist.
 */
const outsideScope = (reach: CompanyReach, raw: unknown): never => refuse("OUTSIDE_OPERATING_COMPANY_SCOPE", "FORBIDDEN",
  `${reach.key} is not held for operating company ${JSON.stringify(typeof raw === "string" ? raw : null)}`);
const admitCompany = (reach: CompanyReach, company: string): void => {
  if (reach.global || reach.companies.includes(company)) return;
  outsideScope(reach, company);
};
const only = (input: Record<string, unknown>, allowed: readonly string[]): void => {
  for (const k of Object.keys(input)) if (!allowed.includes(k)) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
};
const requiredText = (v: unknown, name: string, max = 200): string => {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse("INVALID_INPUT", "INVALID_INPUT", `${name} is required`);
  return (v as string).trim();
};
const optionalText = (v: unknown, name: string, max = 1000): string | null =>
  v === undefined || v === null ? null : requiredText(v, name, max);

// ════════════════════ validation (the domain module's rules) ════════════════════

export interface FinancialPolicyContent {
  readonly inventoryCostMethod: string;
  readonly serializedInventoryCostMethod: string;
  readonly cogsRecognitionPointId: string;
  readonly freightTreatment: string;
  readonly landedCostTreatment: string;
}

/**
 * Validate a version's policy content through the pure domain validator, then against the recognition points' CURRENT
 * availability. Fail-closed: an unknown field, an unsupported method or an unavailable recognition point is refused, never
 * dropped or defaulted. `status` and `approval` are lifecycle, never content, and are refused here.
 */
export function validateFinancialPolicyContent(operatingCompanyId: string, raw: unknown, options: FinancialPolicyOptions = {}): FinancialPolicyContent {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) refuse("PROFILE_MALFORMED", "INVALID_INPUT", "policy must be an object");
  const policy = raw as Record<string, unknown>;
  const stray = Object.keys(policy).find((k) => !(FINANCIAL_POLICY_FIELDS as readonly string[]).includes(k));
  if (stray !== undefined) refuse("PROFILE_MALFORMED", "INVALID_INPUT", `unknown financial policy field: ${stray}`);
  let profile;
  try {
    profile = validateFinancialPolicyProfile({ ...policy, operatingCompanyId, status: "DRAFT" });
  } catch (err) {
    if (err instanceof FinancialPolicyError) {
      return refuse(err.code, err.code === "RECOGNITION_UNAVAILABLE" ? "PRECONDITION_FAILED" : "INVALID_INPUT", err.message);
    }
    throw err;
  }
  const points = options.recognitionPoints ?? COGS_RECOGNITION_POINTS;
  const point = points.find((p) => p.id === profile.cogsRecognitionPointId);
  if (!point || !point.available) {
    refuse("RECOGNITION_UNAVAILABLE", "PRECONDITION_FAILED", point?.blockedReason ?? `${profile.cogsRecognitionPointId} cannot be selected`);
  }
  return Object.freeze({
    inventoryCostMethod: profile.inventoryCostMethod,
    serializedInventoryCostMethod: profile.serializedInventoryCostMethod,
    cogsRecognitionPointId: profile.cogsRecognitionPointId,
    freightTreatment: profile.freightTreatment,
    landedCostTreatment: profile.landedCostTreatment,
  });
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function calendarDate(v: unknown, name = "effectiveDate"): string {
  const code = name === "effectiveDate" ? "EFFECTIVE_DATE_REQUIRED" : "DATE_INVALID";
  const m = typeof v === "string" ? ISO_DATE.exec(v) : null;
  if (!m) return refuse(code, "INVALID_INPUT", `${name} is a calendar date (YYYY-MM-DD)`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    refuse(code, "INVALID_INPUT", `${String(v)} is not a calendar date`);
  }
  return v as string;
}

// ════════════════════ the version snapshot ════════════════════

export interface FinancialPolicyVersion {
  readonly id: string;
  readonly operatingCompanyId: string;
  readonly versionNumber: number;
  readonly status: FinancialPolicyStatus;
  readonly locked: boolean;
  readonly policy: FinancialPolicyContent;
  readonly preparedBy: string;
  readonly preparedAt: string;
  readonly contentAuthors: readonly string[];
  readonly lastEditedBy: string;
  readonly lastEditedAt: string;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly decisionReason: string | null;
  readonly activatedBy: string | null;
  readonly activatedAt: string | null;
  readonly effectiveDate: string | null;
  readonly supersededByVersionId: string | null;
  readonly supersededAt: string | null;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
/** Every SELECT / RETURNING carries the DATE as text, so a snapshot never depends on the process time zone. */
const COLUMNS = `*, effective_date::text AS effective_date_text`;

export function versionView(r: Record<string, any>): FinancialPolicyVersion {
  const status = String(r.status) as FinancialPolicyStatus;
  return Object.freeze({
    id: String(r.id), operatingCompanyId: String(r.operating_company_id), versionNumber: Number(r.version_number), status,
    locked: (LOCKED_FINANCIAL_POLICY_STATUSES as readonly string[]).includes(status),
    policy: Object.freeze({
      inventoryCostMethod: String(r.inventory_cost_method), serializedInventoryCostMethod: String(r.serialized_inventory_cost_method),
      cogsRecognitionPointId: String(r.cogs_recognition_point), freightTreatment: String(r.freight_treatment), landedCostTreatment: String(r.landed_cost_treatment),
    }),
    preparedBy: String(r.prepared_by), preparedAt: iso(r.prepared_at) as string, contentAuthors: Object.freeze([...(r.content_authors ?? [])].map(String)),
    lastEditedBy: String(r.last_edited_by), lastEditedAt: iso(r.last_edited_at) as string,
    submittedBy: r.submitted_by ?? null, submittedAt: iso(r.submitted_at),
    approvedBy: r.approved_by ?? null, approvedAt: iso(r.approved_at),
    rejectedBy: r.rejected_by ?? null, rejectedAt: iso(r.rejected_at), decisionReason: r.decision_reason ?? null,
    activatedBy: r.activated_by ?? null, activatedAt: iso(r.activated_at), effectiveDate: r.effective_date_text ?? null,
    supersededByVersionId: r.superseded_by_version_id ?? null, supersededAt: iso(r.superseded_at),
  });
}

const sameContent = (a: FinancialPolicyContent, b: FinancialPolicyContent): boolean =>
  FINANCIAL_POLICY_FIELDS.every((f) => a[f] === b[f]);

// ════════════════════ plumbing ════════════════════

type Db = Pick<PoolClient, "query">;

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw translateDatabaseRefusal(err);
  } finally {
    c.release();
  }
}

/** The database's own CHECKs, by constraint name, for a write that raced past the server's checks. */
const CHECK_REFUSALS: Readonly<Record<string, readonly [string, FinancialPolicyRefusalCategory]>> = Object.freeze({
  financial_policy_approver_independent: ["SEPARATION_OF_DUTIES", "FORBIDDEN"],
  financial_policy_rejecter_independent: ["SEPARATION_OF_DUTIES", "FORBIDDEN"],
  financial_policy_activator_independent: ["SEPARATION_OF_DUTIES", "FORBIDDEN"],
});

/** The database's own refusals (the lock, the one-in-flight index, the CHECKs) answer as governed refusals, never as 500s. */
export function translateDatabaseRefusal(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e && e.code === "23505" && typeof e.constraint === "string" && e.constraint.startsWith("financial_policy_one_")) {
    return new FinancialPolicyRefusal("FINANCIAL_POLICY_IN_FLIGHT_EXISTS", "CONFLICT",
      "this operating company already has a financial policy version in flight; edit, submit or decide that one first");
  }
  if (e && (e.code === "23001" || e.code === "23514") && typeof e.message === "string") {
    const m = /^(FINANCIAL_POLICY_[A-Z_]+):/.exec(e.message);
    if (m) return new FinancialPolicyRefusal(m[1], "CONFLICT", e.message);
  }
  if (e && e.code === "23514" && typeof e.constraint === "string") {
    const known = CHECK_REFUSALS[e.constraint];
    if (known) return new FinancialPolicyRefusal(known[0], known[1], `refused by ${e.constraint}`);
    if (e.constraint.startsWith("financial_policy_")) {
      return new FinancialPolicyRefusal("FINANCIAL_POLICY_INVALID", "CONFLICT", `refused by ${e.constraint}`);
    }
  }
  return err;
}

async function companyOf(db: Db, actor: FinancialPolicyActor, raw: unknown, reach: CompanyReach): Promise<string> {
  try {
    const company = await resolveOperatingCompany(db, actor.tenantId, raw);
    admitCompany(reach, company);
    return company;
  } catch (err) {
    if (err instanceof FinanceFoundationError) {
      // CONSOLIDATED is refused for everyone, with its own code. Otherwise only a FLAT holder learns the company is unknown.
      if (err.code !== "CONSOLIDATED_NOT_A_COMPANY" && !reach.global) return outsideScope(reach, raw);
      return refuse(err.code === "CONSOLIDATED_NOT_A_COMPANY" ? err.code : "OPERATING_COMPANY_UNKNOWN", "INVALID_INPUT",
        "operatingCompanyId names one ACTIVE operating company of this tenant (never CONSOLIDATED)");
    }
    throw err;
  }
}

async function lockedVersion(c: Db, actor: FinancialPolicyActor, company: string, rawId: unknown): Promise<Record<string, any>> {
  const id = requiredText(rawId, "versionId");
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM eos_finance.financial_policy_versions WHERE tenant_id = $1 AND operating_company_id = $2 AND id = $3 FOR UPDATE`,
    [actor.tenantId, company, id]);
  return rows[0] ?? refuse("FINANCIAL_POLICY_VERSION_NOT_FOUND", "NOT_FOUND", "no financial policy version with that id for this operating company");
}

async function audit(c: Db, actor: FinancialPolicyActor, action: string, before: FinancialPolicyVersion | null, after: FinancialPolicyVersion,
  reason: string | null): Promise<void> {
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,clock_timestamp(),$9)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, FINANCIAL_POLICY_AUDIT_TARGET, after.id,
      before === null ? null : JSON.stringify(before), JSON.stringify(await withActorAuthority(c, actor.tenantId, actor.principalId, after)), reason]);
}

const lockedRefusal = (status: string): never => (LOCKED_FINANCIAL_POLICY_STATUSES as readonly string[]).includes(status)
  ? refuse("FINANCIAL_POLICY_LOCKED", "CONFLICT",
    `this financial policy version is ${status} and locked; a change is a governed revision -- a new draft, submitted, approved and activated`)
  : refuse("FINANCIAL_POLICY_NOT_EDITABLE", "CONFLICT", `a ${status} financial policy version is no longer editable; a change is a new version`);

// ════════════════════ reads ════════════════════

/** The company's business date (its governed time zone), as YYYY-MM-DD. */
async function businessDateOf(db: Db, tenantId: string, company: string): Promise<string> {
  const { rows } = await db.query(`SELECT eos_policy.operating_company_business_date($1, $2, now())::text AS d`, [tenantId, company]);
  return String(rows[0].d);
}

/**
 * THE consumer read: the policy IN FORCE for a company on a business date (default: the company's business date today), or
 * NOT_CONFIGURED. Never a default -- a caller that needs a cost method and receives NOT_CONFIGURED must refuse, exactly as an
 * UNKNOWN cost stays unknown.
 *
 * LIFECYCLE IS NOT EFFECTIVITY. Activation locks a version and supersedes the prior ACTIVE one at once, but a version governs
 * only from its own effective date. In force = the latest ACTIVE or SUPERSEDED version whose effective_date is on or before
 * the date (effective dates strictly increase across activations, and a SUPERSEDED row keeps its own). An ACTIVE version
 * dated after the date is SCHEDULED, not in force.
 */
export async function resolveFinancialPolicyInForce(db: Db, tenantId: string, operatingCompanyId: string, asOfDate?: string): Promise<
  { readonly state: "NOT_CONFIGURED"; readonly asOf: string; readonly policy: null; readonly version: null }
  | { readonly state: "IN_FORCE"; readonly asOf: string; readonly policy: FinancialPolicyContent; readonly version: FinancialPolicyVersion }> {
  const asOf = asOfDate === undefined ? await businessDateOf(db, tenantId, operatingCompanyId) : calendarDate(asOfDate, "asOfDate");
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM eos_finance.financial_policy_versions
      WHERE tenant_id = $1 AND operating_company_id = $2 AND status IN ('ACTIVE', 'SUPERSEDED') AND effective_date <= $3::date
      ORDER BY effective_date DESC LIMIT 1`, [tenantId, operatingCompanyId, asOf]);
  if (rows.length === 0) return Object.freeze({ state: "NOT_CONFIGURED" as const, asOf, policy: null, version: null });
  const version = versionView(rows[0]);
  return Object.freeze({ state: "IN_FORCE" as const, asOf, policy: version.policy, version });
}

/** What EOS supports, for the screen. The vocabularies are the domain module's; nothing here is a default. */
export function supportedFinancialPolicyVocabulary(options: FinancialPolicyOptions = {}) {
  return Object.freeze({
    inventoryCostMethods: [...INVENTORY_COST_METHODS], serializedCostMethods: [...SERIALIZED_COST_METHODS],
    cogsRecognitionPoints: (options.recognitionPoints ?? COGS_RECOGNITION_POINTS).map((p) => ({ id: p.id, label: p.label, available: p.available, blockedReason: p.blockedReason })),
    freightTreatments: [...FREIGHT_TREATMENTS], landedCostTreatments: [...LANDED_COST_TREATMENTS],
    unknownCostTreatment: UNKNOWN_COST_TREATMENT, platformInvariants: PLATFORM_INVARIANTS.map((i) => ({ ...i })),
  });
}

/**
 * The policy screen's read: `inForce` (the version governing on the business date, or null with state NOT_CONFIGURED),
 * `scheduled` (the ACTIVE version when it is dated after that date), and the version in flight. `asOfDate` reads another
 * business date; it defaults to the company's business date today.
 */
export async function readFinancialPolicy(pool: Pool, actor: FinancialPolicyActor, input: Record<string, unknown>, options: FinancialPolicyOptions = {}) {
  const reach = requireCapability(actor, FINANCIAL_POLICY_READ_CAPABILITY);
  only(input, ["operatingCompanyId", "asOfDate"]);
  const company = await companyOf(pool, actor, input.operatingCompanyId, reach);
  const inForce = await resolveFinancialPolicyInForce(pool, actor.tenantId, company,
    input.asOfDate === undefined || input.asOfDate === null ? undefined : calendarDate(input.asOfDate, "asOfDate"));
  const { rows: active } = await pool.query(
    `SELECT ${COLUMNS} FROM eos_finance.financial_policy_versions WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`,
    [actor.tenantId, company]);
  const scheduled = active[0] && String(active[0].effective_date_text) > inForce.asOf ? versionView(active[0]) : null;
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM eos_finance.financial_policy_versions
      WHERE tenant_id = $1 AND operating_company_id = $2 AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED')`, [actor.tenantId, company]);
  return Object.freeze({
    operatingCompanyId: company,
    asOf: inForce.asOf,
    state: inForce.state === "IN_FORCE" ? "CONFIGURED" as const : "NOT_CONFIGURED" as const,
    inForce: inForce.version,
    scheduled,
    inFlight: rows[0] ? versionView(rows[0]) : null,
    supported: supportedFinancialPolicyVocabulary(options),
  });
}

export async function listFinancialPolicyVersions(pool: Pool, actor: FinancialPolicyActor, input: Record<string, unknown>) {
  const reach = requireCapability(actor, FINANCIAL_POLICY_READ_CAPABILITY);
  only(input, ["operatingCompanyId"]);
  const company = await companyOf(pool, actor, input.operatingCompanyId, reach);
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM eos_finance.financial_policy_versions WHERE tenant_id = $1 AND operating_company_id = $2 ORDER BY version_number DESC`,
    [actor.tenantId, company]);
  return Object.freeze({ operatingCompanyId: company, items: rows.map(versionView) });
}

// ════════════════════ commands ════════════════════

type Outcome = Readonly<{ version: FinancialPolicyVersion; replayed: boolean }>;

/**
 * A replay is the SAME command: same caller, same content, same note. A re-send whose effect is recorded but whose stated
 * reason / note differs is refused (FINANCIAL_POLICY_REPLAY_CONFLICT), never answered `replayed: true` with the note dropped.
 */
async function assertSameReason(c: Db, actor: FinancialPolicyActor, versionId: string, actions: readonly string[], reason: string | null): Promise<void> {
  const { rows } = await c.query(
    `SELECT reason FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_kind = $2 AND target_id = $3 AND action = ANY ($4)
      ORDER BY occurred_at DESC, id DESC LIMIT 1`, [actor.tenantId, FINANCIAL_POLICY_AUDIT_TARGET, versionId, [...actions]]);
  const recorded = rows[0]?.reason ?? null;
  if (recorded !== reason) {
    refuse("FINANCIAL_POLICY_REPLAY_CONFLICT", "CONFLICT",
      "this command's effect is already recorded with a different reason / note; the recorded one stands and a new note is not added silently");
  }
}
const CONTENT_ACTIONS = Object.freeze(["finance.policy.draft.create", "finance.policy.draft.edit"]);
const outcome = (row: Record<string, any>, replayed: boolean): Outcome => Object.freeze({ version: versionView(row), replayed });

/**
 * Create the company's next DRAFT (no versionId) or edit its current DRAFT (versionId). Replay: re-sending identical content
 * returns the draft unchanged. A company has at most one version in flight; a second create is refused while one exists.
 */
export async function saveFinancialPolicyDraft(pool: Pool, actor: FinancialPolicyActor, input: Record<string, unknown>,
  options: FinancialPolicyOptions = {}): Promise<Outcome> {
  const reach = requireCapability(actor, FINANCIAL_POLICY_PREPARE_CAPABILITY);
  only(input, ["operatingCompanyId", "versionId", "policy", "reason"]);
  const reason = optionalText(input.reason, "reason");
  return tx(pool, async (c) => {
    const company = await companyOf(c, actor, input.operatingCompanyId, reach);
    const content = validateFinancialPolicyContent(company, input.policy, options);
    if (input.versionId === undefined || input.versionId === null) {
      // Serialize creation per company: the version number is the company's next, and the in-flight index has the final word.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('eos_finance.financial_policy_versions'), hashtext($1 || '/' || $2))`, [actor.tenantId, company]);
      const { rows: open } = await c.query(
        `SELECT ${COLUMNS} FROM eos_finance.financial_policy_versions
          WHERE tenant_id = $1 AND operating_company_id = $2 AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED') FOR UPDATE`, [actor.tenantId, company]);
      if (open[0]) {
        const existing = versionView(open[0]);
        if (existing.status === "DRAFT" && existing.lastEditedBy === actor.principalId && sameContent(existing.policy, content)) {
          await assertSameReason(c, actor, existing.id, CONTENT_ACTIONS, reason);
          return outcome(open[0], true);
        }
        refuse("FINANCIAL_POLICY_IN_FLIGHT_EXISTS", "CONFLICT",
          `version ${existing.versionNumber} (${existing.status}) is in flight for ${company}; edit, submit or decide that one first`);
      }
      const { rows: n } = await c.query(
        `SELECT COALESCE(max(version_number), 0) + 1 AS next FROM eos_finance.financial_policy_versions WHERE tenant_id = $1 AND operating_company_id = $2`,
        [actor.tenantId, company]);
      const { rows } = await c.query(
        `INSERT INTO eos_finance.financial_policy_versions (id, tenant_id, operating_company_id, version_number, status, inventory_cost_method,
           serialized_inventory_cost_method, cogs_recognition_point, freight_treatment, landed_cost_treatment, prepared_by, content_authors, last_edited_by)
         VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,ARRAY[$10],$10) RETURNING ${COLUMNS}`,
        [`fpv_${randomUUID()}`, actor.tenantId, company, Number(n[0].next), content.inventoryCostMethod, content.serializedInventoryCostMethod,
          content.cogsRecognitionPointId, content.freightTreatment, content.landedCostTreatment, actor.principalId]);
      const created = versionView(rows[0]);
      await audit(c, actor, "finance.policy.draft.create", null, created, reason);
      return outcome(rows[0], false);
    }
    const row = await lockedVersion(c, actor, company, input.versionId);
    const before = versionView(row);
    if (before.status !== "DRAFT") lockedRefusal(before.status);
    // Identical content is a replay whoever sends it: nothing is written and no one becomes a content author.
    if (sameContent(before.policy, content)) {
      await assertSameReason(c, actor, before.id, CONTENT_ACTIONS, reason);
      return outcome(row, true);
    }
    const { rows } = await c.query(
      `UPDATE eos_finance.financial_policy_versions
          SET inventory_cost_method = $3, serialized_inventory_cost_method = $4, cogs_recognition_point = $5, freight_treatment = $6,
              landed_cost_treatment = $7, last_edited_by = $8, last_edited_at = now(), updated_at = now(),
              content_authors = CASE WHEN $8 = ANY (content_authors) THEN content_authors ELSE content_authors || $8 END
        WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
      [actor.tenantId, before.id, content.inventoryCostMethod, content.serializedInventoryCostMethod, content.cogsRecognitionPointId,
        content.freightTreatment, content.landedCostTreatment, actor.principalId]);
    await audit(c, actor, "finance.policy.draft.edit", before, versionView(rows[0]), reason);
    return outcome(rows[0], false);
  });
}

/** DRAFT -> SUBMITTED. The content freezes; it is re-validated first. */
export async function submitFinancialPolicy(pool: Pool, actor: FinancialPolicyActor, input: Record<string, unknown>,
  options: FinancialPolicyOptions = {}): Promise<Outcome> {
  const reach = requireCapability(actor, FINANCIAL_POLICY_PREPARE_CAPABILITY);
  only(input, ["operatingCompanyId", "versionId", "reason"]);
  const reason = optionalText(input.reason, "reason");
  return tx(pool, async (c) => {
    const company = await companyOf(c, actor, input.operatingCompanyId, reach);
    const row = await lockedVersion(c, actor, company, input.versionId);
    const before = versionView(row);
    if (before.status === "SUBMITTED" && before.submittedBy === actor.principalId) {
      await assertSameReason(c, actor, before.id, ["finance.policy.submit"], reason);
      return outcome(row, true);
    }
    if (before.status !== "DRAFT") lockedRefusal(before.status);
    validateFinancialPolicyContent(company, before.policy, options);
    const { rows } = await c.query(
      `UPDATE eos_finance.financial_policy_versions SET status = 'SUBMITTED', submitted_by = $3, submitted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`, [actor.tenantId, before.id, actor.principalId]);
    await audit(c, actor, "finance.policy.submit", before, versionView(rows[0]), reason);
    return outcome(rows[0], false);
  });
}

/** Approve, reject AND activate (#232 Phase 1): never by the submitter or anyone who wrote the content. The approver may activate. */
function assertIndependentDecider(actor: FinancialPolicyActor, v: FinancialPolicyVersion): void {
  if (v.submittedBy === actor.principalId || v.contentAuthors.includes(actor.principalId)) {
    refuse("SEPARATION_OF_DUTIES", "FORBIDDEN",
      "a financial policy version is approved, rejected or activated by someone other than the principal who prepared, edited or submitted it");
  }
}

/** SUBMITTED -> APPROVED, by an independent approver. An optional note is kept as the decision reason. */
export async function approveFinancialPolicy(pool: Pool, actor: FinancialPolicyActor, input: Record<string, unknown>,
  options: FinancialPolicyOptions = {}): Promise<Outcome> {
  const reach = requireCapability(actor, FINANCIAL_POLICY_APPROVE_CAPABILITY);
  only(input, ["operatingCompanyId", "versionId", "reason"]);
  const reason = optionalText(input.reason, "reason");
  return tx(pool, async (c) => {
    await requireReservedAuthority(c, actor, FINANCIAL_POLICY_APPROVE_CAPABILITY);
    const company = await companyOf(c, actor, input.operatingCompanyId, reach);
    const row = await lockedVersion(c, actor, company, input.versionId);
    const before = versionView(row);
    if (before.status === "APPROVED" && before.approvedBy === actor.principalId) {
      if (before.decisionReason !== reason) {
        refuse("FINANCIAL_POLICY_REPLAY_CONFLICT", "CONFLICT", "this version is already approved by you with a different note; the recorded one stands");
      }
      return outcome(row, true);
    }
    if (before.status !== "SUBMITTED") {
      refuse("FINANCIAL_POLICY_NOT_SUBMITTED", "CONFLICT", `only a SUBMITTED version is approved; this one is ${before.status}`);
    }
    assertIndependentDecider(actor, before);
    validateFinancialPolicyContent(company, before.policy, options);
    const { rows } = await c.query(
      `UPDATE eos_finance.financial_policy_versions SET status = 'APPROVED', approved_by = $3, approved_at = now(), decision_reason = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`, [actor.tenantId, before.id, actor.principalId, reason]);
    await audit(c, actor, "finance.policy.approve", before, versionView(rows[0]), reason);
    return outcome(rows[0], false);
  });
}

/** SUBMITTED -> REJECTED (final), by an independent decider, with a stated reason. A change is then a new draft. */
export async function rejectFinancialPolicy(pool: Pool, actor: FinancialPolicyActor, input: Record<string, unknown>): Promise<Outcome> {
  const reach = requireCapability(actor, FINANCIAL_POLICY_APPROVE_CAPABILITY);
  only(input, ["operatingCompanyId", "versionId", "reason"]);
  if (typeof input.reason !== "string" || input.reason.trim() === "") refuse("REASON_REQUIRED", "INVALID_INPUT", "a rejection states its reason");
  const reason = requiredText(input.reason, "reason", 1000);
  return tx(pool, async (c) => {
    await requireReservedAuthority(c, actor, FINANCIAL_POLICY_APPROVE_CAPABILITY);
    const company = await companyOf(c, actor, input.operatingCompanyId, reach);
    const row = await lockedVersion(c, actor, company, input.versionId);
    const before = versionView(row);
    if (before.status === "REJECTED" && before.rejectedBy === actor.principalId) {
      if (before.decisionReason !== reason) {
        refuse("FINANCIAL_POLICY_REPLAY_CONFLICT", "CONFLICT", "this version is already rejected by you with a different reason; the recorded one stands");
      }
      return outcome(row, true);
    }
    if (before.status !== "SUBMITTED") {
      refuse("FINANCIAL_POLICY_NOT_SUBMITTED", "CONFLICT", `only a SUBMITTED version is rejected; this one is ${before.status}`);
    }
    assertIndependentDecider(actor, before);
    const { rows } = await c.query(
      `UPDATE eos_finance.financial_policy_versions SET status = 'REJECTED', rejected_by = $3, rejected_at = now(), decision_reason = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`, [actor.tenantId, before.id, actor.principalId, reason]);
    await audit(c, actor, "finance.policy.reject", before, versionView(rows[0]), reason);
    return outcome(rows[0], false);
  });
}

/**
 * APPROVED -> ACTIVE on a stated effective date (the company's business date or later, and after every earlier activated
 * version). The prior ACTIVE version, if any, becomes SUPERSEDED in the SAME transaction and is otherwise untouched.
 */
export async function activateFinancialPolicy(pool: Pool, actor: FinancialPolicyActor, input: Record<string, unknown>,
  options: FinancialPolicyOptions = {}): Promise<Outcome & { readonly superseded: FinancialPolicyVersion | null }> {
  const reach = requireCapability(actor, FINANCIAL_POLICY_ACTIVATE_CAPABILITY);
  only(input, ["operatingCompanyId", "versionId", "effectiveDate", "reason"]);
  const reason = optionalText(input.reason, "reason");
  const effectiveDate = calendarDate(input.effectiveDate);
  return tx(pool, async (c) => {
    await requireReservedAuthority(c, actor, FINANCIAL_POLICY_ACTIVATE_CAPABILITY);
    const company = await companyOf(c, actor, input.operatingCompanyId, reach);
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('eos_finance.financial_policy_versions'), hashtext($1 || '/' || $2))`, [actor.tenantId, company]);
    const row = await lockedVersion(c, actor, company, input.versionId);
    const before = versionView(row);
    if (before.status === "ACTIVE" && before.activatedBy === actor.principalId && before.effectiveDate === effectiveDate) {
      await assertSameReason(c, actor, before.id, ["finance.policy.activate"], reason);
      return Object.freeze({ ...outcome(row, true), superseded: null });
    }
    if (before.status !== "APPROVED") {
      if (before.status === "ACTIVE" || before.status === "SUPERSEDED") lockedRefusal(before.status);
      refuse("FINANCIAL_POLICY_NOT_APPROVED", "CONFLICT", `only an APPROVED version is activated; this one is ${before.status}`);
    }
    assertIndependentDecider(actor, before);
    validateFinancialPolicyContent(company, before.policy, options);
    const today = await businessDateOf(c, actor.tenantId, company);
    if (effectiveDate < today) {
      refuse("EFFECTIVE_DATE_PAST", "INVALID_INPUT", `effectiveDate ${effectiveDate} precedes ${company}'s business date ${today}`);
    }
    const { rows: prior } = await c.query(
      `SELECT ${COLUMNS} FROM eos_finance.financial_policy_versions WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE' FOR UPDATE`,
      [actor.tenantId, company]);
    let superseded: FinancialPolicyVersion | null = null;
    if (prior[0]) {
      const priorView = versionView(prior[0]);
      if (priorView.effectiveDate !== null && effectiveDate <= priorView.effectiveDate) {
        refuse("EFFECTIVE_DATE_NOT_AFTER_PRIOR", "INVALID_INPUT",
          `effectiveDate ${effectiveDate} must follow the current active version's effective date ${priorView.effectiveDate}`);
      }
      const { rows: sup } = await c.query(
        `UPDATE eos_finance.financial_policy_versions SET status = 'SUPERSEDED', superseded_by_version_id = $3, superseded_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`, [actor.tenantId, priorView.id, before.id]);
      superseded = versionView(sup[0]);
      await audit(c, actor, "finance.policy.supersede", priorView, superseded, reason);
    }
    const { rows } = await c.query(
      `UPDATE eos_finance.financial_policy_versions SET status = 'ACTIVE', activated_by = $3, activated_at = now(), effective_date = $4::date, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${COLUMNS}`, [actor.tenantId, before.id, actor.principalId, effectiveDate]);
    await audit(c, actor, "finance.policy.activate", before, versionView(rows[0]), reason);
    return Object.freeze({ ...outcome(rows[0], false), superseded });
  });
}

// ════════════════════ history ════════════════════

export interface FinancialPolicyAuditEvent {
  readonly action: string;
  readonly targetId: string;
  readonly before: unknown;
  readonly after: unknown;
}

const withoutAuthority = (v: unknown): unknown => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  const { authorizedBy: _a, ...rest } = v as Record<string, unknown>;
  void _a;
  return rest;
};

/**
 * Rebuild every version's state from its audit trail alone (events in recorded order). Each event's `before` must equal the
 * state the previous event left -- a broken chain throws rather than producing a plausible history.
 */
export function rebuildFinancialPolicyVersions(events: readonly FinancialPolicyAuditEvent[]): ReadonlyMap<string, unknown> {
  const state = new Map<string, unknown>();
  for (const e of events) {
    const prior = state.has(e.targetId) ? state.get(e.targetId) : null;
    const before = withoutAuthority(e.before ?? null);
    if (JSON.stringify(before) !== JSON.stringify(prior)) {
      throw new Error(`FINANCIAL_POLICY_HISTORY_BROKEN: ${e.action} on ${e.targetId} does not continue the recorded state`);
    }
    state.set(e.targetId, withoutAuthority(e.after));
  }
  return state;
}

// ════════════════════ the /operations/finance adapters ════════════════════

interface Caller {
  readonly actor: Omit<FinancialPolicyActor, "scopedHeld">;
  readonly operational?: { readonly scopedHeld?: readonly ScopedHolding[] };
}
/** The flat set AND the operatingCompany-scoped holdings the transport resolved (#232 Amendment A). */
const actorOf = (caller: Caller): FinancialPolicyActor => ({ ...caller.actor, scopedHeld: caller.operational?.scopedHeld });
type Op = (deps: { readonly pool: Pool }, caller: Caller, input: Record<string, unknown>) => Promise<unknown>;

export const EOS_FINANCIAL_POLICY_OPERATIONS: Readonly<Record<string, Op>> = Object.freeze({
  readFinancialPolicy: (deps, caller, input) => readFinancialPolicy(deps.pool, actorOf(caller), input),
  listFinancialPolicyVersions: (deps, caller, input) => listFinancialPolicyVersions(deps.pool, actorOf(caller), input),
  saveFinancialPolicyDraft: (deps, caller, input) => saveFinancialPolicyDraft(deps.pool, actorOf(caller), input),
  submitFinancialPolicy: (deps, caller, input) => submitFinancialPolicy(deps.pool, actorOf(caller), input),
  approveFinancialPolicy: (deps, caller, input) => approveFinancialPolicy(deps.pool, actorOf(caller), input),
  rejectFinancialPolicy: (deps, caller, input) => rejectFinancialPolicy(deps.pool, actorOf(caller), input),
  activateFinancialPolicy: (deps, caller, input) => activateFinancialPolicy(deps.pool, actorOf(caller), input),
});

/** The recognition-point ids the domain knows, re-exported for the client mirror test. */
export const FINANCIAL_POLICY_RECOGNITION_POINT_IDS = COGS_RECOGNITION_POINT_IDS;
