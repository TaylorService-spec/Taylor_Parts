-- Up Migration
-- DELEGATED SELF-APPROVAL EXEMPTION (SAE Rule 2; DECISIONS #SAE-2; Owner direction SAE3 + controller decisions Q1-Q3, 2026-10-20). Slot 1764718000000 is PROVISIONAL: the controller assigns the final slot.
--
-- WHAT THIS CHANGES (and nothing else):
--   1. Registers SEVEN capabilities on ONE Object (selfApprovalExemption): approval.selfApproval.exemptFinancials / Purchasing / Sales / Inventory / Service / Goals and exemptAll.
--      NO GRANTS. Nobody but the protected Owner is exempt until the Owner grants a key through Administration, and only the protected Owner can (the grant / revoke commands are gated on
--      the verified protected Owner for this family; the Administrator is refused). A grant is GLOBAL (all operating companies) until company scope ships (a follow-up). A key confers ONLY the
--      second-person exemption within its scope (Owner ruling D3). The Object itself is seeded by the policy seed (capabilityGovernedObjects.json), like every Object a capability names.
--   2. The SQL PROOF of a delegated exemption, three functions that NEVER return NULL (a NULL inside NOT / OR in a trigger would let a forged basis through; see the v3 fix of 1764716000000):
--        eos_policy.eligible_employee_of(tenant, principal)                         the Principal's ONE active access-eligible Employee (enabled, active membership), else NULL
--        eos_policy.has_delegated_self_approval_exemption(tenant, principal, scope) TRUE only when the Principal holds the scope's key or the all-workflows key through an ACTIVE, GLOBAL,
--                                                                                   non-stale Role assignment (role_capabilities) or an UNEXPIRED direct grant (principal_capabilities)
--                                                                                   AND has an eligible Employee. scope is one of FINANCIALS PURCHASING SALES INVENTORY SERVICE GOALS.
--        eos_policy.is_delegated_exempt_employee(tenant, principal, employee, scope) the above AND employee is that Principal's eligible Employee.
--   3. invoice_corrections: approval_basis may now also be DELEGATED_EXEMPTION. The people trigger, the adjustment-fact gate and the void gate accept a same-person decision recorded with
--      that basis ONLY when is_delegated_exempt_employee(..., 'FINANCIALS') proves it at that moment (the protected-Owner proof is unchanged). Every other rule is unchanged.
--   4. financial_policy_versions: the decider-independence trigger also accepts a decider for whom has_delegated_self_approval_exemption(..., 'FINANCIALS') is TRUE at the moment the decider column is set.
-- COUPLING: eligible_employee_of hard-codes ('ACTIVE', 'CONTRACTOR'), a copy of ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES (see protected_owner_employee in 1764716000000).

SET search_path = eos_policy, public;

-- ════════════════════ 1. the capability family (NO grants) ════════════════════

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_approval_selfApproval_exemptFinancials', 'approval.selfApproval.exemptFinancials',
     'Delegated self-approval exemption for FINANCIALS workflows: lets the holder approve a transaction they themselves requested (Finance corrections, refund records and voids, and Financial Policy decisions). A grant applies across ALL operating companies until company scope ships. It confers ONLY the second-person exemption within its scope (Owner ruling D3): no business authority (the holder still needs the request and approval capabilities of the workflow itself), no company or tenant reach, no self-targeting or identity-guard exception, no integrity or evidence exception, no administration or onward-delegation right. Granted and revoked ONLY by the governed protected Owner.',
     'selfApprovalExemption', 'exemptFinancials', 'BUSINESS_ACTION', 'Self-Approve: Financials'),
    ('cap_approval_selfApproval_exemptPurchasing', 'approval.selfApproval.exemptPurchasing',
     'Delegated self-approval exemption for PURCHASING workflows: lets the holder approve a transaction they themselves requested (supplier purchase orders). A grant applies across ALL operating companies until company scope ships. It confers ONLY the second-person exemption within its scope (Owner ruling D3): no business authority (the holder still needs the request and approval capabilities of the workflow itself), no company or tenant reach, no self-targeting or identity-guard exception, no integrity or evidence exception, no administration or onward-delegation right. Granted and revoked ONLY by the governed protected Owner.',
     'selfApprovalExemption', 'exemptPurchasing', 'BUSINESS_ACTION', 'Self-Approve: Purchasing'),
    ('cap_approval_selfApproval_exemptSales', 'approval.selfApproval.exemptSales',
     'Delegated self-approval exemption for SALES workflows: lets the holder approve a transaction they themselves requested (Sales approvals (quotes and discounts, when built)). A grant applies across ALL operating companies until company scope ships. It confers ONLY the second-person exemption within its scope (Owner ruling D3): no business authority (the holder still needs the request and approval capabilities of the workflow itself), no company or tenant reach, no self-targeting or identity-guard exception, no integrity or evidence exception, no administration or onward-delegation right. Granted and revoked ONLY by the governed protected Owner.',
     'selfApprovalExemption', 'exemptSales', 'BUSINESS_ACTION', 'Self-Approve: Sales'),
    ('cap_approval_selfApproval_exemptInventory', 'approval.selfApproval.exemptInventory',
     'Delegated self-approval exemption for INVENTORY workflows: lets the holder approve a transaction they themselves requested (cycle count variance reconciliation and other inventory approvals). A grant applies across ALL operating companies until company scope ships. It confers ONLY the second-person exemption within its scope (Owner ruling D3): no business authority (the holder still needs the request and approval capabilities of the workflow itself), no company or tenant reach, no self-targeting or identity-guard exception, no integrity or evidence exception, no administration or onward-delegation right. Granted and revoked ONLY by the governed protected Owner.',
     'selfApprovalExemption', 'exemptInventory', 'BUSINESS_ACTION', 'Self-Approve: Inventory'),
    ('cap_approval_selfApproval_exemptService', 'approval.selfApproval.exemptService',
     'Delegated self-approval exemption for SERVICE workflows: lets the holder approve a transaction they themselves requested (Service approvals (none exist yet)). A grant applies across ALL operating companies until company scope ships. It confers ONLY the second-person exemption within its scope (Owner ruling D3): no business authority (the holder still needs the request and approval capabilities of the workflow itself), no company or tenant reach, no self-targeting or identity-guard exception, no integrity or evidence exception, no administration or onward-delegation right. Granted and revoked ONLY by the governed protected Owner.',
     'selfApprovalExemption', 'exemptService', 'BUSINESS_ACTION', 'Self-Approve: Service'),
    ('cap_approval_selfApproval_exemptGoals', 'approval.selfApproval.exemptGoals',
     'Delegated self-approval exemption for GOALS workflows: lets the holder approve a transaction they themselves requested (performance goal approvals). A grant applies across ALL operating companies until company scope ships. It confers ONLY the second-person exemption within its scope (Owner ruling D3): no business authority (the holder still needs the request and approval capabilities of the workflow itself), no company or tenant reach, no self-targeting or identity-guard exception, no integrity or evidence exception, no administration or onward-delegation right. Granted and revoked ONLY by the governed protected Owner.',
     'selfApprovalExemption', 'exemptGoals', 'BUSINESS_ACTION', 'Self-Approve: Goals'),
    ('cap_approval_selfApproval_exemptAll', 'approval.selfApproval.exemptAll',
     'Delegated self-approval exemption for ALL business workflows (Financials, Purchasing, Sales, Inventory, Service, Goals): lets the holder approve a transaction they themselves requested. It implies nothing outside the "otherwise authorized" rule. A grant applies across ALL operating companies until company scope ships. It confers ONLY the second-person exemption within its scope (Owner ruling D3): no business authority (the holder still needs the request and approval capabilities of the workflow itself), no company or tenant reach, no self-targeting or identity-guard exception, no integrity or evidence exception, no administration or onward-delegation right. Granted and revoked ONLY by the governed protected Owner.',
     'selfApprovalExemption', 'exemptAll', 'BUSINESS_ACTION', 'Self-Approve: All Business Workflows')
