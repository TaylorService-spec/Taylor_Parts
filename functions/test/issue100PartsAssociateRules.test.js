// Issue #100 (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md, PR 3a).
// Firestore Rules emulator test for PR 3a's scope only: the full
// reorder_requests `allow update` restructuring (the merged Assign
// branch and the four PARTS_ASSOCIATE lifecycle-write branches), the
// self-scoped PARTS_ASSOCIATE reads on reorder_purchase_orders/
// reorder_purchase_order_voids, and the PARTS_ASSOCIATE create grant on
// reorder_purchase_orders. Same zero-new-dependency posture as
// functions/test/employeesRules.test.js, reorderRequestsRules.test.js,
// issue100PartsManagerRules.test.js, and
// issue100WarehouseManagerRules.test.js (firebase-admin + Node's
// built-in fetch against the emulator REST APIs, no
// @firebase/rules-unit-testing, no test runner).
//
// DEVIATION FROM THE SPECIFICATION'S ILLUSTRATIVE CODE (see
// firestore.rules' own inline comment on the restructured allow update
// for the full explanation): Assign is ONE merged branch --
// `(isAdminOrDispatcher() || isActiveOperationalRole("PARTS_MANAGER"))`
// -- not two separate branches as the Specification's illustrative
// shape showed, because implementing two separate (byte-for-byte
// identical body) branches empirically exceeds Firestore's ~1000-
// subexpression Rules evaluation budget on the ORDERED -> VOIDED
// transition's two-document atomic commit. Confirmed empirically: the
// nine-branch form failed reorderRequestsRules.test.js's VOID coverage
// (2/82) with "Unable to evaluate the expression as the maximum of 1000
// expressions to evaluate has been reached"; the eight-branch merged
// form passes 82/82. This is flagged for the next Architecture Review
// pass, not decided as final by this implementation alone.
//
// Explicitly does NOT probe: Cancel or Void remaining PARTS_ASSOCIATE-
// denied is covered here as a required negative case (per the
// Specification's explicit "PARTS_ASSOCIATE does not gain either"
// decision), but the full existing Cancel/Void positive-path coverage
// for admin/dispatcher is reorderRequestsRules.test.js's own
// responsibility, re-run unchanged as this PR's required regression
// suite (see PR description).
//
// Prerequisite: run against a live Firestore + Auth emulator pair, e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/issue100PartsAssociateRules.test.js
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

function str(v) { return { stringValue: v }; }
function int(v) { return { integerValue: String(v) }; }
function nul() { return { nullValue: null }; }

async function getDocAt(collection, docId, idToken) {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, { headers });
  return res.status;
}

async function updateDoc(collection, docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}?${mask}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

// Admin SDK snapshot (bypasses Rules, read-only) -- used to prove a
// denied write attempt left the document byte-for-byte unchanged, not
// merely that the HTTP status was 403.
async function snapshot(collection, docId) {
  const snap = await db.doc(`${collection}/${docId}`).get();
  return snap.data();
}

// Never-before-used document ID -- exercises `create`.
async function createDoc(collection, docId, idToken, fields) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${DOC_BASE}/${collection}/${docId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

// Atomic two-document commit for the Record PO transition (mirrors
// reorderRequestsRules.test.js's voidCommit() shape) -- a
// reorder_requests PURCHASING_IN_PROGRESS -> ORDERED update, plus a
// reorder_purchase_orders create, in the same Firestore transaction.
async function recordPoCommit(requestId, idToken, { requestFields, poFields }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const writes = [
    {
      update: { name: `${base}/reorder_requests/${requestId}`, fields: requestFields },
      updateMask: { fieldPaths: Object.keys(requestFields) },
    },
    { update: { name: `${base}/reorder_purchase_orders/${requestId}`, fields: poFields } },
  ];
  const res = await fetch(`${DOC_BASE}:commit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ writes }),
  });
  return res.status;
}

// Atomic two-document commit for Void (mirrors reorderRequestsRules.test.js's
// voidCommit() exactly) -- used here only for the PARTS_ASSOCIATE-denial
// negative case.
async function voidCommit(requestId, idToken, { requestFields, voidFields }) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const writes = [
    { update: { name: `${base}/reorder_requests/${requestId}`, fields: requestFields }, updateMask: { fieldPaths: Object.keys(requestFields) } },
    { update: { name: `${base}/reorder_purchase_order_voids/${requestId}`, fields: voidFields } },
  ];
  const res = await fetch(`${DOC_BASE}:commit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ writes }),
  });
  return res.status;
}

