-- Up Migration
-- EOS Administration policy — operational capability authority.
--
-- ============================================================================
-- MIGRATION 004. Owner ruling (2026-09-10, "EOS Operational Data Plane P0"): PostgreSQL is the
-- target authoritative operational persistence for EOS, and authorization for operational commands
-- (starting with Cycle Count) is a governed CAPABILITY relation layered onto the EXISTING Role
-- model -- not a second, Cycle-Count-specific permission system, and not a second Role table.
--
-- STANDARD POSTGRESQL ONLY, same as 001-003.
-- ============================================================================
--
-- ════════════════════ WHY A CAPABILITY, AND NOT AN OBJECT PERMISSION ════════════════════
--
-- `role_object_permissions` answers "may this Role CRED this Object" for the governed Object/Field
-- model (Administration screens, reports). An operational command like "reconcile this Cycle Count
-- sheet" is not CRED over a record -- it is a specific governed ACT, the same shape
-- `workflow_role_bindings` already uses for a workflow action. A capability is that same shape,
-- generalized to acts that do not belong to any one workflow: `inventory.cycleCount.reconcile` is a
-- capability a Role holds or does not, independent of whether a workflow instance exists yet.
--
-- ════════════════════ WHY THE CATALOG HAS NO tenant_id ════════════════════
--
-- The capability catalog is the platform's own closed vocabulary -- the same status as
-- `definition_origin` or `field_data_type` above: something the platform defines, not something a
-- tenant customizes. A tenant cannot invent a new capability by writing a row; it can only grant an
-- EXISTING one to one of its Roles, which is exactly what `role_capabilities` is for and why THAT
-- table, unlike this one, is tenant-scoped like every other Role-bearing table in this schema.
--
-- ════════════════════ THE FIVE CAPABILITIES, PRESERVED EXACTLY ════════════════════
--
-- Named by the Owner ruling and not renamed here: inventory.cycleCount.create,
-- inventory.cycleCount.submit, inventory.cycleCount.cancel, inventory.cycleCount.reconcile,
-- inventory.cycleCount.close. Seeded as SYSTEM rows so a fresh tenant's bootstrap has something to
-- grant; granting one to a Role is a role_capabilities row, not a schema change.

SET search_path = eos_policy, public;

-- ============================ capability catalog ============================

CREATE TABLE capabilities (
    id          TEXT PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    origin      definition_origin NOT NULL DEFAULT 'SYSTEM',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_inventory_cycleCount_create',    'inventory.cycleCount.create',    'Open a Cycle Count sheet or line for a governed location.'),
    ('cap_inventory_cycleCount_submit',    'inventory.cycleCount.submit',    'Submit a blind count for an open Cycle Count line.'),
    ('cap_inventory_cycleCount_cancel',    'inventory.cycleCount.cancel',    'Cancel a Cycle Count sheet or line before it is counted.'),
    ('cap_inventory_cycleCount_reconcile', 'inventory.cycleCount.reconcile', 'Approve or reject a submitted Cycle Count line, staging inventory adjustment evidence on approval.'),
    ('cap_inventory_cycleCount_close',     'inventory.cycleCount.close',     'Close a Cycle Count sheet once every line has been dispositioned.');

-- ============================ role -> capability grants ============================
--
-- One Role's grant of one capability, in one tenant. Tenant-scoped like every other Role-bearing
-- table (`role_object_permissions`, `workflow_role_bindings`) -- a grant is a fact about ONE
-- tenant's Role, never global, so two tenants may configure the same Role key differently.

CREATE TABLE role_capabilities (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id),
    role_id       TEXT NOT NULL REFERENCES roles(id),
    capability_id TEXT NOT NULL REFERENCES capabilities(id),
    granted_by    TEXT        NOT NULL,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    TEXT        NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, role_id, capability_id)
);

-- The resolver's hot path: every capability a Role holds, or every Role holding a capability.
CREATE INDEX role_capabilities_by_role       ON role_capabilities (tenant_id, role_id);
CREATE INDEX role_capabilities_by_capability ON role_capabilities (tenant_id, capability_id);

-- Down Migration
SET search_path = eos_policy, public;

DROP TABLE IF EXISTS role_capabilities;
DROP TABLE IF EXISTS capabilities;
