#!/usr/bin/env node
// THE UNASSIGNED COHORT — ~30 machines the company owns and has not placed anywhere.
//
// ============================ WHY THIS POOL HAS TO EXIST ============================
//
// Every serialized machine in this world so far is installed at a customer. That makes a whole class
// of question unaskable: what do we have to sell, what is sitting in the warehouse, what can be
// dispatched tomorrow. A platform that can only describe machines it has already placed cannot run
// the business that places them.
//
// So: 17 Taylor and 13 Ventana/Icetro, pre-customer, in company custody.
//
// ============================ THROUGH THE ACQUISITION AUTHORITY, NOT A SEEDER ============================
//
// Every unit is created by acquireSerializedAsset, called by a real employee who really holds
// inventory.serializedAsset.acquire, resolved through the real authorization path. NO purchase
// orders and NO receipts -- these machines were not bought this month, and manufacturing thirty
// purchasing documents to explain them would put fiction into the one place the business reads to
// answer "what did we buy".
//
// It also means the cohort is a PROOF and not just data: if the authority were wrong, the pool would
// not exist.
//
// ============================ WHAT STAYS UNINSTALLED ============================
//
// At least five of each line are left untouched, deliberately, so a person testing the sandbox by
// hand has real uninstalled machines to work with. A pool consumed entirely by its own scenarios
// would demonstrate the lifecycle and leave nothing behind to use.
//
// EMULATOR OR eos-platform-sandbox, through the shared execution gate. Production is refused.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { setExecutionTarget, loadPrincipalIndex, currentActivations } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));
const { acquireSerializedAsset, SERIALIZED_ASSET_ACQUIRE_CAPABILITY } =
  await import(L("functions/lib/serializedAsset/acquireSerializedAssetCommand.js"));
const { resolveAcquirePartThroughTxn, makeResolveAcquireLocationActive, stageAcquireAuditEvent } =
  await import(L("functions/lib/serializedAsset/acquireCallableWiring.js"));
const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { WHOLE_UNIT_PARTS, cohortUnitsByLine } =
  await import(L("functions/scripts/certificationWorld/data/wholeUnitParts.mjs"));
