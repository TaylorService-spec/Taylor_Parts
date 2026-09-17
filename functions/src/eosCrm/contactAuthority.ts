// Governed PostgreSQL Contact authority -- wave D1-A. Internal; nothing external invokes it yet.
//
//   createContact        a person AT an Account of the actor's tenant; owner inherited from that Account AT CREATION
//   importAccountContacts  the atomic CSV import: 1..200 Contacts for ONE Account, all or none, one idempotency receipt
//   updateContact        name, email, phone, contactRole, isPrimary ONLY -- never the Account, owner or attribution
//   getContact           one Contact of the actor's tenant
//   listAccountContacts  bounded keyset list of one Account's Contacts
//
// AUTHORITY. Owner ruling (V1): Contacts use `customer.record.read|create|update` for their verbs, the same capabilities
// as their Account. Repository evidence carries no finer distinction: legacyAuthorizationSurface row 23 gates `contacts`
// with the same predicate as `accounts`, and firestore.rules' contacts block is admin/dispatcher for read, create and
// update alike. Create is idempotent (runCrmCreate).
//
// TENANCY. The parent Account is read in the actor's tenant only, and `contacts_account_same_tenant` -- the composite
// (tenant_id, account_id) foreign key -- makes a cross-tenant link unrepresentable even if that read were skipped.
//
// ATOMIC IMPORT. The legacy CSV import (field-ops-app-vite contactImport.js, retired by the CRM freeze) wrote every
// accepted Contact for ONE Account in a single atomic Firestore batch: all or none, at most MAX_IMPORT_ROWS = 200
// (contactCsvImport.js), never primary. importAccountContacts keeps exactly that contract in PostgreSQL:
//   * the SAME capability as createContact (customer.record.create) and the SAME per-row validation (contactFields,
//     name required), applied to EVERY row before the database is touched; any refused row refuses the WHOLE import
//     with INVALID_INPUT and a per-row indexed `findings` list, and writes nothing;
//   * isPrimary: imported Contacts are never primary -- `isPrimary: true` on a row is a finding, false is accepted;
//   * ONE transaction: the parent Account is read in the actor's tenant under FOR SHARE, every row is inserted with the
//     owner inherited from it exactly as createContact does, and any database failure rolls back every row;
//   * ONE idempotency receipt for the whole import (operation crm.importAccountContacts, target the Account), in the same
//     transaction: a replay returns the recorded result, a different request under the key refuses.
//   * duplicates: createContact has NO server duplicate rule, so neither does the import. The legacy duplicate SKIP
//     (contactDuplicateKey, email / name+phone against existing Contacts) was a client preview step, not a write rule.
//
// A Contact is not a login: nothing here references eos_policy.principals except as the acting writer.
import { randomUUID } from "node:crypto";
import { inheritOwnerFromAccount } from "../crm/customerIdentity.js";
import {
  CRM_CAPABILITIES,
  assignmentsOf,
  decodeCrmCursor,
  fail,
  isoOf,
  optionalText,
  pageOf,
  requireAllowlistedInput,
  requireName,
  requirePageSize,
  requireRecordId,
  requireTenantAccount,
  runCrmCommand,
  runCrmCreate,
  runCrmRead,
  splitIdempotentInput,
  CrmAuthorityError,
  type CrmRowFinding,
  type CrmActorContext,
  type CrmDeps,
  type CrmReplayable,
} from "./crmAuthorityKernel.js";

export interface ContactProjection {
  readonly contactId: string;
  readonly accountId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly contactRole: string | null;
  readonly isPrimary: boolean;
  readonly ownerEmployeeId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

interface ContactRow {
  id: string;
  account_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  contact_role: string | null;
  is_primary: boolean;
  owner_employee_id: string | null;
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
}

const COLUMNS = "id, account_id, name, email, phone, contact_role, is_primary, owner_employee_id, created_by, created_at, updated_by, updated_at";

const project = (row: ContactRow): ContactProjection => ({
  contactId: row.id,
  accountId: row.account_id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  contactRole: row.contact_role,
  isPrimary: row.is_primary,
  ownerEmployeeId: row.owner_employee_id,
  createdBy: row.created_by,
  createdAt: isoOf(row.created_at),
  updatedBy: row.updated_by,
  updatedAt: isoOf(row.updated_at),
});

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail("FIELD_INVALID", "INVALID_INPUT", `${field} must be a boolean`);
  return value as boolean;
}

const CONTACT_UPDATE_COLUMNS = Object.freeze({
  name: "name",
  email: "email",
  phone: "phone",
  contactRole: "contact_role",
  isPrimary: "is_primary",
});

