-- Up Migration
-- EOS Administration policy — tenant lifecycle and the provider-neutral identity model.
--
-- ============================================================================
-- MIGRATION 002. Migration 001 stood the policy model up and gave it a `tenants` table with three
-- columns, because nothing yet created a tenant: the tests inserted a row by hand and moved on.
-- Non-production activation is the point at which that stops being enough, and this migration adds
-- exactly the two things the bootstrap path needs and nothing it does not.
--
-- STANDARD POSTGRESQL ONLY, same as 001. No Render API, no extension, no platform-specific type.
-- ============================================================================
--
-- ════════════════════ WHY THE TENANT NEEDS MORE THAN A NAME ════════════════════
--
-- A bootstrap must be IDEMPOTENT, and idempotence needs a natural key to find the tenant by. `id`
-- is opaque and generated; `name` is a display string somebody will edit. So `key` is added as the
-- stable slug the bootstrap resolves on, and it is UNIQUE because two tenants answering to one key
-- is the ambiguity that makes "find or create" unsafe.
--
-- `status` exists so a tenant can be suspended without deleting its policy, and
-- `configuration_version` records which seed produced the tenant's configuration -- the question
-- "what was this tenant seeded from" is otherwise only answerable from an audit event that a
-- retention policy may one day age out.
--
-- ════════════════════ WHY A PRINCIPAL IS NOT A FIREBASE UID ════════════════════
--
-- Authentication is external and TEMPORARY. Firebase proves who someone is today; the platform's
-- direction replaces that provider without rewriting authorization. If the authorization model's
-- identity were the Firebase UID, replacing the provider would mean rewriting every assignment,
-- every access-version row and every audit event -- which is how a "temporary" provider becomes
-- permanent.
--
-- So `principals.id` is the EOS-native identifier, and (identity_provider, external_subject) is the
-- MAPPING to whatever proved the identity. Replacing the provider is then a row per principal,
-- not a schema migration.
--
-- ════════════════════ WHY THERE IS NO FOREIGN KEY ONTO user_role_assignments ════════════════════
--
-- Deliberate, and recorded rather than assumed. `user_role_assignments.principal_uid` holds an
-- opaque principal identifier and, from this migration onward, the trusted API writes
-- `principals.id` into it. A foreign key would express that -- but it would also force the
-- foundation's RESOLVER proofs, which use synthetic principals to test staleness, scope and union
-- arithmetic, through the identity model for no authorization gain, and those proofs are about
-- policy resolution rather than about who exists.
--
-- The guarantee is enforced at the boundary that actually matters instead: the trusted API refuses
-- to assign a Role to a principal with no ACTIVE membership in the tenant, and that refusal is
-- proved against a real database. `tenant_memberships` does carry its foreign keys, because that
-- table IS the identity model and nothing synthetic writes it.
--
-- Tightening this into a schema-level foreign key is a follow-up for when the API is the sole
-- writer of assignments; it is named in docs/architecture/eos-policy-nonprod-activation.md.

SET search_path = eos_policy, public;

-- ============================ tenant lifecycle ============================

ALTER TABLE tenants ADD COLUMN key                   TEXT;
ALTER TABLE tenants ADD COLUMN status                TEXT        NOT NULL DEFAULT 'active';
ALTER TABLE tenants ADD COLUMN configuration_version INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN updated_at            TIMESTAMPTZ NOT NULL DEFAULT now();

-- Existing rows (test fixtures only -- no environment holds policy data yet) get their id as their
-- key, which is what they were already being found by.
UPDATE tenants SET key = id WHERE key IS NULL;

ALTER TABLE tenants ALTER COLUMN key SET NOT NULL;
ALTER TABLE tenants ADD CONSTRAINT tenants_key_unique UNIQUE (key);

-- A closed vocabulary, because "status" with free text is a column that means nothing after the
-- third value somebody invents.
ALTER TABLE tenants ADD CONSTRAINT tenants_status_known
    CHECK (status IN ('active', 'suspended', 'retired'));

-- ============================ principals ============================

CREATE TYPE principal_status AS ENUM ('active', 'disabled');

CREATE TABLE principals (
    id                TEXT PRIMARY KEY,
    -- The subject as the identity provider names it. For Firebase this is the UID; for whatever
    -- replaces it, whatever that names its subject. EOS never interprets the value.
    external_subject  TEXT NOT NULL,
    identity_provider TEXT NOT NULL,
    display_name      TEXT,
    status            principal_status NOT NULL DEFAULT 'active',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One subject per provider maps to exactly one principal. Without this, a second sign-in path
    -- could mint a second principal for the same human and split their Roles in half.
    CONSTRAINT principals_provider_subject_unique UNIQUE (identity_provider, external_subject)
);

-- The lookup every authenticated request makes: provider + subject -> principal.
CREATE INDEX principals_by_subject ON principals (identity_provider, external_subject);

-- ============================ tenant membership ============================
--
-- WHICH TENANT A PRINCIPAL BELONGS TO IS NOT A REQUEST PARAMETER. It is this table. A client that
-- sends a tenantId is stating a preference the server checks against these rows, never a fact the
-- server adopts -- and a principal with no ACTIVE membership resolves to no tenant at all rather
-- than to a default one.

CREATE TABLE tenant_memberships (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL REFERENCES tenants(id),
    principal_id TEXT NOT NULL REFERENCES principals(id),
    status       principal_status NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tenant_memberships_unique UNIQUE (tenant_id, principal_id)
);

CREATE INDEX tenant_memberships_by_principal ON tenant_memberships (principal_id, status);

-- ============================ bootstrap grants ============================
--
-- The initial administering state is a RECORD, not a special code path that leaves no trace. One
-- row per tenant, written the first time an administrator is bootstrapped, and the uniqueness
-- constraint IS the "one-time" guarantee -- enforced by the database rather than by a check the
-- caller could race.

CREATE TABLE tenant_admin_bootstraps (
    tenant_id      TEXT PRIMARY KEY REFERENCES tenants(id),
    principal_id   TEXT        NOT NULL REFERENCES principals(id),
    performed_by   TEXT        NOT NULL,
    reason         TEXT,
    performed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration
SET search_path = eos_policy, public;

DROP TABLE IF EXISTS tenant_admin_bootstraps;
DROP TABLE IF EXISTS tenant_memberships;
DROP INDEX IF EXISTS principals_by_subject;
DROP TABLE IF EXISTS principals;
DROP TYPE IF EXISTS principal_status;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_known;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_key_unique;
ALTER TABLE tenants DROP COLUMN IF EXISTS updated_at;
ALTER TABLE tenants DROP COLUMN IF EXISTS configuration_version;
ALTER TABLE tenants DROP COLUMN IF EXISTS status;
ALTER TABLE tenants DROP COLUMN IF EXISTS key;
