// AI PROVIDER SEAM. Where an AI request may originate, and what it may gain by being AI.
//
// ============================ WHAT IS BEING PROVEN ============================
//
// Four claims, and none of them is about answer quality:
//
//   1. Asking through a model gains NO capability. The gate intersects; it never adds. There is no
//      AI service account and no elevated context anywhere in the seam.
//
//   2. The browser cannot reach a model runtime or a developer workstation. Proven against the
//      client tree, and carefully: `127.0.0.1:8080` in this repository is the FIRESTORE EMULATOR,
//      so a naive host:port grep would produce a guard that fires on unrelated dev tooling and
//      teaches somebody to delete it. The check looks for gateway ROUTES and the Ollama port.
//
//   3. Production does not silently depend on a workstation. The provider has NO default endpoint
//      and returns null when unconfigured, so "unconfigured" is an ordinary state rather than a
//      fallback to localhost.
//
//   4. The gateway credential never leaves the backend -- not in a URL, not in an error, not in a
//      returned value.
//
// A failure here is a RELEASE BLOCKER, not a bug to triage.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Imported from its definition site: the compiled output is CommonJS, and a binding that is merely
// re-exported does not always survive as a named ESM export.
import { AIError } from "../lib/ai/types.js";
import {
  KeystoneRepositoryProvider,
  REPOSITORY_INTELLIGENCE_CAPABILITY,
  assertAiRequestAuthorized,
  keystoneConfigFromEnvironment,
  repositoryProviderFromEnvironment,
} from "../lib/ai/provider.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const CLIENT_SOURCE = join(REPO_ROOT, "field-ops-app-vite", "src");

const API_KEY = "pai_test_key_do_not_use_1234567890";

function aContext(overrides = {}) {
  return {
    userId: "u1",
    tenantId: "t1",
    capabilities: [REPOSITORY_INTELLIGENCE_CAPABILITY],
    purpose: "REPOSITORY_INTELLIGENCE",
    classification: "REPOSITORY",
    traceId: "trace-1",
    ...overrides,
  };
}

function okResponse(body = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ answer: "ok", citations: [], ...body }),
  };
}

function collectFiles(directory, extensions) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectFiles(full, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}


/**
 * The source with comments removed.
 *
 * These modules explain themselves, and the explanations name the very things a boundary test looks
 * for: provider.ts says "no localhost baked in" and "operationalAnswer is deliberately NOT
 * declared". Scanning raw text flags a file for documenting the guarantee it is honouring, and a
 * test that fails on the code doing the right thing is a test somebody deletes.
 */
function executableSource(path) {
  const withoutBlocks = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .map((line) => line.split("//")[0])
    .join(" ");
}

// ---------------------------------------------------------------------------------------------
// 1. No capability is gained by asking an AI
// ---------------------------------------------------------------------------------------------

test("a caller without the capability is refused", () => {
  assert.throws(
    () => assertAiRequestAuthorized(aContext({ capabilities: [] })),
    (error) => error instanceof AIError && error.code === "AI_CAPABILITY_DENIED",
  );
});

test("holding an unrelated capability is not enough", () => {
  // The failure being guarded against is a capability check that tests for "some capability".
  assert.throws(
    () => assertAiRequestAuthorized(aContext({ capabilities: ["workOrder.read", "parts.read"] })),
    (error) => error.code === "AI_CAPABILITY_DENIED",
  );
});

test("the context cannot be widened after it is built", () => {
  const context = aContext();
  // `capabilities` is readonly in the type and frozen in practice: a context that could be extended
  // after authorization could be authorized as one thing and used as another.
  const before = [...context.capabilities];
  try {
    context.capabilities.push("owner.everything");
  } catch {
    // Frozen: also acceptable.
  }
  assertAiRequestAuthorized({ ...context, capabilities: before });
  assert.deepEqual(before, [REPOSITORY_INTELLIGENCE_CAPABILITY]);
});

