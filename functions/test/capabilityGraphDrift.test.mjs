// The capability graph is a GENERATED artifact, and until this suite existed nothing checked it.
//
// It rotted, silently, for exactly that reason: the committed copy still reported 109 capabilities
// and `catalogActive: 36` long after DECISIONS #167 moved the whole report.* family off the
// catalogue flag and onto the per-environment activation seam. Two independent workstreams read the
// stale numbers and had to re-derive the truth by hand. A generated file with no drift guard is not
// documentation -- it is a second, unmaintained answer to "do we already have X?".
//
// This suite regenerates the graph IN MEMORY from the same exported functions the generator's CLI
// uses, and compares against the committed artifacts. It never writes to the repository, so a
// failing run leaves the tree exactly as it found it. There is no second graph builder here on
// purpose: duplicating the build logic would only guarantee the guard and the generator can
// disagree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT, buildGraph, renderMarkdown } from "../../scripts/buildCapabilityGraph.mjs";

const JSON_PATH = "docs/architecture/capability-graph.json";
const MD_PATH = "docs/architecture/capability-graph.md";

// The repo is checked out with native line endings on Windows; the artifact's CONTENT is what is
// under guard, not how a given checkout stores newlines.
const norm = (s) => s.replace(/\r\n/g, "\n");
const committed = (p) => norm(readFileSync(resolve(ROOT, p), "utf8"));

const graph = buildGraph({});
const staleHint = "regenerate with `node scripts/buildCapabilityGraph.mjs`";

test("the catalog parser still reads every catalogue entry", () => {
  // A parser that silently drops entries would make the graph agree with itself while under-
  // reporting the catalogue -- drift the file comparison alone cannot see.
  assert.equal(
    graph.catalogCountCheck.ok,
    true,
    `catalog parser drift: parsed ${graph.catalogCountCheck.parsed} of ${graph.catalogCountCheck.raw}`,
  );
});

test("the server and client catalogues have not drifted apart", () => {
  assert.deepEqual(graph.parityIssues, [], "catalog parity issues between server and client copies");
});

test("committed capability-graph.json matches the generator", () => {
  const expected = norm(JSON.stringify(graph, null, 2) + "\n");
  assert.equal(committed(JSON_PATH), expected, `${JSON_PATH} is stale -- ${staleHint}`);
});

test("committed capability-graph.md matches the generator", () => {
  assert.equal(committed(MD_PATH), norm(renderMarkdown(graph)), `${MD_PATH} is stale -- ${staleHint}`);
});

test("the committed counts are the counts the sources actually support", () => {
  // Named separately from the whole-file comparison so a count regression reports as a count
  // regression. These two numbers are the ones the stale artifact got wrong, and the ones readers
  // quote: total capabilities, and how many are catalogue-active (activation now lives in the
  // environment seam, so catalogActive going non-zero is a real authority event, not churn).
  const onDisk = JSON.parse(committed(JSON_PATH));
  assert.equal(onDisk.capabilities.length, graph.capabilities.length, `capability count is stale -- ${staleHint}`);
  assert.equal(onDisk.counts.catalogActive, graph.counts.catalogActive, `catalogActive is stale -- ${staleHint}`);
  assert.equal(onDisk.counts.catalogInactive, graph.counts.catalogInactive, `catalogInactive is stale -- ${staleHint}`);
});

test("the eligibility parse reads the SPINE set, not the production set", () => {
  // The specific silent breakage this file was written after. `financialPolicy.profile.*` is
  // sandbox-eligible and deliberately ABSENT from PRODUCTION_ACTIVATION_ELIGIBLE_IDS, so its
  // presence here proves the parser landed on the spine declaration and not on the narrower
  // production list that sits above it in the same source file.
  const eligible = new Set(
    graph.capabilities.filter((c) => c.environmentActivation?.eligible).map((c) => c.id),
  );
  for (const id of ["financialPolicy.profile.read", "financialPolicy.profile.configure"]) {
    assert.ok(eligible.has(id), `${id} should be spine-eligible -- the eligibility parse is reading the wrong set`);
  }
});
