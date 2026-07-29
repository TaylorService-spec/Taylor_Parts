// AUTH PRE-2 -- Auth+Firestore emulator test for the PRODUCTION actor-fact
// adapter. Unlike adminCredentialCommands.test.mjs (which injects precomputed
// ActorAuthorizationFacts), this suite seeds REAL Firebase Auth users +
// users/{uid} + employees/{employeeId} records and exercises the actual deployed
// adapter `resolveActorFacts` from adminCredentialCallables. It proves the
// callable derives the facts correctly: exact employees.userId reciprocity, the
// authoritative employmentStatus === "ACTIVE" gate, and Auth disabled/missing
// handling -- a wiring regression here would NOT be caught by the injected-facts
// suite.
//
// Prerequisite: a live Firestore emulator (8080) AND Auth emulator (9099), then
// (after `npm run build`):
//   node functions/test/adminCredentialActorFacts.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  resolveActorFacts,
  actorAuthorizationDeps,
} from "../lib/access/adminCredentialCallables.js";
import {
  evaluateActorAuthorization,
  initiateAdminPasswordReset,
  listResetEligibleUsers,
  NOT_CONFIGURED_NATIVE_SEND,
  UnauthorizedActorError,
  DeliveryUnavailableError,
} from "../lib/access/adminCredentialCommands.js";

admin.initializeApp({ projectId: "demo-authpr2actor" });
const db = getFirestore();
const auth = getAuth();

let counter = 0;
const uniq = (p) => `${p}_${Date.now().toString(36)}_${(counter += 1)}`;
const freshKey = () => `aprfactkey.${Date.now().toString(36)}.${(counter += 1)}0000`;

// Seed a real actor across Auth + Firestore. Any piece can be omitted to model a
// missing record. `employee` is written verbatim (so alias-only fixtures are exact).
async function seed({ uid, role = "admin", employeeId, disabled = false, createAuth = true, userDoc = true, employee }) {
  if (createAuth) await auth.createUser({ uid, disabled });
  if (userDoc) {
    const doc = { role };
    if (employeeId !== undefined) doc.employeeId = employeeId;
    await db.collection("users").doc(uid).set(doc);
  }
  if (employee !== undefined && employeeId !== undefined) {
    await db.collection("employees").doc(employeeId).set(employee);
  }
}

let passed = 0;
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

async function verdictFor(uid) {
  const facts = await resolveActorFacts(uid);
  return { facts, verdict: evaluateActorAuthorization(facts) };
}

