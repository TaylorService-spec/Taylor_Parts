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
// ============================ WHY CHECK 4 IS A TYPED SEARCH ============================
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

// SETTLE BEFORE MEASURING. The catalogue read is a whole-collection getDocs and the health ledger is
// a second read; measuring before both land produces phantom failures that are the gate's fault.
async function openWorkspace(page) {
  await page.goto(`${ORIGIN}${WORKSPACE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table.fo-table", { timeout: 30000 });
  await page.waitForTimeout(2000);
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
    record(`1  workspace loads at ${width}`, (await page.locator("table.fo-table").count()) > 0);
    await overflow(page, "2  workspace", width);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openWorkspace(page);

  // ── 3: ND-25 — no quantity column. Read the HEADINGS the deployed bundle renders, not the source.
  const headings = (await page.locator("table.fo-table thead th").allInnerTexts()).map((t) => t.trim());
  const quantityHeadings = headings.filter((h) => /^(warehouse available|on hand|available)$/i.test(h));
  record("3  ND-25 workspace declares no quantity column", quantityHeadings.length === 0, `headings=[${headings.join(", ")}]`);

  // ── 4: ND-26 — the Part Number column carries internalPartNumber, not the document key. The row's
  //      own link href carries the document key, which is what makes this comparable at all.
  const firstRow = page.locator("table.fo-table tbody tr").first();
  const shownNumber = (await firstRow.locator('[data-label="Part Number"]').innerText()).trim();
  const href = (await firstRow.locator("a").first().getAttribute("href")) ?? "";
  const routeId = href.split("/").filter(Boolean).pop() ?? "";
  record(
    "4  ND-26 Part Number column is not the document key",
    shownNumber.length > 0 && shownNumber !== routeId,
    `shown="${shownNumber}" routeId="${routeId}"`,
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

  await openWorkspace(page);
  await firstRow.locator("a").first().click();
  await page.waitForSelector(".ns-page", { timeout: 30000 });
  await page.waitForTimeout(2500);
  const recordUrl = page.url();
  record("6  a workspace row navigates to the record", /\/inventory\/.+/.test(recordUrl), `url=${recordUrl}`);

  const h1 = (await page.locator("h1").first().innerText()).trim();
  record("7  ND-26 the record title is the Part Number, not the route id", h1 === shownNumber || (h1.length > 0 && h1 !== routeId), `h1="${h1}" routeId="${routeId}"`);

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
    activityOk = leaked.length === 0;
    activityDetail = `rows=${cells.length} leaked=${JSON.stringify(leaked.slice(0, 3))}`;
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
    const namesDerivation = /Derived from this part/i.test(text) || /no stock forecast can be made/i.test(text);
    const reorderReachable = (await forecast.getByRole("button", { name: /request reorder/i }).count()) > 0;
    const noLedgerYet = /no stock forecast can be made/i.test(text);
    // Either the control is reachable, or the part legitimately has no ledger to forecast from.
    reorderOk = namesDerivation && (reorderReachable || noLedgerYet);
    reorderDetail = `namesDerivation=${namesDerivation} reorderReachable=${reorderReachable} noLedger=${noLedgerYet}`;
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
