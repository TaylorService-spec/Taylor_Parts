// Seeds the Firestore + Auth emulator with the accounts the driver
// needs to sign in through the real Login.jsx UI: an admin, and a
// dispatcher (ChatGPT architecture review on PR #93: this fixture is
// ROLES.DISPATCHER by security role, not ROLES.TECHNICIAN -- see the
// dispatcher-vs-technician nav-access gotcha below) whose linked
// Employee has operationalRoles: ["PARTS_MANAGER"] -- the exact
// NEEDS_PLANNING-eligibility scenario firestore.rules'
// canSubmitManualZeroHistoryQuantity() and
// shared/inventory/RequestReorderControl.jsx both gate on.
//
// Uses firebase-admin (devDependency, added for this driver) rather
// than plain REST -- confirmed live that unauthenticated REST writes
// to users/{userId} are denied by firestore.rules' `allow write: if
// false` (role docs are provisioned by an admin only, never a
// client), the same reason functions/test/employeesRules.test.js uses
// the Admin SDK for its own seeding. Admin SDK writes bypass security
// rules entirely by design.
//
// Run against a live Firestore + Auth emulator pair:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, from field-ops-app-vite/:
//   node .claude/skills/run-field-ops-app-vite/seed.mjs
//
// Only ever writes to 127.0.0.1:8080/9099 (FIRESTORE_EMULATOR_HOST/
// FIREBASE_AUTH_EMULATOR_HOST below) -- never touches the live
// "taylor-parts" project.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { fileURLToPath } from "node:url";

const app = initializeApp({ projectId: "taylor-parts" });
const db = getFirestore(app);
const auth = getAuth(app);

export const DRIVER_ACCOUNTS = {
  admin: { email: "driver-admin@example.test", password: "driver-pass-123", uid: null },
  eligiblePartsManager: { email: "driver-parts-manager@example.test", password: "driver-pass-123", uid: null },
  ineligibleDispatcher: { email: "driver-dispatcher@example.test", password: "driver-pass-123", uid: null },
};

async function ensureAuthUser(acct) {
  try {
    const existing = await auth.getUserByEmail(acct.email);
    acct.uid = existing.uid;
  } catch {
    const created = await auth.createUser({ email: acct.email, password: acct.password, emailVerified: true });
    acct.uid = created.uid;
  }
}

// Notification identity fix (docs/specifications/notification-identity.md,
// Issue #145) -- one dedicated REAL catalog part (data/partsCatalog.ts
// -- PartDetail.jsx's getCatalogItem(partId) short-circuits to an
// "Unknown part" message for any id not in that fixed catalog list, so
// this fixture reuses TST-1004..TST-1007 rather than inventing new
// ids) per Notification Panel section / PartsList.jsx queue this
// fixture needs to exercise, each seeded with TWO reorder_requests
// documents: an ACTIVE one (the status that section/queue actually
// surfaces) and a TERMINAL (CANCELLED) sibling for the SAME part with
// a deliberately LATER createdAt. This is the exact defect scenario:
// the old partId-only navigation would have resolved to the terminal
// sibling (newest by createdAt, no status filter) instead of the
// active document a real notification click
// should land on. Exported so driver.mjs can assert against the exact
// expected requestId per case, not just "some request for this part."
export const NOTIFICATION_IDENTITY_FIXTURE = {
  pendingReview: { partId: "TST-1004", activeId: "driver-seed-notif-pending-active", status: "PENDING_REVIEW" },
  readyForPartsManager: { partId: "TST-1005", activeId: "driver-seed-notif-readypm-active", status: "READY_FOR_PARTS_MANAGER" },
  assignedToYou: { partId: "TST-1006", activeId: "driver-seed-notif-assigned-active", status: "ASSIGNED_TO_PARTS_ASSOCIATE" },
  purchasingStarted: { partId: "TST-1007", activeId: "driver-seed-notif-purchasing-active", status: "PURCHASING_IN_PROGRESS" },
};

