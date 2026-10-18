-- Up Migration
-- WAREHOUSE AND RECEIVING OFF FIREBASE (Firebase exit B3, nonprod; DECISIONS #B3; Owner rulings 4-8 of the Firebase-exit batch plan,
-- 2026-10-17).
--
-- 1. THE TWO RACKING CAPABILITIES, mirrored (ruling 7). inventory.location.bin.read / .manage are registered in EOS under the SAME names
--    and granted to EXACTLY the Roles that hold them in the Firebase catalog today (functions/src/access/governedBusinessRoles.ts), no
--    other (the B1 precedent): admin (both), the memberless inventoryBinAdministrator (both), and bin.read alone on owner and the two
--    bin-reading operator Roles (inventoryPutAwayOperator, inventoryStockRelocationOperator). 7 grants, NO new holder, NO catalog-sync
--    widening: the grants ARE the catalog's, so a reconcile imports nothing further. Registering a key is not granting it; the Warehouse
--    Racking planner is the only consumer.
--
-- 2. THE CANONICAL SUPPLIER PURCHASE ORDER (ruling 4). Firebase `purchase_orders` (multi-line, partial receipts) had no EOS home: migration
--    008 said so ("the canonical multi-line purchase_orders object is a DIFFERENT authority that this schema does not yet hold").
--    supplier_purchase_orders + supplier_purchase_order_lines are that authority, receipt-shaped: a company (a receipt has one
--    destination, so one owning company), an optional governed supplier, a stored lifecycle (DRAFT / APPROVED / SENT / RECEIVED /
--    CANCELLED -- the Firebase vocabulary), a concurrency VERSION (concurrency control only, never a quantity), and lines that carry NO
--    price: a canonical line has no governed price today, so a canonical receipt's cost is UNKNOWN, never zero (unchanged from Firebase).
--    Received and remaining quantity are DERIVED from receiving_order_lines, never stored here. Nothing in this migration creates a row.
--
-- 3. THE LEGACY INVENTORY-ACTION NOTES ARCHIVE (ruling 8). Firestore `inventory_actions` is frozen (Owner ruling 2026-08-30) and can
--    carry unique free-text history, so an EOS archive path exists: legacy_inventory_action_notes, READ ONLY from the application
--    (inventory.action.read). It is EMPTY here and stays empty until an Owner-authorized copy; the copy is HELD. A note is evidence of
--    what was once recorded, never stock authority and never a ledger movement (inventoryActionRetirementContract).
--
-- GRANT-BEARING (Owner ruling E): roleCapabilityAuthorityBaseline.json carries the 7 pairs in the same change.

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_location_bin_read', 'inventory.location.bin.read',
     'Warehouse Racking: list a warehouse''s bins and preview what creating proposed bins would do. Read-only: authors nothing, does not authorize creating or retiring bins, and says nothing about inventory (Firebase catalog id, mirrored).',
     'warehouse', 'binRead', 'BUSINESS_ACTION', 'Racking: View Bins'),
    ('cap_inventory_location_bin_manage', 'inventory.location.bin.manage',
     'Warehouse Racking: create bins (one at a time or from a generated layout), rename them and retire or revive them. Place identity only: authors no quantity, no ledger movement and no custody (Firebase catalog id, mirrored).',
     'warehouse', 'binManage', 'BUSINESS_ACTION', 'Racking: Manage Bins')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_b3_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764630000000', now(), 'migration:1764630000000', now(), 'migration:1764630000000', now()
  FROM capabilities c
  JOIN (VALUES
        ('admin', 'inventory.location.bin.read'), ('admin', 'inventory.location.bin.manage'),
        ('inventoryBinAdministrator', 'inventory.location.bin.read'), ('inventoryBinAdministrator', 'inventory.location.bin.manage'),
        ('owner', 'inventory.location.bin.read'),
        ('inventoryPutAwayOperator', 'inventory.location.bin.read'),
        ('inventoryStockRelocationOperator', 'inventory.location.bin.read')) AS g(role_key, capability_key) ON g.capability_key = c.key
  JOIN roles r ON r.key = g.role_key AND (r.key <> 'owner' OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

SET search_path = eos_ops, public;

CREATE TABLE supplier_purchase_orders (
    tenant_id             TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- The purchase order's identity, carried verbatim (a Firestore auto-id on a copied order). Never a reorder request id.
    id                    TEXT        NOT NULL,
    -- ONE owning company: a receipt has one destination. A key, as every eos_ops record carries; NOT NULL, no default.
    operating_company_key TEXT        NOT NULL,
    supplier_id           TEXT,
    external_po_number    TEXT,
    status                TEXT        NOT NULL,
    -- CONCURRENCY CONTROL ONLY: incremented by every receipt; it never represents quantity received or remaining.
    version               INTEGER     NOT NULL DEFAULT 0,
    provenance            TEXT        NOT NULL DEFAULT 'NATIVE',
    created_by            TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT supplier_purchase_orders_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT supplier_purchase_order_id_stated CHECK (btrim(id) <> '' AND length(id) <= 200 AND position('/' in id) = 0),
    CONSTRAINT supplier_purchase_order_status_known CHECK (status IN ('DRAFT', 'APPROVED', 'SENT', 'RECEIVED', 'CANCELLED')),
    CONSTRAINT supplier_purchase_order_version_nonneg CHECK (version >= 0),
    CONSTRAINT supplier_purchase_order_provenance_known CHECK (provenance IN ('NATIVE', 'MIGRATED')),
    CONSTRAINT supplier_purchase_order_supplier_stated CHECK (supplier_id IS NULL OR btrim(supplier_id) <> ''),
    CONSTRAINT supplier_purchase_order_number_stated CHECK (external_po_number IS NULL OR btrim(external_po_number) <> ''),
    CONSTRAINT supplier_purchase_order_writer_stated CHECK (btrim(created_by) <> '' AND btrim(updated_by) <> '')
);

CREATE INDEX supplier_purchase_orders_by_company ON supplier_purchase_orders (tenant_id, operating_company_key, status);

CREATE TABLE supplier_purchase_order_lines (
    tenant_id         TEXT        NOT NULL,
    purchase_order_id TEXT        NOT NULL,
    -- The line's identity WITHIN its order. A receipt addresses a line BY THIS ID.
    line_id           TEXT        NOT NULL,
    part_id           TEXT        NOT NULL,
    ordered_quantity  INTEGER     NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT supplier_purchase_order_lines_pkey PRIMARY KEY (tenant_id, purchase_order_id, line_id),
    CONSTRAINT supplier_purchase_order_lines_order FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES supplier_purchase_orders (tenant_id, id),
    CONSTRAINT supplier_purchase_order_line_id_stated CHECK (btrim(line_id) <> '' AND length(line_id) <= 200),
    CONSTRAINT supplier_purchase_order_line_part_stated CHECK (btrim(part_id) <> '' AND length(part_id) <= 256),
    CONSTRAINT supplier_purchase_order_line_quantity_positive CHECK (ordered_quantity > 0)
);

CREATE TABLE legacy_inventory_action_notes (
    tenant_id          TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- The Firestore document id, verbatim: the trace back to the frozen source.
    id                 TEXT        NOT NULL,
    part_id            TEXT        NOT NULL,
    transaction_type   TEXT        NOT NULL,
    quantity_delta     INTEGER,
    reason             TEXT,
    -- The acting FIREBASE uid as it was stored: evidence, never an EOS Principal reference.
    created_by_ref     TEXT,
    -- The source's client-stamped epoch milliseconds, verbatim.
    created_at_ms      BIGINT,
    archived_by        TEXT        NOT NULL,
    archived_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT legacy_inventory_action_notes_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT legacy_inventory_action_note_part_stated CHECK (btrim(part_id) <> ''),
    CONSTRAINT legacy_inventory_action_note_type_stated CHECK (btrim(transaction_type) <> ''),
    CONSTRAINT legacy_inventory_action_note_archiver_stated CHECK (btrim(archived_by) <> '')
);

CREATE INDEX legacy_inventory_action_notes_by_part ON legacy_inventory_action_notes (tenant_id, part_id, created_at_ms DESC);

-- Down Migration
DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.supplier_purchase_orders;
    IF v_n > 0 THEN RAISE EXCEPTION 'WAREHOUSE_RECEIVING_B3: refuses to reverse -- % supplier purchase order(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.legacy_inventory_action_notes;
    IF v_n > 0 THEN RAISE EXCEPTION 'WAREHOUSE_RECEIVING_B3: refuses to reverse -- % archived legacy note(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key LIKE 'inventory.location.bin.%';
    IF v_n > 0 THEN RAISE EXCEPTION 'WAREHOUSE_RECEIVING_B3: refuses to reverse -- % Administration decision(s) name a bin capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key LIKE 'inventory.location.bin.%';
    IF v_n > 0 THEN RAISE EXCEPTION 'WAREHOUSE_RECEIVING_B3: refuses to reverse -- % direct grant(s) hold a bin capability', v_n; END IF;
END
$$;

DROP TABLE eos_ops.legacy_inventory_action_notes;
DROP TABLE eos_ops.supplier_purchase_order_lines;
DROP TABLE eos_ops.supplier_purchase_orders;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities rc USING capabilities c WHERE c.id = rc.capability_id AND c.key LIKE 'inventory.location.bin.%';
DELETE FROM capabilities WHERE key LIKE 'inventory.location.bin.%';
