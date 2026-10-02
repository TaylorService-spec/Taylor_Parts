-- Up Migration
-- FINANCE FOUNDATION (Controller FINANCE TARGET MODEL ACCEPTANCE + FOUNDATION IMPLEMENTATION, 2026-10-01; DECISIONS #145,
-- #190, #191). The company-scoped OPERATIONAL financial subledger core -- NOT a general ledger. Nothing here is routed,
-- granted or activated: it is the governed shape (and its database invariants) the later Finance packages write through.
--
--   C1  organization / counterparty: CRM Account stays THE organization identity for external parties (relationship
--       FINANCING_PROVIDER added beside CUSTOMER / VENDOR); eos_ops.suppliers gains a governed link to its CRM Account (the
--       supplier is an operational relationship/profile of an organization -- nothing is removed); a financial
--       counterparty is EXTERNAL_ORGANIZATION (-> CRM Account) or INTERNAL_OPERATING_COMPANY (-> operating company). Taylor
--       and Ventana are never CRM Accounts merely to be counterparties.
--   C2  counterparty-by-company profile: one organization, a distinct financial relationship with each operating company.
--   C3  financial facts: immutable, one operating company each (never CONSOLIDATED), idempotent, corrections by new facts.
--       fact_class keeps COMMITMENT (Sales Order / PO commitment: reporting only, never revenue / expense / receivable /
--       payable / posting) apart from COST_EVIDENCE, OBLIGATION and SETTLEMENT.
--   C4  obligations: one company + one counterparty; balances DERIVE from OBLIGATION / SETTLEMENT facts; status is never
--       the financial truth; settlement cannot over-apply.
--   C5  cost-evidence exceptions: an unpriced receipt line is a governed COST_EVIDENCE_MISSING condition, never a zero cost.
--   C6  correction: reversal (equal and opposite, at most once) and replacement facts, both linked to the original.
--   C7  accounting destinations: provider-neutral, per operating company; no provider, connection or credential.

SET search_path = eos_finance, public;

-- ════════════════════ C1. organizations and counterparties ════════════════════

ALTER TABLE eos_crm.account_relationship_types
    DROP CONSTRAINT account_relationship_types_relationship_type_check;
ALTER TABLE eos_crm.account_relationship_types
    ADD CONSTRAINT account_relationship_types_relationship_type_check
    CHECK (relationship_type IN ('CUSTOMER', 'VENDOR', 'FINANCING_PROVIDER'));

-- The supplier record is the operational vendor profile OF an organization. One organization has at most one supplier
-- profile per tenant; the link is optional until a supplier is governed onto its organization. The reference is OPAQUE
-- governed data -- deliberately NO foreign key: there is no FK in either direction between eos_crm and eos_ops (the
-- standing invariant crmCustomerPostgres proves). The finance repository validates it (the account exists and is
-- governed as a VENDOR) when it writes the link.
ALTER TABLE eos_ops.suppliers ADD COLUMN crm_account_id TEXT CHECK (crm_account_id IS NULL OR btrim(crm_account_id) <> '');
CREATE UNIQUE INDEX suppliers_one_profile_per_organization
    ON eos_ops.suppliers (tenant_id, crm_account_id) WHERE crm_account_id IS NOT NULL;

CREATE TABLE financial_counterparties (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    kind                  TEXT NOT NULL,
    crm_account_id        TEXT,
    operating_company_id  TEXT,
    created_by            TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT financial_counterparty_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT financial_counterparty_kind_known CHECK (kind IN ('EXTERNAL_ORGANIZATION', 'INTERNAL_OPERATING_COMPANY')),
    -- Exactly one backing identity, matching the kind.
    CONSTRAINT financial_counterparty_backing_identity CHECK (
        (kind = 'EXTERNAL_ORGANIZATION' AND crm_account_id IS NOT NULL AND operating_company_id IS NULL)
        OR (kind = 'INTERNAL_OPERATING_COMPANY' AND operating_company_id IS NOT NULL AND crm_account_id IS NULL)),
    CONSTRAINT financial_counterparty_account_fk FOREIGN KEY (tenant_id, crm_account_id) REFERENCES eos_crm.accounts (tenant_id, id),
    CONSTRAINT financial_counterparty_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id)
);
-- One counterparty per backing identity: no duplicate Saratoga / vendor / company counterparties.
CREATE UNIQUE INDEX financial_counterparty_one_per_organization
    ON financial_counterparties (tenant_id, crm_account_id) WHERE crm_account_id IS NOT NULL;
