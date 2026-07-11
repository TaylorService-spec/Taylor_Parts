// Zero-history reorder behavior sprint, PR 2 (docs/specifications/
// inventory-zero-history-reorder-behavior.md, docs/implementation-plans/
// inventory-zero-history-reorder-behavior.md). Firestore Rules emulator
// test for reorder_requests' `create` rule -- second Firestore Rules
// test in this repo, same zero-new-dependency posture as
// functions/test/employeesRules.test.js (firebase-admin + Node's
// built-in fetch against the emulator REST APIs, no
// @firebase/rules-unit-testing, no test runner).
//
// Extended by PR 4 (rollout step 3): the rule is no longer
// TRANSITIONAL/dual-shape -- PR 2's legacy branch (no
// recommendationStatus key -> isAdminOrDispatcher() only) has been
// removed. Of the three legacy-shape assertions below, the admin and
// dispatcher cases are inverted (200 -> 403, PR 2's original
// expectation was acceptance); the technician case was already 403
// under PR 2 (isAdminOrDispatcher() rejected it regardless of shape)
// and is only relabeled here to reflect the new reason. See the PR 4
// section below.
//
// Revised after Codex's REQUEST CHANGES on PR #91: the new-shape
// branch originally validated only the recommendation fields, leaving
// status/currentOwner/requestedBy/every lifecycle field unconstrained
// -- a real privilege-escalation gap once NEEDS_PLANNING widened who
// may create at all beyond admin/dispatcher. firestore.rules now
// enforces the complete, exact creation contract
// (hasCanonicalReorderRequestKeys()/...CreationBaseline()) for both
// READY and NEEDS_PLANNING, so every "valid" payload below must now
// send the full canonical field set, not just the recommendation
// fields -- see canonicalFields() below.
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

// Sprint 2.1.11 -- Receiving. PATCHes an EXISTING document with an
// explicit updateMask (only the given field paths), so this exercises
// the `update` rule against a client-SDK-shaped partial write -- the
// same request.resource.data == "merged existing doc + these fields"
// semantics domain/inventoryReorderRequests.js's
// reorderRequestsStore.update() produces, not a full-document replace.
async function updateReorderRequest(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOC_BASE}/reorder_requests/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

// Seeds a full canonical Reorder Request document directly via the
// Admin SDK (bypasses Rules entirely, same as seed() below) so update-
// rule tests can start from an arbitrary, valid lifecycle state
// without depending on the create rule or every prior transition
// actually succeeding first.
async function seedReorderRequest(docId, { partId, status, assignedToUserId, purchaseOrderId }) {
  await db.doc(`reorder_requests/${docId}`).set({
    partId,
    recommendationStatus: "READY",
    urgency: "HIGH",
    quantitySource: "ANALYTICS",
    recommendedQty: 5,
    requestedQty: 5,
    status,
    currentOwner: "PARTS_ASSOCIATE",
    requestedBy: "user-admin-rr",
    createdAt: Date.now(),
    reviewedBy: "user-admin-rr",
    reviewedAt: Date.now(),
    reviewDecision: "APPROVED",
    reviewNotes: null,
    assignedToUserId,
    assignedBy: "user-admin-rr",
    assignedAt: Date.now(),
    purchasingStartedAt: Date.now(),
    purchasingStartedBy: assignedToUserId,
    purchasingNotes: null,
    vendorContacted: true,
    expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: Date.now(),
    lastPurchasingUpdateBy: assignedToUserId,
    purchaseOrderId: purchaseOrderId ?? null,
    orderedBy: purchaseOrderId ? assignedToUserId : null,
    orderedAt: purchaseOrderId ? Date.now() : null,
    receivedBy: null,
    receivedAt: null,
  });
}

const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const dbl = (v) => ({ doubleValue: v });
const nul = () => ({ nullValue: null });

