#!/usr/bin/env node
// PARTS NORTH STAR P1 — the focused sandbox gate.
//
// ============================ WHAT THIS IS FOR ============================
//
// `_sandboxQuickGate.sh` answers "did this deploy land and is the pilot surface still standing". It
// does not know what Parts is supposed to be. This does: it drives the DEPLOYED workspace and record
// as an admin and asserts the Owner's rulings against the running pages.
//
// Same shape and reasoning as `dispatchNorthStarQuickGate.mjs` and
// `serviceOperationsNorthStarGate.mjs` — one gate per accepted family.
//
// ============================ WHAT IT IS ACTUALLY CHECKING ============================
//
// Three rulings, all of which are claims about what the page may SAY:
//
//   ND-25  No quantity the system does not have. No quantity column on the workspace, none in the
//          record's identity layer, and the three inactive-capability sections state why they are
//          empty rather than rendering nothing (which reads as "this part has none") or a
//          placeholder (which reads as a fact).
//   ND-26  internalPartNumber is the human-facing Part Number; partId is the document key. The
//          record's h1 and the workspace's Part Number column carry the first, never the second.
//   ND-27  No cost and no price anywhere on the record.
//
// ============================ TWO THINGS THE FIRST LIVE RUN TAUGHT ============================
//
// 1. THE WORKSPACE HAS THREE `table.fo-table` ELEMENTS, AND THE CATALOGUE IS NOT THE FIRST.
//    The Work group's "All Assigned Work" reorder queue renders above it, and the Flow group's
//    history table below. The first version of this gate selected `table.fo-table` globally, landed
//    on the queue -- whose cells carry no data-label at all -- and waited five minutes for a Part
//    Number cell that was never going to appear on that table. The page was healthy the whole time:
//    62 parts in catalogue, 25 rows rendered, every one carrying the part-number cell the grammar
//    had at that time (see lesson 4 — ND-30 later renamed that column to "Part").
//
//    So every catalogue assertion here is anchored on the "Parts Catalog" heading, and each one
//    carries an explicit timeout. A gate whose precondition is absent must say WHICH tables it did
//    find, quickly -- not hang and then report a locator string.
//
// 2. IN THIS FIXTURE partId AND internalPartNumber ARE THE SAME STRING (e.g. "CW-P-0000").
//    That makes "the cell shows the Part Number and not the document id" UNFALSIFIABLE HERE: both
//    readings produce identical text. The first version asserted `shown !== routeId`, which would have
//    FAILED a correct page -- a gate inventing a defect is worse than a gate missing one.
//
//    The ND-26 field contract is proved where it CAN be falsified: test/partsNorthStarProjection
//    and test/partsNorthStarIdentity build fixtures where the two strings deliberately differ, and
//    both are mutation-proved. What this gate asserts live is the part of the contract that IS
//    observable here -- the cell exists, it is populated, and typing what it shows finds the part --
//    and it STATES the coincidence rather than claiming a proof it cannot make.

// 3. A GREEN RUN CAN STILL BE A WEAK ONE. The first passing run navigated to the catalogue's first
//    row, which happens to be a part with no ledger activity at all. Activity therefore had zero
//    rows, so the "no raw enum" check passed with nothing to inspect, and the reorder-control check
//    passed through its no-ledger branch WITHOUT EVER SEEING THE CONTROL. Two vacuous passes in a
//    19/19 result.
//
//    So the record under test is CHOSEN, not taken. It was first chosen by reading the catalogue’s
//    Inventory Health column -- which ND-30 then moved off that table, silently restoring the very
//    vacuous pass this lesson exists to prevent. It is now chosen by PROBING a bounded set of
//    candidate records for one that actually has a stock forecast, which depends on no catalogue
//    column at all, so the next grammar change cannot re-break it. That part has movements to render
//    and a forecast to gate the reorder control on, which is what makes checks 12 and 13 mean
//    anything. When no such
//    row exists the gate says so in the detail rather than quietly reverting to a weak pass.

