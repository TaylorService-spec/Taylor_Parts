// AUTH target-side parity -- Auth+Firestore emulator test for the PRODUCTION
// target-fact adapter. Unlike adminCredentialCommands.test.mjs (which injects
// precomputed TargetFacts), this suite seeds REAL Firebase Auth users +
// users/{uid} + employees/{employeeId} + roleAssignments and exercises the actual
// deployed adapter `resolveTargetFacts` from adminCredentialCallables. It proves
// the callable derives the eligibility facts correctly: exact employees.userId
// reciprocity (no authUid/uid aliases), authoritative employmentStatus === ACTIVE,
// Auth disabled/missing/email handling, break-glass, and final-recoverable-admin
// protection -- a wiring regression here would NOT be caught by injected facts.
//
// Prerequisite: a live Firestore emulator (8080) AND Auth emulator (9099), then
// (after `npm run build`):
//   node functions/test/adminCredentialTargetFacts.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  resolveTargetFacts,
} from "../lib/access/adminCredentialCallables.js";
import {
  evaluateTargetEligibility,
  initiateAdminPasswordReset,
} from "../lib/access/adminCredentialCommands.js";

admin.initializeApp({ projectId: "demo-authpr2target" });
const db = getFirestore();
const auth = getAuth();

let counter = 0;
const uniq = (p) => `${p}_${Date.now().toString(36)}_${(counter += 1)}`;
const freshKey = () => `aprtgtkey.${Date.now().toString(36)}.${(counter += 1)}0000`;

// Seed a real target across Auth + Firestore. `employee` is written verbatim so
// alias-only fixtures are exact; omit pieces to model missing records.
//
// ══════════ ADMIN IS A ROLE ASSIGNMENT, NOT A STRING ON THE USER ══════════
//
// `role` is still written because the fixtures are realistic user documents, but it decides
// NOTHING any more: the final-active-admin protection reads the governed roleAssignments. The
// separate `adminAssignment` flag is what actually makes a seeded target an administrator, and
// the two are deliberately independent here so a fixture carrying the legacy string WITHOUT the
// assignment proves the string no longer confers anything.
async function seed({ uid, role = "technician", employeeId, disabled = false, email, createAuth = true, breakGlass = false, employee, adminAssignment = false }) {
  if (createAuth) await auth.createUser({ uid, disabled, ...(email ? { email } : {}) });
  const doc = { role };
  if (employeeId !== undefined) doc.employeeId = employeeId;
  if (breakGlass) doc.breakGlass = true;
  await db.collection("users").doc(uid).set(doc);
  if (employee !== undefined && employeeId !== undefined) {
    await db.collection("employees").doc(employeeId).set(employee);
  }
  if (adminAssignment) {
    await db.collection("roleAssignments").doc(`${uid}-admin`).set({
      principalUid: uid,
      roleId: "admin",
      status: "active",
    });
  }
}

let passed = 0;
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

async function categoryFor(uid, actorUid = "some-admin-actor") {
  const facts = await resolveTargetFacts(uid);
  return { facts, verdict: evaluateTargetEligibility(facts, actorUid, uid) };
}

