import { chromium } from "@playwright/test";
const BASE = "https://eos-platform-sandbox.web.app";
const SKILL = "D:/Taylor_Parts-eos/field-ops-app-vite/.claude/skills/run-field-ops-app-vite";
const { signInPersona, seedAuthenticatedSession } = await import(`file:///${SKILL}/deployedSession.mjs`);
const session = await signInPersona("admin");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read","clipboard-write"] });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type()==="error") logs.push(m.text()); });
try {
  await seedAuthenticatedSession(page, BASE, session);
  await page.goto(`${BASE}/customers`, { waitUntil:"domcontentloaded" });
  await page.waitForTimeout(6000);
  await page.goto(`${BASE}/customers/opportunities?view=all`, { waitUntil:"domcontentloaded" });
  await page.waitForTimeout(5000);

  // FORCE a real render-phase crash: rip out a DOM node React owns, then make React update.
  await page.evaluate(() => {
    const host = document.querySelector("#root");
    const victim = host && host.firstElementChild;
    if (victim) victim.remove();
  });
  await page.locator("tbody tr").first().click({ timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(2500);
  // Nudge a re-render if the removal alone did not.
  await page.goto(`${BASE}/customers`, { waitUntil:"domcontentloaded" }).catch(()=>{});
  await page.waitForTimeout(3000);

  const body = (await page.locator("body").innerText().catch(()=> "")).replace(/\s+/g," ");
  console.log("boundary shown:", /Something went wrong/i.test(body));
  const idMatch = body.match(/Crash ID:\s*([A-Z0-9-]+)/);
  console.log("crash id on screen:", idMatch ? idMatch[1] : "(none)");
  console.log("copy control present:", /Copy diagnostic/i.test(body));
  const summary = logs.find(l => l.startsWith("UI Crash "));
  console.log("console summary:", summary ? summary.slice(0,180) : "(none)");
  if (idMatch) {
    await page.getByRole("button", { name: /Copy diagnostic/i }).click().catch(()=>{});
    await page.waitForTimeout(600);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(()=>""));
    const d = clip ? JSON.parse(clip) : null;
    if (d) {
      console.log("copied payload keys:", Object.keys(d).sort().join(","));
      console.log("  crashId:", d.crashId, "| commit:", d.commit, "| role:", d.identity.role);
      console.log("  route:", d.route.pathname + (d.route.search||""), "| previous:", d.route.previous);
      console.log("  error:", d.error.name + ": " + String(d.error.message).slice(0,70));
      console.log("  trail:", JSON.stringify(d.route.trail));
      const s = JSON.stringify(d);
      console.log("  leaks token/uid/email:", /token|uid|@/i.test(s));
    }
  }
} finally { await browser.close(); }
