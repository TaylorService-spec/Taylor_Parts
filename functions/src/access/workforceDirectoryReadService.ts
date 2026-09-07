// THE WORKFORCE DIRECTORY, as a governed read.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// Owner direction, stated repeatedly and finally as "get rid of firebase rules, only access should
// remain": Firebase authenticates and stores; it does not decide what anyone may do. Today the
// Users directory is read client-direct from `employees`, and `firestore.rules` decides who may see
// it with `isAdminOrDispatcher()` -- a predicate over the LEGACY `users/{uid}.role` string. So the
// rule keeper is Firestore, and what it keeps rules about is the legacy role. Both are the thing
// being retired.
//
// This service is the governed answer to the same question. When the client reads through it
// instead, `employees` read becomes `allow read: if false` and Firestore stops deciding: Rules hold
// a locked door, `workforce.directory.read` holds the policy, and the admin page administers it.
//
// ════════════════════ WHAT IT DOES NOT CHANGE ════════════════════
//
// NOT WHO CAN SEE THE DIRECTORY. `workforce.directory.read` is granted to the shared admin +
// dispatcher base -- exactly the population `isAdminOrDispatcher()` admits today. Moving WHERE a
// decision is made and narrowing WHO it admits are two changes, and doing them together would hide
// an access change inside an architectural one. If the population should be narrower, that is its
// own decision, made against a screen that shows the current answer.
//
// NOT THE DATA. The rows are the same Employee documents the client reads today, with the same
// fields. This is a transport change, not a projection redesign -- a narrower payload is worth
// doing, but not in the change that also moves the authority, for the same reason as above.
//
// NOT THE PARTS_MANAGER CANDIDATE READ. firestore.rules carries a second, narrower `employees`
// grant for the assignment picker (ACTIVE + PARTS_ASSOCIATE-eligible + linked). That path has its
// own consumer and its own migration; this service deliberately does not try to serve both, because
// one read that answers two differently-scoped questions is how a least-privilege grant quietly
// becomes a general one.
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Role } from "../types/access";
import { resolveEffectivePermission, type TargetContext } from "./resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const EMPLOYEES_COLLECTION = "employees";

export const WORKFORCE_DIRECTORY_CAPABILITY = "workforce.directory.read";

/** The cap on one directory read. The workforce is a company headcount, not an unbounded feed. */
const MAX_LIMIT = 2000;

// THE SHARED ERROR VOCABULARY, not a second one. accessCommandCallables' mapper narrows errors by
// `instanceof commands.X`, so a locally-declared UnauthorizedActorError would miss every branch and
// surface a denial as a generic `internal` -- the client would then render "the service is not
// available" to a principal who is simply not authorized. Two error types with the same name and
// different identities is exactly the kind of near-miss that reads as correct in review.
export { InvalidInputError, UnauthorizedActorError } from "./trustedWriterCommands";
import { InvalidInputError, UnauthorizedActorError } from "./trustedWriterCommands";

export interface ListWorkforceDirectoryInput {
  actorUid: string;
  limit?: number;
}

const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };

function readAccessVersion(data: Record<string, unknown> | undefined): number {
  const raw = data?.accessVersion;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * Does the actor hold the governed directory capability?
 *
 * The SAME resolver the enforcement path uses, over the actor's own active assignments -- not a
 * second interpretation of what a Role means. `users/{uid}.role` is never consulted: that string is
 * precisely what this migration removes from the decision.
 */
async function actorHoldsDirectoryRead(
  db: Firestore,
  roles: Readonly<Record<string, Role>>,
  actorUid: string,
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
      permissionId: WORKFORCE_DIRECTORY_CAPABILITY,
      assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
      roles,
      currentAccessVersion: readAccessVersion(userSnap.data() as Record<string, unknown> | undefined),
      target: GLOBAL_TARGET,
    }).decision === "ALLOW"
  );
}

export interface WorkforceDirectoryDeps {
  db?: Firestore;
  roles?: Readonly<Record<string, Role>>;
}

/**
 * Every Employee record the directory surfaces need, newest-agnostic and name-ordered by the
 * caller (the client already sorts; ordering here would be a second, competing opinion).
 *
 * Returns the document id as `id` alongside the stored fields, because every consumer keys on it --
 * `byEmployeeId`, the manager link, and the record page's own route parameter.
 */
export async function listWorkforceDirectory(
  input: ListWorkforceDirectoryInput,
  deps: WorkforceDirectoryDeps = {},
): Promise<{ employees: Array<Record<string, unknown>> }> {
  const db = deps.db ?? getFirestore();
  const roles = deps.roles ?? COMPATIBILITY_ROLES;

  if (typeof input.actorUid !== "string" || !input.actorUid) {
    throw new InvalidInputError("actorUid is required");
  }
  let limit = MAX_LIMIT;
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new InvalidInputError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    limit = input.limit;
  }

  if (!(await actorHoldsDirectoryRead(db, roles, input.actorUid))) {
    // Deliberately NOT audited, for the reason recordChangeHistoryReadService gives about its own
    // denial: reading is not a mutation, and recording a denied READ on the audit trail would let
    // an unauthorized caller append to it.
    throw new UnauthorizedActorError(
      `actor is not authorized for "${WORKFORCE_DIRECTORY_CAPABILITY}"`,
    );
  }

  const snap = await db.collection(EMPLOYEES_COLLECTION).limit(limit).get();
  return { employees: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
}
