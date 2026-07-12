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
  // Inventory Operational Queue, PR A -- dedicated account for the
  // "query failure renders error, not empty" assertion. Its
  // users/{uid}.role is set to an invalid value ONCE, here, at seed
  // time, and is NEVER mutated afterward. This is deliberate, not an
  // oversight: the Firestore emulator was confirmed (2026-07-12,
  // investigating a false-negative on this exact assertion) to cache a
  // security rule's get()-based role lookup PER UID for the emulator
  // process's lifetime -- mutating an EXISTING, previously-validated
  // uid's role (e.g. flipping DRIVER_ACCOUNTS.admin's role mid-session)
  // silently keeps succeeding against the STALE cached value, a real
  // emulator/production parity gap, not an application bug (production
  // Firestore does correctly invalidate this; only the emulator doesn't
  // reproduce that here). A uid whose role is invalid from its very
  // first-ever evaluation is rejected correctly and deterministically --
  // confirmed directly against this exact query shape. See driver.mjs's
  // verify-pr-a query-failure check for the isolated SDK-level assertion
  // this fixture exists for (a full authenticated browser session can't
  // reach this state at all -- App.jsx's own isDomainVisible() route
  // gating requires a recognized admin/dispatcher/technician role before
  // rendering Inventory in the first place, so an invalid role can never
  // reach the "All Assigned Work" UI to click through -- this is why the
  // check is a direct SDK-level listener assertion, not a browser one).
  queryFailureProbe: { email: "driver-query-failure-probe@example.test", password: "driver-pass-123", uid: null },
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

