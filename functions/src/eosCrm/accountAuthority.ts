// Governed PostgreSQL Account authority -- wave D1-A. Internal; nothing external invokes it yet.
//
//   createAccount   customer.record.create   name, status, and an EXPLICIT-OR-ABSENT owner (ruling D-6)
//   updateAccount   customer.record.update   name and status ONLY -- the allowlist; everything else refuses
//   getAccount      customer.record.read     one Account of the actor's tenant
//   listAccounts    customer.record.read     bounded keyset list, optional status filter and folded-name prefix
//
// IDENTITY. `eos_crm.accounts.id` is THE canonical Account id: `eos_commercial.*.account_id` references it through the
// composite (tenant_id, account_id) foreign keys of migration 1759449600000. There is no mapping id, and a new Account's
// id is minted once, here, and never re-minted.
//
// OWNERSHIP IS NOT ATTRIBUTION. `created_by` / `updated_by` are the acting EOS Principal. The owner is an Employee that
// must RESOLVE in this tenant through the governed PostgreSQL Employee authority, supplied explicitly or absent
// (OWNERLESS). It is never inferred from the actor, and post-creation owner change is not offered here (no catalogued
// capability governs it).
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { CRM_ACCOUNT_STATUSES, isCrmAccountStatus, requireExplicitAccountOwner, type CrmAccountStatus } from "../crm/customerIdentity.js";
import { createPostgresEmployeeAuthority } from "../employeeIdentity/postgresEmployeeAuthority.js";
import {
  CRM_CAPABILITIES,
  assignmentsOf,
  decodeCrmCursor,
  fail,
  isoOf,
  pageOf,
  requireAllowlistedInput,
  requireName,
  requirePageSize,
  requireRecordId,
  runCrmCommand,
  runCrmRead,
  type CrmActorContext,
  type CrmDeps,
} from "./crmAuthorityKernel.js";