// 4. A GATE MUST NOT PIN A COLUMN NAME THE RULING IS FREE TO CHANGE. Check 4 looked for a cell
//    labelled "Part Number". ND-30 then approved Frame 1a's grammar -- Part · Manufacturer ·
//    Category · Control · Status · Attention -- and the part number became the primary line of
//    the Part cell. The product was right and the gate timed out for fifteen seconds against a
//    label that no longer exists.
//
//    ND-26 governs the VALUE (internalPartNumber, never the document key). It says nothing about
//    what the column is CALLED. Those are two contracts and this gate now asserts them
//    separately: check 3a owns the visible grammar, check 4 owns the value.
//
//    The catalogue is also resolved ONCE, into `catalogue`, and every collection assertion is
//    scoped to that one surface. Rediscovering it per check is how two checks came to disagree
//    about which table they were measuring.

// ============================ WHY THE SEARCH CHECK IS TYPED ============================
//
// ND-26 created a defect that no static read could see: the search matched the document id and not
// the Part Number, so a person could read a number off the row in front of them, type it, and be
// told no such part exists. It was fixed in #1598. This gate TYPES the number it just read off the
// page, because asserting the provider's source would prove the fix in the file rather than on the
// deployed bundle — and the whole point of a live gate is the difference between those two.
//
// The same reasoning is why check 5 navigates by CLICKING the row rather than by constructing a URL.
//
// ============================ IT SIGNS IN WITHOUT TYPING A PASSWORD ============================
//
// Through `deployedSession.mjs`, which exchanges the persona for an idToken at the Identity Toolkit
// endpoint. The password goes from `sandboxCredentials.mjs` straight into the request body and is
// never surfaced, logged or typed. NO SECRET IS EMBEDDED HERE and none is required at author time.
//
// ============================ IT IS READ-ONLY ============================
//
// It looks, it types into a search box, and it follows links. It submits no form, presses no
// governed command, and asserts RequestReorderControl's REACHABILITY without clicking it — a gate
// that raised a real reorder request against the sandbox would be a gate that mutates.
//
// Usage:
//   node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/partsNorthStarQuickGate.mjs [origin] [--expect <sha>]
//
// Exit codes: 0 = every check passed. 1 = at least one failed. 2 = precondition error.
import { chromium } from "@playwright/test";

import { seedAuthenticatedSession, signInPersona } from "./deployedSession.mjs";

const args = process.argv.slice(2);
const expectIdx = args.indexOf("--expect");
const EXPECT_SHA = expectIdx >= 0 ? args[expectIdx + 1] : null;
const ORIGIN = args.find((a) => a.startsWith("http")) ?? "https://eos-platform-sandbox.web.app";
const WORKSPACE = "/inventory";

