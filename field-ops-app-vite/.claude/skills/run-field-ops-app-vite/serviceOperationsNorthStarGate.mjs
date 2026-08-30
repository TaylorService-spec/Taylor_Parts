#!/usr/bin/env node
// SERVICE OPERATIONS NORTH STAR P1 — the focused sandbox gate.
//
// ============================ WHAT THIS IS FOR ============================
//
// `_sandboxQuickGate.sh` answers "did this deploy land and is the pilot surface still standing". It
// does not know what Service Operations is supposed to be. This does: it drives the DEPLOYED page as
// an admin and asserts the accepted composition and its honesty rules against the running page.
//
// Same shape and reasoning as `dispatchNorthStarQuickGate.mjs` — one gate per accepted family.
//
// ============================ WHY IT EXISTS AT ALL ============================
//
// The one-off version of this gate found a defect on the accepted candidate that NOTHING else could
// see, and the reason is worth keeping:
//
//   `.ns-visually-hidden` is `position: absolute` with no offsets, so inside a table wide enough to
//   scroll it sits hundreds of pixels right of the viewport. With no positioned ancestor its
//   containing block was the INITIAL one, so it escaped `.ns-table-wrap`'s `overflow-x: auto`:
//
//       documentElement.clientWidth   375
//       documentElement.scrollWidth   497   <- the page scrolled sideways 122px
//       body.scrollWidth              375   <- correct
//
//   jsdom has no layout, so no component test could see it. The certification sweep measures the
//   BODY and reported the route clean — correctly, by its own measure. Only documentElement, on a
//   real browser, at a real width, caught it. Fixed in #1594 by making the scroller a containing
//   block; check 13 below is the regression that would have caught it, and now cannot miss it.
//
// So: this file measures `documentElement.scrollWidth`, deliberately, and says why.
//
// ============================ IT SIGNS IN WITHOUT TYPING A PASSWORD ============================
//
// Through `deployedSession.mjs`, which exchanges the persona for an idToken at the Identity Toolkit
// endpoint. The password goes from `sandboxCredentials.mjs` straight into the request body and is
// never surfaced, logged or typed. NO SECRET IS EMBEDDED HERE and none is required at author time.
//
// ============================ IT IS READ-ONLY, AND SO IS THE PAGE ============================
//
// Service Operations holds no governed transition at all (SO-D2), so there is nothing here to
// mutate even by accident. This gate only looks.
//
// Usage:
//   node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/serviceOperationsNorthStarGate.mjs [origin]
//
// Exit codes: 0 = every check passed. 1 = at least one failed. 2 = precondition error.
import { chromium } from "@playwright/test";

import { seedAuthenticatedSession, signInPersona } from "./deployedSession.mjs";

const ORIGIN = process.argv[2] ?? "https://eos-platform-sandbox.web.app";
const ROUTE = "/service-operations";
// The Work Orders LIST is the Service domain index -- its subnav entry declares path: "". Shipping
// `/service/work-orders` here matched no route and fell through to the dashboard (#1592), which is
// why checks 2-5 exist and why check 5 FOLLOWS the link instead of reading its href.
const WORK_ORDERS_ROUTE = "/service";