function legacyShapeFields(partId = "PART-LEGACY") {
  // Zero-history reorder behavior sprint, PR 4. Exactly the shape the
  // pre-PR-3 writer used to send -- no recommendationStatus,
  // requestedQty, or quantitySource key at all. PR 2's transitional
  // legacy branch used to accept this unconditionally
  // (isAdminOrDispatcher() only); PR 4 removed that branch, so this
  // shape must now be REJECTED for every caller. The admin and
  // dispatcher assertions below are inverted from PR 2's version of
  // this test (200 -> 403), proving the gap is actually closed; the
  // technician assertion was already 403 under PR 2 and is kept here
  // as an unchanged regression baseline, not an inversion.
  return {
    partId: str(partId),
    urgency: str("HIGH"),
    recommendedQty: int(5),
    status: str("PENDING_REVIEW"),
  };
}

// The complete, exact 29-key shape firestore.rules'
// hasCanonicalReorderRequestKeys()/...CreationBaseline() now require
// for the new (recommendationStatus-bearing) branch -- mirrors
// domain/inventoryReorderRequests.js's createReorderRequest() plus
// the 3 new recommendation fields PR 3 added and Sprint 2.1.11's
// receivedBy/receivedAt (also null at creation, same as every other
// future-stage field). `overrides` lets individual tests deviate from
// a valid baseline (forge a field, change a type, etc.) without
// duplicating the whole shape each time.
function canonicalFields({
  partId,
  recommendationStatus,
  urgency,
  quantitySource,
  recommendedQty,
  requestedQty,
  requestedByUid,
  status = "PENDING_REVIEW",
  currentOwner = "INVENTORY",
  overrides = {},
}) {
  const base = {
    partId: str(partId),
    recommendationStatus: str(recommendationStatus),
    urgency,
    quantitySource: str(quantitySource),
    recommendedQty,
    requestedQty,
    status: str(status),
    currentOwner: str(currentOwner),
    requestedBy: str(requestedByUid),
    createdAt: int(Date.now()),
    reviewedBy: nul(),
    reviewedAt: nul(),
    reviewDecision: nul(),
    reviewNotes: nul(),
    assignedToUserId: nul(),
    assignedBy: nul(),
    assignedAt: nul(),
    purchasingStartedAt: nul(),
    purchasingStartedBy: nul(),
    purchasingNotes: nul(),
    vendorContacted: nul(),
    expectedAvailabilityDate: nul(),
    lastPurchasingUpdateAt: nul(),
    lastPurchasingUpdateBy: nul(),
    purchaseOrderId: nul(),
    orderedBy: nul(),
    orderedAt: nul(),
    receivedBy: nul(),
    receivedAt: nul(),
  };
  return { ...base, ...overrides };
}

function readyFields({ partId, requestedByUid, requestedQty = 5, recommendedQty = 5, urgency = "HIGH", quantitySource = "ANALYTICS", status, currentOwner, overrides }) {
  return canonicalFields({
    partId,
    recommendationStatus: "READY",
    urgency: str(urgency),
    quantitySource,
    recommendedQty: int(recommendedQty),
    requestedQty: typeof requestedQty === "object" ? requestedQty : int(requestedQty),
    requestedByUid,
    status,
    currentOwner,
    overrides,
  });
}

function planningFields({ partId, requestedByUid, requestedQty = 3, urgency = nul(), recommendedQty = nul(), quantitySource = "MANUAL_ZERO_HISTORY", status, currentOwner, overrides }) {
  return canonicalFields({
    partId,
    recommendationStatus: "NEEDS_PLANNING",
    urgency,
    quantitySource,
    recommendedQty,
    requestedQty: requestedQty === null ? nul() : (typeof requestedQty === "object" ? requestedQty : int(requestedQty)),
    requestedByUid,
    status,
    currentOwner,
    overrides,
  });
}

