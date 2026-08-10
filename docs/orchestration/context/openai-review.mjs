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

// The real transport. Reads the key at call time ONLY; injects it into Authorization; never logs it.
// The request/endpoint shape MUST be verified against current OpenAI API docs before the first live
// call (model id + endpoint may differ). Left minimal and off by default.
function makeRealTransport() {
  const model = process.env.OPENAI_REVIEW_MODEL || null;   // Owner sets the exact current model id
  return async (invocation) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, error: "OPENAI_API_KEY not set" }; // value never printed
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, // key only here
      body: JSON.stringify({ model: model || invocation.model, messages: invocation.messages, max_tokens: invocation.maxOutputTokens, response_format: { type: "json_object" } }),
    });
    if (!res.ok) return { ok: false, error: `status ${res.status}` };
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let review; try { review = JSON.parse(content); } catch { return { ok: false, error: "non-JSON content" }; }
    return { ok: true, review, usage: { inputTokens: data.usage && data.usage.prompt_tokens, outputTokens: data.usage && data.usage.completion_tokens } };
  };
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
  const request = { requestId, reviewClass: "INDEPENDENT_AI", subject: arg("subject", `review ${requestId}`), reviewerRole: "independent-architecture-review", selectedModel: process.env.OPENAI_REVIEW_MODEL || "gpt-mid-tier", routedBackTo: arg("routedBackTo", "Orchestration") };

  const built = buildReviewInvocation({ request, contextPackage, diff, model: request.selectedModel });
  if (!built.ok) { process.stdout.write(JSON.stringify({ mode: flag("live") ? "LIVE" : "DRY_RUN", ok: false, failureKind: built.failureKind, reason: built.reason }, null, 2) + "\n"); process.exit(1); }
  const estCostUsd = estimateCost({ inputTokens: built.invocation.inputTokensEstimate, outputTokens: built.invocation.maxOutputTokens, pricing: DEFAULT_PRICING_ESTIMATE });
  const gate = guardBudget({ estCostUsd, spentSoFarUsd });

  if (!flag("live")) {
    // DRY-RUN: show what WOULD happen — no network, no key read.
    process.stdout.write(JSON.stringify({
      mode: "DRY_RUN", reviewClass: request.reviewClass, contextSufficiency: contextPackage.sufficiency,
      governingAuthority: contextPackage.governingAuthority, inputTokensEstimate: built.invocation.inputTokensEstimate,
      estCostUsd, budget: gate, pricingSource: DEFAULT_PRICING_ESTIMATE.source, wouldInvoke: gate.ok,
      note: "DRY-RUN only. No provider call. `--live` + OPENAI_API_KEY crosses the Owner activation boundary.",
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
