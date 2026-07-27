// AUTH-PR-3 -- admin-initiated password reset command tests (Codex round-2
// hardened). Firestore-emulator convention (firebase-admin against a live
// emulator; no test runner). Admin-SDK deps (link generation, revocation, email
// lookup, delivery) are INJECTED fakes so the test proves authorization,
// fail-closed delivery capability, email-through-the-seam, per-stage failure
// auditing, idempotency/concurrency, and neutral output -- no Auth emulator or
// real send/revocation required.
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
  DeliveryUnavailableError,
  OperationInProgressError,
  AdminResetStageError,
} from "../lib/access/adminCredentialCommands.js";

admin.initializeApp({ projectId: "demo-authpr3" });
const db = getFirestore();

const TEST_EMAIL = "target@example.com";
const SECRET_TOKEN = "SUPERSECRETTOKEN";
const RESET_LINK = `https://emu/reset?oobCode=${SECRET_TOKEN}`;

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
async function reset() {
  await clearCollection("users");
  await clearCollection("auditEvents");
  await clearCollection("admin_credential_reset_ops");
}
async function setUser(uid, data) { await db.collection("users").doc(uid).set(data); }
async function auditsFor(targetId) {
  const snap = await db.collection("auditEvents").where("targetId", "==", targetId).get();
  return snap.docs.map((d) => d.data());
}
function assertNoSecrets(blob) {
  const s = JSON.stringify(blob);
  assert.ok(!s.includes(TEST_EMAIL), "must not contain the target email address");
  assert.ok(!s.includes(SECRET_TOKEN), "must not contain the reset token");
  assert.ok(!s.toLowerCase().includes("oobcode"), "must not contain the reset link");
}

function makeDeps(opts = {}) {
  const { configured = true, delivered = true, email = TEST_EMAIL, generateThrows = false, deliverThrows = false, revokeThrows = false } = opts;
  const order = [];
  const calls = { generate: 0, deliver: 0, revoke: 0 };
  const received = { email: null, link: null };
  const deps = {
    generateResetLink: async () => { calls.generate += 1; order.push("generate"); if (generateThrows) throw new Error("gen boom"); return RESET_LINK; },
    revokeRefreshTokens: async () => { calls.revoke += 1; order.push("revoke"); if (revokeThrows) throw new Error("revoke boom"); },
    getRecoverableEmail: async () => email,
    delivery: {
      isConfigured: () => configured,
      deliverResetLink: async ({ email: e, link }) => { calls.deliver += 1; order.push("deliver"); received.email = e; received.link = link; if (deliverThrows) throw new Error("deliver boom"); return { delivered }; },
    },
  };
  return { deps, calls, order, received };
}

const ADMIN = "admin-uid-1";
const DISP = "dispatcher-uid-1";
const TARGET = "target-uid-1";
async function seedRoles() {
  await setUser(ADMIN, { role: "admin", displayName: "Ada Admin", employeeId: "emp-a" });
  await setUser("admin-uid-2", { role: "admin", displayName: "Al Admin" });
  await setUser(DISP, { role: "dispatcher", displayName: "Dee Dispatch" });
  await setUser(TARGET, { role: "technician", displayName: "Tay Tech", employeeId: "emp-t" });
}
const call = (over) => ({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: `key-${Math.random().toString(36).slice(2)}-abcdef`, ...over });

// -- authorization ----------------------------------------------------------
await reset(); await seedRoles();
await expectThrows("non-admin actor denied", UnauthorizedActorError, () =>
  initiateAdminPasswordReset(call({ actorUid: TARGET, targetUid: "admin-uid-2" }), makeDeps().deps));
await okAsync("denied authorization writes a denied audit event", async () => {
  const ev = await auditsFor("admin-uid-2");
  assert.ok(ev.some((e) => e.action === "initiateAdminPasswordReset" && e.outcome === "denied"));
});
await expectThrows("dispatcher actor denied", UnauthorizedActorError, () =>
  initiateAdminPasswordReset(call({ actorUid: DISP }), makeDeps().deps));

// -- input + protected account ----------------------------------------------
await reset(); await seedRoles();
await expectThrows("self-reset rejected", ProtectedAccountError, () =>
  initiateAdminPasswordReset(call({ targetUid: ADMIN }), makeDeps().deps));
await expectThrows("invalid idempotencyKey rejected", InvalidInputError, () =>
  initiateAdminPasswordReset(call({ idempotencyKey: "short" }), makeDeps().deps));

