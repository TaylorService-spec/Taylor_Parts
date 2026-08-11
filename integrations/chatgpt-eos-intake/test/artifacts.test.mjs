import test from "node:test";
import assert from "node:assert/strict";
import { buildIntake } from "../src/artifacts.mjs";
import { resolveWorkIntake } from "../../../docs/orchestration/lib/workIntake.mjs";

const input = {
  requestId: "EOS-INTAKE-002", title: "Authenticated intake", intent: "Connect ChatGPT to EOS",
  scope: ["integrations/chatgpt-eos-intake/**"], contextScope: ["C-7"], provenance: "Owner-authored ChatGPT request",
  status: "EOS_READY", authorizationState: "REPO_SAFE", authorityBasis: "Owner authorized repo-safe build", issueRefs: [],
};
const auth = { subject: "owner-123", clientId: "chatgpt-client" };

test("buildIntake creates a resolvable hash-pinned artifact with authenticated provenance", () => {
  const artifact = buildIntake(input, auth, "2026-08-10T12:00:00.000Z");
  assert.equal(artifact.source.authenticatedSubject, "owner-123");
  assert.equal(artifact.artifactLocation, "docs/orchestration/work-intake/EOS-INTAKE-002.work.json");
  assert.equal(resolveWorkIntake({ requestId: artifact.requestId, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(artifact) }).sha256, artifact.sha256);
});

test("intake endpoint cannot self-grant execution authority", () => {
  assert.throws(() => buildIntake({ ...input, status: "EXECUTION_AUTHORIZED", authorizationState: "AUTHORIZED" }, auth), /cannot grant execution authority/);
});

test("OWNER_REQUIRED requires a durable Owner question", () => {
  assert.throws(() => buildIntake({ ...input, authorizationState: "OWNER_REQUIRED" }, auth), /ownerQuestion/);
});
