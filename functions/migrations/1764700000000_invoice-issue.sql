-- Up Migration
-- F-1a: ISSUE AN INVOICE ON EOS (DECISIONS #F-1a; spec docs/architecture/f1-invoicing-spec.md; Owner "invoicing: Build it now").
--
-- Slot 1764700000000 (lane F range). No capability, grant or data: finance.invoice.issue was registered and granted by 1761609600000 and is not touched.
-- The tables below already exist and are EMPTY (migration 1758931200000 landed them unwired); this migration wires them to the receivable.
--
--   1. eos_finance.invoice_number_counters   the INV-YYYY-###### counter, exactly the DDL of eosFinance/invoiceNumberAllocator.ts. One row per
--                                            (tenant, operating-company key, UTC year); last_value is plain data, so a historical series can be SEEDED
--                                            later (continuity with Firebase INV-###### numbers is not prevented by this design).
--   2. eos_finance.invoices                  1:1 with a receivable obligation and a billing package; the package's order-level components (customer
--                                            discount, shipping, install, tax, trade-in credit) frozen on the header; the idempotency record; the due
--                                            date's basis and reason; `accounting_reference` beside the number (the provider's document reference).
--   3. eos_finance.invoice_totals            replaced (same 14 columns, same types) so total = lines - discount + shipping + install + tax, and a new
--                                            amount_due_minor = total - trade-in credit, which is what the receivable originates.
--   4. a deferred constraint trigger         the database refuses an invoice whose receivable is not the package's, or whose amount due differs from
--                                            the receivable's originated amount.
--   5. obligations.due_on                    may be SET ONCE, from NULL, on a package receivable (so aging begins at the invoice's due date); never changed.

SET search_path = eos_finance, public;

CREATE TABLE invoice_number_counters (
    tenant_id             TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_key TEXT        NOT NULL,
    year                  INTEGER     NOT NULL,
    last_value            BIGINT      NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, operating_company_key, year),
    CONSTRAINT invoice_number_counter_key_present CHECK (length(btrim(operating_company_key)) > 0),
    CONSTRAINT invoice_number_counter_year_range  CHECK (year BETWEEN 1970 AND 9999),
    CONSTRAINT invoice_number_counter_positive    CHECK (last_value >= 1)
);

ALTER TABLE invoices
    ADD COLUMN obligation_id           TEXT REFERENCES obligations(id),
    ADD COLUMN billing_package_id      TEXT REFERENCES billing_packages(id),
    ADD COLUMN accounting_reference    TEXT,
    ADD COLUMN customer_discount_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN shipping_minor          BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN install_charge_minor    BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN package_tax_minor       BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN trade_in_minor          BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN due_basis               TEXT,
    ADD COLUMN due_reason              TEXT,
    ADD COLUMN idempotency_key         TEXT,
    ADD COLUMN request_fingerprint     TEXT;

ALTER TABLE invoices
    ADD CONSTRAINT invoice_header_amounts_nonneg CHECK (customer_discount_minor >= 0 AND shipping_minor >= 0 AND install_charge_minor >= 0
                                                        AND package_tax_minor >= 0 AND trade_in_minor >= 0),
    ADD CONSTRAINT invoice_due_basis_known CHECK (due_basis IS NULL OR due_basis IN ('TERMS', 'TERMS_EXTENDED', 'NO_TERMS_ENTERED')),
    -- A due date other than the customer's governed terms carries its reason (OD-F1-8).
    ADD CONSTRAINT invoice_due_reason_when_not_terms CHECK (due_basis IS NULL OR due_basis = 'TERMS' OR (due_reason IS NOT NULL AND btrim(due_reason) <> '')),
    ADD CONSTRAINT invoice_due_reason_length CHECK (due_reason IS NULL OR length(due_reason) <= 500),
    -- An EOS-issued invoice has all of its issuance facts; a row from the pre-F-1a shape has none of them.
    ADD CONSTRAINT invoice_issuance_is_complete CHECK (
        (obligation_id IS NULL) = (billing_package_id IS NULL)
        AND (obligation_id IS NULL) = (due_basis IS NULL)
        AND (obligation_id IS NULL) = (idempotency_key IS NULL)
        AND (obligation_id IS NULL) = (request_fingerprint IS NULL));

