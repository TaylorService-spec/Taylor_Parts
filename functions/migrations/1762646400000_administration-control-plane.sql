-- Up Migration
-- THE ADMINISTRATION CONTROL PLANE -- schema for governed Role -> capability DECISIONS, immutable
-- audit, fail-closed grant conditions, and the ONE missing Administration write capability.
--
-- Owner requirement (2026-09-26): EOS Administration is the operational control plane. Routine
-- grant / revoke / condition changes are made through the Admin UI -> governed PostgreSQL -> the
-- shared server evaluator, and need NO migration, code edit, deploy or Firebase change. This file is
-- schema plus one bootstrap vocabulary row and its parity grant -- the legitimate migration uses.
-- It records NO tenant decision and changes NO business grant.
--
-- ════════════════════ 1. role_capability_decisions (append-only) ════════════════════
--
-- `role_capabilities` stays the EFFECTIVE authority the runtime reads -- unchanged, no new column
-- (conditionalEntitlementPostgres.test.mjs pins its shape). What was missing is WHY a row is there
-- or is not: an Administration revoke of a catalog-default pair was undone by the next catalog
-- reconcile, and an Administration grant read as UNEXPLAINED drift. So every Administration
-- grant/revoke appends ONE decision row here, in the SAME transaction as the effective row change
-- and the audit event it names:
--
--     ADMIN_GRANTED   the Role holds the capability because an administrator decided so
--     ADMIN_REVOKED   the Role does NOT hold it because an administrator decided so -- a default
--                     (catalog / migration re-derivation / environment activation) must never
--                     re-insert it
--
-- One CURRENT decision per (tenant, role, capability) -- the partial unique index -- and every prior
-- one is kept, SUPERSEDED, as history. The row is immutable except for that single supersession
-- stamp; the trigger refuses anything else, including DELETE.
--
-- PRECEDENCE (functions/src/adminPolicy/roleCapabilityAdministration.ts):
--     SYSTEM_INVARIANT (forbidden pair)  >  current ADMIN decision  >  SYSTEM_DEFAULT
--
-- ════════════════════ 2. audit_events becomes immutable ════════════════════
--
-- Every governed mutation appends one audit event; nothing in the repository updates or deletes one.
-- The table had no guard, so "the audit trail is append-only" was a convention. It is now enforced.
--
-- ════════════════════ 3. a grant condition can never be lifted into ALL ════════════════════
--
-- Retiring (or deleting) an ACTIVE condition while the grant it narrows is still held would widen
-- that grant to every record in one step -- e.g. a technician's RECORD_ASSIGNMENT read becoming a
-- tenant-wide read. The trigger refuses it. To widen deliberately an administrator revokes the
-- grant, retires the condition, and re-grants: three audited acts, never an accident.
--
-- ════════════════════ 4. admin.securityPolicy.write ════════════════════
--
-- Administration mutations were authorized by the Role NAME `admin` (administrationAuthority.ts).
-- They are now authorized by capabilities, and the vocabulary needed exactly ONE new key:
--
--     admin.securityPolicy.write   rolesPermissions / editSecurityPolicy   NEW    -> admin
--     admin.roleAssignment.write   rolesPermissions / assignRole           EXISTS (1761609600000: admin, owner)
--
-- generalManager is DELIBERATELY NOT GRANTED admin.roleAssignment.write. Two Owner rulings conflict:
-- the engine invariant (ROLE_ASSIGNMENT_ROLE_KEYS, 2026-09-08) let generalManager assign Roles, while
-- the 2026-08-21 ruling pinned by test/generalManagerNoAdmin.test.mjs says General Manager holds NO
-- security administration and names admin.roleAssignment.write as its self-escalation hazard, and
-- migration 1762041600000 already declined to "invent a grant decision" to match the invariant.
-- Moving the gate to the capability therefore NARROWS generalManager (fail closed) and the conflict
-- is reported for the Owner. Restoring it is now an ADMINISTRATION act -- grantObjectActionToRole
-- (rolesPermissions / assignRole -> generalManager) -- not a migration.
--
-- Counts: capabilities +1, role_capabilities +1 per tenant that defines admin.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        RAISE EXCEPTION 'ADMINISTRATION_CONTROL_PLANE: role_capability_decisions already exists -- refusing to adopt an unreviewed relation';
    END IF;
    IF to_regclass('eos_policy.capability_grant_conditions') IS NULL THEN
        RAISE EXCEPTION 'ADMINISTRATION_CONTROL_PLANE: capability_grant_conditions (migration 1762214400000) is missing';
    END IF;
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'admin.roleAssignment.write' AND object_key = 'rolesPermissions'
       AND action_key = 'assignRole' AND action_kind = 'ADMIN_ACTION';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'ADMINISTRATION_CONTROL_PLANE: admin.roleAssignment.write is not the reviewed rolesPermissions/assignRole ADMIN_ACTION';
    END IF;
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'admin.securityPolicy.write' OR (object_key = 'rolesPermissions' AND action_key = 'editSecurityPolicy');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ADMINISTRATION_CONTROL_PLANE: admin.securityPolicy.write / rolesPermissions.editSecurityPolicy is already registered';
    END IF;
