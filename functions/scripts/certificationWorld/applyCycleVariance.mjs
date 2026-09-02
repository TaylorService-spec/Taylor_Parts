#!/usr/bin/env node
// ONE BOUNDED GOVERNED CYCLE COUNT against ONE named part at ONE named location.
//
// ============================ WHAT THIS PROVES, AND WHY IT IS DIFFERENT ============================
//
// Counting is the one inventory act that is allowed to change the COMPANY TOTAL. A transfer
// relocates and must net to zero; a receipt adds what a supplier delivered. A reconciled count
// corrects the books to the shelf, so the company total legitimately moves -- and that is the last
// unproven Certification invariant.
//
// The lifecycle it exercises is three separate facts, and this tool keeps them separate rather than
// reporting one opaque success:
//
//   OPEN        a count exists, expected quantity snapshotted from the ledger. No stock moves.
//   COUNTED     the counter reports what is on the shelf. STILL no stock moves -- counting is an
//               observation, not a correction, and this tool verifies that before going further.
//   RECONCILED  an INDEPENDENT person approves the variance, and only then is ADJUSTED staged.
//
// Between COUNTED and RECONCILED it proves the counter cannot approve their own variance. If that
// self-approval ever succeeds the ceremony stops there: separation of duties is the property being
// certified, and a tool that continued past its failure would be certifying nothing.
//
// ============================ NO CYCLE-COUNT LOGIC LIVES HERE ============================
//
// Every decision belongs to the product: may this actor act, does the part resolve, what the
// expected quantity is, whether the variance is material, what the ledger movement looks like.
// executeCycleCount.mjs holds the governed machinery (create/submit/reconcile productions, the real
// resolver, the real audit stager); this file supplies a bounded entry point and the phase-by-phase
// verification, exactly as applyGoldenReceipt.mjs does for Receiving.
//
// Usage:
//   node scripts/certificationWorld/applyCycleVariance.mjs --projectId eos-platform-certification \
//     --partId CW-P-0501 --locationId wh-main --countedQuantity 43
//   ... --apply --apply-live-certification        (adds the live write)
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused, assertBothLiveFlags } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { setExecutionTarget, loadPrincipalIndex, resolveCapability,
        COUNT_CREATE, COUNT_SUBMIT, COUNT_RECONCILE } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));
const { cycleCountAs, readCycleCount, onHandAt, protectedGoldenParts, isMaterial, MATERIALITY } =
  await import(L("functions/scripts/certificationWorld/executeCycleCount.mjs"));

const CYCLE_COUNTS = "cycle_counts";
const LEDGER = "inventory_transactions";

/** The certification counter and reconciler. Proven live before use, never trusted by name. */
const COUNTER = "cw-emp-026";
const RECONCILER = "cw-emp-024";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");

/**
 * The count this invocation is allowed to perform. PURE.
 *
 * Part, location and observed quantity are all STATED. There is no candidate search and no default
 * anywhere: a tool that picks its own part picks which evidence to overwrite, and a reconciled
 * variance CHANGES physical truth. That is a heavier mistake than a mis-targeted read.
 */
export function parseCountRequest(args) {
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const partId = get("--partId");
  const locationId = get("--locationId");
  const raw = get("--countedQuantity");
  if (!partId) throw new Error("--partId is required. There is no default part and no candidate search.");
  if (!locationId) throw new Error("--locationId is required. A count happens somewhere specific.");
  if (raw === null || raw === undefined) throw new Error("--countedQuantity is required. The shelf is not guessed.");
  const countedQuantity = Number(raw);
  // Zero is a legitimate count -- a shelf can be empty -- so the floor is 0, not 1.
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    throw new Error(`--countedQuantity must be a whole number >= 0, got ${JSON.stringify(raw)}`);
  }
  return { partId, locationId, countedQuantity };
}

/**
 * Parts whose physical truth another Certification scenario is asserting.
 *
 * DERIVED FROM LIVE EVIDENCE, never a hardcoded id list. A reconciled count rewrites the very
 * numbers a scenario proves, so anything a live purchase order or receipt references is off limits
 * -- which covers the Golden part and the APPROVED trap without naming either, and keeps covering
 * whatever the next ceremony creates. `protectedGoldenParts` (work-order snapshots) is folded in
 * for the same reason.
 */
export async function protectedParts(db) {
  const out = new Set(await protectedGoldenParts(db));
  for (const d of (await db.collection("purchase_orders").get()).docs) {
    for (const item of d.data().items ?? []) if (item?.partId) out.add(item.partId);
  }
  for (const d of (await db.collection("receiving_orders").get()).docs) {
    for (const line of d.data().lines ?? []) if (line?.partId) out.add(line.partId);
  }
  return out;
}

/** Deterministic per (part, location, counted) so a rerun is recognised rather than duplicated. */
export function countIdempotencyKey({ partId, locationId, countedQuantity }) {
  return `cw_cycle_${partId}_${locationId}_${countedQuantity}`;
}

/**
 * Prove the count is performable WITHOUT writing. Returns a plan or throws.
 *
 * PURE given its inputs, so the refusals are testable without a project.
 */
