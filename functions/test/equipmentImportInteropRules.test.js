// EOS Data Import P1 -- does IMPORTED Equipment stay ordinary Equipment?
//
// The trusted import command writes one field the client writer never writes:
// `serialNumberKey`, a server-derived normalized copy of the serial used for duplicate
// detection. The Admin SDK bypasses Rules, so it lands on the document without Rules ever
// seeing it -- and this suite exists because that is exactly the kind of addition that quietly
// makes a record un-editable through the normal path six weeks later.
//
// ============================ THE FOUR CLAIMS ============================
//
//   1. An otherwise-valid edit through the NORMAL client path still succeeds on an imported
//      record. This is the one that matters: an imported machine must be as editable as one
//      somebody typed in.
//   2. A client cannot FORGE `serialNumberKey` on create. It is server-derived, so a client
//      supplying it would be asserting a duplicate-detection key of its own choosing.
//   3. A client cannot MODIFY `serialNumberKey` after import -- nor delete it, which is the
//      same attack wearing a different hat.
//   4. Manually-created Equipment WITHOUT the field stays valid, and imported Equipment WITH
//      it stays valid. Both shapes coexist; neither is grandfathered out.
//
// ============================ WHY THE EXISTING RULES ALREADY DO THIS ============================
//
// No Rules change was needed, and the reason is worth stating because it looks like luck and
// is not. `equipmentCreateShapeValid()` applies `hasOnly(equipmentWritableKeys())` on CREATE,
// and `serialNumberKey` is not on that list -- so a client create carrying it is denied by the
// anti-injection guard that already existed for fields nobody had thought of yet. UPDATE
// deliberately does NOT re-apply that key-set check (only the VALUES are re-validated), which
// is what lets a document carrying a trusted extra field stay ordinarily editable -- and
// `affectedKeys().hasOnly(equipmentEditableKeys())` still denies ADDING, CHANGING or REMOVING
// it. The Rules comment anticipated precisely this: "the extra key can only arrive from a
// trusted writer or the Admin SDK."
//
// So production logic is untouched and this suite is the proof, not a patch.
//
// Prerequisite: a live Firestore + Auth emulator pair loaded from THIS worktree.
// Emulator-only: it never touches the live "taylor-parts" project.
"use strict";

// Both hosts are OVERRIDABLE, unlike the older suites here that pin 8080/9099. Concurrent
// worktrees share a machine, and a suite that can only run on one pair of ports is a suite
// that cannot run while somebody else is working. The defaults are unchanged, so the
// regression runner and CI behave exactly as before.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

const admin = require("firebase-admin");

const PROJECT_ID = "taylor-parts";
const FIRESTORE_HOST = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
const AUTH_HOST = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
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

/** PATCH a never-before-used id with NO updateMask -> exercises `create`. */
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

/** PATCH an EXISTING doc with an explicit updateMask -> the client SDK's update semantics. */
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

/** An updateMask naming a field with NO value -> Firestore DELETES it. */
async function deleteField(docId, idToken, fieldPath) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = [fieldPath, "updatedAt"]
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOC_BASE}/equipment/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: { updatedAt: { integerValue: String(Date.now()) } } }),
  });
  return res.status;
}

