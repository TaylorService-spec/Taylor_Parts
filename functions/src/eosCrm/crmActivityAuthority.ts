// CRM ACTIVITY / NOTES ON EOS CORE (Firebase exit F7b; DECISIONS #243) -- the Firestore crm_activities record re-homed onto
// eos_crm.activities (migration 1764590000000), served on the CRM route (/crm/customer) beside the Account it belongs to.
//
// BEHAVIOUR KEPT (crmActivity/crmActivityCommands.ts + crmActivityReadService.ts): the five governed types, a required
// Account, optional Contact / Opportunity / Sales Order references BY ID ONLY, a non-blank body of at most 4000
// characters, occurredAt (caller-supplied, possibly backdated, never materially future) distinct from the server's
// createdAt, one idempotency key per actor = one activity (a retry answers the same activity), the list most-recent-first
// by occurredAt, and a list too long for its limit answered as "unavailable" rather than as a partial "ready".
//
// AUTHORITY (Controller, under the Owner's preserve-functionality-and-access rule):
//   * READ requires crm.activity.read AND the Account's own read predicate (customer.record.read, the Account in this
//     tenant) -- never wider than reading the Account itself. The EOS Account read is TENANT-scoped: eos_crm.accounts
//     carries no operating company (migration 1758758400000 says why), so there is no company dimension to apply here.
//   * CREATE requires crm.activity.create AND the same Account visibility as the read (customer.record.read, the Account in
//     this tenant): an activity cannot be written to an Account the writer could not read (Owner review, 2026-10-17). Every
//     linked Contact / Opportunity / Sales Order must exist IN THIS TENANT and belong to THAT Account; one outside the
//     tenant, or on another Account, is refused exactly like an unknown one. (The Firestore command checked neither.)
//   * EXPLICIT PARITY NOTE: a principal holding crmActivityContributor ALONE (no customer.record.read) can no longer read or
//     create activity through the API. No customer-read grant is added to compensate (DECISIONS #243).
//   * The holders are mirrored from the current Firebase catalog (admin, owner, crmActivityContributor) by the migration.
// Every created activity writes ONE eos_policy.audit_events row in its own transaction; a replay writes nothing.
import { randomUUID } from "node:crypto";
import {
  CRM_CAPABILITIES, fail, requireAllowlistedInput, requireIdempotencyKey, requireRecordId, requireTenantAccount,
  runCrmCommand, runCrmRead, type CrmActorContext, type CrmDeps,
} from "./crmAuthorityKernel";
import { withActorAuthority } from "../eosOps/administrationReach";
import { resolveCommercialCompanyReach, type CommercialCompanyResolver } from "../eosCommercial/commercialCompanyAuthority";

export const CRM_ACTIVITY_READ = "crm.activity.read";
export const CRM_ACTIVITY_CREATE = "crm.activity.create";
export const CRM_ACTIVITY_TYPES = Object.freeze(["SALES_NOTE", "CALL", "MEETING", "RELATIONSHIP", "GENERAL"] as const);
export const MAX_BODY_LENGTH = 4000;
export const OCCURRED_AT_FUTURE_TOLERANCE_MILLIS = 5 * 60 * 1000;
export const CRM_ACTIVITY_DEFAULT_LIMIT = 100;
export const CRM_ACTIVITY_MAX_LIMIT = 200;

export interface CrmActivityProjection {
  readonly id: string;
  readonly accountId: string;
  readonly contactId: string | null;
  readonly opportunityId: string | null;
  readonly salesOrderId: string | null;
  readonly type: string;
  readonly body: string;
  readonly occurredAtMillis: number;
  readonly createdAtMillis: number;
  /** The EOS Principal who recorded it; null on a MIGRATED activity (its Firebase actor is evidence, never a column). */
  readonly createdByUid: string | null;
}

/** A read that needs BOTH keys: the activity capability and the Account's own read. */
function requireReadBoth(actor: CrmActorContext): void {
  if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(CRM_ACTIVITY_READ)) {
    fail("CAPABILITY_REQUIRED", "FORBIDDEN", `reading CRM activity requires ${CRM_ACTIVITY_READ}`);
  }
}