ON CONFLICT (key) DO NOTHING;

-- ════════════════════ 2. the SQL proof of a delegated exemption ════════════════════

CREATE OR REPLACE FUNCTION eos_policy.eligible_employee_of(p_tenant TEXT, p_principal TEXT) RETURNS TEXT AS $$
    SELECT l.employee_id
      FROM eos_policy.employee_principal_links l
      JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
      JOIN eos_policy.principals p ON p.id = l.principal_id AND p.status = 'active'
      JOIN eos_policy.tenant_memberships m ON m.tenant_id = l.tenant_id AND m.principal_id = l.principal_id AND m.status = 'active'
     WHERE l.tenant_id = p_tenant AND l.principal_id = p_principal AND l.status = 'active'
       AND e.employment_status::text IN ('ACTIVE', 'CONTRACTOR')
       AND (SELECT count(*) FROM eos_policy.employee_principal_links l2
             WHERE l2.tenant_id = p_tenant AND l2.principal_id = p_principal AND l2.status = 'active') = 1
     LIMIT 1
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION eos_policy.has_delegated_self_approval_exemption(p_tenant TEXT, p_principal TEXT, p_scope TEXT) RETURNS BOOLEAN AS $$
    SELECT COALESCE(
        p_scope IN ('FINANCIALS', 'PURCHASING', 'SALES', 'INVENTORY', 'SERVICE', 'GOALS')
        AND eos_policy.eligible_employee_of(p_tenant, p_principal) IS NOT NULL
        AND EXISTS (
            SELECT 1
              FROM eos_policy.user_role_assignments a
              JOIN eos_policy.role_capabilities rc ON rc.tenant_id = a.tenant_id AND rc.role_id = a.role_id
              JOIN eos_policy.capabilities c ON c.id = rc.capability_id
              LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
             WHERE a.tenant_id = p_tenant AND a.principal_id = p_principal AND a.status = 'active' AND a.scope_type = 'global'
               AND a.access_version_at_grant <= coalesce(v.access_version, 0)
               AND c.key IN ('approval.selfApproval.exempt' || initcap(lower(p_scope)), 'approval.selfApproval.exemptAll')
            UNION ALL
            SELECT 1
              FROM eos_policy.principal_capabilities pc
              JOIN eos_policy.capabilities c ON c.id = pc.capability_id
             WHERE pc.tenant_id = p_tenant AND pc.principal_id = p_principal AND (pc.expires_at IS NULL OR pc.expires_at > now())
               AND c.key IN ('approval.selfApproval.exempt' || initcap(lower(p_scope)), 'approval.selfApproval.exemptAll')),
        FALSE)
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION eos_policy.is_delegated_exempt_employee(p_tenant TEXT, p_principal TEXT, p_employee TEXT, p_scope TEXT) RETURNS BOOLEAN AS $$
    SELECT COALESCE(p_employee IS NOT NULL
                    AND eos_policy.eligible_employee_of(p_tenant, p_principal) = p_employee
                    AND eos_policy.has_delegated_self_approval_exemption(p_tenant, p_principal, p_scope), FALSE)
