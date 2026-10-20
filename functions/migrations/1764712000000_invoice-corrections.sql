-- Up Migration
-- F-1b: GOVERNED CREDITS, WRITE-OFFS, ADJUSTMENTS, REFUNDS AND ELIGIBLE VOIDS OF AN ISSUED INVOICE (DECISIONS #F-1b; spec docs/architecture/f1-invoicing-spec.md;
-- Owner rulings docs/governance/owner-commercial-spec-rulings-2026-10-20.md OD-F1-1 / OD-F1-4 / OD-F1-9 / OD-F1-11, nonprod only). Slot 1764712000000 (lane F range, after F-1a 1764700000000).
--
-- WHAT THIS CHANGES (and nothing else):
--   1. eos_finance.invoice_corrections   the request -> decision record of every credit, write-off, debit, refund and void of an ISSUED invoice. Its OWN row, linked to the invoice;
--                                        the invoice, its number and its lines are never edited. Two-person approval is a CHECK: the deciding Principal AND Employee differ from the
--                                        requesting ones ($0 threshold: a correction is for a positive amount and is never effective until a different Employee APPLIES it). A decided
--                                        row never changes again, except that an APPLIED row records the effect it had, once.
--   2. assert_adjustment_fact_is_approved   an OBLIGATION-class RECEIVABLE_CREDITED / RECEIVABLE_CHARGED / RECEIVABLE_WRITTEN_OFF fact is admitted ONLY for an APPLIED correction of the
--                                        same kind, amount and receivable that has not yet recorded its fact, and never below what has been settled. Outstanding stays DERIVED from the obligation.
--   3. refuse_invoiced_origination_reversal   an OBLIGATION fact of a receivable with a live (un-voided) invoice cannot be reversed: closes the F-1a note ("origination facts are not
--                                        guarded against a direct reversal"). A void reverses them only AFTER the invoice is void.
--   4. refuse_issued_invoice_change      F-1a's immutability trigger gains ONE exception: the void columns may be set, once, on an issued invoice, and ONLY WHEN an APPLIED VOID
--                                        correction decided by a separate Employee exists AND no settlement application (reversed or not), no settlement fact and no applied adjustment
--                                        exists for it. Every other change to an issued invoice is still refused. This is NOT a general bypass.
--   5. settlement kind CUSTOMER_REFUND   a DISBURSEMENT settlement that RECORDS an approved refund (Owner OD-F1-11). It is not creatable through recordSettlement (SETTLEMENT_KINDS is
--                                        unchanged); it takes no application; it shows no unapplied remainder; it can never be voided. It executes NOTHING: no payment, no instruction.
--                                        settlement_balances gains refunded_minor (appended) and a payment's unapplied remainder is net of the refunds taken from it; the application
--                                        trigger counts refunds so refunded money cannot be applied again; a payment with an applied refund cannot be voided.
--   5b. assert_correction_employee_linked   the Employee recorded on a request / a decision IS that Principal's active Employee link at that moment (F5).
--   6. three APPROVAL capabilities      finance.adjustment.approve (credit, write-off, debit), finance.refund.approve, finance.invoice.void.approve -- BUSINESS_ACTION on the existing
--                                        invoice / payment Objects (not implied by Protected Administrator standing). NO GRANTS (section 7): registered and held by nobody until the Owner grants them.
-- Pre-write checks the controller runs (nonprod, read-only): migration 1764700000000 is applied; eos_finance.invoices is empty or holds no un-voided invoice that this changes; the cells
-- (invoice, approveAdjustment), (payment, approveRefund), (invoice, approveVoid) are unused in eos_policy.capabilities; settlements.kind CHECK is named settlements_kind_check; no view
-- other than settlement_balances depends on settlements.
-- Drafted by the F-1b lane; reviewed and written into the repository by the controller (agents cannot write migrations directly).

SET search_path = eos_finance, public;

-- ════════════════════ 1. invoice_corrections ════════════════════

CREATE TABLE invoice_corrections (
    id                        TEXT        PRIMARY KEY,
    tenant_id                 TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id      TEXT        NOT NULL,
    invoice_id                TEXT        NOT NULL,
    obligation_id             TEXT        NOT NULL,
    kind                      TEXT        NOT NULL,
    -- Positive always. A VOID states the invoice's whole amount due (what the receivable originated); the others state their own amount.
    amount_minor              BIGINT      NOT NULL,
    currency                  TEXT        NOT NULL,
    reason                    TEXT        NOT NULL,
    -- A REFUND names the payment settlement and the application of it that is being returned.
    settlement_id             TEXT,
    application_id            TEXT,
    status                    TEXT        NOT NULL DEFAULT 'PENDING',
    requested_by              TEXT        NOT NULL,
    requested_by_employee_id  TEXT        NOT NULL,
    requested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_idempotency_key   TEXT        NOT NULL,
    request_fingerprint       TEXT        NOT NULL,
    decided_by                TEXT,
    decided_by_employee_id    TEXT,
    decided_at                TIMESTAMPTZ,
    decision_reason           TEXT,
    decision_idempotency_key  TEXT,
    decision_fingerprint      TEXT,
    -- The effect an APPLIED correction had (recorded once, from NULL): the adjustment fact, or the refund RECORD.
    fact_id                   TEXT,
    refund_settlement_id      TEXT,
    CONSTRAINT invoice_correction_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT invoice_correction_kind_known CHECK (kind IN ('CREDIT_MEMO', 'DEBIT_CHARGE', 'WRITE_OFF', 'REFUND', 'VOID')),
    CONSTRAINT invoice_correction_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT invoice_correction_currency_code CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT invoice_correction_reason_stated CHECK (btrim(reason) <> '' AND length(reason) <= 500),
    CONSTRAINT invoice_correction_status_known CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN')),
    CONSTRAINT invoice_correction_key_stated CHECK (btrim(requested_by) <> '' AND btrim(requested_by_employee_id) <> '' AND btrim(request_idempotency_key) <> ''),
    CONSTRAINT invoice_correction_refund_shape CHECK (((kind = 'REFUND') = (settlement_id IS NOT NULL)) AND ((settlement_id IS NULL) = (application_id IS NULL))),
    CONSTRAINT invoice_correction_effect_shape CHECK (
        (fact_id IS NULL OR (status = 'APPLIED' AND kind IN ('CREDIT_MEMO', 'DEBIT_CHARGE', 'WRITE_OFF')))
        AND (refund_settlement_id IS NULL OR (status = 'APPLIED' AND kind = 'REFUND'))),
    -- PENDING has no decision; every other status has all of it.
    CONSTRAINT invoice_correction_decision_shape CHECK (
        (status = 'PENDING') = (decided_by IS NULL)
        AND (decided_by IS NULL) = (decided_by_employee_id IS NULL)
        AND (decided_by IS NULL) = (decided_at IS NULL)
        AND (decided_by IS NULL) = (decision_reason IS NULL)
        AND (decided_by IS NULL) = (decision_idempotency_key IS NULL)
        AND (decided_by IS NULL) = (decision_fingerprint IS NULL)),
    CONSTRAINT invoice_correction_decision_reason_stated CHECK (decision_reason IS NULL OR (btrim(decision_reason) <> '' AND length(decision_reason) <= 500)),
    -- TWO PEOPLE (Owner OD-F1-1 / OD-F1-4, threshold $0): an APPLIED or REJECTED correction was decided by a different Principal AND a different Employee.
    CONSTRAINT invoice_correction_two_person CHECK (
        status IN ('PENDING', 'WITHDRAWN') OR (decided_by <> requested_by AND decided_by_employee_id <> requested_by_employee_id)),
    -- Only the requester withdraws.
    CONSTRAINT invoice_correction_withdraw_by_requester CHECK (status <> 'WITHDRAWN' OR decided_by = requested_by),
    CONSTRAINT invoice_correction_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT invoice_correction_invoice_fk FOREIGN KEY (tenant_id, invoice_id, currency) REFERENCES invoices (tenant_id, id, currency),
    CONSTRAINT invoice_correction_obligation_fk FOREIGN KEY (tenant_id, obligation_id) REFERENCES obligations (tenant_id, id),
    CONSTRAINT invoice_correction_settlement_fk FOREIGN KEY (tenant_id, settlement_id) REFERENCES settlements (tenant_id, id),
    CONSTRAINT invoice_correction_application_fk FOREIGN KEY (tenant_id, application_id) REFERENCES settlement_applications (tenant_id, id),
    CONSTRAINT invoice_correction_fact_fk FOREIGN KEY (tenant_id, fact_id) REFERENCES financial_facts (tenant_id, id),
    CONSTRAINT invoice_correction_refund_settlement_fk FOREIGN KEY (tenant_id, refund_settlement_id) REFERENCES settlements (tenant_id, id)
);

-- An idempotency key names ONE request of an actor, and ONE decision of an actor.
CREATE UNIQUE INDEX invoice_corrections_request_key ON invoice_corrections (tenant_id, requested_by, request_idempotency_key);
CREATE UNIQUE INDEX invoice_corrections_decision_key ON invoice_corrections (tenant_id, decided_by, decision_idempotency_key) WHERE decided_by IS NOT NULL;
-- At most one void per invoice, pending or applied.
CREATE UNIQUE INDEX invoice_corrections_one_void ON invoice_corrections (tenant_id, invoice_id) WHERE kind = 'VOID' AND status IN ('PENDING', 'APPLIED');
CREATE INDEX invoice_corrections_by_company ON invoice_corrections (tenant_id, operating_company_id, status, requested_at);
CREATE INDEX invoice_corrections_by_invoice ON invoice_corrections (tenant_id, invoice_id);
CREATE INDEX invoice_corrections_by_settlement ON invoice_corrections (tenant_id, settlement_id) WHERE settlement_id IS NOT NULL;

-- A correction is decided once and never deleted. Its request never changes. The ONE later write: an APPLIED row records the effect it had, once, from NULL.
CREATE OR REPLACE FUNCTION refuse_invoice_correction_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CORRECTION_IMMUTABLE: an invoice correction is decided, never deleted';
    END IF;
    IF (NEW.id, NEW.tenant_id, NEW.operating_company_id, NEW.invoice_id, NEW.obligation_id, NEW.kind, NEW.amount_minor, NEW.currency, NEW.reason, NEW.settlement_id,
        NEW.application_id, NEW.requested_by, NEW.requested_by_employee_id, NEW.requested_at, NEW.request_idempotency_key, NEW.request_fingerprint)
       IS DISTINCT FROM
       (OLD.id, OLD.tenant_id, OLD.operating_company_id, OLD.invoice_id, OLD.obligation_id, OLD.kind, OLD.amount_minor, OLD.currency, OLD.reason, OLD.settlement_id,
        OLD.application_id, OLD.requested_by, OLD.requested_by_employee_id, OLD.requested_at, OLD.request_idempotency_key, OLD.request_fingerprint) THEN
        RAISE EXCEPTION 'CORRECTION_IMMUTABLE: the request of an invoice correction never changes';
    END IF;
    IF OLD.status = 'PENDING' AND NEW.status IN ('APPLIED', 'REJECTED', 'WITHDRAWN') THEN
        IF NEW.fact_id IS NOT NULL OR NEW.refund_settlement_id IS NOT NULL THEN
            RAISE EXCEPTION 'CORRECTION_IMMUTABLE: a decision records its effect only after it is applied';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status = 'APPLIED' AND NEW.status = 'APPLIED'
       AND (to_jsonb(NEW) - ARRAY['fact_id', 'refund_settlement_id']) = (to_jsonb(OLD) - ARRAY['fact_id', 'refund_settlement_id'])
       AND (OLD.fact_id IS NULL OR NEW.fact_id IS NOT DISTINCT FROM OLD.fact_id)
       AND (OLD.refund_settlement_id IS NULL OR NEW.refund_settlement_id IS NOT DISTINCT FROM OLD.refund_settlement_id) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'CORRECTION_IMMUTABLE: a decided invoice correction is never changed';
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE TRIGGER invoice_corrections_immutable BEFORE UPDATE OR DELETE ON invoice_corrections
    FOR EACH ROW EXECUTE FUNCTION refuse_invoice_correction_change();

-- F5: the Employee a correction records for a person IS that person's active Employee link at the moment: the requester's at INSERT, the decider's when the correction is APPLIED or
-- REJECTED. (A WITHDRAWN decision is the requester's own and carries the Employee recorded at request time, which a later relink may have moved, so it is not re-checked.) Without
-- this the two-person CHECK would compare whatever strings a writer supplied.
CREATE OR REPLACE FUNCTION assert_correction_employee_linked() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                        WHERE l.tenant_id = NEW.tenant_id AND l.principal_id = NEW.requested_by AND l.employee_id = NEW.requested_by_employee_id AND l.status = 'active') THEN
            RAISE EXCEPTION 'CORRECTION_EMPLOYEE_UNLINKED: the requesting Employee is not the requester''s active Employee link';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status = 'PENDING' AND NEW.status IN ('APPLIED', 'REJECTED') THEN
        IF NOT EXISTS (SELECT 1 FROM eos_policy.employee_principal_links l
                        WHERE l.tenant_id = NEW.tenant_id AND l.principal_id = NEW.decided_by AND l.employee_id = NEW.decided_by_employee_id AND l.status = 'active') THEN
            RAISE EXCEPTION 'CORRECTION_EMPLOYEE_UNLINKED: the deciding Employee is not the decider''s active Employee link';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE TRIGGER invoice_corrections_employee_linked BEFORE INSERT OR UPDATE ON invoice_corrections
    FOR EACH ROW EXECUTE FUNCTION assert_correction_employee_linked();

-- ════════════════════ 2. an adjustment fact only for an approved correction ════════════════════

CREATE OR REPLACE FUNCTION assert_adjustment_fact_is_approved() RETURNS trigger AS $$
DECLARE
    c            RECORD;
    v_kind       TEXT;
    v_originated BIGINT;
    v_settled    BIGINT;
BEGIN
    IF NEW.fact_class <> 'OBLIGATION' OR NEW.fact_type NOT IN ('RECEIVABLE_CREDITED', 'RECEIVABLE_CHARGED', 'RECEIVABLE_WRITTEN_OFF') THEN
        RETURN NEW;
    END IF;
    v_kind := CASE NEW.fact_type WHEN 'RECEIVABLE_CREDITED' THEN 'CREDIT_MEMO' WHEN 'RECEIVABLE_CHARGED' THEN 'DEBIT_CHARGE' ELSE 'WRITE_OFF' END;
    SELECT * INTO c FROM eos_finance.invoice_corrections WHERE tenant_id = NEW.tenant_id AND id = NEW.source_record_id;
    IF NOT FOUND OR c.status <> 'APPLIED' OR c.fact_id IS NOT NULL OR c.kind <> v_kind OR c.obligation_id IS DISTINCT FROM NEW.obligation_id
       OR NEW.amount_minor <> CASE WHEN v_kind = 'DEBIT_CHARGE' THEN c.amount_minor ELSE -c.amount_minor END THEN
        RAISE EXCEPTION 'ADJUSTMENT_NOT_APPROVED: a receivable is credited, charged or written off only by an APPLIED invoice correction decided by a separate Employee';
    END IF;
    -- A credit or write-off never takes the receivable below what has been settled against it (outstanding never goes negative). The receivable's row is locked HERE, so the
    -- invariant does not depend on the application's lock or on the order the BEFORE triggers fire in (F7).
    PERFORM 1 FROM eos_finance.obligations ob WHERE ob.tenant_id = NEW.tenant_id AND ob.id = NEW.obligation_id FOR UPDATE;
    SELECT COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'OBLIGATION'), 0), COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'SETTLEMENT'), 0)
      INTO v_originated, v_settled
      FROM eos_finance.financial_facts f WHERE f.tenant_id = NEW.tenant_id AND f.obligation_id = NEW.obligation_id;
    IF v_originated + NEW.amount_minor < v_settled THEN
        RAISE EXCEPTION 'ADJUSTMENT_EXCEEDS_OUTSTANDING: % + % would fall below the settled %', v_originated, NEW.amount_minor, v_settled;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE TRIGGER financial_fact_adjustment_approved BEFORE INSERT ON financial_facts
    FOR EACH ROW EXECUTE FUNCTION assert_adjustment_fact_is_approved();

