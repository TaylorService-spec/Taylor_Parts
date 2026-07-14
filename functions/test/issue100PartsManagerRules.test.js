// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md, PR 1a).
// Firestore Rules emulator test for PR 1a's scope only: the
// reciprocallyLinkedEmployee()/isActiveOperationalRole() helpers, the
// canSubmitManualZeroHistoryQuantity() retrofit, the four new
// reorder_requests read branches (three PARTS_MANAGER-scoped plus the
// bundled PARTS_ASSOCIATE personal-request read), and the shared
// PARTS_MANAGER/WAREHOUSE_MANAGER inventory_transactions read branch.
// Same zero-new-dependency posture as functions/test/employeesRules.test.js
// and functions/test/reorderRequestsRules.test.js (firebase-admin + Node's
// built-in fetch against the emulator REST APIs, no
// @firebase/rules-unit-testing, no test runner).
//
// UPDATED for PR 2a: inventory_actions' WAREHOUSE_MANAGER branch landed
// in PR 2a (functions/test/issue100WarehouseManagerRules.test.js has
// PR 2a's own dedicated coverage) -- this file's inventory_actions
// assertion below now reflects that grant existing, rather than the
// stale "not yet landed" expectation this file originally shipped with.
//
// UPDATED for PR 3a: the reorder_requests Assign-write branch and
// reorder_purchase_orders/reorder_purchase_order_voids' self-scoped
// PARTS_ASSOCIATE read branch both landed in PR 3a
// (functions/test/issue100PartsAssociateRules.test.js has PR 3a's own
// dedicated coverage) -- the two assertions below now reflect those
// grants existing, rather than the stale "not yet landed" expectations
// this file originally shipped with.
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/issue100PartsManagerRules.test.js
//
// This script is read/write only against the emulator
// (FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST below) -- it never
// touches the live "taylor-parts" project.
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

async function getDocAt(collection, docId, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { headers });
  return res.status;
}

// Always PATCHes a never-before-used document ID, so this always
// exercises the `create` rule (not `update`) -- same convention as
// reorderRequestsRules.test.js's createReorderRequest().
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

// PATCHes an EXISTING document with an explicit updateMask -- exercises
// the `update` rule. Used here only to prove the Assign-write branch was
// NOT added in PR 1a (must remain 403 for a PARTS_MANAGER-eligible
// technician).
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

const now = Date.now();

// The canonical 35-key creation shape reorder_requests' `create` rule
// requires -- reused verbatim from reorderRequestsRules.test.js's own
// canonicalFields() shape so the manual-entry regression probe exercises
// the real, current create contract, not a stale subset.
function canonicalManualEntryFields(requestedByUid) {
  return {
    partId: "part-issue100-manual",
    recommendationStatus: "NEEDS_PLANNING",
    urgency: null,
    quantitySource: "MANUAL_ZERO_HISTORY",
    recommendedQty: null,
    requestedQty: 5,
    status: "PENDING_REVIEW",
    currentOwner: "INVENTORY",
    requestedBy: requestedByUid,
    createdAt: now,
    reviewedBy: null,
    reviewedAt: null,
    reviewDecision: null,
    reviewNotes: null,
    assignedToUserId: null,
    assignedBy: null,
    assignedAt: null,
    purchasingStartedAt: null,
    purchasingStartedBy: null,
    purchasingNotes: null,
    vendorContacted: null,
    expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null,
    lastPurchasingUpdateBy: null,
    purchaseOrderId: null,
    orderedBy: null,
    orderedAt: null,
    receivedBy: null,
    receivedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) fields[key] = { nullValue: null };
    else if (typeof value === "string") fields[key] = { stringValue: value };
    else if (typeof value === "number") fields[key] = { integerValue: String(value) };
    else throw new Error(`Unsupported field type for ${key}`);
  }
  return fields;
}

