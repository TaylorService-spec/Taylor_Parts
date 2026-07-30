// AUTH PRE-1 (G-PRE1-IMPL) -- Firestore-emulator tests for the concrete native
// reset sender's durable, sender-owned idempotency-key deduplication
// (createNativeResetSender). The outbound Firebase-native send is replaced by a
// controlled FAKE (no production call, no email). Proves: at-most-one outbound
// call per key; accepted/not_accepted/uncertain outcomes; replay; the crash gap
// (claimed -> uncertain, fail closed); binding-mismatch and malformed records fail
// closed; and concurrency admits at most one outbound.
//
// Prerequisite: a live Firestore emulator, then (after `npm run build`):
//   node functions/test/adminCredentialSendDedupe.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import {
  createNativeResetSender,
  SendBindingMismatchError,
  MalformedSendDedupeError,
} from "../lib/access/nativeResetSender.js";

admin.initializeApp({ projectId: "demo-authpr1dedupe" });
const db = getFirestore();
const DEDUPE = "admin_credential_reset_send_dedupe";

let counter = 0;
const uniq = (p) => `${p}.${Date.now().toString(36)}.${(counter += 1)}0000`;
const BIND = "binding-abc";
const args = (key, over = {}) => ({ targetUid: "t1", email: "t@example.com", idempotencyKey: key, binding: BIND, ...over });

// A fake outbound recording calls; `mode` controls the result.
function fakeOutbound(mode = "accept") {
  const calls = [];
  const outbound = async (a) => {
    calls.push(a);
    if (mode === "reject") return { accepted: false };
    if (mode === "throw") throw new Error("outbound transport boom");
    return { accepted: true };
  };
  return { outbound, calls };
}
const dedupeDoc = async (key) => {
  const s = await db.collection(DEDUPE).doc(key).get();
  return s.exists ? s.data() : null;
};

let passed = 0;
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

