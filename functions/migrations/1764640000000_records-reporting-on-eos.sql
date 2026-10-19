-- Up Migration
-- RECORDS AND REPORTING OFF FIREBASE (Firebase exit B4, nonprod; DECISIONS #B4; Owner directive "DELIVER COMPLETE MIGRATION BATCHES",
-- 2026-10-17; REMAINING-FIREBASE-DEPENDENCIES rows F7d, F7e, F7f).
--
-- 1. THE REPORTING AND GOAL CAPABILITIES, REGISTERED (not granted). The 38 `report.*` ids the Firebase report engine decides on (four object
--    reads, the twenty-nine field reads and the four saved-definition mutations) and `performance.goal.read` are registered in EOS under the SAME
--    names as the Firebase catalog. Registering a key is not granting it, and granting it is not activating it: THIS MIGRATION GRANTS NOTHING.
--    The 122 grants that mirror the Firebase holders exactly (admin and owner: all 38 report ids; reportViewer: 26; reportFinanceViewer: 5;
--    reportAuthor: 3; performance.goal.read: twelve Roles) are a separate, grant-bearing change (migration 1764650000000) that needs the
--    Owner's explicit authorization, and are listed in DECISIONS #B4. Until it lands every report and goal operation answers CAPABILITY_REQUIRED
--    for everyone, which is the safe direction.
--    `report.definition.read` is NOT registered here: it has an EOS twin since migration 1762300800000 (`reportDefinition.read`) and the client
--    already asks it under that name.
--    The `report` Object carries one action per object/field id (the (object, action) pair is unique and the relation has no field column); the
--    saved-definition mutations sit on the existing `reportDefinition` Object; `performanceGoal` is a new security subject. Neither new Object
--    has a field or a CRED verb.
--
-- 2. IMPORTED SERVICE HISTORY (F7f-1): eos_ops.imported_service_history -- the records an Administration > Data Import of SERVICE_HISTORY writes,
--    account-scoped (account_id is an opaque id the writer resolves against eos_crm.accounts; there is deliberately NO foreign key between eos_ops and
--    eos_crm in either direction, crmCustomerPostgres) and operating-company-scoped (a record belongs to the company its import was
--    staged for; a reader reaches only the companies it is authorized for). The copy of the existing Firebase history is HELD.
--
-- 3. THE IMPORT JOB STORE (F7f-2): eos_ops.data_import_jobs -- the staged-then-approved job of the shared import pipeline (parse, map, validate,
--    preview, approval, per-row outcome), one document per job, company-scoped. SERVICE_HISTORY is the only entity wired on EOS.
--
-- 4. SAVED REPORT DEFINITIONS (F7e): eos_ops.report_definitions -- a definition envelope owned by one Principal. A saved definition confers NO
--    report-data access; a run re-decides every object and field capability and the caller's company reach.
--
-- 5. PERFORMANCE GOALS (F7d): eos_ops.performance_goals -- the versioned, effective-dated, approved TARGET (never an actual), read by the three
--    goal reads. Nothing in this migration creates a row: goals are created by the Firebase callables today and the copy is HELD.

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_report_customer_read', 'report.customer.read',
     'Object-level read gate for reporting on Customer/Account records. (Firebase catalog id, mirrored.)',
     'report', 'customerRead', 'BUSINESS_ACTION', 'Report On Customer Records'),
    ('cap_report_customer_field_name_read', 'report.customer.field.name.read',
     'Report field-read: customer.name. (Firebase catalog id, mirrored.)',
     'report', 'customerFieldNameRead', 'BUSINESS_ACTION', 'Report Field: Customer Name'),
    ('cap_report_customer_field_status_read', 'report.customer.field.status.read',
     'Report field-read: customer.status. (Firebase catalog id, mirrored.)',
     'report', 'customerFieldStatusRead', 'BUSINESS_ACTION', 'Report Field: Customer Status'),
    ('cap_report_customer_field_relationshipTypes_read', 'report.customer.field.relationshipTypes.read',
     'Report field-read: customer.relationshipTypes. (Firebase catalog id, mirrored.)',
     'report', 'customerFieldRelationshipTypesRead', 'BUSINESS_ACTION', 'Report Field: Customer Relationship Types'),
    ('cap_report_customer_field_billingAddress_read', 'report.customer.field.billingAddress.read',
     'Report field-read: customer.billingAddress (street/city/state/zip -- one capability, grouped per Spec section 5.1). (Firebase catalog id, mirrored.)',
     'report', 'customerFieldBillingAddressRead', 'BUSINESS_ACTION', 'Report Field: Customer Billing Address'),
    ('cap_report_customer_field_tags_read', 'report.customer.field.tags.read',
     'Report field-read: customer.tags. (Firebase catalog id, mirrored.)',
     'report', 'customerFieldTagsRead', 'BUSINESS_ACTION', 'Report Field: Customer Tags'),
    ('cap_report_customer_field_externalIds_read', 'report.customer.field.externalIds.read',
     'Report field-read: customer.customerNumber/erpId/accountingId/legacyId (one capability, grouped per Spec section 5.1). (Firebase catalog id, mirrored.)',
     'report', 'customerFieldExternalIdsRead', 'BUSINESS_ACTION', 'Report Field: Customer External Ids'),
    ('cap_report_customer_field_notes_read', 'report.customer.field.notes.read',
     'Report field-read: customer.notes -- security-text, inactive pending the wave-1 review''s explicit confirmation (Spec section 5 sensitivity legend). (Firebase catalog id, mirrored.)',
     'report', 'customerFieldNotesRead', 'BUSINESS_ACTION', 'Report Field: Customer Notes'),
    ('cap_report_customer_field_createdAt_read', 'report.customer.field.createdAt.read',
     'Report field-read: customer.createdAt. (Firebase catalog id, mirrored.)',
     'report', 'customerFieldCreatedAtRead', 'BUSINESS_ACTION', 'Report Field: Customer Created At'),
    ('cap_report_customer_field_paymentTerms_read', 'report.customer.field.paymentTerms.read',
     'Report field-read: customer.paymentTerms -- governed (Rules admin-only write, Issue #175). (Firebase catalog id, mirrored.)',
     'report', 'customerFieldPaymentTermsRead', 'BUSINESS_ACTION', 'Report Field: Customer Payment Terms'),
    ('cap_report_customer_field_taxStatus_read', 'report.customer.field.taxStatus.read',
     'Report field-read: customer.taxStatus -- governed (Rules admin-only write, Issue #175). (Firebase catalog id, mirrored.)',
     'report', 'customerFieldTaxStatusRead', 'BUSINESS_ACTION', 'Report Field: Customer Tax Status'),
    ('cap_report_customer_field_commercialProfile_read', 'report.customer.field.commercialProfile.read',
     'Report field-read: customer.defaultCurrency/purchaseOrderRequired/invoiceDeliveryMethod (one capability, grouped per Spec section 5.1). (Firebase catalog id, mirrored.)',
     'report', 'customerFieldCommercialProfileRead', 'BUSINESS_ACTION', 'Report Field: Customer Commercial Profile'),
    ('cap_report_customer_field_billingContact_read', 'report.customer.field.billingContact.read',
     'Report field-read: customer.billingContact (reference -> contact). (Firebase catalog id, mirrored.)',
     'report', 'customerFieldBillingContactRead', 'BUSINESS_ACTION', 'Report Field: Customer Billing Contact'),
    ('cap_report_customer_field_accountOwner_read', 'report.customer.field.accountOwner.read',
     'Report field-read: customer.accountOwner (reference -> employee) -- employee-sensitivity, deferred to wave 4 despite sitting in the wave-1 object table (Spec section 4). (Firebase catalog id, mirrored.)',
     'report', 'customerFieldAccountOwnerRead', 'BUSINESS_ACTION', 'Report Field: Customer Account Owner'),
    ('cap_report_contact_read', 'report.contact.read',
     'Object-level read gate for reporting on Contact records. (Firebase catalog id, mirrored.)',
     'report', 'contactRead', 'BUSINESS_ACTION', 'Report On Contact Records'),
    ('cap_report_contact_field_name_read', 'report.contact.field.name.read',
     'Report field-read: contact.name. (Firebase catalog id, mirrored.)',
     'report', 'contactFieldNameRead', 'BUSINESS_ACTION', 'Report Field: Contact Name'),
    ('cap_report_contact_field_email_read', 'report.contact.field.email.read',
     'Report field-read: contact.email. (Firebase catalog id, mirrored.)',
     'report', 'contactFieldEmailRead', 'BUSINESS_ACTION', 'Report Field: Contact Email'),
    ('cap_report_contact_field_phone_read', 'report.contact.field.phone.read',
     'Report field-read: contact.phone. (Firebase catalog id, mirrored.)',
     'report', 'contactFieldPhoneRead', 'BUSINESS_ACTION', 'Report Field: Contact Phone'),
    ('cap_report_contact_field_role_read', 'report.contact.field.role.read',
     'Report field-read: contact.role. (Firebase catalog id, mirrored.)',
     'report', 'contactFieldRoleRead', 'BUSINESS_ACTION', 'Report Field: Contact Role'),
    ('cap_report_contact_field_customer_read', 'report.contact.field.customer.read',
     'Report field-read: contact.accountId (reference -> customer). (Firebase catalog id, mirrored.)',
     'report', 'contactFieldCustomerRead', 'BUSINESS_ACTION', 'Report Field: Contact Customer'),
    ('cap_report_location_read', 'report.location.read',
     'Object-level read gate for reporting on Location records. (Firebase catalog id, mirrored.)',
     'report', 'locationRead', 'BUSINESS_ACTION', 'Report On Location Records'),
    ('cap_report_location_field_name_read', 'report.location.field.name.read',
     'Report field-read: location.name. (Firebase catalog id, mirrored.)',
     'report', 'locationFieldNameRead', 'BUSINESS_ACTION', 'Report Field: Location Name'),
    ('cap_report_location_field_address_read', 'report.location.field.address.read',
     'Report field-read: location.address.street/city/state/zip (one capability, grouped per Spec section 5.3). (Firebase catalog id, mirrored.)',
     'report', 'locationFieldAddressRead', 'BUSINESS_ACTION', 'Report Field: Location Address'),
    ('cap_report_location_field_accessNotes_read', 'report.location.field.accessNotes.read',
     'Report field-read: location.accessNotes -- security-text, inactive pending the wave-1 review''s explicit confirmation (Spec section 5 sensitivity legend). (Firebase catalog id, mirrored.)',
     'report', 'locationFieldAccessNotesRead', 'BUSINESS_ACTION', 'Report Field: Location Access Notes'),
    ('cap_report_location_field_customer_read', 'report.location.field.customer.read',
     'Report field-read: location.accountId (reference -> customer). (Firebase catalog id, mirrored.)',
     'report', 'locationFieldCustomerRead', 'BUSINESS_ACTION', 'Report Field: Location Customer'),
    ('cap_report_equipment_read', 'report.equipment.read',
     'Object-level read gate for reporting on Equipment records. (Firebase catalog id, mirrored.)',
     'report', 'equipmentRead', 'BUSINESS_ACTION', 'Report On Equipment Records'),
    ('cap_report_equipment_field_name_read', 'report.equipment.field.name.read',
     'Report field-read: equipment.name. (Firebase catalog id, mirrored.)',
     'report', 'equipmentFieldNameRead', 'BUSINESS_ACTION', 'Report Field: Equipment Name'),
    ('cap_report_equipment_field_status_read', 'report.equipment.field.status.read',
     'Report field-read: equipment.status. (Firebase catalog id, mirrored.)',
     'report', 'equipmentFieldStatusRead', 'BUSINESS_ACTION', 'Report Field: Equipment Status'),
    ('cap_report_equipment_field_identity_read', 'report.equipment.field.identity.read',
     'Report field-read: equipment.manufacturer/model/serialNumber/assetTag (one capability, grouped per Spec section 5.4). (Firebase catalog id, mirrored.)',
     'report', 'equipmentFieldIdentityRead', 'BUSINESS_ACTION', 'Report Field: Equipment Identity'),
    ('cap_report_equipment_field_dates_read', 'report.equipment.field.dates.read',
     'Report field-read: equipment.installedDate/warrantyExpiresDate (one capability, grouped per Spec section 5.4). (Firebase catalog id, mirrored.)',
     'report', 'equipmentFieldDatesRead', 'BUSINESS_ACTION', 'Report Field: Equipment Dates'),
    ('cap_report_equipment_field_notes_read', 'report.equipment.field.notes.read',
     'Report field-read: equipment.notes -- standard (not security-text; distinct from customer/location notes, Spec section 5.4). (Firebase catalog id, mirrored.)',
     'report', 'equipmentFieldNotesRead', 'BUSINESS_ACTION', 'Report Field: Equipment Notes'),
    ('cap_report_equipment_field_customer_read', 'report.equipment.field.customer.read',
     'Report field-read: equipment.accountId (reference -> customer). (Firebase catalog id, mirrored.)',
     'report', 'equipmentFieldCustomerRead', 'BUSINESS_ACTION', 'Report Field: Equipment Customer'),
    ('cap_report_equipment_field_location_read', 'report.equipment.field.location.read',
     'Report field-read: equipment.locationId (reference -> location). (Firebase catalog id, mirrored.)',
     'report', 'equipmentFieldLocationRead', 'BUSINESS_ACTION', 'Report Field: Equipment Location'),
    ('cap_report_equipment_field_createdAt_read', 'report.equipment.field.createdAt.read',
     'Report field-read: equipment.createdAt. (Firebase catalog id, mirrored.)',
     'report', 'equipmentFieldCreatedAtRead', 'BUSINESS_ACTION', 'Report Field: Equipment Created At'),
    ('cap_report_definition_create', 'report.definition.create',
     'Create a saved report definition (trusted saved-definition service). (Firebase catalog id, mirrored.)',
     'reportDefinition', 'create', 'BUSINESS_ACTION', 'Create Saved Report'),
    ('cap_report_definition_rename', 'report.definition.rename',
     'Rename one''s own saved report definition (trusted saved-definition service). (Firebase catalog id, mirrored.)',
     'reportDefinition', 'rename', 'BUSINESS_ACTION', 'Rename Saved Report'),
    ('cap_report_definition_duplicate', 'report.definition.duplicate',
     'Duplicate one''s own saved report definition (trusted saved-definition service). (Firebase catalog id, mirrored.)',
     'reportDefinition', 'duplicate', 'BUSINESS_ACTION', 'Duplicate Saved Report'),
    ('cap_report_definition_delete', 'report.definition.delete',
     'Delete one''s own saved report definition (trusted saved-definition service). (Firebase catalog id, mirrored.)',
     'reportDefinition', 'delete', 'BUSINESS_ACTION', 'Delete Saved Report'),
    ('cap_performance_goal_read', 'performance.goal.read',
     'Read governed performance goals (targets) at the caller''s authorized scope. Reads targets only -- it confers no reach over any metric''s ACTUAL, which stays governed by that metric''s own domain authority. (Firebase catalog id, mirrored.)',
     'performanceGoal', 'read', 'BUSINESS_ACTION', 'View Performance Goals')
