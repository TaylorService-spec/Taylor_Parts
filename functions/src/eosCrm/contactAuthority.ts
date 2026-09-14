// Governed PostgreSQL Contact authority -- wave D1-A. Internal; nothing external invokes it yet.
//
//   createContact        a person AT an Account of the actor's tenant; owner inherited from that Account AT CREATION
//   updateContact        name, email, phone, contactRole, isPrimary ONLY -- never the Account, owner or attribution
//   getContact           one Contact of the actor's tenant
//   listAccountContacts  bounded keyset list of one Account's Contacts
//
// AUTHORITY. The permission catalog registers NO Contact capability (policySeedSnapshot `contact.capabilitiesByVerb` is
// empty) and legacyAuthorizationSurface row 23 gates `contacts` with the SAME predicate as `accounts`. A Contact is
// reached only through its Account, so each operation requires the parent Account's catalogued capability for the same
// verb (CRM_CHILD_RECORD_CAPABILITIES). This is recorded as CRM_AUTHORITY_GAP pending an Owner ruling; it invents no id.
//
// TENANCY. The parent Account is read in the actor's tenant only, and `contacts_account_same_tenant` -- the composite
// (tenant_id, account_id) foreign key -- makes a cross-tenant link unrepresentable even if that read were skipped.
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
  runCrmRead,
  type CrmActorContext,
  type CrmDeps,
} from "./crmAuthorityKernel.js";

/**
 * CRM_AUTHORITY_GAP: no catalogued Contact / customer-site capability exists. Child records are governed by the parent
 * Account's capability for the same verb until an Owner ruling says otherwise. ONE place to change.
 */
export const CRM_CHILD_RECORD_CAPABILITIES = Object.freeze({
  READ: CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
  CREATE: CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE,
  UPDATE: CRM_CAPABILITIES.CUSTOMER_RECORD_UPDATE,
});

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

// ════════════════════ commands ════════════════════

export function createContact(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<ContactProjection> {
  return runCrmCommand(
    deps,
    actor,
    CRM_CHILD_RECORD_CAPABILITIES.CREATE,
    () => {
      const i = requireAllowlistedInput(input, ["accountId", ...Object.keys(CONTACT_UPDATE_COLUMNS)]);
      const fields = contactFields(i);
      if (!fields.has("name")) fail("NAME_REQUIRED", "INVALID_INPUT", "a Contact requires a name");
      return { accountId: requireRecordId(i.accountId, "accountId"), fields };
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
      return project(rows[0]);
    },
  );
}

export function updateContact(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<ContactProjection> {
  return runCrmCommand(
    deps,
    actor,
    CRM_CHILD_RECORD_CAPABILITIES.UPDATE,
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
    CRM_CHILD_RECORD_CAPABILITIES.READ,
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
    CRM_CHILD_RECORD_CAPABILITIES.READ,
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