const optionalId = (v: unknown, field: string): string | null => (v === undefined || v === null || v === "" ? null : requireRecordId(v, field));

const project = (r: Record<string, unknown>): CrmActivityProjection => Object.freeze({
  id: String(r.id), accountId: String(r.account_id), contactId: (r.contact_id as string | null) ?? null,
  opportunityId: (r.opportunity_id as string | null) ?? null, salesOrderId: (r.sales_order_id as string | null) ?? null,
  type: String(r.type), body: String(r.body), occurredAtMillis: new Date(r.occurred_at as string).getTime(),
  createdAtMillis: new Date(r.created_at as string).getTime(), createdByUid: (r.created_by as string | null) ?? null,
});

/**
 * One Account's activity timeline, most recent interaction first. `{ status: "ready", activities }`, or
 * `{ status: "unavailable", activities: [] }` when there are more than `limit` -- a truncated list is never "ready".
 */
export function listAccountActivities(deps: CrmDeps, actor: CrmActorContext, input: unknown) {
  requireReadBoth(actor);
  return runCrmRead(deps, actor, CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => {
      const i = requireAllowlistedInput(input, ["accountId", "limit"]);
      const limit = i.limit === undefined ? CRM_ACTIVITY_DEFAULT_LIMIT : i.limit;
      if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > CRM_ACTIVITY_MAX_LIMIT) {
        fail("FILTER_INVALID", "INVALID_INPUT", `limit must be an integer between 1 and ${CRM_ACTIVITY_MAX_LIMIT}`);
      }
      return { accountId: requireRecordId(i.accountId, "accountId"), limit: limit as number };
    },
    async (db, tenantId, { accountId, limit }) => {
      await requireTenantAccount(db, tenantId, accountId);
      const { rows } = await db.query(
        `SELECT * FROM eos_crm.activities WHERE tenant_id = $1 AND account_id = $2 ORDER BY occurred_at DESC, id LIMIT $3`,
        [tenantId, accountId, limit + 1]);
      if (rows.length > limit) return Object.freeze({ status: "unavailable" as const, activities: Object.freeze([]) });
      return Object.freeze({ status: "ready" as const, activities: Object.freeze(rows.map(project)) });
    });
}

/** Each stated reference must be in this tenant AND on this Account; anything else answers like an unknown record. */
// Q-1a (Owner ruling Q1-11): the Commercial links are Commercial records, so they are probed through the caller's operating-company reach (alias `t`): a record of
// an unreached company (or a company-less one the caller neither owns nor created) answers exactly like an unknown id.
const LINKS = Object.freeze([
  ["contactId", "eos_crm.contacts", "CONTACT_NOT_FOUND", "no such Contact on this Account"],
  ["opportunityId", "eos_commercial.opportunities", "OPPORTUNITY_NOT_FOUND", "no such Opportunity on this Account"],
  ["salesOrderId", "eos_commercial.sales_orders", "SALES_ORDER_NOT_FOUND", "no such Sales Order on this Account"],
] as const);

