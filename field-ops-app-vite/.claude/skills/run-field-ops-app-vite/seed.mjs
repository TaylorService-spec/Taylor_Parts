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
