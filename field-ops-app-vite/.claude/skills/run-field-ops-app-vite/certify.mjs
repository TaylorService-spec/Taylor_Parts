#!/usr/bin/env node
// FULL-SITE STRUCTURAL CERTIFICATION -- walk every route, at every width, and MEASURE it.
//
// ============================ WHY MEASUREMENT, NOT SCREENSHOTS ============================
//
// The report that started this program was "every page has structural issues". Screenshots would
// confirm that and tell us nothing actionable: 54 routes x 3 widths is 162 images nobody will
// compare. What is actionable is a FAILURE CLUSTER -- if the same defect appears on 54 pages it has
// one cause, and finding that cause is worth more than filing 54 tickets.
//
// So this reads geometry out of the live DOM and emits one row per (route, width, defect). The
// output is meant to be grouped, counted and sorted -- the shape of the failure IS the diagnosis.
//
// ============================ WHAT IT LOOKS FOR ============================
//
// Only defects that are unambiguous from geometry. No aesthetic judgements, no "this looks cramped".
// Every check below is something that is simply WRONG, at any taste:
//
//   OVERFLOW_X          the document scrolls sideways
//   ESCAPES_CONTAINER   an element extends past its own parent's right edge
//   OFFSCREEN_CONTROL   an interactive control sits outside the viewport
//   TINY_TARGET         an interactive control under the touch floor, on a touch width
//   DETACHED_LABEL      a label whose control is nowhere near it
//   CLIPPED_TEXT        text cut off by a fixed-height ancestor
//   OVERLAP             two interactive controls occupying the same pixels
//   RAW_ID              a Firestore-shaped id rendered where a business identity belongs
//   ERROR_TEXT          a raw exception or stack leaked into the page
//   EMPTY_PAGE          the route rendered essentially nothing
//
// Usage:
//   node certify.mjs <accountKey> [widths] [routesJson]
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
const WIDTHS = (process.argv[3] ?? "1440,768,375").split(",").map(Number);
const routes = JSON.parse(readFileSync(join(APP_ROOT, ".certification", "routes.json"), "utf8"));

const { DRIVER_ACCOUNTS } = await import("./seed.mjs");
const { establishSession } = await import("./deployedSession.mjs");


// The detector now lives in probe.mjs so certifyDynamic.mjs runs the IDENTICAL one. See its header.
import { PROBE } from "./probe.mjs";


// A DEAD BROWSER IS NOT A PAGE DEFECT, and the per-visit guard below could not tell the difference.
//
// A run died a third of the way through and every remaining visit recorded the identical
// "Target page, context or browser has been closed" -- 133 of them. The guard faithfully turned ONE
// fatal condition into 133 findings and then printed a summary that looked like a completed sweep,
// when half the site had never been measured at all.
//
// That is the same failure this file already warns about twice, in a new costume: NOISE LOOKING
// LIKE SUCCESS. The session is now recoverable, and the run refuses to report itself as complete
// when it is not (see the coverage check at the end).
const acct = DRIVER_ACCOUNTS[accountKey];
let browser = null;
let page = null;

async function openSession() {
  if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Dual-target: the real form against the emulator (which certifies Login.jsx itself), a
  // token-seeded session against a deployed sandbox (whose accounts the emulator never seeds,
  // and where no password is typed into a field). See deployedSession.mjs.
  await establishSession(page, { BASE, IS_LOCAL, EMU, accountKey, driverAccounts: DRIVER_ACCOUNTS });
}

// A browser that has gone away fails in a recognizable way. Anything else is a real finding about
// the page and must NOT trigger a relaunch.
const sessionIsDead = (err) =>
  !browser || browser.isConnected() === false ||
  /has been closed|Target crashed|Session closed|browser has disconnected/i.test(String((err && err.message) || ""));

const MAX_RELAUNCHES = 5;
let relaunches = 0;
let aborted = null;

const findings = [];
let visited = 0, failedNav = 0, attempted = 0;
let routeIndex = 0;

