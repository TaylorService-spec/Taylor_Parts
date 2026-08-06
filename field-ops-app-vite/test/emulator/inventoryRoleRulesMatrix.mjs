// W2 / Issue #100 -- Firestore Rules matrix (emulator, REPOSITORY-ONLY evidence).
// Proves the already-committed operational-role grants behave correctly BEFORE any
// production deploy. Admin SDK (bypasses Rules) seeds users/employees/fixtures; the
// CLIENT SDK (Rules ENFORCED) then asserts allow/deny per role. No Rules change, no
// production, no deploy. Never prints uids/tokens.
//
// Run from the W2 worktree ROOT (so firebase.json + firestore.rules are loaded from
// the correct branch -- avoids the stale-branch rules gotcha):
//   firebase emulators:exec --only firestore,auth --project demo-inv100 \
//     "node field-ops-app-vite/test/emulator/inventoryRoleRulesMatrix.mjs"
import assert from "node:assert/strict";
import { initializeApp as adminInitApp } from "firebase-admin/app";
import { getFirestore as adminGetFirestore } from "firebase-admin/firestore";
import { getAuth as adminGetAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from "firebase/auth";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-inv100";
const PW = "Passw0rd!23";

// --- Admin SDK (Rules bypassed) for seeding ---
adminInitApp({ projectId: PROJECT });
const adminDb = adminGetFirestore();
const adminAuth = adminGetAuth();

// --- Client SDK (Rules ENFORCED) for assertions ---
const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: "localhost" });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

let passed = 0;
const fails = [];
async function ok(name, fn) {
  try { await fn(); passed += 1; console.log("PASS -- " + name); }
  catch (e) { fails.push(`${name} :: ${e && (e.message || e)}`); console.log("FAIL -- " + name); }
}
async function expectAllowed(name, op) { await ok(name, op); }
async function expectDenied(name, op) {
  await ok(name, async () => {
    try { await op(); assert.fail("expected permission-denied but SUCCEEDED"); }
    catch (e) {
      const code = String(e && (e.code || e.message));
      assert.ok(code.includes("permission-denied"), `expected permission-denied, got: ${code}`);
    }
  });
}

// Create an auth user with a fixed uid + seed its reciprocal users/employees docs.
async function persona({ key, role = "technician", employmentStatus = "ACTIVE", operationalRoles = [], breakLink = false }) {
  const email = `${key}@example.com`;
  const user = await adminAuth.createUser({ uid: key, email, password: PW });
  const employeeId = `emp_${key}`;
  await adminDb.doc(`users/${user.uid}`).set({ role, employeeId, email });
  await adminDb.doc(`employees/${employeeId}`).set({
    userId: breakLink ? "someone-else" : user.uid,
    employmentStatus,
    operationalRoles,
  });
  return user.uid;
}

// A canonical-enough reorder_requests doc for READ + UPDATE-transition tests.
function rr(overrides) {
  return {
    partId: "P-1", urgency: "HIGH", recommendedQty: 5, requestedQty: 5,
    status: "READY_FOR_PARTS_MANAGER", currentOwner: "PARTS_MANAGER", requestedBy: "seed",
    createdAt: 1, reviewedBy: null, reviewedAt: null, reviewDecision: null, reviewNotes: null,
    assignedToUserId: null, assignedBy: null, assignedAt: null,
    purchasingStartedAt: null, purchasingStartedBy: null,
    ...overrides,
  };
}

async function signIn(key) { await signInWithEmailAndPassword(auth, `${key}@example.com`, PW); }

// ---- SEED ----
const pm = await persona({ key: "pm", operationalRoles: ["PARTS_MANAGER"] });
const wm = await persona({ key: "wm", operationalRoles: ["WAREHOUSE_MANAGER"] });
const pa = await persona({ key: "pa", operationalRoles: ["PARTS_ASSOCIATE"] });
const pa2 = await persona({ key: "pa2", operationalRoles: ["PARTS_ASSOCIATE"] });
await persona({ key: "ineligible", operationalRoles: [] });
await persona({ key: "inactive", employmentStatus: "INACTIVE", operationalRoles: ["PARTS_ASSOCIATE"] });
await persona({ key: "broken", operationalRoles: ["PARTS_ASSOCIATE"], breakLink: true });

await adminDb.doc("reorder_requests/rrQueue").set(rr({ status: "READY_FOR_PARTS_MANAGER" }));
await adminDb.doc("reorder_requests/rrPending").set(rr({ status: "PENDING_REVIEW", currentOwner: "INVENTORY" }));
await adminDb.doc("reorder_requests/rrMine").set(rr({
  status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
  assignedToUserId: pa, assignedBy: pm, assignedAt: 2,
}));
await adminDb.doc("reorder_requests/rrOther").set(rr({
  status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE",
  assignedToUserId: pa2, assignedBy: pm, assignedAt: 2,
}));
await adminDb.doc("reorder_requests/rrHistoryPm").set(rr({
  status: "REJECTED", currentOwner: "INVENTORY", reviewDecision: "REJECTED", reviewedBy: pm, reviewNotes: "n",
}));
await adminDb.doc("inventory_transactions/t1").set({ partId: "P-1", type: "RESERVED", qty: 1 });
await adminDb.doc("inventory_actions/a1").set({ partId: "P-1", actionType: "RECEIVE_STOCK", createdAt: 1 });
await adminDb.doc("reorder_purchase_orders/rrMine").set({ reorderRequestId: "rrMine", externalPoNumber: "PO-1" });

