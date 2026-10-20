-- Up Migration
-- PROTECTED-OWNER EXEMPTION FROM SECONDARY APPROVAL -- the SQL seam and the database-level two-person rules that route through it (DECISIONS #SAE; Owner policy override 2026-10-20;
-- brief SAE2 + addendum SAE3). Slot 1764716000000 is PROVISIONAL: the controller assigns the final slot when it writes the file (F-1b is 1764712000000).
--
-- WHAT THIS CHANGES (and nothing else):
--   1. eos_policy.protected_owner_employee(tenant, principal) / is_protected_owner_employee(tenant, principal, employee)   THE SQL SEAM (STABLE; reads the governed tables).
--        A Principal is the tenant's protected Owner when it is ENABLED with an ACTIVE tenant membership, holds an ACTIVE, GLOBAL, non-stale assignment of THE protected Owner Role
--        (key 'owner' AND the stored protected flag), and has EXACTLY ONE ACTIVE link to an access-eligible (ACTIVE / CONTRACTOR) Employee. protected_owner_employee returns that
--        Employee id, or NULL. The TypeScript twin is access/secondaryApprovalExemption (qualifyingGlobalRoles + the Employee link); a Postgres test proves they agree.
--   2. eos_finance.invoice_corrections   gains approval_basis / approval_scope / approval_grant_source (NULL for an ordinary two-person decision). The CHECK
--        invoice_correction_two_person (decided_by <> requested_by AND decided_by_employee_id <> requested_by_employee_id) is REPLACED by the trigger
--        assert_correction_people: a same-person decision (same Principal or same Employee) is accepted ONLY when it records approval_basis = 'PROTECTED_OWNER' (with its provenance)
--        AND the seam proves, at that moment, that the decider is the tenant's protected Owner and the Employee recorded is that Principal's active link. Otherwise it is refused exactly
--        as before. A decision by a different person records no basis. Not a general bypass: no other column, status or table is touched.
--   3. assert_adjustment_fact_is_approved and refuse_issued_invoice_change   the same-person proof moves to the seam: an adjustment fact / the invoice void columns are admitted for an
--        APPLIED correction decided by a separate Employee, OR decided by the protected Owner under approval_basis = 'PROTECTED_OWNER' (proved by the seam at that moment).
--        Every other rule of both functions is unchanged (void only before money moves; never below what was settled).
--   4. eos_finance.financial_policy_versions   the four separation-of-duties CHECKs (approver / rejecter / activator / canceller independent) are REPLACED by the trigger
--        financial_policy_decider_independent: a decider who submitted or wrote the version is accepted ONLY when the seam proves they are the tenant's protected Owner, at the moment the
--        decider column is SET (a row decided earlier is never re-judged when the Owner later changes). The refusal keeps the original constraint names, so the application's mapping holds.
--   NO capability is registered. NO grant is made. No data is changed.
-- Drafted by the SAE lane; reviewed and written into the repository by the controller (agents cannot write migrations directly).

SET search_path = eos_policy, public;

-- ════════════════════ 1. the SQL seam ════════════════════

-- COUPLING (review L5): the employment-status list below ('ACTIVE', 'CONTRACTOR') is a HARD-CODED COPY of ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES
-- (functions/src/adminPolicy/employmentAccessEligibility.ts). The TypeScript seam reads that constant; this function cannot. If the constant ever changes, this function
-- MUST be replaced in a new migration in the same change, or the SQL and TypeScript seams disagree.
CREATE OR REPLACE FUNCTION eos_policy.protected_owner_employee(p_tenant TEXT, p_principal TEXT) RETURNS TEXT AS $$
    SELECT l.employee_id
      FROM eos_policy.employee_principal_links l
      JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
     WHERE l.tenant_id = p_tenant AND l.principal_id = p_principal AND l.status = 'active'
       AND e.employment_status::text IN ('ACTIVE', 'CONTRACTOR')
       AND (SELECT count(*) FROM eos_policy.employee_principal_links l2
             WHERE l2.tenant_id = p_tenant AND l2.principal_id = p_principal AND l2.status = 'active') = 1
       AND EXISTS (SELECT 1
                     FROM eos_policy.user_role_assignments a
                     JOIN eos_policy.roles r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
                     JOIN eos_policy.principals p ON p.id = a.principal_id AND p.status = 'active'
                     JOIN eos_policy.tenant_memberships m ON m.tenant_id = a.tenant_id AND m.principal_id = a.principal_id AND m.status = 'active'
                     LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
                    WHERE a.tenant_id = p_tenant AND a.principal_id = p_principal AND a.status = 'active' AND a.scope_type = 'global'
                      AND a.access_version_at_grant <= coalesce(v.access_version, 0)
                      AND r.key = 'owner' AND r.protected IS TRUE)
     LIMIT 1