$$ LANGUAGE sql STABLE;

-- ════════════════════ 3. invoice corrections ════════════════════

SET search_path = eos_finance, public;

ALTER TABLE invoice_corrections DROP CONSTRAINT invoice_correction_approval_basis_known;
ALTER TABLE invoice_corrections ADD CONSTRAINT invoice_correction_approval_basis_known CHECK (approval_basis IS NULL OR approval_basis IN ('PROTECTED_OWNER', 'DELEGATED_EXEMPTION'));

CREATE OR REPLACE FUNCTION assert_correction_people() RETURNS trigger AS $$
DECLARE
    v_same BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('APPLIED', 'REJECTED') THEN
        IF NEW.approval_basis IS NOT NULL THEN
            RAISE EXCEPTION 'CORRECTION_PEOPLE: a request carries no approval basis';
        END IF;
        RETURN NEW;
    END IF;
    -- A row INSERTED already decided is judged exactly like a decision (the replaced CHECK covered INSERT too; nothing else forces a new row to be PENDING).
    IF (TG_OP = 'INSERT' OR OLD.status = 'PENDING') AND NEW.status IN ('APPLIED', 'REJECTED') THEN
        v_same := NEW.decided_by = NEW.requested_by OR NEW.decided_by_employee_id = NEW.requested_by_employee_id;
        IF v_same THEN
            -- The ONLY same-person decisions: the tenant's protected Owner, or a Principal holding a delegated FINANCIALS (or all-workflows) exemption, proved by the SQL seam NOW, on the Employee recorded.
            IF NOT ((NEW.approval_basis IS NOT DISTINCT FROM 'PROTECTED_OWNER'
                     AND eos_policy.is_protected_owner_employee(NEW.tenant_id, NEW.decided_by, NEW.decided_by_employee_id))
                    OR (NEW.approval_basis IS NOT DISTINCT FROM 'DELEGATED_EXEMPTION'
                        AND eos_policy.is_delegated_exempt_employee(NEW.tenant_id, NEW.decided_by, NEW.decided_by_employee_id, 'FINANCIALS'))) THEN
                RAISE EXCEPTION 'SELF_APPROVAL_FORBIDDEN: a correction is decided by a different Employee than the one who requested it, unless the decider is the tenant''s protected Owner or holds a delegated Financials self-approval exemption';
            END IF;
        ELSIF NEW.approval_basis IS NOT NULL THEN
            RAISE EXCEPTION 'CORRECTION_PEOPLE: an ordinary two-person decision carries no approval basis';
        END IF;
    ELSIF NEW.status = 'WITHDRAWN' AND NEW.approval_basis IS NOT NULL THEN
        RAISE EXCEPTION 'CORRECTION_PEOPLE: a withdrawal carries no approval basis';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE OR REPLACE FUNCTION assert_adjustment_fact_is_approved() RETURNS trigger AS $$
