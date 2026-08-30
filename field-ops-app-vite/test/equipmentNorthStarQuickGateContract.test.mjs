// The Equipment North Star Quick Gate's own contract, asserted offline.
//
// The gate itself only runs against a deployed sandbox, so nothing in CI can execute it. What CI
// CAN do is hold the properties that make it safe and honest to run, because those are the ones
// that would be quietly lost in an edit:
//
//   READ-ONLY        it must never press Confirm installation. Installation is irreversible —
//                    accountId/locationId are immutable after create, nothing clears the serialized
//                    asset's link, and no recovery authority exists. A gate that proved the
//                    confirmation composition by performing one would be indefensible.
//   FAIL-CLOSED      it must refuse a missing --expect, a mismatched release, and any non-sandbox
//                    origin. A gate that measures the wrong bundle reports a green family from code
//                    that is not deployed, which is worse than no gate.
//   NOT VACUOUS      a precondition the sandbox does not offer must be REPORTED as skipped, never
//                    counted as a pass. This is the Parts gate's own lesson 3, held here by test.
//   NO PINNED NAME   ND-31 governs the unresolved-location REASON, not one literal string, and
//                    ND-32 governs the VALUES, not the column names. A gate that pinned either
//                    would fail a correct page — the Parts gate did exactly that when ND-30 renamed
//                    a column out from under it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", ".claude", "skills", "run-field-ops-app-vite", "equipmentNorthStarQuickGate.mjs");
const source = readFileSync(GATE, "utf8");
// Comments explain what the gate refuses; only CODE can perform it. Scanning raw text would make
// the explanation the defect and reward deleting it.
//
// ════════════ THE STRIPPER ITSELF HAD A DEFECT, AND IT SILENTLY GUTTED THESE TESTS ════════════
//
// The first version was `source.replace(/\/\*[\s\S]*?\*\//g, " ")`. The gate contains an XPath
// string — `xpath=//*[${EXACT_CLASS("ns-workspace__count")}]` — and `//*` reads as a block-comment
// opener to that regex. It matched from there to the next `*/`, **6314 characters later**, deleting
// the Add-filter block, the list-settle waits and part of the install-confirmation flow from what
// the assertions below could see.
//
// Nothing failed. Every `doesNotMatch` over that span passed because the span was gone — the exact
// silent-vacuous-pass failure these tests exist to prevent, in the tests themselves.
//
// So block stripping is anchored to a JSDoc opener AT THE START OF A LINE, which is the only form
// this file uses. An XPath `//*` in the middle of a template literal cannot be mistaken for one.
const code = source
  .replace(/^[ \t]*\/\*\*[\s\S]*?\*\//gm, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

test("the contract's own comment stripper does not eat code", () => {
  // The regression that hid 6KB of the gate from every assertion below. A ratio would be the wrong
  // instrument — this file is legitimately ~40% prose. What is diagnostic is a single OVERSIZED
  // removal: the bug deleted one 6314-character span, while the largest real JSDoc block here is
  // around 1.2KB.
  const removed = [...source.matchAll(/^[ \t]*\/\*\*[\s\S]*?\*\//gm)].map((m) => m[0].length);
  const biggest = Math.max(0, ...removed);
  assert.ok(
    biggest < 2500,
    `the stripper removed a ${biggest}-character span — that is code, not a comment block`,
  );
  // The XPath that triggered it must survive stripping.
  assert.match(code, /xpath=\/\/\*\[/);
  // And so must the three regions it had swallowed.
  assert.match(code, /builder\.locator\("label"\)/);
  assert.match(code, /data-list-state/);
  assert.match(code, /Confirm installation/);
});

test("READ-ONLY — the gate never presses Confirm installation", () => {
  // It may LOCATE the confirm button (that is the assertion), and it may click Cancel. It must not
  // click confirm. The distinction is the `.click()` chained onto a confirm locator.
  assert.doesNotMatch(code, /confirmBtn\s*\.\s*click/);
  assert.doesNotMatch(code, /name:\s*\/\^?Confirm installation\$?\/i?\s*\}\s*\)\s*\.\s*click/);
});

test("READ-ONLY — the gate submits no form and issues no write verb", () => {
  // The only fetch it makes is a GET: version.json, and the governed Firestore document read.
  assert.doesNotMatch(code, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(code, /\.press\(\s*["']Enter["']\s*\)/);
  assert.doesNotMatch(code, /type=["']submit["']/);
});

test("READ-ONLY — it creates no Equipment and runs no lifecycle command", () => {
  for (const forbidden of [/New Equipment/i, /Create equipment/i, /\bretire\b\s*\)\s*\.\s*click/i, /Save\b.*\.click/]) {
    assert.doesNotMatch(code, forbidden);
  }
});

test("FAIL-CLOSED — --expect is required, not optional", () => {
  assert.match(code, /if\s*\(\s*!EXPECT_SHA\s*\)/);
  assert.match(code, /process\.exit\(2\)/);
});

test("FAIL-CLOSED — a release mismatch refuses before any Equipment assertion", () => {
  const identityIdx = code.indexOf("release identity");
  const firstWorkspaceIdx = code.indexOf("openWorkspace(page)", code.indexOf("async function main"));
  assert.ok(identityIdx > 0, "the gate must have a release-identity check");
  assert.ok(
    identityIdx < firstWorkspaceIdx,
    "release identity must be CHECK ZERO — it runs before the browser measures anything",
  );
  assert.match(code, /REFUSING: the origin is not serving the release/);
});

test("FAIL-CLOSED — it refuses any origin that is not the sandbox, and any production role", () => {
  assert.match(code, /eos-platform-sandbox/);
  assert.match(code, /environmentRole === "production"/);
});

test("NOT VACUOUS — a skip is recorded as unmeasured, never as a pass", () => {
  assert.match(code, /skipped:\s*true/);
  // The summary must count them separately, so a run of skips cannot read as a green gate.
  assert.match(code, /skipped\.length/);
  assert.match(code, /SKIPPED \(unmeasured, not green\)/);
});

test("NO PINNED NAME — ND-31 is asserted as a reason, not as one literal string", () => {
  // The installed register accepts ANY governed reference-state sentence. If this list ever shrinks
  // to one entry, the gate has started failing correct pages.
  assert.match(code, /TRUTHFUL_REFERENCE_ABSENCES/);
  const list = /const TRUTHFUL_REFERENCE_ABSENCES = \[([\s\S]*?)\];/.exec(source)?.[1] ?? "";
  const entries = list.match(/"[^"]+"/g) ?? [];
  assert.ok(entries.length >= 4, `expected the governed reference states, got ${entries.length}: ${entries}`);
  for (const required of ['"No longer exists"', '"Not available to your role"', '"Could not be loaded"']) {
    assert.ok(entries.includes(required), `${required} must stay acceptable on the installed register`);
  }
});

test("NO PINNED NAME — ND-32 is asserted by deriving column positions from the deployed headings", () => {
  // Cells addressed by the INDEX of their own heading, never by a hard-coded data-label. This is
  // what stops a future ruling that renames a column from failing a correct page.
  assert.match(code, /headings\.findIndex/);
  assert.match(code, /td:nth-child\(\$\{i[A-Za-z]+ \+ 1\}\)/);
});

test("DIAGNOSABLE — no silent catch replaces the underlying error", () => {
  // `.catch(() => "")` and `.catch(() => 0)` are fine: they supply a DEFAULT for a value the gate
  // then reports. A bare `catch {}` that swallows a thrown error is not, and it is how a
  // ReferenceError was reported as a data finding for two full runs.
  assert.doesNotMatch(code, /catch\s*\{\s*\}/);
  assert.match(code, /Underlying error: \$\{err\?\.message \?\? err\}/);
});

test("NO FIXED DELAY where an observable readiness condition exists", () => {
  // One bounded poll loop for the Available terminal state is legitimate — it IS the observable
  // condition, sampled. What must not appear is a bare sleep standing in for a wait.
  const sleeps = code.match(/waitForTimeout\(\s*\d+\s*\)/g) ?? [];
  assert.ok(sleeps.length <= 1, `expected at most the terminal-state poll, found ${sleeps.length}: ${sleeps}`);
});

test("the gate names the family's rulings it exists to hold", () => {
  for (const ruling of ["ND-31", "ND-32", "EQ-G5", "EQ-D2", "EQ-G4", "EQ-G2"]) {
    assert.ok(source.includes(ruling), `${ruling} must be named in the gate`);
  }
});

// ══════════════════════ THE TWO LIVE FALSE POSITIVES, HELD AS RULES ══════════════════════
//
// The first run against a correctly deployed release produced 28 PASS / 2 FAIL / 2 SKIP, and BOTH
// failures were the gate's fault. The Owner ruled them Quick-Gate defects and refused to send the
// Equipment implementation back — correctly: neither finding was about the application.
//
// A gate defect that can only be found by deploying is a gate defect that will happen again, so the
// two verdicts are now pure functions and these tests feed them the EXACT shapes that fooled them.
import {
  workspaceIdentityVerdict,
  filterFieldsVerdict,
  isCompetingHeading,
  MIN_VISIBLE_HEADING_PX,
  REQUIRED_FILTER_FIELDS,
} from "../.claude/skills/run-field-ops-app-vite/equipmentNorthStarQuickGate.mjs";

// ── FALSE POSITIVE 1 — hidden tab panels legitimately hold their own h1.

test("FP1 — a hidden tab panel may contain an h1; only the VISIBLE identity is counted", () => {
  // The live DOM: three mounted h1s, because EquipmentWorkspace keeps all three tab panels mounted
  // so each keeps its state, and EquipmentRegister hosts a WorkspaceShell whose title is also
  // "Equipment". Two of them are inside `hidden` panels and are not on screen.
  const verdict = workspaceIdentityVerdict({
    visibleWorkspaceTitles: ["Equipment"],
    otherVisibleH1s: [], // the register's h1 is in a hidden panel, so it is not here
  });
  assert.equal(verdict.ok, true, verdict.detail);
});

test("FP1 — the exact live shape that produced the false FAIL now passes", () => {
  // h1s=["Equipment","Equipment","Equipment"] was the reported detail. Counting mounted h1s is what
  // was wrong; the invariant is one VISIBLE workspace page identity.
  assert.equal(workspaceIdentityVerdict({ visibleWorkspaceTitles: ["Equipment"], otherVisibleH1s: [] }).ok, true);
});

test("FP1 — TWO visible workspace identities still FAIL", () => {
  // The real defect the check exists to catch: a reader looking at two competing page titles.
  const verdict = workspaceIdentityVerdict({
    visibleWorkspaceTitles: ["Equipment", "Equipment"],
    otherVisibleH1s: [],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /visibleWorkspaceTitles=\["Equipment","Equipment"\]/);
});

test("FP1 — a second VISIBLE h1 outside the workspace identity still FAILS", () => {
  assert.equal(
    workspaceIdentityVerdict({ visibleWorkspaceTitles: ["Equipment"], otherVisibleH1s: ["Equipment"] }).ok,
    false,
  );
});

test("FP1 — no visible identity at all FAILS, and so does the wrong title", () => {
  assert.equal(workspaceIdentityVerdict({ visibleWorkspaceTitles: [], otherVisibleH1s: [] }).ok, false);
  assert.equal(workspaceIdentityVerdict({ visibleWorkspaceTitles: ["Parts"], otherVisibleH1s: [] }).ok, false);
});

test("FP1 — the gate measures which headings are ON SCREEN, not which are :visible", () => {
  assert.match(code, /getBoundingClientRect/);
  assert.match(code, /isCompetingHeading/);
  // Neither of the two wrong formulations may come back.
  assert.doesNotMatch(code, /page.locator("h1").allInnerTexts/);
  assert.doesNotMatch(code, /h1:visible/);
});

// ── FALSE POSITIVE 2 — the filter assertion read SortControl.

// Verbatim from the failing live run's own detail line. This is what SortControl offers.
const LIVE_SORT_OPTIONS = [
  "Default order",
  "Name – A to Z",
  "Name – Z to A",
  "Status – grouped A to Z",
  "Status – grouped Z to A",
  "Created – Lowest first",
];

test("FP2 — SortControl's options cannot SATISFY the filter assertion", () => {
  const verdict = filterFieldsVerdict(LIVE_SORT_OPTIONS);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ["Customer", "Status"]);
});

test("FP2 — and they cannot POISON it either: 'Status – grouped A to Z' is not 'Status'", () => {
  // This is the half that would have gone unnoticed. A substring test — which is what the gate used
  // — is SATISFIED by "Status – grouped A to Z". The check failed only because the sort happened to
  // offer no "customer" option; had it offered one, the gate would have passed while measuring the
  // wrong control entirely. Matching is exact for exactly that reason.
  assert.equal(filterFieldsVerdict(["Status – grouped A to Z"]).missing.includes("Status"), true);
  assert.equal(filterFieldsVerdict([...LIVE_SORT_OPTIONS, "Customer – A to Z"]).ok, false);
});

test("FP2 — the real AddFilter field labels satisfy it", () => {
  // What `AddFilter` renders: one <option> per offered filter, carrying that field's own label.
  // equipmentIndexList declares exactly two filters — accountId ("Customer") and status ("Status").
  assert.equal(filterFieldsVerdict(["Customer", "Status"]).ok, true);
  // The placeholder is dropped by the gate before the verdict sees it, and would not satisfy it.
  assert.equal(filterFieldsVerdict(["Choose a field…"]).ok, false);
});

test("FP2 — sort options appearing BEFORE or AFTER the builder change nothing", () => {
  // Ordering is not a contract. The verdict is fed only the builder's own options, and even if the
  // sort's leaked in they neither satisfy nor break the requirement.
  assert.equal(filterFieldsVerdict([...LIVE_SORT_OPTIONS, "Customer", "Status"]).ok, true);
  assert.equal(filterFieldsVerdict(["Customer", "Status", ...LIVE_SORT_OPTIONS]).ok, true);
});

test("FP2 — the gate scopes to the Add-filter builder and leaves by Cancel", () => {
  // It must OPEN the control and read the builder's own Field select...
  assert.match(code, /getByRole\("group",\s*\{\s*name:\s*\/add a filter\/i\s*\}\)/);
  // The Field select is reached from INSIDE the resolved builder — see FP2b for why the accessible
  // -name route does not work on an implicit label wrapping a select.
  assert.match(code, /builder\.locator\("label"\)/);
  // ...never infer the filter from whichever select happens to be first in the panel.
  assert.doesNotMatch(code, /customerPanel\.locator\("select"\)\.first\(\)/);
  // ...and it must never Apply, which would add a criterion and change what every later check sees.
  assert.doesNotMatch(code, /name:\s*\/\^?Apply\$?\/i?\s*\}\s*\)\s*\.\s*click/);
  assert.match(code, /name:\s*\/\^Cancel\$\/i/);
});

test("FP2 — the required filter fields are declared, not scattered", () => {
  assert.deepEqual([...REQUIRED_FILTER_FIELDS], ["Customer", "Status"]);
});

// ── The skips stay skips.

test("the two live skips remain SKIPs and are never forced green", () => {
  // 24 (no Activity rows on the chosen record) and 25 (no stored YYYY-MM-DD to compare) are honest
  // unmeasured results. Converting either to a pass, or mutating the sandbox to eliminate them,
  // would be fabricated evidence.
  assert.match(code, /skip\("24 Activity renders human labels/);
  assert.match(code, /skip\("25 H2 a date-only value does not shift a day"/);
  assert.match(code, /inventing one would be fabricated evidence/);
});

test("importing the gate does not launch a browser", () => {
  // The verdicts are importable; main() runs only as the entrypoint. Without this guard these very
  // tests would drive the sandbox.
  assert.match(code, /const invokedDirectly = process\.argv\[1\]/);
  assert.match(code, /if \(invokedDirectly\) \{/);
});

// ── FALSE POSITIVE 1, second round. The first fix was still wrong, and the live DOM said why.
//
// `h1:visible` is not "on screen". The app shell renders a screen-reader page heading with
// `fo-visually-hidden` — `display: block`, clipped to a 1px box — so Playwright counts it visible
// and the corrected check STILL failed a correct page, with otherVisibleH1s=["Equipment"].
//
// Measured geometry settles it. These fixtures are the three headings the live page actually
// carried, measured.

test("FP1b — the screen-reader shell heading is not a competing page identity", () => {
  // fo-visually-hidden: display:block, clipped to 1x1. It occupies no page and competes with
  // nothing — and removing it would take a landmark from anyone navigating by heading.
  assert.equal(isCompetingHeading({ width: 1, height: 1 }), false);
});

test("FP1b — a heading inside a hidden tab panel measures zero and is not counted", () => {
  // EquipmentRegister's fo-page-header__title, inside #eq-panel-add with `hidden` → display:none.
  assert.equal(isCompetingHeading({ width: 0, height: 0 }), false);
});

test("FP1b — the real workspace title IS counted", () => {
  assert.equal(isCompetingHeading({ width: 1296, height: 37 }), true);
});

test("FP1b — the exact live three-heading DOM now yields exactly one identity", () => {
  const live = [
    { text: "Equipment", isWorkspaceTitle: false, width: 1, height: 1 },      // fo-visually-hidden
    { text: "Equipment", isWorkspaceTitle: true, width: 1296, height: 37 },   // ns-workspace__title
    { text: "Equipment", isWorkspaceTitle: false, width: 0, height: 0 },      // hidden Add panel
  ];
  const onScreen = live.filter(isCompetingHeading);
  const verdict = workspaceIdentityVerdict({
    visibleWorkspaceTitles: onScreen.filter((h) => h.isWorkspaceTitle).map((h) => h.text),
    otherVisibleH1s: onScreen.filter((h) => !h.isWorkspaceTitle).map((h) => h.text),
  });
  assert.equal(verdict.ok, true, verdict.detail);
});

test("FP1b — a genuinely visible second page title STILL fails", () => {
  // The defect the check exists for survives the fix: two titles a reader can actually see.
  const live = [
    { text: "Equipment", isWorkspaceTitle: true, width: 1296, height: 37 },
    { text: "Equipment", isWorkspaceTitle: false, width: 640, height: 30 },
  ];
  const onScreen = live.filter(isCompetingHeading);
  assert.equal(onScreen.length, 2);
  assert.equal(
    workspaceIdentityVerdict({
      visibleWorkspaceTitles: onScreen.filter((h) => h.isWorkspaceTitle).map((h) => h.text),
      otherVisibleH1s: onScreen.filter((h) => !h.isWorkspaceTitle).map((h) => h.text),
    }).ok,
    false,
  );
});

test("FP1b — the threshold is stated, not magic", () => {
  assert.equal(typeof MIN_VISIBLE_HEADING_PX, "number");
  assert.ok(MIN_VISIBLE_HEADING_PX > 1, "must exclude the 1px clip technique");
  assert.ok(MIN_VISIBLE_HEADING_PX < 12, "must not exclude a small but real heading");
});

// ── FALSE POSITIVE 2, second round. `getByLabel(/^Field$/)` matched nothing.

test("FP2b — the Field select is reached through its own label, not by accessible name", () => {
  // The select sits in an implicit `<label>Field<select>…</select></label>`, so its accessible name
  // is the label's WHOLE text — "FieldChoose a field…CustomerStatus". An anchored `/^Field$/` match
  // found nothing and the check reported offered=[] against a control rendering correctly.
  assert.doesNotMatch(code, /getByLabel\(\/\^Field\$\/i\)/);
  assert.match(code, /builder\.locator\("label"\)\.filter\(\{ hasText: \/\^Field\/ \}\)\.locator\("select"\)/);
});

test("FP2b — the live builder's real options satisfy the verdict", () => {
  // Measured from the deployed control: ["Choose a field…", "Customer", "Status"], placeholder
  // dropped by the gate before the verdict sees it.
  const offered = ["Choose a field…", "Customer", "Status"]
    .filter((t) => !/^choose a field/i.test(t));
  assert.equal(filterFieldsVerdict(offered).ok, true);
});

test("A SIGNED-OUT RUN IS REFUSED, never measured", () => {
  // Session establishment against the deployed origin fails intermittently — it did on one run of
  // this gate, which then reported a PRECONDITION ERROR only because the tab rail was missing. Every
  // measurement from a sign-in screen reports clean: no tables, no raw ids, no enum leaks. That is
  // indistinguishable from a genuinely healthy family.
  assert.match(code, /assertSignedIn\(page, "admin"\)/);
});

// ── RACE, found by two runs of ONE bundle disagreeing.
//
// Check 7 read the table straight after `openWorkspace`, which waits only for the TAB RAIL. One run
// measured a fully rendered 50-row register; the next reported "no ns-table … data-list-state=
// LOADING" on the identical release. A gate that answers differently on two runs of one bundle is
// measuring itself, not the application.

test("RACE — the list is settled on its own declared state before it is measured", () => {
  // `data-list-state` is the runtime's declaration, so this is an observable condition, not a sleep.
  assert.match(code, /data-list-state.*!== "LOADING"/s);
  assert.match(code, /listState/);
  // EMPTY / DENIED / UNAVAILABLE settle it too — they are answers, not states to wait out.
  assert.match(code, /settled data-list-state=\$\{listState\}/);
});

test("RACE — the reference resolvers are settled before the reference cells are read", () => {
  assert.match(code, /referencesSettled/);
  assert.match(code, /Loading…/);
  // And an unsettled run SKIPs rather than passing on a cell that is still in flight.
  assert.match(code, /the reference resolvers had not settled/);
});

test("RACE — 'Loading…' is not an acceptable settled answer", () => {
  // It is a real governed reference state, but AFTER the settle wait a cell still saying it is a
  // finding. Accepting it is how check 9a passed while measuring nothing.
  assert.equal(
    /const TRUTHFUL_REFERENCE_ABSENCES = \[([\s\S]*?)\];/.exec(source)[1].includes('"Loading…"'),
    false,
  );
});

// ── THE DEFAULT-TAB BLIND SPOT. Check 1 only ever measured the state the gate started in, so the
// second visible "Equipment" title that appeared when the Add Equipment tab was selected was
// invisible to it. The Owner found it on the deployed page instead.

test("ADD-TAB — identity is measured after selecting ALL THREE tabs, not just the default", () => {
  for (const label of ["3a Customer Equipment", "3b Available Equipment", "3c Add Equipment"]) {
    assert.ok(code.includes(label), `${label} identity assertion must exist`);
  }
  // Measured per tab, from one shared measurement helper rather than three drifting copies.
  assert.match(code, /const measureIdentity = async \(\)/);
  assert.match(code, /selected — exactly one visible Equipment identity/);
});

test("ADD-TAB — each panel is checked for a nested page shell, not just the one that had it", () => {
  // `.fo-workspace` is WorkspaceShell's root; inside a tab it IS the defect.
  assert.match(code, /panel\.locator\("\.fo-workspace"\)\.count\(\)/);
  assert.match(code, /panel hosts no standalone page title/);
});

test("ADD-TAB — the invariant stays visibility+ownership, never a mounted h1 count", () => {
  // The mounted panels legitimately hold their own headings. Reverting to a whole-DOM count would
  // re-create the very first live false positive.
  assert.doesNotMatch(code, /page\.locator\("h1"\)\.allInnerTexts/);
  assert.match(code, /getBoundingClientRect/);
  assert.match(code, /isCompetingHeading/);
});
