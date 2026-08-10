import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveCurrentState, extractSectionItems, deriveSelectorInterpretation } from "./current-state.mjs";

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
  assert.equal(s.selectorState, "CHECKPOINT");
  assert.equal(s.terminalCheckpoint, true);
  assert.match(s.selectorHint, /terminal CHECKPOINT/);
});

// ── Selector interpretation is DERIVED from the selectNextWork AUTHORITY, never an empty-array shortcut.

test("selector: no READY + no RUNNING + gates present → terminal CHECKPOINT emitted", () => {
  const i = deriveSelectorInterpretation({ readyItemIds: [], activeAssignmentIds: [], ownerDecisionIds: ["Gate A"], protectedActionIds: [], blockedIds: [] });
  assert.equal(i.selectorState, "CHECKPOINT");
  assert.equal(i.terminalCheckpoint, true);
  assert.match(i.selectorHint, /no authorized READY work|No authorized READY work/i);
  assert.match(i.selectorHint, /do not manufacture autonomous work/i);
});

test("selector: a READY item exists → RUN, terminal CHECKPOINT NOT emitted", () => {
  const i = deriveSelectorInterpretation({ readyItemIds: ["Alpha"], activeAssignmentIds: [], ownerDecisionIds: ["Gate A"], protectedActionIds: [], blockedIds: [] });
  assert.equal(i.selectorState, "RUN");
  assert.equal(i.terminalCheckpoint, false);
});

test("selector: a RUNNING item exists → RUN, terminal CHECKPOINT NOT emitted", () => {
  const i = deriveSelectorInterpretation({ readyItemIds: [], activeAssignmentIds: ["asn-1"], ownerDecisionIds: [], protectedActionIds: [], blockedIds: [] });
  assert.equal(i.selectorState, "RUN");
  assert.equal(i.terminalCheckpoint, false);
});

test("selector: blocked/Owner/protected-only follows the selector authority (CHECKPOINT); truly-empty is ROADMAP_COMPLETE, not terminal CHECKPOINT", () => {
  // blocked-only → still a gate → CHECKPOINT
  const blockedOnly = deriveSelectorInterpretation({ readyItemIds: [], activeAssignmentIds: [], ownerDecisionIds: [], protectedActionIds: [], blockedIds: ["Dep X"] });
  assert.equal(blockedOnly.selectorState, "CHECKPOINT");
  assert.equal(blockedOnly.terminalCheckpoint, true);
  // protected-only → CHECKPOINT
  const protectedOnly = deriveSelectorInterpretation({ readyItemIds: [], activeAssignmentIds: [], ownerDecisionIds: [], protectedActionIds: ["Deploy Y"], blockedIds: [] });
  assert.equal(protectedOnly.selectorState, "CHECKPOINT");
  // NOTHING in any state → selector says ROADMAP_COMPLETE, NOT terminal CHECKPOINT (proves we do not
  // infer terminal state solely from empty arrays — the authority distinguishes them)
  const empty = deriveSelectorInterpretation({ readyItemIds: [], activeAssignmentIds: [], ownerDecisionIds: [], protectedActionIds: [], blockedIds: [] });
  assert.equal(empty.selectorState, "ROADMAP_COMPLETE");
  assert.equal(empty.terminalCheckpoint, false);
});
