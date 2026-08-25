import { chromium } from "@playwright/test";
const BASE = "https://eos-platform-sandbox.web.app";
const SKILL = "D:/Taylor_Parts-eos/field-ops-app-vite/.claude/skills/run-field-ops-app-vite";
const { DRIVER_ACCOUNTS } = await import(`file:///${SKILL}/seed.mjs`);
const { establishSession } = await import(`file:///${SKILL}/deployedSession.mjs`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], failures = [], pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 400)); });
page.on("pageerror", (e) => pageErrors.push(`${e.message}\n${(e.stack || "").split("\n").slice(0, 8).join("\n")}`));
page.on("response", async (r) => { if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const settle = (ms=6000) => page.waitForTimeout(ms);

const visit = async (label, route, after) => {
  errors.length = 0; failures.length = 0; pageErrors.length = 0;
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await settle();
  if (after) await after();
  const text = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
  const crashed = /Something went wrong|failed again|Reloading may clear/i.test(text);
  console.log(`\n=== ${label}  ${route}`);
  console.log(`   crashed: ${crashed}`);
  if (crashed) console.log(`   boundary text: ${text.slice(0, 160)}`);
  if (pageErrors.length) console.log(`   PAGE ERRORS:\n     ${pageErrors.join("\n     ").slice(0, 900)}`);
  if (errors.length) console.log(`   CONSOLE:\n     ${[...new Set(errors)].slice(0,4).join("\n     ").slice(0, 700)}`);
  if (failures.length) console.log(`   NET: ${[...new Set(failures)].slice(0,4).join(" | ")}`);
  if (!crashed) console.log(`   text: ${text.slice(0, 200)}`);
};

try {
  await establishSession(page, { BASE, IS_LOCAL:false, EMU:"", accountKey:"admin", driverAccounts: DRIVER_ACCOUNTS });
  await visit("opportunities default", "/customers/opportunities");
  await visit("opportunities view=all (direct)", "/customers/opportunities?view=all");
  await visit("opportunities view=won", "/customers/opportunities?view=won");
  await visit("opportunities view=all + select row", "/customers/opportunities?view=all", async () => {
    await page.locator("tbody tr").first().click().catch(()=>{});
    await page.waitForTimeout(5000);
  });
  await visit("customers", "/customers");
  await visit("sales orders", "/customers/sales-orders");
} finally { await browser.close(); }