/** Record one interaction. `{ success: true, replayed, activityId }`, exactly the Firestore callable's answer. */
export function createAccountActivity(deps: CrmDeps, actor: CrmActorContext, input: unknown) {
  // Account visibility first: the writer must be able to read the Account it writes to.
  if (actor && actor.capabilities instanceof Set && actor.capabilities.has(CRM_ACTIVITY_CREATE)
      && !actor.capabilities.has(CRM_CAPABILITIES.CUSTOMER_RECORD_READ)) {
    fail("CAPABILITY_REQUIRED", "FORBIDDEN", `recording CRM activity also requires ${CRM_CAPABILITIES.CUSTOMER_RECORD_READ}`);
  }
  return runCrmCommand(deps, actor, CRM_ACTIVITY_CREATE,
    () => {
      const i = requireAllowlistedInput(input, ["accountId", "contactId", "opportunityId", "salesOrderId", "type", "body",
        "occurredAtMillis", "idempotencyKey"]);
      if (!(CRM_ACTIVITY_TYPES as readonly unknown[]).includes(i.type)) {
        fail("TYPE_INVALID", "INVALID_INPUT", `type must be one of ${CRM_ACTIVITY_TYPES.join("/")}`);
      }
      if (typeof i.body !== "string" || i.body.trim() === "") fail("BODY_REQUIRED", "INVALID_INPUT", "body is required");
      const body = (i.body as string).trim();
      if (body.length > MAX_BODY_LENGTH) fail("BODY_TOO_LONG", "INVALID_INPUT", `body must not exceed ${MAX_BODY_LENGTH} characters`);
      let occurredAtMillis: number | null = null;
      if (i.occurredAtMillis !== undefined && i.occurredAtMillis !== null) {
        if (typeof i.occurredAtMillis !== "number" || !Number.isFinite(i.occurredAtMillis)) {
          fail("OCCURRED_AT_INVALID", "INVALID_INPUT", "occurredAtMillis must be a finite number when present");
        }
        if ((i.occurredAtMillis as number) > Date.now() + OCCURRED_AT_FUTURE_TOLERANCE_MILLIS) {
          fail("OCCURRED_AT_FUTURE", "INVALID_INPUT", "occurredAtMillis cannot be materially in the future");
        }
        occurredAtMillis = i.occurredAtMillis as number;
      }
      return {
        accountId: requireRecordId(i.accountId, "accountId"), contactId: optionalId(i.contactId, "contactId"),
        opportunityId: optionalId(i.opportunityId, "opportunityId"), salesOrderId: optionalId(i.salesOrderId, "salesOrderId"),
        type: i.type as string, body, occurredAtMillis, idempotencyKey: requireIdempotencyKey(i.idempotencyKey),
      };
    },
    async (client, a, p) => {
      await requireTenantAccount(client, a.tenantId, p.accountId);
      let companyReach: Awaited<ReturnType<CommercialCompanyResolver>> | null = null;
      for (const [field, table, code, message] of LINKS) {
        const id = p[field];
        if (id === null) continue;
        const commercial = table.startsWith("eos_commercial.");
        if (commercial) companyReach = companyReach ?? await (deps.companyReach ?? resolveCommercialCompanyReach)(client, a.tenantId, a.principalId);
        const found = commercial
          ? await client.query(`SELECT 1 FROM ${table} t WHERE t.tenant_id = $1 AND t.id = $2 AND t.account_id = $3 AND ${companyReach!.sql("t", 4)}`, [a.tenantId, id, p.accountId, ...companyReach!.sqlParams()])
          : await client.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1 AND id = $2 AND account_id = $3`, [a.tenantId, id, p.accountId]);
        if (found.rows.length === 0) fail(code, "NOT_FOUND", message);
      }
      // One key per actor = one activity, exactly as the Firestore audit-id derivation (actor + key) decided it.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1 || '/' || $2 || '/' || $3))", [a.tenantId, a.principalId, p.idempotencyKey]);
      const prior = await client.query(`SELECT id FROM eos_crm.activities WHERE tenant_id = $1 AND created_by = $2 AND idempotency_key = $3`,
        [a.tenantId, a.principalId, p.idempotencyKey]);
      if (prior.rows.length > 0) return Object.freeze({ success: true as const, replayed: true, activityId: String(prior.rows[0].id) });
      const id = `act_${randomUUID()}`;
      const { rows } = await client.query(
        `INSERT INTO eos_crm.activities (tenant_id, id, account_id, contact_id, opportunity_id, sales_order_id, type, body, occurred_at,
                                         created_at, created_by, idempotency_key, provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE(to_timestamp($9::double precision / 1000), now()), now(), $10, $11, 'NATIVE') RETURNING *`,
        [a.tenantId, id, p.accountId, p.contactId, p.opportunityId, p.salesOrderId, p.type, p.body, p.occurredAtMillis, a.principalId, p.idempotencyKey]);
      await client.query(
        `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
         VALUES ($1,$2,'crm.activity.create',$3,'crm_activity',$4,NULL,$5::jsonb,now(),$6)`,
        [`audit_${randomUUID()}`, a.tenantId, a.principalId, id,
          JSON.stringify(await withActorAuthority(client, a.tenantId, a.principalId, { ...project(rows[0]), body: undefined, bodyLength: p.body.length })),
          `created ${p.type} activity for account ${p.accountId}`]);
      return Object.freeze({ success: true as const, replayed: false, activityId: id });
    });
}
