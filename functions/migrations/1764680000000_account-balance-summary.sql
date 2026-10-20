-- Up Migration
-- A6 CUSTOMER-BALANCE SUMMARY (Owner decision A6, 2026-10-19), nonprod. GRANT-BEARING (Owner ruling E): roleCapabilityAuthorityBaseline.json carries the same pairs.
--
-- OWNER AUTHORIZATION (2026-10-19): "Restore historically authorized customer-balance visibility for eligible operational roles. Distinguish balance summaries from invoice details, individual
-- payments, settlement commands and financial policy authority. Preserve company isolation, sales ownership, historical credited-salesperson/team restrictions and applicable exclusions. No new
-- receivable write authority." Reach: "their companies but admins can extend to other companies" (the Employee's company authority UNION the explicit Finance company assignments). Non-sales roles
-- see all customers' summaries within that reach; sales roles keep the existing self / team rules (eosFinance/financeVisibility.ts, inactive today).
--
--   finance.accountBalance.read  (object payment, action readBalanceSummary, READ) opens ONE operation, readAccountBalanceSummary { crmAccountId } on /operations/finance: per reached company and
--   currency the open receivable count, the outstanding amount, the overdue count and the overdue amount, as of now -- and nothing else. No obligation, settlement, handoff or billing-package id,
--   no invoice number, no payment or settlement row, no payable / funding / intercompany section, no write path. The full receivable detail stays on finance.payment.read.
--
-- 1 capability + 8 NEW grants, one per Role: fieldManager, partsAssociate, partsManager, purchasingManager, salesManager, salesperson, shopAssociate, shopManager. Finance roles keep their full
-- reads and receive nothing here; admin and owner are not granted (they hold the full Finance read). Evidence: functions/test/a6AccountBalanceSummary.test.mjs proves the VALUES below equal the
-- Owner's list and the baseline, and that no other Role gains a pair.
-- An Administration ADMIN_REVOKED decision is honoured (never re-granted), as in every grant migration since B1; the protected Roles (admin, owner) are matched only as the protected rows.
-- Drafted by the A6 lane; reviewed and written into the repository by the controller under the Owner's 2026-10-19 authorization (agents cannot write migrations directly -- the B4 / GRANT-1 pattern).
-- OBJECT: the key sits on the EXISTING `payment` Object (the Finance register Object that finance.payment.read and the five finance.visibility.* keys already name), as action
-- `readBalanceSummary` (READ), exactly as inventory.catalog.cost.read / readCost sits beside readTerms on supplierCatalogItem. A new `accountBalance` Object would need an Object seed row
-- (capabilityGovernedObjects.json + the regenerated policy seed snapshot + their pinned counts: capabilityObjectAuthorityGuard refuses a migration that names an unseeded Object); the
-- controller may prefer that -- it changes this INSERT's two columns and those seed files only.
-- Pre-write checks (nonprod, read-only): (payment, readBalanceSummary) is unused in eos_policy.capabilities; GRANT-1 migration 1764670000000 is applied.
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_finance_account_balance_read', 'finance.accountBalance.read',
     'Read the customer-balance SUMMARY of one customer: per operating company and currency, the number and total of open receivables and of overdue receivables, as of now. Confers no receivable, invoice, payment or settlement row, no payable, funding or intercompany view, no settlement command and no financial policy authority (A6, Owner 2026-10-19); the full Finance reads stay on finance.payment.read.',
     'payment', 'readBalanceSummary', 'READ', 'Read Customer Balance Summary')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_a6_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764680000000', now(), 'migration:1764680000000', now(), 'migration:1764680000000', now()
  FROM capabilities c
  JOIN (VALUES
        ('fieldManager', 'finance.accountBalance.read'), ('partsAssociate', 'finance.accountBalance.read'),
        ('partsManager', 'finance.accountBalance.read'), ('purchasingManager', 'finance.accountBalance.read'),
        ('salesManager', 'finance.accountBalance.read'), ('salesperson', 'finance.accountBalance.read'),
        ('shopAssociate', 'finance.accountBalance.read'), ('shopManager', 'finance.accountBalance.read')
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
    -- An Administration decision about the new key, or about a pair this migration wrote, is a decision the reversal must not erase.
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions d
     WHERE d.superseded_at IS NULL
       AND (d.capability_key = 'finance.accountBalance.read'
            OR EXISTS (SELECT 1 FROM eos_policy.role_capabilities rc
                         JOIN eos_policy.roles r ON r.id = rc.role_id
                         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                        WHERE rc.granted_by = 'migration:1764680000000' AND r.tenant_id = d.tenant_id AND r.key = d.role_key AND c.key = d.capability_key));
    IF v_n > 0 THEN RAISE EXCEPTION 'A6_ACCOUNT_BALANCE_SUMMARY: refuses to reverse -- % Administration decision(s) name the new key or a pair this migration wrote', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc
      JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = 'finance.accountBalance.read';
    IF v_n > 0 THEN RAISE EXCEPTION 'A6_ACCOUNT_BALANCE_SUMMARY: refuses to reverse -- finance.accountBalance.read is held by % direct grant(s)', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities rc
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id
     WHERE c.key = 'finance.accountBalance.read' AND rc.granted_by <> 'migration:1764680000000';
    IF v_n > 0 THEN RAISE EXCEPTION 'A6_ACCOUNT_BALANCE_SUMMARY: refuses to reverse -- finance.accountBalance.read is held by % Role grant(s) this migration did not write', v_n; END IF;
END
$$;

DELETE FROM eos_policy.role_capabilities WHERE granted_by = 'migration:1764680000000';
DELETE FROM eos_policy.capabilities WHERE key = 'finance.accountBalance.read';
