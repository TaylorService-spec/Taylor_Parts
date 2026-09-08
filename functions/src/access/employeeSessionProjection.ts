// The signed-in principal's own session identity.
//
// ════════════════════ THIS IS BOOTSTRAP, NOT A DIRECTORY READ ════════════════════
//
// It answers exactly one question -- "who is the person holding this session" -- and it is the last
// thing the browser used to answer by reading Firestore directly. It deliberately requires NO
// capability:
//
//   * it is not `workforce.directory.read`. That capability reads OTHER PEOPLE, and requiring it
//     here would mean a technician could not learn their own name.
//   * it is not a standing Employee read permission, and it is not Role-configurable. There is
//     nothing to configure: the answer is fixed by who is signed in.
//   * it is not field security. It returns one projection, the same fields for everyone, about
//     themselves.
//
// The authority is authentication and nothing else, which is precisely the division this whole
// workstream exists to draw: Firebase authenticates, EOS authorizes, and "which employee am I" is
// an authentication-shaped question.
//
// ════════════════════ WHAT THE CALLER MAY SAY ════════════════════
//
// Nothing. Not a uid, not an employeeId, not a Role, not operationalRoles, not an employmentStatus.
// The uid comes from request.auth.uid and the employeeId is read from that user's own record; there
// is no input shape to put anything else in.
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const USERS = "users";
const EMPLOYEES = "employees";

export interface EmployeeSessionProjection {
  /**
   * The LEGACY `users/{uid}.role` string, carried for client compatibility (nav gating and display)
   * and for nothing else. IT IS NOT AUTHORIZATION. No trusted command, no capability resolver and
   * no read service consumes it -- `functions/test/legacyRoleIsNotAuthority.test.mjs` is the
   * structural proof, and it is what stops this field quietly becoming a rule again.
   */
  readonly role: string | null;
  readonly employeeId: string | null;
  readonly displayName: string | null;
  readonly operationalRoles: readonly string[];
  readonly employmentStatus: string | null;
}

/**
 * Build the projection from the two documents.
 *
 * PURE, so the linkage states are testable without a database. The three states the client
 * distinguished are preserved exactly, because they mean different things:
 *
 *   no employeeId          a valid, expected migration state -- the account was never provisioned.
 *   linked but missing     a BROKEN LINK. `employeeId` is retained so the breakage stays visible,
 *                          and no operational identity is granted from it. Deliberately not
 *                          collapsed into "no employeeId": that would hide a data fault by making
 *                          it look like an un-provisioned account.
 *   resolved               the real identity.
 */
export function buildEmployeeSessionProjection(
  role: unknown,
  employeeId: unknown,
  employeeData: Record<string, unknown> | null,
): EmployeeSessionProjection {
  const safeRole = typeof role === "string" ? role : null;
  const safeEmployeeId = typeof employeeId === "string" && employeeId !== "" ? employeeId : null;
  if (!safeEmployeeId || !employeeData) {
    return {
      role: safeRole,
      employeeId: safeEmployeeId,
      displayName: null,
      operationalRoles: [],
      employmentStatus: null,
    };
  }
  return {
    role: safeRole,
    employeeId: safeEmployeeId,
    displayName: typeof employeeData.displayName === "string" ? employeeData.displayName : null,
    operationalRoles: Array.isArray(employeeData.operationalRoles)
      ? (employeeData.operationalRoles as string[])
      : [],
    employmentStatus:
      typeof employeeData.employmentStatus === "string" ? employeeData.employmentStatus : null,
  };
}

/**
 * Whether the Employee document actually belongs to this principal.
 *
 * The link is stored twice -- `users/{uid}.employeeId` and `employees/{id}.userId` -- and the EOS
 * identity model treats the reciprocal field as the confirmation. A record naming a DIFFERENT uid
 * is a contradiction and is refused: the alternative is granting one person's operational identity
 * to another because a single field drifted.
 *
 * A record with NO `userId` is not a contradiction -- it is the un-migrated shape that predates the
 * reciprocal field, and the read this replaces resolved it. Refusing it here would log people out
 * of their own operational roles to tighten a check nothing had yet written.
 */
export function linkageIsReciprocal(employeeData: Record<string, unknown>, uid: string): boolean {
  const userId = employeeData.userId;
  if (userId === undefined || userId === null || userId === "") return true;
  return userId === uid;
}

export interface ResolveEmployeeSessionDeps {
  readonly db?: Firestore;
  /** Injected for tests. Production writes a safe warning naming only the id, never the record. */
  readonly warn?: (message: string) => void;
}

export async function resolveEmployeeSessionProjection(
  uid: string,
  deps: ResolveEmployeeSessionDeps = {},
): Promise<EmployeeSessionProjection> {
  const db = deps.db ?? getFirestore();
  const warn = deps.warn ?? ((m: string) => console.warn(m));

  const userSnap = await db.collection(USERS).doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : null;
  const role = userData?.role ?? null;
  const employeeId = userData?.employeeId ?? null;

  if (typeof employeeId !== "string" || employeeId === "") {
    return buildEmployeeSessionProjection(role, null, null);
  }

  const employeeSnap = await db.collection(EMPLOYEES).doc(employeeId).get();
  if (!employeeSnap.exists) {
    // The id only. Never the document contents, and never in the error returned to the caller --
    // a diagnostic about a broken link must not become a way to read a record through its absence.
    warn(`[employeeSession] users/${uid}.employeeId "${employeeId}" has no employees document -- broken link, no operational identity granted.`);
    return buildEmployeeSessionProjection(role, employeeId, null);
  }

  const employeeData = employeeSnap.data() as Record<string, unknown>;
  if (!linkageIsReciprocal(employeeData, uid)) {
    warn(`[employeeSession] users/${uid}.employeeId "${employeeId}" names a record linked to a different principal -- no operational identity granted.`);
    return buildEmployeeSessionProjection(role, employeeId, null);
  }

  return buildEmployeeSessionProjection(role, employeeId, employeeData);
}
