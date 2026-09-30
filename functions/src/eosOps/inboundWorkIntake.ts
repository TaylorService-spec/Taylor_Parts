// INBOUND WORK -- THE GOVERNED POSTGRESQL INTAKE (Owner ruling W9, Work Order cutover completion pass, 2026-09-30).
//
// One normalized provider message becomes exactly one retained intake record, or is preserved onto the intake it
// belongs to, in ONE transaction. This is the PostgreSQL port of functions/src/inboundWork/inboundIntakeCommand.ts:
// the decision logic is the SAME pure code (inboundWork/inboundWorkModel.ts, inboundProcessing.ts, inboundRouting.ts,
// inboundThreading.ts, emailProvider.ts -- none imports Firebase); only the persistence and the record lookup moved.
//
// ════════════════════ DUPLICATE PROTECTION IS STRUCTURAL ════════════════════
//
//   * the intake id is deterministic -- inbound_ + sha256(tenant | mailbox | provider message id) -- and the same
//     message is additionally serialized by a transaction-scoped advisory lock on that triple;
//   * every provider message ever taken in (original AND reply) is an append-only eos_ops.inbound_work_messages row,
//     UNIQUE on (tenant, mailbox, provider message id): a redelivered reply cannot be preserved twice;
//   * identical CONTENT under a different message id (sender | subject | normalized body) is NOT dropped and NOT
//     silently merged: it is taken in as NEEDS_REVIEW naming the earlier intake (duplicate_of_request_id).
//
// ════════════════════ NOTHING IS EVER DROPPED ════════════════════
//
// An unknown or disabled mailbox produces a RETAINED QUARANTINED intake carrying the original message; a processing
// failure produces a RETAINED FAILED intake carrying the failure. Every outcome is audited (eos_policy.audit_events).
//
// ════════════════════ THE PROVIDER BOUNDARY ════════════════════
//
// Polling a real mailbox (OAuth, delivery cursors, attachment byte custody) is the Firebase provider runtime, which
// cannot reach this database. What enters here is a NORMALIZED message, from the non-production delivery seam
// (deliverInboundMessage) or -- after an Owner ruling on the provider-runtime cutover -- from an EOS-side poller
// calling ingestInboundMessage with a system Principal that holds inboundWork.intake.manage.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { WorkOrderLifecycleError, type LifecycleActor, type LifecycleCategory } from "./workOrderLifecycle";
import {
  INBOUND_REQUEST_TYPES,
  MAX_ATTACHMENTS,
  MAX_EXTRACTED_FIELD_LENGTH,
  boundedString,
  normalizeEmailAddress,
  normalizeInboundMessage,
  toPlainText,
  type InboundProcessingProvider,
  type NormalizedInboundMessage,
} from "../inboundWork/inboundWorkModel";
import { ROUTING_DESTINATIONS, evaluateRouting, normalizeOutcome, type RoutingRule } from "../inboundWork/inboundRouting";
import {
  EMPTY_PROCESSING_RESULT,
  NO_CANDIDATE,
  normalizeProcessingResult,
  processInboundMessageNatively,
  type CandidateMatch,
  type InboundProcessingResult,
} from "../inboundWork/inboundProcessing";
import { associateInboundMessage, type ExistingIntakeRef } from "../inboundWork/inboundThreading";
import { isEmailProviderId, normalizeProviderMessage } from "../inboundWork/emailProvider";

// ════════════════════ capabilities (migration 1764340000000, registered with NO grants) ════════════════════
export const INBOUND_WORK_READ = "inboundWork.request.read";
export const INBOUND_WORK_ACCEPT = "inboundWork.request.accept";
export const INBOUND_WORK_DECLINE = "inboundWork.request.decline";
export const INBOUND_WORK_ATTACH = "inboundWork.request.attach";
export const INBOUND_INTAKE_MANAGE = "inboundWork.intake.manage";

/** The statuses a PostgreSQL intake can hold. ACCEPTING is the in-flight Accept claim (see inboundWorkDecisions.ts). */
export const PG_INBOUND_WORK_STATUSES = Object.freeze([
  "AWAITING_DECISION", "NEEDS_REVIEW", "ACCEPTING", "ACCEPTED", "DECLINED", "ATTACHED", "FAILED", "QUARANTINED",
] as const);
export type PgInboundWorkStatus = (typeof PG_INBOUND_WORK_STATUSES)[number];
export const DECIDABLE: ReadonlySet<string> = new Set(["AWAITING_DECISION", "NEEDS_REVIEW"]);

/** How many replies one intake keeps (parity: MAX_THREAD_MESSAGES). Beyond this a reply is still recorded as a message. */
export const MAX_THREAD_MESSAGES = 50;

/**
 * Every Inbound Work refusal. It IS a WorkOrderLifecycleError (the Work Order executor maps that class by name to its
 * HTTP status), so this route answers with the same { code, category } contract as /operations/work-orders.
 */
