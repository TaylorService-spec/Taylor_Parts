import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCredentialPath, hasNoOpenAIInvolvement } from "./credentialPathAudit.mjs";

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
      classification: classifyCredentialPath(normalizedPath, {
        auditToolingVerified: !hasExecutableCredentialBehavior(source),
        noOpenAIInvolvement: hasNoOpenAIInvolvement(source),
      }),
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

test("governed EOS transport delegates credential resolution only to broker.withCredential, over a fixed capability allowlist", () => {
  const source = readFileSync(resolve(root, "docs/orchestration/lib/openaiCredentialTransport.mjs"), "utf8");
  // The capability passed to broker.withCredential is never a free-form/caller-influenced string — it is
  // validated against a fixed, source-verified allowlist (KNOWN_TRANSPORT_CAPABILITIES) before use.
  assert.match(source, /const KNOWN_TRANSPORT_CAPABILITIES = Object\.freeze\(\[\s*"OPENAI_REVIEW",\s*"OPENAI_PATCH_PRODUCER"\s*\]\)/);
  assert.match(source, /if \(!KNOWN_TRANSPORT_CAPABILITIES\.includes\(capability\)\) throw/);
  assert.match(source, /broker\.withCredential\(capability,/);
  assert.doesNotMatch(source, /process\.env|OPENAI_API_KEY|Authorization:\s*`Bearer/);
});

test("DEFECT GUARD: NON-OPENAI AUTH PATH is conditional, not a filename exemption", () => {
  const p = "functions/_e2e.mjs";
  // Holds only while the source has no OpenAI involvement.
  assert.equal(classifyCredentialPath(p, { noOpenAIInvolvement: true }), "NON-OPENAI AUTH PATH");
  // Add OpenAI code to that file and it fails closed again — the allowlist must never be able to
  // hide a real credential path just because the filename was blessed once.
  assert.equal(classifyCredentialPath(p, { noOpenAIInvolvement: false }), "UNSAFE/BYPASS");
  assert.equal(classifyCredentialPath(p), "UNSAFE/BYPASS", "defaults to fail-closed when unverified");
});

test("hasNoOpenAIInvolvement detects real OpenAI usage in its many forms", () => {
  assert.equal(hasNoOpenAIInvolvement("const t = `Bearer ${idToken}`"), true, "a plain Bearer header is not OpenAI");
  for (const src of [
    "process.env.OPENAI_API_KEY",
    "fetch('https://api.openai.com/v1/chat/completions')",
    "new OpenAI({ apiKey })",
    "createOpenAICredentialTransport()",
    "await invokeOpenAI(payload)",
  ]) {
    assert.equal(hasNoOpenAIInvolvement(src), false, `should detect: ${src}`);
  }
});

test("the real functions/_e2e.mjs genuinely has no OpenAI involvement", () => {
  // Verifies the CLAIM behind the classification against the actual file, so the comment in the
  // allowlist cannot quietly drift away from the source it describes.
  const source = readFileSync(resolve(root, "functions/_e2e.mjs"), "utf8");
  assert.equal(hasNoOpenAIInvolvement(source), true);
  assert.match(source, /Authorization:\s*`Bearer/, "and it does construct a Bearer header — that is why it is scanned");
});
