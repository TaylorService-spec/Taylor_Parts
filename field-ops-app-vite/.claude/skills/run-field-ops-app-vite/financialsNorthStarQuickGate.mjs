#!/usr/bin/env node
// FINANCIALS NORTH STAR P1 — the focused sandbox Quick Gate.
//
// Same shape as dispatchNorthStarQuickGate.mjs / partsNorthStarQuickGate.mjs: drive the
// DEPLOYED sandbox as the seeded admin persona and assert the family's rulings against
// the running pages. The claims are about what the pages may SAY:
//
//   - all 20 routes render inside the shell at 1440 AND recompose at 375 without
//     horizontal overflow;
//   - NO dollar amount appears anywhere. No Financials page issues a read that returns
//     money today, so any $-figure would be a Design specimen leak or a fabricated fact —
//     both gate failures. (This is deliberately NOT phrased as "capabilities are
//     inactive": in platform-sandbox finance.read is activated by an Owner-authorized
//     environment override and the governed AR read answers. Owner visual review
//     2026-09-01 found pages asserting the opposite; the gate must not repeat the claim.)
//   - dormant/unconfigured authority renders its truthful words (Method TBD, UNKNOWN,
//     UNELIMINATED_SUM, FUTURE AUTHORITY, Built dormant · Policy not configured,
//     internal IN_SYNC/DRIFT split from external FUTURE INTEGRATION);
//   - every visible mutating action is disabled, with its capability/policy one-liner;
//   - the page never reads the deny-all financial collections directly (measured from
//     the network log, not asserted from source);
//   - no uncaught JS / React error across the sweep.
//
// Run: node .claude/skills/run-field-ops-app-vite/financialsNorthStarQuickGate.mjs
// Sandbox-only; uses the canonical persona loader (never echoes credentials).
import { chromium } from "@playwright/test";
import { seedAuthenticatedSession, signInPersona } from "./deployedSession.mjs";

const ORIGIN = process.env.GATE_ORIGIN ?? "https://eos-platform-sandbox.web.app";

