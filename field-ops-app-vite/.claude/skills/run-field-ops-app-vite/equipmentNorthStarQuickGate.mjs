#!/usr/bin/env node
// EQUIPMENT NORTH STAR P1v2.1 — the focused sandbox gate.
//
// ============================ WHAT THIS IS FOR ============================
//
// `_sandboxQuickGate.sh` answers "did this deploy land and is the pilot surface still standing". It
// does not know what Equipment is supposed to be. This does: it drives the DEPLOYED workspace and
// record as an admin and asserts the locked design's rulings against the running pages.
//
// One gate per accepted family, same shape and reasoning as `partsNorthStarQuickGate.mjs`,
// `dispatchNorthStarQuickGate.mjs` and `serviceOperationsNorthStarGate.mjs`.
//
// ============================ WHAT IT IS ACTUALLY CHECKING ============================
//
// Claims about what the pages may SAY, not about markup:
//
//   1a     Three populations stay three tabs. The workspace header carries no count. No panel
//          repeats the name of the tab that selects it. No Equipment document key is identity.
//   ND-31  An unresolved location states WHICH of four reasons it could not resolve. The invariant
//          is: no raw id, no guessed value, a truthful reason — NOT one literal string. This gate
//          therefore refuses raw ids and accepts any governed reference-state sentence. Pinning
//          "Location unavailable" on the installed register would fail a correct page.
//   ND-32  Manufacturer / Model / Serial are their own cells. Asserted as VALUES in separate cells,
//          derived from the deployed headings rather than pinned to a column NAME — the mistake the
//          Parts gate made when ND-30 renamed a column out from under it.
//   EQ-G5  No operating company is claimed for an installed unit. The gate asserts the ABSENCE and
//          never asserts a Taylor/Ventana value.
//   EQ-D2  Warranty Expires is the recorded date and carries no derived status.
//   EQ-G4  Move / Retire / Reactivate stay unavailable WITH the reason stated.
//   D-5    Inventory control may honestly say UNKNOWN.
//
// Plus the three reader defects #1613 corrected — raw Work Order enums, a calendar date shifted one
// day west of Greenwich, and a stored object stringified as `Timestamp(seconds=…)`.
//
// ============================ WHY IT READS FIRESTORE FOR TWO CHECKS ============================
//
// H2 (date shift) and H3 (stringified object) are both claims about the relationship between what is
// STORED and what is SHOWN. Reading only the screen cannot prove either: "Mar 13" looks correct
// unless you know the document says 2024-03-14. So the two checks fetch the record through the
// Firestore REST API using THE SAME governed idToken the browser session holds — a read, subject to
// the same Rules as the app, with no elevated credential anywhere. It is the honest source, and it
// is what makes the difference between asserting the fix in the file and asserting it on the bundle.
//
// ============================ IT SIGNS IN WITHOUT TYPING A PASSWORD ============================
//
// Through `deployedSession.mjs`, which exchanges the persona for an idToken at the Identity Toolkit
// endpoint. The password goes from `sandboxCredentials.mjs` straight into the request body and is
// never surfaced, logged or typed. NO SECRET IS EMBEDDED HERE and none is required at author time.
//
// ============================ IT IS READ-ONLY ============================
//
// It looks, it switches tabs, and it follows links. It opens the install confirmation far enough to
// read it back and NEVER presses Confirm — a gate that installed a unit would be a gate that
// performs an irreversible write against an authority with no recovery command. It submits no form,
// presses no governed command, and creates no Equipment.
//
// Usage:
//   node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/equipmentNorthStarQuickGate.mjs [origin] --expect <sha>
//
// Exit codes: 0 = every required check passed. 1 = at least one failed. 2 = precondition error
// (including a release-identity refusal, which is the gate working, not the family failing).
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

import {
  seedAuthenticatedSession, signInPersona, sandboxFirebaseConfig, assertSignedIn,
} from "./deployedSession.mjs";

const args = process.argv.slice(2);
const expectIdx = args.indexOf("--expect");
const EXPECT_SHA = expectIdx >= 0 ? args[expectIdx + 1] : null;
const ORIGIN = args.find((a) => a.startsWith("http")) ?? "https://eos-platform-sandbox.web.app";
const WORKSPACE = "/equipment";

