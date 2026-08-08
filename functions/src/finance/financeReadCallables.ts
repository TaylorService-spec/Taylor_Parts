// Finance — trusted AR READ callable. A governed backend read over the Admin-SDK-only invoices collection:
// authorized principals get a MINIMAL AR projection for an account; the client never reads invoices directly
// (firestore.rules denies it). Mirrors the Opportunity trusted-read pattern:
//   • authorization = capability `finance.read`, fail-closed via the trusted effective-access feed; registered
//     active:false ⇒ hard DENY until a separate Owner grant;
//   • the read uses the Admin SDK and returns ONLY the projected AR fields (no PII, accountId only), deriving
//     the AR position from facts;
//   • distinct honest states: denied · empty · unavailable. This is a READ — it writes nothing and audits
//     nothing (no mutation), and it does not widen any client Rule.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { INVOICES_COLLECTION } from "../constants/collections";
import { projectInvoiceAr, summarizeAccountAr, type InvoiceArRead } from "./financeReadProjection";

export const FINANCE_READ_CAPABILITY = "finance.read";

async function requireFinanceRead(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [FINANCE_READ_CAPABILITY] });
    allowed = decisions[FINANCE_READ_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to read Finance AR.");
}

// List the AR reads for an account's invoices (minimal projection). Returns { status, invoices, summary }:
//   status "ready" (data, possibly empty) | "unavailable" (read failed) — denied is thrown as permission-denied.
export const listAccountInvoiceAr = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireFinanceRead(request.auth.uid);

  const data = (request.data ?? {}) as { accountId?: string; limit?: number };
  if (typeof data.accountId !== "string" || data.accountId.trim().length === 0) throw new HttpsError("invalid-argument", "accountId is required.");
  const limit = Number.isSafeInteger(data.limit) && (data.limit as number) > 0 && (data.limit as number) <= 200 ? (data.limit as number) : 100;

  const db = getFirestore();
  const now = Date.now();
  try {
    const snap = await db.collection(INVOICES_COLLECTION).where("accountId", "==", data.accountId).limit(limit).get();
    const invoices: InvoiceArRead[] = snap.docs.map((d) => projectInvoiceAr(d.id, d.data() ?? {}, now));
    return { status: "ready" as const, invoices, summary: summarizeAccountAr(invoices) };
  } catch {
    // An honest "unavailable" — the read failed / is not connected — NOT "this account has zero invoices".
    return { status: "unavailable" as const, invoices: [] as InvoiceArRead[], summary: summarizeAccountAr([]) };
  }
});
