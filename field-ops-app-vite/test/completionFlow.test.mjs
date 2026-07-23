// F-RULES-1 PR-B -- tests for the trusted Field Mode completion flow.
// Run: node test/completionFlow.test.mjs   (also `npm test`)
//
// Two layers, per this repo's plain-node test convention (no DOM/JSX
// tooling exists here):
//  1. behavioral tests of the PURE flow module (src/domain/completionFlow.js)
//     -- request contract, idempotency-key lifecycle, error mapping,
//     ambiguous-result recovery, and the direct-write regression (the flow
//     can invoke ONLY the injected callable effect);
//  2. structural source-text assertions on the impure integration files
//     (services/completionService.js, modules/mobile/FieldMode.jsx,
//     config/trustedCompletion.js) for the properties a pure test cannot
//     reach: no Firestore-write imports, duplicate-tap guard, accessibility
//     attributes, release-gate wiring, and the untouched assigned ->
//     in_progress direct transition.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMPLETE_ASSIGNED_JOB,
  newIdempotencyKey,
  isValidIdempotencyKey,
  completionStorageKey,
  buildCompletionRequest,
  validateCompletionResponse,
  mapCompletionError,
  resolvePendingAttempt,
  runCompletion,
  COMPLETION_ERROR,
} from "../src/domain/completionFlow.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

// In-memory key store + call recorder used across the runCompletion tests.
function harness({ callImpl } = {}) {
  const store = { key: null };
  const calls = [];
  const otherEffects = [];
  return {
    calls,
    otherEffects,
    store,
    deps: {
      jobId: "job-1",
      call: (req) => {
        calls.push(req);
        return callImpl ? callImpl(req) : Promise.resolve({ jobId: "job-1", status: "complete", idempotentReplay: false });
      },
      getStoredKey: () => store.key,
      storeKey: (k) => { store.key = k; },
      clearKey: () => { store.key = null; },
      makeKey: () => newIdempotencyKey(() => "11111111-2222-3333-4444-555555555555"),
    },
  };
}

function callableError(code) {
  const e = new Error(`callable failed: ${code}`);
  e.code = code;
  return e;
}

// ---- idempotency key ------------------------------------------------------

ok("generated key is 8-200 chars of the backend-approved charset and not clock-derived", () => {
  const key = newIdempotencyKey(() => "abc-123-def-456");
  assert.equal(key, "cmpl-abc-123-def-456");
  assert.ok(isValidIdempotencyKey(key));
  // derived from injected randomness only -- same input, same key (no Date use)
  assert.equal(newIdempotencyKey(() => "abc-123-def-456"), key);
});

ok("storage scoping is user + job + operation", () => {
  assert.equal(completionStorageKey("u1", "j1"), "completeAssignedJob:u1:j1");
  assert.notEqual(completionStorageKey("u1", "j1"), completionStorageKey("u2", "j1"));
  assert.notEqual(completionStorageKey("u1", "j1"), completionStorageKey("u1", "j2"));
  assert.throws(() => completionStorageKey("", "j1"));
});

// ---- request contract (gate 13.4-13.7) -------------------------------------

ok("request contains exactly jobId and idempotencyKey -- nothing else is representable", () => {
  const req = buildCompletionRequest("job-9", "cmpl-abcdefgh");
  assert.deepEqual(Object.keys(req).sort(), ["idempotencyKey", "jobId"]);
  assert.deepEqual(req, { jobId: "job-9", idempotencyKey: "cmpl-abcdefgh" });
  // workOrderId / technicianId / targetState are not parameters at all:
  assert.equal(buildCompletionRequest.length, 2);
});

ok("invalid inputs are rejected client-side", () => {
  assert.throws(() => buildCompletionRequest("", "cmpl-abcdefgh"));
  assert.throws(() => buildCompletionRequest("job-9", "short"));
  assert.throws(() => buildCompletionRequest("job-9", "bad key!"));
});

// ---- response validation ---------------------------------------------------

