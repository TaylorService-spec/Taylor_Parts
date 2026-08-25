import { chromium } from "@playwright/test";
const BASE = "https://eos-platform-sandbox.web.app";
const SKILL = "D:/Taylor_Parts-eos/field-ops-app-vite/.claude/skills/run-field-ops-app-vite";
const { signInPersona, seedAuthenticatedSession } = await import(`file:///${SKILL}/deployedSession.mjs`);
const session = await signInPersona("admin");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport:{width:1440,height:900} })).newPage();
try {
  await seedAuthenticatedSession(page, BASE, session);
  for (const route of ["/service/job-assignments","/service/coordinated-visits","/service/coordinated-mission"]) {
    await page.goto(`${BASE}${route}`, { waitUntil:"domcontentloaded" });
    await page.waitForTimeout(5000);
    const hits = await page.evaluate(() => {
      const re = /\b[A-Za-z0-9]{20}\b/;
      const out = [];
      const walk = (el) => { for (const n of el.childNodes) {
        if (n.nodeType === 3 && re.test(n.textContent)) {
          const p = n.parentElement;
          const cell = p.closest("td,th,li,dd,div,span") || p;
          const row = p.closest("tr,li,section,article") || p;
          out.push({ text: n.textContent.trim().slice(0,30), tag: p.tagName, cls: (p.className||"").toString().slice(0,50),
                     cellLabel: cell.getAttribute?.("data-label") || null,
                     row: (row.innerText||"").replace(/\s+/g," ").slice(0,140) });
        } else if (n.nodeType===1) walk(n);
      } };
      walk(document.querySelector("main") || document.body);
      return out;
    });
    console.log(`\n=== ${route}  (${hits.length} raw id occurrences)`);
    for (const h of hits.slice(0,3)) console.log("   " + JSON.stringify(h));
  }
} finally { await browser.close(); }
