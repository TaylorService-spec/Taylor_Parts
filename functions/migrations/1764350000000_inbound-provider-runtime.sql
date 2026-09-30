-- Up Migration
-- INBOUND PROVIDER RUNTIME -> EOS / POSTGRESQL (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment A).
--
-- Real mailbox ingestion moves off Firebase:
--
--     M365 / Google provider  ->  EOS (Render)  ->  PostgreSQL Inbound Work  ->  the existing governed review
--
-- This migration is the provider boundary's PostgreSQL home -- the facts the Firebase provider runtime kept in the
-- Firestore collections email_connections / email_oauth_states / email_mailboxes (delivery fields) /
-- email_delivery_failures, and the attachment bytes it kept in Cloud Storage. No Firestore staging, no Firebase
-- callable, no Firebase bridge, no dual write: the EOS poller reads the provider and writes HERE only.
--
-- ════════════════════ CREDENTIAL CUSTODY IS STRUCTURAL ════════════════════
--
--   * There is NO column for an access token or a refresh token, so no later change can quietly start storing one.
--   * A connection records only WHERE its refresh token lives (a Secret Manager secret name + version). The CHECK
--     below admits only the platform vault's own naming (projects/<p>/secrets/eos-email-connection-<id>) or the
--     in-memory vault a test uses (memory://<id>) -- a value shaped like credential material is refused.
--   * CONSENT IS NOT CONNECTED: oauth_status CONNECTED requires a stored credential reference, and
--     connection_status CONNECTED (the mailbox is actually readable) is a separate fact set only after a read.
--   * The OAuth state is stored by its sha256 (a read of the table yields nothing presentable at the callback); the
--     PKCE verifier beside it never leaves the server.
--
-- ════════════════════ ATTACHMENT CUSTODY ════════════════════
--
-- inbound_work_attachments holds the BYTES, append-only, bounded (25 MiB, the conservative provider ceiling), keyed
-- deterministically by (request, provider message, provider attachment) so a retry cannot store a second copy. The
-- declared content type is DATA, never served as an active type. Nothing here claims malware scanning.
--
-- No capability, no grant: the runtime is governed by inboundWork.intake.manage (connections, mailboxes, polling)
-- and inboundWork.request.read (an attachment is read through the request it belongs to).
SET search_path = eos_ops, public;

CREATE TABLE inbound_provider_connections (
    tenant_id                    TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id                           TEXT        NOT NULL,
    connection_name              TEXT        NOT NULL,
    provider                     TEXT        NOT NULL,
    tenant_or_workspace          TEXT        NOT NULL DEFAULT '',
    connected_account            TEXT        NOT NULL DEFAULT '',
    inbound_enabled              BOOLEAN     NOT NULL DEFAULT true,
    oauth_status                 TEXT        NOT NULL DEFAULT 'NOT_CONNECTED',
    connection_status            TEXT        NOT NULL DEFAULT 'NOT_CONNECTED',
    health                       TEXT        NOT NULL DEFAULT 'UNKNOWN',
    -- WHERE the refresh token lives. Never the token.
    credential_secret_name       TEXT,
    credential_version           TEXT,
    granted_scopes               TEXT,
    authorization_started_at     TIMESTAMPTZ,
    authorized_at                TIMESTAMPTZ,
    authorized_by_principal_id   TEXT,
    last_token_refresh_at        TIMESTAMPTZ,
    last_health_check_at         TIMESTAMPTZ,
    last_successful_sync_at      TIMESTAMPTZ,
    last_message_received_at     TIMESTAMPTZ,
    last_provider_error_at       TIMESTAMPTZ,
    provider_error_code          TEXT,
    disconnected_at              TIMESTAMPTZ,
    version                      INTEGER     NOT NULL DEFAULT 1,
    updated_by_principal_id      TEXT        NOT NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT inbound_connection_id_shape CHECK (id ~ '^[A-Za-z0-9_-]{1,180}$'),
    CONSTRAINT inbound_connection_name_shape CHECK (btrim(connection_name) <> '' AND length(connection_name) <= 120),
    CONSTRAINT inbound_connection_provider_known CHECK (provider IN ('MICROSOFT_365', 'GOOGLE_WORKSPACE')),
    CONSTRAINT inbound_connection_oauth_known CHECK (oauth_status IN ('NOT_CONNECTED', 'PENDING_AUTHORIZATION', 'CONNECTED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT inbound_connection_status_known CHECK (connection_status IN ('NOT_CONNECTED', 'CONNECTED', 'FAILED')),
    CONSTRAINT inbound_connection_health_known CHECK (health IN ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'FAILED')),
    CONSTRAINT inbound_connection_credential_is_a_reference CHECK (
        credential_secret_name IS NULL
        OR credential_secret_name ~ '^projects/[a-z0-9-]{1,63}/secrets/eos-email-connection-[A-Za-z0-9_-]{1,180}$'
        OR credential_secret_name ~ '^memory://[A-Za-z0-9_-]{1,180}$'),
    CONSTRAINT inbound_connection_version_shape CHECK (credential_version IS NULL OR credential_version ~ '^[A-Za-z0-9_-]{1,40}$'),
    -- Consent is not a connection: CONNECTED needs a stored credential reference.
    CONSTRAINT inbound_connection_connected_has_credential CHECK (oauth_status <> 'CONNECTED' OR credential_secret_name IS NOT NULL),
    CONSTRAINT inbound_connection_readable_needs_oauth CHECK (connection_status <> 'CONNECTED' OR oauth_status = 'CONNECTED')
);

CREATE TABLE inbound_oauth_states (
    state_key                    TEXT        PRIMARY KEY,
    tenant_id                    TEXT        NOT NULL,
    connection_id                TEXT        NOT NULL,
    provider                     TEXT        NOT NULL,
    redirect_uri                 TEXT        NOT NULL,
    initiated_by_principal_id    TEXT        NOT NULL,
    code_verifier                TEXT        NOT NULL,
    created_at                   TIMESTAMPTZ NOT NULL,
    expires_at                   TIMESTAMPTZ NOT NULL,
    consumed_at                  TIMESTAMPTZ,
    CONSTRAINT inbound_oauth_state_key_is_a_hash CHECK (state_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT inbound_oauth_state_connection_fk FOREIGN KEY (tenant_id, connection_id) REFERENCES inbound_provider_connections (tenant_id, id)
);

ALTER TABLE inbound_mailboxes
    ADD COLUMN connection_id               TEXT,
    ADD COLUMN attachment_policy           TEXT        NOT NULL DEFAULT 'STORE',
    ADD COLUMN delivery_cursor             JSONB,
    ADD COLUMN last_polled_at              TIMESTAMPTZ,
    ADD COLUMN last_successful_delivery_at TIMESTAMPTZ,
    ADD COLUMN last_message_received_at    TIMESTAMPTZ,
    ADD COLUMN mailbox_validated_at        TIMESTAMPTZ,
    ADD COLUMN mailbox_readable            BOOLEAN,
    ADD COLUMN mailbox_validation_detail   TEXT,
    ADD CONSTRAINT inbound_mailbox_connection_fk FOREIGN KEY (tenant_id, connection_id) REFERENCES inbound_provider_connections (tenant_id, id),
    ADD CONSTRAINT inbound_mailbox_attachment_policy_known CHECK (attachment_policy IN ('STORE', 'PRESERVE_METADATA', 'IGNORE'));

CREATE TABLE inbound_delivery_failures (
    tenant_id          TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id                 TEXT        NOT NULL,
    connection_id      TEXT        NOT NULL,
    mailbox_id         TEXT        NOT NULL,
    subject_id         TEXT        NOT NULL,
    code               TEXT        NOT NULL,
    -- Operator-facing, bounded, never a provider body, token or raw payload.
    detail             TEXT        NOT NULL DEFAULT '',
    disposition        TEXT        NOT NULL,
    attempts           INTEGER     NOT NULL DEFAULT 1,
    exhausted          BOOLEAN     NOT NULL DEFAULT false,
    status             TEXT        NOT NULL DEFAULT 'OPEN',
    next_attempt_at    TIMESTAMPTZ,
    first_failed_at    TIMESTAMPTZ NOT NULL,
    last_failed_at     TIMESTAMPTZ NOT NULL,
    resolved_at        TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT inbound_failure_code_known CHECK (code IN ('AUTH_EXPIRED', 'AUTH_REVOKED', 'MAILBOX_NOT_FOUND', 'MAILBOX_ACCESS_DENIED',
        'PROVIDER_RATE_LIMIT', 'PROVIDER_UNAVAILABLE', 'MESSAGE_FETCH_FAILED', 'ATTACHMENT_FETCH_FAILED', 'CURSOR_EXPIRED',
        'CONFIGURATION_INVALID', 'DELIVERY_RETRY_EXHAUSTED', 'CREDENTIAL_VAULT_UNAVAILABLE')),
    CONSTRAINT inbound_failure_disposition_known CHECK (disposition IN ('RETRYABLE', 'REFRESH_THEN_RETRY', 'REQUIRES_ADMIN_ACTION')),
    CONSTRAINT inbound_failure_status_known CHECK (status IN ('OPEN', 'RESOLVED', 'DELIVERY_RETRY_EXHAUSTED')),
    CONSTRAINT inbound_failure_detail_bounded CHECK (length(detail) <= 300)
);
CREATE INDEX inbound_failures_open ON inbound_delivery_failures (tenant_id, mailbox_id, status);

CREATE TABLE inbound_work_attachments (
    tenant_id                TEXT        NOT NULL,
    id                       TEXT        NOT NULL,
    request_id               TEXT        NOT NULL,
    source_message_id        TEXT        NOT NULL,
    provider_attachment_id   TEXT        NOT NULL,
    -- A sender's filename is DATA (sanitized), never a path; the declared type is a claim, never served as active.
    filename                 TEXT        NOT NULL,
    declared_mime_type       TEXT        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes               INTEGER     NOT NULL,
    content_sha256           TEXT        NOT NULL,
    content                  BYTEA       NOT NULL,
    stored_by_principal_id   TEXT        NOT NULL,
    stored_at                TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT inbound_attachment_request_fk FOREIGN KEY (tenant_id, request_id) REFERENCES inbound_work_requests (tenant_id, id),
    CONSTRAINT inbound_attachment_once UNIQUE (tenant_id, request_id, source_message_id, provider_attachment_id),
    CONSTRAINT inbound_attachment_size_bounded CHECK (size_bytes >= 0 AND size_bytes <= 26214400 AND octet_length(content) = size_bytes),
    CONSTRAINT inbound_attachment_hash_shape CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT inbound_attachment_filename_shape CHECK (btrim(filename) <> '' AND length(filename) <= 255 AND filename !~ '[/\\]')
);
CREATE TRIGGER inbound_work_attachments_append_only BEFORE UPDATE OR DELETE ON inbound_work_attachments
    FOR EACH ROW EXECUTE FUNCTION inbound_work_refuse_change();

ALTER TABLE inbound_work_requests
    ADD COLUMN attachment_custody TEXT NOT NULL DEFAULT 'NONE',
    ADD CONSTRAINT inbound_request_attachment_custody_known CHECK (attachment_custody IN
        ('NONE', 'PENDING', 'PARTIAL', 'COMPLETE', 'FAILED', 'METADATA_ONLY', 'REFUSED_UNSAFE'));

-- Down Migration
SET search_path = eos_ops, public;
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.inbound_work_attachments;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_PROVIDER_RUNTIME: refuses to reverse -- % custodied attachment(s) are retained evidence', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.inbound_provider_connections WHERE oauth_status = 'CONNECTED';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'INBOUND_PROVIDER_RUNTIME: refuses to reverse -- % connection(s) hold a stored authorization; disconnect first', v_n;
    END IF;
END
$$;
ALTER TABLE inbound_work_requests DROP CONSTRAINT IF EXISTS inbound_request_attachment_custody_known, DROP COLUMN IF EXISTS attachment_custody;
DROP TRIGGER IF EXISTS inbound_work_attachments_append_only ON inbound_work_attachments;
DROP TABLE IF EXISTS inbound_work_attachments;
DROP TABLE IF EXISTS inbound_delivery_failures;
ALTER TABLE inbound_mailboxes
    DROP CONSTRAINT IF EXISTS inbound_mailbox_connection_fk,
    DROP CONSTRAINT IF EXISTS inbound_mailbox_attachment_policy_known,
    DROP COLUMN IF EXISTS connection_id, DROP COLUMN IF EXISTS attachment_policy, DROP COLUMN IF EXISTS delivery_cursor,
    DROP COLUMN IF EXISTS last_polled_at, DROP COLUMN IF EXISTS last_successful_delivery_at, DROP COLUMN IF EXISTS last_message_received_at,
    DROP COLUMN IF EXISTS mailbox_validated_at, DROP COLUMN IF EXISTS mailbox_readable, DROP COLUMN IF EXISTS mailbox_validation_detail;
DROP TABLE IF EXISTS inbound_oauth_states;
DROP TABLE IF EXISTS inbound_provider_connections;
