// Focused tests for the Cortex PATCH_PRODUCER mode (EOS-ISSUE-835).
//
// PATCH_PRODUCER is a second, tightly bounded Cortex mode: it may propose deterministic,
// hash-bound source patches ONLY for the project-keystone Control Center workstream, under
// approved Control Center paths, and only a matching Verifier PASS ever unlocks persistence of
// the proposed artifact. It never applies a patch, never touches Taylor_Parts, and never gains
// backlog/merge/deploy/routing/authorization capability. READ_ONLY_PILOT is unchanged.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAgentRequest } from "./agentRequest.mjs";
import { createAgentResult } from "./agentResult.mjs";
import { createVerificationRequest, deriveVerdict } from "./verifierAgent.mjs";
import {
  runReadOnlyProviderPilot,
  persistPilotResult,
  runCortexPatchProducer,
  persistPatchProducerResult,
  CORTEX_PILOT_MODE,
  CORTEX_PATCH_PRODUCER_MODE,
  KEYSTONE_PROJECT,
  KEYSTONE_REPO,
  CONTROL_CENTER_PATH_PREFIX,
} from "./cortexProviderAdapter.mjs";

const sha256 = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const clock = () => "2026-08-12T20:00:00Z";

const verificationFor = (req, run, verdict = "PASS", findings = []) => {
  const verificationRequest = createVerificationRequest({ requestId: `${req.requestId}-VERIFY`, workerRequest: req, workerResult: run.result });
  const verifierResult = createAgentResult({ resultId: `${req.requestId}-VR`, requestId: verificationRequest.requestId, routedBackTo: req.requestedByWorkstream, verdict, findings });
  return { verificationRequest, verifierResult };
};

// --- 1. READ_ONLY_PILOT remains byte/behavior compatible ------------------------------------------

const roRequest = () => createAgentRequest({ requestId: "CX-001", requestedByWorkstream: "EOS_INTAKE", purpose: "Read authoritative orchestration contract", allowedSurfaces: ["docs/orchestration/agent-manager.md"], outputContract: "evidence-backed findings", mutating: false });
const roBinding = { mode: CORTEX_PILOT_MODE, project: "Taylor_Parts", repo: "TaylorService-spec/Taylor_Parts", allowedSurfaces: ["docs/orchestration/agent-manager.md"], eligibleProviders: ["OPENAI"], eligibleModels: ["gpt-pilot"], maxCostUsd: 0.25 };
const roEnvelope = { requestId: "CX-001", project: roBinding.project, repo: roBinding.repo, provider: "OPENAI", model: "gpt-pilot", budget: { maxCostUsd: 0.10 }, capacity: { available: true, maxConcurrent: 1 } };
const roProviderRun = async () => ({ executionId: "exec-001", summary: "Contract confirmed.", findings: ["Agent Manager remains authoritative."], evidence: [{ path: "docs/orchestration/agent-manager.md" }], verdict: "PASS", metrics: { tokens: 42 }, mutated: false });

test("1. READ_ONLY_PILOT remains byte/behavior compatible after adding PATCH_PRODUCER", async () => {
  const run = await runReadOnlyProviderPilot({ request: roRequest(), binding: roBinding, envelope: roEnvelope, providerRun: roProviderRun, clock });
  assert.equal(run.ok, true);
  assert.equal(run.result.requestId, "CX-001");
  assert.equal(run.receipt.providerExecutionId, "exec-001");
  assert.match(run.durable.manifestLocation, /^docs\/orchestration\/work-intake\/results\/CX-001\/[a-f0-9]{64}\.result\.json$/);
  const { verificationRequest, verifierResult } = verificationFor(roRequest(), run);
  assert.equal(deriveVerdict(verifierResult), "PASS");
  const files = new Map();
  const persisted = persistPilotResult({ request: roRequest(), result: run.result, durable: run.durable, verificationRequest, verifierResult, store: { write: (path, bytes) => files.set(path, bytes) } });
  assert.equal(files.size, 2);
  assert.equal(persisted.sha256, run.durable.manifest.sha256);
  const replay = await runReadOnlyProviderPilot({ request: roRequest(), binding: roBinding, envelope: roEnvelope, providerRun: roProviderRun, clock });
  assert.equal(replay.durable.manifest.sha256, run.durable.manifest.sha256);
});

// --- PATCH_PRODUCER fixtures ------------------------------------------------------------------

