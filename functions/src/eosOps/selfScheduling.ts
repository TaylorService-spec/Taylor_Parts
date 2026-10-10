// CUSTOMER SELF-SCHEDULING (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment C).
//
//     eligible Work Order -> governed scheduling session -> slots from THE availability engine inside the governed
//     window -> the customer selects one -> EOS revalidates it -> the governed scheduleWorkOrder command -> the SAME
//     Work Order scheduling domain the Service Office reads. No second engine, no customer-only schedule record, no
//     later synchronization job.
//
// ════════════════════ THE GOVERNED WINDOW ════════════════════
//
// eos_ops.self_scheduling_policies (migration 1764370000000), configured through workOrder.selfScheduling.configure:
// the EARLIEST offered slot (now + earliest_offset_minutes) and the MAXIMUM horizon (now + horizon_days), the default
// visit length, the grid, the link lifetime and the zone the customer reads times in. The most specific enabled
// policy applies -- (company, type) > (company, any) > (any, type) > (any, any) -- and with none, self-scheduling is
// refused SELF_SCHEDULING_NOT_CONFIGURED. There is no built-in window.
//
// A slot is offered only when ALL of these pass, and every one is the availability engine's own rule
// (workOrderAvailability.computeTechnicianSlots): Work Order READY_TO_DISPATCH, unassigned, not quarantined; the
// company ACTIVE and keyed; the job type's qualification (QUALIFICATION_BY_WORK_ORDER_TYPE, SERVICE_TECHNICIAN); an
// eligible, linked, ACTIVE / CONTRACTOR Technician Employee; inside configured working hours; no time off; no
// overlapping Work Order; inside the earliest boundary and the horizon; the whole visit fits.
//
// ════════════════════ THE SESSION ════════════════════
//
// No EOS login. A 32-byte random token, shown ONCE at issue; only its sha256 is stored, and the lookup is by that
// hash. It is bound to ONE Work Order and ONE purpose, it expires, it is single-use, and issuing another SUPERSEDES
// it. The customer input is closed ({ token } / { token, slotStart }): there is no Work Order, tenant, customer or
// Technician identifier to tamper with, and the projection returns none of them.
//
// ════════════════════ DISPLAYED IS NOT RESERVED ════════════════════
//
// At selection EOS re-reads EVERYTHING -- the session, the Work Order's state, the current policy, the issuer's current
// authority -- recomputes the slots, and places the Work Order through scheduleWorkOrder, which takes the per-Employee
// placement lock and re-checks availability and overlap itself. Two customers racing for the one Technician who can
// take a window: the lock serializes them, the second is refused SCHEDULE_CONFLICT, and (if no other eligible
// Technician can take that exact window) the customer is refused SLOT_NO_LONGER_AVAILABLE with REFRESHED choices.
// A stale page can never double-book.
//
// ════════════════════ WHOSE AUTHORITY PLACES THE WORK ORDER ════════════════════
//
// The issuer's. The link was issued by a Principal holding workOrder.selfScheduling.issue AND
// workOrder.lifecycle.schedule, and the booking runs as that Principal -- RE-RESOLVED at selection: an issuer who has
// since lost either capability, membership or activity cannot book, and the session is refused.
//
// NOT BUILT (future business decisions, never invented): customer CANCELLATION, and customer RESCHEDULING of an
// already-scheduled visit. Session generation is separate from MESSAGE DELIVERY: the link is produced through the EOS
// API and delivered by whatever channel is later governed (no outbound email/SMS here, no Mail.Send).
import type { Pool, PoolClient } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PolicyReader } from "../adminPolicy/policyRepository";
import type { WorkOrderOp, WorkOrderOperationDeps } from "./workOrderOperationTypes";
import { WorkOrderLifecycleError, WORK_ORDER_LIFECYCLE_SCHEDULE, type LifecycleActor } from "./workOrderLifecycle";
import { scheduleWorkOrder } from "./workOrderScheduling";
import {
  QUALIFICATION_BY_WORK_ORDER_TYPE, SLOT_INCREMENTS_MINUTES, computeTechnicianSlots, isValidTimeZone, type TechnicianSlot,
} from "./workOrderAvailability";
import { OperatingCompanyBindingError, resolveActiveOperatingCompanyId } from "./operatingCompanyBinding";
import { isQuarantined } from "./workOrderQuarantine";
import { resolveOperationalContextForPrincipal } from "./capabilityAuthority";
import { postgresGrantConditionProvider } from "./entitledActionAuthority";
import { withActorAuthority } from "./administrationReach";

export const SELF_SCHEDULING_ISSUE = "workOrder.selfScheduling.issue";
export const SELF_SCHEDULING_CONFIGURE = "workOrder.selfScheduling.configure";
export const SELF_SCHEDULING_ROUTE = "/public/self-scheduling";
export const SELF_SCHEDULING_SYSTEM_ACTOR = "system-self-scheduling";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WORK_ORDER_TYPES = Object.keys(QUALIFICATION_BY_WORK_ORDER_TYPE);
/** The refusals placement may answer for ONE Technician; the next eligible Technician for the window is tried. */
const PER_TECHNICIAN_REFUSALS = new Set(["SCHEDULE_CONFLICT", "DOUBLE_BOOKED", "TECHNICIAN_UNAVAILABLE", "OUTSIDE_WORKING_HOURS",
  "AVAILABILITY_NOT_CONFIGURED", "EMPLOYEE_NOT_ASSIGNABLE", "EMPLOYEE_NOT_FOUND"]);

