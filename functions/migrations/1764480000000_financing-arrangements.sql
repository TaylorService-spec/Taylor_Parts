-- Up Migration
-- FINANCING-PROVIDER FINANCED SALES (Owner rulings #200 + #201, 2026-10-02; completes the #199 correction; supersedes the
-- held financial-obligor portions of #190). Provider-neutral: the provider is an organization governed with the existing
-- FINANCING_PROVIDER relationship (today Saratoga) -- never a schema concept.
--
--   * The Taylor customer stays the COMMERCIAL CUSTOMER; the sale stays ONE Taylor commercial sale.
--   * For the financed portion Taylor invoices the PROVIDER, the provider pays Taylor up front, and the customer pays the
--     provider under the provider's own lease (outside EOS). Taylor's claim for the financed portion is a FUNDING_RECEIVABLE
--     against the provider -- never customer A/R.
--   * A customer contribution (deposit / down payment) MAY exist (0 allowed) and is modelled separately:
--         total commercial amount = customer contribution + financed amount   -- never overlapping.
--     Its customer receivable follows the sale's ordinary billing eligibility -- it never waits for provider funding (#201 §4).
--   * FUNDING ENTITLEMENT (#201): Taylor is entitled to the provider's payment when it holds the provider's SIGNED and
--     APPROVED documentation. APPROVED -> FUNDING_ENTITLED requires a recorded approval-evidence record that is both signed
--     and approved; nothing else (application, verbal approval, delivery, installation, acceptance, package readiness)
--     entitles. FUNDED (the provider's money actually received) stays a distinct, later state.
--   * Before entitlement a declined / cancelled arrangement does not destroy the sale: an explicit, recorded RESTRUCTURE may
--     move it to another provider or convert it to a direct sale -- never silently, never after entitlement.
--   * No document-management system exists in EOS to reuse (the only file custody is Inbound Work's own attachments), so the
--     evidence is the smallest durable reference: the provider's document reference (+ optional content hash), never a file
--     or a credential.

-- ════════════════════ 1. the financing arrangement (Commercial) ════════════════════

CREATE TABLE eos_commercial.financing_arrangements (
    id                              TEXT PRIMARY KEY,
    tenant_id                       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    sales_agreement_id              TEXT NOT NULL REFERENCES eos_commercial.sales_agreements(id),
    -- The commercial customer, unchanged (the Agreement's own account, recorded for lineage).
    commercial_customer_account_id  TEXT NOT NULL,
    -- The financing / leasing provider: an organization governed as a FINANCING_PROVIDER.
    financing_provider_account_id   TEXT NOT NULL,
    arrangement_kind                TEXT NOT NULL CHECK (arrangement_kind IN ('LEASE', 'FINANCING')),
    currency                        TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- The governed customer contribution, explicit (0 = none; never assumed).
    customer_contribution_minor     BIGINT NOT NULL CHECK (customer_contribution_minor >= 0),
    provider_reference              TEXT CHECK (provider_reference IS NULL OR (btrim(provider_reference) <> '' AND length(provider_reference) <= 200)),
    status                          TEXT NOT NULL DEFAULT 'APPLIED'
                                    CHECK (status IN ('APPLIED', 'APPROVED', 'FUNDING_ENTITLED', 'FUNDED', 'DECLINED', 'CANCELLED')),
    -- The signed + approved provider documentation that entitled Taylor (#201); set with that transition only.
    entitlement_evidence_id         TEXT,
    -- Set once when a declined / cancelled arrangement is replaced by an explicit restructure (history kept).
    restructure_id                  TEXT,
    idempotency_key                 TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    created_by                      TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                      TEXT NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT financing_arrangement_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT financing_arrangement_customer_fk FOREIGN KEY (tenant_id, commercial_customer_account_id) REFERENCES eos_crm.accounts (tenant_id, id),
    CONSTRAINT financing_arrangement_provider_fk FOREIGN KEY (tenant_id, financing_provider_account_id) REFERENCES eos_crm.accounts (tenant_id, id),
    -- The provider never replaces the customer.
    CONSTRAINT financing_arrangement_provider_is_not_customer CHECK (financing_provider_account_id <> commercial_customer_account_id),
    CONSTRAINT financing_arrangement_entitlement_shape CHECK (
        (status IN ('FUNDING_ENTITLED', 'FUNDED')) = (entitlement_evidence_id IS NOT NULL)),
    CONSTRAINT financing_arrangement_restructure_shape CHECK (restructure_id IS NULL OR status IN ('DECLINED', 'CANCELLED'))
);
-- ONE CURRENT arrangement per Agreement; a restructured one stays as history.
CREATE UNIQUE INDEX financing_arrangement_one_current_per_agreement ON eos_commercial.financing_arrangements (tenant_id, sales_agreement_id)
    WHERE restructure_id IS NULL;

CREATE TABLE eos_commercial.financing_arrangement_events (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    arrangement_id      TEXT NOT NULL REFERENCES eos_commercial.financing_arrangements(id),
    from_status         TEXT,
    to_status           TEXT NOT NULL,
    reason              TEXT NOT NULL CHECK (btrim(reason) <> ''),
    provider_reference  TEXT,
    evidence_id         TEXT,
    recorded_by         TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key     TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT financing_arrangement_event_idempotency UNIQUE (tenant_id, idempotency_key)
);

-- FINANCING PROVIDER APPROVAL DOCUMENTATION (#201): append-only evidence that the provider's documents are signed and/or
-- approved. Only a record that is BOTH entitles. The reference is the provider's / Taylor's own document identifier.
CREATE TABLE eos_commercial.financing_approval_evidence (
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    arrangement_id           TEXT NOT NULL REFERENCES eos_commercial.financing_arrangements(id),
    financing_provider_account_id TEXT NOT NULL,
    provider_reference       TEXT,
    document_reference       TEXT NOT NULL CHECK (btrim(document_reference) <> '' AND length(document_reference) <= 300),
    document_sha256          TEXT CHECK (document_sha256 IS NULL OR document_sha256 ~ '^[0-9a-f]{64}$'),
    signed                   BOOLEAN NOT NULL,
    approved                 BOOLEAN NOT NULL,
    recorded_by              TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    correlation_id           TEXT,
    idempotency_key          TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT financing_approval_evidence_idempotency UNIQUE (tenant_id, idempotency_key)
);
ALTER TABLE eos_commercial.financing_arrangements
    ADD CONSTRAINT financing_arrangement_evidence_fk FOREIGN KEY (entitlement_evidence_id) REFERENCES eos_commercial.financing_approval_evidence(id);

-- An EXPLICIT commercial restructure of an unfunded, declined / cancelled financed sale (#201 §5): to another provider's
-- arrangement or to a DIRECT_SALE. Append-only; the replaced arrangement keeps its history.
CREATE TABLE eos_commercial.financing_restructures (
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    sales_agreement_id       TEXT NOT NULL REFERENCES eos_commercial.sales_agreements(id),
    from_arrangement_id      TEXT NOT NULL REFERENCES eos_commercial.financing_arrangements(id),
    to_kind                  TEXT NOT NULL CHECK (to_kind IN ('FINANCING_ARRANGEMENT', 'DIRECT_SALE')),
    -- Deferred: the restructure is recorded first, then the replaced arrangement retires, then the new one is created.
    to_arrangement_id        TEXT REFERENCES eos_commercial.financing_arrangements(id) DEFERRABLE INITIALLY DEFERRED,
    reason                   TEXT NOT NULL CHECK (btrim(reason) <> ''),
    recorded_by              TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key          TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT financing_restructure_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT financing_restructure_once UNIQUE (tenant_id, from_arrangement_id),
    CONSTRAINT financing_restructure_target_shape CHECK ((to_kind = 'FINANCING_ARRANGEMENT') = (to_arrangement_id IS NOT NULL))
);
ALTER TABLE eos_commercial.financing_arrangements
    ADD CONSTRAINT financing_arrangement_restructure_fk FOREIGN KEY (restructure_id) REFERENCES eos_commercial.financing_restructures(id);

-- The provider must be governed as a FINANCING_PROVIDER; identity and contribution never change; status moves only along
--   APPLIED -> APPROVED | DECLINED | CANCELLED;  APPROVED -> FUNDING_ENTITLED | DECLINED | CANCELLED;  FUNDING_ENTITLED -> FUNDED;
-- FUNDED / DECLINED / CANCELLED are terminal (a later provider-side lease failure is the provider's, not a Taylor state).
-- FUNDING_ENTITLED requires this arrangement's SIGNED + APPROVED evidence. A provider reference and a restructure are recorded once.
CREATE OR REPLACE FUNCTION eos_commercial.guard_financing_arrangement() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_commercial, public AS $$
DECLARE
    v_mutable CONSTANT TEXT[] := ARRAY['status', 'entitlement_evidence_id', 'restructure_id', 'provider_reference', 'updated_by', 'updated_at'];
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM eos_crm.account_relationship_types r WHERE r.tenant_id = NEW.tenant_id
                         AND r.account_id = NEW.financing_provider_account_id AND r.relationship_type = 'FINANCING_PROVIDER') THEN
            RAISE EXCEPTION 'FINANCING_PROVIDER_NOT_GOVERNED: the organization is not governed as a financing provider';
        END IF;
        IF NEW.status <> 'APPLIED' OR NEW.entitlement_evidence_id IS NOT NULL OR NEW.restructure_id IS NOT NULL THEN
            RAISE EXCEPTION 'FINANCING_ARRANGEMENT_TRANSITION_REFUSED: an arrangement starts APPLIED';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_IMMUTABLE: an arrangement is never deleted';
    END IF;
    IF (to_jsonb(NEW) - v_mutable) <> (to_jsonb(OLD) - v_mutable) THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_IMMUTABLE: an arrangement''s customer, provider, kind, currency and contribution never change';
    END IF;
    IF OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_IMMUTABLE: a provider reference is recorded once';
    END IF;
    IF OLD.restructure_id IS NOT NULL AND NEW.restructure_id IS DISTINCT FROM OLD.restructure_id THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_IMMUTABLE: a restructure is recorded once';
    END IF;
    IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN (
        ('APPLIED', 'APPROVED'), ('APPLIED', 'DECLINED'), ('APPLIED', 'CANCELLED'),
        ('APPROVED', 'FUNDING_ENTITLED'), ('APPROVED', 'DECLINED'), ('APPROVED', 'CANCELLED'),
        ('FUNDING_ENTITLED', 'FUNDED')) THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_TRANSITION_REFUSED: % -> % is not a financing transition', OLD.status, NEW.status;
    END IF;
    IF NEW.entitlement_evidence_id IS DISTINCT FROM OLD.entitlement_evidence_id THEN
        IF NOT (OLD.status = 'APPROVED' AND NEW.status = 'FUNDING_ENTITLED') THEN
            RAISE EXCEPTION 'FINANCING_ARRANGEMENT_IMMUTABLE: the entitlement evidence is recorded with the FUNDING_ENTITLED transition';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM financing_approval_evidence e WHERE e.id = NEW.entitlement_evidence_id
                         AND e.tenant_id = NEW.tenant_id AND e.arrangement_id = NEW.id AND e.signed AND e.approved) THEN
            RAISE EXCEPTION 'FUNDING_EVIDENCE_INSUFFICIENT: FUNDING_ENTITLED requires this arrangement''s signed AND approved provider documentation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER financing_arrangements_guard BEFORE INSERT OR UPDATE OR DELETE ON eos_commercial.financing_arrangements
    FOR EACH ROW EXECUTE FUNCTION eos_commercial.guard_financing_arrangement();

CREATE OR REPLACE FUNCTION eos_commercial.refuse_financing_history_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'FINANCING_HISTORY_IMMUTABLE: % is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER financing_arrangement_events_immutable BEFORE UPDATE OR DELETE ON eos_commercial.financing_arrangement_events
    FOR EACH ROW EXECUTE FUNCTION eos_commercial.refuse_financing_history_mutation();
CREATE TRIGGER financing_approval_evidence_immutable BEFORE UPDATE OR DELETE ON eos_commercial.financing_approval_evidence
    FOR EACH ROW EXECUTE FUNCTION eos_commercial.refuse_financing_history_mutation();
CREATE TRIGGER financing_restructures_immutable BEFORE UPDATE OR DELETE ON eos_commercial.financing_restructures
    FOR EACH ROW EXECUTE FUNCTION eos_commercial.refuse_financing_history_mutation();

-- The derived Commercial eligibility names a financed sale for what it is (columns unchanged).
SET search_path = eos_commercial, public;
CREATE OR REPLACE VIEW eos_commercial.sales_order_line_billing_eligibility AS
SELECT lf.tenant_id, lf.sales_order_id, so.sales_order_number, lf.line_number, lf.kind, lf.ref, lf.business_unit,
       lf.ordered_qty, lf.fulfilled_qty, lf.remaining_qty, lf.last_fulfilled_at, lf.source_work_order_ids,
       lf.unit_price_minor, 'SALES_ORDER_LINE'::text AS price_source, so.currency,
       CASE WHEN so.state = 'CANCELLED' THEN 'CANCELLED'
            WHEN lf.fulfilled_qty = 0 THEN 'NOT_YET'
            WHEN lf.fulfilled_qty >= lf.ordered_qty THEN 'ELIGIBLE'
            ELSE 'PARTIALLY_ELIGIBLE' END AS eligibility,
       CASE WHEN so.state = 'CANCELLED' THEN 'Sales Order is cancelled'
            WHEN lf.fulfilled_qty = 0 THEN 'Nothing fulfilled yet'
            WHEN lf.fulfilled_qty >= lf.ordered_qty THEN 'Fully fulfilled'
            ELSE 'Partially fulfilled (' || lf.fulfilled_qty || '/' || lf.ordered_qty || '); Finance decides what/when to bill' END AS reason,
       so.state::text AS sales_order_state, so.operating_company_key, so.account_id AS commercial_customer_account_id,
       so.location_id, so.opportunity_id, so.sales_agreement_id, so.sales_channel::text AS sales_channel,
       -- Owner / accountable / credited salesperson are NOT copied here: ownership lives only on the three Commercial records
       -- (#187), and Analysis reaches them by traversing sales_order_id -> sales_orders (never a denormalized second copy).
       -- The commercial DISPOSITION the Agreement carries (a lease is not a direct sale). A financed / Saratoga sale is not yet
       -- represented in PostgreSQL Commercial (DECISIONS #195 dependency) -- never assumed to be a direct sale's customer.
       CASE WHEN so.sales_agreement_id IS NULL THEN 'DIRECT_ORDER'
            WHEN EXISTS (SELECT 1 FROM eos_commercial.financing_arrangements fa WHERE fa.tenant_id = so.tenant_id AND fa.sales_agreement_id = so.sales_agreement_id
                           AND fa.restructure_id IS NULL) THEN 'FINANCED_SALE'
            WHEN EXISTS (SELECT 1 FROM eos_commercial.financing_restructures r WHERE r.tenant_id = so.tenant_id AND r.sales_agreement_id = so.sales_agreement_id
                           AND r.to_kind = 'DIRECT_SALE') THEN 'SALE'
            WHEN a.is_lease THEN 'LEASE' ELSE 'SALE' END AS commercial_disposition,
       'DEFERRED_TO_BILLING_PACKAGE'::text AS financial_obligor_resolution
  FROM sales_order_line_fulfillment lf
  JOIN sales_orders so ON so.tenant_id = lf.tenant_id AND so.id = lf.sales_order_id
  LEFT JOIN sales_agreements a ON a.tenant_id = so.tenant_id AND a.id = so.sales_agreement_id;

-- ════════════════════ 2. the Billing Package's payment composition ════════════════════

SET search_path = eos_finance, public;

ALTER TABLE billing_packages
    DROP CONSTRAINT IF EXISTS billing_packages_commercial_disposition_check,
    DROP CONSTRAINT IF EXISTS billing_packages_obligor_basis_check;
ALTER TABLE billing_packages
    -- A reference, like sales_order_id (no cross-schema FK: an arrangement is never deleted -- its trigger refuses it).
    ADD COLUMN financing_arrangement_id            TEXT,
    ADD COLUMN financing_provider_counterparty_id  TEXT,
    ADD COLUMN customer_contribution_minor         BIGINT CHECK (customer_contribution_minor IS NULL OR customer_contribution_minor >= 0),
    ADD COLUMN financed_amount_minor               BIGINT,
    ADD CONSTRAINT billing_package_disposition_known CHECK (commercial_disposition IN ('SALE', 'DIRECT_ORDER', 'LEASE', 'FINANCED_SALE')),
    ADD CONSTRAINT billing_package_obligor_basis_known CHECK (obligor_basis IN ('DIRECT_SALE_CUSTOMER', 'FINANCING_PROVIDER_FUNDED', 'UNRESOLVED')),
    ADD CONSTRAINT billing_package_provider_counterparty_fk FOREIGN KEY (tenant_id, financing_provider_counterparty_id)
        REFERENCES financial_counterparties (tenant_id, id),
    -- A financed sale is ONE package carrying its composition; nothing else carries any of it.
    ADD CONSTRAINT billing_package_financing_shape CHECK (
        (commercial_disposition = 'FINANCED_SALE') = (financing_arrangement_id IS NOT NULL)
        AND (commercial_disposition = 'FINANCED_SALE' OR (financing_provider_counterparty_id IS NULL
             AND customer_contribution_minor IS NULL AND financed_amount_minor IS NULL))),
    -- total commercial amount = customer contribution + financed amount (never overlapping).
    ADD CONSTRAINT billing_package_financing_composition CHECK (
        commercial_disposition <> 'FINANCED_SALE' OR total_minor IS NULL
        OR (customer_contribution_minor IS NOT NULL AND financed_amount_minor IS NOT NULL
            AND total_minor = customer_contribution_minor + financed_amount_minor)),
    ADD CONSTRAINT billing_package_financed_ready CHECK (
        commercial_disposition <> 'FINANCED_SALE' OR status <> 'READY'
        OR (obligor_basis = 'FINANCING_PROVIDER_FUNDED' AND financing_provider_counterparty_id IS NOT NULL AND financed_amount_minor > 0));

-- ════════════════════ 3. at most one receivable of each kind per package ════════════════════
-- A financed package may carry a FUNDING_RECEIVABLE (provider) and a separate customer RECEIVABLE (contribution).

DROP INDEX IF EXISTS obligation_one_per_billing_package;
CREATE UNIQUE INDEX obligation_one_per_billing_package_kind ON obligations (tenant_id, source_record_id, kind)
    WHERE source_domain = 'BILLING_PACKAGE';

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_commercial.financing_arrangements;
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCING: refuses to reverse -- % financing arrangement(s) exist', v_n; END IF;
END
$$;

DROP INDEX IF EXISTS obligation_one_per_billing_package_kind;
CREATE UNIQUE INDEX obligation_one_per_billing_package ON obligations (tenant_id, source_record_id) WHERE source_domain = 'BILLING_PACKAGE';
ALTER TABLE billing_packages
    DROP CONSTRAINT IF EXISTS billing_package_financed_ready,
    DROP CONSTRAINT IF EXISTS billing_package_financing_composition,
    DROP CONSTRAINT IF EXISTS billing_package_financing_shape,
    DROP CONSTRAINT IF EXISTS billing_package_provider_counterparty_fk,
    DROP CONSTRAINT IF EXISTS billing_package_obligor_basis_known,
    DROP CONSTRAINT IF EXISTS billing_package_disposition_known,
    DROP COLUMN IF EXISTS financed_amount_minor,
    DROP COLUMN IF EXISTS customer_contribution_minor,
    DROP COLUMN IF EXISTS financing_provider_counterparty_id,
    DROP COLUMN IF EXISTS financing_arrangement_id;
ALTER TABLE billing_packages
    ADD CONSTRAINT billing_packages_commercial_disposition_check CHECK (commercial_disposition IN ('SALE', 'DIRECT_ORDER', 'LEASE')),
    ADD CONSTRAINT billing_packages_obligor_basis_check CHECK (obligor_basis IN ('DIRECT_SALE_CUSTOMER', 'UNRESOLVED'));
SET search_path = eos_commercial, public;
CREATE OR REPLACE VIEW eos_commercial.sales_order_line_billing_eligibility AS
SELECT lf.tenant_id, lf.sales_order_id, so.sales_order_number, lf.line_number, lf.kind, lf.ref, lf.business_unit,
       lf.ordered_qty, lf.fulfilled_qty, lf.remaining_qty, lf.last_fulfilled_at, lf.source_work_order_ids,
       lf.unit_price_minor, 'SALES_ORDER_LINE'::text AS price_source, so.currency,
       CASE WHEN so.state = 'CANCELLED' THEN 'CANCELLED'
            WHEN lf.fulfilled_qty = 0 THEN 'NOT_YET'
            WHEN lf.fulfilled_qty >= lf.ordered_qty THEN 'ELIGIBLE'
            ELSE 'PARTIALLY_ELIGIBLE' END AS eligibility,
       CASE WHEN so.state = 'CANCELLED' THEN 'Sales Order is cancelled'
            WHEN lf.fulfilled_qty = 0 THEN 'Nothing fulfilled yet'
            WHEN lf.fulfilled_qty >= lf.ordered_qty THEN 'Fully fulfilled'
            ELSE 'Partially fulfilled (' || lf.fulfilled_qty || '/' || lf.ordered_qty || '); Finance decides what/when to bill' END AS reason,
       so.state::text AS sales_order_state, so.operating_company_key, so.account_id AS commercial_customer_account_id,
       so.location_id, so.opportunity_id, so.sales_agreement_id, so.sales_channel::text AS sales_channel,
       -- Owner / accountable / credited salesperson are NOT copied here: ownership lives only on the three Commercial records
       -- (#187), and Analysis reaches them by traversing sales_order_id -> sales_orders (never a denormalized second copy).
       -- The commercial DISPOSITION the Agreement carries (a lease is not a direct sale). A financed / Saratoga sale is not yet
       -- represented in PostgreSQL Commercial (DECISIONS #195 dependency) -- never assumed to be a direct sale's customer.
       CASE WHEN so.sales_agreement_id IS NULL THEN 'DIRECT_ORDER' WHEN a.is_lease THEN 'LEASE' ELSE 'SALE' END AS commercial_disposition,
       'DEFERRED_TO_BILLING_PACKAGE'::text AS financial_obligor_resolution
  FROM sales_order_line_fulfillment lf
  JOIN sales_orders so ON so.tenant_id = lf.tenant_id AND so.id = lf.sales_order_id
  LEFT JOIN sales_agreements a ON a.tenant_id = so.tenant_id AND a.id = so.sales_agreement_id;
SET search_path = eos_finance, public;
ALTER TABLE eos_commercial.financing_arrangements DROP CONSTRAINT IF EXISTS financing_arrangement_restructure_fk,
    DROP CONSTRAINT IF EXISTS financing_arrangement_evidence_fk;
DROP TABLE IF EXISTS eos_commercial.financing_restructures;
DROP TABLE IF EXISTS eos_commercial.financing_approval_evidence;
DROP TABLE IF EXISTS eos_commercial.financing_arrangement_events;
DROP TABLE IF EXISTS eos_commercial.financing_arrangements;
DROP FUNCTION IF EXISTS eos_commercial.refuse_financing_history_mutation();
DROP FUNCTION IF EXISTS eos_commercial.guard_financing_arrangement();
