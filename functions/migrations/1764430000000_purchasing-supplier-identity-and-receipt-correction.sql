-- Up Migration
-- FINANCE ACTIVATION 1 COMPLETION (Controller, 2026-10-01; DECISIONS #193).
--
-- 1. PURCHASING SUPPLIER IDENTITY IS EXPLICIT. A Reorder Purchase Order identifies its supplier as EXACTLY ONE of
--      EXTERNAL_ORGANIZATION       -- a governed eos_ops.suppliers record (linked to its CRM organization for Finance), or
--      INTERNAL_OPERATING_COMPANY  -- another governed operating company of this tenant (Taylor buying from Ventana).
--    Never inferred from the supplier display text, a warehouse, a location, an email or a naming convention. The purchasing
--    company is resolved ONCE at recording (through the ACTIVE key binding) and stored beside the supplier company, so an
--    internal purchase states BUYER and SELLER explicitly -- what a later governed intercompany correlation pairs on. A company
--    cannot buy from itself. supplier_name stays (display / history; server-authored for governed POs). A PRE-EXISTING
--    text-only PO keeps all four columns NULL: legacy supplier text, never converted into counterparty truth.
--
-- 2. RECEIPT CORRECTION ORIGINATES IN OPERATIONS. "We recorded the receipt wrong" -- NOT a vendor return. One append-only
--    correction record per corrected receipt: VOID (the receipt did not happen) or CORRECTED (void + a replacement receipt,
--    committed together). The original receipt row and its lines, movements, acquisition-cost evidence and Finance facts are
--    never deleted or edited: the receipt takes the EXISTING CANCELLED status (already excluded from every received-quantity
--    derivation), stock leaves through compensating ADJUSTED movements, and the Finance consequence is reversed (and
--    replaced) by new facts. A COST_EVIDENCE_MISSING exception of a corrected receipt is resolved by an append-only
--    resolution row -- the exception itself is never edited.
--
-- 3. inventory.receipt.correct -- the narrowest authority for the correction (it removes received stock and reverses a
--    Finance consequence, which ordinary receiving does not). PostgreSQL-native (absent from PERMISSION_CATALOG, so no
--    catalog reconcile default-grants it). Granted to NOBODY: the holder is a Controller decision, applied through
--    Administration.

SET search_path = eos_ops, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_policy.capabilities
     WHERE key = 'inventory.receipt.correct' OR (object_key = 'receivingOrder' AND action_key = 'correct');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'RECEIPT_CORRECTION: the capability this migration registers already exists';
    END IF;
END
$$;

-- ════════════════════ 1. supplier identity on the Reorder Purchase Order ════════════════════

ALTER TABLE purchase_orders
    ADD COLUMN supplier_kind                   TEXT,
    ADD COLUMN supplier_id                     TEXT,
    ADD COLUMN supplier_operating_company_id   TEXT,
    ADD COLUMN purchasing_operating_company_id TEXT,
    ADD CONSTRAINT purchase_order_supplier_kind_known
        CHECK (supplier_kind IS NULL OR supplier_kind IN ('EXTERNAL_ORGANIZATION', 'INTERNAL_OPERATING_COMPANY')),
    -- Exactly one backing identity per kind; legacy text-only = all four NULL. The self-purchase refusal is structural.
    ADD CONSTRAINT purchase_order_supplier_identity CHECK (
        (supplier_kind IS NULL AND supplier_id IS NULL AND supplier_operating_company_id IS NULL AND purchasing_operating_company_id IS NULL)
        OR (supplier_kind = 'EXTERNAL_ORGANIZATION' AND supplier_id IS NOT NULL AND supplier_operating_company_id IS NULL
            AND purchasing_operating_company_id IS NOT NULL)
        OR (supplier_kind = 'INTERNAL_OPERATING_COMPANY' AND supplier_id IS NULL AND supplier_operating_company_id IS NOT NULL
            AND purchasing_operating_company_id IS NOT NULL AND supplier_operating_company_id <> purchasing_operating_company_id)),
    ADD CONSTRAINT purchase_order_supplier_fk FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, supplier_id),
    ADD CONSTRAINT purchase_order_supplier_company_fk FOREIGN KEY (tenant_id, supplier_operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    ADD CONSTRAINT purchase_order_purchasing_company_fk FOREIGN KEY (tenant_id, purchasing_operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id);

CREATE INDEX purchase_orders_by_supplier_id ON purchase_orders (tenant_id, supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX purchase_orders_intercompany
    ON purchase_orders (tenant_id, purchasing_operating_company_id, supplier_operating_company_id)
    WHERE supplier_kind = 'INTERNAL_OPERATING_COMPANY';

-- ════════════════════ 2. the receipt correction record ════════════════════

CREATE TABLE receiving_corrections (
    id                              TEXT PRIMARY KEY,
    tenant_id                       TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    receiving_order_id              TEXT NOT NULL REFERENCES receiving_orders(id),
    correction_kind                 TEXT NOT NULL CHECK (correction_kind IN ('VOID', 'CORRECTED')),
    replacement_receiving_order_id  TEXT REFERENCES receiving_orders(id),
    -- Copied from the corrected receipt; a correction never moves ownership.
    operating_company_key           TEXT NOT NULL,
    reason                          TEXT NOT NULL CHECK (btrim(reason) <> ''),
    idempotency_key                 TEXT NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_fingerprint             TEXT NOT NULL,
    compensating_movement_ids       TEXT[] NOT NULL,
    reversed_fact_ids               TEXT[] NOT NULL DEFAULT '{}',
    resolved_exception_ids          TEXT[] NOT NULL DEFAULT '{}',
    corrected_by                    TEXT NOT NULL CHECK (btrim(corrected_by) <> ''),
    corrected_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A receipt is corrected at most once; its replacement is itself a receipt and may be corrected in turn.
    CONSTRAINT receiving_correction_one_per_receipt UNIQUE (tenant_id, receiving_order_id),
    CONSTRAINT receiving_correction_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT receiving_correction_replacement_matches_kind
        CHECK ((correction_kind = 'CORRECTED') = (replacement_receiving_order_id IS NOT NULL)),
    CONSTRAINT receiving_correction_not_self
        CHECK (replacement_receiving_order_id IS NULL OR replacement_receiving_order_id <> receiving_order_id)
);

CREATE INDEX receiving_corrections_by_replacement ON receiving_corrections (tenant_id, replacement_receiving_order_id)
    WHERE replacement_receiving_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION refuse_receiving_correction_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = eos_ops, public AS $$
BEGIN
    RAISE EXCEPTION 'RECEIVING_CORRECTION_IMMUTABLE: a receipt correction is append-only';
END;
$$;

CREATE TRIGGER receiving_corrections_append_only BEFORE UPDATE OR DELETE ON receiving_corrections
    FOR EACH ROW EXECUTE FUNCTION refuse_receiving_correction_mutation();

-- ════════════════════ 3. missing-cost exception resolution ════════════════════

CREATE TABLE eos_finance.cost_evidence_exception_resolutions (
    exception_id             TEXT PRIMARY KEY REFERENCES eos_finance.cost_evidence_exceptions(id),
    tenant_id                TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- Only the resolutions an existing governed business path produces. A later-established price has no governed path yet
    -- (the Purchase Order is immutable and has no price amendment), so it is deliberately not a value here.
    resolution               TEXT NOT NULL CHECK (resolution IN ('RECEIPT_VOIDED', 'RECEIPT_CORRECTED')),
    -- DEFERRED: the resolution and the correction record that names it are written in one transaction, and the correction
    -- row (immutable once written) lists the exceptions it resolved.
    receiving_correction_id  TEXT NOT NULL REFERENCES eos_ops.receiving_corrections(id) DEFERRABLE INITIALLY DEFERRED,
    reason                   TEXT NOT NULL CHECK (btrim(reason) <> ''),
    resolved_by              TEXT NOT NULL CHECK (btrim(resolved_by) <> ''),
    resolved_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER cost_evidence_exception_resolutions_append_only BEFORE UPDATE OR DELETE ON eos_finance.cost_evidence_exception_resolutions
    FOR EACH ROW EXECUTE FUNCTION eos_finance.refuse_financial_fact_mutation();

-- ════════════════════ 4. the correction authority (granted to nobody) ════════════════════

INSERT INTO eos_policy.capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_receipt_correct', 'inventory.receipt.correct',
     'Correct an erroneously recorded receipt: VOID it, or replace it with a CORRECTED receipt. Removes the received stock through compensating movements and reverses (and replaces) its Finance consequence; the original receipt, movements, cost evidence and facts are preserved. Not a vendor return. Requires WAREHOUSE scope over the receipt location. Granted only through Administration.',
     'receivingOrder', 'correct', 'BUSINESS_ACTION', 'Correct Receipt')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
SET search_path = eos_ops, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM receiving_corrections;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'RECEIPT_CORRECTION: refuses to reverse -- % receipt correction(s) are operational history', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM purchase_orders WHERE supplier_kind IS NOT NULL;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'RECEIPT_CORRECTION: refuses to reverse -- % purchase order(s) carry governed supplier identity', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities WHERE capability_id = 'cap_inventory_receipt_correct';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'RECEIPT_CORRECTION: refuses to reverse -- % Role grant(s) name inventory.receipt.correct', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities WHERE capability_id = 'cap_inventory_receipt_correct';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'RECEIPT_CORRECTION: refuses to reverse -- % direct grant(s) name inventory.receipt.correct', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key = 'inventory.receipt.correct';
        IF v_n > 0 THEN
            RAISE EXCEPTION 'RECEIPT_CORRECTION: refuses to reverse -- % Administration decision(s) name inventory.receipt.correct', v_n;
        END IF;
    END IF;
END
$$;

DELETE FROM eos_policy.capabilities WHERE id = 'cap_inventory_receipt_correct';
DROP TABLE IF EXISTS eos_finance.cost_evidence_exception_resolutions;
DROP TABLE IF EXISTS receiving_corrections;
DROP FUNCTION IF EXISTS refuse_receiving_correction_mutation();
DROP INDEX IF EXISTS purchase_orders_intercompany;
DROP INDEX IF EXISTS purchase_orders_by_supplier_id;
ALTER TABLE purchase_orders
    DROP CONSTRAINT IF EXISTS purchase_order_purchasing_company_fk,
    DROP CONSTRAINT IF EXISTS purchase_order_supplier_company_fk,
    DROP CONSTRAINT IF EXISTS purchase_order_supplier_fk,
    DROP CONSTRAINT IF EXISTS purchase_order_supplier_identity,
    DROP CONSTRAINT IF EXISTS purchase_order_supplier_kind_known,
    DROP COLUMN IF EXISTS purchasing_operating_company_id,
    DROP COLUMN IF EXISTS supplier_operating_company_id,
    DROP COLUMN IF EXISTS supplier_id,
    DROP COLUMN IF EXISTS supplier_kind;
