// AUTH-PR-3 -- admin-initiated password reset command tests. Follows this
// repo's Firestore-emulator convention (firebase-admin against a live
// emulator; no test runner, no @firebase/rules-unit-testing). Admin-SDK deps
// (link generation, revocation, email lookup, delivery) are INJECTED fakes so
// the test proves authorization, protected-account handling, delivery-confirmed
// revocation ordering, durable auditing, and output sanitization -- no Auth
// emulator or real send/revocation required.
//
// Prerequisite: a live Firestore emulator, then (after `npm run build`):
//   node functions/test/adminCredentialCommands.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import {
  initiateAdminPasswordReset,
  listResetEligibleUsers,
  NOT_CONFIGURED_DELIVERY,
  UnauthorizedActorError,
  ProtectedAccountError,
  InvalidInputError,
} from "../lib/access/adminCredentialCommands.js";

admin.initializeApp({ projectId: "demo-authpr3" });
const db = getFirestore();

let passed = 0;
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }
async function expectThrows(name, ErrType, fn) {
  await okAsync(name, async () => {
    await assert.rejects(fn, (e) => e instanceof ErrType, `expected ${ErrType.name}`);
  });
}

async function clearCollection(name) {
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
async function reset() { await clearCollection("users"); await clearCollection("auditEvents"); }
async function setUser(uid, data) { await db.collection("users").doc(uid).set(data); }
async function auditsFor(targetId) {
  const snap = await db.collection("auditEvents").where("targetId", "==", targetId).get();
  return snap.docs.map((d) => d.data());
}

// Injected fake deps with call-order tracking. The link deliberately contains a
// secret-looking token so we can assert it never escapes into outputs.
function makeDeps({ delivered = true, email = "target@example.com", delivery } = {}) {
  const order = [];
  const calls = { generate: 0, revoke: 0, deliver: 0 };
  const deps = {
    generateResetLink: async () => { calls.generate += 1; order.push("generate"); return "https://emu/reset?oobCode=SUPERSECRETTOKEN"; },
    revokeRefreshTokens: async () => { calls.revoke += 1; order.push("revoke"); },
    getRecoverableEmail: async () => email,
    delivery: delivery ?? { deliverResetLink: async () => { calls.deliver += 1; order.push("deliver"); return { delivered }; } },
  };
  return { deps, calls, order };
}

const ADMIN = "admin-uid-1";
const ADMIN2 = "admin-uid-2";
const DISP = "dispatcher-uid-1";
const TARGET = "target-uid-1";
async function seedRoles() {
  await setUser(ADMIN, { role: "admin", displayName: "Ada Admin", employeeId: "emp-a" });
  await setUser(ADMIN2, { role: "admin", displayName: "Al Admin" });
  await setUser(DISP, { role: "dispatcher", displayName: "Dee Dispatch" });
  await setUser(TARGET, { role: "technician", displayName: "Tay Tech", employeeId: "emp-t" });
}

// -- authorization ----------------------------------------------------------
await reset(); await seedRoles();
await expectThrows("non-admin (technician) actor is denied", UnauthorizedActorError, () =>
  initiateAdminPasswordReset({ actorUid: TARGET, targetUid: ADMIN2 }, makeDeps().deps));
await okAsync("denied authorization writes a denied audit event", async () => {
  const events = await auditsFor(ADMIN2);
  assert.ok(events.some((e) => e.action === "initiateAdminPasswordReset" && e.outcome === "denied"));
});
await expectThrows("dispatcher actor is denied (not isAdminOrDispatcher)", UnauthorizedActorError, () =>
  initiateAdminPasswordReset({ actorUid: DISP, targetUid: TARGET }, makeDeps().deps));

// -- protected account: no self-reset via the admin tool --------------------
await reset(); await seedRoles();
await expectThrows("self-reset via admin tool is rejected", ProtectedAccountError, () =>
  initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: ADMIN }, makeDeps().deps));

// -- no recoverable email ---------------------------------------------------
await reset(); await seedRoles();
await expectThrows("target without a recoverable email is rejected", InvalidInputError, () =>
  initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET }, makeDeps({ email: null }).deps));