// ---- MATRIX ----

// PARTS_MANAGER
await signIn("pm");
await expectAllowed("PM reads Queue (READY_FOR_PARTS_MANAGER)", () => getDoc(doc(db, "reorder_requests/rrQueue")));
await expectAllowed("PM reads oversight (ASSIGNED_TO_PARTS_ASSOCIATE)", () => getDoc(doc(db, "reorder_requests/rrMine")));
await expectAllowed("PM reads own relevant history (reviewedBy==pm)", () => getDoc(doc(db, "reorder_requests/rrHistoryPm")));
await expectAllowed("PM reads inventory_transactions (catalog/health)", () => getDoc(doc(db, "inventory_transactions/t1")));
await expectDenied("PM DENIED PENDING_REVIEW it didn't review", () => getDoc(doc(db, "reorder_requests/rrPending")));
await expectDenied("PM DENIED inventory_actions (WM-only)", () => getDoc(doc(db, "inventory_actions/a1")));
await expectAllowed("PM Assign READY->ASSIGNED (own assignedBy)", () => updateDoc(doc(db, "reorder_requests/rrQueue"), {
  status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE", assignedToUserId: pa, assignedBy: pm, assignedAt: 3,
}));
await signOut(auth);

// WAREHOUSE_MANAGER
await signIn("wm");
await expectAllowed("WM reads inventory_transactions", () => getDoc(doc(db, "inventory_transactions/t1")));
await expectAllowed("WM reads inventory_actions (part activity)", () => getDoc(doc(db, "inventory_actions/a1")));
await expectDenied("WM DENIED reorder_requests Queue (no branch)", () => getDoc(doc(db, "reorder_requests/rrQueue")));
await expectDenied("WM DENIED reorder_purchase_orders", () => getDoc(doc(db, "reorder_purchase_orders/rrMine")));
await signOut(auth);

// PARTS_ASSOCIATE
await signIn("pa");
await expectAllowed("PA reads OWN assigned request", () => getDoc(doc(db, "reorder_requests/rrMine")));
await expectAllowed("PA reads OWN reorder_purchase_order", () => getDoc(doc(db, "reorder_purchase_orders/rrMine")));
await expectDenied("PA DENIED another associate's request (cross-user)", () => getDoc(doc(db, "reorder_requests/rrOther")));
await expectDenied("PA DENIED inventory_transactions (PM/WM only)", () => getDoc(doc(db, "inventory_transactions/t1")));
await expectDenied("PA DENIED inventory_actions", () => getDoc(doc(db, "inventory_actions/a1")));
await expectAllowed("PA Start Purchasing on OWN request", () => updateDoc(doc(db, "reorder_requests/rrMine"), {
  status: "PURCHASING_IN_PROGRESS", purchasingStartedAt: 100, purchasingStartedBy: pa,
}));
await expectDenied("PA DENIED Start Purchasing on ANOTHER's request (cross-user)", () => updateDoc(doc(db, "reorder_requests/rrOther"), {
  status: "PURCHASING_IN_PROGRESS", purchasingStartedAt: 100, purchasingStartedBy: pa,
}));
await expectDenied("PA DENIED Cancel (no leak from restructure)", () => updateDoc(doc(db, "reorder_requests/rrOther"), {
  status: "CANCELLED", cancelledBy: pa, cancelledAt: 100, cancellationReason: "x",
}));
await expectDenied("PA DENIED Assign (no leak from restructure)", () => updateDoc(doc(db, "reorder_requests/rrQueue"), {
  status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE", assignedToUserId: pa, assignedBy: pa, assignedAt: 9,
}));
await signOut(auth);

// NEGATIVE personas -- every grant denied
for (const key of ["ineligible", "inactive", "broken"]) {
  await signIn(key);
  await expectDenied(`${key} DENIED reorder_requests Queue`, () => getDoc(doc(db, "reorder_requests/rrQueue")));
  await expectDenied(`${key} DENIED inventory_transactions`, () => getDoc(doc(db, "inventory_transactions/t1")));
  await expectDenied(`${key} DENIED inventory_actions`, () => getDoc(doc(db, "inventory_actions/a1")));
  await signOut(auth);
}
// inactive/broken specifically must NOT be able to read even an "own-assigned" request
await adminDb.doc("reorder_requests/rrInactive").set(rr({
  status: "ASSIGNED_TO_PARTS_ASSOCIATE", currentOwner: "PARTS_ASSOCIATE", assignedToUserId: "inactive", assignedBy: pm, assignedAt: 2,
}));
await signIn("inactive");
await expectDenied("INACTIVE PA DENIED own-assigned read (employmentStatus gate)", () => getDoc(doc(db, "reorder_requests/rrInactive")));
await signOut(auth);

console.log(`\n${passed} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log("  x " + f)); process.exit(1); }
process.exit(0);
