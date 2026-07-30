// AUTH -- PURE unit tests for the native-sender OUTBOUND adapter (oobCodeOutbound.ts):
// non-sending config validation, the accounts:sendOobCode adapter (with a FAKE
// transport -- no network, no secret), and the fail-closed builder. No emulator, no
// Firebase, no real send.
//
// Prerequisite: npm run build. Then:
//   node functions/test/oobCodeOutbound.test.mjs
import assert from "node:assert/strict";
import {
  validateNativeSendConfig,
  createOobCodeOutbound,
  buildNativeResetSender,
} from "../lib/access/oobCodeOutbound.js";

const VALID = { apiKey: "AIzaTESTKEY_1234567890abcdef", project: "demo-project", apiKeyProject: "demo-project" };

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }
async function okAsync(name, fn) { await fn(); passed += 1; console.log("PASS -- " + name); }

// -- non-sending validation --------------------------------------------------
ok("valid config (apiKeyProject === project) -> valid", () => {
  assert.deepStrictEqual(validateNativeSendConfig(VALID), { valid: true });
});
for (const [label, cfg] of [
  ["null", null],
  ["undefined", undefined],
  ["missing apiKey", { project: "p", apiKeyProject: "p" }],
  ["empty apiKey", { apiKey: "   ", project: "p", apiKeyProject: "p" }],
  ["whitespace in apiKey", { apiKey: "AIza has space 1234567890", project: "p", apiKeyProject: "p" }],
  ["too-short apiKey", { apiKey: "AIzaShort", project: "p", apiKeyProject: "p" }],
  ["missing project", { apiKey: "AIzaTESTKEY_1234567890abcdef", apiKeyProject: "p" }],
  ["missing project-ownership attestation", { apiKey: "AIzaTESTKEY_1234567890abcdef", project: "demo-project" }],
  ["attestation/project MISMATCH", { ...VALID, apiKeyProject: "some-other-project" }],
  ["arbitrary https endpoint override in config (exfiltration guard)", { ...VALID, endpoint: "https://attacker.test" }],
]) {
  ok(`invalid config: ${label} -> invalid`, () => {
    const v = validateNativeSendConfig(cfg);
    assert.strictEqual(v.valid, false, `${label} must be rejected`);
    assert.strictEqual(typeof v.reason, "string");
  });
}

// -- accounts:sendOobCode adapter (fake transport) ---------------------------
function fakeTransport(result) {
  const calls = [];
  const transport = async (url, init) => {
    calls.push({ url, init });
    if (result === "throw") throw new Error("transport boom");
    return result; // { ok, status }
  };
  return { transport, calls };
}

await okAsync("HTTP 200 -> accepted true; targets the APPROVED origin; PASSWORD_RESET + email; only { accepted }", async () => {
  const { transport, calls } = fakeTransport({ ok: true, status: 200 });
  const outbound = createOobCodeOutbound(VALID, transport);
  const res = await outbound({ targetUid: "t", email: "user@example.test", idempotencyKey: "k" });
  assert.deepStrictEqual(res, { accepted: true }, "returns ONLY { accepted }");
  assert.strictEqual(calls.length, 1);
  // Config cannot redirect: the adapter ALWAYS calls the approved Identity Toolkit origin.
  assert.match(calls[0].url, /^https:\/\/identitytoolkit\.googleapis\.com\/v1\/accounts:sendOobCode\?key=/);
  const body = JSON.parse(calls[0].init.body);
  assert.strictEqual(body.requestType, "PASSWORD_RESET");
  assert.strictEqual(body.email, "user@example.test");
  assert.deepStrictEqual(Object.keys(res), ["accepted"]);
});
await okAsync("non-200 (400) -> accepted false", async () => {
  const { transport } = fakeTransport({ ok: false, status: 400 });
  const outbound = createOobCodeOutbound(VALID, transport);
  assert.deepStrictEqual(await outbound({ targetUid: "t", email: "e@x.test", idempotencyKey: "k" }), { accepted: false });
});
await okAsync("ok:true but status !=200 -> accepted false (only HTTP 200 is truthful)", async () => {
  const { transport } = fakeTransport({ ok: true, status: 202 });
  const outbound = createOobCodeOutbound(VALID, transport);
  assert.deepStrictEqual(await outbound({ targetUid: "t", email: "e@x.test", idempotencyKey: "k" }), { accepted: false });
});
await okAsync("transport throws -> propagates (command/sender handle throw/uncertain)", async () => {
  const { transport } = fakeTransport("throw");
  const outbound = createOobCodeOutbound(VALID, transport);
  await assert.rejects(outbound({ targetUid: "t", email: "e@x.test", idempotencyKey: "k" }), /transport boom/);
});
await okAsync("no caller can redirect the origin (an endpoint field on config is ignored; approved origin used)", async () => {
  const { transport, calls } = fakeTransport({ ok: true, status: 200 });
  // Even if a rogue caller sneaks an `endpoint` onto the config object, the adapter has no
  // endpoint parameter and no config field for it, so it calls the approved origin. (And
  // validateNativeSendConfig rejects such a config outright.)
  const outbound = createOobCodeOutbound({ ...VALID, endpoint: "https://attacker.test" }, transport);
  await outbound({ targetUid: "t", email: "e@x.test", idempotencyKey: "k" });
  assert.match(calls[0].url, /^https:\/\/identitytoolkit\.googleapis\.com\//, "origin is fixed to the approved endpoint");
});

// -- fail-closed builder -----------------------------------------------------
ok("buildNativeResetSender(null) -> fail-closed (isConfigured false)", () => {
  assert.strictEqual(buildNativeResetSender(null).isConfigured(), false);
});
ok("buildNativeResetSender(invalid: missing fields) -> fail-closed", () => {
  assert.strictEqual(buildNativeResetSender({ project: "p" }).isConfigured(), false);
});
ok("buildNativeResetSender(attestation MISMATCH) -> fail-closed (no unproven-ownership config)", () => {
  const { transport } = fakeTransport({ ok: true, status: 200 });
  assert.strictEqual(buildNativeResetSender({ ...VALID, apiKeyProject: "other" }, transport).isConfigured(), false);
});
ok("buildNativeResetSender(endpoint override in config) -> fail-closed (exfiltration guard)", () => {
  const { transport } = fakeTransport({ ok: true, status: 200 });
  assert.strictEqual(buildNativeResetSender({ ...VALID, endpoint: "https://attacker.test" }, transport).isConfigured(), false);
});
ok("buildNativeResetSender(valid, fakeTransport) -> configured (isConfigured true)", () => {
  const { transport } = fakeTransport({ ok: true, status: 200 });
  assert.strictEqual(buildNativeResetSender(VALID, transport).isConfigured(), true);
});

console.log(`\n${passed} passed`);
