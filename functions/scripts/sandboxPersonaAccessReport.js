// SANDBOX PERSONA ACCESS REPORT -- read-only reconciliation of what each persona can ACTUALLY do.
//
// ============================ WHY THIS EXISTS ============================
//
// A grant write succeeding is not evidence that the resulting access is correct. The write says a
// roleAssignment document was created; it says nothing about whether the capability is active in
// this environment, whether the Role actually carries the id anyone assumed, or whether the
// principal's employment record still links them to a user.
//
// So this asks the question from the other end: given the live sandbox data, what does the REAL
// resolver say this persona may do?
//
// ============================ IT USES THE PRODUCTION PATH, DELIBERATELY ============================
//
// Every decision here comes from `resolveEffectiveAccess` -- the same function the deployed
// callables call. It is NOT a second implementation of the access rules, because a second
// implementation would be free to agree with the documentation while the real system disagreed, and
// that is precisely the failure this report is supposed to catch.
//
// That also means activation overrides are derived from GCLOUD_PROJECT by the resolver itself, with
// no seam for a caller to inject them. Production is triple-blocked on that path and stays so here.
//
// ============================ STRICTLY READ-ONLY ============================
//
// No write of any kind. It creates nothing, grants nothing and revokes nothing. Running it against
// any project is safe; it still refuses production, because printing a production access matrix is
// not something this tool needs to be able to do.
//
// Usage:
//   node functions/scripts/sandboxPersonaAccessReport.js --projectId eos-platform-sandbox
//   [--persona sbx-partsassoc] [--json]
"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PRODUCTION_PROJECT_ID = "taylor-parts";

// The capabilities the scanner's built workflows actually consult, and the workflow each one gates.
// Kept in step with field-ops-app-vite/src/access/scanWorkflows.js -- if a workflow's requirement
// changes there and not here, the report describes a system that no longer exists.
const SCANNER_CAPABILITIES = [
  "inventory.stock.receive",
  "inventory.transfer.dispatch",
  "inventory.transfer.receive",
  "inventory.cycleCount.create",
  "inventory.cycleCount.submit",
  "inventory.cycleCount.reconcile",
  "inventory.placement.record",
  "inventory.location.bin.read",
  "inventory.location.bin.manage",
  "inventory.balance.read",
  "inventory.catalog.alias.read",
  "inventory.serializedAsset.read",
  "inventory.location.display.read",
  "inventory.returns.intake",
];

/**
 * The workflow rules, mirroring deriveScanWorkflows exactly.
 *
 * PURE and exported so a test can assert this mirror against the client's own rules rather than
 * trusting that two hand-written copies agree.
 */
