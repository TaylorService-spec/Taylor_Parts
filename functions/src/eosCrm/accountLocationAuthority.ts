// Governed PostgreSQL CRM customer-site (Location) authority -- wave D1-A. Internal; nothing external invokes it yet.
//
//   createAccountLocation   a customer site of an Account of the actor's tenant; owner inherited AT CREATION
//   updateAccountLocation   name, the four address parts, accessNotes ONLY -- never the Account, owner or attribution
//   getAccountLocation      one customer site of the actor's tenant
//   listAccountLocations    bounded keyset list of one Account's customer sites
//
// THE TWO `location` NAMESPACES (migration 1758758400000's header). This is `eos_crm.account_locations` -- a customer's
// site -- and never an inventory location. A payload carrying `type` / `locationType` is REFUSED before anything else is
// validated, and a `null` read means "not a customer site of this tenant", never "try the inventory namespace".
//
// AUTHORITY. Owner ruling (V1): customer sites use `customer.record.read|create|update` for their verbs, the same
// capabilities as their Account (firestore.rules' locations block is admin/dispatcher for read, create and update alike;
// legacyAuthorizationSurface row 23). Create is idempotent (runCrmCreate).
//
// TENANCY: the parent Account is read in the actor's tenant only, and `account_locations_account_same_tenant` makes a
// cross-tenant link unrepresentable.
import { randomUUID } from "node:crypto";
import { assertNoInventoryLocationDiscriminator, inheritOwnerFromAccount } from "../crm/customerIdentity.js";
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
  type CrmActorContext,
  type CrmDeps,
  type CrmReplayable,
} from "./crmAuthorityKernel.js";

export interface AccountLocationProjection {
  readonly accountLocationId: string;
  readonly accountId: string;
  readonly name: string;
  readonly addressStreet: string | null;
  readonly addressCity: string | null;
  readonly addressState: string | null;
  readonly addressPostalCode: string | null;
  readonly accessNotes: string | null;
  readonly ownerEmployeeId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

interface AccountLocationRow {
  id: string;
  account_id: string;
  name: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  access_notes: string | null;
  owner_employee_id: string | null;
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
}

const COLUMNS =
  "id, account_id, name, address_street, address_city, address_state, address_postal_code, access_notes, owner_employee_id, created_by, created_at, updated_by, updated_at";

const project = (row: AccountLocationRow): AccountLocationProjection => ({
  accountLocationId: row.id,
  accountId: row.account_id,
  name: row.name,
  addressStreet: row.address_street,
  addressCity: row.address_city,
  addressState: row.address_state,
  addressPostalCode: row.address_postal_code,
  accessNotes: row.access_notes,
  ownerEmployeeId: row.owner_employee_id,
  createdBy: row.created_by,
  createdAt: isoOf(row.created_at),
  updatedBy: row.updated_by,
  updatedAt: isoOf(row.updated_at),
});

const LOCATION_UPDATE_COLUMNS = Object.freeze({
  name: "name",
  addressStreet: "address_street",
  addressCity: "address_city",
  addressState: "address_state",
  addressPostalCode: "address_postal_code",
  accessNotes: "access_notes",
});

/** The namespace guard runs on the RAW payload, before the allowlist could report `type` as merely unknown. */
function siteInput(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    assertNoInventoryLocationDiscriminator(input as Record<string, unknown>);
  }
  return requireAllowlistedInput(input, [...keys, ...Object.keys(LOCATION_UPDATE_COLUMNS)]);
}

function siteFields(i: Record<string, unknown>): Map<string, unknown> {
  const changes = new Map<string, unknown>();
  if (i.name !== undefined) changes.set("name", requireName(i.name, "a customer site"));
  for (const field of ["addressStreet", "addressCity", "addressState", "addressPostalCode", "accessNotes"] as const) {
    if (i[field] !== undefined) changes.set(field, optionalText(i[field], field));
  }
  return changes;
}

// ════════════════════ commands ════════════════════