CREATE UNIQUE INDEX financial_counterparty_one_per_company
    ON financial_counterparties (tenant_id, operating_company_id) WHERE operating_company_id IS NOT NULL;

-- ════════════════════ C2. counterparty-by-company profile ════════════════════

CREATE TABLE counterparty_company_profiles (
    tenant_id             TEXT NOT NULL,
    counterparty_id       TEXT NOT NULL,
    operating_company_id  TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'ACTIVE',
    payment_terms         TEXT CHECK (payment_terms IS NULL OR btrim(payment_terms) <> ''),
    accounting_reference  TEXT CHECK (accounting_reference IS NULL OR btrim(accounting_reference) <> ''),
    updated_by            TEXT NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, counterparty_id, operating_company_id),
    CONSTRAINT counterparty_profile_status_known CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT counterparty_profile_counterparty_fk FOREIGN KEY (tenant_id, counterparty_id) REFERENCES financial_counterparties (tenant_id, id),
    CONSTRAINT counterparty_profile_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT counterparty_profile_not_consolidated CHECK (lower(operating_company_id) <> 'consolidated')
);

-- An operating company is never its own counterparty (an intercompany relationship needs two companies).
CREATE OR REPLACE FUNCTION assert_profile_not_self() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM financial_counterparties c
      WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.counterparty_id AND c.operating_company_id = NEW.operating_company_id;
    IF FOUND THEN
        RAISE EXCEPTION 'COUNTERPARTY_IS_SELF: operating company % cannot be its own counterparty', NEW.operating_company_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE TRIGGER counterparty_profile_not_self BEFORE INSERT OR UPDATE ON counterparty_company_profiles
    FOR EACH ROW EXECUTE FUNCTION assert_profile_not_self();

-- ════════════════════ C4. obligations (declared before facts reference them) ════════════════════

CREATE TABLE obligations (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id  TEXT NOT NULL,
    counterparty_id       TEXT NOT NULL,
    kind                  TEXT NOT NULL,
    currency              TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    source_domain         TEXT NOT NULL CHECK (btrim(source_domain) <> ''),
    source_record_id      TEXT NOT NULL CHECK (btrim(source_record_id) <> ''),
    status                TEXT NOT NULL DEFAULT 'OPEN',
    idempotency_key       TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    created_by            TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT obligation_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT obligation_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT obligation_kind_known CHECK (kind IN ('RECEIVABLE', 'PAYABLE', 'FUNDING_RECEIVABLE', 'INTERCOMPANY_RECEIVABLE', 'INTERCOMPANY_PAYABLE')),
    CONSTRAINT obligation_status_known CHECK (status IN ('OPEN', 'PARTIAL', 'SETTLED', 'VOID')),
    CONSTRAINT obligation_not_consolidated CHECK (lower(operating_company_id) <> 'consolidated'),
    CONSTRAINT obligation_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT obligation_counterparty_fk FOREIGN KEY (tenant_id, counterparty_id) REFERENCES financial_counterparties (tenant_id, id)
);