$$ LANGUAGE sql STABLE;

-- NEVER NULL: a non-Owner makes protected_owner_employee() NULL, and NULL = employee is NULL. A trigger written as NOT is_protected_owner_employee(...) inside an OR / IF would then NOT raise
-- (a NULL condition is not true), which let a forged PROTECTED_OWNER basis through in CI. The COALESCE makes the answer TRUE or FALSE, so every caller is safe.
CREATE OR REPLACE FUNCTION eos_policy.is_protected_owner_employee(p_tenant TEXT, p_principal TEXT, p_employee TEXT) RETURNS BOOLEAN AS $$
    SELECT COALESCE(p_employee IS NOT NULL AND eos_policy.protected_owner_employee(p_tenant, p_principal) = p_employee, FALSE)
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION eos_policy.protected_owner_employee(TEXT, TEXT) IS
    'The Employee id of the tenant''s governed PROTECTED OWNER Principal (enabled, active membership, active global non-stale assignment of the protected owner Role, exactly one active access-eligible Employee link), else NULL. The single SQL source of the secondary-approval exemption (DECISIONS #SAE).';

-- ════════════════════ 2. invoice corrections: the people rule through the seam ════════════════════

SET search_path = eos_finance, public;

ALTER TABLE invoice_corrections
    ADD COLUMN approval_basis        TEXT,
    ADD COLUMN approval_scope        TEXT,
    ADD COLUMN approval_grant_source TEXT;

ALTER TABLE invoice_corrections ADD CONSTRAINT invoice_correction_approval_basis_known CHECK (approval_basis IS NULL OR approval_basis = 'PROTECTED_OWNER');
ALTER TABLE invoice_corrections ADD CONSTRAINT invoice_correction_approval_basis_shape CHECK (
    (approval_basis IS NULL) = (approval_grant_source IS NULL)
    AND (approval_basis IS NOT NULL OR approval_scope IS NULL)
    AND (approval_basis IS NULL OR (decided_by IS NOT NULL AND status IN ('APPLIED', 'REJECTED'))));
COMMENT ON COLUMN invoice_corrections.approval_basis IS
    'NULL for an ordinary two-person decision. PROTECTED_OWNER when the governed protected Owner decided a correction they requested themselves (DECISIONS #SAE); approval_grant_source records where the exemption comes from.';

ALTER TABLE invoice_corrections DROP CONSTRAINT invoice_correction_two_person;

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

CREATE TRIGGER invoice_corrections_people BEFORE INSERT OR UPDATE ON invoice_corrections
    FOR EACH ROW EXECUTE FUNCTION assert_correction_people();

-- ════════════════════ 3. the adjustment fact and the void gate: the same proof ════════════════════

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
               OR (c.approval_basis = 'PROTECTED_OWNER' AND eos_policy.is_protected_owner_employee(c.tenant_id, c.decided_by, c.decided_by_employee_id))) THEN
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
                               OR (c.approval_basis = 'PROTECTED_OWNER' AND eos_policy.is_protected_owner_employee(c.tenant_id, c.decided_by, c.decided_by_employee_id))))
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

-- ════════════════════ 4. Financial Policy versions: separation of duties through the seam ════════════════════

ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_approver_independent;
ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_rejecter_independent;
ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_activator_independent;
ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_canceller_independent;

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

CREATE TRIGGER financial_policy_decider_independent BEFORE INSERT OR UPDATE ON financial_policy_versions
    FOR EACH ROW EXECUTE FUNCTION assert_financial_policy_decider_independent();

-- ════════════════════ 5. NO capability, NO grant ════════════════════
-- The exemption is the protected Owner's standing (Rule 1). Nothing is registered and nobody is granted anything here.

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_finance.invoice_corrections WHERE approval_basis IS NOT NULL;
    IF v_n > 0 THEN RAISE EXCEPTION 'SAE_EXEMPTION: refuses to reverse -- % invoice correction(s) were decided under the protected-Owner exemption', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_finance.financial_policy_versions
     WHERE (approved_by IS NOT NULL AND (approved_by = submitted_by OR approved_by = ANY (content_authors)))
        OR (rejected_by IS NOT NULL AND (rejected_by = submitted_by OR rejected_by = ANY (content_authors)))
        OR (activated_by IS NOT NULL AND (activated_by = submitted_by OR activated_by = ANY (content_authors)))
        OR (cancelled_by IS NOT NULL AND (cancelled_by = submitted_by OR cancelled_by = ANY (content_authors)));
    IF v_n > 0 THEN RAISE EXCEPTION 'SAE_EXEMPTION: refuses to reverse -- % financial policy version(s) were decided by their own submitter or author', v_n; END IF;