export function planCount({ partId, locationId, countedQuantity },
  { expectedQuantity, protectedSet, existingForPart, reorderPoint, companyQuantity }) {
  if (protectedSet.has(partId)) {
    throw new Error(`${partId} is protected Certification evidence -- a reconciled count would rewrite `
      + "the physical truth another scenario is asserting");
  }
  if (existingForPart > 0) {
    throw new Error(`${existingForPart} cycle count(s) already exist for ${partId} -- refusing rather than `
      + "stacking a second correction on the same part");
  }
  const variance = countedQuantity - expectedQuantity;
  if (variance === 0) {
    throw new Error(`counted ${countedQuantity} equals expected ${expectedQuantity}: a zero variance stages `
      + "no ledger movement, so this ceremony would prove nothing");
  }
  if (!isMaterial(variance, expectedQuantity)) {
    throw new Error(`variance ${variance} is IMMATERIAL against expected ${expectedQuantity} `
      + `(needs |v| >= ${MATERIALITY.absoluteUnits} or >= ${MATERIALITY.relativeFraction * 100}%)`);
  }
  const cond = (w, c) => c > reorderPoint && w < reorderPoint ? "FALSE_COMFORT"
    : w === 0 ? "CRITICAL" : w < reorderPoint ? "REORDER" : w <= reorderPoint + 2 ? "WATCH" : "HEALTHY";
  return {
    partId, locationId, countedQuantity, expectedQuantity, variance,
    material: true, materiality: MATERIALITY, reorderPoint,
    companyBefore: companyQuantity, companyAfter: companyQuantity + variance,
    conditionBefore: cond(expectedQuantity, companyQuantity),
    conditionAfter: cond(countedQuantity, companyQuantity + variance),
    idempotencyKey: countIdempotencyKey({ partId, locationId, countedQuantity }),
  };
}

let target = null;
try {
  target = resolveExecutionTarget();
  setExecutionTarget(target);
} catch (err) {
  if (!(err instanceof ExecutionTargetRefused)) throw err;
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}

if (target && (target.apply || APPLY)) {
  try {
    assertBothLiveFlags({ target, argv: process.argv, act: "A cycle count that adjusts stock" });
  } catch (err) {
    if (!(err instanceof ExecutionTargetRefused)) throw err;
    console.error(`REFUSED: ${err.message}`);
    process.exitCode = 1;
    target = null;
  }
}

