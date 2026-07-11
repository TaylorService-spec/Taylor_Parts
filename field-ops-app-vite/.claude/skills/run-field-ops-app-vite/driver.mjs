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
//
// All screenshots are written under .claude/skills/run-field-ops-app-vite/screenshots/.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DRIVER_ACCOUNTS } from "./seed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, "screenshots");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE_URL = "http://localhost:5173/Taylor_Parts/field-ops/?emulator=1";

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