ON CONFLICT (key) DO NOTHING;

SET search_path = eos_ops, public;

-- ════════════════════ imported service history (F7f-1) ════════════════════
--
-- A record of service performed in ANOTHER system. It is not a Work Order and never becomes one (no lifecycle, no dispatch, no metric counts it).
-- The technician NAME and the equipment SERIAL are stored as the file wrote them and are never resolved to an Employee or an Equipment record;
-- only the customer is linked, by the unique name match the import resolves. A row is provenance in full: its import job, its importer, its time.
CREATE TABLE imported_service_history (
    tenant_id               TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- 'SH-' || the per-row import key (job id and source row), so a retried row is recognised.
    id                      TEXT        NOT NULL,
    account_id              TEXT        NOT NULL,
    -- ONE owning company: the company the import was staged for. A key, as every eos_ops record carries; NOT NULL, no default.
    operating_company_key   TEXT        NOT NULL,
    -- The contract's identity key (source reference, else customer | date | summary). One per company: an import never overwrites.
    identity_key            TEXT        NOT NULL,
    service_date            DATE        NOT NULL,
    summary                 TEXT        NOT NULL,
    external_reference      TEXT,
    technician_name         TEXT,
    equipment_serial_number TEXT,
    location_name           TEXT,
    source_system           TEXT        NOT NULL DEFAULT 'DATA_IMPORT',
    import_job_id           TEXT        NOT NULL,
    imported_by             TEXT        NOT NULL,
    imported_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT imported_service_history_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT imported_service_history_identity_unique UNIQUE (tenant_id, operating_company_key, identity_key),
    CONSTRAINT imported_service_history_company_stated CHECK (btrim(operating_company_key) <> ''),
    CONSTRAINT imported_service_history_summary_stated CHECK (btrim(summary) <> '' AND length(summary) <= 5000),
    CONSTRAINT imported_service_history_source_stated CHECK (source_system = 'DATA_IMPORT'),
    CONSTRAINT imported_service_history_actor_stated CHECK (btrim(imported_by) <> '' AND btrim(import_job_id) <> '')
);

