// THE EOS LOGIN CLIENT (browser half of the human front door), under plain node with a fake fetch.
// docs/architecture/eos-native-identity.md, section 3(e). Owner corrections 2026-10-11: no refresh token in any browser
// storage; the access token in memory only; cookie-backed refresh with the CSRF header; cross-tab serialisation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEosLoginClient, eosHumanLoginEnabled, eosLoginMessage, REFRESH_LEAD_MS, REQUEST_TIMEOUT_MS, CSRF_HEADER } from "../src/auth/eosLoginClient.js";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const accessToken = (expMs, n = 0, sub = `user.${"ab".repeat(16)}`) =>
  `${b64url({ alg: "EdDSA", typ: "JWT", kid: "nonprod-x" })}.${b64url({ sub, exp: Math.floor(expMs / 1000), jti: `j${n}`, sid: "s".repeat(32) })}.${"A".repeat(86)}`;

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
const session = (n, expMs = NOW + 300_000) => ({ accessToken: accessToken(expMs, n), mfaEnrollmentRequired: false, sessionId: "s".repeat(32) });

/** A storage spy: the client must never touch it. */
function installStorageSpies() {
  const touched = [];
  const spy = { getItem: (k) => { touched.push(k); return null; }, setItem: (k) => touched.push(k), removeItem: (k) => touched.push(k) };
  globalThis.window = { sessionStorage: spy, localStorage: spy };
  globalThis.sessionStorage = spy;
  globalThis.localStorage = spy;
  return touched;
}

test("enabled only with the build flag, and never in a production build", () => {
  assert.equal(eosHumanLoginEnabled({ flag: "enabled", role: "nonprod" }), true);
  assert.equal(eosHumanLoginEnabled({ flag: "enabled", role: "production" }), false);
  assert.equal(eosHumanLoginEnabled({ flag: undefined, role: "nonprod" }), false);
  assert.equal(eosHumanLoginEnabled({ flag: "true", role: "nonprod" }), false);
});

test("login keeps the access token in MEMORY only; no browser storage is touched; every call sends the CSRF header and the cookie", async () => {
  const touched = installStorageSpies();
  const { fetchImpl, calls } = fakeServer({
    "/auth/login": (b) => (b.identifier === "mfa@x.test"
      ? [200, { ok: true, status: "MFA_REQUIRED", challenge: "eosmc_c", challengeExpiresAt: "x", methods: ["totp"] }]
      : [200, { ok: true, status: "AUTHENTICATED", session: session(1) }]),
    "/auth/login/mfa": () => [200, { ok: true, status: "AUTHENTICATED", session: session(2) }],
  });
  const c = createEosLoginClient({ fetchImpl, baseUrl: "https://api.test/", now: () => NOW, locks: null });
  const mfa = await c.login("mfa@x.test", "pw");
  assert.deepEqual(mfa, { status: "MFA_REQUIRED", challenge: "eosmc_c", methods: ["totp"] });
  assert.equal(c.currentSession(), null);
  await c.completeMfa("eosmc_c", { code: "123456" });
  assert.equal(c.currentSession().token, accessToken(NOW + 300_000, 2));
  await c.login("a@x.test", "pw");
  assert.equal(c.currentSession().subject, `user.${"ab".repeat(16)}`);
  assert.deepEqual(touched, [], "no sessionStorage / localStorage access at all");
  assert.ok(calls.every((x) => x.credentials === "include" && x.headers[CSRF_HEADER] === "1" && x.headers["content-type"] === "application/json"));
  assert.ok(calls.every((x) => !("refreshToken" in x.body)), "the client never sends a refresh token in a body");
  delete globalThis.window; delete globalThis.sessionStorage; delete globalThis.localStorage;
});

