// CSS CLASS COVERAGE -- every class a component renders must actually be styled.
// Run: node --test test/cssClassCoverage.test.mjs
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// On 2026-08-06, commit 887a0a50 ("W5 handoff: inherit App.jsx-coupled surface from the parallel
// session") replaced src/index.css wholesale with another session's copy -- a net loss of ~811 lines.
// It deleted CSS that live, unrelated, already-accepted components still referenced, and it touched
// none of their JSX.
//
// The result is the worst kind of regression: nothing throws, no test fails, no build breaks. The
// components still render, still function, still pass their unit tests -- they just render UNSTYLED.
// A two-column form collapses into a single stack. Filter chips become default-browser links. A
// checkbox detaches from its label. Two previously-certified surfaces looked broken for two weeks
// and every automated signal in the repository stayed green.
//
// A styling contract is a contract. `className="fo-account-form"` is a component asserting that a
// rule by that name exists. This test enforces the other half of it.
//
// ============================ WHAT IT DELIBERATELY DOES NOT DO ============================
//
// It does not check that the styling is CORRECT or good -- only that it EXISTS. Taste is not
// testable; absence is. It also ignores dynamically composed names (template literals, clsx-style
// concatenation), because those cannot be resolved statically and guessing would produce false
// failures that teach people to ignore the test.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../src");
const CSS = readFileSync(path.resolve(here, "../src/index.css"), "utf8");

function jsxFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) jsxFiles(full, found);
    else if (/\.jsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/** Every class name defined anywhere in the stylesheet. */
function definedClasses(css) {
  const out = new Set();
  // Strip comments so a class mentioned in prose is not counted as defined.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of code.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  return out;
}

/**
 * Class names a component asserts STATICALLY: className="a b c".
 *
 * Template literals and expressions are skipped on purpose -- they cannot be resolved without
 * running the component, and a test that guesses produces false failures nobody trusts.
 */
function referencedClasses(files) {
  const refs = new Map(); // class -> Set(file)
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // STATIC ATTRIBUTES: className="a b c"
    const chunks = [...src.matchAll(/className\s*=\s*"([^"{}]+)"/g)].map((m) => m[1]);

    // CONDITIONAL EXPRESSIONS: className={`fo-card${on ? " fo-card-active" : ""}`}
    //
    // These were skipped, and that hole is exactly where the reported defect lived. The portfolio
    // status cards and the relationship chips are written this way, so `fo-portfolio-card` and
    // `fo-filter-chip` were never checked -- both had NO rule at all, both rendered as the bare
    // global green button, and CI stayed green while the counts sat at 1.16:1 contrast and the
    // selected filter had no visible state.
    //
    // The original caution was right about EXPRESSIONS -- `cls-${size}` cannot be resolved without
    // running the component. But the LITERAL SEGMENTS of a template can be, and the classes that
    // express interactive state (-active, -selected, -pressed) live almost exclusively in these
    // conditionals. That is the most important place to check, not the one to skip.
    for (const m of src.matchAll(/className\s*=\s*\{([^}]*)\}/g)) {
      // Literal runs inside the expression: backtick chunks and quoted strings alike.
      for (const lit of m[1].matchAll(/[`"']([^`"'$]*)[`"']/g)) chunks.push(lit[1]);
    }

    for (const chunk of chunks) {
      for (const cls of chunk.split(/\s+/).filter(Boolean)) {
        // A conditional expression also contains literals that are NOT classes -- tone values
        // like `denied: "critical"` and comparisons like `metric.tone === "warn"`. Every class in
        // this codebase is hyphenated (fo-card, wo-action-row, disp-pane--queue), so requiring a
        // hyphen separates the two without an allowlist that would need curating forever.
        if (!cls.includes("-")) continue;
        if (!refs.has(cls)) refs.set(cls, new Set());
        refs.get(cls).add(path.relative(SRC, file));
      }
    }
  }
  return refs;
}

/**
 * Classes known NOT to need a rule in index.css.
 *
 * SHRINK ONLY, and each entry needs a reason. This is not a place to silence the test.
 */
const NOT_STYLED_HERE = new Set([
  // Utility/state hooks consumed by JS or by tests, never painted.
  "fo-visually-hidden",
]);

/**
 * Classes that are rendered today and styled by nothing.
 *
 * SHRINK ONLY. This is a BURN-DOWN LIST, not an exemption: it is seeded with the debt that already
 * existed when the guard was written, and a NEW orphan fails the test immediately -- which is the
 * whole point. Adding a line here is not the fix; styling the class, or removing the className from
 * the component, is.
 *
 * Where this debt came from: 887a0a50 replaced src/index.css wholesale and deleted 811 net lines
 * that live components still referenced. 63 of those rules have been restored verbatim from that
 * commit's diff. The entries below are the remainder -- classes whose rules are not recoverable from
 * that diff because they were never defined, or were lost separately.
 *
 * They are real: `fo-crm-activity-*` (8), `fo-confirm-*` (4), and five `fo-*-save-error` classes are
 * error and dialog surfaces rendering with no styling at all.
 */
const KNOWN_UNSTYLED = new Set([
  // SURFACED 2026-08-22 when this guard learned to read conditional classNames. Every one is the
  // same defect the portfolio cards had: the component applies the class, nothing styles it, and
  // the state it represents is invisible. Recorded rather than silently allowed -- each is a real
  // finding awaiting its own fix, and at least two are user-facing:
  //   fo-customer-picker-option-active -- the highlighted option during keyboard navigation
  //   fo-shell--drawer-open            -- the mobile navigation drawer's open state
  "fo-customer-picker-dropdown-up",
  "fo-customer-picker-option-active",
  "fo-equipment-compat-nonoperational",
  "fo-shell--drawer-open",
  "fo-tone-text",
  // Non-fo-prefixed debt, pre-existing and unrelated to 887a0a50.
  "disp-pane--preview",
  // THREE ENTRIES RETIRED 2026-08-27 by the Dispatch North Star P1 composition, and retired is the
  // right word: they are not fixed, their referents are gone. "disp-pane--queue" and
  // "disp-pane--techs" belonged to dispatcherBoard/WorkOrderQueue.jsx and TechnicianBoard.jsx, both
  // deleted; "disp-reassign-confirm" belonged to the old board's inline reassign modal, replaced
  // by PlacementDialog. The backlog may only shrink, and this is it shrinking.
  "eos-auth__workspace-name",
  "wo-action-destructive",
  "wo-action-error",
  "wo-action-row",
  "wo-inventory",
  // `fo-btn-link` REMOVED, not migrated. Its only consumer was Job Assignments' primary action,
  // where the permitted branch rendered an anchor carrying this class while the protected branch
  // rendered the Button primitive — so the same control changed shape depending on who was looking
  // at it, and the class it changed into was never styled. The Owner's Lists P2 visual correction
  // put both branches on the primitive. The backlog may only shrink, and this is it shrinking.
  "fo-confirm-actions",
  "fo-confirm-dialog",
  "fo-confirm-error",
  "fo-contact-save-error",
  "fo-crm-activity-backdated",
  "fo-crm-activity-body",
  "fo-crm-activity-header",
  "fo-crm-activity-links",
  "fo-crm-activity-list",
  "fo-crm-activity-row",
  "fo-crm-activity-row-meta",
  "fo-crm-activity-section",
  "fo-crm-activity-type",
  "fo-customer-identity",
  "fo-customer-identity__ref",
  "fo-dboard",
  "fo-duprule__identity",
  "fo-duprules__object-label",
  "fo-equipment-compat",
  "fo-equipment-edit-fixed",
  // "fo-equipment-register" left this backlog when the Add Equipment tab stopped rendering its own
  // page shell. It had no rule because `.fo-workspace` was supplying the layout; it now owns the
  // flex column and 16px gap that shell provided, so it is styled and is no longer an orphan.
  "fo-equipment-save-error",
  "fo-error",
  "fo-field-label",
  "fo-financial-metrics",
  "fo-job-save-error",
  "fo-job__context",
  "fo-job__readiness",
  "fo-job__state",
  "fo-kv",
  "fo-landing",
  "fo-list-grid-truncation",
  "fo-location-save-error",
  "fo-modal-overlay",
  "fo-op-card__metadata-item",
  "fo-part-detail",
  "fo-record-section-title",
  "fo-sales-field",
  "fo-sales-row__next",
  "fo-sched",
  "fo-sched-day",
  "fo-sched-form",
  "fo-sched-main",
  // "fo-tag" and "fo-timeline" left this backlog with the Equipment Activity Timeline's `<ol>`:
  // the locked 1c frame draws that timeline as a Source · Date · Event table, which renders through
  // the shared `ns-table` grammar. Both classes were used nowhere else, so they are no longer
  // used-but-unstyled — they are simply gone.
  "fo-technician-save-error",
  "fo-tone-muted",
  "fo-wizard",
  "fo-wizard-step-label",
]);

test("every statically-referenced class name is defined in the stylesheet", () => {
  const defined = definedClasses(CSS);
  const refs = referencedClasses(jsxFiles(SRC));

  const orphans = [];
  for (const [cls, files] of refs) {
    if (defined.has(cls) || NOT_STYLED_HERE.has(cls) || KNOWN_UNSTYLED.has(cls)) continue;
    orphans.push(`${cls}  <- ${[...files].slice(0, 3).join(", ")}${files.size > 3 ? ` (+${files.size - 3})` : ""}`);
  }
  orphans.sort();

  assert.deepEqual(
    orphans,
    [],
    `These classes are rendered by components but styled by nothing. A component naming a class is\n` +
    `asserting that rule exists; when the rule is deleted the component still renders, still passes\n` +
    `its unit tests, and silently looks broken. That is exactly how 887a0a50 removed ~811 lines of\n` +
    `live CSS without a single failing check.\n\n  ${orphans.join("\n  ")}\n`,
  );
});

test("the unstyled backlog may only SHRINK — every entry must still be a real orphan", () => {
  // A stale entry is how a burn-down list quietly becomes permission. If a class has since been
  // styled, or its component no longer renders it, the line must go — so the list cannot be padded
  // back out to make room for a new orphan.
  const defined = definedClasses(CSS);
  const refs = referencedClasses(jsxFiles(SRC));
  const stale = [...KNOWN_UNSTYLED].filter((c) => defined.has(c) || !refs.has(c));
  assert.deepEqual(stale, [], `These are no longer orphans and must be removed from KNOWN_UNSTYLED: ${stale.join(", ")}`);
});

test("the stylesheet is not shrinking by accident — a floor on its size", () => {
  // A blunt instrument, deliberately. 887a0a50 replaced this file wholesale and nothing noticed. A
  // stated floor turns "the stylesheet suddenly got much smaller" into a failing check that a human
  // has to look at and consciously lower.
  const lines = CSS.split("\n").length;
  const FLOOR = 3000;
  assert.ok(
    lines >= FLOOR,
    `src/index.css is ${lines} lines, below the stated floor of ${FLOOR}. If this shrank deliberately, ` +
    `lower the floor in the same commit and say why. If it shrank by a wholesale overwrite, that is ` +
    `the bug this floor exists to catch.`,
  );
});