type Category = WorkOrderLifecycleError["category"];
export class SelfSchedulingError extends WorkOrderLifecycleError {
  /** Refreshed choices a stale selection returns with its refusal. */
  refreshed: unknown = null;
}
const refuse = (code: string, category: Category, message: string, refreshed: unknown = null): never => {
  const e = new SelfSchedulingError(code, category, message);
  e.name = "WorkOrderLifecycleError";
  e.refreshed = refreshed;
  throw e;
};

const ID_SHAPE = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
function only(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input as object).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this operation does not accept: ${extra.sort().join(", ")}`);
  return input as Record<string, unknown>;
}
function requireAll(actor: LifecycleActor, keys: readonly string[], what: string): void {
  if (!(actor.capabilities instanceof Set) || !keys.every((k) => actor.capabilities.has(k))) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `${what} requires ${keys.join(" and ")}`);
  }
}
async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
async function audit(c: PoolClient, tenantId: string, actorUid: string, action: string, targetKind: string, targetId: string,
  after: unknown, reason: string | null, at: Date): Promise<string> {
  const id = `audit_${randomUUID()}`;
  await c.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
                 VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::jsonb,$8,$9)`,
    [id, tenantId, action, actorUid, targetKind, targetId, JSON.stringify(await withActorAuthority(c, tenantId, actorUid, after)), at, reason]);
  return id;
}
async function sessionEvent(c: Pick<PoolClient, "query">, tenantId: string, sessionId: string, kind: string, detail: unknown, at: Date): Promise<void> {
  await c.query(`INSERT INTO eos_ops.self_scheduling_session_events (id, tenant_id, session_id, event_kind, detail, occurred_at)
                 VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [`sse_${randomUUID()}`, tenantId, sessionId, kind, JSON.stringify(detail ?? {}), at]);
}
export const tokenHash = (token: string): string => createHash("sha256").update(String(token)).digest("hex");

// ════════════════════ policy ════════════════════

export interface SelfSchedulingPolicy {
  readonly policyId: string;
  readonly operatingCompanyId: string | null;
  readonly workOrderType: string | null;
  readonly enabled: boolean;
  readonly earliestOffsetMinutes: number;
  readonly horizonDays: number;
  readonly defaultDurationMinutes: number | null;
  readonly slotIncrementMinutes: number;
  readonly maxOfferedSlots: number;
  readonly sessionTtlMinutes: number;
  readonly timeZone: string;
  readonly version: number;
}
const policyFromRow = (r: Record<string, unknown>): SelfSchedulingPolicy => Object.freeze({
  policyId: String(r.id), operatingCompanyId: (r.operating_company_id as string | null) ?? null, workOrderType: (r.work_order_type as string | null) ?? null,
  enabled: r.enabled === true, earliestOffsetMinutes: Number(r.earliest_offset_minutes), horizonDays: Number(r.horizon_days),
  defaultDurationMinutes: r.default_duration_minutes === null ? null : Number(r.default_duration_minutes),
  slotIncrementMinutes: Number(r.slot_increment_minutes), maxOfferedSlots: Number(r.max_offered_slots), sessionTtlMinutes: Number(r.session_ttl_minutes),
  timeZone: String(r.time_zone), version: Number(r.version),
});

/** The most specific policy for (company, type). Disabled means none: a disabled specific policy is not skipped past. */
export async function applicablePolicy(db: Pick<PoolClient, "query">, tenantId: string, companyId: string, workOrderType: string): Promise<SelfSchedulingPolicy | null> {
  const { rows } = await db.query(
    `SELECT * FROM eos_ops.self_scheduling_policies
      WHERE tenant_id = $1 AND (operating_company_id IS NULL OR operating_company_id = $2) AND (work_order_type IS NULL OR work_order_type = $3)
      ORDER BY (operating_company_id IS NULL), (work_order_type IS NULL) LIMIT 1`, [tenantId, companyId, workOrderType]);
  if (rows.length === 0) return null;
  const p = policyFromRow(rows[0]);
  return p.enabled ? p : null;
}

const POLICY_INPUT = ["policyId", "operatingCompanyId", "workOrderType", "enabled", "earliestOffsetMinutes", "horizonDays", "defaultDurationMinutes",
  "slotIncrementMinutes", "maxOfferedSlots", "sessionTtlMinutes", "timeZone"];
const intIn = (v: unknown, lo: number, hi: number, field: string): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < lo || v > hi) refuse("POLICY_INVALID", "INVALID_INPUT", `${field} is a whole number ${lo}..${hi}`);
  return v as number;
};

/** Create or change one self-scheduling policy. ADMINISTRATIVE CONFIGURATION (workOrder.selfScheduling.configure), audited, versioned. */
export async function saveSelfSchedulingPolicy(deps: { readonly pool: Pool; readonly now?: () => Date }, actor: LifecycleActor, raw: unknown) {
  requireAll(actor, [SELF_SCHEDULING_CONFIGURE], "configuring customer self-scheduling");
  const i = only(raw, POLICY_INPUT);
  const company = i.operatingCompanyId === undefined || i.operatingCompanyId === null ? null : i.operatingCompanyId;
  if (company !== null && !ID_SHAPE(company)) refuse("POLICY_INVALID", "INVALID_INPUT", "operatingCompanyId is a governed operating company id, or omitted for every company");
  const type = i.workOrderType === undefined || i.workOrderType === null ? null : i.workOrderType;
  if (type !== null && !WORK_ORDER_TYPES.includes(type as string)) refuse("POLICY_INVALID", "INVALID_INPUT", `workOrderType is one of ${WORK_ORDER_TYPES.join(", ")}, or omitted`);
  if (i.enabled !== undefined && typeof i.enabled !== "boolean") refuse("POLICY_INVALID", "INVALID_INPUT", "enabled is a boolean");
  const earliest = intIn(i.earliestOffsetMinutes, 0, 43200, "earliestOffsetMinutes");
  const horizon = intIn(i.horizonDays, 1, 60, "horizonDays");
  if (earliest >= horizon * 1440) refuse("POLICY_WINDOW_EMPTY", "INVALID_INPUT", "the earliest offered slot must fall before the maximum horizon");
  const duration = i.defaultDurationMinutes === undefined || i.defaultDurationMinutes === null ? null : intIn(i.defaultDurationMinutes, 15, 1440, "defaultDurationMinutes");
  const increment = i.slotIncrementMinutes === undefined ? 30 : i.slotIncrementMinutes;
  if (!(SLOT_INCREMENTS_MINUTES as readonly unknown[]).includes(increment)) refuse("POLICY_INVALID", "INVALID_INPUT", `slotIncrementMinutes is one of ${SLOT_INCREMENTS_MINUTES.join(", ")}`);
  const maxSlots = i.maxOfferedSlots === undefined ? 40 : intIn(i.maxOfferedSlots, 1, 200, "maxOfferedSlots");
  const ttl = intIn(i.sessionTtlMinutes, 15, 20160, "sessionTtlMinutes");
  if (!isValidTimeZone(i.timeZone)) refuse("POLICY_INVALID", "INVALID_INPUT", "timeZone is an IANA time zone");
  const now = (deps.now ?? (() => new Date()))();
  return inTransaction(deps.pool, async (c) => {
    if (company !== null) {
      const oc = await c.query(`SELECT 1 FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`,
        [actor.tenantId, company]);
      if (oc.rows.length === 0) refuse("OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", `'${String(company)}' is not an ACTIVE operating company of this tenant`);
    }
    const existing = await c.query(
      `SELECT * FROM eos_ops.self_scheduling_policies WHERE tenant_id = $1 AND COALESCE(operating_company_id, '') = COALESCE($2, '')
          AND COALESCE(work_order_type, '') = COALESCE($3, '') FOR UPDATE`, [actor.tenantId, company, type]);
    if (i.policyId !== undefined && existing.rows.length && existing.rows[0].id !== i.policyId) {
      refuse("POLICY_SCOPE_TAKEN", "CONFLICT", "another policy already governs this company and Work Order type");
    }
    const id = existing.rows.length ? existing.rows[0].id : (ID_SHAPE(i.policyId) && /^[A-Za-z0-9_-]{1,120}$/.test(i.policyId as string) ? i.policyId : `ssp_${randomUUID().replace(/-/g, "")}`);
    const { rows } = await c.query(
      `INSERT INTO eos_ops.self_scheduling_policies
         (tenant_id, id, operating_company_id, work_order_type, enabled, earliest_offset_minutes, horizon_days, default_duration_minutes,
          slot_increment_minutes, max_offered_slots, session_ttl_minutes, time_zone, updated_by_principal_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       ON CONFLICT (tenant_id, id) DO UPDATE SET enabled = EXCLUDED.enabled, earliest_offset_minutes = EXCLUDED.earliest_offset_minutes,
         horizon_days = EXCLUDED.horizon_days, default_duration_minutes = EXCLUDED.default_duration_minutes,
         slot_increment_minutes = EXCLUDED.slot_increment_minutes, max_offered_slots = EXCLUDED.max_offered_slots,
         session_ttl_minutes = EXCLUDED.session_ttl_minutes, time_zone = EXCLUDED.time_zone,
         updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = EXCLUDED.updated_at, version = self_scheduling_policies.version + 1
       RETURNING *`,
      [actor.tenantId, id, company, type, i.enabled ?? true, earliest, horizon, duration, increment, maxSlots, ttl, i.timeZone, actor.principalId, now]);
    const saved = policyFromRow(rows[0]);
    await audit(c, actor.tenantId, actor.principalId, "workOrder.selfScheduling.policy.save", "selfSchedulingPolicy", saved.policyId, saved, null, now);
    return saved;
  });
}

export async function listSelfSchedulingPolicies(deps: { readonly pool: Pool }, actor: LifecycleActor, raw: unknown) {
  only(raw ?? {}, []);
  if (!(actor.capabilities instanceof Set) || ![SELF_SCHEDULING_CONFIGURE, SELF_SCHEDULING_ISSUE].some((k) => actor.capabilities.has(k))) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `reading self-scheduling policies requires ${SELF_SCHEDULING_CONFIGURE} or ${SELF_SCHEDULING_ISSUE}`);
  }
  const { rows } = await deps.pool.query(`SELECT * FROM eos_ops.self_scheduling_policies WHERE tenant_id = $1
                                           ORDER BY operating_company_id NULLS LAST, work_order_type NULLS LAST, id`, [actor.tenantId]);
  return Object.freeze({ policies: rows.map(policyFromRow) });
}

// ════════════════════ the Work Order a session may schedule ════════════════════

interface SchedulableWorkOrder {
  readonly id: string;
  readonly status: string;
  readonly type: string;
  readonly companyKey: string;
  readonly companyId: string;
  readonly durationMinutes: number | null;
  readonly assigned: boolean;
  readonly scheduledStart: Date | null;
  readonly customerName: string | null;
  readonly siteName: string | null;
  readonly siteStreet: string | null;
  readonly siteCity: string | null;
  readonly complaint: string | null;
}

async function readWorkOrder(db: PoolClient, tenantId: string, workOrderId: string): Promise<SchedulableWorkOrder | null> {
  const { rows } = await db.query(
    `SELECT w.id, w.status::text AS status, w.work_order_type::text AS type, w.operating_company_key, w.estimated_duration_minutes,
            w.scheduled_start, w.complaint, acct.name AS customer_name, loc.name AS site_name, loc.address_street, loc.address_city,
            EXISTS (SELECT 1 FROM eos_ops.work_order_assignments a WHERE a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL) AS assigned
       FROM eos_ops.work_orders w
       LEFT JOIN eos_crm.accounts acct ON acct.tenant_id = w.tenant_id AND acct.id = w.customer_id
       LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = w.tenant_id AND loc.id = w.location_id
      WHERE w.tenant_id = $1 AND w.id = $2`, [tenantId, workOrderId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  let companyId: string;
  try {
    companyId = await resolveActiveOperatingCompanyId(db, tenantId, r.operating_company_key);
  } catch (err) {
    if (err instanceof OperatingCompanyBindingError) {
      return refuse("WORK_ORDER_OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", "the Work Order's operating company is not ACTIVE and keyed");
    }
    throw err;
  }
  return {
    id: r.id, status: r.status, type: r.type, companyKey: r.operating_company_key, companyId,
    durationMinutes: r.estimated_duration_minutes === null ? null : Number(r.estimated_duration_minutes), assigned: r.assigned === true,
    scheduledStart: r.scheduled_start ? new Date(r.scheduled_start) : null, customerName: r.customer_name ?? null, siteName: r.site_name ?? null,
    siteStreet: r.address_street ?? null, siteCity: r.address_city ?? null, complaint: r.complaint ?? null,
  };
}

/** Is this Work Order self-schedulable right now? The refusal says which rule failed. */
async function assertSelfSchedulable(db: PoolClient, tenantId: string, wo: SchedulableWorkOrder | null): Promise<SchedulableWorkOrder> {
  if (!wo) return refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "that Work Order does not exist");
  if (await isQuarantined(db, tenantId, wo.id)) refuse("WORK_ORDER_QUARANTINED", "PRECONDITION_FAILED", "a quarantined Work Order is not an operational record");
  if (wo.status !== "READY_TO_DISPATCH" || wo.assigned) {
    refuse("WORK_ORDER_NOT_SCHEDULABLE", "PRECONDITION_FAILED",
      `the Work Order is ${wo.status}${wo.assigned ? " and assigned" : ""}; only an unassigned READY_TO_DISPATCH Work Order is self-scheduled`);
  }
  if (!QUALIFICATION_BY_WORK_ORDER_TYPE[wo.type]) refuse("WORK_ORDER_TYPE_NOT_SCHEDULABLE", "PRECONDITION_FAILED", `${wo.type} has no governed Technician qualification`);
  return wo;
}

function visitMinutes(wo: SchedulableWorkOrder, policy: SelfSchedulingPolicy): number {
  const minutes = wo.durationMinutes ?? policy.defaultDurationMinutes;
  if (minutes === null || minutes < 1) {
    return refuse("VISIT_LENGTH_NOT_GOVERNED", "PRECONDITION_FAILED", "the Work Order has no estimated duration and the policy states no default visit length");
  }
  return minutes;
}

/** The customer-visible choices: the engine's slots in the policy window, one per distinct time, no Technician identity. */
async function offeredSlots(db: PoolClient, tenantId: string, wo: SchedulableWorkOrder, policy: SelfSchedulingPolicy, now: Date) {
  const durationMs = visitMinutes(wo, policy) * MINUTE;
  const incrementMs = policy.slotIncrementMinutes * MINUTE;
  const range = { start: Math.ceil((now.getTime() + policy.earliestOffsetMinutes * MINUTE) / incrementMs) * incrementMs,
    end: now.getTime() + policy.horizonDays * DAY };
  const { slots } = await computeTechnicianSlots(db, {
    tenantId, companyId: wo.companyId, qualification: QUALIFICATION_BY_WORK_ORDER_TYPE[wo.type], durationMs, range, incrementMs,
    onlyIds: null, excludeWorkOrderId: wo.id,
  });
  const byStart = new Map<number, TechnicianSlot[]>();
  for (const s of slots) (byStart.get(s.start) ?? byStart.set(s.start, []).get(s.start)!).push(s);
  return { durationMs, range, byStart };
}

const labelFor = (ms: number, timeZone: string) => ({
  date: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(new Date(ms)),
  time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(ms)),
});
function customerSlots(byStart: Map<number, TechnicianSlot[]>, durationMs: number, policy: SelfSchedulingPolicy) {
  return [...byStart.keys()].sort((a, b) => a - b).slice(0, policy.maxOfferedSlots).map((start) => {
    const l = labelFor(start, policy.timeZone);
    return Object.freeze({ slotStart: new Date(start).toISOString(), slotEnd: new Date(start + durationMs).toISOString(), dateLabel: l.date, timeLabel: l.time });
  });
}

// ════════════════════ issue / revoke / read (the Service Office) ════════════════════

/** Issue ONE customer scheduling link for ONE eligible Work Order. The token is returned once and never again. */
export async function issueSelfSchedulingLink(deps: WorkOrderOperationDeps, actor: LifecycleActor, raw: unknown) {
  requireAll(actor, [SELF_SCHEDULING_ISSUE, WORK_ORDER_LIFECYCLE_SCHEDULE], "issuing a customer scheduling link");
  const i = only(raw, ["workOrderId"]);
  if (!ID_SHAPE(i.workOrderId)) refuse("WORK_ORDER_ID_REQUIRED", "INVALID_INPUT", "workOrderId is required");
  const now = (deps.now ?? (() => new Date()))();
  return inTransaction(deps.pool, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`self-sched:${actor.tenantId}:${i.workOrderId}`]);
    const wo = await assertSelfSchedulable(c, actor.tenantId, await readWorkOrder(c, actor.tenantId, i.workOrderId as string));
    const policy = await applicablePolicy(c, actor.tenantId, wo.companyId, wo.type);
    if (!policy) refuse("SELF_SCHEDULING_NOT_CONFIGURED", "PRECONDITION_FAILED", `no enabled self-scheduling policy governs ${wo.companyId} ${wo.type} Work Orders`);
    visitMinutes(wo, policy!);
    const superseded = await c.query(
      `UPDATE eos_ops.self_scheduling_sessions SET status = 'SUPERSEDED', closed_at = $3, closed_by_principal_id = $4, closed_reason = 'SUPERSEDED',
              version = version + 1
        WHERE tenant_id = $1 AND work_order_id = $2 AND status = 'ACTIVE' RETURNING id`, [actor.tenantId, wo.id, now, actor.principalId]);
    for (const s of superseded.rows) await sessionEvent(c, actor.tenantId, s.id, "SUPERSEDED", { byPrincipalId: actor.principalId }, now);
    const token = randomBytes(32).toString("base64url");
    const id = `ssn_${randomUUID().replace(/-/g, "")}`;
    const expiresAt = new Date(now.getTime() + policy!.sessionTtlMinutes * MINUTE);
    await c.query(
      `INSERT INTO eos_ops.self_scheduling_sessions (tenant_id, id, token_sha256, work_order_id, issued_by_principal_id, issued_at, expires_at,
                                                     policy_id, policy_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [actor.tenantId, id, tokenHash(token), wo.id, actor.principalId, now, expiresAt, policy!.policyId, policy!.version]);
    await sessionEvent(c, actor.tenantId, id, "ISSUED", { policyId: policy!.policyId, policyVersion: policy!.version, superseded: superseded.rows.map((s) => s.id) }, now);
    await audit(c, actor.tenantId, actor.principalId, "workOrder.selfScheduling.issue", "workOrder", wo.id,
      { sessionId: id, expiresAt: expiresAt.toISOString(), policyId: policy!.policyId, policyVersion: policy!.version }, null, now);
    return Object.freeze({
      sessionId: id, workOrderId: wo.id, expiresAt: expiresAt.toISOString(),
      // SHOWN ONCE. Only its hash is stored. Delivery is a separate, governed channel -- this API only generates it.
      token, linkPath: `/schedule/${token}`,
      policy: { policyId: policy!.policyId, version: policy!.version, earliestOffsetMinutes: policy!.earliestOffsetMinutes, horizonDays: policy!.horizonDays },
    });
  });
}