CREATE INDEX imported_service_history_by_account ON imported_service_history (tenant_id, account_id, service_date DESC);

-- ════════════════════ the import job store (F7f-2) ════════════════════
--
-- One document per job: the ImportJob of dataImport/importJob.ts (the portable model the shared pipeline already produces), stored whole so the
-- rows the admin APPROVED are the rows that execute -- never anything re-sent by the client. The status column is the claim guard: only a STAGED
-- job may move to EXECUTING, and that move is one conditional UPDATE.
CREATE TABLE data_import_jobs (
    tenant_id             TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    job_id                TEXT        NOT NULL,
    operating_company_key TEXT        NOT NULL,
    entity_type           TEXT        NOT NULL,
    status                TEXT        NOT NULL,
    file_name             TEXT        NOT NULL,
    target_environment    TEXT        NOT NULL,
    staged_by             TEXT        NOT NULL,
    staged_at             TIMESTAMPTZ NOT NULL,
    approved_by           TEXT,
    approved_at           TIMESTAMPTZ,
    job                   JSONB       NOT NULL,
    CONSTRAINT data_import_jobs_pkey PRIMARY KEY (tenant_id, job_id),
    CONSTRAINT data_import_jobs_status_known CHECK (status IN ('STAGED', 'EXECUTING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED')),
    CONSTRAINT data_import_jobs_entity_known CHECK (entity_type IN ('PARTS', 'CUSTOMERS', 'EQUIPMENT', 'INVENTORY', 'SERVICE_HISTORY')),
    CONSTRAINT data_import_jobs_company_stated CHECK (btrim(operating_company_key) <> ''),
    CONSTRAINT data_import_jobs_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
    CONSTRAINT data_import_jobs_actor_stated CHECK (btrim(staged_by) <> '' AND btrim(file_name) <> '')
);

