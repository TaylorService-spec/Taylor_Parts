-- Up Migration
-- INBOUND WORK INTAKE (Owner ruling W9 -- INCLUDE NOW; Work Order cutover completion pass, 2026-09-30).
--
-- The governed PostgreSQL home of the Inbound Work intake the Firebase path kept in Firestore
-- `inbound_work_requests`, so that the Work Order ACTIONS taken on an intake -- Accept, Attach, Decline -- no longer
-- depend on a Firebase Work Order callable:
--
--     Accept   -> the governed EOS createWorkOrder (workOrderCreateCommand.ts), operating company STATED by the
--                 reviewer, idempotency key DERIVED from the intake id (a replayed Accept never makes two Work Orders)
--     Attach   -> a governed association row with an existing, non-terminal EOS Work Order of the same tenant
--     Decline  -> a governed intake state with a governed reason; the record is retained, never deleted
--
-- ════════════════════ WHAT IS HERE ════════════════════
--
--   inbound_mailboxes           the operational mailboxes EOS knows (quarantine is decided against this)
--   inbound_routing_rules       first-match-wins classification rules (inboundWork/inboundRouting.ts, unchanged)
--   inbound_work_requests       ONE row per intake: original message evidence, extracted fields, candidates,
--                               routing, thread association, status, decision
--   inbound_work_messages       APPEND-ONLY: every provider message taken in (the original and each reply), keyed
--                               UNIQUE by (tenant, mailbox, provider message id) -- duplicate protection is structural
--   inbound_work_order_links    APPEND-ONLY: the ONE Work Order an intake became (Accept) or was filed against (Attach)
--
-- ════════════════════ WHAT IS NOT HERE (the provider boundary) ════════════════════
--
-- Provider connections, OAuth, credential custody, mailbox polling / delivery cursors, attachment BYTE custody and
-- delivery-failure bookkeeping stay in the Firebase provider runtime (functions/src/inboundWork/email*.ts,
-- provider*.ts, attachmentCustody.ts; Firestore email_connections / email_mailboxes / email_routing_rules /
-- email_delivery_failures). Firebase Functions cannot reach this database, so that runtime cannot write here; its
-- cutover is a separate Owner ruling. Attachment METADATA is preserved here; the bytes are not.
--
-- ════════════════════ CAPABILITIES: FIVE, REGISTERED WITH NO GRANTS ════════════════════
--
-- PostgreSQL-NATIVE keys, deliberately NOT the Firebase catalog ids (service.inboundWork.*, administration.
-- emailIntake.*): those ids are in the in-repo PERMISSION_CATALOG, whose compatibility admin Role composes the whole
-- catalog, so registering them here would let the catalog reconcile import default grants (definition != grant).
--
--     inboundWork.request.read     (Firebase: service.inboundWork.read)
--     inboundWork.request.accept   (Firebase: service.inboundWork.accept)       -- ALSO requires workOrder.create
--     inboundWork.request.decline  (Firebase: service.inboundWork.decline)
--     inboundWork.request.attach   (Firebase: service.inboundWork.attachExisting)
--     inboundWork.intake.manage    (Firebase: administration.emailIntake.manage) -- mailbox + routing configuration
--                                  and the non-production delivery seam (the EOS API refuses to start in production)
--
-- Counts: capabilities +5; role_capabilities +0.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key IN ('inboundWork.request.read', 'inboundWork.request.accept', 'inboundWork.request.decline',
                   'inboundWork.request.attach', 'inboundWork.intake.manage')
        OR object_key IN ('inboundWorkRequest', 'inboundMailbox');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_INTAKE: an inbound work capability (or the inboundWorkRequest / inboundMailbox object) is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inboundWork_request_read', 'inboundWork.request.read',
     'Read the Inbound Work queue and one intake''s review detail: the original message as plain text, attachment metadata, extracted references, suggested customer / location / equipment, routing and thread association. Decides nothing and writes nothing.',
     'inboundWorkRequest', 'read', 'READ', 'Read Inbound Work'),
    ('cap_inboundWork_request_accept', 'inboundWork.request.accept',
     'Accept an inbound request into exactly ONE Work Order through the governed Work Order create (which separately requires workOrder.create). The reviewer STATES the operating company; it is never inferred from the sender or the customer. A replayed Accept returns the same Work Order. Never edits mastered Customer, Location, Contact or Equipment data.',
     'inboundWorkRequest', 'accept', 'BUSINESS_ACTION', 'Accept Inbound Work'),
    ('cap_inboundWork_request_decline', 'inboundWork.request.decline',
     'Decline an inbound request with a governed reason. The intake is retained, never deleted, so the decline remains answerable for reporting and audit.',
     'inboundWorkRequest', 'decline', 'BUSINESS_ACTION', 'Decline Inbound Work'),
    ('cap_inboundWork_request_attach', 'inboundWork.request.attach',
     'File an inbound request against an existing, non-terminal Work Order instead of creating one. Commits the business to nothing new.',
     'inboundWorkRequest', 'attach', 'BUSINESS_ACTION', 'Attach Inbound Work to a Work Order'),
    ('cap_inboundWork_intake_manage', 'inboundWork.intake.manage',
     'ADMINISTRATIVE CONFIGURATION: create and change the operational mailboxes and routing rules EOS intake is decided against, and deliver a normalized provider message into intake through the non-production delivery seam. Confers no authority to review, accept, decline or attach an inbound request, and binds no provider credential.',
     'inboundMailbox', 'manage', 'ADMIN_ACTION', 'Manage Inbound Work Intake')
