-- Up Migration
-- POST-FBR GOVERNED CONFIGURATION + COMMERCIAL PRICING (Controller, 2026-10-02; DECISIONS #203).
--
--   1. OPERATING-COMPANY BUSINESS TIME (G2). A technical timestamp stays a UTC instant; a BUSINESS DATE is the calendar day
--      in the operating company's governed time zone. Each company carries `business_time_zone` (IANA; default 'UTC', i.e.
--      unchanged until an administrator configures it -- Taylor / Ventana: America/Phoenix by configuration, never code), and
--      ONE resolver, eos_policy.operating_company_business_date(tenant, company, instant), derives the business day.
--   2. CONFIGURATION AND SALES AUTHORITY (Owner rulings #204). Four capabilities. THIS IS A GRANT-BEARING MIGRATION (Owner
--      ruling E: the grants and roleCapabilityAuthorityBaseline.json land as one change): it grants exactly the Owner-ruled
--      Security Roles -- the same vehicle Owner ruling R1 used (1763078400000), and the only one that can reach the designated
--      Administrator Role, which Administration may never edit for itself (SELF_ADMINISTRATION). Every later assignment or
--      revocation is an ordinary Administration act:
--        finance.configuration.manage      accounting destinations + counterparty payment terms (Finance configuration);
--        admin.systemConfiguration.manage  company settings: business time zone, default language (System Configuration);
--        sales.discountAuthority.manage    each Sales user's MAXIMUM CUSTOMER DISCOUNT (Employee Sales Authority);
--        salesAgreement.tradeIn.approve    BUSINESS APPROVAL of a proposed trade-in value -- never administrative authority.
--      System Configuration is a registry: eos_policy.configuration_setting_definitions names each setting (scope, kind);
--      a company-scoped value lives in eos_policy.operating_company_settings unless the definition says where it is kept.
--   3. CUSTOMER SALES DISCOUNT on the Sales Agreement (the pricing authority a Sales Order inherits): PERCENT (basis points)
--      or FIXED_AMOUNT (minor units). SELLING PRICE - CUSTOMER DISCOUNT = NET SELLING PRICE. Never a price-book, cost or
--      margin change; the line prices stay as entered.
--   4. TRADE-IN as CASH-EQUIVALENT CONSIDERATION and as INCOMING EQUIPMENT: itemised trade-ins (identity when known, the
--      agreed credit, the receiving company, a boundary for the later acquisition). The agreed credit is NEVER a resale
--      price and never an acquisition value; nothing propagates it.
--   5. THE BILLING PACKAGE COMPOSITION: total = selling - discount + shipping + install + tax; a financed sale's
--      total = cash contribution + trade-in credit + financed amount (Owner ruling: a financed trade-in is now governed).

-- ════════════════════ 1. operating-company business time ════════════════════

SET search_path = eos_policy, public;

ALTER TABLE tenant_operating_companies ADD COLUMN business_time_zone TEXT NOT NULL DEFAULT 'UTC';

CREATE OR REPLACE FUNCTION assert_business_time_zone_known() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_policy, public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.business_time_zone) THEN
        RAISE EXCEPTION 'BUSINESS_TIME_ZONE_UNKNOWN: % is not an IANA time zone', NEW.business_time_zone;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tenant_operating_company_time_zone_known BEFORE INSERT OR UPDATE OF business_time_zone ON tenant_operating_companies
    FOR EACH ROW EXECUTE FUNCTION assert_business_time_zone_known();

-- THE ONE business-date resolver: the instant's calendar day in the company's governed zone.
CREATE OR REPLACE FUNCTION operating_company_business_date(p_tenant TEXT, p_company TEXT, p_instant TIMESTAMPTZ) RETURNS DATE
    LANGUAGE plpgsql STABLE SET search_path = eos_policy, public AS $$
DECLARE
    v_zone TEXT;
