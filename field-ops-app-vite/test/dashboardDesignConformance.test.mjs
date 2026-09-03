// DASHBOARD DESIGN CONFORMANCE -- does the screen match the design authority?
//
// ============================ WHY THIS FILE EXISTS ============================
//
// Two packages shipped a dashboard that was green on every test and did not look like the design.
// The suites verified overflow, crashes and stuck loading -- all real, all necessary, and none of
// them asks the question the North Star answers. Nothing failed when three components the design
// names BY NAME went unused, and nothing failed when the KPI tier shipped at 28px against a spec
// that says 32.
//
// The second miss is the instructive one. The CSS carried a comment reading "matching the visual
// system's 32/24 scorecard tiers" above a rule that resolved --font-size-2xl, which is 28px. The
// comment asserted a number the token did not carry, so every later reader -- including the one who
// wrote it -- believed the tier was already correct and stopped measuring. THESE TESTS ASSERT ON
// RESOLVED VALUES, never on prose about them.
//
// ============================ WHAT WOULD BREAK THESE ============================
//
// Deleting ContextBand or AttentionBand from the dashboard; letting the situation line fall back to
// a one-sentence StatusIndicator; or putting the KPI figures back on --font-size-2xl / --font-size-xl.
// Each of those is exactly what happened, and each fails here now.
//
// Run: node --test test/dashboardDesignConformance.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
/** Source with comments stripped, so a guard can never pass or fail on prose ABOUT the code. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DASHBOARD = code(read("../src/modules/dashboard/MyDashboard.jsx"));
const CSS = read("../src/index.css");

// ── the KPI tier, in resolved pixels ────────────────────────────────────────────────────────────

/**
 * The declared `font-size` for a selector, at the top level and inside the handheld media query.
 *
 * Deliberately reads the LAST matching declaration in each scope: CSS cascade order decides, and an
 * earlier superseded rule (the file has one) must not answer for the one that actually applies.
 */
function fontSizeFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Split the file at the handheld breakpoint the dashboard uses, so desktop and handheld are read
  // from their own scopes rather than by hoping one regex lands in the right block.
  const rules = [...CSS.matchAll(new RegExp(`([^{}]*${escaped}[^{}]*)\\{([^}]*)\\}`, "g"))];
  const out = { desktop: null, handheld: null };
  for (const m of rules) {
    const size = /font-size:\s*([^;]+);/.exec(m[2]);
    if (!size) continue;
    // Is this rule inside a max-width media block? Look back for the nearest @media / closing brace.
    const before = CSS.slice(0, m.index);
    const lastMedia = before.lastIndexOf("@media");
    const lastClose = before.lastIndexOf("\n}");
    const inHandheld = lastMedia > lastClose && /max-width:\s*639\.98px|max-width:\s*640px/.test(CSS.slice(lastMedia, lastMedia + 60));
    if (inHandheld) out.handheld = size[1].trim();
    else out.desktop = size[1].trim();
  }
  return out;
}

test("dashboard module KPI figures are 32px, dropping to 24px on a handheld", () => {
  // North Star section 8, exactly: "Stat values at the 32px KPI tier".
  const sizes = fontSizeFor(".fo-dashboard-module .fo-compact-metric__value");
  assert.equal(sizes.desktop, "32px", "desktop KPI is off-spec");
  assert.equal(sizes.handheld, "24px", "handheld KPI is off-spec");
});

test("goal tile KPI figures are 32px, dropping to 24px on a handheld", () => {
  const sizes = fontSizeFor(".fo-goal-tile__value");
  assert.equal(sizes.desktop, "32px", "goal KPI is off-spec");
  assert.equal(sizes.handheld, "24px", "goal KPI is off-spec on a handheld");
});

test("the KPI tier is ONE tier -- module figures and goal figures cannot diverge", () => {
  // The specific failure this guards: some figures at 32 and goal figures at 28, while the code
  // claims a single tier.
  const module = fontSizeFor(".fo-dashboard-module .fo-compact-metric__value");
  const goal = fontSizeFor(".fo-goal-tile__value");
  assert.deepEqual(module, goal, "the dashboard is showing two KPI sizes under one name");
});

test("the KPI tier does not resolve through a token that is not 32/24", () => {
  // --font-size-2xl is 28px and --font-size-xl is 22px. Using them here is how this shipped
  // off-spec twice, both times with a comment claiming otherwise.
  const twoXl = /--font-size-2xl:\s*([\d.]+)px/.exec(CSS)?.[1];
  const xl = /--font-size-xl:\s*([\d.]+)px/.exec(CSS)?.[1];
  assert.ok(twoXl && xl, "the typography tokens moved -- re-check the KPI rules against them");
  // If someone ever redefines the tokens to 32/24, using them again becomes correct. Until then the
  // literal is the only thing that resolves to spec, and this test says why.
  if (twoXl !== "32") {
    for (const sel of [".fo-dashboard-module .fo-compact-metric__value", ".fo-goal-tile__value"]) {
      assert.notEqual(fontSizeFor(sel).desktop, "var(--font-size-2xl)", `${sel} is back on a ${twoXl}px token`);
    }
  }
});