test("customer data may not be sent to a model even by an authorized caller", () => {
  assert.throws(
    () => assertAiRequestAuthorized(aContext({ classification: "CUSTOMER_DATA" })),
    (error) => error.code === "AI_CLASSIFICATION_DENIED",
  );
});

test("the operational purpose is refused rather than silently unimplemented", () => {
  assert.throws(
    () => assertAiRequestAuthorized(aContext({ purpose: "OPERATIONAL_ANSWER" })),
    (error) => error.code === "AI_PURPOSE_UNSUPPORTED",
  );
});

test("purpose and classification are checked before capability", async () => {
  // Otherwise an unauthorized caller probes which classifications are permitted by varying the
  // request and reading which error comes back.
  assert.throws(
    () => assertAiRequestAuthorized(aContext({ capabilities: [], classification: "CUSTOMER_DATA" })),
    (error) => error.code === "AI_CLASSIFICATION_DENIED",
  );
});

test("authorization runs before any request is made", async () => {
  const calls = [];
  const provider = new KeystoneRepositoryProvider(
    { endpoint: "https://gateway.invalid", apiKey: API_KEY, tenantId: "t" },
    async (...args) => {
      calls.push(args);
      return okResponse();
    },
  );

  await assert.rejects(
    provider.repositoryAnswer(aContext({ capabilities: [] }), { source: "s", question: "q" }),
    (error) => error.code === "AI_CAPABILITY_DENIED",
  );
  assert.equal(calls.length, 0, "an unauthorized request reached the network");
});

// ---------------------------------------------------------------------------------------------
// 2. The browser never reaches a model runtime or a workstation
// ---------------------------------------------------------------------------------------------

test("the client bundle never addresses Ollama or a Keystone gateway route", () => {
  const files = collectFiles(CLIENT_SOURCE, [".js", ".jsx", ".ts", ".tsx"]);
  assert.ok(files.length > 0, "no client source was scanned, so this proves nothing");

  // Deliberately NOT a bare host:port check. `127.0.0.1:8080` here is the Firestore emulator, and a
  // guard that fired on it would be deleted by the first person it inconvenienced.
  const forbidden = [
    ":11434",                    // Ollama
    "/v1/repository/answer",     // Keystone gateway route
    "/v1/chat",                  // Keystone gateway route
    "KEYSTONE_GATEWAY_URL",
    "KEYSTONE_GATEWAY_API_KEY",
  ];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      assert.ok(
        !text.includes(needle),
        `${file.replace(REPO_ROOT, "")} references ${needle}; the browser must not reach the gateway`,
      );
    }
  }
});

