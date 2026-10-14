-- Up Migration
-- FINANCIAL POLICY WITHDRAW / CANCEL (DECISIONS #232 Phase 3; docs/financials/financial-policy-foundation-authority.md §8).
-- Server module: functions/src/eosFinance/financialPolicy.ts (withdrawFinancialPolicy, cancelFinancialPolicy).
--
-- THE DEFECT IT CLOSES (Phase 3 nonprod finding). A company holds at most ONE in-flight version (DRAFT / SUBMITTED /
-- APPROVED, the partial unique index financial_policy_one_in_flight_per_company), and nothing could take a version OUT of
-- flight except rejection (SUBMITTED only) or activation (APPROVED only). An APPROVED version that should not be activated,
-- or a DRAFT / SUBMITTED one its preparer abandons, therefore stranded the company: no new draft could ever be created.
--
-- TWO NEW FINAL STATUSES (a version is never deleted; a change is still a new version):
--
--     DRAFT ------withdraw--> WITHDRAWN     by the version's OWN preparer: its creator, a content author or its submitter
--     SUBMITTED --withdraw--> WITHDRAWN     (server gate: finance.policy.prepare, company-scoped)
--     APPROVED ---cancel----> CANCELLED     by the Owner Role or the Administrator (server gate: finance.policy.approve with its
--                                           request-time reservation), never by the submitter or a content author
--     ACTIVE / SUPERSEDED ----> CANCELLED   the same, ONLY while the version is SCHEDULED: activated with an effective date
--                                           still AFTER the company's business date, i.e. never yet in force (Owner ruling
--                                           2026-10-14: "remains cancellable until activation actually occurs"). A version
--                                           IN FORCE (effective date on or before the business date) is never cancelled:
--                                           FINANCIAL_POLICY_LOCKED. The version it superseded at activation keeps
--                                           governing -- in force is resolved by date, and CANCELLED is never in force.
--
--   * Both are FINAL and immutable, like REJECTED. Nothing leaves them; REJECTED never enters them, and ACTIVE / SUPERSEDED
--     enter CANCELLED only while scheduled (above).
--   * Both RELEASE the company's in-flight slot: the in-flight index covers DRAFT / SUBMITTED / APPROVED only, so the new
--     statuses fall outside it with no index change. Neither is ever IN FORCE (in force = ACTIVE / SUPERSEDED by date).
--   * Both KEEP the version: content, every earlier stamp (submitted, approved, the approval note, and for a cancelled
--     scheduled version its activation and supersession stamps) and the audit trail are
--     untouched; the content freeze applies to DRAFT -> WITHDRAWN as well.
--   * Each records WHO, WHEN and WHY in its own write-once stamps. The reason gets a DEDICATED column rather than
--     decision_reason: on an APPROVED version decision_reason already holds the approval note and is write-once with the
--     approved stamps, so a cancellation must not overwrite it, and the stamps CHECK keeps decision_reason NULL on DRAFT /
--     SUBMITTED. Separate columns keep every recorded fact.
--   * IN ORDER: every transition writes only its own stamps; every other lifecycle stamp keeps its prior value (trigger).
--   * SEPARATION OF DUTIES, in the database: the canceller is neither the submitter nor any content author (as for the
--     approver / rejecter / activator; the approver may cancel their own approval). The withdrawer IS the version's own
--     preparer: a content author (content_authors[1] is the creator) or the submitter.
--   * CONCURRENCY. Activation and cancellation both take the per-company advisory lock and then the version's row lock
--     (SELECT ... FOR UPDATE) and re-read its status. Independently of the server, the transition trigger admits CANCELLED
--     only from OLD.status = 'APPROVED' and ACTIVE only from 'APPROVED': whichever commits first wins, and the other meets
--     FINANCIAL_POLICY_TRANSITION_ILLEGAL on the row it re-reads after the lock. The one-ACTIVE index and the deferred
--     supersession check are unchanged.
--
-- No capability, no grant, no Role, no data: the two commands reuse finance.policy.prepare and finance.policy.approve.

SET search_path = eos_finance, public;

ALTER TABLE financial_policy_versions
    ADD COLUMN withdrawn_by        TEXT CHECK (withdrawn_by IS NULL OR btrim(withdrawn_by) <> ''),
    ADD COLUMN withdrawn_at        TIMESTAMPTZ,
    ADD COLUMN withdrawal_reason   TEXT CHECK (withdrawal_reason IS NULL OR btrim(withdrawal_reason) <> ''),
    ADD COLUMN cancelled_by        TEXT CHECK (cancelled_by IS NULL OR btrim(cancelled_by) <> ''),
    ADD COLUMN cancelled_at        TIMESTAMPTZ,
    ADD COLUMN cancellation_reason TEXT CHECK (cancellation_reason IS NULL OR btrim(cancellation_reason) <> '');

ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_version_status_known;
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_version_status_known
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'SUPERSEDED', 'WITHDRAWN', 'CANCELLED'));

