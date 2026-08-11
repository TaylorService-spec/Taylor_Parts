import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanonicalReviewFeed, buildFactBasedInvocation, describeInvocation } from "../lib/reviewFeedInvocation.mjs";
import { DEFAULT_PRICING_ESTIMATE, estimateCost, guardBudget, runOpenAIReview } from "../lib/openaiReviewProvider.mjs";
import { artifactRef, canonicalize, makeArtifact } from "../lib/reviewArtifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECURITY_PATHS = Object.freeze([
  "docs/orchestration/lib/secretProvider.mjs",
  "docs/orchestration/lib/secretProvider.test.mjs",
  "docs/orchestration/lib/openaiCredentialTransport.mjs",
  "docs/orchestration/lib/openaiCredentialTransport.test.mjs",
  "docs/orchestration/lib/reviewAuthorization.mjs",
  "integrations/chatgpt-eos-intake/src/auth.mjs",
  "integrations/chatgpt-eos-intake/src/app.mjs",
  "integrations/chatgpt-eos-intake/src/mcp.mjs",
  "integrations/chatgpt-eos-intake/src/githubStore.mjs",
  "integrations/chatgpt-eos-intake/test/app.test.mjs",
  "integrations/chatgpt-eos-intake/test/reviewAuthorization.test.mjs",
  "tools/eos-secrets/Set-EOSSecret.ps1",
]);

export const REVIEW_SCHEMA = {
  type: "json_schema", name: "eos_fact_review_result", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["CONCUR", "CONCUR_WITH_CORRECTION", "EVIDENCE_REQUIRED", "NEEDS_OWNER"] },
      conclusion: { type: "string" }, corrections: { type: "array", items: { type: "string" } },
      evidenceRefs: { type: "array", items: { type: "string" } }, ownerDecisionRequired: { type: "boolean" },
    },
    required: ["verdict", "conclusion", "corrections", "evidenceRefs", "ownerDecisionRequired"],
  },
};

function required(value, name, pattern = null) {
  const v = String(value || "").trim();
  if (!v || (pattern && !pattern.test(v))) throw new Error(`invalid ${name}`);
  return v;
}

