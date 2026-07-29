// AUTH-PR-3.5 -- admin-initiated password reset command tests (native send,
// routine-only, guard-enforcing; DECISIONS #56). Firestore-emulator convention
// (firebase-admin against a live emulator; no test runner). The Admin-SDK deps
// (target-facts resolver + native send seam) are INJECTED fakes so the test
// proves: authorization, self-target refusal, fail-closed send capability,
// routine-only mode, every eligibility guard (disabled / break-glass /
// missing-or-nonreciprocal link / final-active-admin / no-email / no-auth),
// truthful REQUEST_ACCEPTED-only semantics (no "delivered", no revocation),
// idempotency (replay + key-tuple binding), per-stage failure auditing, and
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
  evaluateTargetEligibility,
  evaluateActorAuthorization,
  NOT_CONFIGURED_NATIVE_SEND,
  UnauthorizedActorError,
  ProtectedAccountError,
  InvalidInputError,
  DeliveryUnavailableError,
  OperationInProgressError,
  OperationKeyConflictError,
  MalformedOperationError,
  AdminResetStageError,
} from "../lib/access/adminCredentialCommands.js";

admin.initializeApp({ projectId: "demo-authpr35" });
const db = getFirestore();
const OPS = "admin_credential_reset_ops";
const USERS = "users";
const AUDIT = "auditEvents";

const ADMIN = "admin-actor";
const TECH = "tech-actor";
const TARGET = "target-user";

const ELIGIBLE_FACTS = Object.freeze({
  authExists: true,
  disabled: false,
  email: "target@example.com",
  hasEmployeeLink: true,
  employeeLinkReciprocal: true,
  isBreakGlass: false,
  isFinalActiveAdmin: false,
});
const facts = (over = {}) => ({ ...ELIGIBLE_FACTS, ...over });

// PRE-2: default authorized actor facts (governed admin, active/non-disabled
// account, reciprocal Employee<->Auth link). Each denial case overrides one fact.
const AUTHORIZED_ACTOR = Object.freeze({
  authExists: true,
  disabled: false,
  isAdmin: true,
  hasEmployeeLink: true,
  employeeLinkReciprocal: true,
});
const actorFacts = (over = {}) => ({ ...AUTHORIZED_ACTOR, ...over });