async function seed() {
  // -- Employees: reciprocally linked, ACTIVE, one eligible role each --
  await db.doc("employees/emp-pm-1").set({
    employeeId: "emp-pm-1", displayName: "Parts Manager One", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "user-pm-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-pm-1").set({ role: "technician", employeeId: "emp-pm-1" });

  await db.doc("employees/emp-pm-2").set({
    employeeId: "emp-pm-2", displayName: "Parts Manager Two", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "user-pm-2", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-pm-2").set({ role: "technician", employeeId: "emp-pm-2" });

  await db.doc("employees/emp-wm-1").set({
    employeeId: "emp-wm-1", displayName: "Warehouse Manager One", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], userId: "user-wm-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-1").set({ role: "technician", employeeId: "emp-wm-1" });

  await db.doc("employees/emp-pa-1").set({
    employeeId: "emp-pa-1", displayName: "Parts Associate One", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"], userId: "user-pa-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-pa-1").set({ role: "technician", employeeId: "emp-pa-1" });

  await db.doc("employees/emp-pa-2").set({
    employeeId: "emp-pa-2", displayName: "Parts Associate Two", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"], userId: "user-pa-2", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-pa-2").set({ role: "technician", employeeId: "emp-pa-2" });

  // Ineligible: real reciprocal link, ACTIVE, zero eligible operationalRoles.
  await db.doc("employees/emp-ineligible-1").set({
    employeeId: "emp-ineligible-1", displayName: "Ineligible Technician", employmentStatus: "ACTIVE",
    operationalRoles: [], userId: "user-ineligible-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-ineligible-1").set({ role: "technician", employeeId: "emp-ineligible-1" });

  // Inactive employment, otherwise PARTS_MANAGER-eligible.
  await db.doc("employees/emp-inactive-1").set({
    employeeId: "emp-inactive-1", displayName: "Inactive Technician", employmentStatus: "TERMINATED",
    operationalRoles: ["PARTS_MANAGER"], userId: "user-inactive-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-inactive-1").set({ role: "technician", employeeId: "emp-inactive-1" });

  // Broken linkage: users/{uid}.employeeId points at an employees
  // document that is never created.
  await db.doc("users/user-broken-1").set({ role: "technician", employeeId: "emp-broken-does-not-exist" });

  // Mismatched (one-directional) linkage: users points at a real
  // Employee, but that Employee's own userId points elsewhere.
  await db.doc("employees/emp-mismatched-1").set({
    employeeId: "emp-mismatched-1", displayName: "Mismatched Technician", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "some-other-uid", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-mismatched-1").set({ role: "technician", employeeId: "emp-mismatched-1" });

  await db.doc("users/user-admin-1").set({ role: "admin" });
  await db.doc("users/user-dispatcher-1").set({ role: "dispatcher" });

  // -- reorder_requests fixtures (Admin SDK, bypasses Rules) --
  await db.doc("reorder_requests/req-ready-1").set({
    partId: "part-1", status: "READY_FOR_PARTS_MANAGER", currentOwner: "PARTS_MANAGER",
    urgency: "HIGH", recommendedQty: 10, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-admin-1", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: null, assignedBy: null, assignedAt: null,
  });

  await db.doc("reorder_requests/req-assigned-pa1").set({
    partId: "part-2", status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
    urgency: "MEDIUM", recommendedQty: 5, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-admin-1", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
  });

  await db.doc("reorder_requests/req-purchasing-pa1").set({
    partId: "part-3", status: "PURCHASING_IN_PROGRESS", currentOwner: "PARTS_ASSOCIATE",
    urgency: "LOW", recommendedQty: 2, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-admin-1", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
  });

  await db.doc("reorder_requests/req-assigned-pa2").set({
    partId: "part-4", status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
    urgency: "MEDIUM", recommendedQty: 5, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-admin-1", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: "user-pa-2", assignedBy: "user-pm-1", assignedAt: now,
  });

  // reviewedBy == user-pm-1 -- pm-1's own Relevant History.
  await db.doc("reorder_requests/req-reviewed-by-pm1").set({
    partId: "part-5", status: "RECEIVED", currentOwner: "PARTS_ASSOCIATE",
    urgency: "LOW", recommendedQty: 3, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-pm-1", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
  });

  // assignedBy == user-pm-1, reviewedBy == someone else -- still pm-1's
  // Relevant History via the assignedBy branch.
  await db.doc("reorder_requests/req-assignedby-pm1").set({
    partId: "part-6", status: "VOIDED", currentOwner: "PARTS_ASSOCIATE",
    urgency: "LOW", recommendedQty: 1, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-admin-1", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
  });

  // reviewedBy == user-pm-1, but assignedToUserId == user-pa-2 (NOT
  // user-pa-1) -- isolates the Relevant-History-denied-to-PARTS_ASSOCIATE
  // assertion below from the bundled personal-request branch, which
  // would otherwise also grant user-pa-1 read access to this same
  // document if assignedToUserId were user-pa-1 (as every other
  // Relevant History fixture above deliberately is, to double as an
  // assigned-work-oversight fixture).
  await db.doc("reorder_requests/req-reviewed-by-pm1-not-assigned-to-pa1").set({
    partId: "part-5b", status: "RECEIVED", currentOwner: "PARTS_ASSOCIATE",
    urgency: "LOW", recommendedQty: 3, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-pm-1", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: "user-pa-2", assignedBy: "user-pm-1", assignedAt: now,
  });

  // reviewedBy == user-pm-2 -- must NOT appear in pm-1's Relevant History.
  await db.doc("reorder_requests/req-reviewed-by-pm2").set({
    partId: "part-7", status: "CANCELLED", currentOwner: "PARTS_ASSOCIATE",
    urgency: "LOW", recommendedQty: 1, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-pm-2", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-2", assignedAt: now,
  });

  // PENDING_REVIEW -- must not be readable by any new branch (not
  // READY_FOR_PARTS_MANAGER, not assigned, not reviewed/assigned by
  // anyone yet).
  await db.doc("reorder_requests/req-pending-1").set({
    partId: "part-8", status: "PENDING_REVIEW", currentOwner: "INVENTORY",
    urgency: "LOW", recommendedQty: 1, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
    assignedToUserId: null, assignedBy: null, assignedAt: null,
  });

  // inventory_transactions fixture.
  await db.doc("inventory_transactions/txn-1").set({
    partId: "part-1", type: "CONSUMPTION", quantity: -1, createdAt: now,
  });

  // reorder_purchase_orders / reorder_purchase_order_voids -- excluded
  // capability probes (PR 3a scope, not this PR's).
  await db.doc("reorder_purchase_orders/req-purchasing-pa1").set({
    reorderRequestId: "req-purchasing-pa1", partId: "part-3", supplierName: "Acme",
    externalPoNumber: "PO-1", orderedQuantity: 2, orderedDate: "2026-07-01",
    expectedArrivalDate: null, status: "ORDERED", createdBy: "user-pa-1", createdAt: now,
  });

  // inventory_actions -- excluded capability probe (PR 2a scope, not this PR's).
  await db.doc("inventory_actions/action-1").set({
    partId: "part-1", type: "RECEIVE_STOCK", quantity: 1, actorUid: "user-admin-1", createdAt: now,
  });
}

async function main() {
  await seed();

  const tokens = {};
  for (const uid of [
    "user-admin-1", "user-dispatcher-1",
    "user-pm-1", "user-pm-2", "user-wm-1", "user-pa-1", "user-pa-2",
    "user-ineligible-1", "user-inactive-1", "user-broken-1", "user-mismatched-1",
  ]) {
    tokens[uid] = await idTokenFor(uid);
  }

  // === Allowed reads ===

  report("PARTS_MANAGER reads the Parts Manager Queue (READY_FOR_PARTS_MANAGER)",
    (await getDocAt("reorder_requests", "req-ready-1", tokens["user-pm-1"])) === 200);

  report("PARTS_MANAGER reads assigned-work oversight (ASSIGNED_TO_PARTS_ASSOCIATE)",
    (await getDocAt("reorder_requests", "req-assigned-pa1", tokens["user-pm-1"])) === 200);

  report("PARTS_MANAGER reads assigned-work oversight (PURCHASING_IN_PROGRESS)",
    (await getDocAt("reorder_requests", "req-purchasing-pa1", tokens["user-pm-1"])) === 200);

  report("PARTS_MANAGER reads their own Relevant History (reviewedBy == self)",
    (await getDocAt("reorder_requests", "req-reviewed-by-pm1", tokens["user-pm-1"])) === 200);

  report("PARTS_MANAGER reads their own Relevant History (assignedBy == self)",
    (await getDocAt("reorder_requests", "req-assignedby-pm1", tokens["user-pm-1"])) === 200);

  report("PARTS_ASSOCIATE reads their own personal Waiting request",
    (await getDocAt("reorder_requests", "req-assigned-pa1", tokens["user-pa-1"])) === 200);

  report("PARTS_ASSOCIATE reads their own personal In-Progress request",
    (await getDocAt("reorder_requests", "req-purchasing-pa1", tokens["user-pa-1"])) === 200);

  report("PARTS_MANAGER reads inventory_transactions (catalog/health)",
    (await getDocAt("inventory_transactions", "txn-1", tokens["user-pm-1"])) === 200);

  report("WAREHOUSE_MANAGER reads inventory_transactions (catalog/health)",
    (await getDocAt("inventory_transactions", "txn-1", tokens["user-wm-1"])) === 200);

  // === Isolation between accounts of the same role ===

  report("PARTS_MANAGER's Relevant History does NOT include a different Parts Manager's reviewed request",
    (await getDocAt("reorder_requests", "req-reviewed-by-pm2", tokens["user-pm-1"])) === 403);

  report("PARTS_ASSOCIATE cannot read a DIFFERENT Parts Associate's assigned request",
    (await getDocAt("reorder_requests", "req-assigned-pa2", tokens["user-pa-1"])) === 403);

  // === Excluded capabilities ===

  report("WAREHOUSE_MANAGER cannot read the Parts Manager Queue",
    (await getDocAt("reorder_requests", "req-ready-1", tokens["user-wm-1"])) === 403);

  report("WAREHOUSE_MANAGER cannot read assigned-work oversight",
    (await getDocAt("reorder_requests", "req-assigned-pa1", tokens["user-wm-1"])) === 403);

  report("WAREHOUSE_MANAGER cannot read Relevant History",
    (await getDocAt("reorder_requests", "req-reviewed-by-pm1", tokens["user-wm-1"])) === 403);

  report("PARTS_ASSOCIATE cannot read the Parts Manager Queue",
    (await getDocAt("reorder_requests", "req-ready-1", tokens["user-pa-1"])) === 403);

  report("PARTS_ASSOCIATE cannot read Relevant History (not assigned to them)",
    (await getDocAt("reorder_requests", "req-reviewed-by-pm1-not-assigned-to-pa1", tokens["user-pa-1"])) === 403);

  report("No role reads a PENDING_REVIEW request through any new branch",
    (await getDocAt("reorder_requests", "req-pending-1", tokens["user-pm-1"])) === 403 &&
      (await getDocAt("reorder_requests", "req-pending-1", tokens["user-wm-1"])) === 403 &&
      (await getDocAt("reorder_requests", "req-pending-1", tokens["user-pa-1"])) === 403);

  report("PARTS_ASSOCIATE cannot read inventory_transactions (not this PR's/role's grant)",
    (await getDocAt("inventory_transactions", "txn-1", tokens["user-pa-1"])) === 403);

  report("Ineligible technician cannot read inventory_transactions",
    (await getDocAt("inventory_transactions", "txn-1", tokens["user-ineligible-1"])) === 403);

  // UPDATED for PR 2a (Issue #100): WAREHOUSE_MANAGER's inventory_actions
  // read is PR 2a's own grant, not PR 1a's -- this PR 1a test file
  // previously asserted denial here specifically to prove PR 2a's scope
  // hadn't landed yet. Now that PR 2a has landed (see
  // functions/test/issue100WarehouseManagerRules.test.js for PR 2a's own
  // dedicated coverage), that premise is obsolete; this assertion is
  // updated to the new correct expectation rather than left to fail
  // permanently. PARTS_MANAGER/PARTS_ASSOCIATE remain unaffected by PR
  // 2a and stay denied, unchanged below.
  report("PR 2a's WAREHOUSE_MANAGER inventory_actions grant does not affect this PR's own PARTS_MANAGER/PARTS_ASSOCIATE scope",
    (await getDocAt("inventory_actions", "action-1", tokens["user-wm-1"])) === 200);

  // UPDATED for PR 3a (Issue #100): reorder_purchase_orders' self-scoped
  // PARTS_ASSOCIATE read is PR 3a's own grant, not PR 1a's -- this PR 1a
  // test file previously asserted denial here specifically to prove PR
  // 3a's scope hadn't landed yet. req-purchasing-pa1's linked
  // reorder_requests document has assignedToUserId == user-pa-1 (seeded
  // above), so this account is now the legitimate self-scoped reader.
  report("PR 3a's self-scoped PARTS_ASSOCIATE reorder_purchase_orders read does not affect this PR's own PARTS_MANAGER scope",
    (await getDocAt("reorder_purchase_orders", "req-purchasing-pa1", tokens["user-pa-1"])) === 200);

  // UPDATED for PR 3a (Issue #100): the Assign-write branch is PR 3a's
  // own grant (the merged (isAdminOrDispatcher() ||
  // isActiveOperationalRole("PARTS_MANAGER")) branch in reorder_requests'
  // restructured allow update, per its own dedicated
  // functions/test/issue100PartsAssociateRules.test.js coverage) -- this
  // PR 1a test file previously asserted denial here specifically to
  // prove PR 3a's restructuring hadn't landed yet. That premise is now
  // obsolete.
  report("PR 3a's Assign-write branch does not affect this PR's own read-only scope",
    (await updateReorderRequest("req-ready-1", tokens["user-pm-1"], {
      status: { stringValue: "ASSIGNED_TO_PARTS_ASSOCIATE" },
      currentOwner: { stringValue: "PARTS_ASSOCIATE" },
      assignedToUserId: { stringValue: "user-pa-1" },
      assignedBy: { stringValue: "user-pm-1" },
      assignedAt: { integerValue: String(now) },
    })) === 200);

  // === Broken / inactive / mismatched linkage -- fail closed ===

  report("Broken-linkage technician denied the Parts Manager Queue read",
    (await getDocAt("reorder_requests", "req-ready-1", tokens["user-broken-1"])) === 403);

  report("Broken-linkage technician denied inventory_transactions",
    (await getDocAt("inventory_transactions", "txn-1", tokens["user-broken-1"])) === 403);

  report("Inactive-employment technician denied the Parts Manager Queue read despite an otherwise-eligible role",
    (await getDocAt("reorder_requests", "req-ready-1", tokens["user-inactive-1"])) === 403);

  report("Inactive-employment technician denied inventory_transactions",
    (await getDocAt("inventory_transactions", "txn-1", tokens["user-inactive-1"])) === 403);

  report("Mismatched (one-directional) linkage denied the Parts Manager Queue read",
    (await getDocAt("reorder_requests", "req-ready-1", tokens["user-mismatched-1"])) === 403);

  report("Ineligible (empty operationalRoles) technician denied the Parts Manager Queue read",
    (await getDocAt("reorder_requests", "req-ready-1", tokens["user-ineligible-1"])) === 403);

  // === Manual-entry regression (canSubmitManualZeroHistoryQuantity retrofit) ===
  // An already-ACTIVE, reciprocally-linked PARTS_MANAGER/WAREHOUSE_MANAGER
  // Employee's existing manual-entry capability must be unaffected by the
  // retrofit from hasOperationalRole() to isActiveOperationalRole().

  report("Already-valid PARTS_MANAGER's manual NEEDS_PLANNING entry still succeeds (regression)",
    (await createReorderRequest(
      "req-manual-pm-regression",
      tokens["user-pm-1"],
      toFirestoreFields(canonicalManualEntryFields("user-pm-1"))
    )) === 200);

  report("Already-valid WAREHOUSE_MANAGER's manual NEEDS_PLANNING entry still succeeds (regression)",
    (await createReorderRequest(
      "req-manual-wm-regression",
      tokens["user-wm-1"],
      toFirestoreFields(canonicalManualEntryFields("user-wm-1"))
    )) === 200);

  report("admin's manual NEEDS_PLANNING entry still succeeds (regression, unaffected by retrofit)",
    (await createReorderRequest(
      "req-manual-admin-regression",
      tokens["user-admin-1"],
      toFirestoreFields(canonicalManualEntryFields("user-admin-1"))
    )) === 200);

  report("Broken-linkage technician's manual NEEDS_PLANNING entry denied (retrofit tightening -- was already effectively unreachable, now provably closed)",
    (await createReorderRequest(
      "req-manual-broken-regression",
      tokens["user-broken-1"],
      toFirestoreFields(canonicalManualEntryFields("user-broken-1"))
    )) === 403);

  report("Inactive-employment PARTS_MANAGER's manual NEEDS_PLANNING entry denied (retrofit tightening)",
    (await createReorderRequest(
      "req-manual-inactive-regression",
      tokens["user-inactive-1"],
      toFirestoreFields(canonicalManualEntryFields("user-inactive-1"))
    )) === 403);

  report("Mismatched-linkage PARTS_MANAGER's manual NEEDS_PLANNING entry denied (retrofit tightening)",
    (await createReorderRequest(
      "req-manual-mismatched-regression",
      tokens["user-mismatched-1"],
      toFirestoreFields(canonicalManualEntryFields("user-mismatched-1"))
    )) === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