END
$$;

DROP TRIGGER IF EXISTS financial_policy_decider_independent ON financial_policy_versions;
DROP FUNCTION IF EXISTS assert_financial_policy_decider_independent();
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_approver_independent CHECK (
    approved_by IS NULL OR (approved_by <> submitted_by AND NOT (approved_by = ANY (content_authors))));
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_rejecter_independent CHECK (
    rejected_by IS NULL OR (rejected_by <> submitted_by AND NOT (rejected_by = ANY (content_authors))));
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_activator_independent CHECK (
    activated_by IS NULL OR (activated_by <> submitted_by AND NOT (activated_by = ANY (content_authors))));
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_canceller_independent CHECK (
    cancelled_by IS NULL OR (cancelled_by <> submitted_by AND NOT (cancelled_by = ANY (content_authors))));

-- Back to F-1b's definitions (identical to migration 1764712000000).
CREATE OR REPLACE FUNCTION refuse_issued_invoice_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.obligation_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never deleted; it is corrected by a credit memo';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.obligation_id IS NOT NULL OR NEW.obligation_id IS NOT NULL THEN
        IF OLD.obligation_id IS NOT NULL AND NEW.obligation_id = OLD.obligation_id
           AND OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL AND NEW.void_reason IS NOT NULL AND NEW.voided_by IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['voided_at', 'void_reason', 'voided_by']) = (to_jsonb(OLD) - ARRAY['voided_at', 'void_reason', 'voided_by'])
           AND EXISTS (SELECT 1 FROM eos_finance.invoice_corrections c
                        WHERE c.tenant_id = OLD.tenant_id AND c.invoice_id = OLD.id AND c.kind = 'VOID' AND c.status = 'APPLIED'
                          AND c.reason = NEW.void_reason AND c.decided_by = NEW.voided_by
                          AND c.decided_by <> c.requested_by AND c.decided_by_employee_id <> c.requested_by_employee_id)
           AND NOT EXISTS (SELECT 1 FROM eos_finance.settlement_applications a WHERE a.tenant_id = OLD.tenant_id AND a.obligation_id = OLD.obligation_id)
           AND NOT EXISTS (SELECT 1 FROM eos_finance.financial_facts f WHERE f.tenant_id = OLD.tenant_id AND f.obligation_id = OLD.obligation_id AND f.fact_class = 'SETTLEMENT')
           AND NOT EXISTS (SELECT 1 FROM eos_finance.invoice_corrections x WHERE x.tenant_id = OLD.tenant_id AND x.invoice_id = OLD.id AND x.status = 'APPLIED' AND x.kind <> 'VOID') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'INVOICE_IMMUTABLE: an issued invoice is never changed; it is corrected by a credit memo, or voided (two people, before any money moves)';
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
       OR NEW.amount_minor <> (CASE WHEN v_kind = 'DEBIT_CHARGE' THEN c.amount_minor ELSE -c.amount_minor END) THEN
        RAISE EXCEPTION 'ADJUSTMENT_NOT_APPROVED: a receivable is credited, charged or written off only by an APPLIED invoice correction decided by a separate Employee';
    END IF;
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

DROP TRIGGER IF EXISTS invoice_corrections_people ON invoice_corrections;
DROP FUNCTION IF EXISTS assert_correction_people();
ALTER TABLE invoice_corrections ADD CONSTRAINT invoice_correction_two_person CHECK (
    status IN ('PENDING', 'WITHDRAWN') OR (decided_by <> requested_by AND decided_by_employee_id <> requested_by_employee_id));
ALTER TABLE invoice_corrections DROP CONSTRAINT invoice_correction_approval_basis_shape;
ALTER TABLE invoice_corrections DROP CONSTRAINT invoice_correction_approval_basis_known;
ALTER TABLE invoice_corrections DROP COLUMN approval_grant_source, DROP COLUMN approval_scope, DROP COLUMN approval_basis;

DROP FUNCTION IF EXISTS eos_policy.is_protected_owner_employee(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS eos_policy.protected_owner_employee(TEXT, TEXT);