END
$$;

-- ── 1 ──
-- audit_events gains a (tenant_id, id) key so every reference to an audit event can be TENANT-COMPOSITE.
ALTER TABLE audit_events ADD CONSTRAINT audit_events_tenant_id_key UNIQUE (tenant_id, id);

CREATE TABLE role_capability_decisions (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL REFERENCES tenants(id),
    role_key            TEXT NOT NULL,
    capability_key      TEXT NOT NULL REFERENCES capabilities(key),
    decision            TEXT NOT NULL CHECK (decision IN ('ADMIN_GRANTED','ADMIN_REVOKED')),
    requires_condition  BOOLEAN NOT NULL DEFAULT false,
    reason              TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
    actor_principal_id  TEXT NOT NULL,
    audit_event_id      TEXT NOT NULL,
    decided_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at       TIMESTAMPTZ,
    superseded_by       TEXT,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, role_key) REFERENCES roles(tenant_id, key),
    -- TENANT-COMPOSITE: a decision can only name an audit event, and a successor, of its OWN tenant.
    FOREIGN KEY (tenant_id, audit_event_id) REFERENCES audit_events(tenant_id, id),
    FOREIGN KEY (tenant_id, superseded_by) REFERENCES role_capability_decisions(tenant_id, id) DEFERRABLE INITIALLY DEFERRED,
    CHECK (decision = 'ADMIN_GRANTED' OR requires_condition = false),
    CHECK ((superseded_at IS NULL) = (superseded_by IS NULL)),
    CHECK (superseded_by IS NULL OR superseded_by <> id),
    -- ONE CURRENT DECISION PER CELL, checked at COMMIT: the successor is inserted first and the
    -- predecessor stamped after, so the stamp can be verified against a row that already exists.
    EXCLUDE USING btree (tenant_id WITH =, role_key WITH =, capability_key WITH =)
        WHERE (superseded_at IS NULL) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX role_capability_decisions_by_tenant
    ON role_capability_decisions (tenant_id, decided_at DESC);
CREATE INDEX role_capability_decisions_by_cell
    ON role_capability_decisions (tenant_id, role_key, capability_key) WHERE superseded_at IS NULL;

