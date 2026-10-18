-- Up Migration
-- FINANCE VISIBILITY MIRROR + SALES CREDIT IMMUTABILITY (Firebase exit B1, Financials; DECISIONS #B1; Owner rulings F7c-3,
-- 2026-10-17; Controller decisions 1 and D-249-0..D-249-4 of the F7c-2 / F7c-3 design note).
--
-- 1. THE FIVE FIREBASE REACH KEYS, mirrored. finance.visibility.{self,team,businessUnit,company,consolidated} are registered and
--    granted to EXACTLY the Roles that hold them in the Firebase catalog today (functions/src/access/governedBusinessRoles.ts):
--      admin, owner                                  all five   (D-249-4: admin and owner hold all five, as in Firebase)
--      salesperson                                   self
--      salesManager                                  team
--      generalManager, financeManager, accountingManager   consolidated
--    15 grants, NO new holder. self and team are mirrored INACTIVE exactly as Firebase has them in every environment: the
--    server (eosFinance/financeVisibility.ts) treats a principal whose only visibility keys are self / team as RESTRICTED-EMPTY
--    until the Owner activates them (D-249-0). The row-level restriction those keys describe is implemented and tested but
--    inert while they are inactive. Registering a key is not granting it and granting it is not activating it.
--
-- 2. THE CREDIT NEVER CHANGES. eos_commercial.sales_orders.credited_salesperson_employee_id is the AUTHORITATIVE credit that a
--    receivable's attribution is derived from (it is set at creation, inherited Agreement -> Opportunity -> resolved owner, and
--    no EOS command edits it). A store trigger now refuses ANY change of it, so "historical credit stays historical" (FIN-002)
--    is enforced by the database and not only by the absence of a command. Nothing is persisted on the obligation: attribution is
--    DERIVED from the source Sales Order at read time (no new column, no backfill).
--
-- GRANT-BEARING (Owner ruling E): roleCapabilityAuthorityBaseline.json carries the 15 pairs in the same change.

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_finance_visibility_self', 'finance.visibility.self',
     'Finance reach: receivables credited to this person (the credited salesperson of the source Sales Order). INACTIVE (mirrors Firebase): a principal holding only this key sees nothing until the Owner activates it.',
     'payment', 'visibilitySelf', 'BUSINESS_ACTION', 'Finance Reach: Own Credited Records'),
    ('cap_finance_visibility_team', 'finance.visibility.team',
     'Finance reach: receivables credited to this person or to anyone who reported to them, through the reporting line, at the credit date. INACTIVE (mirrors Firebase): a principal holding only this key sees nothing until the Owner activates it.',
     'payment', 'visibilityTeam', 'BUSINESS_ACTION', 'Finance Reach: Team Credited Records'),
    ('cap_finance_visibility_businessUnit', 'finance.visibility.businessUnit',
     'Finance reach: records wholly attributable to one business unit. EOS receivables carry no business unit, so a principal holding only this key sees nothing.',
     'payment', 'visibilityBusinessUnit', 'BUSINESS_ACTION', 'Finance Reach: Business Unit'),
    ('cap_finance_visibility_company', 'finance.visibility.company',
     'Finance reach: every record of the operating companies the principal is assigned to.',
     'payment', 'visibilityCompany', 'BUSINESS_ACTION', 'Finance Reach: Operating Company'),
    ('cap_finance_visibility_consolidated', 'finance.visibility.consolidated',
     'Finance reach: every record of every company the principal is assigned to (no restriction beyond the company boundary).',
     'payment', 'visibilityConsolidated', 'BUSINESS_ACTION', 'Finance Reach: Consolidated')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_b1_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764620000000', now(), 'migration:1764620000000', now(), 'migration:1764620000000', now()
  FROM capabilities c
  JOIN (VALUES
        ('admin', 'finance.visibility.self'), ('admin', 'finance.visibility.team'), ('admin', 'finance.visibility.businessUnit'),
        ('admin', 'finance.visibility.company'), ('admin', 'finance.visibility.consolidated'),
        ('owner', 'finance.visibility.self'), ('owner', 'finance.visibility.team'), ('owner', 'finance.visibility.businessUnit'),
        ('owner', 'finance.visibility.company'), ('owner', 'finance.visibility.consolidated'),
        ('salesperson', 'finance.visibility.self'),
        ('salesManager', 'finance.visibility.team'),
        ('generalManager', 'finance.visibility.consolidated'),
        ('financeManager', 'finance.visibility.consolidated'),
        ('accountingManager', 'finance.visibility.consolidated')) AS g(role_key, capability_key) ON g.capability_key = c.key
  JOIN roles r ON r.key = g.role_key AND (r.key <> 'owner' OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- The credited salesperson of a Sales Order is recorded once, at creation, and never changed.
SET search_path = eos_commercial, public;

CREATE FUNCTION refuse_sales_order_credit_change() RETURNS trigger AS $$
BEGIN
    IF NEW.credited_salesperson_employee_id IS DISTINCT FROM OLD.credited_salesperson_employee_id THEN
        RAISE EXCEPTION 'SALES_ORDER_CREDIT_IMMUTABLE: the credited salesperson of a Sales Order is recorded once at creation and never changed (historical credit stays historical, FIN-002)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_commercial, public;

CREATE TRIGGER sales_order_credit_immutable BEFORE UPDATE ON sales_orders
    FOR EACH ROW EXECUTE FUNCTION refuse_sales_order_credit_change();

-- Down Migration
DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key LIKE 'finance.visibility.%';
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_VISIBILITY: refuses to reverse -- % Administration decision(s) name a finance visibility capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key LIKE 'finance.visibility.%';
    IF v_n > 0 THEN RAISE EXCEPTION 'FINANCE_VISIBILITY: refuses to reverse -- % direct grant(s) hold a finance visibility capability', v_n; END IF;
END
$$;

DROP TRIGGER sales_order_credit_immutable ON eos_commercial.sales_orders;
DROP FUNCTION eos_commercial.refuse_sales_order_credit_change();

SET search_path = eos_policy, public;
DELETE FROM role_capabilities rc USING capabilities c WHERE c.id = rc.capability_id AND c.key LIKE 'finance.visibility.%';
DELETE FROM capabilities WHERE key LIKE 'finance.visibility.%';