DECLARE
    c            RECORD;
    v_kind       TEXT;
    v_originated BIGINT;
    v_settled    BIGINT;
BEGIN
    IF NEW.fact_class <> 'OBLIGATION' OR NEW.fact_type NOT IN ('RECEIVABLE_CREDITED', 'RECEIVABLE_CHARGED', 'RECEIVABLE_WRITTEN_OFF') THEN
        RETURN NEW;
    END IF;
    v_kind := CASE NEW.fact_type WHEN 'RECEIVABLE_CREDITED' THEN 'CREDIT_MEMO' WHEN 'RECEIVABLE_CHARGED' THEN 'DEBIT_CHARGE' ELSE 'WRITE_OFF' END;
    SELECT * INTO c FROM eos_finance.invoice_corrections WHERE tenant_id = NEW.tenant_id AND id = NEW.source_record_id;
    IF NOT FOUND OR c.status <> 'APPLIED' OR c.fact_id IS NOT NULL OR c.kind <> v_kind OR c.obligation_id IS DISTINCT FROM NEW.obligation_id
       OR NEW.amount_minor <> (CASE WHEN v_kind = 'DEBIT_CHARGE' THEN c.amount_minor ELSE -c.amount_minor END)
       OR NOT ((c.decided_by <> c.requested_by AND c.decided_by_employee_id <> c.requested_by_employee_id AND c.approval_basis IS NULL)
               OR (c.approval_basis IS NOT DISTINCT FROM 'PROTECTED_OWNER' AND eos_policy.is_protected_owner_employee(c.tenant_id, c.decided_by, c.decided_by_employee_id))
               OR (c.approval_basis IS NOT DISTINCT FROM 'DELEGATED_EXEMPTION' AND eos_policy.is_delegated_exempt_employee(c.tenant_id, c.decided_by, c.decided_by_employee_id, 'FINANCIALS'))) THEN
        RAISE EXCEPTION 'ADJUSTMENT_NOT_APPROVED: a receivable is credited, charged or written off only by an APPLIED invoice correction decided by a separate Employee, by the protected Owner, or under a delegated Financials exemption';
    END IF;
    -- A credit or write-off never takes the receivable below what has been settled against it (outstanding never goes negative). The receivable's row is locked HERE, so the
    -- invariant does not depend on the application's lock or on the order the BEFORE triggers fire in (F7).
    PERFORM 1 FROM eos_finance.obligations ob WHERE ob.tenant_id = NEW.tenant_id AND ob.id = NEW.obligation_id FOR UPDATE;
    SELECT COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'OBLIGATION'), 0), COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'SETTLEMENT'), 0)
      INTO v_originated, v_settled
      FROM eos_finance.financial_facts f WHERE f.tenant_id = NEW.tenant_id AND f.obligation_id = NEW.obligation_id;
    IF v_originated + NEW.amount_minor < v_settled THEN
        RAISE EXCEPTION 'ADJUSTMENT_EXCEEDS_OUTSTANDING: % + % would fall below the settled %', v_originated, NEW.amount_minor, v_settled;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE OR REPLACE FUNCTION refuse_issued_invoice_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.obligation_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never deleted; it is corrected by a credit memo';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.obligation_id IS NOT NULL OR NEW.obligation_id IS NOT NULL THEN
        -- F-1b: the void columns, once, and nothing else; only for an APPLIED VOID correction decided by a separate Employee, or by the tenant's protected Owner (proved by the seam
        -- now, under approval_basis = 'PROTECTED_OWNER'), and only while NOTHING has moved: no settlement application (reversed or not), no settlement fact, no applied adjustment.
        -- Not a general bypass.
        IF OLD.obligation_id IS NOT NULL AND NEW.obligation_id = OLD.obligation_id
           AND OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL AND NEW.void_reason IS NOT NULL AND NEW.voided_by IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['voided_at', 'void_reason', 'voided_by']) = (to_jsonb(OLD) - ARRAY['voided_at', 'void_reason', 'voided_by'])
           AND EXISTS (SELECT 1 FROM eos_finance.invoice_corrections c
                        WHERE c.tenant_id = OLD.tenant_id AND c.invoice_id = OLD.id AND c.kind = 'VOID' AND c.status = 'APPLIED'
                          AND c.reason = NEW.void_reason AND c.decided_by = NEW.voided_by
                          AND ((c.decided_by <> c.requested_by AND c.decided_by_employee_id <> c.requested_by_employee_id AND c.approval_basis IS NULL)
                               OR (c.approval_basis IS NOT DISTINCT FROM 'PROTECTED_OWNER' AND eos_policy.is_protected_owner_employee(c.tenant_id, c.decided_by, c.decided_by_employee_id))
                               OR (c.approval_basis IS NOT DISTINCT FROM 'DELEGATED_EXEMPTION' AND eos_policy.is_delegated_exempt_employee(c.tenant_id, c.decided_by, c.decided_by_employee_id, 'FINANCIALS'))))
           AND NOT EXISTS (SELECT 1 FROM eos_finance.settlement_applications a WHERE a.tenant_id = OLD.tenant_id AND a.obligation_id = OLD.obligation_id)
           AND NOT EXISTS (SELECT 1 FROM eos_finance.financial_facts f WHERE f.tenant_id = OLD.tenant_id AND f.obligation_id = OLD.obligation_id AND f.fact_class = 'SETTLEMENT')
           AND NOT EXISTS (SELECT 1 FROM eos_finance.invoice_corrections x WHERE x.tenant_id = OLD.tenant_id AND x.invoice_id = OLD.id AND x.status = 'APPLIED' AND x.kind <> 'VOID') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never changed; it is corrected by a credit memo, or voided (two people or the protected Owner, before any money moves)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

