// The browser's route to the governed, READ-ONLY persona workspace and site-wide search (Application Assembly, DECISIONS #209).
//
//   browser -> THIS -> POST /operations/workspace (EOS trusted API, functions/src/eosExperience/workspaceOperations.ts)
//           -> verified bearer -> EOS Principal + tenant membership + capabilities -> PostgreSQL
//
// It decides nothing: the persona (the caller's current Job Role) only chooses the LAYOUT; every section and every search kind is
// authorized by the SERVER on its own existing read, and a refusal is returned as a value the screen renders. No Firebase, no AI.
// The transport, failure categories and configuration seam are the Work Order client's, reused.
import { workOrderFailureCategory } from "./workOrderApiClient.js";

const loadAdminClient = () => import("./adminPolicyApiClient.js");

export const WORKSPACE_ROUTE = "/operations/workspace";

/** Mirrors the server's EOS_WORKSPACE_OPERATIONS (closed, read-only). */
export const WORKSPACE_OPERATIONS = Object.freeze(["readMyWork", "searchEos", "previewMyWorkAs", "resolvePrincipalDisplayNames", "resolveEmployeeDisplayNames", "searchAccountOwnerCandidates"]);
const OPERATIONS = new Set(WORKSPACE_OPERATIONS);
export const isWorkspaceOperation = (name) => typeof name === "string" && OPERATIONS.has(name);

const failure = (code, message, extra = {}) =>
  Object.freeze({ ok: false, code, message, reason: extra.reason ?? null, status: extra.status ?? null });

/** Call one named workspace read. `{ ok: true, result }` or `{ ok: false, code, reason, status, message }`. Never throws. */
export async function callWorkspaceApi(operation, input = undefined, options = {}) {
  if (!isWorkspaceOperation(operation)) return failure("UNKNOWN_OPERATION", `"${operation}" is not a workspace operation`);
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
  if (!token) return failure("NOT_SIGNED_IN", "sign in to reach your workspace");
  const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return failure("UNREACHABLE", "no network transport is available");
  let response;
  try {
    response = await doFetch(`${base}${WORKSPACE_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options.tenantId ? { "x-eos-tenant": options.tenantId } : {}) },
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return failure("UNREACHABLE", "the request was cancelled");
    return failure("UNREACHABLE", "Your workspace could not be reached");
  }
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.ok && body && body.ok === true) return Object.freeze({ ok: true, operation, result: body.result });
  const serverCode = body && typeof body.code === "string" ? body.code : null;
  return failure(workOrderFailureCategory(response.status, serverCode),
    body && typeof body.message === "string" ? body.message : `The workspace returned ${response.status}`, { reason: serverCode, status: response.status });
}

export const workspaceApiClient = Object.freeze({ call: callWorkspaceApi });
