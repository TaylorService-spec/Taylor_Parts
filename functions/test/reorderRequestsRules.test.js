// Zero-history reorder behavior sprint, PR 2 (docs/specifications/
// inventory-zero-history-reorder-behavior.md, docs/implementation-plans/
// inventory-zero-history-reorder-behavior.md). Firestore Rules emulator
// test for reorder_requests' TRANSITIONAL, dual-shape `create` rule --
// second Firestore Rules test in this repo, same zero-new-dependency
// posture as functions/test/employeesRules.test.js (firebase-admin +
// Node's built-in fetch against the emulator REST APIs, no
// @firebase/rules-unit-testing, no test runner).
//
// Prerequisite: run against a live Firestore + Auth emulator pair,
// e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/reorderRequestsRules.test.js
//
// This script is read/write only against the emulator
// (FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST below) -- it
// never touches the live "taylor-parts" project.
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

// Always PATCHes a never-before-used document ID, so this always
// exercises the `create` rule (not `update`) -- same convention as
// employeesRules.test.js's writeEmployee().
async function createReorderRequest(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/reorder_requests/${docId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const dbl = (v) => ({ doubleValue: v });
const nul = () => ({ nullValue: null });

function legacyShapeFields(partId = "PART-LEGACY") {
  // Exactly the shape the currently-deployed writer
  // (createReorderRequest() in domain/inventoryReorderRequests.js,
  // unchanged until PR 3) sends -- no recommendationStatus,
  // requestedQty, or quantitySource key at all.
  return {
    partId: str(partId),
    urgency: str("HIGH"),
    recommendedQty: int(5),
    status: str("PENDING_REVIEW"),
  };
}

function readyShapeFields({ partId = "PART-READY", requestedQty = 5, urgency = "HIGH", recommendedQty = 5, quantitySource = "ANALYTICS", recommendationStatus = "READY" } = {}) {
  return {
    partId: str(partId),
    recommendationStatus: str(recommendationStatus),
    urgency: str(urgency),
    quantitySource: str(quantitySource),
    recommendedQty: int(recommendedQty),
    requestedQty: int(requestedQty),
    status: str("PENDING_REVIEW"),
  };
}

function needsPlanningShapeFields({ partId = "PART-PLANNING", requestedQty = 3, quantitySource = "MANUAL_ZERO_HISTORY", urgencyValue, recommendedQtyValue } = {}) {
  return {
    partId: str(partId),
    recommendationStatus: str("NEEDS_PLANNING"),
    urgency: urgencyValue !== undefined ? urgencyValue : nul(),
    quantitySource: str(quantitySource),
    recommendedQty: recommendedQtyValue !== undefined ? recommendedQtyValue : nul(),
    requestedQty: requestedQty === null ? nul() : (typeof requestedQty === "object" ? requestedQty : int(requestedQty)),
    status: str("PENDING_REVIEW"),
  };
}

async function seed() {
  await db.doc("employees/emp-parts-manager-rr").set({
    employeeId: "emp-parts-manager-rr",
    displayName: "Parts Manager (Rules Test)",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"],
    userId: "user-technician-partsmanager-rr",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.doc("employees/emp-warehouse-manager-rr").set({
    employeeId: "emp-warehouse-manager-rr",
    displayName: "Warehouse Manager (Rules Test)",
    employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"],
    userId: "user-dispatcher-warehousemanager-rr",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.doc("employees/emp-no-role-rr").set({
    employeeId: "emp-no-role-rr",
    displayName: "No Operational Role (Rules Test)",
    employmentStatus: "ACTIVE",
    operationalRoles: [],
    userId: "user-dispatcher-noeligible-rr",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  await db.doc("users/user-admin-rr").set({ role: "admin" });
  await db.doc("users/user-dispatcher-rr").set({ role: "dispatcher" });
  await db.doc("users/user-technician-partsmanager-rr").set({ role: "technician", employeeId: "emp-parts-manager-rr" });
  await db.doc("users/user-dispatcher-warehousemanager-rr").set({ role: "dispatcher", employeeId: "emp-warehouse-manager-rr" });
  await db.doc("users/user-dispatcher-noeligible-rr").set({ role: "dispatcher", employeeId: "emp-no-role-rr" });
  await db.doc("users/user-technician-plain-rr").set({ role: "technician" });
}

async function main() {
  await seed();

  const [
    adminToken,
    dispatcherToken,
    technicianPartsManagerToken,
    dispatcherWarehouseManagerToken,
    dispatcherNoEligibleToken,
    technicianPlainToken,
  ] = await Promise.all([
    idTokenFor("user-admin-rr"),
    idTokenFor("user-dispatcher-rr"),
    idTokenFor("user-technician-partsmanager-rr"),
    idTokenFor("user-dispatcher-warehousemanager-rr"),
    idTokenFor("user-dispatcher-noeligible-rr"),
    idTokenFor("user-technician-plain-rr"),
  ]);

  // --- Transitional legacy-shape path (rollout step 1 safety check) ---

  report(
    "legacy shape (no recommendationStatus) accepted for admin",
    (await createReorderRequest("rr-legacy-admin", adminToken, legacyShapeFields("PART-LEGACY-1"))) === 200
  );
  report(
    "legacy shape (no recommendationStatus) accepted for dispatcher",
    (await createReorderRequest("rr-legacy-dispatcher", dispatcherToken, legacyShapeFields("PART-LEGACY-2"))) === 200
  );
  report(
    "legacy shape rejected for technician (isAdminOrDispatcher() still enforced)",
    (await createReorderRequest("rr-legacy-technician", technicianPlainToken, legacyShapeFields("PART-LEGACY-3"))) === 403
  );

  // --- New shape: READY path ---

  report(
    "READY with requestedQty: 0 accepted (0 is a legitimate computed value)",
    (await createReorderRequest("rr-ready-zero-qty", adminToken, readyShapeFields({ partId: "PART-R1", requestedQty: 0, recommendedQty: 0 }))) === 200
  );
  report(
    "READY with a normal positive requestedQty accepted",
    (await createReorderRequest("rr-ready-normal", dispatcherToken, readyShapeFields({ partId: "PART-R2" }))) === 200
  );
  report(
    "READY rejected for technician (isAdminOrDispatcher() required, unchanged from pre-PR-2)",
    (await createReorderRequest("rr-ready-technician", technicianPlainToken, readyShapeFields({ partId: "PART-R3" }))) === 403
  );
  report(
    "READY with negative requestedQty rejected",
    (await createReorderRequest("rr-ready-negative-qty", adminToken, readyShapeFields({ partId: "PART-R4", requestedQty: -1 }))) === 403
  );
  report(
    "READY with non-integer requestedQty rejected",
    (await createReorderRequest(
      "rr-ready-noninteger-qty",
      adminToken,
      { ...readyShapeFields({ partId: "PART-R5" }), requestedQty: dbl(2.5) }
    )) === 403
  );
  report(
    "READY with quantitySource MANUAL_ZERO_HISTORY rejected (mismatched combination)",
    (await createReorderRequest(
      "rr-ready-wrong-source",
      adminToken,
      readyShapeFields({ partId: "PART-R6", quantitySource: "MANUAL_ZERO_HISTORY" })
    )) === 403
  );
  report(
    "READY with invalid urgency value rejected",
    (await createReorderRequest(
      "rr-ready-bad-urgency",
      adminToken,
      { ...readyShapeFields({ partId: "PART-R7" }), urgency: str("SEVERE") }
    )) === 403
  );

  // --- New shape: NEEDS_PLANNING path ---

  report(
    "NEEDS_PLANNING with requestedQty: 0 rejected (manual entry must be positive)",
    (await createReorderRequest("rr-planning-zero-qty", adminToken, needsPlanningShapeFields({ partId: "PART-P1", requestedQty: 0 }))) === 403
  );
  report(
    "NEEDS_PLANNING with negative requestedQty rejected",
    (await createReorderRequest("rr-planning-negative-qty", adminToken, needsPlanningShapeFields({ partId: "PART-P2", requestedQty: -3 }))) === 403
  );
  report(
    "NEEDS_PLANNING with non-integer requestedQty rejected",
    (await createReorderRequest("rr-planning-noninteger-qty", adminToken, needsPlanningShapeFields({ partId: "PART-P3", requestedQty: dbl(3.5) }))) === 403
  );
  report(
    "NEEDS_PLANNING with non-null urgency rejected (must be null)",
    (await createReorderRequest("rr-planning-nonnull-urgency", adminToken, needsPlanningShapeFields({ partId: "PART-P4", urgencyValue: str("LOW") }))) === 403
  );
  report(
    "NEEDS_PLANNING with non-null recommendedQty rejected (must be null)",
    (await createReorderRequest("rr-planning-nonnull-recqty", adminToken, needsPlanningShapeFields({ partId: "PART-P5", recommendedQtyValue: int(0) }))) === 403
  );
  report(
    "NEEDS_PLANNING with quantitySource ANALYTICS rejected (mismatched combination)",
    (await createReorderRequest("rr-planning-wrong-source", adminToken, needsPlanningShapeFields({ partId: "PART-P6", quantitySource: "ANALYTICS" }))) === 403
  );

  // Authorization matrix -- the exact scenarios Defect 2 (branch-scoped
  // vs. layered authorization) must not regress on.
  report(
    "NEEDS_PLANNING rejected for dispatcher with no eligible operationalRoles",
    (await createReorderRequest("rr-planning-dispatcher-noeligible", dispatcherNoEligibleToken, needsPlanningShapeFields({ partId: "PART-P7" }))) === 403
  );
  report(
    "NEEDS_PLANNING rejected for dispatcher with no linked Employee at all",
    (await createReorderRequest("rr-planning-dispatcher-plain", dispatcherToken, needsPlanningShapeFields({ partId: "PART-P8" }))) === 403
  );
  report(
    "NEEDS_PLANNING accepted for technician whose linked Employee has operationalRoles: [PARTS_MANAGER] (Defect 2 regression case)",
    (await createReorderRequest("rr-planning-technician-partsmanager", technicianPartsManagerToken, needsPlanningShapeFields({ partId: "PART-P9" }))) === 200
  );
  report(
    "NEEDS_PLANNING accepted for dispatcher whose linked Employee has operationalRoles: [WAREHOUSE_MANAGER]",
    (await createReorderRequest("rr-planning-dispatcher-warehousemanager", dispatcherWarehouseManagerToken, needsPlanningShapeFields({ partId: "PART-P10" }))) === 200
  );
  report(
    "NEEDS_PLANNING accepted for admin (override)",
    (await createReorderRequest("rr-planning-admin", adminToken, needsPlanningShapeFields({ partId: "PART-P11" }))) === 200
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
