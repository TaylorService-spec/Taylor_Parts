#!/usr/bin/env node
// ADMINISTRATION -> USERS RESPONSIVE PROBE -- measure, do not infer.
//
// The Owner reported the Users directory clipping its View/Edit actions at constrained
// desktop widths. A CSS reading can produce a plausible story about why; only geometry
// says whether it is true, and only geometry says whether a fix worked. So this opens
// /administration/users as a governed nonprod persona and reports DOM measurements at
// each width: content pane width, table scrollWidth vs clientWidth, the right edge of the
// row actions against the right edge of the pane, and document-level horizontal overflow.
//
// READ-ONLY. It navigates and measures. It never clicks a control that writes.
// Production is refused outright.
//
// ════════════════════ IT SIGNS IN WITH AN EOS PERSONA SESSION, AND ONLY THAT ════════════════════
//
// Everything this probe renders and measures is served by the EOS API: the Users directory reads
// POST /workforce/employees (services/workforceApiClient.js), and the shell resolves identity from the
// EOS API under an EOS session. No Firestore read and no Firebase callable is on its path, so it
// needs no Firebase ID token and no password: it asks the EOS nonprod persona issuer for a
// short-lived session (deployedSession.mjs openEosPersonaSession) and seeds it before the app boots.
// There is no Firebase fallback -- a geometry probe has no reason to test Firebase sign-in, and
// SANDBOX_CREDENTIALS_FILE is not read.
//
// Requires EOS_PERSONA_ISSUER_CREDENTIAL, supplied explicitly (operator shell). Without it the probe
// refuses before opening a browser. The credential and the token are never printed or written.
// The EOS API answers only the browser origins in render.yaml EOS_ALLOWED_ORIGINS, so --target must be
// such an origin (the nonprod frontend), or a local dev server whose EOS API accepts it.
//
// Usage, from field-ops-app-vite/:
//   EOS_PERSONA_ISSUER_CREDENTIAL=... node scripts/adminUsersResponsiveProbe.mjs --target <origin> --label before
//   (--persona <canonical key>, default administrator)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertSignedIn,
  eosPersonaSessionAvailable,
  openEosPersonaSession,
} from "../.claude/skills/run-field-ops-app-vite/deployedSession.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "sweep-output", "admin-users-responsive");
const WIDTHS = [1440, 1024, 900, 768, 375];
export const USERS_ROUTE = "/administration/users";
export const SHELL_SELECTOR = ".fo-rail, nav.fo-nav, .fo-header, .fo-shell";

export function parseProbeArgs(argv) {
  const args = Object.fromEntries(
    argv.join(" ").split("--").filter(Boolean)
      .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? "true"]),
  );
  return {
    target: (args.target ?? "http://localhost:5199").replace(/\/+$/, ""),
    label: args.label ?? "probe",
    persona: args.persona ?? "administrator",
  };
}

export function refusesTarget(target) {
  return /taylor-parts\.(web\.app|firebaseapp)/.test(target);
}

/**
 * Sign the page in as `persona` through the EOS persona session and wait for the authenticated
 * shell. Refuses (throws) before touching the page when the issuer credential is absent.
 * `options` reaches the issuer unchanged (env, fetch, baseUrl) -- tests inject a fake issuer.
 */
export async function establishProbeSession(page, { target, persona, env = process.env, ...options }) {
  if (!eosPersonaSessionAvailable(env)) {
    throw new Error(
      "REFUSING: EOS_PERSONA_ISSUER_CREDENTIAL is not set. This probe signs in only through the EOS " +
      "persona session; it has no password path.",
    );
  }
  const opened = await openEosPersonaSession(page, `${target}/`, persona, { env, timeout: 60000, ...options });
  await page.locator(SHELL_SELECTOR).first().waitFor({ timeout: 40000 });
  await assertSignedIn(page, persona);
  return opened;
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

export async function main(argv = process.argv.slice(2)) {
  const { target: TARGET, label: LABEL, persona: PERSONA } = parseProbeArgs(argv);
  if (refusesTarget(TARGET)) {
    console.error("REFUSING: this probe does not run against production.");
    return 1;
  }
  if (!eosPersonaSessionAvailable()) {
    console.error("REFUSING: EOS_PERSONA_ISSUER_CREDENTIAL is not set (EOS persona session required).");
    return 2;
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const opened = await establishProbeSession(page, { target: TARGET, persona: PERSONA });
    console.log(`signed in (EOS persona session) as ${opened.personaKey}`);

    await page.evaluate((route) => {
      window.history.pushState({}, "", route);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, USERS_ROUTE);
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
        `  stacked=${m.tableIsStacked}  actionsClipped=${m.actionsClippedPx}px  docOverflow=${m.horizontalOverflowPx}px` +
        `  rows=${m.rowCount}`,
      );
    }
    writeFileSync(join(OUT_DIR, `${LABEL}.json`), JSON.stringify({ target: TARGET, persona: PERSONA, auth: "eos-persona-session", results }, null, 2));
    console.log(`\nwrote ${join(OUT_DIR, `${LABEL}.json`)}`);
    return 0;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    // The issuer error carries a code, the persona and an HTTP status -- never a credential or token.
    console.error(String(err?.message ?? err).slice(0, 300));
    process.exitCode = 1;
  });
}
