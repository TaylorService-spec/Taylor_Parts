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
const ACCESS_ID = "cf-access-client-id-test";
const ACCESS_SECRET = "cf-access-client-secret-test";

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
  evidence: [{ key: "opportunity-no-next-action", kind: "NO_NEXT_ACTION", summary: "No next action is recorded." }],
  allowedRecommendation: null,
  mode: "fast",
  ...over,
});

const remoteConfig = (over = {}) => ({
  endpoint: "https://ai-gateway.example.invalid",
  apiKey: API_KEY,
  tenantId: "tenant-1",
  accessClientId: ACCESS_ID,
  accessClientSecret: ACCESS_SECRET,
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
    assert.throws(() => assertOperationalEnvelope(bad), (error) => error instanceof OperationalAIError);
  }
});

test("empty fact or evidence fails before any provider call", () => {
  for (const bad of [
    envelope({ observedFact: "" }), envelope({ evidence: [] }),
    envelope({ evidence: [{ key: "", kind: "K", summary: "S" }] }),
  ]) {
    assert.throws(() => assertOperationalEnvelope(bad), (error) => error.code === "AI_OPERATIONAL_ENVELOPE_INVALID");
  }
});

test("remote ingress refuses plaintext and missing Access machine credentials", () => {
  for (const config of [
    remoteConfig({ endpoint: "http://ai-gateway.example.invalid" }),
    remoteConfig({ accessClientId: undefined }),
    remoteConfig({ accessClientSecret: undefined }),
  ]) {
    assert.throws(
      () => new KeystoneOperationalProvider(config),
      (error) => error.code === "AI_REMOTE_INGRESS_DENIED",
    );
  }
});

test("loopback development remains local and does not require Access credentials", () => {
  assert.doesNotThrow(() => new KeystoneOperationalProvider({
    endpoint: "http://127.0.0.1:8080", apiKey: API_KEY, tenantId: "tenant-1",
  }));
});

test("a name that merely resolves locally is still remote ingress", () => {
  // The local exemption recognizes an address, not a name. A resolver can point a hostname anywhere,
  // so a hostname is never evidence that the request stayed on this machine -- it must clear HTTPS
  // and Access credentials like any other remote endpoint.
  for (const endpoint of ["http://localhost:8080", "https://ai.internal.example.invalid"]) {
    assert.throws(
      () => new KeystoneOperationalProvider({ endpoint, apiKey: API_KEY, tenantId: "tenant-1" }),
      (error) => error.code === "AI_REMOTE_INGRESS_DENIED",
    );
  }
});

test("the whole loopback block is local, not one memorized address", () => {
  for (const endpoint of ["http://127.0.0.1:8080", "http://127.0.0.53:8080", "http://[::1]:8080"]) {
    assert.doesNotThrow(() => new KeystoneOperationalProvider({
      endpoint, apiKey: API_KEY, tenantId: "tenant-1",
    }));
  }
});

test("a denied recommendation cannot reach Keystone", async () => {
  let calls = 0;
  const provider = new KeystoneOperationalProvider(remoteConfig(), async () => { calls += 1; return okResponse(); });
  const denied = envelope({
    domain: "PARTS",
    allowedRecommendation: { actionId: "startPurchasing", label: "Start purchasing", authority: "DENIED" },
  });
  await assert.rejects(provider.interpret(denied), (error) => error.code === "AI_OPERATIONAL_ACTION_DENIED");
  assert.equal(calls, 0);
});