export async function revokeSelfSchedulingLink(deps: WorkOrderOperationDeps, actor: LifecycleActor, raw: unknown) {
  requireAll(actor, [SELF_SCHEDULING_ISSUE], "revoking a customer scheduling link");
  const i = only(raw, ["workOrderId", "reason"]);
  if (!ID_SHAPE(i.workOrderId)) refuse("WORK_ORDER_ID_REQUIRED", "INVALID_INPUT", "workOrderId is required");
  const reason = typeof i.reason === "string" && i.reason.trim() && i.reason.length <= 500 ? i.reason.trim() : null;
  if (!reason) refuse("REASON_REQUIRED", "INVALID_INPUT", "a revocation states why");
  const now = (deps.now ?? (() => new Date()))();
  return inTransaction(deps.pool, async (c) => {
    const { rows } = await c.query(
      `UPDATE eos_ops.self_scheduling_sessions SET status = 'REVOKED', closed_at = $3, closed_by_principal_id = $4, closed_reason = $5, version = version + 1
        WHERE tenant_id = $1 AND work_order_id = $2 AND status = 'ACTIVE' RETURNING id`, [actor.tenantId, i.workOrderId, now, actor.principalId, reason]);
    for (const s of rows) {
      await sessionEvent(c, actor.tenantId, s.id, "REVOKED", { byPrincipalId: actor.principalId, reason }, now);
      await audit(c, actor.tenantId, actor.principalId, "workOrder.selfScheduling.revoke", "workOrder", i.workOrderId as string, { sessionId: s.id }, reason, now);
    }
    return Object.freeze({ workOrderId: i.workOrderId, revoked: rows.map((s) => s.id) });
  });
}

