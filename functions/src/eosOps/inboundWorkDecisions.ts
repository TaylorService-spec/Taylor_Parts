// INBOUND WORK -- THE GOVERNED READS AND THE THREE DECISIONS: accept, decline, attach (PostgreSQL port of
// functions/src/inboundWork/inboundDecisionCommands.ts and inboundWorkReadService.ts).
//
// ════════════════════ ACCEPT -> THE GOVERNED EOS WORK ORDER CREATE ════════════════════
//
// Accept creates the Work Order through createWorkOrder (workOrderCreateCommand.ts) -- the SAME governed command a
// dispatcher's wizard uses -- so it gains no private write path: the caller must hold workOrder.create as well as
// inboundWork.request.accept, and the OPERATING COMPANY IS STATED BY THE REVIEWER, validated as governed and keyed by
// the create itself. It is never inferred from the sender, the mailbox, a routing rule or the customer: those only
// SUGGEST one, and the suggestion is shown, not used.
//
// TWO CLICKS CANNOT MAKE TWO WORK ORDERS, and neither can two reviewers or a crash:
//   1. a short transaction locks the intake and CLAIMS it (ACCEPTING, naming the claiming Principal). An ACCEPTED
//      intake replays the Work Order it became; another Principal's in-flight claim refuses ACCEPT_IN_PROGRESS;
//   2. createWorkOrder runs with a DETERMINISTIC idempotency key derived from the intake id (inbound-accept:<id>), so a
//      retry by the claimant -- after a lost response or a crash between the create and step 3 -- replays the SAME
//      Work Order instead of minting a second one;
//   3. a second transaction records ACCEPTED, the append-only Work Order link and the audit events together.
// A create that FAILS releases the claim back to the prior status -- unless a Work Order under the key exists, in which
// case the claim is kept so only the claimant can complete it (releasing it would let a second reviewer create twice).
//
// ════════════════════ MASTER DATA IS NOT TOUCHED ════════════════════
//
// The reviewer's chosen customer / location / equipment are re-read and proven to belong together inside the claim
// transaction (the picker is a convenience, not evidence). Nothing here creates or edits an Account, Location,
// Contact or Equipment record.
import type { Pool } from "pg";
import type { LifecycleActor } from "./workOrderLifecycle";
import { createWorkOrder, WORK_ORDER_CREATE } from "./workOrderCreateCommand";
import {
  DECIDABLE,
  INBOUND_INTAKE_MANAGE,
  INBOUND_WORK_ACCEPT,
  INBOUND_WORK_ATTACH,
  INBOUND_WORK_DECLINE,
  INBOUND_WORK_READ,
  MAX_THREAD_MESSAGES,
  PG_INBOUND_WORK_STATUSES,
  inTransaction,
  isId,
  only,
  refuse,
  requireCapability,
  writeAudit,
} from "./inboundWorkIntake";
import { INBOUND_DECLINE_REASONS, INBOUND_REQUEST_TYPES, boundedString, toPlainText } from "../inboundWork/inboundWorkModel";

type Deps = { readonly pool: Pool; readonly now?: () => Date };

/** The deterministic create key: one intake, one Work Order. */
export const acceptIdempotencyKey = (requestId: string): string => `inbound-accept:${requestId}`;

/** Inbound classification -> the native Work Order type. SERVICE / PARTS / OTHER are ordinary service calls. */
export function workOrderTypeForRequestType(requestType: string | null | undefined): string {
  switch (requestType) {
    case "WARRANTY": return "WARRANTY";
    case "INSTALL": return "INSTALL";
    case "PM": return "PM";
    default: return "SERVICE_CALL";
  }
}

// ════════════════════ reads ════════════════════

export const DEFAULT_QUEUE_LIMIT = 100;
export const MAX_QUEUE_LIMIT = 300;
const DEFAULT_QUEUE_STATUSES = ["AWAITING_DECISION", "NEEDS_REVIEW", "ACCEPTING", "FAILED", "QUARANTINED", "ACCEPTED", "DECLINED", "ATTACHED"];

