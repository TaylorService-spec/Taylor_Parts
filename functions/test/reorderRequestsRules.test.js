// Zero-history reorder behavior sprint, PR 2 (docs/specifications/
// inventory-zero-history-reorder-behavior.md, docs/implementation-plans/
// inventory-zero-history-reorder-behavior.md). Firestore Rules emulator
// test for reorder_requests' `create` rule -- second Firestore Rules
// test in this repo, same zero-new-dependency posture as
// functions/test/employeesRules.test.js (firebase-admin + Node's
// built-in fetch against the emulator REST APIs, no
// @firebase/rules-unit-testing, no test runner).
//
// Extended again by the Cancel/Void schema deployment sequence's step A
// (docs/specifications/reorder-request-cancellation.md,
// docs/implementation-plans/reorder-request-cancellation.md PR 1):
// hasCanonicalReorderRequestKeys()/...CreationBaseline() were TRANSITIONAL/
// dual-shape, accepting the current 29-key shape OR a new 35-key shape
// (the same 29 plus six new Cancel/Void fields, present and explicitly
// null).
//
// Tightened by step D (Implementation Plan PR 3): the transitional
// 29-key-only branch is REMOVED -- canonicalFields() (below) now
// includes the six Cancel/Void fields (all null) as part of its
// unconditional base shape, so every "accepted" test throughout this
// file exercises the tightened 35-key contract by default. See the
// section right before "Sprint 2.1.11 -- Receiving" below for the
// dedicated old-shape-now-rejected/partial-presence/non-null coverage.
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

// Generic DELETE against any collection/docId, reused by both
// reorder_purchase_order_voids' and reorder_purchase_orders' own
// immutability tests below (both are `allow update, delete: if
// false`).
async function deleteDocAt(collection, docId, idToken) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { method: "DELETE", headers });
  return res.status;
}

// Cancel/Void schema deployment sequence, PR 5 of 6 (docs/specifications/
// reorder-request-cancellation.md) -- Void Purchase Order single-doc
// helpers, same PATCH-per-collection convention as
// createReorderRequest()/updateReorderRequest() above.
async function createReorderPurchaseOrderVoid(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/reorder_purchase_order_voids/${docId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function updateReorderPurchaseOrderVoid(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOC_BASE}/reorder_purchase_order_voids/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function updateReorderPurchaseOrder(docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(fields)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const res = await fetch(`${DOC_BASE}/reorder_purchase_orders/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

// Performs the SAME atomic two-write commit voidPurchaseOrder()'s
// runTransaction() sends -- one update to reorder_requests, one create
// on reorder_purchase_order_voids, in a SINGLE Firestore commit -- via
// the emulator's raw documents:commit REST endpoint (no
// @firebase/rules-unit-testing, same zero-new-dependency posture as
// every other helper in this file). This is the only way to exercise
// the VOIDED branch's getAfter()/existsAfter() cross-document
// invariant honestly: a real transaction, not two independent PATCH
// calls (which would each be evaluated against Rules separately and
// could never satisfy each other's post-transaction-state checks).
async function voidCommit(requestId, idToken, { requestFields, voidFields }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const writes = [
    {
      update: { name: `${base}/reorder_requests/${requestId}`, fields: requestFields },
      updateMask: { fieldPaths: Object.keys(requestFields) },
    },
  ];
  if (voidFields !== null) {
    writes.push({
      update: { name: `${base}/reorder_purchase_order_voids/${requestId}`, fields: voidFields },
    });
  }
  const res = await fetch(`${DOC_BASE}:commit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ writes }),
  });
  return res.status;
}