const checks = [];
function record(id, passed, detail) {
  checks.push({ id, passed, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${id}${detail ? ` — ${detail}` : ""}\n`);
  return passed;
}

// THE CATALOGUE TABLE, not whichever fo-table happens to be first. Anchored on its own heading, so
// adding or removing a panel above it cannot silently re-point this gate at a different table.
function catalogTable(page) {
  return page.locator('xpath=//h3[normalize-space()="Parts Catalog"]/following::table[contains(@class,"fo-table")][1]');
}

// SETTLE BEFORE MEASURING. The catalogue read is a whole-collection getDocs and the health ledger is
// a second read; measuring before both land produces phantom failures that are the gate's fault.
//
// It waits for the CATALOGUE's own rows. If they never arrive it does not hang: it reports what the
// page actually held, because "no Part Number cell", "the catalogue is blocked" and "there are no
// parts" are three different findings and only one of them is a product defect.
async function openWorkspace(page) {
  await page.goto(`${ORIGIN}${WORKSPACE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('h3:has-text("Parts Catalog")', { timeout: 30000 });
  try {
    // catalogTable(page), NOT the `catalogue` const in main(). This function is hoisted above it,
    // so referencing it here is a temporal-dead-zone ReferenceError on every call -- which is what
    // a blanket find-and-replace introduced, and what the catch below then disguised.
    await catalogTable(page).locator("tbody tr").first().waitFor({ state: "attached", timeout: 25000 });
  } catch (err) {
    const body = await page.locator("body").innerText();
    const tables = await page.locator("table.fo-table").evaluateAll((els) =>
      els.map((t) => ({
        headings: [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim()),
        rows: t.querySelectorAll("tbody tr").length,
      })));
    const blocked = /do not have access to the canonical Parts catalog|currently unavailable|could not be verified against the canonical source/i.exec(body);
    // THE UNDERLYING ERROR IS REPORTED, NOT REPLACED. A catch that substitutes a friendlier
    // sentence for the real one reported a ReferenceError as "the catalogue rendered no rows" for
    // two full runs, and sent the investigation at the data instead of at this file.
    throw new Error(
      "the Parts Catalog precondition failed. " +
        (blocked ? `The catalogue read is BLOCKED: "${blocked[0]}". ` : "No blocked-read message is on the page. ") +
        `Tables found: ${JSON.stringify(tables)}. ` +
        `Underlying error: ${err?.message ?? err}`,
    );
  }
  await page.waitForTimeout(1500);
}

async function openRecord(page, partId) {
  await page.goto(`${ORIGIN}${WORKSPACE}/${partId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ns-page", { timeout: 30000 });
  await page.waitForTimeout(2000);
}

// documentElement, NOT body. #1594's escape left body.scrollWidth correct while the document
// scrolled 122px sideways; a body-only assertion reports a clean page and means nothing.
async function overflow(page, label, width) {
  const m = await page.evaluate(() => ({
    clientW: document.documentElement.clientWidth,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
  }));
  return record(
    `${label} no horizontal overflow at ${width}`,
    m.docScrollW <= m.clientW + 1,
    `clientW=${m.clientW} docScrollW=${m.docScrollW} bodyScrollW=${m.bodyScrollW}`,
  );
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
  console.log(`Parts North Star gate — ${ORIGIN}${WORKSPACE}`);
  console.log(`  deployed ${deployed.commit}  env ${deployed.environmentId}/${deployed.environmentRole}`);
  console.log(`  built    ${deployed.buildTime}\n`);

  // ── 0: RELEASE IDENTITY. The environment is the authority on what is deployed, never an exit
  //      code from a deploy command. If the caller named an expected SHA and the origin disagrees,
  //      every check below would be measuring the wrong bundle, so this is a PRECONDITION.
  if (EXPECT_SHA) {
    const ok = deployed.commit === EXPECT_SHA.slice(0, deployed.commit.length);
    record("0  release identity", ok, `deployed=${deployed.commit} expected=${EXPECT_SHA}`);
    if (!ok) {
      console.error("\nREFUSING: the origin is not serving the release this gate was asked to verify.");
      process.exit(2);
    }
  }

  const session = await signInPersona("admin");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));
  page.on("console", (msg) => { if (msg.type() === "error") pageErrors.push(msg.text()); });

  await seedAuthenticatedSession(page, ORIGIN, session);

  // ══════════════════════ FRAME 1a — THE WORKSPACE ══════════════════════

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await openWorkspace(page);
    record(`1  workspace loads at ${width}`, (await catalogTable(page).count()) > 0, "Parts Catalog table present");
    await overflow(page, "2  workspace", width);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openWorkspace(page);

  // IDENTIFIED ONCE. Every collection assertion below is scoped to this one surface rather than
  // rediscovering it, so two checks can never disagree about which table they measured.
  const catalogue = catalogTable(page);

  // ── 3: FRAME 1a's grammar, and ND-25's absence, read from the DEPLOYED headings.
  const headings = (await catalogue.locator("thead th").allInnerTexts()).map((t) => t.trim());
  const quantityHeadings = headings.filter((h) => /^(warehouse available|on hand|available)$/i.test(h));
  record("3  ND-25 workspace declares no quantity column", quantityHeadings.length === 0, `headings=[${headings.join(", ")}]`);

  const FRAME_1A_COLUMNS = ["Part", "Manufacturer", "Category", "Control", "Status", "Attention"];
  const lowered = headings.map((h) => h.toLowerCase());
  record(
    "3a ND-30 the catalogue states Frame 1a's column grammar",
    FRAME_1A_COLUMNS.every((c) => lowered.includes(c.toLowerCase())),
    `expected=[${FRAME_1A_COLUMNS.join(", ")}] got=[${headings.join(", ")}]`,
  );

  // ── 3b: the title block. Frame 1a's counts must be present AND labelled -- a bare number over a
  //       list is the ambiguity ND-30 asked to be avoided ("label the count according to what it
  //       truly represents").
  // EXACT CLASS TOKEN, not a substring. contains(@class,"ns-workspace") also matches the BEM
  // children -- ns-workspace__head, ns-workspace__titleblock, ns-workspace__titlerow -- and the
  // ancestor axis returns the NEAREST first, so this resolved to the title row and saw no chips.
  const panel = page.locator(
    'xpath=//h3[normalize-space()="Parts Catalog"]/ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ns-workspace ")][1]',
  );
  const panelText = (await panel.count()) > 0 ? await panel.innerText() : "";
  record(
    "3b ND-30 the catalogue carries a titled, labelled count",
    /parts? in the catalogue/i.test(panelText),
    panelText.split("\n").slice(0, 3).join(" | ") || "(no ns-workspace panel found)",
  );

  // ── 3c: the view chips, and every count agreeing with its own filter. A chip whose number
  //       disagrees with what it selects is how a list lies about how much work there is.
  // fo-filter-bar is FilterBar’s chips-variant class (ns-collection__views is the collection-page
  // variant this panel deliberately does not use -- see ND-30 in the composition map).
  const chips = await panel.locator(".fo-filter-bar button").allInnerTexts().catch(() => []);
  const chipText = chips.map((c) => c.replace(/\s+/g, " ").trim());
  const hasViews = chipText.some((c) => /^all\b/i.test(c)) && chipText.some((c) => /needs attention/i.test(c));
  record("3c ND-30 the catalogue offers view chips with counts", hasViews, `chips=${JSON.stringify(chipText.slice(0, 6))}`);

  // ── 4: THE VALUE CONTRACT, separate from the grammar contract check 3a owns.
  //
  //      Frame 1a puts the part number as the primary line of the Part cell, so that is where this
  //      looks. It does not pin the column NAME -- ND-26 governs the value, and ND-30 is free to
  //      name the column, which is exactly the collision that made the previous version of this
  //      check time out against a correct page.
  //
  //      A missing cell fails FAST and says which labels the row actually carried, rather than
  //      waiting out a timeout and reporting a locator string.
  const firstRow = catalogue.locator("tbody tr").first();
  const rowCount = await catalogue.locator("tbody tr").count();
  const partCells = catalogue.locator('tbody tr [data-label="Part"]');
  const partCellCount = await partCells.count();
  if (partCellCount === 0) {
    const labels = await firstRow.locator("[data-label]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-label")));
    console.error(
      `PRECONDITION: the catalogue has ${rowCount} rows but no cell labelled "Part". ` +
        `The first row carries: ${JSON.stringify(labels)}`,
    );
    process.exit(2);
  }

  const shownNumber = (await firstRow.locator('[data-label="Part"] a').first().innerText({ timeout: 5000 })).trim();
  const href = (await firstRow.locator("a").first().getAttribute("href")) ?? "";
  const routeId = href.split("/").filter(Boolean).pop() ?? "";

  // The machine-readable half of the value contract: the product stamps the resolved part number
  // onto the cell, so a populated attribute is the identity actually rendered rather than a
  // string scraped out of two stacked lines.
  const populated = await partCells.evaluateAll((els) =>
    els.filter((e) => {
      const stamped = e.querySelector("[data-part-number]")?.getAttribute("data-part-number") ?? "";
      return stamped.trim().length > 0;
    }).length);
  record(
    "4  ND-26 every catalogue row renders a populated Part Number value",
    rowCount > 0 && populated === rowCount,
    `rows=${rowCount} populated=${populated} first="${shownNumber}"` +
      (shownNumber === routeId
        ? "  [NOTE: this fixture's partId and internalPartNumber are identical, so the FIELD contract is not decidable here -- it is proved in test/partsNorthStarProjection and test/partsNorthStarIdentity]"
        : `  [routeId="${routeId}" differs, so the cell demonstrably reads the Part Number]`),
  );

  // ── 4b: the Attention column speaks the projection's words, or says nothing at all. A stored
  //        reorder-request status reaching the reader would be the enum leak this family keeps
  //        finding; an empty cell would be a claim that nothing was checked.
  const attentionIdx = lowered.indexOf("attention");
  let attentionOk = true;
  let attentionDetail = "(no Attention column)";
  if (attentionIdx >= 0) {
    const cells = await catalogTable(page)
      .locator(`tbody tr td:nth-child(${attentionIdx + 1})`)
      .allInnerTexts();
    const trimmed = cells.map((c) => c.trim());
    const leaked = trimmed.filter((c) => /^[A-Z][A-Z_]{3,}$/.test(c));
    const blank = trimmed.filter((c) => c.length === 0);
    attentionOk = trimmed.length > 0 && leaked.length === 0 && blank.length === 0;
    attentionDetail = `rows=${trimmed.length} leaked=${JSON.stringify(leaked.slice(0, 2))} blank=${blank.length} sample=${JSON.stringify(trimmed.slice(0, 3))}`;
  }
  record("4b ND-30 Attention renders governed words or an explicit dash", attentionOk, attentionDetail);

  // ── 5: the typed search finds what the row displays. See the header: this is the defect ND-26
  //      created, and only a live typed search proves the deployed bundle carries the fix.
  const searchBox = page.locator('input[type="search"], input[placeholder*="Search"]').first();
  let searchDetail = "(no search input found)";
  let searchOk = false;
  if ((await searchBox.count()) > 0 && shownNumber && shownNumber !== "Not recorded") {
    await searchBox.fill(shownNumber);
    await page.waitForTimeout(1200);
    const resultsText = await page.locator("body").innerText();
    // The search surface must offer at least one result mentioning the number that was typed.
    searchOk = resultsText.includes(shownNumber);
    searchDetail = `typed="${shownNumber}"`;
  }
  record("5  ND-26 searching the displayed Part Number finds it", searchOk, searchDetail);

  // ══════════════════════ FRAMES 1b/1c — THE RECORD ══════════════════════

  // ── CHOOSE the row, do not take the first. See lesson 3 in the header: a part with no ledger
  //      activity renders an empty Activity section and no reorder control, and checks 12 and 13
  //      then pass without inspecting anything.
  await openWorkspace(page);

  // CHOOSE A PART WITH LEDGER ACTIVITY, BY PROBING RATHER THAN BY READING A COLUMN.
  //
  // The previous version picked the row whose Inventory Health cell was not "No ledger activity".
  // ND-30 moved that column off the catalogue entirely (it lives in the Work group's Operational
  // Queue now), so the selection silently found nothing and fell back to row 0 -- quietly
  // restoring the vacuous pass that check 6a exists to prevent.
  //
  // Probing the records instead depends on NO catalogue column, so the next grammar change cannot
  // re-break it. Bounded to a handful of candidates: this is a gate, not a crawl.
  const candidates = await catalogue.locator("tbody tr").evaluateAll((trs) =>
    trs.slice(0, 6).map((tr) => ({
      number: (tr.querySelector('[data-label="Part"] a')?.textContent ?? "").trim(),
      href: tr.querySelector("a")?.getAttribute("href") ?? null,
    })));

  let chosen = null;
  let chosenIdx = 0;
  let probed = 0;
  for (const [i, candidate] of candidates.entries()) {
    if (!candidate.href) continue;
    probed += 1;
    await page.goto(`${ORIGIN}${candidate.href}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ns-identity__title", { timeout: 30000 });
    await page.waitForTimeout(1500);
    const forecastText = await page
      .locator("section")
      .filter({ has: page.locator("h2", { hasText: "Stock forecast" }) })
      .first()
      .innerText()
      .catch(() => "");
    if (forecastText && !/no stock forecast can be made/i.test(forecastText)) {
      chosen = candidate;
      chosenIdx = i;
      break;
    }
  }
  const ledgerIdx = chosen ? chosenIdx : -1;
  if (!chosen) chosen = candidates[0] ?? { number: "", href: null };
  await openWorkspace(page);
  record(
    "6a a part WITH ledger activity was found to test",
    ledgerIdx >= 0,
    ledgerIdx >= 0
      ? `probed ${probed}, chose row ${chosenIdx} "${chosen.number}" — Activity and the reorder control are exercised`
      : `probed ${probed} candidates and NONE had a stock forecast; falling back to "${chosen.number}". Checks 12 and 13 below are VACUOUS and prove nothing.`,
  );
  const shownNumberForRecord = chosen.number;
  await catalogue.locator("tbody tr").nth(chosenIdx).locator("a").first()
    .click();
  await page.waitForSelector(".ns-page", { timeout: 30000 });
  await page.waitForTimeout(2500);
  const recordUrl = page.url();
  record("6  a workspace row navigates to the record", /\/inventory\/.+/.test(recordUrl), `url=${recordUrl}`);

  const h1 = (await page.locator(".ns-identity__title").first().innerText({ timeout: 15000 })).trim();
  record(
    "7  the record is titled with the row's Part Number",
    h1.length > 0 && h1 === shownNumberForRecord,
    `h1="${h1}" rowShowed="${shownNumberForRecord}"` +
      (shownNumber === routeId ? "  [same caveat as check 4 -- field identity is proved in the unit suites]" : ""),
  );

  // ── 8: ND-25 — the identity layer states no quantity.
  const identity = (await page.locator(".ns-identity").first().innerText()).toLowerCase();
  record(
    "8  ND-25 the record header states no quantity",
    !/\bon hand\b/.test(identity) && !/\bavailable\b/.test(identity),
    `identity="${identity.replace(/\s+/g, " ").slice(0, 90)}…"`,
  );

  // ── 9: ND-27 — no cost, no price, anywhere on the record.
  const bodyText = await page.locator("body").innerText();
  const moneyHits = bodyText.match(/\$[\d,]+\.\d{2}/g) ?? [];
  const costLabel = /(^|\n)\s*(Cost|Unit Cost|Price|Sell Price)\s*(\n|$)/.test(bodyText);
  record("9  ND-27 no cost or price on the record", moneyHits.length === 0 && !costLabel, `money=${JSON.stringify(moneyHits.slice(0, 3))} label=${costLabel}`);

  // ── 10: the inactive-capability sections are TRUTHFUL — heading present, no table, a reason given.
  const whereHeading = page.locator("h2", { hasText: "Where it is" }).first();
  const hasWhere = (await whereHeading.count()) > 0;
  let whereOk = false, whereDetail = "(section missing)";
  if (hasWhere) {
    const section = page.locator("section").filter({ has: page.locator("h2", { hasText: "Where it is" }) }).first();
    const text = await section.innerText();
    const tables = await section.locator("table").count();
    whereOk = tables === 0 && /switched on|not switched on|cannot be listed/i.test(text) && /custody/i.test(text);
    whereDetail = `tables=${tables} statesReason=${/switched on|cannot be listed/i.test(text)} statesCustody=${/custody/i.test(text)}`;
  }
  record("10 ND-25 Where it is states WHY it is empty and draws no table", whereOk, whereDetail);

  // ── 11: the unit treatment matches the part's own control word — one treatment per Part, and an
  //       untracked part correctly gets no section at all.
  const kicker = (await page.locator(".ns-identity__kicker").first().innerText().catch(() => "")).trim();
  const hasSerial = (await page.locator("h2", { hasText: "Serialized units" }).count()) > 0;
  const hasLots = (await page.locator("h2", { hasText: /^Lots$/ }).count()) > 0;
  const expectSerial = /Serialized/i.test(kicker) && !/Serialized \+ Lot/i.test(kicker);
  const expectLot = /Lot Tracked/i.test(kicker);
  const unitOk = expectSerial ? hasSerial && !hasLots : expectLot ? hasLots && !hasSerial : !hasSerial && !hasLots;
  record("11 the unit section matches the part's control word", unitOk, `kicker="${kicker}" serial=${hasSerial} lots=${hasLots}`);

  // ── 12: Activity renders WORDS. A cell of SCREAMING_SNAKE is a stored token reaching a reader.
  const activitySection = page.locator("section").filter({ has: page.locator("h2", { hasText: "Activity" }) }).first();
  let activityOk = true, activityDetail = "(no rows)";
  if ((await activitySection.count()) > 0) {
    const cells = await activitySection.locator("tbody tr td:first-child").allInnerTexts();
    const leaked = cells.map((c) => c.trim()).filter((c) => /^[A-Z][A-Z_]{3,}$/.test(c));
    // ZERO ROWS IS NOT A PASS. An empty Activity section cannot leak an enum, and reporting that as
    // proof that words render is exactly the vacuous green this gate learned to refuse.
    activityOk = cells.length > 0 && leaked.length === 0;
    activityDetail =
      cells.length === 0
        ? "VACUOUS: the Activity section rendered no rows, so nothing was inspected"
        : `rows=${cells.length} words=${JSON.stringify(cells.slice(0, 3).map((c) => c.trim()))} leaked=${JSON.stringify(leaked.slice(0, 3))}`;
  }
  record("12 Activity renders movement words, never the stored enum", activityOk, activityDetail);

  // ── 13: ND-28 — the governed reorder command surface survives. REACHABILITY only: this gate does
  //       not press it, because a gate that raises a real reorder request is a gate that mutates.
  const forecast = page.locator("section").filter({ has: page.locator("h2", { hasText: "Stock forecast" }) }).first();
  const hasForecast = (await forecast.count()) > 0;
  let reorderDetail = "(no Stock forecast section)";
  let reorderOk = false;
  if (hasForecast) {
    const text = await forecast.innerText();
    const namesDerivation = /Derived from this part/i.test(text);
    const reorderReachable = (await forecast.getByRole("button", { name: /request reorder/i }).count()) > 0;
    const noLedgerYet = /no stock forecast can be made/i.test(text);
    // THE CONTROL MUST BE SEEN. Passing through the no-ledger branch proves the honest empty state
    // but says nothing about whether the governed command surface survived the migration, which is
    // the half of ND-28 that matters. A part with ledger activity is chosen at check 6a precisely so
    // this branch is reachable; if it was not, this FAILS and says why.
    reorderOk = namesDerivation && reorderReachable;
    reorderDetail = noLedgerYet
      ? "VACUOUS: this part has no ledger activity, so the forecast and its reorder control did not render — check 6a explains why no better row was available"
      : `namesDerivation=${namesDerivation} reorderReachable=${reorderReachable}`;
  }
  record("13 ND-28 Stock forecast names its derivation; reorder stays reachable", reorderOk, reorderDetail);

  // ── 14: the record at 375 — a warehouse reads this on a handheld.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(1200);
  await overflow(page, "14 record", 375);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ── 15: NOT FOUND is its own sentence, never borrowed from a blocked read.
  await openRecord(page, "definitely-not-a-real-part-id-9999");
  const notFound = await page.locator("body").innerText();
  record(
    "15 not-found is distinct from a blocked read",
    /No part is recorded under/i.test(notFound) && !/do not have access/i.test(notFound) && !/currently unavailable/i.test(notFound),
    `saysNotFound=${/No part is recorded under/i.test(notFound)}`,
  );

  // ── 16: nothing threw while all of that happened.
  record("16 no runtime or console errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

  await browser.close();

  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  ${f.id} — ${f.detail}`);
  }
  console.log(`\nFor Owner visual acceptance:`);
  console.log(`  workspace  ${ORIGIN}${WORKSPACE}`);
  console.log(`  record     ${recordUrl}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`PRECONDITION ERROR: ${err?.message ?? err}`);
  process.exit(2);
});
