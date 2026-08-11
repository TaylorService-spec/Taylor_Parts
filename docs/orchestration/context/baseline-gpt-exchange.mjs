// ONE governed minimal-token Claude↔GPT baseline exchange. DRY by default (prints the plan, calls nothing);
// `--activate` performs exactly ONE real GPT review through the MERGED #790 Secret Broker path:
//   resolve the Owner-issued review authorization → build the fact-based invocation → broker.withCredential
//   (the ONLY secret boundary) → OpenAI Responses API → capture telemetry → persist result + exchange record.
// The API key is resolved inside withCredential and handed only to invokeOpenAI; it is never printed.
// Requires --activate AND OPENAI_REVIEW_MODEL AND the DPAPI credential AND a verified authorization artifact.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { sha256Bytes, buildContentAddressedResult } from "../lib/workIntake.mjs";
import { buildCanonicalReviewFeed, buildFactBasedInvocation, describeInvocation, reconcileTokens } from "../lib/reviewFeedInvocation.mjs";
import { runBrokeredIntakeReview, defaultEstimateSpendUsd } from "../lib/intakeReview.mjs";
import { createSecretBroker } from "../lib/secretProvider.mjs";
import { createFileSpendLedger } from "../lib/openaiCredentialTransport.mjs";
import { resolveReviewAuthorization } from "../lib/reviewAuthorization.mjs";
import { REVIEW_JSON_SCHEMA } from "./openai-review.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FACTS = "docs/orchestration/baseline/EOS-BASELINE-001.facts.json";
const AUTHZ = "docs/orchestration/work-intake/authorizations/EOS-BASELINE-001/REV-001.authorization.json";
const flag = (n) => process.argv.includes(`--${n}`);

function buildInvocation(model) {
  const facts = JSON.parse(readFileSync(join(REPO, FACTS), "utf8"));
  const feed = buildCanonicalReviewFeed({
    reviewId: facts.reviewId,
    question: facts.question,
    requirement: `${facts.requirement}\nCLAUDE POSITION (evaluate independently — do not merely agree): ${facts.claudePosition}`,
    sourceFacts: facts.sourceFacts,
    deterministicEvidence: facts.deterministicEvidence,
    implementationFacts: [`Existing governing decision state: ${facts.existingDecisionState}`, `Governing authority: ${facts.governingAuthority}`],
    rawEvidence: [`MATERIAL UNCERTAINTY: ${facts.materialUncertainty}`],
    provenance: { workId: facts.workId },
  });
  const built = buildFactBasedInvocation({ feed, model, schema: REVIEW_JSON_SCHEMA });
  return { facts, built };
}

// Real OpenAI Responses transport. apiKey comes ONLY from broker.withCredential; never logged.
async function invokeOpenAI({ apiKey, invocation }) {
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: invocation.model, input: invocation.messages, max_output_tokens: invocation.maxOutputTokens, text: { format: REVIEW_JSON_SCHEMA } }),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) return { ok: false, error: `status ${res.status}`, usage: { latencyMs } };
  const data = await res.json();
  let text = data.output_text; if (!text && Array.isArray(data.output)) for (const it of data.output) for (const c of (it.content || [])) if (c.type === "output_text" && c.text) text = c.text;
  let review; try { review = JSON.parse(text); } catch { return { ok: false, error: "non-JSON content", usage: { latencyMs } }; }
  return { ok: true, review, usage: { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null, cachedInputTokens: data.usage?.input_tokens_details?.cached_tokens ?? null, reasoningTokens: data.usage?.output_tokens_details?.reasoning_tokens ?? null, totalTokens: data.usage?.total_tokens ?? null, latencyMs } };
}

const disposition = (v) => ({ CONCUR: "CONCURRED", CONCUR_WITH_CORRECTION: "CORRECTION_ACCEPTED", EVIDENCE_REQUIRED: "EVIDENCE_REQUIRED", NONCONCUR_ESCALATE: "DISAGREEMENT_UNRESOLVED", NEEDS_OWNER: "OWNER_DECISION_REQUIRED" }[v] || "UNKNOWN");

