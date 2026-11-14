// The EOS API sets its security headers on every response: a normal one, an error/404, and a CORS preflight.
import "./support/firebaseOfflineGuard.cjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { applyEosApiSecurityHeaders, EOS_API_SECURITY_HEADERS } = createRequire(import.meta.url)("../lib/eosApi/securityHeaders.js");

test("server.ts applies the headers before dispatching to any handler", () => {
  const src = readFileSync(new URL("../src/eosApi/server.ts", import.meta.url), "utf8");
  assert.ok(src.indexOf("applyEosApiSecurityHeaders(res)") > 0);
  assert.ok(src.indexOf("applyEosApiSecurityHeaders(res)") < src.indexOf("const domain = eosApiDomainFor"));
});

test("headers survive a handler's own writeHead on 200, 404 and OPTIONS", async () => {
  const server = createServer((req, res) => {
    applyEosApiSecurityHeaders(res);
    if (req.method === "OPTIONS") res.writeHead(204, { "Access-Control-Allow-Origin": "https://x.example" });
    else if (req.url === "/ok") res.writeHead(200, { "Content-Type": "application/json" });
    else res.writeHead(404, { "Content-Type": "application/json" });
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [path, method, status] of [["/ok", "GET", 200], ["/missing", "GET", 404], ["/ok", "OPTIONS", 204]]) {
      const res = await fetch(base + path, { method });
      assert.equal(res.status, status);
      for (const [name, value] of Object.entries(EOS_API_SECURITY_HEADERS)) assert.equal(res.headers.get(name), value, `${method} ${path} ${name}`);
    }
  } finally { server.close(); }
  assert.match(EOS_API_SECURITY_HEADERS["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.doesNotMatch(EOS_API_SECURITY_HEADERS["Strict-Transport-Security"], /preload/);
});