ON CONFLICT (key) DO NOTHING;

SET search_path = eos_ops, public;

CREATE TABLE inbound_mailboxes (
    tenant_id                       TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id                              TEXT        NOT NULL,
    display_name                    TEXT        NOT NULL,
    email_address                   TEXT,
    purpose                         TEXT        NOT NULL DEFAULT 'OTHER',
    destination                     TEXT        NOT NULL DEFAULT 'SERVICE',
    default_queue                   TEXT,
    -- A SUGGESTION shown to the reviewer. Accept requires the reviewer to STATE the operating company.
    suggested_operating_company_id  TEXT,
    status                          TEXT        NOT NULL DEFAULT 'ACTIVE',
    inbound_enabled                 BOOLEAN     NOT NULL DEFAULT true,
    threading_enabled               BOOLEAN     NOT NULL DEFAULT true,
    version                         INTEGER     NOT NULL DEFAULT 1,
    updated_by_principal_id         TEXT        NOT NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT inbound_mailbox_status_known CHECK (status IN ('ACTIVE', 'DISABLED')),
    CONSTRAINT inbound_mailbox_purpose_known CHECK (purpose IN ('SERVICE', 'WARRANTY', 'PARTS', 'OTHER')),
    CONSTRAINT inbound_mailbox_destination_known CHECK (destination IN ('SERVICE', 'PARTS', 'SALES', 'OTHER')),
    CONSTRAINT inbound_mailbox_id_shape CHECK (btrim(id) <> '' AND length(id) <= 255),
    CONSTRAINT inbound_mailbox_name_shape CHECK (btrim(display_name) <> '' AND length(display_name) <= 120)
);

CREATE TABLE inbound_routing_rules (
    tenant_id                TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id                       TEXT        NOT NULL,
    name                     TEXT        NOT NULL,
    enabled                  BOOLEAN     NOT NULL DEFAULT true,
    rule_order               INTEGER     NOT NULL DEFAULT 100,
    when_condition           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    then_outcome             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    version                  INTEGER     NOT NULL DEFAULT 1,
    updated_by_principal_id  TEXT        NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT inbound_rule_id_shape CHECK (btrim(id) <> '' AND length(id) <= 255),
    CONSTRAINT inbound_rule_name_shape CHECK (btrim(name) <> '' AND length(name) <= 120),
    CONSTRAINT inbound_rule_json_objects CHECK (jsonb_typeof(when_condition) = 'object' AND jsonb_typeof(then_outcome) = 'object')
);