export class InboundWorkError extends WorkOrderLifecycleError {
  constructor(code: string, category: LifecycleCategory, message: string) {
    super(code, category, message);
  }
}
export const refuse = (code: string, category: LifecycleCategory, message: string): never => {
  throw new InboundWorkError(code, category, message);
};

export function requireCapability(actor: LifecycleActor, key: string): void {
  if (!(actor?.capabilities instanceof Set) || !actor.capabilities.has(key)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `this requires ${key}`);
  }
}

/** Refuse any field this operation does not accept -- named, not ignored. */
export function only(input: Record<string, unknown>, allowed: readonly string[]): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this operation does not accept: ${extra.sort().join(", ")}`);
}

export const isId = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 255 && !v.includes("/");

export async function writeAudit(
  db: PoolClient,
  actor: LifecycleActor,
  action: string,
  targetKind: string,
  targetId: string,
  before: unknown,
  after: unknown,
  reason: string | null,
  at: Date,
): Promise<string> {
  const id = `audit_${randomUUID()}`;
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
    [id, actor.tenantId, action, actor.principalId, targetKind, targetId,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), at, reason]);
  return id;
}

export function inboundRequestId(tenantId: string, mailboxId: string, messageId: string): string {
  return `inbound_${createHash("sha256").update(`${tenantId}|${mailboxId}|${messageId}`).digest("hex").slice(0, 40)}`;
}

export function contentKey(message: Pick<NormalizedInboundMessage, "sender" | "subject">, normalizedBody: string): string {
  return createHash("sha256").update(JSON.stringify([message.sender, message.subject, normalizedBody])).digest("hex");
}

const toTimestamp = (millis: number): Date | null => (Number.isFinite(millis) && millis > 0 ? new Date(millis) : null);

// ════════════════════ exact-key suggestions (the port of inboundCandidateResolution.ts) ════════════════════

/** The comparison key a serial is matched on: upper-case, whitespace removed (equipmentImportCommand's derivation). */
export function serialNumberKey(serial: unknown): string {
  return boundedString(serial, MAX_EXTRACTED_FIELD_LENGTH).toUpperCase().replace(/\s+/g, "");
}

const candidate = (id: string | null, rawValue: string, matchedOn: string): CandidateMatch => ({
  id,
  rawValue: boundedString(rawValue, MAX_EXTRACTED_FIELD_LENGTH),
  confidence: id ? "EXACT" : "NONE",
  matchedOn: id ? matchedOn : "",
});

/**
 * SUGGESTIONS, NOT DECISIONS, AND NEVER A MASTER-DATA WRITE. Exact unique keys only -- an equipment serial
 * (eos_ops.equipment) first, then the sender's contact address (eos_crm.contacts). Two hits is NOT unique: the answer
 * is then NONE plus the raw value, never the first row. Nothing here writes; Accept re-reads whatever is chosen.
 */
export async function resolveInboundCandidates(
  db: Pool | PoolClient,
  tenantId: string,
  input: { senderEmail?: string | null; serialNumber?: string | null },
): Promise<{ customerCandidate: CandidateMatch; locationCandidate: CandidateMatch; equipmentCandidate: CandidateMatch }> {
  const serialRaw = boundedString(input?.serialNumber, MAX_EXTRACTED_FIELD_LENGTH);
  const sender = normalizeEmailAddress(input?.senderEmail);
  let customerCandidate: CandidateMatch = NO_CANDIDATE;
  let locationCandidate: CandidateMatch = NO_CANDIDATE;
  let equipmentCandidate: CandidateMatch = serialRaw ? candidate(null, serialRaw, "") : NO_CANDIDATE;

  if (serialRaw) {
    const { rows } = await db.query(
      `SELECT id, account_id, customer_location_id FROM eos_ops.equipment
        WHERE tenant_id = $1 AND upper(regexp_replace(coalesce(serial_number, ''), '\\s+', '', 'g')) = $2
        ORDER BY id LIMIT 2`, [tenantId, serialNumberKey(serialRaw)]);
    if (rows.length === 1) {
      equipmentCandidate = candidate(String(rows[0].id), serialRaw, "serialNumberKey");
      if (rows[0].account_id) customerCandidate = candidate(String(rows[0].account_id), serialRaw, "equipmentAccount");
      if (rows[0].customer_location_id) locationCandidate = candidate(String(rows[0].customer_location_id), serialRaw, "equipmentLocation");
    }
  }
  if (!customerCandidate.id && sender) {
    const { rows } = await db.query(
      `SELECT account_id FROM eos_crm.contacts WHERE tenant_id = $1 AND lower(btrim(email)) = $2 ORDER BY id LIMIT 2`,
      [tenantId, sender]);
    customerCandidate = rows.length === 1 && rows[0].account_id
      ? candidate(String(rows[0].account_id), sender, "contactEmail")
      : candidate(null, sender, "");
  }
  return { customerCandidate, locationCandidate, equipmentCandidate };
}

// ════════════════════ configuration: mailboxes and routing rules ════════════════════

export interface MailboxRow {
  readonly id: string;
  readonly displayName: string;
  readonly emailAddress: string | null;
  readonly purpose: string;
  readonly destination: string;
  readonly defaultQueue: string | null;
  readonly suggestedOperatingCompanyId: string | null;
  readonly status: "ACTIVE" | "DISABLED";
  readonly inboundEnabled: boolean;
  readonly threadingEnabled: boolean;
  readonly version: number;
}

const mailboxFromRow = (r: Record<string, unknown>): MailboxRow => Object.freeze({
  id: String(r.id), displayName: String(r.display_name), emailAddress: (r.email_address as string | null) ?? null,
  purpose: String(r.purpose), destination: String(r.destination), defaultQueue: (r.default_queue as string | null) ?? null,
  suggestedOperatingCompanyId: (r.suggested_operating_company_id as string | null) ?? null,
  status: r.status === "DISABLED" ? "DISABLED" : "ACTIVE", inboundEnabled: r.inbound_enabled === true,
  threadingEnabled: r.threading_enabled === true, version: Number(r.version),
});

async function readMailbox(db: Pool | PoolClient, tenantId: string, mailboxId: string): Promise<MailboxRow | null> {
  const { rows } = await db.query(`SELECT * FROM eos_ops.inbound_mailboxes WHERE tenant_id = $1 AND id = $2`, [tenantId, mailboxId]);
  return rows.length ? mailboxFromRow(rows[0]) : null;
}

async function readRules(db: Pool | PoolClient, tenantId: string): Promise<RoutingRule[]> {
  const { rows } = await db.query(
    `SELECT id, name, enabled, rule_order, when_condition, then_outcome FROM eos_ops.inbound_routing_rules
      WHERE tenant_id = $1 ORDER BY rule_order, id LIMIT 200`, [tenantId]);
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), enabled: r.enabled === true, order: Number(r.rule_order),
    when: (r.when_condition ?? {}) as RoutingRule["when"],
    // Validated on the way OUT as well as in (parity with readRoutingRules).
    then: normalizeOutcome(r.then_outcome),
  }));
}

const MAILBOX_INPUT = ["mailboxId", "displayName", "emailAddress", "purpose", "destination", "defaultQueue",
  "suggestedOperatingCompanyId", "status", "inboundEnabled", "threadingEnabled"];
const MAILBOX_PURPOSES = ["SERVICE", "WARRANTY", "PARTS", "OTHER"];

async function assertGovernedCompany(db: PoolClient, tenantId: string, companyId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`,
    [tenantId, companyId]);
  if (rows.length === 0) refuse("OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", `'${companyId}' is not an ACTIVE operating company of this tenant`);
}

