// EOS PERSONA HARNESS TARGET ALLOWLIST -- offline proof, no network, synthetic secrets only.
// Run: node --test test/eosPersonaTargetAllowlist.test.mjs
//
// scripts/eosPersonaSession.mjs sends a password, an MFA code, a persona-issuer credential or a bearer token. It must
// send them ONLY to an exact, normalised, REGISTERED nonproduction EOS API (config/environments.json), with a browser
// origin from the SAME environment, validated BEFORE anything is sent, and never follow a redirect. Both paths
// (loginEosPersona = password + MFA, issueEosPersonaSession = machine issuer) share ONE validator, resolveEosTarget.
// Every fetch here is a stub that records each call; "no secret transmitted" is asserted against those records.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const client = await import(pathToFileURL(join(REPO, "scripts", "eosPersonaSession.mjs")).href);
const { issueEosPersonaSession, loginEosPersona, callEosApiAsPersona, resolveEosTargetFrom, clearEosPersonaSessionCache } = client;

const API = "https://eos-api-nonprod.onrender.com"; // registered: platform-sandbox eosApi.baseUrl
const APP = "https://verenwardeos.vercel.app"; // registered: platform-sandbox eosApplication surface
const PROD_SURFACE = "https://taylor-parts.web.app"; // registered: taylor-parts-production surface
const NOT_APP_SURFACE = "https://eos-platform-sandbox.web.app"; // registered sandbox surface, but eosApplication=false

// Synthetic values, none of them real. Any call that carries one of these has transmitted a secret.
const ISSUER_CREDENTIAL = "synthetic-issuer-credential-zz9";
const PASSWORD = "synthetic-password-zz9";
const TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SECRETS = [ISSUER_CREDENTIAL, PASSWORD, TOTP_SECRET];
const TOKEN = "a.b.c";

const credsFile = join(mkdtempSync(join(tmpdir(), "eos-target-allowlist-")), "creds.json");
writeFileSync(credsFile, JSON.stringify({ entries: [
  { personaKey: "dispatcher", state: "enrolled", loginIdentifier: "dispatcher@sandbox.invalid", password: PASSWORD, totpSecretBase32: TOTP_SECRET },
] }));

/** A fetch stub that records every call. `reply(url, init, n)` answers; default is a happy issuer/login. */
function stub(reply) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (reply) return reply(String(url), init, calls.length);
    if (String(url).endsWith("/auth/nonprod/persona-session")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, token: TOKEN, expiresAt: "2099-01-01T00:00:00Z", personaKey: "dispatcher", principalId: "pr-1" }) };
    }
    if (String(url).endsWith("/auth/login")) return { ok: true, status: 200, json: async () => ({ ok: true, status: "MFA_REQUIRED", challenge: "c1" }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, session: { accessToken: TOKEN, accessTokenExpiresAt: "2099-01-01T00:00:00Z" } }) };
  };
  return { fetch, calls };
}

const transmitted = (calls) => calls.some((c) => SECRETS.some((s) => JSON.stringify(c).includes(s)));

const issue = (opts) => issueEosPersonaSession("dispatcher", { env: {}, credential: ISSUER_CREDENTIAL, ...opts });
const login = (opts) => loginEosPersona("dispatcher", { env: {}, credentialsFile: credsFile, nowMs: 59_000, ...opts });
const BOTH = { issuer: issue, login };

const refusal = (code) => (e) => e?.name === "EosPersonaSessionError" && e.code === code;

test.beforeEach(() => clearEosPersonaSessionCache());

test("a registered nonprod endpoint succeeds on both paths, with separate proof labels and no redirect following", async () => {
  const a = stub();
  const issued = await issue({ baseUrl: API, fetch: a.fetch });
  assert.equal(issued.proof, "issuer-api");
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].url, `${API}/auth/nonprod/persona-session`);
  assert.equal(a.calls[0].init.redirect, "manual");

  const b = stub();
  const logged = await login({ baseUrl: API, origin: APP, fetch: b.fetch });
  assert.equal(logged.proof, "login-mfa");
  assert.equal(b.calls.length, 2);
  assert.equal(b.calls[0].url, `${API}/auth/login`);
  assert.equal(b.calls[0].init.headers.origin, APP);
  assert.ok(b.calls.every((c) => c.init.redirect === "manual"));

  // With no override at all, the registry supplies the API and the application origin.
  const c = stub();
  await login({ fetch: c.fetch });
  assert.equal(c.calls[0].init.headers.origin, APP);
  assert.equal(c.calls[0].url, `${API}/auth/login`);
});

