"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_QUEUE_LIMIT = exports.DEFAULT_QUEUE_LIMIT = exports.acceptIdempotencyKey = void 0;
exports.recordClaimEvent = recordClaimEvent;
exports.workOrderTypeForRequestType = workOrderTypeForRequestType;
exports.listInboundWork = listInboundWork;
exports.readInboundWorkRequest = readInboundWorkRequest;
exports.readInboundWorkAccess = readInboundWorkAccess;
exports.acceptInboundWork = acceptInboundWork;
exports.declineInboundWork = declineInboundWork;
exports.attachInboundWork = attachInboundWork;
const workOrderCreateCommand_1 = require("./workOrderCreateCommand");
const workOrderQuarantine_1 = require("./workOrderQuarantine");
const inboundWorkIntake_1 = require("./inboundWorkIntake");
const inboundWorkModel_1 = require("../inboundWork/inboundWorkModel");
const node_crypto_1 = require("node:crypto");
/** Append one claim-history event. The table is append-only; nothing here or anywhere edits one. */
async function recordClaimEvent(c, tenantId, e) {
    await c.query(`INSERT INTO eos_ops.inbound_work_claim_events
       (id, tenant_id, request_id, event_kind, from_principal_id, to_principal_id, to_employee_id, actor_principal_id, reason,
        carried_work_order_id, occurred_at, audit_event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [`iwc_${(0, node_crypto_1.randomUUID)()}`, tenantId, e.requestId, e.kind, e.from, e.to, e.toEmployeeId ?? null, e.actor, e.reason ?? null,
        e.carriedWorkOrderId ?? null, e.at, e.auditEventId ?? null]);
}
/** The ACTIVE key binding of a governed operating company, or null (the carried-Work-Order comparison only). */
async function operatingCompanyKeyOrNull(pool, tenantId, companyId) {
    const { rows } = await pool.query(`SELECT operating_company_key FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`, [tenantId, companyId]);
    return rows.length === 1 ? String(rows[0].operating_company_key) : null;
}
/** The deterministic create key: one intake, one Work Order. */
const acceptIdempotencyKey = (requestId) => `inbound-accept:${requestId}`;
exports.acceptIdempotencyKey = acceptIdempotencyKey;
/** Inbound classification -> the native Work Order type. SERVICE / PARTS / OTHER are ordinary service calls. */
function workOrderTypeForRequestType(requestType) {
    switch (requestType) {
        case "WARRANTY": return "WARRANTY";
        case "INSTALL": return "INSTALL";
        case "PM": return "PM";
        default: return "SERVICE_CALL";
    }
}
// ════════════════════ reads ════════════════════
exports.DEFAULT_QUEUE_LIMIT = 100;
exports.MAX_QUEUE_LIMIT = 300;
const DEFAULT_QUEUE_STATUSES = ["AWAITING_DECISION", "NEEDS_REVIEW", "ACCEPTING", "FAILED", "QUARANTINED", "ACCEPTED", "DECLINED", "ATTACHED"];
const millis = (v) => (v instanceof Date ? v.getTime() : v ? new Date(String(v)).getTime() : 0);
const candidateId = (v) => {
    const id = v?.id;
    return typeof id === "string" && id ? id : null;
};
function queueRow(r) {
    return {
        id: String(r.id),
        status: String(r.status),
        receivedAt: millis(r.received_at),
        sender: String(r.sender ?? ""),
        subject: String(r.subject ?? ""),
        requestType: r.request_type ?? null,
        priority: r.priority === null || r.priority === undefined ? null : Number(r.priority),
        queue: r.queue ?? null,
        // The routed SUGGESTION, and the company the reviewer STATED at Accept -- two different facts, two fields.
        suggestedOperatingCompanyId: r.suggested_operating_company_id ?? null,
        operatingCompanyId: r.operating_company_id ?? null,
        customerCandidateId: candidateId(r.customer_candidate),
        equipmentCandidateId: candidateId(r.equipment_candidate),
        attachmentCount: Array.isArray(r.attachment_refs) ? r.attachment_refs.length : 0,
        warnings: Array.isArray(r.warnings) ? r.warnings.map((w) => String(w)) : [],
        workItemId: r.work_order_id ?? null,
        workOrderId: r.work_order_id ?? null,
        duplicateOfRequestId: r.duplicate_of_request_id ?? null,
        // ── what a reviewer needs to see at a glance (Controller SERVICE EXPERIENCE COMPLETION: final Service UX) ──
        createdAt: millis(r.created_at),
        sourceMailboxId: r.source_mailbox_id ?? null,
        sourceMailboxName: r.source_mailbox_name ?? null,
        destination: r.destination ?? null,
        statusNote: r.status_note ?? null,
        threadAssociation: r.thread_association ?? null,
        threadMessageCount: r.thread_message_count === undefined ? 0 : Number(r.thread_message_count),
        attachmentCustody: r.attachment_custody ?? "NONE",
        claimedByPrincipalId: r.accept_claimed_by_principal_id ?? null,
        claimedByEmployeeId: r.claimed_by_employee_id ?? null,
        claimedByName: r.claimed_by_name ?? null,
        claimedAt: r.accept_claimed_at ? millis(r.accept_claimed_at) : null,
        pendingWorkOrderId: r.accept_pending_work_order_id ?? null,
    };
}
/** The reviewer projection: the claimant's Employee identity and display name, never inferred. */
const CLAIMANT_COLUMNS = `
  (SELECT l.employee_id FROM eos_policy.employee_principal_links l
    WHERE l.tenant_id = r.tenant_id AND l.principal_id = r.accept_claimed_by_principal_id AND l.status = 'active' ORDER BY l.employee_id LIMIT 1) AS claimed_by_employee_id,
  (SELECT e.display_name FROM eos_policy.employee_principal_links l JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
    WHERE l.tenant_id = r.tenant_id AND l.principal_id = r.accept_claimed_by_principal_id AND l.status = 'active' ORDER BY l.employee_id LIMIT 1) AS claimed_by_name,
  (SELECT count(*)::int FROM eos_ops.inbound_work_messages m WHERE m.tenant_id = r.tenant_id AND m.request_id = r.id AND m.message_role = 'REPLY') AS thread_message_count`;
async function listInboundWork(deps, actor, input) {
    (0, inboundWorkIntake_1.requireCapability)(actor, inboundWorkIntake_1.INBOUND_WORK_READ);
    (0, inboundWorkIntake_1.only)(input, ["statuses", "limit"]);
    let statuses = DEFAULT_QUEUE_STATUSES;
    if (input.statuses !== undefined) {
        if (!Array.isArray(input.statuses) || input.statuses.length === 0
            || input.statuses.some((s) => !inboundWorkIntake_1.PG_INBOUND_WORK_STATUSES.includes(s))) {
            (0, inboundWorkIntake_1.refuse)("STATUSES_INVALID", "INVALID_INPUT", `statuses is a non-empty list of ${inboundWorkIntake_1.PG_INBOUND_WORK_STATUSES.join(", ")}`);
        }
        statuses = input.statuses;
    }
    const limit = input.limit === undefined ? exports.DEFAULT_QUEUE_LIMIT : input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > exports.MAX_QUEUE_LIMIT) {
        (0, inboundWorkIntake_1.refuse)("LIMIT_INVALID", "INVALID_INPUT", `limit is an integer 1-${exports.MAX_QUEUE_LIMIT}`);
    }
    const { rows } = await deps.pool.query(`SELECT r.id, r.status, r.received_at, r.sender, r.subject, r.request_type, r.priority, r.queue, r.suggested_operating_company_id,
            r.operating_company_id, r.customer_candidate, r.equipment_candidate, r.attachment_refs, r.warnings, r.work_order_id,
            r.duplicate_of_request_id, r.created_at, r.source_mailbox_id, r.source_mailbox_name, r.destination, r.status_note,
            r.thread_association, r.attachment_custody, r.accept_claimed_by_principal_id, r.accept_claimed_at, r.accept_pending_work_order_id,
            ${CLAIMANT_COLUMNS}
       FROM eos_ops.inbound_work_requests r
      WHERE r.tenant_id = $1 AND r.status = ANY($2::text[])
      ORDER BY r.received_at DESC NULLS LAST, r.created_at DESC, r.id LIMIT $3`, [actor.tenantId, statuses, limit + 1]);
    return { rows: rows.slice(0, limit).map(queueRow), truncated: rows.length > limit };
}
/** One intake's review detail. The stored markup (original_body) is NEVER projected: originalBodyText is plain text. */
async function readInboundWorkRequest(deps, actor, input) {
    (0, inboundWorkIntake_1.requireCapability)(actor, inboundWorkIntake_1.INBOUND_WORK_READ);
    (0, inboundWorkIntake_1.only)(input, ["requestId"]);
    if (!(0, inboundWorkIntake_1.isId)(input.requestId))
        (0, inboundWorkIntake_1.refuse)("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
    const { rows } = await deps.pool.query(`SELECT r.*, w.work_order_number, l.link_kind, ${CLAIMANT_COLUMNS}
       FROM eos_ops.inbound_work_requests r
       LEFT JOIN eos_ops.work_orders w ON w.tenant_id = r.tenant_id AND w.id = r.work_order_id
       LEFT JOIN eos_ops.inbound_work_order_links l ON l.tenant_id = r.tenant_id AND l.request_id = r.id
      WHERE r.tenant_id = $1 AND r.id = $2`, [actor.tenantId, input.requestId]);
    if (rows.length === 0)
        (0, inboundWorkIntake_1.refuse)("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
    const r = rows[0];
    const replies = await deps.pool.query(`SELECT provider_message_id, received_at, sender, subject, normalized_body, matched_on
       FROM eos_ops.inbound_work_messages WHERE tenant_id = $1 AND request_id = $2 AND message_role = 'REPLY'
      ORDER BY recorded_at, id LIMIT $3`, [actor.tenantId, r.id, inboundWorkIntake_1.MAX_THREAD_MESSAGES]);
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
        originalBodyText: normalizedBody || (0, inboundWorkModel_1.toPlainText)(r.original_body, r.original_body_content_type === "text/plain" ? "text/plain" : "text/html"),
        normalizedBody,
        // Custody per attachment: STORED bytes are read through readInboundAttachment (by attachmentId, through THIS
        // request); PENDING / FAILED / REFUSED_UNSAFE / METADATA_ONLY say exactly why there are no bytes.
        attachmentRefs: (r.attachment_refs ?? []).map((a) => ({
            filename: String(a.filename ?? ""), mimeType: String(a.mimeType ?? ""), size: typeof a.size === "number" ? a.size : 0,
            contentHash: a.contentHash ?? null, providerAttachmentId: String(a.providerAttachmentId ?? ""),
            sourceMessageId: String(a.sourceMessageId ?? ""), receivedAt: typeof a.receivedAt === "number" ? a.receivedAt : 0,
            custody: typeof a.custody === "string" ? a.custody : "METADATA_ONLY",
            custodyReason: a.custodyReason ?? null,
            attachmentId: a.attachmentId ?? null,
            failureCode: a.failureCode ?? null,
        })),
        attachmentCustody: r.attachment_custody ?? "NONE",
        threadMessages: replies.rows.map((m) => ({
            messageId: m.provider_message_id, receivedAt: millis(m.received_at), sender: m.sender, subject: m.subject,
            normalizedBody: (0, inboundWorkModel_1.toPlainText)(m.normalized_body, "text/plain"), matchedOn: m.matched_on ?? null,
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
        // THE CLAIM HISTORY, oldest first -- original reviewer, releases, reassignments and completion, never rewritten.
        claimHistory: (await deps.pool.query(`SELECT e.event_kind, e.from_principal_id, e.to_principal_id, e.to_employee_id, e.actor_principal_id, e.reason, e.carried_work_order_id,
              e.occurred_at,
              (SELECT x.display_name FROM eos_policy.employee_principal_links l JOIN eos_workforce.employees x ON x.tenant_id = l.tenant_id AND x.id = l.employee_id
                WHERE l.tenant_id = e.tenant_id AND l.principal_id = e.to_principal_id AND l.status = 'active' ORDER BY l.employee_id LIMIT 1) AS to_name,
              (SELECT x.display_name FROM eos_policy.employee_principal_links l JOIN eos_workforce.employees x ON x.tenant_id = l.tenant_id AND x.id = l.employee_id
                WHERE l.tenant_id = e.tenant_id AND l.principal_id = e.from_principal_id AND l.status = 'active' ORDER BY l.employee_id LIMIT 1) AS from_name
         FROM eos_ops.inbound_work_claim_events e WHERE e.tenant_id = $1 AND e.request_id = $2 ORDER BY e.occurred_at, e.event_seq LIMIT 200`, [actor.tenantId, r.id])).rows.map((e) => ({
            kind: e.event_kind, fromPrincipalId: e.from_principal_id ?? null, fromName: e.from_name ?? null,
            toPrincipalId: e.to_principal_id ?? null, toEmployeeId: e.to_employee_id ?? null, toName: e.to_name ?? null,
            actorPrincipalId: e.actor_principal_id, reason: e.reason ?? null, carriedWorkOrderId: e.carried_work_order_id ?? null,
            at: millis(e.occurred_at),
        })),
    };
}
/** The caller's OWN inbound decisions -- a hint for rendering controls. Every command still re-authorizes. */
function readInboundWorkAccess(actor) {
    const has = (k) => actor.capabilities instanceof Set && actor.capabilities.has(k);
    return {
        canRead: has(inboundWorkIntake_1.INBOUND_WORK_READ),
        canAccept: has(inboundWorkIntake_1.INBOUND_WORK_ACCEPT) && has(workOrderCreateCommand_1.WORK_ORDER_CREATE),
        canDecline: has(inboundWorkIntake_1.INBOUND_WORK_DECLINE),
        canAttach: has(inboundWorkIntake_1.INBOUND_WORK_ATTACH),
        canManageIntake: has(inboundWorkIntake_1.INBOUND_INTAKE_MANAGE),
        canRecover: has(inboundWorkIntake_1.INBOUND_WORK_RECOVER),
    };
}
// ════════════════════ accept ════════════════════
const ACCEPT_INPUT = ["requestId", "operatingCompanyId", "customerId", "locationId", "equipmentId", "requestType", "priority", "problemDescription"];
async function acceptInboundWork(deps, actor, input) {
    (0, inboundWorkIntake_1.requireCapability)(actor, inboundWorkIntake_1.INBOUND_WORK_ACCEPT);
    (0, inboundWorkIntake_1.requireCapability)(actor, workOrderCreateCommand_1.WORK_ORDER_CREATE);
    (0, inboundWorkIntake_1.only)(input, ACCEPT_INPUT);
    const requestId = input.requestId;
    if (!(0, inboundWorkIntake_1.isId)(requestId))
        (0, inboundWorkIntake_1.refuse)("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
    if (!(0, inboundWorkIntake_1.isId)(input.operatingCompanyId)) {
        (0, inboundWorkIntake_1.refuse)("OPERATING_COMPANY_REQUIRED", "INVALID_INPUT", "the reviewer states the operating company; it is never inferred from the sender, the mailbox, a routing rule or the customer");
    }
    if (!(0, inboundWorkIntake_1.isId)(input.customerId))
        (0, inboundWorkIntake_1.refuse)("CUSTOMER_REQUIRED", "INVALID_INPUT", "a customer must be selected before accepting");
    if (!(0, inboundWorkIntake_1.isId)(input.locationId))
        (0, inboundWorkIntake_1.refuse)("LOCATION_REQUIRED", "INVALID_INPUT", "a location must be selected before accepting");
    const equipmentId = input.equipmentId === undefined || input.equipmentId === null || input.equipmentId === "" ? null : input.equipmentId;
    if (equipmentId !== null && !(0, inboundWorkIntake_1.isId)(equipmentId))
        (0, inboundWorkIntake_1.refuse)("EQUIPMENT_INVALID", "INVALID_INPUT", "equipmentId, when stated, is an id");
    if (input.requestType !== undefined && input.requestType !== null && !inboundWorkModel_1.INBOUND_REQUEST_TYPES.includes(input.requestType)) {
        (0, inboundWorkIntake_1.refuse)("REQUEST_TYPE_INVALID", "INVALID_INPUT", `requestType is one of ${inboundWorkModel_1.INBOUND_REQUEST_TYPES.join(", ")}`);
    }
    if (input.priority !== undefined && input.priority !== null && !(Number.isInteger(input.priority) && input.priority >= 1 && input.priority <= 4)) {
        (0, inboundWorkIntake_1.refuse)("PRIORITY_INVALID", "INVALID_INPUT", "priority is a governed 1-4");
    }
    if (input.problemDescription !== undefined && input.problemDescription !== null && typeof input.problemDescription !== "string") {
        (0, inboundWorkIntake_1.refuse)("PROBLEM_INVALID", "INVALID_INPUT", "problemDescription is text");
    }
    const operatingCompanyId = input.operatingCompanyId;
    const customerId = input.customerId;
    const locationId = input.locationId;
    const now = (deps.now ?? (() => new Date()))();
    // ── 1. CLAIM ──
    const claim = await (0, inboundWorkIntake_1.inTransaction)(deps.pool, async (c) => {
        const { rows } = await c.query(`SELECT * FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, requestId]);
        if (rows.length === 0)
            (0, inboundWorkIntake_1.refuse)("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
        const r = rows[0];
        // REPLAY, NOT A SECOND WORK ORDER. An accepted intake returns what it became, to anyone who may accept.
        if (r.status === "ACCEPTED")
            return { replay: r };
        if (r.status === "ACCEPTING" && r.accept_claimed_by_principal_id !== actor.principalId) {
            (0, inboundWorkIntake_1.refuse)("ACCEPT_IN_PROGRESS", "CONFLICT", "another reviewer's Accept of this request is in progress");
        }
        if (r.status !== "ACCEPTING" && !inboundWorkIntake_1.DECIDABLE.has(r.status)) {
            (0, inboundWorkIntake_1.refuse)("ALREADY_DECIDED", "PRECONDITION_FAILED", `this request is ${r.status} and can no longer be accepted`);
        }
        // IDENTITY IS PROVEN FROM THE STORED RECORDS. The picker filtered the choices; a filter is not evidence.
        const account = await c.query(`SELECT 1 FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, customerId]);
        if (account.rows.length === 0)
            (0, inboundWorkIntake_1.refuse)("CUSTOMER_NOT_FOUND", "NOT_FOUND", "the selected customer does not exist");
        const location = await c.query(`SELECT account_id FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, locationId]);
        if (location.rows.length === 0)
            (0, inboundWorkIntake_1.refuse)("LOCATION_NOT_FOUND", "NOT_FOUND", "the selected location does not exist");
        if (location.rows[0].account_id !== customerId) {
            (0, inboundWorkIntake_1.refuse)("LOCATION_CUSTOMER_MISMATCH", "INVALID_INPUT", "the selected location belongs to a different customer");
        }
        const requestType = input.requestType ?? r.request_type ?? null;
        const workOrderType = workOrderTypeForRequestType(requestType);
        if (equipmentId !== null) {
            // Parity with WORK_ORDER_EQUIPMENT_RULE: an INSTALL cannot name a unit that does not exist yet.
            if (workOrderType === "INSTALL") {
                (0, inboundWorkIntake_1.refuse)("EQUIPMENT_NOT_ALLOWED_FOR_TYPE", "INVALID_INPUT", "an INSTALL Work Order cannot reference installed equipment at creation");
            }
            const eq = await c.query(`SELECT account_id, customer_location_id FROM eos_ops.equipment WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, equipmentId]);
            if (eq.rows.length === 0)
                (0, inboundWorkIntake_1.refuse)("EQUIPMENT_NOT_FOUND", "NOT_FOUND", "the referenced equipment does not exist");
            if (eq.rows[0].account_id !== customerId)
                (0, inboundWorkIntake_1.refuse)("EQUIPMENT_ACCOUNT_MISMATCH", "INVALID_INPUT", "the equipment belongs to a different customer");
            if (eq.rows[0].customer_location_id && eq.rows[0].customer_location_id !== locationId) {
                (0, inboundWorkIntake_1.refuse)("EQUIPMENT_LOCATION_MISMATCH", "INVALID_INPUT", "the equipment is installed at a different location");
            }
        }
        const priority = input.priority ?? (r.priority === null ? null : Number(r.priority)) ?? 3;
        // NO RE-TYPING: the problem the message described, unless the reviewer corrected it; the subject before blank.
        const complaint = (0, inboundWorkModel_1.boundedString)(input.problemDescription, 500) || (0, inboundWorkModel_1.boundedString)(r.problem_description, 500)
            || (0, inboundWorkModel_1.boundedString)(r.subject, 500) || "Inbound request";
        if (r.status !== "ACCEPTING") {
            await c.query(`UPDATE eos_ops.inbound_work_requests SET status = 'ACCEPTING', accept_claimed_by_principal_id = $3,
                accept_claim_prior_status = status, accept_claimed_at = $4, updated_at = $4, version = version + 1
          WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, requestId, actor.principalId, now]);
            await recordClaimEvent(c, actor.tenantId, { requestId: requestId, kind: "CLAIMED", from: null, to: actor.principalId,
                actor: actor.principalId, at: now });
        }
        return { claim: { r, requestType, workOrderType, priority, complaint } };
    });
    if ("replay" in claim) {
        const r = claim.replay;
        const wo = await deps.pool.query(`SELECT work_order_number FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.work_order_id]);
        return { requestId, workOrderId: r.work_order_id, workItemId: r.work_order_id, workOrderNumber: wo.rows[0]?.work_order_number ?? null,
            operatingCompanyId: r.operating_company_id, replayed: true };
    }
    const { r, requestType, workOrderType, priority, complaint } = claim.claim;
    const key = (0, exports.acceptIdempotencyKey)(requestId);
    // ── 2. THE GOVERNED CREATE -- or the Work Order a recovered claim CARRIED (never a second one) ──
    let created;
    if (r.accept_pending_work_order_id) {
        // RECOVERED_ACCEPT_WORK_ORDER_CONTEXT_VALIDATION (Controller SERVICE EXPERIENCE ACTIVATION CLOSURE, 2026-09-30): the
        // carried Work Order is linked ONLY if it is still the valid Work Order for THIS intake and THIS decision -- created
        // under the intake's own derived create key, for the customer / site / type / operating company the completing
        // reviewer stated, and still operational. Any conflict REFUSES: the carried Work Order is never silently replaced,
        // no second one is created, and the claim and its history stay exactly as they are for a governed human resolution.
        const carried = await deps.pool.query(`SELECT id, work_order_number, status::text AS status, customer_id, location_id, work_order_type::text AS work_order_type,
              operating_company_key, create_idempotency_key
         FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.accept_pending_work_order_id]);
        const w = carried.rows[0];
        const conflicts = [];
        if (!w)
            conflicts.push("the carried Work Order no longer exists");
        else {
            if (w.create_idempotency_key !== (0, exports.acceptIdempotencyKey)(requestId))
                conflicts.push("it was not created for this intake");
            if (w.customer_id !== customerId)
                conflicts.push("its customer differs from the stated customer");
            if (w.location_id !== locationId)
                conflicts.push("its site differs from the stated site");
            if (w.work_order_type !== workOrderType)
                conflicts.push(`its type (${w.work_order_type}) differs from the decided type (${workOrderType})`);
            const statedKey = await operatingCompanyKeyOrNull(deps.pool, actor.tenantId, operatingCompanyId);
            if (w.operating_company_key !== statedKey)
                conflicts.push("its operating company differs from the stated operating company");
            if (["CLOSED", "CANCELLED"].includes(w.status))
                conflicts.push(`it is ${w.status}`);
            if (await (0, workOrderQuarantine_1.isQuarantined)(deps.pool, actor.tenantId, w.id))
                conflicts.push("it is quarantined");
        }
        if (conflicts.length) {
            (0, inboundWorkIntake_1.refuse)("RECOVERED_WORK_ORDER_CONTEXT_MISMATCH", "PRECONDITION_FAILED", `the Work Order carried from the interrupted Accept is not valid for this decision (${conflicts.join("; ")}); `
                + "nothing was linked or created -- resolve it (correct the decision, or release the claim) before accepting");
        }
        created = { workOrderId: w.id, workOrderNumber: w.work_order_number, replayed: true };
    }
    if (!created)
        try {
            created = await (0, workOrderCreateCommand_1.createWorkOrder)({ pool: deps.pool, now: deps.now }, { tenantId: actor.tenantId, principalId: actor.principalId, capabilities: actor.capabilities, operatingCompanyId }, { customerId, locationId, workOrderType, priority, complaint, idempotencyKey: key, ...(equipmentId ? { equipmentId: equipmentId } : {}) });
        }
        catch (err) {
            const exists = await deps.pool.query(`SELECT 1 FROM eos_ops.work_orders WHERE tenant_id = $1 AND created_by_principal_id = $2 AND create_idempotency_key = $3`, [actor.tenantId, actor.principalId, key]);
            if (exists.rows.length === 0) {
                await (0, inboundWorkIntake_1.inTransaction)(deps.pool, async (c) => {
                    const released = await c.query(`UPDATE eos_ops.inbound_work_requests SET status = accept_claim_prior_status, accept_claimed_by_principal_id = NULL,
                  accept_claim_prior_status = NULL, accept_claimed_at = NULL, updated_at = $4, version = version + 1
            WHERE tenant_id = $1 AND id = $2 AND status = 'ACCEPTING' AND accept_claimed_by_principal_id = $3`, [actor.tenantId, requestId, actor.principalId, now]);
                    if (released.rowCount) {
                        await recordClaimEvent(c, actor.tenantId, { requestId: requestId, kind: "RELEASED", from: actor.principalId, to: null,
                            actor: actor.principalId, reason: (0, inboundWorkModel_1.boundedString)(`Accept failed: ${err?.code ?? "ERROR"}`, 500), at: now });
                    }
                });
            }
            throw err;
        }
    const done = created;
    // ── 3. RECORD ──
    return (0, inboundWorkIntake_1.inTransaction)(deps.pool, async (c) => {
        const { rows } = await c.query(`SELECT status, accept_claimed_by_principal_id, work_order_id FROM eos_ops.inbound_work_requests
                                     WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, requestId]);
        const cur = rows[0];
        if (cur.status === "ACCEPTED" && cur.work_order_id === done.workOrderId) {
            return { requestId, workOrderId: done.workOrderId, workItemId: done.workOrderId, workOrderNumber: done.workOrderNumber,
                operatingCompanyId, replayed: true };
        }
        if (cur.status !== "ACCEPTING" || cur.accept_claimed_by_principal_id !== actor.principalId) {
            (0, inboundWorkIntake_1.refuse)("ACCEPT_CLAIM_LOST", "CONFLICT", "this request is no longer claimed by this Accept");
        }
        await c.query(`UPDATE eos_ops.inbound_work_requests SET status = 'ACCEPTED', decision = 'ACCEPTED', decision_reason = NULL,
              decision_by_principal_id = $3, decision_at = $4, customer_id = $5, customer_location_id = $6, equipment_id = $7,
              request_type = $8, priority = $9, problem_description = $10, work_order_id = $11, operating_company_id = $12,
              accept_claimed_by_principal_id = NULL, accept_claim_prior_status = NULL, accept_claimed_at = NULL,
              accept_pending_work_order_id = NULL, updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, requestId, actor.principalId, now, customerId, locationId, equipmentId, requestType, priority, complaint,
            done.workOrderId, operatingCompanyId]);
        // TWO EVENTS, as the Firebase path wrote: the DECISION on the intake, and the CREATE under the Work Order's own id.
        const auditId = await (0, inboundWorkIntake_1.writeAudit)(c, actor, "inboundWork.request.accept", "inboundWorkRequest", requestId, { status: r.status }, { status: "ACCEPTED", workOrderId: done.workOrderId, workOrderNumber: done.workOrderNumber,
            operatingCompanyId, suggestedOperatingCompanyId: r.suggested_operating_company_id ?? null, customerId, locationId,
            equipmentId, requestType, priority }, null, now);
        await (0, inboundWorkIntake_1.writeAudit)(c, actor, "workOrder.createFromInboundWork", "workOrder", done.workOrderId, null, { inboundWorkRequestId: requestId, workOrderNumber: done.workOrderNumber, externalReference: r.external_reference ?? null,
            authorizationNumber: r.authorization_number ?? null, idempotencyKey: key }, null, now);
        await recordClaimEvent(c, actor.tenantId, { requestId: requestId, kind: "COMPLETED", from: actor.principalId, to: null,
            actor: actor.principalId, carriedWorkOrderId: r.accept_pending_work_order_id ?? null, at: now, auditEventId: auditId });
        await c.query(`INSERT INTO eos_ops.inbound_work_order_links
         (id, tenant_id, request_id, work_order_id, link_kind, operating_company_id, external_reference, authorization_number,
          linked_by_principal_id, linked_at, audit_event_id)
       VALUES ($1,$2,$3,$4,'CREATED_BY_ACCEPT',$5,$6,$7,$8,$9,$10)`, [`iwl_${requestId}`, actor.tenantId, requestId, done.workOrderId, operatingCompanyId, r.external_reference ?? null,
            r.authorization_number ?? null, actor.principalId, now, auditId]);
        return { requestId, workOrderId: done.workOrderId, workItemId: done.workOrderId, workOrderNumber: done.workOrderNumber,
            operatingCompanyId, replayed: done.replayed };
    });
}
// ════════════════════ decline ════════════════════
/** Declined intake is RETAINED, never deleted: a decline reason is a reporting fact and an audit fact. */
async function declineInboundWork(deps, actor, input) {
    (0, inboundWorkIntake_1.requireCapability)(actor, inboundWorkIntake_1.INBOUND_WORK_DECLINE);
    (0, inboundWorkIntake_1.only)(input, ["requestId", "reason", "note"]);
    if (!(0, inboundWorkIntake_1.isId)(input.requestId))
        (0, inboundWorkIntake_1.refuse)("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
    if (!inboundWorkModel_1.INBOUND_DECLINE_REASONS.includes(input.reason)) {
        (0, inboundWorkIntake_1.refuse)("DECLINE_REASON_REQUIRED", "INVALID_INPUT", `a decline reason is one of ${inboundWorkModel_1.INBOUND_DECLINE_REASONS.join(", ")}`);
    }
    if (input.note !== undefined && input.note !== null && (typeof input.note !== "string" || input.note.length > 500)) {
        (0, inboundWorkIntake_1.refuse)("NOTE_INVALID", "INVALID_INPUT", "note is text of at most 500 characters");
    }
    const note = (0, inboundWorkModel_1.boundedString)(input.note, 500) || null;
    const now = (deps.now ?? (() => new Date()))();
    return (0, inboundWorkIntake_1.inTransaction)(deps.pool, async (c) => {
        const { rows } = await c.query(`SELECT status FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, input.requestId]);
        if (rows.length === 0)
            (0, inboundWorkIntake_1.refuse)("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
        if (rows[0].status === "DECLINED")
            return { requestId: input.requestId, replayed: true };
        if (!inboundWorkIntake_1.DECIDABLE.has(rows[0].status))
            (0, inboundWorkIntake_1.refuse)("ALREADY_DECIDED", "PRECONDITION_FAILED", `this request is ${rows[0].status} and can no longer be declined`);
        await c.query(`UPDATE eos_ops.inbound_work_requests SET status = 'DECLINED', decision = 'DECLINED', decision_reason = $3, decision_note = $4,
              decision_by_principal_id = $5, decision_at = $6, updated_at = $6, version = version + 1
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, input.requestId, input.reason, note, actor.principalId, now]);
        await (0, inboundWorkIntake_1.writeAudit)(c, actor, "inboundWork.request.decline", "inboundWorkRequest", input.requestId, { status: rows[0].status }, { status: "DECLINED", reason: input.reason, note }, input.reason, now);
        return { requestId: input.requestId, replayed: false };
    });
}
// ════════════════════ attach ════════════════════
const TERMINAL_WORK_ORDER_STATUSES = ["CLOSED", "CANCELLED"];
/**
 * The message belongs to work that already exists: the intake is filed against that EOS Work Order (append-only
 * link) and NO Work Order is created. The Work Order must exist in the caller's tenant and not be CLOSED / CANCELLED.
 */