if (target) {
  console.log(describeTarget(target));
  const request = parseCountRequest(argv);
  if (!getApps().length) {
    initializeApp(target.isEmulator
      ? { projectId: target.projectId }
      : { credential: applicationDefault(), projectId: target.projectId });
  }
  const db = getFirestore();
  console.log(`mode     : ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  const location = { type: "WAREHOUSE", locationId: request.locationId };
  const expectedQuantity = await onHandAt(db, request.partId, location);
  const ledgerSnap = await db.collection(LEDGER).where("partId", "==", request.partId).get();
  let companyQuantity = 0;
  for (const d of ledgerSnap.docs) {
    const v = d.data(); const q = Number(v.quantity) || 0;
    companyQuantity += (v.type === "TRANSFER_OUT" || v.type === "SCRAPPED") ? -q : q;
  }
  const { CERT_PARTS, reorderPointFor } =
    await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));
  const part = CERT_PARTS.find((p) => p.partId === request.partId);
  if (!part) throw new Error(`${request.partId} is not a certification part`);
  if (part.ledgerTrackingMode !== "NONE") {
    throw new Error(`${request.partId} is ${part.ledgerTrackingMode}-tracked -- quantity counting does not apply`);
  }
  const existing = (await db.collection(CYCLE_COUNTS).get()).docs.filter((d) => d.data().partId === request.partId);

  const plan = planCount(request, {
    expectedQuantity, protectedSet: await protectedParts(db),
    existingForPart: existing.length, reorderPoint: reorderPointFor(part),
    companyQuantity,
  });

  console.log("SCOPE -- exactly what this invocation would affect, and nothing else:");
  console.log(`  project          ${target.projectId}`);
  console.log(`  part             ${plan.partId}  ${part.name}`);
  console.log(`  location         WAREHOUSE ${plan.locationId}`);
  console.log(`  expected (books) ${plan.expectedQuantity}`);
  console.log(`  counted (shelf)  ${plan.countedQuantity}`);
  console.log(`  variance         ${plan.variance}`);
  console.log(`  materiality      MATERIAL  (rule: |v| >= ${MATERIALITY.absoluteUnits} or >= ${MATERIALITY.relativeFraction * 100}%)`);
  console.log(`  condition        ${plan.conditionBefore} -> ${plan.conditionAfter}  (reorderPoint ${plan.reorderPoint})`);
  console.log(`  company total    ${plan.companyBefore} -> ${plan.companyAfter}   <-- a count MAY move this; a transfer may not`);
  console.log(`  protected check  ${plan.partId} is not referenced by any live PO, receipt or work order`);
  console.log(`  existing counts  ${existing.length} for this part`);
  console.log(`  idempotency key  ${plan.idempotencyKey}`);

  // ── SoD, resolved live. Named actors are a starting point, never the proof.
  const idx = await loadPrincipalIndex(db);
  const decide = async (emp, cap) => (await resolveCapability(db, idx, emp, cap)).allowed ? "ALLOW" : "DENY";
  const counterUid = idx.get(COUNTER), reconcilerUid = idx.get(RECONCILER);
  const sod = {
    counterCreate: await decide(COUNTER, COUNT_CREATE),
    counterSubmit: await decide(COUNTER, COUNT_SUBMIT),
    counterReconcile: await decide(COUNTER, COUNT_RECONCILE),
    reconcilerReconcile: await decide(RECONCILER, COUNT_RECONCILE),
    reconcilerSubmit: await decide(RECONCILER, COUNT_SUBMIT),
  };
  console.log("\nSEPARATION OF DUTIES (resolved live):");
  console.log(`  counter     ${COUNTER} (${counterUid})`);
  console.log(`      create ${sod.counterCreate} · submit ${sod.counterSubmit} · reconcile ${sod.counterReconcile}`);
  console.log(`  reconciler  ${RECONCILER} (${reconcilerUid})`);
  console.log(`      reconcile ${sod.reconcilerReconcile} · submit ${sod.reconcilerSubmit}`);
  const sodOk = sod.counterCreate === "ALLOW" && sod.counterSubmit === "ALLOW"
    && sod.counterReconcile === "DENY" && sod.reconcilerReconcile === "ALLOW"
    && sod.reconcilerSubmit === "DENY" && counterUid !== reconcilerUid;
  if (!sodOk) throw new Error("separation of duties does not hold -- refusing to run the ceremony");
  console.log("  SoD HOLDS: the counter cannot settle its own count, and they are different principals.\n");

  if (!APPLY) {
    console.log("DRY RUN -- nothing written.");
  } else {
    const now = () => new Date();
    const clock = { now };

    // ── PHASE 1: OPEN. No stock moves.
    const created = await cycleCountAs(db, COUNTER, "create",
      { partId: plan.partId, location, idempotencyKey: plan.idempotencyKey }, clock);
    if (!created.ok) throw new Error(`PHASE 1 CREATE refused: ${created.code} -- ${created.message}`);
    const cycleCountId = created.outcome.cycleCountId;
    console.log(`PHASE 1 OPEN        ${cycleCountId}  expected ${created.outcome.expectedQuantity}`);
    if (created.outcome.expectedQuantity !== plan.expectedQuantity) {
      throw new Error(`the service snapshotted expected ${created.outcome.expectedQuantity}, the plan measured `
        + `${plan.expectedQuantity} -- state moved under the ceremony, STOPPING before submit`);
    }

    // ── PHASE 2: COUNTED. Still no stock moves, and that is verified, not assumed.
    const submitted = await cycleCountAs(db, COUNTER, "submit",
      { cycleCountId, countedQuantity: plan.countedQuantity }, clock);
    if (!submitted.ok) throw new Error(`PHASE 2 SUBMIT refused: ${submitted.code} -- ${submitted.message}`);
    const afterSubmitWh = await onHandAt(db, plan.partId, location);
    const adjAfterSubmit = (await db.collection(LEDGER).where("partId", "==", plan.partId).get())
      .docs.filter((d) => d.data().sourceObject?.type === "ADJUSTMENT").length;
    console.log(`PHASE 2 COUNTED     variance ${submitted.outcome.variance} · status `
      + `${(await readCycleCount(db, cycleCountId))?.status} · warehouse still ${afterSubmitWh} · `
      + `ADJUSTED rows ${adjAfterSubmit}`);
    if (afterSubmitWh !== plan.expectedQuantity || adjAfterSubmit !== 0) {
      throw new Error("COUNTING MOVED STOCK -- it must only observe. STOPPING before reconciliation.");
    }

    // ── PHASE 3: the counter may not settle its own variance.
    const selfApprove = await cycleCountAs(db, COUNTER, "reconcile",
      { cycleCountId, decision: "APPROVE", reason: "self-approval probe -- must be refused" }, clock);
    if (selfApprove.ok) {
      throw new Error("SELF-APPROVAL SUCCEEDED -- separation of duties has failed. STOPPING.");
    }
    console.log(`PHASE 3 SELF-APPROVAL REFUSED  ${selfApprove.code}: ${selfApprove.message}`);

    // ── PHASE 4: an independent person accepts it, and ONLY now may the ledger move.
    const reconciled = await cycleCountAs(db, RECONCILER, "reconcile",
      { cycleCountId, decision: "APPROVE",
        reason: "Independent recount confirms the shortfall; adjusting the books to the shelf." }, clock);
    if (!reconciled.ok) throw new Error(`PHASE 4 RECONCILE refused: ${reconciled.code} -- ${reconciled.message}`);
    const finalWh = await onHandAt(db, plan.partId, location);
    console.log(`PHASE 4 RECONCILED  status ${(await readCycleCount(db, cycleCountId))?.status} · `
      + `warehouse ${plan.expectedQuantity} -> ${finalWh}`);
    console.log(`\nCYCLE COUNT COMPLETE: ${cycleCountId}`);
  }
}
