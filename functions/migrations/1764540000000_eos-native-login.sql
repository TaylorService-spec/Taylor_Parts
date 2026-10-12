-- Up Migration
-- EOS NATIVE LOGIN -- the human front door: login accounts, password credentials, refresh sessions, TOTP MFA,
-- recovery codes, one-time enrollment/reset tickets and the authentication event log.
-- docs/architecture/eos-native-identity.md, section 3.
--
-- ════════════════════ WHERE THIS SITS ════════════════════
--
--   login account --(binding_id)--> principal_identities (provider 'eos', subject 'user.<hex>')
--                                   --> principals --> membership / Employee / Roles   (ALL UNCHANGED)
--
-- A login account is HOW a human proves they are an EOS subject. It is not authority: no Role, capability, scope or
-- tenant authority column exists here. The access token a login mints carries the bound subject and nothing else,
-- and resolves through the same resolvePrincipalContext every request already uses.
--
-- ════════════════════ WHAT IS NEVER STORED ════════════════════
--
-- No password (an scrypt hash only), no opaque token (SHA-256 digests only), no recovery code (HMAC digests only), no
-- TOTP secret in the clear (AES-256-GCM under a factor key held in the service environment), no client IP (a keyed
-- digest only).
--
-- ════════════════════ INERT ON DEPLOY ════════════════════
--
-- Empty tables. No seed, no backfill, no Firebase import. Nothing is reachable until EOS_HUMAN_LOGIN=enabled.
SET search_path = eos_policy, public;

CREATE TABLE login_accounts (
    id                   TEXT PRIMARY KEY,
    -- The tenant the account was provisioned in: where its governed audit events are written.
    tenant_id            TEXT NOT NULL REFERENCES tenants(id),
    principal_id         TEXT NOT NULL REFERENCES principals(id),
    -- The EOS identity this account authenticates AS. One account per binding, forever.
    binding_id           TEXT NOT NULL REFERENCES principal_identities(id),
    login_identifier     TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending_enrollment',
    password_hash        TEXT,
    password_changed_at  TIMESTAMPTZ,
    -- Raised by every password set, reset and change. Sessions record the value they were created under.
    credential_version   INTEGER NOT NULL DEFAULT 0,
    failed_attempts      INTEGER NOT NULL DEFAULT 0,
    locked_until         TIMESTAMPTZ,
    -- Policy: this account must hold an active second factor before its sessions may reach the API.
    mfa_required         BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at        TIMESTAMPTZ,
    created_by           TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason               TEXT NOT NULL,
    CONSTRAINT login_accounts_binding_unique UNIQUE (binding_id),
    CONSTRAINT login_accounts_status_known CHECK (status IN ('pending_enrollment', 'active', 'disabled', 'retired')),
    -- Lower-case, trimmed, no spaces: the comparison form IS the stored form.
    CONSTRAINT login_accounts_identifier_shape CHECK (login_identifier ~ '^[a-z0-9][a-z0-9._@+-]{2,127}$'),
    CONSTRAINT login_accounts_active_has_password CHECK (status <> 'active' OR password_hash IS NOT NULL),
    CONSTRAINT login_accounts_hash_shape CHECK (password_hash IS NULL OR password_hash LIKE 'scrypt$%'),
    CONSTRAINT login_accounts_counters CHECK (credential_version >= 0 AND failed_attempts >= 0),
    CONSTRAINT login_accounts_author_present CHECK (btrim(created_by) <> '' AND btrim(reason) <> '')
);
-- One LIVE account per identifier and per Principal. A retired account is history.
CREATE UNIQUE INDEX login_accounts_identifier_live ON login_accounts (login_identifier) WHERE status <> 'retired';
CREATE UNIQUE INDEX login_accounts_principal_live ON login_accounts (principal_id) WHERE status <> 'retired';

-- NEVER DELETED; a retired account never comes back (re-provisioning makes a new account on a new binding).
CREATE FUNCTION login_accounts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'LOGIN_ACCOUNT_APPEND_ONLY: a login account is history and is never deleted';
    END IF;
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.principal_id <> OLD.principal_id
       OR NEW.binding_id <> OLD.binding_id OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'LOGIN_ACCOUNT_IDENTITY_IMMUTABLE: an account''s principal, binding and provenance never change';
    END IF;
    IF OLD.status = 'retired' THEN
        RAISE EXCEPTION 'LOGIN_ACCOUNT_RETIRED: a retired login account is final';
    END IF;
    IF NEW.credential_version < OLD.credential_version THEN
        RAISE EXCEPTION 'LOGIN_ACCOUNT_CREDENTIAL_VERSION: the credential version only rises';
    END IF;
    RETURN NEW;