CREATE FUNCTION role_capability_decisions_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
DECLARE
    v_ok INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'role_capability_decisions is append-only: DELETE would destroy an Administration decision';
    END IF;
    IF OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL AND NEW.superseded_by IS NOT NULL
       AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id AND NEW.role_key = OLD.role_key
       AND NEW.capability_key = OLD.capability_key AND NEW.decision = OLD.decision
       AND NEW.requires_condition = OLD.requires_condition AND NEW.reason = OLD.reason
       AND NEW.actor_principal_id = OLD.actor_principal_id AND NEW.audit_event_id = OLD.audit_event_id
       AND NEW.decided_at = OLD.decided_at
       -- The stamp is NOW, not backdated or forward-dated, and never before the decision it closes.
       AND NEW.superseded_at >= OLD.decided_at
       AND NEW.superseded_at BETWEEN now() - interval '1 minute' AND now() + interval '1 minute' THEN
        -- ...and it names an EXISTING successor: same tenant, same cell, decided no earlier, still current.
        SELECT count(*) INTO v_ok FROM role_capability_decisions s
         WHERE s.id = NEW.superseded_by AND s.tenant_id = OLD.tenant_id AND s.role_key = OLD.role_key
           AND s.capability_key = OLD.capability_key AND s.decided_at >= OLD.decided_at AND s.superseded_at IS NULL;
        IF v_ok = 1 THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'role_capability_decisions is append-only: a decision may be superseded only by the current decision for the SAME cell in the SAME tenant';
    END IF;
    RAISE EXCEPTION 'role_capability_decisions is append-only: only a current decision may be superseded, once, now';
END
$fn$;
CREATE TRIGGER role_capability_decisions_append_only
    BEFORE UPDATE OR DELETE ON role_capability_decisions
    FOR EACH ROW EXECUTE FUNCTION role_capability_decisions_append_only();

-- ── 2: append-only audit, and no TRUNCATE of any governed history ──
CREATE FUNCTION audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only: % would rewrite the record of a governed change', TG_OP;
END
$fn$;
CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- Row triggers do not fire on TRUNCATE; a statement trigger does.
CREATE FUNCTION governed_history_no_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    RAISE EXCEPTION '% is governed history: TRUNCATE is refused', TG_TABLE_NAME;
END
$fn$;
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION governed_history_no_truncate();
CREATE TRIGGER role_capability_decisions_no_truncate BEFORE TRUNCATE ON role_capability_decisions
    FOR EACH STATEMENT EXECUTE FUNCTION governed_history_no_truncate();
CREATE TRIGGER capability_grant_conditions_no_truncate BEFORE TRUNCATE ON capability_grant_conditions
    FOR EACH STATEMENT EXECUTE FUNCTION governed_history_no_truncate();

-- Filtered audit history (Administration audit read): tenant-scoped time order, actor, and JSONB
-- containment over the before/after payloads.
CREATE INDEX audit_events_by_tenant_actor ON audit_events (tenant_id, actor_uid, occurred_at DESC);
CREATE INDEX audit_events_after_gin  ON audit_events USING gin (after jsonb_path_ops);
CREATE INDEX audit_events_before_gin ON audit_events USING gin (before jsonb_path_ops);

-- ── 3: the GRANT CELL is serialized, and a condition can never be lifted into ALL ──
--
-- One advisory lock per (tenant, ROLE, role key, capability key), taken by EVERY writer of the cell:
-- the grant insert (trigger below), the condition retire/delete (trigger below), and the Administration
-- commands. READ COMMITTED gives each statement in these volatile functions a fresh snapshot, so the
-- check that follows the lock sees whatever the lock holder committed.
CREATE FUNCTION grant_cell_lock(p_tenant TEXT, p_scope TEXT, p_grantor TEXT, p_capability TEXT) RETURNS void
LANGUAGE sql AS $fn$
    SELECT pg_advisory_xact_lock(hashtextextended('grant-cell|' || p_tenant || '|' || p_scope || '|' || p_grantor || '|' || p_capability, 0));
$fn$;