const optionalText = (v: unknown, max: number, field: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.trim().length === 0 || v.length > max) refuse("FIELD_INVALID", "INVALID_INPUT", `${field} is a string of at most ${max} characters`);
  return (v as string).trim();
};
const optionalBool = (v: unknown, fallback: boolean, field: string): boolean => {
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") refuse("FIELD_INVALID", "INVALID_INPUT", `${field} is a boolean`);
  return v as boolean;
};

async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* the original error is the one that matters */ });
    throw err;
  } finally {
    client.release();
  }
}
export { inTransaction };

/** Create or change one operational mailbox. ADMINISTRATIVE CONFIGURATION (inboundWork.intake.manage), audited. */
export async function saveInboundMailbox(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: LifecycleActor,
  input: Record<string, unknown>,
): Promise<MailboxRow> {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, MAILBOX_INPUT);
  if (!isId(input.mailboxId)) refuse("MAILBOX_ID_REQUIRED", "INVALID_INPUT", "mailboxId is required");
  const displayName = optionalText(input.displayName, 120, "displayName");
  if (!displayName) refuse("DISPLAY_NAME_REQUIRED", "INVALID_INPUT", "displayName is required");
  const purpose = input.purpose === undefined ? "OTHER" : input.purpose;
  if (!MAILBOX_PURPOSES.includes(purpose as string)) refuse("PURPOSE_INVALID", "INVALID_INPUT", `purpose is one of ${MAILBOX_PURPOSES.join(", ")}`);
  const destination = input.destination === undefined ? "SERVICE" : input.destination;
  if (!(ROUTING_DESTINATIONS as readonly string[]).includes(destination as string)) {
    refuse("DESTINATION_INVALID", "INVALID_INPUT", `destination is one of ${ROUTING_DESTINATIONS.join(", ")}`);
  }
  const status = input.status === undefined ? "ACTIVE" : input.status;
  if (status !== "ACTIVE" && status !== "DISABLED") refuse("STATUS_INVALID", "INVALID_INPUT", "status is ACTIVE or DISABLED");
  const emailAddress = input.emailAddress === undefined || input.emailAddress === null ? null : normalizeEmailAddress(input.emailAddress);
  if (input.emailAddress && !emailAddress) refuse("EMAIL_ADDRESS_INVALID", "INVALID_INPUT", "emailAddress is not an email address");
  const defaultQueue = optionalText(input.defaultQueue, 120, "defaultQueue");
  const company = optionalText(input.suggestedOperatingCompanyId, 120, "suggestedOperatingCompanyId");
  const inboundEnabled = optionalBool(input.inboundEnabled, true, "inboundEnabled");
  const threadingEnabled = optionalBool(input.threadingEnabled, true, "threadingEnabled");
  const now = (deps.now ?? (() => new Date()))();

  return inTransaction(deps.pool, async (c) => {
    if (company) await assertGovernedCompany(c, actor.tenantId, company);
    const before = await c.query(`SELECT * FROM eos_ops.inbound_mailboxes WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, input.mailboxId]);
    const { rows } = await c.query(
      `INSERT INTO eos_ops.inbound_mailboxes
         (tenant_id, id, display_name, email_address, purpose, destination, default_queue, suggested_operating_company_id,
          status, inbound_enabled, threading_enabled, updated_by_principal_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       ON CONFLICT (tenant_id, id) DO UPDATE SET display_name = EXCLUDED.display_name, email_address = EXCLUDED.email_address,
         purpose = EXCLUDED.purpose, destination = EXCLUDED.destination, default_queue = EXCLUDED.default_queue,
         suggested_operating_company_id = EXCLUDED.suggested_operating_company_id, status = EXCLUDED.status,
         inbound_enabled = EXCLUDED.inbound_enabled, threading_enabled = EXCLUDED.threading_enabled,
         updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = EXCLUDED.updated_at,
         version = inbound_mailboxes.version + 1
       RETURNING *`,
      [actor.tenantId, input.mailboxId, displayName, emailAddress, purpose, destination, defaultQueue, company, status,
        inboundEnabled, threadingEnabled, actor.principalId, now]);
    const saved = mailboxFromRow(rows[0]);
    await writeAudit(c, actor, "inboundWork.mailbox.save", "inboundMailbox", saved.id,
      before.rows.length ? mailboxFromRow(before.rows[0]) : null, saved, null, now);
    return saved;
  });
}

const RULE_INPUT = ["ruleId", "name", "enabled", "order", "when", "then"];
const CONDITION_KEYS = ["senderAddress", "senderDomain", "mailboxId", "subjectContains", "bodyContains", "hasAttachments"];

function validateCondition(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) refuse("RULE_CONDITION_INVALID", "INVALID_INPUT", "when is an object");
  const when = raw as Record<string, unknown>;
  const extra = Object.keys(when).filter((k) => !CONDITION_KEYS.includes(k));
  if (extra.length) refuse("RULE_CONDITION_INVALID", "INVALID_INPUT", `unknown routing condition(s): ${extra.sort().join(", ")}`);
  for (const k of ["senderAddress", "senderDomain", "mailboxId"]) {
    if (when[k] !== undefined && (typeof when[k] !== "string" || (when[k] as string).trim() === "" || (when[k] as string).length > 255)) {
      refuse("RULE_CONDITION_INVALID", "INVALID_INPUT", `${k} is a non-empty string`);
    }
  }
  for (const k of ["subjectContains", "bodyContains"]) {
    const v = when[k];
    if (v !== undefined && (!Array.isArray(v) || v.length > 20 || v.some((t) => typeof t !== "string" || t.length > 120))) {
      refuse("RULE_CONDITION_INVALID", "INVALID_INPUT", `${k} is a list of at most 20 strings`);
    }
  }
  if (when.hasAttachments !== undefined && typeof when.hasAttachments !== "boolean") {
    refuse("RULE_CONDITION_INVALID", "INVALID_INPUT", "hasAttachments is a boolean");
  }
  return when;
}

/** Create or change one routing rule. The outcome is validated strictly: an unrecognized value is REFUSED, not dropped. */
export async function saveInboundRoutingRule(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: LifecycleActor,
  input: Record<string, unknown>,
): Promise<RoutingRule> {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, RULE_INPUT);
  if (!isId(input.ruleId)) refuse("RULE_ID_REQUIRED", "INVALID_INPUT", "ruleId is required");
  const name = optionalText(input.name, 120, "name");
  if (!name) refuse("RULE_NAME_REQUIRED", "INVALID_INPUT", "name is required");
  const enabled = optionalBool(input.enabled, true, "enabled");
  const order = input.order === undefined ? 100 : input.order;
  if (!Number.isInteger(order) || (order as number) < 0 || (order as number) > 100000) refuse("RULE_ORDER_INVALID", "INVALID_INPUT", "order is an integer 0-100000");
  const when = validateCondition(input.when);
  const rawThen = (input.then ?? {}) as Record<string, unknown>;
  if (!rawThen || typeof rawThen !== "object" || Array.isArray(rawThen)) refuse("RULE_OUTCOME_INVALID", "INVALID_INPUT", "then is an object");
  const then = normalizeOutcome(rawThen) as Record<string, unknown>;
  const dropped = Object.keys(rawThen).filter((k) => !(k in then));
  if (dropped.length) refuse("RULE_OUTCOME_INVALID", "INVALID_INPUT", `unrecognized routing outcome value(s): ${dropped.sort().join(", ")}`);
  const now = (deps.now ?? (() => new Date()))();

  return inTransaction(deps.pool, async (c) => {
    if (typeof then.operatingCompanyId === "string") await assertGovernedCompany(c, actor.tenantId, then.operatingCompanyId);
    const before = await c.query(`SELECT * FROM eos_ops.inbound_routing_rules WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, input.ruleId]);
    await c.query(
      `INSERT INTO eos_ops.inbound_routing_rules
         (tenant_id, id, name, enabled, rule_order, when_condition, then_outcome, updated_by_principal_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$9)
       ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, enabled = EXCLUDED.enabled, rule_order = EXCLUDED.rule_order,
         when_condition = EXCLUDED.when_condition, then_outcome = EXCLUDED.then_outcome,
         updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = EXCLUDED.updated_at,
         version = inbound_routing_rules.version + 1`,
      [actor.tenantId, input.ruleId, name, enabled, order, JSON.stringify(when), JSON.stringify(then), actor.principalId, now]);
    const saved: RoutingRule = { id: input.ruleId as string, name: name as string, enabled, order: order as number, when, then };
    const b = before.rows[0];
    await writeAudit(c, actor, "inboundWork.routingRule.save", "inboundRoutingRule", saved.id,
      b ? { name: b.name, enabled: b.enabled, order: b.rule_order, when: b.when_condition, then: b.then_outcome } : null, saved, null, now);
    return saved;
  });
}