async function main() {
  // -- not configured (outbound null) -> fail closed, no dedupe doc ----------
  await okAsync("outbound null -> isConfigured false, not_accepted, no dedupe doc", async () => {
    const sender = createNativeResetSender({ outbound: null });
    assert.strictEqual(sender.isConfigured(), false);
    const key = uniq("nullcfg");
    const r = await sender.sendReset(args(key));
    assert.deepStrictEqual(r, { outcome: "not_accepted" });
    assert.strictEqual(await dedupeDoc(key), null);
  });

  // -- happy path: one outbound call, accepted, terminal accepted ------------
  await okAsync("fresh key -> accepted, ONE outbound call, dedupe accepted", async () => {
    const { outbound, calls } = fakeOutbound("accept");
    const sender = createNativeResetSender({ outbound });
    assert.strictEqual(sender.isConfigured(), true);
    const key = uniq("ok");
    const r = await sender.sendReset(args(key));
    assert.deepStrictEqual(r, { outcome: "accepted" });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual((await dedupeDoc(key)).state, "accepted");
  });

  // -- replay after accepted: NO second outbound call -----------------------
  await okAsync("replay after accepted -> accepted, ZERO additional outbound calls", async () => {
    const { outbound, calls } = fakeOutbound("accept");
    const sender = createNativeResetSender({ outbound });
    const key = uniq("replay");
    await sender.sendReset(args(key));
    const r = await sender.sendReset(args(key));
    assert.deepStrictEqual(r, { outcome: "accepted" });
    assert.strictEqual(calls.length, 1, "at most one outbound call per key");
  });

  // -- not accepted -> failed terminal; replay returns not_accepted ---------
  await okAsync("outbound rejects -> not_accepted, dedupe failed; replay not_accepted", async () => {
    const { outbound, calls } = fakeOutbound("reject");
    const sender = createNativeResetSender({ outbound });
    const key = uniq("reject");
    assert.deepStrictEqual(await sender.sendReset(args(key)), { outcome: "not_accepted" });
    assert.strictEqual((await dedupeDoc(key)).state, "failed");
    assert.deepStrictEqual(await sender.sendReset(args(key)), { outcome: "not_accepted" });
    assert.strictEqual(calls.length, 1, "failed replay does not re-send");
  });

  // -- crash gap: a STALE (abandoned) claim resolves to uncertain (fail closed) -
  await okAsync("stale abandoned claim -> uncertain, NO outbound call, flipped to uncertain", async () => {
    const { outbound, calls } = fakeOutbound("accept");
    const sender = createNativeResetSender({ outbound });
    const key = uniq("crash");
    // Simulate a crash after claim but before the terminal write: an OLD claim
    // (past the lease) owned by a now-gone invocation.
    await db.collection(DEDUPE).doc(key).set({
      binding: BIND, state: "claimed", owner: "prior-owner-gone",
      claimedAtMs: Date.now() - 10 * 60 * 1000, updatedAtMs: Date.now() - 10 * 60 * 1000,
    });
    const r = await sender.sendReset(args(key));
    assert.deepStrictEqual(r, { outcome: "uncertain" });
    assert.strictEqual(calls.length, 0, "uncertain never calls the outbound");
    assert.strictEqual((await dedupeDoc(key)).state, "uncertain");
    // replay stays uncertain, still no call
    assert.deepStrictEqual(await sender.sendReset(args(key)), { outcome: "uncertain" });
    assert.strictEqual(calls.length, 0);
  });

  // -- P1 race (Codex): a live claim flipped to uncertain must NOT return accepted
  await okAsync("owner whose claim was flipped to uncertain returns uncertain (never accepted); durable stays uncertain", async () => {
    const key = uniq("p1race");
    // Caller A: an outbound that blocks until we release it (A holds a live claim).
    let releaseA;
    const aBarrier = new Promise((r) => { releaseA = r; });
    const aCalls = [];
    const outboundA = async (a) => { aCalls.push(a); await aBarrier; return { accepted: true }; };
    const senderA = createNativeResetSender({ outbound: outboundA });
    const aPromise = senderA.sendReset(args(key)); // creates claim (owner A), then blocks in outbound
    // Wait until A's claim exists, then age it past the lease so a sibling treats it as abandoned.
    for (let i = 0; i < 50 && (await dedupeDoc(key))?.state !== "claimed"; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual((await dedupeDoc(key)).state, "claimed");
    await db.collection(DEDUPE).doc(key).update({ claimedAtMs: Date.now() - 10 * 60 * 1000 });
    // Caller B encounters the (now-stale) claim -> uncertain, NO outbound.
    const { outbound: outboundB, calls: bCalls } = fakeOutbound("accept");
    const senderB = createNativeResetSender({ outbound: outboundB });
    const bOut = await senderB.sendReset(args(key));
    assert.strictEqual(bOut.outcome, "uncertain");
    assert.strictEqual(bCalls.length, 0, "B never sends");
    assert.strictEqual((await dedupeDoc(key)).state, "uncertain", "B flipped the stale claim to uncertain");
    // Release A: its Firebase send was accepted, but its claim was flipped away.
    releaseA();
    const aOut = await aPromise;
    assert.strictEqual(aOut.outcome, "uncertain", "A must NOT return accepted once it lost ownership");
    assert.strictEqual((await dedupeDoc(key)).state, "uncertain", "durable stays uncertain (no accepted overwrite)");
    assert.strictEqual(aCalls.length, 1, "only A's outbound ran once");
  });

  // -- outbound throws -> leaves claimed; next call is uncertain ------------
  await okAsync("outbound throws -> throws, leaves claimed; next call uncertain", async () => {
    const { outbound, calls } = fakeOutbound("throw");
    const sender = createNativeResetSender({ outbound });
    const key = uniq("throw");
    await assert.rejects(sender.sendReset(args(key)), /outbound transport boom/);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual((await dedupeDoc(key)).state, "claimed", "throw leaves the record claimed");
    // A later call (any sender) sees claimed -> uncertain, no new outbound.
    const { outbound: ob2, calls: calls2 } = fakeOutbound("accept");
    const sender2 = createNativeResetSender({ outbound: ob2 });
    assert.deepStrictEqual(await sender2.sendReset(args(key)), { outcome: "uncertain" });
    assert.strictEqual(calls2.length, 0);
  });

  // -- binding mismatch -> fail closed, no outbound call --------------------
  await okAsync("key reused with a different binding -> SendBindingMismatchError, no call", async () => {
    const { outbound, calls } = fakeOutbound("accept");
    const sender = createNativeResetSender({ outbound });
    const key = uniq("bind");
    await sender.sendReset(args(key)); // binding BIND, accepted
    await assert.rejects(sender.sendReset(args(key, { binding: "different" })), (e) => e instanceof SendBindingMismatchError);
    assert.strictEqual(calls.length, 1, "mismatch never re-sends");
  });

  // -- malformed dedupe record -> fail closed -------------------------------
  await okAsync("malformed dedupe record -> MalformedSendDedupeError", async () => {
    const { outbound } = fakeOutbound("accept");
    const sender = createNativeResetSender({ outbound });
    const key = uniq("malformed");
    await db.collection(DEDUPE).doc(key).set({ binding: BIND, state: "weird", claimedAtMs: 1 }); // bad state, missing updatedAtMs
    await assert.rejects(sender.sendReset(args(key)), (e) => e instanceof MalformedSendDedupeError);
  });

  // -- concurrency: two concurrent sends for one key -> at most one outbound -
  await okAsync("concurrent sendReset for one key -> at most one outbound call", async () => {
    const { outbound, calls } = fakeOutbound("accept");
    const sender = createNativeResetSender({ outbound });
    const key = uniq("race");
    const [a, b] = await Promise.allSettled([sender.sendReset(args(key)), sender.sendReset(args(key))]);
    for (const s of [a, b]) assert.strictEqual(s.status, "fulfilled");
    assert.ok(calls.length <= 1, "at most one outbound call under concurrency");
    // Return/durable correspondence: an `accepted` return MUST match a durable
    // `accepted`, and no `accepted` return may coexist with an uncertain record.
    const outcomes = [a.value.outcome, b.value.outcome];
    const durable = (await dedupeDoc(key)).state;
    if (outcomes.includes("accepted")) assert.strictEqual(durable, "accepted", "accepted return must match durable accepted");
    if (durable === "uncertain") assert.ok(!outcomes.includes("accepted"), "no accepted return may coexist with an uncertain record");
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