-- ════════════════════ 4. Financial Policy versions ════════════════════

CREATE OR REPLACE FUNCTION assert_financial_policy_decider_independent() RETURNS trigger AS $$
DECLARE
    v_who  TEXT;
    v_name TEXT;
    v_new  TEXT;
    v_old  TEXT;
BEGIN
    FOREACH v_name IN ARRAY ARRAY['approved_by', 'rejected_by', 'activated_by', 'cancelled_by'] LOOP
        v_new := to_jsonb(NEW) ->> v_name;
        v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> v_name ELSE NULL END;
        -- Judged when the decider column is SET (a row decided earlier is never re-judged when the Owner later changes).
        IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old
           AND (v_new = NEW.submitted_by OR v_new = ANY (NEW.content_authors))
           AND eos_policy.protected_owner_employee(NEW.tenant_id, v_new) IS NULL
           AND NOT eos_policy.has_delegated_self_approval_exemption(NEW.tenant_id, v_new, 'FINANCIALS') THEN
            v_who := CASE v_name WHEN 'approved_by' THEN 'approver' WHEN 'rejected_by' THEN 'rejecter' WHEN 'activated_by' THEN 'activator' ELSE 'canceller' END;
            RAISE EXCEPTION 'SEPARATION_OF_DUTIES: financial_policy_%_independent -- the % of a financial policy version is neither its submitter nor an author of its content, unless the tenant''s protected Owner', v_who, v_who
                USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_policy_' || v_who || '_independent';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

