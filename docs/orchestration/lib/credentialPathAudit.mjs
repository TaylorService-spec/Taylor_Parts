// Deterministic inventory for every executable repository surface that can read/inject OPENAI_API_KEY
// or construct the OpenAI Authorization header. Unknown executable occurrences fail closed in CI.
export const CREDENTIAL_PATH_CLASSIFICATION = Object.freeze({
  "docs/orchestration/lib/credentialPathAudit.mjs": "AUDIT_TOOLING",
  "docs/orchestration/lib/secretProvider.mjs": "AUTHORIZED BROKER PATH",
  "docs/orchestration/lib/openaiCredentialTransport.mjs": "AUTHORIZED BROKER PATH",
  "tools/eos-secrets/Set-EOSSecret.ps1": "AUTHORIZED BROKER PATH",
  "docs/orchestration/context/github-fact-review.mjs": "LEGACY ISOLATED PATH",
  "docs/orchestration/context/openai-review.mjs": "LEGACY ISOLATED PATH",
  "docs/orchestration/context/reciprocal-pilot.mjs": "LEGACY ISOLATED PATH",
  "docs/orchestration/context/taylor-benchmark.mjs": "LEGACY ISOLATED PATH",
  ".github/workflows/reciprocal-gpt-review.yml": "LEGACY ISOLATED PATH",
  "integrations/chatgpt-eos-intake/src/githubStore.mjs": "LEGACY ISOLATED PATH",
});

// AUDIT_TOOLING is not a filename exemption. The caller must independently verify that the
// source contains no executable credential/provider behavior; otherwise it fails closed.
export function classifyCredentialPath(path, { auditToolingVerified = false } = {}) {
  if (/\.test\.mjs$|test-fixtures|fixtures/i.test(path)) return "TEST/FIXTURE";
  if (CREDENTIAL_PATH_CLASSIFICATION[path] === "AUDIT_TOOLING") return auditToolingVerified ? "AUDIT_TOOLING" : "UNSAFE/BYPASS";
  return CREDENTIAL_PATH_CLASSIFICATION[path] || "UNSAFE/BYPASS";
}
