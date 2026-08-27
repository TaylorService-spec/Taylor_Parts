// WON AND LOST OPPORTUNITIES ARE REACHABLE, WITHOUT DILUTING THE QUEUE.
// Run: node --test test/opportunityHistoryViews.test.mjs
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// buildOpportunityPipeline returns `rows: open`, and the table rendered `rows`. WON and LOST fed
// the summary tiles and nothing else, and `all` was only ever used to re-find an already-selected
// id — never listed. So a closed opportunity could not be opened at all.
//
// In sandbox that meant 0 open / 7 WON / 1 LOST and NO reachable Opportunity detail anywhere, which
// took the Sales Order lineage link and the Sales Agreement panel down with it. Observed live.
//
// The fix is a VIEW over facts that already exist. These cases hold that line: the selector must
// FILTER `all`, never re-derive stage, attention or closure, because a second derivation is how two
// screens come to disagree about one deal.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpportunityPipeline,
  selectOpportunityView,
  normalizeOpportunityView,
  OPPORTUNITY_VIEW,
  OPPORTUNITY_VIEW_LABEL,
  OPPORTUNITY_EMPTY_TEXT,
} from "../src/domain/opportunityLifecycle.js";

/** The sandbox shape that exposed this: nothing open, seven won, one lost. */
const opp = (id, over = {}) => ({
  id,
  accountId: "acct-1",
  ownerEmployeeId: "emp-1",
  salesChannel: "RETAIL",
  stage: "DECISION",
  outcome: null,
  lines: [{ kind: "PART", ref: "P1", qty: 1 }],
  ...over,
});
const SANDBOX = [
  ...Array.from({ length: 7 }, (_, i) => opp(`won-${i}`, { outcome: "WON" })),
  opp("lost-1", { outcome: "LOST" }),
];
// Open work alongside closed, so the P1v4 slices can be shown NOT to reach into history. One deal
// is deliberately overdue with no next action, which is what `deriveAttention` flags.
const MIXED = [
  ...SANDBOX,
  opp("open-decision", { stage: "DECISION", expectedCloseAt: 1_755_000_000_000, nextAction: "Present" }),
  opp("open-quoting", { stage: "QUOTING", expectedCloseAt: 1_755_000_000_000, nextAction: "Send quote" }),
  opp("open-overdue", { stage: "SOLUTION", expectedCloseAt: 1_754_000_000_000, nextAction: null }),
];
const build = (list) => buildOpportunityPipeline(list, { nowMillis: 1_754_600_000_000, accountNameById: {} });

// ═════════════════════════════════════════ the sandbox case, exactly

test("THE 0-OPEN / 7-WON / 1-LOST FIXTURE MAKES CLOSED WORK REACHABLE", () => {
  const p = build(SANDBOX);
  // The state that produced an unreachable detail pane.
  assert.equal(p.rows.length, 0, "no open work — the operational queue is genuinely empty");
  assert.equal(p.counts.won, 7);
  assert.equal(p.counts.lost, 1);

  assert.equal(selectOpportunityView(p, OPPORTUNITY_VIEW.WON).rows.length, 7);
  assert.equal(selectOpportunityView(p, OPPORTUNITY_VIEW.LOST).rows.length, 1);
  assert.equal(selectOpportunityView(p, OPPORTUNITY_VIEW.ALL).rows.length, 8);
  // And the queue still says what it always said.
  assert.equal(selectOpportunityView(p, OPPORTUNITY_VIEW.OPEN).rows.length, 0);
});