const millis = (v: unknown): number => (v instanceof Date ? v.getTime() : v ? new Date(String(v)).getTime() : 0);
const candidateId = (v: unknown): string | null => {
  const id = (v as { id?: unknown } | null)?.id;
  return typeof id === "string" && id ? id : null;
};

function queueRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    status: String(r.status),
    receivedAt: millis(r.received_at),
    sender: String(r.sender ?? ""),
    subject: String(r.subject ?? ""),
    requestType: (r.request_type as string | null) ?? null,
    priority: r.priority === null || r.priority === undefined ? null : Number(r.priority),
    queue: (r.queue as string | null) ?? null,
    // The routed SUGGESTION, and the company the reviewer STATED at Accept -- two different facts, two fields.
    suggestedOperatingCompanyId: (r.suggested_operating_company_id as string | null) ?? null,
    operatingCompanyId: (r.operating_company_id as string | null) ?? null,
    customerCandidateId: candidateId(r.customer_candidate),
    equipmentCandidateId: candidateId(r.equipment_candidate),
    attachmentCount: Array.isArray(r.attachment_refs) ? r.attachment_refs.length : 0,
    warnings: Array.isArray(r.warnings) ? (r.warnings as unknown[]).map((w) => String(w)) : [],
    workItemId: (r.work_order_id as string | null) ?? null,
    workOrderId: (r.work_order_id as string | null) ?? null,
    duplicateOfRequestId: (r.duplicate_of_request_id as string | null) ?? null,
  };
}

export async function listInboundWork(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_READ);
  only(input, ["statuses", "limit"]);
  let statuses = DEFAULT_QUEUE_STATUSES;
  if (input.statuses !== undefined) {
    if (!Array.isArray(input.statuses) || input.statuses.length === 0
      || input.statuses.some((s) => !(PG_INBOUND_WORK_STATUSES as readonly string[]).includes(s as string))) {
      refuse("STATUSES_INVALID", "INVALID_INPUT", `statuses is a non-empty list of ${PG_INBOUND_WORK_STATUSES.join(", ")}`);
    }
    statuses = input.statuses as string[];
  }
  const limit = input.limit === undefined ? DEFAULT_QUEUE_LIMIT : input.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_QUEUE_LIMIT) {
    refuse("LIMIT_INVALID", "INVALID_INPUT", `limit is an integer 1-${MAX_QUEUE_LIMIT}`);
  }
  const { rows } = await deps.pool.query(
    `SELECT id, status, received_at, sender, subject, request_type, priority, queue, suggested_operating_company_id,
            operating_company_id, customer_candidate, equipment_candidate, attachment_refs, warnings, work_order_id,
            duplicate_of_request_id
       FROM eos_ops.inbound_work_requests
      WHERE tenant_id = $1 AND status = ANY($2::text[])
      ORDER BY received_at DESC NULLS LAST, created_at DESC, id LIMIT $3`,
    [actor.tenantId, statuses, (limit as number) + 1]);
  return { rows: rows.slice(0, limit as number).map(queueRow), truncated: rows.length > (limit as number) };
}