BEGIN
    SELECT business_time_zone INTO v_zone FROM tenant_operating_companies WHERE tenant_id = p_tenant AND operating_company_id = p_company;
    IF v_zone IS NULL THEN
        RAISE EXCEPTION 'OPERATING_COMPANY_UNRESOLVED: % is not an operating company of this tenant', p_company;
    END IF;
    RETURN (p_instant AT TIME ZONE v_zone)::date;
END;
$$;

-- ════════════════════ 1b. System Configuration: the settings registry ════════════════════

-- The governed language catalog. A company's default language must name an ACTIVE row.
CREATE TABLE supported_languages (
    language_tag  TEXT PRIMARY KEY CHECK (language_tag ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    display_name  TEXT NOT NULL CHECK (btrim(display_name) <> ''),
    status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED'))
);
INSERT INTO supported_languages (language_tag, display_name) VALUES ('en-US', 'English (United States)'), ('es-US', 'Spanish (United States)');

-- One row per governed setting. A new company / system setting is a row here plus its validator -- never a new architecture.
CREATE TABLE configuration_setting_definitions (
    setting_key   TEXT PRIMARY KEY CHECK (setting_key ~ '^[a-z][a-zA-Z]+$'),
    scope_kind    TEXT NOT NULL CHECK (scope_kind IN ('OPERATING_COMPANY')),
    value_kind    TEXT NOT NULL CHECK (value_kind IN ('IANA_TIME_ZONE', 'LANGUAGE_TAG')),
    storage       TEXT NOT NULL CHECK (storage IN ('OPERATING_COMPANY_COLUMN', 'SETTINGS_TABLE')),
    default_value TEXT NOT NULL,
    display_label TEXT NOT NULL CHECK (btrim(display_label) <> '')
);
INSERT INTO configuration_setting_definitions (setting_key, scope_kind, value_kind, storage, default_value, display_label) VALUES
    ('businessTimeZone', 'OPERATING_COMPANY', 'IANA_TIME_ZONE', 'OPERATING_COMPANY_COLUMN', 'UTC', 'Business time zone'),
    ('defaultLanguage', 'OPERATING_COMPANY', 'LANGUAGE_TAG', 'SETTINGS_TABLE', 'en-US', 'Default language');

CREATE TABLE operating_company_settings (
    tenant_id             TEXT NOT NULL,
    operating_company_id  TEXT NOT NULL,
    setting_key           TEXT NOT NULL REFERENCES configuration_setting_definitions (setting_key),
    value                 TEXT NOT NULL CHECK (btrim(value) <> ''),
    updated_by            TEXT NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, operating_company_id, setting_key),
    FOREIGN KEY (tenant_id, operating_company_id) REFERENCES tenant_operating_companies (tenant_id, operating_company_id)
);
-- The database refuses a value its definition does not admit (the server validates first; this is the floor).
CREATE OR REPLACE FUNCTION assert_operating_company_setting_valid() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_policy, public AS $$
DECLARE
    v_def configuration_setting_definitions%ROWTYPE;
BEGIN
    SELECT * INTO v_def FROM configuration_setting_definitions WHERE setting_key = NEW.setting_key;
    IF v_def.storage <> 'SETTINGS_TABLE' THEN
        RAISE EXCEPTION 'CONFIGURATION_SETTING_INVALID: % is not kept in the settings table', NEW.setting_key;
    END IF;
    IF v_def.value_kind = 'LANGUAGE_TAG' AND NOT EXISTS (SELECT 1 FROM supported_languages WHERE language_tag = NEW.value AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'LANGUAGE_UNSUPPORTED: % is not a supported language', NEW.value;
    END IF;
    IF v_def.value_kind = 'IANA_TIME_ZONE' AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.value) THEN
        RAISE EXCEPTION 'BUSINESS_TIME_ZONE_UNKNOWN: % is not an IANA time zone', NEW.value;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER operating_company_setting_valid BEFORE INSERT OR UPDATE ON operating_company_settings
    FOR EACH ROW EXECUTE FUNCTION assert_operating_company_setting_valid();

