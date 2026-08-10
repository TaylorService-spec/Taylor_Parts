import { test } from "node:test";
import assert from "node:assert/strict";
import { coldStart } from "./cold-start.mjs";

test("coldStart produces a sufficient, healthy, reproducible bootstrap for orchestration", () => {
  const b = coldStart({ id: "T", scope: ["orchestration"], sourceCommit: "abc123" });
  assert.equal(b.contract, "EOS-COLD-START/1.0.0");
  assert.equal(b.package.sufficiency, "SUFFICIENT");
  assert.ok(b.package.governingAuthority);
  assert.equal(b.authorityFirst.gate, "SATISFIED");
  assert.equal(b.coldStartContextCost.sufficiency, "SUFFICIENT");
  // orientation is a small fraction of the observed ≈121k-token baseline (material reduction)
  assert.ok(b.coldStartContextCost.orientationTokensEstimate < 30000);
  assert.equal(b.coldStartContextCost.runtimeTokens, null); // never fabricated
});

test("model-routing in scope pulls modelPolicy into required (authority-first, satisfied)", () => {
  const b = coldStart({ id: "T", scope: ["orchestration", "model-routing"], sourceCommit: "abc123" });
  assert.equal(b.authorityFirst.gate, "SATISFIED");
  assert.ok(b.authorityFirst.present.some((p) => /modelPolicy\.mjs/.test(p.retrievalPath)));
  assert.ok(b.package.required.some((r) => /modelPolicy\.mjs/.test(r.retrievalPath)));
});

test("model-routing OUT of scope is surfaced on the outside-scope checklist (defect defense)", () => {
  const b = coldStart({ id: "T", scope: ["orchestration"], sourceCommit: "abc123" });
  assert.ok(b.governedSubjectsOutsideScope.some((o) => o.subject === "model-routing"));
});

test("the current-state pointer is carried (READY set + Owner gates), not narrative state", () => {
  const b = coldStart({ id: "T", scope: ["orchestration"], sourceCommit: "abc123" });
  assert.ok(b.currentState);
  assert.ok(Array.isArray(b.currentState.readyItemIds));
  assert.ok(Array.isArray(b.currentState.ownerGateIds));
});