const patchPath = `${CONTROL_CENTER_PATH_PREFIX}adapter-notes.md`;
const patchContent = "# Control Center Adapter Notes\n\nProposed by the Cortex PATCH_PRODUCER pilot.\n";
const patchContentSha256 = sha256(patchContent);

const patchRequest = (overrides = {}) => createAgentRequest({
  requestId: "CX-PATCH-001",
  requestedByWorkstream: "EOS_INTAKE",
  purpose: "Propose a governed Control Center adapter-notes patch",
  allowedSurfaces: [patchPath],
  outputContract: "deterministic hash-bound patch entries plus evidence/receipt metadata",
  mutating: true,
  ...overrides,
});
const patchBinding = { mode: CORTEX_PATCH_PRODUCER_MODE, project: KEYSTONE_PROJECT, repo: KEYSTONE_REPO, allowedSurfaces: [patchPath], eligibleProviders: ["OPENAI"], eligibleModels: ["gpt-patch"], maxCostUsd: 0.5 };
// A governed grant authorizing PATCH_PRODUCER — never self-selected by the request (executionProfiles.mjs).
const authorizedPatchProducerGrant = { requestedProfile: "PATCH_PRODUCER", authorizedProfile: "PATCH_PRODUCER" };
const patchEnvelope = (overrides = {}) => ({ requestId: "CX-PATCH-001", project: patchBinding.project, repo: patchBinding.repo, provider: "OPENAI", model: "gpt-patch", budget: { maxCostUsd: 0.2 }, capacity: { available: true, maxConcurrent: 1 }, executionProfileGrant: authorizedPatchProducerGrant, ...overrides });
const patchEntry = (overrides = {}) => ({ path: patchPath, changeType: "ADD", encoding: "utf8", content: patchContent, sha256: patchContentSha256, ...overrides });
const patchProviderRun = (entryOverrides = {}) => async () => ({
  executionId: "exec-patch-001",
  summary: "Proposed the adapter-notes.md scaffold.",
  findings: ["Adapter notes drafted for Control Center scaffolding."],
  evidence: [{ path: patchPath }],
  verdict: "PASS",
  metrics: { tokens: 64 },
  mutated: false,
  patch: { entries: [patchEntry(entryOverrides)] },
});

// --- 2. Keystone Control Center scoped patch accepted after matching Verifier PASS ----------------