-- The counterparty must fit the obligation kind: INTERCOMPANY_* needs the OTHER operating company; everything else an
-- external organization; FUNDING_RECEIVABLE an organization governed as a FINANCING_PROVIDER (#190 §12).
CREATE OR REPLACE FUNCTION assert_obligation_counterparty_fits() RETURNS trigger AS $$
DECLARE
    v_kind TEXT; v_company TEXT; v_account TEXT;
BEGIN
    SELECT kind, operating_company_id, crm_account_id INTO v_kind, v_company, v_account
      FROM financial_counterparties WHERE tenant_id = NEW.tenant_id AND id = NEW.counterparty_id;
    IF NEW.kind IN ('INTERCOMPANY_RECEIVABLE', 'INTERCOMPANY_PAYABLE') THEN
        IF v_kind <> 'INTERNAL_OPERATING_COMPANY' THEN
            RAISE EXCEPTION 'OBLIGATION_COUNTERPARTY_KIND: % requires an internal operating-company counterparty', NEW.kind;
        END IF;
        IF v_company = NEW.operating_company_id THEN
            RAISE EXCEPTION 'COUNTERPARTY_IS_SELF: an intercompany obligation needs two operating companies';
        END IF;
    ELSE
        IF v_kind <> 'EXTERNAL_ORGANIZATION' THEN
            RAISE EXCEPTION 'OBLIGATION_COUNTERPARTY_KIND: % requires an external organization counterparty', NEW.kind;
        END IF;
        IF NEW.kind = 'FUNDING_RECEIVABLE' THEN
            PERFORM 1 FROM eos_crm.account_relationship_types r
              WHERE r.tenant_id = NEW.tenant_id AND r.account_id = v_account AND r.relationship_type = 'FINANCING_PROVIDER';
            IF NOT FOUND THEN
                RAISE EXCEPTION 'FUNDING_COUNTERPARTY_NOT_FINANCING_PROVIDER: the organization is not governed as a financing provider';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE TRIGGER obligation_counterparty_fits BEFORE INSERT ON obligations
    FOR EACH ROW EXECUTE FUNCTION assert_obligation_counterparty_fits();

-- Company, counterparty, kind, currency and source are the obligation's identity: never rewritten (status may move).
CREATE OR REPLACE FUNCTION refuse_obligation_identity_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'OBLIGATION_IMMUTABLE: an obligation is voided by status and reversing facts, never deleted';
    END IF;
    IF (NEW.tenant_id, NEW.operating_company_id, NEW.counterparty_id, NEW.kind, NEW.currency, NEW.source_domain, NEW.source_record_id, NEW.idempotency_key)
       IS DISTINCT FROM (OLD.tenant_id, OLD.operating_company_id, OLD.counterparty_id, OLD.kind, OLD.currency, OLD.source_domain, OLD.source_record_id, OLD.idempotency_key) THEN
        RAISE EXCEPTION 'OBLIGATION_IMMUTABLE: only an obligation''s status may change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE TRIGGER obligation_identity_immutable BEFORE UPDATE OR DELETE ON obligations
    FOR EACH ROW EXECUTE FUNCTION refuse_obligation_identity_change();

-- ════════════════════ C3 / C6. financial facts ════════════════════

CREATE TABLE financial_facts (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id  TEXT NOT NULL,
    counterparty_id       TEXT,
    fact_class            TEXT NOT NULL,
    fact_type             TEXT NOT NULL CHECK (fact_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    source_domain         TEXT NOT NULL CHECK (btrim(source_domain) <> ''),
    source_record_id      TEXT NOT NULL CHECK (btrim(source_record_id) <> ''),
    source_line           TEXT CHECK (source_line IS NULL OR btrim(source_line) <> ''),
    amount_minor          BIGINT NOT NULL CHECK (amount_minor <> 0),
    currency              TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    basis                 TEXT NOT NULL CHECK (btrim(basis) <> ''),
    effective_at          TIMESTAMPTZ NOT NULL,
    idempotency_key       TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_fingerprint   TEXT NOT NULL CHECK (btrim(request_fingerprint) <> ''),
    obligation_id         TEXT,
    reverses_fact_id      TEXT,
    corrects_fact_id      TEXT,
    correlation_id        TEXT CHECK (correlation_id IS NULL OR btrim(correlation_id) <> ''),
    reason                TEXT CHECK (reason IS NULL OR btrim(reason) <> ''),
    created_by            TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT financial_fact_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT financial_fact_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT financial_fact_class_known CHECK (fact_class IN ('COMMITMENT', 'COST_EVIDENCE', 'OBLIGATION', 'SETTLEMENT')),
    CONSTRAINT financial_fact_not_consolidated CHECK (lower(operating_company_id) <> 'consolidated'),
    -- OBLIGATION / SETTLEMENT facts compose an obligation; COMMITMENT / COST_EVIDENCE never do.
    CONSTRAINT financial_fact_obligation_class CHECK (
        (fact_class IN ('OBLIGATION', 'SETTLEMENT')) = (obligation_id IS NOT NULL)),
    -- A correction carries its reason; a fact is either a reversal or a replacement, never both.
    CONSTRAINT financial_fact_correction_reason CHECK (
        (reverses_fact_id IS NULL AND corrects_fact_id IS NULL) OR reason IS NOT NULL),
    CONSTRAINT financial_fact_one_correction_role CHECK (reverses_fact_id IS NULL OR corrects_fact_id IS NULL),
    CONSTRAINT financial_fact_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT financial_fact_counterparty_fk FOREIGN KEY (tenant_id, counterparty_id) REFERENCES financial_counterparties (tenant_id, id),
    CONSTRAINT financial_fact_obligation_fk FOREIGN KEY (tenant_id, obligation_id) REFERENCES obligations (tenant_id, id),
    CONSTRAINT financial_fact_reverses_fk FOREIGN KEY (tenant_id, reverses_fact_id) REFERENCES financial_facts (tenant_id, id),
    CONSTRAINT financial_fact_corrects_fk FOREIGN KEY (tenant_id, corrects_fact_id) REFERENCES financial_facts (tenant_id, id)
);
-- A fact is reversed at most once.
CREATE UNIQUE INDEX financial_fact_reversed_once ON financial_facts (tenant_id, reverses_fact_id) WHERE reverses_fact_id IS NOT NULL;
CREATE INDEX financial_facts_by_source ON financial_facts (tenant_id, source_domain, source_record_id);
CREATE INDEX financial_facts_by_company ON financial_facts (tenant_id, operating_company_id, effective_at);
CREATE INDEX financial_facts_by_obligation ON financial_facts (tenant_id, obligation_id) WHERE obligation_id IS NOT NULL;

CREATE TRIGGER financial_facts_append_only BEFORE UPDATE OR DELETE ON financial_facts
    FOR EACH ROW EXECUTE FUNCTION refuse_financial_fact_mutation();

-- Fact integrity on insert:
--   * a reversal is the exact opposite of its original (same company, counterparty, class, type, currency, obligation);
--   * a replacement keeps company, class and currency, and its original must already be reversed;
--   * an OBLIGATION / SETTLEMENT fact matches its obligation's company, counterparty and currency;
--   * a SETTLEMENT never takes the settled total past the originated total, nor below zero (locked per obligation).
CREATE OR REPLACE FUNCTION assert_financial_fact_integrity() RETURNS trigger AS $$
DECLARE
    o RECORD; ob RECORD; v_originated BIGINT; v_settled BIGINT;
BEGIN
    IF NEW.reverses_fact_id IS NOT NULL THEN
        SELECT * INTO o FROM financial_facts WHERE tenant_id = NEW.tenant_id AND id = NEW.reverses_fact_id;
        IF o.reverses_fact_id IS NOT NULL THEN
            RAISE EXCEPTION 'REVERSAL_OF_REVERSAL: a reversal is corrected by a replacement fact, not reversed again';
        END IF;
        IF NEW.amount_minor <> -o.amount_minor OR NEW.operating_company_id <> o.operating_company_id
           OR NEW.counterparty_id IS DISTINCT FROM o.counterparty_id OR NEW.fact_class <> o.fact_class
           OR NEW.fact_type <> o.fact_type OR NEW.currency <> o.currency OR NEW.obligation_id IS DISTINCT FROM o.obligation_id THEN
            RAISE EXCEPTION 'REVERSAL_MISMATCH: a reversal is the exact opposite of fact %', o.id;
        END IF;
    END IF;
    IF NEW.corrects_fact_id IS NOT NULL THEN
        SELECT * INTO o FROM financial_facts WHERE tenant_id = NEW.tenant_id AND id = NEW.corrects_fact_id;
        IF NEW.operating_company_id <> o.operating_company_id OR NEW.fact_class <> o.fact_class OR NEW.currency <> o.currency THEN
            RAISE EXCEPTION 'CORRECTION_MISMATCH: a replacement keeps the company, class and currency of fact %', o.id;
        END IF;
        PERFORM 1 FROM financial_facts WHERE tenant_id = NEW.tenant_id AND reverses_fact_id = NEW.corrects_fact_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CORRECTION_WITHOUT_REVERSAL: fact % must be reversed before it is replaced', o.id;
        END IF;
    END IF;
    IF NEW.obligation_id IS NOT NULL THEN
        SELECT * INTO ob FROM obligations WHERE tenant_id = NEW.tenant_id AND id = NEW.obligation_id FOR UPDATE;
        IF ob.operating_company_id <> NEW.operating_company_id OR ob.counterparty_id IS DISTINCT FROM NEW.counterparty_id
           OR ob.currency <> NEW.currency THEN
            RAISE EXCEPTION 'OBLIGATION_FACT_MISMATCH: the fact must carry obligation %''s company, counterparty and currency', ob.id;
        END IF;
        IF NEW.fact_class = 'SETTLEMENT' THEN
            SELECT COALESCE(SUM(amount_minor) FILTER (WHERE fact_class = 'OBLIGATION'), 0),
                   COALESCE(SUM(amount_minor) FILTER (WHERE fact_class = 'SETTLEMENT'), 0)
              INTO v_originated, v_settled
              FROM financial_facts WHERE tenant_id = NEW.tenant_id AND obligation_id = NEW.obligation_id;
            IF v_settled + NEW.amount_minor > v_originated THEN
                RAISE EXCEPTION 'SETTLEMENT_OVER_APPLIED: % + % exceeds the originated %', v_settled, NEW.amount_minor, v_originated;
            END IF;
            IF v_settled + NEW.amount_minor < 0 THEN
                RAISE EXCEPTION 'SETTLEMENT_NEGATIVE: settled total cannot fall below zero';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE TRIGGER financial_fact_integrity BEFORE INSERT ON financial_facts
    FOR EACH ROW EXECUTE FUNCTION assert_financial_fact_integrity();

-- Balances are DERIVED -- never stored, never hand-entered.
CREATE VIEW obligation_balances AS
SELECT o.tenant_id, o.id AS obligation_id, o.operating_company_id, o.counterparty_id, o.kind, o.currency, o.status,
       COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'OBLIGATION'), 0)::bigint AS originated_minor,
       COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'SETTLEMENT'), 0)::bigint AS settled_minor,
       (COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'OBLIGATION'), 0)
        - COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'SETTLEMENT'), 0))::bigint AS outstanding_minor
  FROM obligations o
  LEFT JOIN financial_facts f ON f.tenant_id = o.tenant_id AND f.obligation_id = o.id
 GROUP BY o.tenant_id, o.id;