test("a known production endpoint is refused before anything is sent", async () => {
  for (const [name, call] of Object.entries(BOTH)) {
    for (const opts of [
      { baseUrl: PROD_SURFACE },
      { environmentId: "taylor-parts-production" },
      { baseUrl: API, origin: PROD_SURFACE },
      { env: { EOS_API_BASE_URL: "https://taylor-parts.web.app/" } },
    ]) {
      const s = stub();
      await assert.rejects(call({ fetch: s.fetch, ...opts }), refusal("PRODUCTION_REFUSED"), `${name} ${JSON.stringify(opts)}`);
      assert.equal(s.calls.length, 0);
    }
  }
});

test("an unknown external endpoint is refused before anything is sent", async () => {
  for (const [name, call] of Object.entries(BOTH)) {
    for (const baseUrl of ["https://evil.example", "http://eos-api-nonprod.onrender.com", "https://eos-api-nonprod.onrender.com:8443", "https://localhost:8787"]) {
      const s = stub();
      await assert.rejects(call({ baseUrl, fetch: s.fetch }), (e) => e.code === "API_NOT_REGISTERED" || e.code === "INVALID_TARGET_URL", `${name} ${baseUrl}`);
      assert.equal(s.calls.length, 0);
    }
  }
});

test("an explicit API override to a non-registered URL is refused, whether it arrives as baseUrl or EOS_API_BASE_URL", async () => {
  for (const [name, call] of Object.entries(BOTH)) {
    const viaOption = stub();
    await assert.rejects(call({ baseUrl: "https://eos-api.test", fetch: viaOption.fetch }), refusal("API_NOT_REGISTERED"), name);
    const viaEnv = stub();
    await assert.rejects(call({ env: { EOS_API_BASE_URL: "https://eos-api.test" }, fetch: viaEnv.fetch }), refusal("API_NOT_REGISTERED"), name);
    assert.equal(viaOption.calls.length + viaEnv.calls.length, 0);
  }
  const t = stub();
  await assert.rejects(callEosApiAsPersona("dispatcher", "/x", {}, { env: {}, credential: ISSUER_CREDENTIAL, baseUrl: "https://eos-api.test", fetch: t.fetch }), refusal("API_NOT_REGISTERED"));
  assert.equal(t.calls.length, 0);
});

test("a browser-origin override that is not a registered EOS application surface is refused before anything is sent", async () => {
  for (const origin of ["https://evil.example", NOT_APP_SURFACE, "http://verenwardeos.vercel.app", `${APP}.evil.example`]) {
    const s = stub();
    await assert.rejects(login({ baseUrl: API, origin, fetch: s.fetch }), (e) => e.code === "ORIGIN_NOT_REGISTERED" || e.code === "INVALID_TARGET_URL", origin);
    assert.equal(s.calls.length, 0);
    assert.equal(transmitted(s.calls), false);
  }
  // The issuer sends no origin, but a supplied one is held to the same rule.
  const s = stub();
  await assert.rejects(issue({ baseUrl: API, origin: "https://evil.example", fetch: s.fetch }), refusal("ORIGIN_NOT_REGISTERED"));
  assert.equal(s.calls.length, 0);
});

test("a cross-environment API/origin mismatch is refused", async () => {
  // Real registry: the API belongs to platform-sandbox, so asking for any other environment is a mismatch.
  for (const [name, call] of Object.entries(BOTH)) {
    const s = stub();
    await assert.rejects(call({ baseUrl: API, environmentId: "platform-certification", fetch: s.fetch }), refusal("ENVIRONMENT_MISMATCH"), name);
    assert.equal(s.calls.length, 0);
  }
  // Two nonprod environments, each with its own API and application surface: crossing them is refused.
  const registry = { environments: [
    { id: "env-a", role: "sandbox", eosApi: { baseUrl: "https://api-a.example" }, surfaces: [{ url: "https://app-a.example", eosApplication: true }] },
    { id: "env-b", role: "integration", eosApi: { baseUrl: "https://api-b.example" }, surfaces: [{ url: "https://app-b.example", eosApplication: true }] },
    { id: "env-p", role: "production", eosApi: null, surfaces: [{ url: "https://app-p.example/field-ops" }] },
  ] };
  assert.equal(resolveEosTargetFrom(registry, { baseUrl: "https://api-a.example", origin: "https://app-a.example" }).environmentId, "env-a");
  assert.throws(() => resolveEosTargetFrom(registry, { baseUrl: "https://api-a.example", origin: "https://app-b.example" }), refusal("ENVIRONMENT_MISMATCH"));
  assert.throws(() => resolveEosTargetFrom(registry, { baseUrl: "https://api-b.example", origin: "https://app-a.example" }), refusal("ENVIRONMENT_MISMATCH"));
  assert.throws(() => resolveEosTargetFrom(registry, { baseUrl: "https://api-a.example", origin: "https://app-p.example" }), refusal("PRODUCTION_REFUSED"));
});