/** The configuration an intake administrator sees: mailboxes, rules, and the intake counts by status. */
export async function readInboundIntakeConfiguration(deps: { readonly pool: Pool }, actor: LifecycleActor): Promise<unknown> {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  const [mailboxes, rules, counts] = await Promise.all([
    deps.pool.query(`SELECT * FROM eos_ops.inbound_mailboxes WHERE tenant_id = $1 ORDER BY id`, [actor.tenantId]),
    readRules(deps.pool, actor.tenantId),
    deps.pool.query(`SELECT status, count(*)::int n FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 GROUP BY status`, [actor.tenantId]),
  ]);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of counts.rows) { byStatus[r.status] = r.n; total += r.n; }
  return { mailboxes: mailboxes.rows.map(mailboxFromRow), rules, overview: { total, byStatus } };
}

// ════════════════════ intake ════════════════════

export interface IngestOutcome {
  readonly requestId: string;
  readonly outcome: "CREATED" | "DUPLICATE" | "THREAD_MATCH" | "AMBIGUOUS" | "QUARANTINED" | "FAILED";
  readonly status: PgInboundWorkStatus;
  readonly duplicateOfRequestId: string | null;
}

export interface IngestInput {
  readonly message: NormalizedInboundMessage;
  readonly processingProvider?: InboundProcessingProvider;
  /** An external/VDX provider's result, normalized through the provider-neutral contract. */
  readonly providerResult?: unknown;
}

