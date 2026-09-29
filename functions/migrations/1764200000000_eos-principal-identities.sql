-- Up Migration
-- EOS PRINCIPAL IDENTITIES -- the additive identity binding for EOS-issued authentication.
-- Controller ruling 2026-09-29 ("EOS IDENTITY BOUNDARY", Option A refined).
-- docs/architecture/eos-identity-session-foundation.md, section 3(c).
--
-- ════════════════════ WHY THIS EXISTS ════════════════════
--
-- `principals` carries ONE (identity_provider, external_subject) pair -- today the Firebase UID -- under
-- principals_provider_subject_unique. EOS is building its own short-lived access token so Firebase
-- Authentication can later be retired. A Principal must therefore be reachable by an EOS identity AS WELL,
-- without a second Principal (which would split one human's Roles) and without moving the Firebase binding
-- (which would break Firebase sign-in, still the live path).
--
-- This table is that second binding: (identity_provider='eos', external_subject) -> principal_id. The
-- resolver (principalContext.resolvePrincipalByVerifiedIdentity) consults the primary columns first and then
-- an ACTIVE row here; everything after "which Principal" -- status, membership, tenant, the DQ-007 employment
-- gate, Roles, scopes, access version -- is unchanged and keyed on the Principal id.
--
-- ════════════════════ WHAT IT IS NOT ════════════════════
--
-- NOT authority: no Role, capability, scope or grant column. NOT tenant-scoped: identity is global, like
-- `principals`; tenancy comes from membership. NOT populated: no seed, no backfill. A binding is a governed
-- statement (policyCommands.bindPrincipalEosIdentity), audited in audit_events.
SET search_path = eos_policy, public;

CREATE TABLE principal_identities (
    id                TEXT PRIMARY KEY,
    principal_id      TEXT NOT NULL REFERENCES principals(id),
    identity_provider TEXT NOT NULL,
    external_subject  TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'active',
    created_by        TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason            TEXT NOT NULL,
    revoked_by        TEXT,
    revoked_at        TIMESTAMPTZ,
    revoke_reason     TEXT,
    -- EOS identities only. The Firebase binding stays on `principals`, where it has always been.
    CONSTRAINT principal_identities_provider_is_eos CHECK (identity_provider = 'eos'),
    CONSTRAINT principal_identities_subject_shape CHECK (external_subject ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
    CONSTRAINT principal_identities_status_known CHECK (status IN ('active', 'revoked')),
    CONSTRAINT principal_identities_author_present CHECK (btrim(created_by) <> ''),
    CONSTRAINT principal_identities_reason_present CHECK (btrim(reason) <> ''),
    CONSTRAINT principal_identities_revocation_recorded CHECK (
        (status = 'active' AND revoked_by IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND btrim(COALESCE(revoke_reason, '')) <> '')
    ),
    -- A subject names ONE Principal forever: a revoked subject is never re-issued to somebody else.
    CONSTRAINT principal_identities_provider_subject_unique UNIQUE (identity_provider, external_subject)
);

-- One ACTIVE EOS identity per Principal. Revoked rows are history and unconstrained.
CREATE UNIQUE INDEX principal_identities_one_active_per_principal
    ON principal_identities (principal_id, identity_provider) WHERE status = 'active';

-- A binding may not claim a pair that is already some Principal's PRIMARY identity: two Principals answering
-- to one subject is the split this whole model exists to prevent.
CREATE FUNCTION principal_identities_not_a_primary() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    IF EXISTS (SELECT 1 FROM eos_policy.principals
                WHERE identity_provider = NEW.identity_provider AND external_subject = NEW.external_subject) THEN
        RAISE EXCEPTION 'PRINCIPAL_IDENTITY_IS_A_PRIMARY: that identity is already a principal''s primary binding'
            USING ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER principal_identities_not_a_primary
    BEFORE INSERT ON principal_identities
    FOR EACH ROW EXECUTE FUNCTION principal_identities_not_a_primary();

-- APPEND-ONLY. The only permitted change is REVOKING an active row, once. Never deleted.
CREATE FUNCTION principal_identities_revoke_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'PRINCIPAL_IDENTITY_APPEND_ONLY: an identity binding is history and is never deleted';
    END IF;
    IF OLD.status <> 'active' OR NEW.status <> 'revoked'
       OR NEW.id <> OLD.id OR NEW.principal_id <> OLD.principal_id
       OR NEW.identity_provider <> OLD.identity_provider OR NEW.external_subject <> OLD.external_subject
       OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.reason <> OLD.reason THEN
        RAISE EXCEPTION 'PRINCIPAL_IDENTITY_APPEND_ONLY: an identity binding may only be revoked, once';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER principal_identities_revoke_only
    BEFORE UPDATE OR DELETE ON principal_identities
    FOR EACH ROW EXECUTE FUNCTION principal_identities_revoke_only();

-- Down Migration
SET search_path = eos_policy, public;

-- A binding is a governed statement with audit history. Refuse to destroy it while any exists; an empty
-- table reverses cleanly.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eos_policy.principal_identities) THEN
        RAISE EXCEPTION 'refusing to drop principal_identities: EOS identity bindings exist';
    END IF;
END
$$;

DROP TABLE principal_identities;
DROP FUNCTION principal_identities_revoke_only();
DROP FUNCTION principal_identities_not_a_primary();