-- ONE invoice per receivable and per package (OD-F1-2, OD-F1-6); an issuing command is named by (actor, key).
CREATE UNIQUE INDEX invoices_one_per_obligation ON invoices (tenant_id, obligation_id) WHERE obligation_id IS NOT NULL;
CREATE UNIQUE INDEX invoices_one_per_package   ON invoices (tenant_id, billing_package_id) WHERE billing_package_id IS NOT NULL;
CREATE UNIQUE INDEX invoices_idempotency       ON invoices (tenant_id, issued_by, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- The ONE definition of an invoice total, now including the package's order-level components (zero for a pre-F-1a row, so its figures are unchanged).
-- Same first 14 columns and types as 1758931200000; four columns appended.
CREATE OR REPLACE VIEW invoice_totals AS
SELECT
    i.id                                            AS invoice_id,
    i.tenant_id                                     AS tenant_id,
    i.operating_company_key                         AS operating_company_key,
    i.account_id                                    AS account_id,
    i.sales_order_id                                AS sales_order_id,
    i.currency                                      AS currency,
    i.due_date                                      AS due_date,
    (i.voided_at IS NOT NULL)                       AS is_void,
    count(l.id)                                     AS line_count,
    COALESCE(sum(l.subtotal_minor),     0)::BIGINT  AS subtotal_minor,
    (COALESCE(sum(l.discount_minor),    0) + i.customer_discount_minor)::BIGINT AS discount_minor,
    (COALESCE(sum(l.taxable_base_minor), 0) - i.customer_discount_minor)::BIGINT AS taxable_base_minor,
    (COALESCE(sum(l.tax_minor),         0) + i.package_tax_minor)::BIGINT AS tax_minor,
    (COALESCE(sum(l.line_total_minor),  0) - i.customer_discount_minor + i.shipping_minor + i.install_charge_minor + i.package_tax_minor)::BIGINT AS total_minor,
    i.shipping_minor                                AS shipping_minor,
    i.install_charge_minor                          AS install_charge_minor,
    i.trade_in_minor                                AS trade_in_minor,
    (COALESCE(sum(l.line_total_minor),  0) - i.customer_discount_minor + i.shipping_minor + i.install_charge_minor + i.package_tax_minor
        - i.trade_in_minor)::BIGINT                 AS amount_due_minor
FROM invoices i
LEFT JOIN invoice_lines l
       ON l.invoice_id = i.id
      AND l.tenant_id  = i.tenant_id
GROUP BY i.id;

-- The database refuses an invoice that is not the package receivable's document. Deferred to commit, because the lines are inserted after the header.
CREATE OR REPLACE FUNCTION assert_invoice_matches_obligation() RETURNS trigger AS $$
DECLARE
    v_kind       TEXT;
    v_currency   TEXT;
    v_originated BIGINT;
    v_package_ok BOOLEAN;
    v_due        BIGINT;
BEGIN
    IF NEW.obligation_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT o.kind, o.currency, b.originated_minor, (p.id IS NOT NULL)
      INTO v_kind, v_currency, v_originated, v_package_ok
      FROM eos_finance.obligations o
      JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
      LEFT JOIN eos_finance.billing_packages p
             ON p.tenant_id = o.tenant_id AND p.id = o.source_record_id AND o.source_domain = 'BILLING_PACKAGE'
            AND p.id = NEW.billing_package_id AND p.operating_company_key = NEW.operating_company_key
     WHERE o.tenant_id = NEW.tenant_id AND o.id = NEW.obligation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_OBLIGATION_MISMATCH: the invoice names no receivable of this tenant';
    END IF;
    SELECT t.amount_due_minor INTO v_due FROM eos_finance.invoice_totals t WHERE t.tenant_id = NEW.tenant_id AND t.invoice_id = NEW.id;
    IF v_kind <> 'RECEIVABLE' OR v_currency <> NEW.currency OR v_package_ok IS NOT TRUE OR v_due IS DISTINCT FROM v_originated THEN
        RAISE EXCEPTION 'INVOICE_OBLIGATION_MISMATCH: an invoice is the document of exactly one receivable: same package, company, currency and amount due';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE CONSTRAINT TRIGGER invoice_matches_obligation AFTER INSERT ON invoices
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_invoice_matches_obligation();

-- An obligation's due date is part of its identity once set (1764490000000). It may still be SET, once, from NULL, on a Sales Order package receivable:
-- the invoice's due date starts aging. Nothing else about the identity changes, and a set date never changes or clears.
CREATE OR REPLACE FUNCTION refuse_obligation_identity_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'OBLIGATION_IMMUTABLE: an obligation is voided by status and reversing facts, never deleted';
    END IF;
    IF (NEW.tenant_id, NEW.operating_company_id, NEW.counterparty_id, NEW.kind, NEW.currency, NEW.source_domain, NEW.source_record_id, NEW.idempotency_key)
       IS DISTINCT FROM (OLD.tenant_id, OLD.operating_company_id, OLD.counterparty_id, OLD.kind, OLD.currency, OLD.source_domain, OLD.source_record_id, OLD.idempotency_key) THEN
        RAISE EXCEPTION 'OBLIGATION_IMMUTABLE: only an obligation''s status may change';
    END IF;
    IF NEW.due_on IS DISTINCT FROM OLD.due_on
       AND NOT (OLD.due_on IS NULL AND NEW.due_on IS NOT NULL AND NEW.kind = 'RECEIVABLE' AND NEW.source_domain = 'BILLING_PACKAGE') THEN
        RAISE EXCEPTION 'OBLIGATION_IMMUTABLE: only an obligation''s status may change';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_finance.invoices WHERE obligation_id IS NOT NULL;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'F-1a INVOICE ISSUE: refuses to reverse -- % issued invoice(s) are Finance history', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM eos_finance.invoice_number_counters;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'F-1a INVOICE ISSUE: refuses to reverse -- % invoice number counter row(s) exist', v_n;
    END IF;
END
$$;

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

DROP TRIGGER IF EXISTS invoice_matches_obligation ON invoices;
DROP FUNCTION IF EXISTS assert_invoice_matches_obligation();

-- The view returns to its 14 columns: drop and recreate (a column list cannot shrink under CREATE OR REPLACE).
DROP VIEW IF EXISTS invoice_totals;
CREATE VIEW invoice_totals AS
SELECT
    i.id                                            AS invoice_id,
    i.tenant_id                                     AS tenant_id,
    i.operating_company_key                         AS operating_company_key,
    i.account_id                                    AS account_id,
    i.sales_order_id                                AS sales_order_id,
    i.currency                                      AS currency,
    i.due_date                                      AS due_date,
    (i.voided_at IS NOT NULL)                       AS is_void,
    count(l.id)                                     AS line_count,
    COALESCE(sum(l.subtotal_minor),     0)::BIGINT  AS subtotal_minor,
    COALESCE(sum(l.discount_minor),     0)::BIGINT  AS discount_minor,
    COALESCE(sum(l.taxable_base_minor), 0)::BIGINT  AS taxable_base_minor,
    COALESCE(sum(l.tax_minor),          0)::BIGINT  AS tax_minor,
    COALESCE(sum(l.line_total_minor),   0)::BIGINT  AS total_minor
FROM invoices i
LEFT JOIN invoice_lines l
       ON l.invoice_id = i.id
      AND l.tenant_id  = i.tenant_id
GROUP BY i.id;

DROP INDEX IF EXISTS invoices_idempotency;
DROP INDEX IF EXISTS invoices_one_per_package;
DROP INDEX IF EXISTS invoices_one_per_obligation;

ALTER TABLE invoices
    DROP CONSTRAINT IF EXISTS invoice_issuance_is_complete,
    DROP CONSTRAINT IF EXISTS invoice_due_reason_length,
    DROP CONSTRAINT IF EXISTS invoice_due_reason_when_not_terms,
    DROP CONSTRAINT IF EXISTS invoice_due_basis_known,
    DROP CONSTRAINT IF EXISTS invoice_header_amounts_nonneg;

ALTER TABLE invoices
    DROP COLUMN IF EXISTS request_fingerprint,
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS due_reason,
    DROP COLUMN IF EXISTS due_basis,
    DROP COLUMN IF EXISTS trade_in_minor,
    DROP COLUMN IF EXISTS package_tax_minor,
    DROP COLUMN IF EXISTS install_charge_minor,
    DROP COLUMN IF EXISTS shipping_minor,
    DROP COLUMN IF EXISTS customer_discount_minor,
    DROP COLUMN IF EXISTS accounting_reference,
    DROP COLUMN IF EXISTS billing_package_id,
    DROP COLUMN IF EXISTS obligation_id;

DROP TABLE IF EXISTS invoice_number_counters;
