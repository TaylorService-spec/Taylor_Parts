// The browser's route to the governed Finance operations (Finance Closure, DECISIONS #206).
//
//   browser -> THIS -> POST /operations/finance (EOS trusted API, functions/src/eosFinance/financeOperations.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// It decides nothing: every read and command is authorized by the SERVER (finance.payment.read to view; the separate
// settlement / reconciliation capabilities to act). A refusal is returned as a value the screen renders. No Firebase.
// The transport, failure categories and configuration seam are the Work Order client's, reused.
import { workOrderFailureCategory } from "./workOrderApiClient.js";

const loadAdminClient = () => import("./adminPolicyApiClient.js");

export const FINANCE_ROUTE = "/operations/finance";

/** Mirrors the server's EOS_FINANCE_OPERATIONS (closed). */
export const FINANCE_READ_OPERATIONS = Object.freeze(["readFinanceWorkspace", "listObligations", "readObligation", "listSettlements", "readSettlement"]);
export const FINANCE_COMMAND_OPERATIONS = Object.freeze(["recordSettlement", "applySettlement", "reverseSettlementApplication", "voidSettlement",
  "reconcileSettlement", "supplyReceiptCostEvidence", "relieveIntercompanySaleInventory"]);
const OPERATIONS = new Set([...FINANCE_READ_OPERATIONS, ...FINANCE_COMMAND_OPERATIONS]);
export const isFinanceOperation = (name) => typeof name === "string" && OPERATIONS.has(name);

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/** Call one named Finance read or command. `{ ok: true, result }` or `{ ok: false, code, reason, status, message }`. Never throws. */
export async function callFinanceApi(operation, input = undefined, options = {}) {
  if (!isFinanceOperation(operation)) return failure("UNKNOWN_OPERATION", `"${operation}" is not a Finance operation`);
  let admin = null;
  if (options.baseUrl === undefined || !options.getIdToken) {
    try { admin = await loadAdminClient(); } catch { admin = null; }
  }
  let rawBase;
  try {
    rawBase = options.baseUrl === undefined ? (admin ? admin.policyApiBaseUrl() : null) : options.baseUrl;
  } catch {
    rawBase = null;
  }
  const base = typeof rawBase === "string" && rawBase.trim().length > 0 ? rawBase.trim().replace(/\/+$/, "") : null;
  if (!base) return failure("NOT_CONFIGURED", "no EOS API is configured for this environment (VITE_EOS_API_BASE_URL)");
  let token;
  try {
    token = await (options.getIdToken ? options.getIdToken() : admin ? admin.currentIdToken() : null);
  } catch {
    token = null;
  }
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach Finance");
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");
  let response;
  try {
    response = await doFetch(`${base}${FINANCE_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}) },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", "Finance could not be reached");
  }
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.ok && body && body.ok === true) return Object.freeze({ ok: true, operation, result: body.result });
  const serverCode = body && typeof body.code === "string" ? body.code : null;
  return failure(workOrderFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `Finance returned ${response.status}`, { reason: serverCode, status: response.status });
}

export const financeApiClient = Object.freeze({ call: callFinanceApi });