export function createAccountLocation(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<CrmReplayable<AccountLocationProjection>> {
  return runCrmCreate(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_CREATE,
    "crm.createAccountLocation",
    () => {
      const i = siteInput(input, ["idempotencyKey", "accountId"]);
      const { idempotencyKey, request } = splitIdempotentInput(i);
      const fields = siteFields(i);
      if (!fields.has("name")) fail("NAME_REQUIRED", "INVALID_INPUT", "a customer site requires a name");
      return { idempotencyKey, request, accountId: requireRecordId(i.accountId, "accountId"), fields };
    },
    async (db, { tenantId, principalId }, { accountId, fields }) => {
      const parent = await requireTenantAccount(db, tenantId, accountId, "SHARE");
      const { rows } = await db.query<AccountLocationRow>(
        `INSERT INTO eos_crm.account_locations
           (id, tenant_id, account_id, name, address_street, address_city, address_state, address_postal_code, access_notes,
            owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         RETURNING ${COLUMNS}`,
        [`site_${randomUUID()}`, tenantId, parent.id, fields.get("name"), fields.get("addressStreet") ?? null, fields.get("addressCity") ?? null,
          fields.get("addressState") ?? null, fields.get("addressPostalCode") ?? null, fields.get("accessNotes") ?? null,
          inheritOwnerFromAccount(parent.ownerEmployeeId), principalId],
      );
      return { result: project(rows[0]), targetType: "ACCOUNT_LOCATION", targetId: rows[0].id };
    },
  );
}

export function updateAccountLocation(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountLocationProjection> {
  return runCrmCommand(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_UPDATE,
    () => {
      const i = siteInput(input, ["accountLocationId"]);
      const changes = siteFields(i);
      if (changes.size === 0) fail("NO_CHANGES_REQUESTED", "INVALID_INPUT", "an update must name at least one accepted field");
      return { accountLocationId: requireRecordId(i.accountLocationId, "accountLocationId"), changes };
    },
    async (db, { tenantId, principalId }, { accountLocationId, changes }) => {
      const set = assignmentsOf(changes, LOCATION_UPDATE_COLUMNS, 4);
      const { rows } = await db.query<AccountLocationRow>(
        `UPDATE eos_crm.account_locations SET ${set.sql}, updated_by = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING ${COLUMNS}`,
        [tenantId, accountLocationId, principalId, ...set.values],
      );
      if (rows.length === 0) fail("ACCOUNT_LOCATION_NOT_FOUND", "NOT_FOUND", "the customer site does not exist in this tenant");
      return project(rows[0]);
    },
  );
}

// ════════════════════ reads ════════════════════

export function getAccountLocation(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountLocationProjection> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => ({ accountLocationId: requireRecordId(requireAllowlistedInput(input, ["accountLocationId"]).accountLocationId, "accountLocationId") }),
    async (db, tenantId, { accountLocationId }) => {
      const { rows } = await db.query<AccountLocationRow>(
        `SELECT ${COLUMNS} FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = $2`,
        [tenantId, accountLocationId],
      );
      if (rows.length === 0) fail("ACCOUNT_LOCATION_NOT_FOUND", "NOT_FOUND", "the customer site does not exist in this tenant");
      return project(rows[0]);
    },
  );
}

export interface AccountLocationPage {
  readonly items: AccountLocationProjection[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
}

export function listAccountLocations(deps: CrmDeps, actor: CrmActorContext, input: unknown): Promise<AccountLocationPage> {
  return runCrmRead(
    deps,
    actor,
    CRM_CAPABILITIES.CUSTOMER_RECORD_READ,
    () => {
      const i = requireAllowlistedInput(input, ["accountId", "limit", "cursor"]);
      return { accountId: requireRecordId(i.accountId, "accountId"), limit: requirePageSize(i.limit), cursor: decodeCrmCursor("accountLocation", i.cursor) };
    },
    async (db, tenantId, { accountId, limit, cursor }) => {
      await requireTenantAccount(db, tenantId, accountId);
      const { rows } = await db.query<AccountLocationRow & { folded_name: string }>(
        `SELECT ${COLUMNS}, lower(btrim(name)) AS folded_name
           FROM eos_crm.account_locations
          WHERE tenant_id = $1 AND account_id = $2
            AND ($3::text IS NULL OR (lower(btrim(name)), id) > ($3::text, $4::text))
          ORDER BY lower(btrim(name)), id
          LIMIT $5`,
        [tenantId, accountId, cursor?.name ?? null, cursor?.id ?? null, limit + 1],
      );
      return pageOf("accountLocation", rows, limit, project);
    },
  );
}
