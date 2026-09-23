-- Up Migration
-- THE TWO SCOPE-POLICY RULINGS, made representable. Vocabulary first, then evidence-backed rows.
--
-- ════════════════════ RULING 1 -- PARTS_ASSOCIATE IS WORK ELIGIBILITY ════════════════════
--
-- `operationalRoleActive{role: "PARTS_OPERATIONS"}` gates technician's Reorder and Purchase Order
-- grants. It is BUSINESS WORK ELIGIBILITY -- what kind of work an Employee may be given -- not a
-- Security Role, not a Job Role, not Operational Scope, and NOT WAREHOUSE_OPERATIONS. The previous
-- slice refused to map it and reported WORK_ELIGIBILITY_UNMAPPED; this registers the real code and
-- that refusal disappears.
--
-- ════════════════════ RULING 2 -- QUEUE VISIBILITY IS OPERATIONAL SCOPE ════════════════════
--
-- Seeing the whole Reorder queue is WHERE an Employee may work, not what kind of work they may do
-- and not a relationship to one record. It becomes a governed Operational Scope.
--
-- THE WAREHOUSE FOREIGN KEY HAD TO GO, and that is the point of this migration rather than a side
-- effect. `employee_operational_scopes` carried an UNCONDITIONAL foreign key from (tenant_id,
-- scope_id) to eos_ops.warehouses, which is why it could hold exactly one scope type. Migration
-- 1760097600000 said so itself: "ONE SCOPE TYPE, DELIBERATELY ... the ruling forbids building
-- arbitrary scope types before a live consumer requires them." REORDER_QUEUE is that consumer.
--
-- The guarantee is not weakened, it is made per-type: a trigger validates scope_id against
-- eos_ops.warehouses for WAREHOUSE and against the governed operating-company KEY authority for
-- REORDER_QUEUE. A scope row still cannot name something that does not exist.
--
-- WHY THE QUEUE SCOPE IS COMPANY-KEYED. Reorder Requests carry operating_company_key, so a queue is
-- always some company's queue. Legacy access was tenant-wide, so preservation grants the scope for
-- EVERY active key the tenant has -- identical access today, and honest the moment a second
-- operating company exists.
SET search_path = eos_policy, public;

ALTER TABLE eos_workforce.employee_work_eligibility
    DROP CONSTRAINT work_eligibility_code_known;
ALTER TABLE eos_workforce.employee_work_eligibility
    ADD CONSTRAINT work_eligibility_code_known
    CHECK (qualification_code IN ('SERVICE_TECHNICIAN', 'WAREHOUSE_OPERATIONS', 'PARTS_OPERATIONS'));

ALTER TABLE eos_workforce.employee_operational_scopes
    DROP CONSTRAINT operational_scope_type_known;
ALTER TABLE eos_workforce.employee_operational_scopes
    ADD CONSTRAINT operational_scope_type_known
    CHECK (scope_type IN ('WAREHOUSE', 'REORDER_QUEUE'));
ALTER TABLE eos_workforce.employee_operational_scopes
    DROP CONSTRAINT operational_scope_warehouse_fk;

CREATE OR REPLACE FUNCTION eos_workforce.operational_scope_target_exists() RETURNS trigger AS $$
BEGIN
    IF NEW.scope_type = 'WAREHOUSE' THEN
        PERFORM 1 FROM eos_ops.warehouses w
          WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.scope_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'operational_scope_target_exists: warehouse % does not exist in this tenant', NEW.scope_id;
        END IF;
    ELSIF NEW.scope_type = 'REORDER_QUEUE' THEN
        -- The governed KEY authority, never the company id: migration 1760486400000 exists because
        -- operating_company_id and operating_company_key are different identifiers.
        PERFORM 1 FROM eos_policy.tenant_operating_company_keys k
          WHERE k.tenant_id = NEW.tenant_id AND k.operating_company_key = NEW.scope_id
            AND k.status = 'ACTIVE';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'operational_scope_target_exists: operating company key % is not ACTIVE in this tenant', NEW.scope_id;
        END IF;
    END IF;
    -- NO ELSE. An unknown scope_type is NOT this trigger's question -- operational_scope_type_known
    -- owns it, and a BEFORE trigger raising first would pre-empt the CHECK and give two different
    -- answers to "is this a known type". Falling through lets the constraint refuse it, exactly as
    -- it did before this migration existed.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER operational_scope_target_exists_trg
    BEFORE INSERT OR UPDATE ON eos_workforce.employee_operational_scopes
    FOR EACH ROW EXECUTE FUNCTION eos_workforce.operational_scope_target_exists();