const checks = [];
function record(id, passed, detail) {
  checks.push({ id, passed, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${id}${detail ? ` — ${detail}` : ""}\n`);
  return passed;
}

// SETTLE BEFORE MEASURING. `networkidle` never fires -- this page holds live Firestore listeners
// open by design -- and reading before the first snapshot arrives produces phantom failures. The
// first run of the one-off gate reported two, and they were the gate's fault, not the page's.
async function openServiceOperations(page) {
  await page.goto(`${ORIGIN}${ROUTE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ns-page", { timeout: 30000 });
  await page.waitForSelector(".ns-table", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

async function main() {
  if (!/^https:\/\/eos-platform-sandbox\./.test(ORIGIN)) {
    console.error(`REFUSING: ${ORIGIN} is not the sandbox origin. This gate is sandbox-only.`);
    process.exit(2);
  }

  const deployed = await fetch(`${ORIGIN}/version.json`).then((r) => r.json()).catch(() => null);
  if (!deployed || deployed.environmentRole === "production") {
    console.error(`REFUSING: ${ORIGIN} reports environmentRole=${deployed?.environmentRole ?? "(unknown)"}.`);
    process.exit(2);
  }
  console.log(`Service Operations gate — ${ORIGIN}${ROUTE}`);
  console.log(`  deployed ${deployed.commit}  env ${deployed.environmentId}/${deployed.environmentRole}\n`);

  const session = await signInPersona("admin");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));
  page.on("console", (msg) => { if (msg.type() === "error") pageErrors.push(msg.text()); });

  await seedAuthenticatedSession(page, ORIGIN, session);

  // ── 1 + 13: loads at both widths, and the DOCUMENT does not scroll sideways ──────────────────
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await openServiceOperations(page);

    const heading = (await page.locator("h1").first().innerText()).trim();
    record(`1  loads at ${width}`, heading === "Service Operations", `h1="${heading}"`);

    // documentElement, NOT body. See the header: #1594's escape left body.scrollWidth correct while
    // the document scrolled 122px. A body-only assertion reports a clean page and means nothing.
    const m = await page.evaluate(() => ({
      clientW: document.documentElement.clientWidth,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
    }));
    record(
      `13 no horizontal overflow at ${width}`,
      m.docScrollW <= m.clientW + 1,
      `clientW=${m.clientW} docScrollW=${m.docScrollW} bodyScrollW=${m.bodyScrollW}`,
    );
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openServiceOperations(page);

  // ── 2-5: the navigation targets ──────────────────────────────────────────────────────────────
  const headerHref =
    (await page.locator('header a:has-text("Work orders")').first().getAttribute("href")) ?? "(none)";
  record("2  header Work orders -> /service", headerHref === WORK_ORDERS_ROUTE, `href=${headerHref}`);

  const metricHrefs = await page.locator(".ns-metric__value a").evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")));
  const metricLabels = (await page.locator(".ns-metric__label").allInnerTexts()).map((t) => t.trim());
  const metricFor = (label) => metricHrefs[metricLabels.findIndex((l) => l.toLowerCase() === label)];

  record("3  In progress metric -> /service", metricFor("in progress") === WORK_ORDERS_ROUTE, `href=${metricFor("in progress")}`);
  record("4  Completed metric -> /service", metricFor("completed") === WORK_ORDERS_ROUTE, `href=${metricFor("completed")}`);

  // FOLLOWED, not read. Reading an href is exactly how the dashboard fall-through shipped: the value
  // was a plausible-looking route that resolved to nothing.
  await page.locator('header a:has-text("Work orders")').first().click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  const landed = page.url();
  record("5  Work orders does not fall through to My Dashboard", !/\/dashboard/.test(landed), `landed=${landed}`);

  await openServiceOperations(page);

  // ── 6-10: the activity rail ──────────────────────────────────────────────────────────────────
  const rail = page.locator(".ns-rail");
  const entries = await rail.locator(".ns-rail__entry").evaluateAll((els) =>
    els.slice(0, 12).map((e) => ({
      ref: e.querySelector(".ns-rail__entry-ref")?.textContent?.trim() ?? null,
      text: e.querySelector(".ns-rail__entry-text")?.textContent?.trim() ?? null,
      meta: e.querySelector(".ns-rail__entry-meta")?.textContent?.trim() ?? null,
    })));

  // "Job assigned" with no subject is a sentence with no object; a column of them says nothing.
  const referenced = entries.filter((e) => e.ref);
  record("6  activity rows identify their Work Order number", referenced.length > 0,
    `${referenced.length}/${entries.length} referenced; first="${referenced[0]?.ref ?? ""}"`);
  record("7  activity rows keep their description", entries.length > 0 && entries.every((e) => e.text));
  record("7  activity rows carry account context where available", entries.some((e) => e.meta),
    `e.g. "${entries.find((e) => e.meta)?.meta ?? ""}"`);

  const railText = await rail.innerText();
  // SO-N3: every milestone shares one createdAt, so a per-entry clock time would claim a precision
  // the schema does not hold.
  record("8  SO-N3 no fabricated per-event timestamp", !/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(railText));
  // SO-N5: the event model carries no actor identity at all.
  record("9  SO-N5 no fabricated actor",
    !(/\bby\s+[A-Z]/.test(railText) || /Actor|System user/i.test(railText)));
  record("10 snapshot-derived provenance present", /not an audit log/i.test(railText));

  // ── 14: the accepted composition ─────────────────────────────────────────────────────────────
  const bodyText = await page.locator(".ns-page").innerText();
  const sections = await page.locator("section[aria-label]").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label")));

  record("14 exactly four metrics", metricLabels.length === 4, metricLabels.join(" | "));
  record("14 At risk section", sections.includes("At risk"));
  record("14 Technician load section", sections.includes("Technician load"));
  record("14 Activity rail", (await rail.count()) === 1);
  // SO-D2 -- the retired composition rendered one full WorkOrderDetail card per work order.
  record("14 no Work Order wall", (await page.locator(".work-order-card").count()) === 0);
  // SO-D3 -- the planned-demand rollup left this page.
  record("14 no PartsOverviewPanel", !/Parts Overview/i.test(bodyText));
  record("14 dispatch recommendation is read-only",
    /Suggestions are read-only here/i.test(bodyText) || !/Recommended dispatch/i.test(bodyText));

  if (sections.includes("Needs attention")) {
    const attention = await page.locator('section[aria-label="Needs attention"]').innerText();
    const governed = ["Ready to Schedule", "Past Due", "Scheduling Conflict", "Parts Blocked"];
    // SO-N2: the governed sections are the only sections.
    record("14 governed attention sections only", !/\bUrgent\b/i.test(attention),
      `found: ${governed.filter((g) => attention.includes(g)).join(", ") || "(none)"}`);
    // SO-N1: attention and risk keep separate vocabularies.
    record("14 no risk-severity words on attention", !/\bCRITICAL\b|\bStalled\b/.test(attention));
  } else {
    // The grammar's attention block is ABSENT when clean -- not an empty box, not an all-clear banner.
    record("14 attention absent on a clean day (shell removed entirely)", true);
  }

  // ── 11 + 12 ──────────────────────────────────────────────────────────────────────────────────
  const rawIds = await page.evaluate(() => {
    const shaped = /^[A-Za-z0-9]{20}$/;
    const found = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      const text = node.textContent.trim();
      if (shaped.test(text)) found.push(text);
    }
    return found;
  });
  record("11 no raw document ids rendered as content", rawIds.length === 0, rawIds.join(", "));
  record("12 no runtime or console errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await browser.close();

  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  ${f.id}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  console.log(
    "\nThis gate certifies the Service Operations COMPOSITION on the deployed build.\n" +
      "It is not the acceptance gate, and it does not speak to SO-G5, SO-G6 or SO-G7,\n" +
      "which remain open and separately scoped.",
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
