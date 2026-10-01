// The ONLY client path that brings an already-owned unit onto the books.
//
// `serialized_assets` is deny-all to every client, so there is no client-direct alternative to fall
// back to, by design — an acquisition is a trusted write or it does not happen. This calls the
// trusted writer and returns what it said.
//
// Errors are RETURNED rather than thrown so the caller can branch on the CODE. Three of them are
// states worth showing rather than exceptions worth swallowing:
//
//   PART_NOT_SERIALIZED      the Part is real and the wrong KIND. "Not found" would send somebody
//                            hunting for a Part sitting in front of them.
//   LOCATION_INVALID         the place named is not an active company location — and a customer's
//                            location can never be one, which is what keeps acquisition from
//                            becoming installation by another name.
//   ALREADY_EXISTS_CONFLICT  a unit with that serial already exists for this part, recorded
//                            differently — possibly from a RECEIPT, which acquisition must never
//                            overwrite. Retrying cannot help and the UI must not offer it.
//
// A REPLAY IS NOT AN ERROR. The command derives identity from part+serial, so the same unit
// submitted twice returns `outcome: "replayed"` through the SUCCESS path. The caller presents that
// as completion, not as a second acquisition.
//
// DQ-036(b), ACTIVATED (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): SERIALIZED_ASSET_ACQUIRE_WRITER_AUTHORITY
// mirrors the server's ACQUIRE_WRITER_AUTHORITY and is now { FROZEN, ACTIVE }: the EOS API only
// (callAcquireSerializedAssetOnEos), with NO Firebase fallback of any kind. The Firebase callable path is retired from
// this client; a state other than postgres ACTIVE refuses locally rather than reaching for Firebase.
import { currentIdToken, policyApiBaseUrl } from "./adminPolicyApiClient.js";
import { SERIALIZED_ASSET_ACQUIRE_WRITER_AUTHORITY } from "./serializedAssetAcquireWriterState.js";

const ACQUIRE_CALLABLE = "acquireSerializedAsset";
export const EOS_SERIALIZED_ASSET_ROUTE = "/operations/serialized-asset";
export const EOS_ACQUIRE_OPERATION = "acquireSerializedAsset";

/**
 * The EOS transport: POST /operations/serialized-asset, the signed-in user's bearer, nothing else. Returns the SAME
 * { outcome, error: { code, details, message } } shape the callable path returns, so the screen is unchanged: the
 * command's own failure code travels in `details`, exactly as the callable put it there. Never throws, never
 * retries anywhere else.
 */
export async function callAcquireSerializedAssetOnEos(request, deps = {}) {
  const rawBase = deps.baseUrl === undefined ? policyApiBaseUrl() : deps.baseUrl;
  const base = typeof rawBase === "string" && rawBase.trim() !== "" ? rawBase.trim().replace(/\/+$/, "") : null;
  if (!base) return { outcome: null, error: { code: "NOT_CONFIGURED", details: "NOT_CONFIGURED", message: "no EOS API is configured for this environment" } };
  let token = null;
  try { token = await (deps.getIdToken ? deps.getIdToken() : currentIdToken()); } catch { token = null; }
  if (!token) return { outcome: null, error: { code: "NOT_SIGNED_IN", details: "NOT_SIGNED_IN", message: "sign in to acquire a unit" } };
  const doFetch = deps.fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return { outcome: null, error: { code: "UNREACHABLE", details: "UNREACHABLE", message: "no network transport is available" } };
  let response;
  try {
    response = await doFetch(`${base}${EOS_SERIALIZED_ASSET_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ operation: EOS_ACQUIRE_OPERATION, input: request }),
    });
  } catch {
    return { outcome: null, error: { code: "UNREACHABLE", details: "UNREACHABLE", message: "the EOS API could not be reached" } };
  }
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (response.ok && body && body.ok === true) return { outcome: body.result ?? null, error: null };
  const code = body && typeof body.code === "string" ? body.code : "INTERNAL";
  return { outcome: null, error: { code: String(response.status), details: code, message: body && typeof body.message === "string" ? body.message : null } };
}

export async function callAcquireSerializedAsset(request, deps = {}) {
  const authority = deps.writerAuthority ?? SERIALIZED_ASSET_ACQUIRE_WRITER_AUTHORITY;
  if (authority.postgres === "ACTIVE") return callAcquireSerializedAssetOnEos(request, deps);
  // Not switched on: refused here, never sent to the retired Firebase callable.
  return { outcome: null, error: { code: "NOT_ACTIVATED", details: "NOT_ACTIVATED", message: "acquiring an existing unit is not switched on" } };
}
