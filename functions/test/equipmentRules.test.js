// Equipment & Installed Asset Management -- Issue #232 unit E3
// (docs/specifications/equipment-and-installed-asset-management.md,
// docs/architecture/ADR-006-equipment-and-installed-asset-management.md).
// Firestore Rules emulator test for the `equipment` collection.
//
// Same zero-new-dependency posture as the other suites in this directory:
// firebase-admin (Admin SDK, bypasses Rules for seeding) + Node's built-in fetch
// against the emulator REST APIs. No @firebase/rules-unit-testing, no test runner.
//
// What this proves (the Specification's §10/§11 Rules obligations):
//   - AUTHORITY: admin/dispatcher get the full surface; everyone else is denied --
//     technician, unauthenticated, a user document that does not exist, a wrong or
//     malformed role, and (critically) an Employee holding operationalRoles, which
//     are work eligibility and NEVER security authority;
//   - OWNERSHIP (§4): a Location belonging to another Account, or one that does not
//     exist at all, is denied on create -- verified server-side, never taken from
//     the client;
//   - ORDINARY EDIT (§6): accountId / locationId / status / createdAt cannot be
//     changed, individually or smuggled alongside a legitimate field edit;
//   - INJECTION: trusted/audit fields (movedBy, retiredAt, auditEventId, ...) and any
//     unknown field are denied on both create and update;
//   - LIFECYCLE (§5): create cannot be a side door into RETIRED/INACTIVE;
//   - DELETE (§11): denied for everyone, including admin.
//
// Prerequisite: a live Firestore + Auth emulator pair loaded from THIS worktree, e.g.
//   node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/emulator.mjs start firestore,auth
// then:
//   node functions/test/equipmentRules.test.js
//
// Emulator-only: it never touches the live "taylor-parts" project.
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
const FIRESTORE_HOST = "http://127.0.0.1:8080";
const AUTH_HOST = "http://127.0.0.1:9099";
const DOC_BASE = `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`PASS -- ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL -- ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const body = await res.json();
  if (!body.idToken) throw new Error(`Failed to mint ID token for ${uid}: ${JSON.stringify(body)}`);
  return body.idToken;
}

// PATCH a never-before-used document id with NO updateMask -> exercises `create`.
async function createEquipment(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/equipment/${docId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

// PATCH an EXISTING document with an explicit updateMask -> exercises `update` with
// the same "merged existing doc + these fields" semantics the client SDK produces.
async function updateEquipment(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOC_BASE}/equipment/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function readEquipment(docId, idToken) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/equipment/${docId}`, { headers });
  return res.status;
}

async function deleteEquipment(docId, idToken) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/equipment/${docId}`, { method: "DELETE", headers });
  return res.status;
}

const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const nul = () => ({ nullValue: null });

const ACCOUNT_A = "rules-equip-acct-a";
const ACCOUNT_B = "rules-equip-acct-b";
const LOCATION_A1 = "rules-equip-loc-a1";
const LOCATION_A2 = "rules-equip-loc-a2";
const LOCATION_B1 = "rules-equip-loc-b1";
const SEEDED = "rules-equip-seeded";

// The exact shape E2's createEquipment writes (domain/equipmentWrites.js ->
// makeCollectionStore.add): the full normalized record, optionals as null.
function equipmentFields(overrides = {}) {
  return {
    accountId: str(ACCOUNT_A),
    locationId: str(LOCATION_A1),
    name: str("Rules Test Unit"),
    status: str("ACTIVE"),
    manufacturer: nul(),
    model: nul(),
    serialNumber: nul(),
    assetTag: nul(),
    installedDate: nul(),
    warrantyExpiresDate: nul(),
    notes: nul(),
    createdAt: int(Date.now()),
    updatedAt: int(Date.now()),
    ...overrides,
  };
}

async function seedEquipmentDoc(docId, data = {}) {
  await db.doc(`equipment/${docId}`).set({
    accountId: ACCOUNT_A,
    locationId: LOCATION_A1,
    name: "Seeded Unit",
    status: "ACTIVE",
    manufacturer: "Carrier",
    model: "48TC",
    serialNumber: "SN-1",
    assetTag: "AT-1",
    installedDate: null,
    warrantyExpiresDate: null,
    notes: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...data,
  });
}

