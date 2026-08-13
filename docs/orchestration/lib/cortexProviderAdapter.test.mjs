import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRequest } from "./agentRequest.mjs";
import { createAgentResult } from "./agentResult.mjs";
import { createVerificationRequest, deriveVerdict } from "./verifierAgent.mjs";
import { runReadOnlyProviderPilot, persistPilotResult, CORTEX_PILOT_MODE } from "./cortexProviderAdapter.mjs";

const request = () => createAgentRequest({ requestId: "CX-001", requestedByWorkstream: "EOS_INTAKE", purpose: "Read authoritative orchestration contract", allowedSurfaces: ["docs/orchestration/agent-manager.md"], outputContract: "evidence-backed findings", mutating: false });
const binding = { mode: CORTEX_PILOT_MODE, project: "Taylor_Parts", repo: "TaylorService-spec/Taylor_Parts", allowedSurfaces: ["docs/orchestration/agent-manager.md"], eligibleProviders: ["OPENAI"], eligibleModels: ["gpt-pilot"], maxCostUsd: 0.25 };
const envelope = { requestId: "CX-001", project: binding.project, repo: binding.repo, provider: "OPENAI", model: "gpt-pilot", budget: { maxCostUsd: 0.10 }, capacity: { available: true, maxConcurrent: 1 } };
const providerRun = async () => ({ executionId: "exec-001", summary: "Contract confirmed.", findings: ["Agent Manager remains authoritative."], evidence: [{ path: "docs/orchestration/agent-manager.md" }], verdict: "PASS", metrics: { tokens: 42 }, mutated: false });
const clock = () => "2026-08-12T20:00:00Z";

const verificationFor = (req, run, verdict = "PASS", findings = []) => {
  const verificationRequest = createVerificationRequest({ requestId: `${req.requestId}-VERIFY`, workerRequest: req, workerResult: run.result });
  const verifierResult = createAgentResult({ resultId: `${req.requestId}-VR`, requestId: verificationRequest.requestId, routedBackTo: req.requestedByWorkstream, verdict, findings });
  return { verificationRequest, verifierResult };
};

test("deterministic conformance: AgentRequest -> adapter -> AgentResult -> Verifier -> durable result", async () => {
  const run = await runReadOnlyProviderPilot({ request: request(), binding, envelope, providerRun, clock });
  assert.equal(run.ok, true); assert.equal(run.result.requestId, "CX-001"); assert.equal(run.receipt.providerExecutionId, "exec-001");
  const { verificationRequest, verifierResult } = verificationFor(request(), run);
  assert.equal(deriveVerdict(verifierResult), "PASS");
  assert.match(run.durable.manifestLocation, /^docs\/orchestration\/work-intake\/results\/CX-001\/[a-f0-9]{64}\.result\.json$/);
  const files = new Map(); const persisted = persistPilotResult({ request: request(), result: run.result, durable: run.durable, verificationRequest, verifierResult, store: { write: (path, bytes) => files.set(path, bytes) } });
  assert.equal(files.size, 2); assert.equal(persisted.sha256, run.durable.manifest.sha256);
  const replay = await runReadOnlyProviderPilot({ request: request(), binding, envelope, providerRun, clock });
  assert.equal(replay.durable.manifest.sha256, run.durable.manifest.sha256);
});

test("persistence refuses missing verification", async () => { const req=request(); const run=await runReadOnlyProviderPilot({request:req,binding,envelope,providerRun,clock}); assert.throws(()=>persistPilotResult({request:req,result:run.result,durable:run.durable,store:{write(){}}}),/Verifier PASS/); });
test("persistence refuses RETURN_FOR_CORRECTION", async () => { const req=request(); const run=await runReadOnlyProviderPilot({request:req,binding,envelope,providerRun,clock}); const v=verificationFor(req,run,"FAIL",[{category:"MISSED_CONSTRAINT",claim:"c",evidenceGap:"g",correctiveInstruction:"fix"}]); assert.throws(()=>persistPilotResult({request:req,result:run.result,durable:run.durable,...v,store:{write(){}}}),/Verifier PASS/); });
test("persistence refuses ESCALATE", async () => { const req=request(); const run=await runReadOnlyProviderPilot({request:req,binding,envelope,providerRun,clock}); const v=verificationFor(req,run,"NOT_APPLICABLE"); assert.throws(()=>persistPilotResult({request:req,result:run.result,durable:run.durable,...v,store:{write(){}}}),/Verifier PASS/); });
test("persistence refuses PASS bound to another result", async () => { const req=request(); const run=await runReadOnlyProviderPilot({request:req,binding,envelope,providerRun,clock}); const other={...run,result:createAgentResult({...run.result,resultId:"CX-001:cortex:other"})}; const v=verificationFor(req,other); assert.throws(()=>persistPilotResult({request:req,result:run.result,durable:run.durable,...v,store:{write(){}}}),/not bound/); });

for (const [name, mutate, expected] of [
  ["wrong requestId", (b,e,r) => ({ b, e:{...e,requestId:"CX-OTHER"}, r }), "requestId"],
  ["wrong project/repo", (b,e,r) => ({ b, e:{...e,repo:"other/repo"}, r }), "project/repo"],
  ["disallowed scope", (b,e,r) => ({ b, e, r:createAgentRequest({...r,allowedSurfaces:["src/**"]}) }), "disallowed"],
  ["missing provider eligibility", (b,e,r) => ({ b:{...b,eligibleProviders:[]}, e, r }), "eligible"],
  ["budget rejection", (b,e,r) => ({ b, e:{...e,budget:{maxCostUsd:1}}, r }), "budget"],
  ["capacity rejection", (b,e,r) => ({ b, e:{...e,capacity:{available:false,maxConcurrent:1}}, r }), "capacity"],
]) test(`fails closed: ${name}`, async () => { const x=mutate(binding,envelope,request()); const out=await runReadOnlyProviderPilot({request:x.r,binding:x.b,envelope:x.e,providerRun,clock}); assert.equal(out.ok,false); assert.match(out.reason,new RegExp(expected)); });

test("fails closed: malformed result", async () => assert.equal((await runReadOnlyProviderPilot({ request:request(), binding, envelope, providerRun:async()=>({}), clock })).ok, false));
test("fails closed: provider result claims out-of-scope evidence", async () => assert.equal((await runReadOnlyProviderPilot({ request:request(), binding, envelope, providerRun:async()=>({...(await providerRun()),evidence:[{path:"src/secret.js"}]}), clock })).ok, false));
test("fails isolated: provider unavailable", async () => { const out=await runReadOnlyProviderPilot({request:request(),binding,envelope,clock}); assert.deepEqual([out.ok,out.kind],[false,"UNAVAILABLE"]); });
test("has no mutation or authority surface", () => assert.deepEqual(Object.keys(binding).sort(), ["allowedSurfaces","eligibleModels","eligibleProviders","maxCostUsd","mode","project","repo"]));