/** The Service Office's view of a Work Order's scheduling links: state and history -- never a token. */
export async function readSelfSchedulingSessions(deps: WorkOrderOperationDeps, actor: LifecycleActor, raw: unknown) {
  if (!(actor.capabilities instanceof Set) || ![SELF_SCHEDULING_ISSUE, WORK_ORDER_LIFECYCLE_SCHEDULE].some((k) => actor.capabilities.has(k))) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `reading scheduling links requires ${SELF_SCHEDULING_ISSUE} or ${WORK_ORDER_LIFECYCLE_SCHEDULE}`);
  }
  const i = only(raw, ["workOrderId"]);
  if (!ID_SHAPE(i.workOrderId)) refuse("WORK_ORDER_ID_REQUIRED", "INVALID_INPUT", "workOrderId is required");
  const now = (deps.now ?? (() => new Date()))();
  const { rows } = await deps.pool.query(
    `SELECT s.*, (SELECT json_agg(json_build_object('kind', e.event_kind, 'at', e.occurred_at, 'detail', e.detail) ORDER BY e.occurred_at, e.event_seq)
                    FROM eos_ops.self_scheduling_session_events e WHERE e.tenant_id = s.tenant_id AND e.session_id = s.id) AS events
       FROM eos_ops.self_scheduling_sessions s WHERE s.tenant_id = $1 AND s.work_order_id = $2 ORDER BY s.issued_at DESC, s.id LIMIT 20`,
    [actor.tenantId, i.workOrderId]);
  return Object.freeze({
    workOrderId: i.workOrderId,
    sessions: rows.map((s) => ({
      sessionId: s.id, status: s.status === "ACTIVE" && new Date(s.expires_at) <= now ? "EXPIRED" : s.status,
      issuedAt: new Date(s.issued_at).toISOString(), expiresAt: new Date(s.expires_at).toISOString(), issuedByPrincipalId: s.issued_by_principal_id,
      selectedStart: s.selected_start ? new Date(s.selected_start).toISOString() : null, selectedEnd: s.selected_end ? new Date(s.selected_end).toISOString() : null,
      completedAt: s.completed_at ? new Date(s.completed_at).toISOString() : null, closedReason: s.closed_reason ?? null,
      events: (s.events ?? []).map((e: { kind: string; at: string; detail: unknown }) => ({ kind: e.kind, at: new Date(e.at).toISOString(), detail: e.detail })),
    })),
  });
}