// Cancel/Void schema deployment sequence, PR 6 of 6 (docs/specifications/
// reorder-request-cancellation.md). Two real catalog parts (data/
// partsCatalog.ts), each seeded fresh (eligible, not-yet-terminal) for
// driver.mjs's verify-cancel-void command to actually transition
// through the real UI/domain functions, not pre-seeded as already
// CANCELLED/VOIDED -- the whole point is to exercise
// cancelReorderRequest()/voidPurchaseOrder() live. cancelEligible sits
// at ASSIGNED_TO_PARTS_ASSOCIATE (one of the three reachable
// pre-order statuses; any of the three would do -- this one exercises
// ReorderRequestStartPurchasing's Cancel action specifically).
// voidEligible sits at ORDERED with a linked reorder_purchase_orders
// document already recorded (Void requires one to exist), assigned to
// the admin driver account so the same account satisfies BOTH
// Rules conditions (isAdminOrDispatcher() AND current assignee) with
// no second account needed.
export const CANCEL_VOID_FIXTURE = {
  cancelEligible: { partId: "TST-1008", requestId: "driver-seed-cancel-eligible", status: "ASSIGNED_TO_PARTS_ASSOCIATE" },
  voidEligible: { partId: "TST-1009", requestId: "driver-seed-void-eligible", status: "ORDERED" },
};

async function seedReorderRequestFixture(docId, { partId, status, currentOwner, assignedToUserId, createdAt }) {
  const isCancelled = status === "CANCELLED";
  await db.doc(`reorder_requests/${docId}`).set({
    partId,
    recommendationStatus: "READY",
    urgency: "HIGH",
    quantitySource: "ANALYTICS",
    recommendedQty: 5,
    requestedQty: 5,
    status,
    currentOwner,
    requestedBy: DRIVER_ACCOUNTS.admin.uid,
    createdAt,
    reviewedBy: DRIVER_ACCOUNTS.admin.uid,
    reviewedAt: createdAt,
    reviewDecision: "APPROVED",
    reviewNotes: null,
    assignedToUserId: assignedToUserId ?? null,
    assignedBy: assignedToUserId ? DRIVER_ACCOUNTS.admin.uid : null,
    assignedAt: assignedToUserId ? createdAt : null,
    purchasingStartedAt: status === "PURCHASING_IN_PROGRESS" ? createdAt : null,
    purchasingStartedBy: status === "PURCHASING_IN_PROGRESS" ? assignedToUserId : null,
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
    cancelledBy: isCancelled ? DRIVER_ACCOUNTS.admin.uid : null,
    cancelledAt: isCancelled ? createdAt : null,
    cancellationReason: isCancelled ? "Test fixture -- terminal sibling for notification identity verification" : null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  });
}

async function seedNotificationIdentityFixture() {
  const now = Date.now();
  const currentOwnerByStatus = {
    PENDING_REVIEW: "INVENTORY",
    READY_FOR_PARTS_MANAGER: "PARTS_MANAGER",
    ASSIGNED_TO_PARTS_ASSOCIATE: "PARTS_ASSOCIATE",
    PURCHASING_IN_PROGRESS: "PARTS_ASSOCIATE",
  };
  const assignedToUserIdByStatus = {
    PENDING_REVIEW: null,
    READY_FOR_PARTS_MANAGER: null,
    ASSIGNED_TO_PARTS_ASSOCIATE: DRIVER_ACCOUNTS.admin.uid,
    PURCHASING_IN_PROGRESS: DRIVER_ACCOUNTS.admin.uid,
  };

  for (const c of Object.values(NOTIFICATION_IDENTITY_FIXTURE)) {
    const currentOwner = currentOwnerByStatus[c.status];
    const assignedToUserId = assignedToUserIdByStatus[c.status];

    // Active document -- older createdAt. Every notification/queue
    // link for this case must resolve here.
    await seedReorderRequestFixture(c.activeId, {
      partId: c.partId,
      status: c.status,
      currentOwner,
      assignedToUserId,
      createdAt: now - 60_000,
    });

    // Terminal sibling, same part, deliberately NEWER createdAt -- the
    // document the pre-fix, partId-only navigation would have
    // resolved to instead.
    await seedReorderRequestFixture(`${c.activeId}-terminal`, {
      partId: c.partId,
      status: "CANCELLED",
      currentOwner,
      assignedToUserId,
      createdAt: now,
    });
  }
}

