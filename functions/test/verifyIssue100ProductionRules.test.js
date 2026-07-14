// Issue #100 -- emulator proof for functions/scripts/
// verifyIssue100ProductionRules.js (the combined Gate 4 + 7 + 10
// production-verification operator script). This file NEVER touches
// production -- every network call here targets the local
// Firestore/Auth emulator, using the exact same exported check
// functions (signIn/getDocStatus/updateDocStatus/commitStatus/
// snapshotDocs/restoreIfMutated/runChecks) the real operator script
// calls against production, with the Firestore/Identity-Toolkit REST
// base URLs swapped for the emulator's own endpoints via explicit
// parameters (the production script itself never reads an override
// for these -- see that file's own header comment).
//
// Proves, without any production credential:
//   1. checkPrerequisites() correctly refuses to proceed when any
//      required env var, the project guard, or the production-data
//      authorization guard is missing/wrong -- and correctly accepts
//      a fully-populated, correct environment.
//   2. resolveOptionalPairs() correctly reports which optional
//      linkage fixtures are present vs skipped.
//   3. runChecks(), run against the emulator with the real
//      firestore.rules loaded and a full, correctly-shaped fixture
//      set, produces PASS for every required check and zero
//      restoration failures -- i.e. the SAME check logic the operator
//      script uses in production correctly classifies every allowed/
//      denied scenario this initiative's Rules define.
//   4. restoreIfMutated() correctly detects "no mutation" (returns
//      mutated:false), correctly detects and reverts a genuine
//      mutation (single-document AND the two-document create/delete
//      shape Record PO exercises), and -- via a deliberately broken
//      Admin SDK wrapper -- correctly detects and reports a
//      restoration that does NOT come back byte-for-byte (proving the
//      exit-code-3 path's own detection logic is sound, without
//      requiring a genuinely broken production Firestore to trigger
//      it).
//
// Prerequisite: run against a live Firestore + Auth emulator pair,
// e.g.:
//   firebase emulators:start --only firestore,auth --project taylor-parts
// then, in a second terminal:
//   node functions/test/verifyIssue100ProductionRules.test.js
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const admin = require("firebase-admin");
const {
  checkPrerequisites,
  resolveOptionalPairs,
  snapshotDocs,
  restoreIfMutated,
  runChecks,
  REQUIRED_ACCOUNT_ENV,
  REQUIRED_FIXTURE_ENV,
} = require("../scripts/verifyIssue100ProductionRules.js");

const PROJECT_ID = "taylor-parts";
const FIRESTORE_REST_BASE = "http://127.0.0.1:8080/v1";
const IDENTITY_TOOLKIT_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

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

const now = Date.now();

