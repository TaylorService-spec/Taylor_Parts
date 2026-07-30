// AUTH -- native-sender OUTBOUND adapter (D-NATIVE-SEND-CONFIG design; repository/
// emulator-only). Implements the concrete `OutboundNativeSend` that calls the
// Firebase Identity Toolkit REST endpoint `accounts:sendOobCode`
// (requestType=PASSWORD_RESET) so FIREBASE sends its own native reset email --
// no external provider (#54), no reset-link generation. The ONLY truthful signal
// is `accepted` (HTTP 200 = Firebase accepted the request), NEVER "delivered".
//
// SCOPE / SAFETY (this change): NO secret is read, created, or committed; NO real
// call is wired in the deployed path; NO production configuration. The API key is
// only ever supplied to `createOobCodeOutbound` by a FUTURE, separately authorized
// config gate (from Secret Manager). The HTTP transport is injectable so unit
// tests fake it -- there is no real network call in tests. `buildNativeResetSender`
// stays FAIL-CLOSED (returns the `outbound: null` sender) whenever config is absent
// or structurally/project-invalid; the deployed wiring passes `null` (no config),
// so production remains fail-closed and sends nothing.
import { createNativeResetSender } from "./nativeResetSender";
import type { NativeResetSender } from "./adminCredentialCommands";

// The ONLY origin the adapter ever calls. It is a hardcoded constant -- there is NO
// config field and NO parameter that can redirect it, so an arbitrary host can never
// receive the API key + reset email. Unit/emulator tests use the injectable transport
// (they inspect/fake the call) and never need a different origin.
export const APPROVED_ENDPOINT = "https://identitytoolkit.googleapis.com";

export interface NativeSendConfig {
  // Web API key -- supplied ONLY at a future config gate from Secret Manager; never
  // hardcoded, logged, read from the repo, or present in this change.
  apiKey: string;
  // The target Firebase project id the send must belong to.
  project: string;
  // The project the API key is ATTESTED to belong to (provided out-of-band at the
  // config gate). Non-sending project-ownership check = `apiKeyProject === project`.
  // (Ownership cannot be derived from the key string; full confirmation is D-PROD-1A/
  // config-gate + proven live at D-PROD-1C.) There is intentionally NO `endpoint`
  // field: production always targets APPROVED_ENDPOINT.
  apiKeyProject: string;
}

// A minimal fetch-like transport, injectable so tests never hit the network.
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export type ConfigValidationResult = { valid: true } | { valid: false; reason: string };

// NON-SENDING validation (D-NSC-VALIDATION): structural + project checks only. This
// NEVER calls sendOobCode and therefore does NOT prove Firebase will accept a send --
// send acceptance stays unverified until the post-deployment D-PROD-1C gate.
export function validateNativeSendConfig(config: Partial<NativeSendConfig> | null | undefined): ConfigValidationResult {
  if (!config || typeof config !== "object") return { valid: false, reason: "config missing" };
  const c = config as Record<string, unknown>;
  const { apiKey, project, apiKeyProject } = config as Partial<NativeSendConfig>;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return { valid: false, reason: "apiKey missing" };
  if (apiKey !== apiKey.trim() || /\s/.test(apiKey)) return { valid: false, reason: "apiKey malformed (whitespace)" };
  if (apiKey.length < 20) return { valid: false, reason: "apiKey too short to be well-formed" };
  if (typeof project !== "string" || project.trim().length === 0) return { valid: false, reason: "project missing" };
  // Project-ownership attestation (used): the key must be attested for the target project.
  if (typeof apiKeyProject !== "string" || apiKeyProject.trim().length === 0) {
    return { valid: false, reason: "missing apiKey project-ownership attestation" };
  }
  if (apiKeyProject !== project) {
    return { valid: false, reason: "apiKey project attestation does not match the target project" };
  }
  // Config may NOT redirect the endpoint (exfiltration guard): reject any `endpoint`
  // field. The origin is a hardcoded constant (APPROVED_ENDPOINT) with no override of
  // any kind; there is no custom-origin seam.
  if ("endpoint" in c) return { valid: false, reason: "endpoint override is not permitted in config (uses APPROVED_ENDPOINT)" };
  return { valid: true };
}

// The concrete outbound. Calls accounts:sendOobCode; returns { accepted } based ONLY
// on HTTP 200. The response body / OOB code / action link stay inside this function
// and are NEVER returned, logged, or persisted; the API key (in the query string) is
// never logged either.
// Always calls the hardcoded APPROVED_ENDPOINT. There is intentionally NO endpoint
// parameter and NO config field: no caller -- production or otherwise -- can redirect
// the origin. Tests fake the HTTP call via the injectable `transport`.
export function createOobCodeOutbound(
  config: NativeSendConfig,
  transport: FetchLike,
): (args: { targetUid: string; email: string; idempotencyKey: string }) => Promise<{ accepted: boolean }> {
  const base = APPROVED_ENDPOINT.replace(/\/+$/, "");
  return async ({ email }) => {
    const url = `${base}/v1/accounts:sendOobCode?key=${encodeURIComponent(config.apiKey)}`;
    const res = await transport(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
    });
    // Truthful: accepted iff Firebase returned HTTP 200. Nothing else leaves this boundary.
    return { accepted: res.ok === true && res.status === 200 };
  };
}

// Fail-closed builder. If config is absent or fails non-sending validation, returns
// the fail-closed sender (outbound: null -> isConfigured() === false). Only a
// structurally + project-valid config yields a configured (isConfigured() === true)
// sender. The deployed wiring calls this with `null`, so production is fail-closed.
export function buildNativeResetSender(
  config: Partial<NativeSendConfig> | null | undefined,
  transport?: FetchLike,
): NativeResetSender {
  const verdict = validateNativeSendConfig(config);
  if (!verdict.valid) return createNativeResetSender({ outbound: null });
  const t: FetchLike = transport ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
  return createNativeResetSender({ outbound: createOobCodeOutbound(config as NativeSendConfig, t) });
}
