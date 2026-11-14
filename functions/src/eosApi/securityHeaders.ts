import type { ServerResponse } from "node:http";

/**
 * Response headers set on EVERY EOS API response (errors, 404s and CORS preflight included). The API returns JSON only, so
 * nothing it sends is ever meant to render, frame or be sniffed. Set once in server.ts before any domain handler runs; the
 * handlers' own writeHead calls merge with these and never remove them.
 */
export const EOS_API_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
});

export function applyEosApiSecurityHeaders(res: Pick<ServerResponse, "setHeader">): void {
  for (const [name, value] of Object.entries(EOS_API_SECURITY_HEADERS)) res.setHeader(name, value);
}