ok("response is validated defensively; mismatch is ambiguous, not success", () => {
  assert.deepEqual(
    validateCompletionResponse({ jobId: "j", status: "complete", idempotentReplay: true }, "j"),
    { jobId: "j", status: "complete", idempotentReplay: true },
  );
  for (const bad of [
    null,
    {},
    { jobId: "OTHER", status: "complete", idempotentReplay: false },
    { jobId: "j", status: "completed", idempotentReplay: false },
    { jobId: "j", status: "complete" },
  ]) {
    assert.throws(() => validateCompletionResponse(bad, "j"));
  }
});

// ---- error mapping (gate 13.15-13.19) --------------------------------------

ok("authoritative rejections release the key and demand refresh, transient retains it", () => {
  for (const code of ["permission-denied", "invalid-argument", "not-found", "failed-precondition"]) {
    const m = mapCompletionError(code);
    assert.equal(m.kind, COMPLETION_ERROR.REJECTED, code);
    assert.equal(m.retainKey, false, code);
    assert.equal(m.refresh, true, code);
  }
  const conflict = mapCompletionError("already-exists");
  assert.equal(conflict.kind, COMPLETION_ERROR.CONFLICT);
  assert.equal(conflict.retainKey, false);
  assert.equal(conflict.refresh, true);
  const auth = mapCompletionError("unauthenticated");
  assert.equal(auth.kind, COMPLETION_ERROR.AUTH);
  assert.equal(auth.retainKey, true);
  for (const code of ["unavailable", "deadline-exceeded", "internal", "totally-unknown", undefined]) {
    const m = mapCompletionError(code);
    assert.equal(m.kind, COMPLETION_ERROR.TRANSIENT, String(code));
    assert.equal(m.retainKey, true, String(code));
  }
  // firebase-js prefixed form accepted too
  assert.equal(mapCompletionError("functions/permission-denied").kind, COMPLETION_ERROR.REJECTED);
});

ok("error messages are user-safe: no identities, paths, or raw backend detail", () => {
  for (const code of ["permission-denied", "failed-precondition", "already-exists", "not-found", "unavailable", "unauthenticated", "invalid-argument"]) {
    const m = mapCompletionError(code);
    assert.ok(m.message.length > 0 && m.message.length < 160);
    assert.doesNotMatch(m.message, /technician|uid|firestore|collection|fieldops|audit|stack|Error:/i, code);
  }
});

// ---- ambiguous-result recovery (gate 13.20-13.21) --------------------------

ok("pending attempt resolution follows authoritative job state", () => {
  assert.deepEqual(resolvePendingAttempt("complete"), { resolution: "success", clearKey: true });
  assert.deepEqual(resolvePendingAttempt("in_progress"), { resolution: "retry", clearKey: false });
  assert.deepEqual(resolvePendingAttempt("assigned"), { resolution: "halt", clearKey: true });
  assert.deepEqual(resolvePendingAttempt("open"), { resolution: "halt", clearKey: true });
  assert.deepEqual(resolvePendingAttempt(undefined), { resolution: "halt", clearKey: true });
});

// ---- runCompletion orchestration -------------------------------------------

await okAsync("happy path: one callable request with exactly the contract fields; key cleared on success", async () => {
  const h = harness();
  const outcome = await runCompletion(h.deps);
  assert.deepEqual(outcome, { ok: true, idempotentReplay: false });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(Object.keys(h.calls[0]).sort(), ["idempotencyKey", "jobId"]);
  assert.equal(h.calls[0].jobId, "job-1");
  assert.ok(isValidIdempotencyKey(h.calls[0].idempotencyKey));
  assert.equal(h.store.key, null, "key must be cleared after confirmed success");
});

await okAsync("idempotentReplay:true is success", async () => {
  const h = harness({ callImpl: () => Promise.resolve({ jobId: "job-1", status: "complete", idempotentReplay: true }) });
  const outcome = await runCompletion(h.deps);
  assert.deepEqual(outcome, { ok: true, idempotentReplay: true });
});