function contactFields(i: Record<string, unknown>): Map<string, unknown> {
  const changes = new Map<string, unknown>();
  if (i.name !== undefined) changes.set("name", requireName(i.name, "a Contact"));
  for (const field of ["email", "phone", "contactRole"] as const) {
    if (i[field] !== undefined) changes.set(field, optionalText(i[field], field));
  }
  if (i.isPrimary !== undefined) changes.set("isPrimary", requireBoolean(i.isPrimary, "isPrimary"));
  return changes;
}

const CONTACT_ROW_FIELDS = Object.keys(CONTACT_UPDATE_COLUMNS);

/** createContact's row validation, exactly: allowlist, field shapes, name required. */
function contactCreateFields(i: Record<string, unknown>): Map<string, unknown> {
  const fields = contactFields(i);
  if (!fields.has("name")) fail("NAME_REQUIRED", "INVALID_INPUT", "a Contact requires a name");
  return fields;
}

// ════════════════════ commands ════════════════════

export function createContact(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<CrmReplayable<ContactProjection>> {
  return runCrmCreate(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE,
    "crm.createContact",
    () => {
      const i = requireAllowlistedInput(input, ["idempotencyKey", "accountId", ...CONTACT_ROW_FIELDS]);
      const { idempotencyKey, request } = splitIdempotentInput(i);
      const fields = contactCreateFields(i);
      return { idempotencyKey, request, accountId: requireRecordId(i.accountId, "accountId"), fields };
    },
    async (db, { tenantId, principalId }, { accountId, fields }) => {
      const parent = await requireTenantAccount(db, tenantId, accountId, "SHARE");
      const { rows } = await db.query<ContactRow>(
        `INSERT INTO eos_crm.contacts
           (id, tenant_id, account_id, name, email, phone, contact_role, is_primary, owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING ${COLUMNS}`,
        [`cont_${randomUUID()}`, tenantId, parent.id, fields.get("name"), fields.get("email") ?? null, fields.get("phone") ?? null,
          fields.get("contactRole") ?? null, fields.get("isPrimary") ?? false, inheritOwnerFromAccount(parent.ownerEmployeeId), principalId],
      );
      return { result: project(rows[0]), targetType: "CONTACT", targetId: rows[0].id };
    },
  );
}

/** The legacy CSV import's documented bound (contactCsvImport.js MAX_IMPORT_ROWS). A larger import refuses whole. */
export const MAX_CONTACT_IMPORT_ROWS = 200;

export interface ContactImportResult {
  readonly accountId: string;
  readonly importedCount: number;
  /** In the caller's row order. */
  readonly contacts: ContactProjection[];
}

export function importAccountContacts(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<CrmReplayable<ContactImportResult>> {
  return runCrmCreate(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE,
    "crm.importAccountContacts",
    () => {
      const i = requireAllowlistedInput(input, ["idempotencyKey", "accountId", "contacts"]);
      const { idempotencyKey, request } = splitIdempotentInput(i);
      const accountId = requireRecordId(i.accountId, "accountId");
      if (!Array.isArray(i.contacts) || i.contacts.length === 0 || i.contacts.length > MAX_CONTACT_IMPORT_ROWS) {
        fail("IMPORT_SIZE_INVALID", "INVALID_INPUT", `contacts must be an array of 1 to ${MAX_CONTACT_IMPORT_ROWS} Contacts`);
      }
      const findings: CrmRowFinding[] = [];
      const rows: Map<string, unknown>[] = [];
      (i.contacts as unknown[]).forEach((row, index) => {
        try {
          const fields = contactCreateFields(requireAllowlistedInput(row, CONTACT_ROW_FIELDS));
          if (fields.get("isPrimary") === true) {
            fail("IMPORTED_CONTACT_NEVER_PRIMARY", "INVALID_INPUT", "an imported Contact is never primary; choose the primary Contact on the Contact itself");
          }
          rows.push(fields);
        } catch (err) {
          if (!(err instanceof CrmAuthorityError)) throw err;
          // A row naming authority is not a row mistake: the whole call is refused as the forged request it is.
          if (err.category === "FORBIDDEN") throw err;
          findings.push({ index, code: err.code, message: err.message });
        }
      });
      if (findings.length > 0) {
        const listed = findings.slice(0, 10).map((f) => `${f.index} (${f.code})`).join(", ");
        fail("IMPORT_ROWS_INVALID", "INVALID_INPUT",
          `${findings.length} of ${(i.contacts as unknown[]).length} rows were refused, so nothing was imported: ${listed}${findings.length > 10 ? ", ..." : ""}`, findings);
      }
      return { idempotencyKey, request, accountId, rows };
    },
    async (db, { tenantId, principalId }, { accountId, rows }) => {
      const parent = await requireTenantAccount(db, tenantId, accountId, "SHARE");
      const owner = inheritOwnerFromAccount(parent.ownerEmployeeId);
      const ids = rows.map(() => `cont_${randomUUID()}`);
      const column = (field: string) => rows.map((r) => (r.get(field) ?? null) as string | null);
      const inserted = await db.query<ContactRow>(
        `INSERT INTO eos_crm.contacts
           (id, tenant_id, account_id, name, email, phone, contact_role, is_primary, owner_employee_id, created_by, updated_by)
         SELECT r.id, $1, $2, r.name, r.email, r.phone, r.contact_role, FALSE, $3, $4, $4
           FROM unnest($5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) WITH ORDINALITY AS r(id, name, email, phone, contact_role, ord)
          ORDER BY r.ord
         RETURNING ${COLUMNS}`,
        [tenantId, parent.id, owner, principalId, ids, column("name"), column("email"), column("phone"), column("contactRole")],
      );
      if (inserted.rows.length !== rows.length) fail("CRM_COMMAND_FAILED", "FAILED", "the command could not be completed");
      const byId = new Map(inserted.rows.map((row) => [row.id, project(row)]));
      const contacts = ids.map((id) => byId.get(id) as ContactProjection);
      return { result: { accountId: parent.id, importedCount: contacts.length, contacts }, targetType: "ACCOUNT", targetId: parent.id };
    },
  );
}

export function updateContact(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<ContactProjection> {
  return runCrmCommand(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_UPDATE,
    () => {
      const i = requireAllowlistedInput(input, ["contactId", ...Object.keys(CONTACT_UPDATE_COLUMNS)]);
      const changes = contactFields(i);
      if (changes.size === 0) fail("NO_CHANGES_REQUESTED", "INVALID_INPUT", "an update must name at least one accepted field");
      return { contactId: requireRecordId(i.contactId, "contactId"), changes };
    },
    async (db, { tenantId, principalId }, { contactId, changes }) => {
      const set = assignmentsOf(changes, CONTACT_UPDATE_COLUMNS, 4);
      const { rows } = await db.query<ContactRow>(
        `UPDATE eos_crm.contacts SET ${set.sql}, updated_by = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING ${COLUMNS}`,
        [tenantId, contactId, principalId, ...set.values],
      );
      if (rows.length === 0) fail("CONTACT_NOT_FOUND", "NOT_FOUND", "the Contact does not exist in this tenant");
      return project(rows[0]);
    },
  );
}

// ════════════════════ reads ════════════════════

export function getContact(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<ContactProjection> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => ({ contactId: requireRecordId(requireAllowlistedInput(input, ["contactId"]).contactId, "contactId") }),
    async (db, tenantId, { contactId }) => {
      const { rows } = await db.query<ContactRow>(`SELECT ${COLUMNS} FROM eos_crm.contacts WHERE tenant_id = $1 AND id = $2`, [tenantId, contactId]);
      if (rows.length === 0) fail("CONTACT_NOT_FOUND", "NOT_FOUND", "the Contact does not exist in this tenant");
      return project(rows[0]);
    },
  );
}

export interface ContactPage {
  readonly items: ContactProjection[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

export function listAccountContacts(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<ContactPage> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => {
      const i = requireAllowlistedInput(input, ["accountId", "limit", "cursor"]);
      return { accountId: requireRecordId(i.accountId, "accountId"), limit: requirePageSize(i.limit), cursor: decodeCrmCursor("contact", i.cursor) };
    },
    async (db, tenantId, { accountId, limit, cursor }) => {
      await requireTenantAccount(db, tenantId, accountId);
      const { rows } = await db.query<ContactRow & { folded_name: string }>(
        `SELECT ${COLUMNS}, lower(btrim(name)) AS folded_name
           FROM eos_crm.contacts
          WHERE tenant_id = $1 AND account_id = $2
            AND ($3::text IS NULL OR (lower(btrim(name)), id) > ($3::text, $4::text))
          ORDER BY lower(btrim(name)), id
          LIMIT $5`,
        [tenantId, accountId, cursor?.name ?? null, cursor?.id ?? null, limit + 1],
      );
      return pageOf("contact", rows, limit, project);
    },
  );
}