test("OPEN REMAINS THE DEFAULT, and an unknown view does not break the page", () => {
  // The pipeline is a work queue first; history is somewhere you go.
  assert.equal(normalizeOpportunityView(undefined), OPPORTUNITY_VIEW.OPEN);
  assert.equal(normalizeOpportunityView(""), OPPORTUNITY_VIEW.OPEN);
  assert.equal(normalizeOpportunityView("nonsense"), OPPORTUNITY_VIEW.OPEN);
  // A hand-edited or stale URL normalises rather than throwing at the router.
  assert.equal(normalizeOpportunityView("WON"), OPPORTUNITY_VIEW.WON, "case-insensitive");
  assert.equal(normalizeOpportunityView(" lost "), OPPORTUNITY_VIEW.LOST, "trimmed");
  assert.equal(selectOpportunityView(build(SANDBOX), "nonsense").view, OPPORTUNITY_VIEW.OPEN);
});

// ═════════════════════════════════════════ it filters, it does not re-derive

test("EVERY VIEW SHOWS THE SAME ROW OBJECTS the pipeline already built", () => {
  // Identity, not equality. A view that constructed its own rows could disagree with the queue
  // about a deal's stage or attention, and the two screens would both look right.
  const p = build([...SANDBOX, opp("open-1")]);
  const all = selectOpportunityView(p, OPPORTUNITY_VIEW.ALL).rows;
  for (const row of all) assert.ok(p.all.includes(row), `${row.id} must be the pipeline's own row object`);
  const openRows = selectOpportunityView(p, OPPORTUNITY_VIEW.OPEN).rows;
  assert.equal(openRows, p.rows, "the OPEN view IS the operational queue, not a copy of it");
});

test("the views partition the population — nothing is invented and nothing is lost", () => {
  const p = build([...SANDBOX, opp("open-1"), opp("open-2")]);
  const n = (v) => selectOpportunityView(p, v).rows.length;
  assert.equal(n(OPPORTUNITY_VIEW.OPEN) + n(OPPORTUNITY_VIEW.WON) + n(OPPORTUNITY_VIEW.LOST), n(OPPORTUNITY_VIEW.ALL));
  assert.equal(n(OPPORTUNITY_VIEW.ALL), 10);
});

test("selecting a view CHANGES NOTHING about the opportunities", () => {
  // A filter is a question, not a write. Frozen input proves no view mutates a row in place.
  const source = SANDBOX.map((o) => Object.freeze({ ...o }));
  const p = build(source);
  const before = JSON.stringify(p.all);
  for (const v of Object.values(OPPORTUNITY_VIEW)) selectOpportunityView(p, v);
  assert.equal(JSON.stringify(p.all), before);
});

// ═════════════════════════════════════════ four emptinesses, four sentences

test("EACH EMPTY STATE NAMES ITS OWN FACT", () => {
  // "Nothing here" tells a new tenant their data failed to load and an established one their
  // pipeline is broken. These are different facts with different next actions.
  const none = build([]);
  for (const v of Object.values(OPPORTUNITY_VIEW)) {
    assert.equal(selectOpportunityView(none, v).emptyReason, "none",
      "no opportunities at all outranks the per-view answer");
  }

  const wonOnly = build([opp("w", { outcome: "WON" })]);
  assert.equal(selectOpportunityView(wonOnly, OPPORTUNITY_VIEW.OPEN).emptyReason, "open");
  assert.equal(selectOpportunityView(wonOnly, OPPORTUNITY_VIEW.LOST).emptyReason, "lost");
  assert.equal(selectOpportunityView(wonOnly, OPPORTUNITY_VIEW.WON).emptyReason, null, "not empty");

  // Every reason has copy, and no two views share a sentence.
  const texts = ["none", "open", "won", "lost"].map((r) => OPPORTUNITY_EMPTY_TEXT[r]);
  assert.ok(texts.every(Boolean), "every empty reason has a sentence");
  assert.equal(new Set(texts).size - 1, 3, "only `none` and `all` may share copy");
  // The open case points the reader at the way out, which is the whole reason the defect was
  // invisible: the screen said "No open opportunities" and offered nowhere to go.
  assert.match(OPPORTUNITY_EMPTY_TEXT.open, /Won or Lost/);
});

