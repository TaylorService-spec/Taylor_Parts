-- Up Migration
-- P-1 GOVERNED SUPPLIER PURCHASE ORDER AUTHORING (Owner direction 2026-10-19; resolves OD-B3-1), nonprod.
--
-- OWNER RULINGS (2026-10-19, in chat), in force here:
--   A  "Linked + closes them": requests on a supplier PO move to ORDERED; receiving the PO closes them; a request is on at most ONE active PO of EITHER kind.
--   B  "one line each": one PO per (operating company, supplier, receiving warehouse), one line per source request.
--   D  capabilities and holders: "Create + send: Parts Associate and Purchasing Manager. Approve: Parts Manager and Owner, general manager and admins.
--      Cancel: Parts Manager, general manager, owner. Admin has all." Read: holders of any of the four plus reorder.purchaseOrder.read holders.
--   E  optional per-line price: nullable unit_price_minor + currency with the price-pair check; NULL is unknown, never zero.
--
-- WHAT THIS CHANGES (and nothing else):
--   1. supplier_purchase_orders gains the receiving warehouse and the approve / send / cancel stamps.
--   2. supplier_purchase_order_lines gain source_request_id (FK reorder_requests), the optional price, link_released_at, and the ACTIVE-LINK
--      unique index: a request is on at most one live supplier PO line. (The other half -- no supplier-PO link on a request that already has a
--      reorder purchase_orders row -- is decided by the commands, in the same transaction, under the request's row lock.)
--   3. supplier_po_number_counters (SPO-YYYY-######, gap-safe: allocated inside the create transaction) and the unique index on the allocated numbers.
--   4. supplier_po_commands: the idempotency record (key -> fingerprint + stored result) so a replay writes nothing.
--   5. Five capabilities REGISTERED and 27 role grants (GRANT-BEARING, Owner ruling E: roleCapabilityAuthorityBaseline.json carries the same 27 pairs).
--
-- FIXTURE ROWS (loadSupplierPoFixture.js, tests) are untouched: every new column is nullable, and the uniqueness / format rules apply only to
-- numbers allocated by this authority (the SPO- series) and to lines that name a source request.
--
-- Authored by the P-1 lane as a draft; reviewed and written into the repository by the controller under the Owner's 2026-10-19 authorization
-- (agents cannot write migrations directly -- the B4 pattern).

SET search_path = eos_ops, public;

ALTER TABLE supplier_purchase_orders
    ADD COLUMN receiving_warehouse_id TEXT,
    ADD COLUMN approved_by            TEXT,
    ADD COLUMN approved_at            TIMESTAMPTZ,
    ADD COLUMN sent_by                TEXT,
    ADD COLUMN sent_at                TIMESTAMPTZ,
    ADD COLUMN cancelled_by           TEXT,
    ADD COLUMN cancelled_at           TIMESTAMPTZ,
    ADD COLUMN cancellation_reason    TEXT,
    ADD CONSTRAINT supplier_purchase_order_warehouse_stated CHECK (receiving_warehouse_id IS NULL OR btrim(receiving_warehouse_id) <> ''),
    ADD CONSTRAINT supplier_purchase_order_cancel_stated CHECK (
        (cancelled_at IS NULL) = (cancelled_by IS NULL) AND (cancelled_at IS NULL) = (cancellation_reason IS NULL)
        AND (cancellation_reason IS NULL OR btrim(cancellation_reason) <> '')),
    -- Any number in the SPO- series is an allocated number: the exact format, nothing hand-typed.
    ADD CONSTRAINT supplier_purchase_order_spo_number_format CHECK (
        external_po_number IS NULL OR external_po_number NOT LIKE 'SPO-%' OR external_po_number ~ '^SPO-[0-9]{4}-[0-9]{6,}$');

-- Unique PER TENANT, and only over the allocated series (fixtures and migrated orders may carry any text, and may repeat it).
CREATE UNIQUE INDEX supplier_purchase_orders_spo_number_unique
    ON supplier_purchase_orders (tenant_id, external_po_number)
    WHERE external_po_number LIKE 'SPO-%';

ALTER TABLE supplier_purchase_order_lines
    ADD COLUMN source_request_id TEXT REFERENCES reorder_requests (id),
    ADD COLUMN unit_price_minor  BIGINT,
    ADD COLUMN currency          TEXT,
    ADD COLUMN link_released_at  TIMESTAMPTZ,
    -- FIN-BLOCK-003A, exactly as purchase_orders: integer minor units, no floating-point money; NULL is UNKNOWN and NEVER zero.
    ADD CONSTRAINT supplier_purchase_order_line_price_pairs CHECK ((unit_price_minor IS NULL) = (currency IS NULL)),
    ADD CONSTRAINT supplier_purchase_order_line_price_nonneg CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
    ADD CONSTRAINT supplier_purchase_order_line_currency_shape CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT supplier_purchase_order_line_release_needs_source CHECK (link_released_at IS NULL OR source_request_id IS NOT NULL);

-- A request is on at most ONE active supplier-PO line. A cancelled PO releases its lines (link_released_at), so the request may be ordered again.
CREATE UNIQUE INDEX supplier_purchase_order_lines_one_active_request
    ON supplier_purchase_order_lines (tenant_id, source_request_id)
    WHERE source_request_id IS NOT NULL AND link_released_at IS NULL;

CREATE INDEX supplier_purchase_order_lines_by_request
    ON supplier_purchase_order_lines (tenant_id, source_request_id) WHERE source_request_id IS NOT NULL;

-- The supplier PO's own number counter (the receiving_number_counters pattern): per tenant per UTC year, allocated inside the create transaction.
CREATE TABLE supplier_po_number_counters (
    tenant_id  TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    year       INTEGER     NOT NULL CHECK (year BETWEEN 1970 AND 9999),
    last_value BIGINT      NOT NULL CHECK (last_value > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, year)
);

COMMENT ON TABLE supplier_po_number_counters IS
    'SPO-YYYY-###### allocation for supplier purchase orders, per tenant per UTC year. Independent of the PO id, of RR / RO / WO numbering and of eos_commercial.number_counters. Allocated inside the create transaction only, never on replay; a rolled-back create consumes no number.';

-- The idempotency record of the authoring commands: the same key with the same request replays the stored result and writes nothing; the same
-- key with a different request is refused. Keyed PER ACTOR, as the Reorder create is.
CREATE TABLE supplier_po_commands (
    tenant_id            TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    actor_principal_id   TEXT        NOT NULL,
    idempotency_key      TEXT        NOT NULL,
    command              TEXT        NOT NULL,
    purchase_order_id    TEXT        NOT NULL,
    request_fingerprint  TEXT        NOT NULL,
    result               JSONB       NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, actor_principal_id, idempotency_key),
    CONSTRAINT supplier_po_command_known CHECK (command IN ('CREATE', 'APPROVE', 'SEND', 'CANCEL')),
    CONSTRAINT supplier_po_command_key_stated CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200),
    CONSTRAINT supplier_po_command_order FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES supplier_purchase_orders (tenant_id, id)
);