// -- routine: delivery-confirmed revocation (revoke AFTER deliver) ----------
await reset(); await seedRoles();
await okAsync("routine + confirmed delivery -> generate, deliver, THEN revoke; 3 applied audits", async () => {
  const { deps, calls, order } = makeDeps({ delivered: true });
  const outcome = await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, mode: "routine" }, deps);
  assert.deepStrictEqual(outcome, { status: "reset_initiated", deliveryOutcome: "delivered", sessionRevocationOutcome: "revoked" });
  assert.deepStrictEqual(calls, { generate: 1, deliver: 1, revoke: 1 });
  assert.deepStrictEqual(order, ["generate", "deliver", "revoke"]); // revoke only after delivery
  const ev = await auditsFor(TARGET);
  const applied = ev.filter((e) => e.outcome === "applied").map((e) => e.action).sort();
  assert.deepStrictEqual(applied, ["deliverAdminPasswordReset", "initiateAdminPasswordReset", "revokeUserSessions"]);
  // Output never carries the link/token.
  assert.ok(!JSON.stringify(outcome).toLowerCase().includes("oobcode"));
  assert.ok(!JSON.stringify(outcome).includes("SUPERSECRETTOKEN"));
});

// -- routine: NOT-configured delivery -> no revocation ----------------------
await reset(); await seedRoles();
await okAsync("routine + not-configured delivery -> NO revocation; delivery+revocation audited as not-applied", async () => {
  const { deps, calls } = makeDeps({ delivery: NOT_CONFIGURED_DELIVERY });
  const outcome = await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, mode: "routine" }, deps);
  assert.deepStrictEqual(outcome, { status: "reset_initiated", deliveryOutcome: "not_delivered", sessionRevocationOutcome: "skipped" });
  assert.strictEqual(calls.generate, 1);
  assert.strictEqual(calls.revoke, 0); // never revoked without confirmed delivery
  const ev = await auditsFor(TARGET);
  assert.ok(ev.some((e) => e.action === "deliverAdminPasswordReset" && e.outcome === "denied"));
  assert.ok(ev.some((e) => e.action === "revokeUserSessions" && e.outcome === "denied"));
  assert.ok(ev.some((e) => e.action === "initiateAdminPasswordReset" && e.outcome === "applied"));
});

// -- suspected compromise: revoke immediately (BEFORE deliver) --------------
await reset(); await seedRoles();
await okAsync("compromise -> revoke immediately then deliver recovery link", async () => {
  const { deps, calls, order } = makeDeps({ delivered: true });
  const outcome = await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, mode: "suspectedCompromise" }, deps);
  assert.deepStrictEqual(outcome, { status: "sessions_revoked", deliveryOutcome: "delivered", sessionRevocationOutcome: "revoked" });
  assert.deepStrictEqual(order, ["revoke", "generate", "deliver"]); // revoke first
  const ev = await auditsFor(TARGET);
  assert.ok(ev.some((e) => e.action === "revokeUserSessions" && e.outcome === "applied"));
  assert.ok(ev.some((e) => e.action === "deliverAdminPasswordReset" && e.outcome === "applied"));
});

// -- listResetEligibleUsers: sanitized + admin-only -------------------------
await reset(); await seedRoles();
await okAsync("listResetEligibleUsers (admin) returns sanitized rows only", async () => {
  const rows = await listResetEligibleUsers({ actorUid: ADMIN, limit: 50 });
  assert.ok(rows.length >= 4);
  const target = rows.find((r) => r.uid === TARGET);
  assert.deepStrictEqual(Object.keys(target).sort(), ["displayName", "hasEmployeeLink", "role", "uid"]);
  assert.strictEqual(target.hasEmployeeLink, true);
  const blob = JSON.stringify(rows).toLowerCase();
  for (const forbidden of ["email", "password", "claims", "token", "@"]) {
    assert.ok(!blob.includes(forbidden), `list output must not contain "${forbidden}"`);
  }
});
await expectThrows("listResetEligibleUsers denies a non-admin", UnauthorizedActorError, () =>
  listResetEligibleUsers({ actorUid: DISP }));

console.log(`\n${passed} passed`);
process.exit(0);
