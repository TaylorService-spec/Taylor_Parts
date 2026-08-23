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
// EMULATOR OR eos-platform-sandbox, through the shared execution gate. Production is refused.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { setExecutionTarget } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const { DEMAND_SCENARIOS, accountIdFor, scenarioTag } =
  await import(L("functions/scripts/certificationWorld/data/demandPlan.mjs"));
const { createWorkOrderRecord } = await import(L("functions/lib/createWorkOrder.js"));
const { applyPartsPlan } = await import(L("functions/lib/workOrderPartsPlan/setWorkOrderPartsPlan.js"));

const WORK_ORDERS = "fieldops_wos";
const APPLY = process.argv.includes("--apply");
/** Pinned so a rebuild allocates the same WO-year sequence. */
const NOW_YEAR = 2026;

// THE ONE GATE. Emulator and eos-platform-sandbox only; production refused two ways; a live
// write additionally requires --apply-live-sandbox. See executionTarget.mjs.
let __target;
try {
  __target = resolveExecutionTarget();
  setExecutionTarget(__target);
} catch (err) {
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}
if (!__target) {
  // refused above
} else {
  console.log(describeTarget(__target));
  // Credentials follow the TARGET, not a hardcoded project. An emulator needs none; a live
  // project needs application-default credentials, and naming the project explicitly means the
  // app cannot silently initialize against whatever ADC happens to prefer.
  if (!getApps().length) {
    initializeApp(__target.isEmulator
      ? { projectId: __target.projectId }
      : { credential: applicationDefault(), projectId: __target.projectId });
  }
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
    // WHICH unit, not just which customer.
    //
    // Every scenario used to take the account's first equipment, which was right while each one had
    // its own customer. Two scenarios that need to differ -- a customer with several machines in
    // service, versus ONE machine that keeps coming back -- are indistinguishable if both always
    // land on the same unit. `equipmentOffset` is how a scenario says which it means.
    const equipSnap = await db.collection("equipment").where("accountId", "==", accountId).get();
    if (equipSnap.empty) {
      results.push({ scenario, outcome: "NO_EQUIPMENT", detail: `${accountId} owns no equipment` });
      continue;
    }
    const ordered = equipSnap.docs.slice().sort((a, b) => a.id.localeCompare(b.id));
    const offset = scenario.equipmentOffset ?? 0;
    if (offset >= ordered.length) {
      results.push({ scenario, outcome: "NO_EQUIPMENT",
        detail: `${accountId} owns ${ordered.length} unit(s); scenario wants #${offset + 1}` });
      continue;
    }
    const equip = ordered[offset];
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
