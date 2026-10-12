// THE CLIENT-ADDRESS MEASUREMENT (Owner 2026-10-12, nonproduction readiness): one authorised look at what Render's
// edge actually delivers, so EOS_AUTH_CLIENT_IP_HEADER / EOS_AUTH_TRUSTED_PROXY_HOPS are set from evidence, not docs.
//
//   POST /auth/diagnostics/client-ip     header x-eos-diagnostic-credential: <operator credential>
//
// NOT MOUNTED unless EOS_AUTH_CLIENT_IP_DIAGNOSTIC_SHA256 is set (64 hex, the SHA-256 of a one-time operator credential)
// AND EOS_ENVIRONMENT is nonprod; otherwise the path is a 404 like any unknown route. Independent of EOS_HUMAN_LOGIN:
// enabling the measurement enables nothing else.
//
// VERDICTS, NOT ADDRESSES (Owner 2026-10-12: no raw identifying request data in logs or reports). The operator sends the
// public address they know they are calling from, `{"expected":"<ip>"}`; the answer says, for each candidate setting,
// only WHETHER it would resolve to that address, plus counts and presence flags -- never an address, a header value, a
// token or a cookie. Nothing is persisted or logged. The body is capped like the login routes'. The runbook
// (docs/architecture/eos-native-identity.md §9b) unsets the variable as soon as the measurement is recorded.
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sha256Hex } from "./eosAccessToken";

export const CLIENT_IP_DIAGNOSTIC_ROUTE = "/auth/diagnostics/client-ip";
export const CLIENT_IP_DIAGNOSTIC_HEADER = "x-eos-diagnostic-credential";

const single = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const MAX_BODY_BYTES = 8 * 1024;
/**
 * One spelling per address (re-review finding 4): IPv6 is canonicalised (compressed, lower case), and an IPv4-mapped IPv6
 * address, in dotted (::ffff:203.0.113.9) or hex (::ffff:cb00:7109) form, is the same client as its IPv4 form.
 */
export function normalizeAddress(a: string | null): string | null {
  const raw = (a ?? "").trim();
  if (isIP(raw) === 4) return raw;
  if (isIP(raw) !== 6) return raw.toLowerCase() || null;
  const canon = new URL(`http://[${raw}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canon);
  if (!mapped) return canon;
  const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

/** What a candidate configuration would take as the client address for this request. Pure. */
export function clientAddressCandidates(headers: Record<string, string | string[] | undefined>, socketAddress: string | null) {
  const xff = single(headers["x-forwarded-for"]);
  const chain = (xff ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const hop = (n: number) => (chain.length >= n ? chain[chain.length - n] : socketAddress);
  return {
    delivered: {
      xForwardedFor: xff,
      xForwardedForEntries: chain.length,
      trueClientIp: single(headers["true-client-ip"]),
      cfConnectingIp: single(headers["cf-connecting-ip"]),
      socket: socketAddress,
    },
    wouldResolve: {
      "EOS_AUTH_CLIENT_IP_HEADER=true-client-ip": single(headers["true-client-ip"]) ?? socketAddress,
      "EOS_AUTH_CLIENT_IP_HEADER=cf-connecting-ip": single(headers["cf-connecting-ip"]) ?? socketAddress,
      "EOS_AUTH_TRUSTED_PROXY_HOPS=0": socketAddress,
      "EOS_AUTH_TRUSTED_PROXY_HOPS=1": hop(1),
      "EOS_AUTH_TRUSTED_PROXY_HOPS=2": hop(2),
      "EOS_AUTH_TRUSTED_PROXY_HOPS=3": hop(3),
    },
  };
}

/**
 * The measurement's ANSWER: no address leaves this function. For each candidate setting, does it resolve to `expected`;
 * which X-Forwarded-For positions (counted from the right, 1 = nearest proxy) hold `expected`; and which headers were
 * present at all. Pure.
 */
export function clientAddressVerdicts(headers: Record<string, string | string[] | undefined>, socketAddress: string | null, expected: string) {
  const want = normalizeAddress(expected);
  const c = clientAddressCandidates(headers, socketAddress);
  const chain = (c.delivered.xForwardedFor ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    delivered: {
      xForwardedForEntries: chain.length,
      xForwardedForPositionsFromRightHoldingExpected: chain.map((x, i) => [chain.length - i, normalizeAddress(x)] as const)
        .filter(([, x]) => x === want).map(([n]) => n).sort((a, b) => a - b),
      trueClientIpPresent: c.delivered.trueClientIp !== null,
      cfConnectingIpPresent: c.delivered.cfConnectingIp !== null,
      socketIsExpected: normalizeAddress(c.delivered.socket) === want,
    },
    resolvesToExpected: Object.fromEntries(Object.entries(c.wouldResolve).map(([k, v]) => [k, normalizeAddress(v) === want])),
  };
}

export function createClientIpDiagnosticHandler(credentialSha256: string) {
  const expected = Buffer.from(credentialSha256, "hex");
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if ((req.method ?? "GET").toUpperCase() !== "POST") return send(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    const presented = single(req.headers[CLIENT_IP_DIAGNOSTIC_HEADER]);
    const ok = typeof presented === "string" && presented.length >= 43 && presented.length <= 512
      && timingSafeEqual(Buffer.from(sha256Hex(presented), "hex"), expected);
    if (!ok) return send(401, { ok: false, code: "UNAUTHENTICATED" });
    // The body, capped (independent review F4): {"expected":"<the public address the operator is calling from>"}.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) return send(413, { ok: false, code: "PAYLOAD_TOO_LARGE" });
      chunks.push(chunk as Buffer);
    }
    let claimed: unknown;
    try { claimed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")?.expected; } catch { claimed = undefined; }
    if (typeof claimed !== "string" || isIP(claimed.trim()) === 0) {
      return send(400, { ok: false, code: "EXPECTED_ADDRESS_REQUIRED", message: 'send {"expected":"<your public IP address>"}' });
    }
    send(200, { ok: true, ...clientAddressVerdicts(req.headers as Record<string, string | string[] | undefined>, req.socket?.remoteAddress ?? null, claimed) });
  };
}
