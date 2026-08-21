#!/usr/bin/env node
// PERSONA REACHABILITY PROFILE -- what each persona actually reaches, and what it actually sees.
//
// ============================ WHY THIS IS NOT A REDIRECT AUDIT ============================
//
// The structural sweep recorded ZERO NAV_REDIRECTED for every persona: each one landed on all 54
// routes. The instinct is to read that as "no route protection", and it is wrong.
//
// App.jsx generates a route for EVERY nav item, and for the items a role cannot see it renders an
// EmptyState reading "<label> isn't available to your role" instead of the real screen. The route
// therefore always exists and only its ELEMENT differs -- so a denied persona lands, is told why, and
// is never silently bounced somewhere it did not ask for. Zero redirects is the designed outcome, and
// a better one: a redirect tells you nothing about why you are somewhere else.
//
// ============================ WHY IT DOES NOT COMPARE AGAINST isNavItemVisible ============================
//
// That same predicate decides both what the nav shows AND which routes render the denial. Asserting
// they agree would be asserting the UI is self-consistent, which it is by construction -- a
// tautology, and exactly the kind of check that passes forever while telling you nothing.
//
// navConfig.js states the real boundary itself: nav visibility is NOT the security boundary.
// Capability gates and Firestore Rules are. So what this measures is the thing that actually matters
// and that a tautological check cannot see: DID BUSINESS DATA RENDER. A persona that reaches a
// surface and sees zero rows behind a governed denial is fail-closed working. A persona that reaches
// it and sees real records is an access finding regardless of what any nav predicate believes.
//
// Usage:  node reachability.mjs <accountKey> [width]
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..", "..", "..");
const BASE = "http://localhost:5173/Taylor_Parts/field-ops";
const accountKey = process.argv[2] ?? "admin";
const WIDTH = Number(process.argv[3] ?? 1440);
const routes = JSON.parse(readFileSync(join(APP_ROOT, ".certification", "routes.json"), "utf8"));
const { DRIVER_ACCOUNTS } = await import("./seed.mjs");
const acct = DRIVER_ACCOUNTS[accountKey];
if (!acct) throw new Error(`unknown account '${accountKey}'`);

// The governed denial App.jsx renders for a nav item the role cannot see. Matched on the stable half
// of the sentence, since the leading "<label>" varies per route.
const DENIAL = /isn['’]t available to your role/i;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
const rows = [];
try {
  await page.goto(`${BASE}/?emulator=1`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.locator('button[type="submit"]').click();
  await page.locator(".fo-appheader, .fo-workspace, .fo-rail").first().waitFor({ timeout: 20000 });

  for (const r of routes) {
    let rec;
    try {
      // `?emulator=1` on EVERY navigation -- without it a full page load silently repoints the app at
      // production, the session dies, and every subsequent route reads as denied.
      await page.goto(`${BASE}${r.route}?emulator=1`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
      rec = await page.evaluate(() => {
        const main = document.querySelector("main") || document.body;
        const text = (main.innerText || "").replace(/\s+/g, " ").trim();
        return { text: text.slice(0, 160), len: text.length, dataRows: document.querySelectorAll("tbody tr").length };
      });
      rec.landed = new URL(page.url()).pathname.replace("/Taylor_Parts/field-ops", "") || "/";
    } catch (err) {
      rows.push({ route: r.route, label: r.label, classification: "VISIT_FAILED", detail: String(err?.message).slice(0, 90) });
      continue;
    }
    const denied = DENIAL.test(rec.text);
    // DENIED_BY_ROLE  the governed denial rendered in place of the screen.
    // CONTENT         real business rows rendered.
    // REACHED_NO_DATA reached, not denied, nothing to show -- an empty list, an unwired source, or a
    //                 surface whose own capability gate refused below the route level. NOT an access
    //                 finding on its own, and deliberately not merged into either of the others.
    rows.push({
      route: r.route, label: r.label, landed: rec.landed, dataRows: rec.dataRows, textLen: rec.len,
      classification: denied ? "DENIED_BY_ROLE" : rec.dataRows > 0 ? "CONTENT" : "REACHED_NO_DATA",
      sample: rec.text.slice(0, 70),
    });
  }
} finally {
  await browser.close();
}

mkdirSync(join(APP_ROOT, ".certification"), { recursive: true });
writeFileSync(join(APP_ROOT, ".certification", `reachability-${accountKey}.json`), JSON.stringify(rows, null, 1));

const by = {};
for (const r of rows) by[r.classification] = (by[r.classification] ?? 0) + 1;
console.log(`\npersona=${accountKey} width=${WIDTH} routes=${routes.length}`);
for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log("\nCONTENT routes (business data actually rendered):");
for (const r of rows.filter((x) => x.classification === "CONTENT")) {
  console.log(`   ${r.route.padEnd(38)} rows=${String(r.dataRows).padStart(3)}  ${r.sample.slice(0, 46)}`);
}