export const SELF_SCHEDULING_WORK_ORDER_OPERATIONS: Readonly<Record<string, WorkOrderOp>> = Object.freeze({
  saveSelfSchedulingPolicy: (deps, caller, input) => saveSelfSchedulingPolicy(deps, caller.actor, input),
  listSelfSchedulingPolicies: (deps, caller, input) => listSelfSchedulingPolicies(deps, caller.actor, input),
  issueSelfSchedulingLink: (deps, caller, input) => issueSelfSchedulingLink(deps, caller.actor, input),
  revokeSelfSchedulingLink: (deps, caller, input) => revokeSelfSchedulingLink(deps, caller.actor, input),
  readSelfSchedulingSessions: (deps, caller, input) => readSelfSchedulingSessions(deps, caller.actor, input),
});
export const SELF_SCHEDULING_READ_OPERATIONS: readonly string[] = Object.freeze(["listSelfSchedulingPolicies", "readSelfSchedulingSessions"]);

// ════════════════════ the customer (public, token-bound) ════════════════════

interface SessionRow {
  readonly tenantId: string;
  readonly id: string;
  readonly workOrderId: string;
  readonly status: string;
  readonly issuedBy: string;
  readonly expiresAt: Date;
  readonly selectedStart: Date | null;
  readonly selectedEnd: Date | null;
}