CREATE INDEX data_import_jobs_by_company ON data_import_jobs (tenant_id, operating_company_key, staged_at DESC);

-- ════════════════════ saved report definitions (F7e) ════════════════════
--
-- The definition ENVELOPE (name, the object it reports on, and the validated definition blob). Owner-scoped: a Principal reads and changes only
-- its own, and another Principal's reads exactly as a missing one. It holds no row data and confers no report-data access.
CREATE TABLE report_definitions (
    tenant_id          TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id                 TEXT        NOT NULL,
    name               TEXT        NOT NULL,
    owner_principal_id TEXT        NOT NULL,
    object_id          TEXT        NOT NULL,
    definition         JSONB       NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT report_definitions_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT report_definitions_name_stated CHECK (btrim(name) <> '' AND length(name) <= 120),
    CONSTRAINT report_definitions_owner_stated CHECK (btrim(owner_principal_id) <> ''),
    CONSTRAINT report_definitions_object_stated CHECK (btrim(object_id) <> '')
);

CREATE INDEX report_definitions_by_owner ON report_definitions (tenant_id, owner_principal_id, updated_at DESC);

-- ════════════════════ performance goals (F7d) ════════════════════
--
-- A goal is a versioned, effective-dated, approved TARGET. Superseding closes the old version's window and writes a new row beside it, so a
-- September target stays September's. The Firebase Firestore ids and uids are carried VERBATIM as evidence (`*_ref`): they are not EOS
-- Principals and nothing here resolves them to one. There is no EOS writer in this batch (the copy of the existing goals is HELD).
CREATE TABLE performance_goals (
    tenant_id          TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    goal_id            TEXT        NOT NULL,
    metric_id          TEXT        NOT NULL,
    target_scope_type  TEXT        NOT NULL,
    target_scope_id    TEXT,
    target_value       BIGINT      NOT NULL,
    unit               TEXT        NOT NULL,
    direction          TEXT        NOT NULL,
    currency           TEXT,
    effective_from     DATE        NOT NULL,
    effective_to       DATE,
    status             TEXT        NOT NULL,
    version            INTEGER     NOT NULL,
    created_by_ref     TEXT        NOT NULL,
    created_at_ms      BIGINT      NOT NULL,
    approved_by_ref    TEXT,
    approved_at_ms     BIGINT,
    supersedes_goal_id TEXT,
    provenance         TEXT        NOT NULL DEFAULT 'MIGRATED',
    CONSTRAINT performance_goals_pkey PRIMARY KEY (tenant_id, goal_id),
    CONSTRAINT performance_goals_scope_known CHECK (target_scope_type IN ('EMPLOYEE', 'TEAM', 'LOCATION', 'BUSINESS_UNIT', 'OPERATING_COMPANY', 'FIRM')),
    CONSTRAINT performance_goals_scope_id_shape CHECK ((target_scope_type = 'FIRM') = (target_scope_id IS NULL)),
    CONSTRAINT performance_goals_direction_known CHECK (direction IN ('AT_LEAST', 'AT_MOST', 'EXACT')),
    CONSTRAINT performance_goals_status_known CHECK (status IN ('DRAFT', 'APPROVED', 'SUPERSEDED', 'RETIRED')),
    CONSTRAINT performance_goals_value_nonneg CHECK (target_value >= 0),
    CONSTRAINT performance_goals_window CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT performance_goals_version_positive CHECK (version >= 1),
    CONSTRAINT performance_goals_approval_evidence CHECK ((status = 'DRAFT') = (approved_by_ref IS NULL AND approved_at_ms IS NULL)),
    CONSTRAINT performance_goals_provenance_known CHECK (provenance IN ('NATIVE', 'MIGRATED'))
);

