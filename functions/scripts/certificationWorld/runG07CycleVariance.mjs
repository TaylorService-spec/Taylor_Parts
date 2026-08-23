#!/usr/bin/env node
// G07 — CYCLE VARIANCE. The books said one thing, the shelf said another, and two different people
// were required to settle it.
//
// ============================ WHY THIS SCENARIO EXISTS ============================
//
// Every other Golden scenario asks whether the system can ANSWER a question about stock. This one
// asks what happens when the system is WRONG -- and specifically, who is allowed to say so.
//
// The dangerous version of a cycle count is the one where counting and correcting are the same act.
// A single person then discovers a shortfall and writes it off in the same motion, and the ledger
// records a correction with nobody to ask about it. That is not a hypothetical control weakness; it
// is the ordinary way inventory shrinkage gets buried.
//
// So the lifecycle here is deliberately three-legged:
//
//   BEFORE       the books say X
//   COUNTED      a counter says they saw Y, and NOTHING MOVES
//   RECONCILED   a different person with different authority decides the books were wrong
//
// The middle state is the load-bearing one. A count that adjusted inventory on submission would
// make the third leg decorative.
//
// ============================ WHY THIS DIFFERS FROM A TRANSFER ============================
//
//   TRANSFER            location changes, company total CONSERVED -- stock was moved
//   CYCLE RECONCILE     company total CHANGES -- the books were corrected toward physical truth
//
// A transfer that changed the company total would be creating stock. A reconciliation that did not
// would be refusing to admit the count.
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
const { loadPrincipalIndex, resolveCapability } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));
const { CERT_PARTS } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));
const { allLedgerRows, signedQuantity } =
  await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const WH = Object.freeze({ type: "WAREHOUSE", locationId: "wh-main" });
