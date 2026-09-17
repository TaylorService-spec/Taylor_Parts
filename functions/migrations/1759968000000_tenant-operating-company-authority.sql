-- Up Migration
-- TENANT <-> OPERATING COMPANY authority (EMP-RT-W2, Owner ruling 2026-09-16, option b).
--
-- ============================================================================
-- Answers exactly one question, as governed PostgreSQL state: "is operating company X ACTIVE and authorized for
-- tenant Y?" It is the tenant-scoped check the Employee lifecycle writer (changeOperatingCompany) needs before moving an
-- Employee to a company. It is NOT a company-management platform: no names, addresses, legal entities, codes or
-- hierarchy -- those stay where they are (ownership/operatingCompanyAuthority.ts is descriptive; this table decides).
--
-- WHY THIS IS NOT THE COPY MIGRATION 007 REFUSED. 007 declined a company master table because its original would have
-- stayed authoritative elsewhere (an unmaintained copy). This table holds a fact nothing else holds: which companies a
-- TENANT may use. A code-recognised id ('taylor', 'ventana') is not that fact, because the platform is multi-tenant.
--
-- NO SEED ROWS. Tenant ids are environment data, so a migration cannot know them. Rows are written only by the governed
-- operator reconciliation (functions/scripts/tenantOperatingCompanyReconcileCli.js) from governed evidence for the
-- named environment -- today only config/ownership/operating-company-roots.sandbox.json (Owner ruling R-1). No row is
-- fabricated for any other tenant.
--
-- Additive: no existing table, column or constraint is changed. Existing opaque operating_company_id /
-- operating_company_key columns are NOT given foreign keys here (that would retroactively re-validate other domains).
-- ============================================================================

SET search_path = eos_policy, public;

CREATE TABLE tenant_operating_companies (
    tenant_id             TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_id  TEXT        NOT NULL,
    status                TEXT        NOT NULL,
    source                TEXT        NOT NULL,
    established_by        TEXT        NOT NULL,
    established_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            TEXT        NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, operating_company_id),
    -- The same slug shape operatingCompanyAuthority.ts and eos_workforce.employees require.
    CONSTRAINT tenant_operating_company_id_shape CHECK (operating_company_id ~ '^[a-z][a-z0-9_-]{1,62}$'),
    CONSTRAINT tenant_operating_company_status_known CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT tenant_operating_company_source_present CHECK (btrim(source) <> ''),
    CONSTRAINT tenant_operating_company_actor_present CHECK (btrim(established_by) <> '' AND btrim(updated_by) <> '')
);

-- Down Migration
-- REFUSE, NEVER DESTROY: a tenant's authorized operating companies are authorization facts.
DO $$
DECLARE
    links BIGINT;
BEGIN
    SELECT count(*) INTO links FROM eos_policy.tenant_operating_companies;
    IF links > 0 THEN
        RAISE EXCEPTION 'this migration refuses to reverse: % tenant operating-company link(s) are recorded', links
            USING HINT = 'Export and withdraw the links deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TABLE IF EXISTS eos_policy.tenant_operating_companies;
