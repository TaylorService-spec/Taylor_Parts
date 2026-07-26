// INV-CONVERGENCE-E Stage B (PR-B1) -- Firestore Rules emulator regression
// for the canonical `parts` READ broadening: admin/dispatcher PLUS active,
// reciprocally-linked PARTS_MANAGER and WAREHOUSE_MANAGER may read `parts`;
// PARTS_ASSOCIATE is deliberately DENIED; ALL client `parts` writes stay
// denied; the adjacent canonical collections (manufacturers, part_aliases,
// part_supplier_items) stay fully closed to clients.
//
// Governed spec: docs/specifications/
// inv-convergence-e-stage-b-operational-role-parts-rules.md (design merged
// PR #431). This suite is the §5 12-principal matrix, each principal probed
// across all governed operations, plus the required behavioral proofs
// (role removal / employment-status change / linkage restore / stale
// accessVersion is ignored / bare compatibility-role and bare technician
// behavior).
//
// Same zero-new-dependency REST harness as partMasterRules.test.js /
// issue100PartsManagerRules.test.js (firebase-admin + Node's built-in fetch
// against the emulator REST APIs; no @firebase/rules-unit-testing, no test
// runner). Runs under rulesRegressionRunner.mjs.
//
// Prerequisite: a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/inventoryConvergenceStageBPartsRules.test.js
//
// This script is read/write only against the emulator -- it never touches
// the live "taylor-parts" project (no production data or credentials).
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

const str = (v) => ({ stringValue: v });

