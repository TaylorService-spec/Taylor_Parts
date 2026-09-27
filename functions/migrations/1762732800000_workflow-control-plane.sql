-- Up Migration
-- THE WORKFLOW CONTROL PLANE -- lifecycle, active version, action authority binding, pinning.
--
-- Administration is the control plane for workflows as well as for security policy. This file
-- adds ONLY the governed configuration and its database-level guards. It rewrites no workflow
-- engine and no domain lifecycle, it grants NO capability (migrationChainSafety forbids a
-- migration granting any workflowDefinition.* key other than the ruled read), and it registers no
-- capability. Workflow administration authority is assigned through Administration after
-- bootstrap (grantObjectActionToRole on the workflowDefinition Object) -- never by a migration.
--
-- ════════════════════ WHAT MOVES ════════════════════
--
--   workflows.active_version_id           the ONE version new instances start on. PUBLISHED only,
--                                         same workflow, same tenant (composite FK + trigger).
--   workflow_versions lifecycle           DRAFT -> PUBLISHED -> RETIRED, and DRAFT -> RETIRED
--                                         (an abandoned draft). Nothing else. A version that is
--                                         active, or pinned by an instance, cannot be RETIRED.
--   steps / actions / bindings            IMMUTABLE unless their version is a DRAFT (trigger).
--   workflow_actions.capability_key       the capability the action IS (FK capabilities.key).
--                                         A binding never grants: runtime decision is
--                                         WORKFLOW_BINDING AND EFFECTIVE_AUTHORITY(capability_key).
--   workflow_actions.guard_kind           closed list of EXISTING evaluator primitives. Today:
--                                         RECORD_ASSIGNMENT (contextualAuthorization's
--                                         ASSIGNED_EMPLOYEE relation). requires_own_assignment is
--                                         kept as the legacy spelling and must agree with it.
--   workflow_role_bindings.binding_kind   SECURITY_ROLE today. FUNCTIONAL_ROLE is the documented
--                                         extension point (pass8 census): it may only ever
--                                         NARROW, and until an evaluator exists it is refused by
--                                         publish validation (UNSUPPORTED_BINDING_KIND) and by
--                                         the engine. No Functional Role table is invented here.
--   workflow_instances                    may only pin a PUBLISHED version.
--   workflow_instance_events              event_kind START/TRANSITION/ADOPT/MIGRATE, the Principal
--                                         actor, version movement, and the audit event that
--                                         recorded an administrative act. Append-only.
--
-- Counts: tables unchanged; capabilities unchanged; role_capabilities unchanged.
SET search_path = eos_policy, public;

-- ════════════════════ active version pointer ════════════════════

ALTER TABLE workflow_versions
    ADD CONSTRAINT workflow_versions_identity UNIQUE (id, workflow_id, tenant_id);

ALTER TABLE workflows ADD COLUMN active_version_id TEXT NULL;
ALTER TABLE workflows
    ADD CONSTRAINT workflows_active_version_same_workflow
    FOREIGN KEY (active_version_id, id, tenant_id)
    REFERENCES workflow_versions (id, workflow_id, tenant_id);

CREATE FUNCTION workflows_active_version_is_published() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_status eos_policy.workflow_version_status;
BEGIN
    IF NEW.active_version_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT status INTO v_status FROM eos_policy.workflow_versions WHERE id = NEW.active_version_id;
    IF v_status IS DISTINCT FROM 'PUBLISHED' THEN
        RAISE EXCEPTION 'WORKFLOW_ACTIVE_VERSION_NOT_PUBLISHED: the active version must be PUBLISHED (it is %)', v_status;
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER workflows_active_version_is_published
    BEFORE INSERT OR UPDATE OF active_version_id ON workflows
    FOR EACH ROW EXECUTE FUNCTION workflows_active_version_is_published();

-- ════════════════════ version lifecycle ════════════════════

CREATE FUNCTION workflow_versions_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_pinned INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'WORKFLOW_VERSION_IMMUTABLE: a workflow version is never deleted';
    END IF;
    IF NEW.id <> OLD.id OR NEW.workflow_id <> OLD.workflow_id OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.version <> OLD.version THEN
        RAISE EXCEPTION 'WORKFLOW_VERSION_IMMUTABLE: a workflow version''s identity cannot change';
    END IF;
    IF NEW.status = OLD.status THEN
        -- Only the provenance stamp may move without a status change, and only on a DRAFT.
        IF OLD.status <> 'DRAFT' AND (NEW.published_at IS DISTINCT FROM OLD.published_at
                                      OR NEW.published_by IS DISTINCT FROM OLD.published_by) THEN
            RAISE EXCEPTION 'WORKFLOW_VERSION_IMMUTABLE: a % version cannot be edited', OLD.status;
        END IF;
        RETURN NEW;
    END IF;
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('PUBLISHED', 'RETIRED'))
            OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED')) THEN
        RAISE EXCEPTION 'WORKFLOW_INVALID_LIFECYCLE: % -> % is not a workflow version transition', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'RETIRED' THEN
        IF EXISTS (SELECT 1 FROM eos_policy.workflows w WHERE w.active_version_id = OLD.id) THEN
            RAISE EXCEPTION 'WORKFLOW_VERSION_ACTIVE: the active version cannot be retired';
        END IF;
        SELECT count(*) INTO v_pinned FROM eos_policy.workflow_instances WHERE workflow_version_id = OLD.id;
        IF v_pinned > 0 THEN
            RAISE EXCEPTION 'WORKFLOW_VERSION_PINNED: % live instance(s) are pinned to this version', v_pinned;
        END IF;
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER workflow_versions_lifecycle
    BEFORE UPDATE OR DELETE ON workflow_versions
    FOR EACH ROW EXECUTE FUNCTION workflow_versions_lifecycle();

