// THE WORKFORCE DIRECTORY, read through the governed callable instead of Firestore.
//
// WHY THIS REPLACED A LIVE FIRESTORE QUERY. The directory used to be an onSnapshot over
// `employees`, authorized by firestore.rules' isAdminOrDispatcher() -- a predicate over the legacy
// users/{uid}.role. That made Firestore the rule keeper and the legacy role the rule. Owner
// direction is that Firebase gives access to the system and decides nothing else: permission comes
// from the Role and object permissions administered in Admin. This seam is how that becomes true
// for this collection -- the read now resolves `workforce.directory.read` server-side, and
// `employees` client reads are denied in Rules.
//
// ONE-SHOT, NOT A SUBSCRIPTION, and that is a real behavioural change stated rather than hidden.
// A callable cannot stream, so a directory change no longer repaints open screens by itself. Every
// consumer of this hook already had an explicit refresh path for the data it mutates (the record
// page re-reads after a save), and a stale NAME in a picker is a materially smaller problem than
// the client holding a standing subscription to the whole workforce. If live directory updates are
// ever genuinely needed, the answer is a governed subscription, not restoring the client-direct
// read.
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/firebase";

const DIRECTORY_CALLABLE = "listWorkforceDirectory";

export const DIRECTORY_RESULT = Object.freeze({
  OK: "OK",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * Every Employee record this session may see. Resolves (never rejects).
 *
 * DENIED and UNAVAILABLE stay distinguishable for the same reason they do everywhere else in this
 * codebase: "you may not see the workforce" and "the workforce could not be read" send a person to
 * different places, and an empty list would claim the company has no employees.
 */
export async function listWorkforceDirectory({ limit } = {}) {
  try {
    const res = await httpsCallable(functions, DIRECTORY_CALLABLE)(limit ? { limit } : {});
    const rows = res?.data?.employees;
    return { ok: true, result: DIRECTORY_RESULT.OK, employees: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    const code = String(err?.code ?? "").replace(/^functions\//, "");
    return {
      ok: false,
      result:
        code === "permission-denied" || code === "unauthenticated"
          ? DIRECTORY_RESULT.DENIED
          : DIRECTORY_RESULT.UNAVAILABLE,
      employees: [],
    };
  }
}

export const workforceDirectoryClient = { listWorkforceDirectory };
