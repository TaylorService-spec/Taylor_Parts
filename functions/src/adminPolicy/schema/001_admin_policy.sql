-- EOS Administration policy — the PostgreSQL schema.
--
-- ============================================================================
-- THIS FILE IS NOT WIRED TO ANY RUNNER, AND THAT IS DELIBERATE.
--
-- Measured: this repository has no PostgreSQL, no DAL and no migration tooling -- no `pg`, `knex`,
-- `kysely`, `drizzle-orm`, `prisma`, `typeorm` or `sequelize` in any package.json, and no source
-- file that mentions Postgres. Choosing one is a new architectural dependency with no precedent
-- here, so it is NAMED DECISION D-1 for the Owner rather than something settled inside an
-- implementation task.
--
-- So this ships as REVIEWABLE DDL: the shape the domain contracts imply, written where it can be
-- read and argued with before anything depends on it. Nothing executes it. Falling back to
-- Firestore was explicitly refused, and no table below has a Firestore equivalent.
--
-- When the driver is chosen, this becomes migration 001 and one adapter implements
-- policyRepository.ts against it.
-- ============================================================================
--
-- CONVENTIONS
--
--   tenant_id on every tenant-owned table, and it is the first column of every index that matters.
--   A query that forgot the tenant should be slow and obvious, not fast and wrong.
--
--   Keys are the customer-facing identity (`customer`, `partsPurchasing`); ids are opaque and
--   internal. Uniqueness is always per tenant -- two tenants may both have a `customer` object.
--
--   TIMESTAMPTZ everywhere. A policy change has one instant, not one per reader's timezone.
--
--   No ON DELETE CASCADE from a policy row to an audit row, anywhere. Audit outlives the thing it
--   describes; that is the whole point of it.

BEGIN;

CREATE SCHEMA IF NOT EXISTS eos_policy;
SET search_path = eos_policy, public;

-- ============================ tenancy ============================

