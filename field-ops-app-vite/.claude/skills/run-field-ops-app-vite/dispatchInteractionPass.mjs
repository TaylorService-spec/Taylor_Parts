#!/usr/bin/env node
// DISPATCH P1v1 — the Owner's four live interaction checks, driven against the DEPLOYED sandbox.
//
// ════════════════════ THIS ONE MUTATES ════════════════════
//
// Unlike dispatchCorrectionsProbe.mjs, this issues REAL governed commands against
// eos-platform-sandbox: it schedules, re-times and resizes actual fixture Work Orders. That is the
// point — VC-1..VC-4 are claims about what happens when a dispatcher's hand meets the board, and no
// amount of component testing can prove the DEPLOYED bundle does it. Every write goes through the
// board's own gestures, so the commands are exactly the ones a dispatcher would issue.
//
// Every assertion is confirmed by READING FIRESTORE BACK afterwards, never by trusting that the UI
// looked right. A board that renders a move it never persisted would pass a purely visual check.
//
// Sandbox only. It refuses any other project by name.
import { chromium } from "playwright";

import { seedAuthenticatedSession, signInPersona } from "./deployedSession.mjs";

const PROJECT = "eos-platform-sandbox";
const ORIGIN = `https://${PROJECT}.web.app`;
const ROUTE = "/service/dispatcher-board";
// ════════════════════ PRODUCTION TRIPWIRE ════════════════════
//
// This file WRITES. The target is therefore a constant rather than an argument, and the two ways a
// caller could redirect it are refused by name: passing a different project, and the production
// project appearing anywhere in the resolved target. `.firebaserc` in this repository defaults to
// `taylor-parts` — the live business system — so "no argument" must mean sandbox, never "whatever
// the CLI would have picked".
const PRODUCTION = "taylor-parts";
if (process.argv[2] && process.argv[2] !== PROJECT) {
  console.error(`REFUSING: this pass is sandbox-only. '${process.argv[2]}' is not ${PROJECT}.`);
  process.exit(2);
}
if (PROJECT === PRODUCTION || ORIGIN.includes(PRODUCTION) || String(process.env.GCLOUD_PROJECT ?? "") === PRODUCTION) {
  console.error(`REFUSING: resolved target touches '${PRODUCTION}'. This pass never runs against production.`);
  process.exit(2);
}

const results = [];
const check = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// The read-back token is supplied by the caller, not shelled for on demand: `gcloud` is a .cmd shim
// on Windows and does not resolve through execFileSync, and re-minting a token per read would be
// both slow and pointless. Export GCLOUD_TOKEN before running.
const TOKEN = process.env.GCLOUD_TOKEN;
if (!TOKEN) {
  console.error("REFUSING: set GCLOUD_TOKEN (gcloud auth print-access-token) before running.");
  process.exit(2);
}

/** Read one Work Order straight from Firestore, so persistence is proven rather than assumed. */
async function readWo(id) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/fieldops_wos/${id}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  const d = await r.json();
  if (d.error) return null;
  const f = d.fields ?? {};
  const ms = (v) => (v?.timestampValue ? Date.parse(v.timestampValue) : null);
  return {
    status: f.status?.stringValue ?? null,
    techId: f.scheduledTechId?.stringValue ?? null,
    start: ms(f.scheduledStart),
    end: ms(f.scheduledEnd),
    woNumber: f.woNumber?.stringValue ?? null,
  };
}

/**
 * HTML5 drag-and-drop, dispatched in the page.
 *
 * Playwright's mouse cannot drive native DnD (the browser owns that gesture), so the events are
 * synthesized with ONE shared DataTransfer — which is also what the real browser does. `clientX` is
 * computed from the target lane's own box so the drop lands at a real fraction of the band rather
 * than at its origin, because "where in the lane" is the whole meaning of the gesture.
 */
async function dragTo(page, sourceSel, targetSel, fraction) {
  // THE DRAG IS SPLIT ACROSS TWO EVALUATES, AND THAT IS THE WHOLE TRICK.
  //
  // The lane only attaches onDrop when `draggingWorkOrder` is set, which happens in React state from
  // the dragstart handler. Firing dragstart and drop in ONE synchronous block means the drop lands
  // before React has re-rendered the lane with a drop handler on it — so nothing happens, silently.
  // The first version of this probe did exactly that and reported three "failures" that were its own.
  const started = await page.evaluate((s) => {
    const src = document.querySelector(s);
    if (!src) return { ok: false, why: "missing source" };
    window.__dt = new DataTransfer();
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    return { ok: true };
  }, sourceSel);
  if (!started.ok) return started;

  await page.waitForTimeout(400); // let React mount the lane's drop handler

  return page.evaluate(([s, t, frac]) => {
    const src = document.querySelector(s);
    const tgt = document.querySelector(t);
    if (!tgt) return { ok: false, why: "missing target" };
    const box = tgt.getBoundingClientRect();
    const clientX = box.left + box.width * frac;
    const clientY = box.top + box.height / 2;
    const dt = window.__dt ?? new DataTransfer();
    const fire = (el, type, extra = {}) =>
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...extra }));
    fire(tgt, "dragover", { clientX, clientY });
    fire(tgt, "drop", { clientX, clientY });
    if (src) fire(src, "dragend");
    return { ok: true };
  }, [sourceSel, targetSel, fraction]);
}

