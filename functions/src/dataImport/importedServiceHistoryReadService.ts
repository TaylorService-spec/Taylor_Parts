// Imported Service History -- the READ side.
//
// Data Import writes `imported_service_history`; this is how anybody sees it again. It is a
// read and nothing else: no write path exists in this module, and none may be added to it.
//
// ============================ WHY A CALLABLE AND NOT A CLIENT QUERY ============================
//
// `imported_service_history` is deny-all in firestore.rules, like every other Admin-SDK-only
// collection here, and it must stay that way: a record carries the source values of a job
// somebody else's system recorded, including free text a customer wrote. Opening the
// collection to client reads would make that readable by anything holding a session, gated
// only by a Rules expression. A trusted read keeps the projection -- what leaves the server --
// under this module's control rather than the caller's.
//
// ============================ NO NEW CAPABILITY ============================
//
// The gate is `customer.record.read`: the existing, catalogued, ACTIVE authority to read a
// Customer record. Reading a customer's service history is reading about that customer, and
// anyone who may see the customer's Work Order activity today may see the history that
// preceded it. Inventing `serviceHistory.read` to serve one callable would add a catalog entry
// whose only holder and only caller is this file.
//
// It is deliberately NOT gated on `admin.dataImport.*`. Those authorize loading data. Reading
// a customer's history afterwards is ordinary product work, and gating it on the import
// capability would make the records visible only to the person who imported them.
//
// ============================ WHAT THIS READ WILL NOT DO ============================
//
// It resolves NOTHING. The technician name and the equipment serial leave exactly as they were
// stored -- text a former system recorded. Joining either to a current Employee or a current
// Equipment record would manufacture a link the canonical model does not prove, inside a
// record that reads as authoritative. The client is given the same text and told what it is.

import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { resolveEffectivePermission, type TargetContext } from "../access/resolveEffectivePermission.js";
import { resolveRuntimeCapabilityOverrides } from "../access/environmentCapabilityOverrides.js";
import { COMPATIBILITY_ROLES } from "../access/compatibilityRoles.js";
import { GOVERNED_BUSINESS_ROLES } from "../access/governedBusinessRoles.js";
import type { Role } from "../types/access.js";
import { IMPORTED_SERVICE_HISTORY_COLLECTION } from "./firestoreServiceHistoryAdapters.js";

/** The existing authority to read a Customer record. Not a new one. */
export const CAP_IMPORTED_SERVICE_HISTORY_READ = "customer.record.read";

/**
 * The kind every row carries, so a consumer can never mistake one for a Work Order.
 *
 * Sent to the client as data rather than inferred there: a client that had to KNOW these are
 * historical would eventually have a code path that forgot.
 */
export const IMPORTED_SERVICE_RECORD_KIND = "IMPORTED_SERVICE_HISTORY";

/** Hard ceiling. A customer's whole history is not a page, and this is a section on one. */
export const IMPORTED_SERVICE_HISTORY_MAX = 100;

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };
const ROLE_CATALOG: Readonly<Record<string, Role>> = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };

export class ImportedServiceHistoryReadError extends Error {
  constructor(
    readonly code: "UNAUTHORIZED" | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ImportedServiceHistoryReadError";
  }
}

export interface ImportedServiceHistoryRow {
  readonly id: string;
  /** Always IMPORTED_SERVICE_RECORD_KIND. Present so a consumer never has to assume. */
  readonly recordKind: string;
  readonly serviceDate: string;
  readonly summary: string;
  readonly externalReference: string | null;
  /** Historical TEXT. Never an employee id, and never resolved to one. */
  readonly technicianName: string | null;
  /** Historical TEXT. Never an equipment id, and never resolved to one. */
  readonly equipmentSerialNumber: string | null;
  readonly locationName: string | null;
  readonly sourceSystem: string | null;
  readonly importJobId: string | null;
}

/**
 * PURE. One stored document -> what leaves the server.
 *
 * An ALLOW-LIST, not a passthrough of the stored document. Import stores what a file said,
 * and a file can contain a column nobody reviewed -- so the read states which fields exist
 * rather than forwarding whatever arrived. A column added to a future contract is invisible
 * here until somebody adds it here too, which is the correct direction for a projection.
 */
