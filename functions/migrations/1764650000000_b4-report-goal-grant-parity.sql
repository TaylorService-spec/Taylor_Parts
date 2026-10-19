-- Up Migration
-- B4 REPORT / PERFORMANCE-GOAL PERMISSION PARITY (Firebase exit B4, DECISIONS #B4, OD-B4-1), nonprod.
--
-- OWNER AUTHORIZATION (2026-10-18, "B4 REPORT/GOAL PERMISSION PARITY", reaffirmed "COMPLETE B4 GRANT MIGRATION"): write the 122
-- role-permission pairs for the 39 keys migration 1764640000000 registered, mirroring EXACTLY the Firebase holders
-- (functions/src/access/compatibilityRoles.ts + governedBusinessRoles.ts). No production permission change is authorized;
-- production is promoted only by its own ruling.
--
-- 39 keys x 15 Roles = 122 pairs: admin 39, owner 39, reportViewer 26, reportFinanceViewer 5, reportAuthor 3, and
-- performance.goal.read on fieldManager, generalManager, operationsManager, partsAssociate, partsManager, performanceGoalSubject,
-- salesManager, salesperson, warehouseAssociate, warehouseManager. No B4 key is scoped or conditioned in Firebase.
-- Evidence: docs/architecture/b4-report-goal-grant-parity.json. functions/test/b4ReportGoalGrantParity.test.mjs proves the VALUES
-- below equal the Firebase catalogs pair for pair and that no other Role holds any of the 39 keys. The 39 keys leave
-- ADMINISTRATION_GRANT_ONLY_CAPABILITIES in the same change (the explicit grant replaces the fence).
-- An Administration ADMIN_REVOKED decision is honoured (never re-granted), as in every grant migration since B1; the protected
-- Roles (admin, owner) are matched only as the protected rows.
SET search_path = eos_policy, public;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_b4_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764650000000', now(), 'migration:1764650000000', now(), 'migration:1764650000000', now()
  FROM capabilities c
  JOIN (VALUES
        -- admin: all 39
        ('admin', 'performance.goal.read'),
        ('admin', 'report.contact.field.customer.read'), ('admin', 'report.contact.field.email.read'),
        ('admin', 'report.contact.field.name.read'), ('admin', 'report.contact.field.phone.read'),
        ('admin', 'report.contact.field.role.read'), ('admin', 'report.contact.read'),
        ('admin', 'report.customer.field.accountOwner.read'), ('admin', 'report.customer.field.billingAddress.read'),
        ('admin', 'report.customer.field.billingContact.read'), ('admin', 'report.customer.field.commercialProfile.read'),
        ('admin', 'report.customer.field.createdAt.read'), ('admin', 'report.customer.field.externalIds.read'),
        ('admin', 'report.customer.field.name.read'), ('admin', 'report.customer.field.notes.read'),
        ('admin', 'report.customer.field.paymentTerms.read'), ('admin', 'report.customer.field.relationshipTypes.read'),
        ('admin', 'report.customer.field.status.read'), ('admin', 'report.customer.field.tags.read'),
        ('admin', 'report.customer.field.taxStatus.read'), ('admin', 'report.customer.read'),
        ('admin', 'report.definition.create'), ('admin', 'report.definition.delete'),
        ('admin', 'report.definition.duplicate'), ('admin', 'report.definition.rename'),
        ('admin', 'report.equipment.field.createdAt.read'), ('admin', 'report.equipment.field.customer.read'),
        ('admin', 'report.equipment.field.dates.read'), ('admin', 'report.equipment.field.identity.read'),
        ('admin', 'report.equipment.field.location.read'), ('admin', 'report.equipment.field.name.read'),
        ('admin', 'report.equipment.field.notes.read'), ('admin', 'report.equipment.field.status.read'),
        ('admin', 'report.equipment.read'),
        ('admin', 'report.location.field.accessNotes.read'), ('admin', 'report.location.field.address.read'),
        ('admin', 'report.location.field.customer.read'), ('admin', 'report.location.field.name.read'),
        ('admin', 'report.location.read'),
        -- owner: all 39
        ('owner', 'performance.goal.read'),
        ('owner', 'report.contact.field.customer.read'), ('owner', 'report.contact.field.email.read'),
        ('owner', 'report.contact.field.name.read'), ('owner', 'report.contact.field.phone.read'),
        ('owner', 'report.contact.field.role.read'), ('owner', 'report.contact.read'),
        ('owner', 'report.customer.field.accountOwner.read'), ('owner', 'report.customer.field.billingAddress.read'),
        ('owner', 'report.customer.field.billingContact.read'), ('owner', 'report.customer.field.commercialProfile.read'),
        ('owner', 'report.customer.field.createdAt.read'), ('owner', 'report.customer.field.externalIds.read'),
        ('owner', 'report.customer.field.name.read'), ('owner', 'report.customer.field.notes.read'),
        ('owner', 'report.customer.field.paymentTerms.read'), ('owner', 'report.customer.field.relationshipTypes.read'),
        ('owner', 'report.customer.field.status.read'), ('owner', 'report.customer.field.tags.read'),
        ('owner', 'report.customer.field.taxStatus.read'), ('owner', 'report.customer.read'),
        ('owner', 'report.definition.create'), ('owner', 'report.definition.delete'),
        ('owner', 'report.definition.duplicate'), ('owner', 'report.definition.rename'),
        ('owner', 'report.equipment.field.createdAt.read'), ('owner', 'report.equipment.field.customer.read'),
        ('owner', 'report.equipment.field.dates.read'), ('owner', 'report.equipment.field.identity.read'),
        ('owner', 'report.equipment.field.location.read'), ('owner', 'report.equipment.field.name.read'),
        ('owner', 'report.equipment.field.notes.read'), ('owner', 'report.equipment.field.status.read'),
        ('owner', 'report.equipment.read'),
        ('owner', 'report.location.field.accessNotes.read'), ('owner', 'report.location.field.address.read'),
        ('owner', 'report.location.field.customer.read'), ('owner', 'report.location.field.name.read'),
        ('owner', 'report.location.read'),
        -- reportViewer: 26 (no definition writes, no finance/notes/accountOwner/accessNotes fields)
        ('reportViewer', 'report.contact.field.customer.read'), ('reportViewer', 'report.contact.field.email.read'),
        ('reportViewer', 'report.contact.field.name.read'), ('reportViewer', 'report.contact.field.phone.read'),
        ('reportViewer', 'report.contact.field.role.read'), ('reportViewer', 'report.contact.read'),
        ('reportViewer', 'report.customer.field.createdAt.read'), ('reportViewer', 'report.customer.field.externalIds.read'),
        ('reportViewer', 'report.customer.field.name.read'), ('reportViewer', 'report.customer.field.relationshipTypes.read'),
        ('reportViewer', 'report.customer.field.status.read'), ('reportViewer', 'report.customer.field.tags.read'),
        ('reportViewer', 'report.customer.read'),
        ('reportViewer', 'report.equipment.field.createdAt.read'), ('reportViewer', 'report.equipment.field.customer.read'),
        ('reportViewer', 'report.equipment.field.dates.read'), ('reportViewer', 'report.equipment.field.identity.read'),
        ('reportViewer', 'report.equipment.field.location.read'), ('reportViewer', 'report.equipment.field.name.read'),
        ('reportViewer', 'report.equipment.field.notes.read'), ('reportViewer', 'report.equipment.field.status.read'),
        ('reportViewer', 'report.equipment.read'),
        ('reportViewer', 'report.location.field.address.read'), ('reportViewer', 'report.location.field.customer.read'),
        ('reportViewer', 'report.location.field.name.read'), ('reportViewer', 'report.location.read'),
        -- reportFinanceViewer: 5 finance fields
        ('reportFinanceViewer', 'report.customer.field.billingAddress.read'),
        ('reportFinanceViewer', 'report.customer.field.billingContact.read'),
        ('reportFinanceViewer', 'report.customer.field.commercialProfile.read'),
        ('reportFinanceViewer', 'report.customer.field.paymentTerms.read'),
        ('reportFinanceViewer', 'report.customer.field.taxStatus.read'),
        -- reportAuthor: 3 (never delete)
        ('reportAuthor', 'report.definition.create'), ('reportAuthor', 'report.definition.duplicate'),
        ('reportAuthor', 'report.definition.rename'),
        -- performance.goal.read: the ten other Firebase holders
        ('fieldManager', 'performance.goal.read'), ('generalManager', 'performance.goal.read'),
        ('operationsManager', 'performance.goal.read'), ('partsAssociate', 'performance.goal.read'),
        ('partsManager', 'performance.goal.read'), ('performanceGoalSubject', 'performance.goal.read'),
        ('salesManager', 'performance.goal.read'), ('salesperson', 'performance.goal.read'),
        ('warehouseAssociate', 'performance.goal.read'), ('warehouseManager', 'performance.goal.read')
       ) AS g(role_key, capability_key) ON g.capability_key = c.key
  JOIN roles r ON r.key = g.role_key AND (r.key NOT IN ('owner', 'admin') OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
DO $$
DECLARE v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions
     WHERE (capability_key LIKE 'report.%' OR capability_key = 'performance.goal.read') AND superseded_at IS NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'B4_GRANT_PARITY: refuses to reverse -- % Administration decision(s) name a reporting or goal capability', v_n; END IF;
END
$$;

DELETE FROM eos_policy.role_capabilities WHERE granted_by = 'migration:1764650000000';
