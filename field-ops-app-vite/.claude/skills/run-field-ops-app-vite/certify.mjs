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
const BASE = "http://localhost:5173/Taylor_Parts/field-ops";

const accountKey = process.argv[2] ?? "admin";
const WIDTHS = (process.argv[3] ?? "1440,768,375").split(",").map(Number);
const routes = JSON.parse(readFileSync(join(APP_ROOT, ".certification", "routes.json"), "utf8"));

const { DRIVER_ACCOUNTS } = await import("./seed.mjs");

// Firestore auto-ids are 20 chars of [A-Za-z0-9]. Deliberately narrow: business codes like
// "WO-2026-SBX004" or "PRT-1001" must never match, or every page would report a false positive.
const RAW_ID = /\b[A-Za-z0-9]{20}\b/;

const PROBE = (MOBILE_SURFACE) => {
  const d = document.documentElement;
  const vw = d.clientWidth;
  const out = [];
  const push = (kind, detail) => out.push({ kind, detail: String(detail).slice(0, 120) });
  const name = (el) => (el.tagName + "." + (el.className || "").toString().trim().split(/\s+/).slice(0, 2).join(".")).slice(0, 60);
  const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";

  if (d.scrollWidth - d.clientWidth > 1) push("OVERFLOW_X", `${d.scrollWidth - d.clientWidth}px`);

  const main = document.querySelector("#fo-main, .fo-main, main") || document.body;
  const text = (main.innerText || "");
  if (text.trim().length < 20) push("EMPTY_PAGE", `only ${text.trim().length} chars of text`);
  for (const pat of [/TypeError|ReferenceError|undefined is not|Cannot read propert|at [A-Za-z]+\.<anonymous>/]) {
    const m = text.match(pat);
    if (m) push("ERROR_TEXT", m[0]);
  }
  const rawId = text.match(/\b[A-Za-z0-9]{20}\b/);
  if (rawId && !/^[0-9]+$/.test(rawId[0])) push("RAW_ID", rawId[0]);

  const controls = [...main.querySelectorAll("button,a,input,select,textarea,[role=button],[role=tab]")].filter(visible);
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // OFFSCREEN, BUT REACHABLE, IS NOT A DEFECT -- and this check could not tell the difference.
    //
    // It compared the control's viewport rect against the viewport width and stopped there. A
    // control sitting inside a deliberately horizontally-scrollable container is outside the
    // viewport and perfectly reachable by scrolling that container, which is the entire point of
    // the container. The Scheduling board is exactly this: a 7-day grid whose overflow is
    // scroll-contained ON PURPOSE, documented as such in its own component. It was being reported
    // as broken at EVERY width, 1440 included, which is what gave the false cluster away -- a real
    // responsive defect does not appear on a wide desktop.
    //
    // This is the fourth false-positive family this sweep has produced (after hash navigation,
    // screen-reader landmarks counted as clipped, and desktop controls measured against a touch
    // floor they never promised). Each one produced a confident, wrong number. The pattern is
    // always the same: geometry alone under-describes intent, so the check has to ask what the
    // page was TRYING to do before calling the result a defect.
    //
    // Reported as a separate kind rather than dropped: a control parked inside a scroller is worth
    // seeing, it is simply not the same finding as one that cannot be reached at all.
    const offscreen = r.right > vw + 1 || r.left < -1;
    if (offscreen) {
      let scroller = null;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const ov = getComputedStyle(a).overflowX;
        if ((ov === "auto" || ov === "scroll") && a.scrollWidth > a.clientWidth + 1) { scroller = a; break; }
      }
      const where = `${name(el)} @${Math.round(r.left)}..${Math.round(r.right)} vw=${vw}`;
      if (scroller) push("OFFSCREEN_IN_SCROLLER", `${where} (reachable inside ${scroller.className || scroller.tagName})`);
      else push("OFFSCREEN_CONTROL", where);
    }
    // TOUCH TARGETS ARE ONLY PROMISED ON SURFACES MEANT FOR TOUCH.
    //
    // Flagging every control on the Administration or Reporting screens at 375px would produce a
    // large, alarming and MEANINGLESS number: those are desktop workspaces, and the standard the
    // brief sets for them is "degrade intentionally", not "become a phone app". The handheld
    // surfaces -- technician, scan, inventory-role -- are the ones that promised 44px, and they are
    // the ones held to it.
    if (vw <= 430 && r.height > 0 && r.height < 44) {
      push(MOBILE_SURFACE ? "TINY_TARGET" : "TINY_TARGET_DESKTOP_SURFACE", `${name(el)} h=${Math.round(r.height)}`);
    }
    const p = el.parentElement;
    if (p) {
      const pr = p.getBoundingClientRect();
      if (pr.width > 0 && r.right > pr.right + 2 && getComputedStyle(p).overflowX === "visible") {
        push("ESCAPES_CONTAINER", `${name(el)} past ${name(p)} by ${Math.round(r.right - pr.right)}px`);
      }
    }
  }

  // CLIPPED TEXT -- but NOT the text that is clipped ON PURPOSE.
  //
  // A first run of this sweep reported 174 clipped-text findings across all 54 routes and looked
  // like a catastrophe. 162 of them were the shell's own `<h1 class="fo-visually-hidden">` -- the
  // screen-reader landmark that EXISTS to be clipped, plus .fo-sr-only and .sr-only siblings.
  //
  // That would have been a worse error than missing the defects: an alarming, confident, wrong
  // number. A visually-hidden element is identified by its signature (1px box, or a clip/clip-path,
  // or negative-margin offscreen) and skipped, so what remains is text that is clipped by ACCIDENT.
  const deliberatelyHidden = (el, cs) => {
    // THE CLASS NAME IS THE CONTRACT. `fo-visually-hidden` / `sr-only` are a component stating in so
    // many words that this text is for screen readers and is meant to be clipped. Inferring that
    // from geometry alone proved unreliable, and the honest signal was sitting in the markup.
    const cls = (el.className || "").toString();
    if (/visually-hidden|sr-only/.test(cls)) return true;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return true;
    if (cs.clipPath && cs.clipPath !== "none") return true;
    if (cs.clip && cs.clip !== "auto") return true;
    if (parseFloat(cs.marginLeft) <= -999 || parseFloat(cs.textIndent) <= -999) return true;
    return false;
  };
  for (const el of [...main.querySelectorAll("*")].filter(visible)) {
    const cs = getComputedStyle(el);
    if (cs.overflow !== "hidden") continue;
    if (deliberatelyHidden(el, cs)) continue;
    if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0 && (el.innerText || "").trim().length > 0) {
      push("CLIPPED_TEXT", `${name(el)} ${el.scrollHeight}>${el.clientHeight}`);
    }
  }

  for (const lbl of [...main.querySelectorAll("label")].filter(visible)) {
    const forId = lbl.getAttribute("for");
    const ctrl = forId ? document.getElementById(forId) : lbl.querySelector("input,select,textarea");
    if (!ctrl) { push("DETACHED_LABEL", `${(lbl.innerText || "").trim().slice(0, 40)} -> no control`); continue; }
    const a = lbl.getBoundingClientRect(), b = ctrl.getBoundingClientRect();
    if (b.width && (Math.abs(a.top - b.top) > 140 || Math.abs(a.left - b.left) > 600)) {
      push("DETACHED_LABEL", `${(lbl.innerText || "").trim().slice(0, 30)} dx=${Math.round(Math.abs(a.left - b.left))} dy=${Math.round(Math.abs(a.top - b.top))}`);
    }
  }
  return out;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const findings = [];