-- ════════════════════ 3. origination facts of a live invoice are not reversed ════════════════════

CREATE OR REPLACE FUNCTION refuse_invoiced_origination_reversal() RETURNS trigger AS $$
BEGIN
    IF NEW.reverses_fact_id IS NOT NULL AND NEW.fact_class = 'OBLIGATION' AND NEW.obligation_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM eos_finance.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.obligation_id = NEW.obligation_id AND i.voided_at IS NULL) THEN
        RAISE EXCEPTION 'OBLIGATION_INVOICED: the facts of a receivable with a live invoice are never reversed; the invoice is corrected by a credit memo, or voided before any money moves';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE TRIGGER financial_fact_invoiced_origination BEFORE INSERT ON financial_facts
    FOR EACH ROW EXECUTE FUNCTION refuse_invoiced_origination_reversal();

-- ════════════════════ 4. the one governed way an issued invoice changes: a two-person void before money moves ════════════════════

CREATE OR REPLACE FUNCTION refuse_issued_invoice_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.obligation_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never deleted; it is corrected by a credit memo';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.obligation_id IS NOT NULL OR NEW.obligation_id IS NOT NULL THEN
        -- F-1b: the void columns, once, and nothing else; only for an APPLIED VOID correction whose deciding Principal and Employee differ from its requesting ones, and only while
        -- NOTHING has moved: no settlement application (reversed or not), no settlement fact, no applied adjustment. Not a general bypass.
        IF OLD.obligation_id IS NOT NULL AND NEW.obligation_id = OLD.obligation_id
           AND OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL AND NEW.void_reason IS NOT NULL AND NEW.voided_by IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['voided_at', 'void_reason', 'voided_by']) = (to_jsonb(OLD) - ARRAY['voided_at', 'void_reason', 'voided_by'])
           AND EXISTS (SELECT 1 FROM eos_finance.invoice_corrections c
                        WHERE c.tenant_id = OLD.tenant_id AND c.invoice_id = OLD.id AND c.kind = 'VOID' AND c.status = 'APPLIED'
                          AND c.reason = NEW.void_reason AND c.decided_by = NEW.voided_by
                          AND c.decided_by <> c.requested_by AND c.decided_by_employee_id <> c.requested_by_employee_id)
           AND NOT EXISTS (SELECT 1 FROM eos_finance.settlement_applications a WHERE a.tenant_id = OLD.tenant_id AND a.obligation_id = OLD.obligation_id)
           AND NOT EXISTS (SELECT 1 FROM eos_finance.financial_facts f WHERE f.tenant_id = OLD.tenant_id AND f.obligation_id = OLD.obligation_id AND f.fact_class = 'SETTLEMENT')
           AND NOT EXISTS (SELECT 1 FROM eos_finance.invoice_corrections x WHERE x.tenant_id = OLD.tenant_id AND x.invoice_id = OLD.id AND x.status = 'APPLIED' AND x.kind <> 'VOID') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never changed; it is corrected by a credit memo, or voided (two people, before any money moves)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

