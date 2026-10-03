-- Up Migration
-- TAYLOR / VENTANA INTERCOMPANY TRANSACTIONS (Controller FINANCE BUSINESS RELATIONSHIPS -- intercompany scope, 2026-10-02;
-- DECISIONS #202; #190 §6; FINANCE_TARGET_PRODUCT_MODEL §11; #193 internal supplier identity).
--
-- Taylor and Ventana are separate operating businesses that may transact with each other. WHERE != WHOSE: the buyer and the
-- seller come from the governed Purchase Order identity (purchasing_operating_company_id + supplier_kind =
-- INTERNAL_OPERATING_COMPANY + supplier_operating_company_id, #193) -- never from a warehouse's physical site, never from
-- supplier display text. The existing Purchasing pipeline (Reorder -> PO -> Receipt -> Acquisition Cost Evidence -> Finance
-- consequence) is reused; this adds no second purchasing system.
--
-- THE INTERCOMPANY TRANSACTION is a CORRELATION record (target model §11: "not a financial record"): the governed internal
-- purchase's buyer, seller, source receipt, Purchase Order, amount (from the receipt's acquisition-cost evidence) and currency.
-- It is written by the internal-supplier receipt itself (already a governed fact), in the receipt's transaction.
--
-- THE PAIRED OBLIGATIONS -- the buyer's INTERCOMPANY_PAYABLE and the seller's INTERCOMPANY_RECEIVABLE, two obligations owned by
-- two companies, correlated here, never netted, never CONSOLIDATED-owned. OWNER RULING #202: the governed PRICED RECEIPT
-- establishes them, at the agreed acquisition price, in the receipt's transaction -- no internal invoice, resale, installation,
-- settlement or payment is awaited. An unpriced receipt holds them (no amount is invented) until its cost evidence is
-- complete, then they are established once.
--
-- PAYMENT TERMS are governed, not hardcoded: the BUYER's per-company counterparty profile of the seller company
-- (eos_finance.counterparty_company_profiles) gains a structured net-days term (Taylor -> Ventana: NET 90 by configuration;
-- each direction, and every external supplier, has its own profile). The obligation date is the receipt's business date; the
-- due date = obligation date + net days, stamped on both obligations. No terms governed => no due date (never assumed).
-- Established, due, paid and overdue stay separate facts: overdue is never stored, and no settlement is built.

SET search_path = eos_finance, public;

-- Structured payment terms on the existing per-company counterparty profile (the text column stays for display).
ALTER TABLE counterparty_company_profiles
    ADD COLUMN payment_terms_net_days INTEGER CHECK (payment_terms_net_days IS NULL OR payment_terms_net_days BETWEEN 0 AND 3650);

-- An obligation's governed DUE DATE (nullable: unknown terms are never assumed). Part of its identity once set.
ALTER TABLE obligations ADD COLUMN due_on DATE;
CREATE OR REPLACE FUNCTION refuse_obligation_identity_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'OBLIGATION_IMMUTABLE: an obligation is voided by status and reversing facts, never deleted';
    END IF;
    IF (NEW.tenant_id, NEW.operating_company_id, NEW.counterparty_id, NEW.kind, NEW.currency, NEW.source_domain, NEW.source_record_id, NEW.idempotency_key, NEW.due_on)
       IS DISTINCT FROM (OLD.tenant_id, OLD.operating_company_id, OLD.counterparty_id, OLD.kind, OLD.currency, OLD.source_domain, OLD.source_record_id, OLD.idempotency_key, OLD.due_on) THEN
        RAISE EXCEPTION 'OBLIGATION_IMMUTABLE: only an obligation''s status may change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE TABLE intercompany_transactions (
    id                          TEXT PRIMARY KEY,
    tenant_id                   TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    buyer_operating_company_id  TEXT NOT NULL CHECK (lower(buyer_operating_company_id) <> 'consolidated'),
    seller_operating_company_id TEXT NOT NULL CHECK (lower(seller_operating_company_id) <> 'consolidated'),
    source_kind                 TEXT NOT NULL CHECK (source_kind IN ('REORDER_RECEIPT')),
    source_record_id            TEXT NOT NULL CHECK (btrim(source_record_id) <> ''),
    purchase_order_id           TEXT NOT NULL CHECK (btrim(purchase_order_id) <> ''),
    currency                    TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- The receipt's priced acquisition-cost evidence (integer minor units). Incomplete evidence holds the pair.
    amount_minor                BIGINT CHECK (amount_minor IS NULL OR amount_minor > 0),
    cost_evidence_complete      BOOLEAN NOT NULL,
    status                      TEXT NOT NULL CHECK (status IN ('AWAITING_OBLIGATION_TRIGGER', 'COST_EVIDENCE_MISSING', 'ESTABLISHED',
                                                                 'NOT_REQUIRED_ZERO_AMOUNT', 'SUPERSEDED_BY_RECEIPT_CORRECTION')),
    -- The receipt's business date establishes the obligation date (#202).
    obligation_date             DATE NOT NULL,
    -- The governed terms in force when the pair was established (snapshot), and the due date they give.
    payment_terms_net_days      INTEGER CHECK (payment_terms_net_days IS NULL OR payment_terms_net_days BETWEEN 0 AND 3650),
    due_on                      DATE,
    buyer_obligation_id         TEXT,
    seller_obligation_id        TEXT,
    established_trigger         TEXT CHECK (established_trigger IS NULL OR btrim(established_trigger) <> ''),
    established_at              TIMESTAMPTZ,
    superseded_reason           TEXT,
    idempotency_key             TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    created_by                  TEXT NOT NULL CHECK (btrim(created_by) <> ''),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT intercompany_two_companies CHECK (buyer_operating_company_id <> seller_operating_company_id),
    CONSTRAINT intercompany_buyer_fk FOREIGN KEY (tenant_id, buyer_operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT intercompany_seller_fk FOREIGN KEY (tenant_id, seller_operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT intercompany_buyer_obligation_fk FOREIGN KEY (tenant_id, buyer_obligation_id) REFERENCES obligations (tenant_id, id),
    CONSTRAINT intercompany_seller_obligation_fk FOREIGN KEY (tenant_id, seller_obligation_id) REFERENCES obligations (tenant_id, id),
    CONSTRAINT intercompany_one_per_source UNIQUE (tenant_id, source_kind, source_record_id),
    CONSTRAINT intercompany_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT intercompany_evidence_shape CHECK (
        (status = 'COST_EVIDENCE_MISSING') = (NOT cost_evidence_complete) OR status = 'SUPERSEDED_BY_RECEIPT_CORRECTION'),
    CONSTRAINT intercompany_due_shape CHECK (
        (payment_terms_net_days IS NULL) = (due_on IS NULL)
        AND (due_on IS NULL OR due_on = obligation_date + payment_terms_net_days)
        AND (status = 'ESTABLISHED' OR status = 'SUPERSEDED_BY_RECEIPT_CORRECTION' OR due_on IS NULL)),
    CONSTRAINT intercompany_established_shape CHECK (
        (buyer_obligation_id IS NULL) = (seller_obligation_id IS NULL)
        AND (status <> 'ESTABLISHED' OR (buyer_obligation_id IS NOT NULL AND amount_minor IS NOT NULL AND cost_evidence_complete
                                         AND established_trigger IS NOT NULL AND established_at IS NOT NULL)))
);
CREATE INDEX intercompany_by_companies ON intercompany_transactions (tenant_id, buyer_operating_company_id, seller_operating_company_id);

-- Identity never changes. Status moves AWAITING -> ESTABLISHED | SUPERSEDED, COST_EVIDENCE_MISSING -> ESTABLISHED |
-- NOT_REQUIRED_ZERO_AMOUNT | SUPERSEDED (its evidence completed, or its receipt corrected), ESTABLISHED -> SUPERSEDED. The amount and
-- completeness may move ONLY when leaving COST_EVIDENCE_MISSING; the terms and due date only on becoming ESTABLISHED. ESTABLISHED requires the exact pair: the buyer's INTERCOMPANY_PAYABLE toward
-- the seller company and the seller's INTERCOMPANY_RECEIVABLE toward the buyer company, both for the correlation's amount and
-- currency, both originating from this correlation.
CREATE OR REPLACE FUNCTION guard_intercompany_transaction() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_finance, public AS $$
DECLARE
    v_mutable CONSTANT TEXT[] := ARRAY['status', 'buyer_obligation_id', 'seller_obligation_id', 'established_trigger', 'established_at',
        'superseded_reason', 'updated_at', 'amount_minor', 'cost_evidence_complete', 'payment_terms_net_days', 'due_on'];
    v_ok BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'INTERCOMPANY_TRANSACTION_IMMUTABLE: an intercompany transaction is never deleted'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - v_mutable) <> (to_jsonb(OLD) - v_mutable) THEN
            RAISE EXCEPTION 'INTERCOMPANY_TRANSACTION_IMMUTABLE: buyer, seller, source, amount and currency never change';
        END IF;
        IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN (
            ('AWAITING_OBLIGATION_TRIGGER', 'ESTABLISHED'), ('AWAITING_OBLIGATION_TRIGGER', 'SUPERSEDED_BY_RECEIPT_CORRECTION'),
            ('COST_EVIDENCE_MISSING', 'ESTABLISHED'), ('COST_EVIDENCE_MISSING', 'NOT_REQUIRED_ZERO_AMOUNT'),
            ('COST_EVIDENCE_MISSING', 'SUPERSEDED_BY_RECEIPT_CORRECTION'), ('ESTABLISHED', 'SUPERSEDED_BY_RECEIPT_CORRECTION')) THEN
            RAISE EXCEPTION 'INTERCOMPANY_TRANSITION_REFUSED: % -> % is not an intercompany transition', OLD.status, NEW.status;
        END IF;
        IF (NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.cost_evidence_complete IS DISTINCT FROM OLD.cost_evidence_complete)
           AND NOT (OLD.status = 'COST_EVIDENCE_MISSING' AND NEW.status IN ('ESTABLISHED', 'NOT_REQUIRED_ZERO_AMOUNT') AND NEW.cost_evidence_complete) THEN
            RAISE EXCEPTION 'INTERCOMPANY_TRANSACTION_IMMUTABLE: the amount is fixed once the cost evidence is complete';
        END IF;
        IF (NEW.payment_terms_net_days IS DISTINCT FROM OLD.payment_terms_net_days OR NEW.due_on IS DISTINCT FROM OLD.due_on)
           AND NOT (OLD.status IN ('AWAITING_OBLIGATION_TRIGGER', 'COST_EVIDENCE_MISSING') AND NEW.status = 'ESTABLISHED') THEN
            RAISE EXCEPTION 'INTERCOMPANY_TRANSACTION_IMMUTABLE: the terms and due date are stamped once, with the pair';
        END IF;
        IF OLD.buyer_obligation_id IS NOT NULL AND (NEW.buyer_obligation_id IS DISTINCT FROM OLD.buyer_obligation_id
                                                    OR NEW.seller_obligation_id IS DISTINCT FROM OLD.seller_obligation_id) THEN
            RAISE EXCEPTION 'INTERCOMPANY_TRANSACTION_IMMUTABLE: the paired obligations are recorded once';
        END IF;
    END IF;
    IF NEW.buyer_obligation_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.buyer_obligation_id IS NULL) THEN
        SELECT count(*) = 2 INTO v_ok FROM (
            SELECT 1 FROM obligations o JOIN obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
              JOIN financial_counterparties cp ON cp.tenant_id = o.tenant_id AND cp.id = o.counterparty_id
             WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.buyer_obligation_id AND o.kind = 'INTERCOMPANY_PAYABLE'
               AND o.operating_company_id = NEW.buyer_operating_company_id AND cp.operating_company_id = NEW.seller_operating_company_id
               AND o.currency = NEW.currency AND b.originated_minor = NEW.amount_minor AND o.due_on IS NOT DISTINCT FROM NEW.due_on
               AND o.source_domain = 'INTERCOMPANY' AND o.source_record_id = NEW.id
            UNION ALL
            SELECT 1 FROM obligations o JOIN obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
              JOIN financial_counterparties cp ON cp.tenant_id = o.tenant_id AND cp.id = o.counterparty_id
             WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.seller_obligation_id AND o.kind = 'INTERCOMPANY_RECEIVABLE'
               AND o.operating_company_id = NEW.seller_operating_company_id AND cp.operating_company_id = NEW.buyer_operating_company_id
               AND o.currency = NEW.currency AND b.originated_minor = NEW.amount_minor AND o.due_on IS NOT DISTINCT FROM NEW.due_on
               AND o.source_domain = 'INTERCOMPANY' AND o.source_record_id = NEW.id) pair;
        IF NOT v_ok THEN
            RAISE EXCEPTION 'INTERCOMPANY_PAIR_MISMATCH: the buyer payable and seller receivable must be the exact correlated pair';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER intercompany_transactions_guard BEFORE INSERT OR UPDATE OR DELETE ON intercompany_transactions
    FOR EACH ROW EXECUTE FUNCTION guard_intercompany_transaction();

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM intercompany_transactions;
    IF v_n > 0 THEN RAISE EXCEPTION 'INTERCOMPANY: refuses to reverse -- % intercompany transaction(s) exist', v_n; END IF;
END
$$;

DROP TABLE IF EXISTS intercompany_transactions;
DROP FUNCTION IF EXISTS guard_intercompany_transaction();
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
ALTER TABLE obligations DROP COLUMN IF EXISTS due_on;
ALTER TABLE counterparty_company_profiles DROP COLUMN IF EXISTS payment_terms_net_days;
