-- Up Migration
-- FINANCIAL POLICY FOUNDATION (DECISIONS #232, continuing the CERT-FIN-02 Owner ruling of 2026-09-03 and its §7 lifecycle;
-- docs/financials/financial-policy-foundation-authority.md). Server module: functions/src/eosFinance/financialPolicy.ts.
--
-- WHAT THIS IS. Each operating company's governed accounting-policy profile (inventory cost method, serialized cost method,
-- COGS recognition point, freight / landed-cost treatment), held in PostgreSQL as VERSIONS. Taylor and Ventana keep
-- INDEPENDENT policies: every row belongs to exactly one (tenant, operating company), never CONSOLIDATED.
--
-- LIFECYCLE (one row per version; a new configuration is always a NEW row, never an edit of an old one):
--
--     DRAFT --submit--> SUBMITTED --approve--> APPROVED --activate--> ACTIVE --(a later version activates)--> SUPERSEDED
--                                  \--reject---> REJECTED (terminal)
--
--   * DRAFT is the only state whose CONTENT may change. Leaving DRAFT freezes the content for good.
--   * After DRAFT the row only moves FORWARD along the edges above, and each lifecycle stamp (submitted / approved / rejected /
--     activated / superseded) is WRITE-ONCE. Nothing is ever deleted. That is the sense in which versions are append-only:
--     no fact a version records is rewritten or removed; the history is the rows plus their audit_events.
--   * ACTIVE is LOCKED: the only change an ACTIVE row admits is being marked SUPERSEDED by the activation of a later version,
--     in the same transaction (a deferred check refuses a commit where the superseding version is not ACTIVE). There is no
--     unlock, no reopen, no force: a change is a governed REVISION -- a new DRAFT, submitted, approved and activated.
--   * REJECTED and SUPERSEDED are terminal and immutable.
--   * At most ONE ACTIVE version and at most ONE in-flight (DRAFT / SUBMITTED / APPROVED) version per company (partial unique
--     indexes). A missing ACTIVE version means NOT CONFIGURED: readers fail closed, no default method exists anywhere.
--   * SEPARATION OF DUTIES, also enforced here: the principal who approves, rejects OR ACTIVATES is neither the submitter nor
--     anyone who wrote the draft's content (the approver may activate).
--   * The effective date is stamped at ACTIVATION and may not precede the company's business date
--     (eos_policy.operating_company_business_date) nor the effective date of an earlier activated version. LIFECYCLE IS NOT
--     EFFECTIVITY: an ACTIVE version dated in the future is SCHEDULED, and the version IN FORCE on a business date is the
--     latest ACTIVE / SUPERSEDED version whose effective_date is on or before it (a SUPERSEDED row keeps its own date).
--   * TRUNCATE is refused (statement trigger); in DRAFT, content_authors only grows.
--
-- VOCABULARIES mirror the pure domain module functions/src/finance/financialPolicyProfile.ts (INVENTORY_COST_METHODS,
-- SERIALIZED_COST_METHODS, COGS_RECOGNITION_POINT_IDS, FREIGHT_TREATMENTS, LANDED_COST_TREATMENTS). The CHECKs are defence in
-- depth (LIFO, STANDARD_COST, REPLACEMENT_COST cannot be stored even by a direct write); the server validates through the domain
-- module first, which also refuses a recognition point that is not AVAILABLE (WORK_ORDER_CONSUMPTION follows
-- PHYSICAL_CONSUMPTION_ACTIVE). Adding a supported method is a reviewed migration, as it should be.
--
-- AUTHORITY: four PG-NATIVE keys on the new `financialPolicy` Object, deliberately NOT the Firebase catalog ids
-- financialPolicy.profile.read / .configure (registering a catalog id would let the catalog reconcile grant it to admin):
--     finance.policy.read      READ          view the active version, the in-flight version and history
--     finance.policy.prepare   EDIT          create / edit a DRAFT and submit it
--     finance.policy.approve   ADMIN_ACTION  approve or reject a SUBMITTED version
--     finance.policy.activate  ADMIN_ACTION  activate an APPROVED version (locks it; supersedes the prior ACTIVE one)
-- ZERO GRANTS. Grants are proposed only (#232); the Owner authorizes them through Administration. Protected-Administrator
-- standing (#223) implies READ and ADMIN_ACTION kinds, so the Administrator reads, approves and activates by standing and
-- does NOT prepare (EDIT is not implied) -- exactly the #232 amendment.

SET search_path = eos_finance, public;

CREATE TABLE financial_policy_versions (
    id                               TEXT PRIMARY KEY CHECK (btrim(id) <> ''),
    tenant_id                        TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id             TEXT NOT NULL,
    version_number                   INTEGER NOT NULL CHECK (version_number > 0),
    status                           TEXT NOT NULL,
    -- the policy content (frozen once the version leaves DRAFT)
    inventory_cost_method            TEXT NOT NULL,
    serialized_inventory_cost_method TEXT NOT NULL,
    cogs_recognition_point           TEXT NOT NULL,
    freight_treatment                TEXT NOT NULL,
    landed_cost_treatment            TEXT NOT NULL,
    -- preparation: the creator, and EVERY principal who wrote the content (separation of duties reads this)
    prepared_by                      TEXT NOT NULL CHECK (btrim(prepared_by) <> ''),
    prepared_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_authors                  TEXT[] NOT NULL,
    last_edited_by                   TEXT NOT NULL CHECK (btrim(last_edited_by) <> ''),
    last_edited_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- lifecycle stamps (write-once)
    submitted_by                     TEXT CHECK (submitted_by IS NULL OR btrim(submitted_by) <> ''),
    submitted_at                     TIMESTAMPTZ,
    approved_by                      TEXT CHECK (approved_by IS NULL OR btrim(approved_by) <> ''),
    approved_at                      TIMESTAMPTZ,
    rejected_by                      TEXT CHECK (rejected_by IS NULL OR btrim(rejected_by) <> ''),
    rejected_at                      TIMESTAMPTZ,
    decision_reason                  TEXT CHECK (decision_reason IS NULL OR btrim(decision_reason) <> ''),
    activated_by                     TEXT CHECK (activated_by IS NULL OR btrim(activated_by) <> ''),
    activated_at                     TIMESTAMPTZ,
    effective_date                   DATE,
    superseded_by_version_id         TEXT,
    superseded_at                    TIMESTAMPTZ,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT financial_policy_version_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT financial_policy_version_number_unique UNIQUE (tenant_id, operating_company_id, version_number),
    CONSTRAINT financial_policy_version_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES eos_policy.tenant_operating_companies (tenant_id, operating_company_id),
    CONSTRAINT financial_policy_version_not_consolidated CHECK (lower(operating_company_id) <> 'consolidated'),
    CONSTRAINT financial_policy_version_superseded_by_fk FOREIGN KEY (tenant_id, superseded_by_version_id)
        REFERENCES financial_policy_versions (tenant_id, id),
    CONSTRAINT financial_policy_version_status_known
        CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'SUPERSEDED')),
    CONSTRAINT financial_policy_inventory_cost_method_supported
        CHECK (inventory_cost_method IN ('WEIGHTED_AVERAGE', 'FIFO')),
    CONSTRAINT financial_policy_serialized_cost_method_supported
        CHECK (serialized_inventory_cost_method IN ('SPECIFIC_IDENTIFICATION', 'WEIGHTED_AVERAGE', 'FIFO')),
    CONSTRAINT financial_policy_recognition_point_known
        CHECK (cogs_recognition_point IN ('SALES_ORDER_FULFILLMENT', 'INVOICE_ISSUE', 'EQUIPMENT_INSTALL', 'WORK_ORDER_CONSUMPTION')),
    CONSTRAINT financial_policy_freight_treatment_supported CHECK (freight_treatment IN ('EXCLUDED')),
    CONSTRAINT financial_policy_landed_cost_treatment_supported CHECK (landed_cost_treatment IN ('EXCLUDED')),
    CONSTRAINT financial_policy_content_authors_present
        CHECK (cardinality(content_authors) >= 1 AND prepared_by = content_authors[1] AND last_edited_by = ANY (content_authors)),
    -- Each status carries exactly the stamps it has earned.
    CONSTRAINT financial_policy_version_stamps_match_status CHECK (
        (submitted_by IS NULL) = (submitted_at IS NULL)
        AND (approved_by IS NULL) = (approved_at IS NULL)
        AND (rejected_by IS NULL) = (rejected_at IS NULL)
        AND (activated_by IS NULL) = (activated_at IS NULL)
        AND (activated_by IS NULL) = (effective_date IS NULL)
        AND (superseded_by_version_id IS NULL) = (superseded_at IS NULL)
        AND CASE status
            WHEN 'DRAFT' THEN submitted_by IS NULL AND approved_by IS NULL AND rejected_by IS NULL AND decision_reason IS NULL
                              AND activated_by IS NULL AND superseded_by_version_id IS NULL
            WHEN 'SUBMITTED' THEN submitted_by IS NOT NULL AND approved_by IS NULL AND rejected_by IS NULL AND decision_reason IS NULL
                              AND activated_by IS NULL AND superseded_by_version_id IS NULL
            WHEN 'APPROVED' THEN submitted_by IS NOT NULL AND approved_by IS NOT NULL AND rejected_by IS NULL
                              AND activated_by IS NULL AND superseded_by_version_id IS NULL
            WHEN 'REJECTED' THEN submitted_by IS NOT NULL AND rejected_by IS NOT NULL AND decision_reason IS NOT NULL
                              AND approved_by IS NULL AND activated_by IS NULL AND superseded_by_version_id IS NULL
            WHEN 'ACTIVE' THEN submitted_by IS NOT NULL AND approved_by IS NOT NULL AND activated_by IS NOT NULL
                              AND rejected_by IS NULL AND superseded_by_version_id IS NULL
            WHEN 'SUPERSEDED' THEN submitted_by IS NOT NULL AND approved_by IS NOT NULL AND activated_by IS NOT NULL
                              AND rejected_by IS NULL AND superseded_by_version_id IS NOT NULL
        END),
    -- SEPARATION OF DUTIES: the decision is never made by the submitter or by anyone who wrote the content.
    CONSTRAINT financial_policy_approver_independent CHECK (
        approved_by IS NULL OR (approved_by <> submitted_by AND NOT (approved_by = ANY (content_authors)))),
    CONSTRAINT financial_policy_rejecter_independent CHECK (
        rejected_by IS NULL OR (rejected_by <> submitted_by AND NOT (rejected_by = ANY (content_authors)))),
    -- #232 Phase 1: nobody who prepared, edited or submitted a version activates it (the approver may).
    CONSTRAINT financial_policy_activator_independent CHECK (
        activated_by IS NULL OR (activated_by <> submitted_by AND NOT (activated_by = ANY (content_authors))))
);

