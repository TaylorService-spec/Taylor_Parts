// D5 — callable-layer tests for equipmentCompatibilityReadCallable's handleReadRequest core. Emulator
// (Firestore) for the real #226 resolver seam; the compiled handler is invoked directly (the standard
// way to test an onCall handler, as in accessCommandCallables.test.js). Proves: auth is required and
// server-derived; exact per-mode request shapes; the inactive capability denies through the REAL
// resolver; InvalidInputError -> invalid-argument; and an unexpected fault -> a generic `unavailable`
// with no internal detail leaked. The callable stays UNEXPORTED from functions/src/index.ts (inert).
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const CALL = await import("../lib/equipmentCompatibility/equipmentCompatibilityReadCallable.js");

let passed = 0, failed = 0;
const ok = async (n, f) => {
  try { await f(); passed += 1; console.log(`PASS -- ${n}`); }
  catch (e) { failed += 1; console.log(`FAIL -- ${n}\n       ${e && e.stack ? e.stack.split("\n").slice(0, 5).join("\n       ") : e}`); }
};

const req = (data, uid) => ({ data, auth: uid !== undefined ? { uid } : null });
const GRANT = { db, resolvePermission: () => true, serialSchemes: {} };
async function expectHttps(promise, code) {
  try { await promise; assert.fail(`expected HttpsError code "${code}", but nothing threw`); }
  catch (e) { assert.equal(e.code, code, `expected code "${code}", got "${e.code}": ${e && e.message}`); return e; }
}

// ---- auth ----
await ok("unauthenticated request is rejected (unauthenticated), before any read", async () => {
  await expectHttps(CALL.handleReadRequest(req({ mode: "forwardByPart", partId: "TST-1001" }, undefined), GRANT), "unauthenticated");
});

// ---- identity is server-derived only ----
await ok("actor identity comes only from request.auth.uid; a client-supplied identity field is refused", async () => {
  // uid/actorUid/principalUid are simply not accepted keys for any mode.
  for (const bad of [{ mode: "forwardByPart", partId: "TST-1001", actorUid: "attacker" }, { mode: "forwardByPart", partId: "TST-1001", uid: "attacker" }, { mode: "forwardByPart", partId: "TST-1001", principalUid: "attacker" }]) {
    await expectHttps(CALL.handleReadRequest(req(bad, "real-uid"), GRANT), "invalid-argument");
  }
});

// ---- exact per-mode shapes ----
await ok("request data must be an object; mode must be one of the three", async () => {
  await expectHttps(CALL.handleReadRequest(req(null, "u"), GRANT), "invalid-argument");
  await expectHttps(CALL.handleReadRequest(req([], "u"), GRANT), "invalid-argument");
  await expectHttps(CALL.handleReadRequest(req({ mode: "nope" }, "u"), GRANT), "invalid-argument");
  await expectHttps(CALL.handleReadRequest(req({}, "u"), GRANT), "invalid-argument");
});
await ok("forwardByPart: requires partId; rejects equipmentModelId and any wrong-mode field", async () => {
  await expectHttps(CALL.handleReadRequest(req({ mode: "forwardByPart" }, "u"), GRANT), "invalid-argument"); // missing partId
  await expectHttps(CALL.handleReadRequest(req({ mode: "forwardByPart", partId: "TST-1001", equipmentModelId: "TAYLOR--C713" }, "u"), GRANT), "invalid-argument");
  await expectHttps(CALL.handleReadRequest(req({ mode: "forwardByPart", partId: 123 }, "u"), GRANT), "invalid-argument"); // wrong type
});
await ok("reverseByModel: requires equipmentModelId; rejects partId", async () => {
  await expectHttps(CALL.handleReadRequest(req({ mode: "reverseByModel" }, "u"), GRANT), "invalid-argument");
  await expectHttps(CALL.handleReadRequest(req({ mode: "reverseByModel", equipmentModelId: "TAYLOR--C713", partId: "TST-1001" }, "u"), GRANT), "invalid-argument");
});
await ok("modelSummary: equipmentModelId only; rejects cursor and limit", async () => {
  await expectHttps(CALL.handleReadRequest(req({ mode: "modelSummary", equipmentModelId: "TAYLOR--C713", cursor: "x" }, "u"), GRANT), "invalid-argument");
  await expectHttps(CALL.handleReadRequest(req({ mode: "modelSummary", equipmentModelId: "TAYLOR--C713", limit: 5 }, "u"), GRANT), "invalid-argument");
});
await ok("cursor/limit type checks on the relationship modes", async () => {
  await expectHttps(CALL.handleReadRequest(req({ mode: "forwardByPart", partId: "TST-1001", limit: 1.5 }, "u"), GRANT), "invalid-argument");
  await expectHttps(CALL.handleReadRequest(req({ mode: "forwardByPart", partId: "TST-1001", cursor: 42 }, "u"), GRANT), "invalid-argument");
});

// ---- InvalidInputError -> invalid-argument (syntactic key validation, reachable before grant) ----
await ok("a malformed partId maps to invalid-argument (InvalidInputError from the service)", async () => {
  // Passes the callable shape (non-empty string) but fails the service's isValidPartId, which runs before
  // the permission check (purely syntactic on caller input) => InvalidInputError => invalid-argument.
  await expectHttps(CALL.handleReadRequest(req({ mode: "forwardByPart", partId: "bad id with spaces!!" }, "real-uid"), CALL.buildDeps()), "invalid-argument");
});

// ---- inactive capability denies through the REAL resolver seam ----
await ok("a well-formed authenticated read DENIES through the real resolver (equipment.compatibility.view is active:false), even for an admin principal", async () => {
  const uid = "d5-callable-admin";
  // Seed a valid principal WITH an active admin assignment, so the DENY is provably because the capability
  // is inactive — not because the user or its access record is missing/malformed.
  await db.collection("users").doc(uid).set({ accessVersion: 0 });
  await db.collection("roleAssignments").doc(`ra-${uid}`).set({ principalUid: uid, roleId: "admin", scope: { type: "global" }, grantedBy: "seed", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 0 });
  const res = await CALL.handleReadRequest(req({ mode: "forwardByPart", partId: "TST-1001" }, uid), CALL.buildDeps());
  assert.equal(res.pageDisposition, "DENIED", "the inactive capability denies every principal through the real resolver");
  assert.deepEqual(res.items, []);
});

// ---- unexpected fault -> generic unavailable, no leak ----
await ok("an unexpected internal fault maps to a generic 'unavailable' with no internal detail leaked", async () => {
  const throwingService = {
    readCompatibilityForPart: async () => { throw new Error("SECRET_INTERNAL_DETAIL stack path /x/y"); },
    readCompatibilityForModel: async () => { throw new Error("SECRET_INTERNAL_DETAIL"); },
    readModelSummary: async () => { throw new Error("SECRET_INTERNAL_DETAIL"); },
  };
  const err = await expectHttps(CALL.handleReadRequest(req({ mode: "forwardByPart", partId: "TST-1001" }, "u"), GRANT, throwingService), "unavailable");
  assert.equal(err.message.includes("SECRET_INTERNAL_DETAIL"), false, "internal detail must never be forwarded");
});

console.log(`\n${passed} D5 read-callable checks passed${failed ? `, ${failed} FAILED` : ""}`);
if (failed) process.exit(1);
