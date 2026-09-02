// SITE-WIDE VISUAL SWEEP — drives every routed family in the real signed-in application at the
// two required widths and MEASURES the things a screenshot cannot tell you.
//
// Written for the EOS visual-system rollout (PR #1724): promoting a presentation system from one
// family to the whole application is exactly the change that breaks layout somewhere you did not
// think to look, and "it looked fine in the pages I opened" is not evidence. This walks the route
// list DERIVED FROM navConfig.js — not a hand-written list that quietly drifts from the product —
// and reports, per route and per width:
//
//   horizontal overflow      the page scrolls sideways at this width
//   clipped text             an element's content is wider than its box and the overflow is hidden
//   small targets            an interactive control under the 44px touch standard (handheld only)
//   sticky overlap           a fixed/sticky element sitting on top of workspace content
//   console errors           anything the page logged while rendering
//
// It reports; it does not assert. The rollout's job is to read the report and fix shared causes.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAV_CONFIG = path.join(HERE, "..", "..", "..", "src", "navigation", "navConfig.js");

export const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "handheld-375", width: 375, height: 812 },
];

/**
 * Every routed destination, read out of navConfig.js.
 *
 * Deliberately source-derived. A literal list here would be a second definition of the product's
 * navigation, and the first time someone added a family the sweep would silently stop covering it
 * while still reporting success.
 *
 * Domain entries sit at shallow indent with `path: "x",` on their own line. Subnav entries come in
 * BOTH of the file's shapes: written inline as `{ key: ..., path: "y" }`, and — where the entry has
 * enough fields to need wrapping, as under `inventory-role` — spread across lines with `path:` on
 * its own at a deeper indent. Handling only the inline shape silently dropped three real routes.
 */
export function routesFromNavConfig(file = NAV_CONFIG) {
  const text = readFileSync(file, "utf8");
  const routes = [];
  let domain = null;
  let lastKey = null;
  const add = (key, sub) => {
    if (domain === null) return;
    const route = sub ? `${domain}/${sub}` : domain;
    if (!routes.some((r) => r.route === route)) routes.push({ key: key ?? route, domain, route });
  };
  for (const line of text.split("\n")) {
    const keyMatch = line.match(/^\s*key:\s*"([^"]+)"/);
    if (keyMatch) lastKey = keyMatch[1];

    const ownLine = line.match(/^(\s*)path:\s*"([^"]*)",\s*$/);
    if (ownLine) {
      const indent = ownLine[1].length;
      if (indent <= 6) domain = ownLine[2];   // a nav domain
      else add(lastKey, ownLine[2]);          // a wrapped subnav entry
      continue;
    }
    const inline = line.match(/\{\s*key:\s*"([^"]+)"[^}]*?path:\s*"([^"]*)"/);
    if (inline) add(inline[1], inline[2]);
  }
  return routes;
}

/** Measurements taken inside the page, after it has settled. */
const PROBE = `(() => {
  const doc = document.scrollingElement || document.documentElement;
  const vw = window.innerWidth;
  const out = {
    scrollWidth: doc.scrollWidth,
    innerWidth: vw,
    overflowBy: Math.max(0, doc.scrollWidth - vw),
    clipped: [],
    smallTargets: [],
    stickyOverlap: [],
    widest: null,
  };
  const label = (el) => {
    const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\\s+/).slice(0, 2).join(".");
    return el.tagName.toLowerCase() + (cls ? "." + cls : "");
  };
  // A visually-hidden element is SUPPOSED to be clipped -- that is how the technique works. Its
  // 1px box with hidden overflow is an accessibility affordance, not a layout defect, and counting
  // it buried the real findings under one line per screen-reader label.
  const srOnly = (el) => {
    const cls = typeof el.className === "string" ? el.className : "";
    if (/visually-hidden|sr-only/.test(cls)) return true;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return true;
    const s = getComputedStyle(el);
    return s.clipPath === "inset(50%)" || (s.clip && s.clip !== "auto");
  };

  let widest = 0;
  for (const el of document.querySelectorAll("main *")) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (srOnly(el)) continue;

    // What is actually pushing the page wide?
    if (rect.right > widest) { widest = rect.right; out.widest = { el: label(el), right: Math.round(rect.right) }; }

    // Content wider than its box, with the overflow hidden = text the user cannot read.
    const hiddenX = style.overflowX === "hidden" || style.overflow === "hidden";
    if (hiddenX && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const text = (el.textContent || "").trim().slice(0, 40);
      if (text) out.clipped.push({ el: label(el), by: el.scrollWidth - el.clientWidth, text });
    }
  }
  // Touch targets, handheld only (the caller filters).
  for (const el of document.querySelectorAll("main button, main a[href], main input, main select, main [role=button]")) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (srOnly(el)) continue;
    // WCAG 2.5.5's own inline exception: a link sitting IN a sentence or a table cell is not a
    // sized target, and its height is the line-height of the text around it. Flagging those
    // produced a page of "target a 141x20" noise per route and hid the two controls that are
    // genuinely short. Block-level and inline-block controls are still measured.
    if (el.tagName === "A" && /^inline$/.test(style.display)) continue;
    if (rect.height < 44 || rect.width < 24) {
      out.smallTargets.push({ el: label(el), w: Math.round(rect.width), h: Math.round(rect.height),
        text: (el.textContent || el.value || "").trim().slice(0, 30) });
    }
  }
  // A fixed/sticky bar sitting over workspace content.
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    if (style.position !== "fixed" && style.position !== "sticky") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const under = document.elementFromPoint(Math.min(vw - 2, rect.left + rect.width / 2), rect.top + rect.height / 2);
    if (under && !el.contains(under) && under.closest("main") && !el.closest("main")) {
      out.stickyOverlap.push({ el: label(el), covers: label(under) });
    }
  }
  return out;
})()`;