-- ════════════════════ 5. NO grant ════════════════════
-- The seven keys are registered and held by nobody. The protected Owner grants them through Administration, one audited decision each.

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_finance.invoice_corrections WHERE approval_basis = 'DELEGATED_EXEMPTION';
    IF v_n > 0 THEN RAISE EXCEPTION 'SAE2_DELEGATED_EXEMPTION: refuses to reverse -- % invoice correction(s) were decided under a delegated exemption', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key IN ('approval.selfApproval.exemptFinancials', 'approval.selfApproval.exemptPurchasing', 'approval.selfApproval.exemptSales', 'approval.selfApproval.exemptInventory', 'approval.selfApproval.exemptService', 'approval.selfApproval.exemptGoals', 'approval.selfApproval.exemptAll');
    IF v_n > 0 THEN RAISE EXCEPTION 'SAE2_DELEGATED_EXEMPTION: refuses to reverse -- % Role grant(s) hold a self-approval exemption key', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key IN ('approval.selfApproval.exemptFinancials', 'approval.selfApproval.exemptPurchasing', 'approval.selfApproval.exemptSales', 'approval.selfApproval.exemptInventory', 'approval.selfApproval.exemptService', 'approval.selfApproval.exemptGoals', 'approval.selfApproval.exemptAll');
    IF v_n > 0 THEN RAISE EXCEPTION 'SAE2_DELEGATED_EXEMPTION: refuses to reverse -- % direct grant(s) hold a self-approval exemption key', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions d WHERE d.superseded_at IS NULL AND d.capability_key IN ('approval.selfApproval.exemptFinancials', 'approval.selfApproval.exemptPurchasing', 'approval.selfApproval.exemptSales', 'approval.selfApproval.exemptInventory', 'approval.selfApproval.exemptService', 'approval.selfApproval.exemptGoals', 'approval.selfApproval.exemptAll');
    IF v_n > 0 THEN RAISE EXCEPTION 'SAE2_DELEGATED_EXEMPTION: refuses to reverse -- % Administration decision(s) name an exemption key', v_n; END IF;
END
$$;

-- Back to 1764716000000's definitions (identical).
CREATE OR REPLACE FUNCTION assert_financial_policy_decider_independent() RETURNS trigger AS $$
DECLARE
    v_who  TEXT;
    v_name TEXT;
    v_new  TEXT;
    v_old  TEXT;
BEGIN
    FOREACH v_name IN ARRAY ARRAY['approved_by', 'rejected_by', 'activated_by', 'cancelled_by'] LOOP
        v_new := to_jsonb(NEW) ->> v_name;
        v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> v_name ELSE NULL END;
        -- Judged when the decider column is SET (a row decided earlier is never re-judged when the Owner later changes).
        IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old
           AND (v_new = NEW.submitted_by OR v_new = ANY (NEW.content_authors))
           AND eos_policy.protected_owner_employee(NEW.tenant_id, v_new) IS NULL THEN
            v_who := CASE v_name WHEN 'approved_by' THEN 'approver' WHEN 'rejected_by' THEN 'rejecter' WHEN 'activated_by' THEN 'activator' ELSE 'canceller' END;
            RAISE EXCEPTION 'SEPARATION_OF_DUTIES: financial_policy_%_independent -- the % of a financial policy version is neither its submitter nor an author of its content, unless the tenant''s protected Owner', v_who, v_who
                USING ERRCODE = 'check_violation', CONSTRAINT = 'financial_policy_' || v_who || '_independent';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE OR REPLACE FUNCTION assert_correction_people() RETURNS trigger AS $$