END
$fn$;
CREATE TRIGGER login_accounts_guard BEFORE UPDATE OR DELETE ON login_accounts
    FOR EACH ROW EXECUTE FUNCTION login_accounts_guard();

-- ════════════════════ one-time tickets: enrollment (first password) and reset ════════════════════
CREATE TABLE login_tickets (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES login_accounts(id),
    purpose       TEXT NOT NULL,
    token_sha256  TEXT NOT NULL,
    issued_by     TEXT NOT NULL,
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    reason        TEXT NOT NULL,
    CONSTRAINT login_tickets_token_unique UNIQUE (token_sha256),
    CONSTRAINT login_tickets_purpose_known CHECK (purpose IN ('enrollment', 'reset')),
    CONSTRAINT login_tickets_digest_shape CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT login_tickets_window CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '7 days'),
    CONSTRAINT login_tickets_single_end CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);
-- At most ONE open ticket per account and purpose: issuing another revokes the old one in the same transaction.
CREATE UNIQUE INDEX login_tickets_one_open ON login_tickets (account_id, purpose)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- ════════════════════ sessions and rotating refresh tokens ════════════════════
CREATE TABLE login_sessions (
    id                   TEXT PRIMARY KEY,
    account_id           TEXT NOT NULL REFERENCES login_accounts(id),
    principal_id         TEXT NOT NULL REFERENCES principals(id),
    -- THE ONE TENANT this session acts in (Owner ruling D-12). Chosen and validated at login or switch; never changed.
    tenant_id            TEXT NOT NULL REFERENCES tenants(id),
    credential_version   INTEGER NOT NULL,
    mfa_verified         BOOLEAN NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_refreshed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    idle_expires_at      TIMESTAMPTZ NOT NULL,
    absolute_expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at           TIMESTAMPTZ,
    revoke_reason        TEXT,
    client_label         TEXT,
    client_digest        TEXT,
    CONSTRAINT login_sessions_window CHECK (idle_expires_at <= absolute_expires_at AND absolute_expires_at > created_at),
    CONSTRAINT login_sessions_revocation_recorded CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
    CONSTRAINT login_sessions_label_bounded CHECK (client_label IS NULL OR length(client_label) <= 200)
);
CREATE INDEX login_sessions_live_by_account ON login_sessions (account_id) WHERE revoked_at IS NULL;

