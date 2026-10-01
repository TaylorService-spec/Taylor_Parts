-- Up Migration
--
-- PARTS / PURCHASING / RECEIVING COMPLETION (Controller PARTS / PURCHASING / RECEIVING RULINGS, 2026-10-01). Additive.
--
--   1. REORDER CREATE IDEMPOTENCY (G2). A create carries the caller's idempotency key and the fingerprint of the
--      validated request, keyed PER CREATOR (requested_by) exactly as Work Order creation is: the same key with the same
--      request replays, the same key with a different request is a conflict. Native rows created before this
--      migration carry neither (NULL), which the CHECK allows only as a pair.
--   2. ONE OPEN DEMAND PER PART + DESTINATION WAREHOUSE (DQ-B) is decided by the CREATE COMMAND, serialized on a
--      per-(tenant, part, warehouse) advisory lock (reorderLifecycleCommands.createGovernedReorderRequest) -- the only
--      writer of new Reorder Requests. It is deliberately NOT a database-wide unique index: the ruling governs NEW demand,
--      and copied legacy history (provenance MIGRATED) can legitimately hold several open requests for one pair, which an
--      index would refuse to copy. No index is added for it here.
--   3. RR NUMBERING (G5). A per-tenant, per-UTC-year counter in PostgreSQL (the receiving_number_counters pattern),
--      seeded from the highest RR number already held so a native number never collides with a migrated or fixture
--      one; plus uniqueness of the human number within a tenant. Database identity (id) is unchanged.
--   4. TWO CAPABILITIES, registered UNGRANTED (grants are Administration decisions, never migrations):
--        warehouse.record.manage  ADMINISTRATIVE CONFIGURATION of Warehouse and Bin master data (DQ-E).
--        supplier.record.read     the Supplier master read (the Firestore read it replaces had no governed key).

SET search_path = eos_ops, public;

ALTER TABLE reorder_requests
    ADD COLUMN create_idempotency_key     TEXT,
    ADD COLUMN create_request_fingerprint TEXT,
    ADD CONSTRAINT reorder_requests_create_idempotency_pair CHECK (
        (create_idempotency_key IS NULL) = (create_request_fingerprint IS NULL)
        AND (create_idempotency_key IS NULL OR (btrim(create_idempotency_key) <> '' AND length(create_idempotency_key) <= 200))
    );

CREATE UNIQUE INDEX reorder_requests_create_idempotency
    ON reorder_requests (tenant_id, requested_by, create_idempotency_key)
    WHERE create_idempotency_key IS NOT NULL;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM (
        SELECT tenant_id, reorder_request_number FROM reorder_requests WHERE reorder_request_number IS NOT NULL
         GROUP BY 1, 2 HAVING count(*) > 1) d;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'REORDER_REQUEST_NUMBER: % RR number(s) are already duplicated within a tenant', v_n;
    END IF;
END
$$;

CREATE UNIQUE INDEX reorder_requests_number_unique
    ON reorder_requests (tenant_id, reorder_request_number)
    WHERE reorder_request_number IS NOT NULL;

CREATE TABLE reorder_request_number_counters (
    tenant_id   TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    year        INTEGER     NOT NULL CHECK (year BETWEEN 1970 AND 9999),
    last_value  INTEGER     NOT NULL CHECK (last_value >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, year)
);

INSERT INTO reorder_request_number_counters (tenant_id, year, last_value)
SELECT tenant_id, substring(reorder_request_number from 4 for 4)::int, max(substring(reorder_request_number from 9)::int)
  FROM reorder_requests WHERE reorder_request_number IS NOT NULL
 GROUP BY 1, 2;

SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key IN ('warehouse.record.manage', 'supplier.record.read')
        OR (object_key = 'warehouse' AND action_key = 'manage') OR (object_key = 'supplier' AND action_key = 'read');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'PARTS_COMPLETION_AUTHORITY: warehouse.record.manage / supplier.record.read is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_warehouse_record_manage', 'warehouse.record.manage',
     'ADMINISTRATIVE CONFIGURATION: create a governed Warehouse master (bound to an ACTIVE operating company), change its name, site and status, and create, relabel and activate or deactivate its Bins. Every change is audited with its reason. Not operational authority: confers no receive, transfer, relocation, placement or cycle-count right, and is not implied by working in a warehouse or by any warehouse operational scope.',
     'warehouse', 'manage', 'ADMIN_ACTION', 'Manage Warehouse and Bin Masters'),
    ('cap_supplier_record_read', 'supplier.record.read',
     'View the governed Supplier master (name, vendor number, contact, phone, email, address, payment terms reference, notes, status). Read only; confers no purchasing action.',
     'supplier', 'read', 'READ', 'View Suppliers')
ON CONFLICT (key) DO NOTHING;

-- Down Migration

SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id IN ('cap_warehouse_record_manage', 'cap_supplier_record_read');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'PARTS_COMPLETION_AUTHORITY: refuses to reverse -- % Role grant(s) hold warehouse.record.manage / supplier.record.read', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id IN ('cap_warehouse_record_manage', 'cap_supplier_record_read');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'PARTS_COMPLETION_AUTHORITY: refuses to reverse -- % direct grant(s) hold warehouse.record.manage / supplier.record.read', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key IN ('warehouse.record.manage', 'supplier.record.read');
        IF v_n > 0 THEN
            RAISE EXCEPTION 'PARTS_COMPLETION_AUTHORITY: refuses to reverse -- % Administration decision(s) name warehouse.record.manage / supplier.record.read', v_n;
        END IF;
    END IF;
    DELETE FROM capabilities WHERE id IN ('cap_warehouse_record_manage', 'cap_supplier_record_read');
END
$$;

SET search_path = eos_ops, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM reorder_requests WHERE create_idempotency_key IS NOT NULL;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'REORDER_CREATE_IDEMPOTENCY: refuses to reverse -- % Reorder Request(s) carry a create idempotency key a retry depends on', v_n;
    END IF;
END
$$;

DROP TABLE IF EXISTS reorder_request_number_counters;
DROP INDEX IF EXISTS reorder_requests_number_unique;
DROP INDEX IF EXISTS reorder_requests_create_idempotency;
ALTER TABLE reorder_requests
    DROP CONSTRAINT IF EXISTS reorder_requests_create_idempotency_pair,
    DROP COLUMN IF EXISTS create_request_fingerprint,
    DROP COLUMN IF EXISTS create_idempotency_key;