async function seed() {
  await db.doc("users/equip-admin").set({ role: "admin" });
  await db.doc("users/equip-dispatcher").set({ role: "dispatcher" });
  await db.doc("users/equip-technician").set({ role: "technician", technicianId: "equip-tech-1" });
  // A wrong/unknown role, and a malformed one -- both must fail closed.
  await db.doc("users/equip-wrong-role").set({ role: "warehouse" });
  await db.doc("users/equip-malformed-role").set({ role: 42 });
  await db.doc("users/equip-no-role").set({ employeeId: "equip-emp-ops" });
  // users/equip-missing is deliberately NEVER created.

  // The operationalRoles trap: a reciprocally linked, ACTIVE Employee holding every
  // eligible operational role. operationalRoles are work eligibility, NOT security
  // authority -- this principal must get nothing from them.
  await db.doc("users/equip-ops-roles").set({ role: "technician", employeeId: "equip-emp-ops" });
  await db.doc("employees/equip-emp-ops").set({
    employeeId: "equip-emp-ops",
    displayName: "Ops Roles Holder",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER", "WAREHOUSE_MANAGER", "PARTS_ASSOCIATE"],
    userId: "equip-ops-roles",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  await db.doc(`accounts/${ACCOUNT_A}`).set({ name: "Rules Equip A", status: "Active" });
  await db.doc(`accounts/${ACCOUNT_B}`).set({ name: "Rules Equip B", status: "Active" });
  await db.doc(`locations/${LOCATION_A1}`).set({ accountId: ACCOUNT_A, name: "A1" });
  await db.doc(`locations/${LOCATION_A2}`).set({ accountId: ACCOUNT_A, name: "A2" });
  await db.doc(`locations/${LOCATION_B1}`).set({ accountId: ACCOUNT_B, name: "B1" });
  await seedEquipmentDoc(SEEDED);
}

async function main() {
  await seed();

  const adminToken = await idTokenFor("equip-admin");
  const dispatcherToken = await idTokenFor("equip-dispatcher");
  const technicianToken = await idTokenFor("equip-technician");
  const wrongRoleToken = await idTokenFor("equip-wrong-role");
  const malformedRoleToken = await idTokenFor("equip-malformed-role");
  const noRoleToken = await idTokenFor("equip-no-role");
  const missingUserToken = await idTokenFor("equip-missing");
  const opsRolesToken = await idTokenFor("equip-ops-roles");

  let n = 0;
  const uniq = (p) => `${p}-${Date.now()}-${n++}`;

  // ---- READ authority ------------------------------------------------------
  report("read: admin ALLOWED", (await readEquipment(SEEDED, adminToken)) === 200);
  report("read: dispatcher ALLOWED", (await readEquipment(SEEDED, dispatcherToken)) === 200);

  // Spec §10 restricts a technician to Equipment reachable through their OWN assigned
  // Work Orders. Rules cannot express that (it needs a QUERY over fieldops_wos, and
  // Rules only get()/exists() a known path), so E3 denies technicians outright rather
  // than granting the whole register. E17 introduces the self-scoped mechanism.
  report("read: technician DENIED (no general register authority -- E17 owns self-scope)",
    (await readEquipment(SEEDED, technicianToken)) === 403);
  report("read: unauthenticated DENIED", (await readEquipment(SEEDED, null)) === 403);
  report("read: missing users/{uid} document DENIED (fails closed)",
    (await readEquipment(SEEDED, missingUserToken)) === 403);
  report("read: wrong role DENIED", (await readEquipment(SEEDED, wrongRoleToken)) === 403);
  report("read: malformed (non-string) role DENIED",
    (await readEquipment(SEEDED, malformedRoleToken)) === 403);
  report("read: user document with no role field DENIED",
    (await readEquipment(SEEDED, noRoleToken)) === 403);
  report("read: ACTIVE Employee with every operationalRole DENIED (eligibility is not authority)",
    (await readEquipment(SEEDED, opsRolesToken)) === 403);

  // ---- CREATE authority ----------------------------------------------------
  report("create: admin with a valid record ALLOWED",
    (await createEquipment(uniq("eq-ok-admin"), adminToken, equipmentFields())) === 200);
  report("create: dispatcher with a valid record ALLOWED",
    (await createEquipment(uniq("eq-ok-disp"), dispatcherToken, equipmentFields())) === 200);
  report("create: technician DENIED",
    (await createEquipment(uniq("eq-tech"), technicianToken, equipmentFields())) === 403);
  report("create: unauthenticated DENIED",
    (await createEquipment(uniq("eq-anon"), null, equipmentFields())) === 403);
  report("create: operationalRoles holder DENIED",
    (await createEquipment(uniq("eq-ops"), opsRolesToken, equipmentFields())) === 403);
  report("create: missing users/{uid} DENIED",
    (await createEquipment(uniq("eq-missing"), missingUserToken, equipmentFields())) === 403);

  // ---- CREATE ownership (§4) ----------------------------------------------
  report("create: cross-Account Location DENIED (Location belongs to Account B)",
    (await createEquipment(uniq("eq-cross"), adminToken,
      equipmentFields({ locationId: str(LOCATION_B1) }))) === 403);
  report("create: nonexistent Location DENIED (dangling reference fails closed)",
    (await createEquipment(uniq("eq-dangling"), adminToken,
      equipmentFields({ locationId: str("rules-equip-loc-does-not-exist") }))) === 403);
  report("create: sibling Location of the SAME Account ALLOWED",
    (await createEquipment(uniq("eq-sibling"), adminToken,
      equipmentFields({ locationId: str(LOCATION_A2) }))) === 200);
  report("create: Account claimed does not match the Location's owner DENIED",
    (await createEquipment(uniq("eq-mismatch"), adminToken,
      equipmentFields({ accountId: str(ACCOUNT_B), locationId: str(LOCATION_A1) }))) === 403);

  // ---- CREATE shape / lifecycle / injection --------------------------------
  report("create: status RETIRED DENIED (retiring is the trusted, audited action)",
    (await createEquipment(uniq("eq-retired"), adminToken,
      equipmentFields({ status: str("RETIRED") }))) === 403);
  report("create: status INACTIVE DENIED (lifecycle is not a create-time choice)",
    (await createEquipment(uniq("eq-inactive"), adminToken,
      equipmentFields({ status: str("INACTIVE") }))) === 403);
  report("create: unknown status DENIED",
    (await createEquipment(uniq("eq-bogus"), adminToken,
      equipmentFields({ status: str("BOGUS") }))) === 403);
  report("create: empty name DENIED",
    (await createEquipment(uniq("eq-noname"), adminToken,
      equipmentFields({ name: str("") }))) === 403);
  report("create: missing required accountId DENIED", await (async () => {
    const f = equipmentFields(); delete f.accountId;
    return (await createEquipment(uniq("eq-noacct"), adminToken, f)) === 403;
  })());
  report("create: trusted/audit field injection DENIED (movedBy/movedAt)",
    (await createEquipment(uniq("eq-inject-move"), adminToken,
      equipmentFields({ movedBy: str("equip-admin"), movedAt: int(Date.now()) }))) === 403);
  report("create: audit event id injection DENIED",
    (await createEquipment(uniq("eq-inject-audit"), adminToken,
      equipmentFields({ auditEventId: str("forged") }))) === 403);
  report("create: retiredBy/retiredAt injection DENIED",
    (await createEquipment(uniq("eq-inject-retire"), adminToken,
      equipmentFields({ retiredBy: str("equip-admin"), retiredAt: int(Date.now()) }))) === 403);
  report("create: self-grant field injection DENIED (permissions/role blob)",
    (await createEquipment(uniq("eq-inject-perm"), adminToken,
      equipmentFields({ permissions: str("admin"), role: str("admin") }))) === 403);
  report("create: unknown/invented field DENIED (allow-list fails closed)",
    (await createEquipment(uniq("eq-inject-unknown"), adminToken,
      equipmentFields({ somethingNobodyPlanned: str("x") }))) === 403);

  // ---- UPDATE: ordinary edit (§6) ------------------------------------------
  report("update: admin editing a descriptive field ALLOWED",
    (await updateEquipment(SEEDED, adminToken,
      { name: str("Renamed"), updatedAt: int(Date.now()) })) === 200);
  report("update: dispatcher editing a descriptive field ALLOWED",
    (await updateEquipment(SEEDED, dispatcherToken,
      { notes: str("PM done"), updatedAt: int(Date.now()) })) === 200);
  report("update: technician DENIED",
    (await updateEquipment(SEEDED, technicianToken,
      { name: str("Tech Rename"), updatedAt: int(Date.now()) })) === 403);
  report("update: unauthenticated DENIED",
    (await updateEquipment(SEEDED, null, { name: str("Anon"), updatedAt: int(Date.now()) })) === 403);
  report("update: operationalRoles holder DENIED",
    (await updateEquipment(SEEDED, opsRolesToken,
      { name: str("Ops"), updatedAt: int(Date.now()) })) === 403);

  // ---- UPDATE: governed fields are immutable (§4/§5) ------------------------
  report("update: changing accountId DENIED (re-owning is not an edit)",
    (await updateEquipment(SEEDED, adminToken,
      { accountId: str(ACCOUNT_B), updatedAt: int(Date.now()) })) === 403);
  report("update: changing locationId DENIED (a Location change is the audited MOVE)",
    (await updateEquipment(SEEDED, adminToken,
      { locationId: str(LOCATION_A2), updatedAt: int(Date.now()) })) === 403);
  report("update: changing status DENIED (lifecycle is the trusted action)",
    (await updateEquipment(SEEDED, adminToken,
      { status: str("RETIRED"), updatedAt: int(Date.now()) })) === 403);
  report("update: changing createdAt DENIED (immutable)",
    (await updateEquipment(SEEDED, adminToken,
      { createdAt: int(1), updatedAt: int(Date.now()) })) === 403);
  // The smuggling case: a governed change hidden alongside a legitimate edit. The
  // affectedKeys() guard must reject the WHOLE write, not just the governed part.
  report("update: governed change SMUGGLED alongside a legitimate edit DENIES the whole write",
    (await updateEquipment(SEEDED, adminToken,
      { name: str("Legit"), locationId: str(LOCATION_A2), updatedAt: int(Date.now()) })) === 403);
  report("update: re-writing accountId to its SAME value ALLOWED (not a change)",
    (await updateEquipment(SEEDED, adminToken,
      { accountId: str(ACCOUNT_A), updatedAt: int(Date.now()) })) === 200);

  // ---- UPDATE: injection ---------------------------------------------------
  report("update: trusted/audit field injection DENIED (movedBy/movedAt)",
    (await updateEquipment(SEEDED, adminToken,
      { movedBy: str("equip-admin"), movedAt: int(Date.now()), updatedAt: int(Date.now()) })) === 403);
  report("update: audit event id injection DENIED",
    (await updateEquipment(SEEDED, adminToken,
      { auditEventId: str("forged"), updatedAt: int(Date.now()) })) === 403);
  report("update: unknown/invented field DENIED",
    (await updateEquipment(SEEDED, adminToken,
      { somethingNobodyPlanned: str("x"), updatedAt: int(Date.now()) })) === 403);
  report("update: emptying the name DENIED",
    (await updateEquipment(SEEDED, adminToken,
      { name: str(""), updatedAt: int(Date.now()) })) === 403);

  // ---- DELETE (§11) --------------------------------------------------------
  report("delete: admin DENIED (nobody may delete Equipment)",
    (await deleteEquipment(SEEDED, adminToken)) === 403);
  report("delete: dispatcher DENIED", (await deleteEquipment(SEEDED, dispatcherToken)) === 403);
  report("delete: technician DENIED", (await deleteEquipment(SEEDED, technicianToken)) === 403);
  report("delete: unauthenticated DENIED", (await deleteEquipment(SEEDED, null)) === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Rules test crashed:", err);
  process.exit(1);
});