test("every view has a label, and the vocabulary is closed", () => {
  // EXTENDED by North Star P1v4 with the two operational slices its state view names. The list is
  // still exhaustive on purpose: a view added without a label renders a blank tab, and a view added
  // without a thought about `OPPORTUNITY_EMPTY_TEXT` renders somebody else's empty sentence.
  assert.deepEqual(
    Object.keys(OPPORTUNITY_VIEW_LABEL).sort(),
    ["all", "at_decision", "lost", "mine", "needs_attention", "open", "won"],
  );
  for (const v of Object.values(OPPORTUNITY_VIEW)) assert.ok(OPPORTUNITY_VIEW_LABEL[v], `${v} needs a label`);
  // Every view must also own an empty sentence, or an empty slice borrows another view's words.
  for (const v of Object.values(OPPORTUNITY_VIEW)) assert.ok(OPPORTUNITY_EMPTY_TEXT[v], `${v} needs empty text`);
  // The viewer-scoped view has a SECOND reason -- unresolved identity -- which is not a view name
  // and so is easy to add without copy. It must never fall through to another view's sentence.
  assert.ok(OPPORTUNITY_EMPTY_TEXT.mine_unresolved);
  assert.notEqual(OPPORTUNITY_EMPTY_TEXT.mine_unresolved, OPPORTUNITY_EMPTY_TEXT.mine);
});

test("MINE is viewer-scoped, and an unresolved viewer is not an empty queue", () => {
  const p = build([...MIXED, opp("mine-1", { ownerEmployeeId: "emp-me", stage: "QUOTING" })]);
  // Known viewer: only their open work.
  const mine = selectOpportunityView(p, OPPORTUNITY_VIEW.MINE, { viewerEmployeeId: "emp-me" });
  assert.deepEqual(mine.rows.map((r) => r.id), ["mine-1"]);

  // Unknown viewer: NOT zero rows silently. A real account can have no linked employee record, and
  // "you have no opportunities" would be a confident false statement about their work.
  const unknown = selectOpportunityView(p, OPPORTUNITY_VIEW.MINE, { viewerEmployeeId: null });
  assert.equal(unknown.rows.length, 0);
  assert.equal(unknown.emptyReason, "mine_unresolved");

  // But an empty COLLECTION still outranks it — that is a different, larger fact.
  assert.equal(selectOpportunityView(build([]), OPPORTUNITY_VIEW.MINE).emptyReason, "none");
});

// ═════════════════════════════════════════ the two operational slices (P1v4)

test("NEEDS ATTENTION and AT DECISION are slices of the OPEN queue, never of history", () => {
  // A won or lost deal cannot need attention and is not awaiting a decision. Drawing these from
  // `all` would put closed work in front of a salesperson under a heading saying it is outstanding.
  const p = build(MIXED);
  const open = new Set(p.rows.map((r) => r.id));
  for (const view of [OPPORTUNITY_VIEW.NEEDS_ATTENTION, OPPORTUNITY_VIEW.AT_DECISION]) {
    // NOT VACUOUS: a loop over an empty slice passes without asserting anything, so the fixture is
    // required to actually populate both slices before the containment check means a thing.
    assert.ok(selectOpportunityView(p, view).rows.length > 0, `${view} must be populated to be tested`);
    for (const row of selectOpportunityView(p, view).rows) {
      assert.ok(open.has(row.id), `${row.id} in ${view} is not an open opportunity`);
      assert.equal(row.commercial.closed, false);
    }
  }
});