test("an authentication redirect is refused, never followed, and the error carries no secret or Location", async () => {
  for (const redirect of [
    { ok: false, status: 302, headers: { get: () => "https://evil.example/collect" }, json: async () => null },
    { ok: false, status: 307, headers: { get: () => `${API}.evil.example/x` }, json: async () => null },
    { ok: false, status: 0, type: "opaqueredirect", json: async () => null },
  ]) {
    for (const [name, call] of Object.entries(BOTH)) {
      const s = stub(() => redirect);
      await assert.rejects(call({ baseUrl: API, origin: APP, fetch: s.fetch }), (e) => {
        assert.equal(e.code, "REDIRECT_REFUSED");
        assert.ok(!SECRETS.some((x) => e.message.includes(x)) && !e.message.includes("evil.example"));
        return true;
      }, name);
      assert.equal(s.calls.length, 1, `${name}: the redirect is not followed`);
    }
  }
});

test("a refusal happens BEFORE any password, MFA code, issuer credential or token is transmitted", async () => {
  const refused = [
    { baseUrl: "https://evil.example" }, { baseUrl: PROD_SURFACE }, { baseUrl: API, origin: "https://evil.example" },
    { baseUrl: API, environmentId: "platform-certification" }, { baseUrl: `${API}.evil.example` }, { baseUrl: "not a url" },
  ];
  for (const [name, call] of Object.entries(BOTH)) {
    for (const opts of refused) {
      const s = stub();
      await assert.rejects(call({ fetch: s.fetch, ...opts }), (e) => e.name === "EosPersonaSessionError" && !SECRETS.some((x) => e.message.includes(x)), `${name} ${JSON.stringify(opts)}`);
      assert.equal(s.calls.length, 0, `${name} ${JSON.stringify(opts)}: fetch must not be called at all`);
      assert.equal(transmitted(s.calls), false);
    }
  }
  const t = stub();
  await assert.rejects(callEosApiAsPersona("dispatcher", "/x", {}, { env: {}, credential: ISSUER_CREDENTIAL, baseUrl: "https://evil.example", fetch: t.fetch }));
  assert.equal(t.calls.length, 0, "no bearer token leaves the process for a refused target");
});

test("normalisation: trailing slash, explicit default port and upper-case host are equal; lookalikes and decorated URLs are refused", async () => {
  for (const baseUrl of [`${API}/`, `${API}:443`, `${API}:443/`, "https://EOS-API-NONPROD.onrender.com", "HTTPS://Eos-Api-Nonprod.OnRender.com/"]) {
    const s = stub();
    await issue({ baseUrl, fetch: s.fetch });
    assert.equal(s.calls[0].url, `${API}/auth/nonprod/persona-session`, baseUrl);
    clearEosPersonaSessionCache();
  }
  const s = stub();
  await login({ baseUrl: API, origin: "https://VERENWARDEOS.vercel.app:443/", fetch: s.fetch });
  assert.equal(s.calls[0].init.headers.origin, APP);

  for (const baseUrl of [
    "https://eos-api-nonprod.onrender.com.evil.example", "https://xeos-api-nonprod.onrender.com", "https://evil.example/eos-api-nonprod.onrender.com",
    "https://eos-api-nonprod.onrender.com@evil.example", "https://user:pw-zz9@eos-api-nonprod.onrender.com", `${API}/auth`, `${API}?x=1`,
  ]) {
    for (const [name, call] of Object.entries(BOTH)) {
      const r = stub();
      await assert.rejects(call({ baseUrl, fetch: r.fetch }), (e) => {
        assert.ok(["API_NOT_REGISTERED", "INVALID_TARGET_URL"].includes(e.code), `${name} ${baseUrl} -> ${e.code}`);
        assert.ok(!e.message.includes("pw-zz9"), "userinfo is never echoed");
        return true;
      });
      assert.equal(r.calls.length, 0);
    }
  }
});

test("callEosApiAsPersona: a route is a path, never an authority -- every host-smuggling route is refused with zero transmissions", async () => {
  for (const route of ["@evil.example/x", ".evil.example/x", ":1@evil.example/", "//evil.example/x", "\\\\evil.example/x", "\\evil.example/x", "x", "", undefined, 42]) {
    const s = stub();
    await assert.rejects(
      callEosApiAsPersona("dispatcher", route, {}, { env: {}, credential: ISSUER_CREDENTIAL, baseUrl: API, fetch: s.fetch }),
      refusal("INVALID_ROUTE"), String(route));
    assert.equal(s.calls.length, 0, `${String(route)}: no issuer call and no bearer token`);
    assert.equal(transmitted(s.calls), false);
  }
  // A well-formed path is sent to the registered API, with the bearer token.
  const ok = stub((url) => url.endsWith("/auth/nonprod/persona-session")
    ? { ok: true, status: 200, json: async () => ({ ok: true, token: TOKEN, expiresAt: "2099-01-01T00:00:00Z", personaKey: "dispatcher", principalId: "pr-1" }) }
    : { ok: true, status: 200, json: async () => ({ ok: true }) });
  await callEosApiAsPersona("dispatcher", "/operations/x", {}, { env: {}, credential: ISSUER_CREDENTIAL, baseUrl: API, fetch: ok.fetch });
  assert.equal(ok.calls[1].url, `${API}/operations/x`);
  assert.equal(ok.calls[1].init.headers.authorization, `Bearer ${TOKEN}`);
});