-- ════════════════════ action authority binding ════════════════════

ALTER TABLE workflow_actions ADD COLUMN capability_key TEXT NULL REFERENCES capabilities (key);
ALTER TABLE workflow_actions ADD COLUMN guard_kind TEXT NULL;
ALTER TABLE workflow_actions
    ADD CONSTRAINT workflow_actions_guard_kind_known CHECK (guard_kind IS NULL OR guard_kind IN ('RECORD_ASSIGNMENT'));

-- The legacy flag is the RECORD_ASSIGNMENT guard. Backfilled BEFORE the immutability trigger
-- exists, because it describes what every stored row already meant rather than editing it.
UPDATE workflow_actions SET guard_kind = 'RECORD_ASSIGNMENT' WHERE requires_own_assignment;

ALTER TABLE workflow_actions
    ADD CONSTRAINT workflow_actions_guard_agrees_with_legacy_flag
    CHECK (requires_own_assignment = (guard_kind IS NOT DISTINCT FROM 'RECORD_ASSIGNMENT'));

-- A writer that knows only the legacy flag (the seed-boundary replay, an older adapter) still
-- produces a consistent row: the flag implies the guard.
CREATE FUNCTION workflow_actions_guard_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.guard_kind IS NULL AND NEW.requires_own_assignment THEN
        NEW.guard_kind := 'RECORD_ASSIGNMENT';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER workflow_actions_guard_sync
    BEFORE INSERT OR UPDATE ON workflow_actions
    FOR EACH ROW EXECUTE FUNCTION workflow_actions_guard_sync();

ALTER TABLE workflow_role_bindings ADD COLUMN binding_kind TEXT NOT NULL DEFAULT 'SECURITY_ROLE';
ALTER TABLE workflow_role_bindings
    ADD CONSTRAINT workflow_role_bindings_kind_known CHECK (binding_kind IN ('SECURITY_ROLE', 'FUNCTIONAL_ROLE'));

-- ════════════════════ definition immutability ════════════════════

CREATE FUNCTION workflow_definition_rows_draft_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_version_id TEXT;
    v_status     eos_policy.workflow_version_status;
BEGIN
    v_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.workflow_version_id ELSE NEW.workflow_version_id END;
    SELECT status INTO v_status FROM eos_policy.workflow_versions WHERE id = v_version_id;
    IF v_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'WORKFLOW_VERSION_IMMUTABLE: % on % of a % version', TG_OP, TG_TABLE_NAME, v_status;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.workflow_version_id <> OLD.workflow_version_id THEN
        RAISE EXCEPTION 'WORKFLOW_VERSION_IMMUTABLE: a definition row cannot move between versions';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER workflow_steps_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON workflow_steps
    FOR EACH ROW EXECUTE FUNCTION workflow_definition_rows_draft_only();
CREATE TRIGGER workflow_actions_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON workflow_actions
    FOR EACH ROW EXECUTE FUNCTION workflow_definition_rows_draft_only();
CREATE TRIGGER workflow_role_bindings_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON workflow_role_bindings
    FOR EACH ROW EXECUTE FUNCTION workflow_definition_rows_draft_only();

-- ════════════════════ instances pin a PUBLISHED version ════════════════════

CREATE FUNCTION workflow_instances_pin_published() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_status eos_policy.workflow_version_status;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.workflow_version_id = OLD.workflow_version_id THEN
        RETURN NEW;
    END IF;
    SELECT status INTO v_status FROM eos_policy.workflow_versions
     WHERE id = NEW.workflow_version_id AND tenant_id = NEW.tenant_id;
    IF v_status IS DISTINCT FROM 'PUBLISHED' THEN
        RAISE EXCEPTION 'WORKFLOW_INSTANCE_VERSION_NOT_PUBLISHED: an instance may only pin a PUBLISHED version (it is %)', v_status;
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER workflow_instances_pin_published
    BEFORE INSERT OR UPDATE OF workflow_version_id ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION workflow_instances_pin_published();

-- ════════════════════ instance events ════════════════════

ALTER TABLE workflow_instance_events ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'TRANSITION';
ALTER TABLE workflow_instance_events
    ADD CONSTRAINT workflow_instance_events_kind_known
    CHECK (event_kind IN ('START', 'TRANSITION', 'ADOPT', 'MIGRATE'));
