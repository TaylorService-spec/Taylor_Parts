import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createContextEntry, validateContextEntry, lintContextMap, resolvePrecedence, buildContextPackage,
  CONTEXT_KINDS, LIFECYCLE_STATES,
} from "./contextMap.mjs";

const entry = (over) => createContextEntry({ id: "e", purpose: "p", authority: "A", kind: "model", retrievalPath: "path.mjs", scope: ["orchestration"], ...over });

test("an entry requires id/purpose/retrievalPath; non-evidence requires an authority", () => {
  assert.deepEqual(validateContextEntry(entry()), []);
  assert.ok(validateContextEntry(createContextEntry({ id: "x", purpose: "p", kind: "principle" })).some((e) => /retrievalPath/.test(e)));
  assert.ok(validateContextEntry(createContextEntry({ id: "x", purpose: "p", kind: "decision", retrievalPath: "p" })).some((e) => /authority/.test(e)));
  assert.deepEqual(validateContextEntry(createContextEntry({ id: "raw", purpose: "p", kind: "evidence", retrievalPath: "p" })), []); // evidence may have no authority
});

// --- C1: precedence / "which governs THIS assignment?" ---
test("precedence: a principle governs over a model/decision/evidence in the same scope; superseded never governs", () => {
  const entries = [
    entry({ id: "ev", kind: "evidence", authority: null, scope: ["s"] }),
    entry({ id: "mod", kind: "model", scope: ["s"] }),
    entry({ id: "dec", kind: "decision", scope: ["s"] }),
    entry({ id: "prin", kind: "principle", scope: ["s"] }),
    entry({ id: "oldprin", kind: "principle", scope: ["s"], lifecycle: "superseded", supersededBy: "prin" }),
  ];
  const { governing, ranked } = resolvePrecedence(entries, { scope: ["s"] });
  assert.equal(governing.id, "prin");
  assert.equal(ranked[0].id, "prin");
  assert.ok(!ranked.find((e) => e.id === "oldprin"), "superseded never competes");
});

test("precedence tie-break: a deployment/capability-specific rule beats a platform default at equal rank", () => {
  const entries = [
    entry({ id: "platform", kind: "decision", scope: ["s"], applicability: { platform: true } }),
    entry({ id: "taylor", kind: "decision", scope: ["s"], applicability: { deployment: "taylor" } }),
  ];
  assert.equal(resolvePrecedence(entries, { scope: ["s"] }).governing.id, "taylor");
});

// --- Context Health lint ---
test("lint flags orphans, dangling supersede, and conflicting authority", () => {
  const { defects } = lintContextMap([
    createContextEntry({ id: "orphan", purpose: "p", kind: "evidence" }), // no retrievalPath
    entry({ id: "a", authority: "SHARED", scope: ["s"] }),
    entry({ id: "b", authority: "SHARED", scope: ["s"] }),               // conflicts with a
    entry({ id: "c", lifecycle: "superseded", supersededBy: "ghost" }),  // dangling
  ]);
  const types = defects.map((d) => d.type);
  assert.ok(types.includes("NO_RETRIEVAL_PATH"));
  assert.ok(types.includes("CONFLICTING_AUTHORITY"));
  assert.ok(types.includes("DANGLING_SUPERSEDE"));
});

test("a clean map is healthy", () => {
  assert.equal(lintContextMap([entry({ id: "a", scope: ["s"] }), entry({ id: "b", authority: "B", scope: ["t"] })]).healthy, true);
});

// --- C7: reproducible package + C6 negative retrieval ---
test("context package records reproducible provenance and refs (not copies)", () => {
  const pkg = buildContextPackage({
    assignment: { id: "W-1", scope: ["orchestration"] },
    entries: [entry({ id: "req", level: "L1", scope: ["orchestration"] })],
    mapVersion: "map@abc", sourceCommit: "abc123",
  });
  assert.equal(pkg.provenance.mapVersion, "map@abc");
  assert.equal(pkg.provenance.sourceCommit, "abc123");
  assert.equal(pkg.required[0].id, "req");
  assert.ok(!("content" in pkg.required[0]), "package holds refs, not document copies");
});

