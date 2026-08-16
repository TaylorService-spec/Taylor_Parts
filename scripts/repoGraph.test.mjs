import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGraph, normalizePath, resolveImport, parseImportSpecifiers,
  parseDocReferences, parseWorkflowPaths, isIgnored,
} from "./repoGraph.mjs";

const graphOf = (fileMap) =>
  buildGraph({ files: Object.keys(fileMap), read: (p) => fileMap[p] ?? "" });

test("normalizePath collapses . and .. segments", () => {
  assert.equal(normalizePath("a/b/../c"), "a/c");
  assert.equal(normalizePath("./a/./b"), "a/b");
  assert.equal(normalizePath("a/b/../../c"), "c");
});

test("resolveImport tries extension and index candidates, ignores bare specifiers", () => {
  const known = new Set(["src/a.js", "src/lib/index.ts", "src/b.tsx"]);
  assert.equal(resolveImport("src/main.js", "./a", known), "src/a.js");
  assert.equal(resolveImport("src/main.js", "./lib", known), "src/lib/index.ts");
  assert.equal(resolveImport("src/main.js", "./b.tsx", known), "src/b.tsx");
  assert.equal(resolveImport("src/main.js", "react", known), null, "bare specifier is a dependency");
  assert.equal(resolveImport("src/main.js", "./nope", known), null);
});

test("parseImportSpecifiers finds import/require/dynamic forms", () => {
  const src = `
    import x from "./a";
    import { y } from './b';
    const z = require("./c");
    const p = import("./d");
    import "./side-effect";
  `;
  const got = parseImportSpecifiers(src).sort();
  assert.deepEqual(got, ["./a", "./b", "./c", "./d", "./side-effect"]);
});

test("parseDocReferences picks up markdown links and backticked paths, drops URLs", () => {
  const md = 'See [spec](docs/spec.md) and `functions/src/x.ts` and [ext](https://example.com) and [anchor](#h)';
  const got = parseDocReferences(md).sort();
  assert.deepEqual(got, ["docs/spec.md", "functions/src/x.ts"]);
});

test("parseWorkflowPaths extracts path prefixes from glob filters", () => {
  const yml = `
on:
  pull_request:
    paths:
      - "functions/src/**"
      - "docs/orchestration/lib/*.mjs"
      - "single.yml"
`;
  const got = parseWorkflowPaths(yml).sort();
  assert.ok(got.includes("functions/src"));
  assert.ok(got.includes("docs/orchestration/lib"));
});

test("isIgnored excludes vendor and build directories", () => {
  assert.equal(isIgnored("node_modules/x/index.js"), true);
  assert.equal(isIgnored("dist/app.js"), true);
  assert.equal(isIgnored("functions/src/app.ts"), false);
});

test("buildGraph records import edges in both directions", () => {
  const g = graphOf({
    "src/a.js": 'import b from "./b";',
    "src/b.js": "export default 1;",
  });
  assert.deepEqual(g.imports["src/a.js"], ["src/b.js"]);
  assert.deepEqual(g.importedBy["src/b.js"], ["src/a.js"]);
  assert.equal(g.counts.importEdges, 1);
});

test("hygiene: a doc citing a path that does not exist is a stale reference", () => {
  const g = graphOf({
    "docs/x.md": "see `functions/src/gone.ts` and `functions/src/here.ts`",
    "functions/src/here.ts": "export const a = 1;",
  });
  assert.deepEqual(g.hygiene.staleRefs, [{ doc: "docs/x.md", ref: "functions/src/gone.ts" }]);
});

test("hygiene: prose in backticks is not treated as a repo path claim", () => {
  const g = graphOf({ "docs/x.md": "the `status` field and `EOS-ISSUE-852` id" });
  assert.deepEqual(g.hygiene.staleRefs, []);
});

test("hygiene: a doc nothing links to is an orphan, but READMEs are exempt", () => {
  const g = graphOf({
    "docs/hub.md": "[child](docs/child.md)",
    "docs/child.md": "content",
    "docs/lonely.md": "content",
    "docs/README.md": "content",
  });
  // "orphan" = nothing links to it. hub.md qualifies too -- it is a root, and a root
  // nobody references is exactly the unreachable-doc case worth surfacing.
  assert.deepEqual(g.hygiene.orphanDocs, ["docs/hub.md", "docs/lonely.md"]);
  assert.ok(!g.hygiene.orphanDocs.includes("docs/child.md"), "linked doc is not an orphan");
  assert.ok(!g.hygiene.orphanDocs.includes("docs/README.md"), "READMEs are exempt");
});

test("hygiene: a test no workflow path filter selects has no path trigger", () => {
  const g = graphOf({
    ".github/workflows/a.yml": "on:\n  pull_request:\n    paths:\n      - \"functions/src/**\"\n",
    "functions/src/covered.test.mjs": "",
    "docs/orchestration/lib/orphan.test.mjs": "",
  });
  // Narrow claim on purpose: editing this file alone triggers no workflow. It may
  // still be executed by some workflow's run: step -- that is not what this measures.
  assert.deepEqual(g.hygiene.testsNoPathTrigger, ["docs/orchestration/lib/orphan.test.mjs"]);
});

test("buildGraph ignores vendor directories entirely", () => {
  const g = graphOf({ "node_modules/p/i.js": 'import "./x";', "src/a.js": "" });
  assert.equal(g.counts.code, 1);
});

test("buildGraph survives unreadable files without throwing", () => {
  assert.doesNotThrow(() =>
    buildGraph({ files: ["src/a.js"], read: () => { throw new Error("EACCES"); } }));
});