-- ════════════════════ 5. CUSTOMER_REFUND: a refund is RECORDED, never paid ════════════════════

ALTER TABLE settlements DROP CONSTRAINT settlements_kind_check;
ALTER TABLE settlements ADD CONSTRAINT settlements_kind_check
    CHECK (kind IN ('CUSTOMER_PAYMENT', 'PROVIDER_FUNDING', 'VENDOR_PAYMENT', 'INTERCOMPANY_PAYMENT', 'INTERCOMPANY_RECEIPT', 'CUSTOMER_REFUND'));
-- (settlement_direction_fits_kind is unchanged: CUSTOMER_REFUND is not a RECEIPT kind, so the ledger's direction vocabulary files it as DISBURSEMENT.)
COMMENT ON CONSTRAINT settlements_kind_check ON settlements IS
    'CUSTOMER_REFUND is an ACCOUNTING FACT: a refund was approved and recorded. It is NOT evidence that cash was sent; there is no payout provider, bank instruction or disbursement execution. Its direction value DISBURSEMENT is the ledger vocabulary, not a payment. Any future consumer of DISBURSEMENT rows must exclude CUSTOMER_REFUND.';

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
        IF OLD.kind = 'CUSTOMER_REFUND' THEN
            RAISE EXCEPTION 'SETTLEMENT_REFUND_RECORD: a recorded refund is the evidence of an approved refund; it is reconciled, never voided';
        END IF;
        IF EXISTS (SELECT 1 FROM settlement_applications a WHERE a.tenant_id = NEW.tenant_id AND a.settlement_id = NEW.id AND a.status = 'APPLIED') THEN
            RAISE EXCEPTION 'SETTLEMENT_HAS_APPLICATIONS: reverse its applications before voiding the settlement';
        END IF;
        IF EXISTS (SELECT 1 FROM invoice_corrections c WHERE c.tenant_id = NEW.tenant_id AND c.settlement_id = NEW.id AND c.kind = 'REFUND' AND c.status = 'APPLIED') THEN
            RAISE EXCEPTION 'SETTLEMENT_HAS_REFUNDS: a payment with a recorded refund is not voided';
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

CREATE OR REPLACE FUNCTION assert_settlement_application_integrity() RETURNS trigger AS $$
DECLARE
    s RECORD; o RECORD; v_applied BIGINT; v_refunded BIGINT; v_fits BOOLEAN;
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
    -- F-1b: money refunded out of this payment is no longer there to apply.
    SELECT COALESCE(SUM(amount_minor), 0) INTO v_refunded FROM invoice_corrections
     WHERE tenant_id = NEW.tenant_id AND settlement_id = NEW.settlement_id AND kind = 'REFUND' AND status = 'APPLIED';
    IF v_applied + v_refunded + NEW.amount_minor > s.amount_minor THEN
        RAISE EXCEPTION 'SETTLEMENT_OVER_APPLIED: % already applied + % refunded + % exceeds the settlement''s %', v_applied, v_refunded, NEW.amount_minor, s.amount_minor;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

-- settlement_balances: same ten columns, then refunded_minor. A payment's unapplied remainder is net of what was refunded out of it; a CUSTOMER_REFUND record applies to nothing,
-- so it is never an "unapplied" exception.
CREATE OR REPLACE VIEW settlement_balances AS
SELECT s.tenant_id, s.id AS settlement_id, s.operating_company_id, s.counterparty_id, s.kind, s.currency, s.status, s.amount_minor,
       COALESCE(SUM(a.amount_minor) FILTER (WHERE a.status = 'APPLIED'), 0)::bigint AS applied_minor,
       (CASE WHEN s.kind = 'CUSTOMER_REFUND' THEN 0
             ELSE s.amount_minor - COALESCE(SUM(a.amount_minor) FILTER (WHERE a.status = 'APPLIED'), 0) - COALESCE(MAX(rf.refunded_minor), 0)
        END)::bigint AS unapplied_minor,
       COALESCE(MAX(rf.refunded_minor), 0)::bigint AS refunded_minor
  FROM settlements s
  LEFT JOIN settlement_applications a ON a.tenant_id = s.tenant_id AND a.settlement_id = s.id
  LEFT JOIN (SELECT r.tenant_id, r.settlement_id, SUM(r.amount_minor) AS refunded_minor
               FROM invoice_corrections r WHERE r.kind = 'REFUND' AND r.status = 'APPLIED' GROUP BY r.tenant_id, r.settlement_id) rf
         ON rf.tenant_id = s.tenant_id AND rf.settlement_id = s.id
 GROUP BY s.tenant_id, s.id;

-- ════════════════════ 6. the approval capabilities ════════════════════

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_finance_adjustment_approve', 'finance.adjustment.approve',
     'Approve a credit memo, write-off or debit adjustment to an issued Invoice requested by ANOTHER Employee (threshold $0: every one needs it). Never the requester''s own; company-scoped Finance authority applies. Owner OD-F1-1 / OD-F1-4, 2026-10-20.',
     'invoice', 'approveAdjustment', 'BUSINESS_ACTION', 'Approve Invoice Adjustment'),
    ('cap_finance_refund_approve', 'finance.refund.approve',
     'Approve the RECORDING of a refund of a customer payment requested by ANOTHER Employee. Records the refund obligation and its reconciliation only: it executes no payment and authorizes no cash-out (Owner OD-F1-11).',
     'payment', 'approveRefund', 'BUSINESS_ACTION', 'Approve Refund Record'),
    ('cap_finance_invoice_void_approve', 'finance.invoice.void.approve',
     'Approve the VOID of an issued Invoice requested by ANOTHER Employee, allowed only before any settlement or adjustment is applied (Owner OD-F1-9). The number is never reused; the history and audit are kept.',
     'invoice', 'approveVoid', 'BUSINESS_ACTION', 'Approve Invoice Void')
