#!/usr/bin/env node
// ADMINISTRATION PERSONA REVIEW -- per persona: what Administration shows, what it hides, and
// whether that matches the reviewed baseline. Re-run after each admin UX change to see what moved.
//
// For every sandbox persona it signs in through the real login form and then:
//   1. reads the Administration links that persona's rail actually renders (collapsed panels are
//      still in the DOM, just `hidden`, so this is the persona's full nav);
//   2. opens EVERY Administration destination by URL, including the ones not in its nav, and
//      records whether it opens, is denied, or redirects. A page missing from the nav that still
//      opens by URL is a finding, because hiding a page doesn't block access to it;
//   3. records each opened page's heading, section headings and tabs, plus a screenshot, so the next
//      run can list which pages changed.
//
// The expected nav visibility per persona lives in adminPersonaReview.expected.json. A persona set
// to null is UNREVIEWED: the report lists what it sees, but there's nothing to compare against. Once
// the Owner confirms the list, pin it with --accept and later runs will flag any drift.
//
// READ-ONLY, like personaSweep.mjs: it navigates and observes, and never submits or clicks a write.
// Passwords come from the canonical loader and go straight into fill(); nothing logs them.
//
// Usage, from field-ops-app-vite/:
//   node scripts/adminPersonaReview.mjs                       # every persona
//   node scripts/adminPersonaReview.mjs --persona admin
//   node scripts/adminPersonaReview.mjs --target https://verenwardeos.vercel.app
//   node scripts/adminPersonaReview.mjs --accept              # pin observed nav as expected (after Owner review)
//   node scripts/adminPersonaReview.mjs --self-check          # offline check of the comparison logic
//
// Output: sweep-output/admin-review/{report.md, snapshot.json, <persona>/<page>.png}
// Production is refused outright.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SANDBOX_PERSONAS, loadSandboxPersona } from "../../scripts/sandboxCredentials.mjs";
import { NAV_DOMAINS } from "../src/navigation/navConfig.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "sweep-output", "admin-review");
const EXPECTED_FILE = join(HERE, "adminPersonaReview.expected.json");
const SNAPSHOT_FILE = join(OUT_DIR, "snapshot.json");

const ADMIN = NAV_DOMAINS.find((d) => d.key === "administration");
const ADMIN_ITEMS = ADMIN.subnav.map((i) => ({ key: i.key, label: i.label, path: i.path, navHidden: !!i.navHidden }));

// ---------------------------------------------------------------- pure logic (self-checked)

/** Rail hrefs -> Administration item keys. Tolerates a router basename before /administration/. */
export function navKeysFromHrefs(hrefs, items = ADMIN_ITEMS) {
  const byPath = new Map(items.map((i) => [i.path, i.key]));
  const keys = new Set();
  for (const href of hrefs) {
    const m = /\/administration\/?([^?#]*)$/.exec(href);
    if (m && byPath.has(m[1].replace(/\/$/, ""))) keys.add(byPath.get(m[1].replace(/\/$/, "")));
  }
  return [...keys];
}

/** Observed nav vs the reviewed baseline. expected null = unreviewed. */
export function compareVisibility(observed, expected) {
  if (!expected) return { reviewed: false, unexpectedlyShown: [], unexpectedlyMissing: [] };
  const want = new Set(expected.visible);
  const got = new Set(observed);
  return {
    reviewed: true,
    unexpectedlyShown: observed.filter((k) => !want.has(k)),
    unexpectedlyMissing: expected.visible.filter((k) => !got.has(k)),
  };
}

/** Classify a direct-URL visit. */
export function accessOutcome(requestedPath, finalPath, deniedText) {
  if (deniedText) return "denied";
  if (!finalPath.endsWith(requestedPath)) return `redirected -> ${finalPath}`;
  return "opens";
}

/** Page keys whose structure (heading/sections/tabs/outcome) differs from the previous run. */
export function changedPages(prevPages = {}, pages) {
  const sig = (p) => JSON.stringify([p.outcome, p.h1, p.headings, p.tabs]);
  return Object.keys(pages).filter((k) => prevPages[k] && sig(prevPages[k]) !== sig(pages[k]));
}

function selfCheck() {
  const items = [
    { key: "overview", path: "overview" },
    { key: "users", path: "users" },
    { key: "permissionPreview", path: "qa/principal-inspection" },
  ];
  assert.deepEqual(
    navKeysFromHrefs(["/administration/overview", "/app/administration/qa/principal-inspection", "/customers", "/administration/nope"], items),
    ["overview", "permissionPreview"],
  );
  assert.deepEqual(compareVisibility(["a"], null), { reviewed: false, unexpectedlyShown: [], unexpectedlyMissing: [] });
  assert.deepEqual(compareVisibility(["a", "c"], { visible: ["a", "b"] }), { reviewed: true, unexpectedlyShown: ["c"], unexpectedlyMissing: ["b"] });
  assert.equal(accessOutcome("/administration/users", "/administration/users", null), "opens");
  assert.equal(accessOutcome("/administration/users", "/dashboard", null), "redirected -> /dashboard");
  assert.equal(accessOutcome("/administration/users", "/administration/users", "Users isn't available to your role"), "denied");
  const p = { outcome: "opens", h1: "Users", headings: ["A"], tabs: [] };
  assert.deepEqual(changedPages({ users: p, roles: p }, { users: { ...p, tabs: ["New"] }, roles: p, objects: p }), ["users"]);
  console.log("self-check ok");
}

// ---------------------------------------------------------------- browser run

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    }
  }
  return out;
}

