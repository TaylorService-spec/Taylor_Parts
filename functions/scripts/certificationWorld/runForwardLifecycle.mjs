#!/usr/bin/env node
// E01 / E02 — a machine the company already owns, placed at a customer, by two different people.
//
// ============================ THE CHAIN, END TO END ============================
//
//   acquire      inventory.serializedAsset.acquire   cw-emp-044 / cw-emp-045   no PO, no receipt
//     -> a serialized asset AVAILABLE at wh-main, company custody, no customer
//   install      equipment.install                   cw-emp-013 / cw-emp-017   different person
//     -> Equipment at the customer's location, the asset INSTALLED and linked
//
// E01 is Taylor, E02 is Ventana/Icetro, and they run the SAME code with no brand-specific branch.
// If either line needed special handling, the platform would have two lifecycles pretending to be
// one, and this is where that would show.
//
// ============================ WHO ACTS, AND WHY IT IS NOT AN ADMIN ============================
//
// Neither Admin, Owner, nor SYSTEM appears anywhere in this file as a domain actor. Acquiring stock
// and installing a machine at a customer are operational acts, and running them as an administrator
// would prove that an administrator can do anything -- which was never in doubt and is not what
// needs proving.
//
// The acquirer and the installer are DIFFERENT PEOPLE, and the run proves the separation the hard
// way: the acquirer is asked to install and refused, the installer is asked to acquire and refused.
// Both refusals are semantic, from the same resolver the commands themselves call.
//
// ============================ WHAT THIS DOES NOT DO ============================
//
// No purchase order. No receipt. No Equipment reassignment -- accountId and locationId are immutable
// after create, and nothing here pretends otherwise. No recovery: EQUIPMENT RECOVERY AUTHORITY GAP
// is open, and a unit installed by this run stays installed.
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

const { acquireSerializedAsset, SERIALIZED_ASSET_ACQUIRE_CAPABILITY, ACQUISITION_REASONS } =
  await import(L("functions/lib/serializedAsset/acquireSerializedAssetCommand.js"));
const { installSerializedAsset, EQUIPMENT_INSTALL_CAPABILITY } =
  await import(L("functions/lib/equipmentInstall/installSerializedAssetCommand.js"));
const { resolveAcquirePartThroughTxn, makeResolveAcquireLocationActive, stageAcquireAuditEvent } =
  await import(L("functions/lib/serializedAsset/acquireCallableWiring.js"));
const { stageInstallAuditEvent } =
  await import(L("functions/lib/equipmentInstall/installCallableWiring.js"));