-- At most one ACTIVE version per company, and at most one version in flight (DRAFT / SUBMITTED / APPROVED).
CREATE UNIQUE INDEX financial_policy_one_active_per_company
    ON financial_policy_versions (tenant_id, operating_company_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX financial_policy_one_in_flight_per_company
    ON financial_policy_versions (tenant_id, operating_company_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED');

-- Every version is born a DRAFT.
CREATE OR REPLACE FUNCTION assert_financial_policy_version_born_draft() RETURNS trigger AS $$
BEGIN
    IF NEW.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_TRANSITION_ILLEGAL: a financial policy version is created as a DRAFT, never as %', NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE TRIGGER financial_policy_version_born_draft BEFORE INSERT ON financial_policy_versions
    FOR EACH ROW EXECUTE FUNCTION assert_financial_policy_version_born_draft();

-- THE LOCK, in the database: no delete ever; content frozen after DRAFT; forward-only edges; write-once stamps; an ACTIVE row
-- admits nothing but its supersession.
CREATE OR REPLACE FUNCTION refuse_financial_policy_version_mutation() RETURNS trigger AS $$
DECLARE
    v_business_date DATE;
    v_superseding RECORD;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: a financial policy version is never deleted (status %)', OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF (NEW.id, NEW.tenant_id, NEW.operating_company_id, NEW.version_number, NEW.prepared_by, NEW.prepared_at, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.operating_company_id, OLD.version_number, OLD.prepared_by, OLD.prepared_at, OLD.created_at) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: a version''s identity and preparer never change'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'DRAFT' THEN
        IF NEW.status NOT IN ('DRAFT', 'SUBMITTED') THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_TRANSITION_ILLEGAL: DRAFT -> %', NEW.status USING ERRCODE = 'restrict_violation';
        END IF;
        -- Even in DRAFT, authorship only grows: separation of duties reads content_authors, so dropping a name would let an
        -- author decide their own version. (prepared_by is covered by the identity check above.)
        IF NOT (NEW.content_authors @> OLD.content_authors) THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: content_authors is append-only' USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    -- Past DRAFT: the content is frozen.
    IF (NEW.inventory_cost_method, NEW.serialized_inventory_cost_method, NEW.cogs_recognition_point, NEW.freight_treatment,
        NEW.landed_cost_treatment, NEW.content_authors, NEW.last_edited_by, NEW.last_edited_at)
       IS DISTINCT FROM (OLD.inventory_cost_method, OLD.serialized_inventory_cost_method, OLD.cogs_recognition_point, OLD.freight_treatment,
        OLD.landed_cost_treatment, OLD.content_authors, OLD.last_edited_by, OLD.last_edited_at) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: the content of a % financial policy version is frozen; a change is a new version', OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- Forward-only edges. REJECTED and SUPERSEDED have none.
    IF NOT ((OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'REJECTED'))
            OR (OLD.status = 'APPROVED' AND NEW.status = 'ACTIVE')
            OR (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_TRANSITION_ILLEGAL: % -> % (a % version is %)', OLD.status, NEW.status, OLD.status,
            CASE WHEN OLD.status IN ('ACTIVE', 'SUPERSEDED') THEN 'locked' WHEN OLD.status = 'REJECTED' THEN 'final' ELSE 'not editable' END
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- Write-once stamps.
    IF (OLD.submitted_by IS NOT NULL AND (NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at))
       OR (OLD.approved_by IS NOT NULL AND (NEW.approved_by, NEW.approved_at, NEW.decision_reason) IS DISTINCT FROM (OLD.approved_by, OLD.approved_at, OLD.decision_reason))
       OR (OLD.activated_by IS NOT NULL AND (NEW.activated_by, NEW.activated_at, NEW.effective_date) IS DISTINCT FROM (OLD.activated_by, OLD.activated_at, OLD.effective_date)) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: lifecycle stamps are written once' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'ACTIVE' THEN
        -- The locked version: only its supersession by a later, APPROVED version of the same company.
        SELECT * INTO v_superseding FROM financial_policy_versions WHERE tenant_id = NEW.tenant_id AND id = NEW.superseded_by_version_id;
        IF v_superseding.id IS NULL OR v_superseding.operating_company_id <> OLD.operating_company_id
           OR v_superseding.version_number <= OLD.version_number OR v_superseding.status <> 'APPROVED' THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_LOCKED: an ACTIVE version is superseded only by activating a later approved version of the same company'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;
    IF NEW.status = 'ACTIVE' THEN
        v_business_date := eos_policy.operating_company_business_date(NEW.tenant_id, NEW.operating_company_id, now());
        IF NEW.effective_date < v_business_date THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_EFFECTIVE_DATE_PAST: % precedes the company business date %', NEW.effective_date, v_business_date
                USING ERRCODE = 'restrict_violation';
        END IF;
        PERFORM 1 FROM financial_policy_versions
          WHERE tenant_id = NEW.tenant_id AND operating_company_id = NEW.operating_company_id AND id <> NEW.id
            AND status IN ('ACTIVE', 'SUPERSEDED') AND effective_date >= NEW.effective_date;
        IF FOUND THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_EFFECTIVE_DATE_NOT_AFTER_PRIOR: an activated version must take effect after every earlier one'
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE TRIGGER financial_policy_version_lock BEFORE UPDATE OR DELETE ON financial_policy_versions
    FOR EACH ROW EXECUTE FUNCTION refuse_financial_policy_version_mutation();

-- Row triggers do not fire on TRUNCATE; a statement trigger does (precedent: audit_events_no_truncate, 1762646400000).
CREATE OR REPLACE FUNCTION refuse_financial_policy_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: % is governed history: TRUNCATE is refused', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE TRIGGER financial_policy_versions_no_truncate BEFORE TRUNCATE ON financial_policy_versions
    FOR EACH STATEMENT EXECUTE FUNCTION refuse_financial_policy_truncate();

-- A supersession commits only together with the activation that caused it.
CREATE OR REPLACE FUNCTION assert_financial_policy_supersession_completed() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM financial_policy_versions WHERE tenant_id = NEW.tenant_id AND id = NEW.superseded_by_version_id AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_SUPERSESSION_INCOMPLETE: version % was superseded but % is not ACTIVE', NEW.id, NEW.superseded_by_version_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = eos_finance, public;
CREATE CONSTRAINT TRIGGER financial_policy_supersession_completed AFTER UPDATE ON financial_policy_versions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.status = 'SUPERSEDED' AND OLD.status = 'ACTIVE')
    EXECUTE FUNCTION assert_financial_policy_supersession_completed();

CREATE INDEX financial_policy_versions_by_company ON financial_policy_versions (tenant_id, operating_company_id, version_number DESC);

-- ════════════════════ authority: four PG-native keys, ZERO grants ════════════════════

SET search_path = eos_policy, public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM capabilities WHERE object_key = 'financialPolicy' OR key LIKE 'finance.policy.%') THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_FOUNDATION: the financialPolicy Object already has capabilities';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_finance_policy_read', 'finance.policy.read',
     'View an operating company''s Financial Policy: the ACTIVE version, the version in flight and the version history. Changes nothing.',
     'financialPolicy', 'read', 'READ', 'View Financial Policy'),
    ('cap_finance_policy_prepare', 'finance.policy.prepare',
     'Prepare a Financial Policy version: create or edit a DRAFT (methods, recognition point, treatments) and submit it for approval. Never approves or activates.',
     'financialPolicy', 'prepare', 'EDIT', 'Prepare Financial Policy'),
    ('cap_finance_policy_approve', 'finance.policy.approve',
     'Approve or reject a SUBMITTED Financial Policy version, with a reason. Never a version the principal prepared or submitted.',
     'financialPolicy', 'approve', 'ADMIN_ACTION', 'Approve / Reject Financial Policy'),
    ('cap_finance_policy_activate', 'finance.policy.activate',
     'Activate an APPROVED Financial Policy version on a stated effective date: it is locked, and the prior ACTIVE version is superseded and kept.',
     'financialPolicy', 'activate', 'ADMIN_ACTION', 'Activate Financial Policy');

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM role_capabilities rc JOIN capabilities c ON c.id = rc.capability_id WHERE c.object_key = 'financialPolicy')
       OR EXISTS (SELECT 1 FROM principal_capabilities pc JOIN capabilities c ON c.id = pc.capability_id WHERE c.object_key = 'financialPolicy') THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_FOUNDATION: refuses to reverse -- a grant names a capability this migration registered';
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM role_capability_decisions WHERE capability_key LIKE 'finance.policy.%') THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_FOUNDATION: refuses to reverse -- an Administration decision names a capability this migration registered';
        END IF;
    END IF;
    SELECT count(*) INTO v_n FROM eos_finance.financial_policy_versions;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_FOUNDATION: refuses to reverse -- % financial policy version(s) exist', v_n;
    END IF;
END
$$;

DELETE FROM capabilities WHERE id IN ('cap_finance_policy_read', 'cap_finance_policy_prepare', 'cap_finance_policy_approve', 'cap_finance_policy_activate');

SET search_path = eos_finance, public;
DROP TABLE IF EXISTS financial_policy_versions;
DROP FUNCTION IF EXISTS assert_financial_policy_supersession_completed();
DROP FUNCTION IF EXISTS refuse_financial_policy_truncate();
DROP FUNCTION IF EXISTS refuse_financial_policy_version_mutation();
DROP FUNCTION IF EXISTS assert_financial_policy_version_born_draft();