-- ════════════════════ 2. configuration and sales authority ════════════════════

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_finance_configuration_manage', 'finance.configuration.manage',
     'ADMINISTRATIVE CONFIGURATION: view, configure, activate and deactivate each operating company''s provider-neutral accounting destination; set company / counterparty payment terms (net days) that govern FUTURE obligations. Every change is audited with its reason. Confers no financial transaction, settlement, delivery, credential or business-approval access.',
     'financeConfiguration', 'manage', 'ADMIN_ACTION', 'Manage Finance Configuration'),
    ('cap_admin_system_configuration_manage', 'admin.systemConfiguration.manage',
     'SYSTEM ADMINISTRATION: view and change governed company / system settings (business time zone, default language). Every change is validated, audited with its reason and company-scoped. Confers no business approval.',
     'systemConfiguration', 'manage', 'ADMIN_ACTION', 'Manage System Configuration'),
    ('cap_sales_discount_authority_manage', 'sales.discountAuthority.manage',
     'SALES AUTHORITY ADMINISTRATION: view and set each Sales user''s maximum CUSTOMER discount percentage. Audited with the affected user, previous and new limit, actor and reason. Governs only the customer-facing transaction discount; never internal pricing, cost, trade-in value or resale price.',
     'salesDiscountAuthority', 'manage', 'ADMIN_ACTION', 'Manage Sales Discount Authority'),
    ('cap_sales_agreement_trade_in_approve', 'salesAgreement.tradeIn.approve',
     'BUSINESS APPROVAL: approve (assigning the value) or decline a proposed trade-in on a DRAFT Sales Agreement. Only an APPROVED value is trade-in consideration that buys down the balance. Never an acquisition / book value and never a resale price. Not administrative authority.',
     'salesAgreement', 'approveTradeIn', 'BUSINESS_ACTION', 'Approve Trade-in Value')
ON CONFLICT (key) DO NOTHING;

