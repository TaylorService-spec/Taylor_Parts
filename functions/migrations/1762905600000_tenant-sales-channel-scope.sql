-- Up Migration
-- TENANT SALES CHANNELS -- the governed VALUE SOURCE for the SALES_CHANNEL Security Role assignment scope
-- (lane GA, 2026-09-26). Local test databases only until the Owner promotes it.
--
-- ============================================================================
-- WHAT THIS IS. Which of the Commercial sales channels THIS TENANT operates. A Security Role assignment scoped to
-- a sales channel (user_role_assignments.scope_type = 'salesChannel') may name only a channel that is ACTIVE here.
-- ============================================================================
--
-- ════════════════════ THE VOCABULARY IS NOT RESTATED ════════════════════
--
-- The channel VOCABULARY already exists and is already the one every governed Commercial record carries:
-- eos_commercial.commercial_sales_channel (migration 1759449600000) -- NATIONAL_ACCOUNTS, RETAIL, STRATEGIC_ACCOUNTS,
-- stored on eos_commercial.opportunities.sales_channel and eos_commercial.sales_orders.sales_channel. A second
-- vocabulary for the same idea is how a scope value and a record value come to disagree, so this table's column IS
-- that enum: a scope value can only ever be a value a record can carry, and a new channel is one ALTER TYPE.
--
-- What the enum cannot say is which channels a TENANT uses. That is this table: an ACTIVATION, the same shape and
-- refusal-to-destroy posture as its sibling eos_policy.tenant_operating_companies (1759968000000). It STARTS EMPTY:
-- no channel is active anywhere until Administration activates it (setTenantSalesChannelStatus, audited, under the
-- tenant governance lock). Nothing here assigns anything to anybody.
--
-- ════════════════════ WHAT IT IS NOT ════════════════════
--
-- A channel grants NOTHING. It is a VALUE a Security Role assignment's scope may name; the Role still carries the
-- capabilities, and only the (salesChannel x capability) pairs the runtime decides (assignmentScopeRuntime.ts
-- SCOPE_EVALUABLE_GRANTS) are conferred at that scope. There is no RetailSalesManager / NationalAccountsSalesManager
-- Role, and no channel is ever derived from a Job Role, a Functional Role or a Security Role definition.
--
-- Rows are never deleted (DELETE and TRUNCATE are refused): a channel that stops being used is set INACTIVE, which
-- Administration refuses while any ACTIVE assignment is still scoped to it -- deactivation never strands a grant the
-- runtime would then decide against a value Administration no longer offers.

SET search_path = eos_policy, public;

CREATE TABLE tenant_sales_channels (
    tenant_id       TEXT                                     NOT NULL REFERENCES eos_policy.tenants(id),
    sales_channel   eos_commercial.commercial_sales_channel  NOT NULL,
    status          TEXT                                     NOT NULL,
    source          TEXT                                     NOT NULL,
    established_by  TEXT                                     NOT NULL,
    established_at  TIMESTAMPTZ                              NOT NULL DEFAULT now(),
    updated_by      TEXT                                     NOT NULL,
    updated_at      TIMESTAMPTZ                              NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, sales_channel),
    CONSTRAINT tenant_sales_channel_status_known CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT tenant_sales_channel_source_present CHECK (btrim(source) <> ''),
    CONSTRAINT tenant_sales_channel_actor_present CHECK (btrim(established_by) <> '' AND btrim(updated_by) <> '')
);

-- Identity is immutable and rows are never destroyed. Only status / provenance of the change may move.
CREATE FUNCTION tenant_sales_channels_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'TENANT_SALES_CHANNEL_IMMUTABLE: a tenant sales channel is never deleted; set it INACTIVE';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.sales_channel IS DISTINCT FROM OLD.sales_channel
       OR NEW.established_by IS DISTINCT FROM OLD.established_by OR NEW.established_at IS DISTINCT FROM OLD.established_at THEN
        RAISE EXCEPTION 'TENANT_SALES_CHANNEL_IMMUTABLE: identity and establishment of a tenant sales channel never change';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_sales_channels_guard
    BEFORE UPDATE OR DELETE ON tenant_sales_channels
    FOR EACH ROW EXECUTE FUNCTION tenant_sales_channels_guard();

-- TRUNCATE bypasses row triggers (the Pass 8 D10 / Pass 9 S6 class): refused at statement level.
CREATE FUNCTION tenant_sales_channels_no_truncate() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'TENANT_SALES_CHANNEL_IMMUTABLE: TRUNCATE of % is refused', TG_TABLE_NAME;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_sales_channels_no_truncate
    BEFORE TRUNCATE ON tenant_sales_channels
    FOR EACH STATEMENT EXECUTE FUNCTION tenant_sales_channels_no_truncate();

-- Down Migration
-- REFUSE, NEVER DESTROY: a tenant's sales channels are the values its scoped Security Role assignments name.
DO $$
DECLARE
    v_channels BIGINT;
    v_scoped BIGINT;
BEGIN
    SELECT count(*) INTO v_channels FROM eos_policy.tenant_sales_channels;
    SELECT count(*) INTO v_scoped FROM eos_policy.user_role_assignments WHERE scope_type = 'salesChannel';
    IF v_channels > 0 OR v_scoped > 0 THEN
        RAISE EXCEPTION 'this migration refuses to reverse: % tenant sales channel(s), % salesChannel-scoped assignment(s) are recorded',
            v_channels, v_scoped
            USING HINT = 'Withdraw them deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS tenant_sales_channels_no_truncate ON eos_policy.tenant_sales_channels;
DROP TABLE IF EXISTS eos_policy.tenant_sales_channels;
DROP FUNCTION IF EXISTS eos_policy.tenant_sales_channels_no_truncate();
DROP FUNCTION IF EXISTS eos_policy.tenant_sales_channels_guard();