function canonicalReorderRequestFields(overrides) {
  return {
    partId: "part-prod-verify", status: "READY_FOR_PARTS_MANAGER", currentOwner: "PARTS_MANAGER",
    urgency: "LOW", recommendedQty: 1, requestedBy: "user-admin-pv", createdAt: now,
    reviewedBy: "user-admin-pv", reviewedAt: now, reviewDecision: "APPROVED", reviewNotes: null,
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

async function seedReorderPurchaseOrder(docId, { reorderRequestId, partId, status = "ORDERED", createdBy }) {
  await db.doc(`reorder_purchase_orders/${docId}`).set({
    reorderRequestId, partId, supplierName: "Acme Parts Co.", externalPoNumber: "PO-PV-1",
    orderedQuantity: 5, orderedDate: "2026-01-01", expectedArrivalDate: null,
    status, createdBy, createdAt: now,
  });
}

async function seedReorderPurchaseOrderVoid(docId, { reorderRequestId, partId, voidedBy }) {
  await db.doc(`reorder_purchase_order_voids/${docId}`).set({
    reorderPurchaseOrderId: docId, reorderRequestId, partId,
    voidedBy, reason: "prod-verify fixture", createdAt: now,
  });
}

async function ensureAuthUser(email, password) {
  try {
    const existing = await auth.getUserByEmail(email);
    return existing.uid;
  } catch {
    const created = await auth.createUser({ email, password, emailVerified: true });
    return created.uid;
  }
}

async function seedEmployeeAccount({ emailPrefix, employeeIdSuffix, displayName, employmentStatus, operationalRoles, mismatchedUserId }) {
  const email = `${emailPrefix}@example.test`;
  const password = "prod-verify-pass-123";
  const uid = await ensureAuthUser(email, password);
  const employeeId = `emp-prod-verify-${employeeIdSuffix}`;
  await db.doc(`employees/${employeeId}`).set({
    employeeId, displayName, employmentStatus,
    operationalRoles, userId: mismatchedUserId ?? uid,
    createdAt: now, updatedAt: now,
  });
  await db.doc(`users/${uid}`).set({ role: "technician", employeeId });
  return { email, password, uid };
}

async function seedAll() {
  // -- Admin/dispatcher-analog accounts --
  const adminEmail = "admin-prod-verify@example.test";
  const adminPassword = "prod-verify-pass-123";
  const adminUid = await ensureAuthUser(adminEmail, adminPassword);
  await db.doc(`users/${adminUid}`).set({ role: "admin" });

  // -- Operational-role accounts, reciprocally linked, ACTIVE --
  const pm = await seedEmployeeAccount({ emailPrefix: "pm-prod-verify", employeeIdSuffix: "pm", displayName: "PM", employmentStatus: "ACTIVE", operationalRoles: ["PARTS_MANAGER"] });
  const wm = await seedEmployeeAccount({ emailPrefix: "wm-prod-verify", employeeIdSuffix: "wm", displayName: "WM", employmentStatus: "ACTIVE", operationalRoles: ["WAREHOUSE_MANAGER"] });
  const pa = await seedEmployeeAccount({ emailPrefix: "pa-prod-verify", employeeIdSuffix: "pa", displayName: "PA", employmentStatus: "ACTIVE", operationalRoles: ["PARTS_ASSOCIATE"] });
  const paOther = await seedEmployeeAccount({ emailPrefix: "pa-other-prod-verify", employeeIdSuffix: "pa-other", displayName: "PA Other", employmentStatus: "ACTIVE", operationalRoles: ["PARTS_ASSOCIATE"] });

  // -- Optional fail-closed linkage accounts --
  const brokenEmail = "broken-prod-verify@example.test";
  const brokenPassword = "prod-verify-pass-123";
  const brokenUid = await ensureAuthUser(brokenEmail, brokenPassword);
  await db.doc(`users/${brokenUid}`).set({ role: "technician", employeeId: "emp-prod-verify-broken-does-not-exist" });

  const inactive = await seedEmployeeAccount({ emailPrefix: "inactive-prod-verify", employeeIdSuffix: "inactive", displayName: "Inactive", employmentStatus: "TERMINATED", operationalRoles: ["PARTS_MANAGER"] });
  const ineligible = await seedEmployeeAccount({ emailPrefix: "ineligible-prod-verify", employeeIdSuffix: "ineligible", displayName: "Ineligible", employmentStatus: "ACTIVE", operationalRoles: [] });
  const nonreciprocalUid = await ensureAuthUser("nonreciprocal-prod-verify@example.test", "prod-verify-pass-123");
  await seedEmployeeAccount({ emailPrefix: "nonreciprocal-target-prod-verify", employeeIdSuffix: "nonreciprocal", displayName: "Nonreciprocal", employmentStatus: "ACTIVE", operationalRoles: ["PARTS_MANAGER"], mismatchedUserId: "some-other-uid-entirely" });
  await db.doc(`users/${nonreciprocalUid}`).set({ role: "technician", employeeId: "emp-prod-verify-nonreciprocal" });

  // -- reorder_requests / inventory_transactions / inventory_actions fixtures --
  await seedReorderRequest("pv-pm-queue", { status: "READY_FOR_PARTS_MANAGER", currentOwner: "PARTS_MANAGER" });
  await seedReorderRequest("pv-pending-review", { status: "PENDING_REVIEW", currentOwner: "INVENTORY", reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null });
  await seedReorderRequest("pv-pm-oversight", {
    status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: paOther.uid, assignedBy: pm.uid, assignedAt: now,
  });
  await seedReorderRequest("pv-pm-history", {
    status: "RECEIVED", currentOwner: "PARTS_ASSOCIATE", reviewedBy: pm.uid,
    assignedToUserId: paOther.uid, assignedBy: pm.uid, assignedAt: now,
  });
  await db.doc("inventory_transactions/pv-txn-1").set({ partId: "part-prod-verify", type: "CONSUMPTION", quantity: -1, createdAt: now });
  await db.doc("inventory_actions/pv-action-1").set({ partId: "part-prod-verify", type: "RECEIVE_STOCK", quantity: 1, actorUid: adminUid, createdAt: now });

  await seedReorderRequest("pv-pa-assigned", {
    status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: pa.uid, assignedBy: pm.uid, assignedAt: now,
  });
  await seedReorderRequest("pv-pa-purchasing", {
    status: "PURCHASING_IN_PROGRESS", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: pa.uid, assignedBy: pm.uid, assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: pa.uid,
  });
  await seedReorderRequest("pv-pa-record-po", {
    status: "PURCHASING_IN_PROGRESS", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: pa.uid, assignedBy: pm.uid, assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: pa.uid,
  });
  await seedReorderRequest("pv-pa-receive", {
    status: "ORDERED", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: pa.uid, assignedBy: pm.uid, assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: pa.uid,
    purchaseOrderId: "pv-pa-receive", orderedBy: pa.uid, orderedAt: now,
  });
  await seedReorderPurchaseOrder("pv-pa-receive", { reorderRequestId: "pv-pa-receive", partId: "part-prod-verify", status: "ORDERED", createdBy: pa.uid });

  await seedReorderRequest("pv-pa-void-record", {
    status: "VOIDED", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: pa.uid, assignedBy: pm.uid, assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: pa.uid,
    purchaseOrderId: "pv-pa-void-record", orderedBy: pa.uid, orderedAt: now,
    voidedBy: pa.uid, voidedAt: now, voidReason: "prod-verify fixture",
  });
  await seedReorderPurchaseOrder("pv-pa-void-record", { reorderRequestId: "pv-pa-void-record", partId: "part-prod-verify", status: "ORDERED", createdBy: pa.uid });
  await seedReorderPurchaseOrderVoid("pv-pa-void-record", { reorderRequestId: "pv-pa-void-record", partId: "part-prod-verify", voidedBy: pa.uid });

  await seedReorderRequest("pv-pa-other-user", {
    status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
    assignedToUserId: paOther.uid, assignedBy: pm.uid, assignedAt: now,
  });

  return {
    env: {
      FIREBASE_PROJECT_ID: PROJECT_ID,
      PRODUCTION_DATA_AUTHORIZED: "YES",
      FIREBASE_WEB_API_KEY: "fake-api-key",
      GOOGLE_APPLICATION_CREDENTIALS: "/dev/null-not-actually-read-by-admin-sdk-already-initialized",
      PARTS_MANAGER_EMAIL: pm.email, PARTS_MANAGER_PASSWORD: pm.password,
      WAREHOUSE_MANAGER_EMAIL: wm.email, WAREHOUSE_MANAGER_PASSWORD: wm.password,
      PARTS_ASSOCIATE_EMAIL: pa.email, PARTS_ASSOCIATE_PASSWORD: pa.password,
      ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: adminPassword,
      PM_QUEUE_DOC_ID: "pv-pm-queue",
      PENDING_REVIEW_DOC_ID: "pv-pending-review",
      PM_OVERSIGHT_DOC_ID: "pv-pm-oversight",
      PM_HISTORY_DOC_ID: "pv-pm-history",
      INVENTORY_TXN_DOC_ID: "pv-txn-1",
      INVENTORY_ACTIONS_DOC_ID: "pv-action-1",
      PA_ASSIGNED_DOC_ID: "pv-pa-assigned",
      PA_PURCHASING_DOC_ID: "pv-pa-purchasing",
      PA_RECORD_PO_DOC_ID: "pv-pa-record-po",
      PA_RECEIVE_DOC_ID: "pv-pa-receive",
      PA_VOID_RECORD_DOC_ID: "pv-pa-void-record",
      PA_OTHER_USER_DOC_ID: "pv-pa-other-user",
      BROKEN_LINKAGE_EMAIL: brokenEmail, BROKEN_LINKAGE_PASSWORD: brokenPassword,
      INACTIVE_LINKAGE_EMAIL: inactive.email, INACTIVE_LINKAGE_PASSWORD: inactive.password,
      INELIGIBLE_EMAIL: ineligible.email, INELIGIBLE_PASSWORD: ineligible.password,
      NONRECIPROCAL_EMAIL: "nonreciprocal-prod-verify@example.test", NONRECIPROCAL_PASSWORD: "prod-verify-pass-123",
    },
  };
}

async function main() {
  // === 1. checkPrerequisites() -- no network, pure guard logic ===
  const fullEnv = {
    FIREBASE_PROJECT_ID: "taylor-parts",
    PRODUCTION_DATA_AUTHORIZED: "YES",
    FIREBASE_WEB_API_KEY: "x",
    GOOGLE_APPLICATION_CREDENTIALS: "/x",
    ...Object.fromEntries(REQUIRED_ACCOUNT_ENV.map((k) => [k, "x"])),
    ...Object.fromEntries(REQUIRED_FIXTURE_ENV.map((k) => [k, "x"])),
  };
  report("checkPrerequisites: fully-populated, correct environment is accepted", checkPrerequisites(fullEnv).ok === true);

  const missingOne = { ...fullEnv };
  delete missingOne.PARTS_MANAGER_PASSWORD;
  const missingOneResult = checkPrerequisites(missingOne);
  report(
    "checkPrerequisites: refuses when one required account var is missing",
    missingOneResult.ok === false && missingOneResult.reason.includes("PARTS_MANAGER_PASSWORD")
  );

  const missingFixture = { ...fullEnv };
  delete missingFixture.PA_RECORD_PO_DOC_ID;
  const missingFixtureResult = checkPrerequisites(missingFixture);
  report(
    "checkPrerequisites: refuses when one required fixture ID is missing",
    missingFixtureResult.ok === false && missingFixtureResult.reason.includes("PA_RECORD_PO_DOC_ID")
  );

  const wrongProject = { ...fullEnv, FIREBASE_PROJECT_ID: "some-other-project" };
  const wrongProjectResult = checkPrerequisites(wrongProject);
  report(
    "checkPrerequisites: refuses a non-taylor-parts project id (project guard)",
    wrongProjectResult.ok === false && wrongProjectResult.reason.includes("project guard")
  );

  const wrongAuth = { ...fullEnv, PRODUCTION_DATA_AUTHORIZED: "yes" };
  const wrongAuthResult = checkPrerequisites(wrongAuth);
  report(
    "checkPrerequisites: refuses PRODUCTION_DATA_AUTHORIZED unless exactly \"YES\" (case-sensitive)",
    wrongAuthResult.ok === false && wrongAuthResult.reason.includes("production-data guard")
  );

  const missingAuthEntirely = { ...fullEnv };
  delete missingAuthEntirely.PRODUCTION_DATA_AUTHORIZED;
  report(
    "checkPrerequisites: refuses when PRODUCTION_DATA_AUTHORIZED is absent entirely",
    checkPrerequisites(missingAuthEntirely).ok === false
  );

  // === 2. resolveOptionalPairs() -- no network ===
  const partialOptional = { BROKEN_LINKAGE_EMAIL: "x", BROKEN_LINKAGE_PASSWORD: "x", INACTIVE_LINKAGE_EMAIL: "x" };
  const optionalResult = resolveOptionalPairs(partialOptional);
  report(
    "resolveOptionalPairs: a fully-supplied pair is present, a half-supplied pair is skipped",
    optionalResult.present.includes("BROKEN_LINKAGE") &&
      optionalResult.skipped.includes("INACTIVE_LINKAGE") &&
      optionalResult.skipped.includes("INELIGIBLE") &&
      optionalResult.skipped.includes("NONRECIPROCAL")
  );

  // === 3. restoreIfMutated() -- direct, isolated proof ===
  await db.doc("pv-restore-tests/single-doc").set({ value: "original" });
  const singleDocBefore = await snapshotDocs(db, [{ collection: "pv-restore-tests", docId: "single-doc" }]);

  const noMutationOutcome = await restoreIfMutated(db, singleDocBefore);
  report("restoreIfMutated: correctly detects NO mutation when nothing changed", noMutationOutcome.mutated === false && noMutationOutcome.restored === null);

  await db.doc("pv-restore-tests/single-doc").set({ value: "mutated-unexpectedly" });
  const mutationOutcome = await restoreIfMutated(db, singleDocBefore);
  const restoredSnap = await db.doc("pv-restore-tests/single-doc").get();
  report(
    "restoreIfMutated: detects a genuine mutation, restores it, and verifies byte-for-byte",
    mutationOutcome.mutated === true && mutationOutcome.restored === true && restoredSnap.data().value === "original"
  );

  // Two-document create/delete shape (Record PO's own pattern): one doc
  // that did NOT exist before is snapshotted as existed:false, then
  // "unexpectedly" created; restoreIfMutated must delete it back to
  // non-existence.
  const twoDocRefs = [
    { collection: "pv-restore-tests", docId: "primary" },
    { collection: "pv-restore-tests", docId: "created-doc" },
  ];
  await db.doc("pv-restore-tests/primary").set({ value: "primary-original" });
  await db.doc("pv-restore-tests/created-doc").delete().catch(() => {});
  const twoDocBefore = await snapshotDocs(db, twoDocRefs);
  report("restoreIfMutated setup: created-doc correctly snapshotted as non-existent", twoDocBefore[1].existed === false);

  await db.doc("pv-restore-tests/primary").set({ value: "primary-mutated" });
  await db.doc("pv-restore-tests/created-doc").set({ value: "should-not-exist" });
  const twoDocOutcome = await restoreIfMutated(db, twoDocBefore);
  const primaryAfter = await db.doc("pv-restore-tests/primary").get();
  const createdAfter = await db.doc("pv-restore-tests/created-doc").get();
  report(
    "restoreIfMutated: two-document create/delete shape -- primary reverted, created doc deleted",
    twoDocOutcome.mutated === true && twoDocOutcome.restored === true &&
      primaryAfter.data().value === "primary-original" && createdAfter.exists === false
  );

  // Deliberately broken Admin SDK wrapper -- its .set() writes garbage
  // instead of the requested data, proving restoreIfMutated's own
  // re-verification step correctly detects and reports a restoration
  // that does NOT come back byte-for-byte (the exit-code-3 path), and
  // does not "restored: true" when it never actually restored.
  await db.doc("pv-restore-tests/broken-restore").set({ value: "original-value" });
  const brokenRestoreBefore = await snapshotDocs(db, [{ collection: "pv-restore-tests", docId: "broken-restore" }]);
  await db.doc("pv-restore-tests/broken-restore").set({ value: "mutated-value" });

  const realCollection = db.collection.bind(db);
  const brokenDb = {
    collection(name) {
      const real = realCollection(name);
      return {
        doc(id) {
          const realDocRef = real.doc(id);
          return {
            get: () => realDocRef.get(),
            set: () => realDocRef.set({ value: "restore-itself-is-broken" }, { merge: false }),
            delete: () => realDocRef.delete(),
          };
        },
      };
    },
  };
  const brokenRestoreOutcome = await restoreIfMutated(brokenDb, brokenRestoreBefore);
  report(
    "restoreIfMutated: a restore that does NOT come back byte-for-byte is correctly reported as restored:false, never masked as success",
    brokenRestoreOutcome.mutated === true && brokenRestoreOutcome.restored === false
  );
  // Clean up this deliberately-corrupted document via the real Admin SDK.
  await db.doc("pv-restore-tests/broken-restore").set({ value: "original-value" });

  // === 4. runChecks() against a fresh, correctly-shaped fixture set, real Rules ===
  const { env } = await seedAll();
  const r = await runChecks({
    firestoreRestBase: FIRESTORE_REST_BASE,
    identityToolkitBase: IDENTITY_TOOLKIT_BASE,
    projectId: PROJECT_ID,
    adminDb: db,
    env,
  });

  report("runChecks: every check passed against a correctly-shaped fixture set", r.failed === 0, `${r.passed} passed, ${r.failed} failed`);
  report("runChecks: zero restoration failures", r.restorationFailures === 0);
  const skippedCount = r.results.filter((x) => x.ok === null).length;
  report("runChecks: zero SKIPs when every optional fixture is supplied", skippedCount === 0, `${skippedCount} skipped`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