-- ============================ capabilities and grants ============================
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_supplier_po_create', 'supplier.purchaseOrder.create',
     'Raise a DRAFT supplier purchase order from the caller''s own PURCHASING_IN_PROGRESS Reorder Requests, for one supplier and one receiving warehouse of one operating company. Authors the order and moves its requests to ORDERED; confers no approval, no send, no receiving and no stock authority.',
     'purchaseOrder', 'createSupplierOrder', 'CREATE', 'Raise Supplier Purchase Order'),
    ('cap_supplier_po_approve', 'supplier.purchaseOrder.approve',
     'Approve a DRAFT supplier purchase order. Never the order''s own creator (segregation of duties).',
     'purchaseOrder', 'approveSupplierOrder', 'BUSINESS_ACTION', 'Approve Supplier Purchase Order'),
    ('cap_supplier_po_send', 'supplier.purchaseOrder.send',
     'Mark an APPROVED supplier purchase order as sent to the supplier.',
     'purchaseOrder', 'sendSupplierOrder', 'BUSINESS_ACTION', 'Send Supplier Purchase Order'),
    ('cap_supplier_po_cancel', 'supplier.purchaseOrder.cancel',
     'Cancel a supplier purchase order that has received nothing; its requests return to purchasing.',
     'purchaseOrder', 'cancelSupplierOrder', 'BUSINESS_ACTION', 'Cancel Supplier Purchase Order'),
    ('cap_supplier_po_read', 'supplier.purchaseOrder.read',
     'List and read supplier purchase orders of the caller''s operating companies in every status.',
     'purchaseOrder', 'readSupplierOrder', 'READ', 'Read Supplier Purchase Orders')
ON CONFLICT (key) DO NOTHING;