CREATE TABLE inbound_work_requests (
    tenant_id                        TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- Deterministic: inbound_ + sha256(tenant | mailbox | provider message id). A redelivery lands on the same id.
    id                               TEXT        NOT NULL,
    source_channel                   TEXT        NOT NULL DEFAULT 'EMAIL',
    source_provider                  TEXT        NOT NULL,
    source_connection_id             TEXT        NOT NULL DEFAULT '',
    source_mailbox_id                TEXT        NOT NULL,
    source_mailbox_name              TEXT,
    source_message_id                TEXT        NOT NULL,
    source_thread_id                 TEXT,
    -- sha256 of (sender | subject | normalized body): identical content under a different message id is flagged.
    content_key                      TEXT        NOT NULL,
    duplicate_of_request_id          TEXT,
    received_at                      TIMESTAMPTZ,
    sender                           TEXT        NOT NULL DEFAULT '',
    recipients                       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    cc                               JSONB       NOT NULL DEFAULT '[]'::jsonb,
    subject                          TEXT        NOT NULL DEFAULT '',
    -- EVIDENCE. Retained exactly as bounded at intake; NEVER projected to a client (the read returns plain text).
    original_body                    TEXT        NOT NULL DEFAULT '',
    original_body_content_type       TEXT        NOT NULL,
    normalized_body                  TEXT        NOT NULL DEFAULT '',
    attachment_refs                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    status                           TEXT        NOT NULL,
    status_note                      TEXT,
    request_type                     TEXT,
    destination                      TEXT,
    queue                            TEXT,
    suggested_operating_company_id   TEXT,
    priority                         SMALLINT,
    routing_rule_id                  TEXT,
    routing_rule_name                TEXT,
    routing_outcome                  TEXT,
    thread_association               TEXT,
    thread_association_candidate_ids JSONB       NOT NULL DEFAULT '[]'::jsonb,
    customer_candidate               JSONB,
    location_candidate               JSONB,
    equipment_candidate              JSONB,
    external_reference               TEXT,
    authorization_number             TEXT,
    problem_description              TEXT,
    serial_number                    TEXT,
    model_number                     TEXT,
    warnings                         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    processing_provider              TEXT        NOT NULL DEFAULT 'EOS_NATIVE',
    processing_metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    processing_error                 TEXT,
    -- The decision. Set once, by the governed decision commands only.
    decision                         TEXT,
    decision_reason                  TEXT,
    decision_note                    TEXT,
    decision_by_principal_id         TEXT,
    decision_at                      TIMESTAMPTZ,
    customer_id                      TEXT,
    customer_location_id             TEXT,
    equipment_id                     TEXT,
    work_order_id                    TEXT,
    operating_company_id             TEXT,
    -- The Accept CLAIM: the Principal whose create is in flight, and the status to return to if it fails.
    accept_claimed_by_principal_id   TEXT,
    accept_claim_prior_status        TEXT,
    ingested_by_principal_id         TEXT        NOT NULL,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    version                          INTEGER     NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT inbound_request_one_per_message UNIQUE (tenant_id, source_mailbox_id, source_message_id),
    CONSTRAINT inbound_request_status_known CHECK (status IN (
        'AWAITING_DECISION', 'NEEDS_REVIEW', 'ACCEPTING', 'ACCEPTED', 'DECLINED', 'ATTACHED', 'FAILED', 'QUARANTINED')),
    CONSTRAINT inbound_request_decision_known CHECK (decision IS NULL OR decision IN ('ACCEPTED', 'DECLINED', 'ATTACHED')),
    CONSTRAINT inbound_request_decline_reason_known CHECK (decision_reason IS NULL OR decision_reason IN (
        'OUTSIDE_SERVICE_AREA', 'UNSUPPORTED_EQUIPMENT', 'CAPACITY', 'DUPLICATE', 'CUSTOMER_ACCOUNT_ISSUE',
        'INVALID_REQUEST', 'OTHER')),
    CONSTRAINT inbound_request_content_type_known CHECK (original_body_content_type IN ('text/plain', 'text/html')),
    CONSTRAINT inbound_request_priority_governed CHECK (priority IS NULL OR priority BETWEEN 1 AND 4),
    CONSTRAINT inbound_request_decided_whole CHECK (
        (status IN ('ACCEPTED', 'DECLINED', 'ATTACHED')) = (decision IS NOT NULL)
        AND (status <> 'ACCEPTED' OR (decision = 'ACCEPTED' AND work_order_id IS NOT NULL AND operating_company_id IS NOT NULL))
        AND (status <> 'ATTACHED' OR (decision = 'ATTACHED' AND work_order_id IS NOT NULL))
        AND (status <> 'DECLINED' OR (decision = 'DECLINED' AND decision_reason IS NOT NULL AND work_order_id IS NULL))),
    CONSTRAINT inbound_request_claim_whole CHECK (
        (status = 'ACCEPTING') = (accept_claimed_by_principal_id IS NOT NULL)
        AND (accept_claimed_by_principal_id IS NULL) = (accept_claim_prior_status IS NULL)),
    CONSTRAINT inbound_request_work_order_fk FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id)
);
CREATE INDEX inbound_requests_queue ON inbound_work_requests (tenant_id, status, received_at DESC);
CREATE INDEX inbound_requests_by_thread ON inbound_work_requests (tenant_id, source_thread_id) WHERE source_thread_id IS NOT NULL;
CREATE INDEX inbound_requests_by_content ON inbound_work_requests (tenant_id, content_key);