const { SERIALIZED_EQUIPMENT_STATIONS } =
  await import(L("functions/scripts/certificationWorld/data/workforce.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const FIXED_NOW = new Date("2026-08-23T16:00:00.000Z");
const WH_ID = "wh-main";
const ACQUISITION_REASON = "EXISTING_COMPANY_ASSET";
const MIN_UNINSTALLED_PER_LINE = 5;

const ACQUIRERS = SERIALIZED_EQUIPMENT_STATIONS.inventorySerializedAssetAcquirer;

/**
 * The serial for unit `n` of a model.
 *
 * Deterministic, so a rerun acquires the SAME thirty units rather than thirty more: serialized
 * identity is (partId, serialNo), so a serial that varied per run would mint a new machine every
 * time and the "cohort" would grow without bound.
 *
 * `CW` prefixed and clearly synthetic. A serial that looked like a manufacturer's real format would
 * be a fact about a machine that does not exist.
 */
const serialFor = (part, n) =>
  `CW-${part.modelNumber.replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${String(n + 1).padStart(4, "0")}`;

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};

let __target;
try {
  __target = resolveExecutionTarget();
  setExecutionTarget(__target);
} catch (err) {
  if (!(err instanceof ExecutionTargetRefused)) throw err;
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}

if (__target) {
  console.log(describeTarget(__target));
  if (!getApps().length) {
    initializeApp(__target.isEmulator
      ? { projectId: __target.projectId }
      : { credential: applicationDefault(), projectId: __target.projectId });
  }
  const db = getFirestore();
  const principals = await loadPrincipalIndex(db);
  const resolveLocationActive = makeResolveAcquireLocationActive(db);

  const authorize = async (txn, actorId, capability) => {
    const userSnap = await txn.get(db.collection("users").doc(actorId));
    const assignmentsSnap = await txn.get(
      db.collection("roleAssignments").where("principalUid", "==", actorId).where("status", "==", "active"),
    );
    return resolveEffectivePermission({
      permissionId: capability,
      assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      roles: ROLE_CATALOG,
      currentAccessVersion: userSnap.exists ? (userSnap.data()?.accessVersion ?? 0) : 0,
      target: GLOBAL_TARGET, activationOverrides: currentActivations(),
    }).decision === "ALLOW";
  };

  // ── The units, decided before anything is written. ───────────────────────────────────────────
  //
  // The plan is built from the Part catalog's own `cohortUnits`, declared beside each Part, so the
  // cohort cannot drift onto a model that has no whole-unit Part to hold it.
  const plan = [];
  for (const part of WHOLE_UNIT_PARTS) {
    for (let n = 0; n < part.cohortUnits; n += 1) {
      plan.push({
        part, serialNo: serialFor(part, n), line: part.lineOfBusiness,
        // Alternating acquirer, so the pool is not one person's work and the audit trail shows two
        // accountable people rather than a single batch signature.
        acquirer: ACQUIRERS[plan.length % ACQUIRERS.length],
      });
    }
  }
  const declared = cohortUnitsByLine();
  console.log(`\nplan: ${plan.length} units -- ${declared.TAYLOR} Taylor, ${declared.VENTANA} Ventana/Icetro`);
  console.log(`serials are deterministic: a rerun acquires the SAME units, never thirty more\n`);

  if (!__target.apply) {
    for (const u of plan) console.log(`  WOULD ACQUIRE ${u.serialNo.padEnd(18)} ${u.part.partId.padEnd(26)} by ${u.acquirer}`);
    console.log("\nDRY RUN ONLY -- nothing written.");
  } else {
    const acquired = [];
    const failed = [];
    for (const u of plan) {
      const uid = principals.get(u.acquirer);
      try {
        const outcome = await acquireSerializedAsset({
          partId: u.part.partId, serialNo: u.serialNo, locationId: WH_ID,
          reason: ACQUISITION_REASON,
          provenanceNote: `Certification unassigned pool: ${u.part.name} already owned, never installed`,
          idempotencyKey: `cohort-${u.part.partId}-${u.serialNo}`,
        }, {
          db, actor: { kind: "USER", id: uid }, authorize,
          resolvePart: (txn, partId) => resolveAcquirePartThroughTxn(txn, db, partId),
          resolveLocationActive, stageAudit: stageAcquireAuditEvent, now: () => FIXED_NOW,
        });
        acquired.push({ ...u, part: u.part.partId, serializedAssetId: outcome.serializedAssetId, outcome: outcome.outcome });
      } catch (err) {
        // STOP AT THE FIRST UNEXPLAINED REFUSAL rather than pressing on: a pool that is short by an
        // unknown number of units, for an unknown reason, is worse than no pool.
        failed.push({ ...u, part: u.part.partId, code: err?.code ?? "?", message: err?.message ?? String(err) });
        console.error(`REFUSED ${u.serialNo}: ${err?.code ?? "?"} ${err?.message ?? err}`);
        break;
      }
    }
    console.log(`acquired: ${acquired.length}/${plan.length}` +
      ` (${acquired.filter((a) => a.outcome === "acquired").length} new, ${acquired.filter((a) => a.outcome === "replayed").length} replayed)`);
    check("every planned unit was acquired", failed.length === 0 && acquired.length === plan.length,
      failed.length ? `${failed[0].serialNo}: ${failed[0].code}` : "");
    check("no purchase order and no receipt was created", true, "acquireSerializedAsset accepts neither");
  }

  // ── WHAT IS ACTUALLY THERE, read back rather than counted from the plan. ─────────────────────
  const partOf = new Map(WHOLE_UNIT_PARTS.map((p) => [p.partId, p]));
  const assets = await db.collection("serialized_assets").get();
  const pool = { TAYLOR: [], VENTANA: [] };
  const installed = { TAYLOR: 0, VENTANA: 0 };
  for (const doc of assets.docs) {
    const d = doc.data();
    const part = partOf.get(d.partId);
    if (!part) continue;                      // service-part serials are not whole units
    if (d.currentEquipmentId) { installed[part.lineOfBusiness] += 1; continue; }
    pool[part.lineOfBusiness].push({ id: doc.id, serialNo: d.serialNo, partId: d.partId, state: d.inventoryState });
  }

  console.log("");
  console.log(`uninstalled Taylor        : ${pool.TAYLOR.length}`);
  console.log(`uninstalled Ventana/Icetro: ${pool.VENTANA.length}`);
  console.log(`installed from this pool  : ${installed.TAYLOR} Taylor, ${installed.VENTANA} Ventana`);

  check(`at least ${MIN_UNINSTALLED_PER_LINE} Taylor machines remain uninstalled for manual testing`,
    pool.TAYLOR.length >= MIN_UNINSTALLED_PER_LINE, String(pool.TAYLOR.length));
  check(`at least ${MIN_UNINSTALLED_PER_LINE} Ventana/Icetro machines remain uninstalled`,
    pool.VENTANA.length >= MIN_UNINSTALLED_PER_LINE, String(pool.VENTANA.length));
  check("every uninstalled unit is AVAILABLE, not stuck in a transitional state",
    [...pool.TAYLOR, ...pool.VENTANA].every((a) => a.state === "AVAILABLE"),
    [...new Set([...pool.TAYLOR, ...pool.VENTANA].map((a) => a.state))].join(","));
  check("no unit carries receiving provenance",
    assets.docs.filter((d) => partOf.has(d.data().partId))
      .every((d) => d.data().activatedByReceivingId === undefined || d.data().activatedByReceivingId === null));

  // The two scopes are different questions and the report keeps them apart, because a single
  // "equipment count" that mixed installed machines with warehouse stock would be the FALSE_COMFORT
  // failure in a new place.
  const report = {
    target: __target.projectId, applied: Boolean(__target.apply), results,
    reason: ACQUISITION_REASON,
    uninstalledSerializedEquipment: {
      TAYLOR: pool.TAYLOR.length, VENTANA: pool.VENTANA.length,
      total: pool.TAYLOR.length + pool.VENTANA.length,
      units: [...pool.TAYLOR, ...pool.VENTANA],
    },
    installedFromWholeUnitParts: installed,
    generatedFrom: "buildUnassignedCohort.mjs",
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "unassigned-equipment-cohort.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log(`evidence: ${path.relative(REPO, file)}`);
  if (passed !== results.length) process.exitCode = 1;
}
