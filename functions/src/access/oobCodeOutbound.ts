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

const DEFAULT_ENDPOINT = "https://identitytoolkit.googleapis.com";

export interface NativeSendConfig {
  // Web API key -- supplied ONLY at a future config gate from Secret Manager; never
  // hardcoded, logged, read from the repo, or present in this change.
  apiKey: string;
  // The target Firebase project id (used for project-ownership validation + evidence).
  project: string;
  // Identity Toolkit base URL (defaults to the standard endpoint).
  endpoint?: string;
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
  const { apiKey, project, endpoint } = config as Partial<NativeSendConfig>;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return { valid: false, reason: "apiKey missing" };
  if (apiKey !== apiKey.trim() || /\s/.test(apiKey)) return { valid: false, reason: "apiKey malformed (whitespace)" };
  if (apiKey.length < 20) return { valid: false, reason: "apiKey too short to be well-formed" };
  if (typeof project !== "string" || project.trim().length === 0) return { valid: false, reason: "project missing" };
  if (endpoint !== undefined) {
    if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint)) {
      return { valid: false, reason: "endpoint must be an https URL" };
    }
  }
  return { valid: true };
}

// The concrete outbound. Calls accounts:sendOobCode; returns { accepted } based ONLY
// on HTTP 200. The response body / OOB code / action link stay inside this function
// and are NEVER returned, logged, or persisted; the API key (in the query string) is
// never logged either.
export function createOobCodeOutbound(config: NativeSendConfig, transport: FetchLike): (args: { targetUid: string; email: string; idempotencyKey: string }) => Promise<{ accepted: boolean }> {
  const base = (config.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
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
