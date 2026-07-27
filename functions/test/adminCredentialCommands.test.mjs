// AUTH-PR-3 -- admin-initiated password reset command tests (Codex rounds 2-3
// hardened). Firestore-emulator convention (firebase-admin against a live
// emulator; no test runner). Admin-SDK deps are INJECTED fakes so the test
// proves authorization, fail-closed delivery capability, email+key through the
// delivery seam, per-stage failure auditing on every terminal path, idempotency
// key-tuple binding, resumable crash windows, the recovery-required state, and
// neutral output -- no Auth emulator or real send/revocation required.
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
  OperationKeyConflictError,
  MalformedOperationError,
  AdminResetStageError,
} from "../lib/access/adminCredentialCommands.js";

admin.initializeApp({ projectId: "demo-authpr3" });
const db = getFirestore();
const OPS = "admin_credential_reset_ops";

const TEST_EMAIL = "target@example.com";
const SECRET_TOKEN = "SUPERSECRETTOKEN";
const RESET_LINK = `https://emu/reset?oobCode=${SECRET_TOKEN}`;

let passed = 0;
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }
async function expectThrows(name, ErrType, fn) {
  await okAsync(name, async () => { await assert.rejects(fn, (e) => e instanceof ErrType, `expected ${ErrType.name}`); });
}
async function clearCollection(name) {
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
async function reset() { await clearCollection("users"); await clearCollection("auditEvents"); await clearCollection(OPS); }
async function setUser(uid, data) { await db.collection("users").doc(uid).set(data); }
async function auditsFor(targetId) {
  const snap = await db.collection("auditEvents").where("targetId", "==", targetId).get();
  return snap.docs.map((d) => d.data());
}
async function opDoc(key) { return (await db.collection(OPS).doc(key).get()).data(); }
async function seedOp(key, data) { await db.collection(OPS).doc(key).set(data); }
const STALE = () => Date.now() - 6 * 60 * 1000;
function hasEvent(ev, action, outcome) { return ev.some((e) => e.action === action && e.outcome === outcome); }
function assertNoSecrets(blob) {
  const s = JSON.stringify(blob);
  assert.ok(!s.includes(TEST_EMAIL), "must not contain the target email");
  assert.ok(!s.includes(SECRET_TOKEN), "must not contain the reset token");
  assert.ok(!s.toLowerCase().includes("oobcode"), "must not contain the reset link");
}

function makeDeps(opts = {}) {
  const { configured = true, delivered = true, email = TEST_EMAIL, generateThrows = false, deliverThrows = false, revokeThrows = false } = opts;
  const order = [];
  const calls = { generate: 0, deliver: 0, revoke: 0 };
  const received = { email: null, link: null, idempotencyKey: null };
  const deps = {
    generateResetLink: async () => { calls.generate += 1; order.push("generate"); if (generateThrows) throw new Error("gen boom"); return RESET_LINK; },
    revokeRefreshTokens: async () => { calls.revoke += 1; order.push("revoke"); if (revokeThrows) throw new Error("revoke boom"); },
    getRecoverableEmail: async () => { if (email === "THROW") throw new Error("lookup boom"); return email; },
    delivery: {
      isConfigured: () => configured,
      deliverResetLink: async ({ email: e, link, idempotencyKey }) => { calls.deliver += 1; order.push("deliver"); received.email = e; received.link = link; received.idempotencyKey = idempotencyKey; if (deliverThrows) throw new Error("deliver boom"); return { delivered }; },
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
let seq = 0;
const freshKey = () => `key-${Date.now()}-${seq++}-abcdef`;
const call = (over) => ({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey(), ...over });

// -- authorization ----------------------------------------------------------
await reset(); await seedRoles();
await expectThrows("non-admin actor denied", UnauthorizedActorError, () => initiateAdminPasswordReset(call({ actorUid: TARGET, targetUid: "admin-uid-2" }), makeDeps().deps));
await okAsync("denied authorization writes a denied audit", async () => assert.ok(hasEvent(await auditsFor("admin-uid-2"), "initiateAdminPasswordReset", "denied")));
await expectThrows("dispatcher actor denied", UnauthorizedActorError, () => initiateAdminPasswordReset(call({ actorUid: DISP }), makeDeps().deps));

// -- input + protected account ----------------------------------------------
await reset(); await seedRoles();
await expectThrows("self-reset rejected", ProtectedAccountError, () => initiateAdminPasswordReset(call({ targetUid: ADMIN }), makeDeps().deps));
await expectThrows("invalid idempotencyKey rejected", InvalidInputError, () => initiateAdminPasswordReset(call({ idempotencyKey: "short" }), makeDeps().deps));

// -- #1(prev) fail closed on unconfigured delivery --------------------------
await reset(); await seedRoles();
await okAsync("unconfigured COMPROMISE fails closed: zero revoke + zero generation", async () => {
  const { deps, calls } = makeDeps({ configured: false });
  await assert.rejects(() => initiateAdminPasswordReset(call({ mode: "suspectedCompromise" }), deps), (e) => e instanceof DeliveryUnavailableError);
  assert.deepStrictEqual(calls, { generate: 0, deliver: 0, revoke: 0 });
});
await okAsync("unconfigured ROUTINE fails closed", async () => {
  const { deps, calls } = makeDeps({ configured: false });
  await assert.rejects(() => initiateAdminPasswordReset(call(), deps), (e) => e instanceof DeliveryUnavailableError);
  assert.deepStrictEqual(calls, { generate: 0, deliver: 0, revoke: 0 });
});
await okAsync("exported NOT_CONFIGURED_DELIVERY fails closed", async () => {
  const base = makeDeps();
  await assert.rejects(() => initiateAdminPasswordReset(call(), { ...base.deps, delivery: NOT_CONFIGURED_DELIVERY }), (e) => e instanceof DeliveryUnavailableError);
  assert.strictEqual(base.calls.generate, 0);
});

// -- routine happy path: ordering, email+key through seam, neutral, no secrets
await reset(); await seedRoles();
await okAsync("routine confirmed: order gen->deliver->revoke; email+key passed; neutral; 3 applied; no secrets", async () => {
  const { deps, calls, order, received } = makeDeps({ delivered: true });
  const c = call({ mode: "routine" });
  const outcome = await initiateAdminPasswordReset(c, deps);
  assert.deepStrictEqual(outcome, { status: "accepted" });
  assert.deepStrictEqual(order, ["generate", "deliver", "revoke"]);
  assert.deepStrictEqual(calls, { generate: 1, deliver: 1, revoke: 1 });
  assert.strictEqual(received.email, TEST_EMAIL);
  assert.strictEqual(received.idempotencyKey, c.idempotencyKey); // key passed to provider for dedup
  const ev = await auditsFor(TARGET);
  assert.deepStrictEqual(ev.filter((e) => e.outcome === "applied").map((e) => e.action).sort(), ["deliverAdminPasswordReset", "initiateAdminPasswordReset", "revokeUserSessions"]);
  assertNoSecrets(outcome); assertNoSecrets(ev);
  assert.strictEqual((await opDoc(c.idempotencyKey)).status, "completed");
});

await reset(); await seedRoles();
await okAsync("routine delivery false: no revoke; neutral; skipped audits", async () => {
  const { deps, calls } = makeDeps({ delivered: false });
  await initiateAdminPasswordReset(call(), deps);
  assert.strictEqual(calls.revoke, 0);
  const ev = await auditsFor(TARGET);
  assert.ok(hasEvent(ev, "deliverAdminPasswordReset", "denied") && hasEvent(ev, "revokeUserSessions", "denied"));
});

await reset(); await seedRoles();
await okAsync("compromise: order revoke->generate->deliver; revoke applied + deliver applied", async () => {
  const { deps, order } = makeDeps({ delivered: true });
  const c = call({ mode: "suspectedCompromise" });
  await initiateAdminPasswordReset(c, deps);
  assert.deepStrictEqual(order, ["revoke", "generate", "deliver"]);
  const ev = await auditsFor(TARGET);
  assert.ok(hasEvent(ev, "revokeUserSessions", "applied") && hasEvent(ev, "deliverAdminPasswordReset", "applied"));
  assert.strictEqual((await opDoc(c.idempotencyKey)).status, "completed");
});

// -- failure-path audits (all three outcomes on every terminal path) --------
await reset(); await seedRoles();
await okAsync("generation failure: throws; deliver denied + revoke skipped; revoke never called", async () => {
  const { deps, calls } = makeDeps({ generateThrows: true });
  await assert.rejects(() => initiateAdminPasswordReset(call(), deps), (e) => e instanceof AdminResetStageError);
  assert.strictEqual(calls.revoke, 0);
  const ev = await auditsFor(TARGET);
  assert.ok(hasEvent(ev, "deliverAdminPasswordReset", "denied") && hasEvent(ev, "revokeUserSessions", "denied") && hasEvent(ev, "initiateAdminPasswordReset", "applied"));
});
await reset(); await seedRoles();
await okAsync("delivery THROW (routine): throws; deliver denied + revoke skipped; revoke never called", async () => {
  const { deps, calls } = makeDeps({ deliverThrows: true });
  await assert.rejects(() => initiateAdminPasswordReset(call(), deps), (e) => e instanceof AdminResetStageError);
  assert.strictEqual(calls.revoke, 0);
  const ev = await auditsFor(TARGET);
  assert.ok(hasEvent(ev, "deliverAdminPasswordReset", "denied") && hasEvent(ev, "revokeUserSessions", "denied"));
});
await reset(); await seedRoles();
await okAsync("routine revocation failure: throws; deliver applied + revoke denied", async () => {
  const { deps, calls } = makeDeps({ delivered: true, revokeThrows: true });
  await assert.rejects(() => initiateAdminPasswordReset(call(), deps), (e) => e instanceof AdminResetStageError);
  assert.strictEqual(calls.revoke, 1);
  const ev = await auditsFor(TARGET);
  assert.ok(hasEvent(ev, "deliverAdminPasswordReset", "applied") && hasEvent(ev, "revokeUserSessions", "denied"));
});

// -- #3 identity-lookup failure: complete audit outcomes --------------------
await reset(); await seedRoles();
await okAsync("identity-lookup THROW: throws; delivery denied + revocation skipped audited; op failed", async () => {
  const { deps, calls } = makeDeps({ email: "THROW" });
  await assert.rejects(() => initiateAdminPasswordReset(call(), deps), (e) => e instanceof AdminResetStageError);
  assert.deepStrictEqual(calls, { generate: 0, deliver: 0, revoke: 0 });
  const ev = await auditsFor(TARGET);
  assert.ok(hasEvent(ev, "deliverAdminPasswordReset", "denied") && hasEvent(ev, "revokeUserSessions", "denied"));
});

// -- #5(prev) no email: neutral accepted -------------------------------------
await reset(); await seedRoles();
await okAsync("no recoverable email: neutral accepted; reason only in audit; no side effects", async () => {
  const { deps, calls } = makeDeps({ email: null });
  assert.deepStrictEqual(await initiateAdminPasswordReset(call(), deps), { status: "accepted" });
  assert.deepStrictEqual(calls, { generate: 0, deliver: 0, revoke: 0 });
  assert.ok(hasEvent(await auditsFor(TARGET), "deliverAdminPasswordReset", "denied"));
});

// -- #4 compromise revocation failure: all three outcomes -------------------
await reset(); await seedRoles();
await okAsync("compromise revocation failure: revoke denied + delivery skipped(denied); op failed", async () => {
  const { deps, calls } = makeDeps({ revokeThrows: true });
  const c = call({ mode: "suspectedCompromise" });
  await assert.rejects(() => initiateAdminPasswordReset(c, deps), (e) => e instanceof AdminResetStageError);
  assert.strictEqual(calls.deliver, 0, "delivery must not run after failed revoke");
  const ev = await auditsFor(TARGET);
  assert.ok(hasEvent(ev, "revokeUserSessions", "denied"), "revocation audited denied");
  assert.ok(hasEvent(ev, "deliverAdminPasswordReset", "denied"), "delivery audited skipped/denied");
  assert.ok(hasEvent(ev, "initiateAdminPasswordReset", "applied"));
  assert.strictEqual((await opDoc(c.idempotencyKey)).status, "failed");
});

// -- #5 compromise delivery failure AFTER revoke -> RECOVERY REQUIRED --------
await reset(); await seedRoles();
await okAsync("compromise delivery FALSE after revoke: recovery_required (not completed); neutral", async () => {
  const { deps } = makeDeps({ delivered: false });
  const c = call({ mode: "suspectedCompromise" });
  const outcome = await initiateAdminPasswordReset(c, deps);
  assert.deepStrictEqual(outcome, { status: "accepted" }); // neutral output
  const op = await opDoc(c.idempotencyKey);
  assert.strictEqual(op.status, "recovery_required", "must NOT be silently completed");
  assert.notStrictEqual(op.status, "completed");
  const ev = await auditsFor(TARGET);
  assert.ok(hasEvent(ev, "revokeUserSessions", "applied") && hasEvent(ev, "deliverAdminPasswordReset", "denied"));
});
await reset(); await seedRoles();
await okAsync("compromise delivery THROW after revoke: recovery_required; neutral", async () => {
  const { deps } = makeDeps({ deliverThrows: true });
  const c = call({ mode: "suspectedCompromise" });
  assert.deepStrictEqual(await initiateAdminPasswordReset(c, deps), { status: "accepted" });
  assert.strictEqual((await opDoc(c.idempotencyKey)).status, "recovery_required");
});

// -- #1 idempotency key-tuple binding ---------------------------------------
await reset(); await seedRoles();
await okAsync("key bound to (actor,target,mode): cross-actor/target/mode collisions rejected", async () => {
  const key = "bound-key-abcdef123";
  await seedOp(key, { actorUid: ADMIN, targetUid: TARGET, mode: "routine", status: "completed", attempt: 1, stages: { deliver: "delivered", revoke: "done" }, createdAtMs: Date.now(), updatedAtMs: Date.now() });
  await assert.rejects(() => initiateAdminPasswordReset({ actorUid: "admin-uid-2", targetUid: TARGET, mode: "routine", idempotencyKey: key }, makeDeps().deps), (e) => e instanceof OperationKeyConflictError);
  await assert.rejects(() => initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: "admin-uid-2", mode: "routine", idempotencyKey: key }, makeDeps().deps), (e) => e instanceof OperationKeyConflictError);
  await assert.rejects(() => initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, mode: "suspectedCompromise", idempotencyKey: key }, makeDeps().deps), (e) => e instanceof OperationKeyConflictError);
});
await reset(); await seedRoles();
await okAsync("malformed existing op record fails closed", async () => {
  const key = "malformed-key-abcdef123";
  await seedOp(key, { status: "in_progress", garbage: true });
  await assert.rejects(() => initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, mode: "routine", idempotencyKey: key }, makeDeps().deps), (e) => e instanceof MalformedOperationError);
});