CREATE TABLE tenants (
    id           TEXT PRIMARY KEY,
    name         TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================ objects and fields ============================

CREATE TYPE definition_origin    AS ENUM ('SYSTEM', 'CUSTOM');
CREATE TYPE definition_lifecycle AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE field_sensitivity    AS ENUM ('NORMAL', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- The field type vocabulary is the repository's existing one (entityDefinition.js FIELD_TYPE),
-- mirrored here rather than reinvented. A drift test pins the two together.
CREATE TYPE field_data_type AS ENUM (
    'STRING', 'TEXT', 'NUMBER', 'CURRENCY_MINOR', 'BOOLEAN', 'DATE', 'TIMESTAMP',
    'ENUM', 'ENUM_SET', 'ADDRESS', 'REFERENCE', 'ID'
);

CREATE TABLE objects (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    key             TEXT NOT NULL,
    label           TEXT NOT NULL,
    label_plural    TEXT,
    description     TEXT,
    origin          definition_origin    NOT NULL,
    lifecycle       definition_lifecycle NOT NULL DEFAULT 'ACTIVE',
    -- An object that does not support deletion cannot be granted D. Enforced by the command, by the
    -- resolver, and recorded here so a third writer inherits the same fact rather than a comment.
    supports_delete BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      TEXT        NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE TABLE object_fields (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL REFERENCES tenants(id),
    object_id      TEXT NOT NULL REFERENCES objects(id),
    key            TEXT NOT NULL,
    label          TEXT NOT NULL,
    description    TEXT,
    data_type      field_data_type   NOT NULL,
    required       BOOLEAN           NOT NULL DEFAULT FALSE,
    allowed_values TEXT[]            NOT NULL DEFAULT '{}',
    default_value  TEXT,
    searchable     BOOLEAN           NOT NULL DEFAULT FALSE,
    sortable       BOOLEAN           NOT NULL DEFAULT FALSE,
    reportable     BOOLEAN           NOT NULL DEFAULT TRUE,
    sensitivity    field_sensitivity NOT NULL DEFAULT 'NORMAL',
    reference_to   TEXT,
    origin         definition_origin    NOT NULL,
    lifecycle      definition_lifecycle NOT NULL DEFAULT 'DRAFT',
    created_by     TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by     TEXT        NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, object_id, key),
    -- An enum with no members can hold nothing, and allowed values on a non-enum describe nothing.
    CONSTRAINT enum_has_values CHECK (
        (data_type IN ('ENUM', 'ENUM_SET') AND cardinality(allowed_values) > 0)
        OR (data_type NOT IN ('ENUM', 'ENUM_SET') AND cardinality(allowed_values) = 0)
    ),
    CONSTRAINT reference_names_target CHECK (data_type <> 'REFERENCE' OR reference_to IS NOT NULL)
);

CREATE INDEX object_fields_by_object ON object_fields (tenant_id, object_id);

-- ============================ roles and permissions ============================

CREATE TABLE roles (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    key         TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    origin      definition_origin NOT NULL,
    -- The recovery guarantee. A protected Role cannot be deleted or stripped of its administering
    -- authority, so ordinary configuration cannot leave the tenant unadministrable.
    protected   BOOLEAN NOT NULL DEFAULT FALSE,
    created_by  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

-- One Role's COMPLETE CRED over one Object. Every verb answered; no inheritance at this level.
CREATE TABLE role_object_permissions (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL REFERENCES tenants(id),
    role_id    TEXT NOT NULL REFERENCES roles(id),
    object_id  TEXT NOT NULL REFERENCES objects(id),
    can_create BOOLEAN NOT NULL DEFAULT FALSE,
    can_read   BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit   BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, role_id, object_id)
);

CREATE INDEX role_object_permissions_by_role ON role_object_permissions (tenant_id, role_id);

-- One Role's DEPARTURE from the inherited Object CRED, for one field.
--
-- NULL MEANS INHERIT, and that is why these are nullable booleans rather than a copied CredSet.
-- Storing the agreeing values is what drifts: change the Object's Read and a copied field value
-- silently stops agreeing. A row where all four are NULL is meaningless and is refused -- "no
-- opinion" is the absence of a row, and two spellings of it become two sources of truth.
CREATE TABLE role_field_permission_overrides (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT NOT NULL REFERENCES tenants(id),
    role_id    TEXT NOT NULL REFERENCES roles(id),
    field_id   TEXT NOT NULL REFERENCES object_fields(id),
    can_create BOOLEAN,
    can_read   BOOLEAN,
    can_edit   BOOLEAN,
    can_delete BOOLEAN,
    created_by TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, role_id, field_id),
    CONSTRAINT override_says_something CHECK (
        can_create IS NOT NULL OR can_read IS NOT NULL OR can_edit IS NOT NULL OR can_delete IS NOT NULL
    )
);

CREATE INDEX role_field_overrides_by_role ON role_field_permission_overrides (tenant_id, role_id);

-- ============================ assignment ============================

CREATE TYPE assignment_status AS ENUM ('active', 'disabled');

CREATE TABLE user_role_assignments (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL REFERENCES tenants(id),
    principal_uid           TEXT NOT NULL,
    role_id                 TEXT NOT NULL REFERENCES roles(id),
    scope_type              TEXT NOT NULL DEFAULT 'global',
    scope_value             TEXT,
    status                  assignment_status NOT NULL DEFAULT 'active',
    granted_by              TEXT        NOT NULL,
    granted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_version_at_grant INTEGER     NOT NULL,
    created_by              TEXT        NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by              TEXT        NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The resolver's hot path: every assignment for one principal in one tenant.
CREATE INDEX user_role_assignments_by_principal
    ON user_role_assignments (tenant_id, principal_uid, status);

-- THE AUTHORITATIVE ACCESS VERSION.
--
-- Not `users/{uid}.accessVersion` in Firestore. A role change must invalidate stale authorization
-- state, and the counter that does the invalidating belongs with the policy it invalidates rather
-- than on a document in another system.
CREATE TABLE principal_access_versions (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL REFERENCES tenants(id),
    principal_uid  TEXT NOT NULL,
    access_version INTEGER     NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, principal_uid),
    -- It rises monotonically. The resolver's staleness rule reads
    -- `access_version_at_grant <= access_version`, so a counter that could go backwards would
    -- silently re-qualify assignments a change had excluded.
    CONSTRAINT access_version_non_negative CHECK (access_version >= 0)
);

-- ============================ workflows ============================

CREATE TYPE workflow_version_status AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

CREATE TABLE workflows (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    key         TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    object_key  TEXT,
    origin      definition_origin NOT NULL,
    created_by  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE TABLE workflow_versions (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL REFERENCES tenants(id),
    workflow_id  TEXT NOT NULL REFERENCES workflows(id),
    version      INTEGER NOT NULL,
    status       workflow_version_status NOT NULL DEFAULT 'DRAFT',
    published_at TIMESTAMPTZ,
    published_by TEXT,
    created_by   TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   TEXT        NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, workflow_id, version),
    CONSTRAINT published_records_when CHECK (
        (status <> 'PUBLISHED') OR (published_at IS NOT NULL AND published_by IS NOT NULL)
    )
);

CREATE TABLE workflow_steps (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id),
    workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
    key                 TEXT NOT NULL,
    label               TEXT NOT NULL,
    is_initial          BOOLEAN NOT NULL DEFAULT FALSE,
    is_terminal         BOOLEAN NOT NULL DEFAULT FALSE,
    created_by          TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          TEXT        NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, workflow_version_id, key),
    CONSTRAINT not_both_ends CHECK (NOT (is_initial AND is_terminal))
);

