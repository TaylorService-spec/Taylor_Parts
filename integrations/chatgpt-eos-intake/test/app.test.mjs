import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.mjs";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const config = { resource: new URL("https://eos.example/mcp"), issuer: new URL("https://id.example/") };
const verifier = { verifyAccessToken: async (token) => {
  if (!["valid", "read-only"].includes(token)) throw new InvalidTokenError("invalid token");
  const scopes = token === "read-only" ? ["eos.intake.read"] : ["eos.intake.read", "eos.intake.submit", "eos.authorize_review"];
  return { token, clientId: "chatgpt", subject: "owner", scopes, expiresAt: Math.floor(Date.now() / 1000) + 60 };
} };
const store = {
  submit: async () => ({ branch: "eos-intake/eos-intake-002", pullRequest: 42, pullRequestUrl: "https://github.example/pull/42" }),
  status: async (requestId) => ({ pointer: `status://${requestId}`, requestId, status: "EOS_READY", authorizationState: "REPO_SAFE" }),
  result: async (requestId) => ({ pointer: `result://${requestId}`, requestId, status: "PENDING" }),
  authorizeReview: async (artifact) => ({ pointer: `authorization://${artifact.reviewId}`, location: artifact.artifactLocation, sha256: artifact.sha256, pullRequest: 43 }),
};

async function withServer(run) {
  const server = createApp({ config, verifier, store }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });
async function post(base, body, token = "valid") {
  return fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
}

test("publishes protected-resource metadata and rejects unauthenticated MCP", async () => withServer(async (base) => {
  const metadata = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.deepEqual(metadata.authorization_servers, ["https://id.example/"]);
  assert.deepEqual(metadata.scopes_supported, ["eos.intake.read", "eos.intake.submit", "eos.authorize_review"]);
  assert.equal((await post(base, rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }), "bad")).status, 401);
}));

test("MCP review authorization records authority only and exposes no credential action", async () => withServer(async (base) => {
  const list = await (await post(base, rpc("tools/list", {}))).json();
  const names = list.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("authorize_review"));
  assert.ok(!names.some((name) => /secret|credential|api_key/i.test(name)));
  const response = await post(base, rpc("tools/call", { name: "authorize_review", arguments: { workId: "EOS-INTAKE-002", reviewId: "REVIEW-790", maxSpendUsd: 0.25, sourceCommit: "a".repeat(40), provenance: "Owner via authenticated ChatGPT" } }));
  const body = await response.json();
  assert.equal(body.result.content[0].text, "authorization://REVIEW-790");
  assert.ok(!JSON.stringify(body).match(/sk-[A-Za-z0-9]/));
  const denied = await (await post(base, rpc("tools/call", { name: "authorize_review", arguments: { workId: "EOS-INTAKE-002", reviewId: "REVIEW-790", maxSpendUsd: 0.25, sourceCommit: "a".repeat(40), provenance: "Owner" } }), "read-only")).json();
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /eos\.authorize_review/);
}));

test("MCP status and result tools return only durable pointer text plus structured metadata", async () => withServer(async (base) => {
  for (const [name, pointer] of [["get_work_status", "status://EOS-INTAKE-002"], ["get_work_result", "result://EOS-INTAKE-002"]]) {
    const response = await post(base, rpc("tools/call", { name, arguments: { requestId: "EOS-INTAKE-002" } }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.content[0].text, pointer);
    assert.equal(body.result.structuredContent.pointer, pointer);
  }
}));

test("MCP submit returns work/status pointers and cannot authorize execution", async () => withServer(async (base) => {
  const args = { requestId: "EOS-INTAKE-002", title: "Intake", intent: "Integrate", scope: ["integrations/**"], contextScope: ["C-7"], provenance: "Owner ChatGPT", status: "EOS_READY", authorizationState: "REPO_SAFE", authorityBasis: "repo-safe" };
  const response = await post(base, rpc("tools/call", { name: "submit_work", arguments: args }));
  const body = await response.json();
  assert.equal(body.result.content[0].text, "work://EOS-INTAKE-002");
  assert.equal(body.result.structuredContent.status, "status://EOS-INTAKE-002");
  const denied = await (await post(base, rpc("tools/call", { name: "submit_work", arguments: { ...args, status: "EXECUTION_AUTHORIZED", authorizationState: "AUTHORIZED" } }))).json();
  assert.equal(denied.result.isError, true);
}));
