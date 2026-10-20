-- Up Migration
-- G-1 PERFORMANCE-GOAL AUTHORING ON EOS (Firebase exit; Owner direction 2026-10-19 "Restore complete EOS goal authoring"; resolves OD-B4-3), nonprod. GRANT-BEARING (Owner ruling E):
-- roleCapabilityAuthorityBaseline.json carries the same 32 pairs.
--
-- WHAT THIS CHANGES (and nothing else):
--   1. performance_goal_commands: the idempotency record of the three authoring commands (key -> command + request fingerprint + stored result), so a replay writes nothing.
--      Keyed PER ACTOR, as supplier_po_commands is. The goal rows themselves (eos_ops.performance_goals, migration 1764640000000) are unchanged: a goal authored here is
--      provenance NATIVE with the EOS Principal id as author / approver.
--   1b. performance_goals gains author_employee_id (nullable: a copied row has none): the Employee linked to the AUTHOR at draft time, so two-person approval rests on distinct
--      Employees and a later relink of that Employee to a new Principal does not make a second person. And the approval-evidence CHECK is widened for ONE case: a DRAFT that is
--      RETIRED (its disposition -- never measured) carries no approver. DRAFT still has none, APPROVED / SUPERSEDED still must have one, RETIRED has both or neither.
--   2. FOUR capabilities REGISTERED on the existing `performanceGoal` Object, under the Firebase catalog's own ids (functions/src/access/permissionCatalog.ts):
--      performance.goal.create, .approve, .supersede, .retire. (The brief named three; the Firebase catalog and commands have FOUR write verbs -- a version that names a
--      predecessor asks .supersede -- so all four are mirrored, or "replace a target in force" would disappear.)
--   3. 32 grants that MIRROR the Firebase holders EXACTLY (derived from COMPATIBILITY_ROLES + GOVERNED_BUSINESS_ROLES; none is scoped or conditioned in Firebase, so every grant
--      is flat): admin, owner, fieldManager, generalManager, operationsManager, partsManager, salesManager, warehouseManager hold all four. Evidence:
--      docs/architecture/g1-goal-authoring-grant-parity.json; functions/test/g1GoalAuthoring.test.mjs proves the VALUES below equal the Firebase catalogs pair for pair and that no
--      other Role holds any of the four. (DECISIONS #162 names purchasingManager among the holders; the compiled catalog does not grant it any of the four -- the catalog is the
--      authority, and the parity file says so.)
-- An Administration ADMIN_REVOKED decision is honoured (never re-granted), as in every grant migration since B1; the protected Roles (admin, owner) are matched only as the
-- protected rows. Pre-write checks (nonprod, read-only): the four (performanceGoal, author|approve|supersede|retire) cells are unused in eos_policy.capabilities; migration
-- 1764680000000 is applied.
-- Drafted by the G-1 lane; reviewed and written into the repository by the controller (agents cannot write migrations directly -- the B4 / GRANT-1 / A6 pattern).

SET search_path = eos_ops, public;

CREATE TABLE performance_goal_commands (
    tenant_id            TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    actor_principal_id   TEXT        NOT NULL,
    idempotency_key      TEXT        NOT NULL,
    command              TEXT        NOT NULL,
    goal_id              TEXT        NOT NULL,
    request_fingerprint  TEXT        NOT NULL,
    result               JSONB       NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT performance_goal_commands_pkey PRIMARY KEY (tenant_id, actor_principal_id, idempotency_key),
    CONSTRAINT performance_goal_command_known CHECK (command IN ('CREATE', 'APPROVE', 'RETIRE')),
    CONSTRAINT performance_goal_command_key_stated CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200),
    CONSTRAINT performance_goal_command_goal FOREIGN KEY (tenant_id, goal_id) REFERENCES performance_goals (tenant_id, goal_id)
);

CREATE INDEX performance_goal_commands_by_goal ON performance_goal_commands (tenant_id, goal_id);

ALTER TABLE performance_goals ADD COLUMN author_employee_id TEXT;
ALTER TABLE performance_goals ADD CONSTRAINT performance_goals_author_employee_shape CHECK (author_employee_id IS NULL OR btrim(author_employee_id) <> '');

ALTER TABLE performance_goals DROP CONSTRAINT performance_goals_approval_evidence;
ALTER TABLE performance_goals ADD CONSTRAINT performance_goals_approval_evidence CHECK (
       (status = 'DRAFT' AND approved_by_ref IS NULL AND approved_at_ms IS NULL)
    OR (status IN ('APPROVED', 'SUPERSEDED') AND approved_by_ref IS NOT NULL AND approved_at_ms IS NOT NULL)
    OR (status = 'RETIRED' AND (approved_by_ref IS NULL) = (approved_at_ms IS NULL)));

COMMENT ON COLUMN performance_goals.author_employee_id IS
    'The Employee linked to the author Principal when the draft was authored here (NULL for a copied row). Two-person approval compares Employees, not only Principals.';

COMMENT ON TABLE performance_goal_commands IS
    'Idempotency record of createPerformanceGoalDraft / approvePerformanceGoal / retirePerformanceGoal: the same key and request replays the stored result and writes nothing; the same key with a different request is refused. Keyed per actor.';