-- ════════════════════ C5. cost-evidence exceptions ════════════════════

-- An unpriced receipt line: the cost is UNKNOWN. Recorded as a governed condition (never a zero-cost fact), once per
-- receipt line; resolved later by policy, not by editing this row away.
CREATE TABLE cost_evidence_exceptions (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id  TEXT NOT NULL,
    condition             TEXT NOT NULL CHECK (condition IN ('COST_EVIDENCE_MISSING')),
    receiving_id          TEXT NOT NULL,
    receiving_line_id     TEXT NOT NULL,
    purchase_order_id     TEXT NOT NULL,
    part_id               TEXT NOT NULL,
    received_quantity     INTEGER NOT NULL CHECK (received_quantity > 0),
    detected_by           TEXT NOT NULL CHECK (btrim(detected_by) <> ''),
    detected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cost_evidence_exception_one_per_line UNIQUE (tenant_id, receiving_id, receiving_line_id, condition),
    CONSTRAINT cost_evidence_exception_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id)
);
CREATE TRIGGER cost_evidence_exceptions_append_only BEFORE UPDATE OR DELETE ON cost_evidence_exceptions
    FOR EACH ROW EXECUTE FUNCTION refuse_financial_fact_mutation();

-- ════════════════════ C7. accounting destinations ════════════════════

