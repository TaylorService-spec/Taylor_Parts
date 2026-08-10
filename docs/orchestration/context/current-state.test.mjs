import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveCurrentState, extractSectionItems } from "./current-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const backlog = readFileSync(join(here, "..", "execution-backlog.md"), "utf8");

const FIXTURE = `# x
## READY
| # | Item | Why READY | Next |
|---|---|---|---|
| 1 | Alpha widget | ok | go |
| 2 | ~~Beta~~ | done | — |

## OWNER_DECISION
| Item | Decision needed |
|---|---|
| Gamma gate | choose |
| *(none)* | — |
`;

test("extractSectionItems finds the 'Item' column even when it is not column 0 (READY)", () => {
  const items = extractSectionItems(FIXTURE, "READY");
  assert.deepEqual(items, ["Alpha widget"]); // struck "Beta" excluded
});

test("extractSectionItems excludes *(none)* and reads column 0 when Item is first (OWNER_DECISION)", () => {
  const items = extractSectionItems(FIXTURE, "OWNER_DECISION");
  assert.deepEqual(items, ["Gamma gate"]);
});

test("deriveCurrentState is a pure POINTER with provenance + freshness", () => {
  const s = deriveCurrentState({ backlogText: FIXTURE, sourceCommit: "aaa", originMainCommit: "aaa", mapVersion: "1.0.0" });
  assert.equal(s.pointer, "EOS-CURRENT-STATE/1.0.0");
  assert.equal(s.provenance.freshness, "CURRENT");
  assert.equal(s.provenance.mapVersion, "1.0.0");
  assert.deepEqual(s.derived.readyItemIds, ["Alpha widget"]);
  assert.deepEqual(s.derived.ownerGateIds, ["Gamma gate"]); // owner_decision ∪ protected_action
  // it points at the authority, it does not replace it
  assert.match(s.authorities.currentStateAuthority, /execution-backlog\.md/);
});

test("freshness is BEHIND_OR_DIVERGED when source != origin/main, UNKNOWN when either is missing", () => {
  assert.equal(deriveCurrentState({ backlogText: FIXTURE, sourceCommit: "a", originMainCommit: "b" }).provenance.freshness, "BEHIND_OR_DIVERGED");
  assert.equal(deriveCurrentState({ backlogText: FIXTURE, sourceCommit: null, originMainCommit: "b" }).provenance.freshness, "UNKNOWN");
});

test("against the COMMITTED backlog: READY is empty (terminal CHECKPOINT), Owner gates are populated", () => {
  const s = deriveCurrentState({ backlogText: backlog, sourceCommit: "x", originMainCommit: "x", mapVersion: "1.0.0" });
  assert.deepEqual(s.derived.readyItemIds, []);              // last selection reached terminal CHECKPOINT
  assert.ok(s.derived.ownerDecisionIds.length >= 1);         // real OWNER_DECISION rows exist
  assert.ok(s.derived.protectedActionIds.length >= 1);       // real PROTECTED_ACTION rows exist
  assert.match(s.selectorHint, /terminal CHECKPOINT/);
});
