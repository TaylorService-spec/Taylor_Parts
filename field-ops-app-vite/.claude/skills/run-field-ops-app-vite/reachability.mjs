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
// BASE is overridable so the SAME gate can run against a DEPLOYED sandbox, not only the local dev
// server. A regression gate that can only be pointed at localhost certifies the developer's machine;
// the deployed build is the thing that actually has to be certified. Set CERT_BASE to the deployed
// origin plus the app base path, e.g.
//   CERT_BASE=https://eos-platform-sandbox.web.app/Taylor_Parts/field-ops
const BASE = process.env.CERT_BASE || "http://localhost:5173/Taylor_Parts/field-ops";
// `?emulator=1` IS A LOCAL-ONLY SWITCH, and appending it blindly would make CERT_BASE a trap.
// firebase.js reads it to connect the Auth/Firestore emulators; against a DEPLOYED sandbox there are
// no emulators to connect to, so carrying it over would point the app at nothing and produce a run
// that fails everywhere for a reason that has nothing to do with the build under test -- another
// confidently wrong number, which this file has produced enough of.
//
// It is still MANDATORY on every local navigation: dropping it on a full page load silently repoints
// the app at PRODUCTION, the session dies, and the sweep reads as a site-wide failure.
const IS_LOCAL = /localhost|127.0.0.1/.test(BASE);
const EMU = IS_LOCAL ? "?emulator=1" : "";
// THE APP'S BASE PATH IS NOT A CONSTANT. Locally Vite serves under /Taylor_Parts/field-ops; the
// deployed sandbox is built with base '/' (see its version.json). Hardcoding the local prefix made
// the expected path unmatchable against a deployed build, and the first deployed sweep duly
// reported NAV_REDIRECTED on 108 of 108 visits -- i.e. "the entire site redirects", which is
// alarming, specific, and false. Derive it from BASE so the check means the same thing on both.
const RAW_BASE_PATH = new URL(BASE).pathname;
const BASE_PATH = RAW_BASE_PATH.endsWith("/") ? RAW_BASE_PATH.slice(0, -1) : RAW_BASE_PATH;

// WAIT FOR CONTENT, NOT FOR A NUMBER.
//
// This was `waitForTimeout(900)` -- a constant tuned on localhost, where the bundle is already warm
// and there is no network. Pointed at a deployed origin the same 900ms lands BEFORE React paints,
// and the probe then measures an empty page. A deployed technician sweep duly reported EMPTY_PAGE on
// /administration/permission-preview; probed directly with a longer wait, that route renders 169
// characters of the correct governed denial. Nothing was wrong with the build.
//
// Seventh false-positive family, same root as the other six: the harness encoded an assumption
// about its environment and reported the assumption's violation as a defect in the thing under
// test. So this waits for the CONDITION that actually matters -- the main region having rendered
// something -- and falls through after a bounded ceiling rather than hanging. A route that is
// genuinely empty still reports EMPTY_PAGE; it just has to earn it.
async function settle(page) {
  try {
    await page.waitForFunction(
      () => {
        const m = document.querySelector('main') || document.body;
        return (m.innerText || '').trim().length > 20;
      },
      { timeout: 8000 },
    );
  } catch {
    // Bounded, not fatal: a genuinely blank route must still be measured and reported as blank.
  }
  await page.waitForTimeout(250);
}

const accountKey = process.argv[2] ?? "admin";
const WIDTH = Number(process.argv[3] ?? 1440);
const routes = JSON.parse(readFileSync(join(APP_ROOT, ".certification", "routes.json"), "utf8"));
const { DRIVER_ACCOUNTS } = await import("./seed.mjs");
const { establishSession } = await import("./deployedSession.mjs");
const acct = DRIVER_ACCOUNTS[accountKey];
if (!acct) throw new Error(`unknown account '${accountKey}'`);

// The governed denial App.jsx renders for a nav item the role cannot see. Matched on the stable half
// of the sentence, since the leading "<label>" varies per route.
const DENIAL = /isn['’]t available to your role/i;

// THE SAME HARDENING certify.mjs ALREADY NEEDED, applied to its sibling. A profile run visits 54
// routes in one browser and this one did not recycle or recover, so a technician run failed at
// index 32 -- /reporting/builder -- while that identical route, probed directly after login, loads
// in ~1.2s and renders its governed denial. Position, not the page.
//
// It was briefly misdiagnosed as contention from running sweeps in parallel. That was true of a
// DIFFERENT pair of failures and false here: this one reproduced with nothing else running, which
// is what ruled the explanation out. Recycling every 15 routes removes the window.
let browser = null;
let page = null;
async function openSession() {
  if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
  // Dual-target: the real form against the emulator (which certifies Login.jsx itself), a
  // token-seeded session against a deployed sandbox (whose accounts the emulator never seeds,
  // and where no password is typed into a field). See deployedSession.mjs.
  await establishSession(page, { BASE, IS_LOCAL, EMU, accountKey, driverAccounts: DRIVER_ACCOUNTS });
}
const rows = [];
try {
  await openSession();

  let visitIndex = 0;
  for (const r of routes) {
    // Recycle before the browser degrades, rather than only after. See the note at openSession().
    if (visitIndex > 0 && visitIndex % 15 === 0) await openSession();
    visitIndex += 1;
    let rec;
    try {
      // `?emulator=1` on EVERY navigation -- without it a full page load silently repoints the app at
      // production, the session dies, and every subsequent route reads as denied.
      await page.goto(`${BASE}${r.route}${EMU}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      rec = await page.evaluate(() => {
        const main = document.querySelector("main") || document.body;
        const text = (main.innerText || "").replace(/\s+/g, " ").trim();
        return { text: text.slice(0, 160), len: text.length, dataRows: document.querySelectorAll("tbody tr").length };
      });
      rec.landed = (new URL(page.url()).pathname.startsWith(BASE_PATH)
        ? new URL(page.url()).pathname.slice(BASE_PATH.length)
        : new URL(page.url()).pathname) || "/";
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
  // openSession() may have replaced it; closing a null browser would mask the real error.
  if (browser) { try { await browser.close(); } catch { /* already gone */ } }
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


// COVERAGE IS PART OF THE RESULT, exactly as in certify.mjs: an unmeasured route produces no
// classification, and a missing classification is indistinguishable from a clean one.
const unmeasured = rows.filter((r) => r.classification === "VISIT_FAILED").length;
if (unmeasured > 0) {
  console.log(`
!! ${unmeasured} of ${routes.length} routes were never measured -- this profile is INCOMPLETE.`);
  process.exitCode = 1;
}