// -- #2 idempotency replay + concurrency + crash-window resume ---------------
await reset(); await seedRoles();
await okAsync("replay: completed op returns neutral with NO new side effects", async () => {
  const { deps, calls } = makeDeps({ delivered: true });
  const key = "replay-key-abcdef123";
  await initiateAdminPasswordReset(call({ idempotencyKey: key }), deps);
  const snapshot = { ...calls };
  await initiateAdminPasswordReset(call({ idempotencyKey: key }), deps);
  assert.deepStrictEqual(calls, snapshot);
});
await reset(); await seedRoles();
await okAsync("fresh pending op deterministically rejects a duplicate (in-progress), no side effects", async () => {
  const key = "pending-key-abcdef123";
  await seedOp(key, { actorUid: ADMIN, targetUid: TARGET, mode: "routine", status: "in_progress", attempt: 1, stages: {}, createdAtMs: Date.now(), updatedAtMs: Date.now() });
  const { deps, calls } = makeDeps();
  await assert.rejects(() => initiateAdminPasswordReset(call({ idempotencyKey: key }), deps), (e) => e instanceof OperationInProgressError);
  assert.deepStrictEqual(calls, { generate: 0, deliver: 0, revoke: 0 });
});
await reset(); await seedRoles();
await okAsync("concurrency: two calls same key never duplicate generation/delivery/revocation", async () => {
  const { deps, calls } = makeDeps({ delivered: true });
  const key = "concurrent-key-abcdef123";
  const results = await Promise.allSettled([initiateAdminPasswordReset(call({ idempotencyKey: key }), deps), initiateAdminPasswordReset(call({ idempotencyKey: key }), deps)]);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  for (const r of results) if (r.status === "rejected") assert.ok(r.reason instanceof OperationInProgressError);
  assert.deepStrictEqual(calls, { generate: 1, deliver: 1, revoke: 1 });
});
await reset(); await seedRoles();
await okAsync("crash resume AFTER delivery: skips generate+deliver, performs revoke only, completes", async () => {
  const key = "resume-deliver-abcdef123";
  await seedOp(key, { actorUid: ADMIN, targetUid: TARGET, mode: "routine", status: "in_progress", attempt: 1, stages: { deliver: "delivered" }, createdAtMs: Date.now(), updatedAtMs: STALE() });
  const { deps, calls } = makeDeps({ delivered: true });
  await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, mode: "routine", idempotencyKey: key }, deps);
  assert.deepStrictEqual(calls, { generate: 0, deliver: 0, revoke: 1 });
  assert.strictEqual((await opDoc(key)).status, "completed");
});
await reset(); await seedRoles();
await okAsync("crash resume AFTER revocation (completion persist failed): no side effects, finalizes completed", async () => {
  const key = "resume-complete-abcdef123";
  await seedOp(key, { actorUid: ADMIN, targetUid: TARGET, mode: "routine", status: "in_progress", attempt: 1, stages: { deliver: "delivered", revoke: "done" }, createdAtMs: Date.now(), updatedAtMs: STALE() });
  const { deps, calls } = makeDeps({ delivered: true });
  await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, mode: "routine", idempotencyKey: key }, deps);
  assert.deepStrictEqual(calls, { generate: 0, deliver: 0, revoke: 0 });
  assert.strictEqual((await opDoc(key)).status, "completed");
});

// -- listResetEligibleUsers --------------------------------------------------
await reset(); await seedRoles();
await okAsync("listResetEligibleUsers (admin) returns sanitized rows only", async () => {
  const rows = await listResetEligibleUsers({ actorUid: ADMIN, limit: 50 });
  const target = rows.find((r) => r.uid === TARGET);
  assert.deepStrictEqual(Object.keys(target).sort(), ["displayName", "hasEmployeeLink", "role", "uid"]);
  const blob = JSON.stringify(rows).toLowerCase();
  for (const forbidden of ["email", "password", "claims", "token", "@"]) assert.ok(!blob.includes(forbidden), `no "${forbidden}"`);
});
await expectThrows("listResetEligibleUsers denies a non-admin", UnauthorizedActorError, () => listResetEligibleUsers({ actorUid: DISP }));

console.log(`\n${passed} passed`);
process.exit(0);