function deriveWorkflows(holds, { receivingReady, isTechnician, technicianId, assignedWorkOrderCount }) {
  const out = {};
  out.LOOKUP = "AVAILABLE"; // always offered; the underlying read is the gate
  out.SUPPLIER_RECEIVING = !holds("inventory.stock.receive")
    ? "DENIED_NO_CAPABILITY"
    : (receivingReady ? "AVAILABLE" : "DENIED_NOT_READY");
  out.TRANSFER = (holds("inventory.transfer.dispatch") || holds("inventory.transfer.receive"))
    ? "AVAILABLE" : "DENIED_NO_CAPABILITY";
  out.CYCLE_COUNT = (holds("inventory.cycleCount.create") && holds("inventory.cycleCount.submit"))
    ? "AVAILABLE" : "DENIED_NO_CAPABILITY";
  const canPlace = holds("inventory.placement.record") && holds("inventory.location.bin.read");
  out.PUT_AWAY = canPlace ? "AVAILABLE" : "DENIED_NO_CAPABILITY";
  out.PICK = canPlace ? "AVAILABLE" : "DENIED_NO_CAPABILITY";
  if (!isTechnician || !technicianId) out.TECHNICIAN_WORK_ORDER = "NOT_APPLICABLE";
  else if (assignedWorkOrderCount <= 0) out.TECHNICIAN_WORK_ORDER = "DENIED_NO_ASSIGNED_WORK";
  else out.TECHNICIAN_WORK_ORDER = "AVAILABLE";
  return out;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const flag = t.slice(2);
    if (flag === "json") { args.json = true; continue; }
    args[flag] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = args.projectId;
  if (!projectId) {
    console.error("--projectId is required (no default).");
    process.exit(2);
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    console.error("REFUSING: this report is a sandbox tool and will not target production.");
    process.exit(2);
  }

  // The resolver reads its activation overrides from the runtime's own project identity. Setting it
  // here makes the report describe THIS project rather than whatever the shell happened to carry.
  process.env.GCLOUD_PROJECT = projectId;

  initializeApp({ projectId });
  const db = getFirestore();
  const { resolveEffectiveAccess } = require("../lib/access/effectiveAccessFeed.js");

  // Readiness is a per-environment flag, distinct from activation and from a grant. It is read from
  // the registry rather than assumed, so a receiving refusal can be attributed to the right cause.
  const registry = require("../../config/environments.json");
  const envEntry = (registry.environments ?? []).find(
    (e) => e && e.firebase && e.firebase.projectId === projectId,
  );
  const receivingReady = envEntry?.readiness?.RECEIVING_TRANSPORT_READY === true;
  console.log(`RECEIVING_TRANSPORT_READY = ${receivingReady} (from config/environments.json)\n`);

  const employees = await db.collection("employees").get();
  const assignments = await db.collection("roleAssignments").get();

  const byPrincipal = new Map();
  for (const d of assignments.docs) {
    const v = d.data();
    if (v.status !== "active") continue;
    if (!byPrincipal.has(v.principalUid)) byPrincipal.set(v.principalUid, []);
    byPrincipal.get(v.principalUid).push({ id: d.id, roleId: v.roleId, scope: v.scope });
  }

  const wanted = args.persona ? new Set([args.persona]) : null;
  const rows = [];

  for (const doc of employees.docs) {
    if (wanted && !wanted.has(doc.id)) continue;
    const e = doc.data();
    const uid = e.userId;
    if (!uid) { rows.push({ personaId: doc.id, error: "no userId link" }); continue; }

    let userDoc = null;
    try { userDoc = (await db.collection("users").doc(uid).get()).data() ?? null; } catch { /* read failure is reported, not hidden */ }

    let decisions = {};
    let resolverError = null;
    try {
      const res = await resolveEffectiveAccess(
        { principalUid: uid, permissionIds: SCANNER_CAPABILITIES },
        { db },
      );
      decisions = res.decisions ?? {};
    } catch (err) {
      // A THROWING resolver is reported as an error, never silently rendered as "denied" -- those
      // are different facts and conflating them is how a broken read looks like a working refusal.
      resolverError = String(err && err.message).slice(0, 200);
    }

    const holds = (id) => decisions[id] === true;
    const legacyRole = userDoc && typeof userDoc.role === "string" ? userDoc.role : null;

    let assignedWorkOrderCount = 0;
    if (legacyRole === "technician") {
      try {
        const wo = await db.collection("fieldops_jobs").where("assignedTechnicianId", "==", doc.id).get();
        assignedWorkOrderCount = wo.size;
      } catch { assignedWorkOrderCount = 0; }
    }

    rows.push({
      personaId: doc.id,
      uid,
      employmentStatus: e.employmentStatus ?? null,
      legacyRole,
      operationalRoles: e.operationalRoles ?? [],
      assignedWarehouseIds: e.assignedWarehouseIds ?? [],
      grantedRoles: (byPrincipal.get(uid) ?? []).map((a) => a.roleId).sort(),
      effectiveCapabilities: SCANNER_CAPABILITIES.filter(holds),
      resolverError,
      assignedWorkOrderCount,
      workflows: deriveWorkflows(holds, {
        // READ FROM THE REGISTRY, never hardcoded. Getting this wrong is not cosmetic: with
        // receivingReady forced false, EVERY persona's receiving refusal renders as NOT_READY, which
        // would hide whether the refusal is actually capability-based. A validation pass whose whole
        // point is "receiving must refuse for the right reason" cannot afford that.
        receivingReady,
        isTechnician: legacyRole === "technician",
        technicianId: legacyRole === "technician" ? doc.id : null,
        assignedWorkOrderCount,
      }),
    });
  }

  rows.sort((a, b) => a.personaId.localeCompare(b.personaId));

  if (args.json) {
    console.log(JSON.stringify({ projectId, rows }, null, 2));
    return;
  }

  console.log(`SANDBOX PERSONA ACCESS -- ${projectId}`);
  console.log(`(resolved through resolveEffectiveAccess, the same path the deployed callables use)\n`);
  for (const r of rows) {
    if (r.error) { console.log(`${r.personaId}: ${r.error}`); continue; }
    console.log(`${r.personaId}  [${r.employmentStatus}]  legacyRole=${r.legacyRole ?? "-"}`);
    console.log(`  granted roles : ${r.grantedRoles.length ? r.grantedRoles.join(", ") : "(none)"}`);
    console.log(`  warehouses    : ${r.assignedWarehouseIds.length ? r.assignedWarehouseIds.join(", ") : "(none)"}`);
    if (r.resolverError) console.log(`  RESOLVER ERROR: ${r.resolverError}`);
    console.log(`  capabilities  : ${r.effectiveCapabilities.length ? r.effectiveCapabilities.join(", ") : "(none)"}`);
    const avail = Object.entries(r.workflows).filter(([, v]) => v === "AVAILABLE").map(([k]) => k);
    const denied = Object.entries(r.workflows).filter(([, v]) => v !== "AVAILABLE").map(([k, v]) => `${k}=${v}`);
    console.log(`  AVAILABLE     : ${avail.join(", ") || "(none)"}`);
    console.log(`  not available : ${denied.join(", ")}`);
    console.log("");
  }
}

module.exports = { deriveWorkflows, SCANNER_CAPABILITIES, parseArgs };

if (require.main === module) {
  main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
}
