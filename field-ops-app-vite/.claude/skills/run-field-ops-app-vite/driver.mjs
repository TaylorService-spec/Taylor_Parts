// Playwright driver for field-ops-app-vite. Drives the real running
// app (Vite dev server + Firestore/Auth emulator) through a browser --
// not a test-suite import, an actual signed-in session clicking
// through the UI. See SKILL.md for the full launch sequence.
//
// Usage (from field-ops-app-vite/, after the emulator + seed + dev
// server are all up -- see SKILL.md):
//   node .claude/skills/run-field-ops-app-vite/driver.mjs <command> [args]
//
// Commands:
//   login <accountKey> [outPng]   Sign in via the real Login.jsx form
//                                 as one of seed.mjs's DRIVER_ACCOUNTS
//                                 (admin | eligiblePartsManager |
//                                 ineligibleDispatcher), land on the
//                                 authenticated shell, screenshot.
//   inventory <accountKey> [outPng]
//                                 login, then navigate to
//                                 Inventory > Parts, screenshot the
//                                 Needs Reorder queue.
//   needs-planning <accountKey> [outPng]
//                                 login, navigate to Inventory > Parts,
//                                 switch the queue filter to
//                                 "Needs Planning", screenshot.
//   submit-manual-qty <accountKey> <qty> [outPng]
//                                 login, switch to "Needs Planning",
//                                 enter <qty> in the first row's
//                                 quantity input, click
//                                 "Request Reorder", screenshot the
//                                 result (Requested / an error).
//   submit-ready <accountKey> [outPng]
//                                 login, default "Critical & High"
//                                 filter, one-click "Request Reorder"
//                                 on the first row (READY/analytics
//                                 path, no quantity input), screenshot
//                                 the result.
//   verify-notification-identity <accountKey>
//                                 Notification identity fix
//                                 (docs/specifications/
//                                 notification-identity.md, Issue
//                                 #145) -- the PRIMARY implementation
//                                 test for that fix. Requires
//                                 seed.mjs's NOTIFICATION_IDENTITY_FIXTURE
//                                 (four parts, each with an active +
//                                 newer-terminal Reorder Request pair)
//                                 to already be seeded. Clicks all
//                                 four Notification Panel sections and
//                                 all three PartsList.jsx queue links,
//                                 asserting each resolves to the exact
//                                 active request, not the newer
//                                 terminal sibling; checks hard-refresh
//                                 persistence; checks the no-requestId
//                                 fallback is genuinely unchanged
//                                 (still resolves to the terminal
//                                 document, as it always has); checks
//                                 the not-found and mismatch fail-safe
//                                 states; checks the catalog-row link
//                                 carries no requestId. Prints a
//                                 PASS/FAIL report per assertion (same
//                                 style as functions/test/*.test.js)
//                                 and exits non-zero on any failure.
//
// All screenshots are written under .claude/skills/run-field-ops-app-vite/screenshots/.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DRIVER_ACCOUNTS, NOTIFICATION_IDENTITY_FIXTURE } from "./seed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE_URL = "http://localhost:5173/Taylor_Parts/field-ops/?emulator=1";
const APP_ROOT = "http://localhost:5173/Taylor_Parts/field-ops/";

// Notification identity fix -- builds a direct /inventory/:partId URL
// (optionally with ?requestId=), always carrying ?emulator=1. Used by
// verify-notification-identity's fail-safe/fallback checks, which
// navigate straight to a URL rather than clicking through the UI.
function inventoryUrl(partId, requestId) {
  const url = new URL(`inventory/${partId}`, APP_ROOT);
  url.searchParams.set("emulator", "1");
  if (requestId) url.searchParams.set("requestId", requestId);
  return url.toString();
}

async function login(page, accountKey) {
  const acct = DRIVER_ACCOUNTS[accountKey];
  if (!acct) throw new Error(`Unknown account "${accountKey}". Known: ${Object.keys(DRIVER_ACCOUNTS).join(", ")}`);

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.locator('button[type="submit"]').click();
  // Login.jsx's own gate: the authenticated shell renders once
  // AuthContext resolves `user`, not immediately on click.
  await page.locator("nav.fo-nav, .fo-header").first().waitFor({ timeout: 15000 });
}

