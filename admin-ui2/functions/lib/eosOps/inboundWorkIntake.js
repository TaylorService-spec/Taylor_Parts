"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isId = exports.refuse = exports.InboundWorkError = exports.MAX_THREAD_MESSAGES = exports.DECIDABLE = exports.PG_INBOUND_WORK_STATUSES = exports.INBOUND_WORK_RECOVER = exports.INBOUND_INTAKE_MANAGE = exports.INBOUND_WORK_ATTACH = exports.INBOUND_WORK_DECLINE = exports.INBOUND_WORK_ACCEPT = exports.INBOUND_WORK_READ = void 0;
exports.requireCapability = requireCapability;
exports.only = only;
exports.writeAudit = writeAudit;
exports.inboundRequestId = inboundRequestId;
exports.contentKey = contentKey;
exports.serialNumberKey = serialNumberKey;
exports.resolveInboundCandidates = resolveInboundCandidates;
exports.inTransaction = inTransaction;
exports.saveInboundMailbox = saveInboundMailbox;
exports.saveInboundRoutingRule = saveInboundRoutingRule;
exports.connectionView = connectionView;
exports.failureView = failureView;
exports.readInboundIntakeConfiguration = readInboundIntakeConfiguration;
exports.initialAttachmentRefs = initialAttachmentRefs;
exports.ingestInboundMessage = ingestInboundMessage;
exports.deliverInboundMessage = deliverInboundMessage;
exports.quarantineMalformedMessage = quarantineMalformedMessage;
const node_crypto_1 = require("node:crypto");
const workOrderLifecycle_1 = require("./workOrderLifecycle");
const inboundWorkModel_1 = require("../inboundWork/inboundWorkModel");
const inboundRouting_1 = require("../inboundWork/inboundRouting");
const inboundProcessing_1 = require("../inboundWork/inboundProcessing");
const inboundThreading_1 = require("../inboundWork/inboundThreading");
const emailProvider_1 = require("../inboundWork/emailProvider");
const attachmentCustodyRules_1 = require("../inboundWork/attachmentCustodyRules");
// ════════════════════ capabilities (migration 1764340000000, registered with NO grants) ════════════════════
exports.INBOUND_WORK_READ = "inboundWork.request.read";
exports.INBOUND_WORK_ACCEPT = "inboundWork.request.accept";
exports.INBOUND_WORK_DECLINE = "inboundWork.request.decline";
exports.INBOUND_WORK_ATTACH = "inboundWork.request.attach";
exports.INBOUND_INTAKE_MANAGE = "inboundWork.intake.manage";
/** RELEASE / REASSIGN an unfinished accept claim (migration 1764360000000). Service-domain intake only. */
exports.INBOUND_WORK_RECOVER = "inboundWork.request.recover";
/** The statuses a PostgreSQL intake can hold. ACCEPTING is the in-flight Accept claim (see inboundWorkDecisions.ts). */
exports.PG_INBOUND_WORK_STATUSES = Object.freeze([
    "AWAITING_DECISION", "NEEDS_REVIEW", "ACCEPTING", "ACCEPTED", "DECLINED", "ATTACHED", "FAILED", "QUARANTINED",
]);
exports.DECIDABLE = new Set(["AWAITING_DECISION", "NEEDS_REVIEW"]);
/** How many replies one intake keeps (parity: MAX_THREAD_MESSAGES). Beyond this a reply is still recorded as a message. */
exports.MAX_THREAD_MESSAGES = 50;
/**
 * Every Inbound Work refusal. It IS a WorkOrderLifecycleError (the Work Order executor maps that class by name to its
 * HTTP status), so this route answers with the same { code, category } contract as /operations/work-orders.
 */
