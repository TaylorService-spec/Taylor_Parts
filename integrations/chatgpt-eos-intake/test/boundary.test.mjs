// THE INTEGRATION BOUNDARY. What this external surface is not allowed to do.
//
// ════════════════════ WHY THIS FILE EXISTS SEPARATELY ════════════════════
//
// The other tests in this directory prove that each tool does its job. This one proves the
// opposite kind of thing: that the boundary cannot acquire authority it was never given. Those are
// different failure modes and they fail at different times -- a feature test breaks when someone
// changes what a tool returns; this breaks when someone adds a tool, loosens an input, reaches for
// Firestore, or starts taking a company id from the caller.
//
// Everything here is offline. No network, no credential, no live service: the only `fetch` any of
// it sees is a local recorder, and the Firebase/company checks read this package's own source text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GitHubArtifactStore } from "../src/githubStore.mjs";
import { assertIntakeRequestId, intakeLocation, resultDirectory } from "../src/artifacts.mjs";
import { createIntakeMcpServer } from "../src/mcp.mjs";
import { SCOPES } from "../src/auth.mjs";
import { WORK_INTAKE_ID } from "../../../docs/orchestration/lib/workIntake.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const sourceFiles = readdirSync(SRC)
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => ({ name, text: readFileSync(join(SRC, name), "utf8") }));