// -- #1 FAIL CLOSED on unconfigured delivery (no Auth side effect) -----------
await reset(); await seedRoles();
await okAsync("unconfigured COMPROMISE fails closed: zero revoke, zero link generation", async () => {
  const { deps, calls } = makeDeps({ configured: false });
  await assert.rejects(() => initiateAdminPasswordReset(call({ mode: "suspectedCompromise" }), deps), (e) => e instanceof DeliveryUnavailableError);
  assert.strictEqual(calls.revoke, 0);
  assert.strictEqual(calls.generate, 0);
  assert.strictEqual(calls.deliver, 0);
});
await okAsync("unconfigured ROUTINE fails closed: zero revoke, zero link generation", async () => {
  const { deps, calls } = makeDeps({ configured: false });
  await assert.rejects(() => initiateAdminPasswordReset(call({ mode: "routine" }), deps), (e) => e instanceof DeliveryUnavailableError);
  assert.strictEqual(calls.revoke, 0);
  assert.strictEqual(calls.generate, 0);
});
await okAsync("exported NOT_CONFIGURED_DELIVERY also fails closed", async () => {
  const base = makeDeps();
  await assert.rejects(() => initiateAdminPasswordReset(call(), { ...base.deps, delivery: NOT_CONFIGURED_DELIVERY }), (e) => e instanceof DeliveryUnavailableError);
  assert.strictEqual(base.calls.generate, 0);
  assert.strictEqual(base.calls.revoke, 0);
});

// -- #2 email flows through the delivery seam; #5 neutral output -------------
await reset(); await seedRoles();
await okAsync("routine + confirmed delivery: order gen->deliver->revoke; email passed to delivery; neutral output", async () => {
  const { deps, calls, order, received } = makeDeps({ delivered: true });
  const outcome = await initiateAdminPasswordReset(call({ mode: "routine" }), deps);
  assert.deepStrictEqual(outcome, { status: "accepted" });
  assert.deepStrictEqual(order, ["generate", "deliver", "revoke"]);
  assert.deepStrictEqual(calls, { generate: 1, deliver: 1, revoke: 1 });
  assert.strictEqual(received.email, TEST_EMAIL, "delivery seam must receive the server-resolved email");
  assert.strictEqual(received.link, RESET_LINK);
  const ev = await auditsFor(TARGET);
  const applied = ev.filter((e) => e.outcome === "applied").map((e) => e.action).sort();
  assert.deepStrictEqual(applied, ["deliverAdminPasswordReset", "initiateAdminPasswordReset", "revokeUserSessions"]);
  assertNoSecrets(outcome);       // caller output carries no email/link/token
  assertNoSecrets(ev);            // audit carries no email/link/token
});

// -- routine delivery not confirmed -> no revoke ----------------------------
await reset(); await seedRoles();
await okAsync("routine + delivery returns false: no revoke; neutral accepted; audits record skipped", async () => {
  const { deps, calls } = makeDeps({ delivered: false });
  const outcome = await initiateAdminPasswordReset(call({ mode: "routine" }), deps);
  assert.deepStrictEqual(outcome, { status: "accepted" });
  assert.strictEqual(calls.revoke, 0);
  const ev = await auditsFor(TARGET);
  assert.ok(ev.some((e) => e.action === "deliverAdminPasswordReset" && e.outcome === "denied"));
  assert.ok(ev.some((e) => e.action === "revokeUserSessions" && e.outcome === "denied"));
});

// -- suspected compromise ordering ------------------------------------------
await reset(); await seedRoles();
await okAsync("compromise: order gen->revoke->deliver; revoke applied + deliver applied", async () => {
  const { deps, order } = makeDeps({ delivered: true });
  const outcome = await initiateAdminPasswordReset(call({ mode: "suspectedCompromise" }), deps);
  assert.deepStrictEqual(outcome, { status: "accepted" });
  assert.deepStrictEqual(order, ["generate", "revoke", "deliver"]);
  const ev = await auditsFor(TARGET);
  assert.ok(ev.some((e) => e.action === "revokeUserSessions" && e.outcome === "applied"));
  assert.ok(ev.some((e) => e.action === "deliverAdminPasswordReset" && e.outcome === "applied"));
});

// -- #3 failure-path audits --------------------------------------------------
await reset(); await seedRoles();
await okAsync("generation failure: throws, delivery+revocation audited denied, revoke never called", async () => {
  const { deps, calls } = makeDeps({ generateThrows: true });
  await assert.rejects(() => initiateAdminPasswordReset(call({ mode: "routine" }), deps), (e) => e instanceof AdminResetStageError);
  assert.strictEqual(calls.revoke, 0);
  const ev = await auditsFor(TARGET);
  assert.ok(ev.some((e) => e.action === "deliverAdminPasswordReset" && e.outcome === "denied"));
  assert.ok(ev.some((e) => e.action === "revokeUserSessions" && e.outcome === "denied"));
});
await reset(); await seedRoles();
await okAsync("delivery THROW (routine): throws, delivery denied + revocation skipped, revoke never called", async () => {
  const { deps, calls } = makeDeps({ deliverThrows: true });
  await assert.rejects(() => initiateAdminPasswordReset(call({ mode: "routine" }), deps), (e) => e instanceof AdminResetStageError);
  assert.strictEqual(calls.revoke, 0);
  const ev = await auditsFor(TARGET);
  assert.ok(ev.some((e) => e.action === "deliverAdminPasswordReset" && e.outcome === "denied"));
  assert.ok(ev.some((e) => e.action === "revokeUserSessions" && e.outcome === "denied"));
});
await reset(); await seedRoles();
await okAsync("revocation failure (routine, delivered): throws, revocation audited denied", async () => {
  const { deps, calls } = makeDeps({ delivered: true, revokeThrows: true });
  await assert.rejects(() => initiateAdminPasswordReset(call({ mode: "routine" }), deps), (e) => e instanceof AdminResetStageError);
  assert.strictEqual(calls.revoke, 1);
  const ev = await auditsFor(TARGET);
  assert.ok(ev.some((e) => e.action === "deliverAdminPasswordReset" && e.outcome === "applied"));
  assert.ok(ev.some((e) => e.action === "revokeUserSessions" && e.outcome === "denied"));
});