/** One intake's review detail. The stored markup (original_body) is NEVER projected: originalBodyText is plain text. */
export async function readInboundWorkRequest(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_READ);
  only(input, ["requestId"]);
  if (!isId(input.requestId)) refuse("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
  const { rows } = await deps.pool.query(
    `SELECT r.*, w.work_order_number, l.link_kind
       FROM eos_ops.inbound_work_requests r
       LEFT JOIN eos_ops.work_orders w ON w.tenant_id = r.tenant_id AND w.id = r.work_order_id
       LEFT JOIN eos_ops.inbound_work_order_links l ON l.tenant_id = r.tenant_id AND l.request_id = r.id
      WHERE r.tenant_id = $1 AND r.id = $2`, [actor.tenantId, input.requestId]);
  if (rows.length === 0) refuse("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
  const r = rows[0];
  const replies = await deps.pool.query(
    `SELECT provider_message_id, received_at, sender, subject, normalized_body, matched_on
       FROM eos_ops.inbound_work_messages WHERE tenant_id = $1 AND request_id = $2 AND message_role = 'REPLY'
      ORDER BY recorded_at, id LIMIT $3`, [actor.tenantId, r.id, MAX_THREAD_MESSAGES]);
  const normalizedBody = String(r.normalized_body ?? "");
  return {
    ...queueRow(r),
    statusNote: r.status_note ?? null,
    sourceChannel: r.source_channel,
    sourceProvider: r.source_provider,
    sourceConnectionId: r.source_connection_id,
    sourceMailboxId: r.source_mailbox_id,
    sourceMailboxName: r.source_mailbox_name ?? null,
    sourceMessageId: r.source_message_id,
    sourceThreadId: r.source_thread_id ?? null,
    recipients: r.recipients ?? [],
    cc: r.cc ?? [],
    // Converted again on the way out rather than trusted (parity with inboundWorkReadService).
    originalBodyText: normalizedBody || toPlainText(r.original_body, r.original_body_content_type === "text/plain" ? "text/plain" : "text/html"),
    normalizedBody,
    // METADATA ONLY: the bytes stay with the provider runtime (attachment custody is the provider boundary).
    attachmentRefs: ((r.attachment_refs as Record<string, unknown>[]) ?? []).map((a) => ({
      filename: String(a.filename ?? ""), mimeType: String(a.mimeType ?? ""), size: typeof a.size === "number" ? a.size : 0,
      contentHash: (a.contentHash as string | null) ?? null, providerAttachmentId: String(a.providerAttachmentId ?? ""),
      sourceMessageId: String(a.sourceMessageId ?? ""), receivedAt: typeof a.receivedAt === "number" ? a.receivedAt : 0,
      custody: "METADATA_ONLY",
    })),
    attachmentCustody: Array.isArray(r.attachment_refs) && r.attachment_refs.length ? "METADATA_ONLY" : "NONE",
    threadMessages: replies.rows.map((m) => ({
      messageId: m.provider_message_id, receivedAt: millis(m.received_at), sender: m.sender, subject: m.subject,
      normalizedBody: toPlainText(m.normalized_body, "text/plain"), matchedOn: m.matched_on ?? null,
    })),
    customerCandidate: r.customer_candidate ?? null,
    locationCandidate: r.location_candidate ?? null,
    equipmentCandidate: r.equipment_candidate ?? null,
    externalReference: r.external_reference ?? null,
    authorizationNumber: r.authorization_number ?? null,
    problemDescription: r.problem_description ?? null,
    serialNumber: r.serial_number ?? null,
    modelNumber: r.model_number ?? null,
    routingRuleId: r.routing_rule_id ?? null,
    routingRuleName: r.routing_rule_name ?? null,
    routingOutcome: r.routing_outcome ?? null,
    destination: r.destination ?? null,
    threadAssociation: r.thread_association ?? null,
    threadAssociationCandidateIds: r.thread_association_candidate_ids ?? [],
    processingProvider: r.processing_provider,
    processingError: r.processing_error ?? null,
    decision: r.decision ?? null,
    decisionReason: r.decision_reason ?? null,
    decisionNote: r.decision_note ?? null,
    decisionBy: r.decision_by_principal_id ?? null,
    decisionAt: r.decision_at ? millis(r.decision_at) : null,
    customerId: r.customer_id ?? null,
    customerLocationId: r.customer_location_id ?? null,
    equipmentId: r.equipment_id ?? null,
    workOrderNumber: r.work_order_number ?? null,
    workOrderLinkKind: r.link_kind ?? null,
  };
}

/** The caller's OWN inbound decisions -- a hint for rendering controls. Every command still re-authorizes. */
export function readInboundWorkAccess(actor: LifecycleActor) {
  const has = (k: string) => actor.capabilities instanceof Set && actor.capabilities.has(k);
  return {
    canRead: has(INBOUND_WORK_READ),
    canAccept: has(INBOUND_WORK_ACCEPT) && has(WORK_ORDER_CREATE),
    canDecline: has(INBOUND_WORK_DECLINE),
    canAttach: has(INBOUND_WORK_ATTACH),
    canManageIntake: has(INBOUND_INTAKE_MANAGE),
  };
}

// ════════════════════ accept ════════════════════

const ACCEPT_INPUT = ["requestId", "operatingCompanyId", "customerId", "locationId", "equipmentId", "requestType", "priority", "problemDescription"];

export async function acceptInboundWork(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_ACCEPT);
  requireCapability(actor, WORK_ORDER_CREATE);
  only(input, ACCEPT_INPUT);
  const requestId = input.requestId;
  if (!isId(requestId)) refuse("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
  if (!isId(input.operatingCompanyId)) {
    refuse("OPERATING_COMPANY_REQUIRED", "INVALID_INPUT",
      "the reviewer states the operating company; it is never inferred from the sender, the mailbox, a routing rule or the customer");
  }
  if (!isId(input.customerId)) refuse("CUSTOMER_REQUIRED", "INVALID_INPUT", "a customer must be selected before accepting");
  if (!isId(input.locationId)) refuse("LOCATION_REQUIRED", "INVALID_INPUT", "a location must be selected before accepting");
  const equipmentId = input.equipmentId === undefined || input.equipmentId === null || input.equipmentId === "" ? null : input.equipmentId;
  if (equipmentId !== null && !isId(equipmentId)) refuse("EQUIPMENT_INVALID", "INVALID_INPUT", "equipmentId, when stated, is an id");
  if (input.requestType !== undefined && input.requestType !== null && !(INBOUND_REQUEST_TYPES as readonly string[]).includes(input.requestType as string)) {
    refuse("REQUEST_TYPE_INVALID", "INVALID_INPUT", `requestType is one of ${INBOUND_REQUEST_TYPES.join(", ")}`);
  }
  if (input.priority !== undefined && input.priority !== null && !(Number.isInteger(input.priority) && (input.priority as number) >= 1 && (input.priority as number) <= 4)) {
    refuse("PRIORITY_INVALID", "INVALID_INPUT", "priority is a governed 1-4");
  }
  if (input.problemDescription !== undefined && input.problemDescription !== null && typeof input.problemDescription !== "string") {
    refuse("PROBLEM_INVALID", "INVALID_INPUT", "problemDescription is text");
  }
  const operatingCompanyId = input.operatingCompanyId as string;
  const customerId = input.customerId as string;
  const locationId = input.locationId as string;
  const now = (deps.now ?? (() => new Date()))();

  // ── 1. CLAIM ──
  const claim = await inTransaction(deps.pool, async (c) => {
    const { rows } = await c.query(`SELECT * FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, requestId]);
    if (rows.length === 0) refuse("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
    const r = rows[0];
    // REPLAY, NOT A SECOND WORK ORDER. An accepted intake returns what it became, to anyone who may accept.
    if (r.status === "ACCEPTED") return { replay: r } as const;
    if (r.status === "ACCEPTING" && r.accept_claimed_by_principal_id !== actor.principalId) {
      refuse("ACCEPT_IN_PROGRESS", "CONFLICT", "another reviewer's Accept of this request is in progress");
    }
    if (r.status !== "ACCEPTING" && !DECIDABLE.has(r.status)) {
      refuse("ALREADY_DECIDED", "PRECONDITION_FAILED", `this request is ${r.status} and can no longer be accepted`);
    }
    // IDENTITY IS PROVEN FROM THE STORED RECORDS. The picker filtered the choices; a filter is not evidence.
    const account = await c.query(`SELECT 1 FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, customerId]);
    if (account.rows.length === 0) refuse("CUSTOMER_NOT_FOUND", "NOT_FOUND", "the selected customer does not exist");
    const location = await c.query(`SELECT account_id FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, locationId]);
    if (location.rows.length === 0) refuse("LOCATION_NOT_FOUND", "NOT_FOUND", "the selected location does not exist");
    if (location.rows[0].account_id !== customerId) {
      refuse("LOCATION_CUSTOMER_MISMATCH", "INVALID_INPUT", "the selected location belongs to a different customer");
    }
    const requestType = (input.requestType as string | null | undefined) ?? (r.request_type as string | null) ?? null;
    const workOrderType = workOrderTypeForRequestType(requestType);
    if (equipmentId !== null) {
      // Parity with WORK_ORDER_EQUIPMENT_RULE: an INSTALL cannot name a unit that does not exist yet.
      if (workOrderType === "INSTALL") {
        refuse("EQUIPMENT_NOT_ALLOWED_FOR_TYPE", "INVALID_INPUT", "an INSTALL Work Order cannot reference installed equipment at creation");
      }
      const eq = await c.query(`SELECT account_id, customer_location_id FROM eos_ops.equipment WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, equipmentId]);
      if (eq.rows.length === 0) refuse("EQUIPMENT_NOT_FOUND", "NOT_FOUND", "the referenced equipment does not exist");
      if (eq.rows[0].account_id !== customerId) refuse("EQUIPMENT_ACCOUNT_MISMATCH", "INVALID_INPUT", "the equipment belongs to a different customer");
      if (eq.rows[0].customer_location_id && eq.rows[0].customer_location_id !== locationId) {
        refuse("EQUIPMENT_LOCATION_MISMATCH", "INVALID_INPUT", "the equipment is installed at a different location");
      }
    }
    const priority = (input.priority as number | null | undefined) ?? (r.priority === null ? null : Number(r.priority)) ?? 3;
    // NO RE-TYPING: the problem the message described, unless the reviewer corrected it; the subject before blank.
    const complaint = boundedString(input.problemDescription, 500) || boundedString(r.problem_description, 500)
      || boundedString(r.subject, 500) || "Inbound request";
    if (r.status !== "ACCEPTING") {
      await c.query(
        `UPDATE eos_ops.inbound_work_requests SET status = 'ACCEPTING', accept_claimed_by_principal_id = $3,
                accept_claim_prior_status = status, updated_at = $4, version = version + 1
          WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, requestId, actor.principalId, now]);
    }
    return { claim: { r, requestType, workOrderType, priority, complaint } } as const;
  });

  if ("replay" in claim) {
    const r = claim.replay;
    const wo = await deps.pool.query(`SELECT work_order_number FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.work_order_id]);
    return { requestId, workOrderId: r.work_order_id, workItemId: r.work_order_id, workOrderNumber: wo.rows[0]?.work_order_number ?? null,
      operatingCompanyId: r.operating_company_id, replayed: true };
  }
  const { r, requestType, workOrderType, priority, complaint } = claim.claim;
  const key = acceptIdempotencyKey(requestId as string);

  // ── 2. THE GOVERNED CREATE ──
  let created;
  try {
    created = await createWorkOrder({ pool: deps.pool, now: deps.now },
      { tenantId: actor.tenantId, principalId: actor.principalId, capabilities: actor.capabilities, operatingCompanyId },
      { customerId, locationId, workOrderType, priority, complaint, idempotencyKey: key, ...(equipmentId ? { equipmentId: equipmentId as string } : {}) });
  } catch (err) {
    const exists = await deps.pool.query(
      `SELECT 1 FROM eos_ops.work_orders WHERE tenant_id = $1 AND created_by_principal_id = $2 AND create_idempotency_key = $3`,
      [actor.tenantId, actor.principalId, key]);
    if (exists.rows.length === 0) {
      await deps.pool.query(
        `UPDATE eos_ops.inbound_work_requests SET status = accept_claim_prior_status, accept_claimed_by_principal_id = NULL,
                accept_claim_prior_status = NULL, updated_at = $4, version = version + 1
          WHERE tenant_id = $1 AND id = $2 AND status = 'ACCEPTING' AND accept_claimed_by_principal_id = $3`,
        [actor.tenantId, requestId, actor.principalId, now]);
    }
    throw err;
  }

  // ── 3. RECORD ──
  return inTransaction(deps.pool, async (c) => {
    const { rows } = await c.query(`SELECT status, accept_claimed_by_principal_id, work_order_id FROM eos_ops.inbound_work_requests
                                     WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, requestId]);
    const cur = rows[0];
    if (cur.status === "ACCEPTED" && cur.work_order_id === created.workOrderId) {
      return { requestId, workOrderId: created.workOrderId, workItemId: created.workOrderId, workOrderNumber: created.workOrderNumber,
        operatingCompanyId, replayed: true };
    }
    if (cur.status !== "ACCEPTING" || cur.accept_claimed_by_principal_id !== actor.principalId) {
      refuse("ACCEPT_CLAIM_LOST", "CONFLICT", "this request is no longer claimed by this Accept");
    }
    await c.query(
      `UPDATE eos_ops.inbound_work_requests SET status = 'ACCEPTED', decision = 'ACCEPTED', decision_reason = NULL,
              decision_by_principal_id = $3, decision_at = $4, customer_id = $5, customer_location_id = $6, equipment_id = $7,
              request_type = $8, priority = $9, problem_description = $10, work_order_id = $11, operating_company_id = $12,
              accept_claimed_by_principal_id = NULL, accept_claim_prior_status = NULL, updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, requestId, actor.principalId, now, customerId, locationId, equipmentId, requestType, priority, complaint,
        created.workOrderId, operatingCompanyId]);
    // TWO EVENTS, as the Firebase path wrote: the DECISION on the intake, and the CREATE under the Work Order's own id.
    const auditId = await writeAudit(c, actor, "inboundWork.request.accept", "inboundWorkRequest", requestId as string,
      { status: r.status }, { status: "ACCEPTED", workOrderId: created.workOrderId, workOrderNumber: created.workOrderNumber,
        operatingCompanyId, suggestedOperatingCompanyId: r.suggested_operating_company_id ?? null, customerId, locationId,
        equipmentId, requestType, priority }, null, now);
    await writeAudit(c, actor, "workOrder.createFromInboundWork", "workOrder", created.workOrderId, null,
      { inboundWorkRequestId: requestId, workOrderNumber: created.workOrderNumber, externalReference: r.external_reference ?? null,
        authorizationNumber: r.authorization_number ?? null, idempotencyKey: key }, null, now);
    await c.query(
      `INSERT INTO eos_ops.inbound_work_order_links
         (id, tenant_id, request_id, work_order_id, link_kind, operating_company_id, external_reference, authorization_number,
          linked_by_principal_id, linked_at, audit_event_id)
       VALUES ($1,$2,$3,$4,'CREATED_BY_ACCEPT',$5,$6,$7,$8,$9,$10)`,
      [`iwl_${requestId}`, actor.tenantId, requestId, created.workOrderId, operatingCompanyId, r.external_reference ?? null,
        r.authorization_number ?? null, actor.principalId, now, auditId]);
    return { requestId, workOrderId: created.workOrderId, workItemId: created.workOrderId, workOrderNumber: created.workOrderNumber,
      operatingCompanyId, replayed: created.replayed };
  });
}

