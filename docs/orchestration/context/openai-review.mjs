// Thin ENTRY for the OpenAI INDEPENDENT_AI reviewer. DRY-RUN by default: it builds the invocation +
// cost estimate + budget check and prints them, invoking NOTHING. A real call requires BOTH `--live`
// AND `OPENAI_API_KEY` in the environment, and is the Owner's activation boundary — do not run it as
// part of repo-safe work.
//
// This file NEVER prints, logs, or stores the API key. The key is read from `process.env` ONLY inside
// the real transport, ONLY on `--live`, and is placed solely in the Authorization header — never
// echoed, never serialized into any output.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runOpenAIReview, buildReviewInvocation, estimateCost, guardBudget, DEFAULT_PRICING_ESTIMATE } from "../lib/openaiReviewProvider.mjs";
import { coldStart } from "./cold-start.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fb = null) => { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fb; };
const flag = (name) => process.argv.includes(`--${name}`);

// Strict structured-output schema for the review result (json_schema, additionalProperties:false, all
// required) — the current supported pattern for GPT-5.6; aligned to the #764 result fields (no scope
// expansion). `json_object` mode is legacy and intentionally NOT used.
const REVIEW_JSON_SCHEMA = {
  type: "json_schema",
  name: "eos_review_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["CONCUR", "CONCUR_WITH_CORRECTION", "NONCONCUR_ESCALATE", "EVIDENCE_REQUIRED", "NEEDS_OWNER"] },
      conclusion: { type: "string" },
      corrections: { type: "array", items: { type: "string" } },
      evidenceRefs: { type: "array", items: { type: "string" } },
      ownerDecisionRequired: { type: "boolean" },
    },
    required: ["verdict", "conclusion", "corrections", "evidenceRefs", "ownerDecisionRequired"],
  },
};

// The real transport — CURRENT OpenAI Responses API (POST /v1/responses) with strict structured output
// (text.format = json_schema). Reads the key at call time ONLY; injects it into Authorization; never
// logs it. The model comes from the validated invocation (concrete configured id — no fallback).
function makeRealTransport() {
  return async (invocation) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, error: "OPENAI_API_KEY not set" }; // value never printed
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, // key only here
      body: JSON.stringify({ model: invocation.model, input: invocation.messages, max_output_tokens: invocation.maxOutputTokens, text: { format: REVIEW_JSON_SCHEMA } }),
    });
    if (!res.ok) return { ok: false, error: `status ${res.status}` };
    const data = await res.json();
    // Responses API: prefer output_text; else walk output[].content[].text.
    let text = data.output_text;
    if (!text && Array.isArray(data.output)) {
      for (const item of data.output) for (const c of (item.content || [])) if (c.type === "output_text" && c.text) text = c.text;
    }
    let review; try { review = JSON.parse(text); } catch { return { ok: false, error: "non-JSON content" }; }
    return { ok: true, review, usage: { inputTokens: data.usage && data.usage.input_tokens, outputTokens: data.usage && data.usage.output_tokens } };
  };
}

// Bound the inlined governing-authority content so a live review stays under the per-review ceiling.
const MAX_CONTEXT_BYTES = 60000; // ≈ 15k tokens cap; governing authority is ~20k bytes today
function readGoverningAuthorityText(boot) {
  try {
    const gid = boot.package && boot.package.governingAuthority;
    const ref = [...(boot.package.required || []), ...(boot.package.onDemand || [])].find((r) => r.id === gid);
    if (!ref) return "";
    const full = readFileSync(join(here, "..", "..", "..", ref.retrievalPath), "utf8");
    return full.length > MAX_CONTEXT_BYTES ? full.slice(0, MAX_CONTEXT_BYTES) + "\n…(truncated to per-review budget)" : full;
  } catch { return ""; }
}

async function main() {
  const scope = (arg("scope") || "orchestration").split(",");
  const requestId = arg("request", "REVIEW-DRYRUN");
  const diffPath = arg("diff");
  const diff = diffPath ? readFileSync(diffPath, "utf8") : "(no diff supplied — dry-run)";
  const spentSoFarUsd = Number(arg("spent", "0")) || 0;

  // Minimum C-7 context package via the SAME cold-start path (no second context mechanism).
  const boot = coldStart({ id: requestId, scope });
  const contextPackage = boot.package;
  // Model comes ONLY from OPENAI_REVIEW_MODEL — NO fallback. Empty/placeholder → fail-closed downstream.
  const configuredModel = process.env.OPENAI_REVIEW_MODEL || "";
  const request = { requestId, reviewClass: "INDEPENDENT_AI", subject: arg("subject", `review ${requestId}`), reviewerRole: "independent-architecture-review", selectedModel: configuredModel, routedBackTo: arg("routedBackTo", "Orchestration") };
  // Inline the governing-authority content (bounded) so the estimate/payload are complete for a
  // stateless reviewer.
  const contextText = readGoverningAuthorityText(boot);

  const built = buildReviewInvocation({ request, contextPackage, diff, model: request.selectedModel, contextText });
  if (!built.ok) { process.stdout.write(JSON.stringify({ mode: flag("live") ? "LIVE" : "DRY_RUN", ok: false, failureKind: built.failureKind, reason: built.reason, wouldInvoke: false }, null, 2) + "\n"); process.exit(1); }
  const estCostUsd = estimateCost({ inputTokens: built.invocation.inputTokensEstimate, outputTokens: built.invocation.maxOutputTokens, pricing: DEFAULT_PRICING_ESTIMATE });
  const gate = guardBudget({ estCostUsd, spentSoFarUsd });

  if (!flag("live")) {
    // DRY-RUN: show what WOULD happen — no network, no key read. wouldInvoke is honest: it requires a
    // valid configured model AND a passing budget gate.
    process.stdout.write(JSON.stringify({
      mode: "DRY_RUN", reviewClass: request.reviewClass, contextSufficiency: contextPackage.sufficiency,
      governingAuthority: contextPackage.governingAuthority, modelConfigured: configuredModel || null, model: built.invocation.model,
      inlinedContextBytes: contextText.length, inputTokensEstimate: built.invocation.inputTokensEstimate,
      estCostUsd, budget: gate, pricingModel: DEFAULT_PRICING_ESTIMATE.model, pricingSource: DEFAULT_PRICING_ESTIMATE.source, wouldInvoke: gate.ok,
      note: "DRY-RUN only. No provider call. `--live` + OPENAI_API_KEY + a configured OPENAI_REVIEW_MODEL crosses the Owner activation boundary.",
    }, null, 2) + "\n");
    process.exit(gate.ok ? 0 : 1);
  }

  // LIVE — the Owner activation boundary. Only reached with explicit --live.
  const r = await runOpenAIReview({ request, contextPackage, diff, transport: makeRealTransport(), spentSoFarUsd });
  // Never print the key or headers; only the structured result + usage.
  process.stdout.write(JSON.stringify({ mode: "LIVE", ok: r.ok, failureKind: r.failureKind || null, reason: r.reason || null, result: r.result || null, usage: r.usage || null }, null, 2) + "\n");
  process.exit(r.ok ? 0 : 1);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) { main(); }
