// Deterministic inventory for every executable repository surface that can read/inject OPENAI_API_KEY
// or construct the OpenAI Authorization header. Unknown executable occurrences fail closed in CI.
export const CREDENTIAL_PATH_CLASSIFICATION = Object.freeze({
  "docs/orchestration/lib/credentialPathAudit.mjs": "AUDIT_TOOLING",
  "docs/orchestration/lib/secretProvider.mjs": "AUTHORIZED BROKER PATH",
  "docs/orchestration/lib/openaiCredentialTransport.mjs": "AUTHORIZED BROKER PATH",
  // Intake brokered review — composes createOpenAICredentialTransport + broker.withCredential; never reads
  // OPENAI_API_KEY and never sees the key (it flows only into the injected invokeOpenAI callback).
  "docs/orchestration/lib/intakeReview.mjs": "AUTHORIZED BROKER PATH",
  // One governed baseline exchange runner — the OpenAI call goes through runBrokeredIntakeReview; the key
  // flows only through broker.withCredential into invokeOpenAI, never read from env here.
  "docs/orchestration/context/baseline-gpt-exchange.mjs": "AUTHORIZED BROKER PATH",
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
  // Sandbox Opportunity->Invoice E2E driver. Caught by the scan because it builds
  // `Authorization: \`Bearer ${token}\`` — but the token is a FIREBASE ID TOKEN from
  // idTokenFor(personaKey), used to call an onCall callable as a sandbox persona. It contains no
  // OpenAI reference of any kind, reads credentials only via loadSandboxPersona, never prints
  // them, and structurally refuses any project other than eos-platform-sandbox.
  //
  // CONDITIONAL: this classification only holds while the source has no OpenAI involvement
  // (see hasNoOpenAIInvolvement). Add OpenAI code to this file and it fails closed again.
  "functions/_e2e.mjs": "NON-OPENAI AUTH PATH",
});

/** Indicators that a source actually touches OpenAI, as opposed to merely building some Bearer header. */
export const OPENAI_INDICATOR = /OPENAI_API_KEY|api\.openai\.com|new\s+OpenAI\s*\(|createOpenAICredentialTransport|invokeOpenAI|openai/i;

/** True when the source has no OpenAI involvement at all. */
export const hasNoOpenAIInvolvement = (source = "") => !OPENAI_INDICATOR.test(source);

// NEITHER "AUDIT_TOOLING" NOR "NON-OPENAI AUTH PATH" IS A FILENAME EXEMPTION.
//
// A bare allowlist entry would permanently hide a file — including after someone later adds
// OpenAI code to it. Both classifications are therefore CONDITIONAL: the caller must supply
// independent verification of the current source, and without it they fail closed to
// UNSAFE/BYPASS. The allowlist records a judgement; the condition keeps that judgement true.
export function classifyCredentialPath(path, { auditToolingVerified = false, noOpenAIInvolvement = false } = {}) {
  if (/\.test\.mjs$|test-fixtures|fixtures/i.test(path)) return "TEST/FIXTURE";
  const declared = CREDENTIAL_PATH_CLASSIFICATION[path];
  if (declared === "AUDIT_TOOLING") return auditToolingVerified ? "AUDIT_TOOLING" : "UNSAFE/BYPASS";
  if (declared === "NON-OPENAI AUTH PATH") return noOpenAIInvolvement ? "NON-OPENAI AUTH PATH" : "UNSAFE/BYPASS";
  return declared || "UNSAFE/BYPASS";
}
