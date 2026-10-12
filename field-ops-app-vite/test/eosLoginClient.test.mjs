// THE EOS LOGIN CLIENT (browser half of the human front door), under plain node with a fake fetch and storage.
// docs/architecture/eos-native-identity.md, section 3(e).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEosLoginClient, eosHumanLoginEnabled, eosLoginMessage, EOS_REFRESH_STORAGE_KEY, REFRESH_LEAD_MS } from "../src/auth/eosLoginClient.js";
import { EOS_SESSION_STORAGE_KEY } from "../src/auth/eosSession.js";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const accessToken = (expMs, sub = `user.${"ab".repeat(16)}`) =>
  `${b64url({ alg: "EdDSA", typ: "JWT", kid: "nonprod-x" })}.${b64url({ sub, exp: Math.floor(expMs / 1000), sid: "s".repeat(32) })}.${"A".repeat(86)}`;
const refreshToken = (n) => `eosrt_${String(n).padStart(43, "R")}`;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

function fakeServer(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ path, body, headers: init.headers, credentials: init.credentials });
    const handler = routes[path];
    const [status, json] = handler ? await handler(body, init) : [404, { ok: false, code: "NOT_FOUND" }];
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return { fetchImpl, calls };
}

const NOW = 1_800_000_000_000;
const session = (n, expMs = NOW + 300_000) => ({ accessToken: accessToken(expMs), refreshToken: refreshToken(n), mfaEnrollmentRequired: false, sessionId: "s".repeat(32) });

test("enabled only with the build flag, and never in a production build", () => {
  assert.equal(eosHumanLoginEnabled({ flag: "enabled", role: "nonprod" }), true);
  assert.equal(eosHumanLoginEnabled({ flag: "enabled", role: "production" }), false);
  assert.equal(eosHumanLoginEnabled({ flag: undefined, role: "nonprod" }), false);
  assert.equal(eosHumanLoginEnabled({ flag: "true", role: "nonprod" }), false);
});

test("login: AUTHENTICATED stores both tokens; MFA_REQUIRED stores nothing; no cookies are sent", async () => {
  const storage = memoryStorage();
  const { fetchImpl, calls } = fakeServer({
    "/auth/login": (b) => (b.identifier === "mfa@x.test"
      ? [200, { ok: true, status: "MFA_REQUIRED", challenge: "eosmc_c", challengeExpiresAt: "x", methods: ["totp"] }]
      : [200, { ok: true, status: "AUTHENTICATED", session: session(1) }]),
    "/auth/login/mfa": () => [200, { ok: true, status: "AUTHENTICATED", session: session(2) }],
  });
  const c = createEosLoginClient({ fetchImpl, storage, baseUrl: "https://api.test/", now: () => NOW });
  const mfa = await c.login("mfa@x.test", "pw");
  assert.deepEqual(mfa, { status: "MFA_REQUIRED", challenge: "eosmc_c", methods: ["totp"] });
  assert.equal(storage._m.size, 0, "a challenge is never stored");
  await c.completeMfa("eosmc_c", { code: "123456" });
  assert.equal(storage.getItem(EOS_REFRESH_STORAGE_KEY), refreshToken(2));
  assert.deepEqual(calls[1].body, { challenge: "eosmc_c", code: "123456" });
  await c.login("a@x.test", "pw");
  assert.equal(storage.getItem(EOS_REFRESH_STORAGE_KEY), refreshToken(1));
  assert.ok(storage.getItem(EOS_SESSION_STORAGE_KEY).startsWith("ey"));
  assert.ok(calls.every((x) => x.credentials === "omit"));
  assert.equal(calls[0].path, "/auth/login");
});

test("refusals surface the server's code and detail; network failure is NETWORK; no base URL is NOT_CONFIGURED", async () => {
  const { fetchImpl } = fakeServer({ "/auth/login": () => [401, { ok: false, code: "LOGIN_REFUSED" }],
    "/auth/enrollment/complete": () => [400, { ok: false, code: "PASSWORD_POLICY", detail: "PASSWORD_TOO_SHORT" }] });
  const c = createEosLoginClient({ fetchImpl, storage: memoryStorage(), baseUrl: "https://api.test" });
  await assert.rejects(c.login("a", "b"), (e) => e.code === "LOGIN_REFUSED" && e.status === 401);
  await assert.rejects(c.completeEnrollment("eoset_x", "short"), (e) => e.code === "PASSWORD_POLICY" && e.detail === "PASSWORD_TOO_SHORT");
  const down = createEosLoginClient({ fetchImpl: async () => { throw new Error("offline"); }, storage: memoryStorage(), baseUrl: "https://api.test" });
  await assert.rejects(down.login("a", "b"), (e) => e.code === "NETWORK");
  const none = createEosLoginClient({ fetchImpl, storage: memoryStorage(), baseUrl: "" });
  await assert.rejects(none.login("a", "b"), (e) => e.code === "NOT_CONFIGURED");
  assert.match(eosLoginMessage("PASSWORD_POLICY", "PASSWORD_TOO_SHORT"), /12 characters/);
  assert.ok(!eosLoginMessage("LOGIN_REFUSED").includes("password was wrong"), "the message never says which part failed");
});