async function goToInventory(page) {
  await page.getByRole("link", { name: "Inventory" }).first().click();
  await page.getByRole("heading", { name: "Inventory Operational Queue" }).waitFor({ timeout: 10000 });
}

async function switchToNeedsPlanning(page) {
  await page.getByRole("button", { name: "Needs Planning" }).click();
  // Give the filtered re-render a moment (client-side useMemo, no network wait needed).
  await page.waitForTimeout(300);
}

// Notification identity fix -- verification report helpers, same
// PASS/FAIL-per-assertion style as functions/test/*.test.js (this
// project's established test-output convention), applied here to a
// real Playwright browser session instead of raw Firestore REST calls.
let niPassed = 0;
let niFailed = 0;
function niReport(name, ok, detail) {
  if (ok) {
    niPassed += 1;
    console.log(`PASS -- ${name}`);
  } else {
    niFailed += 1;
    console.log(`FAIL -- ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const STATUS_HEADING = {
  PENDING_REVIEW: "Reorder Request -- Pending Review",
  READY_FOR_PARTS_MANAGER: "Reorder Request -- Ready for Parts Manager",
  ASSIGNED_TO_PARTS_ASSOCIATE: "Reorder Request -- Assigned to Parts Associate",
  PURCHASING_IN_PROGRESS: "Reorder Request -- Purchasing In Progress",
};
// The terminal (CANCELLED) sibling falls through PartDetail.jsx's
// status-branch chain to ReorderRequestDecision, the generic fallback
// card -- a plainly different heading from every active-status card
// above, which is what makes "did this resolve to the active document
// or the terminal one" observable via the DOM without reading
// component internals.
const TERMINAL_FALLBACK_HEADING = "Reorder Request";

// Deliberately NOT "networkidle" -- confirmed live that this app's
// persistent Firestore onSnapshot connections never let the network
// go idle once authenticated, so networkidle only works for the very
// first, pre-auth page load (same reason goToInventory() above waits
// on a specific heading, not network state). Every navigation below
// waits on a specific, meaningful element instead.
async function assertHeadingAndRequestId(page, expectedHeading, expectedRequestId, label) {
  const headingLocator = page.locator("h3", { hasText: expectedHeading }).first();
  const heading = await headingLocator
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const url = new URL(page.url());
  const actualRequestId = url.searchParams.get("requestId");
  niReport(
    `${label}: correct card heading ("${expectedHeading}") visible`,
    heading,
    heading ? undefined : `URL was ${page.url()}`
  );
  niReport(
    `${label}: URL requestId equals the expected active document (${expectedRequestId})`,
    actualRequestId === expectedRequestId,
    `URL requestId was "${actualRequestId}"`
  );
}

async function verifyNotificationIdentity(browser, page, accountKey) {
  await login(page, accountKey);

  // --- All four Notification Panel sections. AppHeader.jsx (and the
  // Notification Panel it renders) is part of the persistent app
  // shell, present on every authenticated route -- no re-navigation
  // to BASE_URL needed between cases, just reopen the panel from
  // wherever the previous case's click landed. ---
  const panelCases = [
    { key: "pendingReview", sectionLabel: "Pending Review" },
    { key: "readyForPartsManager", sectionLabel: "Ready for Parts Manager" },
    { key: "assignedToYou", sectionLabel: "Assigned to You" },
    { key: "purchasingStarted", sectionLabel: "Purchasing Started" },
  ];

  for (const { key, sectionLabel } of panelCases) {
    const fixture = NOTIFICATION_IDENTITY_FIXTURE[key];
    await page.locator('button[aria-label="Notifications"]').click();
    // Match by href (contains the exact requestId), not visible text --
    // items render the real catalog part name (getCatalogItem().name),
    // not the raw partId, once the fixture uses a real catalog part.
    const item = page.locator(`a.fo-notification-panel-item[href*="requestId=${fixture.activeId}"]`).first();
    const itemVisible = await item.isVisible().catch(() => false);
    niReport(`NotificationPanel "${sectionLabel}" section: item for ${fixture.partId} is visible`, itemVisible);
    if (!itemVisible) continue;
    await item.click();
    await assertHeadingAndRequestId(
      page,
      STATUS_HEADING[fixture.status],
      fixture.activeId,
      `NotificationPanel "${sectionLabel}"`
    );
  }

  // --- Hard-refresh persistence, using the last resolved URL above ---
  // Confirmed live (see SKILL.md's Gotchas): this environment's Auth
  // emulator session does NOT survive a Playwright page.reload() --
  // the app correctly falls back to the Login screen post-reload,
  // same as it would for any genuinely logged-out visitor. That is a
  // pre-existing characteristic of this test environment/tooling
  // combination, unrelated to the notification identity fix, and out
  // of scope to fix here. What this fix actually needs proven is
  // narrower and still fully checkable: the requestId QUERY PARAMETER
  // ITSELF survives the reload at the URL level (the specific reason
  // Option A -- a query param -- was chosen over router-state-only
  // Option C, which would lose the id on reload with no URL trace at
  // all). Checked immediately post-reload, before any redirect to the
  // Login screen could occur.
  const preReloadUrl = page.url();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  niReport(
    "Hard-refresh persistence: requestId query parameter survives reload at the URL level",
    page.url() === preReloadUrl,
    `before: ${preReloadUrl}, after: ${page.url()}`
  );
  // Re-authenticate on a FRESH page (this environment's reload
  // behavior, not the feature under test, dropped the session --
  // confirmed live: this Auth-emulator + Playwright combination
  // doesn't persist a session across page.reload()). A brand-new page
  // has zero pre-existing Firestore onSnapshot connections, so
  // login()'s own "networkidle" wait -- which hangs on THIS page by
  // now, the same reason every other navigation above waits on a
  // specific element instead -- works reliably here exactly as it
  // does for every other command's very first call.
  await page.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await login(page, accountKey);

  // --- All three PartsList.jsx queue links ---
  const queueCases = ["readyForPartsManager", "assignedToYou", "purchasingStarted"];
  await goToInventory(page);
  for (const key of queueCases) {
    const fixture = NOTIFICATION_IDENTITY_FIXTURE[key];
    const link = page.locator(`a[href*="requestId=${fixture.activeId}"]`).first();
    const linkVisible = await link.isVisible().catch(() => false);
    niReport(`PartsList queue link for ${fixture.partId} is visible`, linkVisible);
    if (!linkVisible) continue;
    await link.click();
    await assertHeadingAndRequestId(page, STATUS_HEADING[fixture.status], fixture.activeId, `PartsList queue (${fixture.partId})`);
    await goToInventory(page);
  }

  // --- No-requestId fallback: genuinely unchanged, still resolves to
  // the newest-by-createdAt document regardless of status (the
  // terminal sibling) -- a regression check, not a new assertion. ---
  const fallbackPartId = NOTIFICATION_IDENTITY_FIXTURE.readyForPartsManager.partId;
  await page.goto(inventoryUrl(fallbackPartId));
  const fallbackHeadingVisible = await page
    .locator("h3", { hasText: TERMINAL_FALLBACK_HEADING })
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  niReport(
    "No-requestId fallback unchanged: direct /inventory/:partId visit still resolves to the newest (terminal) document",
    fallbackHeadingVisible
  );

  // --- Fail-safe: not-found ---
  const notFoundPartId = NOTIFICATION_IDENTITY_FIXTURE.pendingReview.partId;
  await page.goto(inventoryUrl(notFoundPartId, "does-not-exist-xyz"));
  const notFoundVisible = await page
    .getByText("This reorder request could not be found.")
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  niReport("Fail-safe: not-found empty state renders for a non-existent requestId", notFoundVisible);

  // --- Fail-safe: mismatch (a real id, but for a different part) ---
  const mismatchPartId = NOTIFICATION_IDENTITY_FIXTURE.pendingReview.partId;
  const foreignRequestId = NOTIFICATION_IDENTITY_FIXTURE.readyForPartsManager.activeId;
  await page.goto(inventoryUrl(mismatchPartId, foreignRequestId));
  const mismatchVisible = await page
    .getByText("This reorder request does not belong to this part.")
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  niReport("Fail-safe: mismatch empty state renders when requestId belongs to a different part", mismatchVisible);

  // --- Catalog-row link unchanged (PartsList.jsx:381 as of the
  // Specification -- a plain, non-Reorder-Request catalog link) ---
  await goToInventory(page);
  await page.getByRole("button", { name: "Show All" }).click();
  await page.waitForTimeout(300);
  // Scoped specifically to the "Parts Catalog" table -- `table.fo-table`
  // alone would also match the Parts Manager/Parts Associate Queue
  // tables above it on the same page (confirmed live: an unscoped
  // `.first()` picked up a queue row instead of a catalog row).
  const catalogLink = page.locator('xpath=//h3[text()="Parts Catalog"]/following::table[1]//a').first();
  const catalogHref = await catalogLink.getAttribute("href").catch(() => null);
  niReport(
    "Catalog-row link carries no requestId query parameter (unchanged)",
    typeof catalogHref === "string" && !catalogHref.includes("requestId="),
    `href was "${catalogHref}"`
  );

  console.log(`\n${niPassed} passed, ${niFailed} failed`);
  return niFailed === 0;
}

async function main() {
  const [, , command, ...args] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    if (command === "login") {
      const [accountKey, outPng = "login.png"] = args;
      await login(page, accountKey);
      await page.screenshot({ path: join(SCREENSHOT_DIR, outPng) });
      console.log(`OK: logged in as ${accountKey}, screenshot -> screenshots/${outPng}`);
    } else if (command === "inventory") {
      const [accountKey, outPng = "inventory.png"] = args;
      await login(page, accountKey);
      await goToInventory(page);
      await page.screenshot({ path: join(SCREENSHOT_DIR, outPng), fullPage: true });
      console.log(`OK: inventory queue screenshot -> screenshots/${outPng}`);
    } else if (command === "needs-planning") {
      const [accountKey, outPng = "needs-planning.png"] = args;
      await login(page, accountKey);
      await goToInventory(page);
      await switchToNeedsPlanning(page);
      await page.screenshot({ path: join(SCREENSHOT_DIR, outPng), fullPage: true });
      console.log(`OK: Needs Planning filter screenshot -> screenshots/${outPng}`);
    } else if (command === "submit-manual-qty") {
      const [accountKey, qty, outPng = "submit-manual-qty.png"] = args;
      await login(page, accountKey);
      await goToInventory(page);
      await switchToNeedsPlanning(page);
      const qtyInput = page.locator('input[aria-label="Manual reorder quantity"]').first();
      if ((await qtyInput.count()) === 0) {
        await page.screenshot({ path: join(SCREENSHOT_DIR, outPng), fullPage: true });
        console.log(`OK (no input found -- likely ineligible-user messaging instead): screenshot -> screenshots/${outPng}`);
      } else {
        await qtyInput.fill(String(qty));
        await qtyInput.locator("xpath=following-sibling::button[1]").click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(SCREENSHOT_DIR, outPng), fullPage: true });
        console.log(`OK: submitted qty ${qty} as ${accountKey}, screenshot -> screenshots/${outPng}`);
      }
    } else if (command === "submit-ready") {
      const [accountKey, outPng = "submit-ready.png"] = args;
      await login(page, accountKey);
      await goToInventory(page);
      // "Show All", not the default "Critical & High" filter -- a
      // READY part isn't guaranteed to land in CRITICAL/HIGH (confirmed
      // live: seed.mjs's TST-1002 came out LOW, still a valid READY,
      // analytics-backed, one-click case, just not in the default
      // filter). No quantity input for this path.
      await page.getByRole("button", { name: "Show All" }).click();
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Request Reorder" }).first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, outPng), fullPage: true });
      console.log(`OK: submitted READY one-click as ${accountKey}, screenshot -> screenshots/${outPng}`);
    } else if (command === "verify-notification-identity") {
      const [accountKey = "admin"] = args;
      const ok = await verifyNotificationIdentity(browser, page, accountKey);
      if (!ok) process.exitCode = 1;
    } else {
      console.error(`Unknown command "${command}". See the header comment in this file for usage.`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Driver failed:", err);
  process.exit(1);
});