// Inventory Operational Queue, PR A (docs/specifications/inventory-
// operational-queue.md) -- "All Assigned Work" oversight and the
// assignment picker's securityRole eligibility filter.
//
// otherUserAssignedRequest: assigned to a uid that is NOT any
// DRIVER_ACCOUNTS entry -- the exact "Manager B sees a request assigned
// to user A, without being the assignee" scenario the Specification's
// Acceptance criteria requires. Its assignee uid IS linked to a real
// Employee record (otherAssigneeEmployee below) -- Final Review requires
// "All Assigned Work" to resolve and display the current assignee via
// resolveActorDisplayName(), never a raw uid, so this fixture's assignee
// must itself be resolvable to prove that resolution actually happens
// (a dangling, unresolvable uid would only prove the raw-uid FALLBACK
// path, the opposite of what this assertion needs to demonstrate).
//
// securityRoleEmployees: four Employees, all ACTIVE/PARTS_ASSOCIATE-
// eligible-by-operationalRoles/linked-user (so they'd all appear in the
// picker's query results absent the securityRole filter this PR adds),
// differing only in securityRole -- proves the filter's four real
// outcomes: technician excluded (ordinary, no warning), missing/invalid
// excluded WITH the admin-visible warning (the data-quality case), and
// a valid non-technician role included normally.
export const PR_A_FIXTURE = {
  otherUserAssignedRequest: {
    partId: "TST-1010",
    requestId: "driver-seed-all-assigned-other-user",
    assignedToUserId: "driver-seed-other-user-not-signed-in",
  },
  otherAssigneeEmployee: {
    employeeId: "driver-emp-other-assignee",
    displayName: "Other Parts Associate",
    userId: "driver-seed-other-user-not-signed-in",
  },
  // Final Review correction: resolveActorDisplayName() falls back to the
  // raw uid when no Employee links to the assignee's userId at all --
  // this fixture's assignee is DELIBERATELY unlinked (no Employee
  // document references this uid anywhere), proving "All Assigned Work"
  // shows "Unknown assignee" for this case instead of that raw uid.
  unresolvableAssigneeRequest: {
    partId: "TST-1011",
    requestId: "driver-seed-all-assigned-unresolvable",
    assignedToUserId: "driver-seed-unresolvable-user-no-employee-link",
  },
  securityRoleEmployees: {
    eligible: { employeeId: "driver-emp-securityrole-eligible", displayName: "Eligible Dispatcher Assoc", securityRole: "dispatcher" },
    technician: { employeeId: "driver-emp-securityrole-technician", displayName: "Excluded Technician Assoc", securityRole: "technician" },
    missing: { employeeId: "driver-emp-securityrole-missing", displayName: "Missing Role Data Assoc" }, // securityRole deliberately omitted
    invalid: { employeeId: "driver-emp-securityrole-invalid", displayName: "Invalid Role Data Assoc", securityRole: "not_a_real_role" },
  },
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

// Inventory Operational Queue, PR A (docs/specifications/inventory-
// operational-queue.md). One currently-assigned Reorder Request owned
// by a uid other than any signed-in driver account (cross-user
// oversight fixture), plus four Employees exercising the assignment
// picker's securityRole filter's four outcomes.
async function seedPrAFixture() {
  const now = Date.now();

  await seedReorderRequestFixture(PR_A_FIXTURE.otherUserAssignedRequest.requestId, {
    partId: PR_A_FIXTURE.otherUserAssignedRequest.partId,
    status: "ASSIGNED_TO_PARTS_ASSOCIATE",
    currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: PR_A_FIXTURE.otherUserAssignedRequest.assignedToUserId,
    createdAt: now,
  });

  // Linked Employee for the cross-user assignee above -- resolvable via
  // resolveActorDisplayName(), so "All Assigned Work"'s Assignee column
  // renders a real display name for this fixture, not the raw-uid
  // fallback (see PR_A_FIXTURE's own header comment for why this
  // matters for that specific assertion).
  const otherAssignee = PR_A_FIXTURE.otherAssigneeEmployee;
  await db.doc(`employees/${otherAssignee.employeeId}`).set({
    employeeId: otherAssignee.employeeId,
    displayName: otherAssignee.displayName,
    employmentStatus: "ACTIVE",
    operationalRoles: ["PARTS_ASSOCIATE"],
    userId: otherAssignee.userId,
    securityRole: "dispatcher",
    createdAt: now,
    updatedAt: now,
  });

  // Unresolvable-assignee fixture -- deliberately NO matching Employee
  // document anywhere for this uid (see PR_A_FIXTURE's own comment).
  await seedReorderRequestFixture(PR_A_FIXTURE.unresolvableAssigneeRequest.requestId, {
    partId: PR_A_FIXTURE.unresolvableAssigneeRequest.partId,
    status: "PURCHASING_IN_PROGRESS",
    currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: PR_A_FIXTURE.unresolvableAssigneeRequest.assignedToUserId,
    createdAt: now,
  });

  for (const emp of Object.values(PR_A_FIXTURE.securityRoleEmployees)) {
    await db.doc(`employees/${emp.employeeId}`).set({
      employeeId: emp.employeeId,
      displayName: emp.displayName,
      employmentStatus: "ACTIVE",
      operationalRoles: ["PARTS_ASSOCIATE"],
      // Non-null so requireLinkedUser's `where("userId", "!=", null)`
      // clause includes these fixtures -- doesn't need to resolve to a
      // real users/{uid} document, since the picker never reads one
      // (see PR_A_FIXTURE's own header comment above).
      userId: `driver-seed-securityrole-user-${emp.employeeId}`,
      // securityRole intentionally omitted entirely for the "missing"
      // fixture -- `"securityRole" in emp` is false, matching the exact
      // pre-A0 legacy-document shape this filter must also catch.
      ...(("securityRole" in emp) ? { securityRole: emp.securityRole } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
}

// Inventory Health / Parts Catalog separation (PR B, docs/specifications/
// inventory-operational-queue.md). Extracted from seed()'s body so
// driver.mjs's verify-inventory-health-catalog command can delete these
// two parts' inventory_transactions (emulator-only, via the exported
// `db` below) to deterministically render both Inventory Health tabs
// empty for the exact-empty-state-message assertions, then call this
// again to restore them before continuing -- rather than adding any
// production-visible test-only UI behavior to the app itself.
export async function seedLedgerTransactions() {
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
  // one-click submit), the contrasting case to TST-1001 above.
  //
  // Inventory Health / Parts Catalog separation (PR B) -- the "Show
  // All" tab this driver's submit-ready command used to fall back to
  // (per the run-field-ops-app-vite skill's own now-stale Gotcha:
  // "TST-1002's seeded usage came out LOW urgency in practice") is
  // REMOVED. Inventory Health now shows only Critical & High and
  // Needs Planning -- a LOW/MEDIUM-urgency READY part is no longer
  // reachable from either tab. Bumped total 30-day CONSUMED quantity
  // from 10 to 30 (avgDailyUsage 1.0/day, reorderPoint 8.5,
  // availableStock 6 <= reorderPoint) to deterministically land
  // TST-1002 in HIGH, with comfortable margin above the ~21.2-unit
  // HIGH threshold -- resolves the old gotcha instead of working
  // around it. This value is never asserted directly by any test --
  // every assertion checks the analytics engine's own computed output
  // (the rendered urgency badge/tab count), never this input.
  const now = Date.now();
  await db.doc("inventory_transactions/driver-seed-tx-2").set({
    workOrderId: "driver-seed-wo-2",
    partId: "TST-1002",
    type: "CONSUMED",
    quantity: 15,
    timestamp: now - 24 * 60 * 60 * 1000,
  });
  await db.doc("inventory_transactions/driver-seed-tx-3").set({
    workOrderId: "driver-seed-wo-3",
    partId: "TST-1002",
    type: "CONSUMED",
    quantity: 15,
    timestamp: now - 2 * 24 * 60 * 60 * 1000,
  });
}

// Inventory Health / Parts Catalog separation (PR B) -- exported so
// driver.mjs can delete/restore inventory_transactions documents
// directly (Admin SDK, emulator-only) for the empty-state assertions
// above. Not used for any other purpose -- every other driver.mjs
// interaction with the app goes through the real signed-in browser
// session, never this direct Admin SDK handle.
export { db };

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

  // Invalid from the moment this document is first ever created -- see
  // DRIVER_ACCOUNTS.queryFailureProbe's own header comment for why this
  // must never be mutated after this point.
  await db.doc(`users/${DRIVER_ACCOUNTS.queryFailureProbe.uid}`).set({ role: "invalid_role_for_query_failure_probe" });

  await seedLedgerTransactions();

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
  await seedPrAFixture();

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