export function projectImportedServiceHistoryRow(id: string, data: Readonly<Record<string, unknown>>): ImportedServiceHistoryRow {
  const text = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : null;
  };
  return Object.freeze({
    id,
    recordKind: IMPORTED_SERVICE_RECORD_KIND,
    serviceDate: text(data.serviceDate) ?? "",
    summary: text(data.summary) ?? "",
    externalReference: text(data.externalReference),
    technicianName: text(data.technicianName),
    equipmentSerialNumber: text(data.equipmentSerialNumber),
    locationName: text(data.locationName),
    sourceSystem: text(data.sourceSystem),
    importJobId: text(data.importJobId),
  });
}

/** PURE. Newest service first; a row with no date sorts last rather than first. */
export function orderImportedServiceHistory(
  rows: readonly ImportedServiceHistoryRow[],
): readonly ImportedServiceHistoryRow[] {
  return Object.freeze(
    [...rows].sort((a, b) => {
      if (!a.serviceDate) return 1;
      if (!b.serviceDate) return -1;
      // ISO-8601 dates: lexical order IS chronological order, so no parsing and no timezone.
      return b.serviceDate.localeCompare(a.serviceDate);
    }),
  );
}

export interface ImportedServiceHistoryResult {
  readonly accountId: string;
  readonly rows: readonly ImportedServiceHistoryRow[];
  /** True when the ceiling cut the list, so a consumer can say so rather than imply completeness. */
  readonly truncated: boolean;
}

/**
 * Read one account's imported history.
 *
 * ORDERED IN MEMORY, NOT BY THE DATABASE, and deliberately. Ordering in the query would need a
 * composite index on (accountId, serviceDate) -- and deploying indexes in this repo REPLACES
 * the live index set, which is a heavier operation than this section is worth. The equality
 * filter alone uses the automatic single-field index, and the result is bounded before it is
 * sorted, so the cost is fixed regardless of how much history an account has.
 */
export async function readImportedServiceHistoryForAccount(
  db: Firestore,
  accountId: string,
  limit: number = IMPORTED_SERVICE_HISTORY_MAX,
): Promise<ImportedServiceHistoryResult> {
  if (typeof accountId !== "string" || accountId.trim() === "") {
    throw new ImportedServiceHistoryReadError("INVALID", "An account is required.");
  }
  const bounded = Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : IMPORTED_SERVICE_HISTORY_MAX, IMPORTED_SERVICE_HISTORY_MAX));

  // One more than asked for, so "there is more than this" is a fact rather than a guess.
  const snap = await db
    .collection(IMPORTED_SERVICE_HISTORY_COLLECTION)
    .where("accountId", "==", accountId.trim())
    .limit(bounded + 1)
    .get();

  const all = snap.docs.map((d) => projectImportedServiceHistoryRow(d.id, d.data() ?? {}));
  const ordered = orderImportedServiceHistory(all);

  return Object.freeze({
    accountId: accountId.trim(),
    rows: Object.freeze(ordered.slice(0, bounded)),
    truncated: ordered.length > bounded,
  });
}

/** The capability gate. Fail-closed on every edge: no actor, unknown actor, no grant. */
export async function assertMayReadImportedServiceHistory(db: Firestore, actorUid: string): Promise<void> {
  if (typeof actorUid !== "string" || actorUid.trim() === "") {
    throw new ImportedServiceHistoryReadError("UNAUTHORIZED", "An actor is required.");
  }
  const userSnap = await db.collection(USERS_COLLECTION).doc(actorUid).get();
  const assignments = await db
    .collection(ROLE_ASSIGNMENTS_COLLECTION)
    .where("principalUid", "==", actorUid)
    .where("status", "==", "active")
    .get();

  const result = resolveEffectivePermission({
    permissionId: CAP_IMPORTED_SERVICE_HISTORY_READ,
    assignments: assignments.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
    roles: ROLE_CATALOG,
    currentAccessVersion: Number((userSnap.data() ?? {}).accessVersion ?? 0),
    target: GLOBAL_TARGET,
    activationOverrides: resolveRuntimeCapabilityOverrides(),
  });

  if (result.decision !== "ALLOW") {
    throw new ImportedServiceHistoryReadError("UNAUTHORIZED", "You are not authorized to read this customer.");
  }
}

/** The composed read: authorize, then project. Used by the callable and by the emulator test. */
export async function listImportedServiceHistory(
  actorUid: string,
  accountId: string,
  limit?: number,
  db: Firestore = getFirestore(),
): Promise<ImportedServiceHistoryResult> {
  await assertMayReadImportedServiceHistory(db, actorUid);
  return readImportedServiceHistoryForAccount(db, accountId, limit ?? IMPORTED_SERVICE_HISTORY_MAX);
}
