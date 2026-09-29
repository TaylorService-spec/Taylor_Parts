-- Up Migration
-- MOBILE LOCATION -> WAREHOUSE SCOPE BINDING (Controller ruling DQ-024, 2026-09-28; lane L3).
-- Local test databases only until promoted through the governed activation.
--
-- ════════════════════ WHY THIS EXISTS ════════════════════
--
-- DQ-017 made WAREHOUSE operational scope an EOS server-side rule for inventory work, and DQ-024 settled
-- how it applies to a TRUCK: "scope follows the inventory location acted upon", and a truck (MOBILE)
-- location resolves to a warehouse scope ONLY through an explicit EOS-governed binding -- never from the
-- technician, the driver, the current user, a Firebase uid, a customer, a tenant default or any other
-- incidental relationship, and a missing binding FAILS CLOSED.
--
-- No such binding existed. `trucks.home_warehouse_id` is DESCRIPTIVE ONLY (migration 1758326400000 says so,
-- and forbids it as an input to any company answer; the sandbox proves it wrong for 2 of 5 trucks), and a
-- driver assignment is exactly the incidental relationship the ruling forbids. This table is the explicit
-- binding: one CURRENT warehouse per MOBILE location, with its history, its author and its reason.
--
-- ════════════════════ WHAT IT IS NOT ════════════════════
--
-- It is NOT an operating-company statement. A MOBILE location's company is `mobile_locations.
-- operating_company_key`, authored and never inferred; this table does not restate it and nothing derives a
-- company from it. It answers ONE question: "which warehouse's operational scope governs inventory work at
-- this truck location". To keep a binding from ever becoming a back door across companies, the bound
-- warehouse must belong to the SAME operating company key as the MOBILE location (enforced below, at write).
--
-- It is NOT populated by this migration. There is deliberately no seed, no backfill and no default: a
-- binding is a governed statement somebody makes, and until one is made every MOBILE location fails closed.
-- (Its Administration writer is a separate, governed step -- see docs/architecture/cycle-count-eos-cutover.md.)
SET search_path = eos_ops, public;

CREATE TABLE mobile_location_scope_bindings (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    location_type       ops_location_type NOT NULL,
    location_id         TEXT NOT NULL,
    warehouse_id        TEXT NOT NULL,
    effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to        TIMESTAMPTZ,
    established_by      TEXT NOT NULL,
    reason              TEXT NOT NULL,
    ended_by            TEXT,
    end_reason          TEXT,
    CONSTRAINT mobile_scope_binding_is_mobile CHECK (location_type = 'MOBILE'),
    CONSTRAINT mobile_scope_binding_reason_present CHECK (btrim(reason) <> ''),
    CONSTRAINT mobile_scope_binding_author_present CHECK (btrim(established_by) <> ''),
    CONSTRAINT mobile_scope_binding_interval CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT mobile_scope_binding_end_recorded CHECK (
        (effective_to IS NULL AND ended_by IS NULL AND end_reason IS NULL)
        OR (effective_to IS NOT NULL AND ended_by IS NOT NULL AND btrim(COALESCE(end_reason, '')) <> '')
    ),
    CONSTRAINT mobile_scope_binding_location_exists FOREIGN KEY (tenant_id, location_type, location_id)
        REFERENCES mobile_locations (tenant_id, location_type, location_id),
    CONSTRAINT mobile_scope_binding_warehouse_exists FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES warehouses (tenant_id, id)
);

-- ONE CURRENT binding per MOBILE location. History rows (effective_to set) are unconstrained.
CREATE UNIQUE INDEX mobile_scope_binding_one_current
    ON mobile_location_scope_bindings (tenant_id, location_type, location_id)
    WHERE effective_to IS NULL;
CREATE INDEX mobile_scope_binding_by_warehouse
    ON mobile_location_scope_bindings (tenant_id, warehouse_id) WHERE effective_to IS NULL;

-- SAME COMPANY, checked where the binding is written. A binding may never connect a truck to a warehouse of
-- another operating company: that would let one company's warehouse scope reach the other's stock.
CREATE FUNCTION mobile_scope_binding_same_company() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_ops, pg_catalog AS $fn$
DECLARE
    mobile_key TEXT;
    warehouse_key TEXT;
BEGIN
    SELECT operating_company_key INTO mobile_key FROM eos_ops.mobile_locations
     WHERE tenant_id = NEW.tenant_id AND location_type = NEW.location_type AND location_id = NEW.location_id;
    SELECT operating_company_key INTO warehouse_key FROM eos_ops.warehouses
     WHERE tenant_id = NEW.tenant_id AND id = NEW.warehouse_id;
    IF mobile_key IS NULL OR warehouse_key IS NULL OR mobile_key <> warehouse_key THEN
        RAISE EXCEPTION 'MOBILE_SCOPE_BINDING_COMPANY_MISMATCH: a truck location may only be bound to a warehouse of its own operating company'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER mobile_scope_binding_same_company
    BEFORE INSERT OR UPDATE OF tenant_id, location_type, location_id, warehouse_id
    ON mobile_location_scope_bindings
    FOR EACH ROW EXECUTE FUNCTION mobile_scope_binding_same_company();

-- APPEND-ONLY HISTORY. The only permitted change to a row is ENDING it (effective_to/ended_by/end_reason
-- set once). Re-pointing a binding is: end the current row, insert a new one.
CREATE FUNCTION mobile_scope_binding_end_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_ops, pg_catalog AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'MOBILE_SCOPE_BINDING_APPEND_ONLY: a scope binding is history and is never deleted';
    END IF;
    IF OLD.effective_to IS NOT NULL
       OR NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.location_type <> OLD.location_type
       OR NEW.location_id <> OLD.location_id OR NEW.warehouse_id <> OLD.warehouse_id
       OR NEW.effective_from <> OLD.effective_from OR NEW.established_by <> OLD.established_by
       OR NEW.reason <> OLD.reason OR NEW.effective_to IS NULL THEN
        RAISE EXCEPTION 'MOBILE_SCOPE_BINDING_APPEND_ONLY: a scope binding may only be ended, once';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER mobile_scope_binding_end_only
    BEFORE UPDATE OR DELETE ON mobile_location_scope_bindings
    FOR EACH ROW EXECUTE FUNCTION mobile_scope_binding_end_only();

-- Down Migration
SET search_path = eos_ops, public;

-- A binding is a governed statement with history. Refuse to destroy it while any exists; an empty table
-- reverses cleanly.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eos_ops.mobile_location_scope_bindings) THEN
        RAISE EXCEPTION 'refusing to drop mobile_location_scope_bindings: governed scope bindings exist';
    END IF;
END
$$;

DROP TABLE mobile_location_scope_bindings;
DROP FUNCTION mobile_scope_binding_end_only();
DROP FUNCTION mobile_scope_binding_same_company();
