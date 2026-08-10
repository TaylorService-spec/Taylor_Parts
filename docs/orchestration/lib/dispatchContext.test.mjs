import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRequest } from "./agentRequest.mjs";
import { decideDispatch, attachDispatchContext, dispatchWithContext } from "./agentManager.mjs";
import { contextPackageFor } from "../context/build-package.mjs";

const req = (over = {}) => createAgentRequest({
  requestId: "R-1", requestedByWorkstream: "Design", purpose: "trace the selector",
  outputContract: "a finding", scope: ["orchestration"], execution: "LOCAL", ...over,
});

test("ordinary DISPATCH attaches the SAME C-7 package with all required fields", () => {
  const r = dispatchWithContext({ request: req(), allocations: [], contextPackageFn: contextPackageFor, sourceCommit: "abc123" });
  assert.equal(r.decision, "DISPATCH");
  const p = r.contextPackage;
  assert.ok(p, "a context package must be attached to an ordinary dispatch");
  // role/scope
  assert.equal(p.role, "Design");
  assert.deepEqual(p.assignmentId, "R-1");
  // governing authority + L1 required + L2 on-demand + exclusions
  assert.ok(p.governingAuthority);
  assert.ok(Array.isArray(p.required) && p.required.length >= 1 && p.required[0].retrievalPath);
  assert.ok(Array.isArray(p.onDemand));
  assert.ok(Array.isArray(p.excluded));
  // reproducible provenance (source + map commit)
  assert.equal(p.provenance.sourceCommit, "abc123");
  assert.ok(p.provenance.mapVersion);
  // sufficiency
  assert.equal(p.sufficiency, "SUFFICIENT");
  // refs, not document copies
  assert.ok(p.required.every((x) => !("content" in x)));
});

test("insufficient scope → sufficiency EVIDENCE_REQUIRED (escalate, do not guess)", () => {
  const r = dispatchWithContext({ request: req({ scope: ["no-such-domain"] }), allocations: [], contextPackageFn: contextPackageFor });
  assert.equal(r.decision, "DISPATCH");
  assert.equal(r.contextPackage.sufficiency, "EVIDENCE_REQUIRED");
});

test("the SAME mechanism is used — no second bootstrap (attach requires the injected contextPackageFn)", () => {
  const d = decideDispatch({ request: req(), allocations: [] });
  assert.equal(d.decision, "DISPATCH");
  assert.equal(d.contextPackage, undefined, "decideDispatch alone attaches nothing");
  assert.throws(() => attachDispatchContext(d, req(), null), /contextPackageFn is required/);
  const attached = attachDispatchContext(d, req(), contextPackageFor, { sourceCommit: "z" });
  assert.ok(attached.contextPackage);
});

test("non-DISPATCH decisions attach no package (contract preserved)", () => {
  // WAIT_NETWORK: remote request while network unavailable
  const r = dispatchWithContext({ request: req({ execution: "REMOTE" }), allocations: [], networkState: "NETWORK_UNAVAILABLE", contextPackageFn: contextPackageFor });
  assert.notEqual(r.decision, "DISPATCH");
  assert.equal(r.contextPackage, undefined);
  // REJECT_INVALID passes through untouched too
  const bad = dispatchWithContext({ request: { requestId: "x" }, allocations: [], contextPackageFn: contextPackageFor });
  assert.equal(bad.decision, "REJECT_INVALID");
  assert.equal(bad.contextPackage, undefined);
});

test("the request carries a durable scope field", () => {
  assert.deepEqual(req({ scope: ["orchestration", "roadmap"] }).scope, ["orchestration", "roadmap"]);
});