-- The actor is a PRINCIPAL. actor_uid stays for the rows written before this column existed.
ALTER TABLE workflow_instance_events ADD COLUMN actor_principal_id TEXT NULL;
ALTER TABLE workflow_instance_events ADD COLUMN from_version_id TEXT NULL;
ALTER TABLE workflow_instance_events ADD COLUMN to_version_id TEXT NULL;
ALTER TABLE workflow_instance_events ADD COLUMN audit_event_id TEXT NULL REFERENCES audit_events (id);
ALTER TABLE workflow_instance_events
    ADD CONSTRAINT workflow_instance_events_admin_acts_audited
    CHECK (event_kind NOT IN ('ADOPT', 'MIGRATE') OR audit_event_id IS NOT NULL);

CREATE FUNCTION workflow_instance_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'WORKFLOW_INSTANCE_EVENTS_APPEND_ONLY: % is refused', TG_OP;
END
$$;

CREATE TRIGGER workflow_instance_events_append_only
    BEFORE UPDATE OR DELETE ON workflow_instance_events
    FOR EACH ROW EXECUTE FUNCTION workflow_instance_events_append_only();

CREATE INDEX workflow_instances_by_version ON workflow_instances (tenant_id, workflow_version_id);


-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. Published lifecycle facts, active pointers and administrative instance events are
-- recorded policy; a rollback does not get to erase them. A DRAFT is not yet recorded policy: its
-- rows are editable by definition and a canonical-seed draft is replayed from the seed, so capability
-- bindings and non-Security-Role bindings on a DRAFT version do not block the reversal.
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM workflows WHERE active_version_id IS NOT NULL;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORKFLOW_CONTROL_PLANE: refuses to reverse -- % workflow(s) have an active version', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM workflow_instance_events WHERE event_kind <> 'TRANSITION' OR actor_principal_id IS NOT NULL;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORKFLOW_CONTROL_PLANE: refuses to reverse -- % governed instance event(s) exist', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM workflow_actions a JOIN workflow_versions v ON v.id = a.workflow_version_id
     WHERE a.capability_key IS NOT NULL AND v.status <> 'DRAFT';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORKFLOW_CONTROL_PLANE: refuses to reverse -- % workflow action(s) are bound to a capability', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM workflow_role_bindings b JOIN workflow_versions v ON v.id = b.workflow_version_id
     WHERE b.binding_kind <> 'SECURITY_ROLE' AND v.status <> 'DRAFT';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORKFLOW_CONTROL_PLANE: refuses to reverse -- % non-Security-Role binding(s) exist', v_n;
    END IF;
END
$$;

DROP INDEX IF EXISTS workflow_instances_by_version;
DROP TRIGGER IF EXISTS workflow_instance_events_append_only ON workflow_instance_events;
DROP FUNCTION IF EXISTS workflow_instance_events_append_only();
ALTER TABLE workflow_instance_events
    DROP CONSTRAINT IF EXISTS workflow_instance_events_admin_acts_audited,
    DROP CONSTRAINT IF EXISTS workflow_instance_events_kind_known,
    DROP COLUMN IF EXISTS audit_event_id,
    DROP COLUMN IF EXISTS to_version_id,
    DROP COLUMN IF EXISTS from_version_id,
    DROP COLUMN IF EXISTS actor_principal_id,
    DROP COLUMN IF EXISTS event_kind;

DROP TRIGGER IF EXISTS workflow_instances_pin_published ON workflow_instances;
DROP FUNCTION IF EXISTS workflow_instances_pin_published();

DROP TRIGGER IF EXISTS workflow_role_bindings_draft_only ON workflow_role_bindings;
DROP TRIGGER IF EXISTS workflow_actions_draft_only ON workflow_actions;
DROP TRIGGER IF EXISTS workflow_steps_draft_only ON workflow_steps;
DROP FUNCTION IF EXISTS workflow_definition_rows_draft_only();

ALTER TABLE workflow_role_bindings
    DROP CONSTRAINT IF EXISTS workflow_role_bindings_kind_known,
    DROP COLUMN IF EXISTS binding_kind;
DROP TRIGGER IF EXISTS workflow_actions_guard_sync ON workflow_actions;
DROP FUNCTION IF EXISTS workflow_actions_guard_sync();
ALTER TABLE workflow_actions
    DROP CONSTRAINT IF EXISTS workflow_actions_guard_agrees_with_legacy_flag,
    DROP CONSTRAINT IF EXISTS workflow_actions_guard_kind_known,
    DROP COLUMN IF EXISTS guard_kind,
    DROP COLUMN IF EXISTS capability_key;

DROP TRIGGER IF EXISTS workflow_versions_lifecycle ON workflow_versions;
DROP FUNCTION IF EXISTS workflow_versions_lifecycle();
DROP TRIGGER IF EXISTS workflows_active_version_is_published ON workflows;
DROP FUNCTION IF EXISTS workflows_active_version_is_published();
ALTER TABLE workflows
    DROP CONSTRAINT IF EXISTS workflows_active_version_same_workflow,
    DROP COLUMN IF EXISTS active_version_id;
ALTER TABLE workflow_versions DROP CONSTRAINT IF EXISTS workflow_versions_identity;
