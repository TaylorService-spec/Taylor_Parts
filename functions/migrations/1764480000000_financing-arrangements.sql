-- Up Migration
-- FINANCING-PROVIDER FINANCED SALES (Owner ruling #200, 2026-10-02; completes the #199 correction; supersedes the held
-- financial-obligor portions of #190). Provider-neutral: the provider is an organization governed with the existing
-- FINANCING_PROVIDER relationship (today Saratoga) -- never a schema concept.
--
--   * The Taylor customer stays the COMMERCIAL CUSTOMER; the sale stays ONE Taylor commercial sale.
--   * For the financed portion Taylor invoices the PROVIDER, the provider pays Taylor up front, and the customer pays the
--     provider under the provider's own lease (outside EOS). Taylor's claim for the financed portion is a FUNDING_RECEIVABLE
--     against the provider -- never customer A/R.
--   * A customer contribution (deposit / down payment) MAY exist (0 allowed) and is modelled separately:
--         total commercial amount = customer contribution + financed amount   -- never overlapping.
--   * The operational event that entitles Taylor to the provider's payment is NOT yet established (#200 §11). The
--     arrangement carries an explicit governed status; no receivable exists until it reaches FUNDING_ENTITLED, which is
--     recorded with its stated basis. Before funding a decline / cancellation holds everything; after funding nothing
--     reverts to customer A/R, and the provider's collection / repossession is outside EOS.

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
    -- What made Taylor entitled to the provider's payment (the milestone itself is not yet ruled; it is stated, not inferred).
    funding_entitlement_basis       TEXT CHECK (funding_entitlement_basis IS NULL OR btrim(funding_entitlement_basis) <> ''),
    idempotency_key                 TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    created_by                      TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                      TEXT NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT financing_arrangement_one_per_agreement UNIQUE (tenant_id, sales_agreement_id),
    CONSTRAINT financing_arrangement_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT financing_arrangement_customer_fk FOREIGN KEY (tenant_id, commercial_customer_account_id) REFERENCES eos_crm.accounts (tenant_id, id),
    CONSTRAINT financing_arrangement_provider_fk FOREIGN KEY (tenant_id, financing_provider_account_id) REFERENCES eos_crm.accounts (tenant_id, id),
    -- The provider never replaces the customer.
    CONSTRAINT financing_arrangement_provider_is_not_customer CHECK (financing_provider_account_id <> commercial_customer_account_id),
    CONSTRAINT financing_arrangement_entitlement_shape CHECK (
        (status IN ('FUNDING_ENTITLED', 'FUNDED')) = (funding_entitlement_basis IS NOT NULL))
);

CREATE TABLE eos_commercial.financing_arrangement_events (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    arrangement_id      TEXT NOT NULL REFERENCES eos_commercial.financing_arrangements(id),
    from_status         TEXT,
    to_status           TEXT NOT NULL,
    reason              TEXT NOT NULL CHECK (btrim(reason) <> ''),
    provider_reference  TEXT,
    recorded_by         TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key     TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT financing_arrangement_event_idempotency UNIQUE (tenant_id, idempotency_key)
);

-- The provider must be governed as a FINANCING_PROVIDER; identity and contribution never change; status moves only along
--   APPLIED -> APPROVED | DECLINED | CANCELLED;  APPROVED -> FUNDING_ENTITLED | DECLINED | CANCELLED;  FUNDING_ENTITLED -> FUNDED;
-- FUNDED / DECLINED / CANCELLED are terminal (a later provider-side lease failure is the provider's, not a Taylor state).
-- A provider reference may be recorded once (NULL -> value), never rewritten.
CREATE OR REPLACE FUNCTION eos_commercial.guard_financing_arrangement() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_commercial, public AS $$
DECLARE
    v_fixed CONSTANT TEXT[] := ARRAY['status', 'funding_entitlement_basis', 'provider_reference', 'updated_by', 'updated_at'];
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM eos_crm.account_relationship_types r WHERE r.tenant_id = NEW.tenant_id
                         AND r.account_id = NEW.financing_provider_account_id AND r.relationship_type = 'FINANCING_PROVIDER') THEN
            RAISE EXCEPTION 'FINANCING_PROVIDER_NOT_GOVERNED: the organization is not governed as a financing provider';
        END IF;
        IF NEW.status <> 'APPLIED' THEN RAISE EXCEPTION 'FINANCING_ARRANGEMENT_TRANSITION_REFUSED: an arrangement starts APPLIED'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - v_fixed) <> (to_jsonb(OLD) - v_fixed) THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_IMMUTABLE: an arrangement''s customer, provider, kind, currency and contribution never change';
    END IF;
    IF OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_IMMUTABLE: a provider reference is recorded once';
    END IF;
    IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN (
        ('APPLIED', 'APPROVED'), ('APPLIED', 'DECLINED'), ('APPLIED', 'CANCELLED'),
        ('APPROVED', 'FUNDING_ENTITLED'), ('APPROVED', 'DECLINED'), ('APPROVED', 'CANCELLED'),
        ('FUNDING_ENTITLED', 'FUNDED')) THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_TRANSITION_REFUSED: % -> % is not a financing transition', OLD.status, NEW.status;
    END IF;
    IF NEW.status = OLD.status AND NEW.funding_entitlement_basis IS DISTINCT FROM OLD.funding_entitlement_basis THEN
        RAISE EXCEPTION 'FINANCING_ARRANGEMENT_IMMUTABLE: the entitlement basis is recorded with the transition';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER financing_arrangements_guard BEFORE INSERT OR UPDATE OR DELETE ON eos_commercial.financing_arrangements
    FOR EACH ROW EXECUTE FUNCTION eos_commercial.guard_financing_arrangement();

CREATE OR REPLACE FUNCTION eos_commercial.refuse_financing_event_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'FINANCING_ARRANGEMENT_EVENT_IMMUTABLE: arrangement history is append-only';
END;
$$;
CREATE TRIGGER financing_arrangement_events_immutable BEFORE UPDATE OR DELETE ON eos_commercial.financing_arrangement_events
    FOR EACH ROW EXECUTE FUNCTION eos_commercial.refuse_financing_event_mutation();

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
            WHEN EXISTS (SELECT 1 FROM eos_commercial.financing_arrangements fa WHERE fa.tenant_id = so.tenant_id AND fa.sales_agreement_id = so.sales_agreement_id) THEN 'FINANCED_SALE'
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
DROP TABLE IF EXISTS eos_commercial.financing_arrangement_events;
DROP TABLE IF EXISTS eos_commercial.financing_arrangements;
DROP FUNCTION IF EXISTS eos_commercial.refuse_financing_event_mutation();
DROP FUNCTION IF EXISTS eos_commercial.guard_financing_arrangement();