ON CONFLICT (key) DO NOTHING;

-- ════════════════════ 7. NO GRANTS ════════════════════
-- Owner ruling 2026-10-20: "Do not infer refund/void approval merely from existing settlement authority." There is no existing policy for who approves corrections, refunds or voids
-- (FIN-007 values are undecided). This migration therefore REGISTERS the three approval capabilities and GRANTS THEM TO NOBODY: no Role holds them, no baseline row exists, and none is
-- conferred by a default catalog or by Protected Administrator standing (BUSINESS_ACTION). The 15 pairs a Finance policy might choose are a PROPOSAL FOR THE OWNER ONLY, unapplied, in
-- docs/architecture/f1b-invoice-correction-grant-proposal.json. Nothing in the application or the database can approve a correction until the Owner grants an approval key through Administration.

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_finance.invoice_corrections;
    IF v_n > 0 THEN RAISE EXCEPTION 'F1B_INVOICE_CORRECTIONS: refuses to reverse -- % invoice correction(s) are Finance history', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_finance.settlements WHERE kind = 'CUSTOMER_REFUND';
    IF v_n > 0 THEN RAISE EXCEPTION 'F1B_INVOICE_CORRECTIONS: refuses to reverse -- % recorded refund(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_finance.financial_facts WHERE fact_type IN ('RECEIVABLE_CREDITED', 'RECEIVABLE_CHARGED', 'RECEIVABLE_WRITTEN_OFF');
    IF v_n > 0 THEN RAISE EXCEPTION 'F1B_INVOICE_CORRECTIONS: refuses to reverse -- % receivable adjustment fact(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_finance.invoices WHERE voided_at IS NOT NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'F1B_INVOICE_CORRECTIONS: refuses to reverse -- % voided invoice(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions d
     WHERE d.superseded_at IS NULL AND d.capability_key IN ('finance.adjustment.approve', 'finance.refund.approve', 'finance.invoice.void.approve');
    IF v_n > 0 THEN RAISE EXCEPTION 'F1B_INVOICE_CORRECTIONS: refuses to reverse -- % Administration decision(s) name an approval capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key IN ('finance.adjustment.approve', 'finance.refund.approve', 'finance.invoice.void.approve');
    IF v_n > 0 THEN RAISE EXCEPTION 'F1B_INVOICE_CORRECTIONS: refuses to reverse -- % direct grant(s) hold an approval capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
     WHERE c.key IN ('finance.adjustment.approve', 'finance.refund.approve', 'finance.invoice.void.approve');
    IF v_n > 0 THEN RAISE EXCEPTION 'F1B_INVOICE_CORRECTIONS: refuses to reverse -- % Role grant(s) hold an approval capability (this migration grants none; the Owner did)', v_n; END IF;
END
$$;

DELETE FROM eos_policy.capabilities WHERE key IN ('finance.adjustment.approve', 'finance.refund.approve', 'finance.invoice.void.approve');

-- The view returns to its ten columns (a column list cannot shrink under CREATE OR REPLACE): drop and recreate, before the table it reads is dropped.
-- ACL check (F6): no migration in this repository issues a GRANT on settlement_balances (or any eos_finance view), so the drop / recreate loses none. If the deployed database holds an
-- ACL on it (e.g. from default privileges), the controller reads it before running this Down and re-grants after the recreate.
DROP VIEW IF EXISTS settlement_balances;
CREATE VIEW settlement_balances AS
SELECT s.tenant_id, s.id AS settlement_id, s.operating_company_id, s.counterparty_id, s.kind, s.currency, s.status, s.amount_minor,
       COALESCE(SUM(a.amount_minor) FILTER (WHERE a.status = 'APPLIED'), 0)::bigint AS applied_minor,
       (s.amount_minor - COALESCE(SUM(a.amount_minor) FILTER (WHERE a.status = 'APPLIED'), 0))::bigint AS unapplied_minor
  FROM settlements s LEFT JOIN settlement_applications a ON a.tenant_id = s.tenant_id AND a.settlement_id = s.id
 GROUP BY s.tenant_id, s.id;

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

ALTER TABLE settlements DROP CONSTRAINT settlements_kind_check;
ALTER TABLE settlements ADD CONSTRAINT settlements_kind_check
    CHECK (kind IN ('CUSTOMER_PAYMENT', 'PROVIDER_FUNDING', 'VENDOR_PAYMENT', 'INTERCOMPANY_PAYMENT', 'INTERCOMPANY_RECEIPT'));

-- Back to F-1a's immutability: an issued invoice admits NO change.
CREATE OR REPLACE FUNCTION refuse_issued_invoice_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.obligation_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never deleted; it is corrected by a credit memo';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.obligation_id IS NOT NULL OR NEW.obligation_id IS NOT NULL THEN
        RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never changed; it is corrected by a credit memo';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

DROP TRIGGER IF EXISTS financial_fact_invoiced_origination ON financial_facts;
DROP FUNCTION IF EXISTS refuse_invoiced_origination_reversal();
DROP TRIGGER IF EXISTS financial_fact_adjustment_approved ON financial_facts;
DROP FUNCTION IF EXISTS assert_adjustment_fact_is_approved();
DROP TRIGGER IF EXISTS invoice_corrections_employee_linked ON invoice_corrections;
DROP FUNCTION IF EXISTS assert_correction_employee_linked();
DROP TRIGGER IF EXISTS invoice_corrections_immutable ON invoice_corrections;
DROP TABLE IF EXISTS invoice_corrections;
DROP FUNCTION IF EXISTS refuse_invoice_correction_change();