const checks = [];
function record(id, passed, detail) {
  checks.push({ id, passed, detail, skipped: false });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${id}${detail ? ` — ${detail}` : ""}\n`);
  return passed;
}
// A SKIP IS NOT A PASS, and it is not a failure either. A precondition the sandbox genuinely does
// not offer (no installable row, no persona capability, no date-only value on the chosen record)
// must be REPORTED as unmeasured rather than counted green — a vacuous pass is the defect the Parts
// gate's own lesson 3 exists to prevent.
function skip(id, detail) {
  checks.push({ id, passed: true, detail, skipped: true });
  process.stdout.write(`SKIP  ${id}${detail ? ` — ${detail}` : ""}\n`);
}

// ══════════════════════════ vocabulary the gate refuses, and the reasons it accepts ══════════════

// A stored token that must never reach a reader as a business word. Deliberately anchored on word
// boundaries: "REPAIR" must fail, "Repair" is the label and must not.
const RAW_ENUM_TOKENS = [
  "IN_PROGRESS", "WORK_IN_PROGRESS", "SERVICE_CALL", "READY_TO_DISPATCH", "EN_ROUTE",
  "PREVENTIVE_MAINTENANCE", "REPAIR", "INSTALL", "PM", "INSPECTION", "WARRANTY",
  "COMPLETED", "CLOSED", "CANCELLED", "SCHEDULED", "DISPATCHED", "ACCEPTED", "ARRIVED", "CREATED",
];
// UPPERCASE-with-underscore, or a bare all-caps token from the list above. `PM` and `INSTALL` are in
// the list but are also legitimate English fragments, so only the underscore forms and exact
// standalone all-caps matches count — a heading that says "INSTALL" in small caps CSS is not a leak.
function rawEnumLeaks(text) {
  const found = new Set();
  for (const token of RAW_ENUM_TOKENS) {
    if (!/_/.test(token) && token.length <= 3) continue; // PM — too short to match safely
    if (new RegExp(`(^|[^A-Za-z_])${token}([^A-Za-z_]|$)`).test(text)) found.add(token);
  }
  return [...found];
}

// The governed reference-state sentences (metadata/referenceResolution.js) plus the record page's
// own two. ND-31: ANY of these is a truthful answer; a raw id is not, and neither is a blank.
// "Loading…" IS a governed reference state and is deliberately NOT here. The gate waits for the
// resolvers to settle before it measures, so a cell still saying "Loading…" afterwards is a finding,
// not an acceptable answer — accepting it is how check 9a came to "pass" on a page whose Customer
// and Location cells were both still in flight.
const TRUTHFUL_REFERENCE_ABSENCES = [
  "No longer exists", "Not available to your role", "Could not be loaded",
  "Unrecognized reference", "Unresolved reference", "Location unavailable", "Unknown location",
  "Recorded in an unreadable format",
];

// A Firestore document key as this estate mints them: a 20-char alphanumeric autoid, or one of the
// prefixed forms the fixtures use. Deliberately NOT "any long string" — a serial number is a long
// string and is legitimately on screen.
//
// BUILT FRESH PER CALL, never shared. A single `/g` regex reused across `.test()` calls carries
// `lastIndex` between them, so it answers false on a string it would have matched — a stateful
// gate that silently under-reports is worse than no gate.
const docIdRe = () => /\b(?:[A-Za-z0-9]{20}|(?:eq|acct|loc|wo)_[A-Za-z0-9]{6,})\b/g;
const hasDocId = (text) => docIdRe().test(String(text ?? ""));
const findDocIds = (text) => String(text ?? "").match(docIdRe()) ?? [];

// ══════════════════════════ the two verdicts, extracted so they can be TESTED ══════════════════
//
// Both of these were live FALSE POSITIVES on the first correctly-deployed run, and both were the
// gate's fault, not the application's. They are pulled out of the browser flow into pure functions
// so `test/equipmentNorthStarQuickGateContract.test.mjs` can exercise them against the exact DOM
// shapes that fooled them — a gate defect that can only be found by deploying is a gate defect that
// will happen again.

/**
 * FALSE POSITIVE 1 — "one Equipment title" counted hidden tab content.
 *
 *   FAIL 1 workspace route loads with one Equipment title
 *   h1s=["Equipment","Equipment","Equipment"]
 *
 * The gate read `page.locator("h1")`, which is every MOUNTED h1. EquipmentWorkspace deliberately
 * keeps all three tab panels mounted (inactive ones `hidden`) so a tab keeps its state across a
 * switch, and `EquipmentRegister` hosts a `WorkspaceShell` whose title is also "Equipment". So three
 * h1s exist in the DOM by design and only one of them is on screen.
 *
 * "One h1 in the mounted DOM" was never the governed invariant. The invariant is ONE VISIBLE
 * WORKSPACE PAGE IDENTITY: the reader must not be looking at two competing page titles. That is what
 * this decides, and it decides it from what is VISIBLE.
 */
/**
 * Is this heading COMPETING for the reader's eye, or is it an accessibility affordance?
 *
 * The live DOM carries three h1s that all say "Equipment", and only one of them is a page title a
 * sighted reader can see:
 *
 *   fo-visually-hidden      the app shell's screen-reader heading. `display: block`, clipped to a
 *                           1px box — so it is NOT `display:none` and Playwright's `:visible`
 *                           counts it. It occupies no page, competes with nothing, and removing it
 *                           would take a landmark away from anyone navigating by heading.
 *   ns-workspace__title     the workspace identity. The one on screen.
 *   fo-page-header__title   EquipmentRegister's, inside the `hidden` Add Equipment panel
 *                           (computed `display: none`). Mounted so the tab keeps its state.
 *
 * Decided by MEASURED GEOMETRY, not by class name: a heading that renders into a box smaller than a
 * few pixels is not a page title, whatever it is called. Pinning `fo-visually-hidden` would be the
 * same mistake as pinning a column label — the rule is about what the reader sees.
 */
export const MIN_VISIBLE_HEADING_PX = 4;

export function isCompetingHeading({ width = 0, height = 0 } = {}) {
  return width >= MIN_VISIBLE_HEADING_PX && height >= MIN_VISIBLE_HEADING_PX;
}

export function workspaceIdentityVerdict({ visibleWorkspaceTitles = [], otherVisibleH1s = [] } = {}) {
  const titles = visibleWorkspaceTitles.map((t) => String(t).trim()).filter(Boolean);
  const others = otherVisibleH1s.map((t) => String(t).trim()).filter(Boolean);
  return {
    ok: titles.length === 1 && /^Equipment$/i.test(titles[0]) && others.length === 0,
    detail: `visibleWorkspaceTitles=${JSON.stringify(titles)} otherVisibleH1s=${JSON.stringify(others)}`,
  };
}

/**
 * FALSE POSITIVE 2 — the filter assertion read the SORT control.
 *
 *   FAIL 5 Customer and Status filters are offered
 *   filterFields=["Default order","Name – A to Z","Status – grouped A to Z", …]
 *
 * Those are `SortControl`'s options. The gate had found the "+ Add Filter" BUTTON and then reached
 * for `panel.locator("select").first()` — which establishes nothing about which control that select
 * belongs to, and in this panel it is the sort. Incidental DOM ordering is not a contract.
 *
 * The values are also why a substring test cannot be trusted here: "Status – grouped A to Z"
 * CONTAINS "Status", so `/status/i` was satisfied by the wrong control and only the absence of a
 * "customer" sort option made the check fail at all. Had the sort offered one, this would have
 * passed while measuring nothing.
 *
 * So the field labels are matched EXACTLY. `AddFilter` renders one `<option>` per offered filter
 * carrying that field's own `label` — "Customer", "Status" — and nothing else in this panel produces
 * those strings on their own.
 */
export const REQUIRED_FILTER_FIELDS = Object.freeze(["Customer", "Status"]);

export function filterFieldsVerdict(offeredLabels = []) {
  const labels = offeredLabels.map((l) => String(l).trim()).filter(Boolean);
  const missing = REQUIRED_FILTER_FIELDS.filter(
    (want) => !labels.some((l) => l.toLowerCase() === want.toLowerCase()),
  );
  return {
    ok: missing.length === 0,
    missing,
    detail: `offered=${JSON.stringify(labels)}${missing.length ? ` missing=${JSON.stringify(missing)}` : ""}`,
  };
}

// ══════════════════════════ surface resolution — each one found ONCE ══════════════════════════

// EXACT CLASS TOKEN, not a substring: `contains(@class,"ns-workspace")` also matches every BEM child
// (ns-workspace__head, __titleblock, __titlerow), and the ancestor axis returns the NEAREST first —
// which is how the Parts gate came to measure a title row and see no chips.
const EXACT_CLASS = (cls) => `contains(concat(" ", normalize-space(@class), " "), " ${cls} ")`;

function tabByName(page, name) {
  return page.getByRole("tab", { name, exact: true });
}
function panelById(page, id) {
  return page.locator(`#eq-panel-${id}`);
}