const checks = [];
function record(id, passed, detail) {
  checks.push({ id, passed, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${id}${detail ? ` — ${detail}` : ""}\n`);
  return passed;
}

// Route → { h1, contains: [visible truthful copy], absent: [forbidden copy],
//           disabledActions: [accessible names that MUST be disabled] }
const ROUTES = [
  ["/financials", {
    h1: "Financials",
    contains: ["Booked", "Billable now", "Billed", "Collected", "A/R outstanding", "Unbilled",
      "Method TBD — FIN-005", "No accounting authority"],
    // F7: the approved handoff omits the cost/margin band at 375 (it lives on Cost to
    // Budget and Profitability). So the band is REQUIRED on desktop and FORBIDDEN on
    // mobile — a viewport-blind assertion would have to be wrong at one of the two.
    desktopOnlyContains: ["Gross margin cannot be reported yet"],
    mobileAbsent: ["Gross margin cannot be reported yet"],
  }],
  ["/financials/billing-queue", {
    h1: "Billing Queue",
    contains: ["never inferred from Work Order COMPLETE", "No governed read surface", "wired to this queue"],
    disabledActions: ["Create invoices"],
  }],
  ["/financials/invoices", {
    h1: "Invoices",
    contains: ["No governed read surface"],
    absentActions: ["New Invoice"],
  }],
  ["/financials/accounts-receivable", {
    h1: "Accounts Receivable",
    contains: ["Total A/R", "Current", "1–30 days", "31–60 days", "61+ days"],
  }],
  ["/financials/payments", {
    h1: "Payments",
    contains: ["FUTURE AUTHORITY", "refuses over-application", "No governed read surface"],
  }],
  ["/financials/credits-adjustments", {
    h1: "Credits & Adjustments",
    contains: ["Corrections create new governed events. The original event remains history."],
    disabledActions: ["New correction"],
  }],
  ["/financials/customer-financials", {
    h1: "Customer Financials",
    contains: ["Nothing is fetched until a customer is chosen"],
  }],
  ["/financials/sales-to-goal", {
    h1: "Sales to Goal",
    contains: ["never summed or compared silently", "deliberately no single total"],
  }],
  ["/financials/cost-to-budget", {
    h1: "Cost to Budget",
    contains: ["Cost actuals are not yet governed", "FIN-BLOCK-003"],
  }],
  ["/financials/forecasting", {
    h1: "Forecasting",
    contains: ["Method TBD — FIN-005", "no governed forecast version exists"],
  }],
  ["/financials/profitability", {
    h1: "Gross Margin & Profitability",
    contains: ["Margin cannot be reported yet", "UNKNOWN", "no fabricated number"],
  }],
  ["/financials/budgets", {
    h1: "Budget Management",
    contains: ["never rewritten"],
    disabledActions: ["New budget"],
  }],
  ["/financials/goals", {
    h1: "Goal Management",
    contains: ["explicit measurement basis"],
    disabledActions: ["New goal"],
  }],
  ["/financials/company-performance", {
    h1: "Company & Business Unit Performance",
    contains: ["UNELIMINATED_SUM", "Taylor", "Ventana"],
  }],
  ["/financials/employee-performance", {
    h1: "Salesperson & Employee Performance",
    contains: ["resolved by the server when this page issues its read", "Outside your scope", "withheld by the server"],
  }],
  ["/financials/reconciliation", {
    h1: "Reconciliation & Exceptions",
    contains: ["Operational integrity — internal reconciliation", "IN_SYNC", "DRIFT",
      "External accounting reconciliation", "no counts, not zero counts"],
  }],
  ["/financials/intercompany", {
    h1: "Intercompany",
    contains: ["never eliminated", "FIN-BLOCK-004"],
  }],
  ["/financials/audit", {
    h1: "Financial Audit & History",
    contains: ["Never a second audit ledger"],
  }],
  ["/financials/reports", {
    h1: "Reporting & Exports",
    contains: ["never a new truth source", "never a partial render"],
  }],
  ["/financials/governance", {
    h1: "Financial Settings & Governance",
    contains: ["Built dormant", "Policy not configured", "Operational subledger", "USD"],
    absent: ["Authority not implemented"],
  }],
];

// Deny-all financial collections — a client request naming one is an authority bypass.
const FORBIDDEN_COLLECTION_RE =
  /firestore\.googleapis\.com.*(?:%2F|\/)(?:invoices|payments|payment_applications|invoice_adjustments|refunds)(?:%2F|\/|\?|$)/i;

async function overflowsHorizontally(page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
}

async function sweep(page, viewportLabel) {
  for (const [route, spec] of ROUTES) {
    const id = `${viewportLabel} ${route}`;
    // THREE attempts, not two. The first navigation after a Hosting deploy pulls a cold
    // bundle through a cold CDN edge, and a lazy route chunk can lose that race twice —
    // observed on /financials at both widths immediately after two separate deploys,
    // passing on every later run against the same build. A gate that reports a cold cache
    // as a missing page is a gate that gets re-run by hand and eventually ignored.
    let loaded = false;
    for (let attempt = 1; attempt <= 3 && !loaded; attempt += 1) {
      await page.goto(`${ORIGIN}${route}`, { waitUntil: "domcontentloaded" });
      try {
        await page.getByRole("heading", { level: 1, name: spec.h1 }).waitFor({ timeout: 20000 });
        loaded = true;
      } catch {
        if (attempt < 3) await page.waitForTimeout(1500);
      }
    }
    if (!record(`${id} renders`, loaded, loaded ? "" : `h1 "${spec.h1}" not found`)) continue;

    // The h1 can win the race against the rest of the lazy chunk's paint (seen live at
    // 375 on a cold edge): wait until the body actually carries page content before
    // reading it, or the gate reports true copy as missing.
    await page
      .waitForFunction(() => document.body.innerText.length > 1200, { timeout: 15000 })
      .catch(() => {});
    // innerText reflects CSS text-transform (figure labels render UPPERCASE), so every
    // copy assertion compares case-insensitively — the words, not the styling.
    const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();

    // SPECIMEN / FABRICATION LEAK: with every finance capability inactive, no $-figure may
    // exist on any Financials page.
    record(`${id} no-$`, !/\$\d/.test(text), /\$\d/.test(text) ? "dollar figure present" : "");

    const isMobile = viewportLabel === "375";
    const required = [...(spec.contains ?? []), ...(isMobile ? [] : spec.desktopOnlyContains ?? [])];
    const forbidden = [...(spec.absent ?? []), ...(isMobile ? spec.mobileAbsent ?? [] : [])];
    for (const phrase of required) {
      const hit = text.includes(phrase.toLowerCase());
      record(`${id} says`, hit, hit ? phrase.slice(0, 40) : `MISSING: ${phrase}`);
    }
    for (const phrase of forbidden) {
      record(`${id} never says`, !text.includes(phrase.toLowerCase()), phrase);
    }
    for (const name of spec.disabledActions ?? []) {
      const btn = page.getByRole("button", { name });
      const present = (await btn.count()) > 0;
      const disabled = present ? await btn.first().isDisabled() : false;
      record(`${id} action "${name}" disabled`, present && disabled,
        present ? (disabled ? "" : "ENABLED — governed command is inactive") : "control missing");
    }
    for (const name of spec.absentActions ?? []) {
      const count = await page.getByRole("button", { name }).count()
        + await page.getByRole("link", { name }).count();
      record(`${id} no "${name}" control`, count === 0, count ? `${count} found` : "");
    }

    const overflow = await overflowsHorizontally(page);
    record(`${id} no horizontal overflow`, !overflow, overflow ? "document scrolls sideways" : "");
  }
}

async function main() {
  if (!/^https:\/\/eos-platform-sandbox\./.test(ORIGIN)) {
    console.error(`REFUSING: ${ORIGIN} is not the sandbox origin. This gate is sandbox-only.`);
    process.exit(2);
  }

  const manifest = await fetch(`${ORIGIN}/version.json`).then((r) => r.json());
  process.stdout.write(`Deployed identity: ${manifest.environmentId} @ ${manifest.commit}\n`);

  const session = await signInPersona("admin");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));
  page.on("console", (msg) => { if (msg.type() === "error") pageErrors.push(msg.text()); });
  const forbiddenReads = [];
  page.on("request", (r) => { if (FORBIDDEN_COLLECTION_RE.test(r.url())) forbiddenReads.push(r.url()); });

  await seedAuthenticatedSession(page, ORIGIN, session);

  await sweep(page, "1440");

  // ── Page 07 live composition: the governed bounded customer search, then the composed
  // AR read whose capability is inactive — the truthful outcome is denied/unavailable
  // words, never numbers.
  await page.goto(`${ORIGIN}/financials/customer-financials`, { waitUntil: "domcontentloaded" });
  await page.getByRole("searchbox", { name: "Customer" }).fill("C");
  await page.waitForTimeout(1500);
  const searchText = await page.evaluate(() => document.body.innerText);
  const resultButtons = await page.locator(".fin-search-result").count();
  const searchTruthful =
    resultButtons > 0 ||
    /No customer names start with|could not be completed|don't have access/.test(searchText);
  record("07 governed customer search answers truthfully", searchTruthful,
    resultButtons ? `${resultButtons} results` : "honest zero/denial sentence");
  if (resultButtons > 0) {
    await page.locator(".fin-search-result").first().click();
    await page.waitForTimeout(2500);
    const t = await page.evaluate(() => document.body.innerText);
    record("07 composed AR renders truthfully (no numbers, honest state)",
      !/\$\d/.test(t)
        && /(Not available to you|couldn.t be read|No invoices on this account|No read on this surface|Loading receivables)/.test(t),
      /\$\d/.test(t) ? "dollar figure appeared" : "");
  }

  // ── 375 recomposition sweep.
  await page.setViewportSize({ width: 375, height: 812 });
  await sweep(page, "375");

  // ── F7: at 375 the exception rail must OUTRANK the plan table. Measured by painted
  // position, not DOM order — the recomposition is done with CSS order, so reading the DOM
  // would report the desktop sequence and pass while the page shows the wrong one.
  await page.goto(`${ORIGIN}/financials`, { waitUntil: "domcontentloaded" });
  // The visible workspace title, not getByRole — the app shell also renders a
  // visually-hidden <h1> with the domain name, and a role query matches both.
  await page.locator("h1.ns-workspace__title").first().waitFor({ timeout: 20000 });
  const order = await page.evaluate(() => {
    const top = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getBoundingClientRect().top + window.scrollY : null;
    };
    return {
      exceptions: top('[aria-label="Exceptions"]'),
      plan: top('[aria-label="Performance against plan"]'),
    };
  });
  record(
    "375 exceptions outrank the plan table (handoff §8)",
    order.exceptions != null && order.plan != null && order.exceptions < order.plan,
    order.exceptions == null || order.plan == null
      ? "a section was not found"
      : `exceptions@${Math.round(order.exceptions)} < plan@${Math.round(order.plan)}`,
  );

  // ── Spot-check the 44px touch-target rule on the mobile gated actions.
  await page.goto(`${ORIGIN}/financials/billing-queue`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "Billing Queue" }).waitFor({ timeout: 20000 });
  const box = await page.getByRole("button", { name: "Create invoices" }).boundingBox();
  record("375 touch target ≥44px (Create invoices)", Boolean(box && box.height >= 44),
    box ? `${Math.round(box.height)}px` : "not measurable");

  // ── Sweep-wide claims.
  record("no client read of deny-all financial collections", forbiddenReads.length === 0,
    forbiddenReads.slice(0, 3).join(" | "));
  record("no uncaught JS / console errors across sweep", pageErrors.length === 0,
    pageErrors.slice(0, 3).join(" | "));

  await browser.close();

  const failed = checks.filter((c) => !c.passed);
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  if (failed.length) {
    process.stdout.write("FAILED:\n" + failed.map((f) => `  ${f.id} — ${f.detail}`).join("\n") + "\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("GATE ERROR:", err?.message ?? err);
  process.exit(2);
});
