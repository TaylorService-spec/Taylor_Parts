// Finance — trusted AR READ callable. A governed backend read over the Admin-SDK-only invoices collection:
// authorized principals get a MINIMAL AR projection for an account; the client never reads invoices directly
// (firestore.rules denies it). Mirrors the Opportunity trusted-read pattern:
//   • authorization = capability `finance.read`, fail-closed via the trusted effective-access feed; registered
//     active:false ⇒ hard DENY until a separate Owner grant;
//   • the read uses the Admin SDK and returns ONLY the projected AR fields (no PII, accountId only), deriving
//     the AR position from facts;
//   • distinct honest states: denied · ready · unavailable. This is a READ — it writes nothing and audits
//     nothing (no mutation), and it does not widen any client Rule.
//   • bounded-read honesty (mirrors coverageReadCallables.ts's resolveCoverageForContext / PR #905): the read
//     fetches limit+1 and, if the extra row is present, the page is a TRUNCATION of the account's real invoice
//     set — a bounded resolver must never label that "ready" (that status implies a complete summary). It
//     returns "unavailable" instead, exactly like a failed read, rather than silently reporting a partial AR
//     position as if it were the whole account.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { INVOICES_COLLECTION } from "../constants/collections";
import { projectInvoiceAr, summarizeAccountAr, type InvoiceArRead } from "./financeReadProjection";

export const FINANCE_READ_CAPABILITY = "finance.read";

async function requireFinanceRead(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [FINANCE_READ_CAPABILITY] });
    allowed = decisions[FINANCE_READ_CAPABILITY] === true;
  } catch (err) {
    console.error(`[requireFinanceRead] capability resolution failed for ${FINANCE_READ_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read Finance AR.");
}

export interface AccountInvoiceArResult {
  status: "ready" | "unavailable";
  invoices: InvoiceArRead[];
  summary: ReturnType<typeof summarizeAccountAr>;
}

// The core bounded read, factored out of the onCall adapter so it can be exercised directly (with an injected
// Firestore) in tests without needing a live `finance.read` grant. Returns { status, invoices, summary }:
//   status "ready" (a COMPLETE page, possibly empty) | "unavailable" (the read failed, OR the page was
//   truncated by the `limit` bound — an honest "unavailable", never a partial "ready").
export async function readAccountInvoiceAr(db: Firestore, accountId: string, limit: number): Promise<AccountInvoiceArResult> {
  const now = Date.now();
  try {
    // Fetch one row past the bound: if it comes back, the real result set exceeds `limit` and this page is a
    // truncation, not the whole account.
    const snap = await db.collection(INVOICES_COLLECTION).where("accountId", "==", accountId).limit(limit + 1).get();
    if (snap.size > limit) {
      return { status: "unavailable", invoices: [], summary: summarizeAccountAr([]) };
    }
    const invoices: InvoiceArRead[] = snap.docs.map((d) => projectInvoiceAr(d.id, d.data() ?? {}, now));
    return { status: "ready", invoices, summary: summarizeAccountAr(invoices) };
  } catch {
    // An honest "unavailable" — the read failed / is not connected — NOT "this account has zero invoices".
    return { status: "unavailable", invoices: [], summary: summarizeAccountAr([]) };
  }
}

// List the AR reads for an account's invoices (minimal projection). Returns { status, invoices, summary }:
//   status "ready" (a complete page, possibly empty) | "unavailable" (read failed, or the account's invoices
//   exceed `limit` and the page would otherwise be a silent truncation) — denied is thrown as permission-denied.
export const listAccountInvoiceAr = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireFinanceRead(request.auth.uid);

  const data = (request.data ?? {}) as { accountId?: string; limit?: number };
  if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) throw new HttpsError("invalid-argument", "accountId is required.");
  const limit = Number.isSafeInteger(data.limit) && (data.limit as number) > 0 && (data.limit as number) <= 200 ? (data.limit as number) : 100;

  return readAccountInvoiceAr(getFirestore(), data.accountId, limit);
});
