import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCredentialPath } from "./credentialPathAudit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function hasExecutableCredentialBehavior(source) {
  return /process\.env(?:\.|\[)|fetch\s*\(|new\s+OpenAI\s*\(|broker\.withCredential\s*\(|resolveDpapiSecret\s*\(|Authorization\s*:\s*[`'\"]Bearer|spawn(?:Sync)?\s*\(/.test(source);
}

test("every executable credential/provider occurrence is explicitly classified; none is UNSAFE/BYPASS", () => {
  const files = execFileSync("git", ["ls-files", "*.mjs", "*.ps1", ".github/workflows/*.yml"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const hits = files.filter((path) => /OPENAI_API_KEY|Authorization:\s*`Bearer|createOpenAICredentialTransport|invokeOpenAI/.test(readFileSync(resolve(root, path), "utf8")));
  assert.ok(hits.length > 0);
  const classified = hits.map((path) => {
    const normalizedPath = relative(root, resolve(root, path)).replaceAll("\\", "/");
    const source = readFileSync(resolve(root, path), "utf8");
    return {
      path: normalizedPath,
      classification: classifyCredentialPath(normalizedPath, { auditToolingVerified: !hasExecutableCredentialBehavior(source) }),
    };
  });
  assert.deepEqual(classified.filter((item) => item.classification === "UNSAFE/BYPASS"), []);
  assert.ok(classified.some((item) => item.classification === "AUTHORIZED BROKER PATH"));
  assert.ok(classified.some((item) => item.classification === "LEGACY ISOLATED PATH"));
  assert.ok(classified.some((item) => item.classification === "TEST/FIXTURE"));
  assert.ok(classified.some((item) => item.path === "docs/orchestration/lib/credentialPathAudit.mjs" && item.classification === "AUDIT_TOOLING"));
});

test("audit implementation is AUDIT_TOOLING only while it has no executable credential/provider behavior", () => {
  const path = "docs/orchestration/lib/credentialPathAudit.mjs";
  const source = readFileSync(resolve(root, path), "utf8");
  assert.equal(hasExecutableCredentialBehavior(source), false);
  assert.equal(classifyCredentialPath(path, { auditToolingVerified: true }), "AUDIT_TOOLING");
  assert.equal(hasExecutableCredentialBehavior(`${source}\nfetch('https://api.openai.com/v1/responses')`), true);
  assert.equal(classifyCredentialPath(path, { auditToolingVerified: false }), "UNSAFE/BYPASS");
});

test("unknown executable credential-use path remains fail-closed UNSAFE/BYPASS", () => {
  const source = "const key = process.env.OPENAI_API_KEY; fetch('https://api.openai.com/v1/responses', {headers:{Authorization: `Bearer ${key}`}});";
  assert.equal(hasExecutableCredentialBehavior(source), true);
  assert.equal(classifyCredentialPath("src/new-provider-bypass.mjs"), "UNSAFE/BYPASS");
});

test("known broker/runtime paths retain explicit classification", () => {
  assert.equal(classifyCredentialPath("docs/orchestration/lib/secretProvider.mjs"), "AUTHORIZED BROKER PATH");
  assert.equal(classifyCredentialPath("docs/orchestration/lib/openaiCredentialTransport.mjs"), "AUTHORIZED BROKER PATH");
});

test("governed EOS transport delegates credential resolution only to broker.withCredential", () => {
  const source = readFileSync(resolve(root, "docs/orchestration/lib/openaiCredentialTransport.mjs"), "utf8");
  assert.match(source, /broker\.withCredential\("OPENAI_REVIEW"/);
  assert.doesNotMatch(source, /process\.env|OPENAI_API_KEY|Authorization:\s*`Bearer/);
});
