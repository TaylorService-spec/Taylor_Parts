-- Up Migration
-- FINANCE CLOSURE (EOS CONTROLLER -- NEXT 3 MAJOR ROADMAP BLOCKS, Package A, 2026-10-03; DECISIONS #206). EOS stays the
-- OPERATIONAL FINANCIAL SUBLEDGER (#145): it records what it knows -- settlements, their application, reconciliation evidence
-- -- and never becomes a GL, never invents a bank fact, never nets, never owns a record in CONSOLIDATED.
--
--   1. SETTLEMENT AUTHORITY. Four capabilities on the `settlement` Object -- record, apply, correct, reconcile -- separated as
--      the Controller requires. GRANT-BEARING (Owner ruling E): seeded to exactly the Security Roles that already hold the
--      equivalent Finance execution authority (finance.payment.apply / refund / adjustment): owner, generalManager, controller,
--      accountingManager, financeManager. NOT admin: administering EOS confers no Finance transaction authority.
--   2. SETTLEMENTS: a payment / receipt EOS has evidence of, independent of any obligation: company, counterparty, kind,
--      amount, currency, business date, technical timestamp, source reference, status, correlation. Never a bank fact.
--   3. APPLICATIONS: a settlement applied to compatible obligations (full / partial / many-to-many), each application writing
--      the obligation's SETTLEMENT fact (the foundation's over-application guard stays the floor). Unapplied remainder and
--      balances are DERIVED. A mistake is reversed (a reversing fact) and re-applied -- never overwritten.
--   4. RECONCILIATION: a settlement's external accounting reference / amount, recorded as evidence (RECONCILED / MISMATCH).
--   5. OBLIGATION HANDOFFS: an accounting handoff may anchor on an OBLIGATION (each company-side intercompany obligation;
--      a vendor payable) beside the billing package -- same control plane, same transitions, one per obligation.
--   6. FBR-F1: the Ventana inventory relief of an intercompany sale -- an explicit, once-per-line inventory event.
--   7. FBR-F2: a seller-authorized service-provider relationship on a Sales Order (Taylor services a Ventana sale).
--   8. FBR-F4: governed LATE cost evidence for an unpriced receipt line (never a rewrite of the receipt).

-- ════════════════════ 1. settlement authority ════════════════════

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_finance_settlement_record', 'finance.settlement.record',
     'Record a settlement EOS has evidence of -- a customer payment, provider funding receipt, vendor payment or intercompany payment / receipt -- for one operating company and one financial counterparty. Never a bank fact; applies nothing by itself.',
     'settlement', 'record', 'BUSINESS_ACTION', 'Record Settlement'),
    ('cap_finance_settlement_apply', 'finance.settlement.apply',
     'Apply a recorded settlement to compatible obligations (same company, counterparty and currency; fitting kind), fully or partially. Over-application is refused.',
     'settlement', 'apply', 'BUSINESS_ACTION', 'Apply Settlement'),
    ('cap_finance_settlement_correct', 'finance.settlement.correct',
     'Correct a settlement or an application: reverse an application, or void a settlement that carries no live application -- always with a reason; nothing is overwritten.',
     'settlement', 'correct', 'BUSINESS_ACTION', 'Correct Settlement'),
    ('cap_finance_reconciliation_record', 'finance.reconciliation.record',
     'Record reconciliation evidence for a settlement against the external accounting system''s reference and amount (RECONCILED or MISMATCH). Invents no external fact.',
     'settlement', 'reconcile', 'BUSINESS_ACTION', 'Record Reconciliation')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_206_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764510000000', now(), 'migration:1764510000000', now(), 'migration:1764510000000', now()
  FROM capabilities c
  JOIN roles r ON r.key IN ('owner', 'generalManager', 'controller', 'accountingManager', 'financeManager') AND (r.key <> 'owner' OR r.protected = TRUE)
 WHERE c.key IN ('finance.settlement.record', 'finance.settlement.apply', 'finance.settlement.correct', 'finance.reconciliation.record')
   AND NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- ════════════════════ 2. settlements ════════════════════

