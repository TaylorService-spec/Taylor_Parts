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

// ── The COMMITTED backlog: assert the INVARIANT, never the moment ────────────────────────────────
//
// This test used to pin the backlog's state on the day it was written — `readyItemIds` deepEqual
// `[]`, selectorState "CHECKPOINT", terminalCheckpoint true, with the comment "last selection
// reached terminal CHECKPOINT". That is a snapshot of a MOMENT wearing the clothes of a CONTRACT,
// and it broke the moment the backlog did its job: PR #1344 registered three evidenced workstreams
// (SCANNER-ENTRY-POINT, ACCESS-MANAGER-PHASE-A, OBJECT-MANAGER-PHASE-A), the ledger correctly moved
// from terminal CHECKPOINT to 6 READY / RUN, and this assertion called that a failure.
//
// It stayed red on main for nine days because the workflow running it did not list
// execution-backlog.md among its trigger paths — the contract could not see the input it asserts on.
// Both halves are repaired: the trigger now covers the file, and the assertion now states something
// that survives a moving backlog.
//
// The SELECTOR BEHAVIOUR itself is not weakened by this: the four fixture tests below cover every
// decision the authority can reach — empty-with-gates -> CHECKPOINT, a READY item -> RUN, a RUNNING
// item -> RUN, blocked/Owner-only -> CHECKPOINT, truly-empty -> ROADMAP_COMPLETE. Pinning a fifth
// copy of one of those against live data added no coverage; it only added a tripwire on ordinary
// backlog movement.
//
// What only the REAL file can prove, and what is asserted here instead:
//   * it still parses into the shape every consumer depends on;
//   * this repository genuinely has recorded Owner gates and protected actions;
//   * the selector fields reported by deriveCurrentState are DERIVED from the authority rather than
//     stored alongside it — the failure mode where a stale cached state and a live ledger disagree.
test("against the COMMITTED backlog: it parses, real gates exist, and the selector agrees with the authority", () => {
  const s = deriveCurrentState({ backlogText: backlog, sourceCommit: "x", originMainCommit: "x", mapVersion: "1.0.0" });

  assert.ok(Array.isArray(s.derived.readyItemIds), "the committed backlog must still parse");
  assert.ok(Array.isArray(s.derived.activeAssignmentIds));

  // Durable facts about THIS repository rather than about today: gates are recorded, not implied.
  assert.ok(s.derived.ownerDecisionIds.length >= 1, "real OWNER_DECISION rows exist");
  assert.ok(s.derived.protectedActionIds.length >= 1, "real PROTECTED_ACTION rows exist");

  // The reported selector state must BE the authority's answer, not a second opinion.
  const authority = deriveSelectorInterpretation(s.derived);
  assert.equal(s.selectorState, authority.selectorState);
  assert.equal(s.terminalCheckpoint, authority.terminalCheckpoint);
  assert.equal(s.selectorHint, authority.selectorHint);

  // And the one thing that must never be true at once: a terminal CHECKPOINT claimed while READY
  // work is registered. That is the failure the 2026-08-09 UX-workstream note describes — a
  // CHECKPOINT reached only because the ledger was incomplete.
  if (s.derived.readyItemIds.length > 0) {
    assert.equal(s.terminalCheckpoint, false, "READY work is registered, so this is not a terminal CHECKPOINT");
  }
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
