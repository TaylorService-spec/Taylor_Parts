// THE FIVE FEATURES CONVERGED INTO src/metadata/ — and the proof each guard bites.
//
// GOVERNANCE: docs/architecture/ADR-013-object-list-metadata-authority.md §2.
//
//   1. URL-backed list state          metadata/listUrlState.js
//   2. named unsupported reasons      metadata/unsupportedReason.js
//   3. the gap register               metadata/gapRegister.js
//   4. dropped-criteria reporting     metadata/listUrlState.js
//   5. structured absence             metadata/absence.js
//
// ============================ THE MUTATION PROOFS ============================
//
// Half of these are guards, and a guard that has never been seen to fail is a guard nobody knows is
// broken. So each one is also exercised against a definition deliberately built wrong — an
// unexplained refusal, a blocked field left exportable, a gap with no evidence, a quantity coerced to
// zero. If a `deliberately wrong` case ever passes quietly, the corresponding guarantee is gone.

import test from "node:test";
import assert from "node:assert/strict";

import {
  makeEntityDefinition, makeFieldDefinition, makeIdentity, validateEntityDefinition,
  validateFieldDefinition,
} from "../src/metadata/entityDefinition.js";
import { makeListViewDefinition, makeColumn, makeFilter, makeSort } from "../src/metadata/listViewDefinition.js";
import {
  UNSUPPORTED_REASON, UNSUPPORTED_TEXT, isUnsupportedReason, unsupportedExplanation,
} from "../src/metadata/unsupportedReason.js";
import { makeGap, validateGap, collectGaps, gapsForField, GAP_SEVERITY } from "../src/metadata/gapRegister.js";
import { ABSENCE, ABSENCE_TEXT, isPresentNumber, resolveValue, displayValue } from "../src/metadata/absence.js";
import {
  toSearchParams, fromSearchParams, makeCriterion, addFilter, removeFilter, clearFilters, setSort,
  setSearch, activeCriteriaCount, hasActiveCriteria, describeCriterion, describeDropped,
  DROP_REASON, EMPTY_CRITERIA,
} from "../src/metadata/listUrlState.js";

// ── a small, real-shaped fixture ──────────────────────────────────────────────

const entity = () => makeEntityDefinition({
  id: "widget", label: "Widget", collection: "widgets", readVia: "CLIENT_DIRECT",
  identity: makeIdentity({ nameField: "name" }),
  fields: [
    makeFieldDefinition({ id: "name", entityId: "widget", label: "Name", type: "STRING", sortable: true, defaultVisible: true }),
    makeFieldDefinition({
      id: "status", entityId: "widget", label: "Status", type: "ENUM",
      enumValues: ["ACTIVE", "RETIRED"], enumLabels: { ACTIVE: "Active", RETIRED: "Retired" },
      filterable: true, operators: ["EQUALS"], sortable: true, defaultVisible: true,
    }),
    makeFieldDefinition({
      id: "notes", entityId: "widget", label: "Notes", type: "TEXT",
      unsupportedFilterReason: UNSUPPORTED_REASON.NEEDS_INDEX,
      unsupportedSortReason: UNSUPPORTED_REASON.NO_CANONICAL_ORDER,
      absence: ABSENCE.NOT_RECORDED,
    }),
    makeFieldDefinition({
      id: "ownerName", entityId: "widget", label: "Owner", type: "STRING",
      unsupportedFilterReason: UNSUPPORTED_REASON.NOT_PROJECTED,
      unsupportedSortReason: UNSUPPORTED_REASON.NOT_PROJECTED,
      absence: ABSENCE.UNRESOLVED,
    }),
    makeFieldDefinition({
      id: "cost", entityId: "widget", label: "Cost", type: "CURRENCY_MINOR",
      displayable: false, reportable: false, exportable: false,
      unsupportedFilterReason: UNSUPPORTED_REASON.NO_AUTHORITY,
      unsupportedSortReason: UNSUPPORTED_REASON.NO_AUTHORITY,
    }),
    makeFieldDefinition({
      id: "secretRate", entityId: "widget", label: "Rate", type: "NUMBER",
      readCapability: "finance.read",
      unsupportedFilterReason: UNSUPPORTED_REASON.NOT_AUTHORIZED,
      unsupportedSortReason: UNSUPPORTED_REASON.NOT_AUTHORIZED,
    }),
  ],
  gaps: [
    makeGap({
      id: "WIDGET_COST_NOT_AUTHORITATIVE",
      title: "Widgets carry no cost",
      entityId: "widget", fieldId: "cost",
      severity: GAP_SEVERITY.MISSING_AUTHORITY,
      reason: UNSUPPORTED_REASON.NO_AUTHORITY,
      finding: "No cost field exists on the widget document.",
      refused: "Deriving one from a supplier price and calling it cost.",
    }),
  ],
});