-- THE OWNER-RULED HOLDERS (#204). Job Roles grant nothing: these are the SECURITY ROLES the governed persona model gives the
-- positions -- Owner / Executive = owner (the protected Owner Role), General Manager = generalManager, Finance / Accounting =
-- controller, System Administrator = admin (the designated Administrator Role; no new Job Role). Trade-in approval is BUSINESS
-- approval: owner and generalManager ONLY -- never admin (administering EOS), never controller (Finance configuration), never
-- a Sales Role. An Administration revocation recorded before this ran is honoured.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_204_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764500000000', now(), 'migration:1764500000000', now(), 'migration:1764500000000', now()
  FROM (VALUES
          ('finance.configuration.manage', 'owner'), ('finance.configuration.manage', 'generalManager'),
          ('finance.configuration.manage', 'controller'), ('finance.configuration.manage', 'admin'),
          ('sales.discountAuthority.manage', 'owner'), ('sales.discountAuthority.manage', 'generalManager'),
          ('sales.discountAuthority.manage', 'controller'), ('sales.discountAuthority.manage', 'admin'),
          ('admin.systemConfiguration.manage', 'admin'),
          ('salesAgreement.tradeIn.approve', 'owner'), ('salesAgreement.tradeIn.approve', 'generalManager')
       ) AS ruled (capability_key, role_key)
  JOIN capabilities c ON c.key = ruled.capability_key
  JOIN roles r ON r.key = ruled.role_key AND (r.key <> 'owner' OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- ════════════════════ 3. customer sales discount ════════════════════

SET search_path = eos_commercial, public;

ALTER TABLE sales_agreements
    ADD COLUMN customer_discount_kind          TEXT CHECK (customer_discount_kind IS NULL OR customer_discount_kind IN ('PERCENT', 'FIXED_AMOUNT')),
    ADD COLUMN customer_discount_basis_points  INTEGER CHECK (customer_discount_basis_points IS NULL OR customer_discount_basis_points BETWEEN 1 AND 10000),
    ADD COLUMN customer_discount_amount_minor  BIGINT CHECK (customer_discount_amount_minor IS NULL OR customer_discount_amount_minor > 0),
    ADD CONSTRAINT sales_agreement_discount_shape CHECK (
        (customer_discount_kind IS NULL AND customer_discount_basis_points IS NULL AND customer_discount_amount_minor IS NULL)
        OR (customer_discount_kind = 'PERCENT' AND customer_discount_basis_points IS NOT NULL AND customer_discount_amount_minor IS NULL)
        OR (customer_discount_kind = 'FIXED_AMOUNT' AND customer_discount_amount_minor IS NOT NULL AND customer_discount_basis_points IS NULL));

-- ════════════════════ 3b. per-user customer discount authority ════════════════════

-- Each Sales user's MAXIMUM CUSTOMER DISCOUNT, in basis points (0 = no discount authority; 10000 = 100%). NO ROW = NOT
-- CONFIGURED, which fails closed exactly like 0 -- NULL never means unlimited, and there is no unrestricted state.
CREATE TABLE sales_discount_authorities (
    tenant_id                  TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    principal_id               TEXT NOT NULL REFERENCES eos_policy.principals(id),
    max_discount_basis_points  INTEGER NOT NULL CHECK (max_discount_basis_points BETWEEN 0 AND 10000),
    updated_by                 TEXT NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, principal_id)
);

-- ════════════════════ 4. trade-ins: proposal, approval, consideration + incoming equipment ════════════════════

CREATE TABLE sales_agreement_trade_ins (
    tenant_id                       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    sales_agreement_id              TEXT NOT NULL REFERENCES sales_agreements(id),
    item_number                     INTEGER NOT NULL CHECK (item_number > 0),
    -- What the customer is trading in, as known. Identity is never invented: serial / model may stay NULL.
    description                     TEXT NOT NULL CHECK (btrim(description) <> '' AND length(description) <= 300),
    manufacturer                    TEXT CHECK (manufacturer IS NULL OR btrim(manufacturer) <> ''),
    model_number                    TEXT CHECK (model_number IS NULL OR btrim(model_number) <> ''),
    serial_number                   TEXT CHECK (serial_number IS NULL OR btrim(serial_number) <> ''),
    equipment_model_id              TEXT,
    -- The salesperson's PROPOSED value: not consideration until approved; it never reduces a balance.
    proposed_value_minor            BIGINT NOT NULL CHECK (proposed_value_minor > 0),
    notes                           TEXT CHECK (notes IS NULL OR (btrim(notes) <> '' AND length(notes) <= 2000)),
    evidence_reference              TEXT CHECK (evidence_reference IS NULL OR (btrim(evidence_reference) <> '' AND length(evidence_reference) <= 300)),
    -- BUSINESS APPROVAL (salesAgreement.tradeIn.approve). Only APPROVED carries a credit: the APPROVED CREDIT is the
    -- cash-equivalent consideration -- NOT an acquisition / book value and NOT a resale price.
    approval_status                 TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (approval_status IN ('PROPOSED', 'APPROVED', 'DECLINED')),
    approved_credit_minor           BIGINT CHECK (approved_credit_minor IS NULL OR approved_credit_minor > 0),
    decided_by                      TEXT CHECK (decided_by IS NULL OR btrim(decided_by) <> ''),
    decided_at                      TIMESTAMPTZ,
    decision_reason                 TEXT CHECK (decision_reason IS NULL OR btrim(decision_reason) <> ''),
    -- The operating company that will receive the traded equipment (the selling company of the Agreement, never a site).
    receiving_operating_company_id  TEXT NOT NULL CHECK (lower(receiving_operating_company_id) <> 'consolidated'),
    -- The boundary for the later acquisition (no used-equipment lifecycle here): who will receive it, and -- once a governed
    -- receipt exists -- which one. Acquisition value and any future sale price are separate, later facts.
    acquisition_status              TEXT NOT NULL DEFAULT 'AGREED' CHECK (acquisition_status IN ('AGREED', 'RECEIVED')),
    acquired_receiving_id           TEXT,
    created_by                      TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sales_agreement_id, item_number),
    CONSTRAINT trade_in_receiving_company_fk FOREIGN KEY (tenant_id, receiving_operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT trade_in_acquisition_shape CHECK ((acquisition_status = 'RECEIVED') = (acquired_receiving_id IS NOT NULL)),
    CONSTRAINT trade_in_approval_shape CHECK (
        (approval_status = 'PROPOSED' AND approved_credit_minor IS NULL AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR (approval_status = 'APPROVED' AND approved_credit_minor IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
        OR (approval_status = 'DECLINED' AND approved_credit_minor IS NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL))
);

-- ════════════════════ 5. the Billing Package composition ════════════════════

SET search_path = eos_finance, public;

ALTER TABLE billing_packages
    ADD COLUMN customer_discount_minor BIGINT CHECK (customer_discount_minor IS NULL OR customer_discount_minor > 0),
    DROP CONSTRAINT IF EXISTS billing_package_totals_reconcile,
    DROP CONSTRAINT IF EXISTS billing_package_financing_composition;
ALTER TABLE billing_packages
    -- selling (subtotal) - customer discount + shipping + install + tax = total.
    ADD CONSTRAINT billing_package_totals_reconcile CHECK (
        total_minor IS NULL OR total_minor = subtotal_minor - COALESCE(customer_discount_minor, 0) + COALESCE(shipping_minor, 0)
                                             + COALESCE(install_charge_minor, 0) + tax_minor),
    ADD CONSTRAINT billing_package_discount_within_selling CHECK (
        customer_discount_minor IS NULL OR subtotal_minor IS NULL OR customer_discount_minor <= subtotal_minor),
    -- A financed sale: total = cash contribution + trade-in credit + financed amount (never overlapping).
    ADD CONSTRAINT billing_package_financing_composition CHECK (
        commercial_disposition <> 'FINANCED_SALE' OR total_minor IS NULL
        OR (customer_contribution_minor IS NOT NULL AND financed_amount_minor IS NOT NULL
            AND total_minor = customer_contribution_minor + COALESCE(trade_in_minor, 0) + financed_amount_minor));

-- ════════════════════ 6. an untouched handoff follows its company's active destination ════════════════════
-- The #198 handoff guard, relaxed by exactly one case: a READY_FOR_DELIVERY handoff with NO delivery attempt may be re-pointed
-- to its own company's ACTIVE accounting destination (an administrator changed the company's destination before anything
-- was sent). A handoff with any delivery history is never re-pointed.
SET search_path = eos_finance, public;
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
           OR (OLD.status <> 'PENDING_DESTINATION' AND NEW.accounting_destination_id IS DISTINCT FROM OLD.accounting_destination_id
               -- #203: an UNTOUCHED (no attempt) READY handoff may move to its own company's ACTIVE destination.
               AND NOT (OLD.status = 'READY_FOR_DELIVERY' AND OLD.attempt_count = 0 AND EXISTS (
                   SELECT 1 FROM accounting_destinations d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.accounting_destination_id
                      AND d.operating_company_id = NEW.operating_company_id AND d.status = 'ACTIVE'))) THEN
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

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM billing_packages WHERE customer_discount_minor IS NOT NULL
        OR (commercial_disposition = 'FINANCED_SALE' AND COALESCE(trade_in_minor, 0) > 0);
    IF v_n > 0 THEN RAISE EXCEPTION 'SALES_PRICING: refuses to reverse -- % package(s) carry a discount or a financed trade-in', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_commercial.sales_agreement_trade_ins;
    IF v_n > 0 THEN RAISE EXCEPTION 'SALES_PRICING: refuses to reverse -- % trade-in item(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_commercial.sales_agreements WHERE customer_discount_kind IS NOT NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'SALES_PRICING: refuses to reverse -- % Agreement(s) carry a customer discount', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions
     WHERE capability_key IN ('finance.configuration.manage', 'admin.systemConfiguration.manage', 'sales.discountAuthority.manage', 'salesAgreement.tradeIn.approve');
    IF v_n > 0 THEN RAISE EXCEPTION 'GOVERNED_CONFIGURATION: refuses to reverse -- % Administration decision(s) name a #204 capability', v_n; END IF;
    -- No Administration decision names them (checked above), so every Role grant left is a seeded one -- this migration's, or
    -- a deterministic rebuild's replay of it: removing the capabilities removes those grants with them.
    DELETE FROM eos_policy.role_capabilities rc USING eos_policy.capabilities c
     WHERE c.id = rc.capability_id
       AND c.key IN ('finance.configuration.manage', 'admin.systemConfiguration.manage', 'sales.discountAuthority.manage', 'salesAgreement.tradeIn.approve');
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key IN ('finance.configuration.manage', 'admin.systemConfiguration.manage', 'sales.discountAuthority.manage', 'salesAgreement.tradeIn.approve');
    IF v_n > 0 THEN RAISE EXCEPTION 'GOVERNED_CONFIGURATION: refuses to reverse -- % direct grant(s) hold a #203/#204 capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_commercial.sales_discount_authorities;
    IF v_n > 0 THEN RAISE EXCEPTION 'SALES_DISCOUNT_AUTHORITY: refuses to reverse -- % configured limit(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.operating_company_settings;
    IF v_n > 0 THEN RAISE EXCEPTION 'SYSTEM_CONFIGURATION: refuses to reverse -- % company setting(s) exist', v_n; END IF;
END
$$;

ALTER TABLE billing_packages
    DROP CONSTRAINT IF EXISTS billing_package_financing_composition,
    DROP CONSTRAINT IF EXISTS billing_package_discount_within_selling,
    DROP CONSTRAINT IF EXISTS billing_package_totals_reconcile,
    DROP COLUMN IF EXISTS customer_discount_minor;
ALTER TABLE billing_packages
    ADD CONSTRAINT billing_package_totals_reconcile CHECK (
        total_minor IS NULL OR total_minor = subtotal_minor + COALESCE(shipping_minor, 0) + COALESCE(install_charge_minor, 0) + tax_minor),
    ADD CONSTRAINT billing_package_financing_composition CHECK (
        commercial_disposition <> 'FINANCED_SALE' OR total_minor IS NULL
        OR (customer_contribution_minor IS NOT NULL AND financed_amount_minor IS NOT NULL
            AND total_minor = customer_contribution_minor + financed_amount_minor));

DROP TABLE IF EXISTS eos_commercial.sales_agreement_trade_ins;
DROP TABLE IF EXISTS eos_commercial.sales_discount_authorities;
ALTER TABLE eos_commercial.sales_agreements
    DROP CONSTRAINT IF EXISTS sales_agreement_discount_shape,
    DROP COLUMN IF EXISTS customer_discount_amount_minor,
    DROP COLUMN IF EXISTS customer_discount_basis_points,
    DROP COLUMN IF EXISTS customer_discount_kind;
DELETE FROM eos_policy.capabilities
 WHERE key IN ('finance.configuration.manage', 'admin.systemConfiguration.manage', 'sales.discountAuthority.manage', 'salesAgreement.tradeIn.approve');
DROP TABLE IF EXISTS eos_policy.operating_company_settings;
DROP FUNCTION IF EXISTS eos_policy.assert_operating_company_setting_valid();
DROP TABLE IF EXISTS eos_policy.configuration_setting_definitions;
DROP TABLE IF EXISTS eos_policy.supported_languages;
DROP FUNCTION IF EXISTS eos_policy.operating_company_business_date(TEXT, TEXT, TIMESTAMPTZ);
DROP TRIGGER IF EXISTS tenant_operating_company_time_zone_known ON eos_policy.tenant_operating_companies;
DROP FUNCTION IF EXISTS eos_policy.assert_business_time_zone_known();
ALTER TABLE eos_policy.tenant_operating_companies DROP COLUMN IF EXISTS business_time_zone;

-- Restore the #198 handoff guard.
SET search_path = eos_finance, public;
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
