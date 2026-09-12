// The eos_crm customer repository — governed reads and commands over Account, Contact and the CRM
// customer site.
//
// ════════════════════ WHAT THIS PROVES, AND WHAT IT DOES NOT ════════════════════
//
// This is the repository contract for migration 008's three tables: the identity rules, the
// ownership rules, and the transaction boundary that makes a child's inherited owner and its INSERT
// one act. It is NOT wired to any HTTP operation and NOT called by any deployed client. The
// Firestore collections remain authoritative until a separately authorized cutover; nothing here
// reads or writes them, and nothing here imports Firebase.
//
// ════════════════════ THERE IS NO GENERIC WRITE ════════════════════
//
// No `update(table, id, patch)`, no `upsert`, no method that takes a column name. Every function
// below names the fact it changes, for the same reason functions/src/eosOps/eosOpsHttp.ts's closed
// operation list has no `POST /sql`: a generic patch is an authorization hole that no capability
// check can describe, because the thing being authorized is not known until runtime.
//
// There is also no delete. `eos_policy.objects` records `supportsDelete: false` for all three
// Objects, and docs/architecture/customer-domain-foundation.md section 9 rules that ARCHIVED is
// soft-delete only and that Contacts and Locations are never hard-deleted. A delete method would be
// a capability the product has refused.
//
// ════════════════════ THE CRM/INVENTORY LOCATION BOUNDARY, IN THE READ PATH ════════════════════
//
// `readAccountLocation` answers ONE question: is this id a customer site of this tenant. A `null`
// means "no customer site has this id" and NEVER means "so it must be a warehouse" — the two
// namespaces are disjoint, not complementary, and a caller that falls through from one to the other
// has built the union this schema exists to prevent. There is deliberately no
// `resolveLocation(id)` here that would try both: classifying a bare id is precisely the operation
// that has no correct answer, and offering it would make every caller's guess look governed.
import type { Pool, PoolClient } from "pg";
import {
  type AccountLocationRecord,
  type AccountRecord,
  type ContactRecord,
  type CrmAccountStatus,
  type CrmOwnerEmployeeId,
  CrmIdentityError,
  assertNoInventoryLocationDiscriminator,
  inheritOwnerFromAccount,
  isCrmAccountStatus,
  requireCrmId,
  requireCustomerName,
  requireExplicitAccountOwner,
} from "./customerIdentity.js";

const SCHEMA = "eos_crm";

export class CrmRepositoryError extends Error {
  constructor(readonly code: "ACCOUNT_NOT_FOUND" | "DUPLICATE_ID" | "STATUS_INVALID", message: string) {
    super(message);
    this.name = "CrmRepositoryError";
  }
}