// -- #5 neutral output for target ineligibility -----------------------------
await reset(); await seedRoles();
await okAsync("no recoverable email: NEUTRAL accepted (not an error); reason only in audit; no side effects", async () => {
  const { deps, calls } = makeDeps({ email: null });
  const outcome = await initiateAdminPasswordReset(call({ mode: "routine" }), deps);
  assert.deepStrictEqual(outcome, { status: "accepted" });
  assert.strictEqual(calls.generate, 0);
  assert.strictEqual(calls.revoke, 0);
  const ev = await auditsFor(TARGET);
  assert.ok(ev.some((e) => e.action === "deliverAdminPasswordReset" && e.outcome === "denied"));
  assertNoSecrets(outcome);
});

// -- #4 idempotency + concurrency -------------------------------------------
await reset(); await seedRoles();
await okAsync("idempotency replay: same key returns accepted with NO new side effects", async () => {
  const { deps, calls } = makeDeps({ delivered: true });
  const key = "replay-key-abcdef123";
  const first = await initiateAdminPasswordReset(call({ idempotencyKey: key }), deps);
  const snapshot = { ...calls };
  const second = await initiateAdminPasswordReset(call({ idempotencyKey: key }), deps);
  assert.deepStrictEqual(first, { status: "accepted" });
  assert.deepStrictEqual(second, { status: "accepted" });
  assert.deepStrictEqual(calls, snapshot, "replay must not repeat generation/delivery/revocation");
});
await reset(); await seedRoles();
await okAsync("a fresh pending op deterministically rejects a duplicate call (in-progress), no side effects", async () => {
  const key = "pending-key-abcdef123";
  await db.collection("admin_credential_reset_ops").doc(key).set({ status: "pending", attempt: 1, createdAtMs: Date.now(), updatedAtMs: Date.now() });
  const { deps, calls } = makeDeps({ delivered: true });
  await assert.rejects(() => initiateAdminPasswordReset(call({ idempotencyKey: key }), deps), (e) => e instanceof OperationInProgressError);
  assert.strictEqual(calls.generate, 0);
  assert.strictEqual(calls.deliver, 0);
  assert.strictEqual(calls.revoke, 0);
});
await reset(); await seedRoles();
await okAsync("concurrency: two calls with the same key never duplicate generation/delivery/revocation", async () => {
  const { deps, calls } = makeDeps({ delivered: true });
  const key = "concurrent-key-abcdef123";
  const results = await Promise.allSettled([
    initiateAdminPasswordReset(call({ idempotencyKey: key }), deps),
    initiateAdminPasswordReset(call({ idempotencyKey: key }), deps),
  ]);
  // Timing decides whether the loser is rejected in-progress or replays the
  // completed op; EITHER is correct. The invariant is exactly-once side effects.
  assert.ok(results.some((r) => r.status === "fulfilled"), "at least one call proceeds");
  for (const r of results) {
    if (r.status === "rejected") assert.ok(r.reason instanceof OperationInProgressError, "any rejection is in-progress only");
  }
  assert.strictEqual(calls.generate, 1, "link generated exactly once");
  assert.strictEqual(calls.deliver, 1, "delivered exactly once");
  assert.strictEqual(calls.revoke, 1, "revoked exactly once");
});

// -- listResetEligibleUsers --------------------------------------------------
await reset(); await seedRoles();
await okAsync("listResetEligibleUsers (admin) returns sanitized rows only", async () => {
  const rows = await listResetEligibleUsers({ actorUid: ADMIN, limit: 50 });
  const target = rows.find((r) => r.uid === TARGET);
  assert.deepStrictEqual(Object.keys(target).sort(), ["displayName", "hasEmployeeLink", "role", "uid"]);
  const blob = JSON.stringify(rows).toLowerCase();
  for (const forbidden of ["email", "password", "claims", "token", "@"]) {
    assert.ok(!blob.includes(forbidden), `list output must not contain "${forbidden}"`);
  }
});
await expectThrows("listResetEligibleUsers denies a non-admin", UnauthorizedActorError, () =>
  listResetEligibleUsers({ actorUid: DISP }));

console.log(`\n${passed} passed`);
process.exit(0);