test("registry fail-closed: an unrecognised role (missing, 'Production', 'prod', 'production ') voids the whole resolution", () => {
  const valid = { id: "env-a", role: "sandbox", eosApi: { baseUrl: "https://api-a.example" }, surfaces: [{ url: "https://app-a.example", eosApplication: true }] };
  for (const role of [undefined, "Production", "prod", "production ", ""]) {
    const bad = { id: "env-x", ...(role === undefined ? {} : { role }), eosApi: { baseUrl: "https://api-x.example" }, surfaces: [{ url: "https://app-x.example", eosApplication: true }] };
    const registry = { environments: [valid, bad] };
    // Neither the odd entry's own URLs NOR a perfectly valid entry's URLs resolve.
    for (const opts of [{ baseUrl: "https://api-x.example", origin: "https://app-x.example" }, { baseUrl: "https://api-a.example", origin: "https://app-a.example" }]) {
      assert.throws(() => resolveEosTargetFrom(registry, opts), refusal("REGISTRY_ROLE_UNKNOWN"), `role=${JSON.stringify(role)}`);
    }
  }
});

test("a production entry that overlaps a nonprod entry wins: PRODUCTION_REFUSED, and a malformed production entry is an EosPersonaSessionError", () => {
  const overlap = { environments: [
    { id: "env-a", role: "sandbox", eosApi: { baseUrl: "https://shared.example" }, surfaces: [{ url: "https://app-shared.example", eosApplication: true }] },
    { id: "env-p", role: "production", eosApi: { baseUrl: "https://shared.example" }, surfaces: [{ url: "https://app-shared.example/field-ops" }] },
  ] };
  assert.throws(() => resolveEosTargetFrom(overlap, { baseUrl: "https://shared.example" }), refusal("PRODUCTION_REFUSED"));
  assert.throws(() => resolveEosTargetFrom({ environments: [overlap.environments[0], { ...overlap.environments[1], eosApi: null }] },
    { baseUrl: "https://shared.example", origin: "https://app-shared.example" }), refusal("PRODUCTION_REFUSED"));
  const malformed = { environments: [overlap.environments[0], { id: "env-p", role: "production", eosApi: { baseUrl: "not a url" }, surfaces: [] }] };
  assert.throws(() => resolveEosTargetFrom(malformed, { baseUrl: "https://shared.example" }), (e) => e instanceof client.EosPersonaSessionError);
});

test("pinned parser edges: trailing-dot host, IPv4/IPv6 literals, percent-encoded hosts and backslash userinfo are refused with zero calls", async () => {
  for (const baseUrl of [
    "https://eos-api-nonprod.onrender.com.", "https://eos-api-nonprod.onrender.com.:443",
    "https://1.2.3.4", "https://[::1]", "https://[::ffff:1.2.3.4]", "https://2130706433", "https://0x7f.0.0.1",
    "https://eos%2dapi-nonprod.onrender.com", "https://eos-api-nonprod%2eonrender.com", "https://%65os-api-nonprod.onrender.com",
    "https://eos-api-nonprod.onrender.com\\@evil.example", "https://evil.example\\@eos-api-nonprod.onrender.com",
    "https://eos-api-nonprod.onrender.com\\.evil.example", "https://evil.example%5c@eos-api-nonprod.onrender.com",
  ]) {
    for (const [name, call] of Object.entries(BOTH)) {
      const s = stub();
      await assert.rejects(call({ baseUrl, fetch: s.fetch }), (e) => e.name === "EosPersonaSessionError" && !SECRETS.some((x) => e.message.includes(x)), `${name} ${baseUrl}`);
      assert.equal(s.calls.length, 0, `${name} ${baseUrl}`);
    }
  }
  for (const origin of ["https://verenwardeos.vercel.app.", "https://[::1]", "https://5.6.7.8", "https://verenwardeos%2evercel.app", "https://verenwardeos.vercel.app\\@evil.example"]) {
    const s = stub();
    await assert.rejects(login({ baseUrl: API, origin, fetch: s.fetch }), (e) => e.name === "EosPersonaSessionError", origin);
    assert.equal(s.calls.length, 0, origin);
  }
});
