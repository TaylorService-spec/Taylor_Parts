// TRACKED TREE HYGIENE: what it refuses, what it allows, and that the repository is clean now.
import test from "node:test";
import assert from "node:assert/strict";
import { trackedTreeViolations, scanTrackedTree } from "./trackedTreeHygiene.mjs";

const targets = {
  "functions/node_modules": "/home/someone/other-worktree/functions/node_modules",
  "docs/latest.md": "./2026/latest.md",
  "tools/escape": "../../outside",
  "win/link": "C:\\deps\\node_modules",
};
const scan = (rows) => trackedTreeViolations(rows, (p) => targets[p]);

test("the committed shape that caused this guard is refused: an absolute symlink named node_modules", () => {
  const v = scan([{ mode: "120000", path: "functions/node_modules" }]);
  assert.deepEqual(v.map((x) => x.reason.split(" (")[0]), ["tracked under node_modules", "symlink to an absolute path"]);
});

test("anything under a node_modules segment is refused; a name merely containing it is not", () => {
  assert.equal(scan([{ mode: "100644", path: "field-ops-app-vite/node_modules/react/index.js" }]).length, 1);
  assert.equal(scan([{ mode: "100644", path: "docs/node_modules-policy.md" }]).length, 0);
});

test("a symlink leaving the repository, or to a Windows absolute path, is refused", () => {
  assert.equal(scan([{ mode: "120000", path: "tools/escape" }])[0].reason, "symlink leaving the repository (../../outside)");
  assert.match(scan([{ mode: "120000", path: "win/link" }])[0].reason, /absolute path/);
});

test("a relative symlink that stays inside the repository is allowed", () => {
  assert.deepEqual(scan([{ mode: "120000", path: "docs/latest.md" }]), []);
});

test("the repository is clean now", () => {
  assert.deepEqual(scanTrackedTree(), []);
});
