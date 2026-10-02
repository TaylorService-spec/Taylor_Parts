-- Up Migration
-- THE ACCOUNTING DELIVERY CONTROL PLANE (Controller FINANCE ACTIVATION 2 NONPROD + TAX EVIDENCE UX + ACCOUNTING DELIVERY
-- CONTROL PLANE, 2026-10-02 H–Q; DECISIONS #198). Around the EXISTING eos_finance.accounting_handoffs (#197) -- no parallel
-- delivery model, NO real provider, no credential, no network.
--
-- EOS stays the operational truth. Delivering a handoff hands a versioned, provider-neutral payload (derived from the READY
-- Billing Package and its receivable) to the company's accounting destination through an adapter. The provider's answer
-- may record ITS document reference, a rejection or a failure -- it never changes an amount, the package, the receivable or
-- any financial fact. A rejection preserves the receivable and opens an actionable exception.
--
-- STATES (exact transitions, enforced here; anything else fails closed):
--   PENDING_DESTINATION   -> READY_FOR_DELIVERY (the company's destination configured) | SUPERSEDED
--   READY_FOR_DELIVERY    -> DELIVERY_IN_PROGRESS (an attempt starts)                  | SUPERSEDED
--   DELIVERY_IN_PROGRESS  -> ACKNOWLEDGED | REJECTED | FAILED_RETRYABLE | FAILED_FINAL   (the attempt's outcome)
--   FAILED_RETRYABLE      -> DELIVERY_IN_PROGRESS (ONLY a governed retry)               | SUPERSEDED
--   REJECTED, FAILED_FINAL-> SUPERSEDED (a corrected package replaces it)
--   ACKNOWLEDGED, SUPERSEDED: terminal.
-- Nothing schedules a retry: there is no timer, queue or cron. A retry is a governed act with a recorded reason.

SET search_path = eos_finance, public;

-- ════════════════════ 1. the handoff's states and its delivery columns ════════════════════

ALTER TABLE accounting_handoffs
    DROP CONSTRAINT IF EXISTS accounting_handoffs_status_check,
    DROP CONSTRAINT IF EXISTS accounting_handoffs_attempt_count_check,
    DROP CONSTRAINT IF EXISTS accounting_handoffs_last_attempt_at_check,
    DROP CONSTRAINT IF EXISTS accounting_handoffs_provider_acknowledged_at_check,
    DROP CONSTRAINT IF EXISTS accounting_handoffs_provider_document_reference_check,
    DROP CONSTRAINT IF EXISTS accounting_handoffs_failure_reason_check,
    DROP CONSTRAINT IF EXISTS accounting_handoff_destination_states;

ALTER TABLE accounting_handoffs
    ADD CONSTRAINT accounting_handoff_status_known CHECK (status IN ('PENDING_DESTINATION', 'READY_FOR_DELIVERY', 'DELIVERY_IN_PROGRESS',
        'ACKNOWLEDGED', 'REJECTED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SUPERSEDED')),
    ADD CONSTRAINT accounting_handoff_attempt_count_nonnegative CHECK (attempt_count >= 0),
    ADD CONSTRAINT accounting_handoff_provider_reference_shape CHECK (provider_document_reference IS NULL
        OR (btrim(provider_document_reference) <> '' AND length(provider_document_reference) <= 200)),
    ADD CONSTRAINT accounting_handoff_destination_states CHECK (
        (status = 'PENDING_DESTINATION' AND accounting_destination_id IS NULL AND readiness_exceptions = '{ACCOUNTING_DESTINATION_MISSING}')
        OR (status IN ('READY_FOR_DELIVERY', 'DELIVERY_IN_PROGRESS', 'ACKNOWLEDGED', 'REJECTED', 'FAILED_RETRYABLE', 'FAILED_FINAL')
            AND accounting_destination_id IS NOT NULL AND cardinality(readiness_exceptions) = 0)
        OR status = 'SUPERSEDED'),
    -- Acknowledged carries the provider's reference and time; nothing else does.
    ADD CONSTRAINT accounting_handoff_acknowledgement_shape CHECK (
        (status = 'ACKNOWLEDGED') = (provider_acknowledged_at IS NOT NULL AND provider_document_reference IS NOT NULL)
        OR (status = 'SUPERSEDED' AND provider_acknowledged_at IS NULL AND provider_document_reference IS NULL)),
    ADD CONSTRAINT accounting_handoff_failure_shape CHECK (
        (status IN ('REJECTED', 'FAILED_RETRYABLE', 'FAILED_FINAL')) = (failure_reason IS NOT NULL) OR status = 'SUPERSEDED'),
    ADD CONSTRAINT accounting_handoff_attempted_shape CHECK (
        (status IN ('PENDING_DESTINATION', 'READY_FOR_DELIVERY')) = (attempt_count = 0 AND last_attempt_at IS NULL) OR status = 'SUPERSEDED');

-- Identity never changes; status moves only along the transitions above; attempt_count only grows by one on entering
-- DELIVERY_IN_PROGRESS; an acknowledgement is recorded once and never rewritten.
CREATE OR REPLACE FUNCTION refuse_accounting_handoff_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_finance, public AS $$
DECLARE
    v_mutable CONSTANT TEXT[] := ARRAY['accounting_destination_id', 'status', 'readiness_exceptions', 'updated_at', 'attempt_count',
        'last_attempt_at', 'provider_acknowledged_at', 'provider_document_reference', 'failure_reason'];
    v_allowed BOOLEAN;
BEGIN
    IF TG_OP <> 'UPDATE' OR (to_jsonb(NEW) - v_mutable) <> (to_jsonb(OLD) - v_mutable) THEN
        RAISE EXCEPTION 'ACCOUNTING_HANDOFF_IMMUTABLE: a handoff''s company, package, obligation and payload never change';
    END IF;
    IF NEW.status = OLD.status THEN
        -- Same state: only a pending handoff's readiness may be re-stated; nothing delivery-related moves.
        IF NEW.attempt_count <> OLD.attempt_count OR NEW.last_attempt_at IS DISTINCT FROM OLD.last_attempt_at
           OR NEW.provider_document_reference IS DISTINCT FROM OLD.provider_document_reference
           OR NEW.provider_acknowledged_at IS DISTINCT FROM OLD.provider_acknowledged_at
           OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason
           OR (OLD.status <> 'PENDING_DESTINATION' AND NEW.accounting_destination_id IS DISTINCT FROM OLD.accounting_destination_id) THEN
            RAISE EXCEPTION 'ACCOUNTING_HANDOFF_TRANSITION_REFUSED: % may not change its delivery record in place', OLD.status;
        END IF;
        RETURN NEW;
    END IF;
    v_allowed := (OLD.status, NEW.status) IN (
        ('PENDING_DESTINATION', 'READY_FOR_DELIVERY'), ('PENDING_DESTINATION', 'SUPERSEDED'),
        ('READY_FOR_DELIVERY', 'DELIVERY_IN_PROGRESS'), ('READY_FOR_DELIVERY', 'SUPERSEDED'),
        ('DELIVERY_IN_PROGRESS', 'ACKNOWLEDGED'), ('DELIVERY_IN_PROGRESS', 'REJECTED'),
        ('DELIVERY_IN_PROGRESS', 'FAILED_RETRYABLE'), ('DELIVERY_IN_PROGRESS', 'FAILED_FINAL'),
        ('FAILED_RETRYABLE', 'DELIVERY_IN_PROGRESS'), ('FAILED_RETRYABLE', 'SUPERSEDED'),
        ('REJECTED', 'SUPERSEDED'), ('FAILED_FINAL', 'SUPERSEDED'));
    IF NOT v_allowed THEN
        RAISE EXCEPTION 'ACCOUNTING_HANDOFF_TRANSITION_REFUSED: % -> % is not a delivery transition', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'DELIVERY_IN_PROGRESS' AND (NEW.attempt_count <> OLD.attempt_count + 1 OR NEW.last_attempt_at IS NULL) THEN
        RAISE EXCEPTION 'ACCOUNTING_HANDOFF_TRANSITION_REFUSED: entering delivery records exactly one new attempt';
    END IF;
    IF NEW.status <> 'DELIVERY_IN_PROGRESS' AND NEW.attempt_count <> OLD.attempt_count THEN
        RAISE EXCEPTION 'ACCOUNTING_HANDOFF_TRANSITION_REFUSED: only entering delivery counts an attempt';
    END IF;
    IF OLD.status <> 'PENDING_DESTINATION' AND NEW.accounting_destination_id IS DISTINCT FROM OLD.accounting_destination_id THEN
        RAISE EXCEPTION 'ACCOUNTING_HANDOFF_TRANSITION_REFUSED: the destination is fixed once delivery is possible';
    END IF;
    RETURN NEW;
END;
$$;

-- ════════════════════ 2. durable delivery attempts ════════════════════

CREATE TABLE accounting_handoff_attempts (
    id                         TEXT PRIMARY KEY,
    tenant_id                  TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    handoff_id                 TEXT NOT NULL REFERENCES accounting_handoffs(id),
    attempt_number             INTEGER NOT NULL CHECK (attempt_number >= 1),
    operating_company_id       TEXT NOT NULL CHECK (lower(operating_company_id) <> 'consolidated'),
    accounting_destination_id  TEXT NOT NULL REFERENCES accounting_destinations(id),
    adapter_key                TEXT NOT NULL CHECK (adapter_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
    -- The exact provider-neutral payload handed to the adapter, its contract version and canonical fingerprint.
    payload_contract           TEXT NOT NULL CHECK (payload_contract = 'eos.accounting.operational-billing-package'),
    payload_contract_version   INTEGER NOT NULL CHECK (payload_contract_version >= 1),
    payload                    JSONB NOT NULL,
    payload_fingerprint        TEXT NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
    -- The key the adapter presents to the destination. STABLE across a handoff's attempts for the same payload, so a
    -- provider that already accepted an earlier attempt can de-duplicate a governed retry instead of creating a second document.
    delivery_idempotency_key   TEXT NOT NULL CHECK (btrim(delivery_idempotency_key) <> ''),
    -- The governed request that started it (a replayed request returns this attempt, never a second one).
    request_idempotency_key    TEXT NOT NULL CHECK (btrim(request_idempotency_key) <> ''),
    initiation                 TEXT NOT NULL CHECK (initiation IN ('INITIAL', 'GOVERNED_RETRY')),
    retry_of_attempt_id        TEXT REFERENCES accounting_handoff_attempts(id),
    retry_reason               TEXT,
    initiated_by               TEXT NOT NULL CHECK (btrim(initiated_by) <> ''),
    started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    outcome                    TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                               CHECK (outcome IN ('IN_PROGRESS', 'ACKNOWLEDGED', 'REJECTED', 'FAILED_RETRYABLE', 'FAILED_FINAL')),
    outcome_at                 TIMESTAMPTZ,
    provider_document_reference TEXT CHECK (provider_document_reference IS NULL
                               OR (btrim(provider_document_reference) <> '' AND length(provider_document_reference) <= 200)),
    failure_code               TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    failure_detail             TEXT CHECK (failure_detail IS NULL OR length(failure_detail) <= 500),
    CONSTRAINT accounting_attempt_number_unique UNIQUE (tenant_id, handoff_id, attempt_number),
    CONSTRAINT accounting_attempt_request_unique UNIQUE (tenant_id, request_idempotency_key),
    CONSTRAINT accounting_attempt_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT accounting_attempt_retry_shape CHECK (
        (initiation = 'INITIAL' AND retry_of_attempt_id IS NULL AND retry_reason IS NULL AND attempt_number = 1)
        OR (initiation = 'GOVERNED_RETRY' AND retry_of_attempt_id IS NOT NULL AND btrim(coalesce(retry_reason, '')) <> '' AND attempt_number > 1)),
    CONSTRAINT accounting_attempt_outcome_shape CHECK (
        (outcome = 'IN_PROGRESS' AND outcome_at IS NULL AND provider_document_reference IS NULL AND failure_code IS NULL)
        OR (outcome = 'ACKNOWLEDGED' AND outcome_at IS NOT NULL AND provider_document_reference IS NOT NULL AND failure_code IS NULL)
        OR (outcome IN ('REJECTED', 'FAILED_RETRYABLE', 'FAILED_FINAL') AND outcome_at IS NOT NULL AND provider_document_reference IS NULL
            AND failure_code IS NOT NULL))
);
-- At most one attempt in flight per handoff.
CREATE UNIQUE INDEX accounting_attempt_one_in_progress ON accounting_handoff_attempts (tenant_id, handoff_id) WHERE outcome = 'IN_PROGRESS';

-- Append-only; the ONE permitted update records an in-progress attempt's outcome, once.
CREATE OR REPLACE FUNCTION refuse_accounting_attempt_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_finance, public AS $$
DECLARE
    v_outcome CONSTANT TEXT[] := ARRAY['outcome', 'outcome_at', 'provider_document_reference', 'failure_code', 'failure_detail'];
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.outcome = 'IN_PROGRESS' AND NEW.outcome <> 'IN_PROGRESS'
       AND (to_jsonb(NEW) - v_outcome) = (to_jsonb(OLD) - v_outcome) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ACCOUNTING_ATTEMPT_IMMUTABLE: a delivery attempt is append-only; its outcome is recorded once';
END;
$$;
CREATE TRIGGER accounting_handoff_attempts_immutable BEFORE UPDATE OR DELETE ON accounting_handoff_attempts
    FOR EACH ROW EXECUTE FUNCTION refuse_accounting_attempt_mutation();

-- ════════════════════ 3. actionable delivery exceptions ════════════════════

CREATE TABLE accounting_handoff_exceptions (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    handoff_id        TEXT NOT NULL REFERENCES accounting_handoffs(id),
    attempt_id        TEXT NOT NULL REFERENCES accounting_handoff_attempts(id),
    operating_company_id TEXT NOT NULL CHECK (lower(operating_company_id) <> 'consolidated'),
    kind              TEXT NOT NULL CHECK (kind IN ('PROVIDER_REJECTED', 'DELIVERY_FAILED_FINAL')),
    reason_code       TEXT NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    detail            TEXT CHECK (detail IS NULL OR length(detail) <= 500),
    -- What a person can do about it (a correction replaces the package; delivery of THIS payload is final).
    required_action   TEXT NOT NULL CHECK (required_action IN ('CORRECT_AND_SUPERSEDE_PACKAGE', 'REVIEW_DESTINATION_CONFIGURATION')),
    status            TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
    opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_by       TEXT,
    resolved_at       TIMESTAMPTZ,
    resolution        TEXT,
    CONSTRAINT accounting_exception_one_per_attempt UNIQUE (tenant_id, attempt_id),
    CONSTRAINT accounting_exception_resolution_shape CHECK (
        (status = 'OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution IS NULL)
        OR (status = 'RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND btrim(coalesce(resolution, '')) <> ''))
);
CREATE INDEX accounting_exceptions_open ON accounting_handoff_exceptions (tenant_id, operating_company_id) WHERE status = 'OPEN';

CREATE OR REPLACE FUNCTION refuse_accounting_exception_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_finance, public AS $$
DECLARE
    v_resolution CONSTANT TEXT[] := ARRAY['status', 'resolved_by', 'resolved_at', 'resolution'];
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status = 'OPEN' AND NEW.status = 'RESOLVED'
       AND (to_jsonb(NEW) - v_resolution) = (to_jsonb(OLD) - v_resolution) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ACCOUNTING_EXCEPTION_IMMUTABLE: an exception is resolved once and never rewritten';
END;
$$;
CREATE TRIGGER accounting_handoff_exceptions_immutable BEFORE UPDATE OR DELETE ON accounting_handoff_exceptions
    FOR EACH ROW EXECUTE FUNCTION refuse_accounting_exception_mutation();

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM accounting_handoff_attempts;
    IF v_n > 0 THEN RAISE EXCEPTION 'ACCOUNTING_DELIVERY: refuses to reverse -- % delivery attempt(s) are Finance history', v_n; END IF;
END
$$;

DROP TABLE IF EXISTS accounting_handoff_exceptions;
DROP TABLE IF EXISTS accounting_handoff_attempts;
DROP FUNCTION IF EXISTS refuse_accounting_exception_mutation();
DROP FUNCTION IF EXISTS refuse_accounting_attempt_mutation();

ALTER TABLE accounting_handoffs
    DROP CONSTRAINT IF EXISTS accounting_handoff_status_known,
    DROP CONSTRAINT IF EXISTS accounting_handoff_attempt_count_nonnegative,
    DROP CONSTRAINT IF EXISTS accounting_handoff_provider_reference_shape,
    DROP CONSTRAINT IF EXISTS accounting_handoff_destination_states,
    DROP CONSTRAINT IF EXISTS accounting_handoff_acknowledgement_shape,
    DROP CONSTRAINT IF EXISTS accounting_handoff_failure_shape,
    DROP CONSTRAINT IF EXISTS accounting_handoff_attempted_shape;
ALTER TABLE accounting_handoffs
    ADD CONSTRAINT accounting_handoffs_status_check CHECK (status IN ('PENDING_DESTINATION', 'READY_FOR_DELIVERY', 'SUPERSEDED')),
    ADD CONSTRAINT accounting_handoffs_attempt_count_check CHECK (attempt_count = 0),
    ADD CONSTRAINT accounting_handoffs_last_attempt_at_check CHECK (last_attempt_at IS NULL),
    ADD CONSTRAINT accounting_handoffs_provider_acknowledged_at_check CHECK (provider_acknowledged_at IS NULL),
    ADD CONSTRAINT accounting_handoffs_provider_document_reference_check CHECK (provider_document_reference IS NULL),
    ADD CONSTRAINT accounting_handoffs_failure_reason_check CHECK (failure_reason IS NULL),
    ADD CONSTRAINT accounting_handoff_destination_states CHECK (
        (status = 'PENDING_DESTINATION' AND accounting_destination_id IS NULL AND readiness_exceptions = '{ACCOUNTING_DESTINATION_MISSING}')
        OR (status = 'READY_FOR_DELIVERY' AND accounting_destination_id IS NOT NULL AND cardinality(readiness_exceptions) = 0)
        OR status = 'SUPERSEDED');

CREATE OR REPLACE FUNCTION refuse_accounting_handoff_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_finance, public AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'accounting_destination_id' - 'status' - 'readiness_exceptions' - 'updated_at')
         = (to_jsonb(OLD) - 'accounting_destination_id' - 'status' - 'readiness_exceptions' - 'updated_at')
       AND OLD.status <> 'SUPERSEDED' THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ACCOUNTING_HANDOFF_IMMUTABLE: a handoff''s company, package, obligation and payload never change';
END;
$$;