const list = () => makeListViewDefinition({
  id: "widget.index", entityId: "widget", label: "Widgets", surface: "INDEX",
  columns: [makeColumn({ fieldId: "name" }), makeColumn({ fieldId: "status" })],
  filters: [makeFilter({ fieldId: "status", operators: ["EQUALS"] })],
  defaultSort: [makeSort({ fieldId: "name", direction: "ASC" })],
  pageSize: 25,
});

// ═════════════════════════════════ 1 + 4 — URL state and dropped criteria

test("criteria survive a URL round trip", () => {
  let c = addFilter(EMPTY_CRITERIA, makeCriterion({ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }));
  c = setSort(c, "name", "DESC");
  c = setSearch(c, "bolt");

  const parsed = fromSearchParams(toSearchParams(c).toString(), list(), entity());
  assert.deepEqual(parsed.filters.map((f) => f.fieldId), ["status"]);
  assert.deepEqual(parsed.sort, [{ fieldId: "name", direction: "DESC" }]);
  assert.equal(parsed.search, "bolt");
  assert.deepEqual(parsed.dropped, []);
});

test("unrelated query params survive — a list does not own the whole address", () => {
  const params = toSearchParams(EMPTY_CRITERIA, "tab=history&scrollTo=42").toString();
  assert.ok(params.includes("tab=history"));
  assert.ok(params.includes("scrollTo=42"));
});

test("a field this build no longer has is DROPPED and REPORTED", () => {
  const parsed = fromSearchParams("f=ghost:EQUALS:x", list(), entity());
  assert.deepEqual(parsed.filters, []);
  assert.equal(parsed.dropped[0].reason, DROP_REASON.UNKNOWN_FIELD);
  // The label falls back to the field id — there is nothing else to call a field this build does not
  // know, and saying nothing would be worse.
  assert.equal(parsed.dropped[0].label, "ghost");
});

test("an unsupported field carries its OWN reason as the detail", () => {
  const parsed = fromSearchParams("f=notes:EQUALS:x", list(), entity());
  assert.equal(parsed.dropped[0].reason, DROP_REASON.UNSUPPORTED);
  assert.equal(parsed.dropped[0].detail, UNSUPPORTED_REASON.NEEDS_INDEX);
  // Two levels: what happened at the URL, and what would fix it.
  assert.match(describeDropped(parsed.dropped), /index that has not been set up/i);
});

test("a filterable field this LIST does not offer is NOT_OFFERED, not unsupported", () => {
  // The distinction matters: the object can be filtered by it; this list has no index for it.
  const wide = makeEntityDefinition({
    ...entity(),
    fields: [...entity().fields, makeFieldDefinition({
      id: "region", entityId: "widget", label: "Region", type: "STRING",
      filterable: true, operators: ["EQUALS"],
    })],
  });
  const parsed = fromSearchParams("f=region:EQUALS:west", list(), wide);
  assert.equal(parsed.dropped[0].reason, DROP_REASON.NOT_OFFERED);
});

test("an operator the list did not declare is refused", () => {
  const parsed = fromSearchParams("f=status:IN:ACTIVE", list(), entity());
  assert.deepEqual(parsed.filters, []);
  assert.equal(parsed.dropped[0].reason, DROP_REASON.OPERATOR_NOT_ALLOWED);
});

test("a malformed record is dropped without throwing", () => {
  const parsed = fromSearchParams("f=garbage&f=also:garbage", list(), entity());
  assert.deepEqual(parsed.filters, []);
  assert.equal(parsed.dropped.length, 2);
  assert.ok(parsed.dropped.every((d) => d.reason === DROP_REASON.MALFORMED));
});

test("a capability resolver that THROWS denies rather than allows", () => {
  const parsed = fromSearchParams("f=secretRate:EQUALS:5", list(), entity(), {
    hasCapability: () => { throw new Error("resolver exploded"); },
  });
  assert.deepEqual(parsed.filters, []);
  assert.equal(parsed.dropped[0].reason, DROP_REASON.NOT_AUTHORIZED);
  // And the message says NOTHING about the value — the point is that this viewer is not entitled.
  assert.doesNotMatch(describeDropped(parsed.dropped), /5/);
});

