-- Up Migration
-- THE EOS OPERATIONAL BILLING PACKAGE (Controller NONPROD FINANCE ACTIVATION + SUPPLIER ADMINISTRATION + OPERATIONAL BILLING
-- PACKAGE, 2026-10-02; DECISIONS #196; #145 / #191 §5 billing authority).
--
-- EOS owns the authoritative OPERATIONAL BILLING PACKAGE: the governed hand-off object between EOS operational / commercial
-- truth and a future accounting provider, which alone creates the formal accounting invoice, its document number and its
-- GL treatment. A package is NOT an accounting invoice, NOT a receivable (the obligation trigger is HELD for an Owner ruling)
-- and NOT a posting, and nothing is sent anywhere.
--
-- WHAT IT CONSUMES (never duplicates): the derived Commercial billing eligibility (eos_commercial.sales_order_line_billing_eligibility),
-- the Sales Order lines' accepted prices, the Agreement's governed charges (shipping, install, tax, down payment, trade-in),
-- and the fulfillment records behind each line. Created only for a Sales Order that is ELIGIBLE IN FULL (partial-billing
-- policy is deferred) and only for a direct-sale disposition (SALE / DIRECT_ORDER); a lease / financed disposition is HELD,
-- never misclassified as direct.
--
-- IMMUTABLE ECONOMIC CONTENT. A package and its lines are append-only; the ONLY mutable column is `status`, and only along
-- READY|HELD -> SUPERSEDED (a re-evaluation with different evidence -- e.g. the tax a HELD package lacked -- writes a NEW
-- version referencing the one it supersedes). VOID / SENT / ACKNOWLEDGED / REJECTED belong to later packages and are not
-- representable yet. Missing price or tax evidence is an explicit readiness exception that HOLDS the package -- never a zero.

SET search_path = eos_finance, public;

CREATE TABLE billing_packages (
    id                          TEXT PRIMARY KEY,
    tenant_id                   TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    source_kind                 TEXT NOT NULL CHECK (source_kind IN ('SALES_ORDER')),
    sales_order_id              TEXT NOT NULL,
    version                     INTEGER NOT NULL CHECK (version >= 1),
    supersedes_package_id       TEXT REFERENCES billing_packages(id),
    status                      TEXT NOT NULL CHECK (status IN ('HELD', 'READY', 'SUPERSEDED')),
    readiness_exceptions        TEXT[] NOT NULL DEFAULT '{}',
    operating_company_id        TEXT NOT NULL CHECK (operating_company_id ~ '^[a-z][a-z0-9_-]{1,62}$' AND operating_company_id <> 'consolidated'),
    operating_company_key       TEXT NOT NULL,
    commercial_customer_account_id TEXT NOT NULL,
    -- The FINANCIAL counterparty / obligor, when known. For a supported direct sale it is the customer organization's
    -- EXTERNAL_ORGANIZATION counterparty, BY RULE (obligor_basis); it is never assumed to be the customer for any other
    -- disposition (Saratoga funds a financed sale; the customer is not the obligor there).
    counterparty_id             TEXT,
    obligor_basis               TEXT NOT NULL CHECK (obligor_basis IN ('DIRECT_SALE_CUSTOMER', 'UNRESOLVED')),
    commercial_disposition      TEXT NOT NULL CHECK (commercial_disposition IN ('SALE', 'DIRECT_ORDER', 'LEASE')),
    sales_agreement_id          TEXT,
    currency                    TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- Integer minor units. NULL = not derivable (its exception says why) -- never coerced to zero.
    subtotal_minor              BIGINT,
    shipping_minor              BIGINT CHECK (shipping_minor IS NULL OR shipping_minor >= 0),
    install_charge_minor        BIGINT CHECK (install_charge_minor IS NULL OR install_charge_minor >= 0),
    tax_minor                   BIGINT CHECK (tax_minor IS NULL OR tax_minor >= 0),
    total_minor                 BIGINT,
    down_payment_minor          BIGINT CHECK (down_payment_minor IS NULL OR down_payment_minor >= 0),
    trade_in_minor              BIGINT CHECK (trade_in_minor IS NULL OR trade_in_minor >= 0),
    balance_minor               BIGINT,
    -- The company's provider-neutral accounting destination when configured (a reference only; nothing is sent).
    accounting_destination_id   TEXT,
    content_fingerprint         TEXT NOT NULL,
    prepared_by                 TEXT NOT NULL CHECK (btrim(prepared_by) <> ''),
    prepared_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_changed_at           TIMESTAMPTZ,
    CONSTRAINT billing_package_version_unique UNIQUE (tenant_id, source_kind, sales_order_id, version),
    CONSTRAINT billing_package_ready_is_complete CHECK (
        status <> 'READY' OR (cardinality(readiness_exceptions) = 0 AND subtotal_minor IS NOT NULL AND tax_minor IS NOT NULL
                              AND total_minor IS NOT NULL AND counterparty_id IS NOT NULL)),
    CONSTRAINT billing_package_held_says_why CHECK (status <> 'HELD' OR cardinality(readiness_exceptions) > 0),
    CONSTRAINT billing_package_totals_reconcile CHECK (
        total_minor IS NULL OR total_minor = subtotal_minor + COALESCE(shipping_minor, 0) + COALESCE(install_charge_minor, 0) + tax_minor),
    CONSTRAINT billing_package_counterparty_fk FOREIGN KEY (tenant_id, counterparty_id)
        REFERENCES financial_counterparties (tenant_id, id),
    CONSTRAINT billing_package_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id)
);
-- At most ONE current (non-superseded) package per source.
CREATE UNIQUE INDEX billing_package_one_current ON billing_packages (tenant_id, source_kind, sales_order_id)
    WHERE status IN ('HELD', 'READY');