// ════════════════════ decline ════════════════════

/** Declined intake is RETAINED, never deleted: a decline reason is a reporting fact and an audit fact. */
export async function declineInboundWork(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_DECLINE);
  only(input, ["requestId", "reason", "note"]);
  if (!isId(input.requestId)) refuse("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
  if (!(INBOUND_DECLINE_REASONS as readonly string[]).includes(input.reason as string)) {
    refuse("DECLINE_REASON_REQUIRED", "INVALID_INPUT", `a decline reason is one of ${INBOUND_DECLINE_REASONS.join(", ")}`);
  }
  if (input.note !== undefined && input.note !== null && (typeof input.note !== "string" || input.note.length > 500)) {
    refuse("NOTE_INVALID", "INVALID_INPUT", "note is text of at most 500 characters");
  }
  const note = boundedString(input.note, 500) || null;
  const now = (deps.now ?? (() => new Date()))();
  return inTransaction(deps.pool, async (c) => {
    const { rows } = await c.query(`SELECT status FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, input.requestId]);
    if (rows.length === 0) refuse("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
    if (rows[0].status === "DECLINED") return { requestId: input.requestId, replayed: true };
    if (!DECIDABLE.has(rows[0].status)) refuse("ALREADY_DECIDED", "PRECONDITION_FAILED", `this request is ${rows[0].status} and can no longer be declined`);
    await c.query(
      `UPDATE eos_ops.inbound_work_requests SET status = 'DECLINED', decision = 'DECLINED', decision_reason = $3, decision_note = $4,
              decision_by_principal_id = $5, decision_at = $6, updated_at = $6, version = version + 1
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, input.requestId, input.reason, note, actor.principalId, now]);
    await writeAudit(c, actor, "inboundWork.request.decline", "inboundWorkRequest", input.requestId as string,
      { status: rows[0].status }, { status: "DECLINED", reason: input.reason, note }, input.reason as string, now);
    return { requestId: input.requestId, replayed: false };
  });
}

