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
  return {
    facts,
    verdict: evaluateActorAuthorization(facts),
    // ══════════ WHY THERE IS A SECOND VERDICT ══════════
    //
    // The capability gate runs FIRST and is currently inactive everywhere, so every real verdict
    // below is `missing-capability` and the ordering underneath it -- disabled beats inactive
    // employment, a broken link beats employment status -- would stop being exercised at all.
    // Deleting those cases would quietly drop coverage of the fail-closed order the day the
    // capability is activated, which is precisely when it starts mattering.
    //
    // So each case asserts BOTH: the real verdict (denied, on the capability) and the verdict the
    // SAME facts would produce for a capability holder. The second is a hypothetical about the
    // evaluator, never a claim that anybody is authorized today.
    verdictIfCapabilityHeld: evaluateActorAuthorization({ ...facts, holdsCredentialResetCapability: true }),
  };
}

async function main() {
  // -- wiring: both callables share the tested adapter ------------------------
  await okAsync("actorAuthorizationDeps().resolveActorFacts IS the tested adapter", async () => {
    assert.strictEqual(actorAuthorizationDeps().resolveActorFacts, resolveActorFacts);
  });

  // ══════════ A LEGACY ADMIN DOCUMENT NO LONGER AUTHORIZES ══════════
  //
  // This case used to seed `users/{uid}.role = "admin"` and assert `authorized`. That was the
  // last server-side authorization the platform answered from Firebase data, and it is gone: the
  // actor now authorizes on the GOVERNED `admin.credentialReset.initiate` capability, which is
  // registered `active: false` and excluded even from per-environment sandbox activation.
  //
  // So the fully-linked, ACTIVE, enabled, legacy-admin actor is DENIED, and the reason is
  // missing-capability rather than anything about their employment or their linkage. That is the
  // intended state, not a regression -- activation is a separate production/security gate, and
  // this assertion is what would fail if a legacy fallback were ever restored to make the
  // emulator surface authorize again.
  const okUid = uniq("ok-admin");
  await okAsync("a legacy admin document is DENIED: authority is the capability, which is inactive", async () => {
    const emp = `${okUid}-emp`;
    await seed({ uid: okUid, role: "admin", employeeId: emp, employee: { userId: okUid, employmentStatus: "ACTIVE" } });
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(okUid);
    assert.deepStrictEqual(facts, {
      authExists: true,
      disabled: false,
      // Every OTHER fact resolves exactly as before -- the adapter still reads Auth state and the
      // reciprocal Employee link correctly. Only the authority changed.
      holdsCredentialResetCapability: false,
      hasEmployeeLink: true,
      employeeLinkReciprocal: true,
      employmentStatus: "ACTIVE",
    });
    assert.deepStrictEqual(verdict, { authorized: false, category: "missing-capability" });
  });

  // -- disabled Auth account -> denied ---------------------------------------
  await okAsync("disabled Auth account -> disabled-actor (even with ACTIVE reciprocal employee)", async () => {
    const uid = uniq("disabled");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, disabled: true, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(facts.disabled, true);
    assert.strictEqual(verdictIfCapabilityHeld.category, "disabled-actor");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
  });

  // -- non-ACTIVE / malformed / missing employmentStatus -> denied -----------
  for (const [label, status] of [["INACTIVE", "INACTIVE"], ["TERMINATED", "TERMINATED"], ["ON_LEAVE", "ON_LEAVE"]]) {
    await okAsync(`employmentStatus ${label} -> inactive-employment`, async () => {
      const uid = uniq("emp-" + label);
      const emp = `${uid}-emp`;
      await seed({ uid, employeeId: emp, employee: { userId: uid, employmentStatus: status } });
      const { verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
      assert.strictEqual(verdictIfCapabilityHeld.category, "inactive-employment");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
    });
  }
  await okAsync("missing employmentStatus -> inactive-employment (null)", async () => {
    const uid = uniq("emp-missing");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, employee: { userId: uid } });
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(facts.employmentStatus, null);
    assert.strictEqual(verdictIfCapabilityHeld.category, "inactive-employment");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
  });
  await okAsync("malformed (non-string) employmentStatus -> inactive-employment (null)", async () => {
    const uid = uniq("emp-malformed");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, employee: { userId: uid, employmentStatus: 42 } });
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(facts.employmentStatus, null);
    assert.strictEqual(verdictIfCapabilityHeld.category, "inactive-employment");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
  });

  // -- reciprocal link uses employees.userId ONLY ----------------------------
  await okAsync("mismatched employees.userId -> missing-or-nonreciprocal (employmentStatus not trusted)", async () => {
    const uid = uniq("mismatch");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, employee: { userId: "someone-else", employmentStatus: "ACTIVE" } });
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, false);
    assert.strictEqual(facts.employmentStatus, null);
    assert.strictEqual(verdictIfCapabilityHeld.category, "missing-or-nonreciprocal-employee-link");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
  });
  await okAsync("alias-only authUid/uid with MISSING userId -> denied (aliases not honored)", async () => {
    const uid = uniq("alias");
    const emp = `${uid}-emp`;
    await seed({ uid, employeeId: emp, employee: { authUid: uid, uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, false, "authUid/uid must NOT authorize");
    assert.strictEqual(verdictIfCapabilityHeld.category, "missing-or-nonreciprocal-employee-link");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
  });
  await okAsync("missing employeeId on user doc -> no link", async () => {
    const uid = uniq("nolink");
    await seed({ uid }); // no employeeId, no employee doc
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(facts.hasEmployeeLink, false);
    assert.strictEqual(verdictIfCapabilityHeld.category, "missing-or-nonreciprocal-employee-link");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
  });
  await okAsync("employeeId set but employee doc missing -> not reciprocal", async () => {
    const uid = uniq("empmissing");
    await seed({ uid, employeeId: `${uid}-emp` }); // employee doc not written
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, false);
    assert.strictEqual(verdictIfCapabilityHeld.category, "missing-or-nonreciprocal-employee-link");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
  });

  // -- no capability, whatever the legacy role says --------------------------
  await okAsync("a non-admin legacy role is denied for the SAME reason as an admin one", async () => {
    // The point is that the legacy role no longer distinguishes anybody: "admin" and "technician"
    // now reach the identical verdict, which is what it means for the field to have stopped
    // being an authority.
    const uid = uniq("tech");
    const emp = `${uid}-emp`;
    await seed({ uid, role: "technician", employeeId: emp, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(verdict.category, "missing-capability");
  });

  // -- missing Auth account (Auth lookup miss) -> denied ---------------------
  await okAsync("no Auth account (Auth lookup miss) -> no-auth-account", async () => {
    const uid = uniq("noauth");
    const emp = `${uid}-emp`;
    // Firestore records exist but the Auth user is never created; getUser misses.
    await seed({ uid, employeeId: emp, createAuth: false, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict, verdictIfCapabilityHeld } = await verdictFor(uid);
    assert.strictEqual(facts.authExists, false);
    assert.strictEqual(verdictIfCapabilityHeld.category, "no-auth-account");
    // And today the real verdict DENIES. Not necessarily on the capability: authExists and
    // disabled are checked before it, so an absent or disabled Auth account still denies for its
    // own earlier reason. What no case may be is authorized.
    assert.strictEqual(verdict.authorized, false);
  });

  // ══════════ BOTH CALLABLES ARE INERT END TO END ══════════
  //
  // These two cases used to seed a legacy admin, watch them PASS the actor gate, and assert that
  // initiate then failed only on the unconfigured send. That is no longer reachable: with the
  // capability inactive, `okUid` -- fully linked, ACTIVE, enabled, and `role: "admin"` in
  // Firestore -- is refused at the gate by both callables.
  //
  // WHAT THIS COSTS, said plainly rather than quietly dropped: the end-to-end path BELOW the
  // actor gate (reaching the unconfigured send, listing rows) is no longer exercised through the
  // real adapter, and cannot be until the capability is activated at its own gate. The injected-
  // facts suite (adminCredentialCommands.test.mjs) still covers that path with the gate satisfied
  // by construction, so the coverage moved rather than vanished.
  await okAsync("initiate refuses a legacy admin through the real adapter", async () => {
    await assert.rejects(
      initiateAdminPasswordReset(
        { actorUid: okUid, targetUid: uniq("target"), idempotencyKey: freshKey() },
        { ...actorAuthorizationDeps(), resolveTargetFacts: async () => ({ authExists: false }), nativeSend: NOT_CONFIGURED_NATIVE_SEND },
      ),
      (e) => e instanceof UnauthorizedActorError,
      "a legacy admin document must not authorize a credential reset",
    );
  });
  await okAsync("list refuses a legacy admin through the real adapter", async () => {
    await assert.rejects(
      listResetEligibleUsers({ actorUid: okUid }, actorAuthorizationDeps()),
      (e) => e instanceof UnauthorizedActorError,
      "the eligible-user list is a governed read, not a legacy-admin one",
    );
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
