#!/usr/bin/env node
// ACTOR AUTHORITY — resolved, never labelled.
//
// ============================ WHY A NAME PROVES NOTHING ============================
//
// An earlier fixture declared buyers cw-emp-035/036 and receivers cw-emp-025/026, and asserted the
// two lists were disjoint. They were. Both were also wrong: the "buyers" were salespeople with no
// purchasing capability, and the "receivers" held put-away, not receive.
//
// The disjointness check passed because it compared two arrays of strings and never asked what
// authority those people hold. A separation-of-duties proof that never consults authority is a
// spelling test.
//
// So this resolves every actor through the SAME path the services use: active roleAssignments plus
// the principal's accessVersion, through resolveEffectivePermission over the merged catalog. No
// stub, no fixture field, no job title.
//
// ============================ PUT-AWAY IS NOT RECEIVING ============================
//
// The domain is explicit: inventory.stock.receive "accepts purchased stock into the company's
// custody. A station, not a job title: assigned per employee so receiving has named accountability
// rather than being available to everyone who works in a warehouse."
//
// Assuming warehouse work implies receive authority is exactly the conflation that role exists to
// prevent, and it is asserted here as a NEGATIVE case rather than left as a comment.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));

/** The same merge every callable wiring uses: a principal may hold ANY governed role. */
const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };

const RECEIVE = "inventory.stock.receive";
const PURCHASE = "reorder.purchaseOrder.create";

/** Fixture actors under test. */
const BUYERS = ["cw-emp-001", "cw-emp-002"];
const RECEIVERS = ["cw-emp-044", "cw-emp-045"];
/** Negative controls: real employees whose authority does NOT cover the act. */
const PUT_AWAY_ONLY = "cw-emp-025";
const SALESPERSON = "cw-emp-035";
/** Holds both. Excluded from the SoD fixture on purpose -- see the check below. */
const OWNER = "cw-emp-000";

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  // employee -> principal
  const employees = await db.collection("employees").get();
  const uidBy = new Map(employees.docs.map((d) => [d.id, d.data().userId]).filter(([, u]) => u));

  /** The real resolution path, read exactly as resolveReceivePermissionThroughTxn reads it. */
  async function resolves(employeeId, permissionId) {
    const uid = uidBy.get(employeeId);
    if (!uid) return { allowed: false, reason: "no principal" };
    const userSnap = await db.collection("users").doc(uid).get();
    const accessVersion = userSnap.exists ? (userSnap.data()?.accessVersion ?? 0) : 0;
    const snap = await db.collection("roleAssignments")
      .where("principalUid", "==", uid).where("status", "==", "active").get();
    const assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const out = resolveEffectivePermission({
      permissionId, assignments, roles: ROLE_CATALOG,
      currentAccessVersion: accessVersion, target: GLOBAL_TARGET,
    });
    return { allowed: out.decision === "ALLOW", decision: out.decision, roles: assignments.map((a) => a.roleId) };
  }

  console.log("-- buyers must resolve purchasing, and must NOT resolve receiving");
  for (const b of BUYERS) {
    const p = await resolves(b, PURCHASE);
    const r = await resolves(b, RECEIVE);
    check(`${b} holds ${PURCHASE}`, p.allowed, `${p.decision} via ${p.roles?.join("/") ?? "-"}`);
    check(`${b} does NOT hold ${RECEIVE}`, !r.allowed, r.decision);
  }

  console.log("\n-- receivers must resolve receiving, and must NOT resolve purchasing");
  for (const r of RECEIVERS) {
    const rec = await resolves(r, RECEIVE);
    const pur = await resolves(r, PURCHASE);
    check(`${r} holds ${RECEIVE}`, rec.allowed, `${rec.decision} via ${rec.roles?.join("/") ?? "-"}`);
    check(`${r} does NOT hold ${PURCHASE}`, !pur.allowed, pur.decision);
  }

  console.log("\n-- the two sets are disjoint (necessary, and on its own insufficient)");
  const overlap = BUYERS.filter((b) => RECEIVERS.includes(b));
  check("buyer set intersect receiver set is empty", overlap.length === 0, overlap.join(", ") || "disjoint");

  console.log("\n-- negative controls: the misassignments that shipped");
  const putAway = await resolves(PUT_AWAY_ONLY, RECEIVE);
  check(`${PUT_AWAY_ONLY} (put-away operator) is DENIED ${RECEIVE}`, !putAway.allowed,
    `${putAway.decision} -- holds ${putAway.roles?.join("/")}`);
  const sales = await resolves(SALESPERSON, PURCHASE);
  check(`${SALESPERSON} (salesperson) is DENIED ${PURCHASE}`, !sales.allowed,
    `${sales.decision} -- holds ${sales.roles?.join("/")}`);

  console.log("\n-- the owner overlap, structurally excluded from the SoD fixture");
  //
  // TWO SEPARATE FACTS, and an earlier version of this check ran them together.
  //
  // It asserted cw-emp-000 currently RESOLVES both capabilities. It does not -- it resolves
  // neither, because the privileged owner grant is still awaiting an authenticated human Admin
  // decision and the bootstrap deliberately excludes it. The world was right; the assertion was
  // wrong.
  //
  // The durable reason the owner is unsuitable as a fixture actor is a property of the ROLE, not of
  // today's grant state: `owner` composes both capabilities, so an owner-actor could never
  // demonstrate separation regardless of who currently holds it.
  const ownerRole = ROLE_CATALOG.owner;
  check("the owner ROLE exists in the merged catalog", Boolean(ownerRole),
    ownerRole ? "owner composes admin and business authority" : "owner role missing");

  const ownerRec = await resolves(OWNER, RECEIVE);
  const ownerPur = await resolves(OWNER, PURCHASE);
  check(`${OWNER} currently resolves NEITHER -- its privileged grant is still pending`,
    !ownerRec.allowed && !ownerPur.allowed,
    `receive=${ownerRec.decision} purchase=${ownerPur.decision} -- pending human Admin approval, correctly not fabricated`);

  check(`${OWNER} is excluded from buyer and receiver sets`,
    !BUYERS.includes(OWNER) && !RECEIVERS.includes(OWNER),
    "an actor whose role composes both sides cannot demonstrate separation");


  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} authority checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
