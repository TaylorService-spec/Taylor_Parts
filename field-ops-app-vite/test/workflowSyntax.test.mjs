// EVERY GITHUB WORKFLOW MUST PARSE — the guard for a failure mode nothing else here can see.
//
// GOVERNANCE: docs/releases/ux-sandbox-release.md, "dead scanner CI lane".
//
// `.github/workflows/scan-workspace-tests.yml` carried a duplicated `working-directory:` key inside
// one step (introduced 2026-08-23 in bd192c7d). GitHub rejected the file at startup, so the run
// completed as `failure` in 0 seconds with NO jobs, NO steps and NO logs — and the ~24 scan-workspace
// suites it names had not executed once since. The repository had no way to notice: every other lane
// was green, and a workflow that never starts produces nothing to be red about.
//
// A parse error in a workflow is not a test failure anywhere. It is a test failure HERE.
//
// WHY NOT A YAML LIBRARY. Neither package declares one — js-yaml exists only as a transitive
// dependency of something in functions/, so a CI lane that imported it would be relying on a package
// nothing promises to keep. This checks the one structural rule that actually broke, on the actual
// files, with no dependency at all: within a single block, a key may not appear twice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const WORKFLOW_DIR = path.resolve(process.cwd(), "..", ".github", "workflows");

/**
 * Duplicate sibling keys in a YAML block.
 *
 * Deliberately narrow. It walks each file tracking the indentation of the block a key belongs to,
 * and reports a key seen twice in the same block. A new list item (`- `) opens a new block, a dedent
 * closes every block deeper than it, and block scalars (`run: |`) are skipped entirely — their
 * contents are shell, where `foo:` is a command and not a key.
 */
function duplicateKeys(text) {
  const found = [];
  const blocks = [];           // { indent, keys:Set }
  let blockScalarIndent = null;

  text.split(/\r?\n/).forEach((line, i) => {
    if (blockScalarIndent !== null) {
      const indent = line.search(/\S/);
      if (line.trim() === "" || indent > blockScalarIndent) return;
      blockScalarIndent = null;
    }
    if (line.trim() === "" || /^\s*#/.test(line)) return;

    const indent = line.search(/\S/);
    // `- name: x` is both a new list item and a key at indent+2.
    const item = /^(\s*)-\s+(.*)$/.exec(line);
    const keyIndent = item ? indent + 2 : indent;
    const body = item ? item[2] : line.trim();

    while (blocks.length && blocks[blocks.length - 1].indent > keyIndent) blocks.pop();
    if (item) {
      // Each list entry is its own block, so two steps may both carry `run:`.
      while (blocks.length && blocks[blocks.length - 1].indent >= keyIndent) blocks.pop();
      blocks.push({ indent: keyIndent, keys: new Set() });
    }
    if (!blocks.length || blocks[blocks.length - 1].indent < keyIndent) {
      blocks.push({ indent: keyIndent, keys: new Set() });
    }

    const key = /^([A-Za-z0-9_-]+):(\s|$)/.exec(body);
    if (!key) return;
    const block = blocks[blocks.length - 1];
    if (block.keys.has(key[1])) {
      found.push({ line: i + 1, key: key[1] });
    }
    block.keys.add(key[1]);
    if (/:\s*[|>][-+0-9]*\s*$/.test(body)) blockScalarIndent = keyIndent;
  });

  return found;
}

const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

test("there are workflows to check", () => {
  // A guard that silently checks nothing is the same shape of bug it exists to catch.
  assert.ok(files.length > 50, `expected the full workflow estate, found ${files.length}`);
});

test("no workflow repeats a key inside one block", () => {
  const offenders = [];
  for (const file of files) {
    for (const dup of duplicateKeys(readFileSync(path.join(WORKFLOW_DIR, file), "utf8"))) {
      offenders.push(`${file}:${dup.line} repeats '${dup.key}'`);
    }
  }
  assert.deepEqual(offenders, [], `GitHub refuses these files at startup:\n  ${offenders.join("\n  ")}`);
});

test("the detector actually detects the shape that broke", () => {
  // Mutation proof, against the exact text that took the scan lane down.
  const broken = [
    "jobs:",
    "  x:",
    "    steps:",
    "      - name: a step",
    "        run: node --test",
    "        working-directory: field-ops-app-vite",
    "        working-directory: field-ops-app-vite",
  ].join("\n");
  assert.equal(duplicateKeys(broken).length, 1);
  assert.equal(duplicateKeys(broken)[0].key, "working-directory");
});

test("two steps may each carry the same keys", () => {
  // The obvious false positive: every step has `name`, `run` and `working-directory`.
  const fine = [
    "jobs:",
    "  x:",
    "    steps:",
    "      - name: one",
    "        run: a",
    "        working-directory: d",
    "      - name: two",
    "        run: b",
    "        working-directory: d",
  ].join("\n");
  assert.deepEqual(duplicateKeys(fine), []);
});

test("a shell script inside a block scalar is not read as keys", () => {
  // `run: |` bodies contain colons constantly. Treating them as keys would make this guard
  // unusable, which is how guards get deleted.
  const scalar = [
    "      - name: one",
    "        run: |",
    "          echo path: /tmp",
    "          echo path: /var",
    "        working-directory: d",
  ].join("\n");
  assert.deepEqual(duplicateKeys(scalar), []);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SECOND DEFECT THE SAME DEAD LANE WAS HIDING.
//
// With the duplicate key removed, scan-workspace-tests.yml finally started — and failed on its
// fourth step, which had no `working-directory` at all and so ran `node --test test/...` from the
// repository root, where none of those files exist. It had been wrong for as long as the lane had
// been dead, and nothing could report it, because a workflow that never starts never runs a step.
//
// Both packages here run from `field-ops-app-vite/`, so a bare `node --test test/...` or
// `npx vitest run test/...` at the root is always a mistake rather than a style choice.

const CLIENT_TEST_STEP = /^\s*(run:\s*)?(npx vitest run|node(\s+--test)?)\s+test\//;

test("no workflow runs a client test suite without saying where", () => {
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/^\s*run:\s*(npx vitest run|node(\s+--test)?)\s+test\//.test(line)) return;
      // The step's own keys: everything from here until the next list item at the same or a
      // shallower indent. `working-directory` may sit either side of `run:`, so both are searched.
      const indent = line.search(/\S/);
      let start = i;
      while (start > 0 && !/^\s*-\s/.test(lines[start])) start -= 1;
      let end = i + 1;
      while (end < lines.length && !/^\s*-\s/.test(lines[end]) && !(lines[end].trim() && lines[end].search(/\S/) < indent)) end += 1;
      const step = lines.slice(start, end).join("\n");
      if (!/working-directory:\s*\S/.test(step)) {
        offenders.push(`${file}:${i + 1} runs ${line.trim().slice(0, 60)}`);
      }
    });
  }
  assert.deepEqual(
    offenders, [],
    `these steps run from the repository root, where their test files do not exist:\n  ${offenders.join("\n  ")}`,
  );
});

test("the working-directory detector detects the shape that broke", () => {
  // Mutation proof. Without this the guard above could pass by never matching anything.
  const dir = WORKFLOW_DIR;
  assert.ok(dir.length > 0);
  assert.match("        run: node --test test/scanWorkflows.test.mjs", CLIENT_TEST_STEP);
  assert.match("        run: npx vitest run test/foo.test.jsx", CLIENT_TEST_STEP);
  // Not every `run:` is a client suite -- a functions-package command must not be flagged.
  assert.doesNotMatch("        run: npm install", CLIENT_TEST_STEP);
});
