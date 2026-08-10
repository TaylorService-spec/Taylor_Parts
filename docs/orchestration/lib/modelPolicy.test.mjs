import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveDispatchModel, requestModelEscalation, withSelectedModel, RUNTIME_MODELS, MODEL_ESCALATIONS } from "./modelPolicy.mjs";
import { createAgentRequest } from "./agentRequest.mjs";
import { dispatchWithContext } from "./agentManager.mjs";
import { contextPackageFor } from "../context/build-package.mjs";
import { DEFAULT_GUARDRAILS } from "./wakeSupervisor.mjs";

test("ratified policy: delegated agent → SONNET; primary Product/Design → OPUS; primary UX → OPUS", () => {
  assert.equal(resolveDispatchModel({ delegated: true, workstream: "Product/Design" }).selectedModel, "sonnet");
  assert.equal(resolveDispatchModel({ delegated: false, workstream: "Product/Design" }).selectedModel, "opus");
  assert.equal(resolveDispatchModel({ delegated: false, workstream: "UX" }).selectedModel, "opus");
  // a delegated agent is SONNET regardless of tier
  assert.equal(resolveDispatchModel({ delegated: true, modelTier: "advanced", workstream: "UX" }).selectedModel, "sonnet");
});

test("modelTier is preserved as portability metadata, not treated as the runtime model", () => {
  const r = resolveDispatchModel({ delegated: true, modelTier: "advanced" });
  assert.equal(r.modelTier, "advanced");
  assert.equal(r.selectedModel, "sonnet");
  assert.ok(RUNTIME_MODELS.includes(r.selectedModel));
});

test("ordinary standard dispatch carries selectedModel (delegated → SONNET) + modelSelection basis", () => {
  const request = createAgentRequest({ requestId: "R", requestedByWorkstream: "Design", purpose: "x", outputContract: "y", scope: ["orchestration"], execution: "LOCAL", modelTier: "standard" });
  const r = dispatchWithContext({ request, allocations: [], contextPackageFn: contextPackageFor, sourceCommit: "c" });
  assert.equal(r.decision, "DISPATCH");
  assert.equal(r.selectedModel, "sonnet");
  assert.equal(r.modelSelection.modelTier, "standard");
  assert.match(r.modelSelection.reason, /delegated/);
});

test("non-DISPATCH paths carry no selected model", () => {
  const request = createAgentRequest({ requestId: "R", requestedByWorkstream: "Design", purpose: "x", outputContract: "y", execution: "REMOTE" });
  const r = dispatchWithContext({ request, allocations: [], networkState: "NETWORK_UNAVAILABLE", contextPackageFn: contextPackageFor });
  assert.notEqual(r.decision, "DISPATCH");
  assert.equal(r.selectedModel, undefined);
});

test("the Wake Supervisor uses the SAME resolver — its guardrail model does not contradict dispatch", () => {
  assert.equal(DEFAULT_GUARDRAILS.model, resolveDispatchModel({ delegated: true }).selectedModel);
  assert.equal(DEFAULT_GUARDRAILS.model, "sonnet");
});

test("escalation is a routed signal, never auto-applied and never authority expansion", () => {
  const e = requestModelEscalation("multi-file reasoning exceeds delegated scope");
  assert.equal(e.signal, "NEEDS_HIGHER_REASONING");
  assert.equal(e.autoApplied, false);
  assert.equal(e.routeTo, "selector/governance");
  assert.ok(MODEL_ESCALATIONS.includes(e.signal));
});

test("withSelectedModel persists selectedModel + tier + reason on a durable assignment record", () => {
  const a = withSelectedModel({ workId: "W" }, resolveDispatchModel({ delegated: true, modelTier: "standard" }));
  assert.equal(a.selectedModel, "sonnet");
  assert.equal(a.modelTier, "standard");
  assert.ok(a.modelSelectionReason);
});

test("DRIFT GUARD: the code policy matches the documented authority (agents=SONNET, Design/UX-primary=OPUS)", () => {
  const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "quality", "agent-orchestration-adapter.md"), "utf8");
  assert.match(doc, /SONNET/); assert.match(doc, /OPUS/);
  assert.match(doc, /Product\/Design/);
  // the ratified mapping the resolver encodes must be present in the authority doc
  assert.ok(/every[\s\S]{0,40}SONNET/i.test(doc), "doc must state delegated agents run SONNET");
});