DECLARE
    v_same BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('APPLIED', 'REJECTED') THEN
        IF NEW.approval_basis IS NOT NULL THEN
            RAISE EXCEPTION 'CORRECTION_PEOPLE: a request carries no approval basis';
        END IF;
        RETURN NEW;
    END IF;
    -- A row INSERTED already decided is judged exactly like a decision (the replaced CHECK covered INSERT too; nothing else forces a new row to be PENDING).
    IF (TG_OP = 'INSERT' OR OLD.status = 'PENDING') AND NEW.status IN ('APPLIED', 'REJECTED') THEN
        v_same := NEW.decided_by = NEW.requested_by OR NEW.decided_by_employee_id = NEW.requested_by_employee_id;
        IF v_same THEN
            -- The ONLY same-person decision: the tenant's protected Owner, proved by the seam NOW, on the Employee recorded.
            IF NEW.approval_basis IS DISTINCT FROM 'PROTECTED_OWNER'
               OR NOT eos_policy.is_protected_owner_employee(NEW.tenant_id, NEW.decided_by, NEW.decided_by_employee_id) THEN
                RAISE EXCEPTION 'SELF_APPROVAL_FORBIDDEN: a correction is decided by a different Employee than the one who requested it, unless the decider is the tenant''s protected Owner';
            END IF;
        ELSIF NEW.approval_basis IS NOT NULL THEN
            RAISE EXCEPTION 'CORRECTION_PEOPLE: an ordinary two-person decision carries no approval basis';
        END IF;
    ELSIF NEW.status = 'WITHDRAWN' AND NEW.approval_basis IS NOT NULL THEN
        RAISE EXCEPTION 'CORRECTION_PEOPLE: a withdrawal carries no approval basis';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE OR REPLACE FUNCTION assert_adjustment_fact_is_approved() RETURNS trigger AS $$
DECLARE
    c            RECORD;
    v_kind       TEXT;
    v_originated BIGINT;
    v_settled    BIGINT;
BEGIN
    IF NEW.fact_class <> 'OBLIGATION' OR NEW.fact_type NOT IN ('RECEIVABLE_CREDITED', 'RECEIVABLE_CHARGED', 'RECEIVABLE_WRITTEN_OFF') THEN
        RETURN NEW;
    END IF;
    v_kind := CASE NEW.fact_type WHEN 'RECEIVABLE_CREDITED' THEN 'CREDIT_MEMO' WHEN 'RECEIVABLE_CHARGED' THEN 'DEBIT_CHARGE' ELSE 'WRITE_OFF' END;
    SELECT * INTO c FROM eos_finance.invoice_corrections WHERE tenant_id = NEW.tenant_id AND id = NEW.source_record_id;
    IF NOT FOUND OR c.status <> 'APPLIED' OR c.fact_id IS NOT NULL OR c.kind <> v_kind OR c.obligation_id IS DISTINCT FROM NEW.obligation_id
       OR NEW.amount_minor <> (CASE WHEN v_kind = 'DEBIT_CHARGE' THEN c.amount_minor ELSE -c.amount_minor END)
       OR NOT ((c.decided_by <> c.requested_by AND c.decided_by_employee_id <> c.requested_by_employee_id AND c.approval_basis IS NULL)
               OR (c.approval_basis IS NOT DISTINCT FROM 'PROTECTED_OWNER' AND eos_policy.is_protected_owner_employee(c.tenant_id, c.decided_by, c.decided_by_employee_id))) THEN
        RAISE EXCEPTION 'ADJUSTMENT_NOT_APPROVED: a receivable is credited, charged or written off only by an APPLIED invoice correction decided by a separate Employee, or by the protected Owner';
    END IF;
    -- A credit or write-off never takes the receivable below what has been settled against it (outstanding never goes negative). The receivable's row is locked HERE, so the
    -- invariant does not depend on the application's lock or on the order the BEFORE triggers fire in (F7).
    PERFORM 1 FROM eos_finance.obligations ob WHERE ob.tenant_id = NEW.tenant_id AND ob.id = NEW.obligation_id FOR UPDATE;
    SELECT COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'OBLIGATION'), 0), COALESCE(SUM(f.amount_minor) FILTER (WHERE f.fact_class = 'SETTLEMENT'), 0)
      INTO v_originated, v_settled
      FROM eos_finance.financial_facts f WHERE f.tenant_id = NEW.tenant_id AND f.obligation_id = NEW.obligation_id;
    IF v_originated + NEW.amount_minor < v_settled THEN
        RAISE EXCEPTION 'ADJUSTMENT_EXCEEDS_OUTSTANDING: % + % would fall below the settled %', v_originated, NEW.amount_minor, v_settled;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

