// OFFLINE / RETRY — the shared reliability contract. PURE: no emulator, no storage, no timers.
// Run: node --test test/offlineSubmissionQueue.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  makeSubmission, enqueue, nextBatch, markUnverified, markConfirmed, markFailed,
  resolveUnverified, pruneConfirmed, summarize, isAlreadyConfirmed,
  SUBMISSION_STATE, SUBMISSION_STATE_TEXT, TERMINAL_ERROR_CODES, MAX_BATCH,
} from "../src/domain/offlineSubmissionQueue.js";

const sub = (key, over = {}) => makeSubmission({
  callable: "recordPutAway", payload: { partId: "PRT-1001" }, idempotencyKey: key, ...over,
}).value;

const queueOf = (...keys) => keys.reduce((q, k) => enqueue(q, sub(k)), Object.freeze([]));

// ═══════════════════════════════════════════ UNVERIFIED is a first-class answer

test("a sent-but-unanswered submission is UNVERIFIED, and says so in those terms", () => {
  // An operator who believes a stow committed and walks away has left the warehouse in a state
  // nobody recorded. This wording is the whole point of the module.
  const q = markUnverified(queueOf("k1"), "k1");
  assert.equal(q[0].state, SUBMISSION_STATE.UNVERIFIED);
  assert.match(SUBMISSION_STATE_TEXT[SUBMISSION_STATE.UNVERIFIED], /not confirmed/i);
  assert.match(SUBMISSION_STATE_TEXT[SUBMISSION_STATE.UNVERIFIED], /do not assume/i);
});

test("UNVERIFIED is NEVER re-sent automatically", () => {
  // We do not know whether the first attempt landed. Hammering an unknown is how one stow becomes
  // two.
  const q = markUnverified(queueOf("k1"), "k1");
  assert.deepEqual(nextBatch(q), []);
});

test("UNVERIFIED counts as OUTSTANDING — the operator has unfinished business", () => {
  const s = summarize(markUnverified(queueOf("k1"), "k1"));
  assert.equal(s.unverified, 1);
  assert.equal(s.outstanding, true);
});

// ═══════════════════════════════════════════ reconnection is a READ, not a re-send

test("resolving UNVERIFIED against a server that HAS it confirms, without re-sending", () => {
  const q = resolveUnverified(markUnverified(queueOf("k1"), "k1"), "k1", true);
  assert.equal(q[0].state, SUBMISSION_STATE.CONFIRMED);
  assert.deepEqual(nextBatch(q), []);
});

test("resolving against a server that does NOT have it makes it sendable again", () => {
  const q = resolveUnverified(markUnverified(queueOf("k1"), "k1"), "k1", false);
  assert.equal(q[0].state, SUBMISSION_STATE.PENDING);
  assert.equal(nextBatch(q).length, 1);
});

test("NOT KNOWING stays UNVERIFIED — it is its own answer, not a guess in either direction", () => {
  for (const unknown of [null, undefined]) {
    const q = resolveUnverified(markUnverified(queueOf("k1"), "k1"), "k1", unknown);
    assert.equal(q[0].state, SUBMISSION_STATE.UNVERIFIED, "an unanswerable check must not decide");
  }
});

// ═══════════════════════════════════════════ committed groups are never replayed

test("a CONFIRMED submission is never sent again", () => {
  const q = markConfirmed(queueOf("k1"), "k1");
  assert.deepEqual(nextBatch(q), []);
  assert.equal(isAlreadyConfirmed(q, "k1"), true);
});

test("a duplicate key cannot be enqueued — one physical act is one record", () => {
  const q = enqueue(queueOf("k1"), sub("k1"));
  assert.equal(q.length, 1);
});

test("a duplicate of a CONFIRMED key cannot resurrect it", () => {
  // A stale copy restored from storage in another tab must not put finished work back in flight.
  const confirmed = markConfirmed(queueOf("k1"), "k1");
  const q = enqueue(confirmed, sub("k1"));
  assert.equal(q.length, 1);
  assert.equal(q[0].state, SUBMISSION_STATE.CONFIRMED);
});

test("pruning clears CONFIRMED work but KEEPS rejections — those need a human", () => {
  let q = queueOf("k1", "k2");
  q = markConfirmed(q, "k1");
  q = markFailed(q, "k2", "permission-denied");
  const pruned = pruneConfirmed(q);
  assert.deepEqual(pruned.map((s) => s.idempotencyKey), ["k2"]);
});

// ═══════════════════════════════════════════ a refusal is not a retry

test("a REFUSAL is terminal — retrying will not turn a no into a yes", () => {
  for (const code of TERMINAL_ERROR_CODES) {
    const q = markFailed(queueOf("k1"), "k1", code);
    assert.equal(q[0].state, SUBMISSION_STATE.REJECTED, `${code} must not be retried forever`);
    assert.deepEqual(nextBatch(q), [], `${code} must not be re-sent`);
  }
});

