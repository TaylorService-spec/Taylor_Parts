// Customer (Account) -- the TRUSTED create used by Data Import.
//
// ============================ WHY THIS EXISTS AT ALL ============================
//
// Every other entity import writes through a command that was already there. Customers had
// none: accounts are still written client-direct under firestore.rules, which is a
// deliberate, documented interim (see the accounts match block, and domain/accounts.js).
// Import cannot use that path -- a trusted Function writes with the Admin SDK, which
// bypasses Rules entirely, so "the client writer plus Rules" would enforce nothing here.
//
// So import gets a trusted path, and this is it. What it is NOT is a replacement for the
// client writer: that path stays exactly as it is, and this file removes nothing. Two
// writers are acceptable while one of them enforces the same rules the other one does --
// which is the whole obligation this file carries.
//
// ============================ THE RULES THIS RE-STATES, AND WHY ============================
//
// Because the Admin SDK does not evaluate Rules, every guarantee the accounts Rules block
// makes has to be made again HERE, or import would be a hole in it:
//
//   * AUTHORIZATION. `customer.record.create` -- the SAME catalogued capability that names
//     the authority to create a Customer. No new capability is invented, so import
//     authorizes nobody who could not already create a customer by hand.
//   * THE GOVERNED CREATE BASELINE. paymentTerms unset and taxStatus absent, exactly what
//     accountGovernedCreateBaseline() permits a non-admin to create. The import contract
//     does not carry those fields at all, and this command refuses them if they somehow
//     arrive -- two independent refusals, because this one is the load-bearing one.
//   * nameLower. domain/accounts.js derives it in the WRITER, on purpose: a path that sets
//     `name` without it makes a customer permanently unfindable by search, and the symptom
//     ("search sometimes doesn't find things") never points at the cause. A second writer
//     that forgot it would reintroduce exactly that. It is derived here, identically.
//   * TIMESTAMPS. Accounts are the one collection on the shared client writer governed as
//     Firestore Timestamp rather than epoch millis, because a number sorts BELOW every
//     Timestamp under `updatedAt DESC` -- an imported customer written as a number would
//     land at the bottom of the list it was imported into and be unreachable from it.

import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";

import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import type { Role } from "../types/access.js";
import { ACCOUNTS_COLLECTION } from "./accountPortfolioSummary.js";

/** The capability that names the authority to create a Customer. Not a new one. */
export const CAP_CUSTOMER_CREATE = "customer.record.create";

/** Fields whose presence would make this a governed write. Refused, never stripped. */
export const GOVERNED_ACCOUNT_FIELDS = Object.freeze(["paymentTerms", "taxStatus"]);

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const AUDIT_COLLECTION = "auditEvents";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

export type AccountImportFailureCode =
  | "UNAUTHORIZED"
  | "INVALID"
  | "ALREADY_EXISTS"
  | "GOVERNED_FIELD_REFUSED";

export class AccountImportError extends Error {
  constructor(
    readonly code: AccountImportFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountImportError";
  }
}

/**
 * The search key `nameLower` holds.
 *
 * Duplicated from field-ops-app-vite/src/domain/nameNormalization.js rather than imported,
 * for the same reason every other client/server pair in this repo is duplicated: there is
 * no shared-module tooling, and widening the Functions rootDir to reach the client changes
 * what `firebase deploy` packages. The two are asserted equal by a test, which is the
 * substitute for sharing.
 */
export function normalizeAccountSearchName(name: string): string {
  // trim().toLowerCase() and NOTHING ELSE, byte for byte with the client. Collapsing double
  // spaces here would be an improvement in isolation and a defect in place: the same customer
  // would get one search key from import and another from the next edit through the UI, and
  // whichever wrote last would decide whether they were findable.
  return String(name ?? "").trim().toLowerCase();
}

export interface AccountImportInput {
  readonly actorUid: string;
  /** Deterministic per (job, row); the caller owns its shape. */
  readonly idempotencyKey: string;
  /** The document id to create at. Derived, so a re-import collides with itself. */
  readonly accountId: string;
  readonly draft: Readonly<Record<string, unknown>>;
}

