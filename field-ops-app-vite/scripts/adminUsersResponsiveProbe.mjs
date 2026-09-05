#!/usr/bin/env node
// ADMINISTRATION -> USERS RESPONSIVE PROBE -- measure, do not infer.
//
// The Owner reported the Users directory clipping its View/Edit actions at constrained
// desktop widths. A CSS reading can produce a plausible story about why; only geometry
// says whether it is true, and only geometry says whether a fix worked. So this signs in
// as a real sandbox persona, opens /administration/users, and reports DOM measurements at
// each width: content pane width, table scrollWidth vs clientWidth, the right edge of the
// row actions against the right edge of the pane, and document-level horizontal overflow.
//
// READ-ONLY. It navigates and measures. It never clicks a control that writes.
// Production is refused outright.
//
// Usage, from field-ops-app-vite/:
//   node scripts/adminUsersResponsiveProbe.mjs --target http://localhost:5199 --label before
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSandboxPersona } from "../../scripts/sandboxCredentials.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "sweep-output", "admin-users-responsive");
const WIDTHS = [1440, 1024, 900, 768, 375];

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? "true"]),
);
const TARGET = (args.target ?? "http://localhost:5199").replace(/\/+$/, "");
const LABEL = args.label ?? "probe";
const PERSONA = args.persona ?? "admin";

if (/taylor-parts\.(web\.app|firebaseapp)/.test(TARGET)) {
  console.error("REFUSING: this probe does not run against production.");
  process.exit(1);
}

// The measurement itself, run in the page. Everything it reports is read off the live
// layout: no constant here encodes what the layout is "supposed" to be.
function measure() {
  const q = (s) => document.querySelector(s);
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const pane = q("main") ?? q(".fo-workspace") ?? document.body;
  const nav = q(".fo-rail") ?? q("nav.fo-nav") ?? q("nav");
  const table = q(".fo-list-grid table") ?? q(".fo-table");
  const scroller = q(".fo-list-grid .fo-table-scroll") ?? q(".fo-table-scroll");
  const paneRect = rect(pane);
  // Every row-action control on the page; the WORST right edge is the one that matters,
  // because one clipped button is a clipped directory.
  const actions = [...document.querySelectorAll(".fo-list-grid-action")];
  const actionRights = actions.map((a) => a.getBoundingClientRect().right);
  const stacked = table ? getComputedStyle(table).display === "block" : null;
  return {
    viewport: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    horizontalOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navWidth: nav ? Math.round(rect(nav).width) : null,
    navRight: nav ? Math.round(rect(nav).right) : null,
    paneLeft: paneRect ? Math.round(paneRect.left) : null,
    paneWidth: paneRect ? Math.round(paneRect.width) : null,
    paneRight: paneRect ? Math.round(paneRect.right) : null,
    tableScrollWidth: table ? Math.round(table.scrollWidth) : null,
    tableClientWidth: table ? Math.round(table.clientWidth) : null,
    scrollerScrollWidth: scroller ? Math.round(scroller.scrollWidth) : null,
    scrollerClientWidth: scroller ? Math.round(scroller.clientWidth) : null,
    tableIsStacked: stacked,
    rowCount: document.querySelectorAll(".fo-list-grid tbody tr").length,
    actionCount: actions.length,
    actionMaxRight: actionRights.length ? Math.round(Math.max(...actionRights)) : null,
    // Clipped = an action's right edge lies beyond the visible content pane.
    actionsClippedPx: actionRights.length && paneRect
      ? Math.round(Math.max(...actionRights) - paneRect.right)
      : null,
    columnHeaders: [...document.querySelectorAll(".fo-list-grid thead th")].map((th) => th.textContent.trim()),
    // At stacked widths the headers are visually hidden, so the labels the reader
    // actually sees come from data-label on the first row's cells.
    firstRowLabels: [...document.querySelectorAll(".fo-list-grid tbody tr:first-child td")]
      .map((td) => td.getAttribute("data-label")).filter(Boolean),
  };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const { email, password } = loadSandboxPersona(PERSONA);

await page.goto(TARGET + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.locator('input[type="email"]').fill(email);
await page.locator('input[type="password"]').fill(password);
await page.locator('button[type="submit"]').click();
await page.locator(".fo-rail, nav.fo-nav, .fo-header, .fo-shell").first().waitFor({ timeout: 40000 });

await page.evaluate(() => {
  window.history.pushState({}, "", "/administration/users");
  window.dispatchEvent(new PopStateEvent("popstate"));
});
await page.locator(".fo-list-grid tbody tr").first().waitFor({ timeout: 40000 });

mkdirSync(OUT_DIR, { recursive: true });
const results = [];
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(600); // let the resize settle before reading geometry
  const m = await page.evaluate(measure);
  results.push(m);
  await page.screenshot({ path: join(OUT_DIR, `${LABEL}-${width}.png`), fullPage: false });
  console.log(
    `${String(width).padStart(5)}px  pane=${m.paneWidth}  table ${m.tableScrollWidth}/${m.tableClientWidth}` +
    `  stacked=${m.tableIsStacked}  actionsClipped=${m.actionsClippedPx}px  docOverflow=${m.horizontalOverflowPx}px`,
  );
}
writeFileSync(join(OUT_DIR, `${LABEL}.json`), JSON.stringify({ target: TARGET, persona: PERSONA, results }, null, 2));
console.log(`\nwrote ${join(OUT_DIR, `${LABEL}.json`)}`);
await browser.close();