export async function visualSweep(browser, page, accountKey, { login, appRoot, screenshotDir, only = null }) {
  const routes = routesFromNavConfig().filter((r) => (only ? r.route.startsWith(only) : true));
  const findings = [];
  let checked = 0;

  // ONE context, signed in ONCE at desktop, then resized for the handheld pass.
  //
  // Not two contexts: `login()` waits for the authenticated shell via a locator whose first match
  // is `.fo-rail`, and below the drawer breakpoint the rail is correctly HIDDEN — so signing in at
  // 375px times out waiting for an element the responsive design is right to hide. That is a
  // limitation of the login helper at handheld width, not a product defect, and resizing after
  // authentication sidesteps it without weakening the helper for its other callers.
  const context = await browser.newContext({
    viewport: { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height },
    deviceScaleFactor: 1,
  });
  const view = await context.newPage();
  const consoleErrors = [];
  view.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  view.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await login(view, accountKey);

  // SWEEP_VIEWPORTS=handheld-375 runs one width — used to diff this rollout's findings against the
  // same sweep on the pre-rollout code, so "pre-existing" is a measurement rather than a claim.
  const wanted = (process.env.SWEEP_VIEWPORTS || "").split(",").filter(Boolean);
  for (const viewport of VIEWPORTS.filter((v) => !wanted.length || wanted.includes(v.name))) {
    await view.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const { key, domain, route } of routes) {
      const url = new URL(route, appRoot);
      url.searchParams.set("emulator", "1");
      const before = consoleErrors.length;
      // NOT `networkidle`. This app holds open Firestore listeners, so the network never goes idle
      // and every single route would burn the full timeout — 158 checks at 20s each is an hour of
      // waiting for nothing. Wait for the document, then settle, then wait for the workspace to
      // actually have content so we are not measuring an empty <main>.
      try {
        await view.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 15000 });
      } catch {
        // A route that will not even reach DOMContentLoaded is itself a finding; probe it anyway.
      }
      await view.waitForFunction(
        () => {
          const main = document.querySelector("main");
          return main && main.textContent.trim().length > 0;
        },
        { timeout: 8000 },
      ).catch(() => {});
      await view.waitForTimeout(500);
      const probe = await view.evaluate(PROBE).catch((e) => ({ error: String(e) }));
      checked += 1;

      const issues = [];
      if (probe.error) issues.push(`probe failed: ${probe.error}`);
      // 1px of subpixel rounding is not a defect; a real sideways scroll is.
      if (probe.overflowBy > 1) {
        issues.push(`horizontal overflow +${probe.overflowBy}px (widest: ${probe.widest?.el} → ${probe.widest?.right}px)`);
      }
      for (const c of (probe.clipped || []).slice(0, 5)) issues.push(`clipped ${c.el} by ${c.by}px: "${c.text}"`);
      if (viewport.width < 768) {
        for (const t of (probe.smallTargets || []).slice(0, 5)) issues.push(`target ${t.el} ${t.w}x${t.h} "${t.text}"`);
      }
      for (const s of (probe.stickyOverlap || []).slice(0, 3)) issues.push(`sticky ${s.el} covers ${s.covers}`);
      const newErrors = consoleErrors.slice(before);
      for (const e of newErrors.slice(0, 3)) issues.push(`console: ${e.slice(0, 160)}`);

      const status = issues.length ? "ISSUE" : "ok";
      console.log(`${status.padEnd(5)} ${viewport.name.padEnd(14)} /${route}`);
      for (const i of issues) console.log(`        ${i}`);
      if (issues.length) findings.push({ viewport: viewport.name, route, key, domain, issues });

      if (screenshotDir && (route === "financials" || route === "customers" || route === "inventory" || route === "service")) {
        await view.screenshot({ path: path.join(screenshotDir, `${viewport.name}-${route.replace(/\//g, "-")}.png`), fullPage: false });
      }
    }
  }
  await context.close();

  console.log(`\n── sweep complete: ${checked} route/width checks, ${findings.length} with findings ──`);
  const byRoute = new Map();
  for (const f of findings) byRoute.set(f.route, (byRoute.get(f.route) || 0) + f.issues.length);
  for (const [route, n] of [...byRoute].sort((a, b) => b[1] - a[1])) console.log(`  /${route}: ${n}`);
  return findings;
}