class InboundWorkError extends workOrderLifecycle_1.WorkOrderLifecycleError {
    constructor(code, category, message) {
        super(code, category, message);
    }
}
exports.InboundWorkError = InboundWorkError;
const refuse = (code, category, message) => {
    throw new InboundWorkError(code, category, message);
};
exports.refuse = refuse;
function requireCapability(actor, key) {
    if (!(actor?.capabilities instanceof Set) || !actor.capabilities.has(key)) {
        (0, exports.refuse)("CAPABILITY_MISSING", "FORBIDDEN", `this requires ${key}`);
    }
}
/** Refuse any field this operation does not accept -- named, not ignored. */
function only(input, allowed) {
    if (input === null || typeof input !== "object" || Array.isArray(input))
        (0, exports.refuse)("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
    const extra = Object.keys(input).filter((k) => !allowed.includes(k));
    if (extra.length > 0)
        (0, exports.refuse)("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this operation does not accept: ${extra.sort().join(", ")}`);
}
const isId = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 255 && !v.includes("/");
exports.isId = isId;
async function writeAudit(db, actor, action, targetKind, targetId, before, after, reason, at) {
    const id = `audit_${(0, node_crypto_1.randomUUID)()}`;
    await db.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`, [id, actor.tenantId, action, actor.principalId, targetKind, targetId,
        before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), at, reason]);
    return id;
}
function inboundRequestId(tenantId, mailboxId, messageId) {
    return `inbound_${(0, node_crypto_1.createHash)("sha256").update(`${tenantId}|${mailboxId}|${messageId}`).digest("hex").slice(0, 40)}`;
}
function contentKey(message, normalizedBody) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify([message.sender, message.subject, normalizedBody])).digest("hex");
}
const toTimestamp = (millis) => (Number.isFinite(millis) && millis > 0 ? new Date(millis) : null);
// ════════════════════ exact-key suggestions (the port of inboundCandidateResolution.ts) ════════════════════
/** The comparison key a serial is matched on: upper-case, whitespace removed (equipmentImportCommand's derivation). */
function serialNumberKey(serial) {
    return (0, inboundWorkModel_1.boundedString)(serial, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH).toUpperCase().replace(/\s+/g, "");
}
const candidate = (id, rawValue, matchedOn) => ({
    id,
    rawValue: (0, inboundWorkModel_1.boundedString)(rawValue, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH),
    confidence: id ? "EXACT" : "NONE",
    matchedOn: id ? matchedOn : "",
});
/**
 * SUGGESTIONS, NOT DECISIONS, AND NEVER A MASTER-DATA WRITE. Exact unique keys only -- an equipment serial
 * (eos_ops.equipment) first, then the sender's contact address (eos_crm.contacts). Two hits is NOT unique: the answer
 * is then NONE plus the raw value, never the first row. Nothing here writes; Accept re-reads whatever is chosen.
 */
async function resolveInboundCandidates(db, tenantId, input) {
    const serialRaw = (0, inboundWorkModel_1.boundedString)(input?.serialNumber, inboundWorkModel_1.MAX_EXTRACTED_FIELD_LENGTH);
    const sender = (0, inboundWorkModel_1.normalizeEmailAddress)(input?.senderEmail);
    let customerCandidate = inboundProcessing_1.NO_CANDIDATE;
    let locationCandidate = inboundProcessing_1.NO_CANDIDATE;
    let equipmentCandidate = serialRaw ? candidate(null, serialRaw, "") : inboundProcessing_1.NO_CANDIDATE;
    if (serialRaw) {
        const { rows } = await db.query(`SELECT id, account_id, customer_location_id FROM eos_ops.equipment
        WHERE tenant_id = $1 AND upper(regexp_replace(coalesce(serial_number, ''), '\\s+', '', 'g')) = $2
        ORDER BY id LIMIT 2`, [tenantId, serialNumberKey(serialRaw)]);
        if (rows.length === 1) {
            equipmentCandidate = candidate(String(rows[0].id), serialRaw, "serialNumberKey");
            if (rows[0].account_id)
                customerCandidate = candidate(String(rows[0].account_id), serialRaw, "equipmentAccount");
            if (rows[0].customer_location_id)
                locationCandidate = candidate(String(rows[0].customer_location_id), serialRaw, "equipmentLocation");
        }
    }
    if (!customerCandidate.id && sender) {
        const { rows } = await db.query(`SELECT account_id FROM eos_crm.contacts WHERE tenant_id = $1 AND lower(btrim(email)) = $2 ORDER BY id LIMIT 2`, [tenantId, sender]);
        customerCandidate = rows.length === 1 && rows[0].account_id
            ? candidate(String(rows[0].account_id), sender, "contactEmail")
            : candidate(null, sender, "");
    }
    return { customerCandidate, locationCandidate, equipmentCandidate };
}
const epochOrNull = (v) => (v ? new Date(v).getTime() : null);
const mailboxFromRow = (r) => Object.freeze({
    id: String(r.id), displayName: String(r.display_name), emailAddress: r.email_address ?? null,
    purpose: String(r.purpose), destination: String(r.destination), defaultQueue: r.default_queue ?? null,
    suggestedOperatingCompanyId: r.suggested_operating_company_id ?? null,
    status: r.status === "DISABLED" ? "DISABLED" : "ACTIVE", inboundEnabled: r.inbound_enabled === true,
    threadingEnabled: r.threading_enabled === true, version: Number(r.version),
    connectionId: r.connection_id ?? null,
    attachmentPolicy: (r.attachment_policy === "PRESERVE_METADATA" || r.attachment_policy === "IGNORE" ? r.attachment_policy : "STORE"),
    lastPolledAt: epochOrNull(r.last_polled_at), lastSuccessfulDeliveryAt: epochOrNull(r.last_successful_delivery_at),
    lastMessageReceivedAt: epochOrNull(r.last_message_received_at),
    mailboxReadable: r.mailbox_readable === null || r.mailbox_readable === undefined ? null : r.mailbox_readable === true,
    mailboxValidationDetail: r.mailbox_validation_detail ?? null,
    deliveryConnected: Boolean(r.connection_id) && r.status === "ACTIVE" && r.inbound_enabled === true,
});
async function readMailbox(db, tenantId, mailboxId) {
    const { rows } = await db.query(`SELECT * FROM eos_ops.inbound_mailboxes WHERE tenant_id = $1 AND id = $2`, [tenantId, mailboxId]);
    return rows.length ? mailboxFromRow(rows[0]) : null;
}
async function readRules(db, tenantId) {
    const { rows } = await db.query(`SELECT id, name, enabled, rule_order, when_condition, then_outcome FROM eos_ops.inbound_routing_rules
      WHERE tenant_id = $1 ORDER BY rule_order, id LIMIT 200`, [tenantId]);
    return rows.map((r) => ({
        id: String(r.id), name: String(r.name), enabled: r.enabled === true, order: Number(r.rule_order),
        when: (r.when_condition ?? {}),
        // Validated on the way OUT as well as in (parity with readRoutingRules).
        then: (0, inboundRouting_1.normalizeOutcome)(r.then_outcome),
    }));
}
const MAILBOX_INPUT = ["mailboxId", "displayName", "emailAddress", "purpose", "destination", "defaultQueue",
    "suggestedOperatingCompanyId", "status", "inboundEnabled", "threadingEnabled", "connectionId", "attachmentPolicy"];
const ATTACHMENT_POLICIES = ["STORE", "PRESERVE_METADATA", "IGNORE"];
const MAILBOX_PURPOSES = ["SERVICE", "WARRANTY", "PARTS", "OTHER"];
async function assertGovernedCompany(db, tenantId, companyId) {
    const { rows } = await db.query(`SELECT 1 FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`, [tenantId, companyId]);
    if (rows.length === 0)
        (0, exports.refuse)("OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", `'${companyId}' is not an ACTIVE operating company of this tenant`);
}
const optionalText = (v, max, field) => {
    if (v === undefined || v === null || v === "")
        return null;
    if (typeof v !== "string" || v.trim().length === 0 || v.length > max)
        (0, exports.refuse)("FIELD_INVALID", "INVALID_INPUT", `${field} is a string of at most ${max} characters`);
    return v.trim();
};
const optionalBool = (v, fallback, field) => {
    if (v === undefined)
        return fallback;
    if (typeof v !== "boolean")
        (0, exports.refuse)("FIELD_INVALID", "INVALID_INPUT", `${field} is a boolean`);
    return v;
};
async function inTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
/** Create or change one operational mailbox. ADMINISTRATIVE CONFIGURATION (inboundWork.intake.manage), audited. */
async function saveInboundMailbox(deps, actor, input) {
    requireCapability(actor, exports.INBOUND_INTAKE_MANAGE);
    only(input, MAILBOX_INPUT);
    // A NEW mailbox may leave its id to EOS; an existing one is named.
    if (input.mailboxId === undefined || input.mailboxId === null || input.mailboxId === "")
        input = { ...input, mailboxId: `mbx_${(0, node_crypto_1.randomUUID)()}` };
    if (!(0, exports.isId)(input.mailboxId))
        (0, exports.refuse)("MAILBOX_ID_REQUIRED", "INVALID_INPUT", "mailboxId is required");
    const displayName = optionalText(input.displayName, 120, "displayName");
    if (!displayName)
        (0, exports.refuse)("DISPLAY_NAME_REQUIRED", "INVALID_INPUT", "displayName is required");
    const purpose = input.purpose === undefined ? "OTHER" : input.purpose;
    if (!MAILBOX_PURPOSES.includes(purpose))
        (0, exports.refuse)("PURPOSE_INVALID", "INVALID_INPUT", `purpose is one of ${MAILBOX_PURPOSES.join(", ")}`);
    const destination = input.destination === undefined ? "SERVICE" : input.destination;
    if (!inboundRouting_1.ROUTING_DESTINATIONS.includes(destination)) {
        (0, exports.refuse)("DESTINATION_INVALID", "INVALID_INPUT", `destination is one of ${inboundRouting_1.ROUTING_DESTINATIONS.join(", ")}`);
    }
    const status = input.status === undefined ? "ACTIVE" : input.status;
    if (status !== "ACTIVE" && status !== "DISABLED")
        (0, exports.refuse)("STATUS_INVALID", "INVALID_INPUT", "status is ACTIVE or DISABLED");
    const emailAddress = input.emailAddress === undefined || input.emailAddress === null ? null : (0, inboundWorkModel_1.normalizeEmailAddress)(input.emailAddress);
    if (input.emailAddress && !emailAddress)
        (0, exports.refuse)("EMAIL_ADDRESS_INVALID", "INVALID_INPUT", "emailAddress is not an email address");
    const defaultQueue = optionalText(input.defaultQueue, 120, "defaultQueue");
    const company = optionalText(input.suggestedOperatingCompanyId, 120, "suggestedOperatingCompanyId");
    const inboundEnabled = optionalBool(input.inboundEnabled, true, "inboundEnabled");
    const threadingEnabled = optionalBool(input.threadingEnabled, true, "threadingEnabled");
    const connectionId = optionalText(input.connectionId, 180, "connectionId");
    const attachmentPolicy = input.attachmentPolicy === undefined ? "STORE" : input.attachmentPolicy;
    if (!ATTACHMENT_POLICIES.includes(attachmentPolicy)) {
        (0, exports.refuse)("ATTACHMENT_POLICY_INVALID", "INVALID_INPUT", `attachmentPolicy is one of ${ATTACHMENT_POLICIES.join(", ")}`);
    }
    const now = (deps.now ?? (() => new Date()))();
    return inTransaction(deps.pool, async (c) => {
        if (company)
            await assertGovernedCompany(c, actor.tenantId, company);
        if (connectionId) {
            const conn = await c.query(`SELECT 1 FROM eos_ops.inbound_provider_connections WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, connectionId]);
            if (conn.rows.length === 0)
                (0, exports.refuse)("CONNECTION_NOT_FOUND", "NOT_FOUND", "that provider connection does not exist in this tenant");
        }
        const before = await c.query(`SELECT * FROM eos_ops.inbound_mailboxes WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, input.mailboxId]);
        const { rows } = await c.query(`INSERT INTO eos_ops.inbound_mailboxes
         (tenant_id, id, display_name, email_address, purpose, destination, default_queue, suggested_operating_company_id,
          status, inbound_enabled, threading_enabled, updated_by_principal_id, created_at, updated_at, connection_id, attachment_policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15)
       ON CONFLICT (tenant_id, id) DO UPDATE SET display_name = EXCLUDED.display_name, email_address = EXCLUDED.email_address,
         connection_id = EXCLUDED.connection_id, attachment_policy = EXCLUDED.attachment_policy,
         purpose = EXCLUDED.purpose, destination = EXCLUDED.destination, default_queue = EXCLUDED.default_queue,
         suggested_operating_company_id = EXCLUDED.suggested_operating_company_id, status = EXCLUDED.status,
         inbound_enabled = EXCLUDED.inbound_enabled, threading_enabled = EXCLUDED.threading_enabled,
         updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = EXCLUDED.updated_at,
         version = inbound_mailboxes.version + 1
       RETURNING *`, [actor.tenantId, input.mailboxId, displayName, emailAddress, purpose, destination, defaultQueue, company, status,
            inboundEnabled, threadingEnabled, actor.principalId, now, connectionId, attachmentPolicy]);
        const saved = mailboxFromRow(rows[0]);
        await writeAudit(c, actor, "inboundWork.mailbox.save", "inboundMailbox", saved.id, before.rows.length ? mailboxFromRow(before.rows[0]) : null, saved, null, now);
        return saved;
    });
}
const RULE_INPUT = ["ruleId", "name", "enabled", "order", "when", "then"];
const CONDITION_KEYS = ["senderAddress", "senderDomain", "mailboxId", "subjectContains", "bodyContains", "hasAttachments"];
function validateCondition(raw) {
    if (raw === undefined)
        return {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        (0, exports.refuse)("RULE_CONDITION_INVALID", "INVALID_INPUT", "when is an object");
    const when = raw;
    const extra = Object.keys(when).filter((k) => !CONDITION_KEYS.includes(k));
    if (extra.length)
        (0, exports.refuse)("RULE_CONDITION_INVALID", "INVALID_INPUT", `unknown routing condition(s): ${extra.sort().join(", ")}`);
    for (const k of ["senderAddress", "senderDomain", "mailboxId"]) {
        if (when[k] !== undefined && (typeof when[k] !== "string" || when[k].trim() === "" || when[k].length > 255)) {
            (0, exports.refuse)("RULE_CONDITION_INVALID", "INVALID_INPUT", `${k} is a non-empty string`);
        }
    }
    for (const k of ["subjectContains", "bodyContains"]) {
        const v = when[k];
        if (v !== undefined && (!Array.isArray(v) || v.length > 20 || v.some((t) => typeof t !== "string" || t.length > 120))) {
            (0, exports.refuse)("RULE_CONDITION_INVALID", "INVALID_INPUT", `${k} is a list of at most 20 strings`);
        }
    }
    if (when.hasAttachments !== undefined && typeof when.hasAttachments !== "boolean") {
        (0, exports.refuse)("RULE_CONDITION_INVALID", "INVALID_INPUT", "hasAttachments is a boolean");
    }
    return when;
}
/** Create or change one routing rule. The outcome is validated strictly: an unrecognized value is REFUSED, not dropped. */
async function saveInboundRoutingRule(deps, actor, input) {
    requireCapability(actor, exports.INBOUND_INTAKE_MANAGE);
    only(input, RULE_INPUT);
    if (!(0, exports.isId)(input.ruleId))
        (0, exports.refuse)("RULE_ID_REQUIRED", "INVALID_INPUT", "ruleId is required");
    const name = optionalText(input.name, 120, "name");
    if (!name)
        (0, exports.refuse)("RULE_NAME_REQUIRED", "INVALID_INPUT", "name is required");
    const enabled = optionalBool(input.enabled, true, "enabled");
    const order = input.order === undefined ? 100 : input.order;
    if (!Number.isInteger(order) || order < 0 || order > 100000)
        (0, exports.refuse)("RULE_ORDER_INVALID", "INVALID_INPUT", "order is an integer 0-100000");
    const when = validateCondition(input.when);
    const rawThen = (input.then ?? {});
    if (!rawThen || typeof rawThen !== "object" || Array.isArray(rawThen))
        (0, exports.refuse)("RULE_OUTCOME_INVALID", "INVALID_INPUT", "then is an object");
    const then = (0, inboundRouting_1.normalizeOutcome)(rawThen);
    const dropped = Object.keys(rawThen).filter((k) => !(k in then));
    if (dropped.length)
        (0, exports.refuse)("RULE_OUTCOME_INVALID", "INVALID_INPUT", `unrecognized routing outcome value(s): ${dropped.sort().join(", ")}`);
    const now = (deps.now ?? (() => new Date()))();
    return inTransaction(deps.pool, async (c) => {
        if (typeof then.operatingCompanyId === "string")
            await assertGovernedCompany(c, actor.tenantId, then.operatingCompanyId);
        const before = await c.query(`SELECT * FROM eos_ops.inbound_routing_rules WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, input.ruleId]);
        await c.query(`INSERT INTO eos_ops.inbound_routing_rules
         (tenant_id, id, name, enabled, rule_order, when_condition, then_outcome, updated_by_principal_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$9)
       ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, enabled = EXCLUDED.enabled, rule_order = EXCLUDED.rule_order,
         when_condition = EXCLUDED.when_condition, then_outcome = EXCLUDED.then_outcome,
         updated_by_principal_id = EXCLUDED.updated_by_principal_id, updated_at = EXCLUDED.updated_at,
         version = inbound_routing_rules.version + 1`, [actor.tenantId, input.ruleId, name, enabled, order, JSON.stringify(when), JSON.stringify(then), actor.principalId, now]);
        const saved = { id: input.ruleId, name: name, enabled, order: order, when, then };
        const b = before.rows[0];
        await writeAudit(c, actor, "inboundWork.routingRule.save", "inboundRoutingRule", saved.id, b ? { name: b.name, enabled: b.enabled, order: b.rule_order, when: b.when_condition, then: b.then_outcome } : null, saved, null, now);
        return saved;
    });
}
/** A provider connection as Administration sees it: identity, status and health -- never a credential value. */
function connectionView(r) {
    return Object.freeze({
        id: String(r.id), connectionName: String(r.connection_name), provider: String(r.provider),
        tenantOrWorkspace: String(r.tenant_or_workspace ?? ""), connectedAccount: String(r.connected_account ?? ""),
        inboundEnabled: r.inbound_enabled === true, oauthStatus: String(r.oauth_status), connectionStatus: String(r.connection_status),
        health: String(r.health),
        // WHETHER a credential is held, never where or what: the reference is operator custody.
        credentialHeld: Boolean(r.credential_secret_name),
        grantedScopes: r.granted_scopes ?? null,
        authorizedAt: epochOrNull(r.authorized_at), lastTokenRefreshAt: epochOrNull(r.last_token_refresh_at),
        lastHealthCheckAt: epochOrNull(r.last_health_check_at), lastSuccessfulSync: epochOrNull(r.last_successful_sync_at),
        lastMessageReceived: epochOrNull(r.last_message_received_at), lastProviderErrorAt: epochOrNull(r.last_provider_error_at),
        providerErrorCode: r.provider_error_code ?? null, version: Number(r.version),
    });
}
/** One delivery failure, as the Exceptions surface shows it. */
function failureView(r) {
    return Object.freeze({
        id: String(r.id), connectionId: String(r.connection_id), mailboxId: String(r.mailbox_id), subjectId: String(r.subject_id),
        code: String(r.code), detail: String(r.detail ?? ""), disposition: String(r.disposition), attempts: Number(r.attempts),
        exhausted: r.exhausted === true, status: String(r.status), nextAttemptAt: epochOrNull(r.next_attempt_at),
        firstFailedAt: epochOrNull(r.first_failed_at), lastFailedAt: epochOrNull(r.last_failed_at),
    });
}
/** The configuration an intake administrator sees: connections, mailboxes, rules, open failures and the counts. */
async function readInboundIntakeConfiguration(deps, actor) {
    requireCapability(actor, exports.INBOUND_INTAKE_MANAGE);
    const [mailboxes, rules, counts, custody, connections, failures] = await Promise.all([
        deps.pool.query(`SELECT * FROM eos_ops.inbound_mailboxes WHERE tenant_id = $1 ORDER BY id`, [actor.tenantId]),
        readRules(deps.pool, actor.tenantId),
        deps.pool.query(`SELECT status, count(*)::int n FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 GROUP BY status`, [actor.tenantId]),
        deps.pool.query(`SELECT attachment_custody, count(*)::int n FROM eos_ops.inbound_work_requests
                      WHERE tenant_id = $1 AND attachment_custody <> 'NONE' GROUP BY attachment_custody`, [actor.tenantId]),
        deps.pool.query(`SELECT * FROM eos_ops.inbound_provider_connections WHERE tenant_id = $1 ORDER BY connection_name, id`, [actor.tenantId]),
        deps.pool.query(`SELECT * FROM eos_ops.inbound_delivery_failures WHERE tenant_id = $1 AND status <> 'RESOLVED'
                      ORDER BY last_failed_at DESC, id LIMIT 200`, [actor.tenantId]),
    ]);
    const byStatus = {};
    let total = 0;
    for (const r of counts.rows) {
        byStatus[r.status] = r.n;
        total += r.n;
    }
    const attachmentCustody = {};
    for (const r of custody.rows)
        attachmentCustody[r.attachment_custody] = r.n;
    return {
        connections: connections.rows.map(connectionView),
        mailboxes: mailboxes.rows.map(mailboxFromRow),
        rules,
        exceptions: failures.rows.map(failureView),
        overview: { total, byStatus, attachmentCustody },
    };
}
const PROCESSING_PROVIDERS = ["EOS_NATIVE", "VDX", "EXTERNAL"];
/** The custody an attachment starts with: unsafe is refused, else the mailbox's attachment policy decides. */
function initialAttachmentRefs(attachments, policy) {
    const unsafe = [];
    const refs = attachments.map((a) => {
        const why = (0, attachmentCustodyRules_1.unsafeAttachmentReason)(a);
        if (why)
            unsafe.push(`${(0, attachmentCustodyRules_1.safeAttachmentFilename)(a.filename)}: ${why}`);
        return {
            ...a,
            filename: (0, attachmentCustodyRules_1.safeAttachmentFilename)(a.filename),
            custody: why ? "REFUSED_UNSAFE" : policy === "STORE" ? "PENDING" : "METADATA_ONLY",
            custodyReason: why,
            attachmentId: null,
            attempts: 0,
            failureCode: null,
            storedAt: null,
        };
    });
    return { refs, unsafe };
}
async function insertMessage(c, actor, requestId, message, normalizedBody, role, matchedOn, now) {
    await c.query(`INSERT INTO eos_ops.inbound_work_messages
       (id, tenant_id, request_id, mailbox_id, provider_message_id, thread_id, in_reply_to, message_references, received_at,
        sender, subject, normalized_body, attachment_refs, message_role, matched_on, recorded_by_principal_id, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)`, [`ibm_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, requestId, message.mailboxId, message.messageId, message.threadId, message.inReplyTo,
        JSON.stringify(message.references), toTimestamp(message.receivedAt), message.sender, message.subject, normalizedBody,
        JSON.stringify(message.attachments), role, matchedOn, actor.principalId, now]);
}
/** Every intake that could plausibly be this message's thread: same provider thread id, or a referenced message id. */
async function readThreadCandidates(c, tenantId, message) {
    const referenced = [message.inReplyTo, ...message.references].filter((v) => Boolean(v)).slice(0, 10);
    const ids = new Set();
    if (message.threadId) {
        const { rows } = await c.query(`SELECT id FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND source_thread_id = $2 ORDER BY id LIMIT 10`, [tenantId, message.threadId]);
        rows.forEach((r) => ids.add(String(r.id)));
    }
    const probe = [...referenced, message.messageId];
    const { rows: byMsg } = await c.query(`SELECT DISTINCT request_id FROM eos_ops.inbound_work_messages WHERE tenant_id = $1 AND provider_message_id = ANY($2::text[]) LIMIT 20`, [tenantId, probe]);
    byMsg.forEach((r) => ids.add(String(r.request_id)));
    if (ids.size === 0)
        return [];
    const { rows } = await c.query(`SELECT r.id, r.source_message_id, r.source_thread_id, r.status, r.work_order_id,
            coalesce((SELECT array_agg(m.provider_message_id) FROM eos_ops.inbound_work_messages m
                       WHERE m.tenant_id = r.tenant_id AND m.request_id = r.id), '{}') AS message_ids
       FROM eos_ops.inbound_work_requests r WHERE r.tenant_id = $1 AND r.id = ANY($2::text[])`, [tenantId, [...ids]]);
    return rows.map((r) => ({
        id: String(r.id), sourceMessageId: String(r.source_message_id), sourceThreadId: r.source_thread_id ?? null,
        messageIds: r.message_ids ?? [], status: r.status, workItemId: r.work_order_id ?? null,
    }));
}
/**
 * Take one normalized message into intake. The whole decision -- duplicate, reply, quarantine, or new -- happens in
 * ONE transaction, serialized per (tenant, mailbox, message), so a retry of the same delivery converges on the same
 * record rather than racing itself.
 */
async function ingestInboundMessage(deps, actor, input) {
    requireCapability(actor, exports.INBOUND_INTAKE_MANAGE);
    let message;
    try {
        message = (0, inboundWorkModel_1.normalizeInboundMessage)(input?.message);
    }
    catch (err) {
        return (0, exports.refuse)("MESSAGE_INVALID", "INVALID_INPUT", (0, inboundWorkModel_1.boundedString)(err.message, 300) || "the message could not be read");
    }
    const normalizedBody = (0, inboundWorkModel_1.toPlainText)(message.originalBody, message.originalBodyContentType);
    const requestId = inboundRequestId(actor.tenantId, message.mailboxId, message.messageId);
    const now = (deps.now ?? (() => new Date()))();
    // Processing runs BEFORE the transaction; a failure is a RETAINED FAILED intake, never a lost message.
    const provider = (input.processingProvider ?? "EOS_NATIVE");
    if (!PROCESSING_PROVIDERS.includes(provider))
        (0, exports.refuse)("PROCESSING_PROVIDER_INVALID", "INVALID_INPUT", "processingProvider is EOS_NATIVE, VDX or EXTERNAL");
    let processing = inboundProcessing_1.EMPTY_PROCESSING_RESULT;
    let processingError = "";
    try {
        processing = provider === "EOS_NATIVE"
            ? (0, inboundProcessing_1.processInboundMessageNatively)(message, normalizedBody)
            : (0, inboundProcessing_1.normalizeProcessingResult)(input.providerResult, provider);
    }
    catch (err) {
        processingError = (0, inboundWorkModel_1.boundedString)(err instanceof Error ? err.message : String(err), 500) || "processing failed";
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
    const quarantineRefs = initialAttachmentRefs(message.attachments, null).refs;
    const retained = (status, note) => ({
        source_provider: message.provider, source_connection_id: message.connectionId, source_mailbox_id: message.mailboxId,
        source_message_id: message.messageId, source_thread_id: message.threadId, content_key: cKey,
        received_at: toTimestamp(message.receivedAt), sender: message.sender, recipients: JSON.stringify(message.recipients),
        cc: JSON.stringify(message.cc), subject: message.subject, original_body: message.originalBody,
        original_body_content_type: message.originalBodyContentType, normalized_body: normalizedBody,
        // Without a mailbox's policy (unknown / disabled mailbox) attachments are metadata only; unsafe ones are refused.
        attachment_refs: JSON.stringify(quarantineRefs), attachment_custody: (0, attachmentCustodyRules_1.summarizeCustody)(quarantineRefs), status, status_note: note,
    });
    const insertRequest = async (c, fields) => {
        const cols = ["tenant_id", "id", "ingested_by_principal_id", "created_at", "updated_at", ...Object.keys(fields)];
        const vals = [actor.tenantId, requestId, actor.principalId, now, now, ...Object.values(fields)];
        await c.query(`INSERT INTO eos_ops.inbound_work_requests (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
    };
    try {
        return await inTransaction(deps.pool, async (c) => {
            await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`inbound|${actor.tenantId}|${message.mailboxId}|${message.messageId}`]);
            // 1. THE SAME MESSAGE, TWICE -- as an intake of its own, or as a reply already preserved on one.
            const seen = await c.query(`SELECT m.request_id, r.status FROM eos_ops.inbound_work_messages m
           JOIN eos_ops.inbound_work_requests r ON r.tenant_id = m.tenant_id AND r.id = m.request_id
          WHERE m.tenant_id = $1 AND m.mailbox_id = $2 AND m.provider_message_id = $3`, [actor.tenantId, message.mailboxId, message.messageId]);
            if (seen.rows.length) {
                return { requestId: String(seen.rows[0].request_id), outcome: "DUPLICATE", status: seen.rows[0].status, duplicateOfRequestId: null };
            }
            // 2. AN UNKNOWN OR DISABLED MAILBOX IS QUARANTINED, NOT DISCARDED.
            const mailbox = await readMailbox(c, actor.tenantId, message.mailboxId);
            if (!mailbox || mailbox.status === "DISABLED" || !mailbox.inboundEnabled) {
                const note = mailbox ? "Mailbox is not accepting inbound work." : "Message arrived in a mailbox EOS does not know.";
                await insertRequest(c, { ...retained("QUARANTINED", note), source_mailbox_name: mailbox?.displayName ?? null });
                await insertMessage(c, actor, requestId, message, normalizedBody, "ORIGINAL", null, now);
                await writeAudit(c, actor, "inboundWork.request.quarantine", "inboundWorkRequest", requestId, null, { status: "QUARANTINED", mailboxId: message.mailboxId, sourceMessageId: message.messageId, sender: message.sender }, note, now);
                return { requestId, outcome: "QUARANTINED", status: "QUARANTINED", duplicateOfRequestId: null };
            }
            // 3. A REPLY ON WORK WE ALREADY HAVE.
            const threadCandidates = mailbox.threadingEnabled ? await readThreadCandidates(c, actor.tenantId, message) : [];
            const association = (0, inboundThreading_1.associateInboundMessage)({ messageId: message.messageId, threadId: message.threadId, inReplyTo: message.inReplyTo, references: message.references }, threadCandidates);
            if (association.outcome === "DUPLICATE") {
                const { rows } = await c.query(`SELECT status FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, association.requestId]);
                return { requestId: association.requestId, outcome: "DUPLICATE", status: rows[0]?.status, duplicateOfRequestId: null };
            }
            if (association.outcome === "THREAD_MATCH") {
                const target = association.requestId;
                const { rows } = await c.query(`SELECT status, attachment_refs FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, target]);
                // A reply's unsafe attachment is refused custody; the reply itself is preserved on the thread.
                const replyRefs = initialAttachmentRefs(message.attachments, mailbox.attachmentPolicy).refs;
                const attachments = (rows[0].attachment_refs ?? []).concat(replyRefs).slice(0, inboundWorkModel_1.MAX_ATTACHMENTS * 4);
                await insertMessage(c, actor, target, message, normalizedBody, "REPLY", association.matchedOn, now);
                await c.query(`UPDATE eos_ops.inbound_work_requests SET attachment_refs = $3::jsonb, attachment_custody = $5, updated_at = $4, version = version + 1
            WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, target, JSON.stringify(attachments), now, (0, attachmentCustodyRules_1.summarizeCustody)(attachments)]);
                await writeAudit(c, actor, "inboundWork.request.linkThreadMessage", "inboundWorkRequest", target, null, { providerMessageId: message.messageId, matchedOn: association.matchedOn }, null, now);
                return { requestId: target, outcome: "THREAD_MATCH", status: rows[0].status, duplicateOfRequestId: null };
            }
            // 4. A NEW INTAKE. Routing (an administrator's rules) classifies; a person decides.
            const rules = await readRules(c, actor.tenantId);
            const routing = (0, inboundRouting_1.evaluateRouting)(rules, {
                mailboxId: message.mailboxId, sender: message.sender, subject: message.subject, normalizedBody,
                hasAttachments: message.attachments.length > 0,
            });
            const ambiguous = association.outcome === "AMBIGUOUS";
            const screened = initialAttachmentRefs(message.attachments, mailbox.attachmentPolicy);
            if (screened.unsafe.length > 0) {
                const note = (0, inboundWorkModel_1.boundedString)(`Unsafe attachment(s) -- never fetched: ${screened.unsafe.join("; ")}`, 500);
                await insertRequest(c, {
                    ...retained("QUARANTINED", note), source_mailbox_name: (0, inboundWorkModel_1.boundedString)(mailbox.displayName, 120) || null,
                    attachment_refs: JSON.stringify(screened.refs), attachment_custody: (0, attachmentCustodyRules_1.summarizeCustody)(screened.refs),
                    destination: mailbox.destination ?? "SERVICE",
                });
                await insertMessage(c, actor, requestId, message, normalizedBody, "ORIGINAL", null, now);
                await writeAudit(c, actor, "inboundWork.request.quarantine", "inboundWorkRequest", requestId, null, { status: "QUARANTINED", mailboxId: message.mailboxId, sourceMessageId: message.messageId, sender: message.sender,
                    unsafeAttachments: screened.unsafe }, note, now);
                return { requestId, outcome: "QUARANTINED", status: "QUARANTINED", duplicateOfRequestId: null };
            }
            const sameContent = await c.query(`SELECT id FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND content_key = $2 ORDER BY created_at, id LIMIT 1`, [actor.tenantId, cKey]);
            const duplicateOf = sameContent.rows.length ? String(sameContent.rows[0].id) : null;
            const status = processingError
                ? "FAILED"
                : ambiguous || duplicateOf || routing.outcome.manualReview === true ? "NEEDS_REVIEW" : "AWAITING_DECISION";
            const note = ambiguous ? "Reply matched more than one open intake."
                : duplicateOf ? "Identical content to an earlier intake under a different message id." : null;
            const requestType = routing.outcome.requestType ?? processing.requestType ?? null;
            await insertRequest(c, {
                ...retained(status, note),
                duplicate_of_request_id: duplicateOf,
                source_mailbox_name: (0, inboundWorkModel_1.boundedString)(mailbox.displayName, 120) || null,
                request_type: requestType && inboundWorkModel_1.INBOUND_REQUEST_TYPES.includes(requestType) ? requestType : null,
                destination: routing.outcome.destination ?? mailbox.destination ?? "SERVICE",
                queue: routing.outcome.queue ?? mailbox.defaultQueue ?? null,
                // A SUGGESTION from EOS configuration (a rule, else the mailbox). An inbound message never names its own
                // operating company, and Accept requires the reviewer to STATE one.
                suggested_operating_company_id: routing.outcome.operatingCompanyId ?? mailbox.suggestedOperatingCompanyId ?? null,
                priority: routing.outcome.priority ?? processing.priority ?? null,
                routing_rule_id: routing.ruleId,
                routing_rule_name: routing.ruleId ? (0, inboundWorkModel_1.boundedString)(rules.find((r) => r.id === routing.ruleId)?.name, 120) || null : null,
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
                attachment_refs: JSON.stringify(screened.refs),
                attachment_custody: (0, attachmentCustodyRules_1.summarizeCustody)(screened.refs),
            });
            await insertMessage(c, actor, requestId, message, normalizedBody, "ORIGINAL", null, now);
            await writeAudit(c, actor, processingError ? "inboundWork.request.fail" : "inboundWork.request.create", "inboundWorkRequest", requestId, null, { status, requestType, routingRuleId: routing.ruleId, sender: message.sender, sourceMessageId: message.messageId,
                threadAssociation: association.outcome, duplicateOfRequestId: duplicateOf }, processingError || null, now);
            return {
                requestId,
                outcome: processingError ? "FAILED" : ambiguous ? "AMBIGUOUS" : "CREATED",
                status,
                duplicateOfRequestId: duplicateOf,
            };
        });
    }
    catch (err) {
        // A concurrent delivery of the same message won the unique key: answer with ITS record.
        if (err?.code === "23505") {
            const { rows } = await deps.pool.query(`SELECT m.request_id, r.status FROM eos_ops.inbound_work_messages m
           JOIN eos_ops.inbound_work_requests r ON r.tenant_id = m.tenant_id AND r.id = m.request_id
          WHERE m.tenant_id = $1 AND m.mailbox_id = $2 AND m.provider_message_id = $3`, [actor.tenantId, message.mailboxId, message.messageId]);
            if (rows.length)
                return { requestId: String(rows[0].request_id), outcome: "DUPLICATE", status: rows[0].status, duplicateOfRequestId: null };
        }
        throw err;
    }
}
/**
 * THE NON-PRODUCTION DELIVERY SEAM (parity: deliverInboundEmailMessage). Takes a message in the PROVIDER'S OWN native
 * shape (a Microsoft Graph message resource or a Gmail users.messages resource) and runs it through the identical
 * adapter and intake path a real poll would use. The EOS API refuses to start with EOS_ENVIRONMENT=production.
 */
async function deliverInboundMessage(deps, actor, input) {
    requireCapability(actor, exports.INBOUND_INTAKE_MANAGE);
    only(input, ["provider", "mailboxId", "connectionId", "message", "processingProvider", "providerResult"]);
    if (!(0, emailProvider_1.isEmailProviderId)(input.provider))
        (0, exports.refuse)("PROVIDER_INVALID", "INVALID_INPUT", "provider must be MICROSOFT_365 or GOOGLE_WORKSPACE");
    if (!(0, exports.isId)(input.mailboxId))
        (0, exports.refuse)("MAILBOX_ID_REQUIRED", "INVALID_INPUT", "mailboxId is required");
    let message;
    try {
        message = (0, emailProvider_1.normalizeProviderMessage)(input.provider, input.message, {
            connectionId: (0, inboundWorkModel_1.boundedString)(input.connectionId, 255), mailboxId: input.mailboxId,
        });
    }
    catch (err) {
        // A message the provider can identify is RETAINED as quarantined evidence (the same as a poll); one with no
        // provider id at all cannot be keyed, deduplicated or retained, and is refused.
        const providerMessageId = (0, inboundWorkModel_1.boundedString)(input.message?.id, 255);
        if (!providerMessageId) {
            return (0, exports.refuse)("MESSAGE_INVALID", "INVALID_INPUT", (0, inboundWorkModel_1.boundedString)(err.message, 300) || "the provider message could not be read");
        }
        return quarantineMalformedMessage(deps, actor, {
            provider: input.provider, mailboxId: input.mailboxId, connectionId: (0, inboundWorkModel_1.boundedString)(input.connectionId, 255),
            providerMessageId, reason: (0, inboundWorkModel_1.boundedString)(err.message, 300) || "the provider message could not be read", raw: input.message,
        });
    }
    return ingestInboundMessage(deps, actor, {
        message,
        processingProvider: input.processingProvider,
        providerResult: input.providerResult,
    });
}
/**
 * RETAIN A MALFORMED PROVIDER MESSAGE AS QUARANTINED EVIDENCE. Keyed exactly like any intake (tenant, mailbox,
 * provider message id), so a re-poll of the same message converges (DUPLICATE) instead of stalling the mailbox
 * behind it. The raw payload is retained as bounded plain text; nothing from it is interpreted.
 */
async function quarantineMalformedMessage(deps, actor, input) {
    requireCapability(actor, exports.INBOUND_INTAKE_MANAGE);
    if (!(0, emailProvider_1.isEmailProviderId)(input.provider))
        (0, exports.refuse)("PROVIDER_INVALID", "INVALID_INPUT", "provider must be MICROSOFT_365 or GOOGLE_WORKSPACE");
    if (!(0, exports.isId)(input.mailboxId) || !(0, exports.isId)(input.providerMessageId))
        (0, exports.refuse)("MESSAGE_INVALID", "INVALID_INPUT", "a quarantined message still names its mailbox and provider id");
    const now = (deps.now ?? (() => new Date()))();
    const requestId = inboundRequestId(actor.tenantId, input.mailboxId, input.providerMessageId);
    let excerpt;
    try {
        excerpt = (0, inboundWorkModel_1.boundedString)(JSON.stringify(input.raw), 20000);
    }
    catch {
        excerpt = "";
    }
    const note = (0, inboundWorkModel_1.boundedString)(`Malformed provider message: ${input.reason}`, 500);
    return inTransaction(deps.pool, async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`inbound|${actor.tenantId}|${input.mailboxId}|${input.providerMessageId}`]);
        const seen = await c.query(`SELECT request_id FROM eos_ops.inbound_work_messages WHERE tenant_id = $1 AND mailbox_id = $2 AND provider_message_id = $3`, [actor.tenantId, input.mailboxId, input.providerMessageId]);
        if (seen.rows.length) {
            const r = await c.query(`SELECT status FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, seen.rows[0].request_id]);
            return { requestId: String(seen.rows[0].request_id), outcome: "DUPLICATE", status: r.rows[0]?.status, duplicateOfRequestId: null };
        }
        const mailbox = await readMailbox(c, actor.tenantId, input.mailboxId);
        await c.query(`INSERT INTO eos_ops.inbound_work_requests
         (tenant_id, id, source_provider, source_connection_id, source_mailbox_id, source_mailbox_name, source_message_id, content_key,
          subject, original_body, original_body_content_type, normalized_body, status, status_note, destination, ingested_by_principal_id,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'(malformed provider message)',$9,'text/plain','',
               'QUARANTINED',$10,$11,$12,$13,$13)`, [actor.tenantId, requestId, input.provider, input.connectionId, input.mailboxId, mailbox?.displayName ?? null, input.providerMessageId,
            (0, node_crypto_1.createHash)("sha256").update(`malformed|${input.mailboxId}|${input.providerMessageId}`).digest("hex"), excerpt, note,
            mailbox?.destination ?? "SERVICE", actor.principalId, now]);
        await c.query(`INSERT INTO eos_ops.inbound_work_messages (id, tenant_id, request_id, mailbox_id, provider_message_id, message_role, recorded_by_principal_id, recorded_at)
       VALUES ($1,$2,$3,$4,$5,'ORIGINAL',$6,$7)`, [`ibm_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, requestId, input.mailboxId, input.providerMessageId, actor.principalId, now]);
        await writeAudit(c, actor, "inboundWork.request.quarantine", "inboundWorkRequest", requestId, null, { status: "QUARANTINED", mailboxId: input.mailboxId, sourceMessageId: input.providerMessageId, malformed: true }, note, now);
        return { requestId, outcome: "QUARANTINED", status: "QUARANTINED", duplicateOfRequestId: null };
    });
}
//# sourceMappingURL=inboundWorkIntake.js.map