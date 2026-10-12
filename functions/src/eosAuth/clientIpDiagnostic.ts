// THE CLIENT-ADDRESS MEASUREMENT (Owner 2026-10-12, nonproduction readiness): one authorised look at what Render's
// edge actually delivers, so EOS_AUTH_CLIENT_IP_HEADER / EOS_AUTH_TRUSTED_PROXY_HOPS are set from evidence, not docs.
//
//   POST /auth/diagnostics/client-ip     header x-eos-diagnostic-credential: <operator credential>
//
// NOT MOUNTED unless EOS_AUTH_CLIENT_IP_DIAGNOSTIC_SHA256 is set (64 hex, the SHA-256 of a one-time operator credential)
// AND EOS_ENVIRONMENT is nonprod; otherwise the path is a 404 like any unknown route. Independent of EOS_HUMAN_LOGIN:
// enabling the measurement enables nothing else.
//
// It answers with the caller's OWN request facts only -- the three address headers as delivered, the socket address,
// and what each candidate setting would resolve the client to -- and nothing else: no token, no cookie, no other header,
// no persistence, no log line with the values. The runbook (docs/architecture/eos-native-identity.md §9) unsets the
// variable as soon as the measurement is recorded.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sha256Hex } from "./eosAccessToken";

export const CLIENT_IP_DIAGNOSTIC_ROUTE = "/auth/diagnostics/client-ip";
export const CLIENT_IP_DIAGNOSTIC_HEADER = "x-eos-diagnostic-credential";

const single = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

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
    // Drain (and ignore) any body.
    for await (const _chunk of req) { /* nothing */ }
    send(200, { ok: true, ...clientAddressCandidates(req.headers as Record<string, string | string[] | undefined>, req.socket?.remoteAddress ?? null) });
  };
}