-- Provider-NEUTRAL: provider_key is an opaque configuration label (no vendor is assumed anywhere, #145), and no
-- connection detail or credential lives here. At most one ACTIVE destination per operating company; two companies may
-- point at the same or at different destinations -- nothing requires them to share.
CREATE TABLE accounting_destinations (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id  TEXT NOT NULL,
    display_name          TEXT NOT NULL CHECK (btrim(display_name) <> ''),
    provider_key          TEXT CHECK (provider_key IS NULL OR provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
    external_company_ref  TEXT CHECK (external_company_ref IS NULL OR btrim(external_company_ref) <> ''),
    status                TEXT NOT NULL DEFAULT 'INACTIVE',
    created_by            TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT NOT NULL CHECK (btrim(updated_by) <> ''),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounting_destination_status_known CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT accounting_destination_not_consolidated CHECK (lower(operating_company_id) <> 'consolidated'),
    CONSTRAINT accounting_destination_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id)
);
CREATE UNIQUE INDEX accounting_destination_one_active_per_company
    ON accounting_destinations (tenant_id, operating_company_id) WHERE status = 'ACTIVE';

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT (SELECT count(*) FROM financial_facts) + (SELECT count(*) FROM obligations) + (SELECT count(*) FROM cost_evidence_exceptions)
      INTO v_n;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FINANCE_FOUNDATION: refuses to reverse -- % financial fact / obligation / exception row(s) exist', v_n;
    END IF;
END
$$;

DROP TABLE IF EXISTS accounting_destinations;
DROP TABLE IF EXISTS cost_evidence_exceptions;
DROP VIEW IF EXISTS obligation_balances;
DROP TABLE IF EXISTS financial_facts;
DROP FUNCTION IF EXISTS assert_financial_fact_integrity();
DROP TABLE IF EXISTS obligations;
DROP FUNCTION IF EXISTS refuse_obligation_identity_change();
DROP FUNCTION IF EXISTS assert_obligation_counterparty_fits();
DROP TABLE IF EXISTS counterparty_company_profiles;
DROP FUNCTION IF EXISTS assert_profile_not_self();
DROP TABLE IF EXISTS financial_counterparties;
DROP INDEX IF EXISTS eos_ops.suppliers_one_profile_per_organization;
ALTER TABLE eos_ops.suppliers DROP COLUMN IF EXISTS crm_account_id;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eos_crm.account_relationship_types WHERE relationship_type = 'FINANCING_PROVIDER') THEN
        RAISE EXCEPTION 'FINANCE_FOUNDATION: refuses to reverse -- FINANCING_PROVIDER relationships exist';
    END IF;
END
$$;
ALTER TABLE eos_crm.account_relationship_types DROP CONSTRAINT account_relationship_types_relationship_type_check;
ALTER TABLE eos_crm.account_relationship_types
    ADD CONSTRAINT account_relationship_types_relationship_type_check CHECK (relationship_type IN ('CUSTOMER', 'VENDOR'));
