#!/usr/bin/env node
// RECEIVING NORTH STAR P1 — the focused sandbox Quick Gate (Family 9).
//
// ============================ WHAT THIS IS FOR ============================
//
// `_sandboxQuickGate.sh` answers "did this deploy land". This knows what Receiving is supposed to
// be: it drives the DEPLOYED workspace as a real admin and asserts the family's composition and
// truth grammar against the running page — the queue's mutually exclusive states, the stated
// reference absences, the RCV-G1/G5/G6/G7 gaps held honestly, the ND-33 side sheet, and the
// measured handheld contract. Same shape as dispatch/parts/equipment gates: one gate per family.
//
// ============================ IT IS READ-ONLY ============================
//
// It LOOKS. It receives nothing and acquires nothing: the one interaction is opening the Add
// existing unit sheet and closing it with Escape, and the gate MEASURES that no command request
// left the page while it was open. Live data varies, so collection checks are DATA-ADAPTIVE: what
// cannot be exercised is reported as SKIP with the reason, never silently passed (the parts gate's
// vacuous-pass lesson).
//
// Usage:
//   node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/receivingNorthStarQuickGate.mjs [origin] [expectedSha]
//
// Exit codes: 0 = every run check passed. 1 = at least one failed. 2 = precondition error.
import { chromium } from "@playwright/test";
import { seedAuthenticatedSession, signInPersona } from "./deployedSession.mjs";

const ORIGIN = process.argv[2] ?? "https://eos-platform-sandbox.web.app";
const EXPECTED_SHA = process.argv[3] ?? null;
const ROUTE = "/inventory/receiving";

