#!/usr/bin/env node
// APPLY WORK ORDER DEMAND — through createWorkOrderRecord and applyPartsPlan, never around them.
//
// createWorkOrderRecord allocates the WO number inside the caller's transaction and owns the stored
// shape; applyPartsPlan resolves every line's canonical SKU from Part Master and fails closed on an
// unresolved identity. Writing a fieldops_wos document directly would skip both and produce a Work
// Order the product could not have created.
//
// The snapshot is handed to createWorkOrderRecord as `inventorySnapshot` -- the documented
// parts-plan-continuity seam the Sales Order -> Service path already uses -- so the plan and the
// Work Order are committed together rather than in two steps that can half-fail.
//
// ============================ IDENTITY THE FIXTURE CANNOT KNOW ============================
//
// The WO id and number are minted by the writer, so the plan names neither. A scenario is
// recognised on re-run by its content tag stored on the record, which is the same trade the
// purchasing applier makes: weaker than a real idempotency key, and right for a fixture where a
// duplicate is always a mistake.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { DEMAND_SCENARIOS, accountIdFor, scenarioTag } =
  await import(L("functions/scripts/certificationWorld/data/demandPlan.mjs"));
const { createWorkOrderRecord } = await import(L("functions/lib/createWorkOrder.js"));
const { applyPartsPlan } = await import(L("functions/lib/workOrderPartsPlan/setWorkOrderPartsPlan.js"));

const WORK_ORDERS = "fieldops_wos";
const APPLY = process.argv.includes("--apply");
/** Pinned so a rebuild allocates the same WO-year sequence. */
const NOW_YEAR = 2026;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only. Set FIRESTORE_EMULATOR_HOST.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  console.log(`emulator : ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(`mode     : ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);
  console.log(`scenarios: ${DEMAND_SCENARIOS.length}`);

  // ── Existing scenarios, by content tag.
  const existing = await db.collection(WORK_ORDERS).get();
  const byTag = new Map();
  for (const d of existing.docs) {
    const tag = d.data().certScenarioTag;
    if (tag) byTag.set(tag, { id: d.id, woNumber: d.data().woNumber });
  }

  // ── Part Master resolver: the SAME rule applyPartsPlan enforces, read from the same collection.
  const partsSnap = await db.collection("parts").get();
  const parts = new Map(partsSnap.docs.map((d) => [d.id, d.data()]));
  const resolvePart = (partId) => {
    const p = parts.get(partId);
    if (!p) return { found: false, sku: null };
    const sku = typeof p.internalPartNumber === "string" ? p.internalPartNumber : null;
    return { found: true, sku };
  };

  const results = [];
  for (const scenario of DEMAND_SCENARIOS) {
    const tag = scenarioTag(scenario);
    const hit = byTag.get(tag);
    if (hit) { results.push({ scenario, ...hit, outcome: "ALREADY_PRESENT" }); continue; }

    // ── Resolve the customer's real location and installed equipment.
    //
    // The plan names a customer; the world decides where their equipment actually is. Inventing a
    // locationId would create the dangling reference the world's own invariant check exists to
    // catch.
    const accountId = accountIdFor(scenario);
    const equipSnap = await db.collection("equipment").where("accountId", "==", accountId).limit(1).get();
    if (equipSnap.empty) {
      results.push({ scenario, outcome: "NO_EQUIPMENT", detail: `${accountId} owns no equipment` });
      continue;
    }
    const equip = equipSnap.docs[0];
    const locationId = equip.data().locationId;

    // ── Build the snapshot through the canonical planner. Fails closed on unresolved identity.
    let snapshot;
    try {
      snapshot = applyPartsPlan(undefined, scenario.plan, resolvePart);
    } catch (err) {
      results.push({ scenario, outcome: "PLAN_REFUSED", detail: `${err.code ?? "?"}: ${err.message}` });
      continue;
    }

    if (!APPLY) {
      results.push({ scenario, id: "(none)", woNumber: "(none)", outcome: "WOULD_CREATE",
        detail: `${accountId} / ${equip.id} / ${snapshot.length} planned line(s)` });
      continue;
    }

    const created = await db.runTransaction(async (tx) => {
      const rec = await createWorkOrderRecord(db, tx, {
        customerId: accountId,
        locationId,
        priority: "NORMAL",
        type: "SERVICE",
        complaint: scenario.complaint,
        inventorySnapshot: snapshot,
      }, NOW_YEAR);
      // The content tag and the equipment link, written alongside the record the service created.
      tx.update(db.collection(WORK_ORDERS).doc(rec.id), {
        certScenarioTag: tag,
        equipmentId: equip.id,
      });
      return rec;
    });
    results.push({ scenario, id: created.id, woNumber: created.woNumber, outcome: "CREATED",
      detail: `${accountId} / ${equip.id}` });
  }

  console.log("\noutcomes:");
  for (const r of results) {
    console.log(`  ${r.outcome.padEnd(15)} ${(r.woNumber ?? "-").padEnd(16)} ${r.scenario.key.padEnd(26)} ${r.detail ?? ""}`);
  }
  const created = results.filter((r) => r.outcome === "CREATED").length;
  const already = results.filter((r) => r.outcome === "ALREADY_PRESENT").length;
  const failed = results.filter((r) => !["CREATED", "ALREADY_PRESENT", "WOULD_CREATE"].includes(r.outcome));
  console.log(`\ncreated ${created}, already present ${already}, failed ${failed.length}`);
  if (failed.length) {
    console.log("FAILURES:");
    for (const f of failed) console.log(`  ${f.scenario.key}: ${f.outcome} -- ${f.detail}`);
    process.exitCode = 1;
  }
  if (!APPLY) console.log("DRY RUN -- nothing written.");
}