test("refusals surface the server's code and detail; network failure is NETWORK; no base URL is NOT_CONFIGURED", async () => {
  const { fetchImpl } = fakeServer({ "/auth/login": () => [401, { ok: false, code: "LOGIN_REFUSED" }],
    "/auth/enrollment/complete": () => [400, { ok: false, code: "PASSWORD_POLICY", detail: "PASSWORD_TOO_SHORT" }] });
  const c = createEosLoginClient({ fetchImpl, baseUrl: "https://api.test", locks: null });
  await assert.rejects(c.login("a", "b"), (e) => e.code === "LOGIN_REFUSED" && e.status === 401);
  await assert.rejects(c.completeEnrollment("eoset_x", "short"), (e) => e.code === "PASSWORD_POLICY" && e.detail === "PASSWORD_TOO_SHORT");
  const down = createEosLoginClient({ fetchImpl: async () => { throw new Error("offline"); }, baseUrl: "https://api.test", locks: null });
  await assert.rejects(down.login("a", "b"), (e) => e.code === "NETWORK");
  const none = createEosLoginClient({ fetchImpl, baseUrl: "", locks: null });
  await assert.rejects(none.login("a", "b"), (e) => e.code === "NOT_CONFIGURED");
  assert.match(eosLoginMessage("PASSWORD_POLICY", "PASSWORD_TOO_SHORT"), /12 characters/);
  assert.ok(!eosLoginMessage("LOGIN_REFUSED").includes("password was wrong"), "the message never says which part failed");
});

test("freshAccessToken: in-memory token used while it has life; refreshed by cookie ONCE for concurrent callers; restore after reload", async () => {
  let refreshes = 0;
  const { fetchImpl, calls } = fakeServer({
    "/auth/refresh": async (b) => { refreshes += 1; assert.deepEqual(b, {}); await new Promise((r) => setTimeout(r, 5)); return [200, { ok: true, session: session(10 + refreshes) }]; },
    "/auth/login": () => [200, { ok: true, status: "AUTHENTICATED", session: session(1) }],
  });
  let now = NOW;
  const c = createEosLoginClient({ fetchImpl, baseUrl: "https://api.test", now: () => now, locks: null });
  // A "reload": nothing in memory, the cookie decides.
  assert.equal(await c.freshAccessToken(), accessToken(NOW + 300_000, 11));
  await c.login("a@x.test", "pw");
  const before = calls.length;
  assert.equal(await c.freshAccessToken(), accessToken(NOW + 300_000, 1));
  assert.equal(calls.length, before, "no refresh while the token has life");
  now = NOW + 300_000 - REFRESH_LEAD_MS + 1;
  const [a, b] = await Promise.all([c.freshAccessToken(), c.freshAccessToken()]);
  assert.equal(refreshes, 2, "single-flight within the tab");
  assert.equal(a, b);
});

test("cross-tab: refreshes are serialised by the Web Lock; a SUPERSEDED answer is retried once with the sibling's cookie", async () => {
  const lockOrder = [];
  let held = Promise.resolve();
  const locks = { request: (name, fn) => { lockOrder.push(name); const run = held.then(fn); held = run.catch(() => {}); return run; } };
  let n = 0;
  const { fetchImpl } = fakeServer({
    "/auth/refresh": () => { n += 1; return n === 1 ? [409, { ok: false, code: "REFRESH_SUPERSEDED" }] : [200, { ok: true, session: session(20 + n) }]; },
  });
  const c = createEosLoginClient({ fetchImpl, baseUrl: "https://api.test", now: () => NOW, locks });
  assert.equal(await c.refresh(), accessToken(NOW + 300_000, 22));
  assert.deepEqual(lockOrder, ["eos-login-refresh"]);
  assert.equal(n, 2, "one retry after SUPERSEDED");
});