/** Resolve a presented token. Unknown and malformed tokens are indistinguishable: nothing is enumerable. */
async function sessionFor(db: Pick<PoolClient, "query">, token: unknown, lock = false): Promise<SessionRow> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    return refuse("SESSION_NOT_FOUND", "NOT_FOUND", "this scheduling link is not valid");
  }
  const { rows } = await db.query(`SELECT * FROM eos_ops.self_scheduling_sessions WHERE token_sha256 = $1${lock ? " FOR UPDATE" : ""}`, [tokenHash(token)]);
  if (rows.length === 0) refuse("SESSION_NOT_FOUND", "NOT_FOUND", "this scheduling link is not valid");
  const r = rows[0];
  return { tenantId: r.tenant_id, id: r.id, workOrderId: r.work_order_id, status: r.status, issuedBy: r.issued_by_principal_id,
    expiresAt: new Date(r.expires_at), selectedStart: r.selected_start ? new Date(r.selected_start) : null,
    selectedEnd: r.selected_end ? new Date(r.selected_end) : null };
}

function assertSessionOpen(s: SessionRow, now: Date): void {
  if (s.status === "REVOKED" || s.status === "SUPERSEDED") refuse("SESSION_REVOKED", "PRECONDITION_FAILED", "this scheduling link has been withdrawn; ask for a new one");
  if (s.status === "ACTIVE" && s.expiresAt <= now) refuse("SESSION_EXPIRED", "PRECONDITION_FAILED", "this scheduling link has expired; ask for a new one");
}