SET search_path = eos_finance, public;

CREATE TABLE settlements (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id  TEXT NOT NULL CHECK (lower(operating_company_id) <> 'consolidated'),
    counterparty_id       TEXT NOT NULL,
    -- What EOS has evidence of. RECEIPT kinds bring money in; DISBURSEMENT kinds pay money out.
    kind                  TEXT NOT NULL CHECK (kind IN ('CUSTOMER_PAYMENT', 'PROVIDER_FUNDING', 'VENDOR_PAYMENT', 'INTERCOMPANY_PAYMENT', 'INTERCOMPANY_RECEIPT')),
    direction             TEXT NOT NULL CHECK (direction IN ('RECEIPT', 'DISBURSEMENT')),
    amount_minor          BIGINT NOT NULL CHECK (amount_minor > 0),
    currency              TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    business_date         DATE NOT NULL,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_reference      TEXT NOT NULL CHECK (btrim(source_reference) <> '' AND length(source_reference) <= 200),
    method                TEXT CHECK (method IS NULL OR method IN ('CHECK', 'ACH', 'WIRE', 'CARD', 'CASH', 'OTHER')),
    status                TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED', 'VOID')),
    correlation_id        TEXT CHECK (correlation_id IS NULL OR btrim(correlation_id) <> ''),
    replaces_settlement_id TEXT,
    notes                 TEXT CHECK (notes IS NULL OR (btrim(notes) <> '' AND length(notes) <= 2000)),
    idempotency_key       TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_fingerprint   TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
    recorded_by           TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    voided_by             TEXT,
    voided_at             TIMESTAMPTZ,
    void_reason           TEXT,
    CONSTRAINT settlement_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT settlement_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT settlement_direction_fits_kind CHECK (
        (kind IN ('CUSTOMER_PAYMENT', 'PROVIDER_FUNDING', 'INTERCOMPANY_RECEIPT')) = (direction = 'RECEIPT')),
    CONSTRAINT settlement_void_shape CHECK (
        (status = 'VOID') = (voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL AND btrim(void_reason) <> '')),
    CONSTRAINT settlement_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT settlement_counterparty_fk FOREIGN KEY (tenant_id, counterparty_id) REFERENCES financial_counterparties (tenant_id, id),
    CONSTRAINT settlement_replaces_fk FOREIGN KEY (tenant_id, replaces_settlement_id) REFERENCES settlements (tenant_id, id)
);
CREATE INDEX settlements_by_company ON settlements (tenant_id, operating_company_id, business_date);
CREATE UNIQUE INDEX settlement_replaced_once ON settlements (tenant_id, replaces_settlement_id) WHERE replaces_settlement_id IS NOT NULL;

