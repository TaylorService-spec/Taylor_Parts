-- Up Migration
-- FINANCE ACTIVATION 2 -- OPERATIONAL RECEIVABLE + TAX EVIDENCE + ACCOUNTING HANDOFF BOUNDARY (Controller, 2026-10-02;
-- Owner rulings; DECISIONS #197). Activates the EXISTING Finance foundation -- no parallel AR model.
--
-- 1. TAX EVIDENCE (Owner ruling: unknown tax != zero tax). Tax is a governed Commercial INPUT on the Sales Agreement; this
--    adds its EVIDENCE STATE -- never a calculation, rate, provider or jurisdiction:
--      NOT_DETERMINED     no governed determination (a new Agreement without one; the default for new writes);
--      DETERMINED         an explicit determination WITH an amount (0 included -- a determined zero) in the Agreement's currency;
--      LEGACY_UNVERIFIED  every Agreement that existed before this migration: the writer then stored an omitted tax as 0, so its
--                         tax_minor is NOT evidence and is never promoted to a determined zero. The rows are not rewritten.
--    The Billing Package uses an Agreement's tax ONLY when DETERMINED; anything else is TAX_NOT_DETERMINED and HOLDS it.
--
-- 2. THE EOS OPERATIONAL RECEIVABLE is an ordinary eos_finance.obligations row of kind RECEIVABLE, opened through the
--    foundation's own obligation path (its origination fact is the foundation's invariant: balances derive from facts -- it
--    is not GL / revenue recognition). One per READY Billing Package, structurally.
--
-- 3. THE ACCOUNTING HANDOFF -- the provider-neutral record of "this READY package / receivable is to be handed to the
--    company's accounting destination". Nothing is delivered. A missing destination is an explicit readiness exception
--    (ACCOUNTING_DESTINATION_MISSING); the EOS receivable stands regardless. Provider acknowledgement / document reference /
--    failure columns exist, empty, for the later delivery package. No provider-specific schema, no credential.

SET search_path = eos_finance, public;

-- ════════════════════ 1. tax evidence ════════════════════

ALTER TABLE eos_commercial.sales_agreements
    ADD COLUMN tax_evidence_status TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED',
    ADD COLUMN tax_evidence_currency TEXT,
    ADD COLUMN tax_evidence_recorded_by TEXT,
    ADD COLUMN tax_evidence_recorded_at TIMESTAMPTZ,
    ADD CONSTRAINT sales_agreement_tax_evidence_known
        CHECK (tax_evidence_status IN ('NOT_DETERMINED', 'DETERMINED', 'LEGACY_UNVERIFIED')),
    -- DETERMINED carries an amount (0 allowed) in the Agreement's own currency, and who recorded it; the others carry none.
    ADD CONSTRAINT sales_agreement_tax_evidence_shape CHECK (
        (tax_evidence_status = 'DETERMINED' AND tax_minor IS NOT NULL AND tax_minor >= 0 AND tax_evidence_currency IS NOT NULL
         AND tax_evidence_currency = currency AND tax_evidence_recorded_by IS NOT NULL AND tax_evidence_recorded_at IS NOT NULL)
        OR (tax_evidence_status <> 'DETERMINED' AND tax_evidence_currency IS NULL));

-- The package records the evidence state its tax came from (NULL on packages prepared before this migration).
ALTER TABLE billing_packages
    ADD COLUMN tax_evidence_status TEXT CHECK (tax_evidence_status IS NULL
        OR tax_evidence_status IN ('NOT_DETERMINED', 'DETERMINED', 'LEGACY_UNVERIFIED', 'NO_TAX_SOURCE'));

-- ════════════════════ 2. one receivable per Billing Package ════════════════════

CREATE UNIQUE INDEX obligation_one_per_billing_package ON obligations (tenant_id, source_record_id)
    WHERE source_domain = 'BILLING_PACKAGE';

-- ════════════════════ 3. the accounting handoff ════════════════════

