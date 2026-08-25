import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const BASE = "https://eos-platform-sandbox.web.app";
const SKILL = "D:/Taylor_Parts-eos/field-ops-app-vite/.claude/skills/run-field-ops-app-vite";
const { DRIVER_ACCOUNTS } = await import(`file:///${SKILL}/seed.mjs`);
const { establishSession } = await import(`file:///${SKILL}/deployedSession.mjs`);
const routes = JSON.parse(readFileSync("D:/Taylor_Parts-eos/field-ops-app-vite/.certification/routes.json","utf8")).map(r=>r.route);
const extra = ["/customers/opportunities?view=all","/customers/opportunities?view=won","/customers/opportunities?view=lost",
  "/customers/sales-orders","/customers/DaA2nyrxE5kAddDwo8cC","/customers/opportunities/sales-order/woLlxBdWk81BW6bg8zkY",
  "/service/work-orders/wo-sbx-007","/equipment/eq-c713-1","/inventory/CW-P-0000"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let crashLog = [];
page.on("console", (m) => { const t = m.text(); if (t.startsWith("UI Crash:")) crashLog.push(t.slice(0, 500)); });
page.on("pageerror", (e) => crashLog.push(`PAGEERROR ${e.message} :: ${(e.stack||"").split("\n")[1]||""}`));
const crashed = [];
try {
  await establishSession(page, { BASE, IS_LOCAL:false, EMU:"", accountKey:"admin", driverAccounts: DRIVER_ACCOUNTS });
  for (const route of [...routes, ...extra]) {
    crashLog = [];
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" }).catch(()=>{});
    await page.waitForTimeout(2600);
    const text = (await page.locator("main, body").first().innerText().catch(()=> "")).replace(/\s+/g," ");
    const boundary = /Something went wrong/i.test(text);
    if (boundary || crashLog.length) {
      crashed.push({ route, boundary, log: crashLog.slice(0,2) });
      console.log(`\nCRASH  ${route}  boundary=${boundary}`);
      for (const l of crashLog.slice(0,2)) console.log("   " + l.slice(0,400));
      // recover for the next route
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" }).catch(()=>{});
      await page.waitForTimeout(1500);
    }
  }
} finally { await browser.close(); }
console.log(`\nswept ${routes.length + extra.length} routes; crashing: ${crashed.length}`);