const PROCESSING_PROVIDERS = ["EOS_NATIVE", "VDX", "EXTERNAL"];

async function insertMessage(
  c: PoolClient, actor: LifecycleActor, requestId: string, message: NormalizedInboundMessage, normalizedBody: string,
  role: "ORIGINAL" | "REPLY", matchedOn: string | null, now: Date,
): Promise<void> {
  await c.query(
    `INSERT INTO eos_ops.inbound_work_messages
       (id, tenant_id, request_id, mailbox_id, provider_message_id, thread_id, in_reply_to, message_references, received_at,
        sender, subject, normalized_body, attachment_refs, message_role, matched_on, recorded_by_principal_id, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)`,
    [`ibm_${randomUUID()}`, actor.tenantId, requestId, message.mailboxId, message.messageId, message.threadId, message.inReplyTo,
      JSON.stringify(message.references), toTimestamp(message.receivedAt), message.sender, message.subject, normalizedBody,
      JSON.stringify(message.attachments), role, matchedOn, actor.principalId, now]);
}

/** Every intake that could plausibly be this message's thread: same provider thread id, or a referenced message id. */
async function readThreadCandidates(c: PoolClient, tenantId: string, message: NormalizedInboundMessage): Promise<ExistingIntakeRef[]> {
  const referenced = [message.inReplyTo, ...message.references].filter((v): v is string => Boolean(v)).slice(0, 10);
  const ids = new Set<string>();
  if (message.threadId) {
    const { rows } = await c.query(`SELECT id FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND source_thread_id = $2 ORDER BY id LIMIT 10`,
      [tenantId, message.threadId]);
    rows.forEach((r) => ids.add(String(r.id)));
  }
  const probe = [...referenced, message.messageId];
  const { rows: byMsg } = await c.query(
    `SELECT DISTINCT request_id FROM eos_ops.inbound_work_messages WHERE tenant_id = $1 AND provider_message_id = ANY($2::text[]) LIMIT 20`,
    [tenantId, probe]);
  byMsg.forEach((r) => ids.add(String(r.request_id)));
  if (ids.size === 0) return [];
  const { rows } = await c.query(
    `SELECT r.id, r.source_message_id, r.source_thread_id, r.status, r.work_order_id,
            coalesce((SELECT array_agg(m.provider_message_id) FROM eos_ops.inbound_work_messages m
                       WHERE m.tenant_id = r.tenant_id AND m.request_id = r.id), '{}') AS message_ids
       FROM eos_ops.inbound_work_requests r WHERE r.tenant_id = $1 AND r.id = ANY($2::text[])`,
    [tenantId, [...ids]]);
  return rows.map((r) => ({
    id: String(r.id), sourceMessageId: String(r.source_message_id), sourceThreadId: r.source_thread_id ?? null,
    messageIds: (r.message_ids as string[]) ?? [], status: r.status, workItemId: r.work_order_id ?? null,
  }));
}