const checks = [];
function record(id, passed, detail) {
  checks.push({ id, passed, skipped: false, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${id}${detail ? ` — ${detail}` : ""}\n`);
  return passed;
}
function skip(id, why) {
  checks.push({ id, passed: true, skipped: true, detail: why });
  process.stdout.write(`SKIP  ${id} — ${why}\n`);
}

async function main() {
  if (!/^https:\/\/eos-platform-sandbox\./.test(ORIGIN)) {
    console.error(`REFUSING: ${ORIGIN} is not the sandbox origin. This gate is sandbox-only.`);
    process.exit(2);
  }

  // ---------------------------------------------------------------- deployed artifact identity
  const version = await (await fetch(`${ORIGIN}/version.json`)).json();
  record("the deployed artifact is a sandbox build", version.environmentId === "platform-sandbox",
    `env='${version.environmentId}' commit='${version.commit}'`);
  if (EXPECTED_SHA) {
    record("the deployed commit is the one under review",
      String(version.commit ?? "").startsWith(EXPECTED_SHA.slice(0, 12)) || EXPECTED_SHA.startsWith(String(version.commit ?? "x").slice(0, 12)),
      `deployed='${version.commit}' expected='${EXPECTED_SHA}'`);
  }

  const session = await signInPersona("admin");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));

  await seedAuthenticatedSession(page, ORIGIN, session);
  // Not networkidle — live listeners never go idle. Retried once for the cold CDN edge.
  let loaded = false;
  for (let attempt = 1; attempt <= 2 && !loaded; attempt += 1) {
    await page.goto(`${ORIGIN}${ROUTE}`, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForSelector(".fo-receiving-workspace", { timeout: 60000 });
      loaded = true;
    } catch {
      if (attempt === 2) throw new Error("the Receiving workspace did not render after two attempts");
      console.log("  (cold load, retrying once)");
    }
  }
  // Let the two queue reads settle out of LOADING.
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading orders awaiting receipt"),
    { timeout: 60000 },
  );
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => document.body.innerText);

  // ---------------------------------------------------------------- identity
  record("ONE page title, and it is 'Receiving'",
    (await page.locator(".fo-page-header__title").count()) === 1
      && (await page.locator(".fo-page-header__title").innerText()).trim() === "Receiving");
  // CORRECTED after the first deployed run (0abc2353): the body-innerText heuristic reported the
  // crumb absent while `.ns-page__context` was rendering it correctly — a gate false negative.
  // The assertion now reads the actual governed crumb element and requires the full directional
  // relationship, so it fails if the crumb is absent, duplicated, or loses either side of it.
  const crumb = page.locator(".ns-page__context");
  record("the North Star crumb is present",
    (await crumb.count()) === 1
      && (await crumb.textContent()).replace(/\s+/g, " ").trim() === "Inventory → Receiving");

  // ---------------------------------------------------------------- the queue's truth grammar
  const rows = await page.locator(".fo-receiving-queue tbody tr").count();
  const sawEmpty = text.includes("Nothing awaiting receipt");
  const sawDenied = /not authorized to read the orders awaiting receipt/i.test(text);
  const sawUnavailable = /not an empty queue — it is an unread one/i.test(text);
  const sawFailed = text.includes("The receipt queue could not be loaded");
  const sawPartial = /Awaiting receipt · \d+ shown · incomplete/.test(text);
  const states = [rows > 0 || sawPartial ? "ROWS/PARTIAL" : null, sawEmpty ? "EMPTY" : null,
    sawDenied ? "DENIED" : null, sawUnavailable ? "UNAVAILABLE" : null, sawFailed ? "FAILED" : null].filter(Boolean);
  record("the queue presents exactly ONE truthful state", states.length === 1,
    `found: ${states.join("+") || "none"} (${rows} rows)`);
  record("a failure is never presented as empty", !(sawEmpty && (sawDenied || sawUnavailable || sawFailed)));

  if (rows > 0) {
    // CORRECTED after the first deployed run: the previous check rejected any "id-shaped" Order
    // text and thereby FAILED a legitimate governed externalPoNumber (`PO-LIVE-1788220473108`) —
    // the gate inventing a defect. The live gate does not reverse-engineer field provenance from
    // string shape. What it CAN prove live is journey-conditional:
    //   Supplier PO rows have NO governed business number (RCV-G5) → the primary reference MUST be
    //   the stated absence. Reorder rows may carry their governed external PO reference, or state
    //   its own absence. WHICH field supplied a visible reference is the source contract's job
    //   (receivingWorkspaceQueue.test.mjs: orderReference ← externalPoNumber only; ids only
    //   inside `open`).
    const rowLocs = page.locator(".fo-receiving-queue tbody tr");
    const violations = [];
    let suppliers = 0;
    let reorders = 0;
    for (let i = 0; i < rows; i += 1) {
      const row = rowLocs.nth(i);
      const journey = (await row.locator("td[data-label='Journey']").innerText()).trim();
      const orderPrimary = (await row.locator("td[data-label='Order']").innerText()).trim().split("\n")[0].trim();
      if (journey === "Supplier PO · multi-scan") {
        suppliers += 1;
        if (orderPrimary !== "No order number recorded") {
          violations.push(`supplier row shows '${orderPrimary}' instead of the stated absence`);
        }
      } else if (journey === "Reorder PO · full quantity") {
        reorders += 1;
        if (orderPrimary.length === 0) violations.push("reorder row has an empty Order reference");
      } else {
        violations.push(`unknown journey words '${journey}'`);
      }
    }
    record("supplier rows state the RCV-G5 absence; reorder rows carry a reference or state theirs",
      violations.length === 0,
      violations.slice(0, 2).join(" · ") || `${suppliers} supplier, ${reorders} reorder rows inspected`);
    record("every row names its journey in the governed words", suppliers + reorders === rows,
      `${rows} rows`);
  } else {
    skip("supplier rows state the RCV-G5 absence; reorder rows carry a reference or state theirs", "no queue rows in this dataset");
    skip("every row names its journey in the governed words", "no queue rows in this dataset");
  }

  // ---------------------------------------------------------------- the held gaps
  record("RCV-G7: no purchase-order scan-entry claim on the workspace",
    !/Scan a purchase order|type its number/i.test(text));
  record("RCV-G1: the receipt-history slot is held honestly",
    text.includes("Recent receipts") && text.includes("Not connected yet") && !/no receipts/i.test(text));
  record("no engineering vocabulary reaches the operator",
    !/firestore|callable|capability id|document id/i.test(text));

  // ---------------------------------------------------------------- ND-33, read-only
  record("the exceptional path sits apart, named for what it does",
    text.includes("A unit the company already owns"));
  const acquireBtn = page.locator("button", { hasText: "Add existing unit" });
  if ((await acquireBtn.count()) === 1) {
    const requestsBefore = requests.length;
    await acquireBtn.click();
    await page.waitForSelector(".fo-modal--sheet", { timeout: 15000 });
    const sheetText = await page.locator(".fo-modal--sheet").innerText();
    record("the side sheet opens with ONE identity", /Add existing unit/.test(sheetText));
    record("the reason set is exactly the governed three",
      (await page.locator(".fo-modal--sheet input[type='radio']").count()) === 3
        && /Opening balance/.test(sheetText) && /Legacy migration/.test(sheetText) && /Existing company asset/.test(sheetText));
    const locationFailure = /could not be read|not authorized|could not be loaded/i.test(sheetText);
    const locationValue = await page.locator("#acquire-location").inputValue().catch(() => "");
    record("the location picker never shows a selection beside a failure message",
      !(locationFailure && locationValue !== ""), locationFailure ? "non-READY state shown" : "READY");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    record("Escape closes the sheet and NO command request left the page",
      (await page.locator(".fo-modal--sheet").count()) === 0
        && !requests.slice(requestsBefore).some((u) => /acquireSerializedAsset|receiveInventoryStock/i.test(u)));
  } else {
    record("the admin persona holds the acquire entry (ABSENT means the capability regressed)", false,
      `${await acquireBtn.count()} 'Add existing unit' buttons`);
  }

  // ---------------------------------------------------------------- deny-all discipline, errors
  record("the page never read the deny-all receiving_orders collection",
    !requests.some((u) => u.includes("receiving_orders")));
  record("no page/runtime errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

  // ---------------------------------------------------------------- handheld, measured live
  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await seedAuthenticatedSession(phone, ORIGIN, session);
  await phone.goto(`${ORIGIN}${ROUTE}`, { waitUntil: "domcontentloaded" });
  await phone.waitForSelector(".fo-receiving-workspace", { timeout: 60000 });
  await phone.waitForTimeout(4000);
  const layout = await phone.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    theadHidden: (() => {
      const th = document.querySelector(".fo-receiving-queue thead");
      return th ? getComputedStyle(th).position === "absolute" : null;
    })(),
  }));
  record("375px: zero horizontal page overflow (measured live)", layout.overflow <= 0, `overflow=${layout.overflow}px`);
  if (layout.theadHidden === null) skip("375px: the queue table stacks (thead visually hidden)", "no queue table in this dataset");
  else record("375px: the queue table stacks (thead visually hidden)", layout.theadHidden === true);

  await browser.close();

  const failed = checks.filter((c) => !c.passed).length;
  const skipped = checks.filter((c) => c.skipped).length;
  const passed = checks.length - failed - skipped;
  console.log(`\nRECEIVING NORTH STAR QUICK GATE: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`against ${ORIGIN} — deployed commit ${version.commit}`);
  console.log("A green run is NOT Owner acceptance and NOT the full regression gate.");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`PRECONDITION: ${err?.message ?? err}`);
  process.exit(2);
});