await okAsync("transient failure retains the SAME key; retry reuses it (no new attempt)", async () => {
  let fail = true;
  const h = harness({
    callImpl: () => (fail
      ? Promise.reject(callableError("unavailable"))
      : Promise.resolve({ jobId: "job-1", status: "complete", idempotentReplay: true })),
  });
  const first = await runCompletion(h.deps);
  assert.equal(first.ok, false);
  assert.equal(first.kind, COMPLETION_ERROR.TRANSIENT);
  const retainedKey = h.store.key;
  assert.ok(isValidIdempotencyKey(retainedKey), "key retained after transient failure");
  fail = false;
  const second = await runCompletion(h.deps);
  assert.equal(second.ok, true);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].idempotencyKey, retainedKey, "retry must reuse the SAME key");
  assert.equal(h.store.key, null);
});

await okAsync("authoritative rejection releases the key; a NEW attempt then gets a NEW key", async () => {
  let calls = 0;
  const h = harness({
    callImpl: () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(callableError("failed-precondition"))
        : Promise.resolve({ jobId: "job-1", status: "complete", idempotentReplay: false });
    },
  });
  // makeKey returns distinct keys per invocation for this harness
  let n = 0;
  h.deps.makeKey = () => newIdempotencyKey(() => `0000000${++n}-aaaa-bbbb-cccc-dddddddddddd`);
  const first = await runCompletion(h.deps);
  assert.equal(first.ok, false);
  assert.equal(first.kind, COMPLETION_ERROR.REJECTED);
  assert.equal(first.refresh, true, "authoritative rejection triggers state refresh");
  assert.equal(h.store.key, null, "rejected attempt releases its key");
  const second = await runCompletion(h.deps);
  assert.equal(second.ok, true);
  assert.notEqual(h.calls[1].idempotencyKey, h.calls[0].idempotencyKey, "new attempt, new key");
});

await okAsync("already-exists (conflicting key reuse) reconciles rather than blind same-key retry", async () => {
  const h = harness({ callImpl: () => Promise.reject(callableError("already-exists")) });
  const outcome = await runCompletion(h.deps);
  assert.equal(outcome.kind, COMPLETION_ERROR.CONFLICT);
  assert.equal(outcome.refresh, true);
  assert.equal(h.store.key, null, "conflicted key is abandoned, not blindly retried");
});

await okAsync("unauthenticated maps to auth recovery and never fabricates completion", async () => {
  const h = harness({ callImpl: () => Promise.reject(callableError("unauthenticated")) });
  const outcome = await runCompletion(h.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, COMPLETION_ERROR.AUTH);
  assert.ok(isValidIdempotencyKey(h.store.key), "attempt stays pending across re-auth");
});

await okAsync("malformed response is treated as unknown outcome: key kept, no success claimed", async () => {
  const h = harness({ callImpl: () => Promise.resolve({ jobId: "job-1", status: "completed?", idempotentReplay: "yes" }) });
  const outcome = await runCompletion(h.deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, COMPLETION_ERROR.TRANSIENT);
  assert.ok(isValidIdempotencyKey(h.store.key));
});

await okAsync("DIRECT-WRITE REGRESSION: the flow's only mutation-capable effect is the injected callable", async () => {
  // Every effect the flow can reach is injected here; a spy records any
  // invocation. The flow must invoke `call` exactly once and NOTHING that
  // could write Firestore (there is no such dependency to inject at all --
  // asserted structurally below too).
  const h = harness();
  const depNames = Object.keys(h.deps).sort();
  assert.deepEqual(depNames, ["call", "clearKey", "getStoredKey", "jobId", "makeKey", "storeKey"]);
  await runCompletion(h.deps);
  assert.equal(h.calls.length, 1);
});

// ---- structural assertions on the impure integration files -----------------

const svc = readFileSync(new URL("../src/services/completionService.js", import.meta.url), "utf8");
const fieldMode = readFileSync(new URL("../src/modules/mobile/FieldMode.jsx", import.meta.url), "utf8");
const gate = readFileSync(new URL("../src/config/trustedCompletion.js", import.meta.url), "utf8");
const flowSrc = readFileSync(new URL("../src/domain/completionFlow.js", import.meta.url), "utf8");