CREATE INDEX billing_packages_by_company ON billing_packages (tenant_id, operating_company_id, status);

CREATE TABLE billing_package_lines (
    package_id              TEXT NOT NULL REFERENCES billing_packages(id),
    tenant_id               TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    line_number             INTEGER NOT NULL CHECK (line_number > 0),
    sales_order_id          TEXT NOT NULL,
    sales_order_line_number INTEGER NOT NULL,
    kind                    TEXT NOT NULL,
    ref                     TEXT NOT NULL,
    business_unit           TEXT NOT NULL,
    ordered_qty             INTEGER NOT NULL CHECK (ordered_qty > 0),
    fulfilled_qty           INTEGER NOT NULL CHECK (fulfilled_qty >= 0),
    billable_qty            INTEGER NOT NULL CHECK (billable_qty > 0),
    eligibility             TEXT NOT NULL CHECK (eligibility = 'ELIGIBLE'),
    unit_price_minor        BIGINT CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
    extended_minor          BIGINT,
    price_source            TEXT NOT NULL CHECK (price_source = 'SALES_ORDER_LINE'),
    -- LINEAGE: the fulfillment records (-> Work Order, Equipment / serial, Part usage) behind this line.
    fulfillment_ids         TEXT[] NOT NULL,
    source_work_order_ids   TEXT[] NOT NULL DEFAULT '{}',
    equipment_ids           TEXT[] NOT NULL DEFAULT '{}',
    serial_numbers          TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (package_id, line_number),
    CONSTRAINT billing_package_line_extended_exact CHECK (
        (unit_price_minor IS NULL) = (extended_minor IS NULL) AND (extended_minor IS NULL OR extended_minor = unit_price_minor * billable_qty)),
    CONSTRAINT billing_package_line_source_fk FOREIGN KEY (tenant_id, sales_order_id, sales_order_line_number)
        REFERENCES eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number)
);

-- Append-only lines; packages refuse DELETE and every UPDATE except the status move to SUPERSEDED.
CREATE OR REPLACE FUNCTION refuse_billing_package_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_finance, public AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IN ('HELD', 'READY') AND NEW.status = 'SUPERSEDED'
           AND (to_jsonb(NEW) - 'status' - 'status_changed_at') = (to_jsonb(OLD) - 'status' - 'status_changed_at') THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'BILLING_PACKAGE_IMMUTABLE: a billing package''s content is immutable; a correction is a new version';
END;
$$;

CREATE OR REPLACE FUNCTION refuse_billing_package_line_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_finance, public AS $$
BEGIN
    RAISE EXCEPTION 'BILLING_PACKAGE_IMMUTABLE: billing package lines are append-only';
END;
$$;

CREATE TRIGGER billing_packages_immutable BEFORE UPDATE OR DELETE ON billing_packages
    FOR EACH ROW EXECUTE FUNCTION refuse_billing_package_mutation();
CREATE TRIGGER billing_package_lines_immutable BEFORE UPDATE OR DELETE ON billing_package_lines
    FOR EACH ROW EXECUTE FUNCTION refuse_billing_package_line_mutation();

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM billing_packages;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'BILLING_PACKAGES: refuses to reverse -- % billing package(s) are Finance history', v_n;
    END IF;
END
$$;

DROP TABLE IF EXISTS billing_package_lines;
DROP TABLE IF EXISTS billing_packages;
DROP FUNCTION IF EXISTS refuse_billing_package_line_mutation();
DROP FUNCTION IF EXISTS refuse_billing_package_mutation();