test("2. Keystone Control Center scoped patch is accepted as a proposed artifact after matching Verifier PASS", async () => {
  const run = await runCortexPatchProducer({ request: patchRequest(), binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  assert.equal(run.ok, true, run.reason);
  assert.equal(run.result.patch.entries.length, 1);
  assert.equal(run.result.patch.entries[0].path, patchPath);
  assert.equal(run.result.patch.applied, false);
  assert.equal(run.receipt.applied, false);
  assert.equal(run.receipt.executionProfile, "PATCH_PRODUCER");
  assert.match(run.durable.manifestLocation, /^docs\/orchestration\/work-intake\/results\/CX-PATCH-001\/[a-f0-9]{64}\.result\.json$/);

  const { verificationRequest, verifierResult } = verificationFor(patchRequest(), run);
  assert.equal(deriveVerdict(verifierResult), "PASS");
  const files = new Map();
  const persisted = persistPatchProducerResult({ request: patchRequest(), result: run.result, durable: run.durable, verificationRequest, verifierResult, store: { write: (path, bytes) => files.set(path, bytes) } });
  assert.equal(files.size, 2);
  assert.equal(persisted.sha256, run.durable.manifest.sha256);
  assert.equal(persisted.patchApplied, false);
  // The store only ever receives the two governed EOS result/patch artifact locations — never the
  // proposed source path itself.
  for (const path of files.keys()) {
    assert.match(path, /^docs\/orchestration\/work-intake\/results\//);
    assert.notEqual(path, patchPath);
  }
});

// --- 3. Taylor_Parts target is rejected in PATCH_PRODUCER mode ------------------------------------

test("3. Taylor_Parts target is rejected in PATCH_PRODUCER mode", async () => {
  const taylorPartsBinding = { ...patchBinding, project: "Taylor_Parts", repo: "TaylorService-spec/Taylor_Parts" };
  const out = await runCortexPatchProducer({ request: patchRequest(), binding: taylorPartsBinding, envelope: patchEnvelope({ project: taylorPartsBinding.project, repo: taylorPartsBinding.repo }), providerRun: patchProviderRun(), clock });
  assert.equal(out.ok, false);
  assert.match(out.reason, /project-keystone/);
});

// --- 4. non-Control-Center Keystone paths are rejected --------------------------------------------

test("4. non-Control-Center Keystone paths are rejected", async () => {
  const offPathBinding = { ...patchBinding, allowedSurfaces: ["docs/keystone-notes.md"] };
  const req = patchRequest({ allowedSurfaces: ["docs/keystone-notes.md"] });
  const out = await runCortexPatchProducer({ request: req, binding: offPathBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  assert.equal(out.ok, false);
  assert.match(out.reason, /approved Control Center paths/);
});

// --- 5. out-of-scope patch paths fail closed -------------------------------------------------------

test("5. out-of-scope patch paths fail closed", async () => {
  const outOfScopeEntry = { path: `${CONTROL_CENTER_PATH_PREFIX}unrequested.md`, changeType: "ADD", encoding: "utf8", content: "x", sha256: sha256("x") };
  const out = await runCortexPatchProducer({ request: patchRequest(), binding: patchBinding, envelope: patchEnvelope(), providerRun: async () => ({ ...(await patchProviderRun()()), patch: { entries: [outOfScopeEntry] } }), clock });
  assert.equal(out.ok, false);
  assert.match(out.reason, /undeclared file/);
});

// --- 6. malformed/tampered patch hash fails closed --------------------------------------------------

test("6. malformed/tampered patch hash fails closed", async () => {
  const out = await runCortexPatchProducer({ request: patchRequest(), binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun({ sha256: sha256("something else entirely") }), clock });
  assert.equal(out.ok, false);
  assert.match(out.reason, /hash does not match/);
});

test("6b. malformed/tampered patch hash fails closed (post-run tamper before persistence)", async () => {
  const run = await runCortexPatchProducer({ request: patchRequest(), binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  assert.equal(run.ok, true);
  const { verificationRequest, verifierResult } = verificationFor(patchRequest(), run);
  const tamperedResult = { ...run.result, patch: { ...run.result.patch, entries: [{ ...run.result.patch.entries[0], content: "tampered content" }] } };
  assert.throws(
    () => persistPatchProducerResult({ request: patchRequest(), result: tamperedResult, durable: run.durable, verificationRequest, verifierResult, store: { write() {} } }),
    /unsafe patch entry/,
  );
});

// --- 7. missing or mismatched Verifier PASS prevents persistence -----------------------------------

test("7a. persistence refuses missing verification", async () => {
  const req = patchRequest();
  const run = await runCortexPatchProducer({ request: req, binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  assert.throws(() => persistPatchProducerResult({ request: req, result: run.result, durable: run.durable, store: { write() {} } }), /Verifier PASS/);
});

test("7b. persistence refuses RETURN_FOR_CORRECTION", async () => {
  const req = patchRequest();
  const run = await runCortexPatchProducer({ request: req, binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  const v = verificationFor(req, run, "FAIL", [{ category: "MISSED_CONSTRAINT", claim: "c", evidenceGap: "g", correctiveInstruction: "fix" }]);
  assert.throws(() => persistPatchProducerResult({ request: req, result: run.result, durable: run.durable, ...v, store: { write() {} } }), /Verifier PASS/);
});

test("7c. persistence refuses ESCALATE", async () => {
  const req = patchRequest();
  const run = await runCortexPatchProducer({ request: req, binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  const v = verificationFor(req, run, "NOT_APPLICABLE");
  assert.throws(() => persistPatchProducerResult({ request: req, result: run.result, durable: run.durable, ...v, store: { write() {} } }), /Verifier PASS/);
});

test("7d. persistence refuses PASS bound to a different result", async () => {
  const req = patchRequest();
  const run = await runCortexPatchProducer({ request: req, binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  const other = { ...run, result: createAgentResult({ ...run.result, resultId: "CX-PATCH-001:cortex-patch:other" }) };
  const v = verificationFor(req, other);
  assert.throws(() => persistPatchProducerResult({ request: req, result: run.result, durable: run.durable, ...v, store: { write() {} } }), /not bound/);
});

// --- 8. provider result cannot directly write source, backlog, merge, deploy, route Claude, or
//        change authorization ------------------------------------------------------------------

test("8. patch binding carries no mutation, integration, or authority surface", () => {
  assert.deepEqual(Object.keys(patchBinding).sort(), ["allowedSurfaces", "eligibleModels", "eligibleProviders", "maxCostUsd", "mode", "project", "repo"]);
});

test("8b. adapter module exposes no apply/merge/deploy/route/authorize function", async () => {
  const mod = await import("./cortexProviderAdapter.mjs");
  const suspicious = Object.keys(mod).filter((name) => /apply|merge|deploy|route|authorize/i.test(name));
  assert.deepEqual(suspicious, []);
});

test("8c. persistence store only ever receives governed EOS result/patch artifact writes", async () => {
  const req = patchRequest();
  const run = await runCortexPatchProducer({ request: req, binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  const { verificationRequest, verifierResult } = verificationFor(req, run);
  const writes = [];
  persistPatchProducerResult({ request: req, result: run.result, durable: run.durable, verificationRequest, verifierResult, store: { write: (path) => writes.push(path) } });
  assert.equal(writes.length, 2);
  assert.ok(writes.every((path) => path.startsWith("docs/orchestration/work-intake/results/")));
});

// --- 9. no patch auto-apply path exists --------------------------------------------------------

test("9. no patch auto-apply path exists", async () => {
  const req = patchRequest();
  const run = await runCortexPatchProducer({ request: req, binding: patchBinding, envelope: patchEnvelope(), providerRun: patchProviderRun(), clock });
  assert.equal(run.result.patch.applied, false);
  assert.equal(run.receipt.applied, false);
  const { verificationRequest, verifierResult } = verificationFor(req, run);
  const persisted = persistPatchProducerResult({ request: req, result: run.result, durable: run.durable, verificationRequest, verifierResult, store: { write() {} } });
  assert.equal(persisted.patchApplied, false);
  assert.equal(typeof persisted.apply, "undefined");
});

// --- 10. provider unavailable leaves existing Claude/READ_ONLY_PILOT path unchanged ----------------

test("10. PATCH_PRODUCER provider unavailable is isolated and does not affect READ_ONLY_PILOT", async () => {
  const unavailable = await runCortexPatchProducer({ request: patchRequest(), binding: patchBinding, envelope: patchEnvelope(), clock });
  assert.deepEqual([unavailable.ok, unavailable.kind], [false, "UNAVAILABLE"]);
  // The existing READ_ONLY_PILOT/Claude path is entirely unaffected by the PATCH_PRODUCER provider
  // being unavailable — same adapter module, independent function, independent binding.
  const roRun = await runReadOnlyProviderPilot({ request: roRequest(), binding: roBinding, envelope: roEnvelope, providerRun: roProviderRun, clock });
  assert.equal(roRun.ok, true);
});

// --- additional fail-closed table for PATCH_PRODUCER eligibility (mirrors READ_ONLY_PILOT table) ---

for (const [name, mutate, expected] of [
  ["wrong requestId", (b, e, r) => ({ b, e: { ...e, requestId: "CX-OTHER" }, r }), "requestId"],
  ["missing provider eligibility", (b, e, r) => ({ b: { ...b, eligibleProviders: [] }, e, r }), "eligible"],
  ["budget rejection", (b, e, r) => ({ b, e: { ...e, budget: { maxCostUsd: 10 } }, r }), "budget"],
  ["capacity rejection", (b, e, r) => ({ b, e: { ...e, capacity: { available: false, maxConcurrent: 1 } }, r }), "capacity"],
  ["not a mutating request", (b, e, r) => ({ b, e, r: patchRequest({ mutating: false }) }), "mutating"],
  ["missing execution profile grant", (b, e, r) => ({ b, e: { ...e, executionProfileGrant: undefined }, r }), "execution profile not authorized"],
  ["execution profile requested but not authorized", (b, e, r) => ({ b, e: { ...e, executionProfileGrant: { requestedProfile: "PATCH_PRODUCER", authorizedProfile: null } }, r }), "execution profile not authorized"],
  ["execution profile authorized below PATCH_PRODUCER rank", (b, e, r) => ({ b, e: { ...e, executionProfileGrant: { requestedProfile: "PATCH_PRODUCER", authorizedProfile: "READ_ONLY_VERIFY" } }, r }), "execution profile not authorized"],
]) {
  test(`fails closed: ${name}`, async () => {
    const x = mutate(patchBinding, patchEnvelope(), patchRequest());
    const out = await runCortexPatchProducer({ request: x.r, binding: x.b, envelope: x.e, providerRun: patchProviderRun(), clock });
    assert.equal(out.ok, false);
    assert.match(out.reason, new RegExp(expected));
  });
}