// ── 1. NO BUSINESS DATA WRITE PATH ────────────────────────────────────────────────────────────────
//
// The census answer this test pins: this integration reaches GitHub and nothing else. It holds no
// Firestore handle, imports no Firebase module, and names no business collection. If that ever
// stops being true, the correct move is a governed EOS command -- not an import here.
test("the integration has no Firebase, no Firestore, and no business-collection write path", () => {
  const forbidden = [
    /\bfrom\s+["']firebase(-admin)?(\/[\w-]+)?["']/,
    /\brequire\(\s*["']firebase(-admin)?(\/[\w-]+)?["']\s*\)/,
    /\bgetFirestore\s*\(/,
    /\bfirestore\s*\(\s*\)/,
    /\bonCall\s*\(/,
    /\bcollection\s*\(\s*["']/,
  ];
  for (const { name, text } of sourceFiles) {
    for (const pattern of forbidden) {
      assert.ok(
        !pattern.test(text),
        `${name} matches ${pattern} -- this boundary may not write business data; use a governed EOS command`,
      );
    }
  }
});

// ── 2. NO CLIENT-SUPPLIED COMPANY AUTHORITY ───────────────────────────────────────────────────────
//
// The same discipline purchasing enforces with COMPANY_NOT_CLIENT_SUPPLIABLE, applied one layer
// further out. `operatingCompanyId` is never inferred and never accepted from a caller, so the
// cheapest enforcement is that no tool on this boundary declares an input that could carry one.
test("no MCP tool accepts an operating company, tenant, or actor identity from the caller", async () => {
  const server = createIntakeMcpServer({ store: {} });
  const tools = Object.entries(server._registeredTools ?? {});
  assert.ok(tools.length >= 4, "expected the registered intake tools to be introspectable");

  // NOTE `scope` is deliberately absent: on this contract it is the work's file scope, not an OAuth
  // scope. The names below are the ones that would carry AUTHORITY if a caller could set them.
  const forbiddenInput = /^(operatingCompanyId|companyId|company|operatingCompany|tenantId|tenant|actorUid|actor|uid|subject|principal|clientId|oauthScopes?|authenticatedSubject)$/i;
  for (const [name, tool] of tools) {
    for (const field of Object.keys(tool.inputSchema?.shape ?? tool.inputSchema ?? {})) {
      assert.ok(
        !forbiddenInput.test(field),
        `tool ${name} declares input "${field}" -- company and identity authority are resolved server-side, never supplied by the caller`,
      );
    }
  }
  // Provenance is bound from the VERIFIED token, not from the payload: prove the field a caller
  // could spoof simply is not read.
  assert.ok(
    sourceFiles.some(({ name, text }) => name === "artifacts.mjs" && /auth\.subject/.test(text) && !/input\.(authenticatedSubject|subject|operatingCompanyId)/.test(text)),
    "the authenticated subject must come from the verified token, never from tool input",
  );
});

// ── 3. ONE CANONICALIZATION, AND IT PINS EVERY TOOL ───────────────────────────────────────────────
//
// A boundary is only as pinned as its loosest tool. This fails when a tool is added or edited with
// an identifier input that is not the canonical work-intake rule.
test("every identifier input on every tool is the one canonical work-intake rule", async () => {
  const server = createIntakeMcpServer({ store: {} });
  const idFields = /^(requestId|workId|reviewId)$/;
  let checked = 0;
  for (const [name, tool] of Object.entries(server._registeredTools ?? {})) {
    const shape = tool.inputSchema?.shape ?? tool.inputSchema ?? {};
    for (const [field, schema] of Object.entries(shape)) {
      if (!idFields.test(field)) continue;
      checked += 1;
      for (const candidate of ["../../../../../../user", "eos-intake-002", "AB", "A#x", "A?ref=evil", "A/B"]) {
        assert.equal(
          schema.safeParse(candidate).success,
          false,
          `tool ${name} input "${field}" accepted the non-canonical identifier ${JSON.stringify(candidate)}`,
        );
      }
      assert.equal(schema.safeParse("EOS-INTAKE-002").success, true, `tool ${name} input "${field}" rejected a canonical identifier`);
    }
  }
  assert.equal(checked, 5, "expected exactly the five identifier inputs across submit_work, the two reads, and authorize_review");
});

test("the canonical rule is imported from the work-intake contract, never restated here", () => {
  for (const { name, text } of sourceFiles) {
    assert.ok(
      !/\[A-Z0-9\]\[A-Z0-9\._-\]\{2,79\}/.test(text),
      `${name} restates the work-intake identifier pattern -- import WORK_INTAKE_ID instead of copying it`,
    );
  }
  assert.equal(WORK_INTAKE_ID.test("EOS-INTAKE-002"), true);
  assert.equal(WORK_INTAKE_ID.test("../../x"), false);
});

// ── 4. AN UNPINNED IDENTIFIER NEVER BECOMES A REQUEST ──────────────────────────────────────────────
//
// The schema is the first gate; this is the second. The store is refused BEFORE it builds a path,
// so a caller reaching the store by any other route still cannot turn an id into a different
// GitHub resource, an unpinned ref, or an attacker-named branch.
test("a non-canonical requestId is refused before any GitHub request is made", async () => {
  const attempted = [];
  const store = new GitHubArtifactStore({
    owner: "o",
    repo: "r",
    token: "offline-test-placeholder",
    fetchImpl: async (url) => {
      attempted.push(String(url));
      return new Response("{}", { status: 500 });
    },
  });

  const hostile = [
    "../../../../../../user",   // escapes /contents/ entirely and names another API resource
    "..%2f..%2fuser",           // the same, percent-encoded
    "A#x",                      // drops ?ref= into a fragment: the read stops being ref-pinned
    "A?ref=evil",               // overrides the ref pin: reads an attacker-named branch
    "eos-intake-002",           // lowercase: a DIFFERENT artifact path from the canonical id
  ];
  for (const requestId of hostile) {
    await assert.rejects(() => store.status(requestId), /work-intake identifier/, `status(${requestId})`);
    await assert.rejects(() => store.result(requestId), /work-intake identifier/, `result(${requestId})`);
    assert.throws(() => intakeLocation(requestId), /work-intake identifier/);
    assert.throws(() => resultDirectory(requestId), /work-intake identifier/);
  }
  assert.deepEqual(attempted, [], `no request may leave this process for a non-canonical id; it attempted ${attempted.join(", ")}`);
});

test("a canonical requestId resolves only under the pinned work-intake path", () => {
  assert.equal(assertIntakeRequestId("EOS-INTAKE-002"), "EOS-INTAKE-002");
  assert.equal(intakeLocation("EOS-INTAKE-002"), "docs/orchestration/work-intake/EOS-INTAKE-002.work.json");
  assert.equal(resultDirectory("EOS-INTAKE-002"), "docs/orchestration/work-intake/results/EOS-INTAKE-002");
});

// ── 5. THE BOUNDARY STILL CANNOT SELF-GRANT ───────────────────────────────────────────────────────
//
// Restated as a boundary property rather than a feature: authentication proves who asked. It does
// not advance the authorization state, and no tool name on this surface may suggest it handles a
// credential.
test("no tool grants execution authority or names a credential action", async () => {
  const server = createIntakeMcpServer({ store: {} });
  for (const name of Object.keys(server._registeredTools ?? {})) {
    assert.ok(!/secret|credential|api_?key|token|deploy|merge/i.test(name), `tool ${name} names a credential or deployment action`);
  }
  for (const { name, text } of sourceFiles) {
    assert.ok(
      !/EXECUTION_AUTHORIZED\s*[",}]/.test(text) || name === "artifacts.mjs",
      `${name} mentions EXECUTION_AUTHORIZED outside the refusal in artifacts.mjs`,
    );
  }
});

// ── 6. THE CONTRACT IS PINNED ─────────────────────────────────────────────────────────────────────
//
// An external contract that can change without a test failing is not a contract, it is a current
// implementation. This is the snapshot: the tool names, every declared input, and the scope that
// gates each one. A ChatGPT workspace and an OAuth authorization server are configured against
// exactly these strings, so widening any of them is a deployment-visible change and has to be a
// deliberate edit HERE, with the version below moved, rather than a diff nobody had to look at.
test("the external tool contract is exactly what is published, or this fails", async () => {
  const server = createIntakeMcpServer({ store: {} });
  const actual = Object.fromEntries(
    Object.entries(server._registeredTools ?? {}).map(([name, tool]) => [
      name,
      Object.keys(tool.inputSchema?.shape ?? tool.inputSchema ?? {}).sort(),
    ]),
  );
  assert.deepEqual(actual, {
    submit_work: [
      "authorityBasis", "authorizationState", "contextScope", "intent", "issueRefs",
      "ownerQuestion", "protectedBoundary", "provenance", "requestId", "scope", "status", "title",
    ],
    get_work_status: ["requestId"],
    get_work_result: ["requestId"],
    authorize_review: [
      "expiresAt", "maxSpendUsd", "provenance", "reviewId", "sourceCommit", "workArtifactSha256", "workId",
    ],
  });

  // The server identity and version a client pins against.
  assert.equal(server.server.getVersion?.().name ?? "taylor-parts-chatgpt-eos-intake", "taylor-parts-chatgpt-eos-intake");

  // The scopes: three, separated, and no tool may quietly move to a weaker one.
  assert.deepEqual(Object.values(SCOPES).sort(), ["eos.authorize_review", "eos.intake.read", "eos.intake.submit"]);
  const mcpSource = sourceFiles.find(({ name }) => name === "mcp.mjs").text;
  for (const [tool, scope] of [
    ["submit_work", "SCOPES.submit"],
    ["get_work_status", "SCOPES.read"],
    ["get_work_result", "SCOPES.read"],
    ["authorize_review", "SCOPES.authorizeReview"],
  ]) {
    const body = mcpSource.slice(mcpSource.indexOf(`registerTool("${tool}"`));
    assert.ok(body.indexOf(`requireScope(extra, ${scope})`) > 0, `${tool} must be gated on ${scope}`);
    assert.ok(
      body.indexOf(`requireScope(extra, ${scope})`) < (body.indexOf('registerTool("', 1) === -1 ? body.length : body.indexOf('registerTool("', 1)),
      `${tool} must be gated on ${scope} within its own handler`,
    );
  }
});