CREATE INDEX performance_goals_by_target ON performance_goals (tenant_id, metric_id, target_scope_type, target_scope_id, effective_from);

-- Down Migration
DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_ops.imported_service_history;
    IF v_n > 0 THEN RAISE EXCEPTION 'RECORDS_REPORTING_B4: refuses to reverse -- % imported service history record(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.data_import_jobs;
    IF v_n > 0 THEN RAISE EXCEPTION 'RECORDS_REPORTING_B4: refuses to reverse -- % data import job(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.report_definitions;
    IF v_n > 0 THEN RAISE EXCEPTION 'RECORDS_REPORTING_B4: refuses to reverse -- % saved report definition(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_ops.performance_goals;
    IF v_n > 0 THEN RAISE EXCEPTION 'RECORDS_REPORTING_B4: refuses to reverse -- % performance goal(s) exist', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions
     WHERE capability_key LIKE 'report.%' OR capability_key = 'performance.goal.read';
    IF v_n > 0 THEN RAISE EXCEPTION 'RECORDS_REPORTING_B4: refuses to reverse -- % Administration decision(s) name a reporting or goal capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
     WHERE c.key LIKE 'report.%' OR c.key = 'performance.goal.read';
    IF v_n > 0 THEN RAISE EXCEPTION 'RECORDS_REPORTING_B4: refuses to reverse -- % Role grant(s) hold a reporting or goal capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key LIKE 'report.%' OR c.key = 'performance.goal.read';
    IF v_n > 0 THEN RAISE EXCEPTION 'RECORDS_REPORTING_B4: refuses to reverse -- % direct grant(s) hold a reporting or goal capability', v_n; END IF;
END
$$;

DROP TABLE eos_ops.performance_goals;
DROP TABLE eos_ops.report_definitions;
DROP TABLE eos_ops.data_import_jobs;
DROP TABLE eos_ops.imported_service_history;

SET search_path = eos_policy, public;
DELETE FROM capabilities WHERE key LIKE 'report.%' OR key = 'performance.goal.read';