-- 27 grants: create 3 + send 3 + approve 4 + cancel 4 + read 13. The protected Roles (admin, owner) are matched only as the protected rows;
-- an Administration ADMIN_REVOKED decision is honoured (never re-granted), as in every grant migration since B1.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_p1_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764660000000', now(), 'migration:1764660000000', now(), 'migration:1764660000000', now()
  FROM capabilities c
  JOIN (VALUES
        -- create + send: Parts Associate and Purchasing Manager (admin has all)
        ('admin', 'supplier.purchaseOrder.create'), ('partsAssociate', 'supplier.purchaseOrder.create'), ('purchasingManager', 'supplier.purchaseOrder.create'),
        ('admin', 'supplier.purchaseOrder.send'),   ('partsAssociate', 'supplier.purchaseOrder.send'),   ('purchasingManager', 'supplier.purchaseOrder.send'),
        -- approve: Parts Manager, Owner, General Manager, admin
        ('admin', 'supplier.purchaseOrder.approve'), ('generalManager', 'supplier.purchaseOrder.approve'),
        ('owner', 'supplier.purchaseOrder.approve'), ('partsManager', 'supplier.purchaseOrder.approve'),
        -- cancel: Parts Manager, General Manager, Owner (admin has all)
        ('admin', 'supplier.purchaseOrder.cancel'), ('generalManager', 'supplier.purchaseOrder.cancel'),
        ('owner', 'supplier.purchaseOrder.cancel'), ('partsManager', 'supplier.purchaseOrder.cancel'),
        -- read: every holder of any of the four, plus every holder of reorder.purchaseOrder.read (accountingManager, controller, dispatcher,
        -- financeManager, operationsManager, warehouseAssociate, warehouseManager, and the roles above)
        ('accountingManager', 'supplier.purchaseOrder.read'), ('admin', 'supplier.purchaseOrder.read'), ('controller', 'supplier.purchaseOrder.read'),
        ('dispatcher', 'supplier.purchaseOrder.read'), ('financeManager', 'supplier.purchaseOrder.read'), ('generalManager', 'supplier.purchaseOrder.read'),
        ('operationsManager', 'supplier.purchaseOrder.read'), ('owner', 'supplier.purchaseOrder.read'), ('partsAssociate', 'supplier.purchaseOrder.read'),
        ('partsManager', 'supplier.purchaseOrder.read'), ('purchasingManager', 'supplier.purchaseOrder.read'),
        ('warehouseAssociate', 'supplier.purchaseOrder.read'), ('warehouseManager', 'supplier.purchaseOrder.read')
       ) AS g(role_key, capability_key) ON g.capability_key = c.key
  JOIN roles r ON r.key = g.role_key AND (r.key NOT IN ('owner', 'admin') OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
-- Refuses once any authored data, Administration decision or direct grant exists: a down migration never silently discards a PO or a decision.
DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.supplier_po_commands;
    IF v_n > 0 THEN RAISE EXCEPTION 'P1_SUPPLIER_PO_AUTHORING: refuses to reverse -- % authoring command record(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.supplier_po_number_counters;
    IF v_n > 0 THEN RAISE EXCEPTION 'P1_SUPPLIER_PO_AUTHORING: refuses to reverse -- an SPO number has been allocated'; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.supplier_purchase_order_lines WHERE source_request_id IS NOT NULL OR unit_price_minor IS NOT NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'P1_SUPPLIER_PO_AUTHORING: refuses to reverse -- % supplier purchase order line(s) carry a source request or a price', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.supplier_purchase_orders
     WHERE receiving_warehouse_id IS NOT NULL OR approved_at IS NOT NULL OR sent_at IS NOT NULL OR cancelled_at IS NOT NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'P1_SUPPLIER_PO_AUTHORING: refuses to reverse -- % supplier purchase order(s) were authored here', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key LIKE 'supplier.purchaseOrder.%';
    IF v_n > 0 THEN RAISE EXCEPTION 'P1_SUPPLIER_PO_AUTHORING: refuses to reverse -- % Administration decision(s) name a supplier purchase order capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key LIKE 'supplier.purchaseOrder.%';
    IF v_n > 0 THEN RAISE EXCEPTION 'P1_SUPPLIER_PO_AUTHORING: refuses to reverse -- % direct grant(s) hold a supplier purchase order capability', v_n; END IF;
END
$$;

DROP TABLE eos_ops.supplier_po_commands;
DROP TABLE eos_ops.supplier_po_number_counters;
DROP INDEX eos_ops.supplier_purchase_order_lines_by_request;
DROP INDEX eos_ops.supplier_purchase_order_lines_one_active_request;
ALTER TABLE eos_ops.supplier_purchase_order_lines
    DROP CONSTRAINT supplier_purchase_order_line_release_needs_source,
    DROP CONSTRAINT supplier_purchase_order_line_currency_shape,
    DROP CONSTRAINT supplier_purchase_order_line_price_nonneg,
    DROP CONSTRAINT supplier_purchase_order_line_price_pairs,
    DROP COLUMN link_released_at, DROP COLUMN currency, DROP COLUMN unit_price_minor, DROP COLUMN source_request_id;
DROP INDEX eos_ops.supplier_purchase_orders_spo_number_unique;
ALTER TABLE eos_ops.supplier_purchase_orders
    DROP CONSTRAINT supplier_purchase_order_spo_number_format,
    DROP CONSTRAINT supplier_purchase_order_cancel_stated,
    DROP CONSTRAINT supplier_purchase_order_warehouse_stated,
    DROP COLUMN cancellation_reason, DROP COLUMN cancelled_at, DROP COLUMN cancelled_by, DROP COLUMN sent_at, DROP COLUMN sent_by,
    DROP COLUMN approved_at, DROP COLUMN approved_by, DROP COLUMN receiving_warehouse_id;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities rc USING capabilities c WHERE c.id = rc.capability_id AND c.key LIKE 'supplier.purchaseOrder.%';
DELETE FROM capabilities WHERE key LIKE 'supplier.purchaseOrder.%';
