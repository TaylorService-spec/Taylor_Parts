-- Up Migration
-- DIRECT PRINCIPAL CAPABILITY GRANTS -- the second grantee an Object may name.
--
-- ════════════════════ WHY A SECOND TABLE AND NOT A SECOND CATALOG ════════════════════
--
-- Owner ruling: an Object's actions must be grantable to BOTH Security Roles and individual
-- Principals. Until now only the first existed, and the workaround for "this one person needs this
-- one action" was a Role with one member -- which turns the Role catalog into a list of people and
-- makes "what does this Role mean" unanswerable.
--
-- This table grants THE SAME capability rows `role_capabilities` grants. There is no user-only
-- permission vocabulary, no second catalog, and no capability that exists for direct grants alone:
-- `capability_id` references the one `capabilities` table, whose object_key/action_key make the
-- grant projectable under its Object exactly like a Role grant.
--
-- ════════════════════ PRINCIPAL, NEVER EMPLOYEE ════════════════════
--
-- `principal_id` references principals(id). An Employee id is not accepted and cannot be: employees
-- live in eos_workforce and there is no foreign key from here to there, deliberately. An Employee
-- is a workforce record and may exist with no Principal at all; a Principal is the authenticated
-- actor. Granting authority to "an employee" would make a business record decide a permission.
--
-- ════════════════════ POSITIVE GRANTS ONLY ════════════════════
--
-- There is NO deny column, because this platform has no object-level deny framework to be
-- consistent with: effectiveObjectAccess.ts's `ALL_DENY` is a fail-closed DEFAULT, not a stored
-- denial, and object CRED unions additively across Roles. The only two-directional layer is
-- role_field_permission_overrides, which narrows WITHIN an Object a Role can already read. So the
-- effective set is a plain union -- role-derived capabilities OR direct grants -- and inventing
-- precedence here would create semantics nothing else in the schema has.
--
-- Revoke is row removal, exactly as role_capabilities does it. A status column would make two ways
-- to express "not granted" and the resolver would have to agree with itself about both.
SET search_path = eos_policy, public;

CREATE TABLE principal_capabilities (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id),
    principal_id  TEXT NOT NULL REFERENCES principals(id),
    capability_id TEXT NOT NULL REFERENCES capabilities(id),
    granted_by    TEXT        NOT NULL,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    TEXT        NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, principal_id, capability_id)
);

-- TENANT CONSISTENCY IS ENFORCED, not assumed. principals is a global table (an identity is one
-- identity across tenants) and membership is what binds it to a tenant, so this composite key plus
-- the command layer's membership check are what stop a grant naming a principal who does not
-- belong here. The index is the resolver's hot path: every direct capability for one principal.
CREATE INDEX principal_capabilities_by_principal  ON principal_capabilities (tenant_id, principal_id);
CREATE INDEX principal_capabilities_by_capability ON principal_capabilities (tenant_id, capability_id);

-- Down Migration
SET search_path = eos_policy, public;

DROP TABLE IF EXISTS principal_capabilities;