test("the dropped message says the list is BROADER than requested", () => {
  const parsed = fromSearchParams("f=notes:EQUALS:x", list(), entity());
  // Naming the dropped field without saying what it does to the RESULT leaves the reader to work out
  // the consequence, and the consequence is the whole reason the message exists.
  assert.match(describeDropped(parsed.dropped), /broader than requested/i);
  assert.equal(describeDropped([]), null);
});

test("a chip re-resolves its label, so a shared link never shows a storage token", () => {
  const parsed = fromSearchParams("f=status:EQUALS:ACTIVE", list(), entity());
  // A URL carries no valueLabel. Without re-resolution this reads "Status: ACTIVE".
  assert.equal(describeCriterion(parsed.filters[0], entity()), "Status: Active");
});

test("criteria transitions replace rather than stack, and clearing clears the search too", () => {
  let c = addFilter(EMPTY_CRITERIA, makeCriterion({ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }));
  c = addFilter(c, makeCriterion({ fieldId: "status", operator: "EQUALS", value: "RETIRED" }));
  assert.equal(c.filters.length, 1, "same field+operator replaces rather than contradicting itself");
  assert.equal(c.filters[0].value, "RETIRED");

  c = setSearch(c, "bolt");
  assert.equal(activeCriteriaCount(c), 2);
  assert.equal(hasActiveCriteria(c), true);

  assert.equal(hasActiveCriteria(clearFilters(c)), false);
  assert.equal(removeFilter(c, "status").filters.length, 0);
});

// ═════════════════════════════════ 2 — named unsupported reasons

test("every reason has business-language text, and no state name leaks", () => {
  for (const r of Object.values(UNSUPPORTED_REASON)) {
    assert.ok(isUnsupportedReason(r));
    assert.ok(UNSUPPORTED_TEXT[r], `${r} has no text`);
    assert.doesNotMatch(UNSUPPORTED_TEXT[r], /_/, `${r}'s text contains a machine token`);
  }
  assert.equal(isUnsupportedReason("MADE_UP"), false);
});

test("a field that CAN do the thing explains nothing", () => {
  const status = entity().fields.find((f) => f.id === "status");
  assert.equal(unsupportedExplanation(status, "filter"), null);
  assert.equal(unsupportedExplanation(status, "sort"), null);
});

test("an unexplained refusal says so rather than returning a blank", () => {
  // A blank explanation reads as "no reason", which is a stronger claim than "nobody recorded one".
  const bare = makeFieldDefinition({ id: "x", entityId: "widget", label: "X", type: "STRING" });
  assert.match(unsupportedExplanation(bare, "filter"), /no reason has been recorded/i);
});

test("MUTATION — a reason on a field that is filterable FAILS validation", () => {
  const contradiction = makeFieldDefinition({
    id: "x", entityId: "widget", label: "X", type: "STRING",
    filterable: true, operators: ["EQUALS"],
    unsupportedFilterReason: UNSUPPORTED_REASON.NEEDS_INDEX,
  });
  assert.ok(validateFieldDefinition(contradiction).some((p) => /it is not unsupported/.test(p)));
});

test("MUTATION — an unknown reason FAILS validation", () => {
  const bogus = makeFieldDefinition({
    id: "x", entityId: "widget", label: "X", type: "STRING",
    unsupportedFilterReason: "BECAUSE_I_SAID_SO",
  });
  assert.ok(validateFieldDefinition(bogus).some((p) => /not a known UNSUPPORTED_REASON/.test(p)));
});

// ═════════════════════════════════ 3 — the gap register

test("a valid gap validates, and the register collects it", () => {
  const e = entity();
  assert.deepEqual(validateEntityDefinition(e), []);
  assert.equal(collectGaps([e]).length, 1);
  assert.equal(gapsForField(e, "cost").length, 1);
  assert.equal(gapsForField(e, "name").length, 0);
});

test("MUTATION — a gap with no evidence FAILS", () => {
  // A gap with no finding is an opinion. The register exists to hold evidence.
  const opinion = makeGap({ id: "SOMETHING_FEELS_OFF", title: "Feels off", severity: GAP_SEVERITY.MODELLING });
  const problems = validateGap(opinion);
  assert.ok(problems.some((p) => /finding is required/.test(p)));
  assert.ok(problems.some((p) => /refused or what would resolve it/.test(p)));
});

test("MUTATION — a gap id that is not quotable FAILS", () => {
  const sloppy = makeGap({
    id: "part list gap", title: "T", severity: GAP_SEVERITY.SCALE,
    finding: "f", refused: "r",
  });
  assert.ok(validateGap(sloppy).some((p) => /SCREAMING_SNAKE_CASE/.test(p)));
});