const optionalText = (value: unknown, what: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new CrmIdentityError(`${what} must be a string when present`);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const requireStatus = (value: unknown): CrmAccountStatus => {
  if (!isCrmAccountStatus(value)) {
    throw new CrmRepositoryError(
      "STATUS_INVALID",
      "an Account status is one of PROSPECT, ACTIVE, INACTIVE, ARCHIVED — the lifecycle of D-C1-5, not a free string",
    );
  }
  return value;
};

/** 23505 is a unique violation. Reported as the domain fact rather than as a constraint name. */
const isDuplicate = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A failed rollback must not mask the error that caused it.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════ row mapping ════════════════════

type Row = Record<string, unknown>;

const toAccount = (row: Row): AccountRecord => ({
  id: row.id as string,
  tenantId: row.tenant_id as string,
  name: row.name as string,
  status: row.status as CrmAccountStatus,
  ownerEmployeeId: (row.owner_employee_id as string | null) ?? null,
});

const toContact = (row: Row): ContactRecord => ({
  id: row.id as string,
  tenantId: row.tenant_id as string,
  accountId: row.account_id as string,
  name: row.name as string,
  email: (row.email as string | null) ?? null,
  phone: (row.phone as string | null) ?? null,
  contactRole: (row.contact_role as string | null) ?? null,
  isPrimary: row.is_primary === true,
  ownerEmployeeId: (row.owner_employee_id as string | null) ?? null,
});

const toAccountLocation = (row: Row): AccountLocationRecord => ({
  id: row.id as string,
  tenantId: row.tenant_id as string,
  accountId: row.account_id as string,
  name: row.name as string,
  addressStreet: (row.address_street as string | null) ?? null,
  addressCity: (row.address_city as string | null) ?? null,
  addressState: (row.address_state as string | null) ?? null,
  addressPostalCode: (row.address_postal_code as string | null) ?? null,
  accessNotes: (row.access_notes as string | null) ?? null,
  ownerEmployeeId: (row.owner_employee_id as string | null) ?? null,
});

// ════════════════════ commands ════════════════════

export interface CreateAccountInput {
  readonly id: string;
  readonly name: string;
  readonly status: unknown;
  /**
   * EXPLICIT OR ABSENT. There is no third option and no default: ruling D-6 forbids inferring an
   * Account owner, and `actorId` below is the writer of the record, never its owner.
   */
  readonly ownerEmployeeId?: string | null;
}

export async function createAccount(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CreateAccountInput,
): Promise<AccountRecord> {
  const id = requireCrmId(input.id, "an Account id");
  const name = requireCustomerName(input.name, "an Account");
  const status = requireStatus(input.status);
  const owner = requireExplicitAccountOwner(input.ownerEmployeeId ?? null);

  try {
    const result = await pool.query(
      `INSERT INTO ${SCHEMA}.accounts
         (id, tenant_id, name, status, owner_employee_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING *`,
      [id, tenantId, name, status, owner, actorId],
    );
    return toAccount(result.rows[0] as Row);
  } catch (err) {
    if (isDuplicate(err)) {
      throw new CrmRepositoryError("DUPLICATE_ID", `an Account already exists with id ${id}`);
    }
    throw err;
  }
}

/**
 * Assign or clear an Account's owner — the ONLY way one is ever set after creation.
 *
 * Ruling D-6 again: this takes the owner as an argument and cannot reach the actor, a territory, or
 * any activity history. Passing `null` is a legitimate act (returning an Account to OWNERLESS), not
 * a failure to supply one.
 */
export async function assignAccountOwner(
  pool: Pool,
  tenantId: string,
  actorId: string,
  accountId: string,
  ownerEmployeeId: string | null,
): Promise<AccountRecord> {
  const owner = requireExplicitAccountOwner(ownerEmployeeId);
  const result = await pool.query(
    `UPDATE ${SCHEMA}.accounts
        SET owner_employee_id = $3, updated_by = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING *`,
    [tenantId, accountId, owner, actorId],
  );
  if (result.rowCount === 0) {
    // A cross-tenant row reads as absent, the same posture postgresPolicyRepository.ts takes.
    throw new CrmRepositoryError("ACCOUNT_NOT_FOUND", `no Account ${accountId} in this tenant`);
  }
  return toAccount(result.rows[0] as Row);
}

export interface CreateContactInput {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly contactRole?: string | null;
  readonly isPrimary?: boolean;
}

/**
 * Create a Contact, inheriting its owner from the parent Account IN THE SAME TRANSACTION.
 *
 * The read of the parent's owner and the INSERT that records it are one act. Split across two round
 * trips, a handoff of the Account between them would produce a Contact whose "inherited" owner was
 * never its parent's — an inheritance that is false at the moment it is written.
 */
export async function createContact(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CreateContactInput,
): Promise<ContactRecord> {
  const id = requireCrmId(input.id, "a Contact id");
  const accountId = requireCrmId(input.accountId, "a Contact's accountId");
  const name = requireCustomerName(input.name, "a Contact");
  const email = optionalText(input.email, "a Contact email");
  const phone = optionalText(input.phone, "a Contact phone");
  const contactRole = optionalText(input.contactRole, "a Contact role");

  return inTransaction(pool, async (client) => {
    const owner = await selectAccountOwner(client, tenantId, accountId);
    try {
      const result = await client.query(
        `INSERT INTO ${SCHEMA}.contacts
           (id, tenant_id, account_id, name, email, phone, contact_role, is_primary,
            owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING *`,
        [id, tenantId, accountId, name, email, phone, contactRole,
          input.isPrimary === true, inheritOwnerFromAccount(owner), actorId],
      );
      return toContact(result.rows[0] as Row);
    } catch (err) {
      if (isDuplicate(err)) {
        throw new CrmRepositoryError("DUPLICATE_ID", `a Contact already exists with id ${id}`);
      }
      throw err;
    }
  });
}

export interface CreateAccountLocationInput {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly addressStreet?: string | null;
  readonly addressCity?: string | null;
  readonly addressState?: string | null;
  readonly addressPostalCode?: string | null;
  readonly accessNotes?: string | null;
}

/**
 * Create a CRM customer site.
 *
 * THE NAMESPACE GUARD RUNS FIRST, on the raw input, before anything is validated or written. A
 * caller that supplied `type: "WAREHOUSE"` meant an inventory location; writing the row without it
 * would silently record a warehouse as a customer's site and lose the only evidence of the mistake.
 * The `accountId` is mandatory here and NOT NULL in the schema for the same reason — an inventory
 * location has no Account, so it cannot be expressed through this function at all.
 */
export async function createAccountLocation(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: CreateAccountLocationInput,
): Promise<AccountLocationRecord> {
  assertNoInventoryLocationDiscriminator(input as unknown as Record<string, unknown>);

  const id = requireCrmId(input.id, "a customer site id");
  const accountId = requireCrmId(input.accountId, "a customer site's accountId");
  const name = requireCustomerName(input.name, "a customer site");
  const street = optionalText(input.addressStreet, "a street");
  const city = optionalText(input.addressCity, "a city");
  const state = optionalText(input.addressState, "a state");
  const postalCode = optionalText(input.addressPostalCode, "a postal code");
  const accessNotes = optionalText(input.accessNotes, "access notes");

  return inTransaction(pool, async (client) => {
    const owner = await selectAccountOwner(client, tenantId, accountId);
    try {
      const result = await client.query(
        `INSERT INTO ${SCHEMA}.account_locations
           (id, tenant_id, account_id, name, address_street, address_city, address_state,
            address_postal_code, access_notes, owner_employee_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         RETURNING *`,
        [id, tenantId, accountId, name, street, city, state, postalCode, accessNotes,
          inheritOwnerFromAccount(owner), actorId],
      );
      return toAccountLocation(result.rows[0] as Row);
    } catch (err) {
      if (isDuplicate(err)) {
        throw new CrmRepositoryError("DUPLICATE_ID", `a customer site already exists with id ${id}`);
      }
      throw err;
    }
  });
}

async function selectAccountOwner(
  client: PoolClient,
  tenantId: string,
  accountId: string,
): Promise<CrmOwnerEmployeeId> {
  const parent = await client.query(
    `SELECT owner_employee_id FROM ${SCHEMA}.accounts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, accountId],
  );
  if (parent.rowCount === 0) {
    throw new CrmRepositoryError("ACCOUNT_NOT_FOUND", `no Account ${accountId} in this tenant`);
  }
  return (parent.rows[0].owner_employee_id as string | null) ?? null;
}

// ════════════════════ reads ════════════════════

export async function readAccount(
  pool: Pool,
  tenantId: string,
  accountId: string,
): Promise<AccountRecord | null> {
  const result = await pool.query(
    `SELECT * FROM ${SCHEMA}.accounts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, accountId],
  );
  return result.rowCount === 0 ? null : toAccount(result.rows[0] as Row);
}

