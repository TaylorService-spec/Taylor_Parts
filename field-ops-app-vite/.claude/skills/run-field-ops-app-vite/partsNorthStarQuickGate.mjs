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
//    62 parts in catalogue, 25 rows rendered, every one carrying data-label="Part Number".
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
//    So the record under test is now CHOSEN, not taken: the first row whose Inventory Health is
//    something other than "No ledger activity". That part has movements to render and a forecast to
//    gate the reorder control on, which is what makes checks 12 and 13 mean anything. When no such
//    row exists the gate says so in the detail rather than quietly reverting to a weak pass.

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
    await catalogTable(page).locator("tbody tr").first().waitFor({ state: "attached", timeout: 25000 });
  } catch {
    const body = await page.locator("body").innerText();
    const tables = await page.locator("table.fo-table").evaluateAll((els) =>
      els.map((t) => ({
        headings: [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim()),
        rows: t.querySelectorAll("tbody tr").length,
      })));
    const blocked = /do not have access to the canonical Parts catalog|currently unavailable|could not be verified against the canonical source/i.exec(body);
    throw new Error(
      "the Parts Catalog rendered no rows. " +
        (blocked ? `The catalogue read is BLOCKED: "${blocked[0]}". ` : "No blocked-read message is on the page. ") +
        `Tables found: ${JSON.stringify(tables)}`,
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

  // ── 3: ND-25 — no quantity column. Read the HEADINGS the deployed bundle renders, not the source.
  const headings = (await catalogTable(page).locator("thead th").allInnerTexts()).map((t) => t.trim());
  const quantityHeadings = headings.filter((h) => /^(warehouse available|on hand|available)$/i.test(h));
  record("3  ND-25 workspace declares no quantity column", quantityHeadings.length === 0, `headings=[${headings.join(", ")}]`);

  // ── 4: the Part Number column is present and POPULATED on every row. See the header: whether the
  //      cell reads internalPartNumber or partId is not decidable here when the fixture makes them
  //      the same string, so this asserts what is observable and REPORTS the coincidence rather than
  //      asserting an inequality that would fail a correct page.
  const firstRow = catalogTable(page).locator("tbody tr").first();
  const shownNumber = (await firstRow.locator('[data-label="Part Number"]').innerText({ timeout: 15000 })).trim();
  const href = (await firstRow.locator("a").first().getAttribute("href")) ?? "";
  const routeId = href.split("/").filter(Boolean).pop() ?? "";

  const rowCount = await catalogTable(page).locator("tbody tr").count();
  const populated = await catalogTable(page)
    .locator('tbody tr [data-label="Part Number"]')
    .evaluateAll((els) => els.filter((e) => e.textContent.trim().length > 0).length);
  record(
    "4  every catalogue row carries a populated Part Number",
    rowCount > 0 && populated === rowCount,
    `rows=${rowCount} populated=${populated} first="${shownNumber}"` +
      (shownNumber === routeId
        ? "  [NOTE: this fixture's partId and internalPartNumber are identical, so the FIELD contract is not decidable here -- it is proved in test/partsNorthStarProjection and test/partsNorthStarIdentity]"
        : `  [routeId="${routeId}" differs, so the cell demonstrably reads the Part Number]`),
  );

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
  const rowHealth = await catalogTable(page)
    .locator("tbody tr")
    .evaluateAll((trs) =>
      trs.map((tr) => ({
        health: (tr.querySelector('[data-label="Inventory Health"]')?.textContent ?? "").trim(),
        number: (tr.querySelector('[data-label="Part Number"]')?.textContent ?? "").trim(),
      })));
  const ledgerIdx = rowHealth.findIndex((r) => r.health && !/no ledger activity/i.test(r.health));
  const chosenIdx = ledgerIdx >= 0 ? ledgerIdx : 0;
  const chosen = rowHealth[chosenIdx];
  record(
    "6a a part WITH ledger activity was available to test",
    ledgerIdx >= 0,
    ledgerIdx >= 0
      ? `chose row ${chosenIdx} "${chosen.number}" health="${chosen.health}" — Activity and the reorder control are exercised`
      : `NO row has ledger activity; falling back to row 0 "${chosen.number}". Checks 12 and 13 below are VACUOUS and prove nothing.`,
  );
  const recordRow = catalogTable(page).locator("tbody tr").nth(chosenIdx);
  const shownNumberForRecord = chosen.number;
  await recordRow.locator("a").first().click();
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