-- ════════════════════ CANONICAL CAPABILITIES ════════════════════
--
-- `reorder.request.read` is the unscoped Object security authority the Owner ruled. Scope is NOT in
-- the key: the same capability reaches OWN records through a record assignment and the QUEUE through
-- an Operational Scope, and neither path is named here.
--
-- Purchase Order gets Read and Create because the domain has both and eleven Roles hold them
-- unconditioned. Technician's PO grants are conditioned on PARTS_ASSOCIATE and are DELIBERATELY NOT
-- migrated -- see the grant block.
INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_reorder_request_read', 'reorder.request.read',
     'Read Reorder Requests. Which requests is decided by context: an active assignment reaches OWN records, the REORDER_QUEUE Operational Scope reaches the shared queue.',
     'reorderRequest', 'read', 'READ', 'View Reorder Requests'),
    ('cap_reorder_purchaseOrder_read', 'reorder.purchaseOrder.read',
     'Read Purchase Orders raised from Reorder Requests.',
     'purchaseOrder', 'read', 'READ', 'View Purchase Orders'),
    ('cap_reorder_purchaseOrder_create', 'reorder.purchaseOrder.create',
     'Raise a Purchase Order against a supplier.',
     'purchaseOrder', 'create', 'CREATE', 'Create Purchase Order');

-- ════════════════════ GRANT PRESERVATION -- EXACT, FROM THE ROLE CATALOG ════════════════════
--
-- `reorder.request.read` goes to the UNION of the Roles holding either legacy read today: the six
-- queue Roles plus technician, which held only read.own. Technician gains no queue visibility from
-- this -- the queue needs an Operational Scope no technician has.
--
-- Purchase Order goes to the Roles measured UNCONDITIONED. `technician` is absent from both lists
-- on purpose: its PO grants carry operationalRoleActive(PARTS_ASSOCIATE), and granting the plain
-- capability would drop that gate. No governed Employee holds PARTS_ASSOCIATE eligibility today, so
-- withholding reproduces today's effective access exactly and loses nobody anything.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_q_' || substr(md5(r.tenant_id || r.id || c.id), 1, 26),
       r.tenant_id, r.id, c.id,
       'migration:1761696000000', now(), 'migration:1761696000000', now(), 'migration:1761696000000', now()
  FROM (VALUES
        ('admin', 'reorder.request.read'),
        ('dispatcher', 'reorder.request.read'),
        ('operationsManager', 'reorder.request.read'),
        ('owner', 'reorder.request.read'),
        ('partsManager', 'reorder.request.read'),
        ('purchasingManager', 'reorder.request.read'),
        ('technician', 'reorder.request.read'),
        ('admin', 'reorder.purchaseOrder.read'),
        ('dispatcher', 'reorder.purchaseOrder.read'),
        ('purchasingManager', 'reorder.purchaseOrder.read'),
        ('generalManager', 'reorder.purchaseOrder.read'),
        ('warehouseManager', 'reorder.purchaseOrder.read'),
        ('warehouseAssociate', 'reorder.purchaseOrder.read'),
        ('controller', 'reorder.purchaseOrder.read'),
        ('accountingManager', 'reorder.purchaseOrder.read'),
        ('financeManager', 'reorder.purchaseOrder.read'),
        ('operationsManager', 'reorder.purchaseOrder.read'),
        ('owner', 'reorder.purchaseOrder.read'),
        ('admin', 'reorder.purchaseOrder.create'),
        ('dispatcher', 'reorder.purchaseOrder.create'),
        ('purchasingManager', 'reorder.purchaseOrder.create'),
        ('generalManager', 'reorder.purchaseOrder.create'),
        ('owner', 'reorder.purchaseOrder.create')
      ) AS g(role_key, capability_key)
  JOIN roles        r ON r.key = g.role_key
  JOIN capabilities c ON c.key = g.capability_key
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- ════════════════════ QUEUE SCOPE PRESERVATION -- ONE TIME, FROM EVIDENCE ════════════════════
--
-- Derived from who can see the queue TODAY: a Principal holding one of the six queue Roles, through
-- its ACTIVE governed Employee link. This is a one-time preservation, NOT a standing rule -- no
-- trigger and no runtime path ever says "Role X implies REORDER_QUEUE". After this, Security Role
-- administration and Operational Scope administration are separate, and a new holder of those Roles
-- gets no queue scope from this migration or anything it leaves behind.
--
-- A Principal with NO Employee link receives nothing, and that is correct rather than a gap: an
-- Operational Scope is an Employee authority. In nonprod the two such Principals are the synthetic
-- fixtures whose own display names say "cannot sign in", so nobody loses access they could use.
INSERT INTO eos_workforce.employee_operational_scopes
    (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by, reason)