async function main() {
  // -- eligible: exact userId + ACTIVE + enabled + email + linked -------------
  await okAsync("exact userId + ACTIVE + enabled + email -> eligible", async () => {
    const uid = uniq("elig");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await categoryFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, true);
    assert.strictEqual(facts.employmentStatus, "ACTIVE");
    assert.strictEqual(verdict.category, "eligible");
  });

  // -- Auth account states ----------------------------------------------------
  await okAsync("no Auth account -> no-auth-account", async () => {
    const uid = uniq("noauth");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, createAuth: false, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await categoryFor(uid);
    assert.strictEqual(facts.authExists, false);
    assert.strictEqual(verdict.category, "no-auth-account");
  });
  await okAsync("disabled Auth account -> disabled-target", async () => {
    const uid = uniq("disabled");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, disabled: true, email: `${uid}@example.com`, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { verdict } = await categoryFor(uid);
    assert.strictEqual(verdict.category, "disabled-target");
  });
  await okAsync("no recoverable email -> no-recoverable-email", async () => {
    const uid = uniq("noemail");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, employee: { userId: uid, employmentStatus: "ACTIVE" } }); // createAuth true, no email
    const { verdict } = await categoryFor(uid);
    assert.strictEqual(verdict.category, "no-recoverable-email");
  });

  // -- reciprocal link uses employees.userId ONLY ----------------------------
  await okAsync("missing employeeId -> missing-or-nonreciprocal", async () => {
    const uid = uniq("nolink");
    await seed({ uid, email: `${uid}@example.com` });
    const { verdict } = await categoryFor(uid);
    assert.strictEqual(verdict.category, "missing-or-nonreciprocal-employee-link");
  });
  await okAsync("mismatched employees.userId -> missing-or-nonreciprocal (employmentStatus not trusted)", async () => {
    const uid = uniq("mismatch");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { userId: "someone-else", employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await categoryFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, false);
    assert.strictEqual(facts.employmentStatus, null);
    assert.strictEqual(verdict.category, "missing-or-nonreciprocal-employee-link");
  });
  await okAsync("alias-only authUid/uid with MISSING userId -> denied (aliases not honored)", async () => {
    const uid = uniq("alias");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { authUid: uid, uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await categoryFor(uid);
    assert.strictEqual(facts.employeeLinkReciprocal, false);
    assert.strictEqual(verdict.category, "missing-or-nonreciprocal-employee-link");
  });

  // -- authoritative employmentStatus gate -----------------------------------
  for (const status of ["INACTIVE", "TERMINATED", "ON_LEAVE", "RETIRED", "CONTRACTOR"]) {
    await okAsync(`employmentStatus ${status} -> inactive-employment-target`, async () => {
      const uid = uniq("emp-" + status);
      const emp = `${uid}-e`;
      await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { userId: uid, employmentStatus: status } });
      const { verdict } = await categoryFor(uid);
      assert.strictEqual(verdict.category, "inactive-employment-target");
    });
  }
  await okAsync("missing employmentStatus -> inactive-employment-target", async () => {
    const uid = uniq("emp-missing");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { userId: uid } });
    const { facts, verdict } = await categoryFor(uid);
    assert.strictEqual(facts.employmentStatus, null);
    assert.strictEqual(verdict.category, "inactive-employment-target");
  });
  await okAsync("malformed (non-string) employmentStatus -> inactive-employment-target", async () => {
    const uid = uniq("emp-malformed");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { userId: uid, employmentStatus: 7 } });
    const { verdict } = await categoryFor(uid);
    assert.strictEqual(verdict.category, "inactive-employment-target");
  });

  // -- break-glass + final-admin protections preserved -----------------------
  await okAsync("break-glass target -> break-glass-target", async () => {
    const uid = uniq("bg");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, breakGlass: true, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { verdict } = await categoryFor(uid);
    assert.strictEqual(verdict.category, "break-glass-target");
  });
  await okAsync("final active recoverable admin -> protected-final-admin", async () => {
    const uid = uniq("finaladmin");
    const emp = `${uid}-e`;
    // An ACTIVE admin roleAssignment and NO OTHER one -> isFinalActiveAdmin, a visible protected
    // refusal. The authority is the assignment; the legacy string on the user document is not
    // written at all here, which is the point.
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { userId: uid, employmentStatus: "ACTIVE" }, adminAssignment: true });
    const { verdict } = await categoryFor(uid);
    assert.strictEqual(verdict.category, "protected-final-admin");
  });
  await okAsync("a legacy admin STRING with no assignment is NOT protected", async () => {
    // The regression this closes, stated as a fixture: before the cutover, `role: "admin"` on the
    // user document was what triggered final-admin protection. A person the governed model does
    // not consider an administrator was being protected as one -- and, worse in the other
    // direction, a real administrator whose legacy string had drifted was not.
    const uid = uniq("legacystring");
    const emp = `${uid}-e`;
    await seed({ uid, role: "admin", employeeId: emp, email: `${uid}@example.com`, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const { facts, verdict } = await categoryFor(uid);
    assert.strictEqual(facts.isFinalActiveAdmin, false);
    assert.strictEqual(verdict.category, "eligible");
  });
  await okAsync("an admin with ANOTHER active admin beside them is not the final one", async () => {
    const uid = uniq("oneofmany");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { userId: uid, employmentStatus: "ACTIVE" }, adminAssignment: true });
    const other = uniq("otheradmin");
    await seed({ uid: other, adminAssignment: true });
    const { facts, verdict } = await categoryFor(uid);
    assert.strictEqual(facts.isFinalActiveAdmin, false);
    assert.strictEqual(verdict.category, "eligible");
  });
  await okAsync("self-target -> protected (visible)", async () => {
    const uid = uniq("self");
    const emp = `${uid}-e`;
    await seed({ uid, employeeId: emp, email: `${uid}@example.com`, employee: { userId: uid, employmentStatus: "ACTIVE" } });
    const facts = await resolveTargetFacts(uid);
    assert.strictEqual(evaluateTargetEligibility(facts, uid, uid).category, "self-target");
  });

  // -- initiate uses the deployed TARGET adapter (end-to-end) -----------------
  //
  // The subject of these two cases is the target adapter: does an eligible target reach the send,
  // and does a neutral-ineligible one not. The ACTOR gate is a different question, and it is now
  // closed in every environment because `admin.credentialReset.initiate` is inactive -- so a
  // seeded admin actor can no longer be used to get past it.
  //
  // The actor facts are therefore INJECTED as authorized, which is exactly what
  // adminCredentialCommands.test.mjs does for the same reason. That is not a weakening of the
  // actor gate: it is tested directly, against the real adapter, in
  // adminCredentialActorFacts.test.mjs, where a fully-linked legacy admin is REFUSED.
  const actorUid = uniq("actor-admin");
  const actorEmp = `${actorUid}-e`;
  await seed({ uid: actorUid, employeeId: actorEmp, email: `${actorUid}@example.com`, employee: { userId: actorUid, employmentStatus: "ACTIVE" } });
  const authorizedActorDeps = {
    resolveActorFacts: async () => ({
      authExists: true,
      disabled: false,
      holdsCredentialResetCapability: true,
      hasEmployeeLink: true,
      employeeLinkReciprocal: true,
      employmentStatus: "ACTIVE",
    }),
  };
  const makeSpy = () => {
    const sends = [];
    return { sends, sender: { isConfigured: () => true, sendReset: async (a) => { sends.push(a); return { outcome: "accepted" }; } } };
  };

  await okAsync("initiate: eligible target reaches send via the real target adapter", async () => {
    const t = uniq("e2e-elig");
    const emp = `${t}-e`;
    await seed({ uid: t, employeeId: emp, email: `${t}@example.com`, employee: { userId: t, employmentStatus: "ACTIVE" } });
    const { sends, sender } = makeSpy();
    const out = await initiateAdminPasswordReset(
      { actorUid, targetUid: t, idempotencyKey: freshKey() },
      { ...authorizedActorDeps, resolveTargetFacts, nativeSend: sender },
    );
    assert.deepStrictEqual(out, { status: "accepted" });
    assert.strictEqual(sends.length, 1, "eligible target should trigger exactly one send");
  });
  await okAsync("initiate: inactive-employment target is neutral, NO send (real target adapter)", async () => {
    const t = uniq("e2e-inactive");
    const emp = `${t}-e`;
    await seed({ uid: t, employeeId: emp, email: `${t}@example.com`, employee: { userId: t, employmentStatus: "TERMINATED" } });
    const { sends, sender } = makeSpy();
    const out = await initiateAdminPasswordReset(
      { actorUid, targetUid: t, idempotencyKey: freshKey() },
      { ...authorizedActorDeps, resolveTargetFacts, nativeSend: sender },
    );
    assert.deepStrictEqual(out, { status: "accepted" });
    assert.strictEqual(sends.length, 0, "inactive-employment target must NOT be sent a reset");
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
