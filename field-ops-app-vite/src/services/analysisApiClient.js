// The browser's route to the governed, READ-ONLY Analysis operations (Analysis & Reporting, DECISIONS #208).
//
//   browser -> THIS -> POST /operations/analysis (EOS trusted API, functions/src/eosAnalysis/analysisOperations.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// It decides nothing and computes nothing: every figure is the server's, every measure is authorized by the SERVER on its own
// existing read capability, and a refusal is returned as a value the screen renders. No Firebase, no AI.
// The transport, failure categories and configuration seam are the Work Order client's, reused.
import { workOrderFailureCategory } from "./workOrderApiClient.js";

const loadAdminClient = () => import("./adminPolicyApiClient.js");

export const ANALYSIS_ROUTE = "/operations/analysis";

/** Mirrors the server's EOS_ANALYSIS_OPERATIONS (closed, read-only). */
export const ANALYSIS_OPERATIONS = Object.freeze(["readAnalysisCatalog", "readAnalysisWorkspace", "readMeasureAnalysis"]);
const OPERATIONS = new Set(ANALYSIS_OPERATIONS);
export const isAnalysisOperation = (name) => typeof name === "string" && OPERATIONS.has(name);

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/** Call one named Analysis read. `{ ok: true, result }` or `{ ok: false, code, reason, status, message }`. Never throws. */
export async function callAnalysisApi(operation, input = undefined, options = {}) {
  if (!isAnalysisOperation(operation)) return failure("UNKNOWN_OPERATION", `"${operation}" is not an Analysis operation`);
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
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach Analysis");
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");
  let response;
  try {
    response = await doFetch(`${base}${ANALYSIS_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}) },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", "Analysis could not be reached");
  }
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.ok && body && body.ok === true) return Object.freeze({ ok: true, operation, result: body.result });
  const serverCode = body && typeof body.code === "string" ? body.code : null;
  return failure(workOrderFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `Analysis returned ${response.status}`, { reason: serverCode, status: response.status });
}

export const analysisApiClient = Object.freeze({ call: callAnalysisApi });