const now = Date.now();

function canonicalReorderRequestFields(overrides) {
  return {
    partId: "part-issue100-pr3a", status: "READY_FOR_PARTS_MANAGER", currentOwner: "PARTS_MANAGER",
    urgency: "LOW", recommendedQty: 1, requestedBy: "user-admin-1", createdAt: now,
    reviewedBy: "user-admin-1", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
    assignedToUserId: null, assignedBy: null, assignedAt: null,
    purchasingStartedAt: null, purchasingStartedBy: null,
    purchasingNotes: null, vendorContacted: null, expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null, lastPurchasingUpdateBy: null,
    purchaseOrderId: null, orderedBy: null, orderedAt: null,
    receivedBy: null, receivedAt: null,
    cancelledBy: null, cancelledAt: null, cancellationReason: null,
    voidedBy: null, voidedAt: null, voidReason: null,
    ...overrides,
  };
}

async function seedReorderRequest(docId, overrides) {
  await db.doc(`reorder_requests/${docId}`).set(canonicalReorderRequestFields(overrides));
}

async function seedReorderPurchaseOrder(docId, { reorderRequestId, partId, status = "ORDERED", createdBy = "user-pa-1" }) {
  await db.doc(`reorder_purchase_orders/${docId}`).set({
    reorderRequestId, partId, supplierName: "Acme Parts Co.", externalPoNumber: "PO-99",
    orderedQuantity: 5, orderedDate: "2026-07-01", expectedArrivalDate: null,
    status, createdBy, createdAt: now,
  });
}