try {
  await openSession();

  // ONE BAD VISIT MUST NOT COST 269 GOOD ONES.
  //
  // Two earlier runs died mid-sweep and wrote NO findings file at all, discarding every measurement
  // taken up to that point. A certification tool that loses its evidence on the first hiccup is
  // worse than useless: it produces nothing, slowly, and tempts you to skip it next time.
  //
  // Every visit is now individually guarded, the failure is RECORDED as a finding rather than
  // thrown away, and results are flushed to disk as they accumulate so a hard crash still leaves
  // partial evidence behind.
  const flush = () => writeFileSync(join(APP_ROOT, ".certification", `findings-${accountKey}.json`), JSON.stringify(findings, null, 1));
  mkdirSync(join(APP_ROOT, ".certification"), { recursive: true });

  for (const r of routes) {
    if (aborted) break;
    // RECYCLE BEFORE IT CRASHES, rather than only recovering after.
    //
    // A full run crashed the browser FOUR times, and each crash cost two visits: the goto that hit
    // it (NAV_FAILED) and the next viewport call (VISIT_FAILED). Those 8 visits were the entire
    // difference between 262/270 and a complete sweep, and the routes they landed on -- receipts,
    // reporting, users, duplicate-rules -- had nothing in common except being far into the run.
    // That is accumulation, not a property of those pages.
    //
    // Recovery already works; this simply stops paying for it. A fresh session every 10 routes
    // Every 5 routes. At 10 the browser still died twice per full run, on DIFFERENT routes each
    // time -- which is the proof that it is accumulation and not a property of any page.
    if (routeIndex > 0 && routeIndex % 5 === 0) {
      try { await openSession(); } catch (e) { aborted = `could not recycle the session: ${String(e && e.message).slice(0, 120)}`; break; }
    }
    routeIndex += 1;
    for (const w of WIDTHS) {
     if (aborted) break;
     attempted += 1;
     try {
      await page.setViewportSize({ width: w, height: w <= 430 ? 812 : 900 });
      // PATH navigation, not hash. The app uses BrowserRouter with a basename; `#/route` leaves you
      // on whatever page you were already on. A first version of this sweep did exactly that and
      // reported 53 of 54 routes clean -- because it never navigated anywhere. Silence looked like
      // success, which is the single most dangerous outcome a certification tool can produce.
      //
      // So navigation is now ASSERTED, not assumed: the URL must actually end up on the route asked
      // for, and a route that does not take is recorded as NAV_FAILED rather than skipped quietly.
      try {
        // `?emulator=1` MUST ride along on every navigation. firebase.js only calls
        // connectAuthEmulator/connectFirestoreEmulator when that param is present, so dropping it on
        // a full page load silently repoints the app at PRODUCTION -- the session dies, the app
        // bounces to login, and the sweep crashes. It is not optional decoration on the first URL.
        await page.goto(`${BASE}${r.route}${EMU}`, { waitUntil: "domcontentloaded" });
        await settle(page);
      } catch { failedNav += 1; findings.push({ route: r.route, label: r.label, width: w, kind: "NAV_FAILED", detail: "goto threw" }); continue; }

      const landed = new URL(page.url()).pathname;
      const want = `${BASE_PATH}${r.route}`;
      const onLogin = await page.locator('input[type="password"]').count() > 0;
      if (onLogin) { findings.push({ route: r.route, label: r.label, width: w, kind: "SESSION_LOST", detail: "bounced to login" }); continue; }
      if (landed !== want) {
        findings.push({ route: r.route, label: r.label, width: w, kind: "NAV_REDIRECTED", detail: `asked ${want}, landed ${landed}` });
      }
      visited += 1;
      let probe = [];
      try { probe = await page.evaluate(PROBE, /^\/(service\/(scan|technician-workspace|coordinated-mission)|inventory-role)/.test(r.route)); } catch (e) { probe = [{ kind: "PROBE_FAILED", detail: String(e.message).slice(0, 80) }]; }
      for (const f of probe) findings.push({ route: r.route, label: r.label, width: w, ...f });
     } catch (err) {
       findings.push({ route: r.route, label: r.label, width: w, kind: "VISIT_FAILED", detail: String(err && err.message).slice(0, 100) });
       // Only a DEAD SESSION is recoverable here. A page-level failure is a real finding and was
       // just recorded as one; relaunching for that would retry a broken route forever.
       if (sessionIsDead(err)) {
         if (relaunches >= MAX_RELAUNCHES) {
           aborted = `browser died ${relaunches + 1} times; gave up after ${attempted} of ${routes.length * WIDTHS.length} visits`;
         } else {
           relaunches += 1;
           try { await openSession(); } catch (e) { aborted = `could not reopen a session: ${String(e && e.message).slice(0, 120)}`; }
         }
       }
     }
     flush();
    }
  }
} finally {
  // openSession() may have replaced or failed to create it; closing a null browser here would
  // mask the real error with a TypeError from the finally block.
  if (browser) { try { await browser.close(); } catch { /* already gone */ } }
}

mkdirSync(join(APP_ROOT, ".certification"), { recursive: true });
writeFileSync(join(APP_ROOT, ".certification", `findings-${accountKey}.json`), JSON.stringify(findings, null, 1));

const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
const routesWithIssues = new Set(findings.map((f) => f.route)).size;

const planned = routes.length * WIDTHS.length;

console.log("");
console.log(`persona=${accountKey}  routes=${routes.length}  widths=${WIDTHS.join("/")}`);
console.log(`visits measured: ${visited}/${planned}   navFailures=${failedNav}   browser relaunches=${relaunches}`);
console.log(`routes with >=1 finding: ${routesWithIssues}/${routes.length}`);

// COVERAGE IS PART OF THE RESULT. A sweep that measured half the site and then prints a tidy
// findings table is making a claim it has not earned: on an unmeasured route, the ABSENCE of a
// finding reads exactly like a clean result. A run died a third of the way through and recorded
// 133 identical "browser has been closed" entries, then reported "routes=54" as if it had swept
// them. Say so loudly, and exit non-zero so no caller can mistake this for a pass.
if (visited < planned || aborted) {
  console.log("");
  console.log(`!! COVERAGE INCOMPLETE -- ${planned - visited} of ${planned} visits were never measured.`);
  if (aborted) console.log(`!! run aborted: ${aborted}`);
  console.log("!! Findings below describe ONLY what was measured. An unmeasured route is not a clean route.");
}
console.log("");
console.log("FINDINGS BY KIND (the cluster IS the diagnosis):");
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);


if (visited < planned || aborted) process.exitCode = 1;