const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { WHOLE_UNIT_PARTS } = await import(L("functions/scripts/certificationWorld/data/wholeUnitParts.mjs"));
const { SERIALIZED_EQUIPMENT_STATIONS } =
  await import(L("functions/scripts/certificationWorld/data/workforce.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const FIXED_NOW = new Date("2026-08-23T15:00:00.000Z");
const WH_ID = "wh-main";

const [ACQUIRER_A, ACQUIRER_B] = SERIALIZED_EQUIPMENT_STATIONS.inventorySerializedAssetAcquirer;
const [INSTALLER_A, INSTALLER_B] = SERIALIZED_EQUIPMENT_STATIONS.equipmentInstaller;

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};
const evidence = {};

/**
 * Authorization exactly as the callables resolve it: users/{uid}.accessVersion plus active
 * roleAssignments, through the real resolver, with the TARGET environment's activation set.
 *
 * One resolver for both commands and for the refusal probes. Two would be two answers to the same
 * question, and the SoD claim would rest on whichever one happened to be asked.
 */
function makeCertResolver(db) {
  return async function resolve(txn, actorId, capability) {
    if (typeof actorId !== "string" || actorId.trim() === "") return false;
    const userSnap = await txn.get(db.collection("users").doc(actorId));
    const assignmentsSnap = await txn.get(
      db.collection("roleAssignments").where("principalUid", "==", actorId).where("status", "==", "active"),
    );
    const accessVersion = userSnap.exists ? (userSnap.data()?.accessVersion ?? 0) : 0;
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return resolveEffectivePermission({
      permissionId: capability, assignments, roles: ROLE_CATALOG,
      currentAccessVersion: accessVersion, target: GLOBAL_TARGET,
      activationOverrides: currentActivations(),
    }).decision === "ALLOW";
  };
}

/** A decision without a transaction, for the refusal probes and the authority table. */
async function decideFor(db, employeeId, uid, capability) {
  const userSnap = await db.collection("users").doc(uid).get();
  const assignmentsSnap = await db.collection("roleAssignments")
    .where("principalUid", "==", uid).where("status", "==", "active").get();
  return resolveEffectivePermission({
    permissionId: capability,
    assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    roles: ROLE_CATALOG,
    currentAccessVersion: userSnap.exists ? (userSnap.data()?.accessVersion ?? 0) : 0,
    target: GLOBAL_TARGET,
    activationOverrides: currentActivations(),
  });
}

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
  const authorize = makeCertResolver(db);
  const resolveLocationActive = makeResolveAcquireLocationActive(db);
  const principals = await loadPrincipalIndex(db);
  const uidOf = (employeeId) => {
    const uid = principals.get(employeeId);
    if (!uid) throw new Error(`${employeeId} has no principal -- the employee/principal link is broken`);
    return uid;
  };

  const acquireAs = async (employeeId, request) => {
    const uid = uidOf(employeeId);
    try {
      const outcome = await acquireSerializedAsset(request, {
        db, actor: { kind: "USER", id: uid }, authorize,
        resolvePart: (txn, partId) => resolveAcquirePartThroughTxn(txn, db, partId),
        resolveLocationActive, stageAudit: stageAcquireAuditEvent, now: () => FIXED_NOW,
      });
      return { ok: true, employeeId, uid, outcome };
    } catch (err) {
      return { ok: false, employeeId, uid, code: err?.code ?? err?.constructor?.name ?? "?", message: err?.message ?? String(err) };
    }
  };

  const installAs = async (employeeId, request) => {
    const uid = uidOf(employeeId);
    try {
      const outcome = await installSerializedAsset(request, {
        db, actor: { kind: "USER", id: uid }, authorize,
        stageAudit: stageInstallAuditEvent, now: () => FIXED_NOW,
      });
      return { ok: true, employeeId, uid, outcome };
    } catch (err) {
      return { ok: false, employeeId, uid, code: err?.code ?? err?.constructor?.name ?? "?", message: err?.message ?? String(err) };
    }
  };

  // ── AUTHORITY, BEFORE ANYTHING IS WRITTEN ────────────────────────────────────────────────────
  //
  // Resolved against the live records rather than the Role catalog. A grant that exists in the
  // catalog and not in roleAssignments would let every scenario below fail for a reason nobody
  // could see, and "the fixture says he can" is not the claim being made.
  console.log("\n-- authority");
  const authority = [];
  for (const employeeId of [ACQUIRER_A, ACQUIRER_B, INSTALLER_A, INSTALLER_B]) {
    const uid = uidOf(employeeId);
    const acquire = await decideFor(db, employeeId, uid, SERIALIZED_ASSET_ACQUIRE_CAPABILITY);
    const install = await decideFor(db, employeeId, uid, EQUIPMENT_INSTALL_CAPABILITY);
    authority.push({ employeeId, uid, acquire: acquire.decision, acquireReason: acquire.reason ?? null,
      install: install.decision, installReason: install.reason ?? null });
    console.log(`  ${employeeId}  acquire=${acquire.decision.padEnd(5)} install=${install.decision}`);
  }
  evidence.authority = authority;

  const acquirers = authority.filter((a) => [ACQUIRER_A, ACQUIRER_B].includes(a.employeeId));
  const installers = authority.filter((a) => [INSTALLER_A, INSTALLER_B].includes(a.employeeId));
  check("acquirers may acquire", acquirers.every((a) => a.acquire === "ALLOW"));
  check("acquirers may NOT install", acquirers.every((a) => a.install === "DENY"),
    acquirers.map((a) => a.installReason).join(","));
  check("installers may install", installers.every((a) => a.install === "ALLOW"));
  check("installers may NOT acquire", installers.every((a) => a.acquire === "DENY"),
    installers.map((a) => a.acquireReason).join(","));
  // The REASON separates two very different worlds. `inactivePermission` would mean the environment
  // simply had not turned the capability on -- a denial that says nothing about who this person is.
  check("the refusals are about the PERSON, not about activation",
    [...acquirers.map((a) => a.installReason), ...installers.map((a) => a.acquireReason)]
      .every((r) => r === "noQualifyingGrant"));

  // ── PICK A CUSTOMER PER LINE, FROM THE WORLD ─────────────────────────────────────────────────
  const pickTarget = async (lineOfBusiness) => {
    const accounts = await db.collection("accounts")
      .where("lineOfBusiness", "==", lineOfBusiness).where("status", "==", "ACTIVE").get();
    for (const account of accounts.docs) {
      const locations = await db.collection("locations").where("accountId", "==", account.id).get();
      if (locations.size > 0) return { accountId: account.id, accountName: account.data().name, locationId: locations.docs[0].id };
    }
    throw new Error(`no ACTIVE ${lineOfBusiness} account with a location`);
  };

  const SCENARIOS = [
    { id: "E01", line: "TAYLOR", part: WHOLE_UNIT_PARTS.find((p) => p.lineOfBusiness === "TAYLOR"),
      acquirer: ACQUIRER_A, installer: INSTALLER_A, serial: "CW-E01-000001" },
    { id: "E02", line: "VENTANA", part: WHOLE_UNIT_PARTS.find((p) => p.lineOfBusiness === "VENTANA"),
      acquirer: ACQUIRER_B, installer: INSTALLER_B, serial: "CW-E02-000001" },
  ];

  evidence.scenarios = {};
  for (const s of SCENARIOS) {
    console.log(`\n-- ${s.id} ${s.line}: ${s.part.name} (${s.part.partId})`);
    const target = await pickTarget(s.line);
    console.log(`  customer: ${target.accountName} (${target.accountId}) at ${target.locationId}`);

    // 1. ACQUIRE. No purchase order anywhere in the request -- the command refuses one outright.
    const acquired = await acquireAs(s.acquirer, {
      partId: s.part.partId, serialNo: s.serial, locationId: WH_ID,
      reason: ACQUISITION_REASONS[0],
      provenanceNote: `${s.id} certification: unit already owned before EOS`,
      idempotencyKey: `${s.id}-acquire-1`,
    });
    check(`${s.id} acquired without a purchase order`, acquired.ok,
      acquired.ok ? `${acquired.outcome.serializedAssetId} ${acquired.outcome.state}` : `${acquired.code}: ${acquired.message}`);
    if (!acquired.ok) { evidence.scenarios[s.id] = { acquired }; continue; }

    const assetId = acquired.outcome.serializedAssetId;
    const beforeSnap = await db.collection("serialized_assets").doc(assetId).get();
    const before = beforeSnap.data() ?? {};
    check(`${s.id} the acquired unit is AVAILABLE, in company custody, with no customer`,
      before.inventoryState === "AVAILABLE" && before.currentEquipmentId === null
        && before.currentLocationId === WH_ID && before.ownership === "COMPANY",
      `${before.inventoryState} @ ${before.currentLocationId} (${before.ownership})`);
    check(`${s.id} it carries NO receiving provenance -- it never arrived on a receipt`,
      before.activatedByReceivingId === undefined || before.activatedByReceivingId === null,
      `acquisitionReason=${before.acquisitionReason}`);

    // 2. THE ACQUIRER TRIES TO INSTALL IT. The whole reason the stations are separate.
    const acquirerInstall = await installAs(s.acquirer, {
      serializedAssetId: assetId, accountId: target.accountId, locationId: target.locationId,
      name: `${s.part.name} (${s.serial})`, idempotencyKey: `${s.id}-install-by-acquirer`,
    });
    check(`${s.id} the ACQUIRER cannot install what they acquired`,
      !acquirerInstall.ok && acquirerInstall.code === "PERMISSION_DENIED",
      acquirerInstall.ok ? "IT SUCCEEDED -- separation of duties is not enforced" : acquirerInstall.code);

    // 3. INSTALL, by the other person.
    const installed = await installAs(s.installer, {
      serializedAssetId: assetId, accountId: target.accountId, locationId: target.locationId,
      name: `${s.part.name} (${s.serial})`,
      installedDate: "2026-08-23", assetTag: `AT-${s.id}`,
      idempotencyKey: `${s.id}-install-1`,
    });
    check(`${s.id} installed at the customer by a different person`, installed.ok,
      installed.ok ? installed.outcome.equipmentId : `${installed.code}: ${installed.message}`);
    if (!installed.ok) { evidence.scenarios[s.id] = { acquired, acquirerInstall, installed }; continue; }

    // 4. WHAT SURVIVED. Read back from the database, not from the command's return value.
    const equipmentSnap = await db.collection("equipment").doc(installed.outcome.equipmentId).get();
    const equipment = equipmentSnap.data() ?? {};
    const afterSnap = await db.collection("serialized_assets").doc(assetId).get();
    const after = afterSnap.data() ?? {};

    check(`${s.id} the serial survived acquisition and install unchanged`,
      after.serialNo === s.serial && equipment.serialNumber === s.serial,
      `${after.serialNo} / ${equipment.serialNumber}`);
    check(`${s.id} Equipment carries the whole-unit Part and the asset it came from`,
      equipment.partId === s.part.partId && equipment.serializedAssetId === assetId,
      `${equipment.partId}`);
    check(`${s.id} INSTALLED means linked -- the invariant holds in both directions`,
      after.inventoryState === "INSTALLED" && after.currentEquipmentId === installed.outcome.equipmentId,
      `${after.inventoryState} -> ${after.currentEquipmentId}`);
    check(`${s.id} Equipment is at the customer, not in the warehouse`,
      equipment.accountId === target.accountId && equipment.locationId === target.locationId);
    check(`${s.id} the warehouse it left is recorded`, equipment.installedFromLocationId === WH_ID,
      String(equipment.installedFromLocationId));

    // OBSERVED, AND RECORDED RATHER THAN ASSERTED AWAY.
    //
    // Install does NOT move the asset's `currentLocationId`. An INSTALLED unit still names the
    // warehouse it left, and `installedFromLocationId` on the Equipment carries the same fact.
    //
    // Harmless today because every consumer that counts stock also filters on inventoryState --
    // cycleCountExpectedQuantity requires `currentLocationId === origin AND state === AVAILABLE`, so
    // an installed unit is excluded by the state, not by the location. But a future reader that
    // queries currentLocationId ALONE would count a machine sitting at a customer as warehouse
    // stock, so the behaviour is pinned here rather than left to be rediscovered.
    check(`${s.id} an INSTALLED unit still names its pre-install warehouse (observed, state-guarded)`,
      after.currentLocationId === WH_ID && after.inventoryState === "INSTALLED",
      `currentLocationId=${after.currentLocationId} state=${after.inventoryState}`);

    // 5. IDEMPOTENCY, and the conflict that must not be mistaken for it.
    const replay = await installAs(s.installer, {
      serializedAssetId: assetId, accountId: target.accountId, locationId: target.locationId,
      name: `${s.part.name} (${s.serial})`,
      installedDate: "2026-08-23", assetTag: `AT-${s.id}`,
      idempotencyKey: `${s.id}-install-1`,
    });
    check(`${s.id} replaying the same install is a replay, not a second machine`,
      replay.ok && replay.outcome.outcome === "replayed" && replay.outcome.equipmentId === installed.outcome.equipmentId,
      replay.ok ? replay.outcome.outcome : `${replay.code}`);

    const doubleInstall = await installAs(s.installer, {
      serializedAssetId: assetId, accountId: target.accountId, locationId: target.locationId,
      name: `${s.part.name} (${s.serial}) second attempt`, idempotencyKey: `${s.id}-install-2`,
    });
    check(`${s.id} installing the SAME unit twice at a new key is refused`,
      !doubleInstall.ok && doubleInstall.code === "ALREADY_INSTALLED",
      doubleInstall.ok ? "IT SUCCEEDED -- one machine is now two Equipment records" : doubleInstall.code);

    const acquireAgain = await acquireAs(s.acquirer, {
      partId: s.part.partId, serialNo: s.serial, locationId: WH_ID,
      reason: ACQUISITION_REASONS[0],
      provenanceNote: `${s.id} certification: unit already owned before EOS`,
      idempotencyKey: `${s.id}-acquire-1`,
    });
    check(`${s.id} re-acquiring the installed unit replays rather than resurrecting it`,
      acquireAgain.ok && acquireAgain.outcome.outcome === "replayed",
      acquireAgain.ok ? acquireAgain.outcome.outcome : `${acquireAgain.code}: ${acquireAgain.message}`);
    const stillInstalled = (await db.collection("serialized_assets").doc(assetId).get()).data() ?? {};
    check(`${s.id} ...and the replay did NOT move it back to AVAILABLE`,
      stillInstalled.inventoryState === "INSTALLED" && stillInstalled.currentEquipmentId === installed.outcome.equipmentId,
      stillInstalled.inventoryState);

    evidence.scenarios[s.id] = {
      line: s.line, partId: s.part.partId, serial: s.serial,
      acquirer: { employeeId: s.acquirer, uid: acquired.uid },
      installer: { employeeId: s.installer, uid: installed.uid },
      serializedAssetId: assetId,
      equipmentId: installed.outcome.equipmentId,
      account: target.accountId, location: target.locationId,
      acquirerInstallRefusal: acquirerInstall.code,
      doubleInstallRefusal: doubleInstall.code,
      stateAfter: stillInstalled.inventoryState,
    };
  }

  // ── THE SAME CODE RAN FOR BOTH LINES ─────────────────────────────────────────────────────────
  const e01 = evidence.scenarios.E01, e02 = evidence.scenarios.E02;
  check("Taylor and Ventana used the SAME authority, with no brand-specific path",
    Boolean(e01?.equipmentId && e02?.equipmentId),
    "both lines produced Equipment through one command");
  check("the two scenarios used DIFFERENT people on both sides",
    e01?.acquirer.employeeId !== e02?.acquirer.employeeId && e01?.installer.employeeId !== e02?.installer.employeeId);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "forward-lifecycle-e01-e02.json");
  fs.writeFileSync(file, JSON.stringify({
    target: __target.projectId, results, ...evidence,
    generatedFrom: "runForwardLifecycle.mjs",
  }, null, 2) + "\n");
  console.log(`evidence: ${path.relative(REPO, file)}`);
  if (passed !== results.length) process.exitCode = 1;
}
