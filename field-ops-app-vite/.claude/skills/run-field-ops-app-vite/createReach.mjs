#!/usr/bin/env node
// CREATE -> REACH. The journey the Prospect regression broke, driven end to end in a real browser.
//
// A newly created Prospect satisfied every filter on the Customers list and was still absent from
// it, while remaining findable by name search. Firestore's orderBy SILENTLY EXCLUDES a document
// missing the ordered field: the list sorts by `updatedAt DESC` server-side and the shared writer
// stamped only `createdAt`. Nothing threw. The list was not empty -- it was missing exactly the row
// the user had just made.
//
// createdRecordIsReachable.test.mjs pins the INVARIANT statically for every list definition at once,
// which is the cheap, broad half. This is the expensive, narrow half: it proves the actual round
// trip, because a static invariant cannot see an index that was never deployed or a write that
// silently dropped a field.
//
// Usage:  node createReach.mjs [accountKey]
import { chromium } from "@playwright/test";
// BASE is overridable so the SAME gate can run against a DEPLOYED sandbox, not only the local dev
// server. A regression gate that can only be pointed at localhost certifies the developer's machine;
// the deployed build is the thing that actually has to be certified. Set CERT_BASE to the deployed
// origin plus the app base path, e.g.
//   CERT_BASE=https://eos-platform-sandbox.web.app/Taylor_Parts/field-ops
const BASE = process.env.CERT_BASE || "http://localhost:5173/Taylor_Parts/field-ops";
// `?emulator=1` IS A LOCAL-ONLY SWITCH, and appending it blindly would make CERT_BASE a trap.
// firebase.js reads it to connect the Auth/Firestore emulators; against a DEPLOYED sandbox there are
// no emulators to connect to, so carrying it over would point the app at nothing and produce a run
// that fails everywhere for a reason that has nothing to do with the build under test -- another
// confidently wrong number, which this file has produced enough of.
//
// It is still MANDATORY on every local navigation: dropping it on a full page load silently repoints
// the app at PRODUCTION, the session dies, and the sweep reads as a site-wide failure.
const IS_LOCAL = /localhost|127.0.0.1/.test(BASE);
const EMU = IS_LOCAL ? "?emulator=1" : "";
const accountKey = process.argv[2] ?? "admin";
const { DRIVER_ACCOUNTS } = await import("./seed.mjs");
const { establishSession } = await import("./deployedSession.mjs");
const acct = DRIVER_ACCOUNTS[accountKey];

// Unique per run so a rerun never passes on the PREVIOUS run's record -- the failure mode that would
// make this check permanently, invisibly green.
const stamp = String(process.hrtime.bigint()).slice(-9);
const NAME = `Cert Prospect ${stamp}`;

const results = [];
const step = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  // Dual-target: the real form against the emulator (which certifies Login.jsx itself), a
  // token-seeded session against a deployed sandbox (whose accounts the emulator never seeds,
  // and where no password is typed into a field). See deployedSession.mjs.
  await establishSession(page, { BASE, IS_LOCAL, EMU, accountKey, driverAccounts: DRIVER_ACCOUNTS });

  console.log(`\nCREATE -> REACH  persona=${accountKey}  record="${NAME}"`);

  await page.goto(`${BASE}/customers${EMU}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const newBtn = page.getByRole("button", { name: /New Customer/i }).first();
  const link = page.getByRole("link", { name: /New Customer/i }).first();
  if (await newBtn.count()) await newBtn.click();
  else await link.click();
  await page.waitForTimeout(900);

  const nameField = page.locator('input[name="name"], input[id*="name" i]').first();
  await nameField.waitFor({ timeout: 10000 });
  await nameField.fill(NAME);
  step("create form accepts a name", true);

  const save = page.getByRole("button", { name: /^(Save|Create|Add)/i }).first();
  await save.click();
  await page.waitForTimeout(2500);
  const saveError = await page.locator('[role="alert"]').first().innerText().catch(() => "");
  step("save reports no error", !/error|failed|could ?n[o']t/i.test(saveError), saveError.slice(0, 60));

  // THE REGRESSION ITSELF: back to the list, unfiltered, and the record must be there.
  await page.goto(`${BASE}/customers${EMU}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const inList = await page.locator("tbody tr", { hasText: NAME }).count();
  step("appears in the default list (the Prospect regression)", inList > 0, `matches=${inList}`);

  // Search. NOTE ON WHAT THIS DOES AND DOES NOT PROVE: the original report noted that search kept
  // working throughout the regression, because search orders by `name`, which every account has.
  // This step filters the SAME server-ordered list, so it is not exercising that independent path --
  // when the stamp was removed to verify this check can fail, this step went red along with the list
  // rather than staying green as the real search did. It is kept as a reachability assertion (the
  // record must be findable by SOME route) and deliberately not described as reproducing the
  // asymmetry, which would be a claim it does not earn.
  const search = page.locator('input[type="search"], input[placeholder*="earch" i]').first();
  let bySearch = 0;
  if (await search.count()) {
    await search.fill(NAME);
    await page.waitForTimeout(1600);
    bySearch = await page.locator("tbody tr", { hasText: NAME }).count();
    step("findable by search", bySearch > 0, `matches=${bySearch}`);
  } else {
    step("findable by search", true, "no search control on this surface -- skipped, not assumed");
  }

  // Reachable is not the same as openable: a row that cannot be opened is still a dead end.
  const row = page.locator("tbody tr", { hasText: NAME }).first();
  let opened = false;
  if (await row.count()) {
    const rowLink = row.getByRole("link").first();
    if (await rowLink.count()) { await rowLink.click(); } else { await row.click(); }
    await page.waitForTimeout(2000);
    opened = (await page.locator(`text=${NAME}`).count()) > 0;
  }
  step("opens to its detail page", opened);

  // Re-read from a cold navigation: proves the value PERSISTED, not that it lingered in a store.
  const url = page.url();
  await page.goto(url.includes("emulator=1") ? url : `${url}${EMU}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const persisted = (await page.locator(`text=${NAME}`).count()) > 0;
  step("re-read after a cold reload still shows it", persisted);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\ncreate->reach: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