-- The counterparty fits the kind: external organization (provider funding: a governed FINANCING_PROVIDER) or the OTHER
-- internal operating company. Only the void columns may change, once.
CREATE OR REPLACE FUNCTION assert_settlement_integrity() RETURNS trigger AS $$
DECLARE
    v_kind TEXT; v_company TEXT; v_account TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: a settlement is voided with a reason, never deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - ARRAY['status', 'voided_by', 'voided_at', 'void_reason']) <> (to_jsonb(OLD) - ARRAY['status', 'voided_by', 'voided_at', 'void_reason'])
           OR OLD.status <> 'RECORDED' OR NEW.status <> 'VOID' THEN
            RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: a RECORDED settlement may only be voided';
        END IF;
        IF EXISTS (SELECT 1 FROM settlement_applications a WHERE a.tenant_id = NEW.tenant_id AND a.settlement_id = NEW.id AND a.status = 'APPLIED') THEN
            RAISE EXCEPTION 'SETTLEMENT_HAS_APPLICATIONS: reverse its applications before voiding the settlement';
        END IF;
        RETURN NEW;
    END IF;
    SELECT kind, operating_company_id, crm_account_id INTO v_kind, v_company, v_account
      FROM financial_counterparties WHERE tenant_id = NEW.tenant_id AND id = NEW.counterparty_id;
    IF NEW.kind IN ('INTERCOMPANY_PAYMENT', 'INTERCOMPANY_RECEIPT') THEN
        IF v_kind <> 'INTERNAL_OPERATING_COMPANY' OR v_company = NEW.operating_company_id THEN
            RAISE EXCEPTION 'SETTLEMENT_COUNTERPARTY_KIND: an intercompany settlement is with the OTHER operating company';
        END IF;
    ELSE
        IF v_kind <> 'EXTERNAL_ORGANIZATION' THEN
            RAISE EXCEPTION 'SETTLEMENT_COUNTERPARTY_KIND: % is with an external organization', NEW.kind;
        END IF;
        IF NEW.kind = 'PROVIDER_FUNDING' AND NOT EXISTS (SELECT 1 FROM eos_crm.account_relationship_types r
              WHERE r.tenant_id = NEW.tenant_id AND r.account_id = v_account AND r.relationship_type = 'FINANCING_PROVIDER') THEN
            RAISE EXCEPTION 'FUNDING_COUNTERPARTY_NOT_FINANCING_PROVIDER: provider funding comes from a governed financing provider';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

-- ════════════════════ 3. applications ════════════════════

CREATE TABLE settlement_applications (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    settlement_id         TEXT NOT NULL,
    obligation_id         TEXT NOT NULL,
    amount_minor          BIGINT NOT NULL CHECK (amount_minor > 0),
    settlement_fact_id    TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED', 'REVERSED')),
    reversal_fact_id      TEXT,
    idempotency_key       TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    applied_by            TEXT NOT NULL CHECK (btrim(applied_by) <> ''),
    applied_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    reversed_by           TEXT,
    reversed_at           TIMESTAMPTZ,
    reversal_reason       TEXT,
    CONSTRAINT settlement_application_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT settlement_application_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT settlement_application_reversal_shape CHECK (
        (status = 'REVERSED') = (reversal_fact_id IS NOT NULL AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL
                                 AND reversal_reason IS NOT NULL AND btrim(reversal_reason) <> '')),
    CONSTRAINT settlement_application_settlement_fk FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements (tenant_id, id),
    CONSTRAINT settlement_application_obligation_fk FOREIGN KEY (tenant_id, obligation_id) REFERENCES obligations (tenant_id, id),
    CONSTRAINT settlement_application_fact_fk FOREIGN KEY (tenant_id, settlement_fact_id) REFERENCES financial_facts (tenant_id, id),
    CONSTRAINT settlement_application_reversal_fk FOREIGN KEY (tenant_id, reversal_fact_id) REFERENCES financial_facts (tenant_id, id)
);
CREATE INDEX settlement_applications_by_settlement ON settlement_applications (tenant_id, settlement_id);
CREATE INDEX settlement_applications_by_obligation ON settlement_applications (tenant_id, obligation_id);

CREATE TRIGGER settlement_integrity BEFORE INSERT OR UPDATE OR DELETE ON settlements
    FOR EACH ROW EXECUTE FUNCTION assert_settlement_integrity();