CREATE TABLE accounting_handoffs (
    id                          TEXT PRIMARY KEY,
    tenant_id                   TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id        TEXT NOT NULL CHECK (lower(operating_company_id) <> 'consolidated'),
    billing_package_id          TEXT NOT NULL REFERENCES billing_packages(id),
    obligation_id               TEXT NOT NULL,
    -- The company's provider-neutral destination when configured; NULL = ACCOUNTING_DESTINATION_MISSING.
    accounting_destination_id   TEXT REFERENCES accounting_destinations(id),
    payload_kind                TEXT NOT NULL CHECK (payload_kind IN ('OPERATIONAL_BILLING_PACKAGE')),
    payload_version             INTEGER NOT NULL CHECK (payload_version >= 1),
    payload_fingerprint         TEXT NOT NULL,
    status                      TEXT NOT NULL CHECK (status IN ('PENDING_DESTINATION', 'READY_FOR_DELIVERY', 'SUPERSEDED')),
    readiness_exceptions        TEXT[] NOT NULL DEFAULT '{}',
    -- Later delivery package: attempts, acknowledgement, the provider's own document reference, failure. Empty now.
    attempt_count               INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count = 0),
    last_attempt_at             TIMESTAMPTZ CHECK (last_attempt_at IS NULL),
    provider_acknowledged_at    TIMESTAMPTZ CHECK (provider_acknowledged_at IS NULL),
    provider_document_reference TEXT CHECK (provider_document_reference IS NULL),
    failure_reason              TEXT CHECK (failure_reason IS NULL),
    idempotency_key             TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    correlation_id              TEXT,
    created_by                  TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounting_handoff_one_per_package UNIQUE (tenant_id, billing_package_id),
    CONSTRAINT accounting_handoff_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT accounting_handoff_obligation_fk FOREIGN KEY (tenant_id, obligation_id) REFERENCES obligations (tenant_id, id),
    CONSTRAINT accounting_handoff_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT accounting_handoff_destination_states CHECK (
        (status = 'PENDING_DESTINATION' AND accounting_destination_id IS NULL AND readiness_exceptions = '{ACCOUNTING_DESTINATION_MISSING}')
        OR (status = 'READY_FOR_DELIVERY' AND accounting_destination_id IS NOT NULL AND cardinality(readiness_exceptions) = 0)
        OR status = 'SUPERSEDED')
);
CREATE INDEX accounting_handoffs_by_company ON accounting_handoffs (tenant_id, operating_company_id, status);

-- The handoff's identity (company, package, obligation, payload) never changes; only its destination / status may move
-- (PENDING_DESTINATION -> READY_FOR_DELIVERY when the company's destination is configured; -> SUPERSEDED with its package).
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
CREATE TRIGGER accounting_handoffs_immutable BEFORE UPDATE OR DELETE ON accounting_handoffs
    FOR EACH ROW EXECUTE FUNCTION refuse_accounting_handoff_mutation();

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM accounting_handoffs;
    IF v_n > 0 THEN RAISE EXCEPTION 'RECEIVABLE_HANDOFF: refuses to reverse -- % accounting handoff(s) are Finance history', v_n; END IF;
    SELECT count(*) INTO v_n FROM obligations WHERE source_domain = 'BILLING_PACKAGE';
    IF v_n > 0 THEN RAISE EXCEPTION 'RECEIVABLE_HANDOFF: refuses to reverse -- % billing-package receivable(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_commercial.sales_agreements WHERE tax_evidence_status <> 'LEGACY_UNVERIFIED';
    IF v_n > 0 THEN RAISE EXCEPTION 'RECEIVABLE_HANDOFF: refuses to reverse -- % Agreement(s) carry governed tax evidence', v_n; END IF;
END
$$;

DROP TABLE IF EXISTS accounting_handoffs;
DROP FUNCTION IF EXISTS refuse_accounting_handoff_mutation();
DROP INDEX IF EXISTS obligation_one_per_billing_package;
ALTER TABLE billing_packages DROP COLUMN IF EXISTS tax_evidence_status;
ALTER TABLE eos_commercial.sales_agreements
    DROP CONSTRAINT IF EXISTS sales_agreement_tax_evidence_shape,
    DROP CONSTRAINT IF EXISTS sales_agreement_tax_evidence_known,
    DROP COLUMN IF EXISTS tax_evidence_recorded_at,
    DROP COLUMN IF EXISTS tax_evidence_recorded_by,
    DROP COLUMN IF EXISTS tax_evidence_currency,
    DROP COLUMN IF EXISTS tax_evidence_status;