function omit(fields, ...keys) {
  const copy = { ...fields };
  for (const key of keys) delete copy[key];
  return copy;
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

  // --- PR 4: legacy-shape path now rejected unconditionally (rollout step 3, gap closed) ---

  report(
    "legacy shape (no recommendationStatus) now rejected for admin (PR 4 removed the transitional branch)",
    (await createReorderRequest("rr-legacy-admin", adminToken, legacyShapeFields("PART-LEGACY-1"))) === 403
  );
  report(
    "legacy shape (no recommendationStatus) now rejected for dispatcher (PR 4 removed the transitional branch)",
    (await createReorderRequest("rr-legacy-dispatcher", dispatcherToken, legacyShapeFields("PART-LEGACY-2"))) === 403
  );
  report(
    "legacy shape still rejected for technician (isAdminOrDispatcher() was never the only gate for this shape's rejection)",
    (await createReorderRequest("rr-legacy-technician", technicianPlainToken, legacyShapeFields("PART-LEGACY-3"))) === 403
  );

  // --- New shape: READY path ---

  report(
    "READY with requestedQty: 0 accepted (0 is a legitimate computed value)",
    (await createReorderRequest("rr-ready-zero-qty", adminToken, readyFields({ partId: "PART-R1", requestedByUid: "user-admin-rr", requestedQty: 0, recommendedQty: 0 }))) === 200
  );
  report(
    "READY with a normal positive requestedQty accepted",
    (await createReorderRequest("rr-ready-normal", dispatcherToken, readyFields({ partId: "PART-R2", requestedByUid: "user-dispatcher-rr" }))) === 200
  );
  report(
    "READY rejected for technician (isAdminOrDispatcher() required, unchanged from pre-PR-2)",
    (await createReorderRequest("rr-ready-technician", technicianPlainToken, readyFields({ partId: "PART-R3", requestedByUid: "user-technician-plain-rr" }))) === 403
  );
  report(
    "READY with negative requestedQty rejected",
    (await createReorderRequest("rr-ready-negative-qty", adminToken, readyFields({ partId: "PART-R4", requestedByUid: "user-admin-rr", requestedQty: -1 }))) === 403
  );
  report(
    "READY with non-integer requestedQty rejected",
    (await createReorderRequest("rr-ready-noninteger-qty", adminToken, readyFields({ partId: "PART-R5", requestedByUid: "user-admin-rr", requestedQty: dbl(2.5) }))) === 403
  );
  report(
    "READY with quantitySource MANUAL_ZERO_HISTORY rejected (mismatched combination)",
    (await createReorderRequest("rr-ready-wrong-source", adminToken, readyFields({ partId: "PART-R6", requestedByUid: "user-admin-rr", quantitySource: "MANUAL_ZERO_HISTORY" }))) === 403
  );
  report(
    "READY with invalid urgency value rejected",
    (await createReorderRequest("rr-ready-bad-urgency", adminToken, readyFields({ partId: "PART-R7", requestedByUid: "user-admin-rr", overrides: { urgency: str("SEVERE") } }))) === 403
  );

  // --- New shape: NEEDS_PLANNING path ---

  report(
    "NEEDS_PLANNING with requestedQty: 0 rejected (manual entry must be positive)",
    (await createReorderRequest("rr-planning-zero-qty", adminToken, planningFields({ partId: "PART-P1", requestedByUid: "user-admin-rr", requestedQty: 0 }))) === 403
  );
  report(
    "NEEDS_PLANNING with negative requestedQty rejected",
    (await createReorderRequest("rr-planning-negative-qty", adminToken, planningFields({ partId: "PART-P2", requestedByUid: "user-admin-rr", requestedQty: -3 }))) === 403
  );
  report(
    "NEEDS_PLANNING with non-integer requestedQty rejected",
    (await createReorderRequest("rr-planning-noninteger-qty", adminToken, planningFields({ partId: "PART-P3", requestedByUid: "user-admin-rr", requestedQty: dbl(3.5) }))) === 403
  );
  report(
    "NEEDS_PLANNING with non-null urgency rejected (must be null)",
    (await createReorderRequest("rr-planning-nonnull-urgency", adminToken, planningFields({ partId: "PART-P4", requestedByUid: "user-admin-rr", urgency: str("LOW") }))) === 403
  );
  report(
    "NEEDS_PLANNING with non-null recommendedQty rejected (must be null)",
    (await createReorderRequest("rr-planning-nonnull-recqty", adminToken, planningFields({ partId: "PART-P5", requestedByUid: "user-admin-rr", recommendedQty: int(0) }))) === 403
  );
  report(
    "NEEDS_PLANNING with quantitySource ANALYTICS rejected (mismatched combination)",
    (await createReorderRequest("rr-planning-wrong-source", adminToken, planningFields({ partId: "PART-P6", requestedByUid: "user-admin-rr", quantitySource: "ANALYTICS" }))) === 403
  );

  // Authorization matrix -- the exact scenarios the Specification's
  // Defect 2 (branch-scoped vs. layered authorization) must not
  // regress on.
  report(
    "NEEDS_PLANNING rejected for dispatcher with no eligible operationalRoles",
    (await createReorderRequest("rr-planning-dispatcher-noeligible", dispatcherNoEligibleToken, planningFields({ partId: "PART-P7", requestedByUid: "user-dispatcher-noeligible-rr" }))) === 403
  );
  report(
    "NEEDS_PLANNING rejected for dispatcher with no linked Employee at all",
    (await createReorderRequest("rr-planning-dispatcher-plain", dispatcherToken, planningFields({ partId: "PART-P8", requestedByUid: "user-dispatcher-rr" }))) === 403
  );
  report(
    "NEEDS_PLANNING accepted for technician whose linked Employee has operationalRoles: [PARTS_MANAGER] (Defect 2 regression case)",
    (await createReorderRequest("rr-planning-technician-partsmanager", technicianPartsManagerToken, planningFields({ partId: "PART-P9", requestedByUid: "user-technician-partsmanager-rr" }))) === 200
  );
  report(
    "NEEDS_PLANNING accepted for dispatcher whose linked Employee has operationalRoles: [WAREHOUSE_MANAGER]",
    (await createReorderRequest("rr-planning-dispatcher-warehousemanager", dispatcherWarehouseManagerToken, planningFields({ partId: "PART-P10", requestedByUid: "user-dispatcher-warehousemanager-rr" }))) === 200
  );
  report(
    "NEEDS_PLANNING accepted for admin (override)",
    (await createReorderRequest("rr-planning-admin", adminToken, planningFields({ partId: "PART-P11", requestedByUid: "user-admin-rr" }))) === 200
  );

  // --- Codex REQUEST CHANGES on PR #91: complete-schema enforcement ---
  // The exact scenarios the finding asked for -- a NEEDS_PLANNING
  // submitter who is NOT admin/dispatcher (the newly-widened
  // authority) attempting to forge lifecycle state that only the
  // update rules should ever be able to set.

  report(
    "NEEDS_PLANNING with forged status (ORDERED) rejected, even from an eligible non-admin/dispatcher submitter",
    (await createReorderRequest(
      "rr-planning-forged-status",
      technicianPartsManagerToken,
      planningFields({ partId: "PART-P12", requestedByUid: "user-technician-partsmanager-rr", status: "ORDERED" })
    )) === 403
  );
  report(
    "NEEDS_PLANNING with forged currentOwner (PARTS_MANAGER) rejected",
    (await createReorderRequest(
      "rr-planning-forged-owner",
      technicianPartsManagerToken,
      planningFields({ partId: "PART-P13", requestedByUid: "user-technician-partsmanager-rr", currentOwner: "PARTS_MANAGER" })
    )) === 403
  );
  report(
    "NEEDS_PLANNING with spoofed requestedBy (a different uid than the caller) rejected",
    (await createReorderRequest(
      "rr-planning-spoofed-requestedby",
      technicianPartsManagerToken,
      planningFields({ partId: "PART-P14", requestedByUid: "user-admin-rr" })
    )) === 403
  );
  report(
    "NEEDS_PLANNING with requestedBy missing entirely rejected",
    (await createReorderRequest(
      "rr-planning-missing-requestedby",
      technicianPartsManagerToken,
      omit(planningFields({ partId: "PART-P15", requestedByUid: "user-technician-partsmanager-rr" }), "requestedBy")
    )) === 403
  );
  report(
    "NEEDS_PLANNING with a required lifecycle field missing (reviewedBy) rejected",
    (await createReorderRequest(
      "rr-planning-missing-lifecycle-field",
      technicianPartsManagerToken,
      omit(planningFields({ partId: "PART-P16", requestedByUid: "user-technician-partsmanager-rr" }), "reviewedBy")
    )) === 403
  );
  report(
    "NEEDS_PLANNING with an unexpected extra field rejected",
    (await createReorderRequest(
      "rr-planning-extra-field",
      technicianPartsManagerToken,
      { ...planningFields({ partId: "PART-P17", requestedByUid: "user-technician-partsmanager-rr" }), notes: str("this key is not part of the canonical schema") }
    )) === 403
  );
  report(
    "READY with forged status (ORDERED) rejected too (schema check applies to both branches, not just NEEDS_PLANNING)",
    (await createReorderRequest(
      "rr-ready-forged-status",
      adminToken,
      readyFields({ partId: "PART-R8", requestedByUid: "user-admin-rr", status: "ORDERED" })
    )) === 403
  );

  // --- Sprint 2.1.11 -- Receiving (Reorder Request closeout) ---
  // Terminal ORDERED -> RECEIVED transition, assignee-only.

  await seedReorderRequest("rr-received-happy-path", {
    partId: "PART-RECV1",
    status: "ORDERED",
    assignedToUserId: "user-admin-rr",
    purchaseOrderId: "rr-received-happy-path",
  });
  report(
    "ORDERED -> RECEIVED accepted for the assignee",
    (await updateReorderRequest("rr-received-happy-path", adminToken, {
      status: str("RECEIVED"),
      receivedBy: str("user-admin-rr"),
      receivedAt: int(Date.now()),
    })) === 200
  );

  await seedReorderRequest("rr-received-non-assignee", {
    partId: "PART-RECV2",
    status: "ORDERED",
    assignedToUserId: "user-admin-rr",
    purchaseOrderId: "rr-received-non-assignee",
  });
  report(
    "ORDERED -> RECEIVED rejected for a non-assignee admin/dispatcher user",
    (await updateReorderRequest("rr-received-non-assignee", dispatcherToken, {
      status: str("RECEIVED"),
      receivedBy: str("user-dispatcher-rr"),
      receivedAt: int(Date.now()),
    })) === 403
  );

  await seedReorderRequest("rr-received-wrong-source-status", {
    partId: "PART-RECV3",
    status: "PURCHASING_IN_PROGRESS",
    assignedToUserId: "user-admin-rr",
  });
  report(
    "PURCHASING_IN_PROGRESS -> RECEIVED rejected (must come from ORDERED, no skipping)",
    (await updateReorderRequest("rr-received-wrong-source-status", adminToken, {
      status: str("RECEIVED"),
      receivedBy: str("user-admin-rr"),
      receivedAt: int(Date.now()),
    })) === 403
  );

  await seedReorderRequest("rr-received-forged-receivedby", {
    partId: "PART-RECV4",
    status: "ORDERED",
    assignedToUserId: "user-admin-rr",
    purchaseOrderId: "rr-received-forged-receivedby",
  });
  report(
    "ORDERED -> RECEIVED rejected when receivedBy doesn't match the caller's own uid",
    (await updateReorderRequest("rr-received-forged-receivedby", adminToken, {
      status: str("RECEIVED"),
      receivedBy: str("user-dispatcher-rr"),
      receivedAt: int(Date.now()),
    })) === 403
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