// --- C8: retrieve-don't-guess escalation ---
test("no L1 authority in scope → EVIDENCE_REQUIRED (finding a broad file is not sufficient context)", () => {
  const pkg = buildContextPackage({
    assignment: { id: "W-2", scope: ["orchestration"] },
    entries: [entry({ id: "broad", level: "L2", scope: ["orchestration"] })], // only on-demand, no required authority
  });
  assert.equal(pkg.sufficiency, "EVIDENCE_REQUIRED");
});

// ================= REPLACEMENT-SESSION ACCEPTANCE TEST (study §12) =================
// A tiny governed map standing in for the orchestration domain.
const MAP = [
  entry({ id: "orch-principle", kind: "principle", authority: "operating-model", scope: ["orchestration"], level: "L1", retrievalPath: "docs/orchestration/continuous-workstream-orchestrator.md" }),
  entry({ id: "roadmap-model", kind: "model", authority: "roadmapModel.mjs", scope: ["orchestration", "roadmap"], level: "L1", retrievalPath: "docs/orchestration/lib/roadmapModel.mjs" }),
  entry({ id: "freshness", kind: "model", authority: "controlCenterContract", scope: ["orchestration", "freshness"], level: "L2", retrievalPath: "docs/orchestration/lib/controlCenterContract.mjs" }),
  entry({ id: "old-spec", kind: "decision", authority: "operating-model", scope: ["orchestration"], level: "L1", lifecycle: "superseded", supersededBy: "orch-principle", retrievalPath: "docs/old.md" }),
  entry({ id: "unrelated", kind: "model", authority: "inventory", scope: ["inventory"], level: "L1", retrievalPath: "docs/inv.md" }),
  entry({ id: "raw-evidence", kind: "evidence", authority: null, scope: ["orchestration"], level: "L3", lifecycle: "historical", retrievalPath: "docs/orchestration/agent-requests/DR-001.result.json" }),
];

test("TEST A — normal continuation: a fresh worker gets the minimum correct context for its scope", () => {
  const pkg = buildContextPackage({ assignment: { id: "A", scope: ["orchestration"] }, entries: MAP, mapVersion: "m", sourceCommit: "c" });
  assert.equal(pkg.sufficiency, "SUFFICIENT");
  const reqIds = pkg.required.map((r) => r.id);
  assert.ok(reqIds.includes("orch-principle") && reqIds.includes("roadmap-model"));
  assert.equal(pkg.governingAuthority, "orch-principle"); // the principle governs
});

test("TEST B — adversarial context: chooses current authority; excludes superseded, historical, and unrelated", () => {
  const pkg = buildContextPackage({ assignment: { id: "B", scope: ["orchestration"] }, entries: MAP, mapVersion: "m", sourceCommit: "c" });
  const reqIds = pkg.required.map((r) => r.id);
  assert.ok(!reqIds.includes("old-spec"), "superseded spec excluded");
  assert.ok(!reqIds.includes("unrelated"), "unrelated domain excluded");
  assert.ok(!reqIds.includes("raw-evidence"), "raw historical evidence excluded from normal retrieval");
  const excludedIds = pkg.excluded.map((e) => e.id);
  assert.ok(excludedIds.includes("old-spec") && excludedIds.includes("unrelated") && excludedIds.includes("raw-evidence"));
  assert.equal(pkg.governingAuthority, "orch-principle"); // never the superseded old-spec
});

test("enums are stable", () => {
  assert.ok(CONTEXT_KINDS.includes("distilled") && LIFECYCLE_STATES.includes("superseded"));
});

// The committed orchestration context-map.json must itself be healthy (CI-validated).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
test("the committed orchestration context-map.json lints clean (no orphans/conflicts/dangling)", () => {
  const p = join(dirname(fileURLToPath(import.meta.url)), "..", "context", "context-map.json");
  const map = JSON.parse(readFileSync(p, "utf8"));
  const entries = map.entries.map((e) => createContextEntry(e));
  const { defects, healthy } = lintContextMap(entries);
  assert.equal(healthy, true, "context-map defects: " + JSON.stringify(defects));
  // a fresh worker assigned to "orchestration" gets sufficient required context
  const pkg = buildContextPackage({ assignment: { id: "REPL", scope: ["orchestration"] }, entries, mapVersion: map.mapSchemaVersion, sourceCommit: "HEAD" });
  assert.equal(pkg.sufficiency, "SUFFICIENT");
  assert.ok(pkg.required.length >= 2);
});
