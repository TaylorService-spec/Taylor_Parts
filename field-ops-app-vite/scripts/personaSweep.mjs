#!/usr/bin/env node
// PERSONA SWEEP -- log in as each real user and walk every page they can reach.
//
// WHY THIS EXISTS. A sweep that reads source code finds defects a careful reader
// finds. It does not find a page that fails to load, a nav row that does not line
// up, a schedule that clips, or filter chips that overlap. The Owner found all four
// in minutes by looking at the deployed sandbox, after a 24-agent static sweep had
// reported none of them. Reading the code and using the product are different acts.
//
// So this drives the REAL app as a REAL user: it signs in through the actual login
// form with the actual credentials, visits every destination that user's own
// navigation offers, and records what breaks.
//
// READ-ONLY BY CONSTRUCTION. It navigates and observes. It never submits a form,
// never clicks a control that writes, and never seeds or mutates data. A tool that
// can change a deployed environment while "testing" it is a different and far more
// dangerous thing than one that looks at it.
//
// PASSWORDS ARE NEVER LOGGED. Credentials come from the canonical loader
// (scripts/sandboxCredentials.mjs) and go straight into fill(). Nothing here prints
// or returns them, and a failure reports the persona id, never the value.
//
// Usage, from field-ops-app-vite/:
//   node scripts/personaSweep.mjs                      # every persona
//   node scripts/personaSweep.mjs --persona salesManager
//   node scripts/personaSweep.mjs --target https://eos-platform-sandbox.web.app
//
// Production is refused outright.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SANDBOX_PERSONAS, loadSandboxPersona } from "../../scripts/sandboxCredentials.mjs";
import { NAV_DOMAINS } from "../src/navigation/navConfig.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "sweep-output");

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

const args = parseArgs(process.argv.slice(2));
const TARGET = (args.target ?? "https://eos-platform-sandbox.web.app").replace(/\/+$/, "");

if (/\/\/taylor-parts\.web\.app/.test(TARGET) || /taylor-parts\.firebaseapp/.test(TARGET)) {
  console.error("REFUSING: this sweep does not run against production.");
  process.exit(1);
}

// Every destination the app itself declares. Derived from navConfig so a new page
// is swept automatically -- a hand-kept page list would drift the day someone adds
// a screen, and the pages nobody remembers to add are exactly where defects sit.
function allDestinations() {
  const out = [];
  for (const domain of NAV_DOMAINS) {
    if (domain.future) continue;
    for (const item of domain.subnav ?? []) {
      if (item.navHidden) continue;
      const path = item.path ? `/${domain.path}/${item.path}` : `/${domain.path}`;
      out.push({ label: `${domain.label} > ${item.label}`, path });
    }
  }
  return out;
}