test("freshAccessToken: a token with time left is used as-is; one about to lapse is refreshed ONCE for concurrent callers", async () => {
  const storage = memoryStorage();
  let refreshes = 0;
  const { fetchImpl, calls } = fakeServer({
    "/auth/refresh": async (b) => { refreshes += 1; assert.equal(b.refreshToken, refreshToken(1)); await new Promise((r) => setTimeout(r, 5)); return [200, { ok: true, session: session(2) }]; },
  });
  let now = NOW;
  const c = createEosLoginClient({ fetchImpl, storage, baseUrl: "https://api.test", now: () => now });
  storage.setItem(EOS_SESSION_STORAGE_KEY, accessToken(NOW + 300_000));
  storage.setItem(EOS_REFRESH_STORAGE_KEY, refreshToken(1));
  assert.equal(await c.freshAccessToken(), accessToken(NOW + 300_000));
  assert.equal(calls.length, 0);
  now = NOW + 300_000 - REFRESH_LEAD_MS + 1;
  const [a, b] = await Promise.all([c.freshAccessToken(), c.freshAccessToken()]);
  assert.equal(refreshes, 1, "single-flight: a second exchange would be refresh-token REUSE and kill the session");
  assert.equal(a, b);
  assert.equal(storage.getItem(EOS_REFRESH_STORAGE_KEY), refreshToken(2));
});

test("a REFUSED refresh ends the local session; a network failure keeps it", async () => {
  const storage = memoryStorage();
  let mode = "network";
  const fetchImpl = async () => {
    if (mode === "network") throw new Error("offline");
    return { ok: false, status: 401, json: async () => ({ ok: false, code: "REFRESH_REFUSED" }) };
  };
  const c = createEosLoginClient({ fetchImpl, storage, baseUrl: "https://api.test", now: () => NOW });
  storage.setItem(EOS_REFRESH_STORAGE_KEY, refreshToken(1));
  assert.equal(await c.refresh(), null);
  assert.equal(storage.getItem(EOS_REFRESH_STORAGE_KEY), refreshToken(1));
  mode = "refused";
  assert.equal(await c.refresh(), null);
  assert.equal(storage.getItem(EOS_REFRESH_STORAGE_KEY), null);
});

test("logout clears locally first, then revokes on the server (best effort)", async () => {
  const storage = memoryStorage();
  const { fetchImpl, calls } = fakeServer({ "/auth/logout": () => [200, { ok: true }] });
  const c = createEosLoginClient({ fetchImpl, storage, baseUrl: "https://api.test", now: () => NOW });
  storage.setItem(EOS_SESSION_STORAGE_KEY, accessToken(NOW + 300_000));
  storage.setItem(EOS_REFRESH_STORAGE_KEY, refreshToken(9));
  await c.logout();
  assert.equal(storage._m.size, 0);
  assert.deepEqual(calls.map((x) => [x.path, x.body.refreshToken]), [["/auth/logout", refreshToken(9)]]);
});

test("self-service calls carry the access token; a password change stores the fresh session it returns", async () => {
  const storage = memoryStorage();
  const { fetchImpl, calls } = fakeServer({
    "/auth/account": () => [200, { ok: true, account: { loginIdentifier: "a@x.test" } }],
    "/auth/password/change": () => [200, { ok: true, session: session(5) }],
  });
  const c = createEosLoginClient({ fetchImpl, storage, baseUrl: "https://api.test", now: () => NOW });
  await assert.rejects(c.describeAccount(), (e) => e.code === "SESSION_INVALID");
  storage.setItem(EOS_SESSION_STORAGE_KEY, accessToken(NOW + 300_000));
  assert.equal((await c.describeAccount()).loginIdentifier, "a@x.test");
  assert.match(calls[0].headers.authorization, /^Bearer ey/);
  await c.changePassword("old", "new");
  assert.equal(storage.getItem(EOS_REFRESH_STORAGE_KEY), refreshToken(5));
});

test("the login client imports nothing from Firebase", () => {
  const src = readFileSync(new URL("../src/auth/eosLoginClient.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\s+["'](firebase|@firebase)/);
  assert.doesNotMatch(src, /firebase\/firebase/);
});
