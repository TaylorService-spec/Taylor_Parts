import { chromium } from "@playwright/test";
const BASE = "https://eos-platform-sandbox.web.app";
const SKILL = "D:/Taylor_Parts-eos/field-ops-app-vite/.claude/skills/run-field-ops-app-vite";
const { DRIVER_ACCOUNTS } = await import(`file:///${SKILL}/seed.mjs`);
const { establishSession } = await import(`file:///${SKILL}/deployedSession.mjs`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await establishSession(page, { BASE, IS_LOCAL:false, EMU:"", accountKey:"admin", driverAccounts: DRIVER_ACCOUNTS });
  await page.goto(`${BASE}/customers/opportunities?view=all`, { waitUntil:"domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.locator("tbody tr").first().click().catch(()=>{});
  await page.waitForTimeout(4000);
  const hits = await page.evaluate(() => {
    const re = /\b[A-Za-z0-9]{20}\b/;
    const out = [];
    const walk = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && re.test(n.textContent)) {
          const p = n.parentElement;
          const row = p.closest("[class*='fo-']") || p;
          out.push({ text: n.textContent.trim().slice(0,40), tag: p.tagName, cls: (p.className||"").toString().slice(0,60),
                     ctx: (row.innerText||"").replace(/\s+/g," ").slice(0,120) });
        } else if (n.nodeType === 1) walk(n);
      }
    };
    walk(document.querySelector("main") || document.body);
    return out;
  });
  console.log("RAW ID OCCURRENCES:", hits.length);
  for (const h of hits) console.log(JSON.stringify(h, null, 1));
} finally { await browser.close(); }