async function rest(method, path, idToken, body) {
  const res = await fetch(`${DOC_BASE}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status;
}

const allowed = (s) => s === 200;
const denied = (s) => s === 403;

// A never-before-used documentId ensures POST always exercises `create`
// (not update); PATCH on a fresh id exercises `create` too, but we PATCH
// an existing seeded doc so it exercises `update`.
let writeSeq = 0;
function freshId(prefix) {
  writeSeq += 1;
  return `${prefix}-${writeSeq}`;
}

// Probe every governed operation for a single principal, asserting the
// expected `parts` read outcome and that ALL writes + ALL adjacent-collection
// access is denied. Returns nothing; accumulates into passed/failed.
async function probePrincipal(label, idToken, expectPartsRead) {
  const readOk = expectPartsRead ? allowed : denied;
  const readWord = expectPartsRead ? "ALLOW" : "DENY";

  // 1. parts list read (collection query)
  report(`[${label}] parts LIST read ${readWord}`, readOk(await rest("GET", "parts", idToken)));
  // 2. parts single-document read
  report(`[${label}] parts SINGLE read ${readWord}`, readOk(await rest("GET", "parts/SB-PART-1", idToken)));
  // 3. parts create -- always DENY
  report(`[${label}] parts create DENY`, denied(await rest("POST", `parts?documentId=${freshId("sb-p")}`, idToken, { fields: { name: str("x") } })));
  // 4. parts update -- always DENY
  report(`[${label}] parts update DENY`, denied(await rest("PATCH", "parts/SB-PART-1", idToken, { fields: { name: str("y") } })));
  // 5. parts delete -- always DENY
  report(`[${label}] parts delete DENY`, denied(await rest("DELETE", "parts/SB-PART-1", idToken)));
  // 6. manufacturers read -- always DENY
  report(`[${label}] manufacturers read DENY`, denied(await rest("GET", "manufacturers/SB-MFR-1", idToken)));
  // 7. manufacturers write -- always DENY
  report(`[${label}] manufacturers write DENY`, denied(await rest("POST", `manufacturers?documentId=${freshId("sb-m")}`, idToken, { fields: { name: str("x") } })));
  // 8. part_aliases read -- always DENY
  report(`[${label}] part_aliases read DENY`, denied(await rest("GET", "part_aliases/SB-ALIAS-1", idToken)));
  // 9. part_aliases write -- always DENY
  report(`[${label}] part_aliases write DENY`, denied(await rest("POST", `part_aliases?documentId=${freshId("sb-a")}`, idToken, { fields: { alias: str("x") } })));
  // 10. part_supplier_items read -- always DENY
  report(`[${label}] part_supplier_items read DENY`, denied(await rest("GET", "part_supplier_items/SB-PSI-1", idToken)));
  // 11. part_supplier_items write -- always DENY
  report(`[${label}] part_supplier_items write DENY`, denied(await rest("POST", `part_supplier_items?documentId=${freshId("sb-s")}`, idToken, { fields: { supplierId: str("x") } })));
}

async function main() {
  const now = admin.firestore.FieldValue.serverTimestamp();

  // ---- Seed one document per governed collection (Admin SDK bypasses Rules).
  await db.doc("parts/SB-PART-1").set({ partId: "SB-PART-1", name: "Stage B Seed Part", status: "ACTIVE" });
  await db.doc("manufacturers/SB-MFR-1").set({ manufacturerId: "SB-MFR-1", name: "Seed Mfr", status: "ACTIVE" });
  await db.doc("part_aliases/SB-ALIAS-1").set({ partId: "SB-PART-1", alias: "SEED-ALIAS", aliasType: "INTERNAL_PN" });
  await db.doc("part_supplier_items/SB-PSI-1").set({ partId: "SB-PART-1", supplierId: "SUP-1" });

  // ---- Principal 3: admin (security role, no employee).
  await db.doc("users/sb-admin").set({ role: "admin" });
  // ---- Principal 4: dispatcher.
  await db.doc("users/sb-dispatcher").set({ role: "dispatcher" });

  // ---- Principal 5: active reciprocally-linked PARTS_MANAGER.
  await db.doc("employees/sb-emp-pm").set({
    employeeId: "sb-emp-pm", displayName: "Stage B PM", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "sb-pm", createdAt: now, updatedAt: now,
  });
  await db.doc("users/sb-pm").set({ role: "technician", employeeId: "sb-emp-pm" });

  // ---- Principal 6: active reciprocally-linked WAREHOUSE_MANAGER.
  await db.doc("employees/sb-emp-wm").set({
    employeeId: "sb-emp-wm", displayName: "Stage B WM", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], userId: "sb-wm", createdAt: now, updatedAt: now,
  });
  await db.doc("users/sb-wm").set({ role: "technician", employeeId: "sb-emp-wm" });

  // ---- Principal 7: active reciprocally-linked PARTS_ASSOCIATE ONLY (must be DENY).
  await db.doc("employees/sb-emp-pa").set({
    employeeId: "sb-emp-pa", displayName: "Stage B PA", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"], userId: "sb-pa", createdAt: now, updatedAt: now,
  });
  await db.doc("users/sb-pa").set({ role: "technician", employeeId: "sb-emp-pa" });

  // ---- Principal 8: technician WITHOUT a permitted operational role
  //      (reciprocally linked + ACTIVE, but operationalRoles empty).
  await db.doc("employees/sb-emp-tech").set({
    employeeId: "sb-emp-tech", displayName: "Stage B Tech", employmentStatus: "ACTIVE",
    operationalRoles: [], userId: "sb-tech", createdAt: now, updatedAt: now,
  });
  await db.doc("users/sb-tech").set({ role: "technician", employeeId: "sb-emp-tech" });

  // ---- Principal 9: suspended employee holding an otherwise-permitted role.
  await db.doc("employees/sb-emp-suspended").set({
    employeeId: "sb-emp-suspended", displayName: "Stage B Suspended", employmentStatus: "TERMINATED",
    operationalRoles: ["PARTS_MANAGER"], userId: "sb-suspended", createdAt: now, updatedAt: now,
  });
  await db.doc("users/sb-suspended").set({ role: "technician", employeeId: "sb-emp-suspended" });

  // ---- Principal 10: permitted role but BROKEN reciprocal linkage
  //      (employee doc exists, ACTIVE, PARTS_MANAGER, but its userId points
  //      at a DIFFERENT uid, so the reciprocal match fails).
  await db.doc("employees/sb-emp-broken").set({
    employeeId: "sb-emp-broken", displayName: "Stage B Broken", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "some-other-uid", createdAt: now, updatedAt: now,
  });
  await db.doc("users/sb-broken").set({ role: "technician", employeeId: "sb-emp-broken" });

  // ---- Principal 11: stale accessVersion with an otherwise-valid live
  //      PARTS_MANAGER record. The predicate never reads accessVersion; a
  //      low/stale accessVersion on the user doc (and a higher one implied
  //      elsewhere) must NOT change the live-record outcome -> ALLOW.
  await db.doc("employees/sb-emp-stale").set({
    employeeId: "sb-emp-stale", displayName: "Stage B Stale", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "sb-stale", createdAt: now, updatedAt: now,
  });
  await db.doc("users/sb-stale").set({ role: "technician", employeeId: "sb-emp-stale", accessVersion: 1 });

  // ---- Principal 2: authenticated WITHOUT application access
  //      (a user doc exists but has no role and no employeeId).
  await db.doc("users/sb-noaccess").set({ createdAt: now });

  // ---- Principal 12: malformed / MISSING user + employee documents.
  //      sb-missing authenticates but has NO users doc and NO employee doc.

  // Mint tokens.
  const tok = {
    admin: await idTokenFor("sb-admin"),
    dispatcher: await idTokenFor("sb-dispatcher"),
    pm: await idTokenFor("sb-pm"),
    wm: await idTokenFor("sb-wm"),
    pa: await idTokenFor("sb-pa"),
    tech: await idTokenFor("sb-tech"),
    suspended: await idTokenFor("sb-suspended"),
    broken: await idTokenFor("sb-broken"),
    stale: await idTokenFor("sb-stale"),
    noaccess: await idTokenFor("sb-noaccess"),
    missing: await idTokenFor("sb-missing"),
  };

  // ================= §5 12-principal matrix =================
  await probePrincipal("P01 signed-out", null, false);
  await probePrincipal("P02 authenticated-no-app-access", tok.noaccess, false);
  await probePrincipal("P03 admin", tok.admin, true);
  await probePrincipal("P04 dispatcher", tok.dispatcher, true);
  await probePrincipal("P05 active PARTS_MANAGER", tok.pm, true);
  await probePrincipal("P06 active WAREHOUSE_MANAGER", tok.wm, true);
  await probePrincipal("P07 active PARTS_ASSOCIATE only", tok.pa, false);
  await probePrincipal("P08 technician no operational role", tok.tech, false);
  await probePrincipal("P09 suspended employee (was PARTS_MANAGER)", tok.suspended, false);
  await probePrincipal("P10 broken reciprocal linkage", tok.broken, false);
  await probePrincipal("P11 stale accessVersion + live PARTS_MANAGER", tok.stale, true);
  await probePrincipal("P12 malformed/missing user+employee docs", tok.missing, false);

  // ================= Behavioral proofs =================

  // PROOF A: removing PARTS_MANAGER from the LIVE employee record -> DENY.
  await db.doc("employees/sb-emp-pm").update({ operationalRoles: [] });
  report("PROOF removing PARTS_MANAGER from live record -> parts single read DENY",
    denied(await rest("GET", "parts/SB-PART-1", tok.pm)));
  report("PROOF removing PARTS_MANAGER from live record -> parts list read DENY",
    denied(await rest("GET", "parts", tok.pm)));

  // PROOF B: restoring the role but employmentStatus != ACTIVE -> DENY.
  await db.doc("employees/sb-emp-pm").update({ operationalRoles: ["PARTS_MANAGER"], employmentStatus: "TERMINATED" });
  report("PROOF employmentStatus away from ACTIVE -> parts read DENY",
    denied(await rest("GET", "parts/SB-PART-1", tok.pm)));

  // PROOF C: restoring valid reciprocal linkage + approved role + ACTIVE -> ALLOW.
  await db.doc("employees/sb-emp-pm").update({ operationalRoles: ["PARTS_MANAGER"], employmentStatus: "ACTIVE" });
  report("PROOF restore ACTIVE + PARTS_MANAGER -> parts single read ALLOW",
    allowed(await rest("GET", "parts/SB-PART-1", tok.pm)));
  report("PROOF restore ACTIVE + PARTS_MANAGER -> parts list read ALLOW",
    allowed(await rest("GET", "parts", tok.pm)));

  // PROOF D: removing WAREHOUSE_MANAGER from the live record -> DENY.
  await db.doc("employees/sb-emp-wm").update({ operationalRoles: [] });
  report("PROOF removing WAREHOUSE_MANAGER from live record -> parts read DENY",
    denied(await rest("GET", "parts/SB-PART-1", tok.wm)));

  // PROOF E: a stale accessVersion ALONE does not affect this predicate.
  //          Bump the user's accessVersion mismatch further; the live
  //          PARTS_MANAGER record still governs -> still ALLOW.
  await db.doc("users/sb-stale").update({ accessVersion: 0 });
  report("PROOF stale accessVersion alone does not deny -> parts read ALLOW",
    allowed(await rest("GET", "parts/SB-PART-1", tok.stale)));

  // PROOF F: bare admin / dispatcher compatibility roles RETAIN existing read.
  report("PROOF bare admin retains parts read ALLOW", allowed(await rest("GET", "parts/SB-PART-1", tok.admin)));
  report("PROOF bare dispatcher retains parts read ALLOW", allowed(await rest("GET", "parts/SB-PART-1", tok.dispatcher)));

  // PROOF G: a bare technician security role grants NO canonical parts access.
  report("PROOF bare technician grants no parts read -> DENY", denied(await rest("GET", "parts/SB-PART-1", tok.tech)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
