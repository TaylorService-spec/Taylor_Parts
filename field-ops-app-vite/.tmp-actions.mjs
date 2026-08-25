import { chromium } from "@playwright/test";
const BASE = "https://eos-platform-sandbox.web.app";
const SKILL = "D:/Taylor_Parts-eos/field-ops-app-vite/.claude/skills/run-field-ops-app-vite";
const { DRIVER_ACCOUNTS } = await import(`file:///${SKILL}/seed.mjs`);
const { establishSession } = await import(`file:///${SKILL}/deployedSession.mjs`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let log = [];
page.on("console", (m) => { const t = m.text(); if (t.startsWith("UI Crash:") || m.type()==="error") log.push(t.slice(0,600)); });
page.on("pageerror", (e) => log.push(`PAGEERROR ${e.message}\n${(e.stack||"").split("\n").slice(0,6).join("\n")}`));
const boundary = async () => /Something went wrong/i.test((await page.locator("body").innerText().catch(()=> "")));
const step = async (name, fn) => {
  log = [];
  try { await fn(); } catch (e) { console.log(`  (step threw: ${e.message.slice(0,80)})`); }
  await page.waitForTimeout(2500);
  const b = await boundary();
  const crash = log.filter(l => l.startsWith("UI Crash:") || l.startsWith("PAGEERROR"));
  if (b || crash.length) {
    console.log(`\n*** CRASH AFTER: ${name}   boundary=${b}  url=${page.url().replace(BASE,"")}`);
    for (const c of crash.slice(0,2)) console.log("    " + c.slice(0,700));
    if (!crash.length) console.log("    (boundary shown; no UI Crash line captured)");
    await page.goto(`${BASE}/dashboard`, { waitUntil:"domcontentloaded" }); await page.waitForTimeout(1500);
  } else console.log(`  ok  ${name}`);
};
try {
  await establishSession(page, { BASE, IS_LOCAL:false, EMU:"", accountKey:"admin", driverAccounts: DRIVER_ACCOUNTS });

  console.log("--- OPPORTUNITY view control + selection");
  await page.goto(`${BASE}/customers/opportunities`, { waitUntil:"domcontentloaded" }); await page.waitForTimeout(6000);
  for (const label of ["Won","Lost","All","Open"]) {
    await step(`click view ${label}`, async () => { await page.getByRole("radio", { name: new RegExp(`^${label}`) }).click({ timeout: 8000 }); });
  }
  await step("select first row (All)", async () => {
    await page.getByRole("radio", { name: /^All/ }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    await page.locator("tbody tr").first().click({ timeout: 8000 });
  });
  await step("open a detail section editor", async () => {
    const edit = page.getByRole("button", { name: /^Edit/ }).first();
    if (await edit.count()) await edit.click({ timeout: 8000 });
  });

  console.log("--- ACCOUNT detail + edit form");
  await page.goto(`${BASE}/customers`, { waitUntil:"domcontentloaded" }); await page.waitForTimeout(6000);
  await step("open first customer", async () => { await page.locator("tbody tr").first().click({ timeout: 8000 }); });
  await step("open the account edit form", async () => {
    const e = page.getByRole("button", { name: /^Edit/ }).first();
    if (await e.count()) await e.click({ timeout: 8000 });
  });

  console.log("--- SALES ORDER detail");
  await page.goto(`${BASE}/customers/sales-orders`, { waitUntil:"domcontentloaded" }); await page.waitForTimeout(6000);
  await step("open a sales order", async () => { await page.locator("tbody tr").first().click({ timeout: 8000 }); });
  await step("sales orders: switch saved view", async () => {
    await page.goto(`${BASE}/customers/sales-orders`, { waitUntil:"domcontentloaded" }); await page.waitForTimeout(5000);
    const sel = page.locator("select").first();
    if (await sel.count()) await sel.selectOption({ index: 1 }).catch(()=>{});
  });
} finally { await browser.close(); }