CREATE TABLE login_refresh_tokens (
    token_sha256  TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES login_sessions(id),
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set when the token is exchanged. Presenting a consumed token again is REUSE: the whole session is revoked.
    consumed_at   TIMESTAMPTZ,
    -- The client digest of the presenter that exchanged it: a re-presentation from a DIFFERENT client is theft even
    -- inside the sibling-tab grace window.
    consumed_client_digest TEXT,
    CONSTRAINT login_refresh_tokens_digest_shape CHECK (token_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX login_refresh_tokens_one_current ON login_refresh_tokens (session_id) WHERE consumed_at IS NULL;

-- A session is revoked once and stays revoked; its account and principal never move.
CREATE FUNCTION login_sessions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'LOGIN_SESSION_APPEND_ONLY: a session is history and is never deleted';
    END IF;
    IF NEW.account_id <> OLD.account_id OR NEW.principal_id <> OLD.principal_id OR NEW.tenant_id <> OLD.tenant_id OR NEW.created_at <> OLD.created_at
       OR NEW.absolute_expires_at > OLD.absolute_expires_at OR NEW.credential_version <> OLD.credential_version THEN
        RAISE EXCEPTION 'LOGIN_SESSION_IMMUTABLE: a session''s owner, origin and absolute lifetime never change';
    END IF;
    IF OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'LOGIN_SESSION_REVOKED: a revoked session is final';
    END IF;
    RETURN NEW;
END
$fn$;
CREATE TRIGGER login_sessions_guard BEFORE UPDATE OR DELETE ON login_sessions
    FOR EACH ROW EXECUTE FUNCTION login_sessions_guard();

-- ════════════════════ second factors ════════════════════
CREATE TABLE login_mfa_factors (
    id              TEXT PRIMARY KEY,
    account_id      TEXT NOT NULL REFERENCES login_accounts(id),
    kind            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    secret_sealed   TEXT NOT NULL,
    last_used_step  BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at    TIMESTAMPTZ,
    removed_at      TIMESTAMPTZ,
    removed_by      TEXT,
    CONSTRAINT login_mfa_factors_kind_known CHECK (kind IN ('totp')),
    CONSTRAINT login_mfa_factors_status_known CHECK (status IN ('pending', 'active', 'removed')),
    CONSTRAINT login_mfa_factors_sealed_shape CHECK (secret_sealed ~ '^v1\.[A-Za-z0-9-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$'),
    CONSTRAINT login_mfa_factors_lifecycle CHECK (
        (status = 'pending' AND confirmed_at IS NULL AND removed_at IS NULL)
        OR (status = 'active' AND confirmed_at IS NOT NULL AND removed_at IS NULL)
        OR (status = 'removed' AND removed_at IS NOT NULL AND btrim(COALESCE(removed_by, '')) <> ''))
);
CREATE UNIQUE INDEX login_mfa_factors_one_live ON login_mfa_factors (account_id, kind) WHERE status <> 'removed';

CREATE TABLE login_recovery_codes (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES login_accounts(id),
    -- The factor key the digest was made under (HMAC subkey of that kid): rotation keeps old codes verifiable.
    key_id        TEXT NOT NULL,
    code_digest   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at       TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ,
    CONSTRAINT login_recovery_codes_digest_unique UNIQUE (code_digest),
    CONSTRAINT login_recovery_codes_digest_shape CHECK (code_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT login_recovery_codes_key_id_shape CHECK (key_id ~ '^[A-Za-z0-9-]{1,32}$'),
    CONSTRAINT login_recovery_codes_single_end CHECK (used_at IS NULL OR superseded_at IS NULL)
);
CREATE INDEX login_recovery_codes_live ON login_recovery_codes (account_id) WHERE used_at IS NULL AND superseded_at IS NULL;

-- The step between "password correct" and "second factor correct". Short, single-use, attempt-bounded.
CREATE TABLE login_mfa_challenges (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES login_accounts(id),
    token_sha256  TEXT NOT NULL,
    -- The account's credential version when the password step passed: a reset or change in between voids the challenge.
    credential_version INTEGER NOT NULL,
    -- The tenant selected at the password step; the session the challenge completes into is bound to it.
    tenant_id     TEXT NOT NULL REFERENCES tenants(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,
    attempts      INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT login_mfa_challenges_token_unique UNIQUE (token_sha256),
    CONSTRAINT login_mfa_challenges_digest_shape CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT login_mfa_challenges_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
    CONSTRAINT login_mfa_challenges_attempts CHECK (attempts BETWEEN 0 AND 5)
);

-- ════════════════════ the authentication event log ════════════════════
--
-- EVERY attempt, including those that name no account (so not tenant-scoped, unlike audit_events, which records the
-- governed changes -- provisioning, resets, MFA changes, revocations -- in the account's tenant). Append-only.
CREATE TABLE authentication_events (
    id             TEXT PRIMARY KEY,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The tenant the event belongs to (the session's, else the account's home tenant). NULL only for an attempt that
    -- names no account: operator-visible, never shown to a tenant (Owner ruling D-13: tenant isolation).
    tenant_id      TEXT REFERENCES tenants(id),
    event          TEXT NOT NULL,
    outcome        TEXT NOT NULL,
    reason_code    TEXT,
    account_id     TEXT REFERENCES login_accounts(id),
    principal_id   TEXT REFERENCES principals(id),
    session_id     TEXT REFERENCES login_sessions(id),
    client_digest  TEXT,
    client_label   TEXT,
    CONSTRAINT authentication_events_outcome_known CHECK (outcome IN ('success', 'refused')),
    CONSTRAINT authentication_events_event_shape CHECK (event ~ '^[a-zA-Z]{3,64}$'),
    CONSTRAINT authentication_events_label_bounded CHECK (client_label IS NULL OR length(client_label) <= 200)
);
CREATE INDEX authentication_events_by_account ON authentication_events (account_id, occurred_at DESC);
CREATE INDEX authentication_events_by_time ON authentication_events (occurred_at DESC);
CREATE INDEX authentication_events_by_tenant ON authentication_events (tenant_id, occurred_at DESC);

CREATE FUNCTION authentication_events_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    RAISE EXCEPTION 'authentication_events is append-only: % would rewrite the security record', TG_OP;
END
$fn$;
CREATE TRIGGER authentication_events_append_only BEFORE UPDATE OR DELETE ON authentication_events
    FOR EACH ROW EXECUTE FUNCTION authentication_events_append_only();
CREATE TRIGGER authentication_events_no_truncate BEFORE TRUNCATE ON authentication_events
    FOR EACH STATEMENT EXECUTE FUNCTION authentication_events_append_only();

-- ════════════════════ security-event retention (Owner ruling D-13) -- DESIGN ONLY, NOTHING SCHEDULED ════════════════════
--
-- The ACTIVE history (authentication_events) is append-only and is never deleted or altered by any code in this
-- repository. Retention is governed configuration plus an append-only MANIFEST of archival operations; no job exists
-- that archives or deletes, and the manifest table has no "purged" state. docs/architecture/eos-native-identity.md §8.

-- How long events stay in the ACTIVE history before they become ELIGIBLE for archival, per tenant. NULL tenant = the
-- operator policy for events that name no account. Every change is a new row (history), never an update.
CREATE TABLE authentication_event_retention_policies (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT REFERENCES tenants(id),
    -- Floor 365 days: shorter cannot be configured; ceiling 10 years.
    active_retention_days INTEGER NOT NULL,
    -- Archives are kept at least this long once made.
    archive_retention_days INTEGER NOT NULL,
    effective_from     TIMESTAMPTZ NOT NULL DEFAULT now(),
    set_by             TEXT NOT NULL,
    reason             TEXT NOT NULL,
    CONSTRAINT authentication_event_retention_bounds CHECK (
        active_retention_days BETWEEN 365 AND 3650 AND archive_retention_days BETWEEN 365 AND 3650),
    CONSTRAINT authentication_event_retention_reason CHECK (btrim(set_by) <> '' AND btrim(reason) <> '')
);
CREATE INDEX authentication_event_retention_current ON authentication_event_retention_policies (tenant_id, effective_from DESC);

-- One row per archival operation an operator performs under authorization: WHAT window was exported, HOW MANY rows,
-- and the SHA-256 of the canonical export, so a restored archive can be proven identical. Append-only.
CREATE TABLE authentication_event_archive_manifests (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT REFERENCES tenants(id),
    window_start     TIMESTAMPTZ NOT NULL,
    window_end       TIMESTAMPTZ NOT NULL,
    row_count        INTEGER NOT NULL,
    export_sha256    TEXT NOT NULL,
    storage_location TEXT NOT NULL,
    recorded_by      TEXT NOT NULL,
    recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason           TEXT NOT NULL,
    CONSTRAINT authentication_event_archive_window CHECK (window_end > window_start),
    CONSTRAINT authentication_event_archive_digest CHECK (export_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT authentication_event_archive_count CHECK (row_count >= 0),
    CONSTRAINT authentication_event_archive_reason CHECK (btrim(recorded_by) <> '' AND btrim(reason) <> '')
);

CREATE FUNCTION authentication_event_governance_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    RAISE EXCEPTION '% is append-only: % would rewrite the security-event governance record', TG_TABLE_NAME, TG_OP;
END
$fn$;
CREATE TRIGGER authentication_event_retention_append_only BEFORE UPDATE OR DELETE ON authentication_event_retention_policies
    FOR EACH ROW EXECUTE FUNCTION authentication_event_governance_append_only();
CREATE TRIGGER authentication_event_archive_append_only BEFORE UPDATE OR DELETE ON authentication_event_archive_manifests
    FOR EACH ROW EXECUTE FUNCTION authentication_event_governance_append_only();
CREATE TRIGGER authentication_event_retention_no_truncate BEFORE TRUNCATE ON authentication_event_retention_policies
    FOR EACH STATEMENT EXECUTE FUNCTION authentication_event_governance_append_only();
CREATE TRIGGER authentication_event_archive_no_truncate BEFORE TRUNCATE ON authentication_event_archive_manifests
    FOR EACH STATEMENT EXECUTE FUNCTION authentication_event_governance_append_only();

-- Down Migration
SET search_path = eos_policy, public;

-- Credentials and their security record are not dropped while any exist; an empty schema reverses cleanly.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eos_policy.login_accounts) OR EXISTS (SELECT 1 FROM eos_policy.authentication_events)
       OR EXISTS (SELECT 1 FROM eos_policy.authentication_event_retention_policies)
       OR EXISTS (SELECT 1 FROM eos_policy.authentication_event_archive_manifests) THEN
        RAISE EXCEPTION 'refusing to drop EOS native login: login accounts or authentication events exist';
    END IF;
END
$$;

DROP TABLE authentication_event_archive_manifests;
DROP TABLE authentication_event_retention_policies;
DROP FUNCTION authentication_event_governance_append_only();
DROP TABLE authentication_events;
DROP FUNCTION authentication_events_append_only();
DROP TABLE login_mfa_challenges;
DROP TABLE login_recovery_codes;
DROP TABLE login_mfa_factors;
DROP TABLE login_refresh_tokens;
DROP TABLE login_sessions;
DROP FUNCTION login_sessions_guard();
DROP TABLE login_tickets;
DROP TABLE login_accounts;
DROP FUNCTION login_accounts_guard();