async function seedCancelVoidFixture() {
  const now = Date.now();

  // A prior run of driver.mjs's verify-cancel-void command may have
  // already voided voidEligible against this same emulator instance
  // (the emulator holds state across repeated `node seed.mjs` calls
  // within one `emulators:start` session -- it's only `reorder_requests`/
  // `reorder_purchase_orders` this function unconditionally overwrites
  // below). voidPurchaseOrder()'s own voidRef.exists() guard would
  // then reject a second void attempt as "already been voided" even
  // though the Reorder Request side was reset back to ORDERED --
  // clearing any leftover void record first makes reseeding fully
  // deterministic, the same guarantee every other fixture in this file
  // already has by unconditionally overwriting its own documents.
  await db.doc(`reorder_purchase_order_voids/${CANCEL_VOID_FIXTURE.voidEligible.requestId}`).delete();

  // Cancel-eligible: ASSIGNED_TO_PARTS_ASSOCIATE, assigned to admin so
  // ReorderRequestStartPurchasing's Cancel action is reachable by the
  // same account driver.mjs signs in as (Cancel itself is
  // unrestricted to a specific individual -- isAdminOrDispatcher()
  // alone -- but the assignment still needs to exist for this status
  // to be reachable).
  await seedReorderRequestFixture(CANCEL_VOID_FIXTURE.cancelEligible.requestId, {
    partId: CANCEL_VOID_FIXTURE.cancelEligible.partId,
    status: CANCEL_VOID_FIXTURE.cancelEligible.status,
    currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: DRIVER_ACCOUNTS.admin.uid,
    createdAt: now,
  });

  // Void-eligible: ORDERED, assigned to admin (so the same account
  // satisfies BOTH Rules conditions -- isAdminOrDispatcher() AND
  // current assignee), with a linked reorder_purchase_orders document
  // already recorded -- Void's Purchase-Order-existence proof requires
  // one to exist before the void write is even attempted.
  const { requestId, partId } = CANCEL_VOID_FIXTURE.voidEligible;
  await db.doc(`reorder_requests/${requestId}`).set({
    partId,
    recommendationStatus: "READY",
    urgency: "HIGH",
    quantitySource: "ANALYTICS",
    recommendedQty: 3,
    requestedQty: 3,
    status: "ORDERED",
    currentOwner: "PARTS_ASSOCIATE",
    requestedBy: DRIVER_ACCOUNTS.admin.uid,
    createdAt: now,
    reviewedBy: DRIVER_ACCOUNTS.admin.uid,
    reviewedAt: now,
    reviewDecision: "APPROVED",
    reviewNotes: null,
    assignedToUserId: DRIVER_ACCOUNTS.admin.uid,
    assignedBy: DRIVER_ACCOUNTS.admin.uid,
    assignedAt: now,
    purchasingStartedAt: now,
    purchasingStartedBy: DRIVER_ACCOUNTS.admin.uid,
    purchasingNotes: null,
    vendorContacted: null,
    expectedAvailabilityDate: null,
    lastPurchasingUpdateAt: null,
    lastPurchasingUpdateBy: null,
    purchaseOrderId: requestId,
    orderedBy: DRIVER_ACCOUNTS.admin.uid,
    orderedAt: now,
    receivedBy: null,
    receivedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  });

  await db.doc(`reorder_purchase_orders/${requestId}`).set({
    reorderRequestId: requestId,
    partId,
    supplierName: "Driver Fixture Supplier",
    externalPoNumber: "DRIVER-PO-1",
    orderedQuantity: 3,
    orderedDate: new Date(now).toISOString().slice(0, 10),
    expectedArrivalDate: null,
    status: "ORDERED",
    createdBy: DRIVER_ACCOUNTS.admin.uid,
    createdAt: now,
  });
}

