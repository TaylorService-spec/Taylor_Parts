import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMap, contextPackageFor } from "./build-package.mjs";

test("loadMap reads the committed orchestration map", () => {
  const { map, entries } = loadMap();
  assert.equal(map.domain, "orchestration");
  assert.ok(entries.length >= 10);
});

test("contextPackageFor produces a reproducible, sufficient package for orchestration", () => {
  const pkg = contextPackageFor({ id: "T", scope: ["orchestration"], role: "worker", sourceCommit: "abc123" });
  assert.equal(pkg.domain, "orchestration");
  assert.equal(pkg.provenance.sourceCommit, "abc123");   // reproducible (C7)
  assert.equal(pkg.sufficiency, "SUFFICIENT");           // L1 authority present
  assert.ok(pkg.required.length >= 1 && pkg.governingAuthority);
  assert.equal(pkg.contextHealth, "HEALTHY");            // the committed map lints clean
  // refs, not document copies
  assert.ok(pkg.required.every((r) => r.retrievalPath && !("content" in r)));
});

test("a scope with no map coverage escalates rather than guesses (EVIDENCE_REQUIRED)", () => {
  const pkg = contextPackageFor({ id: "T", scope: ["nonexistent-domain"] });
  assert.equal(pkg.sufficiency, "EVIDENCE_REQUIRED");
});
