import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KeystoneOperationalProvider,
  OperationalAIError,
  assertOperationalEnvelope,
  operationalProviderFromEnvironment,
} from "../lib/ai/operationalProvider.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const CLIENT_SOURCE = join(REPO_ROOT, "field-ops-app-vite", "src");
const API_KEY = "private_ai_test_key_not_real";

const envelope = (over = {}) => ({
  schemaVersion: 1,
  classification: "SYNTHETIC",
  synthetic: true,
  source: "eos-platform-sandbox",
  domain: "OPPORTUNITY",
  subjectReference: null,
  observedFact: "EOS has established an attention condition.",
  deterministicInterpretation: null,
  deterministicBusinessConsequence: null,
  evidence: [
    { key: "opportunity-no-next-action", kind: "NO_NEXT_ACTION", summary: "No next action is recorded." },
  ],
  allowedRecommendation: null,
  mode: "fast",
  ...over,
});

const okResponse = (body = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    interpretation: "Review the governed condition.",
    businessConsequence: "The workflow may remain blocked.",
    confidence: "HIGH",
    confidenceBasis: "Grounded in EOS evidence.",
    evidenceRefs: ["opportunity-no-next-action"],
    recommendedActionId: null,
    ...body,
  }),
});

function collectFiles(directory, extensions) {
  const found = [];
  let entries;
  try { entries = readdirSync(directory); } catch { return found; }
  for (const entry of entries) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...collectFiles(full, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full);
  }
  return found;
}

test("only synthetic, reviewed domains may cross the transport", () => {
  assert.doesNotThrow(() => assertOperationalEnvelope(envelope()));

  for (const bad of [
    envelope({ classification: "CUSTOMER_DATA" }),
    envelope({ synthetic: false }),
    envelope({ domain: "UNREVIEWED_DOMAIN" }),
  ]) {
    assert.throws(
      () => assertOperationalEnvelope(bad),
      (error) => error instanceof OperationalAIError,
    );
  }
});

test("empty fact or evidence fails before any provider call", () => {
  for (const bad of [
    envelope({ observedFact: "" }),
    envelope({ evidence: [] }),
    envelope({ evidence: [{ key: "", kind: "K", summary: "S" }] }),
  ]) {
    assert.throws(
      () => assertOperationalEnvelope(bad),
      (error) => error.code === "AI_OPERATIONAL_ENVELOPE_INVALID",
    );
  }
});

test("a denied recommendation cannot reach Keystone", async () => {
  let calls = 0;
  const provider = new KeystoneOperationalProvider(
    { endpoint: "https://gateway.invalid", apiKey: API_KEY, tenantId: "tenant-1" },
    async () => {
      calls += 1;
      return okResponse();
    },
  );

  const denied = envelope({
    domain: "PARTS",
    allowedRecommendation: {
      actionId: "startPurchasing",
      label: "Start purchasing",
      authority: "DENIED",
    },
  });

  await assert.rejects(
    provider.interpret(denied),
    (error) => error.code === "AI_OPERATIONAL_ACTION_DENIED",
  );
  assert.equal(calls, 0);
});

test("the provider posts only the sanitized envelope to the shared operational route", async () => {
  let seenUrl = "";
  let seenInit = null;
  const provider = new KeystoneOperationalProvider(
    { endpoint: "https://gateway.invalid/", apiKey: API_KEY, tenantId: "tenant-1" },
    async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return okResponse();
    },
  );

  const request = envelope();
  const result = await provider.interpret(request);
  assert.equal(result.confidence, "HIGH");
  assert.equal(seenUrl, "https://gateway.invalid/v1/operational/interpret");
  assert.equal(seenInit.method, "POST");
  assert.equal(seenInit.headers["X-API-Key"], API_KEY);
  assert.equal(seenInit.headers["X-Tenant-ID"], "tenant-1");
  assert.deepEqual(JSON.parse(seenInit.body), request);
  assert.ok(!seenUrl.includes(API_KEY));
  assert.ok(!seenInit.body.includes(API_KEY));
});

test("unconfigured means no provider and never a localhost default", () => {
  assert.equal(operationalProviderFromEnvironment({}), null);
  assert.equal(operationalProviderFromEnvironment({ KEYSTONE_GATEWAY_URL: "https://x.invalid" }), null);
});

test("provider failures do not leak the endpoint or key", async () => {
  const provider = new KeystoneOperationalProvider(
    { endpoint: "https://secret-private-ai.invalid", apiKey: API_KEY, tenantId: "tenant-1" },
    async () => { throw new Error("ECONNREFUSED secret-private-ai.invalid"); },
  );

  await assert.rejects(provider.interpret(envelope()), (error) => {
    assert.equal(error.code, "AI_PROVIDER_UNAVAILABLE");
    assert.equal(error.message.includes("secret-private-ai"), false);
    assert.equal(error.message.includes(API_KEY), false);
    return true;
  });
});

test("the browser bundle cannot address the operational model route or gateway configuration", () => {
  const files = collectFiles(CLIENT_SOURCE, [".js", ".jsx", ".ts", ".tsx"]);
  assert.ok(files.length > 0, "no client source was scanned");
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const forbidden of [
      "/v1/operational/interpret",
      "KEYSTONE_GATEWAY_URL",
      "KEYSTONE_GATEWAY_API_KEY",
      ":11434",
    ]) {
      assert.equal(text.includes(forbidden), false, `${file} exposes ${forbidden} to the browser`);
    }
  }
});

test("the operational provider has no external fallback and no operational write path", () => {
  const source = readFileSync(join(REPO_ROOT, "functions", "src", "ai", "operationalProvider.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .toLowerCase();

  for (const forbidden of [
    "openai", "anthropic", "gemini", "localhost", "127.0.0.1", ":11434",
    "firestore()", ".set(", ".update(", ".delete(", ".create(",
  ]) {
    assert.equal(source.includes(forbidden), false, `operational provider contains ${forbidden}`);
  }
  assert.equal(source.includes("/v1/operational/interpret"), true);
});
