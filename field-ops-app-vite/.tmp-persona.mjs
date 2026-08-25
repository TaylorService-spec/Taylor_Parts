import { chromium } from "@playwright/test";
const BASE = "https://eos-platform-sandbox.web.app";
const SKILL = "D:/Taylor_Parts-eos/field-ops-app-vite/.claude/skills/run-field-ops-app-vite";
const { DRIVER_ACCOUNTS } = await import(`file:///${SKILL}/seed.mjs`);
const { establishSession } = await import(`file:///${SKILL}/deployedSession.mjs`);
const ROUTES = ["/customers/opportunities","/customers/opportunities?view=all","/customers","/customers/sales-orders","/dashboard","/service"];
const personas = Object.keys(DRIVER_ACCOUNTS);
console.log("driver personas:", personas.join(", "));
for (const persona of personas) {
  for (const width of [1440, 375]) {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 } });
    let log = [];
    page.on("console", (m) => { const t = m.text(); if (t.startsWith("UI Crash:")) log.push(t.slice(0,700)); });
    page.on("pageerror", (e) => log.push(`PAGEERROR ${e.message} :: ${(e.stack||"").split("\n").slice(1,4).join(" | ")}`));
    try {
      await establishSession(page, { BASE, IS_LOCAL:false, EMU:"", accountKey:persona, driverAccounts: DRIVER_ACCOUNTS });
      for (const route of ROUTES) {
        log = [];
        await page.goto(`${BASE}${route}`, { waitUntil:"domcontentloaded" }).catch(()=>{});
        await page.waitForTimeout(3000);
        const body = (await page.locator("body").innerText().catch(()=> "")).replace(/\s+/g," ");
        if (/Something went wrong/i.test(body) || log.length) {
          console.log(`\n*** CRASH  persona=${persona} w=${width} route=${route}`);
          for (const l of log.slice(0,2)) console.log("    " + l.slice(0,700));
          if (!log.length) console.log("    boundary shown, no UI Crash captured: " + body.slice(0,200));
        }
      }
    } catch (e) { console.log(`  (persona ${persona} w=${width} session failed: ${e.message.slice(0,60)})`); }
    finally { await browser.close(); }
  }
  console.log(`  swept ${persona}`);
}