function jobContext(wo: SchedulableWorkOrder, minutes: number) {
  // Enough to recognize the request -- and no identifier: no tenant, customer, Work Order or Technician id.
  return Object.freeze({
    customerName: wo.customerName, siteName: wo.siteName, siteAddress: [wo.siteStreet, wo.siteCity].filter(Boolean).join(", ") || null,
    visitType: wo.type, problemSummary: wo.complaint ? wo.complaint.slice(0, 160) : null, visitMinutes: minutes,
  });
}

function confirmation(s: SessionRow, policyTz: string) {
  const start = s.selectedStart!.getTime();
  const l = labelFor(start, policyTz);
  return Object.freeze({ status: "CONFIRMED", slotStart: s.selectedStart!.toISOString(), slotEnd: s.selectedEnd!.toISOString(), dateLabel: l.date, timeLabel: l.time });
}

async function policyTimeZone(db: Pick<PoolClient, "query">, s: SessionRow): Promise<string> {
  const { rows } = await db.query(`SELECT p.time_zone FROM eos_ops.self_scheduling_sessions x JOIN eos_ops.self_scheduling_policies p
                                     ON p.tenant_id = x.tenant_id AND p.id = x.policy_id WHERE x.tenant_id = $1 AND x.id = $2`, [s.tenantId, s.id]);
  return rows[0]?.time_zone ?? "UTC";
}

/** THE CUSTOMER'S READ: the job, the current choices -- or the confirmation, or why the link no longer works. */
export async function readSchedulingOffer(deps: { readonly pool: Pool; readonly now?: () => Date }, raw: unknown) {
  const i = only(raw, ["token"]);
  const now = (deps.now ?? (() => new Date()))();
  const client = await deps.pool.connect();
  try {
    const s = await sessionFor(client, i.token);
    if (s.status === "COMPLETED") return Object.freeze({ ...confirmation(s, await policyTimeZone(client, s)) });
    assertSessionOpen(s, now);
    const wo = await assertSelfSchedulable(client, s.tenantId, await readWorkOrder(client, s.tenantId, s.workOrderId));
    const policy = await applicablePolicy(client, s.tenantId, wo.companyId, wo.type);
    if (!policy) refuse("SELF_SCHEDULING_NOT_CONFIGURED", "PRECONDITION_FAILED", "online scheduling is not available for this visit; please contact us");
    const { durationMs, byStart } = await offeredSlots(client, s.tenantId, wo, policy!, now);
    await sessionEvent(client, s.tenantId, s.id, "VIEWED", { offered: Math.min(byStart.size, policy!.maxOfferedSlots) }, now);
    return Object.freeze({
      status: "OPEN", expiresAt: s.expiresAt.toISOString(), timeZone: policy!.timeZone,
      job: jobContext(wo, Math.round(durationMs / MINUTE)), slots: customerSlots(byStart, durationMs, policy!),
    });
  } finally {
    client.release();
  }
}

/** Does the issuer STILL hold the authority the booking runs under? Re-resolved; never cached from issue time. */
async function issuerActor(pool: Pool, reader: PolicyReader, tenantId: string, principalId: string): Promise<LifecycleActor | null> {
  try {
    const ctx = await resolveOperationalContextForPrincipal(reader, pool, principalId, tenantId, postgresGrantConditionProvider(pool));
    if (ctx.principalContext.tenantId !== tenantId) return null;
    if (!ctx.capabilities.has(SELF_SCHEDULING_ISSUE) || !ctx.capabilities.has(WORK_ORDER_LIFECYCLE_SCHEDULE)) return null;
    return Object.freeze({ tenantId, principalId, capabilities: ctx.capabilities });
  } catch {
    return null;
  }
}

/**
 * THE CUSTOMER'S SELECTION. Serialized per session; everything re-read; the Work Order placed by the governed
 * scheduleWorkOrder under the issuer's re-resolved authority. A replay of the completed selection answers the same
 * confirmation; anything stale is refused with refreshed choices.
 */