CREATE FUNCTION capability_grant_conditions_never_widen() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
DECLARE
    v_held INT := 0;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.tenant_id <> OLD.tenant_id OR NEW.grant_scope <> OLD.grant_scope
        OR NEW.grantor_key <> OLD.grantor_key OR NEW.capability_key <> OLD.capability_key) THEN
        RAISE EXCEPTION 'capability_grant_conditions: a condition''s grant cell is its identity and never changes';
    END IF;
    IF OLD.status = 'ACTIVE' AND (TG_OP = 'DELETE' OR NEW.status <> 'ACTIVE') THEN
        PERFORM grant_cell_lock(OLD.tenant_id, OLD.grant_scope, OLD.grantor_key, OLD.capability_key);
        IF OLD.grant_scope = 'ROLE' THEN
            SELECT count(*) INTO v_held
              FROM eos_policy.role_capabilities rc
              JOIN eos_policy.roles r        ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
              JOIN eos_policy.capabilities c ON c.id = rc.capability_id
             WHERE rc.tenant_id = OLD.tenant_id AND r.key = OLD.grantor_key AND c.key = OLD.capability_key;
        ELSE
            SELECT count(*) INTO v_held
              FROM eos_policy.principal_capabilities pc
              JOIN eos_policy.capabilities c ON c.id = pc.capability_id
             WHERE pc.tenant_id = OLD.tenant_id AND pc.principal_id = OLD.grantor_key AND c.key = OLD.capability_key;
        END IF;
        IF v_held > 0 THEN
            RAISE EXCEPTION 'CONDITION_RETIREMENT_WOULD_WIDEN: % %/% is still granted; lifting its condition would widen it to every record -- revoke the grant first',
                OLD.grant_scope, OLD.grantor_key, OLD.capability_key;
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END
$fn$;
CREATE TRIGGER capability_grant_conditions_never_widen
    BEFORE UPDATE OR DELETE ON capability_grant_conditions
    FOR EACH ROW EXECUTE FUNCTION capability_grant_conditions_never_widen();

-- EVERY INSERT of a Role grant takes the cell lock, then honours the cell's CURRENT decision:
--   ADMIN_REVOKED                          -> refused (no default writer re-inserts a revoke)
--   ADMIN_GRANTED with requires_condition  -> refused unless an ACTIVE condition narrows it
-- The Administration command itself marks its transaction (eos_policy.administration_command) and
-- is exempt: it IS the decision, and it validates both rules itself, inside the same lock.
CREATE FUNCTION role_capabilities_honour_decisions() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
DECLARE
    v_role TEXT;
    v_cap  TEXT;
    v_decision TEXT;
    v_requires BOOLEAN;
    v_active INT;
BEGIN
    SELECT key INTO v_role FROM eos_policy.roles WHERE id = NEW.role_id AND tenant_id = NEW.tenant_id;
    SELECT key INTO v_cap  FROM eos_policy.capabilities WHERE id = NEW.capability_id;
    IF v_role IS NULL OR v_cap IS NULL THEN RETURN NEW; END IF; -- the FKs refuse it
    PERFORM grant_cell_lock(NEW.tenant_id, 'ROLE', v_role, v_cap);
    IF coalesce(current_setting('eos_policy.administration_command', true), '') = 'on' THEN RETURN NEW; END IF;
    SELECT decision, requires_condition INTO v_decision, v_requires
      FROM eos_policy.role_capability_decisions
     WHERE tenant_id = NEW.tenant_id AND role_key = v_role AND capability_key = v_cap AND superseded_at IS NULL;
    IF v_decision = 'ADMIN_REVOKED' THEN
        RAISE EXCEPTION 'ADMIN_REVOKED: %/% was revoked through EOS Administration; a default writer may not re-insert it', v_role, v_cap;
    END IF;
    IF v_decision = 'ADMIN_GRANTED' AND v_requires THEN
        SELECT count(*) INTO v_active FROM eos_policy.capability_grant_conditions
         WHERE tenant_id = NEW.tenant_id AND grant_scope = 'ROLE' AND grantor_key = v_role
           AND capability_key = v_cap AND status = 'ACTIVE';
        IF v_active = 0 THEN
            RAISE EXCEPTION 'CONDITION_REQUIRED: %/% requires an ACTIVE condition and has none', v_role, v_cap;
        END IF;
    END IF;
    RETURN NEW;
END
$fn$;
CREATE TRIGGER role_capabilities_honour_decisions
    BEFORE INSERT ON role_capabilities
    FOR EACH ROW EXECUTE FUNCTION role_capabilities_honour_decisions();