async function seed() {
  await db.doc("users/user-admin-1").set({ role: "admin" });
  await db.doc("users/user-dispatcher-1").set({ role: "dispatcher" });

  await db.doc("employees/emp-pm-1").set({
    employeeId: "emp-pm-1", displayName: "Parts Manager One", employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"], userId: "user-pm-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-pm-1").set({ role: "technician", employeeId: "emp-pm-1" });

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

  await db.doc("employees/emp-wm-1").set({
    employeeId: "emp-wm-1", displayName: "Warehouse Manager One", employmentStatus: "ACTIVE",
    operationalRoles: ["WAREHOUSE_MANAGER"], userId: "user-wm-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-wm-1").set({ role: "technician", employeeId: "emp-wm-1" });

  // Broken/inactive linkage fixtures.
  await db.doc("users/user-broken-1").set({ role: "technician", employeeId: "emp-broken-does-not-exist" });
  await db.doc("employees/emp-inactive-1").set({
    employeeId: "emp-inactive-1", displayName: "Inactive Technician", employmentStatus: "TERMINATED",
    operationalRoles: ["PARTS_ASSOCIATE"], userId: "user-inactive-1", createdAt: now, updatedAt: now,
  });
  await db.doc("users/user-inactive-1").set({ role: "technician", employeeId: "emp-inactive-1" });

  // -- Fixtures, one per transition under test --
  await seedReorderRequest("rr-assign-by-pm", {});
  await seedReorderRequest("rr-assign-by-pa", {}); // PARTS_ASSOCIATE attempting Assign -- must be denied

  // Approve/Reject-attempt fixtures -- Issue #100 PR 3a's own required
  // negative coverage (Approve/Reject remains isAdminOrDispatcher()
  // alone, unchanged by this PR's restructuring; confirmed by the
  // Rules diff touching only that branch's structural nesting, not its
  // authorization clause -- these tests prove that empirically). One
  // dedicated fixture per (role, decision) combination so a denied
  // attempt's "left unchanged" check compares against a document no
  // other test in this file has touched.
  await seedReorderRequest("rr-approve-attempt-by-pm", {
    status: "PENDING_REVIEW", currentOwner: "INVENTORY",
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
  });
  await seedReorderRequest("rr-reject-attempt-by-pm", {
    status: "PENDING_REVIEW", currentOwner: "INVENTORY",
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
  });
  await seedReorderRequest("rr-approve-attempt-by-pa", {
    status: "PENDING_REVIEW", currentOwner: "INVENTORY",
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
  });
  await seedReorderRequest("rr-reject-attempt-by-pa", {
    status: "PENDING_REVIEW", currentOwner: "INVENTORY",
    reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
  });
  await seedReorderRequest("rr-start-purchasing", {
    status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
  });
  await seedReorderRequest("rr-start-purchasing-not-assignee", {
    status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
  });
  await seedReorderRequest("rr-progress-update", {
    status: "PURCHASING_IN_PROGRESS", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: "user-pa-1",
  });
  await seedReorderRequest("rr-record-po", {
    status: "PURCHASING_IN_PROGRESS", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: "user-pa-1",
  });
  await seedReorderRequest("rr-mark-received", {
    status: "ORDERED", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: "user-pa-1",
    purchaseOrderId: "rr-mark-received", orderedBy: "user-pa-1", orderedAt: now,
  });
  await seedReorderRequest("rr-cancel-attempt", {
    status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
  });
  await seedReorderRequest("rr-void-attempt", {
    status: "ORDERED", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: "user-pa-1",
    purchaseOrderId: "rr-void-attempt", orderedBy: "user-pa-1", orderedAt: now,
  });
  await seedReorderPurchaseOrder("rr-void-attempt", { reorderRequestId: "rr-void-attempt", partId: "part-issue100-pr3a" });

  // Self-scoped read fixtures.
  await seedReorderRequest("rr-self-read-owned", {
    status: "ORDERED", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-1", assignedBy: "user-pm-1", assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: "user-pa-1",
    purchaseOrderId: "rr-self-read-owned", orderedBy: "user-pa-1", orderedAt: now,
  });
  await seedReorderPurchaseOrder("rr-self-read-owned", { reorderRequestId: "rr-self-read-owned", partId: "part-issue100-pr3a" });

  await seedReorderRequest("rr-self-read-other", {
    status: "ORDERED", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-pa-2", assignedBy: "user-pm-1", assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: "user-pa-2",
    purchaseOrderId: "rr-self-read-other", orderedBy: "user-pa-2", orderedAt: now,
  });
  await seedReorderPurchaseOrder("rr-self-read-other", { reorderRequestId: "rr-self-read-other", partId: "part-issue100-pr3a", createdBy: "user-pa-2" });

  // Admin/dispatcher regression fixture (existing capability unaffected).
  await seedReorderRequest("rr-admin-mark-received-regression", {
    status: "ORDERED", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: "user-admin-1", assignedBy: "user-admin-1", assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: "user-admin-1",
    purchaseOrderId: "rr-admin-mark-received-regression", orderedBy: "user-admin-1", orderedAt: now,
  });
}

async function main() {
  await seed();

  const tokens = {};
  for (const uid of ["user-admin-1", "user-dispatcher-1", "user-pm-1", "user-pa-1", "user-pa-2", "user-wm-1", "user-broken-1", "user-inactive-1"]) {
    tokens[uid] = await idTokenFor(uid);
  }

  // === Assign -- merged branch: admin/dispatcher OR eligible PARTS_MANAGER ===

  report("PARTS_MANAGER Assign succeeds (merged branch, Issue #100 PR 3a)",
    (await updateDoc("reorder_requests", "rr-assign-by-pm", tokens["user-pm-1"], {
      status: str("ASSIGNED_TO_PARTS_ASSOCIATE"),
      currentOwner: str("PARTS_ASSOCIATE"),
      assignedToUserId: str("user-pa-1"),
      assignedBy: str("user-pm-1"),
      assignedAt: int(now),
    })) === 200);

  report("PARTS_ASSOCIATE Assign attempt denied -- PARTS_ASSOCIATE never gains Assign",
    (await updateDoc("reorder_requests", "rr-assign-by-pa", tokens["user-pa-1"], {
      status: str("ASSIGNED_TO_PARTS_ASSOCIATE"),
      currentOwner: str("PARTS_ASSOCIATE"),
      assignedToUserId: str("user-pa-1"),
      assignedBy: str("user-pa-1"),
      assignedAt: int(now),
    })) === 403);

  // === Approve/Reject -- confirmed still admin/dispatcher-only, no OR
  // added for any operational role. Each denied attempt is verified
  // TWICE: the write itself returns 403, AND a post-attempt Admin SDK
  // snapshot is byte-for-byte identical to the pre-attempt snapshot --
  // proving the denial is real (no partial write, no field leaking
  // through despite the overall 403), not merely that the HTTP status
  // code happened to be 403 while something else silently changed. ===

  {
    const before = await snapshot("reorder_requests", "rr-approve-attempt-by-pm");
    const status = await updateDoc("reorder_requests", "rr-approve-attempt-by-pm", tokens["user-pm-1"], {
      status: str("READY_FOR_PARTS_MANAGER"),
      reviewDecision: str("APPROVED"),
      currentOwner: str("PARTS_MANAGER"),
    });
    const after = await snapshot("reorder_requests", "rr-approve-attempt-by-pm");
    report("PARTS_MANAGER cannot Approve -- Approve/Reject remains admin/dispatcher-only", status === 403);
    report("PARTS_MANAGER's denied Approve attempt left the request byte-for-byte unchanged",
      JSON.stringify(before) === JSON.stringify(after));
  }

  {
    const before = await snapshot("reorder_requests", "rr-reject-attempt-by-pm");
    const status = await updateDoc("reorder_requests", "rr-reject-attempt-by-pm", tokens["user-pm-1"], {
      status: str("REJECTED"),
      reviewDecision: str("REJECTED"),
      reviewNotes: str("Attempted by an ineligible role"),
      currentOwner: str("INVENTORY"),
    });
    const after = await snapshot("reorder_requests", "rr-reject-attempt-by-pm");
    report("PARTS_MANAGER cannot Reject -- Approve/Reject remains admin/dispatcher-only", status === 403);
    report("PARTS_MANAGER's denied Reject attempt left the request byte-for-byte unchanged",
      JSON.stringify(before) === JSON.stringify(after));
  }

  {
    const before = await snapshot("reorder_requests", "rr-approve-attempt-by-pa");
    const status = await updateDoc("reorder_requests", "rr-approve-attempt-by-pa", tokens["user-pa-1"], {
      status: str("READY_FOR_PARTS_MANAGER"),
      reviewDecision: str("APPROVED"),
      currentOwner: str("PARTS_MANAGER"),
    });
    const after = await snapshot("reorder_requests", "rr-approve-attempt-by-pa");
    report("PARTS_ASSOCIATE cannot Approve -- Approve/Reject remains admin/dispatcher-only", status === 403);
    report("PARTS_ASSOCIATE's denied Approve attempt left the request byte-for-byte unchanged",
      JSON.stringify(before) === JSON.stringify(after));
  }

  {
    const before = await snapshot("reorder_requests", "rr-reject-attempt-by-pa");
    const status = await updateDoc("reorder_requests", "rr-reject-attempt-by-pa", tokens["user-pa-1"], {
      status: str("REJECTED"),
      reviewDecision: str("REJECTED"),
      reviewNotes: str("Attempted by an ineligible role"),
      currentOwner: str("INVENTORY"),
    });
    const after = await snapshot("reorder_requests", "rr-reject-attempt-by-pa");
    report("PARTS_ASSOCIATE cannot Reject -- Approve/Reject remains admin/dispatcher-only", status === 403);
    report("PARTS_ASSOCIATE's denied Reject attempt left the request byte-for-byte unchanged",
      JSON.stringify(before) === JSON.stringify(after));
  }

  // === Start Purchasing -- assignee-restricted, gains the new OR ===

  report("PARTS_ASSOCIATE assignee: Start Purchasing succeeds",
    (await updateDoc("reorder_requests", "rr-start-purchasing", tokens["user-pa-1"], {
      status: str("PURCHASING_IN_PROGRESS"),
      purchasingStartedBy: str("user-pa-1"),
      purchasingStartedAt: int(now),
    })) === 200);

  report("A DIFFERENT PARTS_ASSOCIATE (not the assignee): Start Purchasing denied",
    (await updateDoc("reorder_requests", "rr-start-purchasing-not-assignee", tokens["user-pa-2"], {
      status: str("PURCHASING_IN_PROGRESS"),
      purchasingStartedBy: str("user-pa-2"),
      purchasingStartedAt: int(now),
    })) === 403);

  // === Post Purchasing Update -- assignee-restricted, gains the new OR ===

  report("PARTS_ASSOCIATE assignee: Post Purchasing Update succeeds",
    (await updateDoc("reorder_requests", "rr-progress-update", tokens["user-pa-1"], {
      purchasingNotes: str("Vendor contacted, awaiting quote"),
      vendorContacted: str("Acme Parts Co."),
      expectedAvailabilityDate: str("2026-08-01"),
      lastPurchasingUpdateAt: int(now),
      lastPurchasingUpdateBy: str("user-pa-1"),
    })) === 200);

  // === Record PO -- assignee-restricted, gains the new OR; atomic 2-doc commit ===

  report("PARTS_ASSOCIATE assignee: Record PO succeeds (atomic reorder_requests + reorder_purchase_orders commit)",
    (await recordPoCommit("rr-record-po", tokens["user-pa-1"], {
      requestFields: {
        status: str("ORDERED"),
        purchaseOrderId: str("rr-record-po"),
        orderedBy: str("user-pa-1"),
        orderedAt: int(now),
      },
      poFields: {
        reorderRequestId: str("rr-record-po"),
        partId: str("part-issue100-pr3a"),
        supplierName: str("Acme Parts Co."),
        externalPoNumber: str("PO-100"),
        orderedQuantity: int(5),
        orderedDate: str("2026-07-01"),
        expectedArrivalDate: nul(),
        status: str("ORDERED"),
        createdBy: str("user-pa-1"),
        createdAt: int(now),
      },
    })) === 200);

  // === Mark Received -- assignee-restricted, gains the new OR ===

  report("PARTS_ASSOCIATE assignee: Mark Received succeeds",
    (await updateDoc("reorder_requests", "rr-mark-received", tokens["user-pa-1"], {
      status: str("RECEIVED"),
      receivedBy: str("user-pa-1"),
      receivedAt: int(now),
    })) === 200);

  report("admin/dispatcher Mark Received regression -- existing admin capability unaffected",
    (await updateDoc("reorder_requests", "rr-admin-mark-received-regression", tokens["user-admin-1"], {
      status: str("RECEIVED"),
      receivedBy: str("user-admin-1"),
      receivedAt: int(now),
    })) === 200);

  // === Cancel -- confirmed still admin/dispatcher-only, PARTS_ASSOCIATE never gains it ===

  report("PARTS_ASSOCIATE Cancel attempt denied -- Cancel remains admin/dispatcher-only",
    (await updateDoc("reorder_requests", "rr-cancel-attempt", tokens["user-pa-1"], {
      status: str("CANCELLED"),
      cancelledBy: str("user-pa-1"),
      cancelledAt: int(now),
      cancellationReason: str("Attempted by an ineligible role"),
    })) === 403);

  // === Void -- confirmed still admin/dispatcher AND assignee, PARTS_ASSOCIATE alone insufficient ===

  report("PARTS_ASSOCIATE Void attempt denied even as the correct assignee -- Void remains admin/dispatcher AND assignee, never PARTS_ASSOCIATE alone",
    (await voidCommit("rr-void-attempt", tokens["user-pa-1"], {
      requestFields: {
        status: str("VOIDED"),
        voidedBy: str("user-pa-1"),
        voidedAt: int(now),
        voidReason: str("Attempted by an ineligible role"),
      },
      voidFields: {
        reorderPurchaseOrderId: str("rr-void-attempt"),
        reorderRequestId: str("rr-void-attempt"),
        partId: str("part-issue100-pr3a"),
        voidedBy: str("user-pa-1"),
        reason: str("Attempted by an ineligible role"),
        createdAt: int(now),
      },
    })) === 403);

  // === Self-scoped reads: reorder_purchase_orders / reorder_purchase_order_voids ===

  report("PARTS_ASSOCIATE reads their OWN reorder_purchase_orders document",
    (await getDocAt("reorder_purchase_orders", "rr-self-read-owned", tokens["user-pa-1"])) === 200);

  report("PARTS_ASSOCIATE denied a DIFFERENT Parts Associate's reorder_purchase_orders document",
    (await getDocAt("reorder_purchase_orders", "rr-self-read-other", tokens["user-pa-1"])) === 403);

  report("WAREHOUSE_MANAGER denied reorder_purchase_orders (not this role's grant)",
    (await getDocAt("reorder_purchase_orders", "rr-self-read-owned", tokens["user-wm-1"])) === 403);

  // === Broken / inactive linkage -- fail closed on a lifecycle write ===

  report("Broken-linkage technician denied Start Purchasing",
    (await updateDoc("reorder_requests", "rr-start-purchasing-not-assignee", tokens["user-broken-1"], {
      status: str("PURCHASING_IN_PROGRESS"),
      purchasingStartedBy: str("user-broken-1"),
      purchasingStartedAt: int(now),
    })) === 403);

  report("Inactive-employment PARTS_ASSOCIATE denied Start Purchasing despite an otherwise-eligible role",
    (await updateDoc("reorder_requests", "rr-start-purchasing-not-assignee", tokens["user-inactive-1"], {
      status: str("PURCHASING_IN_PROGRESS"),
      purchasingStartedBy: str("user-inactive-1"),
      purchasingStartedAt: int(now),
    })) === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