CREATE TABLE inbound_work_messages (
    id                    TEXT        PRIMARY KEY,
    tenant_id             TEXT        NOT NULL,
    request_id            TEXT        NOT NULL,
    mailbox_id            TEXT        NOT NULL,
    provider_message_id   TEXT        NOT NULL,
    thread_id             TEXT,
    in_reply_to           TEXT,
    message_references    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    received_at           TIMESTAMPTZ,
    sender                TEXT        NOT NULL DEFAULT '',
    subject               TEXT        NOT NULL DEFAULT '',
    normalized_body       TEXT        NOT NULL DEFAULT '',
    attachment_refs       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    message_role          TEXT        NOT NULL,
    matched_on            TEXT,
    recorded_by_principal_id TEXT     NOT NULL,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT inbound_message_request_fk FOREIGN KEY (tenant_id, request_id) REFERENCES inbound_work_requests (tenant_id, id),
    CONSTRAINT inbound_message_role_known CHECK (message_role IN ('ORIGINAL', 'REPLY')),
    CONSTRAINT inbound_message_once UNIQUE (tenant_id, mailbox_id, provider_message_id)
);
CREATE INDEX inbound_messages_by_provider_id ON inbound_work_messages (tenant_id, provider_message_id);
CREATE INDEX inbound_messages_by_request ON inbound_work_messages (tenant_id, request_id, recorded_at);

CREATE TABLE inbound_work_order_links (
    id                      TEXT        PRIMARY KEY,
    tenant_id               TEXT        NOT NULL,
    request_id              TEXT        NOT NULL,
    work_order_id           TEXT        NOT NULL,
    link_kind               TEXT        NOT NULL,
    operating_company_id    TEXT,
    -- The lineage the Firebase Work Order carried inline (externalReference / authorizationNumber / inboundWorkRequestId).
    external_reference      TEXT,
    authorization_number    TEXT,
    linked_by_principal_id  TEXT        NOT NULL,
    linked_at               TIMESTAMPTZ NOT NULL,
    audit_event_id          TEXT        NOT NULL,
    CONSTRAINT inbound_link_request_fk FOREIGN KEY (tenant_id, request_id) REFERENCES inbound_work_requests (tenant_id, id),
    CONSTRAINT inbound_link_work_order_fk FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id),
    CONSTRAINT inbound_link_actor_fk FOREIGN KEY (tenant_id, linked_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT inbound_link_kind_known CHECK (link_kind IN ('CREATED_BY_ACCEPT', 'ATTACHED')),
    CONSTRAINT inbound_link_one_per_request UNIQUE (tenant_id, request_id)
);
CREATE INDEX inbound_links_by_work_order ON inbound_work_order_links (tenant_id, work_order_id);

