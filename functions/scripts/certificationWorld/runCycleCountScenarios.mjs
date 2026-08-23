#!/usr/bin/env node
// C01–C04 — cycle counts, executed once against the real command family.
//
// EMULATOR ONLY.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { cycleCountAs, readCycleCount, onHandAt, protectedGoldenParts, isMaterial, MATERIALITY } =
  await import(L("functions/scripts/certificationWorld/executeCycleCount.mjs"));
const { CERT_PARTS } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const WH = Object.freeze({ type: "WAREHOUSE", locationId: "wh-main" });

/** Counters and reconcilers, each proven to hold only their own side. */
const COUNTERS = ["cw-emp-025", "cw-emp-026", "cw-emp-027", "cw-emp-028"];
const RECONCILERS = ["cw-emp-023", "cw-emp-024"];

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };
const evidence = { materiality: MATERIALITY };
const save = () => { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(path.join(OUT_DIR, "cycle-count-scenarios.json"), JSON.stringify(evidence, null, 2)); };

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  console.log(`materiality: |variance| >= ${MATERIALITY.absoluteUnits} OR |variance| / expected >= ${MATERIALITY.relativeFraction}\n`);

  // ── SELECTION GUARD ───────────────────────────────────────────────────────────────────────────
  //
  // A reconciled variance CHANGES the physical truth. Counting a part another Golden scenario
  // asserts about would rewrite that scenario's evidence -- a sharper version of the transfer
  // mistake in Pass 3A, where two correctly-moved units silently dismantled the only FALSE_COMFORT
  // case in the world.
  const golden = await protectedGoldenParts(db);
  const candidates = [];
  for (const p of CERT_PARTS) {
    if (p.ledgerTrackingMode !== "NONE") continue;         // SERIAL counts are a different contract
    if (golden.has(p.partId)) continue;                    // protected
    const onHand = await onHandAt(db, p.partId, WH);
    if (onHand >= 12) candidates.push({ partId: p.partId, onHand });
  }
  candidates.sort((a, b) => b.onHand - a.onHand);
  console.log(`countable parts (non-Golden, NONE-tracked, >= 12 on hand): ${candidates.length}`);
  check("enough non-Golden parts exist to run four counts", candidates.length >= 4,
    candidates.slice(0, 5).map((c) => `${c.partId}:${c.onHand}`).join(", "));
  check("no Golden-dependent part is a candidate",
    candidates.every((c) => !golden.has(c.partId)), `${golden.size} parts protected`);

  if (candidates.length < 4) { process.exitCode = 1; }
  else {
    const [c01Part, c02Part, c03Part, c04Part] = candidates;

    /** Create + submit, returning everything the assertions need. */
    async function runCount({ label, part, counter, observedDelta, key }) {
      const before = await onHandAt(db, part.partId, WH);
      const created = await cycleCountAs(db, counter, "create", {
        partId: part.partId, location: { ...WH }, idempotencyKey: key,
      });
      if (!created.ok) return { label, created };
      const id = created.outcome.cycleCountId;
      const expected = created.outcome.expectedQuantity;
      const afterCreate = await onHandAt(db, part.partId, WH);
      const observed = expected + observedDelta;
      const submitted = await cycleCountAs(db, counter, "submit", { cycleCountId: id, countedQuantity: observed });
      const afterSubmit = await onHandAt(db, part.partId, WH);
      const stored = await readCycleCount(db, id);
      return { label, id, part: part.partId, counter, expected, observed,
        variance: submitted.ok ? submitted.outcome.variance : null,
        before, afterCreate, afterSubmit, created, submitted, stored };
    }

    // ══ C01 — EXACT COUNT ══════════════════════════════════════════════════════════════════════
    console.log("\n== C01  exact count");
    const c01 = await runCount({ label: "C01", part: c01Part, counter: COUNTERS[0], observedDelta: 0, key: "cw-c01-exact" });
    check("C01 count created and submitted", c01.created?.ok && c01.submitted?.ok,
      c01.submitted?.ok ? `expected ${c01.expected}, observed ${c01.observed}` : `${c01.submitted?.code}: ${c01.submitted?.message}`);
    check("C01 variance is zero", c01.variance === 0, `${c01.variance}`);
    check("C01 is COUNTED", c01.stored?.status === "COUNTED", c01.stored?.status);
    check("C01 counting changed no inventory", c01.afterSubmit === c01.before,
      `${c01.before} -> ${c01.afterSubmit}`);
    check("C01 a zero variance is never material", !isMaterial(0, c01.expected), "by definition");
    evidence.C01 = { ...c01, created: undefined, submitted: undefined, stored: undefined };

    // ══ C02 — SMALL (IMMATERIAL) VARIANCE ══════════════════════════════════════════════════════
    console.log("\n== C02  small variance");
    // Chosen to be immaterial under the PRODUCT's rule, not under an opinion: 2 units short of a
    // population large enough that 2 is under 10%.
    const c02 = await runCount({ label: "C02", part: c02Part, counter: COUNTERS[1], observedDelta: -2, key: "cw-c02-small" });
    check("C02 count submitted", c02.submitted?.ok, c02.submitted?.ok ? `variance ${c02.variance}` : `${c02.submitted?.code}`);
    check("C02 variance is non-zero", c02.variance !== 0, `${c02.variance}`);
    check("C02 the variance is IMMATERIAL under the product's own rule",
      !isMaterial(c02.variance, c02.expected),
      `|${c02.variance}| < ${MATERIALITY.absoluteUnits} and ${Math.abs(c02.variance)}/${c02.expected} < ${MATERIALITY.relativeFraction}`);
    check("C02 counting changed no inventory", c02.afterSubmit === c02.before, `${c02.before} -> ${c02.afterSubmit}`);
    check("C02 the observation is stored on the count", c02.stored?.countedQuantity === c02.observed,
      `counted ${c02.stored?.countedQuantity}`);
    evidence.C02 = { ...c02, created: undefined, submitted: undefined, stored: undefined };

    // ══ C03 — MATERIAL VARIANCE ════════════════════════════════════════════════════════════════
    console.log("\n== C03  material variance");
    const c03 = await runCount({ label: "C03", part: c03Part, counter: COUNTERS[2], observedDelta: -6, key: "cw-c03-material" });
    check("C03 count submitted", c03.submitted?.ok, c03.submitted?.ok ? `variance ${c03.variance}` : `${c03.submitted?.code}`);
    check("C03 the variance is MATERIAL under the product's own rule",
      isMaterial(c03.variance, c03.expected),
      `|${c03.variance}| >= ${MATERIALITY.absoluteUnits}`);
    check("C03 counting changed no inventory", c03.afterSubmit === c03.before, `${c03.before} -> ${c03.afterSubmit}`);
    evidence.C03 = { ...c03, created: undefined, submitted: undefined, stored: undefined };

    // ══ C04 — RECONCILIATION REQUIRED ══════════════════════════════════════════════════════════
    console.log("\n== C04  counted, awaiting an independent decision");
    const c04 = await runCount({ label: "C04", part: c04Part, counter: COUNTERS[3], observedDelta: -4, key: "cw-c04-pending" });
    check("C04 count submitted with a material variance", c04.submitted?.ok && isMaterial(c04.variance, c04.expected),
      `variance ${c04.variance} against expected ${c04.expected}`);
    check("C04 sits at COUNTED -- not reconciled by being counted", c04.stored?.status === "COUNTED", c04.stored?.status);
    check("C04 the variance is visible on the record", c04.stored?.variance === c04.variance, `${c04.stored?.variance}`);
    check("C04 inventory is UNCHANGED while the decision is pending",
      c04.afterSubmit === c04.before, `${c04.before} -> ${c04.afterSubmit}`);
    check("C04 records WHO counted it", Boolean(c04.stored?.submittedBy), c04.stored?.submittedBy);
    evidence.C04 = { ...c04, created: undefined, submitted: undefined, stored: undefined };

    // ══ BLIND COUNT ════════════════════════════════════════════════════════════════════════════
    console.log("\n== blind count");
    // The honest distinction. The SUBMIT payload carries countedQuantity and nothing else -- there is
    // no field through which a counter states, or is told, what was expected. Expected is computed
    // server-side at CREATE and stored on the record, so the count is blind at the COMMAND boundary,
    // not blind in the sense that the number is unknowable to someone who can read the document.
    // A COUNTER CANNOT INFLUENCE WHAT WAS EXPECTED. That is the property that matters, and it is
    // proven by supplying a wildly wrong expectedQuantity and showing the variance is computed from
    // the STORED figure regardless.
    //
    // The payload does NOT refuse the field, which is a real inconsistency with both sibling
    // domains -- receiving and transfers each reject any unrecognised key, and cycle-count submit
    // rejects only the cross-mode one. See the assessment; it is reported, not asserted away.
    const c05 = await runCount({ label: "blind", part: candidates[4] ?? c01Part, counter: COUNTERS[0],
      observedDelta: -1, key: "cw-blind-expected-ignored" });
    const liar = await cycleCountAs(db, COUNTERS[0], "submit", {
      cycleCountId: c05.id, countedQuantity: c05.observed, expectedQuantity: 99999,
    });
    const storedAfter = await readCycleCount(db, c05.id);
    check("a counter-supplied expectedQuantity is IGNORED, not honoured",
      storedAfter?.expectedQuantity === c05.expected,
      `record still says ${storedAfter?.expectedQuantity}, the caller claimed 99999`);
    check("the variance is computed from the SERVER's expected figure",
      storedAfter?.variance === c05.observed - c05.expected,
      `${storedAfter?.variance} = ${c05.observed} - ${c05.expected}, not ${c05.observed} - 99999`);
    check("the count remains blind at the boundary that matters", storedAfter?.variance !== c05.observed - 99999,
      "a caller cannot widen or narrow their own variance");
    check("FINDING: the payload ACCEPTS the unrecognised field rather than refusing it", liar.ok,
      "receiving and transfers both reject any unknown key; cycle-count submit has no allow-list");
    // ══ SEMANTIC SoD ═══════════════════════════════════════════════════════════════════════════
    console.log("\n== separation of duties, against the real service");
    const counterReconciles = await cycleCountAs(db, c04.counter, "reconcile", {
      cycleCountId: c04.id, decision: "APPROVE", reason: "counter attempting to approve their own count",
    });
    const afterAttempt = await onHandAt(db, c04.part, WH);
    check(`the counter (${c04.counter}) CANNOT reconcile`, !counterReconciles.ok,
      counterReconciles.ok ? "ACCEPTED" : `${counterReconciles.code}: ${counterReconciles.message}`);
    check("the refused reconciliation changed no inventory", afterAttempt === c04.before,
      `${c04.before} -> ${afterAttempt}`);

    const reconcilerCounts = await cycleCountAs(db, RECONCILERS[0], "create", {
      partId: c01Part.partId, location: { ...WH }, idempotencyKey: "cw-reconciler-attempts-count",
    });
    check(`the reconciler (${RECONCILERS[0]}) CANNOT open a count`, !reconcilerCounts.ok,
      reconcilerCounts.ok ? "ACCEPTED" : `${reconcilerCounts.code}: ${reconcilerCounts.message}`);
    evidence.sod = {
      counterAttemptedReconcile: { employee: c04.counter, code: counterReconciles.code },
      reconcilerAttemptedCount: { employee: RECONCILERS[0], code: reconcilerCounts.code },
    };

    // ══ THE RECONCILIATION ═════════════════════════════════════════════════════════════════════
    console.log("\n== reconciliation, by an independent authority");
    const reconciler = RECONCILERS[0];
    const preReconcile = await onHandAt(db, c04.part, WH);
    const reconciled = await cycleCountAs(db, reconciler, "reconcile", {
      cycleCountId: c04.id, decision: "APPROVE", reason: "Physical recount confirms the shortfall.",
    });
    const postReconcile = await onHandAt(db, c04.part, WH);
    const finalDoc = await readCycleCount(db, c04.id);
    check("an authorized reconciler CAN approve", reconciled.ok,
      reconciled.ok ? `${reconciler} approved it` : `${reconciled.code}: ${reconciled.message}`);
    check("the count is RECONCILED", finalDoc?.status === "RECONCILED", finalDoc?.status);
    check("inventory moved by EXACTLY the variance", postReconcile === preReconcile + c04.variance,
      `${preReconcile} ${c04.variance >= 0 ? "+" : ""}${c04.variance} = ${postReconcile}`);
    check("the corrected balance equals what was counted", postReconcile === c04.observed,
      `books now say ${postReconcile}, the counter saw ${c04.observed}`);

    // The adjustment must point at the count that authorized it -- never an anonymous ADJUSTED row.
    const adjRows = (await db.collection("inventory_transactions").where("partId", "==", c04.part).get())
      .docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.sourceObject?.type === "ADJUSTMENT" && r.sourceObject?.id === c04.id);
    check("the adjustment references the cycle count that authorized it", adjRows.length === 1,
      adjRows.map((r) => `${r.id} -> ${r.sourceObject.id} qty ${r.quantity}`).join(", ") || "none");
    check("the adjustment carries the reconciler as its actor",
      adjRows[0]?.actor?.id === reconciled.actorUid, `${adjRows[0]?.actor?.id}`);
    evidence.reconciliation = {
      cycleCountId: c04.id, part: c04.part, reconciler,
      preReconcile, postReconcile, variance: c04.variance,
      adjustment: adjRows[0] ? { id: adjRows[0].id, quantity: adjRows[0].quantity, sourceObject: adjRows[0].sourceObject } : null,
      status: finalDoc?.status,
    };

    // ══ REPLAY AND CONFLICT ════════════════════════════════════════════════════════════════════
    console.log("\n== replay and conflict");
    const replay = await cycleCountAs(db, reconciler, "reconcile", {
      cycleCountId: c04.id, decision: "APPROVE", reason: "Physical recount confirms the shortfall.",
    });
    const afterReplay = await onHandAt(db, c04.part, WH);
    check("replaying the reconciliation adjusts nothing further", afterReplay === postReconcile,
      `${postReconcile} -> ${afterReplay}`);
    const adjAfterReplay = (await db.collection("inventory_transactions").where("partId", "==", c04.part).get())
      .docs.filter((d) => d.data().sourceObject?.id === c04.id);
    check("no second adjustment row was written", adjAfterReplay.length === adjRows.length,
      `${adjRows.length} -> ${adjAfterReplay.length}`);

    const flipped = await cycleCountAs(db, RECONCILERS[1], "reconcile", {
      cycleCountId: c04.id, decision: "REJECT", reason: "Changing my mind after the fact.",
    });
    check("a decided count cannot have its decision reversed", !flipped.ok,
      flipped.ok ? "ACCEPTED" : `${flipped.code}: ${flipped.message}`);

    const lateSubmit = await cycleCountAs(db, c04.counter, "submit", { cycleCountId: c04.id, countedQuantity: 1 });
    check("a RECONCILED count cannot be re-counted", !lateSubmit.ok,
      lateSubmit.ok ? "ACCEPTED" : `${lateSubmit.code}: ${lateSubmit.message}`);
    evidence.replayConflict = { replay: replay.ok ? "replayed" : replay.code, flipped: flipped.code, lateSubmit: lateSubmit.code };

    // ══ INVALID TRANSITIONS ════════════════════════════════════════════════════════════════════
    console.log("\n== invalid transitions");
    const fresh = await cycleCountAs(db, COUNTERS[0], "create", {
      partId: c01Part.partId, location: { ...WH }, idempotencyKey: "cw-cc-reconcile-before-submit",
    });
    const earlyReconcile = await cycleCountAs(db, reconciler, "reconcile", {
      cycleCountId: fresh.outcome.cycleCountId, decision: "APPROVE", reason: "too soon",
    });
    check("reconciling an OPEN count is REFUSED", !earlyReconcile.ok,
      earlyReconcile.ok ? "ACCEPTED" : `${earlyReconcile.code}: ${earlyReconcile.message}`);

    // ══ CANCEL ═════════════════════════════════════════════════════════════════════════════════
    console.log("\n== cancel");
    const cancelBefore = await onHandAt(db, c01Part.partId, WH);
    const cancelled = await cycleCountAs(db, COUNTERS[0], "cancel", { cycleCountId: fresh.outcome.cycleCountId });
    const cancelDoc = await readCycleCount(db, fresh.outcome.cycleCountId);
    const cancelAfter = await onHandAt(db, c01Part.partId, WH);
    check("an OPEN count can be cancelled", cancelled.ok, cancelled.ok ? cancelDoc?.status : `${cancelled.code}`);
    check("the cancelled count is CANCELLED", cancelDoc?.status === "CANCELLED", cancelDoc?.status);
    check("cancelling changed no inventory", cancelAfter === cancelBefore, `${cancelBefore} -> ${cancelAfter}`);
    const submitCancelled = await cycleCountAs(db, COUNTERS[0], "submit",
      { cycleCountId: fresh.outcome.cycleCountId, countedQuantity: 5 });
    check("a CANCELLED count cannot be counted", !submitCancelled.ok,
      submitCancelled.ok ? "ACCEPTED" : `${submitCancelled.code}: ${submitCancelled.message}`);
    const reconcileCancelled = await cycleCountAs(db, reconciler, "reconcile",
      { cycleCountId: fresh.outcome.cycleCountId, decision: "APPROVE", reason: "no" });
    check("a CANCELLED count cannot be reconciled", !reconcileCancelled.ok,
      reconcileCancelled.ok ? "ACCEPTED" : `${reconcileCancelled.code}: ${reconcileCancelled.message}`);
    evidence.cancel = { cycleCountId: fresh.outcome.cycleCountId, status: cancelDoc?.status,
      submitAfterCancel: submitCancelled.code, reconcileAfterCancel: reconcileCancelled.code };

    // ══ NOTHING ELSE MOVED ═════════════════════════════════════════════════════════════════════
    console.log("\n== collateral");
    const untouched = [];
    for (const c of [c01, c02, c03]) {
      const now = await onHandAt(db, c.part, WH);
      if (now !== c.before) untouched.push(`${c.part}: ${c.before} -> ${now}`);
    }
    check("the three un-reconciled counts left their parts untouched", untouched.length === 0,
      untouched.join(" | ") || "C01, C02 and C03 all unchanged -- only C04 was decided");
  }

  save();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} cycle count checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