async function seed() {
  for (const acct of Object.values(DRIVER_ACCOUNTS)) {
    await ensureAuthUser(acct);
  }

  await db.doc(`users/${DRIVER_ACCOUNTS.admin.uid}`).set({ role: "admin" });

  await db.doc("employees/driver-emp-parts-manager").set({
    employeeId: "driver-emp-parts-manager",
    displayName: "Driver Parts Manager",
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_MANAGER"],
    userId: DRIVER_ACCOUNTS.eligiblePartsManager.uid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  // ROLES.DISPATCHER, not ROLES.TECHNICIAN -- discovered live via the
  // driver: navConfig.js's ROLE_NAV_ACCESS gates the "Inventory" nav
  // item to admin/dispatcher only, so a pure technician-role user
  // can't reach this screen through navigation at all regardless of
  // Employee operationalRoles (a separate, real UX gap, not fixed
  // here -- see SKILL.md's Gotchas). dispatcher has nav access AND
  // still exercises RequestReorderControl's actual eligibility check
  // (role === "admin" || operationalRoles.includes(...) -- blind to
  // isAdminOrDispatcher()), same scenario PR 2's Rules test already
  // covers ("dispatcher whose linked Employee has operationalRoles:
  // WAREHOUSE_MANAGER").
  await db.doc(`users/${DRIVER_ACCOUNTS.eligiblePartsManager.uid}`).set({
    role: "dispatcher",
    employeeId: "driver-emp-parts-manager",
  });

  await db.doc(`users/${DRIVER_ACCOUNTS.ineligibleDispatcher.uid}`).set({ role: "dispatcher" });

  // One RESERVED ledger transaction against a real catalog SKU
  // (TST-1001, data/partsCatalog.ts) -- no CONSUMED transaction at
  // all, so this part has ledger activity (shows up in the "Needs
  // Reorder" queue) but zero usage history, i.e. exactly the
  // NEEDS_PLANNING state this whole sprint exists to handle. Matches
  // this repo's own root-cause finding: this is real production
  // state, not a contrived edge case (docs/assessments/inventory-
  // zero-history-reorder-behavior.md).
  await db.doc("inventory_transactions/driver-seed-tx-1").set({
    workOrderId: "driver-seed-wo-1",
    partId: "TST-1001",
    type: "RESERVED",
    quantity: 2,
    timestamp: Date.now(),
  });

  // A second part (TST-1002) WITH real CONSUMED history -- exercises
  // the READY path (recommendationStatus: READY, urgency computed,
  // one-click submit), the contrasting case to TST-1001 above. High
  // quantity relative to a low available baseline pushes urgency into
  // CRITICAL/HIGH so it lands in the default "Critical & High" queue
  // filter, not just "Show All".
  const now = Date.now();
  await db.doc("inventory_transactions/driver-seed-tx-2").set({
    workOrderId: "driver-seed-wo-2",
    partId: "TST-1002",
    type: "CONSUMED",
    quantity: 5,
    timestamp: now - 24 * 60 * 60 * 1000,
  });
  await db.doc("inventory_transactions/driver-seed-tx-3").set({
    workOrderId: "driver-seed-wo-3",
    partId: "TST-1002",
    type: "CONSUMED",
    quantity: 5,
    timestamp: now - 2 * 24 * 60 * 60 * 1000,
  });

  // A legacy-shape Reorder Request -- no requestedQty/recommendationStatus/
  // quantitySource key at all (the exact shape createReorderRequest()
  // wrote before PR 3, and what the still-live PR #91 transitional
  // rules branch still accepts). status READY_FOR_PARTS_MANAGER so it
  // renders in PartsList.jsx's "Parts Manager Queue" table -- proves
  // getDisplayQty()'s fallback (domain/inventoryReorderRequests.js)
  // live, in the actual browser, not just via the standalone assertion
  // script PR #92's Final Review fix was verified with.
  await db.doc("reorder_requests/driver-seed-legacy-request").set({
    partId: "TST-1003",
    urgency: "HIGH",
    recommendedQty: 7,
    status: "READY_FOR_PARTS_MANAGER",
    currentOwner: "PARTS_MANAGER",
    requestedBy: DRIVER_ACCOUNTS.admin.uid,
    createdAt: Date.now(),
    reviewedBy: DRIVER_ACCOUNTS.admin.uid,
    reviewedAt: Date.now(),
    reviewDecision: "APPROVED",
    reviewNotes: null,
  });

  await seedNotificationIdentityFixture();
  await seedCancelVoidFixture();

  console.log("Seeded driver accounts:");
  for (const [key, acct] of Object.entries(DRIVER_ACCOUNTS)) {
    console.log(`  ${key}: ${acct.email} / ${acct.password} (uid ${acct.uid})`);
  }
}

// Only self-run when executed directly (`node seed.mjs`) -- driver.mjs
// imports DRIVER_ACCOUNTS (email/password only, uid not needed there)
// without triggering a reseed on every command. fileURLToPath()
// comparison (not a raw `file://` string template) because Windows
// file:// URLs have a third slash before the drive letter
// (file:///D:/...) that a naive template literal comparison misses --
// confirmed live: the naive version silently never matched, so `node
// seed.mjs` printed nothing and seeded nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