async function main() {
  const model = process.env.OPENAI_REVIEW_MODEL || "";
  const { facts, built } = buildInvocation(model || "MODEL_UNSET");
  const workArtifactSha256 = sha256Bytes(readFileSync(join(REPO, FACTS)));

  if (!flag("activate")) {
    process.stdout.write(JSON.stringify({ mode: "DRY", workId: facts.workId, reviewId: facts.reviewId, model: model || null, workArtifactSha256, authorizationExpected: AUTHZ, requestDiagnostic: describeInvocation(built.invocation), tokenBreakdown: built.breakdown, note: "DRY only — no GPT call. `--activate` runs ONE governed exchange (requires OPENAI_REVIEW_MODEL + DPAPI credential + the Owner-issued authorization at the path above)." }, null, 2) + "\n");
    process.exit(0);
  }

  if (!model) { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "OPENAI_REVIEW_MODEL_UNSET" }, null, 2) + "\n"); process.exit(1); }
  // Resolve the Owner-issued authorization (hash-verified, unexpired) → into the verified set the broker trusts.
  let authorization;
  try {
    const bytes = readFileSync(join(REPO, AUTHZ));
    const a = JSON.parse(bytes);
    authorization = resolveReviewAuthorization({ workId: a.workId, reviewId: a.reviewId, sourceCommit: a.sourceCommit, workArtifactSha256: a.workArtifactSha256, location: a.artifactLocation, sha256: a.sha256, bytes });
    if (authorization.workArtifactSha256 !== workArtifactSha256) throw new Error(`authorization workArtifactSha256 does not bind the actual facts artifact (${authorization.workArtifactSha256} != ${workArtifactSha256})`);
  } catch (e) { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "AUTHORIZATION_INVALID_OR_MISSING", reason: e.message }, null, 2) + "\n"); process.exit(1); }

  const broker = createSecretBroker();
  const spendLedger = createFileSpendLedger({ path: join(process.env.LOCALAPPDATA || REPO, "EOS", "spend-ledger.json"), fs: { readFileSync, writeFileSync } });
  const started = Date.now();
  const review = await runBrokeredIntakeReview({
    request: { requestId: facts.workId, reviewClass: "INDEPENDENT_AI", reviewerRole: "independent-review", selectedModel: model },
    invocation: built.invocation, authorization, broker, spendLedger, invokeOpenAI,
    estimateSpendUsd: defaultEstimateSpendUsd,
  });
  const endToEndMs = Date.now() - started;

  if (!review.ok) { process.stdout.write(JSON.stringify({ mode: "ACTIVATE", ok: false, stopped: "REVIEW_FAILED", failureKind: review.failureKind || null, reason: review.reason || null }, null, 2) + "\n"); process.exit(1); }

  // Consume: persist a content-addressed result + a compact exchange record. Determine disposition.
  const verdict = review.result.verdict;
  const outcome = disposition(verdict);
  const content = { workId: facts.workId, reviewId: facts.reviewId, question: facts.question, claudePosition: facts.claudePosition, governingAuthority: facts.governingAuthority, existingDecisionState: facts.existingDecisionState, gptVerdict: verdict, gptConclusion: review.result.conclusion, gptCorrections: review.result.corrections, gptEvidenceRefs: review.result.evidenceRefs, disposition: outcome, usage: review.usage };
  const request = { requestId: facts.workId, sha256: workArtifactSha256, relatedRefs: { issues: [], pullRequests: [] } };
  const result = buildContentAddressedResult({ request, outputBytes: Buffer.from(JSON.stringify(content, null, 2), "utf8"), status: "COMPLETE", summary: `GPT ${verdict} → ${outcome} on ${facts.workId}`, createdAt: new Date().toISOString() });
  const exchangeDir = join(REPO, "docs/orchestration/baseline");
  mkdirSync(join(REPO, dirname(result.contentLocation)), { recursive: true });
  writeFileSync(join(REPO, result.contentLocation), result.content);
  writeFileSync(join(REPO, result.manifestLocation), `${JSON.stringify(result.manifest, null, 2)}\n`);
  writeFileSync(join(exchangeDir, `${facts.workId}.exchange.json`), `${JSON.stringify({ ...content, resultRef: { location: result.manifestLocation, sha256: result.manifest.sha256 } }, null, 2)}\n`);

  const reconcile = reconcileTokens({ estimatedTotal: built.breakdown.totalEstimate, measuredInputTokens: review.usage.inputTokens || 0 });
  process.stdout.write(JSON.stringify({
    mode: "ACTIVATE", ok: true, verdict, disposition: outcome,
    gpt: { model, inputTokens: review.usage.inputTokens, cachedInputTokens: review.usage.cachedInputTokens, outputTokens: review.usage.outputTokens, reasoningTokens: review.usage.reasoningTokens, totalTokens: review.usage.totalTokens, latencyMs: review.usage.latencyMs },
    estimatedInputTokens: built.breakdown.totalEstimate, tokenReconciliation: reconcile, endToEndMs,
    result: { location: result.manifestLocation, sha256: result.manifest.sha256 }, exchange: `docs/orchestration/baseline/${facts.workId}.exchange.json`,
    conclusion: review.result.conclusion,
  }, null, 2) + "\n");
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
