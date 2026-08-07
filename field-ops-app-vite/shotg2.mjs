import { chromium } from "@playwright/test";
import fs from "node:fs";

const SP = "C:/Users/Rudy2/AppData/Local/Temp/claude/d--Taylor-Parts/4a4e40dd-c7a5-479f-98b9-f04d905a4141/scratchpad";
const BASE = "https://eos-platform-sandbox.web.app";
const creds = JSON.parse(fs.readFileSync(`${SP}/sandbox-credentials.local.json`, "utf8"));
const EMAIL = "admin@sandbox.invalid";

const VIEWPORTS = [
  ["desktop", 1440, 950],
  ["tablet", 1024, 900],
  ["mobile", 390, 844],
];
const ROUTES = [
  ["service", "/service"],
  ["inventory", "/inventory"],
  ["purchasing", "/purchasing"],
];

const browser = await chromium.launch();

for (const [vp, width, height] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', creds[EMAIL]);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".fo-shell", { timeout: 60000 });
  await page.waitForTimeout(3500);

  for (const [name, route] of ROUTES) {
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector(".fo-main", { timeout: 30000 });
      await page.waitForTimeout(4500);
      await page.screenshot({ path: `${SP}/shots/g2-${vp}-${name}.png` });
      console.log("OK", vp, name);
    } catch (e) {
      console.log("FAIL", vp, name, e.message.split("\n")[0]);
    }
  }

  // Mobile: also capture the drawer open, which is the whole navigation model
  // at that breakpoint and cannot be judged from the closed state.
  if (vp === "mobile") {
    try {
      await page.click(".fo-navtoggle");
      await page.waitForSelector(".fo-drawer", { timeout: 10000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SP}/shots/g2-mobile-drawer.png` });
      console.log("OK mobile drawer");
    } catch (e) {
      console.log("FAIL mobile drawer", e.message.split("\n")[0]);
    }
  }
  await page.close();
}

await browser.close();
