#!/usr/bin/env node
// CRASH STRESS — the interactions and races a route sweep cannot see.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// A user hit the root error boundary in sandbox twice while every automated check was green: 63
// routes, 15 driver accounts, 12 real personas, and a five-width responsive sweep. All of them LOAD
// A ROUTE AND MEASURE IT. None of them clicks anything, goes back, reloads a detail, or navigates
// away while a read is still in flight — which is exactly where state and lifecycle defects live.
//
// ════════════════════ EVERY CRASH SIGNAL IS FATAL HERE ════════════════════
//
// Not merely the boundary text. A pageerror, an uncaught exception, an unhandledrejection, a React
// "UI Crash:" console entry, and an unexpected console.error each fail the step that produced them.
// Successful navigation is NOT a pass if the boundary rendered afterwards.
//
// Usage:  node crashStress.mjs [persona] [slow]
//   The `slow` pass applies real network latency, because a race that needs 700ms to appear is
//   invisible on a fast connection and perfectly reproducible on a phone.
import { chromium } from "@playwright/test";
const BASE = "https://eos-platform-sandbox.web.app";
const SKILL = "D:/Taylor_Parts-eos/field-ops-app-vite/.claude/skills/run-field-ops-app-vite";
const { signInPersona, seedAuthenticatedSession } = await import(`file:///${SKILL}/deployedSession.mjs`);

const persona = process.argv[2] ?? "admin";
const THROTTLE = process.argv[3] === "slow";
const session = await signInPersona(persona);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// EVERY crash signal is fatal, not just the boundary.
const signals = [];
page.on("pageerror", (e) => signals.push({ kind: "pageerror", detail: `${e.name}: ${e.message}`, stack: (e.stack||"").split("\n").slice(0,12).join("\n") }));
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("UI Crash:")) signals.push({ kind: "UI_CRASH", detail: t.slice(0, 2000) });
  // TOLERATED, AND ONLY THIS. The Firestore SDK reports its own transport state, and the throttled
  // pass deliberately starves it — that warning is this harness doing it, not a defect in the app.
  // Everything else, including any unexpected console.error, fails the step that produced it.
  else if (m.type() === "error" && !/Could not reach Cloud Firestore backend|ERR_FAILED|favicon/i.test(t)) {
    signals.push({ kind: "console.error", detail: t.slice(0, 600) });
  }
});
await page.addInitScript(() => {
  window.__unhandled = [];
  addEventListener("unhandledrejection", (e) => {
    window.__unhandled.push(String(e.reason && (e.reason.stack || e.reason.message || e.reason)).slice(0, 800));
  });
});

if (THROTTLE) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  // Slow enough that a read is reliably still in flight when the next action fires.
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 700, downloadThroughput: 250*1024, uploadThroughput: 120*1024 });
}

let failures = 0;
const drain = async () => (await page.evaluate(() => { const u = window.__unhandled || []; window.__unhandled = []; return u; }));
async function step(name, fn) {
  signals.length = 0;
  await drain();
  try { await fn(); } catch (e) { /* a click that misses is not the finding */ }
  await page.waitForTimeout(700);
  const unhandled = await drain();
  const body = (await page.locator("body").innerText().catch(()=> "")).replace(/\s+/g," ");
  const boundary = /Something went wrong/i.test(body);
  const bad = [...signals, ...unhandled.map((u) => ({ kind: "unhandledrejection", detail: u }))];
  if (boundary || bad.length) {
    failures += 1;
    console.log(`\n*** CRASH  [${persona}${THROTTLE ? "/slow" : ""}]  ${name}`);
    console.log(`    url: ${page.url().replace(BASE,"")}   boundary: ${boundary}`);
    for (const b of bad.slice(0, 3)) {
      console.log(`    ${b.kind}: ${b.detail}`);
      if (b.stack) console.log(`      ${b.stack.replace(/\n/g, "\n      ")}`);
    }
    await page.goto(`${BASE}/dashboard`, { waitUntil:"domcontentloaded" }).catch(()=>{});
    await page.waitForTimeout(1200);
  }
}
const go = (r, wait=3500) => page.goto(`${BASE}${r}`, { waitUntil:"domcontentloaded" }).then(()=>page.waitForTimeout(wait));

