#!/usr/bin/env node
// USER DETAIL -> OPERATIONAL ROLES ALIGNMENT PROBE -- measure the grid, do not eyeball it.
//
// The Owner reported the Operational Roles checkboxes reading as individually placed controls
// rather than one selection grid. "Looks staggered" is not a thing you can fix or prove fixed,
// so this reports the geometry that decides it: the distinct x positions of the checkboxes
// (a column count), the distinct label offsets (one aligned control unit, or not), and the row
// pitch (consistent vertical rhythm, or not).
//
// READ-ONLY. It opens the edit form and measures it. It never toggles a role and never submits:
// the form is a governed write path, and a probe that can save is not a probe.
// Production is refused outright.
//
// Usage, from field-ops-app-vite/:
//   node scripts/adminUserEditRolesProbe.mjs --target http://localhost:5199 --label before
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
const LABEL = args.label ?? "roles";
const PERSONA = args.persona ?? "admin";

if (/taylor-parts\.(web\.app|firebaseapp)/.test(TARGET)) {
  console.error("REFUSING: this probe does not run against production.");
  process.exit(1);
}

// Positions are rounded to the nearest pixel before being counted as distinct: sub-pixel layout
// noise is not misalignment, and counting it as such would report a defect that no reader can see.
function measure() {
  const group = document.querySelector(".fo-checkbox-group");
  if (!group) return { present: false };
  const items = [...group.querySelectorAll(".fo-checkbox")];
  const boxes = items.map((el) => {
    const input = el.querySelector("input");
    const text = el.querySelector("span");
    const r = el.getBoundingClientRect();
    return {
      label: text ? text.textContent.trim() : null,
      inputLeft: Math.round(input.getBoundingClientRect().left),
      textLeft: Math.round(text.getBoundingClientRect().left),
      top: Math.round(r.top),
      right: Math.round(r.right),
    };
  });
  const uniq = (xs) => [...new Set(xs)].sort((a, b) => a - b);
  const columns = uniq(boxes.map((b) => b.inputLeft));
  const rowTops = uniq(boxes.map((b) => b.top));
  // The gap between one row of checkboxes and the next. One distinct pitch is a rhythm;
  // several is the staggering the Owner saw.
  const pitches = uniq(rowTops.slice(1).map((t, i) => t - rowTops[i]));
  // Distance from each checkbox to its own label. One value means every pair is the same
  // control unit; more than one means the label floats relative to its box.
  const labelOffsets = uniq(boxes.map((b) => b.textLeft - b.inputLeft));
  const groupRect = group.getBoundingClientRect();
  const note = [...document.querySelectorAll(".fo-muted")]
    .find((p) => /Operational roles are eligibility/.test(p.textContent));
  return {
    present: true,
    viewport: window.innerWidth,
    groupWidth: Math.round(groupRect.width),
    roleCount: boxes.length,
    roles: boxes.map((b) => b.label),
    columnXs: columns,
    columnCount: columns.length,
    rowCount: rowTops.length,
    rowPitches: pitches,
    labelOffsets,
    // A role whose own box runs past the group is the "detached from its checkbox" case.
    overflowingItems: boxes.filter((b) => b.right > Math.round(groupRect.right) + 1).map((b) => b.label),
    noteWidth: note ? Math.round(note.getBoundingClientRect().width) : null,
    noteInGrid: note ? note.parentElement.classList.contains("fo-checkbox-group") : null,
    documentOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
await page.locator(".fo-list-grid-action", { hasText: "Edit" }).first().click();
await page.locator(".fo-checkbox-group").waitFor({ timeout: 40000 });

mkdirSync(OUT_DIR, { recursive: true });
const results = [];
for (const width of WIDTHS) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(measure);
  results.push(m);
  await page.locator(".fo-checkbox-group").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT_DIR, `${LABEL}-roles-${width}.png`) });
  console.log(
    `${String(width).padStart(5)}px  group=${m.groupWidth}  cols=${m.columnCount} at [${m.columnXs}]` +
    `  rowPitches=[${m.rowPitches}]  labelOffsets=[${m.labelOffsets}]  overflow=${m.overflowingItems.length}`,
  );
}
writeFileSync(join(OUT_DIR, `${LABEL}-roles.json`), JSON.stringify({ target: TARGET, results }, null, 2));
console.log(`\nwrote ${join(OUT_DIR, `${LABEL}-roles.json`)}`);
await browser.close();
