import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createSecretBroker, resolveDpapiSecret, SECRET_FAILURE } from "./secretProvider.mjs";
import { buildReviewAuthorization, resolveReviewAuthorization } from "./reviewAuthorization.mjs";

const SECRET = "sk-test-canary-never-serialize-9173";
const grantArtifact = buildReviewAuthorization({ workId: "WORK-1", reviewId: "REVIEW-1", maxSpendUsd: 0.25, sourceCommit: "a".repeat(40), provenance: "governed-test" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
const GRANT = resolveReviewAuthorization({ workId: grantArtifact.workId, reviewId: grantArtifact.reviewId, location: grantArtifact.artifactLocation, sha256: grantArtifact.sha256, bytes: JSON.stringify(grantArtifact) });
const resolvedGrant = (changes) => {
  const a = buildReviewAuthorization({ workId: "WORK-1", reviewId: "REVIEW-NEG", maxSpendUsd: 0.25, sourceCommit: "a".repeat(40), provenance: "negative-test", ...changes }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
  return resolveReviewAuthorization({ workId: a.workId, reviewId: a.reviewId, location: a.artifactLocation, sha256: a.sha256, bytes: JSON.stringify(a) });
};
const fakeBroker = (overrides = {}) => createSecretBroker({ platform: "win32", secretRoot: overrides.root || tmpdir(), resolveSecret: overrides.resolveSecret || (() => SECRET), logger: overrides.logger });

test("credential status is metadata-only and never reveals a secret", () => {
  const status = fakeBroker().credentialStatus("OPENAI_REVIEW");
  assert.equal(status.secretValue, "REDACTED");
  assert.ok(!JSON.stringify(status).includes(SECRET));
});

test("work authorization false refuses before credential resolution", async () => {
  let resolved = 0;
  await assert.rejects(() => fakeBroker({ resolveSecret: () => { resolved++; return SECRET; } }).withCredential("OPENAI_REVIEW", resolvedGrant({ authorizationState: "UNAUTHORIZED" }), async () => null), { code: SECRET_FAILURE.WORK_UNAUTHORIZED });
  assert.equal(resolved, 0);
});

test("budget authorization false refuses before credential resolution", async () => {
  let resolved = 0;
  await assert.rejects(() => fakeBroker({ resolveSecret: () => { resolved++; return SECRET; } }).withCredential("OPENAI_REVIEW", resolvedGrant({ budgetAuthorizationState: "UNAUTHORIZED" }), async () => null), { code: SECRET_FAILURE.BUDGET_UNAUTHORIZED });
  assert.equal(resolved, 0);
});

test("authorized capability invokes an injected provider without serializing or logging secret", async () => {
  const logs = [];
  const result = await fakeBroker({ logger: (event) => logs.push(event) }).withCredential("OPENAI_REVIEW", GRANT, async (secret) => ({ ok: secret === SECRET, evidence: "review-complete" }));
  assert.equal(result.ok, true);
  assert.ok(!JSON.stringify({ result, logs }).includes(SECRET));
});

test("callback cannot return the raw credential in result/evidence", async () => {
  await assert.rejects(() => fakeBroker().withCredential("OPENAI_REVIEW", GRANT, async (secret) => ({ evidence: secret })), { code: SECRET_FAILURE.EXPOSURE_BLOCKED });
  await assert.rejects(() => fakeBroker().withCredential("OPENAI_REVIEW", GRANT, async (secret) => Buffer.from(secret)), { code: SECRET_FAILURE.EXPOSURE_BLOCKED });
  await assert.rejects(() => fakeBroker().withCredential("OPENAI_REVIEW", GRANT, async (secret) => { const circular = { evidence: secret }; circular.self = circular; return circular; }), { code: SECRET_FAILURE.EXPOSURE_BLOCKED });
});

test("missing and corrupt DPAPI secrets fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "eos-secret-"));
  assert.throws(() => resolveDpapiSecret("OPENAI_API_KEY", { platform: "win32", secretRoot: root }), { code: SECRET_FAILURE.NOT_CONFIGURED });
  writeFileSync(join(root, "OPENAI_API_KEY.dpapi"), Buffer.from("corrupt"));
  assert.throws(() => resolveDpapiSecret("OPENAI_API_KEY", { platform: "win32", secretRoot: root }), { code: SECRET_FAILURE.DECRYPT_FAILED });
});

test("Windows DPAPI CurrentUser round trip stores no plaintext", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "eos-dpapi-"));
  const secretRoot = join(root, "EOS", "secrets");
  const path = join(secretRoot, "OPENAI_API_KEY.dpapi");
  const testScript = join(root, "protect-test.ps1");
  writeFileSync(testScript, "$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.Security\n$s=[Console]::In.ReadToEnd()\n$b=[Text.Encoding]::UTF8.GetBytes($s)\n$e=[Text.Encoding]::UTF8.GetBytes('EOS:secret:OPENAI_API_KEY:v1')\n$p=[Security.Cryptography.ProtectedData]::Protect($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)\n[IO.Directory]::CreateDirectory((Split-Path -Parent $env:EOS_TEST_PATH))|Out-Null\n[IO.File]::WriteAllBytes($env:EOS_TEST_PATH,$p)\n[Array]::Clear($b,0,$b.Length)\n");
  const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", testScript], { input: SECRET, env: { ...process.env, EOS_TEST_PATH: path }, encoding: "utf8", windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(!readFileSync(path).includes(Buffer.from(SECRET)));
  assert.ok(!child.stdout.includes(SECRET));
  assert.equal(resolveDpapiSecret("OPENAI_API_KEY", { secretRoot }), SECRET);
});

test("unsupported platform and unknown capability fail closed", async () => {
  assert.throws(() => createSecretBroker({ platform: "linux", secretRoot: "/tmp" }).credentialStatus("NOPE"), { code: SECRET_FAILURE.NOT_ALLOWED });
  assert.throws(() => resolveDpapiSecret("OPENAI_API_KEY", { platform: "linux", secretRoot: "/tmp" }), { code: SECRET_FAILURE.UNSUPPORTED });
});