CREATE FUNCTION inbound_work_refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: inbound message evidence and Work Order links are never edited or removed', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER inbound_work_messages_append_only BEFORE UPDATE OR DELETE ON inbound_work_messages
    FOR EACH ROW EXECUTE FUNCTION inbound_work_refuse_change();
CREATE TRIGGER inbound_work_order_links_append_only BEFORE UPDATE OR DELETE ON inbound_work_order_links
    FOR EACH ROW EXECUTE FUNCTION inbound_work_refuse_change();

-- An intake is RETAINED: declined, quarantined and failed intake is reporting and audit evidence.
CREATE FUNCTION inbound_work_request_refuse_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'inbound_work_requests are retained: an intake is declined, never deleted';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER inbound_work_requests_retained BEFORE DELETE ON inbound_work_requests
    FOR EACH ROW EXECUTE FUNCTION inbound_work_request_refuse_delete();

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities rc JOIN capabilities c ON c.id = rc.capability_id
     WHERE c.id IN ('cap_inboundWork_request_read', 'cap_inboundWork_request_accept', 'cap_inboundWork_request_decline',
                    'cap_inboundWork_request_attach', 'cap_inboundWork_intake_manage');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_INTAKE: refuses to reverse -- inbound work capabilities are held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities
     WHERE capability_id IN ('cap_inboundWork_request_read', 'cap_inboundWork_request_accept', 'cap_inboundWork_request_decline',
                             'cap_inboundWork_request_attach', 'cap_inboundWork_intake_manage');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_INTAKE: refuses to reverse -- inbound work capabilities are held by % direct grant(s)', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions
         WHERE capability_key IN ('inboundWork.request.read', 'inboundWork.request.accept', 'inboundWork.request.decline',
                                  'inboundWork.request.attach', 'inboundWork.intake.manage');
        IF v_n > 0 THEN
            RAISE EXCEPTION 'INBOUND_WORK_INTAKE: refuses to reverse -- % Administration decision(s) name an inbound work capability', v_n;
        END IF;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.inbound_work_requests;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_INTAKE: refuses to reverse -- % intake record(s) are retained evidence', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.inbound_mailboxes;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_INTAKE: refuses to reverse -- % configured mailbox(es) exist', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.inbound_routing_rules;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_WORK_INTAKE: refuses to reverse -- % routing rule(s) exist', v_n;
    END IF;
END
$$;

SET search_path = eos_ops, public;
DROP TRIGGER IF EXISTS inbound_work_order_links_append_only ON inbound_work_order_links;
DROP TRIGGER IF EXISTS inbound_work_messages_append_only ON inbound_work_messages;
DROP TRIGGER IF EXISTS inbound_work_requests_retained ON inbound_work_requests;
DROP FUNCTION IF EXISTS inbound_work_refuse_change();
DROP FUNCTION IF EXISTS inbound_work_request_refuse_delete();
DROP TABLE IF EXISTS inbound_work_order_links;
DROP TABLE IF EXISTS inbound_work_messages;
DROP TABLE IF EXISTS inbound_work_requests;
DROP TABLE IF EXISTS inbound_routing_rules;
DROP TABLE IF EXISTS inbound_mailboxes;
DELETE FROM eos_policy.capabilities WHERE id IN ('cap_inboundWork_request_read', 'cap_inboundWork_request_accept',
    'cap_inboundWork_request_decline', 'cap_inboundWork_request_attach', 'cap_inboundWork_intake_manage');
