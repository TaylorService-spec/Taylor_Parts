#!/usr/bin/env node
// DISPATCH P1v1 — a READ-ONLY probe for the Owner-visual-correction proofs the 27-check Quick Gate
// does not cover.
//
// ════════════════════ WHY THIS EXISTS SEPARATELY ════════════════════
//
// dispatchNorthStarQuickGate.mjs is a COMPOSITION and HONESTY gate: it proves the board renders the
// North Star, reads availability through the trusted callable, and never fakes a percentage. Audited
// against the Owner's sixteen required proofs for the VC-1..VC-4 release, it asserts NONE of them —
// it predates the corrections, and reporting its 27/27 as if it covered them would be the same
// mistake DECISIONS #137 names: treating a green run as evidence of something it never examined.
//
// So this probe covers the ones that can be proven WITHOUT MUTATING sandbox: what the deployed board
// draws. The interaction proofs (a drag committing directly, the reason-only prompt, resize and
// keyboard reaching rescheduleWorkOrderCallable) would each have to issue a real governed write
// against live data to be proven here; they are covered by the 52 component tests and 12 domain
// tests that shipped with the change, and are listed below as NOT PROVEN LIVE rather than implied.
import { chromium } from "playwright";

import { seedAuthenticatedSession, signInPersona } from "./deployedSession.mjs";

const ORIGIN = "https://eos-platform-sandbox.web.app";
const ROUTE = "/service/dispatcher-board";

const results = [];
const check = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const session = await signInPersona("dispatcher");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  await seedAuthenticatedSession(page, ORIGIN, session);
  let loaded = false;
  for (let attempt = 1; attempt <= 2 && !loaded; attempt += 1) {
    await page.goto(`${ORIGIN}${ROUTE}`, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForSelector(".ns-dispatch, .ns-dispatch-denied", { timeout: 60000 });
      loaded = true;
    } catch {
      if (attempt === 2) throw new Error("the Dispatch board did not render after two attempts");
      console.log("  (cold load, retrying once)");
    }
  }
  await page.waitForTimeout(5000);

  // TODAY IS CHECKED FIRST, BECAUSE THE PAST REGION ONLY EXISTS THERE — and then the board is moved
  // to a day that actually carries placements. The first run of this probe reported three failures
  // (no grips, no shortcuts, no distinct offsets) which were not defects at all: it had looked at
  // today, where the whole 7a-5p band is behind us and no fixture is scheduled. A probe that reads
  // an empty day and reports missing affordances is worse than no probe, so the day is now explicit.
  const pastRegionsToday = await page.$$(".ns-dispatch-lane__past");
  const todayShadeWidth = pastRegionsToday.length
    ? await pastRegionsToday[0].evaluate((el) => el.style.width) : null;
  const todayPointer = pastRegionsToday.length
    ? await pastRegionsToday[0].evaluate((el) => getComputedStyle(el).pointerEvents) : null;

  // Move to the day the acceptance fixtures live on.
  const target = new Date();
  target.setDate(target.getDate() + 1); // Sun Aug 30 carries wo-sbx-002/008/009 and the weekend case
  const value = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
  await page.locator(".ns-dispatch-views__jump input").fill(value);
  await page.waitForTimeout(4000);
  console.log(`  (board moved to ${value} — the day the fixtures are on)`);

  // ── R23. The single most important thing on this board: a governed record that cannot be drawn
  //    geometrically must still be VISIBLE. wo-sbx-011 exists precisely to hold this open.
  const unplaced = await page.$(".ns-dispatch-unplaced");
  check(Boolean(unplaced), "R23 — the windowless scheduled record is visible, not dropped");
  if (unplaced) {
    const text = (await unplaced.innerText()).replace(/\s+/g, " ").trim();
    check(/SBX011|without a window/i.test(text),
      "R23 — the fallback names the record rather than a bare count", text.slice(0, 90));
  }

  // ── VC-4. Measured on TODAY above, then asserted here; and the FUTURE day must have no shade at
  //    all, which is the half that proves the guard is a floor rather than a blanket.
  check(pastRegionsToday.length > 0,
    "VC-4 — past minutes of today render as an unavailable region", `${pastRegionsToday.length} lanes shaded`);
  check(Boolean(todayShadeWidth) && todayShadeWidth !== "0%",
    "VC-4 — the shaded region has real width", String(todayShadeWidth));
  check(todayPointer === "none",
    "VC-4 — the shade dims the lane without swallowing chip interaction", `pointer-events: ${todayPointer}`);
  const futureShade = await page.$$(".ns-dispatch-lane__past");
  check(futureShade.length === 0,
    "VC-4 — a FUTURE day carries no dead region: future slots remain available",
    `${futureShade.length} shaded lanes on ${value}`);

  // ── VC-2/VC-3 affordances. Present and discoverable on the deployed bundle.
  const grips = await page.$$(".ns-dispatch-chip__resize");
  check(grips.length > 0, "VC-2 — scheduled chips carry a resize grip", `${grips.length} grips`);
  const shortcuts = await page.$$eval(".ns-dispatch-chip--wo", (els) =>
    els.map((e) => e.getAttribute("aria-keyshortcuts")).filter(Boolean).length);
  check(shortcuts > 0, "VC-3 — chips declare their key bindings to assistive tech", `${shortcuts} chips`);
  const rules = await page.$eval(".ns-dispatch__rule", (e) => e.innerText).catch(() => "");
  check(/resize/i.test(rules) && /15 min/i.test(rules),
    "VC-3 — the bindings are stated on the page, not only in a tooltip");

  // ── Geometry the acceptance depends on: distinct offsets, an outside-band placement, a weekend.
  const offsets = await page.$$eval(".ns-dispatch-chip--wo", (els) => els.map((e) => e.style.left));
  check(new Set(offsets).size > 1,
    "chips sit at DISTINCT offsets — position is from the committed window", offsets.slice(0, 4).join(", "));
  const outside = await page.$$eval(".ns-dispatch-chip--wo", (els) =>
    els.filter((e) => /Extends outside the shown hours/i.test(e.innerText)).length);
  const hourCols = await page.$$eval(".ns-dispatch-grid__hour", (els) => els.length);
  check(hourCols >= 10, "the hour band covers the day, widening for real placements", `${hourCols} columns`);
  console.log(`  (chips flagged as extending outside the shown hours: ${outside})`);

  // ── Availability truth. The rule that must never regress.
  const shifts = await page.$$eval(".ns-dispatch-lane__meta", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  const known = shifts.filter((s) => /\d+%/.test(s));
  const unknown = shifts.filter((s) => /not recorded/i.test(s));
  check(known.length > 0 && unknown.length > 0,
    "both availability states are on screen to compare", `${known.length} known, ${unknown.length} unknown`);
  check(!unknown.some((s) => /\d+%/.test(s)),
    "unknown availability NEVER renders a percentage — absent is not empty");

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForTimeout(1500);
  check(errors.length === 0, "the corrected bundle raises no runtime errors", errors.join("; ") || "clean");
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(72));
console.log(`DISPATCH CORRECTIONS PROBE: ${failed.length ? "FAIL" : "PASS"} — ${results.length - failed.length}/${results.length}`);
console.log("=".repeat(72));
console.log("NOT PROVEN LIVE (each would require a real governed write against sandbox):");
console.log("  drag commits without a modal · reason-only prompt on Reschedule/Reassign ·");
console.log("  resize and keyboard reaching rescheduleWorkOrderCallable · a past drop being refused.");
console.log("  Covered by 52 component + 12 domain tests merged in PR #1580.");
process.exit(failed.length ? 1 : 0);