const COUNTER = "cw-emp-026";
const RECONCILER = "cw-emp-024";
const SUBMIT = "inventory.cycleCount.submit";
const RECONCILE = "inventory.cycleCount.reconcile";

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();
  const principalIndex = await loadPrincipalIndex(db);

  const companyTotal = async (partId) =>
    (await allLedgerRows(db)).filter((r) => r.partId === partId).reduce((s, r) => s + signedQuantity(r), 0);

  // ── The part: non-Golden, untouched by any earlier count, deep enough for a material variance.
  const golden = await protectedGoldenParts(db);
  const counted = new Set((await db.collection("cycle_counts").get()).docs.map((d) => d.data().partId));
  let chosen = null;
  for (const p of CERT_PARTS) {
    if (p.ledgerTrackingMode !== "NONE" || golden.has(p.partId) || counted.has(p.partId)) continue;
    const onHand = await onHandAt(db, p.partId, WH);
    if (onHand >= 15) { chosen = { partId: p.partId, onHand }; break; }
  }
  check("a countable, non-Golden, not-yet-counted part is available", Boolean(chosen),
    chosen ? `${chosen.partId} holds ${chosen.onHand}` : "none left");

  if (!chosen) { process.exitCode = 1; }
  else {
    // ── CAPABILITY PROOF, stored as fact rather than as two names ────────────────────────────────
    const counterHolds = await resolveCapability(db, principalIndex, COUNTER, SUBMIT);
    const counterDenied = await resolveCapability(db, principalIndex, COUNTER, RECONCILE);
    const reconcilerHolds = await resolveCapability(db, principalIndex, RECONCILER, RECONCILE);
    const reconcilerDenied = await resolveCapability(db, principalIndex, RECONCILER, SUBMIT);

    check(`counter ${COUNTER} holds ${SUBMIT}`, counterHolds.allowed, `${counterHolds.decision} via ${counterHolds.roles.join("/")}`);
    check(`counter ${COUNTER} is DENIED ${RECONCILE}`, !counterDenied.allowed, counterDenied.decision);
    check(`reconciler ${RECONCILER} holds ${RECONCILE}`, reconcilerHolds.allowed, `${reconcilerHolds.decision} via ${reconcilerHolds.roles.join("/")}`);
    check(`reconciler ${RECONCILER} is DENIED ${SUBMIT}`, !reconcilerDenied.allowed, reconcilerDenied.decision);
    check("counter and reconciler are different people", COUNTER !== RECONCILER, `${COUNTER} vs ${RECONCILER}`);

    // ── BEFORE ──────────────────────────────────────────────────────────────────────────────────
    const before = {
      partId: chosen.partId,
      warehouse: await onHandAt(db, chosen.partId, WH),
      company: await companyTotal(chosen.partId),
      countState: "(none)",
    };

    const created = await cycleCountAs(db, COUNTER, "create", {
      partId: chosen.partId, location: { ...WH }, idempotencyKey: "cw-g07-cycle-variance",
    });
    check("G07 count opened", created.ok, created.ok ? `expected ${created.outcome.expectedQuantity}` : `${created.code}`);
    if (!created.ok) { process.exitCode = 1; }
    else {
      const id = created.outcome.cycleCountId;
      const expected = created.outcome.expectedQuantity;
      // A shortfall large enough to be MATERIAL under the product's own rule -- the case that
      // actually requires an independent decision.
      const observed = expected - 5;
      const variance = observed - expected;
      check("the variance will be MATERIAL under the product's rule", isMaterial(variance, expected),
        `|${variance}| >= ${MATERIALITY.absoluteUnits}`);

      const submitted = await cycleCountAs(db, COUNTER, "submit", { cycleCountId: id, countedQuantity: observed });
      check("G07 count submitted", submitted.ok, submitted.ok ? `variance ${submitted.outcome.variance}` : `${submitted.code}`);

      const countedState = {
        partId: chosen.partId,
        warehouse: await onHandAt(db, chosen.partId, WH),
        company: await companyTotal(chosen.partId),
        expected, observed, variance,
        countState: (await readCycleCount(db, id))?.status,
      };
      check("COUNTING CHANGED NOTHING", countedState.warehouse === before.warehouse && countedState.company === before.company,
        `warehouse ${before.warehouse} -> ${countedState.warehouse}, company ${before.company} -> ${countedState.company}`);
      check("the count is COUNTED, awaiting a decision", countedState.countState === "COUNTED", countedState.countState);

      // ── The counter cannot settle their own count ───────────────────────────────────────────────
      const selfApprove = await cycleCountAs(db, COUNTER, "reconcile", {
        cycleCountId: id, decision: "APPROVE", reason: "I counted it, I approve it",
      });
      check("the counter cannot approve their own variance", !selfApprove.ok,
        selfApprove.ok ? "ACCEPTED" : `${selfApprove.code}: ${selfApprove.message}`);

      // ── RECONCILED ──────────────────────────────────────────────────────────────────────────────
      const reconciled = await cycleCountAs(db, RECONCILER, "reconcile", {
        cycleCountId: id, decision: "APPROVE",
        reason: "Recount by a second person confirms the shortfall; adjusting the books to the shelf.",
      });
      check("an independent reconciler approved it", reconciled.ok,
        reconciled.ok ? `${RECONCILER}` : `${reconciled.code}: ${reconciled.message}`);

      const adjRow = (await allLedgerRows(db)).find((r) => r.sourceObject?.type === "ADJUSTMENT" && r.sourceObject?.id === id);
      const after = {
        partId: chosen.partId,
        warehouse: await onHandAt(db, chosen.partId, WH),
        company: await companyTotal(chosen.partId),
        countState: (await readCycleCount(db, id))?.status,
        adjustment: adjRow ? { id: adjRow.id, type: adjRow.type, quantity: adjRow.quantity,
          sourceObject: adjRow.sourceObject, actor: adjRow.actor?.id } : null,
      };

      check("the count is RECONCILED", after.countState === "RECONCILED", after.countState);
      check("the warehouse balance moved by EXACTLY the variance",
        after.warehouse === before.warehouse + variance, `${before.warehouse} ${variance} -> ${after.warehouse}`);
      check("the books now agree with what was counted", after.warehouse === observed,
        `books ${after.warehouse}, counted ${observed}`);
      // The distinction from transfers, asserted rather than described.
      check("COMPANY TOTAL CHANGED -- this is a correction, not a relocation",
        after.company === before.company + variance,
        `${before.company} -> ${after.company}: a transfer conserves this, a reconciliation must not`);
      check("the adjustment is ADJUSTED, sourced from the count that authorized it",
        after.adjustment?.type === "ADJUSTED" && after.adjustment?.sourceObject?.type === "ADJUSTMENT"
        && after.adjustment?.sourceObject?.id === id,
        `${after.adjustment?.type} -> ${after.adjustment?.sourceObject?.id}`);
      check("the adjustment names the RECONCILER, not the counter",
        after.adjustment?.actor === reconciled.actorUid && after.adjustment?.actor !== submitted.actorUid,
        `${after.adjustment?.actor}`);

      const manifest = {
        id: "G07", title: "Cycle variance",
        question: "The books say one thing and the shelf says another. Who gets to decide?",
        expectedAnswer: "A counter reports what they saw and nothing moves. A different person with "
          + "reconcile authority decides the books were wrong, and only then does inventory change.",
        trap: "A system where counting adjusts stock lets one person find a shortfall and write it "
          + "off in the same motion, with nobody to ask about it.",
        cycleCountId: id,
        counter: { employeeId: COUNTER, principal: counterHolds.uid, holds: SUBMIT,
          deniedCapability: RECONCILE, holdsDecision: counterHolds.decision, deniedDecision: counterDenied.decision,
          roles: counterHolds.roles },
        reconciler: { employeeId: RECONCILER, principal: reconcilerHolds.uid, holds: RECONCILE,
          deniedCapability: SUBMIT, holdsDecision: reconcilerHolds.decision, deniedDecision: reconcilerDenied.decision,
          roles: reconcilerHolds.roles },
        materiality: MATERIALITY,
        selfApprovalRefusal: selfApprove.code,
        before, counted: countedState, after,
      };
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, "g07-cycle-variance.json"), JSON.stringify(manifest, null, 2));

      console.log("\n== G07 transition");
      const row = (label, b, c, a) => console.log(`  ${label.padEnd(22)} ${String(b).padStart(12)} ${String(c).padStart(12)} ${String(a).padStart(12)}`);
      console.log(`  ${"".padEnd(22)} ${"BEFORE".padStart(12)} ${"COUNTED".padStart(12)} ${"RECONCILED".padStart(12)}`);
      row("Expected balance", before.warehouse, countedState.expected, after.warehouse);
      row("Observed count", "-", countedState.observed, countedState.observed);
      row("Variance", "-", variance, variance);
      row("Stored inventory", before.warehouse, countedState.warehouse, after.warehouse);
      row("Company total", before.company, countedState.company, after.company);
      row("Count state", before.countState, countedState.countState, after.countState);
      row("Counter", "-", COUNTER, COUNTER);
      row("Reconciler", "-", "-", RECONCILER);
      row("Adjustment qty", "-", 0, after.adjustment?.quantity ?? "-");
      row("Ledger ref", "-", "-", after.adjustment?.id?.slice(0, 14) ?? "-");
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} G07 checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
