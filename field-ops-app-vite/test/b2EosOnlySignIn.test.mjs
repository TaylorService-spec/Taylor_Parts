// FIREBASE EXIT B2 -- the EOS-only sign-in build, proved under plain node.
//
// The claim: a build that selects the EOS sign-in has NO Firebase identity, initialises no Firebase app, never subscribes to
// Firebase auth, never asks Firebase for a bearer, and cannot be produced for a production environment. Each half is
// asserted against the real source and the real registry, not against a restatement of them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEnvironment, EnvironmentResolutionError } from "../../scripts/resolveEnvironment.mjs";
import { resolveEosAuthOnly } from "../src/auth/authSource.js";
import { eosHumanLoginEnabled } from "../src/auth/eosLoginClient.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");
const registry = JSON.parse(readFileSync(join(HERE, "..", "..", "config", "environments.json"), "utf8"));
const codeOf = (fn) => { try { fn(); } catch (e) { return e instanceof EnvironmentResolutionError ? e.code : `OTHER:${e.message}`; } return null; };

test("the registry resolves an EOS-only build for platform-sandbox with NO Firebase identity", () => {
  const eos = resolveEnvironment(registry, "platform-sandbox", { authSource: "eos" });
  assert.equal(eos.authSource, "eos");
  assert.equal(eos.firebase, null, "no Firebase config reaches the bundle");
  assert.equal(eos.readiness.EOS_NAVIGATION_AUTHORITY_READY, true, "the session itself is answered by EOS");
  const ordinary = resolveEnvironment(registry, "platform-sandbox");
  assert.equal(ordinary.authSource, "firebase", "the default build is unchanged");
  assert.equal(ordinary.firebase.projectId, "eos-platform-sandbox");
});

test("an EOS-only build is refused everywhere the registry does not allow it", () => {
  for (const env of registry.environments) {
    const code = codeOf(() => resolveEnvironment(registry, env.id, { authSource: "eos" }));
    if (env.id === "platform-sandbox") { assert.equal(code, null); continue; }
    assert.ok(code, `${env.id} must refuse an EOS-only sign-in build`);
  }
  const production = registry.environments.find((e) => e.role === "production");
  assert.ok(production, "the registry declares a production environment");
  assert.equal(codeOf(() => resolveEnvironment(registry, production.id, { authSource: "eos" })), "EOS_AUTH_REFUSED_PRODUCTION");
  // Even a mis-edited registry cannot widen it: authSources on a production-role environment is refused by role.
  const edited = JSON.parse(JSON.stringify(registry));
  edited.environments.find((e) => e.id === production.id).authSources = ["firebase", "eos"];
  assert.equal(codeOf(() => resolveEnvironment(edited, production.id, { authSource: "eos" })), "EOS_AUTH_REFUSED_PRODUCTION");
  // Listing 'eos' is necessary but not sufficient: no EOS API, or no EOS session source, is refused too.
  const noApi = JSON.parse(JSON.stringify(registry));
  noApi.environments.find((e) => e.id === "platform-sandbox").eosApi = null;
  assert.equal(codeOf(() => resolveEnvironment(noApi, "platform-sandbox", { authSource: "eos" })), "EOS_AUTH_NO_API");
  const noSession = JSON.parse(JSON.stringify(registry));
  noSession.environments.find((e) => e.id === "platform-sandbox").readiness.EOS_NAVIGATION_AUTHORITY_READY = false;
  assert.equal(codeOf(() => resolveEnvironment(noSession, "platform-sandbox", { authSource: "eos" })), "EOS_AUTH_NO_SESSION_SOURCE");
  assert.equal(codeOf(() => resolveEnvironment(registry, "platform-sandbox", { authSource: "other" })), "INVALID_AUTH_SOURCE");
});

test("no production-role environment lists 'eos' as a sign-in source", () => {
  for (const env of registry.environments.filter((e) => e.role === "production")) {
    assert.ok(!(env.authSources ?? []).includes("eos"), `${env.id}`);
  }
});