async function sweepPersona(browser, personaId, destinations) {
  const { email } = loadSandboxPersona(personaId);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const findings = [];
  let currentPath = "(login)";

  // Console errors and failed requests are attributed to whatever page is open
  // when they fire, so a finding says WHERE it happened rather than just that it did.
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // React DevTools nags and favicon 404s are noise on every page and would
    // drown the real findings.
    if (/DevTools|favicon|Download the React/i.test(text)) return;
    findings.push({ kind: "console-error", path: currentPath, detail: text.slice(0, 300) });
  });
  page.on("requestfailed", (req) => {
    // Firestore keeps a long-lived Listen channel open. Navigating away aborts it, so
    // every route change emits ERR_ABORTED against Listen/channel -- an artifact of THIS
    // tool moving between pages, not a defect in the page it just left. Reporting it put
    // one of these in nearly every persona and buried the real findings under noise a
    // reader has to learn to skip, which is how a report stops being read.
    if (/firestore.googleapis.com.*Listen/channel/.test(req.url()) && req.failure()?.errorText === "net::ERR_ABORTED") {
      return;
    }
    findings.push({
      kind: "request-failed",
      path: currentPath,
      detail: `${req.method()} ${req.url().slice(0, 160)} -- ${req.failure()?.errorText ?? "failed"}`,
    });
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    if (/favicon/i.test(res.url())) return;
    findings.push({
      kind: `http-${res.status()}`,
      path: currentPath,
      detail: `${res.request().method()} ${res.url().slice(0, 160)}`,
    });
  });

  try {
    await page.goto(TARGET + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
    const { password } = loadSandboxPersona(personaId);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();

    // The authenticated shell, not a fixed timeout. Selector covers the rebuilt
    // rail and the older header so this keeps working across the redesign.
    await page.locator(".fo-rail, nav.fo-nav, .fo-header, .fo-shell").first().waitFor({ timeout: 25000 });
  } catch (err) {
    findings.push({ kind: "login-failed", path: "(login)", detail: String(err).slice(0, 300) });
    await context.close();
    return { personaId, email, reachable: 0, findings };
  }

  let reachable = 0;
  for (const dest of destinations) {
    currentPath = dest.path;
    try {
      // CLIENT-SIDE navigation, not page.goto. A full reload per destination re-runs
      // Firebase auth init every time -- 37 of those turned a two-minute sweep into a
      // ten-minute one, and it also tests something no real user does. Pushing the route
      // exercises the app the way a person clicking the rail does.
      await page.evaluate((path) => {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, dest.path);
      await page.waitForTimeout(1500); // let the route mount and its reads resolve or fail

      // A visible failure state is a finding even when nothing threw -- "Could not
      // load" rendered calmly is still a broken page to the person looking at it.
      // count() FIRST, then read. textContent() on a locator that matches nothing waits
      // the full 30s default timeout before rejecting -- so every HEALTHY page paid ~30s
      // and the sweep crawled at roughly a page a minute. count() resolves immediately at
      // zero. The slow path is now only taken when there is actually something to read.
      const failureLocator = page.locator(
        "text=/could not be loaded|could not load|failed to load|something went wrong/i",
      );
      const failureText =
        (await failureLocator.count()) > 0
          ? await failureLocator.first().textContent({ timeout: 2000 }).catch(() => null)
          : null;
      if (failureText) {
        findings.push({ kind: "failure-state", path: dest.path, detail: `${dest.label}: "${failureText.trim().slice(0, 160)}"` });
      }

      // Horizontal overflow: the page body scrolling sideways is a layout defect
      // the design system explicitly forbids, and it is invisible in a screenshot
      // taken at the wrong width.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      );
      if (overflows) {
        findings.push({ kind: "horizontal-overflow", path: dest.path, detail: dest.label });
      }

      reachable += 1;
      // Written as we go: a sweep that only reports at exit is indistinguishable from a
      // sweep that hung, which is exactly how the first run of this script read.
      process.stdout.write(`    ${dest.path}
`);
    } catch (err) {
      findings.push({ kind: "navigation-failed", path: dest.path, detail: `${dest.label}: ${String(err).slice(0, 200)}` });
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: join(OUT_DIR, `${personaId}.png`), fullPage: false }).catch(() => {});
  await context.close();
  return { personaId, email, reachable, findings };
}

const personaIds = args.persona && args.persona !== "true" ? [args.persona] : Object.keys(SANDBOX_PERSONAS);
const destinations = allDestinations();

console.log(`persona sweep -> ${TARGET}`);
console.log(`  ${personaIds.length} persona(s) x ${destinations.length} destinations\n`);

const browser = await chromium.launch();
const results = [];
for (const id of personaIds) {
  process.stdout.write(`  ${id.padEnd(20)}`);
  try {
    const r = await sweepPersona(browser, id, destinations);
    results.push(r);
    console.log(`reached ${r.reachable}/${destinations.length}, ${r.findings.length} finding(s)`);
  } catch (err) {
    // A persona whose credentials are missing must not abort the whole sweep.
    console.log(`SKIPPED (${String(err).slice(0, 80)})`);
    results.push({ personaId: id, reachable: 0, findings: [{ kind: "sweep-error", path: "-", detail: String(err).slice(0, 200) }] });
  }
}
await browser.close();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "personaSweep.json"), JSON.stringify({ target: TARGET, results }, null, 2));

console.log("\n=== findings ===");
let total = 0;
for (const r of results) {
  if (r.findings.length === 0) continue;
  console.log(`\n${r.personaId}:`);
  const seen = new Set();
  for (const f of r.findings) {
    const k = `${f.kind}|${f.path}|${f.detail.slice(0, 80)}`;
    if (seen.has(k)) continue; // the same console error on every page is one finding
    seen.add(k);
    total += 1;
    console.log(`  [${f.kind}] ${f.path} -- ${f.detail}`);
  }
}
console.log(`\n${total} distinct finding(s). Full detail: sweep-output/personaSweep.json`);