export function parseReviewInputs(env = process.env) {
  const maxSpendUsd = Number(env.REVIEW_MAX_SPEND_USD);
  const prNumber = Number(env.REVIEW_PR_NUMBER);
  if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("invalid pr_number");
  if (!(maxSpendUsd > 0 && maxSpendUsd <= 0.25)) throw new Error("max_spend_usd must be > 0 and <= 0.25");
  return {
    reviewId: required(env.REVIEW_ID, "review_id", ID), repo: required(env.REVIEW_REPO, "repo", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    prNumber, expectedHeadSha: required(env.REVIEW_EXPECTED_HEAD_SHA, "expected_head_sha", SHA),
    question: required(env.REVIEW_QUESTION, "review_question"), profile: required(env.REVIEW_PROFILE, "review_profile", ID), maxSpendUsd,
    model: required(env.OPENAI_REVIEW_MODEL, "OPENAI_REVIEW_MODEL"),
  };
}

const git = (args, cwd = REPO_ROOT) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim();

export async function resolveExactSubject(inputs, { fetchJson, gitExec = null, subjectRoot = REPO_ROOT } = {}) {
  if (typeof fetchJson !== "function") throw new Error("GitHub metadata transport required");
  const runGit = gitExec || ((args) => git(args, subjectRoot));
  const pr = await fetchJson(`/repos/${inputs.repo}/pulls/${inputs.prNumber}`);
  if (!pr || pr.number !== inputs.prNumber) throw new Error("PR_NOT_FOUND");
  if (pr.head?.sha !== inputs.expectedHeadSha) throw new Error(`HEAD_MISMATCH expected ${inputs.expectedHeadSha} got ${pr.head?.sha || "missing"}`);
  const checkoutHead = runGit(["rev-parse", "HEAD"]);
  if (checkoutHead !== inputs.expectedHeadSha) throw new Error(`CHECKOUT_HEAD_MISMATCH expected ${inputs.expectedHeadSha} got ${checkoutHead}`);
  const changed = runGit(["diff", "--name-only", `${pr.base.sha}...${inputs.expectedHeadSha}`]).split(/\r?\n/).filter(Boolean);
  const material = SECURITY_PATHS.filter((p) => changed.includes(p));
  if (!material.length) throw new Error("SECURITY_FACTSET_EMPTY");
  const rawEvidence = material.map((path) => {
    const patch = runGit(["diff", "--unified=3", `${pr.base.sha}...${inputs.expectedHeadSha}`, "--", path]);
    return `FILE ${path}\n${patch.slice(0, 2400)}${patch.length > 2400 ? "\n...[bounded excerpt]" : ""}`;
  });
  return { pr, changed, material, rawEvidence, sourceFreshness: "CURRENT" };
}

export function buildSecurityFeed(inputs, subject) {
  if (inputs.profile !== "security-credential-boundary") throw new Error("unsupported review_profile");
  const factsContent = {
    implementationFacts: [
      `Exact subject: ${inputs.repo} PR #${inputs.prNumber} at ${inputs.expectedHeadSha}.`,
      "Review DPAPI CurrentUser storage; provisioning/retrieval; withCredential boundary; hash-verified authority; spend gates; MCP authorize_review; absence of secret export; leakage scanning; fail-closed behavior; bypass resistance.",
      `Material changed files supplied as bounded patches: ${subject.material.join(", ")}.`,
    ],
    sourceFacts: ["The reviewer grants no authority. Only the four declared verdicts are accepted.", "GitHub PR metadata and checkout HEAD independently matched the immutable expected SHA before invocation."],
    deterministicEvidence: ["sourceFreshness=CURRENT", `exact-head checks passed for base ${subject.pr.base.sha} and head ${subject.pr.head.sha}`, "The workflow runs the repository node:test suites before live invocation."],
    rawEvidence: subject.rawEvidence,
  };
  const baseFactsArtifact = makeArtifact({ kind: "facts", content: factsContent, sourceCommit: inputs.expectedHeadSha, provenance: { repo: inputs.repo, prNumber: inputs.prNumber } });
  const factsArtifact = Object.freeze({ ...baseFactsArtifact, location: `docs/orchestration/reviews/results/${inputs.reviewId}/${baseFactsArtifact.sha256}.facts.json` });
  const feed = buildCanonicalReviewFeed({
    reviewId: inputs.reviewId,
    question: inputs.question,
    requirement: "Judge whether credential use is confined to the trusted runtime and cannot bypass exact work authorization, budget/per-call gates, or leak raw secret material to an agent, logs, errors, or callback results.",
    ...factsContent,
    provenance: { repo: inputs.repo, prNumber: inputs.prNumber, sourceCommit: inputs.expectedHeadSha, sourceFreshness: "CURRENT", profile: inputs.profile },
    artifactRefs: [artifactRef(factsArtifact)],
  });
  return { feed, factsArtifact, factsContent };
}

export async function executeReview({ inputs, live = false, fetchJson, transport, gitExec, subjectRoot = REPO_ROOT, outputDir = null, clock = () => new Date().toISOString() }) {
  let providerCalls = 0;
  const subject = await resolveExactSubject(inputs, { fetchJson, gitExec, subjectRoot });
  const { feed, factsArtifact, factsContent } = buildSecurityFeed(inputs, subject);
  const built = buildFactBasedInvocation({ feed, model: inputs.model, schema: REVIEW_SCHEMA, maxOutputTokens: 1500 });
  if (!built.ok || built.invocation.feedMode !== "FACT_BASED") throw new Error("FEED_MODE_NOT_FACT_BASED");
  const estimatedCostUsd = estimateCost({ inputTokens: built.breakdown.totalEstimate, outputTokens: built.invocation.maxOutputTokens, pricing: DEFAULT_PRICING_ESTIMATE });
  const budget = guardBudget({ estCostUsd: estimatedCostUsd, spentSoFarUsd: 0 });
  if (!budget.ok || estimatedCostUsd > inputs.maxSpendUsd) throw new Error("REVIEW_BUDGET_REFUSED");
  const diagnostic = describeInvocation(built.invocation);
  if (!live) return { mode: "DRY_RUN", wouldInvoke: true, providerCalls, feedMode: "FACT_BASED", subject: { repo: inputs.repo, prNumber: inputs.prNumber, headSha: inputs.expectedHeadSha }, diagnostic, tokenBreakdown: built.breakdown, estimatedCostUsd };
  if (typeof transport !== "function") throw new Error("LIVE_TRANSPORT_REQUIRED");
  const response = await runOpenAIReview({
    request: { requestId: inputs.reviewId, reviewClass: "INDEPENDENT_AI", reviewerRole: "independent-security-review", selectedModel: inputs.model },
    invocation: built.invocation, transport: async (inv) => { providerCalls += 1; if (inv.feedMode !== "FACT_BASED") throw new Error("FEED_MODE_NOT_FACT_BASED"); return transport(inv); },
    sourceFreshness: "CURRENT", contextPackageRef: null,
    provenance: { repo: inputs.repo, prNumber: inputs.prNumber, sourceCommit: inputs.expectedHeadSha, feedMode: "FACT_BASED" },
    triggerKind: "OWNER_AUTHORIZED_GITHUB_ACTION", timestamps: { requestedAt: clock(), triggeredAt: clock() }, clock,
  });
  if (!response.ok) throw new Error(`${response.failureKind || "REVIEW_FAILED"}: ${response.reason || "unknown"}`);
  const content = { reviewId: inputs.reviewId, reviewed: { repo: inputs.repo, prNumber: inputs.prNumber, headSha: inputs.expectedHeadSha }, feedMode: "FACT_BASED", sourceFreshness: "CURRENT", usage: response.usage, artifactRefs: [artifactRef(factsArtifact)], verdict: response.result.verdict, conclusion: response.result.conclusion, corrections: response.result.corrections, evidenceRefs: response.result.evidenceRefs, ownerDecisionRequired: response.result.ownerDecisionRequired, diagnostic };
  const baseArtifact = makeArtifact({ kind: "result", content, sourceCommit: inputs.expectedHeadSha, createdAt: clock(), provenance: content.reviewed });
  const artifact = Object.freeze({ ...baseArtifact, location: `docs/orchestration/reviews/results/${inputs.reviewId}/${baseArtifact.sha256}.result.json` });
  const dir = outputDir || REPO_ROOT;
  const path = join(dir, artifact.location); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(join(dir, factsArtifact.location), canonicalize(factsContent), "utf8"); writeFileSync(path, canonicalize(content), "utf8");
  return { mode: "LIVE", providerCalls, feedMode: "FACT_BASED", artifact, content };
}

async function githubFetch(path) {
  const token = process.env.GITHUB_TOKEN; if (!token) throw new Error("GITHUB_TOKEN_UNSET");
  const r = await fetch(`https://api.github.com${path}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } });
  if (!r.ok) throw new Error(`GITHUB_API_${r.status}`); return r.json();
}
async function openAITransport(invocation) {
  const key = process.env.OPENAI_API_KEY; if (!key) throw new Error("OPENAI_API_KEY_UNSET");
  const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: invocation.model, input: invocation.messages, max_output_tokens: invocation.maxOutputTokens, text: { format: REVIEW_SCHEMA } }) });
  if (!r.ok) return { ok: false, error: `status ${r.status}` }; const data = await r.json();
  let text = data.output_text; if (!text) for (const item of data.output || []) for (const c of item.content || []) if (c.type === "output_text") text = c.text;
  try { return { ok: true, review: JSON.parse(text), usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } }; } catch { return { ok: false, error: "non-JSON content" }; }
}

async function main() {
  try {
    const result = await executeReview({ inputs: parseReviewInputs(), live: process.argv.includes("--live"), fetchJson: githubFetch, transport: openAITransport, subjectRoot: process.env.REVIEW_SUBJECT_ROOT || REPO_ROOT });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (process.env.GITHUB_OUTPUT && result.artifact) writeFileSync(process.env.GITHUB_OUTPUT, `artifact_path=${dirname(result.artifact.location)}\nartifact_sha256=${result.artifact.sha256}\nverdict=${result.content.verdict}\n`, { flag: "a" });
  } catch (error) { process.stdout.write(JSON.stringify({ ok: false, wouldInvoke: false, reason: error.message }, null, 2) + "\n"); process.exit(1); }
}
if (fileURLToPath(import.meta.url) === process.argv[1]) main();
