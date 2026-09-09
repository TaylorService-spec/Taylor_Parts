-- Up Migration
-- Role assignments — referential integrity, and one active row per effective assignment.
--
-- ============================================================================
-- MIGRATION 003. Owner rulings B and C.
--
-- STANDARD POSTGRESQL ONLY, same as 001 and 002.
-- ============================================================================
--
-- ════════════════════ RULING B — MAKE THE INVALID UNREPRESENTABLE ════════════════════
--
-- Migration 002 deliberately left `user_role_assignments` with no foreign key onto the identity
-- model, and enforced "the principal must be a member of this tenant" only at the trusted API. That
-- was recorded as a decision rather than assumed, and the Owner has ruled it is not the permanent
-- design. It is not accepted here either, and the reason is worth stating plainly: an API check
-- protects the path that goes through the API. A migration, a repair script, a future service or a
-- mistake at a psql prompt does not go through the API.
--
-- The constraint chosen is the COMPOSITE one, not the simpler `REFERENCES principals(id)`:
--
--   user_role_assignments (tenant_id, principal_id)
--       REFERENCES tenant_memberships (tenant_id, principal_id)
--
-- A key onto `principals` alone would prove the principal EXISTS. It would not prevent tenant A
-- granting a Role to a principal who belongs only to tenant B -- which is the failure that actually
-- matters, because it is a cross-tenant authority leak rather than a dangling row. The composite
-- key makes that relationship unrepresentable.
--
-- BOTH LAYERS STAY. The API still refuses an assignment to a principal whose membership is not
-- ACTIVE; the database refuses one to a principal who is not a member at all. They are different
-- questions -- the database has no opinion about `status`, and the API cannot defend a path that
-- does not call it.
--
-- THE COLUMN IS RENAMED. `principal_uid` said "a Firebase UID" and the value has been an EOS
-- principal id since migration 002. A column whose name describes a system the platform is leaving
-- is a comment that will be believed.
--
-- ════════════════════ RULING C — ONE ACTIVE ROW PER EFFECTIVE ASSIGNMENT ════════════════════
--
-- Multi-role union stays ADDITIVE. What is refused is a SECOND ACTIVE row saying exactly the same
-- thing: same tenant, same principal, same Role, same normalized scope. Two identical active rows
-- confer no more authority than one, so the duplicate is never a grant -- it is a misleading row in
-- an administrator's list and a second thing to revoke before the first stops applying.
--
-- PARTIAL, on `status = 'active'`, and that is the whole design. A revoked assignment stays in the
-- table as history and does not block a later re-grant, so the audit trail keeps every grant and
-- every revocation while only one of them is ever in force.
--
-- COALESCE on the scope value because NULL is not distinct from NULL in a unique index: without it,
-- two global assignments (both `scope_value IS NULL`) would each be unique and the constraint would
-- silently do nothing for exactly the commonest case.

SET search_path = eos_policy, public;

-- ============================ referential integrity ============================

ALTER TABLE user_role_assignments RENAME COLUMN principal_uid TO principal_id;
ALTER TABLE principal_access_versions RENAME COLUMN principal_uid TO principal_id;

-- The index on the old name follows the rename automatically; recreate it under a name that
-- describes the column it now covers.
ALTER INDEX user_role_assignments_by_principal RENAME TO user_role_assignments_by_principal_id;

-- The composite target needs a matching unique constraint to reference. `tenant_memberships`
-- already declares UNIQUE (tenant_id, principal_id), which is exactly it.
ALTER TABLE user_role_assignments
    ADD CONSTRAINT user_role_assignments_member_fk
    FOREIGN KEY (tenant_id, principal_id)
    REFERENCES tenant_memberships (tenant_id, principal_id);

-- An access-version row is about a principal, so it may not outlive one. No composite key here:
-- the counter is per (tenant, principal) and the tenant is already keyed, and a principal whose
-- membership is later removed keeps their counter rather than having it silently deleted.
ALTER TABLE principal_access_versions
    ADD CONSTRAINT principal_access_versions_principal_fk
    FOREIGN KEY (principal_id) REFERENCES principals (id);

-- ============================ one active assignment ============================

CREATE UNIQUE INDEX user_role_assignments_one_active
    ON user_role_assignments (tenant_id, principal_id, role_id, scope_type, COALESCE(scope_value, ''))
    WHERE status = 'active';

-- Down Migration
SET search_path = eos_policy, public;

DROP INDEX IF EXISTS user_role_assignments_one_active;

ALTER TABLE principal_access_versions DROP CONSTRAINT IF EXISTS principal_access_versions_principal_fk;
ALTER TABLE user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_member_fk;

ALTER INDEX user_role_assignments_by_principal_id RENAME TO user_role_assignments_by_principal;

ALTER TABLE principal_access_versions RENAME COLUMN principal_id TO principal_uid;
ALTER TABLE user_role_assignments RENAME COLUMN principal_id TO principal_uid;
