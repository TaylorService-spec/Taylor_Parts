// vercel.json must carry the security headers, and the CSP must stay consistent with index.html's one inline script.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const rule = JSON.parse(read("vercel.json")).headers.find((h) => h.source === "/(.*)");
const header = (k) => rule.headers.find((h) => h.key === k)?.value;
const csp = header("Content-Security-Policy");

test("vercel.json sets the security headers on every path", () => {
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.match(csp, /frame-ancestors 'none'/);
});

test("CSP allows no eval and no inline script beyond the hashed bootstrap in index.html", () => {
  const scriptSrc = /script-src ([^;]+)/.exec(csp)[1];
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(scriptSrc, /unsafe-inline/);
  const inline = [...read("index.html").replace(/\r/g, "").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1, "index.html has exactly one inline script; a new one needs its hash in vercel.json");
  const hash = `'sha256-${createHash("sha256").update(inline[0][1]).digest("base64")}'`;
  assert.ok(scriptSrc.split(" ").includes(hash), `script-src must contain ${hash}`);
});