test("the seam: EOS-only needs the build to say eos AND a known non-production role (two independent refusals)", () => {
  assert.equal(resolveEosAuthOnly({ source: "eos", role: "sandbox" }), true);
  assert.equal(resolveEosAuthOnly({ source: "eos", role: "production" }), false);
  assert.equal(resolveEosAuthOnly({ source: "eos", role: null }), false, "an unidentified bundle is treated as production");
  assert.equal(resolveEosAuthOnly({ source: "firebase", role: "sandbox" }), false);
  assert.equal(resolveEosAuthOnly({ source: undefined, role: "sandbox" }), false);
  assert.equal(resolveEosAuthOnly(), false, "no define in plain node = the Firebase build");
});

test("EOS login is on in an EOS-only build without any second variable, and never in production", () => {
  assert.equal(eosHumanLoginEnabled({ flag: undefined, role: "sandbox", eosAuthOnly: true }), true);
  assert.equal(eosHumanLoginEnabled({ flag: undefined, role: "production", eosAuthOnly: true }), false);
  assert.equal(eosHumanLoginEnabled({ flag: "enabled", role: "sandbox", eosAuthOnly: false }), true, "the coexistence flag still works");
  assert.equal(eosHumanLoginEnabled({ flag: undefined, role: "sandbox", eosAuthOnly: false }), false);
});

test("firebase/firebase.js initialises nothing when the injected config is null", () => {
  const src = read("firebase/firebase.js");
  assert.match(src, /const app = !firebaseConfig \? null : initializeApp\(/);
  assert.match(src, /export const db = app \? getFirestore\(app\) : null;/);
  assert.match(src, /export const auth = app \? getAuth\(app\) : null;/);
  assert.match(src, /export const functions = app \? getFunctions\(app, firebaseConfig\.functionsRegion\) : null;/);
  assert.match(src, /if \(app && import\.meta\.env\.DEV/, "the emulator hook needs an app too");
  assert.match(src, /export const FIREBASE_INITIALIZED = Boolean\(firebaseConfig\);/);
});

test("the sign-in screens read the environment WITHOUT importing the Firebase module", () => {
  assert.doesNotMatch(read("auth/AuthShell.jsx"), /firebase\/firebase/);
  for (const f of ["auth/authSource.js", "config/appEnvironment.js", "auth/eosLoginClient.js", "auth/EosLogin.jsx"]) {
    assert.doesNotMatch(read(f), /from ["'](firebase|\.\.?\/firebase\/firebase)/, f);
  }
});

test("AuthContext in an EOS-only build never reaches a Firebase call", () => {
  const src = read("auth/AuthContext.jsx").replace(/\r\n/g, "\n");
  const guard = src.indexOf("if (EOS_AUTH_ONLY) {");
  const subscribe = src.indexOf("onAuthStateChanged(auth, async");
  assert.ok(guard > 0 && subscribe > guard, "the EOS-only branch returns BEFORE the Firebase subscription");
  assert.match(src, /EOS_AUTH_ONLY \? eosOnlyRefusal\(\) : signInWithEmailAndPassword/);
  assert.match(src, /EOS_AUTH_ONLY \? undefined : signOut\(auth\)/);
  assert.match(src, /EOS_AUTH_ONLY \? eosOnlyRefusal\(\) : sendPasswordResetEmail/);
});

test("the bearer has no Firebase fallback in an EOS-only build, and every API client reaches it through that one function", () => {
  const src = read("services/adminPolicyApiClient.js");
  const idx = (s) => src.indexOf(s);
  assert.ok(idx("if (EOS_AUTH_ONLY) return null;") > idx("const eosToken = currentEosSessionToken();"));
  assert.ok(idx("if (EOS_AUTH_ONLY) return null;") < idx("auth?.currentUser"), "the fallback is after the refusal");
  // No other module asks Firebase Auth for a token.
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSyncSafe(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|jsx|ts|tsx)$/.test(e.name) && /\bauth\??\.currentUser\b/.test(readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/.*$/gm, ""))) offenders.push(p.replace(SRC, ""));
    }
  };
  walk(SRC);
  assert.deepEqual(offenders.map((o) => o.replace(/\\/g, "/")), ["/services/adminPolicyApiClient.js"], "only the one bearer function consults Firebase Auth");
});

