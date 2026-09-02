#!/usr/bin/env node
// EOS HOVER CONTRACT — live sweep of interactive states across the routed families.
//
// ════════ WHY A BROWSER SWEEP AND NOT ONLY STATIC ANALYSIS ════════
//
// test/buttonForegroundContrast.test.mjs already refuses the shape of the bug statically: a class
// whose hover re-grounds the background without restating colour. That guard is necessary and it
// is not sufficient, because CSS answers "which rules exist" and only a browser answers "which
// rule won". The Financials defect was a specificity race — `.fo-filter-btn:hover` at 0-2-0
// overriding only the background of `button:hover` at 0-1-1 — and its consequence (white text on a
// near-white fill, 1.06:1) was visible only in computed style.
//
// ════════ WHAT COUNTS AS EVIDENCE ════════
//
// An element inside a collapsed <details> has a layout box and cannot be hovered by anyone. Reading
// "no change" from it and calling the rule dead is exactly the mistake this sweep exists to stop —
// it happened during the audit that produced this file. So every candidate is checked with
// elementFromPoint at the point the pointer will occupy: if something else is on top, the element
// is reported UNREACHABLE and contributes no verdict either way.
//
// Hover is a POINTER affordance. This sweep runs at desktop width only; asserting hover at 375
// would be claiming evidence for an interaction that surface does not have.
//
// Usage: node hoverSweep.mjs [--origin https://…]
import { chromium } from "playwright";
import { seedAuthenticatedSession, signInPersona } from "./deployedSession.mjs";

const originArg = process.argv.indexOf("--origin");
const ORIGIN = originArg !== -1 ? process.argv[originArg + 1] : "https://eos-platform-sandbox.web.app";

// One representative route per family the Owner named. Breadth over depth: the contract is
// site-wide, so a defect anywhere is the finding.
const FAMILIES = [
  // Financials gets several routes on purpose. Overview is the LEAST interactive page in the
  // family — mostly figures and prose — so sweeping only it produced "0 distinct controls" and
  // would have yielded a green report that never touched .fo-filter-btn, the control the
  // reported defect actually lived on.
  ["Financials", "/financials"],
  ["Financials", "/financials/invoices"],
  ["Financials", "/financials/billing-queue"],
  ["Financials", "/financials/accounts-receivable"],
  ["Financials", "/financials/payments"],
  // /inventory IS the Parts Catalog — its nav path is "" (navConfig.js). "/inventory/parts" is not
  // a route at all: it resolves as :partId="parts" and renders an honest not-found, which the sweep
  // was reporting as a one-control PASS for the Parts family. A route that does not exist
  // cannot be evidence about the family it was standing in for.
  ["Inventory / Parts Catalog", "/inventory"],
  ["Parts — Part Master", "/inventory/part-master"],
  ["Receiving", "/inventory/receiving"],
  ["Dispatch", "/service/dispatcher-board"],
  ["Sales", "/customers/opportunities"],
  ["Equipment", "/equipment"],
  ["Admin", "/admin"],
];

const AA = 4.5;

