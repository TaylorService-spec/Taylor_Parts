// Audit idempotency must be scoped to the TARGET — EMULATOR tests.
//
// THE DEFECT. mkAuditId hashes actorUid|key with no target. One actor reusing an idempotency
// key across two DIFFERENT records collides: the second call finds the first call's audit
// event, returns "replayed", and skips every validation without applying anything — while
// telling the caller it succeeded. A silent no-op reported as success is worse than an error,
// because nothing anywhere records that the change did not happen.
//
// This was found by accident: three assertions in the updateOpportunity suite failed because
// earlier tests in the same file had already burned the key. The same shape existed on the two
// transition paths, which act on an existing target.
//
// CREATES ARE NOT AFFECTED, and are asserted here so the distinction is not lost. A create
// acts on no pre-existing target, so same actor + same key IS the same intent and replaying it
// correctly returns the first-created id. There is no "different target" case to confuse,
// because the target does not exist until the call succeeds.
//
// Prerequisite: npm run build; Firestore emulator running.
// Run: node --test test/auditIdempotencyTargetScope.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import test, { after } from "node:test";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { persistTransitionedOpportunity, persistCreatedOpportunity } = await import(
  "../lib/opportunity/opportunityCallables.js"
);

const ACTOR = "actor-idem-1";
let seq = 0;
const created = [];

after(async () => {
  for (const id of created) await db.collection("opportunities").doc(id).delete().catch(() => {});
  const audits = await db.collection("auditEvents").where("actorUid", "==", ACTOR).get();
  await Promise.all(audits.docs.map((d) => d.ref.delete()));
});

async function seed(over = {}) {
  const id = `idem-${Date.now()}-${++seq}`;
  await db.collection("opportunities").doc(id).set({
    accountId: "acct-1",
    ownerEmployeeId: "emp-1",
    salesChannel: "RETAIL",
    stage: "IDENTIFIED",
    outcome: null,
    lines: [{ kind: "PART", ref: "PRT-1", qty: 1 }],
    ...over,
  });
  created.push(id);
  return id;
}

const advance = (id, toStage, key) =>
  db.runTransaction((tx) =>
    persistTransitionedOpportunity(
      db,
      tx,
      db.collection("opportunities").doc(id),
      id,
      { kind: "ADVANCE", toStage },
      ACTOR,
      key,
    ),
  );

const stageOf = async (id) => (await db.collection("opportunities").doc(id).get()).data().stage;

// ---------------------------------------------------------------- the defect

test("SAME actor + SAME key + DIFFERENT targets: BOTH apply — no false replay", async () => {
  // The regression. Before the fix, the second call returned replayed:true and left
  // Opportunity B untouched at IDENTIFIED, while reporting success.
  const a = await seed();
  const b = await seed();

  const resA = await advance(a, "QUALIFYING", "shared-key");
  const resB = await advance(b, "QUALIFYING", "shared-key");

  assert.equal(resA.replayed, false, "the first call applies");
  assert.equal(resB.replayed, false, "the SECOND call must also apply — it is a different record");
  assert.equal(await stageOf(a), "QUALIFYING");
  assert.equal(await stageOf(b), "QUALIFYING", "B must actually have moved, not merely been reported as moved");
});

test("a false replay cannot skip validation on a different target", async () => {
  // The dangerous half: a replay returns BEFORE the transition is validated. If the key
  // collided, an ILLEGAL transition on B would be reported as a success.
  const a = await seed();
  const b = await seed({ stage: "DECISION", outcome: "LOST" }); // terminal — cannot advance

  await advance(a, "QUALIFYING", "collide-key");
  await assert.rejects(
    advance(b, "QUALIFYING", "collide-key"),
    "an illegal transition on B must be REJECTED, never absorbed as a replay of A",
  );
  assert.equal(await stageOf(b), "DECISION", "B is untouched");
});

// ---------------------------------------------------------------- preserved behaviour

test("SAME actor + SAME key + SAME target still replays — the mechanism still works", async () => {
  const a = await seed();
  const first = await advance(a, "QUALIFYING", "same-key");
  const second = await advance(a, "QUALIFYING", "same-key");
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true, "a genuine retry must still be absorbed");
});

test("DIFFERENT keys on the SAME target are different intents and both apply", async () => {
  const a = await seed();
  await advance(a, "QUALIFYING", "k1");
  const second = await advance(a, "SOLUTION", "k2");
  assert.equal(second.replayed, false);
  assert.equal(await stageOf(a), "SOLUTION");
});

// ---------------------------------------------------------------- backward compatibility

test("a LEGACY audit id still suppresses a re-apply, so the rollout window is safe", async () => {
  // Simulates a call made BEFORE the derivation changed: only the old, unscoped audit id
  // exists. A retry must still be recognised as a replay, or the change would convert a
  // safety mechanism into a double-apply for every in-flight key at deploy time.
  const { createHash } = await import("node:crypto");
  const a = await seed();
  const legacyKey = "in-flight-key";
  const legacyAid = `transitionOpportunity_${createHash("sha256").update(`${ACTOR}|${legacyKey}`).digest("hex").slice(0, 40)}`;

  await db.collection("auditEvents").doc(legacyAid).set({
    actorUid: ACTOR,
    action: "transitionOpportunity",
    targetType: "opportunity",
    targetId: a,
    outcome: "applied",
    summary: "legacy pre-change audit event",
  });

  const res = await advance(a, "QUALIFYING", legacyKey);
  assert.equal(res.replayed, true, "the legacy id must still be honoured");
  assert.equal(await stageOf(a), "IDENTIFIED", "and nothing may be re-applied");
});

// ---------------------------------------------------------------- creates are different

test("CREATE is not the same defect: it acts on no pre-existing target", async () => {
  // Same actor + same key on a create IS the same intent, and replay correctly returns the
  // first-created id. Asserted so nobody 'fixes' this into a create that duplicates records.
  const built = {
    accountId: "acct-1",
    ownerEmployeeId: "emp-1",
    salesChannel: "RETAIL",
    stage: "IDENTIFIED",
    outcome: null,
    need: null,
    expectedValue: null,
    expectedCloseAt: null,
    lines: [{ kind: "PART", ref: "PRT-1", qty: 1 }],
    createdByUid: ACTOR,
    createdAtMillis: 1,
    updatedAtMillis: 1,
  };
  const first = await db.runTransaction((tx) => persistCreatedOpportunity(db, tx, built, ACTOR, "create-key"));
  const second = await db.runTransaction((tx) => persistCreatedOpportunity(db, tx, built, ACTOR, "create-key"));
  created.push(first.opportunityId);

  assert.equal(second.replayed, true, "a repeated create with one key must not make a second record");
  assert.equal(second.opportunityId, first.opportunityId, "it returns the record the first call made");
});