export interface AccountImportOutcome {
  readonly outcome: "applied" | "replayed";
  readonly accountId: string;
}

export interface AccountImportDeps {
  db?: Firestore;
  now?: () => Date;
}

/**
 * Create ONE Customer, transactionally, with an audit event.
 *
 * ONE TRANSACTION per customer, not one for the file: a customer is an independent record
 * with no cross-document invariant to protect (domain/accounts.js says exactly this about
 * why the client writer needs no transaction either). Batching the file would mean one bad
 * row discarding every good one, which is not what the approving admin asked for.
 */
export async function createAccountFromImport(
  input: AccountImportInput,
  deps: AccountImportDeps = {},
): Promise<AccountImportOutcome> {
  const db = deps.db ?? getFirestore();
  const now = deps.now ?? (() => new Date());

  for (const forbidden of GOVERNED_ACCOUNT_FIELDS) {
    if (input.draft[forbidden] !== undefined) {
      // REFUSED, not stripped. Silently dropping a value the file asserted would let an
      // operator believe payment terms were imported when they were not -- and they would
      // find out at the first invoice.
      throw new AccountImportError(
        "GOVERNED_FIELD_REFUSED",
        `${forbidden} is a governed commercial field and cannot be set by import.`,
      );
    }
  }

  const name = String(input.draft.name ?? "").trim();
  if (!name) throw new AccountImportError("INVALID", "A customer must have a name.");
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.accountId)) {
    throw new AccountImportError("INVALID", "The derived customer id is not a legal document id.");
  }

  await assertCapability(db, input.actorUid);

  const auditId = `dataImport_createAccount_${input.idempotencyKey}`;

  return db.runTransaction(async (txn) => {
    const auditRef = db.collection(AUDIT_COLLECTION).doc(auditId);
    const auditSnap = await txn.get(auditRef);
    if (auditSnap.exists) {
      // The idempotency record is authoritative, and it is read INSIDE the transaction so a
      // retry racing the original cannot both pass.
      return { outcome: "replayed" as const, accountId: input.accountId };
    }

    const ref = db.collection(ACCOUNTS_COLLECTION).doc(input.accountId);
    if ((await txn.get(ref)).exists) {
      throw new AccountImportError("ALREADY_EXISTS", `A customer already exists at ${input.accountId}.`);
    }

    const at = now();
    const stamp = Timestamp.fromDate(at);

    txn.set(ref, {
      ...stripUndefined(input.draft),
      name,
      // The derived search key. Its absence is invisible until someone cannot find a
      // customer they know exists, which is why it is set by the writer and not the caller.
      nameLower: normalizeAccountSearchName(name),
      createdAt: stamp,
      updatedAt: stamp,
    });

    txn.set(auditRef, {
      action: "createAccountFromImport",
      actorUid: input.actorUid,
      targetType: "account",
      targetId: input.accountId,
      at: stamp,
      summary: `Customer "${name}" created by Data Import (${input.idempotencyKey}).`,
    });

    return { outcome: "applied" as const, accountId: input.accountId };
  });
}

async function assertCapability(db: Firestore, actorUid: string): Promise<void> {
  if (typeof actorUid !== "string" || actorUid.trim() === "") {
    throw new AccountImportError("UNAUTHORIZED", "An actor is required.");
  }
  const userSnap = await db.collection(USERS_COLLECTION).doc(actorUid).get();
  const assignments = await db
    .collection(ROLE_ASSIGNMENTS_COLLECTION)
    .where("principalUid", "==", actorUid)
    .where("status", "==", "active")
    .get();

  const result = resolveEffectivePermission({
    permissionId: CAP_CUSTOMER_CREATE,
    assignments: assignments.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
    roles: ROLE_CATALOG,
    currentAccessVersion: Number((userSnap.data() ?? {}).accessVersion ?? 0),
    target: GLOBAL_TARGET,
    activationOverrides: resolveRuntimeCapabilityOverrides(),
  });

  if (result.decision !== "ALLOW") {
    throw new AccountImportError("UNAUTHORIZED", "You are not authorized to create customers.");
  }
}

/** Firestore rejects undefined; a canonical draft leaves its optional fields undefined. */
function stripUndefined(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
  return out;
}
