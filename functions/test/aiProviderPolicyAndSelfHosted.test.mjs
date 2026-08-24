// PROVIDER POLICY AND PRIVATE GATEWAY. The tests that decide whether self-hosted AI may be enabled.
//
// ============================ WHAT IS BEING PROVEN ============================
//
// Two claims, and neither is about answer quality:
//
//   1. A PRIVATE_ONLY request cannot reach an external provider. Not "does not today" -- cannot,
//      because the selection function has no parameter through which a failure could arrive, and
//      because no code path builds a second provider after the first one throws. Proven with a
//      factory spy that records EVERY provider ever constructed.
//
//   2. The gateway credential does not leave the backend. Proven by asserting the key string is
//      absent from every value the system hands to anything: config summaries, health results and
//      error messages.
//
// A failure in this file is a RELEASE BLOCKER, not a bug to triage.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { AiProviderError } from "../lib/assistant/aiProvider.js";
import {
  SelfHostedProvider, classifyGatewayStatus, gatewayModeForWorkload, GATEWAY_ROUTED_MODEL,
} from "../lib/assistant/selfHostedProvider.js";
import { AnthropicProvider, splitSystemPrompt } from "../lib/assistant/anthropicProvider.js";
import { OpenAiProvider } from "../lib/assistant/openAiProvider.js";
import {
  selectAiProvider, externalDisclosureIsPossible, PROVIDER_PRIVACY_CLASS,
} from "../lib/assistant/aiProviderPolicy.js";
import * as policyModule from "../lib/assistant/aiProviderPolicy.js";
import {
  resolveAvailableProviders, resolveGatewayTenantId, resolveProviderPolicyConfig,
  resolveRoutingPolicy, resolveSelfHostedConfig, redactedAiConfigSummary, buildAiProvider,
} from "../lib/assistant/aiProviderConfig.js";
import { runAiProviderDiagnostic } from "../lib/assistant/aiProviderDiagnostic.js";
import { buildAuditRecord, buildUsageRecord, FORBIDDEN_TELEMETRY_FIELDS } from "../lib/assistant/assistantTelemetry.js";

// The string the security half of this file is about. If it ever appears in something EOS hands
// out, the credential left the backend.
const GATEWAY_KEY = "SECRET-GATEWAY-KEY-DO-NOT-DISCLOSE";
const TENANT = "taylor-sandbox";

function gatewayEnv(overrides = {}) {
  return {
    AI_SELF_HOSTED_ENABLED: "true",
    AI_SELF_HOSTED_BASE_URL: "http://127.0.0.1:8080",
    AI_SELF_HOSTED_API_KEY: GATEWAY_KEY,
    AI_SELF_HOSTED_TENANT_ID: TENANT,
    ...overrides,
  };
}

/** A fetch spy that records the exact call and returns whatever the test asks for. */
function spyFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return responder(url, init);
  };
  impl.calls = calls;
  return impl;
}

