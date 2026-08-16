// CRM Activity / Notes — TRUSTED account-scoped READ (Taylor EOS Wave 7 extension, PART 1.4). Follows the
// exact shape of functions/src/salesOrder/salesOrderReadService.ts / functions/src/finance/
// financeReadCallables.ts's listAccountInvoiceAr: auth -> capability -> Admin SDK read -> pure project*()
// -> ready/not-found/unavailable envelope, with denied/unavailable distinguished. The client does NOT
// receive direct `crm_activities` read access (firestore.rules has no match block -- default deny,
// unchanged); this trusted backend reads via the Admin SDK and returns ONLY the minimal projection the
// CRM timeline UX needs.
//
// BOUNDED-READ HONESTY (mirrors listAccountInvoiceAr's own fix): fetches limit+1 and, if the extra row is
// present, the page is a TRUNCATION of the account's real activity set -- returns "unavailable", never a
// silently partial "ready" list.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { CRM_ACTIVITIES_COLLECTION } from "../constants/collections";
import { isCrmActivityType, type CrmActivityType } from "./crmActivityTypes";

export const CRM_ACTIVITY_READ_CAPABILITY = "crm.activity.read";

// The minimal projected shape the CRM Activity timeline UX consumes. References Contact/Opportunity/
// Sales Order by id only -- names/state/totals resolve separately from their own canonical authority,
// exactly like SalesOrderProjection's own "accountId only, no Customer name" rule.
export interface CrmActivityProjection {
  id: string;
  accountId: string;
  contactId: string | null;
  opportunityId: string | null;
  salesOrderId: string | null;
  type: CrmActivityType;
  body: string;
  occurredAtMillis: number;
  createdAtMillis: number | null;
  createdByUid: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toMillis(v: unknown): number | null {
  if (v && typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

// Pure projection of one canonical CRM Activity doc -> the minimal shape. Returns null if the doc cannot
// yield a usable projection (missing id, missing accountId, unrecognized type, missing body/occurredAt --
// an unrecognized/incomplete record is never trusted or guessed at, mirroring projectSalesOrder's own
// "return null rather than fabricate" rule).
export function projectCrmActivity(id: string, data: Record<string, unknown> | undefined): CrmActivityProjection | null {
  if (!id || !data || typeof data !== "object") return null;
  const accountId = str(data.accountId);
  if (!accountId) return null;
  if (!isCrmActivityType(data.type)) return null;
  const body = typeof data.body === "string" ? data.body : null;
  if (body === null) return null;
  const occurredAtMillis = num(data.occurredAtMillis);
  if (occurredAtMillis === null) return null;
  return {
    id,
    accountId,
    contactId: str(data.contactId),
    opportunityId: str(data.opportunityId),
    salesOrderId: str(data.salesOrderId),
    type: data.type,
    body,
    occurredAtMillis,
    // createdAt is a Firestore Timestamp (FieldValue.serverTimestamp() at write time) -- converted here,
    // not carried as a raw millis field, so the server clock stays the single source of truth (see
    // crmActivityCommands.ts's BuiltCrmActivity doc comment for the occurredAt-vs-createdAt contract).
    createdAtMillis: toMillis(data.createdAt),
    createdByUid: str(data.createdByUid),
  };
}

export type CrmActivityListStatus = "ready" | "unavailable";

export interface AccountCrmActivitiesResult {
  status: CrmActivityListStatus;
  activities: CrmActivityProjection[];
}

export const CRM_ACTIVITY_DEFAULT_LIMIT = 100;
export const CRM_ACTIVITY_MAX_LIMIT = 200;

// The core bounded read, factored out of the onCall adapter so it is exercisable directly (with an
// injected Firestore) in tests without needing a live `crm.activity.read` grant -- mirrors
// readAccountInvoiceAr (financeReadCallables.ts) exactly.
export async function readAccountCrmActivities(db: Firestore, accountId: string, limit: number): Promise<AccountCrmActivitiesResult> {
  try {
    const snap = await db.collection(CRM_ACTIVITIES_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
    if (snap.size > limit) {
      // An honest "unavailable" -- a truncated page is never labeled "ready" (that status implies a
      // complete list).
      return { status: "unavailable", activities: [] };
    }
    const activities = snap.docs
      .map((d) => projectCrmActivity(d.id, d.data() as Record<string, unknown>))
      .filter((a): a is CrmActivityProjection => a !== null)
      // Most-recent-interaction-first, by the BUSINESS fact (occurredAt), not the recording order.
      .sort((a, b) => b.occurredAtMillis - a.occurredAtMillis);
    return { status: "ready", activities };
  } catch {
    // A read failure is UNAVAILABLE, distinct from denied/empty -- never fabricated as "this account has
    // zero activities."
    return { status: "unavailable", activities: [] };
  }
}

async function requireCrmActivityRead(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [CRM_ACTIVITY_READ_CAPABILITY] });
    allowed = decisions[CRM_ACTIVITY_READ_CAPABILITY] === true;
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read CRM Activities.");
}

// List the CRM Activity timeline for one account (minimal projection, most-recent-first). Returns
// { status, activities }: "ready" (a complete page, possibly empty) | "unavailable" (read failed, or the
// account's activities exceed `limit`) -- denied is thrown as permission-denied, matching every other
// trusted read in this codebase.
export const getCrmActivities = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireCrmActivityRead(request.auth.uid);

  const data = (request.data ?? {}) as { accountId?: unknown; limit?: unknown };
  if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "accountId is required.");
  }
  const limit =
    Number.isSafeInteger(data.limit) && (data.limit as number) > 0 && (data.limit as number) <= CRM_ACTIVITY_MAX_LIMIT
      ? (data.limit as number)
      : CRM_ACTIVITY_DEFAULT_LIMIT;

  return readAccountCrmActivities(getFirestore(), data.accountId.trim(), limit);
});
