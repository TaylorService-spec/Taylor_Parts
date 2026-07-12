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
//   verify-cancel-void <accountKey>
//                                 Cancel/Void UI (docs/specifications/
//                                 reorder-request-cancellation.md,
//                                 PR 6 of 6) -- the PRIMARY
//                                 implementation test for that PR.
//                                 Requires seed.mjs's
//                                 CANCEL_VOID_FIXTURE (one
//                                 Cancel-eligible request, one
//                                 Void-eligible ORDERED request with a
//                                 linked Purchase Order) to already be
//                                 seeded. Walks Cancel end-to-end
//                                 (reason required, exact mandated
//                                 confirmation copy, terminal card
//                                 renders, request disappears from its
//                                 active queue) and Void end-to-end
//                                 (same reason/confirmation shape,
//                                 terminal card renders with the
//                                 linked void record). Prints a
//                                 PASS/FAIL report per assertion and
//                                 exits non-zero on any failure.
//
//   verify-inventory-health-catalog <accountKey>
//                                 Inventory Health / Parts Catalog
//                                 separation (docs/specifications/
//                                 inventory-operational-queue.md,
//                                 PR B) -- the PRIMARY implementation
//                                 test for that PR. Confirms Inventory
//                                 Health shows exactly two filter tabs
//                                 (Critical & High, Needs Planning),
//                                 with no ledger-scoped "Show All" tab;
//                                 both tabs display accurate counts;
//                                 the Parts Catalog table (the one true
//                                 complete-catalog view) shows a real
//                                 risk badge for a part with ledger
//                                 activity and an explicit "No ledger
//                                 activity" state for a part with none;
//                                 the catalog's own filter bar shows
//                                 accurate counts. Prints a PASS/FAIL
//                                 report per assertion and exits
//                                 non-zero on any failure.
//
// All screenshots are written under .claude/skills/run-field-ops-app-vite/screenshots/.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DRIVER_ACCOUNTS, NOTIFICATION_IDENTITY_FIXTURE, CANCEL_VOID_FIXTURE, seedLedgerTransactions, db } from "./seed.mjs";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE_URL = "http://localhost:5173/Taylor_Parts/field-ops/?emulator=1";
const APP_ROOT = "http://localhost:5173/Taylor_Parts/field-ops/";