SELECT DISTINCT ON (l.tenant_id, l.employee_id, k.operating_company_key)
       'os_q_' || substr(md5(l.tenant_id || l.employee_id || k.operating_company_key), 1, 26),
       l.tenant_id, l.employee_id, 'REORDER_QUEUE', k.operating_company_key, now(),
       'migration:1761696000000',
       'preserved from the legacy reorder.request.read.queue capability held by this Employee''s Principal'
  FROM eos_policy.user_role_assignments ura
  JOIN roles r                             ON r.id = ura.role_id AND r.tenant_id = ura.tenant_id
  JOIN eos_policy.employee_principal_links l ON l.principal_id = ura.principal_id
                                            AND l.tenant_id = ura.tenant_id AND l.status = 'active'
  JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = ura.tenant_id AND k.status = 'ACTIVE'
 WHERE ura.status = 'active'
   AND r.key IN ('admin', 'dispatcher', 'operationsManager', 'owner', 'partsManager', 'purchasingManager')
   AND NOT EXISTS (
     SELECT 1 FROM eos_workforce.employee_operational_scopes e
      WHERE e.tenant_id = l.tenant_id AND e.employee_id = l.employee_id
        AND e.scope_type = 'REORDER_QUEUE' AND e.scope_id = k.operating_company_key
        AND e.effective_to IS NULL);

-- ════════════════════ PARTS_ASSOCIATE ELIGIBILITY PRESERVATION ════════════════════
--
-- Deliberately EMPTY, and the emptiness is the evidence. The five legacy PARTS_ASSOCIATE holders
-- live in the Firestore `employees` collection (cw-emp-025..028, sbx-partsassoc) and NONE of them
-- exists in eos_workforce.employees -- nonprod's governed workforce is the synthetic seed, a
-- disjoint id space. There is no governed Employee to preserve eligibility for.
--
-- `synthetic-np-emp-parts-associate` exists and is NOT given the qualification. Its name is a title,
-- and the Owner ruled no inference from Job Role, title, warehouse or Security Role. When the real
-- employee migration lands, their eligibility migrates with it as its own evidence-backed step.

-- ════════════════════ SUPERSEDING THE SCOPED KEY ════════════════════
--
-- `reorder.request.read.queue` stops being an active security authority. Its grants are removed
-- because the access they conveyed is now carried exactly by reorder.request.read plus the
-- REORDER_QUEUE scope; the capability ROW stays, as migration evidence, so the history of what it
-- meant is not deleted. A test forbids new grants to it.
DELETE FROM role_capabilities rc
 USING capabilities c
 WHERE c.id = rc.capability_id AND c.key = 'reorder.request.read.queue';

UPDATE capabilities
   SET description = 'SUPERSEDED by reorder.request.read plus the REORDER_QUEUE Operational Scope (migration 1761696000000). Retained as migration evidence; it must not be granted again.'
 WHERE key = 'reorder.request.read.queue';

-- Down Migration
SET search_path = eos_policy, public;

DELETE FROM eos_workforce.employee_operational_scopes WHERE assigned_by = 'migration:1761696000000';
DELETE FROM role_capabilities WHERE granted_by = 'migration:1761696000000';

-- REFUSES TO REVERSE rather than narrowing a vocabulary that recorded history still uses. Same
-- posture as the authorities this migration extends: reversing is for undoing a mistake made
-- moments ago, not for deleting qualifications and scopes somebody was actually granted.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eos_workforce.employee_work_eligibility
                WHERE qualification_code = 'PARTS_OPERATIONS') THEN
        RAISE EXCEPTION 'migration 1761696000000 refuses to reverse: PARTS_OPERATIONS qualifications are recorded, and narrowing the vocabulary would destroy that history';
    END IF;
    IF EXISTS (SELECT 1 FROM eos_workforce.employee_operational_scopes
                WHERE scope_type = 'REORDER_QUEUE') THEN
        RAISE EXCEPTION 'migration 1761696000000 refuses to reverse: REORDER_QUEUE scopes written outside this migration are recorded';
    END IF;
END $$;
DELETE FROM capabilities WHERE id IN
    ('cap_reorder_request_read', 'cap_reorder_purchaseOrder_read', 'cap_reorder_purchaseOrder_create');
DROP TRIGGER IF EXISTS operational_scope_target_exists_trg ON eos_workforce.employee_operational_scopes;
DROP FUNCTION IF EXISTS eos_workforce.operational_scope_target_exists();
ALTER TABLE eos_workforce.employee_operational_scopes
    DROP CONSTRAINT operational_scope_type_known;
ALTER TABLE eos_workforce.employee_operational_scopes
    ADD CONSTRAINT operational_scope_type_known CHECK (scope_type IN ('WAREHOUSE'));
ALTER TABLE eos_workforce.employee_operational_scopes
    ADD CONSTRAINT operational_scope_warehouse_fk
    FOREIGN KEY (tenant_id, scope_id) REFERENCES eos_ops.warehouses (tenant_id, id);
ALTER TABLE eos_workforce.employee_work_eligibility
    DROP CONSTRAINT work_eligibility_code_known;
ALTER TABLE eos_workforce.employee_work_eligibility
    ADD CONSTRAINT work_eligibility_code_known
    CHECK (qualification_code IN ('SERVICE_TECHNICIAN', 'WAREHOUSE_OPERATIONS'));