function okGatewayResponse(overrides = {}) {
  const body = {
    request_id: "req-123",
    tenant_id: TENANT,
    model: "qwen14-32768",
    content: "Received.",
    prompt_tokens: 41,
    output_tokens: 7,
    queue_wait_ms: 12,
    total_duration_ms: 900,
    ...overrides,
  };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function statusResponse(status) {
  return { ok: false, status, json: async () => ({}), text: async () => "" };
}

function provider(fetchImpl, config = {}) {
  return new SelfHostedProvider({
    apiKey: GATEWAY_KEY, baseUrl: "http://127.0.0.1:8080", tenantId: TENANT, fetchImpl, ...config,
  });
}

const MESSAGES = [
  { role: "system", content: "instruction" },
  { role: "user", content: "question" },
];

// ---------------------------------------------------------------------------------------------
// 1. Provider normalization
// ---------------------------------------------------------------------------------------------

test("gateway response is normalised into the provider-neutral result shape", async () => {
  const fetchImpl = spyFetch(() => okGatewayResponse());
  const result = await provider(fetchImpl).respond({
    messages: MESSAGES, maxOutputTokens: 100, correlationId: "c1",
  });

  assert.equal(result.text, "Received.");
  assert.equal(result.usage.inputTokens, 41);
  assert.equal(result.usage.outputTokens, 7);
  assert.equal(result.metadata.provider, "selfHosted");
  // The model the GATEWAY routed to, not one EOS chose.
  assert.equal(result.metadata.model, "qwen14-32768");
  assert.equal(result.providerRequestId, "req-123");
  assert.equal(result.queueWaitMs, 12);
  assert.equal(typeof result.latencyMs, "number");
  assert.equal(result.truncated, false);
  // Nothing gateway-shaped leaks through: no snake_case field survives into EOS.
  for (const key of Object.keys(result)) assert.ok(!key.includes("_"), `raw gateway field leaked: ${key}`);
});

test("an absent queue wait is absent, not zero", async () => {
  const fetchImpl = spyFetch(() => okGatewayResponse({ queue_wait_ms: undefined }));
  const result = await provider(fetchImpl).respond({
    messages: MESSAGES, maxOutputTokens: 100, correlationId: "c1",
  });
  // Zero would read as "no wait" and hide a saturated queue in exactly the deployment that has one.
  assert.equal(result.queueWaitMs, undefined);
});

// ---------------------------------------------------------------------------------------------
// 2. Self-hosted request headers
// ---------------------------------------------------------------------------------------------

test("the gateway request carries the API key and tenant headers and hits /v1/chat", async () => {
  const fetchImpl = spyFetch(() => okGatewayResponse());
  await provider(fetchImpl).respond({ messages: MESSAGES, maxOutputTokens: 100, correlationId: "c1" });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, "http://127.0.0.1:8080/v1/chat");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["x-api-key"], GATEWAY_KEY);
  assert.equal(call.init.headers["x-tenant-id"], TENANT);
  // The key travels in the header and nowhere else -- never in the URL, never in the body.
  assert.ok(!call.url.includes(GATEWAY_KEY));
  assert.ok(!JSON.stringify(call.body).includes(GATEWAY_KEY));
});

test("EOS never talks to a model runtime directly -- only to the gateway", async () => {
  const fetchImpl = spyFetch(() => okGatewayResponse());
  await provider(fetchImpl).respond({ messages: MESSAGES, maxOutputTokens: 100, correlationId: "c1" });
  for (const call of fetchImpl.calls) {
    assert.ok(!/\/api\/(generate|chat|tags)\b/.test(call.url), `looks like a direct model runtime call: ${call.url}`);
    assert.ok(!call.url.includes(":11434"), "an Ollama port must never be reached from EOS");
  }
});

// ---------------------------------------------------------------------------------------------
// 3. The secret never reaches anything that hands data out
// ---------------------------------------------------------------------------------------------

test("no configuration summary, health result or error message contains the key", async () => {
  const env = gatewayEnv();

  const summary = redactedAiConfigSummary(env);
  assert.ok(!JSON.stringify(summary).includes(GATEWAY_KEY));
  // It reports THAT a key exists, never anything about the key itself.
  assert.equal(summary.selfHostedConfigured, true);
  assert.equal(summary.selfHostedTenantConfigured, true);
  for (const value of Object.values(summary)) {
    assert.ok(typeof value !== "string" || !value.includes(GATEWAY_KEY));
  }

  const health = await provider(spyFetch(() => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }))).health();
  assert.ok(!JSON.stringify(health).includes(GATEWAY_KEY));

  // A transport failure must throw OUR message: a raw fetch error can carry the request headers.
  const exploding = spyFetch(() => { throw new Error(`connect failed with header x-api-key: ${GATEWAY_KEY}`); });
  await assert.rejects(
    () => provider(exploding).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1" }),
    (err) => {
      assert.ok(err instanceof AiProviderError);
      assert.ok(!err.message.includes(GATEWAY_KEY), "the raw transport error leaked the key");
      return true;
    },
  );

  // And an HTTP failure message carries a status, not a credential.
  const failing = spyFetch(() => statusResponse(401));
  await assert.rejects(
    () => provider(failing).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1" }),
    (err) => !err.message.includes(GATEWAY_KEY),
  );
});

// ---------------------------------------------------------------------------------------------
// 4. Tenant identity
// ---------------------------------------------------------------------------------------------