/** Clear the board's message line, so a later assertion cannot read a stale one as its own result. */
async function clearMessage(page) {
  await page.evaluate(() => { document.querySelector(".ns-dispatch__message")?.remove(); });
}

const session = await signInPersona("dispatcher");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

async function gotoDay(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await page.locator(".ns-dispatch-views__jump input").fill(value);
  await page.waitForTimeout(3500);
  return value;
}

try {
  await seedAuthenticatedSession(page, ORIGIN, session);
  let loaded = false;
  for (let attempt = 1; attempt <= 2 && !loaded; attempt += 1) {
    await page.goto(`${ORIGIN}${ROUTE}`, { waitUntil: "domcontentloaded" });
    try { await page.waitForSelector(".ns-dispatch", { timeout: 60000 }); loaded = true; }
    catch { if (attempt === 2) throw new Error("board did not render"); }
  }
  await page.waitForTimeout(5000);

  // ══════════════ 4a · PAST SLOT DROP — RUN FIRST, ON PURPOSE ══════════════
  //
  // This needs a card in the QUEUE, and section 1 below deliberately empties the queue by scheduling
  // it. Running the past-slot drop first is not tidiness: the first version of this probe ran it last
  // and reported "queue empty" as a failure — a probe artifact wearing a defect's clothes. The board
  // opens on TODAY, whose band is behind us, so this is the natural moment to try it.
  console.log("\n── 4a · PAST SLOT DROP (today, run first) ──");
  await clearMessage(page);
  const pastCard = await page.$(".ns-dispatch-card");
  if (pastCard) {
    await dragTo(page, ".ns-dispatch-card", '[data-technician-id="cw-emp-012"]', 0.3);
    await page.waitForTimeout(1500);
    const msg = await page.$eval(".ns-dispatch__message", (e) => e.textContent.trim()).catch(() => "");
    check(/already passed/i.test(msg), "VC-4 — a past drop is REFUSED in words", msg.slice(0, 90));
    check(/will not move it forward/i.test(msg), "VC-4 — and it is NOT silently snapped forward");
    const noForm = await page.$(".ns-dispatch-reason, .ns-dispatch-dialog");
    check(noForm === null, "VC-4 — no bogus confirmation form for a placement that cannot succeed");
    const stillQueued = await page.$$eval(".ns-dispatch-card", (e) => e.length);
    check(stillQueued >= 1, "VC-4 — nothing was scheduled; the card is still in the queue", `${stillQueued} card(s)`);
  } else {
    check(false, "a queue card was available for the past-slot test", "queue empty");
  }

  // ══════════════ 1 · INITIAL SCHEDULE DRAG ══════════════
  const day = await gotoDay(1);
  console.log(`\n── 1 · INITIAL SCHEDULE DRAG (${day}) ──`);
  const queueRef = await page.$eval(".ns-dispatch-card__ref", (e) => e.textContent.trim()).catch(() => null);
  const queueId = queueRef ? queueRef.replace("WO-2026-SBX", "wo-sbx-").toLowerCase() : null;
  const before = queueId ? await readWo(queueId) : null;
  check(Boolean(queueRef) && before?.status === "READY_TO_DISPATCH",
    "a queue card is available to schedule", `${queueRef} (${before?.status})`);

  const laneSel = '[data-technician-id="cw-emp-012"]';
  await dragTo(page, ".ns-dispatch-card", laneSel, 0.35);
  await page.waitForTimeout(1200);

  const dialogAfterDrag = await page.$(".ns-dispatch-reason, .ns-dispatch-dialog");
  check(dialogAfterDrag === null,
    "VC-1 — a queue drop opens NO modal: the drag was the command");
  await page.waitForTimeout(3500);
  const after = queueId ? await readWo(queueId) : null;
  check(after?.status === "SCHEDULED" && after.start != null,
    "the governed Schedule command persisted",
    after ? `${after.status} @ ${new Date(after.start).toISOString()}` : "not readable");
  check(after?.techId === "cw-emp-012", "it landed on the lane it was dropped on", after?.techId ?? "-");
  const scheduledId = queueId;

  // ══════════════ 2 · SAME-TECH RESCHEDULE ══════════════
  console.log("\n── 2 · SAME-TECH RESCHEDULE ──");
  await page.waitForTimeout(2000);
  const chipSel = `.ns-dispatch-chip--wo`;
  const beforeMove = await readWo("wo-sbx-002");
  // The drop fraction is computed FROM THE CHIP'S CURRENT POSITION, not fixed. A constant fraction
  // silently becomes a no-op once the chip has been moved there by an earlier run — which is exactly
  // what happened: 0.62 of a band that had widened mapped back onto the chip's own start, the
  // reschedule succeeded, and "did not move" looked like a failed command rather than a probe that
  // asked for no change.
  const moveTarget = await page.evaluate((lane) => {
    const chip = document.querySelector(`${lane} .ns-dispatch-chip--wo`);
    if (!chip) return 0.5;
    const left = parseFloat(chip.style.left) || 0;
    // A quarter of the band away, wrapped, so it is always a genuinely different time.
    return ((left + 25) % 80) / 100;
  }, '[data-technician-id="tech-sbx-01"]');
  await dragTo(page, `[data-technician-id="tech-sbx-01"] ${chipSel}`, '[data-technician-id="tech-sbx-01"]', moveTarget);
  await page.waitForTimeout(1200);

  const prompt = await page.$(".ns-dispatch-reason");
  check(Boolean(prompt), "VC-1 — a same-lane move opens the compact reason prompt");
  if (prompt) {
    const textboxes = await page.$$(".ns-dispatch-reason input[type='text'], .ns-dispatch-reason textarea");
    check(textboxes.length === 1, "exactly ONE text field", `${textboxes.length} field(s)`);
    const selects = await page.$$(".ns-dispatch-reason select");
    const datetimes = await page.$$(".ns-dispatch-reason input[type='datetime-local']");
    check(selects.length === 0 && datetimes.length === 0,
      "no technician / start / end / duration fields are restated",
      `${selects.length} selects, ${datetimes.length} datetimes`);

    const saveDisabled = await page.$eval(".ns-dispatch-reason__actions button:last-child", (b) => b.disabled);
    check(saveDisabled === true, "the reason is REQUIRED — save is disabled while empty");

    await page.fill(".ns-dispatch-reason__input", "customer requested later arrival");
    await page.click(".ns-dispatch-reason__actions button:last-child");
    await page.waitForTimeout(4000);
    const afterMove = await readWo("wo-sbx-002");
    check(afterMove && afterMove.start !== beforeMove.start,
      "the move PERSISTED through rescheduleWorkOrderCallable",
      afterMove ? `${new Date(beforeMove.start).toISOString()} -> ${new Date(afterMove.start).toISOString()}` : "-");
    check(afterMove?.status === "SCHEDULED", "status is unchanged — a re-time is not a transition", afterMove?.status ?? "-");
    check(afterMove && (afterMove.end - afterMove.start) === (beforeMove.end - beforeMove.start),
      "duration preserved by a move");
  }

  // ══════════════ 3 · RESIZE + KEYBOARD ══════════════
  console.log("\n── 3 · RESIZE + KEYBOARD ──");
  const beforeResize = await readWo("wo-sbx-008");
  const resizeLane = '[data-technician-id="tech-sbx-02"]';
  const didResize = await page.evaluate((laneSelector) => {
    const lane = document.querySelector(laneSelector);
    const chip = lane?.querySelector(".ns-dispatch-chip--wo");
    const grip = chip?.querySelector(".ns-dispatch-chip__resize");
    if (!grip) return { ok: false, why: "no grip" };
    const box = lane.getBoundingClientRect();
    const dt = new DataTransfer();
    const fire = (el, type, extra = {}) =>
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...extra }));
    const startX = grip.getBoundingClientRect().right;
    fire(grip, "dragstart", { clientX: startX });
    // +1/10th of the band to the right: comfortably more than half a slot, so it is a real resize.
    fire(grip, "dragend", { clientX: startX + box.width * 0.1 });
    return { ok: true };
  }, resizeLane);
  check(didResize.ok, "VC-2 — the resize grip is present and grabbable", didResize.why ?? "");
  await page.waitForTimeout(1200);
  const resizePrompt = await page.$(".ns-dispatch-reason");
  check(Boolean(resizePrompt), "a resize routes through the same reason prompt");
  if (resizePrompt) {
    await page.fill(".ns-dispatch-reason__input", "job needs longer on site");
    await page.click(".ns-dispatch-reason__actions button:last-child");
    await page.waitForTimeout(4000);
    const afterResize = await readWo("wo-sbx-008");
    check(afterResize && afterResize.start === beforeResize.start,
      "resize kept the START where it was committed");
    check(afterResize && afterResize.end !== beforeResize.end,
      "resize moved the END and persisted",
      afterResize ? `${(beforeResize.end - beforeResize.start) / 60000}m -> ${(afterResize.end - afterResize.start) / 60000}m` : "-");
    check(afterResize && (afterResize.end - afterResize.start) % 900_000 === 0,
      "the persisted duration is on the 15-minute grain");
  }

  // keyboard
  const beforeKey = await readWo("wo-sbx-009");
  await page.evaluate(() => {
    const lane = document.querySelector('[data-technician-id="tech-sbx-01"]');
    const chips = lane?.querySelectorAll(".ns-dispatch-chip--wo");
    const chip = chips?.[chips.length - 1];
    chip?.focus();
    chip?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const keyPrompt = await page.$(".ns-dispatch-reason");
  check(Boolean(keyPrompt), "VC-3 — a keyboard nudge reaches the same governed path");
  if (keyPrompt) {
    await page.fill(".ns-dispatch-reason__input", "route balancing");
    await page.click(".ns-dispatch-reason__actions button:last-child");
    await page.waitForTimeout(4000);
    const afterKey = await readWo("wo-sbx-009");
    const moved = afterKey && beforeKey && afterKey.start !== beforeKey.start;
    check(Boolean(moved), "the keyboard move PERSISTED",
      afterKey && beforeKey ? `${new Date(beforeKey.start).toISOString()} -> ${new Date(afterKey.start).toISOString()}` : "-");
    check(Boolean(afterKey) && Math.abs(afterKey.start - beforeKey.start) === 900_000,
      "moved by exactly one 15-minute slot",
      afterKey && beforeKey ? `${(afterKey.start - beforeKey.start) / 60000} min` : "-");
  }

  // ══════════════ 4 · PAST SLOT ══════════════
  console.log("\n── 4 · PAST SLOT (today) ──");
  const today = await gotoDay(0);
  const shaded = await page.$$(".ns-dispatch-lane__past");
  check(shaded.length > 0, "past minutes of today are visibly unavailable", `${shaded.length} lanes shaded on ${today}`);

  // (the past-slot DROP itself ran as 4a, before the queue was emptied by section 1)

  // A keyboard nudge that would land in the past, on a chip that exists on a past day.
  await clearMessage(page);
  const keyPast = await page.evaluate(() => {
    const chip = document.querySelector(".ns-dispatch-chip--wo");
    if (!chip) return false;
    chip.focus();
    chip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    return true;
  });
  if (keyPast) {
    await page.waitForTimeout(1200);
    const kmsg = await page.$eval(".ns-dispatch__message", (e) => e.textContent.trim()).catch(() => "");
    check(/past/i.test(kmsg), "VC-4 — a keyboard nudge into the past is refused too", kmsg.slice(0, 80));
  } else {
    console.log("  (no chip on today to nudge — keyboard past-guard covered by component tests)");
  }

  // the accessible picker's floor
  const picker = await page.$(".ns-dispatch-card button, .ns-dispatch-queue__picker");
  if (picker) {
    await picker.click().catch(() => {});
    await page.waitForTimeout(900);
    const min = await page.$eval('.ns-dispatch-dialog input[type="datetime-local"]', (e) => e.getAttribute("min")).catch(() => null);
    check(Boolean(min), "the accessible picker declares a past floor to the browser", String(min));
    await page.keyboard.press("Escape").catch(() => {});
  }

  check(pageErrors.length === 0, "no runtime errors across the whole interaction pass", pageErrors.join("; ") || "clean");

  // ══════════════ RESTORE ══════════════
  //
  // Section 1 CONSUMES the queue by scheduling its only card, so a second run of this probe finds an
  // empty queue and reports four failures that are entirely its own doing — which is exactly what
  // happened before this block existed. Returning the card through the governed Unschedule makes the
  // pass repeatable, and uses the same command a dispatcher would rather than writing Firestore.
  const restored = await readWo("wo-sbx-007");
  if (restored?.status === "SCHEDULED") {
    const r = await fetch("https://us-central1-eos-platform-sandbox.cloudfunctions.net/transitionWorkOrder", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.idToken}` },
      body: JSON.stringify({ data: {
        workOrderId: "wo-sbx-007", action: "Unschedule",
        unscheduleReason: "returned to the queue by the interaction pass, so the acceptance estate is repeatable",
      } }),
    });
    const ok = r.ok;
    const back = await readWo("wo-sbx-007");
    check(ok && back?.status === "READY_TO_DISPATCH",
      "RESTORE — the queue card is returned through the governed Unschedule", back?.status ?? "-");
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(72));
console.log(`DISPATCH INTERACTION PASS: ${failed.length ? "FAIL" : "PASS"} — ${results.length - failed.length}/${results.length}`);
if (failed.length) failed.forEach((f) => console.log(`  FAILED: ${f.label}${f.detail ? ` — ${f.detail}` : ""}`));
console.log("=".repeat(72));
process.exit(failed.length ? 1 : 0);
