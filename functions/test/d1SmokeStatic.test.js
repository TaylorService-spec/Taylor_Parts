// F-RULES-1 D1 -- static validation of the operator smoke tooling's
// corrected authentication path (operator run 1 blocker: custom-token
// signing is impossible under Cloud Shell user-ADC and no IAM widening is
// permitted). Pure source-text checks, no emulator, no network:
//   node --test test/d1SmokeStatic.test.js
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "scripts", "d1SmokeCompleteAssignedJob.js"), "utf8");
// Comments document the OLD blocked approach; assertions are about CODE.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:])\/\/[^\n]*$/gm, "$1");

test("no custom-token signing anywhere in code (the blocked path is gone)", () => {
  assert.doesNotMatch(CODE, /createCustomToken/);
  assert.doesNotMatch(CODE, /signInWithCustomToken/);
  assert.doesNotMatch(CODE, /signBlob|impersonat/i);
});

test("authentication is password sign-in via the public Identity Toolkit endpoint", () => {
  assert.match(CODE, /accounts:signInWithPassword/);
  assert.match(CODE, /returnSecureToken: true/);
});

test("the throwaway password comes ONLY from D1_SMOKE_PASSWORD and is length-checked", () => {
  assert.match(CODE, /process\.env\.D1_SMOKE_PASSWORD/);
  assert.match(CODE, /pw\.length < 12/);
  // no hardcoded password literal is passed to createUser/sign-in
  assert.doesNotMatch(CODE, /password:\s*["'](?!\$)/, "password must never be a string literal");
});

test("password and ID tokens are never printed or persisted", () => {
  // every console.* line and the evidence writer must not reference them
  const logs = CODE.split("\n").filter((l) => /console\.(log|error|warn)|writeFileSync/.test(l)).join("\n");
  assert.doesNotMatch(logs, /password|idToken|D1_SMOKE_PASSWORD|Bearer/i, "no credential material in logs/evidence");
  // sign-in failures surface only the API error code, never the request body
  assert.match(CODE, /body\?\.error\?\.message/);
});

test("seed creates exactly the two d1smoke Auth users with synthetic reserved-domain emails", () => {
  assert.match(CODE, /auth\.createUser\(\{ uid, email: smokeEmail\(uid\), password/);
  assert.match(CODE, /@d1smoke\.example\.com/);
});

test("cleanup deletes both Auth users and only d1smoke-prefixed fixture documents", () => {
  assert.match(CODE, /auth\.deleteUser\(uid\)/);
  // every doc path the script writes or deletes is built from the RUN_TAG ids
  const docPaths = [...CODE.matchAll(/db\.doc\(`([^`]+)`\)/g)].map((m) => m[1]);
  assert.ok(docPaths.length > 0);
  for (const p of docPaths) {
    assert.match(p, /\$\{IDS\.[A-Za-z0-9]+\}/, `doc path must be fixture-scoped: ${p}`);
  }
});

test("all 12 smoke assertions are present and unchanged", () => {
  const checks = [...SRC.matchAll(/check\("([^"]+)"/g)].map((m) => m[1]);
  assert.equal(checks.length, 12, `expected 12 checks, found ${checks.length}`);
  for (const expected of [
    "positive: HTTP 200", "positive: response contract", "cascade: job -> complete",
    "cascade: technician -> available", "audit: applied event at the idempotency key",
    "replay: HTTP 200", "replay: idempotentReplay true",
    "replay: no duplicate cascade (perturbed tech status untouched)",
    "replay: exactly one applied audit event",
    "negative: wrong technician denied (permission-denied)",
    "negative: assigned state denied (failed-precondition)",
    "negative: no mutation from denied attempts",
  ]) assert.ok(checks.includes(expected), `missing check: ${expected}`);
});

test("script deploys nothing and touches no Rules/hosting (operator smoke only)", () => {
  assert.doesNotMatch(CODE, /firebase deploy|firestore:rules|hosting/);
});