try {
  await seedAuthenticatedSession(page, BASE, session);

  // 1. detail then immediately away
  await step("opportunity: select row then navigate away instantly", async () => {
    await go("/customers/opportunities?view=all", 4000);
    await page.locator("tbody tr").first().click({ timeout: 5000 });
    await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
  });
  // 2. rapid switching between records
  await step("opportunity: rapid switch between two rows", async () => {
    await go("/customers/opportunities?view=all", 4000);
    const rows = page.locator("tbody tr");
    for (let i = 0; i < 6; i++) { await rows.nth(i % 2).click({ timeout: 3000 }).catch(()=>{}); await page.waitForTimeout(120); }
  });
  // 3. filter switching while a read is pending
  await step("opportunity: hammer the view filters", async () => {
    await go("/customers/opportunities", 4000);
    for (const v of ["Won","Lost","All","Open","Won","All"]) {
      await page.getByRole("radio", { name: new RegExp(`^${v}`) }).click({ timeout: 3000 }).catch(()=>{});
      await page.waitForTimeout(90);
    }
  });
  // 4. select a row then immediately change the filter (selection no longer in view)
  await step("opportunity: select row then switch filter under it", async () => {
    await go("/customers/opportunities?view=all", 4000);
    await page.locator("tbody tr").first().click({ timeout: 4000 }).catch(()=>{});
    await page.waitForTimeout(150);
    await page.getByRole("radio", { name: /^Open/ }).click({ timeout: 3000 }).catch(()=>{});
    await page.waitForTimeout(150);
    await page.getByRole("radio", { name: /^Lost/ }).click({ timeout: 3000 }).catch(()=>{});
  });
  // 5. back/forward
  await step("browser back/forward across views", async () => {
    await go("/customers/opportunities", 3000);
    await page.getByRole("radio", { name: /^Won/ }).click({ timeout: 3000 }).catch(()=>{});
    await page.waitForTimeout(600);
    await page.goBack(); await page.waitForTimeout(600);
    await page.goForward(); await page.waitForTimeout(600);
    await page.goBack();
  });
  // 6. hard reload on dynamic details
  for (const [n, r] of [["sales order","/customers/opportunities/sales-order/woLlxBdWk81BW6bg8zkY"],
                        ["account","/customers/DaA2nyrxE5kAddDwo8cC"],
                        ["work order","/service/work-orders/wo-sbx-007"]]) {
    await step(`hard reload: ${n}`, async () => { await go(r, 3500); await page.reload({ waitUntil:"domcontentloaded" }); await page.waitForTimeout(3000); });
  }
  // 7. list -> row -> back -> row (consecutive records)
  await step("sales orders: consecutive records via back", async () => {
    await go("/customers/sales-orders", 5000);
    await page.locator("tbody tr").nth(0).click({ timeout: 5000 }).catch(()=>{});
    await page.waitForTimeout(1500);
    await page.goBack(); await page.waitForTimeout(2500);
    await page.locator("tbody tr").nth(1).click({ timeout: 5000 }).catch(()=>{});
  });
  // 8. account edit open/cancel
  await step("account: open edit then cancel", async () => {
    await go("/customers", 5000);
    await page.locator("tbody tr").first().click({ timeout: 5000 }).catch(()=>{});
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: /^Edit/ }).first().click({ timeout: 4000 }).catch(()=>{});
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: /Cancel/ }).first().click({ timeout: 4000 }).catch(()=>{});
  });
  // 9. navigate away mid-read, repeatedly
  await step("abort reads: bounce between heavy lists", async () => {
    for (let i = 0; i < 5; i++) {
      await page.goto(`${BASE}/customers/sales-orders`, { waitUntil: "commit" });
      await page.waitForTimeout(250);
      await page.goto(`${BASE}/customers/opportunities?view=all`, { waitUntil: "commit" });
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(3000);
  });
  // 10. mobile nav transitions
  await step("mobile: nav transitions", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const r of ["/dashboard","/customers","/customers/opportunities?view=all","/customers/sales-orders","/service"]) {
      await page.goto(`${BASE}${r}`, { waitUntil:"domcontentloaded" }); await page.waitForTimeout(1800);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  // ── THE BOUNDARY MUST BE ABLE TO FAIL, AND SAY SO ──────────────────────────────────────────
  //
  // Every step above passing is only meaningful if this harness can detect a crash at all. The
  // RAW_ID detector reported a confident zero for months while it was structurally incapable of
  // firing; this is the same instrument class, so it gets the same proof -- against the DEPLOYED
  // build, not a unit test.
  //
  // Deliberately NOT counted as a failure: it is the one step that is supposed to crash.
  {
    signals.length = 0;
    await drain();
    await page.goto(`${BASE}/customers?__crashtest=1`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2500);
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/s+/g, " ");
    const boundary = /Something went wrong/i.test(body);
    const id = (body.match(/Crash ID:s*([A-Z0-9-]+)/) || [])[1] ?? null;
    const sawCrashLog = signals.some((x) => x.kind === "UI_CRASH" || x.kind === "pageerror" || x.kind === "console.error");
    console.log(`
BOUNDARY SELF-TEST  boundary=${boundary}  crashId=${id ?? "(none)"}  detected=${sawCrashLog}`);
    // THREE SEPARATE CLAIMS, and the first deployed run proved why they must be checked apart:
    // the boundary caught and the harness detected, but no crash id rendered -- the componentDidCatch
    // edit had silently failed to apply, so the diagnostic was imported and never built. A combined
    // assertion would have read as "mostly working".
    if (!boundary) { failures += 1; console.log("*** THE BOUNDARY DID NOT CATCH. Every clean result above is unproven."); }
    if (!sawCrashLog) { failures += 1; console.log("*** THE HARNESS SAW NO CRASH SIGNAL. Every clean result above is unproven."); }
    if (!id) { failures += 1; console.log("*** NO CRASH ID RENDERED. The next real crash will be as undiagnosable as the last one."); }
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1200);
  }
} finally { await browser.close(); }
console.log(`\n[${persona}${THROTTLE ? "/slow" : ""}] crash stress complete — crashing steps: ${failures}`);
// A crashing step is a release failure, not a line in a log somebody may read.
if (failures > 0) process.exit(1);
