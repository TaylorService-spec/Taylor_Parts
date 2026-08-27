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

test("every view has a label, and the vocabulary is closed BOTH WAYS", () => {
  // Widened 2026-08-27 for North Star Workspace P1: `attention` and `decision` are the two views
  // the workspace tabs need, and both are slices of derivations this module already owns.
  assert.deepEqual(
    Object.keys(OPPORTUNITY_VIEW_LABEL).sort(),
    ["all", "attention", "decision", "lost", "open", "won"],
  );
  // Closed BOTH ways, which the previous version only half-asserted: every view needs a label,
  // AND every label must name a real view. A label with no view behind it is a tab that selects
  // nothing, and normalizeOpportunityView would silently send it to OPEN.
  for (const v of Object.values(OPPORTUNITY_VIEW)) assert.ok(OPPORTUNITY_VIEW_LABEL[v], `${v} needs a label`);
  const views = new Set(Object.values(OPPORTUNITY_VIEW));
  for (const key of Object.keys(OPPORTUNITY_VIEW_LABEL)) {
    assert.ok(views.has(key), `${key} is labelled but is not a view`);
  }
  // And every view must state its own emptiness -- the four-emptinesses rule this file already
  // holds for the original set.
  for (const v of Object.values(OPPORTUNITY_VIEW)) {
    assert.ok(OPPORTUNITY_EMPTY_TEXT[v], `${v} needs an empty sentence`);
  }
});

test("the two workspace views slice the SAME derivation the rows and counts use", () => {
  // The falsifiable form of "no new pipeline authority". Needs Attention must equal the rows the
  // pipeline already flagged, and At Decision the rows already at the governed DECISION stage --
  // never a second opinion computed for the tab.
  const p = build(SANDBOX);
  const attention = selectOpportunityView(p, OPPORTUNITY_VIEW.NEEDS_ATTENTION).rows;
  const decision = selectOpportunityView(p, OPPORTUNITY_VIEW.AT_DECISION).rows;
  assert.deepEqual(attention, p.rows.filter((r) => r.attentionTone === "attention"));
  assert.deepEqual(decision, p.rows.filter((r) => r.stage === "DECISION"));
  // The header count and the tab must agree, because they read one number.
  assert.equal(attention.length, p.counts.needsAttention);
  assert.equal(decision.length, p.stageCounts.DECISION);
  // Both are slices of OPEN work: a closed deal raises no attention and is past Decision.
  for (const row of [...attention, ...decision]) assert.equal(row.commercial.closed, false);
});

test("an empty attention view reads as good news, not as a broken filter", () => {
  const p = build(SANDBOX);
  const v = selectOpportunityView(p, OPPORTUNITY_VIEW.NEEDS_ATTENTION);
  if (v.rows.length === 0) {
    assert.match(OPPORTUNITY_EMPTY_TEXT[v.emptyReason] ?? "", /Nothing needs attention|No opportunities yet/);
  }
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