-- ── 5: a direct Principal grant is a governed EXCEPTION ──
-- Additive. `exception_reason` records why the exception exists (required by the command on every new
-- grant; NULL only on rows that predate this column, of which nonprod holds none). `expires_at` lapses
-- it: readers ignore an expired row, so an exception cannot outlive the reason it was made for.
ALTER TABLE principal_capabilities
    ADD COLUMN exception_reason TEXT CHECK (exception_reason IS NULL OR length(btrim(exception_reason)) > 0),
    ADD COLUMN expires_at       TIMESTAMPTZ;

-- ── 4 ──
INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_admin_securityPolicy_write', 'admin.securityPolicy.write',
     'Change the tenant security policy through Administration: grant or revoke an Object action for a Security Role or a Principal, set or retire the condition on a grant, and edit Role and Object definitions. Does not assign Roles (admin.roleAssignment.write) and does not administer Workflows.',
     'rolesPermissions', 'editSecurityPolicy', 'ADMIN_ACTION', 'Edit Security Policy')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_x_' || substr(md5(r.tenant_id || r.id || c.id), 1, 26),
       r.tenant_id, r.id, c.id,
       'migration:1762646400000', now(), 'migration:1762646400000', now(), 'migration:1762646400000', now()
  FROM (VALUES
        ('admin', 'admin.securityPolicy.write')
      ) AS g(role_key, capability_key)
  JOIN roles        r ON r.key = g.role_key
  JOIN capabilities c ON c.key = g.capability_key
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. Administration decisions are recorded policy; a rollback does not get to destroy them.
DO $$
DECLARE
    v_n INT;
BEGIN
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions;
        IF v_n > 0 THEN
            RAISE EXCEPTION 'ADMINISTRATION_CONTROL_PLANE: refuses to reverse -- % Administration decision(s) exist', v_n;
        END IF;
    END IF;

    DELETE FROM role_capabilities
     WHERE granted_by = 'migration:1762646400000'
       AND capability_id = 'cap_admin_securityPolicy_write';

    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id = 'cap_admin_securityPolicy_write';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ADMINISTRATION_CONTROL_PLANE: refuses to reverse -- admin.securityPolicy.write is held by % grant(s) this migration did not write', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id = 'cap_admin_securityPolicy_write';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ADMINISTRATION_CONTROL_PLANE: refuses to reverse -- admin.securityPolicy.write is held by % direct grant(s)', v_n;
    END IF;
    DELETE FROM capabilities WHERE id = 'cap_admin_securityPolicy_write';

    SELECT count(*) INTO v_n FROM principal_capabilities WHERE exception_reason IS NOT NULL OR expires_at IS NOT NULL;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ADMINISTRATION_CONTROL_PLANE: refuses to reverse -- % direct grant(s) carry an exception reason or expiry', v_n;
    END IF;
END
$$;

ALTER TABLE principal_capabilities DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS exception_reason;

DROP TRIGGER IF EXISTS role_capabilities_honour_decisions ON role_capabilities;
DROP FUNCTION IF EXISTS role_capabilities_honour_decisions();
DROP TRIGGER IF EXISTS capability_grant_conditions_never_widen ON capability_grant_conditions;
DROP FUNCTION IF EXISTS capability_grant_conditions_never_widen();
DROP FUNCTION IF EXISTS grant_cell_lock(TEXT, TEXT, TEXT, TEXT);
DROP INDEX IF EXISTS audit_events_before_gin;
DROP INDEX IF EXISTS audit_events_after_gin;
DROP INDEX IF EXISTS audit_events_by_tenant_actor;
DROP TRIGGER IF EXISTS capability_grant_conditions_no_truncate ON capability_grant_conditions;
DROP TRIGGER IF EXISTS role_capability_decisions_no_truncate ON role_capability_decisions;
DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;
DROP FUNCTION IF EXISTS governed_history_no_truncate();
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
DROP FUNCTION IF EXISTS audit_events_append_only();
DROP TABLE IF EXISTS role_capability_decisions;
DROP FUNCTION IF EXISTS role_capability_decisions_append_only();
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_tenant_id_key;
