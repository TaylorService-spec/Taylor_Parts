// Deterministic inventory for every executable repository surface that can read/inject OPENAI_API_KEY
// or construct the OpenAI Authorization header. Unknown executable occurrences fail closed in CI.
export const CREDENTIAL_PATH_CLASSIFICATION = Object.freeze({
  "docs/orchestration/lib/credentialPathAudit.mjs": "AUDIT_TOOLING",
  "docs/orchestration/lib/secretProvider.mjs": "AUTHORIZED BROKER PATH",
  "docs/orchestration/lib/openaiCredentialTransport.mjs": "AUTHORIZED BROKER PATH",
  // Intake brokered review — composes createOpenAICredentialTransport + broker.withCredential; never reads
  // OPENAI_API_KEY and never sees the key (it flows only into the injected invokeOpenAI callback).
  "docs/orchestration/lib/intakeReview.mjs": "AUTHORIZED BROKER PATH",
  "tools/eos-secrets/Set-EOSSecret.ps1": "AUTHORIZED BROKER PATH",
  "docs/orchestration/context/github-fact-review.mjs": "LEGACY ISOLATED PATH",
  "docs/orchestration/context/openai-review.mjs": "LEGACY ISOLATED PATH",
  "docs/orchestration/context/reciprocal-pilot.mjs": "LEGACY ISOLATED PATH",
  "docs/orchestration/context/taylor-benchmark.mjs": "LEGACY ISOLATED PATH",
  // PR-790 evidence generator — an isolated one-off that reads GITHUB_TOKEN for the GitHub API only (no
  // OpenAI key, no broker bypass). Classified so the audit stays green (added by #795 without a class).
  "docs/orchestration/context/pr790-final-evidence.mjs": "LEGACY ISOLATED PATH",
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
