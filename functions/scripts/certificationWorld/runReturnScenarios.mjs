#!/usr/bin/env node
// R01–R04 and G08 — returns, through the real intake command, with real authorization.
//
// ============================ WHAT EXISTS, AND WHAT HONESTLY DOES NOT ============================
//
//   R01 intake                   IMPLEMENTED
//   R02 awaiting disposition     IMPLEMENTED -- it is the ONLY state a return can be in
//   R03 restockable disposition  NOT SUPPORTED. No disposition command exists.
//   R04 non-restock / reject     NOT SUPPORTED. Same reason.
//
// That is not a half-built feature. The module says so directly: intake and disposition are separate
// authorities, and "none of those decisions exists yet". A return sits AWAITING_DISPOSITION until
// somebody builds the second half, and the second half is a business decision nobody has made.
//
// ============================ THE INVARIANT THIS PASS EXISTS TO PROVE ============================
//
// A RETURN MUST NOT AUTOMATICALLY RESTORE INVENTORY TO SELLABLE STOCK (DECISIONS #118).
//
// The command writes a return record and NO LEDGER EVENT. `RETURNED` is a schema-legal movement type
// that nothing in this platform writes, and that is deliberate: writing one at intake would BE the
// automatic restock #118 forbids.
//
// The capability is its own -- inventory.returns.intake, NOT inventory.stock.receive. Receiving
// accepts stock INTO sellable inventory, which is exactly what a return must not do; reusing it
// would make every returns clerk a receiver and put intake behind an authority whose whole meaning
// is the forbidden thing.
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
const { setExecutionTarget } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const { recordReturnIntake, RETURNS_COLLECTION, RETURN_STATES, RETURN_CONDITIONS, RETURN_SOURCES,
  RETURN_INTAKE_CAPABILITY, deriveReturnId } =
  await import(L("functions/lib/inventoryReturns/returnIntakeCommand.js"));
const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { loadPrincipalIndex, resolveCapability, currentActivations } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));
const { allLedgerRows, signedQuantity, warehouseByPart, mobileByPart } =
  await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));
const { CERT_PARTS } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };
const FIXED_NOW = new Date("2026-08-22T18:00:00.000Z");
const WH_ID = "wh-main";

/** Proven holders of inventory.returns.intake. */
const INTAKE_CLERKS = ["cw-emp-029", "cw-emp-044"];
/** A real employee doing a nearby job who does NOT hold it. */
const NO_AUTHORITY = "cw-emp-025";

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };
const evidence = {};

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
      activationOverrides: currentActivations(),
    });
    return out.decision === "ALLOW";
  };
}