-- ============================ capabilities and grants ============================
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_performance_goal_create', 'performance.goal.create',
     'Author a DRAFT performance goal version (a first version of a target). Authoring is not approving: a DRAFT is never a measurement authority and is never compared against. An employee may not author their own target. (Firebase catalog id, mirrored.)',
     'performanceGoal', 'author', 'BUSINESS_ACTION', 'Author Performance Goals'),
    ('cap_performance_goal_approve', 'performance.goal.approve',
     'Approve a DRAFT performance goal version, making it the target in force for its effective window. Self-approval is forbidden unconditionally (FIN-007) -- the author of a version may never be its approver. (Firebase catalog id, mirrored.)',
     'performanceGoal', 'approve', 'BUSINESS_ACTION', 'Approve Performance Goals'),
    ('cap_performance_goal_supersede', 'performance.goal.supersede',
     'Author a DRAFT version that REPLACES an approved target in force. Separate from creating one because it is the only operation that, on approval, closes an existing version''s window. (Firebase catalog id, mirrored.)',
     'performanceGoal', 'supersede', 'BUSINESS_ACTION', 'Replace Performance Goals'),
    ('cap_performance_goal_retire', 'performance.goal.retire',
     'Withdraw an approved performance goal with no successor. The window is closed, never deleted; the period the goal governed stays readable. (Firebase catalog id, mirrored.)',
     'performanceGoal', 'retire', 'BUSINESS_ACTION', 'Retire Performance Goals')
ON CONFLICT (key) DO NOTHING;

-- 32 grants = 4 keys x 8 Roles, the Firebase holders. The protected Roles (admin, owner) are matched only as the protected rows.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_g1_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764690000000', now(), 'migration:1764690000000', now(), 'migration:1764690000000', now()
  FROM capabilities c
  JOIN (VALUES
        ('admin', 'performance.goal.approve'), ('admin', 'performance.goal.create'), ('admin', 'performance.goal.retire'), ('admin', 'performance.goal.supersede'),
        ('fieldManager', 'performance.goal.approve'), ('fieldManager', 'performance.goal.create'), ('fieldManager', 'performance.goal.retire'), ('fieldManager', 'performance.goal.supersede'),
        ('generalManager', 'performance.goal.approve'), ('generalManager', 'performance.goal.create'), ('generalManager', 'performance.goal.retire'), ('generalManager', 'performance.goal.supersede'),
        ('operationsManager', 'performance.goal.approve'), ('operationsManager', 'performance.goal.create'), ('operationsManager', 'performance.goal.retire'), ('operationsManager', 'performance.goal.supersede'),
        ('owner', 'performance.goal.approve'), ('owner', 'performance.goal.create'), ('owner', 'performance.goal.retire'), ('owner', 'performance.goal.supersede'),
        ('partsManager', 'performance.goal.approve'), ('partsManager', 'performance.goal.create'), ('partsManager', 'performance.goal.retire'), ('partsManager', 'performance.goal.supersede'),
        ('salesManager', 'performance.goal.approve'), ('salesManager', 'performance.goal.create'), ('salesManager', 'performance.goal.retire'), ('salesManager', 'performance.goal.supersede'),
        ('warehouseManager', 'performance.goal.approve'), ('warehouseManager', 'performance.goal.create'), ('warehouseManager', 'performance.goal.retire'), ('warehouseManager', 'performance.goal.supersede')
       ) AS g(role_key, capability_key) ON g.capability_key = c.key
  JOIN roles r ON r.key = g.role_key AND (r.key NOT IN ('owner', 'admin') OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
-- Refuses once any command record, authored (NATIVE) goal, Administration decision, direct grant or foreign Role grant exists: a down migration never silently discards a goal or a decision.
DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.performance_goal_commands;
    IF v_n > 0 THEN RAISE EXCEPTION 'G1_GOAL_AUTHORING: refuses to reverse -- % authoring command record(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.performance_goals WHERE provenance = 'NATIVE';
    IF v_n > 0 THEN RAISE EXCEPTION 'G1_GOAL_AUTHORING: refuses to reverse -- % performance goal(s) were authored here', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.performance_goals WHERE status = 'RETIRED' AND approved_by_ref IS NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'G1_GOAL_AUTHORING: refuses to reverse -- % draft(s) were retired without ever being approved', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions
     WHERE superseded_at IS NULL AND capability_key IN ('performance.goal.create', 'performance.goal.approve', 'performance.goal.supersede', 'performance.goal.retire');
    IF v_n > 0 THEN RAISE EXCEPTION 'G1_GOAL_AUTHORING: refuses to reverse -- % Administration decision(s) name a goal authoring capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key IN ('performance.goal.create', 'performance.goal.approve', 'performance.goal.supersede', 'performance.goal.retire');
    IF v_n > 0 THEN RAISE EXCEPTION 'G1_GOAL_AUTHORING: refuses to reverse -- % direct grant(s) hold a goal authoring capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
     WHERE c.key IN ('performance.goal.create', 'performance.goal.approve', 'performance.goal.supersede', 'performance.goal.retire') AND rc.granted_by <> 'migration:1764690000000';
    IF v_n > 0 THEN RAISE EXCEPTION 'G1_GOAL_AUTHORING: refuses to reverse -- % Role grant(s) of a goal authoring capability were not written by this migration', v_n; END IF;
END
$$;

DROP TABLE eos_ops.performance_goal_commands;

ALTER TABLE eos_ops.performance_goals DROP CONSTRAINT performance_goals_approval_evidence;
ALTER TABLE eos_ops.performance_goals ADD CONSTRAINT performance_goals_approval_evidence CHECK ((status = 'DRAFT') = (approved_by_ref IS NULL AND approved_at_ms IS NULL));
ALTER TABLE eos_ops.performance_goals DROP CONSTRAINT performance_goals_author_employee_shape;
ALTER TABLE eos_ops.performance_goals DROP COLUMN author_employee_id;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities WHERE granted_by = 'migration:1764690000000';
DELETE FROM capabilities WHERE key IN ('performance.goal.create', 'performance.goal.approve', 'performance.goal.supersede', 'performance.goal.retire');
