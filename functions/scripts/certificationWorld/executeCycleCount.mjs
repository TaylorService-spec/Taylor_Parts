// CYCLE COUNTS — through the real command family, with real authorization.
//
// ============================ THE LIFECYCLE, AS THE DOMAIN DEFINES IT ============================
//
//   createCycleCount     (none)  -> OPEN         inventory.cycleCount.create
//   submitCycleCount     OPEN    -> COUNTED      inventory.cycleCount.submit
//   reconcileCycleCount  COUNTED -> RECONCILED   inventory.cycleCount.reconcile   APPROVE stages ADJUSTED
//                        COUNTED -> REJECTED                                       REJECT stages nothing
//   cancelCycleCount     OPEN    -> CANCELLED    inventory.cycleCount.cancel
//
// ============================ COUNTING IS NOT ADJUSTING ============================
//
// Submitting a count writes an observation and a variance and moves no stock. Inventory changes only
// at reconcile, and only on APPROVE. That separation is the entire reason cycle counts have two
// actors: the person who says what they saw is not the person who decides the books were wrong.
//
// REJECT stages no ledger evidence even when a variance exists -- rejecting a count says the count is
// not trusted as a correction, not that a correction should be applied in the other direction.
//
// ============================ TWO INDEPENDENT SOD MECHANISMS ============================
//
// 1. CAPABILITY. inventory.cycleCount.submit and .reconcile are carried by different governed Roles.
// 2. SELF-APPROVAL. Even holding both, an actor may not reconcile a MATERIAL variance they themselves
//    submitted -- reconcileCycleCount compares actor.id against the stored submittedBy and throws
//    CycleCountSelfApprovalError.
//
// The second exists because the first is not enough: capability separation is about job design, and
// a single person can legitimately hold both in a small business. Materiality is what makes the
// second bite -- |variance| >= 3 OR |variance| / expected >= 10%, configurable, failing closed to
// those defaults rather than to "never material".
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const {
  createCycleCountProduction, submitCycleCountProduction,
  reconcileCycleCountProduction, cancelCycleCountProduction,
} = await import(L("functions/lib/cycleCount/cycleCountCommandComposition.js"));
const { resolveCycleCountPartThroughTxn, stageCycleCountAuditEvent } =
  await import(L("functions/lib/cycleCount/cycleCountCallableWiring.js"));
const { isMaterialCycleCountVariance, resolveCycleCountMaterialityConfig } =
  await import(L("functions/lib/cycleCount/cycleCountMateriality.js"));
const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { loadPrincipalIndex, ENVIRONMENT_ACTIVATIONS } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const FIXED_NOW = new Date("2026-08-22T17:00:00.000Z");

export const MATERIALITY = resolveCycleCountMaterialityConfig();
export const isMaterial = (variance, expected) =>
  isMaterialCycleCountVariance(Math.abs(variance), expected, MATERIALITY);

/** The REAL resolver, with this environment's activation supplied. See executeTransfer for why. */
function makeCertResolver(db, capability) {
  return async function resolve(txn, actorId) {
    if (typeof actorId !== "string" || actorId.trim() === "") return false;
    const userSnap = await txn.get(db.collection("users").doc(actorId));
    const assignmentsSnap = await txn.get(
      db.collection("roleAssignments").where("principalUid", "==", actorId).where("status", "==", "active"),
    );
    const accessVersion = userSnap.exists ? (userSnap.data()?.accessVersion ?? 0) : 0;
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const out = resolveEffectivePermission({
      permissionId: capability, assignments, roles: ROLE_CATALOG,
      currentAccessVersion: accessVersion, target: GLOBAL_TARGET,
      activationOverrides: ENVIRONMENT_ACTIVATIONS,
    });
    return out.decision === "ALLOW";
  };
}

const ACTIONS = {
  create: { run: createCycleCountProduction, capability: "inventory.cycleCount.create" },
  submit: { run: submitCycleCountProduction, capability: "inventory.cycleCount.submit" },
  reconcile: { run: reconcileCycleCountProduction, capability: "inventory.cycleCount.reconcile" },
  cancel: { run: cancelCycleCountProduction, capability: "inventory.cycleCount.cancel" },
};

export async function cycleCountAs(db, employeeId, action, request) {
  const spec = ACTIONS[action];
  if (!spec) throw new Error(`unknown cycle count action ${action}`);
  const principalIndex = await loadPrincipalIndex(db);
  const uid = principalIndex.get(employeeId);
  if (!uid) throw new Error(`${employeeId} has no principal -- cannot act`);
  try {
    const outcome = await spec.run(request, {
      db,
      actor: { kind: "USER", id: uid },
      authorize: (txn, actorId) => makeCertResolver(db, spec.capability)(txn, actorId),
      resolvePart: (txn, partId) => resolveCycleCountPartThroughTxn(txn, db, partId),
      stageAudit: (txn, audit) => stageCycleCountAuditEvent(txn, audit),
      now: () => FIXED_NOW,
    });
    return { ok: true, action, actorEmployeeId: employeeId, actorUid: uid, outcome };
  } catch (err) {
    return {
      ok: false, action, actorEmployeeId: employeeId, actorUid: uid,
      code: err?.code ?? err?.constructor?.name ?? "?",
      message: err?.message ?? String(err),
    };
  }
}

export async function readCycleCount(db, cycleCountId) {
  const snap = await db.collection("cycle_counts").doc(cycleCountId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** On-hand at one location, summed exactly as the domain sums it. */
export async function onHandAt(db, partId, location) {
  const snap = await db.collection("inventory_transactions").where("partId", "==", partId).get();
  let onHand = 0;
  for (const doc of snap.docs) {
    const v = doc.data();
    if (v.location?.type !== location.type || v.location?.locationId !== location.locationId) continue;
    if (v.type === "RECEIVED" || v.type === "RETURNED" || v.type === "TRANSFER_IN") onHand += Number(v.quantity);
    else if (v.type === "TRANSFER_OUT" || v.type === "SCRAPPED") onHand -= Number(v.quantity);
    else if (v.type === "ADJUSTED") onHand += Number(v.quantity);
  }
  return onHand;
}

/**
 * Parts a Golden scenario depends on, and therefore parts a cycle count may not touch by default.
 *
 * Pass 3A learned this the hard way: a correct transfer of two units silently dismantled the only
 * FALSE_COMFORT scenario in the world, because the fixture picked its part by depth rather than by
 * checking what else depended on it. Counting is more dangerous still -- a reconciled variance
 * CHANGES the physical truth, so a count against a Golden part rewrites the evidence another
 * scenario is asserting.
 */
export async function protectedGoldenParts(db) {
  const parts = new Set();
  for (const d of (await db.collection("fieldops_wos").get()).docs) {
    for (const line of d.data().inventorySnapshot ?? []) parts.add(line.partId);
  }
  return parts;
}