let counter = 0;
function freshKey(prefix = "aprkey") {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}.${counter}0000`;
}

function makeDeps({ target = facts(), actor = actorFacts(), configured = true, send } = {}) {
  const sends = [];
  const nativeSend = {
    isConfigured: () => configured,
    sendReset: async (args) => {
      sends.push(args);
      if (typeof send === "function") return send(args);
      return { accepted: true };
    },
  };
  const resolveTargetFacts = async () => {
    if (target === "throw") throw new Error("facts lookup boom");
    return target;
  };
  const resolveActorFacts = async () => {
    if (actor === "throw") throw new Error("actor facts lookup boom");
    return actor;
  };
  return { deps: { resolveActorFacts, resolveTargetFacts, nativeSend }, sends };
}

async function seedUser(uid, role) {
  await db.collection(USERS).doc(uid).set({ role, displayName: uid });
}
async function opDoc(key) {
  const s = await db.collection(OPS).doc(key).get();
  return s.exists ? s.data() : null;
}
async function auditCount(targetId, outcome) {
  const s = await db.collection(AUDIT).where("targetId", "==", targetId).get();
  return s.docs.filter((d) => (outcome ? d.data().outcome === outcome : true)).length;
}

let passed = 0;
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }
async function expectThrows(name, ErrType, fn) {
  await okAsync(name, async () => {
    await assert.rejects(fn, (e) => e instanceof ErrType, `expected ${ErrType.name}`);
  });
}

async function main() {
  await seedUser(ADMIN, "admin");
  await seedUser(TECH, "technician");

  // -- input validation ------------------------------------------------------
  await expectThrows("blank targetUid -> InvalidInputError", InvalidInputError, () =>
    initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: "", idempotencyKey: freshKey() }, makeDeps().deps),
  );
  await expectThrows("bad idempotency key -> InvalidInputError", InvalidInputError, () =>
    initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: "short" }, makeDeps().deps),
  );
  await expectThrows("suspectedCompromise mode -> InvalidInputError (separate action)", InvalidInputError, () =>
    initiateAdminPasswordReset(
      { actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey(), mode: "suspectedCompromise" },
      makeDeps().deps,
    ),
  );

  // -- actor authorization (PRE-2): fail closed unless active linked admin ----
  await expectThrows("blank actorUid -> InvalidInputError (unauthenticated boundary)", InvalidInputError, () =>
    initiateAdminPasswordReset({ actorUid: "", targetUid: TARGET, idempotencyKey: freshKey() }, makeDeps().deps),
  );
  await expectThrows("non-admin actor -> UnauthorizedActorError", UnauthorizedActorError, () =>
    initiateAdminPasswordReset(
      { actorUid: TECH, targetUid: TARGET, idempotencyKey: freshKey() },
      makeDeps({ actor: actorFacts({ isAdmin: false }) }).deps,
    ),
  );
  await expectThrows("inactive/disabled admin actor -> UnauthorizedActorError", UnauthorizedActorError, () =>
    initiateAdminPasswordReset(
      { actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey() },
      makeDeps({ actor: actorFacts({ disabled: true }) }).deps,
    ),
  );
  await expectThrows("actor with no Auth account -> UnauthorizedActorError", UnauthorizedActorError, () =>
    initiateAdminPasswordReset(
      { actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey() },
      makeDeps({ actor: actorFacts({ authExists: false }) }).deps,
    ),
  );
  await expectThrows("actor missing employee link -> UnauthorizedActorError", UnauthorizedActorError, () =>
    initiateAdminPasswordReset(
      { actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey() },
      makeDeps({ actor: actorFacts({ hasEmployeeLink: false }) }).deps,
    ),
  );
  await expectThrows("actor non-reciprocal (malformed) link -> UnauthorizedActorError", UnauthorizedActorError, () =>
    initiateAdminPasswordReset(
      { actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey() },
      makeDeps({ actor: actorFacts({ employeeLinkReciprocal: false }) }).deps,
    ),
  );
  await expectThrows("actor-facts lookup throws -> UnauthorizedActorError (fail closed)", UnauthorizedActorError, () =>
    initiateAdminPasswordReset(
      { actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey() },
      makeDeps({ actor: "throw" }).deps,
    ),
  );
  await okAsync("active linked admin actor is authorized (reaches send)", async () => {
    const key = freshKey();
    const { deps, sends } = makeDeps();
    const out = await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, deps);
    assert.deepStrictEqual(out, { status: "accepted" });
    assert.strictEqual(sends.length, 1, "authorized actor + eligible target sends once");
  });
  await expectThrows("self-target -> ProtectedAccountError", ProtectedAccountError, () =>
    initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: ADMIN, idempotencyKey: freshKey() }, makeDeps().deps),
  );

  // -- fail-closed send capability ------------------------------------------
  await okAsync("unconfigured native send -> DeliveryUnavailableError, ZERO sends", async () => {
    const { deps, sends } = makeDeps({ configured: false });
    await assert.rejects(
      initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey() }, deps),
      (e) => e instanceof DeliveryUnavailableError,
    );
    assert.strictEqual(sends.length, 0);
  });
  await okAsync("NOT_CONFIGURED_NATIVE_SEND is fail-closed", async () => {
    assert.strictEqual(NOT_CONFIGURED_NATIVE_SEND.isConfigured(), false);
    assert.deepStrictEqual(
      await NOT_CONFIGURED_NATIVE_SEND.sendReset({ targetUid: "x", email: "y", idempotencyKey: "z" }),
      { accepted: false },
    );
  });

  // -- eligible send: accepted ----------------------------------------------
  await okAsync("eligible + accepted -> neutral accepted, ONE send, op completed", async () => {
    const key = freshKey();
    const { deps, sends } = makeDeps();
    const out = await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, deps);
    assert.deepStrictEqual(out, { status: "accepted" });
    assert.strictEqual(sends.length, 1);
    assert.deepStrictEqual(sends[0], { targetUid: TARGET, email: "target@example.com", idempotencyKey: key });
    const op = await opDoc(key);
    assert.strictEqual(op.status, "completed");
    assert.strictEqual(op.stages.send, "sent");
    assert.ok((await auditCount(TARGET, "applied")) >= 2); // initiation + send
  });

  // -- idempotent replay -----------------------------------------------------
  await okAsync("replay with same key -> neutral, NO second send", async () => {
    const key = freshKey();
    const first = makeDeps();
    await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, first.deps);
    const second = makeDeps();
    const out = await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, second.deps);
    assert.deepStrictEqual(out, { status: "accepted" });
    assert.strictEqual(second.sends.length, 0, "completed op must not send again");
  });

  // -- key-tuple binding -----------------------------------------------------
  await expectThrows("same key, different target -> OperationKeyConflictError", OperationKeyConflictError, async () => {
    const key = freshKey();
    await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, makeDeps().deps);
    await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: "other-target", idempotencyKey: key }, makeDeps().deps);
  });

  // -- neutral-ineligible guards: NO send, NO op record ----------------------
  for (const [label, over] of [
    ["disabled target", { disabled: true }],
    ["break-glass target", { isBreakGlass: true }],
    ["missing employee link", { hasEmployeeLink: false }],
    ["non-reciprocal link", { employeeLinkReciprocal: false }],
    ["no recoverable email", { email: null }],
    ["no auth account", { authExists: false }],
  ]) {
    await okAsync(`${label} -> neutral accepted, NO send, NO op record`, async () => {
      const key = freshKey();
      const { deps, sends } = makeDeps({ target: facts(over) });
      const out = await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, deps);
      assert.deepStrictEqual(out, { status: "accepted" });
      assert.strictEqual(sends.length, 0, "ineligible target must not send");
      assert.strictEqual(await opDoc(key), null, "ineligible target must not claim an op record");
    });
  }

  // -- protected final admin -------------------------------------------------
  await okAsync("final-active-admin -> ProtectedAccountError, NO send", async () => {
    const { deps, sends } = makeDeps({ target: facts({ isFinalActiveAdmin: true }) });
    await assert.rejects(
      initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey() }, deps),
      (e) => e instanceof ProtectedAccountError,
    );
    assert.strictEqual(sends.length, 0);
  });

  // -- facts lookup error ----------------------------------------------------
  await expectThrows("resolveTargetFacts throws -> AdminResetStageError", AdminResetStageError, () =>
    initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: freshKey() }, makeDeps({ target: "throw" }).deps),
  );

  // -- send not accepted -> retryable failed --------------------------------
  await okAsync("send not accepted -> neutral, op status failed (retryable)", async () => {
    const key = freshKey();
    const { deps } = makeDeps({ send: () => ({ accepted: false }) });
    const out = await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, deps);
    assert.deepStrictEqual(out, { status: "accepted" });
    const op = await opDoc(key);
    assert.strictEqual(op.status, "failed");
    assert.strictEqual(op.stages.send, undefined, "an unaccepted send is not persisted");
  });

  // -- send throws -> AdminResetStageError, failed --------------------------
  await okAsync("send throws -> AdminResetStageError, op failed", async () => {
    const key = freshKey();
    const { deps } = makeDeps({ send: () => { throw new Error("smtp-ish boom"); } });
    await assert.rejects(
      initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, deps),
      (e) => e instanceof AdminResetStageError,
    );
    const op = await opDoc(key);
    assert.strictEqual(op.status, "failed");
  });

  // -- in-progress lock ------------------------------------------------------
  await expectThrows("fresh in_progress op -> OperationInProgressError", OperationInProgressError, async () => {
    const key = freshKey();
    await db.collection(OPS).doc(key).set({
      actorUid: ADMIN, targetUid: TARGET, mode: "routine", status: "in_progress",
      attempt: 1, stages: {}, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, makeDeps().deps);
  });

  // -- malformed op record ---------------------------------------------------
  await expectThrows("malformed op record -> MalformedOperationError", MalformedOperationError, async () => {
    const key = freshKey();
    await db.collection(OPS).doc(key).set({ actorUid: ADMIN, targetUid: TARGET, mode: "routine", status: "weird", attempt: 0 });
    await initiateAdminPasswordReset({ actorUid: ADMIN, targetUid: TARGET, idempotencyKey: key }, makeDeps().deps);
  });

  // -- pure evaluator sanity (also covered by adminCredentialEligibility) ----
  await okAsync("evaluateTargetEligibility is exported and pure", async () => {
    assert.strictEqual(evaluateTargetEligibility(facts(), "a", "b").disposition, "eligible");
    assert.strictEqual(evaluateTargetEligibility(facts(), "a", "a").category, "self-target");
  });
  await okAsync("evaluateActorAuthorization is exported and pure", async () => {
    assert.strictEqual(evaluateActorAuthorization(actorFacts()).authorized, true);
    assert.strictEqual(evaluateActorAuthorization(actorFacts({ disabled: true })).category, "disabled-actor");
    assert.strictEqual(evaluateActorAuthorization(actorFacts({ isAdmin: false })).category, "not-admin");
  });

  // -- listResetEligibleUsers authorization (same PRE-2 actor gate) ----------
  await expectThrows("list: non-admin -> UnauthorizedActorError", UnauthorizedActorError, () =>
    listResetEligibleUsers({ actorUid: TECH }, makeDeps({ actor: actorFacts({ isAdmin: false }) }).deps),
  );
  await expectThrows("list: disabled admin -> UnauthorizedActorError", UnauthorizedActorError, () =>
    listResetEligibleUsers({ actorUid: ADMIN }, makeDeps({ actor: actorFacts({ disabled: true }) }).deps),
  );
  await okAsync("list: active linked admin gets sanitized rows", async () => {
    const rows = await listResetEligibleUsers({ actorUid: ADMIN, limit: 10 }, makeDeps().deps);
    assert.ok(Array.isArray(rows));
    for (const r of rows) {
      assert.ok(!("email" in r) && !("password" in r));
      assert.ok("uid" in r && "hasEmployeeLink" in r);
    }
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