// ── the components the design names ─────────────────────────────────────────────────────────────

test("the situation line is a ContextBand, not a one-sentence status strip", () => {
  assert.match(DASHBOARD, /import ContextBand from/, "ContextBand is not imported");
  assert.match(DASHBOARD, /context=\{<ContextBand/, "WorkspaceShell's context slot is not a ContextBand");
  // The exact regression: a generic sentence that was true of the whole platform and told this
  // reader nothing about their own screen.
  assert.ok(
    !/context=\{\s*<StatusIndicator/.test(DASHBOARD),
    "the situation line fell back to a generic StatusIndicator",
  );
});

test("the context band carries what actually governs the screen", () => {
  // Not decoration: the reporting day and the calendar are what the dated figures are computed on,
  // and a reader cannot check a figure without them.
  assert.match(DASHBOARD, /label:\s*"Reporting day"/);
  assert.match(DASHBOARD, /TAYLOR_VENTANA_REPORTING_CALENDAR\.reportingTimeZone/);
});

test("action items render through AttentionBand, not as ordinary counts", () => {
  assert.match(DASHBOARD, /import AttentionBand from/, "AttentionBand is not imported");
  assert.match(DASHBOARD, /<AttentionBand\s+items=\{attentionItems\}/, "AttentionBand is not rendered");
  // Past-due and conflict must reach it. Losing either would put the signal back among the counts,
  // where nothing says "this one needs you".
  assert.match(DASHBOARD, /severity:\s*"BLOCKING"/);
  assert.match(DASHBOARD, /severity:\s*"ATTENTION"/);
});

test("attention destinations are DERIVED from reachability, never written down", () => {
  // A hardcoded path is how a plausible URL previously fell through to Dashboard with nothing
  // failing. reachableHref asks the same function the nav rail asks and returns null when the
  // principal cannot open the surface.
  assert.match(DASHBOARD, /reachableHref\(destinationGroups, "serviceOperations", "serviceOperations"\)/);
  assert.match(DASHBOARD, /reachableHref\(destinationGroups, "service", "dispatcherBoard"\)/);
  // No literal route strings in the attention items.
  const band = /const attentionItems = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[/.exec(DASHBOARD)?.[0] ?? "";
  assert.ok(band.length > 0, "could not locate the attention item builder");
  assert.ok(!/to="\//.test(band), "an attention link hardcodes a route");
});

test("no attention row fabricates an owner", () => {
  // The band has an optional `owner` slot. An aggregate over many work orders has no single
  // responsible person, and filling the field to make the row look complete would attribute other
  // people's work to someone.
  const band = /const attentionItems = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[/.exec(DASHBOARD)?.[0] ?? "";
  assert.ok(!/owner:/.test(band), "an attention row asserts an owner it cannot know");
});

test("the band still renders nothing when clean", () => {
  // AttentionBand's own rule, and the reason it is worth looking at. The dashboard must not force it
  // open with a placeholder row.
  const source = code(read("../src/shared/ui/AttentionBand.jsx"));
  assert.match(source, /if \(!items \|\| items\.length === 0\) return null;/);
  const band = /const attentionItems = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[/.exec(DASHBOARD)?.[0] ?? "";
  assert.ok(!/items\.push\(\{[^}]*fact:\s*"No /.test(band), "a clean-state row is being pushed");
});

// ── the fixes that must not silently regress ────────────────────────────────────────────────────

test("technician names resolve through the technician collection, not the employee directory", () => {
  // technicianId is NOT userId. Passing the directory's byUserId map made every row read
  // "Name not resolved" -- the raw-id family of defect arriving as a plausible label.
  assert.match(DASHBOARD, /useFirestoreCollection\(TECHNICIANS_COLLECTION/);
  assert.match(DASHBOARD, /resolveTechnicianIdentity\(\s*technicianId,\s*\{/);
  assert.ok(!/useEmployeeDirectory/.test(DASHBOARD), "the employee directory is back in the name path");
  assert.ok(!/\.displayName/.test(DASHBOARD), "resolveTechnicianIdentity returns .name, not .displayName");
});

test("modules sit in a grid, and blocked modules stay compact", () => {
  assert.match(DASHBOARD, /className="fo-dashboard-grid"/, "the module grid was removed");
  assert.match(CSS, /\.fo-dashboard-grid\s*\{[^}]*display:\s*grid/, "the grid rule was removed");
  // The compact module-local honest state: an unread module was taking ~200px of the page.
  assert.match(CSS, /\.fo-dashboard-module \.fo-state--iconic/, "module states are back to page-sized alerts");
});