test("remote provider sends Cloudflare Access plus Keystone auth and only sanitized body", async () => {
  let seenUrl = "";
  let seenInit = null;
  const provider = new KeystoneOperationalProvider(remoteConfig(), async (url, init) => {
    seenUrl = url; seenInit = init; return okResponse();
  });
  const request = envelope();
  const result = await provider.interpret(request);
  assert.equal(result.confidence, "HIGH");
  assert.equal(seenUrl, "https://ai-gateway.example.invalid/v1/operational/interpret");
  assert.equal(seenInit.method, "POST");
  assert.equal(seenInit.headers["CF-Access-Client-Id"], ACCESS_ID);
  assert.equal(seenInit.headers["CF-Access-Client-Secret"], ACCESS_SECRET);
  assert.equal(seenInit.headers["X-API-Key"], API_KEY);
  assert.equal(seenInit.headers["X-Tenant-ID"], "tenant-1");
  assert.deepEqual(JSON.parse(seenInit.body), request);
  for (const secret of [API_KEY, ACCESS_ID, ACCESS_SECRET]) {
    assert.ok(!seenUrl.includes(secret));
    assert.ok(!seenInit.body.includes(secret));
  }
});

test("environment factory fails closed for a remote URL without Access credentials", () => {
  const environment = {
    KEYSTONE_GATEWAY_URL: "https://ai-gateway.example.invalid",
    KEYSTONE_GATEWAY_API_KEY: API_KEY,
    KEYSTONE_GATEWAY_TENANT_ID: "tenant-1",
  };
  assert.throws(
    () => operationalProviderFromEnvironment(environment),
    (error) => error.code === "AI_REMOTE_INGRESS_DENIED",
  );
});

test("environment factory accepts remote ingress only with Access credentials", () => {
  assert.ok(operationalProviderFromEnvironment({
    KEYSTONE_GATEWAY_URL: "https://ai-gateway.example.invalid",
    KEYSTONE_GATEWAY_API_KEY: API_KEY,
    KEYSTONE_GATEWAY_TENANT_ID: "tenant-1",
    KEYSTONE_ACCESS_CLIENT_ID: ACCESS_ID,
    KEYSTONE_ACCESS_CLIENT_SECRET: ACCESS_SECRET,
  }));
});

test("unconfigured means no provider and never a default endpoint", () => {
  assert.equal(operationalProviderFromEnvironment({}), null);
  assert.equal(operationalProviderFromEnvironment({ KEYSTONE_GATEWAY_URL: "https://x.invalid" }), null);
});

test("provider failures do not leak endpoint or credentials", async () => {
  const provider = new KeystoneOperationalProvider(remoteConfig({ endpoint: "https://secret-private-ai.invalid" }), async () => {
    throw new Error("ECONNREFUSED secret-private-ai.invalid");
  });
  await assert.rejects(provider.interpret(envelope()), (error) => {
    assert.equal(error.code, "AI_PROVIDER_UNAVAILABLE");
    for (const secret of ["secret-private-ai", API_KEY, ACCESS_ID, ACCESS_SECRET]) {
      assert.equal(error.message.includes(secret), false);
    }
    return true;
  });
});

test("browser bundle cannot address operational ingress or contain server credentials", () => {
  const files = collectFiles(CLIENT_SOURCE, [".js", ".jsx", ".ts", ".tsx"]);
  assert.ok(files.length > 0, "no client source was scanned");
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const forbidden of [
      "/v1/operational/interpret", "KEYSTONE_GATEWAY_URL", "KEYSTONE_GATEWAY_API_KEY",
      "KEYSTONE_ACCESS_CLIENT_ID", "KEYSTONE_ACCESS_CLIENT_SECRET", "CF-Access-Client-Secret", ":11434",
    ]) {
      assert.equal(text.includes(forbidden), false, `${file} exposes ${forbidden} to the browser`);
    }
  }
});

test("operational provider has no external AI fallback and no operational write path", () => {
  const source = readFileSync(join(REPO_ROOT, "functions", "src", "ai", "operationalProvider.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .toLowerCase();
  for (const forbidden of [
    "openai", "anthropic", "gemini", ":11434", "firestore()", ".set(", ".update(", ".delete(", ".create(",
  ]) {
    assert.equal(source.includes(forbidden), false, `operational provider contains ${forbidden}`);
  }
  assert.equal(source.includes("/v1/operational/interpret"), true);
});