async function reviewPersona(browser, personaId, target) {
  const { email } = loadSandboxPersona(personaId);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const shotDir = join(OUT_DIR, personaId);
  mkdirSync(shotDir, { recursive: true });

  try {
    await page.goto(target + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
    const { password } = loadSandboxPersona(personaId);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.locator(".fo-rail, nav.fo-nav, .fo-header, .fo-shell").first().waitFor({ timeout: 25000 });
  } catch (err) {
    await context.close();
    return { personaId, email, error: `login failed: ${String(err).slice(0, 200)}` };
  }

  // The persona's own navigation. Give access resolution a moment to settle before reading it.
  await page.waitForTimeout(2500);
  const hrefs = await page.$$eval(".fo-rail a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const navVisible = navKeysFromHrefs(hrefs);

  const pages = {};
  for (const item of ADMIN_ITEMS) {
    const requested = `/administration/${item.path}`;
    await page.evaluate((p) => {
      window.history.pushState({}, "", p);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, requested);
    await page.waitForTimeout(1800); // let the route mount and its reads resolve or fail

    const s = await page.evaluate(() => {
      const main = document.querySelector("#fo-main, main") ?? document.body;
      const txt = (el) => el.textContent.replace(/\s+/g, " ").trim();
      const denied = [...main.querySelectorAll("*")].find((el) => el.children.length === 0 && /isn't available to your role|not authorized|access denied/i.test(el.textContent));
      const failure = [...main.querySelectorAll("*")].find((el) => el.children.length === 0 && /could not be loaded|could not load|failed to load|something went wrong/i.test(el.textContent));
      return {
        finalPath: window.location.pathname,
        deniedText: denied ? txt(denied).slice(0, 160) : null,
        failureText: failure ? txt(failure).slice(0, 160) : null,
        h1: main.querySelector("h1") ? txt(main.querySelector("h1")) : null,
        headings: [...main.querySelectorAll("h2, h3")].map(txt).filter(Boolean).slice(0, 15),
        tabs: [...main.querySelectorAll('[role="tab"]')].map(txt).filter(Boolean),
      };
    });
    const outcome = accessOutcome(requested, s.finalPath, s.deniedText);
    if (outcome === "opens") {
      await page.screenshot({ path: join(shotDir, `${item.key}.png`), fullPage: true }).catch(() => {});
    }
    pages[item.key] = { outcome, h1: s.h1, headings: s.headings, tabs: s.tabs, failureText: s.failureText };
    process.stdout.write(".");
  }

  await context.close();
  return { personaId, email, navVisible, pages };
}

function renderReport(target, results, expected, prevSnapshot) {
  const label = Object.fromEntries(ADMIN_ITEMS.map((i) => [i.key, i.label]));
  const lines = [`# Administration persona review`, ``, `Target: ${target}  `, `Run: ${new Date().toISOString()}`, ``];
  const summary = [];

  for (const r of results) {
    lines.push(`## ${r.personaId} (${r.email ?? "?"})`, ``);
    if (r.error) {
      lines.push(`**ERROR:** ${r.error}`, ``);
      summary.push(`- ${r.personaId}: ERROR`);
      continue;
    }
    const cmp = compareVisibility(r.navVisible, expected.personas[r.personaId]);
    const shown = ADMIN_ITEMS.filter((i) => r.navVisible.includes(i.key));
    const notShown = ADMIN_ITEMS.filter((i) => !r.navVisible.includes(i.key));

    lines.push(`**Sees in Administration nav (${shown.length}):** ${shown.map((i) => i.label).join(", ") || "nothing (no Administration domain)"}`, ``);
    lines.push(`**Does not see (${notShown.length}):** ${notShown.map((i) => i.label + (i.navHidden ? " (nav-hidden for all)" : "")).join(", ") || "none"}`, ``);

    const issues = [];
    if (!cmp.reviewed) issues.push(`UNREVIEWED: no expected baseline yet. Confirm the lists above, then pin them with --accept.`);
    for (const k of cmp.unexpectedlyShown) issues.push(`UNEXPECTED: shows "${label[k]}", which the baseline hides`);
    for (const k of cmp.unexpectedlyMissing) issues.push(`MISSING: "${label[k]}" is expected but not shown`);
    for (const i of notShown) {
      if (r.pages[i.key]?.outcome === "opens" && !i.navHidden) issues.push(`URL-REACHABLE: "${i.label}" isn't in the nav but opens by direct URL`);
    }
    for (const i of shown) {
      if (r.pages[i.key]?.outcome !== "opens") issues.push(`BROKEN-LINK: "${i.label}" is in the nav but ${r.pages[i.key]?.outcome}`);
    }
    for (const [k, p] of Object.entries(r.pages)) {
      if (p.failureText) issues.push(`FAILURE-STATE: "${label[k]}" shows "${p.failureText}"`);
    }
    const changed = changedPages(prevSnapshot?.[r.personaId]?.pages, r.pages);
    lines.push(issues.length ? issues.map((x) => `- ${x}`).join("\n") : `- Matches baseline. No issues.`, ``);
    if (changed.length) lines.push(`**Changed since last run:** ${changed.map((k) => label[k]).join(", ")}`, ``);

    lines.push(`| Page | In nav | Direct URL | Heading | Sections / tabs |`, `|---|---|---|---|---|`);
    for (const i of ADMIN_ITEMS) {
      const p = r.pages[i.key];
      const parts = [...p.headings.slice(0, 6), ...p.tabs.map((t) => `[${t}]`)].join("; ");
      lines.push(`| ${i.label} | ${r.navVisible.includes(i.key) ? "yes" : "no"} | ${p.outcome} | ${p.h1 ?? ""} | ${p.outcome === "opens" ? parts : ""} |`);
    }
    lines.push(``);
    summary.push(`- ${r.personaId}: sees ${shown.length}/${ADMIN_ITEMS.length}, ${issues.length} issue(s)${changed.length ? `, ${changed.length} page(s) changed` : ""}`);
  }
  lines.splice(5, 0, `## Summary`, ``, ...summary, ``);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["self-check"]) return selfCheck();

  const target = (args.target ?? "https://verenwardeos.vercel.app").replace(/\/+$/, "");
  if (/\/\/taylor-parts\.web\.app/.test(target) || /taylor-parts\.firebaseapp/.test(target)) {
    console.error("REFUSING: this review does not run against production.");
    process.exit(1);
  }

  const { chromium } = await import("playwright");
  const expected = JSON.parse(readFileSync(EXPECTED_FILE, "utf8"));
  const prevSnapshot = existsSync(SNAPSHOT_FILE) ? JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) : null;
  const personaIds = args.persona && args.persona !== "true" ? [args.persona] : Object.keys(SANDBOX_PERSONAS);

  console.log(`admin persona review -> ${target}`);
  console.log(`  ${personaIds.length} persona(s) x ${ADMIN_ITEMS.length} Administration pages\n`);

  const browser = await chromium.launch();
  const results = [];
  for (const id of personaIds) {
    process.stdout.write(`  ${id.padEnd(20)}`);
    try {
      const r = await reviewPersona(browser, id, target);
      results.push(r);
      console.log(r.error ? ` ${r.error}` : ` nav shows ${r.navVisible.length}`);
    } catch (err) {
      console.log(` SKIPPED (${String(err).slice(0, 80)})`);
      results.push({ personaId: id, error: String(err).slice(0, 200) });
    }
  }
  await browser.close();

  mkdirSync(OUT_DIR, { recursive: true });
  const report = renderReport(target, results, expected, prevSnapshot);
  writeFileSync(join(OUT_DIR, "report.md"), report);
  // Merge so a single-persona run doesn't erase the other personas' history.
  const snapshot = { ...(prevSnapshot ?? {}) };
  for (const r of results) if (!r.error) snapshot[r.personaId] = { navVisible: r.navVisible, pages: r.pages };
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));

  if (args.accept) {
    for (const r of results) if (!r.error) expected.personas[r.personaId] = { visible: r.navVisible };
    writeFileSync(EXPECTED_FILE, JSON.stringify(expected, null, 2) + "\n");
    console.log(`\nBaseline pinned for: ${results.filter((r) => !r.error).map((r) => r.personaId).join(", ")}`);
  }
  console.log(`\nReport: sweep-output/admin-review/report.md`);
}

await main();
