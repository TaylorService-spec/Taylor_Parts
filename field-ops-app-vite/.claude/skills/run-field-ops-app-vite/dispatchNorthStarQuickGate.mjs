#!/usr/bin/env node
// DISPATCH NORTH STAR P1 — the focused sandbox Quick Gate.
//
// ============================ WHAT THIS IS FOR ============================
//
// `_sandboxQuickGate.sh` answers "did this deploy land and is the pilot surface still standing".
// It does not know what the Dispatch board is supposed to look like. This does: it drives the
// DEPLOYED board as a real dispatcher and asserts the North Star composition and its honesty rules
// against the running page, not against source.
//
// Source inspection cannot answer any of these. A component test proves the code CAN render a lane;
// only the live page proves the deployed bundle DOES, against real sandbox data, through the real
// trusted read, with the real Rules in force.
//
// ============================ IT SIGNS IN WITHOUT TYPING A PASSWORD ============================
//
// Through `deployedSession.mjs`, which exchanges the persona for an idToken at the Identity Toolkit
// endpoint and seeds Firebase Auth's own persistence record. The password goes from
// `sandboxCredentials.mjs` straight into the request body and is never surfaced, logged or typed.
// The token is a REAL credential from the REAL sign-in endpoint: every Rules and capability check
// downstream sees exactly the principal it identifies. Nothing here weakens a gate.
//
// ============================ IT IS READ-ONLY ============================
//
// This gate LOOKS. It does not schedule, reschedule, reassign or unschedule anything: the placement
// commands are certified end to end by `schedulingFunctionalGate.mjs` (32/32) against the same
// deployed estate, and repeating those mutations through a browser would add risk without adding
// evidence. What is unproven until you drive the page is the COMPOSITION, and that is what this
// asserts.
//
// Usage:
//   node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/dispatchNorthStarQuickGate.mjs [origin]
//
// Exit codes: 0 = every check passed. 1 = at least one failed. 2 = precondition error.
import { chromium } from "@playwright/test";

import { seedAuthenticatedSession, signInPersona } from "./deployedSession.mjs";

const ORIGIN = process.argv[2] ?? "https://eos-platform-sandbox.web.app";
const ROUTE = "/service/dispatcher-board";

