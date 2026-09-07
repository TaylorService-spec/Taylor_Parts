// GOVERNED COLLECTION READS -- one registry, one callable, one capability per collection.
//
// ════════════════════ WHY A REGISTRY AND NOT TEN SERVICES ════════════════════
//
// Taking rules management out of Firebase means every collection the client reads has to be read
// through something that resolves a governed capability instead. That is ~10 collections. Written
// as ten hand-rolled services they would be ten copies of the same twelve lines -- resolve the
// actor, check one capability, run one query, map the docs -- and the copies would drift: one would
// forget the limit, one would return the raw snapshot, one would swallow a query error into an
// empty list and quietly tell a screen the company has no customers.
//
// So the shape that varies is DATA, and the code that enforces is written once and audited once.
//
// ════════════════════ WHY THIS IS NOT A GENERIC DATABASE ENDPOINT ════════════════════
//
// A callable that takes a collection name is only safe if the name is not really an input. Here it
// is a key into a CLOSED registry compiled into the deploy: a collection absent from it is not
// readable through this path at any scope, by anyone, ever -- there is no default, no passthrough,
// and no "if it looks like a collection" branch. The registry is the allowlist.
//
// The same applies to filtering. A caller may not send arbitrary where() clauses -- that is a query
// language, and a query language over somebody else's data is an exfiltration surface with extra
// steps. Each entry DECLARES which fields may be filtered and with which operator; anything else is
// refused by name. The client asks the questions the registry anticipated, or it does not ask.
//
// ════════════════════ WHAT THIS DOES NOT DO ════════════════════
//
// NO WRITES. Not a write path, and never becomes one: writes are trusted commands with their own
// validation, idempotency and audit. This module has no mutation code of any kind.
//
// NO PER-RECORD SCOPING YET. Every entry here is a global-scope capability check: hold it and you
// read the collection. That is exactly the authority firestore.rules conferred for these
// collections before this migration (isAdminOrDispatcher() was not per-record either), so this
// changes WHERE the decision is made without widening WHAT it decides. Record-scoped reads --
// "only your own account's contacts" -- are a real requirement and a later, separate one; they need
// a scope model per collection, and inventing one per entry here is how a registry becomes ten
// hand-rolled services again wearing a shared hat.
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Role } from "../types/access";
import { resolveEffectivePermission, type TargetContext } from "./resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";
import { InvalidInputError, UnauthorizedActorError } from "./trustedWriterCommands";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";

/** Operators a registry entry may declare. Deliberately tiny -- these serve real screens. */
export type GovernedFilterOperator = "==" | "in" | "array-contains";

export interface GovernedCollectionEntry {
  /** The Firestore collection. Also the key clients pass. */
  readonly collection: string;
  /** The capability that must resolve ALLOW at global scope for this collection to be read. */
  readonly capability: string;
  /** Fields a caller may filter on, and how. Absent field or wrong operator => refused. */
  readonly filterable: Readonly<Record<string, GovernedFilterOperator>>;
  /** Hard ceiling on rows for this collection, regardless of what the caller asks for. */
  readonly maxLimit: number;
}

/**
 * THE ALLOWLIST. A collection not named here cannot be read through this callable.
 *
 * Capability ids are per-collection on purpose rather than one shared "read the database" grant:
 * the whole point of the migration is that each object's access is administered independently on
 * the Objects grid, and a single id would collapse that grid back into one switch.
 */
export const GOVERNED_COLLECTION_READS: readonly GovernedCollectionEntry[] = Object.freeze([
  Object.freeze({
    collection: "accounts",
    capability: "customer.record.read",
    filterable: Object.freeze({ status: "==" as const }),
    maxLimit: 2000,
  }),
  Object.freeze({
    collection: "contacts",
    capability: "crm.contact.read",
    filterable: Object.freeze({ accountId: "==" as const, customerId: "==" as const }),
    maxLimit: 2000,
  }),
  Object.freeze({
    collection: "locations",
    capability: "crm.location.read",
    filterable: Object.freeze({ accountId: "==" as const, customerId: "==" as const }),
    maxLimit: 2000,
  }),
  Object.freeze({
    collection: "equipment",
    capability: "service.equipment.read",
    filterable: Object.freeze({
      accountId: "==" as const,
      customerId: "==" as const,
      locationId: "==" as const,
    }),
    maxLimit: 2000,
  }),
]);

const BY_COLLECTION = new Map(GOVERNED_COLLECTION_READS.map((e) => [e.collection, e]));