/**
 * Open the workspace and wait for an OBSERVABLE readiness condition — the tab rail — rather than a
 * fixed delay. If it never arrives the gate reports what the page actually held, because "the route
 * is broken", "the read is denied" and "there is no equipment" are three different findings and only
 * one of them is a product defect.
 */
async function openWorkspace(page) {
  await page.goto(`${ORIGIN}${WORKSPACE}`, { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("tablist", { name: /equipment views/i }).waitFor({ timeout: 30000 });
  } catch (err) {
    const body = await page.locator("body").innerText().catch(() => "(body unreadable)");
    // THE UNDERLYING ERROR IS REPORTED, NOT REPLACED. A catch that substitutes a friendlier sentence
    // for the real one sends the next investigation at the data instead of at this file.
    throw new Error(
      `the /equipment tab rail never rendered. Body starts: ${JSON.stringify(body.slice(0, 400))}. ` +
        `Underlying error: ${err?.message ?? err}`,
    );
  }
}

/** Switch tabs and wait for the panel to actually be the visible one. No fixed delay. */
async function selectTab(page, name, panelId) {
  await tabByName(page, name).click();
  await panelById(page, panelId).waitFor({ state: "visible", timeout: 20000 });
  return panelById(page, panelId);
}

/**
 * The installed register's table, scoped to the Customer Equipment PANEL rather than found globally.
 * Three panels stay mounted (inactive ones hidden), so a global table lookup can land in the wrong
 * one — the same class of mistake as the Parts gate's three `fo-table` elements.
 */
function installedTable(panel) {
  return panel.locator("table.ns-table").first();
}

// documentElement, NOT body. A body-only assertion reports a clean page while the document scrolls
// sideways, which is how a real overflow escape stayed green.
async function overflow(page, label, width) {
  const m = await page.evaluate(() => ({
    clientW: document.documentElement.clientWidth,
    docScrollW: document.documentElement.scrollWidth,
  }));
  return record(
    `${label} no horizontal overflow at ${width}`,
    m.docScrollW <= m.clientW + 1,
    `clientW=${m.clientW} docScrollW=${m.docScrollW}`,
  );
}

/**
 * Read one Equipment document through the governed Firestore REST API with the session's own
 * idToken. Same principal, same Rules, no elevated credential. Returns Firestore's typed-value
 * shape, so `timestampValue` vs `integerValue` is directly observable — which is exactly what H3
 * needs to tell a malformed document from a conforming one.
 */
async function readEquipmentDoc(session, equipmentId) {
  const { projectId } = sandboxFirebaseConfig();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/equipment/${encodeURIComponent(equipmentId)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${session.idToken}` } });
  if (!res.ok) return { ok: false, status: res.status, fields: null };
  const body = await res.json();
  return { ok: true, status: 200, fields: body.fields ?? {} };
}

/** The stored `YYYY-MM-DD` of a date-only field, or null if it is absent or not that shape. */
function storedDateOnly(fields, key) {
  const raw = fields?.[key]?.stringValue;
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** How that stored day must read once formatted in the runner's own zone. */
function expectedDayText(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
/** The day BEFORE it — the exact value the UTC-midnight defect produced. */
function shiftedDayText(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d - 1).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function main() {
  if (!/^https:\/\/eos-platform-sandbox\./.test(ORIGIN)) {
    console.error(`REFUSING: ${ORIGIN} is not the sandbox origin. This gate is sandbox-only.`);
    process.exit(2);
  }

  const deployed = await fetch(`${ORIGIN}/version.json`).then((r) => r.json()).catch(() => null);
  if (!deployed || deployed.environmentRole === "production") {
    console.error(`REFUSING: ${ORIGIN} reports environmentRole=${deployed?.environmentRole ?? "(unknown)"}.`);
    process.exit(2);
  }
  console.log(`Equipment North Star gate — ${ORIGIN}${WORKSPACE}`);
  console.log(`  deployed ${deployed.commit}  env ${deployed.environmentId}/${deployed.environmentRole}`);
  console.log(`  built    ${deployed.buildTime}\n`);

  // ── 0: RELEASE IDENTITY, CHECK ZERO. The environment is the authority on what is deployed, never
  //      an exit code from a deploy command. Every check below would otherwise be measuring a
  //      different bundle, so this is a PRECONDITION and it refuses rather than reporting.
  if (!EXPECT_SHA) {
    console.error("REFUSING: --expect <sha> is required. A gate that does not know which release it "
      + "is verifying can report a green family from code that is not deployed.");
    process.exit(2);
  }
  const identityOk = deployed.commit === EXPECT_SHA.slice(0, deployed.commit.length);
  record("0  release identity", identityOk, `deployed=${deployed.commit} expected=${EXPECT_SHA}`);
  if (!identityOk) {
    console.error("\nREFUSING: the origin is not serving the release this gate was asked to verify.");
    process.exit(2);
  }

  const session = await signInPersona("admin");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));
  page.on("console", (msg) => { if (msg.type() === "error") pageErrors.push(msg.text()); });

  await seedAuthenticatedSession(page, ORIGIN, session);

  // A SIGNED-OUT RUN IS THE WORST RESULT A GATE CAN PRODUCE, and session establishment against the
  // deployed origin fails intermittently — it did on one run of this very gate. Every `goto` then
  // lands on the sign-in screen, which has no tables, no raw ids and no enum leaks, so a sweep
  // reports clean while measuring a different application. `assertSignedIn` throws loudly instead;
  // it exists in deployedSession.mjs for exactly this and this gate was not calling it.
  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".fo-appheader, .fo-workspace, .fo-rail").first().waitFor({ timeout: 25000 })
    .catch(() => {});
  await assertSignedIn(page, "admin");

  let recordUrl = "(not reached)";
  let availableTerminalState = "(not reached)";
  let installResult = "(not reached)";

  // ══════════════════════ C — /equipment, CUSTOMER EQUIPMENT ══════════════════════

  await openWorkspace(page);

  // ── 1: the route loads, and the workspace states its identity ONCE.
  // VISIBLE, not mounted. `h1:visible` respects the `hidden` attribute the inactive tab panels
  // carry, so the two h1s those panels legitimately hold are not counted — see
  // workspaceIdentityVerdict for the false positive this replaces. The panels are NOT changed to
  // satisfy the gate: keeping them mounted is what preserves each tab's state across a switch.
  const headings = await page.locator("h1").evaluateAll((els) => els.map((el) => {
    const box = el.getBoundingClientRect();
    return {
      text: el.textContent.trim(),
      isWorkspaceTitle: el.classList.contains("ns-workspace__title"),
      // `display:none` anywhere up the tree — the hidden tab panels — yields a zero box too, so one
      // measurement covers both the panels and the screen-reader heading.
      width: box.width, height: box.height,
    };
  }));
  const onScreen = headings.filter(isCompetingHeading);
  const identityVerdict = workspaceIdentityVerdict({
    visibleWorkspaceTitles: onScreen.filter((h) => h.isWorkspaceTitle).map((h) => h.text),
    otherVisibleH1s: onScreen.filter((h) => !h.isWorkspaceTitle).map((h) => h.text),
  });
  record("1  workspace route loads with one VISIBLE Equipment identity",
    identityVerdict.ok,
    `${identityVerdict.detail} mountedH1s=${headings.length} `
      + `notOnScreen=${JSON.stringify(headings.filter((h) => !isCompetingHeading(h)).map((h) => `${h.text}(${Math.round(h.width)}x${Math.round(h.height)})`))}`);

  // ── 2: no count on this header. Three tabs answer three questions; one number beside one title
  //      would have to mean one of them and a reader cannot tell which.
  record("2  workspace header carries no count",
    (await page.locator(`xpath=//*[${EXACT_CLASS("ns-workspace__count")}]`).count()) === 0,
    "ns-workspace__count absent");

  // ── 3: three populations, still three tabs.
  const tabNames = (await page.getByRole("tab").allInnerTexts()).map((t) => t.trim());
  record("3  three views remain present",
    tabNames.length === 3
      && tabNames.includes("Customer Equipment")
      && tabNames.includes("Available Equipment")
      && tabNames.includes("Add Equipment"),
    `tabs=${JSON.stringify(tabNames)}`);

  // ── 4: THE COLLECTION IS RESOLVED ONCE. Every assertion below is scoped to this panel, so two
  //      checks can never disagree about which surface they measured.
  const customerPanel = panelById(page, "customer");
  await customerPanel.waitFor({ state: "visible", timeout: 20000 });
  const panelHeadings = (await customerPanel.locator("h2, h3, h4").allInnerTexts()).map((t) => t.trim());
  record("4  no panel repeats the name of its own tab",
    !panelHeadings.some((h) => /^Customer Equipment$/i.test(h)),
    `headings=${JSON.stringify(panelHeadings)}`);

  // ── 5/6: the two governed server-side filters are OFFERED, and Customer is a picker of names.
  //        Reading the picker's option text is what distinguishes "a picker of names" from "a box
  //        that wants a document id" — the whole point of the ruling.
  // THE ADD-FILTER CONTROL IS OPENED AND SCOPED TO, never inferred from DOM order. `AddFilter`
  // renders a collapsed "+ Add Filter" button and, once open, a `role="group"` labelled "Add a
  // filter" containing the Field select. Reading `panel.locator("select").first()` instead landed
  // on SortControl and read "Name – A to Z" as a filter field — a false FAIL against a correct page.
  //
  // Opening it is not a mutation: it is local component state, and the flow leaves by Cancel, which
  // is `AddFilter`'s own `reset()`. Nothing is applied and no criterion is added.
  const addFilter = customerPanel.getByRole("button", { name: /^\+?\s*Add Filter$/i });
  let filterDetail = '(no "+ Add Filter" control in the Customer Equipment panel)';
  let filterOk = false;
  let filterFieldLabels = [];
  if (await addFilter.count()) {
    await addFilter.first().click();
    const builder = customerPanel.getByRole("group", { name: /add a filter/i });
    try {
      await builder.waitFor({ state: "visible", timeout: 10000 });
      // Scoped to the BUILDER's own Field step. `getByLabel(/^Field$/)` does NOT work here and the
      // reason is worth keeping: the select sits inside an implicit `<label>Field<select>…</select>`,
      // so its accessible name is the label's whole text — "FieldChoose a field…CustomerStatus" —
      // and an anchored match found nothing, which is how this check reported `offered=[]` against a
      // control that was rendering "Customer" and "Status" correctly.
      //
      // The label is matched on the text it STARTS with, and the select is taken from inside it.
      // Scoped to the resolved builder, so this is the control that owns the select — not whichever
      // select happens to come first in the panel.
      const fieldSelect = builder.locator("label").filter({ hasText: /^Field/ }).locator("select");
      filterFieldLabels = (await fieldSelect.locator("option").allInnerTexts())
        .map((t) => t.trim())
        .filter((t) => t && !/^choose a field/i.test(t));
      const verdict = filterFieldsVerdict(filterFieldLabels);
      filterOk = verdict.ok;
      filterDetail = verdict.detail;
    } catch (err) {
      const groups = await customerPanel.locator('[role="group"]').evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label")));
      filterDetail = `the Add-filter builder never appeared. Groups in the panel: ${JSON.stringify(groups)}. `
        + `Underlying error: ${err?.message ?? err}`;
    }
    // ALWAYS leave by Cancel, never Apply. Apply would add a criterion and change what every check
    // below measures.
    await customerPanel.getByRole("button", { name: /^Cancel$/i }).first().click().catch(() => {});
  }
  record("5  Customer and Status filters are offered", filterOk, filterDetail);

  // ── 6: no filter offers a document id as a CHOICE. Scoped to the two controls that actually offer
  //      choices — the filter builder's field list (read above, while it was open) and the sort
  //      control — rather than to every select on the panel.
  const sortOptions = (await customerPanel.locator("select option").allInnerTexts().catch(() => []))
    .map((t) => t.trim());
  const offeredChoices = [...filterFieldLabels, ...sortOptions];
  const looksLikeIds = offeredChoices.filter(hasDocId);
  record("6  no control offers a document id as a choice", looksLikeIds.length === 0,
    looksLikeIds.length
      ? `idish=${JSON.stringify(looksLikeIds.slice(0, 3))}`
      : `${offeredChoices.length} choice(s) across the filter builder and sort, none id-shaped`);

  // ── 7/8/9: the rows. Headings are read from the DEPLOYED table and cells addressed by INDEX, so a
  //          future ruling that renames a column cannot make this gate fail a correct page.
  // ═══ SETTLE THE LIST BEFORE MEASURING IT, IN TWO STAGES ═══
  //
  // `openWorkspace` waits for the TAB RAIL, which arrives long before the list does. Check 7 read
  // the table straight after and was racy the whole time: one run measured a fully rendered
  // register, the next reported "no ns-table … data-list-state=LOADING" on the identical release.
  // A gate that reports a different answer on two runs of one bundle is measuring itself.
  //
  // Stage 1 — the list leaves LOADING. `data-list-state` is the runtime's own declared state, so
  // this is an observable condition rather than a sleep, and EMPTY/DENIED/UNAVAILABLE settle it too:
  // those are answers, not failures to wait for.
  let listState = "UNKNOWN";
  try {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el && el.getAttribute("data-list-state") && el.getAttribute("data-list-state") !== "LOADING";
      },
      "#eq-panel-customer [data-list-state]",
      { timeout: 30000 },
    );
  } catch { /* reported below from whatever state it is actually in */ }
  listState = await customerPanel.locator("[data-list-state]").first()
    .getAttribute("data-list-state").catch(() => "UNKNOWN");

  // Stage 2 — the two batched reference resolvers land AFTER the rows, so a row's Customer and
  // Location cells show the LOADING reference sentence first. The first green run measured exactly
  // that (`firstRow=[…,"Loading…","Loading…",…]`) and check 9a "passed" having inspected a cell
  // still in flight — the vacuous pass the Parts gate's lesson 3 exists to prevent.
  let referencesSettled = true;
  if (listState === "READY") {
    try {
      await page.waitForFunction(
        (sel) => {
          const t = document.querySelector(sel);
          return t && !/Loading…/.test(t.innerText);
        },
        "#eq-panel-customer table.ns-table",
        { timeout: 20000 },
      );
    } catch {
      referencesSettled = false;
    }
  }

  const table = installedTable(customerPanel);
  const hasTable = (await table.count()) > 0;
  let rowCount = 0;
  if (!hasTable) {
    // EMPTY / DENIED / UNAVAILABLE are answers, not failures to wait longer, and each is a different
    // fact. The SETTLED state is reported so a reader can tell "the register is empty" from "this
    // role may not read it" from "the gate gave up while it was still loading".
    record("7  installed register renders rows", false,
      `no ns-table in the Customer Equipment panel; settled data-list-state=${listState}`);
  } else {
    const headings = (await table.locator("thead th").allInnerTexts()).map((t) => t.trim());
    rowCount = await table.locator("tbody tr").count();
    const firstRow = table.locator("tbody tr").first();
    const cells = rowCount ? (await firstRow.locator("td").allInnerTexts()).map((t) => t.trim()) : [];

    record("7  installed register renders rows", rowCount > 0,
      `rows=${rowCount} headings=${JSON.stringify(headings)}`);

    // 8 — ND-32: the disambiguating attributes are SEPARATE cells, not one concatenated string.
    //     Addressed by the position of their own headings, never by a pinned label.
    const idx = (re) => headings.findIndex((h) => re.test(h));
    const iName = idx(/^name$/i), iMfr = idx(/manufactur/i), iModel = idx(/^model$/i), iSerial = idx(/serial/i);
    const distinct = [iName, iMfr, iModel, iSerial].filter((i) => i >= 0);
    const noConcat = cells.every((c) => !/·.*S\/N|S\/N.*·/.test(c));
    record("8  ND-32 identity attributes occupy separate cells",
      distinct.length >= 3 && new Set(distinct).size === distinct.length && noConcat,
      `name=${iName} mfr=${iMfr} model=${iModel} serial=${iSerial} firstRow=${JSON.stringify(cells.slice(0, 6))}`);

    // 9 — no Equipment document key rendered as content anywhere in the table. The id legitimately
    //     ROUTES the row; it must never be a cell.
    const tableText = await table.innerText();
    const leakedIds = findDocIds(tableText);
    record("9  no document key is rendered as primary identity", leakedIds.length === 0,
      leakedIds.length ? `leaked=${JSON.stringify([...new Set(leakedIds)].slice(0, 3))}` : "clean");

    // 9a — ND-31: an unresolved Location states a truthful REASON. This deliberately does NOT pin
    //      one literal string: the list runtime distinguishes NOT_FOUND / DENIED / LOADING / ERROR
    //      and collapsing them would be the regression, not the fix. What is refused is a raw id.
    const iLoc = idx(/^location$/i);
    if (iLoc < 0) {
      skip("9a ND-31 unresolved Location states a truthful reason", `no Location column; headings=${JSON.stringify(headings)}`);
    } else {
      const locCells = (await table.locator(`tbody tr td:nth-child(${iLoc + 1})`).allInnerTexts()).map((t) => t.trim());
      const unresolved = locCells.filter((c) => TRUTHFUL_REFERENCE_ABSENCES.includes(c));
      const idish = locCells.filter(hasDocId);
      if (!referencesSettled) {
        // Measuring a cell still in flight proves nothing about how an unresolved one renders.
        skip("9a ND-31 unresolved Location states a truthful reason",
          `the reference resolvers had not settled after 20s — sample=${JSON.stringify(locCells.slice(0, 3))}`);
      } else if (unresolved.length === 0 && idish.length === 0) {
        skip("9a ND-31 unresolved Location states a truthful reason",
          `every Location resolved to a name on this data — nothing unresolved to measure (sample=${JSON.stringify(locCells.slice(0, 3))})`);
      } else {
        record("9a ND-31 unresolved Location states a truthful reason, never an id", idish.length === 0,
          `unresolvedSentences=${JSON.stringify([...new Set(unresolved)])} idish=${JSON.stringify(idish.slice(0, 3))}`);
      }
    }

    // 9b — EQ-G5: no operating company is claimed for an installed unit. The gate asserts the
    //      ABSENCE and never asserts a value; a later governed ownership authority composing into
    //      the seam is a DESIGN CHANGE that should have to update this line deliberately.
    record("9b EQ-G5 no operating company is claimed on installed units",
      !/\bVentana\b/i.test(tableText) && !headings.some((h) => /line of business|operating company/i.test(h)),
      `headings=${JSON.stringify(headings)}`);

  }

  await overflow(page, "10 workspace", 1440);

  // ══════════════════════ D — AVAILABLE EQUIPMENT ══════════════════════

  const availablePanel = await selectTab(page, "Available Equipment", "available");

  // LOADING is transitional. Wait for a TERMINAL state rather than sleeping — an observable
  // condition exists, so a fixed delay would be both slower and less reliable.
  const terminal = async () => {
    const text = await availablePanel.innerText();
    if (/Loading Available Equipment/i.test(text)) return null;
    if (/not able to view available Serialized Assets/i.test(text)) return "DENIED";
    if (/could not be completed\. Try again later/i.test(text)) return "UNAVAILABLE";
    if (/No serialized assets are currently available|No available inventory matches/i.test(text)) return "EMPTY";
    if ((await availablePanel.locator("table.ns-table").count()) > 0) return "READY";
    return null;
  };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    availableTerminalState = await terminal();
    if (availableTerminalState) break;
    await page.waitForTimeout(250);
  }
  if (!availableTerminalState) {
    availableTerminalState = "STUCK_IN_LOADING";
    record("11 Available Equipment reaches a terminal runtime state", false,
      `still LOADING after 30s. Panel: ${JSON.stringify((await availablePanel.innerText()).slice(0, 300))}`);
  } else {
    // EMPTY and DENIED are legitimate outcomes, not failures. Mislabelling one as another is the
    // failure, and each has its own copy — which is what the state derivation is asserted on.
    record("11 Available Equipment reaches a terminal runtime state", true, availableTerminalState);
  }

  if (availableTerminalState === "READY") {
    const availTable = availablePanel.locator("table.ns-table").first();
    const headings = (await availTable.locator("thead th").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    // The locked 1b composition: five attributes, five cells. Asserted as SEPARATE CELLS carrying
    // the values, and the heading list is reported so a rename is diagnosable rather than fatal.
    const wanted = ["Unit", "Serial", "Model", "Condition", "Location"];
    record("12 1b table gives each attribute its own cell",
      wanted.every((w) => headings.some((h) => h.toLowerCase() === w.toLowerCase())),
      `headings=${JSON.stringify(headings)}`);

    const availText = await availTable.innerText();
    const leaked = findDocIds(availText);
    record("13 no raw location or part key in the available rows", leaked.length === 0,
      leaked.length ? `leaked=${JSON.stringify([...new Set(leaked)].slice(0, 3))}` : "clean");

    // EQ-G2: an unresolvable location on THIS surface is the single absence "Location unavailable"
    // — here the design does rule one string, because the failure state genuinely is one thing.
    const iLoc = headings.findIndex((h) => /^location$/i.test(h));
    if (iLoc >= 0) {
      const locs = (await availTable.locator(`tbody tr td:nth-child(${iLoc + 1})`).allInnerTexts()).map((t) => t.trim());
      const bad = locs.filter((l) => hasDocId(l) || /^wh-|^loc-/i.test(l));
      record("13a EQ-G2 unresolved Location is an absence, never the key", bad.length === 0,
        `locations=${JSON.stringify([...new Set(locs)].slice(0, 4))}`);
    } else {
      skip("13a EQ-G2 unresolved Location is an absence", `no Location column; headings=${JSON.stringify(headings)}`);
    }

    // The line grouping, from the existing governed composition. Both lines are always named in the
    // summary, including at zero — a single combined total would hide that one business has nothing.
    const summary = await availablePanel.getByRole("status").first().innerText().catch(() => "");
    record("14 both operating lines are named in the summary",
      /Taylor:\s*\d+/i.test(summary) && /Ventana[^:]*:\s*\d+/i.test(summary),
      summary.replace(/\s+/g, " ").slice(0, 160) || "(no status line)");

    // ══════════════════════ E — INSTALL CONFIRMATION, READ-ONLY ══════════════════════
    //
    // Opened far enough to read the confirmation back. Confirm is NEVER pressed: installation is
    // irreversible, accountId/locationId are immutable after create, and no recovery authority
    // exists. A gate that proved the composition by performing one would be indefensible.
    const installButtons = availablePanel.getByRole("button", { name: /^Install at customer$/i });
    const installable = await installButtons.count();
    if (installable === 0) {
      installResult = "SKIP — this persona holds no equipment.install, or no row is installable";
      skip("15 install confirmation reads back unit / serial / customer / location", installResult);
    } else {
      await installButtons.first().click();
      const dialog = page.getByRole("dialog", { name: /install at customer/i });
      await dialog.waitFor({ timeout: 15000 });

      const customerSelect = dialog.getByRole("combobox", { name: /^Customer$/i });
      const locationSelect = dialog.getByRole("combobox", { name: /Customer location/i });
      const customerValues = await customerSelect.locator("option").evaluateAll((els) =>
        els.map((o) => o.value).filter(Boolean));

      let readBack = null;
      for (const accountId of customerValues.slice(0, 5)) {
        await customerSelect.selectOption(accountId);
        // WAIT FOR THE OBSERVABLE CONDITION, not a fixed delay: the location select is disabled
        // while that account's locations load, so "enabled" is the readiness signal. An account with
        // genuinely no locations settles enabled-and-empty, which is why the loop continues past it
        // rather than treating it as a failure.
        await locationSelect.evaluate(
          (el) => new Promise((resolve) => {
            const done = () => (!el.disabled ? resolve() : setTimeout(done, 100));
            done();
          }),
        ).catch(() => {});
        const locValues = await locationSelect.locator("option").evaluateAll((els) =>
          els.map((o) => o.value).filter(Boolean));
        if (locValues.length === 0) continue;
        await locationSelect.selectOption(locValues[0]);
        readBack = await dialog.locator("[data-install-confirm]").evaluateAll((els) =>
          Object.fromEntries(els.map((e) => [e.getAttribute("data-install-confirm"), e.textContent.trim()])));
        if (readBack && Object.keys(readBack).length) break;
      }

      if (!readBack || !Object.keys(readBack).length) {
        installResult = "SKIP — no customer in the picker has a location, so no confirmation can render";
        skip("15 install confirmation reads back unit / serial / customer / location", installResult);
      } else {
        const confirmBtn = dialog.getByRole("button", { name: /^Confirm installation$/i });
        const cancelBtn = dialog.getByRole("button", { name: /^Cancel$/i });
        const idish = Object.values(readBack).filter(hasDocId);
        const ok = ["unit", "serial", "customer", "location"].every((k) => readBack[k])
          && (await confirmBtn.count()) > 0
          && (await cancelBtn.count()) > 0
          && idish.length === 0;
        installResult = ok ? "read back, not executed" : "composition incomplete";
        record("15 install confirmation reads back unit / serial / customer / location", ok,
          `${JSON.stringify(readBack)} confirm=${await confirmBtn.count()} cancel=${await cancelBtn.count()}`);
      }
      // ALWAYS leave by Cancel. Never Confirm.
      await dialog.getByRole("button", { name: /^(Cancel|Close)$/i }).first().click().catch(() => {});
    }
  } else {
    skip("12 1b table gives each attribute its own cell", `terminal state is ${availableTerminalState}, not READY`);
    skip("13 no raw location or part key in the available rows", `terminal state is ${availableTerminalState}`);
    skip("13a EQ-G2 unresolved Location is an absence", `terminal state is ${availableTerminalState}`);
    skip("14 both operating lines are named in the summary", `terminal state is ${availableTerminalState}`);
    installResult = `SKIP — Available Equipment terminal state is ${availableTerminalState}`;
    skip("15 install confirmation reads back unit / serial / customer / location", installResult);
  }

  // ══════════════════════ F — ADD EQUIPMENT ══════════════════════

  const addPanel = await selectTab(page, "Add Equipment", "add");
  const addText = await addPanel.innerText();
  record("16 Add Equipment stays reachable and account-scoped",
    (await addPanel.locator("#equipment-account").count()) > 0
      || /Choose a customer|Select a customer to see the equipment/i.test(addText),
    addText.replace(/\s+/g, " ").slice(0, 140) || "(empty panel)");

  // ══════════════════════ G — THE RECORD ══════════════════════
  //
  // Reached by CLICKING a real row, not by constructing a URL: navigating the way a person does is
  // what proves the route the definition names is the route the application mounts.

  if (!hasTable || rowCount === 0) {
    for (const id of ["17 record route loads", "18 record identity is human-readable",
      "19 EQ-D2 Warranty Expires is the recorded date, with no derived status",
      "20 Customer resolves truthfully", "21 Location resolves truthfully",
      "22 D-5 Inventory control is honest", "23 EQ-G4 lifecycle actions state their reason",
      "24 Activity renders human labels, never stored enums",
      "25 H2 a date-only value does not shift a day", "26 H3 no stored object is stringified"]) {
      skip(id, "no installed Equipment row to navigate from");
    }
  } else {
    await selectTab(page, "Customer Equipment", "customer");
    await installedTable(customerPanel).locator("tbody tr").first().click();
    await page.waitForURL(/\/equipment\/[^/]+$/, { timeout: 20000 });
    await page.locator(".ns-page").waitFor({ timeout: 20000 });
    recordUrl = page.url();
    const equipmentId = recordUrl.split("/").pop();

    record("17 record route loads", (await page.locator(".ns-page").count()) > 0, recordUrl);

    // ── 18: identity. The h1 is the human reference and never the document key.
    const title = (await page.locator("h1.ns-identity__title").innerText().catch(() => "")).trim();
    record("18 record identity is human-readable",
      title.length > 0 && !hasDocId(title) && title !== equipmentId,
      `h1=${JSON.stringify(title)} routeId=${JSON.stringify(equipmentId)}`);

    const bodyText = await page.locator(".ns-page").innerText();

    // ── 19: EQ-D2. The recorded date, and no judgment beside it.
    const derivedWarranty = /\bin warranty\b|\bout of warranty\b|\bwarranty expired\b|days remaining/i.exec(bodyText);
    record("19 EQ-D2 Warranty Expires is the recorded date, with no derived status",
      /Warranty Expires/i.test(bodyText) && !derivedWarranty,
      derivedWarranty ? `derived phrase found: ${JSON.stringify(derivedWarranty[0])}` : "no derived warranty status");

    // ── 20/21: Customer and Location. A FAILED read must not be stated as a known absence.
    const accountCell = page.locator("[data-equipment-account]");
    const accountText = (await accountCell.innerText().catch(() => "")).trim();
    const accountFailed = (await accountCell.locator("[data-account-error]").count()) > 0;
    record("20 Customer resolves truthfully",
      !hasDocId(accountText) && (accountFailed ? !/Unknown customer/i.test(accountText) : true),
      `text=${JSON.stringify(accountText.slice(0, 80))} failedRead=${accountFailed}`);

    const locationCell = page.locator("[data-equipment-location]");
    const locationText = (await locationCell.innerText().catch(() => "")).trim();
    const locationFailed = (await locationCell.locator("[data-location-error]").count()) > 0;
    record("21 Location resolves truthfully",
      !hasDocId(locationText) && (locationFailed ? !/Unknown location/i.test(locationText) : true),
      `text=${JSON.stringify(locationText.slice(0, 80))} failedRead=${locationFailed}`);

    // ── 22: D-5. UNKNOWN is accepted; a fabricated Controlled/Exited is not.
    const control = page.locator("[data-inventory-control-section]");
    const controlText = (await control.innerText().catch(() => "")).trim();
    record("22 D-5 Inventory control is honest",
      (await control.count()) > 0
        && (/Unknown/i.test(controlText)
          || /Under Taylor inventory control|Inventory control ended|Not under Taylor inventory control/i.test(controlText)),
      controlText.replace(/\s+/g, " ").slice(0, 140) || "(no inventory control section)");

    // ── 23: EQ-G4. Present, disabled, and the reason SAID OUT LOUD — a greyed control with no
    //       explanation is the thing this surface exists to avoid.
    const move = page.locator('[data-equipment-action="move"]');
    const reason = (await page.locator(".fo-action-reason").innerText().catch(() => "")).trim();
    const moveDisabled = (await move.count()) > 0 ? await move.isDisabled() : null;
    const editEnabled = (await page.locator('[data-equipment-action="edit"]').isEnabled().catch(() => false));
    record("23 EQ-G4 lifecycle actions state their reason",
      moveDisabled === true && reason.length > 0 && editEnabled,
      `moveDisabled=${moveDisabled} editEnabled=${editEnabled} reason=${JSON.stringify(reason.slice(0, 90))}`);

    // ── 24 / H1: the activity timeline says words, not tokens. Presentation only — an enum inside a
    //       data attribute is data plumbing, not something a reader sees, so innerText is the source.
    const timeline = page.locator("[data-history-section]");
    const timelineText = (await timeline.innerText().catch(() => "")).trim();
    const timelineRows = await timeline.locator("tbody tr").count().catch(() => 0);
    const enumLeaks = rawEnumLeaks(timelineText);
    if (timelineRows === 0) {
      skip("24 Activity renders human labels, never stored enums",
        `this record has no activity rows to inspect — ${JSON.stringify(timelineText.replace(/\s+/g, " ").slice(0, 120))}`);
    } else {
      record("24 Activity renders human labels, never stored enums", enumLeaks.length === 0,
        `rows=${timelineRows} leaked=${JSON.stringify(enumLeaks)}`);
    }

    // ══════════════════════ H2 / H3 — STORED vs SHOWN ══════════════════════
    //
    // Both are claims about the RELATIONSHIP between the document and the screen, so the document is
    // read — through the governed REST API with this session's own idToken, same Rules, no elevated
    // credential. Reading only the screen cannot falsify either.
    const doc = await readEquipmentDoc(session, equipmentId);

    if (!doc.ok) {
      skip("25 H2 a date-only value does not shift a day", `could not read the document (HTTP ${doc.status})`);
      skip("26 H3 no stored object is stringified", `could not read the document (HTTP ${doc.status})`);
    } else {
      // H2 — the recorded DAY, in the runner's own zone. Not a hard-coded fixture date.
      const dateField = ["warrantyExpiresDate", "installedDate"].find((k) => storedDateOnly(doc.fields, k));
      if (!dateField) {
        skip("25 H2 a date-only value does not shift a day",
          "this record stores no YYYY-MM-DD value to compare — nothing to measure, and inventing one would be fabricated evidence");
      } else {
        const ymd = storedDateOnly(doc.fields, dateField);
        const want = expectedDayText(ymd);
        const shifted = shiftedDayText(ymd);
        record("25 H2 a date-only value does not shift a day",
          bodyText.includes(want) && !bodyText.includes(shifted),
          `${dateField} stored=${ymd} expected="${want}" previousDay="${shifted}" showsExpected=${bodyText.includes(want)} showsPreviousDay=${bodyText.includes(shifted)}`);
      }

      // H3 — no database serialization on screen, and where the document genuinely is malformed the
      // renderer must say so honestly rather than guess a date.
      const stringified = /Timestamp\(seconds=|nanoseconds=|\[object Object\]/.exec(bodyText);
      const malformed = ["createdAt", "updatedAt"].filter((k) => doc.fields?.[k]?.timestampValue);
      const refuses = /Recorded in an unreadable format/i.test(bodyText);
      record("26 H3 no stored object is stringified", !stringified,
        stringified
          ? `LEAKED ${JSON.stringify(stringified[0])}`
          : malformed.length
            ? `document stores ${malformed.join("/")} as timestampValue where the field declares NUMBER; renderer refuses honestly=${refuses}`
            : "no malformed field on this record; nothing stringified");
    }

    // ── 27: the record on a handheld.
    await page.setViewportSize({ width: 375, height: 900 });
    await page.locator(".ns-page").waitFor({ timeout: 10000 });
    await overflow(page, "27 record", 375);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  // ── 28: nothing threw while all of that happened.
  record("28 no runtime or console errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

  await browser.close();

  const failed = checks.filter((c) => !c.passed);
  const skipped = checks.filter((c) => c.skipped);
  const passed = checks.filter((c) => c.passed && !c.skipped);
  console.log(`\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped (of ${checks.length})`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  ${f.id} — ${f.detail}`);
  }
  if (skipped.length) {
    console.log("\nSKIPPED (unmeasured, not green):");
    for (const s of skipped) console.log(`  ${s.id} — ${s.detail}`);
  }
  console.log(`\nAvailable Equipment terminal state: ${availableTerminalState}`);
  console.log(`Install confirmation: ${installResult}`);
  console.log(`\nFor Owner visual acceptance:`);
  console.log(`  workspace  ${ORIGIN}${WORKSPACE}`);
  console.log(`  record     ${recordUrl}`);
  process.exit(failed.length ? 1 : 0);
}

// RUN ONLY WHEN INVOKED AS THE ENTRYPOINT. The two verdict functions above are exported so the
// contract suite can exercise them against the exact DOM shapes that produced live false positives;
// without this guard, importing the module would launch a browser and drive the sandbox.
const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`PRECONDITION ERROR: ${err?.message ?? err}`);
    process.exit(2);
  });
}
