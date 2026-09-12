-- Up Migration
-- Employee ↔ Principal linkage — the place the mapping lives.
--
-- ============================================================================
-- MIGRATION 008. The canonical business Employee is `employees`; the security identity is
-- `eos_policy.principals` (migration 002). Until this migration, NOTHING JOINED THEM: `grep -i
-- employee functions/migrations/*.sql` returned zero matches, `principals` has no `employee_id`,
-- and there was no join table. The mapping had nowhere to live, so every consumer that needed it
-- re-derived it from Firestore document shape, and one of those derivations reaches for a
-- `fieldops_technicians` id (see "WHY THE TECHNICIAN ID IS NOT A LINK SOURCE" below).
--
-- STANDARD POSTGRESQL ONLY, same as 001-007. Additive: no existing migration is edited, and no
-- existing table gains or loses a column.
-- ============================================================================
--
-- ════════════════════ WHY A LINK TABLE, AND NOT A COLUMN ON principals ════════════════════
--
-- `principals.employee_id` was the shorter change and it is refused, for three reasons:
--
--   * A principal is not tenant-scoped; `tenant_memberships` is what says which tenant a principal
--     belongs to. An Employee IS tenant-scoped. A column on `principals` could not carry the
--     tenant without either duplicating membership or silently assuming one, and "assume one" is
--     the guess this lane exists to refuse.
--   * Migration 002's header states the reason `principals` is provider-neutral: replacing the
--     identity provider must be a row per principal, not a schema migration. Hanging a BUSINESS
--     object id off that table makes the security identity table a business table, and the next
--     business fact somebody wants about an Employee would land there too.
--   * A link is a relationship with its own provenance, its own lifecycle and its own author. A
--     column has none of those: it cannot record HOW the link was established, WHO asserted it, or
--     that it was revoked on a Tuesday and re-established on a Thursday.
--
-- ════════════════════ WHY THE COMPOSITE FOREIGN KEY, NOT REFERENCES principals(id) ════════════════════
--
-- EXACTLY migration 003's Ruling B, reused rather than re-argued:
--
--     employee_principal_links (tenant_id, principal_id)
--         REFERENCES tenant_memberships (tenant_id, principal_id)
--
-- A key onto `principals` alone would prove the principal EXISTS. It would not prevent tenant A's
-- Employee from being linked to a principal who belongs only to tenant B — a cross-tenant identity
-- leak rather than a dangling row. The composite key makes that unrepresentable, and
-- `tenant_memberships` already declares the UNIQUE (tenant_id, principal_id) it targets.
--
-- ════════════════════ WHY employee_id IS AN OPAQUE GOVERNED KEY WITH NO FOREIGN KEY ════════════════════
--
-- THERE IS NO `employees` TABLE IN POSTGRESQL YET. The canonical Employee record still lives in
-- Firestore's `employees` collection, and this migration does not invent a Postgres copy of it:
-- a second Employee master here would be the "unmaintained copy of reference data whose original
-- stays authoritative elsewhere" that migration 007's header already refuses for companies, and
-- migration 005's for locations.
--
-- So `employee_id` is carried the way migration 007 carries `location_id` and
-- `operating_company_key`: as data this schema stores and validates the SHAPE of, never as identity
-- it joins. When an `employees` table does arrive, this column is already the right name, the right
-- type and the right cardinality to take a foreign key with no restructuring — the constraint is
-- the only thing that has to be added, and that is a follow-up this header names rather than one a
-- reader has to infer.
--
-- The shape CHECK is not decoration: `employee_id` is a Firestore document id today, so an id
-- containing "/" or untrimmed whitespace is not an id at all, it is a path or a typo.
--
-- ════════════════════ WHY THE LINK IS ONE-TO-ONE IN BOTH DIRECTIONS ════════════════════
--
-- TWO partial unique indexes, both `WHERE status = 'active'`, and both are load-bearing:
--
--   * one ACTIVE link per (tenant, employee) — otherwise one Employee is two people's login;
--   * one ACTIVE link per (tenant, principal) — otherwise one login is two Employees, and every
--     "who did this" answer downstream becomes a choice.
--
-- Only one of the two is the obvious one, and shipping only the obvious one is how the other half
-- of the ambiguity survives. This is Ruling C's shape (migration 003): PARTIAL on `status`, so a
-- revoked link stays in the table as history and does not block a later re-link, and the audit
-- trail keeps every establishment and every revocation while at most one of them is ever in force.
--
-- ════════════════════ WHY THE TECHNICIAN ID IS NOT A LINK SOURCE ════════════════════
--
-- `link_source` is a CLOSED vocabulary of exactly two terms, and the CHECK is what makes the third
-- one unrepresentable:
--
--   RECIPROCAL_FIREBASE_UID_LINK — `employees/{id}.userId` and `users/{uid}.employeeId` agree in
--       BOTH directions, and that uid is the `external_subject` of the principal named here. This
--       is the only DERIVED source, and it is derived from a reciprocal fact, not a coincidence.
--   OPERATOR_ASSERTED — a named human stated this link, with a reason. Requires `asserted_by` AND
--       `assertion_reason` (the CHECK below), because an assertion with no author is a guess with
--       better handwriting.
--
-- There is deliberately NO term for "the technician id happened to equal the employee id". In the
-- live census 11 of 13 `fieldops_technicians` ids coincide exactly with `employees` ids — and 2 do
-- not (`tech-sbx-01`, `tech-sbx-02`). A rule inferred from the 11 is provably wrong for the 2, and
-- `fieldops_technicians` is compatibility data that must not remain employee-identity authority.
-- A future migration cannot add that term by accident: it would have to edit this CHECK, in a diff
-- a reviewer reads.
--
-- ════════════════════ WHY THE OPERATING COMPANY IS STATED, NOT DERIVED ════════════════════
--
-- `operating_company_id` is NOT NULL with NO DEFAULT, for migration 007's reason exactly: a DEFAULT
-- lets a writer that never decided a company still produce a row that claims one, and after the
-- fact that is indistinguishable from a deliberate assignment. It is never derived — not from a
-- warehouse, not from a truck, not from `homeWarehouseId`, and not from the Employee's job title.
-- The CHECK validates SHAPE only (the same slug pattern as
-- functions/src/ownership/operatingCompanyAuthority.ts's isOperatingCompanyIdShape), never
-- MEMBERSHIP: the governed set is the authority layer's answer, and encoding `taylor`/`ventana`
-- here would make adding a third company a schema migration.
--
-- ════════════════════ WHAT THIS TABLE DELIBERATELY DOES NOT CARRY ════════════════════
--
-- No `external_subject`, no `identity_provider`, no `display_name`, no `employment_status`, no
-- `technician_id`, no `skills`. Every one of those is already authoritative somewhere — the first
-- three on `principals`, the rest on the Employee record — and a copy here would be a second place
-- for the same fact to be stated, which is the only way two places can ever disagree. The link
-- table says WHICH TWO THINGS ARE THE SAME PERSON, and nothing else about either of them.

SET search_path = eos_policy, public;

CREATE TABLE employee_principal_links (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT        NOT NULL,
    principal_id         TEXT        NOT NULL,
    -- The canonical business Employee id. Opaque here; see the header for why there is no FK yet.
    employee_id          TEXT        NOT NULL,
    -- Stated by the writer, never inferred. Shape-checked, never membership-checked.
    operating_company_id TEXT        NOT NULL,
    link_source          TEXT        NOT NULL,
    status               TEXT        NOT NULL DEFAULT 'active',
    -- Provenance. Required for OPERATOR_ASSERTED (see the CHECK), optional otherwise.
    asserted_by          TEXT,
    assertion_reason     TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Ruling B's composite key, reused: the principal must be a member of THIS tenant, not merely
    -- exist. `tenant_memberships` already declares UNIQUE (tenant_id, principal_id).
    CONSTRAINT employee_principal_links_member_fk
        FOREIGN KEY (tenant_id, principal_id)
        REFERENCES tenant_memberships (tenant_id, principal_id),

    -- A closed vocabulary, because a `link_source` with free text means nothing after the third
    -- value somebody invents -- and the third value somebody would invent is the technician id.
    CONSTRAINT employee_principal_links_source_known
        CHECK (link_source IN ('RECIPROCAL_FIREBASE_UID_LINK', 'OPERATOR_ASSERTED')),

    CONSTRAINT employee_principal_links_status_known
        CHECK (status IN ('active', 'revoked')),

    -- An assertion always has an author and a reason. Enforced by the database, because the caller
    -- that would forget is exactly the caller that is guessing.
    CONSTRAINT employee_principal_links_assertion_has_author
        CHECK (
            link_source <> 'OPERATOR_ASSERTED'
            OR (
                asserted_by IS NOT NULL AND btrim(asserted_by) <> ''
                AND assertion_reason IS NOT NULL AND btrim(assertion_reason) <> ''
            )
        ),

    -- A Firestore document id: non-empty, trimmed, and not a path.
    CONSTRAINT employee_principal_links_employee_id_shape
        CHECK (employee_id <> '' AND btrim(employee_id) = employee_id AND position('/' in employee_id) = 0),

    -- The same slug shape operatingCompanyAuthority.ts's isOperatingCompanyIdShape() accepts.
    CONSTRAINT employee_principal_links_operating_company_shape
        CHECK (operating_company_id ~ '^[a-z][a-z0-9_-]{1,62}$')
);

-- ============================ one active link, in BOTH directions ============================
--
-- PARTIAL on `status = 'active'`: history survives, ambiguity does not.

CREATE UNIQUE INDEX employee_principal_links_one_active_per_employee
    ON employee_principal_links (tenant_id, employee_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX employee_principal_links_one_active_per_principal
    ON employee_principal_links (tenant_id, principal_id)
    WHERE status = 'active';

-- The lookup the runtime makes: "who is this authenticated principal, as an Employee?"
CREATE INDEX employee_principal_links_by_principal
    ON employee_principal_links (principal_id, status);

-- Down Migration
SET search_path = eos_policy, public;

DROP INDEX IF EXISTS employee_principal_links_by_principal;
DROP INDEX IF EXISTS employee_principal_links_one_active_per_principal;
DROP INDEX IF EXISTS employee_principal_links_one_active_per_employee;
DROP TABLE IF EXISTS employee_principal_links;