test("an unmigrated screen fails inside the content area in an EOS-only build, and only there", () => {
  const app = read("App.jsx").replace(/\r\n/g, "\n");
  assert.match(app, /\{EOS_AUTH_ONLY \? \(\s*<RouteErrorBoundary>\s*<AppRoutes [^>]*\/>\s*<\/RouteErrorBoundary>\s*\) : \(\s*<AppRoutes /);
  const boundary = read("components/RouteErrorBoundary.jsx");
  assert.match(boundary, /<ErrorBoundary key=\{pathname\}>/, "keyed by route: navigating away mounts a fresh boundary");
});

test("Users administration in an EOS-only build: Firebase account callables and the legacy approval queue are not reachable", () => {
  const detail = read("modules/administration/UserDetail.jsx");
  assert.match(detail, /usePrincipalCredential\(EOS_AUTH_ONLY \? null : principalId/);
  assert.match(detail, /if \(EOS_AUTH_ONLY\) \{\s*setHistory\(\{ loading: false, rows: \[\], unavailable: LEGACY_TRAIL_HELD \}\);/);
  assert.match(detail, /if \(EOS_AUTH_ONLY\) \{\s*return \(\s*<div className="fo-user-actions" data-account-actions="EOS_SIGN_IN">/);
  const approvals = read("modules/administration/ApprovalRequests.jsx");
  assert.match(approvals, /EOS_AUTH_ONLY \? <ApprovalRequestsHeld \/> : <ApprovalRequestsQueue/);
  assert.match(approvals, /Nothing here means none are pending/);
});

test("the harness signs an ENROLLED persona in through the same front door: RFC 6238 code, CSRF header, allowed Origin, code-only errors", async () => {
  const { totpCode, loginEosPersona } = await import("../../scripts/eosPersonaSession.mjs");
  assert.equal(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000), "287082", "RFC 6238 appendix B, SHA-1, T=59s (six digits)");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const file = join(mkdtempSync(join(tmpdir(), "eos-persona-creds-")), "creds.json");
  writeFileSync(file, JSON.stringify({ entries: [
    { personaKey: "dispatcher", state: "enrolled", loginIdentifier: "dispatcher@sandbox.invalid", password: "pw-value", totpSecretBase32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
    { personaKey: "partsManager", state: "pending", loginIdentifier: "p@sandbox.invalid", password: "x", totpSecretBase32: "GEZDGNBVGY3TQOJQ" },
  ] }));
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (url.endsWith("/auth/login")) return { ok: true, status: 200, json: async () => ({ ok: true, status: "MFA_REQUIRED", challenge: "eosmc_x" }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, session: { accessToken: "a.b.c", accessTokenExpiresAt: "2026-10-17T00:05:00Z" } }) };
  };
  const s = await loginEosPersona("dispatcher", { credentialsFile: file, baseUrl: "https://api.test", fetch, origin: "https://app.test", nowMs: 59_000 });
  assert.deepEqual({ ...s }, { token: "a.b.c", expiresAt: "2026-10-17T00:05:00Z", personaKey: "dispatcher" });
  assert.equal(calls[0].headers["x-eos-csrf"], "1");
  assert.equal(calls[0].headers.origin, "https://app.test");
  assert.equal(calls[1].body.code, "287082");
  await assert.rejects(loginEosPersona("partsManager", { credentialsFile: file, baseUrl: "https://api.test", fetch, origin: "https://app.test" }), /PERSONA_NOT_ENROLLED/);
  await assert.rejects(loginEosPersona("dispatcher", { env: {}, baseUrl: "https://api.test", fetch }), /NO_CREDENTIALS_FILE/);
  const refused = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, code: "LOGIN_REFUSED" }) });
  await assert.rejects(loginEosPersona("dispatcher", { credentialsFile: file, baseUrl: "https://api.test", fetch: refused, origin: "https://app.test" }), (e) => /LOGIN_REFUSED/.test(e.message) && !e.message.includes("pw-value"));
});

function readdirSyncSafe(dir) {
  try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}