async function readEquipment(docId, idToken) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/equipment/${docId}`, { headers });
  return res.status;
}

const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const nul = () => ({ nullValue: null });

const ACCOUNT = "rules-import-equip-acct";
const LOCATION = "rules-import-equip-loc";
const IMPORTED = "rules-import-equip-imported";
const MANUAL = "rules-import-equip-manual";

/** The client writer's exact create shape (domain/equipmentWrites.js). */
function clientCreateFields(overrides = {}) {
  return {
    accountId: str(ACCOUNT),
    locationId: str(LOCATION),
    name: str("Client Created Unit"),
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

async function seed() {
  await db.doc("users/import-equip-admin").set({ role: "admin" });
  await db.doc("users/import-equip-dispatcher").set({ role: "dispatcher" });
  await db.doc(`accounts/${ACCOUNT}`).set({ name: "Import Interop Co", nameLower: "import interop co" });
  await db.doc(`locations/${LOCATION}`).set({ accountId: ACCOUNT, name: "Main Plant" });

  // EXACTLY what createEquipmentFromImport writes -- including the extra server-derived key,
  // and NUMBER timestamps, which is what the Equipment domain governs.
  await db.doc(`equipment/${IMPORTED}`).set({
    accountId: ACCOUNT,
    locationId: LOCATION,
    name: "Imported Ice Machine",
    status: "ACTIVE",
    manufacturer: "Manitowoc",
    model: "IY-0454A",
    serialNumber: "SN 1001",
    serialNumberKey: "SN1001",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // A machine added by hand BEFORE the field existed. It must stay valid, unchanged.
  await db.doc(`equipment/${MANUAL}`).set({
    accountId: ACCOUNT,
    locationId: LOCATION,
    name: "Hand Added Unit",
    status: "ACTIVE",
    manufacturer: "Carrier",
    model: "48TC",
    serialNumber: "SN-MANUAL",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

async function cleanup() {
  const ids = [IMPORTED, MANUAL, "rules-import-equip-forge", "rules-import-equip-plain"];
  await Promise.all(ids.map((id) => db.doc(`equipment/${id}`).delete().catch(() => {})));
  await Promise.all([
    db.doc(`accounts/${ACCOUNT}`).delete().catch(() => {}),
    db.doc(`locations/${LOCATION}`).delete().catch(() => {}),
    db.doc("users/import-equip-admin").delete().catch(() => {}),
    db.doc("users/import-equip-dispatcher").delete().catch(() => {}),
  ]);
}

async function main() {
  await cleanup();
  await seed();

  const adminToken = await idTokenFor("import-equip-admin");
  const dispatcherToken = await idTokenFor("import-equip-dispatcher");

  // ---------------------------------------------------------------- CLAIM 1

  // THE LOAD-BEARING ONE. An imported machine must be as editable as one somebody typed in.
  report(
    "imported Equipment: an ordinary NAME edit through the normal client path ALLOWED",
    (await updateEquipment(IMPORTED, adminToken, { name: str("Renamed after import"), updatedAt: int(Date.now()) })) === 200
  );
  report(
    "imported Equipment: an ordinary descriptive edit (model + notes) ALLOWED",
    (await updateEquipment(IMPORTED, adminToken, {
      model: str("IY-0504A"),
      notes: str("Serviced after import"),
      updatedAt: int(Date.now()),
    })) === 200
  );
  report(
    "imported Equipment: a dispatcher can edit it too -- the extra field narrows nobody",
    (await updateEquipment(IMPORTED, dispatcherToken, { assetTag: str("AT-99"), updatedAt: int(Date.now()) })) === 200
  );
  report(
    "imported Equipment: an ACTIVE -> INACTIVE status edit ALLOWED, exactly as for any machine",
    (await updateEquipment(IMPORTED, adminToken, { status: str("INACTIVE"), updatedAt: int(Date.now()) })) === 200
  );
  // Put it back, so the remaining assertions run against the normal state.
  await updateEquipment(IMPORTED, adminToken, { status: str("ACTIVE"), updatedAt: int(Date.now()) });

  report("imported Equipment: still readable by admin", (await readEquipment(IMPORTED, adminToken)) === 200);
  report("imported Equipment: still denied to the unauthenticated", (await readEquipment(IMPORTED, null)) === 403);

  // ---------------------------------------------------------------- CLAIM 2

  // The key is SERVER-DERIVED. A client supplying it would be asserting a duplicate-detection
  // key of its own choosing -- which is how two machines end up sharing one serial on purpose.
  report(
    "create: a client CANNOT forge serialNumberKey (hasOnly(writableKeys) denies it)",
    (await createEquipment("rules-import-equip-forge", adminToken, clientCreateFields({
      serialNumber: str("SN 2002"),
      serialNumberKey: str("ANYTHING-I-LIKE"),
    }))) === 403
  );
  report(
    "create: the SAME record without the forged key is ALLOWED -- the key is the only reason it was denied",
    (await createEquipment("rules-import-equip-plain", adminToken, clientCreateFields({ serialNumber: str("SN 2002") }))) === 200
  );

  // ---------------------------------------------------------------- CLAIM 3

  report(
    "update: a client CANNOT change serialNumberKey on an imported record",
    (await updateEquipment(IMPORTED, adminToken, { serialNumberKey: str("SOMETHING-ELSE"), updatedAt: int(Date.now()) })) === 403
  );
  report(
    "update: a client CANNOT DELETE serialNumberKey either -- a removal is an edit like any other",
    (await deleteField(IMPORTED, adminToken, "serialNumberKey")) === 403
  );
  report(
    "update: a client CANNOT ADD serialNumberKey to a manually-created record",
    (await updateEquipment(MANUAL, adminToken, { serialNumberKey: str("SNMANUAL"), updatedAt: int(Date.now()) })) === 403
  );
  report(
    "update: serialNumberKey cannot be smuggled alongside a legitimate field edit",
    (await updateEquipment(IMPORTED, adminToken, {
      name: str("A perfectly ordinary rename"),
      serialNumberKey: str("SMUGGLED"),
      updatedAt: int(Date.now()),
    })) === 403
  );

  // The value survived every one of those attempts.
  const after = await db.doc(`equipment/${IMPORTED}`).get();
  report(
    "the stored serialNumberKey is unchanged after all four attempts",
    after.exists && after.data().serialNumberKey === "SN1001",
    `saw ${after.exists ? JSON.stringify(after.data().serialNumberKey) : "no document"}`
  );

  // ---------------------------------------------------------------- CLAIM 4

  // BOTH SHAPES COEXIST. Neither is grandfathered out by the other's existence.
  report(
    "manually-created Equipment WITHOUT serialNumberKey remains ordinarily editable",
    (await updateEquipment(MANUAL, adminToken, { name: str("Renamed by hand"), updatedAt: int(Date.now()) })) === 200
  );
  report(
    "manually-created Equipment WITHOUT serialNumberKey remains readable",
    (await readEquipment(MANUAL, adminToken)) === 200
  );

  // And the governed fields are still governed on an imported record -- the extra key did not
  // loosen anything. If it had, THIS is where it would show.
  report(
    "imported Equipment: accountId is STILL immutable",
    (await updateEquipment(IMPORTED, adminToken, { accountId: str("some-other-account"), updatedAt: int(Date.now()) })) === 403
  );
  report(
    "imported Equipment: locationId is STILL immutable",
    (await updateEquipment(IMPORTED, adminToken, { locationId: str("some-other-location"), updatedAt: int(Date.now()) })) === 403
  );
  report(
    "imported Equipment: createdAt is STILL immutable",
    (await updateEquipment(IMPORTED, adminToken, { createdAt: int(1), updatedAt: int(Date.now()) })) === 403
  );
  report(
    "imported Equipment: an unknown/trusted field is STILL denied on update",
    (await updateEquipment(IMPORTED, adminToken, { retiredAt: int(Date.now()), updatedAt: int(Date.now()) })) === 403
  );
  report(
    "imported Equipment: a technician is STILL denied",
    (await updateEquipment(IMPORTED, await idTokenFor("import-equip-technician-missing"), { name: str("nope") })) === 403
  );

  await cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