-- Each status carries exactly the stamps it has earned (the foundation's CHECK, extended by the two new pairs).
ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_version_stamps_match_status;
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_version_stamps_match_status CHECK (
    (submitted_by IS NULL) = (submitted_at IS NULL)
    AND (approved_by IS NULL) = (approved_at IS NULL)
    AND (rejected_by IS NULL) = (rejected_at IS NULL)
    AND (activated_by IS NULL) = (activated_at IS NULL)
    AND (activated_by IS NULL) = (effective_date IS NULL)
    AND (superseded_by_version_id IS NULL) = (superseded_at IS NULL)
    AND (withdrawn_by IS NULL) = (withdrawn_at IS NULL)
    AND (withdrawn_by IS NULL) = (withdrawal_reason IS NULL)
    AND (cancelled_by IS NULL) = (cancelled_at IS NULL)
    AND (cancelled_by IS NULL) = (cancellation_reason IS NULL)
    AND CASE status
        WHEN 'DRAFT' THEN submitted_by IS NULL AND approved_by IS NULL AND rejected_by IS NULL AND decision_reason IS NULL
                          AND activated_by IS NULL AND superseded_by_version_id IS NULL AND withdrawn_by IS NULL AND cancelled_by IS NULL
        WHEN 'SUBMITTED' THEN submitted_by IS NOT NULL AND approved_by IS NULL AND rejected_by IS NULL AND decision_reason IS NULL
                          AND activated_by IS NULL AND superseded_by_version_id IS NULL AND withdrawn_by IS NULL AND cancelled_by IS NULL
        WHEN 'APPROVED' THEN submitted_by IS NOT NULL AND approved_by IS NOT NULL AND rejected_by IS NULL
                          AND activated_by IS NULL AND superseded_by_version_id IS NULL AND withdrawn_by IS NULL AND cancelled_by IS NULL
        WHEN 'REJECTED' THEN submitted_by IS NOT NULL AND rejected_by IS NOT NULL AND decision_reason IS NOT NULL
                          AND approved_by IS NULL AND activated_by IS NULL AND superseded_by_version_id IS NULL
                          AND withdrawn_by IS NULL AND cancelled_by IS NULL
        WHEN 'ACTIVE' THEN submitted_by IS NOT NULL AND approved_by IS NOT NULL AND activated_by IS NOT NULL
                          AND rejected_by IS NULL AND superseded_by_version_id IS NULL AND withdrawn_by IS NULL AND cancelled_by IS NULL
        WHEN 'SUPERSEDED' THEN submitted_by IS NOT NULL AND approved_by IS NOT NULL AND activated_by IS NOT NULL
                          AND rejected_by IS NULL AND superseded_by_version_id IS NOT NULL AND withdrawn_by IS NULL AND cancelled_by IS NULL
        -- Withdrawn from DRAFT (never submitted) or from SUBMITTED (submitted, never decided).
        WHEN 'WITHDRAWN' THEN withdrawn_by IS NOT NULL AND approved_by IS NULL AND rejected_by IS NULL AND decision_reason IS NULL
                          AND activated_by IS NULL AND superseded_by_version_id IS NULL AND cancelled_by IS NULL
        -- Cancelled from APPROVED (never activated), or from a SCHEDULED ACTIVE / SUPERSEDED version (its activation and any
        -- supersession stamps kept): submitted and approved (the approval note kept) in every case.
        WHEN 'CANCELLED' THEN submitted_by IS NOT NULL AND approved_by IS NOT NULL AND cancelled_by IS NOT NULL
                          AND rejected_by IS NULL AND withdrawn_by IS NULL
                          AND (superseded_by_version_id IS NULL OR activated_by IS NOT NULL)
    END);

-- SEPARATION OF DUTIES: an APPROVED version is cancelled by neither its submitter nor anyone who wrote its content.
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_canceller_independent CHECK (
    cancelled_by IS NULL OR (cancelled_by <> submitted_by AND NOT (cancelled_by = ANY (content_authors))));
-- A preparer withdraws only their OWN version: a content author (the creator is content_authors[1]) or its submitter.
-- NULL-safe: content_authors holds no NULL (financial_policy_content_authors_no_null), and a NULL submitted_by never admits.
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_withdrawer_owns_version CHECK (
    withdrawn_by IS NULL OR withdrawn_by = ANY (content_authors) OR (submitted_by IS NOT NULL AND withdrawn_by = submitted_by));

-- THE LOCK, in the database, with the two new edges. Everything the foundation's trigger refused it still refuses.
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
    IF OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'SUBMITTED') THEN
        -- Even in DRAFT, authorship only grows: separation of duties reads content_authors, so dropping a name would let an
        -- author decide their own version. (prepared_by is covered by the identity check above.)
        IF NOT (NEW.content_authors @> OLD.content_authors) THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: content_authors is append-only' USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status <> 'WITHDRAWN' THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_TRANSITION_ILLEGAL: DRAFT -> %', NEW.status USING ERRCODE = 'restrict_violation';
    END IF;
    -- Past DRAFT (and on DRAFT -> WITHDRAWN): the content is frozen.
    IF (NEW.inventory_cost_method, NEW.serialized_inventory_cost_method, NEW.cogs_recognition_point, NEW.freight_treatment,
        NEW.landed_cost_treatment, NEW.content_authors, NEW.last_edited_by, NEW.last_edited_at)
       IS DISTINCT FROM (OLD.inventory_cost_method, OLD.serialized_inventory_cost_method, OLD.cogs_recognition_point, OLD.freight_treatment,
        OLD.landed_cost_treatment, OLD.content_authors, OLD.last_edited_by, OLD.last_edited_at) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: the content of a % financial policy version is frozen; a change is a new version', OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- Forward-only edges. REJECTED, WITHDRAWN and CANCELLED have none; ACTIVE its supersession; ACTIVE / SUPERSEDED their
    -- cancellation while still SCHEDULED (checked below).
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status = 'WITHDRAWN')
            OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'REJECTED', 'WITHDRAWN'))
            OR (OLD.status = 'APPROVED' AND NEW.status IN ('ACTIVE', 'CANCELLED'))
            OR (OLD.status = 'ACTIVE' AND NEW.status IN ('SUPERSEDED', 'CANCELLED'))
            OR (OLD.status = 'SUPERSEDED' AND NEW.status = 'CANCELLED')) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_TRANSITION_ILLEGAL: % -> % (a % version is %)', OLD.status, NEW.status, OLD.status,
            CASE WHEN OLD.status IN ('ACTIVE', 'SUPERSEDED') THEN 'locked'
                 WHEN OLD.status IN ('REJECTED', 'WITHDRAWN', 'CANCELLED') THEN 'final' ELSE 'not editable' END
            USING ERRCODE = 'restrict_violation';
    END IF;
    -- Write-once stamps.
    IF (OLD.submitted_by IS NOT NULL AND (NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at))
       OR (OLD.approved_by IS NOT NULL AND (NEW.approved_by, NEW.approved_at, NEW.decision_reason) IS DISTINCT FROM (OLD.approved_by, OLD.approved_at, OLD.decision_reason))
       OR (OLD.activated_by IS NOT NULL AND (NEW.activated_by, NEW.activated_at, NEW.effective_date) IS DISTINCT FROM (OLD.activated_by, OLD.activated_at, OLD.effective_date))
       OR (OLD.withdrawn_by IS NOT NULL AND (NEW.withdrawn_by, NEW.withdrawn_at, NEW.withdrawal_reason) IS DISTINCT FROM (OLD.withdrawn_by, OLD.withdrawn_at, OLD.withdrawal_reason))
       OR (OLD.cancelled_by IS NOT NULL AND (NEW.cancelled_by, NEW.cancelled_at, NEW.cancellation_reason) IS DISTINCT FROM (OLD.cancelled_by, OLD.cancelled_at, OLD.cancellation_reason)) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: lifecycle stamps are written once' USING ERRCODE = 'restrict_violation';
    END IF;
    -- IN ORDER: a transition writes ONLY its own stamps. Every other lifecycle stamp keeps its prior value (NULL stays NULL),
    -- so no edge can forge an earlier or later stamp -- e.g. a submission stamp on DRAFT -> WITHDRAWN, which would otherwise
    -- satisfy the withdrawer CHECK through submitted_by.
    IF (NEW.status <> 'SUBMITTED' AND (NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at))
       OR (NEW.status <> 'APPROVED' AND (NEW.approved_by, NEW.approved_at) IS DISTINCT FROM (OLD.approved_by, OLD.approved_at))
       OR (NEW.status <> 'REJECTED' AND (NEW.rejected_by, NEW.rejected_at) IS DISTINCT FROM (OLD.rejected_by, OLD.rejected_at))
       OR (NEW.status NOT IN ('APPROVED', 'REJECTED') AND NEW.decision_reason IS DISTINCT FROM OLD.decision_reason)
       OR (NEW.status <> 'ACTIVE' AND (NEW.activated_by, NEW.activated_at, NEW.effective_date) IS DISTINCT FROM (OLD.activated_by, OLD.activated_at, OLD.effective_date))
       OR (NEW.status <> 'SUPERSEDED' AND (NEW.superseded_by_version_id, NEW.superseded_at) IS DISTINCT FROM (OLD.superseded_by_version_id, OLD.superseded_at))
       OR (NEW.status <> 'WITHDRAWN' AND (NEW.withdrawn_by, NEW.withdrawn_at, NEW.withdrawal_reason) IS DISTINCT FROM (OLD.withdrawn_by, OLD.withdrawn_at, OLD.withdrawal_reason))
       OR (NEW.status <> 'CANCELLED' AND (NEW.cancelled_by, NEW.cancelled_at, NEW.cancellation_reason) IS DISTINCT FROM (OLD.cancelled_by, OLD.cancelled_at, OLD.cancellation_reason)) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: the % -> % transition writes only its own lifecycle stamps', OLD.status, NEW.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status IN ('ACTIVE', 'SUPERSEDED') AND NEW.status = 'CANCELLED' THEN
        -- Only a SCHEDULED version: its effective date still after the company's business date NOW. Once in force, locked.
        v_business_date := eos_policy.operating_company_business_date(OLD.tenant_id, OLD.operating_company_id, now());
        IF NOT (OLD.effective_date > v_business_date) THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_LOCKED: a % version in force since % is never cancelled (business date %); a change is a revision',
                OLD.status, OLD.effective_date, v_business_date USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;
    IF OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED' THEN
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