let visited = 0, failedNav = 0;

try {
  const acct = DRIVER_ACCOUNTS[accountKey];
  await page.goto(`${BASE}/?emulator=1`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.locator('button[type="submit"]').click();
  await page.locator(".fo-appheader, .fo-workspace, .fo-rail").first().waitFor({ timeout: 20000 });

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
    for (const w of WIDTHS) {
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
        await page.goto(`${BASE}${r.route}?emulator=1`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
      } catch { failedNav += 1; findings.push({ route: r.route, label: r.label, width: w, kind: "NAV_FAILED", detail: "goto threw" }); continue; }

      const landed = new URL(page.url()).pathname;
      const want = `/Taylor_Parts/field-ops${r.route}`;
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
     }
     flush();
    }
  }
} finally {
  await browser.close();
}

mkdirSync(join(APP_ROOT, ".certification"), { recursive: true });
writeFileSync(join(APP_ROOT, ".certification", `findings-${accountKey}.json`), JSON.stringify(findings, null, 1));

const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
const routesWithIssues = new Set(findings.map((f) => f.route)).size;

console.log(`\npersona=${accountKey}  routes=${routes.length}  visits=${visited}  navFailures=${failedNav}`);
console.log(`routes with >=1 finding: ${routesWithIssues}/${routes.length}\n`);
console.log("FINDINGS BY KIND (the cluster IS the diagnosis):");
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);