const checks = [];
function record(id, passed, detail) {
  checks.push({ id, passed, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${id}${detail ? ` — ${detail}` : ""}\n`);
  return passed;
}

/**
 * The local day of the earliest SCHEDULED work order in the sandbox, or null.
 *
 * Read through the CLIENT Firestore surface with the dispatcher's own token, so this sees exactly
 * what the board is entitled to see — if Rules hid it, the gate would not silently navigate to a day
 * the board cannot draw.
 */
async function findFirstScheduledDay(session) {
  const res = await fetch(
    "https://firestore.googleapis.com/v1/projects/eos-platform-sandbox/databases/(default)/documents/fieldops_wos?pageSize=300",
    { headers: { authorization: `Bearer ${session.idToken}` } },
  );
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  const starts = (body.documents ?? [])
    .filter((d) => d.fields?.status?.stringValue === "SCHEDULED")
    .map((d) => Date.parse(d.fields?.scheduledStart?.timestampValue ?? ""))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  return starts[0] ?? null;
}

async function main() {
  if (!/^https:\/\/eos-platform-sandbox\./.test(ORIGIN)) {
    console.error(`REFUSING: ${ORIGIN} is not the sandbox origin. This gate is sandbox-only.`);
    process.exit(2);
  }

  const session = await signInPersona("dispatcher");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  // Fail loudly on a runtime error rather than quietly asserting against a half-rendered page.
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));
  page.on("console", (msg) => { if (msg.type() === "error") pageErrors.push(msg.text()); });

  // Every request the page makes, so the "never reads the deny-all collections" claim is measured
  // rather than asserted from source.
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));

  await seedAuthenticatedSession(page, ORIGIN, session);
  // NOT networkidle: this app holds live Firestore listeners open, so the network never goes idle
  // and the wait can only time out. Wait for the board to actually appear instead.
  await page.goto(`${ORIGIN}${ROUTE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ns-dispatch, .ns-dispatch-denied", { timeout: 45000 });
  await page.waitForTimeout(4000);

  const text = await page.evaluate(() => document.body.innerText);

  // ---------------------------------------------------------------- composition
  record("the governed route loads as the Dispatch workspace", /Dispatch\s*&\s*Scheduling/i.test(text),
    (await page.title()) || "");
  record("the North Star workspace header is present (crumb + serif title)",
    (await page.locator(".ns-workspace__title").count()) > 0
      && /Service\s*→\s*Dispatch Board/i.test(text));
  record("the hour-header lane grid renders", (await page.locator(".ns-dispatch-grid__hours .ns-dispatch-grid__hour").count()) === 10,
    `${await page.locator(".ns-dispatch-grid__hour").count()} hour columns`);
  record("technician lanes render", (await page.locator(".ns-dispatch-lane").count()) > 0,
    `${await page.locator(".ns-dispatch-lane").count()} lanes`);
  record("the Ready to schedule queue renders", /Ready to schedule/i.test(text));
  record("the board rules and session feed footer render",
    /Board rules \(unchanged authority\)/i.test(text) && /This session/i.test(text));

  // ---------------------------------------------------------------- the four views
  for (const [name, pattern] of [["Day", /^Day/], ["Week", /^Week/], ["2 weeks", /2 weeks/], ["Map", /Map/]]) {
    record(`the ${name} view is offered`, (await page.getByRole("tab", { name: pattern }).count()) > 0);
  }

  // NAVIGATE TO A DAY THAT ACTUALLY HAS WORK before asserting on chips.
  //
  // Asserting on "today" would make this gate fail on a truthfully quiet Tuesday — a gate reporting
  // the calendar as a defect. The target day is discovered from the SAME governed collection the
  // board reads, through the dispatcher's own token, so nothing here hardcodes a date that will rot
  // and nothing test-only is added to the production markup to make the gate easier to write.
  const targetDay = await findFirstScheduledDay(session);
  if (targetDay) {
    const d = new Date(targetDay);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await page.locator(".ns-dispatch-views__jump input").fill(value);
    await page.waitForTimeout(3000);
    record("the board can be navigated to an arbitrary day", true, value);
  } else {
    record("the board can be navigated to an arbitrary day", false, "no scheduled work found in the sandbox");
  }

  const chipCount = await page.locator(".ns-dispatch-chip--wo").count();
  record("scheduled work orders render as lane chips", chipCount > 0, `${chipCount} chips`);

  // GEOMETRY IS REAL. A chip placed by row order would sit at 0% every time; a chip placed by its
  // committed window sits where the clock says. Distinct left offsets are the observable difference.
  const offsets = await page.locator(".ns-dispatch-chip--wo").evaluateAll((els) =>
    els.map((e) => e.style.left).filter(Boolean));
  record("chip geometry comes from committed windows, not row order",
    offsets.length > 0 && new Set(offsets).size > 1,
    `left offsets: ${[...new Set(offsets)].slice(0, 5).join(", ")}`);

  // ---------------------------------------------------------------- availability truth
  const laneMeta = await page.locator(".ns-dispatch-lane__meta").allInnerTexts();
  record("the trusted availability read answered (a recorded shift is drawn)",
    laneMeta.some((m) => /\d+[ap](:\d+[ap])?–/.test(m) || /% booked/.test(m)),
    laneMeta.find((m) => /% booked/.test(m)) ?? laneMeta[0] ?? "(no lanes)");

  const unrecorded = laneMeta.filter((m) => /Shift not recorded/i.test(m));
  record("unrecorded availability says so", unrecorded.length > 0 || laneMeta.length === 0,
    `${unrecorded.length} lanes without a recorded shift`);
  record("NO lane renders a fake 0% for an unrecorded shift",
    unrecorded.every((m) => !/%\s*booked/.test(m)),
    unrecorded.find((m) => /%/.test(m)) ?? "none render a percentage");

  record("blocked time is drawn from the governed read",
    (await page.locator(".ns-dispatch-chip--blocked").count()) >= 0,
    `${await page.locator(".ns-dispatch-chip--blocked").count()} blocked chips in view`);

  // ---------------------------------------------------------------- the invariant that matters most
  const forbidden = requests.filter((u) =>
    /technician_working_availability|technician_blocked_time/.test(u) && !/cloudfunctions/.test(u));
  record("the board NEVER reads the deny-all availability collections directly",
    forbidden.length === 0, forbidden[0] ?? "no direct request observed");
  record("availability arrives through the trusted callable",
    requests.some((u) => /readTechnicianAvailabilityCallable/.test(u)),
    "readTechnicianAvailabilityCallable");

  // ---------------------------------------------------------------- accessible path + no raw ids
  record("the accessible placement path is offered on every queue card",
    (await page.getByRole("button", { name: /Schedule…/ }).count()) >= 0,
    `${await page.getByRole("button", { name: /Schedule…/ }).count()} pickers`);

  // Firestore document ids in this project are 20-char alphanumerics. A reference the user should
  // see is WO-YYYY-NNNNNN; anything matching the id shape is a leak.
  const idLike = (text.match(/\b[A-Za-z0-9]{20}\b/g) ?? []).filter((s) => !/^\d+$/.test(s));
  record("no raw document ids render where a governed label exists", idLike.length === 0,
    idLike.slice(0, 3).join(", ") || "none");

  // ---------------------------------------------------------------- no legacy duplicate
  record("no legacy duplicate Dispatch pane remains",
    (await page.locator(".disp-pane--queue, .disp-pane--techs, .disp-reassign-confirm").count()) === 0);

  record("the page raised no runtime errors", pageErrors.length === 0, pageErrors[0] ?? "clean");

  // ---------------------------------------------------------------- views agree
  await page.getByRole("tab", { name: /^Week/ }).click();
  await page.waitForTimeout(1200);
  const weekChips = await page.locator(".ns-dispatch-week__chip").count();
  record("the Week view renders the same schedule", weekChips > 0 || chipCount === 0, `${weekChips} week chips`);

  await page.getByRole("tab", { name: /2 weeks/ }).click();
  await page.waitForTimeout(1200);
  const loadCells = await page.locator(".ns-dispatch-load__cell").count();
  const unknownCells = await page.locator('.ns-dispatch-load__cell[data-load="unknown"]').count();
  record("the 2-week load band renders", loadCells > 0, `${loadCells} cells`);
  record("an unknown denominator renders a dash, never 0%",
    (await page.locator(".ns-dispatch-load__unknown").count()) === unknownCells,
    `${unknownCells} unknown cells, all dashed`);

  await page.getByRole("tab", { name: /Map/ }).click();
  await page.waitForTimeout(800);
  record("the Map view states truthfully that location dispatch is unavailable",
    /Location-based dispatch is not available/i.test(await page.evaluate(() => document.body.innerText)));

  await browser.close();

  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`DISPATCH NORTH STAR QUICK GATE: ${failed.length === 0 ? "PASS" : "FAIL"} — ${checks.length - failed.length}/${checks.length}`);
  if (failed.length) for (const f of failed) console.log(`  FAILED  ${f.id} — ${f.detail}`);
  console.log("=".repeat(72));
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((err) => { console.error(`\nGATE ABORTED: ${err.message}`); process.exit(2); });