-- THE FLOOR: an application fits its settlement (company, counterparty, currency, kind <-> obligation kind, RECORDED) and
-- never exceeds the settlement's unapplied amount. Only the reversal columns may change, once.
CREATE OR REPLACE FUNCTION assert_settlement_application_integrity() RETURNS trigger AS $$
DECLARE
    s RECORD; o RECORD; v_applied BIGINT; v_fits BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'SETTLEMENT_APPLICATION_IMMUTABLE: an application is reversed, never deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - ARRAY['status', 'reversal_fact_id', 'reversed_by', 'reversed_at', 'reversal_reason'])
           <> (to_jsonb(OLD) - ARRAY['status', 'reversal_fact_id', 'reversed_by', 'reversed_at', 'reversal_reason'])
           OR OLD.status <> 'APPLIED' OR NEW.status <> 'REVERSED' THEN
            RAISE EXCEPTION 'SETTLEMENT_APPLICATION_IMMUTABLE: an APPLIED application may only be reversed';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO s FROM settlements WHERE tenant_id = NEW.tenant_id AND id = NEW.settlement_id FOR UPDATE;
    SELECT * INTO o FROM obligations WHERE tenant_id = NEW.tenant_id AND id = NEW.obligation_id;
    IF s.status <> 'RECORDED' THEN
        RAISE EXCEPTION 'SETTLEMENT_VOID: a VOID settlement applies nothing';
    END IF;
    IF o.status = 'VOID' THEN
        RAISE EXCEPTION 'OBLIGATION_VOID: a VOID obligation takes no settlement';
    END IF;
    IF s.operating_company_id <> o.operating_company_id THEN
        RAISE EXCEPTION 'SETTLEMENT_COMPANY_MISMATCH: a settlement applies only to its own company''s obligations';
    END IF;
    IF s.currency <> o.currency THEN
        RAISE EXCEPTION 'SETTLEMENT_CURRENCY_MISMATCH: % does not settle a % obligation', s.currency, o.currency;
    END IF;
    IF s.counterparty_id <> o.counterparty_id THEN
        RAISE EXCEPTION 'SETTLEMENT_COUNTERPARTY_MISMATCH: a settlement applies only to its own counterparty''s obligations';
    END IF;
    v_fits := (s.kind = 'CUSTOMER_PAYMENT' AND o.kind = 'RECEIVABLE') OR (s.kind = 'PROVIDER_FUNDING' AND o.kind = 'FUNDING_RECEIVABLE')
           OR (s.kind = 'VENDOR_PAYMENT' AND o.kind = 'PAYABLE') OR (s.kind = 'INTERCOMPANY_PAYMENT' AND o.kind = 'INTERCOMPANY_PAYABLE')
           OR (s.kind = 'INTERCOMPANY_RECEIPT' AND o.kind = 'INTERCOMPANY_RECEIVABLE');
    IF NOT v_fits THEN
        RAISE EXCEPTION 'SETTLEMENT_KIND_MISMATCH: a % does not settle a % obligation', s.kind, o.kind;
    END IF;
    SELECT COALESCE(SUM(amount_minor), 0) INTO v_applied FROM settlement_applications
     WHERE tenant_id = NEW.tenant_id AND settlement_id = NEW.settlement_id AND status = 'APPLIED';
    IF v_applied + NEW.amount_minor > s.amount_minor THEN
        RAISE EXCEPTION 'SETTLEMENT_OVER_APPLIED: % already applied + % exceeds the settlement''s %', v_applied, NEW.amount_minor, s.amount_minor;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE TRIGGER settlement_application_integrity BEFORE INSERT OR UPDATE OR DELETE ON settlement_applications
    FOR EACH ROW EXECUTE FUNCTION assert_settlement_application_integrity();

CREATE VIEW settlement_balances AS
SELECT s.tenant_id, s.id AS settlement_id, s.operating_company_id, s.counterparty_id, s.kind, s.currency, s.status, s.amount_minor,
       COALESCE(SUM(a.amount_minor) FILTER (WHERE a.status = 'APPLIED'), 0)::bigint AS applied_minor,
       (s.amount_minor - COALESCE(SUM(a.amount_minor) FILTER (WHERE a.status = 'APPLIED'), 0))::bigint AS unapplied_minor
  FROM settlements s LEFT JOIN settlement_applications a ON a.tenant_id = s.tenant_id AND a.settlement_id = s.id
 GROUP BY s.tenant_id, s.id;

-- ════════════════════ 4. reconciliation evidence ════════════════════