/**
 * Is this id a customer site of this tenant?
 *
 * `null` MEANS "NOT A CUSTOMER SITE". It does not mean "try the inventory namespace next". See the
 * file header.
 */
export async function readAccountLocation(
  pool: Pool,
  tenantId: string,
  locationId: string,
): Promise<AccountLocationRecord | null> {
  const result = await pool.query(
    `SELECT * FROM ${SCHEMA}.account_locations WHERE tenant_id = $1 AND id = $2`,
    [tenantId, locationId],
  );
  return result.rowCount === 0 ? null : toAccountLocation(result.rows[0] as Row);
}

export async function listAccountLocations(
  pool: Pool,
  tenantId: string,
  accountId: string,
): Promise<readonly AccountLocationRecord[]> {
  const result = await pool.query(
    `SELECT * FROM ${SCHEMA}.account_locations
      WHERE tenant_id = $1 AND account_id = $2 ORDER BY lower(btrim(name)), id`,
    [tenantId, accountId],
  );
  return result.rows.map((r) => toAccountLocation(r as Row));
}

export async function listAccountContacts(
  pool: Pool,
  tenantId: string,
  accountId: string,
): Promise<readonly ContactRecord[]> {
  const result = await pool.query(
    `SELECT * FROM ${SCHEMA}.contacts
      WHERE tenant_id = $1 AND account_id = $2 ORDER BY lower(btrim(name)), id`,
    [tenantId, accountId],
  );
  return result.rows.map((r) => toContact(r as Row));
}

/**
 * The ADVISORY duplicate lookup of D-C1-4 — a normalized-name match, never a constraint.
 *
 * It returns the candidates and says nothing about what to do with them, because the ruling is that
 * duplicate prevention is advisory at create: two genuinely distinct customers may share a name,
 * and the schema deliberately carries no unique index that would refuse the second one.
 */
export async function findAccountsByFoldedName(
  pool: Pool,
  tenantId: string,
  name: string,
): Promise<readonly AccountRecord[]> {
  const result = await pool.query(
    `SELECT * FROM ${SCHEMA}.accounts
      WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) ORDER BY id`,
    [tenantId, name],
  );
  return result.rows.map((r) => toAccount(r as Row));
}