/** Every capability this registry depends on -- exported so a test can assert catalog coverage. */
export const GOVERNED_COLLECTION_CAPABILITIES = Object.freeze(
  GOVERNED_COLLECTION_READS.map((e) => e.capability),
);

const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };

export interface GovernedFilter {
  field: string;
  op: GovernedFilterOperator;
  value: unknown;
}

export interface ReadGovernedCollectionInput {
  actorUid: string;
  collection: string;
  filters?: GovernedFilter[];
  limit?: number;
}

export interface GovernedCollectionDeps {
  db?: Firestore;
  roles?: Readonly<Record<string, Role>>;
}

function readAccessVersion(data: Record<string, unknown> | undefined): number {
  const raw = data?.accessVersion;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/** The SAME resolver the enforcement path uses. `users/{uid}.role` is never consulted. */
async function actorHolds(
  db: Firestore,
  roles: Readonly<Record<string, Role>>,
  actorUid: string,
  capability: string,
): Promise<boolean> {
  const [userSnap, assignmentsSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(actorUid).get(),
    db
      .collection(ROLE_ASSIGNMENTS_COLLECTION)
      .where("principalUid", "==", actorUid)
      .where("status", "==", "active")
      .get(),
  ]);
  return (
    resolveEffectivePermission({
      permissionId: capability,
      assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
      roles,
      currentAccessVersion: readAccessVersion(userSnap.data() as Record<string, unknown> | undefined),
      target: GLOBAL_TARGET,
    }).decision === "ALLOW"
  );
}

/**
 * Validate the caller's filters against what this entry declares.
 *
 * Refuses BY NAME rather than ignoring: a silently dropped filter would return the WHOLE collection
 * where the caller asked for one account's contacts, which is both a wrong answer and a disclosure.
 */
function assertFiltersAllowed(entry: GovernedCollectionEntry, filters: GovernedFilter[]): void {
  for (const f of filters) {
    if (!f || typeof f.field !== "string") {
      throw new InvalidInputError("each filter needs a field");
    }
    const allowedOp = entry.filterable[f.field];
    if (!allowedOp) {
      throw new InvalidInputError(
        `"${f.field}" is not filterable on ${entry.collection} (allowed: ${Object.keys(entry.filterable).join(", ") || "none"})`,
      );
    }
    if (f.op !== allowedOp) {
      throw new InvalidInputError(
        `"${f.field}" on ${entry.collection} may only be filtered with "${allowedOp}"`,
      );
    }
    if (f.value === undefined || f.value === null) {
      throw new InvalidInputError(`filter on "${f.field}" needs a value`);
    }
    if (f.op === "in" && (!Array.isArray(f.value) || f.value.length === 0 || f.value.length > 30)) {
      throw new InvalidInputError(`"in" on "${f.field}" needs an array of 1..30 values`);
    }
  }
}

/**
 * One registered collection, filtered as that registration allows.
 *
 * Returns `{ id, ...data }` per document: every consumer keys on the document id, and a projection
 * that dropped it would force the client to re-derive identity from a field.
 */
export async function readGovernedCollection(
  input: ReadGovernedCollectionInput,
  deps: GovernedCollectionDeps = {},
): Promise<{ rows: Array<Record<string, unknown>> }> {
  const db = deps.db ?? getFirestore();
  const roles = deps.roles ?? COMPATIBILITY_ROLES;

  if (typeof input.actorUid !== "string" || !input.actorUid) {
    throw new InvalidInputError("actorUid is required");
  }
  const entry = BY_COLLECTION.get(input.collection);
  if (!entry) {
    // Names the refusal without confirming whether the collection exists -- the caller learns that
    // this PATH does not serve it, which is all they need and all they are entitled to.
    throw new InvalidInputError(`"${String(input.collection)}" is not a governed readable collection`);
  }

  const filters = Array.isArray(input.filters) ? input.filters : [];
  assertFiltersAllowed(entry, filters);

  let limit = entry.maxLimit;
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > entry.maxLimit) {
      throw new InvalidInputError(`limit must be an integer between 1 and ${entry.maxLimit}`);
    }
    limit = input.limit;
  }

  // AUTHORIZE BEFORE READING. Ordered deliberately: an unauthorized caller must not be able to
  // measure the collection through timing or through an error that only a real query could produce.
  if (!(await actorHolds(db, roles, input.actorUid, entry.capability))) {
    throw new UnauthorizedActorError(`actor is not authorized for "${entry.capability}"`);
  }

  let query = db.collection(entry.collection) as FirebaseFirestore.Query;
  for (const f of filters) {
    query = query.where(f.field, f.op, f.value);
  }
  const snap = await query.limit(limit).get();
  return { rows: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
}
