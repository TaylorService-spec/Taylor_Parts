#!/usr/bin/env node
// DYNAMIC DETAIL CERTIFICATION — the record pages the static sweep can never see.
//
// ════════════════════ THE GAP THIS CLOSES ════════════════════
//
// certify.mjs sweeps .certification/routes.json: 54 NAV destinations. A record page has no URL
// until a record exists, so none of them is in that file. The sweep therefore reported ZERO raw-id
// findings across 270 visits while SalesOrderDetail was rendering a Firestore document id as
// visible content — found in seconds by a targeted probe, invisible to the gate.
//
// A clean sweep and a broken page look identical from the outside. That is the failure being fixed:
// not the raw id, which is fixed elsewhere, but the fact that nothing could have caught it.
//
// ════════════════════ RECORDS ARE RESOLVED, NEVER HARDCODED ════════════════════
//
// Each entity says which governed LIST to open and how to reach a row. The representative record is
// whatever that list returns today, so this survives a reseed — a hardcoded Firestore id would rot
// the first time the sandbox is rebuilt, and would do it silently.
//
// A record that cannot be resolved is a FIXTURE_PRECONDITION failure and exits non-zero. It is
// never skipped: "no record to open" is exactly the state that hid the Opportunity defect, and a
// gate that shrugs at it certifies nothing.
//
// Usage:  node certifyDynamic.mjs [accountKey] [widths]
//   CERT_BASE=https://eos-platform-sandbox.web.app node certifyDynamic.mjs admin 1440,375
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROBE } from "./probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..", "..", "..");
const BASE = process.env.CERT_BASE || "http://localhost:5173/Taylor_Parts/field-ops";
const IS_LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const EMU = IS_LOCAL ? "?emulator=1" : "";

const accountKey = process.argv[2] ?? "admin";
const widths = (process.argv[3] ?? "1440,375").split(",").map((w) => parseInt(w, 10)).filter(Boolean);
const { entities } = JSON.parse(readFileSync(join(APP_ROOT, ".certification", "dynamicRoutes.json"), "utf8"));
const { DRIVER_ACCOUNTS } = await import("./seed.mjs");
const { establishSession } = await import("./deployedSession.mjs");

// Handheld surfaces promise a 44px touch target; desktop workspaces degrade intentionally. The same
// rule certify.mjs applies, so the tolerated classes mean the same thing in both sweeps.
const isMobileSurface = (route) => /^\/(service\/(scan|technician-workspace|coordinated-mission)|inventory-role)/.test(route);

const withEmu = (route) => (EMU ? route + (route.includes("?") ? "&" : "?") + EMU.slice(1) : route);

async function settle(page, ms = 900) {
  try {
    await page.waitForFunction(
      () => ((document.querySelector("main") || document.body).innerText || "").trim().length > 20,
      { timeout: 15000 },
    );
  } catch { /* bounded: a genuinely blank surface must still be measured */ }
  await page.waitForTimeout(ms);
}

const findings = [];
const resolved = [];
const preconditionFailures = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: widths[0], height: 900 } });

try {
  await establishSession(page, { BASE, IS_LOCAL, EMU, accountKey, driverAccounts: DRIVER_ACCOUNTS });

  for (const entity of entities) {
    // ── resolve one representative record through the governed list ────────────────────────────
    await page.goto(`${BASE}${withEmu(entity.listRoute)}`, { waitUntil: "domcontentloaded" });
    await settle(page, 1600);

    // WAIT FOR THE ROW, DO NOT SLEEP AND HOPE. These lists load through governed CALLABLES and
    // take several seconds against a deployed origin; a fixed delay reported "no record to open" for
    // three entities that had records, which is a harness bug wearing a fixture failure's clothes --
    // exactly the confidently-wrong number this whole harness keeps producing when it measures time
    // instead of content.
    await page.locator(entity.rowSelector).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    const rows = await page.locator(entity.rowSelector).count();
    if (rows === 0) {
      preconditionFailures.push({ entity: entity.key, reason: `no rows at ${entity.listRoute} — no record to open` });
      continue;
    }

    const before = page.url();
    await page.locator(entity.rowSelector).first().click().catch(() => {});
    await settle(page, 1800);
    const after = page.url();

    if (entity.navigates) {
      const path = after.replace(BASE, "").split("?")[0];
      if (after === before) {
        preconditionFailures.push({ entity: entity.key, reason: `clicking a row did not navigate away from ${entity.listRoute}` });
        continue;
      }
      if (entity.expectRoutePattern && !new RegExp(entity.expectRoutePattern).test(path)) {
        // A row that navigates SOMEWHERE ELSE is a resolution failure, not a pass. Measuring
        // whatever page happened to load would certify the wrong screen and call it coverage.
        preconditionFailures.push({ entity: entity.key, reason: `landed on ${path}, which does not match ${entity.expectRoutePattern}` });
        continue;
      }
    }
    resolved.push({ entity: entity.key, label: entity.label, url: after });

    // ── run the SAME detectors, at every width ────────────────────────────────────────────────
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(after, { waitUntil: "domcontentloaded" });
      await settle(page);
      if (!entity.navigates) {
        // A master-detail pane loses its selection on reload, so re-select before measuring.
        await page.locator(entity.rowSelector).first().click().catch(() => {});
        await settle(page, 1200);
      }
      let probe;
      try {
        probe = await page.evaluate(PROBE, isMobileSurface(entity.listRoute));
      } catch (e) {
        probe = [{ kind: "PROBE_FAILED", detail: String(e.message).slice(0, 80) }];
      }
      for (const f of probe) findings.push({ entity: entity.key, label: entity.label, width, ...f });
    }
  }
} finally {
  await browser.close();
}

// ════════════════════ REPORT ════════════════════
console.log(`\nDYNAMIC DETAIL CERTIFICATION  persona=${accountKey}  widths=${widths.join("/")}`);
for (const r of resolved) console.log(`  RESOLVED  ${r.entity.padEnd(12)} ${r.url.replace(BASE, "") || "(in-place detail)"}`);
for (const f of preconditionFailures) console.log(`  FIXTURE_PRECONDITION  ${f.entity.padEnd(12)} ${f.reason}`);

const byKind = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
console.log(`\nvisits measured: ${resolved.length * widths.length}   entities resolved: ${resolved.length}/${entities.length}`);
if (findings.length === 0) console.log("FINDINGS: none");
else {
  console.log("\nFINDINGS BY KIND:");
  for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${kind}`);
}

// THE TOLERATED CLASSES ARE THE SAME ONES, and they are tolerated for the same reasons certify.mjs
// gives: a control inside a horizontal scroller is reachable, and a desktop workspace never
// promised a 44px target at 375px. Everything else fails this gate.
const TOLERATED = new Set(["OFFSCREEN_IN_SCROLLER", "TINY_TARGET_DESKTOP_SURFACE"]);
const blocking = findings.filter((f) => !TOLERATED.has(f.kind));
for (const f of blocking) console.log(`  ${f.kind}  ${f.entity} @${f.width}  ${f.detail}`);

if (preconditionFailures.length > 0) {
  console.error(`\nFAILED: ${preconditionFailures.length} entity/entities could not be resolved from seeded data.`);
  process.exit(1);
}
if (blocking.length > 0) {
  console.error(`\nFAILED: ${blocking.length} blocking finding(s) on dynamic detail routes.`);
  process.exit(1);
}
console.log("\nDYNAMIC DETAIL CERTIFICATION: PASS");