// Seeds a Reorder Purchase Order document directly via the Admin SDK
// (bypasses Rules entirely, same as seedReorderRequest() below) so
// Void tests can start from an arbitrary, valid ORDERED state without
// depending on recordPurchaseOrder()'s own create rule succeeding
// first.
async function seedReorderPurchaseOrder(docId, { reorderRequestId, partId, status }) {
  await db.doc(`reorder_purchase_orders/${docId}`).set({
    reorderRequestId,
    partId,
    supplierName: "Acme Parts Co.",
    externalPoNumber: "PO-12345",
    orderedQuantity: 10,
    orderedDate: "2026-07-01",
    expectedArrivalDate: null,
    status,
    createdBy: "user-admin-rr",
    createdAt: Date.now(),
  });
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
    // Cancel/Void schema deployment sequence, step D (Implementation
    // Plan PR 3) -- these six fields are now part of the unconditional
    // canonical shape, not an optional extra. Every test using
    // canonicalFields()/readyFields()/planningFields() throughout this
    // file now exercises the tightened (35-key) contract by default.
    cancelledBy: nul(),
    cancelledAt: nul(),
    cancellationReason: nul(),
    voidedBy: nul(),
    voidedAt: nul(),
    voidReason: nul(),
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

  // --- Cancel/Void schema deployment sequence, step D (docs/specifications/
  // reorder-request-cancellation.md, Implementation Plan PR 3) ---
  // hasCanonicalReorderRequestKeys()/...CreationBaseline() are now
  // TIGHTENED -- the transitional 29-key-only branch (Implementation
  // Plan PR 1) is removed. canonicalFields() (above) includes all six
  // Cancel/Void fields (null) unconditionally, so every "accepted" test
  // in this file already exercises the tightened 35-key contract. This
  // section proves: (1) the new/only shape is still accepted, (2) the
  // OLD 29-key shape (six fields entirely absent) is now rejected --
  // the behavior this PR changes, (3) partial presence is rejected,
  // (4) a non-null value among the six is rejected.
  const ALL_SIX_CANCEL_VOID_KEYS = ["cancelledBy", "cancelledAt", "cancellationReason", "voidedBy", "voidedAt", "voidReason"];

  report(
    "READY with all six Cancel/Void fields present and null accepted (tightened shape)",
    (await createReorderRequest(
      "rr-ready-cancelvoid-shape",
      adminToken,
      readyFields({ partId: "PART-CV1", requestedByUid: "user-admin-rr" })
    )) === 200
  );
  report(
    "NEEDS_PLANNING with all six Cancel/Void fields present and null accepted (tightened shape)",
    (await createReorderRequest(
      "rr-planning-cancelvoid-shape",
      technicianPartsManagerToken,
      planningFields({ partId: "PART-CV2", requestedByUid: "user-technician-partsmanager-rr" })
    )) === 200
  );
  report(
    "READY in the OLD 29-key shape (all six Cancel/Void fields entirely absent) now rejected (PR 3 removed the transitional branch)",
    (await createReorderRequest(
      "rr-ready-cancelvoid-oldshape",
      adminToken,
      omit(readyFields({ partId: "PART-CV6", requestedByUid: "user-admin-rr" }), ...ALL_SIX_CANCEL_VOID_KEYS)
    )) === 403
  );
  report(
    "NEEDS_PLANNING in the OLD 29-key shape (all six Cancel/Void fields entirely absent) now rejected (PR 3 removed the transitional branch)",
    (await createReorderRequest(
      "rr-planning-cancelvoid-oldshape",
      technicianPartsManagerToken,
      omit(planningFields({ partId: "PART-CV7", requestedByUid: "user-technician-partsmanager-rr" }), ...ALL_SIX_CANCEL_VOID_KEYS)
    )) === 403
  );
  report(
    "READY with only ONE of the six Cancel/Void fields present rejected (partial presence, matches neither exact-key branch)",
    (await createReorderRequest(
      "rr-ready-cancelvoid-partial",
      adminToken,
      omit(readyFields({ partId: "PART-CV3", requestedByUid: "user-admin-rr" }), ...ALL_SIX_CANCEL_VOID_KEYS.filter((k) => k !== "cancelledBy"))
    )) === 403
  );
  report(
    "READY with only THREE of the six Cancel/Void fields present rejected (partial presence)",
    (await createReorderRequest(
      "rr-ready-cancelvoid-partial2",
      adminToken,
      omit(readyFields({ partId: "PART-CV4", requestedByUid: "user-admin-rr" }), "voidedBy", "voidedAt", "voidReason")
    )) === 403
  );
  report(
    "READY with all six Cancel/Void fields present but one non-null rejected (must be all-null, not merely present)",
    (await createReorderRequest(
      "rr-ready-cancelvoid-nonnull",
      adminToken,
      readyFields({ partId: "PART-CV5", requestedByUid: "user-admin-rr", overrides: { cancelledAt: int(Date.now()) } })
    )) === 403
  );
  report(
    "READY with an unknown extra key alongside the full 35-key shape rejected",
    (await createReorderRequest(
      "rr-ready-cancelvoid-extrakey",
      adminToken,
      readyFields({ partId: "PART-CV8", requestedByUid: "user-admin-rr", overrides: { unexpectedExtraField: str("x") } })
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

  // --- Cancel/Void schema deployment sequence, PR 4 of 6 (docs/specifications/
  // reorder-request-cancellation.md) -- Cancel Reorder Request ---
  // seedReorderRequest() (above) never sets the six Cancel/Void fields --
  // every document it seeds is already a genuine legacy-shape document
  // (the fields are entirely absent, not null), so these tests exercise
  // the Specification's "Legacy document behavior" section by
  // construction, not as a special case.

  await seedReorderRequest("rr-cancel-from-ready-for-pm", {
    partId: "PART-CANCEL1",
    status: "READY_FOR_PARTS_MANAGER",
    assignedToUserId: null,
  });
  report(
    "READY_FOR_PARTS_MANAGER -> CANCELLED accepted for admin, with a genuine reason",
    (await updateReorderRequest("rr-cancel-from-ready-for-pm", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Duplicate request, already ordered under PART-CANCEL9"),
    })) === 200
  );

  await seedReorderRequest("rr-cancel-from-assigned", {
    partId: "PART-CANCEL2",
    status: "ASSIGNED_TO_PARTS_ASSOCIATE",
    assignedToUserId: "user-technician-partsmanager-rr",
  });

  // Legacy-document Cancel test obligation (Implementation Plan PR 4),
  // strengthened per ChatGPT's REQUEST CHANGES: capture the COMPLETE
  // pre-transition document (seedReorderRequest() above never sets the
  // six Cancel/Void keys, so this is a genuine legacy-shape document --
  // the keys are entirely absent, not null), perform the Cancel, then
  // capture the COMPLETE post-transition document and compare the two
  // directly instead of sampling a few fields.
  const preCancelSnapshot = (await db.doc("reorder_requests/rr-cancel-from-assigned").get()).data();

  report(
    "ASSIGNED_TO_PARTS_ASSOCIATE -> CANCELLED accepted for dispatcher (not just admin, not just the assignee)",
    (await updateReorderRequest("rr-cancel-from-assigned", dispatcherToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-dispatcher-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Part no longer needed"),
    })) === 200
  );

  {
    const postCancelSnapshot = (await db.doc("reorder_requests/rr-cancel-from-assigned").get()).data();
    const OWNED_KEYS = ["status", "cancelledBy", "cancelledAt", "cancellationReason"];
    const preKeys = new Set(Object.keys(preCancelSnapshot));
    const postKeys = new Set(Object.keys(postCancelSnapshot));
    const expectedPostKeys = new Set([...preKeys, "cancelledBy", "cancelledAt", "cancellationReason"]);

    // Post-transition key set equals the original key set plus exactly
    // the three new Cancel fields (status already existed pre-transition
    // as a key -- only its value changes, not the key set).
    const keySetMatches =
      postKeys.size === expectedPostKeys.size &&
      [...expectedPostKeys].every((key) => postKeys.has(key)) &&
      [...postKeys].every((key) => expectedPostKeys.has(key));

    // Every field NOT one of the four owned keys is byte-for-byte
    // unchanged from the pre-transition snapshot -- not a sample of a
    // few fields, every single one seedReorderRequest() set.
    const everyOtherFieldPinned = [...preKeys]
      .filter((key) => !OWNED_KEYS.includes(key))
      .every((key) => preCancelSnapshot[key] === postCancelSnapshot[key]);

    const ownedFieldsCorrect =
      postCancelSnapshot.status === "CANCELLED" &&
      postCancelSnapshot.cancelledBy === "user-dispatcher-rr" &&
      typeof postCancelSnapshot.cancelledAt === "number" &&
      postCancelSnapshot.cancellationReason === "Part no longer needed";

    const voidFieldsStillAbsent =
      !("voidedBy" in postCancelSnapshot) &&
      !("voidedAt" in postCancelSnapshot) &&
      !("voidReason" in postCancelSnapshot);

    report(
      "Legacy document (six Cancel/Void keys entirely absent pre-transition): post-transition key set equals pre-transition key set plus exactly cancelledBy/cancelledAt/cancellationReason; every non-owned field byte-for-byte unchanged; voidedBy/voidedAt/voidReason still genuinely absent",
      keySetMatches && everyOtherFieldPinned && ownedFieldsCorrect && voidFieldsStillAbsent
    );
  }

  await seedReorderRequest("rr-cancel-from-purchasing", {
    partId: "PART-CANCEL3",
    status: "PURCHASING_IN_PROGRESS",
    assignedToUserId: "user-admin-rr",
  });
  report(
    "PURCHASING_IN_PROGRESS -> CANCELLED accepted for admin",
    (await updateReorderRequest("rr-cancel-from-purchasing", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Wrong part identified"),
    })) === 200
  );

  await seedReorderRequest("rr-cancel-auth-rejected", {
    partId: "PART-CANCEL4",
    status: "ASSIGNED_TO_PARTS_ASSOCIATE",
    assignedToUserId: "user-technician-plain-rr",
  });
  report(
    "CANCELLED rejected for a plain technician (isAdminOrDispatcher() required, even for the assignee)",
    (await updateReorderRequest("rr-cancel-auth-rejected", technicianPlainToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-technician-plain-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Trying to self-cancel"),
    })) === 403
  );

  await seedReorderRequest("rr-cancel-from-pending-review", {
    partId: "PART-CANCEL5",
    status: "PENDING_REVIEW",
    assignedToUserId: null,
  });
  report(
    "CANCELLED rejected from PENDING_REVIEW (not one of the three reachable source statuses)",
    (await updateReorderRequest("rr-cancel-from-pending-review", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Too early to cancel"),
    })) === 403
  );

  await seedReorderRequest("rr-cancel-from-ordered", {
    partId: "PART-CANCEL6",
    status: "ORDERED",
    assignedToUserId: "user-admin-rr",
    purchaseOrderId: "rr-cancel-from-ordered",
  });
  report(
    "CANCELLED rejected from ORDERED (post-order is Void's job, not Cancel's)",
    (await updateReorderRequest("rr-cancel-from-ordered", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Wrong attempt to cancel after ordering"),
    })) === 403
  );

  await seedReorderRequest("rr-cancel-blank-reason", {
    partId: "PART-CANCEL7",
    status: "READY_FOR_PARTS_MANAGER",
    assignedToUserId: null,
  });
  report(
    "CANCELLED rejected with an empty-string reason",
    (await updateReorderRequest("rr-cancel-blank-reason", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str(""),
    })) === 403
  );
  report(
    "CANCELLED rejected with a whitespace-only reason",
    (await updateReorderRequest("rr-cancel-blank-reason", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("   "),
    })) === 403
  );

  await seedReorderRequest("rr-cancel-spoofed-cancelledby", {
    partId: "PART-CANCEL8",
    status: "READY_FOR_PARTS_MANAGER",
    assignedToUserId: null,
  });
  report(
    "CANCELLED rejected when cancelledBy doesn't match the caller's own uid",
    (await updateReorderRequest("rr-cancel-spoofed-cancelledby", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-dispatcher-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Attempting to attribute this to someone else"),
    })) === 403
  );

  await seedReorderRequest("rr-cancel-illegal-field-change", {
    partId: "PART-CANCEL9",
    status: "ASSIGNED_TO_PARTS_ASSOCIATE",
    assignedToUserId: "user-technician-partsmanager-rr",
  });
  report(
    "CANCELLED rejected when an earlier-stage field (assignedToUserId) is changed alongside the transition",
    (await updateReorderRequest("rr-cancel-illegal-field-change", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Reassigning while cancelling"),
      assignedToUserId: str("user-admin-rr"),
    })) === 403
  );

  await seedReorderRequest("rr-cancel-from-received", {
    partId: "PART-CANCEL10",
    status: "RECEIVED",
    assignedToUserId: "user-admin-rr",
    purchaseOrderId: "rr-cancel-from-received",
  });
  report(
    "CANCELLED rejected from RECEIVED (not one of the three reachable source statuses)",
    (await updateReorderRequest("rr-cancel-from-received", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Trying to cancel after receiving"),
    })) === 403
  );

  await seedReorderRequest("rr-cancel-terminal-check", {
    partId: "PART-CANCEL11",
    status: "CANCELLED",
    assignedToUserId: null,
  });
  report(
    "CANCELLED is terminal: CANCELLED -> CANCELLED (re-cancel) rejected",
    (await updateReorderRequest("rr-cancel-terminal-check", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
      cancellationReason: str("Cancelling an already-cancelled request"),
    })) === 403
  );
  report(
    "CANCELLED is terminal: CANCELLED -> READY_FOR_PARTS_MANAGER (reactivation attempt) rejected",
    (await updateReorderRequest("rr-cancel-terminal-check", adminToken, {
      status: str("READY_FOR_PARTS_MANAGER"),
    })) === 403
  );

  await seedReorderRequest("rr-cancel-reason-omitted", {
    partId: "PART-CANCEL12",
    status: "READY_FOR_PARTS_MANAGER",
    assignedToUserId: null,
  });
  report(
    "CANCELLED rejected when cancellationReason is omitted entirely (distinct from empty-string or whitespace-only -- the key itself is absent, not merely blank)",
    (await updateReorderRequest("rr-cancel-reason-omitted", adminToken, {
      status: str("CANCELLED"),
      cancelledBy: str("user-admin-rr"),
      cancelledAt: int(Date.now()),
    })) === 403
  );

  // --- Cancel/Void schema deployment sequence, PR 5 of 6 (docs/specifications/
  // reorder-request-cancellation.md) -- Void Purchase Order ---
  // Builds a matching pair of writes (reorder_requests update +
  // reorder_purchase_order_voids create) for voidCommit() -- the SAME
  // shape voidPurchaseOrder()'s runTransaction() sends. `now` is
  // generated ONCE and reused for both voidedAt and createdAt, same
  // discipline the real function follows -- callers needing a
  // mismatch pass an explicit override.
  function validVoidWrites({ partId, voidedBy = "user-admin-rr", now = Date.now(), reason = "Vendor discontinued the part" }) {
    return {
      requestFields: {
        status: str("VOIDED"),
        voidedBy: str(voidedBy),
        voidedAt: int(now),
        voidReason: str(reason),
      },
      voidFields: {
        reorderPurchaseOrderId: str(""), // overwritten by caller with the real requestId below
        reorderRequestId: str(""),
        partId: str(partId),
        voidedBy: str(voidedBy),
        reason: str(reason),
        createdAt: int(now),
      },
    };
  }

  async function seedOrderedPair(requestId, { partId, assignedToUserId = "user-admin-rr", purchaseOrderStatus = "ORDERED", purchaseOrderReorderRequestId = requestId, purchaseOrderPartId = partId, skipPurchaseOrder = false }) {
    await seedReorderRequest(requestId, { partId, status: "ORDERED", assignedToUserId, purchaseOrderId: requestId });
    if (!skipPurchaseOrder) {
      await seedReorderPurchaseOrder(requestId, { reorderRequestId: purchaseOrderReorderRequestId, partId: purchaseOrderPartId, status: purchaseOrderStatus });
    }
  }

  // POSITIVE -- both authorization conditions satisfied, full valid
  // atomic pair.
  await seedOrderedPair("rr-void-happy-path", { partId: "PART-VOID1" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID1" });
    voidFields.reorderPurchaseOrderId = str("rr-void-happy-path");
    voidFields.reorderRequestId = str("rr-void-happy-path");
    report(
      "ORDERED -> VOIDED accepted for the assignee (isAdminOrDispatcher() AND assignedToUserId, both conditions)",
      (await voidCommit("rr-void-happy-path", adminToken, { requestFields, voidFields })) === 200
    );
  }

  // LEGACY-DOCUMENT Void test obligation: seedReorderRequest()/
  // seedReorderPurchaseOrder() never set the six Cancel/Void keys --
  // genuine legacy shape. Capture the complete pre/post
  // reorder_requests documents and confirm the void record itself has
  // exactly the six required keys, nothing more.
  await seedOrderedPair("rr-void-legacy", { partId: "PART-VOID2" });
  {
    const preVoidSnapshot = (await db.doc("reorder_requests/rr-void-legacy").get()).data();
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID2" });
    voidFields.reorderPurchaseOrderId = str("rr-void-legacy");
    voidFields.reorderRequestId = str("rr-void-legacy");
    const commitStatus = await voidCommit("rr-void-legacy", adminToken, { requestFields, voidFields });

    const postVoidSnapshot = (await db.doc("reorder_requests/rr-void-legacy").get()).data();
    const voidRecordSnapshot = (await db.doc("reorder_purchase_order_voids/rr-void-legacy").get()).data();

    const preKeys = new Set(Object.keys(preVoidSnapshot));
    const postKeys = new Set(Object.keys(postVoidSnapshot));
    const expectedPostKeys = new Set([...preKeys, "voidedBy", "voidedAt", "voidReason"]);
    const keySetMatches =
      postKeys.size === expectedPostKeys.size &&
      [...expectedPostKeys].every((key) => postKeys.has(key)) &&
      [...postKeys].every((key) => expectedPostKeys.has(key));
    const cancelFieldsStillAbsent =
      !("cancelledBy" in postVoidSnapshot) && !("cancelledAt" in postVoidSnapshot) && !("cancellationReason" in postVoidSnapshot);
    const everyOtherFieldPinned = [...preKeys]
      .filter((key) => !["status", "voidedBy", "voidedAt", "voidReason"].includes(key))
      .every((key) => preVoidSnapshot[key] === postVoidSnapshot[key]);
    const voidRecordKeySetExact =
      voidRecordSnapshot &&
      new Set(Object.keys(voidRecordSnapshot)).size === 6 &&
      ["reorderPurchaseOrderId", "reorderRequestId", "partId", "voidedBy", "reason", "createdAt"].every(
        (key) => key in voidRecordSnapshot
      );

    report(
      "Legacy document (six Cancel/Void keys entirely absent pre-transition): Void adds ONLY status(value)/voidedBy/voidedAt/voidReason to reorder_requests -- cancelledBy/cancelledAt/cancellationReason never backfilled, every other field pinned, and the void record itself has exactly its six required keys",
      commitStatus === 200 && keySetMatches && cancelFieldsStillAbsent && everyOtherFieldPinned && voidRecordKeySetExact
    );
  }

  // NEGATIVE -- authorization: plain technician (not admin/dispatcher),
  // even as the correct assignee.
  await seedOrderedPair("rr-void-auth-technician", { partId: "PART-VOID3", assignedToUserId: "user-technician-plain-rr" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID3", voidedBy: "user-technician-plain-rr" });
    voidFields.reorderPurchaseOrderId = str("rr-void-auth-technician");
    voidFields.reorderRequestId = str("rr-void-auth-technician");
    report(
      "VOIDED rejected for a plain technician assignee (isAdminOrDispatcher() required, even for the correct assignee)",
      (await voidCommit("rr-void-auth-technician", technicianPlainToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- authorization: admin/dispatcher who is NOT the
  // assignee.
  await seedOrderedPair("rr-void-auth-not-assignee", { partId: "PART-VOID4", assignedToUserId: "user-admin-rr" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID4", voidedBy: "user-dispatcher-rr" });
    voidFields.reorderPurchaseOrderId = str("rr-void-auth-not-assignee");
    voidFields.reorderRequestId = str("rr-void-auth-not-assignee");
    report(
      "VOIDED rejected for a dispatcher who is admin/dispatcher but NOT the assignee (both conditions required, not isAdminOrDispatcher() alone)",
      (await voidCommit("rr-void-auth-not-assignee", dispatcherToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- wrong source status.
  await seedReorderRequest("rr-void-wrong-source-status", {
    partId: "PART-VOID5",
    status: "PURCHASING_IN_PROGRESS",
    assignedToUserId: "user-admin-rr",
  });
  await seedReorderPurchaseOrder("rr-void-wrong-source-status", { reorderRequestId: "rr-void-wrong-source-status", partId: "PART-VOID5", status: "ORDERED" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID5" });
    voidFields.reorderPurchaseOrderId = str("rr-void-wrong-source-status");
    voidFields.reorderRequestId = str("rr-void-wrong-source-status");
    report(
      "VOIDED rejected from PURCHASING_IN_PROGRESS (Void is reachable only from ORDERED)",
      (await voidCommit("rr-void-wrong-source-status", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- Purchase-Order-existence proof: no matching
  // reorder_purchase_orders document exists at all.
  await seedOrderedPair("rr-void-no-po", { partId: "PART-VOID6", skipPurchaseOrder: true });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID6" });
    voidFields.reorderPurchaseOrderId = str("rr-void-no-po");
    voidFields.reorderRequestId = str("rr-void-no-po");
    report(
      "VOIDED rejected when no matching reorder_purchase_orders document exists (Purchase-Order-existence proof fails)",
      (await voidCommit("rr-void-no-po", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- Purchase-Order-existence proof: matching document
  // exists but its own status isn't ORDERED.
  await seedOrderedPair("rr-void-po-wrong-status", { partId: "PART-VOID7", purchaseOrderStatus: "SOMETHING_ELSE" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID7" });
    voidFields.reorderPurchaseOrderId = str("rr-void-po-wrong-status");
    voidFields.reorderRequestId = str("rr-void-po-wrong-status");
    report(
      "VOIDED rejected when the linked reorder_purchase_orders document's own status isn't ORDERED",
      (await voidCommit("rr-void-po-wrong-status", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- Purchase-Order-existence proof: reorderRequestId
  // mismatch.
  await seedOrderedPair("rr-void-po-id-mismatch", { partId: "PART-VOID8", purchaseOrderReorderRequestId: "some-other-request-id" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID8" });
    voidFields.reorderPurchaseOrderId = str("rr-void-po-id-mismatch");
    voidFields.reorderRequestId = str("rr-void-po-id-mismatch");
    report(
      "VOIDED rejected when the linked reorder_purchase_orders document's reorderRequestId doesn't agree",
      (await voidCommit("rr-void-po-id-mismatch", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- Purchase-Order-existence proof: partId mismatch.
  await seedOrderedPair("rr-void-po-partid-mismatch", { partId: "PART-VOID9", purchaseOrderPartId: "PART-DIFFERENT" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID9" });
    voidFields.reorderPurchaseOrderId = str("rr-void-po-partid-mismatch");
    voidFields.reorderRequestId = str("rr-void-po-partid-mismatch");
    report(
      "VOIDED rejected when the linked reorder_purchase_orders document's partId doesn't agree with the Reorder Request's own partId",
      (await voidCommit("rr-void-po-partid-mismatch", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- blank / whitespace-only / omitted voidReason.
  await seedOrderedPair("rr-void-blank-reason", { partId: "PART-VOID10" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID10", reason: "" });
    voidFields.reorderPurchaseOrderId = str("rr-void-blank-reason");
    voidFields.reorderRequestId = str("rr-void-blank-reason");
    report(
      "VOIDED rejected with an empty-string voidReason",
      (await voidCommit("rr-void-blank-reason", adminToken, { requestFields, voidFields })) === 403
    );
  }
  await seedOrderedPair("rr-void-whitespace-reason", { partId: "PART-VOID11" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID11", reason: "   " });
    voidFields.reorderPurchaseOrderId = str("rr-void-whitespace-reason");
    voidFields.reorderRequestId = str("rr-void-whitespace-reason");
    report(
      "VOIDED rejected with a whitespace-only voidReason",
      (await voidCommit("rr-void-whitespace-reason", adminToken, { requestFields, voidFields })) === 403
    );
  }
  await seedOrderedPair("rr-void-omitted-reason", { partId: "PART-VOID12" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID12" });
    delete requestFields.voidReason;
    voidFields.reorderPurchaseOrderId = str("rr-void-omitted-reason");
    voidFields.reorderRequestId = str("rr-void-omitted-reason");
    voidFields.reason = str("A reason on the void record alone isn't enough");
    report(
      "VOIDED rejected when voidReason is omitted from the reorder_requests write entirely (distinct from empty-string/whitespace-only)",
      (await voidCommit("rr-void-omitted-reason", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- voidedBy spoofed (different uid than the caller).
  await seedOrderedPair("rr-void-spoofed-voidedby", { partId: "PART-VOID13" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID13", voidedBy: "user-dispatcher-rr" });
    voidFields.reorderPurchaseOrderId = str("rr-void-spoofed-voidedby");
    voidFields.reorderRequestId = str("rr-void-spoofed-voidedby");
    report(
      "VOIDED rejected when voidedBy doesn't match the caller's own uid",
      (await voidCommit("rr-void-spoofed-voidedby", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- cross-document timestamp invariant: voidedAt !=
  // the void record's own createdAt.
  await seedOrderedPair("rr-void-timestamp-mismatch", { partId: "PART-VOID14" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID14", now: 1000000000000 });
    voidFields.reorderPurchaseOrderId = str("rr-void-timestamp-mismatch");
    voidFields.reorderRequestId = str("rr-void-timestamp-mismatch");
    voidFields.createdAt = int(1000000000001); // one ms off from requestFields.voidedAt
    report(
      "VOIDED rejected when reorder_requests.voidedAt doesn't equal the void record's own createdAt (must be the SAME generated timestamp, not two independent Date.now() calls)",
      (await voidCommit("rr-void-timestamp-mismatch", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- reason-binding cross-document invariant: voidReason !=
  // the void record's own reason.
  await seedOrderedPair("rr-void-reason-mismatch", { partId: "PART-VOID15" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID15" });
    voidFields.reorderPurchaseOrderId = str("rr-void-reason-mismatch");
    voidFields.reorderRequestId = str("rr-void-reason-mismatch");
    voidFields.reason = str("A completely different reason on the void record");
    report(
      "VOIDED rejected when reorder_requests.voidReason doesn't equal the void record's own reason (same fact, must agree on both sides)",
      (await voidCommit("rr-void-reason-mismatch", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // NEGATIVE -- cross-document invariant: only the reorder_requests
  // write sent, no matching void record created in the same commit.
  await seedOrderedPair("rr-void-only-request-write", { partId: "PART-VOID16" });
  {
    const { requestFields } = validVoidWrites({ partId: "PART-VOID16" });
    report(
      "VOIDED rejected when only the reorder_requests write is sent, with no reorder_purchase_order_voids record created in the same commit (existsAfter() fails)",
      (await voidCommit("rr-void-only-request-write", adminToken, { requestFields, voidFields: null })) === 403
    );
  }

  // NEGATIVE -- cross-document invariant, the other direction: only a
  // standalone void-record create attempted, no matching
  // reorder_requests transition in the same write.
  await seedOrderedPair("rr-void-only-void-write", { partId: "PART-VOID17" });
  report(
    "reorder_purchase_order_voids create rejected standalone, with no matching reorder_requests -> VOIDED transition in the same commit (existsAfter()/getAfter() on the Reorder Request side fails)",
    (await createReorderPurchaseOrderVoid("rr-void-only-void-write", adminToken, {
      reorderPurchaseOrderId: str("rr-void-only-void-write"),
      reorderRequestId: str("rr-void-only-void-write"),
      partId: str("PART-VOID17"),
      voidedBy: str("user-admin-rr"),
      reason: str("Standalone attempt"),
      createdAt: int(Date.now()),
    })) === 403
  );

  // NEGATIVE -- illegal field change alongside an otherwise-valid
  // VOIDED transition (assignedToUserId changed).
  await seedOrderedPair("rr-void-illegal-field-change", { partId: "PART-VOID18" });
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID18" });
    voidFields.reorderPurchaseOrderId = str("rr-void-illegal-field-change");
    voidFields.reorderRequestId = str("rr-void-illegal-field-change");
    requestFields.assignedToUserId = str("user-dispatcher-rr");
    report(
      "VOIDED rejected when an earlier-stage field (assignedToUserId) is changed alongside the transition, even with an otherwise-valid matching void record",
      (await voidCommit("rr-void-illegal-field-change", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // DOUBLE-VOID: attempting to void an already-VOIDED request again is
  // rejected two ways at once -- the source status is no longer
  // ORDERED, and the void record create is now an update to an
  // existing document (`allow update, delete: if false`).
  {
    const { requestFields, voidFields } = validVoidWrites({ partId: "PART-VOID1" }); // reuses rr-void-happy-path, already VOIDED above
    voidFields.reorderPurchaseOrderId = str("rr-void-happy-path");
    voidFields.reorderRequestId = str("rr-void-happy-path");
    report(
      "Double-void rejected: attempting to void an already-VOIDED request again",
      (await voidCommit("rr-void-happy-path", adminToken, { requestFields, voidFields })) === 403
    );
  }

  // IMMUTABILITY -- the void record itself is append-only: direct
  // update and delete attempts against an existing record are both
  // rejected.
  report(
    "reorder_purchase_order_voids record rejected on direct update attempt (append-only, allow update: if false)",
    (await updateReorderPurchaseOrderVoid("rr-void-happy-path", adminToken, { reason: str("Trying to edit history") })) === 403
  );
  report(
    "reorder_purchase_order_voids record rejected on direct delete attempt (append-only, allow delete: if false)",
    (await deleteDocAt("reorder_purchase_order_voids", "rr-void-happy-path", adminToken)) === 403
  );

  // IMMUTABILITY -- the ORIGINAL reorder_purchase_orders document is
  // never modified or deleted by Void, and remains immutable on its
  // own pre-existing rule regardless.
  report(
    "reorder_purchase_orders document rejected on direct update attempt after voiding (never modified by Void, and immutable on its own pre-existing rule)",
    (await updateReorderPurchaseOrder("rr-void-happy-path", adminToken, { status: str("VOIDED") })) === 403
  );
  report(
    "reorder_purchase_orders document rejected on direct delete attempt after voiding",
    (await deleteDocAt("reorder_purchase_orders", "rr-void-happy-path", adminToken)) === 403
  );
  {
    const originalPurchaseOrder = (await db.doc("reorder_purchase_orders/rr-void-happy-path").get()).data();
    report(
      "Original reorder_purchase_orders document is byte-for-byte unchanged after its linked Reorder Request was voided",
      originalPurchaseOrder.status === "ORDERED" && originalPurchaseOrder.reorderRequestId === "rr-void-happy-path" && originalPurchaseOrder.partId === "PART-VOID1"
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