test("MUTATION — a gap naming a field the entity does not have FAILS", () => {
  const stale = makeEntityDefinition({
    ...entity(),
    gaps: [makeGap({
      id: "STALE_GAP", title: "Stale", entityId: "widget", fieldId: "fieldThatWentAway",
      severity: GAP_SEVERITY.MODELLING, finding: "f", refused: "r",
    })],
  });
  // A stale governance record is worse than none: it reads as current.
  assert.ok(validateEntityDefinition(stale).some((p) => /is not a field on this entity/.test(p)));
});

test("MUTATION — the same gap declared twice FAILS at collection", () => {
  const g = makeGap({ id: "DUPE", title: "Dupe", severity: GAP_SEVERITY.SCALE, finding: "f", refused: "r" });
  assert.throws(
    () => collectGaps([makeEntityDefinition({ id: "a", label: "A", identity: makeIdentity({ mode: "SYSTEM_ONLY" }), readVia: "CALLABLE", readCallable: "x", gaps: [g] }),
      makeEntityDefinition({ id: "b", label: "B", identity: makeIdentity({ mode: "SYSTEM_ONLY" }), readVia: "CALLABLE", readCallable: "y", gaps: [g] })]),
    /declared twice/,
  );
});

// ═════════════════════════════════ 5 — structured absence

test("ZERO IS A VALUE and never renders as an absence", () => {
  // The oldest bug in this codebase's list rendering: a falsy check turns "0 on hand" into "Not
  // recorded", and an empty shelf becomes indistinguishable from one nobody has looked at.
  assert.equal(isPresentNumber(0), true);
  assert.equal(resolveValue(0, { numeric: true }).present, true);
  assert.equal(displayValue(0, { numeric: true }), "0");
  assert.equal(displayValue(0, { numeric: true, format: (n) => `$${n}.00` }), "$0.00");
});

test("UNKNOWN IS NOT ZERO, and a formatter never sees an absent value", () => {
  const shown = displayValue(null, { numeric: true, absence: ABSENCE.UNKNOWN, format: () => "$0.00" });
  assert.equal(shown, ABSENCE_TEXT[ABSENCE.UNKNOWN]);
  assert.notEqual(shown, "$0.00");
});

test("a numeric STRING is not a number", () => {
  // "1000" formats identically to 1000 and sorts before "9". Accepting one lets a money column look
  // right and order wrongly.
  assert.equal(isPresentNumber("1000"), false);
  assert.equal(isPresentNumber(Number.NaN), false);
  assert.equal(isPresentNumber(Number.POSITIVE_INFINITY), false);
});

test("the four absences stay distinct and none of them is a dash", () => {
  const seen = new Set();
  for (const a of Object.values(ABSENCE)) {
    const text = ABSENCE_TEXT[a];
    assert.ok(text, `${a} has no text`);
    assert.notEqual(text, "--");
    assert.notEqual(text, "—");
    seen.add(text);
  }
  assert.equal(seen.size, Object.values(ABSENCE).length, "two absences render identically");
});

test("NOT_AVAILABLE_TO_USER says nothing about the value it withholds", () => {
  const r = resolveValue(42, { numeric: true });
  assert.equal(r.present, true);
  const withheld = resolveValue(null, { numeric: true, absence: ABSENCE.NOT_AVAILABLE_TO_USER });
  assert.doesNotMatch(withheld.text, /42/);
  assert.match(withheld.text, /your role/i);
});

test("MUTATION — an unknown absence FAILS validation", () => {
  const bogus = makeFieldDefinition({ id: "x", entityId: "widget", label: "X", type: "NUMBER", absence: "VIBES" });
  assert.ok(validateFieldDefinition(bogus).some((p) => /not a known ABSENCE/.test(p)));
});

// ═════════════════════════════════ the export back door

test("MUTATION — a blocked field left EXPORTABLE fails validation", () => {
  // Blocking a column and leaving the CSV open is the same field reaching the same person by a
  // longer route.
  const leaky = makeFieldDefinition({
    id: "cost", entityId: "widget", label: "Cost", type: "CURRENCY_MINOR",
    displayable: false, reportable: false, exportable: true,
  });
  assert.ok(validateFieldDefinition(leaky).some((p) => /back door a blocked field ships through/.test(p)));
});

test("a real blocked field is shut on all three routes at once", () => {
  const cost = entity().fields.find((f) => f.id === "cost");
  assert.equal(cost.displayable, false);
  assert.equal(cost.reportable, false);
  assert.equal(cost.exportable, false);
});
