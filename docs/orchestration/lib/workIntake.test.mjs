import test from "node:test";
import assert from "node:assert/strict";
import {
  intakeDigest, resolveWorkIntake, validateWorkIntake, intakeToWorkItem,
  buildContentAddressedResult, workPointer, statusPointer, resultPointer,
} from "./workIntake.mjs";
import { validateAgentResult } from "./agentResult.mjs";
import { selectNextWorkIncludingResults } from "./resultConsumption.mjs";

function fixture(overrides = {}) {
  const base = {
    requestId: "EOS-INTAKE-001",
    title: "Governed intake bridge",
    intent: "Add a narrow durable ingress adapter.",
    scope: ["docs/orchestration/"],
    contextScope: ["orchestration"],
    source: { producer: "Owner/ChatGPT", provenance: "Owner-submitted work request", sourceRef: null },
    status: "EXECUTION_AUTHORIZED",
    authority: { authorizationState: "AUTHORIZED", basis: "Owner instruction", authorizedBy: "Owner", authorizedAt: "2026-08-10T00:00:00Z", protectedBoundary: null },
    artifactLocation: "docs/orchestration/work-intake/EOS-INTAKE-001.work.json",
    sha256: "0".repeat(64),
    createdAt: "2026-08-10T00:00:00Z",
    updatedAt: "2026-08-10T00:00:00Z",
    relatedRefs: { issues: [], pullRequests: [] },
    ...overrides,
  };
  return { ...base, sha256: intakeDigest(base) };
}

test("valid artifact resolves by exact ID + location + canonical hash", () => {
  const artifact = fixture();
  const resolved = resolveWorkIntake({ requestId: artifact.requestId, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: Buffer.from(JSON.stringify(artifact)) });
  assert.equal(resolved.requestId, artifact.requestId);
});

test("tampering fails closed", () => {
  const artifact = fixture();
  const tampered = { ...artifact, intent: "different" };
  assert.throws(() => resolveWorkIntake({ requestId: artifact.requestId, location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(tampered) }), /hash mismatch/);
});

test("ID mismatch fails closed", () => {
  const artifact = fixture();
  assert.throws(() => resolveWorkIntake({ requestId: "OTHER-001", location: artifact.artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(artifact) }), /requestId mismatch/);
});

test("location mismatch fails closed", () => {
  const artifact = fixture();
  assert.throws(() => resolveWorkIntake({ requestId: artifact.requestId, location: "docs/orchestration/work-intake/other.work.json", sha256: artifact.sha256, bytes: JSON.stringify(artifact) }), /location mismatch/);
});

test("EXECUTION_AUTHORIZED requires separate authorization", () => {
  const artifact = fixture({ authority: { authorizationState: "REPO_SAFE", basis: "scope", protectedBoundary: null } });
  assert.match(validateWorkIntake(artifact).join(" "), /requires authority.authorizationState AUTHORIZED/);
});

test("protected execution authorization fails validation", () => {
  const artifact = fixture({ authority: { authorizationState: "AUTHORIZED", basis: "scope", protectedBoundary: "production" } });
  assert.match(validateWorkIntake(artifact).join(" "), /cannot carry a protectedBoundary/);
});

test("OWNER_REQUIRED maps to the existing OWNER_DECISION selector state", () => {
  const artifact = fixture({ status: "EOS_READY", authority: { authorizationState: "OWNER_REQUIRED", basis: "multiple valid directions", ownerQuestion: "Choose A or B", protectedBoundary: null } });
  const item = intakeToWorkItem(artifact);
  assert.equal(item.state, "OWNER_DECISION");
  assert.equal(item.authorized, false);
});

test("earlier stages remain selector-visible but not Wake-authorized", () => {
  for (const status of ["DISCOVERY", "DESIGN_STAGING", "EOS_READY"]) {
    const artifact = fixture({ status, authority: { authorizationState: "REPO_SAFE", basis: "repo-safe", protectedBoundary: null } });
    const item = intakeToWorkItem(artifact);
    assert.equal(item.state, "READY");
    assert.equal(item.authorized, false);
  }
});

test("selector item keeps file surfaces separate from C-7 context scope", () => {
  const item = intakeToWorkItem(fixture());
  assert.deepEqual(item.scope, ["orchestration"]);
  assert.deepEqual(item.allowedSurfaces, ["docs/orchestration/"]);
});

test("owner-facing pointers have the fixed compact contract", () => {
  assert.equal(workPointer("EOS-1"), "work://EOS-1");
  assert.equal(statusPointer("EOS-1"), "status://EOS-1");
  assert.equal(resultPointer("EOS-1"), "result://EOS-1");
});

test("result output is content-addressed and compactly pointed", () => {
  const request = fixture();
  const result = buildContentAddressedResult({ request, outputBytes: "durable result", status: "COMPLETE", summary: "Done.", createdAt: "2026-08-10T01:00:00Z" });
  assert.match(result.contentLocation, /[0-9a-f]{64}\.content\.md$/);
  assert.match(result.manifestLocation, /[0-9a-f]{64}\.result\.json$/);
  assert.equal(result.manifest.pointer, "result://EOS-INTAKE-001");
  assert.equal(result.manifest.sourceWorkSha256, request.sha256);
  assert.deepEqual(validateAgentResult(result.manifest), []);
  const continuation = selectNextWorkIncludingResults([], [result.manifest], { registeredWorkstreams: ["EOS_INTAKE"] });
  assert.equal(continuation.decision, "RUN");
  assert.equal(continuation.item.resultId, result.manifest.resultId);
});

test("result summaries cannot become transcript dumps", () => {
  assert.throws(() => buildContentAddressedResult({ request: fixture(), outputBytes: "x", summary: "x".repeat(1201), createdAt: "2026-08-10T01:00:00Z" }), /1-1200/);
});

test("result content addressing is stable across Windows CRLF checkout text", () => {
  const args = { request: fixture(), status: "COMPLETE", summary: "Done.", createdAt: "2026-08-10T01:00:00Z" };
  const lf = buildContentAddressedResult({ ...args, outputBytes: "line one\nline two\n" });
  const crlf = buildContentAddressedResult({ ...args, outputBytes: "line one\r\nline two\r\n" });
  assert.equal(lf.manifest.contentSha256, crlf.manifest.contentSha256);
  assert.equal(lf.content.toString("utf8"), "line one\nline two\n");
});
