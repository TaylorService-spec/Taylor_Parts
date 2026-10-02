-- Up Migration
-- COMMERCIAL FINANCE ACTIVATION -- DQ-015 + FULFILLMENT -> BILLING ELIGIBILITY (Controller, 2026-10-02; DECISIONS #195).
--
-- 1. THE COMMERCIAL FULFILLMENT RECORD. Commercial owns Commercial fulfillment state. A row is governed EVIDENCE that a
--    quantity of ONE Sales Order line was fulfilled, by ONE operational source (today: a Work Order completion), and it is
--    written ONLY by the server-side Commercial fulfillment authority that Work Order completion composes in its own
--    transaction (eosCommercial/fulfillment/salesOrderFulfillmentAuthority.ts) -- never by a client, never by the
--    technician's own authority. APPEND-ONLY; a line's fulfilled quantity is the SUM of its rows (the receiving pattern),
--    never a counter on the Sales Order line. One row per (source Work Order, Sales Order line): a replay cannot duplicate.
--    The operational evidence is REFERENCED, never copied or re-performed: the Part usage records, the equipment
--    installation (with its serial identity and ledger movement) and the Work Order completion stay the Work Order /
--    Inventory / Equipment authorities' facts. No FK into eos_ops (separate authorities; ids are opaque references).
--
-- 2. BILLING ELIGIBILITY IS DERIVED, NOT STORED. `sales_order_line_billing_eligibility` answers "is this commercial value
--    ready to enter the future billing package?" from governed facts alone, with the Owner-ratified states of
--    fulfillment/billingEligibility.ts (NOT_YET / PARTIALLY_ELIGIBLE / ELIGIBLE / CANCELLED). There is no table and no
--    writer, so no client can declare anything billable. It is NOT an invoice, NOT receivable, NOT revenue, NOT a posting
--    and computes NO amount: it carries the line's accepted commercial price as a SOURCE reference only. The commercial
--    customer is the Sales Order's account; the FINANCIAL OBLIGOR is deliberately unresolved here (a financed / Saratoga
--    sale's obligor is not the customer) and is decided by the future billing package. Rental never enters this model.

SET search_path = eos_commercial, public;

CREATE TABLE sales_order_fulfillments (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    sales_order_id          TEXT NOT NULL,
    line_number             INTEGER NOT NULL CHECK (line_number > 0),
    -- The line's identity AS FULFILLED, frozen with the evidence (the line itself is immutable today).
    line_kind               eos_commercial.commercial_line_kind NOT NULL,
    line_ref                TEXT NOT NULL CHECK (btrim(line_ref) <> ''),
    quantity                INTEGER NOT NULL CHECK (quantity > 0),
    source_kind             TEXT NOT NULL CHECK (source_kind IN ('WORK_ORDER_COMPLETION')),
    source_work_order_id    TEXT NOT NULL CHECK (btrim(source_work_order_id) <> ''),
    -- What proves it: PART_USAGE (the Work Order's recorded actuals), EQUIPMENT_INSTALLATION (the installed units),
    -- SERVICE_PERFORMED (the completed Work Order the SERVICE line was linked to).
    evidence_kind           TEXT NOT NULL CHECK (evidence_kind IN ('PART_USAGE', 'EQUIPMENT_INSTALLATION', 'SERVICE_PERFORMED')),
    evidence_record_ids     TEXT[] NOT NULL DEFAULT '{}',
    equipment_ids           TEXT[] NOT NULL DEFAULT '{}',
    serial_numbers          TEXT[] NOT NULL DEFAULT '{}',
    -- Ownership is the Sales Order's governed company, resolved once (never the site, never CONSOLIDATED).
    operating_company_key   TEXT NOT NULL,
    operating_company_id    TEXT NOT NULL CHECK (operating_company_id ~ '^[a-z][a-z0-9_-]{1,62}$' AND operating_company_id <> 'consolidated'),
    account_id              TEXT NOT NULL,
    location_id             TEXT,
    fulfilled_at            TIMESTAMPTZ NOT NULL,
    recorded_by             TEXT NOT NULL CHECK (btrim(recorded_by) <> ''),
    recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sales_order_fulfillment_line_fk FOREIGN KEY (tenant_id, sales_order_id, line_number)
        REFERENCES sales_order_lines (tenant_id, sales_order_id, line_number),
    CONSTRAINT sales_order_fulfillment_once_per_source UNIQUE (tenant_id, source_work_order_id, sales_order_id, line_number),
    CONSTRAINT sales_order_fulfillment_equipment_shape CHECK (
        (evidence_kind = 'EQUIPMENT_INSTALLATION') = (cardinality(equipment_ids) > 0)
        AND cardinality(equipment_ids) IN (0, quantity) AND cardinality(serial_numbers) = cardinality(equipment_ids))
);

CREATE INDEX sales_order_fulfillments_by_order ON sales_order_fulfillments (tenant_id, sales_order_id, line_number);
CREATE INDEX sales_order_fulfillments_by_work_order ON sales_order_fulfillments (tenant_id, source_work_order_id);

CREATE OR REPLACE FUNCTION refuse_sales_order_fulfillment_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_commercial, public AS $$
BEGIN
    RAISE EXCEPTION 'SALES_ORDER_FULFILLMENT_IMMUTABLE: fulfillment evidence is append-only';
END;
$$;

CREATE TRIGGER sales_order_fulfillments_append_only BEFORE UPDATE OR DELETE ON sales_order_fulfillments
    FOR EACH ROW EXECUTE FUNCTION refuse_sales_order_fulfillment_mutation();

-- Per-line fulfilled quantity, DERIVED.
CREATE VIEW sales_order_line_fulfillment AS
SELECT l.tenant_id, l.sales_order_id, l.line_number, l.kind, l.ref, l.business_unit, l.ordered_qty, l.unit_price_minor,
       COALESCE(f.fulfilled_qty, 0)::int AS fulfilled_qty,
       GREATEST(l.ordered_qty - COALESCE(f.fulfilled_qty, 0), 0)::int AS remaining_qty,
       f.last_fulfilled_at, COALESCE(f.sources, '{}') AS source_work_order_ids
  FROM sales_order_lines l
  LEFT JOIN (SELECT tenant_id, sales_order_id, line_number, SUM(quantity) AS fulfilled_qty, MAX(fulfilled_at) AS last_fulfilled_at,
                    array_agg(DISTINCT source_work_order_id ORDER BY source_work_order_id) AS sources
               FROM sales_order_fulfillments GROUP BY tenant_id, sales_order_id, line_number) f
    ON f.tenant_id = l.tenant_id AND f.sales_order_id = l.sales_order_id AND f.line_number = l.line_number;

-- Billing eligibility per line, DERIVED, explainable, with its provenance.
CREATE VIEW sales_order_line_billing_eligibility AS
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

-- Down Migration
SET search_path = eos_commercial, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM sales_order_fulfillments;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'COMMERCIAL_FULFILLMENT: refuses to reverse -- % fulfillment record(s) are Commercial history', v_n;
    END IF;
END
$$;

DROP VIEW IF EXISTS sales_order_line_billing_eligibility;
DROP VIEW IF EXISTS sales_order_line_fulfillment;
DROP TABLE IF EXISTS sales_order_fulfillments;
DROP FUNCTION IF EXISTS refuse_sales_order_fulfillment_mutation();
