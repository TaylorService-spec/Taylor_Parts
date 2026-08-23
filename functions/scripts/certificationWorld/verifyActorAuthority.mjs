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

const { TRANSFER_CREATE, COUNT_SUBMIT, COUNT_RECONCILE, RETURNS_INTAKE, loadPrincipalIndex, resolveCapability } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

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

  // ONE RESOLVER, SHARED. This file used to carry its own copy of the resolution path, written
  // before actorAuthority.mjs existed. When environment activation was added, the shared copy got
  // it and this one did not -- so the same employee resolved ALLOW in one tool and DENY in the
  // other, in the same process, against the same database. A verifier that disagrees with the
  // thing it verifies is worse than no verifier.
  const principalIndex = await loadPrincipalIndex(db);
  const resolves = (employeeId, permissionId) => resolveCapability(db, principalIndex, employeeId, permissionId);

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


  // ══ PASS 3 FAMILIES ═══════════════════════════════════════════════════════════════════════
  //
  // These three families are registered active:false and reach ALLOW only because the
  // certification environment activates them. Two independent things must both hold, and each is
  // asserted by removing the other:
  //
  //   ENVIRONMENT ACTIVATION IS NOT A ROLE GRANT
  //   AUTHORIZATION STILL REQUIRES ACTIVE CAPABILITY + EMPLOYEE EFFECTIVE AUTHORITY
  console.log("\n-- Pass 3 capability families, resolved through the same path the services use");

  const FAMILIES = [
    { name: "transfer operator", holders: ["cw-emp-029", "cw-emp-043"], holds: TRANSFER_CREATE,
      denied: COUNT_RECONCILE, control: "cw-emp-035" },
    { name: "cycle count counter", holders: ["cw-emp-025", "cw-emp-026", "cw-emp-027", "cw-emp-028"],
      holds: COUNT_SUBMIT, denied: COUNT_RECONCILE, control: "cw-emp-043" },
    { name: "cycle count reconciler", holders: ["cw-emp-023", "cw-emp-024"],
      holds: COUNT_RECONCILE, denied: COUNT_SUBMIT, control: "cw-emp-025" },
    { name: "returns intake", holders: ["cw-emp-029", "cw-emp-044"], holds: RETURNS_INTAKE,
      denied: COUNT_RECONCILE, control: "cw-emp-035" },
  ];

  for (const fam of FAMILIES) {
    for (const e of fam.holders) {
      const h = await resolves(e, fam.holds);
      const d = await resolves(e, fam.denied);
      check(`${fam.name} ${e} holds ${fam.holds}`, h.allowed, `${h.decision} via ${h.roles?.join("/") ?? "-"}`);
      check(`${fam.name} ${e} does NOT hold ${fam.denied}`, !d.allowed, d.decision);
    }
    // The negative control is a REAL employee doing a NEARBY job -- the person who would plausibly
    // be handed this task by someone reasoning from job titles.
    const ctl = await resolves(fam.control, fam.holds);
    check(`${fam.control} is DENIED ${fam.holds} (nearby job, wrong authority)`, !ctl.allowed,
      `${ctl.decision} -- holds ${ctl.roles?.join("/")}`);
  }

  console.log("\n-- counter and reconciler are disjoint PEOPLE, not just disjoint permissions");
  const counters = FAMILIES.find((f) => f.name === "cycle count counter").holders;
  const reconcilers = FAMILIES.find((f) => f.name === "cycle count reconciler").holders;
  const bothSides = counters.filter((c) => reconcilers.includes(c));
  check("counter set intersect reconciler set is empty", bothSides.length === 0,
    bothSides.join(", ") || `${counters.length} counters, ${reconcilers.length} reconcilers`);
  // Necessary and insufficient on its own -- which is why every holder above was resolved
  // individually first. Two disjoint lists of people who all hold both capabilities would pass
  // this line and mean nothing.

  console.log("\n-- activation alone authorizes nobody");
  for (const cap of [TRANSFER_CREATE, COUNT_RECONCILE, RETURNS_INTAKE]) {
    const holders = [];
    for (const [employeeId] of uidBy) {
      const r = await resolves(employeeId, cap);
      if (r.allowed) holders.push(employeeId);
    }
    check(`${cap} is held by SOME employees, not all`, holders.length > 0 && holders.length < uidBy.size,
      `${holders.length} of ${uidBy.size} employees`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} authority checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