-- Exactly one initial step per version: an instance must have one place to start, and two would
-- make its beginning ambiguous.
CREATE UNIQUE INDEX workflow_one_initial_step
    ON workflow_steps (tenant_id, workflow_version_id) WHERE is_initial;

CREATE TABLE workflow_actions (
    id                     TEXT PRIMARY KEY,
    tenant_id              TEXT NOT NULL REFERENCES tenants(id),
    workflow_version_id    TEXT NOT NULL REFERENCES workflow_versions(id),
    key                    TEXT NOT NULL,
    label                  TEXT NOT NULL,
    from_step_key          TEXT NOT NULL,
    to_step_key            TEXT NOT NULL,
    requires_own_assignment BOOLEAN NOT NULL DEFAULT FALSE,
    created_by             TEXT        NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by             TEXT        NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- An action names ONE origin, which is what makes "Cancel from Scheduled" a different action
    -- from "Cancel from Created" and removes the need for a side table saying which is legal where.
    UNIQUE (tenant_id, workflow_version_id, key)
);

CREATE INDEX workflow_actions_by_version ON workflow_actions (tenant_id, workflow_version_id);

-- THE WORKFLOW AUTHORITY, and it grants no data access whatsoever.
CREATE TABLE workflow_role_bindings (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id),
    workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
    action_key          TEXT NOT NULL,
    role_id             TEXT NOT NULL REFERENCES roles(id),
    created_by          TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          TEXT        NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, workflow_version_id, action_key, role_id)
);

CREATE INDEX workflow_bindings_by_version ON workflow_role_bindings (tenant_id, workflow_version_id);

-- A running instance, PINNED to the version it began under. Editing a later version must not
-- retroactively reinterpret it: its history was produced under rules that said something specific.
CREATE TABLE workflow_instances (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id),
    workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id),
    object_key          TEXT NOT NULL,
    record_id           TEXT NOT NULL,
    current_step_key    TEXT NOT NULL,
    created_by          TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          TEXT        NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One live workflow per business record. A second would give the record two current states.
    UNIQUE (tenant_id, object_key, record_id)
);

CREATE TABLE workflow_instance_events (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id),
    instance_id   TEXT NOT NULL REFERENCES workflow_instances(id),
    action_key    TEXT NOT NULL,
    from_step_key TEXT NOT NULL,
    to_step_key   TEXT NOT NULL,
    actor_uid     TEXT        NOT NULL,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason        TEXT
);

CREATE INDEX workflow_events_by_instance ON workflow_instance_events (tenant_id, instance_id, occurred_at);

-- ============================ audit ============================

-- Every policy mutation writes one. NOT nullable, NOT configurable, and deliberately not linked by
-- a cascading foreign key to what it describes: the record of who changed the rules must outlive
-- the rule it changed, or it answers nothing when it matters.
CREATE TABLE audit_events (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    action      TEXT NOT NULL,
    actor_uid   TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    before      JSONB,
    after       JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason      TEXT
);

CREATE INDEX audit_events_by_tenant_time ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_by_target      ON audit_events (tenant_id, target_kind, target_id);

COMMIT;