// Comments are documentation, not code -- the write-API assertions must
// only see executable source.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/[^\n]*$/gm, "");
}

ok("completionService/completionFlow perform no direct Firestore write and no client audit write", () => {
  for (const [name, src] of [["completionService", stripComments(svc)], ["completionFlow", stripComments(flowSrc)]]) {
    assert.doesNotMatch(src, /updateDoc|setDoc|deleteDoc|runTransaction|writeBatch|addDoc/, name);
    assert.doesNotMatch(src, /jobActions/, name);
    assert.doesNotMatch(src, /auditEvent/i, `${name} must not write audit data client-side`);
    assert.doesNotMatch(src, /TECHNICIANS_COLLECTION|fieldops_technicians/, `${name} must not touch technician records`);
  }
  assert.match(svc, /httpsCallable\(functions, COMPLETE_ASSIGNED_JOB\)/);
});

ok("no workOrderId is ever sent by the completion client", () => {
  assert.doesNotMatch(stripComments(svc), /workOrderId/);
  // completionFlow mentions workOrderId only in the explanatory comment
  // distinguishing it from jobId -- never as code:
  assert.doesNotMatch(stripComments(flowSrc), /workOrderId/m);
});

ok("FieldMode routes completion through the trusted flow behind the release gate", () => {
  assert.match(fieldMode, /TRUSTED_COMPLETION_ENABLED/);
  assert.match(fieldMode, /completeAssignedJobViaCallable/);
  // the ONLY updateJobStatus(...COMPLETE) call sits in the legacy pre-D1
  // branch (the early-return when the gate is off):
  const completeCalls = fieldMode.match(/updateStatus\(job, JOB_STATUS\.COMPLETE\)/g) ?? [];
  assert.equal(completeCalls.length, 1, "exactly one legacy completion call, in the gated branch");
  const gateBranch = fieldMode.slice(fieldMode.indexOf("if (!TRUSTED_COMPLETION_ENABLED)"));
  assert.ok(gateBranch.indexOf("updateStatus(job, JOB_STATUS.COMPLETE)") >= 0);
  assert.ok(
    gateBranch.indexOf("updateStatus(job, JOB_STATUS.COMPLETE)") <
      gateBranch.indexOf("completeAssignedJobViaCallable"),
    "legacy call appears only inside the release-gate early return",
  );
});

ok("assigned -> in_progress remains the unchanged direct client transition", () => {
  assert.match(fieldMode, /onUpdateStatus\(job, JOB_STATUS\.IN_PROGRESS\)/);
});

ok("duplicate-tap guard, pending state, and accessibility attributes present", () => {
  assert.match(fieldMode, /completion\.phase === "pending"\) return/, "in-flight guard");
  assert.match(fieldMode, /disabled=\{completing\}/, "button disabled while pending");
  assert.match(fieldMode, /aria-busy=\{completing\}/, "loading announced");
  assert.match(fieldMode, /role="alert"/, "errors associated with the action");
  assert.match(fieldMode, /Retry completion/, "retry control present");
});

ok("completion button is only rendered for an in_progress job", () => {
  // The ASSIGNED branch of ActiveJobActions returns before the IN_PROGRESS
  // section that renders the completion button.
  const assignedBranch = fieldMode.slice(
    fieldMode.indexOf("if (job.status === JOB_STATUS.ASSIGNED)"),
    fieldMode.indexOf("// IN_PROGRESS"),
  );
  assert.ok(assignedBranch.length > 0);
  assert.doesNotMatch(assignedBranch, /Complete Job|onComplete\(/);
});

ok("release gate is ACTIVE (Gate D1): trusted completion enabled everywhere", () => {
  // Flipped by the D1 release change after completeAssignedJob was deployed
  // and smoke-verified -- the trusted path is now the production path.
  assert.match(stripComments(gate), /TRUSTED_COMPLETION_ENABLED = true/);
  assert.doesNotMatch(stripComments(gate), /import\.meta\.env\.DEV/, "the pre-D1 conditional gate must be gone from code");
});

console.log(`\ncompletionFlow: ${passed} passed, 0 failed`);