async function attachInboundWork(deps, actor, input) {
    (0, inboundWorkIntake_1.requireCapability)(actor, inboundWorkIntake_1.INBOUND_WORK_ATTACH);
    (0, inboundWorkIntake_1.only)(input, ["requestId", "workOrderId"]);
    if (!(0, inboundWorkIntake_1.isId)(input.requestId))
        (0, inboundWorkIntake_1.refuse)("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
    if (!(0, inboundWorkIntake_1.isId)(input.workOrderId))
        (0, inboundWorkIntake_1.refuse)("WORK_ORDER_REQUIRED", "INVALID_INPUT", "a Work Order must be selected");
    const now = (deps.now ?? (() => new Date()))();
    return (0, inboundWorkIntake_1.inTransaction)(deps.pool, async (c) => {
        const { rows } = await c.query(`SELECT status, work_order_id FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, input.requestId]);
        if (rows.length === 0)
            (0, inboundWorkIntake_1.refuse)("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
        const wo = await c.query(`SELECT id, work_order_number, status, customer_id, location_id FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, input.workOrderId]);
        if (rows[0].status === "ATTACHED" && rows[0].work_order_id === input.workOrderId) {
            return { requestId: input.requestId, workOrderId: input.workOrderId, workItemId: input.workOrderId,
                workOrderNumber: wo.rows[0]?.work_order_number ?? null, replayed: true };
        }
        if (!inboundWorkIntake_1.DECIDABLE.has(rows[0].status))
            (0, inboundWorkIntake_1.refuse)("ALREADY_DECIDED", "PRECONDITION_FAILED", `this request is ${rows[0].status} and can no longer be attached`);
        if (wo.rows.length === 0)
            (0, inboundWorkIntake_1.refuse)("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "that Work Order does not exist");
        // Owner DECISION 3: a quarantined Work Order is no operational target -- nothing new is attached to it.
        if (await (0, workOrderQuarantine_1.isQuarantined)(c, actor.tenantId, String(input.workOrderId)))
            (0, inboundWorkIntake_1.refuse)(workOrderQuarantine_1.WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", workOrderQuarantine_1.WORK_ORDER_QUARANTINED_MESSAGE);
        const w = wo.rows[0];
        if (TERMINAL_WORK_ORDER_STATUSES.includes(w.status)) {
            (0, inboundWorkIntake_1.refuse)("WORK_ORDER_TERMINAL", "PRECONDITION_FAILED", `that Work Order is ${w.status}; inbound work is not filed against a finished job`);
        }
        // The Work Order is the authority on who the request is for -- never the email.
        await c.query(`UPDATE eos_ops.inbound_work_requests SET status = 'ATTACHED', decision = 'ATTACHED', decision_by_principal_id = $3,
              decision_at = $4, work_order_id = $5, customer_id = $6, customer_location_id = $7, updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, input.requestId, actor.principalId, now, w.id, w.customer_id, w.location_id]);
        const auditId = await (0, inboundWorkIntake_1.writeAudit)(c, actor, "inboundWork.request.attach", "inboundWorkRequest", input.requestId, { status: rows[0].status }, { status: "ATTACHED", workOrderId: w.id, workOrderNumber: w.work_order_number }, null, now);
        await c.query(`INSERT INTO eos_ops.inbound_work_order_links
         (id, tenant_id, request_id, work_order_id, link_kind, linked_by_principal_id, linked_at, audit_event_id)
       VALUES ($1,$2,$3,$4,'ATTACHED',$5,$6,$7)`, [`iwl_${input.requestId}`, actor.tenantId, input.requestId, w.id, actor.principalId, now, auditId]);
        return { requestId: input.requestId, workOrderId: w.id, workItemId: w.id, workOrderNumber: w.work_order_number, replayed: false };
    });
}
//# sourceMappingURL=inboundWorkDecisions.js.map