test("anything else is RETRYABLE — the safe direction", () => {
  // Retrying a transient failure costs one request; giving up on one loses the operator's work.
  for (const code of ["unavailable", "internal", "deadline-exceeded", "aborted", "unknown-thing", undefined]) {
    const q = markFailed(queueOf("k1"), "k1", code);
    assert.equal(q[0].state, SUBMISSION_STATE.FAILED, `${String(code)} should stay retryable`);
    assert.equal(nextBatch(q).length, 1);
  }
});

test("a rejection is NOT counted as a completion", () => {
  // A queue summary that added them together would let one refusal hide in a tally of successes.
  const s = summarize(markFailed(queueOf("k1"), "k1", "permission-denied"));
  assert.equal(s.rejected, 1);
  assert.equal(s.confirmed, 0);
  assert.equal(s.outstanding, false, "a rejection is settled, but it is not a success");
});

test("the last error is kept, so a rejection can be explained", () => {
  const q = markFailed(queueOf("k1"), "k1", "failed-precondition");
  assert.equal(q[0].lastError, "failed-precondition");
});

// ═══════════════════════════════════════════ conservative batching

test("a batch is SMALL — a phone leaving a dead zone must not open forty requests", () => {
  // That is how a marginal link becomes a failed one, and how a server sees a burst it cannot
  // distinguish from an attack.
  const many = Array.from({ length: 40 }, (_, i) => `k${i}`);
  assert.equal(nextBatch(queueOf(...many)).length, MAX_BATCH);
  assert.ok(MAX_BATCH <= 10, "the cap must stay conservative");
});

test("attempts are counted, so a stuck submission is visible", () => {
  let q = markFailed(queueOf("k1"), "k1", "unavailable");
  q = markFailed(q, "k1", "unavailable");
  assert.equal(q[0].attempts, 2);
});

// ═══════════════════════════════════════════ it never interprets a submission

test("the queue cannot read a payload, and knows no domain vocabulary", () => {
  // A queue that understood payloads would start making domain decisions — combining stows,
  // reordering counts — with none of the authority to do so.
  const src = readFileSync(new URL("../src/domain/offlineSubmissionQueue.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/payload\./, /\.quantity/, /partId/, /binCode/, /serialNumbers/, /merge/i]) {
    assert.doesNotMatch(code, forbidden, `the queue must not know about ${forbidden}`);
  }
});

test("the payload is carried EXACTLY, never rewritten", () => {
  const payload = { partId: "PRT-1001", quantity: 3, nested: { a: [1, 2] } };
  const s = makeSubmission({ callable: "recordPutAway", payload, idempotencyKey: "k1" }).value;
  assert.deepEqual(s.payload, payload);
});

test("a submission carries the operation's OWN idempotency key", () => {
  // The same key the command derives its document id from, so a replay lands on the same record
  // rather than a second one.
  const s = sub("plc_stow_abc__PRT-1001");
  assert.equal(s.idempotencyKey, "plc_stow_abc__PRT-1001");
});

test("a submission without a callable or a key is refused", () => {
  assert.equal(makeSubmission({ idempotencyKey: "k1" }).valid, false);
  assert.equal(makeSubmission({ callable: "x" }).valid, false);
  assert.equal(makeSubmission({ callable: " ", idempotencyKey: "k1" }).valid, false);
});

test("a submission gets a legible label even when none is given", () => {
  // A queue of pending work has to be readable without decoding payloads.
  assert.equal(sub("k1").describe, "recordPutAway");
  assert.equal(sub("k1", { describe: "Stow 3 into A-14" }).describe, "Stow 3 into A-14");
});

// ═══════════════════════════════════════════ purity

test("every operation returns a NEW queue and mutates nothing", () => {
  const q = queueOf("k1");
  const before = JSON.stringify(q);
  markUnverified(q, "k1");
  markConfirmed(q, "k1");
  markFailed(q, "k1", "unavailable");
  enqueue(q, sub("k2"));
  assert.equal(JSON.stringify(q), before);
});

test("queues and entries are frozen", () => {
  const q = queueOf("k1");
  assert.throws(() => { q.push(sub("k2")); }, TypeError);
  assert.throws(() => { q[0].state = SUBMISSION_STATE.CONFIRMED; }, TypeError);
});

test("an empty or missing queue is handled without throwing", () => {
  for (const empty of [undefined, null, []]) {
    assert.deepEqual(nextBatch(empty), []);
    assert.equal(summarize(empty).outstanding, false);
    assert.equal(isAlreadyConfirmed(empty, "k1"), false);
  }
});

test("every state has words, and none shares a sentence", () => {
  const texts = Object.values(SUBMISSION_STATE).map((s) => SUBMISSION_STATE_TEXT[s]);
  assert.equal(texts.filter(Boolean).length, Object.keys(SUBMISSION_STATE).length);
  assert.equal(new Set(texts).size, texts.length);
});