CREATE TABLE settlement_reconciliations (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    settlement_id         TEXT NOT NULL,
    external_reference    TEXT NOT NULL CHECK (btrim(external_reference) <> '' AND length(external_reference) <= 200),
    external_amount_minor BIGINT NOT NULL CHECK (external_amount_minor >= 0),
    outcome               TEXT NOT NULL CHECK (outcome IN ('RECONCILED', 'MISMATCH')),
    reason                TEXT CHECK (reason IS NULL OR btrim(reason) <> ''),
    idempotency_key       TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    recorded_by           TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT settlement_reconciliation_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT settlement_reconciliation_settlement_fk FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements (tenant_id, id)
);
CREATE INDEX settlement_reconciliations_by_settlement ON settlement_reconciliations (tenant_id, settlement_id, recorded_at);
CREATE TRIGGER settlement_reconciliations_append_only BEFORE UPDATE OR DELETE ON settlement_reconciliations
    FOR EACH ROW EXECUTE FUNCTION refuse_financial_fact_mutation();

-- ════════════════════ 5. obligation-anchored accounting handoffs ════════════════════

-- (accounting_handoff_one_per_package stays: a UNIQUE constraint admits any number of NULL package ids.)
ALTER TABLE accounting_handoffs
    ALTER COLUMN billing_package_id DROP NOT NULL,
    DROP CONSTRAINT accounting_handoffs_payload_kind_check;
ALTER TABLE accounting_handoffs
    ADD CONSTRAINT accounting_handoffs_payload_kind_check CHECK (payload_kind IN ('OPERATIONAL_BILLING_PACKAGE', 'INTERCOMPANY_OBLIGATION', 'VENDOR_PAYABLE')),
    ADD CONSTRAINT accounting_handoff_anchor_shape CHECK ((payload_kind = 'OPERATIONAL_BILLING_PACKAGE') = (billing_package_id IS NOT NULL));
CREATE UNIQUE INDEX accounting_handoff_one_per_obligation ON accounting_handoffs (tenant_id, obligation_id) WHERE billing_package_id IS NULL;
ALTER TABLE accounting_handoff_attempts DROP CONSTRAINT accounting_handoff_attempts_payload_contract_check;
ALTER TABLE accounting_handoff_attempts ADD CONSTRAINT accounting_handoff_attempts_payload_contract_check
    CHECK (payload_contract IN ('eos.accounting.operational-billing-package', 'eos.accounting.operational-obligation'));

-- ════════════════════ 6. FBR-F1: Ventana inventory relief of an intercompany sale ════════════════════

ALTER TYPE eos_ops.ops_movement_type ADD VALUE IF NOT EXISTS 'INTERCOMPANY_SALE_RELIEF';

SET search_path = eos_ops, public;

CREATE TABLE intercompany_inventory_reliefs (
    id                           TEXT PRIMARY KEY,
    tenant_id                    TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    intercompany_transaction_id  TEXT NOT NULL,
    receiving_id                 TEXT NOT NULL,
    receiving_line_id            TEXT NOT NULL,
    part_id                      TEXT NOT NULL,
    quantity                     INTEGER NOT NULL CHECK (quantity > 0),
    seller_operating_company_key TEXT NOT NULL CHECK (btrim(seller_operating_company_key) <> ''),
    source_warehouse_id          TEXT NOT NULL CHECK (btrim(source_warehouse_id) <> ''),
    movement_id                  TEXT NOT NULL,
    reason                       TEXT NOT NULL CHECK (btrim(reason) <> ''),
    idempotency_key              TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    recorded_by                  TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- ONCE per received line: no double decrement.
    CONSTRAINT intercompany_relief_once_per_line UNIQUE (tenant_id, intercompany_transaction_id, receiving_line_id),
    CONSTRAINT intercompany_relief_idempotency UNIQUE (tenant_id, idempotency_key)
);
CREATE TRIGGER intercompany_inventory_reliefs_append_only BEFORE UPDATE OR DELETE ON intercompany_inventory_reliefs
    FOR EACH ROW EXECUTE FUNCTION eos_finance.refuse_financial_fact_mutation();