async function intakeAs(db, employeeId, request) {
  const principalIndex = await loadPrincipalIndex(db);
  const uid = principalIndex.get(employeeId);
  if (!uid) throw new Error(`${employeeId} has no principal`);
  try {
    const outcome = await recordReturnIntake(request, {
      db,
      actor: { kind: "USER", id: uid },
      authorize: (txn, actorId, capability) => makeCertResolver(db, capability)(txn, actorId),
      now: () => FIXED_NOW,
    });
    return { ok: true, actorEmployeeId: employeeId, actorUid: uid, outcome };
  } catch (err) {
    return { ok: false, actorEmployeeId: employeeId, actorUid: uid,
      code: err?.code ?? err?.constructor?.name ?? "?", message: err?.message ?? String(err) };
  }
}

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
  const principalIndex = await loadPrincipalIndex(db);

  const scopes = async (partId) => {
    const rows = await allLedgerRows(db);
    const warehouse = warehouseByPart(rows, new Set([WH_ID])).get(partId) ?? 0;
    const mobile = mobileByPart(rows).get(partId) ?? 0;
    return { warehouseAvailable: warehouse, mobileInventory: mobile, companyOwned: warehouse + mobile };
  };

  console.log(`states: ${RETURN_STATES.join(", ")}`);
  console.log(`conditions: ${RETURN_CONDITIONS.join(", ")}`);
  console.log(`sources: ${RETURN_SOURCES.join(", ")}\n`);

  // ── The implemented surface, classified from the code rather than from a roadmap ──────────────
  evidence.contract = {
    intake: "IMPLEMENTED",
    awaitingDisposition: "IMPLEMENTED (the only state a return can hold)",
    restockableDisposition: "NOT_SUPPORTED_BY_CURRENT_RUNTIME",
    nonRestockDisposition: "NOT_SUPPORTED_BY_CURRENT_RUNTIME",
    states: [...RETURN_STATES],
    ledgerEffectAtIntake: "none, by design (DECISIONS #118)",
    capability: RETURN_INTAKE_CAPABILITY,
  };
  check("the ONLY return state is AWAITING_DISPOSITION", RETURN_STATES.length === 1 && RETURN_STATES[0] === "AWAITING_DISPOSITION",
    RETURN_STATES.join(", "));
  check("UNKNOWN is a first-class condition, not a fallback", RETURN_CONDITIONS.includes("UNKNOWN"),
    "a sealed carton's contents genuinely are unknown at the dock");

  // ── AUTHORITY ─────────────────────────────────────────────────────────────────────────────────
  console.log("-- authority");
  for (const e of INTAKE_CLERKS) {
    const cap = await resolveCapability(db, principalIndex, e, RETURN_INTAKE_CAPABILITY);
    check(`${e} holds ${RETURN_INTAKE_CAPABILITY}`, cap.allowed, `${cap.decision} via ${cap.roles.join("/")}`);
  }
  const receiveCap = await resolveCapability(db, principalIndex, INTAKE_CLERKS[0], "inventory.stock.receive");
  check("returns intake is a SEPARATE capability from receiving",
    RETURN_INTAKE_CAPABILITY !== "inventory.stock.receive",
    `${INTAKE_CLERKS[0]} happens to hold receive too (${receiveCap.decision}); the point is that intake does not REQUIRE it`);

  // ── SELECTION GUARD ───────────────────────────────────────────────────────────────────────────
  const goldenParts = new Set();
  for (const d of (await db.collection("fieldops_wos").get()).docs) {
    for (const line of d.data().inventorySnapshot ?? []) goldenParts.add(line.partId);
  }
  const countedParts = new Set((await db.collection("cycle_counts").get()).docs.map((d) => d.data().partId));
  const candidate = CERT_PARTS.find((p) => p.ledgerTrackingMode === "NONE"
    && !goldenParts.has(p.partId) && !countedParts.has(p.partId));
  check("a non-Golden, un-counted part is available for the return", Boolean(candidate),
    candidate ? candidate.partId : "none");

  if (!candidate) { process.exitCode = 1; }
  else {
    const PART = candidate.partId;

    // ── NEGATIVE AUTHORIZATION, FIRST ───────────────────────────────────────────────────────────
    console.log("\n-- an employee without return authority");
    const denied = await intakeAs(db, NO_AUTHORITY, {
      partId: PART, quantity: 1, source: "CUSTOMER", condition: "UNOPENED",
      idempotencyKey: "cw-r-denied-no-authority",
    });
    check(`${NO_AUTHORITY} is REFUSED return intake`, !denied.ok, denied.ok ? "ACCEPTED" : `${denied.code}: ${denied.message}`);
    const strayDoc = await db.collection(RETURNS_COLLECTION).doc(deriveReturnId("cw-r-denied-no-authority")).get();
    check("the refused attempt wrote no return record", !strayDoc.exists, strayDoc.exists ? "a record exists" : "none");
    evidence.authorization = { deniedEmployee: NO_AUTHORITY, code: denied.code };

    // ── R01 — INTAKE ────────────────────────────────────────────────────────────────────────────
    console.log("\n== R01  return intake");
    const before = await scopes(PART);
    const ledgerBefore = (await allLedgerRows(db)).length;
    console.log(`   before: warehouseAvailable ${before.warehouseAvailable}, mobileInventory ${before.mobileInventory}, companyOwned ${before.companyOwned}`);

    const clerk = INTAKE_CLERKS[1];
    const intake = await intakeAs(db, clerk, {
      partId: PART, quantity: 4, source: "WORK_ORDER", condition: "UNOPENED",
      reason: "Parts drawn for a job that was completed without them.",
      idempotencyKey: "cw-r01-intake",
    });
    check("R01 intake ACCEPTED", intake.ok, intake.ok ? `${intake.outcome.returnId} state ${intake.outcome.state}` : `${intake.code}: ${intake.message}`);

    if (!intake.ok) { process.exitCode = 1; }
    else {
      const returnId = intake.outcome.returnId;
      const stored = (await db.collection(RETURNS_COLLECTION).doc(returnId).get()).data();
      const after = await scopes(PART);
      const ledgerAfter = (await allLedgerRows(db)).length;

      // ── THE LOAD-BEARING INVARIANT ────────────────────────────────────────────────────────────
      console.log("\n-- RETURN INTAKE IS NOT INVENTORY RESTORATION");
      check("warehouseAvailable is UNCHANGED", after.warehouseAvailable === before.warehouseAvailable,
        `${before.warehouseAvailable} -> ${after.warehouseAvailable}`);
      check("mobileInventory is UNCHANGED", after.mobileInventory === before.mobileInventory,
        `${before.mobileInventory} -> ${after.mobileInventory}`);
      check("companyOwned is UNCHANGED", after.companyOwned === before.companyOwned,
        `${before.companyOwned} -> ${after.companyOwned}`);
      check("NO LEDGER EVENT WAS WRITTEN AT ALL", ledgerAfter === ledgerBefore,
        `${ledgerBefore} -> ${ledgerAfter} rows. Four units came back and the business owns exactly as much as before.`);
      const returnedRows = (await allLedgerRows(db)).filter((r) => r.type === "RETURNED");
      check("nothing in this world has ever written a RETURNED movement", returnedRows.length === 0,
        "schema-legal, and deliberately unused -- writing one at intake would BE the automatic restock #118 forbids");

      // ── R02 — AWAITING DISPOSITION ────────────────────────────────────────────────────────────
      console.log("\n== R02  awaiting disposition");
      check("the return is AWAITING_DISPOSITION", stored?.state === "AWAITING_DISPOSITION", stored?.state);
      check("the returned quantity is recorded", stored?.quantity === 4, `${stored?.quantity}`);
      // receivedBy, not actor.id -- read from the stored record rather than guessed from the shape
      // other domains happen to use.
      check("the clerk who took the return is recorded", stored?.receivedBy === intake.actorUid,
        `${stored?.receivedBy}`);
      check("the return records WHEN it arrived", Boolean(stored?.receivedAt), "receivedAt");
      check("the condition observed at the dock is recorded", stored?.condition === "UNOPENED", stored?.condition);
      check("the source of the return is recorded", stored?.source === "WORK_ORDER", stored?.source);
      // UNKNOWN vs ZERO, for returns.
      check("RESTORED QUANTITY IS UNKNOWN, NOT ZERO",
        stored?.restoredQuantity === undefined && stored?.state === "AWAITING_DISPOSITION",
        "no disposition has happened, so how much will return to stock is undecided -- not measured as none");

      // ── R03 / R04 — HONESTLY ABSENT ───────────────────────────────────────────────────────────
      console.log("\n== R03 / R04  disposition");
      check("R03 restockable disposition: NOT_SUPPORTED_BY_CURRENT_RUNTIME", true,
        "no disposition command exists. Inventing one to complete a Golden lifecycle would fabricate authority.");
      check("R04 non-restock / reject: NOT_SUPPORTED_BY_CURRENT_RUNTIME", true,
        "same reason. The second half of returns is a business decision nobody has made.");
      // Counted, not pattern-matched. The first version tested for the WORD "disposition" after the
      // command, which the module's own header discusses at length -- a guard that would have failed
      // on prose and passed on a real second command.
      const returnModule = fs.readFileSync(path.resolve(REPO, "functions/src/inventoryReturns/returnIntakeCommand.ts"), "utf8");
      const exportedCommands = (returnModule.match(/^export async function/gm) ?? []).length;
      check("there is exactly ONE exported return command", exportedCommands === 1,
        `${exportedCommands} -- recordReturnIntake, and no disposition beside it`);

      // ── IDEMPOTENCY ───────────────────────────────────────────────────────────────────────────
      console.log("\n-- replay and conflict");
      const replay = await intakeAs(db, clerk, {
        partId: PART, quantity: 4, source: "WORK_ORDER", condition: "UNOPENED",
        reason: "Parts drawn for a job that was completed without them.",
        idempotencyKey: "cw-r01-intake",
      });
      const afterReplay = await scopes(PART);
      const allReturns = (await db.collection(RETURNS_COLLECTION).get()).docs;
      check("an identical replay creates no second return",
        allReturns.filter((d) => d.data().idempotencyKey === "cw-r01-intake").length === 1,
        replay.ok ? `outcome ${replay.outcome.outcome}` : `${replay.code}`);
      check("the replay restored no inventory either",
        afterReplay.companyOwned === before.companyOwned, `${afterReplay.companyOwned}`);

      const conflict = await intakeAs(db, clerk, {
        partId: PART, quantity: 99, source: "CUSTOMER", condition: "DAMAGED",
        idempotencyKey: "cw-r01-intake",
      });
      const conflictDoc = (await db.collection(RETURNS_COLLECTION).doc(returnId).get()).data();
      check("a changed payload under the same key does not overwrite the record",
        conflictDoc?.quantity === 4 && conflictDoc?.condition === "UNOPENED",
        conflict.ok ? `replayed as ${conflict.outcome.outcome}, stored quantity still ${conflictDoc?.quantity}`
          : `${conflict.code}: ${conflict.message}`);
      evidence.idempotency = { replay: replay.ok ? replay.outcome.outcome : replay.code,
        conflictStoredQuantity: conflictDoc?.quantity, conflictStoredCondition: conflictDoc?.condition };

      // ── INVALID INPUT ─────────────────────────────────────────────────────────────────────────
      console.log("\n-- refusals");
      const badSource = await intakeAs(db, clerk, {
        partId: PART, quantity: 1, source: "SOMEWHERE_ELSE", condition: "UNOPENED",
        idempotencyKey: "cw-r-bad-source",
      });
      check("an unrecognised source is REFUSED, never coerced to UNKNOWN", !badSource.ok,
        badSource.ok ? "ACCEPTED" : `${badSource.code}: ${badSource.message}`);
      const badCondition = await intakeAs(db, clerk, {
        partId: PART, quantity: 1, source: "CUSTOMER", condition: "SLIGHTLY_BENT",
        idempotencyKey: "cw-r-bad-condition",
      });
      check("an unrecognised condition is REFUSED, never coerced to UNKNOWN", !badCondition.ok,
        badCondition.ok ? "ACCEPTED" : `${badCondition.code}: ${badCondition.message}`);
      const noPart = await intakeAs(db, clerk, {
        quantity: 1, source: "CUSTOMER", condition: "UNOPENED", idempotencyKey: "cw-r-no-part",
      });
      check("a return with no part is REFUSED", !noPart.ok, noPart.ok ? "ACCEPTED" : `${noPart.code}: ${noPart.message}`);
      evidence.refusals = { badSource: badSource.code, badCondition: badCondition.code, noPart: noPart.code };

      // ── A SECOND RETURN, so the world holds more than one ─────────────────────────────────────
      const second = await intakeAs(db, INTAKE_CLERKS[0], {
        partId: PART, quantity: 1, source: "CUSTOMER", condition: "DAMAGED",
        reason: "Customer returned a visibly damaged unit; condition observed at the dock.",
        idempotencyKey: "cw-r02-damaged",
      });
      check("a second return, damaged, also restores nothing", second.ok
        && (await scopes(PART)).companyOwned === before.companyOwned,
        second.ok ? `${second.outcome.returnId}` : `${second.code}`);

      evidence.R01 = { returnId, part: PART, quantity: 4, clerk, state: stored?.state,
        condition: stored?.condition, source: stored?.source, before, after,
        ledgerRowsBefore: ledgerBefore, ledgerRowsAfter: ledgerAfter };
      evidence.R02 = { state: "AWAITING_DISPOSITION", restoredQuantity: "UNKNOWN",
        note: "recorded as returned; NOT recorded as available" };
      evidence.G08 = {
        id: "G08", title: "Return lifecycle",
        question: "This part came back. Can we use it?",
        expectedAnswer: "It has been RETURNED, and it is not in usable inventory. Nothing restores it "
          + "until a disposition decision exists, and that decision is not built.",
        trap: "'Returned' and 'back in stock' are different facts. A system that conflates them "
          + "credits inventory for goods nobody has inspected.",
        before, intake: { ...after, state: "AWAITING_DISPOSITION", returnedQuantity: 4, restoredQuantity: "UNKNOWN" },
        disposition: "NOT_SUPPORTED",
      };
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "return-scenarios.json"), JSON.stringify(evidence, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} return checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