test("the gateway tenant is resolved from trusted config and never from the caller", () => {
  // A browser-supplied company id cannot become the gateway tenant.
  assert.equal(resolveGatewayTenantId({ configured: TENANT, companyId: "attacker-supplied" }), TENANT);
  // Unset means UNSET -- there is no shared default tenant to fall into.
  assert.equal(resolveGatewayTenantId({ configured: null, companyId: "taylor" }), null);
  assert.equal(resolveSelfHostedConfig({}).tenantId, null);
});

test("a gateway with no tenant configured is not available and refuses loudly", async () => {
  assert.deepEqual(resolveAvailableProviders(gatewayEnv({ AI_SELF_HOSTED_TENANT_ID: "" })), []);

  const fetchImpl = spyFetch(() => okGatewayResponse());
  await assert.rejects(
    () => provider(fetchImpl, { tenantId: "" }).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1" }),
    (err) => err instanceof AiProviderError && err.code === "AUTH" && err.retryable === false,
  );
  // Nothing was sent. An unconfigured tenant must not produce an anonymous gateway call.
  assert.equal(fetchImpl.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// 5 + 6. Workload routing. EOS asks for thinking; the gateway picks the model.
// ---------------------------------------------------------------------------------------------

test("ROUTINE work routes to fast and REASONING work routes to deep", async () => {
  assert.equal(gatewayModeForWorkload("ROUTINE"), "fast");
  assert.equal(gatewayModeForWorkload("REASONING"), "deep");
  assert.equal(gatewayModeForWorkload(undefined), "fast", "an unspecified workload must not silently buy the expensive model");

  const fast = spyFetch(() => okGatewayResponse());
  await provider(fast).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1", workloadClass: "ROUTINE" });
  assert.equal(fast.calls[0].body.mode, "fast");

  const deep = spyFetch(() => okGatewayResponse());
  await provider(deep).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1", workloadClass: "REASONING" });
  assert.equal(deep.calls[0].body.mode, "deep");

  // No model id is ever sent by EOS: model selection belongs to the gateway.
  assert.equal(deep.calls[0].body.model, undefined);
  assert.equal(new SelfHostedProvider({ apiKey: "k", baseUrl: "http://x", tenantId: "t", fetchImpl: deep }).metadata.model, GATEWAY_ROUTED_MODEL);
});

test("the token ceiling and optional context limit are passed in the gateway's vocabulary", async () => {
  const fetchImpl = spyFetch(() => okGatewayResponse());
  await provider(fetchImpl).respond({
    messages: MESSAGES, maxOutputTokens: 256, correlationId: "c1", contextTokenLimit: 8192,
  });
  assert.equal(fetchImpl.calls[0].body.max_output_tokens, 256);
  assert.equal(fetchImpl.calls[0].body.num_ctx, 8192);

  const without = spyFetch(() => okGatewayResponse());
  await provider(without).respond({ messages: MESSAGES, maxOutputTokens: 256, correlationId: "c1" });
  assert.ok(!("num_ctx" in without.calls[0].body), "an unset context limit must be omitted, not sent as undefined");
});

// ---------------------------------------------------------------------------------------------
// 7-10. Gateway failure classification
// ---------------------------------------------------------------------------------------------

for (const [status, code, retryable] of [
  [401, "AUTH", false],
  [403, "AUTH", false],
  [429, "RATE_LIMITED", true],
  [503, "UNAVAILABLE", true],
  [400, "INVALID_REQUEST", false],
]) {
  test(`gateway HTTP ${status} is classified ${code}`, async () => {
    assert.equal(classifyGatewayStatus(status), code);
    const fetchImpl = spyFetch(() => statusResponse(status));
    await assert.rejects(
      () => provider(fetchImpl).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1" }),
      (err) => {
        assert.ok(err instanceof AiProviderError);
        assert.equal(err.code, code);
        assert.equal(err.retryable, retryable);
        // The HTTP status survives as a diagnostic so an operator can tell 401 from 403 without
        // reading the gateway's own logs -- but nothing branches on it.
        assert.equal(err.providerCode, String(status));
        return true;
      },
    );
  });
}

test("a busy gateway is a queue to wait for, never a reason to route elsewhere", async () => {
  const fetchImpl = spyFetch(() => statusResponse(503));
  await assert.rejects(
    () => provider(fetchImpl).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1" }),
    (err) => err.code === "UNAVAILABLE" && err.retryable === true,
  );
  // Exactly one attempt. A hidden retry loop hides the outage from telemetry.
  assert.equal(fetchImpl.calls.length, 1);
});

// ---------------------------------------------------------------------------------------------
// 11. Timeout
// ---------------------------------------------------------------------------------------------

test("a gateway that never answers produces TIMEOUT, not a hung request", async () => {
  const fetchImpl = spyFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  await assert.rejects(
    () => provider(fetchImpl).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1", timeoutMs: 25 }),
    (err) => {
      assert.ok(err instanceof AiProviderError);
      assert.equal(err.code, "TIMEOUT");
      assert.equal(err.retryable, true);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 12. Malformed gateway response
// ---------------------------------------------------------------------------------------------

test("a malformed success is a failure, not an empty answer", async () => {
  for (const body of [{ request_id: "r" }, { content: 42 }, { content: null }]) {
    const fetchImpl = spyFetch(() => ({ ok: true, status: 200, json: async () => body, text: async () => "" }));
    await assert.rejects(
      () => provider(fetchImpl).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1" }),
      (err) => err instanceof AiProviderError && err.code === "UNKNOWN" && err.retryable === false,
      `a response without text content must not be reported as a successful empty answer: ${JSON.stringify(body)}`,
    );
  }

  const notJson = spyFetch(() => ({
    ok: true, status: 200, json: async () => { throw new Error("bad json"); }, text: async () => "<html>",
  }));
  await assert.rejects(
    () => provider(notJson).respond({ messages: MESSAGES, maxOutputTokens: 10, correlationId: "c1" }),
    (err) => err instanceof AiProviderError && err.code === "UNKNOWN",
  );
});

// ---------------------------------------------------------------------------------------------
// 13-15. The policy boundary. The reason this package exists.
// ---------------------------------------------------------------------------------------------

const EXTERNAL_ONLY = { policy: "PRIVATE_ONLY", availableProviders: ["openai", "anthropic"] };

test("PRIVATE_ONLY selects the private provider and nothing else exists below it", () => {
  const withPrivate = selectAiProvider(
    { policy: "PRIVATE_ONLY", availableProviders: ["selfHosted", "openai"] },
    { dataClass: "EOS_BUSINESS_DATA" },
  );
  assert.equal(withPrivate.outcome, "SELECTED");
  assert.equal(withPrivate.providerId, "selfHosted");
  assert.equal(withPrivate.privacyClass, "PRIVATE");
});

test("PRIVATE_ONLY with no private provider is UNAVAILABLE, for every data class", () => {
  for (const dataClass of ["EOS_BUSINESS_DATA", "NON_BUSINESS_DIAGNOSTIC"]) {
    const decision = selectAiProvider(EXTERNAL_ONLY, { dataClass });
    // External providers are available and configured. It still refuses. Availability is not consent.
    assert.equal(decision.outcome, "UNAVAILABLE", `PRIVATE_ONLY leaked ${dataClass} to an external provider`);
    assert.equal(decision.reason, "PRIVATE_PROVIDER_UNAVAILABLE");
    assert.equal(externalDisclosureIsPossible(EXTERNAL_ONLY, dataClass), false);
  }
});

test("selection is failure-blind by construction", () => {
  // Called twice with identical configuration, as a caller "retrying after an outage" would. There
  // is no argument through which the outage could be expressed, so the answer cannot change.
  const first = selectAiProvider(EXTERNAL_ONLY, { dataClass: "EOS_BUSINESS_DATA" });
  const second = selectAiProvider(EXTERNAL_ONLY, { dataClass: "EOS_BUSINESS_DATA" });
  assert.deepEqual(first, second);

  // And no exported function offers to try providers in order. The absence is the feature.
  const forbidden = ["tryProviders", "withFallback", "selectWithFallback", "nextProvider", "failover", "selectAiProviderAfterFailure"];
  for (const name of forbidden) {
    assert.equal(policyModule[name], undefined, `a fallback entry point was added: ${name}`);
  }
});

test("PRIVATE_PREFERRED uses external only where the configuration already permitted that data class", () => {
  const base = {
    policy: "PRIVATE_PREFERRED",
    availableProviders: ["openai"],
    externallyPermittedDataClasses: ["NON_BUSINESS_DIAGNOSTIC"],
  };

  // Permitted in advance -> allowed.
  const permitted = selectAiProvider(base, { dataClass: "NON_BUSINESS_DIAGNOSTIC" });
  assert.equal(permitted.outcome, "SELECTED");
  assert.equal(permitted.providerId, "openai");
  assert.equal(permitted.reason, "EXTERNAL_PROVIDER_SELECTED_BY_POLICY");

  // Not permitted in advance -> refused, even though an external provider is right there and the
  // private one is down. The outage did not create the permission.
  const refused = selectAiProvider(base, { dataClass: "EOS_BUSINESS_DATA" });
  assert.equal(refused.outcome, "UNAVAILABLE");
  assert.equal(refused.reason, "EXTERNAL_USE_NOT_PERMITTED_FOR_DATA_CLASS");

  // Private available -> private wins regardless of what is permitted.
  const preferred = selectAiProvider({ ...base, availableProviders: ["openai", "selfHosted"] }, { dataClass: "NON_BUSINESS_DIAGNOSTIC" });
  assert.equal(preferred.providerId, "selfHosted");

  // Unconfigured permission list behaves exactly like PRIVATE_ONLY.
  const unconfigured = selectAiProvider({ policy: "PRIVATE_PREFERRED", availableProviders: ["openai"] }, { dataClass: "EOS_BUSINESS_DATA" });
  assert.equal(unconfigured.outcome, "UNAVAILABLE");
});

test("FRONTIER_ALLOWED selects an external provider intentionally and honours the preference", () => {
  const decision = selectAiProvider(
    { policy: "FRONTIER_ALLOWED", availableProviders: ["openai", "anthropic"], preferredExternalProvider: "anthropic" },
    { dataClass: "EOS_BUSINESS_DATA" },
  );
  assert.equal(decision.outcome, "SELECTED");
  assert.equal(decision.providerId, "anthropic");
  assert.equal(decision.privacyClass, "EXTERNAL");
});

test("no external provider is ever CONSTRUCTED when the policy prohibits it", async () => {
  // The strongest available form of the claim: a factory spy records every provider the run built.
  // If an external adapter is never constructed, no external call could have happened.
  const built = [];
  const result = await runAiProviderDiagnostic({
    policyConfig: EXTERNAL_ONLY,
    buildProvider: (id) => { built.push(id); throw new Error("must not be reached"); },
    correlationId: "diag-1",
  });
  assert.deepEqual(built, [], "an external provider was built under PRIVATE_ONLY");
  assert.equal(result.status, "PROVIDER_UNAVAILABLE");
  assert.equal(result.providerId, null);
  assert.equal(result.selectionReason, "PRIVATE_PROVIDER_UNAVAILABLE");
});

test("a private provider failure does not cause a second provider to be built", async () => {
  const built = [];
  const result = await runAiProviderDiagnostic({
    policyConfig: { policy: "PRIVATE_ONLY", availableProviders: ["selfHosted", "openai", "anthropic"] },
    buildProvider: (id) => {
      built.push(id);
      return {
        metadata: { provider: id, model: "m" },
        async respond() { throw new AiProviderError({ code: "UNAVAILABLE", provider: id, message: "gateway down" }); },
        async health() { return { healthy: false, provider: id, checkedAtMs: 0 }; },
      };
    },
    correlationId: "diag-2",
  });
  // Exactly one provider, and it is the private one. The outage produced a governed unavailable
  // result, not a quiet disclosure.
  assert.deepEqual(built, ["selfHosted"]);
  assert.equal(result.status, "PROVIDER_UNAVAILABLE");
  assert.equal(result.errorClass, "UNAVAILABLE");
  assert.equal(PROVIDER_PRIVACY_CLASS[result.providerId], "PRIVATE");
});

// ---------------------------------------------------------------------------------------------
// 16 + 17. The existing providers still behave as they did.
// ---------------------------------------------------------------------------------------------

test("OpenAI behaviour is unchanged when OpenAI is the selected provider", async () => {
  const fetchImpl = spyFetch(() => ({
    ok: true, status: 200,
    json: async () => ({
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }),
    text: async () => "",
  }));
  const result = await new OpenAiProvider({ apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl })
    .respond({ messages: MESSAGES, maxOutputTokens: 100, correlationId: "c1", workloadClass: "REASONING" });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(call.init.headers.authorization, "Bearer sk-test");
  assert.equal(call.body.model, "gpt-4o-mini");
  assert.equal(call.body.max_tokens, 100);
  // The new workload class is additive: it changes nothing for a provider that does not route on it.
  assert.equal(call.body.mode, undefined);
  assert.equal(result.text, "hello");
  assert.equal(result.metadata.provider, "openai");
  assert.equal(result.usage.inputTokens, 3);
});

test("Anthropic speaks the same contract, with the system prompt hoisted where it belongs", async () => {
  const fetchImpl = spyFetch(() => ({
    ok: true, status: 200,
    json: async () => ({
      id: "msg_1",
      content: [{ type: "text", text: "hi" }, { type: "thinking", text: "ignored" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 5, output_tokens: 1 },
    }),
    text: async () => "",
  }));
  const result = await new AnthropicProvider({ apiKey: "sk-ant", model: "claude-sonnet-4-20250514", fetchImpl })
    .respond({
      messages: [
        { role: "system", content: "one" },
        { role: "system", content: "two" },
        { role: "user", content: "q" },
      ],
      maxOutputTokens: 50, correlationId: "c1",
    });

  const [call] = fetchImpl.calls;
  assert.equal(call.init.headers["x-api-key"], "sk-ant");
  assert.equal(call.init.headers["anthropic-version"], "2023-06-01");
  // Every system turn survives. Keeping only the first would strip the permitted EOS facts out of
  // the prompt and leave the model answering from nothing.
  assert.equal(call.body.system, "one\n\ntwo");
  assert.deepEqual(call.body.messages, [{ role: "user", content: "q" }]);
  assert.equal(result.text, "hi", "only text blocks are joined");
  assert.equal(result.truncated, true);
  assert.equal(result.providerRequestId, "msg_1");
  assert.equal(result.metadata.provider, "anthropic");

  const split = splitSystemPrompt([{ role: "assistant", content: "a" }]);
  assert.equal(split.system, "");
  assert.deepEqual(split.turns, [{ role: "assistant", content: "a" }]);
});

// ---------------------------------------------------------------------------------------------
// 18. The frontend cannot supply provider credentials.
// ---------------------------------------------------------------------------------------------

test("provider credentials come from the trusted environment and from nowhere else", () => {
  // A caller-shaped object carrying keys is not an environment and is not consulted: configuration
  // is read from the trusted env passed by the server, so a request body has no path in.
  assert.deepEqual(resolveAvailableProviders({}), []);
  assert.equal(resolveRoutingPolicy({}), "PRIVATE_ONLY", "an unset policy must fail towards not disclosing");
  assert.deepEqual(resolveProviderPolicyConfig({}).externallyPermittedDataClasses, []);

  // A typo in the permission list is dropped rather than passed through.
  const typo = resolveProviderPolicyConfig(gatewayEnv({ AI_EXTERNAL_PERMITTED_DATA_CLASSES: "EOS_BUSINESS_DAT, NON_BUSINESS_DIAGNOSTIC" }));
  assert.deepEqual(typo.externallyPermittedDataClasses, ["NON_BUSINESS_DIAGNOSTIC"]);

  // Enablement is an exact-match opt-in.
  for (const value of ["TRUE", "1", "yes", "True", ""]) {
    assert.deepEqual(resolveAvailableProviders(gatewayEnv({ AI_SELF_HOSTED_ENABLED: value })), [], `"${value}" must not enable a disclosure boundary`);
  }
  assert.deepEqual(resolveAvailableProviders(gatewayEnv()), ["selfHosted"]);
  // Implemented but uncredentialed is NOT available.
  assert.deepEqual(resolveAvailableProviders(gatewayEnv({ AI_SELF_HOSTED_API_KEY: "  " })), []);
});

test("no AI provider credential or private gateway address appears in the client tree", () => {
  const clientSrc = join(process.cwd(), "..", "field-ops-app-vite", "src");
  const forbidden = [
    "AI_SELF_HOSTED_API_KEY", "AI_SELF_HOSTED_BASE_URL", "AI_SELF_HOSTED_TENANT_ID",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "api.anthropic.com", "api.openai.com", "127.0.0.1:8080",
  ];
  const offences = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      for (const needle of forbidden) if (text.includes(needle)) offences.push(`${full}: ${needle}`);
    }
  };
  walk(clientSrc);
  // The browser must reach a trusted EOS server and never a provider. A key that reached a Vite
  // bundle would be published to every user, and rotating it would be the only remedy.
  assert.deepEqual(offences, [], `provider configuration reached the client tree:\n${offences.join("\n")}`);
});

// ---------------------------------------------------------------------------------------------
// 19 + 20. Observability: enough metadata to operate, no content.
// ---------------------------------------------------------------------------------------------

test("the diagnostic records whether text arrived, never the text", async () => {
  const result = await runAiProviderDiagnostic({
    policyConfig: { policy: "PRIVATE_ONLY", availableProviders: ["selfHosted"] },
    buildProvider: () => provider(spyFetch(() => okGatewayResponse())),
    correlationId: "diag-3",
    tenantId: TENANT,
  });

  assert.equal(result.status, "OK");
  assert.equal(result.receivedText, true);
  assert.equal(result.providerId, "selfHosted");
  assert.equal(result.model, "qwen14-32768");
  assert.equal(result.workloadClass, "ROUTINE");
  assert.equal(result.tenantId, TENANT);
  assert.equal(result.queueWaitMs, 12);
  assert.equal(result.providerRequestId, "req-123");

  // Not one field that could hold a prompt or a response.
  const serialised = JSON.stringify(result);
  assert.ok(!serialised.includes("Received."), "the model's reply was recorded");
  assert.ok(!serialised.includes("Connectivity check"), "the prompt was recorded");
  for (const field of FORBIDDEN_TELEMETRY_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, field), false, `diagnostic result carries a forbidden field: ${field}`);
  }
});

test("self-hosted metadata records through the existing provider-neutral telemetry unchanged", () => {
  const audit = buildAuditRecord({
    correlationId: "c1", actorUid: "u1", companyId: "taylor", timestampMs: 1,
    surface: "diagnostic", route: "/selfcheck", recordRef: null,
    decisions: [], recordsAccessed: [],
    provider: "selfHosted", model: "qwen32-8k",
    usage: { inputTokens: 41, outputTokens: 7 },
    latencyMs: 900, outcome: "ANSWERED", errorClass: null,
  });
  const usage = buildUsageRecord(audit);

  assert.equal(usage.provider, "selfHosted");
  assert.equal(usage.model, "qwen32-8k");
  assert.equal(usage.inputTokens, 41);
  assert.equal(usage.outputTokens, 7);
  assert.equal(usage.latencyMs, 900);
  // No price was invented for a self-hosted model. Cost is carried only if an adapter supplied it.
  assert.equal(usage.estimatedCostUsd, undefined);
  for (const field of FORBIDDEN_TELEMETRY_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(audit, field), false);
    assert.equal(Object.prototype.hasOwnProperty.call(usage, field), false);
  }
});

test("the provider factory builds one adapter per id and never reads a key into its metadata", () => {
  const deps = { gatewayFetch: spyFetch(() => okGatewayResponse()), openAiFetch: spyFetch(() => okGatewayResponse()), anthropicFetch: spyFetch(() => okGatewayResponse()) };
  const built = buildAiProvider("selfHosted", gatewayEnv(), deps);
  assert.equal(built.metadata.provider, "selfHosted");
  assert.ok(!JSON.stringify(built.metadata).includes(GATEWAY_KEY));
  assert.equal(buildAiProvider("openai", { AI_OPENAI_ENABLED: "true", OPENAI_API_KEY: "k" }, deps).metadata.provider, "openai");
  assert.equal(buildAiProvider("anthropic", { AI_ANTHROPIC_ENABLED: "true", ANTHROPIC_API_KEY: "k" }, deps).metadata.provider, "anthropic");
});