-- ════════════════════ 7. FBR-F2: a seller-authorized service provider on a Sales Order ════════════════════

SET search_path = eos_commercial, public;

CREATE TABLE sales_order_service_providers (
    tenant_id                     TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    sales_order_id                TEXT NOT NULL REFERENCES sales_orders(id),
    service_operating_company_key TEXT NOT NULL CHECK (btrim(service_operating_company_key) <> ''),
    -- INSTALLATION covers delivery + installation (an INSTALL Work Order); SERVICE covers service / PM / warranty / inspection.
    scopes                        TEXT[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['INSTALLATION', 'SERVICE']::text[]),
    status                        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    reason                        TEXT NOT NULL CHECK (btrim(reason) <> ''),
    authorized_by                 TEXT NOT NULL CHECK (btrim(authorized_by) <> ''),
    authorized_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_by                    TEXT,
    revoked_at                    TIMESTAMPTZ,
    revoke_reason                 TEXT,
    PRIMARY KEY (tenant_id, sales_order_id, service_operating_company_key),
    CONSTRAINT service_provider_revoke_shape CHECK ((status = 'REVOKED') = (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);
-- The fulfillment record keeps the SELLER's company (the Sales Order's); a different service-performing company is stated.
ALTER TABLE sales_order_fulfillments ADD COLUMN service_operating_company_key TEXT
    CHECK (service_operating_company_key IS NULL OR btrim(service_operating_company_key) <> '');

-- ════════════════════ 8. FBR-F4: governed late cost evidence ════════════════════

ALTER TYPE eos_finance.finance_acquisition_cost_basis ADD VALUE IF NOT EXISTS 'GOVERNED_LATE_COST_EVIDENCE';

SET search_path = eos_finance, public;

CREATE TABLE cost_evidence_supplies (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    receiving_id          TEXT NOT NULL,
    receiving_line_id     TEXT NOT NULL,
    exception_id          TEXT NOT NULL REFERENCES cost_evidence_exceptions(id),
    unit_price_minor      BIGINT NOT NULL CHECK (unit_price_minor >= 0),
    currency              TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    evidence_reference    TEXT CHECK (evidence_reference IS NULL OR (btrim(evidence_reference) <> '' AND length(evidence_reference) <= 300)),
    reason                TEXT NOT NULL CHECK (btrim(reason) <> ''),
    acquisition_cost_id   TEXT NOT NULL,
    supplied_by           TEXT NOT NULL CHECK (btrim(supplied_by) <> ''),
    supplied_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cost_evidence_supply_once_per_line UNIQUE (tenant_id, receiving_id, receiving_line_id)
);
CREATE TRIGGER cost_evidence_supplies_append_only BEFORE UPDATE OR DELETE ON cost_evidence_supplies
    FOR EACH ROW EXECUTE FUNCTION refuse_financial_fact_mutation();

ALTER TABLE cost_evidence_exception_resolutions
    DROP CONSTRAINT cost_evidence_exception_resolutions_resolution_check,
    ALTER COLUMN receiving_correction_id DROP NOT NULL,
    ADD COLUMN cost_evidence_supply_id TEXT REFERENCES cost_evidence_supplies(id);
ALTER TABLE cost_evidence_exception_resolutions
    ADD CONSTRAINT cost_evidence_exception_resolutions_resolution_check CHECK (resolution IN ('RECEIPT_VOIDED', 'RECEIPT_CORRECTED', 'COST_EVIDENCE_SUPPLIED')),
    ADD CONSTRAINT cost_evidence_resolution_source_shape CHECK (
        (resolution = 'COST_EVIDENCE_SUPPLIED') = (cost_evidence_supply_id IS NOT NULL AND receiving_correction_id IS NULL));

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM settlements;
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_CLOSURE: refuses to reverse -- % settlement(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM accounting_handoffs WHERE billing_package_id IS NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_CLOSURE: refuses to reverse -- % obligation-anchored handoff(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.intercompany_inventory_reliefs;
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_CLOSURE: refuses to reverse -- % intercompany relief(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_commercial.sales_order_service_providers;
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_CLOSURE: refuses to reverse -- % service-provider authorization(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM cost_evidence_supplies;
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_CLOSURE: refuses to reverse -- % late cost evidence supply(ies) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions
     WHERE capability_key IN ('finance.settlement.record', 'finance.settlement.apply', 'finance.settlement.correct', 'finance.reconciliation.record');
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_CLOSURE: refuses to reverse -- % Administration decision(s) name a settlement capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key IN ('finance.settlement.record', 'finance.settlement.apply', 'finance.settlement.correct', 'finance.reconciliation.record');
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_CLOSURE: refuses to reverse -- % direct grant(s) hold a settlement capability', v_n; END IF;
END
$$;

ALTER TABLE cost_evidence_exception_resolutions
    DROP CONSTRAINT IF EXISTS cost_evidence_resolution_source_shape,
    DROP CONSTRAINT IF EXISTS cost_evidence_exception_resolutions_resolution_check,
    DROP COLUMN IF EXISTS cost_evidence_supply_id;
ALTER TABLE cost_evidence_exception_resolutions
    ALTER COLUMN receiving_correction_id SET NOT NULL,
    ADD CONSTRAINT cost_evidence_exception_resolutions_resolution_check CHECK (resolution IN ('RECEIPT_VOIDED', 'RECEIPT_CORRECTED'));
DROP TABLE IF EXISTS cost_evidence_supplies;

ALTER TABLE eos_commercial.sales_order_fulfillments DROP COLUMN IF EXISTS service_operating_company_key;
DROP TABLE IF EXISTS eos_commercial.sales_order_service_providers;
DROP TABLE IF EXISTS eos_ops.intercompany_inventory_reliefs;

ALTER TABLE accounting_handoff_attempts DROP CONSTRAINT IF EXISTS accounting_handoff_attempts_payload_contract_check;
ALTER TABLE accounting_handoff_attempts ADD CONSTRAINT accounting_handoff_attempts_payload_contract_check
    CHECK (payload_contract = 'eos.accounting.operational-billing-package');
DROP INDEX IF EXISTS accounting_handoff_one_per_obligation;
ALTER TABLE accounting_handoffs
    DROP CONSTRAINT IF EXISTS accounting_handoff_anchor_shape,
    DROP CONSTRAINT IF EXISTS accounting_handoffs_payload_kind_check;
ALTER TABLE accounting_handoffs
    ALTER COLUMN billing_package_id SET NOT NULL,
    ADD CONSTRAINT accounting_handoffs_payload_kind_check CHECK (payload_kind = 'OPERATIONAL_BILLING_PACKAGE');

DROP TABLE IF EXISTS settlement_reconciliations;
DROP VIEW IF EXISTS settlement_balances;
DROP TABLE IF EXISTS settlement_applications;
DROP TABLE IF EXISTS settlements;
DROP FUNCTION IF EXISTS assert_settlement_application_integrity();
DROP FUNCTION IF EXISTS assert_settlement_integrity();

DELETE FROM eos_policy.role_capabilities rc USING eos_policy.capabilities c
 WHERE c.id = rc.capability_id
   AND c.key IN ('finance.settlement.record', 'finance.settlement.apply', 'finance.settlement.correct', 'finance.reconciliation.record');
DELETE FROM eos_policy.capabilities
 WHERE key IN ('finance.settlement.record', 'finance.settlement.apply', 'finance.settlement.correct', 'finance.reconciliation.record');
-- (The two enum values added -- INTERCOMPANY_SALE_RELIEF, GOVERNED_LATE_COST_EVIDENCE -- stay: PostgreSQL cannot drop an
-- enum value, and no row carries them once the tables above are gone or refused.)