test("a REFUSED refresh ends the in-memory session and notifies; a network failure keeps it", async () => {
  let mode = "ok";
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/auth/login") return { ok: true, status: 200, json: async () => ({ ok: true, status: "AUTHENTICATED", session: session(1) }) };
    if (mode === "network") throw new Error("offline");
    return { ok: false, status: 401, json: async () => ({ ok: false, code: "REFRESH_REFUSED" }) };
  };
  const c = createEosLoginClient({ fetchImpl, baseUrl: "https://api.test", now: () => NOW, locks: null });
  const seen = [];
  c.subscribe((s) => seen.push(s === null ? null : "session"));
  await c.login("a", "b");
  mode = "network";
  assert.equal(await c.refresh(), null);
  assert.ok(c.currentSession(), "network failure: the token keeps whatever life it has");
  mode = "refused";
  assert.equal(await c.refresh(), null);
  assert.equal(c.currentSession(), null);
  assert.deepEqual(seen, ["session", null]);
});

test("logout forgets locally first, then revokes on the server with the cookie (best effort)", async () => {
  const { fetchImpl, calls } = fakeServer({
    "/auth/login": () => [200, { ok: true, status: "AUTHENTICATED", session: session(1) }],
    "/auth/logout": () => [200, { ok: true }],
  });
  const c = createEosLoginClient({ fetchImpl, baseUrl: "https://api.test", now: () => NOW, locks: null });
  await c.login("a", "b");
  await c.logout();
  assert.equal(c.currentSession(), null);
  const out = calls.find((x) => x.path === "/auth/logout");
  assert.equal(out.credentials, "include");
  assert.deepEqual(out.body, {});
});

test("self-service calls carry the access token; a password change adopts the fresh session it returns", async () => {
  const { fetchImpl, calls } = fakeServer({
    "/auth/login": () => [200, { ok: true, status: "AUTHENTICATED", session: session(1) }],
    "/auth/account": () => [200, { ok: true, account: { loginIdentifier: "a@x.test" } }],
    "/auth/password/change": () => [200, { ok: true, session: session(5) }],
    "/auth/refresh": () => [401, { ok: false, code: "REFRESH_REFUSED" }],
  });
  const c = createEosLoginClient({ fetchImpl, baseUrl: "https://api.test", now: () => NOW, locks: null });
  await assert.rejects(c.describeAccount(), (e) => e.code === "SESSION_INVALID");
  await c.login("a", "b");
  assert.equal((await c.describeAccount()).loginIdentifier, "a@x.test");
  assert.match(calls.find((x) => x.path === "/auth/account").headers.authorization, /^Bearer ey/);
  await c.changePassword("old", "new");
  assert.equal(c.currentSession().token, accessToken(NOW + 300_000, 5));
});

test("a request that never answers is abandoned as NETWORK, and a first-load refresh settles signed out (never an endless wait)", async () => {
  const signals = [];
  // A transport that ignores the abort signal entirely, and one that honours it: both are bounded.
  const never = (_url, init) => { signals.push(init.signal); return new Promise(() => {}); };
  const honours = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  for (const fetchImpl of [never, honours]) {
    const c = createEosLoginClient({ fetchImpl, baseUrl: "https://api.test/", timeoutMs: 25, locks: null });
    await assert.rejects(c.login("a@x.test", "pw"), (e) => e.name === "EosLoginError" && e.code === "NETWORK");
    assert.equal(await c.refresh(), null, "a refresh that cannot reach the server settles with no session");
    assert.equal(c.currentSession(), null);
  }
  assert.ok(signals.every((s) => s && typeof s.aborted === "boolean"), "each request carried an AbortSignal");
  assert.ok(signals.every((s) => s.aborted === true), "and it was aborted at the bound");
  assert.equal(REQUEST_TIMEOUT_MS, 15_000);
});

test("the login client imports nothing from Firebase and references no browser storage", () => {
  const src = readFileSync(new URL("../src/auth/eosLoginClient.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\s+["'](firebase|@firebase)/);
  assert.doesNotMatch(src, /firebase\/firebase/);
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /sessionStorage|localStorage|document\.cookie/);
});