export interface AccountProjection {
  readonly accountId: string;
  readonly name: string;
  readonly status: CrmAccountStatus;
  readonly ownerEmployeeId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

interface AccountRow {
  id: string;
  name: string;
  status: CrmAccountStatus;
  owner_employee_id: string | null;
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
}

const COLUMNS = "id, name, status, owner_employee_id, created_by, created_at, updated_by, updated_at";

const project = (row: AccountRow): AccountProjection => ({
  accountId: row.id,
  name: row.name,
  status: row.status,
  ownerEmployeeId: row.owner_employee_id,
  createdBy: row.created_by,
  createdAt: isoOf(row.created_at),
  updatedBy: row.updated_by,
  updatedAt: isoOf(row.updated_at),
});

function requireStatus(value: unknown): CrmAccountStatus {
  if (!isCrmAccountStatus(value)) fail("STATUS_INVALID", "INVALID_INPUT", `status must be one of ${CRM_ACCOUNT_STATUSES.join(", ")}`);
  return value as CrmAccountStatus;
}

async function requireOwnerEmployee(db: PoolClient, tenantId: string, employeeId: string): Promise<string> {
  const resolution = await createPostgresEmployeeAuthority(db).resolveEmployeeReference({ tenantId, employeeId });
  if (resolution.outcome === "RESOLVED") return resolution.employee.employeeId;
  if (resolution.outcome === "AUTHORITY_UNAVAILABLE") fail("EMPLOYEE_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", "the Employee authority could not answer");
  return fail("OWNER_NOT_FOUND", "NOT_FOUND", "the owner is not an Employee of this tenant");
}

// ════════════════════ commands ════════════════════

export function createAccount(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountProjection> {
  return runCrmCommand(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE,
    () => {
      const i = requireAllowlistedInput(input, ["name", "status", "ownerEmployeeId"]);
      let owner: string | null = null;
      if (i.ownerEmployeeId !== undefined) {
        try {
          owner = requireExplicitAccountOwner(i.ownerEmployeeId);
        } catch {
          fail("OWNER_INVALID", "INVALID_INPUT", "ownerEmployeeId is an explicit Employee id or null (OWNERLESS)");
        }
      }
      return { name: requireName(i.name, "an Account"), status: requireStatus(i.status), owner };
    },
    async (db, { tenantId, principalId }, { name, status, owner }) => {
      const ownerEmployeeId = owner === null ? null : await requireOwnerEmployee(db, tenantId, owner);
      const { rows } = await db.query<AccountRow>(
        `INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING ${COLUMNS}`,
        [`acct_${randomUUID()}`, tenantId, name, status, ownerEmployeeId, principalId],
      );
      return project(rows[0]);
    },
  );
}

const ACCOUNT_UPDATE_COLUMNS = Object.freeze({ name: "name", status: "status" });

export function updateAccount(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountProjection> {
  return runCrmCommand(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_UPDATE,
    () => {
      const i = requireAllowlistedInput(input, ["accountId", ...Object.keys(ACCOUNT_UPDATE_COLUMNS)]);
      const changes = new Map<string, unknown>();
      if (i.name !== undefined) changes.set("name", requireName(i.name, "an Account"));
      if (i.status !== undefined) changes.set("status", requireStatus(i.status));
      if (changes.size === 0) fail("NO_CHANGES_REQUESTED", "INVALID_INPUT", "an update must name at least one accepted field");
      return { accountId: requireRecordId(i.accountId, "accountId"), changes };
    },
    async (db, { tenantId, principalId }, { accountId, changes }) => {
      const set = assignmentsOf(changes, ACCOUNT_UPDATE_COLUMNS, 4);
      const { rows } = await db.query<AccountRow>(
        `UPDATE eos_crm.accounts SET ${set.sql}, updated_by = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING ${COLUMNS}`,
        [tenantId, accountId, principalId, ...set.values],
      );
      if (rows.length === 0) fail("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
      return project(rows[0]);
    },
  );
}

// ════════════════════ reads ════════════════════

export function getAccount(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountProjection> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => ({ accountId: requireRecordId(requireAllowlistedInput(input, ["accountId"]).accountId, "accountId") }),
    async (db, tenantId, { accountId }) => {
      const { rows } = await db.query<AccountRow>(`SELECT ${COLUMNS} FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
      if (rows.length === 0) fail("ACCOUNT_NOT_FOUND", "NOT_FOUND", "the Account does not exist in this tenant");
      return project(rows[0]);
    },
  );
}

export interface AccountPage {
  readonly items: AccountProjection[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

const MAX_NAME_PREFIX = 200;

export function listAccounts(deps: CrmDeps, actor: CrmActorContext, input: unknown = {}): Promise<AccountPage> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => {
      const i = requireAllowlistedInput(input, ["limit", "cursor", "status", "nameStartsWith"]);
      let statuses: string[] | null = null;
      if (i.status !== undefined) {
        const values = typeof i.status === "string" ? [i.status] : i.status;
        if (!Array.isArray(values) || values.length === 0 || values.length > CRM_ACCOUNT_STATUSES.length || !values.every(isCrmAccountStatus)) {
          fail("FILTER_INVALID", "INVALID_INPUT", `status must be one of, or a non-empty array of, ${CRM_ACCOUNT_STATUSES.join(", ")}`);
        }
        statuses = [...new Set(values as string[])];
      }
      let prefix: string | null = null;
      if (i.nameStartsWith !== undefined) {
        if (typeof i.nameStartsWith !== "string" || i.nameStartsWith.trim() === "" || i.nameStartsWith.length > MAX_NAME_PREFIX) {
          fail("FILTER_INVALID", "INVALID_INPUT", `nameStartsWith must be a non-empty string of at most ${MAX_NAME_PREFIX} characters`);
        }
        // The SAME fold as eos_crm's `lower(btrim(name))` index and customerIdentity.foldCustomerName.
        prefix = (i.nameStartsWith as string).trim().toLowerCase();
      }
      return { limit: requirePageSize(i.limit), cursor: decodeCrmCursor("account", i.cursor), statuses, prefix };
    },
    async (db, tenantId, { limit, cursor, statuses, prefix }) => {
      const { rows } = await db.query<AccountRow & { folded_name: string }>(
        `SELECT ${COLUMNS}, lower(btrim(name)) AS folded_name
           FROM eos_crm.accounts
          WHERE tenant_id = $1
            AND ($2::text[] IS NULL OR status::text = ANY($2::text[]))
            AND ($3::text IS NULL OR left(lower(btrim(name)), char_length($3::text)) = $3::text)
            AND ($4::text IS NULL OR (lower(btrim(name)), id) > ($4::text, $5::text))
          ORDER BY lower(btrim(name)), id
          LIMIT $6`,
        [tenantId, statuses, prefix, cursor?.name ?? null, cursor?.id ?? null, limit + 1],
      );
      return pageOf("account", rows, limit, project);
    },
  );
}
