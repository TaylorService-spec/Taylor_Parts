import test from "node:test";
import assert from "node:assert/strict";
import { GitHubArtifactStore } from "../src/githubStore.mjs";
import { buildIntake } from "../src/artifacts.mjs";
import { buildContentAddressedResult } from "../../../docs/orchestration/lib/workIntake.mjs";
import { buildReviewAuthorization } from "../../../docs/orchestration/lib/reviewAuthorization.mjs";

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const artifact = buildIntake({ requestId: "EOS-INTAKE-002", title: "Intake", intent: "Connect", scope: ["integrations/**"], contextScope: ["C-7"], provenance: "Owner", status: "EOS_READY", authorizationState: "REPO_SAFE", authorityBasis: "repo-safe", issueRefs: [] }, { subject: "owner", clientId: "chatgpt" }, "2026-08-10T12:00:00.000Z");

test("GitHub submit creates a content branch and pull request without another queue", async () => {
  const calls = [];
  const replies = [{ object: { sha: "base-sha" } }, { ref: "created" }, { content: { sha: "blob" }, commit: { sha: "artifact-commit" } }, { number: 42, html_url: "https://github.example/pull/42" }];
  const store = new GitHubArtifactStore({ owner: "o", repo: "r", token: "secret", fetchImpl: async (url, options) => { calls.push({ url, options }); return jsonResponse(replies.shift()); } });
  const result = await store.submit(artifact);
  assert.equal(result.pullRequest, 42);
  assert.equal(result.sourceCommit, "artifact-commit");
  assert.deepEqual(calls.map((call) => call.options.method || "GET"), ["GET", "POST", "PUT", "POST"]);
  const put = JSON.parse(calls[2].options.body);
  assert.equal(JSON.parse(Buffer.from(put.content, "base64")).sha256, artifact.sha256);
  assert.ok(!calls.some((call) => call.url.includes("issues")));
});

test("GitHub status resolves and verifies the merged exact artifact", async () => {
  const encoded = Buffer.from(JSON.stringify(artifact)).toString("base64");
  const store = new GitHubArtifactStore({ owner: "o", repo: "r", token: "secret", fetchImpl: async () => jsonResponse({ content: encoded, sha: "github-blob" }) });
  const value = await store.status(artifact.requestId);
  assert.equal(value.pointer, "status://EOS-INTAKE-002");
  assert.equal(value.sha256, artifact.sha256);
});

test("GitHub submit is idempotent for the same content-addressed request", async () => {
  const replies = [jsonResponse({ object: { sha: "base-sha" } }), jsonResponse({ message: "exists" }, 422), jsonResponse({ content: Buffer.from(JSON.stringify(artifact)).toString("base64"), sha: "blob" }), jsonResponse([{ number: 42, html_url: "https://github.example/pull/42", head: { sha: "artifact-commit" } }])];
  const store = new GitHubArtifactStore({ owner: "o", repo: "r", token: "secret", fetchImpl: async () => replies.shift() });
  const value = await store.submit(artifact);
  assert.equal(value.replayed, true);
  assert.equal(value.pullRequest, 42);
});

test("GitHub status remains available from the intake PR before merge", async () => {
  const encoded = Buffer.from(JSON.stringify(artifact)).toString("base64");
  const replies = [jsonResponse({ message: "not merged" }, 404), jsonResponse({ content: encoded, sha: "blob" }), jsonResponse([{ number: 42, html_url: "https://github.example/pull/42", state: "open", merged_at: null, head: { ref: `eos-intake/${artifact.requestId.toLowerCase()}` } }])];
  const store = new GitHubArtifactStore({ owner: "o", repo: "r", token: "secret", fetchImpl: async () => replies.shift() });
  const value = await store.status(artifact.requestId);
  assert.equal(value.pullRequest.state, "OPEN");
  assert.equal(value.pointer, "status://EOS-INTAKE-002");
});

test("GitHub result returns only a verified content-addressed pointer", async () => {
  const built = buildContentAddressedResult({ request: artifact, outputBytes: "done", summary: "Integrated", createdAt: "2026-08-10T13:00:00.000Z" });
  const fetchImpl = async (url) => url.includes("results%2F") || url.includes("results/EOS-INTAKE-002?")
    ? jsonResponse([{ name: "result.result.json", path: built.manifestLocation }])
    : jsonResponse({ content: Buffer.from(JSON.stringify(built.manifest)).toString("base64"), sha: "blob" });
  const store = new GitHubArtifactStore({ owner: "o", repo: "r", token: "secret", fetchImpl });
  const value = await store.result(artifact.requestId);
  assert.equal(value.pointer, "result://EOS-INTAKE-002");
  assert.equal(value.contentSha256, built.manifest.contentSha256);
  assert.equal(value.summary, "Integrated");
});

test("GitHub review authorization writes only a governed artifact branch and PR", async () => {
  const authorization = buildReviewAuthorization({ workId: "EOS-INTAKE-002", reviewId: "REVIEW-790", maxSpendUsd: 0.25, sourceCommit: "a".repeat(40), provenance: "Owner" }, { subject: "owner", clientId: "chatgpt" }, "2026-08-11T06:00:00.000Z");
  const calls = [];
  const replies = [{ object: { sha: "base" } }, { ref: "created" }, { commit: { sha: "authorization-commit" } }, { number: 43, html_url: "https://github.example/pull/43" }];
  const store = new GitHubArtifactStore({ owner: "o", repo: "r", token: "secret", fetchImpl: async (url, options) => { calls.push({ url, options }); return jsonResponse(replies.shift()); } });
  const result = await store.authorizeReview(authorization);
  assert.equal(result.pointer, "authorization://REVIEW-790");
  const written = JSON.parse(Buffer.from(JSON.parse(calls[2].options.body).content, "base64"));
  assert.equal(written.sha256, authorization.sha256);
  assert.ok(!/apiKey|secretValue/i.test(JSON.stringify(written)));
});