test("the slices RE-DERIVE NOTHING — they filter on facts the pipeline already decided", () => {
  const p = build(MIXED);
  const attention = selectOpportunityView(p, OPPORTUNITY_VIEW.NEEDS_ATTENTION).rows;
  const decision = selectOpportunityView(p, OPPORTUNITY_VIEW.AT_DECISION).rows;
  assert.ok(attention.length > 0 && decision.length > 0, "fixture must populate both slices");
  // Same row OBJECTS, not equal copies: identity is what proves no second derivation happened.
  for (const row of attention) assert.ok(p.rows.includes(row));
  for (const row of decision) assert.ok(p.rows.includes(row));
  assert.deepEqual(attention.map((r) => r.id), p.rows.filter((r) => r.attentionTone === "attention").map((r) => r.id));
  assert.deepEqual(decision.map((r) => r.id), p.rows.filter((r) => r.stage === "DECISION").map((r) => r.id));
});

// ═════════════════════════════════════════ closed stays closed

test("REACHABLE IS NOT EDITABLE — a closed opportunity keeps its terminal semantics", async () => {
  // Making history browseable must not hand anybody a pencil on a WON deal: its terms are what the
  // Sales Order was derived from, and editing them afterwards would make the two disagree with no
  // record of which is right.
  const { isOpportunityEditable } = await import("../src/domain/opportunitySectionSave.js");
  const p = build(SANDBOX);
  for (const row of selectOpportunityView(p, OPPORTUNITY_VIEW.ALL).rows) {
    assert.equal(row.commercial.closed, true);
    assert.equal(isOpportunityEditable(row), false, `${row.id} is closed and must not be editable`);
  }
});

// ═════════════════════════════════════════ the owner is a person, not a key

test("THE OWNER DISPLAY IS NEVER THE EMPLOYEE ID", async () => {
  // DECISIONS #106, found live by the dynamic-detail sweep: the detail rendered
  // `95kFz8WWgiSn2nU2O3Ml` where a name belongs. TWO sites had it -- the ContextBand fact and this
  // field model -- and fixing the first is exactly why the second survived: the page looked fixed
  // while the sweep kept reporting RAW_ID on it.
  const { opportunityDetailModel } = await import("../src/domain/opportunityFieldModel.js");
  const { UNRESOLVED_REFERENCE_LABEL } = await import("../src/metadata/referenceResolution.js");
  const EMPLOYEE_ID = "95kFz8WWgiSn2nU2O3Ml"; // the real one, from the live sandbox page
  const ownerField = (opts) =>
    opportunityDetailModel({ id: "o1", ownerEmployeeId: EMPLOYEE_ID, lines: [] }, opts)
      .sections.flatMap((s) => s.fields).find((f) => f.key === "ownerEmployeeId");

  // Resolved: the name, and nothing that looks like a key.
  const named = ownerField({ resolveOwnerName: () => "Mikael Andersson" });
  assert.equal(named.display, "Mikael Andersson");
  assert.notEqual(named.display, EMPLOYEE_ID);

  // UNRESOLVED: the shared label -- never the id filling the gap. This is the normal outcome for a
  // caller whose role cannot read the employees collection at all.
  for (const opts of [{}, { resolveOwnerName: () => null }, { resolveOwnerName: () => undefined }]) {
    const f = ownerField(opts);
    assert.equal(f.display, UNRESOLVED_REFERENCE_LABEL);
    assert.notEqual(f.display, EMPLOYEE_ID);
    assert.doesNotMatch(f.display, /\b[A-Za-z0-9]{20}\b/, "the display must not be id-shaped");
  }

  // THE VALUE KEEPS THE ID, because the owner picker edits by id. Only the display changed.
  assert.equal(ownerField({}).value, EMPLOYEE_ID);
});

test("no owner at all is an em dash, not an unresolved reference", () => {
  // "Nobody owns this" and "somebody owns it and we cannot name them" are different facts.
  return import("../src/domain/opportunityFieldModel.js").then(({ opportunityDetailModel }) => {
    const f = opportunityDetailModel({ id: "o1", ownerEmployeeId: null, lines: [] }, {})
      .sections.flatMap((s) => s.fields).find((x) => x.key === "ownerEmployeeId");
    assert.equal(f.display, "—");
  });
});