// Inventory Health / Parts Catalog separation, PR B (docs/specifications/
// inventory-operational-queue.md). Reads src/data/partsCatalog.ts as
// plain text and regex-extracts each catalog row's sku/category --
// deliberately NOT a hardcoded expected count or a TS import (this is a
// plain .mjs file with no TS loader configured), so the "exact complete
// catalog size" and "exact per-category count" assertions below stay
// correct even if the catalog's underlying synthetic dataset changes,
// rather than silently drifting from a magic number written once and
// never revisited. Every catalog row is one line, matching the file's
// own established formatting (confirmed via direct inspection).
function readPartsCatalogFromSource() {
  const filePath = join(__dirname, "..", "..", "..", "src", "data", "partsCatalog.ts");
  const text = readFileSync(filePath, "utf-8");
  const rows = [];
  const rowPattern = /sku:\s*"([^"]+)".*?category:\s*"([^"]+)"/g;
  let match;
  while ((match = rowPattern.exec(text)) !== null) {
    rows.push({ sku: match[1], category: match[2] });
  }
  return rows;
}

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

// Fills and submits the real Login.jsx form on whatever page/URL is
// currently loaded, and waits for the authenticated shell to render.
// Split out from login() below so a caller can navigate to a specific
// deep link FIRST (as an unauthenticated visitor would when opening a
// bookmark), then authenticate on that same page -- App.jsx has no
// post-login redirect; it just swaps <Login/> for the routed content
// in place once AuthContext resolves `user`, so the originally
// requested URL is what ends up rendered, with no second navigation.
async function fillAndSubmitLogin(page, accountKey) {
  const acct = DRIVER_ACCOUNTS[accountKey];
  if (!acct) throw new Error(`Unknown account "${accountKey}". Known: ${Object.keys(DRIVER_ACCOUNTS).join(", ")}`);

  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.locator('button[type="submit"]').click();
  // Login.jsx's own gate: the authenticated shell renders once
  // AuthContext resolves `user`, not immediately on click.
  await page.locator("nav.fo-nav, .fo-header").first().waitFor({ timeout: 15000 });
}

async function login(page, accountKey) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await fillAndSubmitLogin(page, accountKey);
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
// The terminal (CANCELLED) sibling renders ReorderRequestCancelled
// (Cancel/Void schema deployment sequence, PR 6 of 6) -- a plainly
// different heading from every active-status card above, which is
// what makes "did this resolve to the active document or the terminal
// one" observable via the DOM without reading component internals.
// Before PR 6, CANCELLED fell through to the generic
// ReorderRequestDecision fallback card (heading "Reorder Request",
// unqualified) -- this constant tracks whichever heading CANCELLED
// actually renders as, not that specific fallback path.
const TERMINAL_FALLBACK_HEADING = "Reorder Request -- Cancelled";

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

  let lastPanelFixture;
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
    lastPanelFixture = fixture;
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

  // --- Refresh/bookmark persistence, completed: load the exact
  // saved/refreshed URL directly, as an unauthenticated visitor
  // reopening a bookmark would, THEN authenticate on that same page.
  // App.jsx has no post-login redirect -- it renders <Login/> in
  // place for the current URL while `user` is unresolved, then swaps
  // in the routed content once auth resolves, so this proves the
  // saved URL itself (not a re-navigation to it) resolves back to the
  // same request post-authentication.
  // client-side navigation drops ?emulator=1 (only the initial BASE_URL
  // load carries it) -- a real saved/bookmarked URL in this dev/test
  // harness needs it re-added to reach the emulator on a fresh full
  // page load; production has no such param at all, so this is purely
  // test-harness plumbing, not a behavior this fix (or the app) owns.
  const reopenUrl = new URL(preReloadUrl);
  reopenUrl.searchParams.set("emulator", "1");
  await page.goto(reopenUrl.toString(), { waitUntil: "domcontentloaded", timeout: 20000 });
  await fillAndSubmitLogin(page, accountKey);
  await assertHeadingAndRequestId(
    page,
    STATUS_HEADING[lastPanelFixture.status],
    lastPanelFixture.activeId,
    "Refresh/bookmark persistence (post-reauth reopen of saved URL)"
  );

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
  // Exact accessible-name match, not hasText substring matching -- every
  // active-status heading is "Reorder Request -- <suffix>", which a plain
  // hasText: "Reorder Request" locator would also match, letting this
  // assertion pass even if the fallback incorrectly resolved to the
  // active document instead of the terminal one.
  const fallbackHeadingVisible = await page
    .getByRole("heading", { name: TERMINAL_FALLBACK_HEADING, exact: true })
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  niReport(
    "No-requestId fallback unchanged: direct /inventory/:partId visit still resolves to the newest (terminal) document (exact heading match)",
    fallbackHeadingVisible
  );
  const fallbackActiveHeadingAbsent = await page
    .locator("h3", { hasText: STATUS_HEADING[NOTIFICATION_IDENTITY_FIXTURE.readyForPartsManager.status] })
    .first()
    .isVisible()
    .then((visible) => !visible)
    .catch(() => true);
  niReport(
    "No-requestId fallback: active-status heading is absent (fallback did not resolve to the active document)",
    fallbackActiveHeadingAbsent
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
  // No click needed to reach it -- the Parts Catalog table's own
  // category filter already defaults to "All Categories" (PartsList.jsx's
  // `category` state initializes to "ALL"). Previously clicked Inventory
  // Health's ledger-scoped "Show All" tab here, which the Inventory
  // Health / Parts Catalog separation (PR B, docs/specifications/
  // inventory-operational-queue.md) removed -- that tab never had any
  // bearing on the Parts Catalog table below in the first place (two
  // independent filter states on the same page), so removing the click
  // changes nothing about what this assertion actually proves.
  await goToInventory(page);
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

// Cancel/Void schema deployment sequence, PR 6 of 6 (docs/specifications/
// reorder-request-cancellation.md). Mirrors verifyNotificationIdentity()
// above -- same niReport()-based PASS/FAIL style, reusing its
// niPassed/niFailed counters (each verify-* command is its own process
// invocation, never both in the same run). Must match PartDetail.jsx's
// CANCEL_VOID_CONFIRMATION_COPY constant exactly -- if a future copy
// edit changes one without the other, this assertion is the thing that
// catches the drift.
const CANCEL_VOID_CONFIRMATION_COPY =
  "This action does not delete history. The record will remain visible for audit purposes.";

// Positively exercises ReasonConfirmAction's required-non-blank-reason
// guard -- clicks "Continue" with {force: true} (bypassing Playwright's
// own actionability check, which would otherwise refuse to click a
// disabled button and never actually prove anything) with the reason
// field holding `reasonValue`, then confirms the UI genuinely did NOT
// advance: the Reason field is still on screen and the mandated
// confirmation copy never appeared. This proves handleContinue()'s own
// `if (!trimmedReason) return;` guard fired, not merely that the
// button LOOKED disabled.
async function assertReasonCannotAdvance(page, reasonValue, label) {
  const reasonInput = page.getByLabel("Reason", { exact: true });
  await reasonInput.fill(reasonValue);
  await page.getByRole("button", { name: "Continue", exact: true }).click({ force: true });
  await page.waitForTimeout(300);
  const stillOnReasonStep = await reasonInput.isVisible().catch(() => false);
  const confirmationShown = await page
    .getByText(CANCEL_VOID_CONFIRMATION_COPY, { exact: true })
    .first()
    .isVisible()
    .catch(() => false);
  niReport(label, stillOnReasonStep && !confirmationShown, `stillOnReasonStep=${stillOnReasonStep}, confirmationShown=${confirmationShown}`);
}

async function verifyCancelVoid(browser, page, accountKey) {
  await login(page, accountKey);

  // --- Cancel, from ASSIGNED_TO_PARTS_ASSOCIATE ---
  const { partId: cancelPartId, requestId: cancelRequestId } = CANCEL_VOID_FIXTURE.cancelEligible;
  await page.goto(inventoryUrl(cancelPartId, cancelRequestId));
  await assertHeadingAndRequestId(
    page,
    "Reorder Request -- Assigned to Parts Associate",
    cancelRequestId,
    "Cancel fixture (pre-action)"
  );

  await page.getByRole("button", { name: "Cancel Reorder Request", exact: true }).click();
  await assertReasonCannotAdvance(page, "", "Cancel: empty reason cannot advance past the reason step");
  await assertReasonCannotAdvance(page, "   ", "Cancel: whitespace-only reason cannot advance past the reason step");
  await page.getByLabel("Reason", { exact: true }).fill("Driver verification -- cancelling this test request.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const cancelConfirmationVisible = await page
    .getByText(CANCEL_VOID_CONFIRMATION_COPY, { exact: true })
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  niReport("Cancel: mandated confirmation copy renders exactly as specified", cancelConfirmationVisible);

  await page.getByRole("button", { name: "Confirm Cancel Reorder Request", exact: true }).click();
  await assertHeadingAndRequestId(page, "Reorder Request -- Cancelled", cancelRequestId, "Cancel (post-action)");
  const cancelReasonVisible = await page
    .getByText("Driver verification -- cancelling this test request.")
    .first()
    .isVisible()
    .catch(() => false);
  niReport("Cancel: reason renders on the terminal card", cancelReasonVisible);

  // --- Cancel: the request disappears from its former active queue ---
  await goToInventory(page);
  const cancelledStillInQueue = await page
    .locator(`a[href*="requestId=${cancelRequestId}"]`)
    .first()
    .isVisible()
    .catch(() => false);
  niReport("Cancel: request no longer appears in any active queue", !cancelledStillInQueue);

  // --- Void, from ORDERED ---
  const { partId: voidPartId, requestId: voidRequestId } = CANCEL_VOID_FIXTURE.voidEligible;
  await page.goto(inventoryUrl(voidPartId, voidRequestId));
  await assertHeadingAndRequestId(page, "Reorder Request -- Ordered", voidRequestId, "Void fixture (pre-action)");
  const originalSupplierVisible = await page
    .getByText("Driver Fixture Supplier")
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  niReport("Void: original Purchase Order details visible before voiding", originalSupplierVisible);
  // Captured here, re-checked after voiding below -- proves the SAME
  // values persist unchanged, not merely that something is rendered.
  const poNumberCell = page.locator("td", { hasText: "PO / reference #" }).locator("xpath=following-sibling::td[1]");
  const orderedDateCell = page.locator("td", { hasText: "Ordered date" }).locator("xpath=following-sibling::td[1]");
  const originalPoNumberText = await poNumberCell.first().innerText().catch(() => null);
  const originalOrderedDateText = await orderedDateCell.first().innerText().catch(() => null);

  await page.getByRole("button", { name: "Void Purchase Order", exact: true }).click();
  await assertReasonCannotAdvance(page, "", "Void: empty reason cannot advance past the reason step");
  await assertReasonCannotAdvance(page, "   ", "Void: whitespace-only reason cannot advance past the reason step");
  await page.getByLabel("Reason", { exact: true }).fill("Driver verification -- voiding this test Purchase Order.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const voidConfirmationVisible = await page
    .getByText(CANCEL_VOID_CONFIRMATION_COPY, { exact: true })
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  niReport("Void: mandated confirmation copy renders exactly as specified", voidConfirmationVisible);

  await page.getByRole("button", { name: "Confirm Void Purchase Order", exact: true }).click();
  await assertHeadingAndRequestId(page, "Reorder Request -- Voided", voidRequestId, "Void (post-action)");
  const voidReasonVisible = await page
    .getByText("Driver verification -- voiding this test Purchase Order.")
    .first()
    .isVisible()
    .catch(() => false);
  niReport("Void: reason renders on the terminal card", voidReasonVisible);
  const voidLinkedPoVisible = await page
    .getByText(voidRequestId, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  niReport("Void: terminal card shows the linked Purchase Order (void record read via useReorderPurchaseOrderVoid)", voidLinkedPoVisible);

  // --- Void: the original Purchase Order's own details remain visible
  // and unchanged after voiding -- not just a linked-record pointer.
  // Compared against the exact values captured pre-void above (not
  // just "something renders"), on the terminal ReorderRequestVoided
  // card's own "Original Purchase Order" table. ---
  const supplierUnchangedAfterVoid = await page.getByText("Driver Fixture Supplier").first().isVisible().catch(() => false);
  niReport("Void: original Purchase Order supplier remains visible and unchanged after voiding", supplierUnchangedAfterVoid);
  const poNumberAfterVoidText = await poNumberCell.first().innerText().catch(() => null);
  niReport(
    "Void: original Purchase Order PO/reference number remains visible and unchanged after voiding",
    poNumberAfterVoidText !== null && poNumberAfterVoidText === originalPoNumberText,
    `before: "${originalPoNumberText}", after: "${poNumberAfterVoidText}"`
  );
  const orderedDateAfterVoidText = await orderedDateCell.first().innerText().catch(() => null);
  niReport(
    "Void: original Purchase Order ordered date remains visible and unchanged after voiding",
    orderedDateAfterVoidText !== null && orderedDateAfterVoidText === originalOrderedDateText,
    `before: "${originalOrderedDateText}", after: "${orderedDateAfterVoidText}"`
  );

  console.log(`\n${niPassed} passed, ${niFailed} failed`);
  return niFailed === 0;
}

// Inventory Health / Parts Catalog separation, PR B (docs/specifications/
// inventory-operational-queue.md). Reuses the same niReport()-based
// PASS/FAIL style and counters as the two verify-* commands above (each
// verify-* command is its own process invocation, never combined).
//
// Fixture ground truth this command's exact-count assertions are
// checked against (not asserted blindly -- derived from what seed.mjs
// actually seeds): exactly two inventory_transactions-bearing parts
// exist in the whole fixture, TST-1001 (RESERVED-only -> NEEDS_PLANNING)
// and TST-1002 (CONSUMED -> the real inventoryAnalyticsEngine.ts
// computation, expected HIGH per seedLedgerTransactions()'s own
// documented math, never asserted here as a hardcoded UI value -- this
// command reads the RENDERED tab/count and checks it against the known
// fixture size, it never substitutes for or bypasses the app's own
// calculation). No other seed.mjs fixture (NOTIFICATION_IDENTITY_FIXTURE,
// CANCEL_VOID_FIXTURE) writes any inventory_transactions document, so
// healthEntries.length is exactly 2, split 1 NEEDS_PLANNING / 1 actionable.
async function verifyInventoryHealthCatalog(browser, page, accountKey) {
  const catalogRows = readPartsCatalogFromSource();
  const expectedTotalCatalogSize = catalogRows.length;
  const expectedMixSystemCount = catalogRows.filter((r) => r.category === "Mix System").length;

  await login(page, accountKey);
  await goToInventory(page);

  // --- Inventory Health: exactly two tabs, no "Show All" ---
  const criticalHighVisible = await page.getByRole("button", { name: /^Critical & High/ }).isVisible().catch(() => false);
  niReport("Inventory Health: Critical & High tab is visible", criticalHighVisible);
  const needsPlanningVisible = await page.getByRole("button", { name: /^Needs Planning/ }).isVisible().catch(() => false);
  niReport("Inventory Health: Needs Planning tab is visible", needsPlanningVisible);
  const showAllGone = await page.getByRole("button", { name: "Show All", exact: true }).isVisible().catch(() => false);
  niReport("Inventory Health: ledger-scoped Show All tab no longer exists", !showAllGone);

  // --- Inventory Health tabs show the EXACT expected count, not just a
  // digit -- 1 actionable (TST-1002, HIGH) and 1 Needs Planning
  // (TST-1001), per the fixture ground truth documented above. ---
  const criticalHighLabel = await page.getByRole("button", { name: /^Critical & High/ }).innerText().catch(() => "");
  niReport(
    "Inventory Health: Critical & High tab shows the exact expected count (1)",
    criticalHighLabel === "Critical & High (1)",
    `label was "${criticalHighLabel}"`
  );
  const needsPlanningLabel = await page.getByRole("button", { name: /^Needs Planning/ }).innerText().catch(() => "");
  niReport(
    "Inventory Health: Needs Planning tab shows the exact expected count (1)",
    needsPlanningLabel === "Needs Planning (1)",
    `label was "${needsPlanningLabel}"`
  );

  // --- Needs Planning: TST-1001 (RESERVED-only, no CONSUMED -- seed.mjs's
  // dedicated NEEDS_PLANNING fixture) appears under this tab ---
  await page.getByRole("button", { name: /^Needs Planning/ }).click();
  await page.waitForTimeout(300);
  const needsPlanningRowVisible = await page.getByRole("cell", { name: "Hex Coupler" }).first().isVisible().catch(() => false);
  niReport("Needs Planning tab: TST-1001 (Hex Coupler) appears", needsPlanningRowVisible);

  // --- Parts Catalog: the one true complete-catalog view -- shows a
  // part with real ledger activity (TST-1001/TST-1002) and a part with
  // none at all (e.g. TST-1004, only ever touched by the notification-
  // identity/Cancel-Void fixtures' reorder_requests, never
  // inventory_transactions). Scoped specifically to the "Parts Catalog"
  // table, same established pattern as the catalog-row-link check
  // above -- an unscoped `tr` locator can also match a row in
  // Inventory Health's own tables higher on the same page (confirmed
  // live: the Needs Planning tab, still showing its own "Hex Coupler"
  // row from the assertion above, made an unscoped locator ambiguous).
  const catalogTable = page.locator('xpath=//h3[text()="Parts Catalog"]/following::table[1]');
  const catalogPartWithActivity = await catalogTable
    .locator("tr", { hasText: "Hex Coupler" })
    .getByText(/CRITICAL|HIGH|MEDIUM|LOW|Needs planning/)
    .first()
    .isVisible()
    .catch(() => false);
  niReport("Parts Catalog: a part with real ledger activity shows a risk badge, not a blank cell", catalogPartWithActivity);
  const catalogPartNoActivity = await catalogTable
    .locator("tr", { hasText: "Hopper Agitator" })
    .getByText("No ledger activity")
    .first()
    .isVisible()
    .catch(() => false);
  niReport("Parts Catalog: a part with zero ledger activity shows the explicit 'No ledger activity' state", catalogPartNoActivity);

  // --- Parts Catalog's own filter bar: exact counts, not just digits.
  // "All Categories" must equal the EXACT complete catalog size, read
  // from the actual source file above, not a hardcoded number. ---
  const allCategoriesLabel = await page.getByRole("button", { name: /^All Categories/ }).innerText().catch(() => "");
  niReport(
    "Parts Catalog: 'All Categories' shows the exact complete catalog size",
    allCategoriesLabel === `All Categories (${expectedTotalCatalogSize})`,
    `label was "${allCategoriesLabel}", expected "All Categories (${expectedTotalCatalogSize})"`
  );
  const mixSystemLabel = await page.getByRole("button", { name: /^Mix System/ }).innerText().catch(() => "");
  niReport(
    "Parts Catalog: a named category ('Mix System') shows its exact part count",
    mixSystemLabel === `Mix System (${expectedMixSystemCount})`,
    `label was "${mixSystemLabel}", expected "Mix System (${expectedMixSystemCount})"`
  );

  // --- Changing categories renders the matching subset, not merely a
  // correct-looking badge -- and proves the zero-ledger part (TST-1004,
  // Mix System) is discoverable through the catalog's own filter path,
  // not just present somewhere on an unfiltered page. ---
  await page.getByRole("button", { name: /^Mix System/ }).click();
  await page.waitForTimeout(300);
  const hopperAgitatorInMixSystemFilter = await catalogTable
    .locator("tr", { hasText: "Hopper Agitator" })
    .getByText("No ledger activity")
    .first()
    .isVisible()
    .catch(() => false);
  niReport(
    "Parts Catalog: the zero-ledger part (TST-1004, Mix System) remains discoverable via the category filter path",
    hopperAgitatorInMixSystemFilter
  );
  const hexCouplerHiddenByMixSystemFilter = await catalogTable
    .locator("tr", { hasText: "Hex Coupler" })
    .isVisible()
    .catch(() => false);
  niReport(
    "Parts Catalog: filtering to Mix System actually narrows results (a Drive Components part is hidden)",
    !hexCouplerHiddenByMixSystemFilter
  );
  await page.getByRole("button", { name: /^All Categories/ }).click();
  await page.waitForTimeout(300);

  // --- Both Inventory Health empty-state messages, exact text, proven
  // by actually rendering each tab empty -- not inferred from the
  // populated-state assertions above. Emulator-only: deletes the two
  // seeded inventory_transactions documents via the Admin SDK (`db`,
  // exported from seed.mjs for this purpose only), forces a fresh
  // mount via a full navigation (useInventoryLedger() is a one-shot
  // read, per its own header comment -- a live-DOM change alone would
  // not be picked up), then restores the fixture before continuing. No
  // production-visible test behavior is added to the app itself.
  //
  // try/finally, not a bare sequence: page.goto(), the heading
  // waitFor(), the Needs Planning click, or any assertion added here
  // later can throw. Without a finally block, a thrown error between
  // the delete above and the restore below would leave THIS emulator
  // session's ledger fixture permanently deleted -- contaminating
  // every later command run against the same `emulators:start`
  // session (submit-ready, verify-notification-identity's own
  // healthEntries-independent checks would still pass, but any future
  // command relying on TST-1001/TST-1002 having ledger activity would
  // silently fail for a reason invisible from its own output).
  // seedLedgerTransactions() must run on every exit path -- pass,
  // assertion failure, or thrown error alike -- and the original
  // failure (if any) must still propagate afterward; restoring the
  // fixture is never allowed to turn a failed run into a passing one. ---
  await db.doc("inventory_transactions/driver-seed-tx-1").delete();
  await db.doc("inventory_transactions/driver-seed-tx-2").delete();
  await db.doc("inventory_transactions/driver-seed-tx-3").delete();

  try {
    // A full page.goto() carrying ?emulator=1 preserves the Auth
    // session here (confirmed live -- distinct from the already-
    // documented page.reload() session-drop quirk elsewhere in this
    // skill, and from client-side navigation silently dropping
    // ?emulator=1 the notification-identity driver commands work
    // around). No re-login needed -- the page loads already-authenticated.
    const inventoryPageUrl = new URL("inventory", APP_ROOT);
    inventoryPageUrl.searchParams.set("emulator", "1");
    await page.goto(inventoryPageUrl.toString(), { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.getByRole("heading", { name: "Inventory Operational Queue" }).waitFor({ timeout: 10000 });

    const emptyCriticalHighText = await page
      .getByText("No parts are currently Critical or High priority.")
      .first()
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    niReport(
      "Inventory Health: Critical & High shows the EXACT mandated empty message when genuinely empty",
      emptyCriticalHighText
    );
    await page.getByRole("button", { name: /^Needs Planning/ }).click();
    await page.waitForTimeout(300);
    const emptyNeedsPlanningText = await page.getByText("No parts currently need planning.").first().isVisible().catch(() => false);
    niReport(
      "Inventory Health: Needs Planning shows the EXACT mandated empty message when genuinely empty",
      emptyNeedsPlanningText
    );
    const emptyCriticalHighLabel = await page.getByRole("button", { name: /^Critical & High/ }).innerText().catch(() => "");
    niReport(
      "Inventory Health: Critical & High tab count is exactly (0) while genuinely empty",
      emptyCriticalHighLabel === "Critical & High (0)",
      `label was "${emptyCriticalHighLabel}"`
    );
    const emptyNeedsPlanningLabel = await page.getByRole("button", { name: /^Needs Planning/ }).innerText().catch(() => "");
    niReport(
      "Inventory Health: Needs Planning tab count is exactly (0) while genuinely empty",
      emptyNeedsPlanningLabel === "Needs Planning (0)",
      `label was "${emptyNeedsPlanningLabel}"`
    );
  } finally {
    // Restore the fixture for any later command/run against this same
    // emulator session -- leaves the database exactly as seed.mjs
    // would have left it, regardless of whether the try block above
    // passed, failed an assertion, or threw. If restoration itself
    // fails, that is reported explicitly and fails the command -- it
    // must never be silently swallowed, since a failed restore is
    // exactly the contamination this finally block exists to prevent.
    try {
      await seedLedgerTransactions();
    } catch (restoreErr) {
      niReport(
        "Fixture restoration: seedLedgerTransactions() succeeded after the empty-state block",
        false,
        `restoration itself threw: ${restoreErr.message}`
      );
    }
  }

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
      // "Critical & High" is the default tab already -- no click needed
      // to select it. Inventory Health / Parts Catalog separation (PR B)
      // removed the ledger-scoped "Show All" tab this command used to
      // fall back to; seed.mjs's TST-1002 now seeds enough CONSUMED
      // quantity to deterministically land HIGH, so the default tab
      // always has a READY, analytics-backed, one-click row to act on.
      // No quantity input for this path.
      await page.getByRole("button", { name: "Request Reorder" }).first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(SCREENSHOT_DIR, outPng), fullPage: true });
      console.log(`OK: submitted READY one-click as ${accountKey}, screenshot -> screenshots/${outPng}`);
    } else if (command === "verify-notification-identity") {
      const [accountKey = "admin"] = args;
      const ok = await verifyNotificationIdentity(browser, page, accountKey);
      if (!ok) process.exitCode = 1;
    } else if (command === "verify-cancel-void") {
      const [accountKey = "admin"] = args;
      const ok = await verifyCancelVoid(browser, page, accountKey);
      if (!ok) process.exitCode = 1;
    } else if (command === "verify-inventory-health-catalog") {
      const [accountKey = "admin"] = args;
      const ok = await verifyInventoryHealthCatalog(browser, page, accountKey);
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