// ════════════════════ attach ════════════════════

const TERMINAL_WORK_ORDER_STATUSES = ["CLOSED", "CANCELLED"];

/**
 * The message belongs to work that already exists: the intake is filed against that EOS Work Order (append-only
 * link) and NO Work Order is created. The Work Order must exist in the caller's tenant and not be CLOSED / CANCELLED.
 */
export async function attachInboundWork(deps: Deps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_ATTACH);
  only(input, ["requestId", "workOrderId"]);
  if (!isId(input.requestId)) refuse("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
  if (!isId(input.workOrderId)) refuse("WORK_ORDER_REQUIRED", "INVALID_INPUT", "a Work Order must be selected");
  const now = (deps.now ?? (() => new Date()))();
  return inTransaction(deps.pool, async (c) => {
    const { rows } = await c.query(`SELECT status, work_order_id FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, input.requestId]);
    if (rows.length === 0) refuse("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
    const wo = await c.query(
      `SELECT id, work_order_number, status, customer_id, location_id FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
      [actor.tenantId, input.workOrderId]);
    if (rows[0].status === "ATTACHED" && rows[0].work_order_id === input.workOrderId) {
      return { requestId: input.requestId, workOrderId: input.workOrderId, workItemId: input.workOrderId,
        workOrderNumber: wo.rows[0]?.work_order_number ?? null, replayed: true };
    }
    if (!DECIDABLE.has(rows[0].status)) refuse("ALREADY_DECIDED", "PRECONDITION_FAILED", `this request is ${rows[0].status} and can no longer be attached`);
    if (wo.rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "that Work Order does not exist");
    const w = wo.rows[0];
    if (TERMINAL_WORK_ORDER_STATUSES.includes(w.status)) {
      refuse("WORK_ORDER_TERMINAL", "PRECONDITION_FAILED", `that Work Order is ${w.status}; inbound work is not filed against a finished job`);
    }
    // The Work Order is the authority on who the request is for -- never the email.
    await c.query(
      `UPDATE eos_ops.inbound_work_requests SET status = 'ATTACHED', decision = 'ATTACHED', decision_by_principal_id = $3,
              decision_at = $4, work_order_id = $5, customer_id = $6, customer_location_id = $7, updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, input.requestId, actor.principalId, now, w.id, w.customer_id, w.location_id]);
    const auditId = await writeAudit(c, actor, "inboundWork.request.attach", "inboundWorkRequest", input.requestId as string,
      { status: rows[0].status }, { status: "ATTACHED", workOrderId: w.id, workOrderNumber: w.work_order_number }, null, now);
    await c.query(
      `INSERT INTO eos_ops.inbound_work_order_links
         (id, tenant_id, request_id, work_order_id, link_kind, linked_by_principal_id, linked_at, audit_event_id)
       VALUES ($1,$2,$3,$4,'ATTACHED',$5,$6,$7)`,
      [`iwl_${input.requestId}`, actor.tenantId, input.requestId, w.id, actor.principalId, now, auditId]);
    return { requestId: input.requestId, workOrderId: w.id, workItemId: w.id, workOrderNumber: w.work_order_number, replayed: false };
  });
}