-- Down Migration
SET search_path = eos_finance, public;

DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_finance.financial_policy_versions WHERE status IN ('WITHDRAWN', 'CANCELLED');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_WITHDRAW_CANCEL: refuses to reverse -- % withdrawn or cancelled financial policy version(s) exist', v_n;
    END IF;
END
$$;

-- The foundation's trigger body, verbatim (1764560000000).
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
        IF NOT (NEW.content_authors @> OLD.content_authors) THEN
            RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: content_authors is append-only' USING ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF (NEW.inventory_cost_method, NEW.serialized_inventory_cost_method, NEW.cogs_recognition_point, NEW.freight_treatment,
        NEW.landed_cost_treatment, NEW.content_authors, NEW.last_edited_by, NEW.last_edited_at)
       IS DISTINCT FROM (OLD.inventory_cost_method, OLD.serialized_inventory_cost_method, OLD.cogs_recognition_point, OLD.freight_treatment,
        OLD.landed_cost_treatment, OLD.content_authors, OLD.last_edited_by, OLD.last_edited_at) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: the content of a % financial policy version is frozen; a change is a new version', OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT ((OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'REJECTED'))
            OR (OLD.status = 'APPROVED' AND NEW.status = 'ACTIVE')
            OR (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_TRANSITION_ILLEGAL: % -> % (a % version is %)', OLD.status, NEW.status, OLD.status,
            CASE WHEN OLD.status IN ('ACTIVE', 'SUPERSEDED') THEN 'locked' WHEN OLD.status = 'REJECTED' THEN 'final' ELSE 'not editable' END
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF (OLD.submitted_by IS NOT NULL AND (NEW.submitted_by, NEW.submitted_at) IS DISTINCT FROM (OLD.submitted_by, OLD.submitted_at))
       OR (OLD.approved_by IS NOT NULL AND (NEW.approved_by, NEW.approved_at, NEW.decision_reason) IS DISTINCT FROM (OLD.approved_by, OLD.approved_at, OLD.decision_reason))
       OR (OLD.activated_by IS NOT NULL AND (NEW.activated_by, NEW.activated_at, NEW.effective_date) IS DISTINCT FROM (OLD.activated_by, OLD.activated_at, OLD.effective_date)) THEN
        RAISE EXCEPTION 'FINANCIAL_POLICY_IMMUTABLE: lifecycle stamps are written once' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'ACTIVE' THEN
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

ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_withdrawer_owns_version;
ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_canceller_independent;
ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_version_stamps_match_status;
ALTER TABLE financial_policy_versions DROP CONSTRAINT financial_policy_version_status_known;
ALTER TABLE financial_policy_versions
    DROP COLUMN cancellation_reason, DROP COLUMN cancelled_at, DROP COLUMN cancelled_by,
    DROP COLUMN withdrawal_reason, DROP COLUMN withdrawn_at, DROP COLUMN withdrawn_by;
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_version_status_known
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'SUPERSEDED'));
ALTER TABLE financial_policy_versions ADD CONSTRAINT financial_policy_version_stamps_match_status CHECK (
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
    END);