async function main() {
  // -- wiring: both callables share the tested adapter ------------------------
  await okAsync("actorAuthorizationDeps().resolveActorFacts IS the tested adapter", async () => {
    assert.strictEqual(actorAuthorizationDeps().resolveActorFacts, resolveActorFacts);
  });

  // -- exact userId + ACTIVE + enabled admin -> authorized --------------------
  const okUid = uniq("ok-admin");
  await okAsync("exact userId + employmentStatus ACTIVE + enabled admin -> authorized", async () => {
    const emp = `${okUid}-emp`;
    await seed({ uid: okUid, employeeId: emp, employee: { userId: okUid, employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await verdictFor(okUid);
    assert.deepStrictEqual(facts, {
      authExists: true,
      disabled: false,
      isAdmin: true,
      hasEmployeeLink: true,
      employeeLinkReciprocal: true,
      employmentStatus: "ACTIVE",
    });
    assert.deepStrictEqual(verdict, { authorized: true, category: "authorized" });
  });

  // -- disabled Auth account -> denied ---------------------------------------
  await okAsync("disabled Auth account -> disabled-actor (even with ACTIVE reciprocal employee)", async () => {
    const uid = uniq("disabled");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, disabled: true, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await verdictFor(uid);
    assert.strictEqual(facts.disabled, true);
    assert.strictEqual(verdict.category, "disabled-actor");
  });

  // -- non-ACTIVE / malformed / missing employmentStatus -> denied -----------
  for (const [label, status] of [["INACTIVE", "INACTIVE"], ["TERMINATED", "TERMINATED"], ["ON_LEAVE", "ON_LEAVE"]]) {
    await okAsync(`employmentStatus ${label} -> inactive-employment`, async () => {
      const uid = uniq("emp-" + label);
      const emp = `${uid}-emp`;
      await seed({ uid, employeeId: emp, employee: { userId: uid, employmentStatus: status } });
      const { verdict } = await verdictFor(uid);
      assert.strictEqual(verdict.category, "inactive-employment");
    });
  }
  await okAsync("missing employmentStatus -> inactive-employment (null)", async () => {
    const uid = uniq("emp-missing");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, employee: { userId: uid } });
    const { facts, verdict } = await verdictFor(uid);
    assert.strictEqual(facts.employmentStatus, null);
    assert.strictEqual(verdict.category, "inactive-employment");
  });
  await okAsync("malformed (non-string) employmentStatus -> inactive-employment (null)", async () => {
    const uid = uniq("emp-malformed");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, employee: { userId: uid, employmentStatus: 42 } });
    const { facts, verdict } = await verdictFor(uid);
    assert.strictEqual(facts.employmentStatus, null);
    assert.strictEqual(verdict.category, "inactive-employment");
  });

  // -- reciprocal link uses employees.userId ONLY ----------------------------
  await okAsync("mismatched employees.userId -> missing-or-nonreciprocal (employmentStatus not trusted)", async () => {
    const uid = uniq("mismatch");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, employee: { userId: "someone-else", employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await verdictFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, false);
    assert.strictEqual(facts.employmentStatus, null);
    assert.strictEqual(verdict.category, "missing-or-nonreciprocal-employee-link");
  });
  await okAsync("alias-only authUid/uid with MISSING userId -> denied (aliases not honored)", async () => {
    const uid = uniq("alias");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, employee: { authUid: uid, uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await verdictFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, false, "authUid/uid must NOT authorize");
    assert.strictEqual(verdict.category, "missing-or-nonreciprocal-employee-link");
  });
  await okAsync("missing employeeId on user doc -> no link", async () => {
    const uid = uniq("nolink");
    await seed({ uid }); // no employeeId, no employee doc
    const { facts, verdict } = await verdictFor(uid);
    assert.strictEqual(facts.hasEmployeeLink, false);
    assert.strictEqual(verdict.category, "missing-or-nonreciprocal-employee-link");
  });
  await okAsync("employeeId set but employee doc missing -> not reciprocal", async () => {
    const uid = uniq("empmissing");
    await seed({ uid, employeeId: `${uid}-emp` }); // employee doc not written
    const { facts, verdict } = await verdictFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, false);
    assert.strictEqual(verdict.category, "missing-or-nonreciprocal-employee-link");
  });

  // -- non-admin role --------------------------------------------------------
  await okAsync("non-admin role -> not-admin", async () => {
    const uid = uniq("tech");
    const emp = `${uid}-emp`;
    await seed({ uid, role: "technician", employeeId: emp, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { verdict } = await verdictFor(uid);
    assert.strictEqual(verdict.category, "not-admin");
  });

  // -- missing Auth account (Auth lookup miss) -> denied ---------------------
  await okAsync("no Auth account (Auth lookup miss) -> no-auth-account", async () => {
    const uid = uniq("noauth");
    const emp = `${uid}-emp`;
    // Firestore records exist but the Auth user is never created; getUser misses.
    await seed({ uid, employeeId: emp, createAuth: false, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await verdictFor(uid);
    assert.strictEqual(facts.authExists, false);
    assert.strictEqual(verdict.category, "no-auth-account");
  });

  // -- both callables' command cores use the tested adapter path -------------
  // Authorized admin passes the real actor gate: initiate then fails only on the
  // unconfigured send (proving the gate was passed), and list returns rows.
  await okAsync("initiate uses the real adapter: authorized admin passes actor gate", async () => {
    await assert.rejects(
      initiateAdminPasswordReset(
        { actorUid: okUid, targetUid: uniq("target"), idempotencyKey: freshKey() },
        { ...actorAuthorizationDeps(), resolveTargetFacts: async () => ({ authExists: false }), nativeSend: NOT_CONFIGURED_NATIVE_SEND },
      ),
      (e) => e instanceof DeliveryUnavailableError,
      "authorized actor should pass the gate and reach the (unconfigured) send check",
    );
  });
  await okAsync("list uses the real adapter: authorized admin gets rows", async () => {
    const rows = await listResetEligibleUsers({ actorUid: okUid }, actorAuthorizationDeps());
    assert.ok(Array.isArray(rows));
  });
  // Denied admin (disabled) is rejected by BOTH callables via the real adapter.
  const badUid = uniq("bad-disabled");
  await okAsync("both callables reject a disabled admin via the real adapter", async () => {
    const emp = `${badUid}-emp`;
    await seed({ uid: badUid, employeeId: emp, disabled: true, employee: { userId: badUid, employmentStatus: "ACTIVE" } });
    await assert.rejects(
      listResetEligibleUsers({ actorUid: badUid }, actorAuthorizationDeps()),
      (e) => e instanceof UnauthorizedActorError,
    );
    await assert.rejects(
      initiateAdminPasswordReset(
        { actorUid: badUid, targetUid: uniq("target"), idempotencyKey: freshKey() },
        { ...actorAuthorizationDeps(), resolveTargetFacts: async () => ({ authExists: false }), nativeSend: NOT_CONFIGURED_NATIVE_SEND },
      ),
      (e) => e instanceof UnauthorizedActorError,
    );
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