CREATE OR REPLACE FUNCTION refuse_issued_invoice_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.obligation_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never deleted; it is corrected by a credit memo';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.obligation_id IS NOT NULL OR NEW.obligation_id IS NOT NULL THEN
        -- F-1b: the void columns, once, and nothing else; only for an APPLIED VOID correction decided by a separate Employee, or by the tenant's protected Owner (proved by the seam
        -- now, under approval_basis = 'PROTECTED_OWNER'), and only while NOTHING has moved: no settlement application (reversed or not), no settlement fact, no applied adjustment.
        -- Not a general bypass.
        IF OLD.obligation_id IS NOT NULL AND NEW.obligation_id = OLD.obligation_id
           AND OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL AND NEW.void_reason IS NOT NULL AND NEW.voided_by IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['voided_at', 'void_reason', 'voided_by']) = (to_jsonb(OLD) - ARRAY['voided_at', 'void_reason', 'voided_by'])
           AND EXISTS (SELECT 1 FROM eos_finance.invoice_corrections c
                        WHERE c.tenant_id = OLD.tenant_id AND c.invoice_id = OLD.id AND c.kind = 'VOID' AND c.status = 'APPLIED'
                          AND c.reason = NEW.void_reason AND c.decided_by = NEW.voided_by
                          AND ((c.decided_by <> c.requested_by AND c.decided_by_employee_id <> c.requested_by_employee_id AND c.approval_basis IS NULL)
                               OR (c.approval_basis IS NOT DISTINCT FROM 'PROTECTED_OWNER' AND eos_policy.is_protected_owner_employee(c.tenant_id, c.decided_by, c.decided_by_employee_id))))
           AND NOT EXISTS (SELECT 1 FROM eos_finance.settlement_applications a WHERE a.tenant_id = OLD.tenant_id AND a.obligation_id = OLD.obligation_id)
           AND NOT EXISTS (SELECT 1 FROM eos_finance.financial_facts f WHERE f.tenant_id = OLD.tenant_id AND f.obligation_id = OLD.obligation_id AND f.fact_class = 'SETTLEMENT')
           AND NOT EXISTS (SELECT 1 FROM eos_finance.invoice_corrections x WHERE x.tenant_id = OLD.tenant_id AND x.invoice_id = OLD.id AND x.status = 'APPLIED' AND x.kind <> 'VOID') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never changed; it is corrected by a credit memo, or voided (two people or the protected Owner, before any money moves)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;

ALTER TABLE invoice_corrections DROP CONSTRAINT invoice_correction_approval_basis_known;
ALTER TABLE invoice_corrections ADD CONSTRAINT invoice_correction_approval_basis_known CHECK (approval_basis IS NULL OR approval_basis = 'PROTECTED_OWNER');

DELETE FROM eos_policy.capabilities WHERE key IN ('approval.selfApproval.exemptFinancials', 'approval.selfApproval.exemptPurchasing', 'approval.selfApproval.exemptSales', 'approval.selfApproval.exemptInventory', 'approval.selfApproval.exemptService', 'approval.selfApproval.exemptGoals', 'approval.selfApproval.exemptAll');

DROP FUNCTION IF EXISTS eos_policy.is_delegated_exempt_employee(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS eos_policy.has_delegated_self_approval_exemption(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS eos_policy.eligible_employee_of(TEXT, TEXT);