export async function selectSchedulingSlot(deps: { readonly pool: Pool; readonly reader: PolicyReader; readonly now?: () => Date }, raw: unknown) {
  const i = only(raw, ["token", "slotStart"]);
  if (typeof i.slotStart !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(i.slotStart) || !Number.isFinite(Date.parse(i.slotStart))) {
    refuse("SLOT_INVALID", "INVALID_INPUT", "slotStart is one of the offered times");
  }
  const slotStart = Date.parse(i.slotStart as string);
  const now = (deps.now ?? (() => new Date()))();
  const lockClient = await deps.pool.connect();
  let session: SessionRow | null = null;
  try {
    const found = await sessionFor(lockClient, i.token);
    session = found;
    // ONE SELECTION AT A TIME PER SESSION (a double click, two tabs).
    await lockClient.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [`self-sched-session:${found.id}`]);
    const s = await sessionFor(lockClient, i.token);
    const tz = await policyTimeZone(lockClient, s);
    if (s.status === "COMPLETED") {
      if (s.selectedStart && s.selectedStart.getTime() === slotStart) return Object.freeze({ ...confirmation(s, tz), replayed: true });
      refuse("SESSION_ALREADY_USED", "CONFLICT", "this visit is already booked; the confirmed time is unchanged");
    }
    assertSessionOpen(s, now);
    const wo = await readWorkOrder(lockClient, s.tenantId, s.workOrderId);
    try {
      await assertSelfSchedulable(lockClient, s.tenantId, wo);
    } catch (err) {
      await sessionEvent(lockClient, s.tenantId, s.id, "REFUSED", { code: (err as { code?: string }).code, slotStart: i.slotStart }, now);
      throw err;
    }
    const policy = await applicablePolicy(lockClient, s.tenantId, wo!.companyId, wo!.type);
    if (!policy) refuse("SELF_SCHEDULING_NOT_CONFIGURED", "PRECONDITION_FAILED", "online scheduling is no longer available for this visit; please contact us");
    const actor = await issuerActor(deps.pool, deps.reader, s.tenantId, s.issuedBy);
    if (!actor) {
      await sessionEvent(lockClient, s.tenantId, s.id, "REFUSED", { code: "SESSION_AUTHORITY_WITHDRAWN" }, now);
      refuse("SESSION_AUTHORITY_WITHDRAWN", "PRECONDITION_FAILED", "this scheduling link is no longer valid; ask for a new one");
    }
    const offer = await offeredSlots(lockClient, s.tenantId, wo!, policy!, now);
    const refreshed = () => ({ slots: customerSlots(offer.byStart, offer.durationMs, policy!) });
    const candidates = offer.byStart.get(slotStart) ?? [];
    if (candidates.length === 0) {
      await sessionEvent(lockClient, s.tenantId, s.id, "REFUSED", { code: "SLOT_NO_LONGER_AVAILABLE", slotStart: i.slotStart }, now);
      refuse("SLOT_NO_LONGER_AVAILABLE", "CONFLICT", "that time is no longer available; please choose another", refreshed());
    }
    const end = new Date(slotStart + offer.durationMs);
    for (const candidate of candidates) {
      try {
        await scheduleWorkOrder({ pool: deps.pool, now: () => now }, actor!, {
          workOrderId: s.workOrderId, employeeId: candidate.employeeId, scheduledStart: new Date(slotStart).toISOString(),
          scheduledEnd: end.toISOString(), note: `Customer self-scheduling (session ${s.id})`,
        });
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        if (PER_TECHNICIAN_REFUSALS.has(code)) continue; // that Technician was taken meanwhile: the next one for the window
        if (code === "STALE_WORK_ORDER_STATE") {
          await sessionEvent(lockClient, s.tenantId, s.id, "REFUSED", { code: "WORK_ORDER_NOT_SCHEDULABLE", slotStart: i.slotStart }, now);
          refuse("WORK_ORDER_NOT_SCHEDULABLE", "PRECONDITION_FAILED", "this visit was scheduled by our office meanwhile; please contact us");
        }
        throw err;
      }
      // PLACED. The session completes with the booked window and the Technician (server-side only).
      await inTransaction(deps.pool, async (c) => {
        await c.query(
          `UPDATE eos_ops.self_scheduling_sessions SET status = 'COMPLETED', selected_start = $3, selected_end = $4, selected_employee_id = $5,
                  completed_at = $6, version = version + 1
            WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'`, [s.tenantId, s.id, new Date(slotStart), end, candidate.employeeId, now]);
        await sessionEvent(c, s.tenantId, s.id, "SELECTED", { slotStart: i.slotStart, slotEnd: end.toISOString() }, now);
        await audit(c, s.tenantId, SELF_SCHEDULING_SYSTEM_ACTOR, "workOrder.selfScheduling.select", "workOrder", s.workOrderId,
          { sessionId: s.id, scheduledStart: i.slotStart, scheduledEnd: end.toISOString(), placedUnderPrincipalId: s.issuedBy }, null, now);
      });
      const done = await sessionFor(lockClient, i.token);
      return Object.freeze({ ...confirmation(done, tz), replayed: false });
    }
    // Every Technician who could take that exact window was taken first: stale, with refreshed choices.
    const recomputed = await offeredSlots(lockClient, s.tenantId, wo!, policy!, now);
    await sessionEvent(lockClient, s.tenantId, s.id, "REFUSED", { code: "SLOT_NO_LONGER_AVAILABLE", slotStart: i.slotStart, raced: true }, now);
    return refuse("SLOT_NO_LONGER_AVAILABLE", "CONFLICT", "that time was just taken; please choose another",
      { slots: customerSlots(recomputed.byStart, recomputed.durationMs, policy!) });
  } finally {
    if (session) await lockClient.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [`self-sched-session:${session.id}`]).catch(() => undefined);
    lockClient.release();
  }
}