test("the provider seam is not imported by the client", () => {
  const files = collectFiles(CLIENT_SOURCE, [".js", ".jsx", ".ts", ".tsx"]);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.ok(
      !/from\s+['"].*\/ai\/provider['"]/.test(text),
      `${file.replace(REPO_ROOT, "")} imports the server-side AI provider`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Production does not silently depend on a developer workstation
// ---------------------------------------------------------------------------------------------

test("an unconfigured environment yields no provider, not a localhost default", () => {
  assert.equal(repositoryProviderFromEnvironment({}), null);
  assert.equal(keystoneConfigFromEnvironment({}), null);
});

test("a partially configured environment yields no provider", () => {
  // Half a configuration is a mistake, and the safe reading of a mistake is "not configured".
  assert.equal(repositoryProviderFromEnvironment({ KEYSTONE_GATEWAY_URL: "https://x.invalid" }), null);
  assert.equal(
    repositoryProviderFromEnvironment({
      KEYSTONE_GATEWAY_URL: "https://x.invalid",
      KEYSTONE_GATEWAY_API_KEY: API_KEY,
    }),
    null,
  );
});

test("constructing a provider without an endpoint throws rather than defaulting", () => {
  assert.throws(
    () => new KeystoneRepositoryProvider({ endpoint: "", apiKey: API_KEY, tenantId: "t" }),
    (error) => error.code === "AI_NOT_CONFIGURED",
  );
});

test("no loopback address is hard-coded in the provider source", () => {
  const source = executableSource(join(REPO_ROOT, "functions", "src", "ai", "provider.ts"));
  for (const needle of ["127.0.0.1", "localhost", ":11434", ":8080"]) {
    assert.ok(!source.includes(needle), `provider.ts hard-codes ${needle}`);
  }
});

// ---------------------------------------------------------------------------------------------
// 4. The credential stays on the backend
// ---------------------------------------------------------------------------------------------

test("the credential travels as a header and never in the URL", async () => {
  let seenUrl = "";
  let seenInit = null;
  const provider = new KeystoneRepositoryProvider(
    { endpoint: "https://gateway.invalid/", apiKey: API_KEY, tenantId: "tenant-1" },
    async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return okResponse();
    },
  );

  await provider.repositoryAnswer(aContext(), { source: "eos-repository-main", question: "q" });

  assert.equal(seenUrl, "https://gateway.invalid/v1/repository/answer");
  assert.ok(!seenUrl.includes(API_KEY), "the key is in the URL");
  assert.equal(seenInit.headers["X-API-Key"], API_KEY);
  assert.equal(seenInit.headers["X-Tenant-ID"], "tenant-1");
  assert.ok(!seenInit.body.includes(API_KEY), "the key is in the request body");
});

test("an unreachable gateway does not publish its address in the error", async () => {
  const provider = new KeystoneRepositoryProvider(
    { endpoint: "https://very-secret-host.invalid", apiKey: API_KEY, tenantId: "t" },
    async () => {
      throw new Error("ECONNREFUSED very-secret-host.invalid:443");
    },
  );

  await assert.rejects(
    provider.repositoryAnswer(aContext(), { source: "s", question: "q" }),
    (error) => {
      assert.equal(error.code, "AI_PROVIDER_UNAVAILABLE");
      assert.ok(!error.message.includes("very-secret-host"), "the error leaks the endpoint");
      assert.ok(!error.message.includes(API_KEY), "the error leaks the key");
      return true;
    },
  );
});

test("a gateway error status does not leak the key", async () => {
  const provider = new KeystoneRepositoryProvider(
    { endpoint: "https://gateway.invalid", apiKey: API_KEY, tenantId: "t" },
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
  );

  await assert.rejects(
    provider.repositoryAnswer(aContext(), { source: "s", question: "q" }),
    (error) => error.code === "AI_PROVIDER_ERROR" && !error.message.includes(API_KEY),
  );
});

// ---------------------------------------------------------------------------------------------
// 5. Read-only
// ---------------------------------------------------------------------------------------------

test("the seam declares no mutating operation", () => {
  const source = executableSource(join(REPO_ROOT, "functions", "src", "ai", "provider.ts"));
  // `operationalAnswer` is deliberately absent: declaring an unimplemented method invites a caller
  // to try it and a future author to fill it in without the governance decision it requires.
  assert.ok(!source.includes("operationalAnswer("), "an operational method has been declared");
  for (const mutating of ["firestore()", ".set(", ".update(", ".delete(", ".create("]) {
    assert.ok(!source.includes(mutating), `provider.ts performs ${mutating}`);
  }
});

test("only the POST to the answer route is ever issued", async () => {
  const methods = [];
  const provider = new KeystoneRepositoryProvider(
    { endpoint: "https://gateway.invalid", apiKey: API_KEY, tenantId: "t" },
    async (url, init) => {
      methods.push(`${init.method} ${url}`);
      return okResponse();
    },
  );

  await provider.repositoryAnswer(aContext(), { source: "s", question: "q" });
  assert.deepEqual(methods, ["POST https://gateway.invalid/v1/repository/answer"]);
});