const relLum = (c) => {
  const [r, g, b] = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const parseRgb = (s) => {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(s || "");
  return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
};
const contrast = (fg, bg) => {
  const a = Math.max(relLum(fg), relLum(bg));
  const b = Math.min(relLum(fg), relLum(bg));
  return +((a + 0.05) / (b + 0.05)).toFixed(2);
};

/** Candidate interactive elements, one per distinct class signature so the report stays readable. */
const CANDIDATES = `(() => {
  const seen = new Set(); const out = [];
  const sel = "main a[href], main button, main [role=button], main tbody tr[class*=click], main summary";
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    if (r.width < 12 || r.height < 12) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
    const key = el.tagName.toLowerCase() + (cls ? "." + cls : "");
    if (seen.has(key)) continue;
    seen.add(key);
    el.setAttribute("data-hoversweep", key);
    out.push({ key, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    if (out.length >= 16) break;
  }
  return out;
})()`;

const readState = (key) => `(() => {
  const el = document.querySelector('[data-hoversweep=' + JSON.stringify(${JSON.stringify(key)}) + ']');
  if (!el) return null;
  const cs = getComputedStyle(el);
  // The EFFECTIVE background: walk up until something paints, exactly as the eye does.
  let n = el, bg = "rgb(255, 255, 255)";
  while (n && n !== document.documentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && !/rgba\\(0, 0, 0, 0\\)/.test(c) && !/transparent/.test(c)) { bg = c; break; }
    n = n.parentElement;
  }
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  return {
    color: cs.color, bg, border: cs.borderColor, outline: cs.outlineStyle + " " + cs.outlineWidth,
    shadow: cs.boxShadow, decoration: cs.textDecorationLine,
    reachable: !!top && (top === el || el.contains(top) || top.contains(el)),
  };
})()`;

async function main() {
  const manifest = await fetch(`${ORIGIN}/version.json?cb=${Math.random()}`).then((r) => r.json());
  console.log(`EOS HOVER CONTRACT SWEEP — ${manifest.environmentId} @ ${manifest.commit}\n`);

  const session = await signInPersona("admin");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await seedAuthenticatedSession(page, ORIGIN, session);

  const findings = [];
  const unmeasured = [];
  let reachable = 0, unreachable = 0, lowest = { ratio: Infinity, where: null };

  for (const [family, route] of FAMILIES) {
    await page.goto(ORIGIN + route, { waitUntil: "domcontentloaded" });
    // WAIT FOR CONTENT, NOT FOR A CLOCK. A fixed 4.5s timeout reported "0 distinct controls" on
    // Financials Overview because a governed read had not resolved yet. A page still loading is an
    // UNMEASURED page, and reporting it as clean is the same error class as judging a control
    // inside a collapsed <details>: absence of a verdict is not a passing verdict.
    try {
      await page.waitForFunction(
        () => {
          const m = document.querySelector("main");
          if (!m || m.innerText.trim().length < 40) return false;
          return !/^(Loading|Checking|Reading|Signing)/i.test(m.innerText.trim());
        },
        { timeout: 25000 },
      );
    } catch { unmeasured.push(family + " " + route + ": still loading after 25s"); }
    await page.waitForTimeout(700);
    // Open disclosures so controls that are only reachable when expanded can be judged fairly.
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    await page.waitForTimeout(500);

    const candidates = await page.evaluate(CANDIDATES);
    // Zero controls is NOT a pass — it means the sweep saw nothing it could judge.
    if (candidates.length === 0) unmeasured.push(family + " " + route + ": no interactive control found");
    console.log(`=== ${family} (${route}) — ${candidates.length} distinct controls ===`);
    for (const c of candidates) {
      // Bring it into view FIRST. elementFromPoint is viewport-relative, so a control whose centre
      // sits below the fold reports as covered and loses its verdict — .ns-info__close did exactly
      // that, and scrolling it into view turned "UNREACHABLE" into a clean 18.88:1.
      await page.evaluate((k) => document.querySelector(`[data-hoversweep="${k}"]`)
        ?.scrollIntoView({ block: "center" }), c.key);
      await page.waitForTimeout(120);
      const before = await page.evaluate(readState(c.key));
      if (!before) continue;
      if (!before.reachable) { unreachable += 1; console.log(`   ${c.key.padEnd(44)} UNREACHABLE (covered) — no verdict`); continue; }
      const at = await page.evaluate((k) => { const el = document.querySelector(`[data-hoversweep="${k}"]`);
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, c.key);
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(140);
      const after = await page.evaluate(readState(c.key));
      await page.mouse.move(2, 2);
      await page.waitForTimeout(60);
      if (!after) continue;
      reachable += 1;

      const fg = parseRgb(after.color); const bg = parseRgb(after.bg);
      const ratio = fg && bg ? contrast(fg.rgb, bg.rgb) : null;
      const moved = ["color", "bg", "border", "shadow", "decoration"].filter((k) => before[k] !== after[k]);
      const sig = moved.length ? moved.join("+") : "none";
      let verdict = "ok";
      if (ratio !== null && ratio < AA) { verdict = `FINDING ${ratio}:1`; findings.push(`${family} ${c.key}: hover contrast ${ratio}:1 (${after.color} on ${after.bg})`); }
      if (ratio !== null && ratio < lowest.ratio) lowest = { ratio, where: `${family} ${c.key}` };
      console.log(`   ${c.key.padEnd(44)} hover→${sig.padEnd(22)} ${ratio ?? "-"}:1  ${verdict}`);
    }
    console.log("");
  }

  await browser.close();
  console.log("═══ SUMMARY ═══");
  console.log(`  reachable controls measured : ${reachable}`);
  console.log(`  unreachable (no verdict)    : ${unreachable}`);
  console.log(`  lowest hover contrast       : ${lowest.ratio === Infinity ? "n/a" : `${lowest.ratio}:1  (${lowest.where})`}`);
  console.log(`  console errors              : ${[...new Set(errors)].filter((e) => !/403/.test(e)).length}`);
  console.log(`  routes yielding no verdict   : ${unmeasured.length}`);
  if (unmeasured.length) console.log(["", "UNMEASURED (not a pass):"].concat(unmeasured.map((u) => "  " + u)).join(String.fromCharCode(10)));
  console.log(findings.length ? `\nFINDINGS:\n  ${findings.join("\n  ")}` : "\nFINDINGS: NONE");
  process.exit(findings.length || unmeasured.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