/**
 * Take one normalized message into intake. The whole decision -- duplicate, reply, quarantine, or new -- happens in
 * ONE transaction, serialized per (tenant, mailbox, message), so a retry of the same delivery converges on the same
 * record rather than racing itself.
 */
export async function ingestInboundMessage(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: LifecycleActor,
  input: IngestInput,
): Promise<IngestOutcome> {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  let message: NormalizedInboundMessage;
  try {
    message = normalizeInboundMessage(input?.message);
  } catch (err) {
    return refuse("MESSAGE_INVALID", "INVALID_INPUT", boundedString((err as Error).message, 300) || "the message could not be read");
  }
  const normalizedBody = toPlainText(message.originalBody, message.originalBodyContentType);
  const requestId = inboundRequestId(actor.tenantId, message.mailboxId, message.messageId);
  const now = (deps.now ?? (() => new Date()))();

  // Processing runs BEFORE the transaction; a failure is a RETAINED FAILED intake, never a lost message.
  const provider = (input.processingProvider ?? "EOS_NATIVE") as InboundProcessingProvider;
  if (!PROCESSING_PROVIDERS.includes(provider)) refuse("PROCESSING_PROVIDER_INVALID", "INVALID_INPUT", "processingProvider is EOS_NATIVE, VDX or EXTERNAL");
  let processing: InboundProcessingResult = EMPTY_PROCESSING_RESULT;
  let processingError = "";
  try {
    processing = provider === "EOS_NATIVE"
      ? processInboundMessageNatively(message, normalizedBody)
      : normalizeProcessingResult(input.providerResult, provider);
  } catch (err) {
    processingError = boundedString(err instanceof Error ? err.message : String(err), 500) || "processing failed";
  }
  let candidates = {
    customerCandidate: processing.customerCandidate,
    locationCandidate: processing.locationCandidate,
    equipmentCandidate: processing.equipmentCandidate,
  };
  if (!processingError && !candidates.equipmentCandidate.id && !candidates.customerCandidate.id) {
    candidates = await resolveInboundCandidates(deps.pool, actor.tenantId, { senderEmail: message.sender, serialNumber: processing.serialNumber });
  }
  const cKey = contentKey(message, normalizedBody);

  const retained = (status: PgInboundWorkStatus, note: string | null) => ({
    source_provider: message.provider, source_connection_id: message.connectionId, source_mailbox_id: message.mailboxId,
    source_message_id: message.messageId, source_thread_id: message.threadId, content_key: cKey,
    received_at: toTimestamp(message.receivedAt), sender: message.sender, recipients: JSON.stringify(message.recipients),
    cc: JSON.stringify(message.cc), subject: message.subject, original_body: message.originalBody,
    original_body_content_type: message.originalBodyContentType, normalized_body: normalizedBody,
    attachment_refs: JSON.stringify(message.attachments), status, status_note: note,
  });
  const insertRequest = async (c: PoolClient, fields: Record<string, unknown>) => {
    const cols = ["tenant_id", "id", "ingested_by_principal_id", "created_at", "updated_at", ...Object.keys(fields)];
    const vals = [actor.tenantId, requestId, actor.principalId, now, now, ...Object.values(fields)];
    await c.query(`INSERT INTO eos_ops.inbound_work_requests (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
  };

  try {
    return await inTransaction(deps.pool, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`inbound|${actor.tenantId}|${message.mailboxId}|${message.messageId}`]);

      // 1. THE SAME MESSAGE, TWICE -- as an intake of its own, or as a reply already preserved on one.
      const seen = await c.query(
        `SELECT m.request_id, r.status FROM eos_ops.inbound_work_messages m
           JOIN eos_ops.inbound_work_requests r ON r.tenant_id = m.tenant_id AND r.id = m.request_id
          WHERE m.tenant_id = $1 AND m.mailbox_id = $2 AND m.provider_message_id = $3`,
        [actor.tenantId, message.mailboxId, message.messageId]);
      if (seen.rows.length) {
        return { requestId: String(seen.rows[0].request_id), outcome: "DUPLICATE", status: seen.rows[0].status, duplicateOfRequestId: null } as IngestOutcome;
      }

      // 2. AN UNKNOWN OR DISABLED MAILBOX IS QUARANTINED, NOT DISCARDED.
      const mailbox = await readMailbox(c, actor.tenantId, message.mailboxId);
      if (!mailbox || mailbox.status === "DISABLED" || !mailbox.inboundEnabled) {
        const note = mailbox ? "Mailbox is not accepting inbound work." : "Message arrived in a mailbox EOS does not know.";
        await insertRequest(c, { ...retained("QUARANTINED", note), source_mailbox_name: mailbox?.displayName ?? null });
        await insertMessage(c, actor, requestId, message, normalizedBody, "ORIGINAL", null, now);
        await writeAudit(c, actor, "inboundWork.request.quarantine", "inboundWorkRequest", requestId, null,
          { status: "QUARANTINED", mailboxId: message.mailboxId, sourceMessageId: message.messageId, sender: message.sender }, note, now);
        return { requestId, outcome: "QUARANTINED", status: "QUARANTINED", duplicateOfRequestId: null } as IngestOutcome;
      }

      // 3. A REPLY ON WORK WE ALREADY HAVE.
      const threadCandidates = mailbox.threadingEnabled ? await readThreadCandidates(c, actor.tenantId, message) : [];
      const association = associateInboundMessage(
        { messageId: message.messageId, threadId: message.threadId, inReplyTo: message.inReplyTo, references: message.references },
        threadCandidates);
      if (association.outcome === "DUPLICATE") {
        const { rows } = await c.query(`SELECT status FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2`,
          [actor.tenantId, association.requestId]);
        return { requestId: association.requestId as string, outcome: "DUPLICATE", status: rows[0]?.status, duplicateOfRequestId: null } as IngestOutcome;
      }
      if (association.outcome === "THREAD_MATCH") {
        const target = association.requestId as string;
        const { rows } = await c.query(
          `SELECT status, attachment_refs FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, target]);
        const attachments = ((rows[0].attachment_refs as unknown[]) ?? []).concat(message.attachments).slice(0, MAX_ATTACHMENTS * 4);
        await insertMessage(c, actor, target, message, normalizedBody, "REPLY", association.matchedOn, now);
        await c.query(
          `UPDATE eos_ops.inbound_work_requests SET attachment_refs = $3::jsonb, updated_at = $4, version = version + 1
            WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, target, JSON.stringify(attachments), now]);
        await writeAudit(c, actor, "inboundWork.request.linkThreadMessage", "inboundWorkRequest", target, null,
          { providerMessageId: message.messageId, matchedOn: association.matchedOn }, null, now);
        return { requestId: target, outcome: "THREAD_MATCH", status: rows[0].status, duplicateOfRequestId: null } as IngestOutcome;
      }

      // 4. A NEW INTAKE. Routing (an administrator's rules) classifies; a person decides.
      const rules = await readRules(c, actor.tenantId);
      const routing = evaluateRouting(rules, {
        mailboxId: message.mailboxId, sender: message.sender, subject: message.subject, normalizedBody,
        hasAttachments: message.attachments.length > 0,
      });
      const ambiguous = association.outcome === "AMBIGUOUS";
      const sameContent = await c.query(
        `SELECT id FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND content_key = $2 ORDER BY created_at, id LIMIT 1`,
        [actor.tenantId, cKey]);
      const duplicateOf = sameContent.rows.length ? String(sameContent.rows[0].id) : null;
      const status: PgInboundWorkStatus = processingError
        ? "FAILED"
        : ambiguous || duplicateOf || routing.outcome.manualReview === true ? "NEEDS_REVIEW" : "AWAITING_DECISION";
      const note = ambiguous ? "Reply matched more than one open intake."
        : duplicateOf ? "Identical content to an earlier intake under a different message id." : null;
      const requestType = routing.outcome.requestType ?? processing.requestType ?? null;
      await insertRequest(c, {
        ...retained(status, note),
        duplicate_of_request_id: duplicateOf,
        source_mailbox_name: boundedString(mailbox.displayName, 120) || null,
        request_type: requestType && (INBOUND_REQUEST_TYPES as readonly string[]).includes(requestType) ? requestType : null,
        destination: routing.outcome.destination ?? mailbox.destination ?? "SERVICE",
        queue: routing.outcome.queue ?? mailbox.defaultQueue ?? null,
        // A SUGGESTION from EOS configuration (a rule, else the mailbox). An inbound message never names its own
        // operating company, and Accept requires the reviewer to STATE one.
        suggested_operating_company_id: routing.outcome.operatingCompanyId ?? mailbox.suggestedOperatingCompanyId ?? null,
        priority: routing.outcome.priority ?? processing.priority ?? null,
        routing_rule_id: routing.ruleId,
        routing_rule_name: routing.ruleId ? boundedString(rules.find((r) => r.id === routing.ruleId)?.name, 120) || null : null,
        routing_outcome: routing.reason,
        thread_association: association.outcome,
        thread_association_candidate_ids: JSON.stringify(association.candidateIds),
        customer_candidate: JSON.stringify(candidates.customerCandidate),
        location_candidate: JSON.stringify(candidates.locationCandidate),
        equipment_candidate: JSON.stringify(candidates.equipmentCandidate),
        external_reference: processing.externalReference,
        authorization_number: processing.authorizationNumber,
        problem_description: processing.problemDescription,
        serial_number: processing.serialNumber,
        model_number: processing.modelNumber,
        warnings: JSON.stringify(processing.warnings),
        processing_provider: provider,
        processing_metadata: JSON.stringify(processing.providerMetadata),
        processing_error: processingError || null,
      });
      await insertMessage(c, actor, requestId, message, normalizedBody, "ORIGINAL", null, now);
      await writeAudit(c, actor, processingError ? "inboundWork.request.fail" : "inboundWork.request.create", "inboundWorkRequest", requestId, null,
        { status, requestType, routingRuleId: routing.ruleId, sender: message.sender, sourceMessageId: message.messageId,
          threadAssociation: association.outcome, duplicateOfRequestId: duplicateOf }, processingError || null, now);
      return {
        requestId,
        outcome: processingError ? "FAILED" : ambiguous ? "AMBIGUOUS" : "CREATED",
        status,
        duplicateOfRequestId: duplicateOf,
      } as IngestOutcome;
    });
  } catch (err) {
    // A concurrent delivery of the same message won the unique key: answer with ITS record.
    if ((err as { code?: string })?.code === "23505") {
      const { rows } = await deps.pool.query(
        `SELECT m.request_id, r.status FROM eos_ops.inbound_work_messages m
           JOIN eos_ops.inbound_work_requests r ON r.tenant_id = m.tenant_id AND r.id = m.request_id
          WHERE m.tenant_id = $1 AND m.mailbox_id = $2 AND m.provider_message_id = $3`,
        [actor.tenantId, message.mailboxId, message.messageId]);
      if (rows.length) return { requestId: String(rows[0].request_id), outcome: "DUPLICATE", status: rows[0].status, duplicateOfRequestId: null };
    }
    throw err;
  }
}

/**
 * THE NON-PRODUCTION DELIVERY SEAM (parity: deliverInboundEmailMessage). Takes a message in the PROVIDER'S OWN native
 * shape (a Microsoft Graph message resource or a Gmail users.messages resource) and runs it through the identical
 * adapter and intake path a real poll would use. The EOS API refuses to start with EOS_ENVIRONMENT=production.
 */
export async function deliverInboundMessage(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: LifecycleActor,
  input: Record<string, unknown>,
): Promise<IngestOutcome> {
  requireCapability(actor, INBOUND_INTAKE_MANAGE);
  only(input, ["provider", "mailboxId", "connectionId", "message", "processingProvider", "providerResult"]);
  if (!isEmailProviderId(input.provider)) refuse("PROVIDER_INVALID", "INVALID_INPUT", "provider must be MICROSOFT_365 or GOOGLE_WORKSPACE");
  if (!isId(input.mailboxId)) refuse("MAILBOX_ID_REQUIRED", "INVALID_INPUT", "mailboxId is required");
  let message: NormalizedInboundMessage;
  try {
    message = normalizeProviderMessage(input.provider as never, input.message, {
      connectionId: boundedString(input.connectionId, 255), mailboxId: input.mailboxId as string,
    });
  } catch (err) {
    return refuse("MESSAGE_INVALID", "INVALID_INPUT", boundedString((err as Error).message, 300) || "the provider message could not be read");
  }
  return ingestInboundMessage(deps, actor, {
    message,
    processingProvider: input.processingProvider as InboundProcessingProvider | undefined,
    providerResult: input.providerResult,
  });
}
